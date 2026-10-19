import { useCallback, useEffect, useRef, useState } from 'react';

const RECORDING = 'This call is recorded and transcribed so we can follow up accurately.';

function pcmToBase64(float32) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodePcm(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
}

export default function SalesDemo() {
  const reschedule = window.location.pathname.includes('/reschedule');
  const params = new URLSearchParams(window.location.search);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState([]);
  const [slots, setSlots] = useState([]);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', company: '', trade: 'storm', start: '' });
  const [booked, setBooked] = useState(null);
  const [clip, setClip] = useState(null);
  const [rescheduleInfo, setRescheduleInfo] = useState(null);
  const videoRef = useRef(null);
  const wsRef = useRef(null);
  const audioRef = useRef(null);
  const playAt = useRef(0);
  const clipPlaying = useRef(false);
  const clipEnd = useRef(0);

  const loadSlots = useCallback(async () => {
    const response = await fetch('/api/sales-demo/slots');
    const data = await response.json();
    setSlots(data.slots || []);
  }, []);

  useEffect(() => {
    loadSlots().catch(() => setError('Could not load times.'));
    if (!reschedule) return;
    const token = params.get('t');
    if (!token) return;
    fetch(`/api/sales-demo/reschedule?t=${encodeURIComponent(token)}`)
      .then((response) => response.json())
      .then((data) => {
        setRescheduleInfo(data);
        if (data.slots) setSlots(data.slots);
      })
      .catch(() => setError('That reschedule link is not valid.'));
  }, [loadSlots, reschedule]);

  useEffect(() => () => {
    try { wsRef.current?.close(); } catch (_) { /* page left */ }
    try { audioRef.current?.close(); } catch (_) { /* page left */ }
  }, []);

  function playAgentAudio(base64, mime) {
    if (clipPlaying.current || !audioRef.current) return;
    const rateMatch = /rate=(\d+)/.exec(mime || '');
    const sourceRate = rateMatch ? Number(rateMatch[1]) : 24000;
    const samples = decodePcm(base64);
    const ctx = audioRef.current;
    const ratio = ctx.sampleRate / sourceRate;
    const length = Math.max(1, Math.round(samples.length * ratio));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const pos = i / ratio;
      const left = Math.floor(pos);
      const frac = pos - left;
      const a = samples[left] || 0;
      const b = samples[Math.min(left + 1, samples.length - 1)] || 0;
      channel[i] = a + (b - a) * frac;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const start = Math.max(ctx.currentTime, playAt.current);
    source.start(start);
    playAt.current = start + buffer.duration;
  }

  function pauseClip() {
    clipPlaying.current = false;
    const video = videoRef.current;
    if (video && !video.paused) video.pause();
  }

  async function startCall() {
    setError('');
    setStatus('connecting');
    try {
      const sessionResponse = await fetch('/api/sales-demo/session', { method: 'POST' });
      const sessionBody = await sessionResponse.json();
      if (!sessionResponse.ok) {
        setStatus('idle');
        setError(sessionBody.error || 'Could not start.');
        return;
      }
      setSession(sessionBody);
      const audio = new AudioContext();
      audioRef.current = audio;
      if (audio.state === 'suspended') await audio.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audio.createMediaStreamSource(stream);
      const processor = audio.createScriptProcessor(4096, 1, 1);
      const mute = audio.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(audio.destination);
      const booking = params.get('booking') || '';
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${protocol}://${window.location.host}/ws/sales-demo?token=${encodeURIComponent(sessionBody.token)}${booking ? `&booking=${encodeURIComponent(booking)}` : ''}`);
      wsRef.current = ws;
      processor.onaudioprocess = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        let energy = 0;
        for (let i = 0; i < input.length; i += 1) energy += input[i] * input[i];
        const speech = energy / input.length > 0.0008;
        if (speech && clipPlaying.current) ws.send(JSON.stringify({ type: 'barge_in' }));
        ws.send(JSON.stringify({ type: 'audio', data: pcmToBase64(input), speech }));
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'status') setStatus(message.status || 'ready');
        if (message.type === 'transcript') {
          setTranscript((rows) => [...rows, { role: message.role, text: message.text }]);
        }
        if (message.type === 'audio') playAgentAudio(message.data, message.mimeType);
        if (message.type === 'play_clip') {
          clipPlaying.current = true;
          clipEnd.current = message.end;
          playAt.current = 0;
          setClip(message);
          const video = videoRef.current;
          if (video) {
            const startAt = Number(message.start) || 0;
            const begin = () => {
              video.currentTime = startAt;
              video.play().catch(() => {});
              video.removeEventListener('loadedmetadata', begin);
            };
            video.addEventListener('loadedmetadata', begin);
            video.src = message.url;
          }
        }
        if (message.type === 'pause_clip') pauseClip();
        if (message.type === 'error') setError(message.message);
      };
      ws.onclose = () => setStatus('ended');
      ws.onerror = () => setError('The voice connection closed.');
    } catch (err) {
      setStatus('idle');
      setError(err && err.name === 'NotAllowedError' ? 'Allow the microphone to talk with Cole.' : 'Could not start the call.');
    }
  }

  function onVideoTime() {
    const video = videoRef.current;
    if (!video || !clip || !clipPlaying.current) return;
    if (video.currentTime >= clipEnd.current) {
      pauseClip();
      video.pause();
      wsRef.current?.send(JSON.stringify({ type: 'clip_ended' }));
    }
  }

  async function submitBooking(event) {
    event.preventDefault();
    setError('');
    if (reschedule) {
      const response = await fetch('/api/sales-demo/reschedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: params.get('t'), start: form.start }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) setError(data.error || 'Could not move the demo.');
      else setBooked(data.booking);
      return;
    }
    const response = await fetch('/api/sales-demo/book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) setError(data.error || 'Pick an open time.');
    else setBooked(data.booking);
  }

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="min-h-screen bg-stone-100 text-slate-900">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1.3fr_0.9fr]">
        <section className="rounded-2xl bg-slate-950 p-4 text-white shadow-xl">
          <p className="text-xs uppercase tracking-[0.2em] text-amber-200">CompanySync</p>
          <h1 className="mt-2 text-3xl font-semibold">Talk with {session?.agentName || 'Cole'}</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-300">{RECORDING}</p>
          <div className="mt-4 overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              className="aspect-video w-full bg-slate-900"
              controls
              playsInline
              onTimeUpdate={onVideoTime}
            />
          </div>
          {!clip && <p className="mt-2 text-sm text-slate-400">A training clip plays here when Cole cues one.</p>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={startCall}
              disabled={status === 'connecting' || status === 'ready'}
              className="rounded-full bg-amber-300 px-5 py-2 font-semibold text-slate-950 disabled:opacity-60"
            >
              {status === 'ready' ? 'On the call' : 'Talk to a rep'}
            </button>
            {status === 'ready' && (
              <button
                type="button"
                className="rounded-full border border-white/30 px-4 py-2 text-sm"
                onClick={() => wsRef.current?.send(JSON.stringify({ type: 'stop' }))}
              >
                End call
              </button>
            )}
            <span className="text-sm text-slate-300">{status}</span>
          </div>
          {session?.dryRun && <p className="mt-3 text-xs text-amber-200">Staging preview: texts and emails are logged, not sent.</p>}
          <div className="mt-4 max-h-48 space-y-2 overflow-auto rounded-xl bg-white/5 p-3 text-sm">
            {transcript.length === 0 && <p className="text-slate-400">The transcript shows up here.</p>}
            {transcript.map((line, index) => (
              <p key={`${line.role}-${index}`}><span className="text-amber-200">{line.role === 'agent' ? (session?.agentName || 'Cole') : 'You'}: </span>{line.text}</p>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">{reschedule ? 'Pick a new time' : 'Book a 15-minute demo'}</h2>
          <p className="mt-1 text-sm text-slate-600">Basic $99, Business $199, Enterprise $399 a month. 14-day free trial, no card.</p>
          {rescheduleInfo?.firstName && <p className="mt-2 text-sm">Hi {rescheduleInfo.firstName}. Your current time is {rescheduleInfo.booking?.start ? new Date(rescheduleInfo.booking.start).toLocaleString() : 'on file'}.</p>}
          {booked ? (
            <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">Booked for {new Date(booked.start).toLocaleString()}. A confirmation is queued. On staging it is not actually emailed.</p>
          ) : (
            <form className="mt-4 space-y-3" onSubmit={submitBooking}>
              {!reschedule && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <input className="rounded-lg border px-3 py-2" placeholder="First name" value={form.firstName} onChange={(event) => setField('firstName', event.target.value)} required />
                    <input className="rounded-lg border px-3 py-2" placeholder="Last name" value={form.lastName} onChange={(event) => setField('lastName', event.target.value)} />
                  </div>
                  <input className="w-full rounded-lg border px-3 py-2" placeholder="Email" type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} required />
                  <input className="w-full rounded-lg border px-3 py-2" placeholder="Mobile" value={form.phone} onChange={(event) => setField('phone', event.target.value)} />
                  <input className="w-full rounded-lg border px-3 py-2" placeholder="Company" value={form.company} onChange={(event) => setField('company', event.target.value)} />
                  <select className="w-full rounded-lg border px-3 py-2" value={form.trade} onChange={(event) => setField('trade', event.target.value)}>
                    <option value="storm">Storm / insurance</option>
                    <option value="retail">Retail roofing</option>
                    <option value="siding">Siding / exteriors</option>
                    <option value="gutters">Gutters</option>
                  </select>
                </>
              )}
              <div className="grid max-h-52 gap-2 overflow-auto">
                {slots.map((slot) => (
                  <button
                    type="button"
                    key={slot.start}
                    onClick={() => setField('start', slot.start)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm ${form.start === slot.start ? 'border-slate-900 bg-slate-900 text-white' : ''}`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
              <button className="w-full rounded-full bg-slate-900 px-4 py-2 font-semibold text-white" type="submit" disabled={!form.start}>
                {reschedule ? 'Move my demo' : 'Book this time'}
              </button>
            </form>
          )}
          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        </section>
      </div>
    </main>
  );
}
