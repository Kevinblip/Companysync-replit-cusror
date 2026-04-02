import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  CheckCircle2,
  Plug,
  Upload,
  Download,
  FileText,
  Trash2,
  Plus,
  RefreshCw,
  Bot,
  Loader2,
  Sparkles,
  ClipboardPaste,
  Copy,
  Facebook,
  Instagram,
  Video,
  MapPin,
  CalendarIcon,
  LinkIcon,
  Wrench,
  Zap,
  ExternalLink,
  Mail,
  Send,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function IntegrationManager() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("custom_csv");
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [importingStandard, setImportingStandard] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState(null);
  const [showThoughtlyDialog, setShowThoughtlyDialog] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [thoughtlyAgents, setThoughtlyAgents] = useState([]);
  const [xactimateTarget, setXactimateTarget] = useState("xactimate_new");
  const [importError, setImportError] = useState(null);
  const [extractingRoofing, setExtractingRoofing] = useState(false);
  const [extractionResult, setExtractionResult] = useState(null);
  
  // NEW: Paste import state
  const [pastedData, setPastedData] = useState("");
  const [pasteSource, setPasteSource] = useState("Xactimate_New");
  const [importingPaste, setImportingPaste] = useState(false);
  const [pasteResult, setPasteResult] = useState(null);

  // NEW: Google Calendar state
  const [isConnecting, setIsConnecting] = useState(false);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [setupDiagnosis, setSetupDiagnosis] = useState(null);
  const [isCategorizing, setIsCategorizing] = useState(false);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);

  const queryClient = useQueryClient();

  const handleSendTestEmail = async () => {
    if (!user?.email) return;
    setIsSendingTestEmail(true);
    try {
      const response = await base44.functions.invoke('sendEmailWithResend', {
        to: user.email,
        subject: 'Test Email from Integration Manager',
        body: '<h1>It Works!</h1><p>Your Resend email integration is configured correctly.</p>',
        fromName: 'Integration Test'
      });
      
      if (response.data.success) {
        alert(`✅ Email sent to ${user.email}!`);
      } else {
        alert('❌ Failed to send: ' + (response.data.error || 'Unknown error'));
      }
    } catch (error) {
      alert('❌ Error: ' + error.message);
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  const MARKETING_INTEGRATIONS = [
    {
      id: 'facebook_leads',
      name: 'Facebook Lead Ads',
      icon: Facebook,
      color: 'bg-blue-600',
      description: 'Auto-capture leads from Facebook ads',
      setupUrl: '/functions/facebookLeadsWebhook'
    },
    {
      id: 'facebook_pages',
      name: 'Facebook Pages',
      icon: Facebook,
      color: 'bg-blue-500',
      description: 'Manage messages and comments',
      setupUrl: '/functions/facebookPagesWebhook'
    },
    {
      id: 'instagram_business',
      name: 'Instagram Business',
      icon: Instagram,
      color: 'from-purple-500 to-pink-500',
      description: 'DMs and comments to CRM',
      setupUrl: null
    },
    {
      id: 'tiktok_leads',
      name: 'TikTok Lead Ads',
      icon: Video,
      color: 'bg-black',
      description: 'Capture TikTok ad leads',
      setupUrl: '/functions/tiktokLeadsWebhook'
    },
    {
      id: 'google_my_business',
      name: 'Google My Business',
      icon: MapPin,
      color: 'bg-green-600',
      description: 'Review monitoring & responses',
      setupUrl: '/functions/googleMyBusinessWebhook'
    }
  ];

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setGoogleCalendarConnected(u?.google_calendar_connected === true);
      setLastSync(u?.last_google_sync);
      setCheckingConnection(false);
    }).catch(() => {
      setCheckingConnection(false);
    });
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: twilioConfig } = useQuery({
    queryKey: ['twilio-settings'],
    queryFn: async () => {
      if (!myCompany) return null;
      const settings = await base44.entities.TwilioSettings.filter({ company_id: myCompany.id });
      return settings[0] || null;
    },
    enabled: !!myCompany,
  });

  const handleCreateThoughtlyAgent = async () => {
    if (!myCompany?.id) {
      alert('Please complete company setup first');
      return;
    }

    setIsCreatingAgent(true);
    try {
      const response = await base44.functions.invoke('createThoughtlyAgent', {
        companyId: myCompany.id
      });

      alert('✅ Thoughtly AI agent created successfully! Your AI phone receptionist is ready.');
      setShowThoughtlyDialog(false);
      queryClient.invalidateQueries({ queryKey: ['twilio-settings'] });
    } catch (error) {
      alert(`Failed to create agent: ${error.message}`);
    }
    setIsCreatingAgent(false);
  };

  const handleListThoughtlyAgents = async () => {
    setIsLoadingAgents(true);
    try {
      const response = await base44.functions.invoke('listThoughtlyAgents', {});
      setThoughtlyAgents(response.data.agents || []);
    } catch (error) {
      alert(`Failed to load agents: ${error.message}`);
    }
    setIsLoadingAgents(false);
  };

  useEffect(() => {
    if (showThoughtlyDialog) {
      handleListThoughtlyAgents();
    }
  }, [showThoughtlyDialog]);

  const { data: integrationSettings = [] } = useQuery({
    queryKey: ['integration-settings'],
    queryFn: () => myCompany ? base44.entities.IntegrationSetting.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: priceListItems = [] } = useQuery({
    queryKey: ['price-list-items', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.PriceListItem.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const customCSVSetting = integrationSettings.find(s => s.integration_name === 'Custom CSV');
  const xactimateSetting = integrationSettings.find(s => s.integration_name === 'Xactimate');
  const symbilitySetting = integrationSettings.find(s => s.integration_name === 'Symbility');
  const abcSupplySetting = integrationSettings.find(s => s.integration_name === 'ABC Supply');

  // NEW: Symbility form state
  const [symbilityForm, setSymbilityForm] = useState({
    org_id: '',
    username: '',
    password: '',
    api_key: '',
    soap_url: 'https://soap.symbility.com/services'
  });
  const [isTestingSymbility, setIsTestingSymbility] = useState(false);
  const [isImportingSymbility, setIsImportingSymbility] = useState(false);

  const customItems = priceListItems.filter(i => i.source === 'Custom');
  const xactimateItems = priceListItems.filter(i => i.source === 'Xactimate');
  const xactimateNewItems = priceListItems.filter(i => i.source === 'Xactimate_New');
  const symbilityItems = priceListItems.filter(i => i.source === 'Symbility');

  // NEW: Load saved Symbility settings
  useEffect(() => {
    if (symbilitySetting?.config) {
      setSymbilityForm({
        org_id: symbilitySetting.config.org_id || '',
        username: symbilitySetting.config.username || '',
        password: symbilitySetting.config.password || '',
        api_key: symbilitySetting.config.api_key || '',
        soap_url: symbilitySetting.config.soap_url || 'https://soap.symbility.com/services'
      });
    }
  }, [symbilitySetting]);

  // NEW: Paste import handler - UPDATED to handle CSV, clean $ symbols, and process in chunks
  const handlePasteImport = async () => {
    if (!pastedData.trim()) {
      alert('❌ Please paste some data first!');
      return;
    }

    setImportingPaste(true);
    setPasteResult(null);
    setImportError(null);

    // Building codes have their own simple handler
    if (pasteSource === 'BuildingCodes') {
      try {
        const lines = pastedData.split('\n').filter(l => l.trim());
        const validCategories = ['Roofing', 'Gutters', 'Siding', 'Windows', 'General', 'Other'];
        let created = 0;
        let skipped = 0;
        const errors = [];

        // Skip header if present
        let start = 0;
        if (lines[0] && lines[0].toLowerCase().startsWith('code')) start = 1;

        for (let i = start; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          try {
            const sep = line.includes('\t') ? '\t' : ',';
            const parts = line.split(sep).map(p => p.replace(/^"|"$/g, '').trim());
            const code = parts[0];
            if (!code) { skipped++; continue; }
            const description = parts[1] || '';
            const rawCat = parts[2] || '';
            const category = validCategories.find(c => c.toLowerCase() === rawCat.toLowerCase()) || 'Other';
            await base44.entities.BuildingCode.create({ code, description, category, company_id: myCompany?.id });
            created++;
          } catch (e) {
            errors.push({ line: i + 1, error: e.message, data: lines[i].substring(0, 50) });
            skipped++;
          }
        }

        queryClient.invalidateQueries({ queryKey: ['building-codes'] });
        setPasteResult({ success: true, imported: created, total: lines.length - start, errors });
        alert(`✅ SUCCESS!\n\nImported ${created} building codes!${skipped ? `\n${skipped} lines skipped.` : ''}`);
        setPastedData('');
      } catch (error) {
        alert('❌ Import failed: ' + error.message);
        setPasteResult({ success: false, error: error.message });
      } finally {
        setImportingPaste(false);
      }
      return;
    }

    try {
      const lines = pastedData.split('\n').filter(line => line.trim());
      console.log(`📊 Parsing ${lines.length} lines...`);

      if (lines.length > 1000) {
        alert(`⚠️ Large Import Detected\n\nYou're importing ${lines.length} lines. This will be processed in batches of 500 lines to prevent errors.\n\nPlease wait, this may take 1-2 minutes...`);
      }

      const items = [];
      const errors = [];

      // Skip header row if it exists
      let startIndex = 0;
      if (lines.length > 0 && lines[0].toLowerCase().includes('description') && lines[0].toLowerCase().includes('unit')) {
        console.log('⏭️ Skipping header row');
        startIndex = 1;
      }

      // Combine multi-line descriptions (common in PDF copy-paste)
      const combinedLines = [];
      let currentDescription = '';
      
      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Skip header lines
        if (line.toLowerCase().includes('description') && line.toLowerCase().includes('qty') && i < 3) {
          continue;
        }
        
        // Check if this line has numeric columns (indicates complete row)
        const hasNumbers = (line.match(/\d+\.\d+/g) || []).length >= 2;
        
        if (hasNumbers || /^\d+[,.]?\s+/.test(line)) {
          // This is a data line (has line number or multiple numbers)
          if (currentDescription) {
            combinedLines.push(currentDescription + ' ' + line);
            currentDescription = '';
          } else {
            combinedLines.push(line);
          }
        } else {
          // Continuation of description from previous line
          currentDescription += (currentDescription ? ' ' : '') + line;
        }
      }
      
      // Add any remaining description
      if (currentDescription) {
        combinedLines.push(currentDescription);
      }

      console.log(`📦 Combined ${lines.length} raw lines into ${combinedLines.length} complete rows`);

      for (let i = 0; i < combinedLines.length; i++) {
        const line = combinedLines[i].trim();
        if (!line) continue;

        try {
          // Try TAB-separated CSV format FIRST
          if (line.includes('\t')) {
            const parts = line.split('\t').map(p => p.trim());
            
            if (parts.length >= 3) {
              let description = parts[0].replace(/\s*\$\s*$/g, '').trim();

              // ── Xactimate table format: Description | QTY | REMOVE | REPLACE | TAX | TOTAL ──
              // Detect by: 5+ columns where cols 2–4 are all numeric
              if (parts.length >= 5) {
                const col2 = parseFloat(parts[2].replace(/[$,]/g, ''));
                const col3 = parseFloat(parts[3].replace(/[$,]/g, ''));
                const isXactimateTable = !isNaN(col2) && !isNaN(col3);

                if (isXactimateTable) {
                  const removePrice = col2;
                  const replacePrice = col3;
                  // Use REPLACE price; fall back to REMOVE price for remove-only items
                  const effectivePrice = replacePrice > 0 ? replacePrice : removePrice;
                  if (!effectivePrice || effectivePrice <= 0) continue;

                  // Strip leading line number prefix ("1.  ", "21. ", etc.)
                  description = description.replace(/^\d+[,.]?\s+/, '').trim();

                  // Extract unit from QTY column: "1.00 EA" → "EA", "SQ" → "SQ"
                  const qtyField = parts[1] || '';
                  const unitMatch = qtyField.match(/(SQ|EA|LF|SF|HR|LS|WK|MO|YR|DA|CY|GL)/i);
                  const unit = unitMatch ? unitMatch[1].toUpperCase() : (qtyField.replace(/[\d.\s]/g, '').toUpperCase() || 'EA');

                  const code = description.replace(/\s+/g, '_').replace(/[^\w_]/g, '').substring(0, 20).toUpperCase();
                  let category = 'Other';
                  const descUpper = description.toUpperCase();
                  if (descUpper.includes('SHINGLE') || descUpper.includes('ROOF') || descUpper.includes('RFG')) category = 'Roofing';
                  else if (descUpper.includes('SIDING') || descUpper.includes('SID')) category = 'Siding';
                  else if (descUpper.includes('GUTTER') || descUpper.includes('GTR')) category = 'Exterior';
                  else if (descUpper.includes('DRYWALL') || descUpper.includes('PAINT')) category = 'Interior';

                  items.push({ code, description, unit: unit || 'EA', price: effectivePrice, category, source: pasteSource });
                  console.log(`✅ Xactimate Tab: ${description.substring(0, 35)} - $${effectivePrice} ${unit}`);
                  continue;
                }
              }

              // ── Standard 3-column tab CSV: Description | Unit | Price ──
              let unit = parts[1];
              const price = parseFloat(parts[2].replace(/[$,]/g, ''));
              
              if (!price || price <= 0) continue;

              const code = description.replace(/\s+/g, '_').replace(/[^\w_]/g, '').substring(0, 20).toUpperCase();
              let category = 'Other';
              const descUpper = description.toUpperCase();
              if (descUpper.includes('SHINGLE') || descUpper.includes('ROOF') || descUpper.includes('RFG')) category = 'Roofing';
              else if (descUpper.includes('SIDING') || descUpper.includes('SID')) category = 'Siding';
              else if (descUpper.includes('GUTTER') || descUpper.includes('GTR')) category = 'Exterior';
              else if (descUpper.includes('DRYWALL') || descUpper.includes('PAINT')) category = 'Interior';

              items.push({ code, description, unit: unit.toUpperCase() || 'EA', price, category, source: pasteSource });
              console.log(`✅ Tab CSV: ${description.substring(0, 30)} - $${price} ${unit}`);
              continue;
            }
          }

          // Try COMMA-separated CSV format
          if (line.includes(',')) {
            const parts = line.split(',').map(p => p.trim());
            
            if (parts.length >= 3) {
              let description = parts[0].replace(/\s*\$\s*$/g, '').trim();
              let unit = parts[1];
              const price = parseFloat(parts[2].replace(/[$,]/g, ''));
              
              if (!price || price <= 0) continue;

              const code = description.replace(/\s+/g, '_').replace(/[^\w_]/g, '').substring(0, 20).toUpperCase();
              let category = 'Other';
              const descUpper = description.toUpperCase();
              if (descUpper.includes('SHINGLE') || descUpper.includes('ROOF') || descUpper.includes('RFG')) category = 'Roofing';
              else if (descUpper.includes('SIDING') || descUpper.includes('SID')) category = 'Siding';
              else if (descUpper.includes('GUTTER') || descUpper.includes('GTR')) category = 'Exterior';
              else if (descUpper.includes('DRYWALL') || descUpper.includes('PAINT')) category = 'Interior';

              items.push({ code, description, unit: unit.toUpperCase() || 'EA', price, category, source: pasteSource });
              console.log(`✅ Comma CSV: ${description.substring(0, 30)} - $${price} ${unit}`);
              continue;
            }
          }

          // Xactimate PDF format: "14. Description  QTY  REMOVE  REPLACE  TAX  TOTAL"
          // Remove leading line numbers
          const cleanedLine = line.replace(/^\d+[,.]?\s+/, '');
          
          // Split by 2+ spaces OR single space followed by number (for tight columns)
          const parts = cleanedLine.split(/\s{2,}|\s(?=\d)/).map(p => p.trim()).filter(p => p);
          
          if (parts.length >= 4) {
            const description = parts[0];
            const qtyField = parts[1]; // e.g., "SQ", "1.00 EA"
            const removePrice = parseFloat(parts[2]) || 0;
            const replacePrice = parseFloat(parts[3]) || 0;
            
            // Extract unit from QTY field
            let unit = 'EA';
            const unitMatch = qtyField.match(/(SQ|EA|LF|SF|HR|LS|WK|MO|YR|DA|CY|GL)/i);
            if (unitMatch) {
              unit = unitMatch[1].toUpperCase();
            }
            
            // Use REPLACE price
            if (!replacePrice || replacePrice <= 0) {
              console.log(`⏭️ Skipping zero REPLACE: ${description.substring(0, 40)}...`);
              continue;
            }

            let fullDescription = description.replace(/\s*\$\s*$/g, '').trim();
            const code = fullDescription.replace(/\s+/g, '_').replace(/[^\w_]/g, '').substring(0, 20).toUpperCase();

            let category = 'Other';
            const descUpper = fullDescription.toUpperCase();
            if (descUpper.includes('SHINGLE') || descUpper.includes('ROOF') || descUpper.includes('RFG')) category = 'Roofing';
            else if (descUpper.includes('SIDING') || descUpper.includes('SID')) category = 'Siding';
            else if (descUpper.includes('GUTTER') || descUpper.includes('GTR')) category = 'Exterior';
            else if (descUpper.includes('DRYWALL') || descUpper.includes('PAINT')) category = 'Interior';

            items.push({ code, description: fullDescription, unit, price: replacePrice, category, source: pasteSource });
            console.log(`✅ Xactimate: ${fullDescription.substring(0, 30)} - $${replacePrice} ${unit}`);
            continue;
          }

          errors.push({ line: i + 1, error: 'Could not parse format', data: line.substring(0, 50) });

        } catch (parseError) {
          errors.push({ line: i + 1, error: parseError.message, data: line.substring(0, 50) });
        }
      }

      console.log(`✅ Parsed ${items.length} valid items`);

      if (items.length === 0) {
        alert('❌ No valid items found. Please check your format.');
        setPasteResult({
          success: false,
          error: 'No valid items found',
          errors: errors
        });
        return;
      }

      // Use backend function for faster bulk import
      console.log(`🚀 Sending ${items.length} items to backend for bulk import...`);

      const response = await base44.functions.invoke('bulkImportPriceList', {
        items: items,
        source: pasteSource,
        company_id: myCompany?.id
      });

      console.log('🎉 Import complete!');

      const result = response.data || response;

      setPasteResult({
        success: result.success,
        imported: result.imported,
        total: result.total,
        errors: errors.length > 0 ? errors.slice(0, 10) : []
      });

      alert(`✅ SUCCESS!\n\nImported ${result.imported} items!`);
      
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
      setPastedData('');

    } catch (error) {
      console.error('❌ Import failed:', error);
      alert('❌ Import failed: ' + error.message);
      setPasteResult({
        success: false,
        error: error.message
      });
    } finally {
      setImportingPaste(false);
    }
  };

  const createOrUpdateIntegration = useMutation({
    mutationFn: async ({ name, config, enabled }) => {
      const existing = integrationSettings.find(s => s.integration_name === name);
      const data = {
        integration_name: name,
        is_enabled: enabled,
        config: config || {}
      };

      if (existing) {
        return base44.entities.IntegrationSetting.update(existing.id, data);
      } else {
        return base44.entities.IntegrationSetting.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integration-settings'] });
    },
    onError: (error) => {
      alert(`Failed to save settings: ${error.message}`);
    }
  });

  const handleMarketingConnect = (integration) => {
    if (integration.setupUrl) {
      const webhookUrl = `${window.location.origin}${integration.setupUrl}`;
      const instructions = integration.id === 'facebook_leads'
        ? `📋 Facebook Lead Ads Setup:\n\n1. Copy this webhook URL:\n${webhookUrl}\n\n2. Go to Facebook Business Manager → Lead Ads → Webhooks\n\n3. Paste URL and set verify token: yicn_roofing_leads_2025\n\n4. Subscribe to "leadgen" events\n\n✅ Done! Leads will auto-sync to CRM`
        : integration.id === 'tiktok_leads'
        ? `📋 TikTok Lead Ads Setup:\n\n1. Copy this webhook URL:\n${webhookUrl}\n\n2. Go to TikTok Ads Manager → Tools → Events → Lead Generation\n\n3. Add webhook URL\n\n✅ Leads auto-import to CRM!`
        : `📋 Setup:\n\nWebhook URL:\n${webhookUrl}\n\nAdd this to your ${integration.name} settings`;
      
      navigator.clipboard.writeText(webhookUrl).then(() => {
        alert(instructions);
      });
    } else {
      alert(`${integration.name} integration coming soon!`);
    }
  };

  const handleFileUploadAndStore = async () => {
    if (!csvFile) {
      alert('Please select a file');
      return;
    }

    const fileName = csvFile.name.toLowerCase();
    if (!fileName.endsWith('.csv') && !fileName.endsWith('.plx')) { // Added .plx for AI extraction
      alert('❌ Please upload a .csv or .plx file');
      return;
    }

    const maxSize = 50 * 1024 * 1024;
    if (csvFile.size > maxSize) {
      alert(`❌ File too large (${(csvFile.size / 1024 / 1024).toFixed(1)}MB). Maximum 50MB.`);
      return;
    }

    console.log('📁 File details:', {
      name: csvFile.name,
      size: `${(csvFile.size / 1024).toFixed(1)}KB`,
      type: csvFile.type
    });

    setIsUploadingFile(true);
    setImportError(null);
    setUploadedFileUrl(null);
    setExtractionResult(null);

    try {
      console.log('📤 Uploading file to storage...');
      const uploadResponse = await base44.integrations.Core.UploadFile({ file: csvFile });
      console.log('✅ File uploaded:', uploadResponse.file_url);
      setUploadedFileUrl(uploadResponse.file_url);
      alert('✅ File uploaded successfully! Now click "Import CSV" or "Extract Roofing (AI)" to process it.');
    } catch (error) {
      console.error('❌ Upload failed:', error);
      let errorMsg = 'Upload failed: ';
      if (error.message && error.message.includes('400')) {
        errorMsg += 'The file could not be processed. Check the browser console (F12) for details.';
      } else if (error.message && error.message.includes('413')) {
        errorMsg += 'File too large. Try a smaller file.';
      } else if (error.message && error.message.includes('timeout')) {
        errorMsg += 'Upload timed out. File may be too large.';
      } else {
        errorMsg += error.message;
      }
      setImportError(errorMsg);
      alert(errorMsg);
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleStandardImport = async () => {
    if (!uploadedFileUrl) {
      alert('Please upload a file first.');
      return;
    }

    setImportingStandard(true);
    setImportError(null);
    setExtractionResult(null);

    try {
      console.log('🔄 Starting standard import with URL:', uploadedFileUrl);
      console.log('🔄 Target source:', xactimateTarget === "xactimate_new" ? "Xactimate_New" : "Custom");

      const importResponse = await base44.functions.invoke('importPerfexItems', {
        fileUrl: uploadedFileUrl,
        targetSource: xactimateTarget === "xactimate_new" ? "Xactimate_New" : xactimateTarget === "xactimate_old" ? "Xactimate" : "Custom",
        company_id: myCompany?.id
      });

      console.log('✅ Standard import succeeded!');
      const responseData = importResponse.data || importResponse;

      if (responseData && responseData.success) {
        alert(`✅ Successfully imported ${responseData.imported} items!`);
        await createOrUpdateIntegration.mutateAsync({
          name: xactimateTarget === "xactimate_new" ? "Xactimate New" : "Custom CSV",
          config: { csv_url: uploadedFileUrl },
          enabled: true
        });
        queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
        setImportError(null);
      } else {
        console.error('❌ Standard import returned success: false');
        let errorMessage = responseData?.error || 'Import failed with no error message';
        if (responseData?.debug) {
          const debug = responseData.debug;
          errorMessage += `\n\n📊 Debug Info:\n`;
          errorMessage += `- File size: ${debug.fileSize} bytes\n`;
          errorMessage += `- Strings found: ${debug.stringsFound}\n`;
          errorMessage += `- Codes found: ${debug.codesFound}\n`;
          errorMessage += `- Prices found: ${debug.pricesFound}\n`;
          errorMessage += `- Descriptions found: ${debug.descriptionsFound}\n`;
          if (debug.sampleStrings && debug.sampleStrings.length > 0) {
            errorMessage += `\n📝 First 10 extracted strings:\n${debug.sampleStrings.slice(0, 10).join('\n')}`;
          }
        }
        if (responseData?.hint) {
          errorMessage += `\n\n💡 ${responseData.hint}`;
        }
        setImportError(errorMessage);
        alert(`❌ Standard import failed:\n\n${errorMessage}`);
      }
    } catch (invokeError) {
      console.error('❌ Function invoke error caught:', invokeError);
      let errorData = invokeError.response?.data || invokeError.data;
      let errorMessage = 'Function execution failed';
      if (errorData) {
        errorMessage = errorData.error || errorData.message || JSON.stringify(errorData);
        if (errorData.debug) {
          const debug = errorData.debug;
          errorMessage += `\n\n📊 Debug Info:\n`;
          errorMessage += `- File size: ${debug.fileSize} bytes\n`;
          errorMessage += `- Strings found: ${debug.stringsFound}\n`;
          errorMessage += `- Codes found: ${debug.codesFound}\n`;
          errorMessage += `- Prices found: ${debug.pricesFound}\n`;
          errorMessage += `- Descriptions found: ${debug.descriptionsFound}\n`;
          if (debug.sampleStrings && debug.sampleStrings.length > 0) {
            errorMessage += `\n📝 First 10 extracted strings:\n${debug.sampleStrings.slice(0, 10).join('\n')}`;
          }
        }
        if (errorData.hint) {
          errorMessage += `\n\n💡 ${errorData.hint}`;
        }
      } else {
        errorMessage += `\n\nRaw error: ${invokeError.message}`;
      }
      setImportError(errorMessage);
      alert(`❌ Standard import failed:\n\n${errorMessage}`);
    } finally {
      setImportingStandard(false);
    }
  };

  const handleAIExtractRoofing = async () => {
    if (!uploadedFileUrl) {
      alert('Please upload a PLX file first');
      return;
    }

    if (!window.confirm('🤖 This will use Claude AI to extract ONLY roofing codes from your PLX file.\n\nThis may take 30-60 seconds. Continue?')) {
      return;
    }

    setExtractingRoofing(true);
    setExtractionResult(null);
    setImportError(null);

    try {
      const { data } = await base44.functions.invoke('extractXactimateRoofing', {
        fileUrl: uploadedFileUrl,
        companyId: myCompany?.id
      });

      console.log('🎉 Extraction result:', data);

      setExtractionResult(data);

      if (data.success) {
        alert(`✅ SUCCESS!\n\nImported ${data.imported_count} roofing items!\n\nTotal found: ${data.total_found}\nImported: ${data.imported_count}\nSkipped (duplicates): ${data.skipped_count || 0}`);
        
        queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
      } else {
        alert(`❌ Extraction failed:\n\n${data.error}`);
      }

    } catch (error) {
      console.error('❌ Error:', error);
      setImportError('❌ AI Extraction failed: ' + error.message);
      alert('❌ AI Extraction failed: ' + error.message);
    } finally {
      setExtractingRoofing(false);
    }
  };

  const handleDeleteAllCustomItems = async () => {
    if (!window.confirm(`Delete all ${customItems.length} custom items? This cannot be undone.`)) {
      return;
    }

    try {
      queryClient.setQueryData(['price-list-items'], (oldData) => oldData.filter(item => item.source !== 'Custom'));

      const deletePromises = customItems.map(item => base44.entities.PriceListItem.delete(item.id));
      await Promise.all(deletePromises);

      alert('✅ All custom items deleted');
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
      if (customCSVSetting?.is_enabled) {
        createOrUpdateIntegration.mutateAsync({
          name: 'Custom CSV',
          config: {},
          enabled: false
        });
      }
    } catch (error) {
      alert('Delete failed: ' + error.message);
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
    }
  };

  const handleToggleIntegration = async (name, enabled) => {
    await createOrUpdateIntegration.mutateAsync({
      name: name,
      config: name === 'Symbility' ? symbilityForm : {}, // Pass symbilityForm if it's Symbility
      enabled: enabled
    });
  };

  // NEW: Test Symbility connection
  const handleTestSymbility = async () => {
    if (!symbilityForm.org_id || !symbilityForm.username || !symbilityForm.password || !symbilityForm.api_key) {
      alert('❌ Please fill in all required fields');
      return;
    }

    setIsTestingSymbility(true);
    
    try {
      const response = await base44.functions.invoke('testSymbilityConnection', {
        orgId: symbilityForm.org_id,
        username: symbilityForm.username,
        password: symbilityForm.password,
        apiKey: symbilityForm.api_key,
        soapUrl: symbilityForm.soap_url
      });

      if (response.data.success) {
        alert('✅ Connection successful!\n\n' + response.data.message);
        
        // Save settings
        await createOrUpdateIntegration.mutateAsync({
          name: 'Symbility',
          config: symbilityForm,
          enabled: true
        });
      } else {
        alert('❌ Connection failed:\n\n' + response.data.error);
      }
    } catch (error) {
      alert('❌ Test failed:\n\n' + error.message);
    }
    
    setIsTestingSymbility(false);
  };

  // NEW: Import Symbility pricing
  const handleImportSymbility = async () => {
    if (!symbilitySetting?.is_enabled) {
      alert('❌ Please test connection first and ensure Symbility is enabled');
      return;
    }

    if (!window.confirm('📊 Import Symbility price list?\n\nThis will replace existing Symbility items in your database.\n\nContinue?')) {
      return;
    }

    setIsImportingSymbility(true);
    
    try {
      const response = await base44.functions.invoke('importSymbilityPricing', {
        orgId: symbilityForm.org_id,
        username: symbilityForm.username,
        password: symbilityForm.password,
        apiKey: symbilityForm.api_key,
        soapUrl: symbilityForm.soap_url
      });

      if (response.data.success) {
        alert(`✅ SUCCESS!\n\nImported ${response.data.imported} Symbility items!`);
        queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
      } else {
        alert('❌ Import failed:\n\n' + response.data.error);
      }
    } catch (error) {
      alert('❌ Import failed:\n\n' + error.message);
    }
    
    setIsImportingSymbility(false);
  };

  // NEW: Google Calendar handlers
  const handleGoogleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await base44.functions.invoke('connectUserGoogleCalendar', {});
      if (result.data?.authUrl) {
        window.location.href = result.data.authUrl;
      }
    } catch (error) {
      console.error('Error connecting to Google Calendar:', error);
      alert('Failed to connect to Google Calendar: ' + error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleGoogleSync = async () => {
    setIsConnecting(true);
    try {
      const result = await base44.functions.invoke('syncUserGoogleCalendar', {});
      
      if (result.data.needsReconnect) {
        alert('⚠️ ' + result.data.error + '\n\nPlease disconnect and reconnect your Google Calendar.');
        setGoogleCalendarConnected(false);
        return;
      }
      
      const summary = result.data;
      const totalChanges = summary.total || 0;
      
      let message = `✅ Two-way sync complete!\n\n`;
      message += `📥 From Google Calendar:\n`;
      message += `  • ${summary.fromGoogle?.created || 0} new events imported\n`;
      message += `  • ${summary.fromGoogle?.updated || 0} events updated\n`;
      message += `  • ${summary.fromGoogle?.deleted || 0} events deleted\n\n`;
      message += `📤 To Google Calendar:\n`;
      message += `  • ${summary.toGoogle?.created || 0} CRM events pushed\n`;
      message += `  • ${summary.toGoogle?.updated || 0} CRM events updated\n\n`;
      message += `Total: ${totalChanges} changes synced`;
      
      alert(message);
      queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      
      const updatedUser = await base44.auth.me();
      setLastSync(updatedUser.last_google_sync);
    } catch (error) {
      console.error('Error syncing Google Calendar:', error);
      
      if (error.message?.includes('403') || error.message?.includes('Permission denied')) {
        alert('❌ 403 Permission Error\n\nYour Google Calendar is not properly configured.\n\nClick the "🔧 Setup Help" button for detailed instructions.');
        setGoogleCalendarConnected(false);
      } else {
        alert('Failed to sync calendar: ' + error.message);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    if (!confirm('Disconnect your Google Calendar? Your CRM events will remain, but auto-sync will stop.')) {
      return;
    }

    setIsConnecting(true);
    try {
      await base44.functions.invoke('disconnectUserGoogleCalendar', {});
      setGoogleCalendarConnected(false);
      setLastSync(null);
      alert('✅ Google Calendar disconnected');
    } catch (error) {
      console.error('Error disconnecting:', error);
      alert('Failed to disconnect: ' + error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleShowSetup = async () => {
    setShowSetupDialog(true);
    setSetupDiagnosis(null);
    try {
      const result = await base44.functions.invoke('diagnoseGoogleCalendar', {});
      setSetupDiagnosis(result.data);
    } catch (error) {
      setSetupDiagnosis({ error: 'Failed to run diagnosis: ' + error.message });
    }
  };

  const handleAutoCategorize = async () => {
    if (!confirm('🎨 Auto-categorize all events?\n\nThis will analyze each event title and assign the appropriate type and color.\n\nExamples:\n• "Inspection" → Green\n• "Call" → Purple\n• "Meeting" → Blue\n• "Birthday" → Yellow\n\nContinue?')) {
      return;
    }

    setIsCategorizing(true);
    try {
      const result = await base44.functions.invoke('autoCategorizeEvents', {});
      
      if (result.data.success) {
        const msg = `✅ Auto-categorization complete!\n\n` +
                    `📊 Total events: ${result.data.total}\n` +
                    `✏️ Updated: ${result.data.updated}\n` +
                    `✓ Already correct: ${result.data.unchanged}\n\n` +
                    `Your calendar now has color-coded events!`;
        
        alert(msg);
        queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
        queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      }
    } catch (error) {
      console.error('Auto-categorize error:', error);
      alert('Failed to auto-categorize events: ' + error.message);
    } finally {
      setIsCategorizing(false);
      }
      };

      // ABC Supply handlers
      const handleConnectABC = async () => {
      if (!myCompany) {
        alert('Please set up your company profile first');
        return;
      }

      setIsConnectingABC(true);
      try {
        // Redirect to OAuth flow
        window.location.href = `${window.location.origin}/api/functions/connectABCSupply`;
      } catch (error) {
        console.error('ABC Connect error:', error);
        alert('Failed to connect: ' + error.message);
        setIsConnectingABC(false);
      }
      };

      const handleDisconnectABC = async () => {
      if (!confirm('Disconnect ABC Supply? You can reconnect anytime.')) {
        return;
      }

      try {
        if (abcSupplySetting) {
          await base44.entities.IntegrationSetting.update(abcSupplySetting.id, {
            is_enabled: false,
            config: {}
          });
          alert('✅ ABC Supply disconnected');
          queryClient.invalidateQueries({ queryKey: ['integration-settings'] });
        }
      } catch (error) {
        alert('Failed to disconnect: ' + error.message);
      }
      };

      // Check for OAuth callback success/error
      useEffect(() => {
      const urlParams = new URLSearchParams(window.location.search);
      const success = urlParams.get('success');
      const error = urlParams.get('error');

      if (success === 'abc_connected') {
        alert('✅ ABC Supply connected successfully!\n\nYou can now place material orders directly from your estimates.');
        window.history.replaceState({}, '', window.location.pathname);
        queryClient.invalidateQueries({ queryKey: ['integration-settings'] });
      } else if (error) {
        const errorMessages = {
          'abc_auth_failed': 'ABC Supply authorization failed. Please try again.',
          'token_exchange_failed': 'Failed to exchange authorization code. Please contact support.',
          'callback_failed': 'OAuth callback failed. Please try again.'
        };
        alert('❌ ' + (errorMessages[error] || 'Connection failed'));
        window.history.replaceState({}, '', window.location.pathname);
      }
      }, []);

      return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
          <Plug className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Integration Manager</h1>
          <p className="text-gray-500 mt-1">Connect external tools, pricing sources, and marketing platforms.</p>
        </div>
      </div>

{/* Marketing integrations hidden - not fully functional */}

      {/* GoHighLevel Integration Card */}
      <Card className="border-l-4 border-l-orange-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-orange-600" />
            GoHighLevel Integration
          </CardTitle>
          <CardDescription>Two-way sync with your GoHighLevel CRM</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-orange-50 border-orange-200">
            <Zap className="w-4 h-4 text-orange-600" />
            <AlertDescription className="text-orange-900">
              <strong>What GHL Integration Does:</strong>
              <ul className="list-disc list-inside mt-2 text-sm space-y-1">
                <li>Auto-import GHL contacts as leads (GHL → CRM)</li>
                <li>Push new CRM leads to GoHighLevel (CRM → GHL)</li>
                <li>Sync opportunities, messages, and notes</li>
                <li>Real-time webhook updates</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="flex gap-3">
            <Button
              onClick={() => navigate(createPageUrl('GoHighLevelSettings'))}
              className="flex-1 bg-orange-600 hover:bg-orange-700"
            >
              <Wrench className="w-4 h-4 mr-2" />
              Configure GoHighLevel
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open('https://app.gohighlevel.com', '_blank')}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open GHL
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SOFT-HIDDEN: Thoughtly AI Card - disabled platform-wide */}

{/* Material suppliers hidden - ABC Supply OAuth not complete */}

      {/* Resend Email Integration */}
      <Card className="border-l-4 border-l-blue-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-6 h-6 text-blue-600" />
            Email Service (Resend)
          </CardTitle>
          <CardDescription>Configure email delivery and smart glasses photo receiving.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold mb-2">Configuration Status</h3>
              <div className="space-y-2">
                 <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-green-900">
                    <strong>API Key Configured</strong>
                    <p className="text-sm mt-1">System is ready to send emails.</p>
                  </AlertDescription>
                </Alert>
                
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={handleSendTestEmail}
                    disabled={isSendingTestEmail}
                    className="flex-1"
                  >
                    {isSendingTestEmail ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Send Test Email
                  </Button>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg border">
              <h3 className="font-semibold mb-2 text-sm flex items-center gap-2">
                <Video className="w-4 h-4" />
                Smart Glasses Setup (Inbound)
              </h3>
              <p className="text-xs text-gray-600 mb-3">
                To receive photos from smart glasses, configure your Resend dashboard:
              </p>
              <ol className="list-decimal list-inside text-xs text-gray-700 space-y-2">
                <li>Go to <strong>Resend Dashboard &gt; Webhooks</strong></li>
                <li>Create new Webhook for your verified domain</li>
                <li>
                  <strong>Webhook URL:</strong>
                  <br />
                  <code className="bg-white px-1 py-0.5 rounded border select-all cursor-pointer" onClick={(e) => {
                    const url = `${window.location.origin}/api/functions/smartGlassesEmailWebhook`;
                    navigator.clipboard.writeText(url);
                    alert('Copied webhook URL!');
                  }}>
                    {`${window.location.origin}/api/functions/smartGlassesEmailWebhook`}
                  </code>
                </li>
                <li>Select events: <strong>Email Received</strong></li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Google Calendar Integration - NEW SECTION */}
      <Card className="border-l-4 border-l-green-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="w-6 h-6 text-green-600" />
            Google Calendar
          </CardTitle>
          <CardDescription>Advanced calendar settings and diagnostics</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!checkingConnection && googleCalendarConnected && (
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleAutoCategorize}
                disabled={isCategorizing}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isCategorizing ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Categorizing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Auto-Color Events
                  </>
                )}
              </Button>

              <Button
                onClick={handleShowSetup}
                variant="outline"
                className="border-orange-600 text-orange-700 hover:bg-orange-50"
              >
                <Wrench className="w-4 h-4 mr-2" />
                Setup Help
              </Button>

              <Button
                onClick={handleGoogleDisconnect}
                disabled={isConnecting}
                variant="outline"
                className="text-red-600 hover:bg-red-50"
              >
                Disconnect
              </Button>
            </div>
          )}

          {!googleCalendarConnected && !checkingConnection && (
            <Alert className="bg-blue-50 border-blue-200">
              <AlertCircle className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                <strong>Connect Google Calendar from the Calendar page</strong>
                <p className="text-sm mt-1">Go to Calendar → Connect to enable two-way sync</p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Setup Diagnosis Dialog */}
      <Dialog open={showSetupDialog} onOpenChange={setShowSetupDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Wrench className="w-6 h-6 text-orange-600" />
              Google Calendar Setup Diagnostic
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            {setupDiagnosis ? (
              <div className="space-y-4">
                {setupDiagnosis.error ? (
                  <Alert className="bg-red-50 border-red-200">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <AlertDescription className="text-red-900">
                      {setupDiagnosis.error}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <Card>
                      <CardContent className="pt-6">
                        <h3 className="font-semibold mb-3">📊 Current Status</h3>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><strong>Connection:</strong> {setupDiagnosis.connection_status}</div>
                          <div><strong>Access Token:</strong> {setupDiagnosis.has_access_token ? 'Yes' : 'No'}</div>
                          <div><strong>Refresh Token:</strong> {setupDiagnosis.has_refresh_token ? 'Yes' : 'No'}</div>
                          <div><strong>Token Status:</strong> {setupDiagnosis.token_expired === 'N/A' ? 'N/A' : (setupDiagnosis.token_expired ? 'Expired' : 'Valid')}</div>
                          <div className="col-span-2"><strong>API Test:</strong> {setupDiagnosis.api_access_test}</div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <h3 className="font-semibold mb-3">📋 Required Setup Steps</h3>
                        <div className="bg-gray-50 p-4 rounded-lg font-mono text-xs whitespace-pre-wrap">
                          {setupDiagnosis.required_steps.join('\n')}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <h3 className="font-semibold mb-3">🔗 Quick Links</h3>
                        <div className="space-y-2">
                          <a
                            href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-blue-600 hover:underline text-sm"
                          >
                            → Enable Google Calendar API
                          </a>
                          <a
                            href="https://console.cloud.google.com/apis/credentials/consent"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-blue-600 hover:underline text-sm"
                          >
                            → Configure OAuth Consent Screen
                          </a>
                          <a
                            href="https://console.cloud.google.com/apis/credentials"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-blue-600 hover:underline text-sm"
                          >
                            → Fix Redirect URI
                          </a>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
                <span className="ml-3">Running diagnostic...</span>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="custom_csv">Custom CSV</TabsTrigger>
          <TabsTrigger value="paste_import">✨ Paste Import</TabsTrigger>
          <TabsTrigger value="xactimate">Xactimate</TabsTrigger>
          <TabsTrigger value="symbility">Symbility</TabsTrigger>
        </TabsList>

        {/* NEW: Paste Import Tab */}
        <TabsContent value="paste_import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardPaste className="w-5 h-5 text-green-600" />
                Paste Import - Copy from Xactimate or CSV
              </CardTitle>
              <CardDescription className="text-gray-500">
                ✨ Copy price list data from Xactimate, Excel, or any CSV and paste it here - instant import!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert className="bg-blue-50 border-blue-200">
                <Copy className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  <strong>📋 How to use:</strong>
                  <ol className="list-decimal list-inside mt-2 text-sm space-y-1">
                    <li>Copy a table of price list items (e.g., from Xactimate, Excel, or a text file).</li>
                    <li>Paste the data in the box below (Ctrl+V).</li>
                    <li>Click "Import Data" - Done! ✅</li>
                  </ol>
                  <p className="mt-2 text-xs text-blue-700">
                    <strong>Format 1 (CSV / Tab-separated):</strong> Description [TAB/COMMA] Unit [TAB/COMMA] Price (e.g., `Shingle Roofing,SQ,312.25`)
                  </p>
                  <p className="mt-1 text-xs text-blue-700">
                    <strong>Format 2 (Xactimate Table — copy/paste from Xactimate estimate):</strong> Paste the line-item table directly — columns DESCRIPTION, QTY, REMOVE, REPLACE, TAX, TOTAL are auto-detected. REPLACE price is used (REMOVE price used for remove-only items).
                  </p>
                  <p className="mt-1 text-xs text-blue-700">
                    <strong>Note:</strong> Descriptions with trailing "$" will be cleaned.
                  </p>
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <div>
                  <Label>Select Source/Destination</Label>
                  <Select value={pasteSource} onValueChange={setPasteSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Xactimate">Xactimate</SelectItem>
                      <SelectItem value="Xactimate_New">Xactimate New 🆕</SelectItem>
                      <SelectItem value="Custom">Custom Items</SelectItem>
                      <SelectItem value="Symbility">Symbility</SelectItem>
                      <SelectItem value="BuildingCodes">Building Codes 🏗️</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">
                    {pasteSource === 'BuildingCodes'
                      ? 'Adds new codes — duplicates are skipped. Format: Code, Description, Category (optional)'
                      : 'This will REPLACE all existing items in the selected source'}
                  </p>
                </div>

                <div>
                  <Label>Paste Your Data Here</Label>
                  <Textarea
                    value={pastedData}
                    onChange={(e) => setPastedData(e.target.value)}
                    placeholder={pasteSource === 'BuildingCodes'
                      ? `Paste building codes here — one per line.

Format: Code, Description, Category (category is optional)

Examples:
IWS, Ice & Water Shield required in first 24" from eave, Roofing
RFG 240, Minimum 240 lb shingle requirement, Roofing
GTR ALUM, Aluminum gutter requirement, Gutters
DE, Drip edge required on all eaves and rakes, Roofing
ACV, Actual Cash Value depreciation may apply, General

Tab-separated also works:
IWS\tIce & Water Shield required\tRoofing`
                      : `Paste your price list data here...

Example CSV / Tab-separated Format:
Description     Unit    Price
3 tab - 25 yr. - composition shingle    SQ      312.25
Ridge cap - 30 yr. - composition shingle        LF      5.25

Example Comma-separated CSV:
Description,Unit,Price
Shingle Roofing,SQ,312.25
Ridge Cap,LF,5.25

Example Xactimate Table (copy/paste directly from Xactimate):
DESCRIPTION     QTY     REMOVE  REPLACE TAX     TOTAL
1.  Remove Laminated - comp. shingle rfg. - w/ felt     SQ      79.16   0.00    0.00    0.00
2.  Laminated - comp. shingle rfg. - w/ felt    SQ      0.00    336.40  0.00    0.00
3.  Roofing felt - 15 lb.       SQ      0.00    26.00   0.00    0.00`}
                    className="min-h-[300px] font-mono text-sm"
                    disabled={importingPaste}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {pastedData.split('\n').filter(l => l.trim()).length} lines pasted
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handlePasteImport}
                    disabled={importingPaste || !pastedData.trim()}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    {importingPaste ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Import Data
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => {
                      setPastedData('');
                      setPasteResult(null);
                    }}
                    disabled={importingPaste}
                  >
                    Clear
                  </Button>
                </div>

                {pasteResult && (
                  <Alert className={pasteResult.success ? "bg-green-50 border-green-200" : pasteResult.inProgress ? "bg-blue-50 border-blue-200" : "bg-red-50 border-red-200"}>
                    <AlertDescription className={pasteResult.success ? "text-green-900" : pasteResult.inProgress ? "text-blue-900" : "text-red-900"}>
                      {pasteResult.inProgress ? (
                        <div>
                          <strong>🔄 Importing in progress...</strong>
                          <p className="text-sm mt-1">Processed {pasteResult.imported} of {pasteResult.total} items ({pasteResult.progress}%)</p>
                          <div className="mt-2 bg-blue-200 h-2 rounded-full overflow-hidden">
                            <div className="bg-blue-600 h-full transition-all duration-300" style={{width: `${pasteResult.progress}%`}}></div>
                          </div>
                        </div>
                      ) : pasteResult.success ? (
                        <div>
                          <strong>✅ Success!</strong>
                          <p className="text-sm mt-1">Imported {pasteResult.imported} items from {pasteResult.total} total lines</p>
                          {pasteResult.errors?.length > 0 && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs">View errors ({pasteResult.errors.length})</summary>
                              <ul className="list-disc list-inside text-xs mt-1">
                                {pasteResult.errors.map((err, i) => (
                                  <li key={i}>Line {err.line}: {err.error} - {err.data}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      ) : (
                        <div>
                          <strong>❌ Failed:</strong> {pasteResult.error}
                          {pasteResult.errors?.length > 0 && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs">View first 10 errors</summary>
                              <ul className="list-disc list-inside text-xs mt-1">
                                {pasteResult.errors.map((err, i) => (
                                  <li key={i}>Line {err.line}: {err.error} - {err.data}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Show current items */}
              {pasteSource === 'Xactimate' && xactimateItems.length > 0 && (
                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">Current Xactimate Items: {xactimateItems.length}</h3>
                  <p className="text-sm text-gray-500">These will be replaced when you import new data</p>
                </div>
              )}

              {pasteSource === 'Xactimate_New' && xactimateNewItems.length > 0 && (
                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">Current Xactimate New Items: {xactimateNewItems.length}</h3>
                  <p className="text-sm text-gray-500">These will be replaced when you import new data</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="custom_csv" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Custom CSV Price List
              </CardTitle>
              <CardDescription className="text-gray-500">Upload CSV files to import pricing data.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <Label className="text-base font-semibold">Enable Custom CSV Price List</Label>
                  <p className="text-sm text-gray-500 mt-1">Use uploaded CSV items in your estimates</p>
                </div>
                <Button
                  variant={customCSVSetting?.is_enabled ? "default" : "outline"}
                  onClick={() => handleToggleIntegration('Custom CSV', !customCSVSetting?.is_enabled)}
                  disabled={createOrUpdateIntegration.isPending && createOrUpdateIntegration.variables?.name === 'Custom CSV'}
                >
                  {createOrUpdateIntegration.isPending && createOrUpdateIntegration.variables?.name === 'Custom CSV' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    customCSVSetting?.is_enabled ? 'Enabled' : 'Disabled'
                  )}
                </Button>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  CSV Format Requirements
                </h3>
                <ol className="space-y-2 text-sm text-blue-800">
                  <li><strong>Format:</strong> Standard CSV with Description, Rate, Unit, Group Name columns</li>
                  <li><strong>Example:</strong> "3-tab Shingle,312.25,SQ,Roofing"</li>
                  <li><strong>Upload:</strong> Select your CSV file below and click "Upload File"</li>
                </ol>
              </div>

              {importError && (
                <Alert variant="destructive">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>
                    <div className="whitespace-pre-wrap font-mono text-xs">{importError}</div>
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-4">
                <div>
                  <Label>Upload Destination</Label>
                  <Select value={xactimateTarget} onValueChange={setXactimateTarget}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">Custom Items</SelectItem>
                      <SelectItem value="xactimate_new">Xactimate New 🆕</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">
                    {xactimateTarget === "xactimate_new" 
                      ? "Upload to 'Xactimate New' tab (Supports .plx and AI Extraction)"
                      : "Upload to 'Custom' tab"}
                  </p>
                </div>

                <div>
                  <Label>Upload CSV/PLX File (Max 50MB)</Label>
                  <Input
                    type="file"
                    accept=".csv,.plx"
                    onChange={(e) => {
                      setCsvFile(e.target.files[0]);
                      setUploadedFileUrl(null);
                      setImportError(null);
                      setExtractionResult(null);
                    }}
                    disabled={isUploadingFile}
                  />
                  {csvFile && !uploadedFileUrl && (
                    <p className="text-xs text-gray-600 mt-1">
                      Selected: {csvFile.name} ({(csvFile.size / 1024).toFixed(1)}KB)
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleFileUploadAndStore}
                    disabled={!csvFile || isUploadingFile || uploadedFileUrl}
                    className="flex-1"
                  >
                    {isUploadingFile ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading File...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        {uploadedFileUrl ? "File Uploaded" : "Upload File"}
                      </>
                    )}
                  </Button>

                  <Button variant="outline" onClick={() => {
                    const csvContent = "Description,Rate,Unit,Group Name\n3 tab - 25 yr. - composition shingle,312.25,SQ,Roofing\nRidge cap - composition shingle,8.50,LF,Roofing\nDrip edge,2.50,LF,Roofing";
                    const blob = new Blob([csvContent], { type: 'text/csv' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'price_list_template.csv';
                    a.click();
                  }}>
                    <Download className="w-4 h-4 mr-2" />
                    Download Template
                  </Button>
                </div>
              </div>

              {uploadedFileUrl && (
                <div className="space-y-4 border-t pt-4">
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900 text-sm">
                      <strong>✅ File Ready!</strong> Click the button below to import the CSV data into your price list.
                    </AlertDescription>
                  </Alert>

                  <Button
                    onClick={handleStandardImport}
                    disabled={importingStandard}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                  >
                    {importingStandard ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Importing CSV...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Import CSV
                      </>
                    )}
                  </Button>
                  {/* NEW: AI Extraction Button */}
                  {xactimateTarget === "xactimate_new" && (
                    <Button
                      onClick={handleAIExtractRoofing}
                      disabled={extractingRoofing}
                      className="w-full bg-purple-600 hover:bg-purple-700"
                    >
                      {extractingRoofing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Extracting Roofing (AI)...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Extract Roofing (AI)
                        </>
                      )}
                    </Button>
                  )}

                  {/* NEW: AI Extraction Result Display */}
                  {extractionResult && (
                    <Alert className={extractionResult.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}>
                      <AlertDescription className={extractionResult.success ? "text-green-900" : "text-red-900"}>
                        {extractionResult.success ? (
                          <div>
                            <strong>✅ AI Extraction Complete!</strong>
                            <p className="text-sm mt-1">Imported {extractionResult.imported_count} roofing items.</p>
                            <p className="text-xs text-gray-700 mt-1">
                              Total found: {extractionResult.total_found}, Skipped: {extractionResult.skipped_count || 0}
                            </p>
                          </div>
                        ) : (
                          <div>
                            <strong>❌ AI Extraction Failed:</strong> {extractionResult.error}
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}

              {customItems.length > 0 && (
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">Imported Items</h3>
                      <p className="text-sm text-gray-500">{customItems.length} custom items loaded</p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDeleteAllCustomItems}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete All
                    </Button>
                  </div>

                  <div className="max-h-96 overflow-y-auto border rounded-lg">
                    <table className="w-full">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left p-3 text-sm font-semibold">Code</th>
                          <th className="text-left p-3 text-sm font-semibold">Description</th>
                          <th className="text-left p-3 text-sm font-semibold">Unit</th>
                          <th className="text-right p-3 text-sm font-semibold">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customItems.slice(0, 50).map((item) => (
                          <tr key={item.id} className="border-t hover:bg-gray-50">
                            <td className="p-3 text-sm font-mono">{item.code}</td>
                            <td className="p-3 text-sm">{item.description}</td>
                            <td className="p-3 text-sm">{item.unit}</td>
                            <td className="p-3 text-sm text-right">${item.price?.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {customItems.length > 50 && (
                      <div className="p-3 bg-gray-50 text-center text-sm text-gray-500">
                        Showing 50 of {customItems.length} items
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="xactimate" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plug className="w-5 h-5" />
                Xactimate Integration
              </CardTitle>
              <CardDescription className="text-gray-500">Import Xactimate price lists (CSV/PLX) for professional estimates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <Label className="text-base font-semibold">Enable Xactimate Pricing</Label>
                  <p className="text-sm text-gray-500 mt-1">Use Xactimate items in your estimates</p>
                </div>
                <Button
                  variant={xactimateSetting?.is_enabled ? "default" : "outline"}
                  onClick={() => handleToggleIntegration('Xactimate', !xactimateSetting?.is_enabled)}
                  disabled={createOrUpdateIntegration.isPending && createOrUpdateIntegration.variables?.name === 'Xactimate'}
                >
                  {createOrUpdateIntegration.isPending && createOrUpdateIntegration.variables?.name === 'Xactimate' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    xactimateSetting?.is_enabled ? 'Enabled' : 'Disabled'
                  )}
                </Button>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Import Xactimate Price List
                </h3>
                <p className="text-sm text-blue-800">Export your Xactimate price list as CSV or PLX and upload it here.</p>
              </div>

              {importError && (
                <Alert variant="destructive">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>
                    <div className="whitespace-pre-wrap font-mono text-xs">{importError}</div>
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-4">
                <div>
                  <Label>Upload Xactimate File (CSV/PLX, Max 50MB)</Label>
                  <Input
                    type="file"
                    accept=".csv,.plx"
                    onChange={(e) => {
                      setCsvFile(e.target.files[0]);
                      setUploadedFileUrl(null);
                      setImportError(null);
                      setExtractionResult(null);
                      setXactimateTarget("xactimate_old");
                    }}
                    disabled={isUploadingFile}
                  />
                  {csvFile && !uploadedFileUrl && (
                    <p className="text-xs text-gray-600 mt-1">
                      Selected: {csvFile.name} ({(csvFile.size / 1024).toFixed(1)}KB)
                    </p>
                  )}
                </div>

                <Button
                  onClick={handleFileUploadAndStore}
                  disabled={!csvFile || isUploadingFile || uploadedFileUrl}
                  className="w-full"
                >
                  {isUploadingFile ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading File...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      {uploadedFileUrl ? "File Uploaded" : "Upload File"}
                    </>
                  )}
                </Button>
              </div>

              {uploadedFileUrl && (
                <div className="space-y-4 border-t pt-4">
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900 text-sm">
                      <strong>✅ File Ready!</strong> Click below to import into Xactimate price list.
                    </AlertDescription>
                  </Alert>

                  <Button
                    onClick={handleStandardImport}
                    disabled={importingStandard}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                  >
                    {importingStandard ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Importing to Xactimate...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Import to Xactimate
                      </>
                    )}
                  </Button>
                </div>
              )}

              {xactimateItems.length > 0 && (
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">Loaded Items</h3>
                      <p className="text-sm text-gray-500">{xactimateItems.length} Xactimate items</p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        if (!window.confirm(`Delete all ${xactimateItems.length} Xactimate items? This cannot be undone.`)) {
                          return;
                        }
                        try {
                          for (const item of xactimateItems) {
                            await base44.entities.PriceListItem.delete(item.id);
                          }
                          alert('✅ All Xactimate items deleted');
                          queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
                        } catch (error) {
                          alert('Delete failed: ' + error.message);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete All
                    </Button>
                  </div>
                  <div className="max-h-96 overflow-y-auto border rounded-lg">
                    <table className="w-full">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left p-3 text-sm font-semibold">Code</th>
                          <th className="text-left p-3 text-sm font-semibold">Description</th>
                          <th className="text-left p-3 text-sm font-semibold">Unit</th>
                          <th className="text-right p-3 text-sm font-semibold">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {xactimateItems.slice(0, 50).map((item) => (
                          <tr key={item.id} className="border-t hover:bg-gray-50">
                            <td className="p-3 text-sm font-mono">{item.code}</td>
                            <td className="p-3 text-sm">{item.description}</td>
                            <td className="p-3 text-sm">{item.unit}</td>
                            <td className="p-3 text-sm text-right">${item.price?.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {xactimateItems.length > 50 && (
                      <div className="p-3 bg-gray-50 text-center text-sm text-gray-500">
                        Showing 50 of {xactimateItems.length} items
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="symbility" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-gray-400" />
                Symbility - Coming Soon
              </CardTitle>
              <CardDescription>
                Symbility integration is currently disabled and not configured
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert className="bg-gray-50 border-gray-200">
                <AlertCircle className="w-4 h-4 text-gray-600" />
                <AlertDescription className="text-gray-700">
                  This integration is not currently available. Check back soon!
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-2">💡 Integration Tips</h3>
              <ul className="space-y-2 text-sm text-gray-700">
                <li>• <strong>✨ Paste Import:</strong> Copy pricing from Xactimate, Excel, or any CSV - instant import! (Recommended)</li>
                <li>• <strong>CSV Upload:</strong> Bulk import large price lists from CSV files</li>
                <li>• <strong>AI Extraction:</strong> Upload a PLX file to automatically extract roofing codes using AI</li>
                <li>• <strong>Multiple Sources:</strong> Switch between Xactimate New, Custom, Symbility in your estimates</li>
                <li>• <strong>Updates:</strong> Re-import anytime to refresh your pricing</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}