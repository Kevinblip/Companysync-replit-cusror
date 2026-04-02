import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    
    const test = async (url) => {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({})
            });
            return { url, status: res.status };
        } catch (e) {
            return { url, error: e.message };
        }
    };

    // Models to test
    const models = ['gemini-2.0-flash-exp', 'gemini-2.0-flash'];
    const versions = ['v1alpha', 'v1beta'];
    const actions = [':connect?alt=sdp', ':streamGenerateContent'];
    
    const tests = [];
    for (const model of models) {
        for (const ver of versions) {
            for (const action of actions) {
                const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}${action}`;
                tests.push(test(url));
            }
        }
    }

    const results = await Promise.all(tests);
    return Response.json({ results });
});