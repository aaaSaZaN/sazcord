// Генерирует assets/icon.png (1024×1024) и assets/icon.ico (multi-res 16..256)
// из единственного источника — client/public/favicon.svg.
//
// Зачем не коммитить готовые бинарники:
//   - SVG-источник один и тот же для веб-фавикона и десктоп-иконки —
//     если поменяем брендинг, не надо вспоминать где ещё лежит ico/png.
//   - electron-builder требует именно .ico для installerIcon (NSIS),
//     а PNG ≥256² для win.icon — оба билдятся одной командой.
//
// Запускается автоматически как `prebuild`/`prebuild:*` в desktop/package.json,
// поэтому ручной шаг не нужен. Можно запустить вручную:
//   npm --workspace desktop run build:icon

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const ROOT = path.resolve(__dirname, '..');
const SVG_SRC = path.resolve(ROOT, '..', 'client', 'public', 'favicon.svg');
const ASSETS_DIR = path.resolve(ROOT, 'assets');
const PNG_OUT = path.join(ASSETS_DIR, 'icon.png');
const ICO_OUT = path.join(ASSETS_DIR, 'icon.ico');

// Размеры для multi-res .ico. Windows сама выбирает нужный размер из
// файла под контекст (taskbar, проводник, alt-tab), поэтому кладём всё
// от 16 до 256 — это стандартный набор.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// Для win.icon (electron-builder) нужен PNG ≥256². 1024 — про запас.
const PNG_SIZE = 1024;

async function main() {
  if (!fs.existsSync(SVG_SRC)) {
    throw new Error(`SVG источник не найден: ${SVG_SRC}`);
  }
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const svg = fs.readFileSync(SVG_SRC);

  // 1) Большой PNG для win.icon / mac.icon / linux.icon.
  await sharp(svg, { density: 384 })
    .resize(PNG_SIZE, PNG_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(PNG_OUT);

  // 2) Набор PNG-буферов разных размеров → склеиваем в один ICO.
  // sharp каждый раз заново растеризует SVG с нужным density, чтобы
  // мелкие размеры не выглядели как уменьшенные большие (anti-alias
  // киллит детали — проще растеризовать сразу в нужном).
  const pngBuffers = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(svg, { density: Math.max(96, size * 4) })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    ),
  );

  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(ICO_OUT, icoBuffer);

  console.log(`[build-icon] ${path.relative(ROOT, PNG_OUT)} (${PNG_SIZE}×${PNG_SIZE})`);

  console.log(`[build-icon] ${path.relative(ROOT, ICO_OUT)} (${ICO_SIZES.join(', ')})`);
}

main().catch((e) => {
  console.error('[build-icon] failed:', e);
  process.exit(1);
});
