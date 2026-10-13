import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { Mic, MicOff, Play, Square, Sparkles, Activity } from "lucide-react";

export default function OpenAILiveClient({ systemPrompt }) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [micEnabled, setMicEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  
  const addLog = (msg) => {
    setDebugLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
    console.log(`[OpenAI Client] ${msg}`);
  };

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const appIdRef = useRef(null);

  useEffect(() => {
    // Get App ID for constructing WS URL
    const fetchAppId = async () => {
        if (base44.appId) {
            appIdRef.current = base44.appId;
            return;
        }
        try {
            const resp = await base44.functions.invoke('getAppInfo');
            if (resp.data?.appId) appIdRef.current = resp.data.appId;
        } catch (e) {
            console.error("Failed to fetch App ID", e);
        }
    };
    fetchAppId();

    return () => stopSession();
  }, []);

  const startSession = async () => {
    if (!appIdRef.current) {
        setError("App ID not loaded yet. Please wait a moment.");
        return;
    }

    setStatus("connecting");
    setError("");

    try {
        // Construct WS URL - Robust Logic
        let apiBase = base44.apiClient?.defaults?.baseURL;
        
        // Fallback if apiClient is not set up as expected
        if (!apiBase) {
             apiBase = window.location.origin;
        }

        // Handle relative URLs (e.g. "/api")
        if (apiBase.startsWith('/')) {
            apiBase = window.location.origin + apiBase;
        }

        // Strip trailing slash
        if (apiBase.endsWith('/')) apiBase = apiBase.slice(0, -1);
        
        const wsProtocol = apiBase.startsWith('https') ? 'wss:' : 'ws:';
        // Remove protocol to get host
        const wsHost = apiBase.replace(/^https?:\/\//, '');
        
        const wsUrl = `${wsProtocol}//${wsHost}/api/apps/${appIdRef.current}/functions/openaiRealtimeSignaling`;

        addLog(`Connecting to: ${wsUrl}`);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            addLog("WebSocket Connected to Proxy");
            setStatus("authenticating");
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                // System handshake
                if (data.type === "system" && data.status === "connected") {
                    addLog("✅ OpenAI Upstream Connected!");
                    setStatus("live");
                    // Send initial config
                    const config = {
                        type: "session.update",
                        session: {
                            modalities: ["text", "audio"],
                            instructions: systemPrompt || "You are a helpful, witty, and professional AI assistant named Sarah. Speak naturally.",
                            voice: "shimmer", // 'alloy', 'echo', 'shimmer'
                            input_audio_format: "pcm16",
                            output_audio_format: "pcm16",
                            input_audio_transcription: { model: "whisper-1" }
                        }
                    };
                    ws.send(JSON.stringify(config));
                    addLog("Session Config Sent");
                    
                    // Start Mic
                    startAudioCapture();
                    return;
                }

                // Error
                if (data.type === "error") {
                    addLog(`❌ OpenAI Error: ${data.error.message}`);
                    setError(data.error.message);
                    return;
                }

                // Audio Output (Response)
                if (data.type === "response.audio.delta" && data.delta) {
                    if (!isSpeaking) addLog("🔊 Receiving Audio...");
                    setIsSpeaking(true);
                    queueAudio(data.delta);
                }

                if (data.type === "response.done") {
                    setIsSpeaking(false);
                    addLog("Response Done");
                }
                
                // Handling Interruption (User spoke, server truncated response)
                if (data.type === "input_audio_buffer.speech_started") {
                     addLog("User interrupted");
                     clearAudioQueue();
                }

            } catch (err) {
                addLog(`Parse Error: ${err.message}`);
            }
        };

        ws.onclose = (e) => {
            addLog(`WS Closed: ${e.code} ${e.reason || "No reason provided"}`);
            setStatus("idle");
            stopAudioCapture();
            
            // If we received a specific error message before close, keep it.
            // Otherwise, show the close code.
            setError(prev => {
                if (prev && prev !== "Connection error") return prev;
                if (e.code === 1000) return "";
                return `Connection closed (${e.code}): ${e.reason || "Unknown reason"}`;
            });
        };

        ws.onerror = (e) => {
            addLog("WS Error Event Triggered");
            setError("Connection error");
        };

    } catch (e) {
        console.error("Connection Error:", e);
        setError(`Connection failed: ${e.message}`);
        setStatus("idle");
    }
  };

  const startAudioCapture = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 24000, channelCount: 1 } });
        streamRef.current = stream;

        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        audioContextRef.current = audioContext;

        await audioContext.audioWorklet.addModule("data:text/javascript;base64," + btoa(`
          class AudioProcessor extends AudioWorkletProcessor {
              process(inputs, outputs, parameters) {
                  const input = inputs[0];
                  if (input.length > 0) {
                      const channel = input[0];
                      this.port.postMessage(channel);
                  }
                  return true;
              }
          }
          registerProcessor('audio-processor', AudioProcessor);
        `));

        const source = audioContext.createMediaStreamSource(stream);
        const processor = new AudioWorkletNode(audioContext, 'audio-processor');

        processor.port.onmessage = (e) => {
            if (wsRef.current?.readyState === WebSocket.OPEN && micEnabled) {
                // Convert Float32 to Int16 PCM Base64
                const float32 = e.data;
                const int16 = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                    int16[i] = Math.max(-1, Math.min(1, float32[i])) * 0x7FFF;
                }
                
                // Convert to binary string efficiently
                let binary = '';
                const bytes = new Uint8Array(int16.buffer);
                const len = bytes.byteLength;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64Audio = btoa(binary);

                wsRef.current.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: base64Audio
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

    } catch (e) {
        console.error("Mic Error:", e);
        setError("Microphone access failed: " + e.message);
    }
  };

  const stopAudioCapture = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioContextRef.current?.close();
    processorRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
  };

  const stopSession = () => {
    if (wsRef.current) wsRef.current.close();
    stopAudioCapture();
    setStatus("idle");
    setIsSpeaking(false);
  };

  // Audio Playback
  const queueAudio = (base64Data) => {
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Int16Array(len / 2);
    const view = new DataView(new ArrayBuffer(len));
    for (let i = 0; i < len; i++) {
        view.setUint8(i, binaryString.charCodeAt(i));
    }
    for (let i = 0; i < len / 2; i++) {
        bytes[i] = view.getInt16(i * 2, true);
    }
    
    audioQueueRef.current.push(bytes);
    if (!isPlayingRef.current) {
        playNextChunk();
    }
  };

  const playNextChunk = () => {
    if (!audioContextRef.current || audioQueueRef.current.length === 0) {
        isPlayingRef.current = false;
        return;
    }
    
    isPlayingRef.current = true;
    const audioData = audioQueueRef.current.shift();
    
    const float32Data = new Float32Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
        float32Data[i] = audioData[i] / 32768; 
    }

    const buffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = playNextChunk;
    source.start();
  };

  const clearAudioQueue = () => {
      audioQueueRef.current = [];
      // Note: We can't easily stop the currently playing buffer node in this simple queue implementation
      // without tracking the current source node. 
      // Ideally, we'd disconnect the current source.
      isPlayingRef.current = false;
  };

  return (
    <Card className="max-w-xl mx-auto border-0 shadow-none bg-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-white">
          <Sparkles className="w-5 h-5 text-yellow-300" /> Sarah Live (GPT-4o)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert className="bg-red-500/20 border-red-500 text-white">
            <AlertDescription className="font-semibold">❌ {error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col items-center justify-center py-8 gap-6">
            {/* Visualizer Circle */}
            <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
                status === 'live' 
                    ? isSpeaking 
                        ? "bg-purple-500 shadow-[0_0_40px_rgba(168,85,247,0.6)] scale-110" 
                        : "bg-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.4)]"
                    : "bg-gray-700"
            }`}>
                {status === 'connecting' || status === 'authenticating' ? (
                    <Activity className="w-12 h-12 text-white animate-spin" />
                ) : status === 'live' ? (
                    <Mic className={`w-12 h-12 text-white ${isSpeaking ? 'animate-pulse' : ''}`} />
                ) : (
                    <MicOff className="w-12 h-12 text-gray-400" />
                )}
            </div>
            
            <div className="text-white font-medium text-center">
                {status === 'idle' && "Ready to Connect"}
                {status === 'connecting' && "Connecting..."}
                {status === 'authenticating' && "Authenticating..."}
                {status === 'live' && (isSpeaking ? "Sarah is speaking..." : "Listening...")}
                {/* Debug Info for User */}
                {!appIdRef.current && status === 'idle' && <p className="text-xs text-gray-400 mt-1">Loading App Configuration...</p>}
            </div>

            <div className="flex gap-4 w-full">
                {status === 'idle' ? (
                    <Button onClick={startSession} className="w-full bg-white text-purple-900 hover:bg-gray-100 font-bold h-12 text-lg">
                        <Play className="w-5 h-5 mr-2" /> Start Call
                    </Button>
                ) : (
                    <>
                        <Button 
                            variant="outline" 
                            onClick={() => setMicEnabled(!micEnabled)} 
                            className="flex-1 bg-white/10 text-white border-white/20 hover:bg-white/20"
                        >
                            {micEnabled ? <Mic className="w-5 h-5 mr-2" /> : <MicOff className="w-5 h-5 mr-2" />}
                            {micEnabled ? "Mute" : "Unmuted"}
                        </Button>
                        <Button 
                            variant="destructive" 
                            onClick={stopSession} 
                            className="flex-1 bg-red-500 hover:bg-red-600"
                        >
                            <Square className="w-5 h-5 mr-2" /> End Call
                        </Button>
                    </>
                )}
            </div>

            {/* Debug Tools */}
            <div className="flex gap-2 w-full mt-4 mb-2">
                 <Button variant="outline" size="sm" onClick={async () => {
                      if (!appIdRef.current) { alert("❌ App ID not loaded yet"); return; }
                      
                      // 1. Determine URL
                      let apiBase = base44.apiClient?.defaults?.baseURL;
                      if (!apiBase || apiBase.startsWith('/')) apiBase = window.location.origin;
                      if (apiBase.endsWith('/')) apiBase = apiBase.slice(0, -1);

                      const fnPath = `/api/apps/${appIdRef.current}/functions/openaiRealtimeSignaling`;
                      const diagnoseUrl = `${apiBase}${fnPath}?mode=diagnose`;

                      addLog("Running API Key Diagnosis...");

                      try {
                          const resp = await fetch(diagnoseUrl);
                          const data = await resp.json();
                          console.log("Diagnosis Result:", data);

                          let msg = `Diagnostic Results:\n\n`;
                          msg += `🔑 Key Source: ${data.key_source || "Unknown"}\n`;
                          msg += `📡 REST API: ${data.http_status === 200 ? "✅ OK" : "❌ FAILED (" + data.http_status + ")"}\n`;
                          
                          if (data.error_details) {
                             msg += `   ⚠️ Error: ${data.error_details.error?.message || JSON.stringify(data.error_details)}\n`;
                          }

                          msg += `   - Target Model Available: ${data.target_model_available ? "Yes" : "No"}\n`;
                          
                          if (data.http_status !== 200) {
                              msg += `\n❌ KEY ISSUE: The OpenAI API Key is likely invalid or expired.`;
                          } else if (!data.target_model_available) {
                              msg += `\n⚠️ MODEL ISSUE: Key is valid, but 'gpt-4o-realtime-preview' model is not found. Check project permissions.`;
                          } else {
                              msg += `\n✅ SUCCESS: API Key is valid and can access the model.`;
                          }

                          alert(msg);
                      } catch (e) {
                          console.error(e);
                          alert("Diagnosis Failed: " + e.message);
                      }
                  }} className="text-xs h-6 bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 flex-1">
                      🔍 Diagnose API Key
                  </Button>
            </div>

            {/* Debug Logs Panel */}
            <div className="w-full">
                <div className="bg-black/40 rounded-lg border border-white/10 overflow-hidden">
                    <div className="px-3 py-2 bg-black/60 border-b border-white/10 flex justify-between items-center">
                        <span className="text-xs font-mono text-gray-400">Connection Logs</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${status === 'live' ? 'bg-green-500/20 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                            {status.toUpperCase()}
                        </span>
                    </div>
                    <div className="p-3 h-32 overflow-y-auto font-mono text-xs space-y-1">
                        {debugLogs.length === 0 ? (
                            <div className="text-gray-600 italic">Ready to connect...</div>
                        ) : (
                            debugLogs.map((log, i) => (
                                <div key={i} className={`border-b border-white/5 pb-0.5 last:border-0 ${
                                    log.includes('Error') ? 'text-red-400' : 
                                    log.includes('Connected') ? 'text-green-400' : 
                                    'text-gray-300'
                                }`}>
                                    {log}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
            </div>
            </CardContent>
            </Card>
  );
}