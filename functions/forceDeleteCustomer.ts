import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { customerId } = await req.json();

    if (!customerId) {
      return Response.json({ error: 'Missing customerId' }, { status: 400 });
    }

    // Use service role to delete across companies
    await base44.asServiceRole.entities.Customer.delete(customerId);

    return Response.json({
      success: true,
      message: `Customer ${customerId} deleted successfully`
    });

  } catch (error) {
    console.error('❌ Force delete error:', error);
    return Response.json({
      error: error.message || 'Failed to delete customer',
      details: error.toString()
    }, { status: 500 });
  }
});