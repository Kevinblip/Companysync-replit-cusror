import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { articleId, content } = await req.json();

    if (!content) {
      return Response.json({ error: 'Content is required' }, { status: 400 });
    }

    const openaiApiKey = Deno.env.get('Open_AI_Api_Key');
    if (!openaiApiKey) {
      return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const systemPrompt = `You are a helpful assistant that summarizes knowledge base articles into clear, concise bullet points.

Create a summary with 3-5 key bullet points that capture the main ideas.
Make each bullet point actionable and easy to understand.
Use simple language.

Format your response as a JSON object with a "summary" field containing an array of bullet points.

Example:
{
  "summary": [
    "Main point 1",
    "Main point 2",
    "Main point 3"
  ]
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Summarize this article:\n\n${content}` }
        ],
        temperature: 0.5,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result = await response.json();
    const aiResponse = result.choices[0].message.content;
    const parsed = JSON.parse(aiResponse);

    // Save summary to article if articleId provided
    if (articleId) {
      await base44.asServiceRole.entities.KnowledgeBaseArticle.update(articleId, {
        summary: parsed.summary.join('\n')
      });
    }

    return Response.json({
      summary: parsed.summary
    });

  } catch (error) {
    console.error('Summarize error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});