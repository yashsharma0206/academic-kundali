const path = require('path');

async function main() {
  const sharp = require('sharp');

  const projectRoot = path.resolve(__dirname, '..');
  const input = path.join(projectRoot, 'assets', 'report-watermark-source.png');
  const output = path.join(projectRoot, 'assets', 'ak-wheel.png');

  const img = sharp(input);
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('Could not read input image size');

  // The provided file is a screenshot; the circular wheel sits centrally.
  // Crop a centered square that tightly captures the wheel.
  const size = Math.min(meta.width, meta.height);
  const cropSize = Math.round(size * 0.72);
  const left = Math.round((meta.width - cropSize) / 2);
  const top = Math.round((meta.height - cropSize) / 2);

  await img
    .extract({ left, top, width: cropSize, height: cropSize })
    .resize(1400, 1400, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toFile(output);

  // eslint-disable-next-line no-console
  console.log(`Wrote ${output}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

