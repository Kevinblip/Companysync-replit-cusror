import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow both CRON auth and admin auth
    const authHeader = req.headers.get('Authorization');
    const expectedToken = Deno.env.get('CRON_SECRET_TOKEN');
    const isCronAuth = authHeader === `Bearer ${expectedToken}`;

    if (!isCronAuth) {
      const user = await base44.auth.me();
      if (!user || user.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    }

    console.log('⏰ Running trial expiration check...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Also calculate warning thresholds
    const threeDaysFromNow = new Date(today);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    // Fetch all companies with trial status
    const allCompanies = await base44.asServiceRole.entities.Company.filter({ 
      subscription_status: 'trial',
      is_deleted: { $ne: true }
    });

    console.log(`Found ${allCompanies.length} companies with trial status`);

    const results = {
      expired: [],
      expiring_soon: [],  // 0-3 days
      expiring_week: [],  // 4-7 days
      skipped: [],
      errors: []
    };

    for (const company of allCompanies) {
      try {
        // Skip platform companies
        if (company.company_name?.startsWith('CompanySync')) {
          results.skipped.push(company.company_name);
          continue;
        }

        if (!company.trial_ends_at) {
          results.skipped.push(`${company.company_name} (no trial_ends_at)`);
          continue;
        }

        const trialEndDate = new Date(company.trial_ends_at);
        trialEndDate.setHours(0, 0, 0, 0);
        const daysRemaining = Math.ceil((trialEndDate - today) / (1000 * 60 * 60 * 24));

        // EXPIRED: trial_ends_at is in the past
        if (daysRemaining < 0) {
          console.log(`❌ EXPIRED: ${company.company_name} - trial ended ${Math.abs(daysRemaining)} days ago`);

          // Update company status to expired
          await base44.asServiceRole.entities.Company.update(company.id, {
            subscription_status: 'expired'
          });

          // Find admins to notify
          const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
            company_id: company.id 
          });
          const admins = staffProfiles.filter(s => s.is_administrator);

          // Send in-app notification to each admin
          for (const admin of admins) {
            await base44.asServiceRole.entities.Notification.create({
              company_id: company.id,
              user_email: admin.user_email,
              title: '🚫 Trial Period Expired',
              message: `Your free trial has ended. Subscribe now to continue using all features. Add your payment details to get 7 extra days FREE!`,
              type: 'subscription_expired',
              link_url: '/Pricing',
              is_read: false
            });
          }

          // Send email to company admin/billing
          const recipientEmail = company.billing_email || company.email || admins[0]?.user_email;
          if (recipientEmail) {
            try {
              await base44.asServiceRole.integrations.Core.SendEmail({
                to: recipientEmail,
                subject: `⚠️ ${company.company_name} - Your Trial Has Expired`,
                body: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                      <h1 style="color: white; margin: 0; font-size: 24px;">🚫 Your Trial Has Expired</h1>
                    </div>
                    <div style="background: white; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                        Hi ${company.company_name} team,
                      </p>
                      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                        Your free trial period ended on <strong>${trialEndDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>.
                      </p>
                      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                        Your data is safe, but access to features will be limited until you subscribe.
                      </p>
                      
                      <div style="background: #fef3c7; border: 2px solid #fbbf24; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
                        <p style="color: #92400e; font-weight: bold; font-size: 18px; margin: 0 0 8px 0;">
                          🎁 Special Offer: Add your card now and get 7 extra days FREE!
                        </p>
                        <p style="color: #78350f; margin: 0; font-size: 14px;">
                          No charge until your extended trial ends. Cancel anytime.
                        </p>
                      </div>

                      <div style="text-align: center; margin: 24px 0;">
                        <a href="${Deno.env.get('APP_URL') || 'https://getcompanysync.com'}/Pricing" 
                           style="background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px;">
                          Subscribe Now & Get 7 Free Days →
                        </a>
                      </div>

                      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 24px;">
                        CompanySync • Smart Business Management
                      </p>
                    </div>
                  </div>
                `
              });
              console.log(`📧 Expiration email sent to ${recipientEmail}`);
            } catch (emailErr) {
              console.error(`Failed to send expiration email to ${recipientEmail}:`, emailErr);
            }
          }

          results.expired.push({
            company: company.company_name,
            email: recipientEmail,
            expired_days_ago: Math.abs(daysRemaining)
          });

        // EXPIRING SOON: 0-3 days
        } else if (daysRemaining <= 3) {
          console.log(`⚠️ EXPIRING SOON: ${company.company_name} - ${daysRemaining} days left`);

          const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
            company_id: company.id 
          });
          const admins = staffProfiles.filter(s => s.is_administrator);

          for (const admin of admins) {
            // Check if we already sent a notification today
            const existingNotifs = await base44.asServiceRole.entities.Notification.filter({
              company_id: company.id,
              user_email: admin.user_email,
              type: 'trial_expiring_soon'
            }, '-created_date', 1);

            const lastNotif = existingNotifs[0];
            const alreadySentToday = lastNotif && 
              new Date(lastNotif.created_date).toISOString().split('T')[0] === todayStr;

            if (!alreadySentToday) {
              await base44.asServiceRole.entities.Notification.create({
                company_id: company.id,
                user_email: admin.user_email,
                title: `⏰ Trial Expires in ${daysRemaining} Day${daysRemaining !== 1 ? 's' : ''}!`,
                message: `Your free trial ends on ${trialEndDate.toLocaleDateString()}. Add your payment details now to get 7 extra days FREE!`,
                type: 'trial_expiring_soon',
                link_url: '/Pricing',
                is_read: false
              });
            }
          }

          results.expiring_soon.push({
            company: company.company_name,
            days_remaining: daysRemaining
          });

        // EXPIRING THIS WEEK: 4-7 days
        } else if (daysRemaining <= 7) {
          results.expiring_week.push({
            company: company.company_name,
            days_remaining: daysRemaining
          });
        }

      } catch (companyErr) {
        console.error(`Error processing ${company.company_name}:`, companyErr);
        results.errors.push({ company: company.company_name, error: companyErr.message });
      }
    }

    // Send summary to platform admin
    const platformAdmin = 'yicnteam@gmail.com';
    if (results.expired.length > 0 || results.expiring_soon.length > 0) {
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: platformAdmin,
          subject: `📊 Trial Status Report - ${results.expired.length} expired, ${results.expiring_soon.length} expiring soon`,
          body: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Trial Status Report - ${todayStr}</h2>
              
              ${results.expired.length > 0 ? `
                <h3 style="color: #dc2626;">❌ Expired Trials (${results.expired.length})</h3>
                <ul>
                  ${results.expired.map(r => `<li><strong>${r.company}</strong> - expired ${r.expired_days_ago} days ago (${r.email})</li>`).join('')}
                </ul>
              ` : ''}
              
              ${results.expiring_soon.length > 0 ? `
                <h3 style="color: #f59e0b;">⚠️ Expiring Soon (${results.expiring_soon.length})</h3>
                <ul>
                  ${results.expiring_soon.map(r => `<li><strong>${r.company}</strong> - ${r.days_remaining} days left</li>`).join('')}
                </ul>
              ` : ''}
              
              ${results.expiring_week.length > 0 ? `
                <h3 style="color: #3b82f6;">📅 Expiring This Week (${results.expiring_week.length})</h3>
                <ul>
                  ${results.expiring_week.map(r => `<li><strong>${r.company}</strong> - ${r.days_remaining} days left</li>`).join('')}
                </ul>
              ` : ''}
            </div>
          `
        });
      } catch (emailErr) {
        console.error('Failed to send platform admin summary:', emailErr);
      }
    }

    console.log('✅ Trial expiration check complete:', JSON.stringify(results, null, 2));

    return Response.json({
      success: true,
      summary: {
        expired: results.expired.length,
        expiring_soon: results.expiring_soon.length,
        expiring_week: results.expiring_week.length,
        skipped: results.skipped.length,
        errors: results.errors.length
      },
      details: results
    });

  } catch (error) {
    console.error('❌ Trial expiration check failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});