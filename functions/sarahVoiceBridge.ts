import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const VOICE_MAP: Record<string, string> = {
    'Puck': 'Puck',
    'Charon': 'Charon',
    'Kore': 'Kore',
    'Fenrir': 'Fenrir',
    'Aoede': 'Aoede',
    'Sage': 'Sage',
    'Orion': 'Orion',
    'default': 'Kore'
};

function generateTypingSound(): string {
    const sampleRate = 8000;
    const durationMs = 800;
    const numSamples = Math.floor((sampleRate * durationMs) / 1000);
    const buffer = new Uint8Array(numSamples);
    buffer.fill(0xFF);
    const numberOfClicks = 4;
    for (let i = 0; i < numberOfClicks; i++) {
        const pos = Math.floor(Math.random() * (numSamples - 500));
        const clickLen = 100 + Math.floor(Math.random() * 100);
        for (let j = 0; j < clickLen; j++) {
            if (Math.random() > 0.5) {
                buffer[pos + j] = Math.floor(Math.random() * 256);
            }
        }
    }
    let binary = '';
    for (let i = 0; i < buffer.byteLength; i++) {
        binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
}

const TYPING_SOUND_BASE64 = generateTypingSound();

// ─── ITU G.711 mu-law codec ───

const BIAS = 0x84;
const CLIP = 32635;

const EXP_LUT = new Uint8Array([
    0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,
    4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
    5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
    5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7
]);

function mulawEncode(sample: number): number {
    let sign = (sample >> 8) & 0x80;
    if (sign) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;
    const exponent = EXP_LUT[(sample >> 7) & 0xFF];
    const mantissa = (sample >> (exponent + 3)) & 0x0F;
    return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

const MULAW_DECODE_TABLE = new Int16Array(256);
(function buildDecodeTable() {
    for (let i = 0; i < 256; i++) {
        const val = ~i & 0xFF;
        const sign = val & 0x80;
        const exponent = (val >> 4) & 0x07;
        const mantissa = val & 0x0F;
        let magnitude = ((mantissa << 3) + BIAS) << exponent;
        magnitude -= BIAS;
        MULAW_DECODE_TABLE[i] = sign ? -magnitude : magnitude;
    }
})();

// Twilio mulaw 8kHz -> Gemini PCM 16kHz (base64 in/out, Deno-compatible)
function twilioToGemini(mulawB64: string): string {
    const binaryStr = atob(mulawB64);
    const nSrc = binaryStr.length;
    const pcm8k = new Int16Array(nSrc);
    for (let i = 0; i < nSrc; i++) {
        pcm8k[i] = MULAW_DECODE_TABLE[binaryStr.charCodeAt(i)];
    }
    const nDst = nSrc * 2;
    const pcm16 = new Int16Array(nDst);
    for (let i = 0; i < nSrc - 1; i++) {
        pcm16[i * 2] = pcm8k[i];
        pcm16[i * 2 + 1] = (pcm8k[i] + pcm8k[i + 1]) >> 1;
    }
    pcm16[nDst - 2] = pcm8k[nSrc - 1];
    pcm16[nDst - 1] = pcm8k[nSrc - 1];
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

// Gemini PCM 24kHz -> Twilio mulaw 8kHz with pre-emphasis + FIR anti-alias filter
const LP_COEFFS = new Float64Array([
    0.0595, 0.0990, 0.1571, 0.2030, 0.2218,
    0.2030, 0.1571, 0.0990, 0.0595
]);
const LP_LEN = LP_COEFFS.length;
const LP_HALF = (LP_LEN - 1) >> 1;

function geminiToTwilio(pcmB64: string): string {
    const binaryStr = atob(pcmB64);
    const len = binaryStr.length;
    const nSrc = len >> 1;
    const view = new DataView(new ArrayBuffer(len));
    for (let i = 0; i < len; i++) view.setUint8(i, binaryStr.charCodeAt(i));

    const pcm = new Float64Array(nSrc);
    for (let i = 0; i < nSrc; i++) pcm[i] = view.getInt16(i * 2, true);

    // Pre-emphasis filter to boost clarity
    let prev = pcm[0];
    for (let i = 1; i < nSrc; i++) {
        const orig = pcm[i];
        pcm[i] = orig - 0.4 * prev;
        prev = orig;
    }

    // Downsample 24kHz -> 8kHz (ratio 3) with FIR anti-alias filter
    const ratio = 3;
    const nDst = Math.floor(nSrc / ratio);
    const out = new Uint8Array(nDst);
    for (let i = 0; i < nDst; i++) {
        const center = i * ratio;
        let acc = 0;
        for (let k = 0; k < LP_LEN; k++) {
            const idx = center - LP_HALF + k;
            if (idx >= 0 && idx < nSrc) acc += pcm[idx] * LP_COEFFS[k];
        }
        const sample = Math.max(-32768, Math.min(32767, Math.round(acc)));
        out[i] = mulawEncode(sample);
    }
    let binary = '';
    for (let i = 0; i < out.length; i++) binary += String.fromCharCode(out[i]);
    return btoa(binary);
}

// ─── Main Deno WebSocket handler ───

Deno.serve(async (req: Request) => {
    console.log('[SarahVoiceBridge] WebSocket handler invoked');

    if (req.headers.get("upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 400 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    const url = new URL(req.url);
    const companyId = url.searchParams.get('companyId');
    const from = url.searchParams.get('from');
    const callSid = url.searchParams.get('callSid');
    const scenario = url.searchParams.get('scenario');

    console.log('[SarahVoiceBridge] Call info:', { companyId, from, callSid, scenario });

    let geminiWs: WebSocket | null = null;
    let streamSid: string | null = null;
    const base44 = createClientFromRequest(req);

    socket.onopen = async () => {
        console.log('[SarahVoiceBridge] Twilio Media Stream connected');

        try {
            // Load Sarah's settings from AssistantSettings entity
            const settingsRows = await base44.asServiceRole.entities.AssistantSettings.filter({
                company_id: companyId,
                assistant_name: 'sarah'
            });
            const settings = settingsRows[0] || {};

            const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            const company = companies[0];
            const companyName = settings.brand_short_name || company?.company_name || 'our company';

            // Extract agent name from system prompt
            let agentName = 'Sarah';
            if (settings.system_prompt) {
                const nameMatch = settings.system_prompt.match(/(?:You are|Your name is|I am|Role:)[:\s]*(?:You are\s+)?([A-Z][a-z]+)/i);
                if (nameMatch && nameMatch[1] && nameMatch[1].toLowerCase() !== 'you') {
                    agentName = nameMatch[1];
                }
            }

            // Combine knowledge base
            const kbParts: string[] = [];
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

            // Presence settings
            let audioContext = "";
            if (settings.background_audio === 'call_center') {
                audioContext = "STYLE: You are working in a BUSY CALL CENTER. Speak with a professional, energetic, and slightly hurried tone.";
            } else if (settings.background_audio === 'office') {
                audioContext = "STYLE: You are in a quiet professional office. Speak calmly and clearly.";
            }

            let interimContext = "";
            let useTypingSound = false;
            if (settings.interim_audio === 'typing') {
                useTypingSound = true;
                interimContext = "BEHAVIOR: When you use a tool, say something brief like 'Let me check that...' before you start.";
            } else if (settings.interim_audio === 'thinking') {
                interimContext = "BEHAVIOR: Use natural fillers like 'Hmm, let me see...' or 'One moment please...' when thinking.";
            }

            // Build system instruction based on scenario
            let systemInstruction: string;

            if (scenario === 'saas_demo') {
                systemInstruction = `
IDENTITY & ROLE:
You are Sarah, the Lead Sales Representative for CompanySync.io.
CompanySync is the "Roof Operating System" - the all-in-one CRM built specifically for roofing contractors.
Your goal is to GET THE ROOFER TO SUBSCRIBE or BOOK A DEMO.

VALUE PROPOSITION:
- All-in-One: Replaces JobNimbus, Acculynx, and ServiceTitan for just $99/month (flat rate).
- AI-Powered: Comes with "Lexi" (AI text assistant) and "Sarah" (YOU - the AI voice receptionist).
- Speed: Sets up in 5 minutes. No 4-week onboarding.
- Features: AI Estimating, Storm Tracking, Mobile App, Automations, Payments.

CONVERSATION FLOW:
1. QUALIFY: "Thanks for calling CompanySync! Are you currently running a roofing business?"
2. PITCH: If they use JobNimbus/Acculynx: "We replace them for a fraction of the cost, and we include the AI receptionist feature for free."
3. CLOSE: "I can text you a link to start a free trial right now. Does that sound good?"

OBJECTION HANDLING:
- Is this AI?: "Yes! I am Sarah, the AI receptionist that comes BUILT-IN with CompanySync."
- Price?: "It's $99/month flat. Unlimited users. No hidden fees."

KNOWLEDGE BASE:
${knowledgeBase || ''}

${audioContext}
${interimContext}
`;
            } else {
                systemInstruction = `
IDENTITY & ROLE:
${basePrompt}
You are "${agentName}", the Senior Office Manager and Intake Specialist for ${companyName}, a premier roofing contractor.
You are NOT a generic AI. You are a roofing industry expert.
Your goal is to BOOK THE FREE INSPECTION.

DOMAIN KNOWLEDGE:
- Hail Damage: "It bruises the shingle mat and voids the manufacturer warranty."
- Wind Damage: "Missing shingles can lead to active leaks and rot."
- Insurance: "We specialize in insurance restoration. We work with all major carriers."
- The Process: "Step 1 is a free, no-obligation inspection. We give you a full report."

KNOWLEDGE BASE:
${knowledgeBase || 'No specific knowledge base provided.'}

CONVERSATION FLOW:
1. GREETING: "Thanks for calling ${companyName}, this is ${agentName}. How can I help you with your property today?"
2. DISCOVERY: Ask about the issue (leak, damage, quote)
3. QUALIFICATION: "What is the property address?" / "Who am I speaking with?"
4. THE CLOSE: "I have an inspector in that area. Would morning or afternoon work better?"

CORE RULES:
- VOICE-FIRST: Short, punchy sentences (max 20 words). No monologues.
- LEAD THE DANCE: Always end your turn with a question.
- NO FLUFF: Don't repeat "I understand." Just solve the problem.

${audioContext}
${interimContext}
`;
            }

            // Get voice setting from entity
            const selectedVoice = VOICE_MAP[settings.voice_id || settings.gemini_voice || ''] || VOICE_MAP['default'];

            // Connect to Gemini Live API
            const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY');
            if (!geminiApiKey) {
                throw new Error('GOOGLE_GEMINI_API_KEY not configured');
            }

            const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;
            console.log(`[SarahVoiceBridge] Connecting to Gemini with voice: ${selectedVoice}`);
            geminiWs = new WebSocket(geminiUrl);

            geminiWs.onopen = () => {
                console.log('[SarahVoiceBridge] Connected to Gemini');
                const setupMsg = {
                    setup: {
                        model: "models/gemini-2.5-flash-native-audio-latest",
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
                                                date_description: { type: "STRING", description: "The date or range to check" }
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
                geminiWs!.send(JSON.stringify(setupMsg));
            };

            geminiWs.onmessage = async (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);

                    // Setup complete - send greeting trigger
                    if (data.setupComplete) {
                        console.log('[SarahVoiceBridge] Gemini setup complete, triggering greeting...');
                        geminiWs!.send(JSON.stringify({
                            client_content: {
                                turns: [{
                                    role: "user",
                                    parts: [{ text: "A customer just called. Please greet them warmly." }]
                                }],
                                turn_complete: true
                            }
                        }));
                    }

                    // Handle audio output: Gemini PCM 24kHz -> Twilio mulaw 8kHz
                    if (data.serverContent?.modelTurn?.parts) {
                        for (const part of data.serverContent.modelTurn.parts) {
                            if (part.inlineData && part.inlineData.mimeType?.startsWith("audio/")) {
                                const mulawB64 = geminiToTwilio(part.inlineData.data);
                                if (streamSid && socket.readyState === WebSocket.OPEN) {
                                    socket.send(JSON.stringify({
                                        event: 'media',
                                        streamSid: streamSid,
                                        media: { payload: mulawB64 }
                                    }));
                                }
                            }
                        }
                    }

                    // Handle interruption
                    if (data.serverContent?.interrupted) {
                        console.log('[SarahVoiceBridge] Speech interrupted by caller');
                        if (streamSid && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({ event: 'clear', streamSid }));
                        }
                    }

                    // Handle tool calls
                    if (data.toolCall) {
                        console.log('[SarahVoiceBridge] Tool call:', JSON.stringify(data.toolCall));

                        if (useTypingSound && streamSid && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({
                                event: 'media',
                                streamSid: streamSid,
                                media: { payload: TYPING_SOUND_BASE64 }
                            }));
                        }

                        const functionCalls = data.toolCall.functionCalls;
                        const toolResponses: any[] = [];

                        for (const call of functionCalls) {
                            let result: any = {};
                            try {
                                if (call.name === 'check_availability') {
                                    result = await handleCheckAvailability(base44, call.args, companyId!);
                                } else if (call.name === 'book_appointment') {
                                    result = await handleBookAppointment(base44, call.args, companyId!);
                                } else if (call.name === 'save_lead_details') {
                                    result = await handleSaveLead(base44, call.args, companyId!);
                                } else {
                                    result = { error: `Unknown tool: ${call.name}` };
                                }
                            } catch (e: any) {
                                console.error(`[SarahVoiceBridge] Tool error (${call.name}):`, e);
                                result = { error: e.message };
                            }
                            toolResponses.push({
                                id: call.id,
                                name: call.name,
                                response: { result }
                            });
                        }

                        geminiWs!.send(JSON.stringify({
                            tool_response: { function_responses: toolResponses }
                        }));
                    }

                } catch (err) {
                    console.error('[SarahVoiceBridge] Gemini message error:', err);
                }
            };

            geminiWs.onclose = () => console.log('[SarahVoiceBridge] Gemini disconnected');
            geminiWs.onerror = (err) => console.error('[SarahVoiceBridge] Gemini error:', err);

        } catch (error) {
            console.error('[SarahVoiceBridge] Setup error:', error);
            socket.close();
        }
    };

    socket.onmessage = async (event: MessageEvent) => {
        try {
            const msg = JSON.parse(event.data);

            if (msg.event === 'start') {
                console.log('[SarahVoiceBridge] Stream started:', msg.start.streamSid);
                streamSid = msg.start.streamSid;
            }

            if (msg.event === 'media' && geminiWs?.readyState === WebSocket.OPEN) {
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
                console.log('[SarahVoiceBridge] Stream stopped');
                geminiWs?.close();
            }
        } catch (err) {
            console.error('[SarahVoiceBridge] Message handling error:', err);
        }
    };

    socket.onclose = () => {
        console.log('[SarahVoiceBridge] Twilio stream closed');
        geminiWs?.close();
    };

    return response;
});

// ─── Tool Implementations ───

async function handleCheckAvailability(base44: any, args: any, companyId: string) {
    console.log('[SarahVoiceBridge] Checking availability:', args);

    let accessToken = null;
    try {
        accessToken = await base44.asServiceRole.connectors.getAccessToken('googlecalendar');
    } catch (e) {
        return {
            available_slots: [
                "Tomorrow at 10:00 AM",
                "Tomorrow at 2:00 PM",
                "Day after tomorrow at 11:00 AM"
            ],
            note: "Calendar integration not active, providing standard slots."
        };
    }

    const now = new Date();
    const startTime = new Date(now);
    startTime.setHours(9, 0, 0, 0);
    if (startTime < now) startTime.setDate(startTime.getDate() + 1);

    const endTime = new Date(startTime);
    endTime.setDate(endTime.getDate() + 3);

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

        const proposedSlots: string[] = [];
        const durationMs = 60 * 60 * 1000;

        for (let d = 0; d < 3; d++) {
            const currentDay = new Date(startTime);
            currentDay.setDate(currentDay.getDate() + d);

            const checkHours = [9, 11, 14, 16];
            for (const h of checkHours) {
                const slotStart = new Date(currentDay);
                slotStart.setHours(h, 0, 0, 0);
                const slotEnd = new Date(slotStart.getTime() + durationMs);

                const isBusy = busySlots.some((busy: any) => {
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
        console.error('[SarahVoiceBridge] Availability check failed:', e);
        return { error: "Could not check live calendar. Please propose a time to the user." };
    }
}

async function handleBookAppointment(base44: any, args: any, companyId: string) {
    console.log('[SarahVoiceBridge] Booking appointment:', args);
    const { slot_time, name, email, description } = args;

    try {
        const start = new Date(slot_time);
        if (isNaN(start.getTime())) {
            return { error: "Invalid date format. Please provide the date and time clearly." };
        }

        const end = new Date(start.getTime() + 60 * 60 * 1000);

        const event = await base44.asServiceRole.entities.CalendarEvent.create({
            company_id: companyId,
            title: `Appt: ${name}`,
            description: description || 'Booked via Sarah Voice Bridge',
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            event_type: 'appointment',
            status: 'scheduled',
            attendees: email ? [email] : []
        });

        let googleLink = null;
        try {
            const accessToken = await base44.asServiceRole.connectors.getAccessToken('googlecalendar');
            if (accessToken) {
                const gResp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        summary: `Appt: ${name}`,
                        description: `Booked by Sarah Voice Bridge\nReason: ${description}`,
                        start: { dateTime: start.toISOString() },
                        end: { dateTime: end.toISOString() },
                        attendees: email ? [{ email }] : []
                    })
                });
                const gData = await gResp.json();
                googleLink = gData.htmlLink;
            }
        } catch (e) {
            console.warn('[SarahVoiceBridge] Google Calendar sync failed:', e);
        }

        return {
            success: true,
            message: "Appointment booked successfully.",
            details: { date: start.toLocaleString(), google_link: googleLink }
        };

    } catch (e: any) {
        console.error('[SarahVoiceBridge] Booking failed:', e);
        return { error: "Failed to book appointment. Please try again." };
    }
}

async function handleSaveLead(base44: any, args: any, companyId: string) {
    console.log('[SarahVoiceBridge] Saving lead:', args);
    try {
        const { name, email, phone, service_needed, address } = args;

        const leads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId });
        let lead: any = null;

        if (email) lead = leads.find((l: any) => l.email === email);
        if (!lead && phone) lead = leads.find((l: any) => l.phone === phone);

        if (lead) {
            const updates: any = {};
            if (email && !lead.email) updates.email = email;
            if (service_needed) updates.notes = (lead.notes || '') + `\n[Sarah Update]: Interested in ${service_needed}`;
            if (address) updates.street = address;

            if (Object.keys(updates).length > 0) {
                await base44.asServiceRole.entities.Lead.update(lead.id, updates);
            }
            return { success: true, message: "Lead updated.", lead_id: lead.id };
        } else {
            const newLead = await base44.asServiceRole.entities.Lead.create({
                company_id: companyId,
                name: name || 'Voice Lead',
                email: email,
                phone: phone,
                source: 'ai',
                notes: `Captured via Sarah Voice Bridge.\nService: ${service_needed || 'N/A'}\nAddress: ${address || 'N/A'}`
            });
            return { success: true, message: "New lead created.", lead_id: newLead.id };
        }
    } catch (e: any) {
        console.error('[SarahVoiceBridge] Save lead failed:', e);
        return { error: "Failed to save lead details." };
    }
}
