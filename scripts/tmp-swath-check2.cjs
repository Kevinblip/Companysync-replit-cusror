const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');
(async () => {
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  const sid = crypto.randomUUID();
  const sess = { cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { sub: 'io.companysync@gmail.com', email: 'io.companysync@gmail.com' }, expires_at: Math.floor(Date.now()/1000)+3600 } } };
  await pool.query("INSERT INTO sessions (sid, sess, expire) VALUES ($1,$2, now() + interval '1 hour')", [sid, JSON.stringify(sess)]);
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/,'');
  const cookie = 'connect.sid=' + encodeURIComponent('s:'+sid+'.'+sig);
  const cases = [
    { label: 'Fairlawn/Copley OH (Aug 10 hail cluster)', lat: 41.11, lng: -81.62, startTime: '2026-08-10T13:12:00Z', affectedAreas: ['2 SE Fairlawn, OH'] },
    { label: 'Alliance OH (Aug 10 hail)', lat: 40.92, lng: -81.09, startTime: '2026-08-10T13:50:00Z', affectedAreas: ['1 E Alliance, OH'] },
  ];
  for (const c of cases) {
    const r = await fetch('http://127.0.0.1:5000/api/functions/invoke', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ functionName: 'suggestStormSwathAreas', params: { lat: c.lat, lng: c.lng, startTime: c.startTime, affectedAreas: c.affectedAreas, secondaryAreas: [] } }),
    });
    const d = await r.json(); const out = d.data || d;
    console.log(`\n== ${c.label}: reports=${out.iemCount} source=${out.reportSource}`);
    (out.suggestions||[]).forEach(s => console.log(`  ${s.confirmed ? 'CONFIRMED' : 'gray'}  ${s.name}  ${s.distMiles} mi  hail ${s.hailSize||'-'}`));
    if (out.error || d.error) console.log('ERROR:', out.error || d.error);
  }
  await pool.query('DELETE FROM sessions WHERE sid=$1', [sid]);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
