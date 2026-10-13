// Legacy Base44 endpoint; the active server uses encrypted company OAuth tokens.
Deno.serve(() => Response.json({
  error: 'Use CompanySync’s company-scoped GoHighLevel OAuth integration.',
}, { status: 410 }));
