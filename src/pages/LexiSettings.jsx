import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Save, Volume2, Upload, Loader2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

export default function LexiSettings() {
  const [user, setUser] = useState(null);
  const [voiceId, setVoiceId] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [engine, setEngine] = useState('gemini');
  const [loadedFromDB, setLoadedFromDB] = useState(false);
  const queryClient = useQueryClient();
  const [engineDirty, setEngineDirty] = useState(false);
  const normalizeEngine = (val) => {
    const s = (val || '').toString().toLowerCase();
    if (!s) return 'gemini';
    if (s.includes('openai') || s.includes('gpt')) return 'openai';
    if (s.includes('gemini') || s.includes('flash')) return 'gemini';
    return s === 'openai' || s === 'gemini' ? s : 'gemini';
  };
  // Persist engine per-user to avoid UI flips on refetch
  const engineStorageKey = React.useMemo(() => user?.email ? `lexi_engine_${user.email}` : 'lexi_engine', [user?.email]);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(engineStorageKey) : null;
    if (saved) {
      const canon = normalizeEngine(saved);
      setEngine(canon);
      setLoadedFromDB(true);
    }
  }, [engineStorageKey]);

  // Migrate older generic key to per-user key to prevent flips after auth loads
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const genericKey = 'lexi_engine';
    if (engineStorageKey !== genericKey) {
      const legacy = localStorage.getItem(genericKey);
      if (legacy) {
        const canon = normalizeEngine(legacy);
        try {
          localStorage.setItem(engineStorageKey, canon);
          localStorage.removeItem(genericKey);
        } catch (_) {}
        setEngine(canon);
        setLoadedFromDB(true);
      }
    }
  }, [engineStorageKey]);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
  queryKey: ['staff-profiles', user?.email],
  queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
  enabled: !!user,
  initialData: [],
});

const myCompany = React.useMemo(() => {
  const owned = companies.find(c => c.created_by === user?.email);
  if (owned) return owned;
  const sp = staffProfiles[0];
  if (sp?.company_id) {
    return companies.find(c => c.id === sp.company_id) || companies[0];
  }
  return companies[0];
}, [companies, staffProfiles, user]);

// All company IDs linked to this user (handles duplicates)
const linkedCompanyIds = React.useMemo(() => {
  const ids = new Set();
  companies.forEach(c => { if (c.created_by === user?.email) ids.add(c.id); });
  staffProfiles.forEach(sp => { if (sp?.company_id) ids.add(sp.company_id); });
  return Array.from(ids);
}, [companies, staffProfiles, user?.email]);

  useEffect(() => {
    if (!myCompany) return;
    // Only hydrate from DB once per company load to avoid overwriting user selection
    if (!loadedFromDB && !engineDirty) {
      setVoiceId(myCompany.lexi_voice_id || 'EXAVITQu4vr4xnSDxMaL');
      setSystemPrompt(myCompany.lexi_system_prompt || '');
      setVoiceEnabled(myCompany.lexi_voice_enabled !== false);
      const newEngine = normalizeEngine(myCompany.lexi_engine || 'gemini');
      setEngine(newEngine);
      try { localStorage.setItem(engineStorageKey, newEngine); } catch (_) {}
      setLoadedFromDB(true);
    }
  }, [myCompany, loadedFromDB, engineDirty]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Persist to all linked companies to keep UI and backend in sync
      await Promise.all(
        (linkedCompanyIds?.length ? linkedCompanyIds : [myCompany.id]).map(id =>
          base44.entities.Company.update(id, {
            lexi_voice_id: voiceId,
            lexi_system_prompt: systemPrompt,
            lexi_voice_enabled: voiceEnabled,
            lexi_engine: engine
          })
        )
      );
    },
    onSuccess: () => {
      // Keep the selected engine sticky in UI
      try { localStorage.setItem(engineStorageKey, engine); } catch (_) {}
      setLoadedFromDB(true);
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success('✅ Lexi settings saved!');
    },
    onError: (error) => {
      toast.error('Failed to save: ' + error.message);
    }
  });

  const setEngineMutation = useMutation({
    mutationFn: async (v) => {
      const canon = normalizeEngine(v);
      // Propagate engine to all linked companies to avoid mismatched settings
      await Promise.all(
        (linkedCompanyIds?.length ? linkedCompanyIds : [myCompany.id]).map(id =>
          base44.entities.Company.update(id, { lexi_engine: canon })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success('✅ Engine saved');
      setEngineDirty(true);
    },
    onError: (error) => {
      toast.error('Failed to save engine: ' + error.message);
    }
  });

  // If user changed engine, keep DB in sync against any background flip
  useEffect(() => {
    if (!loadedFromDB || !engineDirty || !myCompany) return;
    const db = normalizeEngine(myCompany.lexi_engine || 'gemini');
    if (db !== engine) {
      setEngineMutation.mutate(engine);
    }
  }, [myCompany?.lexi_engine, loadedFromDB, engineDirty, engine]);

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file) => {
      const response = await base44.integrations.Core.UploadFile({ file });
      return response.file_url;
    },
    onSuccess: async (avatarUrl) => {
      await base44.entities.Company.update(myCompany.id, {
        lexi_avatar_url: avatarUrl
      });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success('✅ Avatar updated!');
    },
    onError: (error) => {
      toast.error('Failed to upload: ' + error.message);
    }
  });

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    setUploadingAvatar(true);
    try {
      await uploadAvatarMutation.mutateAsync(file);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const testVoice = async () => {
    try {
      toast.info('🔊 Testing voice...');
      
      const response = await base44.functions.invoke('elevenLabsSpeak', {
        text: "Hi! I'm Lexi, your AI assistant. This is how I sound with the selected voice.",
        voiceId: voiceId
      });

      console.log('📥 Response:', response);
      console.log('📥 Response.data type:', response.data?.constructor?.name);

      // Handle error response from backend
      if (response.data?.error || response.data?.fallback) {
        throw new Error(response.data.error || 'ElevenLabs API unavailable. Please check your API key in Settings → Environment Variables.');
      }

      // Handle all possible formats (binary, data URL, or audio_url JSON)
      let audioBlob;

      // New: backend may return { audio_url } JSON
      if (response.data && typeof response.data === 'object' && response.data.audio_url) {
        const res = await fetch(response.data.audio_url);
        audioBlob = await res.blob();
      } else if (response.data instanceof Blob) {
        audioBlob = response.data;
      } else if (response.data instanceof ArrayBuffer) {
        audioBlob = new Blob([response.data], { type: 'audio/mpeg' });
      } else if (response.data instanceof Uint8Array) {
        audioBlob = new Blob([response.data], { type: 'audio/mpeg' });
      } else if (typeof response.data === 'string' && response.data.startsWith('data:')) {
        // Handle base64 data URL
        const res = await fetch(response.data);
        audioBlob = await res.blob();
      } else {
        console.error('❌ Unexpected data format:', typeof response.data, response.data);
        throw new Error('Received invalid audio format. The API key might be incorrect or expired.');
      }

      console.log('✅ Audio blob:', audioBlob.size, 'bytes, type:', audioBlob.type);

      if (audioBlob.size === 0) {
        throw new Error('Received empty audio. Please verify your ELEVENLABS_API_KEY is correct.');
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onerror = (e) => {
        console.error('Playback error:', e);
        toast.error('Audio file corrupted. Please check your ElevenLabs API key.');
      };
      
      await audio.play();
      toast.success('✅ Voice preview played!');

    } catch (error) {
      console.error('❌ Test voice error:', error);
      toast.error(error.message || 'Failed to generate voice. Check console for details.');
    }
  };

  const elevenLabsVoices = [
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Young, energetic, friendly)' },
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Professional, clear)' },
    { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda (Calm, friendly)' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Sparkles className="w-8 h-8 text-purple-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Lexi Settings</h1>
            <p className="text-gray-500 mt-1">Customize Lexi's voice and personality</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Avatar</CardTitle>
            <CardDescription>Upload a custom avatar for Lexi</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-6">
              <img 
                src={myCompany?.lexi_avatar_url || "https://api.dicebear.com/7.x/bottts/svg?seed=lexi&backgroundColor=b6e3f4"} 
                alt="Lexi Avatar"
                className="w-24 h-24 rounded-full object-cover border-4 border-purple-200"
              />
              <div className="flex-1">
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                <label htmlFor="avatar-upload">
                  <Button 
                    type="button" 
                    variant="outline" 
                    asChild
                    disabled={uploadingAvatar}
                  >
                    <span className="cursor-pointer flex items-center gap-2">
                      {uploadingAvatar ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          Upload New Avatar
                        </>
                      )}
                    </span>
                  </Button>
                </label>
                <p className="text-xs text-gray-500 mt-2">
                  Recommended: Square image, 500x500px or larger
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
         <CardHeader>
           <CardTitle>AI Engine (Beta)</CardTitle>
           <CardDescription>Choose the model Lexi uses for conversations</CardDescription>
         </CardHeader>
         <CardContent className="space-y-4">
           <div>
             <Label>Engine</Label>
             <Select value={engine} onValueChange={(v) => { const canon = normalizeEngine(v); setEngine(canon); setEngineDirty(true); setLoadedFromDB(true); try { localStorage.setItem(engineStorageKey, canon); } catch (_) {} if (myCompany?.id) setEngineMutation.mutate(canon); }}>
               <SelectTrigger className="w-full mt-2">
                 <SelectValue placeholder="Select engine" />
               </SelectTrigger>
               <SelectContent>
                 <SelectItem value="gemini">Gemini 2.5 Flash (default)</SelectItem>
                 <SelectItem value="openai">OpenAI (GPT‑4o)</SelectItem>
               </SelectContent>
             </Select>
             <p className="text-xs text-gray-500 mt-2">
               Gemini enables low-latency voice and better realtime performance. You can switch back instantly if needed.
             </p>
           </div>
         </CardContent>
        </Card>

        <Card>
         <CardHeader>
           <CardTitle>Live (Real‑time) — Beta</CardTitle>
           <CardDescription>Enable Gemini Multimodal Live API for push‑to‑talk voice</CardDescription>
         </CardHeader>
         <CardContent className="space-y-3">
           <p className="text-sm text-gray-600">We’ll use short‑lived tokens so the browser can open a secure WebSocket directly to Gemini.</p>
           <Button
             variant="outline"
             className="w-full"
             onClick={async () => {
               try {
                 const { data } = await base44.functions.invoke('createGeminiEphemeralToken', {});
                 if (!data?.token) throw new Error(data?.error || 'Failed to create token');
                 console.log('Ephemeral token created:', data);
                 toast.success('✅ Live token ready (expires soon)');
               } catch (e) {
                 toast.error('Live token failed: ' + (e?.message || 'Unknown error'));
               }
             }}
           >
             <Sparkles className="w-4 h-4 mr-2" /> Test Live Token
           </Button>
           <p className="text-xs text-gray-500">Next: we’ll wire a mic streamer to use this token for real‑time voice.</p>
         </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Voice Settings</CardTitle>
            <CardDescription>Choose Lexi's voice from ElevenLabs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                {voiceEnabled ? (
                  <Volume2 className="w-5 h-5 text-purple-600" />
                ) : (
                  <VolumeX className="w-5 h-5 text-gray-400" />
                )}
                <div>
                  <Label className="text-base font-semibold">Enable Voice Responses</Label>
                  <p className="text-sm text-gray-500 mt-1">
                    {voiceEnabled ? "Lexi will respond with voice audio" : "Lexi will respond with text only"}
                  </p>
                </div>
              </div>
              <Switch
                checked={voiceEnabled}
                onCheckedChange={setVoiceEnabled}
              />
            </div>

            {voiceEnabled && (
              <>
                <div>
                  <Label>Voice</Label>
                  <Select value={voiceId} onValueChange={setVoiceId}>
                    <SelectTrigger className="w-full mt-2">
                      <SelectValue placeholder="Select a voice" />
                    </SelectTrigger>
                    <SelectContent>
                      {elevenLabsVoices.map(voice => (
                        <SelectItem key={voice.id} value={voice.id}>
                          {voice.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  onClick={testVoice}
                  variant="outline"
                  className="w-full"
                >
                  <Volume2 className="w-4 h-4 mr-2" />
                  Test Voice
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Personality & Behavior</CardTitle>
            <CardDescription>Customize Lexi's system prompt (optional - leave blank for default)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>System Prompt</Label>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are Lexi, a helpful AI assistant for a roofing/contracting CRM..."
                rows={8}
                className="mt-2 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-2">
                Define how Lexi should behave, her tone, and priorities. Leave blank to use the default prompt.
              </p>
            </div>

            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-blue-800 text-sm">
                💡 <strong>Tips:</strong> Be specific about tone (friendly, professional, casual), response style (concise, detailed), 
                and any industry-specific knowledge she should prioritize.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}