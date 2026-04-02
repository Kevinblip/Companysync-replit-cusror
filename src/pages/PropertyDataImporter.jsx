import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  Upload, 
  FileSpreadsheet, 
  Users, 
  Download,
  ExternalLink,
  CheckCircle,
  MapPin,
  Building2,
  Plus,
  X,
  Phone,
  Loader2,
  Zap
} from "lucide-react";
import PropertyDataSpecialist from "@/components/property/PropertyDataSpecialist";
import CountyGuideCard from "@/components/property/CountyGuideCard";

export default function PropertyDataImporter() {
  const [file, setFile] = useState(null);
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [stormContext, setStormContext] = useState("");
  const [user, setUser] = useState(null);
  const [customCounties, setCustomCounties] = useState([
    {
      county: "Richland County, OH",
      url: "https://richlandcountyoh.us/auditor/",
      instructions: "Go to Property Search → Download Property Records"
    },
    {
      county: "Ashland County, OH",
      url: "https://www.ashlandcountyauditor.org/",
      instructions: "Navigate to Parcel Search → Export Results"
    },
    {
      county: "Wayne County, OH",
      url: "https://www.waynecountyauditor.org/",
      instructions: "Property Search → Download CSV"
    },
    {
      county: "Knox County, OH",
      url: "https://knoxcountyauditor.org/",
      instructions: "Property Data → Export to Excel"
    }
  ]);
  const [newCounty, setNewCounty] = useState("");
  const [enrichedResults, setEnrichedResults] = useState(null);
  const [isEnriching, setIsEnriching] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: alertSettings = [] } = useQuery({
    queryKey: ['storm-alert-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StormAlertSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const currentSettings = alertSettings[0];

  const { data: usageData = [] } = useQuery({
    queryKey: ['subscription-usage', myCompany?.id],
    queryFn: () => {
      if (!myCompany) return [];
      const currentMonth = new Date().toISOString().slice(0, 7);
      return base44.entities.SubscriptionUsage.filter({
        company_id: myCompany.id,
        feature: 'skip_tracing',
        usage_month: currentMonth
      });
    },
    enabled: !!myCompany,
    initialData: [],
  });

  const usageRecord = usageData[0];
  
  const planLimits = {
    trial: 10,
    starter: 100,
    professional: 500,
    enterprise: 99999
  };
  
  const monthlyLimit = planLimits[myCompany?.subscription_plan] || 10;
  const creditsUsed = usageRecord?.credits_used || 0;
  const creditsRemaining = monthlyLimit - creditsUsed;

  const handleFileUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (uploadedFile) {
      setFile(uploadedFile);
      const reader = new FileReader();
      reader.onload = (event) => {
        setCsvText(event.target.result);
      };
      reader.readAsText(uploadedFile);
    }
  };

  const handleImport = async () => {
    if (!csvText.trim()) {
      alert("Please upload a CSV file or paste property data");
      return;
    }

    setImporting(true);
    setResult(null);
    setEnrichedResults(null); // Clear previous enrichment results

    try {
      const response = await base44.functions.invoke('importPropertyData', {
        csvData: csvText,
        stormContext: stormContext
      });

      setResult(response.data);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      
      alert(`✅ Successfully imported ${response.data.leadsCreated} leads!`);
      
      // Clear form
      setCsvText("");
      setFile(null);
      setStormContext("");
    } catch (error) {
      console.error("Import error:", error);
      alert("Failed to import property data: " + error.message);
    }

    setImporting(false);
  };

  const handleEnrichWithPhones = async () => {
    if (!result || !result.leads || result.leads.length === 0) {
      alert("Please import property data first, then enrich with phone numbers.");
      return;
    }

    if (!myCompany?.subscription_plan) {
      alert("Subscription plan not found. Please refresh or contact support.");
      return;
    }

    if (creditsRemaining < result.leads.length) {
      alert(`❌ Not enough skip trace credits!\n\nYou need ${result.leads.length} credits but only have ${creditsRemaining} remaining this month.\n\nPlan: ${myCompany.subscription_plan}\nUsed: ${creditsUsed}/${monthlyLimit}\n\nUpgrade your plan or wait until next month.`);
      return;
    }

    if (!confirm(`Enrich ${result.leads.length} leads with phone numbers & emails?\n\nThis will use ${result.leads.length} skip trace credits.\nRemaining after: ${creditsRemaining - result.leads.length}/${monthlyLimit}\n\nCost estimate: ~$${(result.leads.length * 0.20).toFixed(2)} (Actual cost depends on your plan and provider fees).`)) {
      return;
    }

    setIsEnriching(true);
    setEnrichedResults(null);

    try {
      console.log('🔍 Enriching leads with phone numbers...');

      // Prepare addresses for skip tracing. Ensure all necessary fields are present.
      const addressesToTrace = result.leads.map(lead => ({
        street: lead.address || '', // Use lead.address if lead.street is not available
        city: lead.city || '',
        state: lead.state || 'OH', // Assuming Ohio as default if not provided by auditor data
        zip: lead.zip || '',
        leadId: lead.id // Pass lead ID for easier matching later
      })).filter(addr => addr.street && addr.city && addr.zip); // Only trace if minimal address data is present

      if (addressesToTrace.length === 0) {
        alert("No valid addresses found in the imported leads to perform skip tracing.");
        setIsEnriching(false);
        return;
      }

      const response = await base44.functions.invoke('bulkSkipTrace', {
        addresses: addressesToTrace,
        companyId: myCompany.id
      });

      console.log('✅ Skip trace response:', response.data);

      let updatedCount = 0;
      if (response.data && response.data.results) {
        for (const enrichedResult of response.data.results) {
          if (enrichedResult.success && enrichedResult.data && enrichedResult.leadId) {
            // Find the original lead by the leadId that was passed
            const leadToUpdate = result.leads.find(l => l.id === enrichedResult.leadId);

            if (leadToUpdate) {
              const phones = enrichedResult.data.phone_numbers || [];
              const emails = enrichedResult.data.emails || [];

              const updatePayload = {
                name: enrichedResult.data.full_name || leadToUpdate.name,
              };

              // Only update phone/email if the lead doesn't already have one or if the new data is better
              if (!leadToUpdate.phone && phones.length > 0) updatePayload.phone = phones[0];
              if (!leadToUpdate.phone_2 && phones.length > 1) updatePayload.phone_2 = phones[1];
              if (!leadToUpdate.email && emails.length > 0) updatePayload.email = emails[0];
              if (enrichedResult.data.estimated_value && (!leadToUpdate.value || leadToUpdate.value === 0)) {
                updatePayload.value = enrichedResult.data.estimated_value;
              }

              if (Object.keys(updatePayload).length > 1) { // Check if there's anything beyond `name` to update
                await base44.entities.Lead.update(leadToUpdate.id, updatePayload);
                updatedCount++;
              }
            }
          }
        }
      }

      setEnrichedResults({
        total: response.data?.summary?.total || 0,
        successful: response.data?.summary?.successful || 0,
        failed: response.data?.summary?.failed || 0,
        updated: updatedCount
      });

      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });

      alert(`✅ Enrichment Complete!\n\n${updatedCount} leads updated with phone numbers & emails!\n\nCredits used: ${response.data?.usage?.used || 0}\nCredits remaining: ${response.data?.usage?.remaining || 0}/${response.data?.usage?.limit || 0}`);

    } catch (error) {
      console.error('❌ Enrichment error:', error);
      alert('Failed to enrich leads: ' + error.message);
    } finally {
      setIsEnriching(false);
    }
  };

  // Get counties from storm alert settings
  const serviceAreaCounties = (currentSettings?.service_areas || []).map(area => ({
    county: area,
    url: `https://www.google.com/search?q=${encodeURIComponent(area + ' auditor property records')}`,
    instructions: "Search for county auditor website → Property Search → Export CSV"
  }));

  // Combine custom counties with service areas
  const allCounties = [...customCounties, ...serviceAreaCounties];

  const handleAddCounty = () => {
    if (newCounty.trim()) {
      setCustomCounties([...customCounties, {
        county: newCounty.trim(),
        url: `https://www.google.com/search?q=${encodeURIComponent(newCounty.trim() + ' auditor property records')}`,
        instructions: "Search for county auditor → Property Records → Export"
      }]);
      setNewCounty("");
    }
  };

  const handleRemoveCounty = (index) => {
    // Only remove if the index corresponds to a county within the customCounties array
    // Service area counties (from settings) are not directly removable from here
    const isFromCustom = index < customCounties.length; 
    if (isFromCustom) {
      setCustomCounties(customCounties.filter((_, i) => i !== index));
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Building2 className="w-8 h-8 text-blue-600" />
          Property Data Importer
        </h1>
        <p className="text-gray-500 mt-1">Import REAL property owner data from county records (100% FREE)</p>
      </div>

      <Alert className="bg-blue-50 border-blue-200">
        <AlertDescription>
          <strong>💡 How This Works:</strong> Download property records from county auditor websites (free public data), 
          then upload the CSV here. We'll automatically create leads with real property owner information!
        </AlertDescription>
      </Alert>

      {/* AI Property Data Specialist */}
      <PropertyDataSpecialist myCompany={myCompany} />

      {/* County Guides */}
      <CountyGuideCard />

      {/* NEW: Skip Trace Credits Display */}
      {myCompany && (
        <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-purple-900">Skip Trace Credits (Phone Number Lookup)</p>
                <p className="text-sm text-purple-700 mt-1">
                  {creditsRemaining} of {monthlyLimit} credits remaining this month
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  Plan: <strong>{myCompany.subscription_plan}</strong> • Resets monthly
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-purple-600">{creditsRemaining}</p>
                <p className="text-xs text-gray-500">credits left</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* County Resources */}
      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              County Property Record Sources (FREE)
            </CardTitle>
            {currentSettings && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = '/storm-alert-settings'}
              >
                Add More Counties
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {/* Add Custom County */}
          <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <Label className="font-semibold mb-2 block">Add Your County</Label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g., Summit County, OH or Cuyahoga County, OH"
                value={newCounty}
                onChange={(e) => setNewCounty(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddCounty()}
              />
              <Button onClick={handleAddCounty}>
                <Plus className="w-4 h-4 mr-2" />
                Add
              </Button>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              💡 Add any county you service! We'll help you find their property records website.
            </p>
          </div>

          {/* Show counties from Storm Alert Settings */}
          {serviceAreaCounties.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Badge className="bg-green-100 text-green-700">From Your Service Areas</Badge>
                <p className="text-xs text-gray-500">(Set in Storm Alert Settings)</p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {allCounties.map((resource, idx) => (
              <div key={idx} className="flex items-start justify-between p-4 border rounded-lg hover:bg-gray-50">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{resource.county}</h3>
                  <p className="text-sm text-gray-600 mt-1">{resource.instructions}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(resource.url, '_blank')}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Visit Site
                  </Button>
                  {/* Only show remove button for counties that are part of the customCounties state */}
                  {idx < customCounties.length && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveCounty(idx)}
                      title="Remove county"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {allCounties.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <MapPin className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No counties added yet</p>
              <p className="text-sm mt-1">Add your first county above to get started!</p>
            </div>
          )}

          <Alert className="mt-6 bg-green-50 border-green-200">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription>
              <strong>Pro Tip:</strong> After a storm, go to the county website for affected areas, 
              filter properties by zip code (e.g., 44903, 44906), and download all property records as CSV.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Import Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload */}
        <Card className="bg-white shadow-md">
          <CardHeader className="border-b bg-gray-50">
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Property Data
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div>
              <Label>Step 1: Storm Context (Optional)</Label>
              <Input
                placeholder="e.g., Hail storm in Mansfield on Jan 15, 2024"
                value={stormContext}
                onChange={(e) => setStormContext(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">This will be added to lead notes</p>
            </div>

            <div>
              <Label>Step 2: Upload CSV File</Label>
              <div className="mt-2 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">
                    {file ? file.name : 'Click to upload CSV file'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    CSV, XLS, or XLSX from county auditor
                  </p>
                </label>
              </div>
            </div>

            <div className="text-center text-gray-500 text-sm">— OR —</div>

            <div>
              <Label>Paste CSV Data Directly</Label>
              <Textarea
                placeholder="Paste property data here (CSV format)&#10;&#10;Owner Name, Address, City, Zip, Phone&#10;John Smith, 123 Main St, Mansfield, 44903, 419-555-1234"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={8}
                className="font-mono text-xs"
              />
            </div>

            <Button
              onClick={handleImport}
              disabled={importing || !csvText.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              <Users className="w-4 h-4 mr-2" />
              {importing ? 'Importing...' : 'Import Property Data'}
            </Button>

            {/* NEW: Enrich with Phone Numbers Button */}
            {result && result.leadsCreated > 0 && (
              <div className="pt-4 border-t">
                <Alert className="bg-green-50 border-green-200 mb-4">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <AlertDescription>
                    <strong>✅ {result.leadsCreated} leads imported!</strong><br/>
                    <span className="text-sm">Now enrich them with phone numbers & emails below.</span>
                  </AlertDescription>
                </Alert>

                <Button
                  onClick={handleEnrichWithPhones}
                  disabled={isEnriching || creditsRemaining < result.leadsCreated || !myCompany?.subscription_plan}
                  className="w-full bg-purple-600 hover:bg-purple-700"
                >
                  {isEnriching ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enriching {result.leadsCreated} leads...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      Get Phone Numbers ({result.leadsCreated} credits)
                    </>
                  )}
                </Button>
                
                <p className="text-xs text-center text-gray-500 mt-2">
                  {myCompany?.subscription_plan && creditsRemaining >= result.leadsCreated 
                    ? `Will use ${result.leadsCreated} of your ${creditsRemaining} remaining credits`
                    : myCompany?.subscription_plan && `⚠️ Need ${result.leadsCreated - creditsRemaining} more credits - upgrade plan`}
                </p>
              </div>
            )}

            {enrichedResults && (
              <Alert className="bg-purple-50 border-purple-200">
                <Phone className="w-4 h-4 text-purple-600" />
                <AlertDescription>
                  <strong>📞 Enrichment Complete!</strong><br/>
                  ✅ {enrichedResults.updated} leads updated with phone numbers<br/>
                  ⚠️ {enrichedResults.failed} addresses had no phone data available<br/>
                  <br/>
                  <a href="/leads" className="text-blue-600 hover:underline text-sm font-semibold">
                    → View Enriched Leads
                  </a>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card className="bg-white shadow-md">
          <CardHeader className="border-b bg-gray-50">
            <CardTitle>CSV Format Guide</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Required Columns:</h3>
              <ul className="space-y-1 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span><strong>Owner Name</strong> (required)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span><strong>Address</strong> (required)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                  <span><strong>City</strong> (optional)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                  <span><strong>Zip Code</strong> (optional)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                  <span><strong>Phone</strong> (optional but recommended)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                  <span><strong>Email</strong> (optional)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                  <span><strong>Property Value</strong> (optional)</span>
                </li>
              </ul>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-semibold mb-2 text-sm">Example CSV:</h3>
              <pre className="text-xs overflow-x-auto">
{`Owner Name,Address,City,Zip,Phone
John Smith,123 Oak St,Mansfield,44903,419-555-1234
Mary Johnson,456 Elm Ave,Mansfield,44906,419-555-5678`}
              </pre>
            </div>

            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertDescription className="text-sm">
                <strong>📞 No Phone Numbers?</strong> That's OK! The system will still create leads. 
                You can use reverse lookup or door-to-door canvassing for these properties.
              </AlertDescription>
            </Alert>

            {result && !enrichedResults && ( // Only show import result if not followed by enrichment
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <AlertDescription>
                  <strong>Import Complete!</strong><br/>
                  ✅ {result.leadsCreated} leads created<br/>
                  ⏭️ {result.skipped} skipped (duplicates)<br/>
                  ❌ {result.errors} errors
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Workflow Guide */}
      <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200">
        <CardHeader>
          <CardTitle>🚀 Complete Storm Lead Workflow (FREE Method)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold">1</div>
            <div>
              <strong>Storm hits Mansfield</strong> - You get alert from Storm Tracking
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold">2</div>
            <div>
              <strong>Identify affected zip codes</strong> - e.g., 44903, 44906, 44907
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold">3</div>
            <div>
              <strong>Go to Richland County Auditor website</strong> - Filter properties by zip code
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold">4</div>
            <div>
              <strong>Download CSV</strong> - Export all property records (100-500 properties)
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold">5</div>
            <div>
              <strong>Upload here</strong> - Instant lead creation with real owner names/addresses
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold">6</div>
            <div>
              <strong>Start calling/mailing</strong> - You have REAL property owners to contact!
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}