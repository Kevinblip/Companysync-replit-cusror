import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 🔒 SECURITY: Verify user has payment processing authorization
    const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
      user_email: user.email 
    });
    
    const userProfile = staffProfiles[0];
    if (!userProfile?.can_process_commission_payments && user.role !== 'admin') {
      return Response.json({ 
        error: 'Unauthorized: You do not have permission to process commission payments' 
      }, { status: 403 });
    }

    const { 
      salesRepEmail, 
      salesRepName, 
      amount, 
      payPeriod, 
      bankAccount, 
      routingNumber,
      companyId,
      payoutType = 'commission',
      payoutId = null
    } = await req.json();

    if (!salesRepEmail || !amount || !bankAccount || !routingNumber) {
      return Response.json({ 
        error: 'Missing required fields: salesRepEmail, amount, bankAccount, routingNumber' 
      }, { status: 400 });
    }

    const apiKey = Deno.env.get('ONLINECHECKWRITER_API_KEY');
    if (!apiKey) {
      return Response.json({ 
        error: 'OnlineCheckWriter API key not configured' 
      }, { status: 500 });
    }

    // Create ACH payment via OnlineCheckWriter API
    const memoText = payoutType === 'commission' 
      ? `Commission Payment - ${payPeriod}`
      : `${payoutType.replace(/_/g, ' ').charAt(0).toUpperCase() + payoutType.replace(/_/g, ' ').slice(1)} Payment`;

    const achPayload = {
      payment_type: 'ach',
      amount: amount,
      account_number: bankAccount,
      routing_number: routingNumber,
      recipient_name: salesRepName || salesRepEmail,
      recipient_email: salesRepEmail,
      memo: memoText,
      currency: 'USD'
    };

    const ochResponse = await fetch('https://api.onlinecheckwriter.com/v1/ach', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(achPayload)
    });

    if (!ochResponse.ok) {
      const errorText = await ochResponse.text();
      console.error('OnlineCheckWriter API error:', errorText);
      return Response.json({ 
        error: 'Failed to process direct deposit',
        details: errorText
      }, { status: 500 });
    }

    const achResult = await ochResponse.json();

    // Update Payout record if payoutId provided
    if (payoutId) {
      await base44.asServiceRole.entities.Payout.update(payoutId, {
        status: 'completed',
        payment_date: new Date().toISOString().split('T')[0],
        transaction_id: achResult.transaction_id || achResult.id
      });
    }

    // Create commission payment record ONLY if it's a commission type
    let commissionPayment = null;
    if (payoutType === 'commission') {
      commissionPayment = await base44.asServiceRole.entities.CommissionPayment.create({
        company_id: companyId,
        sales_rep_email: salesRepEmail,
        sales_rep_name: salesRepName,
        pay_period: payPeriod,
        net_commission: amount,
        status: 'paid',
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'direct_deposit',
        notes: `ACH via OnlineCheckWriter - Transaction ID: ${achResult.transaction_id || achResult.id}`
      });
    }

    // Send notification
    try {
      const payoutTypeName = payoutType.replace(/_/g, ' ').charAt(0).toUpperCase() + payoutType.replace(/_/g, ' ').slice(1);

      if (payoutType === 'commission') {
        await base44.asServiceRole.functions.invoke('sendCommissionNotification', {
          salesRepEmail,
          salesRepName,
          amount,
          payPeriod,
          paymentMethod: 'Direct Deposit (ACH)',
          companyId
        });
      } else {
        // Generic payout notification
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: salesRepEmail,
          from_name: 'Payment System',
          subject: `💰 ${payoutTypeName} Payment Processed`,
          body: `<h2>Payment Processed</h2>
            <p>Hi ${salesRepName},</p>
            <p>Your ${payoutTypeName.toLowerCase()} payment has been processed via direct deposit.</p>
            <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
            <p><strong>Transaction ID:</strong> ${achResult.transaction_id || achResult.id}</p>
            <p>Funds should arrive in 1-3 business days.</p>`
        });
      }
    } catch (notifError) {
      console.error('Failed to send notification:', notifError);
    }

    return Response.json({
      success: true,
      payment: commissionPayment,
      payout_id: payoutId,
      transaction: achResult,
      message: `Direct deposit of $${amount.toFixed(2)} initiated successfully`
    });

  } catch (error) {
    console.error('Error processing direct deposit:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});