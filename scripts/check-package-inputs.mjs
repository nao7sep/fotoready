import { open, readdir } from "node:fs/promises";
import path from "node:path";

const stampDir = path.resolve("resources/stamps");
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const stampFiles = (await readdir(stampDir)).filter((name) => name.toLowerCase().endsWith(".png"));

if (stampFiles.length === 0) {
  throw new Error(`No built-in stamp PNGs found in ${stampDir}.`);
}

for (const name of stampFiles) {
  const file = await open(path.join(stampDir, name), "r");
  try {
    const header = Buffer.alloc(pngSignature.length);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || !header.equals(pngSignature)) {
      throw new Error(`Built-in stamp is not a materialized PNG (Git LFS pointer possible): ${name}`);
    }
  } finally {
    await file.close();
  }
}

console.log(`Verified ${stampFiles.length} materialized built-in stamp PNGs.`);
