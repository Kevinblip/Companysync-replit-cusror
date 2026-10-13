// Legacy Base44 endpoint. CompanySync's dev/prod server handler of this name
// owns company-scoped OAuth; this endpoint must never substitute a shared key.
Deno.serve(() => Response.json({
  error: 'Use CompanySync’s company-scoped GoHighLevel OAuth sync in Integration Settings.',
}, { status: 410 }));
