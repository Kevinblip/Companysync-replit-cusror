import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const { sessionId } = await req.json();

    if (!sessionId) {
      return Response.json({ 
        success: false, 
        error: 'sessionId required' 
      }, { status: 400 });
    }

    // Get signing session
    const session = await base44.asServiceRole.entities.ContractSigningSession.get(sessionId);
    
    if (!session) {
      return Response.json({ 
        success: false, 
        error: 'Session not found' 
      }, { status: 404 });
    }

    // Get template
    const template = await base44.asServiceRole.entities.ContractTemplate.get(session.template_id);

    console.log('📝 Generating signed PDF for:', session.contract_name);

    // Fetch original PDF
    const pdfResponse = await fetch(template.original_file_url);
    const pdfBytes = await pdfResponse.arrayBuffer();

    // Load PDF
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Combine all field values
    const allFields = { ...session.rep_fields, ...session.customer_fields };

    // Add text fields to PDF
    let yOffset = pages[0].getHeight() - 100;
    for (const [fieldName, value] of Object.entries(allFields)) {
      if (value && typeof value === 'string') {
        pages[0].drawText(`${fieldName}: ${value}`, {
          x: 50,
          y: yOffset,
          size: 10,
          font: font,
          color: rgb(0, 0, 0),
        });
        yOffset -= 20;
      }
    }

    // Add signatures
    const lastPage = pages[pages.length - 1];
    const pageHeight = lastPage.getHeight();

    // Rep signature
    if (session.rep_signature_url) {
      lastPage.drawText('Sales Representative Signature:', {
        x: 50,
        y: pageHeight - 600,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });

      lastPage.drawText(`Signed by: ${session.rep_name}`, {
        x: 50,
        y: pageHeight - 620,
        size: 9,
        font: font,
        color: rgb(0, 0, 0),
      });

      lastPage.drawText(`Date: ${new Date(session.rep_signed_at).toLocaleDateString()}`, {
        x: 50,
        y: pageHeight - 635,
        size: 9,
        font: font,
        color: rgb(0, 0, 0),
      });
    }

    // Customer signature
    if (session.customer_signature_url) {
      lastPage.drawText('Customer Signature:', {
        x: 300,
        y: pageHeight - 600,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });

      lastPage.drawText(`Signed by: ${session.customer_name}`, {
        x: 300,
        y: pageHeight - 620,
        size: 9,
        font: font,
        color: rgb(0, 0, 0),
      });

      lastPage.drawText(`Date: ${new Date(session.customer_signed_at).toLocaleDateString()}`, {
        x: 300,
        y: pageHeight - 635,
        size: 9,
        font: font,
        color: rgb(0, 0, 0),
      });
    }

    // Save final PDF
    const finalPdfBytes = await pdfDoc.save();
    const blob = new Blob([finalPdfBytes], { type: 'application/pdf' });
    
    // Upload final PDF
    const uploadResponse = await base44.integrations.Core.UploadFile({
      file: new File([blob], `signed_${session.contract_name}_${Date.now()}.pdf`, { 
        type: 'application/pdf' 
      })
    });

    // ✅ AUTO-SAVE TO DOCUMENTS
    console.log('💾 Saving to Documents...');
    
    // Find customer or lead
    let relatedEntityType = null;
    let relatedEntityId = null;
    
    if (session.customer_id) {
      const customer = await base44.asServiceRole.entities.Customer.get(session.customer_id);
      if (customer) {
        relatedEntityType = 'Customer';
        relatedEntityId = customer.id;
      }
    } else {
      // Try to find by email
      const customers = await base44.asServiceRole.entities.Customer.filter({ 
        company_id: session.company_id,
        email: session.customer_email 
      });
      if (customers.length > 0) {
        relatedEntityType = 'Customer';
        relatedEntityId = customers[0].id;
      } else {
        const leads = await base44.asServiceRole.entities.Lead.filter({ 
          company_id: session.company_id,
          email: session.customer_email 
        });
        if (leads.length > 0) {
          relatedEntityType = 'Lead';
          relatedEntityId = leads[0].id;
        }
      }
    }

    // Create document record
    await base44.asServiceRole.entities.Document.create({
      company_id: session.company_id,
      document_name: `Signed ${session.template_name} - ${session.customer_name}`,
      file_url: uploadResponse.file_url,
      file_type: 'application/pdf',
      category: 'contract',
      related_customer: session.customer_name,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
      is_customer_visible: true,
      description: `Fully signed contract: ${session.contract_name}`,
      uploaded_by: session.rep_email,
      tags: ['signed', 'contract', session.template_name]
    });

    console.log('✅ Document saved!');

    // Update session with final PDF
    await base44.asServiceRole.entities.ContractSigningSession.update(sessionId, {
      final_pdf_url: uploadResponse.file_url,
      status: 'completed'
    });

    // ✅ SEND NOTIFICATIONS
    console.log('📧 Sending notifications...');

    // Notify sales rep
    await base44.integrations.Core.SendEmail({
      to: session.rep_email,
      subject: `✅ Contract Signed: ${session.contract_name}`,
      body: `
        <h2>Contract Fully Signed!</h2>
        <p>Great news! <strong>${session.customer_name}</strong> has signed the contract.</p>
        <p><strong>Contract:</strong> ${session.contract_name}</p>
        <p><strong>Template:</strong> ${session.template_name}</p>
        <p><strong>Signed:</strong> ${new Date().toLocaleDateString()}</p>
        <p>The signed document has been automatically saved to the customer's files.</p>
        <p><a href="${uploadResponse.file_url}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Download Signed Contract</a></p>
      `,
      from_name: 'Contract System'
    });

    // Notify admin (find company owner)
    const company = await base44.asServiceRole.entities.Company.get(session.company_id);
    if (company && company.created_by && company.created_by !== session.rep_email) {
      await base44.integrations.Core.SendEmail({
        to: company.created_by,
        subject: `✅ Contract Signed by ${session.customer_name}`,
        body: `
          <h2>Contract Completed</h2>
          <p>A contract has been fully signed.</p>
          <p><strong>Sales Rep:</strong> ${session.rep_name}</p>
          <p><strong>Customer:</strong> ${session.customer_name}</p>
          <p><strong>Contract:</strong> ${session.contract_name}</p>
          <p>The signed document is now in the customer's files.</p>
        `,
        from_name: 'Contract System'
      });
    }

    console.log('✅ Notifications sent!');
    console.log('✅ Final signed PDF generated and auto-saved');

    return Response.json({
      success: true,
      pdf_url: uploadResponse.file_url
    });

  } catch (error) {
    console.error('💥 Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});