import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    console.log('🔄 Starting automated daily backup cron job...');
    
    const base44 = createClientFromRequest(req);

    console.log('📋 Fetching companies...');
    // Get all companies using service role
    const companies = await base44.asServiceRole.entities.Company.list("-created_date", 100);
    console.log(`   Found ${companies?.length || 0} companies`);
    
    if (!companies || companies.length === 0) {
      return Response.json({ error: 'No companies found' }, { status: 404 });
    }

    const results = [];

    // Backup each company
    for (const company of companies) {
      try {
        console.log(`📦 Backing up: ${company.company_name}`);

        const timestamp = new Date().toISOString().split('T')[0];
        const backupData = {
          backup_date: new Date().toISOString(),
          company_name: company.company_name,
          company_id: company.id,
          data: {}
        };

        // Fetch all entity data
        const entities = [
          'Customer', 'Lead', 'Invoice', 'Estimate', 'Payment',
          'Project', 'Task', 'CalendarEvent', 'Communication',
          'StaffProfile', 'Proposal', 'Contract', 'Document',
          'Item', 'InspectionJob', 'DroneInspection', 'PriceListItem',
          'ReviewRequest', 'KnowledgeBaseArticle', 'EmailTemplate',
          'SMSTemplate', 'Workflow'
        ];

        for (const entityName of entities) {
          try {
            console.log(`   📥 Fetching ${entityName} for company ${company.id}...`);
            const records = await base44.asServiceRole.entities[entityName].filter({ 
              company_id: company.id 
            });
            backupData.data[entityName] = records;
            console.log(`   ✅ ${entityName}: ${records.length} records`);
            
            // Add delay to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            console.error(`   ❌ ${entityName} failed:`, error.message);
            backupData.data[entityName] = [];
          }
        }

        const totalRecords = Object.values(backupData.data).reduce((sum, records) => sum + records.length, 0);
        const jsonBackup = JSON.stringify(backupData, null, 2);
        const fileName = `backup_${company.company_name.replace(/\s+/g, '_')}_${timestamp}.json`;

        // Upload backup to file storage
        const ownerEmail = company.created_by || company.email;

        if (ownerEmail) {
          try {
            console.log(`📤 Uploading backup file...`);

            // Convert JSON to blob for upload
            const blob = new Blob([jsonBackup], { type: 'application/json' });
            const file = new File([blob], fileName, { type: 'application/json' });
            const fileSize = new TextEncoder().encode(jsonBackup).length;

            // Upload file
            const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });
            const fileUrl = uploadResult.file_url;

            console.log(`✅ Backup uploaded: ${fileUrl}`);

            // Save backup record in Document entity
            await base44.asServiceRole.entities.Document.create({
              company_id: company.id,
              document_name: `Daily Backup - ${timestamp}`,
              category: 'other',
              file_url: fileUrl,
              file_type: 'application/json',
              file_size: fileSize,
              description: `Automated daily backup. ${totalRecords} total records.`,
              uploaded_by: 'system'
            });

            console.log(`✅ Backup document record created`);

            // Determine recipient: prioritize company email to target the subscriber
            // ONLY send to company-specific emails to ensure privacy. Never fallback to created_by as it may be the platform admin.
            let recipientEmail = company.email || company.billing_email;
            const platformAdmin = 'yicnteam@gmail.com';
            const isPlatformCompany = company.company_name?.startsWith('CompanySync');

            // If the default email is the platform admin (and not his company), try to find a better one
            if ((!recipientEmail || recipientEmail === platformAdmin) && !isPlatformCompany) {
                try {
                    // Fetch admins
                    const admins = await base44.asServiceRole.entities.StaffProfile.filter({ 
                        company_id: company.id, 
                        is_administrator: true 
                    });
                    const realAdmins = admins.filter(s => s.user_email && s.user_email !== platformAdmin);
                    if (realAdmins.length > 0) {
                        recipientEmail = realAdmins[0].user_email;
                    }
                } catch (e) {
                    console.error('Failed to fetch admins for backup email:', e);
                }
            }

            // Final safety check
            if (recipientEmail === platformAdmin && !isPlatformCompany) {
                console.log(`⚠️ Skipping backup email for ${company.company_name} - Recipient is platform admin`);
                recipientEmail = null;
            }

            if (recipientEmail) {
                console.log(`📧 Emailing backup link to ${recipientEmail}...`);

                const resendApiKey = Deno.env.get('RESEND_API_KEY');
                if (!resendApiKey) {
                  throw new Error('RESEND_API_KEY not configured');
                }

                const resend = new Resend(resendApiKey);

                await resend.emails.send({
                  from: 'AI CRM Pro Backups <noreply@mycrewcam.com>',
                  to: recipientEmail,
                  subject: `💾 Daily Backup - ${company.company_name} - ${timestamp}`,
                  html: `Your daily backup is ready!<br><br>📊 Backup Summary:<br>- Company: ${company.company_name}<br>- Date: ${timestamp}<br>- Total Records: ${totalRecords}<br><br>📎 <a href="${fileUrl}" style="display:inline-block;background:#3b82f6;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;">Download Backup</a><br><br>The backup is also saved in your Documents (Settings → Documents).<br><br>You can restore from this backup anytime via Settings → Utilities → Restore from Backup.`
                });

                console.log(`✅ Email sent to ${recipientEmail}`);

                results.push({
                  company: company.company_name,
                  records: totalRecords,
                  file_url: fileUrl,
                  email_sent: true,
                  sent_to: recipientEmail
                });
            } else {
                console.log(`⚠️ No email address found for ${company.company_name}`);
                results.push({
                  company: company.company_name,
                  records: totalRecords,
                  email_sent: false,
                  error: 'No email address found'
                });
            }
          } catch (error) {
            console.error(`❌ Failed to backup: ${error.message}`);
            results.push({
              company: company.company_name,
              records: totalRecords,
              email_sent: false,
              error: error.message
            });
          }
        } else {
          console.log(`⚠️ No email address for ${company.company_name}`);
          results.push({
            company: company.company_name,
            records: totalRecords,
            email_sent: false,
            error: 'No email address found'
          });
        }

      } catch (error) {
        console.error(`❌ Backup failed for ${company.company_name}:`, error);
        results.push({
          company: company.company_name,
          saved_to_crm: false,
          error: error.message
        });
      }
    }

    console.log('✅ Daily backup cron completed');

    return Response.json({
      success: true,
      message: 'Daily backups completed',
      companies_backed_up: results.length,
      results: results
    });

  } catch (error) {
    console.error('❌ Cron backup error:', error);
    return Response.json({
      error: error.message,
      success: false
    }, { status: 500 });
  }
});