// The active CompanySync server implements a non-destructive OAuth test.
Deno.serve(() => Response.json({
  error: 'Use CompanySync’s company-scoped GoHighLevel OAuth test in Integration Settings.',
}, { status: 410 }));
