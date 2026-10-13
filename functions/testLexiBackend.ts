import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    console.log('🧪 Test function started');
    
    const base44 = createClientFromRequest(req);
    
    console.log('🔍 Checking auth...');
    const user = await base44.auth.me();
    console.log('✅ User:', user?.email);
    
    if (!user) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    console.log('🤖 Testing LLM integration...');
    
    const llmResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: "Say 'Hello from Lexi test!'",
        response_json_schema: {
          type: "object",
          properties: {
            response: { type: "string" }
          },
          required: ["response"]
        }
    });
    
    console.log('✅ LLM responded:', llmResponse);
    
    return Response.json({ 
      success: true, 
      user: user.email,
      llmResponse: llmResponse
    });

  } catch (error) {
    console.error('💥 ERROR:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});