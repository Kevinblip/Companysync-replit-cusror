import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  console.log('🎤 Lexi Voice Bridge - Thin wrapper to lexiChat brain');
  
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Please log in' }, { status: 401 });
    }
    
    const body = await req.json();
    const { transcription, conversationHistory, companyId } = body;

    if (!transcription) {
      return Response.json({ error: 'No transcription provided' }, { status: 400 });
    }

    console.log('🎤 Transcription:', transcription);

    // Get company context
    const ownedCompanies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
    const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
    
    const allowedCompanyIds = new Set([
      ...ownedCompanies.map(c => c.id),
      ...staffProfiles.map(sp => sp.company_id)
    ].filter(Boolean));

    let actualCompanyId = companyId;
    if (companyId && !allowedCompanyIds.has(companyId)) {
      console.warn(`🚨 SECURITY: User ${user.email} tried to access unauthorized company ${companyId}`);
      return Response.json({ error: 'Unauthorized company access' }, { status: 403 });
    }
    
    if (!actualCompanyId) {
      actualCompanyId = ownedCompanies[0]?.id || staffProfiles[0]?.company_id;
    }
    
    if (!actualCompanyId) {
      return Response.json({
        textResponse: "Please set up your company profile first.",
        updatedHistory: conversationHistory || []
      });
    }

    // ONE BRAIN: Call lexiChat with full user context preserved
    console.log('🧠 Delegating to lexiChat brain...');
    console.log('👤 User:', user.full_name, 'Email:', user.email);
    
    const lexiResponse = await base44.functions.invoke('lexiChat', {
      message: transcription,
      conversationHistory: conversationHistory || [],
      companyId: actualCompanyId,
      userEmail: user.email, // Explicitly pass authenticated user
      userName: user.full_name
    });

    // Update history with this turn
    const updatedHistory = [
      ...(conversationHistory || []),
      { role: 'user', content: transcription },
      { role: 'assistant', content: lexiResponse.data?.response || lexiResponse.data?.textResponse }
    ];

    console.log('✅ Lexi response:', lexiResponse.data?.response?.substring(0, 100));

    return Response.json({
      textResponse: lexiResponse.data?.response || "I'm not sure how to help with that.",
      updatedHistory: updatedHistory,
      actions_executed: lexiResponse.data?.actions_executed || []
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    return Response.json({ 
      textResponse: "I encountered an error. Please try again.",
      error: error.message
    }, { status: 500 });
  }
});