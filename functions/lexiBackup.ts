import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Lexi Backup Endpoint
// Returns a downloadable JSON containing the live source of all Lexi-related backend functions
// Reads module sources via import.meta.url so no filesystem access or extra deps are needed.

const LEXI_FILES = [
  // Core
  'lexiChat',
  'testLexiBackend',
  'lexiWorkflowAgent',
  // Utilities
  'utils/errorHandler.js',
  // Invoked helpers
  'sendEmailFromCRM',
  'sendSMS',
  'lexiDiagnostic',
  'executeWorkflow',
  'autoTriggerWorkflowsFromMutation',
  'syncCRMToGoogleCalendar',
];

// Secrets we care to snapshot presence (not values)
const SECRET_KEYS = [
  'Open_AI_Api_Key',
  'RESEND_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'ELEVENLABS_API_KEY',
  'THOUGHTLY_API_KEY',
  'GHL_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Require auth like other backend functions
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all files in parallel from module URLs
    const fetchPromises = LEXI_FILES.map(async (relPath) => {
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

    const files = await Promise.all(fetchPromises);

    // Detect presence (not values) of relevant secrets
    const secrets_present = SECRET_KEYS.filter((k) => {
      try { return !!Deno.env.get(k); } catch { return false; }
    });

    const payload = {
      type: 'lexi_backup',
      version: '1.0.0',
      generated_at: new Date().toISOString(),
      generated_by: user.email,
      notes: 'This backup includes the live source code of Lexi-related backend functions. Restore by replacing files with the contents here.',
      files,
      secrets_present,
    };

    const body = JSON.stringify(payload, null, 2);
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="lexi-backup-${new Date().toISOString().slice(0,10)}.json"`,
      'Cache-Control': 'no-store',
    });

    return new Response(body, { status: 200, headers });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});