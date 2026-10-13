import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate user
    const user = await base44.auth.me();
    
    console.log('🔍 Delete request from:', user?.email);
    
    // Security: Only platform owner can delete companies
    if (user.platform_role !== 'super_admin') {
      console.error('❌ Unauthorized user:', user.email);
      return Response.json({ error: 'Unauthorized: Platform owner only' }, { status: 403 });
    }
    
    const { companyId } = await req.json();
    
    console.log('🗑️ Deleting company ID:', companyId);
    
    if (!companyId) {
      return Response.json({ error: 'Company ID is required' }, { status: 400 });
    }
    
    // First, get the company to verify it exists
    const company = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    
    if (!company || company.length === 0) {
      console.error('❌ Company not found:', companyId);
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }
    
    console.log('✅ Found company:', company[0].company_name);
    
    // Use service role to HARD delete company
    await base44.asServiceRole.entities.Company.delete(companyId);
    
    console.log('✅ Company HARD deleted successfully');
    const result = { success: true };
    
    return Response.json({ success: true, company: company[0].company_name });
    
  } catch (error) {
    console.error('❌ Delete company error:', error);
    return Response.json({ error: error.message || 'Unknown error occurred' }, { status: 500 });
  }
});