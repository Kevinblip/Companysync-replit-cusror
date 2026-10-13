import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { BulkDeleteButton } from "@/components/BulkDeleteControls";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl, compressImage } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import useTranslation from "@/hooks/useTranslation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Upload,
  Loader2,
  MapPin,
  Camera,
  AlertTriangle,
  Wind,
  CloudHail,
  CheckCircle2,
  FileText,
  Sparkles,
  Eye,
  Trash2,
  DollarSign,
  Download,
  Satellite,
  Link2,
  FlaskConical,
  Target,
  Edit,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ChevronDown,
  ChevronUp,
  XCircle
} from "lucide-react";
import { format } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { annotateImage, drawTestSquares } from "@/components/inspections/ImageAnnotation";
import AerialSquareAdjuster from "@/components/inspections/AerialSquareAdjuster";
import { toast } from "react-hot-toast";
import { GoogleAddressAutocomplete } from "../components/GoogleAddressAutocomplete";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import InspectionRoutePlanner from "@/components/inspections/InspectionRoutePlanner";
import InspectionMapView from "@/components/inspections/InspectionMapView";
import { localToday } from "@/utils/localDate";
import { summarizePhotoSyncDamage } from "@/utils/photoSyncDamageSummary.mjs";

const getInspectionSectionSummaries = (inspection) => {
  const computed = summarizePhotoSyncDamage(inspection?.photos || []).section_summaries;
  return Object.keys(computed).length ? computed : (inspection?.section_summaries || {});
};

const DIRECTION_KEYWORD_MAP = {
  north: ['north', 'n slope', 'nslope'],
  south: ['south', 's slope', 'sslope'],
  east:  ['east',  'e slope', 'eslope'],
  west:  ['west',  'w slope', 'wslope'],
  front: ['front'],
  rear:  ['rear',  'back'],
  right: ['right'],
  left:  ['left'],
};

const autoAssignSectionFromDetected = (filename, closeupIndex, detectedSections) => {
  if (!detectedSections || detectedSections.length === 0) return null;

  if (filename) {
    const lower = filename.toLowerCase().replace(/[_\-\s]+/g, ' ');
    for (const sectionName of detectedSections) {
      const sectionLower = sectionName.toLowerCase();
      if (lower.includes(sectionLower)) return sectionName;
      for (const [dir, keywords] of Object.entries(DIRECTION_KEYWORD_MAP)) {
        if (sectionLower.includes(dir) && keywords.some(kw => lower.includes(kw))) {
          return sectionName;
        }
      }
    }
  }

  return detectedSections[closeupIndex % detectedSections.length];
};

export default function DroneInspections() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeView, setActiveView] = useState('inspections');
  const [showDialog, setShowDialog] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState(new Set()); // For bulk actions
  const [expandedPhotoNotes, setExpandedPhotoNotes] = useState(new Set()); // For expanded AI narratives
  const [formData, setFormData] = useState({
    property_address: "",
    customer_name: "",
    inspection_date: localToday(),
    inspection_type: "drone", // 'drone' or 'physical'
    weather_conditions: "",
    notes: "",
    storm_event_id: ""
  });

  const [aerialDetectedSections, setAerialDetectedSections] = useState([]);
  const [editingInspection, setEditingInspection] = useState(null);

  useEffect(() => {
    if (aerialDetectedSections.length === 0) return;
    setSelectedPhotos(prev => {
      let closeupIndex = 0;
      let autoCount = 0;
      const updated = prev.map(photo => {
        if (photo.photo_type !== 'roof_closeup') return photo;
        const idx = closeupIndex++;
        if (photo.section_manually_set) return photo;
        const assigned = autoAssignSectionFromDetected(photo.file?.name, idx, aerialDetectedSections);
        if (assigned && assigned !== photo.section) {
          autoCount++;
          return { ...photo, section: assigned, section_auto_assigned: true };
        }
        return photo;
      });
      if (autoCount > 0) {
        setTimeout(() => {
          toast.success(`Auto-labeled ${autoCount} photo${autoCount > 1 ? 's' : ''} with detected roof sections`);
        }, 0);
      }
      return updated;
    });
  }, [aerialDetectedSections]);

  // Holds a pending aerial-square-adjustment request; resolved by the inspector via AerialSquareAdjuster
  const [aerialAdjustRequest, setAerialAdjustRequest] = useState(null);

  // Holds state for re-editing test squares on a saved aerial photo
  const [editSquaresPhoto, setEditSquaresPhoto] = useState(null); // { photo, photoIdx, inspectionId }
  const [editSquaresLoading, setEditSquaresLoading] = useState(false);
  const [satelliteData, setSatelliteData] = useState(null);
  const [loadingSatellite, setLoadingSatellite] = useState(false);
  const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false);
  const [googleMapsError, setGoogleMapsError] = useState(null);
  const [generatingTest, setGeneratingTest] = useState(false);

  // Report Generation State
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [selectedInspectionForReport, setSelectedInspectionForReport] = useState(null);
  const [reportConfig, setReportConfig] = useState({
    hailThreshold: 7,
    windThreshold: 5,
    itelStatus: 'none', // 'none', 'match_found', 'no_match'
    applyOhioCode: false
  });

  // Storm Event Linking State
  const [showStormLinkDialog, setShowStormLinkDialog] = useState(false);
  const [selectedInspectionForStorm, setSelectedInspectionForStorm] = useState(null);
  const [stormSearchLocation, setStormSearchLocation] = useState('');
  const [stormSearchDate, setStormSearchDate] = useState('');

  // Reference Photos State
  const [showReferenceDialog, setShowReferenceDialog] = useState(false);
  const [uploadingReference, setUploadingReference] = useState(false);
  const [referenceForm, setReferenceForm] = useState({
    damage_type: 'wind_crease',
    custom_damage_type: '',
    description: ''
  });
  const [testResults, setTestResults] = useState(null);
  const [runningTest, setRunningTest] = useState(false);
  const [selectedRefPhoto, setSelectedRefPhoto] = useState(null);
  const [verifyForm, setVerifyForm] = useState({
    hail_count: 0,
    wind_count: 0
  });
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [selectedRefIds, setSelectedRefIds] = useState(new Set());
  const [bulkLabelType, setBulkLabelType] = useState("");

  const queryClient = useQueryClient();

  // 1. Init Hooks: user, myCompany
  const [user, setUser] = useState(null);

  const { company: myCompany, companies } = useCurrentCompany(user);

  const { data: inspections = [] } = useQuery({
    queryKey: ['drone-inspections', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.DroneInspection.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany?.id,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  const { data: allStormEvents = [] } = useQuery({
    queryKey: ['storm-events-all', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const res = await base44.functions.invoke('listStormEvents', { limit: 500 });
      return res?.data?.storms ?? res?.storms ?? [];
    },
    enabled: !!myCompany,
  });

  // Client-side filtering
  const stormEvents = React.useMemo(() => {
    let filtered = allStormEvents;

    // Default: Show last 365 days only (unless user picks a specific date)
    if (!stormSearchDate) {
      const today = new Date();
      const oneYearAgo = new Date();
      oneYearAgo.setDate(oneYearAgo.getDate() - 365);
      
      filtered = filtered.filter(storm => {
        const stormDate = new Date(storm.start_time);
        return stormDate >= oneYearAgo && stormDate <= today;
      });
    } else {
      // If user picks a date, show ±90 days around that date
      const searchDate = new Date(stormSearchDate);
      const startDate = new Date(searchDate);
      startDate.setDate(startDate.getDate() - 90);
      const endDate = new Date(searchDate);
      endDate.setDate(endDate.getDate() + 90);

      filtered = filtered.filter(storm => {
        const stormDate = new Date(storm.start_time);
        return stormDate >= startDate && stormDate <= endDate;
      });
    }

    // Filter by location
    if (stormSearchLocation) {
      const searchTerm = stormSearchLocation.toLowerCase();
      filtered = filtered.filter(storm => {
        const location = (storm.location || '').toLowerCase();
        const title = (storm.title || '').toLowerCase();
        const affectedAreas = (storm.affected_areas || []).join(' ').toLowerCase();
        return location.includes(searchTerm) || title.includes(searchTerm) || affectedAreas.includes(searchTerm);
      });
    }

    return filtered;
  }, [allStormEvents, stormSearchLocation, stormSearchDate]);

  const { data: referencePhotos = [] } = useQuery({
    queryKey: ['damage-references', myCompany?.id, companies.length],
    queryFn: async () => {
      const companySyncId = 'companysync_master_001';
      
      let refs = [];
      
      // 1. Fetch System Examples (CompanySync)
      if (companySyncId) {
        const systemRefs = await base44.entities.DamageReferencePhoto.filter({ company_id: companySyncId, is_active: true });
        refs = [...systemRefs];
      }
      
      // 2. Fetch User Company Examples (if different and company exists)
      if (myCompany && myCompany.id !== companySyncId) {
        const companyRefs = await base44.entities.DamageReferencePhoto.filter({ company_id: myCompany.id, is_active: true });
        refs = [...refs, ...companyRefs];
      }
      
      // Deduplicate
      return [...new Map(refs.map(item => [item.id, item])).values()];
    },
    enabled: companies.length > 0,
  });

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  // Scan selectedPhotos for any aerial photos that already have detected_sections (e.g. rehydrated from saved state)
  useEffect(() => {
    const names = [];
    selectedPhotos.forEach(photo => {
      if (Array.isArray(photo.detected_sections)) {
        photo.detected_sections.forEach(s => {
          if (s.name && !names.includes(s.name)) names.push(s.name);
        });
      }
    });
    if (names.length > 0) {
      setAerialDetectedSections(prev => {
        const combined = [...new Set([...prev, ...names])];
        return combined.length !== prev.length ? combined : prev;
      });
    }
  }, [selectedPhotos]);

  // Load Google Maps API
  useEffect(() => {
    const loadGoogleMaps = async () => {
      if (window.google && window.google.maps && window.google.maps.places) {
        setGoogleMapsLoaded(true);
        return;
      }

      try {
        const response = await base44.functions.invoke('getGoogleMapsApiKey');
        const { apiKey } = response.data;

        if (!apiKey) {
          throw new Error('Google Maps API key not configured');
        }

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
        script.async = true;
        script.defer = true;

        script.onload = () => {
          console.log('✅ Google Maps loaded successfully');
          setGoogleMapsLoaded(true);
        };

        script.onerror = () => {
          console.error('❌ Failed to load Google Maps');
          setGoogleMapsError('Failed to load Google Maps. Please refresh the page.');
        };

        document.head.appendChild(script);
      } catch (error) {
        console.error('Error loading Google Maps:', error);
        setGoogleMapsError(error.message || 'Failed to load Google Maps API');
      }
    };

    loadGoogleMaps();
  }, []);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const newInspection = await base44.entities.DroneInspection.create(data);
      
      // Trigger workflow for inspection completed
      if (myCompany?.id && newInspection.status === 'analyzed') {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'inspection_completed',
            companyId: myCompany.id,
            entityType: 'DroneInspection',
            entityId: newInspection.id,
            entityData: {
              inspection_number: newInspection.inspection_number,
              property_address: newInspection.property_address,
              customer_name: newInspection.customer_name,
              overall_condition: newInspection.overall_condition,
              hail_damage_detected: newInspection.hail_damage_detected,
              wind_damage_detected: newInspection.wind_damage_detected,
              estimated_repair_cost: newInspection.estimated_repair_cost,
              app_url: window.location.origin
            }
          });
        } catch (error) {
          console.error('Workflow trigger failed (non-critical):', error);
        }
      }
      
      return newInspection;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drone-inspections'] });
      setShowDialog(false);
      setSelectedPhotos([]);
      setAerialDetectedSections([]);
      setEditingInspection(null);
      setFormData({
        property_address: "",
        customer_name: "",
        inspection_date: localToday(),
        inspection_type: "drone",
        weather_conditions: "",
        notes: "",
        storm_event_id: ""
      });
      setUploadStatus(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.DroneInspection.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drone-inspections'] });
    },
  });

  const updateStormLinkMutation = useMutation({
    mutationFn: ({ inspectionId, stormEventId }) => 
      base44.entities.DroneInspection.update(inspectionId, { storm_event_id: stormEventId || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drone-inspections'] });
      setShowStormLinkDialog(false);
      toast.success('Storm event link updated!');
    },
  });

  const updateDatesMutation = useMutation({
    mutationFn: async ({ ids, date }) => {
      await Promise.all(ids.map(id => base44.entities.DroneInspection.update(id, { inspection_date: date })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drone-inspections'] });
    },
  });

  const uploadReferenceMutation = useMutation({
    mutationFn: async ({ file, damage_type, custom_damage_type, description }) => {
      let fileToUpload = file;
      
      // compressImage handles all formats (including WEBP) and re-encodes as JPEG
      fileToUpload = await compressImage(fileToUpload, 1400, 0.78);
      const { file_url } = await base44.integrations.Core.UploadFile({ file: fileToUpload });
      
      // Use custom type if provided, otherwise use dropdown selection
      const finalDamageType = custom_damage_type && custom_damage_type.trim() 
        ? custom_damage_type.trim() 
        : damage_type;
      
      const photoData = {
        company_id: myCompany?.id,
        damage_type: finalDamageType,
        photo_url: file_url,
        description,
        is_active: true
      };
      return base44.entities.DamageReferencePhoto.create(photoData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damage-references'] });
      setShowReferenceDialog(false);
      setReferenceForm({ damage_type: 'wind_crease', custom_damage_type: '', description: '' });
      toast.success('✅ Reference photo added!');
    }
  });

  const deleteReferenceMutation = useMutation({
    mutationFn: (id) => base44.entities.DamageReferencePhoto.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damage-references'] });
      toast.success('Reference photo deleted');
    }
  });

  const bulkDeleteReferencesMutation = useMutation({
    mutationFn: async (ids) => {
      await base44.entities.DamageReferencePhoto.bulkDelete(ids);
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ['damage-references'] });
      setSelectedRefIds(new Set());
      toast.success(`Deleted ${ids.length} reference photos`);
    }
  });

  const bulkLabelReferencesMutation = useMutation({
    mutationFn: async ({ ids, damageType }) => {
      for (const id of ids) {
        await base44.entities.DamageReferencePhoto.update(id, {
          damage_type: damageType
        });
        // Add delay to avoid rate limits
        if (ids.indexOf(id) < ids.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    },
    onSuccess: (_, { ids }) => {
      queryClient.invalidateQueries({ queryKey: ['damage-references'] });
      setSelectedRefIds(new Set());
      setBulkLabelType("");
      toast.success(`Updated ${ids.length} reference photos`);
    }
  });

  const markRefAsVerifiedMutation = useMutation({
    mutationFn: async ({ refId, hailCount, windCount }) => {
      return base44.entities.DamageReferencePhoto.update(refId, {
        is_verified: true,
        verified_hail_count: hailCount,
        verified_wind_count: windCount,
        verified_by: user.email,
        verified_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damage-references'] });
      setSelectedRefPhoto(null);
      toast.success('✅ Reference photo verified!');
    }
  });

  const handleRunAccuracyTest = async () => {
    const verifiedCount = referencePhotos.filter(p => p.is_verified).length;
    if (verifiedCount === 0) {
      toast.error('No verified photos. Click a photo to verify it first.');
      return;
    }

    setRunningTest(true);
    setTestResults(null);

    try {
      const response = await base44.functions.invoke('testAIDamageAccuracy', {
        companyId: myCompany.id
      });
      setTestResults(response.data);
      toast.success(`✅ Test complete! Avg Accuracy: ${response.data.summary.avg_hail_accuracy}%`);
    } catch (error) {
      toast.error('Test failed: ' + error.message);
    } finally {
      setRunningTest(false);
    }
  };

  const handleAddressSelect = async (address, details) => {
    console.log('🎯 handleAddressSelect called with:', address, details);
    
    if (!address || address.length < 5) return;

    const fullAddress = address;
    console.log('✅ Setting property_address to:', fullAddress);
    
    setFormData(prev => ({...prev, property_address: fullAddress}));
    setLoadingSatellite(true);
    setSatelliteData(null);
    
    try {
      const response = await base44.functions.invoke('analyzeSatelliteImage', {
        address: fullAddress
      });

      setSatelliteData(response.data);
      toast.success('🛰️ Satellite loaded!');
    } catch (error) {
      toast.error('Failed to load satellite: ' + error.message);
    } finally {
      setLoadingSatellite(false);
    }
  };

  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files);

    const validFiles = [];
    const heicFiles = [];
    const unsupportedFiles = [];

    files.forEach(file => {
      const fileName = file.name.toLowerCase();
      const extension = fileName.split('.').pop();

      if (extension === 'heic' || extension === 'heif') {
        heicFiles.push(file.name);
      } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
        validFiles.push(file);
      } else {
        unsupportedFiles.push(file.name);
      }
    });

    // Show warnings but don't block valid files
    if (heicFiles.length > 0) {
      setUploadStatus({
        type: 'error',
        message: `⚠️ SKIPPED ${heicFiles.length} HEIC file(s): ${heicFiles.join(', ')}. iPhone users: Settings → Camera → Formats → "Most Compatible" to save as JPG.`
      });
    }

    if (unsupportedFiles.length > 0) {
      setUploadStatus({
        type: 'error',
        message: `⚠️ SKIPPED ${unsupportedFiles.length} unsupported file(s): ${unsupportedFiles.join(', ')}.`
      });
    }

    if (validFiles.length === 0) {
      setUploadStatus({
        type: 'error',
        message: '❌ No valid images found. Please select JPG, PNG, or WEBP files only.'
      });
      return;
    }

    // Wrap files with metadata for slope/notes and photo type
    const newPhotos = validFiles.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
      section: 'General',
      notes: '',
      photo_type: 'roof_closeup'
    }));

    // Add valid photos (don't clear existing ones)
    if (heicFiles.length === 0 && unsupportedFiles.length === 0) {
      setUploadStatus(null); // Clear error only if all files were valid
    }
    setSelectedPhotos(prev => [...prev, ...newPhotos]);
    
    // Auto-select the newly added photos
    const newIds = new Set(selectedPhotoIds);
    newPhotos.forEach(p => newIds.add(p.id));
    setSelectedPhotoIds(newIds);
  };

  const updatePhotoMetadata = (id, field, value) => {
    setSelectedPhotos(prev => prev.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  const applySatelliteSectionsToPhotos = () => {
    if (!satelliteData?.roof_layout_analysis?.sections_identified) return;
    
    const sections = satelliteData.roof_layout_analysis.sections_identified;
    
    // Auto-assign photos to sections based on order
    setSelectedPhotos(prev => prev.map((photo, idx) => {
      const sectionIdx = idx % sections.length;
      const suggestedSection = sections[sectionIdx];
      
      return {
        ...photo,
        section: suggestedSection.section_name,
        notes: `${suggestedSection.orientation} - ${suggestedSection.description}`
      };
    }));
    
    toast.success(`✅ Auto-assigned ${selectedPhotos.length} photos to ${sections.length} roof sections`);
  };

  // Toggle selection of a single photo
  const toggleSelection = (id) => {
    const newIds = new Set(selectedPhotoIds);
    if (newIds.has(id)) {
      newIds.delete(id);
    } else {
      newIds.add(id);
    }
    setSelectedPhotoIds(newIds);
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (selectedPhotoIds.size === selectedPhotos.length) {
      setSelectedPhotoIds(new Set());
    } else {
      setSelectedPhotoIds(new Set(selectedPhotos.map(p => p.id)));
    }
  };

  // Bulk update function
  const handleBulkUpdate = (field, value) => {
    if (selectedPhotoIds.size === 0) return;
    
    setSelectedPhotos(prev => prev.map(p => 
      selectedPhotoIds.has(p.id) ? { ...p, [field]: value } : p
    ));
  };

  const removePhoto = (id) => {
    const remaining = selectedPhotos.filter(p => p.id !== id);
    setSelectedPhotos(remaining);
    const names = [];
    remaining.forEach(photo => {
      if (Array.isArray(photo.detected_sections)) {
        photo.detected_sections.forEach(s => {
          if (s.name && !names.includes(s.name)) names.push(s.name);
        });
      }
    });
    setAerialDetectedSections(names);
    const newIds = new Set(selectedPhotoIds);
    newIds.delete(id);
    setSelectedPhotoIds(newIds);
  };

  const handleOpenForEditing = (inspection) => {
    // Extract detected section names from any aerial photos in the saved inspection
    const detectedNames = [];
    (inspection.photos || []).forEach(photo => {
      if (Array.isArray(photo.detected_sections)) {
        photo.detected_sections.forEach(s => {
          const name = s.name || s;
          if (name && !detectedNames.includes(name)) detectedNames.push(name);
        });
      }
    });

    setEditingInspection(inspection);
    setAerialDetectedSections(detectedNames);
    setFormData({
      property_address: inspection.property_address || "",
      customer_name: inspection.customer_name || "",
      inspection_date: inspection.inspection_date || localToday(),
      inspection_type: inspection.inspection_type || "drone",
      weather_conditions: inspection.weather_conditions || "",
      notes: inspection.notes || "",
      storm_event_id: inspection.storm_event_id || ""
    });
    setSelectedPhotos([]);
    setUploadStatus(null);
    setShowDialog(true);
  };

  const analyzeDronePhotos = async () => {
    if (selectedPhotos.length === 0) {
      setUploadStatus({ type: 'error', message: 'Please select drone photos to analyze' });
      return;
    }
    if (!formData.property_address) {
      setUploadStatus({ type: 'error', message: 'Please enter a Property Address.' });
      return;
    }

    setUploading(true);
    setAnalyzing(true);
    setUploadStatus({ type: 'info', message: 'Uploading and analyzing drone photos...' });

    try {
      const photoResults = [];
      let hailDetected = false;
      let windDetected = false;
      // Cost estimation removed as per user request (defer to manual/AI estimator)

      // Upload and analyze each photo
      for (let i = 0; i < selectedPhotos.length; i++) {
        const photoItem = selectedPhotos[i];
        const file = photoItem.file;
        const userSection = photoItem.section;
        const userNotes = photoItem.notes;

        setUploadStatus({
          type: 'info',
          message: `Analyzing ${userSection} image (${i + 1}/${selectedPhotos.length})...`
        });

        // Normalize file with better error handling
        const fileNameParts = file.name.split('.');
        const originalExtension = fileNameParts.length > 1 ? fileNameParts[fileNameParts.length - 1] : '';
        const lowercaseExtension = originalExtension.toLowerCase();

        // Double-check for HEIC files (should be caught earlier, but extra safety)
        if (lowercaseExtension === 'heic' || lowercaseExtension === 'heif') {
          throw new Error(`Unsupported file type: ${file.name}. Please convert HEIC files to JPG first. On iPhone: Settings → Camera → Formats → "Most Compatible"`);
        }

        const baseName = fileNameParts.slice(0, -1).join('.');
        let normalizedFileName = originalExtension ? `${baseName}.${lowercaseExtension}` : file.name;

        let mimeType = file.type;
        if (!mimeType || mimeType === 'application/octet-stream') {
          const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp'
          };
          mimeType = mimeTypes[lowercaseExtension] || 'image/jpeg'; // Default to JPEG for valid image types if mime type is missing
        }

        let normalizedFile = new File([file], normalizedFileName, { type: mimeType });

        // Compress + convert to JPEG (handles WEBP, PNG, HEIC, etc.)
        normalizedFile = await compressImage(normalizedFile, 1400, 0.78);
        normalizedFileName = normalizedFile.name;
        mimeType = 'image/jpeg';

        // Upload photo
        let file_url;
        try {
          const uploadResponse = await base44.integrations.Core.UploadFile({ file: normalizedFile });
          file_url = uploadResponse.file_url;
          console.log(`✅ Photo uploaded: ${file_url}`);
        } catch (uploadError) {
          console.error('❌ Photo upload failed:', uploadError);
          throw new Error(`Failed to upload photo ${i + 1}: ${uploadError.message}`);
        }

        // Gather reference photos for this damage type (filter out WEBP/HEIC to prevent AI errors)
        const referenceUrls = referencePhotos
          .map(ref => ref.photo_url)
          .filter(url => {
            const lower = url.toLowerCase();
            return !lower.endsWith('.webp') && !lower.endsWith('.heic');
          });

        console.log(`📸 Analyzing photo ${i + 1} with ${referenceUrls.length} reference photos`);

        // Determine photo type-specific analysis
        const photoType = photoItem.photo_type || 'roof_closeup';
        const isOverheadAerial = photoType === 'overhead_aerial';

        // AI Analysis with Visual Detections & Square Test
        let analysisPrompt = "";

        if (isOverheadAerial) {
          // 🛸 OVERHEAD AERIAL — identify roof sections + place 10'×10' test squares
          const userRoofWidth = photoItem.roof_width_ft ? parseFloat(photoItem.roof_width_ft) : null;
          analysisPrompt = `You are an expert roofing inspector analyzing an OVERHEAD DRONE PHOTO of a roof taken straight down (or near-vertical) from a drone.

**YOUR MISSION:**
1. Identify every distinct roof slope/section visible from above.
2. Place a 10'×10' test square center point on each section.
3. Estimate the image scale so the squares can be drawn correctly.

**PROPERTY:** ${formData.property_address || 'Unknown'}
**INSPECTOR NOTES:** ${userNotes || 'None'}
${userRoofWidth ? `**KNOWN ROOF SPAN:** Approximately ${userRoofWidth} ft (use this to calibrate scale — see Step 3).` : ''}

---

**STEP 1 — Identify roof sections:**
For each visible slope, return:
- name: e.g. "North Slope", "South Slope", "East Slope", "West Slope" (or "Front Slope", "Back Slope", etc.)
- direction: single compass code — N, S, E, W, NE, NW, SE, SW, Front, Back, Left, or Right
- box_2d: bounding box of the entire slope on 0-1000 scale as [ymin, xmin, ymax, xmax] — enclose the full visible slope polygon
- center_x, center_y: recommended 10'×10' test-square CENTER on that slope (0-1000 scale, where 1000 = full image width/height)
  - Must be within the box_2d bounds
  - Place 4–8 ft from ridgeline, hip, valley, and all edges
  - Choose the widest accessible flat area on each slope

**STEP 2 — Determine direction:**
- The street-facing side is typically Front (South or whatever faces the road)
- A hip roof has 4 triangular slopes: N / S / E / W
- A gable has 2 main slopes (front & back) + 2 gable ends
- Use driveway, yard, landscaping, or shadow direction as clues

**STEP 3 — Estimate scale (pixels per foot, normalized to 1000-unit image):**
${userRoofWidth
  ? `User provided span of ${userRoofWidth} ft.
  - Estimate what fraction of the image WIDTH the roof structure occupies (0.0–1.0)
  - pixels_per_foot = (fraction × 1000) / ${userRoofWidth}
  - Example: if roof spans 80% of frame → (0.80 × 1000) / ${userRoofWidth} = ${(800 / userRoofWidth).toFixed(1)}`
  : `Count shingle courses (rows) visible on the largest slope from eave to ridge.
  - Standard architectural shingle: ~5.5" exposure per course
  - slope_height_in_1000_units = (ridge_y - eave_y) on 0-1000 scale
  - pixels_per_foot = (slope_height_in_1000_units × 12) / (course_count × 5.5)
  - Provide your best estimate — lean slightly conservative if uncertain`}

**RETURN JSON (DO NOT include any extra keys):**
- sections: array of section objects
- pixels_per_foot: number (in 1000-scale units per real foot)
- scale_note: brief phrase, e.g. "~28 shingle courses on south slope" or "calibrated to 42 ft span"
- description: 1-2 sentence summary of the roof type and orientation`;

        } else if (formData.inspection_type === 'physical') {
           // 👷 CHALK MARK DETECTION MODE - ULTRA AGGRESSIVE COUNTING
           analysisPrompt = `🚨 CRITICAL CHALK MARK COUNTING MISSION 🚨

You are analyzing a photo where an inspector physically CHALKED damage on shingles.

**YOUR MISSION: COUNT EVERY SINGLE CHALK MARK - DO NOT MISS ANY**

**WHAT CHALK LOOKS LIKE:**
- CIRCLES/OVALS = Hail damage (inspector circled the hits)
- LINES/SLASHES/X-MARKS = Wind damage (inspector marked creases)
- Colors: Yellow, White, Red, Blue, Orange - ANY colored marking on shingles

**COUNTING RULES - BE AGGRESSIVE:**
✓ If you see a colored circle on a shingle → COUNT IT as hail
✓ If you see a colored line/slash on a shingle → COUNT IT as wind
✓ Partial circles still count
✓ Faint marks still count
✓ Small marks still count
✓ Don't ask "is this real?" - the inspector marked it, so it's real

**DO NOT SKIP MARKS BECAUSE:**
- "Not sure if it's chalk" → If it looks like chalk, COUNT IT
- "Could be a shadow" → If it's colored and on a shingle, COUNT IT
- "Unclear if circular" → If it's roundish, COUNT IT
- "Only partial visible" → Still COUNT IT

**SYSTEMATIC SCAN:**
1. Start top-left of photo
2. Scan left-to-right, row by row
3. Count EVERY mark you see
4. Don't stop until you've checked every shingle

**DETECTIONS ARRAY - MANDATORY:**
For EVERY mark you count, add a box to 'detections':
- Hail circle: {type: "hail", box_2d: [ymin, xmin, ymax, xmax]}
- Wind line: {type: "wind", box_2d: [ymin, xmin, ymax, xmax]}
- Use 0-1000 scale, tight boxes around marks

**CRITICAL: COUNT ONLY WHAT YOU SEE IN THIS PHOTO**
- Do NOT estimate or extrapolate beyond this image
- Do NOT calculate "per square" averages
- Just count the actual marks visible here

**RETURN EXACT COUNTS + DETECTIONS:**
- hail_hits_counted: Exact number of circles in THIS photo
- wind_marks_counted: Exact number of lines in THIS photo
- detections: Array with a box for EACH mark
- description: "Counted X circles + Y lines in this photo"`;


        } else if (photoType === 'elevation_wide') {
          // 🏘️ ELEVATION/SIDING ANALYSIS MODE (like Hover)
          analysisPrompt = `You are analyzing a WIDE-ANGLE ELEVATION photo to detect damage on SIDING, GUTTERS, and other exterior components (NOT roof).

**Context:**
- Elevation: ${userSection}
- Inspector Notes: ${userNotes}
- Satellite Context: ${satelliteData?.roof_layout_analysis?.ai_description || 'Not available'}

**OBJECTIVE:** Detect storm damage on NON-ROOF components from this wide-angle view.

**LOOK FOR:**
1. **SIDING DAMAGE:**
   - Hail dents on vinyl/aluminum siding (circular indentations)
   - Cracks or holes in siding panels
   - Missing or damaged sections

2. **GUTTER DAMAGE:**
   - Dents on gutter faces
   - Sagging or detached sections
   - Crushed downspouts

3. **SOFT METAL HITS:**
   - Dents on vents, flashing, drip edge
   - Window trim/bead damage
   - Air conditioner unit dents

4. **OTHER EXTERIOR:**
   - Fence damage
   - Awning/canopy damage
   - Screen damage

**VISUAL ANNOTATION:**
- Draw boxes around EACH damaged area
- [ymin, xmin, ymax, xmax] on 0-1000 scale
- Focus on visible, clear damage

**Return JSON:**
- Set 'hail_hits_per_sq' and 'wind_damage_per_sq' to 0 (N/A for elevations)
- List damage types in 'damage_types' array (e.g., "siding_hail", "gutter_dent", "soft_metal_vent")
- Provide detailed description of collateral damage observed`;
        } else if (userSection === 'General' || userSection === 'Garage' || userSection === 'Shed') {
          // 🔭 WIDE ANGLE / DRONE CONTEXT MODE
          analysisPrompt = `You are an expert storm damage inspector analyzing a GENERAL OVERVIEW DRONE photo of a property.

        **Context:**
        - View Type: ${userSection} (Overview/Context)
        - Inspector Notes: ${userNotes}
        - Satellite Analysis: ${satelliteData?.roof_layout_analysis?.ai_description || 'Not available'}

        **Objective:** Establish the general condition of the roof AND other exterior components (Collateral Damage).

        **Tasks:**
        1. **Overall Condition**: Is the roof generally intact? Are there large missing sections?
        2. **Major Damage Only**: Identify LARGE, obvious damage visible from a distance on ROOF (e.g. missing ridge caps, tree impact, massive wind lift) AND OTHER EXTERIOR COMPONENTS (e.g., dented gutters, damaged siding, bent awnings, damaged fences, soft metal hits).
        3. **Ignore Noise**: Do not try to find small hail hits on a wide angle shot.

        **Visual Annotation**:
        - Draw boxes around MAJOR issues (missing shingles, holes, dents on siding/gutters, etc.).
        - [ymin, xmin, ymax, xmax] on 0-1000 scale.

        **Return JSON**:
        - Set 'hail_hits_per_sq' and 'wind_damage_per_sq' to 0 (Not applicable for Overview).
        - Describe the overall impression in 'description'.
        - **CRITICAL**: Include other damage types in 'damage_types' array (e.g. "siding", "gutters", "fence", "awning", "soft metal", "window bead", "screens").`;
        } else {
          // 🔬 DRONE/CLOSE-UP MODE - ACTUAL DAMAGE DETECTION (HIGH SENSITIVITY)
          analysisPrompt = `You are an elite forensic storm damage inspector analyzing a close-up roof photo.
          
**MISSION:** Detect ALL signs of hail and wind damage, including subtle or early-stage damage.
**BIAS:** Lean towards DETECTION. If it looks like damage, mark it. Do not be conservative.

**Context:**
- Roof Section: ${userSection}
- Inspector Notes: ${userNotes}

**🔍 DETECTION CRITERIA (AGGRESSIVE):**

**1. HAIL DAMAGE (Bruising & Impact):**
- **LOOK FOR:** Dark spots, circular black marks, granule displacement, or physical dents.
- **SUBTLE HITS:** Even small dark spots where granules are missing count as hail hits.
- **CLUSTERS:** If you see multiple small marks in an area, count them all.
- **ACTION:** Draw a box around EVERY individual hit you see.

**2. WIND DAMAGE (Creased & Lifted):**
- **LOOK FOR:** Horizontal dark lines near the top of shingles (creases).
- **SHADOW VS CREASE:** If a dark line crosses the shingle horizontally, assume it is a wind crease unless strictly proven otherwise.
- **LIFTED:** Any shadow under a shingle tab indicating lift.
- **MISSING:** Any missing tabs or sections.
- **ACTION:** Draw a box around EVERY affected shingle.

**REFERENCE COMPARISON:**
- Use the provided ${referenceUrls.length} reference photos as your "ground truth" for what damage looks like.
- If features in this photo resemble the reference photos, FLAG THEM.

**SHINGLE MEASUREMENTS (ITEL):**
- Measure shingle exposure: distance from one shingle bottom to the next (usually 5-7 inches)
- Estimate width: left-to-right measurement
- Type: Is this 3-tab (flat, uniform) or dimensional (textured, varied)?

**🚨 DISCONTINUED MATERIAL FLAGS:**
- 3-tab shingles = likely_discontinued: TRUE (most manufacturers stopped making these)
- Dimensional with 5" exposure + ~36" width = likely_discontinued: TRUE
- This is CRITICAL for insurance - discontinued = can't match = full replacement

**CRITICAL - VISUAL MARKUPS:**
For EVERY damage point, add to 'detections' array:
- {type: "hail"/"wind"/"other", box_2d: [ymin, xmin, ymax, xmax]}
- Coordinates on 0-1000 scale
- Place box CENTER over the damage

**Return JSON with damage counts, shingle specs, discontinued flag, and detections array.**`;
        }

        let analysis;
        try {
          console.log(`🤖 Calling AI analysis for photo ${i + 1}... Mode: ${isOverheadAerial ? 'overhead_aerial' : formData.inspection_type}`);

          if (isOverheadAerial) {
            // ── AERIAL: different schema — no damage detection, just section detection
            analysis = await base44.integrations.Core.InvokeLLM({
              prompt: analysisPrompt,
              file_urls: [file_url],
              response_json_schema: {
                type: "object",
                properties: {
                  sections: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name:      { type: "string", description: "e.g. North Slope, South Slope" },
                        direction: { type: "string", description: "N, S, E, W, NE, NW, SE, SW, Front, Back, Left, or Right" },
                        box_2d:    {
                          type: "array",
                          items: { type: "number" },
                          description: "[ymin, xmin, ymax, xmax] on 0-1000 scale — bounding box of the full slope"
                        },
                        center_x:  { type: "number", description: "0-1000 scale x-coordinate for test square center (within box_2d)" },
                        center_y:  { type: "number", description: "0-1000 scale y-coordinate for test square center (within box_2d)" }
                      }
                    }
                  },
                  pixels_per_foot: { type: "number", description: "1000-scale units per real foot" },
                  scale_note:      { type: "string",  description: "Brief note on how scale was estimated" },
                  description:     { type: "string",  description: "1-2 sentence summary of roof type and orientation" }
                }
              }
            });
          } else {
            // ── STANDARD damage analysis
            analysis = await base44.integrations.Core.InvokeLLM({
              prompt: analysisPrompt + (formData.inspection_type !== 'physical' && referenceUrls.length > 0 ? `\n\n**REFERENCE PHOTOS PROVIDED**: You have ${referenceUrls.length} example photos showing what damage looks like. Compare the inspection photo against these visual references to improve accuracy.` : '') + (formData.inspection_type !== 'physical' ? `\n\n**SHINGLE DIMENSION ANALYSIS (CRITICAL FOR ITEL):**
          - Measure visible shingle exposure (distance from bottom of one shingle to bottom of next)
          - Estimate shingle width (left to right measurement)
          - Identify shingle type: "3-tab", "dimensional", "architectural", "unknown"
          - **HIGH RISK DISCONTINUED**: Dimensional shingles with 5-inch exposure and 36-inch width are VERY LIKELY discontinued (flag as likely_discontinued=true)
          - **HIGH RISK DISCONTINUED**: 3-tab shingles (ALL types) are increasingly discontinued by manufacturers (flag as likely_discontinued=true)
          - If measurements suggest discontinued materials, this STRENGTHENS the case for full replacement under matching codes.` : ''),
              file_urls: formData.inspection_type === 'physical' ? [file_url] : [file_url, ...referenceUrls],
              response_json_schema: {
                type: "object",
                properties: {
                  damage_types: { type: "array", items: { type: "string" } },
                  severity: { type: "string", enum: ["none", "minor", "moderate", "severe"] },
                  has_hail_damage: { type: "boolean" },
                  has_wind_damage: { type: "boolean" },
                  hail_hits_counted: { type: "number", description: "EXACT count of hail marks visible in THIS photo ONLY" },
                  wind_marks_counted: { type: "number", description: "EXACT count of wind marks visible in THIS photo ONLY" },
                  description: { type: "string" },
                  insurance_recommended: { type: "boolean" },
                  roof_section: { type: "string" },
                  shingle_type: { type: "string", enum: ["3-tab", "dimensional", "architectural", "unknown"] },
                  shingle_exposure_inches: { type: "number", description: "Visible exposure in inches" },
                  shingle_width_inches: { type: "number", description: "Width in inches" },
                  likely_discontinued: { type: "boolean", description: "True if dimensions match discontinued profiles" },
                  detections: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["hail", "wind", "other"] },
                        box_2d: { 
                          type: "array", 
                          items: { type: "number" },
                          description: "[ymin, xmin, ymax, xmax] on 0-1000 scale"
                        }
                      }
                    }
                  }
                }
              }
            });
          }
          console.log(`✅ AI analysis complete for photo ${i + 1}`);
        } catch (aiError) {
          console.error(`❌ AI analysis failed for photo ${i + 1}:`, aiError);
          throw new Error(`AI analysis failed for photo ${i + 1}: ${aiError.message}`);
        }

        // ── OVERHEAD AERIAL: draw test squares, save result, then continue to next photo
        if (isOverheadAerial) {
          // Minimal validation guard: ensure sections is an array, clamped centers, positive scale
          const rawSections = Array.isArray(analysis.sections) ? analysis.sections : [];
          const validatedSections = rawSections
            .filter(s => s && typeof s.center_x === 'number' && typeof s.center_y === 'number')
            .map(s => ({
              ...s,
              center_x: Math.max(0, Math.min(1000, s.center_x)),
              center_y: Math.max(0, Math.min(1000, s.center_y)),
              box_2d: Array.isArray(s.box_2d) && s.box_2d.length === 4 ? s.box_2d.map(v => Math.max(0, Math.min(1000, v))) : null
            }));

          // pixels_per_foot from AI is already in 0-1000 normalized units;
          // drawTestSquares converts to actual px using img.width internally.
          // Fallback: if user gave roof_width_ft, use (0.80 × 1000) / width as normPpf.
          const normPpf = (analysis.pixels_per_foot && analysis.pixels_per_foot > 0)
            ? analysis.pixels_per_foot
            : (photoItem.roof_width_ft ? (800 / parseFloat(photoItem.roof_width_ft)) : 20);

          // ── Let the inspector review and reposition squares before we commit ──
          // null means the inspector cancelled; non-null means confirmed (possibly adjusted)
          let confirmedSections = null;
          try {
            setUploadStatus({ type: 'info', message: `Review test square placement for aerial photo ${i + 1}…` });
            confirmedSections = await new Promise((resolve, reject) => {
              setAerialAdjustRequest({
                imageUrl: file_url,
                sections: validatedSections,
                normPpf,
                scaleNote: analysis.scale_note || 'AI estimated',
                resolve,
                reject
              });
            });
            setAerialAdjustRequest(null);
          } catch {
            // Inspector cancelled — clear the adjuster and leave confirmedSections as null
            setAerialAdjustRequest(null);
            console.log('⚠️ Inspector cancelled aerial adjustment; annotated image will not be uploaded');
          }

          // Only draw and upload the annotated image if the inspector confirmed placement
          let aerialAnnotatedUrl = null;
          if (confirmedSections !== null) {
            try {
              console.log(`📐 Drawing ${confirmedSections.length} test squares (inspector-confirmed), normPpf=${normPpf.toFixed(2)}`);
              setUploadStatus({ type: 'info', message: `Drawing ${confirmedSections.length} test squares on aerial photo ${i + 1}...` });

              const aerialBlob = await drawTestSquares(file_url, confirmedSections, normPpf, analysis.scale_note || 'AI estimated');
              const aerialFile = new File([aerialBlob], `test_squares_${normalizedFileName}`, { type: 'image/jpeg' });
              const aerialUpload = await base44.integrations.Core.UploadFile({ file: aerialFile });
              aerialAnnotatedUrl = aerialUpload.file_url;
              console.log(`✅ Test square image uploaded: ${aerialAnnotatedUrl}`);
            } catch (tsErr) {
              console.error('❌ Test square drawing failed:', tsErr);
            }
          }

          // Use inspector-confirmed sections if available (they may have been renamed); fall back to AI sections
          const finalSections = confirmedSections ?? validatedSections;
          const sectionNames = finalSections.map(s => s.name).filter(Boolean);
          if (sectionNames.length > 0) {
            setAerialDetectedSections(prev => {
              const combined = [...new Set([...prev, ...sectionNames])];
              return combined;
            });
          }
          photoResults.push({
            url: file_url,
            annotated_url: aerialAnnotatedUrl,
            photo_type: 'overhead_aerial',
            caption: file.name,
            damage_detected: false,
            damage_type: [],
            severity: 'none',
            ai_analysis: analysis.description || 'Overhead aerial analysis complete',
            roof_section: 'Overhead / Aerial',
            user_notes: userNotes,
            hail_hits_counted: 0,
            wind_marks_counted: 0,
            shingle_type: 'unknown',
            shingle_exposure_inches: 0,
            shingle_width_inches: 0,
            likely_discontinued: false,
            detections: [],
            ai_notes: `Detected sections: ${sectionNames.join(', ') || 'none'}. Scale: ${analysis.scale_note || 'AI estimated'}.`,
            detected_sections: finalSections, // inspector-confirmed positions (with any renames), or AI positions if cancelled
            norm_ppf: normPpf,
            scale_note: analysis.scale_note || 'AI estimated'
          });
          continue; // ← skip damage-validation and standard photoResults.push below
        }

        // 🎨 GENERATE VISUAL ANNOTATIONS (standard damage photos)
        let annotatedFileUrl = null;
        if (analysis.detections && analysis.detections.length > 0) {
          try {
            console.log(`✅ AI found ${analysis.detections.length} detections, drawing annotations...`);
            setUploadStatus({
              type: 'info',
              message: `Drawing ${analysis.detections.length} markups on image ${i + 1}...`
            });

            const annotatedBlob = await annotateImage(file_url, analysis.detections);
            const annotatedFile = new File([annotatedBlob], `annotated_${normalizedFileName}`, { type: 'image/jpeg' });
            const uploadRes = await base44.integrations.Core.UploadFile({ file: annotatedFile });
            annotatedFileUrl = uploadRes.file_url;
            console.log(`✅ Annotated image uploaded: ${annotatedFileUrl}`);
          } catch (annotError) {
            console.error("❌ Annotation failed:", annotError);
            setUploadStatus({
              type: 'info',
              message: `Annotation failed for image ${i + 1}, continuing with original image...`
            });
            // Continue without annotation if drawing fails
          }
        } else {
          console.log(`⚠️ No detections returned by AI for image ${i + 1}`);
        }

        // 🔍 VALIDATION: Fix AI inconsistencies
        let validatedAnalysis = { ...analysis };
        let validationNotes = [];

        // If AI drew boxes but said "no damage", enforce minimum counts
        if (validatedAnalysis.detections && validatedAnalysis.detections.length > 0) {
          const hailBoxes = validatedAnalysis.detections.filter(d => d.type === 'hail').length;
          const windBoxes = validatedAnalysis.detections.filter(d => d.type === 'wind').length;

          // Enforce counts based on detections
          if (hailBoxes > 0 && (!validatedAnalysis.hail_hits_counted || validatedAnalysis.hail_hits_counted === 0)) {
            validatedAnalysis.hail_hits_counted = hailBoxes;
            validatedAnalysis.has_hail_damage = true;
            validatedAnalysis.severity = validatedAnalysis.severity === 'none' ? 'minor' : validatedAnalysis.severity;
            validationNotes.push(`AI drew ${hailBoxes} hail boxes but didn't count them - corrected`);
          }
          
          if (windBoxes > 0 && (!validatedAnalysis.wind_marks_counted || validatedAnalysis.wind_marks_counted === 0)) {
            validatedAnalysis.wind_marks_counted = windBoxes;
            validatedAnalysis.has_wind_damage = true;
            validatedAnalysis.severity = validatedAnalysis.severity === 'none' ? 'minor' : validatedAnalysis.severity;
            validationNotes.push(`AI drew ${windBoxes} wind boxes but didn't count them - corrected`);
          }

          // Ensure damage_types is populated
          if (!validatedAnalysis.damage_types || validatedAnalysis.damage_types.length === 0) {
            validatedAnalysis.damage_types = [];
            if (hailBoxes > 0) validatedAnalysis.damage_types.push('hail_damage');
            if (windBoxes > 0) validatedAnalysis.damage_types.push('wind_damage');
          }
        }

        // Enforce minimum counts based on severity
        if (validatedAnalysis.severity === 'moderate' && (!validatedAnalysis.hail_hits_counted || validatedAnalysis.hail_hits_counted < 5)) {
          validatedAnalysis.hail_hits_counted = Math.max(validatedAnalysis.hail_hits_counted || 0, 5);
          validationNotes.push('Moderate severity enforced minimum 5 hits');
        }
        if (validatedAnalysis.severity === 'severe' && (!validatedAnalysis.hail_hits_counted || validatedAnalysis.hail_hits_counted < 10)) {
          validatedAnalysis.hail_hits_counted = Math.max(validatedAnalysis.hail_hits_counted || 0, 10);
          validationNotes.push('Severe severity enforced minimum 10 hits');
        }

        // Log validation actions
        if (validationNotes.length > 0) {
          console.log(`⚠️ Validation corrections for photo ${i + 1}:`, validationNotes);
        }

        if (validatedAnalysis.has_hail_damage) hailDetected = true;
        if (validatedAnalysis.has_wind_damage) windDetected = true;

        const damageTypes = validatedAnalysis?.damage_types || [];
        
        photoResults.push({
          url: file_url,
          annotated_url: annotatedFileUrl,
          photo_type: validatedAnalysis?.photo_type || photoItem.photo_type || 'Overview',
          caption: file.name,
          damage_detected: damageTypes.length > 0 || (validatedAnalysis.detections && validatedAnalysis.detections.length > 0),
          damage_type: damageTypes,
          severity: validatedAnalysis?.severity || 'none',
          ai_analysis: (validatedAnalysis?.description || 'Analysis completed') + (validationNotes.length > 0 ? '\n[Validation: ' + validationNotes.join('; ') + ']' : ''),
          roof_section: validatedAnalysis?.roof_section || userSection,
          user_notes: userNotes,
          hail_hits_counted: validatedAnalysis?.hail_hits_counted || 0,
          wind_marks_counted: validatedAnalysis?.wind_marks_counted || 0,
          dents_counted: validatedAnalysis?.dents_counted || 0,
          material_category: validatedAnalysis?.material_category || '',
          shingle_type: validatedAnalysis?.shingle_type || 'unknown',
          shingle_exposure_inches: validatedAnalysis?.shingle_exposure_inches || 0,
          shingle_width_inches: validatedAnalysis?.shingle_width_inches || 0,
          likely_discontinued: validatedAnalysis?.likely_discontinued || false,
          detections: validatedAnalysis?.detections || [],
          photo_quality_flag: validatedAnalysis?.photo_quality_flag || 'good',
          photo_quality_score: validatedAnalysis?.photo_quality_score || 75,
          coverage_verdict: validatedAnalysis?.coverage_verdict || 'mixed',
          covered_items: validatedAnalysis?.covered_items || [],
          non_covered_items: validatedAnalysis?.non_covered_items || [],
          confidence_score: validatedAnalysis?.confidence_score || 0.8,
          ai_notes: validatedAnalysis?.ai_notes || validatedAnalysis?.description || ''
        });
      }

      // Summaries use Test Square counts for density; overview and close-up
      // photos cannot dilute or inflate those values.
      const { section_summaries: sectionSummaries } = summarizePhotoSyncDamage(photoResults);

      // Determine overall condition
      const maxSeverity = photoResults.reduce((max, photo) => {
        const severityLevels = { none: 0, minor: 1, moderate: 2, severe: 3 };
        const photoLevel = severityLevels[photo.severity] || 0;
        return photoLevel > max ? photoLevel : max;
      }, 0);

      const overallCondition =
        maxSeverity === 0 ? 'excellent' :
        maxSeverity === 1 ? 'good' :
        maxSeverity === 2 ? 'fair' : 'poor';

      // Check if discontinued materials detected
      const discontinuedDetected = photoResults.some(p => p.likely_discontinued);
      const discontinuedNotes = discontinuedDetected 
        ? '\n\n🚨 MATERIAL MATCHING ALERT: AI detected likely discontinued shingle profile (3-tab or dimensional 5"x36"). ITEL report recommended. If no match found, building codes (e.g., Ohio OAC 3901-1-54) may require full replacement for uniform appearance.'
        : '';

      if (editingInspection) {
        // Append new photos to existing inspection and recalculate summaries
        const mergedPhotos = [...(editingInspection.photos || []), ...photoResults];
        const mergedHail = editingInspection.hail_damage_detected || hailDetected;
        const mergedWind = editingInspection.wind_damage_detected || windDetected;
        const updateData = {
          property_address: formData.property_address,
          customer_name: formData.customer_name,
          inspection_date: formData.inspection_date,
          weather_conditions: formData.weather_conditions,
          storm_event_id: formData.storm_event_id || null,
          photos: mergedPhotos,
          section_summaries: sectionSummaries,
          overall_condition: overallCondition,
          hail_damage_detected: mergedHail,
          wind_damage_detected: mergedWind,
          notes: (formData.notes || '') + discontinuedNotes,
          status: 'analyzed',
          material_matching_flag: discontinuedDetected || editingInspection.material_matching_flag
        };
        await base44.entities.DroneInspection.update(editingInspection.id, updateData);
        queryClient.invalidateQueries({ queryKey: ['drone-inspections'] });
        setShowDialog(false);
        setSelectedPhotos([]);
        setAerialDetectedSections([]);
        setEditingInspection(null);
        setFormData({
          property_address: "",
          customer_name: "",
          inspection_date: localToday(),
          inspection_type: "drone",
          weather_conditions: "",
          notes: "",
          storm_event_id: ""
        });
        toast.success(`Photos added! ${hailDetected || windDetected ? 'New damage detected.' : 'Analysis complete.'}`);
      } else {
        // Create inspection record
        const inspectionData = {
          company_id: myCompany?.id,
          inspection_number: `DRONE-${Date.now().toString().slice(-8)}`,
          property_address: formData.property_address,
          customer_name: formData.customer_name,
          inspection_date: formData.inspection_date,
          weather_conditions: formData.weather_conditions,
          storm_event_id: formData.storm_event_id || null,
          satellite_image_url: satelliteData?.satellite_image_url,
          roof_layout_analysis: satelliteData?.roof_layout_analysis,
          photos: photoResults,
          section_summaries: sectionSummaries,
          overall_condition: overallCondition,
          hail_damage_detected: hailDetected,
          wind_damage_detected: windDetected,
          estimated_repair_cost: 0,
          notes: (formData.notes || '') + discontinuedNotes,
          status: 'analyzed',
          material_matching_flag: discontinuedDetected
        };
        await createMutation.mutateAsync(inspectionData);
      }

      setUploadStatus({
        type: 'success',
        message: `Drone analysis complete! ${hailDetected || windDetected ? 'Storm damage detected!' : 'No significant damage found.'}`
      });

    } catch (error) {
      console.error('Drone analysis error:', error);
      setUploadStatus({ type: 'error', message: `Drone analysis error: ${error.message}` });
    }

    setUploading(false);
    setAnalyzing(false);
  };

  const handleDownloadReport = (inspection) => {
    setSelectedInspectionForReport(inspection);
    
    // Auto-detect property state
    let detectedState = null;
    if (inspection.property_address) {
      const addressParts = inspection.property_address.split(',').map(p => p.trim());
      if (addressParts.length >= 2) {
        const statePart = addressParts[addressParts.length - 2];
        const stateMatch = statePart.match(/\b([A-Z]{2})\b/);
        if (stateMatch) {
          detectedState = stateMatch[1];
        }
      }
    }
    
    // Reset config defaults
    setReportConfig({
      hailThreshold: 7,
      windThreshold: 5,
      itelStatus: 'none',
      applyOhioCode: false,
      detectedState: detectedState
    });
    setShowReportDialog(true);
  };

  const confirmGenerateReport = async () => {
    if (!selectedInspectionForReport) return;
    
    setUploadStatus({ type: 'info', message: 'Generating report...' }); // Reuse upload status for feedback or add new state
    
    try {
      const response = await base44.functions.invoke('generateDroneReport', {
        inspectionId: selectedInspectionForReport.id,
        hailThreshold: reportConfig.hailThreshold,
        windThreshold: reportConfig.windThreshold,
        itelStatus: reportConfig.itelStatus,
        applyOhioCode: reportConfig.applyOhioCode
      });

      // Download PDF as blob (handles both base64 and remote URL responses)
      let blob;
      if (response.data.pdf_base64) {
        const dataUri = response.data.pdf_base64;
        const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
        const byteChars = atob(base64);
        const byteArr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
        blob = new Blob([byteArr], { type: 'application/pdf' });
      } else if (response.data.pdf_url) {
        const fetchRes = await fetch(response.data.pdf_url);
        if (!fetchRes.ok) throw new Error('Failed to fetch PDF from storage');
        blob = await fetchRes.blob();
      } else {
        throw new Error('No PDF data returned from server');
      }
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `Drone-Report-${selectedInspectionForReport.inspection_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      
      setShowReportDialog(false);
      setUploadStatus(null);
    } catch (error) {
      alert('Failed to generate report: ' + error.message);
      setUploadStatus(null);
    }
  };

  const handleCreateEstimate = (inspection) => {
    // Navigate to Estimates page with pre-filled data
    const params = new URLSearchParams({
      create_new: 'true',
      prefill: 'true',
      customer_name: inspection.customer_name,
      property_address: inspection.property_address,
      drone_inspection_id: inspection.id
    });
    navigate(createPageUrl('Estimates') + '?' + params.toString());
  };

  const handleDelete = (inspectionId) => {
    if (window.confirm("Are you sure you want to delete this drone inspection?")) {
      deleteMutation.mutate(inspectionId);
    }
  };

  const handleTestReport = async () => {
    setGeneratingTest(true);
    const toastId = toast.loading('Generating test report...');
    try {
      const response = await base44.functions.invoke('generateDroneReport', { 
        testMode: true,
        companyId: myCompany?.id
      });
      
      let testBlob;
      if (response.data.pdf_base64) {
        const dataUri = response.data.pdf_base64;
        const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
        const byteChars = atob(base64);
        const byteArr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
        testBlob = new Blob([byteArr], { type: 'application/pdf' });
      } else if (response.data.pdf_url) {
        const fetchRes = await fetch(response.data.pdf_url);
        if (!fetchRes.ok) throw new Error('Failed to fetch test PDF');
        testBlob = await fetchRes.blob();
      } else {
        throw new Error('No PDF data returned');
      }
      const blobUrl = URL.createObjectURL(testBlob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `TEST-Drone-Report.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      toast.success('Test report generated!', { id: toastId });
    } catch (error) {
      console.error(error);
      toast.error('Failed to generate test report: ' + error.message, { id: toastId });
    } finally {
      setGeneratingTest(false);
    }
  };

  const getSeverityColor = (severity) => {
    const colors = {
      'none': 'bg-green-100 text-green-700 border-green-200',
      'minor': 'bg-yellow-100 text-yellow-700 border-yellow-200',
      'moderate': 'bg-orange-100 text-orange-700 border-orange-200',
      'severe': 'bg-red-100 text-red-700 border-red-200'
    };
    return colors[severity] || colors.none;
  };

  const getCoverageVerdict = (verdict) => {
    const map = {
      covered: { label: 'Covered', icon: ShieldCheck, bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', iconColor: 'text-green-600', barColor: 'bg-green-500' },
      mixed: { label: 'Mixed Coverage', icon: ShieldAlert, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', iconColor: 'text-amber-500', barColor: 'bg-amber-500' },
      not_covered: { label: 'Not Covered', icon: ShieldX, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', iconColor: 'text-red-600', barColor: 'bg-red-500' }
    };
    return map[verdict] || map.mixed;
  };

  const getQualityBarColor = (score) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 55) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getConditionColor = (condition) => {
    const colors = {
      'excellent': 'bg-green-100 text-green-700 border-green-200',
      'good': 'bg-blue-100 text-blue-700 border-blue-200',
      'fair': 'bg-yellow-100 text-yellow-700 border-yellow-200',
      'poor': 'bg-orange-100 text-orange-700 border-orange-200',
      'critical': 'bg-red-100 text-red-700 border-red-200'
    };
    return colors[condition] || colors.good;
  };

  const handleEditSquaresConfirm = async (adjustedSections) => {
    if (!editSquaresPhoto) return;
    const { photo, photoIdx, inspection } = editSquaresPhoto;
    setEditSquaresLoading(true);
    try {
      const normPpf = photo.norm_ppf || 20;
      const scaleNote = photo.scale_note || 'AI estimated';
      const aerialBlob = await drawTestSquares(photo.url, adjustedSections, normPpf, scaleNote);
      const fileName = `test_squares_re_${Date.now()}.jpg`;
      const aerialFile = new File([aerialBlob], fileName, { type: 'image/jpeg' });
      const uploadRes = await base44.integrations.Core.UploadFile({ file: aerialFile });
      const newAnnotatedUrl = uploadRes.file_url;

      const newSectionNames = adjustedSections.map(s => s.name).filter(Boolean);
      const newAiNotes = `Detected sections: ${newSectionNames.join(', ') || 'none'}. Scale: ${scaleNote}.`;

      // Build a rename map: oldName → newName for any sections whose name changed.
      // Sections are matched by index since the adjuster preserves their order.
      const originalSections = photo.detected_sections || [];
      const renameMap = {};
      originalSections.forEach((orig, i) => {
        const adjusted = adjustedSections[i];
        if (adjusted && orig.name && adjusted.name && orig.name !== adjusted.name) {
          renameMap[orig.name] = adjusted.name;
        }
      });

      const updatedPhotos = inspection.photos.map((p, i) => {
        if (i === photoIdx) {
          return { ...p, annotated_url: newAnnotatedUrl, detected_sections: adjustedSections, ai_notes: newAiNotes };
        }
        // Propagate renames to other aerial photos that share the same section names
        if (!Array.isArray(p.detected_sections) || Object.keys(renameMap).length === 0) return p;
        const renamedSections = p.detected_sections.map(s =>
          s.name && renameMap[s.name] ? { ...s, name: renameMap[s.name] } : s
        );
        const hasChange = renamedSections.some((s, idx) => s !== p.detected_sections[idx]);
        if (!hasChange) return p;
        // Also refresh ai_notes so per-photo summaries stay in sync with renamed sections
        const updatedNames = renamedSections.map(s => s.name).filter(Boolean);
        const updatedNotes = (p.ai_notes || '').replace(
          /Detected sections:[^.]*\./,
          `Detected sections: ${updatedNames.join(', ') || 'none'}.`
        );
        return { ...p, detected_sections: renamedSections, ai_notes: updatedNotes };
      });
      await base44.entities.DroneInspection.update(inspection.id, { photos: updatedPhotos });
      queryClient.invalidateQueries({ queryKey: ['drone-inspections'] });

      // Recompute aerialDetectedSections from the full updated photo list so that
      // names from other aerial photos in the same inspection are preserved.
      // Always update (even to empty) so the section picker reflects add/remove changes.
      const allSectionNames = updatedPhotos
        .filter(p => Array.isArray(p.detected_sections))
        .flatMap(p => p.detected_sections.map(s => s.name).filter(Boolean));
      setAerialDetectedSections([...new Set(allSectionNames)]);

      toast.success(t.inspections.squaresUpdated || 'Test squares updated');
    } catch (err) {
      console.error('Edit squares failed:', err);
      toast.error(t.inspections.squaresUpdateFailed || 'Failed to update test squares');
    } finally {
      setEditSquaresLoading(false);
      setEditSquaresPhoto(null);
    }
  };

  return (
    <>
    {/* ── Aerial square adjuster overlay (shown mid-analysis when AI returns sections) ── */}
    {aerialAdjustRequest && (
      <AerialSquareAdjuster
        imageUrl={aerialAdjustRequest.imageUrl}
        sections={aerialAdjustRequest.sections}
        normPpf={aerialAdjustRequest.normPpf}
        scaleNote={aerialAdjustRequest.scaleNote}
        onConfirm={(adjustedSections) => {
          aerialAdjustRequest.resolve(adjustedSections);
          setAerialAdjustRequest(null);
        }}
        onCancel={() => {
          aerialAdjustRequest.reject(new Error('cancelled'));
          setAerialAdjustRequest(null);
        }}
      />
    )}

    {/* ── Re-edit squares overlay for a saved aerial photo ── */}
    {editSquaresPhoto && !editSquaresLoading && (
      <AerialSquareAdjuster
        imageUrl={editSquaresPhoto.photo.url}
        sections={editSquaresPhoto.photo.detected_sections}
        normPpf={editSquaresPhoto.photo.norm_ppf || 20}
        scaleNote={editSquaresPhoto.photo.scale_note || 'AI estimated'}
        onConfirm={handleEditSquaresConfirm}
        onCancel={() => setEditSquaresPhoto(null)}
      />
    )}

    {/* ── Saving indicator while edit-squares regeneration is in progress ── */}
    {editSquaresLoading && (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 12, color: '#fff'
      }}>
        <Loader2 className="w-10 h-10 animate-spin" />
        <p style={{ fontSize: 15, fontWeight: 600 }}>
          {t.inspections.regeneratingSquares || 'Regenerating annotated image…'}
        </p>
      </div>
    )}

    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Camera className="w-8 h-8 text-blue-600" />
            {t.sidebar.aiDamageAnalysis}
          </h1>
          <p className="text-gray-500 mt-1">{t.inspections.aiDamageAnalysisDesc || "AI-powered storm damage detection from drone & inspection photos"}</p>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Button
            variant="outline"
            onClick={() => setShowReferenceDialog(true)}
            className="border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {t.inspections.trainAi || "Train AI"} ({referencePhotos.length} {t.common.examples || "examples"})
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowInstructions(!showInstructions)}
          >
            <Eye className="w-4 h-4 mr-2" />
            {t.common.howItWorks || "How It Works"}
          </Button>
          <Button
            variant="secondary"
            onClick={handleTestReport}
            disabled={generatingTest}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800"
          >
            {generatingTest ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
            {t.reports.testPdf || "Test PDF"}
          </Button>
          <Dialog open={showDialog} onOpenChange={(open) => {
            setShowDialog(open);
            if (!open) {
              setEditingInspection(null);
              setAerialDetectedSections([]);
            }
          }}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                <Plus className="w-4 h-4 mr-2" />
                {t.inspections.newDroneAnalysis || "New Drone Analysis"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  {editingInspection
                    ? (t.inspections.addPhotosToInspection || "Add Photos to Inspection")
                    : (t.inspections.newDroneInspectionAnalysis || "New Drone Inspection Analysis")}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {uploadStatus && (
                  <Alert variant={uploadStatus.type === 'error' ? 'destructive' : 'default'}
                         className={uploadStatus.type === 'success' ? 'bg-green-50 border-green-200' : ''}>
                    <AlertDescription className={uploadStatus.type === 'success' ? 'text-green-800' : ''}>
                      {uploadStatus.type === 'success' && <CheckCircle2 className="w-4 h-4 inline mr-2" />}
                      {uploadStatus.message}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-4">
                  <div>
                    <Label>{t.common.customerName || "Customer Name"}</Label>
                    <Input
                      value={formData.customer_name}
                      onChange={(e) => {
                        const newName = e.target.value;
                        let newAddress = formData.property_address;
                        
                        const matchedCustomer = customers.find(c => c.name.toLowerCase() === newName.toLowerCase());
                        if (matchedCustomer) {
                          const constructedAddress = matchedCustomer.street 
                            ? `${matchedCustomer.street}, ${matchedCustomer.city || ''}, ${matchedCustomer.state || ''} ${matchedCustomer.zip || ''}`.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim()
                            : matchedCustomer.address;
                            
                          if (constructedAddress) {
                            newAddress = constructedAddress;
                            toast.success(`📍 Address found for ${matchedCustomer.name}`);
                          }
                        }
                        
                        setFormData({...formData, customer_name: newName, property_address: newAddress});
                      }}
                      placeholder={t.customers.enterCustomerName || "Enter customer name"}
                      list="customers-list"
                    />
                    <datalist id="customers-list">
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.name} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <Label>{t.inspections.propertyAddress || "Property Address"} *</Label>
                    <Input
                      value={formData.property_address}
                      onChange={(e) => setFormData({...formData, property_address: e.target.value})}
                      placeholder={t.inspections.enterPropertyAddress || "Enter property address..."}
                    />
                  </div>

                  {/* Loading State */}
                  {loadingSatellite && (
                    <div className="text-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
                      <p className="text-sm font-medium text-gray-900">{t.common.loadingSatellite || "Loading satellite view..."}</p>
                      <p className="text-xs text-gray-500 mt-1">{t.common.pleaseWait || "Please wait"}</p>
                    </div>
                  )}

                  {/* Satellite View with AI Analysis */}
                  {satelliteData && !loadingSatellite && (
                    <div className="space-y-4">
                      <div className="relative">
                        <img 
                          src={satelliteData.satellite_image_url} 
                          alt="Satellite view"
                          className="w-full rounded-lg border-2 border-blue-300"
                        />
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-full">
                          <MapPin className="w-12 h-12 text-red-600 drop-shadow-lg" fill="#ef4444" />
                        </div>
                        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg max-w-[80%]">
                          <p className="text-sm font-semibold text-gray-900">{formData.property_address}</p>
                        </div>
                      </div>

                      {/* AI Roof Analysis Results */}
                      {satelliteData.roof_layout_analysis && (
                        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border-2 border-purple-300">
                          <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-purple-600" />
                            {t.inspections.aiRoofAnalysis || "AI Roof Analysis"}
                          </h4>

                          {satelliteData.roof_layout_analysis.ai_description && (
                            <p className="text-sm text-gray-700 mb-3">{satelliteData.roof_layout_analysis.ai_description}</p>
                          )}

                          {satelliteData.roof_layout_analysis.sections_identified && satelliteData.roof_layout_analysis.sections_identified.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-gray-800">{t.inspections.identifiedRoofSections || "Identified Roof Sections"}:</p>
                              <div className="grid grid-cols-2 gap-2">
                                {satelliteData.roof_layout_analysis.sections_identified.map((section, idx) => (
                                  <div key={idx} className="bg-white rounded p-2 border border-purple-200">
                                    <p className="font-medium text-sm">{section.section_name}</p>
                                    <p className="text-xs text-gray-600">{section.orientation}</p>
                                    <p className="text-xs text-gray-500">{section.description}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t.inspections.inspectionSource || "Inspection Source"}</Label>
                    <Select 
                      value={formData.inspection_type} 
                      onValueChange={(val) => setFormData({...formData, inspection_type: val})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="drone">{t.inspections.droneAerial || "Drone / Aerial"}</SelectItem>
                        <SelectItem value="physical">{t.inspections.physicalOnRoof || "Physical / On-Roof (Chalk Marks)"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t.inspections.inspectionDate || "Inspection Date"}</Label>
                    <Input
                      type="date"
                      value={formData.inspection_date}
                      onChange={(e) => setFormData({...formData, inspection_date: e.target.value})}
                    />
                  </div>
                </div>
                
                <div>
                  <Label>{t.inspections.weatherConditions || "Weather Conditions"}</Label>
                  <Input
                    value={formData.weather_conditions}
                    onChange={(e) => setFormData({...formData, weather_conditions: e.target.value})}
                    placeholder={t.inspections.weatherConditionsPlaceholder || "Sunny, clear visibility"}
                  />
                </div>

                <div>
                  <Label>{t.common.notes || "Notes"}</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    rows={2}
                    placeholder={t.inspections.additionalInspectionNotes || "Additional inspection notes..."}
                  />
                </div>

                <div>
                  <Label>{t.inspections.relatedStormEvent || "Related Storm Event"} ({t.common.optional || "Optional"})</Label>
                  <Select 
                    value={formData.storm_event_id} 
                    onValueChange={(val) => setFormData({...formData, storm_event_id: val})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.inspections.selectStormEvent || "Select storm event..."} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>{t.common.none || "None"}</SelectItem>
                      {stormEvents.map((storm) => (
                        <SelectItem key={storm.id} value={storm.id}>
                          {storm.title} - {storm.event_type} ({format(new Date(storm.start_time), 'MMM d, yyyy')})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">{t.inspections.linkInspectionToStormDesc || "Link this inspection to a storm event for report inclusion"}</p>
                </div>

                <div className="border-2 border-dashed border-blue-300 rounded-lg p-6 bg-blue-50">
                  <div className="text-center mb-4">
                    <Upload className="w-12 h-12 mx-auto mb-2 text-blue-600" />
                    <h3 className="font-semibold text-lg mb-1">{t.inspections.uploadDronePhotos || "Upload Drone/Inspection Photos"}</h3>
                    <p className="text-sm text-gray-600">{t.inspections.selectMultiplePhotosDesc || "Select multiple photos for AI damage analysis"}</p>
                  </div>

                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                    multiple
                    onChange={handlePhotoSelect}
                    className="hidden"
                    id="drone-photos"
                    disabled={uploading}
                  />

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full mb-3"
                    onClick={() => document.getElementById('drone-photos')?.click()}
                    disabled={uploading}
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    {t.inspections.selectPhotos || "Select Photos"}
                  </Button>

                  {selectedPhotos.length > 0 && (
                    <div className="bg-white rounded-lg p-4 space-y-4">
                      {/* Bulk Actions Header */}
                      <div className="flex flex-col gap-3 pb-3 border-b">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <input 
                              type="checkbox" 
                              className="w-4 h-4 rounded border-gray-300"
                              checked={selectedPhotos.length > 0 && selectedPhotoIds.size === selectedPhotos.length}
                              onChange={toggleSelectAll}
                            />
                            <p className="font-medium text-sm text-gray-700">
                              {t.common.selectAll || "Select All"} ({selectedPhotos.length} {t.inspections.photos || "Photos"})
                            </p>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => { setSelectedPhotos([]); setAerialDetectedSections([]); setSelectedPhotoIds(new Set()); }}
                            className="text-red-600 h-8"
                          >
                            {t.common.clearList || "Clear List"}
                          </Button>
                        </div>

                        {selectedPhotoIds.size > 0 && (
                          <div className="bg-blue-50 p-3 rounded-md border border-blue-100 flex flex-col md:flex-row gap-3 items-end md:items-center">
                            <span className="text-xs font-semibold text-blue-800 whitespace-nowrap">
                              {t.inspections.bulkEdit || "Bulk Edit"} ({selectedPhotoIds.size}):
                            </span>
                            <div className="flex-1 w-full grid grid-cols-2 gap-2">
                              {(aerialDetectedSections.length > 0 || satelliteData?.roof_layout_analysis?.sections_identified) ? (
                                <Select onValueChange={(val) => handleBulkUpdate('section', val)}>
                                  <SelectTrigger className="h-8 bg-white text-xs">
                                    <SelectValue placeholder={t.inspections.setSection || "Set Section..."} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {aerialDetectedSections.map((name) => (
                                      <SelectItem key={`bulk-aerial-${name}`} value={name}>{name}</SelectItem>
                                    ))}
                                    {satelliteData?.roof_layout_analysis?.sections_identified?.filter(
                                      (s) => !aerialDetectedSections.includes(s.section_name)
                                    ).map((section) => (
                                      <SelectItem key={`bulk-sat-${section.section_name}`} value={section.section_name}>
                                        {section.section_name} ({section.orientation})
                                      </SelectItem>
                                    ))}
                                    <SelectItem value="General">{t.common.general || "General"}</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  className="h-8 bg-white text-xs"
                                  placeholder={t.inspections.setSectionFreeText || "Set Section (e.g. North Slope)..."}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && e.currentTarget.value) handleBulkUpdate('section', e.currentTarget.value);
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value) handleBulkUpdate('section', e.target.value);
                                  }}
                                  data-testid="input-bulk-section"
                                />
                              )}
                              <div className="flex gap-1">
                                <Input 
                                  placeholder={t.inspections.setNotes || "Set Notes..."} 
                                  className="h-8 bg-white text-xs"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleBulkUpdate('notes', e.currentTarget.value);
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value) handleBulkUpdate('notes', e.target.value);
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="space-y-4">
                        {selectedPhotos.map((photo) => (
                          <div 
                            key={photo.id} 
                            className={`flex gap-4 p-3 border rounded-lg transition-colors ${
                              selectedPhotoIds.has(photo.id) ? 'bg-blue-50 border-blue-300' : 'bg-gray-50'
                            }`}
                          >
                            <div className="flex flex-col justify-center">
                              <input 
                                type="checkbox" 
                                className="w-5 h-5 rounded border-gray-300 cursor-pointer"
                                checked={selectedPhotoIds.has(photo.id)}
                                onChange={() => toggleSelection(photo.id)}
                              />
                            </div>

                            <div className="relative w-32 h-32 flex-shrink-0 bg-gray-200 rounded-md overflow-hidden group">
                              <img
                                src={photo.preview}
                                alt={photo.file.name}
                                className="w-full h-full object-cover"
                              />
                              <button
                                onClick={() => removePhoto(photo.id)}
                                className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                            
                            <div className="flex-1 space-y-3">
                              <div>
                                <Label className="text-xs text-gray-500">{t.inspections.photoType || "Photo Type"}</Label>
                                <Select 
                                  value={photo.photo_type || 'roof_closeup'} 
                                  onValueChange={(val) => updatePhotoMetadata(photo.id, 'photo_type', val)}
                                >
                                  <SelectTrigger className="h-8 mt-1">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="overhead_aerial">Overhead / Aerial (Test Squares)</SelectItem>
                                    <SelectItem value="roof_closeup">{t.inspections.roofCloseup || "Roof Close-up (Test Square)"}</SelectItem>
                                    <SelectItem value="elevation_wide">{t.inspections.elevationWideAngle || "Elevation Wide-Angle (Siding)"}</SelectItem>
                                    <SelectItem value="general_overview">{t.inspections.generalOverview || "General Overview"}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <Label className="text-xs text-gray-500 flex items-center gap-1">
                                  {t.inspections.roofSlopeSection || "Roof Slope / Section"}
                                  {photo.section_auto_assigned && (
                                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium" data-testid={`badge-auto-section-${photo.id}`}>Auto</span>
                                  )}
                                </Label>
                                {(aerialDetectedSections.length > 0 || satelliteData?.roof_layout_analysis?.sections_identified) ? (
                                  <Select 
                                    value={photo.section} 
                                    onValueChange={(val) => {
                                      setSelectedPhotos(prev => prev.map(p =>
                                        p.id === photo.id ? { ...p, section: val, section_auto_assigned: false, section_manually_set: true } : p
                                      ));
                                    }}
                                  >
                                    <SelectTrigger className="h-8 mt-1" data-testid={`select-section-${photo.id}`}>
                                      <SelectValue placeholder={t.inspections.selectSection || "Select section..."} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {aerialDetectedSections.map((name) => (
                                        <SelectItem key={`aerial-${name}`} value={name}>{name}</SelectItem>
                                      ))}
                                      {satelliteData?.roof_layout_analysis?.sections_identified?.filter(
                                        (s) => !aerialDetectedSections.includes(s.section_name)
                                      ).map((section) => (
                                        <SelectItem key={`sat-${section.section_name}`} value={section.section_name}>
                                          {section.section_name} ({section.orientation})
                                        </SelectItem>
                                      ))}
                                      <SelectItem value="General">{t.common.general || "General"}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Input
                                    className="h-8 mt-1 text-sm"
                                    placeholder={t.inspections.roofSlopeSectionPlaceholder || "e.g. North Slope, Front Elevation..."}
                                    value={photo.section || ''}
                                    onChange={(e) => {
                                      setSelectedPhotos(prev => prev.map(p =>
                                        p.id === photo.id ? { ...p, section: e.target.value, section_manually_set: true } : p
                                      ));
                                    }}
                                    data-testid={`input-section-${photo.id}`}
                                  />
                                )}
                              </div>
                              
                              <div>
                                <Label className="text-xs text-gray-500">{t.inspections.notesManualCrewCam || "Notes (Manual or PhotoSync)"}</Label>
                                <Input 
                                  value={photo.notes}
                                  onChange={(e) => updatePhotoMetadata(photo.id, 'notes', e.target.value)}
                                  placeholder={t.inspections.hailHitsPlaceholder || "e.g. 5 hail hits in test square..."}
                                  className="h-8 mt-1 text-sm"
                                />
                              </div>
                              {photo.photo_type === 'overhead_aerial' && (
                                <div className="bg-blue-50 border border-blue-200 rounded-md p-2">
                                  <Label className="text-xs text-blue-700 font-medium">Approximate Roof Width (ft) — optional but improves accuracy</Label>
                                  <Input
                                    type="number"
                                    min="10"
                                    max="200"
                                    step="1"
                                    value={photo.roof_width_ft || ''}
                                    onChange={(e) => updatePhotoMetadata(photo.id, 'roof_width_ft', e.target.value ? parseFloat(e.target.value) : null)}
                                    placeholder="e.g. 42"
                                    className="h-8 mt-1 text-sm"
                                    data-testid={`input-roof-width-${photo.id}`}
                                  />
                                  <p className="text-[10px] text-blue-600 mt-1">AI will draw 10'×10' squares sized to this span</p>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-200">
                  <h4 className="font-semibold flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    AI Analysis Features
                  </h4>
                  <ul className="text-sm text-gray-700 space-y-1">
                    <li className="flex items-center gap-2">
                      <CloudHail className="w-4 h-4 text-blue-600" />
                      Hail damage detection (impact marks, granule loss)
                    </li>
                    <li className="flex items-center gap-2">
                      <Wind className="w-4 h-4 text-green-600" />
                      Wind damage detection (missing/lifted shingles)
                    </li>
                    <li className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-orange-600" />
                      Severity assessment & cost estimation
                    </li>
                    <li className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-600" />
                      Downloadable PDF reports
                    </li>
                    <li className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-green-600" />
                      One-click estimate creation
                    </li>
                  </ul>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowDialog(false);
                      setSelectedPhotos([]);
                      setAerialDetectedSections([]);
                      setUploadStatus(null);
                      setEditingInspection(null);
                      setFormData({
                        property_address: "",
                        customer_name: "",
                        inspection_date: localToday(),
                        inspection_type: "drone",
                        weather_conditions: "",
                        notes: "",
                        storm_event_id: ""
                      });
                    }}
                    disabled={uploading}
                  >
                    {t.common.cancel || "Cancel"}
                  </Button>
                  <Button
                    onClick={analyzeDronePhotos}
                    disabled={uploading || selectedPhotos.length === 0 || !formData.property_address}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t.ai.analyzing || "Analyzing..."}
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        {t.inspections.analyzeWithAi || "Analyze with AI"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Report Configuration Dialog */}
          <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{t.inspections.generateInspectionReport || "Generate Inspection Report"}</DialogTitle>
              </DialogHeader>
              
              <div className="space-y-6 py-4">
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-gray-900 border-b pb-2">{t.inspections.damageThresholds || "Damage Thresholds"}</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>{t.inspections.hailHitsSquare || "Hail Hits / Square"}</Label>
                      <Input 
                        type="number" 
                        value={reportConfig.hailThreshold}
                        onChange={(e) => setReportConfig({...reportConfig, hailThreshold: parseInt(e.target.value) || 0})}
                      />
                      <p className="text-xs text-gray-500 mt-1">{t.common.standard || "Standard"}: 7-10 hits</p>
                    </div>
                    <div>
                      <Label>{t.inspections.windDamagedShinglesSquare || "Wind Damaged Shingles / Square"}</Label>
                      <Input 
                        type="number" 
                        value={reportConfig.windThreshold}
                        onChange={(e) => setReportConfig({...reportConfig, windThreshold: parseInt(e.target.value) || 0})}
                      />
                      <p className="text-xs text-gray-500 mt-1">{t.common.standard || "Standard"}: 3-5 shingles</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-gray-900 border-b pb-2">{t.inspections.materialMatching || "Material Matching (ITEL & Code)"}</h4>

                  {reportConfig.detectedState && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-sm text-green-900">
                        <span className="font-semibold">📍 {t.common.detectedState || "Detected State"}:</span> {reportConfig.detectedState}
                      </p>
                    </div>
                  )}

                  <div>
                    <Label>{t.inspections.itelReportStatus || "ITEL Report Status"}</Label>
                    <Select 
                      value={reportConfig.itelStatus} 
                      onValueChange={(val) => setReportConfig({...reportConfig, itelStatus: val})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t.common.notPerformed || "Not Performed / N/A"}</SelectItem>
                        <SelectItem value="match_found">{t.inspections.matchFoundRepairable || "Match Found (Repairable)"}</SelectItem>
                        <SelectItem value="no_match">{t.inspections.noMatchAvailableDiscontinued || "No Match Available (Discontinued)"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {reportConfig.itelStatus === 'no_match' && (
                    <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <input
                        type="checkbox"
                        id="ohioCode"
                        className="mt-1"
                        checked={reportConfig.applyOhioCode}
                        onChange={(e) => setReportConfig({...reportConfig, applyOhioCode: e.target.checked})}
                      />
                      <label htmlFor="ohioCode" className="text-sm cursor-pointer">
                        <span className="font-semibold block text-blue-900">
                          {t.inspections.applyStateMatchingCode || `Apply ${reportConfig.detectedState || 'State'} Matching Code?`}
                        </span>
                        <span className="text-blue-700">
                          {reportConfig.detectedState 
                            ? `${t.inspections.applyStateMatchingCodeDesc || `Apply ${reportConfig.detectedState} building code for reasonably uniform appearance. This will recommend replacement if materials don't match.`}`
                            : (t.inspections.applyStateMatchingCodeDescGeneral || 'Reference building code for reasonably uniform appearance. This will recommend replacement if materials don\'t match.')}
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setShowReportDialog(false)}>{t.common.cancel || "Cancel"}</Button>
                <Button onClick={confirmGenerateReport} className="bg-blue-600 hover:bg-blue-700">
                  {t.reports.generatePdf || "Generate PDF"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Storm Event Linking Dialog */}
          <Dialog open={showStormLinkDialog} onOpenChange={setShowStormLinkDialog}>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Link2 className="w-5 h-5 text-blue-600" />
                  {t.inspections.linkStormEventToInspection || "Link Storm Event to Inspection"}
                </DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t.common.searchByLocation || "Search by Location"}</Label>
                    <Input
                      placeholder="e.g., Ohio, Cleveland..."
                      value={stormSearchLocation}
                      onChange={(e) => setStormSearchLocation(e.target.value)}
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t.common.searchLocationDesc || "Type a state, city, or location"}
                    </p>
                  </div>
                  <div>
                    <Label>{t.common.searchByDateRange || "Search by Date Range"}</Label>
                    <Input
                      type="date"
                      value={stormSearchDate}
                      onChange={(e) => setStormSearchDate(e.target.value)}
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t.common.defaultLastYear || "Default: Last 365 days"}
                    </p>
                  </div>
                </div>

                {(stormSearchLocation || stormSearchDate) && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 flex items-center justify-between">
                    <p className="text-sm text-blue-900">
                      {stormEvents.length} {t.common.stormsFound || "storms found"}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setStormSearchLocation('');
                        setStormSearchDate('');
                      }}
                      className="text-blue-600 hover:text-blue-700 h-6 text-xs"
                    >
                      {t.common.clearFilters || "Clear Filters"}
                    </Button>
                  </div>
                )}

                <div>
                  <Label>{t.inspections.selectStormEvent || "Select Storm Event"}</Label>
                  <Select 
                    value={selectedInspectionForStorm?.storm_event_id || ""} 
                    onValueChange={(val) => {
                      if (selectedInspectionForStorm) {
                        updateStormLinkMutation.mutate({
                          inspectionId: selectedInspectionForStorm.id,
                          stormEventId: val
                        });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.inspections.selectAStorm || "Select a storm..."} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>{t.common.noneRemoveLink || "None (Remove Link)"}</SelectItem>
                      {stormEvents.map((storm) => (
                        <SelectItem key={storm.id} value={storm.id}>
                          <div className="flex flex-col">
                            <span className="font-medium">{storm.title}</span>
                            <span className="text-xs text-gray-500">
                              {storm.event_type} - {storm.severity} - {format(new Date(storm.start_time), 'MMM d, yyyy')}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-2">
                    {t.inspections.stormDetailsIncludedDesc || "The storm details will be included in the PDF report"}
                  </p>
                </div>

                {selectedInspectionForStorm?.storm_event_id && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-900">
                      ✅ {t.inspections.stormLinkedSuccess || "Storm linked! The report will include storm event details."}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setShowStormLinkDialog(false)}>
                  {t.common.close || "Close"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Reference Photos Training Dialog */}
          <Dialog open={showReferenceDialog} onOpenChange={setShowReferenceDialog}>
            <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  {t.inspections.trainAiWithReferencePhotos || "Train AI with Reference Photos"}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6">
                <Alert className="bg-purple-50 border-purple-200">
                  <AlertDescription className="text-purple-900">
                    <strong>{t.inspections.uploadClearExamples || "Upload clear examples"}</strong> {t.inspections.damageReferenceDesc || "of damage types. The AI will visually compare inspection photos against these references for better accuracy."}
                  </AlertDescription>
                </Alert>

                {/* Testing Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white rounded-lg p-3 border">
                    <p className="text-xs text-gray-500 mb-1">{t.common.totalReferences || "Total References"}</p>
                    <p className="text-2xl font-bold text-purple-700">{referencePhotos.length}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border">
                    <p className="text-xs text-gray-500 mb-1">{t.common.verifiedGold || "Verified (Gold)"}</p>
                    <p className="text-2xl font-bold text-blue-700">{referencePhotos.filter(p => p.is_verified).length}</p>
                  </div>
                  {testResults && (
                    <>
                      <div className="bg-white rounded-lg p-3 border">
                        <p className="text-xs text-gray-500 mb-1">{t.inspections.hailAccuracy || "Hail Accuracy"}</p>
                        <p className="text-2xl font-bold text-green-700">{testResults.summary.avg_hail_accuracy}%</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border">
                        <p className="text-xs text-gray-500 mb-1">{t.inspections.windAccuracy || "Wind Accuracy"}</p>
                        <p className="text-2xl font-bold text-green-700">{testResults.summary.avg_wind_accuracy}%</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Test Button */}
                <Button
                  onClick={handleRunAccuracyTest}
                  disabled={runningTest || referencePhotos.filter(p => p.is_verified).length === 0}
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  {runningTest ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t.inspections.runningAccuracyTest || "Running Accuracy Test..."}
                    </>
                  ) : (
                    <>
                      <FlaskConical className="w-4 h-4 mr-2" />
                      {t.inspections.runAiAccuracyTest || "Run AI Accuracy Test"} ({referencePhotos.filter(p => p.is_verified).length} {t.common.verifiedPhotos || "verified photos"})
                    </>
                  )}
                </Button>

                {testResults && (
                  <div className="bg-blue-50 border border-blue-300 rounded-lg p-4">
                    <h4 className="font-semibold text-blue-900 mb-3">{t.common.testResults || "Test Results"}:</h4>
                    <div className="space-y-2 text-sm">
                      <div className="grid grid-cols-2 gap-3">
                        <div>✅ {t.common.testsCompleted || "Tests Completed"}: <strong>{testResults.summary.tests_completed}</strong></div>
                        <div>📊 {t.common.avgConfidence || "Avg Confidence"}: <strong>{testResults.summary.avg_confidence}%</strong></div>
                        <div>🎯 {t.inspections.hailAccuracy || "Hail Accuracy"}: <strong>{testResults.summary.avg_hail_accuracy}%</strong></div>
                        <div>💨 {t.inspections.windAccuracy || "Wind Accuracy"}: <strong>{testResults.summary.avg_wind_accuracy}%</strong></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Upload Form */}
                <div className="bg-gray-50 rounded-lg p-4 border-2 border-dashed border-gray-300">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>{t.inspections.damageType || "Damage Type"} *</Label>
                        <Select 
                          value={referenceForm.damage_type} 
                          onValueChange={(val) => setReferenceForm({...referenceForm, damage_type: val, custom_damage_type: ''})}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="wind_crease">{t.inspections.windCreasesShingles || "Wind Creases (Shingles)"}</SelectItem>
                            <SelectItem value="hail_shingle">{t.inspections.hailHitsShingles || "Hail Hits (Shingles)"}</SelectItem>
                            <SelectItem value="missing_shingle">{t.inspections.missingShingles || "Missing Shingles"}</SelectItem>
                            <SelectItem value="soft_metal_hail">{t.inspections.softMetalDings || "Soft Metal Dings (Vents/Flashing)"}</SelectItem>
                            <SelectItem value="gutter_dent">{t.inspections.gutterDents || "Gutter Dents"}</SelectItem>
                            <SelectItem value="siding_dent">{t.inspections.sidingDamage || "Siding Damage"}</SelectItem>
                            <SelectItem value="garage_door_dent">{t.inspections.garageDoorDents || "Garage Door Dents"}</SelectItem>
                            <SelectItem value="fence_damage">{t.inspections.fenceDamage || "Fence Damage"}</SelectItem>
                            <SelectItem value="window_screen">{t.inspections.windowScreenDamage || "Window Screen Damage"}</SelectItem>
                            <SelectItem value="custom">+ {t.common.customType || "Custom Type"} ({t.common.typeBelow || "Type Below"})</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>{t.common.description || "Description"}</Label>
                        <Input 
                          value={referenceForm.description}
                          onChange={(e) => setReferenceForm({...referenceForm, description: e.target.value})}
                          placeholder={t.inspections.descriptionPlaceholder || "e.g., Clear wind crease example"}
                        />
                      </div>
                    </div>
                    
                    {referenceForm.damage_type === 'custom' && (
                      <div>
                        <Label>{t.inspections.customDamageTypeName || "Custom Damage Type Name"} *</Label>
                        <Input 
                          value={referenceForm.custom_damage_type}
                          onChange={(e) => setReferenceForm({...referenceForm, custom_damage_type: e.target.value})}
                          placeholder={t.inspections.customDamageTypePlaceholder || "e.g., Awning Damage, AC Unit Dent, Mailbox..."}
                          className="border-purple-300"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          {t.inspections.customDamageTypeDesc || "Type any damage category to train the AI (e.g., \"Fascia Damage\", \"Soffit Holes\", \"Chimney Cap\")"}
                        </p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length > 0) {
                          setUploadingReference(true);
                          for (const file of files) {
                            await uploadReferenceMutation.mutateAsync({
                              file,
                              damage_type: referenceForm.damage_type,
                              custom_damage_type: referenceForm.custom_damage_type,
                              description: referenceForm.description
                            });
                          }
                          setUploadingReference(false);
                          e.target.value = '';
                        }
                      }}
                      className="hidden"
                      id="reference-upload"
                      disabled={uploadingReference}
                    />
                    <Button
                      onClick={() => document.getElementById('reference-upload')?.click()}
                      disabled={uploadingReference || (referenceForm.damage_type === 'custom' && !referenceForm.custom_damage_type.trim())}
                      className="w-full bg-purple-600 hover:bg-purple-700"
                    >
                      {uploadingReference ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t.common.uploading || "Uploading..."}
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          {t.inspections.uploadReferencePhoto || "Upload Reference Photo"}
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Reference Photo Gallery */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{t.inspections.currentReferencePhotos || "Current Reference Photos"} ({referencePhotos.length})</h3>
                      <p className="text-sm text-gray-600">{t.inspections.currentReferencePhotosDesc || "Click a photo to verify, or select multiple to delete in bulk"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedRefIds.size === 0 ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const ids = referencePhotos.slice(0, 25).map(r => r.id);
                              setSelectedRefIds(new Set(ids));
                            }}
                            disabled={referencePhotos.length < 1}
                          >
                            {t.common.selectN || "Select"} 25
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const ids = referencePhotos.slice(0, 50).map(r => r.id);
                              setSelectedRefIds(new Set(ids));
                            }}
                            disabled={referencePhotos.length < 1}
                          >
                            {t.common.selectN || "Select"} 50
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const ids = referencePhotos.slice(0, 100).map(r => r.id);
                              setSelectedRefIds(new Set(ids));
                            }}
                            disabled={referencePhotos.length < 1}
                          >
                            {t.common.selectN || "Select"} 100
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const ids = referencePhotos.map(r => r.id);
                              setSelectedRefIds(new Set(ids));
                            }}
                            disabled={referencePhotos.length < 1}
                          >
                            {t.common.selectAll || "Select All"}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Select value={bulkLabelType} onValueChange={setBulkLabelType}>
                            <SelectTrigger className="w-48">
                              <SelectValue placeholder={t.inspections.selectLabel || "Select label..."} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="hail_shingle">{t.inspections.hailShingle || "Hail (Shingles)"}</SelectItem>
                              <SelectItem value="wind_crease">{t.inspections.windCrease || "Wind Creases"}</SelectItem>
                              <SelectItem value="missing_shingles">Missing Shingles</SelectItem>
                              <SelectItem value="hail_siding">Hail (Siding)</SelectItem>
                              <SelectItem value="wind_siding">Wind (Siding)</SelectItem>
                              <SelectItem value="damaged_flashing">Damaged Flashing</SelectItem>
                              <SelectItem value="damaged_gutters">Damaged Gutters</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => {
                              if (!bulkLabelType) {
                                toast.error('Please select a label first');
                                return;
                              }
                              bulkLabelReferencesMutation.mutate({
                                ids: Array.from(selectedRefIds),
                                damageType: bulkLabelType
                              });
                            }}
                            disabled={bulkLabelReferencesMutation.isPending || !bulkLabelType}
                          >
                            Label {selectedRefIds.size} Selected
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedRefIds(new Set())}
                          >
                            Clear
                          </Button>
                          <BulkDeleteButton
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (window.confirm(`Delete ${selectedRefIds.size} reference photos?`)) {
                                bulkDeleteReferencesMutation.mutate(Array.from(selectedRefIds));
                              }
                            }}
                            disabled={bulkDeleteReferencesMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </BulkDeleteButton>
                        </>
                      )}
                    </div>
                  </div>
                  {referencePhotos.length === 0 ? (
                    <p className="text-gray-500 text-sm italic">No reference photos yet. Upload examples above.</p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {referencePhotos.map((ref) => (
                        <div 
                          key={ref.id} 
                          className="relative group border rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
                        >
                          <div
                            className="cursor-pointer"
                            onClick={() => {
                              setSelectedRefPhoto(ref);
                              setVerifyForm({
                                hail_count: ref.verified_hail_count || 0,
                                wind_count: ref.verified_wind_count || 0
                              });
                              setImageZoom(1);
                              setImagePan({ x: 0, y: 0 });
                            }}
                          >
                            <img 
                              src={ref.photo_url} 
                              alt={ref.description}
                              className="w-full h-32 object-cover"
                            />
                          </div>
                          {ref.is_verified && (
                            <div className="absolute top-2 left-2 bg-green-600 text-white rounded-full p-1">
                              <CheckCircle2 className="w-4 h-4" />
                            </div>
                          )}
                          <div className="absolute top-2 right-2">
                            <input
                              type="checkbox"
                              checked={selectedRefIds.has(ref.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                const newIds = new Set(selectedRefIds);
                                if (newIds.has(ref.id)) {
                                  newIds.delete(ref.id);
                                } else {
                                  newIds.add(ref.id);
                                }
                                setSelectedRefIds(newIds);
                              }}
                              className="w-5 h-5 rounded border-2 border-white shadow-lg cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                          <div className="p-2 bg-white">
                            <Badge className="text-xs" variant="outline">
                              {ref.damage_type.replace(/_/g, ' ')}
                            </Badge>
                            {ref.is_verified && (
                              <div className="flex gap-1 mt-1">
                                <Badge className="text-xs bg-green-50 text-green-700">
                                  {ref.verified_hail_count || 0} H
                                </Badge>
                                <Badge className="text-xs bg-blue-50 text-blue-700">
                                  {ref.verified_wind_count || 0} W
                                </Badge>
                              </div>
                            )}
                            {ref.description && (
                              <p className="text-xs text-gray-600 mt-1 truncate">{ref.description}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Verify Reference Photo Dialog */}
          <Dialog open={!!selectedRefPhoto} onOpenChange={() => {
            setSelectedRefPhoto(null);
            setImageZoom(1);
            setImagePan({ x: 0, y: 0 });
          }}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-purple-600" />
                  Verify Ground Truth Counts
                </DialogTitle>
              </DialogHeader>
              
              {selectedRefPhoto && (
                <>
                  <div className="flex-1 overflow-y-auto space-y-4 px-1">
                    <div className="relative bg-gray-100 rounded-lg overflow-hidden" style={{ height: '400px' }}>
                      {/* Zoom Controls */}
                      <div className="absolute top-2 right-2 z-10 flex flex-col gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setImageZoom(Math.min(imageZoom + 0.5, 4))}
                          className="shadow-lg"
                        >
                          <ZoomIn className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setImageZoom(Math.max(imageZoom - 0.5, 1))}
                          className="shadow-lg"
                        >
                          <ZoomOut className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setImageZoom(1);
                            setImagePan({ x: 0, y: 0 });
                          }}
                          className="shadow-lg"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      </div>

                      {/* Zoom Level Indicator */}
                      <div className="absolute top-2 left-2 z-10 bg-black/70 text-white px-2 py-1 rounded text-xs">
                        {Math.round(imageZoom * 100)}%
                      </div>

                      {/* Zoomable Image */}
                      <div 
                        className="w-full h-full overflow-auto cursor-move"
                        onWheel={(e) => {
                          e.preventDefault();
                          const delta = e.deltaY > 0 ? -0.1 : 0.1;
                          setImageZoom(Math.max(1, Math.min(4, imageZoom + delta)));
                        }}
                        onMouseDown={(e) => {
                          if (imageZoom > 1) {
                            setIsPanning(true);
                            setPanStart({ x: e.clientX - imagePan.x, y: e.clientY - imagePan.y });
                          }
                        }}
                        onMouseMove={(e) => {
                          if (isPanning && imageZoom > 1) {
                            setImagePan({
                              x: e.clientX - panStart.x,
                              y: e.clientY - panStart.y
                            });
                          }
                        }}
                        onMouseUp={() => setIsPanning(false)}
                        onMouseLeave={() => setIsPanning(false)}
                      >
                        <img 
                          src={selectedRefPhoto.photo_url}
                          alt={selectedRefPhoto.damage_type}
                          className="transition-transform duration-200"
                          style={{
                            transform: `scale(${imageZoom}) translate(${imagePan.x / imageZoom}px, ${imagePan.y / imageZoom}px)`,
                            transformOrigin: 'center center',
                            maxWidth: 'none',
                            width: '100%',
                            height: 'auto',
                            cursor: imageZoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default'
                          }}
                          draggable={false}
                        />
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-sm font-medium text-gray-900">
                        Type: {selectedRefPhoto.damage_type.replace(/_/g, ' ')}
                      </p>
                      {selectedRefPhoto.description && (
                        <p className="text-sm text-gray-600">{selectedRefPhoto.description}</p>
                      )}
                    </div>

                    <Alert className="bg-blue-50 border-blue-300">
                      <AlertDescription className="text-blue-900 text-sm">
                        Manually count all visible damage in this photo. This becomes the "ground truth" for testing AI accuracy.
                      </AlertDescription>
                    </Alert>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Ground Truth - Hail Count</Label>
                        <Input 
                          type="number"
                          value={verifyForm.hail_count}
                          onChange={(e) => setVerifyForm({...verifyForm, hail_count: parseInt(e.target.value) || 0})}
                          placeholder="Count manually"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Ground Truth - Wind Count</Label>
                        <Input 
                          type="number"
                          value={verifyForm.wind_count}
                          onChange={(e) => setVerifyForm({...verifyForm, wind_count: parseInt(e.target.value) || 0})}
                          placeholder="Count manually"
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-4 border-t mt-4">
                    <Button variant="outline" onClick={() => setSelectedRefPhoto(null)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        markRefAsVerifiedMutation.mutate({
                          refId: selectedRefPhoto.id,
                          hailCount: verifyForm.hail_count,
                          windCount: verifyForm.wind_count
                        });
                      }}
                      disabled={markRefAsVerifiedMutation.isPending}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {markRefAsVerifiedMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Mark as Verified
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {showInstructions && (
        <Card className="bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 border-2 border-blue-300">
          <CardHeader className="border-b bg-white/50">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-blue-600" />
                {t.inspections.howDroneAnalysisWorks || "How Drone Analysis Works"}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowInstructions(false)}>
                ✕
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                  <span className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm">1</span>
                  {t.inspections.capturePhotos || "Capture Photos"}
                </h3>
                <ul className="text-sm text-gray-700 space-y-2">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.droneCaptureDesc || "Fly your drone over property at 30-50 feet altitude"}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.phoneCaptureDesc || "OR use phone/camera for ground-level inspection"}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.highResPhotosDesc || "Take clear, high-resolution photos from multiple angles"}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.coverAllSectionsDesc || "Cover all roof sections and damaged areas"}</span>
                  </li>
                </ul>
              </div>

              <div className="bg-white rounded-lg p-4 shadow-sm">
                <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                  <span className="flex items-center justify-center w-8 h-8 bg-purple-600 text-white rounded-full text-sm">2</span>
                  {t.common.uploadAndAnalyze || "Upload & Analyze"}
                </h3>
                <ul className="text-sm text-gray-700 space-y-2">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.uploadAndAnalyzeStep1 || "Click \"New Drone Analysis\" and enter property details"}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.uploadAndAnalyzeStep2 || "Upload multiple photos at once (JPG, PNG, WEBP, GIF)"}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.uploadAndAnalyzeStep3 || "AI analyzes each photo automatically"}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.uploadAndAnalyzeStep4 || "Wait 30-60 seconds for complete analysis"}</span>
                  </li>
                </ul>
              </div>

              <div className="bg-white rounded-lg p-4 shadow-sm">
                <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                  <span className="flex items-center justify-center w-8 h-8 bg-orange-600 text-white rounded-full text-sm">3</span>
                  {t.inspections.aiDamageDetection || "AI Damage Detection"}
                </h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-2 text-sm">
                    <CloudHail className="w-5 h-5 text-blue-600 mt-0.5" />
                    <div>
                      <p className="font-semibold text-gray-900">{t.inspections.hailDamage || "Hail Damage"}:</p>
                      <p className="text-gray-600">{t.inspections.hailDamageIndicators || "Impact marks, granule loss, bruising, dents"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <Wind className="w-5 h-5 text-green-600 mt-0.5" />
                    <div>
                      <p className="font-semibold text-gray-900">{t.inspections.windDamage || "Wind Damage"}:</p>
                      <p className="text-gray-600">{t.inspections.windDamageIndicators || "Missing shingles, lifted edges, torn sections"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="w-5 h-5 text-orange-600 mt-0.5" />
                    <div>
                      <p className="font-semibold text-gray-900">{t.inspections.severityRating || "Severity Rating"}:</p>
                      <p className="text-gray-600">{t.inspections.severityRatingOptions || "None, Minor, Moderate, or Severe"}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-4 shadow-sm">
                <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                  <span className="flex items-center justify-center w-8 h-8 bg-green-600 text-white rounded-full text-sm">4</span>
                  {t.inspections.reportAndEstimate || "Report & Estimate"}
                </h3>
                <ul className="text-sm text-gray-700 space-y-2">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.reportAndEstimateStep1 || "View detailed damage analysis for each photo"}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.reportAndEstimateStep2 || "Download professional PDF report"}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.reportAndEstimateStep3 || "Get automatic repair cost estimates"}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    <span>{t.inspections.reportAndEstimateStep4 || "Create estimate with one click"}</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Physical Inspection Tips */}
            <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4 col-span-1 md:col-span-2">
              <h4 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
                <Camera className="w-5 h-5" />
                {t.inspections.physicalInspectionTipsTitle || "Best Practices for Physical Test Squares (Chalk)"}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-semibold text-blue-800 mb-1">1. {t.inspections.chalkingTheSquare || "Chalking the Square"}</p>
                  <ul className="text-sm text-blue-900 space-y-1">
                    <li>• {t.inspections.chalkTip1 || "Draw a clear 10' x 10' box on the slope."}</li>
                    <li>• <strong>{t.inspections.hail || "Hail"}:</strong> {t.inspections.chalkTip2 || "Draw distinct CIRCLES around hits."}</li>
                    <li>• <strong>{t.inspections.wind || "Wind"}:</strong> {t.inspections.chalkTip3 || "Draw horizontal LINES or \"X\" marks over creases."}</li>
                    <li>• {t.inspections.chalkTip4 || "Use high-contrast chalk (Yellow, Red, or Blue) that stands out against the shingle color."}</li>
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-semibold text-blue-800 mb-1">2. {t.inspections.takingThePhoto || "Taking the Photo"}</p>
                  <ul className="text-sm text-blue-900 space-y-1">
                    <li>• {t.inspections.photoTip1 || "Stand centered to the square to minimize perspective distortion."}</li>
                    <li>• {t.inspections.photoTip2 || "Fill the entire frame with the 10x10 square."}</li>
                    <li>• {t.inspections.photoTip3 || "Ensure no chalk marks are cut off by the edge of the photo."}</li>
                    <li>• {t.inspections.photoTip4 || "Avoid casting your own shadow across the test area."}</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 col-span-1 md:col-span-2">
              <h4 className="font-bold text-yellow-900 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                {t.inspections.dronePhotographyTipsTitle || "Drone Photography Tips"}
              </h4>
              <ul className="text-sm text-yellow-900 space-y-1">
                <li>✓ {t.inspections.dronePhotoTip1 || "Fly in good lighting conditions (morning or late afternoon)"}</li>
                <li>✓ {t.inspections.dronePhotoTip2 || "Avoid shadows and glare on the roof surface"}</li>
                <li>✓ {t.inspections.dronePhotoTip3 || "Take photos perpendicular (straight down) to the roof, not at extreme angles"}</li>
                <li>✓ {t.inspections.dronePhotoTip4 || "Capture close-ups for Test Squares (flying lower) vs General Overviews (flying higher)"}</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveView('inspections')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeView === 'inspections'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
          data-testid="tab-inspections"
        >
          All Inspections
        </button>
        <button
          onClick={() => setActiveView('route-planner')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
            activeView === 'route-planner'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
          data-testid="tab-route-planner"
        >
          🗺️ Route Planner
          {inspections.length > 0 && (
            <span className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full font-semibold">
              {inspections.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveView('map-view')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
            activeView === 'map-view'
              ? 'bg-white text-purple-700 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
          data-testid="tab-map-view"
        >
          📍 Map View
          {inspections.length > 0 && (
            <span className="bg-purple-100 text-purple-700 text-xs px-1.5 py-0.5 rounded-full font-semibold">
              {inspections.length}
            </span>
          )}
        </button>
      </div>

      {activeView === 'route-planner' && (
        <InspectionRoutePlanner
          inspections={inspections}
          onUpdateDates={async (ids, date) => updateDatesMutation.mutateAsync({ ids, date })}
          isUpdating={updateDatesMutation.isPending}
        />
      )}

      {activeView === 'map-view' && (
        <InspectionMapView
          inspections={inspections}
          onUpdateDates={async (ids, date) => updateDatesMutation.mutateAsync({ ids, date })}
          isUpdating={updateDatesMutation.isPending}
        />
      )}

      {activeView === 'inspections' && <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-700">{t.common.totalInspections || "Total Inspections"}</p>
                <p className="text-3xl font-bold text-blue-900">{inspections.length}</p>
              </div>
              <Camera className="w-8 h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-red-50 border-orange-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-700">{t.inspections.hailDamageFound || "Hail Damage Found"}</p>
                <p className="text-3xl font-bold text-orange-900">
                  {inspections.filter(i => i.hail_damage_detected).length}
                </p>
              </div>
              <CloudHail className="w-8 h-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-700">{t.inspections.windDamageFound || "Wind Damage Found"}</p>
                <p className="text-3xl font-bold text-green-900">
                  {inspections.filter(i => i.wind_damage_detected).length}
                </p>
              </div>
              <Wind className="w-8 h-8 text-green-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {inspections.map((inspection) => (
          <Card key={inspection.id} className="bg-white shadow-md hover:shadow-lg transition-shadow">
            <CardHeader className="border-b bg-gradient-to-r from-gray-50 to-blue-50">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <MapPin className="w-5 h-5 text-blue-600" />
                    <CardTitle className="text-xl">{inspection.property_address}</CardTitle>
                    <Badge variant="outline" className={getConditionColor(inspection.overall_condition)}>
                      {inspection.overall_condition}
                    </Badge>
                    {inspection.material_matching_flag && (
                      <Badge className="bg-red-500 text-white">
                        ⚠️ {t.inspections.discontinuedMaterialDetected || "Discontinued Material Detected"}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-4 text-sm text-gray-600">
                    <span>{inspection.inspection_number}</span>
                    {inspection.customer_name && <span>• {inspection.customer_name}</span>}
                    <span>• {format(new Date(inspection.inspection_date), 'MMM d, yyyy')}</span>
                    {inspection.photos && <span>• {inspection.photos.length} {t.inspections.photos || "photos"}</span>}
                    {inspection.storm_event_id && <span>• 🌩️ {t.inspections.stormLinked || "Storm Linked"}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {inspection.hail_damage_detected && (
                    <Badge className="bg-orange-100 text-orange-700 flex items-center gap-1">
                      <CloudHail className="w-3 h-3" />
                      {t.inspections.hail || "Hail"}
                    </Badge>
                  )}
                  {inspection.wind_damage_detected && (
                    <Badge className="bg-green-100 text-green-700 flex items-center gap-1">
                      <Wind className="w-3 h-3" />
                      {t.inspections.wind || "Wind"}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-6">
              {inspection.photos && inspection.photos.length > 0 && (
                <div className="space-y-6">
                  {/* Section Summaries */}
                  {Object.keys(getInspectionSectionSummaries(inspection)).length > 0 && (
                    <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border-2 border-blue-300">
                      <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-blue-600" />
                        {t.inspections.damageSummaryBySection || "Damage Summary by Section"}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {Object.entries(getInspectionSectionSummaries(inspection)).map(([section, summary]) => (
                          <div key={section} className="bg-white rounded-lg p-3 border border-gray-200">
                            <p className="font-semibold text-gray-900 mb-2">{section}</p>
                            <div className="space-y-2">
                              <div className="flex gap-2 text-sm flex-wrap">
                                {summary.badge_value > 0 && summary.badge_label && (
                                  <Badge className="bg-red-100 text-red-700 border-red-200 font-bold text-base">
                                    {summary.badge_value} {summary.badge_label === "Hail/SQ"
                                      ? (t.inspections.hailPerSq || "Hail/SQ")
                                      : summary.badge_label}
                                  </Badge>
                                )}
                                {summary.wind_per_sq > 0 && (
                                  <Badge className="bg-blue-100 text-blue-700 border-blue-200 font-bold text-base">
                                    {summary.wind_per_sq} {t.inspections.windPerSq || "Wind/SQ"}
                                  </Badge>
                                )}
                                {summary.badge_value === 0 && summary.wind_per_sq === 0 && summary.is_roof && summary.overview_count > 0 && (
                                  <Badge className="bg-amber-100 text-amber-800">Overview only — no hail count</Badge>
                                )}
                                {summary.badge_value === 0 && summary.wind_per_sq === 0 && !(summary.is_roof && summary.overview_count > 0) && (
                                  <Badge className="bg-green-100 text-green-700">{t.inspections.noDamage || "No damage"}</Badge>
                                )}
                              </div>
                              <p className="text-xs text-gray-600">
                                {summary.total_hail_marks > 0 && `${summary.total_hail_marks} ${summary.total_hail_label || t.inspections.totalHailMarks || "total hail marks"}`}
                                {summary.total_hail_marks > 0 && summary.total_wind_marks > 0 && ' • '}
                                {summary.total_wind_marks > 0 && `${summary.total_wind_marks} ${t.inspections.totalWindMarks || "total wind marks"}`}
                                {' • '}{summary.photo_count} {t.inspections.photoCountLabel || (summary.photo_count > 1 ? t.inspections.photos : "photo")}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {inspection.photos.map((photo, idx) => (
                      <div key={idx} className="relative group">
                        <div className="relative aspect-video rounded-lg overflow-hidden bg-gray-100 group">
                          {/* Show annotated image by default if available, fallback to original */}
                          <img
                            src={photo.annotated_url || photo.url}
                            alt={photo.caption}
                            className="w-full h-full object-cover transition-opacity duration-300"
                          />
                          
                          {/* Hover effect to compare original vs annotated */}
                          {photo.annotated_url && (
                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                              <img 
                                src={photo.url} 
                                alt={t.common.original || "Original"} 
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute bottom-2 left-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded">
                                {t.inspections.originalHovering || "Original (Hovering)"}
                              </div>
                            </div>
                          )}

                          {photo.annotated_url && (
                            <div className="absolute top-2 left-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded group-hover:opacity-0 transition-opacity">
                              {t.inspections.aiAnnotated || "AI Annotated"}
                            </div>
                          )}

                          {photo.damage_detected && (
                            <div className="absolute top-2 right-2">
                              <Badge variant="outline" className={getSeverityColor(photo.severity)}>
                                {photo.severity}
                              </Badge>
                            </div>
                          )}

                          {/* Coverage Verdict Overlay — bottom of image */}
                          {photo.coverage_verdict && (() => {
                            const cv = getCoverageVerdict(photo.coverage_verdict);
                            const VerdictIcon = cv.icon;
                            return (
                              <div className={`absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-2 py-1.5 ${cv.bg} border-t ${cv.border} group-hover:opacity-0 transition-opacity`}>
                                <VerdictIcon className={`w-3.5 h-3.5 flex-shrink-0 ${cv.iconColor}`} />
                                <span className={`text-[10px] font-semibold ${cv.text} truncate`}>{cv.label}</span>
                                {photo.photo_quality_score && (
                                  <span className="ml-auto text-[9px] text-gray-500 flex-shrink-0">
                                    {photo.photo_quality_flag || 'good'} quality
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        <div className="mt-2 space-y-2">
                          {/* Photo Quality Score Bar */}
                          {photo.photo_quality_score != null && (
                            <div className="space-y-0.5">
                              <div className="flex justify-between items-center text-[10px] text-gray-500">
                                <span>Photo Quality</span>
                                <span className="font-medium capitalize">{photo.photo_quality_flag || 'good'} · {photo.photo_quality_score}%</span>
                              </div>
                              <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${getQualityBarColor(photo.photo_quality_score)}`}
                                  style={{ width: `${photo.photo_quality_score}%` }}
                                />
                              </div>
                            </div>
                          )}
                          {/* Chalk Marks Found in THIS Photo - Editable */}
                          {(photo.hail_hits_counted > 0 || photo.wind_marks_counted > 0) && (
                            <div className="flex gap-2 text-xs">
                              {photo.hail_hits_counted > 0 && (
                                <div className="relative group/edit">
                                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 cursor-pointer hover:bg-red-100">
                                    {photo.hail_hits_counted} {t.inspections.hail || "Hail"}
                                  </Badge>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="absolute -top-1 -right-1 h-4 w-4 p-0 rounded-full bg-white border border-red-300 opacity-0 group-hover/edit:opacity-100 hover:bg-red-50"
                                    onClick={async () => {
                                      const newCount = prompt(`${t.inspections.editHailCount || 'Edit hail count for this photo'} (${t.common.currently || 'currently'} ${photo.hail_hits_counted}):`, photo.hail_hits_counted);
                                      if (newCount !== null && !isNaN(parseInt(newCount))) {
                                        const updatedPhotos = inspection.photos.map((p, i) => 
                                          i === idx ? { ...p, hail_hits_counted: parseInt(newCount) } : p
                                        );
                                        await base44.entities.DroneInspection.update(inspection.id, { photos: updatedPhotos });
                                        queryClient.invalidateQueries({ queryKey: ['drone-inspections'] });
                                        toast.success(t.inspections.updatedHailCount || 'Updated hail count');
                                      }
                                    }}
                                  >
                                    <Edit className="w-2 h-2" />
                                  </Button>
                                </div>
                              )}
                              {photo.wind_marks_counted > 0 && (
                                <div className="relative group/edit">
                                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 cursor-pointer hover:bg-blue-100">
                                    {photo.wind_marks_counted} {t.inspections.wind || "Wind"}
                                  </Badge>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="absolute -top-1 -right-1 h-4 w-4 p-0 rounded-full bg-white border border-blue-300 opacity-0 group-hover/edit:opacity-100 hover:bg-red-50"
                                    onClick={async () => {
                                      const newCount = prompt(`${t.inspections.editWindCount || 'Edit wind count for this photo'} (${t.common.currently || 'currently'} ${photo.wind_marks_counted}):`, photo.wind_marks_counted);
                                      if (newCount !== null && !isNaN(parseInt(newCount))) {
                                        const updatedPhotos = inspection.photos.map((p, i) => 
                                          i === idx ? { ...p, wind_marks_counted: parseInt(newCount) } : p
                                        );
                                        await base44.entities.DroneInspection.update(inspection.id, { photos: updatedPhotos });
                                        queryClient.invalidateQueries({ queryKey: ['drone-inspections'] });
                                        toast.success(t.inspections.updatedWindCount || 'Updated wind count');
                                      }
                                    }}
                                  >
                                    <Edit className="w-2 h-2" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Shingle Dimensions & Discontinued Flag */}
                          {photo.shingle_type && photo.shingle_type !== 'unknown' && (
                            <div className="flex flex-wrap gap-1 text-xs">
                              <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                                {photo.shingle_type}
                              </Badge>
                              {photo.shingle_exposure_inches > 0 && (
                                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                  {photo.shingle_exposure_inches}" {t.inspections.exposureShort || "exp"}
                                </Badge>
                              )}
                              {photo.likely_discontinued && (
                                <Badge className="bg-red-500 text-white">
                                  ⚠️ {t.inspections.likelyDiscontinued || "Likely Discontinued"}
                                </Badge>
                              )}
                            </div>
                          )}

                          {/* Section Label */}
                          <div className="flex justify-between items-center text-xs text-gray-500">
                            <span className="font-medium">{photo.roof_section || (t.common.general || 'General')}</span>
                            {photo.user_notes && (
                              <span className="truncate max-w-[100px]" title={photo.user_notes}>
                                📝 {photo.user_notes}
                              </span>
                            )}
                          </div>

                          {/* Edit Squares button — only for aerial photos that have stored detected_sections */}
                          {photo.photo_type === 'overhead_aerial' && Array.isArray(photo.detected_sections) && photo.detected_sections.length > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid={`button-edit-squares-${inspection.id}-${idx}`}
                              className="w-full text-xs border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100"
                              onClick={() => setEditSquaresPhoto({ photo, photoIdx: idx, inspection })}
                            >
                              <Edit className="w-3 h-3 mr-1.5" />
                              {t.inspections.editSquares || "Edit Squares"}
                              <span
                                data-testid={`badge-section-count-${inspection.id}-${idx}`}
                                className="ml-1.5 bg-blue-200 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                              >
                                {photo.detected_sections.length}
                              </span>
                            </Button>
                          )}

                          {/* Covered Items */}
                          {photo.covered_items && photo.covered_items.length > 0 && (
                            <div className="rounded border border-green-200 bg-green-50 p-1.5 space-y-1">
                              <p className="text-[9px] font-bold text-green-700 uppercase tracking-wide">Storm Covered</p>
                              {photo.covered_items.slice(0, 3).map((item, ci) => (
                                <div key={ci} className="flex items-start gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-green-600 flex-shrink-0 mt-px" />
                                  <div className="min-w-0">
                                    <span className="text-[10px] font-semibold text-green-800">{item.type}</span>
                                    {item.confidence != null && (
                                      <span className="text-[9px] text-green-600 ml-1">{item.confidence}%</span>
                                    )}
                                    {item.description && (
                                      <p className="text-[9px] text-green-700 leading-tight truncate" title={item.description}>{item.description}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Non-Covered Items */}
                          {photo.non_covered_items && photo.non_covered_items.length > 0 && (
                            <div className="rounded border border-red-200 bg-red-50 p-1.5 space-y-1">
                              <p className="text-[9px] font-bold text-red-700 uppercase tracking-wide">Not Covered</p>
                              {photo.non_covered_items.slice(0, 3).map((item, ni) => (
                                <div key={ni} className="flex items-start gap-1">
                                  <XCircle className="w-3 h-3 text-red-500 flex-shrink-0 mt-px" />
                                  <div className="min-w-0">
                                    <span className="text-[10px] font-semibold text-red-800">{item.type}</span>
                                    {item.confidence != null && (
                                      <span className="text-[9px] text-red-500 ml-1">{item.confidence}%</span>
                                    )}
                                    {item.description && (
                                      <p className="text-[9px] text-red-700 leading-tight truncate" title={item.description}>{item.description}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* AI Narrative — expandable */}
                          {(photo.ai_notes || photo.ai_analysis) && (
                            <div className="p-2 bg-gray-50 rounded text-xs border border-gray-100">
                              <p className={`text-gray-700 ${expandedPhotoNotes.has(`${inspection.id}-${idx}`) ? '' : 'line-clamp-2'}`}>
                                {photo.ai_notes || photo.ai_analysis}
                              </p>
                              {(photo.ai_notes || photo.ai_analysis || '').length > 120 && (
                                <button
                                  className="text-[10px] text-blue-600 hover:text-blue-800 mt-0.5 flex items-center gap-0.5"
                                  onClick={() => {
                                    const key = `${inspection.id}-${idx}`;
                                    const next = new Set(expandedPhotoNotes);
                                    next.has(key) ? next.delete(key) : next.add(key);
                                    setExpandedPhotoNotes(next);
                                  }}
                                >
                                  {expandedPhotoNotes.has(`${inspection.id}-${idx}`) ? (
                                    <><ChevronUp className="w-3 h-3" /> Less</>
                                  ) : (
                                    <><ChevronDown className="w-3 h-3" /> Read more</>
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 mt-4">
                     <div className="flex items-center justify-between flex-wrap gap-3">
                       <div className="flex gap-2 flex-wrap">
                         <Button
                           variant="outline"
                           onClick={() => handleOpenForEditing(inspection)}
                           className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                           data-testid={`button-add-photos-${inspection.id}`}
                         >
                           <Plus className="w-4 h-4 mr-2" />
                           {t.inspections.addPhotos || "Add Photos"}
                         </Button>
                         <Button
                           variant="outline"
                           onClick={() => {
                             setSelectedInspectionForStorm(inspection);
                             setShowStormLinkDialog(true);
                           }}
                           className={inspection.storm_event_id ? "bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100" : "bg-gray-50"}
                         >
                           <Link2 className="w-4 h-4 mr-2" />
                           {inspection.storm_event_id ? (t.inspections.changeStorm || 'Change Storm') : (t.inspections.linkStorm || 'Link Storm')}
                         </Button>
                         <Button
                           variant="outline"
                           onClick={async () => {
                             if (!window.confirm(t.inspections.reanalyzeConfirm || 'Re-analyze this inspection with upgraded AI? This will update damage detection and annotations.')) return;
                             setUploading(true);
                             const loadingToast = toast.loading(t.inspections.reanalyzingLoading || 'Re-analyzing inspection with enhanced AI...');
                             try {
                               const res = await base44.functions.invoke('reanalyzeDroneInspection', { inspectionId: inspection.id });
                               queryClient.invalidateQueries({ queryKey: ['drone-inspections'] });
                               toast.success(`✅ ${t.inspections.reanalysisComplete || 'Reanalysis complete!'}\n${res.data.photos_analyzed} ${t.inspections.photosAnalyzed || 'photos analyzed'}\n${t.inspections.hail || 'Hail'}: ${res.data.hail_detected ? (t.common.yes || 'YES') : (t.common.no || 'NO')}\n${t.inspections.wind || 'Wind'}: ${res.data.wind_detected ? (t.common.yes || 'YES') : (t.common.no || 'NO')}`, { id: loadingToast });
                             } catch (err) {
                               console.error('Reanalysis error:', err);
                               toast.error(`${t.inspections.reanalysisFailed || 'Reanalysis failed'}: ${err.message || 'Unknown error'}`, { id: loadingToast });
                             } finally {
                               setUploading(false);
                             }
                           }}
                           disabled={uploading}
                           className="bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
                         >
                           <Sparkles className="w-4 h-4 mr-2" />
                           {uploading ? (t.ai.analyzing || 'Reanalyzing...') : (t.common.reanalyze || 'Reanalyze')}
                         </Button>
                         <Button
                           variant="outline"
                           onClick={() => handleDownloadReport(inspection)}
                           className="bg-white"
                         >
                           <Download className="w-4 h-4 mr-2" />
                           {t.common.report || "Report"}
                         </Button>
                         <Button
                           onClick={() => handleCreateEstimate(inspection)}
                           className="bg-green-600 hover:bg-green-700"
                         >
                           <DollarSign className="w-4 h-4 mr-2" />
                           {t.estimates.createEstimate || "Create Estimate"}
                         </Button>
                       </div>
                     </div>
                   </div>

                  {inspection.notes && (
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm font-medium text-gray-700 mb-1">{t.inspections.inspectorNotes || "Inspector Notes"}:</p>
                      <p className="text-sm text-gray-600">{inspection.notes}</p>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(inspection.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      {t.common.delete || "Delete"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {inspections.length === 0 && (
          <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-dashed border-blue-300">
            <CardContent className="p-12 text-center">
              <Camera className="w-16 h-16 mx-auto mb-4 text-blue-400" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t.inspections.noDroneInspectionsYet || "No Drone Inspections Yet"}</h3>
              <p className="text-gray-600 mb-4">
                {t.inspections.noDroneInspectionsDesc || "Upload drone or inspection photos to detect storm damage with AI"}
              </p>
              <Button
                onClick={() => setShowDialog(true)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                {t.inspections.startFirstAnalysis || "Start First Analysis"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
      </>}
    </div>
    </>
  );
}