import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
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

export default function SarahVoiceSettings({ companyId }) {
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingVoice, setTestingVoice] = useState(null);
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['sarah-voice-settings', companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const results = await base44.entities.AssistantSettings.filter({
        company_id: companyId,
        assistant_name: 'sarah'
      });
      return results[0] || null;
    },
    enabled: !!companyId,
    retry: 2,
    retryDelay: 1000
  });

  const currentVoice = settings?.voice_id || 'Kore';

  const handleVoiceChange = async (voiceId) => {
    if (!companyId) {
      toast.info('Voice selected. It will be saved once your account loads.');
      return;
    }

    setIsSaving(true);
    setSaved(false);
    try {
      if (settings?.id) {
        await base44.entities.AssistantSettings.update(settings.id, {
          voice_id: voiceId
        });
      } else {
        await base44.entities.AssistantSettings.create({
          company_id: companyId,
          assistant_name: 'sarah',
          voice_id: voiceId
        });
      }

      setSaved(true);
      toast.success(`Voice changed to ${VOICE_OPTIONS.find(v => v.id === voiceId)?.label}. New calls will use this voice.`);
      await queryClient.invalidateQueries({ queryKey: ['sarah-voice-settings', companyId] });
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Voice save error:', err);
      toast.error('Failed to save voice. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestVoice = (voiceId) => {
    if (testingVoice === voiceId) {
      window.speechSynthesis.cancel();
      setTestingVoice(null);
      return;
    }

    window.speechSynthesis.cancel();
    setTestingVoice(voiceId);

    const voice = VOICE_OPTIONS.find(v => v.id === voiceId);
    const testPhrases = [
      `Hi there! This is your AI assistant calling from the roofing company. How can I help you today?`,
      `Thanks for calling! I'd be happy to schedule a free roof inspection for you. What's a good time?`,
      `I see you recently reached out about storm damage. I wanted to follow up and see how we can help.`,
    ];
    const phrase = testPhrases[Math.floor(Math.random() * testPhrases.length)];

    const utterance = new SpeechSynthesisUtterance(phrase);
    
    const voices = window.speechSynthesis.getVoices();
    const genderPref = voice?.gender || 'female';
    const langVoices = voices.filter(v => v.lang.startsWith('en'));
    
    const femaleVoice = langVoices.find(v => /female|samantha|karen|victoria|zira/i.test(v.name));
    if (femaleVoice) utterance.voice = femaleVoice;

    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    
    utterance.onend = () => setTestingVoice(null);
    utterance.onerror = () => setTestingVoice(null);
    
    window.speechSynthesis.speak(utterance);
  };

  const selectedVoice = VOICE_OPTIONS.find(v => v.id === currentVoice);

  return (
    <Card data-testid="card-voice-settings">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-blue-600" />
          <div>
            <CardTitle>Sarah's Voice</CardTitle>
            <CardDescription>Choose the voice for incoming and outgoing calls</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="voice-select" className="text-sm font-medium mb-2 block">
            Voice Selection
          </Label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
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
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleTestVoice(currentVoice)}
                disabled={isSaving}
                data-testid="button-test-voice"
              >
                {testingVoice === currentVoice ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
            </div>
          )}
          {isSaving && (
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving...
            </p>
          )}
          {saved && (
            <p className="text-sm text-green-600 mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Saved! New calls will use this voice.
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

        <Alert className="bg-amber-50 border-amber-200">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-900 text-sm">
            Voice changes take effect on the next incoming call. Current active calls are not affected.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
