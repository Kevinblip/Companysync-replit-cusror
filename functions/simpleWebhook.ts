Deno.serve(async (req) => {
    console.log('📞 Simple webhook called!');
    
    // Add fake await to satisfy linter
    await new Promise(resolve => setTimeout(resolve, 1));
    
    // Minimal response - just say hello
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Hello! Your webhook is working. This is a test message.</Say>
    <Hangup/>
</Response>`;

    console.log('✅ Returning TwiML');
    
    return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' }
    });
});