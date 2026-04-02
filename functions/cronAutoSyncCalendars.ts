// Cron job wrapper for automatic calendar sync
// Configure in your cron service to run every 15 minutes:
// */15 * * * * curl -X POST https://getcompanysync.com/api/functions/cronAutoSyncCalendars -H "Authorization: Bearer YOUR_CRON_SECRET"

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  // Invoke the main auto-sync function
  const result = await base44.asServiceRole.functions.invoke('autoSyncAllCalendars', {});
  
  return Response.json(result.data);
});