import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Test the QuickBooks sync function
    const result = await base44.functions.invoke('syncQuickBooks', {
      action: 'test_connection'
    });
    
    return Response.json(result.data);
  } catch (error) {
    console.error('Test error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});