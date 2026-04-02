import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Permission check (admin or can_process_commission_payments)
    const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
    const userProfile = staffProfiles[0];
    if (user.role !== 'admin' && !userProfile?.can_process_commission_payments) {
      return Response.json({ error: 'Forbidden: You do not have permission to process payouts' }, { status: 403 });
    }

    const {
      salesRepEmail,
      salesRepName,
      amount,
      bankAccount,
      routingNumber,
      companyId,
      payoutType = 'commission',
      payoutId = null,
      payPeriod = new Date().toISOString().slice(0, 7),
    } = await req.json();

    if (!amount || !bankAccount || !routingNumber) {
      return Response.json({
        error: 'Missing required fields: amount, bankAccount, routingNumber',
      }, { status: 400 });
    }

    const wiseApiKey = Deno.env.get('WISE_API_KEY');
    const wiseProfileId = Deno.env.get('WISE_PROFILE_ID');
    if (!wiseApiKey || !wiseProfileId) {
      return Response.json({ error: 'Wise API credentials not configured' }, { status: 500 });
    }

    const headers = {
      'Authorization': `Bearer ${wiseApiKey}`,
      'Content-Type': 'application/json',
    };

    // 1) Create quote (USD -> USD)
    const quoteRes = await fetch('https://api.transferwise.com/v1/quotes', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        profile: Number(wiseProfileId),
        sourceCurrency: 'USD',
        targetCurrency: 'USD',
        sourceAmount: Number(amount),
      }),
    });
    if (!quoteRes.ok) {
      const err = await quoteRes.text();
      console.error('Wise quote error:', err);
      return Response.json({ error: 'Failed to create Wise quote', details: err }, { status: 500 });
    }
    const quote = await quoteRes.json();

    // 2) Create recipient account (ABA)
    const recipientRes = await fetch('https://api.transferwise.com/v1/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        profile: Number(wiseProfileId),
        accountHolderName: salesRepName || salesRepEmail,
        currency: 'USD',
        type: 'aba',
        details: {
          legalType: 'PRIVATE',
          abartn: routingNumber,
          accountNumber: bankAccount,
        },
      }),
    });
    if (!recipientRes.ok) {
      const err = await recipientRes.text();
      console.error('Wise recipient error:', err);
      return Response.json({ error: 'Failed to create Wise recipient', details: err }, { status: 500 });
    }
    const recipient = await recipientRes.json();

    // 3) Create transfer
    const transferRes = await fetch('https://api.transferwise.com/v1/transfers', {
      method: 'POST',
      headers: { ...headers, 'X-idempotence-uuid': crypto.randomUUID() },
      body: JSON.stringify({
        targetAccount: recipient.id,
        quoteUuid: quote.id || quote.quoteUuid,
        customerTransactionId: crypto.randomUUID(),
        details: {
          reference: `Payout - ${payoutType}`,
          transferPurpose: 'verification.transfers.purpose.payroll',
        },
      }),
    });
    if (!transferRes.ok) {
      const err = await transferRes.text();
      console.error('Wise transfer error:', err);
      return Response.json({ error: 'Failed to create Wise transfer', details: err }, { status: 500 });
    }
    const transfer = await transferRes.json();

    // 4) Fund transfer from balance
    const fundRes = await fetch(`https://api.transferwise.com/v3/profiles/${wiseProfileId}/transfers/${transfer.id}/payments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'BALANCE' }),
    });
    if (!fundRes.ok) {
      const err = await fundRes.text();
      console.error('Wise fund error:', err);
      return Response.json({ error: 'Failed to fund Wise transfer', details: err, transfer }, { status: 500 });
    }
    const payment = await fundRes.json();

    // Update payout record if provided
    if (payoutId) {
      await base44.asServiceRole.entities.Payout.update(payoutId, {
        status: 'completed',
        payment_date: new Date().toISOString().split('T')[0],
        transaction_id: transfer.id,
      });
    }

    try {
      // Optional: notify recipient via email
      if (salesRepEmail) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: salesRepEmail,
          subject: 'Payment Processed via Wise',
          body: `Your payout of $${Number(amount).toFixed(2)} has been initiated via Wise. Reference: ${transfer.id}`,
        });
      }
    } catch (_) {}

    return Response.json({
      success: true,
      transaction: { ...transfer, payment },
      payout_id: payoutId,
      message: `Wise transfer of $${Number(amount).toFixed(2)} initiated successfully`,
    });
  } catch (error) {
    console.error('processWisePayout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});