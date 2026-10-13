import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import heic2any from 'heic2any';
import { base44 } from '@/api/base44Client';
import { BulkDeleteButton } from '@/components/BulkDeleteControls';
import { photoSyncClientName } from '@/utils/photoSyncCustomerName';
import { useUploadQueue } from '@/context/UploadQueueContext';
import useRoleBasedData from "@/components/hooks/useRoleBasedData";
import { useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl, compressImage } from '@/utils';
import { getPhotoShareEmailOutcome } from '@/utils/photoShareEmailOutcome';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Camera, Loader2, Image as ImageIcon, Trash2, FileText, Edit, CheckCircle, Save, Pen, Pencil, Upload, Send, Mail, Link as LinkIcon, ExternalLink, AlertCircle, Eye, Sparkles, Zap, Download, XCircle, X, Archive, FolderOpen, Square, Mic, ShieldCheck, ShieldAlert, ShieldX, ChevronDown, ChevronUp, CheckCircle2, Ruler, ZoomIn, ZoomOut, Package, MapPin, Phone, Navigation, Move, Copy, Banknote } from 'lucide-react';
import PhotoMeasureTool from '../components/inspections/PhotoMeasureTool';
import PhotoDrawingCanvas from '../components/inspections/PhotoDrawingCanvas';
import SimplePhotoMarkup from '../components/inspections/SimplePhotoMarkup';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import LiveCameraCapture from '../components/inspections/LiveCameraCapture';
import ProofPackageModal from '../components/inspections/ProofPackageModal';
import { annotateImage, drawTestSquares } from '@/components/inspections/ImageAnnotation';
import AerialSquareEditor from '@/components/inspections/AerialSquareEditor';
import { LeadNameMismatchWarning, LeadContactMismatchWarning, CustomerContactMismatchWarning } from '@/components/inspections/InspectionPill';
import SignaturePad from '../components/SignaturePad';
import VoiceNoteButton from '../components/VoiceNoteButton';
import AssignmentDialog from '../components/inspections/AssignmentDialog';
import LinkStormDialog from '../components/inspections/LinkStormDialog';
import { Badge } from '@/components/ui/badge';
import SafeImage from '@/components/ui/SafeImage';
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { getTranslations, getStoredLanguage, setStoredLanguage } from '@/utils/translations';
import { toast } from 'sonner';
import { checkPhotoQuality } from '@/utils/photoQualityCheck';
import { createReportImageQueue } from '@/utils/inspectionReportImages';
import { summarizePhotoSyncDamage } from '@/utils/photoSyncDamageSummary.mjs';

const sections = [
    'Overhead / Aerial',
    'Front Elevation', 'Right Elevation', 'Rear Elevation', 'Left Elevation',
    'Front Slope', 'Right Slope', 'Back Slope', 'Left Slope',
    'North Slope', 'South Slope', 'East Slope', 'West Slope', 'Garage',
    'Siding', 'Gutters', 'Window Seals', 'Soft Metals', 'Interior', 'Other'
];
const PHOTO_DAMAGE_MATERIALS = [
    ['roof_shingle', 'Roof shingles'],
    ['metal_roof', 'Metal roofing'],
    ['siding_aluminum', 'Aluminum siding'],
    ['siding_steel', 'Steel siding'],
    ['siding_vinyl', 'Vinyl siding'],
    ['siding_fiber_cement', 'Fiber-cement siding'],
    ['siding_wood', 'Wood siding'],
    ['gutter_downspout', 'Gutter / downspout'],
    ['vent_soft_metal', 'Vent / soft metal'],
    ['window_wrap', 'Window wrap'],
    ['soft_metal', 'Other soft metal'],
    ['brick_stone', 'Brick / stone'],
    ['interior_ceiling', 'Interior ceiling'],
    ['interior_wall', 'Interior wall'],
    ['other', 'Other material'],
];
const PHOTO_TYPES = ['Overview', 'Test Square', 'Close-up'];
const isNamedDamageSection = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return !!normalized && !['all photos', 'other', 'unknown', 'general', 'needs section', 'unsorted'].includes(normalized);
};
const chooseDamageSection = (primary, fallback) => {
    if (isNamedDamageSection(primary)) return String(primary).trim();
    if (isNamedDamageSection(fallback)) return String(fallback).trim();
    return 'Needs Section';
};
const PHOTO_GALLERY_BATCH_SIZE = 100;

// ─── Claims Defense / Technical Evidence ─────────────────────────────────────
import {
    TRIGGER_KEYWORDS,
    TECH_EVIDENCE_SECTIONS,
    detectTriggeredKeywords,
    isEvidenceBlocked as computeIsEvidenceBlocked,
    isTechEvidenceComplete as computeIsTechEvidenceComplete,
} from '@/lib/evidenceGate';

// Small upload card for each required evidence type
function TechEvidenceUpload({ label, description, required, photos, section, jobId, uploadMutation, onUploaded }) {
    const fileInputRef = React.useRef(null);
    const isComplete = photos.length >= required;
    const handleFiles = (files) => {
        Array.from(files).forEach(file => {
            uploadMutation.mutate(
                { file, section, caption: label, targetJobId: jobId, skipAI: true },
                { onSuccess: () => onUploaded?.() }
            );
        });
    };
    return (
        <div className={`rounded-lg border p-3 transition-colors ${isComplete ? 'border-green-300 bg-green-50' : 'border-red-200 bg-white'}`}>
            <div className="flex items-center justify-between mb-1.5">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800">{label}</span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full border ${isComplete ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'}`}>
                            {photos.length}/{required}
                        </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                        onChange={(e) => e.target.files?.length && handleFiles(e.target.files)} />
                    <button
                        className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md font-medium transition-colors ${isComplete ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-red-600 hover:bg-red-700 text-white'}`}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadMutation.isPending}
                    >
                        <Camera className="w-3 h-3" />
                        {isComplete ? 'Add More' : 'Upload'}
                    </button>
                </div>
            </div>
            {photos.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                    {photos.slice(0, 6).map(p => (
                        <div key={p.id} className="w-14 h-10 rounded overflow-hidden border border-gray-200 bg-gray-100">
                            <img src={p.file_url} alt={label} className="w-full h-full object-cover" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
// ─────────────────────────────────────────────────────────────────────────────

const detectSectionFromFilename = (filename) => {
    if (!filename) return null;
    const lower = filename.toLowerCase().replace(/[_\-\s]+/g, ' ');
    if (/overhead|aerial|drone|bird.?s.?eye|top.?down/.test(lower)) return 'Overhead / Aerial';
    if (/front elevation|front elev|frontelevation/.test(lower)) return 'Front Elevation';
    if (/rear elevation|back elevation|rear elev|back elev|rearelevation|backelevation/.test(lower)) return 'Rear Elevation';
    if (/right elevation|right elev|rightelevation/.test(lower)) return 'Right Elevation';
    if (/left elevation|left elev|leftelevation/.test(lower)) return 'Left Elevation';
    if (/front slope|frontslope/.test(lower)) return 'Front Slope';
    if (/rear slope|back slope|rearslope|backslope/.test(lower)) return 'Back Slope';
    if (/right slope|rightslope/.test(lower)) return 'Right Slope';
    if (/left slope|leftslope/.test(lower)) return 'Left Slope';
    if (/\bsiding\b|side wall|sidewall/.test(lower)) return 'Siding';
    if (/\bgutter(s)?\b|gutter line/.test(lower)) return 'Gutters';
    if (/window seal(s)?|window(s)?/.test(lower)) return 'Window Seals';
    if (/soft metal(s)?|step flash|cap flash|\bflashing\b|valley metal/.test(lower)) return 'Soft Metals';
    if (/\binterior\b|\binside\b|\battic\b|\bceiling\b/.test(lower)) return 'Interior';
    return null;
};

const getCoverageVerdict = (verdict) => {
    const map = {
        covered: { label: 'Covered', icon: ShieldCheck, bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', iconColor: 'text-green-600' },
        mixed: { label: 'Mixed', icon: ShieldAlert, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', iconColor: 'text-amber-500' },
        not_covered: { label: 'Not Covered', icon: ShieldX, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', iconColor: 'text-red-600' }
    };
    return map[verdict] || map.mixed;
};

const getQualityBarColor = (score) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 55) return 'bg-yellow-500';
    return 'bg-red-500';
};

// ─── Aerial / Overhead Test-Square Analysis ─────────────────────────────────
// Runs the section-detection AI on an overhead drone photo and draws labeled
// 10'×10' test squares on each detected roof slope. Returns { analysisData, annotatedUrl }.
const runAerialTestSquares = async (fileUrl, address) => {
  const aerialPrompt = `You are an expert roofing inspector analyzing an OVERHEAD DRONE PHOTO of a roof.

**PROPERTY:** ${address || 'Unknown'}

**STEP 1 — Identify roof sections:**
For each visible slope, return:
- name: e.g. "North Slope", "South Slope", "East Slope", "West Slope"
- direction: N, S, E, W, NE, NW, SE, SW, Front, Back, Left, or Right
- box_2d: bounding box [ymin, xmin, ymax, xmax] on 0-1000 scale enclosing the full slope
- center_x, center_y: recommended 10'×10' test-square CENTER on that slope (0-1000 scale)
  - Place 4–8 ft from ridgeline, hip, valley, and all edges
  - Must be within the box_2d bounds

**STEP 2 — Determine direction:**
- Street-facing side = Front (typically South)
- Use driveway, yard, shadows as clues

**STEP 3 — Estimate scale:**
Count shingle courses from eave to ridge on the largest slope.
- Standard shingle: ~5.5" exposure per course
- pixels_per_foot = (slope_height_in_1000_units × 12) / (course_count × 5.5)

Return JSON with sections, pixels_per_foot (0-1000 normalized), scale_note, and description.`;

  const analysis = await base44.integrations.Core.InvokeLLM({
    prompt: aerialPrompt,
    file_urls: [fileUrl],
    response_json_schema: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name:      { type: "string" },
              direction: { type: "string" },
              box_2d:    { type: "array", items: { type: "number" } },
              center_x:  { type: "number" },
              center_y:  { type: "number" }
            }
          }
        },
        pixels_per_foot: { type: "number" },
        scale_note:      { type: "string" },
        description:     { type: "string" }
      }
    }
  });

  // Validate + clamp section data
  const rawSections = Array.isArray(analysis.sections) ? analysis.sections : [];
  const validSections = rawSections
    .filter(s => s && typeof s.center_x === 'number' && typeof s.center_y === 'number')
    .map(s => ({
      ...s,
      center_x: Math.max(0, Math.min(1000, s.center_x)),
      center_y: Math.max(0, Math.min(1000, s.center_y)),
      box_2d: Array.isArray(s.box_2d) && s.box_2d.length === 4
        ? s.box_2d.map(v => Math.max(0, Math.min(1000, v))) : null
    }));

  const normPpf = (analysis.pixels_per_foot && analysis.pixels_per_foot > 0) ? analysis.pixels_per_foot : 20;

  // Draw test squares + upload annotated image
  let annotatedUrl = null;
  if (validSections.length > 0) {
    try {
      const blob = await drawTestSquares(fileUrl, validSections, normPpf, analysis.scale_note || 'AI estimated');
      const file = new File([blob], `aerial_test_squares_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const upload = await base44.integrations.Core.UploadFile({ file });
      annotatedUrl = upload.file_url;
    } catch (err) {
      console.error('Aerial test square drawing failed:', err);
    }
  }

  const sectionNames = validSections.map(s => s.name).filter(Boolean);
  const analysisData = {
    damage_types: [],
    severity: 'none',
    has_hail_damage: false,
    has_wind_damage: false,
    hail_hits_counted: 0,
    wind_marks_counted: 0,
    description: analysis.description || 'Overhead aerial — test squares drawn',
    insurance_recommended: false,
    roof_section: 'Overhead / Aerial',
    shingle_type: 'unknown',
    shingle_exposure_inches: 0,
    shingle_width_inches: 0,
    likely_discontinued: false,
    detections: [],
    coverage_verdict: 'unknown',
    ai_notes: `Detected sections: ${sectionNames.join(', ') || 'none'}. Scale: ${analysis.scale_note || 'AI estimated'}.`,
    detected_sections: validSections,
    pixels_per_foot: normPpf,
    scale_note: analysis.scale_note || 'AI estimated'
  };

  return { analysisData, annotatedUrl };
};
// ─────────────────────────────────────────────────────────────────────────────

export default function InspectionCapture() {
    const isPageVisible = usePageVisibility();
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();

    // Refresh the sidebar assignment badge when leaving the inspection screen so the
    // open-task count stays accurate without waiting for the 30-second poll interval.
    useEffect(() => {
        return () => {
            queryClient.invalidateQueries({ queryKey: ["my-assignments-tasks"] });
            queryClient.invalidateQueries({ queryKey: ["my-assignments-leads"] });
            queryClient.invalidateQueries({ queryKey: ["my-assignments-projects"] });
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    
    const { user, myCompany, isAdmin, hasPermission, isPermissionsReady, effectiveUserEmail } = useRoleBasedData();
    const { enqueueFiles, status: uploadQueueStatus, pause: pauseUploadQueue, resume: resumeUploadQueue, stop: stopUploadQueue, progress: uploadQueueProgress } = useUploadQueue();

    const [jobId, setJobId] = useState(null);
    const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 768;
    const [activeSection, setActiveSection] = useState('All Photos');
    const [galleryWindow, setGalleryWindow] = useState({ key: null, count: PHOTO_GALLERY_BATCH_SIZE });
    const [isSecureContext, setIsSecureContext] = useState(false);
    const [sectionNotes, setSectionNotes] = useState({});
    const [allPhotosNotesSection, setAllPhotosNotesSection] = useState(sections[0]);
    const [isExporting, setIsExporting] = useState(false);
    const [isViewing, setIsViewing] = useState(false);
    const [reportBuildProgress, setReportBuildProgress] = useState('');
    const [showPdfPreview, setShowPdfPreview] = useState(false);
    const [previewPdfUrl, setPreviewPdfUrl] = useState(null);
    const [selectedPhotos, setSelectedPhotos] = useState([]);
    const [rangeAnchor, setRangeAnchor] = useState(null);
    const [photoContextMenu, setPhotoContextMenu] = useState({ visible: false, x: 0, y: 0 });
    const [downloadingZip, setDownloadingZip] = useState(false);
    const [downloadingIndividual, setDownloadingIndividual] = useState(null);
    const [showMoveSectionDialog, setShowMoveSectionDialog] = useState(false);
    const [moveSectionTarget, setMoveSectionTarget] = useState('');
    const [showBulkEditDialog, setShowBulkEditDialog] = useState(false);
    const [bulkCaption, setBulkCaption] = useState('');
    const [showSignatureDialog, setShowSignatureDialog] = useState(false);
    const [inspectorSignature, setInspectorSignature] = useState('');
    const [language, setLanguage] = useState(() => getStoredLanguage());
    const t = {
        ...getTranslations(language).common,
        ...getTranslations(language).inspections
    };
    const translateSection = (sectionName) => {
        if (!sectionName) return sectionName;
        return (t.sectionNames && t.sectionNames[sectionName]) || sectionName;
    };
    const handleLanguageChange = (lang) => {
        setStoredLanguage(lang);
        setLanguage(lang);
    };
    const [scopeOfWork, setScopeOfWork] = useState('');
    const [reportNotes, setReportNotes] = useState('');
    const [reportNotesAutoSaved, setReportNotesAutoSaved] = useState(false);
    const [generatingSow, setGeneratingSow] = useState(false);
    const [sowAutoSaved, setSowAutoSaved] = useState(false);
    const [guidedModeActive, setGuidedModeActive] = useState(false);
    const [showPostGuidedAlert, setShowPostGuidedAlert] = useState(false);
    const [lastVoiceNote, setLastVoiceNote] = useState(null); // most recent voice note for in-situ feedback
    const [skipAiAnalysis, setSkipAiAnalysis] = useState(true);
    const [compressBeforeUpload, setCompressBeforeUpload] = useState(true);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [isSendingReport, setIsSendingReport] = useState(false);
    const sendReportInFlightRef = useRef(false);
    const retryReportRef = useRef(null);
    const [sendingStatus, setSendingStatus] = useState('');
    const [reportRecipients, setReportRecipients] = useState({
        sendToClient: true,
        sendToAdjuster: false,
        adjusterEmail: '',
        sendToProductionManager: false,
        productionManagerEmail: '',
        sendToSalesRep: false,
        sendToCustomEmails: false,
        customEmails: ''
    });
    const [showLinkEstimateDialog, setShowLinkEstimateDialog] = useState(false);
    const [selectedEstimateId, setSelectedEstimateId] = useState(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [showTemplateDialog, setShowTemplateDialog] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState('default');
    const [itelStatus, setItelStatus] = useState('none');
    const [applyStateCode, setApplyStateCode] = useState(false);
    const [detectedState, setDetectedState] = useState(null);
    const [testingEmail, setTestingEmail] = useState(false);
    const [showLinkStormDialog, setShowLinkStormDialog] = useState(false);
    const [isReanalyzing, setIsReanalyzing] = useState(false);
    const [isClearingAllAI, setIsClearingAllAI] = useState(false);
    const [reanalyzingPhotoId, setReanalyzingPhotoId] = useState(null);
    const [drawingPhoto, setDrawingPhoto] = useState(null); // {id, file_url, section}
    const [markupPhoto, setMarkupPhoto] = useState(null);  // {id, file_url} for SimplePhotoMarkup
    const [inlineEdit, setInlineEdit] = useState({ id: null, field: null, value: '' });
    const [isDrawAnalyzing, setIsDrawAnalyzing] = useState(false);
    const [showPhotoDetailDialog, setShowPhotoDetailDialog] = useState(false);
    const [editingPhoto, setEditingPhoto] = useState(null);
    const [lightboxUrl, setLightboxUrl] = useState(null);
    const [lightboxKey, setLightboxKey] = useState(0);
    const [lightboxZoom, setLightboxZoom] = useState(1);
    const [lightboxOffset, setLightboxOffset] = useState({ x: 0, y: 0 });
    const lightboxDragRef = useRef(null);
    const lightboxContainerRef = useRef(null);
    const lightboxPinchRef = useRef(null);
    const [showMeasureTool, setShowMeasureTool] = useState(false);
    const [measureTargetPhoto, setMeasureTargetPhoto] = useState(null);
    const [aerialEditorPhoto, setAerialEditorPhoto] = useState(null);
    const [editFormData, setEditFormData] = useState({
        caption: '',
        description: '',
        hail_hits_counted: 0,
        wind_marks_counted: 0,
        missing_shingles_counted: 0,
        severity: 'none',
        ai_notes: '',
        inspector_correction: ''
    });
    const [photoQualityWarning, setPhotoQualityWarning] = useState(null); // { flaggedItems:[{file,reasons}], proceedFn }
    const [showSharePhotosDialog, setShowSharePhotosDialog] = useState(false);
    const [showProofPackage, setShowProofPackage] = useState(false);
    const [inspectionType, setInspectionType] = useState('insurance'); // 'insurance' | 'retail'
    const [triggeredKeywords, setTriggeredKeywords] = useState([]);
    const [showEvidenceBlockedModal, setShowEvidenceBlockedModal] = useState(false);
    const prevTriggeredCountRef = React.useRef(0);
    const [shareEmail, setShareEmail] = useState('');
    const [isSharingPhotos, setIsSharingPhotos] = useState(false);
    const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false);
    const [roofAccessories, setRoofAccessories] = useState({
        vents: 0, pipe_boots: 0, chimneys: 0, drip_edge: null, ice_guard: null
    });
    useEffect(() => {
        setIsSecureContext(window.isSecureContext);
        const params = new URLSearchParams(location.search);
        const id = params.get('jobId') || params.get('id');
        if (id) {
            setJobId(id);
        }
    }, [location.search]);

    const { data: job, isLoading: isLoadingJob } = useQuery({
        queryKey: ['inspectionJob', jobId],
        queryFn: () => base44.entities.InspectionJob.get(jobId),
        enabled: !!jobId,
    });
    const { data: linkedCustomer, isError: linkedCustomerError } = useQuery({
        queryKey: ['photoSyncCustomer', job?.related_customer_id, myCompany?.id],
        queryFn: async () => {
            const customer = await base44.entities.Customer.get(job.related_customer_id);
            if (customer?.company_id !== myCompany.id) throw new Error('Linked customer belongs to a different company');
            return customer;
        },
        enabled: !!job?.related_customer_id && job?.company_id === myCompany?.id,
        retry: false,
    });
    const currentClientName = photoSyncClientName(job, linkedCustomer, myCompany?.id);

    // Load notes and other data when job changes
    useEffect(() => {
        if (job) {
            if (job.notes) {
                try {
                    const parsedNotes = JSON.parse(job.notes);
                    setSectionNotes(parsedNotes);
                } catch (e) {
                    setSectionNotes({ [sections[0]]: job.notes });
                }
            }
            if (job.inspector_signature) {
                setInspectorSignature(job.inspector_signature);
            }
            if (job.client_email) {
                setReportRecipients(prev => ({ ...prev, sendToClient: true }));
            } else {
                // No client email on this job — default to Production Manager so
                // the "Generate & Send" button is immediately usable and the
                // server auto-resolves to the first admin/PM on the account.
                setReportRecipients(prev => ({
                    ...prev,
                    sendToClient: false,
                    sendToProductionManager: true,
                }));
            }
            if (job.related_estimate_id) {
                setSelectedEstimateId(job.related_estimate_id);
            }
            if (job.scope_of_work) {
                setScopeOfWork(job.scope_of_work);
            }
            if (job.report_notes) {
                setReportNotes(job.report_notes);
            }
            if (job.roof_accessories) {
                try {
                    const parsed = typeof job.roof_accessories === 'string' ? JSON.parse(job.roof_accessories) : job.roof_accessories;
                    setRoofAccessories(prev => ({ ...prev, ...parsed }));
                } catch (e) { /* ignore */ }
            }
        }
    }, [job]);

    useEffect(() => {
        if (!job?.property_address || googleMapsLoaded) return;
        const loadMaps = async () => {
            try {
                if (window.google?.maps?.drawing) {
                    setGoogleMapsLoaded(true);
                } else {
                    const response = await base44.functions.invoke('getGoogleMapsApiKey');
                    const apiKey = response?.data?.apiKey || response?.apiKey;
                    if (!apiKey) return;
                    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
                    if (existing) existing.remove();
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
                        script.async = true;
                        script.onload = () => {
                            const check = setInterval(() => {
                                if (window.google?.maps?.Map) { clearInterval(check); resolve(); }
                            }, 50);
                            setTimeout(() => { clearInterval(check); reject(new Error('timeout')); }, 15000);
                        };
                        script.onerror = () => reject(new Error('Maps load failed'));
                        document.head.appendChild(script);
                    });
                    setGoogleMapsLoaded(true);
                }
            } catch (e) {
                console.error('Maps load error:', e);
            }
        };
        loadMaps();
    }, [job?.property_address, googleMapsLoaded]);

    const { data: users = [] } = useQuery({
        queryKey: ['users'],
        queryFn: () => base44.entities.User.list(),
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const { data: media = [], isLoading: isLoadingMedia } = useQuery({
        queryKey: ['inspectionMedia', jobId],
        queryFn: () => jobId ? base44.entities.JobMedia.filter({ related_entity_id: jobId, related_entity_type: 'InspectionJob' }, '-created_date', 5000) : [],
        enabled: !!jobId,
        staleTime: 5 * 60 * 1000,
        // Upload/delete mutations invalidate this query. Respect its freshness
        // window on remount instead of repeatedly loading up to 5,000 photos.
        refetchOnWindowFocus: false,
        placeholderData: (prev) => prev,
    });

    const sectionPhotoCount = media.reduce((acc, m) => {
        if (m.section) acc[m.section] = (acc[m.section] || 0) + 1;
        return acc;
    }, {});

    const handleGuidedModeChange = (isActive) => {
        setGuidedModeActive(isActive);
        if (!isActive) {
            setShowPostGuidedAlert(true);
        }
    };

    const { data: estimates = [] } = useQuery({
        queryKey: ['estimates', myCompany?.id],
        queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, '-created_date', 100) : [],
        enabled: !!myCompany,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const { data: linkedEstimate } = useQuery({
        queryKey: ['linkedEstimate', job?.related_estimate_id],
        queryFn: () => job?.related_estimate_id ? base44.entities.Estimate.get(job.related_estimate_id) : null,
        enabled: !!job?.related_estimate_id,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const { data: linkedStorm } = useQuery({
        queryKey: ['linkedStorm', job?.related_storm_event_id],
        queryFn: () => job?.related_storm_event_id ? base44.entities.StormEvent.get(job.related_storm_event_id) : null,
        enabled: !!job?.related_storm_event_id,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const { data: reportTemplates = [] } = useQuery({
        queryKey: ['report-templates', myCompany?.id],
        queryFn: () => myCompany ? base44.entities.InspectionReportTemplate.filter({ is_active: true, company_id: myCompany.id }) : [],
        enabled: !!myCompany,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const { data: staffProfiles = [] } = useQuery({
        queryKey: ['staff-profiles', myCompany?.id],
        queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id, is_active: true }) : [],
        enabled: !!myCompany,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
    const productionManagers = staffProfiles.filter(s =>
        s.role === 'production_manager' || s.role === 'Production Manager'
    );

    const { data: emailTracking = [] } = useQuery({
        queryKey: ['email-tracking', jobId],
        queryFn: () => jobId ? base44.entities.EmailTracking.filter({
            related_entity_id: jobId,
            related_entity_type: 'InspectionJob'
        }) : [],
        enabled: !!jobId && isPageVisible,
        refetchInterval: 30000,
        refetchIntervalInBackground: false,
        staleTime: 10000,
    });

    const createJobMutation = useMutation({
        mutationFn: (newJobData) => base44.entities.InspectionJob.create({
            ...newJobData,
            company_id: myCompany?.id
        }),
        onSuccess: async (createdJob, variables) => {
            queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });

            // Auto-create CalendarEvent when a scheduled date is present
            const dateStr = variables.scheduled_date || variables.inspection_date;
            const cid = myCompany?.id;
            if (dateStr && cid && createdJob?.id) {
                try {
                    const startDate = new Date(dateStr + 'T12:00:00');
                    if (variables.inspection_time) {
                        const [h, m] = variables.inspection_time.split(':');
                        startDate.setHours(parseInt(h), parseInt(m), 0, 0);
                    }
                    const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
                    const calEvent = await base44.entities.CalendarEvent.create({
                        company_id: cid,
                        title: `Inspection: ${variables.client_name || variables.property_address || 'Job'}`,
                        description: `📍 ${variables.property_address || ''}\n👤 ${variables.client_name || ''}\n📞 ${variables.client_phone || ''}`,
                        start_time: startDate.toISOString(),
                        end_time: endDate.toISOString(),
                        event_type: 'inspection',
                        assigned_to: variables.assigned_to_email || myCompany?.email || '',
                        location: variables.property_address || '',
                        customer_name: variables.client_name || '',
                        customer_email: variables.client_email || '',
                        customer_phone: variables.client_phone || '',
                        status: 'scheduled',
                        color: '#10b981',
                    });
                    await base44.entities.InspectionJob.update(createdJob.id, { calendar_event_id: calEvent.id });
                } catch (calErr) {
                    console.warn('[InspectionCapture] Auto-calendar failed (non-blocking):', calErr?.message);
                }
            }
        }
    });

    const resendNotificationMutation = useMutation({
        mutationFn: async () => {
            await base44.functions.invoke('sendInspectionAssignment', {
                jobId: job?.id,
                inspectorEmail: job?.assigned_to_email,
                appUrl: window.location.origin,
                isResend: true,
            });
        },
        onSuccess: () => {
            toast.success('Email and SMS re-sent to the inspector.');
            queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
            queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
        },
        onError: (err) => {
            toast.error('Failed to resend notification: ' + (err.message || 'Unknown error'));
        },
    });

    const [notesAutoSaved, setNotesAutoSaved] = useState(false);

    const updateJobNotesMutation = useMutation({
        mutationFn: ({ id, notes, showAlert }) => base44.entities.InspectionJob.update(id, { notes: JSON.stringify(notes) }).then(r => ({ ...r, showAlert })),
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
          if (data?.showAlert) {
            alert("Notes saved!");
          } else {
            setNotesAutoSaved(true);
            setTimeout(() => setNotesAutoSaved(false), 2000);
          }
        }
    });

    const saveRoofAccessories = useCallback(async (accessories) => {
        if (!jobId) return;
        try {
            await base44.entities.InspectionJob.update(jobId, {
                roof_accessories: JSON.stringify(accessories)
            });
            queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
        } catch (e) {
            console.error('Failed to save roof accessories:', e);
        }
    }, [jobId, queryClient]);

    const updateRoofAccessory = useCallback((key, value) => {
        setRoofAccessories(prev => {
            const updated = { ...prev, [key]: value };
            saveRoofAccessories(updated);
            return updated;
        });
    }, [saveRoofAccessories]);

    const updateSignatureMutation = useMutation({
        mutationFn: ({ id, signature }) => base44.entities.InspectionJob.update(id, { inspector_signature: signature }),
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
          setShowSignatureDialog(false);
          alert("✅ Signature saved!");
        }
    });

    const uploadMutation = useMutation({
        mutationFn: async ({ file, section, caption, targetJobId, skipAI }) => {
          const photoSection = chooseDamageSection(section, activeSection);
          // Convert HEIC/HEIF images (iPhone format) to JPEG before uploading
          const ext = file.name ? file.name.toLowerCase().split('.').pop() : '';
          const isHeic = ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif';
          if (isHeic) {
            try {
              const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
              const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
              const baseName = file.name.replace(/\.(heic|heif)$/i, '');
              file = new File([jpegBlob], `${baseName}.jpg`, { type: 'image/jpeg' });
            } catch (heicErr) {
              console.warn('HEIC conversion failed, uploading original:', heicErr);
            }
          }
          // Skip compression for inspection photos so they stay full-size for Hover and other services
          const isVideo = file.type?.startsWith('video') || ['mp4','mov','avi','mkv','webm'].includes((file.name || '').split('.').pop()?.toLowerCase() || '');

          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          
          let file_type = 'photo';
          if (file.type) {
            if (file.type.startsWith('video')) {
              file_type = 'video';
            } else if (file.type.startsWith('image')) {
              file_type = 'photo';
            } else if (file.name) {
              const ext = file.name.toLowerCase().split('.').pop();
              if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
                file_type = 'video';
              } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) {
                file_type = 'photo';
              }
            }
          } else if (file.name) {
            const ext = file.name.toLowerCase().split('.').pop();
            if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
              file_type = 'video';
            } else {
              file_type = 'photo';
            }
          }

          const media = await base44.entities.JobMedia.create({
            related_entity_id: targetJobId,
            related_entity_type: 'InspectionJob',
            file_url,
            file_type,
            section: photoSection,
            caption,
            uploaded_by_name: user?.full_name || 'User',
            company_id: myCompany?.id
          });

          // Auto-trigger AI analysis for photos only (unless skipped)
          if (file_type === 'photo' && !skipAI) {
            try {
              if (photoSection === 'Overhead / Aerial') {
                // 🛸 Aerial mode — draw labeled 10'×10' test squares
                console.log('Auto-analyzing overhead aerial photo for test squares...');
                const jobAddr = myCompany?.company_name || '';
                const { analysisData, annotatedUrl } = await runAerialTestSquares(file_url, jobAddr);
                await base44.entities.JobMedia.update(media.id, {
                  ai_damage_analysis: analysisData,
                  ...(annotatedUrl ? { annotated_url: annotatedUrl } : {})
                });
                console.log('Aerial test square analysis complete:', analysisData.ai_notes);
              } else {
                // Standard damage analysis
                console.log('Auto-analyzing photo with two-pass AI...');
                const stormCtx = job?.storm_context?.trim();
                const analysisResult = await base44.functions.invoke('analyzeCrewCamPhoto', {
                  photoUrl: file_url,
                  section: photoSection,
                  jobId: targetJobId,
                  ...(stormCtx ? { inspectorNotes: stormCtx } : {})
                });

                if (analysisResult.data.success) {
                  const analysisData = analysisResult.data.analysis;
                  let annotatedUrl = null;

                  if (analysisData.detections && analysisData.detections.length > 0) {
                    try {
                      console.log(`Drawing ${analysisData.detections.length} chalk annotations...`);
                      const annotatedBlob = await annotateImage(file_url, analysisData.detections, analysisData.possible_detections);
                      const fileName = `annotated_photosync_${Date.now()}.jpg`;
                      const annotatedFile = new File([annotatedBlob], fileName, { type: 'image/jpeg' });
                      const uploadRes = await base44.integrations.Core.UploadFile({ file: annotatedFile });
                      annotatedUrl = uploadRes.file_url;
                      console.log('Annotated image uploaded:', annotatedUrl);
                    } catch (annotError) {
                      console.error('Annotation drawing failed (non-critical):', annotError);
                    }
                  }

                  await base44.entities.JobMedia.update(media.id, {
                    ai_damage_analysis: analysisData,
                    ...(analysisData.photo_type ? { photo_type: analysisData.photo_type } : {}),
                    ...(annotatedUrl ? { annotated_url: annotatedUrl } : {})
                  });
                  console.log('AI analysis complete:', analysisData.severity,
                    `${analysisData.hail_hits_counted || 0} hail, ${analysisData.wind_marks_counted || 0} wind, ${analysisData.detections?.length || 0} annotations`);
                }
              }
            } catch (aiError) {
              console.error('AI analysis failed (non-critical):', aiError);
            }
          }

          return media;
        },
        onSuccess: (data, variables) => {
          queryClient.invalidateQueries({ queryKey: ['inspectionMedia', variables.targetJobId] });
          queryClient.invalidateQueries({ queryKey: ['inspectionMedia', myCompany?.id] });
        }
    });

    const updateMediaMutation = useMutation({
        mutationFn: ({ id, ...updates }) => base44.entities.JobMedia.update(id, updates),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (mediaId) => base44.entities.JobMedia.delete(mediaId),
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] });
          setSelectedPhotos([]);
        }
    });

    const linkEstimateMutation = useMutation({
        mutationFn: ({ jobId, estimateId }) => base44.entities.InspectionJob.update(jobId, { related_estimate_id: estimateId }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
            setShowLinkEstimateDialog(false);
            alert('✅ Estimate linked successfully!');
        }
    });

    const linkStormMutation = useMutation({
        mutationFn: ({ jobId, stormId }) => base44.entities.InspectionJob.update(jobId, { related_storm_event_id: stormId || null }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
            queryClient.invalidateQueries({ queryKey: ['linkedStorm', job?.related_storm_event_id] });
            setShowLinkStormDialog(false);
            alert('✅ Storm event updated!');
        }
    });

    const handleUploadWithJobCreation = async (uploadFn) => {
        let currentJobId = jobId;

        if (!currentJobId) {
            try {
                const newJob = await createJobMutation.mutateAsync({
                    property_address: `Unassigned Inspection - ${new Date().toLocaleString()}`,
                    status: 'pending'
                });
                currentJobId = newJob.id;
                setJobId(newJob.id);
                navigate(createPageUrl(`InspectionCapture?id=${newJob.id}`), { replace: true });
            } catch (error) {
                console.error("Failed to create temporary job", error);
                return;
            }
        }

        await uploadFn(currentJobId);
    };

    const handleLiveCaptureUpload = async ({ file, caption }) => {
        let uploadedMedia = null;
        await handleUploadWithJobCreation(async (currentJobId) => {
            uploadedMedia = await uploadMutation.mutateAsync({ file, section: activeSection, caption, targetJobId: currentJobId, skipAI: true });
        });
        return uploadedMedia;
    };

    const handleVoiceCaptionForLastPhoto = async (photoId, transcript) => {
        try {
            await updateMediaMutation.mutateAsync({ id: photoId, caption: transcript });
        } catch (error) {
            console.error('Failed to update photo caption:', error);
        }
    };

    // Retake upload — same pipeline as handleFileUpload but with an explicit
    // section override so the card's section is preserved regardless of the
    // currently-active gallery section.
    const handleRetakeUpload = async (event, sectionOverride) => {
        const rawFiles = Array.from(event.target.files);
        if (rawFiles.length === 0) return;
        event.target.value = '';
        const files = await Promise.all(rawFiles.map(async (f) => {
            if (!compressBeforeUpload || !f.type.startsWith('image/') || f.size < 1 * 1024 * 1024) return f;
            try { return await compressImage(f, 1400, 0.78); } catch (_) { return f; }
        }));
        await handleUploadWithJobCreation(async (currentJobId) => {
            enqueueFiles({
                items: files.map(file => ({
                    file,
                    jobId: currentJobId,
                    section: chooseDamageSection(sectionOverride, activeSection),
                    uploaderName: user?.full_name || 'User',
                    companyId: myCompany?.id,
                    skipAI: skipAiAnalysis,
                    stormContext: job?.storm_context || '',
                })),
            });
        });
    };

    const handleFileUpload = async (event) => {
        const rawFiles = Array.from(event.target.files);
        if (rawFiles.length === 0) return;
        event.target.value = '';

        // Compress large images before upload if enabled
        const files = await Promise.all(rawFiles.map(async (f) => {
            if (!compressBeforeUpload) return f;
            if (!f.type.startsWith('image/')) return f; // videos unchanged
            // Only compress if larger than 1MB — small files don't need it
            if (f.size < 1 * 1024 * 1024) return f;
            try {
                return await compressImage(f, 1400, 0.78);
            } catch (_) { return f; }
        }));

        // ── Client-side quality pre-check (Canvas API, <100 ms) ──────────────
        // Run in parallel across all image files; videos always pass.
        const qualityResults = await Promise.all(files.map(f => checkPhotoQuality(f)));
        const flaggedItems = files
            .map((file, i) => {
                const result = qualityResults[i];
                if (result.ok) return null;
                const reasons = [];
                if (result.isDark) reasons.push('too dark');
                if (result.isBlurry) reasons.push('blurry');
                return { file, reasons };
            })
            .filter(Boolean);

        const doEnqueue = async () => {
            await handleUploadWithJobCreation(async (currentJobId) => {
                const items = files.map(file => ({
                    file,
                    jobId: currentJobId,
                    section: chooseDamageSection(detectSectionFromFilename(file.name), activeSection),
                    uploaderName: user?.full_name || 'User',
                    companyId: myCompany?.id,
                    skipAI: skipAiAnalysis,
                    stormContext: job?.storm_context || '',
                }));
                enqueueFiles({ items });
            });
        };

        if (flaggedItems.length > 0) {
            // Show warning dialog; upload only proceeds if the user confirms.
            setPhotoQualityWarning({ flaggedItems, proceedFn: doEnqueue });
        } else {
            await doEnqueue();
        }
    };

    const handleOpenPhotoDetail = (item) => {
        const aiData = item.ai_damage_analysis || {};
        setEditingPhoto(item);
        const itemSection = item.section || 'Needs Section';
        const sectionFacts = job?.damage_assessment_facts?.[itemSection] || {};
        const currentMaterialIsUncertain = aiData.requires_material_confirmation;
        setEditFormData({
            caption: item.caption || '',
            description: aiData.description || '',
            hail_hits_counted: aiData.hail_hits_counted || 0,
            wind_marks_counted: aiData.wind_marks_counted || 0,
            missing_shingles_counted: aiData.missing_shingles_counted || 0,
            severity: aiData.severity || 'none',
            ai_notes: aiData.ai_notes || '',
            inspector_correction: aiData.inspector_correction || '',
            section: item.section || 'Needs Section',
            photo_type: item.photo_type || aiData.photo_type || 'Overview',
            material_category: sectionFacts.material_category || (currentMaterialIsUncertain ? '' : aiData.material_category || ''),
            material_type_identified: sectionFacts.material_type_identified || (currentMaterialIsUncertain ? '' : aiData.material_type_identified || ''),
            shingle_type: sectionFacts.shingle_type || aiData.shingle_type || 'none',
            shingle_exposure_inches: sectionFacts.shingle_exposure_inches ?? aiData.shingle_exposure_inches ?? '',
            roof_layers: sectionFacts.roof_layers ?? aiData.roof_layers ?? '',
        });
        setShowPhotoDetailDialog(true);
    };

    const confirmPhotoSectionMaterial = async (chosenCategory = editFormData.material_category) => {
        if (!editingPhoto || !jobId || !myCompany?.id) return;
        const section = String(editFormData.section || '').trim();
        if (!isNamedDamageSection(section)) {
            toast.error('Choose a named elevation, slope, or building section first.');
            return;
        }
        const material = PHOTO_DAMAGE_MATERIALS.find(([key]) => key === chosenCategory);
        if (!material) {
            toast.error('Select the material before confirming it.');
            return;
        }
        const existingFacts = job?.damage_assessment_facts || {};
        const fact = {
            material_category: material[0],
            material_type_identified: editFormData.material_type_identified || material[1],
            material_confirmed: true,
            inspector_confirmed: true,
            shingle_type: editFormData.shingle_type || 'none',
            shingle_exposure_inches: editFormData.shingle_exposure_inches === '' ? null : Number(editFormData.shingle_exposure_inches),
            roof_layers: editFormData.roof_layers === '' ? null : Number(editFormData.roof_layers),
            confirmed_by: user?.email || effectiveUserEmail || '',
            confirmed_at: new Date().toISOString(),
        };
        const nextFacts = { ...existingFacts, [section]: fact };
        await base44.entities.InspectionJob.update(jobId, { damage_assessment_facts: nextFacts });
        const sectionPhotos = (media || []).filter(photo => photo.section === section && photo.file_type === 'photo');
        let correctionRecords = 0;
        for (let offset = 0; offset < sectionPhotos.length; offset += 15) {
            await Promise.all(sectionPhotos.slice(offset, offset + 15).map(async (photo) => {
                const oldAI = photo.ai_damage_analysis || {};
                const hasOldAnalysis = Object.keys(oldAI).length > 0;
                const nextAI = {
                    ...oldAI,
                    ...fact,
                    material_confidence: 100,
                    material_candidates: [],
                    requires_material_confirmation: false,
                    ...(hasOldAnalysis ? {
                        needs_reanalysis_after_material_confirm: true,
                        previous_unverified_counts: {
                            hail_hits_counted: Number(oldAI.hail_hits_counted) || 0,
                            wind_marks_counted: Number(oldAI.wind_marks_counted) || 0,
                            missing_shingles_counted: Number(oldAI.missing_shingles_counted) || 0,
                        },
                        previous_unverified_detections: oldAI.detections || [],
                        hail_hits_counted: 0,
                        wind_marks_counted: 0,
                        missing_shingles_counted: 0,
                        detections: [],
                        ai_notes: `Material: ${fact.material_type_identified} (inspector-confirmed for ${section}). Previous damage findings were from an analysis before this material was confirmed; re-analyze this photo to count only material-appropriate damage.`,
                    } : {}),
                };
                await base44.entities.JobMedia.update(photo.id, {
                    section,
                    photo_type: photo.id === editingPhoto.id ? (editFormData.photo_type || photo.photo_type || 'Overview') : (photo.photo_type || oldAI.photo_type || 'Overview'),
                    ai_damage_analysis: nextAI,
                    ...(hasOldAnalysis ? { annotated_url: null } : {}),
                });
                if (hasOldAnalysis) {
                    try {
                        await base44.entities.PhotoDamageCorrection.create({
                            company_id: myCompany?.id,
                            related_entity_id: jobId,
                            related_entity_type: 'InspectionJob',
                            job_id: jobId,
                            photo_id: photo.id,
                            section,
                            material_category: fact.material_category,
                            photo_type: nextAI.photo_type || photo.photo_type || 'Overview',
                            original_ai_answer: {
                                material_category: oldAI.material_category,
                                material_type_identified: oldAI.material_type_identified,
                                hail_hits_counted: oldAI.hail_hits_counted,
                                wind_marks_counted: oldAI.wind_marks_counted,
                                detections: oldAI.detections || [],
                            },
                            corrected_answer: {
                                material_category: fact.material_category,
                                material_type_identified: fact.material_type_identified,
                                requires_reanalysis: true,
                            },
                            correction_note: `Inspector confirmed ${fact.material_type_identified} for section ${section}; prior detections require re-analysis.`,
                            corrected_by: fact.confirmed_by,
                        });
                        correctionRecords++;
                    } catch (correctionError) {
                        console.error('Unable to log section material correction:', correctionError);
                    }
                }
            }));
        }
        const updatedAI = {
            ...(editingPhoto.ai_damage_analysis || {}),
            ...fact,
            material_confidence: 100,
            material_candidates: [],
            requires_material_confirmation: false,
            ...(Object.keys(editingPhoto.ai_damage_analysis || {}).length ? {
                needs_reanalysis_after_material_confirm: true,
                previous_unverified_counts: {
                    hail_hits_counted: Number(editingPhoto.ai_damage_analysis?.hail_hits_counted) || 0,
                    wind_marks_counted: Number(editingPhoto.ai_damage_analysis?.wind_marks_counted) || 0,
                    missing_shingles_counted: Number(editingPhoto.ai_damage_analysis?.missing_shingles_counted) || 0,
                },
                hail_hits_counted: 0,
                wind_marks_counted: 0,
                missing_shingles_counted: 0,
                detections: [],
                ai_notes: `Material: ${fact.material_type_identified} (inspector-confirmed for ${section}). Previous damage findings were from an analysis before this material was confirmed; re-analyze this photo to count only material-appropriate damage.`,
            } : {}),
        };
        setEditFormData(prev => ({
            ...prev,
            material_category: material[0],
            material_type_identified: fact.material_type_identified,
            hail_hits_counted: 0,
            wind_marks_counted: 0,
            missing_shingles_counted: 0,
            ai_notes: updatedAI.ai_notes || prev.ai_notes,
        }));
        setEditingPhoto(prev => prev ? ({ ...prev, section, photo_type: editFormData.photo_type || 'Overview', ai_damage_analysis: updatedAI }) : prev);
        queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
        queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] });
        toast.success(`${material[1]} confirmed for ${section}; prior counts were held for review. Re-analyze the photos to apply the material-specific rules.`);
    };

    const handleSavePhotoDetail = async () => {
        if (!editingPhoto) return;
        const existingAI = editingPhoto.ai_damage_analysis || {};
        const previousAnswer = {
            material_category: existingAI.material_category || '',
            material_type_identified: existingAI.material_type_identified || '',
            shingle_type: existingAI.shingle_type || '',
            shingle_exposure_inches: existingAI.shingle_exposure_inches ?? null,
            roof_layers: existingAI.roof_layers ?? null,
            photo_type: existingAI.photo_type || editingPhoto.photo_type || '',
            hail_hits_counted: Number(existingAI.hail_hits_counted) || 0,
            wind_marks_counted: Number(existingAI.wind_marks_counted) || 0,
            missing_shingles_counted: Number(existingAI.missing_shingles_counted) || 0,
            severity: existingAI.severity || 'none',
            ai_notes: existingAI.ai_notes || '',
        };
        const updatedAI = {
            ...existingAI,
            hail_hits_counted: parseInt(editFormData.hail_hits_counted) || 0,
            wind_marks_counted: parseInt(editFormData.wind_marks_counted) || 0,
            missing_shingles_counted: parseInt(editFormData.missing_shingles_counted) || 0,
            severity: editFormData.severity,
            ai_notes: editFormData.ai_notes,
            description: editFormData.description,
            photo_type: editFormData.photo_type || 'Overview',
            inspector_correction: String(editFormData.inspector_correction || '').trim(),
            manually_edited: true,
            edited_at: new Date().toISOString()
        };

        const totalDamage = updatedAI.hail_hits_counted + updatedAI.wind_marks_counted + updatedAI.missing_shingles_counted;
        if (totalDamage > 0 && updatedAI.severity === 'none') {
            updatedAI.severity = totalDamage <= 3 ? 'minor' : totalDamage <= 10 ? 'moderate' : 'severe';
        }

        await base44.entities.JobMedia.update(editingPhoto.id, {
            caption: editFormData.caption,
            section: editFormData.section,
            photo_type: editFormData.photo_type || 'Overview',
            ai_damage_analysis: updatedAI
        });
        const correctedAnswer = {
            ...previousAnswer,
            material_category: editFormData.material_category || previousAnswer.material_category,
            material_type_identified: editFormData.material_type_identified || previousAnswer.material_type_identified,
            shingle_type: editFormData.shingle_type || previousAnswer.shingle_type,
            shingle_exposure_inches: editFormData.shingle_exposure_inches === '' ? null : Number(editFormData.shingle_exposure_inches),
            roof_layers: editFormData.roof_layers === '' ? null : Number(editFormData.roof_layers),
            photo_type: updatedAI.photo_type,
            hail_hits_counted: updatedAI.hail_hits_counted,
            wind_marks_counted: updatedAI.wind_marks_counted,
            missing_shingles_counted: updatedAI.missing_shingles_counted,
            severity: updatedAI.severity,
            ai_notes: updatedAI.ai_notes,
        };
        const correctionNote = String(editFormData.inspector_correction || '').trim();
        if (JSON.stringify(previousAnswer) !== JSON.stringify(correctedAnswer) || correctionNote !== String(existingAI.inspector_correction || '').trim()) {
            try {
                await base44.entities.PhotoDamageCorrection.create({
                    company_id: myCompany?.id,
                    related_entity_id: jobId,
                    related_entity_type: 'InspectionJob',
                    job_id: jobId,
                    photo_id: editingPhoto.id,
                    section: editFormData.section,
                    material_category: correctedAnswer.material_category,
                    photo_type: correctedAnswer.photo_type,
                    original_ai_answer: previousAnswer,
                    corrected_answer: correctedAnswer,
                    correction_note: correctionNote,
                    corrected_by: user?.email || effectiveUserEmail || '',
                });
            } catch (correctionError) {
                console.error('Unable to save PhotoSync correction example:', correctionError);
                toast.error('Photo details saved, but the correction example could not be recorded.');
            }
        }
        queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] });
        queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
        setShowPhotoDetailDialog(false);
        setEditingPhoto(null);
    };

    const handleSaveMeasurements = async (measurements) => {
        if (!measureTargetPhoto) return;
        await base44.entities.JobMedia.update(measureTargetPhoto.id, { measurements });
        queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] });
        setShowMeasureTool(false);
        setMeasureTargetPhoto(null);
    };

    const handleSharePhotosEmail = async () => {
        if (!shareEmail || !jobId) return;
        setIsSharingPhotos(true);
        try {
            const photoMedia = media.filter(m => m.file_type === 'photo');
            if (photoMedia.length === 0) {
                alert('No photos to share.');
                setIsSharingPhotos(false);
                return;
            }

            let htmlBody = `<h2 style="color:#1e3a8a;">Inspection Photos - ${job?.property_address || 'Property'}</h2>`;
            htmlBody += `<p><strong>Date:</strong> ${new Date(job?.inspection_date || job?.created_date).toLocaleDateString()}</p>`;
            htmlBody += `<p><strong>Client:</strong> ${currentClientName || 'N/A'}</p>`;
            if (job?.insurance_claim_number) htmlBody += `<p><strong>Claim #:</strong> ${job.insurance_claim_number}</p>`;
            htmlBody += `<hr style="margin:15px 0;">`;

            const imagesBySection = {};
            photoMedia.forEach(item => {
                const section = item.section || 'Other';
                if (!imagesBySection[section]) imagesBySection[section] = [];
                imagesBySection[section].push(item);
            });

            for (const [section, photos] of Object.entries(imagesBySection)) {
                htmlBody += `<h3 style="color:#1e3a8a;border-bottom:2px solid #1e3a8a;padding-bottom:5px;">${section}</h3>`;
                for (const photo of photos) {
                    const aiData = photo.ai_damage_analysis;
                    const imgUrl = photo.annotated_url || photo.file_url;
                    htmlBody += `<div style="margin-bottom:20px;">`;
                    htmlBody += `<img src="${imgUrl}" style="max-width:100%;max-height:400px;border-radius:8px;" />`;
                    htmlBody += `<p style="margin:5px 0;"><strong>${photo.caption || 'No caption'}</strong></p>`;
                    if (aiData) {
                        let damageInfo = [];
                        if (aiData.hail_hits_counted > 0) damageInfo.push(`${aiData.hail_hits_counted} Hail`);
                        if (aiData.wind_marks_counted > 0) damageInfo.push(`${aiData.wind_marks_counted} Wind`);
                        if (aiData.missing_shingles_counted > 0) damageInfo.push(`${aiData.missing_shingles_counted} Missing`);
                        if (damageInfo.length > 0) {
                            htmlBody += `<p style="color:#dc2626;font-weight:bold;">Damage: ${damageInfo.join(', ')} | Severity: ${(aiData.severity || 'none').toUpperCase()}</p>`;
                        }
                        if (aiData.ai_notes) {
                            htmlBody += `<p style="color:#2563eb;font-size:13px;">${aiData.ai_notes}</p>`;
                        }
                        if (aiData.manually_edited) {
                            htmlBody += `<p style="color:#7c3aed;font-size:11px;">Manually reviewed</p>`;
                        }
                    }
                    htmlBody += `</div>`;
                }
            }

            if (sectionNotes && Object.keys(sectionNotes).length > 0) {
                htmlBody += `<h3 style="color:#1e3a8a;">Section Notes</h3>`;
                for (const [section, notes] of Object.entries(sectionNotes)) {
                    if (notes) {
                        htmlBody += `<p><strong>${section}:</strong> ${notes}</p>`;
                    }
                }
            }

            if (scopeOfWork) {
                htmlBody += `<hr style="margin:15px 0;"><h3 style="color:#1e3a8a;border-bottom:2px solid #1e3a8a;padding-bottom:5px;">Scope of Work</h3>`;
                htmlBody += `<div style="background:#f0f4ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:0 8px 8px 0;white-space:pre-wrap;font-size:14px;line-height:1.7;">${scopeOfWork.replace(/\n/g, '<br/>')}</div>`;
            }

            if (reportNotes) {
                htmlBody += `<hr style="margin:15px 0;"><h3 style="color:#1e3a8a;border-bottom:2px solid #1e3a8a;padding-bottom:5px;">Notes</h3>`;
                htmlBody += `<div style="background:#fffbeb;border-left:4px solid #d97706;padding:12px 16px;border-radius:0 8px 8px 0;white-space:pre-wrap;font-size:14px;line-height:1.7;">${reportNotes.replace(/\n/g, '<br/>')}</div>`;
            }

            htmlBody += `<hr><p style="font-size:11px;color:#666;">Sent from CompanySync PhotoSync</p>`;

            const response = await base44.integrations.Core.SendEmail({
                to: shareEmail,
                subject: `Inspection Photos - ${job?.property_address || 'Property'} - ${new Date().toLocaleDateString()}`,
                html: htmlBody,
                manualSend: true,
            });

            const outcome = getPhotoShareEmailOutcome(response);
            if (outcome.status === 'not-sent') {
                throw new Error(outcome.message);
            }

            setShowSharePhotosDialog(false);
            setShareEmail('');
            const statusUrl = outcome.communicationId
                ? `${createPageUrl('Communication')}?comm=${encodeURIComponent(outcome.communicationId)}`
                : createPageUrl('Communication');
            if (outcome.status === 'delivered') {
                toast.success('Photo email delivery was confirmed.', {
                    action: { label: 'View status', onClick: () => navigate(statusUrl) },
                });
            } else if (outcome.status !== 'submitted') {
                toast.warning(outcome.message, {
                    duration: 10000,
                    action: { label: 'View status', onClick: () => navigate(statusUrl) },
                });
            }
        } catch (error) {
            console.error('Share photos failed:', error);
            toast.error(`Photo email was not confirmed: ${error.message || 'Unknown error'}`, {
                duration: 10000,
                action: {
                    label: 'Check email history',
                    onClick: () => navigate(createPageUrl('Communication')),
                },
            });
        } finally {
            setIsSharingPhotos(false);
        }
    };

    const handleReanalyzePhoto = async (item, silent = false, explicitInspectorNotes = null) => {
        if (reanalyzingPhotoId) return;
        const itemSection = item.section || 'Needs Section';
        if (!isNamedDamageSection(itemSection)) {
            if (!silent) toast.error('Choose and save a named elevation, slope, or building section before analyzing this photo.');
            return null;
        }
        setReanalyzingPhotoId(item.id);
        try {
            const fileUrl = item.file_url;
            const notesForSection = sectionNotesRef.current?.[itemSection] || '';
            const captionNote = item.caption || '';
            const stormCtx = job?.storm_context?.trim() || '';
            const combinedNotes = (
                explicitInspectorNotes != null
                    ? explicitInspectorNotes.trim()
                    : [stormCtx, notesForSection, captionNote].filter(Boolean).join('\n').trim()
            );
            if (itemSection === 'Overhead / Aerial') {
                // 🛸 Aerial mode — redraw test squares
                console.log('Re-analyzing overhead aerial photo for test squares...', item.id);
                const jobAddr = myCompany?.company_name || '';
                const { analysisData, annotatedUrl } = await runAerialTestSquares(fileUrl, jobAddr);
                await base44.entities.JobMedia.update(item.id, {
                    ai_damage_analysis: analysisData,
                    ...(analysisData.photo_type ? { photo_type: analysisData.photo_type } : {}),
                    ...(annotatedUrl ? { annotated_url: annotatedUrl } : {})
                });
                queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
                if (!silent) {
                    const count = analysisData.detected_sections?.length || 0;
                    alert(`Test squares drawn on ${count} roof section${count !== 1 ? 's' : ''}. ${analysisData.ai_notes || ''}`);
                }
                return analysisData;
            }

            console.log('Re-analyzing photo with two-pass AI...', item.id, 
                combinedNotes ? `[inspector notes: "${combinedNotes.slice(0, 60)}"]` : '[no inspector notes]');
            const analysisResult = await base44.functions.invoke('analyzeCrewCamPhoto', {
                photoUrl: fileUrl,
                section: itemSection,
                ...(item.photo_type ? { photoType: item.photo_type } : {}),
                jobId,
                ...(combinedNotes ? { inspectorNotes: combinedNotes } : {}),
                ...(explicitInspectorNotes?.trim() ? { inspectorCorrection: explicitInspectorNotes.trim() } : {}),
            });

            if (analysisResult.data.success) {
                const analysisData = analysisResult.data.analysis;
                analysisData.inspector_correction = explicitInspectorNotes == null
                    ? String(item.ai_damage_analysis?.inspector_correction || '').trim()
                    : String(explicitInspectorNotes || '').trim();
                let annotatedUrl = null;

                if (analysisData.detections && analysisData.detections.length > 0) {
                    try {
                        console.log(`Drawing ${analysisData.detections.length} chalk annotations...`);
                        const annotatedBlob = await annotateImage(fileUrl, analysisData.detections, analysisData.possible_detections);
                        const fileName = `annotated_photosync_${Date.now()}.jpg`;
                        const annotatedFile = new File([annotatedBlob], fileName, { type: 'image/jpeg' });
                        const uploadRes = await base44.integrations.Core.UploadFile({ file: annotatedFile });
                        annotatedUrl = uploadRes.file_url;
                        console.log('Annotated image uploaded:', annotatedUrl);
                    } catch (annotError) {
                        console.error('Annotation drawing failed:', annotError);
                    }
                }

                await base44.entities.JobMedia.update(item.id, {
                    ai_damage_analysis: analysisData,
                    ...(analysisData.photo_type ? { photo_type: analysisData.photo_type } : {}),
                    ...(annotatedUrl ? { annotated_url: annotatedUrl } : {})
                });

                queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
                if (!silent) {
                    alert(`AI Analysis Complete: ${analysisData.hail_hits_counted || 0} hail hits, ${analysisData.wind_marks_counted || 0} wind marks. Severity: ${analysisData.severity || 'none'}`);
                }
                return analysisData;
            }
        } catch (error) {
            console.error('Re-analysis failed:', error);
            if (!silent) {
                alert('AI analysis failed: ' + (error.message || 'Unknown error'));
            }
        } finally {
            setReanalyzingPhotoId(null);
        }
        return null;
    };

    const handleClearAI = async (item) => {
        if (!confirm('Remove AI analysis from this photo? The original photo will be preserved.')) return;
        try {
            await base44.entities.JobMedia.update(item.id, {
                ai_damage_analysis: null,
                annotated_url: null
            });
            queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
        } catch (error) {
            console.error('Clear AI failed:', error);
            alert('Failed to clear AI analysis: ' + (error.message || 'Unknown error'));
        }
    };

    const handleDrawAndAnalyze = async (strokesBlob, strokeSummary) => {
        if (!drawingPhoto) return;
        setIsDrawAnalyzing(true);
        try {
            // Upload the strokes-only PNG for use as the annotated thumbnail
            const strokesFile = new File([strokesBlob], `inspector_marks_${Date.now()}.png`, { type: 'image/png' });
            const { file_url: strokesUrl } = await base44.integrations.Core.UploadFile({ file: strokesFile });

            // Send only the original photo URL to the AI function — the strokes URL
            // is a local dev-server URL that external AI services cannot reach.
            // Instead, pass the inspector's marks as a text description (strokesDescription).
            const result = await base44.functions.invoke('analyzeCrewCamPhotoAdvanced', {
                photoUrls: [drawingPhoto.file_url],
                sections: [drawingPhoto.section || 'Other'],
                photoType: 'actual_footage',
                strokesDescription: strokeSummary || ''
            });

            if (!result?.data?.success) throw new Error(result?.data?.error || 'Analysis failed');

            const analysisData = result.data.analysis;

            // Save: annotated_url = the strokes PNG thumbnail, plus AI results
            await base44.entities.JobMedia.update(drawingPhoto.id, {
                annotated_url: strokesUrl,
                photo_type: 'Close-up',
                ai_damage_analysis: {
                    ...analysisData,
                    photo_type: 'Close-up',
                    inspector_guided: true,
                    hail_hits_counted: analysisData.hail_hits_counted ?? analysisData.chalk_marked_hail ?? 0,
                    wind_marks_counted: analysisData.wind_marks_counted ?? analysisData.chalk_marked_wind ?? 0,
                }
            });

            queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
            setDrawingPhoto(null);
        } catch (err) {
            console.error('Draw & Analyze failed:', err);
            alert('Analysis failed: ' + (err.message || 'Unknown error'));
        } finally {
            setIsDrawAnalyzing(false);
        }
    };

    const handleLiveCaptureDrawAndAnalyze = async ({ originalFile, annotatedBlob, strokeSummary }) => {
        let uploadedMedia = null;
        await handleUploadWithJobCreation(async (currentJobId) => {
            uploadedMedia = await uploadMutation.mutateAsync({
                file: originalFile,
                section: activeSection,
                caption: '',
                targetJobId: currentJobId,
                skipAI: true,
            });
        });

        if (!uploadedMedia?.id) throw new Error('Failed to upload photo');

        // Upload the strokes PNG for the annotated thumbnail
        const strokesFile = new File([annotatedBlob], `inspector_marks_${Date.now()}.png`, { type: 'image/png' });
        const { file_url: strokesUrl } = await base44.integrations.Core.UploadFile({ file: strokesFile });

        // Send original photo URL (CDN-accessible) + stroke description to AI
        const result = await base44.functions.invoke('analyzeCrewCamPhotoAdvanced', {
            photoUrls: [uploadedMedia.file_url],
            sections: [activeSection || 'Other'],
            photoType: 'actual_footage',
            strokesDescription: strokeSummary || '',
        });

        if (!result?.data?.success) throw new Error(result?.data?.error || 'Analysis failed');

        const analysisData = result.data.analysis;

        await base44.entities.JobMedia.update(uploadedMedia.id, {
            annotated_url: strokesUrl,
            photo_type: 'Close-up',
            ai_damage_analysis: {
                ...analysisData,
                photo_type: 'Close-up',
                inspector_guided: true,
                hail_hits_counted: analysisData.hail_hits_counted ?? analysisData.chalk_marked_hail ?? 0,
                wind_marks_counted: analysisData.wind_marks_counted ?? analysisData.chalk_marked_wind ?? 0,
            },
        });

        queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] });
    };

    const handleSaveNotes = () => {
        if (!jobId) {
            alert("Please create the inspection job first before saving notes.");
            return;
        }
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        updateJobNotesMutation.mutate({ id: jobId, notes: sectionNotes, showAlert: true });
    };

    const handleInlineSave = async (photoId, field, value) => {
        setInlineEdit({ id: null, field: null, value: '' });
        if (!photoId || !field) return;
        await updateMediaMutation.mutateAsync({ id: photoId, [field]: value });
    };

    const handleSaveSow = async (text) => {
        if (!jobId) return;
        const value = text !== undefined ? text : scopeOfWork;
        await base44.entities.InspectionJob.update(jobId, { scope_of_work: value });
        setSowAutoSaved(true);
        setTimeout(() => setSowAutoSaved(false), 2000);
    };

    const handleSaveReportNotes = async (text) => {
        if (!jobId) return;
        const value = text !== undefined ? text : reportNotes;
        await base44.entities.InspectionJob.update(jobId, { report_notes: value });
        setReportNotesAutoSaved(true);
        setTimeout(() => setReportNotesAutoSaved(false), 2000);
    };

    // Renders a "Scope of Work & Notes" page into a jsPDF report when either
    // the scope of work or report notes have content. Shared by the download,
    // preview, and generate-and-send report builders.
    const addScopeAndNotesToPdf = (doc, { pageWidth, pageHeight, margin, contentWidth, primaryColor }) => {
        const sow = (scopeOfWork || '').trim();
        const notes = (reportNotes || '').trim();
        if (!sow && !notes) return;
        doc.addPage();
        doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
        doc.rect(0, 10, pageWidth, 12, 'F');
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text(String(t.scopeAndNotesTitle || 'Scope of Work & Notes'), pageWidth / 2, 18, { align: 'center' });
        let yPos = 32;
        const writeBlock = (heading, text) => {
            if (!text) return;
            if (yPos > pageHeight - 40) { doc.addPage(); yPos = 20; }
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
            doc.text(String(heading), margin, yPos);
            yPos += 3;
            doc.setDrawColor(primaryColor.r, primaryColor.g, primaryColor.b);
            doc.setLineWidth(0.5);
            doc.line(margin, yPos, margin + contentWidth, yPos);
            yPos += 6;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(40, 40, 40);
            const lines = doc.splitTextToSize(text, contentWidth);
            for (const line of lines) {
                if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; }
                doc.text(String(line), margin, yPos);
                yPos += 5;
            }
            yPos += 8;
        };
        writeBlock(t.scopeOfWork || 'Scope of Work', sow);
        writeBlock(t.reportNotes || 'Report Notes', notes);
    };

    const handleGenerateSow = async () => {
        const hasPhotos = media && media.length > 0;
        const hasDictatedNotes = scopeOfWork && scopeOfWork.trim();
        if (!hasPhotos && !hasDictatedNotes) {
            alert('Dictate some notes first, or take photos and run AI on them — then tap AI Generate to produce a professional scope.');
            return;
        }
        setGeneratingSow(true);
        try {
            const analyzedPhotos = (media || []).filter(m => m.ai_damage_analysis);
            const photoSummaries = analyzedPhotos.map(m => {
                const ai = m.ai_damage_analysis;
                const damage = [
                    ai.hail_damage && `hail damage (${ai.hail_hits_counted || 0} hits)`,
                    ai.wind_damage && `wind damage (${ai.wind_marks_counted || 0} marks)`,
                    ai.missing_shingles && 'missing shingles',
                    ai.granule_loss && 'granule loss',
                    ai.cracking && 'cracking',
                    ai.ponding_water && 'ponding water',
                    ai.exposed_deck && 'exposed deck',
                    ai.flashing_damage && 'flashing damage',
                ].filter(Boolean).join(', ');
                return `Section: ${m.section || 'General'} — ${damage || 'general wear'} — Severity: ${ai.severity || 'minor'}${ai.ai_notes ? ` — Notes: ${ai.ai_notes}` : ''}`;
            }).join('\n');

            const propertyInfo = `Property: ${job?.property_address || 'Unknown'} | Client: ${currentClientName || 'Unknown'} | Claim #: ${job?.insurance_claim_number || 'N/A'}`;

            const result = await base44.integrations.Core.InvokeLLM({
                prompt: `You are a professional roofing inspector writing a Scope of Work for an insurance claim or repair estimate.

Property Info:
${propertyInfo}

Inspector Dictated Notes (raw field observations to clean up):
${hasDictatedNotes ? scopeOfWork.trim() : 'None'}

AI Damage Analysis from ${analyzedPhotos.length} photos:
${photoSummaries || 'None'}

Using all information above, write a clear, professional Scope of Work document that:
1. Lists all damaged areas by roof section
2. Describes the specific work needed (tear-off, replacement, repairs)
3. Calls out materials (shingles, underlayment, flashing, gutters, etc.)
4. Notes any code upgrades or supplemental items
5. Uses bullet points per section
6. Is suitable for insurance adjusters and production managers

Write the scope now — do not include any introductory text, just the scope itself.`,
            });

            const generated = result?.result || result?.text || result || '';
            setScopeOfWork(generated);
            await handleSaveSow(generated);
        } catch (err) {
            alert('Could not generate scope: ' + err.message);
        } finally {
            setGeneratingSow(false);
        }
    };


    const autoSaveTimerRef = useRef(null);
    const sectionNotesRef = useRef(sectionNotes);
    const jobIdRef = useRef(jobId);
    const isSavingRef = useRef(false);

    useEffect(() => { sectionNotesRef.current = sectionNotes; }, [sectionNotes]);
    useEffect(() => { jobIdRef.current = jobId; }, [jobId]);

    useEffect(() => {
        const el = lightboxContainerRef.current;
        if (!el || !lightboxUrl) return;
        // Wheel zoom (desktop scroll wheel)
        const handleWheel = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const factor = e.deltaY < 0 ? 1.2 : (1 / 1.2);
            setLightboxZoom(z => Math.min(10, Math.max(0.5, z * factor)));
        };
        // Touch pinch-to-zoom
        const handleTouchStart = (e) => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                lightboxPinchRef.current = Math.sqrt(dx * dx + dy * dy);
            } else if (e.touches.length === 1) {
                lightboxDragRef.current = {
                    startX: e.touches[0].clientX,
                    startY: e.touches[0].clientY,
                    ox: 0, oy: 0, didDrag: false
                };
            }
        };
        const handleTouchMove = (e) => {
            e.preventDefault();
            if (e.touches.length === 2 && lightboxPinchRef.current !== null) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const newDist = Math.sqrt(dx * dx + dy * dy);
                const factor = newDist / lightboxPinchRef.current;
                lightboxPinchRef.current = newDist;
                setLightboxZoom(z => Math.min(10, Math.max(0.5, z * factor)));
            } else if (e.touches.length === 1 && lightboxDragRef.current) {
                const dx = e.touches[0].clientX - lightboxDragRef.current.startX;
                const dy = e.touches[0].clientY - lightboxDragRef.current.startY;
                setLightboxOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
                lightboxDragRef.current.startX = e.touches[0].clientX;
                lightboxDragRef.current.startY = e.touches[0].clientY;
            }
        };
        const handleTouchEnd = () => {
            lightboxPinchRef.current = null;
            lightboxDragRef.current = null;
        };
        el.addEventListener('wheel', handleWheel, { passive: false });
        el.addEventListener('touchstart', handleTouchStart, { passive: false });
        el.addEventListener('touchmove', handleTouchMove, { passive: false });
        el.addEventListener('touchend', handleTouchEnd);
        return () => {
            el.removeEventListener('wheel', handleWheel);
            el.removeEventListener('touchstart', handleTouchStart);
            el.removeEventListener('touchmove', handleTouchMove);
            el.removeEventListener('touchend', handleTouchEnd);
        };
    }, [lightboxKey, lightboxUrl]);

    const doAutoSave = useCallback(async () => {
        const currentJobId = jobIdRef.current;
        const currentNotes = sectionNotesRef.current;
        if (!currentJobId || isSavingRef.current) return;
        if (!currentNotes || Object.keys(currentNotes).length === 0) return;
        const hasContent = Object.values(currentNotes).some(n => n && n.trim());
        if (!hasContent) return;
        isSavingRef.current = true;
        try {
            await base44.entities.InspectionJob.update(currentJobId, { notes: JSON.stringify(currentNotes) });
            queryClient.invalidateQueries({ queryKey: ['inspectionJob', currentJobId] });
            setNotesAutoSaved(true);
            setTimeout(() => setNotesAutoSaved(false), 2000);
        } catch (e) {
            console.error('Auto-save notes failed:', e);
        } finally {
            isSavingRef.current = false;
        }
    }, [queryClient]);

    const handleSectionNotesChange = (section, text) => {
        setSectionNotes(prev => ({ ...prev, [section]: text }));
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(doAutoSave, 2000);
    };

    useEffect(() => {
        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
                doAutoSave();
            }
        };
    }, [doAutoSave]);

    // ── Claims-critical keyword detection ────────────────────────────────────
    useEffect(() => {
        const found = detectTriggeredKeywords(scopeOfWork, sectionNotes);
        setTriggeredKeywords(found);
    }, [scopeOfWork, sectionNotes]);

    // Auto-show evidence modal when keywords first appear
    useEffect(() => {
        if (triggeredKeywords.length > 0 && prevTriggeredCountRef.current === 0) {
            setShowEvidenceBlockedModal(true);
        }
        prevTriggeredCountRef.current = triggeredKeywords.length;
    }, [triggeredKeywords]);
    // ─────────────────────────────────────────────────────────────────────────

    // Close right-click context menu when clicking anywhere outside it
    useEffect(() => {
        if (!photoContextMenu.visible) return;
        const close = () => setPhotoContextMenu({ visible: false, x: 0, y: 0 });
        document.addEventListener('click', close, { once: true });
        document.addEventListener('contextmenu', close, { once: true });
        return () => {
            document.removeEventListener('click', close);
            document.removeEventListener('contextmenu', close);
        };
    }, [photoContextMenu.visible]);

    const handleSaveSignature = (signatureDataUrl) => {
        if (!jobId) {
            alert("Please create the inspection job first.");
            return;
        }
        setInspectorSignature(signatureDataUrl);
        updateSignatureMutation.mutate({ id: jobId, signature: signatureDataUrl });
    };

    const loadImageAsDataUrl = async (url, label = 'image') => {
        if (!url) {
            console.warn(`⚠️ No URL provided for ${label}`);
            return null;
        }
        console.log(`📸 Loading ${label}: ${url.substring(0, 80)}...`);

        const tryFetch = async (fetchUrl, options = {}) => {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 20000);
            try {
                const resp = await fetch(fetchUrl, { ...options, signal: ac.signal });
                clearTimeout(timer);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const blob = await resp.blob();
                if (blob.size === 0) throw new Error('Empty blob');
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('FileReader failed'));
                    reader.readAsDataURL(blob);
                });
            } catch (e) { clearTimeout(timer); throw e; }
        };

        const tryCanvas = async (imgUrl, useCors) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                if (useCors) img.crossOrigin = 'anonymous';
                const timer = setTimeout(() => reject(new Error('Image load timed out')), 20000);
                img.onload = () => {
                    clearTimeout(timer);
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                        if (dataUrl === 'data:,') throw new Error('Canvas toDataURL empty');
                        resolve(dataUrl);
                    } catch (e) { reject(e); }
                };
                img.onerror = () => { clearTimeout(timer); reject(new Error('Image element failed to load')); };
                img.src = imgUrl;
            });
        };

        try {
            const proxyResp = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
            if (proxyResp.ok) {
                const { data, mime } = await proxyResp.json();
                if (data) return `data:${mime};base64,${data}`;
            }
        } catch (ep) { console.log(`  ↳ proxy failed for ${label}: ${ep.message}`); }

        try { return await tryFetch(url); }
        catch (e1) { console.log(`  ↳ fetch failed for ${label}: ${e1.message}`); }

        try { return await tryFetch(url, { credentials: 'include' }); }
        catch (e2) { console.log(`  ↳ fetch+credentials failed for ${label}: ${e2.message}`); }

        try { return await tryCanvas(url, true); }
        catch (e3) { console.log(`  ↳ canvas+cors failed for ${label}: ${e3.message}`); }

        try { return await tryCanvas(url, false); }
        catch (e4) { console.log(`  ↳ canvas no-cors failed for ${label}: ${e4.message}`); }

        console.error(`❌ All methods failed for ${label}: ${url}`);
        return null;
    };

    const addPlaceholderToDoc = (doc, x, y, w, h, text = 'Photo could not be loaded') => {
        doc.setFillColor(240, 240, 240);
        doc.rect(x, y, w, h, 'F');
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.rect(x, y, w, h);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(150, 150, 150);
            doc.text(String(text), x + w / 2, y + h / 2, { align: 'center' });
        doc.setTextColor(0);
    };

    const loadLogoForPdf = async (logoUrl, doc, x, y, maxW, maxH) => {
        const dataUrl = await loadImageAsDataUrl(logoUrl, 'company logo');
        if (!dataUrl) return 0;
        try {
            const logoImg = new Image();
            logoImg.crossOrigin = 'anonymous';
            await new Promise((res, rej) => { logoImg.onload = res; logoImg.onerror = rej; logoImg.src = logoUrl; });
            const ratio = Math.min(maxW / logoImg.naturalWidth, maxH / logoImg.naturalHeight);
            const logoW = logoImg.naturalWidth * ratio;
            const logoH = logoImg.naturalHeight * ratio;
            doc.addImage(dataUrl, 'PNG', x, y, logoW, logoH);
            return logoH;
        } catch (e) {
            try {
                doc.addImage(dataUrl, 'PNG', x, y, maxW, maxH);
                return maxH;
            } catch (e2) {
                console.error('❌ Could not add logo to PDF:', e2.message);
                return 0;
            }
        }
    };

    const handleExportReport = async () => {
        if (!jobId) {
            alert("Please save the inspection first before exporting.");
            return;
        }

        setIsExporting(true);

        try {
            const photoMedia = media.filter(item => item.file_type === 'photo');

            if (photoMedia.length === 0) {
                alert("⚠️ No photos found. Please capture some photos before exporting.");
                setIsExporting(false);
                return;
            }

            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 20;
            const contentWidth = pageWidth - (margin * 2);

            // Brand color
            const hexToRgb = (hex) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? {
                    r: parseInt(result[1], 16),
                    g: parseInt(result[2], 16),
                    b: parseInt(result[3], 16)
                } : { r: 30, g: 58, b: 138 };
            };
            
            const primaryColor = myCompany?.brand_primary_color 
                ? hexToRgb(myCompany.brand_primary_color) 
                : { r: 30, g: 58, b: 138 };

            // Cover page with professional design
            let y = 20;
            
            // Add company logo (aspect-ratio preserved)
            if (myCompany?.logo_url) {
                const coverLogoH = await loadLogoForPdf(myCompany.logo_url, doc, 18, y, 40, 25);
                if (coverLogoH > 0) y += coverLogoH + 5;
            }
            
            // Company info - LARGER AND MORE PROMINENT
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(String(myCompany?.company_name || t.companyName), margin, y);
            y += 8;
            
            doc.setFontSize(11);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(60, 60, 60);
            
            if (myCompany?.address) {
                doc.text(String(myCompany.address), margin, y);
                y += 6;
            }
            
            if (myCompany?.city || myCompany?.state || myCompany?.zip) {
                const cityStateZip = [myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', ');
                doc.text(String(cityStateZip), margin, y);
                y += 6;
            }
            
            if (myCompany?.phone) {
                doc.text(String(t.phone + ": " + myCompany.phone), margin, y);
                y += 6;
            }
            
            if (myCompany?.email) {
                doc.text(String(t.email + ": " + myCompany.email), margin, y);
                y += 6;
            }
            
            if (myCompany?.company_website) {
                doc.text(String(t.web + ": " + myCompany.company_website), margin, y);
                y += 6;
            }
            
            // Title section with branded color
            y = 80;
            doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
            doc.rect(0, y, pageWidth, 25, 'F');
            
            doc.setFontSize(28);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(255, 255, 255);
            doc.text(String(t.inspectionReport), pageWidth / 2, y + 16, { align: 'center' });
            
            // Property details box
            y = 125;
            doc.setFillColor(245, 247, 250);
            doc.rect(margin, y, contentWidth, 65, 'F');
            
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(String(t.propertyInformation), margin + 5, y + 8);
            
            y += 15;
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(60, 60, 60);
            doc.text(String(t.propertyAddress + ": " + (job.property_address || t.na)), margin + 5, y);
            y += 5;
            doc.text(String(t.clientName + ": " + (currentClientName || t.na)), margin + 5, y);
            y += 5;
            if (job.client_email) {
                doc.text(String(t.clientEmail + ": " + job.client_email), margin + 5, y);
                y += 5;
            }
            if (job.client_phone) {
                doc.text(String(t.clientPhone + ": " + job.client_phone), margin + 5, y);
                y += 5;
            }
            doc.text(String(t.inspectionDate + ": " + new Date(job.inspection_date || job.created_date).toLocaleDateString(t.dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })), margin + 5, y);
            y += 5;
            if (job.insurance_claim_number) {
                doc.text(String(t.claimNumber + ": " + job.insurance_claim_number), margin + 5, y);
                y += 5;
            }
            if (job.insurance_company) {
                doc.text(String(t.insuranceCompany + ": " + job.insurance_company), margin + 5, y);
                y += 5;
            }
            if (job.date_of_loss) {
                try { doc.text(String('Date of Loss: ' + new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })), margin + 5, y); } catch { doc.text(String('Date of Loss: ' + job.date_of_loss), margin + 5, y); }
                y += 5;
            }
            if (job.damage_type) {
                doc.text(String('Type of Loss: ' + job.damage_type), margin + 5, y);
            }

            // Scope of Work & Notes page (only added when either has content)
            addScopeAndNotesToPdf(doc, { pageWidth, pageHeight, margin, contentWidth, primaryColor });

            // Group images by section
            const imagesBySection = {};
            photoMedia.forEach(item => {
                const section = item.section || 'Other';
                if (!imagesBySection[section]) {
                    imagesBySection[section] = [];
                }
                imagesBySection[section].push(item);
            });

            const reportImages = createReportImageQueue(Object.values(imagesBySection).flat(), jobId, {
                onProgress: (count, total) => setReportBuildProgress(`Preparing photo ${count} of ${total}`),
            });
            // Add sections with photos
            for (const [section, images] of Object.entries(imagesBySection)) {
                let sectionProcessed = 0;
                doc.addPage();
                
                // Section header with branded bar
                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.rect(0, 10, pageWidth, 12, 'F');
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(255, 255, 255);
                doc.text(String(section), pageWidth / 2, 18, { align: 'center' });
                
                let yPos = 30;
                
                if (sectionNotes && sectionNotes[section]) {
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(60, 60, 60);
                    const lines = doc.splitTextToSize(sectionNotes[section], contentWidth);
                    doc.text(String(lines), margin, yPos);
                    yPos += (lines.length * 4) + 8;
                }

                for (const item of images) {
                    const imgWidth = contentWidth;
                    let imgHeight = 100;
                    try {
                        const prepared = await reportImages.next(item);
                        const imageDataUrl = prepared.dataUrl;
                        imgHeight = Math.min((imgWidth * prepared.height) / prepared.width, pageHeight - 60);

                        if (yPos + imgHeight > pageHeight - 30) {
                            doc.addPage();
                            doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                            doc.rect(0, 10, pageWidth, 12, 'F');
                            doc.setFontSize(14);
                            doc.setFont('helvetica', 'bold');
                            doc.setTextColor(255, 255, 255);
                            doc.text(`${section} ${t.continued}`, pageWidth / 2, 18, { align: 'center' });
                            yPos = 30;
                        }

                        doc.setDrawColor(200, 200, 200);
                        doc.setLineWidth(0.3);
                        doc.rect(margin, yPos, imgWidth, imgHeight);
                        doc.addImage(imageDataUrl, 'JPEG', margin + 1, yPos + 1, imgWidth - 2, imgHeight - 2);
                        
                        yPos += imgHeight + 5;

                        if (item.caption) {
                            doc.setFontSize(10);
                            doc.setFont('helvetica', 'normal');
                            doc.setTextColor(60, 60, 60);
                            const captionLines = doc.splitTextToSize(item.caption, contentWidth);
                            doc.text(String(captionLines), margin, yPos);
                            yPos += (captionLines.length * 4.5) + 4;
                            doc.setTextColor(0);
                        } else {
                            yPos += 4;
                        }
                        { const metaParts = []; if (item.uploaded_by_name) metaParts.push(item.uploaded_by_name); const _ts = item.created_at || item.created_date; if (_ts) { try { metaParts.push(new Date(_ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })); } catch {} } if (metaParts.length > 0) { doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(150, 150, 150); doc.text(String(metaParts.join('  |  ')), margin, yPos); yPos += 5; doc.setTextColor(0); } }

                        // AI Analysis Block
                        const aiData = item.ai_damage_analysis;
                        if (aiData) {
                            if (yPos > pageHeight - 60) {
                                doc.addPage();
                                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                                doc.rect(0, 10, pageWidth, 12, 'F');
                                doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                                doc.text(`${section} ${t.continued}`, pageWidth / 2, 18, { align: 'center' });
                                yPos = 30;
                            }
                            const sevColors = { severe: [220, 38, 38], moderate: [245, 158, 11], minor: [59, 130, 246], none: [107, 114, 128] };
                            const sev = (aiData.severity || 'none').toLowerCase();
                            const sc = sevColors[sev] || sevColors.none;
                            doc.setFillColor(sc[0], sc[1], sc[2]);
                            doc.rect(margin, yPos, contentWidth, 6, 'F');
                            doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                            const sevLabel = sev.charAt(0).toUpperCase() + sev.slice(1);
                            const verdictLabel = aiData.coverage_verdict === 'covered' ? 'COVERED' : aiData.coverage_verdict === 'not_covered' ? 'NOT COVERED' : 'MIXED';
                            doc.text(`AI ANALYSIS  |  Severity: ${sevLabel}  |  Coverage Verdict: ${verdictLabel}`, margin + 3, yPos + 4.2);
                            yPos += 8;
                            doc.setFillColor(248, 250, 252); doc.rect(margin, yPos, contentWidth, 7, 'F');
                            doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
                            const photoCounts = [];
                            if (aiData.hail_hits_counted > 0) photoCounts.push(`Hail Impacts: ${aiData.hail_hits_counted}`);
                            if (aiData.wind_marks_counted > 0) photoCounts.push(`Wind Damage: ${aiData.wind_marks_counted}`);
                            if (aiData.missing_count > 0) photoCounts.push(`Missing: ${aiData.missing_count}`);
                            if (aiData.photo_quality_score) photoCounts.push(`Photo Quality: ${aiData.photo_quality_score}%`);
                            if (photoCounts.length > 0) doc.text(photoCounts.join('    |    '), margin + 3, yPos + 4.5);
                            yPos += 9;
                            if (aiData.ai_notes) {
                                const noteLines = doc.splitTextToSize(String(aiData.ai_notes), contentWidth - 4);
                                const maxLines = Math.min(noteLines.length, 10);
                                doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40);
                                doc.text(noteLines.slice(0, maxLines), margin + 2, yPos + 3);
                                yPos += (maxLines * 3.8) + 4;
                            }
                            if (aiData.covered_items?.length > 0) {
                                doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(22, 101, 52);
                                doc.text('Insurance-Covered Damage:', margin + 2, yPos);
                                yPos += 4; doc.setFont('helvetica', 'normal');
                                aiData.covered_items.slice(0, 5).forEach(ci => {
                                    const txt = `  + ${ci.type} — ${ci.confidence}% confidence${ci.description ? ': ' + ci.description : ''}`;
                                    const cLines = doc.splitTextToSize(txt, contentWidth - 6);
                                    doc.text(cLines[0], margin + 4, yPos);
                                    yPos += 4;
                                });
                                yPos += 2;
                            }
                            if (aiData.non_covered_items?.length > 0) {
                                doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(153, 27, 27);
                                doc.text('Pre-existing / Not Covered:', margin + 2, yPos);
                                yPos += 4; doc.setFont('helvetica', 'normal');
                                aiData.non_covered_items.slice(0, 4).forEach(ni => {
                                    const txt = `  - ${ni.type} — ${ni.confidence}% confidence${ni.description ? ': ' + ni.description : ''}`;
                                    const nLines = doc.splitTextToSize(txt, contentWidth - 6);
                                    doc.text(nLines[0], margin + 4, yPos);
                                    yPos += 4;
                                });
                                yPos += 2;
                            }
                            doc.setTextColor(0);
                            yPos += 8;
                        } else {
                            yPos += 5;
                        }

                    } catch (error) {
                        throw new Error(`Cannot export an incomplete report: ${error.message}`);
                    }
                    if (++sectionProcessed % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // Damage Summary & Xactimate Line Items Page
            const analyzedPhotos = photoMedia.filter(p => p.ai_damage_analysis);
            if (analyzedPhotos.length > 0) {
                doc.addPage();
                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.rect(0, 10, pageWidth, 12, 'F');
                doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                doc.text('Damage Summary & Recommended Line Items', pageWidth / 2, 18, { align: 'center' });
                let spY = 28;

                let totalHail = 0, totalWind = 0, totalMissing = 0;
                const coveredTypeMap = {}, nonCoveredTypeMap = {};
                const verdictCounts = { covered: 0, mixed: 0, not_covered: 0 };
                let severestSeverity = 'none';
                const sevOrder = ['none', 'minor', 'moderate', 'severe'];
                analyzedPhotos.forEach(p => {
                    const ai = p.ai_damage_analysis;
                    totalHail += (ai.hail_hits_counted || 0);
                    totalWind += (ai.wind_marks_counted || 0);
                    totalMissing += (ai.missing_count || 0);
                    if (ai.coverage_verdict) verdictCounts[ai.coverage_verdict] = (verdictCounts[ai.coverage_verdict] || 0) + 1;
                    if (sevOrder.indexOf(ai.severity) > sevOrder.indexOf(severestSeverity)) severestSeverity = ai.severity;
                    (ai.covered_items || []).forEach(ci => {
                        const k = (ci.type || '').toLowerCase();
                        if (!coveredTypeMap[k]) coveredTypeMap[k] = { ...ci, photoCount: 0 };
                        coveredTypeMap[k].photoCount++;
                        coveredTypeMap[k].confidence = Math.max(coveredTypeMap[k].confidence, ci.confidence || 0);
                    });
                    (ai.non_covered_items || []).forEach(ni => {
                        const k = (ni.type || '').toLowerCase();
                        if (!nonCoveredTypeMap[k]) nonCoveredTypeMap[k] = { ...ni, photoCount: 0 };
                        nonCoveredTypeMap[k].photoCount++;
                    });
                });

                const sevRGB = { severe: [220, 38, 38], moderate: [245, 158, 11], minor: [59, 130, 246], none: [107, 114, 128] };
                const sc2 = sevRGB[severestSeverity] || sevRGB.none;
                doc.setFillColor(sc2[0], sc2[1], sc2[2]);
                doc.rect(margin, spY, contentWidth, 22, 'F');
                doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                doc.text(`Photos Analyzed: ${analyzedPhotos.length} / ${photoMedia.length}   |   Overall Severity: ${severestSeverity.toUpperCase()}`, margin + 5, spY + 7);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
                doc.text(`Hail Impacts: ${totalHail}   |   Wind Damage: ${totalWind}   |   Missing Shingles: ${totalMissing}`, margin + 5, spY + 13);
                doc.text(`Coverage Verdicts: ${verdictCounts.covered || 0} Covered   ${verdictCounts.mixed || 0} Mixed   ${verdictCounts.not_covered || 0} Not Covered`, margin + 5, spY + 19);
                spY += 27;

                const xCodeMap = [
                    { types: ['hail', 'hail damage', 'hail impacts', 'impact damage', 'hail hits', 'bruising'], code: 'RFG 240', description: 'Dimensional Shingles - Remove & Replace', unit: 'SQ', category: 'Roofing' },
                    { types: ['hail', 'storm', 'drip edge', 'metal edge'], code: 'RFG DE', description: 'Drip Edge - Metal', unit: 'LF', category: 'Roofing' },
                    { types: ['hail', 'storm', 'ridge', 'ridge cap'], code: 'RFG RDG', description: 'Ridge Cap - Architectural', unit: 'LF', category: 'Roofing' },
                    { types: ['hail', 'ice', 'water', 'storm', 'ice & water'], code: 'RFG IWS', description: 'Ice & Water Shield', unit: 'SQ', category: 'Roofing' },
                    { types: ['wind', 'wind damage', 'wind uplift', 'lifted', 'blown', 'crease', 'missing'], code: 'RFG UL', description: 'Underlayment - Synthetic', unit: 'SQ', category: 'Roofing' },
                    { types: ['wind', 'flashing', 'step flashing'], code: 'RFG FLS', description: 'Step Flashing - Metal', unit: 'LF', category: 'Roofing' },
                    { types: ['valley', 'valley metal'], code: 'RFG VM', description: 'Valley Metal', unit: 'LF', category: 'Roofing' },
                    { types: ['pipe boot', 'pipe jack', 'boot', 'plumbing'], code: 'RFG PJ', description: 'Pipe Jack / Boot - Replace', unit: 'EA', category: 'Roofing' },
                    { types: ['skylight', 'sky light'], code: 'RFG SKLT', description: 'Skylight - Replace', unit: 'EA', category: 'Roofing' },
                    { types: ['gutter', 'gutters', 'gutter damage'], code: 'GTR ALUM', description: 'Gutters - Aluminum', unit: 'LF', category: 'Exterior' },
                    { types: ['downspout', 'downspouts'], code: 'GTR DS', description: 'Downspout', unit: 'LF', category: 'Exterior' },
                    { types: ['fascia', 'fascia board'], code: 'GTR FAS', description: 'Fascia Board', unit: 'LF', category: 'Exterior' },
                    { types: ['soffit'], code: 'SFG SOFT', description: 'Soffit', unit: 'LF', category: 'Exterior' },
                    { types: ['siding', 'vinyl siding', 'siding damage'], code: 'SFG VSDN', description: 'Siding - Vinyl - Remove & Replace', unit: 'SQ', category: 'Exterior' },
                    { types: ['window', 'window screen', 'screen'], code: 'WND SCRN', description: 'Window Screen - Replace', unit: 'EA', category: 'Exterior' },
                ];

                const matchedCodes = new Set();
                const lineItems = [];
                const coveredKeys = Object.keys(coveredTypeMap);
                coveredKeys.forEach(k => {
                    xCodeMap.forEach(m => {
                        if (!matchedCodes.has(m.code) && m.types.some(t => k.includes(t) || t.includes(k.split(' ')[0]))) {
                            matchedCodes.add(m.code);
                            lineItems.push({ ...m, triggeredBy: coveredTypeMap[k].type });
                        }
                    });
                });
                if (totalHail > 0) ['RFG 240', 'RFG DE', 'RFG RDG', 'RFG IWS'].forEach(c => { if (!matchedCodes.has(c)) { const m = xCodeMap.find(x => x.code === c); if (m) { matchedCodes.add(c); lineItems.push({ ...m, triggeredBy: 'Hail Damage' }); }}});
                if (totalWind > 0 || totalMissing > 0) ['RFG UL', 'RFG FLS'].forEach(c => { if (!matchedCodes.has(c)) { const m = xCodeMap.find(x => x.code === c); if (m) { matchedCodes.add(c); lineItems.push({ ...m, triggeredBy: 'Wind/Missing Damage' }); }}});

                if (lineItems.length > 0) {
                    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
                    doc.text('Xactimate / iTel Recommended Line Item Codes', margin, spY);
                    spY += 7;
                    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                    doc.rect(margin, spY, contentWidth, 8, 'F');
                    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                    doc.text('#', margin + 2, spY + 5.5);
                    doc.text('Code', margin + 10, spY + 5.5);
                    doc.text('Description', margin + 38, spY + 5.5);
                    doc.text('Unit', margin + 130, spY + 5.5);
                    doc.text('Category', margin + 148, spY + 5.5);
                    spY += 10;
                    lineItems.forEach((li, idx) => {
                        if (spY > pageHeight - 20) { doc.addPage(); spY = 20; }
                        if (idx % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, spY - 2, contentWidth, 7, 'F'); }
                        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
                        doc.text(String(idx + 1), margin + 2, spY + 3);
                        doc.text(String(li.code), margin + 10, spY + 3);
                        doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
                        doc.text(String(li.description), margin + 38, spY + 3);
                        doc.text(String(li.unit), margin + 130, spY + 3);
                        doc.setTextColor(100, 100, 100);
                        doc.text(String(li.category), margin + 148, spY + 3);
                        spY += 7;
                    });
                    spY += 5;
                    doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(120, 120, 120);
                    doc.text('* AI-suggested codes based on photo analysis. Final scope to be confirmed by licensed adjuster or estimator.', margin, spY);
                }

                if (Object.keys(nonCoveredTypeMap).length > 0) {
                    spY += 10;
                    if (spY > pageHeight - 50) { doc.addPage(); spY = 20; }
                    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(153, 27, 27);
                    doc.text('Pre-existing / Not Covered Conditions', margin, spY);
                    spY += 5;
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 80, 80);
                    Object.values(nonCoveredTypeMap).forEach(ni => {
                        if (spY > pageHeight - 15) { doc.addPage(); spY = 20; }
                        doc.text(`• ${ni.type} — found in ${ni.photoCount} photo(s), ${ni.confidence}% confidence`, margin + 4, spY);
                        spY += 5;
                    });
                }
                doc.setTextColor(0);
            }

            // Add estimate section if linked
            if (linkedEstimate) {
                doc.addPage();
                
                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.rect(0, 10, pageWidth, 12, 'F');
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(255, 255, 255);
                doc.text(String(t.estimateSummary), pageWidth / 2, 18, { align: 'center' });
                
                let yPos = 30;
                
                // Company logo
                if (myCompany?.logo_url) {
                    const estLogoH = await loadLogoForPdf(myCompany.logo_url, doc, margin, yPos, 35, 14);
                    if (estLogoH > 0) yPos += estLogoH + 2;
                }

                // Company info (left side)
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 0, 0);
                doc.text(String(myCompany?.company_name || t.companyName), margin, yPos);
                yPos += 4;
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(60, 60, 60);
                if (myCompany?.address) { doc.text(String(myCompany.address), margin, yPos); yPos += 4; }
                if (myCompany?.city || myCompany?.state || myCompany?.zip) { doc.text(String([myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', ')), margin, yPos); yPos += 4; }
                if (myCompany?.phone) {
                    doc.text(String(t.phone + ": " + myCompany.phone), margin, yPos);
                    yPos += 4;
                }
                if (myCompany?.email) {
                    doc.text(String(t.email + ": " + myCompany.email), margin, yPos);
                    yPos += 4;
                }
                
                // Estimate number on right
                let rightY = 30;
                doc.setFontSize(20);
                doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.setFont('helvetica', 'bold');
                doc.text(String(t.estimate), pageWidth - margin, rightY, { align: 'right' });
                rightY += 6;
                doc.setFontSize(9);
                doc.setTextColor(100, 100, 100);
                doc.setFont('helvetica', 'normal');
                doc.text(String(`# ${linkedEstimate.estimate_number}`), pageWidth - margin, rightY, { align: 'right' });
                
                yPos = Math.max(yPos, rightY) + 6;

                // Customer info box
                doc.setFillColor(245, 247, 250);
                const cbY = yPos;
                doc.rect(margin, cbY, contentWidth, 28, 'F');
                doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
                doc.text('BILL TO:', margin + 4, cbY + 6);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(40, 40, 40);
                let cY = cbY + 11;
                doc.text(String(currentClientName || linkedEstimate.customer_name || 'N/A'), margin + 4, cY); cY += 4;
            if (job?.property_address || linkedEstimate.property_address) { doc.text(String(job?.property_address || linkedEstimate.property_address), margin + 4, cY); cY += 4; }
            if (job?.client_phone || linkedEstimate.customer_phone) { doc.text(String(`Phone: ${job?.client_phone || linkedEstimate.customer_phone}`), margin + 4, cY); cY += 4; }
            if (job?.client_email || linkedEstimate.customer_email) { doc.text(String(`Email: ${job?.client_email || linkedEstimate.customer_email}`), margin + 4, cY); }
            if (job?.insurance_claim_number || linkedEstimate.claim_number) { doc.text(String(`Claim #: ${job?.insurance_claim_number || linkedEstimate.claim_number}`), pageWidth - margin - 4, cbY + 11, { align: 'right' }); }
            if (job?.insurance_company || linkedEstimate.insurance_company) { doc.text(String(`Insurance: ${job?.insurance_company || linkedEstimate.insurance_company}`), pageWidth - margin - 4, cbY + 15, { align: 'right' }); }
                yPos = cbY + 32;
                
                const items = linkedEstimate.items || linkedEstimate.line_items || [];
                
                if (items.length > 0) {
                    // Table header
                    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                    doc.rect(margin, yPos, contentWidth, 8, 'F');
                    
                    doc.setFontSize(8);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(255, 255, 255);
                    doc.text(String('#'), margin + 2, yPos + 5.5);
                    doc.text(String('Description'), margin + 10, yPos + 5.5);
                    doc.text(String('Qty'), 115, yPos + 5.5, { align: 'right' });
                    doc.text(String('Unit'), 130, yPos + 5.5);
                    doc.text(String('Rate'), 150, yPos + 5.5, { align: 'right' });
                    doc.text(String('Amount'), pageWidth - margin - 2, yPos + 5.5, { align: 'right' });
                    
                    yPos += 10;
                    
                    let subtotal = 0;
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(0, 0, 0);
                    
                    items.forEach((item, index) => {
                        if (yPos > pageHeight - 40) {
                            doc.addPage();
                            yPos = 20;
                        }
                        
                        if (index % 2 === 0) {
                            doc.setFillColor(248, 250, 252);
                            doc.rect(margin, yPos - 3, contentWidth, 6, 'F');
                        }
                        
                        doc.setFontSize(7);
                        doc.text(String(index + 1), margin + 2, yPos + 2);
                        
                        const desc = item.description || t.item;
                        const descLines = doc.splitTextToSize(desc, 95);
                        doc.text(String(descLines[0]), margin + 10, yPos + 2);
                        
                        const qty = parseFloat(item.quantity) || 0;
                        const rate = parseFloat(item.rate) || 0;
                        const amount = parseFloat(item.amount) || 0;
                        
                        doc.text(String(qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2)), 115, yPos + 2, { align: 'right' });
                          doc.text(String(item.unit || t.each), 130, yPos + 2);
                        doc.text(`$${rate.toFixed(2)}`, 150, yPos + 2, { align: 'right' });
                        doc.text(`$${amount.toFixed(2)}`, pageWidth - margin - 2, yPos + 2, { align: 'right' });
                        
                        subtotal += amount;
                        yPos += 6;
                    });
                    
                    // Total line
                    yPos += 5;
                    doc.setDrawColor(200, 200, 200);
                    doc.line(margin, yPos, pageWidth - margin, yPos);
                    yPos += 8;
                    
                    doc.setFontSize(11);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
                    doc.text(String('TOTAL'), 145, yPos);
                    doc.text(String(`$${subtotal.toFixed(2)}`), pageWidth - margin - 2, yPos, { align: 'right' });
                }

                // Estimate notes
                if (linkedEstimate.notes) {
                    yPos += 15;
                    if (yPos > pageHeight - 60) { doc.addPage(); yPos = 20; }
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(0, 0, 0);
                    doc.text('NOTES:', margin, yPos);
                    yPos += 5;
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(40, 40, 40);
                    const noteLines = doc.splitTextToSize(linkedEstimate.notes, contentWidth);
                    noteLines.forEach(line => { if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; } doc.text(String(line), margin, yPos); yPos += 4; });
                }

                // Disclaimer
                yPos += 10;
                if (yPos > pageHeight - 60) { doc.addPage(); yPos = 20; }
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 0, 0);
                doc.text(String(t.disclaimer_label), margin, yPos);
                yPos += 5;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.setTextColor(40, 40, 40);
            const disclaimerTextExport = typeof t.disclaimer === 'function' ? t.disclaimer(myCompany?.company_name || t.companyName) : t.disclaimer;
                const disclaimerLinesExport = doc.splitTextToSize(disclaimerTextExport, contentWidth);
                disclaimerLinesExport.forEach(line => { if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; } doc.text(String(line), margin, yPos); yPos += 3.5; });
            }

            // Inspector signature
            if (inspectorSignature) {
                doc.addPage();
                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.rect(0, 10, pageWidth, 12, 'F');
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(255, 255, 255);
                  doc.text(String(t.inspectorCertification), pageWidth / 2, 18, { align: 'center' });
                
                let yPos = 40;
                
                doc.setFontSize(10);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(60, 60, 60);
                const certText = t.certificationText;
                const certLines = doc.splitTextToSize(certText, contentWidth);
                doc.text(String(certLines), margin, yPos);
                yPos += (certLines.length * 5) + 15;
                
                doc.setFillColor(245, 247, 250);
                doc.rect(margin, yPos, 90, 45, 'F');
                doc.setDrawColor(200, 200, 200);
                doc.rect(margin, yPos, 90, 45);
                
                yPos += 5;
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(80, 80, 80);
                doc.text(String(t.inspectorSignature + ':'), margin + 5, yPos + 3);
                
                try {
                    doc.addImage(inspectorSignature, 'PNG', margin + 5, yPos + 6, 70, 25);
                } catch (error) {
                    console.error('❌ Error adding signature:', error);
                }
                
                yPos += 35;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.text(String(`${t.date}: ${new Date().toLocaleDateString(t.dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })}`), margin + 5, yPos);
            }
            
            // Add footer to all pages
            const totalPages = doc.internal.pages.length - 1;
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                doc.setFontSize(7);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(150, 150, 150);
                
                const footerText = `${myCompany?.company_name || t.inspectionReport} | ${myCompany?.phone || ''} | ${myCompany?.email || ''}`;
                doc.text(String(footerText), pageWidth / 2, pageHeight - 13, { align: 'center' });
                doc.text(String(t.pageOf(i, totalPages)), pageWidth / 2, pageHeight - 8, { align: 'center' });
            }

            doc.save(`PhotoSync_${job?.property_address?.replace(/[^a-zA-Z0-9]/g, '_') || 'Report'}_${Date.now()}.pdf`);
            
            alert(`✅ PDF exported with ${photoMedia.length} photos!`);

        } catch (error) {
            console.error("❌ PDF Export Error:", error);
            alert(`❌ Failed to export PDF: ${error.message}`);
        }

        setIsExporting(false);
        setReportBuildProgress('');
    };

    const handleViewPDF = async () => {
        if (!jobId) {
            alert("Please save the inspection first.");
            return;
        }

        setIsViewing(true);

        try {
            const photoMedia = media.filter(item => item.file_type === 'photo');

            if (photoMedia.length === 0) {
                alert("⚠️ No photos found.");
                setIsExporting(false);
                return;
            }

            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 20;
            const contentWidth = pageWidth - (margin * 2);

            // Brand color
            const hexToRgb = (hex) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? {
                    r: parseInt(result[1], 16),
                    g: parseInt(result[2], 16),
                    b: parseInt(result[3], 16)
                } : { r: 30, g: 58, b: 138 };
            };
            
            const primaryColor = myCompany?.brand_primary_color 
                ? hexToRgb(myCompany.brand_primary_color) 
                : { r: 30, g: 58, b: 138 };

            // Cover page with professional design
            let y = 20;
            
            // Add company logo (aspect-ratio preserved)
            if (myCompany?.logo_url) {
                const coverLogoH = await loadLogoForPdf(myCompany.logo_url, doc, 18, y, 40, 25);
                if (coverLogoH > 0) y += coverLogoH + 5;
            }
            
            // Company info - LARGER AND MORE PROMINENT
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(String(myCompany?.company_name || t.companyName), margin, y);
            y += 8;
            
            doc.setFontSize(11);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(60, 60, 60);
            
            if (myCompany?.address) {
                doc.text(String(myCompany.address), margin, y);
                y += 6;
            }
            
            if (myCompany?.city || myCompany?.state || myCompany?.zip) {
                const cityStateZip = [myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', ');
                doc.text(String(cityStateZip), margin, y);
                y += 6;
            }
            
            if (myCompany?.phone) {
                doc.text(String(t.phone + ": " + myCompany.phone), margin, y);
                y += 6;
            }
            
            if (myCompany?.email) {
                doc.text(String(t.email + ": " + myCompany.email), margin, y);
                y += 6;
            }
            
            if (myCompany?.company_website) {
                doc.text(String(t.web + ": " + myCompany.company_website), margin, y);
                y += 6;
            }
            
            // Title section with branded color
            y = 80;
            doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
            doc.rect(0, y, pageWidth, 25, 'F');
            
            doc.setFontSize(28);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(255, 255, 255);
            doc.text(String(t.inspectionReport), pageWidth / 2, y + 16, { align: 'center' });
            
            // Property details box
            y = 125;
            doc.setFillColor(245, 247, 250);
            doc.rect(margin, y, contentWidth, 65, 'F');
            
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(String(t.propertyInformation), margin + 5, y + 8);
            
            y += 15;
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(60, 60, 60);
            doc.text(String(t.propertyAddress + ": " + (job.property_address || t.na)), margin + 5, y);
            y += 5;
            doc.text(String(t.clientName + ": " + (currentClientName || t.na)), margin + 5, y);
            y += 5;
            if (job.client_email) {
                doc.text(String(t.clientEmail + ": " + job.client_email), margin + 5, y);
                y += 5;
            }
            if (job.client_phone) {
                doc.text(String(t.clientPhone + ": " + job.client_phone), margin + 5, y);
                y += 5;
            }
            doc.text(String(t.inspectionDate + ": " + new Date(job.inspection_date || job.created_date).toLocaleDateString(t.dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })), margin + 5, y);
            y += 5;
            if (job.insurance_claim_number) {
                doc.text(String(t.claimNumber + ": " + job.insurance_claim_number), margin + 5, y);
                y += 5;
            }
            if (job.insurance_company) {
                doc.text(String(t.insuranceCompany + ": " + job.insurance_company), margin + 5, y);
                y += 5;
            }
            if (job.date_of_loss) {
                try { doc.text(String('Date of Loss: ' + new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })), margin + 5, y); } catch { doc.text(String('Date of Loss: ' + job.date_of_loss), margin + 5, y); }
                y += 5;
            }
            if (job.damage_type) {
                doc.text(String('Type of Loss: ' + job.damage_type), margin + 5, y);
            }

            // Scope of Work & Notes page (only added when either has content)
            addScopeAndNotesToPdf(doc, { pageWidth, pageHeight, margin, contentWidth, primaryColor });

            // Group images by section
            const imagesBySection = {};
            photoMedia.forEach(item => {
                const section = item.section || 'Other';
                if (!imagesBySection[section]) {
                    imagesBySection[section] = [];
                }
                imagesBySection[section].push(item);
            });

            const reportImages = createReportImageQueue(Object.values(imagesBySection).flat(), jobId, {
                onProgress: (count, total) => setReportBuildProgress(`Preparing photo ${count} of ${total}`),
            });
            // Add sections with photos
            for (const [section, images] of Object.entries(imagesBySection)) {
                let sectionProcessed = 0;
                doc.addPage();
                
                // Section header with branded bar
                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.rect(0, 10, pageWidth, 12, 'F');
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(255, 255, 255);
                doc.text(String(section), pageWidth / 2, 18, { align: 'center' });
                
                let yPos = 30;
                
                if (sectionNotes && sectionNotes[section]) {
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(60, 60, 60);
                    const lines = doc.splitTextToSize(sectionNotes[section], contentWidth);
                    doc.text(String(lines), margin, yPos);
                    yPos += (lines.length * 4) + 8;
                }

                for (const item of images) {
                    const imgWidth = contentWidth;
                    let imgHeight = 100;
                    try {
                        const prepared = await reportImages.next(item);
                        const imageDataUrl = prepared.dataUrl;
                        imgHeight = Math.min((imgWidth * prepared.height) / prepared.width, pageHeight - 60);

                        if (yPos + imgHeight > pageHeight - 30) {
                            doc.addPage();
                            doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                            doc.rect(0, 10, pageWidth, 12, 'F');
                            doc.setFontSize(14);
                            doc.setFont('helvetica', 'bold');
                            doc.setTextColor(255, 255, 255);
                            doc.text(`${section} ${t.continued}`, pageWidth / 2, 18, { align: 'center' });
                            yPos = 30;
                        }

                        doc.setDrawColor(200, 200, 200);
                        doc.setLineWidth(0.3);
                        doc.rect(margin, yPos, imgWidth, imgHeight);
                        doc.addImage(imageDataUrl, 'JPEG', margin + 1, yPos + 1, imgWidth - 2, imgHeight - 2);
                        
                        yPos += imgHeight + 5;

                        if (item.caption) {
                            doc.setFontSize(10);
                            doc.setFont('helvetica', 'normal');
                            doc.setTextColor(60, 60, 60);
                            const captionLines = doc.splitTextToSize(item.caption, contentWidth);
                            doc.text(String(captionLines), margin, yPos);
                            yPos += (captionLines.length * 4.5) + 4;
                            doc.setTextColor(0);
                        } else {
                            yPos += 4;
                        }
                        { const metaParts = []; if (item.uploaded_by_name) metaParts.push(item.uploaded_by_name); const _ts = item.created_at || item.created_date; if (_ts) { try { metaParts.push(new Date(_ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })); } catch {} } if (metaParts.length > 0) { doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(150, 150, 150); doc.text(String(metaParts.join('  |  ')), margin, yPos); yPos += 5; doc.setTextColor(0); } }

                        // AI Analysis Block
                        const aiData = item.ai_damage_analysis;
                        if (aiData) {
                            if (yPos > pageHeight - 60) {
                                doc.addPage();
                                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                                doc.rect(0, 10, pageWidth, 12, 'F');
                                doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                                doc.text(`${section} ${t.continued}`, pageWidth / 2, 18, { align: 'center' });
                                yPos = 30;
                            }
                            const sevColors = { severe: [220, 38, 38], moderate: [245, 158, 11], minor: [59, 130, 246], none: [107, 114, 128] };
                            const sev = (aiData.severity || 'none').toLowerCase();
                            const sc = sevColors[sev] || sevColors.none;
                            doc.setFillColor(sc[0], sc[1], sc[2]);
                            doc.rect(margin, yPos, contentWidth, 6, 'F');
                            doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                            const sevLabel = sev.charAt(0).toUpperCase() + sev.slice(1);
                            const verdictLabel = aiData.coverage_verdict === 'covered' ? 'COVERED' : aiData.coverage_verdict === 'not_covered' ? 'NOT COVERED' : 'MIXED';
                            doc.text(`AI ANALYSIS  |  Severity: ${sevLabel}  |  Coverage Verdict: ${verdictLabel}`, margin + 3, yPos + 4.2);
                            yPos += 8;
                            doc.setFillColor(248, 250, 252); doc.rect(margin, yPos, contentWidth, 7, 'F');
                            doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
                            const photoCounts = [];
                            if (aiData.hail_hits_counted > 0) photoCounts.push(`Hail Impacts: ${aiData.hail_hits_counted}`);
                            if (aiData.wind_marks_counted > 0) photoCounts.push(`Wind Damage: ${aiData.wind_marks_counted}`);
                            if (aiData.missing_count > 0) photoCounts.push(`Missing: ${aiData.missing_count}`);
                            if (aiData.photo_quality_score) photoCounts.push(`Photo Quality: ${aiData.photo_quality_score}%`);
                            if (photoCounts.length > 0) doc.text(photoCounts.join('    |    '), margin + 3, yPos + 4.5);
                            yPos += 9;
                            if (aiData.ai_notes) {
                                const noteLines = doc.splitTextToSize(String(aiData.ai_notes), contentWidth - 4);
                                const maxLines = Math.min(noteLines.length, 10);
                                doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40);
                                doc.text(noteLines.slice(0, maxLines), margin + 2, yPos + 3);
                                yPos += (maxLines * 3.8) + 4;
                            }
                            if (aiData.covered_items?.length > 0) {
                                doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(22, 101, 52);
                                doc.text('Insurance-Covered Damage:', margin + 2, yPos);
                                yPos += 4; doc.setFont('helvetica', 'normal');
                                aiData.covered_items.slice(0, 5).forEach(ci => {
                                    const txt = `  + ${ci.type} — ${ci.confidence}% confidence${ci.description ? ': ' + ci.description : ''}`;
                                    const cLines = doc.splitTextToSize(txt, contentWidth - 6);
                                    doc.text(cLines[0], margin + 4, yPos);
                                    yPos += 4;
                                });
                                yPos += 2;
                            }
                            if (aiData.non_covered_items?.length > 0) {
                                doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(153, 27, 27);
                                doc.text('Pre-existing / Not Covered:', margin + 2, yPos);
                                yPos += 4; doc.setFont('helvetica', 'normal');
                                aiData.non_covered_items.slice(0, 4).forEach(ni => {
                                    const txt = `  - ${ni.type} — ${ni.confidence}% confidence${ni.description ? ': ' + ni.description : ''}`;
                                    const nLines = doc.splitTextToSize(txt, contentWidth - 6);
                                    doc.text(nLines[0], margin + 4, yPos);
                                    yPos += 4;
                                });
                                yPos += 2;
                            }
                            doc.setTextColor(0);
                            yPos += 8;
                        } else {
                            yPos += 5;
                        }

                    } catch (error) {
                        throw new Error(`Cannot preview an incomplete report: ${error.message}`);
                    }
                    if (++sectionProcessed % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // Damage Summary & Xactimate Line Items Page
            const analyzedPhotos = photoMedia.filter(p => p.ai_damage_analysis);
            if (analyzedPhotos.length > 0) {
                doc.addPage();
                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.rect(0, 10, pageWidth, 12, 'F');
                doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                doc.text('Damage Summary & Recommended Line Items', pageWidth / 2, 18, { align: 'center' });
                let spY = 28;

                let totalHail = 0, totalWind = 0, totalMissing = 0;
                const coveredTypeMap = {}, nonCoveredTypeMap = {};
                const verdictCounts = { covered: 0, mixed: 0, not_covered: 0 };
                let severestSeverity = 'none';
                const sevOrder = ['none', 'minor', 'moderate', 'severe'];
                analyzedPhotos.forEach(p => {
                    const ai = p.ai_damage_analysis;
                    totalHail += (ai.hail_hits_counted || 0);
                    totalWind += (ai.wind_marks_counted || 0);
                    totalMissing += (ai.missing_count || 0);
                    if (ai.coverage_verdict) verdictCounts[ai.coverage_verdict] = (verdictCounts[ai.coverage_verdict] || 0) + 1;
                    if (sevOrder.indexOf(ai.severity) > sevOrder.indexOf(severestSeverity)) severestSeverity = ai.severity;
                    (ai.covered_items || []).forEach(ci => {
                        const k = (ci.type || '').toLowerCase();
                        if (!coveredTypeMap[k]) coveredTypeMap[k] = { ...ci, photoCount: 0 };
                        coveredTypeMap[k].photoCount++;
                        coveredTypeMap[k].confidence = Math.max(coveredTypeMap[k].confidence, ci.confidence || 0);
                    });
                    (ai.non_covered_items || []).forEach(ni => {
                        const k = (ni.type || '').toLowerCase();
                        if (!nonCoveredTypeMap[k]) nonCoveredTypeMap[k] = { ...ni, photoCount: 0 };
                        nonCoveredTypeMap[k].photoCount++;
                    });
                });

                const sevRGB = { severe: [220, 38, 38], moderate: [245, 158, 11], minor: [59, 130, 246], none: [107, 114, 128] };
                const sc2 = sevRGB[severestSeverity] || sevRGB.none;
                doc.setFillColor(sc2[0], sc2[1], sc2[2]);
                doc.rect(margin, spY, contentWidth, 22, 'F');
                doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                doc.text(`Photos Analyzed: ${analyzedPhotos.length} / ${photoMedia.length}   |   Overall Severity: ${severestSeverity.toUpperCase()}`, margin + 5, spY + 7);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
                doc.text(`Hail Impacts: ${totalHail}   |   Wind Damage: ${totalWind}   |   Missing Shingles: ${totalMissing}`, margin + 5, spY + 13);
                doc.text(`Coverage Verdicts: ${verdictCounts.covered || 0} Covered   ${verdictCounts.mixed || 0} Mixed   ${verdictCounts.not_covered || 0} Not Covered`, margin + 5, spY + 19);
                spY += 27;

                const xCodeMap = [
                    { types: ['hail', 'hail damage', 'hail impacts', 'impact damage', 'hail hits', 'bruising'], code: 'RFG 240', description: 'Dimensional Shingles - Remove & Replace', unit: 'SQ', category: 'Roofing' },
                    { types: ['hail', 'storm', 'drip edge', 'metal edge'], code: 'RFG DE', description: 'Drip Edge - Metal', unit: 'LF', category: 'Roofing' },
                    { types: ['hail', 'storm', 'ridge', 'ridge cap'], code: 'RFG RDG', description: 'Ridge Cap - Architectural', unit: 'LF', category: 'Roofing' },
                    { types: ['hail', 'ice', 'water', 'storm', 'ice & water'], code: 'RFG IWS', description: 'Ice & Water Shield', unit: 'SQ', category: 'Roofing' },
                    { types: ['wind', 'wind damage', 'wind uplift', 'lifted', 'blown', 'crease', 'missing'], code: 'RFG UL', description: 'Underlayment - Synthetic', unit: 'SQ', category: 'Roofing' },
                    { types: ['wind', 'flashing', 'step flashing'], code: 'RFG FLS', description: 'Step Flashing - Metal', unit: 'LF', category: 'Roofing' },
                    { types: ['valley', 'valley metal'], code: 'RFG VM', description: 'Valley Metal', unit: 'LF', category: 'Roofing' },
                    { types: ['pipe boot', 'pipe jack', 'boot', 'plumbing'], code: 'RFG PJ', description: 'Pipe Jack / Boot - Replace', unit: 'EA', category: 'Roofing' },
                    { types: ['skylight', 'sky light'], code: 'RFG SKLT', description: 'Skylight - Replace', unit: 'EA', category: 'Roofing' },
                    { types: ['gutter', 'gutters', 'gutter damage'], code: 'GTR ALUM', description: 'Gutters - Aluminum', unit: 'LF', category: 'Exterior' },
                    { types: ['downspout', 'downspouts'], code: 'GTR DS', description: 'Downspout', unit: 'LF', category: 'Exterior' },
                    { types: ['fascia', 'fascia board'], code: 'GTR FAS', description: 'Fascia Board', unit: 'LF', category: 'Exterior' },
                    { types: ['soffit'], code: 'SFG SOFT', description: 'Soffit', unit: 'LF', category: 'Exterior' },
                    { types: ['siding', 'vinyl siding', 'siding damage'], code: 'SFG VSDN', description: 'Siding - Vinyl - Remove & Replace', unit: 'SQ', category: 'Exterior' },
                    { types: ['window', 'window screen', 'screen'], code: 'WND SCRN', description: 'Window Screen - Replace', unit: 'EA', category: 'Exterior' },
                ];

                const matchedCodes = new Set();
                const lineItems = [];
                const coveredKeys = Object.keys(coveredTypeMap);
                coveredKeys.forEach(k => {
                    xCodeMap.forEach(m => {
                        if (!matchedCodes.has(m.code) && m.types.some(t => k.includes(t) || t.includes(k.split(' ')[0]))) {
                            matchedCodes.add(m.code);
                            lineItems.push({ ...m, triggeredBy: coveredTypeMap[k].type });
                        }
                    });
                });
                if (totalHail > 0) ['RFG 240', 'RFG DE', 'RFG RDG', 'RFG IWS'].forEach(c => { if (!matchedCodes.has(c)) { const m = xCodeMap.find(x => x.code === c); if (m) { matchedCodes.add(c); lineItems.push({ ...m, triggeredBy: 'Hail Damage' }); }}});
                if (totalWind > 0 || totalMissing > 0) ['RFG UL', 'RFG FLS'].forEach(c => { if (!matchedCodes.has(c)) { const m = xCodeMap.find(x => x.code === c); if (m) { matchedCodes.add(c); lineItems.push({ ...m, triggeredBy: 'Wind/Missing Damage' }); }}});

                if (lineItems.length > 0) {
                    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
                    doc.text('Xactimate / iTel Recommended Line Item Codes', margin, spY);
                    spY += 7;
                    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                    doc.rect(margin, spY, contentWidth, 8, 'F');
                    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                    doc.text('#', margin + 2, spY + 5.5);
                    doc.text('Code', margin + 10, spY + 5.5);
                    doc.text('Description', margin + 38, spY + 5.5);
                    doc.text('Unit', margin + 130, spY + 5.5);
                    doc.text('Category', margin + 148, spY + 5.5);
                    spY += 10;
                    lineItems.forEach((li, idx) => {
                        if (spY > pageHeight - 20) { doc.addPage(); spY = 20; }
                        if (idx % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, spY - 2, contentWidth, 7, 'F'); }
                        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
                        doc.text(String(idx + 1), margin + 2, spY + 3);
                        doc.text(String(li.code), margin + 10, spY + 3);
                        doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
                        doc.text(String(li.description), margin + 38, spY + 3);
                        doc.text(String(li.unit), margin + 130, spY + 3);
                        doc.setTextColor(100, 100, 100);
                        doc.text(String(li.category), margin + 148, spY + 3);
                        spY += 7;
                    });
                    spY += 5;
                    doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(120, 120, 120);
                    doc.text('* AI-suggested codes based on photo analysis. Final scope to be confirmed by licensed adjuster or estimator.', margin, spY);
                }

                if (Object.keys(nonCoveredTypeMap).length > 0) {
                    spY += 10;
                    if (spY > pageHeight - 50) { doc.addPage(); spY = 20; }
                    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(153, 27, 27);
                    doc.text('Pre-existing / Not Covered Conditions', margin, spY);
                    spY += 5;
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 80, 80);
                    Object.values(nonCoveredTypeMap).forEach(ni => {
                        if (spY > pageHeight - 15) { doc.addPage(); spY = 20; }
                        doc.text(`• ${ni.type} — found in ${ni.photoCount} photo(s), ${ni.confidence}% confidence`, margin + 4, spY);
                        spY += 5;
                    });
                }
                doc.setTextColor(0);
            }

            // Add estimate section if linked
            if (linkedEstimate) {
                doc.addPage();
                
                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.rect(0, 10, pageWidth, 12, 'F');
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(255, 255, 255);
                doc.text(String(t.estimateSummary), pageWidth / 2, 18, { align: 'center' });
                
                let yPos = 30;
                
                // Company logo
                if (myCompany?.logo_url) {
                    const estLogoH = await loadLogoForPdf(myCompany.logo_url, doc, margin, yPos, 35, 14);
                    if (estLogoH > 0) yPos += estLogoH + 2;
                }

                // Company info (left side)
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 0, 0);
                doc.text(String(myCompany?.company_name || t.companyName), margin, yPos);
                yPos += 4;
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(60, 60, 60);
                if (myCompany?.address) { doc.text(String(myCompany.address), margin, yPos); yPos += 4; }
                if (myCompany?.city || myCompany?.state || myCompany?.zip) { doc.text(String([myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', ')), margin, yPos); yPos += 4; }
                if (myCompany?.phone) {
                    doc.text(String(t.phone + ": " + myCompany.phone), margin, yPos);
                    yPos += 4;
                }
                if (myCompany?.email) {
                    doc.text(String(t.email + ": " + myCompany.email), margin, yPos);
                    yPos += 4;
                }
                
                // Estimate number on right
                let rightY = 30;
                doc.setFontSize(20);
                doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.setFont('helvetica', 'bold');
                doc.text(String(t.estimate), pageWidth - margin, rightY, { align: 'right' });
                rightY += 6;
                doc.setFontSize(9);
                doc.setTextColor(100, 100, 100);
                doc.setFont('helvetica', 'normal');
                doc.text(String(`# ${linkedEstimate.estimate_number}`), pageWidth - margin, rightY, { align: 'right' });
                
                yPos = Math.max(yPos, rightY) + 6;

                // Customer info box
                doc.setFillColor(245, 247, 250);
                const cbY = yPos;
                doc.rect(margin, cbY, contentWidth, 28, 'F');
                doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
                doc.text('BILL TO:', margin + 4, cbY + 6);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(40, 40, 40);
                let cY = cbY + 11;
                doc.text(String(currentClientName || linkedEstimate.customer_name || 'N/A'), margin + 4, cY); cY += 4;
            if (job?.property_address || linkedEstimate.property_address) { doc.text(String(job?.property_address || linkedEstimate.property_address), margin + 4, cY); cY += 4; }
            if (job?.client_phone || linkedEstimate.customer_phone) { doc.text(String(`Phone: ${job?.client_phone || linkedEstimate.customer_phone}`), margin + 4, cY); cY += 4; }
            if (job?.client_email || linkedEstimate.customer_email) { doc.text(String(`Email: ${job?.client_email || linkedEstimate.customer_email}`), margin + 4, cY); }
            if (job?.insurance_claim_number || linkedEstimate.claim_number) { doc.text(String(`Claim #: ${job?.insurance_claim_number || linkedEstimate.claim_number}`), pageWidth - margin - 4, cbY + 11, { align: 'right' }); }
            if (job?.insurance_company || linkedEstimate.insurance_company) { doc.text(String(`Insurance: ${job?.insurance_company || linkedEstimate.insurance_company}`), pageWidth - margin - 4, cbY + 15, { align: 'right' }); }
                yPos = cbY + 32;
                
                const items = linkedEstimate.items || linkedEstimate.line_items || [];
                
                if (items.length > 0) {
                    // Table header
                    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                    doc.rect(margin, yPos, contentWidth, 8, 'F');
                    
                    doc.setFontSize(8);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(255, 255, 255);
                    doc.text(String('#'), margin + 2, yPos + 5.5);
                    doc.text(String('Description'), margin + 10, yPos + 5.5);
                    doc.text(String('Qty'), 115, yPos + 5.5, { align: 'right' });
                    doc.text(String('Unit'), 130, yPos + 5.5);
                    doc.text(String('Rate'), 150, yPos + 5.5, { align: 'right' });
                    doc.text(String('Amount'), pageWidth - margin - 2, yPos + 5.5, { align: 'right' });
                    
                    yPos += 10;
                    
                    let subtotal = 0;
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(0, 0, 0);
                    
                    items.forEach((item, index) => {
                        if (yPos > pageHeight - 40) {
                            doc.addPage();
                            yPos = 20;
                        }
                        
                        if (index % 2 === 0) {
                            doc.setFillColor(248, 250, 252);
                            doc.rect(margin, yPos - 3, contentWidth, 6, 'F');
                        }
                        
                        doc.setFontSize(7);
                        doc.text(String(index + 1), margin + 2, yPos + 2);
                        
                        const desc = item.description || t.item;
                        const descLines = doc.splitTextToSize(desc, 95);
                        doc.text(String(descLines[0]), margin + 10, yPos + 2);
                        
                        const qty = parseFloat(item.quantity) || 0;
                        const rate = parseFloat(item.rate) || 0;
                        const amount = parseFloat(item.amount) || 0;
                        
                        doc.text(String(qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2)), 115, yPos + 2, { align: 'right' });
                          doc.text(String(item.unit || t.each), 130, yPos + 2);
                        doc.text(`$${rate.toFixed(2)}`, 150, yPos + 2, { align: 'right' });
                        doc.text(`$${amount.toFixed(2)}`, pageWidth - margin - 2, yPos + 2, { align: 'right' });
                        
                        subtotal += amount;
                        yPos += 6;
                    });
                    
                    // Total line
                    yPos += 5;
                    doc.setDrawColor(200, 200, 200);
                    doc.line(margin, yPos, pageWidth - margin, yPos);
                    yPos += 8;
                    
                    doc.setFontSize(11);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
                    doc.text(String('TOTAL'), 145, yPos);
                    doc.text(String(`$${subtotal.toFixed(2)}`), pageWidth - margin - 2, yPos, { align: 'right' });
                }

                // Estimate notes
                if (linkedEstimate.notes) {
                    yPos += 15;
                    if (yPos > pageHeight - 60) { doc.addPage(); yPos = 20; }
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(0, 0, 0);
                    doc.text('NOTES:', margin, yPos);
                    yPos += 5;
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(40, 40, 40);
                    const noteLines = doc.splitTextToSize(linkedEstimate.notes, contentWidth);
                    noteLines.forEach(line => { if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; } doc.text(String(line), margin, yPos); yPos += 4; });
                }

                // Disclaimer
                yPos += 10;
                if (yPos > pageHeight - 60) { doc.addPage(); yPos = 20; }
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 0, 0);
                doc.text(t.disclaimer_label, margin, yPos);
                yPos += 5;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.setTextColor(40, 40, 40);
                const disclaimerTextView = t.disclaimer(myCompany?.company_name || t.companyName);
                const disclaimerLinesView = doc.splitTextToSize(disclaimerTextView, contentWidth);
                disclaimerLinesView.forEach(line => { if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; } doc.text(line, margin, yPos); yPos += 3.5; });
            }

            // Inspector signature
            if (inspectorSignature) {
                doc.addPage();
                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.rect(0, 10, pageWidth, 12, 'F');
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(255, 255, 255);
                  doc.text(String(t.inspectorCertification), pageWidth / 2, 18, { align: 'center' });
                
                let yPos = 40;
                
                doc.setFontSize(10);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(60, 60, 60);
                const certText = t.certificationText;
                const certLines = doc.splitTextToSize(certText, contentWidth);
                doc.text(String(certLines), margin, yPos);
                yPos += (certLines.length * 5) + 15;
                
                doc.setFillColor(245, 247, 250);
                doc.rect(margin, yPos, 90, 45, 'F');
                doc.setDrawColor(200, 200, 200);
                doc.rect(margin, yPos, 90, 45);
                
                yPos += 5;
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(80, 80, 80);
                doc.text(String(t.inspectorSignature + ':'), margin + 5, yPos + 3);
                
                try {
                    doc.addImage(inspectorSignature, 'PNG', margin + 5, yPos + 6, 70, 25);
                } catch (error) {
                    console.error('❌ Error adding signature:', error);
                }
                
                yPos += 35;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.text(String(`${t.date}: ${new Date().toLocaleDateString(t.dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })}`), margin + 5, yPos);
            }
            
            // Add footer to all pages
            const totalPages = doc.internal.pages.length - 1;
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                doc.setFontSize(7);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(150, 150, 150);
                
                const footerText = `${myCompany?.company_name || t.inspectionReport} | ${myCompany?.phone || ''} | ${myCompany?.email || ''}`;
                doc.text(String(footerText), pageWidth / 2, pageHeight - 13, { align: 'center' });
                doc.text(String(t.pageOf(i, totalPages)), pageWidth / 2, pageHeight - 8, { align: 'center' });
            }

            const blob = doc.output('blob');
            const url = URL.createObjectURL(blob);
            setPreviewPdfUrl(url);
            setShowPdfPreview(true);
        } catch (error) {
            console.error('Error generating PDF:', error);
            alert(`❌ Failed to view PDF: ${error.message}`);
        }

        setIsViewing(false);
        setReportBuildProgress('');
    };

    const handlePreviewFullReport = async () => {
        // Preview opens in new tab, download saves file
        await handleViewPDF();
    };

  const handleGenerateAndSendReport = async () => {
      if (!jobId) {
          alert("Please save the inspection first.");
          return;
      }
      if (sendReportInFlightRef.current) return;
      sendReportInFlightRef.current = true;

      setIsSendingReport(true);
      setSendingStatus('⏳ Generating PDF — this may take a moment with many photos...');

      try {
          console.log('📄 Generating PDF in frontend...');

          // Generate PDF using same logic as handleViewPDF
          const photoMedia = media.filter(m => m.file_type === 'photo');

          if (photoMedia.length === 0) {
              throw new Error('No photos found. Capture a photo before sending the report.');
          }
          // If the email submission response was lost, use the already-stored PDF
          // and the server's per-report/recipient send claims on retry. A changed
          // report is rebuilt rather than silently sending an older version.
          const reportFingerprint = JSON.stringify([
              jobId, photoMedia, sectionNotes, scopeOfWork, reportNotes,
              inspectorSignature, linkedEstimate, myCompany?.logo_url,
              itelStatus, applyStateCode, detectedState,
          ]);
          let reportId = retryReportRef.current?.fingerprint === reportFingerprint
              ? retryReportRef.current.reportId : null;
          if (!reportId) {

          const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
          const pageWidth = doc.internal.pageSize.getWidth();
          const pageHeight = doc.internal.pageSize.getHeight();
          const margin = 20;
          const contentWidth = pageWidth - (margin * 2);

          const hexToRgb = (hex) => {
              const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
              return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 30, g: 58, b: 138 };
          };

          const primaryColor = myCompany?.brand_primary_color ? hexToRgb(myCompany.brand_primary_color) : { r: 30, g: 58, b: 138 };

          // Cover page
          let y = 20;
          if (myCompany?.logo_url) {
              const coverLogoH3 = await loadLogoForPdf(myCompany.logo_url, doc, 18, y, 40, 25);
              if (coverLogoH3 > 0) y += coverLogoH3 + 5;
          }

          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);
          doc.text(myCompany?.company_name || t.companyName, margin, y);
          y += 8;

          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(60, 60, 60);
          if (myCompany?.address) { doc.text(myCompany.address, margin, y); y += 5; }
          if (myCompany?.city || myCompany?.state || myCompany?.zip) {
              doc.text([myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', '), margin, y);
              y += 5;
          }
          if (myCompany?.phone) { doc.text(`${t.phone}: ${myCompany.phone}`, margin, y); y += 5; }
          if (myCompany?.email) { doc.text(`${t.email}: ${myCompany.email}`, margin, y); y += 5; }

          y = 80;
          doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
          doc.rect(0, y, pageWidth, 25, 'F');
          doc.setFontSize(28);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255, 255, 255);
          doc.text(t.inspectionReport, pageWidth / 2, y + 16, { align: 'center' });

          y = 125;
          doc.setFillColor(245, 247, 250);
          doc.rect(margin, y, contentWidth, 65, 'F');
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);
          doc.text(t.propertyInformation, margin + 5, y + 8);
          y += 15;
          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(60, 60, 60);
          doc.text(`${t.propertyAddress}: ${job.property_address || t.na}`, margin + 5, y); y += 5;
          doc.text(`${t.clientName}: ${currentClientName || t.na}`, margin + 5, y); y += 5;
          if (job.client_email) { doc.text(`${t.clientEmail}: ${job.client_email}`, margin + 5, y); y += 5; }
          if (job.client_phone) { doc.text(`${t.clientPhone}: ${job.client_phone}`, margin + 5, y); y += 5; }
          doc.text(`${t.inspectionDate}: ${new Date(job.inspection_date || job.created_date).toLocaleDateString(t.dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })}`, margin + 5, y); y += 5;
          if (job.insurance_claim_number) { doc.text(`${t.claimNumber}: ${job.insurance_claim_number}`, margin + 5, y); y += 5; }
          if (job.insurance_company) { doc.text(`${t.insuranceCompany}: ${job.insurance_company}`, margin + 5, y); y += 5; }
          if (job.date_of_loss) { try { doc.text(`Date of Loss: ${new Date(job.date_of_loss).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, margin + 5, y); } catch { doc.text(`Date of Loss: ${job.date_of_loss}`, margin + 5, y); } y += 5; }
          if (job.damage_type) { doc.text(`Type of Loss: ${job.damage_type}`, margin + 5, y); }

          // Scope of Work & Notes page (only added when either has content)
          addScopeAndNotesToPdf(doc, { pageWidth, pageHeight, margin, contentWidth, primaryColor });

          const imagesBySection = {};
          photoMedia.forEach(item => {
              const section = item.section || 'Other';
              if (!imagesBySection[section]) imagesBySection[section] = [];
              imagesBySection[section].push(item);
          });

          const totalPhotos = photoMedia.length;
          let processedPhotos = 0;
          const reportImages = createReportImageQueue(Object.values(imagesBySection).flat(), jobId);

          for (const [section, images] of Object.entries(imagesBySection)) {
              doc.addPage();
              doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
              doc.rect(0, 10, pageWidth, 12, 'F');
              doc.setFontSize(14);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(255, 255, 255);
              doc.text(section, pageWidth / 2, 18, { align: 'center' });
              let yPos = 30;
              if (sectionNotes && sectionNotes[section]) {
                  doc.setFontSize(9);
                  doc.setFont('helvetica', 'normal');
                  doc.setTextColor(60, 60, 60);
                  const lines = doc.splitTextToSize(sectionNotes[section], contentWidth);
                  doc.text(lines, margin, yPos);
                  yPos += (lines.length * 4) + 8;
              }
              for (const item of images) {
                  processedPhotos++;
                  setSendingStatus(`⏳ Building PDF — photo ${processedPhotos} of ${totalPhotos}...`);
                  const imgWidth = contentWidth;
                  let imgHeight = 100;
                  try {
                      const prepared = await reportImages.next(item);
                      imgHeight = Math.min((imgWidth * prepared.height) / prepared.width, pageHeight - 60);

                      if (yPos + imgHeight > pageHeight - 30) {
                          doc.addPage();
                          doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                          doc.rect(0, 10, pageWidth, 12, 'F');
                          doc.setFontSize(14);
                          doc.setFont('helvetica', 'bold');
                          doc.setTextColor(255, 255, 255);
                          doc.text(`${section} ${t.continued}`, pageWidth / 2, 18, { align: 'center' });
                          yPos = 30;
                      }

                      doc.setDrawColor(200, 200, 200);
                      doc.setLineWidth(0.3);
                      doc.rect(margin, yPos, imgWidth, imgHeight);
                      doc.addImage(prepared.dataUrl, 'JPEG', margin + 1, yPos + 1, imgWidth - 2, imgHeight - 2);
                      yPos += imgHeight + 5;
                      if (item.caption) {
                          doc.setFontSize(10);
                          doc.setFont('helvetica', 'normal');
                          doc.setTextColor(60, 60, 60);
                          const captionLines = doc.splitTextToSize(item.caption, contentWidth);
                          doc.text(captionLines, margin, yPos);
                          yPos += (captionLines.length * 4.5) + 4;
                          doc.setTextColor(0);
                      } else { yPos += 4; }
                      { const metaParts = []; if (item.uploaded_by_name) metaParts.push(item.uploaded_by_name); const _ts = item.created_at || item.created_date; if (_ts) { try { metaParts.push(new Date(_ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })); } catch {} } if (metaParts.length > 0) { doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(150, 150, 150); doc.text(String(metaParts.join('  |  ')), margin, yPos); yPos += 5; doc.setTextColor(0); } }
                  } catch (error) {
                      throw new Error(`Cannot send an incomplete report: ${error.message}`);
                  }
                  if (processedPhotos % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
              }
          }

          if (linkedEstimate) {
              doc.addPage();
              doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
              doc.rect(0, 10, pageWidth, 12, 'F');
              doc.setFontSize(14);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(255, 255, 255);
              doc.text(t.estimateSummary, pageWidth / 2, 18, { align: 'center' });
              let yPos = 30;

              // Add company logo on estimate page (aspect-ratio preserved)
              if (myCompany?.logo_url) {
                  const estLogoH3 = await loadLogoForPdf(myCompany.logo_url, doc, margin, yPos, 35, 14);
                  if (estLogoH3 > 0) yPos += estLogoH3 + 2;
              }

              doc.setFontSize(10);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(0, 0, 0);
                doc.text(String(myCompany?.company_name || t.companyName), margin, yPos);
                yPos += 4;
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(60, 60, 60);
                if (myCompany?.address) { doc.text(String(myCompany.address), margin, yPos); yPos += 4; }
                if (myCompany?.city || myCompany?.state || myCompany?.zip) { doc.text(String([myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', ')), margin, yPos); yPos += 4; }
                if (myCompany?.phone) { doc.text(String(`${t.phone}: ${myCompany.phone}`), margin, yPos); yPos += 4; }
                if (myCompany?.email) { doc.text(String(`${t.email}: ${myCompany.email}`), margin, yPos); yPos += 4; }
              let rightY = 30;
              doc.setFontSize(20);
              doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
              doc.setFont('helvetica', 'bold');
              doc.text(t.estimate, pageWidth - margin, rightY, { align: 'right' });
              rightY += 6;
              doc.setFontSize(9);
              doc.setTextColor(100, 100, 100);
              doc.setFont('helvetica', 'normal');
              doc.text(`# ${linkedEstimate.estimate_number}`, pageWidth - margin, rightY, { align: 'right' });
              yPos = Math.max(yPos, rightY) + 6;

              // Customer info box
              doc.setFillColor(245, 247, 250);
              const cbY3 = yPos;
              doc.rect(margin, cbY3, contentWidth, 28, 'F');
              doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
              doc.text('BILL TO:', margin + 4, cbY3 + 6);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(40, 40, 40);
              let cY3 = cbY3 + 11;
            doc.text(String(currentClientName || linkedEstimate.customer_name || 'N/A'), margin + 4, cY3); cY3 += 4;
            if (job?.property_address || linkedEstimate.property_address) { doc.text(String(job?.property_address || linkedEstimate.property_address), margin + 4, cY3); cY3 += 4; }
            if (job?.client_phone || linkedEstimate.customer_phone) { doc.text(String(`Phone: ${job?.client_phone || linkedEstimate.customer_phone}`), margin + 4, cY3); cY3 += 4; }
            if (job?.client_email || linkedEstimate.customer_email) { doc.text(String(`Email: ${job?.client_email || linkedEstimate.customer_email}`), margin + 4, cY3); }
            if (job?.insurance_claim_number || linkedEstimate.claim_number) { doc.text(String(`Claim #: ${job?.insurance_claim_number || linkedEstimate.claim_number}`), pageWidth - margin - 4, cbY3 + 11, { align: 'right' }); }
            if (job?.insurance_company || linkedEstimate.insurance_company) { doc.text(String(`Insurance: ${job?.insurance_company || linkedEstimate.insurance_company}`), pageWidth - margin - 4, cbY3 + 15, { align: 'right' }); }
              yPos = cbY3 + 32;

              const items = linkedEstimate.items || linkedEstimate.line_items || [];
              if (items.length > 0) {
                  doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                  doc.rect(margin, yPos, contentWidth, 8, 'F');
                  doc.setFontSize(8);
                  doc.setFont('helvetica', 'bold');
                  doc.setTextColor(255, 255, 255);
                  doc.text('#', margin + 2, yPos + 5.5);
                  doc.text('Description', margin + 10, yPos + 5.5);
                  doc.text('Qty', 115, yPos + 5.5, { align: 'right' });
                  doc.text('Unit', 130, yPos + 5.5);
                  doc.text('Rate', 150, yPos + 5.5, { align: 'right' });
                  doc.text('Amount', pageWidth - margin - 2, yPos + 5.5, { align: 'right' });
                  yPos += 10;
                  let subtotal = 0;
                  doc.setFont('helvetica', 'normal');
                  doc.setTextColor(0, 0, 0);
                  items.forEach((item, index) => {
                      if (yPos > pageHeight - 40) { doc.addPage(); yPos = 20; }
                      if (index % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, yPos - 3, contentWidth, 6, 'F'); }
                      doc.setFontSize(7);
                      doc.text(String(index + 1), margin + 2, yPos + 2);
                      const desc = item.description || t.item;
                      const descLines = doc.splitTextToSize(desc, 95);
                      doc.text(String(descLines[0]), margin + 10, yPos + 2);
                      const qty = parseFloat(item.quantity) || 0;
                      const rate = parseFloat(item.rate) || 0;
                      const amount = parseFloat(item.amount) || 0;
                      doc.text(qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2), 115, yPos + 2, { align: 'right' });
                        doc.text(String(item.unit || t.each), 130, yPos + 2);
                        doc.text(String(`$${rate.toFixed(2)}`), 150, yPos + 2, { align: 'right' });
                        doc.text(String(`$${amount.toFixed(2)}`), pageWidth - margin - 2, yPos + 2, { align: 'right' });
                      subtotal += amount;
                      yPos += 6;
                  });
                  yPos += 5;
                  doc.setDrawColor(200, 200, 200);
                  doc.line(margin, yPos, pageWidth - margin, yPos);
                  yPos += 8;
                  doc.setFontSize(11);
                  doc.setFont('helvetica', 'bold');
                  doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
                  doc.text('TOTAL', 145, yPos);
                  doc.text(`$${subtotal.toFixed(2)}`, pageWidth - margin - 2, yPos, { align: 'right' });
                  }

                  // Estimate notes
                  if (linkedEstimate.notes) {
                      yPos += 15;
                      if (yPos > pageHeight - 60) { doc.addPage(); yPos = 20; }
                      doc.setFontSize(9);
                      doc.setFont('helvetica', 'bold');
                      doc.setTextColor(0, 0, 0);
                    doc.text(String('NOTES:'), margin, yPos);
                      yPos += 5;
                      doc.setFont('helvetica', 'normal');
                      doc.setFontSize(8);
                      doc.setTextColor(40, 40, 40);
                      const estNoteLines = doc.splitTextToSize(linkedEstimate.notes, contentWidth);
                      estNoteLines.forEach(line => { if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; } doc.text(String(line), margin, yPos); yPos += 4; });
                  }

                  // Add disclaimer after estimate
                  yPos += 10;
                  if (yPos > pageHeight - 60) { doc.addPage(); yPos = 20; }
                  doc.setFontSize(8);
                  doc.setFont('helvetica', 'bold');
                  doc.setTextColor(0, 0, 0);
                doc.text(String(t.disclaimer_label), margin, yPos);
                yPos += 5;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.setTextColor(40, 40, 40);
                const disclaimerText = typeof t.disclaimer === 'function' ? t.disclaimer(myCompany?.company_name || t.companyName) : t.disclaimer;
                const disclaimerLines = doc.splitTextToSize(disclaimerText, contentWidth);
                disclaimerLines.forEach(line => { if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; } doc.text(String(line), margin, yPos); yPos += 3.5; });
                  }

                  // ITEL / Material Matching section
                  if (itelStatus !== 'none') {
                      doc.addPage();
                      doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                      doc.rect(0, 10, pageWidth, 12, 'F');
                      doc.setFontSize(14);
                      doc.setFont('helvetica', 'bold');
                      doc.setTextColor(255, 255, 255);
                      doc.text('Material Matching (ITEL)', pageWidth / 2, 18, { align: 'center' });

                      let itelY = 35;
                      const itelLabel = itelStatus === 'match_found' ? 'Match Found (Repairable)' : 'No Match Available (Discontinued)';
                      const itelRgb = itelStatus === 'match_found' ? [5, 150, 105] : [220, 38, 38];

                      doc.setFontSize(12);
                      doc.setFont('helvetica', 'bold');
                      doc.setTextColor(itelRgb[0], itelRgb[1], itelRgb[2]);
                      doc.text(`ITEL Report Status: ${itelLabel}`, margin, itelY);
                      itelY += 10;

                      if (itelStatus === 'no_match' && applyStateCode) {
                          const stateLabel = detectedState || 'State';
                          doc.setFontSize(9);
                          doc.setFont('helvetica', 'bold');
                          doc.setTextColor(30, 58, 138);
                          doc.text(`${stateLabel} Building Code Reference`, margin, itelY);
                          itelY += 6;
                          doc.setFont('helvetica', 'normal');
                          doc.setTextColor(40, 40, 40);
                          const codeText = `Per applicable ${stateLabel} building code for reasonably uniform appearance, replacement of the entire affected roof plane or section may be required when matching materials are not available (discontinued shingle profile).`;
                          const codeLines = doc.splitTextToSize(codeText, contentWidth);
                          doc.text(codeLines, margin, itelY);
                      }
                  }

                  if (inspectorSignature) {
              doc.addPage();
              doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
              doc.rect(0, 10, pageWidth, 12, 'F');
              doc.setFontSize(14);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(255, 255, 255);
                doc.text(String(t.inspectorCertification), pageWidth / 2, 18, { align: 'center' });
              let yPos = 40;
              doc.setFontSize(10);
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(60, 60, 60);
              const certText = t.certificationText;
              const certLines = doc.splitTextToSize(certText, contentWidth);
              doc.text(String(certLines), margin, yPos);
              yPos += (certLines.length * 5) + 15;
              doc.setFillColor(245, 247, 250);
              doc.rect(margin, yPos, 90, 45, 'F');
              doc.setDrawColor(200, 200, 200);
              doc.rect(margin, yPos, 90, 45);
              yPos += 5;
              doc.setFontSize(9);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(80, 80, 80);
              doc.text(String(t.inspectorSignature + ':'), margin + 5, yPos + 3);
              try { doc.addImage(inspectorSignature, 'PNG', margin + 5, yPos + 6, 70, 25); } catch (e) {}
              yPos += 35;
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(8);
              doc.text(String(`${t.date}: ${new Date().toLocaleDateString(t.dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })}`), margin + 5, yPos);
          }

          const totalPages = doc.internal.pages.length - 1;
          for (let i = 1; i <= totalPages; i++) {
              doc.setPage(i);
              doc.setFontSize(7);
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(150, 150, 150);
              const footerText = `${myCompany?.company_name || t.inspectionReport} | ${myCompany?.phone || ''} | ${myCompany?.email || ''}`;
              doc.text(String(footerText), pageWidth / 2, pageHeight - 13, { align: 'center' });
              doc.text(String(t.pageOf(i, totalPages)), pageWidth / 2, pageHeight - 8, { align: 'center' });
          }

          // Upload the PDF directly as a private, authenticated object.
          const pdfBlob = doc.output('blob');
          const pdfSizeMB = (pdfBlob.size / 1024 / 1024).toFixed(1);
          console.log(`✅ PDF generated (${pdfSizeMB} MB), uploading securely...`);

          if (pdfBlob.size > 48 * 1024 * 1024) {
              throw new Error(`The PDF is ${pdfSizeMB} MB, above the 48 MB secure upload limit. No email was sent. Please contact support for help with this report.`);
          }

          setSendingStatus(`📤 Uploading PDF (${pdfSizeMB} MB)...`);
          const uploadResponse = await fetch(`/api/inspection-reports/upload?inspectionJobId=${encodeURIComponent(jobId)}`, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/pdf' },
              body: pdfBlob
          });
          const uploadResult = await uploadResponse.json().catch(() => ({}));
          if (!uploadResponse.ok || !uploadResult.success || !uploadResult.reportId) {
              throw new Error(uploadResult.error || `Secure report upload failed (${uploadResponse.status}).`);
          }
          reportId = uploadResult.reportId;
          retryReportRef.current = { fingerprint: reportFingerprint, reportId };
          } else {
              setSendingStatus('📨 Retrying the stored report without duplicating earlier submissions...');
          }

          setSendingStatus('📨 Submitting secure report links...');
          const response = await base44.functions.invoke('sendInspectionReport', {
              inspectionJobId: jobId,
              reportId,
              sendToClient: reportRecipients.sendToClient,
              clientEmail: job?.client_email || null,
              sendToAdjuster: reportRecipients.sendToAdjuster,
              adjusterEmail: reportRecipients.adjusterEmail,
              sendToProductionManager: reportRecipients.sendToProductionManager,
              productionManagerEmail: reportRecipients.productionManagerEmail || null,
              sendToSalesRep: reportRecipients.sendToSalesRep,
              salesRepEmail: job?.sales_rep_email || null,
              sendToCustomEmails: reportRecipients.sendToCustomEmails,
              customEmails: reportRecipients.customEmails
          });

          if (response.error) {
              throw new Error(response.error);
          }

          if (response.data.success) {
               if (!response.data.failed_count) retryReportRef.current = null;
              const messages = [`📨 Email submitted to provider for ${response.data.submitted_count} recipient(s).`];
               if (response.data.failed_count) messages.push(`⚠️ ${response.data.error || `${response.data.failed_count} email(s) could not be confirmed.`}`);
              if (response.data.client_submitted) messages.push('📧 Client email submitted');
              if (response.data.adjuster_submitted) messages.push('📧 Adjuster email submitted');
              if (response.data.production_manager_submitted) messages.push('📧 Production manager email submitted');
              if (response.data.sales_rep_submitted) messages.push('📧 Sales rep email submitted');
              if (response.data.custom_submitted_count) messages.push(`📧 ${response.data.custom_submitted_count} team email(s) submitted`);
              messages.push('Inbox delivery is not confirmed; check email activity for delivery status.');
              
              // 🔔 Create in-app notifications for admins about report being sent
              if (myCompany?.id) {
                  try {
                      const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
                      const adminEmails = myCompany?.created_by ? [myCompany.created_by] : [];
                      
                      // Notify admins
                      for (const email of adminEmails) {
                          if (email !== user?.email) { // Don't notify yourself
                              await base44.entities.Notification.create({
                                  company_id: myCompany.id,
                                  user_email: email,
                                   title: '📄 Inspection Report Email Submitted',
                                   message: `${user?.full_name || user?.email} submitted inspection report email for ${currentClientName || job.property_address}. Inbox delivery is not confirmed.`,
                                  type: 'inspection_report_sent',
                                  related_entity_type: 'InspectionJob',
                                  related_entity_id: jobId,
                                  link_url: createPageUrl('InspectionCapture') + '?id=' + jobId,
                                  is_read: false
                              });
                          }
                      }
                      
                      // Notify assigned inspector (if different from sender)
                      if (job.assigned_to_email && job.assigned_to_email !== user?.email) {
                          await base44.entities.Notification.create({
                              company_id: myCompany.id,
                              user_email: job.assigned_to_email,
                               title: '📄 Inspection Report Email Submitted',
                               message: `Report email for ${currentClientName || job.property_address} was submitted by ${user?.full_name || user?.email}. Inbox delivery is not confirmed.`,
                              type: 'inspection_report_sent',
                              related_entity_type: 'InspectionJob',
                              related_entity_id: jobId,
                              link_url: createPageUrl('InspectionCapture') + '?id=' + jobId,
                              is_read: false
                          });
                      }
                      
                      queryClient.invalidateQueries({ queryKey: ['notifications'] });
                  } catch (error) {
                      console.error('Failed to create notifications:', error);
                  }
              }
              
              const reportAccessIds = (response.data.recipient_results || [])
                  .filter(item => item.status === 'submitted' && item.accessId)
                  .map(item => item.accessId);
              if (reportAccessIds.length > 0) {
                  toast.success(messages.join('\n'), {
                      duration: 30000,
                      action: {
                          label: 'Revoke links',
                          onClick: async () => {
                              try {
                                  const revokeResponse = await base44.functions.invoke('revokeInspectionReportLinks', {
                                      inspectionJobId: jobId,
                                      accessIds: reportAccessIds
                                  });
                                  if (revokeResponse?.error || revokeResponse?.data?.error || !revokeResponse?.data?.success) {
                                      throw new Error(revokeResponse?.error || revokeResponse?.data?.error || 'Revocation was not confirmed.');
                                  }
                                  toast.success(`Revoked ${revokeResponse.data.revoked_count} report link(s).`);
                              } catch (revokeError) {
                                  toast.error(`Could not revoke report links: ${revokeError.message || 'Unknown error'}`);
                              }
                          }
                      }
                  });
              } else {
                  alert(messages.join('\n'));
              }
              setSendingStatus('');
              setShowTemplateDialog(false);
              queryClient.invalidateQueries({ queryKey: ['email-tracking', jobId] });
          } else {
              throw new Error(response.data.error || 'Failed to submit report email');
          }
      } catch (error) {
          console.error("Report generation error:", error);
          setSendingStatus('');
          setShowTemplateDialog(false);
          alert(`❌ Failed to send report: ${error.message}`);
      }

      setIsSendingReport(false);
      sendReportInFlightRef.current = false;
  };

    const handlePhotoSelect = (photoId) => {
        setRangeAnchor(photoId);
        setSelectedPhotos(prev => {
            if (prev.includes(photoId)) {
                return prev.filter(id => id !== photoId);
            } else {
                return [...prev, photoId];
            }
        });
    };

    // Right-click on a photo: select the range from anchor → this photo, then show context menu
    const handlePhotoContextMenu = (e, item) => {
        e.preventDefault();
        e.stopPropagation();
        const currentIndex = activeSectionMedia.findIndex(m => m.id === item.id);
        if (rangeAnchor !== null) {
            const anchorIndex = activeSectionMedia.findIndex(m => m.id === rangeAnchor);
            if (anchorIndex !== -1 && anchorIndex !== currentIndex) {
                const lo = Math.min(anchorIndex, currentIndex);
                const hi = Math.max(anchorIndex, currentIndex);
                const rangeIds = activeSectionMedia.slice(lo, hi + 1).map(m => m.id);
                setSelectedPhotos(prev => {
                    const merged = new Set([...prev, ...rangeIds]);
                    return [...merged];
                });
            } else {
                // Same photo or no anchor — just select this one
                handlePhotoSelect(item.id);
            }
        } else {
            // No anchor yet — select this photo and set it as anchor
            setRangeAnchor(item.id);
            setSelectedPhotos(prev => prev.includes(item.id) ? prev : [...prev, item.id]);
        }
        setPhotoContextMenu({ visible: true, x: e.clientX, y: e.clientY });
    };

    const handleSelectAll = () => {
        if (selectedPhotos.length === activeSectionMedia.length) {
            setSelectedPhotos([]);
            setRangeAnchor(null);
        } else {
            setSelectedPhotos(activeSectionMedia.map(m => m.id));
            setRangeAnchor(null);
        }
    };

    const handleBulkEdit = () => {
        if (selectedPhotos.length === 0) return;
        setShowBulkEditDialog(true);
    };

    const handleBulkCaptionSave = async () => {
        for (const photoId of selectedPhotos) {
            const existingPhoto = media.find(m => m.id === photoId);
            const existingCaption = existingPhoto?.caption || '';
            const newCaption = existingCaption ? `${existingCaption}\n${bulkCaption}` : bulkCaption;
            await updateMediaMutation.mutateAsync({ id: photoId, caption: newCaption });
        }
        setShowBulkEditDialog(false);
        setSelectedPhotos([]);
        setBulkCaption('');
    };

    const handleBulkDelete = async () => {
        if (selectedPhotos.length === 0) return;
        if (window.confirm(`Delete ${selectedPhotos.length} selected photos?`)) {
            try {
                await base44.entities.JobMedia.bulkDelete(selectedPhotos);
                queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] });
                setSelectedPhotos([]);
            } catch (error) {
                alert(`Unable to delete selected photos: ${error.message}`);
            }
        }
    };

    const addTextToImage = async (imageUrl, section, caption) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const padding = 16;
                const fontSize = Math.max(20, img.width / 35);
                const barHeight = fontSize * 2 + padding * 2;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
                ctx.fillRect(0, img.height - barHeight, img.width, barHeight);
                ctx.fillStyle = 'white';
                ctx.font = `bold ${fontSize}px Arial, sans-serif`;
                ctx.fillText(section || 'Inspection Photo', padding, img.height - fontSize - padding);
                if (caption) {
                    ctx.font = `${Math.round(fontSize * 0.75)}px Arial, sans-serif`;
                    ctx.fillStyle = 'rgba(255,255,255,0.85)';
                    ctx.fillText(caption, padding, img.height - padding + 2);
                }
                canvas.toBlob(resolve, 'image/jpeg', 0.93);
            };
            img.onerror = () => resolve(null);
            img.src = imageUrl;
        });
    };

    const downloadIndividualPhoto = async (photo) => {
        setDownloadingIndividual(photo.id);
        try {
            const blob = await addTextToImage(photo.annotated_url || photo.file_url, photo.section, photo.caption);
            if (!blob) throw new Error('Could not process image');
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `photo-${photo.section || 'inspection'}-${photo.id}.jpg`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        } catch (err) {
            console.error('Download error:', err);
        } finally {
            setDownloadingIndividual(null);
        }
    };

    const downloadPhotosAsZip = async (photosToZip, zipName) => {
        if (!photosToZip || photosToZip.length === 0) return;
        setDownloadingZip(true);
        try {
            const zip = new JSZip();
            for (const photo of photosToZip) {
                const blob = await addTextToImage(photo.annotated_url || photo.file_url, photo.section, photo.caption);
                if (blob) {
                    const filename = `photo-${(photo.section || 'inspection').replace(/\s+/g, '_')}-${photo.id}.jpg`;
                    zip.file(filename, blob);
                }
            }
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = window.URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = zipName || `inspection-photos.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        } catch (err) {
            console.error('ZIP error:', err);
            alert('Failed to create ZIP: ' + err.message);
        } finally {
            setDownloadingZip(false);
        }
    };

    const handleBulkDownload = async () => {
        if (selectedPhotos.length === 0) return;
        const selectedMedia = activeSectionMedia.filter(m => selectedPhotos.includes(m.id));
        if (selectedMedia.length === 1) {
            await downloadIndividualPhoto(selectedMedia[0]);
            return;
        }
        await downloadPhotosAsZip(selectedMedia, `inspection-selected-${jobId}.zip`);
    };

    const handleMoveToSection = async () => {
        if (!moveSectionTarget || selectedPhotos.length === 0) return;
        for (const photoId of selectedPhotos) {
            await updateMediaMutation.mutateAsync({ id: photoId, section: moveSectionTarget });
        }
        setShowMoveSectionDialog(false);
        setSelectedPhotos([]);
        setMoveSectionTarget('');
    };

    const handleLinkEstimate = () => {
        if (!selectedEstimateId) {
            alert('Please select an estimate');
            return;
        }
        linkEstimateMutation.mutate({ jobId, estimateId: selectedEstimateId });
    };

    const suggestedEstimates = estimates.filter(e =>
        (currentClientName && e.customer_name?.toLowerCase().includes(currentClientName.toLowerCase())) ||
        e.property_address?.toLowerCase().includes(job?.property_address?.toLowerCase() || '')
    );

    const activeSectionMedia = jobId 
        ? (activeSection === 'All Photos' 
            ? media 
            : media.filter(m => m.section === activeSection))
        : [];
    const galleryWindowKey = `${jobId || ''}:${activeSection}`;
    const visibleMediaCount = galleryWindow.key === galleryWindowKey
        ? galleryWindow.count
        : PHOTO_GALLERY_BATCH_SIZE;
    const visibleSectionMedia = activeSectionMedia.slice(0, visibleMediaCount);

    // Technical evidence computed values (depend on media + triggeredKeywords)
    const techEvidencePhotos = {
        coreSample:   media.filter(m => m.section === TECH_EVIDENCE_SECTIONS.CORE_SAMPLE),
        measurement:  media.filter(m => m.section === TECH_EVIDENCE_SECTIONS.MEASUREMENT),
        repairability: media.filter(m => m.section === TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
    };
    // Evidence gate only applies to insurance claims — retail inspections skip it entirely
    const isEvidenceBlocked = computeIsEvidenceBlocked(triggeredKeywords, inspectionType);
    const isTechEvidenceComplete = computeIsTechEvidenceComplete(techEvidencePhotos, triggeredKeywords, inspectionType);

    const mostRecentTracking = emailTracking.length > 0
        ? emailTracking.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))[0]
        : null;

    if (isLoadingJob && jobId) {
        return <div className="p-3 sm:p-6 text-center"><Loader2 className="animate-spin" /></div>;
    }

    // 🔐 Access guard: non-admins can only view inspections that are either
    // (a) assigned to them, or (b) not assigned to anyone yet (open for any crew capture).
    if (isPermissionsReady && job && !isLoadingJob && effectiveUserEmail && !isAdmin) {
        const isExplicitlyAssigned = job.assigned_to_email ||
            (job.assigned_inspectors && job.assigned_inspectors.length > 0) ||
            job.inspector_email;
        const hasAccess = !isExplicitlyAssigned || // unassigned job — any crew member can capture
            job.assigned_to_email === effectiveUserEmail ||
            job.assigned_inspectors?.includes(effectiveUserEmail) ||
            job.created_by === effectiveUserEmail ||
            job.inspector_email === effectiveUserEmail;
        if (!hasAccess) {
            return (
                <div className="p-3 sm:p-6">
                    <Button variant="outline" onClick={() => navigate(createPageUrl('InspectionsDashboard'))}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Inspections
                    </Button>
                    <div className="mt-6 text-center text-gray-500">You don't have access to this inspection.</div>
                </div>
            );
        }
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="bg-white border-b shadow-sm px-4 py-3 sticky top-0 z-50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(createPageUrl('InspectionsDashboard'))}
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div>
                            <h1 className="text-lg md:text-xl font-bold text-gray-900">{t.inspectionReport || 'PhotoSync Photo Capture'}</h1>
                            {job && (
                                <div className="mt-1">
                                    <p className="text-sm font-semibold text-blue-600">{currentClientName}</p>
                                    <p className="text-xs text-gray-600">{job.property_address}</p>
                                    <LeadNameMismatchWarning job={job} className="mt-1 max-w-xl" />
                                    <LeadContactMismatchWarning job={job} className="mt-1 max-w-xl" />
                                    <CustomerContactMismatchWarning job={job} className="mt-1 max-w-xl" />
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        {job.insurance_claim_number && (
                                            <Badge variant="outline" className="text-xs">
                                                {t.claimNumber || 'Claim'}: {job.insurance_claim_number}
                                            </Badge>
                                        )}
                                        {job.assigned_to_email && (() => {
                                            const assignedUser = users.find(u => u.email === job.assigned_to_email);
                                            return (
                                                <Badge className="bg-green-50 text-green-800 border-green-300 text-xs">
                                                    👤 {t.assignedTo || 'Assigned to'}: {assignedUser?.full_name || job.assigned_to_name || job.assigned_to_email.split('@')[0]}
                                                </Badge>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}
                            {!job && <p className="text-sm text-gray-600">{t.loading || 'Loading...'}</p>}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">

                        <Button
                            variant="outline"
                            onClick={() => setShowEditDialog(true)}
                            className="gap-2"
                        >
                            <Edit className="w-4 h-4" />
                            <span className="text-xs">{t.edit || 'Edit Job'}</span>
                        </Button>

                        {/* Create Estimate shortcut */}
                        <Button
                            variant="default"
                            size="sm"
                            onClick={() => {
                                const params = new URLSearchParams();
                                if (job?.id) params.set('inspection_job_id', job.id);
                                if (currentClientName) params.set('customer_name', currentClientName);
                                if (job?.property_address) params.set('property_address', job.property_address);
                                if (job?.client_phone) params.set('customer_phone', job.client_phone);
                                if (job?.client_email) params.set('customer_email', job.client_email);
                                navigate(createPageUrl('AIEstimator') + '?' + params.toString());
                            }}
                            className="gap-1.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
                            data-testid="button-create-estimate"
                        >
                            <Sparkles className="w-4 h-4" />
                            <span className="text-xs">Create Estimate</span>
                        </Button>

                        {job?.assigned_to_email && (
                            <div className="flex flex-col items-stretch gap-0.5">
                                <Button
                                    variant="outline"
                                    onClick={() => resendNotificationMutation.mutate()}
                                    disabled={resendNotificationMutation.isPending}
                                    className="gap-2"
                                    data-testid="button-resend-notification"
                                >
                                    {resendNotificationMutation.isPending
                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                        : <Send className="w-4 h-4" />
                                    }
                                    <span className="text-xs hidden sm:inline">Resend Link</span>
                                </Button>
                                {job?.last_notified_at && (
                                    <span
                                        className="text-[10px] text-gray-500 text-center"
                                        data-testid="text-last-notified"
                                    >
                                        Last notified: {new Date(job.last_notified_at).toLocaleString()}
                                        {job?.notification_count > 0 && (
                                            Array.isArray(job?.notification_history) && job.notification_history.length > 0 ? (() => {
                                                const reminderCount = job.notification_history.filter(e => e.type === 'resend').length;
                                                const assignmentCount = job.notification_history.filter(e => e.type !== 'resend').length;
                                                const countLabel = [
                                                    assignmentCount > 0 ? `${assignmentCount} ${assignmentCount === 1 ? 'assignment' : 'assignments'}` : null,
                                                    reminderCount > 0 ? `${reminderCount} ${reminderCount === 1 ? 'reminder' : 'reminders'}` : null,
                                                ].filter(Boolean).join(' · ');
                                                return (
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <button
                                                                className="ml-1 text-blue-500 underline underline-offset-2 hover:text-blue-700 cursor-pointer"
                                                                data-testid="button-notification-count"
                                                            >
                                                                — {countLabel}
                                                            </button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-72 p-3" align="end">
                                                            <p className="text-xs font-semibold text-gray-700 mb-2">Send History</p>
                                                            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                                                                {job.notification_history.map((entry, i) => (
                                                                    <li key={i} className="text-xs text-gray-600 border-b last:border-0 pb-1 last:pb-0">
                                                                        <span className="font-medium">{new Date(entry.sent_at).toLocaleString()}</span>
                                                                        {entry.type === 'resend' ? (
                                                                            <span className="ml-1 text-amber-600 font-medium">🔁 Reminder</span>
                                                                        ) : (
                                                                            <span className="ml-1 text-blue-600 font-medium">📋 Assignment</span>
                                                                        )}
                                                                        {entry.sent_by_email && (
                                                                            <span className="block text-gray-400 truncate">{entry.sent_by_email}</span>
                                                                        )}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </PopoverContent>
                                                    </Popover>
                                                );
                                            })() : (
                                                <span className="ml-1">— {job.notification_count}x total</span>
                                            )
                                        )}
                                    </span>
                                )}
                            </div>
                        )}

                        <Select value={language} onValueChange={handleLanguageChange}>
                            <SelectTrigger className="w-[100px] h-8" data-testid="select-language">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="en">English</SelectItem>
                                <SelectItem value="es">Español</SelectItem>
                            </SelectContent>
                        </Select>

                        <Button
                            onClick={handleViewPDF}
                            disabled={!job || media.filter(m => m.file_type === 'photo').length === 0 || isViewing || isExporting || isSendingReport}
                            variant="outline"
                            size="sm"
                            className="gap-1.5 border-green-500 text-green-700 hover:bg-green-50"
                            title={t.viewPdf || 'View PDF'}
                        >
                            {isViewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                            <span className="text-xs">{t.viewPdf || 'View PDF'}</span>
                        </Button>
                        <Button
                            onClick={handleExportReport}
                            disabled={!job || media.filter(m => m.file_type === 'photo').length === 0 || isExporting || isViewing || isSendingReport}
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            title={t.downloadPdf || 'Download PDF'}
                        >
                            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                            <span className="text-xs hidden sm:inline">{t.downloadPdf || 'Download PDF'}</span>
                        </Button>
                        {(isExporting || isViewing) && reportBuildProgress && (
                            <span role="status" className="text-xs text-slate-600">{reportBuildProgress}</span>
                        )}
                        <Button
                            onClick={() => {
                                if (isEvidenceBlocked && !isTechEvidenceComplete) {
                                    setShowEvidenceBlockedModal(true);
                                    return;
                                }
                                setShowProofPackage(true);
                            }}
                            disabled={!job || media.filter(m => m.file_type === 'photo').length === 0}
                            variant="outline"
                            size="sm"
                            className={`gap-1.5 ${
                                isEvidenceBlocked && !isTechEvidenceComplete
                                    ? 'border-red-400 text-red-700 hover:bg-red-50'
                                    : inspectionType === 'retail'
                                        ? 'border-emerald-500 text-emerald-700 hover:bg-emerald-50'
                                        : 'border-blue-500 text-blue-700 hover:bg-blue-50'
                            }`}
                            data-testid="button-proof-package"
                            title={
                                isEvidenceBlocked && !isTechEvidenceComplete
                                    ? 'Technical evidence required before generating proof package'
                                    : inspectionType === 'retail' ? 'Retail Proposal Package' : 'Claims Defense File'
                            }
                        >
                            {isEvidenceBlocked && !isTechEvidenceComplete
                                ? <ShieldAlert className="w-4 h-4" />
                                : inspectionType === 'retail'
                                    ? <Banknote className="w-4 h-4" />
                                    : <Package className="w-4 h-4" />}
                            <span className="text-xs hidden sm:inline">
                                {inspectionType === 'retail' ? 'Retail Proposal' : 'Proof Package'}
                            </span>
                        </Button>
                        <Button
                            onClick={() => {
                                let ds = null;
                                if (job?.property_address) {
                                    const parts = job.property_address.split(',').map(p => p.trim());
                                    if (parts.length >= 2) {
                                        const m = parts[parts.length - 2].match(/\b([A-Z]{2})\b/);
                                        if (m) ds = m[1];
                                    }
                                }
                                setDetectedState(ds);
                                setItelStatus('none');
                                setApplyStateCode(false);
                                setShowTemplateDialog(true);
                            }}
                            disabled={isSendingReport || !job || media.filter(m => m.file_type === 'photo').length === 0}
                            size="sm"
                            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white gap-1.5"
                            title={t.sendReport || 'Send Report'}
                        >
                            {isSendingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            <span className="text-xs">{t.sendReport || 'Send Report'}</span>
                        </Button>

                    </div>
                </div>
            </div>

            {/* ── Inspection Type Toggle ─────────────────────────────────────────── */}
            <div className="bg-white border-b px-4 py-2 flex items-center gap-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Inspection Type:</span>
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shadow-sm" role="group" aria-label="Inspection type">
                    <button
                        type="button"
                        onClick={() => setInspectionType('insurance')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none ${
                            inspectionType === 'insurance'
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                        aria-pressed={inspectionType === 'insurance'}
                    >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Insurance Claim
                    </button>
                    <button
                        type="button"
                        onClick={() => setInspectionType('retail')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors focus:outline-none ${
                            inspectionType === 'retail'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                        aria-pressed={inspectionType === 'retail'}
                    >
                        <Banknote className="w-3.5 h-3.5" />
                        Cash / No Insurance
                    </button>
                </div>
                {inspectionType === 'retail' && (
                    <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        Customer paying cash — generates a Retail Proposal (no insurance docs)
                    </span>
                )}
            </div>

            <div className="p-2 md:p-6 max-w-7xl mx-auto space-y-4">

                {job && (
                    <>
                        {/* Job Briefing Card — visible to assigned inspector in the field */}
                        {(currentClientName || job.property_address || job.client_phone || job.client_email || job.damage_type) && (
                            <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4 shadow-sm" data-testid="card-job-briefing">
                                <div className="flex items-start justify-between gap-4 flex-wrap">
                                    <div className="space-y-2 flex-1 min-w-0">
                                        {currentClientName && (
                                            <div>
                                                <p className="text-[11px] font-semibold text-blue-500 uppercase tracking-wide">Client</p>
                                                <p className="text-lg font-bold text-gray-900 leading-tight" data-testid="text-briefing-client-name">{currentClientName}</p>
                                                {linkedCustomerError && <p className="text-xs text-amber-700">Could not refresh the linked customer's name.</p>}
                                            </div>
                                        )}
                                        {job.property_address && (
                                            <div>
                                                <p className="text-[11px] font-semibold text-blue-500 uppercase tracking-wide">Address</p>
                                                <a
                                                    href={`https://maps.google.com/?q=${encodeURIComponent(job.property_address)}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-base font-semibold text-blue-700 hover:underline flex items-center gap-1"
                                                    data-testid="link-briefing-address"
                                                >
                                                    <MapPin className="w-4 h-4 flex-shrink-0" />
                                                    {job.property_address}
                                                </a>
                                            </div>
                                        )}
                                        <div className="flex flex-wrap gap-3 pt-1">
                                            {job.client_phone && (
                                                <a
                                                    href={`tel:${job.client_phone}`}
                                                    className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-blue-700"
                                                    data-testid="link-briefing-phone"
                                                >
                                                    <Phone className="w-4 h-4 text-blue-500" />
                                                    {job.client_phone}
                                                </a>
                                            )}
                                            {job.client_email && (
                                                <a
                                                    href={`mailto:${job.client_email}`}
                                                    className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-blue-700"
                                                    data-testid="link-briefing-email"
                                                >
                                                    <Mail className="w-4 h-4 text-blue-500" />
                                                    {job.client_email}
                                                </a>
                                            )}
                                        </div>
                                        {job.damage_type && (
                                            <div className="flex items-center gap-1.5 text-sm text-gray-700 pt-0.5">
                                                <AlertCircle className="w-4 h-4 text-orange-500 flex-shrink-0" />
                                                <span><span className="font-medium">Damage type:</span> {job.damage_type}</span>
                                            </div>
                                        )}
                                        {job.notes && (() => {
                                            let parsedNotes = job.notes;
                                            try { parsedNotes = typeof job.notes === 'string' ? JSON.parse(job.notes) : job.notes; } catch {}
                                            const noteText = Array.isArray(parsedNotes)
                                                ? parsedNotes.map(n => n.text || n.content || n).filter(Boolean).join(' | ')
                                                : (typeof parsedNotes === 'string' ? parsedNotes : null);
                                            return noteText ? (
                                                <p className="text-sm text-gray-600 italic border-t border-blue-200 pt-2 mt-1">
                                                    📝 {noteText}
                                                </p>
                                            ) : null;
                                        })()}
                                    </div>
                                    {job.property_address && (
                                        <a
                                            href={`https://maps.google.com/?q=${encodeURIComponent(job.property_address)}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex-shrink-0"
                                        >
                                            <div className="w-16 h-16 md:w-20 md:h-20 rounded-lg bg-blue-200 flex flex-col items-center justify-center text-blue-700 hover:bg-blue-300 transition-colors border border-blue-300">
                                                <Navigation className="w-6 h-6 md:w-7 md:h-7" />
                                                <span className="text-[10px] font-semibold mt-0.5">Directions</span>
                                            </div>
                                        </a>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {linkedEstimate ? (
                                <Alert className="bg-green-50 border-green-300">
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                    <AlertDescription className="text-green-800">
                                        <div className="flex items-center justify-between">
                                            <span>✅ Estimate: {linkedEstimate.estimate_number} (${Number(linkedEstimate.amount || 0).toFixed(2)})</span>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => navigate(createPageUrl('EstimateEditor') + `?estimate_id=${linkedEstimate.id}`)}
                                                className="text-green-700 hover:text-green-900"
                                            >
                                                <ExternalLink className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            ) : (
                                <Alert className="bg-yellow-50 border-yellow-300">
                                    <AlertCircle className="h-4 w-4 text-yellow-600" />
                                    <AlertDescription className="text-yellow-800">
                                        <div className="flex items-center justify-between gap-2">
                                            <span>⚠️ No Estimate Linked</span>
                                            <div className="flex gap-1">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setShowLinkEstimateDialog(true)}
                                                    className="text-yellow-700 hover:text-yellow-900 h-7 px-2 text-xs"
                                                >
                                                    Link
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={async () => {
                                                        // Calculate AI summary from media
                                                        const photoMedia = media.filter(m => m.file_type === 'photo' && m.ai_damage_analysis);
                                                        const damageSummary = summarizePhotoSyncDamage(photoMedia);
                                                        const totalHail = damageSummary.total_hail_hits;
                                                        const totalWind = damageSummary.total_wind_marks;
                                                        const hasDiscontinued = photoMedia.some(m => m.ai_damage_analysis?.likely_discontinued);

                                                        // Update job with AI summary
                                                        if (totalHail > 0 || totalWind > 0) {
                                                            await base44.entities.InspectionJob.update(jobId, {
                                                                ai_analysis_summary: {
                                                                    total_hail_hits: totalHail,
                                                                    total_wind_marks: totalWind,
                                                                    hail_per_sq: damageSummary.hail_per_sq,
                                                                    wind_per_sq: damageSummary.wind_per_sq,
                                                                    section_summaries: damageSummary.section_summaries,
                                                                    material_matching_flag: hasDiscontinued,
                                                                    overall_severity: totalHail > 10 || totalWind > 5 ? 'severe' : totalHail > 5 || totalWind > 3 ? 'moderate' : 'minor'
                                                                }
                                                            });
                                                        }

                                                        const params = new URLSearchParams({
                                                            customer_name: currentClientName || '',
                                                            customer_email: job.client_email || '',
                                                            customer_phone: job.client_phone || '',
                                                            property_address: job.property_address || '',
                                                            claim_number: job.insurance_claim_number || '',
                                                            inspection_job_id: jobId
                                                        });
                                                        navigate(createPageUrl('AIEstimator') + '?' + params.toString());
                                                    }}
                                                    className="text-yellow-700 hover:text-yellow-900 h-7 px-2 text-xs gap-1"
                                                >
                                                    <Sparkles className="w-3 h-3" />
                                                    Create
                                                </Button>
                                            </div>
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            )}

                            {linkedStorm ? (
                                <Alert className="bg-orange-50 border-orange-300">
                                    <CheckCircle className="h-4 w-4 text-orange-600" />
                                    <AlertDescription className="text-orange-800">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex-1">
                                                <div>⚡ {linkedStorm.title}</div>
                                                <div className="text-xs text-orange-700/80">
                                                    📍 {linkedStorm.affected_areas?.join(', ')} • {linkedStorm.hail_size_inches}" hail, {linkedStorm.wind_speed_mph} mph
                                                </div>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setShowLinkStormDialog(true)}
                                                    className="text-orange-700 hover:text-orange-900"
                                                >
                                                    Change
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => navigate(createPageUrl('StormReport') + `?id=${linkedStorm.id}`)}
                                                    className="text-orange-700 hover:text-orange-900"
                                                >
                                                    <ExternalLink className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            ) : (
                                <Alert className="bg-gray-50 border-gray-300">
                                    <AlertDescription className="text-gray-600">
                                        <div className="flex items-center justify-between">
                                            <span>No storm event linked</span>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => setShowLinkStormDialog(true)}
                                                className="text-blue-600 hover:text-blue-800"
                                            >
                                                Link Storm
                                            </Button>
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            )}
                        </div>

                        {mostRecentTracking && (
                            <Alert className={mostRecentTracking.status === 'opened' ? 'bg-green-50 border-green-300' : 'bg-blue-50 border-blue-300'}>
                                <Mail className="h-4 w-4 text-blue-600" />
                                <AlertDescription>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            {mostRecentTracking.status === 'opened' ? (
                                                <>
                                                    <span className="font-semibold text-green-800">✅ Report Opened!</span>
                                                    <p className="text-xs text-green-700 mt-1">
                                                        Last viewed: {new Date(mostRecentTracking.last_opened_at).toLocaleString()}
                                                        {mostRecentTracking.open_count > 1 && ` (${mostRecentTracking.open_count} times)`}
                                                    </p>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="font-semibold text-blue-800">📧 Report Sent</span>
                                                    <p className="text-xs text-blue-700 mt-1">
                                                        To: {mostRecentTracking.recipient_name} - Not opened yet
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </AlertDescription>
                            </Alert>
                        )}
                    </>
                )}

                {!isSecureContext && (
                    <Card className="bg-yellow-50 border-yellow-300">
                        <CardHeader>
                            <CardTitle className="text-yellow-800 flex items-center gap-2">
                                <Camera className="w-5 h-5"/> Action Required to Enable Camera
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-yellow-700 mb-4">Your browser requires a secure (HTTPS) connection to access the camera.</p>
                            <Button asChild>
                                <a href={window.location.href.replace('http://', 'https://')}>
                                    Reload Page Securely to Activate Camera
                                </a>
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {isSecureContext && <LiveCameraCapture
                    onUpload={handleLiveCaptureUpload}
                    onVoiceNote={text => {
                        const trimmed = text.trim();
                        if (!trimmed) return;
                        setScopeOfWork(prev => (prev ? prev + '\n' + trimmed : trimmed));
                        setLastVoiceNote(trimmed);
                        toast.success(`Note captured: "${trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed}"`, { duration: 4000 });
                    }}
                    onVoiceCaptionForLastPhoto={handleVoiceCaptionForLastPhoto}
                    activeSection={activeSection}
                    setActiveSection={setActiveSection}
                    sections={sections}
                    sectionPhotoCount={sectionPhotoCount}
                    onGuidedModeChange={handleGuidedModeChange}
                    jobId={jobId}
                    companyId={myCompany?.id}
                    onMeasurementSaved={(measurements) => {
                        console.log('[ARMeasure] Saved', measurements?.length, 'measurements to job', jobId);
                    }}
                    onDrawAndAnalyze={handleLiveCaptureDrawAndAnalyze}
                    onVoiceAccessoryCount={(key, delta) => {
                        updateRoofAccessory(key, Math.max(0, (roofAccessories[key] || 0) + delta));
                        toast.success(`+${delta} ${key.replace('_', ' ')} (voice)`, { duration: 2500 });
                    }}
                    voiceCheatSheet={myCompany?.settings?.voice_cheat_sheet}
                />}

                {/* Last voice note — immediate in-situ feedback */}
                {lastVoiceNote && (
                    <div className="flex items-start gap-3 rounded-xl bg-green-50 border border-green-300 px-4 py-3 shadow-sm" data-testid="banner-last-voice-note">
                        <span className="text-xl leading-none mt-0.5">🎤</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold text-green-600 uppercase tracking-wide mb-0.5">Last voice note captured</p>
                            <p className="text-sm text-gray-800 break-words">{lastVoiceNote}</p>
                            <p className="text-[11px] text-gray-500 mt-1">{t.savedToSow || 'Saved to Scope of Work'} · {typeof t.totalNote === 'function' ? t.totalNote(scopeOfWork.split('\n').filter(Boolean).length) : `${scopeOfWork.split('\n').filter(Boolean).length} total note${scopeOfWork.split('\n').filter(Boolean).length === 1 ? '' : 's'}`}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setLastVoiceNote(null)}
                            className="text-gray-400 hover:text-gray-600 text-lg leading-none flex-shrink-0"
                        >×</button>
                    </div>
                )}

                {/* Guided Mode Banner — minimal; detail is shown in the LiveCameraCapture inspector panel */}
                {guidedModeActive && (
                    <div className="rounded-xl bg-green-600 text-white px-4 py-2.5 flex items-center gap-2.5 shadow-md">
                        <span className="text-base animate-pulse flex-shrink-0">🎤</span>
                        <div className="flex-1 min-w-0">
                            <span className="font-semibold text-sm">Hands-Free Active</span>
                            <span className="text-green-100 text-xs ml-2">Notes auto-save · say "photo" to snap</span>
                        </div>
                        <span className="text-green-100 text-xs font-medium flex-shrink-0">{activeSection}</span>
                    </div>
                )}

                {/* Post-Guided Mode Alert */}
                {showPostGuidedAlert && (
                    <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 flex items-start justify-between gap-3 shadow-sm">
                        <div className="text-sm text-amber-800">
                            <span className="font-semibold">{t.inspectionRecorded || 'Inspection recorded!'}</span> {t.inspectionRecordedHint || 'Tap "AI Generate" in the Scope of Work section below to auto-write the full scope from your notes.'}
                        </div>
                        <button onClick={() => setShowPostGuidedAlert(false)} className="text-amber-500 hover:text-amber-700 text-lg leading-none flex-shrink-0">×</button>
                    </div>
                )}

                <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200 shadow-md">
                    <CardContent className="p-4">
                        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                                    <Upload className="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <p className="font-semibold text-gray-900 text-lg">{t.uploadFromDevice || 'Upload from Device'}</p>
                                    <p className="text-sm text-gray-600">{t.selectPhotosFromGallery || 'Select photos from your gallery or files'}</p>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <input
                                    type="file"
                                    accept="image/*,video/*"
                                    multiple
                                    onChange={handleFileUpload}
                                    className="hidden"
                                    id="file-upload-input"
                                    disabled={uploadQueueStatus !== 'idle'}
                                />
                                <Button
                                    onClick={() => document.getElementById('file-upload-input').click()}
                                    disabled={uploadQueueStatus !== 'idle'}
                                    size="lg"
                                    className="bg-green-600 hover:bg-green-700 text-white font-semibold min-h-[48px]"
                                    data-testid="button-choose-files"
                                >
                                    {uploadQueueStatus === 'uploading' || uploadQueueStatus === 'paused' ? (
                                        <>
                                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                            {uploadQueueProgress.current}/{uploadQueueProgress.total} Uploading…
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="w-5 h-5 mr-2" />
                                            Choose Files to Upload
                                        </>
                                    )}
                                </Button>
                                {(uploadQueueStatus === 'uploading' || uploadQueueStatus === 'paused') && (
                                    <div className="flex items-center gap-2">
                                        {uploadQueueStatus === 'paused' ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={resumeUploadQueue}
                                                className="border-blue-300 text-blue-700 hover:bg-blue-50"
                                                data-testid="button-resume-upload"
                                            >
                                                ▶ Resume
                                            </Button>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={pauseUploadQueue}
                                                className="border-amber-300 text-amber-700 hover:bg-amber-50"
                                                data-testid="button-pause-upload"
                                            >
                                                ⏸ Pause
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={stopUploadQueue}
                                            className="border-red-300 text-red-700 hover:bg-red-50"
                                            data-testid="button-stop-upload"
                                        >
                                            ⏹ Stop
                                        </Button>
                                    </div>
                                )}
                                <label className="flex items-center gap-2 cursor-pointer select-none" title="Upload photos without AI damage detection — faster for large batches">
                                    <input
                                        type="checkbox"
                                        checked={skipAiAnalysis}
                                        onChange={(e) => setSkipAiAnalysis(e.target.checked)}
                                        className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                                    />
                                    <span className="text-sm text-gray-600 font-medium">⚡ Skip AI Analysis</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer select-none" title="Shrink large drone/DSLR photos to ~2560px before uploading — 4-6x faster, still sharp for inspections. Videos are not affected.">
                                    <input
                                        type="checkbox"
                                        checked={compressBeforeUpload}
                                        onChange={(e) => setCompressBeforeUpload(e.target.checked)}
                                        className="w-4 h-4 rounded border-gray-300 text-green-600 cursor-pointer"
                                    />
                                    <span className="text-sm text-gray-600 font-medium">🗜️ Compress Images (faster upload)</span>
                                </label>
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-3 text-center">
                            📸 Tip: Photos are auto-sorted by filename (e.g. "front elevation", "rear slope"). Unrecognized names go to <strong>{activeSection}</strong>.
                        </p>
                    </CardContent>
                </Card>

                {/* Roof Accessories */}
                <Card className="border-green-100 bg-green-50/30">
                    <CardContent className="p-4">
                        <p className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                            🔩 Roof Accessories
                        </p>
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                            {[
                                { key: 'vents', label: 'Vents' },
                                { key: 'pipe_boots', label: 'Pipe Boots' },
                                { key: 'chimneys', label: 'Chimneys' }
                            ].map(({ key, label }) => (
                                <div key={key} className="flex flex-col items-center gap-1">
                                    <span className="text-xs text-gray-600 font-medium">{label}</span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            className="w-7 h-7 rounded-full border border-gray-300 bg-white flex items-center justify-center text-gray-600 hover:bg-gray-100 text-lg leading-none"
                                            onClick={() => updateRoofAccessory(key, Math.max(0, roofAccessories[key] - 1))}
                                            data-testid={`btn-dec-${key}`}
                                        >−</button>
                                        <span className="w-8 text-center font-semibold text-gray-900" data-testid={`count-${key}`}>{roofAccessories[key]}</span>
                                        <button
                                            type="button"
                                            className="w-7 h-7 rounded-full border border-gray-300 bg-white flex items-center justify-center text-gray-600 hover:bg-gray-100 text-lg leading-none"
                                            onClick={() => updateRoofAccessory(key, roofAccessories[key] + 1)}
                                            data-testid={`btn-inc-${key}`}
                                        >+</button>
                                    </div>
                                </div>
                            ))}
                            {[
                                { key: 'drip_edge', label: 'Drip Edge' },
                                { key: 'ice_guard', label: 'Ice Guard' }
                            ].map(({ key, label }) => (
                                <div key={key} className="flex flex-col items-center gap-1">
                                    <span className="text-xs text-gray-600 font-medium">{label}</span>
                                    <div className="flex items-center">
                                        <button
                                            type="button"
                                            className={`px-3 py-1 text-xs font-medium rounded-l border ${roofAccessories[key] === true ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}`}
                                            onClick={() => updateRoofAccessory(key, true)}
                                            data-testid={`btn-${key}-yes`}
                                        >Yes</button>
                                        <button
                                            type="button"
                                            className={`px-3 py-1 text-xs font-medium rounded-r border-t border-b border-r ${roofAccessories[key] === false ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}`}
                                            onClick={() => updateRoofAccessory(key, false)}
                                            data-testid={`btn-${key}-no`}
                                        >No</button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* ── Live Estimate Summary ──────────────────────────
                             Real-time accessory claim value based on standard
                             insurance replacement unit costs. Updates instantly
                             as the inspector counts items — no extra taps needed. */}
                        {(() => {
                            const UNIT_PRICES = { vents: 65, pipe_boots: 45, chimneys: 350, drip_edge: 350, ice_guard: 250 };
                            const lines = [
                                { key: 'vents',      label: 'Vents',      unit: UNIT_PRICES.vents },
                                { key: 'pipe_boots', label: 'Pipe Boots', unit: UNIT_PRICES.pipe_boots },
                                { key: 'chimneys',   label: 'Chimneys',   unit: UNIT_PRICES.chimneys },
                                { key: 'drip_edge',  label: 'Drip Edge',  unit: UNIT_PRICES.drip_edge },
                                { key: 'ice_guard',  label: 'Ice Guard',  unit: UNIT_PRICES.ice_guard },
                            ];
                            const activeLines = lines.filter(l => {
                                const v = roofAccessories[l.key];
                                return typeof v === 'number' ? v > 0 : v === true;
                            });
                            if (activeLines.length === 0) return null;
                            const total = activeLines.reduce((sum, l) => {
                                const v = roofAccessories[l.key];
                                const qty = typeof v === 'number' ? v : 1;
                                return sum + qty * l.unit;
                            }, 0);
                            return (
                                <div className="mt-4 pt-3 border-t border-green-200" data-testid="live-estimate-summary">
                                    <p className="text-xs font-semibold text-green-800 mb-1.5">💰 Estimated Accessory Value</p>
                                    <div className="space-y-0.5">
                                        {activeLines.map(l => {
                                            const v = roofAccessories[l.key];
                                            const qty = typeof v === 'number' ? v : 1;
                                            return (
                                                <div key={l.key} className="flex justify-between text-xs text-gray-600">
                                                    <span>{l.label} {qty > 1 ? `× ${qty}` : ''}</span>
                                                    <span>${(qty * l.unit).toLocaleString()}</span>
                                                </div>
                                            );
                                        })}
                                        <div className="flex justify-between text-xs font-bold text-green-800 pt-1 border-t border-green-200 mt-1">
                                            <span>Subtotal</span>
                                            <span data-testid="text-estimate-total">${total.toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-1">Approx. replacement costs · for reference only</p>
                                </div>
                            );
                        })()}
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-2 md:p-4">
                        <div className="mb-4">
                            {/* Mobile: dropdown */}
                            <div className="md:hidden">
                                <Select
                                    value={activeSection}
                                    onValueChange={(val) => {
                                        setActiveSection(val);
                                        setSelectedPhotos([]);
                                    }}
                                >
                                    <SelectTrigger className="w-full" data-testid="select-section-mobile">
                                        <SelectValue>
                                            <span className="font-medium">
                                                {activeSection === 'All Photos'
                                                    ? `📸 ${t.allPhotos || 'All Photos'}${media.length > 0 ? ` (${media.length})` : ''}`
                                                    : `${translateSection(activeSection)}${media.filter(m => m.section === activeSection).length > 0 ? ` (${media.filter(m => m.section === activeSection).length})` : ''}`
                                                }
                                            </span>
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="All Photos">
                                            📸 {t.allPhotos || 'All Photos'} {media.length > 0 && `(${media.length})`}
                                        </SelectItem>
                                        {sections.map(section => {
                                            const count = jobId ? media.filter(m => m.section === section).length : 0;
                                            return (
                                                <SelectItem key={section} value={section}>
                                                    {translateSection(section)}{count > 0 ? ` (${count})` : ''}
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Desktop: button tabs */}
                            <div className="hidden md:block overflow-x-auto pb-2">
                                <div className="flex space-x-2 flex-wrap">
                                    <Button
                                        variant={activeSection === 'All Photos' ? 'default' : 'outline'}
                                        onClick={() => {
                                            setActiveSection('All Photos');
                                            setSelectedPhotos([]);
                                        }}
                                        className="flex-shrink-0 mb-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white border-0"
                                        style={activeSection !== 'All Photos' ? { background: 'none', color: 'inherit', border: '1px solid #e5e7eb' } : {}}
                                    >
                                        📸 {t.allPhotos || 'All Photos'} {media.length > 0 && `(${media.length})`}
                                    </Button>
                                    {sections.map(section => {
                                        const count = jobId ? media.filter(m => m.section === section).length : 0;
                                        return (
                                            <Button
                                                key={section}
                                                variant={activeSection === section ? 'default' : 'outline'}
                                                onClick={() => {
                                                    setActiveSection(section);
                                                    setSelectedPhotos([]);
                                                }}
                                                className="flex-shrink-0 mb-2"
                                            >
                                                {translateSection(section)} {count > 0 && `(${count})`}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-2">
                             <div>
                                <h3 className="font-semibold text-lg mb-1">{translateSection(activeSection)}</h3>
                                <p className="text-xs md:text-sm text-gray-600">Photos for this section.</p>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                {activeSectionMedia.length > 0 && (
                                    <>
                                        <Button
                                            data-testid="button-download-all-zip"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => downloadPhotosAsZip(activeSectionMedia.filter(m => m.file_type === 'photo'), `inspection-${activeSection.replace(/\s+/g,'_')}-${jobId}.zip`)}
                                            disabled={downloadingZip}
                                            className="text-blue-700 gap-1"
                                        >
                                            {downloadingZip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                                            {downloadingZip ? 'Zipping...' : `Download All (${activeSectionMedia.filter(m => m.file_type === 'photo').length})`}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleSelectAll}
                                            className="text-blue-600"
                                        >
                                            <CheckCircle className="w-4 h-4 mr-1" />
                                            {selectedPhotos.length === activeSectionMedia.length ? 'Deselect All' : 'Select All'}
                                        </Button>
                                        <Button
                                            data-testid="button-reanalyze-all"
                                            variant="outline"
                                            size="sm"
                                            className="text-purple-600"
                                            disabled={isReanalyzing || !!reanalyzingPhotoId}
                                            onClick={async () => {
                                                const photos = activeSectionMedia.filter(m => m.file_type === 'photo');
                                                if (photos.length === 0) return;
                                                if (!confirm(`Re-analyze ${photos.length} photo(s) with AI? This may take a moment.`)) return;
                                                setIsReanalyzing(true);
                                                let completed = 0;
                                                let totalHail = 0;
                                                let totalWind = 0;
                                                for (const photo of photos) {
                                                    const result = await handleReanalyzePhoto(photo, true);
                                                    if (result) {
                                                        completed++;
                                                        totalHail += result.hail_hits_counted || 0;
                                                        totalWind += result.wind_marks_counted || 0;
                                                    }
                                                }
                                                setIsReanalyzing(false);
                                                alert(`Batch Analysis Complete: ${completed}/${photos.length} photos analyzed. Total: ${totalHail} hail hits, ${totalWind} wind marks across all photos.`);
                                            }}
                                        >
                                            {isReanalyzing ? (
                                                <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Analyzing...</>
                                            ) : (
                                                <><Zap className="w-4 h-4 mr-1" /> Analyze All</>
                                            )}
                                        </Button>
                                        {activeSectionMedia.some(m => m.file_type === 'photo' && m.ai_damage_analysis) && (
                                            <Button
                                                data-testid="button-clear-all-ai"
                                                variant="outline"
                                                size="sm"
                                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                disabled={isClearingAllAI || isReanalyzing}
                                                onClick={async () => {
                                                    const aiPhotos = activeSectionMedia.filter(m => m.file_type === 'photo' && m.ai_damage_analysis);
                                                    if (aiPhotos.length === 0) return;
                                                    if (!confirm(`Clear AI analysis from ${aiPhotos.length} photo(s)? This will remove all damage counts, annotations, and AI descriptions. Original photos will be preserved.`)) return;
                                                    setIsClearingAllAI(true);
                                                    try {
                                                        for (const photo of aiPhotos) {
                                                            await base44.entities.JobMedia.update(photo.id, {
                                                                ai_damage_analysis: null,
                                                                annotated_url: null
                                                            });
                                                        }
                                                        queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
                                                        alert(`Cleared AI analysis from ${aiPhotos.length} photo(s). Original photos preserved.`);
                                                    } catch (error) {
                                                        console.error('Clear all AI failed:', error);
                                                        alert('Failed to clear AI: ' + (error.message || 'Unknown error'));
                                                    } finally {
                                                        setIsClearingAllAI(false);
                                                    }
                                                }}
                                            >
                                                {isClearingAllAI ? (
                                                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Clearing...</>
                                                ) : (
                                                    <><XCircle className="w-4 h-4 mr-1" /> Clear All AI</>
                                                )}
                                            </Button>
                                        )}
                                        <Button
                                            data-testid="button-share-photos"
                                            variant="outline"
                                            size="sm"
                                            className="text-green-600"
                                            onClick={() => setShowSharePhotosDialog(true)}
                                        >
                                            <Send className="w-4 h-4 mr-1" /> Share Photos
                                        </Button>
                                        {selectedPhotos.length > 0 && (
                                            <>
                                                <Button variant="outline" size="sm" onClick={handleBulkDownload} disabled={downloadingZip} className="text-green-600 gap-1">
                                                    {downloadingZip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                                                    {downloadingZip ? 'Zipping...' : `ZIP (${selectedPhotos.length})`}
                                                </Button>
                                                <Button variant="outline" size="sm" onClick={() => { setMoveSectionTarget(''); setShowMoveSectionDialog(true); }} className="text-orange-600 gap-1">
                                                    <FolderOpen className="w-4 h-4" /> Move ({selectedPhotos.length})
                                                </Button>
                                                <Button variant="outline" size="sm" onClick={handleBulkEdit}>
                                                    <Edit className="w-4 h-4 mr-1" /> Notes ({selectedPhotos.length})
                                                </Button>
                                                <BulkDeleteButton variant="outline" size="sm" onClick={handleBulkDelete} className="text-red-600">
                                                    <Trash2 className="w-4 h-4 mr-1" /> Delete ({selectedPhotos.length})
                                                </BulkDeleteButton>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-4 min-h-[150px]">
                            {isLoadingMedia && jobId ? <div className="col-span-full flex justify-center items-center py-8"><Loader2 className="animate-spin h-8 w-8 text-gray-500"/></div> : (
                                activeSectionMedia.length > 0 ? (
                                    visibleSectionMedia.map((item, itemIdx) => {
                                        const isSelected = selectedPhotos.includes(item.id);
                                        const aiData = item.ai_damage_analysis;
                                        const hasAI = aiData && (aiData.hail_hits_counted > 0 || aiData.wind_marks_counted > 0 || aiData.missing_shingles_counted > 0 || aiData.likely_discontinued || aiData.severity);
                                        const severityColor = aiData?.severity === 'severe' ? 'bg-red-600' : aiData?.severity === 'moderate' ? 'bg-orange-500' : aiData?.severity === 'minor' ? 'bg-yellow-500' : 'bg-green-500';
                                        
                                        const isAnchor = rangeAnchor === item.id;

                                        return (
                                            <Card
                                                key={item.id}
                                                data-testid={`card-photo-${item.id}`}
                                                className={`relative group cursor-pointer ${isSelected ? 'ring-2 ring-blue-500' : ''} ${isAnchor && !isSelected ? 'ring-2 ring-blue-300' : ''} ${aiData?.photo_quality_flag === 'poor' ? 'border-yellow-400 border-2' : ''}`}
                                                onClick={() => {
                                                    if (selectedPhotos.length > 0) {
                                                        handlePhotoSelect(item.id);
                                                    } else {
                                                        handleOpenPhotoDetail(item);
                                                    }
                                                }}
                                                onContextMenu={(e) => handlePhotoContextMenu(e, item)}
                                            >
                                                <div className="aspect-square bg-gray-200 rounded-t-md flex items-center justify-center relative">
                                                    <SafeImage
                                                      src={item.annotated_url || item.file_url}
                                                      alt={item.caption || ''}
                                                      className="w-full h-full rounded-t-md"
                                                      loading={itemIdx < 4 ? 'eager' : 'lazy'}
                                                    />
                                                    
                                                    {/* Selection checkbox - always visible on hover or when selected */}
                                                    <div 
                                                        className={`absolute top-1 right-1 z-10 ${isSelected ? 'visible' : 'invisible group-hover:visible'}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handlePhotoSelect(item.id);
                                                        }}
                                                    >
                                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${isSelected ? 'bg-blue-500 text-white' : 'bg-white/80 border-2 border-gray-400'}`}>
                                                            {isSelected && <CheckCircle className="w-4 h-4" />}
                                                        </div>
                                                    </div>
                                                    
                                                    {/* Inspector-guided Badge — always visible when inspector_guided, at bottom-left */}
                                                    {aiData?.inspector_guided && item.annotated_url && (
                                                        <div className="absolute bottom-1 left-1 bg-violet-600 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold">
                                                            Inspector-guided
                                                        </div>
                                                    )}

                                                    {/* Coverage Verdict Badge (bottom-right) or AI Annotated fallback */}
                                                    {aiData?.coverage_verdict ? (() => {
                                                        const cv = getCoverageVerdict(aiData.coverage_verdict);
                                                        const VerdictIcon = cv.icon;
                                                        return (
                                                            <div className={`absolute bottom-1 right-1 ${cv.bg} border ${cv.border} text-[9px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5`}>
                                                                <VerdictIcon className={`w-2.5 h-2.5 flex-shrink-0 ${cv.iconColor}`} />
                                                                <span className={cv.text}>{cv.label}</span>
                                                            </div>
                                                        );
                                                    })() : (!aiData?.inspector_guided && item.annotated_url) ? (
                                                        <div className="absolute bottom-1 right-1 bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold">
                                                            AI Annotated
                                                        </div>
                                                    ) : null}

                                                    {/* AI Severity Badge */}
                                                    {aiData?.severity && aiData.severity !== 'none' && (
                                                        <div className={`absolute top-8 right-1 ${severityColor} text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase`}>
                                                            {aiData.severity}
                                                        </div>
                                                    )}
                                                    
                                                    {/* AI Damage Overlay */}
                                                    {hasAI && (
                                                        <div className="absolute top-1 left-1 bg-black/80 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1 flex-wrap max-w-[80%]">
                                                            <Sparkles className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                                                            {aiData.hail_hits_counted > 0 && <span>{aiData.hail_hits_counted} Hail</span>}
                                                            {aiData.wind_marks_counted > 0 && <span>{aiData.wind_marks_counted} Wind</span>}
                                                            {aiData.missing_shingles_counted > 0 && <span>{aiData.missing_shingles_counted} Missing</span>}
                                                        </div>
                                                    )}
                                                    
                                                    {/* Organic / Discontinued Flag */}
                                                    {(aiData?.is_organic_shingle || aiData?.is_tlock_shingle) && (
                                                        <div className="absolute bottom-1 left-1 bg-red-600 text-white text-xs px-2 py-0.5 rounded font-semibold">
                                                            {aiData.is_tlock_shingle ? 'T-Lock' : 'Organic'} - Discontinued
                                                        </div>
                                                    )}
                                                    {aiData?.likely_discontinued && !aiData?.is_organic_shingle && !aiData?.is_tlock_shingle && (
                                                        <div className="absolute bottom-1 left-1 bg-red-600 text-white text-xs px-2 py-0.5 rounded font-semibold">
                                                            Likely Discontinued
                                                        </div>
                                                    )}

                                                    {/* Low-quality thumbnail badge */}
                                                    {aiData?.photo_quality_flag === 'poor' && (
                                                        <div className="absolute top-1 left-1 bg-yellow-400 text-yellow-900 text-[9px] px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5">
                                                            <AlertCircle className="w-2.5 h-2.5" />
                                                            Low quality
                                                        </div>
                                                    )}
                                                </div>
                                                <CardContent className="p-1.5">
                                                    {/* Inline-editable section badge */}
                                                    {item.section && (
                                                        inlineEdit.id === item.id && inlineEdit.field === 'section' ? (
                                                            <select
                                                                data-testid={`inline-section-${item.id}`}
                                                                autoFocus
                                                                className="text-[10px] mb-1 w-full border border-blue-400 rounded px-1 py-0.5 bg-white focus:outline-none"
                                                                value={inlineEdit.value}
                                                                onChange={e => setInlineEdit(s => ({ ...s, value: e.target.value }))}
                                                                onBlur={e => { e.stopPropagation(); handleInlineSave(item.id, 'section', inlineEdit.value); }}
                                                                onKeyDown={e => {
                                                                    e.stopPropagation();
                                                                    if (e.key === 'Enter') handleInlineSave(item.id, 'section', inlineEdit.value);
                                                                    if (e.key === 'Escape') setInlineEdit({ id: null, field: null, value: '' });
                                                                }}
                                                                onClick={e => e.stopPropagation()}
                                                            >
                                                                {sections.map(s => <option key={s} value={s}>{s}</option>)}
                                                            </select>
                                                        ) : (
                                                            <Badge
                                                                variant="outline"
                                                                data-testid={`badge-section-${item.id}`}
                                                                className="text-[10px] mb-1 px-1 py-0 cursor-pointer hover:bg-blue-50 hover:border-blue-400 group/badge flex items-center gap-0.5 w-fit"
                                                                onClick={e => {
                                                                    e.stopPropagation();
                                                                    setInlineEdit({ id: item.id, field: 'section', value: item.section });
                                                                }}
                                                                title="Click to change section"
                                                            >
                                                                {item.section}
                                                                <Pencil className="w-2 h-2 opacity-0 group-hover/badge:opacity-60 ml-0.5" />
                                                            </Badge>
                                                        )
                                                    )}
                                                    {/* Inline-editable caption */}
                                                    {inlineEdit.id === item.id && inlineEdit.field === 'caption' ? (
                                                        <input
                                                            data-testid={`inline-caption-${item.id}`}
                                                            autoFocus
                                                            type="text"
                                                            className="text-xs w-full border border-blue-400 rounded px-1 py-0.5 bg-white focus:outline-none"
                                                            value={inlineEdit.value}
                                                            placeholder="Add caption…"
                                                            onChange={e => setInlineEdit(s => ({ ...s, value: e.target.value }))}
                                                            onBlur={e => { e.stopPropagation(); handleInlineSave(item.id, 'caption', inlineEdit.value); }}
                                                            onKeyDown={e => {
                                                                e.stopPropagation();
                                                                if (e.key === 'Enter') handleInlineSave(item.id, 'caption', inlineEdit.value);
                                                                if (e.key === 'Escape') setInlineEdit({ id: null, field: null, value: '' });
                                                            }}
                                                            onClick={e => e.stopPropagation()}
                                                        />
                                                    ) : (
                                                        <p
                                                            data-testid={`text-caption-${item.id}`}
                                                            className="text-xs text-gray-500 truncate cursor-pointer hover:text-gray-800 group/cap flex items-center gap-0.5"
                                                            title="Click to edit caption"
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                setInlineEdit({ id: item.id, field: 'caption', value: item.caption || '' });
                                                            }}
                                                        >
                                                            <span className="truncate">{item.caption || 'Add caption…'}</span>
                                                            <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/cap:opacity-50 flex-shrink-0" />
                                                        </p>
                                                    )}

                                                    {/* Photo Quality Bar */}
                                                    {aiData?.photo_quality_score != null && (
                                                        <div className="mt-1 space-y-0.5">
                                                            <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full rounded-full ${getQualityBarColor(aiData.photo_quality_score)}`}
                                                                    style={{ width: `${aiData.photo_quality_score}%` }}
                                                                />
                                                            </div>
                                                            <p className="text-[9px] text-gray-500 capitalize">{aiData.photo_quality_flag || 'good'} quality · {aiData.photo_quality_score}%</p>
                                                        </div>
                                                    )}

                                                    {/* Retake banner — shown when AI flags photo as poor quality */}
                                                    {aiData?.photo_quality_flag === 'poor' && (
                                                        <div
                                                            className="mt-1.5 flex items-center gap-1.5 bg-yellow-50 border border-yellow-300 rounded px-2 py-1"
                                                            onClick={e => e.stopPropagation()}
                                                        >
                                                            <AlertCircle className="w-3 h-3 text-yellow-600 flex-shrink-0" />
                                                            <span className="text-[10px] text-yellow-800 font-medium flex-1 leading-tight">Blurry or dark — retake for best results</span>
                                                            <label
                                                                className="text-[10px] text-yellow-700 font-semibold cursor-pointer hover:text-yellow-900 flex items-center gap-0.5 shrink-0 underline"
                                                                onClick={e => e.stopPropagation()}
                                                            >
                                                                <Camera className="w-3 h-3" />
                                                                Retake
                                                                <input
                                                                    type="file"
                                                                    accept="image/*"
                                                                    capture="environment"
                                                                    className="hidden"
                                                                    onClick={e => e.stopPropagation()}
                                                                    onChange={(e) => {
                                                                        e.stopPropagation();
                                                                        handleRetakeUpload(e, item.section || activeSection);
                                                                    }}
                                                                />
                                                            </label>
                                                        </div>
                                                    )}

                                                    {/* Covered / Non-Covered Summary */}
                                                    {(aiData?.covered_items?.length > 0 || aiData?.non_covered_items?.length > 0) && (
                                                        <div className="mt-1 space-y-0.5">
                                                            {aiData.covered_items?.slice(0, 2).map((ci, i) => (
                                                                <div key={i} className="flex items-center gap-0.5">
                                                                    <CheckCircle2 className="w-2.5 h-2.5 text-green-600 flex-shrink-0" />
                                                                    <span className="text-[9px] text-green-700 truncate">{ci.type}{ci.confidence != null ? ` ${ci.confidence}%` : ''}</span>
                                                                </div>
                                                            ))}
                                                            {aiData.non_covered_items?.slice(0, 1).map((ni, i) => (
                                                                <div key={i} className="flex items-center gap-0.5">
                                                                    <XCircle className="w-2.5 h-2.5 text-red-500 flex-shrink-0" />
                                                                    <span className="text-[9px] text-red-700 truncate">{ni.type}{ni.confidence != null ? ` ${ni.confidence}%` : ''}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {aiData?.ai_notes && (
                                                        <p className="text-xs text-blue-600 mt-1 line-clamp-2 leading-snug">{aiData.ai_notes}</p>
                                                    )}
                                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                                        <Button
                                                            data-testid={`button-edit-photo-${item.id}`}
                                                            variant="outline"
                                                            size="sm"
                                                            className="flex-1 text-xs h-7"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleOpenPhotoDetail(item);
                                                            }}
                                                        >
                                                            <Edit className="w-3 h-3 mr-1" /> {t.edit || 'Edit'}
                                                        </Button>
                                                        {item.file_type === 'photo' && (
                                                            <Button
                                                                data-testid={`button-download-photo-${item.id}`}
                                                                variant="outline"
                                                                size="sm"
                                                                className="text-xs h-7 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                                                                disabled={downloadingIndividual === item.id}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    downloadIndividualPhoto(item);
                                                                }}
                                                            >
                                                                {downloadingIndividual === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                                            </Button>
                                                        )}
                                                        {item.file_type === 'photo' && (
                                                            <Button
                                                                data-testid={`button-reanalyze-${item.id}`}
                                                                variant="outline"
                                                                size="sm"
                                                                className="flex-1 text-xs h-7"
                                                                disabled={reanalyzingPhotoId === item.id}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleReanalyzePhoto(item);
                                                                }}
                                                            >
                                                                {reanalyzingPhotoId === item.id ? (
                                                                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> AI...</>
                                                                ) : (
                                                                    <><Zap className="w-3 h-3 mr-1" /> {hasAI ? 'Re-AI' : 'AI'}</>
                                                                )}
                                                            </Button>
                                                        )}
                                                        {item.file_type === 'photo' && (
                                                            <>
                                                            <Button
                                                                data-testid={`button-markup-${item.id}`}
                                                                variant="outline"
                                                                size="sm"
                                                                className="flex-1 text-xs h-7 text-orange-600 hover:text-orange-800 hover:bg-orange-50 border-orange-200"
                                                                title="Circle or line damage areas on this photo"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setMarkupPhoto({ id: item.id, file_url: item.annotated_url || item.file_url });
                                                                }}
                                                            >
                                                                <Pencil className="w-3 h-3 mr-1" /> Mark Up
                                                            </Button>
                                                            <Button
                                                                data-testid={`button-draw-analyze-${item.id}`}
                                                                variant="outline"
                                                                size="sm"
                                                                className="flex-1 text-xs h-7 text-violet-600 hover:text-violet-800 hover:bg-violet-50 border-violet-200"
                                                                title="Draw marks on photo then analyze only marked areas"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setDrawingPhoto({ id: item.id, file_url: item.file_url, section: item.section });
                                                                }}
                                                            >
                                                                <Pen className="w-3 h-3 mr-1" /> Draw &amp; Analyze
                                                            </Button>
                                                            </>
                                                        )}
                                                        {hasAI && (
                                                            <Button
                                                                data-testid={`button-clear-ai-${item.id}`}
                                                                variant="outline"
                                                                size="sm"
                                                                className="text-xs h-7 text-red-500 hover:text-red-700 hover:bg-red-50 px-2"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleClearAI(item);
                                                                }}
                                                            >
                                                                <XCircle className="w-3 h-3 mr-1" /> Undo
                                                            </Button>
                                                        )}
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })
                                ) : (
                                    <div className="col-span-full flex flex-col items-center justify-center text-center text-gray-500 py-8">
                                        <ImageIcon className="w-10 h-10 mb-2"/>
                                <p className="text-sm font-medium">{t.noPhotos || 'No photos yet'}</p>
                                        <p className="text-xs text-gray-400 mt-1">{t.useCameraToUpload || 'Use camera above or upload files'}</p>
                                    </div>
                                )
                            )}
                        </div>

                        {activeSectionMedia.length > 0 && (
                            <div
                                data-testid="photo-gallery-pagination"
                                className="mt-3 flex flex-col items-center justify-center gap-2 sm:flex-row"
                            >
                                <p className="text-xs text-gray-500" role="status" aria-live="polite">
                                    {t.showingGalleryItems(visibleSectionMedia.length, activeSectionMedia.length)}
                                </p>
                                {visibleSectionMedia.length < activeSectionMedia.length && (
                                    <Button
                                        type="button"
                                        data-testid="button-load-more-gallery"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setGalleryWindow({
                                            key: galleryWindowKey,
                                            count: Math.min(
                                                visibleMediaCount + PHOTO_GALLERY_BATCH_SIZE,
                                                activeSectionMedia.length
                                            ),
                                        })}
                                    >
                                        {t.loadMoreGalleryPhotos(Math.min(
                                            PHOTO_GALLERY_BATCH_SIZE,
                                            activeSectionMedia.length - visibleSectionMedia.length
                                        ))}
                                    </Button>
                                )}
                            </div>
                        )}

                        {/* Right-click range-select context menu */}
                        {photoContextMenu.visible && (
                            <div
                                data-testid="photo-context-menu"
                                className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[180px]"
                                style={{ left: Math.min(photoContextMenu.x, window.innerWidth - 200), top: Math.min(photoContextMenu.y, window.innerHeight - 200) }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 border-b mb-1">
                                    {selectedPhotos.length} photo{selectedPhotos.length !== 1 ? 's' : ''} selected
                                </div>
                                <button
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 flex items-center gap-2 text-orange-700"
                                    onClick={() => { setPhotoContextMenu({ visible: false, x: 0, y: 0 }); setMoveSectionTarget(''); setShowMoveSectionDialog(true); }}
                                    data-testid="ctx-move"
                                >
                                    <FolderOpen className="w-4 h-4" /> Move to section
                                </button>
                                <button
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 text-blue-700"
                                    onClick={() => { setPhotoContextMenu({ visible: false, x: 0, y: 0 }); handleBulkEdit(); }}
                                    data-testid="ctx-notes"
                                >
                                    <Edit className="w-4 h-4" /> Add note / caption
                                </button>
                                <button
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 flex items-center gap-2 text-green-700"
                                    onClick={() => { setPhotoContextMenu({ visible: false, x: 0, y: 0 }); handleBulkDownload(); }}
                                    data-testid="ctx-zip"
                                >
                                    <Archive className="w-4 h-4" /> Download as ZIP
                                </button>
                                <div className="border-t mt-1" />
                                <BulkDeleteButton
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 flex items-center gap-2 text-red-600"
                                    onClick={() => { setPhotoContextMenu({ visible: false, x: 0, y: 0 }); handleBulkDelete(); }}
                                    data-testid="ctx-delete"
                                >
                                    <Trash2 className="w-4 h-4" /> Delete selected
                                </BulkDeleteButton>
                                <div className="border-t mt-1" />
                                <button
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-500"
                                    onClick={() => { setPhotoContextMenu({ visible: false, x: 0, y: 0 }); setSelectedPhotos([]); setRangeAnchor(null); }}
                                    data-testid="ctx-clear"
                                >
                                    <XCircle className="w-4 h-4" /> Clear selection
                                </button>
                            </div>
                        )}

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                    <Label>{t.sectionNotes || 'Section Notes'}</Label>
                                    {notesAutoSaved && (
                                        <span className="text-xs text-green-600 flex items-center gap-1 animate-in fade-in">
                                            <CheckCircle className="w-3 h-3" /> {t.autoSaved || 'Auto-saved'}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <VoiceNoteButton
                                        label={t.dictate || 'Dictate'}
                                        cleanupMode={true}
                                        storageKey="voiceNote_sectionNote_cleanupMode"
                                        section={activeSection === 'All Photos' ? allPhotosNotesSection : activeSection}
                                        onResult={(text) => {
                                            const sec = activeSection === 'All Photos' ? allPhotosNotesSection : activeSection;
                                            handleSectionNotesChange(sec, (sectionNotes[sec] ? sectionNotes[sec] + '\n' : '') + text);
                                        }}
                                    />
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleSaveNotes}
                                        disabled={!jobId || updateJobNotesMutation.isPending}
                                    >
                                        {updateJobNotesMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                                        {t.saveNotes || t.save || 'Save Notes'}
                                    </Button>
                                </div>
                            </div>
                            {activeSection === 'All Photos' ? (
                                <div className="space-y-3">
                                    <div className="space-y-2">
                                        <select
                                            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            value={allPhotosNotesSection}
                                            onChange={(e) => setAllPhotosNotesSection(e.target.value)}
                                        >
                                            {sections.map(s => (
                                                <option key={s} value={s}>{translateSection(s)}{sectionNotes[s] ? ' ✓' : ''}</option>
                                            ))}
                                        </select>
                                        <Textarea
                                            placeholder={`${t.addNotesFor || 'Add notes for'} ${translateSection(allPhotosNotesSection)}...`}
                                            value={sectionNotes[allPhotosNotesSection] || ''}
                                            onChange={(e) => handleSectionNotesChange(allPhotosNotesSection, e.target.value)}
                                            rows={4}
                                        />
                                    </div>
                                    {sections.filter(s => sectionNotes[s] && s !== allPhotosNotesSection).length > 0 && (
                                        <div className="space-y-2 pt-1 border-t border-gray-100">
                                            <p className="text-xs text-gray-400 font-medium">{t.otherSectionNotes || 'Other section notes'}</p>
                                            {sections.filter(s => sectionNotes[s] && s !== allPhotosNotesSection).map(section => (
                                                <div key={section} className="bg-gray-50 rounded-lg p-3 cursor-pointer hover:bg-blue-50 transition-colors" onClick={() => setAllPhotosNotesSection(section)}>
                                                    <p className="text-xs font-semibold text-gray-700 mb-1">{translateSection(section)}</p>
                                                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{sectionNotes[section]}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <Textarea
                                    placeholder={`${t.addNotesFor || 'Add notes for'} ${translateSection(activeSection)}...`}
                                    value={sectionNotes[activeSection] || ''}
                                    onChange={(e) => handleSectionNotesChange(activeSection, e.target.value)}
                                    rows={4}
                                />
                            )}
                        </div>
                    </CardContent>
                </Card>

                {jobId && (
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <FileText className="w-5 h-5 text-blue-600" />
                                    <span>{t.scopeOfWork || 'Scope of Work'}</span>
                                    {sowAutoSaved && (
                                        <span className="text-xs text-green-600 flex items-center gap-1 animate-in fade-in font-normal">
                                            <CheckCircle className="w-3 h-3" /> {t.savedLabel || 'Saved'}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <VoiceNoteButton
                                        label={t.dictate || 'Dictate'}
                                        section="Scope of Work"
                                        cleanupMode={true}
                                        storageKey="voiceNote_scopeOfWork_cleanupMode"
                                        size="sm"
                                        onResult={(text) => setScopeOfWork(prev => prev ? prev + '\n' + text : text)}
                                    />
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleGenerateSow}
                                        disabled={generatingSow}
                                        className="text-purple-700 border-purple-300 hover:bg-purple-50"
                                        data-testid="button-generate-sow"
                                    >
                                        {generatingSow ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                                        {generatingSow ? (t.generatingLabel || 'Generating…') : (t.aiGenerate || 'AI Generate')}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleSaveSow()}
                                        disabled={!scopeOfWork}
                                        data-testid="button-save-sow"
                                    >
                                        <Save className="w-4 h-4 mr-1" />
                                        {t.save || 'Save'}
                                    </Button>
                                </div>
                            </CardTitle>
                            <p className="text-xs text-gray-500 mt-1">{t.describeWork || 'Describe the work needed. Use AI Generate to auto-write from your photo analysis, or tap Dictate to speak it.'}</p>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                placeholder={t.sowPlaceholder || "e.g.\n• Front slope: Full tear-off and replacement of 3-tab shingles, hail damage throughout\n• Ridge: Replace ridge cap, 12 lf\n• Gutters: Replace 40 lf aluminum gutters, dented from hail\n• Flashing: Replace step flashing at chimney…"}
                                value={scopeOfWork}
                                onChange={(e) => setScopeOfWork(e.target.value)}
                                onBlur={() => scopeOfWork && handleSaveSow()}
                                rows={8}
                                className="font-mono text-sm"
                                data-testid="textarea-scope-of-work"
                            />
                        </CardContent>
                    </Card>
                )}

                {/* ── Technical Evidence Section ──────────────────────────────────────── */}
                {/* Appears only when claim-critical keywords are detected in notes   */}
                {jobId && isEvidenceBlocked && (
                    <Card className="border-2 border-red-300 bg-red-50" data-testid="card-technical-evidence">
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-red-800">
                                <ShieldAlert className="w-5 h-5 text-red-600" />
                                Technical Evidence Required
                                {isTechEvidenceComplete && (
                                    <span className="ml-1 inline-flex items-center gap-1 text-xs font-normal bg-green-100 text-green-800 border border-green-300 px-2 py-0.5 rounded-full">
                                        <CheckCircle2 className="w-3 h-3" /> Complete
                                    </span>
                                )}
                            </CardTitle>
                            <p className="text-xs text-red-700 mt-1">
                                Keywords detected:{' '}
                                {triggeredKeywords.map((kw, i) => (
                                    <span key={kw} className="font-semibold">
                                        &ldquo;{kw}&rdquo;{i < triggeredKeywords.length - 1 ? ', ' : ''}
                                    </span>
                                ))}
                                . Upload the three evidence types below before generating the Proof Package.
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <TechEvidenceUpload
                                label="Core Sample"
                                description="Cross-section photo showing all roof layers"
                                required={1}
                                photos={techEvidencePhotos.coreSample}
                                section={TECH_EVIDENCE_SECTIONS.CORE_SAMPLE}
                                jobId={jobId}
                                uploadMutation={uploadMutation}
                                onUploaded={() => queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] })}
                            />
                            <TechEvidenceUpload
                                label="Measurement Proof"
                                description="Tape measure in frame showing dimensions"
                                required={1}
                                photos={techEvidencePhotos.measurement}
                                section={TECH_EVIDENCE_SECTIONS.MEASUREMENT}
                                jobId={jobId}
                                uploadMutation={uploadMutation}
                                onUploaded={() => queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] })}
                            />
                            <TechEvidenceUpload
                                label="Repairability Test"
                                description="3-photo sequence showing material failure under stress"
                                required={3}
                                photos={techEvidencePhotos.repairability}
                                section={TECH_EVIDENCE_SECTIONS.REPAIRABILITY}
                                jobId={jobId}
                                uploadMutation={uploadMutation}
                                onUploaded={() => queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] })}
                            />
                        </CardContent>
                    </Card>
                )}

                {jobId && (
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <FileText className="w-5 h-5 text-amber-600" />
                                    <span>{t.reportNotes || 'Report Notes'}</span>
                                    {reportNotesAutoSaved && (
                                        <span className="text-xs text-green-600 flex items-center gap-1 animate-in fade-in font-normal">
                                            <CheckCircle className="w-3 h-3" /> {t.savedLabel || 'Saved'}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <VoiceNoteButton
                                        label={t.dictate || 'Dictate'}
                                        section="Report Notes"
                                        cleanupMode={true}
                                        storageKey="voiceNote_reportNotes_cleanupMode"
                                        size="sm"
                                        onResult={(text) => setReportNotes(prev => prev ? prev + '\n' + text : text)}
                                    />
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleSaveReportNotes()}
                                        disabled={!reportNotes}
                                        data-testid="button-save-report-notes"
                                    >
                                        <Save className="w-4 h-4 mr-1" />
                                        {t.save || 'Save'}
                                    </Button>
                                </div>
                            </CardTitle>
                            <p className="text-xs text-gray-500 mt-1">{t.reportNotesHint || 'General notes included on the report — weather conditions, access issues, conversations with the homeowner, recommendations…'}</p>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                placeholder={t.reportNotesPlaceholder || "e.g.\n• Inspected after June 1 hail event, pea-to-quarter size hail reported\n• Homeowner reports leak in master bedroom ceiling\n• Recommend full replacement — damage exceeds repair threshold"}
                                value={reportNotes}
                                onChange={(e) => setReportNotes(e.target.value)}
                                onBlur={() => reportNotes && handleSaveReportNotes()}
                                rows={5}
                                className="text-sm"
                                data-testid="textarea-report-notes"
                            />
                        </CardContent>
                    </Card>
                )}


                {jobId && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <span>{t.inspectorSignature}</span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowSignatureDialog(true)}
                                >
                                    <Pen className="w-4 h-4 mr-2" />
                                    {inspectorSignature ? t.updateSignature : t.addSignature}
                                </Button>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {inspectorSignature ? (
                                <div className="border rounded p-4 bg-white max-w-xs sm:max-w-sm">
                                    <img src={inspectorSignature} alt="Inspector Signature" className="max-h-32 w-full object-contain" />
                                </div>
                            ) : (
                                <p className="text-gray-500 text-sm">{t.noSignature}</p>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>

            <Dialog open={showBulkEditDialog} onOpenChange={setShowBulkEditDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t.addNotesToPhotos} {selectedPhotos.length} {t.photos}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <Label>{t.additionalNotes}</Label>
                                <VoiceNoteButton
                                    label="Dictate"
                                    onResult={(text) => setBulkCaption(prev => prev ? `${prev} ${text}` : text)}
                                    storageKey="voiceNote_bulkCaption_cleanupMode"
                                    data-testid="button-bulk-caption-voice"
                                />
                            </div>
                            <Textarea
                                value={bulkCaption}
                                onChange={(e) => setBulkCaption(e.target.value)}
                                placeholder={t.hailDamageExample}
                                rows={3}
                                data-testid="textarea-bulk-caption"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowBulkEditDialog(false)}>{t.cancel}</Button>
                        <Button onClick={handleBulkCaptionSave}>{t.addNotes}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showMoveSectionDialog} onOpenChange={setShowMoveSectionDialog}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Move {selectedPhotos.length} Photo{selectedPhotos.length !== 1 ? 's' : ''} to Section</DialogTitle>
                        <DialogDescription>Choose which section to move the selected photos into.</DialogDescription>
                    </DialogHeader>
                    <div className="py-2">
                        <Label className="mb-2 block">Target Section</Label>
                        <Select value={moveSectionTarget} onValueChange={setMoveSectionTarget}>
                            <SelectTrigger data-testid="select-move-section">
                                <SelectValue placeholder="Select a section..." />
                            </SelectTrigger>
                            <SelectContent>
                                {sections.map(s => (
                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowMoveSectionDialog(false)}>Cancel</Button>
                        <Button onClick={handleMoveToSection} disabled={!moveSectionTarget || updateMediaMutation.isPending}>
                            {updateMediaMutation.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Moving...</> : 'Move Photos'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t.inspectorSignature}</DialogTitle>
                    </DialogHeader>
                    <SignaturePad onSave={handleSaveSignature} onCancel={() => setShowSignatureDialog(false)} />
                </DialogContent>
            </Dialog>

            {/* PDF Preview Modal */}
            <Dialog open={showPdfPreview} onOpenChange={(open) => {
                setShowPdfPreview(open);
                if (!open && previewPdfUrl) {
                    URL.revokeObjectURL(previewPdfUrl);
                    setPreviewPdfUrl(null);
                }
            }}>
                <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
                    <DialogHeader className="border-b pb-4">
                        <div className="flex items-center justify-between">
                            <DialogTitle>{t.inspectionReportPreview}</DialogTitle>
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => {
                                        if (previewPdfUrl) {
                                            const link = document.createElement('a');
                                            link.href = previewPdfUrl;
                                            link.target = '_blank';
                                            link.click();
                                        }
                                    }}
                                    variant="outline"
                                    className="md:hidden"
                                >
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    Open
                                </Button>
                                <Button
                                    onClick={() => {
                                        setShowPdfPreview(false);
                                        let ds = null;
                                        if (job?.property_address) {
                                            const parts = job.property_address.split(',').map(p => p.trim());
                                            if (parts.length >= 2) {
                                                const m = parts[parts.length - 2].match(/\b([A-Z]{2})\b/);
                                                if (m) ds = m[1];
                                            }
                                        }
                                        setDetectedState(ds);
                                        setItelStatus('none');
                                        setApplyStateCode(false);
                                        setShowTemplateDialog(true);
                                    }}
                                    disabled={isSendingReport}
                                    className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
                                >
                                    {isSendingReport ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                                    Send Report
                                </Button>
                            </div>
                        </div>
                    </DialogHeader>
                    <div className="flex-1 overflow-hidden bg-gray-100 rounded-lg">
                        {previewPdfUrl && (
                            <>
                                {/* Mobile: Show message with open button */}
                                <div className="md:hidden h-full flex flex-col items-center justify-center p-6 text-center">
                                    <FileText className="w-16 h-16 text-blue-600 mb-4" />
                                    <h3 className="text-lg font-semibold mb-2">PDF Ready</h3>
                                    <p className="text-gray-600 mb-6">Tap "Open" to view in a new tab</p>
                                    <Button
                                        size="lg"
                                        onClick={() => {
                                            const link = document.createElement('a');
                                            link.href = previewPdfUrl;
                                            link.target = '_blank';
                                            link.click();
                                        }}
                                        className="bg-blue-600 hover:bg-blue-700"
                                    >
                                        <ExternalLink className="w-5 h-5 mr-2" />
                                        Open PDF
                                    </Button>
                                </div>
                                {/* Desktop: Show iframe */}
                                <iframe
                                    src={previewPdfUrl}
                                    className="hidden md:block w-full h-full border-0"
                                    title="PDF Preview"
                                />
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={showLinkEstimateDialog} onOpenChange={setShowLinkEstimateDialog}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Estimate</DialogTitle>
                        <DialogDescription>
                            Generate a new estimate from this inspection, or link to an existing one.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Primary action: Generate from inspection */}
                    {(() => {
                        const analyzedPhotos = media.filter(m => m.file_type === 'photo' && m.ai_damage_analysis);
                        const totalHail = analyzedPhotos.reduce((s, m) => s + (m.ai_damage_analysis?.hail_hits_counted || 0), 0);
                        const totalWind = analyzedPhotos.reduce((s, m) => s + (m.ai_damage_analysis?.wind_marks_counted || 0), 0);
                        const hasDamageData = analyzedPhotos.length > 0;
                        return (
                            <div
                                className="rounded-xl border-2 border-purple-200 bg-purple-50 p-4 cursor-pointer hover:border-purple-400 hover:bg-purple-100 transition-colors"
                                onClick={() => {
                                    const params = new URLSearchParams({
                                        customer_name: currentClientName || '',
                                        customer_email: job?.client_email || '',
                                        customer_phone: job?.client_phone || '',
                                        property_address: job?.property_address || '',
                                        claim_number: job?.insurance_claim_number || '',
                                        inspection_job_id: jobId
                                    });
                                    navigate(createPageUrl('AIEstimator') + '?' + params.toString());
                                }}
                                data-testid="card-generate-estimate"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1">
                                        <p className="font-semibold text-purple-900">Generate Roofing Estimate from This Inspection</p>
                                        <p className="text-sm text-purple-700 mt-0.5">
                                            Opens the AI Estimator pre-filled with {currentClientName || 'this client'}'s info
                                            {job?.property_address ? ` and address` : ''}.
                                        </p>
                                        {hasDamageData && (
                                            <div className="flex gap-3 mt-2 text-xs text-purple-800">
                                                <span>📸 {analyzedPhotos.length} analyzed photos</span>
                                                {totalHail > 0 && <span>🌨 {totalHail} hail hits</span>}
                                                {totalWind > 0 && <span>💨 {totalWind} wind marks</span>}
                                            </div>
                                        )}
                                        {!hasDamageData && (
                                            <p className="text-xs text-purple-600 mt-1">Run AI analysis on photos first for best results.</p>
                                        )}
                                    </div>
                                    <div className="bg-purple-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap">
                                        Generate →
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Divider */}
                    {estimates.length > 0 && (
                        <div className="flex items-center gap-3 my-1">
                            <div className="flex-1 h-px bg-gray-200" />
                            <span className="text-xs text-gray-400 whitespace-nowrap">or link an existing estimate</span>
                            <div className="flex-1 h-px bg-gray-200" />
                        </div>
                    )}

                    {/* Secondary: link existing estimate */}
                    {estimates.length > 0 && (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                            {suggestedEstimates.length > 0 && (
                                <p className="text-xs font-semibold text-blue-600">🎯 Suggested Matches</p>
                            )}
                            {[...suggestedEstimates.slice(0, 3), ...estimates.filter(e => !suggestedEstimates.includes(e))].map(estimate => (
                                <Card
                                    key={estimate.id}
                                    className={`cursor-pointer hover:border-blue-400 transition-colors ${selectedEstimateId === estimate.id ? 'border-2 border-blue-500 bg-blue-50' : ''}`}
                                    onClick={() => setSelectedEstimateId(estimate.id)}
                                >
                                    <CardContent className="p-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="font-semibold text-gray-900 text-sm">{estimate.estimate_number}</p>
                                                <p className="text-xs text-gray-600">{estimate.customer_name}</p>
                                                <p className="text-xs text-gray-400">{estimate.property_address}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-green-600 text-sm">${Number(estimate.amount || 0).toFixed(2)}</p>
                                                <Badge variant="outline" className="text-xs">{estimate.status}</Badge>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowLinkEstimateDialog(false)}>Cancel</Button>
                        {selectedEstimateId && (
                            <Button
                                onClick={handleLinkEstimate}
                                disabled={linkEstimateMutation.isPending}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                {linkEstimateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LinkIcon className="w-4 h-4 mr-2" />}
                                Link Selected Estimate
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
                <DialogContent className="h-[90vh] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
                    <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0">
                        <DialogTitle>📧 Choose Report Template & Send</DialogTitle>
                        <DialogDescription>
                            Select a template optimized for the insurance carrier
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
                        {reportTemplates.length > 0 ? (
                            <div>
                                <Label>Select Template</Label>
                                <Select value={selectedTemplateId || 'default'} onValueChange={setSelectedTemplateId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Standard Report (Default)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="default">Standard Report (Default)</SelectItem>
                                        {reportTemplates.map(template => (
                                            <SelectItem key={template.id} value={template.id}>
                                                {template.template_name} {template.insurance_carrier && `(${template.insurance_carrier})`}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {selectedTemplateId && selectedTemplateId !== 'default' && (
                                    <p className="text-xs text-gray-600 mt-2">
                                        {reportTemplates.find(t => t.id === selectedTemplateId)?.description}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <Alert className="bg-blue-50 border-blue-200">
                                <AlertDescription className="text-blue-800">
                                    Using standard template. Create custom templates in Settings → Report Templates
                                </AlertDescription>
                            </Alert>
                        )}

                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-sm text-blue-900 font-semibold mb-2">📋 This report includes:</p>
                            <ul className="text-sm text-blue-800 space-y-1">
                                <li>✅ All inspection photos organized by section</li>
                                <li>✅ AI-generated Xactimate estimate</li>
                                <li>✅ Storm data (if linked)</li>
                                <li>✅ Inspector signature and notes</li>
                            </ul>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                                <input
                                    type="checkbox"
                                    id="sendToClient"
                                    checked={reportRecipients.sendToClient}
                                    onChange={(e) => setReportRecipients({...reportRecipients, sendToClient: e.target.checked})}
                                    className="w-4 h-4"
                                    disabled={!job?.client_email}
                                />
                                <label htmlFor="sendToClient" className="flex-1 cursor-pointer">
                                    <div className="font-semibold text-gray-900">Send to Client</div>
                                    <div className="text-sm text-gray-600">{job?.client_email || 'No email on file'}</div>
                                </label>
                            </div>

                            <div className="border-t pt-3">
                                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg mb-3">
                                    <input
                                        type="checkbox"
                                        id="sendToAdjuster"
                                        checked={reportRecipients.sendToAdjuster}
                                        onChange={(e) => setReportRecipients({...reportRecipients, sendToAdjuster: e.target.checked})}
                                        className="w-4 h-4"
                                    />
                                    <label htmlFor="sendToAdjuster" className="flex-1 cursor-pointer">
                                        <div className="font-semibold text-gray-900">Send to Insurance Adjuster</div>
                                        <div className="text-sm text-gray-600">Professional claim documentation</div>
                                    </label>
                                </div>

                                {reportRecipients.sendToAdjuster && (
                                    <div>
                                        <Label>Adjuster Email Address</Label>
                                        <Input
                                            type="email"
                                            value={reportRecipients.adjusterEmail}
                                            onChange={(e) => setReportRecipients({...reportRecipients, adjusterEmail: e.target.value})}
                                            placeholder="adjuster@insurance.com"
                                            className="mt-2"
                                            required
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="border-t pt-3">
                                <h4 className="font-semibold text-gray-900 mb-3">📤 Send to Internal Team</h4>
                                
                                <div className="bg-blue-50 rounded-lg mb-2 p-3">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            id="sendToProductionManager"
                                            checked={reportRecipients.sendToProductionManager}
                                            onChange={(e) => setReportRecipients({...reportRecipients, sendToProductionManager: e.target.checked})}
                                            className="w-4 h-4"
                                        />
                                        <label htmlFor="sendToProductionManager" className="flex-1 cursor-pointer">
                                            <div className="font-semibold text-gray-900">Production Manager</div>
                                            <div className="text-sm text-gray-600">
                                                {reportRecipients.productionManagerEmail
                                                    ? staffProfiles.find(s => s.user_email === reportRecipients.productionManagerEmail)?.full_name || reportRecipients.productionManagerEmail
                                                    : staffProfiles.length > 0 ? 'Select a team member below' : 'Enter email manually'}
                                            </div>
                                        </label>
                                    </div>
                                    {reportRecipients.sendToProductionManager && (
                                        <div className="mt-2 ml-7">
                                            {staffProfiles.length > 0 ? (
                                                <select
                                                    className="w-full border border-blue-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                    value={reportRecipients.productionManagerEmail}
                                                    onChange={(e) => setReportRecipients({...reportRecipients, productionManagerEmail: e.target.value})}
                                                    data-testid="select-production-manager"
                                                >
                                                    <option value="">— Select a team member —</option>
                                                    {productionManagers.length > 0 && (
                                                        <optgroup label="Production Managers">
                                                            {productionManagers.map(pm => (
                                                                <option key={pm.user_email} value={pm.user_email}>
                                                                    {pm.full_name || pm.name || pm.user_email}
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                    {staffProfiles.filter(s => s.role !== 'production_manager' && s.role !== 'Production Manager').length > 0 && (
                                                        <optgroup label="Other Staff">
                                                            {staffProfiles.filter(s => s.role !== 'production_manager' && s.role !== 'Production Manager').map(s => (
                                                                <option key={s.user_email} value={s.user_email}>
                                                                    {s.full_name || s.name || s.user_email} ({s.role || 'Staff'})
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                </select>
                                            ) : (
                                                <>
                                                    <input
                                                        type="email"
                                                        className="w-full border border-blue-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                        placeholder="production@yourcompany.com"
                                                        value={reportRecipients.productionManagerEmail}
                                                        onChange={(e) => setReportRecipients({...reportRecipients, productionManagerEmail: e.target.value})}
                                                        data-testid="input-production-manager-email"
                                                    />
                                                    <p className="text-xs text-blue-600 mt-1">No staff found — enter email manually or add staff in Settings.</p>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg mb-2">
                                    <input
                                        type="checkbox"
                                        id="sendToSalesRep"
                                        checked={reportRecipients.sendToSalesRep}
                                        onChange={(e) => setReportRecipients({...reportRecipients, sendToSalesRep: e.target.checked})}
                                        className="w-4 h-4"
                                        disabled={!job?.sales_rep_email}
                                    />
                                    <label htmlFor="sendToSalesRep" className="flex-1 cursor-pointer">
                                        <div className="font-semibold text-gray-900">Assigned Sales Rep</div>
                                        <div className="text-sm text-gray-600">{job?.sales_rep_email || 'No sales rep assigned'}</div>
                                    </label>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg mb-3">
                                    <input
                                        type="checkbox"
                                        id="sendToCustomEmails"
                                        checked={reportRecipients.sendToCustomEmails}
                                        onChange={(e) => setReportRecipients({...reportRecipients, sendToCustomEmails: e.target.checked})}
                                        className="w-4 h-4"
                                    />
                                    <label htmlFor="sendToCustomEmails" className="flex-1 cursor-pointer">
                                        <div className="font-semibold text-gray-900">Custom Recipients</div>
                                        <div className="text-sm text-gray-600">Add other team members</div>
                                    </label>
                                </div>

                                {reportRecipients.sendToCustomEmails && (
                                    <div>
                                        <Label>Email Addresses (comma-separated)</Label>
                                        <Input
                                            type="text"
                                            value={reportRecipients.customEmails}
                                            onChange={(e) => setReportRecipients({...reportRecipients, customEmails: e.target.value})}
                                            placeholder="raffy@company.com, manager@company.com"
                                            className="mt-2"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="border-t pt-3 space-y-3">
                            <h4 className="font-medium text-sm text-gray-900 border-b pb-2">🔍 Material Matching (ITEL & Code)</h4>

                            {detectedState && (
                                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                    <p className="text-sm text-green-900">
                                        <span className="font-semibold">📍 Detected State:</span> {detectedState}
                                    </p>
                                </div>
                            )}

                            <div>
                                <Label>ITEL Report Status</Label>
                                <Select value={itelStatus} onValueChange={setItelStatus}>
                                    <SelectTrigger className="mt-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Not Performed / N/A</SelectItem>
                                        <SelectItem value="match_found">Match Found (Repairable)</SelectItem>
                                        <SelectItem value="no_match">No Match Available (Discontinued)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {itelStatus === 'no_match' && (
                                <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                    <input
                                        type="checkbox"
                                        id="applyStateCodeCheck"
                                        className="mt-1"
                                        checked={applyStateCode}
                                        onChange={(e) => setApplyStateCode(e.target.checked)}
                                    />
                                    <label htmlFor="applyStateCodeCheck" className="text-sm cursor-pointer">
                                        <span className="font-semibold block text-blue-900">
                                            Apply {detectedState || 'State'} Matching Code?
                                        </span>
                                        <span className="text-blue-700">
                                            {detectedState
                                                ? `Apply ${detectedState} building code for reasonably uniform appearance. This will recommend replacement if materials don't match.`
                                                : "Reference building code for reasonably uniform appearance. This will recommend replacement if materials don't match."}
                                        </span>
                                    </label>
                                </div>
                            )}
                        </div>

                        <Alert className="bg-purple-50 border-purple-200">
                            <AlertDescription className="text-purple-800 text-sm">
                                📊 <strong>Email tracking enabled</strong> - You'll see when recipients open the report
                            </AlertDescription>
                        </Alert>
                    </div>
                    <div className="shrink-0 border-t px-4 py-3 flex flex-col gap-2 bg-white">
                        {isSendingReport && sendingStatus && (
                            <div className="w-full flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">
                                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                                <span>{sendingStatus}</span>
                            </div>
                        )}
                        <div className="flex gap-2 justify-end w-full">
                            <Button variant="outline" onClick={() => setShowTemplateDialog(false)} disabled={isSendingReport}>Cancel</Button>
                            <Button
                                onClick={handleGenerateAndSendReport}
                                disabled={isSendingReport || (!reportRecipients.sendToClient && !reportRecipients.sendToAdjuster && !reportRecipients.sendToProductionManager && !reportRecipients.sendToSalesRep && !reportRecipients.sendToCustomEmails) || (reportRecipients.sendToAdjuster && !reportRecipients.adjusterEmail)}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                {isSendingReport ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                                {isSendingReport ? 'Working...' : 'Generate & Send'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <AssignmentDialog
                isOpen={showEditDialog}
                onOpenChange={setShowEditDialog}
                existingJob={job}
                onAssignmentSent={(updatedJob) => {
                    queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
                    queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
                    // Refresh lead/customer profiles so the new assignee shows there too
                    queryClient.invalidateQueries({ queryKey: ['leads'] });
                    queryClient.invalidateQueries({ queryKey: ['lead-inspection-jobs'] });
                    queryClient.invalidateQueries({ queryKey: ['customers'] });
                    if (updatedJob?.related_lead_id) {
                        queryClient.invalidateQueries({ queryKey: ['lead', updatedJob.related_lead_id] });
                    }
                    if (updatedJob?.related_customer_id) {
                        queryClient.invalidateQueries({ queryKey: ['customer', updatedJob.related_customer_id] });
                    }
                    setShowEditDialog(false);
                }}
            />

            <LinkStormDialog
                isOpen={showLinkStormDialog}
                onOpenChange={setShowLinkStormDialog}
                currentStormId={job?.related_storm_event_id}
                jobAddress={job?.property_address}
                onStormLinked={(stormId) => {
                    linkStormMutation.mutate({ jobId, stormId });
                }}
            />

            {lightboxUrl && createPortal(
                <div
                    key={lightboxKey}
                    ref={lightboxContainerRef}
                    className="fixed inset-0 bg-black/95 select-none overflow-hidden"
                    style={{ touchAction: 'none', zIndex: 99999 }}
                    onWheel={(e) => {
                        const factor = e.deltaY < 0 ? 1.2 : (1 / 1.2);
                        setLightboxZoom(z => Math.min(10, Math.max(0.5, z * factor)));
                    }}
                    onMouseMove={(e) => {
                        if (!lightboxDragRef.current) return;
                        const dx = e.clientX - lightboxDragRef.current.startX;
                        const dy = e.clientY - lightboxDragRef.current.startY;
                        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) lightboxDragRef.current.didDrag = true;
                        setLightboxOffset({ x: lightboxDragRef.current.ox + dx, y: lightboxDragRef.current.oy + dy });
                    }}
                    onMouseUp={() => { lightboxDragRef.current = null; }}
                    onMouseLeave={() => { lightboxDragRef.current = null; }}
                >
                    <div className="absolute inset-0" onClick={() => { if (!lightboxDragRef.current?.didDrag) { setLightboxUrl(null); if (editingPhoto) setShowPhotoDetailDialog(true); } }} />
                    <button
                        className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/80"
                        style={{ zIndex: 100001 }}
                        onClick={() => { setLightboxUrl(null); if (editingPhoto) setShowPhotoDetailDialog(true); }}
                        aria-label="Close"
                    >
                        <X className="w-6 h-6" />
                    </button>
                    <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ cursor: lightboxDragRef.current ? 'grabbing' : (lightboxZoom > 1 ? 'grab' : 'zoom-in') }}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            lightboxDragRef.current = { startX: e.clientX, startY: e.clientY, ox: lightboxOffset.x, oy: lightboxOffset.y, didDrag: false };
                        }}
                    >
                        <img
                            src={lightboxUrl}
                            alt="Inspection photo"
                            draggable={false}
                            style={{
                                transform: `translate(${lightboxOffset.x}px, ${lightboxOffset.y}px) scale(${lightboxZoom})`,
                                transformOrigin: 'center center',
                                transition: lightboxDragRef.current ? 'none' : 'transform 0.12s ease',
                                maxWidth: '90vw',
                                maxHeight: '88vh',
                                objectFit: 'contain',
                                userSelect: 'none',
                                pointerEvents: 'none',
                            }}
                        />
                    </div>
                    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/70 rounded-full px-5 py-2.5" style={{ zIndex: 100001 }}>
                        <button onClick={() => setLightboxZoom(z => Math.max(0.1, z / 1.5))} className="text-white hover:text-gray-300 p-1" title="Zoom out (-)">
                            <ZoomOut className="w-6 h-6" />
                        </button>
                        <span className="text-white text-sm font-mono w-14 text-center">{Math.round(lightboxZoom * 100)}%</span>
                        <button onClick={() => setLightboxZoom(z => Math.min(10, z * 1.5))} className="text-white hover:text-gray-300 p-1" title="Zoom in (+)">
                            <ZoomIn className="w-6 h-6" />
                        </button>
                        <div className="w-px h-5 bg-white/25 mx-1" />
                        <button
                            onClick={() => { setLightboxZoom(1); setLightboxOffset({ x: 0, y: 0 }); }}
                            className="text-white/70 hover:text-white text-xs font-medium px-1"
                        >
                            Reset
                        </button>
                    </div>
                    <div className="absolute bottom-6 right-6 text-white/35 text-xs" style={{ zIndex: 100001 }}>
                        Scroll to zoom · Drag to pan · Click backdrop to close
                    </div>
                </div>,
                document.body
            )}

            <Dialog open={showPhotoDetailDialog} onOpenChange={(open) => { setShowPhotoDetailDialog(open); if (!open) setEditingPhoto(null); }}>
                <DialogContent className="w-[95vw] sm:max-w-[90vw] max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Photo Details</DialogTitle>
                        <DialogDescription>View, edit damage counts, or re-analyze this photo</DialogDescription>
                        {editingPhoto && (
                            <div className="pt-1 flex items-center gap-2">
                                <svg className="w-3.5 h-3.5 text-blue-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                                <Select
                                    value={editFormData.section || 'Other'}
                                    onValueChange={(val) => setEditFormData(prev => ({ ...prev, section: val }))}
                                >
                                    <SelectTrigger data-testid="select-photo-section" className="h-7 text-xs font-semibold text-blue-800 bg-blue-50 border-blue-200 rounded-full px-3 w-auto gap-1.5 hover:bg-blue-100">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Needs Section" className="text-xs">Needs Section — choose a named area</SelectItem>
                                        {sections.map(s => (
                                            <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                                        ))}
                                        <SelectItem value="Needs Section" className="text-xs">Needs Section — choose a named area</SelectItem>
                                    </SelectContent>
                                </Select>
                                {!isNamedDamageSection(editFormData.section) && (
                                    <span className="text-xs text-amber-700">Choose Front/Rear/Left/Right, a named slope, or a building component before analysis.</span>
                                )}
                            </div>
                        )}
                    </DialogHeader>
                    {editingPhoto && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="flex flex-col gap-3">
                                <div
                                    className="relative rounded-md overflow-hidden bg-gray-100 cursor-zoom-in group"
                                    onClick={() => {
                                        setShowPhotoDetailDialog(false);
                                        setLightboxZoom(1);
                                        setLightboxOffset({ x: 0, y: 0 });
                                        setLightboxKey(k => k + 1);
                                        setLightboxUrl(editingPhoto.annotated_url || editingPhoto.file_url);
                                    }}
                                    title="Click to open zoom viewer"
                                >
                                    <SafeImage
                                        src={editingPhoto.annotated_url || editingPhoto.file_url}
                                        alt={editingPhoto.caption || ''}
                                        objectFit="contain"
                                        className="w-full"
                                        style={{ minHeight: '300px', maxHeight: '560px' }}
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                                        <div className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5">
                                            <ZoomIn className="w-3.5 h-3.5" /> Click to zoom &amp; pan
                                        </div>
                                    </div>
                                    {editingPhoto.annotated_url && (
                                        <div className="absolute bottom-2 right-2 bg-blue-600 text-white text-xs px-2 py-0.5 rounded font-semibold">
                                            AI Annotated
                                        </div>
                                    )}
                                </div>
                                {(editingPhoto.ai_damage_analysis?.possible_detections?.length > 0 ||
                                  editingPhoto.ai_damage_analysis?.requires_material_confirmation ||
                                  editingPhoto.ai_damage_analysis?.needs_reanalysis_after_material_confirm) && (
                                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                        <div className="font-semibold">
                                            {editingPhoto.ai_damage_analysis?.needs_reanalysis_after_material_confirm
                                                ? 'Material confirmed — re-analyze this photo'
                                                : editingPhoto.ai_damage_analysis?.requires_material_confirmation
                                                    ? 'Confirm the material before damage can be counted'
                                                    : 'Possible marks — not included in damage totals'}
                                        </div>
                                        {editingPhoto.ai_damage_analysis?.needs_reanalysis_after_material_confirm && (
                                            <p className="mt-1">Prior findings were held for review because they used the earlier material assumption.</p>
                                        )}
                                        {editingPhoto.ai_damage_analysis?.possible_detections?.slice(0, 6).map((detection, index) => (
                                            <div key={`${detection.type}-${index}`} className="mt-1 text-xs">
                                                Possible {detection.damage_kind || detection.type} · {detection.confidence}% confidence
                                                {detection.review_reason ? ` — ${detection.review_reason}` : ''}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {editingPhoto.ai_damage_analysis?.manually_edited && (
                                    <p className="text-xs text-purple-600">Manually edited on {new Date(editingPhoto.ai_damage_analysis.edited_at).toLocaleString()}</p>
                                )}
                            </div>

                            <div className="flex flex-col gap-4">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <Label>Caption / Description (Slope &amp; What's Shown)</Label>
                                        <VoiceNoteButton
                                            label="Dictate"
                                            section={editingPhoto?.section || editingPhoto?.ai_damage_analysis?.detected_sections?.[0] || ""}
                                            cleanupMode={false}
                                            storageKey="voiceNote_photoCaption_cleanupMode"
                                            size="sm"
                                            onResult={(text) => setEditFormData(prev => ({ ...prev, caption: prev.caption ? prev.caption + ' ' + text : text }))}
                                        />
                                    </div>
                                    <Textarea
                                        data-testid="input-photo-caption"
                                        value={editFormData.caption}
                                        onChange={(e) => setEditFormData(prev => ({ ...prev, caption: e.target.value }))}
                                        placeholder="e.g., North Slope - Close-up of hail damage on 3-tab shingles"
                                        rows={2}
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <Label>Description</Label>
                                        <VoiceNoteButton
                                            label="Dictate"
                                            section={editingPhoto?.section || editingPhoto?.ai_damage_analysis?.detected_sections?.[0] || ""}
                                            cleanupMode={true}
                                            storageKey="voiceNote_photoDescription_cleanupMode"
                                            size="sm"
                                            onResult={(text) => setEditFormData(prev => ({ ...prev, description: prev.description ? prev.description + '\n' + text : text }))}
                                        />
                                    </div>
                                    <Textarea
                                        data-testid="input-photo-description"
                                        value={editFormData.description}
                                        onChange={(e) => setEditFormData(prev => ({ ...prev, description: e.target.value }))}
                                        placeholder="Detailed description of what's shown in this photo..."
                                        rows={3}
                                    />
                                </div>

                                <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <Label>Photo Type</Label>
                                            <Select
                                                value={editFormData.photo_type || 'Overview'}
                                                onValueChange={(val) => setEditFormData(prev => ({ ...prev, photo_type: val }))}
                                            >
                                                <SelectTrigger data-testid="select-photo-type"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {PHOTO_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                            <p className="mt-1 text-xs text-slate-500">
                                                {editFormData.photo_type === 'Overview'
                                                    ? 'Context only; excluded from test-square hit density.'
                                                    : 'Inspector selected; only this and close-up photos qualify as damage evidence.'}
                                            </p>
                                        </div>
                                        <div>
                                            <Label>Visible Material</Label>
                                            <select
                                                data-testid="select-photo-material"
                                                value={editFormData.material_category || ''}
                                                onChange={(e) => {
                                                    const selected = PHOTO_DAMAGE_MATERIALS.find(([key]) => key === e.target.value);
                                                    setEditFormData(prev => ({
                                                        ...prev,
                                                        material_category: e.target.value,
                                                        material_type_identified: selected?.[1] || '',
                                                    }));
                                                }}
                                                className="w-full h-10 rounded-md border bg-white px-3 text-sm"
                                            >
                                                <option value="">Select or confirm material</option>
                                                {PHOTO_DAMAGE_MATERIALS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                                            </select>
                                            {editingPhoto.ai_damage_analysis?.material_confidence != null && (
                                                <p className="mt-1 text-xs text-slate-500">
                                                    AI material confidence: {editingPhoto.ai_damage_analysis.material_confidence}%
                                                    {editingPhoto.ai_damage_analysis?.material_clues ? ` · ${editingPhoto.ai_damage_analysis.material_clues}` : ''}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    {editFormData.material_category === 'roof_shingle' && (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                            <div>
                                                <Label>Shingle Type</Label>
                                                <Select value={editFormData.shingle_type || 'none'} onValueChange={(val) => setEditFormData(prev => ({ ...prev, shingle_type: val }))}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {['none', '3-tab', 'dimensional', 'architectural', 'organic', 't-lock'].map(type => <SelectItem key={type} value={type}>{type === 'none' ? 'Not confirmed' : type}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div>
                                                <Label>Exposure (inches)</Label>
                                                <Input type="number" min="0" step="0.25" value={editFormData.shingle_exposure_inches} onChange={e => setEditFormData(prev => ({ ...prev, shingle_exposure_inches: e.target.value }))} />
                                            </div>
                                            <div>
                                                <Label>Roof Layers</Label>
                                                <Input type="number" min="1" step="1" value={editFormData.roof_layers} onChange={e => setEditFormData(prev => ({ ...prev, roof_layers: e.target.value }))} />
                                            </div>
                                        </div>
                                    )}
                                    {editingPhoto.ai_damage_analysis?.material_candidates?.length > 0 && (
                                        <div>
                                            <p className="text-xs font-medium text-slate-600 mb-1">AI alternatives — choose the correct material:</p>
                                            <div className="flex flex-wrap gap-2">
                                                {editingPhoto.ai_damage_analysis.material_candidates.slice(0, 3).map(candidate => (
                                                    <Button
                                                        key={candidate.material_category}
                                                        type="button"
                                                        size="sm"
                                                        variant={editFormData.material_category === candidate.material_category ? 'default' : 'outline'}
                                                        onClick={() => setEditFormData(prev => ({ ...prev, material_category: candidate.material_category, material_type_identified: candidate.label }))}
                                                    >
                                                        {candidate.label} ({candidate.confidence}%)
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <Button
                                        type="button"
                                        data-testid="button-confirm-photo-material"
                                        disabled={!isNamedDamageSection(editFormData.section) || !editFormData.material_category}
                                        onClick={() => confirmPhotoSectionMaterial()}
                                    >
                                        Confirm material for this section
                                    </Button>
                                    <p className="text-xs text-slate-500">
                                        This confirmation applies to all photos in this section. Earlier damage counts are held for re-analysis under the confirmed material rules.
                                    </p>
                                </div>

                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <Label>Hail Hits</Label>
                                        <Input
                                            data-testid="input-hail-count"
                                            type="number"
                                            min="0"
                                            value={editFormData.hail_hits_counted}
                                            onChange={(e) => setEditFormData(prev => ({ ...prev, hail_hits_counted: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <Label>Wind Marks</Label>
                                        <Input
                                            data-testid="input-wind-count"
                                            type="number"
                                            min="0"
                                            value={editFormData.wind_marks_counted}
                                            onChange={(e) => setEditFormData(prev => ({ ...prev, wind_marks_counted: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <Label>Missing</Label>
                                        <Input
                                            data-testid="input-missing-count"
                                            type="number"
                                            min="0"
                                            value={editFormData.missing_shingles_counted}
                                            onChange={(e) => setEditFormData(prev => ({ ...prev, missing_shingles_counted: e.target.value }))}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <Label>Severity</Label>
                                    <Select
                                        value={editFormData.severity}
                                        onValueChange={(val) => setEditFormData(prev => ({ ...prev, severity: val }))}
                                    >
                                        <SelectTrigger data-testid="select-severity">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">None</SelectItem>
                                            <SelectItem value="minor">Minor</SelectItem>
                                            <SelectItem value="moderate">Moderate</SelectItem>
                                            <SelectItem value="severe">Severe</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <button
                                    data-testid="button-copy-damage-report"
                                    onClick={() => {
                                        const lines = [];
                                        if (editingPhoto?.section) lines.push(`Section: ${editingPhoto.section}`);
                                        lines.push(`Severity: ${(editFormData.severity || 'none').toUpperCase()}`);
                                        const counts = [];
                                        if (editFormData.hail_hits_counted > 0) counts.push(`Hail Hits: ${editFormData.hail_hits_counted}`);
                                        if (editFormData.wind_marks_counted > 0) counts.push(`Wind Marks: ${editFormData.wind_marks_counted}`);
                                        if (editFormData.missing_shingles_counted > 0) counts.push(`Missing Shingles: ${editFormData.missing_shingles_counted}`);
                                        if (counts.length > 0) lines.push(counts.join(' | '));
                                        if (editFormData.caption) lines.push(`Caption: ${editFormData.caption}`);
                                        if (editFormData.description) lines.push(`Description: ${editFormData.description}`);
                                        navigator.clipboard.writeText(lines.join('\n')).then(() => {
                                            toast.success('Damage report copied to clipboard');
                                        }).catch(() => {
                                            toast.error('Copy failed — please copy manually');
                                        });
                                    }}
                                    className="w-full flex items-center justify-center gap-2 text-sm font-medium text-blue-700 border border-blue-300 rounded-md py-2 px-3 bg-blue-50 hover:bg-blue-100 transition-colors"
                                >
                                    <Copy className="w-4 h-4" />
                                    Copy Damage Report
                                </button>

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <Label className="flex items-center gap-1.5">
                                            Inspector Correction for AI
                                            <span className="text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">used on Re-Analyze</span>
                                        </Label>
                                        <VoiceNoteButton
                                            label="Dictate"
                                            section={editingPhoto?.section || editingPhoto?.ai_damage_analysis?.detected_sections?.[0] || ""}
                                            cleanupMode={false}
                                            storageKey="voiceNote_inspectorCorrection_cleanupMode"
                                            size="sm"
                                            onResult={(text) => setEditFormData(prev => ({ ...prev, inspector_correction: prev.inspector_correction ? prev.inspector_correction + ' ' + text : text }))}
                                        />
                                    </div>
                                    <Textarea
                                        data-testid="input-inspector-correction"
                                        value={editFormData.inspector_correction}
                                        onChange={(e) => setEditFormData(prev => ({ ...prev, inspector_correction: e.target.value }))}
                                        placeholder='e.g. "aluminum siding, not vinyl" or "3-tab shingles with 5-inch exposure"'
                                        rows={2}
                                        className="text-sm"
                                    />
                                </div>

                                <div className="flex-1 flex flex-col">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center gap-2">
                                            <Label className="mb-0">AI Notes</Label>
                                            {editingPhoto?.ai_damage_analysis?.inspector_guided && (
                                                <Badge data-testid="badge-inspector-guided" className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-2 py-0.5">
                                                    Inspector Guided
                                                </Badge>
                                            )}
                                        </div>
                                        <VoiceNoteButton
                                            label="Dictate"
                                            section={editingPhoto?.section || editingPhoto?.ai_damage_analysis?.detected_sections?.[0] || ""}
                                            cleanupMode={true}
                                            storageKey="voiceNote_aiNotes_cleanupMode"
                                            size="sm"
                                            onResult={(text) => setEditFormData(prev => ({ ...prev, ai_notes: prev.ai_notes ? prev.ai_notes + '\n' + text : text }))}
                                        />
                                    </div>
                                    <Textarea
                                        data-testid="input-ai-notes"
                                        value={editFormData.ai_notes}
                                        onChange={(e) => setEditFormData(prev => ({ ...prev, ai_notes: e.target.value }))}
                                        placeholder="Damage observations and notes..."
                                        rows={10}
                                        className="flex-1 resize-y overflow-y-auto"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter className="flex flex-col sm:flex-row gap-2">
                        {editingPhoto?.ai_damage_analysis?.detected_sections?.length > 0 && (
                            <Button
                                data-testid="button-adjust-squares"
                                variant="outline"
                                className="border-orange-400 text-orange-600 hover:bg-orange-50"
                                onClick={() => {
                                    setShowPhotoDetailDialog(false);
                                    setAerialEditorPhoto(editingPhoto);
                                }}
                            >
                                <Move className="w-4 h-4 mr-1" />
                                Adjust Test Squares
                            </Button>
                        )}
                        {editingPhoto?.file_type === 'photo' && (
                            <>
                                <Button
                                    data-testid="button-open-measure"
                                    variant="outline"
                                    onClick={() => {
                                        setMeasureTargetPhoto(editingPhoto);
                                        setShowMeasureTool(true);
                                    }}
                                >
                                    <Ruler className="w-4 h-4 mr-1" />
                                    Measure
                                    {editingPhoto?.measurements?.length > 0 && (
                                        <span className="ml-1 bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                                            {editingPhoto.measurements.length}
                                        </span>
                                    )}
                                </Button>
                                <Button
                                    data-testid="button-dialog-reanalyze"
                                    variant="outline"
                                    disabled={reanalyzingPhotoId === editingPhoto?.id}
                                    onClick={async () => {
                                        if (!isNamedDamageSection(editFormData.section)) {
                                            toast.error('Choose a named elevation, slope, or building section first.');
                                            return;
                                        }
                                        const photoType = editFormData.photo_type || 'Overview';
                                        await base44.entities.JobMedia.update(editingPhoto.id, { section: editFormData.section, photo_type: photoType });
                                        const photoForAnalysis = { ...editingPhoto, section: editFormData.section, photo_type: photoType };
                                        setEditingPhoto(photoForAnalysis);
                                        const result = await handleReanalyzePhoto(photoForAnalysis, false, editFormData.inspector_correction);
                                        if (result) {
                                            setEditFormData(prev => ({
                                                ...prev,
                                                hail_hits_counted: result.hail_hits_counted || 0,
                                                wind_marks_counted: result.wind_marks_counted || 0,
                                                missing_shingles_counted: result.missing_shingles_counted || 0,
                                                severity: result.severity || 'none',
                                                ai_notes: result.ai_notes || '',
                                                material_category: result.material_category || '',
                                                material_type_identified: result.material_type_identified || '',
                                                photo_type: result.photo_type || photoType,
                                                shingle_type: result.shingle_type || 'none',
                                                shingle_exposure_inches: result.shingle_exposure_inches ?? '',
                                                roof_layers: result.roof_layers ?? '',
                                            }));
                                            setEditingPhoto(prev => prev ? ({
                                                ...prev,
                                                photo_type: result.photo_type || photoType,
                                                ai_damage_analysis: {
                                                    ...(prev.ai_damage_analysis || {}),
                                                    ...result
                                                }
                                            }) : prev);
                                        }
                                    }}
                                >
                                    {reanalyzingPhotoId === editingPhoto?.id ? (
                                        <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Analyzing...</>
                                    ) : (
                                        <><Zap className="w-4 h-4 mr-1" /> Re-Analyze with AI</>
                                    )}
                                </Button>
                                {editingPhoto?.ai_damage_analysis && (
                                    <Button
                                        data-testid="button-dialog-clear-ai"
                                        variant="outline"
                                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                        onClick={async () => {
                                            await handleClearAI(editingPhoto);
                                            setShowPhotoDetailDialog(false);
                                            setEditingPhoto(null);
                                        }}
                                    >
                                        <XCircle className="w-4 h-4 mr-1" /> Clear AI
                                    </Button>
                                )}
                            </>
                        )}
                        <Button variant="outline" onClick={() => { setShowPhotoDetailDialog(false); setEditingPhoto(null); }}>Cancel</Button>
                        <Button data-testid="button-save-photo-detail" onClick={handleSavePhotoDetail}>
                            <Save className="w-4 h-4 mr-1" /> Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showSharePhotosDialog} onOpenChange={setShowSharePhotosDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Share Photos</DialogTitle>
                        <DialogDescription>Send inspection photos with damage notes to your production manager or anyone else. No formal report — just the photos, labels, and notes.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Recipient Email</Label>
                            <Input
                                data-testid="input-share-email"
                                type="email"
                                value={shareEmail}
                                onChange={(e) => setShareEmail(e.target.value)}
                                placeholder="productionmanager@company.com"
                            />
                        </div>
                        <div className="bg-gray-50 rounded-md p-3 text-sm text-gray-600">
                            <p className="font-medium mb-1">What gets sent:</p>
                            <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>All photos (annotated versions if available)</li>
                                <li>Photo captions and slope/area labels</li>
                                <li>Damage counts (hail, wind, missing)</li>
                                <li>AI notes and manual edits</li>
                                <li>Section notes</li>
                            </ul>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSharePhotosDialog(false)}>Cancel</Button>
                        <Button
                            data-testid="button-send-share"
                            onClick={handleSharePhotosEmail}
                            disabled={!shareEmail || isSharingPhotos}
                        >
                            {isSharingPhotos ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Sending...</> : <><Send className="w-4 h-4 mr-1" /> Send Photos</>}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {markupPhoto && (
                <SimplePhotoMarkup
                    photoUrl={markupPhoto.file_url}
                    mediaId={markupPhoto.id}
                    onSave={(annotatedUrl) => {
                        queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
                        setMarkupPhoto(null);
                    }}
                    onClose={() => setMarkupPhoto(null)}
                />
            )}

            {drawingPhoto && (
                <PhotoDrawingCanvas
                    photoUrl={drawingPhoto.file_url}
                    isAnalyzing={isDrawAnalyzing}
                    onAnalyze={handleDrawAndAnalyze}
                    onClose={() => { if (!isDrawAnalyzing) setDrawingPhoto(null); }}
                />
            )}

            {showMeasureTool && measureTargetPhoto && (
                <PhotoMeasureTool
                    photoUrl={measureTargetPhoto.annotated_url || measureTargetPhoto.file_url}
                    existingMeasurements={measureTargetPhoto.measurements || []}
                    onSave={handleSaveMeasurements}
                    onClose={() => { setShowMeasureTool(false); setMeasureTargetPhoto(null); }}
                />
            )}

            {/* ── Evidence Blocked Modal ──────────────────────────────────────────── */}
            <Dialog open={showEvidenceBlockedModal} onOpenChange={(open) => !open && setShowEvidenceBlockedModal(false)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-700">
                            <ShieldAlert className="w-5 h-5" />
                            Technical Evidence Required
                        </DialogTitle>
                        <DialogDescription>
                            Claim-critical language was detected in your notes. Upload the required technical evidence photos before generating the Claims Defense File.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <p className="text-xs font-semibold text-red-700 mb-1.5">Keywords detected:</p>
                            <div className="flex flex-wrap gap-1.5">
                                {triggeredKeywords.map(kw => (
                                    <span key={kw} className="bg-red-100 text-red-800 border border-red-300 text-xs font-mono px-2 py-0.5 rounded">
                                        &ldquo;{kw}&rdquo;
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2">
                            {[
                                { label: 'Core Sample', count: techEvidencePhotos.coreSample.length, required: 1, desc: 'Cross-section showing all roof layers' },
                                { label: 'Measurement Proof', count: techEvidencePhotos.measurement.length, required: 1, desc: 'Tape measure in frame showing dimensions' },
                                { label: 'Repairability Test', count: techEvidencePhotos.repairability.length, required: 3, desc: '3-photo sequence showing material failure' },
                            ].map(item => (
                                <div key={item.label} className={`flex items-center gap-3 p-2.5 rounded-lg border ${item.count >= item.required ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'}`}>
                                    {item.count >= item.required
                                        ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                                        : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800">{item.label}</p>
                                        <p className="text-xs text-gray-500">{item.desc}</p>
                                    </div>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${item.count >= item.required ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'}`}>
                                        {item.count}/{item.required}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setShowEvidenceBlockedModal(false)}>
                            Close &amp; Upload Photos
                        </Button>
                        {isTechEvidenceComplete && (
                            <Button
                                onClick={() => { setShowEvidenceBlockedModal(false); setShowProofPackage(true); }}
                                className="bg-blue-600 hover:bg-blue-700 text-white"
                            >
                                Continue to Proof Package
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Photo quality warning dialog ───────────────────────────────── */}
            <Dialog open={!!photoQualityWarning} onOpenChange={(open) => { if (!open) setPhotoQualityWarning(null); }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                            Photo quality warning
                        </DialogTitle>
                        <DialogDescription>
                            {photoQualityWarning?.flaggedItems?.length === 1
                                ? 'This photo may be hard to analyse:'
                                : `${photoQualityWarning?.flaggedItems?.length} photos may be hard to analyse:`}
                        </DialogDescription>
                    </DialogHeader>
                    <ul className="text-sm space-y-1.5 my-1 max-h-40 overflow-y-auto">
                        {photoQualityWarning?.flaggedItems?.map(({ file, reasons }, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                                <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                                <span>
                                    <span className="font-medium truncate max-w-[14rem] inline-block align-bottom">{file.name}</span>
                                    {' — '}
                                    <span className="text-amber-700">{reasons.join(', ')}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className="text-xs text-gray-500 mt-1">Retake for a clearer photo, or upload anyway.</p>
                    <DialogFooter className="flex gap-2 mt-2">
                        <Button variant="outline" onClick={() => setPhotoQualityWarning(null)}>
                            Retake
                        </Button>
                        <Button
                            onClick={async () => {
                                const fn = photoQualityWarning?.proceedFn;
                                setPhotoQualityWarning(null);
                                if (fn) await fn();
                            }}
                        >
                            Upload anyway
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ProofPackageModal
                open={showProofPackage}
                onClose={() => setShowProofPackage(false)}
                job={job}
                media={media}
                company={myCompany}
                techEvidenceMedia={[
                    ...techEvidencePhotos.coreSample,
                    ...techEvidencePhotos.measurement,
                    ...techEvidencePhotos.repairability,
                ]}
                inspectionType={inspectionType}
            />

            {aerialEditorPhoto && (
                <AerialSquareEditor
                    photo={aerialEditorPhoto}
                    onClose={() => setAerialEditorPhoto(null)}
                    onSaved={() => {
                        setAerialEditorPhoto(null);
                        queryClient.invalidateQueries({ queryKey: ['/api/job-media'] });
                    }}
                />
            )}

            {/* ── PWA Add-to-Home-Screen banner ─────────────────────────────
                 Shown when the browser fires beforeinstallprompt (Android Chrome,
                 Samsung Internet, Edge). Gives the app higher-priority mic and
                 camera access in Standalone mode vs. Standard browser mode. */}
            {/* PWA install banner is now app-wide — see src/components/PwaInstallBanner.jsx (rendered in Layout) */}
        </div>
    );
}