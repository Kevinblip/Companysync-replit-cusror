#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = path.join(__dirname, '..');
  const serverSource = fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(root, 'src/pages/AIEstimator.jsx'), 'utf8');
  const viewerSource = fs.readFileSync(path.join(root, 'src/components/estimator/HouseModel3D.jsx'), 'utf8');
  const { generateEstimateHTML } = await import(path.join(root, 'src/utils/generateEstimateHTML.js'));
  const { generateMeasurementReportHTML } = await import(path.join(root, 'src/utils/generateMeasurementReportHTML.js'));

  assert.match(serverSource, /functionHandlers\.generateHousePresentation\s*=/, 'server handler is registered');
  assert.match(serverSource, /await checkAIUsage\(companyId\)/, 'platform-key generation uses the AI circuit breaker');
  assert.match(serverSource, /logUsageEvent\(companyId,\s*isOwn \? 'ai_byok' : 'ai_estimator'/, 'successful generation is metered');
  assert.match(serverSource, /Illustration — not a measurement document/, 'stored image receives the required watermark');
  assert.match(serverSource, /returnRaw:\s*true/, 'presentation generation avoids storing an unwatermarked intermediate');
  assert.match(serverSource, /nodeRequire\('@napi-rs\/canvas'\)/, 'ES module uses the configured CommonJS bridge for image processing');
  assert.match(viewerSource, /data-testid="button-generate-presentation-render"/, '3D viewer exposes the presentation action');
  assert.match(viewerSource, /preserveDrawingBuffer:true/, '3D canvas can be captured reliably');

  const renderUrl = 'https://example.test/presentation.jpg';
  const estimateHtml = generateEstimateHTML({
    customerInfo: {},
    lineItems: [],
    descriptions: [],
    satelliteAnalysis: {},
    satelliteAddress: {},
    companyName: 'Test Co',
    companyLogoUrl: '',
    estimateNumber: 'TEST',
    presentationRenderUrl: renderUrl,
  });
  assert.match(estimateHtml, /Presentation Illustration/, 'estimate export includes the presentation section');
  assert.match(estimateHtml, /Illustration — not a measurement document/, 'estimate export keeps the disclaimer');
  assert.match(estimateHtml, /https:\/\/example\.test\/presentation\.jpg/, 'estimate export embeds the render URL');

  const measurementHtml = generateMeasurementReportHTML({
    satelliteAnalysis: {},
    satelliteAddress: {},
    companyName: 'Test Co',
    presentationRenderUrl: renderUrl,
  });
  assert.match(measurementHtml, /Presentation Illustration/, 'measurement report includes the optional presentation section');
  assert.match(measurementHtml, /Illustration — not a measurement document/, 'measurement report keeps the disclaimer');

  assert.match(pageSource, /base44\.entities\.Document\.create\(\{[\s\S]*?tags:\s*\['presentation-render', 'illustration', 'not-measurement'\]/, 'render is persisted as a separate Document');
  assert.match(pageSource, /base44\.entities\.Document\.filter\(\{[\s\S]*?related_project:\s*editEstimateIdFromUrl/, 'saved render is restored when an estimate is reopened');
  assert.doesNotMatch(pageSource, /roof_measurements:\s*\{[\s\S]{0,1500}presentationRender/, 'render is not stored inside roof measurements');
  assert.doesNotMatch(pageSource, /siding_measurements:\s*\{[\s\S]{0,2000}presentationRender/, 'render is not stored inside siding measurements');

  console.log('✓ Presentation render handler, metering, watermark, document separation, and exports verified');
})().catch((err) => {
  console.error('✗ Presentation render test failed:', err.message);
  process.exit(1);
});