#!/usr/bin/env node
/**
 * Regenerates every app icon from the single brand source mask.
 *
 * Source of truth: assets/brand/fish-mask.png — a grayscale silhouette of the
 * logo, already cropped to its bounding box. Everything else (PWA icons,
 * favicon, desktop icon, Android launcher assets) is derived from it here so
 * the brand only ever has to be redrawn in one place.
 *
 * Usage: node scripts/build-brand-icons.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const MASK = path.join(ROOT, 'assets/brand/fish-mask.png');

const BG = { r: 0x14, g: 0x18, b: 0xd6, alpha: 1 };
const FG = { r: 0xe4, g: 0xe2, b: 0xff, alpha: 1 };

/** Renders the logo centred on a square canvas. `ratio` is the logo height as a share of the canvas. */
async function icon(size, ratio, { transparent = false } = {}) {
  const mask = await sharp(MASK).metadata();
  const height = Math.round(size * ratio);
  const width = Math.round((mask.width / mask.height) * height);
  const logo = await sharp({
    create: { width, height, channels: 3, background: FG },
  })
    // The mask is greyscale, so it has to be joined in as the alpha channel
    // rather than composited — compositing would use its (opaque) alpha.
    .joinChannel(
      await sharp(MASK).resize(width, height).toColourspace('b-w').raw().toBuffer(),
      { raw: { width, height, channels: 1 } },
    )
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: transparent ? { ...BG, alpha: 0 } : BG,
    },
  })
    .composite([
      {
        input: logo,
        left: Math.round((size - width) / 2),
        top: Math.round((size - height) / 2),
      },
    ])
    .png()
    .toBuffer();
}

async function write(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  console.log('wrote', path.relative(ROOT, file));
}

async function main() {
  // Master art, kept alongside the mask for anyone who needs a raw export.
  await write(path.join(ROOT, 'assets/brand/icon-master.png'), await icon(1024, 0.62));
  await write(path.join(ROOT, 'assets/brand/icon-maskable.png'), await icon(1024, 0.44));

  // Web / PWA.
  const web = path.join(ROOT, 'client/public/icons');
  for (const size of [192, 512]) {
    await write(path.join(web, `icon-${size}.png`), await icon(size, 0.62));
    await write(path.join(web, `icon-${size}-maskable.png`), await icon(size, 0.44));
  }
  await write(path.join(web, 'apple-icon-180.png'), await icon(180, 0.62));

  // Desktop (electron-builder turns the png into .ico/.icns at build time).
  await write(path.join(ROOT, 'desktop/assets/icon.png'), await icon(1024, 0.62));
  await write(path.join(ROOT, 'desktop/assets/icon.ico'), await icon(256, 0.62));

  // Android: square legacy launcher plus the adaptive foreground layer, whose
  // logo has to stay inside the middle 66% of the 432dp canvas.
  const res = path.join(ROOT, 'mobile/android/app/src/main/res');
  const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(densities)) {
    await write(path.join(res, `mipmap-${density}/ic_launcher.png`), await icon(size, 0.62));
    await write(path.join(res, `mipmap-${density}/ic_launcher_round.png`), await icon(size, 0.5));
    await write(
      path.join(res, `mipmap-${density}/ic_launcher_foreground.png`),
      await icon(Math.round(size * 2.25), 0.28, { transparent: true }),
    );
  }
  await write(path.join(ROOT, 'assets/brand/play-store-512.png'), await icon(512, 0.62));

  // favicon.svg just wraps the raster logo: the artwork is a bitmap mask, so
  // there is no honest vector path to ship, and this keeps one file for
  // every browser that prefers an SVG favicon.
  const favicon = await icon(256, 0.62);
  await write(
    path.join(ROOT, 'client/public/favicon.svg'),
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256">\n` +
        `  <image width="256" height="256" xlink:href="data:image/png;base64,${favicon.toString('base64')}"/>\n` +
        `</svg>\n`,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
