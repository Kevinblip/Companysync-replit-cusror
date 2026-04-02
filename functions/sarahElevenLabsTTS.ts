import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Map voice IDs to ElevenLabs voice IDs
const VOICE_MAP = {
    'Puck': 'EXAVITQu4vr4xnSDxMaL',      // Sarah (warm, friendly female)
    'Aoede': 'jsCqWAovK2LkecY7zXl4',     // Freya (clear, professional female)
    'Charon': 'TxGEqnHWrfWFTfGW9XjX',    // Josh (deep, smooth male)
    'Fenrir': 'VR6AewLTigWG4xSOukaG',    // Arnold (strong, bold male)
    'Kore': 'MF3mGyEYCl7XYWbV9V6O',      // Elli (bright, energetic female)
    'Sage': 'pNInz6obpgDQGcFmaJgB',      // Adam (gentle, wise male)
    'Orion': 'onwK4e9ZLuTAKqWW03F9',     // Daniel (calm, neutral male)
    'default': 'EXAVITQu4vr4xnSDxMaL'    // Default to Sarah
};

Deno.serve(async (req) => {
    try {
        const url = new URL(req.url);
        let text = url.searchParams.get('text');
        let voiceId = url.searchParams.get('voice_id') || 'default';
        
        // Support POST body as well
        if (req.method === 'POST') {
            try {
                const body = await req.json();
                text = body.text || text;
                voiceId = body.voice_id || voiceId;
            } catch (e) {
                // If JSON parsing fails, stick with query params
            }
        }
        
        if (!text) {
            return Response.json({ error: 'Missing text parameter' }, { status: 400 });
        }
        
        const elevenLabsApiKey = Deno.env.get('ELEVENLABS_API_KEY');
        if (!elevenLabsApiKey) {
            return Response.json({ error: 'ElevenLabs API key not configured' }, { status: 500 });
        }
        
        // Map voice ID to ElevenLabs voice
        const elevenLabsVoiceId = VOICE_MAP[voiceId] || VOICE_MAP['default'];
        
        console.log(`🎙️ ElevenLabs TTS: voice=${voiceId} → ${elevenLabsVoiceId}, text="${text.substring(0, 50)}..."`);
        
        // Call ElevenLabs API
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}/stream`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': elevenLabsApiKey
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_turbo_v2_5',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0.0,
                    use_speaker_boost: true
                }
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('ElevenLabs API error:', response.status, errorText);
            return Response.json({ 
                error: 'ElevenLabs TTS failed', 
                details: errorText 
            }, { status: response.status });
        }
        
        // Stream the audio back
        return new Response(response.body, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'public, max-age=3600'
            }
        });
        
    } catch (error) {
        console.error('❌ ElevenLabs TTS Error:', error.message);
        return Response.json({ 
            error: 'Failed to generate speech', 
            details: error.message 
        }, { status: 500 });
    }
});