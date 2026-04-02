import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
// import { Buffer } from "node:buffer"; // Removed to prevent potential import issues

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      console.log("User not authenticated");
      return Response.json({ error: 'User not authenticated in app' }, { status: 401 });
    }

    const body = await req.json();
    const { script, background_url, title, aspect_ratio = "16:9", mode = "avatar", avatar_id } = body;

    // MODE: AUDIO_ONLY (ElevenLabs)
    if (mode === 'audio_only') {
      const elevenKey = Deno.env.get('ELEVENLABS_API_KEY');
      if (!elevenKey) {
        return Response.json({ error: 'ElevenLabs API key not configured' }, { status: 500 });
      }

      // Default ElevenLabs voice (Adam - popular narration voice)
      const voiceId = "pNInz6obpgDQGcFmaJgB"; 
      
      console.log(`Generating voiceover via ElevenLabs for ${user.email}`);

      const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: script || "Contact us today for a free inspection.",
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      });

      if (!ttsResponse.ok) {
        const errText = await ttsResponse.text();
        return Response.json({ error: `ElevenLabs Error: ${errText}` }, { status: ttsResponse.status });
      }

      // We need to upload this audio file to storage to get a URL
      // Since we can't easily do that from here without the raw file handling complexity,
      // For now we will return the binary data as base64 so frontend can play it/store it?
      // OR better: use base44 storage integration if available, but backend functions 
      // can't easily call integrations that expect multipart form data from here.
      // Let's return a base64 string for the frontend to play directly.
      
      const arrayBuffer = await ttsResponse.arrayBuffer();
      // Manual base64 encoding to avoid Buffer dependency issues in some Deno environments
      let binary = '';
      const bytes = new Uint8Array(arrayBuffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Audio = btoa(binary);
      
      return Response.json({ 
        success: true, 
        data: { 
          audio_base64: `data:audio/mpeg;base64,${base64Audio}`,
          type: 'audio'
        }
      });
    }

    // MODE: AVATAR (HeyGen)
    const apiKey = Deno.env.get('HEYGEN_API_KEY');
    if (!apiKey) {
      console.log("HeyGen API key missing");
      return Response.json({ error: 'HeyGen API key not configured in secrets' }, { status: 500 });
    }

    // Dynamic Avatar & Voice Selection
    let avatarId = avatar_id || null; 
    let voiceId = null;

    try {
      // 1. Fetch available avatars (Only if not provided)
      if (!avatarId) {
        console.log("Fetching valid avatars from HeyGen...");
        const avatarsRes = await fetch('https://api.heygen.com/v2/avatars', {
          headers: { 'X-Api-Key': apiKey }
        });

        if (avatarsRes.ok) {
          const avatarsData = await avatarsRes.json();
          const avatars = avatarsData.data?.avatars || [];
          if (avatars.length > 0) {
            avatarId = avatars[0].avatar_id;
            console.log(`Using valid Avatar ID: ${avatarId}`);
          }
        } else {
          console.error("Failed to fetch avatars:", await avatarsRes.text());
        }
      }

      // 2. Fetch available voices
      console.log("Fetching valid voices from HeyGen...");
      const voicesRes = await fetch('https://api.heygen.com/v2/voices', {
        headers: { 'X-Api-Key': apiKey }
      });

      if (voicesRes.ok) {
        const voicesData = await voicesRes.json();
        const voices = voicesData.data?.voices || [];
        if (voices.length > 0) {
          // Try to find a standard English voice
          const englishVoice = voices.find(v => v.language === 'English' && !v.premium) || voices[0];
          voiceId = englishVoice.voice_id;
          console.log(`Using valid Voice ID: ${voiceId} (${englishVoice.name})`);
        }
      } else {
        console.error("Failed to fetch voices:", await voicesRes.text());
      }
    } catch (e) {
      console.error("Error fetching dynamic assets:", e);
    }

    // Fail if we couldn't get valid assets
    if (!avatarId) {
      return Response.json({ 
        error: "No avatar selected. Please select an avatar to generate an avatar video, or use the 'Generate Video (Image + Voice)' option for a non-avatar video."
      }, { status: 400 });
    }

    if (!voiceId) {
       return Response.json({ 
        error: "Unable to retrieve valid HeyGen Voice. Please check your API Key."
      }, { status: 500 });
    }

    console.log(`Generating HeyGen video for ${user.email} using Avatar: ${avatarId}, Voice: ${voiceId}`);

    const response = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_inputs: [{
          character: {
            type: 'avatar',
            avatar_id: avatarId,
            avatar_style: 'normal'
          },
          voice: {
            type: 'text',
            input_text: script || "Welcome to our roofing services.",
            voice_id: voiceId
          },
          background: background_url ? {
            type: "image",
            url: background_url,
            fit: "cover"
          } : {
            type: "color",
            value: "#F3F4F6"
          }
        }],
        dimension: {
          width: aspect_ratio === "9:16" ? 720 : 1280,
          height: aspect_ratio === "9:16" ? 1280 : 720
        },
        aspect_ratio: aspect_ratio,
        test: false,
        title: title || 'Social Ad Video'
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`HeyGen API Error (${response.status}): ${errorText}`);
      
      // If HeyGen returns 401, return 500 to client to distinguish from App 401
      const status = response.status === 401 ? 500 : response.status;
      const msg = response.status === 401 ? "HeyGen API Key is invalid or unauthorized" : `HeyGen Error: ${errorText}`;
      
      return Response.json({ error: msg, details: errorText }, { status: status });
    }

    const data = await response.json();
    return Response.json(data);

  } catch (error) {
    console.error("Function error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});