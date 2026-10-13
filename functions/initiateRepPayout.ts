import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { invoiceId, splitIndex, amount, repStaffProfileId, companyId } = body || {};

    if (!invoiceId || splitIndex === undefined || !amount || !repStaffProfileId || !companyId) {
      return Response.json({ error: 'invoiceId, splitIndex, amount, repStaffProfileId, and companyId are required' }, { status: 400 });
    }
    if (amount <= 0) return Response.json({ error: 'Amount must be greater than 0' }, { status: 400 });

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') ||
                     Deno.env.get('STRIPE_API_KEY') ||
                     Deno.env.get('Stripe_API_KEY') ||
                     Deno.env.get('Stripe_Secret_Key');
    if (!stripeKey) return Response.json({ error: 'Stripe not configured' }, { status: 500 });

    const stripe = new Stripe(stripeKey);

    // Verify caller is admin of this company
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    if (!company) return Response.json({ error: 'Company not found' }, { status: 404 });

    const callerProfiles = await base44.entities.StaffProfile.filter({ company_id: companyId, user_email: user.email });
    const callerProfile = callerProfiles[0];
    const isOwner = company.created_by === user.email;
    const isAdmin = isOwner || callerProfile?.is_administrator === true || callerProfile?.role === 'admin';
    if (!isAdmin) return Response.json({ error: 'Admin access required' }, { status: 403 });

    // Load rep profile
    const repProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ id: repStaffProfileId });
    const repProfile = repProfiles[0];
    if (!repProfile || repProfile.company_id !== companyId) {
      return Response.json({ error: 'Rep not found or belongs to a different company' }, { status: 404 });
    }

    const repAccountId = repProfile.data?.stripe_express_account_id;
    if (!repAccountId) {
      return Response.json({ error: 'This rep has not set up their bank account yet. Send them an invite from Settings → Rep Payouts.' }, { status: 400 });
    }

    // Verify the rep's account can receive payouts
    const repAccount = await stripe.accounts.retrieve(repAccountId);
    if (!repAccount.payouts_enabled) {
      return Response.json({
        error: 'This rep\'s bank account is not fully verified yet. Ask them to complete their Stripe setup.',
        onboarding_incomplete: true,
      }, { status: 400 });
    }

    // Load invoice
    const invoices = await base44.asServiceRole.entities.Invoice.filter({ id: invoiceId });
    const invoice = invoices[0];
    if (!invoice || invoice.company_id !== companyId) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const splits = invoice.commission_splits || [];
    const split = splits[splitIndex];
    if (!split) return Response.json({ error: 'Commission split not found' }, { status: 404 });
    if (split.paid) return Response.json({ error: 'This commission has already been paid' }, { status: 400 });

    const amountCents = Math.round(amount * 100);

    // Create Stripe Transfer from platform to rep's express account
    let transfer;
    try {
      transfer = await stripe.transfers.create({
        amount: amountCents,
        currency: 'usd',
        destination: repAccountId,
        description: `Commission payout to ${split.user_name} for Invoice ${invoice.invoice_number || invoiceId}`,
        metadata: {
          invoice_id: invoiceId,
          invoice_number: invoice.invoice_number || '',
          company_id: companyId,
          rep_staff_profile_id: repStaffProfileId,
          split_index: String(splitIndex),
        },
      });
    } catch (stripeErr) {
      console.error('❌ Stripe transfer failed:', stripeErr.message);
      if (stripeErr.code === 'insufficient_funds') {
        return Response.json({
          error: 'Insufficient funds in your CompanySync payout account. Funds must be available from Stripe payments you\'ve collected. Contact support if you need to add funds manually.',
          insufficient_funds: true,
        }, { status: 400 });
      }
      return Response.json({ error: `Transfer failed: ${stripeErr.message}` }, { status: 400 });
    }

    // Trigger a payout from the rep's account to their bank
    try {
      await stripe.payouts.create(
        { amount: amountCents, currency: 'usd', method: 'standard' },
        { stripeAccount: repAccountId }
      );
    } catch (payoutErr) {
      console.warn('⚠️ Payout to bank could not be initiated immediately (manual payout schedule):', payoutErr.message);
    }

    // Mark the commission split as paid in the invoice
    const updatedSplits = [...splits];
    updatedSplits[splitIndex] = {
      ...updatedSplits[splitIndex],
      paid: true,
      paid_date: new Date().toISOString().slice(0, 10),
      paid_amount: amount,
      paid_via: 'ach',
      stripe_transfer_id: transfer.id,
    };
    await base44.asServiceRole.entities.Invoice.update(invoiceId, { commission_splits: updatedSplits });

    // Log an expense for the payout
    try {
      const today = new Date().toISOString().slice(0, 10);
      await base44.asServiceRole.entities.Expense.create({
        company_id: companyId,
        expense_date: today,
        vendor_name: split.user_name,
        category: 'commission',
        amount: amount,
        description: `ACH commission payout to ${split.user_name} (${split.split_percentage}%) — Invoice ${invoice.invoice_number || invoiceId}`,
        payment_method: 'ach',
        reference_number: transfer.id,
        customer_id: invoice.customer_id || '',
        tax_deductible: true,
        status: 'paid',
      });
    } catch (expenseErr) {
      console.warn('⚠️ Could not create expense entry:', expenseErr.message);
    }

    return Response.json({
      success: true,
      transfer_id: transfer.id,
      amount,
      rep_name: split.user_name,
      message: `$${amount.toFixed(2)} sent to ${split.user_name} via ACH. They will receive it within 1–5 business days.`,
    });

  } catch (error) {
    console.error('❌ initiateRepPayout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
