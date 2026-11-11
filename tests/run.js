/* Hilfsfunktion: Seite im Headless-Chromium öffnen. */
const { chromium } = require('playwright');
const path = require('path');
async function open(file) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[browser ' + m.type() + ']', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', file));
  page.setDefaultTimeout(0);
  return { browser, page };
}
module.exports = { open };
