import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const url = new URL(req.url);
        let text = url.searchParams.get('text');
        let voiceId = url.searchParams.get('voiceId');

        // Allow body parsing for testing/POST
        if (!text) {
            try {
                const contentType = req.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const body = await req.json();
                    text = body.text;
                    voiceId = body.voiceId;
                }
            } catch (e) {
                // Ignore body parsing errors
            }
        }

        voiceId = voiceId || 'EXAVITQu4vr4xnSDxMaL'; // Bella default

        if (!text) {
            console.error('Missing text parameter');
            return new Response('Missing text', { status: 400 });
        }

        console.log(`Generating audio for: "${text.substring(0, 50)}..." with voice: ${voiceId}`);

        const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY');
        if (!elevenLabsKey) {
            console.error('Missing ELEVENLABS_API_KEY');
            return new Response('Config error', { status: 500 });
        }

        // Use streaming response from ElevenLabs
        // optimize_streaming_latency: 0 (default), 1, 2, 3, 4 (max)
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=ulaw_8000&optimize_streaming_latency=4`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/basic',
                'xi-api-key': elevenLabsKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_turbo_v2_5',
                voice_settings: {
                    stability: 0.4,
                    similarity_boost: 0.75,
                    style: 0.6,
                    use_speaker_boost: true
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('ElevenLabs Error:', response.status, errText);
            return new Response('Voice gen error', { status: 500 });
        }

        console.log('✅ ElevenLabs stream received, piping to response');

        return new Response(response.body, {
            headers: {
                'Content-Type': 'audio/basic',
                'Cache-Control': 'no-cache'
            }
        });

    } catch (error) {
        console.error('Audio Gen Error:', error);
        return new Response('Server Error', { status: 500 });
    }
});