import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { invoiceId, companyId } = body;

        const invoices = await base44.asServiceRole.entities.Invoice.filter({ id: invoiceId });
        const invoice = invoices[0];

        if (!invoice) {
            return Response.json({ error: 'Invoice not found' }, { status: 404 });
        }

        let company = null;
        let companySettings = null;
        if (companyId) {
            const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            company = companies[0];
            
            // Fetch company settings for payment options
            const settings = await base44.asServiceRole.entities.CompanySetting.list();
            companySettings = settings[0];
        }

        // Fetch customer data for PDF generation
        let customer = null;
        if (invoice.customer_id) {
            const customers = await base44.asServiceRole.entities.Customer.filter({ id: invoice.customer_id });
            customer = customers[0];
        }

        // Attempt to generate PDF
        let pdfUrl = null;
        try {
            console.log('📄 Generating PDF for invoice:', invoice.invoice_number);
            const pdfRes = await base44.functions.invoke('generateInvoicePDF', {
                invoice,
                customer
            });
            if (pdfRes.data?.success && pdfRes.data.pdf_url) {
                pdfUrl = pdfRes.data.pdf_url;
                console.log('✅ PDF generated:', pdfUrl);
            } else {
                console.warn('⚠️ PDF generation response invalid:', pdfRes.data);
            }
        } catch (pdfError) {
            console.error('❌ Failed to generate PDF attachment:', pdfError.message);
            // Continue without PDF
        }

        // Generate payment link if Stripe is connected (either via API key or Connect onboarding)
        let paymentUrl = null;
        const stripeApiKey = Deno.env.get('STRIPE_SECRET_KEY');
        const hasStripe = company?.stripe_onboarding_status === 'complete' || stripeApiKey;

        if (hasStripe) {
            try {
                console.log('💳 Generating Stripe payment link for invoice:', invoice.invoice_number);
                const paymentRes = await base44.functions.invoke('createPaymentLinkForInvoice', {
                    invoice_id: invoice.id
                });
                if (paymentRes.data?.payment_url) {
                    paymentUrl = paymentRes.data.payment_url;
                    console.log('✅ Payment link generated:', paymentUrl);
                }
            } catch (paymentError) {
                console.error('⚠️ Failed to generate payment link:', paymentError.message);
                // Continue without payment link
            }
        }

        // Build payment options HTML
        let paymentOptionsHTML = '';
        const hasPaymentMethods = paymentUrl || companySettings?.zelle_email || companySettings?.cashapp_handle || 
                                 companySettings?.venmo_handle || companySettings?.check_payment_instructions || 
                                 companySettings?.cash_payment_instructions;

        if (hasPaymentMethods) {
            paymentOptionsHTML = `
                <div style="margin-top: 40px; padding: 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 10px;">
                    <h2 style="color: white; margin-top: 0; margin-bottom: 20px; text-align: center; font-size: 24px;">💳 How to Pay</h2>
                    <div style="display: grid; gap: 15px;">
            `;

            if (paymentUrl) {
                paymentOptionsHTML += `
                    <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="font-size: 32px;">💳</div>
                            <h3 style="margin: 0; color: #10b981; font-size: 18px; font-weight: bold;">Credit Card / ACH (Recommended)</h3>
                        </div>
                        <p style="margin: 0 0 15px 0; color: #6b7280; font-size: 14px;">Instant payment confirmation • Secure encrypted checkout</p>
                        <a href="${paymentUrl}" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 15px; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);">Pay $${invoice.amount?.toFixed(2)} Now →</a>
                        <p style="margin: 12px 0 0 0; color: #9ca3af; font-size: 12px;">💡 Standard credit card fees apply (2.9% + $0.30). ACH bank transfers have lower fees.</p>
                    </div>
                `;
            }

            if (companySettings?.cashapp_handle) {
                // Cash App deep link format: https://cash.app/$cashtag ($ must be included)
                const cashtag = companySettings.cashapp_handle.startsWith('$') 
                    ? companySettings.cashapp_handle 
                    : `$${companySettings.cashapp_handle}`;
                // Note: Cash App payment links with amounts may not pre-fill recipient
                const cashAppUrl = `https://cash.app/${cashtag}`;
                paymentOptionsHTML += `
                    <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="font-size: 32px;">💵</div>
                            <h3 style="margin: 0; color: #00d632; font-size: 18px; font-weight: bold;">Cash App</h3>
                        </div>
                        <div style="background: #f3f4f6; padding: 15px; border-radius: 6px; margin-bottom: 15px; border-left: 4px solid #00d632;">
                            <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 13px;">Send payment to:</p>
                            <p style="margin: 0; color: #111827; font-size: 20px; font-weight: bold; font-family: monospace;">${cashtag}</p>
                            <p style="margin: 8px 0 0 0; color: #6b7280; font-size: 12px;">Copy this handle and paste it in the "To:" field if it doesn't auto-fill</p>
                        </div>
                        <a href="${cashAppUrl}" style="display: inline-block; background: #00d632; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 15px;">Open Cash App →</a>
                        <p style="margin: 12px 0 0 0; color: #9ca3af; font-size: 12px;">💡 Include invoice #${invoice.invoice_number} in the note. Instant transfer, no fees between Cash App users.</p>
                    </div>
                `;
            }

            if (companySettings?.venmo_handle) {
                const venmoHandle = companySettings.venmo_handle.replace('@', '');
                const venmoUrl = `https://venmo.com/u/${venmoHandle}?txn=pay&amount=${invoice.amount?.toFixed(2)}&note=Invoice ${invoice.invoice_number}`;
                paymentOptionsHTML += `
                    <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="font-size: 32px;">💙</div>
                            <h3 style="margin: 0; color: #008cff; font-size: 18px; font-weight: bold;">Venmo</h3>
                        </div>
                        <p style="margin: 0 0 15px 0; color: #374151; font-size: 14px;">Send to: <strong>${companySettings.venmo_handle}</strong></p>
                        <a href="${venmoUrl}" style="display: inline-block; background: #008cff; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 15px;">Open Venmo →</a>
                        <p style="margin: 12px 0 0 0; color: #9ca3af; font-size: 12px;">💡 Include invoice #${invoice.invoice_number} in the note. Instant payment between Venmo users.</p>
                    </div>
                `;
            }

            if (companySettings?.zelle_email) {
                paymentOptionsHTML += `
                    <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="font-size: 32px;">💸</div>
                            <h3 style="margin: 0; color: #6b21a8; font-size: 18px; font-weight: bold;">Zelle</h3>
                        </div>
                        <p style="margin: 0 0 8px 0; color: #374151; font-size: 14px;">Send to: <strong>${companySettings.zelle_email}</strong></p>
                        <p style="margin: 0 0 15px 0; color: #374151; font-size: 14px;">Amount: <strong>$${invoice.amount?.toFixed(2)}</strong></p>
                        <div style="background: #f3f4f6; padding: 12px; border-radius: 4px; border-left: 3px solid #6b21a8;">
                            <p style="margin: 0; color: #374151; font-size: 13px;">📝 Include invoice #${invoice.invoice_number} in the memo</p>
                        </div>
                        <p style="margin: 12px 0 0 0; color: #9ca3af; font-size: 12px;">💡 Free bank-to-bank transfer. Usually arrives in minutes, typically within 1 business day.</p>
                    </div>
                `;
            }

            if (companySettings?.check_payment_instructions) {
                paymentOptionsHTML += `
                    <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="font-size: 32px;">✅</div>
                            <h3 style="margin: 0; color: #f59e0b; font-size: 18px; font-weight: bold;">Check</h3>
                        </div>
                        <p style="margin: 0 0 15px 0; color: #374151; font-size: 14px; white-space: pre-line;">${companySettings.check_payment_instructions}</p>
                        <div style="background: #f3f4f6; padding: 12px; border-radius: 4px; border-left: 3px solid #f59e0b;">
                            <p style="margin: 0; color: #374151; font-size: 13px;">📝 Write invoice #${invoice.invoice_number} on the check memo line</p>
                        </div>
                        <p style="margin: 12px 0 0 0; color: #9ca3af; font-size: 12px;">💡 Allow 5-7 business days for mail delivery and processing.</p>
                    </div>
                `;
            }

            if (companySettings?.cash_payment_instructions) {
                paymentOptionsHTML += `
                    <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="font-size: 32px;">💵</div>
                            <h3 style="margin: 0; color: #10b981; font-size: 18px; font-weight: bold;">Cash</h3>
                        </div>
                        <p style="margin: 0 0 15px 0; color: #374151; font-size: 14px; white-space: pre-line;">${companySettings.cash_payment_instructions}</p>
                        <p style="margin: 0; color: #9ca3af; font-size: 12px;">💡 Request a receipt for your records when paying in cash.</p>
                    </div>
                `;
            }

            paymentOptionsHTML += `
                    </div>
                </div>
            `;
        }

        // Build insurance info section - ONLY IF VALUES EXIST
        let insuranceInfoHTML = '';
        if (invoice.claim_number || invoice.insurance_company || invoice.policy_number || invoice.deductible_amount) {
            insuranceInfoHTML = '<h3 style="margin-top: 20px;">Insurance Information:</h3>';
            
            if (invoice.claim_number) {
                insuranceInfoHTML += `<p><strong>Claim Number:</strong> ${invoice.claim_number}</p>`;
            }
            if (invoice.insurance_company) {
                insuranceInfoHTML += `<p><strong>Insurance Company:</strong> ${invoice.insurance_company}</p>`;
            }
            if (invoice.policy_number) {
                insuranceInfoHTML += `<p><strong>Policy Number:</strong> ${invoice.policy_number}</p>`;
            }
            if (invoice.deductible_amount) {
                insuranceInfoHTML += `<p><strong>Deductible Amount:</strong> $${invoice.deductible_amount.toFixed(2)}</p>`;
            }
        }

        const invoiceHTML = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: white; padding: 30px; border: 1px solid #e5e7eb; }
        .invoice-details { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .items-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .items-table th { background: #f3f4f6; padding: 12px; text-align: left; font-weight: 600; }
        .items-table td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
        .total { font-size: 24px; font-weight: bold; color: #10b981; text-align: right; margin-top: 20px; }
        .footer { background: #f9fafb; padding: 20px; text-align: center; color: #6b7280; border-radius: 0 0 10px 10px; }
        .btn { display: inline-block; padding: 12px 24px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Invoice from ${company?.company_name || 'AI CRM Pro'}</h1>
        <p>Invoice #${invoice.invoice_number}</p>
    </div>
    <div class="content">
        <div class="invoice-details">
            <h2>Bill To:</h2>
            <p><strong>${invoice.customer_name}</strong></p>
            ${invoice.customer_email ? `<p>📧 ${invoice.customer_email}</p>` : ''}
            <h3 style="margin-top: 20px;">Invoice Details:</h3>
            <p><strong>Invoice Number:</strong> ${invoice.invoice_number}</p>
            <p><strong>Issue Date:</strong> ${invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString() : 'N/A'}</p>
            <p><strong>Due Date:</strong> ${invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'N/A'}</p>
            ${insuranceInfoHTML}
        </div>
        ${invoice.items && invoice.items.length > 0 ? `
        <table class="items-table">
            <thead>
                <tr>
                    <th>Description</th>
                    <th style="text-align: center;">Quantity</th>
                    <th style="text-align: right;">Rate</th>
                    <th style="text-align: right;">Amount</th>
                </tr>
            </thead>
            <tbody>
                ${invoice.items.map(item => `
                    <tr>
                        <td>${item.description || 'Item'}</td>
                        <td style="text-align: center;">${item.quantity || 1}</td>
                        <td style="text-align: right;">$${(item.rate || 0).toFixed(2)}</td>
                        <td style="text-align: right;">$${(item.amount || 0).toFixed(2)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        ` : ''}
        <div class="total">Total Amount Due: $${invoice.amount?.toFixed(2)}</div>
        ${invoice.notes ? `<div style="margin-top: 30px; padding: 15px; background: #fef3c7; border-left: 4px solid #f59e0b;"><strong>Notes:</strong><p>${invoice.notes}</p></div>` : ''}
        
        ${paymentOptionsHTML}
        
        ${pdfUrl ? `<div style="text-align: center; margin-top: 20px;"><a href="${pdfUrl}" style="color: #4f46e5; text-decoration: underline;">📄 Download PDF Invoice</a></div>` : ''}
    </div>
    <div class="footer">
        <p>Thank you for your business!</p>
        <p style="font-size: 12px;">This is an automated email from ${company?.company_name || 'AI CRM Pro'}</p>
    </div>
</body>
</html>`;

        const attachments = pdfUrl ? [{
            filename: `Invoice-${invoice.invoice_number}.pdf`,
            path: pdfUrl
        }] : [];

        // Send via Unified Email System
        const emailRes = await base44.functions.invoke('sendUnifiedEmail', {
            to: invoice.customer_email,
            subject: `Invoice ${invoice.invoice_number} from ${company?.company_name || 'AI CRM Pro'}`,
            html: invoiceHTML,
            companyId: companyId,
            contactName: invoice.customer_name,
            messageType: 'invoice',
            attachments: attachments,
            skipLogging: true, // We will log manually below for better description
            skipNotification: false
        });

        if (emailRes.data?.error) {
            throw new Error(emailRes.data.error);
        }

        // Manual logging for precise description
        await base44.asServiceRole.entities.Communication.create({
            company_id: companyId,
            contact_name: invoice.customer_name,
            contact_email: invoice.customer_email,
            communication_type: 'email',
            direction: 'outbound',
            subject: `Invoice ${invoice.invoice_number}`,
            message: `Sent invoice for $${invoice.amount?.toFixed(2)}${pdfUrl ? ' (with PDF)' : ''}`,
            status: 'delivered'
        });

        console.log('✅ Invoice email sent successfully');

        return Response.json({ success: true, message: 'Invoice sent successfully' });

    } catch (error) {
        console.error('❌ Error sending invoice:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});