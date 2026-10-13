import { createClient } from 'npm:@base44/sdk@0.8.6';
import { validateSignupEmail } from './signupSafety.ts';

Deno.serve(async (req) => {
    try {
        const { userData, companyData } = await req.json();

        if (!userData?.email || !companyData?.name) {
            return Response.json({ error: 'Email and company name are required' }, { status: 400 });
        }
        const emailCheck = validateSignupEmail(userData.email);
        if (!emailCheck.allowed) {
            return Response.json({ error: emailCheck.reason }, { status: 400 });
        }
        const email = emailCheck.email;

        console.log('🔄 Auto-signup from marketing site for:', email);

        // Create service role client
        const appId = Deno.env.get('BASE44_APP_ID');
        const serviceKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
        
        if (!appId || !serviceKey) {
            throw new Error('BASE44_APP_ID or BASE44_SERVICE_ROLE_KEY not configured');
        }

        const base44 = createClient(appId, serviceKey);

        // Check for existing account first
        const existingCompanies = await base44.asServiceRole.entities.Company.filter({ email });
        const existingStaff = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: email });

        if (existingCompanies.length > 0 || existingStaff.length > 0) {
             return Response.json({ 
                error: 'An account with this email already exists. Please log in instead.',
                redirect: '/login'
            }, { status: 400 });
        }

        // Calculate trial end date (14 days from now)
        const trialEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

        // Create company with trial settings
        const company = await base44.asServiceRole.entities.Company.create({
            company_name: companyData.name,
            email,
            phone: userData.phone || companyData.phone || '',
            address: companyData.address || '',
            city: companyData.city || '',
            state: companyData.state || '',
            zip: companyData.zip || '',
            industry: companyData.industry || 'roofing',
             subscription_plan: companyData.plan_type || 'basic',
            // Keep the company pending until the shared trial transition has
            // recorded the platform signup event and sent the admin alerts.
            subscription_status: 'pending',
            trial_ends_at: trialEndDate.toISOString().split('T')[0],
            max_users: companyData.team_size ? parseInt(companyData.team_size) : 10,
            max_customers: 1000,
            setup_completed: false
        });

        console.log('✅ Company created:', company.id);

        // Reuse the guarded trial-start flow rather than marking this marketing
        // signup trial-active directly. That flow owns the signup event and the
        // platform email/SMS alert, and its deterministic event claim makes
        // retries safe.
        const owner = await base44.asServiceRole.entities.StaffProfile.create({
            company_id: company.id,
            name: userData.full_name || email,
            full_name: userData.full_name || email,
            email,
            user_email: email,
            role: 'admin',
            is_administrator: true,
            is_active: true,
        });
        const trialStartResult = await base44.asServiceRole.functions.invoke('startCompanyTrial', {
            companyId: company.id,
            plan: companyData.plan_type || 'basic',
            internalSecret: serviceKey,
        });
        const trialStart = trialStartResult?.data || trialStartResult;
        if (!trialStart?.success) {
            throw new Error(trialStart?.error || 'Unable to start the free trial');
        }

        // Invite user as admin
        const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
        await base44.asServiceRole.users.inviteUser(email, 'admin', {
             redirectUrl: `${appUrl}/QuickSetup`
        });

        console.log('✅ User invited:', userData.email);

        return Response.json({ 
            success: true,
            message: 'Account created! Check your email to complete setup.',
            company_id: company.id
        });

    } catch (error) {
        console.error('❌ Auto-signup error:', error);
        
        if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
            return Response.json({ 
                error: 'An account with this email already exists.',
                redirect: '/dashboard'
            }, { status: 400 });
        }
        
        return Response.json({ 
            error: error.message || 'Signup failed. Please try again.' 
        }, { status: 500 });
    }
});