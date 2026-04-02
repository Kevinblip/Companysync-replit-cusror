import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    let { to, customerName, estimateData, format, pdfBase64, estimateId } = body;
    let { companyId } = body;
    
    // If estimateId provided, fetch the full estimate
    if (estimateId && !estimateData) {
      const estimates = await base44.asServiceRole.entities.Estimate.filter({ id: estimateId });
      if (estimates.length === 0) {
        return Response.json({ error: 'Estimate not found' }, { status: 404 });
      }
      estimateData = estimates[0];
      to = to || estimateData.customer_email;
      customerName = customerName || estimateData.customer_name;
    }

    if (!to || !estimateData) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get company info for branding
    let company = null;
    if (companyId) {
      const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
      company = companies[0];
    } else {
      // Get staff profile to find company_id
      const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
      const userCompanyId = staffProfiles[0]?.company_id;
      
      if (userCompanyId) {
        const companies = await base44.entities.Company.filter({ id: userCompanyId });
        company = companies[0];
        companyId = userCompanyId;
      } else {
        // Fallback for initial creator
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        company = companies[0];
        companyId = company?.id;
      }
    }

    const companyName = company?.company_name || 'Your Company';
    const companyLogo = company?.logo_url || '';
    const primaryColor = company?.brand_primary_color || '#3b82f6';
    const secondaryColor = company?.brand_secondary_color || '#8b5cf6';

    // Initialize Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }
    const resend = new Resend(resendApiKey);

    // If no PDF provided in request, generate it now (similar to sendInvoiceEmail logic)
    let finalPdfBase64 = pdfBase64;
    let pdfUrl = null;

    if (!finalPdfBase64 && estimateData.id) {
        try {
            console.log('📄 Generating PDF for estimate:', estimateData.id);
            // Fetch fresh estimate data to be sure
            const estimates = await base44.entities.Estimate.filter({ id: estimateData.id });
            const estimate = estimates[0];
            
            if (estimate) {
                // Fetch customer data if available
                let customer = null;
                if (estimate.customer_id) {
                    const customers = await base44.entities.Customer.filter({ id: estimate.customer_id });
                    customer = customers[0];
                }

                // Call generateEstimatePDF
                const pdfRes = await base44.functions.invoke('generateEstimatePDF', {
                    estimate: {
                        ...estimate,
                        line_items: estimate.items || [], // Map items to line_items expected by PDF generator
                        total_rcv: estimate.amount,
                        total_acv: estimate.amount // Simplified if ACV not calculated
                    },
                    customerInfo: {
                        customer_name: estimate.customer_name,
                        customer_email: estimate.customer_email,
                        customer_phone: estimate.customer_phone,
                        property_address: estimate.property_address,
                        insurance_company: estimate.insurance_company,
                        claim_number: estimate.claim_number,
                        notes: estimate.notes
                    },
                    format: format,
                    returnBase64: true // Request base64 response to ensure integrity
                });

                if (pdfRes.data && pdfRes.data.base64) {
                    finalPdfBase64 = pdfRes.data.base64;
                    console.log('✅ Successfully generated PDF fallback');
                } else {
                    console.warn('⚠️ PDF generation failed or returned invalid data');
                }
            }
        } catch (e) {
            console.error('Failed to auto-generate PDF:', e);
        }
    }

    // Build email body with branding matching the screenshot
    const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your Estimate from ${companyName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #333; margin: 0; padding: 0; background-color: #f7f7f7; }
    .container { max-width: 600px; margin: 20px auto; padding: 0; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); overflow: hidden; }
    
    /* Header - Solid Blue/Purple Gradient like screenshot */
    .header { 
      background: linear-gradient(90deg, #1e3a8a 0%, #7c3aed 100%); 
      padding: 40px 20px; 
      text-align: center; 
    }
    
    /* Logo Box - White background for logo */
    .logo-container {
      background-color: white;
      padding: 10px 20px;
      display: inline-block;
      border-radius: 4px;
    }
    
    .logo { 
      max-height: 50px; 
      width: auto; 
      display: block; 
    }
    
    .header-text {
        color: white;
        font-weight: bold;
        font-size: 24px;
        margin-top: 10px;
        display: ${companyLogo ? 'none' : 'block'};
    }

    .content { padding: 40px 30px; }
    
    .greeting { 
      font-size: 20px; 
      font-weight: bold; 
      margin-bottom: 15px; 
      color: #111;
    }
    
    .intro-text { 
      font-size: 16px; 
      color: #555; 
      margin-bottom: 30px; 
    }
    
    /* Estimate Card Styling */
    .estimate-card { 
      background-color: #f8fafc; 
      border-radius: 8px; 
      overflow: hidden; 
      margin-bottom: 30px;
      border-left: 4px solid #1e3a8a; /* Blue accent line */
    }
    
    .card-content {
      padding: 25px;
    }
    
    .estimate-title {
      font-size: 22px;
      font-weight: bold;
      color: #1e3a8a; /* Dark Blue */
      margin-bottom: 10px;
    }
    
    .property-address {
      font-size: 15px;
      color: #333;
      margin-bottom: 25px;
    }
    
    .section-title {
      font-size: 18px;
      font-weight: bold;
      color: #1e3a8a;
      margin-bottom: 15px;
    }
    
    /* Table Styling */
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    
    thead th {
      background-color: #e2e8f0;
      color: #333;
      font-weight: bold;
      padding: 10px;
      text-align: left;
    }
    
    thead th:last-child { text-align: right; }
    thead th:nth-child(2) { text-align: center; }
    
    tbody td {
      padding: 12px 10px;
      border-bottom: 1px solid #f1f5f9;
      background-color: white;
    }
    
    tbody td:last-child { text-align: right; }
    tbody td:nth-child(2) { text-align: center; }
    
    .total-row td {
      font-weight: bold;
      font-size: 16px;
      padding-top: 15px;
      border-bottom: none;
    }
    
    /* Footer */
    .footer { 
      text-align: center; 
      padding: 20px; 
      background-color: #f1f5f9; 
      font-size: 12px; 
      color: #64748b; 
      border-top: 1px solid #e2e8f0;
    }
    
    .footer a { color: #1e3a8a; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${companyLogo ? `
        <div class="logo-container">
          <img src="${companyLogo}" alt="${companyName}" class="logo" />
        </div>
      ` : `<div class="header-text">${companyName}</div>`}
    </div>
    
    <div class="content">
      <div class="greeting">Hello ${customerName},</div>
      <div class="intro-text">Thank you for your interest! Please find your estimate details below:</div>
      
      <div class="estimate-card">
        <div class="card-content">
          <div class="estimate-title">Estimate: ${estimateData.estimate_number || 'DRAFT'}</div>
          
          ${estimateData.property_address ? `
            <div class="property-address">
              <strong>Property:</strong> ${estimateData.property_address}
            </div>
          ` : ''}
          
          <div class="section-title">Line Items</div>
          
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th width="60">Qty</th>
                <th width="100">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${(estimateData.line_items || estimateData.items || []).map(item => {
                const qty = Number(item.quantity) || 0;
                // Fix for weird floating point numbers like 227.70000000000002
                const displayQty = Number.isInteger(qty) ? qty : qty.toFixed(2);
                
                return `
                <tr>
                  <td>
                    <strong>${item.name || (item.description ? item.description.split('\\n')[0] : 'Item')}</strong>
                  </td>
                  <td>${displayQty}</td>
                  <td>$${(item.amount || item.rcv || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                `;
              }).join('')}
              
              <tr class="total-row">
                <td style="text-align: right; padding-right: 20px;">Total:</td>
                <td></td>
                <td>$${(estimateData.total_rcv || estimateData.total_acv || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p style="margin-top: 20px; color: #555; font-size: 14px;">
        The full estimate is attached as a PDF for your records. If you have any questions, please reply to this email or call us.
      </p>
    </div>

    <!-- Contact Info & Disclaimer Section -->
    <div style="margin-top: 40px; padding: 25px; background-color: #f9fafb; border-top: 2px solid #e5e7eb;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px;">
        <!-- Company Contact Info -->
        <div>
          <h3 style="color: #1f2937; font-size: 16px; margin-top: 0; margin-bottom: 15px; font-weight: bold;">From:</h3>
          <p style="margin: 0 0 8px 0; font-weight: bold; color: #1f2937;">${company?.company_name || 'Your Company'}</p>
          ${company?.company_address ? `<p style="margin: 0 0 8px 0; color: #4b5563;">${company.company_address}</p>` : ''}
          ${company?.phone_number ? `<p style="margin: 0 0 8px 0; color: #4b5563;">Phone: ${company.phone_number}</p>` : ''}
          ${company?.email_address ? `<p style="margin: 0 0 8px 0; color: #4b5563;">Email: ${company.email_address}</p>` : ''}
          ${company?.company_website ? `<p style="margin: 0; color: #4b5563;"><a href="${company.company_website}" style="color: #1e3a8a; text-decoration: none;">${company.company_website}</a></p>` : ''}
        </div>

        <!-- Customer Contact Info -->
        <div>
          <h3 style="color: #1f2937; font-size: 16px; margin-top: 0; margin-bottom: 15px; font-weight: bold;">Customer:</h3>
          <p style="margin: 0 0 8px 0; font-weight: bold; color: #1f2937;">${customerName}</p>
          ${estimateData.property_address ? `<p style="margin: 0 0 8px 0; color: #4b5563;">${estimateData.property_address}</p>` : ''}
          ${estimateData.customer_phone ? `<p style="margin: 0 0 8px 0; color: #4b5563;">Phone: ${estimateData.customer_phone}</p>` : ''}
          ${to ? `<p style="margin: 0; color: #4b5563;">Email: ${to}</p>` : ''}
        </div>
      </div>

      ${company?.pdf_footer_text ? `
        <div style="background: white; padding: 20px; border-radius: 6px; border-left: 4px solid #1e3a8a; margin-top: 20px;">
          <h4 style="color: #1f2937; margin-top: 0; margin-bottom: 10px; font-size: 14px; font-weight: bold;">Disclaimer</h4>
          <p style="margin: 0; color: #4b5563; font-size: 13px; line-height: 1.6; white-space: pre-wrap;">${company.pdf_footer_text}</p>
        </div>
      ` : ''}
    </div>
    
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;

    // Send via Resend with PDF attachment
    try {
      const result = await resend.emails.send({
        from: `${companyName} <estimates@mycrewcam.com>`,
        to: [to],
        subject: `Your Estimate from ${companyName} - ${estimateData.estimate_number || 'DRAFT'}`,
        html: emailBody,
        attachments: pdfBase64 ? [{
          filename: `Estimate_${estimateData.estimate_number || 'DRAFT'}.pdf`,
          content: pdfBase64
        }] : []
      });

      return Response.json({
        success: true,
        message: `Estimate sent to ${to}`,
        resend_id: result.data?.id
      });
    } catch (emailError) {
      console.error('❌ Resend API error:', emailError);
      return Response.json({
        error: 'Failed to send email via Resend',
        details: emailError.message,
        stack: emailError.stack
      }, { status: 500 });
    }

  } catch (error) {
    console.error('❌ Send estimate error:', error);
    return Response.json({
      error: error.message || 'Failed to send estimate email',
      details: error.toString(),
      stack: error.stack
    }, { status: 500 });
  }
});