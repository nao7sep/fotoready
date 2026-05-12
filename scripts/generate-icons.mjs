import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = new URL("..", import.meta.url).pathname;
const buildDir = path.join(root, "build");
const iconsetDir = path.join(buildDir, "icon.iconset");
const sizes = [16, 32, 64, 128, 256, 512, 1024];

await fs.mkdir(iconsetDir, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="120" x2="904" y1="96" y2="928" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#56a99c"/>
      <stop offset="1" stop-color="#1f4d65"/>
    </linearGradient>
    <linearGradient id="lens" x1="312" x2="712" y1="312" y2="712" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f7f4ef"/>
      <stop offset="1" stop-color="#b8d9d4"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="216" fill="#141817"/>
  <rect x="112" y="152" width="800" height="720" rx="132" fill="url(#g)"/>
  <path d="M260 288h168l42-66h152l42 66h100c52 0 94 42 94 94v286c0 52-42 94-94 94H260c-52 0-94-42-94-94V382c0-52 42-94 94-94Z" fill="#0e1618" opacity=".92"/>
  <circle cx="512" cy="526" r="192" fill="url(#lens)"/>
  <circle cx="512" cy="526" r="126" fill="#163b4a"/>
  <circle cx="560" cy="476" r="56" fill="#8ce0d3" opacity=".9"/>
  <path d="M284 676h456" stroke="#f7f4ef" stroke-width="44" stroke-linecap="round" opacity=".9"/>
  <path d="M284 586h156" stroke="#f7f4ef" stroke-width="44" stroke-linecap="round" opacity=".9"/>
</svg>`;

await fs.writeFile(path.join(buildDir, "icon.svg"), svg, "utf8");

for (const size of sizes) {
  const png = await renderPng(size);
  await fs.writeFile(path.join(buildDir, `icon-${size}.png`), png);
}

await writeIconset(16, "icon_16x16.png");
await writeIconset(32, "icon_16x16@2x.png");
await writeIconset(32, "icon_32x32.png");
await writeIconset(64, "icon_32x32@2x.png");
await writeIconset(128, "icon_128x128.png");
await writeIconset(256, "icon_128x128@2x.png");
await writeIconset(256, "icon_256x256.png");
await writeIconset(512, "icon_256x256@2x.png");
await writeIconset(512, "icon_512x512.png");
await writeIconset(1024, "icon_512x512@2x.png");

async function writeIconset(size, name) {
  const png = await renderPng(size);
  await fs.writeFile(path.join(iconsetDir, name), png);
}

async function renderPng(size) {
  return sharp(Buffer.from(svg)).resize(size, size).flatten({ background: "#141817" }).png().toBuffer();
}
