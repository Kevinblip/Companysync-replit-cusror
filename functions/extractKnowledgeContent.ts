import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
    }

    try {
        const { type, source } = await req.json();
        const base44 = createClientFromRequest(req);

        if (!source) {
            return Response.json({ error: "Source is required" }, { status: 400 });
        }

        let extractedText = "";

        if (type === 'url') {
            // Scrape URL
            // 1. Fetch HTML
            try {
                const response = await fetch(source, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompanySyncBot/1.0)' }
                });
                if (!response.ok) throw new Error(`Failed to fetch URL: ${response.status}`);
                const html = await response.text();
                
                // 2. Use LLM to clean and extract relevant info
                // Truncate HTML to avoid context limits (e.g., first 100k chars)
                const truncatedHtml = html.substring(0, 100000);
                
                const llmResponse = await base44.integrations.Core.InvokeLLM({
                    prompt: `You are a data extraction specialist. 
                    Extract the key business information from this raw HTML content for a company knowledge base.
                    Focus on: 
                    - Company Name & Tagline
                    - Services Offered (Roofing, Siding, etc.)
                    - Service Areas / Locations
                    - Pricing / Free Inspection Policies
                    - Warranties / Guarantees
                    - specific brand names used (e.g. GAF, Owens Corning)
                    - Contact Info
                    
                    Ignore navigation menus, footers, scripts, and generic boilerplate.
                    Format as clean, concise text.
                    
                    HTML Content:
                    ${truncatedHtml}`,
                    // We don't use internet context here, we rely on the provided HTML
                });
                
                extractedText = llmResponse;

            } catch (e) {
                return Response.json({ error: `Failed to scrape URL: ${e.message}` }, { status: 500 });
            }
        } 
        else if (type === 'file') {
            // Extract from PDF/Doc using LLM vision/file capabilities
            try {
                const llmResponse = await base44.integrations.Core.InvokeLLM({
                    prompt: `Read this document and extract all relevant business information into a clear text format for a knowledge base.
                    Focus on:
                    - Services and Processes
                    - Pricing and Policies
                    - Company History and Values
                    - Technical Roofing Details
                    - FAQs
                    
                    Format as clean, concise text sections.`,
                    file_urls: [source]
                });
                
                extractedText = llmResponse;
            } catch (e) {
                return Response.json({ error: `Failed to process file: ${e.message}` }, { status: 500 });
            }
        } else {
            return Response.json({ error: "Invalid type. Must be 'url' or 'file'" }, { status: 400 });
        }

        return Response.json({ text: extractedText });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});