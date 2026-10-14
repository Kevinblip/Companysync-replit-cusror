import React from "react";
import {
  acquireLexiVoiceOwner,
  isLexiVoiceOwner,
  releaseLexiVoiceOwner,
  startLexiVoiceOwnerHeartbeat,
  subscribeToLexiVoiceOwner,
} from "@/utils/lexiVoiceCoordinator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { base44 } from "@/api/base44Client";
import { Mic, MicOff, Square, Volume2, Sparkles, Wrench, Car, Settings2, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

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

function ActivityDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1" aria-hidden="true">
      {[0, 1, 2].map((delay) => (
        <span
          key={delay}
          className="w-1 h-1 rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${delay * 140}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  );
}

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

// Standard Listening mode warns after 45s without speech. The server closes
// the Gemini socket at 60s (lib/lexiSessionEnd.cjs). This backup is a few
// seconds later so a missed server message still releases the mic, and it
// does not close the billing session before the server does.
const LEXI_IDLE_WARN_MS = 45000;
const LEXI_IDLE_CLOSE_MS = 65000;
const LEXI_GOODBYE_DRAIN_MS = 4000;

// driveMode: force the continuous hands-free session on (used by the dedicated
// Drive Mode page). When set, the user cannot accidentally toggle it off and
// silence never ends the session.
export default function GeminiLiveNativeClient({ companyId, onFallbackToTTS, driveMode = false }) {
  const [status, setStatus] = React.useState("idle");
  const [voiceActivity, setVoiceActivity] = React.useState("idle");
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
  const [audioDevices, setAudioDevices] = React.useState([]);
  const [selectedMicId, setSelectedMicId] = React.useState("default");

  const wsRef = React.useRef(null);
  const audioContextRef = React.useRef(null);
  const audioQueueRef = React.useRef([]);
  const isPlayingRef = React.useRef(false);
  const currentSourceRef = React.useRef(null);
  const audioPlaybackGenerationRef = React.useRef(0);
  const bargeInPendingRef = React.useRef(false);
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
  const lastActivityRef = React.useRef(Date.now());
  const autoStopTimerRef = React.useRef(null);
  const idleWarnTimerRef = React.useRef(null);
  const idleCloseTimerRef = React.useRef(null);
  const idleWarningRef = React.useRef(false);
  const endReasonRef = React.useRef('');
  const pendingStopRef = React.useRef(false);
  const drainTimerRef = React.useRef(null);
  const goodbyeFallbackRef = React.useRef(null);
  const intentionalStopRef = React.useRef(false);
  const [idleWarning, setIdleWarning] = React.useState(false);
  const [closingNote, setClosingNote] = React.useState('');
  const reconnectAttemptsRef = React.useRef(0);
  const wakeLockRef = React.useRef(null);
  const wakeLockPendingRef = React.useRef(false);
  const wakeLockReleasedRef = React.useRef(false);
  // Never reset, unlike reconnectAttemptsRef (which clears on every 'ready').
  // Without it, a session that reaches ready then immediately dies would
  // reconnect forever and keep billing.
  const totalReconnectsRef = React.useRef(0);
  const MAX_TOTAL_RECONNECTS = 10;
  const reconnectTimerRef = React.useRef(null);
  const networkOfflineRef = React.useRef(false);
  const sessionGenerationRef = React.useRef(0);
  // Network events must only recover a session the driver explicitly started.
  // `intentionalStopRef` starts false, so it cannot safely represent this.
  const sessionRequestedRef = React.useRef(false);
  // A wireless handoff can briefly deliver audio faster than a vehicle Bluetooth
  // route plays it. Keep only a short, useful backlog instead of letting a reply
  // arrive several seconds late after the driver has already interrupted it.
  const MAX_AUDIO_QUEUE_CHUNKS = 32;
  const nativeVoiceOwnerRef = React.useRef(null);
  const nativeVoiceHeartbeatRef = React.useRef(null);
  const nativeOwnerClaimingRef = React.useRef(false);

  const setListeningActivity = React.useCallback(() => {
    setVoiceActivity(micEnabledRef.current ? 'listening' : 'muted');
  }, []);

  React.useEffect(() => {
    micEnabledRef.current = micEnabled;
  }, [micEnabled]);

  React.useEffect(() => {
    try { localStorage.setItem(`lexi_voice_${companyId}`, selectedVoice); } catch {}
  }, [selectedVoice, companyId]);

  const [handsFreeMode, setHandsFreeMode] = React.useState(() => {
    if (driveMode) return true;
    try { return localStorage.getItem('lexi_hands_free') === '1'; } catch { return false; }
  });
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const handsFreeModeRef = React.useRef(handsFreeMode);

  React.useEffect(() => {
    handsFreeModeRef.current = handsFreeMode;
    // Drive Mode is forced on by the page, so don't let it overwrite the
    // user's own hands-free preference for the normal assistant view.
    if (driveMode) return;
    try { localStorage.setItem('lexi_hands_free', handsFreeMode ? '1' : '0'); } catch {}
  }, [handsFreeMode, driveMode]);

  const releaseNativeVoiceOwner = () => {
    const owner = nativeVoiceOwnerRef.current;
    if (owner) releaseLexiVoiceOwner('native', owner.token);
    nativeVoiceHeartbeatRef.current?.();
    nativeVoiceHeartbeatRef.current = null;
    nativeVoiceOwnerRef.current = null;
  };

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      if (!sessionRequestedRef.current || intentionalStopRef.current) {
        releaseNativeVoiceOwner();
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    // A wake lock is auto-released when the tab is backgrounded; re-acquire it
    // when the driver returns to the tab so the screen stays on for the rest
    // of the session.
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && handsFreeModeRef.current && wsRef.current && !intentionalStopRef.current) {
        acquireWakeLock();
        ensureAudioContextRunning();
      }
    };
    const onOffline = () => {
      if (!sessionRequestedRef.current) return;
      networkOfflineRef.current = true;
      stopAllAudio();
      // A browser can keep an OPEN socket object while its cellular route has
      // disappeared. Retire it now so online always has a clean replacement
      // path; its late close/error handlers are ignored by the identity guard.
      const staleWs = wsRef.current;
      wsRef.current = null;
      sessionGenerationRef.current++;
      if (staleWs) { try { staleWs.close(); } catch (e) {} }
      cleanupSession();
      if (!intentionalStopRef.current) {
        setStatus('reconnecting');
        setVoiceActivity('reconnecting');
        setError('Connection paused — waiting for a network signal…');
      }
    };
    const onOnline = () => {
      networkOfflineRef.current = false;
      if (sessionRequestedRef.current && !intentionalStopRef.current && !wsRef.current) scheduleReconnect('Network restored. Reconnecting to Lexi…', 150);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
      clearClientIdle();
      releaseWakeLock();
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
      releaseNativeVoiceOwner();
    };
  }, []);

  const refreshAudioDevices = React.useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === 'audioinput');
      setAudioDevices(mics);
    } catch (e) {
      console.warn('[Lexi Native] enumerateDevices failed:', e);
    }
  }, []);

  React.useEffect(() => {
    refreshAudioDevices();
    const md = navigator.mediaDevices;
    if (md?.addEventListener) {
      md.addEventListener('devicechange', refreshAudioDevices);
      return () => md.removeEventListener('devicechange', refreshAudioDevices);
    }
  }, [refreshAudioDevices]);

  const stopAllAudio = (fromUserInterrupt = false) => {
    // Invalidates onended callbacks from sources stopped below. Otherwise a
    // late callback can send playback_done after user_interrupted and close
    // the server mic gate again.
    audioPlaybackGenerationRef.current++;
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
      bargeInPendingRef.current = true;
      assistantTextBufferRef.current = "";
      if (ttsTurnTimerRef.current) {
        clearTimeout(ttsTurnTimerRef.current);
        ttsTurnTimerRef.current = null;
      }
      setTtsFallbackActive(false);
      setListeningActivity();
      wsRef.current.send(JSON.stringify({ type: 'user_interrupted' }));
    }
  };

  const speakWithTTS = (text) => {
    if (!text || !('speechSynthesis' in window)) return;
    if (!isLexiVoiceOwner('native', nativeVoiceOwnerRef.current?.token)) return;
    window.speechSynthesis.cancel();
    setVoiceActivity('responding');
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
      setListeningActivity();
    };
    utterance.onerror = () => {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      setListeningActivity();
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
      const playbackGeneration = audioPlaybackGenerationRef.current;
      source.onended = () => {
        if (playbackGeneration !== audioPlaybackGenerationRef.current) return;
        currentSourceRef.current = null;
        isPlayingRef.current = false;
        if (audioQueueRef.current.length === 0) {
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          setListeningActivity();
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
        setListeningActivity();
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'playback_done' }));
        }
      }
      playNextChunk();
    }
  };

  // The stream is acquired by startSession before the socket opens, so this only
  // builds the processing pipeline around it.
  const startAudioCapture = async (ws, stream, isSessionCurrent = () => true) => {
    if (!isSessionCurrent()) {
      stream.getTracks().forEach(track => track.stop());
      return false;
    }
    // Barge-in should not require a full second of sustained speech. Echo
    // cancellation is enabled on the capture stream; use a shorter, stricter
    // threshold in hands-free mode to avoid room/car noise false positives.
    const interruptRmsThreshold = handsFreeModeRef.current ? 0.045 : 0.035;
    const interruptHoldMs = handsFreeModeRef.current ? 480 : 320;
    const interruptFramesNeeded = (sampleCount, sampleRate) =>
      Math.max(1, Math.ceil(interruptHoldMs * sampleRate / (sampleCount * 1000)));
    const interruptCooldownMs = 250;
    const sendPcmChunk = (samples, sampleRate = 16000) => {
      if (!samples.length || ws.readyState !== WebSocket.OPEN) return;
      const outputLength = Math.max(1, Math.round(samples.length * 16000 / sampleRate));
      const int16 = new Int16Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        const sourcePosition = i * sampleRate / 16000;
        const low = Math.floor(sourcePosition);
        const high = Math.min(low + 1, samples.length - 1);
        const fraction = sourcePosition - low;
        const sample = low < samples.length
          ? samples[low] * (1 - fraction) + samples[high] * fraction
          : 0;
        const clamped = Math.max(-1, Math.min(1, sample));
        int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
      }
      const uint8 = new Uint8Array(int16.buffer);
      let binary = '';
      for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i]);
      ws.send(JSON.stringify({ type: 'audio', data: btoa(binary) }));
    };
    localStreamRef.current = stream;
    refreshAudioDevices();

    // Bluetooth handoffs (incoming call, engine start, nav prompt) end the track
    // while the socket stays open — the classic "Lexi went deaf mid-drive" case.
    const micTrack = stream.getAudioTracks()[0];
    if (micTrack) {
      micTrack.onended = () => {
        if (localStreamRef.current !== stream) return;
        handleMicRouteLoss();
      };
    }

    let audioContext;
    try {
      audioContext = new AudioContext({ sampleRate: 16000 });
    } catch (e) {
      // Some Android/Bluetooth routes reject a forced rate outright; the pipeline
      // below already downsamples whatever rate the hardware hands us.
      console.warn("[Lexi Native] 16kHz capture context rejected, using native rate:", e);
      audioContext = new AudioContext();
    }
    const source = audioContext.createMediaStreamSource(stream);

    const actualSampleRate = audioContext.sampleRate;
    const needsResampling = actualSampleRate !== 16000;
    if (needsResampling) {
      console.log(`[Lexi Native] Browser sample rate ${actualSampleRate}Hz (requested 16kHz) — resampling enabled`);
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
      if (!isSessionCurrent()) {
        try { audioContext.close(); } catch (e) {}
        return false;
      }

      const workletNode = new AudioWorkletNode(audioContext, 'mic-processor');
      // pcmBuffer now accumulates 16kHz float32 frames (already downsampled by worklet)
      let pcmBuffer = new Float32Array(0);
      const CHUNK_SIZE = 1280; // 16kHz samples → ~80ms chunks (matches original ~85ms latency)
      let interruptionAudioFrames = [];

      let audioSendCount = 0;
      let lastSpeakingTime = 0;
      // Hands-free: 2000ms echo tail so car-cabin reflections can't re-trigger
      // the VAD. Desktop: 1200ms is plenty for normal speakers.
      const ECHO_TAIL_MS = handsFreeModeRef.current ? 2000 : 1200;

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
          let interruptedThisChunk = false;

          if (isLexiSpeaking) {
            lastSpeakingTime = now;
          }

          const inEchoTail = !isLexiSpeaking && (now - lastSpeakingTime < ECHO_TAIL_MS);
          const shouldMute = isLexiSpeaking || inEchoTail;

          if (isLexiSpeaking) {
            let sum = 0;
            for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
            const rms = Math.sqrt(sum / chunk.length);

            if (rms > interruptRmsThreshold) {
              consecutiveLoudFramesRef.current++;
              interruptionAudioFrames.push(chunk.slice());
              const maxBufferedFrames = interruptFramesNeeded(chunk.length, 16000);
              if (interruptionAudioFrames.length > maxBufferedFrames) interruptionAudioFrames.shift();
            } else {
              consecutiveLoudFramesRef.current = 0;
              interruptionAudioFrames = [];
            }

            if (consecutiveLoudFramesRef.current >= interruptFramesNeeded(chunk.length, 16000)) {
              if (now - lastInterruptTimeRef.current > interruptCooldownMs) {
                const bufferedSpeech = interruptionAudioFrames;
                interruptionAudioFrames = [];
                stopAllAudio(true);
                lastInterruptTimeRef.current = now;
                lastSpeakingTime = 0;
                console.log('[Lexi Native] User interrupting - stopping playback (RMS:', rms.toFixed(4), ')');
                // These frames were withheld during playback to avoid feeding
                // Lexi's own audio back to Gemini. Send them now, after the
                // interruption event has opened the server mic gate.
                for (const speechFrame of bufferedSpeech) {
                  sendPcmChunk(speechFrame);
                  audioSendCount++;
                }
                interruptedThisChunk = true;
              }
            }
          } else {
            consecutiveLoudFramesRef.current = 0;
            interruptionAudioFrames = [];
          }

          if (interruptedThisChunk) continue;
          // Hard gate: skip this chunk entirely when Lexi is speaking or in echo tail.
          // Gemini's own VAD handles the resulting silence naturally.
          if (shouldMute) {
            continue;
          }

          // Convert 16kHz float32 → Int16 PCM (safe loop — no spread-operator stack overflow)
          sendPcmChunk(chunk);
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
      let interruptionAudioFramesFallback = [];

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

          if (rms > interruptRmsThreshold) {
            consecutiveLoudFramesRef.current++;
            interruptionAudioFramesFallback.push(inputData.slice());
            const maxBufferedFrames = interruptFramesNeeded(inputData.length, actualSampleRate);
            if (interruptionAudioFramesFallback.length > maxBufferedFrames) interruptionAudioFramesFallback.shift();
          } else {
            consecutiveLoudFramesRef.current = 0;
            interruptionAudioFramesFallback = [];
          }

          if (consecutiveLoudFramesRef.current >= interruptFramesNeeded(inputData.length, actualSampleRate)) {
            if (now - lastInterruptTimeRef.current > interruptCooldownMs) {
              const bufferedSpeech = interruptionAudioFramesFallback;
              interruptionAudioFramesFallback = [];
              stopAllAudio(true);
              lastInterruptTimeRef.current = now;
              lastSpeakingTimeFallback = 0;
              console.log('[Lexi Native] User interrupting - stopping playback (RMS:', rms.toFixed(4), ')');
              for (const speechFrame of bufferedSpeech) {
                sendPcmChunk(speechFrame, actualSampleRate);
              }
              return;
            }
          }
        } else {
          consecutiveLoudFramesRef.current = 0;
          interruptionAudioFramesFallback = [];
        }

        const inEchoTail = !isLexiSpeaking && (now - lastSpeakingTimeFallback < 2000);
        if (isLexiSpeaking || inEchoTail) {
          return;
        }
        sendPcmChunk(inputData, actualSampleRate);
      };

      source.connect(processor);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      console.log("[Lexi Native] Using ScriptProcessor (fallback)");
    }
    return true;
  };

  // Drive Mode keeps the screen awake so the browser doesn't suspend the tab
  // (and kill the mic) while the phone sits in a car mount. Best-effort only:
  // the Screen Wake Lock API is unsupported on some browsers and can be
  // rejected outright, and neither case should break the voice session.
  const acquireWakeLock = async () => {
    // 'ready' and visibilitychange can both request a lock before either
    // resolves. Without an in-flight guard the second sentinel overwrites the
    // first, which then can never be released and holds the screen on.
    if (wakeLockRef.current || wakeLockPendingRef.current || !navigator.wakeLock?.request) return;
    wakeLockReleasedRef.current = false;
    wakeLockPendingRef.current = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      // Released (or the session ended) while we were awaiting — don't adopt it.
      if (wakeLockReleasedRef.current) { try { lock.release(); } catch (e) {} return; }
      wakeLockRef.current = lock;
      lock.addEventListener?.('release', () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
      console.log('[Lexi Native] Screen wake lock acquired (Drive Mode)');
    } catch (e) {
      console.warn('[Lexi Native] Wake lock unavailable:', e?.message || e);
    } finally {
      wakeLockPendingRef.current = false;
    }
  };

  const releaseWakeLock = () => {
    wakeLockReleasedRef.current = true;
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock) { try { lock.release(); } catch (e) {} }
  };

  // Android Chrome can leave AudioContext.resume() pending forever when another
  // app (car Bluetooth stack, navigation, music) owns audio focus. Without a
  // deadline the session sits on "Connecting…" with no error and no way out.
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);

  // getUserMedia failures are the single most common reason a tap appears to do
  // nothing. Turn the DOMException name into something a driver can act on.
  const describeMicError = (err) => {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Microphone blocked. Tap the lock icon in the address bar → Permissions → allow Microphone, then try again.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'No microphone was found. If you are on car Bluetooth, confirm the car is connected for calls (not just media).';
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return 'Another app is using the microphone. Close any active call or voice app, then try again.';
    }
    return `Microphone error: ${err?.message || name || 'unknown'}`;
  };

  const acquireMicStream = async () => {
    const audioConstraints = {
      sampleRate: { ideal: 16000 },
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (selectedMicId && selectedMicId !== 'default') {
      audioConstraints.deviceId = { exact: selectedMicId };
    }
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (err) {
      // A hand-picked device disappears constantly in a car (Bluetooth drops on
      // engine start, an incoming call steals the route). Fall back to the system
      // default instead of failing the whole session on a stale deviceId.
      const name = err?.name || '';
      if (audioConstraints.deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
        console.warn('[Lexi Native] Selected mic unavailable, falling back to default');
        delete audioConstraints.deviceId;
        setSelectedMicId('default');
        return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      }
      throw err;
    }
  };

  // A Bluetooth route change ends the MediaStreamTrack but leaves the WebSocket
  // wide open, so nothing reconnects and Lexi just goes deaf mid-drive. Retire
  // the socket and rebuild capture against whatever device is live now.
  const handleMicRouteLoss = () => {
    if (intentionalStopRef.current || !sessionRequestedRef.current) return;
    if (totalReconnectsRef.current >= MAX_TOTAL_RECONNECTS) {
      sessionRequestedRef.current = false;
      setError('The microphone kept dropping out. Tap “Talk with Lexi” to start again.');
      return;
    }
    totalReconnectsRef.current++;
    console.warn('[Lexi Native] Mic track ended — audio route changed, rebuilding capture');
    const staleWs = wsRef.current;
    wsRef.current = null;
    sessionGenerationRef.current++;
    if (staleWs) { try { staleWs.close(); } catch (e) {} }
    cleanupSession();
    scheduleReconnect('Audio device changed. Reconnecting to Lexi…', 400);
  };

  const scheduleReconnect = (message, delayMs) => {
    if (!sessionRequestedRef.current || intentionalStopRef.current || networkOfflineRef.current || reconnectTimerRef.current || wsRef.current) return;
    setStatus('reconnecting');
    setVoiceActivity('reconnecting');
    setError(message);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (sessionRequestedRef.current && !intentionalStopRef.current && !networkOfflineRef.current && !wsRef.current) startSession(true);
    }, delayMs);
  };

  const clearClientIdle = () => {
    if (idleWarnTimerRef.current) clearTimeout(idleWarnTimerRef.current);
    if (idleCloseTimerRef.current) clearTimeout(idleCloseTimerRef.current);
    idleWarnTimerRef.current = null;
    idleCloseTimerRef.current = null;
  };

  // Backup for the server's 45s/60s silence close. User speech and a normal
  // assistant turn restart it. The idle-warning line must not, or the warning
  // itself would keep the mic open.
  const armClientIdle = () => {
    clearClientIdle();
    if (handsFreeModeRef.current || intentionalStopRef.current || pendingStopRef.current) return;
    idleWarnTimerRef.current = setTimeout(() => {
      idleWarningRef.current = true;
      setIdleWarning(true);
    }, LEXI_IDLE_WARN_MS);
    idleCloseTimerRef.current = setTimeout(() => {
      drainThenStop('idle');
    }, LEXI_IDLE_CLOSE_MS);
  };

  const stopMicTracks = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  };

  const drainThenStop = (reason) => {
    if (pendingStopRef.current && endReasonRef.current) return;
    pendingStopRef.current = true;
    endReasonRef.current = reason;
    intentionalStopRef.current = true;
    sessionRequestedRef.current = false;
    clearClientIdle();
    idleWarningRef.current = false;
    setIdleWarning(false);
    stopMicTracks();
    if (goodbyeFallbackRef.current) { clearTimeout(goodbyeFallbackRef.current); goodbyeFallbackRef.current = null; }
    if (reason === 'goodbye') setClosingNote('Lexi is saying goodbye…');
    const started = Date.now();
    const finish = () => {
      drainTimerRef.current = null;
      stopSession();
      setClosingNote('');
      if (reason === 'idle') {
        setError('Lexi closed after a minute of silence. Tap “Talk with Lexi” to start again.');
      }
    };
    const tick = () => {
      const quiet = !isPlayingRef.current && audioQueueRef.current.length === 0 && !isSpeakingRef.current;
      if (quiet || Date.now() - started >= LEXI_GOODBYE_DRAIN_MS) finish();
      else drainTimerRef.current = setTimeout(tick, 120);
    };
    tick();
  };

  const startSession = async (isRecovery = false) => {
    if (!isRecovery) {
      nativeOwnerClaimingRef.current = true;
      const owner = acquireLexiVoiceOwner('native', { companyId });
      nativeVoiceOwnerRef.current = owner;
      nativeVoiceHeartbeatRef.current?.();
      nativeVoiceHeartbeatRef.current = startLexiVoiceOwnerHeartbeat('native', owner.token);
      nativeOwnerClaimingRef.current = false;
      sessionRequestedRef.current = true;
    }
    if (!sessionRequestedRef.current) return;
    if (!isLexiVoiceOwner('native', nativeVoiceOwnerRef.current?.token)) {
      sessionRequestedRef.current = false;
      return;
    }
    if (networkOfflineRef.current) {
      setStatus('reconnecting');
      setVoiceActivity('reconnecting');
      setError('Connection paused — waiting for a network signal…');
      return;
    }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (drainTimerRef.current) { clearTimeout(drainTimerRef.current); drainTimerRef.current = null; }
    clearClientIdle();
    intentionalStopRef.current = false;
    pendingStopRef.current = false;
    endReasonRef.current = '';
    idleWarningRef.current = false;
    setIdleWarning(false);
    setClosingNote('');
    wakeLockReleasedRef.current = false;
    const sessionGeneration = ++sessionGenerationRef.current;
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
    const isCurrentSession = () => (
      sessionGeneration === sessionGenerationRef.current &&
      !intentionalStopRef.current &&
      isLexiVoiceOwner('native', nativeVoiceOwnerRef.current?.token)
    );
    const abandonStartup = () => {
      if (audioContextRef.current === audioContext) audioContextRef.current = null;
      try { audioContext.close(); } catch (e) {}
    };

    audioContext.onstatechange = () => {
      console.log("[Lexi Native] AudioContext state changed:", audioContext.state);
      setAudioContextState(audioContext.state);
    };

    console.log("[Lexi Native] AudioContext created at", audioContext.sampleRate, "Hz, state:", audioContext.state);
    try {
      await withTimeout(audioContext.resume(), 4000, 'audio-resume-timeout');
    } catch (e) {
      // Never leave the driver stranded on a spinner: fall through to the
      // state check below, which reports a real error and returns to idle.
      console.warn("[Lexi Native] AudioContext resume did not settle:", e?.message || e);
    }
    if (!isCurrentSession()) { abandonStartup(); return; }
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
      if (!isCurrentSession()) { abandonStartup(); return; }
      console.log("[Lexi Native] Unlock tone completed, AudioContext state:", audioContext.state);
    } catch (e) {
      console.error("[Lexi Native] Unlock tone failed:", e);
    }

    if (audioContext.state !== 'running') {
      console.error("[Lexi Native] CRITICAL: AudioContext still not running after unlock tone! State:", audioContext.state);
      setError("Audio could not start — another app may be holding the speaker. Pause navigation or music, then tap “Talk with Lexi” again.");
      setStatus("idle");
      sessionRequestedRef.current = false;
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

    // Declared outside the try so the catch below can release it — a mic stream
    // acquired before the socket opens must never outlive a failed startup.
    let micStream = null;
    try {
      const currentUser = user || await base44.auth.me();
      if (!isCurrentSession()) { abandonStartup(); return; }
      if (!currentUser) {
        setError("Please log in first");
        setStatus("idle");
        sessionRequestedRef.current = false;
        return;
      }

      let resolvedCompanyId = companyId;
      let staffProfileName = '';
      if (!resolvedCompanyId) {
        const ownedCompanies = await base44.entities.Company.filter({ created_by: currentUser.email });
        const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: currentUser.email });
        resolvedCompanyId = ownedCompanies?.[0]?.id || staffProfiles?.[0]?.company_id;
        staffProfileName = staffProfiles?.[0]?.full_name || '';
        if (!isCurrentSession()) { abandonStartup(); return; }
      } else {
        try {
          const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: currentUser.email });
          if (!isCurrentSession()) { abandonStartup(); return; }
          staffProfileName = staffProfiles?.[0]?.full_name || '';
        } catch (e) {}
      }

      // Acquire the microphone BEFORE opening the socket. A mic failure is terminal
      // and self-explanatory; opening the socket first turned every permission or
      // route problem into a misleading "Lexi disconnected" retry loop instead.
      try {
        micStream = await acquireMicStream();
      } catch (micErr) {
        console.error("[Lexi Native] Mic acquisition failed:", micErr);
        setError(describeMicError(micErr));
        setStatus("idle");
        sessionRequestedRef.current = false;
        abandonStartup();
        return;
      }
      if (!isCurrentSession()) {
        micStream.getTracks().forEach(t => t.stop());
        abandonStartup();
        return;
      }
      // Park it on the ref immediately so every teardown path releases the mic.
      localStreamRef.current = micStream;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const rawName = (staffProfileName || currentUser.full_name || currentUser.name || '').trim();
      const emailLocal = (currentUser.email || '').split('@')[0] || '';
      const firstNameFromEmail = emailLocal.split(/[._\-+0-9]/).filter(Boolean)[0] || '';
      const firstName = (rawName.split(/\s+/)[0]
        || (firstNameFromEmail ? firstNameFromEmail.charAt(0).toUpperCase() + firstNameFromEmail.slice(1).toLowerCase() : '')
        || 'there');
      const wsUrl = `${protocol}//${window.location.host}/ws/lexi-native?companyId=${encodeURIComponent(resolvedCompanyId || '')}&userEmail=${encodeURIComponent(currentUser.email)}&userName=${encodeURIComponent(firstName)}&voice=${encodeURIComponent(selectedVoice)}&hands_free=${handsFreeMode ? '1' : '0'}`;

      const ws = new WebSocket(wsUrl);
      if (!isCurrentSession()) { try { ws.close(); } catch (e) {} abandonStartup(); return; }
      wsRef.current = ws;

      ws.onopen = async () => {
        if (wsRef.current !== ws || !isCurrentSession()) { try { ws.close(); } catch (e) {} return; }
        setStatus("connected");
        try {
          const captureStarted = await startAudioCapture(ws, micStream, () => wsRef.current === ws && isCurrentSession());
          if (!captureStarted || wsRef.current !== ws || !isCurrentSession()) { try { ws.close(); } catch (e) {} return; }
          setMicEnabled(true);
        } catch (err) {
          // Terminal: a reconnect cannot repair a broken audio pipeline, and the
          // retry loop would overwrite this message with a generic network one.
          // Retire and tear down synchronously so an immediate retry tap cannot
          // race the async close and inherit this attempt's mic/AudioContext.
          console.error("[Lexi Native] Audio pipeline failed:", err);
          intentionalStopRef.current = true;
          sessionRequestedRef.current = false;
          if (wsRef.current === ws) wsRef.current = null;
          sessionGenerationRef.current++;
          try { ws.close(); } catch (e) {}
          cleanupSession();
          setError(describeMicError(err));
          setStatus("idle");
          return;
        }
      };

      ws.onmessage = async (event) => {
        try {
          if (sessionGeneration !== sessionGenerationRef.current || wsRef.current !== ws) return;
          const msg = JSON.parse(event.data);

          if (msg.type === 'status') {
            if (msg.status === 'ready') {
              bargeInPendingRef.current = false;
              setStatus("live");
              setListeningActivity();
              reconnectAttemptsRef.current = 0;
              setError("");
              lastActivityRef.current = Date.now();
              if (autoStopTimerRef.current) { clearInterval(autoStopTimerRef.current); autoStopTimerRef.current = null; }
              // The server owns both the 15-minute billing cap and, in standard
              // mode, the 45s warning / 60s silence close. This backup uses the
              // same window and does not restart when the warning is spoken.
              // Hands-free and Drive Mode stay open through silence.
              if (handsFreeModeRef.current) {
                clearClientIdle();
                acquireWakeLock();
              } else {
                armClientIdle();
              }
            } else if (msg.status === 'reconnecting') {
              // The browser socket is still open — this is the SAME session
              // re-establishing its upstream link, so don't tear anything down.
              stopAllAudio();
              setVoiceActivity('reconnecting');
              setError(`Reconnecting to Lexi (${msg.attempt}/${msg.max})…`);
            } else if (msg.status === 'disconnected') {
              // The server owns teardown from here (it closes the socket right
              // after this), so just surface why the session ended.
              setStatus("idle");
              setVoiceActivity('idle');
              // This is terminal (temporary upstream loss uses "reconnecting").
              // Clear intent before the close event so an offline/online handoff
              // cannot mask a server-ended session and restart it unattended.
              sessionRequestedRef.current = false;
              if (msg.reason === 'idle') {
                setError("Lexi ended the session after a long silence.");
              } else if (msg.fatal) {
                setError("Lexi couldn't reach the voice service. Retrying…");
              }
            }
          }

          if (msg.type === 'error') {
            setVoiceActivity('error');
            setError(msg.message);
          }

          if (msg.type === 'transcript') {
            // Ignore stale assistant speech while Gemini is processing the
            // user's barge-in. A user transcript confirms the new turn landed.
            if (msg.role === 'assistant' && bargeInPendingRef.current) return;
            if (msg.role === 'user') bargeInPendingRef.current = false;
            lastActivityRef.current = Date.now();
            if (msg.role === 'user' && !pendingStopRef.current) {
              idleWarningRef.current = false;
              setIdleWarning(false);
              armClientIdle();
            }
            setTranscript(prev => {
              const last = prev[prev.length - 1];
              if (last && last.role === msg.role) {
                return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + msg.text }];
              }
              return [...prev, { role: msg.role, text: msg.text, time: new Date().toLocaleTimeString() }];
            });

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
            if (msg.role === 'user') {
              setVoiceActivity('thinking');
            }
          }

          if (msg.type === 'speak_text' && msg.text) {
            if (bargeInPendingRef.current) return;
            setVoiceActivity('responding');
            stopAllAudio();
            setTtsFallbackActive(true);
            speakWithTTS(msg.text);
          }

            if (msg.type === 'audio') {
             if (sessionGeneration !== sessionGenerationRef.current || wsRef.current !== ws) return;
            if (bargeInPendingRef.current) return;
            hasEverReceivedAudioRef.current = true;
            setVoiceActivity('responding');
            setAudioChunksReceived(prev => prev + 1);
            lastActivityRef.current = Date.now();

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
            if (sessionGeneration !== sessionGenerationRef.current || wsRef.current !== ws) return;

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

            if (audioQueueRef.current.length >= MAX_AUDIO_QUEUE_CHUNKS) {
              audioQueueRef.current.shift();
              console.warn('[Lexi Native] Dropped stale playback chunk to keep Bluetooth latency bounded');
            }
            audioQueueRef.current.push(bytes);
            playNextChunk();
          }

          if (msg.type === 'idle_warning') {
            idleWarningRef.current = true;
            setIdleWarning(true);
          }

          if (msg.type === 'session_ending') {
            if (msg.cancelled) {
              setClosingNote('');
              if (goodbyeFallbackRef.current) { clearTimeout(goodbyeFallbackRef.current); goodbyeFallbackRef.current = null; }
            } else {
              setClosingNote('Lexi is saying goodbye…');
              // The server closes after the goodbye. If that message never
              // arrives, stop locally so the mic and socket cannot linger.
              if (goodbyeFallbackRef.current) clearTimeout(goodbyeFallbackRef.current);
              goodbyeFallbackRef.current = setTimeout(() => {
                goodbyeFallbackRef.current = null;
                console.log('[Lexi Native] Goodbye was not followed by a server close — stopping locally');
                drainThenStop('goodbye');
              }, 12000);
            }
          }

          if (msg.type === 'session_end') {
            drainThenStop(msg.reason === 'idle' ? 'idle' : 'goodbye');
          }

          if (msg.type === 'turn_complete') {
            if (!pendingStopRef.current && !idleWarningRef.current) armClientIdle();
            if (!hasEverReceivedAudioRef.current && assistantTextBufferRef.current) {
              console.log("[Lexi Native] Turn complete with no audio — TTS fallback for buffered text");
              setTtsFallbackActive(true);
              speakWithTTS(assistantTextBufferRef.current);
              assistantTextBufferRef.current = "";
            } else {
              assistantTextBufferRef.current = "";
            }
            if (!isPlayingRef.current && audioQueueRef.current.length === 0 && !isSpeakingRef.current && !assistantTextBufferRef.current) {
              setListeningActivity();
            }
            // Safety: if mobile onended never fires, the server gate stays stuck.
            // After 8s, if queue is empty and not playing, send playback_done ourselves.
            setTimeout(() => {
              if (
                sessionGeneration === sessionGenerationRef.current &&
                wsRef.current === ws &&
                audioQueueRef.current.length === 0 &&
                !isPlayingRef.current &&
                ws.readyState === WebSocket.OPEN
              ) {
                console.log("[Lexi Native] Safety playback_done sent after turn_complete timeout");
                ws.send(JSON.stringify({ type: 'playback_done' }));
              }
            }, 8000);
          }

          if (msg.type === 'interrupted') {
            bargeInPendingRef.current = false;
            stopAllAudio();
            setListeningActivity();
            assistantTextBufferRef.current = "";
            if (ttsTurnTimerRef.current) {
              clearTimeout(ttsTurnTimerRef.current);
              ttsTurnTimerRef.current = null;
            }
          }

          if (msg.type === 'tool_call') {
            setVoiceActivity('checking');
            setToolCalls(prev => [...prev, { name: msg.name, time: new Date().toLocaleTimeString() }]);
          }
        } catch (err) {
          console.error("[Lexi Native] WS message error:", err);
        }
      };

      ws.onclose = (e) => {
        if (wsRef.current !== ws || sessionGeneration !== sessionGenerationRef.current) {
          // Offline intentionally retires the current browser socket before its
          // close event fires. Still honor a terminal server idle close: it must
          // cancel a queued/just-started handoff recovery rather than reopening
          // Lexi after the server's idle cap.
          if (e.code === 4002) {
            sessionRequestedRef.current = false;
            intentionalStopRef.current = true;
            if (reconnectTimerRef.current) {
              clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = null;
            }
            const replacementWs = wsRef.current;
            if (replacementWs && replacementWs !== ws) {
              wsRef.current = null;
              try { replacementWs.close(); } catch (err) {}
              cleanupSession();
              setStatus('idle');
              setError("Lexi ended the session after a long silence. Tap “Talk with Lexi” to start again.");
            }
          }
          if (e.code === 4003) {
            sessionRequestedRef.current = false;
            intentionalStopRef.current = true;
            if (reconnectTimerRef.current) {
              clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = null;
            }
            const replacementWs = wsRef.current;
            if (replacementWs && replacementWs !== ws) {
              wsRef.current = null;
              try { replacementWs.close(); } catch (err) {}
              cleanupSession();
              setStatus('idle');
            }
          }
          console.log('[Lexi Native] Ignoring close from superseded browser socket');
          return;
        }
        const goodbyeClose = e.code === 4003 || endReasonRef.current === 'goodbye';
        if (pendingStopRef.current || goodbyeClose) {
          intentionalStopRef.current = true;
          sessionRequestedRef.current = false;
          if (wsRef.current === ws) wsRef.current = null;
          if (!pendingStopRef.current) drainThenStop(goodbyeClose ? 'goodbye' : (endReasonRef.current || 'idle'));
          return;
        }
        console.log("[Lexi Native] WS Closed", {
          code: e.code,
          reason: e.reason || '(no reason)',
          wasClean: e.wasClean,
          intentional: intentionalStopRef.current,
          handsFree: handsFreeModeRef.current,
        });
        if (wsRef.current === ws) wsRef.current = null;
        cleanupSession();
        setStatus("idle");
        // Drive Mode gets more retries: the driver can't tap the screen, and
        // mobile networks drop briefly (tunnels, tower handoffs) far more often
        // than a desktop connection does.
        const maxReconnects = handsFreeModeRef.current ? 5 : 2;
        // 4002: the server ended an idle session on purpose. Retrying would
        // just re-open a session nobody is using, so treat it as a clean stop.
        if (e.code === 4002) {
          sessionRequestedRef.current = false;
          if (endReasonRef.current !== 'idle') {
            setError("Lexi ended the session after a long silence. Tap “Talk with Lexi” to start again.");
          }
          return;
        }
        const budgetLeft = reconnectAttemptsRef.current < maxReconnects
          && totalReconnectsRef.current < MAX_TOTAL_RECONNECTS;
        if (!intentionalStopRef.current && budgetLeft) {
          const attempt = ++reconnectAttemptsRef.current;
          totalReconnectsRef.current++;
          const waitMs = Math.min(4000, attempt * 900);
          scheduleReconnect(`Lexi disconnected. Reconnecting (${attempt}/${maxReconnects})…`, waitMs);
        } else if (!intentionalStopRef.current) {
          sessionRequestedRef.current = false;
          setError("Lexi lost the connection. Tap “Talk with Lexi” to retry.");
        }
      };

      ws.onerror = (err) => {
        if (wsRef.current !== ws || sessionGeneration !== sessionGenerationRef.current) return;
        console.error("[Lexi Native] WS Error:", err);
        setError("Connection error. Please try again.");
        // Let onclose perform one guarded teardown/retry. Some mobile browsers
        // emit error first and close shortly after; closing here makes that
        // transition deterministic without tearing down a replacement socket.
        try { ws.close(); } catch (e) {}
      };

    } catch (err) {
      console.error("[Lexi Native] Start error:", err);
      // Release everything THIS attempt acquired. If a newer session already
      // owns the refs, only stop our own stream so we don't tear that one down.
      if (sessionGeneration === sessionGenerationRef.current) {
        cleanupSession();
        setError(err.message);
        setStatus("idle");
        sessionRequestedRef.current = false;
      } else if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
      }
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
    releaseWakeLock();
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
    setVoiceActivity('idle');
    setAudioChunksReceived(0);
    hasEverReceivedAudioRef.current = false;
    nextPlayTimeRef.current = 0;
    setTtsFallbackActive(false);
    assistantTextBufferRef.current = "";
    if (ttsFallbackTimerRef.current) { clearTimeout(ttsFallbackTimerRef.current); ttsFallbackTimerRef.current = null; }
    if (ttsTurnTimerRef.current) { clearTimeout(ttsTurnTimerRef.current); ttsTurnTimerRef.current = null; }
  };

  const stopSession = () => {
    intentionalStopRef.current = true;
    sessionRequestedRef.current = false;
    sessionGenerationRef.current++;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    reconnectAttemptsRef.current = 0;
    if (autoStopTimerRef.current) { clearInterval(autoStopTimerRef.current); autoStopTimerRef.current = null; }
    if (drainTimerRef.current) { clearTimeout(drainTimerRef.current); drainTimerRef.current = null; }
    if (goodbyeFallbackRef.current) { clearTimeout(goodbyeFallbackRef.current); goodbyeFallbackRef.current = null; }
    clearClientIdle();
    idleWarningRef.current = false;
    setIdleWarning(false);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanupSession();
    releaseNativeVoiceOwner();
    setStatus("idle");
    setVoiceActivity('idle');
    console.log('[Lexi Native] Local session stopped', {
      reason: endReasonRef.current || 'button',
      ui: 'idle',
      mic: 'released',
      playback: 'stopped',
    });
  };

  React.useEffect(() => {
    const unsubscribe = subscribeToLexiVoiceOwner(({ owner }) => {
      if (nativeOwnerClaimingRef.current) return;
      const ownToken = nativeVoiceOwnerRef.current?.token;
      if (owner?.kind === 'native' && owner.token === ownToken) return;
      if (!sessionRequestedRef.current) return;
      console.log('[Lexi Native] Another voice channel took ownership; stopping native session');
      stopSession();
    });
    return unsubscribe;
  }, []);

  const toggleMic = () => {
    setMicEnabled(prev => {
      const next = !prev;
      if (!isSpeakingRef.current && ['listening', 'muted'].includes(voiceActivity)) {
        setVoiceActivity(next ? 'listening' : 'muted');
      }
      return next;
    });
  };

  const isLive = status === "live";
  const isConnecting = status === "connecting" || status === "connected" || status === "reconnecting";
  const activityLabel = {
    idle: 'Voice session is off',
    listening: 'Listening…',
    muted: 'Mic muted — tap to unmute',
    thinking: 'Thinking',
    checking: 'Checking',
    responding: 'Lexi is responding',
    reconnecting: 'Reconnecting to Lexi',
    error: 'Voice connection needs attention',
  }[voiceActivity] || 'Listening…';
  const showActivityDots = ['thinking', 'checking', 'responding', 'reconnecting'].includes(voiceActivity);

  return (
    <Card data-testid="card-lexi-native-voice" className={`overflow-hidden ${driveMode ? 'border-blue-400/60 shadow-lg shadow-blue-500/10' : ''}`}>
      <CardContent className="p-0">
        {/* ── Idle / settings view ── */}
        {!isLive && !isConnecting && (
          <div className="p-3">
            {error && (
              <Alert variant="destructive" className="mb-3">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Compact mic button row — always visible */}
            <div className={`flex items-center gap-3 ${driveMode ? 'flex-col sm:flex-row' : ''}`}>
              <button
                // React passes the click event to a bare handler. startSession's
                // optional argument is a recovery flag, so pass no argument for a
                // new user-initiated session rather than treating the event as one.
                onClick={() => startSession()}
                data-testid="button-start-native"
                className={`flex-1 w-full flex items-center gap-3 px-4 rounded-xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 hover:from-blue-500/20 hover:to-purple-500/20 border border-blue-200/40 dark:border-blue-800/40 transition-all duration-200 active:scale-[0.98] ${driveMode ? 'min-h-16 py-3' : 'py-2.5'}`}
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-md shadow-blue-500/25 flex-shrink-0">
                  <Mic className="w-4 h-4 text-white" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-foreground leading-tight">Talk with Lexi</p>
                  <p className="text-xs text-muted-foreground leading-tight">Just speak — she'll listen and respond</p>
                </div>
              </button>

              {/* Settings toggle */}
              <button
                onClick={() => setSettingsOpen(o => !o)}
                data-testid="button-toggle-voice-settings"
                className="flex-shrink-0 min-w-11 min-h-11 rounded-lg border border-border/50 bg-muted/40 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                title="Voice & microphone settings"
              >
                {settingsOpen ? <ChevronUp className="w-4 h-4" /> : <Settings2 className="w-4 h-4" />}
              </button>
            </div>

            {/* Expandable settings panel */}
            {settingsOpen && (
              <div className="mt-3 pt-3 border-t border-border/40 space-y-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Voice</label>
                  <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                    <SelectTrigger className="w-full h-8 text-sm" data-testid="select-native-voice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GEMINI_VOICES.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Microphone</label>
                  <Select value={selectedMicId} onValueChange={setSelectedMicId}>
                    <SelectTrigger className="w-full h-8 text-sm" data-testid="select-mic-device">
                      <SelectValue placeholder="Default Microphone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default Microphone</SelectItem>
                      {audioDevices.filter(d => d.deviceId && d.deviceId !== 'default').map(d => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>
                          {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {audioDevices.length <= 1 && (
                    <p className="text-xs text-muted-foreground" data-testid="text-mic-hint">
                      Using car Bluetooth? Start once to grant mic permission, stop, then pick your device here.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3" data-testid="hands-free-toggle-row">
                  <div className="flex items-center gap-2">
                    <Car className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium leading-tight">Hands-free mode</p>
                      <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                        {driveMode
                          ? 'Always on in Drive Mode — the session stays open through silence'
                          : handsFreeMode
                            ? 'On — stays open through silence, better for driving & Bluetooth speakers'
                            : 'Off — snappier response, closes after about a minute of silence'}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={handsFreeMode}
                    onCheckedChange={setHandsFreeMode}
                    disabled={driveMode}
                    data-testid="switch-hands-free-mode"
                  />
                </div>

                {onFallbackToTTS && (
                  <Button variant="ghost" size="sm" onClick={onFallbackToTTS} className="w-full" data-testid="button-switch-tts">
                    Switch to text mode
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Connecting ── */}
        {isConnecting && (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-400/40 to-purple-500/40 animate-ping absolute inset-0" />
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center relative">
                <Sparkles className="w-8 h-8 text-white animate-pulse" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground animate-pulse" data-testid="text-drive-connection-status">
              {status === 'reconnecting' ? (error || 'Reconnecting to Lexi…') : 'Connecting to Lexi…'}
            </p>
          </div>
        )}

        {/* ── Live conversation view ── */}
        {isLive && (
          <div className="flex flex-col" data-testid="live-conversation-view">

            {/* Conversation bubbles */}
            {transcript.length > 0 && (
              <div className="border-b border-border/50">
                <p className="px-4 pt-3 text-xs text-muted-foreground">
                  Conversation history — scroll to review earlier messages
                </p>
                <ScrollArea className="h-[min(420px,46vh)] px-4 pt-3">
                <div className="space-y-3 pb-2">
                  {transcript.map((entry, i) => (
                    <div key={i} className={`flex gap-2 ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {entry.role === 'assistant' && (
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex-shrink-0 flex items-center justify-center mt-0.5">
                          <Sparkles className="w-3 h-3 text-white" />
                        </div>
                      )}
                      <div className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                        entry.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-muted text-foreground rounded-bl-sm'
                      }`}>
                        {entry.text}
                      </div>
                    </div>
                  ))}
                </div>
                </ScrollArea>
              </div>
            )}

            {transcript.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Sparkles className="w-6 h-6 mb-2 opacity-40" />
                <p className="text-sm">Say anything to start the conversation</p>
              </div>
            )}

            {/* Orb + status */}
            <div className={`flex flex-col items-center gap-3 border-t border-border/50 ${driveMode ? 'py-7' : 'py-5'}`}>
              <div className="relative flex items-center justify-center">
                {isSpeaking && (
                  <>
                    <div className="absolute w-24 h-24 rounded-full bg-blue-500/20 animate-ping" style={{ animationDuration: '1s' }} />
                    <div className="absolute w-32 h-32 rounded-full bg-purple-500/10 animate-ping" style={{ animationDuration: '1s', animationDelay: '0.3s' }} />
                  </>
                )}
                <button
                  type="button"
                  data-testid="button-toggle-mic-large"
                  onClick={toggleMic}
                  aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
                  className={`relative rounded-full flex items-center justify-center transition-all duration-300 select-none ${
                    driveMode ? 'w-24 h-24' : 'w-16 h-16'
                  } ${
                    isSpeaking
                      ? 'bg-gradient-to-br from-blue-500 to-purple-600 scale-110 shadow-xl shadow-blue-500/40'
                      : micEnabled
                        ? 'bg-gradient-to-br from-blue-400/80 to-purple-500/80 scale-100 shadow-lg shadow-blue-500/20 animate-pulse'
                        : 'bg-muted scale-100'
                  }`}
                >
                  {isSpeaking
                    ? <Volume2 className="w-6 h-6 text-white" />
                    : micEnabled
                      ? <Mic className="w-6 h-6 text-white" />
                      : <MicOff className="w-6 h-6 text-muted-foreground" />
                  }
                </button>
              </div>

              <p
                className={`font-medium ${driveMode ? 'text-sm' : 'text-xs'} text-muted-foreground`}
                data-testid="text-mic-status"
                aria-live="polite"
                aria-atomic="true"
              >
                <span>
                  {closingNote
                    ? closingNote
                    : idleWarning && !isSpeaking
                      ? 'Still there? I\'ll close soon.'
                      : (isSpeaking ? 'Lexi is responding — tap orb to interrupt' : activityLabel)}
                </span>
                {showActivityDots && <ActivityDots />}
              </p>

              {/* CRM actions — subtle chips */}
              {toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-center max-w-full px-4">
                  {toolCalls.slice(-4).map((tc, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20">
                      <Wrench className="w-2.5 h-2.5" /> {tc.name}
                    </span>
                  ))}
                </div>
              )}

              {/* End button */}
              <button
                onClick={stopSession}
                data-testid="button-stop-native"
                aria-label="End Lexi session"
                className={`mt-1 rounded-full bg-destructive/90 hover:bg-destructive flex items-center justify-center shadow-md transition-all active:scale-95 ${driveMode ? 'w-16 h-16' : 'w-12 h-12'}`}
              >
                <Square className="w-4 h-4 text-destructive-foreground fill-current" />
              </button>
            </div>

            {error && (
              <div className="px-4 pb-3">
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
