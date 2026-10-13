import { useState, useEffect, useRef } from 'react';
import { Users, ChevronDown, ChevronUp } from 'lucide-react';

const AVATAR_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#f97316'];

function colorFor(email) {
  let h = 0;
  for (const c of (email || '')) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export default function OnlineUsersWidget({ companyId, currentUserEmail }) {
  const [users, setUsers] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const intervalRef = useRef(null);

  const fetchPresence = async () => {
    if (!companyId) return;
    try {
      const resp = await fetch(`/api/local/presence?company_id=${encodeURIComponent(companyId)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (_) {}
  };

  useEffect(() => {
    fetchPresence();
    // Presence expires after ten minutes server-side, so a two-minute refresh
    // remains responsive without polling the global sidebar every minute.
    intervalRef.current = setInterval(fetchPresence, 2 * 60 * 1000);
    return () => clearInterval(intervalRef.current);
  }, [companyId]);

  if (users.length === 0) return null;

  // Current user first, then others alphabetically
  const me = users.find(u => u.user_email === currentUserEmail);
  const others = users
    .filter(u => u.user_email !== currentUserEmail)
    .sort((a, b) => (a.user_name || '').localeCompare(b.user_name || ''));
  const sorted = me ? [me, ...others] : others;

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: 10, paddingTop: 8, paddingLeft: 4, paddingRight: 4 }}>
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '6px 8px', borderRadius: 8,
          background: 'rgba(255,255,255,0.07)', border: 'none', cursor: 'pointer',
          color: '#fff', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <Users size={14} />
            <span style={{
              position: 'absolute', top: -4, right: -5,
              background: '#22c55e', borderRadius: '50%',
              width: 7, height: 7, border: '1px solid #1e3a8a',
            }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {users.length} online
          </span>
          {/* Stacked avatar chips when collapsed */}
          {!expanded && (
            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 2 }}>
              {sorted.slice(0, 5).map((u, i) => (
                <div
                  key={u.user_email}
                  title={u.user_email === currentUserEmail ? 'You' : (u.user_name || u.user_email)}
                  style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: colorFor(u.user_email),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 700, color: '#fff',
                    border: '1.5px solid rgba(255,255,255,0.35)',
                    marginLeft: i === 0 ? 0 : -6,
                    zIndex: 5 - i,
                    position: 'relative',
                  }}
                >
                  {initials(u.user_email === currentUserEmail ? 'Me' : u.user_name)}
                </div>
              ))}
              {users.length > 5 && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginLeft: 4 }}>
                  +{users.length - 5}
                </span>
              )}
            </div>
          )}
        </div>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {/* Expanded list */}
      {expanded && (
        <div style={{ marginTop: 4, paddingBottom: 2 }}>
          {sorted.map(u => {
            const isMe = u.user_email === currentUserEmail;
            return (
              <div
                key={u.user_email}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 8px', borderRadius: 6,
                  background: isMe ? 'rgba(255,255,255,0.1)' : 'transparent',
                  marginBottom: 1,
                }}
              >
                {/* Avatar with online dot */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: colorFor(u.user_email),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: '#fff',
                  }}>
                    {initials(u.user_name)}
                  </div>
                  <span style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#22c55e', border: '1.5px solid #1e3a8a',
                  }} />
                </div>

                {/* Name + page */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: '#fff',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {isMe ? 'You' : (u.user_name || u.user_email.split('@')[0])}
                  </div>
                  <div style={{
                    fontSize: 10, color: 'rgba(255,255,255,0.5)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {u.page_label || u.page || '—'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
