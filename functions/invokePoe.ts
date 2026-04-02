import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { messages, bot_name = "Claude-Opus-4.6" } = await req.json();

        const poeClient = new OpenAI({
            apiKey: Deno.env.get("POE_API_KEY"),
            baseURL: "https://api.poe.com/v1",
        });

        const completion = await poeClient.chat.completions.create({
            model: bot_name,
            messages: messages || [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Hello!" }
            ],
        });

        return Response.json(completion);

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});