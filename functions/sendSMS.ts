import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { sendSMSInternal } from './utils/smsSender.js';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const payload = await req.json();
        let user = null;

        // Allow bypassing auth if trusted flag is present (for internal system calls)
        if (!payload.calledFromService) {
            user = await base44.auth.me();
            if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

            // 🔒 SECURITY CHECK: Ensure user has access to the requested companyId
            if (payload.companyId) {
                // Allow CompanySync Super Admin to impersonate anyone
                const isSuperAdmin = user.platform_role === 'super_admin'; 
                
                if (!isSuperAdmin) {
                    // Check if user owns the company
                    const company = await base44.asServiceRole.entities.Company.filter({ id: payload.companyId });
                    const isOwner = company.length > 0 && company[0].created_by === user.email;

                    // Check if user is staff of the company
                    const staff = await base44.asServiceRole.entities.StaffProfile.filter({ 
                        user_email: user.email, 
                        company_id: payload.companyId 
                    });
                    const isStaff = staff.length > 0;

                    if (!isOwner && !isStaff) {
                        console.error(`⛔ ACCESS DENIED: User ${user.email} tried to send SMS for company ${payload.companyId}`);
                        return Response.json({ error: 'Forbidden: You do not have access to this company.' }, { status: 403 });
                    }
                }
            }
        }

        const { to, companyId, contactName } = payload;
        const body = payload.body || payload.message;

        // 🔒 CHECK SUBSCRIPTION LIMIT FOR SMS (skip for CompanySync)
        if (companyId) {
            const company = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            const isCompanySync = company?.length > 0 && company[0].company_name === 'CompanySync';
            
            if (!isCompanySync) {
                const limitCheck = await base44.functions.invoke('checkSubscriptionLimit', {
                    company_id: companyId,
                    feature_type: 'sms',
                    amount: 1
                });

                if (!limitCheck.data?.allowed) {
                    return Response.json({ 
                        error: `SMS limit exceeded. ${limitCheck.data?.error || 'Upgrade your plan to send more SMS messages.'}`,
                        remaining: limitCheck.data?.remaining || 0
                    }, { status: 429 });
                }
            }
        }

        const result = await sendSMSInternal(base44, {
            to,
            body,
            companyId,
            contactName,
            userEmail: user?.email
        });

        // ✅ UPDATE USAGE AFTER SUCCESSFUL SEND (skip for CompanySync)
        if (result.success && companyId) {
            const company = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            const isCompanySync = company?.length > 0 && company[0].company_name === 'CompanySync';
            
            if (!isCompanySync) {
                await base44.functions.invoke('updateSubscriptionUsage', {
                    company_id: companyId,
                    feature_type: 'sms',
                    amount: 1
                }).catch(err => console.error('Failed to update SMS usage:', err));
            }
        }

        return Response.json(result);

    } catch (error) {
        console.error('SMS Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});