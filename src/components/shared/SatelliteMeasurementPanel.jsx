import { useState } from "react";
  import { Button } from "@/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { Badge } from "@/components/ui/badge";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
  import {
    Loader2, Sparkles, MapPin, Satellite, Pencil, Plus, ArrowLeft, Edit,
    Camera, AlertTriangle, Brain, Info, Ruler, RefreshCw, Wind, BarChart3, X, Target,
    BookOpen, ChevronDown, ChevronUp, CheckCircle2, Trash2, Upload
  } from "lucide-react";
  import { GoogleAddressAutocomplete } from "../GoogleAddressAutocomplete";
  import StructureSelector from "../satellite/StructureSelector";
  import InteractiveRoofMap from "../satellite/InteractiveRoofMap";
  import StreetViewPanel from "../satellite/StreetViewPanel";
  import { getPitchMultiplier } from "@/lib/satelliteUtils";

  export default function SatelliteMeasurementPanel({ ctx }) {
    const {
      satelliteAddress, setSatelliteAddress,
      googleMapsLoaded, googleMapsError,
      isSatelliteAnalyzing, setIsSatelliteAnalyzing,
      satelliteAnalysis, setSatelliteAnalysis,
      analyzedStructures, setAnalyzedStructures,
      showStructureSelector, setShowStructureSelector,
      isAddingStructure, setIsAddingStructure,
      addingStructureType, setAddingStructureType,
      useManualDrawing, setUseManualDrawing,
      manualAddOnMode, setManualAddOnMode,
      manualMeasurements, setManualMeasurements,
      garageDimL, setGarageDimL,
      garageDimW, setGarageDimW,
      garagePitch, setGaragePitch,
      elevationPanelOpen, setElevationPanelOpen,
      elevationImages, setElevationImages,
      isLoadingElevation, setIsLoadingElevation,
      refinedPitchData, setRefinedPitchData,
      isRefiningPitch, setIsRefiningPitch,
      roofTypeSelection, setRoofTypeSelection,
      includeGuttersAI, setIncludeGuttersAI,
      aiGutterLF, setAiGutterLF,
      aiDownspoutCount, setAiDownspoutCount,
      currentEstimate, setCurrentEstimate,
      lineItems, setLineItems,
      isDetectingNearby,
      housePhotos, setHousePhotos,
      uploadingSlot,
      isAnalyzingPhotos,
      photoSidingAnalysis, setPhotoSidingAnalysis,
      sidingMeasurements,
      reportMeasurements,
      isSavingCalibration, setIsSavingCalibration,
      calibrationResult, setCalibrationResult,
      estimateHistory, setEstimateHistory,
      config, setConfig,
      customerInfo,
      messages, setMessages,
      measurementAPI, setMeasurementAPI,
      excludedStructureIds, setExcludedStructureIds,
      showPhotoSiding, setShowPhotoSiding,
      structureType, setStructureType,
      useSatelliteMode, setUseSatelliteMode,
      wasteSuggestion, setWasteSuggestion,
      isSidingAnalyzing,
      linkedJobMedia,
      handleSatelliteAddressSelect,
      handleAIAutoDetect,
      handleDetectNearbyStructures,
      handleRegenerateWithGutters,
      handleGenerateCombinedEstimate,
      handleAnalyzePhotos,
      handleSlotPhotoSelect,
      handleAnalyzeSiding,
      convertSidingMeasurementsToLineItems,
      base44, t, user, myCompany,
    } = ctx;

    const [calibrations, setCalibrations] = useState([]);
    const [showCalPanel, setShowCalPanel] = useState(false);
    const [savingCal, setSavingCal] = useState(false);
    const [calConfirmedSqft, setCalConfirmedSqft] = useState('');
    const [calSource, setCalSource] = useState('EagleView');
    const [calFileUploading, setCalFileUploading] = useState(false);
    const [avgCorrFactor, setAvgCorrFactor] = useState(null);

    const loadCalibrations = async () => {
      if (!myCompany?.id) return;
      try {
        const result = await base44.functions.invoke('getCompanyCalibrations', { companyId: myCompany.id, measurementType: 'siding' });
        const d = result?.data || result;
        setCalibrations(d.calibrations || []);
        setAvgCorrFactor(d.avgCorrectionFactor && Math.abs(d.avgCorrectionFactor - 1) > 0.005 ? d.avgCorrectionFactor : null);
      } catch (e) {
        console.error('Failed to load calibrations:', e);
      }
    };

    return (
      <div className="space-y-6">
      <Card className="bg-white shadow-lg">
        <CardHeader className="bg-gradient-to-r from-green-600 to-blue-600 text-white">
          <CardTitle className="flex items-center gap-2">
            <Satellite className="w-5 h-5" />
            AI Satellite Measurement
          </CardTitle>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {!googleMapsLoaded && !googleMapsError && (
            <div className="text-center py-12">
              <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900">Loading Google Maps...</p>
              <p className="text-sm text-gray-500">Please wait</p>
            </div>
          )}

          {googleMapsError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <p className="text-red-800 font-semibold mb-2">⚠️ {googleMapsError}</p>
              <Button onClick={() => window.location.reload()} variant="outline">
                Refresh Page
              </Button>
            </div>
          )}

          {googleMapsLoaded && (!satelliteAddress || showStructureSelector || isAddingStructure) && (
            <div>
              <Label className="text-lg font-semibold mb-3 block">
                <MapPin className="w-5 h-5 inline mr-2" />
                {analyzedStructures.length === 0 ? 'Enter Property Address' : 'Add Another Structure'}
              </Label>

              {/* NEW: Display analyzed structures */}
              {analyzedStructures.length > 0 && (
                <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="font-semibold text-blue-900 mb-2 flex items-center justify-between">
                    <span>✅ Analyzed Structures:</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm(`Clear all ${analyzedStructures.length} structures and start over?`)) {
                          setAnalyzedStructures([]);
                          setLineItems([]);
                          setCurrentEstimate(null);
                          setSatelliteAnalysis(null);
                          setIncludeGuttersAI(false);
                          setAiGutterLF(0);
                          setAiDownspoutCount(0);
                          setEstimateHistory([]);
                          setManualMeasurements([]);
                          setManualAddOnMode(false);
                          setSatelliteAddress(null);
                        }
                      }}
                      className="h-7 text-xs"
                    >
                      Clear All
                    </Button>
                  </p>
                  {analyzedStructures.map((structure, idx) => {
                    const isExcluded = excludedStructureIds.has(structure.id);
                    const typeIcon = structure.structureType === 'garage' ? '🏗️' : structure.structureType === 'shed' ? '🏚️' : '🏠';
                    const typeBgColor = structure.structureType === 'garage' ? 'bg-orange-50 border-orange-200' : structure.structureType === 'shed' ? 'bg-amber-50 border-amber-200' : 'bg-white border-transparent';
                    return (
                      <div key={structure.id} className={`text-sm flex items-start justify-between mb-2 rounded p-2 border transition-opacity ${typeBgColor} ${isExcluded ? 'opacity-40' : ''}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-blue-800">#{idx + 1}</span>
                            <span className="text-blue-800">{typeIcon} {structure.name}:</span>
                            <Badge className={`text-xs ${structure.analysis.overall_confidence < 60 ? 'bg-red-100 text-red-800' : structure.analysis.overall_confidence < 70 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                              {Number(structure.analysis.corrected_area_sq || structure.analysis.roof_area_sq || 0).toFixed(2)} SQ
                            </Badge>
                            <Badge variant="outline" className={`text-xs ${structure.analysis.overall_confidence >= 80 ? 'border-green-300 text-green-700' : structure.analysis.overall_confidence >= 60 ? 'border-yellow-300 text-yellow-700' : 'border-red-300 text-red-700'}`}>
                              {structure.analysis.confidence_grade || ''} {structure.analysis.overall_confidence}%
                            </Badge>
                            {structure.structureType === 'garage' && (
                              <Badge className="text-xs bg-orange-100 text-orange-800 border border-orange-300">Garage</Badge>
                            )}
                            {structure.structureType === 'shed' && (
                              <Badge className="text-xs bg-amber-100 text-amber-800 border border-amber-300">Shed</Badge>
                            )}
                          </div>
                          {structure.structureType === 'garage' && (
                            <p className="text-xs text-orange-700 mt-0.5 ml-1">Siding defaults: 1-story (10ft), 10% openings, 8% waste</p>
                          )}
                          {structure.analysis.overall_confidence < 70 && (
                            <p className="text-xs text-red-600 mt-0.5 ml-1">Low accuracy — verify on-site</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                          <button
                            title={isExcluded ? 'Include in estimate' : 'Exclude from estimate'}
                            onClick={() => setExcludedStructureIds(prev => {
                              const next = new Set(prev);
                              if (next.has(structure.id)) next.delete(structure.id);
                              else next.add(structure.id);
                              return next;
                            })}
                            className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${isExcluded ? 'bg-gray-100 text-gray-500 border-gray-300' : 'bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-200'}`}
                          >
                            {isExcluded ? 'Off' : '✓ On'}
                          </button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setAnalyzedStructures(prev => {
                                const updated = prev.filter(s => s.id !== structure.id);
                                if (prev.length === 1 && updated.length === 0) {
                                  setLineItems([]);
                                  setCurrentEstimate(null);
                                  setSatelliteAnalysis(null);
                                  setIncludeGuttersAI(false);
                                  setAiGutterLF(0);
                                  setAiDownspoutCount(0);
                                  setEstimateHistory([]);
                                  setManualMeasurements([]);
                                  setManualAddOnMode(false);
                                }
                                return updated;
                              });
                              setExcludedStructureIds(prev => { const next = new Set(prev); next.delete(structure.id); return next; });
                            }}
                            className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="mt-3 pt-3 border-t border-blue-200 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-bold text-blue-900">
                        Active Total: {analyzedStructures.filter(s => !excludedStructureIds.has(s.id)).reduce((sum, s) => sum + (s.analysis.roof_area_sq || 0), 0).toFixed(2)} SQ
                      </span>
                      {excludedStructureIds.size > 0 && (
                        <p className="text-xs text-gray-500">{excludedStructureIds.size} structure{excludedStructureIds.size > 1 ? 's' : ''} excluded from estimate</p>
                      )}
                    </div>
                    {analyzedStructures.some(s => s.analysis.overall_confidence < 60) && (
                      <Badge className="bg-yellow-100 text-yellow-800">
                        ⚠️ Review Needed
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              <GoogleAddressAutocomplete
                onAddressSelect={(addr, details) => {
                  handleSatelliteAddressSelect(addr, details);
                  if (analyzedStructures.length > 0) {
                    setIsAddingStructure(true);
                  } else {
                    setIsAddingStructure(false);
                  }
                }}
                placeholder={analyzedStructures.length === 0 
                  ? "Enter property address for satellite analysis..." 
                  : "Enter address for garage, shed, or additional structure..."}
                initialAddress={satelliteAddress?.address || customerInfo.property_address || ''} // Pre-fill from satellite or customer address
              />

              <div className="mt-4 space-y-4">
                <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-200">
                  <h4 className="font-semibold flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    Measurement API:
                  </h4>
                  <Select value={measurementAPI} onValueChange={(val) => {
                    setMeasurementAPI(val);
                    localStorage.setItem('aiEstimatorMeasurementAPI', val);
                  }}>
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="google_solar">
                        <div className="flex items-center gap-2">
                          <span>🌐 Google Solar API</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="gemini_vision">
                        <div className="flex items-center gap-2">
                          <span>✨ Gemini Vision (Experimental)</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-600 mt-2">
                    {measurementAPI === 'gemini_vision' 
                      ? '✨ Uses AI vision to analyze satellite images for more accurate ridge/hip/valley detection' 
                      : '🌐 Uses Google Solar API for fast automated measurements'}
                  </p>
                </div>

                <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-200">
                  <h4 className="font-semibold flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    {t.estimates.twoWaysToMeasure}
                  </h4>
                  <div className="space-y-2 text-sm text-gray-700">
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-purple-600">1️⃣ {t.estimates.aiAutoDetect}:</span>
                      <span>Fast (30-60s) but may need manual review</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-blue-600">2️⃣ {t.estimates.manualDrawing}:</span>
                      <span>{t.estimates.manualDrawingDesc}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {satelliteAddress && !useManualDrawing && !isSatelliteAnalyzing && !satelliteAnalysis && !showStructureSelector && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg p-6 border-2 border-blue-200">
                <p className="text-lg font-semibold text-gray-900 mb-4">
                  📍 {satelliteAddress.address}
                </p>
                <p className="text-gray-700 mb-4">
                  {t.estimates.chooseMeasureMethod}
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <Button
                    onClick={handleAIAutoDetect}
                    className="h-auto py-6 flex-col bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                  >
                    <Sparkles className="w-8 h-8 mb-2" />
                    <span className="text-lg font-bold">{t.estimates.aiAutoDetect}</span>
                    <span className="text-xs mt-1 opacity-90">{t.estimates.aiAutoDetectDesc}</span>
                  </Button>
                  <Button
                    onClick={() => setUseManualDrawing(true)}
                    className="h-auto py-6 flex-col bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                  >
                    <Pencil className="w-8 h-8 mb-2" />
                    <span className="text-lg font-bold">{t.estimates.manualDrawing}</span>
                    <span className="text-xs mt-1 opacity-90">{t.estimates.manualDrawingDesc}</span>
                  </Button>
                </div>
                <div className="mt-4 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSatelliteAddress(null);
                      setUseManualDrawing(false);
                      setAnalyzedStructures([]);
                      setLineItems([]);
                      setCurrentEstimate(null);
                      setManualMeasurements([]);
                    }}
                  >
                    ← {t.estimates.chooseDifferentAddress}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {isSatelliteAnalyzing && (
            <div className="text-center py-12">
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 animate-ping opacity-30">
                  <svg className="w-16 h-16 mx-auto" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 80 L50 20 L90 80 Z" fill="currentColor" className="text-blue-600" />
                  </svg>
                </div>
                <svg className="w-16 h-16 mx-auto animate-spin" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 80 L50 20 L90 80 Z" fill="currentColor" className="text-blue-600" />
                </svg>
              </div>
              <p className="text-lg font-medium text-gray-900">AI is analyzing the roof...</p>
              <p className="text-sm text-gray-500 mt-2">This may take 30-60 seconds</p>
              <div className="mt-4 space-y-2 text-sm text-gray-600">
                <p>✓ Loading satellite imagery</p>
                <p>✓ Detecting roof features with Google Solar API</p>
                <p>✓ Calculating accurate dimensions</p>
              </div>
            </div>
          )}

          {/* SHOW MESSAGES/ERRORS IN SATELLITE MODE */}
          {!isSatelliteAnalyzing && !currentEstimate && messages.length > 0 && (
            <div className="mb-6 space-y-2">
              {messages.filter(m => m.role === 'assistant').slice(-1).map((msg, idx) => (
                <div key={idx} className={`rounded-lg p-4 ${
                  msg.content.includes('❌') ? 'bg-red-50 border border-red-200 text-red-900' :
                  msg.content.includes('⚠️') ? 'bg-yellow-50 border border-yellow-200 text-yellow-900' :
                  'bg-blue-50 border border-blue-200 text-blue-900'
                }`}>
                  <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                </div>
              ))}
            </div>
          )}

          {satelliteAddress && satelliteAnalysis && !isSatelliteAnalyzing && !useManualDrawing && !showStructureSelector && analyzedStructures.length > 0 && (
          <div className="space-y-4">
              <Card className="overflow-hidden relative">
                 <div 
                   ref={(el) => {
                     if (!el || !window.google || !satelliteAddress) return;
                     if (el.querySelector('.gmap-satellite')) return;

                     const mapDiv = document.createElement('div');
                     mapDiv.className = 'gmap-satellite';
                     mapDiv.style.width = '100%';
                     mapDiv.style.height = '400px';
                     el.appendChild(mapDiv);

                     const map = new window.google.maps.Map(mapDiv, {
                       center: satelliteAddress.coordinates,
                       zoom: 20,
                       mapTypeId: 'satellite',
                       tilt: 0,
                       heading: 0,
                       rotateControl: true,
                       tiltControl: true,
                       zoomControl: true,
                       streetViewControl: false,
                       mapTypeControl: false,
                       fullscreenControl: true,
                       gestureHandling: 'greedy',
                     });

                     new window.google.maps.Marker({
                       position: satelliteAddress.coordinates,
                       map: map,
                       title: satelliteAddress.address,
                       icon: {
                         path: window.google.maps.SymbolPath.CIRCLE,
                         scale: 10,
                         fillColor: '#ef4444',
                         fillOpacity: 0.9,
                         strokeColor: '#ffffff',
                         strokeWeight: 2,
                       }
                     });

                     el._mapInstance = map;

                     const statusDiv = el.querySelector('.heading-status');
                     map.addListener('heading_changed', () => {
                       const h = map.getHeading() || 0;
                       const dirs = ["N","NE","E","SE","S","SW","W","NW"];
                       const dir = dirs[Math.round(h / 45) % 8];
                       const tilted = map.getTilt() > 0;
                       if (statusDiv) statusDiv.textContent = tilted ? `45° · ${dir}` : `Top-down · ${dir}`;
                     });
                     map.addListener('tilt_changed', () => {
                       const h = map.getHeading() || 0;
                       const dirs = ["N","NE","E","SE","S","SW","W","NW"];
                       const dir = dirs[Math.round(h / 45) % 8];
                       const tilted = map.getTilt() > 0;
                       if (statusDiv) statusDiv.textContent = tilted ? `45° · ${dir}` : `Top-down · ${dir}`;
                       const tiltBtn = el.querySelector('.tilt-toggle-btn');
                       if (tiltBtn) tiltBtn.textContent = tilted ? '2D' : '3D';
                     });
                   }}
                   className="w-full relative"
                 />
                 <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg border border-gray-200 z-20">
                   <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                     <MapPin className="w-4 h-4 text-red-600" />
                     {satelliteAddress.address}
                   </p>
                 </div>
                 <div className="absolute top-4 right-16 bg-black/70 text-white text-xs px-2 py-1 rounded font-bold z-20">
                   <span className="heading-status">Top-down · N</span>
                 </div>
                 <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-1">
                   {[{l:"N",h:0},{l:"E",h:90},{l:"S",h:180},{l:"W",h:270}].map(d => (
                     <button key={d.l} onClick={(e) => {
                       const container = e.target.closest('[class*="overflow-hidden"]');
                       const m = container?.querySelector('.w-full')?._mapInstance;
                       if (m) { m.setHeading(d.h); m.setTilt(45); }
                     }} className="bg-indigo-600/90 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded shadow-lg" data-testid={`main-rotate-${d.l.toLowerCase()}`}>
                       {d.l}
                     </button>
                   ))}
                   <button onClick={(e) => {
                     const container = e.target.closest('[class*="overflow-hidden"]');
                     const m = container?.querySelector('.w-full')?._mapInstance;
                     if (m) m.setTilt(m.getTilt() > 0 ? 0 : 45);
                   }} className="tilt-toggle-btn bg-amber-600/90 hover:bg-amber-700 text-white text-xs font-bold px-3 py-1.5 rounded shadow-lg ml-1" data-testid="main-toggle-tilt">
                     3D
                   </button>
                   <button
                     onClick={() => {
                       setUseManualDrawing(true);
                       setSatelliteAnalysis(null);
                       setAnalyzedStructures([]);
                       setLineItems([]);
                       setCurrentEstimate(null);
                       setManualMeasurements([]);
                       setManualAddOnMode(false);
                     }}
                     className="bg-red-600/90 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded shadow-lg ml-1 flex items-center gap-1"
                     title="Switch to manual roof drawing"
                     data-testid="main-manual-draw"
                   >
                     <Target className="w-3 h-3" />
                     Manual
                   </button>
                 </div>
                 </Card>

                 {/* AI CONFIDENCE BANNER */}
              {(() => {
                const conf = satelliteAnalysis.overall_confidence || 0;
                const grade = satelliteAnalysis.confidence_grade || (conf >= 88 ? 'A' : conf >= 78 ? 'B' : conf >= 65 ? 'C' : conf >= 50 ? 'D' : 'F');
                const tolerancePct = satelliteAnalysis.tolerance_pct || (conf >= 88 ? 5 : conf >= 78 ? 8 : conf >= 65 ? 12 : conf >= 50 ? 15 : 20);
                const pitchMult = satelliteAnalysis.pitch_multiplier || getPitchMultiplier(satelliteAnalysis.pitch);
                const correctedSq = satelliteAnalysis.corrected_area_sq || Number(satelliteAnalysis.roof_area_sq) || 0;
                const areaRange = satelliteAnalysis.area_range || { low: Math.round(correctedSq * (1 - tolerancePct / 100) * 100) / 100, high: Math.round(correctedSq * (1 + tolerancePct / 100) * 100) / 100 };
                const source = satelliteAnalysis.measurement_source || 'AI Analysis';
                const confWarnings = satelliteAnalysis.confidence_warnings || [];
                const confDetails = satelliteAnalysis.confidence_details || {};

                const gradeColors = {
                  'A': { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-900', sub: 'text-green-700', badge: 'bg-green-600', bar: 'bg-green-500' },
                  'B': { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-900', sub: 'text-green-700', badge: 'bg-green-600', bar: 'bg-green-500' },
                  'C': { bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-900', sub: 'text-yellow-700', badge: 'bg-yellow-600', bar: 'bg-yellow-500' },
                  'D': { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-900', sub: 'text-orange-700', badge: 'bg-orange-600', bar: 'bg-orange-500' },
                  'F': { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-900', sub: 'text-red-700', badge: 'bg-red-600', bar: 'bg-red-500' }
                };
                const gc = gradeColors[grade] || gradeColors['C'];

                const confBarColor = (v) => v >= 80 ? 'bg-green-500' : v >= 60 ? 'bg-yellow-500' : 'bg-red-500';

                return (
                <div className={`rounded-lg p-4 border-2 ${gc.bg} ${gc.border}`}>
                <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                  <div>
                    <h3 className={`font-semibold mb-1 flex items-center gap-2 ${gc.text}`}>
                      <Sparkles className="w-5 h-5" />
                      AI Roof Estimate
                    </h3>
                    <p className={`text-sm ${gc.sub}`}>
                      <MapPin className="w-4 h-4 inline mr-1" />
                      {satelliteAddress.address}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Source: {source} {(source === 'Gemini Vision AI' || source === 'Google Solar API') && '- Verify on-site'}</p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      <div className={`text-3xl font-bold ${gc.text}`}>{grade}</div>
                      <div>
                        <Badge className={`text-sm px-2 py-0.5 ${gc.badge} text-white`}>
                          {tolerancePct}% tolerance
                        </Badge>
                        <p className="text-xs text-gray-500 mt-0.5">Estimate quality</p>
                      </div>
                    </div>
                    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${gc.bar}`} style={{ width: `${conf}%` }} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div className="bg-blue-50 rounded p-3 shadow-sm border border-blue-100">
                    <span className="text-blue-800 block mb-1 text-xs font-semibold">Roof Area:</span>
                    <span className="font-bold text-xl text-blue-700">{Number(correctedSq).toFixed(2)}</span>
                    <span className="text-xs text-blue-600 ml-1">SQ</span>
                    <p className="text-xs text-blue-600 mt-1">Pitch: {satelliteAnalysis.pitch}{satelliteAnalysis.roof_type ? ` • ${satelliteAnalysis.roof_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}` : ''}</p>
                  </div>

                  {correctedSq > 0 && (
                    <div className="bg-green-50 rounded p-3 shadow-sm border border-green-100">
                      <span className="text-green-800 block mb-1 text-xs font-bold">Order Qty:</span>
                      <span className="font-bold text-xl text-green-700">{(correctedSq * (1 + (satelliteAnalysis.waste_percentage || 12) / 100)).toFixed(2)}</span>
                      <span className="text-xs text-green-600 ml-1">SQ</span>
                      <p className="text-xs text-green-600 mt-1">+{satelliteAnalysis.waste_percentage || 12}% waste included</p>
                    </div>
                  )}

                  <div className="bg-white rounded p-3 shadow-sm">
                    <span className="text-gray-600 block mb-1 text-xs">Pitch Multiplier:</span>
                    <span className="font-semibold text-lg text-gray-800">{pitchMult.toFixed(3)}x</span>
                    <p className="text-xs text-gray-500 mt-1">Applied to satellite footprint</p>
                  </div>
                </div>

                {satelliteAnalysis.pro_tip && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-2 flex items-start gap-2" data-testid="pro-tip-banner">
                    <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-blue-800 font-semibold text-xs">Pro Tip:</span>
                      <p className="text-blue-700 text-xs mt-0.5">{satelliteAnalysis.pro_tip}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 text-sm">
                  {[
                    { label: 'Ridge', value: satelliteAnalysis.ridge_lf, conf: satelliteAnalysis.ridge_confidence, color: 'bg-purple-500' },
                    { label: 'Hip', value: satelliteAnalysis.hip_lf, conf: satelliteAnalysis.hip_confidence, color: 'bg-blue-500' },
                    { label: 'Valley', value: satelliteAnalysis.valley_lf, conf: satelliteAnalysis.valley_confidence, color: 'bg-green-500' },
                    { label: 'Rake', value: satelliteAnalysis.rake_lf, conf: satelliteAnalysis.rake_confidence, color: 'bg-orange-500' },
                    { label: 'Eave', value: satelliteAnalysis.eave_lf, conf: satelliteAnalysis.eave_confidence, color: 'bg-red-500' },
                    { label: 'Step Flash', value: satelliteAnalysis.step_flashing_lf, conf: satelliteAnalysis.step_flashing_confidence, color: 'bg-pink-500' },
                    { label: 'Apron Flash', value: satelliteAnalysis.apron_flashing_lf, conf: satelliteAnalysis.apron_flashing_confidence, color: 'bg-orange-500' },
                  ].map(m => (
                    <div key={m.label} className="bg-white rounded p-2 shadow-sm">
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className={`w-2.5 h-2.5 rounded-full ${m.color}`} />
                        <span className="text-xs text-gray-600">{m.label}</span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-sm">{Number(m.value || 0).toFixed(1)} LF</span>
                        <span className={`text-xs font-medium ${(m.conf || 0) >= 80 ? 'text-green-700' : (m.conf || 0) >= 60 ? 'text-yellow-700' : 'text-red-700'}`}>
                          {m.conf || '--'}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1 overflow-hidden">
                        <div className={`h-full rounded-full ${confBarColor(m.conf || 0)}`} style={{ width: `${m.conf || 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>


                {confDetails.geometry?.checks?.length > 0 && (
                  <div className="mt-3 bg-white rounded p-3">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Geometric Validation:</p>
                    <div className="space-y-1">
                      {confDetails.geometry.checks.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${c.status === 'pass' ? 'bg-green-500' : c.status === 'warn' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                            {c.status === 'pass' ? 'P' : c.status === 'warn' ? 'W' : 'F'}
                          </span>
                          <span className="text-gray-700">{c.check}:</span>
                          <span className="text-gray-500">{c.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {confDetails.source && (
                  <div className="mt-3 bg-white rounded p-3">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Confidence Breakdown:</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {[
                        { label: 'Source', score: confDetails.source?.score },
                        { label: 'Complexity', score: confDetails.complexity?.score },
                        { label: 'Geometry', score: confDetails.geometry?.score },
                        { label: 'Pitch', score: confDetails.pitch?.score },
                      ].filter(d => d.score != null).map(d => (
                        <div key={d.label} className="flex items-center gap-1.5">
                          <span className="text-gray-600">{d.label}:</span>
                          <span className={`font-semibold ${d.score >= 80 ? 'text-green-700' : d.score >= 60 ? 'text-yellow-700' : 'text-red-700'}`}>{d.score}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {satelliteAnalysis.analysis_notes && (
                  <div className="mt-3 bg-white rounded p-3">
                    <p className="text-xs font-semibold text-gray-700 mb-1">AI Notes:</p>
                    <p className="text-xs text-gray-600">{satelliteAnalysis.analysis_notes}</p>
                  </div>
                )}

                {satelliteAnalysis.warning_message && (
                  <div className="mt-3 bg-orange-100 rounded p-3 border border-orange-300">
                    <p className="text-sm font-semibold text-orange-900 mb-1 flex items-center gap-2">
                      <Wind className="w-4 h-4" />
                      Visibility Warning
                    </p>
                    <p className="text-sm text-orange-800">{satelliteAnalysis.warning_message}</p>
                  </div>
                )}

                {confWarnings.length > 0 && (
                  <div className="mt-3 bg-yellow-100 rounded p-3 border border-yellow-300">
                    <p className="text-sm font-semibold text-yellow-900 mb-1 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Accuracy Warnings
                    </p>
                    <ul className="text-xs text-yellow-800 space-y-1">
                      {confWarnings.map((w, i) => <li key={i}>- {w}</li>)}
                    </ul>
                  </div>
                )}

                {conf < 70 && !satelliteAnalysis.warning_message && (
                  <div className="mt-3 bg-red-50 rounded p-3 border border-red-300">
                    <p className="text-sm font-semibold text-red-900 mb-1 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Low Accuracy - Manual Verification Recommended
                    </p>
                    <p className="text-xs text-red-800">
                      Measurements may be off by up to {tolerancePct}%. Consider uploading an EagleView/HOVER report or using Manual Drawing mode.
                    </p>
                  </div>
                )}
              </div>
              );
              })()}

              {/* SIDING SATELLITE MEASUREMENTS */}
              {(config.specialty === 'siding' || sidingMeasurements) && (
                <div className="mt-3">
                  {!sidingMeasurements && (
                    <Button
                      data-testid="button-analyze-siding"
                      onClick={handleAnalyzeSiding}
                      disabled={isSidingAnalyzing}
                      className="w-full bg-teal-600 hover:bg-teal-700 text-white"
                    >
                      {isSidingAnalyzing ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Measuring Wall Areas...</>
                      ) : (
                        <><Ruler className="w-4 h-4 mr-2" />Measure Siding from Satellite</>
                      )}
                    </Button>
                  )}


                  {sidingMeasurements && (() => {
                    const sd = sidingMeasurements;
                    const grade = sd.confidence_grade || 'C';
                    const conf = sd.overall_confidence || 70;
                    const gradeColors = {
                      'A': { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-900', sub: 'text-green-700', badge: 'bg-green-600', bar: 'bg-green-500' },
                      'B': { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-900', sub: 'text-green-700', badge: 'bg-green-600', bar: 'bg-green-500' },
                      'C': { bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-900', sub: 'text-yellow-700', badge: 'bg-yellow-600', bar: 'bg-yellow-500' },
                      'D': { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-900', sub: 'text-orange-700', badge: 'bg-orange-600', bar: 'bg-orange-500' },
                      'F': { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-900', sub: 'text-red-700', badge: 'bg-red-600', bar: 'bg-red-500' }
                    };
                    const gc = gradeColors[grade] || gradeColors['C'];
                    return (
                      <div className={`rounded-lg p-4 border-2 ${gc.bg} ${gc.border}`} data-testid="panel-siding-measurements">
                        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                          <div>
                            <h3 className={`font-semibold mb-1 flex items-center gap-2 ${gc.text}`}>
                              <Ruler className="w-5 h-5" />
                              AI Siding Estimate
                            </h3>
                            <p className={`text-sm ${gc.sub}`}>
                              <MapPin className="w-4 h-4 inline mr-1" />
                              {satelliteAddress?.address}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {sd.building_length_ft}ft × {sd.building_width_ft}ft · {sd.story_count} stor{sd.story_count === 1 ? 'y' : 'ies'} · {sd.roof_type} roof
                            </p>
                          </div>
                          <div className="text-right flex flex-col items-end gap-1">
                            <div className="flex items-center gap-2">
                              <div className={`text-3xl font-bold ${gc.text}`}>{grade}</div>
                              <div>
                                <Badge className={`text-sm px-2 py-0.5 ${gc.badge} text-white`}>
                                  ±{sd.tolerance_pct}% tolerance
                                </Badge>
                                <p className="text-xs text-gray-500 mt-0.5">Estimate quality</p>
                              </div>
                            </div>
                            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${gc.bar}`} style={{ width: `${conf}%` }} />
                            </div>
                          </div>
                        </div>

                        {/* Accuracy warning */}
                        {(() => {
                          const isTooNarrow = sd.building_width_ft < 18;
                          const isLowConf = sd.overall_confidence < 75 || sd.tolerance_pct >= 15;
                          const isCapped = sd.dimension_capped;
                          const showWarning = isTooNarrow || isLowConf || isCapped;
                          if (!showWarning) return null;

                          const reasons = [];
                          if (isCapped || isTooNarrow) reasons.push(`Building width (${sd.building_width_ft}ft) looks unusually narrow — satellite data may have estimated the wrong proportions`);
                          if (isLowConf) reasons.push(`Confidence is ${sd.overall_confidence}% with ±${sd.tolerance_pct}% tolerance — measurements could be off by ${Math.round(sd.wall_area_sqft * sd.tolerance_pct / 100)} sqft`);

                          return (
                            <div className="mb-3 rounded-lg border-2 border-red-400 bg-red-50 p-3 animate-pulse">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-sm font-bold text-red-700">⚠️ Low Accuracy Warning — Photos Recommended</p>
                                  <ul className="mt-1 space-y-1">
                                    {reasons.map((r, i) => (
                                      <li key={i} className="text-xs text-red-600">• {r}</li>
                                    ))}
                                  </ul>
                                  <p className="text-xs text-red-700 font-medium mt-2">
                                    📷 Add house photos below for a much more accurate measurement.
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* AI Waste Suggestion Banner */}
                        {wasteSuggestion && !wasteSuggestion.dismissed && (() => {
                          const alreadySet = Number(config.sidingWastePct) === wasteSuggestion.pct;
                          return (
                            <div className={`mb-3 rounded-lg border-2 p-3 ${alreadySet ? 'border-teal-300 bg-teal-50' : 'border-blue-300 bg-blue-50'}`}>
                              <div className="flex items-start gap-2">
                                <span className="text-lg flex-shrink-0">{alreadySet ? '✅' : '🤖'}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-blue-800">
                                    {alreadySet
                                      ? `Waste already set to ${wasteSuggestion.pct}% — matches AI recommendation`
                                      : `AI recommends ${wasteSuggestion.pct}% waste for this job`}
                                  </p>
                                  <p className="text-xs text-blue-600 mt-0.5">{wasteSuggestion.reason}</p>
                                  {!alreadySet && (
                                    <div className="flex gap-2 mt-2 flex-wrap">
                                      <Button
                                        size="sm"
                                        className="h-7 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                                        onClick={() => {
                                          setConfig(c => ({...c, sidingWastePct: String(wasteSuggestion.pct)}));
                                          setWasteSuggestion(prev => ({...prev, dismissed: true}));
                                          if (sidingMeasurements) convertSidingMeasurementsToLineItems({...sidingMeasurements, _wasteOverride: wasteSuggestion.pct});
                                        }}
                                      >
                                        ✓ Apply {wasteSuggestion.pct}% waste
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-3 text-xs border-blue-400 text-blue-700"
                                        onClick={() => setWasteSuggestion(prev => ({...prev, dismissed: true}))}
                                      >
                                        Keep current ({config.sidingWastePct || 0}%)
                                      </Button>
                                    </div>
                                  )}
                                  {alreadySet && (
                                    <button
                                      className="text-xs text-teal-600 mt-1 underline"
                                      onClick={() => setWasteSuggestion(null)}
                                    >Dismiss</button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Main measurements */}
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                          <div className="bg-teal-50 rounded p-3 shadow-sm border border-teal-100">
                            <span className="text-teal-800 block mb-1 text-xs font-semibold">Wall Area:</span>
                            <span className="font-bold text-xl text-teal-700">{Number(sd.wall_area_sq).toFixed(2)}</span>
                            <span className="text-xs text-teal-600 ml-1">SQ</span>
                            <p className="text-xs text-teal-600 mt-1">{sd.wall_area_sqft?.toLocaleString()} sqft net</p>
                          </div>
                          <div className="bg-white rounded p-3 shadow-sm">
                            <span className="text-gray-600 block mb-1 text-xs">Perimeter:</span>
                            <span className="font-bold text-xl text-gray-800">{sd.perimeter_ft}</span>
                            <span className="text-xs text-gray-500 ml-1">LF</span>
                            <p className="text-xs text-gray-500 mt-1">Wall top & bottom</p>
                          </div>
                          <div className="bg-white rounded p-3 shadow-sm">
                            <span className="text-gray-600 block mb-1 text-xs">Outside Corners:</span>
                            <span className="font-bold text-xl text-gray-800">{sd.outside_corners_count}</span>
                            <span className="text-xs text-gray-500 ml-1">ea</span>
                            <p className="text-xs text-gray-500 mt-1">{sd.outside_corners_lf} LF total</p>
                          </div>
                        </div>

                        {/* Hover-style full measurement summary */}
                        {(() => {
                          const roofSQ = satelliteAnalysis?.roofAreaSQ || satelliteAnalysis?.total_area_sq;
                          const roofSqFt = roofSQ ? Math.round(roofSQ * 100) : null;
                          const pitch = satelliteAnalysis?.predominant_pitch || satelliteAnalysis?.pitch;
                          const roofPerim = satelliteAnalysis?.eave_lf || satelliteAnalysis?.perimeter_lf;
                          const rows = [
                            roofSqFt ? { label: 'Roof Area', value: `${roofSqFt.toLocaleString()} ft²` } : null,
                            { label: 'Siding', value: `${sd.wall_area_sqft?.toLocaleString()} ft²` },
                            { label: 'Windows (est.)', value: sd.estimated_windows ?? '—' },
                            { label: 'Doors (est.)', value: sd.estimated_doors ?? '—' },
                            sd.fascia_lf ? { label: 'Fascia', value: `${sd.fascia_lf} ft` } : null,
                            pitch ? { label: 'Predominant Pitch', value: pitch } : null,
                            roofPerim ? { label: 'Roof Perimeter', value: `${roofPerim} ft` } : null,
                            sd.soffit_sqft ? { label: 'Soffit (est.)', value: `${sd.soffit_sqft?.toLocaleString()} ft²` } : null,
                            sd.trim_sqft ? { label: 'Trim (est.)', value: `${sd.trim_sqft?.toLocaleString()} ft²` } : null,
                          ].filter(Boolean);
                          return (
                            <div className="mt-3 rounded-xl border border-gray-200 bg-white overflow-hidden" data-testid="panel-hover-summary">
                              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                                <h4 className="text-sm font-bold text-gray-700">Measurement Summary</h4>
                                <p className="text-xs text-gray-400">Windows, doors & trim are estimates — photo analysis gives exact counts</p>
                              </div>
                              <div className="divide-y divide-gray-100">
                                {rows.map((row, i) => (
                                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                                    <span className="text-sm text-gray-500">{row.label}</span>
                                    <span className="text-sm font-bold text-gray-900">{row.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Per-face breakdown */}
                        {sd.faces && (
                          <div className="mt-3">
                            <p className="text-xs font-semibold text-gray-700 mb-2">Wall Face Breakdown:</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {[
                                { label: 'North', key: 'north', color: 'bg-blue-500' },
                                { label: 'South', key: 'south', color: 'bg-orange-500' },
                                { label: 'East', key: 'east', color: 'bg-green-500' },
                                { label: 'West', key: 'west', color: 'bg-purple-500' },
                              ].map(f => (
                                <div key={f.key} className="bg-white rounded p-2 shadow-sm">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <div className={`w-2.5 h-2.5 rounded-full ${f.color}`} />
                                    <span className="text-xs text-gray-600">{f.label}</span>
                                  </div>
                                  <span className="font-semibold text-sm">{sd.faces[f.key]?.area_sqft?.toLocaleString()} sqft</span>
                                  <p className="text-xs text-gray-400">{sd.faces[f.key]?.length_ft} LF</p>
                                </div>
                              ))}
                            </div>
                            {sd.gable_area_sqft > 0 && (
                              <p className="text-xs text-gray-500 mt-1">+ {sd.gable_area_sqft} sqft gable area included</p>
                            )}
                          </div>
                        )}

                        {/* Assumptions */}
                        <div className="mt-3 bg-white rounded p-3">
                          <p className="text-xs font-semibold text-gray-700 mb-1">Assumptions (edit in Configure):</p>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline" className="text-xs">{sd.story_count} stor{sd.story_count === 1 ? 'y' : 'ies'}</Badge>
                            <Badge variant="outline" className="text-xs">{sd.story_height_ft}ft ceiling</Badge>
                            <Badge variant="outline" className="text-xs">−{sd.opening_deduction_pct}% openings</Badge>
                            <Badge variant="outline" className="text-xs">Footprint: {sd.footprint_sqft?.toLocaleString()} sqft</Badge>
                            {Number(config.sidingWastePct) > 0 && (
                              <Badge className="text-xs bg-teal-100 text-teal-800 border border-teal-300">+{config.sidingWastePct}% waste</Badge>
                            )}
                          </div>
                        </div>

                        {sd.analysis_notes && (
                          <p className="text-xs text-gray-500 mt-2">{sd.analysis_notes}</p>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 mt-3">
                          <Button
                            data-testid="button-build-siding-estimate"
                            onClick={() => {
                              const measurements = {
                                wall_area_sq: sd.wall_area_sq,
                                wall_area_sqft: sd.wall_area_sqft,
                                wall_top_lf: sd.wall_top_lf,
                                wall_bottom_lf: sd.wall_bottom_lf,
                                outside_corners_count: sd.outside_corners_count,
                                outside_corners_lf: sd.outside_corners_lf,
                                inside_corners_count: sd.inside_corners_count,
                                inside_corners_lf: sd.inside_corners_lf,
                              };
                              convertSidingMeasurementsToLineItems(measurements);
                            }}
                            className="flex-1 bg-teal-600 hover:bg-teal-700 text-white"
                            size="sm"
                          >
                            <Sparkles className="w-4 h-4 mr-1" />
                            Build Siding Estimate
                          </Button>
                          <Button
                            data-testid="button-remeasure-siding"
                            onClick={handleAnalyzeSiding}
                            disabled={isSidingAnalyzing}
                            variant="outline"
                            size="sm"
                          >
                            {isSidingAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          </Button>
                        </div>

                        {/* ── Calibration Library ─────────────────────────── */}
                        <div className="mt-4 border-t border-gray-200 pt-3">
                          <button
                            data-testid="button-toggle-calibration"
                            onClick={() => {
                              const next = !showCalPanel;
                              setShowCalPanel(next);
                              if (next && calibrations.length === 0) loadCalibrations();
                            }}
                            className="w-full flex items-center justify-between text-xs font-semibold text-gray-600 hover:text-gray-900 py-1"
                          >
                            <span className="flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5" />
                              Calibration Library
                              {avgCorrFactor && (
                                <Badge className={`ml-1 text-xs ${avgCorrFactor > 1 ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-blue-100 text-blue-800 border-blue-300'}`}>
                                  AI runs {avgCorrFactor > 1 ? 'low' : 'high'} {Math.abs((avgCorrFactor - 1) * 100).toFixed(0)}%
                                </Badge>
                              )}
                              {calibrations.length > 0 && !avgCorrFactor && (
                                <Badge className="ml-1 text-xs bg-green-100 text-green-800 border-green-300">{calibrations.length} record{calibrations.length !== 1 ? 's' : ''}</Badge>
                              )}
                            </span>
                            {showCalPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>

                          {showCalPanel && (
                            <div className="mt-3 space-y-3">
                              {/* Correction banner */}
                              {avgCorrFactor && Math.abs(avgCorrFactor - 1) > 0.03 && (
                                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
                                  <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                  <div className="text-xs text-amber-700">
                                    <p className="font-semibold">Based on {calibrations.length} confirmed report{calibrations.length !== 1 ? 's' : ''}, the AI estimate typically runs {avgCorrFactor > 1 ? 'low' : 'high'} by {Math.abs((avgCorrFactor - 1) * 100).toFixed(1)}% for your area.</p>
                                    <p className="mt-0.5">Calibration-adjusted estimate: <strong>{Math.round(sd.wall_area_sqft * avgCorrFactor).toLocaleString()} sqft</strong> ({(sd.wall_area_sq * avgCorrFactor).toFixed(2)} SQ)</p>
                                  </div>
                                </div>
                              )}

                              {/* Add confirmed report */}
                              <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                                <p className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
                                  <Upload className="w-3.5 h-3.5" />
                                  Add Confirmed Measurement
                                </p>
                                <p className="text-xs text-blue-600 mb-2">Upload an EagleView, Hover, or Aerial Reports PDF to record the actual wall area. The system tracks the delta and helps correct future estimates.</p>

                                {/* Source selector */}
                                <div className="flex gap-1 mb-2 flex-wrap">
                                  {['EagleView', 'Hover', 'Aerial Reports', 'On-Site', 'Manual'].map(src => (
                                    <button
                                      key={src}
                                      onClick={() => setCalSource(src)}
                                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${calSource === src ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}
                                    >
                                      {src}
                                    </button>
                                  ))}
                                </div>

                                {/* PDF upload */}
                                {calSource !== 'Manual' && calSource !== 'On-Site' && (
                                  <div className="mb-2">
                                    <label className="block text-xs text-blue-700 mb-1">Upload {calSource} Report (PDF):</label>
                                    <input
                                      type="file"
                                      accept=".pdf,.png,.jpg,.jpeg"
                                      className="text-xs w-full file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-blue-100 file:text-blue-700"
                                      disabled={calFileUploading || savingCal}
                                      onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        setCalFileUploading(true);
                                        try {
                                          const { file_url } = await base44.integrations.Core.UploadFile({ file });
                                          const extractResult = await base44.integrations.Core.InvokeLLM({
                                            prompt: `Extract the TOTAL NET WALL AREA (siding area, net of windows and doors) from this ${calSource} measurement report. Return ONLY a JSON object with wall_area_sqft (number). Use the final net/deducted total. If not found, use null.`,
                                            file_urls: [file_url],
                                            response_json_schema: { type: 'object', properties: { wall_area_sqft: { type: 'number' } } }
                                          });
                                          const extracted = Number(extractResult?.wall_area_sqft);
                                          if (extracted > 0) {
                                            setCalConfirmedSqft(String(Math.round(extracted)));
                                          } else {
                                            alert('Could not extract wall area from this report. Please enter it manually.');
                                            setCalSource('Manual');
                                          }
                                        } catch (err) {
                                          alert('Failed to parse report: ' + err.message);
                                        } finally {
                                          setCalFileUploading(false);
                                          e.target.value = '';
                                        }
                                      }}
                                    />
                                    {calFileUploading && (
                                      <p className="text-xs text-blue-600 mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Parsing report...</p>
                                    )}
                                  </div>
                                )}

                                {/* Confirmed sqft + save */}
                                <div className="flex items-end gap-2">
                                  <div className="flex-1">
                                    <label className="block text-xs text-blue-700 mb-1">
                                      {calSource === 'Manual' || calSource === 'On-Site' ? 'Measured Wall Area (sqft):' : 'Confirmed Wall Area (sqft):'}
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="99999"
                                      placeholder="e.g. 2450"
                                      value={calConfirmedSqft}
                                      onChange={e => setCalConfirmedSqft(e.target.value)}
                                      className="w-full border border-blue-300 rounded px-2 py-1 text-sm bg-white"
                                    />
                                  </div>
                                  {calConfirmedSqft && Number(calConfirmedSqft) > 0 && (
                                    <div className="text-xs text-center pb-1 shrink-0">
                                      <span className="text-gray-500 block">AI: {sd.wall_area_sqft?.toLocaleString()}</span>
                                      <span className={`font-semibold ${Number(calConfirmedSqft) > sd.wall_area_sqft ? 'text-amber-600' : 'text-blue-600'}`}>
                                        {Number(calConfirmedSqft) > sd.wall_area_sqft ? '+' : ''}{((Number(calConfirmedSqft) / sd.wall_area_sqft - 1) * 100).toFixed(1)}%
                                      </span>
                                    </div>
                                  )}
                                </div>

                                <button
                                  data-testid="button-save-calibration"
                                  disabled={!calConfirmedSqft || Number(calConfirmedSqft) <= 0 || savingCal}
                                  onClick={async () => {
                                    if (!myCompany?.id) { alert('Company not loaded'); return; }
                                    setSavingCal(true);
                                    try {
                                      await base44.functions.invoke('saveMeasurementCalibration', {
                                        companyId: myCompany.id,
                                        address: satelliteAddress?.address || '',
                                        lat: satelliteAddress?.coordinates?.lat,
                                        lng: satelliteAddress?.coordinates?.lng,
                                        aiEstimateSqft: sd.wall_area_sqft,
                                        confirmedSqft: Number(calConfirmedSqft),
                                        source: calSource,
                                        measurementType: 'siding',
                                      });
                                      setCalConfirmedSqft('');
                                      await loadCalibrations();
                                    } catch (err) {
                                      alert('Failed to save: ' + err.message);
                                    }
                                    setSavingCal(false);
                                  }}
                                  className="w-full mt-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs py-1.5 px-3 rounded flex items-center justify-center gap-1.5 transition-colors"
                                >
                                  {savingCal ? <><Loader2 className="w-3 h-3 animate-spin" />Saving...</> : <><CheckCircle2 className="w-3 h-3" />Save Calibration Record</>}
                                </button>
                              </div>

                              {/* Past records */}
                              {calibrations.length > 0 ? (
                                <div className="space-y-1">
                                  <p className="text-xs font-semibold text-gray-600 flex items-center justify-between">
                                    <span>Past Records ({calibrations.length})</span>
                                    {avgCorrFactor && (
                                      <Badge className={`text-xs ${Math.abs(avgCorrFactor - 1) < 0.04 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                                        Avg factor: {avgCorrFactor.toFixed(3)}×
                                      </Badge>
                                    )}
                                  </p>
                                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                                    {calibrations.slice(0, 8).map((cal, idx) => (
                                      <div key={cal.id || idx} className="flex items-center justify-between px-3 py-2 text-xs border-b border-gray-100 last:border-0 bg-white hover:bg-gray-50">
                                        <div className="flex-1 min-w-0">
                                          <span className="font-medium text-gray-700">{cal.source || '—'}</span>
                                          {cal.address && <span className="text-gray-400 ml-2 truncate">{cal.address.split(',')[0]}</span>}
                                        </div>
                                        <div className="flex items-center gap-2 ml-2 shrink-0">
                                          <span className="text-gray-500">{Number(cal.aiEstimateSqft).toLocaleString()} → {Number(cal.confirmedSqft).toLocaleString()} sqft</span>
                                          <Badge className={`text-xs ${(cal.correctionFactor || 1) > 1.05 ? 'bg-amber-100 text-amber-800' : (cal.correctionFactor || 1) < 0.95 ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                                            {((cal.correctionFactor || 1) * 100 - 100) > 0 ? '+' : ''}{((cal.correctionFactor || 1) * 100 - 100).toFixed(1)}%
                                          </Badge>
                                          <button
                                            onClick={async () => {
                                              await base44.functions.invoke('deleteCalibrationRecord', { id: cal.id });
                                              await loadCalibrations();
                                            }}
                                            className="text-red-300 hover:text-red-600 transition-colors"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400 text-center py-2">No calibration records yet. Add your first confirmed measurement above.</p>
                              )}
                            </div>
                          )}
                        </div>

                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Photo-based siding analysis ─────────────────────────── */}
              {(config.specialty === 'siding' || photoSidingAnalysis) && (
                <div className="mt-3 space-y-3">
                  <Button
                    data-testid="button-toggle-photo-siding"
                    variant={showPhotoSiding ? 'default' : 'outline'}
                    size="sm"
                    className={`w-full text-sm flex items-center gap-2 ${showPhotoSiding ? 'bg-cyan-600 hover:bg-cyan-700 text-white' : 'border-cyan-500 text-cyan-600 hover:bg-cyan-50'}`}
                    onClick={() => setShowPhotoSiding(prev => !prev)}
                  >
                    <Camera className="w-4 h-4" />
                    📷 Measure Siding from House Photos
                    <span className="ml-auto text-xs opacity-70">{showPhotoSiding ? '▲ Hide' : '▼ Expand'}</span>
                  </Button>

                  {showPhotoSiding && (
                    <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-4 space-y-4">
                      {/* Structure type selector */}
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-2">What are you measuring?</p>
                        <div className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-cyan-200">
                          <button
                            data-testid="button-structure-house"
                            onClick={() => setStructureType('house')}
                            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 px-3 rounded-md transition-colors ${structureType === 'house' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
                          >
                            🏠 House
                          </button>
                          <button
                            data-testid="button-structure-garage"
                            onClick={() => { setStructureType('garage'); setUseSatelliteMode(false); }}
                            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 px-3 rounded-md transition-colors ${structureType === 'garage' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
                          >
                            🏗️ Garage / Shed
                          </button>
                        </div>
                      </div>

                      {/* Satellite sub-toggle — only for house mode */}
                      {structureType === 'house' && (
                        <div>
                          <div className="flex items-center gap-2 p-1.5 rounded-lg bg-white border border-cyan-200">
                            <button
                              data-testid="button-mode-photos-only"
                              onClick={() => setUseSatelliteMode(false)}
                              className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 px-3 rounded-md transition-colors ${!useSatelliteMode ? 'bg-cyan-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
                            >
                              📸 Photos Only
                            </button>
                            <button
                              data-testid="button-mode-satellite"
                              onClick={() => setUseSatelliteMode(true)}
                              className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 px-3 rounded-md transition-colors ${useSatelliteMode ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
                            >
                              🛰️ Satellite Assisted
                            </button>
                          </div>
                          <p className="text-xs text-cyan-700 mt-1.5">
                            {useSatelliteMode
                              ? '🛰️ Satellite mode: Google Maps footprint is combined with your photos for the best house measurements.'
                              : '📸 Photos Only: all dimensions come from your uploaded photos.'}
                          </p>
                        </div>
                      )}

                      {structureType === 'garage' && (
                        <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                          🏗️ <strong>Garage / Outbuilding mode:</strong> satellite is disabled. The AI knows it's analyzing a detached garage and will apply garage-specific rules — no satellite footprint from the main house, garage door panels not counted as windows.
                        </p>
                      )}

                      {/* Named photo slots */}
                      {(() => {
                        const houseSlots = [
                          { label: 'Front',         emoji: '🏠', hint: 'Front face of house' },
                          { label: 'Back',          emoji: '🔄', hint: 'Rear of house' },
                          { label: 'Left Side',     emoji: '◀️',  hint: 'Left side wall' },
                          { label: 'Right Side',    emoji: '▶️',  hint: 'Right side wall' },
                          { label: 'FL Corner',     emoji: '↙️',  hint: 'Front-left corner angle' },
                          { label: 'FR Corner',     emoji: '↘️',  hint: 'Front-right corner angle' },
                          { label: 'BL Corner',     emoji: '↖️',  hint: 'Back-left corner angle' },
                          { label: 'BR Corner',     emoji: '↗️',  hint: 'Back-right corner angle' },
                          { label: 'Garage',        emoji: '🏗️', hint: 'Garage face (optional)' },
                          { label: 'Detail 1',      emoji: '🔍', hint: 'Close-up detail / damage area' },
                          { label: 'Detail 2',      emoji: '🔍', hint: 'Second detail shot (optional)' },
                        ];
                        const garageSlots = [
                          { label: 'Front',      emoji: '🏗️', hint: 'Garage front' },
                          { label: 'Back',       emoji: '🔄', hint: 'Garage rear' },
                          { label: 'Left Side',  emoji: '◀️',  hint: 'Left side' },
                          { label: 'Right Side', emoji: '▶️',  hint: 'Right side' },
                          { label: 'FL Corner',  emoji: '↙️',  hint: 'Front-left corner angle' },
                          { label: 'FR Corner',  emoji: '↘️',  hint: 'Front-right corner angle' },
                        ];
                        const slots = structureType === 'garage' ? garageSlots : houseSlots;
                        return (
                          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                            {slots.map(slot => {
                              const filled = housePhotos.find(p => p.label === slot.label);
                              const isLoading = uploadingSlot === slot.label;
                              return (
                                <div key={slot.label} className="relative group" data-testid={`slot-${slot.label.replace(/\s+/g, '-').toLowerCase()}`}>
                                  <label className="cursor-pointer block">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={e => { if (e.target.files?.[0]) handleSlotPhotoSelect(e.target.files[0], slot.label); e.target.value = ''; }}
                                      disabled={isLoading || !!uploadingSlot}
                                    />
                                    <div className={`rounded-lg border-2 overflow-hidden transition-all ${filled ? 'border-cyan-400' : 'border-dashed border-cyan-300 hover:border-cyan-500'} bg-white`}>
                                      {filled ? (
                                        <div className="relative">
                                          <img src={filled.preview || filled.url} alt={slot.label} className="w-full h-20 object-cover" />
                                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1">
                                            <p className="text-white text-[10px] font-semibold truncate">{slot.emoji} {slot.label}</p>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="flex flex-col items-center justify-center h-20 px-1 text-center">
                                          {isLoading ? (
                                            <Loader2 className="w-5 h-5 text-cyan-500 animate-spin mb-1" />
                                          ) : (
                                            <span className="text-xl mb-0.5">{slot.emoji}</span>
                                          )}
                                          <p className="text-[10px] font-semibold text-gray-600 leading-tight">{slot.label}</p>
                                          <p className="text-[9px] text-gray-400 leading-tight mt-0.5">{isLoading ? 'Uploading…' : 'Tap to add'}</p>
                                        </div>
                                      )}
                                    </div>
                                  </label>
                                  {filled && (
                                    <button
                                      data-testid={`button-remove-slot-${slot.label.replace(/\s+/g, '-').toLowerCase()}`}
                                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none z-10"
                                      onClick={() => setHousePhotos(prev => prev.filter(p => p.label !== slot.label))}
                                    >×</button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {/* Analyze + Clear row */}
                      <div className="flex flex-wrap gap-2 items-center">
                        {housePhotos.length > 0 && (
                          <>
                            <Button
                              data-testid="button-analyze-photos"
                              size="sm"
                              onClick={handleAnalyzePhotos}
                              disabled={isAnalyzingPhotos || !!uploadingSlot}
                              className="bg-cyan-600 hover:bg-cyan-700 text-white text-xs"
                            >
                              {isAnalyzingPhotos
                                ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Analyzing…</>
                                : <><Sparkles className="w-3.5 h-3.5 mr-1" />Analyze Photos ({housePhotos.length})</>}
                            </Button>
                            <Button
                              data-testid="button-clear-photos"
                              size="sm"
                              variant="ghost"
                              onClick={() => { setHousePhotos([]); setPhotoSidingAnalysis(null); }}
                              className="text-xs text-gray-500"
                            >
                              Clear All
                            </Button>
                          </>
                        )}
                        {housePhotos.length === 0 && !uploadingSlot && (
                          <p className="text-xs text-cyan-600/60 italic">Click any slot above to add a photo for that angle</p>
                        )}
                      </div>

                      {/* Photo analysis results panel */}
                      {photoSidingAnalysis && (() => {
                        const d = photoSidingAnalysis;
                        const gc = d.confidence_grade === 'A' ? { bg: 'bg-green-50', border: 'border-green-400', badge: 'bg-green-500' }
                                 : d.confidence_grade === 'B' ? { bg: 'bg-emerald-50', border: 'border-emerald-400', badge: 'bg-emerald-500' }
                                 : d.confidence_grade === 'C' ? { bg: 'bg-cyan-50', border: 'border-cyan-400', badge: 'bg-cyan-500' }
                                 : d.confidence_grade === 'D' ? { bg: 'bg-yellow-50', border: 'border-yellow-400', badge: 'bg-yellow-500' }
                                 : { bg: 'bg-orange-50', border: 'border-orange-400', badge: 'bg-orange-500' };
                        return (
                          <div className={`rounded-lg p-4 border-2 ${gc.bg} ${gc.border} space-y-3`} data-testid="panel-photo-siding-results">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-sm text-gray-800">📸 Photo Siding Measurements</p>
                                <p className="text-xs text-gray-500 mt-0.5">{d.analysis_notes}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <span className={`text-white text-xs font-bold px-2 py-0.5 rounded ${gc.badge}`}>Grade {d.confidence_grade}</span>
                                <p className="text-xs text-gray-500 mt-0.5">{d.overall_confidence}% · ±{d.tolerance_pct}%</p>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              {[
                                { label: 'Net Wall Area', value: `${(d.wall_area_sq || 0).toFixed(2)} SQ`, sub: `${(d.wall_area_sqft || 0).toLocaleString()} sqft` },
                                { label: 'Perimeter', value: `${d.perimeter_ft || 0} LF`, sub: `${d.building_length_ft}×${d.building_width_ft} ft` },
                                { label: 'Stories', value: `${d.story_count}`, sub: `× ${d.story_height_ft}ft each` },
                              ].map((m, i) => (
                                <div key={i} className="bg-white/70 rounded p-2 text-center">
                                  <p className="text-xs text-gray-500">{m.label}</p>
                                  <p className="font-bold text-sm text-gray-800">{m.value}</p>
                                  <p className="text-xs text-gray-400">{m.sub}</p>
                                </div>
                              ))}
                            </div>

                            {/* Hover-style summary card */}
                            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden" data-testid="panel-photo-hover-summary">
                              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                                <h4 className="text-sm font-bold text-gray-700">Measurement Summary</h4>
                              </div>
                              <div className="divide-y divide-gray-100">
                                {[
                                  { label: 'Siding', value: `${(d.wall_area_sqft || 0).toLocaleString()} ft²` },
                                  d.masonry_deduct_sqft > 0 ? { label: `${d.masonry_material ? d.masonry_material.charAt(0).toUpperCase() + d.masonry_material.slice(1) : 'Masonry'} excluded`, value: `−${d.masonry_deduct_sqft.toLocaleString()} ft² (${d.masonry_deduct_pct}%)`, highlight: true } : null,
                                  { label: 'Windows', value: d.windows_count ?? 0 },
                                  { label: 'Doors', value: d.doors_count ?? 0 },
                                  d.garage_door_count > 0 ? { label: 'Garage Doors', value: d.garage_door_count } : null,
                                  d.shutters_count > 0 ? { label: 'Shutters', value: d.shutters_count } : null,
                                  d.fascia_lf ? { label: 'Fascia', value: `${d.fascia_lf} ft` } : null,
                                  d.soffit_sqft ? { label: 'Soffit', value: `${d.soffit_sqft?.toLocaleString()} ft²` } : null,
                                  d.trim_sqft ? { label: 'Trim', value: `${d.trim_sqft?.toLocaleString()} ft²` } : null,
                                  { label: 'Roof Perimeter', value: `${d.perimeter_ft || 0} ft` },
                                  { label: 'Material', value: <span className="capitalize">{d.siding_material || 'Unknown'}</span> },
                                  { label: 'Condition', value: <span className="capitalize">{d.siding_condition || 'Unknown'}</span> },
                                ].filter(Boolean).map((row, i) => (
                                  <div key={i} className={`flex items-center justify-between px-4 py-2 ${row.highlight ? 'bg-amber-50' : ''}`}>
                                    <span className={`text-sm ${row.highlight ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>{row.label}</span>
                                    <span className={`text-sm font-bold ${row.highlight ? 'text-amber-700' : 'text-gray-900'}`}>{row.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-white/60 rounded p-2 space-y-0.5">
                                <p className="text-gray-500 font-medium mb-1">Deductions</p>
                                <p>🪟 {d.windows_count} window{d.windows_count !== 1 ? 's' : ''}</p>
                                {d.shutters_count > 0 && <p>🪪 {d.shutters_count} shutter{d.shutters_count !== 1 ? 's' : ''}</p>}
                                <p>🚪 {d.doors_count} door{d.doors_count !== 1 ? 's' : ''}</p>
                                {d.garage_door_count > 0 && <p>🏠 {d.garage_door_count} garage door{d.garage_door_count !== 1 ? 's' : ''}</p>}
                                <p className="text-gray-400 mt-1">−{(d.opening_deduct_sqft || 0).toLocaleString()} sqft openings</p>
                                {d.masonry_deduct_sqft > 0 && <p className="text-amber-600 font-medium">🧱 {d.masonry_deduct_pct}% {d.masonry_material || 'masonry'} −{d.masonry_deduct_sqft.toLocaleString()} sqft</p>}
                              </div>
                              <div className="bg-white/60 rounded p-2 space-y-0.5">
                                <p className="text-gray-500 font-medium mb-1">Material / Condition</p>
                                <p className="capitalize">🎨 {d.siding_material || 'Unknown'}</p>
                                <p className="capitalize">📊 {d.siding_condition || 'Unknown'} cond.</p>
                                <p className="capitalize">📐 {d.wall_complexity || 'Unknown'} complexity</p>
                                <p className="text-gray-400 mt-1">{d.used_satellite ? '🛰️ Satellite dims' : '📷 Photo dims'}</p>
                              </div>
                            </div>

                            {d.photo_details?.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-600 mb-1.5">Per-Photo Breakdown</p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                                  {d.photo_details.map((ph, i) => (
                                    <div key={i} className="bg-white/70 rounded p-1.5 text-center">
                                      <p className="text-xs font-medium text-gray-700 capitalize">{ph.label}</p>
                                      <p className="text-xs text-gray-500">{ph.story_count}{ph.has_half_story ? '.5' : ''} story</p>
                                      <p className="text-xs text-gray-500">{ph.windows_count}w {ph.doors_count}d</p>
                                      <p className="text-xs text-gray-400">{ph.confidence}% conf</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {d.satellite_warning && (
                              <div className="bg-amber-50 border border-amber-300 rounded p-2 text-xs text-amber-800 flex gap-1.5">
                                <span className="shrink-0">⚠️</span>
                                <span>{d.satellite_warning}</span>
                              </div>
                            )}

                            <div className="flex gap-2">
                              <Button
                                data-testid="button-build-photo-siding-estimate"
                                onClick={() => convertSidingMeasurementsToLineItems(photoSidingAnalysis)}
                                size="sm"
                                className="bg-cyan-600 hover:bg-cyan-700 text-white text-xs flex-1"
                              >
                                <Sparkles className="w-3.5 h-3.5 mr-1" />
                                Build Siding Estimate
                              </Button>
                              <Button
                                data-testid="button-reanalyze-photos"
                                onClick={handleAnalyzePhotos}
                                disabled={isAnalyzingPhotos}
                                variant="outline"
                                size="sm"
                                className="text-xs border-cyan-400 text-cyan-700"
                              >
                                {isAnalyzingPhotos ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* ── AI DAMAGE OBSERVATIONS (multi-trade) ─────────────────── */}
              {(satelliteAnalysis || sidingMeasurements) && (() => {
                const ra = satelliteAnalysis || {};
                const sd = sidingMeasurements || {};

                // ── Roof signals ──────────────────────────────────────────
                const roofSegs = Number(ra.num_segments) || 0;
                const roofType = ra.roof_type || '';
                const roofConf = Number(ra.overall_confidence) || 85;
                const wastePct = Number(ra.waste_percentage) || 12;
                const pitchStr = ra.pitch || '';
                const pitchNum = pitchStr ? Number(pitchStr.split('/')[0]) : 0;
                const valleyLF = Number(ra.valley_lf) || 0;
                const hipLF = Number(ra.hip_lf) || 0;
                const eaveLF = Number(ra.eave_lf) || 0;
                const rakeLF = Number(ra.rake_lf) || 0;
                const stepFlashLF = Number(ra.step_flashing_lf) || 0;
                const apronFlashLF = Number(ra.apron_flashing_lf) || 0;
                const roofAreaSQ = Number(ra.roof_area_sq) || 0;
                const isVeryComplexRoof = roofType === 'very_complex' || roofType === 'complex' || roofSegs >= 10;
                const isComplexRoof = roofSegs >= 6 && !isVeryComplexRoof;
                const isLowRoofConf = roofConf < 70 && satelliteAnalysis;
                const isSteepPitch = pitchNum >= 8;

                // ── Siding signals ────────────────────────────────────────
                const wallAreaSF = Number(sd.wall_area_sqft) || (Number(sd.wall_area_sq) || 0) * 100;
                const isCapped = !!sd.dimension_capped;
                const isLowSidingConf = (Number(sd.overall_confidence) || 100) < 75 && sidingMeasurements;
                const cornersCount = Number(sd.outside_corners_count) || 0;
                const gableAreaSF = Number(sd.gable_area_sqft) || 0;
                const perimeterLF = Number(sd.perimeter_ft) || eaveLF;
                const storyCount = Number(sd.story_count) || 1;
                const footprintSF = Number(sd.footprint_sqft) || 0;

                // ── Overall risk ──────────────────────────────────────────
                const highFlags = [isVeryComplexRoof, (isCapped && isLowSidingConf)].filter(Boolean).length;
                const medFlags = [isComplexRoof, isCapped, isLowSidingConf, isLowRoofConf, isSteepPitch, wastePct > 15].filter(Boolean).length;
                const overallRisk = highFlags >= 1 ? 'HIGH' : medFlags >= 2 ? 'MEDIUM' : medFlags >= 1 ? 'LOW' : 'LOW';
                const riskClasses = {
                  HIGH: { card: 'bg-red-50 border-red-200', head: 'text-red-700', badge: 'bg-red-600', icon: 'text-red-600', obs: 'text-red-800' },
                  MEDIUM: { card: 'bg-orange-50 border-orange-200', head: 'text-orange-700', badge: 'bg-orange-500', icon: 'text-orange-500', obs: 'text-orange-800' },
                  LOW: { card: 'bg-green-50 border-green-200', head: 'text-green-700', badge: 'bg-green-600', icon: 'text-green-600', obs: 'text-green-800' },
                }[overallRisk];

                // ── Build trade-grouped observations ──────────────────────
                const trades = [];

                // ROOFING
                if (satelliteAnalysis) {
                  const roofObs = [];
                  if (isVeryComplexRoof) roofObs.push(`${roofSegs > 0 ? roofSegs + '-segment' : ''} ${roofType.replace(/_/g,' ')} roof — high cut waste (${wastePct}%). Strong basis for supplement claim on complexity.`);
                  else if (isComplexRoof) roofObs.push(`${roofSegs}-segment roof — above-average cut waste (${wastePct}%). Document all hips and valleys on scope.`);
                  else roofObs.push(`${roofSegs > 0 ? roofSegs + '-segment' : 'Standard'} ${roofType.replace(/_/g,' ')} roof — ${wastePct}% waste. Normal scope expected.`);
                  if (isSteepPitch) roofObs.push(`Steep pitch (${pitchStr}) — labor steep-slope supplement applicable. Verify carrier allows.`);
                  if (isLowRoofConf) roofObs.push(`AI confidence ${roofConf}% — measurements may carry ±15%. Upload EagleView/HOVER for adjuster-grade accuracy.`);
                  if (hipLF > 0 && valleyLF > 0) roofObs.push(`${hipLF} LF hip + ${valleyLF} LF valley — cap/valley metal both in scope; measure cut-and-cobble waste separately.`);
                  else if (hipLF > 0) roofObs.push(`${hipLF} LF hip cap — include in scope; often missed on quick adjuster sketches.`);
                  trades.push({ trade: 'Roofing', icon: '🏠', obs: roofObs, risk: isVeryComplexRoof ? 'HIGH' : isComplexRoof ? 'MEDIUM' : 'LOW' });
                }

                // GUTTERS
                if (eaveLF > 0) {
                  const gutterObs = [];
                  gutterObs.push(`${eaveLF} LF eave — full perimeter gutter replacement in scope. ${eaveLF > 200 ? 'Large run; include all downspouts and end caps.' : 'Include all downspout drops and miters.'}`);
                  if (roofType.includes('hip')) gutterObs.push('Hip roof — gutters wrap entire perimeter. Verify adjuster captured all four sides.');
                  if (eaveLF > 150) gutterObs.push('Inspect fascia board for rot/hail damage before gutter install — often supplemented.');
                  trades.push({ trade: 'Gutters & Fascia', icon: '🌧️', obs: gutterObs, risk: eaveLF > 200 ? 'MEDIUM' : 'LOW' });
                }

                // SOFT METALS / FLASHING
                const totalFlashLF = valleyLF + stepFlashLF + apronFlashLF;
                if (totalFlashLF > 0 || satelliteAnalysis) {
                  const metalObs = [];
                  if (valleyLF > 0) metalObs.push(`${valleyLF} LF valley metal — include in scope. W-metal or ice-and-water underlap required.`);
                  if (stepFlashLF > 0) metalObs.push(`${stepFlashLF} LF step flashing — walls/dormers present. Verify each run matches adjuster scope.`);
                  if (apronFlashLF > 0) metalObs.push(`${apronFlashLF} LF apron/kickout flashing — critical for water intrusion claims.`);
                  if (rakeLF > 0) metalObs.push(`${rakeLF} LF rake — include drip edge on all rake edges per code.`);
                  if (eaveLF > 0) metalObs.push(`${eaveLF} LF eave drip edge — required along all eaves per IRC R905.`);
                  if (metalObs.length === 0) metalObs.push('No flashing data yet — measure roof first to get valley/step/apron LF.');
                  trades.push({ trade: 'Soft Metals & Flashing', icon: '🔩', obs: metalObs, risk: stepFlashLF > 0 || apronFlashLF > 0 ? 'MEDIUM' : 'LOW' });
                }

                // SIDING
                if (sidingMeasurements) {
                  const sidingObs = [];
                  if (wallAreaSF > 0) sidingObs.push(`${Math.round(wallAreaSF)} ft² net wall area${storyCount > 1 ? `, ${storyCount}-story building` : ''} — verify each elevation with adjuster.`);
                  if (gableAreaSF > 0) sidingObs.push(`${Math.round(gableAreaSF)} ft² gable siding — often excluded from adjuster scope. Add explicitly.`);
                  if (cornersCount > 0) sidingObs.push(`${cornersCount} outside corners (${sd.outside_corners_lf || cornersCount * 9} LF) — include all corner trim in scope.`);
                  if (isCapped) sidingObs.push('Building dimensions hit satellite estimation ceiling — field measure all wall lengths before submitting claim.');
                  if (isLowSidingConf) sidingObs.push(`Siding confidence ${sd.overall_confidence}% (±${sd.tolerance_pct}%) — walk perimeter to verify before claim.`);
                  if (sidingObs.length === 0) sidingObs.push('Standard wall profile. Measure complete and within normal bounds.');
                  trades.push({ trade: 'Siding', icon: '🏗️', obs: sidingObs, risk: isCapped || isLowSidingConf ? 'MEDIUM' : 'LOW' });
                }

                // WINDOWS & FLASHING
                {
                  const winObs = [];
                  if (cornersCount >= 4 || footprintSF > 1200) winObs.push(`Building complexity suggests multiple window/door surrounds. Inspect each for seal failure and cracked casing.`);
                  if (storyCount > 1) winObs.push(`${storyCount}-story building — include second-floor window wrap/flashing in scope; frequently missed by adjusters.`);
                  if (stepFlashLF > 0) winObs.push(`Step flashing present — check adjacent window head flashing and J-channel integration.`);
                  if (winObs.length === 0 && (satelliteAnalysis || sidingMeasurements)) winObs.push('Inspect all window seals and head flashing for hail/wind damage before scope is closed.');
                  if (winObs.length > 0) trades.push({ trade: 'Windows & Flashing', icon: '🪟', obs: winObs, risk: storyCount > 1 ? 'MEDIUM' : 'LOW' });
                }

                // GARAGE DOORS
                {
                  const garageObs = [];
                  if (footprintSF > 1500 || perimeterLF > 180) garageObs.push('Larger building footprint — likely has attached garage. Inspect door panel faces for hail dents and check weatherstripping.');
                  if (roofAreaSQ > 35) garageObs.push('Property size suggests garage or outbuilding. Document all overhead doors and springs in photo evidence.');
                  if (garageObs.length === 0) garageObs.push('Inspect garage door panels, trim, and J-channel for hail damage. Include in claim if dented.');
                  trades.push({ trade: 'Garage Doors', icon: '🚗', obs: garageObs, risk: 'LOW' });
                }

                const tradeRiskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                const sortedTrades = [...trades].sort((a, b) => tradeRiskOrder[a.risk] - tradeRiskOrder[b.risk]);

                return (
                  <div className={`mt-3 rounded-lg border p-3 ${riskClasses.card}`} data-testid="panel-ai-damage-observations">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className={`w-4 h-4 ${riskClasses.icon}`} />
                      <span className={`text-sm font-semibold ${riskClasses.head}`}>AI Damage Observations</span>
                      <Badge className={`${riskClasses.badge} text-white text-xs ml-auto`}>{overallRisk} RISK</Badge>
                    </div>
                    <div className="space-y-2.5">
                      {sortedTrades.map((t, ti) => (
                        <div key={ti} className="bg-white/60 rounded p-2">
                          <p className="text-xs font-semibold text-gray-700 mb-1">{t.icon} {t.trade}</p>
                          <div className="space-y-1">
                            {t.obs.map((o, oi) => (
                              <p key={oi} className={`text-xs ${riskClasses.obs}`}>• {o}</p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-200">
                      {[satelliteAnalysis && `${roofAreaSQ.toFixed(1)} SQ roof`, sidingMeasurements && `${Math.round(wallAreaSF)} ft² walls`].filter(Boolean).join(' · ')} · AI-derived scope — verify field measurements before claim submission
                    </p>
                  </div>
                );
              })()}

              {reportMeasurements && satelliteAnalysis && (() => {
                const aiM = {
                  roof_area_sqft: Number(satelliteAnalysis.roof_area_sqft) || (Number(satelliteAnalysis.roof_area_sq) || 0) * 100,
                  ridge_lf: Number(satelliteAnalysis.ridge_lf) || 0,
                  hip_lf: Number(satelliteAnalysis.hip_lf) || 0,
                  valley_lf: Number(satelliteAnalysis.valley_lf) || 0,
                  rake_lf: Number(satelliteAnalysis.rake_lf) || 0,
                  eave_lf: Number(satelliteAnalysis.eave_lf) || 0,
                  step_flashing_lf: Number(satelliteAnalysis.step_flashing_lf) || 0
                };
                const repM = reportMeasurements;
                const pctDiff = (ai, rep) => {
                  if ((!rep || rep === 0) && (!ai || ai === 0)) return null;
                  if (!rep || rep === 0) return null;
                  if (!ai || ai === 0) return -100;
                  return Math.round(((ai - rep) / rep) * 100);
                };
                const comparisons = [
                  { label: 'Roof Area', unit: 'sqft', ai: aiM.roof_area_sqft, report: repM.roof_area_sqft },
                  { label: 'Ridge', unit: 'LF', ai: aiM.ridge_lf, report: repM.ridge_lf },
                  { label: 'Hip', unit: 'LF', ai: aiM.hip_lf, report: repM.hip_lf },
                  { label: 'Valley', unit: 'LF', ai: aiM.valley_lf, report: repM.valley_lf },
                  { label: 'Rake', unit: 'LF', ai: aiM.rake_lf, report: repM.rake_lf },
                  { label: 'Eave', unit: 'LF', ai: aiM.eave_lf, report: repM.eave_lf },
                  { label: 'Step Flash', unit: 'LF', ai: aiM.step_flashing_lf, report: repM.step_flashing_lf },
                ].filter(c => c.report > 0 || c.ai > 0);
                const validDiffs = comparisons.map(c => pctDiff(c.ai, c.report)).filter(d => d !== null);
                const avgAbsDiff = validDiffs.length > 0 ? Math.round(validDiffs.reduce((s, d) => s + Math.abs(d), 0) / validDiffs.length) : null;
                const accuracyScore = avgAbsDiff !== null ? Math.max(0, 100 - avgAbsDiff) : null;

                const handleSaveCalibration = async () => {
                  setIsSavingCalibration(true);
                  try {
                    const resp = await base44.functions.invoke('saveEstimatorCalibration', {
                      ai_measurements: aiM,
                      report_measurements: repM,
                      address: satelliteAddress?.address || customerInfo?.property_address || '',
                      roof_type: satelliteAnalysis.roof_type || 'all',
                      company_id: myCompany?.id || ''
                    });
                    setCalibrationResult(resp?.data || resp);
                  } catch (err) {
                    console.error('Calibration save error:', err);
                    setCalibrationResult({ success: false, message: err.message });
                  }
                  setIsSavingCalibration(false);
                };

                return (
                  <Card className="border-2 border-indigo-200 bg-indigo-50/50" data-testid="card-calibration-comparison">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-indigo-600" />
                        AI vs Report Comparison
                        {accuracyScore !== null && (
                          <Badge className={`ml-auto ${accuracyScore >= 85 ? 'bg-green-600' : accuracyScore >= 70 ? 'bg-yellow-600' : 'bg-red-600'} text-white`}>
                            AI Accuracy: {accuracyScore}%
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-xs text-gray-500">Compare AI satellite estimates against your uploaded measurement report</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-4 gap-1 text-xs font-semibold text-gray-600 border-b pb-1">
                        <div>Measurement</div>
                        <div className="text-right">AI Est.</div>
                        <div className="text-right">Report</div>
                        <div className="text-right">Diff</div>
                      </div>
                      {comparisons.map(c => {
                        const diff = pctDiff(c.ai, c.report);
                        const diffColor = diff === null ? 'text-gray-400' : Math.abs(diff) <= 5 ? 'text-green-700' : Math.abs(diff) <= 15 ? 'text-yellow-700' : 'text-red-700';
                        return (
                          <div key={c.label} className="grid grid-cols-4 gap-1 text-sm items-center" data-testid={`row-comparison-${c.label.toLowerCase().replace(/\s/g, '-')}`}>
                            <div className="text-gray-700 font-medium">{c.label}</div>
                            <div className="text-right font-mono">{Math.round(c.ai)} {c.unit}</div>
                            <div className="text-right font-mono font-semibold">{Math.round(c.report)} {c.unit}</div>
                            <div className={`text-right font-mono font-semibold ${diffColor}`}>
                              {diff === null ? '--' : `${diff > 0 ? '+' : ''}${diff}%`}
                            </div>
                          </div>
                        );
                      })}

                      {calibrationResult ? (
                        <div className={`rounded-lg p-3 mt-2 ${calibrationResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                          <p className={`text-sm font-medium ${calibrationResult.success ? 'text-green-800' : 'text-red-800'}`}>
                            {calibrationResult.success ? '✓ ' : '✗ '}{calibrationResult.message}
                          </p>
                        </div>
                      ) : (
                        <Button
                          onClick={handleSaveCalibration}
                          disabled={isSavingCalibration}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white mt-2"
                          data-testid="button-learn-from-report"
                        >
                          {isSavingCalibration ? (
                            <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving calibration...</>
                          ) : (
                            <><Brain className="w-4 h-4 mr-2" /> Learn from this Report</>
                          )}
                        </Button>
                      )}
                      <p className="text-xs text-gray-500 text-center">
                        {calibrationResult?.success ? 'Future AI estimates will use this calibration data.' : 'Save calibration data to improve future AI estimates for similar roofs.'}
                      </p>
                    </CardContent>
                  </Card>
                );
              })()}

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Gutters & Downspouts</CardTitle>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeGuttersAI}
                        onChange={(e) => {
                          const newChecked = e.target.checked;
                          setIncludeGuttersAI(newChecked);
                          if (currentEstimate) {
                            handleRegenerateWithGutters(newChecked, aiGutterLF, aiDownspoutCount);
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <span className="text-sm font-medium">Include in estimate</span>
                    </label>
                  </div>
                </CardHeader>
                {includeGuttersAI && (
                  <CardContent className="space-y-4">
                    <div>
                      <Label>Gutter Length (LF)</Label>
                      <Input
                        type="number"
                        value={aiGutterLF}
                        onChange={(e) => setAiGutterLF(Number(e.target.value))}
                        onBlur={(e) => {
                          if (currentEstimate) {
                            handleRegenerateWithGutters(true, Number(e.target.value), aiDownspoutCount);
                          }
                        }}
                        placeholder="Linear feet of gutters"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        💡 Auto-filled based on eave measurements ({analyzedStructures.reduce((sum, s) => sum + (s.analysis.eave_lf || 0), 0).toFixed(2) || 0} LF)
                      </p>
                    </div>

                    <div>
                      <Label>Number of Downspouts</Label>
                      <Input
                        type="number"
                        value={aiDownspoutCount}
                        onChange={(e) => setAiDownspoutCount(Number(e.target.value))}
                        onBlur={(e) => {
                          if (currentEstimate) {
                            handleRegenerateWithGutters(true, aiGutterLF, Number(e.target.value));
                          }
                        }}
                        placeholder="Number of downspouts"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        💡 Estimated: 1 downspout per 35 LF of gutter
                      </p>
                    </div>
                  </CardContent>
                )}
              </Card>

              {/* NEW: Action buttons with multi-structure support */}
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSatelliteAddress(null); // Clear the current address input for next structure
                      setSatelliteAnalysis(null); // Clear the current analysis view
                      setAnalyzedStructures([]); // Clear all structures
                      setLineItems([]);
                      setCurrentEstimate(null);
                      setIncludeGuttersAI(false); // Reset gutter state
                      setEstimateHistory([]); // Clear history when starting over
                      setShowStructureSelector(false); // Ensure selector is hidden
                      setManualAddOnMode(false); // Reset manual add-on mode
                      setManualMeasurements([]); // Clear manual add-on measurements
                      setMessages(prev => [...prev, {
                        role: 'assistant',
                        content: `Ready for new satellite analysis! Enter another address.`,
                        timestamp: new Date().toISOString()
                      }]);
                    }}
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Start Over
                  </Button>

                  {satelliteAnalysis && !isSatelliteAnalyzing && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setManualAddOnMode(true);
                        setMessages(prev => [...prev, {
                          role: 'assistant',
                          content: `🎨 **Manual Add-On Mode Activated**\n\nDraw on the satellite map to measure structures the AI missed (porches, patios, etc.). Your measurements will be added to the AI results.`,
                          timestamp: new Date().toISOString()
                        }]);
                      }}
                      className="flex-1 bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Add Manual Measurement
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isDetectingNearby}
                    onClick={handleDetectNearbyStructures}
                    className="flex-1 bg-teal-50 border-teal-300 text-teal-700 hover:bg-teal-100"
                  >
                    {isDetectingNearby ? <><span className="animate-spin mr-1">⏳</span> Detecting...</> : <><span className="mr-1">🔍</span> Auto-Detect Garage/Shed</>}
                  </Button>

                  <div className="flex flex-col gap-1 flex-1">
                    <div className="flex items-center gap-1 p-1 bg-gray-100 rounded text-xs">
                      <span className="text-gray-500 mr-1 shrink-0">Type:</span>
                      {['house', 'garage', 'shed'].map(t => (
                        <button
                          key={t}
                          onClick={() => setAddingStructureType(t)}
                          className={`flex-1 py-0.5 rounded text-center font-medium transition-colors ${addingStructureType === t ? (t === 'garage' ? 'bg-orange-500 text-white' : t === 'shed' ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white') : 'text-gray-500 hover:bg-gray-200'}`}
                        >
                          {t === 'house' ? '🏠' : t === 'garage' ? '🏗️' : '🏚️'} {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                    {addingStructureType === 'garage' ? (
                      <div className="bg-orange-50 border border-orange-200 rounded p-2 space-y-2">
                        <p className="text-xs font-semibold text-orange-800">🏗️ Garage Dimensions</p>
                        <div className="flex gap-1 flex-wrap">
                          {[{label:'1-Car',l:12,w:22},{label:'2-Car',l:20,w:22},{label:'3-Car',l:30,w:22}].map(p => (
                            <button key={p.label} onClick={() => { setGarageDimL(p.l); setGarageDimW(p.w); }}
                              className={`text-xs px-2 py-0.5 rounded border transition-colors ${garageDimL===p.l && garageDimW===p.w ? 'bg-orange-500 text-white border-orange-500' : 'bg-white border-orange-300 text-orange-700 hover:bg-orange-100'}`}>
                              {p.label} {p.l}×{p.w}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1 items-center text-xs">
                          <span className="text-orange-700 shrink-0">L:</span>
                          <input type="number" value={garageDimL} onChange={e=>setGarageDimL(Number(e.target.value))} className="w-14 border border-orange-300 rounded px-1 py-0.5 text-center text-xs" />
                          <span className="text-orange-700 shrink-0">ft × W:</span>
                          <input type="number" value={garageDimW} onChange={e=>setGarageDimW(Number(e.target.value))} className="w-14 border border-orange-300 rounded px-1 py-0.5 text-center text-xs" />
                          <span className="text-orange-700 shrink-0">ft</span>
                        </div>
                        <div className="flex gap-1 items-center text-xs">
                          <span className="text-orange-700 shrink-0">Pitch:</span>
                          {['2/12','3/12','4/12','5/12','6/12'].map(p => (
                            <button key={p} onClick={() => setGaragePitch(p)}
                              className={`px-1.5 py-0.5 rounded border text-xs ${garagePitch===p ? 'bg-orange-500 text-white border-orange-500' : 'bg-white border-orange-300 text-orange-700 hover:bg-orange-100'}`}>
                              {p}
                            </button>
                          ))}
                        </div>
                        <Button size="sm" onClick={() => {
                          const [rise, run] = garagePitch.split('/').map(Number);
                          const pitchMultiplier = Math.sqrt(1 + (rise/run)**2);
                          const roofAreaSqFt = garageDimL * garageDimW * pitchMultiplier;
                          const roofAreaSq = roofAreaSqFt / 100;
                          const wallHeight = 10;
                          const perimeter = 2 * (garageDimL + garageDimW);
                          const grossWall = perimeter * wallHeight;
                          const netWall = grossWall * 0.90;
                          const garageAnalysis = {
                            roof_area_sq: Math.round(roofAreaSq * 100) / 100,
                            roof_area_sqft: Math.round(roofAreaSqFt),
                            corrected_area_sq: Math.round(roofAreaSq * 100) / 100,
                            pitch: garagePitch,
                            ridge_lf: Math.round(garageDimL),
                            hip_lf: 0,
                            valley_lf: 0,
                            rake_lf: Math.round(garageDimW * 2),
                            eave_lf: Math.round(garageDimL * 2),
                            step_flashing_lf: 0,
                            apron_flashing_lf: 0,
                            overall_confidence: 95,
                            confidence_grade: 'A',
                            tolerance_pct: 3,
                            analysis_notes: `Garage from dimensions: ${garageDimL}ft × ${garageDimW}ft, ${garagePitch} pitch. Wall area: ${Math.round(netWall)} sqft (10% opening deduction). 8% waste.`,
                            satellite_image_url: null,
                            garage_dim_l: garageDimL,
                            garage_dim_w: garageDimW,
                            wall_area_sqft: Math.round(netWall),
                            perimeter_ft: perimeter,
                            from_dimensions: true,
                          };
                          const structureData = {
                            id: Date.now(),
                            name: `Garage ${analyzedStructures.filter(s=>s.structureType==='garage').length + 1}`,
                            address: satelliteAddress?.address || 'Garage',
                            structureType: 'garage',
                            analysis: garageAnalysis,
                          };
                          setAnalyzedStructures(prev => [...prev, structureData]);
                          setMessages(prev => [...prev, {
                            role: 'assistant',
                            content: `✅ **Garage added from dimensions!**\n\n📐 ${garageDimL}ft × ${garageDimW}ft | ${garagePitch} pitch\n🏗️ Roof: ${roofAreaSq.toFixed(2)} SQ | Wall: ${Math.round(netWall)} sqft\n\nClick **Generate Estimate** when ready.`,
                            timestamp: new Date().toISOString()
                          }]);
                        }} className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs">
                          <Plus className="w-3 h-3 mr-1" /> Calculate & Add Garage
                        </Button>
                        <p className="text-xs text-orange-600 text-center">95% accuracy — or use "Pin on Map" for satellite</p>
                      </div>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowStructureSelector(true);
                        setIsAddingStructure(true);
                        setMessages(prev => [...prev, {
                          role: 'assistant',
                          content: `📍 **Click on the satellite map to drop a pin on the ${addingStructureType} you want to measure.**\n\nThen click "Measure Structures" to analyze it.`,
                          timestamp: new Date().toISOString()
                        }]);
                      }}
                      className="bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      {addingStructureType === 'garage' ? 'Or: Pin Garage on Map (AI)' : `Add ${addingStructureType === 'shed' ? 'Shed' : 'Structure'} (Pin on Map)`}
                    </Button>
                  </div>
                </div>

                {/* ELEVATION VIEWS PANEL */}
                {satelliteAddress?.coordinates && (
                  <div className="border border-blue-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setElevationPanelOpen(p => !p)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg">📷</span>
                        <span className="font-semibold text-blue-900 text-sm">Aerial Views — 45° Oblique Roof Analysis</span>
                        {isLoadingElevation && <span className="text-xs text-blue-500 animate-pulse">Fetching photos…</span>}
                        {isRefiningPitch && <span className="text-xs text-green-500 animate-pulse">AI analyzing pitch…</span>}
                        {elevationImages.filter(i => i.available).length > 0 && !isLoadingElevation && (
                          <Badge className="bg-blue-100 text-blue-800 text-xs border-blue-300 border">
                            {elevationImages.filter(i => i.available).length}/{elevationImages.length} angles
                          </Badge>
                        )}
                        {refinedPitchData && (
                          <Badge className={`text-xs border ${refinedPitchData.confidence === 'high' ? 'bg-green-100 text-green-800 border-green-300' : refinedPitchData.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800 border-yellow-300' : 'bg-gray-100 text-gray-700 border-gray-300'}`}>
                            ✓ Pitch: {refinedPitchData.refinedPitch} ({refinedPitchData.confidence})
                          </Badge>
                        )}
                      </div>
                      <span className="text-blue-600 text-xs">{elevationPanelOpen ? '▲ Hide' : '▼ Show'}</span>
                    </button>

                    {elevationPanelOpen && (
                      <div className="p-4 space-y-4 bg-white">
                        <p className="text-xs text-gray-600">
                          Satellite roof views from 4 compass directions. Use the interactive map above (N/E/S/W + 3D buttons) to see 45° oblique angles.
                        </p>

                        <StreetViewPanel
                          latitude={satelliteAddress?.coordinates?.lat}
                          longitude={satelliteAddress?.coordinates?.lng}
                          address={satelliteAddress?.address}
                          googleMapsLoaded={googleMapsLoaded}
                          onStreetViewReady={async ({ panoId, latitude: lat, longitude: lng, headings, mode }) => {
                            if (mode === "aerial") {
                              // Aerial views are live maps — no static image URLs needed
                              // The oblique 45° views are already visible for manual pitch verification
                              return;
                            }
                            // Street view mode — fetch static image URLs for AI pitch analysis
                            setIsLoadingElevation(true);
                            try {
                              const result = await base44.functions.invoke('getStreetViewImages', {
                                latitude: lat,
                                longitude: lng,
                                address: satelliteAddress?.address,
                                panoId,
                                headings
                              });
                              const data = result?.data || result;
                              if (data?.images) {
                                setElevationImages(data.images);
                                const availableUrls = data.images.filter(i => i.available).map(i => i.imageUrl);

                                if (availableUrls.length > 0 && !refinedPitchData) {
                                  setIsRefiningPitch(true);
                                  try {
                                    const pitchResult = await base44.functions.invoke('refinePitchFromElevation', {
                                      address: satelliteAddress?.address,
                                      currentPitch: satelliteAnalysis?.pitch || 'Unknown',
                                      imageUrls: availableUrls,
                                      currentAnalysis: satelliteAnalysis
                                    });
                                    const pd = pitchResult?.data || pitchResult;
                                    if (pd?.success) {
                                      setRefinedPitchData(pd);
                                      if (pd.shouldUpdate && pd.refinedPitch && pd.refinedPitch !== satelliteAnalysis?.pitch) {
                                        setSatelliteAnalysis(prev => prev ? { ...prev, pitch: pd.refinedPitch } : prev);
                                      }
                                    }
                                  } catch (err) {
                                    console.error('Auto pitch refinement error:', err);
                                  }
                                  setIsRefiningPitch(false);
                                } else if (availableUrls.length === 0 && data.staticApiEnabled === false) {
                                  setElevationImages([{ _staticApiNotEnabled: true, message: data.message }]);
                                }
                              }
                            } catch (err) {
                              console.error('Street view fetch error:', err);
                            }
                            setIsLoadingElevation(false);
                          }}
                        />

                        {/* Static API not enabled notice */}
                        {elevationImages.length > 0 && elevationImages[0]?._staticApiNotEnabled && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                            <p className="text-xs font-semibold text-amber-800">📐 Enable AI Pitch Analysis (one-time setup)</p>
                            <p className="text-xs text-amber-700">
                              The interactive panoramas above are working. To unlock automatic AI pitch verification from street-level photos (like EagleView does), enable the <strong>Street View Static API</strong> in Google Cloud Console:
                            </p>
                            <ol className="text-xs text-amber-700 list-decimal list-inside space-y-0.5">
                              <li>Go to <strong>console.cloud.google.com</strong></li>
                              <li>APIs &amp; Services → Library</li>
                              <li>Search "Street View Static API" → Enable</li>
                              <li>Cost: ~$0.03 per property (4 images × $0.007)</li>
                            </ol>
                            <p className="text-xs text-amber-600">Once enabled, AI pitch analysis runs automatically every time Street View loads.</p>
                          </div>
                        )}

                        {/* Pitch analysis result */}
                        {refinedPitchData && (
                          <div className={`rounded-lg p-3 border ${refinedPitchData.confidence === 'high' ? 'bg-green-50 border-green-200' : refinedPitchData.confidence === 'medium' ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-sm">
                                📐 Pitch from street-level photos: <strong>{refinedPitchData.refinedPitch}</strong>
                              </span>
                              <Badge className={`text-xs ${refinedPitchData.confidence === 'high' ? 'bg-green-100 text-green-800' : refinedPitchData.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>
                                {refinedPitchData.confidence} confidence
                              </Badge>
                            </div>
                            <p className="text-xs text-gray-600">{refinedPitchData.reasoning}</p>
                            {refinedPitchData.skippedPhotos && (
                              <p className="text-xs text-orange-600 mt-1">⚠️ {refinedPitchData.skippedPhotos}</p>
                            )}
                            {refinedPitchData.sectionNotes && (
                              <p className="text-xs text-blue-600 mt-1">📐 {refinedPitchData.sectionNotes}</p>
                            )}
                            {refinedPitchData.previousPitch !== refinedPitchData.refinedPitch && (
                              <p className="text-xs text-green-700 mt-1 font-medium">
                                ✅ Pitch updated: {refinedPitchData.previousPitch} → {refinedPitchData.refinedPitch}
                              </p>
                            )}
                            {refinedPitchData.previousPitch === refinedPitchData.refinedPitch && (
                              <p className="text-xs text-gray-500 mt-1">✓ Street view confirms satellite estimate of {refinedPitchData.refinedPitch}</p>
                            )}
                          </div>
                        )}

                        {/* Loading pitch analysis */}
                        {isRefiningPitch && (
                          <div className="flex items-center gap-2 text-green-700 text-xs bg-green-50 rounded-lg p-3 border border-green-200">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>AI measuring slope angle from street-level photos…</span>
                          </div>
                        )}

                        {/* Manual re-analyze button (shown after auto-run) */}
                        {elevationImages.filter(i => i.available).length > 0 && !isRefiningPitch && (
                          <div className="flex gap-2">
                            <Button
                              data-testid="btn-refine-pitch"
                              size="sm"
                              variant="outline"
                              disabled={isRefiningPitch}
                              onClick={async () => {
                                setIsRefiningPitch(true);
                                try {
                                  const availableUrls = elevationImages.filter(i => i.available).map(i => i.imageUrl);
                                  const result = await base44.functions.invoke('refinePitchFromElevation', {
                                    address: satelliteAddress?.address,
                                    currentPitch: satelliteAnalysis?.pitch || 'Unknown',
                                    imageUrls: availableUrls,
                                    currentAnalysis: satelliteAnalysis
                                  });
                                  const pd = result?.data || result;
                                  if (pd?.success) {
                                    setRefinedPitchData(pd);
                                    if (pd.shouldUpdate && pd.refinedPitch && pd.refinedPitch !== satelliteAnalysis?.pitch) {
                                      setSatelliteAnalysis(prev => prev ? { ...prev, pitch: pd.refinedPitch } : prev);
                                    }
                                  }
                                } catch (err) {
                                  console.error('Pitch refinement error:', err);
                                }
                                setIsRefiningPitch(false);
                              }}
                              className="text-xs"
                            >
                              🎯 Re-analyze Pitch
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-gray-500"
                              onClick={() => { setElevationImages([]); setRefinedPitchData(null); }}
                            >
                              ↺ Reset
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {!currentEstimate && (
                  <>
                    <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border-2 border-purple-200">
                      <Label className="text-sm font-semibold mb-2 block">{t.estimates.selectRoofType}</Label>
                      <div className="grid grid-cols-3 gap-2">
                        <Button
                          variant={roofTypeSelection === 'shingles' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setRoofTypeSelection('shingles')}
                          className={roofTypeSelection === 'shingles' ? 'bg-blue-600' : ''}
                        >
                          🏠 {t.estimates.shingles}
                        </Button>
                        <Button
                          variant={roofTypeSelection === 'metal' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setRoofTypeSelection('metal')}
                          className={roofTypeSelection === 'metal' ? 'bg-orange-600' : ''}
                        >
                          🔩 {t.estimates.metalRoof}
                        </Button>
                        <Button
                          variant={roofTypeSelection === 'flat' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setRoofTypeSelection('flat')}
                          className={roofTypeSelection === 'flat' ? 'bg-gray-600' : ''}
                        >
                          🏢 {t.estimates.flatRoof}
                        </Button>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleGenerateCombinedEstimate}
                      disabled={isSatelliteAnalyzing}
                      className="w-full bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 disabled:opacity-50"
                    >
                      {isSatelliteAnalyzing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-1" />
                          {analyzedStructures.length > 1 || manualMeasurements.length > 0 ? 'Generate Combined Estimate' : 'Generate Estimate'}
                        </>
                      )}
                    </Button>
                  </>
                )}

                {currentEstimate && (
                  <Button
                    size="sm"
                    onClick={handleRegenerateWithGutters}
                    variant="outline"
                    className="w-full border-blue-500 text-blue-700 hover:bg-blue-50"
                  >
                    🔄 Regenerate Estimate
                  </Button>
                )}
              </div>

              {currentEstimate && lineItems.length > 0 && (
                <div className="mt-3 pt-3 border-t border-orange-200">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setUseManualDrawing(true);
                        setSatelliteAnalysis(null);
                        setAnalyzedStructures([]);
                        setLineItems([]);
                        setCurrentEstimate(null);
                        setManualMeasurements([]);
                        setManualAddOnMode(false);
                      }}
                      className="w-full border-orange-400 text-orange-700 hover:bg-orange-100"
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      {t.estimates.switchToManualDrawing}
                    </Button>
                  </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* NEW: Structure Selector for Additional Structures */}
      {showStructureSelector && satelliteAddress && (
        <Card className="bg-white shadow-lg">
          <CardHeader className="bg-gradient-to-r from-purple-600 to-blue-600 text-white">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Select Additional Structure at {satelliteAddress.address}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <StructureSelector
              latitude={satelliteAddress.coordinates.lat}
              longitude={satelliteAddress.coordinates.lng}
              address={satelliteAddress.address}
              googleMapsLoaded={googleMapsLoaded}
              existingStructuresCount={analyzedStructures.length}
              onStructureSelect={async (coordsArray) => {
                if (!Array.isArray(coordsArray) || coordsArray.length === 0) {
                  alert('No structures selected');
                  return;
                }

                setShowStructureSelector(false);
                setIsSatelliteAnalyzing(true);

                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `🤖 **AI is analyzing ${coordsArray.length} structure${coordsArray.length > 1 ? 's' : ''}...**\n\n⏱️ This takes 30-60 seconds per structure...`,
                  timestamp: new Date().toISOString()
                }]);

                try {
                  const newStructures = [];

                  for (let i = 0; i < coordsArray.length; i++) {
                    const coords = coordsArray[i];

                    console.log(`Analyzing structure ${i + 1}/${coordsArray.length}:`, coords);

                    const response = await base44.functions.invoke('aiRoofMeasurement', {
                      latitude: coords.lat,
                      longitude: coords.lng,
                      address: satelliteAddress.address
                    });

                    if (!response.data.success) {
                      throw new Error(response.data.error || 'Failed to analyze structure');
                    }

                    const analysis = {
                      roof_area_sq: response.data.roof_area_sq,
                      roof_area_sqft: response.data.roof_area_sqft,
                      ridge_lf: response.data.ridge_lf,
                      hip_lf: response.data.hip_lf,
                      valley_lf: response.data.valley_lf,
                      rake_lf: response.data.rake_lf,
                      eave_lf: response.data.eave_lf,
                      step_flashing_lf: response.data.step_flashing_lf,
                      apron_flashing_lf: response.data.apron_flashing_lf,
                      pitch: response.data.pitch,
                      is_flat_roof: response.data.is_flat_roof || false,
                      satellite_image_url: response.data.satellite_image_url,
                      overall_confidence: response.data.overall_confidence || 100,
                      ridge_confidence: response.data.ridge_confidence || 100,
                      hip_confidence: response.data.hip_confidence || 100,
                      valley_confidence: response.data.valley_confidence || 100,
                      rake_confidence: response.data.rake_confidence || 100,
                      eave_confidence: response.data.eave_confidence || 100,
                      step_flashing_confidence: response.data.step_flashing_confidence || 100,
                      analysis_notes: response.data.analysis_notes || null,
                    };

                    const typeLabel = addingStructureType === 'garage' ? 'Garage' : addingStructureType === 'shed' ? 'Shed' : 'Structure';
                    const structureData = {
                      id: Date.now() + i,
                      name: `${typeLabel} ${analyzedStructures.length + newStructures.length + 1}`,
                      address: satelliteAddress.address,
                      structureType: addingStructureType,
                      analysis: analysis
                    };

                    newStructures.push(structureData);

                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: `✅ **Analyzed ${structureData.name}!** (${i + 1}/${coordsArray.length})\n\n📊 ${analysis.roof_area_sq.toFixed(2)} SQ • Pitch: ${analysis.pitch}`,
                      timestamp: new Date().toISOString()
                    }]);
                  }

                  // Add all new structures at once
                  setAnalyzedStructures(prev => [...prev, ...newStructures]);

                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `🎉 **All ${coordsArray.length} structures analyzed!**\n\n💡 Click "Generate Combined Estimate" to create estimate with all measurements.`,
                    timestamp: new Date().toISOString()
                  }]);

                } catch (error) {
                  console.error('Structure analysis error:', error);
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `❌ **Error analyzing structures:** ${error.message}`,
                    timestamp: new Date().toISOString()
                  }]);
                }

                setIsSatelliteAnalyzing(false);
              }}
              onCancel={() => {
                setShowStructureSelector(false);
                setIsAddingStructure(false); // Reset this flag if cancelled
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `Cancelled adding structure.`,
                  timestamp: new Date().toISOString()
                }]);
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Manual Drawing Mode - Enhanced for Add-On */}
      {(useManualDrawing || manualAddOnMode) && satelliteAddress && googleMapsLoaded && (
        <Card className="bg-white shadow-lg">
          <CardHeader className="bg-gradient-to-r from-green-600 to-blue-600 text-white">
            <CardTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5" />
              {manualAddOnMode ? 'Manual Add-On: Draw Additional Structures' : t.estimates.manualDrawingMode}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {manualAddOnMode && satelliteAnalysis && (
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-900 font-medium mb-2">
                  ℹ️ AI already measured {analyzedStructures.reduce((sum, s) => sum + s.analysis.roof_area_sq, 0).toFixed(2)} SQ (across {analyzedStructures.length} structures)
                </p>
                <p className="text-xs text-blue-700">
                  Draw polygons for structures the AI missed (e.g., small detached sheds, porch roofs, patio covers). Your measurements will be combined automatically.
                </p>
              </div>
            )}

            <InteractiveRoofMap
              latitude={satelliteAddress.coordinates.lat}
              longitude={satelliteAddress.coordinates.lng}
              address={satelliteAddress.address}
              crewCamPhotoCount={linkedJobMedia.length}
              onMeasurementsComplete={(measurements) => {
                if (manualAddOnMode) {
                  // Add to manual measurements array
                  setManualMeasurements(prev => [...prev, {
                    id: Date.now(),
                    name: `Manual ${prev.length + 1}`,
                    ...measurements
                  }]);

                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `✅ **Manual measurement added!**\n\n📊 +${measurements.roof_area_sq.toFixed(2)} SQ added to AI measurements\n\n💡 Draw more structures or click "Done" to see combined estimate.`,
                    timestamp: new Date().toISOString()
                  }]);

                  // Don't close, let them add more
                } else {
                  // Original manual mode behavior (for the first structure)
                  const analysis = {
                    ...measurements,
                    pitch: measurements.pitch || '7/12',
                    satellite_image_url: null,
                    overall_confidence: 100,
                    analysis_notes: 'Measurements drawn manually by user'
                  };

                  const structureData = {
                    id: Date.now(),
                    name: isAddingStructure ? `Structure ${analyzedStructures.length + 1} (Manual)` : "Main Structure (Manual)",
                    address: satelliteAddress.address,
                    analysis: analysis
                  };

                  if (isAddingStructure) {
                    setAnalyzedStructures(prev => [...prev, structureData]);
                    setSatelliteAnalysis(null); // Clear main analysis to indicate it's part of multi-structure
                    setIsAddingStructure(false);
                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: `✅ **Added ${structureData.name} (${analysis.roof_area_sq.toFixed(2)} SQ)!**\n\n💡 Add another structure or click "Generate Estimate" to combine all measurements.`,
                      timestamp: new Date().toISOString()
                    }]);
                  } else {
                    setAnalyzedStructures([structureData]);
                    setSatelliteAnalysis(analysis); // For display of first structure
                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: `✅ **Added ${structureData.name} (${analysis.roof_area_sq.toFixed(2)} SQ)!**\n\nReview the measurements, add gutters, or add more structures. When ready, click "Generate Estimate".`,
                      timestamp: new Date().toISOString()
                    }]);
                  }
                  setUseManualDrawing(false); // Close map after initial manual drawing
                }
              }}
              onBack={() => {
                if (manualAddOnMode) {
                  setManualAddOnMode(false);
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `Cancelled manual add-on.`,
                    timestamp: new Date().toISOString()
                  }]);
                } else {
                  setUseManualDrawing(false); // Original behavior for initial manual drawing
                  setAnalyzedStructures([]); // Clear structures if backing out of initial manual draw
                  setSatelliteAnalysis(null);
                }
              }}
              googleMapsLoaded={googleMapsLoaded}
            />

            {manualAddOnMode && (
              <div className="mt-4 flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setManualAddOnMode(false);
                    setManualMeasurements([]); // Clear all manual add-on measurements
                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: `Manual add-on cancelled.`,
                      timestamp: new Date().toISOString()
                    }]);
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setManualAddOnMode(false);
                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: `✅ **Manual add-on complete!**\n\nCombined measurements ready. Click "Generate Estimate" below.`,
                      timestamp: new Date().toISOString()
                    }]);
                  }}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  Done Adding Manual
                </Button>
              </div>
            )}

            {manualMeasurements.length > 0 && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-semibold text-green-900 mb-2">
                  Manual Measurements Added:
                </p>
                {manualMeasurements.map((m, idx) => (
                  <div key={m.id} className="text-xs text-green-700 flex items-center justify-between">
                    <span>• {m.name}: {m.roof_area_sq.toFixed(2)} SQ</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setManualMeasurements(prev => prev.filter(item => item.id !== m.id))}
                      className="h-6 px-2 text-red-600 hover:text-red-700"
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <div className="mt-2 pt-2 border-t border-green-300">
                  <p className="text-sm font-bold text-green-900">
                    Total Manual: {manualMeasurements.reduce((sum, m) => sum + m.roof_area_sq, 0).toFixed(2)} SQ
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
    );
  }
  