import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Persistent "your Google Calendar stopped syncing" banner.
 *
 * Google revokes refresh tokens without warning (most often because the OAuth
 * consent screen is still in Testing mode, which expires them every 7 days).
 * The server detects this and clears the credentials, but that used to be
 * invisible: sync just stopped. This banner keeps the failure on screen until
 * the user actually reconnects, rather than relying on a toast they can miss.
 *
 * Rendered on both the Calendar page and the Dashboard, so it lives here as a
 * shared component and owns its own fetch — the two pages have very different
 * data flows and duplicating the status logic in both would guarantee drift.
 */
function ReconnectAlert({ provider, status, className }) {
  const [isConnecting, setIsConnecting] = useState(false);
  const isMicrosoft = provider === 'microsoft';
  const label = isMicrosoft ? 'Outlook Calendar' : 'Google Calendar';

  if (!status?.needs_reconnect) return null;

  const unsynced = status.unsynced_events || 0;

  const handleReconnect = async () => {
    setIsConnecting(true);
    try {
      const res = await base44.functions.invoke(
        isMicrosoft ? 'connectMicrosoftCalendar' : 'connectUserGoogleCalendar',
        {}
      );
      const authUrl = (res?.data ?? res)?.authUrl;
      if (authUrl) {
        window.location.href = authUrl;
        return;
      }
      throw new Error('No authorization URL returned');
    } catch (err) {
      console.error('[CalendarReconnectBanner] Reconnect failed:', err);
      setIsConnecting(false);
    }
  };

  return (
    <Alert className={`bg-red-50 border-red-300 ${className}`}>
      <AlertTriangle className="w-4 h-4 text-red-600" />
      <AlertDescription className="text-red-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <strong>{label} disconnected — appointments are not syncing</strong>
          <p className="text-sm mt-1">
            {unsynced > 0
              ? `${unsynced} appointment${unsynced === 1 ? '' : 's'} ${unsynced === 1 ? 'has' : 'have'} not reached your ${label}. Reconnecting pushes ${unsynced === 1 ? 'it' : 'them'} across automatically.`
              : `${isMicrosoft ? 'Microsoft' : 'Google'} ended the connection. Reconnect to restore two-way syncing.`}
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleReconnect}
          disabled={isConnecting}
          className="bg-red-600 hover:bg-red-700 text-white whitespace-nowrap flex-shrink-0 self-start sm:self-auto"
        >
          {isConnecting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
          Reconnect {label}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export default function GoogleCalendarReconnectBanner({ className = '' }) {
  const { data: googleStatus } = useQuery({
    // Namespaced key: a generic key like ['calendar'] would collide with the
    // calendar pages' own caches and serve them this partial payload.
    queryKey: ['google-calendar-connection-status'],
    queryFn: async () => {
      const res = await base44.functions.invoke('checkUserGoogleCalendarConnection', {});
      // invoke() call sites in this codebase read both shapes; accept either.
      return res?.data ?? res ?? null;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const { data: microsoftStatus } = useQuery({
    queryKey: ['microsoft-calendar-connection-status'],
    queryFn: async () => {
      const res = await base44.functions.invoke('checkMicrosoftCalendarConnection', {});
      return res?.data ?? res ?? null;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (!googleStatus?.needs_reconnect && !microsoftStatus?.needs_reconnect) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      <ReconnectAlert provider="google" status={googleStatus} />
      <ReconnectAlert provider="microsoft" status={microsoftStatus} />
    </div>
  );
}
