import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

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
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { testMode, reviewRequestId } = body;

    // Process approved requests
    let all;
    if (reviewRequestId) {
      // Process a specific review request
      all = await base44.asServiceRole.entities.ReviewRequest.filter({ id: reviewRequestId });
    } else {
      all = await base44.asServiceRole.entities.ReviewRequest.list('-updated_date', 10000);
    }
    
    const now = new Date();
    const logs = [];

    let sent = 0;
    for (const rr of all) {
      logs.push(`Processing ReviewRequest ${rr.id}: status=${rr.status}, next_send_at=${rr.next_send_at}, total_sent=${rr.total_sent_count}`);
      
      if (rr.status !== 'approved') {
        logs.push(`  SKIP: status is not 'approved'`);
        continue;
      }
      if (rr.reply_detected) {
        logs.push(`  SKIP: reply_detected is true`);
        continue;
      }
      if (!rr.next_send_at && !testMode) {
        logs.push(`  SKIP: no next_send_at set`);
        continue;
      }
      if (!testMode && new Date(rr.next_send_at) > now) {
        logs.push(`  SKIP: next_send_at (${rr.next_send_at}) is in the future`);
        continue;
      }
      if ((rr.total_sent_count || 0) >= 5) {
        logs.push(`  SKIP: already sent 5 times, marking completed`);
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
          logs.push(`  SKIP: customer replied since last send`);
          await base44.asServiceRole.entities.ReviewRequest.update(rr.id, { reply_detected: true, status: 'completed' });
          continue;
        }
      }

      // Need a link to send
      let link = rr.google_review_link || '';
      if (!link && rr.company_id) {
        try {
          const cs = await base44.asServiceRole.entities.CompanySetting.list();
          if (cs[0]?.google_review_link) link = cs[0].google_review_link;
        } catch (e) {
          logs.push(`  WARN: CompanySetting not available: ${e?.message}`);
        }
      }
      if (!link) {
        link = 'https://tiny.one/letsreview';
      }
      logs.push(`  Using review link: ${link}`);

      const company = (await base44.asServiceRole.entities.Company.filter({ id: rr.company_id }))[0];
      const companyName = company?.company_name || 'our team';
      const repName = rr.sale_agent_name || rr.sale_agent_email || 'our team';
      const repFirst = String(repName).split(' ')[0] || repName;
      const first = String(rr.customer_name || '').split(' ')[0] || 'there';

      const idx = Math.min(rr.message_variant_index || 0, emailVariants.length - 1);
      const emailTpl = emailVariants[idx]({ first, repName, repFirst, company: companyName, link });
      const smsTpl = smsVariants[idx]({ first, repName, repFirst, company: companyName, link });

      logs.push(`  Customer: ${rr.customer_name}, Email: ${rr.customer_email}, Phone: ${rr.customer_phone}`);
      logs.push(`  Email subject: ${emailTpl.subject}`);
      logs.push(`  SMS: ${smsTpl}`);

      // Send email if we have it with tracking
      if (rr.customer_email) {
        try {
          const trackingId = rr.id;
          const host = req.headers.get('host') || 'getcompanysync.com';
          const trackingPixel = `<img src="https://${host}/api/functions/trackEmailOpen?id=${trackingId}" width="1" height="1" style="display:none" />`;
          const trackedLink = `https://${host}/api/functions/trackReviewClick?id=${trackingId}&url=${encodeURIComponent(link)}`;
          
          const htmlBody = emailTpl.body.replaceAll('\n', '<br/>').replace(link, trackedLink) + trackingPixel;
          
          if (testMode) {
            logs.push(`  TEST MODE: Would send email to ${rr.customer_email}`);
          } else {
            await base44.functions.invoke('sendUnifiedEmail', {
                to: rr.customer_email,
                subject: emailTpl.subject,
                html: htmlBody,
                companyId: rr.company_id,
                contactName: rr.customer_name,
                messageType: 'review_request',
                skipLogging: false,
                skipNotification: true
            });
            logs.push(`  EMAIL SENT to ${rr.customer_email}`);
          }
        } catch (e) {
          logs.push(`  EMAIL ERROR: ${e.message}`);
        }
      }

      // Send SMS via existing function
      if (rr.customer_phone) {
        try {
          if (testMode) {
            logs.push(`  TEST MODE: Would send SMS to ${rr.customer_phone}`);
          } else {
            await base44.asServiceRole.functions.invoke('sendSMS', {
              to: rr.customer_phone,
              message: smsTpl
            });
            logs.push(`  SMS SENT to ${rr.customer_phone}`);
          }
        } catch (e) {
          logs.push(`  SMS ERROR: ${e.message}`);
        }
      }

      if (!testMode) {
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
        logs.push(`  UPDATED: total_sent_count=${newCount}, next_send_at=${newCount >= 5 ? 'null' : nextAt}`);
      }
      
      sent++;
    }

    return Response.json({ status: 'ok', sent, testMode: !!testMode, logs });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});