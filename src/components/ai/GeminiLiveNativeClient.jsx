import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { base44 } from "@/api/base44Client";
import { Mic, MicOff, Play, Square, Volume2, Sparkles, Wrench } from "lucide-react";

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

const NUM_BARS = 24;

function AudioVolumeMeter({ analyserRef, isActive }) {
  const canvasRef = React.useRef(null);
  const animFrameRef = React.useRef(null);
  const [peakLevel, setPeakLevel] = React.useState(0);
  const [audioDetected, setAudioDetected] = React.useState(false);

  React.useEffect(() => {
    if (!isActive) {
      setPeakLevel(0);
      setAudioDetected(false);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const draw = () => {
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      const normalizedLevel = Math.min(avg / 128, 1);

      setPeakLevel(prev => Math.max(normalizedLevel, prev * 0.95));
      setAudioDetected(normalizedLevel > 0.01);

      ctx.clearRect(0, 0, width, height);

      const barWidth = (width / NUM_BARS) * 0.7;
      const gap = (width / NUM_BARS) * 0.3;
      const step = Math.floor(dataArray.length / NUM_BARS);

      for (let i = 0; i < NUM_BARS; i++) {
        let barVal = 0;
        for (let j = 0; j < step; j++) {
          barVal += dataArray[i * step + j] || 0;
        }
        barVal = barVal / step / 255;

        const barHeight = Math.max(2, barVal * height * 0.9);
        const x = i * (barWidth + gap) + gap / 2;
        const y = height - barHeight;

        const hue = 200 + barVal * 120;
        const lightness = 45 + barVal * 15;
        ctx.fillStyle = `hsl(${hue}, 80%, ${lightness}%)`;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barWidth, barHeight, 2);
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isActive, analyserRef]);

  if (!isActive) return null;

  return (
    <div className="w-full space-y-1" data-testid="audio-volume-meter">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Volume2 className="w-3 h-3" />
          Audio Output
        </span>
        <span>
          {audioDetected ? (
            <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4 bg-green-600 dark:bg-green-500">
              Signal Detected
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              No Signal
            </Badge>
          )}
        </span>
      </div>
      <div className="rounded-md border bg-black/5 dark:bg-white/5 p-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          width={360}
          height={48}
          className="w-full h-12"
          data-testid="canvas-audio-waveform"
        />
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${peakLevel * 100}%`,
              backgroundColor: peakLevel > 0.6 ? '#22c55e' : peakLevel > 0.2 ? '#3b82f6' : '#94a3b8',
            }}
            data-testid="bar-peak-level"
          />
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right" data-testid="text-peak-db">
          {peakLevel > 0.01 ? `${Math.round(peakLevel * 100)}%` : '—'}
        </span>
      </div>
    </div>
  );
}

export default function GeminiLiveNativeClient({ companyId, onFallbackToTTS }) {
  const [status, setStatus] = React.useState("idle");
  const [error, setError] = React.useState("");
  const [selectedVoice, setSelectedVoice] = React.useState(() => {
    try { return localStorage.getItem(`lexi_voice_${companyId}`) || "Kore"; } catch { return "Kore"; }
  });
  const [micEnabled, setMicEnabled] = React.useState(true);
  const [isSpeaking, setIsSpeaking] = React.useState(false);
  const [user, setUser] = React.useState(null);
  const [transcript, setTranscript] = React.useState([]);
  const [toolCalls, setToolCalls] = React.useState([]);
  const [audioChunksReceived, setAudioChunksReceived] = React.useState(0);
  const [audioContextState, setAudioContextState] = React.useState("none");
  const [ttsFallbackActive, setTtsFallbackActive] = React.useState(false);

  const wsRef = React.useRef(null);
  const audioContextRef = React.useRef(null);
  const audioQueueRef = React.useRef([]);
  const isPlayingRef = React.useRef(false);
  const currentSourceRef = React.useRef(null);
  const localStreamRef = React.useRef(null);
  const processorRef = React.useRef(null);
  const micEnabledRef = React.useRef(true);
  const isSpeakingRef = React.useRef(false);
  const analyserRef = React.useRef(null);
  const gainNodeRef = React.useRef(null);
  const hasEverReceivedAudioRef = React.useRef(false);
  const ttsFallbackTimerRef = React.useRef(null);
  const assistantTextBufferRef = React.useRef("");
  const ttsTurnTimerRef = React.useRef(null);
  const lastInterruptTimeRef = React.useRef(0);
  const allowInterruptFramesRef = React.useRef(0);
  const consecutiveLoudFramesRef = React.useRef(0);
  const echoGuardUntilRef = React.useRef(0);
  const hasLoggedPlaybackRateRef = React.useRef(false);
  const nextPlayTimeRef = React.useRef(0);

  React.useEffect(() => {
    micEnabledRef.current = micEnabled;
  }, [micEnabled]);

  React.useEffect(() => {
    try { localStorage.setItem(`lexi_voice_${companyId}`, selectedVoice); } catch {}
  }, [selectedVoice, companyId]);

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
      if (processorRef.current) {
        try {
          processorRef.current.processor.disconnect();
          processorRef.current.audioContext.close();
        } catch (e) {}
        processorRef.current = null;
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch (e) {}
        audioContextRef.current = null;
      }
    };
  }, []);

  const stopAllAudio = (fromUserInterrupt = false) => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
        currentSourceRef.current.disconnect();
      } catch (e) {}
      currentSourceRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    nextPlayTimeRef.current = 0;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    echoGuardUntilRef.current = Date.now() + 600;
    consecutiveLoudFramesRef.current = 0;
    if (fromUserInterrupt && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'user_interrupted' }));
    }
  };

  const speakWithTTS = (text) => {
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v =>
      /samantha|victoria|karen|zira|female|fiona/i.test(v.name)
    );
    if (femaleVoice) utterance.voice = femaleVoice;
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    utterance.onend = () => {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    };
    utterance.onerror = () => {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    };
    console.log("[Lexi Native] TTS fallback speaking:", text.substring(0, 60));
    window.speechSynthesis.speak(utterance);
  };

  const ensureAudioContextRunning = async () => {
    const ctx = audioContextRef.current;
    if (!ctx) return false;

    if (ctx.state === 'running') return true;

    console.log("[Lexi Native] AudioContext state:", ctx.state, "— attempting resume...");
    try {
      await ctx.resume();
      console.log("[Lexi Native] AudioContext resumed successfully, state:", ctx.state);
      setAudioContextState(ctx.state);
      return ctx.state === 'running';
    } catch (e) {
      console.error("[Lexi Native] AudioContext resume FAILED:", e);
      setAudioContextState('failed');
      return false;
    }
  };

  // Fully synchronous scheduler — no await after the lock is set so there is
  // zero microtask delay between onended and the next source.start(). The only
  // async path is the very first call when the AudioContext may still be
  // suspended (user hasn't interacted yet); after that every call is sync.
  const playNextChunk = () => {
    if (!audioContextRef.current || audioQueueRef.current.length === 0 || isPlayingRef.current) {
      if (audioQueueRef.current.length === 0) {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
      }
      return;
    }

    // If the AudioContext is suspended (hasn't been unlocked yet), resume it
    // asynchronously and retry — this only happens on the very first call.
    if (audioContextRef.current.state !== 'running') {
      audioContextRef.current.resume()
        .then(() => playNextChunk())
        .catch(e => console.error('[Lexi Native] AudioContext resume failed:', e));
      return;
    }

    // From here on everything is synchronous — no microtask gaps at all.
    isPlayingRef.current = true;
    isSpeakingRef.current = true;
    setIsSpeaking(true);

    const audioData = audioQueueRef.current.shift();
    if (!audioData) {
      isPlayingRef.current = false;
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    try {
      const GEMINI_RATE = 24000;
      const ctxRate = audioContextRef.current.sampleRate;
      let float32Data;

      if (Math.abs(ctxRate - GEMINI_RATE) < 1) {
        float32Data = new Float32Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) float32Data[i] = audioData[i] / 32768.0;
      } else {
        // Catmull-Rom cubic interpolation — synchronous, zero async gaps.
        // Smooth curve through 4 surrounding samples avoids linear's harshness.
        const ratio = ctxRate / GEMINI_RATE;
        const outputLen = Math.round(audioData.length * ratio);
        const N = audioData.length;
        float32Data = new Float32Array(outputLen);
        for (let i = 0; i < outputLen; i++) {
          const srcPos = i / ratio;
          const n1 = Math.floor(srcPos);
          const t = srcPos - n1;
          const p0 = audioData[n1 > 0 ? n1 - 1 : 0];
          const p1 = audioData[n1];
          const p2 = audioData[n1 + 1 < N ? n1 + 1 : N - 1];
          const p3 = audioData[n1 + 2 < N ? n1 + 2 : N - 1];
          const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
          const b =        p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
          const c = -0.5 * p0                        + 0.5 * p2;
          const d =                          p1;
          const s = (((a * t + b) * t + c) * t + d) / 32768.0;
          float32Data[i] = s > 1 ? 1 : s < -1 ? -1 : s;
        }
        if (!hasLoggedPlaybackRateRef.current) {
          console.log(`[Lexi Native] Resampling ${GEMINI_RATE}Hz → ${ctxRate}Hz (ratio ${ratio.toFixed(4)}, cubic sync)`);
          hasLoggedPlaybackRateRef.current = true;
        }
      }

      const buffer = audioContextRef.current.createBuffer(1, float32Data.length, ctxRate);
      buffer.getChannelData(0).set(float32Data);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;

      if (!gainNodeRef.current || !analyserRef.current) {
        const gain = audioContextRef.current.createGain();
        gain.gain.value = 1.0;
        const analyser = audioContextRef.current.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        gain.connect(analyser);
        analyser.connect(audioContextRef.current.destination);
        gainNodeRef.current = gain;
        analyserRef.current = analyser;
        console.log("[Lexi Native] Audio pipeline created: source → gain(1.0) → analyser → destination");
      }

      source.connect(gainNodeRef.current);

      // Schedule sample-accurately so consecutive chunks play back-to-back
      // with zero gap. nextPlayTimeRef tracks the AudioContext clock position
      // where the next chunk should begin. If it has fallen behind currentTime
      // (first chunk of a turn, or after a pause), snap to currentTime.
      const ctxNow = audioContextRef.current.currentTime;
      const startAt = nextPlayTimeRef.current > ctxNow ? nextPlayTimeRef.current : ctxNow;
      nextPlayTimeRef.current = startAt + float32Data.length / audioContextRef.current.sampleRate;

      currentSourceRef.current = source;
      source.onended = () => {
        currentSourceRef.current = null;
        isPlayingRef.current = false;
        if (audioQueueRef.current.length === 0) {
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'playback_done' }));
          }
        }
        playNextChunk();
      };
      source.start(startAt);
    } catch (e) {
      console.error("[Lexi Native] Playback error:", e);
      currentSourceRef.current = null;
      isPlayingRef.current = false;
      if (audioQueueRef.current.length === 0) {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'playback_done' }));
        }
      }
      playNextChunk();
    }
  };

  const startAudioCapture = async (ws) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: 16000 },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });
    localStreamRef.current = stream;

    const audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);

    const actualSampleRate = audioContext.sampleRate;
    const needsDownsampling = actualSampleRate !== 16000;
    const downsampleRatio = actualSampleRate / 16000;
    if (needsDownsampling) {
      console.log(`[Lexi Native] Browser sample rate ${actualSampleRate}Hz (requested 16kHz) — downsampling enabled`);
    } else {
      console.log(`[Lexi Native] AudioContext sample rate: ${actualSampleRate}Hz (native)`);
    }

    let useWorklet = false;
    try {
      // The worklet has access to the global `sampleRate` variable which reflects the
      // AudioContext's actual sample rate (may differ from the requested 16kHz).
      // Downsampling is done INSIDE the worklet so only 16kHz float32 data is
      // transferred to the main thread — reducing IPC overhead and ensuring the
      // main thread never sees mismatched sample-rate audio.
      const workletCode = `
        class MicProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            // sampleRate is a global in AudioWorklet scope = AudioContext.sampleRate
            this._ratio = sampleRate / 16000;
            this._needsDownsample = Math.abs(this._ratio - 1.0) > 0.001;
            // Ring-buffer of native samples; _phase is the fractional read position
            // carried ACROSS chunk boundaries so there is zero resampling drift.
            this._buf = new Float32Array(0);
            this._phase = 0.0; // sub-sample offset into _buf (always < 1.0)
            this._outChunk = 128; // emit in 128-sample bursts (8 ms at 16 kHz)
          }

          process(inputs) {
            const ch = inputs[0]?.[0];
            if (!ch || ch.length === 0) return true;

            if (!this._needsDownsample) {
              // Native rate is already 16kHz — copy to avoid detached-buffer issues
              const out = new Float32Array(ch.length);
              out.set(ch);
              this.port.postMessage(out);
              return true;
            }

            // Append incoming native frames to the accumulation buffer
            const merged = new Float32Array(this._buf.length + ch.length);
            merged.set(this._buf);
            merged.set(ch, this._buf.length);
            this._buf = merged;

            // Emit output chunks while buffer holds enough native samples.
            // _phase is the fractional position of the NEXT output sample; it is
            // preserved across iterations so phase is continuous (no chunk-edge drift).
            while (true) {
              // Native samples required: position of last output sample + 1 guard sample
              const need = Math.ceil(this._phase + (this._outChunk - 1) * this._ratio) + 2;
              if (this._buf.length < need) break;

              const out = new Float32Array(this._outChunk);
              for (let i = 0; i < this._outChunk; i++) {
                const src = this._phase + i * this._ratio;
                const lo = Math.floor(src);
                const hi = Math.min(lo + 1, this._buf.length - 1);
                const t = src - lo;
                out[i] = this._buf[lo] * (1 - t) + this._buf[hi] * t;
              }

              // Advance phase and drop fully-consumed native samples
              this._phase += this._outChunk * this._ratio;
              const consumed = Math.floor(this._phase);
              this._phase -= consumed; // keep only the fractional carry
              this._buf = this._buf.slice(consumed);

              this.port.postMessage(out);
            }
            return true;
          }
        }
        registerProcessor('mic-processor', MicProcessor);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const workletNode = new AudioWorkletNode(audioContext, 'mic-processor');
      // pcmBuffer now accumulates 16kHz float32 frames (already downsampled by worklet)
      let pcmBuffer = new Float32Array(0);
      const CHUNK_SIZE = 1280; // 16kHz samples → ~80ms chunks (matches original ~85ms latency)
      const SILENCE_THRESHOLD = 0.04;
      const INTERRUPT_COOLDOWN = 800;
      const CONSECUTIVE_FRAMES_NEEDED = 3;

      let audioSendCount = 0;
      let lastSpeakingTime = 0;
      const ECHO_TAIL_MS = 400;

      workletNode.port.onmessage = (e) => {
        if (!micEnabledRef.current || ws.readyState !== WebSocket.OPEN) return;

        // Data arriving here is already 16kHz float32 (downsampled inside worklet)
        const newData = e.data;
        const merged = new Float32Array(pcmBuffer.length + newData.length);
        merged.set(pcmBuffer);
        merged.set(newData, pcmBuffer.length);
        pcmBuffer = merged;

        while (pcmBuffer.length >= CHUNK_SIZE) {
          const chunk = pcmBuffer.slice(0, CHUNK_SIZE);
          pcmBuffer = pcmBuffer.slice(CHUNK_SIZE);

          const now = Date.now();
          const isLexiSpeaking = isSpeakingRef.current || isPlayingRef.current || audioQueueRef.current.length > 0;

          if (isLexiSpeaking) {
            lastSpeakingTime = now;
          }

          const inEchoTail = !isLexiSpeaking && (now - lastSpeakingTime < ECHO_TAIL_MS);
          const shouldMute = isLexiSpeaking || inEchoTail;

          if (isLexiSpeaking) {
            let sum = 0;
            for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
            const rms = Math.sqrt(sum / chunk.length);

            if (rms > SILENCE_THRESHOLD) {
              consecutiveLoudFramesRef.current++;
            } else {
              consecutiveLoudFramesRef.current = 0;
            }

            if (consecutiveLoudFramesRef.current >= CONSECUTIVE_FRAMES_NEEDED) {
              if (now - lastInterruptTimeRef.current > INTERRUPT_COOLDOWN) {
                stopAllAudio(true);
                lastInterruptTimeRef.current = now;
                lastSpeakingTime = 0;
                console.log('[Lexi Native] User interrupting - stopping playback (RMS:', rms.toFixed(4), ')');
              }
            }
          }

          // Hard gate: skip this chunk entirely when Lexi is speaking or in echo tail.
          // Gemini's own VAD handles the resulting silence naturally.
          if (shouldMute) {
            continue;
          }

          // Convert 16kHz float32 → Int16 PCM (safe loop — no spread-operator stack overflow)
          const int16 = new Int16Array(chunk.length);
          for (let i = 0; i < chunk.length; i++) {
            const s = Math.max(-1, Math.min(1, chunk[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          // Safe loop-based base64 (avoids btoa(String.fromCharCode(...bigArray)) stack overflow)
          const uint8 = new Uint8Array(int16.buffer);
          let binary = '';
          for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i]);
          const base64 = btoa(binary);
          ws.send(JSON.stringify({ type: 'audio', data: base64 }));
          audioSendCount++;
        }
      };

      source.connect(workletNode);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);
      processorRef.current = { processor: workletNode, audioContext };
      useWorklet = true;
      console.log("[Lexi Native] Using AudioWorklet (mobile-optimized)");
    } catch (workletErr) {
      console.warn("[Lexi Native] AudioWorklet not supported, falling back to ScriptProcessor:", workletErr);
    }

    if (!useWorklet) {
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = { processor, audioContext };
      let lastSpeakingTimeFallback = 0;

      processor.onaudioprocess = (e) => {
        if (!micEnabledRef.current || ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const now = Date.now();
        const isLexiSpeaking = isSpeakingRef.current || isPlayingRef.current || audioQueueRef.current.length > 0;

        if (isLexiSpeaking) {
          lastSpeakingTimeFallback = now;

          let sum = 0;
          for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
          const rms = Math.sqrt(sum / inputData.length);

          if (rms > 0.04) {
            consecutiveLoudFramesRef.current++;
          } else {
            consecutiveLoudFramesRef.current = 0;
          }

          if (consecutiveLoudFramesRef.current >= 3) {
            if (now - lastInterruptTimeRef.current > 800) {
              stopAllAudio(true);
              lastInterruptTimeRef.current = now;
              lastSpeakingTimeFallback = 0;
              console.log('[Lexi Native] User interrupting - stopping playback (RMS:', rms.toFixed(4), ')');
            }
          }
        }

        const inEchoTail = !isLexiSpeaking && (now - lastSpeakingTimeFallback < 400);
        if (isLexiSpeaking || inEchoTail) {
          return;
        }

        const outputLength = needsDownsampling
          ? Math.round(inputData.length / downsampleRatio)
          : inputData.length;
        const int16 = new Int16Array(outputLength);
        if (needsDownsampling) {
          for (let i = 0; i < outputLength; i++) {
            const srcIdx = i * downsampleRatio;
            const lo = Math.floor(srcIdx);
            const hi = Math.min(lo + 1, inputData.length - 1);
            const t = srcIdx - lo;
            const sample = inputData[lo] * (1 - t) + inputData[hi] * t;
            const s = Math.max(-1, Math.min(1, sample));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
        } else {
          for (let i = 0; i < outputLength; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
        }
        const uint8 = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i]);
        const base64 = btoa(binary);
        ws.send(JSON.stringify({ type: 'audio', data: base64 }));
      };

      source.connect(processor);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      console.log("[Lexi Native] Using ScriptProcessor (fallback)");
    }
  };

  const startSession = async () => {
    setError("");
    setStatus("connecting");
    setTranscript([]);
    setToolCalls([]);
    setAudioChunksReceived(0);
    setAudioContextState("creating");

    // Let the browser create the AudioContext at its native rate (44100 or 48000Hz).
    // playNextChunk resamples Gemini's 24kHz output to ctxRate, so forcing 24kHz here
    // is unnecessary and causes browsers to silently override it anyway.
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = audioContext;

    audioContext.onstatechange = () => {
      console.log("[Lexi Native] AudioContext state changed:", audioContext.state);
      setAudioContextState(audioContext.state);
    };

    console.log("[Lexi Native] AudioContext created at", audioContext.sampleRate, "Hz, state:", audioContext.state);
    await audioContext.resume();
    console.log("[Lexi Native] AudioContext after resume:", audioContext.state);
    setAudioContextState(audioContext.state);

    try {
      const unlockBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.1, audioContext.sampleRate);
      const data = unlockBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.sin(2 * Math.PI * 440 * i / audioContext.sampleRate) * 0.001;
      }
      const unlockSource = audioContext.createBufferSource();
      unlockSource.buffer = unlockBuffer;
      unlockSource.connect(audioContext.destination);
      unlockSource.start(0);
      console.log("[Lexi Native] Unlock tone playing (440Hz, 100ms)");
      await new Promise(resolve => setTimeout(resolve, 150));
      console.log("[Lexi Native] Unlock tone completed, AudioContext state:", audioContext.state);
    } catch (e) {
      console.error("[Lexi Native] Unlock tone failed:", e);
    }

    if (audioContext.state !== 'running') {
      console.error("[Lexi Native] CRITICAL: AudioContext still not running after unlock tone! State:", audioContext.state);
      setError("Audio could not be activated. Please tap the screen and try again.");
      setStatus("idle");
      try { audioContext.close(); } catch (e) {}
      audioContextRef.current = null;
      return;
    }

    const gain = audioContext.createGain();
    gain.gain.value = 1.0;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    gain.connect(analyser);
    analyser.connect(audioContext.destination);
    gainNodeRef.current = gain;
    analyserRef.current = analyser;
    console.log("[Lexi Native] Audio pipeline pre-created: source → gain(1.5) → analyser → destination");

    try {
      const currentUser = user || await base44.auth.me();
      if (!currentUser) {
        setError("Please log in first");
        setStatus("idle");
        return;
      }

      let resolvedCompanyId = companyId;
      const myStaffProfiles = await base44.entities.StaffProfile.filter({ user_email: currentUser.email });
      if (!resolvedCompanyId) {
        const ownedCompanies = await base44.entities.Company.filter({ created_by: currentUser.email });
        resolvedCompanyId = ownedCompanies?.[0]?.id || myStaffProfiles?.[0]?.company_id;
      }
      const myStaffProfile = myStaffProfiles?.find(sp => sp.company_id === resolvedCompanyId) || myStaffProfiles?.[0];
      const resolvedUserName = myStaffProfile?.full_name
        || (currentUser.first_name && currentUser.last_name ? `${currentUser.first_name} ${currentUser.last_name}`.trim() : null)
        || currentUser.full_name
        || currentUser.email;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/lexi-native?companyId=${encodeURIComponent(resolvedCompanyId || '')}&userEmail=${encodeURIComponent(currentUser.email)}&userName=${encodeURIComponent(resolvedUserName)}&voice=${encodeURIComponent(selectedVoice)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        setStatus("connected");
        try {
          await startAudioCapture(ws);
          setMicEnabled(true);
        } catch (err) {
          setError(`Microphone error: ${err.message}`);
          ws.close();
          return;
        }
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'status') {
            if (msg.status === 'ready') {
              setStatus("live");
              setError("");
            } else if (msg.status === 'disconnected') {
              setStatus("idle");
            }
          }

          if (msg.type === 'error') {
            setError(msg.message);
          }

          if (msg.type === 'transcript') {
            setTranscript(prev => [...prev, { role: msg.role, text: msg.text, time: new Date().toLocaleTimeString() }]);

            if (msg.role === 'assistant' && msg.text) {
              assistantTextBufferRef.current += (assistantTextBufferRef.current ? ' ' : '') + msg.text;

              if (ttsTurnTimerRef.current) clearTimeout(ttsTurnTimerRef.current);
              ttsTurnTimerRef.current = setTimeout(() => {
                if (!hasEverReceivedAudioRef.current && assistantTextBufferRef.current) {
                  console.log("[Lexi Native] No audio from Gemini — activating TTS fallback");
                  setTtsFallbackActive(true);
                  speakWithTTS(assistantTextBufferRef.current);
                  assistantTextBufferRef.current = "";
                }
              }, 1500);
            }
          }

          if (msg.type === 'audio') {
            hasEverReceivedAudioRef.current = true;
            setAudioChunksReceived(prev => prev + 1);

            if (ttsTurnTimerRef.current) {
              clearTimeout(ttsTurnTimerRef.current);
              ttsTurnTimerRef.current = null;
            }
            assistantTextBufferRef.current = "";

            if (ttsFallbackActive) {
              setTtsFallbackActive(false);
              if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            }

            await ensureAudioContextRunning();

            const binaryString = atob(msg.data);
            const len = binaryString.length;
            const bytes = new Int16Array(len / 2);
            const view = new DataView(new ArrayBuffer(len));
            for (let i = 0; i < len; i++) {
              view.setUint8(i, binaryString.charCodeAt(i));
            }
            for (let i = 0; i < len / 2; i++) {
              bytes[i] = view.getInt16(i * 2, true);
            }

            if (!hasEverReceivedAudioRef.current || audioChunksReceived === 0) {
              let maxSample = 0;
              for (let i = 0; i < Math.min(bytes.length, 100); i++) {
                maxSample = Math.max(maxSample, Math.abs(bytes[i]));
              }
              console.log("[Lexi Native] First audio chunk received — samples:", bytes.length, "peak:", maxSample, "bytes:", len);
            }

            audioQueueRef.current.push(bytes);
            playNextChunk();
          }

          if (msg.type === 'turn_complete') {
            if (!hasEverReceivedAudioRef.current && assistantTextBufferRef.current) {
              console.log("[Lexi Native] Turn complete with no audio — TTS fallback for buffered text");
              setTtsFallbackActive(true);
              speakWithTTS(assistantTextBufferRef.current);
              assistantTextBufferRef.current = "";
            } else {
              assistantTextBufferRef.current = "";
            }
          }

          if (msg.type === 'interrupted') {
            stopAllAudio();
            assistantTextBufferRef.current = "";
            if (ttsTurnTimerRef.current) {
              clearTimeout(ttsTurnTimerRef.current);
              ttsTurnTimerRef.current = null;
            }
          }

          if (msg.type === 'tool_call') {
            setToolCalls(prev => [...prev, { name: msg.name, time: new Date().toLocaleTimeString() }]);
          }
        } catch (err) {
          console.error("[Lexi Native] WS message error:", err);
        }
      };

      ws.onclose = (e) => {
        console.log("[Lexi Native] WS Closed", e.code);
        cleanupSession();
        setStatus("idle");
      };

      ws.onerror = (err) => {
        console.error("[Lexi Native] WS Error:", err);
        setError("Connection error. Please try again.");
        cleanupSession();
        setStatus("idle");
      };

    } catch (err) {
      console.error("[Lexi Native] Start error:", err);
      setError(err.message);
      setStatus("idle");
    }
  };

  const cleanupSession = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (processorRef.current) {
      try {
        processorRef.current.processor.disconnect();
        processorRef.current.audioContext.close();
      } catch (e) {}
      processorRef.current = null;
    }
    stopAllAudio();
    if (gainNodeRef.current) {
      try { gainNodeRef.current.disconnect(); } catch (e) {}
      gainNodeRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch (e) {}
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }
    setAudioContextState("none");
    setAudioChunksReceived(0);
    hasEverReceivedAudioRef.current = false;
    nextPlayTimeRef.current = 0;
    setTtsFallbackActive(false);
    assistantTextBufferRef.current = "";
    if (ttsFallbackTimerRef.current) { clearTimeout(ttsFallbackTimerRef.current); ttsFallbackTimerRef.current = null; }
    if (ttsTurnTimerRef.current) { clearTimeout(ttsTurnTimerRef.current); ttsTurnTimerRef.current = null; }
  };

  const stopSession = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanupSession();
    setStatus("idle");
  };

  const toggleMic = () => {
    setMicEnabled(prev => !prev);
  };

  const isLive = status === "live";
  const isConnecting = status === "connecting" || status === "connected";

  return (
    <Card data-testid="card-lexi-native-voice">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-base">Native Voice (STS)</CardTitle>
          <Badge variant={isLive ? "default" : "secondary"} data-testid="badge-native-status">
            {status === "idle" ? "Ready" : status === "live" ? "Live" : status === "connecting" || status === "connected" ? "Connecting..." : status}
          </Badge>
          {isSpeaking && <Badge variant="outline"><Volume2 className="w-3 h-3 mr-1" />{ttsFallbackActive ? 'Speaking (TTS)' : 'Speaking'}</Badge>}
          {isLive && !isSpeaking && micEnabled && <Badge variant="outline"><Mic className="w-3 h-3 mr-1" />Listening</Badge>}
          {ttsFallbackActive && !isSpeaking && <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid="badge-tts-fallback">TTS Mode</Badge>}
        </div>
        {onFallbackToTTS && (
          <Button variant="ghost" size="sm" onClick={onFallbackToTTS} data-testid="button-switch-tts">
            Switch to TTS
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedVoice} onValueChange={setSelectedVoice} disabled={isLive || isConnecting}>
            <SelectTrigger className="w-[200px]" data-testid="select-native-voice">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GEMINI_VOICES.map(v => (
                <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!isLive && !isConnecting ? (
            <Button onClick={startSession} data-testid="button-start-native">
              <Play className="w-4 h-4 mr-1" />
              Start Native Voice
            </Button>
          ) : (
            <Button variant="destructive" onClick={stopSession} data-testid="button-stop-native">
              <Square className="w-4 h-4 mr-1" />
              Stop
            </Button>
          )}
        </div>

        {isLive && (
          <>
            <div className="flex flex-col items-center gap-3 py-4">
              <button
                onClick={toggleMic}
                data-testid="button-toggle-mic-large"
                className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 ${
                  isSpeaking
                    ? 'bg-blue-500/20 dark:bg-blue-400/20 border-2 border-blue-500/50 dark:border-blue-400/50'
                    : micEnabled
                      ? 'bg-primary/10 border-2 border-primary/50 active:scale-95'
                      : 'bg-muted border-2 border-muted-foreground/30'
                }`}
              >
                {isSpeaking ? (
                  <Volume2 className="w-8 h-8 text-blue-500 dark:text-blue-400 animate-pulse" />
                ) : micEnabled ? (
                  <Mic className="w-8 h-8 text-primary" />
                ) : (
                  <MicOff className="w-8 h-8 text-muted-foreground" />
                )}
              </button>
              <span className="text-sm text-muted-foreground" data-testid="text-mic-status">
                {isSpeaking ? "Lexi is speaking..." : micEnabled ? "Listening — speak naturally" : "Mic muted — tap to unmute"}
              </span>
              {isSpeaking && (
                <span className="text-xs text-muted-foreground" data-testid="text-auto-mute-notice">Mic auto-muted to prevent echo</span>
              )}
            </div>

            <AudioVolumeMeter
              analyserRef={analyserRef}
              isActive={isLive}
            />

            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span data-testid="text-audio-ctx-state">
                Audio: {audioContextState === 'running' ? 'Active' : audioContextState}
              </span>
              <span data-testid="text-chunks-received">
                Chunks received: {audioChunksReceived}
              </span>
            </div>
          </>
        )}

        {isLive && !isSpeaking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="w-4 h-4" />
            <span>Gemini 2.5 Flash Native Audio — speak naturally, Lexi hears and responds</span>
          </div>
        )}

        {transcript.length > 0 && (
          <div className="space-y-1">
            <div className="text-sm font-medium text-muted-foreground">Conversation</div>
            <ScrollArea className="h-[200px] rounded-md border p-3">
              {transcript.map((entry, i) => (
                <div key={i} className={`text-sm mb-2 ${entry.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <span className="text-xs text-muted-foreground mr-2">{entry.time}</span>
                  <Badge variant={entry.role === 'user' ? 'outline' : 'secondary'} className="no-default-active-elevate">
                    {entry.role === 'user' ? 'You' : 'Lexi'}
                  </Badge>
                  <p className="mt-0.5">{entry.text}</p>
                </div>
              ))}
            </ScrollArea>
          </div>
        )}

        {toolCalls.length > 0 && (
          <div className="space-y-1">
            <div className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Wrench className="w-3 h-3" /> CRM Actions
            </div>
            <div className="flex flex-wrap gap-1">
              {toolCalls.map((tc, i) => (
                <Badge key={i} variant="outline" className="text-xs no-default-active-elevate">
                  {tc.name} ({tc.time})
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
