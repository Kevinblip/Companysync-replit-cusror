import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Map specific voice names to Gemini compatible ones if needed
// Gemini usually takes "Puck", "Charon", "Kore", "Fenrir", "Aoede"
const VOICE_MAP = {
    'Puck': 'Puck',
    'Charon': 'Charon',
    'Kore': 'Kore',
    'Fenrir': 'Fenrir',
    'Aoede': 'Aoede',
    'default': 'Puck'
};

// Generate a synthetic "typing" sound (approximate mechanical keyboard clicks) in 8kHz PCMU (u-law)
function generateTypingSound() {
    const sampleRate = 8000;
    const durationMs = 800; // 0.8 seconds sequence
    const numSamples = Math.floor((sampleRate * durationMs) / 1000);
    const buffer = new Uint8Array(numSamples);
    
    // Fill with silence (0xFF in u-law)
    buffer.fill(0xFF);
    
    // Create random clicks
    // A click is a short burst of noise
    const numberOfClicks = 4;
    
    for (let i = 0; i < numberOfClicks; i++) {
        // Random position in the buffer
        const pos = Math.floor(Math.random() * (numSamples - 500)); 
        // Create a "click" (10-20ms of noise)
        const clickLen = 100 + Math.floor(Math.random() * 100);
        for (let j = 0; j < clickLen; j++) {
            // Random byte between 0x00 and 0xFF usually creates noise in u-law
            // We'll use a mix of high volume (low hex) and silence
            if (Math.random() > 0.5) {
                buffer[pos + j] = Math.floor(Math.random() * 256);
            }
        }
    }
    
    // Convert to base64
    let binary = '';
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
}

const TYPING_SOUND_BASE64 = generateTypingSound();

// ─── Audio conversion: Twilio mulaw 8kHz ↔ Gemini PCM 16kHz ───

// Standard ITU G.711 µ-law decode table
const MULAW_DECODE_TABLE = new Int16Array(256);
(function buildDecodeTable() {
    for (let i = 0; i < 256; i++) {
        let val = ~i & 0xFF;
        const sign = val & 0x80;
        const exponent = (val >> 4) & 0x07;
        const mantissa = val & 0x0F;
        let magnitude = ((mantissa << 1) + 33) << (exponent + 2);
        magnitude -= 33 * 16;
        MULAW_DECODE_TABLE[i] = sign ? -magnitude : magnitude;
    }
})();

// Standard ITU G.711 µ-law encode (Int16 → Uint8) — exact reference implementation
function mulawEncode(sample) {
    const CLIP = 32635;
    const BIAS = 0x84;
    const sign = (sample >> 8) & 0x80;
    if (sign) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;
    let exponent = 7;
    const expMask = 0x4000;
    for (; exponent > 0; exponent--) {
        if (sample & expMask) break;
        sample <<= 1;
    }
    sample >>= exponent + 3;
    const mantissa = sample & 0x0F;
    return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

// Twilio mulaw 8kHz → Gemini PCM 16kHz (base64 in/out)
function twilioToGemini(mulawB64) {
    const binaryStr = atob(mulawB64);
    const nSrc = binaryStr.length;
    const pcm8k = new Int16Array(nSrc);
    for (let i = 0; i < nSrc; i++) {
        pcm8k[i] = MULAW_DECODE_TABLE[binaryStr.charCodeAt(i)];
    }
    // Upsample 8→16 kHz (linear interp)
    const nDst = nSrc * 2;
    const pcm16 = new Int16Array(nDst);
    for (let i = 0; i < nSrc - 1; i++) {
        pcm16[i * 2] = pcm8k[i];
        pcm16[i * 2 + 1] = (pcm8k[i] + pcm8k[i + 1]) >> 1;
    }
    pcm16[nDst - 2] = pcm8k[nSrc - 1];
    pcm16[nDst - 1] = pcm8k[nSrc - 1];
    // To base64
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

// Gemini PCM 24kHz → Twilio mulaw 8kHz (base64 in/out)
function geminiToTwilio(pcmB64) {
    const binaryStr = atob(pcmB64);
    const len = binaryStr.length;
    const nSrc = len >> 1;
    const pcm24k = new Int16Array(nSrc);
    const view = new DataView(new ArrayBuffer(len));
    for (let i = 0; i < len; i++) view.setUint8(i, binaryStr.charCodeAt(i));
    for (let i = 0; i < nSrc; i++) pcm24k[i] = view.getInt16(i * 2, true);
    // Downsample 24→8 kHz (every 3rd sample)
    const nDst = Math.floor(nSrc / 3);
    const out = new Uint8Array(nDst);
    for (let i = 0; i < nDst; i++) {
        out[i] = mulawEncode(pcm24k[i * 3]);
    }
    let binary = '';
    for (let i = 0; i < out.length; i++) binary += String.fromCharCode(out[i]);
    return btoa(binary);
}

Deno.serve(async (req) => {
    console.log('🚀 Sarah Fast Voice (Gemini Live) - WebSocket handler');

    if (req.headers.get("upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 400 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    
    const url = new URL(req.url);
    const companyId = url.searchParams.get('companyId');
    const from = url.searchParams.get('from');
    const callSid = url.searchParams.get('callSid');
    const scenario = url.searchParams.get('scenario'); // 'saas_demo' or null

    console.log('📞 Call info:', { companyId, from, callSid, scenario });

    let geminiWs = null;
    let streamSid = null;
    const base44 = createClientFromRequest(req);

    // Keep track of accumulated audio for potential debugging/logging
    // let audioChunks = [];

    socket.onopen = async () => {
        console.log('✅ Twilio Media Stream connected');

        try {
            // 1. Load Sarah's settings & Company Info
            // We use asServiceRole to ensure we can read settings even if not authed as user
            const settingsRows = await base44.asServiceRole.entities.AssistantSettings.filter({ 
                company_id: companyId, 
                assistant_name: 'sarah' 
            });
            const settings = settingsRows[0] || {};

            const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            const company = companies[0];
            const companyName = settings.brand_short_name || company?.company_name || 'our company';

            // 2. Construct System Prompt with Knowledge
            let agentName = 'Sarah';
            if (settings.system_prompt) {
                const nameMatch = settings.system_prompt.match(/(?:You are|Your name is|I am|Role:)[:\s]*(?:You are\s+)?([A-Z][a-z]+)/i);
                if (nameMatch && nameMatch[1] && nameMatch[1].toLowerCase() !== 'you') {
                    agentName = nameMatch[1];
                }
            }

            // Combine knowledge base parts
            const kbParts = [];
            if (settings.website_urls && settings.website_urls.length > 0) {
                kbParts.push(`Company websites: ${settings.website_urls.join(', ')}`);
            }
            if (settings.knowledge_base) {
                kbParts.push(settings.knowledge_base);
            }
            if (settings.custom_responses) {
                kbParts.push(`Custom responses: ${JSON.stringify(settings.custom_responses)}`);
            }
            const knowledgeBase = kbParts.join('\n\n');

            const basePrompt = settings.system_prompt || `You are ${agentName}, a friendly receptionist for ${companyName}.`;
            
            let audioContext = "";
            if (settings.background_audio === 'call_center') {
                audioContext = "STYLE: You are working in a BUSY CALL CENTER. Speak with a professional, energetic, and slightly hurried tone. Maintain high energy.";
            } else if (settings.background_audio === 'office') {
                audioContext = "STYLE: You are in a quiet professional office. Speak calmly and clearly.";
            }

            let interimContext = "";
            let useTypingSound = false;
            if (settings.interim_audio === 'typing') {
                useTypingSound = true;
                interimContext = "BEHAVIOR: When you use a tool (like checking availability or booking), say something brief like 'Let me type that in...' or 'Checking the system...' before you start.";
            } else if (settings.interim_audio === 'thinking') {
                interimContext = "BEHAVIOR: Use natural fillers like 'Hmm, let me see...' or 'One moment please...' when thinking.";
            }

            let systemInstruction;

            if (scenario === 'saas_demo') {
                // --- SCENARIO 1: COMPANYSYNC SAAS SALES (For 216-777-7154) ---
                systemInstruction = `
IDENTITY & ROLE:
You are Sarah, the Lead Sales Representative for CompanySync.io.
CompanySync is the "Roof Operating System" - the all-in-one CRM built specifically for roofing contractors.
Your goal is to **GET THE ROOFER TO SUBSCRIBE** or **BOOK A DEMO**.

VALUE PROPOSITION (Why they need us):
- **All-in-One**: Replaces JobNimbus, Acculynx, and ServiceTitan for just $99/month (flat rate).
- **AI-Powered**: Comes with "Lexi" (AI text assistant) and "Sarah" (YOU - the AI voice receptionist).
- **Speed**: Sets up in 5 minutes. No 4-week onboarding.
- **Features**: AI Estimating, Storm Tracking, Mobile App, Automations, Payments.

CONVERSATION FLOW:
1. **QUALIFY**:
   - "Thanks for calling CompanySync! Are you currently running a roofing business?"
   - "How many crews or sales reps do you have?"
   - "What software are you using right now? (JobNimbus, pen & paper?)"
2. **PITCH**:
   - If they use JobNimbus/Acculynx: "We replace them for a fraction of the cost, and we include the AI receptionist feature for free. It saves you about $500 a month."
   - If they use nothing: "CompanySync is perfect for you. It organizes your leads, estimates, and jobs so you stop losing money on lost paperwork."
3. **CLOSE**:
   - "I can text you a link to start a free trial right now—no credit card needed. Does that sound good?"
   - OR "Do you want to book a quick 15-minute demo to see how the AI works?"

OBJECTION HANDLING:
- *Is this AI?*: "Yes! I am Sarah, the AI receptionist that comes BUILT-IN with CompanySync. You can have an agent just like me answering YOUR phones starting today."
- *Price?*: "It's $99/month flat. Unlimited users. No hidden fees."

SPECIFIC KNOWLEDGE BASE:
${knowledgeBase || ''}

TOOL PROTOCOLS:
- **save_lead_details**: Save their Name, Roofing Company Name, and Phone immediately.
- **book_appointment**: Use for booking the DEMO.
- **check_availability**: Check for demo times.

${audioContext}
${interimContext}
`;
            } else {
                // --- SCENARIO 2: SUBSCRIBER'S ROOFING RECEPTIONIST (Default for other numbers) ---
                systemInstruction = `
IDENTITY & ROLE:
${basePrompt}
You are "Sarah", the Senior Office Manager and Intake Specialist for ${companyName}, a premier roofing contractor.
You are NOT a generic AI. You are a roofing industry expert. You know about shingles, insurance claims, hail damage, and leaks.
Your goal is to **BOOK THE FREE INSPECTION**. That is how your company makes money.

DOMAIN KNOWLEDGE (ROOFING EXPERT):
- **Hail Damage**: "It bruises the shingle mat and voids the manufacturer warranty, even if you can't see it from the ground."
- **Wind Damage**: "Missing shingles can lead to active leaks and rot if not addressed quickly."
- **Insurance**: "We specialize in insurance restoration. We work with State Farm, Allstate, Liberty Mutual, and all major carriers to make sure you get everything you're owed."
- **The Process**: "Step 1 is a free, no-obligation video inspection. We give you a full report. If there's damage, we help you file the claim."


SPECIFIC KNOWLEDGE BASE:
${knowledgeBase || 'No specific knowledge base provided.'}

CONVERSATION FLOW (THE "PERFECT INTAKE"):
1. **GREETING**: Warm, professional, establishing authority. "Thanks for calling ${companyName}, this is Sarah. How can I help you with your property today?"
2. **DISCOVERY**:
   - If they have a leak: "I'm sorry to hear that. Is water coming in right now, or do you just see a stain?" (Assess urgency).
   - If they want a quote: "I'd be happy to help. We provide exact pricing after a quick 15-minute digital inspection so we don't guess at the cost. Can I get your address to check our schedule?"
3. **QUALIFICATION**:
   - "Just to make sure we service your area, what is the property address?"
   - "And who am I speaking with?"
4. **THE CLOSE (BOOKING)**:
   - "I have one of our senior inspectors, Kevin, in that area tomorrow. Would morning or afternoon work better for a quick look?"
   - *Use the 'check_availability' tool immediately when they give a preference.*

CORE RULES:
- **VOICE-FIRST**: Speak in short, punchy sentences (max 20 words). No monologues.
- **LEAD THE DANCE**: Always end your turn with a question. Control the conversation.
- **NO FLUFF**: Don't say "I understand" or "That sounds good" repeatedly. Just solve the problem.
- **OBJECTION HANDLING**:
   - *Price?* -> "It depends on the square footage and shingle layers. The inspection is free, so you'll know exactly what it costs with no risk. When can we stop by?"
   - *Are you AI?* -> "I'm Sarah, the virtual office manager for ${companyName}. I'm here to get you taken care of fast. What's your address?"

TOOL PROTOCOLS:
- **save_lead_details**: CALL THIS IMMEDIATELY once you have a Name, Phone, or Address. Do not wait for the end of the call.
- **check_availability**: Use this the moment they show interest in an inspection.
- **book_appointment**: Use this only after they agree to a specific time.

${audioContext}
${interimContext}
`;
            }

            const selectedVoice = settings.gemini_voice || 'Aoede';

            // 3. Connect to Gemini Live
            const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY');
            if (!geminiApiKey) {
                throw new Error('GOOGLE_GEMINI_API_KEY not configured');
            }

            // Using the correct BidiGenerateContent endpoint for real-time audio
            const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;
            
            console.log('🔌 Connecting to Gemini...');
            geminiWs = new WebSocket(geminiUrl);

            geminiWs.onopen = () => {
                console.log('✅ Connected to Gemini');
                
                // 4. Send Setup Configuration with Tools
                const setupMsg = {
                    setup: {
                        model: settings.engine ? `models/${settings.engine}` : "models/gemini-2.0-flash-live-001",
                        generation_config: {
                            response_modalities: ["AUDIO"],
                            speech_config: {
                                voice_config: { 
                                    prebuilt_voice_config: { voice_name: selectedVoice } 
                                }
                            }
                        },
                        system_instruction: {
                            parts: [{ text: systemInstruction }]
                        },
                        tools: [
                            {
                                function_declarations: [
                                    {
                                        name: "check_availability",
                                        description: "Check available appointment slots for a given date or range.",
                                        parameters: {
                                            type: "OBJECT",
                                            properties: {
                                                date_description: { type: "STRING", description: "The date or range to check (e.g. 'tomorrow', 'next monday', '2023-10-27')" }
                                            },
                                            required: ["date_description"]
                                        }
                                    },
                                    {
                                        name: "book_appointment",
                                        description: "Book an appointment slot for the user.",
                                        parameters: {
                                            type: "OBJECT",
                                            properties: {
                                                slot_time: { type: "STRING", description: "The ISO timestamp of the slot to book" },
                                                name: { type: "STRING", description: "User's name" },
                                                email: { type: "STRING", description: "User's email" },
                                                phone: { type: "STRING", description: "User's phone number" },
                                                description: { type: "STRING", description: "Reason for appointment" }
                                            },
                                            required: ["slot_time", "name"]
                                        }
                                    },
                                    {
                                        name: "save_lead_details",
                                        description: "Save or update lead contact information.",
                                        parameters: {
                                            type: "OBJECT",
                                            properties: {
                                                name: { type: "STRING" },
                                                email: { type: "STRING" },
                                                phone: { type: "STRING" },
                                                service_needed: { type: "STRING" },
                                                address: { type: "STRING" }
                                            }
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                };
                
                geminiWs.send(JSON.stringify(setupMsg));
            };

            geminiWs.onmessage = async (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    // Handle Audio Output — convert Gemini PCM 24kHz → Twilio mulaw 8kHz
                    if (data.serverContent?.modelTurn?.parts) {
                        for (const part of data.serverContent.modelTurn.parts) {
                            if (part.inlineData && part.inlineData.mimeType.startsWith("audio/")) {
                                const mulawB64 = geminiToTwilio(part.inlineData.data);
                                if (streamSid) {
                                    socket.send(JSON.stringify({
                                        event: 'media',
                                        streamSid: streamSid,
                                        media: { payload: mulawB64 }
                                    }));
                                }
                            }
                        }
                    }

                    // Handle interruption — clear Twilio's audio buffer
                    if (data.serverContent?.interrupted) {
                        console.log('🔇 Interrupted — clearing Twilio buffer');
                        if (streamSid) {
                            socket.send(JSON.stringify({ event: 'clear', streamSid }));
                        }
                    }

                    // Handle Tool Calls
                    if (data.toolCall) {
                        console.log('🛠️ Tool Call received:', JSON.stringify(data.toolCall));
                        
                        // INJECT TYPING SOUND IF ENABLED
                        if (useTypingSound && streamSid) {
                            try {
                                console.log('⌨️ Playing typing sound...');
                                socket.send(JSON.stringify({
                                    event: 'media',
                                    streamSid: streamSid,
                                    media: { payload: TYPING_SOUND_BASE64 }
                                }));
                            } catch (e) {
                                console.error('Failed to play typing sound:', e);
                            }
                        }

                        const functionCalls = data.toolCall.functionCalls;
                        
                        // Execute tools in parallel if needed, but usually sequential response
                        const toolResponses = [];

                        for (const call of functionCalls) {
                            let result = {};
                            try {
                                if (call.name === 'check_availability') {
                                    result = await handleCheckAvailability(base44, call.args, companyId);
                                } else if (call.name === 'book_appointment') {
                                    result = await handleBookAppointment(base44, call.args, companyId);
                                } else if (call.name === 'save_lead_details') {
                                    result = await handleSaveLead(base44, call.args, companyId);
                                } else {
                                    result = { error: `Unknown tool: ${call.name}` };
                                }
                            } catch (e) {
                                console.error(`Tool execution error (${call.name}):`, e);
                                result = { error: e.message };
                            }

                            toolResponses.push({
                                id: call.id,
                                name: call.name,
                                response: { result: result }
                            });
                        }

                        // Send Tool Response back to Gemini
                        const toolResponseMsg = {
                            tool_response: {
                                function_responses: toolResponses
                            }
                        };
                        console.log('📤 Sending Tool Response:', JSON.stringify(toolResponseMsg));
                        geminiWs.send(JSON.stringify(toolResponseMsg));
                    }

                } catch (err) {
                    console.error('❌ Gemini message error:', err);
                }
            };

            geminiWs.onclose = () => console.log('❌ Gemini disconnected');
            geminiWs.onerror = (err) => console.error('❌ Gemini error:', err);

        } catch (error) {
            console.error('❌ Setup error:', error);
            socket.close();
        }
    };

    socket.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);
            
            if (msg.event === 'start') {
                console.log('🎬 Stream started:', msg.start.streamSid);
                streamSid = msg.start.streamSid;
            }

            if (msg.event === 'media' && geminiWs?.readyState === WebSocket.OPEN) {
                // Convert Twilio mulaw 8kHz → PCM 16kHz for Gemini
                const pcmB64 = twilioToGemini(msg.media.payload);
                geminiWs.send(JSON.stringify({
                    realtime_input: {
                        media_chunks: [{
                            mime_type: "audio/pcm;rate=16000",
                            data: pcmB64
                        }]
                    }
                }));
            }

            if (msg.event === 'stop') {
                console.log('🛑 Stream stopped');
                geminiWs?.close();
            }
        } catch (err) {
            console.error('❌ Message handling error:', err);
        }
    };

    socket.onclose = () => {
        console.log('❌ Twilio stream closed');
        geminiWs?.close();
    };

    return response;
});

// --- Tool Implementations ---

async function handleCheckAvailability(base44, args, companyId) {
    console.log('📅 Checking availability:', args);
    // Reuse logic structure from sarahLeadIntake but simplified for direct tool use
    // We need to check Google Calendar availability
    
    // 1. Get access token
    let accessToken = null;
    try {
        accessToken = await base44.asServiceRole.connectors.getAccessToken('googlecalendar');
    } catch (e) {
        console.warn('Failed to get calendar token:', e);
        // Fallback: Return some dummy slots if calendar not connected, or error
        return { 
            available_slots: [
                "Tomorrow at 10:00 AM", 
                "Tomorrow at 2:00 PM", 
                "Day after tomorrow at 11:00 AM"
            ], 
            note: "Calendar integration not active, providing standard slots." 
        };
    }

    // 2. Calculate range based on args.date_description
    // Simplified: Just look at next 3 days for now
    const now = new Date();
    const startTime = new Date(now);
    startTime.setHours(9, 0, 0, 0); // Start check from 9 AM today/tomorrow
    if (startTime < now) startTime.setDate(startTime.getDate() + 1);
    
    const endTime = new Date(startTime);
    endTime.setDate(endTime.getDate() + 3); // Look 3 days ahead

    // 3. Query Google Calendar
    try {
        const params = new URLSearchParams({
            timeMin: startTime.toISOString(),
            timeMax: endTime.toISOString(),
            singleEvents: 'true',
            orderBy: 'startTime'
        });
        
        const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        if (!resp.ok) throw new Error('Calendar API failed');
        const data = await resp.json();
        const busySlots = data.items || [];

        // 4. Find gaps (Simple implementation: Fixed slots checking)
        const proposedSlots = [];
        const durationMs = 60 * 60 * 1000; // 1 hour

        // Iterate days
        for (let d = 0; d < 3; d++) {
            const currentDay = new Date(startTime);
            currentDay.setDate(currentDay.getDate() + d);
            
            // Check 9am, 11am, 2pm, 4pm
            const checkHours = [9, 11, 14, 16];
            for (const h of checkHours) {
                const slotStart = new Date(currentDay);
                slotStart.setHours(h, 0, 0, 0);
                const slotEnd = new Date(slotStart.getTime() + durationMs);
                
                // Check collision
                const isBusy = busySlots.some(busy => {
                    const bStart = new Date(busy.start.dateTime || busy.start.date);
                    const bEnd = new Date(busy.end.dateTime || busy.end.date);
                    return (slotStart < bEnd && slotEnd > bStart);
                });

                if (!isBusy) {
                    proposedSlots.push(slotStart.toLocaleString('en-US', { 
                        weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                    }));
                }
                if (proposedSlots.length >= 5) break;
            }
        }
        
        return { available_slots: proposedSlots };

    } catch (e) {
        console.error('Availability check failed:', e);
        return { error: "Could not check live calendar. Please propose a time to the user." };
    }
}

async function handleBookAppointment(base44, args, companyId) {
    console.log('📝 Booking appointment:', args);
    const { slot_time, name, email, description } = args;

    // Create CalendarEvent entity
    try {
        // Parse slot_time - Gemini might send human string or ISO
        // Ideally we prompted Gemini to send ISO, but if it sends "Tomorrow 2pm", we might need parsing.
        // For robustness, let's assume Gemini follows instructions or we try to parse.
        const start = new Date(slot_time); 
        if (isNaN(start.getTime())) {
            // Fallback: If invalid date, return error asking for clarification
            return { error: "Invalid date format. Please provide the date and time clearly." };
        }
        
        const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour default

        // 1. Create in CRM
        const event = await base44.asServiceRole.entities.CalendarEvent.create({
            company_id: companyId,
            title: `Appt: ${name}`,
            description: description || 'Booked via Sarah Voice (Fast)',
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            event_type: 'appointment',
            status: 'scheduled',
            attendees: email ? [email] : []
        });

        // 2. Sync to Google Calendar
        let googleLink = null;
        try {
            const accessToken = await base44.asServiceRole.connectors.getAccessToken('googlecalendar');
            if (accessToken) {
                const gResp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        summary: `Appt: ${name}`,
                        description: `Booked by Sarah Voice\nReason: ${description}`,
                        start: { dateTime: start.toISOString() },
                        end: { dateTime: end.toISOString() },
                        attendees: email ? [{ email }] : []
                    })
                });
                const gData = await gResp.json();
                googleLink = gData.htmlLink;
            }
        } catch (e) {
            console.warn('Google Calendar sync failed:', e);
        }

        return { 
            success: true, 
            message: "Appointment booked successfully.", 
            details: { date: start.toLocaleString(), google_link: googleLink }
        };

    } catch (e) {
        console.error('Booking failed:', e);
        return { error: "Failed to book appointment. Please try again." };
    }
}

async function handleSaveLead(base44, args, companyId) {
    console.log('💾 Saving lead:', args);
    try {
        const { name, email, phone, service_needed, address } = args;
        
        // Find existing or create new
        const leads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId });
        let lead = null;
        
        // Simple dedupe
        if (email) lead = leads.find(l => l.email === email);
        if (!lead && phone) lead = leads.find(l => l.phone === phone);

        if (lead) {
            // Update
            const updates = {};
            if (email && !lead.email) updates.email = email;
            if (service_needed) updates.notes = (lead.notes || '') + `\n[Sarah Update]: Interested in ${service_needed}`;
            if (address) updates.street = address; // Simple mapping
            
            if (Object.keys(updates).length > 0) {
                await base44.asServiceRole.entities.Lead.update(lead.id, updates);
            }
            return { success: true, message: "Lead updated.", lead_id: lead.id };
        } else {
            // Create
            const newLead = await base44.asServiceRole.entities.Lead.create({
                company_id: companyId,
                name: name || 'Voice Lead',
                email: email,
                phone: phone,
                source: 'ai',
                notes: `Captured via Sarah Fast Voice.\nService: ${service_needed || 'N/A'}\nAddress: ${address || 'N/A'}`
            });
            return { success: true, message: "New lead created.", lead_id: newLead.id };
        }
    } catch (e) {
        console.error('Save lead failed:', e);
        return { error: "Failed to save lead details." };
    }
}