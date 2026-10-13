import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { model, prompt, file_urls, response_json_schema } = await req.json();

    console.log(`🤖 Using model: ${model || 'gemini'}`);

    // Check if any file is a PDF
    const hasPDF = file_urls && Array.isArray(file_urls) && file_urls.some(url => 
      url.toLowerCase().endsWith('.pdf')
    );

    // If PDF detected with GPT model, use Core.InvokeLLM instead (supports PDFs)
    if (model === 'gpt' && hasPDF) {
      console.log('📄 PDF detected with GPT model, using Core.InvokeLLM');
      const llmResponse = await base44.integrations.Core.InvokeLLM({
        prompt: prompt,
        file_urls: file_urls,
        response_json_schema: response_json_schema || null
      });

      // Core.InvokeLLM returns parsed JSON if schema provided, otherwise string
      return Response.json(llmResponse);
    }

    if (model === 'gpt') {
      // Use OpenAI GPT-4o (images only, no PDFs)
      const apiKey = Deno.env.get('Open_AI_Api_Key');
      if (!apiKey) {
        return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
      }

      const messages = [{ role: 'user', content: [] }];

      // Add text prompt
      messages[0].content.push({ type: 'text', text: prompt });

      // Add images if provided (GPT doesn't support PDFs)
      if (file_urls && Array.isArray(file_urls)) {
        for (const url of file_urls) {
          messages[0].content.push({
            type: 'image_url',
            image_url: { url: url }
          });
        }
      }

      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: messages,
          response_format: response_json_schema ? { type: 'json_object' } : undefined,
          temperature: 0.1
        })
      });

      const data = await openaiResponse.json();
      
      if (data.error) {
        console.error('OpenAI error:', data.error);
        return Response.json({ error: data.error.message }, { status: 500 });
      }

      const content = data.choices[0].message.content;

      // Parse JSON if schema was requested
      if (response_json_schema) {
        try {
          const parsed = JSON.parse(content);
          return Response.json(parsed);
        } catch (e) {
          console.error('Failed to parse OpenAI JSON response:', content);
          return Response.json({ error: 'Invalid JSON response from OpenAI' }, { status: 500 });
        }
      }

      return Response.json(content);

    } else {
      // Use Google Gemini Flash 2.5
      const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
      if (!apiKey) {
        return Response.json({ error: 'Gemini API key not configured' }, { status: 500 });
      }

      // Check if any file is a PDF
      const hasPDF = file_urls && Array.isArray(file_urls) && file_urls.some(url => 
        url.toLowerCase().endsWith('.pdf')
      );

      // If PDF detected, use Base44 Core.InvokeLLM (supports PDFs + vision)
      if (hasPDF) {
        console.log('📄 PDF detected, using Core.InvokeLLM');
        const llmResponse = await base44.integrations.Core.InvokeLLM({
          prompt: prompt,
          file_urls: file_urls,
          response_json_schema: response_json_schema || null
        });

        // Core.InvokeLLM returns parsed JSON if schema provided, otherwise string
        return Response.json(llmResponse);
      }

      // Otherwise, use direct Gemini API for images
      const parts = [{ text: prompt }];

      if (file_urls && Array.isArray(file_urls)) {
        for (const url of file_urls) {
          try {
            const imageResponse = await fetch(url);
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
            const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
            
            parts.push({
              inlineData: {
                mimeType: mimeType,
                data: base64Image
              }
            });
          } catch (e) {
            console.error(`Failed to fetch image: ${url}`, e);
          }
        }
      }

      const requestBody = {
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192
        }
      };

      if (response_json_schema) {
        requestBody.generationConfig.responseMimeType = 'application/json';
        requestBody.generationConfig.responseSchema = response_json_schema;
      }

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error('Gemini API error:', geminiResponse.status, errorText);
        return Response.json({ error: `Gemini API error: ${geminiResponse.status} - ${errorText}` }, { status: 500 });
      }

      const data = await geminiResponse.json();

      if (data.error) {
        console.error('Gemini error:', data.error);
        return Response.json({ error: data.error.message }, { status: 500 });
      }

      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!content) {
        console.error('No content in Gemini response:', JSON.stringify(data, null, 2));
        return Response.json({ error: 'No content in Gemini response' }, { status: 500 });
      }

      // Parse JSON if schema was requested
      if (response_json_schema) {
        try {
          const parsed = JSON.parse(content);
          return Response.json(parsed);
        } catch (e) {
          console.error('Failed to parse Gemini JSON response:', content);
          return Response.json({ error: 'Invalid JSON response from Gemini' }, { status: 500 });
        }
      }

      return Response.json(content);
    }

  } catch (error) {
    console.error('Model invocation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});