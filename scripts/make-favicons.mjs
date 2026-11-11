// Builds the browser icons from the original RECAFCO logo
// (portal/public/recafco-logo.png):
//   portal/src/app/favicon.ico     16, 32 and 48 px (PNG entries)
//   portal/src/app/apple-icon.png  180 px apple-touch-icon
// Next.js picks both up by file convention and writes the <link> tags.
//
// The logo is trimmed to its own bounding box (only empty transparent margin
// is removed, never artwork), scaled without distortion and centred on an
// opaque white square with minimal padding. The white is part of the image.
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

/** Logo centred on a white `size` square with `pad` px on the tighter axis. */
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

const sizes = [
  [16, 1],
  [32, 1],
  [48, 2],
];
const images = [];
for (const [size, pad] of sizes) images.push({ size, data: await icon(size, pad) });
writeFileSync(join(portal, 'src', 'app', 'favicon.ico'), ico(images));
writeFileSync(join(portal, 'src', 'app', 'apple-icon.png'), await icon(180, 10));
console.log('Wrote portal/src/app/favicon.ico (16, 32, 48) and portal/src/app/apple-icon.png (180).');
