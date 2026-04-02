import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ─── Audio conversion: Twilio mulaw 8kHz ↔ Gemini PCM 16kHz/24kHz ───
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

function twilioToGemini(mulawB64) {
    const binaryStr = atob(mulawB64);
    const nSrc = binaryStr.length;
    const pcm8k = new Int16Array(nSrc);
    for (let i = 0; i < nSrc; i++) pcm8k[i] = MULAW_DECODE_TABLE[binaryStr.charCodeAt(i)];
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

function geminiToTwilio(pcmB64) {
    const binaryStr = atob(pcmB64);
    const len = binaryStr.length;
    const nSrc = len >> 1;
    const pcm24k = new Int16Array(nSrc);
    const view = new DataView(new ArrayBuffer(len));
    for (let i = 0; i < len; i++) view.setUint8(i, binaryStr.charCodeAt(i));
    for (let i = 0; i < nSrc; i++) pcm24k[i] = view.getInt16(i * 2, true);
    const nDst = Math.floor(nSrc / 3);
    const out = new Uint8Array(nDst);
    for (let i = 0; i < nDst; i++) out[i] = mulawEncode(pcm24k[i * 3]);
    let binary = '';
    for (let i = 0; i < out.length; i++) binary += String.fromCharCode(out[i]);
    return btoa(binary);
}

Deno.serve(async (req) => {
    console.log('🎙️ Gemini Live Call Stream - WebSocket handler');

    const { socket, response } = Deno.upgradeWebSocket(req);
    
    const url = new URL(req.url);
    const companyId = url.searchParams.get('companyId');
    const from = url.searchParams.get('from');
    const callSid = url.searchParams.get('callSid');

    console.log('📞 Call info:', { companyId, from, callSid });

    let geminiWs = null;
    let currentStreamSid = null;
    const base44 = createClientFromRequest(req);

    socket.onopen = async () => {
        console.log('✅ Twilio Media Stream connected');

        try {
            // Load Sarah's settings
            const settingsRows = await base44.asServiceRole.entities.AssistantSettings.filter({ 
                company_id: companyId, 
                assistant_name: 'sarah' 
            });
            const settings = settingsRows[0] || {};

            const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            const company = companies[0];
            const companyName = settings.brand_short_name || company?.company_name || 'our company';

            let agentName = 'Sarah';
            if (settings.system_prompt) {
                const nameMatch = settings.system_prompt.match(/(?:You are|Your name is|I am|Role:)[:\s]*(?:You are\s+)?([A-Z][a-z]+)/i);
                if (nameMatch && nameMatch[1] && nameMatch[1].toLowerCase() !== 'you') {
                    agentName = nameMatch[1];
                }
            }

            const systemPrompt = settings.system_prompt || `You are ${agentName}, a friendly receptionist for ${companyName}. Keep responses under 20 words.`;
            const selectedVoice = settings.gemini_voice || 'Aoede';

            // Connect to Gemini
            const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY');
            if (!geminiApiKey) {
                throw new Error('GOOGLE_GEMINI_API_KEY not configured');
            }

            const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;
            
            console.log('🔌 Connecting to Gemini...');
            geminiWs = new WebSocket(geminiUrl);

            geminiWs.onopen = () => {
                console.log('✅ Connected to Gemini');
                
                // Send setup configuration
                geminiWs.send(JSON.stringify({
                    setup: {
                        model: "models/gemini-2.0-flash-live-001",
                        generation_config: {
                            response_modalities: ["AUDIO"],
                            speech_config: {
                                voice_config: { 
                                    prebuilt_voice_config: { voice_name: selectedVoice } 
                                }
                            }
                        },
                        system_instruction: {
                            parts: [{ text: systemPrompt }]
                        }
                    }
                }));
            };

            geminiWs.onmessage = async (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.serverContent?.modelTurn?.parts) {
                        for (const part of data.serverContent.modelTurn.parts) {
                            if (part.inlineData && part.inlineData.mimeType.startsWith("audio/")) {
                                const mulawB64 = geminiToTwilio(part.inlineData.data);
                                socket.send(JSON.stringify({
                                    event: 'media',
                                    streamSid: currentStreamSid,
                                    media: { payload: mulawB64 }
                                }));
                            }
                        }
                    }

                    if (data.serverContent?.interrupted) {
                        console.log('🔇 Interrupted');
                        if (currentStreamSid) {
                            socket.send(JSON.stringify({ event: 'clear', streamSid: currentStreamSid }));
                        }
                    }
                } catch (err) {
                    console.error('❌ Gemini message error:', err);
                }
            };

            geminiWs.onclose = () => {
                console.log('❌ Gemini disconnected');
            };

            geminiWs.onerror = (err) => {
                console.error('❌ Gemini error:', err);
            };

        } catch (error) {
            console.error('❌ Setup error:', error);
            socket.close();
        }
    };

    socket.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);
            
            // Handle Twilio stream events
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

            if (msg.event === 'start') {
                currentStreamSid = msg.start.streamSid;
                console.log('🎬 Stream started:', currentStreamSid);
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

    socket.onerror = (err) => {
        console.error('❌ Twilio stream error:', err);
    };

    return response;
});