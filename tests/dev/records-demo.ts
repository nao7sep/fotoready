/**
 * Dev only: the real FotoReady with its Records window over a throwaway data folder, seeded with
 * 10,000 records through the app's own logging path while three more are logged each second. The
 * folder is a new one in the system's temp folder, printed at start and left there;
 * FOTOREADY_DATA_DIR is replaced, so it never touches real data.
 *
 *   npm run demo:records                      watch it by eye (the windows show)
 *   npm run demo:records -- --seed=500        seed fewer records
 *   ... -- --root=<empty folder>              use that folder instead
 *   ... -- --check                            drive the Records window without showing any
 *                                             window, print one `RECORDS-CHECK {json}` line, quit
 *
 * `--check` is what `tests/live/records-window.test.ts` runs. No window is shown and the app
 * stays out of the Dock; the windows still lay out and paint, so the page script reads only what
 * Chromium reports (scrollTop, clientHeight, scrollHeight and the rows' rectangles) and waits for
 * each state it needs, looking at the state first.
 */

import { app, BrowserWindow, type WebContents } from "electron";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DATA_DIR_ENV_VAR } from "@shared/constants";
import { RECORDS_PAGE_SIZE } from "@shared/records";

const check = process.argv.includes("--check");
const seed = Number(process.argv.find((arg) => arg.startsWith("--seed="))?.slice("--seed=".length) ?? 10_000);
const LIVE_MS = 333;

const root = process.argv.find((arg) => arg.startsWith("--root="))?.slice("--root=".length) ??
  mkdtempSync(path.join(tmpdir(), "fotoready-records-demo-"));
process.env[DATA_DIR_ENV_VAR] = root;
const step = (what: string): void => { process.stdout.write(`records demo: ${what}\n`); };
step(`${seed} records in ${root}`);

if (check) {
  // Nothing reaches the screen: windows never show or take focus, and the app has no Dock icon.
  // They are created hidden and still paint, which the checks below rely on.
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  for (const name of ["show", "showInactive", "focus", "moveTop"] as const) BrowserWindow.prototype[name] = () => undefined;
  app.focus = () => undefined;
}

// The app reads its storage root as it starts, so it is loaded only now.
await import("../../src/main/index");

void app.whenReady().then(async () => {
  const main = await firstWindow((window) => window.webContents.getURL().endsWith("index.html") || window.webContents.getURL().startsWith("http"));
  await loaded(main.webContents);
  step("main window loaded");
  const run = <T>(contents: WebContents, script: string): Promise<T> => contents.executeJavaScript(script) as Promise<T>;
  // Records arrive through the renderer's log channel, as a warning each, in order.
  await run(main.webContents, `(async () => {
    for (let start = 1; start <= ${seed}; start += 500) {
      const batch = [];
      for (let n = start; n < Math.min(start + 500, ${seed + 1}); n++) batch.push(window.api.system.log({ level: "warn", message: "seed record " + n, fields: { n } }));
      await Promise.all(batch);
    }
    // A read answers after every write posted before it.
    await window.api.records.sources();
  })()`);
  step("seeded");
  await run(main.webContents, "window.api.records.open()");
  const records = await firstWindow((window) => window.webContents.getURL().endsWith("records.html"));
  await loaded(records.webContents);
  step("records window open");
  let live = 0;
  setInterval(() => {
    live += 1;
    void run(main.webContents, `window.api.system.log({ level: "warn", message: "live record ${live}", fields: { n: ${live} } })`);
  }, LIVE_MS);
  if (check) {
    try {
      const result = await runCheck((script) => run(records.webContents, script));
      process.stdout.write(`RECORDS-CHECK ${JSON.stringify(result)}\n`);
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  }
});

async function firstWindow(matches: (window: BrowserWindow) => boolean): Promise<BrowserWindow> {
  // A new window's page is only named once it starts loading, so this looks again until it is.
  for (;;) {
    const found = BrowserWindow.getAllWindows().find(matches);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function loaded(contents: WebContents): Promise<void> {
  if (!contents.isLoading() && contents.getURL() !== "") return;
  await new Promise<void>((resolve) => contents.once("did-finish-load", () => resolve()));
}

interface Row { key: string; title: string; top: number; bottom: number }
interface Snapshot { scrollTop: number; first: Row; size: number; selected: string | null; detail: string | null }

async function runCheck(page: <T>(script: string) => Promise<T>) {
  await page(PAGE_HELPERS);

  step("check (a)");
  // (a) The first page: 100 records, newest first, in the database's order.
  const first = await page<{ size: number; keys: string[] }>(`(async () => {
    await rc.until(() => rc.size() > 0);
    return { size: rc.size(), keys: rc.rows().map((row) => row.key) };
  })()`);
  const a = { pass: first.size === RECORDS_PAGE_SIZE && contiguousIn(await databaseOrder(page), first.keys), size: first.size };

  step("check (c)");
  // (c) At the top, a record logged now appears at the top on its own.
  const top = await page<Row>(`(async () => {
    const before = rc.rows()[0].key;
    await rc.until(() => rc.rows()[0].key !== before && rc.rows()[0].title.startsWith("live record"));
    return rc.rows()[0];
  })()`);
  const c = { pass: top.title.startsWith("live record"), title: top.title };

  step("check (d)");
  // (d) Scrolled down with a record selected, five stored records and the reads they start move
  // nothing; back at the top they are there, and the selection and its detail stayed.
  const held = await page<{ before: Snapshot; after: Snapshot; back: Snapshot }>(`(async () => {
    const scroll = rc.scroll();
    scroll.scrollTop = 3000;
    await rc.until(() => scroll.scrollTop === 3000);
    await rc.frame();
    const target = rc.visible()[1];
    document.querySelector('[data-listbox-option="' + target.key + '"]').click();
    await rc.until(() => rc.detail() === target.title);
    await rc.frame();
    const before = rc.snapshot();
    let stored = 0;
    const stop = window.api.records.onChanged(() => { stored++; });
    await rc.until(() => stored >= 5);
    stop();
    // Past the live read interval, so a read the last record started has landed too.
    await rc.wait(1500);
    const after = rc.snapshot();
    scroll.scrollTop = 0;
    await rc.until(() => rc.size() > before.size && rc.rows()[0].title.startsWith("live record"));
    await rc.frame();
    const back = rc.snapshot();
    return { before, after, back };
  })()`);
  const same = (x: Snapshot, y: Snapshot) =>
    x.scrollTop === y.scrollTop && x.first.key === y.first.key && x.first.top === y.first.top && x.size === y.size &&
    x.selected === y.selected && x.detail === y.detail;
  const d = {
    pass: same(held.before, held.after) && held.back.size > held.before.size &&
      held.back.selected === held.before.selected && held.back.detail === held.before.detail,
    ...held
  };

  step("check (b)");
  // (b) Walking down a screen at a time loads every record once, in order.
  const walk = await page<{ keys: string[]; steps: number; longestFrameMs: number }>(`(async () => {
    const scroll = rc.scroll();
    scroll.scrollTop = 1;
    await rc.until(() => scroll.scrollTop >= 1);
    rc.longest = 0;
    let steps = 0;
    for (;;) {
      await rc.frame();
      if (rc.loadingMore()) { await rc.until(() => !rc.loadingMore()); continue; }
      if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1) {
        // At the end with nothing loading: done once a frame later still nothing loads.
        await rc.wait(200);
        if (!rc.loadingMore() && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1) break;
        continue;
      }
      scroll.scrollTop = Math.min(scroll.scrollTop + scroll.clientHeight, scroll.scrollHeight - scroll.clientHeight);
      steps++;
    }
    return { keys: rc.rows().map((row) => row.key), steps, longestFrameMs: rc.longest };
  })()`);
  const order = await databaseOrder(page);
  const start = order.indexOf(walk.keys[0] ?? "");
  const b = {
    pass: new Set(walk.keys).size === walk.keys.length && walk.keys.length >= seed &&
      start >= 0 && walk.keys.length === order.length - start && contiguousIn(order, walk.keys),
    loaded: walk.keys.length, steps: walk.steps
  };

  step("check (e)");
  // (e) The window kept answering throughout; its longest frame is reported, not judged.
  const roundTrip = Date.now();
  await page("1");
  const e = { longestFrameMsWhileWalking: Math.round(walk.longestFrameMs), roundTripMs: Date.now() - roundTrip };

  return { pass: a.pass && b.pass && c.pass && d.pass, seed, a, b, c, d, e };
}

/** Every record's key, newest first, as the records store pages them. */
async function databaseOrder(page: <T>(script: string) => Promise<T>): Promise<string[]> {
  return page<string[]>(`(async () => {
    const keys = [];
    let after = null;
    for (;;) {
      const result = await window.api.records.page({ session: null, kind: null, level: null, taskId: null, search: "", after });
      for (const record of result.records) keys.push(record.kind + ":" + record.id);
      const last = result.records.at(-1);
      if (!result.more || last === undefined) return keys;
      after = { time: last.time, kind: last.kind, id: last.id };
    }
  })()`);
}

/** Whether `keys` is one unbroken run of `order`. */
function contiguousIn(order: string[], keys: string[]): boolean {
  const start = order.indexOf(keys[0] ?? "");
  return start >= 0 && keys.every((key, index) => order[start + index] === key);
}

/** Page-side helpers, kept in the page as `rc`. */
const PAGE_HELPERS = `
window.rc = (() => {
  const rc = {
    longest: 0,
    scroll: () => document.querySelector(".records-list"),
    frame: () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    async until(done) { while (!done()) await rc.frame(); },
    rows: () => [...document.querySelectorAll('[role="option"]')].map((option) => ({
      key: option.dataset.listboxOption,
      title: option.querySelector(".records-row-title").textContent,
      top: option.getBoundingClientRect().top,
      bottom: option.getBoundingClientRect().bottom,
    })),
    size: () => document.querySelectorAll('[role="option"]').length,
    visible: () => {
      const box = rc.scroll().getBoundingClientRect();
      return rc.rows().filter((row) => row.top >= box.top && row.bottom <= box.bottom);
    },
    loadingMore: () => rc.scroll().querySelector(":scope > p.records-note") !== null,
    detail: () => document.querySelector(".records-detail-title")?.textContent ?? null,
    snapshot: () => ({
      scrollTop: rc.scroll().scrollTop,
      first: rc.visible()[0],
      size: rc.size(),
      selected: document.querySelector('[role="option"][aria-selected="true"]')?.dataset.listboxOption ?? null,
      detail: rc.detail(),
    }),
  };
  let last = performance.now();
  const tick = (now) => { rc.longest = Math.max(rc.longest, now - last); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return rc;
})();
true;
`;
