import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { text, voiceId, voice_id } = await req.json();
    const apiKey = Deno.env.get('ELEVENLABS_API_KEY');

    if (!apiKey) {
      console.error('❌ ELEVENLABS_API_KEY not found in environment');
      return Response.json({ error: 'ElevenLabs API key not configured', fallback: true }, { status: 500 });
    }

    // Use Bella (energetic, friendly) instead of Rachel (too professional/flat)
    const finalVoiceId = voiceId || voice_id || 'EXAVITQu4vr4xnSDxMaL';
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return Response.json({ error: 'Missing text' }, { status: 400 });
    }

    console.log('🔊 ElevenLabs TTS Request:');
    console.log('   Voice ID:', finalVoiceId);
    console.log('   API Key present:', !!apiKey);
    console.log('   Text length:', text.length);
    console.log('   Text preview:', text.substring(0, 100) + '...');

    // ElevenLabs text-to-speech API with personality settings
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
          stability: 0.35,        // Lower = more expressive
          similarity_boost: 0.8,  // Higher = more consistent
          style: 0.65,            // Higher = more exaggerated/personality
          use_speaker_boost: true // Clearer voice
        }
      })
    });

    console.log('🔊 ElevenLabs API Response:');
    console.log('   Status:', response.status);
    console.log('   Status Text:', response.statusText);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('❌ ElevenLabs API Failed:');
      console.error('   Status:', response.status);
      console.error('   Error Body:', errorBody);
      
      // Parse error if JSON
      try {
        const errorJson = JSON.parse(errorBody);
        console.error('   Parsed Error:', JSON.stringify(errorJson, null, 2));
      } catch (e) {
        // Not JSON, already logged as text
      }
      
      return Response.json({ 
        error: `ElevenLabs API error: ${response.status}`,
        details: errorBody,
        fallback: true
      }, { status: 500 });
    }

    // Get the audio as ArrayBuffer
    const audioBuffer = await response.arrayBuffer();
    console.log('✅ ElevenLabs audio generated successfully!');
    console.log('   Audio size:', audioBuffer.byteLength, 'bytes');

    // Convert to Blob -> File for upload
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
    const audioFile = new File([audioBlob], `lexi_tts_${Date.now()}.mp3`, { type: 'audio/mpeg' });

    // Upload to storage
    const upload = await base44.integrations.Core.UploadFile({ file: audioFile });

    console.log('✅ Audio uploaded successfully!');
    return Response.json({ audio_url: upload.file_url });

  } catch (error) {
    console.error('❌ ElevenLabs speak error:', error);
    console.error('   Error name:', error.name);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    return Response.json({ error: error.message, fallback: true }, { status: 500 });
  }
});