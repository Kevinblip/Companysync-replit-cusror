import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

function requireCronAuth(req) {
  const token = Deno.env.get('CRON_SECRET_TOKEN');
  if (!token) return { ok: true };
  const header = req.headers.get('Authorization');
  if (!header || header.replace('Bearer ', '') !== token) {
    return { ok: false, res: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true };
}

const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

const emailVariants = [
  (p) => ({
    subject: `${p.first}, a quick favor from ${p.company}`,
    body: `Dear ${p.first},\n\nThis is ${p.repName} with ${p.company}. Thank you for choosing us for your project. If we delivered a 5-star experience, would you mind leaving a quick Google review? It only takes a minute and really helps others find us:\n${p.link}\n\nKind regards,\n${p.repName}\n${p.company}`
  }),
  (p) => ({
    subject: `How did we do? Your feedback helps`,
    body: `Hi ${p.first},\n\nJust checking in—your feedback means a lot to our team. If you have a moment, please share a quick Google review:\n${p.link}\n\nThank you!\n${p.repName}`
  }),
  (p) => ({
    subject: `Your opinion helps homeowners like you`,
    body: `Hi ${p.first},\n\nReviews help neighbors choose the right partner. If we earned it, a short Google review would be amazing:\n${p.link}\n\nAppreciate you,\n${p.repName}`
  }),
  (p) => ({
    subject: `One last reminder—thank you!`,
    body: `Hi ${p.first},\n\nFinal nudge from ${p.repFirst} at ${p.company}. If everything looks great, would you leave us a quick review?\n${p.link}\n\nThanks again!`
  }),
  (p) => ({
    subject: `Thanks again from ${p.company}`,
    body: `Just closing the loop, ${p.first}. If you can, a brief Google review helps us continue serving customers like you:\n${p.link}\n\n— ${p.repName}`
  })
];

const smsVariants = [
  (p) => `Hi ${p.first}, this is ${p.repFirst} from ${p.company}. If we earned 5 stars, could you leave a quick Google review? ${p.link}`,
  (p) => `Thanks again, ${p.first}! A quick review helps others find us: ${p.link} — ${p.repFirst}`,
  (p) => `${p.first}, your feedback matters. Would you share a short review? ${p.link}`,
  (p) => `One last nudge—if we did great, a brief review would mean a lot: ${p.link}`,
  (p) => `Closing the loop, ${p.first}. If you have a moment, please review us: ${p.link}`
];

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

Deno.serve(async (req) => {
  try {
    const auth = requireCronAuth(req);
    if (!auth.ok) return auth.res;

    const base44 = createClientFromRequest(req);

    // Process approved requests
    const all = await base44.asServiceRole.entities.ReviewRequest.list('-updated_date', 10000);
    const now = new Date();

    let sent = 0;
    for (const rr of all) {
      if (rr.status !== 'approved') continue;
      if (rr.reply_detected) continue;
      if (!rr.next_send_at) continue;
      if (new Date(rr.next_send_at) > now) continue;
      if ((rr.total_sent_count || 0) >= 5) { // 0,3,6,9,12 days
        await base44.asServiceRole.entities.ReviewRequest.update(rr.id, { status: 'completed' });
        continue;
      }

      // Stop on customer reply since last send
      if (rr.stop_on_reply && (rr.customer_email || rr.customer_phone)) {
        const comms = await base44.asServiceRole.entities.Communication.filter({
          contact_email: rr.customer_email || undefined,
          contact_phone: rr.customer_phone || undefined,
          direction: 'inbound'
        });
        const since = rr.last_sent_at ? new Date(rr.last_sent_at) : new Date(rr.created_date);
        const hasReply = comms.some(c => new Date(c.created_date) > since);
        if (hasReply) {
          await base44.asServiceRole.entities.ReviewRequest.update(rr.id, { reply_detected: true, status: 'completed' });
          continue;
        }
      }

      // Need a link to send
      let link = rr.google_review_link || '';
      if (!link && rr.company_id) {
        // Try to fetch CompanySetting (single record) if present
        try {
          const cs = await base44.asServiceRole.entities.CompanySetting.list();
          if (cs[0]?.google_review_link) link = cs[0].google_review_link;
        } catch (e) {
          console.warn('CompanySetting not available or no google_review_link', e?.message || e);
        }
      }
      // Fallback to provided brand link if nothing is configured yet
      if (!link) {
        link = 'https://tiny.one/letsreview';
      }
      if (!link) {
        // Skip sending until link is configured
        continue;
      }

      const company = (await base44.asServiceRole.entities.Company.filter({ id: rr.company_id }))[0];
      const companyName = company?.company_name || 'our team';
      const repName = rr.sale_agent_name || rr.sale_agent_email || 'our team';
      const repFirst = String(repName).split(' ')[0] || repName;
      const first = String(rr.customer_name || '').split(' ')[0] || 'there';

      const idx = Math.min(rr.message_variant_index || 0, emailVariants.length - 1);
      const emailTpl = emailVariants[idx]({ first, repName, repFirst, company: companyName, link });
      const smsTpl = smsVariants[idx]({ first, repName, repFirst, company: companyName, link });

      // Send email if we have it with tracking
      if (rr.customer_email) {
        try {
          const trackingId = rr.id;
          const trackingPixel = `<img src="https://${req.headers.get('host')}/api/functions/trackEmailOpen?id=${trackingId}" width="1" height="1" style="display:none" />`;
          const trackedLink = `https://${req.headers.get('host')}/api/functions/trackReviewClick?id=${trackingId}&url=${encodeURIComponent(link)}`;
          
          const htmlBody = emailTpl.body.replaceAll('\n', '<br/>').replace(link, trackedLink) + trackingPixel;
          
          await base44.functions.invoke('sendUnifiedEmail', {
              to: rr.customer_email,
              subject: emailTpl.subject,
              html: htmlBody,
              companyId: rr.company_id,
              contactName: rr.customer_name,
              messageType: 'review_request',
              skipLogging: false, // Log to Communication
              skipNotification: true // Don't spam bell notifications for automated review requests
          });
        } catch (e) {
          console.error('Email send failed', e);
        }
      }

      // Send SMS via existing function
      if (rr.customer_phone) {
        try {
          await base44.asServiceRole.functions.invoke('sendSMS', {
            to: rr.customer_phone,
            message: smsTpl
          });
        } catch (e) {
          console.error('SMS send failed', e);
        }
      }

      const newCount = (rr.total_sent_count || 0) + 1;
      const nextAt = addDays(now, 3).toISOString();
      const newVariant = Math.min(idx + 1, smsVariants.length - 1);

      await base44.asServiceRole.entities.ReviewRequest.update(rr.id, {
        last_sent_at: now.toISOString(),
        next_send_at: newCount >= 5 ? null : nextAt,
        total_sent_count: newCount,
        message_variant_index: newVariant,
        send_history: [
          ...(rr.send_history || []),
          { 
            channel: rr.customer_email ? 'email' : 'sms', 
            sent_at: now.toISOString(), 
            variant: idx, 
            preview: rr.customer_email ? emailTpl.subject : smsTpl,
            delivered: false,
            opened: false,
            clicked: false
          }
        ],
        status: newCount >= 5 ? 'completed' : 'approved',
        email_delivered: false
      });
      sent++;
    }

    return Response.json({ status: 'ok', sent });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});