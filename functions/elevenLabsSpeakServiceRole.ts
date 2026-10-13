import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const { text, voiceId, voice_id } = await req.json();
    const apiKey = Deno.env.get('ELEVENLABS_API_KEY');

    if (!apiKey) {
      console.error('❌ ELEVENLABS_API_KEY not found');
      return Response.json({ error: 'ElevenLabs API key not configured', fallback: true }, { status: 500 });
    }

    const finalVoiceId = voiceId || voice_id || 'EXAVITQu4vr4xnSDxMaL'; // Bella default
    
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return Response.json({ error: 'Missing text' }, { status: 400 });
    }

    console.log('🔊 ElevenLabs TTS (Service Role):');
    console.log('   Voice ID:', finalVoiceId);
    console.log('   Text length:', text.length);

    // Call ElevenLabs API
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('❌ ElevenLabs API error:', response.status, errorBody);
      return Response.json({ 
        error: `ElevenLabs error: ${response.status}`,
        details: errorBody,
        fallback: true
      }, { status: 500 });
    }

    // Get audio and upload to storage
    const audioBuffer = await response.arrayBuffer();
    console.log('✅ Audio generated:', audioBuffer.byteLength, 'bytes');

    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
    const audioFile = new File([audioBlob], `sarah_voice_${Date.now()}.mp3`, { type: 'audio/mpeg' });
    const upload = await base44.asServiceRole.integrations.Core.UploadFile({ file: audioFile });

    return Response.json({ audio_url: upload.file_url });

  } catch (error) {
    console.error('❌ ElevenLabs error:', error);
    return Response.json({ error: error.message, fallback: true }, { status: 500 });
  }
});