import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
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

        // Get invoice
        const invoices = await base44.asServiceRole.entities.Invoice.filter({ id: invoice_id });
        const invoice = invoices[0];

        if (!invoice) {
            return Response.json({ error: 'Invoice not found' }, { status: 404 });
        }

        // Get company for Stripe settings
        const companies = await base44.asServiceRole.entities.Company.filter({ id: invoice.company_id });
        const company = companies[0];

        if (!company) {
            return Response.json({ error: 'Company not found' }, { status: 404 });
        }

        // Initialize Stripe
        const stripeApiKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (!stripeApiKey) {
            return Response.json({ error: 'Stripe not configured' }, { status: 500 });
        }

        const stripe = new Stripe(stripeApiKey, {
            apiVersion: '2024-12-18.acacia'
        });

        // Calculate amount due
        const totalAmount = invoice.amount || 0;
        const amountPaid = invoice.amount_paid || 0;
        const amountDue = Math.max(0, totalAmount - amountPaid);

        if (amountDue <= 0) {
            return Response.json({ error: 'Invoice already paid' }, { status: 400 });
        }

        // Create Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `Invoice ${invoice.invoice_number}`,
                            description: `Payment for ${company.company_name || 'services'}`,
                        },
                        unit_amount: Math.round(amountDue * 100), // Convert to cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${new URL(req.url).origin}/customer-portal?payment=success&invoice=${invoice.invoice_number}`,
            cancel_url: `${new URL(req.url).origin}/customer-portal?payment=cancelled`,
            metadata: {
                invoice_id: invoice.id,
                invoice_number: invoice.invoice_number,
                customer_name: invoice.customer_name,
                customer_email: user.email,
                company_id: company.id
            },
            customer_email: user.email,
        });

        return Response.json({
            success: true,
            checkout_url: session.url,
            session_id: session.id
        });

    } catch (error) {
        console.error('Checkout error:', error);
        return Response.json({ 
            error: error.message,
            details: error.stack 
        }, { status: 500 });
    }
});