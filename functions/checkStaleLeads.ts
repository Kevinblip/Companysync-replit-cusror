import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    const expectedToken = Deno.env.get('CRON_SECRET_TOKEN');

    if (!expectedToken || token !== expectedToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companies = await base44.asServiceRole.entities.Company.list();
    let totalFlagged = 0;
    let totalNotified = 0;

    for (const company of companies) {
      const leads = await base44.asServiceRole.entities.Lead.filter({
        company_id: company.id,
        status: 'New',
        needs_attention: false
      });

      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      for (const lead of leads) {
        const createdAt = new Date(lead.created_at || lead.synced_at);
        if (createdAt > cutoff) continue;

        await base44.asServiceRole.entities.Lead.update(lead.id, {
          needs_attention: true
        });
        totalFlagged++;

        const recipientEmail = lead.assigned_to || company.created_by;
        if (!recipientEmail) continue;

        await base44.asServiceRole.entities.Notification.create({
          company_id: company.id,
          user_email: recipientEmail,
          title: `⚠️ Stale Lead: ${lead.name || 'Unknown Lead'}`,
          message: `Lead "${lead.name || 'Unknown'}" has been in New status for over 24 hours without action. Please follow up!`,
          type: 'stale_lead',
          related_entity_type: 'Lead',
          related_entity_id: lead.id,
          link_url: `/Leads?id=${lead.id}`,
          is_read: false
        });
        totalNotified++;
      }
    }

    return Response.json({
      success: true,
      leads_flagged: totalFlagged,
      notifications_sent: totalNotified,
      message: `Processed stale leads for ${companies.length} companies`
    });

  } catch (error) {
    console.error('Stale leads check error:', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});
