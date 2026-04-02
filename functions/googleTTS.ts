import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { text, voiceName, speakingRate, pitch, assistantName } = await req.json();

    if (!text || typeof text !== 'string') {
      return Response.json({ error: 'Missing text' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_SPEECH_API_KEY');
    if (!apiKey) {
      console.error('❌ GOOGLE_SPEECH_API_KEY not configured');
      return Response.json({ error: 'Google Speech API key not configured', fallback: true }, { status: 500 });
    }

    // Get company and assistant settings for voice customization
    let finalVoiceName = voiceName || 'en-US-Neural2-F';
    let finalSpeakingRate = speakingRate || 1.05;
    let finalPitch = pitch || 0.0;

    if (assistantName) {
      const ownedCompanies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
      const companyId = ownedCompanies[0]?.id || staffProfiles[0]?.company_id;

      if (companyId) {
        const settings = await base44.asServiceRole.entities.AssistantSettings.filter({
          company_id: companyId,
          assistant_name: assistantName.toLowerCase()
        });

        if (settings[0]) {
          finalVoiceName = settings[0].google_voice_name || finalVoiceName;
          finalSpeakingRate = settings[0].voice_speaking_rate || finalSpeakingRate;
          finalPitch = settings[0].voice_pitch || finalPitch;
        }
      }
    }

    console.log('🔊 Google TTS Request:');
    console.log('   Voice:', finalVoiceName);
    console.log('   Speaking Rate:', finalSpeakingRate);
    console.log('   Pitch:', finalPitch);
    console.log('   Text length:', text.length);

    const ttsPayload = {
      input: { text },
      voice: {
        languageCode: 'en-US',
        name: finalVoiceName,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: finalSpeakingRate,
        pitch: finalPitch,
        effectsProfileId: ['small-bluetooth-speaker-class-device']
      }
    };

    const resp = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ttsPayload)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('❌ Google TTS error:', resp.status, errText);
      return Response.json({ 
        error: `Google TTS error: ${resp.status}`,
        fallback: true 
      }, { status: 500 });
    }

    const data = await resp.json();
    const base64Audio = data?.audioContent;
    
    if (!base64Audio) {
      return Response.json({ error: 'No audio content returned', fallback: true }, { status: 500 });
    }

    // Convert to file and upload for stable URL
    const audioBytes = Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0));
    const audioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
    const audioFile = new File([audioBlob], `tts_${Date.now()}.mp3`, { type: 'audio/mpeg' });

    const upload = await base44.integrations.Core.UploadFile({ file: audioFile });

    console.log('✅ Google TTS succeeded, uploaded to:', upload.file_url);

    return Response.json({ audio_url: upload.file_url });

  } catch (error) {
    console.error('❌ Google TTS error:', error);
    return Response.json({ error: error.message, fallback: true }, { status: 500 });
  }
});