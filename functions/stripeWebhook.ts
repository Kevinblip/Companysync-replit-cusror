import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import Stripe from 'npm:stripe@17.5.0';

const stripeApiKey = Deno.env.get('STRIPE_SECRET_KEY') || 
                     Deno.env.get('STRIPE_API_KEY') || 
                     Deno.env.get('Stripe_API_KEY') || 
                     Deno.env.get('Stripe_Secret_Key');

const stripe = new Stripe(stripeApiKey);
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return Response.json({ error: 'No signature' }, { status: 400 });
    }

    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not configured');
      return Response.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        webhookSecret
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }

    console.log('✅ Webhook event received:', event.type);

    const base44 = createClientFromRequest(req);

    // 🔁 Idempotency: skip if we've already processed this Stripe event.
    // Stripe retries on any non-2xx or timeout — this prevents double-credit /
    // double-subscribe / duplicate notification bugs.
    try {
      const seen = await base44.asServiceRole.entities.StripeWebhookEvent.filter(
        { stripe_event_id: event.id }, '-created_date', 1
      );
      if (seen && seen.length > 0) {
        console.log(`[Stripe] Duplicate event ${event.id} (${event.type}) — already processed, skipping.`);
        return Response.json({ received: true, duplicate: true });
      }
      await base44.asServiceRole.entities.StripeWebhookEvent.create({
        stripe_event_id: event.id,
        event_type: event.type,
        source: 'stripeWebhook'
      });
    } catch (idempErr: any) {
      // Don't drop the event if the dedup table itself is broken; log loudly.
      console.warn(`[Stripe] Idempotency check failed (continuing): ${idempErr?.message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const companyId = session.metadata.company_id;
        const purchaseType = session.metadata.purchase_type;

        // HANDLE CUSTOMER INVOICE PAYMENT (must check before subscription handling)
        const invoiceId = session.metadata?.invoice_id;
        if (invoiceId) {
          const paymentAmount = (session.amount_total || 0) / 100;
          console.log(`[Stripe] Invoice payment: $${paymentAmount} for invoice ${session.metadata?.invoice_number || invoiceId}`);
          try {
            const invoices = await base44.asServiceRole.entities.Invoice.filter({ id: invoiceId });
            const invoice = invoices[0];
            if (invoice) {
              const currentPaid = parseFloat(invoice.amount_paid || 0);
              const newAmountPaid = currentPaid + paymentAmount;
              const totalAmount = parseFloat(invoice.amount || invoice.total_amount || 0);
              const newStatus = newAmountPaid >= totalAmount ? 'paid' : 'partially_paid';

              // Create Payment record
              const paymentNumber = `PAY-${Date.now()}`;
              const payment = await base44.asServiceRole.entities.Payment.create({
                company_id: invoice.company_id,
                payment_number: paymentNumber,
                invoice_id: invoice.id,
                invoice_number: invoice.invoice_number,
                customer_name: invoice.customer_name,
                customer_email: session.customer_email || invoice.customer_email || '',
                amount: paymentAmount,
                payment_method: 'stripe',
                payment_date: new Date().toISOString().split('T')[0],
                status: 'received',
                reference_number: session.payment_intent || session.id,
                notes: 'Paid via Stripe Checkout'
              });

              // Update invoice
              await base44.asServiceRole.entities.Invoice.update(invoice.id, {
                amount_paid: newAmountPaid,
                status: newStatus
              });

              // Notify admins
              const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({
                company_id: invoice.company_id,
                is_administrator: true
              });
              for (const admin of staffProfiles) {
                await base44.asServiceRole.entities.Notification.create({
                  company_id: invoice.company_id,
                  user_email: admin.user_email,
                  title: '💰 Invoice Payment Received',
                  message: `${invoice.customer_name || 'Customer'} paid $${paymentAmount.toFixed(2)} for invoice ${invoice.invoice_number || ''}`,
                  type: 'payment_received',
                  link_url: '/payments',
                  is_read: false
                });
                // Also email each admin
                if (admin.user_email) {
                  try {
                    await base44.asServiceRole.integrations.Core.SendEmail({
                      to: admin.user_email,
                      subject: `💰 Payment Received – Invoice ${invoice.invoice_number || ''}`,
                      body: `A payment has been recorded.\n\nCustomer: ${invoice.customer_name || 'Unknown'}\nInvoice: ${invoice.invoice_number || ''}\nAmount Paid: $${paymentAmount.toFixed(2)}\nStatus: ${newStatus === 'paid' ? 'Fully Paid' : 'Partially Paid'}\n\nLog in to view the full payment record: ${Deno.env.get('APP_URL') || ''}/payments`
                    });
                  } catch (adminEmailErr: any) {
                    console.warn(`[Stripe] Admin email failed:`, adminEmailErr?.message);
                  }
                }
              }

              // Email receipt to customer
              const customerEmail = session.customer_email || invoice.customer_email;
              if (customerEmail) {
                try {
                  let companyName = 'Your contractor';
                  const companies = await base44.asServiceRole.entities.Company.filter({ id: invoice.company_id });
                  if (companies[0]?.company_name) companyName = companies[0].company_name;
                  const remaining = Math.max(0, parseFloat(invoice.amount || invoice.total_amount || 0) - newAmountPaid);
                  await base44.asServiceRole.integrations.Core.SendEmail({
                    to: customerEmail,
                    subject: `✅ Payment Received – Invoice ${invoice.invoice_number || ''}`,
                    body: `Hi ${invoice.customer_name || 'there'},\n\nWe've received your payment of $${paymentAmount.toFixed(2)} for invoice ${invoice.invoice_number || ''}. Thank you!\n\n${newStatus === 'paid' ? 'Your invoice is now fully paid.' : `Remaining balance: $${remaining.toFixed(2)}`}\n\nThank you for your business,\n${companyName}`
                  });
                } catch (emailErr: any) {
                  console.warn(`[Stripe] Customer receipt email failed:`, emailErr?.message);
                }
              }
              console.log(`[Stripe] Invoice ${invoice.invoice_number} updated: $${newAmountPaid} paid, status: ${newStatus}`);
            } else {
              console.error(`[Stripe] Invoice not found: ${invoiceId}`);
            }
          } catch (err: any) {
            console.error(`[Stripe] Error recording invoice payment:`, err?.message);
          }
        } else if (companyId) {
          console.log(`Checkout completed for company ${companyId}`);

          // HANDLE CREDIT PURCHASE
          if (purchaseType === 'credits') {
            const creditType = session.metadata.credit_type || 'ai_estimator';
            const credits = parseInt(session.metadata.credits || '0');
            
            console.log(`💰 Adding ${credits} ${creditType} credits to company ${companyId}`);

            // Get current company to add to existing credits
            const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            if (companies.length > 0) {
              const company = companies[0];
              const fieldName = creditType === 'lexi' ? 'extra_lexi_credits' : 
                              creditType === 'marcus' ? 'extra_marcus_credits' : 
                              'extra_ai_credits';
              
              const currentCredits = company[fieldName] || 0;
              const newCredits = currentCredits + credits;

              await base44.asServiceRole.entities.Company.update(companyId, {
                [fieldName]: newCredits
              });

              // Notify admins
              const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
                company_id: companyId, 
                is_administrator: true 
              });

              for (const admin of staffProfiles) {
                await base44.asServiceRole.entities.Notification.create({
                  company_id: companyId,
                  user_email: admin.user_email,
                  title: '✅ Credits Added',
                  message: `Successfully added ${credits} credits to your account.`,
                  type: 'payment_received',
                  is_read: false
                });
              }
            }
          } 
          // HANDLE SUBSCRIPTION START (Legacy/Plan)
          else {
            const planName = session.metadata.plan_name;
            const trialEndsAt = new Date();
            trialEndsAt.setDate(trialEndsAt.getDate() + 14);

            await base44.asServiceRole.entities.Company.update(companyId, {
              subscription_plan: planName?.toLowerCase() || 'professional',
              subscription_status: 'trial',
              trial_ends_at: trialEndsAt.toISOString().split('T')[0],
              stripe_subscription_id: session.subscription
            });

            // 🔔 Send notification to all admins
          const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
            company_id: companyId, 
            is_administrator: true 
          });

          for (const admin of staffProfiles) {
            await base44.asServiceRole.entities.Notification.create({
              company_id: companyId,
              user_email: admin.user_email,
              title: '🎉 Subscription Started!',
              message: `Your ${planName || 'Professional'} plan trial has begun. You have 14 days to explore all features.`,
              type: 'subscription_created',
              is_read: false
            });

            // 📧 Send email notification
            try {
              await base44.asServiceRole.integrations.Core.SendEmail({
                to: admin.user_email,
                subject: '🎉 Welcome to Your New Subscription Plan!',
                body: `Hi ${admin.full_name || 'there'},\n\nYour ${planName || 'Professional'} plan subscription has been activated with a 14-day trial period.\n\nYou now have access to all premium features. Your trial ends on ${trialEndsAt.toLocaleDateString()}.\n\nEnjoy exploring your new capabilities!\n\nBest regards,\nThe Team`
              });
            } catch (emailError) {
              console.error('Failed to send subscription email:', emailError);
            }
          }

          console.log(`✅ Company ${companyId} trial started with notifications sent`);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const companyId = subscription.metadata.company_id;

        if (companyId) {
          const updateData = {
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status === 'trialing' ? 'trial' : 
                               subscription.status === 'active' ? 'active' : 
                               subscription.status === 'past_due' ? 'past_due' : 
                               subscription.status === 'canceled' ? 'cancelled' : 'trial'
          };

          if (subscription.status === 'active' && subscription.trial_end) {
            updateData.subscription_plan = subscription.metadata.plan_name?.toLowerCase() || 'professional';
          }

          await base44.asServiceRole.entities.Company.update(companyId, updateData);
          console.log(`✅ Updated subscription for company ${companyId}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const companyId = subscription.metadata.company_id;

        if (companyId) {
          await base44.asServiceRole.entities.Company.update(companyId, {
            subscription_status: 'cancelled',
            subscription_plan: 'trial'
          });
          console.log(`✅ Cancelled subscription for company ${companyId}`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const amountPaid = (invoice.amount_paid / 100).toFixed(2);
        const customerEmail = invoice.customer_email;

        console.log(`✅ Payment succeeded: $${amountPaid} from ${customerEmail}`);

        // Get company from stripe customer or subscription metadata
        let companyId = invoice.metadata?.company_id;
        
        if (!companyId && invoice.subscription) {
          try {
            const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
            companyId = subscription.metadata?.company_id;
          } catch (e) {
            console.error('Could not retrieve subscription:', e);
          }
        }

        if (companyId) {
          // 🔔 Create notification for all admins
          const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
            company_id: companyId, 
            is_administrator: true 
          });

          for (const admin of staffProfiles) {
            await base44.asServiceRole.entities.Notification.create({
              company_id: companyId,
              user_email: admin.user_email,
              title: '💰 Payment Received',
              message: `Payment of $${amountPaid} has been successfully processed for your subscription.`,
              type: 'payment_received',
              is_read: false
            });

            // 📧 Send payment confirmation email
            try {
              await base44.asServiceRole.integrations.Core.SendEmail({
                to: admin.user_email,
                subject: '✅ Payment Confirmation - Invoice Paid',
                body: `Hi ${admin.full_name || 'there'},\n\nWe've successfully received your payment of $${amountPaid}.\n\nInvoice: ${invoice.number || invoice.id}\nAmount: $${amountPaid}\nDate: ${new Date(invoice.created * 1000).toLocaleDateString()}\n\nThank you for your continued subscription!\n\nBest regards,\nThe Team`
              });
            } catch (emailError) {
              console.error('Failed to send payment email:', emailError);
            }
          }

          // 🔄 Trigger workflow automation
          try {
            await base44.asServiceRole.functions.invoke('triggerWorkflow', {
              triggerType: 'payment_received',
              companyId: companyId,
              entityType: 'Payment',
              entityData: {
                amount: amountPaid,
                invoice_number: invoice.number || invoice.id,
                customer_email: customerEmail,
                payment_date: new Date(invoice.created * 1000).toISOString(),
                payment_method: 'stripe',
                app_url: 'https://crewcam.pro'
              }
            });
            console.log('✅ Payment workflow triggered');
          } catch (workflowError) {
            console.error('Failed to trigger workflow (non-critical):', workflowError);
          }

          console.log(`✅ Payment notifications sent for company ${companyId}`);
        } else {
          console.warn('⚠️ Payment received but no company_id found in metadata');
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const companyId = subscription.metadata.company_id;

        if (companyId) {
          await base44.asServiceRole.entities.Company.update(companyId, {
            subscription_status: 'past_due'
          });

          // 🔔 Alert admins about failed payment
          const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
            company_id: companyId, 
            is_administrator: true 
          });

          for (const admin of staffProfiles) {
            await base44.asServiceRole.entities.Notification.create({
              company_id: companyId,
              user_email: admin.user_email,
              title: '⚠️ Payment Failed',
              message: `Your payment of $${(invoice.amount_due / 100).toFixed(2)} could not be processed. Please update your payment method.`,
              type: 'payment_failed',
              is_read: false
            });

            // 📧 Send payment failure email
            try {
              await base44.asServiceRole.integrations.Core.SendEmail({
                to: admin.user_email,
                subject: '⚠️ Payment Failed - Action Required',
                body: `Hi ${admin.full_name || 'there'},\n\nWe were unable to process your payment of $${(invoice.amount_due / 100).toFixed(2)}.\n\nPlease update your payment method to avoid service interruption.\n\nBest regards,\nThe Team`
              });
            } catch (emailError) {
              console.error('Failed to send payment failure email:', emailError);
            }
          }

          console.log(`⚠️ Payment failed notifications sent for company ${companyId}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return Response.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json({ 
      error: error.message || 'Webhook processing failed' 
    }, { status: 500 });
  }
});