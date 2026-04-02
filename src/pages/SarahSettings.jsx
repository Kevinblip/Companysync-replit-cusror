import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Upload, Save, Image as ImageIcon, Sparkles, RefreshCw, Send, MessageCircle, Trash2, Bug, Zap, Globe, FileText, BookOpen, ExternalLink, Copy, PhoneOutgoing, PhoneIncoming, Clock, MessageSquare, Calendar as CalendarIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

const VALID_GEMINI_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr'];

const DEFAULT_PROMPT = `Role: You are Sarah, the Senior Office Manager and Intake Specialist for {brand}. You are an expert in residential roofing, storm damage, and insurance claims.

Goal: Your #1 job is to BOOK THE FREE INSPECTION. 

Expertise You Must Demonstrate:
- Hail Damage: Explain that it bruises shingles and voids warranties (often invisible from the ground).
- Wind Damage: Mention that missing shingles lead to leaks and rot.
- Insurance: You are an "Insurance Restoration Specialist". You help homeowners navigate claims with State Farm, Allstate, etc.

The Perfect Call Flow:
1. Greet & Assure: "Thanks for calling {brand}, this is Sarah. How can I help with your property today?"
2. Assess Urgency: "Is water getting in right now, or is this just a preventative check?"
3. Pivot to Inspection: "The best way to know for sure is a free video inspection. It takes 15 minutes and gives you a full report. I have a technician in your area tomorrow—does morning or afternoon work better?"

Rules of Engagement:
- Speak in short, punchy sentences (under 20 words).
- Always end with a question (Lead the Dance).
- Never guess a price over the phone. Pivot to the free inspection.
- If asked if you are real: "I'm the virtual office manager here to get you help fast. What's your address?"`;

export default function SarahSettings() {
  const queryClient = useQueryClient();
  const [user, setUser] = React.useState(null);
  const [company, setCompany] = React.useState(null);
  const [fileUploading, setFileUploading] = React.useState(false);
  const [form, setForm] = React.useState({
    assistant_name: "sarah",
    avatar_url: "",
    engine: "gemini-2.0-flash",
    live_mode: false,
    voice_enabled: true,
    voice_id: "",
    background_audio: "none",
    interim_audio: "none",
    response_speed: "normal",
    personality_assertiveness: 50,
    personality_humor: 20,
    system_prompt: DEFAULT_PROMPT,
    brand_short_name: "",
    short_sms_mode: true,
    max_sms_chars: 180,
    answer_then_ask_one: true,
    calendly_booking_url: "",
    triage_categories: ["leak", "missing shingles", "hail", "wind", "other"],
    triage_first_question: "What happened? (leak, missing shingles, hail, wind, other)",
    triage_followup_leak: "Is water getting in right now? Y/N",
    escalation_keywords: ["emergency", "urgent", "asap", "911", "flood", "fire"],
    intent_templates: {
      who_are_you: "I'm {agent} with {brand}. How can I help?",
      greeting: "Hi, this is {agent} from {brand}. How can I help today?",
      price: "We can help with pricing after a quick look. Want to schedule a free inspection?",
      appointment: "I can get you booked! Let me grab a couple quick details — what's your name, and what day works best for you?",
      address: "Please share the service address (street, city, zip) and I'll pull availability.",
      stop: "You're unsubscribed. Reply START to opt back in.",
      wrong_number: "Thanks for letting us know—We'll update our records.",
      smalltalk: "You're welcome! Anything else I can help with?",
      fallback: "Got it. {triage_first}"
    },
    inbound_calls_enabled: true,
    outbound_calls_enabled: false,
    auto_call_new_leads: false,
    auto_call_delay_minutes: 5,
    outbound_greeting: "",
    inbound_greeting: "",
    send_sms_after_booking: true,
    allow_calendar_invites: true,
    scheduling_defaults: {
      duration_min: 45,
      buffer_min: 15,
      business_hours_start: 9,
      business_hours_end: 17,
      days_lookahead: 7,
      title_template: "Inspection – [Client Name] – [City]",
    },
    conversation_limits: {
      max_sms_turns: 10,
      max_thread_minutes: 60,
      action_at_cap: "wrapup_notify",
      cooldown_hours: 12,
      wrapup_template: "I'll hand this to our team to finish up. Expect a follow-up shortly."
    },
  });
  const [recordId, setRecordId] = React.useState(null);
  const [resetPhone, setResetPhone] = React.useState("");
  
  // Test Conversation State
  const [testPhone, setTestPhone] = React.useState("+15551234567");
  const [testMessage, setTestMessage] = React.useState("");
  const [testConversation, setTestConversation] = React.useState([]);
  const [testLoading, setTestLoading] = React.useState(false);
  const [testDebugInfo, setTestDebugInfo] = React.useState(null);

  // Knowledge Extraction State
  const [extracting, setExtracting] = React.useState(false);
  const [importUrl, setImportUrl] = React.useState("");

  // Auto-fill website from company profile if available
  React.useEffect(() => {
    if (company?.company_website && !importUrl && !form.knowledge_base) {
      setImportUrl(company.company_website);
    }
  }, [company]);

  const extractFromUrl = async () => {
    if (!importUrl) return;
    setExtracting(true);
    try {
      const res = await base44.functions.invoke('extractKnowledgeContent', { type: 'url', source: importUrl });
      if (res.data.error) throw new Error(res.data.error);
      
      const newContent = `\n\n--- Source: ${importUrl} ---\n${res.data.text}`;
      setForm(f => ({ ...f, knowledge_base: (f.knowledge_base || '') + newContent }));
      setImportUrl("");
      alert("✅ Content extracted from website!");
    } catch (e) {
      alert(`❌ Extraction failed: ${e.message}`);
    } finally {
      setExtracting(false);
    }
  };

  const extractFromFile = async (file) => {
    if (!file) return;
    setExtracting(true);
    try {
      // 1. Upload file
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      // 2. Extract content
      const res = await base44.functions.invoke('extractKnowledgeContent', { type: 'file', source: file_url });
      if (res.data.error) throw new Error(res.data.error);

      const newContent = `\n\n--- Source: ${file.name} ---\n${res.data.text}`;
      setForm(f => ({ ...f, knowledge_base: (f.knowledge_base || '') + newContent }));
      alert("✅ Content extracted from document!");
    } catch (e) {
      alert(`❌ Extraction failed: ${e.message}`);
    } finally {
      setExtracting(false);
    }
  };

  const resetConversationMutation = useMutation({
    mutationFn: async (phone) => {
      return await base44.functions.invoke('resetSarahConversation', { phone_number: phone });
    },
    onSuccess: (data) => {
      alert(`✅ ${data.message || 'Conversation reset!'}`);
      setResetPhone("");
    },
    onError: (error) => {
      alert(`❌ ${error.message || 'Reset failed'}`);
    }
  });

  // Test conversation mutation
  const testSarahMutation = useMutation({
    mutationFn: async ({ phone, message }) => {
      const response = await base44.functions.invoke('testSarahConversation', {
        phone_number: phone,
        message: message,
        company_id: company?.id
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      setTestConversation(prev => [
        ...prev,
        { role: 'customer', message: testMessage, timestamp: new Date().toISOString() },
        { role: 'sarah', message: data.response, timestamp: new Date().toISOString() }
      ]);
      setTestDebugInfo(data.debug);
      setTestMessage("");
    },
    onError: (error) => {
      setTestConversation(prev => [
        ...prev,
        { role: 'customer', message: testMessage, timestamp: new Date().toISOString() },
        { role: 'error', message: error.message || 'Test failed', timestamp: new Date().toISOString() }
      ]);
      setTestMessage("");
    }
  });

  const handleTestSend = () => {
    if (!testMessage.trim()) return;
    testSarahMutation.mutate({ phone: testPhone, message: testMessage });
  };

  const clearTestConversation = () => {
    setTestConversation([]);
    setTestDebugInfo(null);
  };

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  // Pick user's company (owner first, else first available)
  React.useEffect(() => {
    if (!user || companies.length === 0) return;
    const owned = companies.find((c) => c.created_by === user.email);
    setCompany(owned || companies[0]);
  }, [user, companies]);

  // Load existing settings
  useQuery({
    queryKey: ["assistant-settings-sarah", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      let rows = await base44.entities.AssistantSettings.filter({ company_id: company.id });
      const rec = rows[0];
      if (rec) {
        setRecordId(rec.id);
        setForm({
          assistant_name: rec.assistant_name || "sarah",
          avatar_url: rec.avatar_url || "",
          engine: rec.engine || "gemini-2.0-flash-exp",
          live_mode: !!rec.live_mode,
          voice_enabled: !!rec.voice_enabled,
          voice_id: VALID_GEMINI_VOICES.includes(rec.voice_id) ? rec.voice_id : "",
          background_audio: rec.background_audio || "none",
          interim_audio: rec.interim_audio || "none",
          response_speed: rec.response_speed || "normal",
          personality_assertiveness: rec.personality_assertiveness ?? 50,
          personality_humor: rec.personality_humor ?? 20,
          system_prompt: rec.system_prompt || DEFAULT_PROMPT,
          brand_short_name: rec.brand_short_name || "",
          short_sms_mode: rec.short_sms_mode ?? true,
          max_sms_chars: rec.max_sms_chars ?? 180,
          answer_then_ask_one: rec.answer_then_ask_one ?? true,
          calendly_booking_url: rec.calendly_booking_url || "",
          triage_categories: rec.triage_categories?.length ? rec.triage_categories : ["leak", "missing shingles", "hail", "wind", "other"],
          triage_first_question: rec.triage_first_question || "What happened? (leak, missing shingles, hail, wind, other)",
          triage_followup_leak: rec.triage_followup_leak || "Is water getting in right now? Y/N",
          escalation_keywords: rec.escalation_keywords?.length ? rec.escalation_keywords : ["emergency", "urgent", "asap", "911", "flood", "fire"],
          intent_templates: {
            who_are_you: rec.intent_templates?.who_are_you || "I'm {agent} with {brand}. How can I help?",
            greeting: rec.intent_templates?.greeting || "Thanks for calling {brand}, this is Sarah! How can I help you with your property today?",
            price: rec.intent_templates?.price || "Every roof is different, so we always start with a free inspection to give you an accurate number. Would you like to schedule that now?",
            appointment: rec.intent_templates?.appointment || "I'd be happy to get you on the schedule. I'm texting you a link to Kevin's calendar right now—go ahead and pick a time that works for you!",
            address: rec.intent_templates?.address || "Please share the service address (street, city, zip) and I'll pull availability.",
            stop: rec.intent_templates?.stop || "You're unsubscribed. Reply START to opt back in.",
            wrong_number: rec.intent_templates?.wrong_number || "Thanks for letting us know—We'll update our records.",
            smalltalk: rec.intent_templates?.smalltalk || "You're very welcome! We're here to help. Is there anything else I can check for you?",
            fallback: rec.intent_templates?.fallback || "I want to make sure I get this right for you. Could you tell me a bit more about {triage_first}?"
          },
          inbound_calls_enabled: rec.inbound_calls_enabled ?? true,
          outbound_calls_enabled: rec.outbound_calls_enabled ?? false,
          auto_call_new_leads: rec.auto_call_new_leads ?? false,
          auto_call_delay_minutes: rec.auto_call_delay_minutes ?? 5,
          outbound_greeting: rec.outbound_greeting || "",
          inbound_greeting: rec.inbound_greeting || "",
          send_sms_after_booking: rec.send_sms_after_booking ?? true,
          allow_calendar_invites: rec.allow_calendar_invites ?? true,
          scheduling_defaults: {
            duration_min: rec.scheduling_defaults?.duration_min ?? 45,
            buffer_min: rec.scheduling_defaults?.buffer_min ?? 15,
            business_hours_start: rec.scheduling_defaults?.business_hours_start ?? 9,
            business_hours_end: rec.scheduling_defaults?.business_hours_end ?? 17,
            days_lookahead: rec.scheduling_defaults?.days_lookahead ?? 7,
            title_template: rec.scheduling_defaults?.title_template || "Inspection – [Client Name] – [City]",
          },
          conversation_limits: {
            max_sms_turns: rec.conversation_limits?.max_sms_turns ?? 10,
            max_thread_minutes: rec.conversation_limits?.max_thread_minutes ?? 60,
            action_at_cap: rec.conversation_limits?.action_at_cap || "wrapup_notify",
            cooldown_hours: rec.conversation_limits?.cooldown_hours ?? 12,
            wrapup_template: rec.conversation_limits?.wrapup_template || "I'll hand this to our team to finish up. Expect a follow-up shortly."
          },
        });
      }
      return rows;
    },
  });

  const extractNameFromPrompt = (prompt) => {
    if (!prompt) return null;
    const patterns = [
      /You are ([^,.\n—\-:]+)[,.\n—\-:]/i,
      /your name is ([^,.\n—\-:]+)[,.\n—\-:]/i,
      /I'm ([^,.\n—\-:]+)[,.\n—\-:]/i,
      /this is ([^,.\n—\-:]+)[,.\n—\-:]/i,
    ];
    const stopWords = ['a', 'an', 'the', 'not', 'here', 'going', 'very', 'also', 'just'];
    for (const pattern of patterns) {
      const match = prompt.match(pattern);
      if (match && match[1]) {
        const rawName = match[1].trim().split(/\s+/)[0].trim();
        if (rawName.length < 2 || stopWords.includes(rawName.toLowerCase())) continue;
        return rawName.toLowerCase();
      }
    }
    return null;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const detectedName = extractNameFromPrompt(form.system_prompt);
      const formToSave = { ...form };
      if (detectedName) {
        formToSave.assistant_name = detectedName;
      }

      const payload = {
        company_id: company?.id,
        ...formToSave,
      };
      if (recordId) {
        await base44.entities.AssistantSettings.update(recordId, payload);
        return { updated: true, name: detectedName };
      } else {
        const created = await base44.entities.AssistantSettings.create(payload);
        setRecordId(created.id);
        return { created: true, name: detectedName };
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["assistant-settings-sarah", company?.id] });
      const savedName = result?.name || form.assistant_name || "sarah";
      const displayName = savedName.charAt(0).toUpperCase() + savedName.slice(1);
      if (result?.name && result.name !== form.assistant_name) {
        setForm(f => ({ ...f, assistant_name: result.name }));
      }
      alert(`✅ ${displayName} settings saved`);
    },
  });

  const handleFile = async (file) => {
    if (!file) return;
    setFileUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setForm((f) => ({ ...f, avatar_url: file_url }));
    } finally {
      setFileUploading(false);
    }
  };

  const onChange = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const onSchedChange = (key, value) => setForm((f) => ({ ...f, scheduling_defaults: { ...f.scheduling_defaults, [key]: value } }));
  const onConvChange = (key, value) => setForm((f) => ({ ...f, conversation_limits: { ...f.conversation_limits, [key]: value } }));

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Sparkles className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold">{(form.assistant_name || "sarah").charAt(0).toUpperCase() + (form.assistant_name || "sarah").slice(1)} Settings</h1>
      </div>

      {/* Test Sarah Conversation */}
      <Card className="p-5 bg-purple-50 border-purple-200 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Bug className="w-5 h-5 text-purple-600" />
            <h3 className="font-semibold text-purple-900">Test Sarah Conversation</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={clearTestConversation} className="text-purple-600">
            <Trash2 className="w-4 h-4 mr-1" /> Clear
          </Button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Simulate a customer SMS conversation to test Sarah's responses and see debug info.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Conversation Panel */}
          <div className="bg-white rounded-lg border p-3">
            <div className="flex items-center gap-2 mb-3">
              <Input 
                placeholder="Test Phone: +15551234567" 
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                className="text-sm"
              />
            </div>
            
            <ScrollArea className="h-64 mb-3 pr-2">
              <div className="space-y-3">
                {testConversation.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-8">
                    Send a test message to start...
                  </p>
                )}
                {testConversation.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === 'customer' ? 'bg-blue-500 text-white' :
                      msg.role === 'sarah' ? 'bg-gray-100 text-gray-900' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {msg.role === 'sarah' && <span className="font-semibold text-purple-600">Sarah: </span>}
                      {msg.message}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            
            <div className="flex gap-2">
              <Input 
                placeholder="Type a test message..." 
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTestSend()}
                disabled={testSarahMutation.isPending}
              />
              <Button 
                onClick={handleTestSend}
                disabled={!testMessage.trim() || testSarahMutation.isPending}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {testSarahMutation.isPending ? "..." : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          
          {/* Debug Panel */}
          <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono">
            <div className="flex items-center gap-2 mb-2 text-gray-400">
              <Bug className="w-4 h-4" />
              <span>Debug Info</span>
            </div>
            <ScrollArea className="h-72">
              {testDebugInfo ? (
                <div className="space-y-2 text-gray-300">
                  <div>
                    <span className="text-purple-400">Contact:</span> {testDebugInfo.contactName || 'Unknown'}
                    {testDebugInfo.isNewContact && <Badge className="ml-2 bg-green-600">NEW</Badge>}
                  </div>
                  <div>
                    <span className="text-purple-400">Lead Info Extracted:</span>
                    <pre className="mt-1 text-green-400 whitespace-pre-wrap">
                      {JSON.stringify(testDebugInfo.extractedInfo, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <span className="text-purple-400">Missing Info:</span>
                    <div className="flex gap-1 mt-1">
                      {testDebugInfo.missingInfo?.map(m => (
                        <Badge key={m} variant="outline" className="text-yellow-400 border-yellow-400">{m}</Badge>
                      ))}
                      {(!testDebugInfo.missingInfo || testDebugInfo.missingInfo.length === 0) && (
                        <Badge className="bg-green-600">All info collected!</Badge>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-purple-400">Wants Schedule:</span> {testDebugInfo.wantsSchedule ? '✅ Yes' : '❌ No'}
                  </div>
                  <div>
                    <span className="text-purple-400">Existing Appt:</span> {testDebugInfo.hasExistingAppt ? '⚠️ Yes' : '✅ No'}
                  </div>
                  <div>
                    <span className="text-purple-400">Lead Created/Updated:</span> {testDebugInfo.leadAction || 'None'}
                  </div>
                  <div className="border-t border-gray-700 pt-2 mt-2">
                    <span className="text-purple-400">Response Logic:</span>
                    <p className="text-gray-400 mt-1">{testDebugInfo.responseReason}</p>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">Send a message to see debug info...</p>
              )}
            </ScrollArea>
          </div>
        </div>
      </Card>



      {/* Reset Conversation Card */}
      <Card className="p-5 bg-blue-50 border-blue-200 mb-6">
        <div className="flex items-center gap-3 mb-3">
          <RefreshCw className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-blue-900">Reset Conversation Cap</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          If Sarah stopped responding due to hitting the conversation limit, enter the customer's phone number below to reset and allow her to respond again.
        </p>
        <div className="flex gap-3">
          <Input 
            placeholder="+1234567890" 
            value={resetPhone}
            onChange={(e) => setResetPhone(e.target.value)}
            className="max-w-xs"
          />
          <Button 
            onClick={() => resetConversationMutation.mutate(resetPhone)}
            disabled={!resetPhone || resetConversationMutation.isPending}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {resetConversationMutation.isPending ? "Resetting..." : "Reset"}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          <div>
            <Label>Avatar</Label>
            <div className="mt-2 flex items-center gap-3">
              {form.avatar_url ? (
                <img src={form.avatar_url} alt="Sarah Avatar" className="w-20 h-20 rounded-lg object-cover border" />
              ) : (
                <div className="w-20 h-20 rounded-lg border flex items-center justify-center text-gray-400">
                  <ImageIcon className="w-6 h-6" />
                </div>
              )}
              <div>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="file" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                  <Button variant="outline" className="gap-2" disabled={fileUploading}>
                    <Upload className="w-4 h-4" /> {fileUploading ? "Uploading..." : "Upload"}
                  </Button>
                </label>
              </div>
            </div>
          </div>

          <div>
            <Label>Engine</Label>
            <Select value={form.engine} onValueChange={(v) => onChange("engine", v)}>
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o-realtime">GPT-4o Realtime (OpenAI)</SelectItem>
                <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash</SelectItem>
                <SelectItem value="gemini-2.0-flash-001">Gemini 2.0 Flash-001</SelectItem>
                <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash</SelectItem>
              </SelectContent>
            </Select>
            <div className="mt-4 flex items-center justify-between">
              <Label className="mr-4">Live (Real-time)</Label>
              <Switch checked={form.live_mode} onCheckedChange={(v) => onChange("live_mode", v)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Enable Voice Responses</Label>
              <Switch checked={form.voice_enabled} onCheckedChange={(v) => onChange("voice_enabled", v)} />
            </div>
            <div className="mt-3">
              <Label>Voice Selection</Label>
              <Select value={VALID_GEMINI_VOICES.includes(form.voice_id) ? form.voice_id : 'Kore'} onValueChange={(v) => onChange("voice_id", v)}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Choose a voice..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Aoede">Aoede ♀</SelectItem>
                  <SelectItem value="Kore">Kore ♀</SelectItem>
                  <SelectItem value="Leda">Leda ♀</SelectItem>
                  <SelectItem value="Zephyr">Zephyr ♀</SelectItem>
                  <SelectItem value="Charon">Charon ♂</SelectItem>
                  <SelectItem value="Fenrir">Fenrir ♂</SelectItem>
                  <SelectItem value="Orus">Orus ♂</SelectItem>
                  <SelectItem value="Puck">Puck ♂</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">Select the Gemini voice for phone calls. Save settings to apply.</p>
            </div>
          </div>
        </div>

        <Card className="border-purple-100 bg-purple-50/30">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Background Audio</Label>
                <Select
                  value={form.background_audio}
                  onValueChange={(value) => onChange("background_audio", value)}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Select ambient noise" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (Silent)</SelectItem>
                    <SelectItem value="call_center">Call Center</SelectItem>
                    <SelectItem value="office">Office Environment</SelectItem>
                    <SelectItem value="cafe">Coffee Shop</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-amber-600">
                  ⚠️ Coming soon — requires advanced audio streaming.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Interim Audio</Label>
                <Select
                  value={form.interim_audio}
                  onValueChange={(value) => onChange("interim_audio", value)}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Select waiting sound" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (Silence)</SelectItem>
                    <SelectItem value="typing">Typing on Keyboard</SelectItem>
                    <SelectItem value="thinking">"Hmm..." / Thinking Sounds</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  Sound played while AI is generating a response.
                </p>
              </div>
            </div>

            <div className="space-y-6 pt-4 border-t border-purple-100">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Assertiveness Level</Label>
                  <span className="text-sm text-gray-500">
                    {form.personality_assertiveness}%
                  </span>
                </div>
                <Slider
                  defaultValue={[50]}
                  value={[form.personality_assertiveness]}
                  max={100}
                  step={1}
                  onValueChange={(vals) => onChange("personality_assertiveness", vals[0])}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 flex justify-between">
                  <span>Soft suggestions</span>
                  <span>Direct & confident</span>
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Humor Level</Label>
                  <span className="text-sm text-gray-500">
                    {form.personality_humor}%
                  </span>
                </div>
                <Slider
                  defaultValue={[20]}
                  value={[form.personality_humor]}
                  max={100}
                  step={1}
                  onValueChange={(vals) => onChange("personality_humor", vals[0])}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 flex justify-between">
                  <span>Serious</span>
                  <span>Witty</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Response Speed - Moved for better visibility */}
        <div className="mt-6 mb-6">
          <Card className="bg-blue-50 border-blue-200 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-blue-600" />
                  <Label className="text-lg font-bold text-blue-900">Response Speed & Latency</Label>
                  <Badge className="bg-blue-600 text-white hover:bg-blue-700">New</Badge>
                </div>
              </div>
              
              <div className="grid md:grid-cols-2 gap-4 items-center">
                <div className="space-y-2">
                  <Select
                    value={form.response_speed}
                    onValueChange={(value) => onChange("response_speed", value)}
                  >
                    <SelectTrigger className="bg-white border-blue-300 h-10 font-medium">
                      <SelectValue placeholder="Select speed" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal (Balanced - Includes Typing Sounds)</SelectItem>
                      <SelectItem value="fast">Fast (Reduced Latency - No Sounds)</SelectItem>
                      <SelectItem value="ultra_fast">Ultra Fast (Instant - Minimal Memory)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-sm text-blue-800">
                  {form.response_speed === 'normal' && "✅ Uses typing sounds and full memory. Best for natural feel."}
                  {form.response_speed === 'fast' && "⚡ Skips audio effects to reply faster. Good for efficient calls."}
                  {form.response_speed === 'ultra_fast' && "🚀 Maximum speed. Skips Knowledge Base and limits memory."}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6 border-green-200 bg-green-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <PhoneOutgoing className="w-5 h-5 text-green-600" />
              <CardTitle className="text-base">Call Direction Settings</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Control whether Sarah handles incoming calls, makes outgoing calls to new leads, or both.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PhoneIncoming className="w-4 h-4 text-blue-600" />
                    <Label>Accept Incoming Calls</Label>
                  </div>
                  <Switch
                    checked={form.inbound_calls_enabled}
                    onCheckedChange={(v) => onChange("inbound_calls_enabled", v)}
                    data-testid="switch-inbound-calls"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Sarah answers calls from customers calling your business number.</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PhoneOutgoing className="w-4 h-4 text-green-600" />
                    <Label>Make Outgoing Calls</Label>
                  </div>
                  <Switch
                    checked={form.outbound_calls_enabled}
                    onCheckedChange={(v) => onChange("outbound_calls_enabled", v)}
                    data-testid="switch-outbound-calls"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Sarah proactively calls new leads to qualify them and book inspections.</p>
              </div>
            </div>

            {form.outbound_calls_enabled && (
              <div className="border-t pt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-600" />
                        <Label>Auto-Call New Leads</Label>
                      </div>
                      <Switch
                        checked={form.auto_call_new_leads}
                        onCheckedChange={(v) => onChange("auto_call_new_leads", v)}
                        data-testid="switch-auto-call"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Automatically call new leads within a set delay. Only during business hours.</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <Label>Auto-Call Delay (minutes)</Label>
                    </div>
                    <Select
                      value={String(form.auto_call_delay_minutes)}
                      onValueChange={(v) => onChange("auto_call_delay_minutes", parseInt(v))}
                    >
                      <SelectTrigger data-testid="select-auto-call-delay">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 minute (instant)</SelectItem>
                        <SelectItem value="3">3 minutes</SelectItem>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="10">10 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">How long to wait after a lead is created before Sarah calls.</p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-blue-600" />
                    <Label>Send SMS Confirmation After Booking</Label>
                  </div>
                  <Switch
                    checked={form.send_sms_after_booking}
                    onCheckedChange={(v) => onChange("send_sms_after_booking", v)}
                    data-testid="switch-sms-after-booking"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Custom Outbound Greeting (optional)</Label>
                  <Textarea
                    rows={3}
                    value={form.outbound_greeting}
                    onChange={(e) => onChange("outbound_greeting", e.target.value)}
                    placeholder="Leave blank for default. Example: Hi, this is {agent} from {brand}. I'm reaching out because you recently inquired about roofing services..."
                    data-testid="input-outbound-greeting"
                  />
                  <p className="text-xs text-muted-foreground">{"Supports {agent}, {brand} placeholders. If blank, Sarah uses her built-in outbound script."}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Booking Control — always visible, applies to both inbound and outbound calls */}
        <Card className="mt-6">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarIcon className="w-4 h-4 text-blue-600" />
                  <Label className="text-sm font-medium">Allow Sarah to Book Appointments Directly</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  When off, Sarah collects the customer's name, phone, and preferred time, then tells them your team will follow up to confirm. You receive a bell notification with their details so you can call back and lock it in.
                </p>
              </div>
              <Switch
                checked={form.allow_calendar_invites}
                onCheckedChange={(v) => onChange("allow_calendar_invites", v)}
                data-testid="switch-allow-calendar-invites"
              />
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 space-y-2">
          <Label>Custom Inbound Greeting (optional)</Label>
          <Textarea
            rows={2}
            value={form.inbound_greeting}
            onChange={(e) => onChange("inbound_greeting", e.target.value)}
            placeholder={`Leave blank for default. Example: Hi, this is {agent}, an AI assistant for {brand}. I'm here to help with your roofing needs. Who am I speaking with?`}
            data-testid="input-inbound-greeting"
          />
          <p className="text-xs text-muted-foreground">{"Customizes Sarah's opening line for inbound calls. Supports {agent}, {brand} placeholders. Sarah will always identify as AI."}</p>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <Label>System Prompt</Label>
            <Button 
              type="button"
              variant="outline" 
              size="sm"
              onClick={() => onChange("system_prompt", DEFAULT_PROMPT)}
            >
              Reset to Professional Default
            </Button>
          </div>
          <Textarea rows={10} className="mt-2" value={form.system_prompt} onChange={(e) => onChange("system_prompt", e.target.value)} />
          <p className="text-xs text-gray-500 mt-1">Customize your assistant's voice, tone, and operating rules. The new default focuses on empathetic triage before booking.</p>
        </div>

        {/* Knowledge Base Section */}
        <Card className="p-4 bg-amber-50 border-amber-200 mt-6">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-5 h-5 text-amber-700" />
            <h3 className="font-semibold text-amber-900">Knowledge Base</h3>
          </div>
          <p className="text-sm text-amber-800 mb-4">
            Teach Sarah about your specific company. You can type directly or import content from your website and documents (PDFs, etc).
          </p>

          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="flex-1 flex gap-2">
              <Input 
                placeholder="https://your-website.com" 
                value={importUrl} 
                onChange={(e) => setImportUrl(e.target.value)} 
                className="bg-white"
              />
              <Button 
                onClick={extractFromUrl} 
                disabled={!importUrl || extracting}
                variant="outline"
                className="bg-white whitespace-nowrap"
              >
                {extracting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4 mr-2" />}
                Import Site
              </Button>
            </div>
            
            <div>
              <label className="inline-flex">
                <input 
                  type="file" 
                  accept=".pdf,.doc,.docx,.txt" 
                  className="hidden" 
                  onChange={(e) => extractFromFile(e.target.files?.[0])} 
                  disabled={extracting}
                />
                <Button 
                  variant="outline" 
                  className="bg-white whitespace-nowrap cursor-pointer" 
                  asChild 
                  disabled={extracting}
                >
                  <span>
                    {extracting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                    Import PDF/Doc
                  </span>
                </Button>
              </label>
            </div>
          </div>

          <Label>Custom Knowledge Text</Label>
          <Textarea 
            rows={8} 
            className="mt-2 font-mono text-sm bg-white" 
            value={form.knowledge_base || ''} 
            onChange={(e) => onChange("knowledge_base", e.target.value)} 
            placeholder="Paste your pricing, service list, company history, or import it using the buttons above..."
          />
        </Card>

        {/* SMS Behavior */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div>
            <Label>Brand Short Name</Label>
            <Input className="mt-2" value={form.brand_short_name} onChange={(e) => onChange('brand_short_name', e.target.value)} placeholder="Your Company Name" />
          </div>
          <div className="flex items-center justify-between mt-6 md:mt-0">
            <Label className="mr-4">Short SMS Mode</Label>
            <Switch checked={form.short_sms_mode} onCheckedChange={(v) => onChange('short_sms_mode', v)} />
          </div>
          <div>
            <Label>Max SMS Characters</Label>
            <Input type="number" className="mt-2" value={form.max_sms_chars} onChange={(e) => onChange('max_sms_chars', Number(e.target.value) || 0)} />
          </div>
        </div>

        <div className="mt-4">
          <Label>Calendly Booking URL</Label>
          <div className="flex gap-2 mt-2">
            <Input className="flex-1" value={form.calendly_booking_url} onChange={(e) => onChange('calendly_booking_url', e.target.value)} placeholder="https://getcompanysync.com/BookAppointment?company_id=..." />
            {form.calendly_booking_url && (
              <>
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => { navigator.clipboard.writeText(form.calendly_booking_url); alert('Link copied!'); }}
                  title="Copy link"
                >
                  <Copy className="w-4 h-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => window.open(form.calendly_booking_url, '_blank')}
                  title="Preview booking page"
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">Sarah will send this link when customers ask to schedule appointments</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="flex items-center justify-between">
            <Label className="mr-4">Answer then ask one</Label>
            <Switch checked={form.answer_then_ask_one} onCheckedChange={(v) => onChange('answer_then_ask_one', v)} />
          </div>
          <div>
            <Label>Triage Categories (comma separated)</Label>
            <Input className="mt-2" value={(form.triage_categories || []).join(', ')} onChange={(e) => onChange('triage_categories', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <Label>First Triage Question</Label>
            <Textarea rows={2} className="mt-2" value={form.triage_first_question} onChange={(e) => onChange('triage_first_question', e.target.value)} />
          </div>
          <div>
            <Label>Leak Follow-up Question</Label>
            <Textarea rows={2} className="mt-2" value={form.triage_followup_leak} onChange={(e) => onChange('triage_followup_leak', e.target.value)} />
          </div>
        </div>

        {/* Conversation Cap */}
        <Card className="p-4 bg-gray-50">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Max SMS turns</Label>
              <Input type="number" className="mt-2" value={form.conversation_limits?.max_sms_turns ?? 10} onChange={(e) => onConvChange("max_sms_turns", Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Max thread duration (min)</Label>
              <Input type="number" className="mt-2" value={form.conversation_limits?.max_thread_minutes ?? 60} onChange={(e) => onConvChange("max_thread_minutes", Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Action at cap</Label>
              <Select value={form.conversation_limits?.action_at_cap || "wrapup_notify"} onValueChange={(v) => onConvChange("action_at_cap", v)}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wrapup_notify">Wrap-up + notify admins</SelectItem>
                  <SelectItem value="wrapup_only">Wrap-up only</SelectItem>
                  <SelectItem value="silence">Stop responding</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cooldown (hours)</Label>
              <Input type="number" className="mt-2" value={form.conversation_limits?.cooldown_hours ?? 12} onChange={(e) => onConvChange("cooldown_hours", Number(e.target.value) || 0)} />
            </div>
            <div className="md:col-span-2">
              <Label>Wrap-up message</Label>
              <Textarea rows={2} className="mt-2" value={form.conversation_limits?.wrapup_template || ""} onChange={(e) => onConvChange("wrapup_template", e.target.value)} />
              <p className="text-xs text-gray-500 mt-1">{`Use {brand}, {agent}.`}</p>
            </div>
          </div>
        </Card>

        {/* Intent Templates */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {[
            ['who_are_you','Who are you / your name?'],
            ['greeting','Greeting'],
            ['price','Pricing/Estimate'],
            ['appointment','Appointment'],
            ['address','Address Request'],
            ['stop','Stop/Unsubscribe'],
            ['wrong_number','Wrong Number'],
            ['smalltalk','Small Talk'],
            ['fallback','Fallback']
          ].map(([key,label]) => (
            <div key={key}>
              <Label>{label}</Label>
              <Textarea rows={2} className="mt-2" value={form.intent_templates?.[key] || ''} onChange={(e) => setForm(f => ({...f, intent_templates: {...(f.intent_templates||{}), [key]: e.target.value}}))} />
              <p className="text-xs text-gray-500 mt-1">{`Use {brand}, {agent}, {calendly_link}; fallback supports {triage_first}.`}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-6">
          <div>
            <Label>Duration (min)</Label>
            <Input type="number" className="mt-2" value={form.scheduling_defaults.duration_min} onChange={(e) => onSchedChange("duration_min", Number(e.target.value) || 0)} />
          </div>
          <div>
            <Label>Buffer (min)</Label>
            <Input type="number" className="mt-2" value={form.scheduling_defaults.buffer_min} onChange={(e) => onSchedChange("buffer_min", Number(e.target.value) || 0)} />
          </div>
          <div>
            <Label>Start Hour</Label>
            <Input type="number" className="mt-2" value={form.scheduling_defaults.business_hours_start} onChange={(e) => onSchedChange("business_hours_start", Number(e.target.value) || 0)} />
          </div>
          <div>
            <Label>End Hour</Label>
            <Input type="number" className="mt-2" value={form.scheduling_defaults.business_hours_end} onChange={(e) => onSchedChange("business_hours_end", Number(e.target.value) || 0)} />
          </div>
          <div>
            <Label>Days Lookahead</Label>
            <Input type="number" className="mt-2" value={form.scheduling_defaults.days_lookahead} onChange={(e) => onSchedChange("days_lookahead", Number(e.target.value) || 0)} />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => saveMutation.mutate()} className="gap-2">
            <Save className="w-4 h-4" /> Save Settings
          </Button>
        </div>
      </Card>
    </div>
  );
}