import React, { useState, useRef, useEffect } from "react";
import { Mic, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

const LS_KEY = "voiceNote_cleanupMode";

const SUPPORTED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of SUPPORTED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

const CLEANUP_PROMPT = (raw, section) => {
  const ctx = section ? ` for the "${section}" section` : "";
  return `You are a professional roofing damage documentation assistant. Rewrite the following raw voice note${ctx} as clean, professional scope-of-work bullet points suitable for an insurance claim. Preserve every detail, location, and quantity mentioned. Do not add anything not mentioned.\n\nRaw note: "${raw}"\n\nReturn only the formatted bullet points with no preamble.`;
};

export default function VoiceNoteButton({
  onResult,
  label = "Dictate",
  section = "",
  cleanupMode: defaultCleanupMode = true,
  size = "sm",
  className = "",
  storageKey = LS_KEY,
}) {
  const [phase, setPhase] = useState("idle"); // idle | recording | transcribing | formatting
  const [cleanupMode, setCleanupMode] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return stored === "true";
    } catch (_) {}
    return defaultCleanupMode;
  });
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeTypeRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(cleanupMode));
    } catch (_) {}
  }, [cleanupMode, storageKey]);

  const supported = getSupportedMimeType() !== null;
  if (!supported) return null;

  const stopRecording = () => {
    try {
      mediaRecorderRef.current?.stop();
    } catch (_) {}
  };

  const startRecording = async () => {
    const mimeType = getSupportedMimeType();
    if (!mimeType) return;
    mimeTypeRef.current = mimeType;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      alert("Microphone access denied. Please allow microphone permissions and try again.");
      return;
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
      if (blob.size < 100) {
        setPhase("idle");
        return;
      }

      // Phase 1: transcription
      setPhase("transcribing");

      let rawTranscript = "";
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        const result = await base44.functions.invoke("transcribeVoiceNote", {
          audioData: base64,
          mimeType: mimeTypeRef.current.split(";")[0],
          cleanupMode: false, // raw transcription only in this call
          section,
        });

        rawTranscript = result?.data?.text || result?.text || "";
      } catch (err) {
        console.error("[VoiceNoteButton] transcription error:", err);
        alert("Transcription failed. Please try again.");
        setPhase("idle");
        return;
      }

      if (!rawTranscript) {
        setPhase("idle");
        return;
      }

      if (!cleanupMode) {
        onResult(rawTranscript);
        setPhase("idle");
        return;
      }

      // Phase 2: AI cleanup/formatting
      setPhase("formatting");

      try {
        const resp = await base44.integrations.Core.InvokeLLM({
          prompt: CLEANUP_PROMPT(rawTranscript, section),
        });
        const formatted = resp?.result?.trim() || rawTranscript;
        onResult(formatted);
      } catch (_) {
        // Fall back to raw transcript if formatting fails
        onResult(rawTranscript);
      } finally {
        setPhase("idle");
      }
    };

    recorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop());
      setPhase("idle");
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setPhase("recording");

    setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 90000);
  };

  if (phase === "transcribing") {
    return (
      <div className="flex items-center gap-1">
        <Button
          size={size}
          variant="outline"
          disabled
          className={`text-blue-700 border-blue-300 ${className}`}
          type="button"
          data-testid="button-voice-transcribing"
        >
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          Transcribing…
        </Button>
      </div>
    );
  }

  if (phase === "formatting") {
    return (
      <div className="flex items-center gap-1">
        <Button
          size={size}
          variant="outline"
          disabled
          className={`text-purple-700 border-purple-300 ${className}`}
          type="button"
          data-testid="button-voice-formatting"
        >
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          Formatting…
        </Button>
      </div>
    );
  }

  const isRecording = phase === "recording";

  return (
    <div className="flex items-center gap-1">
      <Button
        size={size}
        variant="outline"
        onClick={isRecording ? stopRecording : startRecording}
        className={
          isRecording
            ? `border-red-400 text-red-600 bg-red-50 ${className}`
            : className
        }
        type="button"
        data-testid="button-voice-note"
        title={
          isRecording
            ? "Tap to stop and transcribe"
            : cleanupMode
            ? "Record voice note — AI transcribes and formats as damage notes"
            : "Record voice note — AI transcribes (raw)"
        }
      >
        <Mic
          className={`w-4 h-4 mr-1 ${isRecording ? "animate-pulse text-red-500" : ""}`}
        />
        {isRecording ? "Stop" : label}
      </Button>

      <div
        className="flex items-center rounded border border-gray-200 bg-gray-100 text-xs font-medium overflow-hidden"
        title={cleanupMode ? "AI cleanup ON — click Raw to switch" : "Raw mode — click AI to enable cleanup"}
        data-testid="voice-cleanup-mode-toggle"
      >
        <button
          type="button"
          onClick={() => setCleanupMode(false)}
          data-testid="button-voice-mode-raw"
          className={`px-2 py-0.5 transition-colors ${
            !cleanupMode
              ? "bg-white text-gray-800 shadow-sm"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          Raw
        </button>
        <button
          type="button"
          onClick={() => setCleanupMode(true)}
          data-testid="button-voice-mode-ai"
          className={`px-2 py-0.5 transition-colors ${
            cleanupMode
              ? "bg-white text-purple-700 shadow-sm"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          AI
        </button>
      </div>
    </div>
  );
}
