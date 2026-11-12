// The desktop app (dev server on :5173) in its own Chrome, for when the Playwright browser tool is busy: zooms onto a
// photo found by name in the sky panel's photo search, with photo outlines on and the photos half transparent so the
// map's stars and object labels show through, zooms into the photo's upper-left part, screenshots, turns the map twice
// with the rotate button and screenshots again (to .playwright-mcp/, never committed).
// Run from the repo root: node .claude/skills/test-placement/scripts/inspect-photo-corner.mjs <label> "<photo name>" [--fisheye]
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require('playwright-core');
const [label, namePart] = process.argv.slice(2);
const fisheye = process.argv.includes('--fisheye');
const shots = `${process.cwd()}/.playwright-mcp`;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-size=1600,1000'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5173');
await page.waitForTimeout(8000);
await page.getByText('Cadres des photos').first().click();
if (fisheye) {
  await page.getByText('Fisheye', { exact: true }).first().click();
  await page.waitForTimeout(800);
}
await page.locator('input.photo-search-input').fill(namePart);
await page.waitForTimeout(1200);
const item = page.locator('.photo-item-name', { hasText: namePart }).first();
await item.click({ force: true });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  for (const el of document.querySelectorAll('#photo-layer canvas, #photo-layer img'))
    el.style.opacity = '0.5';
});
// The photo's top-left-most visible corner: find the dashed outline's extreme by sampling would need the map; zoom
// at a fixed screen point near the photo's left corner as framed by "zoom to photo" (photo fills ~80 % of the view).
const corner = { x: 470, y: 280 };
for (let i = 0; i < 6; i++) {
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(150);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shots}/photo-model-${label}-corner.png` });
// Turn the map: ↻ is the last button of the bottom-right group.
await page.mouse.click(1276, 858);
await page.mouse.click(1276, 858);
await page.waitForTimeout(1500);
await page.screenshot({
  path: `${shots}/photo-model-${label}-corner-turned.png`,
});
console.log(JSON.stringify({ label, errors }));
await browser.close();
