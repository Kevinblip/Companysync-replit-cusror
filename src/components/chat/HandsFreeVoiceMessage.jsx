// ── Hands-free voice message ─────────────────────────────────────────────────
// One control, then eyes off the screen:
//   say a teammate's name → speak the message → Lexi reads back who it's for →
//   say "send" (or "cancel") → the clip lands in that teammate's direct thread
//   as a normal playable voice message with the usual email/SMS notice.
//
// Every failure path (mic denied, no name matched, ambiguous name, cancelled
// mid-flow, delivery failure) is spoken aloud AND shown — a message is never
// silently dropped.

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Mic, Square, Loader2, Check, AlertTriangle, X, Send, RotateCcw, Ear } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import {
  resolveTeammateName,
  describeCandidates,
  classifyConfirmation,
} from "@/utils/teammateNameMatch";
import { deliverVoiceMessage } from "@/utils/handsFreeDelivery";
import {
  acquireLexiVoiceOwner,
  releaseLexiVoiceOwner,
  startLexiVoiceOwnerHeartbeat,
} from "@/utils/lexiVoiceCoordinator";

const MAX_BODY_SECONDS = 120;
const MIN_BODY_MS = 1200;
const SILENCE_STOP_MS = 2600;
const NAME_ATTEMPTS = 3;
const CONFIRM_ATTEMPTS = 2;
const LISTEN_TIMEOUT_MS = 7000;

function speechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isHandsFreeSupported() {
  if (typeof window === "undefined") return false;
  return Boolean(
    speechRecognitionCtor() &&
    window.MediaRecorder &&
    navigator?.mediaDevices?.getUserMedia
  );
}

// Speak a line and resolve when it finishes. Some browsers never fire `onend`,
// so a length-based safety timer always resolves the promise.
function speak(text) {
  return new Promise((resolve) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth || !text) return resolve(false);
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(String(text));
      utterance.rate = 1.02;
      utterance.lang = "en-US";
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(true); } };
      utterance.onend = finish;
      utterance.onerror = finish;
      setTimeout(finish, Math.min(22000, 1500 + String(text).length * 85));
      synth.speak(utterance);
    } catch {
      resolve(false);
    }
  });
}

function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* no-op */ }
}

/**
 * Listen for one utterance.
 * Rejects with Error('mic-denied' | 'no-speech' | 'aborted' | 'unsupported').
 */
function listenOnce({ timeoutMs = LISTEN_TIMEOUT_MS, onPartial, register } = {}) {
  return new Promise((resolve, reject) => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return reject(new Error("unsupported"));
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    let finalText = "";
    let interimText = "";
    let settled = false;
    let timer = null;

    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; } catch { /* no-op */ }
      try { recognition.abort(); } catch { /* no-op */ }
      if (error) reject(error); else resolve(value);
    };

    recognition.onresult = (event) => {
      interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      onPartial?.((finalText || interimText).trim());
    };
    recognition.onerror = (event) => {
      const code = event?.error;
      if (code === "not-allowed" || code === "service-not-allowed") return settle(new Error("mic-denied"));
      if (code === "no-speech") return settle(new Error("no-speech"));
      if (code === "aborted") return settle(new Error("aborted"));
      settle(new Error(code || "speech-error"));
    };
    recognition.onend = () => {
      const heard = (finalText || interimText).trim();
      if (heard) settle(null, heard); else settle(new Error("no-speech"));
    };

    timer = setTimeout(() => { try { recognition.stop(); } catch { /* no-op */ } }, timeoutMs);
    register?.(() => settle(new Error("aborted")));
    try { recognition.start(); } catch { settle(new Error("speech-error")); }
  });
}

/**
 * Record the message body. Stops on silence, on the max duration, or when the
 * caller invokes the stop function handed to `register`.
 * Rejects with Error('mic-denied' | 'cancelled' | 'empty' | 'recorder-unavailable').
 */
function recordVoiceBody({ onTick, onLevel, register } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let keepClip = true;
    let stream = null;
    let audioCtx = null;
    let poll = null;
    let recorder = null;

    const teardown = () => {
      if (poll) { clearInterval(poll); poll = null; }
      try { audioCtx?.close(); } catch { /* no-op */ }
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* no-op */ }
    };
    const fail = (code) => { if (settled) return; settled = true; teardown(); reject(new Error(code)); };

    navigator.mediaDevices.getUserMedia({ audio: true }).then((micStream) => {
      stream = micStream;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch {
        return fail("recorder-unavailable");
      }

      const chunks = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) chunks.push(event.data); };
      recorder.onstop = () => {
        teardown();
        if (settled) return;
        settled = true;
        if (!keepClip) return reject(new Error("cancelled"));
        if (chunks.length === 0) return reject(new Error("empty"));
        const type = recorder.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : "webm";
        resolve({
          file: new File(chunks, `voice-message-${Date.now()}.${ext}`, { type }),
          seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        });
      };

      const stopRecorder = (send) => {
        keepClip = send;
        try { recorder.stop(); } catch { fail(send ? "empty" : "cancelled"); }
      };
      register?.(stopRecorder);

      // Silence detection so the flow needs no second tap.
      let analyser = null;
      let sampleBuffer = null;
      let lastLoudAt = Date.now();
      let heardAnything = false;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          audioCtx = new Ctx();
          const source = audioCtx.createMediaStreamSource(stream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          sampleBuffer = new Uint8Array(analyser.fftSize);
        }
      } catch { analyser = null; }

      let lastReportedSecond = -1;
      poll = setInterval(() => {
        if (settled) return;
        const elapsedMs = Date.now() - startedAt;
        const seconds = Math.floor(elapsedMs / 1000);
        if (seconds !== lastReportedSecond) { lastReportedSecond = seconds; onTick?.(seconds); }
        if (analyser && sampleBuffer) {
          analyser.getByteTimeDomainData(sampleBuffer);
          let peak = 0;
          for (let i = 0; i < sampleBuffer.length; i += 1) {
            const amplitude = Math.abs(sampleBuffer[i] - 128);
            if (amplitude > peak) peak = amplitude;
          }
          onLevel?.(peak);
          if (peak > 6) { lastLoudAt = Date.now(); heardAnything = true; }
          if (heardAnything && elapsedMs > MIN_BODY_MS && Date.now() - lastLoudAt > SILENCE_STOP_MS) {
            stopRecorder(true);
            return;
          }
        }
        if (seconds >= MAX_BODY_SECONDS) stopRecorder(true);
      }, 150);

      try { recorder.start(); } catch { fail("recorder-unavailable"); }
    }).catch(() => fail("mic-denied"));
  });
}

const PHASE_LABEL = {
  starting: "Starting…",
  name: "Who is it for?",
  recording: "Recording…",
  confirming: "Send it?",
  sending: "Delivering…",
  sent: "Sent",
  error: "Didn't send",
};

export default function HandsFreeVoiceMessage({
  open,
  onClose,
  companyId,
  userEmail,
  userName,
  roster = [],
  onDelivered,
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState("starting");
  const [spokenLine, setSpokenLine] = useState("");
  const [heard, setHeard] = useState("");
  const [recipient, setRecipient] = useState(null);
  const [recSecs, setRecSecs] = useState(0);
  const [errorText, setErrorText] = useState("");
  const [pendingClip, setPendingClip] = useState(null);

  const abortRef = useRef(false);
  const runningRef = useRef(false);
  const stopListenRef = useRef(null);
  const stopRecordRef = useRef(null);
  const voiceOwnerRef = useRef(null);
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  const announce = useCallback(async (line) => {
    setSpokenLine(line);
    await speak(line);
  }, []);

  const hardStop = useCallback(() => {
    abortRef.current = true;
    stopSpeaking();
    try { stopListenRef.current?.(); } catch { /* no-op */ }
    stopListenRef.current = null;
    try { stopRecordRef.current?.(false); } catch { /* no-op */ }
    stopRecordRef.current = null;
  }, []);

  const deliverClip = useCallback((target, clip) => deliverVoiceMessage({
    companyId,
    sender: { email: userEmail, name: userName },
    recipient: target,
    clip,
    uploadFile: (file) => base44.integrations.Core.UploadFile({ file }),
  }), [companyId, userEmail, userName]);

  const failLoudly = useCallback(async (line, { keepClip = false } = {}) => {
    if (!keepClip) setPendingClip(null);
    setPhase("error");
    setErrorText(line);
    toast({ title: "Voice message not sent", description: line, variant: "destructive" });
    await speak(line);
  }, [toast]);

  const listen = useCallback((opts = {}) => listenOnce({
    ...opts,
    register: (cancel) => { stopListenRef.current = cancel; },
    onPartial: setHeard,
  }), []);

  // ── Steps ──────────────────────────────────────────────────────────────────
  const resolveRecipient = useCallback(async () => {
    let prompt = "Who should I send this to?";
    let narrowed = null;
    for (let attempt = 1; attempt <= NAME_ATTEMPTS; attempt += 1) {
      setPhase("name");
      setHeard("");
      await announce(prompt);
      if (abortRef.current) return { outcome: "aborted" };

      let utterance = "";
      try {
        utterance = await listen({ timeoutMs: LISTEN_TIMEOUT_MS });
      } catch (err) {
        if (abortRef.current || err.message === "aborted") return { outcome: "aborted" };
        if (err.message === "mic-denied") return { outcome: "mic-denied" };
        if (err.message === "unsupported") return { outcome: "unsupported" };
        prompt = "I didn't hear a name. Say a teammate's first name, or say cancel.";
        continue;
      }
      setHeard(utterance);
      if (classifyConfirmation(utterance) === "cancel") return { outcome: "cancelled" };

      let result = resolveTeammateName(utterance, narrowed || rosterRef.current);
      if (narrowed && result.status !== "match") {
        const wide = resolveTeammateName(utterance, rosterRef.current);
        if (wide.status === "match") result = wide;
      }

      if (result.status === "match") return { outcome: "match", target: result.match };
      if (result.status === "ambiguous") {
        narrowed = result.candidates;
        prompt = `I found more than one match. Did you mean ${describeCandidates(result.candidates)}?`;
        continue;
      }
      narrowed = null;
      prompt = `I don't have a teammate I recognise as "${utterance}". Say the name again, or say cancel.`;
    }
    return { outcome: "no-match" };
  }, [announce, listen]);

  const confirmSend = useCallback(async (target, clip) => {
    for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt += 1) {
      setPhase("confirming");
      setHeard("");
      const line = attempt === 1
        ? `That's a ${clip.seconds} second voice message for ${target.name}. Say send to deliver it, or say cancel.`
        : "I didn't catch that. Say send, or say cancel.";
      await announce(line);
      if (abortRef.current) return "aborted";
      try {
        const utterance = await listen({ timeoutMs: LISTEN_TIMEOUT_MS });
        setHeard(utterance);
        const decision = classifyConfirmation(utterance);
        if (decision !== "unclear") return decision;
      } catch (err) {
        if (abortRef.current || err.message === "aborted") return "aborted";
        if (err.message === "mic-denied") return "mic-denied";
      }
    }
    return "unclear";
  }, [announce, listen]);

  const runFlow = useCallback(async () => {
    if (runningRef.current) return; // synchronous in-flight guard
    runningRef.current = true;
    abortRef.current = false;
    setErrorText("");
    setRecipient(null);
    setPendingClip(null);
    setRecSecs(0);
    setHeard("");

    try {
      if (!isHandsFreeSupported()) {
        await failLoudly("Hands-free messaging needs Chrome, Edge or Safari with microphone access.");
        return;
      }
      if (!companyId || !userEmail) {
        await failLoudly("I couldn't work out which company you're in, so nothing was sent.");
        return;
      }
      if (!rosterRef.current.length) {
        await failLoudly("There are no teammates to send a voice message to yet.");
        return;
      }

      const nameStep = await resolveRecipient();
      if (abortRef.current || nameStep.outcome === "aborted") return;
      if (nameStep.outcome === "cancelled") { await failLoudly("Cancelled. Nothing was sent."); return; }
      if (nameStep.outcome === "mic-denied") { await failLoudly("I can't hear you — microphone access is blocked. Allow the microphone and try again."); return; }
      if (nameStep.outcome === "unsupported") { await failLoudly("This browser can't listen for a name. Use Chrome, Edge or Safari."); return; }
      if (nameStep.outcome !== "match") { await failLoudly("I couldn't work out who that was for, so nothing was sent."); return; }

      const target = nameStep.target;
      setRecipient(target);

      setPhase("recording");
      setRecSecs(0);
      await announce(`Recording your message for ${target.name}. Go ahead — I'll stop when you finish.`);
      if (abortRef.current) return;

      let clip = null;
      try {
        clip = await recordVoiceBody({
          onTick: setRecSecs,
          register: (stop) => { stopRecordRef.current = stop; },
        });
      } catch (err) {
        stopRecordRef.current = null;
        if (abortRef.current) return;
        if (err.message === "mic-denied") { await failLoudly("I couldn't start recording — microphone access is blocked."); return; }
        if (err.message === "cancelled") { await failLoudly(`Recording cancelled. Nothing was sent to ${target.name}.`); return; }
        await failLoudly(`The recording didn't capture any audio, so nothing was sent to ${target.name}.`);
        return;
      }
      stopRecordRef.current = null;
      if (abortRef.current) return;
      setPendingClip(clip);

      const decision = await confirmSend(target, clip);
      if (abortRef.current || decision === "aborted") return;
      if (decision === "cancel") { await failLoudly(`Cancelled. Nothing was sent to ${target.name}.`); return; }
      if (decision !== "confirm") {
        await failLoudly(
          decision === "mic-denied"
            ? `I lost the microphone before you confirmed, so nothing was sent to ${target.name}. Tap Send to deliver it.`
            : `I didn't get a clear answer, so nothing was sent to ${target.name}. Tap Send to deliver it.`,
          { keepClip: true }
        );
        return;
      }

      setPhase("sending");
      try {
        await deliverClip(target, clip);
      } catch (err) {
        await failLoudly(`I couldn't deliver that voice message to ${target.name}. ${err.message}.`, { keepClip: true });
        return;
      }
      setPendingClip(null);
      setPhase("sent");
      onDelivered?.(target);
      await announce(`Sent to ${target.name}.`);
    } finally {
      runningRef.current = false;
    }
  }, [announce, companyId, confirmSend, deliverClip, failLoudly, onDelivered, resolveRecipient, userEmail]);

  // Manual send/retry for the "recorded but not confirmed" and "delivery
  // failed" cases — the clip is never thrown away silently.
  const sendPendingClip = useCallback(async () => {
    if (!pendingClip || !recipient) return;
    setPhase("sending");
    try {
      await deliverClip(recipient, pendingClip);
      setPendingClip(null);
      setPhase("sent");
      onDelivered?.(recipient);
      await announce(`Sent to ${recipient.name}.`);
    } catch (err) {
      await failLoudly(`I couldn't deliver that voice message to ${recipient.name}. ${err.message}.`, { keepClip: true });
    }
  }, [announce, deliverClip, failLoudly, onDelivered, pendingClip, recipient]);

  // Start on open, tear everything down on close/unmount.
  useEffect(() => {
    if (!open) return undefined;
    const owner = acquireLexiVoiceOwner("handsfree_message", { companyId });
    voiceOwnerRef.current = owner;
    // The lock has a short TTL; a long recording would otherwise expire it.
    const stopHeartbeat = startLexiVoiceOwnerHeartbeat(owner.kind, owner.token);
    runFlow();
    return () => {
      hardStop();
      stopHeartbeat();
      releaseLexiVoiceOwner(owner.kind, owner.token);
      voiceOwnerRef.current = null;
      runningRef.current = false;
    };
    // runFlow is intentionally not a dependency: the flow starts once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => { hardStop(); onClose?.(); };

  const listening = phase === "name" || phase === "confirming";
  const busy = phase === "sending";

  return (
    <Dialog open={!!open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent
        className="max-w-md p-0 gap-0 overflow-hidden border-0 bg-slate-900 text-white"
        data-testid="handsfree-voice-dialog"
      >
        <DialogTitle className="sr-only">Hands-free voice message</DialogTitle>
        <div className="flex flex-col items-center text-center px-6 pt-8 pb-6 min-h-[26rem]">
          <div className="text-xs uppercase tracking-widest text-slate-400 font-semibold">
            {PHASE_LABEL[phase] || "Hands-free"}
          </div>

          <div
            className={`mt-6 w-36 h-36 rounded-full flex items-center justify-center transition-colors ${
              phase === "recording" ? "bg-red-500/20 ring-4 ring-red-500 animate-pulse"
                : phase === "sent" ? "bg-emerald-500/20 ring-4 ring-emerald-500"
                : phase === "error" ? "bg-amber-500/20 ring-4 ring-amber-500"
                : listening ? "bg-violet-500/20 ring-4 ring-violet-400 animate-pulse"
                : "bg-slate-700 ring-4 ring-slate-600"
            }`}
            data-testid="handsfree-status-ring"
          >
            {busy ? <Loader2 className="w-14 h-14 animate-spin text-violet-300" />
              : phase === "sent" ? <Check className="w-16 h-16 text-emerald-400" />
              : phase === "error" ? <AlertTriangle className="w-14 h-14 text-amber-400" />
              : phase === "recording" ? <Mic className="w-16 h-16 text-red-400" />
              : <Ear className="w-14 h-14 text-violet-300" />}
          </div>

          {recipient && (
            <div className="mt-5 text-2xl font-bold" data-testid="handsfree-recipient">{recipient.name}</div>
          )}
          {phase === "recording" && (
            <div className="mt-2 text-xl font-mono text-red-300" data-testid="handsfree-timer">
              {`${Math.floor(recSecs / 60)}:${String(recSecs % 60).padStart(2, "0")}`}
            </div>
          )}

          <p className="mt-4 text-base leading-relaxed text-slate-200 min-h-[3.5rem]" data-testid="handsfree-prompt">
            {phase === "error" ? errorText : spokenLine}
          </p>
          {listening && heard && (
            <p className="text-sm text-slate-400 italic" data-testid="handsfree-heard">“{heard}”</p>
          )}

          <div className="mt-auto w-full pt-6 space-y-3">
            {phase === "recording" && (
              <button
                onClick={() => { try { stopRecordRef.current?.(true); } catch { /* no-op */ } }}
                data-testid="handsfree-stop-recording"
                className="w-full min-h-[4rem] rounded-2xl bg-white text-slate-900 text-lg font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Square className="w-5 h-5" />Done speaking
              </button>
            )}
            {pendingClip && recipient && (phase === "error") && (
              <button
                onClick={sendPendingClip}
                data-testid="handsfree-send-pending"
                className="w-full min-h-[4rem] rounded-2xl bg-blue-600 text-white text-lg font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Send className="w-5 h-5" />Send to {recipient.name}
              </button>
            )}
            {(phase === "error" || phase === "sent") && (
              <button
                onClick={() => { hardStop(); runningRef.current = false; runFlow(); }}
                data-testid="handsfree-restart"
                className="w-full min-h-[3.5rem] rounded-2xl bg-slate-700 text-white text-base font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <RotateCcw className="w-5 h-5" />Start over
              </button>
            )}
            <button
              onClick={close}
              data-testid="handsfree-cancel"
              className="w-full min-h-[3.5rem] rounded-2xl border border-slate-600 text-slate-200 text-base font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <X className="w-5 h-5" />{phase === "sent" ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
