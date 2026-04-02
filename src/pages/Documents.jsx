import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  Upload,
  Download,
  Eye,
  Trash2,
  MoreVertical,
  Search,
  Filter,
  FolderOpen,
  Image,
  FileCheck,
  File,
  RefreshCw,
  Plus,
  FilePlus
} from "lucide-react";
import { format } from "date-fns";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";

export default function Documents() {
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [documentContent, setDocumentContent] = useState("");
  const [formData, setFormData] = useState({
    document_name: "",
    category: "other",
    related_customer: "",
    related_project: "",
    description: "",
    is_customer_visible: false,
    tags: []
  });
  const [selectedFile, setSelectedFile] = useState(null);

  const queryClient = useQueryClient();

  const { myCompany, filterCustomers, filterByCustomerRelation } = useRoleBasedData();

  const { data: allDocuments = [] } = useQuery({
    queryKey: ['documents', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Document.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const customers = React.useMemo(() => filterCustomers(allCustomers), [allCustomers, filterCustomers]);
  const documents = React.useMemo(() => filterByCustomerRelation(allDocuments, customers, 'documents'), [allDocuments, customers, filterByCustomerRelation]);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Project.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Document.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      
      const newFormData = { ...formData };
      if (!newFormData.document_name) {
        newFormData.document_name = file.name;
      }

      // Auto-select "Photo" category for image files
      if (file.type.startsWith('image/')) {
        newFormData.category = 'photo';
      }
      
      setFormData(newFormData);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      alert('Please select a file');
      return;
    }

    if (!myCompany?.id) {
      alert('Company information not loaded. Please try again.');
      return;
    }

    setUploadingFile(true);

    try {
      // Upload file
      const { file_url: uploadedFileUrl } = await base44.integrations.Core.UploadFile({
        file: selectedFile
      });

      // Create document record
      await base44.entities.Document.create({
        ...formData,
        company_id: myCompany.id,
        file_url: uploadedFileUrl,
        file_size: selectedFile.size,
        file_type: selectedFile.type
      });

      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowUploadDialog(false);
      setSelectedFile(null);
      setFormData({
        document_name: "",
        category: "other",
        related_customer: "",
        related_project: "",
        description: "",
        is_customer_visible: false,
        tags: []
      });

      alert('Document uploaded successfully!');
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload document');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleCreateDocument = async () => {
    if (!formData.document_name.trim()) {
      alert('Please enter a document name');
      return;
    }

    if (!documentContent.trim()) {
      alert('Please add some content to the document');
      return;
    }

    if (!myCompany?.id) {
      alert('Company information not loaded. Please try again.');
      return;
    }

    setCreatingDocument(true);

    try {
      // Create a text file blob
      const blob = new Blob([documentContent], { type: 'text/plain' });
      const file = new File([blob], formData.document_name + '.txt', { type: 'text/plain' });

      // Upload the text file
      const { file_url: uploadedFileUrl } = await base44.integrations.Core.UploadFile({
        file: file
      });

      // Create document record
      await base44.entities.Document.create({
        ...formData,
        company_id: myCompany.id,
        file_url: uploadedFileUrl,
        file_size: blob.size,
        file_type: 'text/plain'
      });

      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowCreateDialog(false);
      setDocumentContent("");
      setFormData({
        document_name: "",
        category: "other",
        related_customer: "",
        related_project: "",
        description: "",
        is_customer_visible: false,
        tags: []
      });

      alert('Document created successfully!');
    } catch (error) {
      console.error('Create error:', error);
      alert('Failed to create document');
    } finally {
      setCreatingDocument(false);
    }
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this document?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleDownload = (doc) => {
    const fileUrl = doc.file_url || doc.data?.file_url;
    if (!fileUrl) {
      alert('File URL not available for this document');
      return;
    }
    window.open(fileUrl, '_blank');
  };

  const getCategoryIcon = (category) => {
    const icons = {
      contract: FileCheck,
      estimate: FileText,
      invoice: FileText,
      photo: Image,
      insurance: FileText,
      warranty: FileCheck,
      proposal: FileText,
      report: FileText,
      other: File
    };
    const Icon = icons[category] || File;
    return <Icon className="w-5 h-5" />;
  };

  const getCategoryColor = (category) => {
    const colors = {
      contract: 'bg-purple-100 text-purple-700 border-purple-200',
      estimate: 'bg-blue-100 text-blue-700 border-blue-200',
      invoice: 'bg-green-100 text-green-700 border-green-200',
      photo: 'bg-pink-100 text-pink-700 border-pink-200',
      insurance: 'bg-orange-100 text-orange-700 border-orange-200',
      warranty: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      proposal: 'bg-cyan-100 text-cyan-700 border-cyan-200',
      report: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      other: 'bg-gray-100 text-gray-700 border-gray-200'
    };
    return colors[category] || colors.other;
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.document_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.related_customer?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = categoryFilter === 'all' || doc.category === categoryFilter;
    
    return matchesSearch && matchesCategory;
  });

  // Group by category
  const documentsByCategory = filteredDocuments.reduce((acc, doc) => {
    const category = doc.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(doc);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Document Management</h1>
          <p className="text-gray-500 mt-1">Upload, organize, and share documents</p>
        </div>

        <div className="flex gap-2">
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-blue-600 text-blue-600 hover:bg-blue-50">
                <FilePlus className="w-4 h-4 mr-2" />
                Create from Scratch
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Document</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Document Name *</Label>
                  <Input
                    value={formData.document_name}
                    onChange={(e) => setFormData({...formData, document_name: e.target.value})}
                    placeholder="e.g., Meeting Notes - Smith Project"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Category</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(v) => setFormData({...formData, category: v})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contract">Contract</SelectItem>
                        <SelectItem value="estimate">Estimate</SelectItem>
                        <SelectItem value="invoice">Invoice</SelectItem>
                        <SelectItem value="photo">Photo</SelectItem>
                        <SelectItem value="insurance">Insurance</SelectItem>
                        <SelectItem value="warranty">Warranty</SelectItem>
                        <SelectItem value="proposal">Proposal</SelectItem>
                        <SelectItem value="report">Report</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Related Customer (Optional)</Label>
                    <Select
                      value={formData.related_customer}
                      onValueChange={(v) => setFormData({...formData, related_customer: v})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select customer" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={null}>None</SelectItem>
                        {customers.map(c => (
                          <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Related Project (Optional)</Label>
                  <Select
                    value={formData.related_project}
                    onValueChange={(v) => setFormData({...formData, related_project: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>None</SelectItem>
                      {projects.map(p => (
                        <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Document Content *</Label>
                  <Textarea
                    value={documentContent}
                    onChange={(e) => setDocumentContent(e.target.value)}
                    placeholder="Type your document content here..."
                    rows={12}
                    className="font-mono text-sm"
                  />
                </div>

                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Add notes about this document..."
                    rows={2}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    checked={formData.is_customer_visible}
                    onCheckedChange={(checked) => setFormData({...formData, is_customer_visible: checked})}
                  />
                  <Label>Make visible to customer in portal</Label>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowCreateDialog(false);
                      setDocumentContent("");
                      setFormData({
                        document_name: "",
                        category: "other",
                        related_customer: "",
                        related_project: "",
                        description: "",
                        is_customer_visible: false,
                        tags: []
                      });
                    }}
                    disabled={creatingDocument}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateDocument}
                    disabled={!formData.document_name.trim() || !documentContent.trim() || creatingDocument}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {creatingDocument ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <FilePlus className="w-4 h-4 mr-2" />
                        Create Document
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Upload className="w-4 h-4 mr-2" />
                Upload Document
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Upload New Document</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Select File *</Label>
                <Input
                  type="file"
                  onChange={handleFileSelect}
                  accept="*/*"
                />
                {selectedFile && (
                  <p className="text-sm text-gray-500 mt-1">
                    Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                  </p>
                )}
              </div>

              <div>
                <Label>Document Name *</Label>
                <Input
                  value={formData.document_name}
                  onChange={(e) => setFormData({...formData, document_name: e.target.value})}
                  placeholder="e.g., Roof Contract - Smith"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(v) => setFormData({...formData, category: v})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="estimate">Estimate</SelectItem>
                      <SelectItem value="invoice">Invoice</SelectItem>
                      <SelectItem value="photo">Photo</SelectItem>
                      <SelectItem value="insurance">Insurance</SelectItem>
                      <SelectItem value="warranty">Warranty</SelectItem>
                      <SelectItem value="proposal">Proposal</SelectItem>
                      <SelectItem value="report">Report</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Related Customer (Optional)</Label>
                  <Select
                    value={formData.related_customer}
                    onValueChange={(v) => setFormData({...formData, related_customer: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>None</SelectItem>
                      {customers.map(c => (
                        <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Related Project (Optional)</Label>
                <Select
                  value={formData.related_project}
                  onValueChange={(v) => setFormData({...formData, related_project: v})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>None</SelectItem>
                    {projects.map(p => (
                      <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  placeholder="Add notes about this document..."
                  rows={3}
                />
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  checked={formData.is_customer_visible}
                  onCheckedChange={(checked) => setFormData({...formData, is_customer_visible: checked})}
                />
                <Label>Make visible to customer in portal</Label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setShowUploadDialog(false)}
                  disabled={uploadingFile}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={!selectedFile || uploadingFile}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {uploadingFile ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card className="bg-white">
        <CardContent className="p-4">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-48">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="contract">Contracts</SelectItem>
                <SelectItem value="estimate">Estimates</SelectItem>
                <SelectItem value="invoice">Invoices</SelectItem>
                <SelectItem value="photo">Photos</SelectItem>
                <SelectItem value="insurance">Insurance</SelectItem>
                <SelectItem value="warranty">Warranties</SelectItem>
                <SelectItem value="proposal">Proposals</SelectItem>
                <SelectItem value="report">Reports</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {Object.keys(documentsByCategory).length === 0 ? (
        <Card className="bg-white">
          <CardContent className="p-12 text-center text-gray-500">
            <FolderOpen className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-semibold">No documents found</p>
            <p className="text-sm">Upload your first document to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(documentsByCategory).map(([category, docs]) => (
            <Card key={category} className="bg-white">
              <CardHeader className="border-b bg-gray-50">
                <CardTitle className="flex items-center gap-2">
                  {getCategoryIcon(category)}
                  {category.charAt(0).toUpperCase() + category.slice(1).replace('_', ' ')}
                  <Badge variant="outline" className="ml-2">
                    {docs.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-200">
                  {docs.map((doc) => (
                    <div key={doc.id} className="p-4 hover:bg-gray-50 flex items-center gap-4">
                      <div className={`p-3 rounded-lg ${getCategoryColor(doc.category)}`}>
                        {getCategoryIcon(doc.category)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900 truncate">
                            {doc.document_name}
                          </p>
                          {doc.is_customer_visible && (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              Customer Visible
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                          <span>{formatFileSize(doc.file_size || 0)}</span>
                          <span>•</span>
                          <span>{format(new Date(doc.created_date), 'MMM d, yyyy')}</span>
                          {doc.related_customer && (
                            <>
                              <span>•</span>
                              <span>{doc.related_customer}</span>
                            </>
                          )}
                        </div>
                        {doc.description && (
                          <p className="text-sm text-gray-600 mt-1">{doc.description}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload(doc)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleDownload(doc)}>
                              <Download className="w-4 h-4 mr-2" />
                              Download
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              const fileUrl = doc.file_url || doc.data?.file_url;
                              if (fileUrl) {
                                window.open(fileUrl, '_blank');
                              } else {
                                alert('File URL not available for this document');
                              }
                            }}>
                              <Eye className="w-4 h-4 mr-2" />
                              View
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDelete(doc.id)}
                              className="text-red-600"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}