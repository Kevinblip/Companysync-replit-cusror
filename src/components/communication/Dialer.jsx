import { useState, useEffect, useRef, useCallback } from "react";
import { Device } from "@twilio/voice-sdk";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Phone, Delete, PhoneCall, X, CheckCircle, Loader2,
  PhoneOff, Mic, MicOff, AlertCircle, Radio
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatDisplay(digits) {
  const d = digits.replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  if (d.length <= 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 11)}`;
}

export default function Dialer({ open, onOpenChange, defaultNumber, defaultName }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [contactName, setContactName] = useState("");

  // Call states: idle | requesting | ringing | active | ended | notes
  const [callState, setCallState] = useState("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [isMuted, setIsMuted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [callNotes, setCallNotes] = useState("");
  const [sendFollowUpSMS, setSendFollowUpSMS] = useState(false);
  const [smsMessage, setSmsMessage] = useState("");

  const [user, setUser] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [mainPhone, setMainPhone] = useState('');
  const [repTwilioNumber, setRepTwilioNumber] = useState('');

  const deviceRef = useRef(null);
  const activeCallRef = useRef(null);
  const timerRef = useRef(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
    }).catch(() => {});
  }, []);

  const { data: twilioConfig } = useQuery({
    queryKey: ['twilio-settings-dialer', user?.email],
    queryFn: async () => {
      if (!user) return null;
      let cId = null;
      let repNumber = '';
      const impersonated = sessionStorage.getItem('impersonating_company_id');
      if (impersonated) {
        cId = impersonated;
      } else {
        const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
        if (staffProfiles?.[0]) {
          cId = staffProfiles[0].company_id;
          repNumber = staffProfiles[0].twilio_number || '';
        }
        if (!cId) {
          const companies = await base44.entities.Company.filter({ created_by: user.email });
          if (companies?.[0]) cId = companies[0].id;
        }
      }
      if (!cId) return null;
      const settings = await base44.entities.TwilioSettings.filter({ company_id: cId });
      return { companyId: cId, repTwilioNumber: repNumber, ...(settings?.[0] || {}) };
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (twilioConfig) {
      setCompanyId(twilioConfig.companyId);
      setMainPhone(twilioConfig.main_phone_number || '');
      setRepTwilioNumber(twilioConfig.repTwilioNumber || '');
    }
  }, [twilioConfig]);

  useEffect(() => {
    if (defaultNumber && open) setPhoneNumber(defaultNumber.replace(/\D/g, ''));
    if (defaultName && open) setContactName(defaultName);
  }, [defaultNumber, defaultName, open]);

  // Clean up device when dialog closes
  useEffect(() => {
    if (!open) {
      cleanupDevice();
      resetState();
    }
  }, [open]);

  const cleanupDevice = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (activeCallRef.current) {
      try { activeCallRef.current.disconnect(); } catch (e) {}
      activeCallRef.current = null;
    }
    if (deviceRef.current) {
      try { deviceRef.current.destroy(); } catch (e) {}
      deviceRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    setCallState("idle");
    setStatusMsg("");
    setErrorMsg("");
    setIsMuted(false);
    setElapsedSeconds(0);
    setCallNotes("");
    setSendFollowUpSMS(false);
    setSmsMessage("");
  }, []);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      setElapsedSeconds(s => s + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleCall = async () => {
    if (!companyId) {
      setErrorMsg("Company not found. Please complete Twilio setup first.");
      return;
    }
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length < 10) {
      setErrorMsg("Please enter a valid phone number.");
      return;
    }
    let to = digits;
    if (to.length === 10) to = '+1' + to;
    else if (to.length === 11 && to.startsWith('1')) to = '+' + to;
    else if (!to.startsWith('+')) to = '+' + to;

    setErrorMsg("");
    setCallState("requesting");
    setStatusMsg("Requesting microphone access...");

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setCallState("idle");
      setErrorMsg("Microphone access denied. Please allow microphone access and try again.");
      return;
    }

    setStatusMsg("Connecting to browser dialer...");

    let token;
    try {
      const identity = encodeURIComponent((user?.email || 'agent').replace(/[^a-zA-Z0-9_\-@.]/g, '_'));
      const resp = await fetch(`/api/twilio/webrtc-token?companyId=${encodeURIComponent(companyId)}&identity=${identity}`);
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to get call token');
      }
      token = data.token;
    } catch (err) {
      setCallState("idle");
      setErrorMsg(err.message);
      return;
    }

    setStatusMsg("Initializing dialer...");

    try {
      const device = new Device(token, {
        logLevel: 1,
        codecPreferences: ['opus', 'pcmu'],
      });

      device.on('error', (err) => {
        console.error('[Dialer] Device error:', err);
        setErrorMsg('Call error: ' + (err.message || err.code || 'Unknown error'));
        setCallState("idle");
        stopTimer();
      });

      device.on('registered', async () => {
        setStatusMsg("Dialing...");
        setCallState("ringing");
        try {
          const call = await device.connect({
            params: {
              To: to,
              ContactName: contactName || 'Unknown',
              CompanyId: companyId,
              ...(repTwilioNumber ? { RepPhone: repTwilioNumber } : {}),
            },
          });

          activeCallRef.current = call;

          call.on('ringing', () => {
            setStatusMsg("Ringing...");
            setCallState("ringing");
          });

          call.on('accept', () => {
            setCallState("active");
            setStatusMsg("");
            startTimer();
          });

          call.on('disconnect', () => {
            stopTimer();
            setCallState("ended");
            setStatusMsg("");
            activeCallRef.current = null;
            setTimeout(() => setCallState("notes"), 800);
          });

          call.on('cancel', () => {
            stopTimer();
            setCallState("idle");
            setStatusMsg("Call cancelled");
            activeCallRef.current = null;
          });

          call.on('reject', () => {
            stopTimer();
            setCallState("idle");
            setStatusMsg("Call rejected");
            activeCallRef.current = null;
          });

          call.on('error', (err) => {
            stopTimer();
            setErrorMsg('Call error: ' + (err.message || 'Unknown'));
            setCallState("idle");
            activeCallRef.current = null;
          });
        } catch (connectErr) {
          setErrorMsg('Failed to connect: ' + connectErr.message);
          setCallState("idle");
        }
      });

      deviceRef.current = device;
      await device.register();
    } catch (err) {
      setCallState("idle");
      setErrorMsg('Dialer initialization failed: ' + err.message);
    }
  };

  const handleHangup = () => {
    stopTimer();
    if (activeCallRef.current) {
      try { activeCallRef.current.disconnect(); } catch (e) {}
    }
    setCallState("notes");
  };

  const handleMute = () => {
    if (activeCallRef.current) {
      const newMuted = !isMuted;
      activeCallRef.current.mute(newMuted);
      setIsMuted(newMuted);
    }
  };

  const logCallMutation = useMutation({
    mutationFn: async (data) => {
      if (sendFollowUpSMS && smsMessage.trim() && phoneNumber) {
        let fmtPhone = phoneNumber.replace(/\D/g, '');
        if (fmtPhone.length === 10) fmtPhone = '+1' + fmtPhone;
        else if (!fmtPhone.startsWith('+')) fmtPhone = '+' + fmtPhone;
        try {
          await base44.functions.invoke('sendSMS', {
            to: fmtPhone, message: smsMessage,
            contactName: contactName || "Unknown", companyId,
            ...(repTwilioNumber ? { from: repTwilioNumber } : {}),
          });
        } catch (e) { console.warn('[Dialer] SMS failed:', e.message); }
      }
      return base44.entities.Communication.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      cleanupDevice();
      resetState();
      setPhoneNumber("");
      setContactName("");
      onOpenChange(false);
    },
    onError: (err) => {
      console.error('[Dialer] Log call error:', err);
    }
  });

  const handleSaveNotes = () => {
    const duration = Math.round(elapsedSeconds / 60) || 0;
    const fmtPhone = (() => {
      const d = phoneNumber.replace(/\D/g, '');
      if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
      return phoneNumber;
    })();
    logCallMutation.mutate({
      company_id: companyId,
      contact_name: contactName || "Unknown",
      contact_phone: fmtPhone,
      communication_type: "call",
      direction: "outbound",
      subject: "Outbound Call",
      message: callNotes || "Call completed",
      duration_minutes: duration,
      status: "completed",
      outcome: "successful",
    });
  };

  const handleNumberClick = (num) => setPhoneNumber(p => (p + num).slice(0, 15));
  const handleBackspace = () => setPhoneNumber(p => p.slice(0, -1));
  const handleInputChange = (e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 15));

  const webrtcReady = twilioConfig?.api_key_sid && twilioConfig?.twiml_app_sid;
  const dialerConfigured = !!(companyId && (webrtcReady || twilioConfig?.account_sid));

  const getTitle = () => {
    if (callState === "notes") return "Call Notes";
    if (callState === "active") return `In Call — ${formatDuration(elapsedSeconds)}`;
    if (callState === "ringing") return "Dialing...";
    return "Browser Dialer";
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v && (callState === 'active' || callState === 'ringing')) {
        if (!confirm('Are you sure you want to close the dialer? This will end the current call.')) return;
        cleanupDevice();
      }
      onOpenChange(v);
    }}>
      <DialogContent className="!p-3 sm:!p-6 w-[calc(100vw-2rem)] max-w-[420px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {callState === 'active' ? (
              <Radio className="w-4 h-4 text-green-600 animate-pulse" />
            ) : (
              <Phone className="w-5 h-5 text-green-600" />
            )}
            {getTitle()}
          </DialogTitle>
        </DialogHeader>

        {/* NOTES STATE */}
        {callState === "notes" ? (
          <div className="space-y-3 sm:space-y-4">
            <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg text-center">
              <CheckCircle className="w-10 h-10 mx-auto text-green-600 mb-2" />
              <p className="font-semibold">Call Ended</p>
              <p className="text-sm text-muted-foreground">
                Duration: {formatDuration(elapsedSeconds)}
              </p>
            </div>
            <div>
              <Label>Contact Name</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Enter contact name" data-testid="input-call-contact-name" />
            </div>
            <div>
              <Label>Call Notes</Label>
              <Textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="What did you discuss? Follow-ups needed?" rows={3} data-testid="input-call-notes" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="sendSMS" checked={sendFollowUpSMS} onChange={e => setSendFollowUpSMS(e.target.checked)} className="w-4 h-4 rounded" />
                <Label htmlFor="sendSMS" className="cursor-pointer text-sm">Send follow-up text</Label>
              </div>
              {sendFollowUpSMS && (
                <Textarea value={smsMessage} onChange={e => setSmsMessage(e.target.value)} placeholder="Thanks for speaking with me..." rows={2} className="text-sm" data-testid="input-follow-up-sms" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => {
                cleanupDevice();
                resetState();
                setPhoneNumber("");
                setContactName("");
                onOpenChange(false);
              }} data-testid="button-skip-notes">Skip</Button>
              <Button onClick={handleSaveNotes} disabled={logCallMutation.isPending} className="bg-green-600 hover:bg-green-700" data-testid="button-save-notes">
                {logCallMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Notes'}
              </Button>
            </div>
          </div>

        /* ACTIVE CALL STATE */
        ) : callState === "active" ? (
          <div className="space-y-6">
            <div className="text-center py-6">
              <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center mx-auto mb-4 ring-4 ring-green-200 dark:ring-green-800 animate-pulse">
                <Phone className="w-10 h-10 text-green-600" />
              </div>
              <p className="text-xl font-semibold">{contactName || 'Unknown'}</p>
              <p className="text-muted-foreground">{formatDisplay(phoneNumber)}</p>
              <Badge variant="outline" className="mt-2 border-green-300 text-green-700 dark:text-green-400">
                {formatDuration(elapsedSeconds)}
              </Badge>
            </div>

            <div className="flex justify-center gap-6">
              <div className="flex flex-col items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className={`w-14 h-14 rounded-full ${isMuted ? 'bg-red-100 border-red-300 text-red-600' : ''}`}
                  onClick={handleMute}
                  data-testid="button-mute"
                >
                  {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                </Button>
                <span className="text-xs text-muted-foreground">{isMuted ? 'Unmute' : 'Mute'}</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Button
                  size="icon"
                  className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white"
                  onClick={handleHangup}
                  data-testid="button-hangup"
                >
                  <PhoneOff className="w-6 h-6" />
                </Button>
                <span className="text-xs text-muted-foreground">Hang up</span>
              </div>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Call is being recorded for quality and training purposes
            </p>
          </div>

        /* RINGING STATE */
        ) : callState === "ringing" ? (
          <div className="space-y-6">
            <div className="text-center py-6">
              <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center mx-auto mb-4 ring-4 ring-blue-200 dark:ring-blue-800">
                <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
              </div>
              <p className="text-xl font-semibold">{contactName || 'Unknown'}</p>
              <p className="text-muted-foreground">{formatDisplay(phoneNumber)}</p>
              <p className="text-sm text-blue-600 mt-2">{statusMsg || 'Connecting...'}</p>
            </div>
            <div className="flex justify-center">
              <div className="flex flex-col items-center gap-1">
                <Button
                  size="icon"
                  className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => {
                    if (activeCallRef.current) {
                      try { activeCallRef.current.disconnect(); } catch(e) {}
                    }
                    cleanupDevice();
                    setCallState("idle");
                  }}
                  data-testid="button-cancel-call"
                >
                  <PhoneOff className="w-6 h-6" />
                </Button>
                <span className="text-xs text-muted-foreground">Cancel</span>
              </div>
            </div>
          </div>

        /* IDLE / DIALING SETUP STATE */
        ) : (
          <div className="space-y-3 sm:space-y-5">
            {errorMsg && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            {statusMsg && !errorMsg && (
              <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200">
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                <AlertDescription className="text-blue-900 dark:text-blue-100">{statusMsg}</AlertDescription>
              </Alert>
            )}

            {!webrtcReady && !errorMsg && (
              <Alert className="bg-amber-50 dark:bg-amber-950 border-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-900 dark:text-amber-100 text-sm">
                  Browser dialer not configured. Go to <strong>Settings → Twilio Setup</strong> and click <strong>Connect Sarah to This Number</strong> to enable it.
                </AlertDescription>
              </Alert>
            )}

            {defaultName && !errorMsg && (
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground">Calling</p>
                <p className="font-semibold text-lg">{defaultName}</p>
              </div>
            )}

            <div className="relative">
              <Input
                value={formatDisplay(phoneNumber)}
                onChange={handleInputChange}
                className="text-xl sm:text-2xl text-center font-semibold h-12 sm:h-14 pr-10"
                placeholder="(555) 123-4567"
                data-testid="input-phone-number"
              />
              {phoneNumber && (
                <button onClick={handleBackspace} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" data-testid="button-backspace">
                  <Delete className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              {['1','2','3','4','5','6','7','8','9','*','0','#'].map(num => (
                <Button key={num} variant="outline" className="h-11 sm:h-12 text-lg sm:text-xl font-semibold hover:bg-green-50 dark:hover:bg-green-950 min-w-0"
                  onClick={() => handleNumberClick(num)} disabled={callState === 'requesting'} data-testid={`button-dialpad-${num}`}>
                  {num}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <Button variant="outline" onClick={() => { resetState(); setPhoneNumber(""); setContactName(""); onOpenChange(false); }}
                className="h-11 sm:h-12 text-sm sm:text-base" disabled={callState === 'requesting'} data-testid="button-cancel">
                <X className="w-4 h-4 mr-1 sm:mr-2 flex-shrink-0" />Cancel
              </Button>
              <Button
                onClick={handleCall}
                disabled={phoneNumber.replace(/\D/g,'').length < 10 || !dialerConfigured || callState === 'requesting'}
                className="h-11 sm:h-12 text-sm sm:text-base bg-green-600 hover:bg-green-700 text-white"
                data-testid="button-call"
              >
                {callState === 'requesting' ? (
                  <><Loader2 className="w-4 h-4 mr-1 sm:mr-2 animate-spin flex-shrink-0" />Connecting...</>
                ) : (
                  <><PhoneCall className="w-4 h-4 mr-1 sm:mr-2 flex-shrink-0" />Call Now</>
                )}
              </Button>
            </div>

            <p className="text-[10px] sm:text-xs text-center text-muted-foreground leading-tight">
              Calls use your computer microphone · Recorded automatically · Caller ID: {repTwilioNumber || mainPhone || 'your Twilio number'}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
