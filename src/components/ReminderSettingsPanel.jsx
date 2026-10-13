import React, { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/use-toast";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Bell, Mail, MessageSquare, Info, RefreshCw, Building2, Moon } from "lucide-react";

const INTERVALS = [
  { min: 1440, label: "24 hours before", description: "A calm heads-up the day before — great for planning ahead." },
  { min: 360,  label: "6 hours before",  description: "A mid-day nudge so nothing sneaks up on you." },
  { min: 240,  label: "4 hours before",  description: "🔔 Friendly bell — time to start wrapping up what you're doing." },
  { min: 60,   label: "1 hour before",   description: "🚨 Urgent alert — head out soon to arrive on time." },
  { min: 30,   label: "30 minutes before", description: "🚨🚨🚨 Final blast — leave now or you'll be late!" },
];

const DEFAULT_INTERVAL_SETTINGS = { enabled: true, email: true, sms: false };
const DEFAULT_QUIET_HOURS = { enabled: true, start: "22:00", end: "07:00" };
const SMS_ELIGIBLE_INTERVALS = new Set([60]);

function buildDefaultSettings() {
  const intervals = {};
  for (const iv of INTERVALS) {
    intervals[String(iv.min)] = {
      ...DEFAULT_INTERVAL_SETTINGS,
      sms: SMS_ELIGIBLE_INTERVALS.has(iv.min),
    };
  }
  return { enabled: true, quiet_hours: { ...DEFAULT_QUIET_HOURS }, intervals };
}

function mergeWithDefaults(saved) {
  const defaults = buildDefaultSettings();
  if (!saved) return defaults;
  defaults.enabled = saved.enabled !== false;
  defaults.quiet_hours = { ...DEFAULT_QUIET_HOURS, ...(saved.quiet_hours || {}) };
  // Older staff preferences stored interval keys directly on the object. Read
  // both that shape and the current { intervals: { ... } } shape so opening
  // the Calendar never crashes while rendering a 24-hour reminder.
  const savedIntervals = saved.intervals || saved;
  for (const iv of INTERVALS) {
    const key = String(iv.min);
    defaults.intervals[key] = {
      ...DEFAULT_INTERVAL_SETTINGS,
      ...(savedIntervals[key] || {}),
      sms: SMS_ELIGIBLE_INTERVALS.has(iv.min) && savedIntervals[key]?.sms !== false,
    };
  }
  return defaults;
}

function buildDefaultStaffPrefs() {
  const prefs = {};
  for (const iv of INTERVALS) prefs[String(iv.min)] = { email: true, sms: SMS_ELIGIBLE_INTERVALS.has(iv.min) };
  return { enabled: true, quiet_hours: { ...DEFAULT_QUIET_HOURS }, intervals: prefs };
}

function mergeStaffPrefsWithDefaults(saved) {
  const defaults = buildDefaultStaffPrefs();
  if (!saved) return defaults;
  defaults.enabled = saved.enabled !== false;
  defaults.quiet_hours = { ...DEFAULT_QUIET_HOURS, ...(saved.quiet_hours || {}) };
  const savedIntervals = saved.intervals || saved;
  for (const iv of INTERVALS) {
    const key = String(iv.min);
    defaults.intervals[key] = {
      email: true,
      ...(savedIntervals[key] || {}),
      sms: SMS_ELIGIBLE_INTERVALS.has(iv.min) && savedIntervals[key]?.sms !== false,
    };
  }
  return defaults;
}

export { INTERVALS, DEFAULT_INTERVAL_SETTINGS, buildDefaultSettings, mergeWithDefaults };

export default function ReminderSettingsPanel({ user, showCompanyDefaults = false }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [localSettings, setLocalSettings] = useState(null);
  const [localDefaults, setLocalDefaults] = useState(null);
  const initializedForRef = useRef(null);
  const defaultsInitializedRef = useRef(null);

  const { company: myCompany, staffProfiles = [] } = useCurrentCompany(user);
  const staffProfile = staffProfiles.find(profile => profile.company_id === myCompany?.id) || staffProfiles[0] || null;

  const { data: settingsEntities = [], isLoading: settingsLoading } = useQuery({
    queryKey: ["reminder-settings", myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      return base44.entities.ReminderSettings.filter({ company_id: myCompany.id }, "-created_date", 1);
    },
    enabled: !!myCompany,
  });

  const savedSettings = settingsEntities[0] || null;
  const savedPersonalSettings = staffProfile?.data?.reminder_preferences || null;

  useEffect(() => {
    if (!myCompany?.id) return;
    const initKey = `${myCompany.id}:${staffProfile?.id || "pending"}`;
    if (initializedForRef.current === initKey && localSettings !== null) return;
    initializedForRef.current = initKey;
    setLocalSettings(mergeWithDefaults(savedPersonalSettings));
  }, [myCompany?.id, staffProfile?.id, staffProfile?.updated_date, savedPersonalSettings?.enabled]);

  useEffect(() => {
    if (!myCompany?.id || !showCompanyDefaults) return;
    if (defaultsInitializedRef.current === myCompany.id && localDefaults !== null) return;
    defaultsInitializedRef.current = myCompany.id;
    setLocalDefaults(mergeStaffPrefsWithDefaults(savedSettings?.default_staff_preferences));
  }, [myCompany?.id, showCompanyDefaults, settingsEntities.length > 0 ? savedSettings?.id : undefined]);

  const displaySettings = localSettings || mergeWithDefaults(savedPersonalSettings);
  const displayDefaults = localDefaults || mergeStaffPrefsWithDefaults(savedSettings?.default_staff_preferences);

  const saveSettingsMutation = useMutation({
    mutationFn: async (newSettings) => {
      if (!staffProfile?.id) throw new Error("Your staff profile is not ready yet.");
      return base44.entities.StaffProfile.update(staffProfile.id, {
        data: { ...(staffProfile.data || {}), reminder_preferences: newSettings },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["current-company-staff", user?.email] });
      queryClient.invalidateQueries({ queryKey: ["my-staff-profile", user?.email] });
    },
    onError: (err, newSettings, context) => {
      if (context?.rollback) setLocalSettings(context.rollback);
      toast({ title: "Couldn't save reminder settings", description: "Please try again.", variant: "destructive" });
    },
    onMutate: async () => {
      return { rollback: localSettings };
    },
  });

  const saveDefaultsMutation = useMutation({
    mutationFn: async (newDefaults) => {
      if (savedSettings?.id) {
        return base44.entities.ReminderSettings.update(savedSettings.id, { default_staff_preferences: newDefaults });
      } else {
        return base44.entities.ReminderSettings.create({
          company_id: myCompany.id,
          default_staff_preferences: newDefaults,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminder-settings", myCompany?.id] });
    },
    onError: (err, newDefaults, context) => {
      if (context?.rollback) setLocalDefaults(context.rollback);
      toast({ title: "Couldn't save default preferences", description: "Please try again.", variant: "destructive" });
    },
    onMutate: async () => {
      return { rollback: localDefaults };
    },
  });

  const updateInterval = useCallback(
    (min, field, value) => {
      const key = String(min);

      const currentSettings = localSettings || mergeWithDefaults(savedPersonalSettings);
      const newIntervals = { ...currentSettings.intervals };
      newIntervals[key] = { ...newIntervals[key], [field]: value };
      if (field === "enabled" && !value) {
        newIntervals[key].email = false;
        newIntervals[key].sms = false;
      }
      if (field === "enabled" && value) {
        newIntervals[key].email = true;
        newIntervals[key].sms = true;
      }

      setLocalSettings({ ...currentSettings, intervals: newIntervals });

      saveSettingsMutation.mutate({ ...currentSettings, intervals: newIntervals });
    },
    [savedPersonalSettings, localSettings, saveSettingsMutation]
  );

  const updateDefault = useCallback(
    (min, channel, value) => {
      const key = String(min);
      setLocalDefaults((prev) => {
        const current = prev || mergeStaffPrefsWithDefaults(savedSettings?.default_staff_preferences);
        const newDefaults = {
          ...current,
          intervals: {
            ...current.intervals,
            [key]: { ...current.intervals[key], [channel]: value },
          },
        };
        saveDefaultsMutation.mutate(newDefaults);
        return newDefaults;
      });
    },
    [savedSettings, saveDefaultsMutation]
  );

  const updatePersonalSetting = useCallback((field, value) => {
    const current = localSettings || mergeWithDefaults(savedPersonalSettings);
    const next = { ...current, [field]: value };
    setLocalSettings(next);
    saveSettingsMutation.mutate(next);
  }, [localSettings, savedPersonalSettings, saveSettingsMutation]);

  const updateCompanyDefaultSetting = useCallback((field, value) => {
    const current = localDefaults || mergeStaffPrefsWithDefaults(savedSettings?.default_staff_preferences);
    const next = { ...current, [field]: value };
    setLocalDefaults(next);
    saveDefaultsMutation.mutate(next);
  }, [localDefaults, savedSettings, saveDefaultsMutation]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-blue-700 text-sm">
            <Info className="w-4 h-4" />
            How appointment reminders work
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-2">
          <p>
            Whenever a calendar appointment is scheduled, the system automatically sends reminders at the
            intervals you choose below. Each interval can fire via <strong>Email</strong>,{" "}
            <strong>SMS</strong>, or both.
          </p>
          <p className="text-xs text-gray-500">
            To control Twilio costs, early reminders are email-only. SMS is reserved for the urgent 1-hour reminder. Changes take effect on the next cron run.
          </p>
        </CardContent>
      </Card>

      <Card className={!displaySettings.enabled ? "border-gray-300 bg-gray-50" : "border-blue-200"}>
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="font-semibold">My appointment reminders</Label>
              <p className="text-xs text-gray-500">Turn off all email, SMS, and in-app appointment alerts for this staff member.</p>
            </div>
            <Switch
              checked={displaySettings.enabled}
              onCheckedChange={(value) => updatePersonalSetting("enabled", value)}
              data-testid="switch-personal-appointment-reminders"
            />
          </div>
          <div className={`flex items-center gap-2 ${!displaySettings.enabled ? "opacity-50" : ""}`}>
            <Moon className="w-4 h-4 text-gray-500" />
            <Label className="text-sm flex-1">Quiet hours</Label>
            <Input
              type="time"
              value={displaySettings.quiet_hours.start}
              disabled={!displaySettings.enabled}
              onChange={(e) => updatePersonalSetting("quiet_hours", { ...displaySettings.quiet_hours, start: e.target.value })}
              className="w-28 h-8"
              data-testid="input-personal-quiet-start"
            />
            <span className="text-xs text-gray-500">to</span>
            <Input
              type="time"
              value={displaySettings.quiet_hours.end}
              disabled={!displaySettings.enabled}
              onChange={(e) => updatePersonalSetting("quiet_hours", { ...displaySettings.quiet_hours, end: e.target.value })}
              className="w-28 h-8"
              data-testid="input-personal-quiet-end"
            />
          </div>
        </CardContent>
      </Card>

      {settingsLoading ? (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bell className="w-4 h-4" />
              Appointment reminder intervals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 pb-2 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
              <span>Interval</span>
              <span className="text-center w-14">Active</span>
              <span className="flex items-center gap-1 w-16 justify-center"><Mail className="w-3 h-3" /> Email</span>
              <span className="flex items-center gap-1 w-14 justify-center"><MessageSquare className="w-3 h-3" /> SMS</span>
            </div>

            {INTERVALS.map((iv) => {
              const cfg = displaySettings.intervals[String(iv.min)] || DEFAULT_INTERVAL_SETTINGS;
              return (
                <div
                  key={iv.min}
                  className={`grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center py-3 border-b last:border-0 ${!cfg.enabled ? "opacity-50" : ""}`}
                  data-testid={`row-interval-${iv.min}`}
                >
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{iv.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5 hidden sm:block">{iv.description}</p>
                  </div>
                  <div className="flex justify-center w-14">
                    <Switch
                      checked={cfg.enabled}
                      onCheckedChange={(val) => updateInterval(iv.min, "enabled", val)}
                      data-testid={`switch-enabled-${iv.min}`}
                    />
                  </div>
                  <div className="flex justify-center w-16">
                    <Checkbox
                      checked={cfg.email}
                      disabled={!cfg.enabled}
                      onCheckedChange={(val) => updateInterval(iv.min, "email", val)}
                      data-testid={`checkbox-email-${iv.min}`}
                    />
                  </div>
                  <div className="flex justify-center w-14">
                    <Checkbox
                      checked={SMS_ELIGIBLE_INTERVALS.has(iv.min) && cfg.sms}
                      disabled={!cfg.enabled || !SMS_ELIGIBLE_INTERVALS.has(iv.min)}
                      onCheckedChange={(val) => updateInterval(iv.min, "sms", val)}
                      data-testid={`checkbox-sms-${iv.min}`}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {showCompanyDefaults && !settingsLoading && (
        <Card className="border-orange-200">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-orange-700">
              <Building2 className="w-4 h-4" />
              Company default reminder preferences
            </CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              These defaults apply to any staff member who hasn't set their own reminder preferences.
              Staff can override these in their personal settings.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-md bg-orange-50 p-3">
              <div>
                <Label className="font-semibold text-orange-800">Company default reminders</Label>
                <p className="text-xs text-gray-500">Turn off all default staff appointment alerts.</p>
              </div>
              <Switch
                checked={displayDefaults.enabled}
                onCheckedChange={(value) => updateCompanyDefaultSetting("enabled", value)}
                data-testid="switch-company-appointment-reminders"
              />
            </div>
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4 text-gray-500" />
              <Label className="text-sm flex-1">Company quiet hours</Label>
              <Input
                type="time"
                value={displayDefaults.quiet_hours.start}
                disabled={!displayDefaults.enabled}
                onChange={(e) => updateCompanyDefaultSetting("quiet_hours", { ...displayDefaults.quiet_hours, start: e.target.value })}
                className="w-28 h-8"
                data-testid="input-company-quiet-start"
              />
              <span className="text-xs text-gray-500">to</span>
              <Input
                type="time"
                value={displayDefaults.quiet_hours.end}
                disabled={!displayDefaults.enabled}
                onChange={(e) => updateCompanyDefaultSetting("quiet_hours", { ...displayDefaults.quiet_hours, end: e.target.value })}
                className="w-28 h-8"
                data-testid="input-company-quiet-end"
              />
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 pb-2 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
              <span>Interval</span>
              <span className="flex items-center gap-1 w-16 justify-center"><Mail className="w-3 h-3" /> Email</span>
              <span className="flex items-center gap-1 w-14 justify-center"><MessageSquare className="w-3 h-3" /> SMS</span>
            </div>

            {INTERVALS.map((iv) => {
               const cfg = displayDefaults.intervals[String(iv.min)] || { email: true, sms: SMS_ELIGIBLE_INTERVALS.has(iv.min) };
              const intervalEnabled = displaySettings.intervals[String(iv.min)]?.enabled !== false;
              return (
                <div
                  key={iv.min}
                  className={`grid grid-cols-[1fr_auto_auto] gap-4 items-center py-3 border-b last:border-0 ${!intervalEnabled ? "opacity-40" : ""}`}
                  data-testid={`row-default-${iv.min}`}
                >
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{iv.label}</p>
                    {!intervalEnabled && (
                      <p className="text-xs text-orange-500 mt-0.5">Interval disabled above — won't fire</p>
                    )}
                  </div>
                  <div className="flex justify-center w-16">
                    <Checkbox
                      checked={cfg.email}
                      disabled={!intervalEnabled || displayDefaults.enabled === false}
                      onCheckedChange={(val) => updateDefault(iv.min, "email", val)}
                      data-testid={`checkbox-default-email-${iv.min}`}
                    />
                  </div>
                  <div className="flex justify-center w-14">
                    <Checkbox
                       checked={SMS_ELIGIBLE_INTERVALS.has(iv.min) && cfg.sms}
                       disabled={!intervalEnabled || displayDefaults.enabled === false || !SMS_ELIGIBLE_INTERVALS.has(iv.min)}
                      onCheckedChange={(val) => updateDefault(iv.min, "sms", val)}
                      data-testid={`checkbox-default-sms-${iv.min}`}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-gray-400 text-center">
        {saveSettingsMutation.isPending || saveDefaultsMutation.isPending
          ? "Saving…"
          : saveSettingsMutation.isSuccess || saveDefaultsMutation.isSuccess
          ? "Settings saved ✓"
          : "Changes save automatically"}
      </p>
    </div>
  );
}
