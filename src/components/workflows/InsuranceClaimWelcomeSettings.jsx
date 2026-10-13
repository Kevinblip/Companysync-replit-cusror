import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, CheckCircle2, Eye, Loader2, Mail, MessageSquare, Phone, Save } from "lucide-react";

const ROLE_CONFIG = [
  { key: "office_manager", title: "Office Manager" },
  { key: "production_manager", title: "Production Manager" },
  { key: "project_manager", title: "Project Manager" },
];

const EMPTY_CONFIG = {
  enabled: false,
  lexi: {
    enabled: false,
    public_phone: "",
    voice_enabled: false,
    voice_verified: false,
    sms_enabled: false,
    sms_verified: false,
  },
  roles: {
    office_manager: { staff_profile_id: "", public_phone: "", responsibilities: "" },
    production_manager: { staff_profile_id: "", public_phone: "", responsibilities: "" },
    project_manager: { staff_profile_id: "", public_phone: "", responsibilities: "" },
  },
};

function flattenSettings(row) {
  if (!row) return EMPTY_CONFIG;
  let data = row.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  const saved = { ...row, ...(data && typeof data === "object" ? data : {}) };
  return {
    enabled: saved.enabled === true,
    lexi: {
      enabled: saved.lexi?.enabled === true,
      public_phone: saved.lexi?.public_phone || "",
      voice_enabled: saved.lexi?.voice_enabled === true,
      voice_verified: saved.lexi?.voice_verified === true,
      sms_enabled: saved.lexi?.sms_enabled === true,
      sms_verified: saved.lexi?.sms_verified === true,
    },
    roles: Object.fromEntries(ROLE_CONFIG.map(({ key }) => [
      key,
      {
        staff_profile_id: saved.roles?.[key]?.staff_profile_id || "",
        public_phone: saved.roles?.[key]?.public_phone || "",
        responsibilities: saved.roles?.[key]?.responsibilities || "",
      },
    ])),
  };
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function displayName(profile) {
  return profile?.full_name || profile?.name || profile?.data?.full_name || profile?.email || "Unnamed staff member";
}

function profilePhoto(profile) {
  return profile?.avatar_url || profile?.data?.avatar_url || "";
}

function isHttpsPhoto(profile) {
  return /^https:\/\//i.test(profilePhoto(profile));
}

function readyToEnable(config, profiles) {
  return ROLE_CONFIG.every(({ key }) => {
    const role = config.roles[key];
    const person = profiles.find(profile => profile.id === role.staff_profile_id);
    const phone = role.public_phone.trim()
      || person?.phone?.trim()
      || person?.twilio_number?.trim()
      || "";
    const phoneIsRequired = key === "office_manager";
    return Boolean(person && person.is_active !== false && isHttpsPhoto(person) && role.responsibilities.trim()
      && (!phoneIsRequired || phone.replace(/\D/g, "").length >= 7));
  });
}

export default function InsuranceClaimWelcomeSettings({ company }) {
  const queryClient = useQueryClient();
  const [config, setConfig] = React.useState(EMPTY_CONFIG);
  const [saveMessage, setSaveMessage] = React.useState("");
  const dirty = React.useRef(false);
  React.useEffect(() => { dirty.current = false; }, [company?.id]);

  const {
    data: staffProfiles = [],
    isLoading: staffLoading,
    isError: staffError,
    error: staffQueryError,
    refetch: refetchStaff,
  } = useQuery({
    queryKey: ["insurance-welcome-staff", company?.id],
    queryFn: () => base44.entities.StaffProfile.filter({ company_id: company.id }),
    enabled: Boolean(company?.id),
  });

  const {
    data: settingsRows = [],
    isLoading: settingsLoading,
    isError: settingsError,
    error: settingsQueryError,
    refetch: refetchSettings,
  } = useQuery({
    queryKey: ["insurance-welcome-settings", company?.id],
    queryFn: () => base44.entities.InsuranceClaimWelcomeSettings.filter({ company_id: company.id }, "-updated_date"),
    enabled: Boolean(company?.id),
  });

  const {
    data: twilioRows = [],
    isLoading: twilioLoading,
    isError: twilioError,
    error: twilioQueryError,
  } = useQuery({
    queryKey: ["insurance-welcome-twilio", company?.id],
    queryFn: () => base44.entities.TwilioSettings.filter({ company_id: company.id }, "-updated_date"),
    enabled: Boolean(company?.id),
  });

  const settingsRow = settingsRows[0] || null;
  const twilioRow = twilioRows[0] || null;
  let twilioSettings = twilioRow?.data || twilioRow || {};
  if (typeof twilioSettings === "string") {
    try { twilioSettings = JSON.parse(twilioSettings); } catch { twilioSettings = {}; }
  }
  const twilioPhone = twilioSettings.main_phone_number || "";
  const sameConfiguredPhone = Boolean(
    phoneDigits(twilioPhone)
    && phoneDigits(config.lexi.public_phone) === phoneDigits(twilioPhone),
  );
  const voiceReady = sameConfiguredPhone
    && config.lexi.voice_enabled && config.lexi.voice_verified
    && twilioSettings.enable_calling !== false;
  const smsReady = sameConfiguredPhone
    && config.lexi.sms_enabled && config.lexi.sms_verified
    && twilioSettings.enable_sms !== false;
  const lexiReady = Boolean(twilioPhone && (voiceReady || smsReady));
  React.useEffect(() => {
    if (!settingsLoading && !dirty.current) setConfig(flattenSettings(settingsRow));
  }, [settingsLoading, settingsRow]);

  const saveMutation = useMutation({
    mutationFn: async (nextConfig) => {
      const payload = { ...nextConfig, company_id: company.id, scope: "new_insurance_claims_only" };
      if (settingsRow?.id) {
        return base44.entities.InsuranceClaimWelcomeSettings.update(settingsRow.id, payload);
      }
      return base44.entities.InsuranceClaimWelcomeSettings.create(payload);
    },
    onSuccess: async () => {
      dirty.current = false;
      setSaveMessage("Welcome email settings saved.");
      await queryClient.invalidateQueries({ queryKey: ["insurance-welcome-settings", company?.id] });
    },
    onError: (error) => setSaveMessage(`Could not save settings: ${error.message}`),
  });

  const updateRole = (key, field, value) => {
    dirty.current = true;
    setSaveMessage("");
    setConfig(current => ({
      ...current,
      roles: {
        ...current.roles,
        [key]: { ...current.roles[key], [field]: value },
      },
    }));
  };

  const selectStaff = (roleKey, profileId) => {
    dirty.current = true;
    const profile = staffProfiles.find(item => item.id === profileId);
    setSaveMessage("");
    setConfig(current => ({
      ...current,
      roles: {
        ...current.roles,
        [roleKey]: {
          ...current.roles[roleKey],
          staff_profile_id: profileId === "none" ? "" : profileId,
          public_phone: profileId === "none" ? "" : (profile?.phone || profile?.twilio_number || ""),
        },
      },
    }));
  };

  const updateLexiChannel = (channel, enabled) => {
    dirty.current = true;
    setSaveMessage("");
    setConfig(current => ({
      ...current,
      lexi: {
        ...current.lexi,
        public_phone: enabled ? twilioPhone : current.lexi.public_phone,
        [`${channel}_enabled`]: enabled,
        [`${channel}_verified`]: enabled,
      },
    }));
  };

  const save = () => {
    if (staffError || settingsError) {
      setSaveMessage("Could not save settings while staff or saved settings could not be loaded. Retry the failed request first.");
      return;
    }
    if (config.lexi.enabled && !lexiReady) {
      setSaveMessage("Before enabling Lexi, test and verify at least one customer call or text route on the configured Twilio number.");
      return;
    }
    setSaveMessage("");
    saveMutation.mutate({ ...config, enabled: config.enabled && canEnableWithLoadedData });
  };

  if (!company?.id) return null;
  const loading = staffLoading || settingsLoading;
  const queryFailed = staffError || settingsError;
  const canEnableWithLoadedData = !queryFailed && readyToEnable(config, staffProfiles);

  return (
    <Card className="border-blue-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Mail className="h-5 w-5 text-blue-600" />
              Insurance-claim welcome email
            </CardTitle>
            <CardDescription className="mt-1 max-w-3xl">
              Introduce your team when a customer's insurance claim number is first recorded, for any insurer,
              or when a project is first marked as an insurance claim. Existing claims and later edits will not trigger it.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <span className="text-sm font-medium">{config.enabled ? "Enabled" : "Off"}</span>
            <Switch
              checked={config.enabled}
              disabled={queryFailed || (!canEnableWithLoadedData && !config.enabled)}
              onCheckedChange={(enabled) => {
                dirty.current = true;
                setSaveMessage("");
                setConfig(current => ({ ...current, enabled }));
              }}
              aria-label="Enable insurance-claim welcome emails"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <Alert className="border-amber-200 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-amber-900">
            Add only customer-facing contact numbers. Staff personal cell numbers are never copied automatically.
            The email is sent only when the project is linked to a customer with a name and valid email address.
          </AlertDescription>
        </Alert>

        {loading ? (
          <div className="space-y-4 py-2" aria-label="Loading welcome email settings">
            <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
            <div className="grid gap-4 lg:grid-cols-3">
              {ROLE_CONFIG.map(({ key }) => (
                <div key={key} className="space-y-3 rounded-xl border bg-white p-4">
                  <div className="h-5 w-32 animate-pulse rounded bg-slate-100" />
                  <div className="h-10 animate-pulse rounded bg-slate-100" />
                  <div className="h-20 animate-pulse rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        ) : queryFailed ? (
          <Alert variant="destructive" className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">Couldn’t load welcome email setup</p>
                  {staffError && <p className="mt-1">Staff profiles: {staffQueryError?.message || "request failed"}</p>}
                  {settingsError && <p className="mt-1">Saved settings: {settingsQueryError?.message || "request failed"}</p>}
                  <p className="mt-1">Setup data is hidden until it can be loaded. Enabling and saving are unavailable.</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {staffError && <Button type="button" variant="outline" size="sm" onClick={() => refetchStaff()}>Retry staff</Button>}
                  {settingsError && <Button type="button" variant="outline" size="sm" onClick={() => refetchSettings()}>Retry settings</Button>}
                </div>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <>
          <div className="grid gap-4 lg:grid-cols-3">
            {ROLE_CONFIG.map(({ key, title }) => {
              const role = config.roles[key];
              const selected = staffProfiles.find(profile => profile.id === role.staff_profile_id);
              return (
                <section key={key} className="space-y-3 rounded-xl border bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-gray-900">{title}</h3>
                    {selected && (
                      <Badge variant="secondary" className="max-w-[55%] truncate">
                        {displayName(selected)}
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`insurance-welcome-${key}-staff`}>Staff profile</Label>
                    <Select
                      value={role.staff_profile_id || "none"}
                      onValueChange={(value) => selectStaff(key, value)}
                    >
                      <SelectTrigger id={`insurance-welcome-${key}-staff`}>
                        <SelectValue placeholder="Choose a staff member" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Choose a staff member</SelectItem>
                        {staffProfiles
                          .filter(profile => profile.is_active !== false)
                          .sort((a, b) => displayName(a).localeCompare(displayName(b)))
                          .map(profile => (
                            <SelectItem key={profile.id} value={profile.id}>
                              {displayName(profile)}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selected && (
                    <div className="flex items-center gap-3 rounded-md bg-slate-50 p-2">
                      {isHttpsPhoto(selected) ? (
                        <img
                          src={profilePhoto(selected)}
                          alt={`${displayName(selected)} profile`}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-800">
                          Photo needed
                        </div>
                      )}
                      <p className="text-xs text-gray-600">
                        {isHttpsPhoto(selected) ? "This photo appears in the email." : "Add a public HTTPS photo to this staff profile before enabling."}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor={`insurance-welcome-${key}-phone`}>
                      Public phone{key === "office_manager" ? " (required)" : " (optional)"}
                    </Label>
                    <Input
                      id={`insurance-welcome-${key}-phone`}
                      type="tel"
                      value={role.public_phone}
                      onChange={(event) => updateRole(key, "public_phone", event.target.value)}
                      placeholder="Business or customer-service number"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`insurance-welcome-${key}-responsibilities`}>Customer-facing responsibilities</Label>
                    <Textarea
                      id={`insurance-welcome-${key}-responsibilities`}
                      value={role.responsibilities}
                      onChange={(event) => updateRole(key, "responsibilities", event.target.value)}
                      placeholder={`What should the customer contact ${displayName(selected)} about?`}
                      rows={4}
                    />
                  </div>
                </section>
              );
            })}
          </div>
          <section className="space-y-4 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-violet-700" />
                  <h3 className="font-semibold text-slate-900">Introduce Lexi, your AI project update assistant</h3>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  Lexi is separate from staff Lexi. Homeowners can only receive their own current milestone and updates explicitly published for customers.
                  She cannot see internal notes, tasks, claim details, or financial information.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-lg border bg-white px-3 py-2">
                <span className="text-sm font-medium">{config.lexi.enabled ? "Included" : "Not included"}</span>
                <Switch
                  checked={config.lexi.enabled}
                  disabled={!lexiReady && !config.lexi.enabled}
                  onCheckedChange={(enabled) => {
                    dirty.current = true;
                    setSaveMessage("");
                    setConfig(current => ({ ...current, lexi: { ...current.lexi, enabled } }));
                  }}
                  aria-label="Include customer-facing Lexi"
                />
              </div>
            </div>

            <div className="rounded-lg border bg-white p-3">
              <p className="text-sm font-medium text-slate-800">Customer Twilio number</p>
              {twilioLoading ? (
                <p className="mt-1 text-sm text-slate-500">Checking the company phone settings…</p>
              ) : twilioError ? (
                <p className="mt-1 text-sm text-red-700">{twilioQueryError?.message || "Could not load the Twilio phone settings."}</p>
              ) : twilioPhone ? (
                <p className="mt-1 flex items-center gap-2 text-sm text-slate-700">
                  <Phone className="h-4 w-4" /> {twilioPhone}
                </p>
              ) : (
                <p className="mt-1 text-sm text-amber-800">No main Twilio number is configured for this company.</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-start justify-between gap-3 rounded-lg border bg-white p-3">
                <div>
                  <p className="font-medium text-slate-800">Inbound calls</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Turn on only after calling this number and confirming the customer assistant answers.
                  </p>
                </div>
                <Switch
                  checked={voiceReady}
                  disabled={twilioLoading || Boolean(twilioError) || !twilioPhone || twilioSettings.enable_calling === false}
                  onCheckedChange={(enabled) => updateLexiChannel("voice", enabled)}
                  aria-label="Enable Lexi on the tested inbound call number"
                />
              </div>
              <div className="flex items-start justify-between gap-3 rounded-lg border bg-white p-3">
                <div>
                  <p className="font-medium text-slate-800">Text messages</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Turn on only after texting this number and confirming the customer assistant replies.
                  </p>
                </div>
                <Switch
                  checked={smsReady}
                  disabled={twilioLoading || Boolean(twilioError) || !twilioPhone || twilioSettings.enable_sms === false}
                  onCheckedChange={(enabled) => updateLexiChannel("sms", enabled)}
                  aria-label="Enable Lexi on the tested inbound text number"
                />
              </div>
            </div>
            {config.lexi.enabled && !lexiReady && (
              <p role="status" className="text-sm text-amber-800">
                Lexi will not be introduced until at least one channel is enabled and tested on the current Twilio number.
              </p>
            )}
          </section>
          <section className="overflow-hidden rounded-xl border border-sky-200 bg-sky-50/60">
            <div className="flex flex-col gap-2 border-b border-sky-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-sky-800" />
                <h3 className="font-semibold text-slate-900">Customer-facing preview</h3>
              </div>
              <p className="text-xs text-slate-600">A look at the team introduction customers will receive</p>
            </div>
            <div className="grid divide-y divide-sky-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {ROLE_CONFIG.map(({ key, title }) => {
                const role = config.roles[key];
                const person = staffProfiles.find(profile => profile.id === role.staff_profile_id);
                const publicPhone = role.public_phone.trim()
                  || person?.phone?.trim()
                  || person?.twilio_number?.trim()
                  || "";
                return (
                  <article key={`preview-${key}`} className="min-w-0 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-900/70">{title}</p>
                    <div className="mt-3 flex min-w-0 items-center gap-3">
                      {person && isHttpsPhoto(person) ? (
                        <img
                          src={profilePhoto(person)}
                          alt={`${displayName(person)} profile`}
                          className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-white"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-900">
                          {person ? displayName(person).split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() : "—"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{person ? displayName(person) : "Staff member not selected"}</p>
                        {publicPhone ? (
                          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700">
                            <Phone className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{publicPhone}</span>
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-slate-500">No public phone added</p>
                        )}
                      </div>
                    </div>
                    <p className="mt-3 min-h-10 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                      {role.responsibilities.trim() || "Customer-facing responsibilities will appear here."}
                    </p>
                  </article>
                );
              })}
            </div>
            {config.lexi.enabled && lexiReady && (
              <div className="border-t border-violet-200 bg-violet-50 p-4">
                <p className="font-semibold text-slate-900">Lexi · AI Project Update Assistant</p>
                <p className="mt-1 text-sm text-slate-700">
                  Homeowners can {voiceReady && smsReady ? "call or text" : voiceReady ? "call" : "text"} {twilioPhone} for their current milestone and published project updates.
                  Lexi is an AI assistant, not a person.
                </p>
              </div>
            )}
          </section>
          </>
        )}

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-sm">
            {canEnableWithLoadedData ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            )}
            <span className={canEnableWithLoadedData ? "text-green-800" : "text-gray-600"}>
              {queryFailed
                ? "Resolve the loading issue before enabling or saving this setup."
                : canEnableWithLoadedData
                  ? "The three staff profiles, photos, and responsibilities are ready; the Office Manager also has a public phone."
                  : "To enable sending, choose three staff profiles, add photos and responsibilities, and provide the Office Manager’s public phone."}
            </span>
          </div>
          <Button onClick={save} disabled={loading || queryFailed || saveMutation.isPending || !company?.id}>
            {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save settings
          </Button>
        </div>

        {saveMessage && (
          <p role="status" className={`text-sm ${saveMessage.startsWith("Could not") ? "text-red-600" : "text-green-700"}`}>
            {saveMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
