import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's company - check owned companies first, then staff profiles
    const ownedCompanies = await base44.asServiceRole.entities.Company.filter({ 
      created_by: user.email 
    });

    let companyId = ownedCompanies[0]?.id;

    if (!companyId) {
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
        user_email: user.email 
      });
      
      if (!staffProfiles || staffProfiles.length === 0) {
        return Response.json({ error: 'No company assigned' }, { status: 403 });
      }

      companyId = staffProfiles[0].company_id;
    }

    // Generate a temporary token valid for 1 hour
    const tokenData = {
      company_id: companyId,
      user_email: user.email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour expiry
    };

    // Simple JWT-like token (sign with a shared secret)
    const secret = Deno.env.get('LEXI_VOICE_BRIDGE_SECRET');
    if (!secret) {
      return Response.json({ error: 'Bridge secret not configured' }, { status: 500 });
    }

    const tokenString = JSON.stringify(tokenData);
    const payloadB64 = btoa(tokenString);
    const encoder = new TextEncoder();
    const keyData = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await globalThis.crypto.subtle.sign(
      'HMAC',
      keyData,
      encoder.encode(payloadB64)
    );

    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    const token = payloadB64 + '.' + sigB64;

    return Response.json({
      token,
      expires_in: 3600,
      bridge_url: (Deno.env.get('LEXI_VOICE_BRIDGE_URL') || 'wss://lexi-bridge-prod.railway.app').trim()
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});