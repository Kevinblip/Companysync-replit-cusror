import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  ShieldCheck, ShieldAlert, ShieldX, Download, AlertTriangle,
  MapPin, Calendar, Building2, Phone, Mail, ChevronLeft,
  ChevronRight, X, Maximize2, FileText, ClipboardList,
  CheckSquare, Square, User, Zap, Wind, CloudHail, CloudLightning
} from 'lucide-react';

const severityColor = (sev) => {
  if (!sev) return { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200', dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-700' };
  const s = sev.toLowerCase();
  if (s === 'severe')   return { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-300',    dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700' };
  if (s === 'moderate') return { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-300',  dot: 'bg-amber-500',  badge: 'bg-amber-100 text-amber-700' };
  if (s === 'minor')    return { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-300', dot: 'bg-yellow-500', badge: 'bg-yellow-100 text-yellow-700' };
  return { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200', dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-700' };
};

const coverageStyle = (verdict) => {
  if (!verdict) return { icon: ShieldAlert, color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200', label: 'Pending Review' };
  const v = verdict.toLowerCase();
  if (v === 'covered')     return { icon: ShieldCheck, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', label: 'Covered' };
  if (v === 'not_covered') return { icon: ShieldX,     color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-300',     label: 'Not Covered' };
  return { icon: ShieldAlert, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', label: 'Mixed / Review Required' };
};

export default function SharePortal() {
  const { hash } = useParams();
  const [pkg, setPkg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(null);

  const downloadPdf = async () => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const r = await fetch(`/api/public/proof-package/${hash}/pdf`);
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || 'PDF generation failed');
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const addr = pkg?.job?.property_address || 'damage-evidence-report';
      a.download = addr.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 40).toLowerCase() + '.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfError(e.message || 'Could not generate PDF. Please try again.');
    } finally {
      setPdfLoading(false);
    }
  };

  useEffect(() => {
    if (!hash) { setError('Invalid link.'); setLoading(false); return; }
    fetch(`/api/public/proof-package/${hash}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.error || 'Not found')))
      .then(data => { setPkg(data); setLoading(false); })
      .catch(e => { setError(typeof e === 'string' ? e : 'Report not found or link has expired.'); setLoading(false); });
  }, [hash]);

  const openLightbox = (photos, idx) => { setLightbox(photos); setLightboxIdx(idx); };
  const closeLightbox = () => setLightbox(null);
  const prevPhoto = () => setLightboxIdx(i => Math.max(0, i - 1));
  const nextPhoto = () => setLightboxIdx(i => Math.min(lightbox.length - 1, i + 1));

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-4 border-blue-700 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-slate-500 text-sm">Loading damage evidence report…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-3 max-w-sm px-6">
        <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
        <h2 className="text-xl font-semibold text-slate-800">Report not found</h2>
        <p className="text-slate-500 text-sm">{error}</p>
      </div>
    </div>
  );

  const { job, photos, company, storm_events: stormEvents = [] } = pkg;
  const primaryColor = company?.brand_primary_color || company?.primary_color || '#1e3a8a';
  const photos_all = photos || [];
  const analyzed = photos_all.filter(p => p.ai_analysis);

  const totalHail = analyzed.reduce((s, p) => s + (p.ai_analysis?.hail_impact_count || 0), 0);
  const totalWind = analyzed.reduce((s, p) => s + (p.ai_analysis?.wind_damage_count || 0), 0);

  const severities = analyzed.map(p => p.ai_analysis?.severity_level).filter(Boolean);
  const overallSeverity = severities.includes('Severe') ? 'Severe'
    : severities.includes('Moderate') ? 'Moderate'
    : severities.includes('Minor') ? 'Minor' : null;

  const verdicts = analyzed.map(p => p.ai_analysis?.coverage_verdict).filter(Boolean);
  const dominantVerdict = verdicts.includes('covered') ? 'covered'
    : verdicts.includes('mixed') ? 'mixed'
    : verdicts.length > 0 ? 'not_covered' : null;

  const sevStyle = severityColor(overallSeverity);
  const covStyle = coverageStyle(dominantVerdict);
  const CovIcon = covStyle.icon;

  const sectionGroups = {};
  photos_all.forEach(p => {
    const s = p.section || 'General';
    if (!sectionGroups[s]) sectionGroups[s] = [];
    sectionGroups[s].push(p);
  });
  const flatPhotos = photos_all;

  // Notes / scope of work from the job record
  const reportNotes = job?.report_notes || '';
  const rawNotes = job?.notes;
  const sectionNotes = rawNotes
    ? (typeof rawNotes === 'string' ? (() => { try { return JSON.parse(rawNotes); } catch { return {}; } })() : rawNotes)
    : {};
  const hasSectionNotes = Object.values(sectionNotes).some(v => v && String(v).trim());

  const rawScope = job?.scope_of_work;
  const scopeItems = rawScope
    ? (Array.isArray(rawScope) ? rawScope : (() => { try { return JSON.parse(rawScope); } catch { return typeof rawScope === 'string' && rawScope.trim() ? [{ label: rawScope, completed: false }] : []; } })())
    : [];

  // AI damage narratives — collect unique damage descriptions
  const damageDescriptions = analyzed
    .filter(p => p.ai_analysis?.damage_description)
    .map(p => ({ desc: p.ai_analysis.damage_description, section: p.section || 'General', sev: p.ai_analysis.severity_level }))
    .filter((v, i, arr) => arr.findIndex(x => x.desc === v.desc) === i)
    .slice(0, 8);

  const reportDate = pkg.created_at
    ? new Date(pkg.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: primaryColor }} className="text-white print:text-black print:border-b-2 print:border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            {/* Company */}
            <div className="flex-1 min-w-0">
              {company?.logo_url
                ? <img src={company.logo_url} alt={company.company_name} className="h-9 object-contain mb-2 brightness-0 invert" onError={e => { e.currentTarget.style.display='none'; }} />
                : <div className="text-lg font-bold tracking-tight mb-1">{company?.company_name || 'Roofing Contractor'}</div>
              }
              <div className="flex flex-wrap gap-3 text-xs opacity-80">
                {company?.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{company.phone}</span>}
                {company?.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{company.email}</span>}
              </div>
            </div>
            {/* Report label */}
            <div className="text-right shrink-0">
              <div className="text-xs uppercase tracking-widest opacity-70 mb-0.5">Insurance Documentation</div>
              <div className="font-bold text-lg leading-tight">Damage Evidence Report</div>
              {reportDate && <div className="text-xs opacity-70 mt-0.5">{reportDate}</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8 space-y-6">

        {/* ── Property & Summary ─────────────────────────────────────── */}
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b bg-slate-50/60">
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 leading-snug">
              {job?.property_address || 'Property Inspection'}
            </h1>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-500">
              {job?.client_name && (
                <span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /><span className="font-medium text-slate-700">{job.client_name}</span></span>
              )}
              {job?.inspection_date && (
                <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />
                  Inspected {new Date(job.inspection_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
              )}
              {job?.damage_type && (
                <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" />{job.damage_type}</span>
              )}
              {job?.inspector_name && (
                <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" />Inspector: {job.inspector_name}</span>
              )}
            </div>
          </div>

          {/* Verdict row */}
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0">
            <div className="px-5 py-4 text-center">
              <div className="text-2xl font-bold text-blue-700">{photos_all.length}</div>
              <div className="text-xs text-slate-500 mt-0.5 uppercase tracking-wide">Photos Documented</div>
            </div>
            <div className="px-5 py-4 text-center">
              <div className="text-2xl font-bold text-violet-700">{analyzed.length}</div>
              <div className="text-xs text-slate-500 mt-0.5 uppercase tracking-wide">AI Analyzed</div>
            </div>
            <div className="px-5 py-4 text-center">
              <div className={`inline-flex items-center gap-1.5 text-2xl font-bold ${totalHail > 0 ? 'text-blue-700' : 'text-slate-400'}`}>
                <CloudHail className="w-5 h-5" />{totalHail}
              </div>
              <div className="text-xs text-slate-500 mt-0.5 uppercase tracking-wide">Hail Impacts</div>
            </div>
            <div className="px-5 py-4 text-center">
              <div className={`inline-flex items-center gap-1.5 text-2xl font-bold ${totalWind > 0 ? 'text-orange-600' : 'text-slate-400'}`}>
                <Wind className="w-5 h-5" />{totalWind}
              </div>
              <div className="text-xs text-slate-500 mt-0.5 uppercase tracking-wide">Wind Damage Pts</div>
            </div>
          </div>

          {/* Severity + coverage badges */}
          {(overallSeverity || dominantVerdict) && (
            <div className="flex flex-wrap gap-3 px-6 py-4 border-t bg-slate-50/40">
              {overallSeverity && (
                <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${sevStyle.bg} ${sevStyle.border}`}>
                  <div className={`w-2.5 h-2.5 rounded-full ${sevStyle.dot}`} />
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-60" style={{ color: 'inherit' }}>Overall Severity</div>
                    <div className={`font-bold text-sm ${sevStyle.text}`}>{overallSeverity}</div>
                  </div>
                </div>
              )}
              {dominantVerdict && (
                <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${covStyle.bg} ${covStyle.border}`}>
                  <CovIcon className={`w-5 h-5 ${covStyle.color}`} />
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-60">Coverage Determination</div>
                    <div className={`font-bold text-sm ${covStyle.color}`}>{covStyle.label}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Inspector's Findings ───────────────────────────────────── */}
        {(reportNotes || hasSectionNotes) && (
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-4 border-b bg-slate-50/60">
              <FileText className="w-4 h-4 text-blue-700" />
              <h2 className="font-semibold text-slate-800">Inspector's Findings</h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              {reportNotes && (
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{reportNotes}</p>
              )}
              {hasSectionNotes && (
                <div className="space-y-3 mt-2">
                  {Object.entries(sectionNotes).filter(([, v]) => v && String(v).trim()).map(([section, note]) => (
                    <div key={section} className="border-l-2 border-blue-300 pl-3">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{section}</div>
                      <p className="text-sm text-slate-700 leading-relaxed">{String(note)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Scope of Work ──────────────────────────────────────────── */}
        {scopeItems.length > 0 && (
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-4 border-b bg-slate-50/60">
              <ClipboardList className="w-4 h-4 text-blue-700" />
              <h2 className="font-semibold text-slate-800">Recommended Scope of Work</h2>
            </div>
            <ul className="divide-y">
              {scopeItems.map((item, i) => {
                const label = typeof item === 'string' ? item : (item.label || item.text || item.description || String(item));
                const completed = typeof item === 'object' && (item.completed || item.done || item.status === 'completed');
                return (
                  <li key={i} className="flex items-start gap-3 px-6 py-3">
                    {completed
                      ? <CheckSquare className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                      : <Square className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    }
                    <span className={`text-sm ${completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* ── AI Damage Analysis ────────────────────────────────────── */}
        {damageDescriptions.length > 0 && (
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-4 border-b bg-slate-50/60">
              <Zap className="w-4 h-4 text-blue-700" />
              <h2 className="font-semibold text-slate-800">AI Damage Analysis</h2>
              <span className="text-xs text-slate-400 ml-1">— generated from photo evidence</span>
            </div>
            <div className="divide-y">
              {damageDescriptions.map((d, i) => {
                const ss = severityColor(d.sev);
                return (
                  <div key={i} className="flex gap-3 px-6 py-4">
                    <div className="shrink-0 mt-1">
                      {d.sev
                        ? <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ss.badge}`}>{d.sev}</span>
                        : <span className="w-2 h-2 rounded-full bg-slate-300 inline-block mt-1" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">{d.section}</div>
                      <p className="text-sm text-slate-700 leading-relaxed">{d.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Storm Verification ───────────────────────────────────── */}
        {stormEvents.length > 0 && (
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden" data-testid="section-storm-verification">
            <div className="flex items-center gap-2 px-6 py-4 border-b bg-blue-50/60">
              <CloudLightning className="w-4 h-4 text-blue-700" />
              <h2 className="font-semibold text-slate-800">Storm Verification</h2>
              <span className="text-xs text-slate-400 ml-1">— official NWS / IEM records near this property</span>
            </div>
            <div className="divide-y">
              {stormEvents.map((storm, i) => {
                const stormDate = storm.start_time
                  ? new Date(storm.start_time).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                  : null;
                const stormSev = severityColor(storm.severity);
                return (
                  <div key={i} className="px-6 py-4 space-y-2" data-testid={`storm-event-${i}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      {storm.severity && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${stormSev.badge}`}>{storm.severity}</span>
                      )}
                      {storm.event_type && (
                        <span className="text-sm font-semibold text-slate-800">{storm.event_type}</span>
                      )}
                      {stormDate && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Calendar className="w-3 h-3" />{stormDate}
                        </span>
                      )}
                      {storm.source && (
                        <span className="text-xs text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">{storm.source}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                      {storm.hail_size_inches > 0 && (
                        <span className="flex items-center gap-1">
                          <CloudHail className="w-3.5 h-3.5 text-blue-600" />
                          <strong>{storm.hail_size_inches}"</strong> hail
                        </span>
                      )}
                      {storm.wind_speed_mph > 0 && (
                        <span className="flex items-center gap-1">
                          <Wind className="w-3.5 h-3.5 text-orange-500" />
                          <strong>{storm.wind_speed_mph} mph</strong> winds
                        </span>
                      )}
                      {Array.isArray(storm.affected_areas) && storm.affected_areas.length > 0 && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {storm.affected_areas.slice(0, 2).join(', ')}
                        </span>
                      )}
                    </div>
                    {storm.description && (
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">{storm.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-6 py-3 bg-slate-50 border-t">
              <p className="text-xs text-slate-400">Storm data sourced from the National Weather Service (NWS) and Iowa Environmental Mesonet (IEM). Records shown are within ~50 miles of the inspection date.</p>
            </div>
          </div>
        )}

        {/* ── Photo Evidence ────────────────────────────────────────── */}
        {Object.keys(sectionGroups).length > 0 && (
          <div>
            <h2 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <span className="w-5 h-0.5 bg-blue-700 inline-block" />
              Photo Evidence
              <span className="text-xs font-normal text-slate-400">({photos_all.length} photos)</span>
            </h2>
            <div className="space-y-6">
              {Object.entries(sectionGroups).map(([section, sectionPhotos]) => (
                <div key={section}>
                  <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2 border-b pb-1">{section}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {sectionPhotos.map((photo) => {
                      const imgSrc = photo.annotated_url || photo.file_url;
                      const ai = photo.ai_analysis;
                      const globalIdx = flatPhotos.indexOf(photo);
                      const pSev = ai?.severity_level ? severityColor(ai.severity_level) : null;
                      return (
                        <div
                          key={photo.id}
                          className="group relative bg-white rounded-xl border shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => openLightbox(flatPhotos, globalIdx)}
                          data-testid={`photo-card-${photo.id}`}
                        >
                          <div className="aspect-square bg-slate-100 overflow-hidden relative">
                            <img
                              src={imgSrc}
                              alt={photo.caption || section}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                              onError={e => {
                                e.currentTarget.style.display = 'none';
                                const fb = e.currentTarget.nextSibling;
                                if (fb) fb.style.display = 'flex';
                              }}
                            />
                            {/* fallback shown via JS when image URL fails */}
                            <div className="absolute inset-0 flex-col gap-1 text-slate-400" style={{ display: 'none', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
                              <FileText className="w-8 h-8 opacity-30" />
                              <span className="text-xs opacity-60">Photo unavailable</span>
                            </div>
                          </div>
                          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="bg-black/60 rounded-full p-1">
                              <Maximize2 className="w-3.5 h-3.5 text-white" />
                            </div>
                          </div>
                          {(photo.caption || ai) && (
                            <div className="p-2 space-y-1">
                              {photo.caption && <p className="text-xs font-medium text-slate-700 truncate">{photo.caption}</p>}
                              <div className="flex flex-wrap gap-1">
                                {pSev && (
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pSev.badge}`}>{ai.severity_level}</span>
                                )}
                                {ai?.hail_impact_count > 0 && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                                    {ai.hail_impact_count} Hail
                                  </span>
                                )}
                                {ai?.wind_damage_count > 0 && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 font-medium">
                                    {ai.wind_damage_count} Wind
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {photos_all.length === 0 && (
          <div className="bg-white rounded-xl border shadow-sm p-10 text-center text-slate-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No photos have been added to this report yet.</p>
          </div>
        )}

        {/* ── Download ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900">Download Full Report (PDF)</h3>
            <p className="text-sm text-slate-500 mt-0.5">Complete Damage Evidence Report with all photos, AI analysis, and findings.</p>
            {pdfError && <p className="text-sm text-red-600 mt-1">{pdfError}</p>}
          </div>
          <button
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity disabled:opacity-60 whitespace-nowrap"
            style={{ backgroundColor: primaryColor }}
            onClick={downloadPdf}
            disabled={pdfLoading}
            data-testid="button-download-full-package"
          >
            {pdfLoading
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
              : <><Download className="w-4 h-4" /> Download PDF</>
            }
          </button>
        </div>

        {/* ── Footer ────────────────────────────────────────────────── */}
        <div className="text-center text-xs text-slate-400 py-4 space-y-1">
          {company?.company_name && <p className="font-medium text-slate-500">{company.company_name}</p>}
          <p>Damage Evidence Report — prepared for insurance claim documentation</p>
          {reportDate && <p>{reportDate}</p>}
        </div>
      </div>

      {/* ── Lightbox ─────────────────────────────────────────────────── */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/92 z-50 flex items-center justify-center"
          onClick={closeLightbox}
        >
          <button
            className="absolute top-4 right-4 text-white bg-white/20 rounded-full p-2 hover:bg-white/30"
            onClick={closeLightbox}
            data-testid="button-close-lightbox"
          >
            <X className="w-5 h-5" />
          </button>
          {lightboxIdx > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white bg-white/20 rounded-full p-2 hover:bg-white/30"
              onClick={e => { e.stopPropagation(); prevPhoto(); }}
              data-testid="button-prev-photo"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          {lightboxIdx < lightbox.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white bg-white/20 rounded-full p-2 hover:bg-white/30"
              onClick={e => { e.stopPropagation(); nextPhoto(); }}
              data-testid="button-next-photo"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
          <div className="max-w-4xl max-h-[90vh] w-full px-16" onClick={e => e.stopPropagation()}>
            <img
              src={lightbox[lightboxIdx]?.annotated_url || lightbox[lightboxIdx]?.file_url}
              alt="inspection photo"
              className="w-full object-contain rounded-lg"
              style={{ maxHeight: '78vh' }}
              onError={e => { e.currentTarget.src = ''; }}
            />
            {lightbox[lightboxIdx]?.caption && (
              <p className="text-white/80 text-sm text-center mt-2">{lightbox[lightboxIdx].caption}</p>
            )}
            {lightbox[lightboxIdx]?.ai_analysis?.damage_description && (
              <div className="mt-2 bg-white/10 rounded-lg p-3">
                <p className="text-white text-sm leading-relaxed">{lightbox[lightboxIdx].ai_analysis.damage_description}</p>
              </div>
            )}
            <div className="text-center text-white/50 text-xs mt-2">{lightboxIdx + 1} / {lightbox.length}</div>
          </div>
        </div>
      )}
    </div>
  );
}
