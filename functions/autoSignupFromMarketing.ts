import { createClient } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const { userData, companyData } = await req.json();

        if (!userData?.email || !companyData?.name) {
            return Response.json({ error: 'Email and company name are required' }, { status: 400 });
        }

        console.log('🔄 Auto-signup from marketing site for:', userData.email);

        // Create service role client
        const appId = Deno.env.get('BASE44_APP_ID');
        const serviceKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
        
        if (!appId || !serviceKey) {
            throw new Error('BASE44_APP_ID or BASE44_SERVICE_ROLE_KEY not configured');
        }

        const base44 = createClient(appId, serviceKey);

        // Check for existing account first
        const existingCompanies = await base44.asServiceRole.entities.Company.filter({ email: userData.email });
        const existingStaff = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: userData.email });

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
            email: userData.email,
            phone: userData.phone || companyData.phone || '',
            address: companyData.address || '',
            city: companyData.city || '',
            state: companyData.state || '',
            zip: companyData.zip || '',
            industry: companyData.industry || 'roofing',
            subscription_plan: companyData.plan_type || 'professional',
            subscription_status: 'trial',
            trial_ends_at: trialEndDate.toISOString().split('T')[0],
            max_users: companyData.team_size ? parseInt(companyData.team_size) : 10,
            max_customers: 1000,
            setup_completed: false
        });

        console.log('✅ Company created:', company.id);

        // Invite user as admin
        const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
        await base44.asServiceRole.users.inviteUser(userData.email, 'admin', {
            redirectUrl: `${appUrl}/quick-setup`
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