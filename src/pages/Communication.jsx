import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Phone, Mail, MessageSquare, Search, Settings, Bot, CheckCircle2, AlertCircle, Loader2, Plus, RefreshCw, Sparkles, UserPlus, ExternalLink, Link2, User, Briefcase } from "lucide-react";
import { format } from "date-fns";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import useCompanyTimezone from "@/components/hooks/useCompanyTimezone";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { usePageGuard } from "@/hooks/usePageGuard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

import Dialer from "@/components/communication/Dialer";
import EmailDialog from "@/components/communication/EmailDialog";
import SMSDialog from "@/components/communication/SMSDialog";
import { useNavigate, useLocation } from 'react-router-dom';
import useTranslation from "@/hooks/useTranslation";
import { createPageUrl } from "@/utils";

export default function Communication() {
  usePageGuard({ feature: 'Communication Hub' });
  const isPageVisible = usePageVisibility();
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [contactFilter, setContactFilter] = useState("all");
  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showThoughtlyDialog, setShowThoughtlyDialog] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [thoughtlyAgents, setThoughtlyAgents] = useState([]);
  const [matchDialogComm, setMatchDialogComm] = useState(null);
  const [matchSearchQuery, setMatchSearchQuery] = useState("");
  const [matchingId, setMatchingId] = useState(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [screeningFilter, setScreeningFilter] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get('screening') || 'all';
  });
  const [openPopoverKey, setOpenPopoverKey] = useState(null);
  const [handingBackPhone, setHandingBackPhone] = useState(null);

  // A sender who just submitted a message is linked straight here to watch its
  // delivery outcome, so the deep-linked record has to be findable in a list
  // that can hold hundreds of rows.
  const [focusedCommId, setFocusedCommId] = useState(null);
  const focusedCommRef = React.useRef(null);

  // Sync from the URL on every navigation, not just on mount: the send dialog
  // is usually opened from this very page, so the link that carries the new
  // record's id often arrives while the page is already mounted.
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('comm');
    if (requested) setFocusedCommId(requested);
  }, [location.search]);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);
  const { formatDate, formatTime } = useCompanyTimezone(myCompany);

  const { data: rawCommunications = [], refetch: refetchCommunications } = useQuery({
    queryKey: ['communications', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      console.log('🔍 Fetching communications for company:', myCompany.id);
      const comms = await base44.entities.Communication.filter({ company_id: myCompany.id }, "-created_date", 500);
      console.log('📊 Found communications:', comms.length);
      return Array.isArray(comms) ? comms : [];
    },
    enabled: !!myCompany && isPageVisible,
    refetchInterval: 30000, // Fallback poll every 30 seconds (SSE handles real-time updates)
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!myCompany?.id) return;
    const es = new EventSource(`/api/live-call-events?companyId=${myCompany.id}`);
    const handleUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ['communications', myCompany.id] });
    };
    es.addEventListener('live-call-update', handleUpdate);
    es.onerror = () => {};
    return () => { es.removeEventListener('live-call-update', handleUpdate); es.close(); };
  }, [myCompany?.id, queryClient]);

  // Scroll the deep-linked record into view once it has actually rendered, then
  // drop the query param so a later refresh does not re-scroll the page.
  useEffect(() => {
    if (!focusedCommId) return;
    if (!rawCommunications.some((comm) => comm?.id === focusedCommId)) return;
    const timer = setTimeout(() => {
      focusedCommRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    const params = new URLSearchParams(location.search);
    if (params.get('comm')) {
      params.delete('comm');
      const query = params.toString();
      navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
    }
    return () => clearTimeout(timer);
  }, [focusedCommId, rawCommunications, location.search, location.pathname, navigate]);

  const { data: myStaffProfile } = useQuery({
    queryKey: ['my-staff-profile', myCompany?.id, user?.email],
    queryFn: async () => {
      if (!myCompany || !user?.email) return null;
      const results = await base44.entities.StaffProfile.filter({ company_id: myCompany.id, user_email: user.email });
      return results[0] || null;
    },
    enabled: !!myCompany && !!user?.email,
  });

  const isAdmin = (user?.email && myCompany?.created_by && user.email === myCompany.created_by)
    || myStaffProfile?.is_administrator === true;

  const goToTwilioToggle = (focus) => {
    navigate(`/settings?tab=integrations&twilio=1&focus=${focus}`);
  };

  const enableFeatureMutation = useMutation({
    mutationFn: async ({ field }) => {
      if (!twilioConfig?.id) throw new Error('Twilio settings not found');
      return await base44.entities.TwilioSettings.update(twilioConfig.id, { [field]: true });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['twilio-settings', myCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ['twilio-settings'] });
      const labels = {
        enable_transcription: 'Transcription enabled',
        enable_ai_summary: "Alex's call summary enabled",
        enable_sms_auto_summary: 'SMS auto-summary enabled',
      };
      toast({ title: labels[variables.field] || 'Feature enabled', description: 'Future calls and messages will use this setting.' });
      setOpenPopoverKey(null);
    },
    onError: (err) => {
      toast({ title: 'Could not enable feature', description: err.message, variant: 'destructive' });
    },
  });

  const FEATURE_COPY = {
    enable_transcription: {
      title: 'Enable transcription?',
      description: 'New calls will be transcribed automatically. This applies to future calls only.',
      field: 'enable_transcription',
    },
    enable_ai_summary: {
      title: "Enable Alex's call summary?",
      description: "Alex will summarize transcribed calls automatically. Applies to future calls only.",
      field: 'enable_ai_summary',
    },
    enable_sms_auto_summary: {
      title: 'Enable SMS auto-summary?',
      description: 'Alex will summarize SMS threads on demand. Applies to future requests.',
      field: 'enable_sms_auto_summary',
    },
  };

  const renderEnablePopover = (commId, featureKey, focusKey, triggerEl) => {
    const popoverKey = `${commId}-${featureKey}`;
    const copy = FEATURE_COPY[featureKey];
    return (
      <Popover open={openPopoverKey === popoverKey} onOpenChange={(o) => setOpenPopoverKey(o ? popoverKey : null)}>
        <PopoverTrigger asChild>{triggerEl}</PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">{copy.title}</h4>
              <p className="text-xs text-gray-600 mt-1">{copy.description}</p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                onClick={() => enableFeatureMutation.mutate({ field: copy.field })}
                disabled={enableFeatureMutation.isPending}
                data-testid={`button-enable-${featureKey}-${commId}`}
              >
                {enableFeatureMutation.isPending && enableFeatureMutation.variables?.field === copy.field ? (
                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Enabling…</>
                ) : (
                  'Enable now'
                )}
              </Button>
              <button
                type="button"
                onClick={() => { setOpenPopoverKey(null); goToTwilioToggle(focusKey); }}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 underline underline-offset-2"
                data-testid={`link-open-twilio-setup-${featureKey}-${commId}`}
              >
                Open Twilio Setup
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const { data: twilioConfig } = useQuery({
    queryKey: ['twilio-settings', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return null;
      const settings = await base44.entities.TwilioSettings.filter({ company_id: myCompany.id });
      return settings[0] || null;
    },
    enabled: !!myCompany,
  });

  // Filter out invalid communications with comprehensive checks
  const validCommunications = React.useMemo(() => {
    if (!Array.isArray(rawCommunications)) return [];
    
    return rawCommunications.filter(comm => {
      // Must be an object
      if (!comm || typeof comm !== 'object') return false;
      // Must have communication_type or type
      if (!comm.communication_type && !comm.type) return false;
      // Must have id
      if (!comm.id) return false;
      
      return true;
    });
  }, [rawCommunications]);

  const stats = React.useMemo(() => {
    return {
      total: validCommunications.length,
      calls: validCommunications.filter(c => c && c.communication_type === 'call').length,
      emails: validCommunications.filter(c => c && c.communication_type === 'email').length,
      sms: validCommunications.filter(c => c && (c.communication_type === 'sms' || c.communication_type === 'whatsapp')).length,
    };
  }, [validCommunications]);

  const liveCalls = React.useMemo(() => {
    return validCommunications.filter(comm =>
      comm.status === 'in_progress' || comm.data?.live === true
    );
  }, [validCommunications]);

  const hasScreeningOutcomes = React.useMemo(() => {
    return validCommunications.some(
      comm => comm.communication_type === 'call' && (comm.data?.screening_outcome || comm.screening_outcome)
    );
  }, [validCommunications]);

  const filteredComms = React.useMemo(() => {
    return validCommunications.filter(comm => {
      const type = comm.communication_type || comm.type;
      const normalizedType = (type === 'whatsapp') ? 'sms' : type;
      const matchesSearch = 
        (comm.contact_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (comm.message || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (comm.subject || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (comm.transcription || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (comm.body || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesType = typeFilter === "all" || normalizedType === typeFilter;

      let matchesContact = true;
      if (contactFilter === "customer") {
        matchesContact = !!comm.customer_id;
      } else if (contactFilter === "lead") {
        matchesContact = !!comm.lead_id && !comm.customer_id;
      } else if (contactFilter === "unmatched") {
        matchesContact = !comm.customer_id && !comm.lead_id;
      }

      let matchesScreening = true;
      if (screeningFilter !== "all") {
        const outcome = comm.data?.screening_outcome || comm.screening_outcome;
        matchesScreening = outcome === screeningFilter;
      }

      return matchesSearch && matchesType && matchesContact && matchesScreening;
    });
  }, [validCommunications, searchTerm, typeFilter, contactFilter, screeningFilter]);

  const handleCreateThoughtlyAgent = async () => {
    if (!myCompany?.id) {
      alert('Please complete company setup first');
      return;
    }
    if (!twilioConfig) {
      alert('Twilio settings not found. Please set up Twilio in settings.');
      return;
    }

    setIsCreatingAgent(true);
    try {
      const response = await base44.functions.invoke('createThoughtlyAgent', {
        companyId: myCompany.id,
        twilioSettingsId: twilioConfig.id
      });

      alert('✅ Thoughtly AI agent created successfully! Your AI phone receptionist is ready.');
      setShowThoughtlyDialog(false);
      queryClient.invalidateQueries({ queryKey: ['twilio-settings', myCompany?.id] });
    } catch (error) {
      console.error('Failed to create agent:', error);
      alert(`Failed to create agent: ${error.message}`);
    }
    setIsCreatingAgent(false);
  };

  const handleListThoughtlyAgents = async () => {
    setIsLoadingAgents(true);
    try {
      const response = await base44.functions.invoke('listThoughtlyAgents', {});
      setThoughtlyAgents(response.data.agents || []);
    } catch (error) {
      console.error('Failed to load agents:', error);
      const backendError = error.response?.data?.error || error.message;
      const help = error.response?.data?.help || '';
      alert(`Failed to load agents: ${backendError}. ${help}`);
    }
    setIsLoadingAgents(false);
  };

  useEffect(() => {
    if (showThoughtlyDialog) {
      handleListThoughtlyAgents();
    }
  }, [showThoughtlyDialog]);

  const [addingLeadCommId, setAddingLeadCommId] = useState(null);
  const [retryingTranscriptionId, setRetryingTranscriptionId] = useState(null);
  // Snapshot of the transcription at the moment a retry was kicked off, so we
  // can detect when the backend has produced a new transcript and stop polling.
  const [retrySnapshot, setRetrySnapshot] = useState(null);

  // While a retry is pending, refresh the communications list every 5s so the
  // updated transcript appears as soon as the backend writes it.
  useEffect(() => {
    if (!retrySnapshot || !myCompany?.id) return;

    const POLL_INTERVAL_MS = 5000;
    const MAX_DURATION_MS = 120000;

    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['communications', myCompany.id] });
    }, POLL_INTERVAL_MS);

    const timeout = setTimeout(() => {
      setRetrySnapshot(null);
      setRetryingTranscriptionId(null);
      toast({
        title: 'Still working on the transcript',
        description: 'Transcription is taking longer than expected. It will appear here as soon as it’s ready.',
      });
    }, MAX_DURATION_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [retrySnapshot, myCompany?.id, queryClient, toast]);

  // Watch the live communications list for the moment the transcription
  // changes from its pre-retry value (or the row is otherwise updated by the
  // backend), then notify and stop polling. Tracking `updated_date` in
  // addition to the transcription text means a forced re-transcribe that
  // happens to produce identical text will still resolve cleanly.
  useEffect(() => {
    if (!retrySnapshot) return;
    const updated = rawCommunications.find((c) => c.id === retrySnapshot.commId);
    if (!updated) return;
    const newTranscription = updated.transcription || '';
    const newUpdatedAt = updated.updated_date || updated.updated_at || null;

    const transcriptChanged = newTranscription !== retrySnapshot.originalTranscription;
    const rowTouched = !!(
      newUpdatedAt &&
      retrySnapshot.originalUpdatedAt &&
      new Date(newUpdatedAt).getTime() > new Date(retrySnapshot.originalUpdatedAt).getTime()
    );
    if (!transcriptChanged && !rowTouched) return;

    const isFailure = /^\[Transcription (failed|unavailable)/.test(newTranscription);
    if (isFailure) {
      toast({
        title: 'Transcription failed',
        description: newTranscription || 'The recording could not be transcribed.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Transcript ready',
        description: 'The transcript has been updated.',
      });
    }
    setRetrySnapshot(null);
    setRetryingTranscriptionId(null);
  }, [rawCommunications, retrySnapshot, toast]);

  const handleRetryTranscription = async (comm) => {
    if (!myCompany?.id) return;

    const transcription = comm.transcription || '';
    const isFailed = !transcription || /^\[Transcription (failed|unavailable)/.test(transcription);

    let force = false;
    if (!isFailed) {
      const ok = window.confirm(
        'This call already has a transcription — are you sure you want to replace it?\n\nThe existing transcript will be overwritten with a fresh one from the recording.'
      );
      if (!ok) return;
      force = true;
    }

    setRetryingTranscriptionId(comm.id);
    try {
      const result = await base44.functions.invoke('retryTranscription', {
        communicationId: comm.id,
        companyId: myCompany.id,
        force,
      });
      if (result?.success) {
        toast({
          title: 'Transcription started',
          description: 'We’ll refresh the transcript automatically once it’s ready.',
        });
        // Capture the pre-retry value so the polling effect can tell when the
        // backend has actually written a new transcription. Spinner stays on
        // the button until polling resolves. We also remember the row's
        // `updated_date` so a forced re-transcribe that produces identical
        // text still resolves the moment the row is touched.
        setRetrySnapshot({
          commId: comm.id,
          originalTranscription: transcription,
          originalUpdatedAt: comm.updated_date || comm.updated_at || null,
        });
        queryClient.invalidateQueries({ queryKey: ['communications', myCompany.id] });
      } else {
        toast({ title: 'Transcription failed', description: result?.error || 'Unknown error', variant: 'destructive' });
        setRetryingTranscriptionId(null);
      }
    } catch (err) {
      toast({ title: 'Retry failed', description: err.message, variant: 'destructive' });
      setRetryingTranscriptionId(null);
    }
  };

  const { data: matchCustomers = [] } = useQuery({
    queryKey: ['match-customers', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const list = await base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_at", 500);
      return Array.isArray(list) ? list : [];
    },
    enabled: !!myCompany && !!matchDialogComm,
    staleTime: 60_000,
  });

  const { data: matchLeads = [] } = useQuery({
    queryKey: ['match-leads', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const list = await base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", 500);
      return Array.isArray(list) ? list : [];
    },
    enabled: !!myCompany && !!matchDialogComm,
    staleTime: 60_000,
  });

  const matchResults = React.useMemo(() => {
    if (!matchDialogComm) return { customers: [], leads: [] };
    const q = matchSearchQuery.trim().toLowerCase();
    const matchOne = (entity) => {
      if (!q) return true;
      return (
        (entity.name || '').toLowerCase().includes(q) ||
        (entity.phone || '').toLowerCase().includes(q) ||
        (entity.email || '').toLowerCase().includes(q) ||
        (entity.address || '').toLowerCase().includes(q)
      );
    };
    return {
      customers: matchCustomers.filter(matchOne).slice(0, 25),
      leads: matchLeads.filter(matchOne).slice(0, 25),
    };
  }, [matchDialogComm, matchSearchQuery, matchCustomers, matchLeads]);

  const openMatchDialog = (comm) => {
    setMatchDialogComm(comm);
    // Pre-fill the search with the most useful identifier from the comm
    setMatchSearchQuery(comm.contact_name || comm.contact_phone || comm.contact_email || "");
  };

  const closeMatchDialog = () => {
    setMatchDialogComm(null);
    setMatchSearchQuery("");
    setMatchingId(null);
  };

  const handleMatchTo = async (kind, entity) => {
    if (!matchDialogComm) return;
    const fieldKey = kind === 'customer' ? 'customer_id' : 'lead_id';
    setMatchingId(`${kind}-${entity.id}`);
    try {
      await base44.entities.Communication.update(matchDialogComm.id, { [fieldKey]: entity.id });
      queryClient.invalidateQueries({ queryKey: ['communications', myCompany?.id] });
      toast({
        title: kind === 'customer' ? 'Linked to customer' : 'Linked to lead',
        description: `This ${(matchDialogComm.communication_type || 'communication')} is now linked to ${entity.name || (kind === 'customer' ? 'this customer' : 'this lead')}.`,
      });
      closeMatchDialog();
    } catch (err) {
      toast({ title: 'Could not link', description: err.message, variant: 'destructive' });
      setMatchingId(null);
    }
  };

  const handleAddAsLead = async (comm) => {
    if (!myCompany?.id) {
      toast({ title: 'Company not found', variant: 'destructive' });
      return;
    }
    setAddingLeadCommId(comm.id);
    try {
      // Check for existing lead by phone first, then by email if no phone match,
      // so callers who only share an email don't slip past the duplicate guard.
      let existingMatch = null;
      let matchedBy = null;
      if (comm.contact_phone) {
        const byPhone = await base44.entities.Lead.filter({ company_id: myCompany.id, phone: comm.contact_phone });
        if (byPhone && byPhone.length > 0) {
          existingMatch = byPhone[0];
          matchedBy = 'number';
        }
      }
      if (!existingMatch && comm.contact_email) {
        const byEmail = await base44.entities.Lead.filter({ company_id: myCompany.id, email: comm.contact_email });
        if (byEmail && byEmail.length > 0) {
          existingMatch = byEmail[0];
          matchedBy = 'email';
        }
      }
      if (existingMatch) {
        // Backfill lead_id on the communication so the 'Add as Lead' button hides
        // and we don't repeat the duplicate look-up next time.
        if (!comm.lead_id) {
          try {
            await base44.entities.Communication.update(comm.id, { lead_id: existingMatch.id });
            queryClient.invalidateQueries({ queryKey: ['communications', myCompany?.id] });
          } catch (linkErr) {
            console.error('Failed to backfill lead_id on communication:', linkErr);
          }
        }
        toast({
          title: 'Lead already exists',
          description: `${existingMatch.name || comm.contact_phone || comm.contact_email} is already a lead for this ${matchedBy}. Opening their profile.`,
        });
        navigate(createPageUrl('LeadProfile') + `?id=${existingMatch.id}`);
        return;
      }
      const newLead = await base44.entities.Lead.create({
        company_id: myCompany.id,
        name: comm.contact_name || comm.contact_phone || 'Unknown Caller',
        phone: comm.contact_phone || '',
        email: comm.contact_email || '',
        status: 'new',
        source: 'phone',
      });
      // Backfill lead_id on the communication so the 'Add as Lead' button hides immediately.
      try {
        await base44.entities.Communication.update(comm.id, { lead_id: newLead.id });
      } catch (linkErr) {
        console.error('Failed to backfill lead_id on communication:', linkErr);
      }
      queryClient.invalidateQueries({ queryKey: ['communications', myCompany?.id] });
      toast({ title: 'Lead created', description: `${newLead.name} has been added as a lead.` });
      navigate(createPageUrl('LeadProfile') + `?id=${newLead.id}`);
    } catch (err) {
      toast({ title: 'Could not create lead', description: err.message, variant: 'destructive' });
    } finally {
      setAddingLeadCommId(null);
    }
  };

  // Determine which contact phones are currently "rep-owned" (Alex is paused).
  // A phone is rep-owned when its most recent outbound message has sent_by_rep === true.
  // We check all outbound types — matching the backend inbound-webhook ownership check
  // (prod-server.cjs ~line 740), which queries all outbound records without type filtering.
  // In practice only SMS records carry sent_by_rep, but we align predicates to avoid
  // a mismatch if a call record is inserted between the SMS and the next inbound.
  const repOwnedPhones = React.useMemo(() => {
    const latestOutboundByPhone = new Map();
    validCommunications.forEach((comm) => {
      if (comm.direction === 'outbound' && comm.contact_phone) {
        const existing = latestOutboundByPhone.get(comm.contact_phone);
        if (!existing || new Date(comm.created_date || 0) > new Date(existing.created_date || 0)) {
          latestOutboundByPhone.set(comm.contact_phone, comm);
        }
      }
    });
    const owned = new Set();
    latestOutboundByPhone.forEach((comm, phone) => {
      if (comm.data?.sent_by_rep === true || comm.data?.sent_by_rep === 'true') {
        owned.add(phone);
      }
    });
    return owned;
  }, [validCommunications]);

  const handleHandBackToSarah = async (comm) => {
    if (!myCompany?.id || !comm.contact_phone) return;
    setHandingBackPhone(comm.contact_phone);
    try {
      const resp = await base44.functions.invoke('handBackToSarah', {
        companyId: myCompany.id,
        contactPhone: comm.contact_phone,
      });
      if (resp?.data?.success) {
        toast({
          title: 'Alex is back in control',
          description: `Alex will now auto-reply to messages from ${comm.contact_name || comm.contact_phone}.`,
        });
        queryClient.invalidateQueries({ queryKey: ['communications', myCompany.id] });
      } else {
        toast({ title: 'Could not hand back to Alex', description: resp?.data?.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Could not hand back to Alex', description: err.message, variant: 'destructive' });
    } finally {
      setHandingBackPhone(null);
    }
  };

  const handleCallClick = (comm) => {
    setSelectedContact({ phone: comm.contact_phone, name: comm.contact_name });
    setShowDialer(true);
  };

  const handleSMSClick = (comm) => {
    setSelectedContact({
      phone: comm.contact_phone,
      name: comm.contact_name,
      from: comm.data?.company_phone || null,
    });
    setShowSMSDialog(true);
  };

  const handleEmailClick = (comm) => {
    setSelectedContact({ email: comm.contact_email, name: comm.contact_name });
    setShowEmailDialog(true);
  };

  const getTypeIcon = (type) => {
    if (!type) return Phone; // Default icon
    const icons = {
      email: Mail,
      call: Phone,
      sms: MessageSquare,
      meeting: Bot, // Changed to Bot for general non-specific types, as per outline context
      note: Bot // Changed to Bot for general non-specific types
    };
    return icons[type] || Bot;
  };

  const getTypeColor = (type) => {
    if (!type) return { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' };
    const colors = {
      email: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
      call: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
      sms: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
      meeting: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
      note: { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' }
    };
    return colors[type] || { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' };
  };

  // Provider acceptance and inbox delivery are different facts, and the gap
  // between them is where a "sent" message silently disappears. Give each
  // outcome its own label and colour so nobody reads "submitted" as "arrived".
  const EMAIL_DELIVERY_PRESENTATION = {
    pending: {
      label: 'Sending',
      className: 'bg-gray-100 text-gray-700 border-gray-300',
      title: 'This message has not been handed to the delivery provider yet.',
    },
    submitted: {
      label: 'Submitted',
      className: 'bg-amber-50 text-amber-800 border-amber-300',
      title: 'The delivery provider accepted the send request. Inbox delivery has not been confirmed yet.',
    },
    delivered: {
      label: 'Delivered',
      className: 'bg-green-50 text-green-700 border-green-300',
      title: 'The provider confirmed the receiving mail server accepted this message.',
    },
    bounced: {
      label: 'Bounced',
      className: 'bg-red-50 text-red-700 border-red-300',
      title: 'The receiving mail server rejected this message. It did not reach the recipient.',
    },
    complained: {
      label: 'Marked as spam',
      className: 'bg-red-50 text-red-700 border-red-300',
      title: 'The recipient reported this message as spam.',
    },
    failed: {
      label: 'Failed',
      className: 'bg-red-50 text-red-700 border-red-300',
      title: 'The message was never accepted by the delivery provider.',
    },
    skipped: {
      label: 'Skipped',
      className: 'bg-gray-100 text-gray-600 border-gray-300',
      title: 'This message was never attempted.',
    },
  };

  // Rows written before delivery tracking existed only have the send-time
  // status column, so fall back to it rather than showing nothing.
  const LEGACY_STATUS_TO_DELIVERY_STATE = {
    pending: 'pending',
    accepted: 'submitted',
    sent: 'submitted',
    queued: 'submitted',
    delivered: 'delivered',
    bounced: 'bounced',
    complained: 'complained',
    failed: 'failed',
    skipped: 'skipped',
  };

  const getEmailDeliveryPresentation = (comm) => {
    const isEmail = (comm.communication_type || comm.type) === 'email';
    if (!isEmail) return null;
    const state = comm.data?.delivery_status
      || LEGACY_STATUS_TO_DELIVERY_STATE[String(comm.status || '').toLowerCase()]
      || null;
    if (!state) return null;
    const presentation = EMAIL_DELIVERY_PRESENTATION[state];
    if (!presentation) return null;
    const detail = comm.data?.delivery_detail || comm.data?.error;
    return {
      ...presentation,
      title: detail ? `${presentation.title} — ${detail}` : presentation.title,
      state,
    };
  };

  return (
    <div className="p-3 sm:p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.communication.title}</h1>
          <p className="text-gray-500 mt-1">{t.communication.subtitle || "All customer interactions in one place"}</p>
        </div>
        <Button
          onClick={() => refetchCommunications()}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          {t.common.refresh}
        </Button>
      </div>

      {liveCalls.length > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-50 border border-red-300 text-red-800"
          data-testid="banner-live-calls"
        >
          <span className="relative flex h-3 w-3 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600" />
          </span>
          <Phone className="w-4 h-4 flex-shrink-0 text-red-600" />
          <span className="font-semibold text-sm">
            {liveCalls.length === 1
              ? '1 call in progress right now'
              : `${liveCalls.length} calls in progress right now`}
            {liveCalls.some(c => c.contact_name) && (
              <span className="font-normal ml-1">
                — {liveCalls.map(c => c.contact_name || 'Unknown').join(', ')}
              </span>
            )}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Button
          onClick={() => navigate('/settings')}
          variant="outline"
          className="h-24 flex-col gap-2 text-left justify-start items-start hover:border-blue-500 hover:bg-blue-50"
        >
          <Settings className="w-6 h-6 text-gray-600" />
          <span className="font-semibold">{t.sidebar.integrations || "Twilio Setup"}</span>
        </Button>

        <Button
          onClick={() => setShowDialer(true)}
          className="h-24 flex-col gap-2 bg-green-600 hover:bg-green-700 text-white"
        >
          <Phone className="w-6 h-6" />
          <span className="font-semibold">{t.communication.callLog}</span>
        </Button>

        <Button
          onClick={() => setShowSMSDialog(true)}
          className="h-24 flex-col gap-2 bg-purple-600 hover:bg-purple-700 text-white"
        >
          <MessageSquare className="w-6 h-6" />
          <span className="font-semibold">{t.communication.smsHistory}</span>
        </Button>

        <Button
          onClick={() => setShowEmailDialog(true)}
          className="h-24 flex-col gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Mail className="w-6 h-6" />
          <span className="font-semibold">{t.communication.emailThreads}</span>
        </Button>
      </div>

      {/* Alex AI Assistant Card */}
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="p-3 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="w-8 h-8 text-blue-600" />
              <div>
                <h3 className="font-semibold text-lg">{t.ai.sarah} Assistant</h3>
                <p className="text-sm text-gray-500">{t.communication.sarahSubtitle || "Native AI for SMS + Voice calls with full CRM control"}</p>
              </div>
            </div>
            
            <Button 
              onClick={() => navigate('/SarahSettings')}
              variant="outline"
            >
              <Settings className="w-4 h-4 mr-2" />
              {t.common.configure || "Configure"} {t.ai.sarah}
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto mb-1" />
              <p className="text-sm font-semibold text-green-900">SMS {t.common.active}</p>
              <p className="text-xs text-green-600">{stats.sms} {t.dashboard.today}</p>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-orange-600 mx-auto mb-1" />
              <p className="text-sm font-semibold text-orange-900">Voice: {t.common.inactive || "Not Active"}</p>
              <p className="text-xs text-orange-600">{t.communication.setupNeeded || "Setup needed"}</p>
            </div>
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <Bot className="w-5 h-5 text-blue-600 mx-auto mb-1" />
              <p className="text-sm font-semibold text-blue-900">0 {t.calendar.appointments || "Appointments"}</p>
              <p className="text-xs text-blue-600">{t.common.booked || "Booked"} {t.dashboard.today}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SOFT-HIDDEN: Thoughtly AI Card - disabled platform-wide */}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-3 sm:p-6">
            <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
            <p className="text-sm text-gray-500">{t.common.total} {t.communication.title}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-green-100">
          <CardContent className="p-3 sm:p-6">
            <div className="text-3xl font-bold text-green-700">{stats.calls}</div>
            <p className="text-sm text-green-600">{t.communication.callLog}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100">
          <CardContent className="p-3 sm:p-6">
            <div className="text-3xl font-bold text-purple-700">{stats.sms}</div>
            <p className="text-sm text-purple-600">{t.communication.smsHistory}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100">
          <CardContent className="p-3 sm:p-6">
            <div className="text-3xl font-bold text-orange-700">0</div>
            <p className="text-sm text-orange-600">{t.communication.emailThreads || "Email Threads"}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-6">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              placeholder={`${t.common.search}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-communications"
            />
          </div>

          <Tabs defaultValue="all" value={typeFilter} onValueChange={setTypeFilter}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all">{t.common.all}</TabsTrigger>
              <TabsTrigger value="call">{t.communication.callLog}</TabsTrigger>
              <TabsTrigger value="sms">{t.communication.smsHistory}</TabsTrigger>
              <TabsTrigger value="email">{t.communication.emailThreads}</TabsTrigger>
            </TabsList>

            <Tabs value={contactFilter} onValueChange={setContactFilter} className="mt-3">
              <TabsList className="grid w-full grid-cols-4 h-9">
                <TabsTrigger value="all" className="text-xs" data-testid="tab-contact-all">All contacts</TabsTrigger>
                <TabsTrigger value="customer" className="text-xs" data-testid="tab-contact-customer">Customers</TabsTrigger>
                <TabsTrigger value="lead" className="text-xs" data-testid="tab-contact-lead">Leads</TabsTrigger>
                <TabsTrigger value="unmatched" className="text-xs" data-testid="tab-contact-unmatched">Unmatched</TabsTrigger>
              </TabsList>
            </Tabs>

            {hasScreeningOutcomes && (
              <Tabs value={screeningFilter} onValueChange={setScreeningFilter} className="mt-3">
                <TabsList className="grid w-full grid-cols-4 h-9">
                  <TabsTrigger value="all" className="text-xs" data-testid="tab-screening-all">All outcomes</TabsTrigger>
                  <TabsTrigger value="approved" className="text-xs" data-testid="tab-screening-transferred">Transferred</TabsTrigger>
                  <TabsTrigger value="self_handled" className="text-xs" data-testid="tab-screening-self-handled">Self-Handled</TabsTrigger>
                  <TabsTrigger value="declined" className="text-xs" data-testid="tab-screening-declined">Declined</TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            <TabsContent value={typeFilter} className="space-y-4 mt-4">
              {filteredComms.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <h3 className="text-lg font-semibold mb-2">{t.communication.noMessages}</h3>
                  <p>{t.communication.noMessagesSubtitle || "Start by making a call, sending an SMS, or emailing a customer"}</p>
                </div>
              ) : (
                filteredComms.map((comm) => {
                  if (!comm || !comm.id || !comm.communication_type) return null;
                  
                  const Icon = getTypeIcon(comm.communication_type);
                  const typeColors = getTypeColor(comm.communication_type);
                  
                  const isLive = comm.status === 'in_progress' || comm.data?.live === true;
                  const deliveryPresentation = getEmailDeliveryPresentation(comm);
                  const isFocused = focusedCommId === comm.id;
                  return (
                    <Card
                      key={comm.id}
                      ref={isFocused ? focusedCommRef : undefined}
                      data-testid={`card-communication-${comm.id}`}
                      className={`hover:shadow-md transition-shadow${isLive ? ' border-red-400 ring-1 ring-red-300' : ''}${isFocused ? ' border-blue-500 ring-2 ring-blue-300' : ''}`}>
                      <CardContent className="p-3 sm:p-6">
                        <div className="flex items-start gap-4">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${getTypeColor(comm.communication_type || comm.type).bg}`}>
                            {React.createElement(getTypeIcon(comm.communication_type || comm.type), { className: `w-6 h-6 ${getTypeColor(comm.communication_type || comm.type).text}` })}
                          </div>
                          
                          <div className="flex-1">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <h3 className="font-semibold text-lg flex items-center gap-1">
                                  {comm.customer_id ? (
                                    <button
                                      type="button"
                                      className="text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                                      onClick={() => navigate(createPageUrl('CustomerProfile') + `?id=${comm.customer_id}`)}
                                      data-testid={`link-customer-${comm.id}`}
                                    >
                                      {comm.contact_name || comm.contact_phone || 'Unknown Contact'}
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </button>
                                  ) : comm.lead_id ? (
                                    <button
                                      type="button"
                                      className="text-green-600 hover:text-green-800 hover:underline flex items-center gap-1"
                                      onClick={() => navigate(createPageUrl('LeadProfile') + `?id=${comm.lead_id}`)}
                                      data-testid={`link-lead-${comm.id}`}
                                    >
                                      {comm.contact_name || comm.contact_phone || 'Unknown Contact'}
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </button>
                                  ) : (
                                    comm.contact_name || comm.contact_phone || 'Unknown Contact'
                                  )}
                                </h3>
                                {comm.customer_id && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200 mt-0.5 w-fit" data-testid={`badge-customer-${comm.id}`}>
                                    Customer
                                  </span>
                                )}
                                {!comm.customer_id && comm.lead_id && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 border border-green-200 mt-0.5 w-fit" data-testid={`badge-lead-${comm.id}`}>
                                    Lead
                                  </span>
                                )}
                                {comm.contact_name && comm.contact_phone && (
                                  <p className="text-xs text-gray-400 mt-0.5">{comm.contact_phone}</p>
                                )}
                                {comm.direction === 'outbound' && (comm.data?.sent_by || comm.created_by) && (
                                  <p className="text-xs text-blue-600 mt-0.5">
                                    Sent by: {comm.data?.sent_by || comm.created_by}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <Badge variant="outline" className={`${getTypeColor(comm.communication_type || comm.type).bg} ${getTypeColor(comm.communication_type || comm.type).text} ${getTypeColor(comm.communication_type || comm.type).border}`}>
                                    {t.communication[comm.communication_type] || comm.communication_type || comm.type}
                                  </Badge>
                                  {comm.direction && <Badge variant="outline" className="capitalize">{comm.direction === 'inbound' ? t.communication.inbound : comm.direction === 'outbound' ? t.communication.outbound : comm.direction}</Badge>}
                                {(comm.communication_type === 'sms' || comm.communication_type === 'whatsapp') && comm.contact_phone && repOwnedPhones.has(comm.contact_phone) && (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300"
                                    title="A rep sent the last message — Alex is currently paused for this thread"
                                    data-testid={`badge-sarah-paused-${comm.id}`}
                                  >
                                    <Bot className="w-3 h-3" />
                                    Alex paused
                                  </span>
                                )}
                                  {(comm.status === 'in_progress' || comm.data?.live === true) ? (
                                    <span
                                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-red-600 text-white shadow-sm"
                                      title={t.communication.liveCallInProgress || "This call is currently in progress"}
                                      data-testid={`badge-live-${comm.id}`}
                                    >
                                      <span className="relative flex w-1.5 h-1.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                                      </span>
                                      {t.communication.liveNow || "LIVE"}
                                    </span>
                                  ) : deliveryPresentation ? (
                                    <Badge
                                      variant="outline"
                                      className={deliveryPresentation.className}
                                      title={deliveryPresentation.title}
                                      data-testid={`badge-email-delivery-${comm.id}`}
                                    >
                                      {deliveryPresentation.label}
                                    </Badge>
                                  ) : (comm.status || comm.data?.status) ? (
                                    <Badge variant="outline" className="capitalize">
                                      {t.common[comm.status] || comm.status || t.common[comm.data?.status] || comm.data?.status}
                                    </Badge>
                                  ) : null}
                                  {comm.duration_minutes && (
                                    <Badge variant="outline" className="bg-blue-50 text-blue-700">
                                      {t.communication.duration}: {Math.floor(comm.duration_minutes)} {t.common.min || "min"}
                                    </Badge>
                                  )}
                                  {(() => {
                                    const outcome = comm.data?.screening_outcome || comm.screening_outcome;
                                    if (!outcome) return null;
                                    const outcomeStyles = {
                                      approved: 'bg-green-50 text-green-700 border-green-200',
                                      self_handled: 'bg-blue-50 text-blue-700 border-blue-200',
                                      declined: 'bg-red-50 text-red-700 border-red-200',
                                    };
                                    const outcomeLabels = {
                                      approved: '✓ Screened & Transferred',
                                      self_handled: '✓ Alex Handled',
                                      declined: '✗ Declined',
                                    };
                                    return (
                                      <Badge
                                        variant="outline"
                                        className={outcomeStyles[outcome] || 'bg-gray-50 text-gray-600'}
                                        title="Call screening decision"
                                        data-testid={`badge-screening-${comm.id}`}
                                      >
                                        {outcomeLabels[outcome] || outcome}
                                      </Badge>
                                    );
                                  })()}
                                </div>
                              </div>
                              {comm.created_date && (
                                <div className="text-right text-sm text-gray-500">
                                  {formatDate(comm.created_date)}
                                  <br />
                                  {formatTime(comm.created_date)}
                                </div>
                              )}
                            </div>
                            
                            {comm.subject && (
                              <p className="text-sm font-medium text-gray-700 mb-2">{comm.subject}</p>
                            )}
                            
                            {(comm.message || comm.body || comm.ai_reply || comm.message_body) && (
                              <p className="text-gray-600 mb-3">{comm.message || comm.body || comm.ai_reply || comm.message_body}</p>
                            )}

                            {comm.recording_url && (
                              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                <div className="flex items-center gap-2 mb-2">
                                  <Phone className="w-4 h-4 text-blue-600" />
                                  <span className="text-sm font-semibold text-blue-900">{t.communication.callLog}</span>
                                </div>
                                <audio controls className="w-full" preload="metadata">
                                  <source src={comm.recording_url} type="audio/mpeg" />
                                  {t.communication.audioNotSupported || "Your browser does not support audio playback."}
                                </audio>
                              </div>
                            )}

                            {comm.transcription && (
                              <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                                <div className="flex items-center gap-2 mb-2">
                                  <MessageSquare className="w-4 h-4 text-gray-600" />
                                  <span className="text-sm font-semibold text-gray-900">Transcript</span>
                                </div>
                                <p className="text-sm text-gray-700 whitespace-pre-wrap" data-testid={`text-transcription-${comm.id}`}>{comm.transcription}</p>
                              </div>
                            )}

                            {comm.recording_url && !comm.transcription && twilioConfig && twilioConfig.enable_transcription === false && (
                              <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded-lg flex items-start gap-2" data-testid={`notice-transcription-disabled-${comm.id}`}>
                                <Info className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-gray-600">
                                  Transcription is disabled in Twilio Setup.{' '}
                                  {isAdmin ? (
                                    renderEnablePopover(comm.id, 'enable_transcription', 'transcription', (
                                      <button
                                        type="button"
                                        className="font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2"
                                        data-testid={`link-enable-transcription-${comm.id}`}
                                      >
                                        Enable in Twilio Setup
                                      </button>
                                    ))
                                  ) : (
                                    <span className="text-gray-500">Ask an admin to re-enable it.</span>
                                  )}
                                </p>
                              </div>
                            )}

                            {comm.recording_url && !comm.ai_summary && twilioConfig && twilioConfig.enable_ai_summary === false && (
                              <div className="mb-3 p-2 bg-purple-50/60 border border-purple-200 rounded-lg flex items-start gap-2" data-testid={`notice-ai-summary-disabled-${comm.id}`}>
                                <Info className="w-3.5 h-3.5 text-purple-500 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-purple-700">
                                  Alex's call summary is disabled in Twilio Setup.{' '}
                                  {isAdmin ? (
                                    renderEnablePopover(comm.id, 'enable_ai_summary', 'ai_summary', (
                                      <button
                                        type="button"
                                        className="font-semibold text-purple-700 hover:text-purple-900 underline underline-offset-2"
                                        data-testid={`link-enable-ai-summary-${comm.id}`}
                                      >
                                        Enable in Twilio Setup
                                      </button>
                                    ))
                                  ) : (
                                    <span className="text-purple-600">Ask an admin to re-enable it.</span>
                                  )}
                                </p>
                              </div>
                            )}

                            {comm.ai_summary && (
                              <div className="mb-3 p-3 bg-purple-50 border border-purple-200 rounded-lg" data-testid={`card-sarah-synopsis-${comm.id}`}>
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-purple-600 text-white text-[10px] font-bold">S</span>
                                  <span className="text-sm font-semibold text-purple-900">Alex's Synopsis</span>
                                  {comm.sentiment && (
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                      comm.sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                                      comm.sentiment === 'urgent' ? 'bg-red-100 text-red-700' :
                                      comm.sentiment === 'negative' ? 'bg-orange-100 text-orange-700' :
                                      'bg-gray-100 text-gray-700'
                                    }`}>
                                      {comm.sentiment}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed" data-testid={`text-ai-summary-${comm.id}`}>{comm.ai_summary}</p>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-2">
                              {comm.contact_phone && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => handleCallClick(comm)}>
                                    <Phone className="w-3 h-3 mr-1" />
                                    {t.communication.callLog}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={comm.direction === 'inbound' ? 'default' : 'outline'}
                                    className={comm.direction === 'inbound' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                                    onClick={() => handleSMSClick(comm)}
                                  >
                                    <MessageSquare className="w-3 h-3 mr-1" />
                                    {comm.direction === 'inbound' ? 'Reply' : t.communication.smsHistory}
                                  </Button>
                                </>
                              )}
                              {comm.contact_email && (
                                <Button size="sm" variant="outline" onClick={() => handleEmailClick(comm)}>
                                  <Mail className="w-3 h-3 mr-1" />
                                  {t.communication.emailThreads}
                                </Button>
                              )}
                              {!comm.customer_id && !comm.lead_id && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-blue-300 text-blue-700 hover:bg-blue-50"
                                    onClick={() => openMatchDialog(comm)}
                                    data-testid={`button-match-contact-${comm.id}`}
                                  >
                                    <Link2 className="w-3 h-3 mr-1" />
                                    Match
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-green-300 text-green-700 hover:bg-green-50"
                                    onClick={() => handleAddAsLead(comm)}
                                    disabled={addingLeadCommId === comm.id}
                                    data-testid={`button-add-as-lead-${comm.id}`}
                                  >
                                    {addingLeadCommId === comm.id ? (
                                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    ) : (
                                      <UserPlus className="w-3 h-3 mr-1" />
                                    )}
                                    Add as Lead
                                  </Button>
                                </>
                              )}
                              {isAdmin && comm.communication_type === 'call' && comm.recording_url && (() => {
                                const transcriptIsFailed = !comm.transcription || /^\[Transcription (failed|unavailable)/.test(comm.transcription);
                                return (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className={transcriptIsFailed
                                      ? "border-orange-300 text-orange-700 hover:bg-orange-50"
                                      : "border-gray-300 text-gray-700 hover:bg-gray-50"}
                                    onClick={() => handleRetryTranscription(comm)}
                                    disabled={retryingTranscriptionId === comm.id}
                                    data-testid={`button-retry-transcription-${comm.id}`}
                                    title={transcriptIsFailed
                                      ? "Retry the failed transcription"
                                      : "Replace the existing transcription with a fresh one"}
                                  >
                                    {retryingTranscriptionId === comm.id ? (
                                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    ) : (
                                      <RefreshCw className="w-3 h-3 mr-1" />
                                    )}
                                    {transcriptIsFailed ? 'Retry Transcription' : 'Re-transcribe'}
                                  </Button>
                                );
                              })()}
                              {(comm.communication_type === 'sms' || comm.communication_type === 'whatsapp') && comm.contact_phone && repOwnedPhones.has(comm.contact_phone) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-300 text-amber-700 hover:bg-amber-50"
                                  onClick={() => handleHandBackToSarah(comm)}
                                  disabled={handingBackPhone === comm.contact_phone}
                                  data-testid={`button-hand-back-to-sarah-${comm.id}`}
                                  title="Clear rep ownership so Alex resumes auto-replies for this contact"
                                >
                                  {handingBackPhone === comm.contact_phone ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  ) : (
                                    <Bot className="w-3 h-3 mr-1" />
                                  )}
                                  Hand back to Alex
                                </Button>
                              )}
                              {comm.communication_type === 'sms' && comm.contact_phone && (
                                (() => {
                                  const smsSummaryDisabled = twilioConfig && twilioConfig.enable_sms_auto_summary === false;
                                  const summaryButton = (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-purple-300 text-purple-700 hover:bg-purple-50"
                                      data-testid={`button-summarize-thread-${comm.id}`}
                                      disabled={smsSummaryDisabled}
                                      onClick={async () => {
                                        try {
                                          const resp = await base44.functions.invoke('summarizeSMSThread', {
                                            companyId: comm.company_id,
                                            contactPhone: comm.contact_phone
                                          });
                                          if (resp?.data?.success) {
                                            refetchCommunications();
                                          } else {
                                            alert('Could not summarize thread: ' + (resp?.data?.error || 'unknown error'));
                                          }
                                        } catch (e) {
                                          alert('Summary failed: ' + e.message);
                                        }
                                      }}
                                    >
                                      <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-purple-600 text-white text-[8px] font-bold mr-1">S</span>
                                      Alex Summary
                                    </Button>
                                  );
                                  if (smsSummaryDisabled) {
                                    if (isAdmin) {
                                      return renderEnablePopover(
                                        comm.id,
                                        'enable_sms_auto_summary',
                                        'sms_summary',
                                        <span tabIndex={0} data-testid={`tooltip-sms-summary-disabled-${comm.id}`} className="cursor-pointer">{summaryButton}</span>
                                      );
                                    }
                                    return (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span tabIndex={0} data-testid={`tooltip-sms-summary-disabled-${comm.id}`}>{summaryButton}</span>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p className="flex items-center gap-1">
                                              <span>SMS auto-summary is disabled in Twilio Setup.</span>
                                              <span className="opacity-80">Ask an admin to re-enable it.</span>
                                            </p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    );
                                  }
                                  return summaryButton;
                                })()
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialer
        open={showDialer}
        onOpenChange={setShowDialer}
        defaultNumber={selectedContact?.phone}
        defaultName={selectedContact?.name}
      />
      <EmailDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        defaultTo={selectedContact?.email}
        defaultName={selectedContact?.name}
        companyId={myCompany?.id}
      />
      <SMSDialog
        open={showSMSDialog}
        onOpenChange={setShowSMSDialog}
        defaultTo={selectedContact?.phone}
        defaultName={selectedContact?.name}
        defaultFrom={selectedContact?.from}
        companyId={myCompany?.id}
      />

      <Dialog open={!!matchDialogComm} onOpenChange={(open) => { if (!open) closeMatchDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Match this {matchDialogComm?.communication_type || 'communication'} to a contact</DialogTitle>
            <DialogDescription>
              Search by name, phone, email, or address to link this caller to an existing customer or lead.
            </DialogDescription>
          </DialogHeader>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              autoFocus
              placeholder="Search customers and leads..."
              value={matchSearchQuery}
              onChange={(e) => setMatchSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-match-search"
            />
          </div>
          <div className="max-h-80 overflow-y-auto space-y-3">
            {matchResults.customers.length === 0 && matchResults.leads.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No customers or leads match your search.</p>
            ) : (
              <>
                {matchResults.customers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5 px-1">Customers</p>
                    <ul className="space-y-1">
                      {matchResults.customers.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => handleMatchTo('customer', c)}
                            disabled={matchingId === `customer-${c.id}`}
                            className="w-full text-left px-3 py-2 rounded-md border border-gray-200 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-60 disabled:cursor-wait flex items-start gap-2"
                            data-testid={`button-match-customer-${c.id}`}
                          >
                            <User className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{c.name || 'Unnamed customer'}</p>
                              <p className="text-xs text-gray-500 truncate">{[c.phone, c.email, c.address].filter(Boolean).join(' · ')}</p>
                            </div>
                            {matchingId === `customer-${c.id}` && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {matchResults.leads.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5 px-1">Leads</p>
                    <ul className="space-y-1">
                      {matchResults.leads.map((l) => (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => handleMatchTo('lead', l)}
                            disabled={matchingId === `lead-${l.id}`}
                            className="w-full text-left px-3 py-2 rounded-md border border-gray-200 hover:bg-green-50 hover:border-green-300 disabled:opacity-60 disabled:cursor-wait flex items-start gap-2"
                            data-testid={`button-match-lead-${l.id}`}
                          >
                            <Briefcase className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{l.name || 'Unnamed lead'}</p>
                              <p className="text-xs text-gray-500 truncate">{[l.phone, l.email, l.address].filter(Boolean).join(' · ')}</p>
                            </div>
                            {matchingId === `lead-${l.id}` && <Loader2 className="w-4 h-4 animate-spin text-green-600" />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
            <p className="text-xs text-gray-500">Need a new lead instead?</p>
            <Button
              size="sm"
              variant="outline"
              className="border-green-300 text-green-700 hover:bg-green-50"
              onClick={() => {
                const comm = matchDialogComm;
                closeMatchDialog();
                if (comm) handleAddAsLead(comm);
              }}
              data-testid="button-match-dialog-add-as-lead"
            >
              <UserPlus className="w-3 h-3 mr-1" />
              Add as new lead
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}