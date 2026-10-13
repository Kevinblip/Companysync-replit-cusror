/**
 * generateFeatureBriefPdf.cjs
 *
 * Server-side PDF generator for the CompanySync Marketing Feature Brief.
 * Uses puppeteer-core + the system Chromium (Nix store) to render
 * public/marketing-features.html with @media print CSS active, then
 * returns the PDF as a Buffer.
 *
 * Called from both vite-functions-plugin.js (dev) and prod-server.cjs (prod).
 * No auth required — the feature brief is a public marketing document.
 */

'use strict';

const fs         = require('fs');
const path       = require('path');
const puppeteer  = require('puppeteer-core');

// Chromium executable path. The Nix store path is the same one used in
// scripts/video/capture-live.cjs, test-plan-ui-gates.cjs, etc.
const NIX_CHROME = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';

function resolveChrome() {
  if (fs.existsSync(NIX_CHROME)) return NIX_CHROME;
  // Fallback: try common system paths
  for (const p of ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome']) {
    if (fs.existsSync(p)) return p;
  }
  // Last resort: shell lookup
  try {
    const { execSync } = require('child_process');
    const found = execSync('which chromium chromium-browser google-chrome 2>/dev/null | head -1', { timeout: 4000 }).toString().trim();
    if (found) return found;
  } catch (_) {}
  return null;
}

const HTML_PATH = path.join(__dirname, '..', 'public', 'marketing-features.html');

/**
 * Generate and return the feature-brief PDF as a Buffer.
 * @returns {Promise<Buffer>}
 */
async function generateFeatureBriefPdf() {
  const chromePath = resolveChrome();
  if (!chromePath) throw new Error('Chromium not found — cannot generate PDF');

  const htmlContent = fs.readFileSync(HTML_PATH, 'utf8');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    // Use print media type so @media print CSS takes effect
    await page.emulateMediaType('print');
    // setContent is preferred over page.goto for self-contained HTML
    // (no HTTP dependency, works before the server is fully listening)
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '14mm', right: '11mm', bottom: '14mm', left: '11mm' },
      printBackground: true,
      displayHeaderFooter: false,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

module.exports = { generateFeatureBriefPdf };
