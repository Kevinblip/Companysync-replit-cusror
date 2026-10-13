import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// AI Estimator Backup Endpoint
// Returns a downloadable JSON containing the live source of AI Estimator–related backend functions
// Uses module-relative fetch (import.meta.url) and does NOT include env secret values.

const ESTIMATOR_FILES = [
  // Core Estimator extractors/AI
  'extractEstimateWithClaude',
  'extractEstimateGPT4o',
  'readPDFWithClaude',
  'testExtractEstimate',
  'chatGPT4o',
  'analyzeEstimateCompleteness',

  // Materials/Export/Measurement
  'generateMaterialList',
  'exportMaterialListExcel',
  'exportToXactimate',
  'aiRoofMeasurement',
  'analyzeRoofWithGoogleSolar',

  // PDFs / Reports
  'generateEstimatePDF',
  'generateAdjusterReport',

  // Pricing imports/classification
  'importSymbilityPricing',
  'categorizePriceListItems',

  // (Optionally used by estimator flows)
  'convertEstimateToInvoice',

  // Utilities shared
  'utils/errorHandler.js',
];

const SECRET_KEYS = [
  'Open_AI_Api_Key',
  'RESEND_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_MAPS_API_KEY',
  'ANTHROPIC_API_KEY',
  'HEYGEN_API_KEY',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch each function module content in parallel
    const fetches = ESTIMATOR_FILES.map(async (relPath) => {
      try {
        const url = new URL(`./${relPath}`, import.meta.url);
        const res = await fetch(url);
        if (!res.ok) {
          return { path: `functions/${relPath}`, error: `HTTP ${res.status}` };
        }
        const content = await res.text();
        return { path: `functions/${relPath}`, content };
      } catch (e) {
        return { path: `functions/${relPath}`, error: e?.message || 'Fetch error' };
      }
    });

    const files = await Promise.all(fetches);

    const secrets_present = SECRET_KEYS.filter((k) => {
      try { return !!Deno.env.get(k); } catch { return false; }
    });

    const payload = {
      type: 'ai_estimator_backup',
      version: '1.0.0',
      generated_at: new Date().toISOString(),
      generated_by: user.email,
      notes: 'Includes live source of AI Estimator backend functions for restore. Replace files by path shown here. Env secrets are not included.',
      files,
      secrets_present,
    };

    const body = JSON.stringify(payload, null, 2);
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="ai-estimator-backup-${new Date().toISOString().slice(0,10)}.json"`,
      'Cache-Control': 'no-store',
    });

    return new Response(body, { status: 200, headers });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});