import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { BulkDeleteButton } from "@/components/BulkDeleteControls";
import useTranslation from "@/hooks/useTranslation";
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
  Check,
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
  const { t } = useTranslation();
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
  const [isPdfImporting, setIsPdfImporting] = useState(false);
  const [pdfImportMode, setPdfImportMode] = useState('replace'); // 'replace' | 'merge'
  const [pdfImportProgress, setPdfImportProgress] = useState('');
  const [extractionResult, setExtractionResult] = useState(null);
  
  // NEW: Paste import state
  const [pastedData, setPastedData] = useState("");
  const [pasteSource, setPasteSource] = useState("Xactimate_New");
  const [importingPaste, setImportingPaste] = useState(false);
  const [pasteResult, setPasteResult] = useState(null);
  const [importConfirm, setImportConfirm] = useState(null); // { type:'paste'|'symbility', source, existingCount, newCount?, items?, errors? }

  const queryClient = useQueryClient();

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
  });

  // Resolve company: owner match first, then fall back to first company returned
  // (staff members won't have created_by match but companies query still returns their company)
  const myCompany = companies.find(c => c.created_by === user?.email) || companies[0] || null;

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
  });

  const { data: priceListItems = [] } = useQuery({
    queryKey: ['price-list-items', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.PriceListItem.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
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

  // Execute the actual paste import (called directly when no existing items, or from dialog confirm)
  const doActualPasteImport = async (items, source, errors = [], merge = false) => {
    setImportingPaste(true);
    try {
      console.log(`🚀 Sending ${items.length} items to backend for bulk import (merge=${merge})...`);
      const response = await base44.functions.invoke('bulkImportPriceList', {
        items,
        source,
        company_id: myCompany?.id,
        merge,
      });
      console.log('🎉 Import complete!');
      const result = response.data || response;
      setPasteResult({
        success: result.success,
        imported: result.imported,
        total: result.total,
        errors: errors.length > 0 ? errors.slice(0, 10) : [],
      });
      if (result.success) {
        alert(`✅ SUCCESS!\n\nImported ${result.imported} items!`);
        queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
        setPastedData('');
      } else {
        alert(`❌ Import failed:\n\n${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('❌ Import failed:', error);
      alert('❌ Import failed: ' + error.message);
      setPasteResult({ success: false, error: error.message });
    } finally {
      setImportingPaste(false);
    }
  };

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
          // ── Helper: build category from description string ──────────────
          const guessCategory = (desc) => {
            const d = desc.toUpperCase();
            if (d.match(/SHINGLE|ROOF|RFG|FELT|FLASHING|RIDGE|EAVE|VALLEY|UNDERLAYMENT|MEMBRANE|MODIFIED|BITUMEN|TPO|EPDM|DRIP|CANT|ICE.*WATER|SEAL|VENT|FASCIA|SOFFIT/)) return 'Roofing';
            if (d.match(/SIDING|VINYL|STUCCO|BRICK/)) return 'Siding';
            if (d.match(/DRYWALL|PAINT|PLASTER|INSUL/)) return 'Interior';
            if (d.match(/GUTTER|EXTERIOR|WINDOW|DOOR/)) return 'Exterior';
            return 'Other';
          };

          // ── Skip Symbility footer / summary lines ──────────────────────
          // Measurement summaries: "Eaves: 127.50 LF Ridge: 63.75 LF"
          if (/\w+:\s*[\d.]+\s*(LF|SQ|SF|EA|HR|LS|CY)/i.test(line)) continue;
          // Profit/overhead/tax/total footer lines: "Add 0.00% profit: $0.00", "Subtotal: $...", "Tax: $..."
          if (/^(Add\s+[\d.]+%|Subtotal|Total|Tax|Overhead|Material cost|Labor cost|O&P|Markup|Depreciation|RCV|ACV)\b.*:\s*\$?[\d,]/i.test(line)) continue;
          // Unit-only sub-item continuation lines (no description context): "SF 1 $60.57 EA $60.57"
          if (/^(SF|LF|SQ|EA|HR|LS|CY|GL)\s+[\d.]+\s+\$/i.test(line)) continue;

          // ── Symbility / Xactimate columnar PDF format ─────────────────────
          // Pattern 1 (with leading line #): {#} {desc} {qty} ${unit_price} {unit} ${total}
          // e.g. "2142 ITEL, Shingles, T-Lock, 20 Year, Install 27.90 $164.26 SQ $4,582.86"
          const RE_SYM = /^(\d+)\s+(.+?)\s+([\d,]+\.?\d*)\s+\$\s*([\d,]+\.?\d*)\s+([\w\/]+)\s+\$\s*([\d,]+\.?\d*)\s*$/;
          const mSym = RE_SYM.exec(line);
          if (mSym) {
            const [, lineNum, description, , priceRaw, unit] = mSym;
            const price = parseFloat(priceRaw.replace(/,/g, ''));
            if (!price || price <= 0) continue;
            const code = `${lineNum}_${description.replace(/[\s,\-\/]+/g, '_').replace(/[^\w_]/g, '').substring(0, 15).toUpperCase()}`;
            items.push({ code, description: description.trim(), unit: unit.toUpperCase(), price, category: guessCategory(description), source: pasteSource });
            continue;
          }

          // Pattern 2 (no line #): {desc} {qty} {unit} ${unit_price} {unit} ${total}
          // e.g. "Gauge 127.50 LF $8.20 LF $1,045.50"
          const RE_SYM2 = /^(.+?)\s+([\d,]+\.?\d*)\s+(SQ|LF|SF|EA|HR|LS|CY|GL)\s+\$\s*([\d,]+\.?\d*)\s+(?:SQ|LF|SF|EA|HR|LS|CY|GL)\s+\$\s*[\d,]+\.?\d*\s*$/i;
          const mSym2 = RE_SYM2.exec(line);
          if (mSym2) {
            const [, description, , unit, priceRaw] = mSym2;
            const price = parseFloat(priceRaw.replace(/,/g, ''));
            if (!price || price <= 0) continue;
            const code = description.replace(/[\s,\-\/]+/g, '_').replace(/[^\w_]/g, '').substring(0, 20).toUpperCase();
            items.push({ code, description: description.trim(), unit: unit.toUpperCase(), price, category: guessCategory(description), source: pasteSource });
            continue;
          }

          // Pattern 3 (no line #, no unit after qty): {desc} {qty} ${unit_price} {unit} ${total}
          // e.g. "Height 25.36 $100.16 SQ $2,540.06"
          const RE_SYM3 = /^(.+?)\s+([\d,]+\.?\d*)\s+\$\s*([\d,]+\.?\d*)\s+(SQ|LF|SF|EA|HR|LS|CY|GL)\s+\$\s*[\d,]+\.?\d*\s*$/i;
          const mSym3 = RE_SYM3.exec(line);
          if (mSym3) {
            const [, description, , priceRaw, unit] = mSym3;
            const price = parseFloat(priceRaw.replace(/,/g, ''));
            if (!price || price <= 0) continue;
            const code = description.replace(/[\s,\-\/]+/g, '_').replace(/[^\w_]/g, '').substring(0, 20).toUpperCase();
            items.push({ code, description: description.trim(), unit: unit.toUpperCase(), price, category: guessCategory(description), source: pasteSource });
            continue;
          }

          // Try TAB-separated CSV format FIRST
          if (line.includes('\t')) {
            const parts = line.split('\t').map(p => p.trim());
            
            if (parts.length >= 3) {
              let description = parts[0].replace(/\s*\$\s*$/g, '').trim();
              // Xactimate table format: Description | QTY | REMOVE | REPLACE | TAX | TOTAL
              // Detect by: 5+ columns where cols 2-4 are both numeric
              if (parts.length >= 5) {
                const col2 = parseFloat(parts[2].replace(/[$,]/g, ''));
                const col3 = parseFloat(parts[3].replace(/[$,]/g, ''));
                const isXactimateTable = !isNaN(col2) && !isNaN(col3);
                if (isXactimateTable) {
                  const removePrice = col2;
                  const replacePrice = col3;
                  const effectivePrice = replacePrice > 0 ? replacePrice : removePrice;
                  if (!effectivePrice || effectivePrice <= 0) continue;
                  description = description.replace(/^\d+[,.]?\s+/, '').trim();
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
                  continue;
                }
              }
              // Standard 3-column tab CSV: Description | Unit | Price
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

      // Live count check — don't rely on the React Query cache which may not be
      // loaded yet. Ask the server directly so we never skip the merge/override dialog.
      let existingCount = 0;
      if (pasteSource !== 'BuildingCodes' && myCompany?.id) {
        try {
          const existing = await base44.entities.PriceListItem.filter({
            company_id: myCompany.id,
            source: pasteSource,
          });
          existingCount = existing.length;
        } catch (_) {
          // fall back to the cached list if the live check fails
          existingCount = priceListItems.filter(i => i.source === pasteSource).length;
        }
      }

      if (existingCount > 0) {
        setImportingPaste(false); // un-freeze button while user decides
        setImportConfirm({ type: 'paste', source: pasteSource, existingCount, items, errors, newCount: items.length });
        return;
      }

      // No existing items — proceed directly
      await doActualPasteImport(items, pasteSource, errors);

    } catch (error) {
      console.error('❌ Import failed:', error);
      alert('❌ Import failed: ' + error.message);
      setPasteResult({ success: false, error: error.message });
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
      const fbWebhookUrl = integration.id === 'facebook_leads' && myCompany?.id
        ? `${webhookUrl}?company_id=${myCompany.id}`
        : webhookUrl;
      const fbVerifyToken = myCompany?.id ? `fb_leads_${myCompany.id}` : 'fb_leads_YOUR_COMPANY_ID';
      const instructions = integration.id === 'facebook_leads'
        ? `📋 Facebook Lead Ads Setup:\n\n1. Copy this webhook URL:\n${fbWebhookUrl}\n\n2. Go to Facebook Business Manager → Lead Ads → Webhooks\n\n3. Paste URL and set verify token: ${fbVerifyToken}\n\n4. Subscribe to "leadgen" events\n\n✅ Done! Leads will auto-sync to CRM`
        : integration.id === 'tiktok_leads'
        ? `📋 TikTok Lead Ads Setup:\n\n1. Copy this webhook URL:\n${webhookUrl}\n\n2. Go to TikTok Ads Manager → Tools → Events → Lead Generation\n\n3. Add webhook URL\n\n✅ Leads auto-import to CRM!`
        : `📋 Setup:\n\nWebhook URL:\n${webhookUrl}\n\nAdd this to your ${integration.name} settings`;
      
      const copyUrl = integration.id === 'facebook_leads' ? fbWebhookUrl : webhookUrl;
      navigator.clipboard.writeText(copyUrl).then(() => {
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
    if (!fileName.endsWith('.csv') && !fileName.endsWith('.plx') && !fileName.endsWith('.pdf')) {
      alert('❌ Please upload a .csv, .plx, or .pdf file');
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

  const handlePdfImport = async () => {
    if (!uploadedFileUrl) {
      alert('Please upload a PDF file first.');
      return;
    }
    if (!window.confirm('🤖 AI will scan this PDF and extract all Xactimate price list items.\n\nThis replaces your existing Xactimate items and may take 30–90 seconds. Continue?')) return;
    setIsPdfImporting(true);
    setImportError(null);
    try {
      const { data } = await base44.functions.invoke('importXactimatePdf', {
        fileUrl: uploadedFileUrl,
        company_id: myCompany?.id,
        source: 'Xactimate',
        merge: pdfImportMode === 'merge',
      });
      if (!data?.jobId) {
        alert(`❌ PDF import failed:\n\n${data?.error || 'Could not start import'}`);
        return;
      }
      // Poll job status every 4s (large PDFs can take several minutes)
      const jobId = data.jobId;
      const started = Date.now();
      while (true) {
        await new Promise((r) => setTimeout(r, 4000));
        if (Date.now() - started > 15 * 60 * 1000) {
          alert('❌ PDF import timed out after 15 minutes. Please try again or use CSV.');
          return;
        }
        let status;
        try {
          status = (await base44.functions.invoke('getPdfImportStatus', { jobId }))?.data;
        } catch {
          continue; // transient poll error — keep going
        }
        if (status?.progress) setPdfImportProgress(status.progress);
        if (status?.status === 'done') {
          alert(`✅ ${pdfImportMode === 'merge' ? 'Merged' : 'Imported'} ${status.imported} items from PDF!`);
          queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
          return;
        }
        if (status?.status === 'failed') {
          alert(`❌ PDF import failed:\n\n${status.error || 'Unknown error'}`);
          return;
        }
        if (status?.status === 'not_found') {
          alert('❌ PDF import job was lost (server restarted?). Please try again.');
          return;
        }
      }
    } catch (err) {
      alert('❌ PDF import failed: ' + err.message);
      setImportError(err.message);
    } finally {
      setIsPdfImporting(false);
    }
  };

  const handleDeleteAllCustomItems = async () => {
    if (!window.confirm(`Delete all ${customItems.length} custom items? This cannot be undone.`)) {
      return;
    }

    try {
      queryClient.setQueryData(['price-list-items'], (oldData) => oldData.filter(item => item.source !== 'Custom'));

      await base44.entities.PriceListItem.bulkDelete(customItems.map(item => item.id));

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
  // Execute the actual Symbility SOAP import (called directly or from dialog confirm)
  const doSymbilityImport = async () => {
    setIsImportingSymbility(true);
    try {
      const response = await base44.functions.invoke('importSymbilityPricing', {
        orgId: symbilityForm.org_id,
        username: symbilityForm.username,
        password: symbilityForm.password,
        apiKey: symbilityForm.api_key,
        soapUrl: symbilityForm.soap_url,
      });
      if (response.data.success) {
        alert(`✅ SUCCESS!\n\nImported ${response.data.imported} Symbility items!`);
        queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
      } else {
        alert('❌ Import failed:\n\n' + response.data.error);
      }
    } catch (error) {
      alert('❌ Import failed:\n\n' + error.message);
    } finally {
      setIsImportingSymbility(false);
    }
  };

  const handleImportSymbility = async () => {
    if (!symbilitySetting?.is_enabled) {
      alert('❌ Please test connection first and ensure Symbility is enabled');
      return;
    }

    // Show override confirmation if existing items are present
    if (symbilityItems.length > 0) {
      setImportConfirm({ type: 'symbility', source: 'Symbility', existingCount: symbilityItems.length, newCount: null });
      return;
    }

    await doSymbilityImport();
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
    <div className="p-3 sm:p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
          <Plug className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Price Lists</h1>
          <p className="text-gray-500 mt-1">Import and manage your pricing sources.</p>
        </div>
      </div>

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
                    <strong>Format 2 (Xactimate Space-separated):</strong> Description UNIT QTY REMOVE REPLACE TAX TOTAL (e.g., `3 tab - 25 yr. - composition shingle SQ 0.00 312.25 0.00 0.00 roofing - incl. felt`)
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
                  {/* Prominent destination badge */}
                  <div className="mt-3 flex items-center gap-2 rounded-lg border-2 border-orange-300 bg-orange-50 px-4 py-2">
                    <AlertCircle className="w-4 h-4 text-orange-500 flex-shrink-0" />
                    <span className="text-sm text-orange-900">
                      Importing into:{' '}
                      <strong className="font-bold">{pasteSource === 'BuildingCodes' ? 'Building Codes' : pasteSource}</strong>
                    </span>
                  </div>
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

Example Xactimate Space-separated Format:
3 tab - 25 yr. - composition shingle SQ 0.00 312.25 0.00 0.00 roofing - incl. felt
Ridge cap - 30 yr. - composition shingle LF 0.00 5.25 0.00 0.00
Remove and replace 3 tab - 25 yr. composition shingle roofing SQ 1.00 312.25 0.00 0.00`}
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
                  <Label>Upload Xactimate File (CSV/PLX/PDF, Max 50MB)</Label>
                  <Input
                    type="file"
                    accept=".csv,.plx,.pdf"
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
                      <strong>✅ File Ready!</strong>{' '}
                      {csvFile?.name?.toLowerCase().endsWith('.pdf')
                        ? 'Click "Import PDF (AI)" to extract all price list items.'
                        : 'Click the button below to import the CSV data into your price list.'}
                    </AlertDescription>
                  </Alert>

                  {csvFile?.name?.toLowerCase().endsWith('.pdf') ? (
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <label className={`flex-1 flex items-center gap-2 border rounded-lg p-3 cursor-pointer transition-colors ${pdfImportMode === 'replace' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          <input type="radio" name="pdfImportMode" value="replace" checked={pdfImportMode === 'replace'} onChange={() => setPdfImportMode('replace')} className="accent-purple-600" />
                          <div>
                            <p className="text-sm font-medium">Replace</p>
                            <p className="text-xs text-gray-500">Clear existing items first</p>
                          </div>
                        </label>
                        <label className={`flex-1 flex items-center gap-2 border rounded-lg p-3 cursor-pointer transition-colors ${pdfImportMode === 'merge' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          <input type="radio" name="pdfImportMode" value="merge" checked={pdfImportMode === 'merge'} onChange={() => setPdfImportMode('merge')} className="accent-purple-600" />
                          <div>
                            <p className="text-sm font-medium">Merge</p>
                            <p className="text-xs text-gray-500">Add to existing items</p>
                          </div>
                        </label>
                      </div>
                      <Button
                        onClick={handlePdfImport}
                        disabled={isPdfImporting}
                        className="w-full bg-purple-600 hover:bg-purple-700"
                      >
                        {isPdfImporting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {pdfImportProgress || 'Starting PDF extraction…'}
                          </>
                        ) : (
                          <>🤖 Import PDF (AI)</>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}

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
                    <BulkDeleteButton
                      variant="destructive"
                      size="sm"
                      onClick={handleDeleteAllCustomItems}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete All
                    </BulkDeleteButton>
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
                  <Label>Upload Xactimate File (CSV / PLX / PDF, Max 50MB)</Label>
                  <Input
                    type="file"
                    accept=".csv,.plx,.pdf"
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
                      <strong>✅ File Ready!</strong> {csvFile?.name?.toLowerCase().endsWith('.pdf') ? 'Click "Import PDF (AI)" to extract price list items.' : 'Click below to import into Xactimate price list.'}
                    </AlertDescription>
                  </Alert>

                  {csvFile?.name?.toLowerCase().endsWith('.pdf') ? (
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <label className={`flex-1 flex items-center gap-2 border rounded-lg p-3 cursor-pointer transition-colors ${pdfImportMode === 'replace' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          <input type="radio" name="pdfImportMode" value="replace" checked={pdfImportMode === 'replace'} onChange={() => setPdfImportMode('replace')} className="accent-purple-600" />
                          <div>
                            <p className="text-sm font-medium">Replace</p>
                            <p className="text-xs text-gray-500">Clear existing Xactimate items first</p>
                          </div>
                        </label>
                        <label className={`flex-1 flex items-center gap-2 border rounded-lg p-3 cursor-pointer transition-colors ${pdfImportMode === 'merge' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          <input type="radio" name="pdfImportMode" value="merge" checked={pdfImportMode === 'merge'} onChange={() => setPdfImportMode('merge')} className="accent-purple-600" />
                          <div>
                            <p className="text-sm font-medium">Merge</p>
                            <p className="text-xs text-gray-500">Add to existing items</p>
                          </div>
                        </label>
                      </div>
                      <Button
                        onClick={handlePdfImport}
                        disabled={isPdfImporting}
                        className="w-full bg-purple-600 hover:bg-purple-700"
                      >
                        {isPdfImporting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {pdfImportProgress || 'Starting PDF extraction…'}
                          </>
                        ) : (
                          <>🤖 Import PDF (AI)</>
                        )}
                      </Button>
                    </div>
                  ) : (
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
                  )}
                </div>
              )}

              {xactimateItems.length > 0 && (
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">Loaded Items</h3>
                      <p className="text-sm text-gray-500">{xactimateItems.length} Xactimate items</p>
                    </div>
                    <BulkDeleteButton
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        if (!window.confirm(`Delete all ${xactimateItems.length} Xactimate items? This cannot be undone.`)) {
                          return;
                        }
                        try {
                          await base44.entities.PriceListItem.bulkDelete(xactimateItems.map(item => item.id));
                          alert('✅ All Xactimate items deleted');
                          queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
                        } catch (error) {
                          alert('Delete failed: ' + error.message);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete All
                    </BulkDeleteButton>
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
                <Sparkles className="w-5 h-5 text-purple-600" />
                Symbility Integration
              </CardTitle>
              <CardDescription>
                Connect your Symbility account to import pricing directly into your estimates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {symbilitySetting?.is_enabled && (
                <Alert className="bg-green-50 border-green-200">
                  <Check className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-green-700">
                    Symbility is connected and active — {symbilityItems.length} items imported
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Organization ID</label>
                  <Input
                    placeholder="Your Symbility Organization ID"
                    value={symbilityForm.org_id}
                    onChange={(e) => setSymbilityForm(prev => ({ ...prev, org_id: e.target.value }))}
                    data-testid="input-symbility-org-id"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">API Key</label>
                  <Input
                    placeholder="Your Symbility API Key"
                    value={symbilityForm.api_key}
                    onChange={(e) => setSymbilityForm(prev => ({ ...prev, api_key: e.target.value }))}
                    data-testid="input-symbility-api-key"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Username</label>
                  <Input
                    placeholder="Symbility username"
                    value={symbilityForm.username}
                    onChange={(e) => setSymbilityForm(prev => ({ ...prev, username: e.target.value }))}
                    data-testid="input-symbility-username"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Password</label>
                  <Input
                    type="password"
                    placeholder="Symbility password"
                    value={symbilityForm.password}
                    onChange={(e) => setSymbilityForm(prev => ({ ...prev, password: e.target.value }))}
                    data-testid="input-symbility-password"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">SOAP URL</label>
                <Input
                  placeholder="https://soap.symbility.com/services"
                  value={symbilityForm.soap_url}
                  onChange={(e) => setSymbilityForm(prev => ({ ...prev, soap_url: e.target.value }))}
                  data-testid="input-symbility-soap-url"
                />
                <p className="text-xs text-gray-400">Default: https://soap.symbility.com/services (usually no need to change)</p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleTestSymbility}
                  disabled={isTestingSymbility || !symbilityForm.org_id || !symbilityForm.api_key || !symbilityForm.username || !symbilityForm.password}
                  variant="outline"
                  data-testid="button-test-symbility"
                >
                  {isTestingSymbility ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing...</> : 'Test Connection'}
                </Button>
                <Button
                  onClick={handleImportSymbility}
                  disabled={isImportingSymbility || !symbilitySetting?.is_enabled}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  data-testid="button-import-symbility"
                >
                  {isImportingSymbility ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</> : 'Import Price List'}
                </Button>
              </div>

              {!symbilitySetting?.is_enabled && (
                <p className="text-sm text-gray-500">Enter your credentials above and click "Test Connection" first. Once connected, you can import your full price list.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
        <CardContent className="p-3 sm:p-6">
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

      {/* ── Merge / Override confirmation dialog (paste import + Symbility SOAP) ── */}
      <Dialog open={!!importConfirm} onOpenChange={(open) => { if (!open) setImportConfirm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-orange-500" />
              Import {importConfirm?.source} items
            </DialogTitle>
            <DialogDescription className="text-base pt-2">
              You already have <strong>{importConfirm?.existingCount}</strong> existing{' '}
              <strong>{importConfirm?.source}</strong> items.{' '}
              {importConfirm?.newCount != null
                ? <>This file has <strong>{importConfirm.newCount}</strong> new items.</>
                : null
              }
            </DialogDescription>
          </DialogHeader>

          {/* Prominent source reminder */}
          <div className="flex items-center gap-2 rounded-lg border-2 border-orange-300 bg-orange-50 px-4 py-2 -mt-1">
            <AlertCircle className="w-4 h-4 text-orange-500 flex-shrink-0" />
            <span className="text-sm text-orange-900">
              Destination: <strong className="font-bold">{importConfirm?.source}</strong>
            </span>
          </div>

          {/* Sanity-check: first parsed item */}
          {importConfirm?.items?.[0] && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-700">
              <span className="font-medium text-gray-500">First item parsed — does this look right?</span>
              <p className="mt-1 font-mono truncate">{importConfirm.items[0].description}</p>
              <p className="text-gray-500">{importConfirm.items[0].unit} · ${importConfirm.items[0].price?.toFixed(2)} · {importConfirm.items[0].category}</p>
            </div>
          )}

          <div className="space-y-3 py-1">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="font-medium text-blue-900 text-sm">Merge — add to existing</p>
              <p className="text-blue-700 text-xs mt-1">New items are added alongside your existing ones. Items that share a code with an existing item are skipped. Use this when your price list spans multiple files.</p>
            </div>
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="font-medium text-orange-900 text-sm">Override — replace all</p>
              <p className="text-orange-700 text-xs mt-1">All existing <strong>{importConfirm?.source}</strong> items are deleted first, then the new ones are saved. Starred favorites are re-applied by item code.</p>
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <Button variant="outline" onClick={() => setImportConfirm(null)}>
              Cancel
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={async () => {
                const confirmed = importConfirm;
                setImportConfirm(null);
                if (confirmed.type === 'paste') {
                  await doActualPasteImport(confirmed.items, confirmed.source, confirmed.errors || [], true);
                } else if (confirmed.type === 'symbility') {
                  await doSymbilityImport(true);
                }
              }}
            >
              Merge
            </Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={async () => {
                const confirmed = importConfirm;
                setImportConfirm(null);
                if (confirmed.type === 'paste') {
                  await doActualPasteImport(confirmed.items, confirmed.source, confirmed.errors || [], false);
                } else if (confirmed.type === 'symbility') {
                  await doSymbilityImport(false);
                }
              }}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Override
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}