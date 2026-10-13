import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { sendEmail } from './_sendEmail.ts';
import { sendSMSInternal } from './utils/smsSender.ts';

Deno.serve(async (req) => {
  console.log('💰 ========== NOTIFY COMMISSION EARNED STARTED ==========');

  try {
    const base44 = createClientFromRequest(req);

    // — Auth: caller must be an authenticated member of the companyId —
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { invoiceId, paymentId, paymentAmount, companyId } = body;

    if (!invoiceId || !companyId || !paymentAmount) {
      return Response.json({ error: 'invoiceId, companyId, and paymentAmount are required' }, { status: 400 });
    }

    // Verify caller belongs to this company (either as owner or staff member)
    const [callerCompanies, callerStaff] = await Promise.all([
      base44.asServiceRole.entities.Company.filter({ id: companyId, created_by: user.email }),
      base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId, user_email: user.email }),
    ]);
    if (callerCompanies.length === 0 && callerStaff.length === 0) {
      return Response.json({ error: 'Forbidden: caller is not a member of this company' }, { status: 403 });
    }

    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      return Response.json({ error: 'paymentAmount must be a positive number' }, { status: 400 });
    }

    // Load invoice, company, and staff profiles in parallel
    const [invoices, companies, staffProfiles] = await Promise.all([
      base44.asServiceRole.entities.Invoice.filter({ id: invoiceId }),
      base44.asServiceRole.entities.Company.filter({ id: companyId }),
      base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId }),
    ]);

    const invoice = invoices[0];
    if (!invoice) return Response.json({ error: 'Invoice not found' }, { status: 404 });
    const company = companies[0];

    // Build list of reps who earn commission on this payment
    const reps: Array<{
      email: string;
      name: string;
      phone: string;
      commissionRate: number;
      splitPct: number | null;
      role: string;
      dollarAmount: number;
      notifyEmail: boolean;
      notifySms: boolean;
      notifyBell: boolean;
    }> = [];

    const addRep = (email: string, splitPct: number | null, role: string) => {
      if (!email || reps.some(r => r.email === email)) return;
      const staff = staffProfiles.find((s) => s.user_email === email);
      if (!staff) return;
      const commissionRate = staff.commission_rate || 10;
      const rawCommission = amount * (commissionRate / 100);
      const dollarAmount = splitPct != null ? rawCommission * (splitPct / 100) : rawCommission;
      if (dollarAmount <= 0) return;
      reps.push({
        email,
        name: staff.full_name || email,
        phone: staff.cell_phone || staff.phone || '',
        commissionRate,
        splitPct,
        role,
        dollarAmount,
        notifyEmail: staff.commission_notify_email !== false,
        notifySms: staff.commission_notify_sms !== false,
        notifyBell: staff.commission_notify_bell !== false,
      });
    };

    // Primary sale agent
    if (invoice.sale_agent) {
      if (invoice.commission_splits && invoice.commission_splits.length > 0) {
        const split = invoice.commission_splits.find((s: any) => s.user_email === invoice.sale_agent);
        addRep(invoice.sale_agent, split ? split.split_percentage : null, split?.role || 'Sales Rep');
      } else {
        addRep(invoice.sale_agent, null, 'Sales Rep');
      }
    }

    // Commission splits
    if (invoice.commission_splits && invoice.commission_splits.length > 0) {
      for (const cs of invoice.commission_splits) {
        addRep(cs.user_email, cs.split_percentage, cs.role || 'Sales Rep');
      }
    }

    if (reps.length === 0) {
      console.log('[CommissionEarned] No reps with commission found for invoice', invoiceId);
      return Response.json({ success: true, message: 'No commission recipients found', notified: 0 });
    }

    // — Idempotency: load already-sent markers for this paymentId —
    const sentKey = paymentId || `${invoiceId}:${paymentAmount}`;
    const existingSent = paymentId
      ? await base44.asServiceRole.entities.CommissionAlertSent.filter({ payment_id: paymentId, company_id: companyId })
      : [];
    const alreadySentEmails = new Set(existingSent.map((s: any) => s.rep_email));

    // Email setup

    const companyName = company?.company_name || 'Your Company';
    const fromEmail = `${companyName} <noreply@companysync.io>`;

    // Build split table rows (only when splits exist)
    const hasSplits = reps.filter(r => r.splitPct != null).length > 1;
    const splitTableRows = hasSplits
      ? reps.map(r => `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${r.name}</td><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">${r.splitPct ?? 100}%</td><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:bold;color:#8b5cf6;">$${r.dollarAmount.toFixed(2)}</td><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${r.role}</td></tr>`).join('')
      : '';

    let successCount = 0;
    let skippedCount = 0;
    let smsCount = 0;
    const errors: string[] = [];

    for (const rep of reps) {
      // Idempotency check — skip if this (paymentId, repEmail) was already sent
      if (alreadySentEmails.has(rep.email)) {
        console.log(`[CommissionEarned] Skipping ${rep.email} — already notified for payment ${sentKey}`);
        skippedCount++;
        continue;
      }

      try {
        // — Email —
        if (rep.notifyEmail && rep.email) {
          const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;}
  .header{background:linear-gradient(135deg,#8b5cf6 0%,#3b82f6 100%);color:white;padding:30px;text-align:center;border-radius:10px 10px 0 0;}
  .content{background:white;padding:30px;border:1px solid #e5e7eb;}
  .amount-box{background:#f3e8ff;border-left:4px solid #8b5cf6;padding:20px;margin:20px 0;border-radius:6px;text-align:center;}
  .big-amount{font-size:40px;font-weight:bold;color:#7c3aed;line-height:1;}
  .detail-table{width:100%;border-collapse:collapse;margin:20px 0;}
  .detail-table th{background:#f3f4f6;padding:8px 10px;text-align:left;font-size:13px;color:#374151;}
  .detail-table td{padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;}
  .footer{background:#f9fafb;padding:20px;text-align:center;color:#6b7280;font-size:12px;border-radius:0 0 10px 10px;border:1px solid #e5e7eb;border-top:none;}
</style>
</head>
<body>
  <div class="header">
    ${company?.logo_url ? `<img src="${company.logo_url}" alt="${companyName}" style="max-width:120px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">` : ''}
    <h1 style="margin:0;font-size:24px;">💰 Commission Earned!</h1>
  </div>
  <div class="content">
    <p>Hi <strong>${rep.name}</strong>,</p>
    <p>Great news — a payment just came in on one of your jobs. Here's your commission breakdown:</p>
    <div class="amount-box">
      <div style="color:#6b7280;font-size:13px;margin-bottom:4px;">Your Commission</div>
      <div class="big-amount">$${rep.dollarAmount.toFixed(2)}</div>
      ${rep.splitPct != null ? `<div style="color:#8b5cf6;font-size:13px;margin-top:6px;">${rep.splitPct}% split · ${rep.role}</div>` : `<div style="color:#8b5cf6;font-size:13px;margin-top:6px;">${rep.commissionRate}% commission rate</div>`}
    </div>
    <h3 style="margin:20px 0 8px;color:#111827;">Payment Details</h3>
    <table class="detail-table">
      <tr><th>Customer</th><td>${invoice.customer_name || '—'}</td></tr>
      <tr><th>Invoice #</th><td>${invoice.invoice_number || '—'}</td></tr>
      <tr><th>Payment Received</th><td><strong>$${amount.toFixed(2)}</strong></td></tr>
      <tr><th>Your Rate</th><td>${rep.commissionRate}%</td></tr>
      ${rep.splitPct != null ? `<tr><th>Your Split</th><td>${rep.splitPct}%</td></tr>` : ''}
      ${invoice.claim_number ? `<tr><th>Claim #</th><td>${invoice.claim_number}</td></tr>` : ''}
    </table>
    ${hasSplits ? `
    <h3 style="margin:20px 0 8px;color:#111827;">All Commission Splits</h3>
    <table class="detail-table"><thead><tr><th>Rep</th><th style="text-align:center;">Split %</th><th style="text-align:right;">Amount</th><th>Role</th></tr></thead>
    <tbody>${splitTableRows}</tbody></table>` : ''}
    <p style="margin-top:24px;color:#6b7280;font-size:13px;">
      View your full commission report in the CRM → <strong>Commissions</strong> section.
    </p>
  </div>
  <div class="footer">
    <strong>${companyName}</strong>
    ${company?.phone ? `<br>📞 ${company.phone}` : ''}
    ${company?.email ? `<br>📧 ${company.email}` : ''}
  </div>
</body>
</html>`;

          await sendEmail({
            from: fromEmail,
            to: rep.email,
            subject: `💰 Commission Earned: $${rep.dollarAmount.toFixed(2)} — ${invoice.customer_name || invoice.invoice_number}`,
            html,
          });
          console.log(`[CommissionEarned] Email sent to ${rep.email}`);
        }

        // — Bell notification —
        if (rep.notifyBell) {
          await base44.asServiceRole.entities.Notification.create({
            company_id: companyId,
            user_email: rep.email,
            title: `💰 Commission Earned: $${rep.dollarAmount.toFixed(2)}`,
            message: `Payment of $${amount.toFixed(2)} received on ${invoice.customer_name || invoice.invoice_number}. Your commission: $${rep.dollarAmount.toFixed(2)}${rep.splitPct != null ? ` (${rep.splitPct}% split)` : ''}.`,
            type: 'commission_earned',
            related_entity_type: 'Invoice',
            related_entity_id: invoice.id,
            link_url: '/commission-report',
            is_read: false,
          });
        }

        // — SMS (only if phone on file and opted in) —
        if (rep.notifySms && rep.phone) {
          try {
            const smsBody = `\u{1F4B0} Commission alert: $${rep.dollarAmount.toFixed(2)} earned \u2014 ${invoice.customer_name || 'job'} (Invoice ${invoice.invoice_number}). View in your CRM.`;
            await sendSMSInternal(base44, {
              to: rep.phone,
              body: smsBody,
              companyId,
              contactName: rep.name,
              userEmail: rep.email,
            });
            smsCount++;
            console.log(`[CommissionEarned] SMS sent to ${rep.phone} (${rep.name})`);
          } catch (smsErr: any) {
            console.warn(`[CommissionEarned] SMS failed for ${rep.name}:`, smsErr.message);
          }
        }

        // — Persist idempotency marker —
        if (paymentId) {
          try {
            await base44.asServiceRole.entities.CommissionAlertSent.create({
              company_id: companyId,
              payment_id: paymentId,
              invoice_id: invoiceId,
              rep_email: rep.email,
              amount_notified: rep.dollarAmount,
              sent_at: new Date().toISOString(),
            });
          } catch (markerErr: any) {
            console.warn('[CommissionEarned] Could not save sent marker:', markerErr.message);
          }
        }

        successCount++;
      } catch (repErr: any) {
        console.error(`[CommissionEarned] Failed for ${rep.email}:`, repErr.message);
        errors.push(`${rep.email}: ${repErr.message}`);
      }
    }

    console.log(`[CommissionEarned] Done — ${successCount} notified, ${skippedCount} skipped (already sent), ${smsCount} SMS sent`);
    return Response.json({
      success: true,
      notified: successCount,
      skipped: skippedCount,
      smsSent: smsCount,
      reps: reps.map(r => ({ name: r.name, email: r.email, dollarAmount: r.dollarAmount })),
      errors: errors.length ? errors : undefined,
    });

  } catch (err: any) {
    console.error('[CommissionEarned] Fatal error:', err.message, err.stack);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});
