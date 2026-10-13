// Legacy global-key endpoint is retired; never import one subscriber's contacts
// into another subscriber's company through a platform-wide credential.
Deno.serve(() => Response.json({
  error: 'Use CompanySync’s company-scoped GoHighLevel OAuth scheduler.',
}, { status: 410 }));
