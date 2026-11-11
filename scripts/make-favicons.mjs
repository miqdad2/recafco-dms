// Builds the browser icons from the original RECAFCO logo
// (portal/public/recafco-logo.png):
//   portal/src/app/favicon.ico     16, 32 and 48 px (PNG entries)
//   portal/src/app/apple-icon.png  180 px apple-touch-icon
// Next.js picks both up by file convention and writes the <link> tags.
//
// The logo is trimmed to its own bounding box (only empty transparent margin
// is removed, never artwork) and scaled without distortion.
// - favicon.ico: logo centred in an opaque white circle (transparent outside)
//   with a faint grey ring, like the sidebar badge, so the circle still shows
//   on a white browser tab. The logo is sized so its corners sit just inside
//   the circle. Drawn once at 1024 px and scaled down for clean edges.
// - apple-icon.png: logo on an opaque white square. iOS draws its own rounded
//   mask and fills transparent pixels black, so a circle would get black
//   corners on the home screen.
//
//   node scripts/make-favicons.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const portal = join(dirname(fileURLToPath(import.meta.url)), '..', 'portal');
const sharp = createRequire(join(portal, 'package.json'))('sharp');
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

const source = join(portal, 'public', 'recafco-logo.png');
const trimmed = await sharp(source).trim({ threshold: 0 }).png().toBuffer();

/** Logo centred on an opaque white `size` square with `pad` px on the tighter axis (apple-icon). */
async function icon(size, pad) {
  const inner = size - 2 * pad;
  return sharp(trimmed)
    .resize(inner, inner, { fit: 'contain', background: WHITE, kernel: 'lanczos3' })
    .flatten({ background: WHITE })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: WHITE })
    // RGBA with every pixel fully opaque: Next.js only decodes RGBA PNGs
    // inside .ico files, and the white stays part of the image.
    .ensureAlpha(1)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/*
 * Circular master. A w x h logo fits a circle of diameter D when
 * w² + h² <= D². Logo width 0.76 D (height 0.595 D for 640:501) gives a
 * diagonal of 0.965 D: corners just inside the white, nothing clipped.
 */
const MASTER = 1024;
const RING = 28; // ≈ 1 px at 32 px, a faint half pixel at 16 px
const logoWidth = Math.round(MASTER * 0.76);
const logo = await sharp(trimmed).resize({ width: logoWidth, kernel: 'lanczos3' }).png().toBuffer();
const logoMeta = await sharp(logo).metadata();
const circle = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${MASTER}" height="${MASTER}">` +
    `<circle cx="${MASTER / 2}" cy="${MASTER / 2}" r="${MASTER / 2 - RING / 2}" fill="#ffffff" stroke="#d8dbdf" stroke-width="${RING}"/>` +
    '</svg>',
);
const master = await sharp(circle)
  .composite([{ input: logo, left: Math.round((MASTER - logoMeta.width) / 2), top: Math.round((MASTER - logoMeta.height) / 2) }])
  .png()
  .toBuffer();

/** The circular icon at `size` px, RGBA (Next.js only decodes RGBA PNGs in .ico). */
async function roundIcon(size) {
  return sharp(master).resize(size, size, { kernel: 'lanczos3' }).ensureAlpha().png({ compressionLevel: 9 }).toBuffer();
}

/** ICO container holding PNG images (supported by all current browsers). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

const images = [];
for (const size of [16, 32, 48]) images.push({ size, data: await roundIcon(size) });
writeFileSync(join(portal, 'src', 'app', 'favicon.ico'), ico(images));
writeFileSync(join(portal, 'src', 'app', 'apple-icon.png'), await icon(180, 10));
console.log('Wrote portal/src/app/favicon.ico (16, 32, 48) and portal/src/app/apple-icon.png (180).');
