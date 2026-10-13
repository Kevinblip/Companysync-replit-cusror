import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Accept either JSON or multipart form data
    let text = '';
    let voiceName = 'en-US-Neural2-F';

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json();
      text = body?.text || '';
      voiceName = body?.voiceName || voiceName;
    } else if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      text = String(form.get('text') || '');
      voiceName = String(form.get('voiceName') || voiceName);
    } else {
      const body = await req.json().catch(() => ({}));
      text = body?.text || '';
      voiceName = body?.voiceName || voiceName;
    }

    if (!text || typeof text !== 'string') {
      return Response.json({ error: 'Missing text' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_SPEECH_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_SPEECH_API_KEY is not configured' }, { status: 500 });
    }

    const ttsPayload = {
      input: { text },
      voice: {
        languageCode: 'en-US',
        name: voiceName,
        ssmlGender: 'FEMALE',
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0,
        effectsProfileId: ['small-bluetooth-speaker-class-device']
      }
    };

    const resp = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}` , {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ttsPayload)
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      return Response.json({ error: `Google TTS error: ${resp.status} ${errTxt}` }, { status: 500 });
    }

    const data = await resp.json();
    const base64Audio = data?.audioContent;
    if (!base64Audio) {
      return Response.json({ error: 'No audioContent returned from Google TTS' }, { status: 500 });
    }

    // Convert to Blob -> File and upload to storage for a stable URL
    const audioBytes = Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0));
    const audioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
    const audioFile = new File([audioBlob], `lexi_tts_${Date.now()}.mp3`, { type: 'audio/mpeg' });

    const upload = await base44.integrations.Core.UploadFile({ file: audioFile });

    return Response.json({ audio_url: upload.file_url });
  } catch (error) {
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});