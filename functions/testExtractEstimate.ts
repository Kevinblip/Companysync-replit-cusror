import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';
import OpenAI from 'npm:openai@4.75.0';

Deno.serve(async (req) => {
  const diagnostics = {
    step: '',
    error: null,
    details: {}
  };

  try {
    diagnostics.step = 'Checking API Key';
    const apiKey = Deno.env.get("Open_AI_Api_Key");
    
    if (!apiKey) {
      diagnostics.error = 'Open_AI_Api_Key not set in environment variables';
      return Response.json({ success: false, diagnostics }, { status: 200 });
    }
    diagnostics.details.apiKeySet = true;

    diagnostics.step = 'Initializing OpenAI';
    const openai = new OpenAI({ apiKey });
    diagnostics.details.openaiInitialized = true;

    diagnostics.step = 'Checking authentication';
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      diagnostics.error = 'User not authenticated';
      return Response.json({ success: false, diagnostics }, { status: 200 });
    }
    diagnostics.details.userEmail = user.email;

    diagnostics.step = 'Parsing request body';
    const body = await req.json();
    const { fileUrl } = body;
    
    if (!fileUrl) {
      diagnostics.error = 'No fileUrl provided in request';
      diagnostics.details.bodyReceived = body;
      return Response.json({ success: false, diagnostics }, { status: 200 });
    }
    diagnostics.details.fileUrl = fileUrl;

    diagnostics.step = 'Testing OpenAI API with simple request';
    const testResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say "test successful"' }
      ],
      max_tokens: 50
    });
    
    diagnostics.details.openaiTestResponse = testResponse.choices[0].message.content;

    diagnostics.step = 'Fetching file from URL';
    const fileResponse = await fetch(fileUrl);
    
    if (!fileResponse.ok) {
      diagnostics.error = `Failed to fetch file: ${fileResponse.status} ${fileResponse.statusText}`;
      return Response.json({ success: false, diagnostics }, { status: 200 });
    }
    
    const contentType = fileResponse.headers.get('content-type');
    const contentLength = fileResponse.headers.get('content-length');
    
    diagnostics.details.fileContentType = contentType;
    diagnostics.details.fileSize = contentLength;

    diagnostics.step = 'Testing vision API with actual file';
    const visionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: fileUrl, detail: 'low' }
            },
            {
              type: 'text',
              text: 'What do you see in this image? One sentence only.'
            }
          ]
        }
      ],
      max_tokens: 100
    });
    
    diagnostics.details.visionTestResponse = visionResponse.choices[0].message.content;
    diagnostics.step = 'All tests passed!';

    return Response.json({ 
      success: true, 
      diagnostics,
      message: 'All diagnostic tests passed successfully!'
    });

  } catch (error) {
    diagnostics.error = error.message;
    diagnostics.details.errorType = error.constructor.name;
    diagnostics.details.errorStack = error.stack;
    
    console.error('💥 Diagnostic Error at step:', diagnostics.step);
    console.error('Error:', error);
    
    return Response.json({ 
      success: false, 
      diagnostics 
    }, { status: 200 });
  }
});