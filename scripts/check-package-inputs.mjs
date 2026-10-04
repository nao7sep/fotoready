import { open, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
for (const exclusion of ["!**/*.map", "!**/*.d.ts", "!**/*.d.mts", "!**/*.d.cts"]) {
  if (!packageJson.build?.files?.includes(exclusion)) {
    throw new Error(`Packaged development metadata exclusion is missing: ${exclusion}`);
  }
}

const stampDir = path.resolve("resources/stamps");
// A built-in stamp is a PNG or a WebP; a Git LFS pointer left in its place has neither signature.
const signatures = {
  ".png": (header) => header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ".webp": (header) => header.toString("latin1", 0, 4) === "RIFF" && header.toString("latin1", 8, 12) === "WEBP"
};
const stampFiles = (await readdir(stampDir)).filter((name) => path.extname(name).toLowerCase() in signatures);

if (stampFiles.length === 0) {
  throw new Error(`No built-in stamp PNGs or WebPs found in ${stampDir}.`);
}

for (const name of stampFiles) {
  const file = await open(path.join(stampDir, name), "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || !signatures[path.extname(name).toLowerCase()](header)) {
      throw new Error(`Built-in stamp is not a materialized image (Git LFS pointer possible): ${name}`);
    }
  } finally {
    await file.close();
  }
}

console.log(`Verified ${stampFiles.length} materialized built-in stamps.`);
