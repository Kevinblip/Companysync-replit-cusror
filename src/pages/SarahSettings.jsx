import React from "react";
import { base44 } from "@/api/base44Client";
import { pickCanonicalSettings, healDuplicateSettings, isLexiRow, upsertSarahSettings } from "@/utils/assistantSettingsRecord";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Upload, Save, Image as ImageIcon, Sparkles, RefreshCw, Send, MessageCircle, Trash2, Bug, Zap, Globe, FileText, BookOpen, ExternalLink, Copy, PhoneOutgoing, PhoneIncoming, Clock, MessageSquare, Calendar as CalendarIcon, RotateCcw, Loader2, Users } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

const VALID_GEMINI_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr'];

const DEFAULT_PROMPT = `Role: You are Alex, the Senior Office Manager and Intake Specialist for {brand}. You are an expert in residential roofing, storm damage, and insurance claims.

Goal: Your #1 job is to BOOK THE FREE INSPECTION. 

Expertise You Must Demonstrate:
- Hail Damage: Explain that it bruises shingles and voids warranties (often invisible from the ground).
- Wind Damage: Mention that missing shingles lead to leaks and rot.
- Insurance: You are an "Insurance Restoration Specialist". You help homeowners navigate claims with State Farm, Allstate, etc.

The Perfect Call Flow:
1. Greet & Assure: "Thanks for calling {brand}, this is Alex. How can I help with your property today?"
2. Assess Urgency: "Is water getting in right now, or is this just a preventative check?"
3. Pivot to Inspection: "The best way to know for sure is a free video inspection. It takes 15 minutes and gives you a full report. I have a technician in your area tomorrow—does morning or afternoon work better?"

Rules of Engagement:
- Speak in short, punchy sentences (under 20 words).
- Always end with a question (Lead the Dance).
- Never guess a price over the phone. Pivot to the free inspection.
- If asked if you are real: "I'm the virtual office manager here to get you help fast. What's your address?"`;

const DEFAULT_TRANSFER_INSTRUCTIONS = `Don't transfer a call right away. First, get the caller's name, a good callback number, and the reason they're calling — ask for whatever you're missing, one question at a time, and confirm it back.
Once you have their name, callback number, and reason: if they asked for a specific person, check whether that person is available. If they're available, say "Let me connect you with [name] now" and transfer the call. If that person is marked unavailable, don't transfer — take a message instead.
If a transfer can't go through (there's no phone number on file for that person, or they don't pick up), do NOT hang up or start the conversation over. Apologize, take a message with the caller's name, callback number, and reason, and let them know that person will call them back as soon as possible.`;

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
    spoken_name: "",
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
    routing_mode: 'sarah_answers',
    transfer_instructions: "",
    screen_calls_enabled: false,
    screening_instructions: "",
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
    // ── Proactive Outreach (Task #674) ──
    // Every automated customer message identifies the assistant as an AI.
    ai_identification_line: "This is {assistant}, {company}'s AI assistant.",
    appointment_reminders_customer_enabled: true,
    appointment_reminder_ai_call_enabled: false,
    lead_confirmation_outreach_enabled: false,
    lead_confirmation_wait_minutes: 30,
    lead_confirmation_ai_call_enabled: true,
    lead_confirmation_respect_business_hours: true,
    lead_confirmation_auto_enroll_new_leads: false,
    // Default staff member that new appointment approvals are assigned to.
    default_inspector_email: "",
    build_reminders_enabled: false,
    build_reminder_days_before: 2,
    build_reminder_template: "Hi {customer_name}! Just a friendly reminder that {company}'s crew is scheduled to work on your roof at {address} on {build_date}. Reply here or call us with any questions — we look forward to seeing you!",
    build_reminder_ai_call_enabled: false,
    // ── Weekly task-board watch (Task #675) ──
    weekly_progress_updates_enabled: false,
    stuck_job_alerts_enabled: false,
    stuck_job_threshold_days: 10,
    // 0 means "use same value as threshold" (re-alert after another full window).
    stuck_job_re_alert_days: 0,
  });
  const [recordId, setRecordId] = React.useState(null);
  const [resetPhone, setResetPhone] = React.useState("");
  const [isReturningAll, setIsReturningAll] = React.useState(false);
  
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
      isDirty.current = true;
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
      isDirty.current = true;
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
  });

  // Pick user's company (owner first, else first available)
  React.useEffect(() => {
    if (!user || companies.length === 0) return;
    const owned = companies.find((c) => c.created_by === user.email);
    setCompany(owned || companies[0]);
  }, [user, companies]);

  // isDirty prevents background refetches from clobbering unsaved user edits.
  const isDirty = React.useRef(false);

  // Load existing settings
  const { isLoading: assistantSettingsLoading } = useQuery({
    queryKey: ["assistant-settings-sarah", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      let rows = await base44.entities.AssistantSettings.filter({ company_id: company.id }, '-updated_date', 10);
      // Prefer the row that was actually maintained — a stray default-save
      // can shadow the real tuned config (calls then introduce the company
      // with the wrong name). Also clean up any duplicate rows.
      let rec = pickCanonicalSettings(rows); // finds 'sarah'/'' rows only

      // Backward-compat: if no sarah/empty row exists, look for a legacy 'alex'
      // row that was created by an older version of SarahSettings which hardcoded
      // assistant_name='alex'. Only use it when the company has no other
      // custom-named assistants (no marcus, zara, etc.) — that proves the alex row
      // is Sarah's and not an independently configured custom assistant.
      // We load its settings but do NOT set recordId, so the next save creates a
      // fresh 'sarah' row and migrates the discriminator without clobbering anything.
      let isLegacyMigration = false;
      if (!rec) {
        const nonLexiRows = rows.filter(r => !isLexiRow(r));
        const alexRows = nonLexiRows.filter(
          r => (r?.assistant_name || '').trim().toLowerCase() === 'alex'
        );
        const otherCustomRows = nonLexiRows.filter(r => {
          const n = (r?.assistant_name || '').trim().toLowerCase();
          return n !== 'alex' && n !== 'sarah' && n !== '';
        });
        if (alexRows.length > 0 && otherCustomRows.length === 0) {
          rec = [...alexRows].sort(
            (a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0)
          )[0];
          isLegacyMigration = true; // don't set recordId; save will create 'sarah' row
        }
      }

      // Only heal duplicates when we have a real canonical row (not a migration proxy)
      if (!isLegacyMigration) {
        try { await healDuplicateSettings(base44.entities.AssistantSettings, rows, rec); } catch (_) {}
      }
      if (rec) {
        if (!isLegacyMigration) setRecordId(rec.id);
        if (!isDirty.current) setForm({
          assistant_name: 'sarah',
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
          spoken_name: rec.spoken_name || "",
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
            greeting: rec.intent_templates?.greeting || "Thanks for calling {brand}, this is Alex! How can I help you with your property today?",
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
          routing_mode: rec.routing_mode || 'sarah_answers',
          transfer_instructions: rec.transfer_instructions || "",
          screen_calls_enabled: rec.screen_calls_enabled ?? false,
          screening_instructions: rec.screening_instructions || "",
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
          ai_identification_line: rec.ai_identification_line || "This is {assistant}, {company}'s AI assistant.",
          appointment_reminders_customer_enabled: rec.appointment_reminders_customer_enabled ?? true,
          appointment_reminder_ai_call_enabled: rec.appointment_reminder_ai_call_enabled ?? false,
            lead_confirmation_outreach_enabled: rec.lead_confirmation_outreach_enabled ?? false,
            lead_confirmation_wait_minutes: rec.lead_confirmation_wait_minutes ?? 30,
            lead_confirmation_ai_call_enabled: rec.lead_confirmation_ai_call_enabled ?? true,
            lead_confirmation_respect_business_hours: rec.lead_confirmation_respect_business_hours ?? true,
            lead_confirmation_auto_enroll_new_leads: rec.lead_confirmation_auto_enroll_new_leads ?? false,
          default_inspector_email: rec.default_inspector_email || "",
          build_reminders_enabled: rec.build_reminders_enabled ?? false,
          build_reminder_days_before: rec.build_reminder_days_before ?? 2,
          build_reminder_template: rec.build_reminder_template || "Hi {customer_name}! Just a friendly reminder that {company}'s crew is scheduled to work on your roof at {address} on {build_date}. Reply here or call us with any questions — we look forward to seeing you!",
          build_reminder_ai_call_enabled: rec.build_reminder_ai_call_enabled ?? false,
          weekly_progress_updates_enabled: rec.weekly_progress_updates_enabled ?? false,
          stuck_job_alerts_enabled: rec.stuck_job_alerts_enabled ?? false,
          stuck_job_threshold_days: rec.stuck_job_threshold_days ?? 10,
          stuck_job_re_alert_days: rec.stuck_job_re_alert_days ?? 0,
        });
      }
      return rows;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const formToSave = { ...form, assistant_name: 'sarah' };
      const result = await upsertSarahSettings(
        base44.entities.AssistantSettings,
        company?.id,
        formToSave
      );
      setRecordId(result.record.id);
      return { [result.created ? "created" : "updated"]: true, name: detectedName };
    },
    onSuccess: () => {
      isDirty.current = false;
      queryClient.invalidateQueries({ queryKey: ["assistant-settings-sarah", company?.id] });
      setForm(f => ({ ...f, assistant_name: 'sarah' }));
      alert(`✅ Alex settings saved`);
    },
  });

  // Staff list for the Default Inspector picker.
  const { data: staffProfiles = [] } = useQuery({
    queryKey: ["staff-profiles", company?.id],
    queryFn: () =>
      company?.id
        ? base44.entities.StaffProfile.filter({ company_id: company.id })
        : [],
    enabled: !!company?.id,
  });

  const { data: pausedThreadsData, isLoading: pausedLoading } = useQuery({
    queryKey: ['sarah-paused-threads', company?.id],
    queryFn: async () => {
      if (!company?.id) return { threads: [] };
      const resp = await base44.functions.invoke('getRepOwnedThreads', { companyId: company.id });
      return resp?.data || { threads: [] };
    },
    enabled: !!company?.id,
    refetchInterval: 30000,
  });
  const pausedThreads = pausedThreadsData?.threads || [];

  const handBackSingleMutation = useMutation({
    mutationFn: async (phone) => {
      const resp = await base44.functions.invoke('handBackToSarah', { companyId: company?.id, contactPhone: phone });
      return resp?.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sarah-paused-threads', company?.id] });
    },
  });

  const handleReturnAll = async () => {
    if (!pausedThreads.length || isReturningAll) return;
    setIsReturningAll(true);
    try {
      await Promise.all(
        pausedThreads.map(t =>
          base44.functions.invoke('handBackToSarah', { companyId: company?.id, contactPhone: t.contact_phone })
        )
      );
      queryClient.invalidateQueries({ queryKey: ['sarah-paused-threads', company?.id] });
    } finally {
      setIsReturningAll(false);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setFileUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      isDirty.current = true;
      setForm((f) => ({ ...f, avatar_url: file_url }));
    } finally {
      setFileUploading(false);
    }
  };

  const onChange = (key, value) => { isDirty.current = true; setForm((f) => ({ ...f, [key]: value })); };
  const onSchedChange = (key, value) => { isDirty.current = true; setForm((f) => ({ ...f, scheduling_defaults: { ...f.scheduling_defaults, [key]: value } })); };
  const onConvChange = (key, value) => { isDirty.current = true; setForm((f) => ({ ...f, conversation_limits: { ...f.conversation_limits, [key]: value } })); };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Sparkles className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold">Alex Settings</h1>
      </div>

      {/* Test Alex Conversation */}
      <Card className="p-5 bg-purple-50 border-purple-200 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Bug className="w-5 h-5 text-purple-600" />
            <h3 className="font-semibold text-purple-900">Test Alex Conversation</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={clearTestConversation} className="text-purple-600">
            <Trash2 className="w-4 h-4 mr-1" /> Clear
          </Button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Simulate a customer SMS conversation to test Alex's responses and see debug info.
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
                      msg.role === 'sarah' ? 'bg-gray-100 text-gray-900' : // legacy role key kept for existing chat history
                      'bg-red-100 text-red-700'
                    }`}>
                      {msg.role === 'sarah' && <span className="font-semibold text-purple-600">Alex: </span>}
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
          If Alex stopped responding due to hitting the conversation limit, enter the customer's phone number below to reset and allow her to respond again.
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

      {/* Paused Threads */}
      <Card className="p-5 bg-amber-50 border-amber-200 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-amber-600" />
            <div>
              <h3 className="font-semibold text-amber-900">Paused Threads</h3>
              <p className="text-xs text-amber-700 mt-0.5">Contacts where a rep sent the last message and Alex is silenced</p>
            </div>
          </div>
          {pausedThreads.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-800 hover:bg-amber-100"
              onClick={handleReturnAll}
              disabled={isReturningAll}
            >
              {isReturningAll ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RotateCcw className="w-4 h-4 mr-2" />}
              Return all to Alex
            </Button>
          )}
        </div>
        {pausedLoading ? (
          <div className="flex items-center justify-center py-6 gap-2 text-amber-700 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
          </div>
        ) : pausedThreads.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm">
            No paused threads — Alex is handling all conversations.
          </div>
        ) : (
          <div className="space-y-2">
            {pausedThreads.map(thread => (
              <div key={thread.id} className="flex items-center justify-between bg-white border border-amber-100 rounded-lg px-4 py-3 gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {thread.contact_name || thread.contact_phone}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-gray-500">
                    {thread.contact_name && <span>{thread.contact_phone}</span>}
                    {thread.sent_by && <span>Last by: {thread.sent_by}</span>}
                    {thread.last_rep_message_at && (
                      <span>{new Date(thread.last_rep_message_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-300 text-amber-700 hover:bg-amber-50 flex-shrink-0"
                  onClick={() => handBackSingleMutation.mutate(thread.contact_phone)}
                  disabled={handBackSingleMutation.isPending}
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Hand back
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          <div>
            <Label>Avatar</Label>
            <div className="mt-2 flex items-center gap-3">
              {form.avatar_url ? (
                <img src={form.avatar_url} alt="Alex Avatar" className="w-20 h-20 rounded-lg object-cover border" />
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
              Control whether Alex handles incoming calls, makes outgoing calls to new leads, or both.
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
                <p className="text-xs text-muted-foreground">Alex answers calls from customers calling your business number.</p>
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
                <p className="text-xs text-muted-foreground">Alex proactively calls new leads to qualify them and book inspections.</p>
              </div>
            </div>

            {/* Company-wide call handling mode */}
            <div className="border-t pt-4 space-y-2">
              <Label className="font-medium">Call Handling Mode</Label>
              <Select
                value={form.routing_mode || 'sarah_answers'}
                onValueChange={(v) => onChange("routing_mode", v)}
              >
                <SelectTrigger data-testid="select-routing-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sarah_answers">Alex Answers — AI handles the call, saves lead, notifies rep</SelectItem>
                  <SelectItem value="sarah_then_transfer">Alex Then Transfers — collects info, then connects caller to rep's cell</SelectItem>
                  <SelectItem value="sarah_only">Alex Handles Everything — no transfer, no human handoff (great for after-hours)</SelectItem>
                </SelectContent>
              </Select>
              {form.routing_mode === 'sarah_only' && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  In this mode, Alex will never attempt to transfer a call to a human. She handles everything herself — saves leads, books inspections, takes messages, and sends confirmations. Transfer is fully disabled.
                </p>
              )}
              {(!form.routing_mode || form.routing_mode === 'sarah_answers') && (
                <p className="text-xs text-muted-foreground">Alex handles the call from start to finish. After capturing caller info, she notifies the assigned rep by SMS.</p>
              )}
              {form.routing_mode === 'sarah_then_transfer' && (
                <p className="text-xs text-muted-foreground">Alex greets the caller, collects their name, callback number, and reason — then transfers them to the rep's cell phone.</p>
              )}
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
                    <p className="text-xs text-muted-foreground">How long to wait after a lead is created before Alex calls.</p>
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
                  <p className="text-xs text-muted-foreground">{"Supports {agent}, {brand} placeholders. If blank, Alex uses her built-in outbound script."}</p>
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
                  <Label className="text-sm font-medium">Allow Alex to Book Appointments Directly</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  When off, Alex collects the customer's name, phone, and preferred time, then tells them your team will follow up to confirm. You receive a bell notification with their details so you can call back and lock it in.
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
          <p className="text-xs text-muted-foreground">{"Customizes Alex's opening line for inbound calls. Supports {agent}, {brand} placeholders. Alex will always identify as AI."}</p>
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

        {/* Call Transfer & Message Handling */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <Label>Call Transfer &amp; Message Handling</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="button-load-default-transfer"
              onClick={() => onChange("transfer_instructions", DEFAULT_TRANSFER_INSTRUCTIONS)}
            >
              Load Default to Edit
            </Button>
          </div>
          <Textarea
            rows={8}
            className="mt-2"
            value={form.transfer_instructions || ""}
            onChange={(e) => onChange("transfer_instructions", e.target.value)}
            placeholder={DEFAULT_TRANSFER_INSTRUCTIONS}
            data-testid="input-transfer-instructions"
          />
          <p className="text-xs text-gray-500 mt-1">
            Controls what Alex does before transferring a call. By default it first collects the caller's name, callback number, and reason — and if no one can take the call, it takes a message instead of hanging up. Leave this blank to use the default shown in grey, or click "Load Default to Edit" and change the wording anytime.
          </p>
        </div>

        {/* Call Screening */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <div>
              <Label>Call Screening</Label>
              <p className="text-xs text-gray-500 mt-0.5">
                When enabled, Alex will qualify the reason for every call before deciding whether to transfer, book, or handle it directly.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">{form.screen_calls_enabled ? "On" : "Off"}</span>
              <button
                type="button"
                role="switch"
                aria-checked={form.screen_calls_enabled}
                data-testid="toggle-screen-calls"
                onClick={() => onChange("screen_calls_enabled", !form.screen_calls_enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${form.screen_calls_enabled ? "bg-blue-600" : "bg-gray-200"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.screen_calls_enabled ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
          </div>
          {form.screen_calls_enabled && (
            <div className="mt-3">
              <Label className="text-sm text-gray-600 mb-1 block">Screening Rules <span className="font-normal text-gray-400">(optional)</span></Label>
              <Textarea
                rows={5}
                data-testid="input-screening-instructions"
                value={form.screening_instructions || ""}
                onChange={(e) => onChange("screening_instructions", e.target.value)}
                placeholder={`Examples:\n- Always transfer emergency calls immediately\n- Book inspections without transferring unless they specifically ask for a person\n- Decline calls from telemarketers or people asking to speak to the "owner" about insurance`}
              />
              <p className="text-xs text-gray-500 mt-1">
                Describe any rules for how calls should be screened. Leave blank to use the default — Alex will ask the caller's reason and decide whether to transfer, book, or handle it.
              </p>
            </div>
          )}
        </div>

        {/* Knowledge Base Section */}
        <Card className="p-4 bg-amber-50 border-amber-200 mt-6">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-5 h-5 text-amber-700" />
            <h3 className="font-semibold text-amber-900">Knowledge Base</h3>
          </div>
          <p className="text-sm text-amber-800 mb-4">
            Teach Alex about your specific company. You can type directly or import content from your website and documents (PDFs, etc).
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

          <div className="flex items-center justify-between">
            <Label>Custom Knowledge Text</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="button-insert-sedgwick-objections"
              onClick={() => {
                const block = `\n\n=== SEDGWICK-VETTED CONTRACTOR — OBJECTION HANDLING ===\n\nWe are a Sedgwick Repair Solutions approved provider, vetted to the same performance, safety, and quality standards required by major carriers including State Farm, Liberty Mutual, Allstate, and American Economy. When a homeowner is deciding between us and an outside (non-vetted) contractor, use the talking points below.\n\nOBJECTION: "I'm thinking of using my own contractor / a buddy / someone cheaper."\nRESPONSE: I totally understand wanting options. The reason most homeowners stay with a Sedgwick-vetted contractor is accountability — we're held to strict carrier standards, so the work is documented to spec the first time. Outside contractors often miss line items the adjuster requires, which means the homeowner ends up paying out of pocket or fighting supplements for weeks.\n\nOBJECTION: "Why does it matter if a contractor is Sedgwick-vetted?"\nRESPONSE: Sedgwick is the third party your insurance carrier uses to verify estimates. Vetted contractors use the same tools they do — Xactimate, Symbility, Hover for measurements, and ITEL for material matching — so our scope lines up with what the carrier will approve. That's why our claims close faster with fewer revisions.\n\nOBJECTION: "Will my insurance still cover it if I use someone else?"\nRESPONSE: Insurance will pay the approved scope to whoever does the work, but with a non-vetted contractor you take on the risk of supplement disputes, code-compliance gaps, and depreciation recovery issues. With us, the carrier already trusts our documentation, so your out-of-pocket stays at the deductible.\n\nOBJECTION: "How is your warranty different?"\nRESPONSE: Because we're an approved network professional, our workmanship warranty is recognized alongside the manufacturer warranty, and the carrier has a record of the install meeting compliance codes. That protects your home value and any future claim on the same roof.\n\nOBJECTION: "I haven't decided yet."\nRESPONSE: That's totally fair. The one thing I'd flag is timing — supplements and ACV-to-RCV releases have deadlines from the carrier. I can hold your spot on the schedule while you decide, no commitment, and that way you don't lose your place if you do move forward with us.\n\nKEY FACTS TO ALWAYS REINFORCE:\n- We are pre-vetted by Sedgwick Repair Solutions\n- We meet the standards of major carriers (State Farm, Liberty Mutual, Allstate, etc.)\n- We use industry-standard tools: Xactimate, Symbility, Hover, ITEL\n- We handle supplements directly with the adjuster — homeowner doesn't have to chase paperwork\n- Our work is documented to carrier compliance codes, protecting future claims\n=== END ===\n`;
                if ((form.knowledge_base || '').includes('SEDGWICK-VETTED CONTRACTOR')) return;
                onChange("knowledge_base", (form.knowledge_base || '') + block);
              }}
            >
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Insert Sedgwick-Vetted Objections
            </Button>
          </div>
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
            <Input className="mt-2" value={form.brand_short_name} onChange={(e) => onChange('brand_short_name', e.target.value)} placeholder="Your Company Name" data-testid="input-brand-short-name" />
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

        {/* How the AI should SAY the company name out loud */}
        <div className="mt-4">
          <Label>How should we say your company name out loud?</Label>
          <Input
            className="mt-2"
            value={form.spoken_name}
            onChange={(e) => onChange('spoken_name', e.target.value)}
            placeholder='e.g. "Y. I. C. N. Roofing" — periods make the voice say each letter'
            data-testid="input-spoken-name"
          />
          <p className="text-xs text-gray-500 mt-1">
            Leave blank and short all-capital names like "YICN" are spoken as separate letters ("Y. I. C. N.").
            Fill this in only if you want to control exactly how the voice pronounces your company name.
          </p>
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
          <p className="text-xs text-gray-500 mt-1">Alex will send this link when customers ask to schedule appointments</p>
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
              <Textarea rows={2} className="mt-2" value={form.intent_templates?.[key] || ''} onChange={(e) => { isDirty.current = true; setForm(f => ({...f, intent_templates: {...(f.intent_templates||{}), [key]: e.target.value}})); }} />
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

        {/* ── Proactive Outreach: build & appointment reminders (Task #674) ── */}
        <div className="border-t pt-6 mt-6 space-y-5">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-amber-600" />
            <h3 className="text-lg font-semibold">Proactive Outreach</h3>
          </div>
          <p className="text-sm text-gray-500 -mt-2">
            Reminders <span className="capitalize font-medium">Alex</span> sends to customers. Every message clearly says it comes from an AI assistant.
          </p>

          <div>
            <Label>AI identification line</Label>
            <Input
              className="mt-2"
              value={form.ai_identification_line}
              onChange={(e) => onChange("ai_identification_line", e.target.value)}
              data-testid="input-ai-identification-line"
            />
            <p className="text-xs text-gray-500 mt-1">{`Added to the start of every automated customer text so it's clear it's AI. Use {assistant} and {company}.`}</p>
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <Label className="text-sm font-medium">Send appointment reminders to customers</Label>
                <p className="text-xs text-gray-500 mt-1">Automatically texts/emails customers before their scheduled inspection (24 hours and 1 hour before).</p>
              </div>
              <Switch
                checked={form.appointment_reminders_customer_enabled}
                onCheckedChange={(v) => onChange("appointment_reminders_customer_enabled", v)}
                data-testid="switch-appointment-reminders"
              />
            </div>

            {form.appointment_reminders_customer_enabled && (
              <div className="flex items-center justify-between rounded-lg border border-dashed p-3 bg-gray-50">
                <div className="pr-4">
                  <Label className="text-sm font-medium">Call the customer with an AI voice reminder instead of texting</Label>
                  <p className="text-xs text-gray-500 mt-1">Off = send a text (recommended). On = <span className="capitalize">Alex</span> places an automated voice call. Either way it identifies itself as AI and only reaches out during business hours.</p>
                </div>
                <Switch
                  checked={form.appointment_reminder_ai_call_enabled}
                  onCheckedChange={(v) => onChange("appointment_reminder_ai_call_enabled", v)}
                  data-testid="switch-appointment-reminder-ai-call"
                />
              </div>
            )}

            <div className="pt-2 border-t">
              <Label>Default inspector for new appointments</Label>
              <Select
                value={form.default_inspector_email || "__none__"}
                onValueChange={(v) => onChange("default_inspector_email", v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="mt-2" data-testid="select-default-inspector">
                  <SelectValue placeholder="Whoever approves the appointment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Whoever approves the appointment</SelectItem>
                  {staffProfiles
                    .filter((s) => s.user_email || s.email)
                    .map((s) => {
                      const email = s.user_email || s.email;
                      return (
                        <SelectItem key={email} value={email}>
                          {s.full_name || s.name || email}
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">
                When your team approves an appointment request in Action Items, it's pre-assigned to this person. They get an instant notification and a text on their cell — and another heads-up when the customer replies to confirm.
              </p>
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <Label className="text-sm font-medium">Confirm new leads with Alex</Label>
                <p className="text-xs text-gray-500 mt-1">When a team member turns on Alex outreach for a lead, Alex immediately sends an AI-identified confirmation text. If the homeowner does not reply, Alex can call after the selected wait time.</p>
              </div>
              <Switch
                checked={form.lead_confirmation_outreach_enabled}
                onCheckedChange={(v) => onChange("lead_confirmation_outreach_enabled", v)}
                data-testid="switch-lead-confirmation-outreach"
              />
            </div>
            {form.lead_confirmation_outreach_enabled && (
              <div className="space-y-4 pt-2 border-t">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Call if there is no reply after</Label>
                    <div className="flex items-center gap-2 mt-2">
                      <Input type="number" min={5} max={240} value={form.lead_confirmation_wait_minutes} onChange={(e) => onChange("lead_confirmation_wait_minutes", Math.min(240, Math.max(5, Number(e.target.value) || 30)))} data-testid="input-lead-confirmation-wait" />
                      <span className="text-sm text-gray-500 whitespace-nowrap">minutes</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-dashed p-3 bg-gray-50">
                  <div className="pr-4">
                    <Label className="text-sm font-medium">Call homeowners who do not reply</Label>
                    <p className="text-xs text-gray-500 mt-1">Alex identifies itself as AI at the start of the call. If a call cannot be placed, it sends one follow-up text instead.</p>
                  </div>
                  <Switch checked={form.lead_confirmation_ai_call_enabled} onCheckedChange={(v) => onChange("lead_confirmation_ai_call_enabled", v)} data-testid="switch-lead-confirmation-ai-call" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="pr-4">
                    <Label className="text-sm font-medium">Only reach out during business hours</Label>
                    <p className="text-xs text-gray-500 mt-1">A lead enrolled after hours stays pending until your next business window. The call timer starts when the text is actually sent.</p>
                  </div>
                  <Switch checked={form.lead_confirmation_respect_business_hours} onCheckedChange={(v) => onChange("lead_confirmation_respect_business_hours", v)} data-testid="switch-lead-confirmation-business-hours" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="pr-4">
                    <Label className="text-sm font-medium">Enroll every new lead automatically</Label>
                    <p className="text-xs text-gray-500 mt-1">Off keeps this manual per lead. Turn it on when you are ready for every new lead to receive Alex’s confirmation text.</p>
                  </div>
                  <Switch checked={form.lead_confirmation_auto_enroll_new_leads} onCheckedChange={(v) => onChange("lead_confirmation_auto_enroll_new_leads", v)} data-testid="switch-lead-confirmation-auto-enroll" />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <Label className="text-sm font-medium">Build/install reminders (you approve each one)</Label>
                <p className="text-xs text-gray-500 mt-1">
                  Before a scheduled roof build, <span className="capitalize">Alex</span> drafts a reminder and puts it in Action Items for your team to review, edit, and approve. Nothing is sent to the customer until someone approves it.
                </p>
              </div>
              <Switch
                checked={form.build_reminders_enabled}
                onCheckedChange={(v) => onChange("build_reminders_enabled", v)}
                data-testid="switch-build-reminders"
              />
            </div>

            {form.build_reminders_enabled && (
              <div className="space-y-4 pt-2 border-t">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Draft the reminder this many days before the build</Label>
                    <Input
                      type="number"
                      min={1}
                      max={14}
                      className="mt-2"
                      value={form.build_reminder_days_before}
                      onChange={(e) => onChange("build_reminder_days_before", Number(e.target.value) || 2)}
                      data-testid="input-build-reminder-days"
                    />
                  </div>
                </div>
                <div>
                  <Label>Reminder message template</Label>
                  <Textarea
                    rows={3}
                    className="mt-2"
                    value={form.build_reminder_template}
                    onChange={(e) => onChange("build_reminder_template", e.target.value)}
                    data-testid="textarea-build-reminder-template"
                  />
                  <p className="text-xs text-gray-500 mt-1">{`Use {customer_name}, {company}, {address}, {build_date}. The AI identification line is added automatically at the start.`}</p>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-dashed p-3 bg-gray-50">
                  <div className="pr-4">
                    <Label className="text-sm font-medium">Have <span className="capitalize">Alex</span> phone the customer instead of texting</Label>
                    <p className="text-xs text-gray-500 mt-1">Off = your approved reminder is sent as a text (recommended). On = when you approve it, <span className="capitalize">Alex</span> places an automated AI voice call instead. You still review and approve every build reminder before anything is sent.</p>
                  </div>
                  <Switch
                    checked={form.build_reminder_ai_call_enabled}
                    onCheckedChange={(v) => onChange("build_reminder_ai_call_enabled", v)}
                    data-testid="switch-build-reminder-ai-call"
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Weekly task-board watch (Task #675) ── */}
          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <Label className="text-sm font-medium">Weekly customer progress updates</Label>
                <p className="text-xs text-gray-500 mt-1">
                  Once a week, if a customer's job moved to a new stage on the Build Schedule, <span className="capitalize">Alex</span> texts them a short, friendly heads-up. Nothing is sent if their job didn't move. Text only — it always identifies itself as AI and only reaches out during business hours.
                </p>
              </div>
              <Switch
                checked={form.weekly_progress_updates_enabled}
                onCheckedChange={(v) => onChange("weekly_progress_updates_enabled", v)}
                data-testid="switch-weekly-progress-updates"
              />
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <Label className="text-sm font-medium">Alert my team about stuck jobs</Label>
                <p className="text-xs text-gray-500 mt-1">
                  When a job sits in the same stage too long, your team gets an internal alert in Action Items with a suggested reason (Stalled / Waiting / Forgotten) they can confirm or change. The customer is never contacted.
                </p>
              </div>
              <Switch
                checked={form.stuck_job_alerts_enabled}
                onCheckedChange={(v) => onChange("stuck_job_alerts_enabled", v)}
                data-testid="switch-stuck-job-alerts"
              />
            </div>

            {form.stuck_job_alerts_enabled && (
              <div className="pt-2 border-t space-y-4">
                <div>
                  <Label>Flag a job as stuck after this many days in the same stage</Label>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    className="mt-2 max-w-[160px]"
                    value={form.stuck_job_threshold_days}
                    onChange={(e) => onChange("stuck_job_threshold_days", Number(e.target.value) || 10)}
                    data-testid="input-stuck-job-threshold"
                  />
                </div>
                <div>
                  <Label>Send a follow-up reminder every this many days if still stuck</Label>
                  <p className="text-xs text-gray-500 mt-1">
                    If a job stays in the same stage after the first alert, your team will receive another nudge after this many additional days. Set to 0 to use the same value as the threshold above.
                  </p>
                  <Input
                    type="number"
                    min={0}
                    max={90}
                    className="mt-2 max-w-[160px]"
                    value={form.stuck_job_re_alert_days}
                    onChange={(e) => onChange("stuck_job_re_alert_days", Number(e.target.value))}
                    placeholder={`0 (= ${form.stuck_job_threshold_days} days)`}
                    data-testid="input-stuck-job-re-alert-days"
                  />
                  {form.stuck_job_re_alert_days === 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      Currently using threshold ({form.stuck_job_threshold_days} days) as the re-alert interval.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={assistantSettingsLoading || saveMutation.isPending || !company?.id}
            className="gap-2"
          >
            <Save className="w-4 h-4" />
            {assistantSettingsLoading ? "Loading Settings..." : saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </Card>
    </div>
  );
}