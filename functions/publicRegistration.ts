import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// This function now only stores the selected plan in session
// The actual company creation happens after the user logs in (in QuickSetup page)
Deno.serve(async (req) => {
    try {
        const { email, selected_plan = {} } = await req.json();

        if (!email) {
            return Response.json({ error: 'Email is required' }, { status: 400 });
        }

        console.log('🔄 Public registration request for:', email);

        // Store selected plan info to pass along (will be stored in URL params)
        const planName = (selected_plan?.name || 'professional').toLowerCase();
        
        // Return success with redirect info - user will be invited via Base44's standard flow
        // The plan info is encoded in the URL so QuickSetup can use it
        const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
        const redirectUrl = `${appUrl}/QuickSetup?plan=${planName}&new_signup=true`;

        return Response.json({ 
            success: true,
            message: 'Please check your email to complete registration.',
            email,
            redirectUrl,
            planName,
            // Instructions for the frontend
            action: 'redirect_to_login',
            loginUrl: `${appUrl}?invite_email=${encodeURIComponent(email)}`
        });

    } catch (error) {
        console.error('❌ Registration error:', error);
        return Response.json({ 
            error: error.message || 'Registration failed. Please try again.' 
        }, { status: 500 });
    }
});