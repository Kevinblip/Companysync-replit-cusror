Deno.serve(async (req) => {
    const now = new Date().toISOString();
    console.log('🔔 WEBHOOK HIT at', now);
    console.log('🔔 Method:', req.method);
    console.log('🔔 URL:', req.url);
    console.log('🔔 Content-Type:', req.headers.get('content-type'));
    
    // Try to read body
    try {
        const contentType = req.headers.get('content-type') || '';
        if (contentType.includes('application/x-www-form-urlencoded')) {
            const formData = await req.formData();
            const entries = {};
            for (const [key, value] of formData.entries()) {
                entries[key] = value;
            }
            console.log('🔔 Form data:', JSON.stringify(entries));
        } else {
            const text = await req.text();
            console.log('🔔 Body:', text.substring(0, 500));
        }
    } catch (e) {
        console.log('🔔 Could not read body:', e.message);
    }
    
    // Return simple TwiML that should ALWAYS work
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">This is a test. The webhook is working. Goodbye.</Say>
</Response>`;
    
    return new Response(twiml, { 
        status: 200,
        headers: { 'Content-Type': 'text/xml' } 
    });
});