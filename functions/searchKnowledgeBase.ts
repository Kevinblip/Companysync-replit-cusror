import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { query, companyId } = await req.json();

    if (!query) {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }

    // Get all published articles
    const articles = await base44.asServiceRole.entities.KnowledgeBaseArticle.filter({
      company_id: companyId,
      is_published: true
    }, '-priority', 100);

    if (articles.length === 0) {
      return Response.json({ results: [], suggested_articles: [] });
    }

    // Use OpenAI to find relevant articles
    const openaiApiKey = Deno.env.get('Open_AI_Api_Key');
    if (!openaiApiKey) {
      return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Create article context for AI
    const articleContext = articles.map(a => ({
      id: a.id,
      title: a.title,
      content: a.content.substring(0, 500),
      category: a.category,
      tags: a.tags
    }));

    const systemPrompt = `You are a helpful assistant that matches user queries to relevant knowledge base articles.

Here are the available articles:
${JSON.stringify(articleContext, null, 2)}

Based on the user's query, identify the most relevant articles.
Return ONLY a JSON array of article IDs, ordered by relevance (most relevant first).
Return up to 5 articles.

Example response: ["article_id_1", "article_id_2", "article_id_3"]`;

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
          { role: 'user', content: query }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result = await response.json();
    const aiResponse = result.choices[0].message.content;

    let relevantArticleIds = [];
    try {
      relevantArticleIds = JSON.parse(aiResponse);
    } catch (e) {
      // Try to extract JSON from markdown code block
      const jsonMatch = aiResponse.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        relevantArticleIds = JSON.parse(jsonMatch[0]);
      }
    }

    // Get full article details
    const relevantArticles = relevantArticleIds
      .map(id => articles.find(a => a.id === id))
      .filter(Boolean);

    return Response.json({
      results: relevantArticles,
      query: query
    });

  } catch (error) {
    console.error('Search error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});