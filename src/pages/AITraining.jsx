import React, { useState, useEffect } from "react";
import useTranslation from "@/hooks/useTranslation";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  Globe,
  FileText,
  Brain,
  CheckCircle,
  Loader2,
  Trash2,
  Phone,
  MessageSquare,
  Mic,
  Calculator,
  TrendingUp,
  Building2,
  AlertCircle,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AITraining() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [uploadType, setUploadType] = useState("website");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  const [competitorCompanyName, setCompetitorCompanyName] = useState("");
  const [competitorDate, setCompetitorDate] = useState(new Date().toISOString().split("T")[0]);
  const [competitorJobType, setCompetitorJobType] = useState("");
  const [competitorTextContent, setCompetitorTextContent] = useState("");
  const [competitorFileUploaded, setCompetitorFileUploaded] = useState(null);
  const [expandedItems, setExpandedItems] = useState({});

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

  const { data: profile = [] } = useQuery({
    queryKey: ['company-profile', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CompanyProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: trainingData = [] } = useQuery({
    queryKey: ['training-data', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.AITrainingData.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createTrainingMutation = useMutation({
    mutationFn: (data) => base44.entities.AITrainingData.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-data'] });
      setWebsiteUrl("");
      setTextContent("");
      setTitle("");
      setCompetitorCompanyName("");
      setCompetitorDate(new Date().toISOString().split("T")[0]);
      setCompetitorJobType("");
      setCompetitorTextContent("");
      setCompetitorFileUploaded(null);
      setLoading(false);
    },
  });

  const deleteTrainingMutation = useMutation({
    mutationFn: (id) => base44.entities.AITrainingData.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-data'] });
    },
  });

  const handleImportWebsite = async () => {
    if (!websiteUrl || !myCompany) return;
    setLoading(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Visit this website: ${websiteUrl}
        
Extract and summarize:
1. What services/products they offer
2. Their target customers
3. Their sales process/approach
4. Key terminology they use
5. Any unique aspects of their business
6. Common questions customers ask
7. Pricing information (if available)

Format as structured text that can be used to train an AI assistant.`,
        add_context_from_internet: true
      });

      createTrainingMutation.mutate({
        company_id: myCompany.id,
        data_type: "website",
        title: `Website Import: ${websiteUrl}`,
        content: typeof response === 'string' ? response : JSON.stringify(response),
        source_url: websiteUrl,
        is_active: true,
        priority: 10
      });
    } catch (error) {
      alert("Failed to import website: " + error.message);
      setLoading(false);
    }
  };

  const handleUploadText = () => {
    if (!title || !textContent || !myCompany) return;
    createTrainingMutation.mutate({
      company_id: myCompany.id,
      data_type: "text",
      title: title,
      content: textContent,
      is_active: true,
      priority: 5
    });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !myCompany) return;
    setLoading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Read this PDF and extract all useful information that would help an AI assistant understand this business. Include services, processes, terminology, and any other relevant details.`,
        file_urls: [file_url]
      });
      createTrainingMutation.mutate({
        company_id: myCompany.id,
        data_type: "pdf",
        title: file.name,
        content: typeof response === 'string' ? response : JSON.stringify(response),
        file_url: file_url,
        is_active: true,
        priority: 8
      });
    } catch (error) {
      alert("Failed to upload file: " + error.message);
    }
    setLoading(false);
  };

  const handleCompetitorFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !myCompany) return;
    setLoading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `This is a competitor roofing estimate or bid document. Extract ALL of the following and format as structured text:

1. Competitor company name (if visible)
2. Date of the estimate
3. Job address or description
4. Every single line item with: description, quantity, unit, unit price, total price
5. Any materials called out (shingle brand/type, underlayment, flashing, etc.)
6. Labor charges broken out separately if listed
7. Subtotal, taxes, and grand total
8. Any warranties, guarantees, or notable terms mentioned
9. What is NOT included (exclusions)
10. Payment terms

Label each section clearly. This will be used by our AI to compare our pricing against competitors.`,
        file_urls: [file_url]
      });
      const extractedText = typeof response === 'string' ? response : JSON.stringify(response);
      setCompetitorTextContent(extractedText);
      setCompetitorFileUploaded(file.name);
    } catch (error) {
      alert("Failed to process competitor estimate: " + error.message);
    }
    setLoading(false);
  };

  const handleSaveCompetitorEstimate = () => {
    if (!competitorCompanyName || !competitorTextContent || !myCompany) return;
    const label = competitorJobType
      ? `${competitorCompanyName} — ${competitorJobType} (${competitorDate})`
      : `${competitorCompanyName} (${competitorDate})`;
    createTrainingMutation.mutate({
      company_id: myCompany.id,
      data_type: "competitor_estimate",
      title: label,
      content: `COMPETITOR ESTIMATE\nCompany: ${competitorCompanyName}\nDate: ${competitorDate}\nJob Type: ${competitorJobType || "Not specified"}\n\n${competitorTextContent}`,
      is_active: true,
      priority: 8
    });
  };

  const toggleExpand = (id) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const regularData = trainingData.filter(d => d.data_type !== "competitor_estimate");
  const competitorData = trainingData.filter(d => d.data_type === "competitor_estimate");

  if (!myCompany) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-gray-500">
          {t.dashboard.setupCompany}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.aiMemory}</h1>
        <p className="text-gray-500 mt-1">
          {t.ai.aiAssistant} Knowledge Base
        </p>
      </div>

      <Alert className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
        <Brain className="w-5 h-5 text-purple-600" />
        <AlertDescription>
          <div className="space-y-2">
            <p className="font-semibold text-purple-900">🧠 What is {t.sidebar.aiMemory}?</p>
            <p className="text-sm text-purple-800 mb-2">
              This is the shared brain for all your AI assistants. Upload your website, price lists, service guides, competitor estimates, and other documents here. 
              Sarah, Lexi, Marcus, and the AI Estimator will use this information to answer questions, generate estimates, and write better copy.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-green-600" />
                <span>Answers incoming calls with natural voice</span>
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-600" />
                <span>Responds to incoming SMS intelligently</span>
              </div>
              <div className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-orange-600" />
                <span>Powers the AI Estimator with your pricing</span>
              </div>
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-purple-600" />
                <span>Uses ElevenLabs natural voice</span>
              </div>
            </div>
          </div>
        </AlertDescription>
      </Alert>

      <Card className="bg-gradient-to-r from-blue-50 to-purple-50">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Brain className="w-8 h-8 text-blue-600" />
              <div>
                <h3 className="font-semibold text-lg">{t.common.status}</h3>
                <p className="text-sm text-gray-600">
                  {trainingData.length} training materials uploaded
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs bg-green-50 text-green-700">🤖 {t.ai.sarah} (Voice & SMS)</Badge>
                  <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700">💬 {t.ai.lexi} (Chat)</Badge>
                  <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700">🔢 AI Estimator</Badge>
                  <Badge variant="outline" className="text-xs bg-red-50 text-red-700">✍️ Marcus (Copy)</Badge>
                </div>
              </div>
            </div>
            <Badge className={
              trainingData.length > 0 ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
            }>
              {trainingData.length > 0 ? "✅ Trained" : "⚠️ Not Trained Yet"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Button
          data-testid="btn-upload-website"
          variant={uploadType === "website" ? "default" : "outline"}
          className="h-auto py-6 flex-col gap-2"
          onClick={() => setUploadType("website")}
        >
          <Globe className="w-6 h-6" />
          <span>{t.common.import} Website</span>
        </Button>
        <Button
          data-testid="btn-upload-pdf"
          variant={uploadType === "pdf" ? "default" : "outline"}
          className="h-auto py-6 flex-col gap-2"
          onClick={() => setUploadType("pdf")}
        >
          <Upload className="w-6 h-6" />
          <span>{t.common.upload} PDF</span>
        </Button>
        <Button
          data-testid="btn-upload-text"
          variant={uploadType === "text" ? "default" : "outline"}
          className="h-auto py-6 flex-col gap-2"
          onClick={() => setUploadType("text")}
        >
          <FileText className="w-6 h-6" />
          <span>{t.common.add} Text</span>
        </Button>
        <Button
          data-testid="btn-upload-competitor"
          variant={uploadType === "competitor" ? "default" : "outline"}
          className={`h-auto py-6 flex-col gap-2 ${uploadType === "competitor" ? "bg-orange-600 hover:bg-orange-700 border-orange-600" : "border-orange-300 text-orange-700 hover:bg-orange-50"}`}
          onClick={() => setUploadType("competitor")}
        >
          <TrendingUp className="w-6 h-6" />
          <span>Competitor Estimate</span>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {uploadType === "website" && `${t.common.import} from ${t.common.web}`}
            {uploadType === "pdf" && `${t.common.upload} PDF Document`}
            {uploadType === "text" && `${t.common.add} Text Content`}
            {uploadType === "competitor" && "Upload Competitor Estimate"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {uploadType === "website" && (
            <>
              <div>
                <Label>{t.common.web} URL</Label>
                <Input
                  data-testid="input-website-url"
                  placeholder="https://yourcompany.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t.ai.aiAssistant} will visit your website and extract key information
                </p>
              </div>
              <Button
                data-testid="btn-import-website"
                onClick={handleImportWebsite}
                disabled={!websiteUrl || loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t.common.loading}
                  </>
                ) : (
                  <>
                    <Globe className="w-4 h-4 mr-2" />
                    {t.common.import} Website
                  </>
                )}
              </Button>
            </>
          )}

          {uploadType === "pdf" && (
            <>
              <div>
                <Label>{t.common.upload} PDF File</Label>
                <Input
                  data-testid="input-pdf-file"
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={handleFileUpload}
                  disabled={loading}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Upload service guides, manuals, or process documents
                </p>
              </div>
              {loading && (
                <div className="flex items-center gap-2 text-blue-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t.common.loading}</span>
                </div>
              )}
            </>
          )}

          {uploadType === "text" && (
            <>
              <div>
                <Label>{t.common.name}</Label>
                <Input
                  data-testid="input-text-title"
                  placeholder="e.g., Our Service Process"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div>
                <Label>{t.common.description}</Label>
                <Textarea
                  data-testid="input-text-content"
                  placeholder="Paste or type your content here... (FAQs, service descriptions, processes, pricing info, etc.)"
                  rows={8}
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                />
              </div>
              <Button
                data-testid="btn-add-text"
                onClick={handleUploadText}
                disabled={!title || !textContent || loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <FileText className="w-4 h-4 mr-2" />
                {t.common.add} Training Data
              </Button>
            </>
          )}

          {uploadType === "competitor" && (
            <>
              <Alert className="border-orange-200 bg-orange-50">
                <AlertCircle className="w-4 h-4 text-orange-600" />
                <AlertDescription className="text-sm text-orange-800">
                  Upload competitor estimates (PDFs, images) or paste the details manually. The AI will extract all line items and pricing so you can compare against your own estimates.
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Competitor Company Name *</Label>
                  <Input
                    data-testid="input-competitor-name"
                    placeholder="e.g., ABC Roofing, Smith's Exteriors"
                    value={competitorCompanyName}
                    onChange={(e) => setCompetitorCompanyName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Estimate Date</Label>
                  <Input
                    data-testid="input-competitor-date"
                    type="date"
                    value={competitorDate}
                    onChange={(e) => setCompetitorDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label>Job Type (optional)</Label>
                <Input
                  data-testid="input-competitor-job-type"
                  placeholder="e.g., 3-tab shingle residential, metal roof, flat commercial"
                  value={competitorJobType}
                  onChange={(e) => setCompetitorJobType(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">Helps the AI compare apples-to-apples when generating similar estimates</p>
              </div>

              <div className="border-2 border-dashed border-orange-300 rounded-lg p-4 bg-orange-50">
                <Label className="flex items-center gap-2 mb-2">
                  <Upload className="w-4 h-4 text-orange-600" />
                  Upload Estimate File (PDF, JPG, PNG) — Optional
                </Label>
                <p className="text-xs text-gray-600 mb-3">
                  The AI will read the file and extract all line items, quantities, and prices automatically.
                  Or skip this and paste the details manually below.
                </p>
                <input
                  data-testid="input-competitor-file"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleCompetitorFileUpload}
                  disabled={loading}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-orange-600 file:text-white hover:file:bg-orange-700 cursor-pointer"
                />
                {loading && (
                  <div className="mt-3 flex items-center gap-2 text-orange-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Extracting line items from file...</span>
                  </div>
                )}
                {competitorFileUploaded && (
                  <div className="mt-3 flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    <span>Extracted from: {competitorFileUploaded} — review the text below before saving</span>
                  </div>
                )}
              </div>

              <div>
                <Label>Estimate Details *</Label>
                <Textarea
                  data-testid="input-competitor-content"
                  placeholder={`Paste the estimate details here, or they'll fill in automatically after uploading a file.\n\nInclude: line items, quantities, unit prices, total, materials used, any exclusions.`}
                  rows={10}
                  value={competitorTextContent}
                  onChange={(e) => setCompetitorTextContent(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>

              <Button
                data-testid="btn-save-competitor"
                onClick={handleSaveCompetitorEstimate}
                disabled={!competitorCompanyName || !competitorTextContent || loading}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                <Building2 className="w-4 h-4 mr-2" />
                Save Competitor Estimate
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {competitorData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-orange-600" />
              Competitor Estimates ({competitorData.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {competitorData.map((data) => (
                <div
                  key={data.id}
                  data-testid={`competitor-item-${data.id}`}
                  className="border border-orange-200 rounded-lg overflow-hidden"
                >
                  <div className="flex items-center justify-between p-4 bg-orange-50">
                    <div className="flex items-center gap-3 flex-1">
                      <Building2 className="w-5 h-5 text-orange-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">{data.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                          {data.content?.substring(0, 100)}...
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      <Badge variant="outline" className="bg-orange-100 text-orange-700 text-xs border-orange-300">
                        Competitor
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => toggleExpand(data.id)}
                      >
                        {expandedItems[data.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          if (confirm('Delete this competitor estimate?')) {
                            deleteTrainingMutation.mutate(data.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                  {expandedItems[data.id] && (
                    <div className="p-4 border-t border-orange-200 bg-white">
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                        {data.content}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t.sidebar.aiMemory} ({regularData.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {regularData.map((data) => (
              <div
                key={data.id}
                data-testid={`training-item-${data.id}`}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-3 flex-1">
                  {data.data_type === "website" && <Globe className="w-5 h-5 text-blue-600" />}
                  {data.data_type === "pdf" && <FileText className="w-5 h-5 text-red-600" />}
                  {data.data_type === "text" && <FileText className="w-5 h-5 text-gray-600" />}
                  <div className="flex-1">
                    <p className="font-medium">{data.title}</p>
                    <p className="text-sm text-gray-500 line-clamp-2">
                      {data.content?.substring(0, 150)}...
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    {t.common.active}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm('Delete this training material?')) {
                        deleteTrainingMutation.mutate(data.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
            {regularData.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <Brain className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <p className="font-medium mb-1">{t.common.noResults}</p>
                <p className="text-sm">Upload your website, PDFs, or add text to help Sarah, Lexi, Marcus &amp; the AI Estimator understand your business!</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>💡 Training Tips</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-gray-600">
            <p>✅ <strong>{t.common.web}:</strong> Best for getting overall business info, services, and FAQs</p>
            <p>✅ <strong>PDFs:</strong> Great for detailed service guides, manuals, and processes</p>
            <p>✅ <strong>Text:</strong> Perfect for specific instructions, scripts, or custom info</p>
            <p>✅ <strong>Competitor Estimates:</strong> Upload outside bids — the AI Estimator will use them to flag pricing differences and overcharges</p>
            <p>✅ <strong>More data = Better AI:</strong> The more you train, the smarter Sarah, Lexi, Marcus &amp; the AI Estimator get!</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
