import React, { useState, useRef, useEffect } from "react";
import { generateEstimateHTML } from "@/utils/generateEstimateHTML";
import useTranslation from "@/hooks/useTranslation";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload,
  Loader2,
  Sparkles,
  Send,
  Paperclip,
  FileText,
  Settings,
  Save,
  X,
  UserCircle,
  ClipboardList,
  MapPin,
  Satellite,
  Download,
  Mail,
  Pencil,
  Plus,
  ArrowLeft,
  Edit,
  Wind,
  Camera,
  AlertTriangle,
  Brain,
  Trash2,
  Info,
  Ruler,
  RefreshCw
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import LineItemEditor from "../components/estimates/LineItemEditor";
import { GoogleAddressAutocomplete } from "../components/GoogleAddressAutocomplete";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "../utils";
import { analyzeEstimateCompleteness, generateMaterialList } from "@/lib/functions";
import { getPitchMultiplier, calculateRealConfidence } from "@/lib/satelliteUtils";
import {
  buildMetalRoofLineItems,
  buildFlatRoofLineItems,
  buildSidingLineItems,
  buildSidingLineItemsArray,
  buildRoofLineItemsArray,
  normalizeRoofMeasurements,
  applyWasteToLineItems,
  findItemInPriceList,
  downloadMaterialListCSV,
} from "@/utils/estimatorCalculations";
import MaterialListDialog from "@/components/shared/MaterialListDialog";
import {
  smartDescriptionMatch,
  matchItemToNewPriceList,
  getActivePriceList,
  getFormatForSource,
  getHeaderColorClass,
} from "@/lib/priceListUtils";
import { usePriceList } from "@/hooks/usePriceList";
import StructureSelector from "../components/satellite/StructureSelector";
import InteractiveRoofMap from "../components/satellite/InteractiveRoofMap";
import StreetViewPanel from "../components/satellite/StreetViewPanel";
import VentilationCalculator from "../components/estimator/VentilationCalculator";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Printer, Hammer, Share2, MoreHorizontal, Package, TrendingUp, ArrowUp, DollarSign, BarChart3, HardHat, Shield } from "lucide-react";
import SatelliteMeasurementPanel from "@/components/shared/SatelliteMeasurementPanel";
import EstimatorDialogs from "@/components/shared/EstimatorDialogs";
import EstimatorChatPanel from "@/components/shared/EstimatorChatPanel";

export default function AIEstimator() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selectedMode, setSelectedMode] = useState("document");
  const [showConfig, setShowConfig] = useState(false);
  const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false);
  const [googleMapsError, setGoogleMapsError] = useState(null);
  const [config, setConfig] = useState(() => {
    const savedConfig = localStorage.getItem('aiEstimatorConfig');
    if (savedConfig) {
      return JSON.parse(savedConfig);
    }
    return {
      specialty: "roofing",
      primaryMaterials: "laminated shingles, vinyl siding, 5\" gutters",
      defaultPricingSource: "xactimate",
      defaultTemplate: null,
      useFavorites: true,
      storyCount: "1",
      storyHeightFt: "9",
      openingDeductionPct: "15",
      sidingWastePct: "10"
    };
  });

  const [messages, setMessages] = useState([]);
  const [userInput, setUserInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);

  const [satelliteAddress, setSatelliteAddress] = useState(null);
  const [satelliteAnalysis, setSatelliteAnalysis] = useState(null);
  const [isSatelliteAnalyzing, setIsSatelliteAnalyzing] = useState(false);
  const [sidingMeasurements, setSidingMeasurements] = useState(null);
  const [isSidingAnalyzing, setIsSidingAnalyzing] = useState(false);
  const [showPhotoSiding, setShowPhotoSiding] = useState(false);
  const [useSatelliteMode, setUseSatelliteMode] = useState(false);
  const [structureType, setStructureType] = useState('house');
  const [wasteSuggestion, setWasteSuggestion] = useState(null);
  const [housePhotos, setHousePhotos] = useState([]); // [{url, label, name, preview}]
  const [uploadingSlot, setUploadingSlot] = useState(null); // which slot label is uploading
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  const [isAnalyzingPhotos, setIsAnalyzingPhotos] = useState(false);
  const [photoSidingAnalysis, setPhotoSidingAnalysis] = useState(null);
  const [useManualDrawing, setUseManualDrawing] = useState(false); // Renamed from useManualDrawing to showManualDrawing for consistency with outline but then reverted to original name to avoid breaking existing code.

  // NEW: Multi-structure support for AI mode
  const [analyzedStructures, setAnalyzedStructures] = useState([]);
  const [isAddingStructure, setIsAddingStructure] = useState(false);
  const [showStructureSelector, setShowStructureSelector] = useState(false);
  const [manualAddOnMode, setManualAddOnMode] = useState(false); // NEW: for hybrid AI + manual
  const [manualMeasurements, setManualMeasurements] = useState([]); // NEW: store manual measurements
  const [excludedStructureIds, setExcludedStructureIds] = useState(new Set()); // NEW: per-structure include/exclude
  const [addingStructureType, setAddingStructureType] = useState('house'); // NEW: type for next structure
  const [isDetectingNearby, setIsDetectingNearby] = useState(false); // NEW: auto-detect secondary structures
  // Garage dimension picker state
  const [garageDimL, setGarageDimL] = useState(20);
  const [garageDimW, setGarageDimW] = useState(22);
  const [garagePitch, setGaragePitch] = useState('4/12');

  // NEW: Gutters for AI mode
  const [includeGuttersAI, setIncludeGuttersAI] = useState(false);
  const [aiGutterLF, setAiGutterLF] = useState(0);
  const [aiDownspoutCount, setAiDownspoutCount] = useState(0);
  
  // NEW: Roof type selector
  const [roofTypeSelection, setRoofTypeSelection] = useState("shingles");
  const [estimateOutputLanguage, setEstimateOutputLanguage] = useState('en');
  
  // NEW: Measurement API selector (Google Solar vs Gemini Vision)
  const [measurementAPI, setMeasurementAPI] = useState(() => {
    const saved = localStorage.getItem('aiEstimatorMeasurementAPI');
    return saved || 'google_solar';
  });

  const [currentEstimate, setCurrentEstimate] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  
  // NEW: Estimate history for undo
  const [estimateHistory, setEstimateHistory] = useState([]);

  // Elevation Views (Street View multi-angle)
  const [elevationImages, setElevationImages] = useState([]);
  const [isLoadingElevation, setIsLoadingElevation] = useState(false);
  const [refinedPitchData, setRefinedPitchData] = useState(null);
  const [isRefiningPitch, setIsRefiningPitch] = useState(false);
  const [elevationPanelOpen, setElevationPanelOpen] = useState(true);

  // Insurance Job Mode
  const [isInsuranceJob, setIsInsuranceJob] = useState(() => {
    return localStorage.getItem('aiEstimatorInsuranceJob') === 'true';
  });
  
  const [pricingSource, setPricingSource] = useState("xactimate");
  const [jobType, setJobType] = useState("roofing");
  const [selectedContactId, setSelectedContactId] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('customer_id') || "";
  });
  const [selectedFormatId, setSelectedFormatId] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showMaterialList, setShowMaterialList] = useState(false);
  const [materialListData, setMaterialListData] = useState(null);
  const [isGeneratingMaterials, setIsGeneratingMaterials] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeFiles, setMergeFiles] = useState([]);
  const [isMerging, setIsMerging] = useState(false);
  const [showMergeWithExistingDialog, setShowMergeWithExistingDialog] = useState(false);
  const [mergeWithExistingSearch, setMergeWithExistingSearch] = useState('');
  const [isMergingWithExisting, setIsMergingWithExisting] = useState(false);
  const [mergeTargetId] = useState(() => new URLSearchParams(window.location.search).get('merge_target_id') || null);
  const [mergeTargetEstimate, setMergeTargetEstimate] = useState(null);

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [missingSuggestions, setMissingSuggestions] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showMemoryDialog, setShowMemoryDialog] = useState(false);
  const [newMemoryItem, setNewMemoryItem] = useState({ label: '', cmd: '', reason: '', keywords: '' });
  const [showVentilationCalc, setShowVentilationCalc] = useState(false);
  const [reportMeasurements, setReportMeasurements] = useState(null);
  const [isSavingCalibration, setIsSavingCalibration] = useState(false);
  const [calibrationResult, setCalibrationResult] = useState(null);

  // NEW: Linked inspection job state
  const [linkedInspectionJobId, setLinkedInspectionJobId] = useState(null);
  
  // Duplicate customer handling
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateCustomer, setDuplicateCustomer] = useState(null);

  // Send to Production for Approval
  const [showProductionDialog, setShowProductionDialog] = useState(false);
  const [productionEmail, setProductionEmail] = useState('');
  const [productionNote, setProductionNote] = useState('');
  const [isSendingProduction, setIsSendingProduction] = useState(false);

  // Send to Insurance Adjuster
  const [showAdjusterDialog, setShowAdjusterDialog] = useState(false);
  const [showTrainingLibrary, setShowTrainingLibrary] = useState(false);
  const [isUploadingTraining, setIsUploadingTraining] = useState(false);
  const [adjusterName, setAdjusterName] = useState('');
  const [adjusterEmail, setAdjusterEmail] = useState('');
  const [adjusterClaimNumber, setAdjusterClaimNumber] = useState('');
  const [adjusterNote, setAdjusterNote] = useState('');
  const [isSendingAdjuster, setIsSendingAdjuster] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState(null);

  const [customerInfo, setCustomerInfo] = useState(() => {
    // Pre-fill from URL params if coming from customer/lead page
    const urlParams = new URLSearchParams(window.location.search);
    return {
      customer_name: urlParams.get('customer_name') || "",
      customer_email: urlParams.get('customer_email') || "",
      customer_phone: urlParams.get('customer_phone') || "",
      property_address: urlParams.get('property_address') || "",
      claim_number: urlParams.get('claim_number') || "",
      insurance_company: urlParams.get('insurance_company') || "",
      adjuster_name: urlParams.get('adjuster_name') || "",
      adjuster_phone: urlParams.get('adjuster_phone') || "",
      notes: "",
      disclaimer: "",
      report_type: "unknown"
    };
  });

  const fileInputRef = useRef(null);
  const trainingFileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const queryClient = useQueryClient();

  // Get inspectionJobId and lead_id from URL if present
  const urlParams = new URLSearchParams(location.search);
  const inspectionJobIdFromUrl = urlParams.get('inspection_job_id');
  const leadIdFromUrl = urlParams.get('lead_id');

  useEffect(() => {
    let retryTimeout = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 5;
    let cancelled = false;

    const loadGoogleMaps = async () => {
      if (cancelled) return;

      if (window.google && window.google.maps && window.google.maps.places) {
        setGoogleMapsLoaded(true);
        return;
      }

      // If a Maps script is already loading, wait for it instead of adding another
      if (document.querySelector('script[src*="maps.googleapis.com"]')) {
        retryTimeout = setTimeout(loadGoogleMaps, 500);
        return;
      }

      try {
        sessionStorage.removeItem('_gmaps_key');
        const response = await base44.functions.invoke('getGoogleMapsApiKey');
        if (cancelled) return;
        const apiKey = response.data?.apiKey;

        if (!apiKey) {
          throw new Error('Google Maps API key not configured');
        }

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry,drawing`;
        script.async = true;
        script.defer = true;

        script.onload = () => {
          if (!cancelled) {
            console.log('✅ Google Maps loaded successfully');
            setGoogleMapsLoaded(true);
          }
        };

        script.onerror = () => {
          if (!cancelled) {
            console.error('❌ Failed to load Google Maps script');
            setGoogleMapsError('Failed to load Google Maps. Please refresh the page.');
          }
        };

        document.head.appendChild(script);
      } catch (error) {
        if (cancelled) return;
        console.error(`Error loading Google Maps (attempt ${attempts + 1}):`, error);
        sessionStorage.removeItem('_gmaps_key');
        attempts++;
        if (attempts < MAX_ATTEMPTS) {
          console.log(`Retrying Google Maps load in 3s...`);
          retryTimeout = setTimeout(loadGoogleMaps, 3000);
        } else {
          setGoogleMapsError('Google Maps unavailable. Please refresh the page.');
        }
      }
    };

    loadGoogleMaps();
    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (lineItems.length > 0) {
      const total = Math.round(lineItems.reduce((acc, item) => acc + (Number(item.rcv) || 0), 0) * 100) / 100;
      
      setCurrentEstimate(prev => {
        if (!prev) return null;
        
        return {
          ...prev,
          line_items: lineItems,
          total_rcv: total
        };
      });
    } else {
      setCurrentEstimate(null);
    }
  }, [lineItems]);

  // NEW: Helper to save current state to history before making changes
  const saveToHistory = () => {
    if (lineItems.length > 0) {
      setEstimateHistory(prev => [...prev, {
        lineItems: JSON.parse(JSON.stringify(lineItems)),
        currentEstimate: currentEstimate ? JSON.parse(JSON.stringify(currentEstimate)) : null,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  // NEW: Undo function
  const handleUndo = () => {
    if (estimateHistory.length === 0) {
      alert('Nothing to undo');
      return;
    }

    const previousState = estimateHistory[estimateHistory.length - 1];
    setLineItems(previousState.lineItems);
    setCurrentEstimate(previousState.currentEstimate);
    setEstimateHistory(prev => prev.slice(0, -1));

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `↩️ Undone! Restored previous estimate.`,
      timestamp: new Date().toISOString()
    }]);
  };

  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me(),
  });

  const { company: myCompany } = useCurrentCompany(user);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 100) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", 100) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: estimates = [] } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 100) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // Auto-load merge target estimate when coming from Estimate Editor
  useEffect(() => {
    if (!mergeTargetId || !estimates.length) return;
    const target = estimates.find(e => e.id === mergeTargetId);
    if (target) setMergeTargetEstimate(target);
  }, [mergeTargetId, estimates]);

  // Query for linked job media specific to the linkedInspectionJobId
  const { data: linkedJobMedia = [] } = useQuery({
    queryKey: ['linked-job-media', linkedInspectionJobId],
    queryFn: () => linkedInspectionJobId ? base44.entities.JobMedia.filter({ 
      related_entity_id: linkedInspectionJobId, 
      related_entity_type: 'InspectionJob',
      file_type: 'photo'
    }) : [],
    enabled: !!linkedInspectionJobId,
    initialData: [],
  });

  // Query for all inspection jobs
  const { data: allInspectionJobs = [] } = useQuery({
    queryKey: ['inspection-jobs', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.InspectionJob.filter({ company_id: myCompany.id }, "-created_date", 100) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: savedMissedItems = [] } = useQuery({
    queryKey: ['missed-items-memory', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const records = await base44.entities.AITrainingData.filter({ 
        company_id: myCompany.id,
        data_type: 'missed_items'
      });
      if (records.length > 0 && records[0].content) {
        try {
          return JSON.parse(records[0].content);
        } catch { return []; }
      }
      return [];
    },
    enabled: !!myCompany,
    initialData: [],
  });

  const allContacts = [
    ...customers.map(c => ({
      ...c,
      type: 'customer',
      displayName: c.name || c.full_name || c.company || 'Unnamed Customer',
      searchText: `${c.name || ''} ${c.full_name || ''} ${c.email || ''} ${c.company || ''}`.toLowerCase()
    })),
    ...leads.map(l => ({
      ...l,
      type: 'lead',
      displayName: l.name || l.full_name || l.company || 'Unnamed Lead',
      searchText: `${l.name || ''} ${l.full_name || ''} ${l.email || ''} ${l.company || ''}`.toLowerCase()
    }))
  ].sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));


  const { data: estimatorMemories = [] } = useQuery({
    queryKey: ['estimator-memories', user?.email],
    queryFn: () => user ? base44.entities.AIMemory.filter({
      user_email: user.email,
      category: 'estimator',
      is_active: true
    }, '-importance', 20) : [],
    enabled: !!user,
    initialData: [],
  });

  const { data: knowledgeArticles = [] } = useQuery({
    queryKey: ['knowledge-base-ai', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.KnowledgeBaseArticle.filter({
      company_id: myCompany.id,
      is_ai_training: true,
      is_published: true
    }, '-priority', 50) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const estimatorKnowledge = knowledgeArticles.filter(article =>
    article.ai_assistant_targets?.includes("estimator")
  );

  const { data: competitorEstimates = [] } = useQuery({
    queryKey: ['competitor-estimates', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      return base44.entities.AITrainingData.filter({
        company_id: myCompany.id,
        data_type: 'competitor_estimate'
      });
    },
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: trainingDocuments = [], refetch: refetchTrainingDocs } = useQuery({
    queryKey: ['training-documents', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      return base44.entities.AITrainingData.filter({
        company_id: myCompany.id,
        data_type: 'training_document'
      });
    },
    enabled: !!myCompany,
    initialData: [],
  });

  const {
    xactimatePriceList,
    xactimateNewPriceList,
    customPriceList,
    symbilityPriceList,
  } = usePriceList(myCompany);

  const { data: formats = [] } = useQuery({
    queryKey: ['estimate-formats', myCompany?.id],
    queryFn: async () => {
      const systemFormats = await base44.entities.EstimateFormat.filter({ company_id: null, is_active: true });
      let masterFormats = [];
      try {
        masterFormats = await base44.entities.EstimateFormat.filter({ company_id: 'companysync_master_001', is_active: true });
      } catch (e) {}
      let myFormats = [];
      if (myCompany?.id) {
        myFormats = await base44.entities.EstimateFormat.filter({ company_id: myCompany.id, is_active: true });
      }
      const all = [...myFormats, ...masterFormats, ...systemFormats];
      const seen = new Set();
      return all.filter(f => { if (seen.has(f.format_name)) return false; seen.add(f.format_name); return true; });
    },
    enabled: true,
    initialData: [],
  });

  const selectedFormat = selectedFormatId ? formats.find(f => f.id === selectedFormatId) : null;
  const currentFormat = selectedFormat || getFormatForSource(pricingSource, formats);

  useEffect(() => {
    const savedConfig = localStorage.getItem('aiEstimatorConfig');
    if (savedConfig) {
      const parsed = JSON.parse(savedConfig);
      setConfig(parsed);
      setPricingSource(parsed.defaultPricingSource);
      if (parsed.defaultTemplate) {
        setSelectedFormatId(parsed.defaultTemplate);
      }
      setShowConfig(false);

      setMessages([{
        role: 'assistant',
        content: `🏗️ **Welcome back!**

Your AI Estimator is configured for **${parsed.specialty}** with:
• Primary materials: ${parsed.primaryMaterials}
• Pricing source: ${parsed.defaultPricingSource.replace('xactimate_new', 'Xactimate New')}
${parsed.defaultTemplate ? `• Template: ${formats.find(f => f.id === parsed.defaultTemplate)?.format_name || 'Custom'}` : ''}
• Using favorites: ${parsed.useFavorites ? 'Yes' : 'No'}

Choose your mode: Upload documents OR use satellite measurements!`,
        timestamp: new Date().toISOString()
      }]);
    }
  }, [estimatorMemories, user]);

  const handleFormatChange = (formatId) => {
    const resolvedId = formatId === '__none__' ? null : formatId;
    setSelectedFormatId(resolvedId);
    const format = formats.find(f => f.id === resolvedId);
    if (format) {
      const isInsFormat = !!(format.insurance_company || (format.format_name || '').toLowerCase().match(/xactimate|state.?farm|allstate|farmers|liberty|travelers|nationwide|progressive/));
      if (isInsFormat && !isInsuranceJob) {
        setIsInsuranceJob(true);
        localStorage.setItem('aiEstimatorInsuranceJob', 'true');
      }
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **Switched to "${format.format_name}" template**\n\n📋 This template uses ${format.show_rcv_acv ? 'RCV/ACV' : 'standard'} pricing${format.show_depreciation ? ' with depreciation' : ''}${isInsFormat ? '\n\n🏠 **Insurance Job Mode enabled** — estimate will use Xactimate-style format.' : ''}.`,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const handlePricingSourceChange = (newSource) => {
    setPricingSource(newSource);
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `📊 **Pricing source changed to: ${newSource.replace('xactimate_new', 'Xactimate New').toUpperCase()}**\n\nRecalculating all items...`,
      timestamp: new Date().toISOString()
    }]);

    // Save to history before modifying line items
    saveToHistory();

    if (lineItems.length > 0) {
      const priceList = getActivePriceList(newSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });
      const updatedItems = lineItems.map(item => matchItemToNewPriceList(item, priceList));

      setLineItems(updatedItems);

      const totalRcv = updatedItems.reduce((acc, item) => acc + (Number(item.rcv) || 0), 0);
      const unmatchedCount = updatedItems.filter(i => (Number(i.rate) || 0) === 0).length;

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Updated all ${updatedItems.length} items.\n\nNew total: $${totalRcv.toLocaleString()}${unmatchedCount > 0 ? `\n\n⚠️ ${unmatchedCount} items not found in ${newSource} - set to $0` : ''}`,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const handleSatelliteAddressSelect = async (address, details) => {
    if (!details?.geometry?.location) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Could not get location details for the address. Please try again.`,
        timestamp: new Date().toISOString()
      }]);
      return;
    }

    const lat = details.geometry.location.lat();
    const lng = details.geometry.location.lng();

    console.log('📍 Selected address:', address);
    console.log('🗺️ Coordinates:', { lat, lng });

    setSatelliteAddress({
      address: address,
      coordinates: { lat, lng }
    });
    setSatelliteAnalysis(null);
    setUseManualDrawing(false);
    setManualAddOnMode(false); // Reset manual add-on mode
    setManualMeasurements([]); // Clear manual add-on measurements

    setCustomerInfo(prev => ({
      ...prev,
      property_address: address
    }));

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `📍 **Property selected:** ${address}\n\n✨ **Choose your measurement method:**\n\n1️⃣ **AI Auto-Detect** (30-60 seconds) - Let AI analyze the roof automatically\n2️⃣ **Manual Drawing** (Most Accurate) - Draw lines yourself on the satellite map\n\nClick the button below to choose!`,
      timestamp: new Date().toISOString()
    }]);
  };

  // handleManualMeasurementsComplete is removed, its logic is now inline in InteractiveRoofMap's onMeasurementComplete
  // within the `else` branch (when manualAddOnMode is false)

  const handleAIAutoDetect = async () => {
    if (!satelliteAddress) {
      console.error('❌ No satellite address available');
      return;
    }

    const { lat, lng } = satelliteAddress.coordinates;

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `🤖 **AI is analyzing the roof from satellite imagery...**\n\n⏱️ This takes 30-60 seconds...`,
      timestamp: new Date().toISOString()
    }]);

    setIsSatelliteAnalyzing(true);
    setUseManualDrawing(false);
    setManualAddOnMode(false);

    try {
      const functionName = measurementAPI === 'gemini_vision' ? 'geminiRoofMeasurement' : 'aiRoofMeasurement';
      console.log(`🚀 Calling ${functionName} function...`);
      console.log('Payload:', { latitude: lat, longitude: lng, address: satelliteAddress.address });
      
      const response = await base44.functions.invoke(functionName, {
        latitude: lat,
        longitude: lng,
        address: satelliteAddress.address
      });

      console.log('📊 Function response:', response);
      console.log('Response status:', response?.status);
      console.log('Response data:', response?.data);

      if (response?.data?.debug_logs) {
        console.log('🔍 Backend logs:', response.data.debug_logs);
      }

      // Check for error responses
      if (!response || !response.data) {
        console.error('❌ Empty response from backend');
        throw new Error('No response from AI measurement service');
      }

      if (!response.data.success) {
        console.error('❌ Backend returned error:', response.data.error);
        throw new Error(response.data.error || 'Failed to analyze roof');
      }

      console.log('✅ Backend returned success:', response.data.success);

      const analysis = {
        roof_area_sq: response.data.roof_area_sq,
        roof_area_sqft: response.data.roof_area_sqft,
        // Capture new fields
        final_order_quantity_sq: response.data.final_order_quantity_sq,
        waste_percentage: response.data.waste_percentage,
        waste_reason: response.data.waste_reason,
        warning_message: response.data.warning_message,
        
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
        satellite_image_base64: response.data.satellite_image_base64,
        detected_lines: response.data.detected_lines,
        overall_confidence: response.data.overall_confidence || 100,
        ridge_confidence: response.data.ridge_confidence || 100,
        hip_confidence: response.data.hip_confidence || 100,
        valley_confidence: response.data.valley_confidence || 100,
        rake_confidence: response.data.rake_confidence || 100,
        eave_confidence: response.data.eave_confidence || 100,
        step_flashing_confidence: response.data.step_flashing_confidence || 100,
        analysis_notes: response.data.analysis_notes || null,
        roof_type: response.data.roof_type || null,
        roof_type_confidence: response.data.roof_type_confidence || null,
        calibration_applied: response.data.calibration_applied || false,
        pipe_boots: response.data.pipe_boots || 0,
        box_vents: response.data.box_vents || 0,
        ridge_vent_lf: response.data.ridge_vent_lf || 0,
        satellite_dish: response.data.satellite_dish || 0,
        chimney_small: response.data.chimney_small || 0,
        chimney_medium: response.data.chimney_medium || 0,
        chimney_large: response.data.chimney_large || 0,
        gutter_lf: 0,
        downspout_count: 0,
        structures: []
      };

      console.log('✅ Analysis object created:', analysis);

      const realConf = calculateRealConfidence(analysis, measurementAPI);
      analysis.overall_confidence = realConf.overall;
      analysis.confidence_grade = realConf.grade;
      analysis.confidence_grade_color = realConf.gradeColor;
      analysis.confidence_details = realConf.details;
      analysis.confidence_warnings = realConf.warnings;
      analysis.tolerance_pct = realConf.tolerancePct;
      analysis.pitch_multiplier = realConf.pitchMultiplier;
      analysis.corrected_area_sq = realConf.correctedAreaSq;
      analysis.corrected_area_sqft = realConf.correctedAreaSqFt;
      analysis.area_range = realConf.areaRange;
      analysis.measurement_source = realConf.source;
      if (realConf.proTip) analysis.pro_tip = realConf.proTip;
      if (realConf.perMeasurement.ridge) analysis.ridge_confidence = realConf.perMeasurement.ridge;
      if (realConf.perMeasurement.hip) analysis.hip_confidence = realConf.perMeasurement.hip;
      if (realConf.perMeasurement.valley) analysis.valley_confidence = realConf.perMeasurement.valley;
      if (realConf.perMeasurement.rake) analysis.rake_confidence = realConf.perMeasurement.rake;
      if (realConf.perMeasurement.eave) analysis.eave_confidence = realConf.perMeasurement.eave;
      if (realConf.perMeasurement.step_flashing) analysis.step_flashing_confidence = realConf.perMeasurement.step_flashing;

      console.log('📊 Real confidence:', realConf);

      const structureData = {
        id: Date.now(),
        name: isAddingStructure ? `${addingStructureType === 'garage' ? 'Garage' : addingStructureType === 'shed' ? 'Shed' : 'Structure'} ${analyzedStructures.length + 1}` : "Main Property",
        address: satelliteAddress.address,
        structureType: isAddingStructure ? addingStructureType : 'house',
        analysis: analysis
      };

      if (isAddingStructure) {
        setAnalyzedStructures(prev => [...prev, structureData]);
        setSatelliteAnalysis(null);
        setIsAddingStructure(false);

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `**Added ${structureData.name}!**\n\n**Roof Area:** ${realConf.correctedAreaSq} SQ | **Pitch:** ${analysis.pitch}\n**Order Qty:** ${(realConf.correctedAreaSq * (1 + (analysis.waste_percentage || 12) / 100)).toFixed(1)} SQ (+${analysis.waste_percentage || 12}% waste)\n**Estimate Quality:** ${realConf.grade} (+/- ${realConf.tolerancePct}%)\n\nClick "Generate Combined Estimate" to create estimate with all structures!`,
          timestamp: new Date().toISOString()
        }]);
      } else {
        setAnalyzedStructures([structureData]);
        setSatelliteAnalysis(analysis);

        const warningLines = realConf.warnings.length > 0 
          ? `\n\n⚠️ **Warnings:**\n${realConf.warnings.map(w => `• ${w}`).join('\n')}` 
          : '';
        const orderQty = (realConf.correctedAreaSq * (1 + (analysis.waste_percentage || 12) / 100)).toFixed(1);

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `**Analyzed ${structureData.name}**\n\n**Roof Area:** ${realConf.correctedAreaSq} SQ | **Pitch:** ${analysis.pitch}\n**Order Qty:** ${orderQty} SQ (+${analysis.waste_percentage || 12}% waste)\n**Estimate Quality:** ${realConf.grade} (+/- ${realConf.tolerancePct}%)${warningLines}\n\nReview the measurements, add gutters, or add more structures. When ready, click "Generate Estimate".`,
          timestamp: new Date().toISOString()
        }]);

        if (realConf.overall < 65) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `**Grade ${realConf.grade} - Manual Verification Recommended**\n\nSatellite estimates can vary significantly. Measurements could be off by ${realConf.tolerancePct}% or more.\n\n**To improve accuracy:**\n• Upload an EagleView or HOVER report\n• Use Manual Drawing mode on satellite view\n• Verify key measurements on-site\n• Check pitch with an inclinometer app`,
            timestamp: new Date().toISOString()
          }]);
        }
      }

    } catch (error) {
      console.error('💥 Satellite analysis error:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ **Error analyzing property:**\n\n${error.message}\n\n**Troubleshooting:**\n• Make sure GOOGLE_MAPS_API_KEY is set in Settings → Secrets\n• Make sure Google Solar API is enabled for this key\n• Try a different address\n• Use Manual Drawing mode instead (most accurate!)`,
        timestamp: new Date().toISOString()
      }]);
    }

    setIsSatelliteAnalyzing(false);
  };

  // NEW: Auto-detect secondary structures by probing nearby coordinates
  const handleDetectNearbyStructures = async () => {
    if (!satelliteAddress?.coordinates) return;
    const { lat, lng } = satelliteAddress.coordinates;
    setIsDetectingNearby(true);
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `🔍 **Scanning property for additional structures (garage, shed, etc.)...**\n\nChecking nearby coordinates for secondary buildings.`,
      timestamp: new Date().toISOString()
    }]);

    const primarySQ = analyzedStructures[0]?.analysis?.roof_area_sq || 0;
    const OFFSETS = [
      { lat: lat + 0.0002, lng, label: 'North' },
      { lat: lat - 0.0002, lng, label: 'South' },
      { lat, lng: lng + 0.0003, label: 'East' },
      { lat, lng: lng - 0.0003, label: 'West' },
    ];

    const foundStructures = [];
    try {
      for (const offset of OFFSETS) {
        try {
          const response = await base44.functions.invoke('aiRoofMeasurement', {
            latitude: offset.lat,
            longitude: offset.lng,
            address: satelliteAddress.address
          });
          if (!response?.data?.success) continue;
          const area = response.data.roof_area_sq || 0;
          // Only count as a new structure if it's significantly smaller than the primary
          // (likely a garage/shed) and not a duplicate of already-found structures
          const isDuplicate = foundStructures.some(f => Math.abs(f.area - area) < 1) ||
            analyzedStructures.some(s => Math.abs((s.analysis.roof_area_sq || 0) - area) < 1);
          if (area > 0 && area < primarySQ * 0.8 && !isDuplicate) {
            foundStructures.push({
              offset,
              area,
              response: response.data,
            });
          }
        } catch (_) { /* skip failed offsets */ }
      }

      if (foundStructures.length === 0) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `📍 **No additional structures detected automatically.**\n\nIf there's a garage or shed on the property, use **"Add Another Structure"** to manually pin it on the map.`,
          timestamp: new Date().toISOString()
        }]);
      } else {
        const newStructures = foundStructures.map((f, i) => {
          const analysis = {
            roof_area_sq: f.response.roof_area_sq,
            roof_area_sqft: f.response.roof_area_sqft,
            corrected_area_sq: f.response.roof_area_sq,
            ridge_lf: f.response.ridge_lf || 0,
            hip_lf: f.response.hip_lf || 0,
            valley_lf: f.response.valley_lf || 0,
            rake_lf: f.response.rake_lf || 0,
            eave_lf: f.response.eave_lf || 0,
            pitch: f.response.pitch || '4/12',
            overall_confidence: Math.min(f.response.overall_confidence || 60, 65),
            confidence_grade: 'C',
            tolerance_pct: 20,
            analysis_notes: `Auto-detected secondary structure (${f.offset.label} offset). Verify on-site.`,
          };
          return {
            id: Date.now() + i + 100,
            name: `Garage ${analyzedStructures.length + i + 1}`,
            address: satelliteAddress.address,
            structureType: 'garage',
            analysis,
          };
        });

        setAnalyzedStructures(prev => [...prev, ...newStructures]);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `🏗️ **Found ${newStructures.length} possible secondary structure${newStructures.length > 1 ? 's' : ''}!**\n\n${newStructures.map(s => `• **${s.name}**: ${s.analysis.roof_area_sq?.toFixed(1)} SQ`).join('\n')}\n\n⚠️ Auto-detected structures have lower accuracy (Grade C). Verify on-site or use manual measurement. They are marked as Garage type with 1-story siding defaults.`,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Error scanning for nearby structures: ${err.message}`,
        timestamp: new Date().toISOString()
      }]);
    }
    setIsDetectingNearby(false);
  };

  const handleAnalyzeSiding = async (structureOverride) => {
    const sidingLat = satelliteAddress?.coordinates?.lat || satelliteAddress?.lat;
    const sidingLng = satelliteAddress?.coordinates?.lng || satelliteAddress?.lng;
    if (!sidingLat || !sidingLng) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Please select a property address first using the address search above.`,
        timestamp: new Date().toISOString()
      }]);
      return;
    }
    setIsSidingAnalyzing(true);
    setSidingMeasurements(null);
    setWasteSuggestion(null);
    try {
      // Garage profile: 1-story (10ft), 10% opening deduction, 8% waste
      const isGarageStructure = structureOverride?.structureType === 'garage' ||
        (analyzedStructures.length > 0 && analyzedStructures[analyzedStructures.length - 1]?.structureType === 'garage' && structureType === 'garage');
      const storyCount = isGarageStructure ? 1 : (Number(config.storyCount) || 1);
      const storyHeightFt = isGarageStructure ? 10 : (Number(config.storyHeightFt) || 9);
      const openingDeductionPct = isGarageStructure ? 10 : (Number(config.openingDeductionPct) || 15);
      const response = await base44.functions.invoke('analyzeSidingMeasurement', {
        latitude: sidingLat,
        longitude: sidingLng,
        address: satelliteAddress.address || '',
        storyCount,
        storyHeightFt,
        openingDeductionPct,
      });
      const data = response?.data || response;
      if (data?.success === false) {
        throw new Error(data.error || 'Siding analysis failed');
      }
      setSidingMeasurements(data);
      // Show waste recommendation if AI suggests something different from current setting
      if (data.recommended_waste_pct != null) {
        const currentWaste = Number(config.sidingWastePct) || 0;
        setWasteSuggestion({
          pct: data.recommended_waste_pct,
          reason: data.waste_reason || '',
          currentPct: currentWaste,
          dismissed: false
        });
      }
      // Auto-populate siding line items immediately
      await convertSidingMeasurementsToLineItems(data);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **Siding estimate built from satellite measurements!**\n\n${data.osm_perimeter_used ? '📍 **Perimeter source: OpenStreetMap** (real building footprint traced)' : '📡 **Perimeter source: Solar API** (derived from roof segments)'}\n\n📐 **Wall Area:** ${data.wall_area_sq?.toFixed(2)} SQ (${data.wall_area_sqft?.toLocaleString()} sqft)\n📏 **Perimeter:** ${data.perimeter_ft} LF${data.osm_perimeter_used && data.solar_perimeter_ft ? ` (OSM) vs ${data.solar_perimeter_ft} LF (Solar estimate)` : ''}\n🏠 **Building:** ${data.building_length_ft}ft × ${data.building_width_ft}ft ${data.roof_type || ''}\n📊 **Confidence:** Grade ${data.confidence_grade} ${data.overall_confidence}% (±${data.tolerance_pct}%)\n\nLine items have been populated below. Use the **"Build Siding Estimate"** button to rebuild if needed.`,
        timestamp: new Date().toISOString()
      }]);
    } catch (error) {
      console.error('Siding analysis error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ **Error measuring siding:**\n\n${error.message}\n\n• Make sure GOOGLE_MAPS_API_KEY is set\n• Google Solar API must be enabled\n• Try a different address`,
        timestamp: new Date().toISOString()
      }]);
    }
    setIsSidingAnalyzing(false);
  };

  const PHOTO_LABEL_OPTIONS = ['Front', 'Back', 'Left Side', 'Right Side', 'Other'];

  const handleHousePhotoSelect = async (files) => {
    if (!files || files.length === 0) return;
    setIsUploadingPhotos(true);
    const newPhotos = [];
    for (const file of Array.from(files)) {
      try {
        const preview = URL.createObjectURL(file);
        const normalizedFile = new File([file], file.name.replace(/\.[^.]+$/, m => m.toLowerCase()), { type: file.type });
        const { file_url } = await base44.integrations.Core.UploadFile({ file: normalizedFile });
        newPhotos.push({ url: file_url, label: PHOTO_LABEL_OPTIONS[newPhotos.length] || 'Other', name: file.name, preview });
      } catch (err) {
        console.error('Photo upload error:', err);
      }
    }
    setHousePhotos(prev => [...prev, ...newPhotos].slice(0, 8));
    setIsUploadingPhotos(false);
  };

  const handleSlotPhotoSelect = async (file, slotLabel) => {
    if (!file) return;
    setUploadingSlot(slotLabel);
    try {
      const preview = URL.createObjectURL(file);
      const normalizedFile = new File([file], file.name.replace(/\.[^.]+$/, m => m.toLowerCase()), { type: file.type });
      const { file_url } = await base44.integrations.Core.UploadFile({ file: normalizedFile });
      setHousePhotos(prev => {
        const filtered = prev.filter(p => p.label !== slotLabel);
        return [...filtered, { url: file_url, label: slotLabel, name: file.name, preview }];
      });
    } catch (err) {
      console.error('Slot photo upload error:', err);
    }
    setUploadingSlot(null);
  };

  const handleAnalyzePhotos = async () => {
    if (housePhotos.length === 0) return;
    setIsAnalyzingPhotos(true);
    setPhotoSidingAnalysis(null);
    try {
      const isGarageMode = structureType === 'garage';
      const response = await base44.functions.invoke('analyzeHousePhotosForSiding', {
        photos: housePhotos.map(p => ({ url: p.url, label: p.label })),
        storyHeightFt: Number(config.storyHeightFt) || 9,
        openingDeductionPct: Number(config.openingDeductionPct) || 15,
        latitude: (!isGarageMode && useSatelliteMode) ? (satelliteAddress?.coordinates?.lat || satelliteAddress?.lat || null) : null,
        longitude: (!isGarageMode && useSatelliteMode) ? (satelliteAddress?.coordinates?.lng || satelliteAddress?.lng || null) : null,
        use_satellite: !isGarageMode && useSatelliteMode,
        structure_type: structureType,
      });
      const data = response?.data || response;
      if (data?.success === false) throw new Error(data.error || 'Photo analysis failed');
      setPhotoSidingAnalysis(data);
      // Auto-populate siding line items immediately
      await convertSidingMeasurementsToLineItems(data);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `${isGarageMode ? '🏗️' : useSatelliteMode ? '🛰️' : '📸'} **Siding estimate — ${isGarageMode ? 'Garage / Outbuilding (photos only)' : useSatelliteMode ? 'House satellite-assisted' : 'House photos only'}**\n\n📐 **Wall Area:** ${data.wall_area_sq?.toFixed(2)} SQ (${data.wall_area_sqft?.toLocaleString()} sqft)\n${data.is_garage_job ? '🏗️ **Garage/outbuilding**' : '🏠'} **${data.story_count} stor${data.story_count === 1 ? 'y' : 'ies'}** × ${data.story_height_ft}ft eave | ${data.windows_count} windows | ${data.doors_count} doors${data.garage_door_count > 0 ? ` | ${data.garage_door_count} garage door(s)` : ''}${data.gable_area_sqft > 0 ? `\n📐 **Gable area included:** ${data.gable_area_sqft} sqft (${(data.gable_area_sqft/100).toFixed(2)} SQ, ${data.gable_rise_ft}ft rise)` : ''}${isGarageMode ? '\n🏗️ **Garage mode** — satellite skipped, AI analyzed photos as a detached garage/outbuilding.' : !useSatelliteMode ? '\n📸 **Photos Only mode** — satellite was not used. All dimensions are from your uploaded photos.' : data.is_garage_job ? '\n⚠️ **Satellite footprint skipped** — photos show a garage/outbuilding.' : data.osm_perimeter_used ? '\n🗺️ **Footprint: OpenStreetMap** (traced building polygon — highest perimeter accuracy)' : data.used_satellite_footprint ? '\n📡 **Footprint: Solar API** (corrected bounding box)' : '\n📸 **Footprint: Photo-derived** (satellite unavailable or mismatched)'}${data.height_clamped ? '\n⚠️ **Wall height auto-corrected** — photo AI estimated an implausible height; capped to story-count maximum.' : ''}${data.sanity_warning ? `\n**${data.sanity_warning}**` : ''}\n🎨 **Material:** ${data.siding_material || 'unknown'} (${data.siding_condition || 'unknown'} condition)\n📊 **Confidence:** Grade ${data.confidence_grade} ${data.overall_confidence}% (±${data.tolerance_pct}%)\n\nLine items have been populated below. Use the **"Build Siding Estimate"** button to rebuild if needed.`,
        timestamp: new Date().toISOString()
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ **Photo analysis error:** ${error.message}\n\nTips:\n• Use clear, well-lit exterior photos\n• Make sure the full wall is visible\n• Try uploading front and side views`,
        timestamp: new Date().toISOString()
      }]);
    }
    setIsAnalyzingPhotos(false);
  };

  // NEW: Generate combined estimate from all structures and manual add-ons
  const handleGenerateCombinedEstimate = async () => {
    if (analyzedStructures.length === 0 && manualMeasurements.length === 0) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ No measurements available to generate an estimate. Please analyze a property or draw manually.`,
        timestamp: new Date().toISOString()
      }]);
      return;
    }

    let combinedAnalysis = {
      roof_area_sq: 0,
      roof_area_sqft: 0,
      corrected_area_sq: 0,
      ridge_lf: 0,
      hip_lf: 0,
      valley_lf: 0,
      rake_lf: 0,
      eave_lf: 0,
      step_flashing_lf: 0,
      apron_flashing_lf: 0,
      pitch: '7/12',
      satellite_image_url: null,
      overall_confidence: 100,
      structures: [],
      manual_measurements_details: [],
      analysis_notes: 'Combined measurements'
    };

    // Filter out excluded structures (include/exclude toggles)
    const activeStructures = analyzedStructures.filter(s => !excludedStructureIds.has(s.id));

    if (activeStructures.length > 0) {
      combinedAnalysis.roof_area_sq = activeStructures.reduce((sum, s) => sum + (s.analysis.roof_area_sq || 0), 0);
      combinedAnalysis.roof_area_sqft = activeStructures.reduce((sum, s) => sum + (s.analysis.roof_area_sqft || 0), 0);
      combinedAnalysis.corrected_area_sq = activeStructures.reduce((sum, s) => sum + (s.analysis.corrected_area_sq || s.analysis.roof_area_sq || 0), 0);
      combinedAnalysis.ridge_lf = activeStructures.reduce((sum, s) => sum + (s.analysis.ridge_lf || 0), 0);
      combinedAnalysis.hip_lf = activeStructures.reduce((sum, s) => sum + (s.analysis.hip_lf || 0), 0);
      combinedAnalysis.valley_lf = activeStructures.reduce((sum, s) => sum + (s.analysis.valley_lf || 0), 0);
      combinedAnalysis.rake_lf = activeStructures.reduce((sum, s) => sum + (s.analysis.rake_lf || 0), 0);
      combinedAnalysis.eave_lf = activeStructures.reduce((sum, s) => sum + (s.analysis.eave_lf || 0), 0);
      combinedAnalysis.step_flashing_lf = activeStructures.reduce((sum, s) => sum + (s.analysis.step_flashing_lf || 0), 0);
      combinedAnalysis.apron_flashing_lf = activeStructures.reduce((sum, s) => sum + (s.analysis.apron_flashing_lf || 0), 0);
      combinedAnalysis.pitch = activeStructures[0].analysis.pitch;
      combinedAnalysis.satellite_image_url = activeStructures[0].analysis.satellite_image_url;
      combinedAnalysis.overall_confidence = Math.min(...activeStructures.map(s => s.analysis.overall_confidence || 80));
      combinedAnalysis.structures = activeStructures;
      combinedAnalysis.analysis_notes = activeStructures[0].analysis.analysis_notes;
      combinedAnalysis.pitch_multiplier = activeStructures[0].analysis.pitch_multiplier;
      combinedAnalysis.tolerance_pct = Math.max(...activeStructures.map(s => s.analysis.tolerance_pct || 8));
    }

    if (manualMeasurements.length > 0) {
      combinedAnalysis.roof_area_sq += manualMeasurements.reduce((sum, m) => sum + (m.roof_area_sq || 0), 0);
      combinedAnalysis.roof_area_sqft += manualMeasurements.reduce((sum, m) => sum + (m.roof_area_sqft || 0), 0);
      combinedAnalysis.corrected_area_sq += manualMeasurements.reduce((sum, m) => sum + (m.roof_area_sq || 0), 0);
      combinedAnalysis.ridge_lf += manualMeasurements.reduce((sum, m) => sum + (m.ridge_lf || 0), 0);
      combinedAnalysis.hip_lf += manualMeasurements.reduce((sum, m) => sum + (m.hip_lf || 0), 0);
      combinedAnalysis.valley_lf += manualMeasurements.reduce((sum, m) => sum + (m.valley_lf || 0), 0);
      combinedAnalysis.rake_lf += manualMeasurements.reduce((sum, m) => sum + (m.rake_lf || 0), 0);
      combinedAnalysis.eave_lf += manualMeasurements.reduce((sum, m) => sum + (m.eave_lf || 0), 0);
      combinedAnalysis.step_flashing_lf += manualMeasurements.reduce((sum, m) => sum + (m.step_flashing_lf || 0), 0);
      combinedAnalysis.apron_flashing_lf += manualMeasurements.reduce((sum, m) => sum + (m.apron_flashing_lf || 0), 0);
      combinedAnalysis.analysis_notes = (combinedAnalysis.analysis_notes ? combinedAnalysis.analysis_notes + '\n' : '') + `Manual Add-ons: ${manualMeasurements.reduce((sum, m) => sum + m.roof_area_sq, 0).toFixed(2)} SQ`;
      combinedAnalysis.manual_measurements_details = manualMeasurements;
    }
    
    // 3. Add gutters from UI state (these are already synced with combined eaves by useEffect)
    combinedAnalysis.gutter_lf = includeGuttersAI ? aiGutterLF : 0;
    combinedAnalysis.downspout_count = includeGuttersAI ? aiDownspoutCount : 0;

    console.log('📏 Combined measurements about to convert:', combinedAnalysis);
    
    // Generate based on user's roof type selection
    try {
      if (config.specialty === 'siding') {
        // For siding jobs: auto-run siding measurement instead of roof estimate
        await handleAnalyzeSiding();
      } else if (roofTypeSelection === "flat") {
        await convertFlatRoofToLineItems(combinedAnalysis);
      } else if (roofTypeSelection === "metal") {
        await convertMetalRoofToLineItems(combinedAnalysis);
      } else {
        await convertMeasurementsToLineItems(combinedAnalysis);
      }
    } catch (err) {
      console.error('Generate estimate error:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Error generating estimate: ${err.message}. Please try again.`,
        timestamp: new Date().toISOString()
      }]);
      return;
    }

    // After generating the estimate, reset state for new property or further additions
    setIsAddingStructure(false);
    setManualAddOnMode(false);
    setManualMeasurements([]);
  };

  // NEW: Regenerate estimate when gutters are toggled or values changed
  const handleRegenerateWithGutters = async (overrideInclude = null, overrideGutterLF = null, overrideDownspoutCount = null) => {
    if (analyzedStructures.length === 0 && manualMeasurements.length === 0) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ No measurements available to regenerate.`,
        timestamp: new Date().toISOString()
      }]);
      return;
    }

    let combinedAnalysis = {
      roof_area_sq: 0, roof_area_sqft: 0, corrected_area_sq: 0, ridge_lf: 0, hip_lf: 0,
      valley_lf: 0, rake_lf: 0, eave_lf: 0, step_flashing_lf: 0, apron_flashing_lf: 0,
      pitch: '7/12', satellite_image_url: null, overall_confidence: 100,
      structures: [], manual_measurements_details: [], analysis_notes: 'Combined measurements'
    };

    const activeStructures2 = analyzedStructures.filter(s => !excludedStructureIds.has(s.id));
    if (activeStructures2.length > 0) {
      combinedAnalysis.roof_area_sq = activeStructures2.reduce((sum, s) => sum + (s.analysis.roof_area_sq || 0), 0);
      combinedAnalysis.roof_area_sqft = activeStructures2.reduce((sum, s) => sum + (s.analysis.roof_area_sqft || 0), 0);
      combinedAnalysis.corrected_area_sq = activeStructures2.reduce((sum, s) => sum + (s.analysis.corrected_area_sq || s.analysis.roof_area_sq || 0), 0);
      combinedAnalysis.ridge_lf = activeStructures2.reduce((sum, s) => sum + (s.analysis.ridge_lf || 0), 0);
      combinedAnalysis.hip_lf = activeStructures2.reduce((sum, s) => sum + (s.analysis.hip_lf || 0), 0);
      combinedAnalysis.valley_lf = activeStructures2.reduce((sum, s) => sum + (s.analysis.valley_lf || 0), 0);
      combinedAnalysis.rake_lf = activeStructures2.reduce((sum, s) => sum + (s.analysis.rake_lf || 0), 0);
      combinedAnalysis.eave_lf = activeStructures2.reduce((sum, s) => sum + (s.analysis.eave_lf || 0), 0);
      combinedAnalysis.step_flashing_lf = activeStructures2.reduce((sum, s) => sum + (s.analysis.step_flashing_lf || 0), 0);
      combinedAnalysis.apron_flashing_lf = activeStructures2.reduce((sum, s) => sum + (s.analysis.apron_flashing_lf || 0), 0);
      combinedAnalysis.pitch = activeStructures2[0].analysis.pitch;
      combinedAnalysis.satellite_image_url = activeStructures2[0].analysis.satellite_image_url;
      combinedAnalysis.overall_confidence = Math.min(...activeStructures2.map(s => s.analysis.overall_confidence || 80));
      combinedAnalysis.structures = activeStructures2;
      combinedAnalysis.analysis_notes = activeStructures2[0].analysis.analysis_notes;
      combinedAnalysis.pitch_multiplier = activeStructures2[0].analysis.pitch_multiplier;
      combinedAnalysis.tolerance_pct = Math.max(...activeStructures2.map(s => s.analysis.tolerance_pct || 8));
    }

    if (manualMeasurements.length > 0) {
      combinedAnalysis.roof_area_sq += manualMeasurements.reduce((sum, m) => sum + (m.roof_area_sq || 0), 0);
      combinedAnalysis.roof_area_sqft += manualMeasurements.reduce((sum, m) => sum + (m.roof_area_sqft || 0), 0);
      combinedAnalysis.corrected_area_sq += manualMeasurements.reduce((sum, m) => sum + (m.roof_area_sq || 0), 0);
      combinedAnalysis.ridge_lf += manualMeasurements.reduce((sum, m) => sum + (m.ridge_lf || 0), 0);
      combinedAnalysis.hip_lf += manualMeasurements.reduce((sum, m) => sum + (m.hip_lf || 0), 0);
      combinedAnalysis.valley_lf += manualMeasurements.reduce((sum, m) => sum + (m.valley_lf || 0), 0);
      combinedAnalysis.rake_lf += manualMeasurements.reduce((sum, m) => sum + (m.rake_lf || 0), 0);
      combinedAnalysis.eave_lf += manualMeasurements.reduce((sum, m) => sum + (m.eave_lf || 0), 0);
      combinedAnalysis.step_flashing_lf += manualMeasurements.reduce((sum, m) => sum + (m.step_flashing_lf || 0), 0);
      combinedAnalysis.apron_flashing_lf += manualMeasurements.reduce((sum, m) => sum + (m.apron_flashing_lf || 0), 0);
      combinedAnalysis.analysis_notes = (combinedAnalysis.analysis_notes ? combinedAnalysis.analysis_notes + '\n' : '') + `Manual Add-ons: ${manualMeasurements.reduce((sum, m) => sum + m.roof_area_sq, 0).toFixed(2)} SQ`;
      combinedAnalysis.manual_measurements_details = manualMeasurements;
    }

    const effectiveInclude = overrideInclude !== null ? overrideInclude : includeGuttersAI;
    const effectiveGutterLF = overrideGutterLF !== null ? overrideGutterLF : aiGutterLF;
    const effectiveDownspoutCount = overrideDownspoutCount !== null ? overrideDownspoutCount : aiDownspoutCount;
    combinedAnalysis.gutter_lf = effectiveInclude ? effectiveGutterLF : 0;
    combinedAnalysis.downspout_count = effectiveInclude ? effectiveDownspoutCount : 0;

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `🔄 **Regenerating estimate${effectiveInclude ? ' with gutters & downspouts' : ' without gutters'}...**`,
      timestamp: new Date().toISOString()
    }]);

    // Generate based on user's roof type selection
    try {
      if (config.specialty === 'siding') {
        await handleAnalyzeSiding();
      } else if (roofTypeSelection === "flat") {
        await convertFlatRoofToLineItems(combinedAnalysis);
      } else if (roofTypeSelection === "metal") {
        await convertMetalRoofToLineItems(combinedAnalysis);
      } else {
        await convertMeasurementsToLineItems(combinedAnalysis);
      }
    } catch (err) {
      console.error('Regenerate estimate error:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Error regenerating estimate: ${err.message}. Please try again.`,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  // NEW: Convert metal roof measurements to line items
  const convertMetalRoofToLineItems = async (measurements) => {
    console.log('🔩 Converting METAL ROOF measurements to line items:', measurements);
    saveToHistory();
    const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });
    const { items, squares } = buildMetalRoofLineItems(measurements, priceList);
    console.log('✅ Metal roof line items created:', items);
    setLineItems(items);
    const total = items.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
    const titleText = `${squares.toFixed(2)} SQ Metal Roof - ${satelliteAddress?.address || measurements.customer_info?.property_address || 'Property'}`;
    setCurrentEstimate({ title: titleText, roof_area_sq: squares });
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✅ **Created Complete METAL ROOF Estimate!**\n\n📊 **${items.length} items** • **Total: $${total.toLocaleString()}**\n\n🔩 All necessary metal components, flashing, and fasteners included.`,
      timestamp: new Date().toISOString()
    }]);
  };

  // NEW: Convert flat roof measurements to line items
  const convertFlatRoofToLineItems = async (measurements) => {
    console.log('🏢 Converting FLAT ROOF measurements to line items:', measurements);
    saveToHistory();
    const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });
    const { items, squares, perimeter, drainCount } = buildFlatRoofLineItems(measurements, priceList);
    console.log('✅ Flat roof line items created:', items);
    setLineItems(items);
    const total = items.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
    const titleText = `${squares.toFixed(2)} SQ Flat Roof (EPDM) - ${measurements.customer_info?.property_address || 'Commercial Property'}`;
    setCurrentEstimate({ title: titleText, roof_area_sq: squares });
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✅ **Created COMPLETE Flat Roof Estimate (EPDM System)!**\n\n📊 **${items.length} items** • **Total: $${total.toLocaleString()}**\n\n🏢 Roof: ${squares.toFixed(2)} SQ\n📏 Perimeter: ${perimeter.toFixed(0)} LF\n🚰 Drains: ${drainCount}\n\n💡 *Tip: Ask AI to "switch to TPO" or "add torch down cap sheet" if needed*`,
      timestamp: new Date().toISOString()
    }]);
    if (measurements.customer_info) {
      setCustomerInfo(prev => ({
        ...prev,
        customer_name: measurements.customer_info.customer_name || prev.customer_name,
        property_address: measurements.customer_info.property_address || prev.property_address,
        claim_number: measurements.customer_info.claim_number || prev.claim_number
      }));
    }
  };

  const convertSidingMeasurementsToLineItems = async (measurements) => {
    console.log('🔄 convertSidingMeasurementsToLineItems called with:', measurements);
    saveToHistory();
    const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });
    console.log(`📋 Using ${pricingSource} price list with ${priceList.length} items for siding`);

    const { items, wallAreaSQ, wallAreaSF, wallTopLF, wallBottomLF, insideCornersLF, outsideCornersLF } = buildSidingLineItems(measurements, priceList, config.sidingWastePct);
    console.log('✅ Siding line items created:', items);
    console.log('📊 Total items:', items.length);
    setLineItems(items);
    const total = items.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
    const titleText = `${wallAreaSQ.toFixed(2)} SQ Siding - ${satelliteAddress?.address || measurements.customer_info?.property_address || 'Property'}`;
    setCurrentEstimate({ title: titleText, roof_area_sq: wallAreaSQ });
    const itemDescriptions = [];
    itemDescriptions.push(`🏠 Wall Area: ${wallAreaSQ.toFixed(2)} SQ (${wallAreaSF.toFixed(0)} SF)`);
    itemDescriptions.push(`Wall Top: ${wallTopLF.toFixed(0)} LF`);
    itemDescriptions.push(`Wall Bottom: ${wallBottomLF.toFixed(0)} LF`);
    itemDescriptions.push(`Inside Corners: ${measurements.inside_corners_count || 0} (${insideCornersLF.toFixed(0)} LF)`);
    itemDescriptions.push(`Outside Corners: ${measurements.outside_corners_count || 0} (${outsideCornersLF.toFixed(0)} LF)`);
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✅ **Created Complete Siding Estimate!**\n\n📊 **${items.length} items** • **Total: $${total.toLocaleString()}**\n\n${itemDescriptions.join('\n')}\n\n💡 *Ask AI to "add 10% waste" or "add 15% waste" when ready. Use "AI Review" to check for missing items like soffit, fascia, or trim*`,
      timestamp: new Date().toISOString()
    }]);
  };

  const convertMeasurementsToLineItemsArray = async (measurements) => {
    const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });
    return buildRoofLineItemsArray(measurements, priceList);
  };

  const convertSidingMeasurementsToLineItemsArray = async (measurements) => {
    const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });
    return buildSidingLineItemsArray(measurements, priceList, config.sidingWastePct);
  };

  const convertMeasurementsToLineItems = async (measurements, userMessage = '') => {
    console.log('🔄 convertMeasurementsToLineItems called with:', measurements);
    
    // Save to history before making changes
    saveToHistory();

    const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });

    console.log(`📋 Using ${pricingSource} price list with ${priceList.length} items`);

    if ((!measurements.roof_area_sq || Number(measurements.roof_area_sq) === 0) && Number(measurements.roof_area_sqft) > 0) {
      measurements.roof_area_sq = Number(measurements.roof_area_sqft) / 100;
    }

    const items = [];
    let lineNumber = 1;

    const normalizeRoof = normalizeRoofMeasurements;

    // Check if this is a multi-structure estimate
    const hasMultipleStructures = measurements.structures && measurements.structures.length > 1;

    const favorites = priceList.filter(item => item.is_favorite);
    console.log(`⭐ ${favorites.length} favorite items in price list`);

    const findExactRoofItem = (searchTerms, fallback) => {
      const globalExclude = ['vent', 'window', 'kit', 'labor minimum'];
      const mergedExclude = [...(searchTerms.exclude || []), ...globalExclude];
      return findItemInPriceList(priceList, { ...searchTerms, exclude: mergedExclude }, fallback, { favoritesPriority: favorites.length > 0 });
    };

    // If multiple structures, generate line items for EACH structure separately
    if (hasMultipleStructures) {
      for (const structure of measurements.structures) {
        // Support both {analysis:{...}} and flat structure {...}
        const s = normalizeRoof((structure && structure.analysis) ? structure.analysis : (structure || {}));
        const name = (structure?.name || s?.name || 'Structure').toString();
        const correctedSq = Number(s.corrected_area_sq) || Number(s.roof_area_sq) || 0;
        const flatSq = Number(s.roof_area_sq) || 0;
        const pitch = s.pitch || 'Unknown';
        const confidence = s.overall_confidence != null ? s.overall_confidence : 80;
        const grade = s.confidence_grade || '';
        const tolerance = s.tolerance_pct || '';

        items.push({
          line: lineNumber++,
          code: '',
          description: `━━━ ${name.toUpperCase()} (${correctedSq.toFixed(2)} SQ) ━━━`,
          quantity: 0,
          unit: '',
          rate: 0,
          rcv: 0,
          acv: 0,
          amount: 0,
          depreciation: 0,
          long_description: `${pitch} pitch • Grade ${grade} ${confidence}%${tolerance ? ` (+/-${tolerance}%)` : ''} • Flat: ${flatSq.toFixed(2)} SQ`
        });

        const structMeasurements = normalizeRoof(s);

        if ((Number(structMeasurements.corrected_area_sq || structMeasurements.roof_area_sq) || (Number(structMeasurements.roof_area_sqft)/100)) > 0) {
          const shingleItem = findExactRoofItem({
            codes: ['RFG SSSQ', 'SHINGLE', 'LAMINATED - COMP SH'],
            keywords: ['architectural asphalt', 'laminated comp', 'asphalt shingle'],
            exclude: ['wood', 'shake', 'cedar', 'tile', 'metal', 'slate', 'steep', 'surcharge', 'tear', 'ridge', 'hip', 'starter', 'valley', 'eave', 'rake']
          }, { price: 350, unit: "SQ", code: "RFG SSSQ", description: "Shingles, architectural asphalt" });
          const price = Number(shingleItem.price) || 0;
          const sqQty = Number(structMeasurements.corrected_area_sq) || Number(structMeasurements.roof_area_sq) || (Number(structMeasurements.roof_area_sqft)/100) || 0;
          items.push({ line: lineNumber++, code: shingleItem.code, description: shingleItem.description, quantity: sqQty, unit: "SQ", rate: price, rcv: price * sqQty, acv: price * sqQty, amount: price * sqQty, depreciation: 0 });
        }

        // Underlayment
        if ((Number(structMeasurements.corrected_area_sq || structMeasurements.roof_area_sq) || (Number(structMeasurements.roof_area_sqft)/100)) > 0) {
          const underlaymentItem = findExactRoofItem({ codes: ['RFG UL', 'UL'], keywords: ['underlayment', 'felt', 'synthetic'], exclude: ['vertical', 'units', 'ice', 'water', 'barrier'] }, { price: 25, unit: "SQ", code: "RFG UL", description: "Underlayment, #30 felt" });
          const price = Number(underlaymentItem.price) || 0;
          const ulQty = Number(structMeasurements.corrected_area_sq) || Number(structMeasurements.roof_area_sq) || (Number(structMeasurements.roof_area_sqft)/100) || 0;
          items.push({ line: lineNumber++, code: underlaymentItem.code, description: underlaymentItem.description, quantity: ulQty, unit: "SQ", rate: price, rcv: price * ulQty, acv: price * ulQty, amount: price * ulQty, depreciation: 0 });
        }

        // Ice & Water Shield
        const eavesLF = Number(structMeasurements.eave_lf) || 0;
        const valleysLF = Number(structMeasurements.valley_lf) || 0;
        const totalIceWater = Math.ceil((eavesLF * 2 + valleysLF) * 1.10);
        if (totalIceWater > 0) {
          const iceWaterItem = findExactRoofItem({ codes: ['IWS', 'RFG IWS'], keywords: ['ice & water barrier', 'ice and water'] }, { price: 2.02, unit: "LF", code: "IWS", description: "Ice & water barrier" });
          const price = Number(iceWaterItem.price) || 0;
          items.push({ line: lineNumber++, code: iceWaterItem.code, description: iceWaterItem.description, quantity: totalIceWater, unit: "LF", rate: price, rcv: price * totalIceWater, acv: price * totalIceWater, amount: price * totalIceWater, depreciation: 0 });
        }

        // Starter, Drip, Ridge, Hip, Valley, Step Flashing, Tear Off for this structure
        const rakeLF = Number(structMeasurements.rake_lf) || 0;
        const totalEdge = rakeLF + eavesLF;
        if (totalEdge > 0) {
          const starterItem = findExactRoofItem({ codes: ['RFG STR', 'STARTER'], keywords: ['starter strip', 'starter shingle'] }, { price: 2.5, unit: "LF", code: "RFG STR", description: "Starter strip, 3-tab asphalt" });
          items.push({ line: lineNumber++, code: starterItem.code, description: starterItem.description, quantity: totalEdge, unit: "LF", rate: Number(starterItem.price), rcv: Number(starterItem.price) * totalEdge, acv: Number(starterItem.price) * totalEdge, amount: Number(starterItem.price) * totalEdge, depreciation: 0 });
          
          const dripItem = findExactRoofItem({ codes: ['RFG DE', 'DRIP'], keywords: ['drip edge', 'drip metal'] }, { price: 3, unit: "LF", code: "RFG DE", description: "Drip edge, metal" });
          items.push({ line: lineNumber++, code: dripItem.code, description: dripItem.description, quantity: totalEdge, unit: "LF", rate: Number(dripItem.price), rcv: Number(dripItem.price) * totalEdge, acv: Number(dripItem.price) * totalEdge, amount: Number(dripItem.price) * totalEdge, depreciation: 0 });
        }

        if (structMeasurements.ridge_lf > 0) {
          const ridgeItem = findExactRoofItem({ codes: ['RFG RDC', 'RFG HP'], keywords: ['ridge cap', 'hip cap', 'architectural asphalt'] }, { price: 8.5, unit: "LF", code: "RFG RDC", description: "Ridge cap, architectural asphalt" });
          items.push({ line: lineNumber++, code: ridgeItem.code, description: ridgeItem.description, quantity: structMeasurements.ridge_lf, unit: "LF", rate: Number(ridgeItem.price), rcv: Number(ridgeItem.price) * structMeasurements.ridge_lf, acv: Number(ridgeItem.price) * structMeasurements.ridge_lf, amount: Number(ridgeItem.price) * structMeasurements.ridge_lf, depreciation: 0 });
        }

        if (structMeasurements.hip_lf > 0) {
          const hipItem = findExactRoofItem({ codes: ['RFG HP'], keywords: ['hip cap', 'architectural asphalt'] }, { price: 8.5, unit: "LF", code: "RFG HP", description: "Hip cap, architectural asphalt" });
          items.push({ line: lineNumber++, code: hipItem.code, description: hipItem.description, quantity: structMeasurements.hip_lf, unit: "LF", rate: Number(hipItem.price), rcv: Number(hipItem.price) * structMeasurements.hip_lf, acv: Number(hipItem.price) * structMeasurements.hip_lf, amount: Number(hipItem.price) * structMeasurements.hip_lf, depreciation: 0 });
        }

        if (valleysLF > 0) {
          const valleyItem = findExactRoofItem({ codes: ['VMTLWP', 'RFG VLY'], keywords: ['valley metal', 'valley flashing'] }, { price: 12, unit: "LF", code: "VMTLWP", description: "Valley metal - (W) profile - painted" });
          items.push({ line: lineNumber++, code: valleyItem.code, description: valleyItem.description, quantity: valleysLF, unit: "LF", rate: Number(valleyItem.price), rcv: Number(valleyItem.price) * valleysLF, acv: Number(valleyItem.price) * valleysLF, amount: Number(valleyItem.price) * valleysLF, depreciation: 0 });
        }

        if (structMeasurements.step_flashing_lf > 0) {
          const flashingItem = findExactRoofItem({ codes: ['RFG FLS', 'STEP FLSH'], keywords: ['step flashing metal', 'flashing step'] }, { price: 4.5, unit: "LF", code: "RFG FLS", description: "Step flashing, metal" });
          items.push({ line: lineNumber++, code: flashingItem.code, description: flashingItem.description, quantity: structMeasurements.step_flashing_lf, unit: "LF", rate: Number(flashingItem.price), rcv: Number(flashingItem.price) * structMeasurements.step_flashing_lf, acv: Number(flashingItem.price) * structMeasurements.step_flashing_lf, amount: Number(flashingItem.price) * structMeasurements.step_flashing_lf, depreciation: 0 });
        }

        if (structMeasurements.apron_flashing_lf > 0) {
          const apronFlashItem = findExactRoofItem({ codes: ['RFG FLSA', 'APRON'], keywords: ['apron flashing', 'head wall flashing', 'headwall'] }, { price: 5.5, unit: "LF", code: "RFG FLSA", description: "Apron/head wall flashing, metal" });
          items.push({ line: lineNumber++, code: apronFlashItem.code, description: apronFlashItem.description, quantity: structMeasurements.apron_flashing_lf, unit: "LF", rate: Number(apronFlashItem.price), rcv: Number(apronFlashItem.price) * structMeasurements.apron_flashing_lf, acv: Number(apronFlashItem.price) * structMeasurements.apron_flashing_lf, amount: Number(apronFlashItem.price) * structMeasurements.apron_flashing_lf, depreciation: 0 });
        }

        if ((Number(structMeasurements.corrected_area_sq || structMeasurements.roof_area_sq) || (Number(structMeasurements.roof_area_sqft)/100)) > 0) {
          const toSqQty = Number(structMeasurements.corrected_area_sq) || Number(structMeasurements.roof_area_sq) || (Number(structMeasurements.roof_area_sqft)/100);
          const tearOffItem = findExactRoofItem({ codes: ['RFG R&R', 'TEAR', 'ARMV'], keywords: ['remove roof covering', 'tear off', 'remove shingle', '3 tab', '3-tab', 'tier 3 tab'], exclude: ['slate', 'tile', 'metal', 'cedar', 'shake', 'wood', 'membrane', 'modified', 'built-up', 'tar', 'gravel'] }, { price: 75, unit: "SQ", code: "RFG R&R", description: "Remove roof covering, 3-tab composition shingle" });
          items.push({ line: lineNumber++, code: tearOffItem.code, description: tearOffItem.description, quantity: toSqQty, unit: "SQ", rate: Number(tearOffItem.price), rcv: Number(tearOffItem.price) * toSqQty, acv: Number(tearOffItem.price) * toSqQty, amount: Number(tearOffItem.price) * toSqQty, depreciation: 0 });
        }
      }

      // After all structures, add gutters if any
      if (measurements.gutter_lf && measurements.gutter_lf > 0) {
        const gutterItem = findExactRoofItem({ codes: ['RFG GTR', 'GUTTER'], keywords: ['gutter aluminum', 'gutter k-style', 'gutter / downspout'] }, { price: 10.33, unit: "LF", code: "RFG GTR", description: "Gutter / downspout - aluminum - up to 5\"" });
        items.push({ line: lineNumber++, code: gutterItem.code, description: gutterItem.description, quantity: measurements.gutter_lf, unit: "LF", rate: Number(gutterItem.price), rcv: Number(gutterItem.price) * measurements.gutter_lf, acv: Number(gutterItem.price) * measurements.gutter_lf, amount: Number(gutterItem.price) * measurements.gutter_lf, depreciation: 0 });
      }

      if (measurements.downspout_count && measurements.downspout_count > 0) {
        const downspoutItem = findExactRoofItem({ codes: ['DNSPOUT', 'RFG DS'], keywords: ['downspout', 'down spout'] }, { price: 45.00, unit: "EA", code: "DNSPOUT", description: "Downspout - aluminum - 2\" x 3\"" });
        items.push({ line: lineNumber++, code: downspoutItem.code, description: downspoutItem.description, quantity: measurements.downspout_count, unit: "EA", rate: Number(downspoutItem.price), rcv: Number(downspoutItem.price) * measurements.downspout_count, acv: Number(downspoutItem.price) * measurements.downspout_count, amount: Number(downspoutItem.price) * measurements.downspout_count, depreciation: 0 });
      }

      console.log('✅ Line items created with structure breakdown:', items);
      console.log('📊 Total items:', items.length);

      const multiWaste = Number(measurements.waste_percentage) || 12;
      const multiWastedItems = applyWasteToLineItems(items, multiWaste);
      
      setLineItems(multiWastedItems);

      const total = multiWastedItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);

      const combinedSq = Number(measurements.corrected_area_sq) || Number(measurements.roof_area_sq) || 0;
      const multiPerSq = combinedSq > 0 ? Math.round(total / combinedSq) : 0;
      let titleText = `${combinedSq ? combinedSq.toFixed(2) : 'Multi-Structure'} SQ Roof`;
      if (measurements.structures && measurements.structures.length > 1) {
        titleText += ` (${measurements.structures.length} structures)`;
      }
      if (satelliteAddress?.address) {
        titleText += ` - ${satelliteAddress.address}`;
      }

      setCurrentEstimate({ title: titleText, roof_area_sq: combinedSq });

      const itemDescriptions = [`${measurements.structures.length} structures measured separately`];
      itemDescriptions.push(`${multiWaste}% waste included`);
      if (measurements.gutter_lf > 0) itemDescriptions.push(`Gutters: ${measurements.gutter_lf.toFixed(0)} LF`);
      if (measurements.downspout_count > 0) itemDescriptions.push(`Downspouts: ${measurements.downspout_count}`);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `**Created Multi-Structure Estimate!**\n\n**${multiWastedItems.length} items** | **Total: $${total.toLocaleString()}** | **$${multiPerSq}/SQ**\n\n${itemDescriptions.join(' | ')}\n\nSay "make it $520 per sq" to adjust pricing.`,
        timestamp: new Date().toISOString()
      }]);

      return;
    }

    measurements = normalizeRoof(measurements);
    const useCorrectedArea = Number(measurements.corrected_area_sq) || Number(measurements.roof_area_sq) || 0;
    if (useCorrectedArea > 0) {
      const shingleItem = findExactRoofItem({
        codes: ['RFG SSSQ', 'SHINGLE', 'LAMINATED - COMP SH'],
        keywords: ['architectural asphalt', 'laminated comp', 'asphalt shingle'],
        exclude: ['wood', 'shake', 'cedar', 'tile', 'metal', 'slate', 'steep', 'surcharge', 'tear', 'ridge', 'hip', 'starter', 'valley', 'eave', 'rake']
      }, {
        price: 350,
        unit: "SQ",
        code: "RFG SSSQ",
        description: "Shingles, architectural asphalt"
      });
      
      const price = Number(shingleItem.price) || 0;
      const qty = useCorrectedArea;
      
      items.push({
        line: lineNumber++,
        code: shingleItem.code,
        description: shingleItem.description,
        quantity: qty,
        unit: "SQ",
        rate: price,
        rcv: price * qty,
        acv: price * qty,
        amount: price * qty,
        depreciation: 0
      });
    }

    if (useCorrectedArea > 0) {
      const underlaymentItem = findExactRoofItem({
        codes: ['RFG UL', 'UL'],
        keywords: ['underlayment', 'felt', 'synthetic'],
        exclude: ['vertical', 'units', 'ice', 'water', 'barrier']
      }, {
        price: 25,
        unit: "SQ",
        code: "RFG UL",
        description: "Underlayment, #30 felt"
      });
      
      const price = Number(underlaymentItem.price) || 0;
      const qty = useCorrectedArea;
      
      items.push({
        line: lineNumber++,
        code: underlaymentItem.code,
        description: underlaymentItem.description,
        quantity: qty,
        unit: "SQ",
        rate: price,
        rcv: price * qty,
        acv: price * qty,
        amount: price * qty,
        depreciation: 0
      });
    }

    // 3. ICE & WATER SHIELD
    const eavesLF = Number(measurements.eave_lf) || 0;
    const valleysLF = Number(measurements.valley_lf) || 0;
    
    const iceWaterEaves = eavesLF * 2;
    const iceWaterValleys = valleysLF * 1;
    const iceWaterBaseTotal = iceWaterEaves + iceWaterValleys;
    const totalIceWater = Math.ceil(iceWaterBaseTotal * 1.10);
    
    if (totalIceWater > 0) {
      const iceWaterItem = findExactRoofItem({
        codes: ['IWS', 'RFG IWS'],
        keywords: ['ice & water barrier', 'ice and water']
      }, {
        price: 2.02,
        unit: "LF",
        code: "IWS",
        description: "Ice & water barrier"
      });
      
      const price = Number(iceWaterItem.price) || 0;
      const rollsNeeded = Math.ceil(totalIceWater / 50);
      const iceWaterSquares = (totalIceWater * 3) / 100;
      
      items.push({
        line: lineNumber++,
        code: iceWaterItem.code,
        description: iceWaterItem.description,
        quantity: totalIceWater,
        unit: "LF",
        rate: price,
        rcv: price * totalIceWater,
        acv: price * totalIceWater,
        amount: price * totalIceWater,
        depreciation: 0,
        notes: `≈${iceWaterSquares.toFixed(1)} SQ (≈${rollsNeeded} rolls @ 50 LF/roll). Code requires 24" inside warm wall per IRC R905.2.7.1`
      });
    }

    // 4. STARTER STRIP
    const rakeLF = Number(measurements.rake_lf) || 0;
    const totalEdge = rakeLF + eavesLF;
    
    if (totalEdge > 0) {
      const starterItem = findExactRoofItem({
        codes: ['RFG STR', 'STARTER'],
        keywords: ['starter strip', 'starter shingle']
      }, {
        price: 2.5,
        unit: "LF",
        code: "RFG STR",
        description: "Starter strip, 3-tab asphalt"
      });
      
      const price = Number(starterItem.price) || 0;
      
      items.push({
        line: lineNumber++,
        code: starterItem.code,
        description: starterItem.description,
        quantity: totalEdge,
        unit: "LF",
        rate: price,
        rcv: price * totalEdge,
        acv: price * totalEdge,
        amount: price * totalEdge,
        depreciation: 0
      });
    }

    // 5. DRIP EDGE
    if (totalEdge > 0) {
      const dripItem = findExactRoofItem({
        codes: ['RFG DE', 'DRIP'],
        keywords: ['drip edge', 'drip metal']
      }, {
        price: 3,
        unit: "LF",
        code: "RFG DE",
        description: "Drip edge, metal"
      });
      
      const price = Number(dripItem.price) || 0;
      
      items.push({
        line: lineNumber++,
        code: dripItem.code,
        description: dripItem.description,
        quantity: totalEdge,
        unit: "LF",
        rate: price,
        rcv: price * totalEdge,
        acv: price * totalEdge,
        amount: price * totalEdge,
        depreciation: 0
      });
    }

    // 6. RIDGE CAP
    const ridgeLF = Number(measurements.ridge_lf) || 0;
    
    if (ridgeLF > 0) {
      const ridgeItem = findExactRoofItem({
        codes: ['RFG RDC', 'RFG HP'],
        keywords: ['ridge cap', 'hip cap', 'architectural asphalt']
      }, {
        price: 8.5,
        unit: "LF",
        code: "RFG RDC",
        description: "Ridge cap, architectural asphalt"
      });
      
      const price = Number(ridgeItem.price) || 0;
      
      items.push({
        line: lineNumber++,
        code: ridgeItem.code,
        description: ridgeItem.description,
        quantity: ridgeLF,
        unit: "LF",
        rate: price,
        rcv: price * ridgeLF,
        acv: price * ridgeLF,
        amount: price * ridgeLF,
        depreciation: 0
      });
    }

    // 7. HIP CAP
    const hipLF = Number(measurements.hip_lf) || 0;
    
    if (hipLF > 0) {
      const hipItem = findExactRoofItem({
        codes: ['RFG HP'],
        keywords: ['hip cap', 'architectural asphalt']
      }, {
        price: 8.5,
        unit: "LF",
        code: "RFG HP",
        description: "Hip cap, architectural asphalt"
      });
      
      const price = Number(hipItem.price) || 0;
      
      items.push({
        line: lineNumber++,
        code: hipItem.code,
        description: hipItem.description,
        quantity: hipLF,
        unit: "LF",
        rate: price,
        rcv: price * hipLF,
        acv: price * hipLF,
        amount: price * hipLF,
        depreciation: 0
      });
    }

    // 8. VALLEY FLASHING
    if (valleysLF > 0) {
      const valleyItem = findExactRoofItem({
        codes: ['VMTLWP', 'RFG VLY'],
        keywords: ['valley metal', 'valley flashing']
      }, {
        price: 12,
        unit: "LF",
        code: "VMTLWP",
        description: "Valley metal - (W) profile - painted"
      });
      
      const price = Number(valleyItem.price) || 0;
      
      items.push({
        line: lineNumber++,
        code: valleyItem.code,
        description: valleyItem.description,
        quantity: valleysLF,
        unit: "LF",
        rate: price,
        rcv: price * valleysLF,
        acv: price * valleysLF,
        amount: price * valleysLF,
        depreciation: 0
      });
    }

    // 9. STEP FLASHING
    const stepFlashLF = Number(measurements.step_flashing_lf) || 0;
    
    if (stepFlashLF > 0) {
      const flashingItem = findExactRoofItem({
        codes: ['RFG FLS', 'STEP FLSH'],
        keywords: ['step flashing metal', 'flashing step']
      }, {
        price: 4.5,
        unit: "LF",
        code: "RFG FLS",
        description: "Step flashing, metal"
      });
      
      const price = Number(flashingItem.price) || 0;
      
      items.push({
        line: lineNumber++,
        code: flashingItem.code,
        description: flashingItem.description,
        quantity: stepFlashLF,
        unit: "LF",
        rate: price,
        rcv: price * stepFlashLF,
        acv: price * stepFlashLF,
        amount: price * stepFlashLF,
        depreciation: 0
      });
    }

    // 10. TEAR OFF
    const roofSQ = useCorrectedArea;
    
    if (roofSQ > 0) {
      const tearOffItem = findExactRoofItem({
        codes: ['RFG R&R', 'TEAR', 'ARMV'],
        keywords: ['remove roof covering', 'tear off', 'remove shingle', '3 tab', '3-tab', 'tier 3 tab'],
        exclude: ['slate', 'tile', 'metal', 'cedar', 'shake', 'wood', 'membrane', 'modified', 'built-up', 'tar', 'gravel']
      }, {
        price: 75,
        unit: "SQ",
        code: "RFG R&R",
        description: "Remove roof covering, 3-tab composition shingle"
      });
      
      const price = Number(tearOffItem.price) || 0;
      
      items.push({
        line: lineNumber++,
        code: tearOffItem.code,
        description: tearOffItem.description,
        quantity: roofSQ,
        unit: "SQ",
        rate: price,
        rcv: price * roofSQ,
        acv: price * roofSQ,
        amount: price * roofSQ,
        depreciation: 0
      });
    }

    // NEW: Add gutters and downspouts
    if (measurements.gutter_lf && measurements.gutter_lf > 0) {
      const gutterItem = findExactRoofItem({
        codes: ['RFG GTR', 'GUTTER'],
        keywords: ['gutter aluminum', 'gutter k-style', 'gutter / downspout']
      }, {
        price: 10.33,
        unit: "LF",
        code: "RFG GTR",
        description: "Gutter / downspout - aluminum - up to 5\""
      });
      
      const price = Number(gutterItem.price) || 0;
      const qty = Number(measurements.gutter_lf) || 0;
      
      items.push({
        line: lineNumber++,
        code: gutterItem.code,
        description: gutterItem.description,
        quantity: qty,
        unit: "LF",
        rate: price,
        rcv: price * qty,
        acv: price * qty,
        amount: price * qty,
        depreciation: 0
      });
      
      console.log(`✅ Added ${qty} LF of gutters @ $${price}/LF`);
    }

    if (measurements.downspout_count && measurements.downspout_count > 0) {
      const downspoutItem = findExactRoofItem({
        codes: ['DNSPOUT', 'RFG DS'],
        keywords: ['downspout', 'down spout']
      }, {
        price: 45.00,
        unit: "EA",
        code: "DNSPOUT",
        description: "Downspout - aluminum - 2\" x 3\""
      });
      
      const price = Number(downspoutItem.price) || 0;
      const qty = Number(measurements.downspout_count) || 0;
      
      items.push({
        line: lineNumber++,
        code: downspoutItem.code,
        description: downspoutItem.description,
        quantity: qty,
        unit: "EA",
        rate: price,
        rcv: price * qty,
        acv: price * qty,
        amount: price * qty,
        depreciation: 0
      });
      
      console.log(`✅ Added ${qty} downspouts @ $${price} each`);
    }

    // ROOF ACCESSORIES (detected from satellite)
    const pipeBoots = Number(measurements.pipe_boots) || 0;
    if (pipeBoots > 0) {
      const pipeItem = findExactRoofItem({ codes: ['RFG PB', 'PIPE BOOT'], keywords: ['pipe boot', 'pipe jack', 'pipe flashing', 'plumbing vent'] }, { price: 35, unit: "EA", code: "RFG PB", description: "Pipe boot / jack flashing" });
      const p = Number(pipeItem.price) || 0;
      items.push({ line: lineNumber++, code: pipeItem.code, description: pipeItem.description, quantity: pipeBoots, unit: "EA", rate: p, rcv: p * pipeBoots, acv: p * pipeBoots, amount: p * pipeBoots, depreciation: 0 });
    }

    const boxVents = Number(measurements.box_vents) || 0;
    if (boxVents > 0) {
      const ventItem = findExactRoofItem({ codes: ['RFG BV', 'BOX VENT'], keywords: ['box vent', 'roof vent', 'static vent'] }, { price: 65, unit: "EA", code: "RFG BV", description: "Roof vent - box type" });
      const p = Number(ventItem.price) || 0;
      items.push({ line: lineNumber++, code: ventItem.code, description: ventItem.description, quantity: boxVents, unit: "EA", rate: p, rcv: p * boxVents, acv: p * boxVents, amount: p * boxVents, depreciation: 0 });
    }

    const ridgeVentLF = Number(measurements.ridge_vent_lf) || 0;
    if (ridgeVentLF > 0) {
      const rvItem = findExactRoofItem({ codes: ['RFG RV', 'RIDGE VENT'], keywords: ['ridge vent', 'continuous ridge'] }, { price: 6.50, unit: "LF", code: "RFG RV", description: "Ridge vent, continuous" });
      const p = Number(rvItem.price) || 0;
      items.push({ line: lineNumber++, code: rvItem.code, description: rvItem.description, quantity: ridgeVentLF, unit: "LF", rate: p, rcv: p * ridgeVentLF, acv: p * ridgeVentLF, amount: p * ridgeVentLF, depreciation: 0 });
    }

    const satDish = Number(measurements.satellite_dish) || 0;
    if (satDish > 0) {
      items.push({ line: lineNumber++, code: "SAT D&R", description: "Satellite dish - detach & reset", quantity: satDish, unit: "EA", rate: 125, rcv: 125 * satDish, acv: 125 * satDish, amount: 125 * satDish, depreciation: 0 });
    }

    const chimSmall = Number(measurements.chimney_small) || 0;
    if (chimSmall > 0) {
      const chimItem = findExactRoofItem({ codes: ['RFG CF', 'CHIMNEY'], keywords: ['chimney flash'] }, { price: 350, unit: "EA", code: "RFG CF", description: "Chimney flashing - small (up to 30\" x 30\")" });
      const p = Number(chimItem.price) || 0;
      items.push({ line: lineNumber++, code: chimItem.code, description: chimItem.description, quantity: chimSmall, unit: "EA", rate: p, rcv: p * chimSmall, acv: p * chimSmall, amount: p * chimSmall, depreciation: 0 });
    }

    const chimMedium = Number(measurements.chimney_medium) || 0;
    if (chimMedium > 0) {
      items.push({ line: lineNumber++, code: "RFG CFM", description: "Chimney flashing - medium (30\"-48\")", quantity: chimMedium, unit: "EA", rate: 550, rcv: 550 * chimMedium, acv: 550 * chimMedium, amount: 550 * chimMedium, depreciation: 0 });
    }

    const chimLarge = Number(measurements.chimney_large) || 0;
    if (chimLarge > 0) {
      items.push({ line: lineNumber++, code: "RFG CFL", description: "Chimney flashing - large (over 48\")", quantity: chimLarge, unit: "EA", rate: 850, rcv: 850 * chimLarge, acv: 850 * chimLarge, amount: 850 * chimLarge, depreciation: 0 });
    }

    console.log('✅ Line items created:', items);
    console.log('📊 Total items:', items.length);

    const wastePercent = Number(measurements.waste_percentage) || 12;
    const wastedItems = applyWasteToLineItems(items, wastePercent);
    
    setLineItems(wastedItems);

    const total = wastedItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);

    // AI Adjustment Helper
    const adjustToTargetPerSq = (targetPrice) => {
      const roofSq = Number(measurements.corrected_area_sq) || Number(measurements.roof_area_sq) || 1;
      const currentTotal = wastedItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
      const targetTotal = targetPrice * roofSq;
      
      if (currentTotal === 0) return;
      
      const factor = targetTotal / currentTotal;
      const adjustedItems = wastedItems.map(item => {
        const newRate = Number((item.rate * factor).toFixed(2));
        const newRcv = Number((item.quantity * newRate).toFixed(2));
        return {
          ...item,
          rate: newRate,
          rcv: newRcv,
          acv: newRcv,
          amount: newRcv
        };
      });
      
      setLineItems(adjustedItems);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Applied adjustment to **$${targetPrice}/SQ**. Total is now **$${(targetPrice * roofSq).toLocaleString()}** (previously $${currentTotal.toLocaleString()}).`,
        timestamp: new Date().toISOString()
      }]);
    };

    // Check for "make it $X per sq" in user message
    const adjustMatch = userMessage?.toLowerCase().match(/make (?:it )?\$?(\d+(?:\.\d+)?) (?:a|per) sq/);
    if (adjustMatch) {
      const target = parseFloat(adjustMatch[1]);
      // Update state immediately and then return so we don't proceed with normal creation
      const roofSq = Number(measurements.corrected_area_sq) || Number(measurements.roof_area_sq) || 1;
      const currentTotal = wastedItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
      const targetTotal = target * roofSq;
      
      if (currentTotal > 0) {
        const factor = targetTotal / currentTotal;
        const adjustedItems = wastedItems.map(item => {
          const newRate = Number((item.rate * factor).toFixed(2));
          const newRcv = Number((item.quantity * newRate).toFixed(2));
          return {
            ...item,
            rate: newRate,
            rcv: newRcv,
            acv: newRcv,
            amount: newRcv
          };
        });
        
        setLineItems(adjustedItems);
        setCurrentEstimate(prev => ({ ...prev, roof_area_sq: roofSq }));
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Applied adjustment to **$${target}/SQ**. Total is now **$${(target * roofSq).toLocaleString()}**.`,
          timestamp: new Date().toISOString()
        }]);
      }
      return;
    }

    let titleText = `${measurements.roof_area_sq?.toFixed(2) || 'Manual'} SQ Roof (${measurements.pitch || "Unknown"} Pitch)`;
    
    if (measurements.structures && Array.isArray(measurements.structures) && measurements.structures.length > 1) {
      const structureNames = measurements.structures.map(s => s.name).join(' + ');
      titleText += ` - ${structureNames}`;
    }
    
    if (satelliteAddress?.address) {
      titleText += ` - ${satelliteAddress.address}`;
    } else if (measurements.structures && measurements.structures[0]?.address) {
        titleText += ` - ${measurements.structures[0].address}`;
    }

    const roofSqForPerSq = Number(measurements.corrected_area_sq) || Number(measurements.roof_area_sq) || 1;
    const orderQtySq = Math.round(roofSqForPerSq * (1 + wastePercent / 100) * 100) / 100;
    const perSqPrice = Math.round(total / roofSqForPerSq);

    setCurrentEstimate({
      title: titleText,
      roof_area_sq: roofSqForPerSq
    });

    const itemDescriptions = [];
    itemDescriptions.push(`Roof: ${Number(roofSqForPerSq).toFixed(2)} SQ`);
    itemDescriptions.push(`Order Qty: ${orderQtySq} SQ (+${wastePercent}% waste)`);
    itemDescriptions.push(`Pitch: ${measurements.pitch || 'Unknown'}`);
    
    if (measurements.structures && Array.isArray(measurements.structures) && measurements.structures.length > 1) {
      itemDescriptions.push(`Structures: ${measurements.structures.map(s => s.name).join(', ')}`);
    }
    
    if (measurements.gutter_lf > 0) {
      itemDescriptions.push(`Gutters: ${measurements.gutter_lf.toFixed(0)} LF`);
    }
    
    if (measurements.downspout_count > 0) {
      itemDescriptions.push(`Downspouts: ${measurements.downspout_count}`);
    }

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `**Created Complete Roof Estimate!**\n\n**${wastedItems.length} items** | **Total: $${total.toLocaleString()}** | **$${perSqPrice}/SQ**\n\n${itemDescriptions.join(' | ')}\n\nWaste (${wastePercent}%) auto-applied to materials (${orderQtySq} SQ order qty). Say "make it $520 per sq" to adjust pricing.`,
      timestamp: new Date().toISOString()
    }]);
  };

  const saveMissedItemToMemory = async (item) => {
    if (!myCompany) return;
    try {
      const records = await base44.entities.AITrainingData.filter({ 
        company_id: myCompany.id,
        data_type: 'missed_items'
      });
      
      const currentList = records.length > 0 && records[0].content 
        ? JSON.parse(records[0].content) 
        : [];
      
      if (currentList.some(m => m.label === item.label)) return;
      
      const updatedList = [...currentList, { 
        label: item.label, 
        cmd: item.cmd, 
        reason: item.reason,
        keywords: item.keywords || [item.label.toLowerCase()],
        added: new Date().toISOString()
      }];
      
      if (records.length > 0) {
        await base44.entities.AITrainingData.update(records[0].id, {
          content: JSON.stringify(updatedList),
          title: 'Commonly Missed Estimate Items'
        });
      } else {
        await base44.entities.AITrainingData.create({
          company_id: myCompany.id,
          data_type: 'missed_items',
          title: 'Commonly Missed Estimate Items',
          content: JSON.stringify(updatedList),
          source_type: 'manual'
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ['missed-items-memory', myCompany.id] });
    } catch (err) {
      console.error('Failed to save missed item to memory:', err);
    }
  };

  const deleteMissedItemFromMemory = async (label) => {
    if (!myCompany) return;
    try {
      const records = await base44.entities.AITrainingData.filter({ 
        company_id: myCompany.id,
        data_type: 'missed_items'
      });
      if (records.length === 0) return;
      
      const currentList = JSON.parse(records[0].content || '[]');
      const updatedList = currentList.filter(m => m.label !== label);
      
      await base44.entities.AITrainingData.update(records[0].id, {
        content: JSON.stringify(updatedList)
      });
      
      queryClient.invalidateQueries({ queryKey: ['missed-items-memory', myCompany.id] });
    } catch (err) {
      console.error('Failed to delete missed item from memory:', err);
    }
  };

  const handleUploadTrainingFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !myCompany) return;
    setIsUploadingTraining(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const extracted = await base44.integrations.Core.InvokeLLM({
        prompt: `You are analyzing a roofing/construction estimate or measurement report. Extract every useful detail as a training reference for an AI estimator:

- Document type (EagleView, HOVER, Xactimate, insurance estimate, contractor estimate, etc.)
- All roof measurements: total area in SQ and sqft, ridge LF, hip LF, valley LF, rake LF, eave LF, pitch/slope, waste %, flat vs pitched
- All line items with description, quantity, and unit (if present)
- Pricing patterns: price per SQ, per LF, per unit
- Special items: ice & water, drip edge, starter, pipe jacks, ridge cap, step flashing, etc.
- Any patterns or notes useful for writing accurate estimates

Write a detailed but concise summary. Be specific with numbers.`,
        file_urls: [file_url],
      });
      await base44.entities.AITrainingData.create({
        company_id: myCompany.id,
        data_type: 'training_document',
        title: file.name,
        content: extracted,
        source_type: 'uploaded_pdf',
        file_url: file_url,
      });
      queryClient.invalidateQueries({ queryKey: ['training-documents', myCompany.id] });
    } catch (err) {
      console.error('Training upload error:', err);
    }
    setIsUploadingTraining(false);
    e.target.value = '';
  };

  const deleteTrainingDocument = async (id) => {
    try {
      await base44.entities.AITrainingData.delete(id);
      queryClient.invalidateQueries({ queryKey: ['training-documents', myCompany.id] });
    } catch (err) {
      console.error('Delete training doc error:', err);
    }
  };

  const checkMissingItems = () => {
    if (!lineItems || lineItems.length === 0) return;
    
    const allDescs = lineItems.map(i => (i.description || '').toLowerCase()).join(' ');
    const allCodes = lineItems.map(i => (i.code || '').toLowerCase()).join(' ');
    const combined = allDescs + ' ' + allCodes;
    
    const hasShingles = combined.includes('shingle') || combined.includes('composition');
    const hasMetal = combined.includes('metal') || combined.includes('standing seam');
    const hasFlat = combined.includes('tpo') || combined.includes('epdm') || combined.includes('modified bit') || combined.includes('flat');
    const hasRoofWork = hasShingles || hasMetal || hasFlat || combined.includes('roof');
    
    const builtInChecks = [
      { label: 'Ice & Water Shield', cmd: 'add ice and water shield', reason: 'Required at eaves, valleys, and penetrations', keywords: ['ice', 'water shield', 'i&w'], roofOnly: true },
      { label: 'Underlayment', cmd: 'add synthetic underlayment', reason: 'Required under all roofing materials', keywords: ['felt', 'underlayment', 'synthetic'], roofOnly: true },
      { label: 'Drip Edge', cmd: 'add drip edge', reason: 'Required at eaves and rakes per code', keywords: ['drip', 'edge metal'], roofOnly: true },
      { label: 'Ridge/Hip Cap', cmd: 'add ridge cap shingles', reason: 'Needed to finish ridge and hip lines', keywords: ['ridge', 'hip cap'], roofOnly: true },
      { label: 'Starter Strip', cmd: 'add starter strip shingles', reason: 'Required at eaves and rakes for shingles', keywords: ['starter'], roofOnly: true, shinglesOnly: true },
      { label: 'Nails/Fasteners', cmd: 'add roofing nails fasteners', reason: 'Fasteners for shingles and accessories', keywords: ['nail', 'fastener'], roofOnly: true },
      { label: 'Step Flashing', cmd: 'add step flashing', reason: 'Required where roof meets walls', keywords: ['flashing', 'step flash', 'counter flash'], roofOnly: true },
      { label: 'Ventilation', cmd: 'add ridge vent continuous', reason: 'Code-required attic ventilation', keywords: ['vent', 'ventilation', 'ridge vent'], roofOnly: true },
      { label: 'Debris Removal', cmd: 'add dumpster', reason: 'Tear-off debris disposal', keywords: ['dumpster', 'debris', 'haul', 'disposal'], roofOnly: true },
      { label: 'Permit', cmd: 'add building permit', reason: 'Most jurisdictions require permits', keywords: ['permit'], roofOnly: true },
    ];

    const allChecks = [...builtInChecks];
    
    for (const saved of savedMissedItems) {
      if (!allChecks.some(c => c.label === saved.label)) {
        allChecks.push({
          label: saved.label,
          cmd: saved.cmd,
          reason: saved.reason || 'Saved to your memory',
          keywords: saved.keywords || [saved.label.toLowerCase()],
          roofOnly: false,
          fromMemory: true
        });
      }
    }

    const suggestions = [];
    
    for (const check of allChecks) {
      if (check.roofOnly && !hasRoofWork) continue;
      if (check.shinglesOnly && !hasShingles) continue;
      
      const alreadyInEstimate = check.keywords.some(kw => combined.includes(kw));
      if (!alreadyInEstimate) {
        suggestions.push({
          label: check.label,
          cmd: check.cmd,
          reason: check.reason,
          keywords: check.keywords,
          fromMemory: check.fromMemory || false
        });
      }
    }
    
    if (suggestions.length === 0) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Estimate looks comprehensive - no commonly missing items detected.',
        timestamp: new Date().toISOString()
      }]);
      return;
    }
    
    const memoryCount = suggestions.filter(s => s.fromMemory).length;
    const builtInCount = suggestions.length - memoryCount;
    
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `**${suggestions.length} Potentially Missing Items** (${builtInCount} standard${memoryCount > 0 ? `, ${memoryCount} from your memory` : ''}):\n\n${suggestions.map(s => `- **${s.label}** - ${s.reason}${s.fromMemory ? ' *(saved)*' : ''}`).join('\n')}\n\nTap any suggestion below to add it:`,
      timestamp: new Date().toISOString()
    }]);
    
    setMissingSuggestions(suggestions);
  };

  const handleReviewEstimate = async () => {
    if (!lineItems || lineItems.length === 0) {
      alert('No estimate to review');
      return;
    }

    setIsAnalyzing(true);
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `🔍 **Analyzing estimate for completeness...**\n\nChecking against industry standards and your knowledge base...`,
      timestamp: new Date().toISOString()
    }]);

    try {
      const response = await analyzeEstimateCompleteness({
        lineItems: lineItems,
        jobType: config.specialty,
        roofPitch: satelliteAnalysis?.pitch || currentEstimate?.pitch,
        customerInfo: customerInfo
      });

      if (response.success) {
        setSuggestions(response);
        setShowSuggestions(true);

        const criticalCount = response.suggestions?.filter(s => s.priority === 'critical').length || 0;
        const recommendedCount = response.suggestions?.filter(s => s.priority === 'recommended').length || 0;

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ **Analysis Complete!**\n\n📊 Quality Score: ${response.estimate_quality_score}/100\n\n${criticalCount === 0 && recommendedCount === 0 ? '✨ Estimate looks complete!' : `Review dialog opened with ${criticalCount} critical and ${recommendedCount} recommended items.`}`,
          timestamp: new Date().toISOString()
        }]);
      } else {
        throw new Error(response.error || "Failed to analyze estimate.");
      }
    } catch (error) {
      console.error('Review error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Error analyzing estimate: ${error.message}`,
        timestamp: new Date().toISOString()
      }]);
    }

    setIsAnalyzing(false);
  };

  const handleAddVentilationItems = (newItems) => {
    saveToHistory();
    
    const processedItems = newItems.map((item, idx) => {
      // Try to find price in price list
      const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });
                        
      let rate = item.rate || 0;
      let code = item.code;
      let description = item.description;
      
      // Try to match code first
      const matched = priceList.find(p => p.code === item.code) || 
                      priceList.find(p => p.description.includes('Ridge Vent') && item.description.includes('Ridge')) ||
                      priceList.find(p => p.description.includes('Turtle') && item.description.includes('Box'));
                      
      if (matched) {
        rate = Number(matched.price) || 0;
        code = matched.code;
        description = matched.description; // Use official description
      }
      
      return {
        line: lineItems.length + 1 + idx,
        code: code,
        description: description + (item.description !== description ? ` (${item.description})` : ''),
        quantity: item.quantity,
        unit: item.unit,
        rate: rate,
        rcv: rate * item.quantity,
        acv: rate * item.quantity,
        amount: rate * item.quantity,
        depreciation: 0
      };
    });
    
    setLineItems(prev => [...prev, ...processedItems]);
    
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✅ Added ${processedItems.length} ventilation items based on calculator.`,
      timestamp: new Date().toISOString()
    }]);
  };

  const handleAddSuggestedItem = async (suggestion) => {
    console.log('📋 Adding suggested item:', suggestion);
    
    // Save current state before modifying line items
    saveToHistory();

    const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });
    
    const description = suggestion.item_description.toLowerCase();
    
    // SMART MATCHING - Find the RIGHT item based on description
    let matchedItem = null;
    
    // 1. UNDERLAYMENT
    if (description.includes('underlayment') || description.includes('felt')) {
      matchedItem = priceList.find(item => {
        const desc = item.description?.toLowerCase() || '';
        return (
          (desc.includes('underlayment') || desc.includes('felt') || desc.includes('synthetic')) &&
          desc.includes('roof') &&
          !desc.includes('ice') &&
          !desc.includes('water') &&
          !desc.includes('barrier') &&
          !desc.includes('vent')
        );
      });
    }
    
    // 2. ICE & WATER SHIELD
    else if (description.includes('ice') || description.includes('water shield')) {
      matchedItem = priceList.find(item => {
        const desc = item.description?.toLowerCase() || '';
        const code = item.code?.toLowerCase() || '';
        return (
          (desc.includes('ice') && desc.includes('water')) ||
          code.includes('iws') ||
          desc.includes('ice & water')
        );
      });
    }
    
    // 3. DRIP EDGE
    else if (description.includes('drip edge')) {
      matchedItem = priceList.find(item => {
        const desc = item.description?.toLowerCase() || '';
        return desc.includes('drip') && desc.includes('edge');
      });
    }
    
    // 4. RIDGE CAP
    else if (description.includes('ridge cap')) {
      matchedItem = priceList.find(item => {
        const desc = item.description?.toLowerCase() || '';
        return (
          desc.includes('ridge') && 
          desc.includes('cap') &&
          !desc.includes('vent')
        );
      });
    }
    
    // 5. PIPE FLASHINGS
    else if (description.includes('pipe') && description.includes('flash')) {
      matchedItem = priceList.find(item => {
        const desc = item.description?.toLowerCase() || '';
        return (
          desc.includes('pipe') && 
          (desc.includes('flash') || desc.includes('boot') || desc.includes('jack'))
        );
      });
    }
    
    // 6. RIDGE VENTS / BOX VENTS
    else if (description.includes('vent')) {
      if (description.includes('ridge')) {
        matchedItem = priceList.find(item => {
          const desc = item.description?.toLowerCase() || '';
          return desc.includes('ridge') && desc.includes('vent');
        });
      } else if (description.includes('box')) {
        matchedItem = priceList.find(item => {
          const desc = item.description?.toLowerCase() || '';
          return desc.includes('box') && desc.includes('vent');
        });
      } else {
        // Generic vent
        matchedItem = priceList.find(item => {
          const desc = item.description?.toLowerCase() || '';
          return desc.includes('vent') && desc.includes('roof');
        });
      }
    }
    
    // 7. STARTER STRIP
    else if (description.includes('starter')) {
      matchedItem = priceList.find(item => {
        const desc = item.description?.toLowerCase() || '';
        return desc.includes('starter') && (desc.includes('strip') || desc.includes('shingle'));
      });
    }
    
    // 8. VALLEY METAL
    else if (description.includes('valley')) {
      matchedItem = priceList.find(item => {
        const desc = item.description?.toLowerCase() || '';
        return desc.includes('valley') && (desc.includes('metal') || desc.includes('flash'));
      });
    }
    
    // 9. STEP FLASHING
    else if (description.includes('step') && description.includes('flash')) {
      matchedItem = priceList.find(item => {
        const desc = item.description?.toLowerCase() || '';
        return desc.includes('step') && desc.includes('flash');
      });
    }
    
    // 10. OVERHEAD & PROFIT
    else if (description.includes('overhead') || description.includes('profit') || description.includes('o&p')) {
      // Calculate O&P as 21% of current total
      const currentTotal = lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
      const opAmount = currentTotal * 0.21;
      
      const newItem = {
        line: lineItems.length + 1,
        code: 'O&P',
        description: 'Overhead & Profit (10% + 10%)',
        quantity: 1,
        unit: 'LS',
        rate: opAmount,
        rcv: opAmount,
        acv: opAmount,
        amount: opAmount,
        depreciation: 0
      };
      
      setLineItems(prev => [...prev, newItem]);
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Added O&P (21% = $${opAmount.toFixed(2)})`,
        timestamp: new Date().toISOString()
      }]);
      
      // Remove from suggestions
      setSuggestions(prev => {
        if (!prev || !prev.suggestions) return prev;
        return {
          ...prev,
          suggestions: prev.suggestions.filter(s => s !== suggestion)
        };
      });
      
      return;
    }
    
    // 11. DUMPSTER / DEBRIS REMOVAL
    else if (description.includes('debris') || description.includes('dumpster')) {
      matchedItem = priceList.find(item => {
        const desc = item.description?.toLowerCase() || '';
        return (desc.includes('debris') || desc.includes('dumpster')) && 
               (desc.includes('removal') || desc.includes('haul'));
      });
    }
    
    // 12. WASTE / OVERAGE
    else if (description.includes('waste') || description.includes('overage')) {
      // Apply 10% waste to materials
      const wastePercent = 10;
      const updatedItems = lineItems.map(item => {
        if (item.description?.toLowerCase().includes('shingle') ||
            item.description?.toLowerCase().includes('underlayment') ||
            item.description?.toLowerCase().includes('felt')) {
          const multiplier = 1 + (wastePercent / 100);
          const newQuantity = (Number(item.quantity) || 0) * multiplier;
          const newRcv = newQuantity * (Number(item.rate) || 0);
          return {
            ...item,
            quantity: newQuantity,
            rcv: newRcv,
            acv: newRcv,
            amount: newRcv
          };
        }
        return item;
      });
      
      setLineItems(updatedItems);
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Applied 10% waste to materials`,
        timestamp: new Date().toISOString()
      }]);
      
      // Remove from suggestions
      setSuggestions(prev => {
        if (!prev || !prev.suggestions) return prev;
        return {
          ...prev,
          suggestions: prev.suggestions.filter(s => s !== suggestion)
        };
      });
      
      return;
    }
    
    // Fallback: Use smart description match
    if (!matchedItem) {
      matchedItem = smartDescriptionMatch(suggestion.item_description, priceList);
    }
    
    if (matchedItem) {
      const quantity = Number(suggestion.typical_quantity) || 1;
      const unit = suggestion.typical_unit || matchedItem.unit || 'EA';
      const price = Number(matchedItem.price) || 0;
      
      const newItem = {
        line: lineItems.length + 1,
        code: matchedItem.code,
        description: matchedItem.description,
        quantity: quantity,
        unit: unit,
        rate: price,
        rcv: price * quantity,
        acv: price * quantity,
        amount: price * quantity,
        depreciation: 0
      };
      
      setLineItems(prev => [...prev, newItem]);
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Added ${quantity} ${unit} of ${matchedItem.description}`,
        timestamp: new Date().toISOString()
      }]);
    } else {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Could not find "${suggestion.item_description}" in ${pricingSource} price list`,
        timestamp: new Date().toISOString()
      }]);
    }
    
    // Remove this suggestion from the list
    setSuggestions(prev => {
      if (!prev || !prev.suggestions) return prev;
      return {
        ...prev,
        suggestions: prev.suggestions.filter(s => s !== suggestion)
      };
    });
  };

  const processWithAI = async (userMessage, fileUrls = []) => {
    setIsProcessing(true);
    setMissingSuggestions([]);
    
    try {
      const messageLower = userMessage.toLowerCase().trim();

      // ── PRIORITY: per-sq or total price adjustment ──────────────────────────
      // Must run FIRST before any other check to avoid "total"/"price" keywords
      // triggering the fallback "show current estimate" response.
      if (lineItems.length > 0 && fileUrls.length === 0) {
        // Per-sq ONLY fires when "sq" is explicitly mentioned after the number
        const perSqMatch = messageLower.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:per|\/|a)\s*sq\b/i);

        // Total $ amount — fires when user says "total" or "price" with a dollar value,
        // OR says "make it $X" with a large value (>= $1,000) and no "sq" qualifier
        const hasSqInMessage = /\bsq\b/i.test(messageLower);
        const totalMatch = !hasSqInMessage && (
          messageLower.match(/(?:make|set|change|adjust).*?(?:total|price|estimate).*?\$?\s*(\d[\d,]*(?:\.\d+)?)/i) ||
          messageLower.match(/total\s*(?:price\s*)?\$?\s*(\d[\d,]*(?:\.\d+)?)/i) ||
          messageLower.match(/make\s+(?:it|this|the\s+estimate)\s*\$?\s*(\d[\d,]+)/i)
        );

        let priceVal = null;
        let isTotal = false;

        if (perSqMatch) {
          priceVal = parseFloat((perSqMatch[1] || '0').replace(/,/g, ''));
          isTotal = false;
        } else if (totalMatch) {
          const rawVal = parseFloat(((totalMatch[1] || totalMatch[2] || '0')).replace(/,/g, ''));
          // Only treat as a total-dollar adjustment if value is clearly a dollar total (>= $1,000)
          if (rawVal >= 1000) {
            priceVal = rawVal;
            isTotal = true;
          }
        }

        if (priceVal && priceVal > 0) {
          saveToHistory();

          const storedSq = Number(currentEstimate?.roof_area_sq);
          const sqItemsForDetect = lineItems.filter(i => i.unit?.toUpperCase() === 'SQ' && Number(i.quantity) > 0);
          const inferredSq = sqItemsForDetect.length > 0 ? Math.min(...sqItemsForDetect.map(i => Number(i.quantity))) : 0;
          const roofSq = storedSq || inferredSq || Number(satelliteAnalysis?.corrected_area_sq) || Number(satelliteAnalysis?.roof_area_sq) || 1;

          const currentTotal = lineItems.reduce((sum, i) => sum + (Number(i.rcv) || 0), 0);
          const targetTotal = isTotal ? priceVal : priceVal * roofSq;
          const targetPerSq = isTotal ? (priceVal / roofSq) : priceVal;

          if (targetTotal > 0 && currentTotal > 0) {
            const scaleFactor = targetTotal / currentTotal;
            const adjustedItems = lineItems.map(item => {
              if (!item.rate || Number(item.quantity) === 0) return item;
              const newRate = Number((Number(item.rate) * scaleFactor).toFixed(2));
              const qty = Number(item.quantity) || 0;
              const newRcv = Number((newRate * qty).toFixed(2));
              const depPct = Number(item.depreciation_percent) || 0;
              const newAcv = depPct > 0 ? Number((newRcv * (1 - depPct / 100)).toFixed(2)) : newRcv;
              return { ...item, rate: newRate, rcv: newRcv, acv: newAcv, amount: newRcv };
            });
            const newTotal = adjustedItems.reduce((sum, i) => sum + (Number(i.rcv) || 0), 0);
            setLineItems(adjustedItems);
            setCurrentEstimate(prev => ({ ...prev, roof_area_sq: roofSq, total_rcv: newTotal }));
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `✅ Adjusted estimate to **$${Math.round(newTotal).toLocaleString()}** ($${targetPerSq.toFixed(2)}/SQ on ${roofSq.toFixed(1)} SQ).\n\nPreviously: $${Math.round(currentTotal).toLocaleString()} ($${Math.round(currentTotal / roofSq)}/SQ)\n\nYou can keep adjusting — say "make it $510 per sq" or "make total $32,000" anytime.`,
              timestamp: new Date().toISOString()
            }]);
          } else {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `⚠️ Could not adjust — no priced line items found yet.`,
              timestamp: new Date().toISOString()
            }]);
          }
          setIsProcessing(false);
          return;
        }
      }
      // ── END PRIORITY BLOCK ───────────────────────────────────────────────────

      const commands = [];

      // REMOVE / DELETE specific items by description (uses searchTerm, resolved at execution time)
      const removeMatch = messageLower.match(/(?:remove|delete|take off|drop)\s+(?:the\s+)?(.+?)(?:\s+line|\s+item)?$/i);
      if (removeMatch && lineItems.length > 0) {
        const searchTerm = removeMatch[1].trim();
        commands.push({ type: 'remove_item', searchTerm });
      }

      // CHANGE QUANTITY: "change ridge to 45" or "set shingles to 20 sq"
      const changeQtyMatch = messageLower.match(/(?:change|set|update|make)\s+(?:the\s+)?(.+?)\s+(?:to|=)\s+(\d+\.?\d*)\s*(\w+)?/i);
      if (changeQtyMatch && lineItems.length > 0) {
        const searchTerm = changeQtyMatch[1].trim();
        const newQty = parseFloat(changeQtyMatch[2]);
        commands.push({ type: 'change_qty', searchTerm, quantity: newQty });
      }

      // INCREASE/DECREASE: "increase ridge by 10 lf"
      const adjustMatch = messageLower.match(/(?:increase|decrease|add|subtract)\s+(?:the\s+)?(.+?)\s+by\s+(\d+\.?\d*)/i);
      if (adjustMatch && lineItems.length > 0 && !commands.some(c => c.type === 'change_qty')) {
        const searchTerm = adjustMatch[1].trim();
        const amount = parseFloat(adjustMatch[2]);
        const isDecrease = messageLower.includes('decrease') || messageLower.includes('subtract');
        commands.push({ type: 'adjust_qty', searchTerm, amount, isDecrease });
      }

      // DISCOUNT: "apply 5% discount" or "10% off"
      const discountMatch = messageLower.match(/(\d+)%?\s*(?:discount|off)/i);
      if (discountMatch && !messageLower.includes('depreciat') && !messageLower.includes('waste')) {
        commands.push({ type: 'discount', percent: parseInt(discountMatch[1]) });
      }

      // MARKUP: "add 15% markup" or "markup 20%"
      const markupMatch = messageLower.match(/(\d+)%?\s*markup/i) || messageLower.match(/markup\s+(\d+)%?/i);
      if (markupMatch && !commands.some(c => c.type === 'discount')) {
        commands.push({ type: 'markup', percent: parseInt(markupMatch[1]) });
      }

      // COMMON ROOFING ITEMS - direct name detection
      const commonItems = [
        { keywords: ['dumpster', 'debris removal', 'haul off', 'haul away'], desc: 'dumpster debris removal haul', defaultQty: 1 },
        { keywords: ['skylight', 'sky light'], desc: 'skylight replacement', defaultQty: 1 },
        { keywords: ['plywood', 'osb', 'decking', 'sheeting', 'sheathing'], desc: 'roof decking OSB plywood', defaultQty: 1 },
        { keywords: ['chimney flash', 'chimney cap'], desc: 'chimney flashing', defaultQty: 1 },
        { keywords: ['soffit'], desc: 'soffit vinyl', defaultQty: 1 },
        { keywords: ['fascia'], desc: 'fascia aluminum', defaultQty: 1 },
        { keywords: ['vent', 'turtle vent', 'box vent'], desc: 'roof vent turtle box', defaultQty: 1 },
        { keywords: ['ridge vent', 'continuous vent'], desc: 'ridge vent continuous', defaultQty: 1 },
        { keywords: ['power vent', 'attic fan'], desc: 'power vent attic fan', defaultQty: 1 },
        { keywords: ['gutter guard', 'leaf guard'], desc: 'gutter guard leaf protection', defaultQty: 1 },
        { keywords: ['satellite dish', 'antenna'], desc: 'satellite dish antenna reset', defaultQty: 1 },
        { keywords: ['paint', 'touch up'], desc: 'paint touch up', defaultQty: 1 },
        { keywords: ['permit'], desc: 'building permit', defaultQty: 1 },
        { keywords: ['window'], desc: 'window double hung vinyl', defaultQty: 1 },
      ];

      for (const ci of commonItems) {
        if (ci.keywords.some(kw => messageLower.includes(kw)) && !commands.some(c => c.type === 'remove_item')) {
          const kwPattern = ci.keywords.join('|');
          const qtyBeforeMatch = userMessage.match(new RegExp(`(\\d+)\\s+(?:${kwPattern})`, 'i'));
          const qtyAfterMatch = userMessage.match(new RegExp(`(?:${kwPattern})\\s*[x×]\\s*(\\d+)`, 'i'));
          const qty = qtyBeforeMatch ? parseInt(qtyBeforeMatch[1]) : (qtyAfterMatch ? parseInt(qtyAfterMatch[1]) : ci.defaultQty);
          if (!commands.some(c => c.type === 'add_item' && c.description === ci.desc)) {
            commands.push({ type: 'add_item', quantity: qty, description: ci.desc });
          }
        }
      }
      
      // DEPRECIATION COMMAND (apply % depreciation to all items)
      if (messageLower.includes('depreciat') || (messageLower.includes('depr') && !messageLower.includes('decrease'))) {
        const percentMatch = userMessage.match(/(\d+)%?\s*(depreciat|depr)/i);
        const percent = percentMatch ? parseInt(percentMatch[1]) : 20;
        commands.push({ type: 'depreciate', percent });
      }
      
      else if (messageLower.includes('waste')) {
        const percentMatch = userMessage.match(/(\d+)%?\s*waste/);
        commands.push({ type: 'waste', percent: percentMatch ? parseInt(percentMatch[1]) : 10 });
      }

      if (messageLower.match(/\$?\d+(?:,\d+)*\s*(?:per|\/|a)\s*sq|target\s*\$?\d+(?:,\d+)*|make\s*it\s*\$?\d+(?:,\d+)*|average\s*\$?\d+(?:,\d+)*|\$\d+(?:,\d+)*\s*sq|total\s*(?:price\s*)?\$?\d+(?:,\d+)*/i)) {
        const priceMatch = userMessage.match(/\$?\s*(\d+(?:,\d+)?(?:\.\d+)?)\s*(?:per|\/|a)?\s*sq/i) || 
                           userMessage.match(/target\s*\$?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i) ||
                           userMessage.match(/make\s*(?:the\s+)?(?:total\s+)?(?:price\s+)?it\s*\$?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i) ||
                           userMessage.match(/make\s*(?:the\s+)?(?:total\s+)?(?:price\s+)?\$?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i) ||
                           userMessage.match(/total\s*(?:price\s*)?\$?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i) ||
                           userMessage.match(/average\s*\$?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i);
        if (priceMatch) {
          const val = parseFloat(priceMatch[1].replace(/,/g, ''));
          if (userMessage.toLowerCase().includes('total') || (val > 2000)) {
            commands.push({ type: 'target_total', targetTotal: val });
          } else {
            commands.push({ type: 'target_per_sq', targetPrice: val });
          }
        }
      }
      
      if (messageLower.includes('steep') && !commands.some(c => c.type === 'steep') && !commands.some(c => c.type === 'remove_item')) {
        commands.push({ type: 'steep' });
      }
      
      if (messageLower.includes('high') && !commands.some(c => c.type === 'high') && !commands.some(c => c.type === 'remove_item') && !messageLower.includes('highlight')) {
        commands.push({ type: 'high' });
      }
      
      if ((messageLower.includes('o&p') || messageLower.includes('overhead') || messageLower.includes('profit')) && !commands.some(c => c.type === 'op')) {
        commands.push({ type: 'op' });
      }

      // Add pipe flashing detection
      if (messageLower.includes('pipe') && (messageLower.includes('flash') || messageLower.includes('boot') || messageLower.match(/\d+\s+pipe/))) {
        const pipeMatch = userMessage.match(/(\d+)\s+pipe/i);
        const pipeQty = pipeMatch ? parseInt(pipeMatch[1]) : 1;
        commands.push({ type: 'add_item', quantity: pipeQty, description: 'pipe flashing boot' });
      }

      // Generic "add X items" pattern - only if no specific command matched above
      if (commands.length === 0) {
        const patterns = [
          /add\s+(\d+)?\s*([\w\s-]+?)(?:\s*(?:and|,\s*add|$))/gi,
          /(\d+)\s+([\w\s-]+?)(?:\s*(?:and|,\s*add|$))/gi,
        ];
        
        patterns.forEach(pattern => {
          const matches = [...userMessage.matchAll(pattern)];
          matches.forEach(match => {
            const quantity = match[1] ? parseInt(match[1]) : 1;
            const description = match[2] ? match[2].trim() : '';
            
            if (description && description.length > 2 && !['steep', 'high', 'waste', 'o&p', 'overhead', 'profit', 'more', 'the'].some(keyword => description.toLowerCase() === keyword)) {
              commands.push({ type: 'add_item', quantity, description });
            }
          });
        });
      }

      if (commands.length > 0 && lineItems.length > 0) {
        console.log('🎯 Executing commands:', commands);
        
        // SAVE TO HISTORY BEFORE MAKING CHANGES
        saveToHistory();
        
        let updatedItems = [...lineItems];
        let assistantResponseMessages = [];
        
        for (const cmd of commands) {
          if (cmd.type === 'remove_item') {
            const idx = updatedItems.findIndex(item => {
              const desc = (item.description || '').toLowerCase();
              const code = (item.code || '').toLowerCase();
              return desc.includes(cmd.searchTerm) || code.includes(cmd.searchTerm);
            });
            if (idx >= 0) {
              const removedItem = updatedItems[idx];
              updatedItems = updatedItems.filter((_, i) => i !== idx);
              updatedItems = updatedItems.map((item, i) => ({ ...item, line: i + 1 }));
              assistantResponseMessages.push(`Removed: ${removedItem.description}`);
            } else {
              assistantResponseMessages.push(`Could not find item matching "${cmd.searchTerm}" to remove.`);
            }
          }

          else if (cmd.type === 'change_qty') {
            const idx = updatedItems.findIndex(item => {
              const desc = (item.description || '').toLowerCase();
              const code = (item.code || '').toLowerCase();
              return desc.includes(cmd.searchTerm) || code.includes(cmd.searchTerm);
            });
            if (idx >= 0) {
              const item = updatedItems[idx];
              const newQty = cmd.quantity;
              const rate = Number(item.rate) || 0;
              const newRcv = Math.round(rate * newQty * 100) / 100;
              const depPercent = Number(item.depreciation_percent) || 0;
              const newAcv = Math.round(newRcv * (1 - depPercent / 100) * 100) / 100;
              updatedItems[idx] = { ...item, quantity: newQty, rcv: newRcv, acv: newAcv, amount: newRcv };
              assistantResponseMessages.push(`Updated ${item.description}: quantity changed to ${newQty}`);
            } else {
              assistantResponseMessages.push(`Could not find item matching "${cmd.searchTerm}" to update.`);
            }
          }

          else if (cmd.type === 'adjust_qty') {
            const idx = updatedItems.findIndex(item => {
              const desc = (item.description || '').toLowerCase();
              const code = (item.code || '').toLowerCase();
              return desc.includes(cmd.searchTerm) || code.includes(cmd.searchTerm);
            });
            if (idx >= 0) {
              const item = updatedItems[idx];
              const currentQty = Number(item.quantity) || 0;
              const newQty = cmd.isDecrease ? Math.max(0, currentQty - cmd.amount) : currentQty + cmd.amount;
              const rate = Number(item.rate) || 0;
              const newRcv = Math.round(rate * newQty * 100) / 100;
              const depPercent = Number(item.depreciation_percent) || 0;
              const newAcv = Math.round(newRcv * (1 - depPercent / 100) * 100) / 100;
              updatedItems[idx] = { ...item, quantity: newQty, rcv: newRcv, acv: newAcv, amount: newRcv };
              assistantResponseMessages.push(`${cmd.isDecrease ? 'Decreased' : 'Increased'} ${item.description}: quantity now ${newQty}`);
            } else {
              assistantResponseMessages.push(`Could not find item matching "${cmd.searchTerm}" to adjust.`);
            }
          }

          else if (cmd.type === 'discount') {
            const discountPercent = cmd.percent;
            const multiplier = 1 - (discountPercent / 100);
            updatedItems = updatedItems.map(item => {
              const currentRcv = Number(item.rcv) || 0;
              const newRcv = Math.round(currentRcv * multiplier * 100) / 100;
              return { ...item, rcv: newRcv, acv: newRcv, amount: newRcv, rate: Math.round((Number(item.rate) || 0) * multiplier * 100) / 100 };
            });
            assistantResponseMessages.push(`Applied ${discountPercent}% discount to all items.`);
          }

          else if (cmd.type === 'markup') {
            const markupPercent = cmd.percent;
            const multiplier = 1 + (markupPercent / 100);
            updatedItems = updatedItems.map(item => {
              const currentRcv = Number(item.rcv) || 0;
              const newRcv = Math.round(currentRcv * multiplier * 100) / 100;
              return { ...item, rcv: newRcv, acv: newRcv, amount: newRcv, rate: Math.round((Number(item.rate) || 0) * multiplier * 100) / 100 };
            });
            assistantResponseMessages.push(`Applied ${markupPercent}% markup to all items.`);
          }

          else if (cmd.type === 'depreciate') {
            const depreciationPercent = cmd.percent;
            updatedItems = updatedItems.map(item => {
              const currentQty = Number(item.quantity) || 0;
              const currentRate = Number(item.rate) || 0;
              const currentRcv = Number(item.rcv) || (currentQty * currentRate);
              
              // Calculate ACV based on depreciation %
              const newAcv = currentRcv * (1 - depreciationPercent / 100);
              
              return {
                ...item,
                depreciation_percent: depreciationPercent,
                acv: newAcv,
                rcv: currentRcv,
                amount: currentRcv
              };
            });
            assistantResponseMessages.push(`✅ Applied ${depreciationPercent}% depreciation to all materials (ACV reduced by ${depreciationPercent}%).`);
          }
          
          else if (cmd.type === 'waste') {
            const alreadyHasWaste = messages.some(m => m.role === 'assistant' && m.content && (
              m.content.includes('waste included') || m.content.includes('waste to roofing') || m.content.includes('waste applied') || m.content.includes('Applied') && m.content.includes('waste')
            ));
            if (alreadyHasWaste) {
              assistantResponseMessages.push(`Waste was already included (12% auto-applied during estimate generation). If you want to add MORE waste on top, say "add 5% extra waste".`);
              continue;
            }
            const wastePercent = cmd.percent;
            updatedItems = updatedItems.map(item => {
              const desc = item.description?.toLowerCase() || '';
              // ROOFING materials
              const isRoofingMaterial = desc.includes('shingle') ||
                  desc.includes('underlayment') ||
                  desc.includes('felt') ||
                  desc.includes('ice & water') ||
                  desc.includes('starter') ||
                  desc.includes('drip') ||
                  desc.includes('cap') ||
                  desc.includes('valley') ||
                  desc.includes('flashing');
              
              // SIDING materials (add waste to siding, corners, j-channel)
              const isSidingMaterial = desc.includes('siding') ||
                  desc.includes('j-channel') ||
                  desc.includes('j channel') ||
                  desc.includes('corner') ||
                  desc.includes('soffit') ||
                  desc.includes('fascia');
              
              if (isRoofingMaterial || isSidingMaterial) {
                const multiplier = 1 + (wastePercent / 100);
                const qty = Number(item.quantity) || 0;
                const rate = Number(item.rate) || 0;
                const newQuantity = qty * multiplier;
                const newRcv = newQuantity * rate;
                const depPercent = Number(item.depreciation_percent) || 0;
                const newAcv = newRcv * (1 - depPercent / 100);
                return {
                  ...item,
                  quantity: newQuantity,
                  rcv: newRcv,
                  acv: newAcv,
                  amount: newRcv
                };
              }
              return item;
            });
            assistantResponseMessages.push(`Applied ${wastePercent}% waste to roofing & siding materials.`);
          }

          else if (cmd.type === 'target_per_sq' || cmd.type === 'target_total') {
            const roofSq = Number(currentEstimate?.roof_area_sq) || 
              (updatedItems.filter(i => i.unit?.toUpperCase() === 'SQ' && Number(i.quantity) > 0 && !i.description?.includes('━━━')).length > 0
                ? Math.min(...updatedItems.filter(i => i.unit?.toUpperCase() === 'SQ' && Number(i.quantity) > 0 && !i.description?.includes('━━━')).map(i => Number(i.quantity)))
                : (Number(satelliteAnalysis?.corrected_area_sq) || Number(satelliteAnalysis?.roof_area_sq) || 1));
            
            const currentTotal = updatedItems.reduce((sum, i) => sum + (Number(i.rcv) || 0), 0);
            const targetTotal = cmd.type === 'target_total' ? cmd.targetTotal : (cmd.targetPrice * roofSq);
            const targetPerSq = cmd.type === 'target_total' ? (cmd.targetTotal / roofSq) : cmd.targetPrice;
            const currentPerSq = Math.round(currentTotal / roofSq);

            if (targetTotal > 0 && currentTotal > 0) {
              const scaleFactor = targetTotal / currentTotal;
              updatedItems = updatedItems.map(item => {
                if (item.quantity === 0 || !item.rate) return item;
                const newRate = Number((Number(item.rate) * scaleFactor).toFixed(2));
                const qty = Number(item.quantity) || 0;
                const newRcv = Number((newRate * qty).toFixed(2));
                const depPct = Number(item.depreciation_percent) || 0;
                const newAcv = depPct > 0 ? Number((newRcv * (1 - depPct / 100)).toFixed(2)) : newRcv;
                return { ...item, rate: newRate, rcv: newRcv, acv: newAcv, amount: newRcv };
              });
              const newTotal = updatedItems.reduce((sum, i) => sum + (Number(i.rcv) || 0), 0);
              
              setCurrentEstimate(prev => ({ ...prev, roof_area_sq: roofSq, total_rcv: newTotal }));
              
              assistantResponseMessages.push(`Adjusted estimate to $${Math.round(newTotal).toLocaleString()} ($${targetPerSq.toFixed(2)}/SQ).\n\nPrevious: $${currentTotal.toLocaleString()} ($${currentPerSq}/SQ)`);
            } else {
              assistantResponseMessages.push(`Could not adjust - need an estimate with line items first.`);
            }
          }
          
          else if (cmd.type === 'steep') {
            if (!updatedItems.some(item => 
              (item.code?.toLowerCase().includes('steep') || item.code?.toLowerCase().includes('shstp')) || 
              (item.description?.toLowerCase().includes('steep') && (item.description?.toLowerCase().includes('roof') || item.description?.toLowerCase().includes('slope')))
            )) {
              const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });
              
              const steepItem = priceList.find(item => {
                const desc = item.description?.toLowerCase() || '';
                const code = item.code?.toLowerCase() || '';
                return (
                  code.includes('steep') || code.includes('shstp') ||
                  (desc.includes('steep') && (desc.includes('roof') || desc.includes('slope'))) ||
                  desc.includes('additional charge for steep') ||
                  desc.includes('steep roofing')
                );
              });
              
              if (steepItem) {
                const roofAreaSq = Number(satelliteAnalysis?.roof_area_sq) || 
                                  Number(updatedItems.find(item => item.unit?.toUpperCase() === 'SQ')?.quantity) || 
                                  1;
                
                const price = Number(steepItem.price) || 0;
                
                updatedItems.push({
                  line: updatedItems.length + 1,
                  code: steepItem.code,
                  description: steepItem.description,
                  quantity: roofAreaSq,
                  unit: steepItem.unit || 'SQ',
                  rate: price,
                  rcv: price * roofAreaSq,
                  acv: price * roofAreaSq,
                  amount: price * roofAreaSq,
                  depreciation: 0
                });
                assistantResponseMessages.push(`✅ Added steep roof surcharge.`);
              } else {
                assistantResponseMessages.push(`❌ Could not find steep roof surcharge in ${pricingSource.replace('_new', ' New')} price list.`);
              }
            } else {
              assistantResponseMessages.push(`⚠️ Steep roof surcharge already applied.`);
            }
          }
          
          else if (cmd.type === 'high') {
            if (!updatedItems.some(item => item.code === 'HIGHSRG' || 
                (item.description?.toLowerCase().includes('high') && item.description?.toLowerCase().includes('roof')))) {
              const currentTotal = updatedItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
              const highAmount = currentTotal * 0.15;
              updatedItems.push({
                line: updatedItems.length + 1,
                code: 'HIGHSRG',
                description: 'High Roof Surcharge (15%)',
                quantity: 1,
                unit: 'LS',
                rate: highAmount,
                rcv: highAmount,
                acv: highAmount,
                amount: highAmount,
                depreciation: 0
              });
              assistantResponseMessages.push(`✅ Applied 15% high roof surcharge.`);
            } else {
              assistantResponseMessages.push(`⚠️ High roof surcharge already applied.`);
            }
          }
          
          else if (cmd.type === 'op') {
            if (!updatedItems.some(item => item.code === 'O&P' || 
                (item.description?.toLowerCase().includes('overhead') && item.description?.toLowerCase().includes('profit')))) {
              const currentTotal = updatedItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
              const opAmount = currentTotal * 0.21;
              updatedItems.push({
                line: updatedItems.length + 1,
                code: 'O&P',
                description: 'Overhead & Profit (10% + 10%)',
                quantity: 1,
                unit: 'LS',
                rate: opAmount,
                rcv: opAmount,
                acv: opAmount,
                amount: opAmount,
                depreciation: 0
              });
              assistantResponseMessages.push(`✅ Applied O&P (21%).`);
            } else {
              assistantResponseMessages.push(`⚠️ O&P already applied.`);
            }
          }
          
          else if (cmd.type === 'add_item') {
            const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });
            
            const descLower = (cmd.description || '').toLowerCase();

            // Enhanced direct keyword matching for common chip items before generic search
            const findInList = (testFn) => priceList.find(i => testFn((i.description || '').toLowerCase(), (i.code || '').toUpperCase()));

            let matchedItem = null;

            if (descLower.includes('pipe') && (descLower.includes('boot') || descLower.includes('flash') || descLower.includes('jack'))) {
              matchedItem = findInList((d) => d.includes('pipe') && (d.includes('boot') || d.includes('jack') || d.includes('flash')))
                || { code: 'RFG PB', description: 'Pipe boot / jack flashing', unit: 'EA', price: 35 };
            } else if ((descLower.includes('vent') || descLower.includes('turtle')) && !descLower.includes('ridge') && !descLower.includes('power')) {
              matchedItem = findInList((d) => d.includes('vent') && (d.includes('box') || d.includes('turtle') || d.includes('roof')) && !d.includes('ridge') && !d.includes('power') && !d.includes('attic fan'))
                || { code: 'RFG BV', description: 'Roof vent - box type', unit: 'EA', price: 65 };
            } else if (descLower.includes('ridge vent') || (descLower.includes('ridge') && descLower.includes('vent'))) {
              matchedItem = findInList((d) => d.includes('ridge') && d.includes('vent'))
                || { code: 'RFG RV', description: 'Ridge vent, continuous', unit: 'LF', price: 6.50 };
            } else if (descLower.includes('power vent') || descLower.includes('attic fan')) {
              matchedItem = findInList((d) => (d.includes('power') && d.includes('vent')) || d.includes('attic fan'))
                || { code: 'RFG PV', description: 'Power vent / attic fan', unit: 'EA', price: 185 };
            } else if (descLower.includes('dumpster') || descLower.includes('debris') || descLower.includes('haul')) {
              matchedItem = findInList((d) => d.includes('dumpster') || d.includes('debris') || d.includes('haul'))
                || { code: 'DUMP', description: 'Dumpster / debris removal & haul off', unit: 'EA', price: 450 };
            } else if (descLower.includes('skylight')) {
              matchedItem = findInList((d) => d.includes('skylight'))
                || { code: 'SKYLIGHT', description: 'Skylight - replacement', unit: 'EA', price: 350 };
            } else if (descLower.includes('plywood') || descLower.includes('osb') || descLower.includes('decking') || descLower.includes('sheath')) {
              matchedItem = findInList((d) => (d.includes('osb') || d.includes('plywood') || d.includes('sheathing')) && (d.includes('roof') || d.includes('deck')))
                || { code: 'RFG PLY', description: 'Roof decking - OSB/plywood replacement', unit: 'SF', price: 3.50 };
            } else if (descLower.includes('chimney flash') || descLower.includes('chimney cap')) {
              matchedItem = findInList((d) => d.includes('chimney') && d.includes('flash'))
                || { code: 'CHIMFLASH', description: 'Chimney flashing - step & counter', unit: 'EA', price: 280 };
            } else if (descLower.includes('soffit')) {
              matchedItem = findInList((d) => d.includes('soffit'))
                || { code: 'SOFFIT', description: 'Soffit - vinyl', unit: 'LF', price: 4.50 };
            } else if (descLower.includes('fascia')) {
              matchedItem = findInList((d) => d.includes('fascia'))
                || { code: 'FASCIA', description: 'Fascia - aluminum', unit: 'LF', price: 3.75 };
            } else if (descLower.includes('permit')) {
              matchedItem = findInList((d) => d.includes('permit'))
                || { code: 'PERMIT', description: 'Building permit', unit: 'EA', price: 350 };
            }

            if (!matchedItem) {
              matchedItem = smartDescriptionMatch(cmd.description, priceList);
            }
            
            if (matchedItem) {
              const price = Number(matchedItem.price) || 0;
              const qty = Number(cmd.quantity) || 1;
              
              updatedItems.push({
                line: updatedItems.length + 1,
                code: matchedItem.code,
                description: matchedItem.description,
                quantity: qty,
                unit: matchedItem.unit || 'EA',
                rate: price,
                rcv: price * qty,
                acv: price * qty,
                amount: price * qty,
                depreciation: 0
              });
              assistantResponseMessages.push(`✅ Added ${qty} ${matchedItem.unit || 'EA'} of ${matchedItem.description}.`);
            } else {
              assistantResponseMessages.push(`⚠️ Could not find "${cmd.description}" in price list. Item not added.`);
            }
          }
        }
        
        if (assistantResponseMessages.length > 0) {
            setLineItems(updatedItems);
            const newTotal = updatedItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
            
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `${assistantResponseMessages.join('\n')}\n\n💰 New total: $${newTotal.toLocaleString()}`,
              timestamp: new Date().toISOString()
            }]);
            
            setIsProcessing(false);
            return;
        }
      }
      
      // 6. Remove/delete line item
      if ((messageLower.includes('remove') || messageLower.includes('delete')) && (messageLower.includes('item') || messageLower.includes('line'))) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `To remove a line item, click the red trash icon (🗑️) next to the item in the table above.`,
          timestamp: new Date().toISOString()
        }]);
        setIsProcessing(false);
        return;
      }
      
      // 7. Change quantity
      if (messageLower.includes('change') && messageLower.includes('quantity')) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `To change quantities, click directly on the Qty field in the table and type the new value.`,
          timestamp: new Date().toISOString()
        }]);
        setIsProcessing(false);
        return;
      }
      
      // 8. If we have line items and user is asking about pricing/totals
      if (lineItems.length > 0 && (messageLower.includes('total') || messageLower.includes('price') || messageLower.includes('cost'))) {
        const total = lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `📊 **Current Estimate:**\n• ${lineItems.length} line items\n• Total: $${total.toLocaleString()}\n\nWhat else would you like to adjust?`,
          timestamp: new Date().toISOString()
        }]);
        setIsProcessing(false);
        return;
      }
      
      // 9. Fall through to InvokeLLM for natural language estimate generation or complex queries.
      if (userMessage.trim().length > 0 || fileUrls.length > 0) {
        const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });

        const topPrices = priceList.slice(0, 100);
        const priceListContext = topPrices.map(p =>
          `${p.code}: ${p.description} - $${p.price} per ${p.unit}`
        ).join('\n');

        const isComparisonQuery = /compare|competitor|their estimate|too high|overcharge|check.*bid|other.*bid|another.*company|beat|lower|higher|competitor|abc roofing|outside.*estimate/i.test(userMessage);

        let competitorContext = "";
        if (isComparisonQuery && competitorEstimates.length > 0) {
          competitorContext = `\n\nCOMPETITOR ESTIMATES ON FILE:\n${competitorEstimates.map(ce =>
            `---\n${ce.title}\n${ce.content}`
          ).join('\n')}\n\nWhen comparing, highlight: price differences per line item, items we include that they don't, items they include that we don't, and overall value differences.`;
        }

        let trainingContext = "";
        if (trainingDocuments.length > 0) {
          trainingContext = `\n\nTRAINING REFERENCE DOCUMENTS (use these to write more accurate quantities and line items):\n${trainingDocuments.map(doc =>
            `--- ${doc.title} ---\n${doc.content}`
          ).join('\n\n')}\n\nApply patterns from these reference documents when determining realistic quantities, measurements, and line items.`;
        }

        const insuranceJobPrompt = isInsuranceJob
          ? `\n\nINSURANCE CLAIM ESTIMATE — XACTIMATE FORMAT: Format each line item exactly like Xactimate software output. For EVERY line item you must populate these fields:
- xactimate_code: Xactimate category + selection code (e.g. "RFG 300S" for 30-yr comp shingles, "RFG DRIP" for drip edge, "RFG RIDGCS" for ridge cap shingles, "RFG I&W" for ice & water shield, "RFG FLG" for step flashing, "RFG VLY" for valley metal, "RFG PJCK" for pipe jack boot, "RFG NAILS" for coil nails, "RFG STRP" for starter strip shingles, "DML GNTL" for gentle-slope shingle tear-off, "DML STEEP" for steep-slope tear-off)
- action: "+" (install/replace only), "-" (remove/tear-off only), or "R&R" (remove AND replace existing material)
- remove_rate: cost per unit for removal labor only (set to 0 if action is "+")
- replace_rate: cost per unit for installation/material (set to 0 if action is "-")
- rate: total rate = remove_rate + replace_rate (required for backward compatibility)
- tax_rate: sales tax percentage on materials (typically 8.0 for taxable materials, 0 for labor-only line items)
Include ALL of the following as separate Xactimate line items — do not bundle or skip any:
- Tear-off (action "-", code DML GNTL or DML STEEP based on roof pitch)
- Starter Strip (action "+", code RFG STRP, unit LF)
- Ice & Water Shield at all eaves (min 3 ft) and all valley areas (action "+", code RFG I&W, unit SQ)
- Drip Edge at eaves (action "+", code RFG DRIP, unit LF) — list eaves and rakes as separate line items
- Drip Edge at rakes (action "+", code RFG DRIP, unit LF)
- 30-yr Comp Shingles or matching type (action "+", code RFG 300S, unit SQ)
- Ridge Cap Shingles (action "+", code RFG RIDGCS, unit LF)
- Each Pipe Boot/Pipe Jack individually (action "R&R", code RFG PJCK, unit EA)
- Step Flashing at all wall-to-roof intersections (action "R&R", code RFG FLG, unit LF)
- Valley Metal if open valleys present (action "+", code RFG VLY, unit LF)
- Coil Roofing Nails (action "+", code RFG NAILS, unit BX)
List line items in standard Xactimate order (Demolition first, then Roofing). Do NOT include Overhead & Profit (O&P).`
          : "";

        const systemPrompt = `You are an expert construction estimator. Use this pricing database:

${priceListContext}

Create an estimate with line items matching the database.${trainingContext}${competitorContext}${insuranceJobPrompt}`;

        const llmResponse = await base44.integrations.Core.InvokeLLM({
          prompt: `${systemPrompt}\n\n${userMessage}`,
          file_urls: fileUrls,
          response_json_schema: {
            type: "object",
            properties: {
              line_items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    description: { type: "string" },
                    quantity: { type: "number" },
                    unit: { type: "string" },
                    rate: { type: "number", description: "Total unit price in USD (remove_rate + replace_rate). Match to the closest item in the provided price list." },
                    xactimate_code: { type: "string", description: "Xactimate category + selection code (e.g. 'RFG 300S', 'RFG DRIP', 'DML GNTL'). Required for insurance estimates." },
                    action: { type: "string", description: "Xactimate action code: '+' (install only), '-' (remove/tear-off only), 'R&R' (remove and replace). Required for insurance estimates." },
                    remove_rate: { type: "number", description: "Per-unit removal/labor cost. 0 if action is '+'. Required for insurance estimates." },
                    replace_rate: { type: "number", description: "Per-unit installation/material cost. 0 if action is '-'. Required for insurance estimates." },
                    tax_rate: { type: "number", description: "Material tax percentage (e.g. 8.0). 0 for labor-only line items. Required for insurance estimates." }
                  },
                  required: ["description", "quantity", "unit", "rate"]
                }
              },
              project_name: { type: "string" },
              customer_info: {
                type: "object",
                properties: {
                  customer_name: { type: "string" },
                  property_address: { type: "string" },
                  claim_number: { type: "string" },
                  insurance_company: { type: "string" }
                }
              }
            }
          }
        });

        if (llmResponse && typeof llmResponse === 'object' && Array.isArray(llmResponse.line_items) && llmResponse.line_items.length > 0) {
          _generateAndSetEstimate(llmResponse, uploadedFiles.length > 0 ? uploadedFiles[0].name : "AI generated estimate");
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚠️ I couldn't generate an estimate from your request. Please be more specific or upload a document.`,
            timestamp: new Date().toISOString()
          }]);
        }
      }
    } catch (error) {
      console.error('AI Error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Error: ${error.message}`,
        timestamp: new Date().toISOString()
      }]);
    }
    
    setIsProcessing(false);
  };

  const _generateAndSetEstimate = (extractedData, fileName) => {
    // Save current state before modifying line items
    saveToHistory();

    const items = extractedData.line_items || [];

    const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });

    const enrichedItems = items.map((item, index) => {
      const extractedRate = Number(item.rate) || 0;
      const matchedItem = !extractedRate && item.description ? smartDescriptionMatch(item.description, priceList) : null;

      const price = extractedRate || (matchedItem ? (Number(matchedItem.price) || 0) : 0);
      const qty = Number(item.quantity) || 0;

      return {
        line: index + 1,
        code: item.code || matchedItem?.code || '',
        description: item.description,
        quantity: qty,
        unit: item.unit || matchedItem?.unit || 'EA',
        rate: price,
        amount: price * qty,
        rcv: price * qty,
        depreciation: 0,
        acv: price * qty,
        xactimate_code: item.xactimate_code || '',
        action: item.action || '',
        remove_rate: Number(item.remove_rate) || 0,
        replace_rate: Number(item.replace_rate) || 0,
        tax_rate: Number(item.tax_rate) || 0
      };
    });

    setLineItems(enrichedItems);

    const totalRcv = enrichedItems.reduce((acc, item) => {
      return acc + (Number(item.rcv) || 0);
    }, 0);

    const unmatched = enrichedItems.filter(i => (Number(i.rate) || 0) === 0).length;

    // Detect roof area sq from line items (look for SQ tear-off or shingle items)
    const sqItems = enrichedItems.filter(i => i.unit?.toUpperCase() === 'SQ' && Number(i.quantity) > 0);
    const inferredRoofSq = sqItems.length > 0
      ? Math.min(...sqItems.map(i => Number(i.quantity)))  // smallest SQ qty = base area (no waste)
      : 0;

    setCurrentEstimate({
      title: extractedData.project_name || `Estimate from ${fileName}`,
      line_items: enrichedItems,
      total_rcv: totalRcv,
      roof_area_sq: inferredRoofSq || undefined
    });

    if (extractedData.customer_info) {
      setCustomerInfo(prev => {
        // If we have a selected contact (locked context), ONLY update fields that are empty
        if (selectedContactId) {
          return {
            ...prev,
            // Don't overwrite name/email/phone if we have a linked contact
            property_address: prev.property_address || extractedData.customer_info.property_address || "",
            claim_number: prev.claim_number || extractedData.customer_info.claim_number || "",
            insurance_company: prev.insurance_company || extractedData.customer_info.insurance_company || "",
            // Keep existing contact details strictly
            customer_name: prev.customer_name,
            customer_email: prev.customer_email,
            customer_phone: prev.customer_phone
          };
        }
        
        // Otherwise, use AI data freely
        return {
          ...prev,
          customer_name: extractedData.customer_info.customer_name || prev.customer_name,
          customer_email: extractedData.customer_info.customer_email || prev.customer_email,
          customer_phone: extractedData.customer_info.customer_phone || prev.customer_phone,
          property_address: extractedData.customer_info.property_address || prev.property_address,
          claim_number: extractedData.customer_info.claim_number || prev.claim_number,
          insurance_company: extractedData.customer_info.insurance_company || prev.insurance_company
        };
      });
    }

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `✅ Extracted ${enrichedItems.length} items. Total: $${totalRcv.toLocaleString()}${unmatched > 0 ? `\n⚠️ ${unmatched} items need pricing` : ''}`,
      timestamp: new Date().toISOString()
    }]);
  };

  const _processEstimateRequest = async (fileUrls, userMessage, fileName) => {
    setIsProcessing(true);

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `🤖 **AI is analyzing ${fileUrls.length > 1 ? `${fileUrls.length} documents` : 'your document'}...**\n\n⏱️ This may take 30-60 seconds...`,
      timestamp: new Date().toISOString()
    }]);

    try {
      // MULTI-DOCUMENT HANDLING: Process each file separately then merge
      if (fileUrls.length > 1) {
        const allExtractedItems = [];
        let mergedCustomerInfo = {};

        for (let i = 0; i < fileUrls.length; i++) {
          const singleFileUrl = [fileUrls[i]];
          const docName = uploadedFiles[i]?.name || `Document ${i+1}`;

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `📄 **Processing ${docName}** (${i + 1}/${fileUrls.length})...`,
            timestamp: new Date().toISOString()
          }]);

          // Detect type for this specific file
          const typeCheck = await base44.integrations.Core.InvokeLLM({
            prompt: `Analyze this document and respond with ONLY ONE of these types:
- "hover_measurement" if it's a roof measurement report (HOVER, EagleView) with NO PRICES
- "siding_measurement" if it's a wall/siding measurement report (Aerial Reports) with NO PRICES
- "insurance_estimate" if it contains line items WITH PRICES
- "contractor_estimate" if it's a contractor estimate WITH PRICES

Respond with just the type, nothing else.`,
            file_urls: singleFileUrl
          });

          const detectedType = typeCheck.toLowerCase().trim();
          const docType = detectedType.includes('siding') ? 'siding_measurement' :
                        detectedType.includes('hover') ? 'hover_measurement' :
                        detectedType.includes('insurance') ? 'insurance_estimate' :
                        detectedType.includes('contractor') ? 'contractor_estimate' : 'unknown';

          console.log(`📄 Document ${i+1} type:`, docType);

          // Extract based on type
          if (docType === 'hover_measurement') {
            const measurementsResponse = await base44.integrations.Core.InvokeLLM({
              prompt: `Extract ALL roof measurements from this roof measurement report (HOVER, EagleView, or similar). 

            CRITICAL: Search the ENTIRE document thoroughly - measurements may be in tables, diagrams, or text. Look for:
            - Total roof area (square feet AND squares)
            - Ridge, Hip, Valley, Rake, Eave lengths (LF)
            - Pitch/slope
            - Roof type: Is this a FLAT ROOF (0/12 to 2/12 pitch) or PITCHED ROOF (3/12+)?
            - Any other roof measurements

            Return JSON with roof_area_sq, ridge_lf, hip_lf, valley_lf, rake_lf, eave_lf, step_flashing_lf, pitch, is_flat_roof (boolean), gutter_lf, downspout_count, and customer_info.`,
              file_urls: singleFileUrl,
              response_json_schema: {
                type: "object",
                properties: {
                  roof_area_sqft: { type: "number" },
                  roof_area_sq: { type: "number" },
                  ridge_lf: { type: "number" },
                  hip_lf: { type: "number" },
                  valley_lf: { type: "number" },
                  rake_lf: { type: "number" },
                  eave_lf: { type: "number" },
                  step_flashing_lf: { type: "number" },
                  apron_flashing_lf: { type: "number" },
                  pitch: { type: "string" },
                  is_flat_roof: { type: "boolean" },
                  gutter_lf: { type: "number" },
                  downspout_count: { type: "number" },
                  customer_info: { type: "object", properties: { customer_name: { type: "string" }, property_address: { type: "string" }, claim_number: { type: "string" } } }
                }
              }
            });

            if ((!measurementsResponse.roof_area_sq || Number(measurementsResponse.roof_area_sq) === 0) && Number(measurementsResponse.roof_area_sqft) > 0) {
              measurementsResponse.roof_area_sq = Number(measurementsResponse.roof_area_sqft) / 100;
            }
            const roofItems = await convertMeasurementsToLineItemsArray(measurementsResponse);
            allExtractedItems.push(...roofItems);
            mergedCustomerInfo = { ...mergedCustomerInfo, ...measurementsResponse.customer_info };
            setReportMeasurements({
              roof_area_sqft: Number(measurementsResponse.roof_area_sqft) || (Number(measurementsResponse.roof_area_sq) || 0) * 100,
              roof_area_sq: Number(measurementsResponse.roof_area_sq) || 0,
              ridge_lf: Number(measurementsResponse.ridge_lf) || 0,
              hip_lf: Number(measurementsResponse.hip_lf) || 0,
              valley_lf: Number(measurementsResponse.valley_lf) || 0,
              rake_lf: Number(measurementsResponse.rake_lf) || 0,
              eave_lf: Number(measurementsResponse.eave_lf) || 0,
              step_flashing_lf: Number(measurementsResponse.step_flashing_lf) || 0,
              pitch: measurementsResponse.pitch || '',
              source: 'uploaded_report'
            });
            setCalibrationResult(null);

          } else if (docType === 'siding_measurement') {
            const sidingResponse = await base44.integrations.Core.InvokeLLM({
              prompt: `Extract ALL siding/wall measurements from this Aerial Reports measurement report. Return JSON with wall_area_sq, wall_top_lf, wall_bottom_lf, inside_corners_count, inside_corners_lf, outside_corners_count, outside_corners_lf, and customer_info.`,
              file_urls: singleFileUrl,
              response_json_schema: {
                type: "object",
                properties: {
                  wall_area_sqft: { type: "number" },
                  wall_area_sq: { type: "number" },
                  wall_top_lf: { type: "number" },
                  wall_bottom_lf: { type: "number" },
                  inside_corners_count: { type: "number" },
                  inside_corners_lf: { type: "number" },
                  outside_corners_count: { type: "number" },
                  outside_corners_lf: { type: "number" },
                  customer_info: { type: "object", properties: { customer_name: { type: "string" }, property_address: { type: "string" } } }
                }
              }
            });

            // Convert siding measurements to line items WITHOUT setting state
            const sidingItems = await convertSidingMeasurementsToLineItemsArray(sidingResponse);
            allExtractedItems.push(...sidingItems);
            mergedCustomerInfo = { ...mergedCustomerInfo, ...sidingResponse.customer_info };

          } else {
            // Priced estimate extraction
            const response = await base44.integrations.Core.InvokeLLM({
              prompt: `Extract ALL line items from this estimate. For EACH item, extract: description, quantity, unit, AND rate (price). Return JSON.`,
              file_urls: singleFileUrl,
              response_json_schema: {
                type: "object",
                properties: {
                  line_items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        code: { type: "string" },
                        description: { type: "string" },
                        quantity: { type: "number" },
                        unit: { type: "string" },
                        rate: { type: "number" }
                      }
                    }
                  },
                  customer_info: { type: "object" }
                }
              }
            });

            if (response?.line_items) {
              const enrichedItems = response.line_items.map((item, index) => {
                const price = Number(item.rate) || 0;
                const qty = Number(item.quantity) || 0;
                return {
                  line: allExtractedItems.length + index + 1,
                  code: item.code || '',
                  description: item.description,
                  quantity: qty,
                  unit: item.unit || 'EA',
                  rate: price,
                  rcv: price * qty,
                  acv: price * qty,
                  amount: price * qty,
                  depreciation: 0
                };
              });
              allExtractedItems.push(...enrichedItems);
              mergedCustomerInfo = { ...mergedCustomerInfo, ...response.customer_info };
            }
          }
        }

        // NOW set all merged items at once
        setLineItems(allExtractedItems);
        const totalRcv = allExtractedItems.reduce((acc, item) => acc + (Number(item.rcv) || 0), 0);
        
        const combinedSqItems = allExtractedItems.filter(i => i.unit?.toUpperCase() === 'SQ' && Number(i.quantity) > 0);
        const combinedInferredSq = combinedSqItems.length > 0 ? Math.min(...combinedSqItems.map(i => Number(i.quantity))) : 0;
        setCurrentEstimate({
          title: `Combined Estimate - ${mergedCustomerInfo.customer_name || customerInfo.customer_name || 'Multiple Documents'}`,
          line_items: allExtractedItems,
          total_rcv: totalRcv,
          roof_area_sq: combinedInferredSq || undefined
        });

        if (mergedCustomerInfo) {
          setCustomerInfo(prev => ({
            ...prev,
            customer_name: mergedCustomerInfo.customer_name || prev.customer_name,
            property_address: mergedCustomerInfo.property_address || prev.property_address,
            claim_number: mergedCustomerInfo.claim_number || prev.claim_number,
            insurance_company: mergedCustomerInfo.insurance_company || prev.insurance_company
          }));
        }

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ **Merged ${fileUrls.length} documents!**\n\n📊 ${allExtractedItems.length} total items • $${totalRcv.toLocaleString()}\n\n💡 Review the combined estimate below and adjust as needed.`,
          timestamp: new Date().toISOString()
        }]);

        setIsProcessing(false);
        return;
      }

      // SINGLE DOCUMENT PROCESSING (original logic)
      let docTypeResponse;
      try {
        const simpleTypeCheck = await base44.integrations.Core.InvokeLLM({
          prompt: `Analyze this document and respond with ONLY ONE of these exact type strings:

- "hover_measurement" — ONLY if it is a pure roof MEASUREMENT report from HOVER or EagleView that contains NO dollar prices, only dimensions (sq ft, LF, pitch, etc.)
- "siding_measurement" — ONLY if it is a wall/siding measurement report from Aerial Reports with NO prices
- "insurance_estimate" — if it is an insurance company estimate or claim document (Allstate, State Farm, Nationwide, Farmers, Xactimate, Symbility, etc.) that contains itemized line items WITH dollar prices/amounts
- "contractor_estimate" — if it is a contractor-generated estimate WITH prices

KEY RULE: If you see dollar amounts, RCV, ACV, prices, or cost columns anywhere in the document, it is NOT a hover_measurement — it must be "insurance_estimate" or "contractor_estimate".

Respond with just the type string, nothing else.`,
          file_urls: fileUrls
        });

        const detectedType = simpleTypeCheck.toLowerCase().trim();
        
        docTypeResponse = {
          document_type: detectedType.includes('siding') ? 'siding_measurement' :
                        detectedType.includes('hover') ? 'hover_measurement' :
                        detectedType.includes('insurance') ? 'insurance_estimate' :
                        detectedType.includes('contractor') ? 'contractor_estimate' : 'unknown',
          confidence: 85,
          reason: `Detected as ${detectedType}`
        };
        
        console.log('📄 Document type detected:', docTypeResponse);
      } catch (docTypeError) {
        console.error('❌ Document type detection failed:', docTypeError);
        // Fallback: Try to detect by attempting extraction
        docTypeResponse = {
          document_type: 'unknown',
          confidence: 0,
          reason: 'Failed to detect type - will try multiple extraction methods'
        };
      }

      // STEP 2: Extract based on document type
      if (docTypeResponse.document_type === "unknown") {
        // Try all extraction methods
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `🔍 **Detecting document type...**`,
          timestamp: new Date().toISOString()
        }]);

        // Try siding first, then roof, then priced estimate
        try {
          const sidingTest = await base44.integrations.Core.InvokeLLM({
            prompt: `Does this document contain wall/siding measurements? Answer with just "yes" or "no".`,
            file_urls: fileUrls
          });
          
          if (sidingTest.toLowerCase().includes('yes')) {
            docTypeResponse.document_type = 'siding_measurement';
          } else {
            const roofTest = await base44.integrations.Core.InvokeLLM({
              prompt: `Does this document contain roof measurements (ridges, valleys, eaves)? Answer with just "yes" or "no".`,
              file_urls: fileUrls
            });
            
            if (roofTest.toLowerCase().includes('yes')) {
              docTypeResponse.document_type = 'hover_measurement';
            } else {
              docTypeResponse.document_type = 'insurance_estimate';
            }
          }
        } catch (testError) {
          console.error('Type testing failed:', testError);
          docTypeResponse.document_type = 'insurance_estimate'; // Default fallback
        }
      }

      console.log('📄 Final document type:', docTypeResponse.document_type);

      if (docTypeResponse.document_type === "hover_measurement") {
        // Extract MEASUREMENTS (no prices in document)
        const measurementsResponse = await base44.integrations.Core.InvokeLLM({
          prompt: `Extract ALL roof measurements from this roof measurement report (HOVER, EagleView, or similar).

**CRITICAL: Look for these measurements anywhere in the document:**
- Roof area in square feet AND squares (1 SQ = 100 sq ft)
- Ridge length (LF)
- Hip length (LF)
- Valley length (LF)
- Rake length (LF)
- Eave length (LF)
- Step flashing length (LF)
- Drip edge/perimeter length (LF)
- Primary pitch (e.g., 5/12 or 6:12)
- **FLAT ROOF DETECTION:** Is this a flat/low-slope roof (0/12 to 2/12 pitch)?
- Total gutter length (LF)
- Number of downspouts (EA)
- List all structures (e.g., House, Garage, Shed)
- Customer info if available

**Important:** Search the ENTIRE document for measurements. EagleView and HOVER reports may use different layouts. Extract all numeric measurements you can find.

Return JSON with these exact measurements.`,
          file_urls: fileUrls,
          response_json_schema: {
            type: "object",
            properties: {
              roof_area_sqft: { type: "number", description: "Total roof area in square feet" },
              roof_area_sq: { type: "number", description: "Total roof area in squares (SQ)" },
              ridge_lf: { type: "number" },
              hip_lf: { type: "number" },
              valley_lf: { type: "number" },
              rake_lf: { type: "number" },
              eave_lf: { type: "number" },
              step_flashing_lf: { type: "number" },
              apron_flashing_lf: { type: "number" },
              drip_edge_lf: { type: "number" },
              gutter_lf: { type: "number", description: "Total linear feet of gutters" },
              downspout_count: { type: "number", description: "Total number of downspouts" },
              pitch: { type: "string", description: "Primary pitch (e.g., 5/12)" },
              is_flat_roof: { type: "boolean", description: "True if flat/low-slope roof (0/12 to 2/12 pitch)" },
              structures: { type: "array", items: { type: "object", properties: { name: { type: "string" }, area_sq: { type: "number" } } } },
              customer_info: {
                type: "object",
                properties: {
                  customer_name: { type: "string" },
                  property_address: { type: "string" },
                  claim_number: { type: "string" }
                }
              }
            }
          }
        });

        console.log('📏 Extracted measurements:', measurementsResponse);

        if (!measurementsResponse || typeof measurementsResponse !== 'object') {
          throw new Error('Invalid measurements response - please try a different file');
        }

        const hasRoof = Number(measurementsResponse?.roof_area_sq) > 0 || Number(measurementsResponse?.roof_area_sqft) > 0;
        const hasGutter = Number(measurementsResponse?.gutter_lf) > 0 || Number(measurementsResponse?.downspout_count) > 0;
        if (hasRoof || hasGutter) {
          const isFlatRoof = measurementsResponse.is_flat_roof || 
                            measurementsResponse.pitch?.toLowerCase().includes('flat') ||
                            (measurementsResponse.pitch && parseInt(measurementsResponse.pitch) <= 2);

          if (isFlatRoof) {
            await convertFlatRoofToLineItems(measurementsResponse);
          } else {
            await convertMeasurementsToLineItems(measurementsResponse, userMessage);
          }

          setReportMeasurements({
            roof_area_sqft: Number(measurementsResponse.roof_area_sqft) || (Number(measurementsResponse.roof_area_sq) || 0) * 100,
            roof_area_sq: Number(measurementsResponse.roof_area_sq) || 0,
            ridge_lf: Number(measurementsResponse.ridge_lf) || 0,
            hip_lf: Number(measurementsResponse.hip_lf) || 0,
            valley_lf: Number(measurementsResponse.valley_lf) || 0,
            rake_lf: Number(measurementsResponse.rake_lf) || 0,
            eave_lf: Number(measurementsResponse.eave_lf) || 0,
            step_flashing_lf: Number(measurementsResponse.step_flashing_lf) || 0,
            pitch: measurementsResponse.pitch || '',
            source: 'uploaded_report'
          });
          setCalibrationResult(null);

          if (measurementsResponse.customer_info) {
            setCustomerInfo(prev => ({
              ...prev,
              customer_name: measurementsResponse.customer_info.customer_name || prev.customer_name,
              property_address: measurementsResponse.customer_info.property_address || prev.property_address,
              claim_number: measurementsResponse.customer_info.claim_number || prev.claim_number
            }));
          }
        } else {
          // No HOVER-style measurements found — this document likely has prices (insurance/Xactimate estimate)
          // and was misclassified. Retry as a priced estimate instead of failing.
          console.warn('⚠️ No roof measurements found in supposed hover_measurement doc — retrying as insurance estimate');
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `🔄 **No measurement data found — this looks like a priced estimate. Extracting line items...**`,
            timestamp: new Date().toISOString()
          }]);

          const fallbackExtract = await base44.integrations.Core.InvokeLLM({
            prompt: `Extract ALL line items from this insurance/contractor estimate PDF.

**CRITICAL EXTRACTION RULES:**
1. ONLY extract from main estimate sections (with columns: Description, Qty, Unit, Rate/Price, RCV, ACV)
2. SKIP these pages entirely:
   - "Trade Summary" pages
   - "Time & Material Breakdown" pages
   - "Recap by Room" or "Recap by Category" pages
   - Labor/Material detail breakdowns
   - Summary pages that aggregate other sections
3. Look for line items that show: Description, Quantity, Unit, Rate/Price
4. Extract EXACT prices from the "Unit Price" or "Rate" column
5. Units: SQ (squares), LF (linear feet), SF (square feet), EA (each)

Return JSON with all unique line items.`,
            file_urls: fileUrls,
            response_json_schema: {
              type: "object",
              properties: {
                line_items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      code: { type: "string" },
                      description: { type: "string" },
                      quantity: { type: "number" },
                      unit: { type: "string" },
                      rate: { type: "number", description: "EXACT price per unit from PDF" }
                    },
                    required: ["description", "quantity", "unit"]
                  }
                },
                customer_info: {
                  type: "object",
                  properties: {
                    customer_name: { type: "string" },
                    property_address: { type: "string" },
                    claim_number: { type: "string" }
                  }
                }
              }
            }
          });

          if (fallbackExtract?.line_items && fallbackExtract.line_items.length > 0) {
            console.log(`✅ Fallback extraction got ${fallbackExtract.line_items.length} items`);
            if (fallbackExtract.customer_info) {
              setCustomerInfo(prev => ({
                ...prev,
                customer_name: fallbackExtract.customer_info.customer_name || prev.customer_name,
                property_address: fallbackExtract.customer_info.property_address || prev.property_address,
                claim_number: fallbackExtract.customer_info.claim_number || prev.claim_number
              }));
            }
            _generateAndSetEstimate(fallbackExtract, fileName);
          } else {
            throw new Error('Could not extract data from this document. Make sure it is a text-based PDF (not a scanned image).');
          }
        }

      } else if (docTypeResponse.document_type === "siding_measurement") {
        // Extract SIDING MEASUREMENTS (no prices in document)
        const sidingResponse = await base44.integrations.Core.InvokeLLM({
          prompt: `Extract ALL siding/wall measurements from this Aerial Reports measurement report.

**Key measurements to extract:**
- Total wall area in square feet (ft²)
- Total wall area in squares (SQ) - 1 SQ = 100 sq ft
- Wall top trim length (LF)
- Wall bottom trim length (LF)
- Number of inside corners
- Total length of inside corners (LF)
- Number of outside corners
- Total length of outside corners (LF)
- Total wall length/perimeter (LF)
- Customer/property info if available

Return JSON with these exact measurements.`,
          file_urls: fileUrls,
          response_json_schema: {
            type: "object",
            properties: {
              wall_area_sqft: { type: "number", description: "Total wall area in square feet" },
              wall_area_sq: { type: "number", description: "Total wall area in squares (SQ)" },
              wall_top_lf: { type: "number", description: "Wall top trim length" },
              wall_bottom_lf: { type: "number", description: "Wall bottom trim length" },
              inside_corners_count: { type: "number" },
              inside_corners_lf: { type: "number" },
              outside_corners_count: { type: "number" },
              outside_corners_lf: { type: "number" },
              total_wall_length: { type: "number" },
              customer_info: {
                type: "object",
                properties: {
                  customer_name: { type: "string" },
                  property_address: { type: "string" }
                }
              }
            }
          }
        });

        console.log('📏 Extracted siding measurements:', sidingResponse);

        if (!sidingResponse || typeof sidingResponse !== 'object') {
          throw new Error('Invalid siding measurements response - please try a different file');
        }

        if (Number(sidingResponse.wall_area_sq) > 0 || Number(sidingResponse.wall_area_sqft) > 0) {
          // Convert siding measurements to line items
          await convertSidingMeasurementsToLineItems(sidingResponse);

          // Set customer info
          if (sidingResponse.customer_info) {
            setCustomerInfo(prev => ({
              ...prev,
              customer_name: sidingResponse.customer_info.customer_name || prev.customer_name,
              property_address: sidingResponse.customer_info.property_address || prev.property_address
            }));
          }
        } else {
          throw new Error('Could not extract wall measurements from siding report');
        }

      } else {
        // Extract PRICED LINE ITEMS (insurance/contractor estimates)
        const priceList = getActivePriceList(pricingSource, { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList });

        const topPrices = priceList.slice(0, 50);
        const priceListJson = topPrices.map(p => ({
          code: p.code,
          desc: p.description?.substring(0, 60) || '',
          unit: p.unit
        }));

        const response = await base44.integrations.Core.InvokeLLM({
          prompt: `Extract ALL line items from this insurance/contractor estimate PDF.

**CRITICAL EXTRACTION RULES:**
1. ONLY extract from main estimate sections (with columns: Description, Qty, Unit, Rate/Price, RCV, ACV)
2. SKIP these pages entirely:
   - "Trade Summary" pages
   - "Time & Material Breakdown" pages
   - "Recap by Room" or "Recap by Category" pages
   - Labor/Material detail breakdowns
   - Summary pages that aggregate other sections
3. Look for line items that show: Description, Quantity, Unit, Rate/Price
4. Extract EXACT prices from the "Unit Price" or "Rate" column
5. Units: SQ (squares), LF (linear feet), SF (square feet), EA (each)

**Example:**
"Drip Edge, Aluminum | 190.23 | $2.90 | LF | $551.66"
Extract as: {description: "Drip Edge, Aluminum", quantity: 190.23, unit: "LF", rate: 2.90}

**IMPORTANT:** If you see duplicate items (same description appearing twice), only extract it ONCE from the main estimate section.

**Xactimate code hints (for reference only, DO NOT use these prices):**
${JSON.stringify(priceListJson, null, 2)}

Return JSON with ONLY unique line items from main estimate sections.`,
          file_urls: fileUrls,
          response_json_schema: {
            type: "object",
            properties: {
              line_items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    description: { type: "string" },
                    quantity: { type: "number" },
                    unit: { type: "string" },
                    rate: { type: "number", description: "EXACT price per unit from PDF" }
                  },
                  required: ["description", "quantity", "unit"]
                }
              },
              total_items_extracted: { type: "number" },
              customer_info: {
                type: "object",
                properties: {
                  customer_name: { type: "string" },
                  property_address: { type: "string" },
                  claim_number: { type: "string" }
                }
              }
            }
          }
        });

        console.log('📊 LLM Response:', JSON.stringify(response, null, 2));

        if (response?.line_items && response.line_items.length > 0) {
          console.log(`✅ Extracted ${response.line_items.length} priced items from estimate`);
          
          if (response.total_items_extracted && response.line_items.length < response.total_items_extracted * 0.8) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `⚠️ **Possible incomplete extraction:** Found ${response.line_items.length} items, but document may contain ${response.total_items_extracted}.`,
              timestamp: new Date().toISOString()
            }]);
          }
          
          _generateAndSetEstimate(response, fileName);
        } else {
          console.error('❌ No line items in response:', response);
          
          // Try simpler extraction as fallback
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚠️ **Initial extraction failed. Trying alternate method...**`,
            timestamp: new Date().toISOString()
          }]);
          
          try {
            const fallbackResponse = await base44.integrations.Core.InvokeLLM({
              prompt: `Extract line items from this estimate PDF. Return ALL items with:
- description (item name)
- quantity (number)
- unit (SQ, LF, EA, etc.)
- rate (price per unit, if visible)

Be very thorough and extract EVERY line item you see.`,
              file_urls: fileUrls,
              response_json_schema: {
                type: "object",
                properties: {
                  line_items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        description: { type: "string" },
                        quantity: { type: "number" },
                        unit: { type: "string" },
                        rate: { type: "number" }
                      },
                      required: ["description", "quantity"]
                    }
                  }
                }
              }
            });
            
            if (fallbackResponse?.line_items && fallbackResponse.line_items.length > 0) {
              console.log(`✅ Fallback extraction succeeded: ${fallbackResponse.line_items.length} items`);
              _generateAndSetEstimate(fallbackResponse, fileName);
            } else {
              throw new Error('Could not extract line items from estimate - PDF may be scanned image or unreadable');
            }
          } catch (fallbackError) {
            throw new Error('Could not extract line items - try uploading a different file or enter items manually');
          }
        }
      }

    } catch (error) {
      console.error('PDF Extraction Error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Error: ${error.message}\n\n**Troubleshooting:**\n• Make sure the PDF is text-based (not scanned image)\n• Try re-uploading\n• Use "Add Row" to enter manually`,
        timestamp: new Date().toISOString()
      }]);
      // Visible alert so users see the issue even before an estimate exists
      alert(`Failed to analyze document: ${error.message}`);
    }

    setIsProcessing(false);
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Validate file types (case-insensitive)
    const supportedTypes = ['pdf', 'png', 'jpg', 'jpeg'];
    const unsupportedFiles = files.filter(file => {
      const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
      return !supportedTypes.includes(fileExtension);
    });

    if (unsupportedFiles.length > 0) {
      const fileNames = unsupportedFiles.map(f => f.name).join(', ');
      alert(`❌ Unsupported file type(s): ${fileNames}\n\n✅ Supported formats:\n• PDF documents\n• Images (PNG, JPG, JPEG)\n\n💡 Tip: Convert DOCX files to PDF before uploading.`);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
      return;
    }

    setMessages(prev => [...prev, {
      role: 'user',
      content: `📎 Uploaded: ${files.map(f => f.name).join(', ')}`,
      timestamp: new Date().toISOString()
    }]);

    try {
      const uploadedUrls = [];
      for (const file of files) {
        // Normalize file extension to lowercase to prevent issues with integrations
        const originalName = file.name;
        const nameParts = originalName.split('.');
        const extension = nameParts.pop();
        const baseName = nameParts.join('.');
        const normalizedName = `${baseName}.${extension.toLowerCase()}`;
        
        // Create a new File object with normalized name
        const normalizedFile = new File([file], normalizedName, { type: file.type });
        
        const { file_url } = await base44.integrations.Core.UploadFile({ file: normalizedFile });
        uploadedUrls.push({ name: normalizedName, url: file_url });
      }

      setUploadedFiles(uploadedUrls);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Files uploaded! Click "Analyze" to process.`,
        timestamp: new Date().toISOString()
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Upload failed: ${error.message}`,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!userInput.trim() && uploadedFiles.length === 0 && !currentEstimate) { // Added !currentEstimate to handle initial non-file messages
      // If there's no estimate and no file, and no message, do nothing
      if (!userInput.trim()) return;
    }

    const message = userInput.trim();

    setMessages(prev => [...prev, {
      role: 'user',
      content: message || (uploadedFiles.length > 0 ? "Analyzing files..." : "No message provided."),
      timestamp: new Date().toISOString()
    }]);

    setUserInput("");

    if (selectedMode === "document" && uploadedFiles.length > 0) {
      const urls = uploadedFiles.map(f => f.url);
      await _processEstimateRequest(urls, message, uploadedFiles[0].name);
      setUploadedFiles([]);
    } else {
      await processWithAI(message);
    }
  };

  const handleSelectContact = (contactId) => {
    setSelectedContactId(contactId);
    const contact = allContacts.find(c => c.id === contactId);
    if (contact) {
      setCustomerInfo(prev => ({
        ...prev,
        customer_name: contact.displayName,
        customer_email: contact.email || '',
        customer_phone: contact.phone || '',
        property_address: contact.address || ''
      }));

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Selected: ${contact.displayName}`,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const handleExportToXactimate = async () => {
    if (!currentEstimate || lineItems.length === 0) {
      alert('No estimate to export');
      return;
    }

    setIsExporting(true);

    try {
      const response = await base44.functions.invoke('exportToXactimate', {
        estimate: {
          ...currentEstimate,
          line_items: lineItems,
          customer_info: customerInfo
        }
      });

      const blob = new Blob([response.data.xml_content], { type: 'text/xml' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${customerInfo.customer_name || 'estimate'}_xactimate.xml`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Exported to Xactimate`,
        timestamp: new Date().toISOString()
      }]);
    } catch (error) {
      alert('Export failed: ' + error.message);
    }

    setIsExporting(false);
  };

  // Helper to generate the next estimate number with (AI) suffix
  const generateNextEstimateNumber = async () => {
    const existingEstimates = estimates;
    if (existingEstimates.length === 0) {
      return "EST-1 (AI)";
    }
    
    const numbers = existingEstimates
      .map(est => est.estimate_number)
      .filter(num => num && num.startsWith('EST-'))
      .map(num => parseInt(num.replace(/EST-|[^\d]/g, '')))
      .filter(num => !isNaN(num));
    
    if (numbers.length === 0) {
      return "EST-1 (AI)";
    }
    
    const maxNumber = Math.max(...numbers);
    const nextNumber = maxNumber + 1;
    return `EST-${nextNumber} (AI)`;
  };


  const completeSaveEstimate = async (customerId, saveData) => {
    try {
      const { companyId } = saveData;

      // Use current lineItems state directly
      const items = lineItems;

      if (!items || items.length === 0) {
        alert('No line items to save');
        return;
      }

      const totalRcv = Math.round(items.reduce((acc, item) => {
        return acc + (Number(item.rcv) || 0);
      }, 0) * 100) / 100;

      const totalAcv = Math.round(items.reduce((acc, item) => {
        return acc + (Number(item.acv) || 0);
      }, 0) * 100) / 100;

      // Warn if all items have zero monetary values — this means items were saved without pricing.
      // The convert-to-invoice flow has a safety net for this, but we log here for diagnosis.
      const allZero = items.every(i => Number(i.rcv || i.amount || 0) === 0);
      if (allZero && items.length > 0) {
        console.warn('⚠️ [AIEstimator] Saving estimate with', items.length, 'items that all have $0 amounts. totalRcv =', totalRcv, '. Items may not have been priced before saving.');
      }

      const newEstimateNumber = await generateNextEstimateNumber();

      // Collect street view photos that were loaded during analysis
      const availableStreetViews = elevationImages
        .filter(img => img.available && img.imageUrl)
        .map(img => ({ direction: img.direction, url: img.imageUrl }));

      const estimateData = {
        customer_id: customerId,
        estimate_number: newEstimateNumber,
        estimate_title: currentEstimate.title || `Estimate - ${customerInfo.customer_name}`,
        customer_name: customerInfo.customer_name,
        customer_email: customerInfo.customer_email || '',
        customer_phone: customerInfo.customer_phone || '',
        amount: totalRcv,
        total_amount: totalRcv,
        property_address: customerInfo.property_address,
        items: items,
        total_rcv: totalRcv,
        total_acv: totalAcv,
        status: 'draft',
        pricing_source: pricingSource,
        claim_number: customerInfo.claim_number,
        insurance_company: customerInfo.insurance_company,
        adjuster_name: customerInfo.adjuster_name || '',
        adjuster_phone: customerInfo.adjuster_phone || '',
        notes: customerInfo.notes || '',
        format_id: selectedFormatId,
        company_id: companyId,
        created_by: user?.email || null,
        related_inspection_job_id: inspectionJobIdFromUrl || null,
        lead_id: leadIdFromUrl || null,
        satellite_image_url: satelliteAnalysis?.satellite_image_url || analyzedStructures[0]?.analysis?.satellite_image_url || null,
        property_latitude: satelliteAddress?.coordinates?.lat || null,
        property_longitude: satelliteAddress?.coordinates?.lng || null,
        street_view_images: availableStreetViews.length > 0 ? availableStreetViews : null,
        roof_measurements: satelliteAnalysis ? {
          roof_area_sq: satelliteAnalysis.roof_area_sq,
          roof_area_sqft: satelliteAnalysis.roof_area_sqft,
          final_order_quantity_sq: satelliteAnalysis.final_order_quantity_sq,
          waste_percentage: satelliteAnalysis.waste_percentage,
          waste_reason: satelliteAnalysis.waste_reason,
          ridge_lf: satelliteAnalysis.ridge_lf,
          hip_lf: satelliteAnalysis.hip_lf,
          valley_lf: satelliteAnalysis.valley_lf,
          rake_lf: satelliteAnalysis.rake_lf,
          eave_lf: satelliteAnalysis.eave_lf,
          step_flashing_lf: satelliteAnalysis.step_flashing_lf,
          apron_flashing_lf: satelliteAnalysis.apron_flashing_lf,
          pitch: satelliteAnalysis.pitch,
          roof_type: satelliteAnalysis.roof_type,
          overall_confidence: satelliteAnalysis.overall_confidence,
          ridge_confidence: satelliteAnalysis.ridge_confidence,
          hip_confidence: satelliteAnalysis.hip_confidence,
          valley_confidence: satelliteAnalysis.valley_confidence,
          rake_confidence: satelliteAnalysis.rake_confidence,
          eave_confidence: satelliteAnalysis.eave_confidence,
          step_flashing_confidence: satelliteAnalysis.step_flashing_confidence,
          analysis_notes: satelliteAnalysis.analysis_notes,
        } : null,
        siding_measurements: sidingMeasurements ? {
          wall_area_sq: sidingMeasurements.wall_area_sq,
          wall_area_sqft: sidingMeasurements.wall_area_sqft,
          gross_wall_area_sqft: sidingMeasurements.gross_wall_area_sqft,
          perimeter_ft: sidingMeasurements.perimeter_ft,
          building_length_ft: sidingMeasurements.building_length_ft,
          building_width_ft: sidingMeasurements.building_width_ft,
          story_count: sidingMeasurements.story_count,
          story_height_ft: sidingMeasurements.story_height_ft,
          outside_corners_count: sidingMeasurements.outside_corners_count,
          outside_corners_lf: sidingMeasurements.outside_corners_lf,
          inside_corners_count: sidingMeasurements.inside_corners_count,
          inside_corners_lf: sidingMeasurements.inside_corners_lf,
          gable_area_sqft: sidingMeasurements.gable_area_sqft,
          wall_top_lf: sidingMeasurements.wall_top_lf,
          wall_bottom_lf: sidingMeasurements.wall_bottom_lf,
          opening_deduction_pct: sidingMeasurements.opening_deduction_pct,
          windows_count: sidingMeasurements.windows_count,
          doors_count: sidingMeasurements.doors_count,
          garage_door_count: sidingMeasurements.garage_door_count,
          siding_material: sidingMeasurements.siding_material,
          siding_condition: sidingMeasurements.siding_condition,
          is_garage_job: sidingMeasurements.is_garage_job,
          roof_type: sidingMeasurements.roof_type,
          overall_confidence: sidingMeasurements.overall_confidence,
          confidence_grade: sidingMeasurements.confidence_grade,
          tolerance_pct: sidingMeasurements.tolerance_pct,
          recommended_waste_pct: sidingMeasurements.recommended_waste_pct,
          waste_reason: sidingMeasurements.waste_reason,
          analysis_notes: sidingMeasurements.analysis_notes,
          osm_perimeter_used: sidingMeasurements.osm_perimeter_used,
          osm_perimeter_ft: sidingMeasurements.osm_perimeter_ft,
          solar_perimeter_ft: sidingMeasurements.solar_perimeter_ft,
        } : null,
      };

      console.log('💾 Saving estimate with', items.length, 'items, total:', totalRcv);
      console.log('📎 Linking to customer ID:', customerId);

      const savedEstimate = await base44.entities.Estimate.create(estimateData);
      
      console.log('✅ Estimate created:', savedEstimate.id);
      console.log('🔗 Customer ID in estimate:', savedEstimate.customer_id);
      
      if (inspectionJobIdFromUrl) {
        await base44.entities.InspectionJob.update(inspectionJobIdFromUrl, {
          related_estimate_id: savedEstimate.id
        });
      }

      // 🎯 Auto-link/create a Lead for this estimate
      if (customerInfo.customer_name && companyId) {
        try {
          const leadUpdatePayload = {
            value: totalRcv,
            related_estimate_id: savedEstimate.id,
            email: customerInfo.customer_email || undefined,
            phone: customerInfo.customer_phone || undefined,
          };

          // If user came from a lead profile, update that specific lead
          if (leadIdFromUrl) {
            await base44.entities.Lead.update(leadIdFromUrl, leadUpdatePayload);
            console.log('✅ Updated lead from URL:', leadIdFromUrl, 'value:', totalRcv);
          } else {
            // Otherwise find or create a lead by customer name
            const existingLeads = customerInfo.customer_name ? await base44.entities.Lead.filter({
              company_id: companyId,
              name: { $contains: customerInfo.customer_name }
            }) : [];
            const openLead = existingLeads.find(l => !['won', 'lost', 'closed'].includes(l.status) && l.name?.toLowerCase() === customerInfo.customer_name?.toLowerCase());
            if (openLead) {
              await base44.entities.Lead.update(openLead.id, leadUpdatePayload);
              console.log('✅ Updated existing open lead:', openLead.id, 'value:', totalRcv);
            } else {
              const newLead = await base44.entities.Lead.create({
                company_id: companyId,
                name: customerInfo.customer_name,
                email: customerInfo.customer_email || '',
                phone: customerInfo.customer_phone || '',
                address: customerInfo.property_address || '',
                source: 'AI Estimator',
                status: 'new',
                value: totalRcv,
                customer_id: customerId || undefined,
                related_estimate_id: savedEstimate.id,
                insurance_company: customerInfo.insurance_company || '',
                claim_number: customerInfo.claim_number || '',
              });
              console.log('✅ Lead created:', newLead.id, newLead.name, 'value:', totalRcv);
            }
          }
        } catch (leadErr) {
          console.warn('⚠️ Lead create/update failed (non-critical):', leadErr);
        }
      }

      // 🔔 Create notifications and trigger workflows
      try {
        await base44.functions.invoke('universalNotificationDispatcher', {
          action: 'create',
          entityType: 'Estimate',
          entityId: savedEstimate.id,
          entityData: savedEstimate,
          companyId
        });
        console.log('✅ Notifications sent for new estimate');
      } catch (notifError) {
        console.warn('⚠️ Notifications failed (non-critical):', notifError);
      }

      try {
        await base44.functions.invoke('triggerWorkflow', {
          triggerType: 'estimate_created',
          companyId: companyId,
          entityType: 'estimate',
          entityId: savedEstimate.id,
          entityData: {
            ...savedEstimate,
            customer_name: customerInfo.customer_name,
            customer_email: customerInfo.customer_email,
            customer_phone: customerInfo.customer_phone,
            estimate_number: newEstimateNumber,
            amount: totalRcv
          }
        });
        console.log('✅ Workflow triggered for new estimate');
      } catch (workflowError) {
        console.warn('⚠️ Workflow trigger failed (non-critical):', workflowError);
      }

      queryClient.invalidateQueries(['estimates']);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Estimate ${newEstimateNumber} saved to CRM!${inspectionJobIdFromUrl ? '\n🔗 Linked to inspection job.' : ''}`,
        timestamp: new Date().toISOString()
      }]);

      setTimeout(() => navigate(createPageUrl('EstimateEditor') + `?estimate_id=${savedEstimate.id}`), 2000);
    } catch (error) {
      console.error('Error saving estimate:', error);
      alert('Error saving: ' + error.message);
    }
  };

  const handleSaveEstimate = async () => {
    if (!currentEstimate || lineItems.length === 0) {
      alert('No estimate to save');
      return;
    }

    try {
      const currentUser = user;
      if (!currentUser) {
        alert('❌ User not logged in. Cannot save estimate.');
        return;
      }

      let companyId = myCompany?.id;

      if (!companyId) {
        const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: currentUser.email });
        if (staffProfiles && staffProfiles.length > 0) {
          companyId = staffProfiles[0].company_id;
        } else {
          const fetchedCompanies = await base44.entities.Company.filter({ created_by: currentUser.email });
          if (fetchedCompanies && fetchedCompanies.length > 0) {
            companyId = fetchedCompanies[0].id;
          }
        }
      }

      if (!companyId) {
        alert('❌ No company found. Please complete company setup first.');
        return;
      }

      let customerId = selectedContactId;
      
      if (!customerId && customerInfo.customer_name) {
        console.log("🔍 No contact selected, checking for existing customer...");
        console.log("📋 Customer info to match:", JSON.stringify({
          name: customerInfo.customer_name,
          email: customerInfo.customer_email,
          phone: customerInfo.customer_phone,
          address: customerInfo.property_address
        }, null, 2));
        
        // CRITICAL: Refetch customers to ensure we have the latest data
        console.log("♻️ Refetching customers to prevent duplicates...");
        let allCustomers = await base44.entities.Customer.filter({ company_id: companyId });
        console.log(`📊 Found ${allCustomers.length} existing customers in CRM for company ${companyId}`);
        
        // If no customers in current company, search ALL customers (cross-company fallback)
        if (allCustomers.length === 0) {
          console.log("⚠️ No customers in current company, searching ALL customers for this company...");
          allCustomers = await base44.entities.Customer.filter({ company_id: companyId }, '-created_date', 10000);
          console.log(`📊 Found ${allCustomers.length} total customers for company ${companyId}`);
        }
        
        // Log customers with emails to see what we're comparing against
        const customersWithEmail = allCustomers.filter(c => c.email);
        console.log(`📋 ${customersWithEmail.length} customers have emails`);
        
        let existingCustomer = null;
        let matchType = null;
        
        // Normalize name by removing parenthetical suffixes like "(Scott Bickel)"
        const normalizeName = (name) => {
          if (!name) return '';
          return name
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s]/g, '')
            .replace(/\s*\([^)]*\)/g, '')
            .trim();
        };
        
        // Check by email FIRST (most reliable)
        if (customerInfo.customer_email) {
          const emailLower = String(customerInfo.customer_email || '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '')
            .replace(/[^\x00-\x7F]/g, '');
          
          console.log(`🔍 Searching for email: "${emailLower}"`);
          
          existingCustomer = allCustomers.find(c => {
            if (!c.email) {
              return false;
            }
            
            const customerEmail = String(c.email || '')
              .toLowerCase()
              .trim()
              .replace(/\s+/g, '')
              .replace(/[^\x00-\x7F]/g, '');
            
            const isMatch = customerEmail === emailLower;
            
            if (isMatch) {
              console.log(`✅ EMAIL MATCH FOUND: ${c.name} (ID: ${c.id})`);
              console.log(`   Matched email: "${customerEmail}" === "${emailLower}"`);
            }
            
            return isMatch;
          });
          
          if (!existingCustomer) {
            console.log(`❌ No email match found for: "${emailLower}"`);
            console.log(`   Checked ${allCustomers.length} customers`);
          }
        }
        
        // Check by phone if no email match
        if (!existingCustomer && customerInfo.customer_phone) {
          const cleanPhone = customerInfo.customer_phone.replace(/\D/g, '');
          console.log(`🔍 Searching for phone: "${cleanPhone}"`);
          
          if (cleanPhone.length >= 10) {
            const last10Digits = cleanPhone.slice(-10);
            console.log(`   Using last 10 digits: ${last10Digits}`);
            
            existingCustomer = allCustomers.find(c => {
              if (!c.phone) {
                return false;
              }
              
              const customerPhoneStr = String(c.phone || '');
              const customerCleanPhone = customerPhoneStr.replace(/\D/g, '');
              
              if (!customerCleanPhone || customerCleanPhone.length < 10) {
                return false;
              }
              
              const customerLast10 = customerCleanPhone.slice(-10);
              const isMatch = customerLast10 === last10Digits;
              
              if (isMatch) {
                console.log(`✅ PHONE MATCH FOUND: ${c.name} (ID: ${c.id})`);
                console.log(`   Matched phone: ${customerLast10} === ${last10Digits}`);
              }
              
              return isMatch;
            });
            
            if (!existingCustomer) {
              console.log(`❌ No phone match found for: "${last10Digits}"`);
            }
          }
        }
        
        // Name normalization fallback
        if (!existingCustomer && customerInfo.customer_name) {
          const inputNameNormalized = normalizeName(customerInfo.customer_name);
          console.log(`🔍 Searching by normalized name: "${inputNameNormalized}"`);
          
          existingCustomer = allCustomers.find(c => {
            if (!c.name) return false;
            const customerNameNormalized = normalizeName(c.name);
            const isMatch = customerNameNormalized === inputNameNormalized;
            if (isMatch) {
              console.log(`✅ NAME MATCH FOUND: ${c.name} -> ${customerNameNormalized} (ID: ${c.id})`);
            }
            return isMatch;
          });
        }
        
        // FINAL FALLBACK: Search customers with broader filter if still no match
        if (!existingCustomer && allCustomers.length < 100) {
          console.log("🌍 No match in company customers, re-searching with broader filter...");
          const globalCustomers = await base44.entities.Customer.filter({ company_id: companyId }, '-created_date', 10000);
          console.log(`📊 Searching ${globalCustomers.length} customers for company ${companyId}`);
          
          // Try email match globally
          if (customerInfo.customer_email) {
            const emailLower = String(customerInfo.customer_email || '')
              .toLowerCase()
              .trim()
              .replace(/\s+/g, '')
              .replace(/[^\x00-\x7F]/g, '');
            
            existingCustomer = globalCustomers.find(c => {
              if (!c.email) return false;
              const customerEmail = String(c.email || '')
                .toLowerCase()
                .trim()
                .replace(/\s+/g, '')
                .replace(/[^\x00-\x7F]/g, '');
              return customerEmail === emailLower;
            });
            
            if (existingCustomer) {
              console.log(`🌍 GLOBAL EMAIL MATCH FOUND: ${existingCustomer.name} (ID: ${existingCustomer.id}, Company: ${existingCustomer.company_id})`);
              if (existingCustomer.company_id !== companyId) {
                console.warn(`⚠️ Customer belongs to different company! Expected: ${companyId}, Found: ${existingCustomer.company_id}`);
              }
            }
          }
          
          // Try phone match globally if still no match
          if (!existingCustomer && customerInfo.customer_phone) {
            const cleanPhone = customerInfo.customer_phone.replace(/\D/g, '');
            if (cleanPhone.length >= 10) {
              const last10Digits = cleanPhone.slice(-10);
              
              existingCustomer = globalCustomers.find(c => {
                if (!c.phone) return false;
                const customerPhoneStr = String(c.phone || '');
                const customerCleanPhone = customerPhoneStr.replace(/\D/g, '');
                if (!customerCleanPhone || customerCleanPhone.length < 10) return false;
                const customerLast10 = customerCleanPhone.slice(-10);
                return customerLast10 === last10Digits;
              });
              
              if (existingCustomer) {
                console.log(`🌍 GLOBAL PHONE MATCH FOUND: ${existingCustomer.name} (ID: ${existingCustomer.id}, Company: ${existingCustomer.company_id})`);
                if (existingCustomer.company_id !== companyId) {
                  console.warn(`⚠️ Customer belongs to different company! Expected: ${companyId}, Found: ${existingCustomer.company_id}`);
                }
              }
            }
          }
        }
        
        // DEBUG: Check for known duplicate customer #741
        const knownDuplicate = allCustomers.find(c => c.customer_number === 741 || c.id === '69106adc6acb59d7adbe2487');
        if (knownDuplicate && customerInfo.customer_email) {
          console.log("🎯 FOUND CUSTOMER #741 IN FETCHED DATA:");
          console.log("   ID:", knownDuplicate.id);
          console.log("   Name:", JSON.stringify(knownDuplicate.name));
          console.log("   Email:", JSON.stringify(knownDuplicate.email));
          console.log("   Phone:", JSON.stringify(knownDuplicate.phone));
          
          const testEmail = String(customerInfo.customer_email || '').toLowerCase().trim().replace(/\s+/g, '').replace(/[^\x00-\x7F]/g, '');
          const customerEmail = String(knownDuplicate.email || '').toLowerCase().trim().replace(/\s+/g, '').replace(/[^\x00-\x7F]/g, '');
          console.log("   Email comparison:", `"${testEmail}" === "${customerEmail}"`, testEmail === customerEmail);
          
          if (customerInfo.customer_phone) {
            const testPhone = customerInfo.customer_phone.replace(/\D/g, '').slice(-10);
            const customerPhone = (knownDuplicate.phone || '').replace(/\D/g, '').slice(-10);
            console.log("   Phone comparison:", `"${testPhone}" === "${customerPhone}"`, testPhone === customerPhone);
          }
        }
        
        // Check by name (normalized to handle variations)
        if (!existingCustomer && customerInfo.customer_name) {
          const normalizedInputName = normalizeName(customerInfo.customer_name);
          existingCustomer = allCustomers.find(c => {
            const normalizedCustomerName = normalizeName(c.name);
            return normalizedCustomerName === normalizedInputName;
          });
          if (existingCustomer) {
            matchType = 'name';
            console.log(`✅ Found match by NAME: ${existingCustomer.name}`);
          }
        }
        
        // Check by address as final fallback
        if (!existingCustomer && customerInfo.property_address) {
          const extractZipCode = (addressStr) => {
            const zipMatch = addressStr.match(/\b(\d{5})(?:-\d{4})?\b/);
            return zipMatch ? zipMatch[1] : null;
          };
          
          const extractStreetNumber = (addressStr) => {
            const match = addressStr.match(/^\s*(\d+)\s+/);
            return match ? match[1] : null;
          };
          
          const inputZip = extractZipCode(customerInfo.property_address);
          const inputStreetNum = extractStreetNumber(customerInfo.property_address);
          const inputStreet = customerInfo.property_address.toLowerCase().split(',')[0]?.trim() || '';
          
          if (inputZip && inputStreetNum) {
            existingCustomer = allCustomers.find(c => {
              const customerFullAddr = [c.street, c.city, c.state, c.zip].filter(Boolean).join(', ');
              const customerZip = extractZipCode(c.zip || customerFullAddr || c.address || '');
              const customerStreetNum = extractStreetNumber(c.street || c.address || '');
              const customerStreet = (c.street || c.address || '').toLowerCase().trim();
              
              // Match if ZIP matches AND street number matches
              return customerZip === inputZip && 
                     customerStreetNum === inputStreetNum &&
                     (customerStreet.includes(inputStreet) || inputStreet.includes(customerStreet));
            });
            if (existingCustomer) {
              matchType = 'address';
              console.log(`✅ Found match by ADDRESS: ${existingCustomer.name}`);
            }
          }
        }

        if (existingCustomer) {
          // ALWAYS auto-use existing customer and update with new info
          customerId = existingCustomer.id;
          console.log(`✅ Auto-linked to existing customer (${matchType} match):`, existingCustomer.name);
          
          // Update customer with any new info from estimate
          await base44.entities.Customer.update(existingCustomer.id, {
            email: customerInfo.customer_email || existingCustomer.email,
            phone: customerInfo.customer_phone || existingCustomer.phone,
            claim_number: customerInfo.claim_number || existingCustomer.claim_number,
            insurance_company: customerInfo.insurance_company || existingCustomer.insurance_company,
            adjuster_name: customerInfo.adjuster_name || existingCustomer.adjuster_name,
            adjuster_phone: customerInfo.adjuster_phone || existingCustomer.adjuster_phone,
          });
          
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `✅ Linked to existing customer: ${existingCustomer.name} (#${existingCustomer.customer_number})`,
            timestamp: new Date().toISOString()
          }]);
        } else {
          console.log('❌ No existing customer found, creating new one...');
          const newCustomer = await base44.entities.Customer.create({
            company_id: companyId,
            name: customerInfo.customer_name,
            email: customerInfo.customer_email || '',
            phone: customerInfo.customer_phone || '',
            street: customerInfo.property_address || '',
            insurance_company: customerInfo.insurance_company || '',
            claim_number: customerInfo.claim_number || '',
            adjuster_name: customerInfo.adjuster_name || '',
            adjuster_phone: customerInfo.adjuster_phone || '',
          });
          customerId = newCustomer.id;
          
          console.log('✅ Created new customer:', newCustomer.name, newCustomer.id);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `✅ Created new customer: ${newCustomer.name} (#${newCustomer.customer_number})`,
            timestamp: new Date().toISOString()
          }]);
        }
      }

      await completeSaveEstimate(customerId, { companyId, currentUser, lineItems });
    } catch (error) {
      console.error('Error saving estimate:', error);
      alert('Error saving: ' + error.message);
    }
  };

  const handleMergeWithExistingEstimate = async (targetEstimate) => {
    if (!lineItems || lineItems.length === 0) {
      alert('No line items to merge.');
      return;
    }
    setIsMergingWithExisting(true);
    try {
      const existingItems = Array.isArray(targetEstimate.items) ? targetEstimate.items : [];
      const newItems = lineItems.map((item, idx) => ({
        ...item,
        line: existingItems.length + idx + 1,
      }));
      const mergedItems = [...existingItems, ...newItems];
      const newTotal = mergedItems.reduce((sum, i) => sum + (Number(i.rcv || i.amount || 0)), 0);
      const newTotalAcv = mergedItems.reduce((sum, i) => sum + (Number(i.acv || 0)), 0);

      await base44.entities.Estimate.update(targetEstimate.id, {
        items: mergedItems,
        total_rcv: newTotal,
        total_acv: newTotalAcv,
        total_amount: newTotal,
        amount: newTotal,
      });

      setShowMergeWithExistingDialog(false);
      setMergeWithExistingSearch('');
      alert(`✅ Merged ${lineItems.length} item(s) into estimate #${targetEstimate.estimate_number || targetEstimate.estimate_title}!`);
      navigate(createPageUrl('EstimateEditor') + `?estimate_id=${targetEstimate.id}`);
    } catch (error) {
      console.error('Merge error:', error);
      alert('❌ Merge failed: ' + error.message);
    } finally {
      setIsMergingWithExisting(false);
    }
  };

  const handleGenerateMaterialList = async () => {
    if (!currentEstimate || lineItems.length === 0) {
      alert('No estimate to generate materials from');
      return;
    }

    setIsGeneratingMaterials(true);

    try {
      console.log('📋 Generating material list with', lineItems.length, 'items');
      
      const tempEstimate = {
        items: lineItems,
        estimate_number: 'DRAFT',
        customer_name: customerInfo.customer_name,
        property_address: customerInfo.property_address
      };

      console.log('📤 Calling generateMaterialList function...');
      
      const response = await generateMaterialList({
        estimateId: null,
        estimate: tempEstimate
      });

      console.log('✅ Response received:', response);

      if (!response || !response.success) {
        throw new Error(response?.error || 'Material list generation failed');
      }

      setMaterialListData(response);
      setShowMaterialList(true);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Material list generated! ${response.materials?.length || 0} materials, ${response.labor?.length || 0} labor items.`,
        timestamp: new Date().toISOString()
      }]);
    } catch (error) {
        console.error('❌ Material list error:', error);
        const serverErr = error?.response?.data?.error || error.message || 'Unknown error';
        const serverDetails = error?.response?.data?.details ? `\nDetails: ${error.response.data.details}` : '';
        alert(`Failed to generate material list: ${serverErr}${serverDetails}`);
      }

    setIsGeneratingMaterials(false);
  };

  const downloadMaterialList = () => {
    downloadMaterialListCSV(materialListData, customerInfo.customer_name);
  };

  // NEW: Auto-calculate AI gutters when checkbox is toggled
  useEffect(() => {
    if (includeGuttersAI && analyzedStructures.length > 0) {
      const totalEaves = analyzedStructures.reduce((sum, s) => sum + (s.analysis.eave_lf || 0), 0);
      setAiGutterLF(totalEaves);
      setAiDownspoutCount(Math.ceil(totalEaves / 35));
    } else if (!includeGuttersAI) {
      setAiGutterLF(0);
      setAiDownspoutCount(0);
    }
  }, [includeGuttersAI, analyzedStructures]);


  const ctx = {
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
    customerInfo, setCustomerInfo,
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
    showConfig, setShowConfig,
    isInsuranceJob, setIsInsuranceJob,
    setPricingSource,
    formats,
    showVentilationCalc, setShowVentilationCalc,
    handleAddVentilationItems,
    showMemoryDialog, setShowMemoryDialog,
    savedMissedItems, deleteMissedItemFromMemory,
    newMemoryItem, setNewMemoryItem, saveMissedItemToMemory,
    showSuggestions, setShowSuggestions,
    suggestions, handleAddSuggestedItem,
    showMergeDialog, setShowMergeDialog,
    mergeFiles, setMergeFiles,
    isMerging, setIsMerging,
    saveToHistory,
    convertMeasurementsToLineItemsArray,
    convertSidingMeasurementsToLineItemsArray,
    showMaterialList, setShowMaterialList,
    materialListData, downloadMaterialList,
    showDuplicateDialog, setShowDuplicateDialog,
    duplicateCustomer, setDuplicateCustomer,
    pendingSaveData, setPendingSaveData,
    completeSaveEstimate,
    showProductionDialog, setShowProductionDialog,
    productionEmail, setProductionEmail,
    productionNote, setProductionNote,
    isSendingProduction, setIsSendingProduction,
    showAdjusterDialog, setShowAdjusterDialog,
    adjusterName, setAdjusterName,
    adjusterEmail, setAdjusterEmail,
    adjusterClaimNumber, setAdjusterClaimNumber,
    adjusterNote, setAdjusterNote,
    isSendingAdjuster, setIsSendingAdjuster,
    isProcessing, isAnalyzing,
    userInput, setUserInput,
    selectedMode,
    fileInputRef, messagesEndRef,
    handleSendMessage,
    processWithAI,
    checkMissingItems,
    missingSuggestions, setMissingSuggestions,
    handleFileSelect,
    competitorEstimates,
    trainingDocuments, trainingFileInputRef, isUploadingTraining,
    handleUploadTrainingFile, deleteTrainingDocument,
    showTrainingLibrary, setShowTrainingLibrary,
    selectedFormatId, handleFormatChange,
    pricingSource, handlePricingSourceChange,
    currentFormat,
    getHeaderColorClass,
    selectedContactId, handleSelectContact,
    allContacts, allInspectionJobs,
    linkedInspectionJobId, setLinkedInspectionJobId,
    handleReviewEstimate,
    handleGenerateMaterialList, isGeneratingMaterials,
    handleExportToXactimate, isExporting,
    handleSaveEstimate,
    showMergeWithExistingDialog, setShowMergeWithExistingDialog,
    mergeWithExistingSearch, setMergeWithExistingSearch,
    isMergingWithExisting,
    handleMergeWithExistingEstimate,
    estimates,
    estimateOutputLanguage, setEstimateOutputLanguage,
    generateEstimateHTML,
    navigate, createPageUrl,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-6 pb-24 md:pb-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <Sparkles className="w-8 h-8 text-purple-600" />
                {t.sidebar.aiEstimator}
              </h1>
              <p className="text-gray-500 mt-1">Upload any report or use satellite measurements to generate estimates</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {estimateHistory.length > 0 && (
                <Button 
                  variant="outline" 
                  onClick={handleUndo}
                  className="border-orange-500 text-orange-700 hover:bg-orange-50"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Undo ({estimateHistory.length})
                </Button>
              )}
              <Button variant="outline" onClick={() => setShowTrainingLibrary(true)} data-testid="button-training-library">
                <Brain className="w-4 h-4 mr-2" />
                Training Library
                {trainingDocuments.length > 0 && (
                  <span className="ml-1.5 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full px-1.5 py-0.5">{trainingDocuments.length}</span>
                )}
              </Button>
              <input
                ref={trainingFileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.PDF,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG"
                onChange={handleUploadTrainingFile}
              />
              <Button variant="outline" onClick={() => setShowMergeDialog(true)} data-testid="button-merge-docs">
                <Share2 className="w-4 h-4 mr-2" />
                Merge Docs
              </Button>
              <Button variant="outline" onClick={() => setShowConfig(true)} data-testid="button-settings">
                <Settings className="w-4 h-4 mr-2" />
                {t.sidebar.settings}
              </Button>
            </div>
          </div>

          {/* Merge target banner — shown when launched from Estimate Editor */}
          {mergeTargetEstimate && (
            <div className="mt-4 flex items-center justify-between gap-3 bg-blue-600 text-white rounded-xl px-4 py-3 shadow">
              <div className="flex items-center gap-2">
                <Share2 className="w-5 h-5 shrink-0" />
                <span className="text-sm font-semibold">
                  Merge mode — adding items to: <span className="font-bold">#{mergeTargetEstimate.estimate_number} {mergeTargetEstimate.customer_name ? `· ${mergeTargetEstimate.customer_name}` : ''}</span>
                </span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0 bg-white text-blue-700 hover:bg-blue-50"
                onClick={() => {
                  setMergeWithExistingSearch(mergeTargetEstimate.estimate_number || '');
                  setShowMergeWithExistingDialog(true);
                }}
                disabled={!currentEstimate}
              >
                {currentEstimate ? 'Merge Now →' : 'Generate estimate first'}
              </Button>
            </div>
          )}

          <Card className="mt-4 bg-gradient-to-r from-blue-50 to-purple-50">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm font-semibold text-gray-700">{t.estimates.customer}:</span>
                  <Select value={selectedFormatId || ''} onValueChange={handleFormatChange}>
                    <SelectTrigger className="w-full sm:w-64">
                      <SelectValue placeholder="Auto (based on pricing)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None (Default)</SelectItem>
                      {formats.map(format => (
                        <SelectItem key={format.id} value={format.id}>
                          {format.format_name} {format.insurance_company ? `(${format.insurance_company})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-700">{t.common.amount}:</span>
                  <Select value={pricingSource} onValueChange={handlePricingSourceChange}>
                    <SelectTrigger className="w-full sm:w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="xactimate">Xactimate (Old)</SelectItem>
                      <SelectItem value="xactimate_new">Xactimate New 🆕</SelectItem>
                      <SelectItem value="symbility">Symbility</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <Tabs value={selectedMode} onValueChange={setSelectedMode}>
              <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="document" className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    {t.common.upload}
                  </TabsTrigger>
                  <TabsTrigger value="satellite" className="flex items-center gap-2">
                    <Satellite className="w-4 h-4" />
                    {t.sidebar.stormTracking}
                  </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>

              <EstimatorDialogs ctx={ctx} />

        <div className="space-y-6">
          {selectedMode === "document" && (
            <Card className="bg-white shadow-lg">
              <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Document Upload Mode
                </CardTitle>
              </CardHeader>

              <CardContent className="p-0">
                {uploadedFiles.length > 0 && !isProcessing && (
                  <div className="p-4 border-b bg-gradient-to-r from-green-50 to-blue-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-green-600" />
                      <span className="font-medium text-gray-900">{uploadedFiles[0].name}</span>
                      {currentEstimate && (
                        <Badge className="bg-blue-100 text-blue-700 text-xs">
                          Previously analyzed
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={async () => {
                          const urls = uploadedFiles.map(f => f.url);
                          await _processEstimateRequest(urls, userInput || "re-analyze", uploadedFiles[0].name);
                      }}>
                        {currentEstimate ? 'Re-analyze' : 'Analyze'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setUploadedFiles([])}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
                
                {uploadedFiles.length > 0 && isProcessing && (
                  <div className="p-8 border-b bg-gradient-to-r from-purple-50 to-blue-50">
                    <div className="text-center">
                      <div className="relative inline-block mb-4">
                        <div className="absolute inset-0 animate-ping opacity-30">
                          <svg className="w-16 h-16 mx-auto" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10 80 L50 20 L90 80 Z" fill="currentColor" className="text-purple-600" />
                          </svg>
                        </div>
                        <svg className="w-16 h-16 mx-auto animate-spin" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10 80 L50 20 L90 80 Z" fill="currentColor" className="text-purple-600" />
                        </svg>
                      </div>
                      <p className="text-lg font-semibold text-gray-900">AI Analyzing Document...</p>
                      <p className="text-sm text-gray-600 mt-1">Reading {uploadedFiles[0].name}</p>
                      <div className="mt-4 space-y-1 text-xs text-gray-500">
                        <p>✓ Extracting measurements and line items</p>
                        <p>✓ Matching with price database</p>
                        <p>✓ Generating estimate</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Status message visible even before an estimate exists */}
                {!isProcessing && !currentEstimate && (() => {
                  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
                  return lastAssistant ? (
                    <div className="px-4 py-3 border-b bg-yellow-50 text-yellow-800">
                      <div className="text-sm font-semibold mb-1">Status</div>
                      <div className="text-sm whitespace-pre-wrap">{lastAssistant.content}</div>
                    </div>
                  ) : null;
                })()}
                
                <div className="p-4 bg-white">
                  {isInsuranceJob && (
                    <div data-testid="badge-insurance-mode" className="flex items-center gap-1.5 mb-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg w-fit">
                      <span className="text-orange-600 text-xs font-semibold">🏷️ Insurance Mode ON</span>
                      <span className="text-orange-500 text-xs">— AI will include all required insurance line items, no O&P</span>
                    </div>
                  )}
                  <form onSubmit={handleSendMessage} className="flex gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileSelect}
                      className="hidden"
                      accept=".pdf,.PDF,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG"
                      multiple
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isProcessing || uploadedFiles.length > 0}
                    >
                      <Paperclip className="w-5 h-5" />
                    </Button>
                    <Input
                      placeholder="Upload file or type message..."
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      disabled={isProcessing || uploadedFiles.length > 0}
                      className="flex-1"
                    />
                    <Button
                      type="submit"
                      disabled={isProcessing || uploadedFiles.length > 0}
                      className="bg-gradient-to-r from-blue-600 to-purple-600"
                    >
                      <Send className="w-5 h-5" />
                    </Button>
                  </form>
                  {!currentEstimate && (
                    <div className="mt-2 text-sm text-gray-500">
                      Upload a document (e.g., HOVER, Xactimate PDF) or type a message to start an estimate.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

                  {selectedMode === "satellite" && <SatelliteMeasurementPanel ctx={ctx} />}

                  {currentEstimate && <EstimatorChatPanel ctx={ctx} />}
        </div>
      </div>

      {/* Merge with Existing Estimate Dialog */}
      <Dialog open={showMergeWithExistingDialog} onOpenChange={setShowMergeWithExistingDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Merge into Existing Estimate</DialogTitle>
            <DialogDescription>
              Your AI-generated line items ({lineItems?.length || 0} items) will be appended to the end of the selected estimate.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Input
              placeholder="Search by estimate # or customer name..."
              value={mergeWithExistingSearch}
              onChange={(e) => setMergeWithExistingSearch(e.target.value)}
              data-testid="input-merge-search"
            />

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {estimates
                .filter(est => {
                  if (!mergeWithExistingSearch.trim()) return true;
                  const q = mergeWithExistingSearch.toLowerCase();
                  return (
                    (est.estimate_number || '').toLowerCase().includes(q) ||
                    (est.customer_name || '').toLowerCase().includes(q) ||
                    (est.estimate_title || '').toLowerCase().includes(q) ||
                    (est.property_address || '').toLowerCase().includes(q)
                  );
                })
                .slice(0, 30)
                .map(est => (
                  <div
                    key={est.id}
                    className="flex justify-between items-center p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => handleMergeWithExistingEstimate(est)}
                    data-testid={`merge-target-${est.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        #{est.estimate_number || 'N/A'} — {est.customer_name || 'Unknown customer'}
                      </p>
                      {est.property_address && (
                        <p className="text-xs text-gray-500 truncate">{est.property_address}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        {(est.items || []).length} items · ${Number(est.total_amount || est.amount || 0).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="ml-3 bg-blue-600 hover:bg-blue-700 shrink-0"
                      disabled={isMergingWithExisting}
                      onClick={(e) => { e.stopPropagation(); handleMergeWithExistingEstimate(est); }}
                    >
                      {isMergingWithExisting ? 'Merging...' : 'Merge'}
                    </Button>
                  </div>
                ))
              }
              {estimates.length === 0 && (
                <p className="text-center text-gray-500 py-6 text-sm">No saved estimates found.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}