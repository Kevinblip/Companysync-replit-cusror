import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  FileText,
  Upload,
  Satellite,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { findOpenEstimatesForCustomer } from "@/utils/duplicateCheck";

export default function CreateEstimate() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(location.search);
  const leadId = urlParams.get('lead_id');
  const urlCustomerName = urlParams.get('customer_name') || '';
  const urlCustomerEmail = urlParams.get('customer_email') || '';
  const urlCustomerPhone = urlParams.get('customer_phone') || '';
  const urlCustomerId = urlParams.get('customer_id') || null;

  const [user, setUser] = useState(null);
  const [selectedMode, setSelectedMode] = useState('manual'); // 'manual', 'document', 'satellite'
  
  // Document upload states
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFileUrl, setUploadedFileUrl] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState(null);
  const [extractionError, setExtractionError] = useState(null);
  
  // Satellite states — pre-fill from URL param if navigating from customer/lead profile
  const [propertyAddress, setPropertyAddress] = useState(urlParams.get('property_address') || "");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [roofAnalysis, setRoofAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);

  // AI Estimator config
  const [pricingSource, setPricingSource] = useState("xactimate_new");
  const [jobType, setJobType] = useState("roofing");
  const [gutterLF, setGutterLF] = useState("");
  const [dismissDuplicateWarning, setDismissDuplicateWarning] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  const { data: estimates = [] } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 100) : [],
    enabled: !!myCompany,
  });

  // Helper to generate the next estimate number with (AI) suffix
  const generateNextEstimateNumber = () => {
    if (estimates.length === 0) {
      return "EST-0001 (AI)";
    }
    
    const numbers = estimates
      .map(est => est.estimate_number)
      .filter(num => num && num.startsWith('EST-'))
      .map(num => parseInt(num.replace(/EST-|[^0-9]/g, ''))) // Remove ' (AI)' or other non-digit chars after EST-
      .filter(num => !isNaN(num));
    
    if (numbers.length === 0) {
      return "EST-0001 (AI)";
    }
    
    const maxNumber = Math.max(...numbers);
    const nextNumber = maxNumber + 1;
    return `EST-${nextNumber.toString().padStart(4, '0')} (AI)`;
  };

  const { data: lead, isLoading: loadingLead } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const leads = await base44.entities.Lead.filter({ id: leadId });
      return leads[0];
    },
    enabled: !!leadId,
  });

  useEffect(() => {
    if (lead) {
      const fullAddress = [lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
      setPropertyAddress(fullAddress);
    }
  }, [lead]);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const createEstimateMutation = useMutation({
    mutationFn: async (estimateData) => {
      let customerId = estimateData.customer_id || null;
      
      if (!customerId && (estimateData.customer_name || estimateData.customer_email)) {
        const matchingCustomer = customers.find(c => {
          const nameMatch = estimateData.customer_name && 
            (c.name?.toLowerCase() === estimateData.customer_name?.toLowerCase());
          const emailMatch = estimateData.customer_email && 
            (c.email?.toLowerCase() === estimateData.customer_email?.toLowerCase());
          return nameMatch || emailMatch;
        });
        
        if (matchingCustomer) {
          customerId = matchingCustomer.id;
          console.log('✅ Auto-linked estimate to customer:', matchingCustomer.name);
        }
      }

      const estimate = await base44.entities.Estimate.create({
        company_id: myCompany?.id,
        customer_id: customerId,
        ...estimateData,
      });

      if (customerId && !estimate.customer_id) {
        try {
          await base44.functions.invoke('linkEstimatesToCustomers', {
            estimateId: estimate.id,
            customerId: customerId
          });
        } catch (linkError) {
          console.warn('Auto-linking failed (non-critical):', linkError);
        }
      }

      return estimate;
    },
    onSuccess: (newEstimate) => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      navigate(createPageUrl('EstimateEditor') + `?estimate_id=${newEstimate.id}`);
    },
  });

  // Handle file upload
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadedFile(file);
    setIsUploading(true);
    setUploadedFileUrl(null);
    setExtractionError(null);

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadedFileUrl(file_url);
      alert('✅ File uploaded! Click "Extract & Create Estimate" to analyze it.');
    } catch (error) {
      setExtractionError('Upload failed: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  // Handle document extraction
  const handleExtractDocument = async () => {
    if (!uploadedFileUrl) {
      alert('Please upload a file first');
      return;
    }

    setIsExtracting(true);
    setExtractionError(null);
    setExtractionResult(null);

    try {
      const result = await base44.functions.invoke('extractEstimateGPT4o', {
        fileUrl: uploadedFileUrl,
        pricingSource: pricingSource,
        jobType: jobType,
      });

      const data = result.data;

      if (data.success) {
        setExtractionResult(data);
        
        // Create estimate with extracted data
        const estimateNumber = generateNextEstimateNumber();
        await createEstimateMutation.mutateAsync({
          estimate_number: estimateNumber,
          customer_name: data.customer_name || lead?.name || urlCustomerName || 'Unknown',
          customer_email: lead?.email || urlCustomerEmail || '',
          customer_phone: lead?.phone || urlCustomerPhone || '',
          customer_id: urlCustomerId || undefined,
          property_address: data.property_address || propertyAddress,
          claim_number: data.claim_number || '',
          insurance_company: data.insurance_company || '',
          lead_id: leadId,
          items: data.line_items || [],
          amount: data.line_items?.reduce((sum, item) => sum + Number(item.rcv || item.amount || 0), 0) || 0,
          status: 'draft',
        });
      } else {
        setExtractionError(data.error || 'Extraction failed');
      }
    } catch (error) {
      setExtractionError('Extraction failed: ' + error.message);
    } finally {
      setIsExtracting(false);
    }
  };

  const getGoogleMapsKey = async () => {
    try {
      const result = await base44.functions.invoke('getGoogleMapsApiKey', {});
      return result.data.apiKey;
    } catch (error) {
      console.error('Failed to get Google Maps API key:', error);
      return '';
    }
  };

  // Handle satellite analysis
  const handleSatelliteAnalysis = async () => {
    if (!propertyAddress) {
      alert('Please enter a property address');
      return;
    }

    if (!user) {
      alert('User information not loaded. Please wait or refresh.');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setRoofAnalysis(null);

    try {
      const geocodeResponse = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(propertyAddress)}&key=${await getGoogleMapsKey()}`
      );
      const geocodeData = await geocodeResponse.json();

      if (!geocodeData.results || geocodeData.results.length === 0) {
        throw new Error('Could not find address');
      }

      const location = geocodeData.results[0].geometry.location;

      console.log('🛰️ Analyzing roof from satellite imagery...');
      const result = await base44.functions.invoke('aiRoofMeasurement', {
        latitude: location.lat,
        longitude: location.lng,
        address: propertyAddress,
      });

      const data = result.data;

      if (data.success) {
        setRoofAnalysis(data);
        
        let priceListSource = 'Xactimate';
        if (pricingSource === 'xactimate_new') {
          priceListSource = 'Xactimate_New';
        } else if (pricingSource === 'custom') {
          priceListSource = 'Custom';
        } else if (pricingSource === 'symbility') {
          priceListSource = 'Symbility';
        }

        const priceList = await base44.entities.PriceListItem.filter({ source: priceListSource }, '-created_date', 200);
        console.log(`📋 Loaded ${priceList.length} items from ${priceListSource} price list`);

        const lineItems = [];
        
        const findPriceItem = (codes) => {
          for (const code of codes) {
            const item = priceList.find(p => p.code.toUpperCase().includes(code.toUpperCase()));
            if (item) return item;
          }
          return null;
        };

        // Gutters-only mode: use eave LF as gutter LF and skip roofing items
        if (jobType === 'gutters') {
          const lf = Number(parseFloat(data.eave_lf || data.perimeter_lf || 0).toFixed(2));
          const gutterItem = findPriceItem(['RFG GTR', 'GUTTER']);
          const downspoutItem = findPriceItem(['RFG DSP', 'DOWNSPOUT']);
          const gutterRate = Number(gutterItem?.price || 10.33);
          const downspoutRate = Number(downspoutItem?.price || 95);
          const removalRate = 1.80;
          if (lf > 0) {
            const downspoutCount = Math.max(1, Math.round(lf / 40));
            lineItems.push({
              code: gutterItem?.code || 'RFG GTR',
              description: gutterItem?.description || 'Gutter / downspout - aluminum - up to 5" K-style',
              quantity: lf, unit: 'LF', rate: gutterRate,
              rcv: Number((lf * gutterRate).toFixed(2)), acv: Number((lf * gutterRate).toFixed(2)),
              amount: Number((lf * gutterRate).toFixed(2)), depreciation_percent: 0, category: 'Gutters',
            });
            lineItems.push({
              code: downspoutItem?.code || 'RFG GTR DSP',
              description: downspoutItem?.description || 'Downspout - aluminum',
              quantity: downspoutCount, unit: 'EA', rate: downspoutRate,
              rcv: Number((downspoutCount * downspoutRate).toFixed(2)), acv: Number((downspoutCount * downspoutRate).toFixed(2)),
              amount: Number((downspoutCount * downspoutRate).toFixed(2)), depreciation_percent: 0, category: 'Gutters',
            });
            lineItems.push({
              code: 'RFG GTR REM', description: 'Remove existing gutters',
              quantity: lf, unit: 'LF', rate: removalRate,
              rcv: Number((lf * removalRate).toFixed(2)), acv: Number((lf * removalRate).toFixed(2)),
              amount: Number((lf * removalRate).toFixed(2)), depreciation_percent: 0, category: 'Gutters',
            });
          }
          const totalAmount = lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const estimateNumber = generateNextEstimateNumber();
          await createEstimateMutation.mutateAsync({
            estimate_number: estimateNumber,
            customer_name: lead?.name || urlCustomerName || 'Unknown',
            customer_email: lead?.email || urlCustomerEmail || '',
            customer_phone: lead?.phone || urlCustomerPhone || '',
            customer_id: urlCustomerId || undefined,
            property_address: propertyAddress,
            lead_id: leadId,
            items: lineItems,
            amount: totalAmount,
            status: 'draft',
            notes: `AI Satellite — Gutters Estimate. Eave LF: ${lf}. Roof data: ${data.roof_area_sq} SQ, Pitch: ${data.pitch || 'Unknown'}, Confidence: ${data.overall_confidence}%`,
          });
          return;
        }

        if (data.roof_area_sq > 0) {
          const shingleItem = findPriceItem(['RFG SSSQ', 'SHINGLE', 'ASPHALT']);
          const quantity = Number(parseFloat(data.roof_area_sq).toFixed(2));
          const rate = Number(shingleItem?.price || 350);
          const rcvAmount = Number((quantity * rate).toFixed(2));
          
          lineItems.push({
            code: shingleItem?.code || 'RFG SSSQ',
            description: shingleItem?.description || 'Shingles - architectural asphalt',
            quantity: quantity,
            unit: 'SQ',
            rate: rate,
            rcv: rcvAmount,
            acv: rcvAmount,
            amount: rcvAmount,
            depreciation_percent: 0,
            category: 'Roofing'
          });
        }

        if (data.ridge_lf > 0) {
          const ridgeItem = findPriceItem(['RFG RDGC', 'RIDGE CAP']);
          const quantity = Number(parseFloat(data.ridge_lf).toFixed(2));
          const rate = Number(ridgeItem?.price || 8.5);
          const rcvAmount = Number((quantity * rate).toFixed(2));
          
          lineItems.push({
            code: ridgeItem?.code || 'RFG RDGC',
            description: ridgeItem?.description || 'Ridge cap',
            quantity: quantity,
            unit: 'LF',
            rate: rate,
            rcv: rcvAmount,
            acv: rcvAmount,
            amount: rcvAmount,
            depreciation_percent: 0,
            category: 'Roofing'
          });
        }

        if (data.hip_lf > 0) {
          const hipItem = findPriceItem(['RFG HIPS', 'HIP']);
          const quantity = Number(parseFloat(data.hip_lf).toFixed(2));
          const rate = Number(hipItem?.price || 8.5);
          const rcvAmount = Number((quantity * rate).toFixed(2));
          
          lineItems.push({
            code: hipItem?.code || 'RFG HIPS',
            description: hipItem?.description || 'Hip shingles',
            quantity: quantity,
            unit: 'LF',
            rate: rate,
            rcv: rcvAmount,
            acv: rcvAmount,
            amount: rcvAmount,
            depreciation_percent: 0,
            category: 'Roofing'
          });
        }

        if (data.valley_lf > 0) {
          const valleyItem = findPriceItem(['RFG VALY', 'VALLEY']);
          const quantity = Number(parseFloat(data.valley_lf).toFixed(2));
          const rate = Number(valleyItem?.price || 12);
          const rcvAmount = Number((quantity * rate).toFixed(2));
          
          lineItems.push({
            code: valleyItem?.code || 'RFG VALY',
            description: valleyItem?.description || 'Valley flashing',
            quantity: quantity,
            unit: 'LF',
            rate: rate,
            rcv: rcvAmount,
            acv: rcvAmount,
            amount: rcvAmount,
            depreciation_percent: 0,
            category: 'Roofing'
          });
        }

        if (data.rake_lf > 0) {
          const rakeItem = findPriceItem(['RFG RAKE', 'RAKE']);
          const quantity = Number(parseFloat(data.rake_lf).toFixed(2));
          const rate = Number(rakeItem?.price || 4.5);
          const rcvAmount = Number((quantity * rate).toFixed(2));
          
          lineItems.push({
            code: rakeItem?.code || 'RFG RAKE',
            description: rakeItem?.description || 'Rake trim',
            quantity: quantity,
            unit: 'LF',
            rate: rate,
            rcv: rcvAmount,
            acv: rcvAmount,
            amount: rcvAmount,
            depreciation_percent: 0,
            category: 'Roofing'
          });
        }

        if (data.eave_lf > 0) {
          const eaveItem = findPriceItem(['RFG EAVE', 'DRIP EDGE', 'EAVE']);
          const quantity = Number(parseFloat(data.eave_lf).toFixed(2));
          const rate = Number(eaveItem?.price || 3.5);
          const rcvAmount = Number((quantity * rate).toFixed(2));
          
          lineItems.push({
            code: eaveItem?.code || 'RFG EAVE',
            description: eaveItem?.description || 'Eave drip edge',
            quantity: quantity,
            unit: 'LF',
            rate: rate,
            rcv: rcvAmount,
            acv: rcvAmount,
            amount: rcvAmount,
            depreciation_percent: 0,
            category: 'Roofing'
          });
        }

        if (data.step_flashing_lf > 0) {
          const stepItem = findPriceItem(['RFG STEP', 'STEP FLASH']);
          const quantity = Number(parseFloat(data.step_flashing_lf).toFixed(2));
          const rate = Number(stepItem?.price || 12);
          const rcvAmount = Number((quantity * rate).toFixed(2));
          
          lineItems.push({
            code: stepItem?.code || 'RFG STEP',
            description: stepItem?.description || 'Step flashing',
            quantity: quantity,
            unit: 'LF',
            rate: rate,
            rcv: rcvAmount,
            acv: rcvAmount,
            amount: rcvAmount,
            depreciation_percent: 0,
            category: 'Roofing'
          });
        }

        const totalAmount = lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const estimateNumber = generateNextEstimateNumber();
        
        console.log('📊 Line items created:', lineItems.length);
        console.log('💰 Total amount:', totalAmount);
        
        await createEstimateMutation.mutateAsync({
          estimate_number: estimateNumber,
          customer_name: lead?.name || urlCustomerName || 'Unknown',
          customer_email: lead?.email || urlCustomerEmail || '',
          customer_phone: lead?.phone || urlCustomerPhone || '',
          customer_id: urlCustomerId || undefined,
          property_address: propertyAddress,
          lead_id: leadId,
          items: lineItems,
          amount: totalAmount,
          status: 'draft',
          notes: `AI Satellite Analysis - Roof Area: ${data.roof_area_sq} SQ, Pitch: ${data.pitch || 'Unknown'}, Confidence: ${data.overall_confidence}%`,
        });
      } else {
        setAnalysisError(data.error || 'Analysis failed');
      }
    } catch (error) {
      console.error('❌ Satellite analysis error:', error);
      setAnalysisError('Analysis failed: ' + error.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Manual mode - create estimate, with gutter pre-population if gutters job type
  const handleManualCreate = async () => {
    const estimateNumber = generateNextEstimateNumber().replace(' (AI)', '');
    let items = [];
    let amount = 0;

    if (jobType === 'gutters' && gutterLF && parseFloat(gutterLF) > 0) {
      const lf = parseFloat(gutterLF);
      const gutterRate = 10.33;
      const downspoutCount = Math.max(1, Math.round(lf / 40));
      const downspoutRate = 95;
      const removalRate = 1.80;
      items = [
        {
          code: 'RFG GTR',
          description: 'Gutter / downspout - aluminum - up to 5" K-style',
          quantity: lf,
          unit: 'LF',
          rate: gutterRate,
          rcv: Number((lf * gutterRate).toFixed(2)),
          acv: Number((lf * gutterRate).toFixed(2)),
          amount: Number((lf * gutterRate).toFixed(2)),
          depreciation_percent: 0,
          category: 'Gutters',
        },
        {
          code: 'RFG GTR DSP',
          description: 'Downspout - aluminum',
          quantity: downspoutCount,
          unit: 'EA',
          rate: downspoutRate,
          rcv: Number((downspoutCount * downspoutRate).toFixed(2)),
          acv: Number((downspoutCount * downspoutRate).toFixed(2)),
          amount: Number((downspoutCount * downspoutRate).toFixed(2)),
          depreciation_percent: 0,
          category: 'Gutters',
        },
        {
          code: 'RFG GTR REM',
          description: 'Remove existing gutters',
          quantity: lf,
          unit: 'LF',
          rate: removalRate,
          rcv: Number((lf * removalRate).toFixed(2)),
          acv: Number((lf * removalRate).toFixed(2)),
          amount: Number((lf * removalRate).toFixed(2)),
          depreciation_percent: 0,
          category: 'Gutters',
        },
      ];
      amount = items.reduce((s, i) => s + i.amount, 0);
    }

    await createEstimateMutation.mutateAsync({
      estimate_number: estimateNumber,
      customer_name: lead?.name || urlCustomerName || '',
      customer_email: lead?.email || urlCustomerEmail || '',
      customer_phone: lead?.phone || urlCustomerPhone || '',
      customer_id: urlCustomerId || undefined,
      property_address: propertyAddress,
      lead_id: leadId,
      items,
      amount,
      status: 'draft',
    });
  };

  if (loadingLead) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        <Button
          variant="outline"
          onClick={() => navigate(-1)}
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Create Estimate</h1>
          {lead && (
            <p className="text-gray-600 mt-2">
              For: <strong>{lead.name}</strong> • {propertyAddress}
            </p>
          )}
        </div>

        {(() => {
          if (dismissDuplicateWarning) return null;
          const customerName = lead?.name || urlCustomerName || '';
          if (!customerName && !urlCustomerId) return null;
          const existing = findOpenEstimatesForCustomer(estimates, urlCustomerId, customerName);
          if (existing.length === 0) return null;
          return (
            <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-sm text-amber-800">
                <span className="font-semibold">Heads up:</span> {customerName || 'This customer'} already has {existing.length} open estimate{existing.length > 1 ? 's' : ''}:
                <ul className="mt-1 space-y-0.5">
                  {existing.map(e => (
                    <li key={e.id}>
                      <button
                        type="button"
                        className="font-medium text-amber-700 underline hover:text-amber-900"
                        onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + e.id)}
                      >
                        {e.estimate_number}
                      </button>
                      {' '}— ${(Number(e.total_amount || e.amount) || 0).toFixed(2)} ({e.status})
                      {' '}<span className="text-amber-600 italic text-xs">— open to use Revise / Supplement</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => setDismissDuplicateWarning(true)}
                className="text-amber-500 hover:text-amber-700 text-xl leading-none ml-1"
                aria-label="Dismiss"
              >×</button>
            </div>
          );
        })()}

        {!selectedMode ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Manual Mode */}
            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setSelectedMode('manual')}>
              <CardHeader>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <CardTitle>Manual Entry</CardTitle>
                <CardDescription>
                  Create estimate from scratch by adding line items manually
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-blue-600 hover:bg-blue-700">
                  Start Manual Entry
                </Button>
              </CardContent>
            </Card>

            {/* Document Upload */}
            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setSelectedMode('document')}>
              <CardHeader>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <Upload className="w-6 h-6 text-green-600" />
                </div>
                <CardTitle>Document Upload</CardTitle>
                <CardDescription>
                  Upload EagleView, Hover, or GAF report - AI extracts all measurements
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-green-600 hover:bg-green-700">
                  Upload Report
                </Button>
              </CardContent>
            </Card>

            {/* Satellite Measurement */}
            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setSelectedMode('satellite')}>
              <CardHeader>
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                  <Satellite className="w-6 h-6 text-purple-600" />
                </div>
                <CardTitle>Satellite Measurement</CardTitle>
                <CardDescription>
                  AI analyzes satellite imagery to measure roof and generate estimate
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-purple-600 hover:bg-purple-700">
                  Analyze Property
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : selectedMode === 'manual' ? (
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>Create Estimate</CardTitle>
                  <CardDescription className="mt-1">Creating a blank estimate - you can add line items in the editor</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSelectedMode('document')} className="gap-2">
                    <Upload className="w-4 h-4" />
                    <span className="hidden sm:inline">Upload Document</span>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSelectedMode('satellite')} className="gap-2">
                    <Satellite className="w-4 h-4" />
                    <span className="hidden sm:inline">Satellite</span>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Job Type</Label>
                  <Select value={jobType} onValueChange={(v) => { setJobType(v); setGutterLF(""); }}>
                    <SelectTrigger data-testid="select-job-type-manual">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="roofing">Roofing</SelectItem>
                      <SelectItem value="gutters">Gutters Only</SelectItem>
                      <SelectItem value="siding">Siding</SelectItem>
                      <SelectItem value="full_exterior">Full Exterior</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Property Address</Label>
                  <Input
                    value={propertyAddress}
                    onChange={(e) => setPropertyAddress(e.target.value)}
                    placeholder="123 Main St, City, State ZIP"
                    data-testid="input-property-address-manual"
                  />
                </div>
              </div>

              {jobType === 'gutters' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium text-amber-900">Gutters Estimate — Enter Measurements</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Total Gutter Length (LF)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={gutterLF}
                        onChange={(e) => setGutterLF(e.target.value)}
                        placeholder="e.g. 120"
                        data-testid="input-gutter-lf"
                      />
                    </div>
                    <div className="flex flex-col justify-end">
                      <p className="text-xs text-amber-700">
                        Will auto-estimate downspouts ({gutterLF ? Math.max(1, Math.round(parseFloat(gutterLF) / 40)) : '—'} ea) and removal. You can adjust in the editor.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="flex gap-3">
                <Button
                  onClick={handleManualCreate}
                  disabled={createEstimateMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="button-create-estimate"
                >
                  {createEstimateMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : jobType === 'gutters' && gutterLF ? (
                    'Create Gutters Estimate'
                  ) : (
                    'Create Blank Estimate'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : selectedMode === 'document' ? (
          <Card>
            <CardHeader>
              <CardTitle>Document Upload Mode</CardTitle>
              <CardDescription>Upload measurement report (EagleView, Hover, GAF QuickMeasure)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Job Type</Label>
                  <Select value={jobType} onValueChange={setJobType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="roofing">Roofing</SelectItem>
                      <SelectItem value="gutters">Gutters Only</SelectItem>
                      <SelectItem value="siding">Siding</SelectItem>
                      <SelectItem value="full_exterior">Full Exterior</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Pricing Source</Label>
                  <Select value={pricingSource} onValueChange={setPricingSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="xactimate_new">Xactimate</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                      <SelectItem value="symbility">Symbility</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Upload Report (PDF, PNG, JPG)</Label>
                <Input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                />
                {uploadedFile && (
                  <p className="text-sm text-gray-600 mt-2">
                    ✅ {uploadedFile.name}
                  </p>
                )}
              </div>

              {extractionError && (
                <Alert variant="destructive">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>{extractionError}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3">
                <Button
                  onClick={handleExtractDocument}
                  disabled={!uploadedFileUrl || isExtracting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    'Extract & Create Estimate'
                  )}
                </Button>
                <Button variant="outline" onClick={() => setSelectedMode('manual')}>
                  Back to Manual Entry
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Satellite Measurement</CardTitle>
              <CardDescription>AI analyzes satellite imagery to measure roof</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Property Address</Label>
                <Input
                  value={propertyAddress}
                  onChange={(e) => setPropertyAddress(e.target.value)}
                  placeholder="123 Main St, City, State ZIP"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Job Type</Label>
                  <Select value={jobType} onValueChange={setJobType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="roofing">Roofing</SelectItem>
                      <SelectItem value="gutters">Gutters Only</SelectItem>
                      <SelectItem value="siding">Siding</SelectItem>
                      <SelectItem value="full_exterior">Full Exterior</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Pricing Source</Label>
                  <Select value={pricingSource} onValueChange={setPricingSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="xactimate_new">Xactimate</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                      <SelectItem value="symbility">Symbility</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>


              {analysisError && (
                <Alert variant="destructive">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>{analysisError}</AlertDescription>
                </Alert>
              )}

              {roofAnalysis && (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-green-900">
                    <strong>✅ Analysis Complete!</strong>
                    <p className="text-sm mt-1">
                      Roof: {roofAnalysis.roof_area_sq} SQ • Pitch: {roofAnalysis.pitch} • Confidence: {roofAnalysis.overall_confidence}%
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3">
                <Button
                  onClick={handleSatelliteAnalysis}
                  disabled={!propertyAddress || isAnalyzing}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    'Analyze & Create Estimate'
                  )}
                </Button>
                <Button variant="outline" onClick={() => setSelectedMode('manual')}>
                  Back to Manual Entry
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}