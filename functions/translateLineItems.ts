import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { descriptions } = await req.json();

    if (!Array.isArray(descriptions) || descriptions.length === 0) {
      return Response.json({ translations: [] });
    }

    const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Gemini API key not configured' }, { status: 500 });
    }

    const prompt = `You are a professional roofing/construction translator. Translate each of the following English line item descriptions to Spanish.

Rules:
- Return ONLY a valid JSON array of strings with the same number of elements
- Preserve technical codes (like "RFG", "VMTLWP", "IWS"), brand names, and measurements as-is
- Use roofing industry Spanish terminology
- No explanations, no extra text — only the JSON array

Descriptions to translate:
${JSON.stringify(descriptions)}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return Response.json({ error: 'No response from Gemini', translations: descriptions });
    }

    let translations: string[];
    try {
      const parsed = JSON.parse(rawText);
      translations = Array.isArray(parsed) ? parsed : descriptions;
      if (translations.length !== descriptions.length) {
        translations = descriptions;
      }
    } catch {
      return Response.json({ translations: descriptions });
    }

    return Response.json({ translations });

  } catch (error: any) {
    console.error('translateLineItems error:', error);
    return Response.json({ error: error.message, translations: [] }, { status: 500 });
  }
});
