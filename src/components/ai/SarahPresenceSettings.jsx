import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Zap, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function SarahPresenceSettings() {
  const [settings, setSettings] = useState({
    response_speed: 'normal',
    background_audio: 'none',
    interim_audio: 'typing',
    personality_assertiveness: 50,
    personality_humor: 20
  });
  const [isLoading, setIsLoading] = useState(true);
  const [lastSaved, setLastSaved] = useState(null);

  const voiceApiUrl = window.location.origin + '/api/sarah-voice';

  useEffect(() => {
    fetch(voiceApiUrl)
      .then(r => r.json())
      .then(data => {
        setSettings(prev => ({
          ...prev,
          response_speed: data.response_speed || 'normal',
          background_audio: data.background_audio || 'none',
          interim_audio: data.interim_audio || 'typing',
          personality_assertiveness: data.personality_assertiveness ?? 50,
          personality_humor: data.personality_humor ?? 20
        }));
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  const updateSetting = async (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    try {
      const res = await fetch(voiceApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      });
      const data = await res.json();
      if (data.success) {
        setLastSaved(key);
        setTimeout(() => setLastSaved(null), 2000);
      }
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save setting.');
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-blue-50 border-blue-200 shadow-sm">
        <CardContent className="p-6 flex items-center justify-center gap-2 text-blue-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading settings...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-blue-50 border-blue-200 shadow-sm" data-testid="card-response-speed">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-600" />
              <Label className="text-lg font-bold text-blue-900">Response Speed & Latency</Label>
              <Badge className="bg-blue-600 text-white">New</Badge>
            </div>
            {lastSaved === 'response_speed' && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Saved
              </span>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4 items-center">
            <div className="space-y-2">
              <Select
                value={settings.response_speed}
                onValueChange={(value) => updateSetting("response_speed", value)}
                data-testid="select-response-speed"
              >
                <SelectTrigger className="bg-white border-blue-300 font-medium" data-testid="select-trigger-response-speed">
                  <SelectValue placeholder="Select speed" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal" data-testid="option-speed-normal">Normal (Balanced - Includes Typing Sounds)</SelectItem>
                  <SelectItem value="fast" data-testid="option-speed-fast">Fast (Reduced Latency - No Sounds)</SelectItem>
                  <SelectItem value="ultra_fast" data-testid="option-speed-ultra">Ultra Fast (Instant - Minimal Memory)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-blue-800">
              {settings.response_speed === 'normal' && (
                <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-green-600" /> Uses typing sounds and full memory. Best for natural feel.</span>
              )}
              {settings.response_speed === 'fast' && (
                <span className="flex items-center gap-1"><Zap className="w-4 h-4 text-yellow-500" /> Skips audio effects to reply faster. Good for efficient calls.</span>
              )}
              {settings.response_speed === 'ultra_fast' && (
                <span className="flex items-center gap-1"><Zap className="w-4 h-4 text-red-500" /> Maximum speed. Skips Knowledge Base and limits memory.</span>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-purple-100 bg-purple-50/30" data-testid="card-presence">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            <CardTitle className="text-base">Presence (Beta)</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Customize the experience to mimic human conversation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* SOFT-HIDDEN: Background Audio and Interim Audio dropdowns - not currently active */}
          {/* 
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Background Audio</Label>
              <Select
                value={settings.background_audio}
                onValueChange={(value) => updateSetting("background_audio", value)}
              >
                <SelectTrigger className="bg-white" data-testid="select-trigger-bg-audio">
                  <SelectValue placeholder="Select ambient noise" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" data-testid="option-bg-none">None (Silent)</SelectItem>
                  <SelectItem value="call_center" data-testid="option-bg-callcenter">Call Center</SelectItem>
                  <SelectItem value="office" data-testid="option-bg-office">Office Environment</SelectItem>
                  <SelectItem value="cafe" data-testid="option-bg-cafe">Coffee Shop</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Subtle background noise to mimic a real environment.
              </p>
              {lastSaved === 'background_audio' && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Saved
                </span>
              )}
            </div>

            <div className="space-y-2">
              <Label>Interim Audio</Label>
              <Select
                value={settings.interim_audio}
                onValueChange={(value) => updateSetting("interim_audio", value)}
              >
                <SelectTrigger className="bg-white" data-testid="select-trigger-interim-audio">
                  <SelectValue placeholder="Select waiting sound" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" data-testid="option-interim-none">None (Silence)</SelectItem>
                  <SelectItem value="typing" data-testid="option-interim-typing">Typing on Keyboard</SelectItem>
                  <SelectItem value="thinking" data-testid="option-interim-thinking">"Hmm..." / Thinking Sounds</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Sound played while AI is generating a response.
                <strong className="text-blue-600 block mt-1">Note: Only audible when Response Speed is set to 'Normal'.</strong>
              </p>
              {lastSaved === 'interim_audio' && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Saved
                </span>
              )}
            </div>
          </div>
          */}

          <div className="space-y-6 pt-4 border-t border-purple-100">
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Label>Assertiveness Level</Label>
                <div className="flex items-center gap-2">
                  {lastSaved === 'personality_assertiveness' && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Saved
                    </span>
                  )}
                  <span className="text-sm text-gray-500" data-testid="text-assertiveness-value">
                    {settings.personality_assertiveness}%
                  </span>
                </div>
              </div>
              <Slider
                value={[settings.personality_assertiveness]}
                max={100}
                step={1}
                onValueChange={(vals) => setSettings(prev => ({ ...prev, personality_assertiveness: vals[0] }))}
                onValueCommit={(vals) => updateSetting("personality_assertiveness", vals[0])}
                className="w-full"
                data-testid="slider-assertiveness"
              />
              <p className="text-xs text-gray-500 flex justify-between flex-wrap gap-1">
                <span>Soft suggestions</span>
                <span>Direct & confident</span>
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Label>Humor Level</Label>
                <div className="flex items-center gap-2">
                  {lastSaved === 'personality_humor' && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Saved
                    </span>
                  )}
                  <span className="text-sm text-gray-500" data-testid="text-humor-value">
                    {settings.personality_humor}%
                  </span>
                </div>
              </div>
              <Slider
                value={[settings.personality_humor]}
                max={100}
                step={1}
                onValueChange={(vals) => setSettings(prev => ({ ...prev, personality_humor: vals[0] }))}
                onValueCommit={(vals) => updateSetting("personality_humor", vals[0])}
                className="w-full"
                data-testid="slider-humor"
              />
              <p className="text-xs text-gray-500 flex justify-between flex-wrap gap-1">
                <span>Serious</span>
                <span>Witty</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
