import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  BookOpen,
  Plus,
  Edit,
  Trash2,
  Search,
  Bot,
  Calculator,
  Star,
  AlertCircle,
  Upload,
  Loader2,
  CheckCircle2,
  FileText,
  Save,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Eye,
  TrendingUp,
  Wrench,
  DollarSign,
  ClipboardList,
  HelpCircle,
  Settings,
  Package,
  Users,
  Video,
  StickyNote,
  FolderOpen,
  PlusCircle,
  Info,
  Lightbulb,
  PlayCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function KnowledgeBase() {
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  const [editingArticle, setEditingArticle] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [aiSearchResults, setAiSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [viewingArticle, setViewingArticle] = useState(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [articleSummary, setArticleSummary] = useState(null);
  const [ratingComment, setRatingComment] = useState("");
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState(null);

  const handleRestoreArticles = async () => {
    if (!myCompany?.id) return;
    setIsSeeding(true);
    setSeedResult(null);
    try {
      const result = await base44.functions.invoke('seedKnowledgeBase', { companyId: myCompany.id });
      setSeedResult(result);
      if (result.created > 0) {
        queryClient.invalidateQueries(['knowledge-base']);
      }
    } catch (err) {
      setSeedResult({ success: false, error: err.message });
    } finally {
      setIsSeeding(false);
    }
  };
  
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    category: "faq",
    customCategory: "",
    tags: "",
    is_published: true,
    is_ai_training: true,
    ai_assistant_targets: ["lexi", "estimator", "sarah", "marcus"], 
    priority: 5,
  });

  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(async (u) => {
      setUser(u);
      
      // Check for impersonation first
      const impersonatedId = sessionStorage.getItem('impersonating_company_id');
      if (impersonatedId) {
        const impersonatedCompanies = await base44.entities.Company.filter({ id: impersonatedId });
        if (impersonatedCompanies.length > 0) {
          setMyCompany(impersonatedCompanies[0]);
          return;
        }
      }
      
      // Check staff profile for company assignment
      const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: u.email });
      if (staffProfiles.length > 0 && staffProfiles[0].company_id) {
        const staffCompanies = await base44.entities.Company.filter({ id: staffProfiles[0].company_id });
        if (staffCompanies.length > 0) {
          setMyCompany(staffCompanies[0]);
          return;
        }
      }
      
      // Fallback to owned or first company
      const companies = await base44.entities.Company.list("-created_date", 10);
      setMyCompany(companies.find(c => c.created_by === u.email) || companies[0]);
    }).catch(() => {});
  }, []);

  const { data: articles = [], refetch } = useQuery({
    queryKey: ['knowledge-base', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const kbArticles = await base44.entities.KnowledgeBaseArticle.filter({ company_id: myCompany.id });
      const trainingVideos = await base44.entities.TrainingVideo.filter({ company_id: { $in: [myCompany.id, '695944e3c1fb00b7ab716c6f'] } });
      
      // Merge training videos into articles for display
      const videoArticles = trainingVideos.map(v => ({
        ...v,
        entity_type: 'TrainingVideo',
        category: 'Training Videos',
        content: v.description || v.content || `Video: ${v.title}`
      }));
      
      return [...kbArticles, ...videoArticles];
    },
    enabled: !!myCompany,
    initialData: [],
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Auto-refetch when page comes into focus
  React.useEffect(() => {
    const handleFocus = () => refetch();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refetch]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.KnowledgeBaseArticle.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['knowledge-base']);
      setShowDialog(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.KnowledgeBaseArticle.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['knowledge-base']);
      setShowDialog(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.KnowledgeBaseArticle.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['knowledge-base']);
    },
  });

  const resetForm = () => {
    setFormData({
      title: "",
      content: "",
      category: "faq",
      customCategory: "",
      tags: "",
      is_published: true,
      is_ai_training: true,
      ai_assistant_targets: ["lexi", "estimator", "sarah", "marcus"],
      priority: 5,
    });
    setEditingArticle(null);
    setUploadedFiles([]);
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsProcessingFiles(true);

    try {
      let extractedContent = formData.content || "";

      for (const file of files) {
        // Normalize filename - convert extension to lowercase
        const originalName = file.name;
        const nameParts = originalName.split('.');
        const extension = nameParts.length > 1 ? nameParts.pop().toLowerCase() : '';
        const baseName = nameParts.join('.');
        const normalizedName = extension ? `${baseName}.${extension}` : originalName;
        
        // Check if file type is supported
        const supportedTypes = ['pdf', 'jpg', 'jpeg', 'png'];
        if (!supportedTypes.includes(extension)) {
          alert(`File "${originalName}" is not supported.\n\nSupported formats: PDF, JPG, PNG\n\nFor Word docs (.docx), please convert to PDF first or copy/paste the text directly into the content field.`);
          continue; // Skip this file and continue with others
        }
        
        // Create new file with normalized name
        const normalizedFile = new File([file], normalizedName, { type: file.type });

        // Upload file
        const uploadResult = await base44.integrations.Core.UploadFile({ file: normalizedFile });
        setUploadedFiles(prev => [...prev, {
          name: normalizedName,
          url: uploadResult.file_url
        }]);

        // Extract text content using AI
        try {
          const extraction = await base44.integrations.Core.InvokeLLM({
            prompt: `Extract all text content from this document. Include measurements, specifications, pricing, line items, and any structured data. Format it clearly so it can be used for training an AI assistant to understand roofing estimates and reports.`,
            file_urls: [uploadResult.file_url]
          });

          extractedContent += `\n\n--- Extracted from ${normalizedName} ---\n${extraction}\n`;
        } catch (extractError) {
          console.error('Extraction error for', normalizedName, ':', extractError);
          extractedContent += `\n\n--- File uploaded: ${normalizedName} ---\n(Content extraction failed, but file is attached for AI to reference)\nFile URL: ${uploadResult.file_url}\n`;
        }
      }

      setFormData({ ...formData, content: extractedContent });
    } catch (error) {
      console.error('Upload error:', error);
      alert(`Error processing files: ${error.message}`);
    }

    setIsProcessingFiles(false);
  };

  const handleSubmit = () => {
    const tags = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
    
    const finalCategory = formData.category === "custom" ? formData.customCategory : formData.category;

    const data = {
      ...formData,
      category: finalCategory,
      tags,
      priority: parseInt(formData.priority),
      company_id: myCompany.id,
    };
    
    // Remove temporary field
    delete data.customCategory;

    if (editingArticle) {
      updateMutation.mutate({ id: editingArticle.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (article) => {
    setEditingArticle(article);
    const isDefaultCat = defaultCategories.some(c => c.value === article.category);
    setFormData({
      title: article.title,
      content: article.content,
      category: isDefaultCat ? article.category : "custom",
      customCategory: isDefaultCat ? "" : article.category,
      tags: article.tags?.join(', ') || '',
      is_published: article.is_published,
      is_ai_training: article.is_ai_training,
      ai_assistant_targets: article.ai_assistant_targets || ["lexi", "estimator", "sarah", "marcus"],
      priority: article.priority || 5,
    });
    setShowDialog(true);
  };

  // NEW: AI Search Function
  const handleAISearch = async () => {
    if (!searchQuery.trim()) {
      setAiSearchResults(null);
      return;
    }

    setIsSearching(true);
    try {
      const response = await base44.functions.invoke('searchKnowledgeBase', {
        query: searchQuery,
        company_id: myCompany.id // Use company_id here as per backend expectation
      });

      setAiSearchResults(response.data.results);
    } catch (error) {
      console.error('AI Search error:', error);
      alert('Search failed. Please try again.');
    }
    setIsSearching(false);
  };

  // NEW: View Article Function
  const handleViewArticle = async (article) => {
    setViewingArticle(article);
    setArticleSummary(null);
    
    // Increment view count
    await base44.entities.KnowledgeBaseArticle.update(article.id, {
      view_count: (article.view_count || 0) + 1
    });
    
    queryClient.invalidateQueries(['knowledge-base']);
    // Re-fetch article to update view count immediately in the viewing dialog
    const updatedArticle = await base44.entities.KnowledgeBaseArticle.get(article.id);
    setViewingArticle(updatedArticle);
  };

  // NEW: Generate Summary Function
  const handleGenerateSummary = async () => {
    if (!viewingArticle) return;

    setIsSummarizing(true);
    try {
      const response = await base44.functions.invoke('summarizeArticle', {
        article_id: viewingArticle.id, // Use article_id as per backend expectation
        content: viewingArticle.content
      });

      setArticleSummary(response.data.summary);
      queryClient.invalidateQueries(['knowledge-base']);
    } catch (error) {
      console.error('Summarize error:', error);
      alert('Failed to generate summary. Please try again.');
    }
    setIsSummarizing(false);
  };

  // NEW: Rate Article Function
  const handleRateArticle = async (rating, isHelpful) => {
    if (!viewingArticle || !user) return; // Ensure user is logged in to rate

    const currentFeedback = viewingArticle.feedback || [];
    const existingFeedbackIndex = currentFeedback.findIndex(f => f.user_email === user.email);

    let newFeedback = [...currentFeedback];
    if (rating) { // If a star rating was provided
      if (existingFeedbackIndex >= 0) {
        newFeedback[existingFeedbackIndex] = {
          ...newFeedback[existingFeedbackIndex],
          user_email: user.email,
          user_name: user.full_name,
          rating: rating,
          comment: ratingComment,
          timestamp: new Date().toISOString()
        };
      } else {
        newFeedback.push({
          user_email: user.email,
          user_name: user.full_name,
          rating: rating,
          comment: ratingComment,
          timestamp: new Date().toISOString()
        });
      }
    } else if (isHelpful !== undefined) { // If helpful/not helpful was provided
        // No explicit rating, just helpful/not helpful counter
    }


    // Calculate new average rating
    const ratings = newFeedback.map(f => f.rating).filter(r => r > 0); // Only count explicit ratings
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    const updateData = {
      feedback: newFeedback,
      rating_average: avgRating,
      rating_count: ratings.length,
    };

    // Update helpful/not helpful counts separately
    if (isHelpful === true) {
      updateData.helpful_count = (viewingArticle.helpful_count || 0) + 1;
    } else if (isHelpful === false) {
      updateData.not_helpful_count = (viewingArticle.not_helpful_count || 0) + 1;
    }

    try {
      await base44.entities.KnowledgeBaseArticle.update(viewingArticle.id, updateData);
      queryClient.invalidateQueries(['knowledge-base']);
      setRatingComment("");
      
      // Refresh viewing article to show updated stats
      const updated = await base44.entities.KnowledgeBaseArticle.get(viewingArticle.id);
      setViewingArticle(updated);
    } catch (error) {
      console.error("Failed to rate article:", error);
      alert("Failed to save rating. Please try again.");
    }
  };

  const filteredArticles = aiSearchResults || articles.filter(article => {
    const matchesSearch = article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         article.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || article.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categoryIconMap = {
    services: Wrench,
    pricing: DollarSign,
    policies: ClipboardList,
    faq: HelpCircle,
    processes: Settings,
    products: Package,
    team: Users,
    "Training Videos": Video,
    other: StickyNote,
  };

  const getCategoryIcon = (value) => {
    const IconComp = categoryIconMap[value] || FolderOpen;
    return <IconComp className="w-3.5 h-3.5 inline-block" />;
  };

  const stripHtmlTags = (html) => {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };

  const contentHasHtml = (content) => {
    if (!content) return false;
    return /<[a-z][\s\S]*>/i.test(content);
  };

  const defaultCategories = [
    { value: "services", label: "Services" },
    { value: "pricing", label: "Pricing" },
    { value: "policies", label: "Policies" },
    { value: "faq", label: "FAQ" },
    { value: "processes", label: "Processes" },
    { value: "products", label: "Products" },
    { value: "team", label: "Team" },
    { value: "Training Videos", label: "Training Videos" },
    { value: "other", label: "Other" },
  ];

  // Get all unique categories from articles + defaults
  const allCategories = React.useMemo(() => {
    const existingCats = new Set(defaultCategories.map(c => c.value));
    const customCats = articles
      .map(a => a.category)
      .filter(c => c && !existingCats.has(c))
      .filter((v, i, a) => a.indexOf(v) === i); // unique

    return [
      ...defaultCategories,
      ...customCats.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))
    ];
  }, [articles]);

  const lexiArticles = articles.filter(a => a.is_ai_training && a.ai_assistant_targets?.includes("lexi"));
  const estimatorArticles = articles.filter(a => a.is_ai_training && a.ai_assistant_targets?.includes("estimator"));
  const sarahArticles = articles.filter(a => a.is_ai_training && a.ai_assistant_targets?.includes("sarah"));
  const marcusArticles = articles.filter(a => a.is_ai_training && a.ai_assistant_targets?.includes("marcus"));

  // NEW: Get top rated articles
  const topRatedArticles = [...articles]
    .filter(a => (a.rating_average || 0) > 0) // Only consider articles with at least one rating
    .sort((a, b) => (b.rating_average || 0) - (a.rating_average || 0))
    .slice(0, 3);

  // NEW: Get most viewed articles
  const mostViewedArticles = [...articles]
    .filter(a => (a.view_count || 0) > 0) // Only consider articles with at least one view
    .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    .slice(0, 3);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Knowledge Base</h1>
          <p className="text-gray-500 mt-1">Train Lexi & AI Estimator with your business knowledge</p>
        </div>
        <div className="flex items-center gap-2">
          {articles.length === 0 && (
            <Button variant="outline" onClick={handleRestoreArticles} disabled={isSeeding} data-testid="button-restore-articles">
              {isSeeding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BookOpen className="w-4 h-4 mr-2" />}
              {isSeeding ? 'Restoring...' : 'Restore My Articles'}
            </Button>
          )}
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button onClick={resetForm}>
                <Plus className="w-4 h-4 mr-2" />
                Add Article
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingArticle ? 'Edit Article' : 'Add New Article'}</DialogTitle>
              <DialogDescription>
                Add knowledge for your team and train your AI assistants
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              
              {/* FILE UPLOAD SECTION - NOW WITH SUPPORTED FORMATS */}
              <div className="border-2 border-dashed border-purple-300 rounded-lg p-4 bg-purple-50">
                <Label className="flex items-center gap-2 mb-2">
                  <Upload className="w-4 h-4 text-purple-600" />
                  Upload Files for AI Training (Optional)
                </Label>
                <p className="text-xs text-gray-600 mb-3">
                  Upload <strong>PDF, JPG, or PNG files</strong> (EagleView, Hover, GAF Quick Squares, Roofr reports, inspection photos).
                  <br />
                  <strong className="text-red-600">Word docs (.docx) not supported</strong> - convert to PDF first or paste text below.
                  <br />
                  <strong>OR</strong> skip this and just write instructions below!
                </p>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer"
                  disabled={isProcessingFiles}
                />
                {isProcessingFiles && (
                  <div className="mt-3 flex items-center gap-2 text-purple-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Processing and extracting content from files...</span>
                  </div>
                )}
                {uploadedFiles.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-sm font-semibold text-green-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Files Processed (content extracted below):</p>
                    {uploadedFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm text-green-600">
                        <CheckCircle2 className="w-4 h-4" />
                        {file.name}
                      </div>
                    ))}
                    <p className="text-xs text-orange-600 font-semibold mt-2">
                      Scroll down to see extracted content, then click "{editingArticle ? 'Update' : 'Create'}" Article to save!
                    </p>
                  </div>
                )}
              </div>

              {/* TITLE */}
              <div>
                <Label>Title *</Label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  placeholder="e.g., AI Estimator Instructions, Pricing Rules, Line Item Order"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Examples: "AI Estimator Instructions", "How to Order Line Items", "Pricing Guidelines"
                </p>
              </div>

              {/* CONTENT - NOW WITH BETTER INSTRUCTIONS */}
              <div>
                <Label>Content / Instructions *</Label>
                <Textarea
                  value={formData.content}
                  onChange={(e) => setFormData({...formData, content: e.target.value})}
                  placeholder="Write instructions, guidelines, or detailed information here...&#10;&#10;Examples:&#10;• Always check favorites first when matching line items&#10;• For roofing estimates, use this order: shingles, ridge, hip, valley, drip edge&#10;• Add 10% waste to all roofing materials&#10;• Our standard pricing for shingles is $350/SQ"
                  rows={12}
                  className="font-mono text-sm"
                />
                {uploadedFiles.length > 0 && !formData.content && (
                  <p className="text-xs text-orange-600 mt-1 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Content should appear here automatically after file upload
                  </p>
                )}
                {uploadedFiles.length === 0 && !formData.content && (
                  <p className="text-xs text-blue-600 mt-1 font-semibold flex items-center gap-1">
                    <Lightbulb className="w-3 h-3" /> <strong>You can just write instructions!</strong> No need to upload files. Example: "Always check favorites first when matching line items"
                  </p>
                )}
                {uploadedFiles.length > 0 && formData.content && (
                  <p className="text-xs text-green-600 mt-1 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Content extracted! Now add a title and click "{editingArticle ? 'Update' : 'Create'}" Article
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({...formData, category: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {defaultCategories.map(cat => (
                        <SelectItem key={cat.value} value={cat.value}>
                          <span className="flex items-center gap-2">{getCategoryIcon(cat.value)} {cat.label}</span>
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">
                        <span className="flex items-center gap-2"><PlusCircle className="w-3.5 h-3.5 inline-block" /> Custom Category</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  
                  {formData.category === "custom" && (
                    <div className="mt-2">
                      <Input 
                        placeholder="Enter category name..."
                        value={formData.customCategory}
                        onChange={(e) => setFormData({...formData, customCategory: e.target.value})}
                        autoFocus
                      />
                    </div>
                  )}
                </div>

                <div>
                  <Label>Priority (1-10)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.priority}
                    onChange={(e) => setFormData({...formData, priority: e.target.value})}
                  />
                  <p className="text-xs text-gray-500 mt-1">Higher = AI uses it more</p>
                </div>
              </div>

              <div>
                <Label>Tags (comma separated)</Label>
                <Input
                  value={formData.tags}
                  onChange={(e) => setFormData({...formData, tags: e.target.value})}
                  placeholder="roofing, insurance, pricing"
                />
              </div>

              {/* AI Training Section - IMPROVED */}
              <div className="space-y-4 p-4 border rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base text-purple-900 font-semibold">Use for AI Training</Label>
                    <p className="text-sm text-purple-700">Train your AI assistants with this knowledge</p>
                  </div>
                  <Switch
                    checked={formData.is_ai_training}
                    onCheckedChange={(checked) => setFormData({...formData, is_ai_training: checked})}
                  />
                </div>

                {formData.is_ai_training && (
                  <div className="space-y-3 pt-3 border-t border-purple-200">
                    <Label className="text-sm font-semibold text-purple-900">Which AI assistants should learn from this?</Label>
                    
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-purple-200 hover:border-purple-400 transition-colors">
                        <input
                          type="checkbox"
                          id="train-lexi"
                          checked={formData.ai_assistant_targets?.includes("lexi")}
                          onChange={(e) => {
                            const targets = formData.ai_assistant_targets || [];
                            if (e.target.checked) {
                              setFormData({...formData, ai_assistant_targets: [...targets, "lexi"]});
                            } else {
                              setFormData({...formData, ai_assistant_targets: targets.filter(t => t !== "lexi")});
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <label htmlFor="train-lexi" className="flex-1 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4 text-purple-600" />
                            <span className="font-semibold text-purple-900">Lexi AI Assistant</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-1">General business knowledge, customer service, workflows</p>
                        </label>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-blue-200 hover:border-blue-400 transition-colors">
                        <input
                          type="checkbox"
                          id="train-estimator"
                          checked={formData.ai_assistant_targets?.includes("estimator")}
                          onChange={(e) => {
                            const targets = formData.ai_assistant_targets || [];
                            if (e.target.checked) {
                              setFormData({...formData, ai_assistant_targets: [...targets, "estimator"]});
                            } else {
                              setFormData({...formData, ai_assistant_targets: targets.filter(t => t !== "estimator")});
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <label htmlFor="train-estimator" className="flex-1 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Calculator className="w-4 h-4 text-blue-600" />
                            <span className="font-semibold text-blue-900">AI Estimator</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-1">Estimates, pricing, line item ordering, measurements</p>
                        </label>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-pink-200 hover:border-pink-400 transition-colors">
                        <input
                          type="checkbox"
                          id="train-sarah"
                          checked={formData.ai_assistant_targets?.includes("sarah")}
                          onChange={(e) => {
                            const targets = formData.ai_assistant_targets || [];
                            if (e.target.checked) {
                              setFormData({...formData, ai_assistant_targets: [...targets, "sarah"]});
                            } else {
                              setFormData({...formData, ai_assistant_targets: targets.filter(t => t !== "sarah")});
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <label htmlFor="train-sarah" className="flex-1 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4 text-pink-600" />
                            <span className="font-semibold text-pink-900">Sarah AI Assistant</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-1">SMS/Voice conversations, lead intake, scheduling</p>
                        </label>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-red-200 hover:border-red-400 transition-colors">
                        <input
                          type="checkbox"
                          id="train-marcus"
                          checked={formData.ai_assistant_targets?.includes("marcus")}
                          onChange={(e) => {
                            const targets = formData.ai_assistant_targets || [];
                            if (e.target.checked) {
                              setFormData({...formData, ai_assistant_targets: [...targets, "marcus"]});
                            } else {
                              setFormData({...formData, ai_assistant_targets: targets.filter(t => t !== "marcus")});
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <label htmlFor="train-marcus" className="flex-1 cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4 text-red-600" />
                            <span className="font-semibold text-red-900">Marcus AI Copywriter</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-1">Marketing copy, campaigns, CTAs, direct response</p>
                        </label>
                      </div>
                      </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg bg-blue-50 border-blue-200">
                <div>
                  <Label className="text-base text-blue-900 font-semibold">Published</Label>
                  <p className="text-sm text-blue-700">Make visible to staff</p>
                </div>
                <Switch
                  checked={formData.is_published}
                  onCheckedChange={(checked) => setFormData({...formData, is_published: checked})}
                />
              </div>

              <DialogFooter className="flex gap-3 pt-4">
                <Button variant="outline" onClick={() => {
                  setShowDialog(false);
                  resetForm();
                }}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleSubmit} 
                  className="flex-1 bg-purple-600 hover:bg-purple-700"
                  disabled={!formData.title || !formData.content}
                >
                  <Save className="w-4 h-4 mr-2" />
                  {editingArticle ? 'Update' : 'Create'} Article
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {seedResult && (
        <Alert className={seedResult.success && seedResult.created > 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
          {seedResult.success && seedResult.created > 0 ? (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600" />
          )}
          <AlertDescription>
            {seedResult.success && seedResult.created > 0
              ? `✅ Successfully restored ${seedResult.created} articles to your Knowledge Base!`
              : seedResult.error || "Something went wrong. Try again."}
          </AlertDescription>
        </Alert>
      )}

      <Alert className="border-blue-200 bg-blue-50/50">
        <Info className="w-4 h-4 text-blue-600" />
        <AlertDescription>
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm text-blue-800">
              <p className="font-semibold text-blue-900 mb-1">Train your AI assistants with business knowledge</p>
              <p>Upload reports (PDF, JPG, PNG), write instructions, or add training videos. Supported: EagleView, Hover, GAF, Roofr reports, inspection photos, and direct instructions.</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant="outline" className="text-xs">
                <Bot className="w-3 h-3 mr-1" />
                Lexi
              </Badge>
              <Badge variant="outline" className="text-xs">
                <Calculator className="w-3 h-3 mr-1" />
                Estimator
              </Badge>
            </div>
          </div>
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Bot className="w-8 h-8 text-purple-600" />
              <div>
                <p className="text-sm text-gray-600">Lexi AI</p>
                <p className="text-2xl font-bold text-gray-900">{lexiArticles.length}</p>
                <p className="text-xs text-gray-500">articles available</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Calculator className="w-8 h-8 text-blue-600" />
              <div>
                <p className="text-sm text-gray-600">AI Estimator</p>
                <p className="text-2xl font-bold text-gray-900">{estimatorArticles.length}</p>
                <p className="text-xs text-gray-500">articles available</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-pink-50 to-pink-100">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Bot className="w-8 h-8 text-pink-600" />
              <div>
                <p className="text-sm text-gray-600">Sarah AI</p>
                <p className="text-2xl font-bold text-gray-900">{sarahArticles.length}</p>
                <p className="text-xs text-gray-500">articles available</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-red-100">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Bot className="w-8 h-8 text-red-600" />
              <div>
                <p className="text-sm text-gray-600">Marcus AI</p>
                <p className="text-2xl font-bold text-gray-900">{marcusArticles.length}</p>
                <p className="text-xs text-gray-500">articles available</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <BookOpen className="w-8 h-8 text-green-600" />
              <div>
                <p className="text-sm text-gray-600">Total Articles</p>
                <p className="text-2xl font-bold text-gray-900">{articles.length}</p>
                <p className="text-xs text-gray-500">in knowledge base</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* NEW: Avg Rating Card */}
        <Card className="bg-gradient-to-br from-yellow-50 to-yellow-100">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Star className="w-8 h-8 text-yellow-600" />
              <div>
                <p className="text-sm text-gray-600">Avg Rating</p>
                <p className="text-2xl font-bold text-gray-900">
                  {articles.length > 0 
                    ? Number(articles.reduce((sum, a) => sum + Number(a.rating_average || 0), 0) / (articles.filter(a => a.rating_average > 0).length || 1)).toFixed(1)
                    : '0.0'}
                </p>
                <p className="text-xs text-gray-500">across all articles</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-y-2">
            <CardTitle>Articles/Videos</CardTitle>
            <div className="flex gap-3 flex-wrap">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search articles..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setAiSearchResults(null); // Clear AI search results on manual typing
                  }}
                  className="pl-10 w-64"
                />
              </div>
              {/* NEW: AI Search Button */}
              <Button 
                onClick={handleAISearch}
                disabled={isSearching || !searchQuery.trim()}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                AI Search
              </Button>
              <Select value={selectedCategory} onValueChange={(value) => {
                setSelectedCategory(value);
                setAiSearchResults(null);
                setSearchQuery("");
              }}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {allCategories.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <span className="flex items-center gap-2">{getCategoryIcon(cat.value)} {cat.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* NEW: AI Search Results Alert */}
          {aiSearchResults && (
            <Alert className="mt-4 bg-purple-50 border-purple-200">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <AlertDescription>
                <strong>AI Search Results:</strong> Found {aiSearchResults.length} relevant articles for "{searchQuery}"
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    setAiSearchResults(null);
                    setSearchQuery("");
                  }}
                  className="ml-2 px-2 py-1 h-auto text-purple-700 hover:bg-purple-100"
                >
                  Clear Search
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </CardHeader>
        <CardContent>
          {filteredArticles.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-semibold mb-2">No Articles Yet</h3>
              <p className="text-gray-500 mb-4">Upload documents or create articles to train your AI!</p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Button variant="outline" onClick={handleRestoreArticles} disabled={isSeeding} data-testid="button-restore-articles-empty">
                  {isSeeding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BookOpen className="w-4 h-4 mr-2" />}
                  {isSeeding ? 'Restoring...' : 'Restore My Articles'}
                </Button>
                <Button onClick={() => setShowDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Article
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredArticles.map(article => {
                const category = allCategories.find(c => c.value === article.category) || { label: article.category };
                return (
                  <Card key={article.id} className="hover:shadow-md transition-shadow cursor-pointer overflow-hidden" onClick={() => handleViewArticle(article)}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Badge variant="outline" className="gap-1">
                              {getCategoryIcon(article.category)} {category?.label}
                            </Badge>
                            {article.is_ai_training && article.ai_assistant_targets?.includes("lexi") && (
                              <Badge className="bg-purple-100 text-purple-700">
                                <Bot className="w-3 h-3 mr-1" />
                                Lexi
                              </Badge>
                            )}
                            {article.is_ai_training && article.ai_assistant_targets?.includes("estimator") && (
                              <Badge className="bg-blue-100 text-blue-700">
                                <Calculator className="w-3 h-3 mr-1" />
                                Estimator
                              </Badge>
                            )}
                            {article.is_ai_training && article.ai_assistant_targets?.includes("sarah") && (
                              <Badge className="bg-pink-100 text-pink-700">
                                <Bot className="w-3 h-3 mr-1" />
                                Sarah
                              </Badge>
                            )}
                            {article.is_ai_training && article.ai_assistant_targets?.includes("marcus") && (
                              <Badge className="bg-red-100 text-red-700">
                                <Bot className="w-3 h-3 mr-1" />
                                Marcus
                              </Badge>
                            )}
                            {/* NEW: Display average rating */}
                            {(article.rating_average || 0) > 0 && (
                              <Badge className="bg-yellow-100 text-yellow-700">
                                <Star className="w-3 h-3 mr-1" />
                                {article.rating_average.toFixed(1)}
                              </Badge>
                            )}
                            {article.priority >= 8 && ( // Keep existing priority badge
                              <Badge className="bg-yellow-100 text-yellow-700">
                                <Star className="w-3 h-3 mr-1" />
                                High Priority
                              </Badge>
                            )}
                          </div>
                          <h3 className="font-semibold text-lg truncate">{article.title}</h3>
                          <p className="text-sm text-gray-500 mt-1 line-clamp-2 break-words overflow-hidden">
                            {stripHtmlTags(article.content)}
                          </p>
                          {/* NEW: Article Stats */}
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Eye className="w-3 h-3" />
                              {article.view_count || 0} views
                            </span>
                            <span className="flex items-center gap-1">
                              <ThumbsUp className="w-3 h-3" />
                              {article.helpful_count || 0}
                            </span>
                            <span className="flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" />
                              {article.feedback?.length || 0} reviews
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center justify-between">
                        <div className="flex gap-1">
                          {article.tags?.slice(0, 3).map(tag => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        {/* Ensure edit/delete buttons don't trigger view dialog */}
                        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}> 
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(article);
                            }}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMutation.mutate(article.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* NEW: Top Rated & Most Viewed Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              Top Rated Articles
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topRatedArticles.length > 0 ? (
              <div className="space-y-3">
                {topRatedArticles.map((article, idx) => (
                  <div key={article.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer" onClick={() => handleViewArticle(article)}>
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 text-white font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{article.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-600 fill-yellow-600" />
                          <span className="text-xs text-gray-600">{article.rating_average.toFixed(1)}</span>
                        </div>
                        <span className="text-xs text-gray-500">({article.rating_count || 0} ratings)</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-500 py-4">No rated articles yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-blue-600" />
              Most Viewed Articles
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mostViewedArticles.length > 0 ? (
              <div className="space-y-3">
                {mostViewedArticles.map((article, idx) => (
                  <div key={article.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer" onClick={() => handleViewArticle(article)}>
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-white font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{article.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-1">
                          <Eye className="w-3 h-3 text-blue-600" />
                          <span className="text-xs text-gray-600">{article.view_count} views</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-500 py-4">No viewed articles yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* NEW: Article Viewer Dialog */}
      <Dialog open={viewingArticle !== null} onOpenChange={() => {setViewingArticle(null); setRatingComment("");}}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewingArticle?.title}</DialogTitle>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {(viewingArticle?.rating_average || 0) > 0 && (
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-600 fill-yellow-600" />
                  <span className="text-sm font-semibold">{viewingArticle.rating_average.toFixed(1)}</span>
                  <span className="text-xs text-gray-500">({viewingArticle.rating_count || 0} ratings)</span>
                </div>
              )}
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Eye className="w-3 h-3" />
                {viewingArticle?.view_count || 0} views
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <MessageSquare className="w-3 h-3" />
                {viewingArticle?.feedback?.length || 0} reviews
              </div>
            </div>
          </DialogHeader>

          {viewingArticle && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  onClick={handleGenerateSummary}
                  disabled={isSummarizing}
                  variant="outline"
                  className="flex-1"
                >
                  {isSummarizing ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  Generate AI Summary
                </Button>
                <Button
                  onClick={() => handleEdit(viewingArticle)} // Allow editing directly from view
                  variant="outline"
                  className="flex-1"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Article
                </Button>
              </div>

              {articleSummary && (
                <Alert className="bg-blue-50 border-blue-200">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <AlertDescription>
                    <p className="font-semibold mb-2">AI Summary:</p>
                    <ul className="list-disc list-inside space-y-1 pl-4">
                      {articleSummary.map((point, idx) => (
                        <li key={idx} className="text-sm">{point}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {contentHasHtml(viewingArticle.content) ? (
                <div 
                  className="prose max-w-none text-gray-700 [&_a]:text-blue-600 [&_a]:underline [&_a]:font-medium [&_p]:mb-3 [&_strong]:font-bold [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:shadow-md [&_img]:my-4"
                  dangerouslySetInnerHTML={{ __html: viewingArticle.content }}
                />
              ) : (
                <div className="prose max-w-none text-gray-700">
                  <ReactMarkdown
                    components={{
                      img: ({ node, ...props }) => (
                        <img 
                          {...props} 
                          className="max-w-full h-auto rounded-lg shadow-md my-4" 
                          loading="lazy"
                        />
                      ),
                      p: ({ node, children, ...props }) => (
                        <p {...props} className="mb-4">{children}</p>
                      ),
                      h1: ({ node, children, ...props }) => (
                        <h1 {...props} className="text-2xl font-bold mt-6 mb-4">{children}</h1>
                      ),
                      h2: ({ node, children, ...props }) => (
                        <h2 {...props} className="text-xl font-bold mt-5 mb-3">{children}</h2>
                      ),
                      h3: ({ node, children, ...props }) => (
                        <h3 {...props} className="text-lg font-semibold mt-4 mb-2">{children}</h3>
                      ),
                      ul: ({ node, children, ...props }) => (
                        <ul {...props} className="list-disc list-inside mb-4 space-y-1">{children}</ul>
                      ),
                      ol: ({ node, children, ...props }) => (
                        <ol {...props} className="list-decimal list-inside mb-4 space-y-1">{children}</ol>
                      ),
                      code: ({ node, inline, children, ...props }) => (
                        inline ? 
                          <code {...props} className="bg-gray-100 px-1 py-0.5 rounded text-sm">{children}</code> :
                          <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto my-4"><code {...props}>{children}</code></pre>
                      ),
                      table: ({ node, children, ...props }) => (
                        <div className="overflow-x-auto my-4">
                          <table {...props} className="min-w-full border-collapse border border-gray-300">{children}</table>
                        </div>
                      ),
                      th: ({ node, children, ...props }) => (
                        <th {...props} className="border border-gray-300 px-4 py-2 bg-gray-100 font-semibold text-left">{children}</th>
                      ),
                      td: ({ node, children, ...props }) => (
                        <td {...props} className="border border-gray-300 px-4 py-2">{children}</td>
                      ),
                      hr: ({ node, ...props }) => (
                        <hr {...props} className="my-6 border-gray-300" />
                      ),
                      blockquote: ({ node, children, ...props }) => (
                        <blockquote {...props} className="border-l-4 border-blue-500 pl-4 my-4 italic text-gray-600">{children}</blockquote>
                      ),
                      strong: ({ node, children, ...props }) => (
                        <strong {...props} className="font-bold">{children}</strong>
                      ),
                    }}
                  >
                    {viewingArticle.content}
                  </ReactMarkdown>
                </div>
              )}

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3">Was this article helpful?</h4>
                <div className="flex gap-2 mb-4">
                  <Button
                    onClick={() => handleRateArticle(null, true)} // No star rating, just helpful counter
                    variant="outline"
                    className="flex-1"
                  >
                    <ThumbsUp className="w-4 h-4 mr-2" />
                    Helpful ({viewingArticle.helpful_count || 0})
                  </Button>
                  <Button
                    onClick={() => handleRateArticle(null, false)} // No star rating, just not helpful counter
                    variant="outline"
                    className="flex-1"
                  >
                    <ThumbsDown className="w-4 h-4 mr-2" />
                    Not Helpful ({viewingArticle.not_helpful_count || 0})
                  </Button>
                </div>

                <div className="space-y-3">
                  <Label>Rate this article:</Label>
                  <div className="flex gap-2 items-center">
                    {[1, 2, 3, 4, 5].map(starRating => (
                      <Button
                        key={starRating}
                        onClick={() => handleRateArticle(starRating)}
                        variant="outline"
                        size="icon"
                        className="w-9 h-9"
                      >
                        <Star className={`w-4 h-4 ${starRating <= (viewingArticle.feedback?.find(f => f.user_email === user?.email)?.rating || 0) ? 'fill-yellow-600 text-yellow-600' : 'text-gray-400'}`} />
                      </Button>
                    ))}
                    <span className="text-sm text-gray-500 ml-2">
                        {viewingArticle.feedback?.find(f => f.user_email === user?.email)?.rating ? 
                         `You rated it ${viewingArticle.feedback.find(f => f.user_email === user?.email).rating} stars.` : 
                         'Click to rate.'}
                    </span>
                  </div>

                  <Label htmlFor="rating-comment">Add a comment (optional):</Label>
                  <Textarea
                    id="rating-comment"
                    placeholder="Provide feedback or ask a question about this article..."
                    value={ratingComment}
                    onChange={(e) => setRatingComment(e.target.value)}
                    rows={3}
                  />
                  <Button 
                    onClick={() => handleRateArticle(viewingArticle.feedback?.find(f => f.user_email === user?.email)?.rating || null)}
                    disabled={!user || (!ratingComment.trim() && !viewingArticle.feedback?.find(f => f.user_email === user?.email)?.rating)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Submit Feedback
                  </Button>

                  {(viewingArticle.feedback?.length || 0) > 0 && (
                    <div className="mt-4">
                      <h5 className="font-semibold mb-2">Recent Feedback:</h5>
                      <div className="space-y-2">
                        {viewingArticle.feedback
                          .filter(f => f.comment || f.rating > 0)
                          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                          .slice(0, 3)
                          .map((feedback, idx) => (
                          <div key={idx} className="p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-sm">{feedback.user_name}</span>
                              {feedback.rating > 0 && (
                                <div className="flex items-center gap-1">
                                  <Star className="w-3 h-3 text-yellow-600 fill-yellow-600" />
                                  <span className="text-xs">{feedback.rating}</span>
                                </div>
                              )}
                            </div>
                            {feedback.comment && (
                              <p className="text-sm text-gray-600">{feedback.comment}</p>
                            )}
                            <p className="text-xs text-gray-400 mt-1">{new Date(feedback.timestamp).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}