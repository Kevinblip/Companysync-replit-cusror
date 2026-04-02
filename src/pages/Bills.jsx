import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoleBasedData } from '@/components/hooks/useRoleBasedData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FileUp, DollarSign, Calendar, Loader2, CheckCircle, Clock, XCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export default function Bills() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [billData, setBillData] = useState({
    type: 'subcontract', // or 'vendor' or 'expense'
    subcontractor_id: '',
    vendor_id: '',
    project_id: '',
    amount: '',
    due_date: '',
    invoice_number: '',
    notes: '',
    status: 'pending'
  });
  const queryClient = useQueryClient();

  const { myCompany, isAdmin, hasPermission, isPermissionsReady, effectiveUserEmail } = useRoleBasedData();

  const { data: allExpenses = [] } = useQuery({
    queryKey: ['expenses', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Expense.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // 🔐 Filter expenses/bills: wait for permissions to be ready, then apply role checks
  const expenses = React.useMemo(() => {
    if (!isPermissionsReady || !effectiveUserEmail) return [];
    if (isAdmin || hasPermission('expenses', 'view_global')) return allExpenses;
    if (hasPermission('expenses', 'view_own')) {
      return allExpenses.filter(e => e.created_by === effectiveUserEmail || e.assigned_to === effectiveUserEmail);
    }
    return [];
  }, [allExpenses, effectiveUserEmail, isAdmin, hasPermission, isPermissionsReady]);

  const { data: subcontractors = [] } = useQuery({
    queryKey: ['subcontractors', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Subcontractor.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Project.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const uploadFileMutation = useMutation({
    mutationFn: async (file) => {
      const response = await base44.integrations.Core.UploadFile({ file });
      return response;
    }
  });

  const createBillMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.Expense.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setShowAddDialog(false);
      resetForm();
    }
  });

  const updateBillMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Expense.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    }
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setIsScanning(true);
    
    try {
      // Upload file
      toast.info('Uploading invoice...');
      const uploadResult = await uploadFileMutation.mutateAsync(file);
      const fileUrl = uploadResult.file_url;
      
      setBillData(prev => ({ ...prev, file_url: fileUrl }));
      
      // AI scan the receipt
      toast.info('🤖 AI analyzing invoice...');
      const extractResult = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url: fileUrl,
        json_schema: {
          type: "object",
          properties: {
            vendor_name: { type: "string", description: "Name of the vendor or company on the invoice" },
            amount: { type: "number", description: "Total amount due or paid" },
            invoice_number: { type: "string", description: "Invoice or reference number" },
            due_date: { type: "string", description: "Due date in YYYY-MM-DD format" },
            invoice_date: { type: "string", description: "Invoice date in YYYY-MM-DD format" },
            payment_method: { type: "string", description: "Payment method (cash, check, credit card, etc.)" },
            description: { type: "string", description: "Description of services or items" },
            reference_number: { type: "string", description: "Check number or transaction reference" }
          }
        }
      });
      
      if (extractResult?.output) {
        const extracted = extractResult.output;
        
        // Auto-fill form fields
        setBillData(prev => ({
          ...prev,
          vendor_name: extracted.vendor_name || prev.vendor_name,
          amount: extracted.amount?.toString() || prev.amount,
          invoice_number: extracted.invoice_number || prev.invoice_number,
          due_date: extracted.due_date || prev.due_date,
          notes: extracted.description || prev.notes,
          reference_number: extracted.reference_number || prev.reference_number
        }));
        
        // Try to match vendor to existing subcontractors
        if (extracted.vendor_name) {
          const matchedSub = subcontractors.find(s => 
            s.name?.toLowerCase().includes(extracted.vendor_name.toLowerCase()) ||
            extracted.vendor_name.toLowerCase().includes(s.name?.toLowerCase())
          );
          if (matchedSub) {
            setBillData(prev => ({ ...prev, subcontractor_id: matchedSub.id, type: 'subcontract' }));
            toast.success(`✨ Matched to ${matchedSub.name}!`);
          }
        }
        
        toast.success('✅ Invoice scanned successfully!');
      }
    } catch (error) {
      console.error('AI scan failed:', error);
      toast.error('AI scan failed, but file uploaded');
    } finally {
      setIsScanning(false);
    }
  };

  const handleSubmit = async () => {
    if (!myCompany) return;

    const expenseData = {
      company_id: myCompany.id,
      category: billData.type === 'subcontract' ? 'Subcontractor Payment' : 'Vendor Payment',
      amount: parseFloat(billData.amount),
      expense_date: new Date().toISOString().split('T')[0],
      payment_method: 'pending',
      description: billData.notes,
      project_id: billData.project_id || null,
      vendor_name: billData.type === 'subcontract' 
        ? subcontractors.find(s => s.id === billData.subcontractor_id)?.name
        : billData.vendor_name,
      invoice_number: billData.invoice_number,
      due_date: billData.due_date,
      file_url: billData.file_url,
      status: 'unpaid',
      tags: [billData.type]
    };

    await createBillMutation.mutateAsync(expenseData);
  };

  const resetForm = () => {
    setBillData({
      type: 'subcontract',
      subcontractor_id: '',
      vendor_id: '',
      project_id: '',
      amount: '',
      due_date: '',
      invoice_number: '',
      notes: '',
      status: 'pending'
    });
    setUploadedFile(null);
  };

  const getStatusBadge = (status) => {
    const styles = {
      unpaid: { icon: Clock, color: 'bg-orange-100 text-orange-800' },
      paid: { icon: CheckCircle, color: 'bg-green-100 text-green-800' },
      overdue: { icon: XCircle, color: 'bg-red-100 text-red-800' }
    };
    const { icon: Icon, color } = styles[status] || styles.unpaid;
    return (
      <Badge className={color}>
        <Icon className="w-3 h-3 mr-1" />
        {status}
      </Badge>
    );
  };

  const bills = expenses.filter(e => 
    e.tags?.includes('subcontract') || 
    e.category?.includes('Subcontractor') || 
    e.category?.includes('Vendor')
  );

  const totalUnpaid = bills
    .filter(b => b.status === 'unpaid')
    .reduce((sum, b) => sum + Number(b.amount || 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Bills & Payables</h1>
          <p className="text-gray-500 mt-1">Manage subcontractor and vendor invoices</p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} className="bg-blue-600 hover:bg-blue-700">
          <FileUp className="w-4 h-4 mr-2" />
          Add Bill
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Unpaid</p>
                <p className="text-2xl font-bold">${totalUnpaid.toLocaleString()}</p>
              </div>
              <DollarSign className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Bills</p>
                <p className="text-2xl font-bold">{bills.length}</p>
              </div>
              <FileUp className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">This Month</p>
                <p className="text-2xl font-bold">
                  {bills.filter(b => {
                    const date = new Date(b.expense_date || b.created_date);
                    return date.getMonth() === new Date().getMonth();
                  }).length}
                </p>
              </div>
              <Calendar className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bills List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Bills</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {bills.map(bill => (
              <div key={bill.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">{bill.vendor_name || 'Unnamed Vendor'}</p>
                      <p className="text-sm text-gray-600">
                        Invoice: {bill.invoice_number || 'N/A'} • Due: {bill.due_date || 'Not set'}
                      </p>
                      {bill.description && (
                        <p className="text-xs text-gray-500 mt-1">{bill.description}</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-lg font-bold">${bill.amount?.toLocaleString()}</p>
                    {getStatusBadge(bill.status || 'unpaid')}
                  </div>
                  {bill.status === 'unpaid' && (
                    <Button
                      size="sm"
                      onClick={() => updateBillMutation.mutate({
                        id: bill.id,
                        data: { status: 'paid', payment_date: new Date().toISOString().split('T')[0] }
                      })}
                      disabled={updateBillMutation.isPending}
                    >
                      Mark Paid
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {bills.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <FileUp className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No bills yet. Upload your first invoice to get started.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add Bill Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Bill to Pay</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* File Upload */}
            <div>
              <Label className="flex items-center gap-2">
                Upload Invoice
                <Badge variant="outline" className="bg-purple-50 text-purple-700">
                  <Sparkles className="w-3 h-3 mr-1" />
                  AI Scan
                </Badge>
              </Label>
              <div className="mt-2 border-2 border-dashed rounded-lg p-6 text-center">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                  disabled={isScanning}
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  {isScanning ? (
                    <>
                      <Loader2 className="w-8 h-8 mx-auto mb-2 text-purple-600 animate-spin" />
                      <p className="text-sm text-purple-600 font-medium">
                        AI analyzing invoice...
                      </p>
                    </>
                  ) : (
                    <>
                      <FileUp className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm text-gray-600">
                        {uploadedFile ? uploadedFile.name : 'Click to upload invoice (PDF, PNG, JPEG)'}
                      </p>
                      <p className="text-xs text-purple-600 mt-1">AI will auto-fill vendor, amount, and more</p>
                    </>
                  )}
                </label>
              </div>
            </div>

            {/* Bill Type */}
            <div>
              <Label>Bill Type</Label>
              <Select value={billData.type} onValueChange={(v) => setBillData(prev => ({ ...prev, type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subcontract">For a Subcontractor</SelectItem>
                  <SelectItem value="vendor">Vendor/Supplier</SelectItem>
                  <SelectItem value="expense">One-off Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Subcontractor/Vendor */}
            {billData.type === 'subcontract' && (
              <div>
                <Label>Subcontractor</Label>
                <Select value={billData.subcontractor_id} onValueChange={(v) => setBillData(prev => ({ ...prev, subcontractor_id: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select subcontractor" />
                  </SelectTrigger>
                  <SelectContent>
                    {subcontractors.map(sub => (
                      <SelectItem key={sub.id} value={sub.id}>{sub.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {billData.type === 'vendor' && (
              <div>
                <Label>Vendor Name</Label>
                <Input
                  value={billData.vendor_name || ''}
                  onChange={(e) => setBillData(prev => ({ ...prev, vendor_name: e.target.value }))}
                  placeholder="Enter vendor name"
                />
              </div>
            )}

            {/* Project */}
            <div>
              <Label>Project (Optional)</Label>
              <Select value={billData.project_id} onValueChange={(v) => setBillData(prev => ({ ...prev, project_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(proj => (
                    <SelectItem key={proj.id} value={proj.id}>{proj.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount</Label>
                <Input
                  type="number"
                  value={billData.amount}
                  onChange={(e) => setBillData(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={billData.due_date}
                  onChange={(e) => setBillData(prev => ({ ...prev, due_date: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label>Invoice Number</Label>
              <Input
                value={billData.invoice_number}
                onChange={(e) => setBillData(prev => ({ ...prev, invoice_number: e.target.value }))}
                placeholder="INV-001"
              />
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                value={billData.notes}
                onChange={(e) => setBillData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional notes..."
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={createBillMutation.isPending || !billData.amount}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {createBillMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Bill'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}