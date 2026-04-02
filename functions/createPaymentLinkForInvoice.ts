import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { invoice_id } = await req.json();

    if (!invoice_id) {
      return Response.json({ error: 'invoice_id required' }, { status: 400 });
    }

    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      return Response.json({ error: 'Stripe not configured' }, { status: 500 });
    }

    const stripe = new Stripe(stripeSecretKey);

    // Get invoice
    const invoices = await base44.entities.Invoice.filter({ id: invoice_id });
    const invoice = invoices[0];

    if (!invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Get company
    const companies = await base44.entities.Company.filter({ id: invoice.company_id });
    const company = companies[0];

    // Check if using Stripe Connect or direct API key
    const isConnectAccount = company?.stripe_account_id;
    
    // Create checkout session config
    const sessionConfig = {
      payment_method_types: ['card', 'us_bank_account'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Invoice #${invoice.invoice_number}`,
              description: invoice.customer_name ? `Payment for ${invoice.customer_name}` : 'Invoice payment',
            },
            unit_amount: Math.round(invoice.amount * 100), // cents
          },
          quantity: 1,
        },
      ],
      success_url: `${Deno.env.get('APP_URL')}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoice_id}`,
      cancel_url: `${Deno.env.get('APP_URL')}/payment-cancel?invoice_id=${invoice_id}`,
      metadata: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        company_id: company?.id || 'unknown'
      }
    };

    // Add Connect-specific config if using Stripe Connect
    if (isConnectAccount) {
      const platformFeeAmount = Math.round(invoice.amount * 0.005 * 100); // 0.5% platform fee
      sessionConfig.payment_intent_data = {
        application_fee_amount: platformFeeAmount,
        transfer_data: {
          destination: company.stripe_account_id,
        },
      };
      sessionConfig.metadata.connected_account_id = company.stripe_account_id;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    // Update invoice with payment link
    await base44.entities.Invoice.update(invoice.id, {
      stripe_payment_link: session.url,
      stripe_session_id: session.id
    });

    console.log('✅ Created payment link for invoice:', invoice.invoice_number);
    console.log('   Mode:', isConnectAccount ? 'Stripe Connect' : 'Direct API');

    return Response.json({
      success: true,
      payment_url: session.url,
      session_id: session.id
    });

  } catch (error) {
    console.error('❌ Error creating payment link:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});