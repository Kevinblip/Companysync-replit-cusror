Deno.serve(async (req) => {
    console.log('🧪 TEST: Incoming call webhook hit!');
    
    // Add a fake await to satisfy Deno linter
    await new Promise(resolve => setTimeout(resolve, 1));
    
    // Ultra-simple response - no database, no logic, just TwiML
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Hello! This is a test. Your webhook is working correctly. Goodbye.</Say>
    <Hangup/>
</Response>`;

    console.log('✅ TEST: Returning TwiML');
    
    return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' }
    });
});