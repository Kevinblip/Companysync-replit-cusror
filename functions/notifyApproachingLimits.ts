import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get all companies
    const companies = await base44.asServiceRole.entities.Company.list();

    for (const company of companies) {
      // Check staff limit
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({
        company_id: company.id
      });

      const staffLimitResponse = await base44.functions.invoke('checkSubscriptionLimits', {
        company_id: company.id,
        entity_type: 'staff'
      });

      const staffData = staffLimitResponse.data;
      const staffPercentage = (staffData.current_count / staffData.limit) * 100;

      if (staffPercentage >= 80 && staffPercentage < 100) {
        // Alert approaching limit
        await createNotification(base44, company.id, 'staff', staffData, 'APPROACHING');
      } else if (staffPercentage >= 100) {
        // Alert at limit
        await createNotification(base44, company.id, 'staff', staffData, 'AT_LIMIT');
      }

      // Check customer limit
      const customerLimitResponse = await base44.functions.invoke('checkSubscriptionLimits', {
        company_id: company.id,
        entity_type: 'customer'
      });

      const customerData = customerLimitResponse.data;
      const customerPercentage = (customerData.current_count / customerData.limit) * 100;

      if (customerPercentage >= 80 && customerPercentage < 100) {
        await createNotification(base44, company.id, 'customer', customerData, 'APPROACHING');
      } else if (customerPercentage >= 100) {
        await createNotification(base44, company.id, 'customer', customerData, 'AT_LIMIT');
      }

      // Check lead limit
      const leadLimitResponse = await base44.functions.invoke('checkSubscriptionLimits', {
        company_id: company.id,
        entity_type: 'lead'
      });

      const leadData = leadLimitResponse.data;
      const leadPercentage = (leadData.current_count / leadData.limit) * 100;

      if (leadPercentage >= 80 && leadPercentage < 100) {
        await createNotification(base44, company.id, 'lead', leadData, 'APPROACHING');
      } else if (leadPercentage >= 100) {
        await createNotification(base44, company.id, 'lead', leadData, 'AT_LIMIT');
      }

      // Check AI/SMS/Call usage limits
      const usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({
        company_id: company.id
      });

      if (usageRecords.length > 0) {
        const usage = usageRecords[0];
        
        // Skip unlimited plans (-1 means unlimited)
        // AI Interactions
        if (usage.ai_limit > 0) {
          const aiTotal = usage.ai_limit + (usage.ai_credits_purchased || 0);
          const aiPercentage = (usage.ai_used / aiTotal) * 100;
          if (aiPercentage >= 80 && aiPercentage < 100) {
            await createUsageNotification(base44, company.id, 'AI interactions', usage.ai_used, aiTotal, 'APPROACHING');
          } else if (aiPercentage >= 100) {
            await createUsageNotification(base44, company.id, 'AI interactions', usage.ai_used, aiTotal, 'AT_LIMIT');
          }
        }

        // SMS Messages
        if (usage.sms_limit > 0) {
          const smsTotal = usage.sms_limit + (usage.sms_credits_purchased || 0);
          const smsPercentage = (usage.sms_used / smsTotal) * 100;
          if (smsPercentage >= 80 && smsPercentage < 100) {
            await createUsageNotification(base44, company.id, 'SMS messages', usage.sms_used, smsTotal, 'APPROACHING');
          } else if (smsPercentage >= 100) {
            await createUsageNotification(base44, company.id, 'SMS messages', usage.sms_used, smsTotal, 'AT_LIMIT');
          }
        }

        // Call Minutes
        if (usage.call_minutes_limit > 0) {
          const callTotal = usage.call_minutes_limit + (usage.call_credits_purchased || 0);
          const callPercentage = (usage.call_minutes_used / callTotal) * 100;
          if (callPercentage >= 80 && callPercentage < 100) {
            await createUsageNotification(base44, company.id, 'call minutes', usage.call_minutes_used, callTotal, 'APPROACHING');
          } else if (callPercentage >= 100) {
            await createUsageNotification(base44, company.id, 'call minutes', usage.call_minutes_used, callTotal, 'AT_LIMIT');
          }
        }
      }
    }

    return Response.json({
      success: true,
      message: 'Limit notifications sent'
    });
  } catch (error) {
    console.error('Notification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function createNotification(base44, companyId, entityType, limitData, status) {
  try {
    // Get company admins
    const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({
      company_id: companyId,
      is_administrator: true
    });

    for (const admin of staffProfiles) {
      const title = status === 'APPROACHING'
        ? `⚠️ Approaching ${entityType} limit`
        : `🚨 ${entityType} limit reached`;

      const message = status === 'APPROACHING'
        ? `You're at ${Math.round((limitData.current_count / limitData.limit) * 100)}% capacity (${limitData.current_count}/${limitData.limit})`
        : `You've reached your ${entityType} limit. Upgrade your plan to add more.`;

      await base44.asServiceRole.entities.Notification.create({
        user_email: admin.user_email,
        company_id: companyId,
        title,
        message,
        type: 'subscription_limit',
        is_read: false,
        link_url: '/subscription-limits-admin'
      });
    }
  } catch (error) {
    console.error(`Failed to create notification for ${entityType}:`, error);
  }
}

async function createUsageNotification(base44, companyId, featureName, used, total, status) {
  try {
    const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({
      company_id: companyId,
      is_administrator: true
    });

    // Get company to check if trial
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    const isTrial = company?.subscription_status === 'trial';

    for (const admin of staffProfiles) {
      const percentage = Math.round((used / total) * 100);
      
      const title = status === 'APPROACHING'
        ? `⚠️ ${percentage}% of ${featureName} used`
        : `🚨 ${featureName} limit reached`;

      let message = status === 'APPROACHING'
        ? `You've used ${used} of ${total} ${featureName} this month.`
        : `You've used all ${total} ${featureName} this month.`;

      if (isTrial) {
        message += ' You can purchase additional credits to continue using this feature.';
      } else {
        message += ' Upgrade your plan for higher limits.';
      }

      await base44.asServiceRole.entities.Notification.create({
        user_email: admin.user_email,
        company_id: companyId,
        title,
        message,
        type: 'usage_limit',
        is_read: false,
        link_url: isTrial ? '/pricing' : '/manage-subscription'
      });
    }
  } catch (error) {
    console.error(`Failed to create usage notification for ${featureName}:`, error);
  }
}