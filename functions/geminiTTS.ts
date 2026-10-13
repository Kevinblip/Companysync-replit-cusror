import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    // Determine request mode FIRST before any auth
    const url = new URL(req.url);
    const isStreamRequest = url.searchParams.has('text');

    // For stream requests (Twilio <Play> URL), skip auth entirely — Twilio won't have a token
    let base44 = null;
    let user = null;
    if (!isStreamRequest) {
      base44 = createClientFromRequest(req);
      try {
        user = await base44.auth.me();
      } catch (e) {
        console.log('⚠️ No user auth - likely service role call');
      }
    }

    // Parse params
    let text = url.searchParams.get('text');
    let voice = url.searchParams.get('voice_id') || url.searchParams.get('voice');
    let assistantName = null;
    let reqCompanyId = null;

    if (!isStreamRequest && req.method === 'POST') {
      try {
        const body = await req.json();
        text = body.text || text;
        voice = body.voice || body.voice_id || voice;
        assistantName = body.assistantName;
        reqCompanyId = body.companyId;
      } catch (e) {
        // If JSON parsing fails, stick with query params
      }
    }

    console.log('🔊 RAW REQUEST DATA:');
    console.log('   text:', text?.substring(0, 50));
    console.log('   voice parameter:', voice);
    console.log('   isStreamRequest:', isStreamRequest);

    if (!text || typeof text !== 'string') {
      return Response.json({ error: 'Missing text' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    if (!apiKey) {
      console.error('❌ GOOGLE_GEMINI_API_KEY not configured');
      return Response.json({ error: 'Gemini API key not configured', fallback: true }, { status: 500 });
    }

    // Determine voice profile - prioritize explicit voice parameter
    let voiceName = voice || 'Aoede';
    
    // If assistantName provided but no explicit voice, look up settings (only for authenticated requests)
    if (!voice && assistantName && base44 && user) {
      const ownedCompanies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
      const resolvedCompanyId = reqCompanyId || ownedCompanies[0]?.id || staffProfiles[0]?.company_id;

      if (resolvedCompanyId) {
        const settings = await base44.asServiceRole.entities.AssistantSettings.filter({
          company_id: resolvedCompanyId
        });

        if (settings[0]?.google_voice_name) {
          voiceName = settings[0].google_voice_name;
        } else if (assistantName.toLowerCase() === 'sarah') {
          voiceName = 'Sage';
        } else if (assistantName.toLowerCase() === 'lexi') {
          voiceName = 'Aoede';
        }
      }
    }

    // Map friendly names to actual Google voice IDs
    const voiceMap = {
      'Puck': 'en-US-Journey-F',
      'Aoede': 'en-US-Studio-O',
      'Charon': 'en-US-Studio-Q',
      'Fenrir': 'en-US-Studio-M',
      'Kore': 'en-US-Journey-F',
      'Orion': 'en-US-Journey-D',
      'Sage': 'en-US-Journey-O'
    };

    const googleVoiceName = voiceMap[voiceName] || 'en-US-Studio-O';

    console.log('🔊 VOICE MAPPING:');
    console.log('   Requested voice name:', voiceName);
    console.log('   Mapped to Google voice ID:', googleVoiceName);
    console.log('   Was mapping found?', voiceMap[voiceName] ? 'YES' : 'NO (using fallback)');

    // Use Google's Text-to-Speech API with specified voice
    // Use MULAW format for Twilio compatibility (8kHz telephony standard)
    const requestBody = {
      input: { text },
      voice: {
        name: googleVoiceName,
        languageCode: 'en-US'
      },
      audioConfig: {
        audioEncoding: 'MULAW',
        sampleRateHertz: 8000,
        speakingRate: 1.05,
        pitch: 0
      }
    };

    console.log('📤 Sending to Google TTS API with voice:', googleVoiceName);

    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('❌ Google TTS API error:', response.status, errText);
      return Response.json({ 
        error: `Google TTS error: ${response.status}`,
        details: errText,
        fallback: true 
      }, { status: 500 });
    }

    const data = await response.json();
    
    // Check if we got audio data
    if (data.audioContent) {
      const rawAudioBytes = Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0));

      console.log('✅ TTS SUCCEEDED!');
      console.log('   Friendly name:', voiceName);
      console.log('   Google voice ID:', googleVoiceName);
      console.log('   Raw audio size:', rawAudioBytes.length, 'bytes');

      // Build a proper WAV header for MULAW 8kHz mono audio
      // Twilio requires a valid WAV file to play via <Play>
      function buildMulawWav(mulawData) {
        const numChannels = 1;
        const sampleRate = 8000;
        const bitsPerSample = 8;
        const byteRate = sampleRate * numChannels * bitsPerSample / 8;
        const blockAlign = numChannels * bitsPerSample / 8;
        const dataSize = mulawData.length;
        const headerSize = 44;
        const fileSize = headerSize + dataSize;

        const buffer = new ArrayBuffer(fileSize);
        const view = new DataView(buffer);
        const uint8 = new Uint8Array(buffer);

        // RIFF header
        uint8.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
        view.setUint32(4, fileSize - 8, true);     // file size - 8
        uint8.set([0x57, 0x41, 0x56, 0x45], 8);   // "WAVE"

        // fmt  chunk
        uint8.set([0x66, 0x6D, 0x74, 0x20], 12);  // "fmt "
        view.setUint32(16, 16, true);               // chunk size
        view.setUint16(20, 7, true);                // audio format: 7 = mu-law
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);

        // data chunk
        uint8.set([0x64, 0x61, 0x74, 0x61], 36);  // "data"
        view.setUint32(40, dataSize, true);
        uint8.set(mulawData, headerSize);

        return new Uint8Array(buffer);
      }

      const wavBytes = buildMulawWav(rawAudioBytes);
      console.log('   WAV file size:', wavBytes.length, 'bytes');

      // If called via query params (from sarahVoiceCallHandler/Twilio), return WAV audio directly
      if (isStreamRequest) {
        return new Response(wavBytes, {
          headers: {
            'Content-Type': 'audio/wav',
            'Content-Length': String(wavBytes.length),
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }

      // Otherwise upload and return URL (for frontend callers)
      const audioBlob = new Blob([wavBytes], { type: 'audio/wav' });
      const audioFile = new File([audioBlob], `tts_${Date.now()}.wav`, { type: 'audio/wav' });
      const upload = await base44.integrations.Core.UploadFile({ file: audioFile });
      console.log('   Audio URL:', upload.file_url);
      return Response.json({ audio_url: upload.file_url });
    }

    console.error('❌ No audio data in response');
    return Response.json({ error: 'No audio generated', fallback: true }, { status: 500 });

  } catch (error) {
    console.error('❌ Gemini TTS error:', error);
    return Response.json({ error: error.message, fallback: true }, { status: 500 });
  }
});