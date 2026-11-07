/**
 * Draws one facet plus ridge, rake, and drip-edge lines on the manual trace
 * preview, then saves. Screenshots show per-type totals and the save result.
 *
 *   SESSION_SECRET=local-trace-preview npx vite --host 127.0.0.1 --port 5000
 *   node scripts/screenshot-manual-lines-save.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const BASE = process.env.TRACE_PREVIEW_URL || 'http://127.0.0.1:5000/manual-trace-preview.html'
const OUT = process.env.TRACE_SCREENSHOT_DIR || '/opt/cursor/artifacts'
const LAT = 41.3828633
const LNG = -81.5607747
const FEET_PER_LAT = 111320 * 3.28084
const FEET_PER_LNG = FEET_PER_LAT * Math.cos((LAT * Math.PI) / 180)

function at(eastFt, northFt) {
  return { lat: LAT + northFt / FEET_PER_LAT, lng: LNG + eastFt / FEET_PER_LNG }
}

async function clickFeet(page, eastFt, northFt) {
  const point = at(eastFt, northFt)
  const canvas = page.locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('map canvas has no box')
  const local = await page.evaluate(({ lat, lng }) => {
    const map = window.__roofMap
    return map.latLngToContainerPixel(new window.google.maps.LatLng(lat, lng))
  }, point)
  const x = box.x + local.x
  const y = box.y + local.y
  if (y < 0 || y > box.y + box.height || x < box.x || x > box.x + box.width) {
    throw new Error(`click (${x.toFixed(0)}, ${y.toFixed(0)}) is outside the map`)
  }
  await page.mouse.click(x, y)
}

async function finishLine(page, type, corners) {
  await page.getByTestId(`draw-${type}`).click()
  await page.getByTestId('btn-finish-line-drawing').waitFor()
  for (const [east, north] of corners) await clickFeet(page, east, north)
  const status = await page.getByTestId('drawing-line-status').textContent()
  if (!status.includes(`${corners.length} point`)) {
    throw new Error(`${type} status "${status}" expected ${corners.length} points`)
  }
  await page.getByTestId('btn-finish-line-drawing').click()
}

const headed = process.env.HEADED === '1'
const browser = await chromium.launch({
  headless: !headed,
  slowMo: headed ? 280 : 0,
  args: headed ? ['--window-position=40,20', '--window-size=1500,1100'] : [],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
try {
  fs.mkdirSync(OUT, { recursive: true })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__roofMap?._imagery, null, { timeout: 20000 }).catch(() => {})

  await page.getByTestId('draw-roof-outline').click()
  for (const [east, north] of [[-20, -15], [20, -15], [20, 0], [-20, 0]]) {
    await clickFeet(page, east, north)
  }
  const facetStatus = await page.getByTestId('drawing-point-count').textContent()
  if (!facetStatus.includes('4 points')) throw new Error(`facet status "${facetStatus}"`)
  await page.getByTestId('btn-finish-drawing').click()
  await page.getByTestId('facet-tab-2').waitFor()

  await finishLine(page, 'ridge', [[-10, 0], [10, 0]])
  await finishLine(page, 'rake', [[20, -15], [20, 0]])
  await finishLine(page, 'drip_edge', [[-20, -15], [20, -15]])

  const lengths = await page.getByTestId('manual-line-length').allTextContents()
  if (lengths.length !== 3) throw new Error(`expected 3 lines, got ${lengths.join(', ')}`)
  const ridgeCard = await page.getByTestId('edge-total-ridge').textContent()
  const dripCard = await page.getByTestId('edge-total-drip_edge').textContent()
  const usedLf = (text) => Number((text.match(/([\d.]+)\s*LF/) || [])[1])
  if (!/replaces/.test(ridgeCard) || Math.abs(usedLf(ridgeCard) - 20) > 0.6) {
    throw new Error(`ridge card did not use the drawn line: ${ridgeCard}`)
  }
  if (!/replaces/.test(dripCard) || Math.abs(usedLf(dripCard) - 40) > 0.6) {
    throw new Error(`drip card did not use the drawn line: ${dripCard}`)
  }

  await page.getByTestId('step-review-edges').scrollIntoViewIfNeeded()
  await page.waitForTimeout(headed ? 900 : 300)
  if (!headed) {
    const linesPath = path.join(OUT, 'manual-trace-lines.png')
    await page.getByTestId('step-review-edges').screenshot({ path: linesPath })
    console.log('saved', linesPath)
  }

  await page.getByTestId('check-pitch-confirmed').click()
  await page.getByTestId('save-measurements').click()
  await page.getByTestId('save-success').waitFor()
  const saved = await page.getByTestId('save-success').textContent()
  const savedNumber = (label) => Number((saved.match(new RegExp(`${label}\\s+([\\d.]+)`)) || [])[1])
  if (!/Measurements saved/.test(saved)
    || Math.abs(savedNumber('Ridge') - 20) > 0.6
    || Math.abs(savedNumber('Drip edge') - 40) > 0.6) {
    throw new Error(`save banner missing totals: ${saved}`)
  }
  await page.getByTestId('save-success').scrollIntoViewIfNeeded()
  await page.waitForTimeout(headed ? 1200 : 200)
  if (!headed) {
    const savePath = path.join(OUT, 'manual-trace-save.png')
    await page.getByTestId('save-success').screenshot({ path: savePath })
    console.log('saved', savePath)
  }
} finally {
  await browser.close()
}
