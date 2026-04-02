import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slides, videoTitle, customInstructions, masterNarrationPrompt } = await req.json();

    if (!slides || slides.length === 0) {
      return Response.json({ error: 'No slides provided' }, { status: 400 });
    }

    console.log(`Generating master narration for ${slides.length} slides...`);

    // Prepare slide context text
    let slidesContext = "";
    const imageUrls = [];

    slides.forEach((slide, index) => {
      slidesContext += `\n--- SLIDE ${index + 1} ---\n`;
      slidesContext += `TOPIC: ${slide.topic || 'General Overview'}\n`;
      if (slide.focus_area) slidesContext += `FOCUS AREA (Describe this): ${slide.focus_area}\n`;
      if (slide.ignore_area) slidesContext += `IGNORE AREA (Do NOT mention): ${slide.ignore_area}\n`;
      if (slide.caption) slidesContext += `CAPTION: ${slide.caption}\n`;
      
      if (slide.imageUrl) {
        imageUrls.push(slide.imageUrl);
      }
    });

    // Combine master prompt with custom instructions for full context
    const fullInstructions = [masterNarrationPrompt, customInstructions].filter(Boolean).join('\n\n');

    const prompt = `You are a professional software trainer creating a cohesive video tutorial narration.
    
VIDEO TITLE: "${videoTitle || 'Training Video'}"

${fullInstructions ? `
=== USER'S SPECIFIC INSTRUCTIONS (FOLLOW THESE CLOSELY!) ===
${fullInstructions}
=== END USER INSTRUCTIONS ===
` : ''}

YOUR GOAL:
Create a single, flowing narration script where each segment corresponds EXACTLY to the specific slide topic.
${fullInstructions ? `IMPORTANT: The user has provided specific instructions above - prioritize following them!` : ''}

CRITICAL RULES FOR ACCURACY:
1. **STRICT TOPIC ADHERENCE**: The narration for Slide X must be ONLY about the TOPIC defined for Slide X.
2. **IGNORE IRRELEVANT UI**: If the slide topic is "Email", do NOT describe "Calling" buttons even if they are visible in the screenshot.
3. **RESPECT FOCUS/IGNORE**: If "IGNORE AREA" says "Dashboard", pretend the dashboard doesn't exist. Only describe the "FOCUS AREA".
4. **ONE IDEA PER SLIDE**: Do not bleed concepts from Slide 3 into Slide 4. Finish the thought for Slide 3, then transition ("Next...") and immediately start talking about the TOPIC of Slide 4.
5. **NO GENERIC FLUFF**: Do NOT end narrations with generic value statements like "This makes your life easier," "Quick setup is vital," or "Now you are ready to go." Just state the action or fact.
6. **FIRST SLIDE (INTRO)**: The narration for Slide 1 MUST start with a brief, friendly introduction to the video topic (e.g., "Welcome to this training on [Video Title]...").
7. **LAST SLIDE (OUTRO)**: The narration for the FINAL slide MUST conclude the video (e.g., "That covers the basics of [Topic]. Thanks for watching.").
${fullInstructions?.toLowerCase().includes('short') ? '8. **LENGTH**: User requested SHORT narrations - keep each slide to 1-2 sentences max.' : ''}
${fullInstructions?.toLowerCase().includes('long') || fullInstructions?.toLowerCase().includes('detailed') ? '8. **LENGTH**: User requested DETAILED narrations - be thorough and explanatory for each slide.' : ''}

  INPUT CONTEXT:

SLIDE SEQUENCE:
${slidesContext}

GUIDELINES:
- **Flow**: You may START a narration with a transition (e.g., "Moving on..."), but NEVER end a narration by previewing the next slide.
- **NO PREVIEWS**: Do not say "Next we will see..." or "Up next..." at the end of a slide. Stop immediately after covering the current topic.
- **Tone**: Professional, encouraging, and clear.
- **Action-Oriented**: Tell the user what to do or what they are looking at regarding the *current* topic.

OUTPUT FORMAT:
You must return a JSON object with a single key "narrations" containing an array of strings.
Each string must be the narration for the corresponding slide index.
The array length MUST match the number of slides exactly (${slides.length}).

Example JSON structure:
{
  "narrations": [
    "Welcome to the training. Here is the dashboard...",
    "Next, click on the settings icon...",
    "Finally, save your changes."
  ]
}
`;

    // Call LLM
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: prompt,
      file_urls: imageUrls,
      add_context_from_internet: false,
      response_json_schema: {
        type: "object",
        properties: {
          narrations: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["narrations"]
      }
    });

    // Parse response
    let narrations = [];
    if (response && response.narrations) {
        narrations = response.narrations;
    } else if (response && response.output && response.output.narrations) {
        narrations = response.output.narrations;
    } else {
         // Fallback manual parse if needed (though InvokeLLM usually handles it with schema)
         try {
             const parsed = typeof response === 'string' ? JSON.parse(response) : response;
             narrations = parsed.narrations || [];
         } catch (e) {
             console.error("Failed to parse LLM response:", e);
             return Response.json({ error: "Failed to generate valid JSON narration" }, { status: 500 });
         }
    }

    if (narrations.length !== slides.length) {
        console.warn(`Mismatch in narration count. Slides: ${slides.length}, Narrations: ${narrations.length}`);
        // We might want to handle this gracefully or return an error. 
        // For now, let's return what we have, the frontend can map by index.
    }

    return Response.json({ narrations });

  } catch (error) {
    console.error('Error generating master narration:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});