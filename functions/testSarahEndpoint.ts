import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    console.log('🧪 TEST ENDPOINT HIT!');
    console.log('🧪 Method:', req.method);
    console.log('🧪 URL:', req.url);
    
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Test successful! Your webhook is working.</Say>
    <Hangup/>
</Response>`, {
        headers: { 'Content-Type': 'text/xml' }
    });
});