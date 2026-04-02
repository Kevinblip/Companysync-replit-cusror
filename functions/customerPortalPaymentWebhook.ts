import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import Stripe from 'npm:stripe@17.5.0';

Deno.serve(async (req) => {
    try {
        const signature = req.headers.get('stripe-signature');
        
        if (!signature) {
            return Response.json({ error: 'No signature' }, { status: 400 });
        }

        const stripeApiKey = Deno.env.get("STRIPE_SECRET_KEY");
        const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

        if (!stripeApiKey || !webhookSecret) {
            return Response.json({ error: 'Stripe not configured' }, { status: 500 });
        }

        const base44 = createClientFromRequest(req);
        const stripe = new Stripe(stripeApiKey, {
            apiVersion: '2024-12-18.acacia'
        });

        const body = await req.text();
        
        // Verify webhook signature
        const event = await stripe.webhooks.constructEventAsync(
            body,
            signature,
            webhookSecret
        );

        console.log('📨 Webhook event:', event.type);

        // Handle successful payment
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const metadata = session.metadata;

            console.log('✅ Payment successful for invoice:', metadata.invoice_number);

            // Get invoice
            const invoices = await base44.asServiceRole.entities.Invoice.filter({ 
                id: metadata.invoice_id 
            });
            const invoice = invoices[0];

            if (!invoice) {
                console.error('Invoice not found:', metadata.invoice_id);
                return Response.json({ error: 'Invoice not found' }, { status: 404 });
            }

            // Record payment
            const paymentNumber = `PAY-${Date.now()}`;
            const paymentAmount = session.amount_total / 100; // Convert from cents

            const payment = await base44.asServiceRole.entities.Payment.create({
                company_id: metadata.company_id,
                payment_number: paymentNumber,
                invoice_id: invoice.id,
                invoice_number: invoice.invoice_number,
                customer_name: invoice.customer_name,
                customer_email: metadata.customer_email,
                amount: paymentAmount,
                payment_method: 'stripe',
                payment_date: new Date().toISOString().split('T')[0],
                status: 'received',
                reference_number: session.payment_intent,
                notes: 'Paid via customer portal'
            });

            // Update invoice
            const newAmountPaid = (invoice.amount_paid || 0) + paymentAmount;
            const totalAmount = invoice.amount || 0;
            
            let newStatus = 'partially_paid';
            if (newAmountPaid >= totalAmount) {
                newStatus = 'paid';
            }

            await base44.asServiceRole.entities.Invoice.update(invoice.id, {
                amount_paid: newAmountPaid,
                status: newStatus
            });

            console.log(`✅ Invoice ${invoice.invoice_number} updated: $${newAmountPaid} paid, status: ${newStatus}`);

            // Trigger family commission distribution
            try {
                await base44.asServiceRole.functions.invoke('distributeFamilyCommission', {
                    payment_id: payment.id,
                    company_id: metadata.company_id
                });
                console.log('✅ Family commission distributed');
            } catch (error) {
                console.error('⚠️ Family commission failed:', error);
            }

            // Send notification to admins
            try {
                const allStaff = await base44.asServiceRole.entities.StaffProfile.filter({ 
                    company_id: metadata.company_id 
                });
                const adminEmails = allStaff.filter(s => s.is_administrator).map(s => s.user_email);

                for (const email of adminEmails) {
                    await base44.asServiceRole.entities.Notification.create({
                        company_id: metadata.company_id,
                        user_email: email,
                        title: '💰 Customer Portal Payment Received',
                        message: `${invoice.customer_name} paid $${paymentAmount.toFixed(2)} for ${invoice.invoice_number}`,
                        type: 'payment_received',
                        link_url: '/payments',
                        is_read: false
                    });
                }
            } catch (error) {
                console.error('⚠️ Notification failed:', error);
            }
        }

        return Response.json({ received: true });

    } catch (error) {
        console.error('Webhook error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});