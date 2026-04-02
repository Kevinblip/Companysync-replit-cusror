import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  FileSignature,
  Plus,
  Send,
  Eye,
  CheckCircle,
  Clock,
  XCircle,
  Mail,
  Download,
  Edit,
  ExternalLink,
  Trash2,
  Pencil
} from "lucide-react";
import { format } from "date-fns";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";

export default function ContractSigning() {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedSignature, setSelectedSignature] = useState(null);
  const [sessionFields, setSessionFields] = useState(null);
  const [sessionFieldsLoading, setSessionFieldsLoading] = useState(false);
  const [editSession, setEditSession] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [user, setUser] = useState(null);
  const [formData, setFormData] = useState({
    document_type: "contract",
    document_number: "",
    signer_name: "",
    signer_email: "",
    expires_at: ""
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  // Fetch customer-filled fields from local DB whenever a session is selected
  // (local DB is updated on customer sign; base44 entity status may lag behind)
  useEffect(() => {
    if (!selectedSignature) {
      setSessionFields(null);
      return;
    }
    setSessionFieldsLoading(true);
    fetch(`/api/contracts/session-fields?base44_id=${encodeURIComponent(selectedSignature.id)}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setSessionFields(data);
        else setSessionFields(null);
      })
      .catch(() => setSessionFields(null))
      .finally(() => setSessionFieldsLoading(false));
  }, [selectedSignature?.id]);

  const { company: myCompany } = useCurrentCompany(user);
  const { isAdmin, hasPermission } = useRoleBasedData();
  const canEdit = isAdmin || hasPermission('contract_signing', 'edit');
  const canDelete = isAdmin || hasPermission('contract_signing', 'delete');

  const { data: allSigningSessions = [] } = useQuery({
    queryKey: ['signing-sessions', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ContractSigningSession.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const signingSessions = isAdmin
    ? allSigningSessions
    : allSigningSessions.filter(s => s.rep_email && user?.email && s.rep_email.toLowerCase() === user.email.toLowerCase());

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: estimates = [] } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: contracts = [] } = useQuery({
    queryKey: ['contracts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Contract.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // Auto-create a Contract record whenever a signing session reaches "completed"
  const syncedRef = useRef(new Set());
  useEffect(() => {
    if (!myCompany || allSigningSessions.length === 0) return;

    const linkedSessionIds = new Set(
      contracts
        .map(c => (c.notes || '').match(/esig:([a-zA-Z0-9_-]+)/)?.[1])
        .filter(Boolean)
    );

    const unlinked = allSigningSessions.filter(
      s => s.status === 'completed' &&
        !linkedSessionIds.has(s.id) &&
        !syncedRef.current.has(s.id)
    );

    if (unlinked.length === 0) return;

    const createContracts = async () => {
      for (const session of unlinked) {
        syncedRef.current.add(session.id);
        try {
          await base44.entities.Contract.create({
            company_id: myCompany.id,
            contract_name: session.contract_name || 'Signed Contract',
            customer_name: session.signer_name || session.customer_name || '',
            contract_type: 'service',
            status: 'signed',
            start_date: session.completed_at
              ? session.completed_at.split('T')[0]
              : new Date().toISOString().split('T')[0],
            notes: `[E-Signature] Signed via CompanySync e-signature. esig:${session.id}`,
          });
        } catch (err) {
          console.error('Failed to create contract from session', session.id, err);
          syncedRef.current.delete(session.id);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['contracts', myCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-contracts'] });
    };

    createContracts();
  }, [allSigningSessions, contracts, myCompany]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const signatureData = {
        ...data,
        company_id: myCompany?.id,
        status: 'pending'
      };
      console.log('Creating signature request:', signatureData);
      return await base44.entities.Signature.create(signatureData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signatures'] });
      setShowCreateDialog(false);
      setFormData({
        document_type: "contract",
        document_number: "",
        signer_name: "",
        signer_email: "",
        expires_at: ""
      });
      alert('✅ Signature request created successfully!');
    },
    onError: (error) => {
      console.error('Error creating signature:', error);
      alert('❌ Error: ' + error.message);
    }
  });

  const cleanupOldSessionsMutation = useMutation({
    mutationFn: async () => {
      const allSessions = myCompany ? await base44.entities.ContractSigningSession.filter({ company_id: myCompany.id }, '-created_date', 1000) : [];
      
      // Filter sessions to delete:
      // 1. Status is 'draft' AND created more than 24 hours ago
      // 2. Status is 'declined' or 'expired'
      // 3. Keep ALL 'signed_by_rep', 'awaiting_customer', 'customer_signed', 'completed'
      
      const oneDayAgo = new Date();
      oneDayAgo.setHours(oneDayAgo.getHours() - 24);
      
      const sessionsToDelete = allSessions.filter(session => {
        const isDraftOld = session.status === 'draft' && new Date(session.created_date) < oneDayAgo;
        const isDead = ['declined', 'expired'].includes(session.status);
        return isDraftOld || isDead;
      });
      
      for (const session of sessionsToDelete) {
        await base44.entities.ContractSigningSession.delete(session.id);
      }
      
      return { deleted: sessionsToDelete.length };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['signing-sessions'] });
      alert(`✅ Cleaned up ${data.deleted} old drafts/declined sessions. Active contracts were kept.`);
    },
    onError: (error) => {
      alert('❌ Error: ' + error.message);
    }
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId) => {
      await base44.entities.ContractSigningSession.delete(sessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signing-sessions'] });
    },
    onError: (error) => {
      alert('❌ Error deleting session: ' + error.message);
    }
  });

  const updateSessionMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      await base44.entities.ContractSigningSession.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signing-sessions'] });
      setEditSession(null);
    },
    onError: (error) => {
      alert('❌ Error updating session: ' + error.message);
    }
  });

  const handleDeleteSession = (session) => {
    if (!window.confirm(`Delete contract session "${session.contract_name}" for ${session.customer_name}? This cannot be undone.`)) return;
    deleteSessionMutation.mutate(session.id);
  };

  const handleEditSession = (session) => {
    setEditForm({
      contract_name: session.contract_name || '',
      customer_name: session.customer_name || '',
      customer_email: session.customer_email || '',
      customer_phone: session.customer_phone || '',
      status: session.status || 'draft',
    });
    setEditSession(session);
  };

  const handleSaveEdit = () => {
    if (!editForm.contract_name || !editForm.customer_name) {
      alert('Contract name and customer name are required.');
      return;
    }
    updateSessionMutation.mutate({ id: editSession.id, data: editForm });
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    
    if (!formData.document_number || !formData.signer_name || !formData.signer_email) {
      alert('Please fill in all required fields');
      return;
    }

    createMutation.mutate(formData);
  };

  const handleCustomerSelect = (customerId) => {
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      setFormData({
        ...formData,
        signer_name: customer.name,
        signer_email: customer.email || ''
      });
    }
  };

  const getStatusBadge = (status) => {
    const config = {
      draft: { color: "bg-gray-100 text-gray-700", icon: Edit, label: "Draft" },
      signed_by_rep: { color: "bg-blue-100 text-blue-700", icon: CheckCircle, label: "Rep Signed" },
      awaiting_customer: { color: "bg-yellow-100 text-yellow-700", icon: Clock, label: "Pending Customer" },
      completed: { color: "bg-green-100 text-green-700", icon: CheckCircle, label: "Completed" },
      declined: { color: "bg-red-100 text-red-700", icon: XCircle, label: "Declined" },
      expired: { color: "bg-gray-100 text-gray-700", icon: Clock, label: "Expired" }
    };

    const { color, icon: Icon, label } = config[status] || config.draft;

    return (
      <Badge variant="outline" className={`${color} flex items-center gap-1`}>
        <Icon className="w-3 h-3" />
        {label}
      </Badge>
    );
  };

  const stats = {
    total: signingSessions.length,
    pending: signingSessions.filter(s => s.status === 'awaiting_customer' || s.status === 'signed_by_rep').length,
    signed: signingSessions.filter(s => s.status === 'completed').length,
    declined: signingSessions.filter(s => s.status === 'declined').length
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">E-Signature Requests</h1>
          <p className="text-gray-500 mt-1">Send documents for electronic signature</p>
        </div>

        <div className="flex gap-2">
          {signingSessions.length > 1 && (
            <Button
              variant="outline"
              onClick={() => {
                if (window.confirm(`Delete all old sessions and keep only the newest one?`)) {
                  cleanupOldSessionsMutation.mutate();
                }
              }}
              disabled={cleanupOldSessionsMutation.isPending}
            >
              {cleanupOldSessionsMutation.isPending ? 'Cleaning...' : 'Cleanup Old Sessions'}
            </Button>
          )}
        </div>
      </div>

      {/* Removed legacy "New Signature Request" - use Contract Templates instead */}
      <div className="flex justify-end">
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Signature Request</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Document Type *</Label>
                <Select
                  value={formData.document_type}
                  onValueChange={(v) => setFormData({...formData, document_type: v})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="estimate">Estimate</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="agreement">Agreement</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Document/Reference Number *</Label>
                <Input
                  value={formData.document_number}
                  onChange={(e) => setFormData({...formData, document_number: e.target.value})}
                  placeholder="e.g., EST-1234 or CON-5678"
                  required
                />
              </div>

              <div>
                <Label>Quick Select Customer (Optional)</Label>
                <Select onValueChange={handleCustomerSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a customer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map(customer => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name} {customer.email ? `(${customer.email})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Signer Name *</Label>
                  <Input
                    value={formData.signer_name}
                    onChange={(e) => setFormData({...formData, signer_name: e.target.value})}
                    placeholder="John Smith"
                    required
                  />
                </div>

                <div>
                  <Label>Signer Email *</Label>
                  <Input
                    type="email"
                    value={formData.signer_email}
                    onChange={(e) => setFormData({...formData, signer_email: e.target.value})}
                    placeholder="john@example.com"
                    required
                  />
                </div>
              </div>

              <div>
                <Label>Expires On (Optional)</Label>
                <Input
                  type="date"
                  value={formData.expires_at}
                  onChange={(e) => setFormData({...formData, expires_at: e.target.value})}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || !formData.document_number || !formData.signer_name || !formData.signer_email}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Request'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Requests</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <FileSignature className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Pending</p>
                <p className="text-2xl font-bold">{stats.pending}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Signed</p>
                <p className="text-2xl font-bold">{stats.signed}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Declined</p>
                <p className="text-2xl font-bold">{stats.declined}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Signing Sessions List */}
      <Card>
        <CardHeader>
          <CardTitle>Contract Signing Sessions ({signingSessions.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contract</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sent</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Completed</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {signingSessions.map((session) => (
                  <tr key={session.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900">{session.contract_name}</p>
                        <p className="text-sm text-gray-500">{session.template_name}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900">{session.customer_name}</p>
                        <p className="text-sm text-gray-500">{session.customer_email || session.customer_phone}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(session.status)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {session.sent_to_customer_at 
                        ? format(new Date(session.sent_to_customer_at), 'MMM d, yyyy')
                        : '-'
                      }
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {session.customer_signed_at 
                        ? format(new Date(session.customer_signed_at), 'MMM d, yyyy')
                        : '-'
                      }
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {session.final_pdf_url && (
                          <Button
                            data-testid={`button-download-${session.id}`}
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(session.final_pdf_url, '_blank')}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          data-testid={`button-view-${session.id}`}
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedSignature(session)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canEdit && (
                          <Button
                            data-testid={`button-edit-${session.id}`}
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditSession(session)}
                            title="Edit session"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            data-testid={`button-delete-${session.id}`}
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                            onClick={() => handleDeleteSession(session)}
                            disabled={deleteSessionMutation.isPending}
                            title="Delete session"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {signingSessions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      <FileSignature className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                      <p className="font-medium">No contract signing sessions yet</p>
                      <p className="text-sm mt-1">Go to Contract Templates to send contracts for signing</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* View Session Dialog */}
      {selectedSignature && (
        <Dialog open={!!selectedSignature} onOpenChange={() => setSelectedSignature(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-3">
                <span>Contract Signing Details</span>
                {getStatusBadge(selectedSignature.status)}
              </DialogTitle>
            </DialogHeader>

            <div className="overflow-y-auto flex-1 space-y-4 pr-1">
              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded text-sm">
                <div>
                  <p className="text-gray-500">Contract Name</p>
                  <p className="font-medium">{selectedSignature.contract_name}</p>
                </div>
                <div>
                  <p className="text-gray-500">Template</p>
                  <p className="font-medium">{selectedSignature.template_name}</p>
                </div>
                <div>
                  <p className="text-gray-500">Customer</p>
                  <p className="font-medium">{selectedSignature.customer_name}</p>
                </div>
                <div>
                  <p className="text-gray-500">Customer Contact</p>
                  <p className="font-medium">{selectedSignature.customer_email || selectedSignature.customer_phone || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500">Rep/Sales Person</p>
                  <p className="font-medium">{selectedSignature.rep_name || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500">Delivery Method</p>
                  <p className="font-medium capitalize">{selectedSignature.delivery_method || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500">Rep Signed</p>
                  <p className="font-medium">
                    {selectedSignature.rep_signed_at
                      ? format(new Date(selectedSignature.rep_signed_at), 'PPP')
                      : 'Not signed yet'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Customer Signed</p>
                  <p className="font-medium">
                    {selectedSignature.customer_signed_at
                      ? format(new Date(selectedSignature.customer_signed_at), 'PPP')
                      : 'Not signed yet'}
                  </p>
                </div>
                {selectedSignature.sent_to_customer_at && (
                  <div>
                    <p className="text-gray-500">Sent to Customer</p>
                    <p className="font-medium">{format(new Date(selectedSignature.sent_to_customer_at), 'PPP')}</p>
                  </div>
                )}
                {selectedSignature.expires_at && (
                  <div>
                    <p className="text-gray-500">Expires</p>
                    <p className="font-medium">{format(new Date(selectedSignature.expires_at), 'PPP')}</p>
                  </div>
                )}
              </div>

              {/* Customer-filled fields (fetched from local DB after signing) */}
              {(sessionFields?.customer_signed_at || (sessionFields && Object.keys(sessionFields.customer_fields || {}).length > 0)) && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-green-50 border-b border-green-200">
                    <p className="text-sm font-semibold text-green-800">Customer-Filled Information</p>
                  </div>
                  <div className="p-4">
                    {sessionFieldsLoading ? (
                      <p className="text-sm text-gray-400">Loading filled data…</p>
                    ) : sessionFields && Object.keys(sessionFields.customer_fields || {}).length > 0 ? (
                      <div className="grid grid-cols-2 gap-3">
                        {Object.entries(sessionFields.customer_fields).map(([key, value]) => (
                          <div key={key} className="bg-gray-50 rounded p-2">
                            <p className="text-xs text-gray-500 capitalize">{key.replace(/_/g, ' ')}</p>
                            <p className="text-sm font-medium">{value || '—'}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No fields were filled by the customer, or data not yet synced.</p>
                    )}
                    {sessionFields?.customer_signature_data && (
                      <div className="mt-3 border-t pt-3">
                        <p className="text-xs text-gray-500 mb-1">Customer Signature</p>
                        <img src={sessionFields.customer_signature_data} alt="Customer Signature" className="max-h-16 border rounded bg-white p-1" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Contract document */}
              {(selectedSignature.original_file_url || selectedSignature.final_pdf_url) && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b">
                    <p className="text-sm font-medium text-gray-700">
                      {selectedSignature.final_pdf_url ? 'Signed Contract' : 'Contract Document'}
                    </p>
                    <div className="flex gap-2">
                      {selectedSignature.final_pdf_url && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => window.open(selectedSignature.final_pdf_url, '_blank')}
                        >
                          <Download className="w-3 h-3 mr-1" />
                          Download Signed
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => window.open(selectedSignature.original_file_url || selectedSignature.final_pdf_url, '_blank')}
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Open Full Screen
                      </Button>
                    </div>
                  </div>
                  <iframe
                    src={selectedSignature.final_pdf_url || selectedSignature.original_file_url}
                    className="w-full"
                    style={{ height: '420px', border: 'none' }}
                    title="Contract Document"
                  />
                </div>
              )}

              {/* Signatures */}
              {selectedSignature.rep_signature_url && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-2">Rep Signature:</p>
                  <div className="border rounded p-4 bg-white">
                    <img src={selectedSignature.rep_signature_url} alt="Rep Signature" className="max-h-24 w-auto" />
                  </div>
                </div>
              )}

              {selectedSignature.customer_signature_url && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-2">Customer Signature:</p>
                  <div className="border rounded p-4 bg-white">
                    <img src={selectedSignature.customer_signature_url} alt="Customer Signature" className="max-h-24 w-auto" />
                  </div>
                </div>
              )}

              {/* Customer notes */}
              {selectedSignature.customer_notes && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-2">Customer Notes:</p>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded p-3">{selectedSignature.customer_notes}</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
      {/* Edit Session Dialog */}
      {editSession && (
        <Dialog open={!!editSession} onOpenChange={() => setEditSession(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Contract Session</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Contract Name</Label>
                <Input
                  data-testid="input-edit-contract-name"
                  value={editForm.contract_name}
                  onChange={(e) => setEditForm({ ...editForm, contract_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Customer Name</Label>
                <Input
                  data-testid="input-edit-customer-name"
                  value={editForm.customer_name}
                  onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Customer Email</Label>
                <Input
                  data-testid="input-edit-customer-email"
                  type="email"
                  value={editForm.customer_email}
                  onChange={(e) => setEditForm({ ...editForm, customer_email: e.target.value })}
                />
              </div>
              <div>
                <Label>Customer Phone</Label>
                <Input
                  data-testid="input-edit-customer-phone"
                  value={editForm.customer_phone}
                  onChange={(e) => setEditForm({ ...editForm, customer_phone: e.target.value })}
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={editForm.status} onValueChange={(val) => setEditForm({ ...editForm, status: val })}>
                  <SelectTrigger data-testid="select-edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="signed_by_rep">Rep Signed</SelectItem>
                    <SelectItem value="awaiting_customer">Pending Customer</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditSession(null)}>Cancel</Button>
              <Button
                data-testid="button-save-edit"
                onClick={handleSaveEdit}
                disabled={updateSessionMutation.isPending}
              >
                {updateSessionMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}