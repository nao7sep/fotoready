// Native Electron qualification only: duplicates the profile calls, not production bootstrap.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { expect, it } from "vitest";
import { ownLiveChild } from "../helpers/live-child";

type ProfileEvidence = {
  lock: boolean;
  userData: string;
  sessionData: string;
  storagePath: string;
  persistent: boolean;
  initialCookieCount: number;
  cookie: string;
  main: string;
  records: string;
};

it("isolates real main and Records Chromium state and concurrent instance locks by storage root", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "fotoready-electron-profile-")));
  const children: Array<ReturnType<typeof ownLiveChild>> = [];
  const roots = [join(dir, "first"), join(dir, "second")];
  try {
    const main = join(dir, "probe.cjs");
    await writeFile(main, `
      const { app, BrowserWindow, session } = require('electron');
      const fs = require('node:fs');
      const path = require('node:path');
      process.on('uncaughtException', (error) => { console.error(error); app.exit(1); });
      const root = process.env.FOTOREADY_PROFILE_TEST_ROOT;
      const marker = process.env.FOTOREADY_PROFILE_TEST_MARKER;
      if (process.platform === 'darwin') app.setActivationPolicy('accessory');
      fs.mkdirSync(path.join(root, 'electron', 'session'), { recursive: true });
      app.setPath('userData', path.join(root, 'electron'));
      app.setPath('sessionData', path.join(root, 'electron', 'session'));
      const lock = app.requestSingleInstanceLock();
      if (!lock) { console.error('isolated profile did not acquire its lock'); app.exit(1); }
      app.disableHardwareAcceleration();
      app.whenReady().then(async () => {
        const windows = [];
        try {
          const cookieUrl = 'https://fotoready-profile.invalid/';
          const initialCookieCount = (await session.defaultSession.cookies.get({ url: cookieUrl })).length;
          for (const name of ['main', 'Records']) {
            const html = path.join(root, name + '.html');
            fs.writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"></head><body>Disposable profile qualification</body></html>');
            const win = new BrowserWindow({ title: 'FotoReady profile qualification ' + name, show: false, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } });
            windows.push(win);
            await win.loadFile(html);
            await win.webContents.executeJavaScript('localStorage.setItem(' + JSON.stringify(name) + ', ' + JSON.stringify(marker) + ')');
          }
          await session.defaultSession.cookies.set({ url: cookieUrl, name: 'profile', value: marker, expirationDate: Date.now() / 1000 + 3600 });
          session.defaultSession.flushStorageData();
          await session.defaultSession.cookies.flushStore();
          const evidence = async () => ({
            lock: lock && app.hasSingleInstanceLock(),
            userData: app.getPath('userData'), sessionData: app.getPath('sessionData'),
            storagePath: session.defaultSession.getStoragePath(), persistent: session.defaultSession.isPersistent(),
            initialCookieCount,
            cookie: (await session.defaultSession.cookies.get({ url: cookieUrl, name: 'profile' }))[0]?.value,
            main: await windows[0].webContents.executeJavaScript('localStorage.getItem("main")'),
            records: await windows[1].webContents.executeJavaScript('localStorage.getItem("Records")')
          });
          fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(await evidence()));
          process.stdin.setEncoding('utf8');
          process.stdin.once('data', async (command) => {
            try {
              if (command.trim() !== 'verify') throw new Error('unexpected fixture command');
              fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(await evidence()));
              for (const win of windows) win.destroy();
              app.quit();
            } catch (error) { console.error(error); app.exit(1); }
          });
          process.stdin.resume();
          process.stdout.write('ready\\n');
        } catch (error) { console.error(error); app.exit(1); }
      }).catch((error) => { console.error(error); app.exit(1); });
    `);
    const electron = createRequire(import.meta.url)("electron") as string;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    for (const [index, root] of roots.entries()) {
      children.push(ownLiveChild(spawn(electron, ["--headless", main], {
        env: { ...env, FOTOREADY_PROFILE_TEST_ROOT: root, FOTOREADY_PROFILE_TEST_MARKER: `profile-${index}` },
        stdio: ["pipe", "pipe", "pipe"]
      }), `Electron isolated profile ${index}`));
    }
    await Promise.all(children.map((child) => child.waitReady(30_000)));
    // Both processes must still own their locks at the same time, not merely acquire them in turn.
    expect(children.every(({ child }) => child.exitCode === null && child.signalCode === null)).toBe(true);
    for (const [index, root] of roots.entries()) await checkEvidence(root, `profile-${index}`);
    for (const child of children) child.child.stdin.write("verify\n");
    await Promise.all(children.map((child) => child.waitClosed(30_000)));
    for (const [index, root] of roots.entries()) {
      expect(children[index]!.child.exitCode).toBe(0);
      await checkEvidence(root, `profile-${index}`);
      const files = (await readdir(join(root, "electron", "session"), { recursive: true })).map((file) => file.split(sep).join("/"));
      expect(files.some((file) => /(^|\/)Cookies$/.test(file))).toBe(true);
      expect(files.some((file) => file.startsWith("Local Storage/leveldb/"))).toBe(true);
    }
    process.stdout.write("Electron profile qualification: two concurrent isolated locks; main/Records localStorage and cookies persisted inside both temporary session roots.\n");
  } finally {
    await Promise.all(children.map((child) => child.stop()));
    await rm(dir, { recursive: true, force: true });
  }
});

async function checkEvidence(root: string, marker: string): Promise<void> {
  const evidence = JSON.parse(await readFile(join(root, "evidence.json"), "utf8")) as ProfileEvidence;
  expect(evidence.lock).toBe(true);
  expect(evidence.userData).toBe(join(root, "electron"));
  expect(evidence.sessionData).toBe(join(root, "electron", "session"));
  expect(relative(evidence.sessionData, evidence.storagePath)).toBe("");
  expect(evidence.persistent).toBe(true);
  expect(evidence.initialCookieCount).toBe(0);
  expect([evidence.cookie, evidence.main, evidence.records]).toEqual([marker, marker, marker]);
}
