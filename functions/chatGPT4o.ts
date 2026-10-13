import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';
import OpenAI from 'npm:openai@4.75.0';

Deno.serve(async (req) => {
  console.log('🚀 chatGPT4o function called');
  
  try {
    const apiKey = Deno.env.get("Open_AI_Api_Key");
    
    if (!apiKey) {
      console.error('❌ OpenAI API key not found');
      return Response.json({
        success: false,
        error: 'Open_AI_Api_Key not configured'
      }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey });
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { prompt, fileUrls, responseJsonSchema } = body;

    if (!prompt) {
      return Response.json({ success: false, error: 'prompt is required' }, { status: 400 });
    }

    console.log('📝 Prompt length:', prompt.length);
    console.log('📎 Files:', fileUrls?.length || 0);

    // Build message content
    const userContent = [];

    // Add files
    if (fileUrls && Array.isArray(fileUrls) && fileUrls.length > 0) {
      for (const url of fileUrls) {
        userContent.push({
          type: 'image_url',
          image_url: { url: url, detail: 'high' }
        });
      }
    }
    
    userContent.push({
      type: 'text',
      text: 'Analyze this file and extract data as instructed.'
    });

    const requestBody = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: 4096,
      temperature: 0.1
    };

    if (responseJsonSchema) {
      requestBody.response_format = { type: "json_object" };
    }

    console.log('🤖 Calling OpenAI...');
    const completion = await openai.chat.completions.create(requestBody);
    
    const responseContent = completion.choices[0].message.content.trim();
    console.log('✅ Got response, length:', responseContent.length);

    if (responseJsonSchema) {
      // Try to parse JSON
      try {
        const parsed = JSON.parse(responseContent);
        return Response.json(parsed);
      } catch (parseError) {
        console.error('❌ JSON parse error');
        // Try extracting from markdown
        const jsonMatch = responseContent.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          return Response.json(parsed);
        }
        return Response.json({ 
          success: false, 
          error: 'Failed to parse JSON response',
          rawResponse: responseContent.substring(0, 500)
        }, { status: 500 });
      }
    }

    return Response.json({ response: responseContent });
    
  } catch (error) {
    console.error('💥 Error:', error.message);
    console.error('Stack:', error.stack);
    
    return Response.json({
      success: false,
      error: error.message,
      errorType: error.constructor.name,
      stack: error.stack
    }, { status: 500 });
  }
});