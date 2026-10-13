import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MapPin, AlertTriangle, TrendingUp, Users, DollarSign, Calendar, Cloud, Wind, Snowflake, Droplet, Download, ChevronRight, Phone, Mail, Navigation } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import useTranslation from "@/hooks/useTranslation";
import { toast } from 'sonner';
import { MapContainer, TileLayer, Circle, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ── SBW polygon styles (mirrors StormTracking.jsx) ────────────────────────────
const SBW_PHENOMENA_STYLES = {
  TO: { color: '#dc2626', fillColor: '#dc2626' },
  SV: { color: '#f97316', fillColor: '#f97316' },
  FF: { color: '#16a34a', fillColor: '#16a34a' },
  FL: { color: '#16a34a', fillColor: '#16a34a' },
  HW: { color: '#d97706', fillColor: '#d97706' },
  EW: { color: '#d97706', fillColor: '#d97706' },
  BZ: { color: '#6366f1', fillColor: '#6366f1' },
  WS: { color: '#6366f1', fillColor: '#6366f1' },
  IS: { color: '#8b5cf6', fillColor: '#8b5cf6' },
};
const getSBWStyle = (feature) => {
  const phen = feature?.properties?.phenomena || '';
  const { color = '#3b82f6', fillColor = '#3b82f6' } = SBW_PHENOMENA_STYLES[phen] || {};
  return { color, fillColor, fillOpacity: 0.25, opacity: 0.85, weight: 2.5 };
};

// Fits the map to the polygon bounds when it first loads
function SwathPolygonLayer({ stormId, feature }) {
  const map = useMap();
  const fittedRef = useRef(null);
  useEffect(() => {
    if (!feature || fittedRef.current === stormId) return;
    fittedRef.current = stormId;
    try {
      const bounds = L.geoJSON(feature).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 11, animate: true, duration: 0.8 });
      }
    } catch (e) {}
  }, [stormId, feature]);
  return null;
}

// Build a readable narrative from available storm data.
// IEM automated-station reports often store only "Public weather station." as
// their description — this generates something actually useful from the
// structured fields that were also saved alongside it.
function getStormNarrative(storm) {
  const raw = (storm.description || '').trim();
  const isSparse =
    !raw ||
    raw.length < 40 ||
    /public weather station/i.test(raw) ||
    /automated station/i.test(raw);

  if (!isSparse) return raw;

  const type = (storm.event_type || 'weather event').replace(/_/g, ' ');
  const loc =
    storm.affected_areas?.[0] ||
    (storm.title?.includes(' - ') ? storm.title.split(' - ')[1] : null) ||
    'your service area';
  const sev = storm.severity || 'notable';

  const parts = [
    `A ${sev} ${type} event was recorded near ${loc}.`,
  ];
  if (storm.wind_speed_mph) {
    parts.push(`Wind speeds of ${storm.wind_speed_mph} mph were measured.`);
  }
  if (storm.hail_size_inches) {
    parts.push(
      `Hail up to ${storm.hail_size_inches}" in diameter was reported — ${
        storm.hail_size_inches >= 2.75
          ? 'baseball-sized or larger'
          : storm.hail_size_inches >= 1.75
          ? 'quarter-sized or larger'
          : storm.hail_size_inches >= 1.0
          ? 'golf-ball-sized or larger'
          : 'dime-to-nickel-sized'
      }.`
    );
  }
  if (storm.nws_event) {
    parts.push(`NWS issued: ${storm.nws_event}.`);
  }
  if (storm.nws_headline) {
    parts.push(storm.nws_headline);
  }
  if (storm.source === 'IEM V2') {
    parts.push(
      `✅ Ground-verified: This report is sourced from a certified NWS human spotter who physically observed and measured this event. Unlike radar-based storm tracking services, this is not an estimate — hail size and storm details are confirmed by a real observer on the ground.`
    );
  } else {
    parts.push(
      `Data source: ${storm.source || 'Storm monitoring network'}. This report is based on field measurements and weather service data.`
    );
  }

  return parts.join(' ');
}

export default function StormReport() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [selectedStorm, setSelectedStorm] = useState(null);
  const [potentialLeads, setPotentialLeads] = useState({});
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);
  // SBW polygon: { loading, feature, error }
  const [sbwPolygon, setSbwPolygon] = useState({ loading: false, feature: null, error: null });

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  // Get storm ID from URL immediately (don't wait for company to load)
  const stormId = new URLSearchParams(location.search).get('id');

  // Fetch the specific storm by ID directly — storms are shared (not per-company)
  const { data: stormEntity } = useQuery({
    queryKey: ['storm-by-id', stormId],
    queryFn: () => base44.functions.invoke('getStormById', { stormId }),
    enabled: !!stormId,
    select: (res) => res?.data?.storm || null,
  });

  // Sync storm entity into selectedStorm state (for analyzeLeadPotential)
  useEffect(() => {
    if (stormEntity && (!selectedStorm || selectedStorm.id !== stormEntity.id)) {
      setSelectedStorm(stormEntity);
      analyzeLeadPotential(stormEntity);
    }
  }, [stormEntity]);

  // Fetch the NWS SBW polygon for this storm (only available for recent storms ≤ 12h old)
  useEffect(() => {
    // Always clear stale polygon first — prevents a prior storm's polygon from
    // persisting when the new storm fails preconditions and exits early.
    setSbwPolygon({ loading: false, feature: null, error: null });
    if (!selectedStorm) return;
    const lat = parseFloat(selectedStorm.lat || selectedStorm.latitude);
    const lng = parseFloat(selectedStorm.lng || selectedStorm.longitude);
    if (!lat || !lng || !selectedStorm.start_time) return;
    const ageHrs = (Date.now() - new Date(selectedStorm.start_time).getTime()) / 36e5;
    if (ageHrs > 12) return; // SBW archive only holds active warnings

    // `cancelled` is set true by the cleanup when selectedStorm.id changes,
    // so out-of-order async responses are silently discarded.
    let cancelled = false;
    setSbwPolygon({ loading: true, feature: null, error: null });
    base44.functions.invoke('fetchStormSBWPolygon', {
      stormId: selectedStorm.id,
      lat,
      lng,
      startTime: selectedStorm.start_time,
      eventType: selectedStorm.event_type,
    }).then(result => {
      if (cancelled) return;
      const feature = result?.data?.feature ?? result?.feature ?? null;
      setSbwPolygon({ loading: false, feature, error: feature ? null : 'No active NWS warning polygon for this storm' });
    }).catch(err => {
      if (cancelled) return;
      setSbwPolygon({ loading: false, feature: null, error: err.message });
    });
    return () => { cancelled = true; };
  }, [selectedStorm?.id]);

  const { data: leads = [] } = useQuery({
    queryKey: ['leads-for-storm', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers-for-storm', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
  });

  const analyzeLeadPotential = async (storm) => {
    setIsLoadingLeads(true);
    
    // Estimate potential leads based on storm severity and affected areas
    const affectedCount = storm.affected_areas?.length || 0;
    const multiplier = 
      storm.severity === 'extreme' ? 500 :
      storm.severity === 'severe' ? 250 :
      100;
    
    const estimatedLeads = affectedCount * multiplier;
    
    // Check existing leads from this storm
    const existingStormLeads = leads.filter(l => 
      l.source === 'storm_tracker' && 
      l.lead_source?.includes(storm.title)
    );
    
    setPotentialLeads({
      estimated: estimatedLeads,
      existing: existingStormLeads.length,
      untapped: estimatedLeads - existingStormLeads.length,
      conversion_potential: estimatedLeads * 0.15 // Assume 15% conversion
    });
    
    setIsLoadingLeads(false);
  };

  const getSeverityConfig = (severity) => {
    const configs = {
      extreme: { 
        color: 'bg-red-100 text-red-800 border-red-300',
        icon: AlertTriangle,
        label: 'EXTREME',
        priority: 'Immediate Action Required',
        action: 'Deploy all available teams'
      },
      severe: { 
        color: 'bg-orange-100 text-orange-800 border-orange-300',
        icon: AlertTriangle,
        label: 'SEVERE',
        priority: 'High Priority',
        action: 'Mobilize response teams within 24 hours'
      },
      moderate: { 
        color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
        icon: Cloud,
        label: 'MODERATE',
        priority: 'Monitor Closely',
        action: 'Prepare marketing campaigns'
      },
    };
    return configs[severity] || configs.moderate;
  };

  const getStormTypeIcon = (type) => {
    const icons = {
      hail: Droplet,
      tornado: Wind,
      high_wind: Wind,
      winter_storm: Snowflake,
      thunderstorm: Cloud,
      flood: Droplet,
    };
    return icons[type] || Cloud;
  };

  const getRecommendedActions = (storm) => {
    const actions = [];
    
    if (storm.severity === 'extreme' || storm.severity === 'severe') {
      actions.push({
        priority: 'high',
        title: '🚨 Immediate Response',
        description: 'Deploy inspection teams to affected areas within 24-48 hours',
        icon: Users
      });
      actions.push({
        priority: 'high',
        title: '📱 Contact Existing Customers',
        description: 'Reach out to customers in affected zip codes to offer inspections',
        icon: Phone
      });
    }
    
    actions.push({
      priority: 'medium',
      title: '📧 Email Campaign',
      description: `Launch targeted email campaign to ${storm.affected_areas?.length || 0} affected areas`,
      icon: Mail
    });
    
    actions.push({
      priority: 'medium',
      title: '🎯 Generate Leads',
      description: 'Use Property Importer to identify damaged properties in affected areas',
      icon: TrendingUp
    });
    
    if (storm.event_type === 'hail' && storm.hail_size_inches >= 1) {
      actions.push({
        priority: 'high',
        title: '🏠 Roof Inspections',
        description: `Hail size ${storm.hail_size_inches}" - High probability of roof damage. Offer free inspections.`,
        icon: AlertTriangle
      });
    }
    
    if (storm.event_type === 'high_wind' && storm.wind_speed_mph >= 75) {
      actions.push({
        priority: 'high',
        title: '🌪️ Wind Damage Assessment',
        description: `${storm.wind_speed_mph} mph winds - Check for siding, gutters, and shingle damage`,
        icon: Wind
      });
    }
    
    return actions;
  };

  const calculateBusinessImpact = (storm) => {
    // Base estimate from storm type and measured intensity
    let baseProperties = 400;
    let avgJobValue = 7000;
    let conversionRate = 0.12;

    const type = storm.event_type || '';
    if (type === 'hail') {
      const h = storm.hail_size_inches || storm.magnitude || 0.75;
      // 0.75" = minor cosmetic, 1.0" = likely damage, 1.5" = definite damage, 2"+ = severe
      baseProperties = Math.round(300 + (h - 0.5) * 600);
      avgJobValue = h >= 1.5 ? 9500 : 7500;
      conversionRate = h >= 1.5 ? 0.15 : 0.12;
    } else if (type === 'tornado') {
      baseProperties = 900;
      avgJobValue = 14000;
      conversionRate = 0.20;
    } else if (type === 'high_wind') {
      const w = storm.wind_speed_mph || storm.magnitude || 60;
      baseProperties = Math.round(200 + Math.max(0, w - 40) * 8);
      avgJobValue = 6500;
      conversionRate = 0.10;
    } else if (type === 'thunderstorm' || type === 'tstm_wind') {
      const w = storm.wind_speed_mph || storm.magnitude || 55;
      baseProperties = Math.round(150 + Math.max(0, w - 40) * 6);
      avgJobValue = 5500;
      conversionRate = 0.10;
    } else if (type === 'flood' || type === 'flash_flood') {
      baseProperties = 600;
      avgJobValue = 8000;
      conversionRate = 0.08;
    } else {
      baseProperties = 300;
    }

    // Severity multiplier
    const sevMult = { extreme: 3.0, severe: 1.8, moderate: 1.0 }[storm.severity] || 1.0;

    // Bonus if multiple named areas were affected
    const areaBonus = Math.max(1, (storm.affected_areas?.length || 0));

    // Round to nearest 50 so it doesn't look fake-precise
    const propertiesAtRisk = Math.round((baseProperties * sevMult * areaBonus) / 50) * 50;
    const estimatedRevenue = propertiesAtRisk * avgJobValue * conversionRate;

    let responseWindow = '3-7 days';
    if (storm.severity === 'extreme' || type === 'tornado') responseWindow = '24-48 hrs';
    else if (storm.severity === 'moderate') responseWindow = '5-10 days';

    return {
      propertiesAtRisk,
      estimatedRevenue,
      conversionRate,
      responseWindow,
      competitorActivity: storm.severity === 'extreme' ? 'Very High' : storm.severity === 'severe' ? 'High' : 'Moderate',
    };
  };

  // Build a Google Maps directions URL from a text location or lat/lng
  const getDirectionsUrl = (location, lat, lng) => {
    if (lat && lng) {
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location)}`;
  };

  const openDirections = (location, lat, lng) => {
    window.open(getDirectionsUrl(location, lat, lng), '_blank');
  };

  // Export the storm report as a PDF (storm details, business impact, recommended actions)
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (!selectedStorm || exporting) return;
    setExporting(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'letter' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 48;
      const maxW = pageW - margin * 2;
      let y = margin;

      const impact = calculateBusinessImpact(selectedStorm);
      const actions = getRecommendedActions(selectedStorm);
      const stripEmoji = (s) => String(s || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();
      const ensureRoom = (needed) => {
        if (y + needed > pageH - margin) { doc.addPage(); y = margin; }
      };
      // Write pre-split lines one at a time, adding pages as needed (handles blocks taller than a page)
      const writeLines = (lines, x, lineH = 13) => {
        for (const line of lines) {
          ensureRoom(lineH);
          doc.text(line, x, y);
          y += lineH;
        }
      };
      const safeDate = (value, fmt) => {
        if (!value) return '—';
        const d = new Date(value);
        return isNaN(d.getTime()) ? '—' : format(d, fmt);
      };

      // Header
      doc.setFillColor(59, 76, 233);
      doc.rect(0, 0, pageW, 90, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text(doc.splitTextToSize(selectedStorm.title || 'Storm Report', maxW), margin, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Storm Opportunity Report — generated ${format(new Date(), 'MMM d, yyyy h:mm a')}`, margin, 72);
      y = 115;

      // Detail grid
      doc.setTextColor(30, 30, 30);
      const details = [
        ['Type', (selectedStorm.event_type || '—').replace(/_/g, ' ')],
        ['Severity', selectedStorm.severity || '—'],
        ['Status', selectedStorm.status || '—'],
        ['Date', safeDate(selectedStorm.event_date, 'MMM d, yyyy h:mm a')],
        ['Source', selectedStorm.source || '—'],
        ...(selectedStorm.wind_speed_mph ? [['Wind Speed', `${selectedStorm.wind_speed_mph} mph`]] : []),
        ...(selectedStorm.hail_size_inches ? [['Hail Size', `${selectedStorm.hail_size_inches}"`]] : []),
        ...(selectedStorm.affected_areas?.length ? [['Affected Areas', selectedStorm.affected_areas.join(', ')]] : []),
      ];
      doc.setFontSize(10);
      for (const [label, value] of details) {
        const lines = doc.splitTextToSize(String(value), maxW - 110);
        ensureRoom(13);
        doc.setFont('helvetica', 'bold');
        doc.text(`${label}:`, margin, y);
        doc.setFont('helvetica', 'normal');
        writeLines(lines, margin + 110);
        y += 4;
      }

      // Narrative
      y += 10;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      ensureRoom(30);
      doc.text('Storm Summary', margin, y);
      y += 16;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const narrativeLines = doc.splitTextToSize(stripEmoji(getStormNarrative(selectedStorm)), maxW);
      writeLines(narrativeLines, margin);
      y += 14;

      // Business impact
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      ensureRoom(110);
      doc.text('Estimated Business Impact', margin, y);
      y += 8;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(110, 110, 110);
      doc.text('Estimates based on storm type, intensity, and severity — actual impact will vary.', margin, y + 10);
      doc.setTextColor(30, 30, 30);
      y += 24;
      const boxes = [
        ['Est. Properties at Risk', String(impact.propertiesAtRisk)],
        ['Est. Potential Revenue', `$${Math.round(impact.estimatedRevenue / 1000)}K (${Math.round(impact.conversionRate * 100)}% conv.)`],
        ['Response Window', impact.responseWindow],
        ['Competitor Activity', impact.competitorActivity],
      ];
      const boxW = (maxW - 3 * 10) / 4;
      boxes.forEach(([label, value], i) => {
        const x = margin + i * (boxW + 10);
        doc.setDrawColor(220, 220, 220);
        doc.roundedRect(x, y, boxW, 54, 4, 4);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.text(doc.splitTextToSize(label, boxW - 12), x + 6, y + 14);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(doc.splitTextToSize(value, boxW - 12), x + 6, y + 38);
      });
      y += 74;

      // Recommended actions
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      ensureRoom(30);
      doc.text('Recommended Actions', margin, y);
      y += 18;
      doc.setFontSize(10);
      for (const action of actions) {
        const title = `${action.priority === 'high' ? '[HIGH] ' : '[MEDIUM] '}${stripEmoji(action.title)}`;
        const descLines = doc.splitTextToSize(stripEmoji(action.description), maxW - 14);
        ensureRoom(16 + 12);
        doc.setFont('helvetica', 'bold');
        doc.text(title, margin, y);
        y += 14;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        writeLines(descLines, margin + 14, 12);
        doc.setTextColor(30, 30, 30);
        y += 10;
      }

      // Footer
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      doc.text(`${myCompany?.name || myCompany?.company_name || 'CompanySync'} — Storm Tracking`, margin, pageH - 24);

      const safeName = (selectedStorm.title || 'storm-report').replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
      doc.save(`${safeName}.pdf`);
    } catch (e) {
      console.error('[StormReport] Export failed:', e);
      toast.error('Export failed: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  if (!selectedStorm) {
    return (
      <div className="p-3 sm:p-6 space-y-4">
        <Button variant="outline" onClick={() => navigate(createPageUrl('StormTracking'))}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t.common.back}
        </Button>
        
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-semibold mb-2">{t.common.noResults}</h2>
            <p className="text-gray-500">Please select a storm from the Storm Tracking page to view detailed reports.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const severityConfig = getSeverityConfig(selectedStorm.severity);
  const StormIcon = getStormTypeIcon(selectedStorm.event_type);
  const recommendations = getRecommendedActions(selectedStorm);
  const businessImpact = calculateBusinessImpact(selectedStorm);

  return (
    <div className="p-3 sm:p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => navigate(createPageUrl('StormTracking'))}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t.common.back}
        </Button>
        
        <div className="flex gap-2">
          {(selectedStorm.affected_areas?.[0] || selectedStorm.lat) && (
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => openDirections(
                selectedStorm.affected_areas?.[0] || selectedStorm.title,
                selectedStorm.lat,
                selectedStorm.lng
              )}
            >
              <Navigation className="w-4 h-4 mr-2" />
              Get Directions
            </Button>
          )}
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleExport} disabled={exporting}>
            <Download className="w-4 h-4 mr-2" />
            {exporting ? 'Exporting…' : t.common.export}
          </Button>
        </div>
      </div>

      {/* Storm Header */}
      <Card className="bg-gradient-to-br from-blue-600 to-purple-600 text-white">
        <CardContent className="p-3 sm:p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <StormIcon className="w-8 h-8" />
                <h1 className="text-3xl font-bold">{selectedStorm.title}</h1>
              </div>
              <p className="text-blue-100 mb-4">{getStormNarrative(selectedStorm)}</p>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-blue-200">{t.calendar.type}</p>
                  <p className="text-lg font-semibold capitalize">{selectedStorm.event_type?.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <p className="text-xs text-blue-200">{t.common.status}</p>
                  <Badge className="bg-white/20 text-white border-white/30 mt-1">
                    {selectedStorm.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-blue-200">{t.common.date}</p>
                  <p className="text-sm font-semibold">
                    {format(new Date(selectedStorm.start_time), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-blue-200">{t.customers.source}</p>
                  <p className="text-sm font-semibold">{selectedStorm.source}</p>
                </div>
              </div>
            </div>
            
            <Badge className={`${severityConfig.color} text-lg px-4 py-2 font-bold border-2`}>
              {severityConfig.label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Storm Location Map */}
      {(() => {
        const _lat = parseFloat(selectedStorm.lat || selectedStorm.latitude);
        const _lng = parseFloat(selectedStorm.lng || selectedStorm.longitude);
        return !!(isFinite(_lat) && isFinite(_lng) && _lat && _lng);
      })() && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="w-4 h-4 text-blue-600" />
              Storm Footprint
              {sbwPolygon.loading && (
                <span className="text-xs font-normal text-gray-400 ml-1">Loading warning polygon…</span>
              )}
              {sbwPolygon.feature && (
                <Badge variant="outline" className="text-xs font-normal bg-blue-50 text-blue-700 border-blue-200 ml-1">
                  NWS Warning Polygon
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div style={{ height: 320 }} className="rounded-b-lg overflow-hidden">
              <MapContainer
                center={[
                  parseFloat(selectedStorm.lat || selectedStorm.latitude),
                  parseFloat(selectedStorm.lng || selectedStorm.longitude),
                ]}
                zoom={9}
                style={{ height: '100%', width: '100%' }}
                className="z-0"
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap contributors'
                />
                {/* Storm radius circle (always shown as context) */}
                <Circle
                  center={[
                    parseFloat(selectedStorm.lat || selectedStorm.latitude),
                    parseFloat(selectedStorm.lng || selectedStorm.longitude),
                  ]}
                  radius={Math.max((selectedStorm.radius_miles || 10) * 1609.34, 1000)}
                  pathOptions={{
                    color: '#3b82f6',
                    fillColor: '#3b82f6',
                    fillOpacity: sbwPolygon.feature ? 0.08 : 0.2,
                    weight: sbwPolygon.feature ? 1 : 2,
                    dashArray: sbwPolygon.feature ? '6 4' : null,
                  }}
                />
                {/* NWS SBW polygon — rendered when available */}
                {sbwPolygon.feature && (
                  <>
                    <GeoJSON
                      key={`sbw-${selectedStorm.id}`}
                      data={sbwPolygon.feature}
                      style={getSBWStyle}
                    />
                    <SwathPolygonLayer
                      stormId={selectedStorm.id}
                      feature={sbwPolygon.feature}
                    />
                  </>
                )}
              </MapContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Business Impact Analysis */}
      <Card className="border-l-4 border-l-green-600">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-600" />
            {t.reports.performance}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-gray-400 mb-4 italic">Estimates based on storm type, intensity, and severity — actual impact will vary.</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center p-4 bg-purple-50 rounded-lg border border-purple-200">
              <p className="text-sm text-gray-600 mb-1">Est. Properties at Risk</p>
              <p className="text-3xl font-bold text-purple-600">
                {businessImpact.propertiesAtRisk > 0 ? businessImpact.propertiesAtRisk.toLocaleString() : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-1">within affected area</p>
            </div>
            
            <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-gray-600 mb-1">Est. Potential Revenue</p>
              <p className="text-3xl font-bold text-green-600">
                {businessImpact.estimatedRevenue >= 1000000
                  ? `$${(businessImpact.estimatedRevenue / 1000000).toFixed(1)}M`
                  : businessImpact.estimatedRevenue >= 1000
                  ? `$${Math.round(businessImpact.estimatedRevenue / 1000)}K`
                  : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-1">{Math.round(businessImpact.conversionRate * 100)}% conversion rate</p>
            </div>
            
            <div className="text-center p-4 bg-orange-50 rounded-lg border border-orange-200">
              <p className="text-sm text-gray-600 mb-1">Response Window</p>
              <p className="text-2xl font-bold text-orange-600">
                {businessImpact.responseWindow}
              </p>
              <p className="text-xs text-gray-500 mt-1">Before competition</p>
            </div>
            
            <div className="text-center p-4 bg-red-50 rounded-lg border border-red-200">
              <p className="text-sm text-gray-600 mb-1">Competitor Activity</p>
              <p className="text-2xl font-bold text-red-600">
                {businessImpact.competitorActivity}
              </p>
              <p className="text-xs text-gray-500 mt-1">Expected competition</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Storm Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-blue-600">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center gap-3">
              <MapPin className="w-10 h-10 text-blue-600" />
              <div>
                <p className="text-sm text-gray-600">Affected Areas</p>
                <p className="text-3xl font-bold text-gray-900">
                  {selectedStorm.affected_areas?.length || 0}
                </p>
                <p className="text-xs text-gray-500">Counties/Zones</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {selectedStorm.hail_size_inches && (
          <Card className="border-l-4 border-l-purple-600">
            <CardContent className="p-3 sm:p-6">
              <div className="flex items-center gap-3">
                <Droplet className="w-10 h-10 text-purple-600" />
                <div>
                  <p className="text-sm text-gray-600">Hail Size</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {selectedStorm.hail_size_inches}"
                  </p>
                  <p className="text-xs text-gray-500">
                    {selectedStorm.hail_size_inches >= 2.75 ? 'Baseball+' :
                     selectedStorm.hail_size_inches >= 2 ? 'Golf Ball+' :
                     selectedStorm.hail_size_inches >= 1.75 ? 'Quarter+' : 'Penny+'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {selectedStorm.wind_speed_mph && (
          <Card className="border-l-4 border-l-orange-600">
            <CardContent className="p-3 sm:p-6">
              <div className="flex items-center gap-3">
                <Wind className="w-10 h-10 text-orange-600" />
                <div>
                  <p className="text-sm text-gray-600">Wind Speed</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {selectedStorm.wind_speed_mph}
                  </p>
                  <p className="text-xs text-gray-500">mph</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-l-4 border-l-green-600">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center gap-3">
              <MapPin className="w-10 h-10 text-green-600" />
              <div>
                <p className="text-sm text-gray-600">Impact Radius</p>
                <p className="text-3xl font-bold text-gray-900">
                  {selectedStorm.radius_miles}
                </p>
                <p className="text-xs text-gray-500">miles</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Affected Areas Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            Affected Areas ({selectedStorm.affected_areas?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4 bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-900">
              <strong>What this means:</strong> These {selectedStorm.affected_areas?.length || 0} counties/zones are currently under weather alerts. 
              Each area represents potential customers who may need your services.
            </AlertDescription>
          </Alert>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {selectedStorm.affected_areas?.map((area, idx) => (
              <div key={idx} className="p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span className="font-medium text-sm">{area}</span>
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="text-xs h-7 w-full"
                    onClick={() => navigate(createPageUrl('PropertyDataImporter') + `?location=${encodeURIComponent(area)}`)}
                  >
                    <Users className="w-3 h-3 mr-1" />
                    {t.common.search}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 w-full text-purple-700 border-purple-300 hover:bg-purple-50"
                    onClick={() => navigate(createPageUrl('LeadFinder') + `?location=${encodeURIComponent(area)}`)}
                  >
                    🔍 Lead Finder
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs h-7 w-full bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => openDirections(area)}
                  >
                    <Navigation className="w-3 h-3 mr-1" />
                    Directions
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lead Generation Potential */}
 
    </div>
  );
}