import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import heic2any from 'heic2any';
import { base44 } from '@/api/base44Client';
import useRoleBasedData from "@/components/hooks/useRoleBasedData";
import { useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Camera, Loader2, Image as ImageIcon, Trash2, FileText, Edit, CheckCircle, Save, Pen, Upload, Send, Mail, Link as LinkIcon, ExternalLink, AlertCircle, Eye, Sparkles, Zap, Download, XCircle, Archive, FolderOpen, Square, Mic, ShieldCheck, ShieldAlert, ShieldX, ChevronDown, ChevronUp, CheckCircle2, Ruler } from 'lucide-react';
import PhotoMeasureTool from '../components/inspections/PhotoMeasureTool';
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
import { annotateImage } from '@/components/inspections/ImageAnnotation';
import SignaturePad from '../components/SignaturePad';
import AssignmentDialog from '../components/inspections/AssignmentDialog';
import LinkStormDialog from '../components/inspections/LinkStormDialog';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { getTranslations, getStoredLanguage, setStoredLanguage } from '@/utils/translations';

const sections = [
    'Front Elevation', 'Right Elevation', 'Rear Elevation', 'Left Elevation',
    'Front Slope', 'Right Slope', 'Back Slope', 'Left Slope',
    'Siding', 'Gutters', 'Window Seals', 'Soft Metals', 'Interior', 'Other'
];

const detectSectionFromFilename = (filename) => {
    if (!filename) return null;
    const lower = filename.toLowerCase().replace(/[_\-\s]+/g, ' ');
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

export default function InspectionCapture() {
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    
    const { user, myCompany, isAdmin, hasPermission, isPermissionsReady, effectiveUserEmail } = useRoleBasedData();

    const [jobId, setJobId] = useState(null);
    const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 768;
    const [activeSection, setActiveSection] = useState(isMobileDevice ? 'All Photos' : sections[0]);
    const [isSecureContext, setIsSecureContext] = useState(false);
    const [sectionNotes, setSectionNotes] = useState({});
    const [isExporting, setIsExporting] = useState(false);
    const [isViewing, setIsViewing] = useState(false);
    const [showPdfPreview, setShowPdfPreview] = useState(false);
    const [previewPdfUrl, setPreviewPdfUrl] = useState(null);
    const [selectedPhotos, setSelectedPhotos] = useState([]);
    const [downloadingZip, setDownloadingZip] = useState(false);
    const [downloadingIndividual, setDownloadingIndividual] = useState(null);
    const [showMoveSectionDialog, setShowMoveSectionDialog] = useState(false);
    const [moveSectionTarget, setMoveSectionTarget] = useState('');
    const [showBulkEditDialog, setShowBulkEditDialog] = useState(false);
    const [bulkCaption, setBulkCaption] = useState('');
    const [showSignatureDialog, setShowSignatureDialog] = useState(false);
    const [inspectorSignature, setInspectorSignature] = useState('');
    const language = getStoredLanguage();
    const t = {
        ...getTranslations(language).common,
        ...getTranslations(language).inspections
    };
    const handleLanguageChange = (lang) => { 
        setStoredLanguage(lang); 
        window.location.reload(); 
    };
    const [scopeOfWork, setScopeOfWork] = useState('');
    const [generatingSow, setGeneratingSow] = useState(false);
    const [sowAutoSaved, setSowAutoSaved] = useState(false);
    const [isRecordingSow, setIsRecordingSow] = useState(false);
    const [uploadingFiles, setUploadingFiles] = useState(false);
    const [guidedModeActive, setGuidedModeActive] = useState(false);
    const [showPostGuidedAlert, setShowPostGuidedAlert] = useState(false);
    const [skipAiAnalysis, setSkipAiAnalysis] = useState(true);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [isSendingReport, setIsSendingReport] = useState(false);
    const [reportRecipients, setReportRecipients] = useState({
        sendToClient: true,
        sendToAdjuster: false,
        adjusterEmail: '',
        sendToProductionManager: false,
        sendToSalesRep: false,
        sendToCustomEmails: false,
        customEmails: ''
    });
    const [showLinkEstimateDialog, setShowLinkEstimateDialog] = useState(false);
    const [selectedEstimateId, setSelectedEstimateId] = useState(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [showTemplateDialog, setShowTemplateDialog] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState('default');
    const [testingEmail, setTestingEmail] = useState(false);
    const [showLinkStormDialog, setShowLinkStormDialog] = useState(false);
    const [isReanalyzing, setIsReanalyzing] = useState(false);
    const [reanalyzingPhotoId, setReanalyzingPhotoId] = useState(null);
    const [showPhotoDetailDialog, setShowPhotoDetailDialog] = useState(false);
    const [editingPhoto, setEditingPhoto] = useState(null);
    const [showMeasureTool, setShowMeasureTool] = useState(false);
    const [measureTargetPhoto, setMeasureTargetPhoto] = useState(null);
    const [editFormData, setEditFormData] = useState({
        caption: '',
        hail_hits_counted: 0,
        wind_marks_counted: 0,
        missing_shingles_counted: 0,
        severity: 'none',
        ai_notes: ''
    });
    const [showSharePhotosDialog, setShowSharePhotosDialog] = useState(false);
    const [shareEmail, setShareEmail] = useState('');
    const [isSharingPhotos, setIsSharingPhotos] = useState(false);
    const [roofAccessories, setRoofAccessories] = useState({ vents: 0, pipe_boots: 0, chimneys: 0, drip_edge: false, ice_guard: false });
    const [accessoriesAutoSaved, setAccessoriesAutoSaved] = useState(false);
    const [newsCardExpanded, setNewsCardExpanded] = useState(false);
    const [uploadingNewsSlot, setUploadingNewsSlot] = useState(null);

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
                setReportRecipients(prev => ({ ...prev, sendToClient: false }));
            }
            if (job.related_estimate_id) {
                setSelectedEstimateId(job.related_estimate_id);
            }
            if (job.scope_of_work) {
                setScopeOfWork(job.scope_of_work);
            }
            if (job.roof_accessories) {
                try {
                    const parsed = typeof job.roof_accessories === 'string' ? JSON.parse(job.roof_accessories) : job.roof_accessories;
                    setRoofAccessories(prev => accessoriesDebounceRef.current ? prev : { ...prev, ...parsed });
                } catch (e) {
                    console.warn('[InspectionCapture] Failed to parse roof_accessories:', e);
                }
            }
        }
    }, [job]);

    const { data: users = [] } = useQuery({
        queryKey: ['users'],
        queryFn: () => base44.entities.User.list(),
        initialData: []
    });

    const { data: media = [], isLoading: isLoadingMedia } = useQuery({
        queryKey: ['inspectionMedia', jobId],
        queryFn: () => jobId ? base44.entities.JobMedia.filter({ related_entity_id: jobId, related_entity_type: 'InspectionJob' }) : [],
        enabled: !!jobId,
        initialData: []
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
        initialData: []
    });

    const { data: linkedEstimate } = useQuery({
        queryKey: ['linkedEstimate', job?.related_estimate_id],
        queryFn: () => job?.related_estimate_id ? base44.entities.Estimate.get(job.related_estimate_id) : null,
        enabled: !!job?.related_estimate_id,
    });

    const { data: linkedStorm } = useQuery({
        queryKey: ['linkedStorm', job?.related_storm_event_id],
        queryFn: () => job?.related_storm_event_id ? base44.entities.StormEvent.get(job.related_storm_event_id) : null,
        enabled: !!job?.related_storm_event_id,
    });

    const { data: reportTemplates = [] } = useQuery({
        queryKey: ['report-templates', myCompany?.id],
        queryFn: () => myCompany ? base44.entities.InspectionReportTemplate.filter({ is_active: true, company_id: myCompany.id }) : [],
        enabled: !!myCompany,
        initialData: []
    });

    const { data: emailTracking = [] } = useQuery({
        queryKey: ['email-tracking', jobId],
        queryFn: () => jobId ? base44.entities.EmailTracking.filter({
            related_entity_id: jobId,
            related_entity_type: 'InspectionJob'
        }) : [],
        enabled: !!jobId,
        initialData: [],
        refetchInterval: 30000,
        staleTime: 10000
    });

    const createJobMutation = useMutation({
        mutationFn: (newJobData) => base44.entities.InspectionJob.create({
            ...newJobData,
            company_id: myCompany?.id
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
        }
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

    const updateAccessoriesMutation = useMutation({
        mutationFn: ({ id, accessories }) => base44.entities.InspectionJob.update(id, { roof_accessories: JSON.stringify(accessories) }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
            setAccessoriesAutoSaved(true);
            setTimeout(() => setAccessoriesAutoSaved(false), 2000);
        }
    });

    const accessoriesDebounceRef = useRef(null);
    const roofAccessoriesRef = useRef(roofAccessories);
    useEffect(() => { roofAccessoriesRef.current = roofAccessories; }, [roofAccessories]);

    const handleAccessoryChange = (field, value) => {
        setRoofAccessories(prev => {
            const next = { ...prev, [field]: value };
            roofAccessoriesRef.current = next;
            if (jobId) {
                clearTimeout(accessoriesDebounceRef.current);
                accessoriesDebounceRef.current = setTimeout(() => {
                    updateAccessoriesMutation.mutate({ id: jobId, accessories: roofAccessoriesRef.current });
                }, 800);
            }
            return next;
        });
    };

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
            section,
            caption,
            uploaded_by_name: user?.full_name || 'User',
            company_id: myCompany?.id
          });

          // Auto-trigger AI analysis for photos only (unless skipped)
          if (file_type === 'photo' && !skipAI) {
            try {
              console.log('Auto-analyzing photo with two-pass AI...');
              const analysisResult = await base44.functions.invoke('analyzeCrewCamPhoto', {
                photoUrl: file_url,
                section: section
              });

              if (analysisResult.data.success) {
                const analysisData = analysisResult.data.analysis;
                let annotatedUrl = null;

                if (analysisData.detections && analysisData.detections.length > 0) {
                  try {
                    console.log(`Drawing ${analysisData.detections.length} chalk annotations...`);
                    const annotatedBlob = await annotateImage(file_url, analysisData.detections);
                    const fileName = `annotated_crewcam_${Date.now()}.jpg`;
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
                  ...(annotatedUrl ? { annotated_url: annotatedUrl } : {})
                });
                console.log('AI analysis complete:', analysisData.severity, 
                  `${analysisData.hail_hits_counted || 0} hail, ${analysisData.wind_marks_counted || 0} wind, ${analysisData.detections?.length || 0} annotations`);
              }
            } catch (aiError) {
              console.error('AI analysis failed (non-critical):', aiError);
            }
          }

          return media;
        },
        onSuccess: (data, variables) => {
          queryClient.invalidateQueries({ queryKey: ['inspectionMedia', variables.targetJobId] });
        }
    });

    const updateMediaMutation = useMutation({
        mutationFn: ({ id, ...updates }) => base44.entities.JobMedia.update(id, updates),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] });
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
            uploadedMedia = await uploadMutation.mutateAsync({ file, section: activeSection, caption, targetJobId: currentJobId });
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

    const handleFileUpload = async (event) => {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;

        setUploadingFiles(true);

        await handleUploadWithJobCreation(async (currentJobId) => {
            try {
                const sectionCounts = {};
                for (const file of files) {
                    const detectedSection = detectSectionFromFilename(file.name) || activeSection;
                    sectionCounts[detectedSection] = (sectionCounts[detectedSection] || 0) + 1;
                    await uploadMutation.mutateAsync({
                        file,
                        section: detectedSection,
                        caption: file.name || 'Uploaded photo',
                        targetJobId: currentJobId,
                        skipAI: skipAiAnalysis
                    });
                }
                const sectionSummary = Object.entries(sectionCounts)
                    .map(([s, n]) => `${n} → ${s}`)
                    .join(', ');
                alert(`✅ ${files.length} file(s) uploaded:\n${sectionSummary}${skipAiAnalysis ? '\n⚡ AI analysis skipped' : ''}`);
            } catch (error) {
                console.error("Upload error:", error);
                alert("❌ Upload failed: " + (error.message || "Unknown error"));
            }
        });

        setUploadingFiles(false);
        event.target.value = '';
    };

    const handleNewsSlotUpload = async (section, files) => {
        if (!files || files.length === 0) return;
        setUploadingNewsSlot(section);
        await handleUploadWithJobCreation(async (currentJobId) => {
            for (const file of Array.from(files)) {
                await uploadMutation.mutateAsync({
                    file,
                    section,
                    caption: file.name || section,
                    targetJobId: currentJobId,
                    skipAI: false,
                });
            }
        });
        setUploadingNewsSlot(null);
    };

    const handleOpenPhotoDetail = (item) => {
        const aiData = item.ai_damage_analysis || {};
        setEditingPhoto(item);
        setEditFormData({
            caption: item.caption || '',
            hail_hits_counted: aiData.hail_hits_counted || 0,
            wind_marks_counted: aiData.wind_marks_counted || 0,
            missing_shingles_counted: aiData.missing_shingles_counted || 0,
            severity: aiData.severity || 'none',
            ai_notes: aiData.ai_notes || ''
        });
        setShowPhotoDetailDialog(true);
    };

    const handleSavePhotoDetail = async () => {
        if (!editingPhoto) return;
        const existingAI = editingPhoto.ai_damage_analysis || {};
        const updatedAI = {
            ...existingAI,
            hail_hits_counted: parseInt(editFormData.hail_hits_counted) || 0,
            wind_marks_counted: parseInt(editFormData.wind_marks_counted) || 0,
            missing_shingles_counted: parseInt(editFormData.missing_shingles_counted) || 0,
            severity: editFormData.severity,
            ai_notes: editFormData.ai_notes,
            manually_edited: true,
            edited_at: new Date().toISOString()
        };

        const totalDamage = updatedAI.hail_hits_counted + updatedAI.wind_marks_counted + updatedAI.missing_shingles_counted;
        if (totalDamage > 0 && updatedAI.severity === 'none') {
            updatedAI.severity = totalDamage <= 3 ? 'minor' : totalDamage <= 10 ? 'moderate' : 'severe';
        }

        await base44.entities.JobMedia.update(editingPhoto.id, {
            caption: editFormData.caption,
            ai_damage_analysis: updatedAI
        });
        queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] });
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
            htmlBody += `<p><strong>Client:</strong> ${job?.client_name || 'N/A'}</p>`;
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

            htmlBody += `<hr><p style="font-size:11px;color:#666;">Sent from CompanySync CrewCam</p>`;

            await base44.integrations.Core.SendEmail({
                to: shareEmail,
                subject: `Inspection Photos - ${job?.property_address || 'Property'} - ${new Date().toLocaleDateString()}`,
                html: htmlBody
            });

            alert('Photos shared successfully!');
            setShowSharePhotosDialog(false);
            setShareEmail('');
        } catch (error) {
            console.error('Share photos failed:', error);
            alert('Failed to share photos: ' + (error.message || 'Unknown error'));
        } finally {
            setIsSharingPhotos(false);
        }
    };

    const handleReanalyzePhoto = async (item, silent = false) => {
        if (reanalyzingPhotoId) return;
        setReanalyzingPhotoId(item.id);
        try {
            const fileUrl = item.file_url;
            console.log('Re-analyzing photo with two-pass AI...', item.id);
            const analysisResult = await base44.functions.invoke('analyzeCrewCamPhoto', {
                photoUrl: fileUrl,
                section: item.section || 'Other'
            });

            if (analysisResult.data.success) {
                const analysisData = analysisResult.data.analysis;
                let annotatedUrl = null;

                if (analysisData.detections && analysisData.detections.length > 0) {
                    try {
                        console.log(`Drawing ${analysisData.detections.length} chalk annotations...`);
                        const annotatedBlob = await annotateImage(fileUrl, analysisData.detections);
                        const fileName = `annotated_crewcam_${Date.now()}.jpg`;
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
                    ...(annotatedUrl ? { annotated_url: annotatedUrl } : {})
                });

                queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] });
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
            queryClient.invalidateQueries({ queryKey: ['inspectionMedia', jobId] });
        } catch (error) {
            console.error('Clear AI failed:', error);
            alert('Failed to clear AI analysis: ' + (error.message || 'Unknown error'));
        }
    };

    const handleSaveNotes = () => {
        if (!jobId) {
            alert("Please create the inspection job first before saving notes.");
            return;
        }
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        updateJobNotesMutation.mutate({ id: jobId, notes: sectionNotes, showAlert: true });
    };

    const handleSaveSow = async (text) => {
        if (!jobId) return;
        const value = text !== undefined ? text : scopeOfWork;
        await base44.entities.InspectionJob.update(jobId, { scope_of_work: value });
        setSowAutoSaved(true);
        setTimeout(() => setSowAutoSaved(false), 2000);
    };

    const handleGenerateSow = async () => {
        if (!media || media.length === 0) {
            alert('Take some photos first — the AI will use the damage analysis to write the scope.');
            return;
        }
        setGeneratingSow(true);
        try {
            const analyzedPhotos = media.filter(m => m.ai_damage_analysis);
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

            const allSectionNotes = Object.entries(sectionNotes).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n');
            const propertyInfo = `Property: ${job?.property_address || 'Unknown'} | Client: ${job?.client_name || 'Unknown'} | Claim #: ${job?.insurance_claim_number || 'N/A'}`;

            const result = await base44.functions.invoke('InvokeLLM', {
                prompt: `You are a professional roofing inspector writing a Scope of Work for an insurance claim or repair estimate.

Property Info:
${propertyInfo}

AI Damage Analysis from ${analyzedPhotos.length} photos:
${photoSummaries || 'No AI analysis available — use section notes below.'}

Inspector Section Notes:
${allSectionNotes || 'None'}

Write a clear, professional Scope of Work document that:
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

    const handleDictateSow = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('Voice dictation is not supported in this browser. Try Chrome on Android or desktop.');
            return;
        }
        if (isRecordingSow) return;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        setIsRecordingSow(true);
        recognition.onresult = (e) => {
            const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ');
            setScopeOfWork(prev => (prev ? prev + '\n' + transcript : transcript));
        };
        recognition.onerror = () => setIsRecordingSow(false);
        recognition.onend = () => setIsRecordingSow(false);
        recognition.start();
        setTimeout(() => { try { recognition.stop(); } catch(e) {} }, 30000);
    };

    const autoSaveTimerRef = useRef(null);
    const sectionNotesRef = useRef(sectionNotes);
    const jobIdRef = useRef(jobId);
    const isSavingRef = useRef(false);

    useEffect(() => { sectionNotesRef.current = sectionNotes; }, [sectionNotes]);
    useEffect(() => { jobIdRef.current = jobId; }, [jobId]);

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
            const resp = await fetch(fetchUrl, options);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            if (blob.size === 0) throw new Error('Empty blob');
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('FileReader failed'));
                reader.readAsDataURL(blob);
            });
        };

        const tryCanvas = async (imgUrl, useCors) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                if (useCors) img.crossOrigin = 'anonymous';
                img.onload = () => {
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
                img.onerror = () => reject(new Error('Image element failed to load'));
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
                const coverLogoH = await loadLogoForPdf(myCompany.logo_url, doc, 18, y, 60, 25);
                if (coverLogoH > 0) y += coverLogoH + 5;
            }
            
            // Company info - LARGER AND MORE PROMINENT
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(String(myCompany?.company_name || t.companyName), margin, y);
            y += 8;
            
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(60, 60, 60);
            
            if (myCompany?.address) {
                doc.text(String(myCompany.address), margin, y);
                y += 5;
            }
            
            if (myCompany?.city || myCompany?.state || myCompany?.zip) {
                const cityStateZip = [myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', ');
                doc.text(String(cityStateZip), margin, y);
                y += 5;
            }
            
            if (myCompany?.phone) {
                doc.text(String(t.phone + ": " + myCompany.phone), margin, y);
                y += 5;
            }
            
            if (myCompany?.email) {
                doc.text(String(t.email + ": " + myCompany.email), margin, y);
                y += 5;
            }
            
            if (myCompany?.company_website) {
                doc.text(String(t.web + ": " + myCompany.company_website), margin, y);
                y += 5;
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
            doc.rect(margin, y, contentWidth, 50, 'F');
            
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
            doc.text(String(t.clientName + ": " + (job.client_name || t.na)), margin + 5, y);
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
            }

            // Group images by section
            const imagesBySection = {};
            photoMedia.forEach(item => {
                const section = item.section || 'Other';
                if (!imagesBySection[section]) {
                    imagesBySection[section] = [];
                }
                imagesBySection[section].push(item);
            });

            // Add sections with photos - 2-column grid layout
            const COLS = 2;
            const colGap = 5;
            const gridImgW = (contentWidth - colGap * (COLS - 1)) / COLS;
            const gridImgH = Math.round(gridImgW * 0.72);
            const captionLineH = 4.5;
            const rowSpacing = 7;

            for (const [section, images] of Object.entries(imagesBySection)) {
                doc.addPage();
                
                // Section header with branded bar
                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.rect(0, 10, pageWidth, 12, 'F');
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(255, 255, 255);
                doc.text(String(section), pageWidth / 2, 18, { align: 'center' });
                
                let yPos = 30;
                
                // Section notes — larger font for readability
                if (sectionNotes && sectionNotes[section]) {
                    doc.setFontSize(11);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(60, 60, 60);
                    const lines = doc.splitTextToSize(sectionNotes[section], contentWidth);
                    doc.text(String(lines), margin, yPos);
                    yPos += (lines.length * 5.5) + 10;
                }

                // Process images 2 per row
                for (let i = 0; i < images.length; i += COLS) {
                    const rowItems = images.slice(i, i + COLS);
                    const rowH = gridImgH + captionLineH * 2 + rowSpacing;
                    
                    if (yPos + rowH > pageHeight - 20) {
                        doc.addPage();
                        doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                        doc.rect(0, 10, pageWidth, 12, 'F');
                        doc.setFontSize(14);
                        doc.setFont('helvetica', 'bold');
                        doc.setTextColor(255, 255, 255);
                        doc.text(`${section} ${t.continued}`, pageWidth / 2, 18, { align: 'center' });
                        yPos = 30;
                    }

                    let maxCaptionH = captionLineH;

                    for (let col = 0; col < rowItems.length; col++) {
                        const item = rowItems[col];
                        const xPos = margin + col * (gridImgW + colGap);
                        try {
                            const imageDataUrl = await loadImageAsDataUrl(item.file_url, `photo: ${item.section || 'unknown'}/${item.caption || 'untitled'}`);
                            doc.setDrawColor(220, 220, 220);
                            doc.setLineWidth(0.3);
                            doc.rect(xPos, yPos, gridImgW, gridImgH);
                            if (imageDataUrl) {
                                doc.addImage(imageDataUrl, 'JPEG', xPos + 0.5, yPos + 0.5, gridImgW - 1, gridImgH - 1);
                            } else {
                                addPlaceholderToDoc(doc, xPos, yPos, gridImgW, gridImgH);
                            }
                            // Numbered badge
                            const photoNum = i + col + 1;
                            doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                            doc.rect(xPos + 1.5, yPos + 1.5, 10, 6, 'F');
                            doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                            doc.text(String(photoNum), xPos + 6.5, yPos + 5.8, { align: 'center' });
                            doc.setTextColor(0);
                            // Caption
                            if (item.caption) {
                                doc.setFontSize(9);
                                doc.setFont('helvetica', 'normal');
                                doc.setTextColor(50, 50, 50);
                                const captionLines = doc.splitTextToSize(item.caption, gridImgW);
                                const linesToShow = captionLines.slice(0, 3);
                                doc.text(linesToShow, xPos, yPos + gridImgH + 4);
                                maxCaptionH = Math.max(maxCaptionH, linesToShow.length * captionLineH);
                                doc.setTextColor(0);
                            }
                        } catch (error) {
                            console.error(`❌ Error adding image:`, error);
                            addPlaceholderToDoc(doc, xPos, yPos, gridImgW, gridImgH);
                        }
                    }

                    yPos += gridImgH + maxCaptionH + rowSpacing;
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
                doc.text(String(job?.client_name || linkedEstimate.customer_name || 'N/A'), margin + 4, cY); cY += 4;
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

            doc.save(`CrewCam_${job?.property_address?.replace(/[^a-zA-Z0-9]/g, '_') || 'Report'}_${Date.now()}.pdf`);
            
            alert(`✅ PDF exported with ${photoMedia.length} photos!`);

        } catch (error) {
            console.error("❌ PDF Export Error:", error);
            alert(`❌ Failed to export PDF: ${error.message}`);
        }

        setIsExporting(false);
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
                const coverLogoH = await loadLogoForPdf(myCompany.logo_url, doc, 18, y, 60, 25);
                if (coverLogoH > 0) y += coverLogoH + 5;
            }
            
            // Company info - LARGER AND MORE PROMINENT
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(String(myCompany?.company_name || t.companyName), margin, y);
            y += 8;
            
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(60, 60, 60);
            
            if (myCompany?.address) {
                doc.text(String(myCompany.address), margin, y);
                y += 5;
            }
            
            if (myCompany?.city || myCompany?.state || myCompany?.zip) {
                const cityStateZip = [myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', ');
                doc.text(String(cityStateZip), margin, y);
                y += 5;
            }
            
            if (myCompany?.phone) {
                doc.text(String(t.phone + ": " + myCompany.phone), margin, y);
                y += 5;
            }
            
            if (myCompany?.email) {
                doc.text(String(t.email + ": " + myCompany.email), margin, y);
                y += 5;
            }
            
            if (myCompany?.company_website) {
                doc.text(String(t.web + ": " + myCompany.company_website), margin, y);
                y += 5;
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
            doc.rect(margin, y, contentWidth, 50, 'F');
            
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
            doc.text(String(t.clientName + ": " + (job.client_name || t.na)), margin + 5, y);
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
            }

            // Group images by section
            const imagesBySection = {};
            photoMedia.forEach(item => {
                const section = item.section || 'Other';
                if (!imagesBySection[section]) {
                    imagesBySection[section] = [];
                }
                imagesBySection[section].push(item);
            });

            // Add sections with photos - 2-column grid layout
            const COLS = 2;
            const colGap = 5;
            const gridImgW = (contentWidth - colGap * (COLS - 1)) / COLS;
            const gridImgH = Math.round(gridImgW * 0.72);
            const captionLineH = 4.5;
            const rowSpacing = 7;

            for (const [section, images] of Object.entries(imagesBySection)) {
                doc.addPage();
                
                // Section header with branded bar
                doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                doc.rect(0, 10, pageWidth, 12, 'F');
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(255, 255, 255);
                doc.text(String(section), pageWidth / 2, 18, { align: 'center' });
                
                let yPos = 30;
                
                // Section notes — larger font for readability
                if (sectionNotes && sectionNotes[section]) {
                    doc.setFontSize(11);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(60, 60, 60);
                    const lines = doc.splitTextToSize(sectionNotes[section], contentWidth);
                    doc.text(String(lines), margin, yPos);
                    yPos += (lines.length * 5.5) + 10;
                }

                // Process images 2 per row
                for (let i = 0; i < images.length; i += COLS) {
                    const rowItems = images.slice(i, i + COLS);
                    const rowH = gridImgH + captionLineH * 2 + rowSpacing;
                    
                    if (yPos + rowH > pageHeight - 20) {
                        doc.addPage();
                        doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                        doc.rect(0, 10, pageWidth, 12, 'F');
                        doc.setFontSize(14);
                        doc.setFont('helvetica', 'bold');
                        doc.setTextColor(255, 255, 255);
                        doc.text(`${section} ${t.continued}`, pageWidth / 2, 18, { align: 'center' });
                        yPos = 30;
                    }

                    let maxCaptionH = captionLineH;

                    for (let col = 0; col < rowItems.length; col++) {
                        const item = rowItems[col];
                        const xPos = margin + col * (gridImgW + colGap);
                        try {
                            const imageDataUrl = await loadImageAsDataUrl(item.file_url, `photo: ${item.section || 'unknown'}/${item.caption || 'untitled'}`);
                            doc.setDrawColor(220, 220, 220);
                            doc.setLineWidth(0.3);
                            doc.rect(xPos, yPos, gridImgW, gridImgH);
                            if (imageDataUrl) {
                                doc.addImage(imageDataUrl, 'JPEG', xPos + 0.5, yPos + 0.5, gridImgW - 1, gridImgH - 1);
                            } else {
                                addPlaceholderToDoc(doc, xPos, yPos, gridImgW, gridImgH);
                            }
                            // Numbered badge
                            const photoNum = i + col + 1;
                            doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                            doc.rect(xPos + 1.5, yPos + 1.5, 10, 6, 'F');
                            doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                            doc.text(String(photoNum), xPos + 6.5, yPos + 5.8, { align: 'center' });
                            doc.setTextColor(0);
                            // Caption
                            if (item.caption) {
                                doc.setFontSize(9);
                                doc.setFont('helvetica', 'normal');
                                doc.setTextColor(50, 50, 50);
                                const captionLines = doc.splitTextToSize(item.caption, gridImgW);
                                const linesToShow = captionLines.slice(0, 3);
                                doc.text(linesToShow, xPos, yPos + gridImgH + 4);
                                maxCaptionH = Math.max(maxCaptionH, linesToShow.length * captionLineH);
                                doc.setTextColor(0);
                            }
                        } catch (error) {
                            console.error(`❌ Error adding image:`, error);
                            addPlaceholderToDoc(doc, xPos, yPos, gridImgW, gridImgH);
                        }
                    }

                    yPos += gridImgH + maxCaptionH + rowSpacing;
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
                doc.text(String(job?.client_name || linkedEstimate.customer_name || 'N/A'), margin + 4, cY); cY += 4;
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
    };

    const handlePreviewFullReport = async () => {
        // Preview opens in new tab, download saves file
        await handleViewPDF();
    };

    const handleTestEmailSend = async () => {
    if (!jobId) {
      alert("Please save the inspection first.");
      return;
    }

    setTestingEmail(true);

    try {
      console.log('🧪 TEST: Calling sendInspectionReport...');
      
      // Temporarily override client email for testing
      await base44.entities.InspectionJob.update(jobId, {
        client_email: 'stonekevin866@gmail.com'
      });
      
      const response = await base44.functions.invoke('sendInspectionReport', {
        inspectionJobId: jobId,
        sendToClient: true,
        sendToAdjuster: false,
        adjusterEmail: null,
        templateId: null
      });

      console.log('🧪 TEST: Full response:', response);
      
      if (response.data) {
        alert(`✅ TEST RESULT:\n\nSuccess: ${response.data.success}\nClient Sent: ${response.data.client_sent}\nClient Error: ${response.data.client_error || 'None'}\n\nCheck console for full details.`);
      } else {
        alert(`❌ TEST FAILED:\n\nNo data in response\n\nCheck console for details.`);
      }
    } catch (error) {
      console.error('🧪 TEST ERROR:', error);
      alert(`❌ TEST ERROR:\n\n${error.message || 'Unknown error'}\n\nCheck console for stack trace.`);
    }

    setTestingEmail(false);
  };

  const handleGenerateAndSendReport = async () => {
      if (!jobId) {
          alert("Please save the inspection first.");
          return;
      }

      setIsSendingReport(true);

      try {
          console.log('📄 Generating PDF in frontend...');

          // Generate PDF using same logic as handleViewPDF
          const photoMedia = media.filter(m => m.file_type === 'photo');

          if (photoMedia.length === 0) {
              alert("⚠️ No photos found.");
              setIsSendingReport(false);
              return;
          }

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
              const coverLogoH3 = await loadLogoForPdf(myCompany.logo_url, doc, 18, y, 60, 25);
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
          doc.rect(margin, y, contentWidth, 50, 'F');
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);
          doc.text(t.propertyInformation, margin + 5, y + 8);
          y += 15;
          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(60, 60, 60);
          doc.text(`${t.propertyAddress}: ${job.property_address || t.na}`, margin + 5, y); y += 5;
          doc.text(`${t.clientName}: ${job.client_name || t.na}`, margin + 5, y); y += 5;
          if (job.client_email) { doc.text(`${t.clientEmail}: ${job.client_email}`, margin + 5, y); y += 5; }
          if (job.client_phone) { doc.text(`${t.clientPhone}: ${job.client_phone}`, margin + 5, y); y += 5; }
          doc.text(`${t.inspectionDate}: ${new Date(job.inspection_date || job.created_date).toLocaleDateString(t.dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })}`, margin + 5, y); y += 5;
          if (job.insurance_claim_number) { doc.text(`${t.claimNumber}: ${job.insurance_claim_number}`, margin + 5, y); y += 5; }
          if (job.insurance_company) { doc.text(`${t.insuranceCompany}: ${job.insurance_company}`, margin + 5, y); }

          const imagesBySection = {};
          photoMedia.forEach(item => {
              const section = item.section || 'Other';
              if (!imagesBySection[section]) imagesBySection[section] = [];
              imagesBySection[section].push(item);
          });

          // 2-column grid layout for photos
          const COLS3 = 2;
          const colGap3 = 5;
          const gridImgW3 = (contentWidth - colGap3 * (COLS3 - 1)) / COLS3;
          const gridImgH3 = Math.round(gridImgW3 * 0.72);
          const captionLineH3 = 4.5;
          const rowSpacing3 = 7;

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
                  doc.setFontSize(11);
                  doc.setFont('helvetica', 'normal');
                  doc.setTextColor(60, 60, 60);
                  const lines = doc.splitTextToSize(sectionNotes[section], contentWidth);
                  doc.text(lines, margin, yPos);
                  yPos += (lines.length * 5.5) + 10;
              }
              for (let i = 0; i < images.length; i += COLS3) {
                  const rowItems = images.slice(i, i + COLS3);
                  const rowH = gridImgH3 + captionLineH3 * 2 + rowSpacing3;
                  if (yPos + rowH > pageHeight - 20) {
                      doc.addPage();
                      doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                      doc.rect(0, 10, pageWidth, 12, 'F');
                      doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                      doc.text(`${section} ${t.continued}`, pageWidth / 2, 18, { align: 'center' });
                      yPos = 30;
                  }
                  let maxCaptionH3 = captionLineH3;
                  for (let col = 0; col < rowItems.length; col++) {
                      const item = rowItems[col];
                      const xPos = margin + col * (gridImgW3 + colGap3);
                      try {
                          const imageDataUrl = await loadImageAsDataUrl(item.file_url, `photo: ${item.section || 'unknown'}/${item.caption || 'untitled'}`);
                          doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3);
                          doc.rect(xPos, yPos, gridImgW3, gridImgH3);
                          if (imageDataUrl) {
                              doc.addImage(imageDataUrl, 'JPEG', xPos + 0.5, yPos + 0.5, gridImgW3 - 1, gridImgH3 - 1);
                          } else {
                              addPlaceholderToDoc(doc, xPos, yPos, gridImgW3, gridImgH3);
                          }
                          const photoNum3 = i + col + 1;
                          doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
                          doc.rect(xPos + 1.5, yPos + 1.5, 10, 6, 'F');
                          doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
                          doc.text(String(photoNum3), xPos + 6.5, yPos + 5.8, { align: 'center' });
                          doc.setTextColor(0);
                          if (item.caption) {
                              doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50);
                              const captionLines = doc.splitTextToSize(item.caption, gridImgW3);
                              const linesToShow = captionLines.slice(0, 3);
                              doc.text(linesToShow, xPos, yPos + gridImgH3 + 4);
                              maxCaptionH3 = Math.max(maxCaptionH3, linesToShow.length * captionLineH3);
                              doc.setTextColor(0);
                          }
                      } catch (error) {
                          console.error(`❌ Error adding image:`, error);
                          addPlaceholderToDoc(doc, xPos, yPos, gridImgW3, gridImgH3);
                      }
                  }
                  yPos += gridImgH3 + maxCaptionH3 + rowSpacing3;
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
            doc.text(String(job?.client_name || linkedEstimate.customer_name || 'N/A'), margin + 4, cY3); cY3 += 4;
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

          // Convert PDF to base64
          const pdfBase64 = doc.output('dataurlstring').split(',')[1];
          console.log('✅ PDF generated, sending to backend for email...');

          const response = await base44.functions.invoke('sendInspectionReport', {
              inspectionJobId: jobId,
              sendToClient: reportRecipients.sendToClient,
              sendToAdjuster: reportRecipients.sendToAdjuster,
              adjusterEmail: reportRecipients.adjusterEmail,
              sendToProductionManager: reportRecipients.sendToProductionManager,
              sendToSalesRep: reportRecipients.sendToSalesRep,
              sendToCustomEmails: reportRecipients.sendToCustomEmails,
              customEmails: reportRecipients.customEmails,
              pdfBase64: pdfBase64
          });

          if (response.data.success) {
              const messages = ['✅ Report sent successfully!'];
              if (response.data.client_sent) messages.push('📧 Sent to client');
              if (response.data.adjuster_sent) messages.push('📧 Sent to adjuster');
              if (response.data.production_manager_sent) messages.push('📧 Sent to production manager');
              if (response.data.sales_rep_sent) messages.push('📧 Sent to sales rep');
              if (response.data.custom_sent) messages.push(`📧 Sent to ${response.data.custom_count} team member(s)`);
              
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
                                  title: '📄 Inspection Report Sent',
                                  message: `${user?.full_name || user?.email} sent inspection report for ${job.client_name || job.property_address}`,
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
                              title: '📄 Your Inspection Report Was Sent',
                              message: `Report for ${job.client_name || job.property_address} was sent by ${user?.full_name || user?.email}`,
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
              
              alert(messages.join('\n'));
              setShowTemplateDialog(false);
              queryClient.invalidateQueries({ queryKey: ['email-tracking', jobId] });
          } else {
              throw new Error(response.data.error || 'Failed to send report');
          }
      } catch (error) {
          console.error("Report generation error:", error);
          alert(`❌ Failed to send report: ${error.message}`);
      }

      setIsSendingReport(false);
  };

    const handlePhotoSelect = (photoId) => {
        setSelectedPhotos(prev => {
            if (prev.includes(photoId)) {
                return prev.filter(id => id !== photoId);
            } else {
                return [...prev, photoId];
            }
        });
    };

    const handleSelectAll = () => {
        if (selectedPhotos.length === activeSectionMedia.length) {
            setSelectedPhotos([]);
        } else {
            setSelectedPhotos(activeSectionMedia.map(m => m.id));
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

    const handleBulkDelete = () => {
        if (selectedPhotos.length === 0) return;
        if (window.confirm(`Delete ${selectedPhotos.length} selected photos?`)) {
            selectedPhotos.forEach(photoId => {
                deleteMutation.mutate(photoId);
            });
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
        e.customer_name?.toLowerCase().includes(job?.client_name?.toLowerCase() || '') ||
        e.property_address?.toLowerCase().includes(job?.property_address?.toLowerCase() || '')
    );

    const activeSectionMedia = jobId 
        ? (activeSection === 'All Photos' 
            ? media 
            : media.filter(m => m.section === activeSection))
        : [];

    const mostRecentTracking = emailTracking.length > 0
        ? emailTracking.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))[0]
        : null;

    if (isLoadingJob && jobId) {
        return <div className="p-6 text-center"><Loader2 className="animate-spin" /></div>;
    }

    // 🔐 Access guard: non-admins without global view can only view inspections assigned to them
    if (isPermissionsReady && job && !isLoadingJob && effectiveUserEmail && !isAdmin && !hasPermission('inspections', 'view_global')) {
        const hasAccess = job.assigned_to_email === effectiveUserEmail ||
            job.assigned_inspectors?.includes(effectiveUserEmail) ||
            job.created_by === effectiveUserEmail ||
            job.inspector_email === effectiveUserEmail;
        if (!hasAccess) {
            return (
                <div className="p-6">
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
                            <h1 className="text-lg md:text-xl font-bold text-gray-900">{t.inspectionReport || 'CrewCam Photo Capture'}</h1>
                            {job && (
                                <div className="mt-1">
                                    <p className="text-sm font-semibold text-blue-600">{job.client_name}</p>
                                    <p className="text-xs text-gray-600">{job.property_address}</p>
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
                            <span className="hidden md:inline">{t.edit || 'Edit Job'}</span>
                        </Button>

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
                            disabled={!job || media.filter(m => m.file_type === 'photo').length === 0 || isViewing}
                            variant="outline"
                            className="gap-2 border-green-500 text-green-700 hover:bg-green-50"
                        >
                            {isViewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4" />}
                            <span className="hidden md:inline">{t.viewPdf || 'View PDF'}</span>
                        </Button>
                        <Button
                            onClick={handleExportReport}
                            disabled={!job || media.filter(m => m.file_type === 'photo').length === 0 || isExporting}
                            variant="outline"
                            className="gap-2"
                        >
                            {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4" />}
                            <span className="hidden md:inline">{t.downloadPdf || 'Download PDF'}</span>
                        </Button>
                        <Button
                            onClick={() => setShowTemplateDialog(true)}
                            disabled={isSendingReport || !job || media.filter(m => m.file_type === 'photo').length === 0}
                            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white gap-2"
                        >
                            {isSendingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            <span className="hidden md:inline">{t.sendReport || 'Send Report'}</span>
                        </Button>

                    </div>
                </div>
            </div>

            <div className="p-2 md:p-6 max-w-7xl mx-auto space-y-4">

                {job && (
                    <>
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
                                                        const totalHail = photoMedia.reduce((sum, m) => sum + (m.ai_damage_analysis?.hail_hits_counted || 0), 0);
                                                        const totalWind = photoMedia.reduce((sum, m) => sum + (m.ai_damage_analysis?.wind_marks_counted || 0), 0);
                                                        const avgHail = photoMedia.length > 0 ? Math.round(totalHail / photoMedia.length) : 0;
                                                        const avgWind = photoMedia.length > 0 ? Math.round(totalWind / photoMedia.length) : 0;
                                                        const hasDiscontinued = photoMedia.some(m => m.ai_damage_analysis?.likely_discontinued);

                                                        // Update job with AI summary
                                                        if (totalHail > 0 || totalWind > 0) {
                                                            await base44.entities.InspectionJob.update(jobId, {
                                                                ai_analysis_summary: {
                                                                    total_hail_hits: totalHail,
                                                                    total_wind_marks: totalWind,
                                                                    hail_per_sq: avgHail,
                                                                    wind_per_sq: avgWind,
                                                                    material_matching_flag: hasDiscontinued,
                                                                    overall_severity: totalHail > 10 || totalWind > 5 ? 'severe' : totalHail > 5 || totalWind > 3 ? 'moderate' : 'minor'
                                                                }
                                                            });
                                                        }

                                                        const params = new URLSearchParams({
                                                            customer_name: job.client_name || '',
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
                    onVoiceNote={text => handleSectionNotesChange(activeSection, (sectionNotes[activeSection] || '') + '\n' + text)}
                    onVoiceCaptionForLastPhoto={handleVoiceCaptionForLastPhoto}
                    setActiveSection={setActiveSection}
                    sections={sections}
                    sectionPhotoCount={sectionPhotoCount}
                    onGuidedModeChange={handleGuidedModeChange}
                    jobId={jobId}
                    companyId={myCompany?.id}
                    onMeasurementSaved={(measurements) => {
                        console.log('[ARMeasure] Saved', measurements?.length, 'measurements to job', jobId);
                    }}
                />}

                {/* Guided Mode Banner */}
                {guidedModeActive && (
                    <div className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3 space-y-1.5 shadow-md">
                        <div className="flex items-center gap-2 font-semibold text-sm">
                            <span className="text-base animate-pulse">🎤</span>
                            <span>Guided Inspection Active — say a section to switch, describe damage, say "photo" to snap</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-blue-100">
                            <span>📍 Current:</span>
                            <span className="font-bold text-white">{activeSection}</span>
                        </div>
                        <div className="text-[10px] text-blue-200 leading-relaxed">
                            Sections: front · right · rear · left · slope · siding · gutters · window seals · soft metals · flashing · interior
                        </div>
                    </div>
                )}

                {/* Post-Guided Mode Alert */}
                {showPostGuidedAlert && (
                    <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 flex items-start justify-between gap-3 shadow-sm">
                        <div className="text-sm text-amber-800">
                            <span className="font-semibold">Inspection recorded!</span> Tap <span className="font-semibold">"AI Generate"</span> in the Scope of Work section below to auto-write the full scope from your notes.
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
                                    disabled={uploadingFiles}
                                />
                                <Button
                                    onClick={() => document.getElementById('file-upload-input').click()}
                                    disabled={uploadingFiles}
                                    size="lg"
                                    className="bg-green-600 hover:bg-green-700 text-white font-semibold min-h-[48px]"
                                >
                                    {uploadingFiles ? (
                                        <>
                                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="w-5 h-5 mr-2" />
                                            Choose Files to Upload
                                        </>
                                    )}
                                </Button>
                                <label className="flex items-center gap-2 cursor-pointer select-none" title="Upload photos without AI damage detection — faster for large batches">
                                    <input
                                        type="checkbox"
                                        checked={skipAiAnalysis}
                                        onChange={(e) => setSkipAiAnalysis(e.target.checked)}
                                        className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                                    />
                                    <span className="text-sm text-gray-600 font-medium">⚡ Skip AI Analysis</span>
                                </label>
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-3 text-center">
                            📸 Tip: Photos are auto-sorted by filename (e.g. "front elevation", "rear slope"). Unrecognized names go to <strong>{activeSection}</strong>.
                        </p>
                    </CardContent>
                </Card>

                {/* Roof Accessories Panel */}
                <Card>
                    <CardContent className="p-3 md:p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-semibold text-sm md:text-base">🪛 Roof Accessories</h3>
                            {accessoriesAutoSaved && (
                                <span className="text-xs text-green-600 font-medium animate-pulse">Saved ✓</span>
                            )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            {/* Number inputs */}
                            {[
                                { key: 'vents', label: 'Vents' },
                                { key: 'pipe_boots', label: 'Pipe Boots' },
                                { key: 'chimneys', label: 'Chimneys' },
                            ].map(({ key, label }) => (
                                <div key={key} className="flex flex-col items-center gap-1">
                                    <span className="text-xs text-gray-500 font-medium">{label}</span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            data-testid={`btn-decrement-${key}`}
                                            onClick={() => handleAccessoryChange(key, Math.max(0, (roofAccessories[key] || 0) - 1))}
                                            className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 font-bold text-base leading-none select-none"
                                        >−</button>
                                        <span data-testid={`text-${key}-count`} className="w-8 text-center font-semibold text-sm">{roofAccessories[key] || 0}</span>
                                        <button
                                            data-testid={`btn-increment-${key}`}
                                            onClick={() => handleAccessoryChange(key, (roofAccessories[key] || 0) + 1)}
                                            className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 font-bold text-base leading-none select-none"
                                        >+</button>
                                    </div>
                                </div>
                            ))}
                            {/* Yes/No toggles */}
                            {[
                                { key: 'drip_edge', label: 'Drip Edge' },
                                { key: 'ice_guard', label: 'Ice Guard' },
                            ].map(({ key, label }) => (
                                <div key={key} className="flex flex-col items-center gap-1">
                                    <span className="text-xs text-gray-500 font-medium">{label}</span>
                                    <div className="flex gap-1">
                                        <button
                                            data-testid={`btn-${key}-yes`}
                                            onClick={() => handleAccessoryChange(key, true)}
                                            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${roofAccessories[key] ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                                        >Yes</button>
                                        <button
                                            data-testid={`btn-${key}-no`}
                                            onClick={() => handleAccessoryChange(key, false)}
                                            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${!roofAccessories[key] ? 'bg-gray-200 border-gray-300 text-gray-700' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                                        >No</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* ── N.E.W.S. Elevation Photo Slots ─────────────────────── */}
                <Card>
                    <CardContent className="p-3 md:p-4">
                        <button
                            onClick={() => setNewsCardExpanded(prev => !prev)}
                            className="w-full flex items-center justify-between text-left"
                        >
                            <h3 className="font-semibold text-sm md:text-base flex items-center gap-2">
                                🧭 N.E.W.S. Elevation Photos
                                <span className="text-xs text-gray-500 font-normal">(North · East · West · South)</span>
                                {['Front Elevation','Right Elevation','Rear Elevation','Left Elevation'].reduce((n,s) => n + media.filter(m=>m.section===s).length, 0) > 0 && (
                                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                                        {['Front Elevation','Right Elevation','Rear Elevation','Left Elevation'].reduce((n,s)=>n+media.filter(m=>m.section===s).length,0)} photos
                                    </span>
                                )}
                            </h3>
                            <span className="text-gray-400 text-sm">{newsCardExpanded ? '▲' : '▼'}</span>
                        </button>

                        {newsCardExpanded && (
                            <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
                                {[
                                    { section: 'Front Elevation', compass: 'N', icon: '⬆️', color: 'bg-blue-50 border-blue-200' },
                                    { section: 'Right Elevation', compass: 'E', icon: '➡️', color: 'bg-green-50 border-green-200' },
                                    { section: 'Rear Elevation',  compass: 'S', icon: '⬇️', color: 'bg-orange-50 border-orange-200' },
                                    { section: 'Left Elevation',  compass: 'W', icon: '⬅️', color: 'bg-purple-50 border-purple-200' },
                                ].map(({ section, compass, icon, color }) => {
                                    const slotPhotos = media.filter(m => m.section === section);
                                    const latestPhoto = slotPhotos[slotPhotos.length - 1];
                                    const isUploading = uploadingNewsSlot === section;
                                    const inputId = `news-slot-${section.replace(/\s+/g,'-')}`;
                                    return (
                                        <div key={section} className={`border rounded-lg overflow-hidden ${color}`}>
                                            <div className="px-2 py-1 flex items-center gap-1 border-b">
                                                <span className="text-base">{icon}</span>
                                                <span className="text-xs font-bold text-gray-700">{compass} — {section.replace(' Elevation','')}</span>
                                                {slotPhotos.length > 0 && (
                                                    <span className="ml-auto text-xs text-gray-500">{slotPhotos.length} photo{slotPhotos.length!==1?'s':''}</span>
                                                )}
                                            </div>
                                            <div className="h-24 bg-white flex items-center justify-center">
                                                {latestPhoto ? (
                                                    <button
                                                        onClick={() => {
                                                            setActiveSection(section);
                                                        }}
                                                        className="w-full h-full"
                                                    >
                                                        <img
                                                            src={latestPhoto.file_url}
                                                            alt={section}
                                                            className="w-full h-24 object-cover"
                                                        />
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-gray-300">No photo yet</span>
                                                )}
                                            </div>
                                            <div className="p-1 border-t bg-white">
                                                <input
                                                    id={inputId}
                                                    type="file"
                                                    accept="image/*"
                                                    multiple
                                                    className="hidden"
                                                    onChange={(e) => {
                                                        handleNewsSlotUpload(section, e.target.files);
                                                        e.target.value = '';
                                                    }}
                                                />
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="w-full text-xs"
                                                    disabled={isUploading}
                                                    onClick={() => document.getElementById(inputId)?.click()}
                                                    data-testid={`button-news-upload-${compass.toLowerCase()}`}
                                                >
                                                    {isUploading ? (
                                                        <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Uploading…</>
                                                    ) : (
                                                        <><Upload className="w-3 h-3 mr-1" />Add Photo</>
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
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
                                                    ? `📸 All Photos${media.length > 0 ? ` (${media.length})` : ''}`
                                                    : `${activeSection}${media.filter(m => m.section === activeSection).length > 0 ? ` (${media.filter(m => m.section === activeSection).length})` : ''}`
                                                }
                                            </span>
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="All Photos">
                                            📸 All Photos {media.length > 0 && `(${media.length})`}
                                        </SelectItem>
                                        {sections.map(section => {
                                            const count = jobId ? media.filter(m => m.section === section).length : 0;
                                            return (
                                                <SelectItem key={section} value={section}>
                                                    {section}{count > 0 ? ` (${count})` : ''}
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
                                        📸 All Photos {media.length > 0 && `(${media.length})`}
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
                                                {section} {count > 0 && `(${count})`}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-2">
                             <div>
                                <h3 className="font-semibold text-lg mb-1">{activeSection}</h3>
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
                                                <Button variant="outline" size="sm" onClick={handleBulkDelete} className="text-red-600">
                                                    <Trash2 className="w-4 h-4 mr-1" /> Delete ({selectedPhotos.length})
                                                </Button>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-4 min-h-[150px]">
                            {isLoadingMedia && jobId ? <div className="col-span-full flex justify-center items-center py-8"><Loader2 className="animate-spin h-8 w-8 text-gray-500"/></div> : (
                                activeSectionMedia.length > 0 ? (
                                    activeSectionMedia.map(item => {
                                        const isSelected = selectedPhotos.includes(item.id);
                                        const aiData = item.ai_damage_analysis;
                                        const hasAI = aiData && (aiData.hail_hits_counted > 0 || aiData.wind_marks_counted > 0 || aiData.missing_shingles_counted > 0 || aiData.likely_discontinued || aiData.severity);
                                        const severityColor = aiData?.severity === 'severe' ? 'bg-red-600' : aiData?.severity === 'moderate' ? 'bg-orange-500' : aiData?.severity === 'minor' ? 'bg-yellow-500' : 'bg-green-500';
                                        
                                        return (
                                            <Card
                                                key={item.id}
                                                data-testid={`card-photo-${item.id}`}
                                                className={`relative group cursor-pointer ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
                                                onClick={() => {
                                                    if (selectedPhotos.length > 0) {
                                                        handlePhotoSelect(item.id);
                                                    } else {
                                                        handleOpenPhotoDetail(item);
                                                    }
                                                }}
                                            >
                                                <div className="aspect-square bg-gray-200 rounded-t-md flex items-center justify-center relative">
                                                    <img 
                                                      src={item.annotated_url || item.file_url} 
                                                      alt={item.caption || ''} 
                                                      className="w-full h-full object-cover rounded-t-md" 
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
                                                    
                                                    {/* Coverage Verdict Badge (replaces AI Annotated when available) */}
                                                    {aiData?.coverage_verdict ? (() => {
                                                        const cv = getCoverageVerdict(aiData.coverage_verdict);
                                                        const VerdictIcon = cv.icon;
                                                        return (
                                                            <div className={`absolute bottom-1 right-1 ${cv.bg} border ${cv.border} text-[9px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5`}>
                                                                <VerdictIcon className={`w-2.5 h-2.5 flex-shrink-0 ${cv.iconColor}`} />
                                                                <span className={cv.text}>{cv.label}</span>
                                                            </div>
                                                        );
                                                    })() : item.annotated_url ? (
                                                        <div className="absolute bottom-1 right-1 bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold">
                                                            AI Annotated
                                                        </div>
                                                    ) : null}

                                                    {/* AI Severity Badge - moved to not conflict with checkbox */}
                                                    {aiData?.severity && aiData.severity !== 'none' && (
                                                        <div className={`absolute top-8 right-1 ${severityColor} text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase`}>
                                                            SEV
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
                                                </div>
                                                <CardContent className="p-1.5">
                                                    {activeSection === 'All Photos' && item.section && (
                                                        <Badge variant="outline" className="text-[10px] mb-1 px-1 py-0">{item.section}</Badge>
                                                    )}
                                                    <p className="text-xs text-gray-600 truncate">{item.caption || 'No caption'}</p>

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
                                                        <p className="text-xs text-blue-600 truncate mt-1">{aiData.ai_notes}</p>
                                                    )}
                                                    <div className="flex gap-1 mt-1.5">
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
                                                                <XCircle className="w-3 h-3" />
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

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center gap-2">
                                    <Label>{t.sectionNotes || 'Section Notes'}</Label>
                                    {notesAutoSaved && (
                                        <span className="text-xs text-green-600 flex items-center gap-1 animate-in fade-in">
                                            <CheckCircle className="w-3 h-3" /> Auto-saved
                                        </span>
                                    )}
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleSaveNotes}
                                    disabled={!jobId || updateJobNotesMutation.isPending}
                                >
                                    {updateJobNotesMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                                    {t.saveNotes || 'Save Notes'}
                                </Button>
                            </div>
                            {activeSection === 'All Photos' ? (
                                <div className="space-y-3">
                                    {sections.filter(s => sectionNotes[s]).map(section => (
                                        <div key={section} className="bg-gray-50 rounded-lg p-3">
                                            <p className="text-xs font-semibold text-gray-700 mb-1">{section}</p>
                                            <p className="text-sm text-gray-600 whitespace-pre-wrap">{sectionNotes[section]}</p>
                                        </div>
                                    ))}
                                    {sections.filter(s => sectionNotes[s]).length === 0 && (
                                        <p className="text-sm text-gray-400">{t.noNotes}</p>
                                    )}
                                </div>
                            ) : (
                                <Textarea
                                    placeholder={`${t.addNotesFor} ${activeSection}...`}
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
                                    <span>Scope of Work</span>
                                    {sowAutoSaved && (
                                        <span className="text-xs text-green-600 flex items-center gap-1 animate-in fade-in font-normal">
                                            <CheckCircle className="w-3 h-3" /> Saved
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleDictateSow}
                                        disabled={isRecordingSow}
                                        className={isRecordingSow ? 'border-red-400 text-red-600' : ''}
                                        data-testid="button-dictate-sow"
                                    >
                                        <Mic className={`w-4 h-4 mr-1 ${isRecordingSow ? 'animate-pulse text-red-500' : ''}`} />
                                        {isRecordingSow ? 'Listening…' : 'Dictate'}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleGenerateSow}
                                        disabled={generatingSow}
                                        className="text-purple-700 border-purple-300 hover:bg-purple-50"
                                        data-testid="button-generate-sow"
                                    >
                                        {generatingSow ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                                        {generatingSow ? 'Generating…' : 'AI Generate'}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleSaveSow()}
                                        disabled={!scopeOfWork}
                                        data-testid="button-save-sow"
                                    >
                                        <Save className="w-4 h-4 mr-1" />
                                        Save
                                    </Button>
                                </div>
                            </CardTitle>
                            <p className="text-xs text-gray-500 mt-1">Describe the work needed. Use AI Generate to auto-write from your photo analysis, or tap Dictate to speak it.</p>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                placeholder="e.g.&#10;• Front slope: Full tear-off and replacement of 3-tab shingles, hail damage throughout&#10;• Ridge: Replace ridge cap, 12 lf&#10;• Gutters: Replace 40 lf aluminum gutters, dented from hail&#10;• Flashing: Replace step flashing at chimney…"
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
                            <Label>{t.additionalNotes}</Label>
                            <Input
                                value={bulkCaption}
                                onChange={(e) => setBulkCaption(e.target.value)}
                                placeholder={t.hailDamageExample}
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
                        <DialogTitle>Link Estimate to Inspection</DialogTitle>
                        <DialogDescription>
                            Select an existing estimate to include in the full inspection report
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                        {suggestedEstimates.length > 0 && (
                            <div className="mb-4">
                                <p className="text-sm font-semibold text-blue-600 mb-2">🎯 Suggested Matches</p>
                                {suggestedEstimates.slice(0, 3).map(estimate => (
                                    <Card
                                        key={estimate.id}
                                        className={`mb-2 cursor-pointer hover:border-blue-400 transition-colors ${selectedEstimateId === estimate.id ? 'border-2 border-blue-500 bg-blue-50' : ''}`}
                                        onClick={() => setSelectedEstimateId(estimate.id)}
                                    >
                                        <CardContent className="p-3">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-semibold text-gray-900">{estimate.estimate_number}</p>
                                                    <p className="text-sm text-gray-600">{estimate.customer_name}</p>
                                                    <p className="text-xs text-gray-500">{estimate.property_address}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-green-600">${Number(estimate.amount || 0).toFixed(2)}</p>
                                                    <Badge variant="outline">{estimate.status}</Badge>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}

                        {estimates.filter(e => !suggestedEstimates.includes(e)).length > 0 && (
                            <div>
                                <p className="text-sm font-semibold text-gray-600 mb-2">All Other Estimates</p>
                                {estimates.filter(e => !suggestedEstimates.includes(e)).map(estimate => (
                                    <Card
                                        key={estimate.id}
                                        className={`mb-2 cursor-pointer hover:border-blue-400 transition-colors ${selectedEstimateId === estimate.id ? 'border-2 border-blue-500 bg-blue-50' : ''}`}
                                        onClick={() => setSelectedEstimateId(estimate.id)}
                                    >
                                        <CardContent className="p-3">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-semibold text-gray-900">{estimate.estimate_number}</p>
                                                    <p className="text-sm text-gray-600">{estimate.customer_name}</p>
                                                    <p className="text-xs text-gray-500">{estimate.property_address}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-green-600">${Number(estimate.amount || 0).toFixed(2)}</p>
                                                    <Badge variant="outline">{estimate.status}</Badge>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}

                        {estimates.length === 0 && (
                            <div className="text-center py-8">
                                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                <p className="text-gray-600 mb-4">No estimates found</p>
                                <Button
                                    onClick={() => {
                                        const params = new URLSearchParams({
                                            customer_name: job?.client_name || '',
                                            customer_email: job?.client_email || '',
                                            customer_phone: job?.client_phone || '',
                                            property_address: job?.property_address || '',
                                            claim_number: job?.insurance_claim_number || '',
                                            inspection_job_id: jobId
                                        });
                                        navigate(createPageUrl('AIEstimator') + '?' + params.toString());
                                    }}
                                    className="bg-purple-600 hover:bg-purple-700"
                                >
                                    Create Estimate with AI
                                </Button>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowLinkEstimateDialog(false)}>Cancel</Button>
                        <Button
                            onClick={handleLinkEstimate}
                            disabled={!selectedEstimateId || linkEstimateMutation.isPending}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {linkEstimateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LinkIcon className="w-4 h-4 mr-2" />}
                            Link Estimate
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
                <DialogContent className="max-h-[90vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>📧 Choose Report Template & Send</DialogTitle>
                        <DialogDescription>
                            Select a template optimized for the insurance carrier
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 overflow-y-auto max-h-[60vh] pr-2">
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
                                
                                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg mb-2">
                                    <input
                                        type="checkbox"
                                        id="sendToProductionManager"
                                        checked={reportRecipients.sendToProductionManager}
                                        onChange={(e) => setReportRecipients({...reportRecipients, sendToProductionManager: e.target.checked})}
                                        className="w-4 h-4"
                                    />
                                    <label htmlFor="sendToProductionManager" className="flex-1 cursor-pointer">
                                        <div className="font-semibold text-gray-900">Production Manager</div>
                                        <div className="text-sm text-gray-600">For job review and approval</div>
                                    </label>
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

                        <Alert className="bg-purple-50 border-purple-200">
                            <AlertDescription className="text-purple-800 text-sm">
                                📊 <strong>Email tracking enabled</strong> - You'll see when recipients open the report
                            </AlertDescription>
                        </Alert>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>Cancel</Button>
                        <Button
                            onClick={handleGenerateAndSendReport}
                            disabled={isSendingReport || (!reportRecipients.sendToClient && !reportRecipients.sendToAdjuster && !reportRecipients.sendToProductionManager && !reportRecipients.sendToSalesRep && !reportRecipients.sendToCustomEmails) || (reportRecipients.sendToAdjuster && !reportRecipients.adjusterEmail)}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {isSendingReport ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                            Generate & Send
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AssignmentDialog
                isOpen={showEditDialog}
                onOpenChange={setShowEditDialog}
                existingJob={job}
                onAssignmentSent={(updatedJob) => {
                    queryClient.invalidateQueries({ queryKey: ['inspectionJob', jobId] });
                    setShowEditDialog(false);
                }}
            />

            <LinkStormDialog
                isOpen={showLinkStormDialog}
                onOpenChange={setShowLinkStormDialog}
                currentStormId={job?.related_storm_event_id}
                onStormLinked={(stormId) => {
                    linkStormMutation.mutate({ jobId, stormId });
                }}
            />

            <Dialog open={showPhotoDetailDialog} onOpenChange={(open) => { setShowPhotoDetailDialog(open); if (!open) setEditingPhoto(null); }}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Photo Details</DialogTitle>
                        <DialogDescription>View, edit damage counts, or re-analyze this photo</DialogDescription>
                    </DialogHeader>
                    {editingPhoto && (
                        <div className="space-y-4">
                            <div className="relative rounded-md overflow-hidden">
                                <img
                                    src={editingPhoto.annotated_url || editingPhoto.file_url}
                                    alt={editingPhoto.caption || ''}
                                    className="w-full max-h-[500px] object-contain bg-gray-100 rounded-md"
                                />
                                {editingPhoto.annotated_url && (
                                    <div className="absolute bottom-2 right-2 bg-blue-600 text-white text-xs px-2 py-0.5 rounded font-semibold">
                                        AI Annotated
                                    </div>
                                )}
                            </div>

                            <div>
                                <Label>Caption / Description (Slope & What's Shown)</Label>
                                <Textarea
                                    data-testid="input-photo-caption"
                                    value={editFormData.caption}
                                    onChange={(e) => setEditFormData(prev => ({ ...prev, caption: e.target.value }))}
                                    placeholder="e.g., North Slope - Close-up of hail damage on 3-tab shingles"
                                    rows={2}
                                />
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

                            <div>
                                <Label>Notes</Label>
                                <Textarea
                                    data-testid="input-ai-notes"
                                    value={editFormData.ai_notes}
                                    onChange={(e) => setEditFormData(prev => ({ ...prev, ai_notes: e.target.value }))}
                                    placeholder="Damage observations and notes..."
                                    rows={3}
                                />
                            </div>

                            {editingPhoto.ai_damage_analysis?.manually_edited && (
                                <p className="text-xs text-purple-600">Manually edited on {new Date(editingPhoto.ai_damage_analysis.edited_at).toLocaleString()}</p>
                            )}
                        </div>
                    )}
                    <DialogFooter className="flex flex-col sm:flex-row gap-2">
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
                                        const result = await handleReanalyzePhoto(editingPhoto);
                                        if (result) {
                                            setEditFormData({
                                                caption: editFormData.caption,
                                                hail_hits_counted: result.hail_hits_counted || 0,
                                                wind_marks_counted: result.wind_marks_counted || 0,
                                                missing_shingles_counted: result.missing_shingles_counted || 0,
                                                severity: result.severity || 'none',
                                                ai_notes: result.ai_notes || ''
                                            });
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

            {showMeasureTool && measureTargetPhoto && (
                <PhotoMeasureTool
                    photoUrl={measureTargetPhoto.annotated_url || measureTargetPhoto.file_url}
                    existingMeasurements={measureTargetPhoto.measurements || []}
                    onSave={handleSaveMeasurements}
                    onClose={() => { setShowMeasureTool(false); setMeasureTargetPhoto(null); }}
                />
            )}
        </div>
    );
}