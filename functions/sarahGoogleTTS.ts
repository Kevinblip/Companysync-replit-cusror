import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Map voice IDs to Google Cloud TTS voice names (Same as handler)
const VOICE_MAP = {
    'Puck': 'en-US-Journey-F',       // Friendly & Warm - female
    'Aoede': 'en-US-Studio-O',       // Warm, Clear - female
    'Charon': 'en-US-Studio-Q',      // Deep, Smooth - male
    'Fenrir': 'en-US-Studio-M',      // Strong, Bold - male
    'Kore': 'en-US-Journey-F',       // Bright, Energetic - female
    'Sage': 'en-US-Journey-O',       // Gentle, Wise - female
    'Orion': 'en-US-Journey-D',      // Calm, Neutral - male
    'default': 'en-US-Journey-F'     // Default to Puck
};

Deno.serve(async (req) => {
    try {
        const url = new URL(req.url);
        let text = url.searchParams.get('text');
        let voiceId = url.searchParams.get('voice_id') || 'default';

        // Also accept text from POST body (for testing and direct calls)
        if (!text) {
            try {
                const body = await req.json();
                text = body.text;
                voiceId = body.voice_id || voiceId;
            } catch (_) {}
        }

        if (!text) {
            return new Response('Missing text', { status: 400 });
        }

        const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
        if (!apiKey) {
            console.error('❌ GOOGLE_GEMINI_API_KEY not configured');
            return new Response('Config error', { status: 500 });
        }

        const googleVoiceName = VOICE_MAP[voiceId] || VOICE_MAP['default'];

        // Journey voices don't support pitch parameter
        const isJourneyVoice = googleVoiceName.includes('Journey');
        const audioConfig = {
            audioEncoding: 'MULAW',
            sampleRateHertz: 8000,
            speakingRate: 1.2
        };
        if (!isJourneyVoice) {
            audioConfig.pitch = 0.5;
        }

        const requestBody = {
            input: { text },
            voice: {
                name: googleVoiceName,
                languageCode: 'en-US'
            },
            audioConfig
        };

        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('❌ TTS API error:', err);
            return new Response('TTS Error', { status: 500 });
        }

        const data = await response.json();
        
        if (data.audioContent) {
            // Decode base64 to binary
            const audioBytes = Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0));
            
            return new Response(audioBytes, {
                headers: {
                    'Content-Type': 'audio/basic', // Correct for MULAW 8000Hz
                    'Cache-Control': 'public, max-age=31536000' // Cache aggressively since text+voice is unique
                }
            });
        }

        return new Response('No audio content', { status: 500 });

    } catch (error) {
        console.error('TTS Handler Error:', error);
        return new Response(error.message, { status: 500 });
    }
});