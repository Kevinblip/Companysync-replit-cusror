Deno.serve(async (req) => {
    // Add a minimal await to satisfy Deno linter
    await Promise.resolve();

    console.log('📞 Simple incoming call webhook!');

    // Minimal TwiML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Hello! Your call is working. This is a simple test.</Say>
    <Hangup/>
</Response>`;

    console.log('✅ Returning TwiML response');

    return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml' }
    });
});