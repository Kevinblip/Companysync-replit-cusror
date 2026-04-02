import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Voice map - same as sarahGoogleTTS and sarahVoiceCallHandler
const VOICE_MAP = {
    'Puck': 'en-US-Journey-F',
    'Aoede': 'en-US-Studio-O',
    'Charon': 'en-US-Studio-Q',
    'Fenrir': 'en-US-Studio-M',
    'Kore': 'en-US-Journey-F',
    'Sage': 'en-US-Journey-O',
    'Orion': 'en-US-Journey-D',
    'default': 'en-US-Journey-F'
};

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { text, voice } = await req.json();
        if (!text) {
            return Response.json({ error: 'Missing text' }, { status: 400 });
        }

        const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
        if (!apiKey) {
            return Response.json({ error: 'Google API key not configured' }, { status: 500 });
        }

        const googleVoiceName = VOICE_MAP[voice] || VOICE_MAP['default'];
        console.log(`🔊 Test preview: voice=${voice} -> ${googleVoiceName}`);

        // Use MP3 format for browser playback (not MULAW which is phone-only)
        const requestBody = {
            input: { text },
            voice: {
                name: googleVoiceName,
                languageCode: 'en-US'
            },
            audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: 1.05,
                pitch: 0
            }
        };

        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('TTS API error:', errText);
            return Response.json({ error: 'TTS failed' }, { status: 500 });
        }

        const data = await response.json();

        if (data.audioContent) {
            const audioBytes = Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0));
            const audioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
            const audioFile = new File([audioBlob], `preview_${Date.now()}.mp3`, { type: 'audio/mpeg' });

            const upload = await base44.integrations.Core.UploadFile({ file: audioFile });
            console.log(`✅ Preview audio: ${upload.file_url}`);

            return Response.json({ audio_url: upload.file_url });
        }

        return Response.json({ error: 'No audio generated' }, { status: 500 });
    } catch (error) {
        console.error('Preview error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});