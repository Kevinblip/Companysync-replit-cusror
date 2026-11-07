import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

const STAGES = ['New', 'Demo Booked', 'Demo Held', 'No-Show', 'Handoff', 'Trial Started', 'Subscribed', 'Lost'];

export default function SalesAgentAdmin() {
  const [user, setUser] = useState(null);
  const [overview, setOverview] = useState(null);
  const [preview, setPreview] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [voice, setVoice] = useState('Fenrir');
  const [agentName, setAgentName] = useState('Cole');

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  async function load() {
    const response = await fetch('/api/sales-agent/admin/overview', { credentials: 'include' });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Could not load the sales agent.');
      return;
    }
    setOverview(data);
    setVoice(data.config?.voice || 'Fenrir');
    setAgentName(data.config?.agentName || 'Cole');
  }

  const isSuper = user?.platform_role === 'super_admin' || user?.is_super_admin === true;

  useEffect(() => {
    if (isSuper) load().catch(() => setError('Could not load the sales agent.'));
  }, [user]);

  async function simulate() {
    const response = await fetch('/api/sales-agent/admin/simulate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    setPreview(await response.json());
  }

  async function loadSummary() {
    const response = await fetch('/api/sales-agent/admin/summary', { credentials: 'include' });
    setSummary(await response.json());
  }

  async function saveConfig(event) {
    event.preventDefault();
    const response = await fetch('/api/sales-agent/admin/config', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentName, voice }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.error || 'Could not save.');
    else load();
  }

  async function setStage(leadId, stage) {
    await fetch('/api/sales-agent/admin/stage', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leadId, stage }),
    });
    load();
  }

  if (!user) return <main className="p-8">Checking access…</main>;
  if (user.platform_role !== 'super_admin' && user.is_super_admin !== true) return <main className="p-8">This page is for platform super admins.</main>;

  const leads = overview?.leads || [];
  const calls = overview?.calls || [];
  const messages = overview?.messages || [];

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Sales agent</h1>
        <p className="text-sm text-slate-600">
          {overview?.config?.agentName || 'Cole'} · voice {overview?.config?.voice || 'Fenrir'} · file store
          {overview?.config?.dryRun ? ' · sends suppressed' : ''}
        </p>
      </header>
      {error && <p className="text-sm text-red-700">{error}</p>}

      <section className="flex flex-wrap gap-3">
        <button type="button" className="rounded-full bg-slate-900 px-4 py-2 text-sm text-white" onClick={simulate}>Simulate next 14 days</button>
        <button type="button" className="rounded-full border px-4 py-2 text-sm" onClick={loadSummary}>Daily summary preview</button>
      </section>

      {preview && (
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Messages that would go out</h2>
          <p className="text-sm text-slate-500">{preview.note}</p>
          <div className="mt-3 space-y-3">
            {(preview.messages || []).map((message) => (
              <article key={message.id} className="rounded-lg bg-stone-50 p-3 text-sm">
                <p className="font-medium">{message.kind} · {message.channel} · {message.dueAt}</p>
                <p>{message.subject || message.sms}</p>
                <pre className="mt-2 whitespace-pre-wrap text-xs">{message.email?.text || message.sms}</pre>
              </article>
            ))}
          </div>
        </section>
      )}

      {summary?.summary && (
        <section className="rounded-xl border bg-white p-4 text-sm">
          <h2 className="font-semibold">{summary.summary.subject}</h2>
          <pre className="mt-2 whitespace-pre-wrap">{summary.summary.text}</pre>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Pipeline</h2>
          {STAGES.map((stage) => (
            <div key={stage} className="mt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">{stage}</p>
              {leads.filter((lead) => lead.stage === stage).map((lead) => (
                <div key={lead.id} className="mt-1 flex items-center justify-between gap-2 text-sm">
                  <span>{lead.firstName || 'Lead'} {lead.lastName || ''} · {lead.company || lead.email}</span>
                  <select value={lead.stage} onChange={(event) => setStage(lead.id, event.target.value)} className="rounded border px-2 py-1">
                    {STAGES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ))}
          {leads.length === 0 && <p className="mt-2 text-sm text-slate-500">No leads in the file store yet.</p>}
        </div>
        <form className="rounded-xl border bg-white p-4" onSubmit={saveConfig}>
          <h2 className="font-semibold">Config</h2>
          <label className="mt-3 block text-sm">Name
            <input className="mt-1 w-full rounded border px-3 py-2" value={agentName} onChange={(event) => setAgentName(event.target.value)} />
          </label>
          <label className="mt-3 block text-sm">Voice
            <select className="mt-1 w-full rounded border px-3 py-2" value={voice} onChange={(event) => setVoice(event.target.value)}>
              {(overview?.config?.voices || ['Fenrir', 'Charon', 'Orus', 'Puck']).map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <p className="mt-3 text-sm">Prices stay Basic $99, Business $199, Enterprise $399. Handoff rep: {overview?.config?.handoff?.name || 'Kevin'}.</p>
          <button className="mt-3 rounded-full bg-slate-900 px-4 py-2 text-sm text-white" type="submit">Save</button>
        </form>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Calls</h2>
        {calls.map((call) => (
          <article key={call.id} className="mt-3 border-t pt-3 text-sm">
            <p>{call.startedAt} · {call.outcome || 'open'} · {call.durationSec || 0}s</p>
            <p className="text-slate-600">{call.synopsis}</p>
            <p className="text-xs">{(call.transcript || []).map((line) => `${line.role}: ${line.text}`).join(' | ')}</p>
            {call.recordingIn && <a className="text-blue-700 underline" href={`/api/sales-agent/admin/recording?id=${encodeURIComponent(call.id.replace(/-in$/, ''))}&leg=in`}>Inbound audio</a>}
          </article>
        ))}
        {calls.length === 0 && <p className="mt-2 text-sm text-slate-500">No calls yet.</p>}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Outbound log</h2>
        {messages.map((message) => (
          <article key={message.id} className="mt-3 border-t pt-3 text-sm">
            <p>{message.kind} · {message.channel} · {message.to} {message.suppressed ? '· suppressed' : ''}</p>
            <p className="font-medium">{message.subject}</p>
            <pre className="whitespace-pre-wrap text-xs">{message.body}</pre>
          </article>
        ))}
        {messages.length === 0 && <p className="mt-2 text-sm text-slate-500">No messages yet.</p>}
      </section>
    </main>
  );
}
