const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

(async () => {
  const bundle = await esbuild.build({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import SpecialtyPicker from './src/components/subcontractors/SpecialtyPicker.jsx';
        import { getSpecialtyOptions } from './src/utils/subcontractorSpecialties.js';
        function Fixture() {
          const [value, setValue] = useState(['Siding']);
          const [saved, setSaved] = useState([]);
          const [version, setVersion] = useState(0);
          return React.createElement('form', {onSubmit: e => {
            e.preventDefault();
            window.submits = (window.submits || 0) + 1;
            setSaved([{specialty: value}]);
            setValue([]);
            setVersion(v => v + 1);
          }},
            React.createElement('label', null, 'Specialty (Select all that apply)'),
            React.createElement(SpecialtyPicker, {
              key: version, options: getSpecialtyOptions(saved, value), value, onChange: setValue
            }),
            React.createElement('output', {id: 'selection'}, JSON.stringify(value)),
            React.createElement('button', {type: 'submit'}, 'Save subcontractor')
          );
        }
        createRoot(document.getElementById('root')).render(React.createElement(Fixture));
      `,
      resolveDir: process.cwd(),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    alias: { '@': path.resolve('src') },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  let executablePath;
  try {
    executablePath = execSync('command -v chromium || command -v chromium-browser', { encoding: 'utf8' }).trim();
  } catch {
    // Outside Replit, use the browser installed by Playwright.
  }
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 640 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root" style="padding:24px;max-width:640px;margin:auto"></div>');
    const cssFile = fs.readdirSync('dist/assets').find(name => /^index-.*\.css$/.test(name));
    if (cssFile) await page.addStyleTag({ content: fs.readFileSync(path.join('dist/assets', cssFile), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const add = page.getByRole('button', { name: 'Add specialty', exact: true });
    const input = page.getByRole('textbox', { name: 'New specialty' });
    await add.click();
    await input.press('Enter');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => window.submits || 0), 0);
    await input.fill('   Decks   ');
    await input.press('Enter');
    const decks = page.getByRole('button', { name: 'Decks', exact: true });
    assert.equal(await decks.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.submits || 0), 0);
    await decks.click();
    assert.equal(await decks.getAttribute('aria-pressed'), 'false');
    await decks.click();
    await add.click();
    await input.fill('decks');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    assert.equal(await decks.count(), 1);
    assert.deepEqual(JSON.parse(await page.locator('#selection').textContent()), ['Siding', 'Decks']);
    await add.click();
    await input.fill('Fencing');
    await input.press('Escape');
    assert.equal(await input.count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Fencing', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Save subcontractor', exact: true }).click();
    assert.equal(await decks.getAttribute('aria-pressed'), 'false');
    await decks.click();
    assert.deepEqual(JSON.parse(await page.locator('#selection').textContent()), ['Decks']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: '/tmp/specialty-picker-check.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: add, empty validation, Enter safety, toggle, duplicates, Escape, save/reopen choices, and phone layout');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});