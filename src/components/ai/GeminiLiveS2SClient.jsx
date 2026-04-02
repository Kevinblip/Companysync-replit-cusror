import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { Mic, MicOff, Play, Square, Sparkles, Volume2 } from "lucide-react";

const GEMINI_VOICES = [
  { id: "Aoede",  label: "Aoede — Warm, Clear ♀" },
  { id: "Kore",   label: "Kore — Bright, Energetic ♀" },
  { id: "Leda",   label: "Leda — Soft, Soothing ♀" },
  { id: "Zephyr", label: "Zephyr — Calm, Breezy ♀" },
  { id: "Charon", label: "Charon — Informational ♂" },
  { id: "Fenrir", label: "Fenrir — Excitable, Bold ♂" },
  { id: "Orus",   label: "Orus — Firm, Steady ♂" },
  { id: "Puck",   label: "Puck — Upbeat, Playful ♂" },
];

export default function GeminiLiveS2SClient({ systemPrompt: propPrompt, companyId }) {
  const [status, setStatus] = React.useState("idle");
  const [error, setError] = React.useState("");
  const [selectedVoice, setSelectedVoice] = React.useState("Aoede");
  const [micEnabled, setMicEnabled] = React.useState(true);
  const [user, setUser] = React.useState(null);
  const [isSpeaking, setIsSpeaking] = React.useState(false);

  const wsRef = React.useRef(null);
  const audioContextRef = React.useRef(null);
  const processorRef = React.useRef(null);
  const audioQueueRef = React.useRef([]);
  const isPlayingRef = React.useRef(false);
  const currentSourceRef = React.useRef(null);
  const localStreamRef = React.useRef(null);
  const micEnabledRef = React.useRef(true);
  const isReadyRef = React.useRef(false);
  
  // BUG FIX: Interruption tracking
  const lastInterruptTimeRef = React.useRef(0);
  const echoGuardUntilRef = React.useRef(0);

  React.useEffect(() => {
    micEnabledRef.current = micEnabled;
  }, [micEnabled]);

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const stopAllAudio = () => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
        currentSourceRef.current.disconnect();
      } catch (e) {}
      currentSourceRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setIsSpeaking(false);
    echoGuardUntilRef.current = Date.now() + 600;
  };

  const playNextChunk = async () => {
    if (!audioContextRef.current || audioQueueRef.current.length === 0 || isPlayingRef.current) {
      if (audioQueueRef.current.length === 0) {
        setIsSpeaking(false);
      }
      return;
    }

    if (audioContextRef.current.state !== 'running') {
      try {
        await audioContextRef.current.resume();
      } catch(e) { 
        console.error('Resume failed:', e); 
        return;
      }
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);
    const audioData = audioQueueRef.current.shift();

    try {
      const float32Data = new Float32Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        float32Data[i] = audioData[i] / 32768.0;
      }

      const buffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
      buffer.getChannelData(0).set(float32Data);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;

      const gainNode = audioContextRef.current.createGain();
      gainNode.gain.value = 1.5;

      source.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);

      currentSourceRef.current = source;

      source.onended = () => {
        currentSourceRef.current = null;
        isPlayingRef.current = false;
        if (audioQueueRef.current.length === 0) {
          setIsSpeaking(false);
        }
        setTimeout(() => playNextChunk(), 0);
      };

      source.start(0);
    } catch (e) {
      console.error('Playback error:', e);
      currentSourceRef.current = null;
      isPlayingRef.current = false;
      setIsSpeaking(false);
      playNextChunk();
    }
  };

  const startSession = async () => {
    setError("");
    setStatus("connecting");

    // Create and unlock audio context
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    audioContextRef.current = audioContext;
    await audioContext.resume();

    // Play unlock beep
    try {
      const unlockBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.1, audioContext.sampleRate);
      const data = unlockBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.sin(2 * Math.PI * 440 * i / audioContext.sampleRate) * 0.3;
      }
      const unlockSource = audioContext.createBufferSource();
      unlockSource.buffer = unlockBuffer;
      unlockSource.connect(audioContext.destination);
      unlockSource.start(0);
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch (e) {
      console.error('Failed to play unlock beep:', e);
    }

    try {
      // Get token from backend
      const tokenResponse = await base44.functions.invoke('generateLexiVoiceToken', { companyId });
      const token = tokenResponse.data?.token;
      const bridgeUrl = tokenResponse.data?.bridge_url;

      if (!token || !bridgeUrl) {
        throw new Error('Failed to get authentication token');
      }

      setStatus("connecting");

      // Connect to S2S bridge (not the old bridge, but new S2S-specific one)
      const wsUrl = `${bridgeUrl}?token=${encodeURIComponent(token)}&mode=s2s`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        console.log("✅ S2S WebSocket opened");
        setStatus("connected");
        isReadyRef.current = false;
      };

      ws.onmessage = async (event) => {
        try {
          let data;
          if (event.data instanceof Blob) {
            const text = await event.data.text();
            if (!text || text.trim() === '') return;
            data = JSON.parse(text);
          } else {
            if (!event.data || typeof event.data !== 'string' || event.data.trim() === '') return;
            data = JSON.parse(event.data);
          }

          console.log('📨 S2S Message:', data);

          // Handle system status
          if (data.system_status) {
            setStatus(data.message || data.system_status);

            if (data.google_error) {
              console.error("❌ Google Error:", data.google_error);
              setError(`Google Gemini Error: ${JSON.stringify(data.google_error, null, 2)}`);
              return;
            }

            // Google connected -> send setup
            if (data.system_status === "google_connected") {
              setError("");
              console.log("✅ Google connected, sending S2S setup...");

              const setupMsg = {
                setup: {
                  model: "models/gemini-2.0-flash-exp",
                  generation_config: {
                    response_modalities: ["audio"]
                  },
                  system_instruction: propPrompt || "You are Lexi, a helpful AI assistant.",
                  speech_config: {
                    voice_config: {
                      prebuilt_voice_config: {
                        voice_name: selectedVoice
                      }
                    }
                  }
                }
              };

              ws.send(JSON.stringify(setupMsg));
              setStatus("configuring");

              // Start audio after setup
              try {
                await startAudioRecording(ws);
                setMicEnabled(true);
              } catch (err) {
                console.error("❌ Audio recording failed:", err);
                setError(`Microphone error: ${err.message}`);
                ws.close();
                return;
              }

              setTimeout(() => {
                if (!isReadyRef.current && ws.readyState === WebSocket.OPEN) {
                  isReadyRef.current = true;
                  setStatus("live");
                }
              }, 2000);
            }
            return;
          }

          if (data.error) {
            console.error("❌ Backend Error:", data.error);
            setError(`${data.error}: ${data.details || ""}`);
            return;
          }

          // Setup complete
          if (data.setupComplete) {
            console.log("✅ Setup completed - LIVE");
            isReadyRef.current = true;
            setStatus("live");
            setError("");
          }

          // Process audio from Gemini
          if (data.serverContent?.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.inlineData && part.inlineData.mimeType.startsWith("audio/")) {
                console.log('🔊 Received audio chunk');

                if (audioContextRef.current && audioContextRef.current.state !== 'running') {
                  await audioContextRef.current.resume();
                }

                const binaryString = atob(part.inlineData.data);
                const len = binaryString.length;
                const bytes = new Int16Array(len / 2);
                const view = new DataView(new ArrayBuffer(len));
                for(let i=0; i<len; i++) {
                  view.setUint8(i, binaryString.charCodeAt(i));
                }
                for(let i=0; i<len/2; i++) {
                  bytes[i] = view.getInt16(i*2, true);
                }

                audioQueueRef.current.push(bytes);
                playNextChunk();
              }
            }
          }
        } catch (err) {
          console.error("WS Message Error", err);
        }
      };

      ws.onclose = (e) => {
        console.log("❌ WS Closed", e.code);
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(t => t.stop());
          localStreamRef.current = null;
        }

        if ((e.code === 1000 || e.code === 1005) && isReadyRef.current) {
          setStatus("idle");
          return;
        }

        if (!isReadyRef.current && status !== "idle") {
          setError(`Connection closed during setup (Code ${e.code})`);
          setStatus("idle");
          return;
        }

        setError(`Disconnected (Code ${e.code})`);
        setStatus("idle");
      };

      ws.onerror = (e) => {
        console.error("WS Error Event:", e);
        setError("WebSocket connection error");
      };

    } catch (e) {
      console.error(e);
      setError(e.message);
      setStatus("idle");
    }
  };

  const startAudioRecording = async (ws) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000, channelCount: 1 } });
    localStreamRef.current = stream;

    const audioContext = audioContextRef.current;
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    const SILENCE_THRESHOLD = 0.04;
    const INTERRUPT_COOLDOWN = 800;
    const SPEECH_CONFIRM_FRAMES = 3;
    let speechFrameCount = 0;

    processor.onaudioprocess = (e) => {
      if (ws.readyState === WebSocket.OPEN && micEnabledRef.current && isReadyRef.current) {
        const inputData = e.inputBuffer.getChannelData(0);

        // Calculate RMS
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);

        // BUG FIX: Improved interruption with confirmation frames
        if (rms > SILENCE_THRESHOLD) {
          speechFrameCount++;
          
          if (speechFrameCount >= SPEECH_CONFIRM_FRAMES) {
            const now = Date.now();
            const timeSinceLastInterrupt = now - lastInterruptTimeRef.current;
            
            if ((isPlayingRef.current || audioQueueRef.current.length > 0) && timeSinceLastInterrupt > INTERRUPT_COOLDOWN) {
              console.log('🎤 S2S: User interrupting - stopping AI');
              lastInterruptTimeRef.current = now;

              // Immediately stop all audio
              stopAllAudio();

              // Send interrupt to Gemini
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  client_content: {
                    turns: [{ role: "user", parts: [{ text: "" }] }],
                    turn_complete: true
                  }
                }));
              }
            }
          }
        } else {
          speechFrameCount = 0;
        }

        if (isPlayingRef.current || audioQueueRef.current.length > 0 || Date.now() < echoGuardUntilRef.current) {
          return;
        }

        const int16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          int16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }

        const base64Audio = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));

        ws.send(JSON.stringify({
          realtime_input: {
            media_chunks: [{
              mime_type: "audio/pcm;rate=16000",
              data: base64Audio
            }]
          }
        }));
      }
    };

    source.connect(processor);
    // ECHO FIX: Use silent gain node instead of direct destination to prevent mic loopback
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    processorRef.current = processor;
  };

  const stopSession = () => {
    // BUG FIX: Stop audio first
    stopAllAudio();
    
    wsRef.current?.close();
    localStreamRef.current?.getTracks().forEach(t => t.stop());

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(e => console.log('Audio context already closed'));
    }

    wsRef.current = null;
    localStreamRef.current = null;
    audioContextRef.current = null;
    processorRef.current = null;
    isReadyRef.current = false;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    lastInterruptTimeRef.current = 0;
    setStatus("idle");
    setIsSpeaking(false);
  };

  const toggleMic = () => {
    setMicEnabled(prev => !prev);
  };

  return (
    <Card className="max-w-xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" /> Native S2S Mode (Beta)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-red-700">{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-4 bg-gray-50 p-3 rounded-lg border">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 uppercase">Voice</label>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                disabled={status === "live"}
                className="w-full bg-white border rounded px-2 py-1 text-sm"
              >
                {GEMINI_VOICES.map(voice => (
                  <option key={voice.id} value={voice.id}>{voice.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            {status !== "connected" && status !== "live" ? (
              <Button onClick={startSession} className="gap-2 flex-1">
                <Play className="w-4 h-4" /> Start S2S Session
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={toggleMic} className="gap-2">
                  {micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  {micEnabled ? "Mute" : "Unmute"}
                </Button>
                <Button variant="destructive" onClick={stopSession} className="gap-2">
                  <Square className="w-4 h-4" /> Stop
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="text-sm text-gray-600">
          <p>
            Status:{" "}
            <span className={`font-medium ${status === 'live' ? 'text-green-600 animate-pulse' : ''}`}>
              {status === 'live' ? '🟢 LIVE' : status}
              {status === 'live' && micEnabled && ' - 🎤 Mic Active'}
            </span>
          </p>
          {isSpeaking && (
            <p className="flex items-center gap-2 text-blue-600 mt-2">
              <Volume2 className="w-4 h-4 animate-pulse" />
              <span>Lexi is speaking...</span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}