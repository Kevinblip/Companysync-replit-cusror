import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function escapeXml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe).replace(/[<>&"']/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '"': return '&quot;';
            case "'": return '&apos;';
        }
    });
}

const VOICE_MAP = {
    'Puck': 'en-US-Journey-F',
    'Aoede': 'en-US-Studio-O',
    'Charon': 'en-US-Studio-Q',
    'Fenrir': 'en-US-Studio-M',
    'Kore': 'en-US-Journey-F',
    'Sage': 'en-US-Journey-O',
    'Orion': 'en-US-Journey-D',
};

// In-memory cache for settings (per company, per isolate lifetime)
const settingsCache = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function loadSettings(companyId, base44Client) {
    const now = Date.now();
    const cached = settingsCache[companyId];
    if (cached && (now - cached.ts) < CACHE_TTL_MS) {
        console.log(`⚡ Settings from cache (${Math.round((now - cached.ts)/1000)}s old)`);
        return cached.data;
    }

    const loadStart = Date.now();
    
    // Load settings + training data + plans ALL in parallel
    const [settingsResult, trainingResult, plansResult] = await Promise.allSettled([
        base44Client.asServiceRole.entities.AssistantSettings.filter({ company_id: companyId }),
        base44Client.asServiceRole.entities.AITrainingData.filter({ company_id: companyId, is_active: true }),
        base44Client.asServiceRole.entities.SubscriptionPlan.filter({})
    ]);

    const sarahSettings = settingsResult.status === 'fulfilled' ? settingsResult.value[0] : null;
    if (!sarahSettings) {
        console.log(`⚠️ No Sarah settings for company ${companyId}`);
        settingsCache[companyId] = { ts: now, data: { sarahSettings: null, systemPrompt: '', knowledgeBase: '', voiceId: 'Puck' } };
        return settingsCache[companyId].data;
    }

    const systemPrompt = sarahSettings.system_prompt || '';
    
    // Resolve voice
    const rawVoiceId = sarahSettings.voice_id || 'Puck';
    const validVoices = Object.keys(VOICE_MAP);
    const voiceId = validVoices.includes(rawVoiceId) ? rawVoiceId : 'Puck';

    // Build knowledge base
    const kbParts = [];
    if (sarahSettings.website_urls?.length > 0) {
        kbParts.push(`Company websites: ${sarahSettings.website_urls.join(', ')}`);
    }
    if (sarahSettings.knowledge_base) {
        kbParts.push(sarahSettings.knowledge_base);
    }
    if (sarahSettings.custom_responses) {
        kbParts.push(`Custom responses: ${JSON.stringify(sarahSettings.custom_responses)}`);
    }

    // Process training data
    let trainingData = trainingResult.status === 'fulfilled' ? trainingResult.value : [];
    if (trainingData.length === 0) {
        // One fallback attempt for global training data
        try {
            trainingData = await base44Client.asServiceRole.entities.AITrainingData.filter({ is_active: true });
        } catch (e) { /* ignore */ }
    }
    if (trainingData.length > 0) {
        const sorted = trainingData.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        for (const td of sorted.slice(0, 5)) { // Limit to top 5 for speed
            if (td.content) {
                kbParts.push(`[${td.title || td.data_type}]: ${td.content.substring(0, 1500)}`);
            }
        }
    }

    // Process subscription plans
    if (plansResult.status === 'fulfilled' && plansResult.value.length > 0) {
        let plansSummary = "PRICING:\n";
        plansResult.value.filter(p => p.is_active).forEach(plan => {
            plansSummary += `- ${plan.plan_name}: $${plan.monthly_price}/mo. ${plan.description || ''}\n`;
        });
        kbParts.push(plansSummary);
    }

    const result = {
        sarahSettings,
        systemPrompt,
        knowledgeBase: kbParts.join('\n\n'),
        voiceId,
    };

    settingsCache[companyId] = { ts: now, data: result };
    console.log(`📋 Settings loaded in ${Date.now() - loadStart}ms | prompt=${systemPrompt.length}ch kb=${result.knowledgeBase.length}ch voice=${voiceId}`);
    return result;
}

// Build a direct TTS streaming URL — Twilio fetches audio directly from sarahGoogleTTS
// This eliminates the slow upload step (saves 1-2 seconds per response)
function getTTSStreamUrl(text, voiceId) {
    const appUrl = (Deno.env.get('APP_URL') || 'https://getcompanysync.com').replace(/\/+$/, '');
    const encodedText = encodeURIComponent(text);
    const encodedVoice = encodeURIComponent(voiceId || 'default');
    return `${appUrl}/api/functions/sarahGoogleTTS?text=${encodedText}&voice_id=${encodedVoice}`;
}

// Build TwiML with streaming TTS and <Say> fallback for resilience
function buildTTSTwiml(text, voiceId) {
    const audioUrl = getTTSStreamUrl(text, voiceId);
    return `<Play>${escapeXml(audioUrl)}</Play>`;
}

// Quick responses for simple conversational patterns
function getQuickResponse(speech) {
    const lower = speech.toLowerCase().trim();
    
    // Goodbye/done
    const noPatterns = ["no", "nope", "not really", "no thanks", "no thank you", "that's all", "i'm good", "nothing else", "all good", "all set"];
    for (const p of noPatterns) {
        if (lower === p || lower.startsWith(p + " ") || lower.endsWith(" " + p)) {
            return { text: "Thanks for calling! Have a great day. Bye!", isGoodbye: true };
        }
    }
    
    // Exact greetings
    const greetings = ["hi", "hello", "hey", "good morning", "good afternoon", "good evening"];
    if (greetings.includes(lower)) {
        return { text: "Hey there! What can I help you with today?" };
    }
    
    // Exact yes
    const yesWords = ["yes", "yeah", "sure", "okay", "ok", "yep", "yup"];
    if (yesWords.includes(lower)) {
        return { text: "Great! What would you like to know?" };
    }
    
    // Thanks (short utterances only)
    if (lower.length < 30 && (lower.includes("thank") || lower.includes("appreciate"))) {
        return { text: "You're welcome! Is there anything else I can help with?" };
    }
    
    // Human request
    if (lower.length < 40 && (lower.includes("talk to someone") || lower.includes("speak to") || lower.includes("real person") || lower.includes("human") || lower.includes("representative"))) {
        return { text: "I'll have someone from our team call you back shortly. Is this the best number to reach you?" };
    }
    
    return null;
}

function buildLLMPrompt(systemPrompt, companyName, knowledgeBase, speechResult, sarahSettings) {
    let prompt = systemPrompt 
        ? `${systemPrompt}\n\n` 
        : `You are Sarah, a friendly and professional receptionist for ${companyName}.\n\n`;
    
    // Personality (compact)
    const assertiveness = sarahSettings?.personality_assertiveness ?? 50;
    const humor = sarahSettings?.personality_humor ?? 20;
    if (assertiveness <= 25) prompt += 'STYLE: Gentle, suggestive tone. ';
    else if (assertiveness >= 75) prompt += 'STYLE: Direct, confident tone. ';
    if (humor >= 60) prompt += 'Warm and witty. ';
    else if (humor <= 15) prompt += 'Strictly professional. ';
    if (assertiveness <= 25 || assertiveness >= 75 || humor >= 60 || humor <= 15) prompt += '\n\n';
    
    // Knowledge base (trimmed for voice speed)
    const speed = sarahSettings?.response_speed || 'normal';
    if (knowledgeBase && speed !== 'ultra_fast') {
        // For voice, limit KB to 3000 chars to keep LLM fast
        const trimmedKB = knowledgeBase.length > 3000 ? knowledgeBase.substring(0, 3000) + '...' : knowledgeBase;
        prompt += `KNOWLEDGE BASE:\n${trimmedKB}\n\n`;
    }
    
    prompt += `Customer: "${speechResult}"

RULES (VOICE): Answer directly in 2-3 sentences max. Be natural and warm. Use your knowledge base. Never say you're an AI. After answering, suggest one next step.`;
    
    return prompt;
}

Deno.serve(async (req) => {
    const startTime = Date.now();
    
    try {
        // Parse request
        const contentType = req.headers.get('content-type') || '';
        let from, to, callSid, speechResult;
        
        if (contentType.includes('application/x-www-form-urlencoded')) {
            const formData = await req.formData();
            from = formData.get('From');
            to = formData.get('To');
            callSid = formData.get('CallSid');
            speechResult = formData.get('SpeechResult');
        } else if (contentType.includes('application/json')) {
            const json = await req.json();
            from = json.From || json.from;
            to = json.To || json.to;
            callSid = json.CallSid || json.callSid;
            speechResult = json.SpeechResult || json.speechResult;
        }

        const url = new URL(req.url);
        const companyId = url.searchParams.get('companyId') || '695944e3c1fb00b7ab716c6f';
        const companyName = decodeURIComponent(url.searchParams.get('companyName') || 'CompanySync');
        
        const appUrl = (Deno.env.get('APP_URL') || 'https://getcompanysync.com').replace(/\/+$/, '');
        const callbackUrl = `${appUrl}/api/functions/sarahVoiceCallHandler?companyId=${companyId}&companyName=${encodeURIComponent(companyName)}`;

        console.log(`🎤 "${speechResult || '[CALL START]'}" | ${Date.now() - startTime}ms`);
        
        const base44 = createClientFromRequest(req);

        // Load settings (cached after first call)
        const { sarahSettings, systemPrompt, knowledgeBase, voiceId } = await loadSettings(companyId, base44);
        
        // ─── INITIAL GREETING ───
        if (!speechResult) {
            const displayName = (sarahSettings?.assistant_name || 'Sarah').replace(/^./, c => c.toUpperCase());
            const greeting = `Hi! This is ${displayName} from ${companyName}. How can I help you today?`;
            
            const audioUrl = getTTSStreamUrl(greeting, voiceId);
            const twiml = `<Play>${escapeXml(audioUrl)}</Play>`;
            
            console.log(`🤖 Greeting | ${Date.now() - startTime}ms total`);
            return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="${escapeXml(callbackUrl)}" speechTimeout="auto" language="en-US" timeout="6" speechModel="phone_call" bargeIn="true">
        ${twiml}
    </Gather>
    <Redirect method="POST">${escapeXml(callbackUrl)}</Redirect>
</Response>`, { headers: { 'Content-Type': 'text/xml' } });
        }

        // ─── EMERGENCY ───
        const emergencyWords = ["emergency", "urgent", "fire", "flood", "leak"];
        if (emergencyWords.some(w => speechResult.toLowerCase().includes(w))) {
            const msg = "I understand this is urgent. Let me get someone to call you back right away.";
            
            // Fire-and-forget notification
            base44.asServiceRole.entities.Notification.create({
                company_id: companyId,
                title: '🚨 EMERGENCY CALL',
                message: `From ${from}: "${speechResult}"`,
                type: 'emergency'
            }).catch(() => {});
            
            const audioUrl = getTTSStreamUrl(msg, voiceId);
            const twiml = `<Play>${escapeXml(audioUrl)}</Play>`;
            return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    ${twiml}
    <Hangup/>
</Response>`, { headers: { 'Content-Type': 'text/xml' } });
        }

        // ─── QUICK RESPONSES (no LLM needed) ───
        let isGoodbye = /\b(bye|goodbye|that's all|nothing else|that's it)\b/i.test(speechResult);
        let responseText = null;
        
        const quickResult = getQuickResponse(speechResult);
        if (quickResult) {
            responseText = quickResult.text;
            if (quickResult.isGoodbye) isGoodbye = true;
            console.log(`⚡ Quick match | ${Date.now() - startTime}ms`);
        }
        
        // ─── LLM CALL (only if no quick match) ───
        if (!responseText) {
            const llmStart = Date.now();
            const prompt = buildLLMPrompt(systemPrompt, companyName, knowledgeBase, speechResult, sarahSettings);
            
            const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
                prompt,
                add_context_from_internet: false,
                response_json_schema: null,
            });
            
            if (response && typeof response === 'string') {
                // Strip markdown formatting for voice
                responseText = response.trim()
                    .replace(/\*\*/g, '')
                    .replace(/\*/g, '')
                    .replace(/#{1,3}\s/g, '')
                    .substring(0, 250);
            }
            
            console.log(`⚡ LLM: ${Date.now() - llmStart}ms`);
        }
        
        if (!responseText) {
            responseText = "I'd be happy to help with that. Could you tell me a bit more?";
        }
        
        if (isGoodbye && !responseText.toLowerCase().includes('great day')) {
            responseText += " Have a great day!";
        }

        console.log(`🤖 "${responseText.substring(0, 80)}..." | ${Date.now() - startTime}ms total`);

        // ─── TTS + RESPONSE (direct streaming — no upload needed) ───
        const audioUrl = getTTSStreamUrl(responseText, voiceId);
        const twiml = `<Play>${escapeXml(audioUrl)}</Play>`;
        
        if (isGoodbye) {
            return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    ${twiml}
    <Hangup/>
</Response>`, { headers: { 'Content-Type': 'text/xml' } });
        }

        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="${escapeXml(callbackUrl)}" speechTimeout="auto" language="en-US" timeout="6" speechModel="phone_call" bargeIn="true">
        ${twiml}
    </Gather>
    <Redirect method="POST">${escapeXml(callbackUrl)}</Redirect>
</Response>`, { headers: { 'Content-Type': 'text/xml' } });
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        const appUrl = (Deno.env.get('APP_URL') || 'https://getcompanysync.com').replace(/\/+$/, '');
        const fallbackUrl = `${appUrl}/api/functions/sarahVoiceCallHandler?companyId=default&companyName=CompanySync`;
        
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="${escapeXml(fallbackUrl)}" speechTimeout="auto" language="en-US" timeout="6" speechModel="phone_call" bargeIn="true">
        <Say>I'm sorry, could you please repeat that?</Say>
    </Gather>
    <Redirect method="POST">${escapeXml(fallbackUrl)}</Redirect>
</Response>`, { status: 200, headers: { 'Content-Type': 'text/xml' } });
    }
});