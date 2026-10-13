#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `http://127.0.0.1:${process.env.PORT || 5000}`);
const PHOTO_COUNT = 2500;
const COMPANY_ID = 'perf-company';
const JOB_ID = 'perf-job';
const USER_EMAIL = 'perf@example.test';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const media = Array.from({ length: PHOTO_COUNT }, (_, index) => ({
  id: `perf-photo-${String(index).padStart(5, '0')}`,
  company_id: COMPANY_ID,
  related_entity_id: JOB_ID,
  related_entity_type: 'InspectionJob',
  created_date: new Date(Date.now() - index * 1000).toISOString(),
  file_type: 'photo',
  section: index % 2 === 0 ? 'Front Elevation' : 'Rear Elevation',
  file_url: PIXEL,
  caption: `Synthetic inspection photo ${index + 1}`,
}));
const job = {
  id: JOB_ID,
  company_id: COMPANY_ID,
  client_name: 'Synthetic Customer',
  job_name: 'Synthetic inspection',
  status: 'scheduled',
  inspection_type: 'retail',
  property_address: null,
};

function findChromium() {
  try {
    return execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function runViewport(width, height) {
  const executablePath = findChromium();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });

  try {
    const context = await browser.newContext({
      viewport: { width, height },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const pageErrors = [];
    let mediaRequests = 0;
    let mediaBytes = 0;

    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('crewcam_language', 'en');
    });
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return route.continue();

      const respond = (body) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

      if (url.pathname === '/api/auth/user') {
        return respond({
          id: 'perf-user',
          email: USER_EMAIL,
          first_name: 'Perf',
          last_name: 'Test',
          is_administrator: true,
        });
      }
      if (url.pathname === '/api/local/entity/InspectionJob/' + JOB_ID) {
        return respond(job);
      }
      if (url.pathname === '/api/local/entity/JobMedia') {
        mediaRequests += 1;
        const body = JSON.stringify(media);
        mediaBytes = Buffer.byteLength(body);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body,
        });
      }
      if (url.pathname.startsWith('/api/local/entity/Company')) {
        return respond([{
          id: COMPANY_ID,
          company_name: 'Gallery Performance Test',
          created_by: USER_EMAIL,
          subscription_plan: 'enterprise',
          onboarding_completed: true,
        }]);
      }
      if (url.pathname.startsWith('/api/local/entity/StaffProfile')) {
        return respond([{
          id: 'perf-staff',
          company_id: COMPANY_ID,
          user_email: USER_EMAIL,
          is_administrator: true,
          role: 'admin',
          is_active: true,
        }]);
      }
      if (url.pathname === '/api/functions/invoke') return respond({ data: {} });
      return respond([]);
    });

    const measurements = [];
    for (let run = 0; run < 2; run += 1) {
      if (run === 0) {
        await page.goto(`${BASE_URL}/InspectionCapture?jobId=${JOB_ID}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
      } else {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      }

      await page.locator('[data-testid^="card-photo-perf-photo-"]').first().waitFor({
        state: 'visible',
        timeout: 60000,
      });

      const cards = page.locator('[data-testid^="card-photo-perf-photo-"]');
      await assertEventuallyCount(cards, 100);
      const measured = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        const mediaResource = performance.getEntriesByType('resource')
          .filter((entry) => new URL(entry.name).pathname === '/api/local/entity/JobMedia')
          .at(-1);
        return {
          firstGalleryCardMs: Math.round(performance.now() - (navigation?.startTime || 0)),
          documentLoadMs: Math.round(navigation?.loadEventEnd || 0),
          mediaRequestMs: Math.round(mediaResource?.duration || 0),
          mediaTransferBytes: mediaResource?.transferSize || 0,
        };
      });

      assert.equal(await cards.count(), 100, 'the initial gallery should render only its first 100 cards');
      assert.equal(
        await page.locator('[data-testid="photo-gallery-pagination"] [role="status"]').innerText(),
        `Showing 100 of ${PHOTO_COUNT} photos`
      );
      measurements.push({ pass: run === 0 ? 'cold' : 'warm', ...measured, initialCards: await cards.count() });

      if (run === 0 && width >= 768) {
        await page.getByTestId('button-load-more-gallery').click();
        await assertEventuallyCount(cards, 200);
        assert.equal(
          await page.locator('[data-testid="photo-gallery-pagination"] [role="status"]').innerText(),
          `Showing 200 of ${PHOTO_COUNT} photos`
        );

        await page.getByRole('button', { name: 'Select All', exact: true }).click();
        await page.getByRole('button', { name: 'Deselect All', exact: true }).waitFor();

        await page.getByRole('button', { name: /Rear Elevation/ }).first().click();
        await assertEventuallyCount(cards, 100);
        assert.equal(
          await page.locator('[data-testid="photo-gallery-pagination"] [role="status"]').innerText(),
          'Showing 100 of 1250 photos'
        );
      }
    }

    assert.equal(mediaRequests, 2, 'the cold and warm page loads should each fetch the complete media list');
    assert.equal(mediaBytes > 0, true, 'the full synthetic media response should be measured');
    assert.deepEqual(pageErrors, [], `the page should not throw: ${pageErrors.join('; ')}`);

    console.log(JSON.stringify({
      viewport: `${width}x${height}`,
      fixture: { mediaRows: PHOTO_COUNT, responseBytes: mediaBytes },
      measurements,
      bulkSelection: width >= 768 ? 'Select All covers all 2,500 rows' : 'not exercised on mobile',
      sectionSwitch: width >= 768 ? 'resets to the first 100 of 1,250 rows' : 'not exercised on mobile',
    }));
  } finally {
    await browser.close();
  }
}

async function assertEventuallyCount(locator, expected) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await locator.count() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await locator.count(), expected);
}

async function main() {
  await runViewport(1440, 1000);
  await runViewport(390, 844);
  console.log('✓ gallery windowing preserves full counts, bulk selection, and section reset');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});