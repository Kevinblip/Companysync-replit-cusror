import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useRoleBasedData } from '@/components/hooks/useRoleBasedData';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { isWithinQuietHours } from '@/utils/notificationQuietHours';

// ── CSS keyframes injected once ──────────────────────────────────────────────
const STYLE_ID = 'upcoming-event-alert-styles';
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes uea-pulse-slow  { 0%,100%{opacity:1} 50%{opacity:.55} }
    @keyframes uea-pulse-med   { 0%,100%{opacity:1} 50%{opacity:.45} }
    @keyframes uea-pulse-fast  { 0%,100%{opacity:1} 50%{opacity:.30} }
    @keyframes uea-strobe      { 0%,49%{opacity:1}  50%,100%{opacity:.15} }
    .uea-t1 { animation: uea-pulse-slow 2s   ease-in-out infinite; }
    .uea-t2 { animation: uea-pulse-med  1.2s ease-in-out infinite; }
    .uea-t3 { animation: uea-pulse-fast 0.6s ease-in-out infinite; }
    .uea-t4 { animation: uea-strobe     0.35s step-end    infinite; }
  `;
  document.head.appendChild(s);
}

// ── Mute preference — persisted per user in localStorage ──────────────────
const muteKey = (email) => `uea_muted_${email || 'anon'}`;

// ── Singleton AudioContext — created once, stays resumed after first user tap ─
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
  }
  return _audioCtx;
}
function resumeAudioCtx() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

function playBeeps(count) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const play = () => {
      for (let i = 0; i < count; i++) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        const t = ctx.currentTime + i * 0.38;
        osc.frequency.setValueAtTime(i % 2 === 0 ? 880 : 1046, t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.28, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
        osc.start(t);
        osc.stop(t + 0.26);
      }
    };
    if (ctx.state === 'suspended') {
      ctx.resume().then(play).catch(() => {});
    } else {
      play();
    }
  } catch (_) {}
}

// ── Urgency tiers ────────────────────────────────────────────────────────────
function getTier(minutesLeft) {
  if (minutesLeft > 120) return 1; // 4h–2h  → amber slow pulse, 1 beep
  if (minutesLeft > 60)  return 2; // 2h–1h  → orange med pulse, 2 beeps
  if (minutesLeft > 30)  return 3; // 1h–30m → red fast pulse, 3 beeps
  return 4;                         // <30m   → red strobe, 3 beeps repeated
}

const TIER = {
  1: { bg:'#fef3c7', border:'#f59e0b', text:'#78350f', cls:'uea-t1', icon:'🔔' },
  2: { bg:'#ffedd5', border:'#ea580c', text:'#7c2d12', cls:'uea-t2', icon:'⚠️' },
  3: { bg:'#fee2e2', border:'#dc2626', text:'#7f1d1d', cls:'uea-t3', icon:'🚨' },
  4: { bg:'#ef4444', border:'#991b1b', text:'#ffffff', cls:'uea-t4', icon:'🚨🚨🚨' },
};

function fmtCountdown(mins) {
  if (mins <= 0) return 'NOW';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ── Derive the best navigation target from a CalendarEvent ───────────────────
function getEventUrl(event) {
  const data = typeof event.data === 'string'
    ? JSON.parse(event.data || '{}')
    : (event.data || {});
  const type = event.event_type || data.event_type || '';

  if (type === 'inspection' || (event.title || '').toLowerCase().startsWith('inspection:')) {
    return createPageUrl('InspectionsDashboard');
  }

  const custId = event.customer_id || data.customer_id;
  if (custId) {
    return createPageUrl('CustomerProfile') + `?id=${custId}`;
  }

  const custName = event.related_customer || data.related_customer || data.customer_name;
  if (custName) {
    return createPageUrl('CustomerProfile') + `?name=${encodeURIComponent(custName)}`;
  }

  return createPageUrl('Calendar');
}

// ── Component ────────────────────────────────────────────────────────────────
export default function UpcomingEventAlert() {
  const { isAuthenticated, user } = useAuth();
  const { myCompany, isAdmin, myStaffProfile } = useRoleBasedData();
  const navigate = useNavigate();

  const [event, setEvent]       = useState(null);
  const [minsLeft, setMinsLeft] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [muted, setMuted]       = useState(false);
  const [reminderPreferences, setReminderPreferences] = useState({
    loading: true,
    enabled: true,
    quietHours: { enabled: true, start: '22:00', end: '07:00' },
  });

  const prevTierRef    = useRef(null);
  const prevEventIdRef = useRef(null);

  // Load mute preference once user email is known
  useEffect(() => {
    if (user?.email) {
      setMuted(localStorage.getItem(muteKey(user.email)) === 'true');
    }
  }, [user?.email]);

  const handleMute = () => {
    if (user?.email) localStorage.setItem(muteKey(user.email), 'true');
    setMuted(true);
  };

  const handleUnmute = () => {
    if (user?.email) localStorage.removeItem(muteKey(user.email));
    setMuted(false);
  };

  useEffect(() => {
    let cancelled = false;
    if (!myCompany?.id || !user?.email) return undefined;
    (async () => {
      try {
        const [settingsRows, profiles] = await Promise.all([
          base44.entities.ReminderSettings.filter({ company_id: myCompany.id }, '-created_date', 1),
          base44.entities.StaffProfile.filter({ company_id: myCompany.id, user_email: user.email }, '-created_date', 1),
        ]);
        const companyDefaults = settingsRows[0]?.default_staff_preferences || {};
        const personal = profiles[0]?.data?.reminder_preferences || null;
        if (!cancelled) {
          setReminderPreferences({
            loading: false,
            enabled: personal?.enabled ?? companyDefaults.enabled ?? true,
            quietHours: personal?.quiet_hours || companyDefaults.quiet_hours || { enabled: true, start: '22:00', end: '07:00' },
          });
        }
      } catch (_) {
        if (!cancelled) setReminderPreferences(prev => ({ ...prev, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, [myCompany?.id, user?.email]);

  // ── fetch soonest upcoming event within 4 hours ──
  const fetchUpcoming = useCallback(async () => {
    if (!myCompany?.id || reminderPreferences.loading) return;
    if (!reminderPreferences.enabled || isWithinQuietHours(
      reminderPreferences.quietHours,
      myCompany?.timezone || myCompany?.settings?.time_zone,
    )) {
      setEvent(null);
      setMinsLeft(null);
      return;
    }
    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + 4.1 * 60 * 60 * 1000);

      // Resolve the current user's email for scoped filtering
      const userEmail = user?.email
        || myStaffProfile?.user_email
        || myStaffProfile?.email;

      // Non-admin staff only see events assigned to them — admins see all
      const filter = {
        company_id: myCompany.id,
        start_time: { $gte: now.toISOString(), $lte: windowEnd.toISOString() },
        ...((!isAdmin && userEmail) ? { assigned_to: userEmail } : {}),
      };

      const events = await base44.entities.CalendarEvent.filter(
        filter,
        'start_time',
        20
      );
      const active = events.filter(e => {
        const d = typeof e.data === 'string' ? JSON.parse(e.data || '{}') : (e.data || {});
        return d.status !== 'cancelled' && d.status !== 'completed';
      });
      if (!active.length) { setEvent(null); setMinsLeft(null); return; }

      const soonest = active[0];
      const mins = Math.floor((new Date(soonest.start_time) - Date.now()) / 60000);
      if (mins < 0) { setEvent(null); setMinsLeft(null); return; }

      if (soonest.id !== prevEventIdRef.current) {
        setDismissed(false);
        prevEventIdRef.current = soonest.id;
      }
      setEvent(soonest);
      setMinsLeft(mins);
    } catch (_) {}
  }, [myCompany?.id, myCompany?.timezone, myCompany?.settings?.time_zone, reminderPreferences, isAdmin, user?.email, myStaffProfile]);

  useEffect(() => { injectStyles(); }, []);

  // Poll every 60 s
  useEffect(() => {
    if (!isAuthenticated || !myCompany?.id) return;
    fetchUpcoming();
    const t = setInterval(fetchUpcoming, 60_000);
    return () => clearInterval(t);
  }, [isAuthenticated, myCompany?.id, fetchUpcoming]);

  // Play beeps on every tier change, including first appearance.
  useEffect(() => {
    if (!event || minsLeft === null || dismissed || muted) return;
    const tier = getTier(minsLeft);
    if (tier !== prevTierRef.current) {
      prevTierRef.current = tier;
      const beepCount = tier === 4 ? 3 : tier;
      playBeeps(beepCount);
    }
  }, [event, minsLeft, dismissed, muted]);

  // Continuous triple-beep every 60 s for <30 min (tier 4)
  useEffect(() => {
    if (!event || minsLeft === null || dismissed || muted) return;
    if (getTier(minsLeft) !== 4) return;
    const t = setInterval(() => playBeeps(3), 60_000);
    return () => clearInterval(t);
  }, [event, minsLeft, dismissed, muted]);

  if (!isAuthenticated) return null;

  // ── Muted state: show a tiny re-enable chip at top-right ──────────────────
  if (muted) {
    return (
      <button
        onClick={handleUnmute}
        title="Click to re-enable appointment reminders"
        data-testid="button-unmute-event-alert"
        style={{
          position: 'fixed', top: 8, right: 16, zIndex: 9999,
          background: 'rgba(100,100,100,0.15)',
          border: '1px solid rgba(100,100,100,0.3)',
          borderRadius: 20, padding: '3px 10px',
          fontSize: 11, color: '#666', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
          backdropFilter: 'blur(4px)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        🔕 <span>Reminders off</span>
      </button>
    );
  }

  if (!event || minsLeft === null || dismissed) return null;

  const tier = getTier(minsLeft);
  const ts   = TIER[tier];
  const eventTime = new Date(event.start_time).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const targetUrl = getEventUrl(event);

  return (
    <div
      className={ts.cls}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: ts.bg, borderBottom: `3px solid ${ts.border}`, color: ts.text,
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'system-ui, sans-serif', fontSize: 14, fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onClick={() => resumeAudioCtx()}
      data-testid="upcoming-event-alert"
    >
      <span style={{ fontSize: 22, flexShrink: 0 }}>{ts.icon}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 800 }}>{fmtCountdown(minsLeft)}</span>
        {' — '}
        <span style={{ fontWeight: 700 }}>{event.title || 'Upcoming Appointment'}</span>
        {event.location && (
          <span style={{ fontWeight: 400, marginLeft: 6, fontSize: 12, opacity: 0.85 }}>
            📍 {event.location}
          </span>
        )}
        <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12, opacity: 0.7 }}>
          {eventTime}
        </span>
      </div>

      <button
        onClick={e => { e.stopPropagation(); navigate(targetUrl); }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: ts.text, textDecoration: 'underline', fontSize: 13,
          whiteSpace: 'nowrap', marginRight: 4, fontWeight: 600, padding: 0,
        }}
        data-testid="link-event-alert-view"
      >
        View
      </button>

      {/* Dismiss this event only */}
      <button
        onClick={e => { e.stopPropagation(); setDismissed(true); }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: ts.text, padding: '4px 6px', fontSize: 16, lineHeight: 1, flexShrink: 0,
        }}
        aria-label="Dismiss reminder"
        data-testid="button-dismiss-event-alert"
      >
        ✕
      </button>

      {/* Turn off alerts permanently (persisted) */}
      <button
        onClick={e => { e.stopPropagation(); handleMute(); }}
        title="Turn off appointment reminders"
        aria-label="Turn off appointment reminders"
        data-testid="button-mute-event-alert"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: ts.text, padding: '4px 4px', fontSize: 15, lineHeight: 1,
          flexShrink: 0, opacity: 0.65,
        }}
      >
        🔕
      </button>
    </div>
  );
}
