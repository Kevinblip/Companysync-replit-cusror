import { createClient } from 'npm:@base44/sdk@0.8.6';

/**
 * Public endpoint to invite new users during signup
 * Uses service role via createClient with app credentials
 */
Deno.serve(async (req) => {
  try {
    const { email, full_name, selected_plan, onboarding_data } = await req.json();
    
    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email is required' }, { status: 400 });
    }
    
    console.log('📧 Public signup invitation request for:', email);
    
    // Create client using app ID (service role context)
    const appId = Deno.env.get('BASE44_APP_ID');
    
    if (!appId) {
      console.error('❌ Missing BASE44_APP_ID');
      return Response.json({ 
        success: false, 
        error: 'Server configuration error' 
      }, { status: 500 });
    }
    
    // Use the Base44 API directly to invite user
    // Since the SDK's asServiceRole doesn't support users.inviteUser,
    // we need to make a direct API call
    const apiUrl = `https://api.base44.com/v1/apps/${appId}/users/invite`;
    
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.get('Authorization') || '',
          'X-App-Id': appId
        },
        body: JSON.stringify({
          email: email,
          role: 'admin'
        })
      });
      
      const result = await response.json();
      
      if (response.ok || result.success) {
        console.log('✅ Invitation sent successfully to:', email);
        return Response.json({ 
          success: true,
          message: 'Invitation sent! Please check your email.',
          email
        });
      }
      
      // Check if user already exists
      const errorMsg = result.error || result.message || '';
      if (errorMsg.toLowerCase().includes('already') || 
          errorMsg.toLowerCase().includes('exists') ||
          errorMsg.toLowerCase().includes('duplicate')) {
        return Response.json({ 
          success: false,
          error: 'already_exists',
          message: 'This email is already registered. Please log in instead.',
          email
        });
      }
      
      // Check for "outside the app" error - means app is private
      if (errorMsg.toLowerCase().includes('outside')) {
        console.log('⚠️ App is private, attempting alternative signup flow');
        return Response.json({ 
          success: false,
          error: 'app_private',
          message: 'Please contact us to request access, or use the login page if you already have an account.',
          email
        });
      }
      
      console.error('❌ Invite API error:', result);
      return Response.json({ 
        success: false,
        error: errorMsg || 'Failed to send invitation'
      }, { status: 400 });
      
    } catch (inviteErr) {
      console.error('❌ Invite error:', inviteErr);
      return Response.json({ 
        success: false,
        error: inviteErr.message || 'Failed to send invitation'
      }, { status: 400 });
    }
    
  } catch (error) {
    console.error('❌ Public signup error:', error);
    return Response.json({ 
      error: error.message || 'Signup failed. Please try again.' 
    }, { status: 500 });
  }
});