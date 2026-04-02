import React, { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Volume2, AlertCircle, Loader2, CheckCircle2, Play, Square } from "lucide-react";
import { toast } from "sonner";

const VOICE_OPTIONS = [
  { id: 'Aoede',  label: 'Aoede — Warm, Clear ♀',       description: 'Female — gentle and natural', gender: 'female' },
  { id: 'Kore',   label: 'Kore — Bright, Energetic ♀',  description: 'Female — lively and upbeat', gender: 'female' },
  { id: 'Leda',   label: 'Leda — Soft, Soothing ♀',     description: 'Female — calm and reassuring', gender: 'female' },
  { id: 'Zephyr', label: 'Zephyr — Calm, Breezy ♀',     description: 'Female — modern and relaxed', gender: 'female' },
  { id: 'Charon', label: 'Charon — Informational ♂',    description: 'Male — clear and authoritative', gender: 'male' },
  { id: 'Fenrir', label: 'Fenrir — Excitable, Bold ♂',  description: 'Male — energetic and enthusiastic', gender: 'male' },
  { id: 'Orus',   label: 'Orus — Firm, Steady ♂',       description: 'Male — steady and confident', gender: 'male' },
  { id: 'Puck',   label: 'Puck — Upbeat, Playful ♂',    description: 'Male — friendly and playful', gender: 'male' },
];

export default function SarahVoiceSettings() {
  const [currentVoice, setCurrentVoice] = useState('Kore');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingVoice, setTestingVoice] = useState(null);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  const REPLIT_SERVER = window.location.origin;
  const voiceApiUrl = REPLIT_SERVER + '/api/sarah-voice';
  const previewApiUrl = REPLIT_SERVER + '/api/sarah-voice-preview';

  React.useEffect(() => {
    fetch(voiceApiUrl)
      .then(r => r.json())
      .then(data => {
        if (data.voice) setCurrentVoice(data.voice);
        setIsLoading(false);
      })
      .catch((err) => {
        console.warn('Could not load voice settings from local API:', err.message);
        setIsLoading(false);
      });
  }, []);

  const handleVoiceChange = async (voiceId) => {
    setCurrentVoice(voiceId);
    setSaved(false);
    setIsSaving(true);
    setError(null);
    try {
      const companyId = sessionStorage.getItem('impersonating_company_id') || localStorage.getItem('last_used_company_id') || '';
      const res = await fetch(voiceApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voiceId, company_id: companyId })
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        toast.success(`Voice changed to ${VOICE_OPTIONS.find(v => v.id === voiceId)?.label}. New calls will use this voice.`);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError('Failed to save voice setting.');
        toast.error('Failed to save voice setting.');
      }
    } catch (err) {
      console.error('Voice save error:', err);
      setError('Failed to save voice. Please try again.');
      toast.error('Failed to save voice. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestVoice = async (voiceId) => {
    if (testingVoice === voiceId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setTestingVoice(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setTestingVoice(voiceId);

    const testPhrases = [
      "Say in a friendly, professional tone: Hi there! This is your AI assistant calling from the roofing company. How can I help you today?",
      "Say warmly and helpfully: Thanks for calling! I'd be happy to schedule a free roof inspection for you. What's a good time?",
      "Say in a caring, professional manner: I see you recently reached out about storm damage. I wanted to follow up and see how we can help.",
    ];
    const phrase = testPhrases[Math.floor(Math.random() * testPhrases.length)];

    try {
      const res = await fetch(previewApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voiceId, text: phrase })
      });

      if (!res.ok) {
        let errMsg = `Preview failed (${res.status})`;
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      const audioBlob = await res.blob();
      const url = URL.createObjectURL(audioBlob);

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setTestingVoice(null);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setTestingVoice(null);
        URL.revokeObjectURL(url);
        audioRef.current = null;
        toast.error('Failed to play audio preview.');
      };
      await audio.play();
    } catch (e) {
      console.error('Voice preview error:', e);
      setTestingVoice(null);
      toast.error(`Voice preview failed: ${e.message}`);
    }
  };

  const selectedVoice = VOICE_OPTIONS.find(v => v.id === currentVoice);

  return (
    <Card data-testid="card-voice-settings">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-blue-600" />
          <div>
            <CardTitle>Sarah's Voice</CardTitle>
            <CardDescription>Choose the Gemini AI voice for incoming and outgoing calls</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="voice-select" className="text-sm font-medium mb-2 block">
            Voice Selection
          </Label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2" data-testid="text-voice-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading voice settings...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={currentVoice} onValueChange={handleVoiceChange} disabled={isSaving}>
                <SelectTrigger id="voice-select" data-testid="select-voice" className="flex-1">
                  <SelectValue placeholder="Select a voice..." />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_OPTIONS.map((voice) => (
                    <SelectItem key={voice.id} value={voice.id} data-testid={`option-voice-${voice.id}`}>
                      {voice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* SOFT-HIDDEN: Play preview button - not currently functional */}
            </div>
          )}
          {isSaving && (
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-1" data-testid="text-voice-saving">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving...
            </p>
          )}
          {saved && (
            <p className="text-sm text-green-600 mt-1 flex items-center gap-1" data-testid="text-voice-saved">
              <CheckCircle2 className="w-3 h-3" /> Saved! New calls will use this voice.
            </p>
          )}
          {error && (
            <p className="text-sm text-red-600 mt-1" data-testid="text-voice-error">
              {error}
            </p>
          )}
        </div>

        {selectedVoice && (
          <Alert className="bg-blue-50 border-blue-200">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-900 text-sm">
              Active voice: <strong>{selectedVoice.label}</strong> — {selectedVoice.description}
            </AlertDescription>
          </Alert>
        )}

        <Alert className="bg-green-50 border-green-200">
          <Volume2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-900 text-sm">
            Voice changes take effect on the next call. Your callers will hear the selected Gemini AI voice.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
