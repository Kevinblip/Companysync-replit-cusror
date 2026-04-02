import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Service role bypasses permissions to ensure deletion
    const companyId = '6961796a3304849340f46823'; // The duplicate "Yicn Roofing "
    
    console.log(`Attempting to delete company ${companyId} via service role...`);
    
    // 1. Delete the company record
    await base44.asServiceRole.entities.Company.delete(companyId);
    
    // 2. Also delete any related records specifically tied to this company if needed
    // (Optional, but good for cleanup)
    
    return Response.json({ success: true, message: `Company ${companyId} deleted.` });
  } catch (error) {
    console.error('Deletion error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});