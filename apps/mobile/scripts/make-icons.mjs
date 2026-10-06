// Generates the launcher icons of the Android project from the app logo (public/icon.png of the repository):
// the legacy square and round icons, and the adaptive icon's foreground (the logo inside the 66 dp safe zone of
// a 108 dp canvas), for every density Android needs. The adaptive icon's background is the app's dark colour
// (`ic_launcher_background.xml`).
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const logo = join(here, '../../../public/icon.png');
const res = join(here, '../android/app/src/main/res');
const BACKGROUND = '#0a0e14';

// density -> pixels per dp
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [name, scale] of Object.entries(densities)) {
  const dir = join(res, `mipmap-${name}`);
  const legacy = Math.round(48 * scale);
  const square = await sharp(logo).resize(legacy, legacy).png().toBuffer();
  writeFileSync(join(dir, 'ic_launcher.png'), square);
  const mask = Buffer.from(
    `<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`,
  );
  writeFileSync(
    join(dir, 'ic_launcher_round.png'),
    await sharp(square)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer(),
  );

  const canvas = Math.round(108 * scale);
  const inner = Math.round(66 * scale);
  const logoInner = await sharp(logo).resize(inner, inner).png().toBuffer();
  writeFileSync(
    join(dir, 'ic_launcher_foreground.png'),
    await sharp({
      create: {
        width: canvas,
        height: canvas,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: logoInner, gravity: 'centre' }])
      .png()
      .toBuffer(),
  );
}

writeFileSync(
  join(res, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKGROUND}</color>\n</resources>\n`,
);
console.log('launcher icons written');
