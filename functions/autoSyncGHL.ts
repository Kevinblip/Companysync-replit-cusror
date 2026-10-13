// Legacy global-key scheduler is retired. The active server cron is company-scoped.
Deno.serve(() => Response.json({
  error: 'Use CompanySync’s company-scoped GoHighLevel OAuth scheduler.',
}, { status: 410 }));
