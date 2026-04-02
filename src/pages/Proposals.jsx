import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import useTranslation from "@/hooks/useTranslation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  Plus, 
  FileText, 
  Eye, 
  Send, 
  Trash2, 
  Search, 
  CheckCircle, 
  XCircle, 
  Clock,
  Columns3,
  Download,
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import useRoleBasedData from "@/components/hooks/useRoleBasedData";

export default function Proposals() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  
  const [formData, setFormData] = useState({
    proposal_number: "",
    customer_name: "",
    customer_email: "",
    title: "",
    amount: 0,
    status: "draft",
    valid_until: "",
    sections: [],
    terms: "",
    notes: ""
  });

  const [visibleColumns, setVisibleColumns] = useState({
    proposal_number: true,
    customer_name: true,
    title: true,
    amount: true,
    status: true,
    created_date: true,
    valid_until: true,
    actions: true,
  });

  const { user, myCompany, isAdmin, hasPermission, effectiveUserEmail, filterCustomers, filterProposals } = useRoleBasedData();

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // 🔐 Filter customers based on role permissions
  const customers = React.useMemo(() => filterCustomers(allCustomers), [allCustomers, filterCustomers]);

  const { data: allProposals = [] } = useQuery({
    queryKey: ['proposals', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Proposal.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // 🔐 Filter proposals using hook's canonical filter (respects customer assignments)
  const proposals = React.useMemo(() => filterProposals(allProposals, customers), [allProposals, customers, filterProposals]);

  const createProposalMutation = useMutation({
    mutationFn: async (data) => {
      const newProposal = await base44.entities.Proposal.create({
        ...data,
        company_id: myCompany?.id,
      });

      // 🔔 Send notifications for new proposal
      if (myCompany?.id) {
        try {
          const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
          const ownerEmail = myCompany?.created_by;
          
          const customer = customers.find(c => c.name === newProposal.customer_name);
          let assigneeEmails = [];
          if (customer) {
            assigneeEmails = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
          }
          
          const notifyEmails = [...new Set([...assigneeEmails, ...(ownerEmail ? [ownerEmail] : []), user?.email])];

          for (const email of notifyEmails) {
            const isAssignee = assigneeEmails.includes(email);
            
            await base44.entities.Notification.create({
              company_id: myCompany.id,
              user_email: email,
              title: '📋 New Proposal Created',
              message: `Proposal ${newProposal.proposal_number}: ${newProposal.title} - $${newProposal.amount}${isAssignee ? ' (your customer)' : ''}`,
              type: 'proposal_created',
              related_entity_type: 'Proposal',
              related_entity_id: newProposal.id,
              link_url: '/proposals',
              is_read: false,
            });

            await base44.integrations.Core.SendEmail({
              to: email,
              from_name: myCompany.company_name || 'CRM',
              subject: `📋 New Proposal: ${newProposal.proposal_number}`,
              html: `<h2>Proposal Created</h2>
                ${isAssignee ? '<p style="color: green;"><strong>This is for your customer!</strong></p>' : ''}
                <p><strong>Proposal:</strong> ${newProposal.proposal_number}</p>
                <p><strong>Title:</strong> ${newProposal.title}</p>
                <p><strong>Customer:</strong> ${newProposal.customer_name}</p>
                <p><strong>Amount:</strong> $${newProposal.amount}</p>
                <p><strong>Created by:</strong> ${user?.full_name || user?.email}</p>
                <p><a href="${window.location.origin}/proposals">View Proposals</a></p>`
            });
          }

          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'proposal_created',
            companyId: myCompany.id,
            entityType: 'Proposal',
            entityId: newProposal.id,
            entityData: {
              proposal_number: newProposal.proposal_number,
              customer_name: newProposal.customer_name,
              customer_email: newProposal.customer_email || '',
              title: newProposal.title,
              amount: newProposal.amount,
              app_url: window.location.origin
            }
          });
        } catch (error) {
          console.error('Failed to send proposal notifications:', error);
        }
      }

      return newProposal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
      setShowForm(false);
      setFormData({
        proposal_number: "",
        customer_name: "",
        customer_email: "",
        title: "",
        amount: 0,
        status: "draft",
        valid_until: "",
        sections: [],
        terms: "",
        notes: ""
      });
    },
  });

  const updateProposalMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const oldProposal = proposals.find(p => p.id === id);
      const updatedProposal = await base44.entities.Proposal.update(id, data);

      // 🔔 Send notifications on status change
      if (myCompany?.id && data.status && oldProposal?.status !== data.status) {
        try {
          const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
          const ownerEmail2 = myCompany?.created_by;
          
          const customer = customers.find(c => c.name === updatedProposal.customer_name);
          let assigneeEmails = [];
          if (customer) {
            assigneeEmails = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
          }
          
          const notifyEmails = [...new Set([...assigneeEmails, ...(ownerEmail2 ? [ownerEmail2] : []), user?.email])];

          for (const email of notifyEmails) {
            const isAssignee = assigneeEmails.includes(email);
            const statusEmoji = data.status === 'accepted' ? '✅' : data.status === 'declined' ? '❌' : '📝';
            
            await base44.entities.Notification.create({
              company_id: myCompany.id,
              user_email: email,
              title: `${statusEmoji} Proposal ${data.status === 'accepted' ? 'Accepted' : data.status === 'declined' ? 'Declined' : 'Updated'}`,
              message: `Proposal ${updatedProposal.proposal_number} ${data.status === 'accepted' ? 'accepted' : data.status === 'declined' ? 'declined' : 'status changed'} by ${updatedProposal.customer_name}${isAssignee ? ' (your customer)' : ''}`,
              type: 'proposal_status_changed',
              related_entity_type: 'Proposal',
              related_entity_id: id,
              link_url: '/proposals',
              is_read: false,
            });

            await base44.integrations.Core.SendEmail({
              to: email,
              from_name: myCompany.company_name || 'CRM',
              subject: `${statusEmoji} Proposal ${data.status.charAt(0).toUpperCase() + data.status.slice(1)}: ${updatedProposal.proposal_number}`,
              html: `<h2>Proposal Status Update</h2>
                ${isAssignee ? '<p style="color: green;"><strong>This is for your customer!</strong></p>' : ''}
                <p><strong>Proposal:</strong> ${updatedProposal.proposal_number}</p>
                <p><strong>Title:</strong> ${updatedProposal.title}</p>
                <p><strong>Customer:</strong> ${updatedProposal.customer_name}</p>
                <p><strong>Amount:</strong> $${updatedProposal.amount}</p>
                <p><strong>Status:</strong> ${oldProposal.status} → <strong>${data.status}</strong></p>
                <p><a href="${window.location.origin}/proposals">View Proposals</a></p>`
            });
          }

          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'proposal_status_changed',
            companyId: myCompany.id,
            entityType: 'Proposal',
            entityId: id,
            entityData: {
              proposal_number: updatedProposal.proposal_number,
              customer_name: updatedProposal.customer_name,
              customer_email: updatedProposal.customer_email || '',
              title: updatedProposal.title,
              amount: updatedProposal.amount,
              old_status: oldProposal.status,
              new_status: data.status,
              status: data.status,
              app_url: window.location.origin
            }
          });
        } catch (error) {
          console.error('Failed to send proposal status change notifications:', error);
        }
      }

      return updatedProposal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
    },
  });

  const deleteProposalMutation = useMutation({
    mutationFn: (id) => base44.entities.Proposal.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });

  const generateNextProposalNumber = () => {
    if (proposals.length === 0) {
      return "PROP-0001";
    }
    
    const numbers = proposals
      .map(prop => prop.proposal_number)
      .filter(num => num && num.startsWith('PROP-'))
      .map(num => parseInt(num.replace('PROP-', '')))
      .filter(num => !isNaN(num));
    
    if (numbers.length === 0) {
      return "PROP-0001";
    }
    
    const maxNumber = Math.max(...numbers);
    const nextNumber = maxNumber + 1;
    return `PROP-${nextNumber.toString().padStart(4, '0')}`;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!myCompany) {
      alert("Please set up your company profile first or be linked to one as staff!");
      return;
    }
    createProposalMutation.mutate(formData);
  };

  const handleDelete = (proposalId) => {
    if (window.confirm("Are you sure you want to delete this proposal?")) {
      deleteProposalMutation.mutate(proposalId);
    }
  };

  const handleCreateNew = () => {
    const nextNumber = generateNextProposalNumber();
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);
    
    setFormData({
      proposal_number: nextNumber,
      customer_name: "",
      customer_email: "",
      title: "",
      amount: 0,
      status: "draft",
      valid_until: validUntil.toISOString().split('T')[0],
      sections: [],
      terms: "",
      notes: ""
    });
    setShowForm(true);
  };

  const handleExport = () => {
    const headers = ['Proposal #', 'Customer', 'Email', 'Title', 'Amount', 'Status', 'Date', 'Valid Until'];
    const rows = filteredProposals.map(prop => [
      prop.proposal_number,
      prop.customer_name,
      prop.customer_email || '',
      prop.title,
      Number(prop.amount || 0).toFixed(2) || '0.00',
      prop.status || 'draft',
      prop.created_date ? format(new Date(prop.created_date), 'yyyy-MM-dd') : '',
      prop.valid_until ? format(new Date(prop.valid_until), 'yyyy-MM-dd') : ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proposals_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const filteredProposals = proposals
    .filter(prop => 
      statusFilter === 'all' || (statusFilter === 'draft' && (!prop.status || prop.status === 'draft')) || prop.status === statusFilter
    )
    .filter(prop =>
      prop.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      prop.proposal_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      prop.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      prop.customer_email?.toLowerCase().includes(searchTerm.toLowerCase())
    );

  const totalPages = itemsPerPage === 99999 ? 1 : Math.ceil(filteredProposals.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = itemsPerPage === 99999 ? filteredProposals.length : startIndex + itemsPerPage;
  const paginatedProposals = filteredProposals.slice(startIndex, endIndex);

  const getStatusBadge = (status) => {
    const statusConfig = {
      draft: { color: "bg-gray-100 text-gray-700", icon: Clock },
      sent: { color: "bg-blue-100 text-blue-700", icon: Send },
      viewed: { color: "bg-purple-100 text-purple-700", icon: Eye },
      accepted: { color: "bg-green-100 text-green-700", icon: CheckCircle },
      declined: { color: "bg-red-100 text-red-700", icon: XCircle },
    };

    const config = statusConfig[status] || statusConfig.draft;
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} flex items-center justify-center gap-1`}>
        <Icon className="w-3 h-3" />
        <span className="capitalize">{t.estimates[status] || status || t.estimates.draft}</span>
      </Badge>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.proposals}</h1>
          <p className="text-gray-500 mt-1">{filteredProposals.length} {t.sidebar.proposals.toLowerCase()}</p>
        </div>
        
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogTrigger asChild>
            <Button onClick={handleCreateNew} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              {t.common.create} {t.sidebar.proposals.slice(0, -1)}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t.common.create} {t.common.new} {t.sidebar.proposals.slice(0, -1)}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="proposal_number">{t.sidebar.proposals.slice(0, -1)} Number *</Label>
                  <Input
                    id="proposal_number"
                    value={formData.proposal_number}
                    readOnly
                    className="bg-gray-50 cursor-not-allowed"
                  />
                </div>
                <div>
                  <Label htmlFor="valid_until">{t.estimates.validUntil} *</Label>
                  <Input
                    id="valid_until"
                    type="date"
                    value={formData.valid_until}
                    onChange={(e) => setFormData(prev => ({...prev, valid_until: e.target.value}))}
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="customer_name">{t.estimates.customer} *</Label>
                <Input
                  id="customer_name"
                  value={formData.customer_name}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFormData(prev => ({...prev, customer_name: value}));
                    
                    const matchingCustomer = customers.find(c => c.name?.toLowerCase() === value?.toLowerCase());
                    if (matchingCustomer) {
                      setFormData(prev => ({
                        ...prev,
                        customer_email: matchingCustomer.email || ""
                      }));
                    }
                  }}
                  placeholder={t.common.search + " " + t.estimates.customer.toLowerCase()}
                  list="customers-list-proposals"
                  required
                />
                <datalist id="customers-list-proposals">
                  {customers.map((customer, idx) => (
                    <option key={idx} value={customer.name}>
                      {customer.email ? `${customer.name} (${customer.email})` : customer.name}
                    </option>
                  ))}
                </datalist>
              </div>

              <div>
                <Label htmlFor="customer_email">{t.common.email}</Label>
                <Input
                  id="customer_email"
                  type="email"
                  value={formData.customer_email}
                  onChange={(e) => setFormData(prev => ({...prev, customer_email: e.target.value}))}
                  placeholder="customer@example.com"
                />
              </div>

              <div>
                <Label htmlFor="title">{t.common.name} *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({...prev, title: e.target.value}))}
                  placeholder="Project or service title"
                  required
                />
              </div>

              <div>
                <Label htmlFor="amount">{t.common.amount} *</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData(prev => ({...prev, amount: parseFloat(e.target.value) || 0}))}
                  required
                />
              </div>

              <div>
                <Label htmlFor="notes">{t.common.notes}</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({...prev, notes: e.target.value}))}
                  placeholder="Internal notes..."
                  rows={3}
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="w-full sm:w-auto">
                  {t.common.cancel}
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto">
                  {t.common.create} {t.sidebar.proposals.slice(0, -1)}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder={t.common.search + " " + t.sidebar.proposals.toLowerCase() + "..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          <Select value={itemsPerPage.toString()} onValueChange={(val) => {
            setItemsPerPage(val === 'all' ? 99999 : parseInt(val));
            setCurrentPage(1);
          }}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="250">250</SelectItem>
              <SelectItem value="500">500</SelectItem>
              <SelectItem value="all">{t.common.all}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t.common.filter + " " + t.common.status.toLowerCase()} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all} {t.common.status}es</SelectItem>
              <SelectItem value="draft">{t.estimates.draft}</SelectItem>
              <SelectItem value="sent">{t.estimates.sent}</SelectItem>
              <SelectItem value="viewed">{t.estimates.viewed || 'Viewed'}</SelectItem>
              <SelectItem value="accepted">{t.estimates.accepted}</SelectItem>
              <SelectItem value="declined">{t.estimates.declined}</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <Columns3 className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {Object.keys(visibleColumns).filter(key => key !== 'actions').map(key => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={visibleColumns[key]}
                  onCheckedChange={(checked) => setVisibleColumns(prev => ({...prev, [key]: checked}))}
                >
                  {key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="icon" onClick={handleExport} title={t.common.export}>
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Card className="bg-white shadow-md">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-gray-50">
                <tr className="text-left text-xs text-gray-600 uppercase tracking-wider">
                  {visibleColumns.proposal_number && <th className="p-4 font-medium">{t.sidebar.proposals.slice(0, -1)} #</th>}
                  {visibleColumns.customer_name && <th className="p-4 font-medium">{t.estimates.customer}</th>}
                  {visibleColumns.title && <th className="p-4 font-medium">{t.common.name}</th>}
                  {visibleColumns.amount && <th className="p-4 font-medium">{t.common.amount}</th>}
                  {visibleColumns.status && <th className="p-4 font-medium">{t.common.status}</th>}
                  {visibleColumns.created_date && <th className="p-4 font-medium">{t.estimates.date}</th>}
                  {visibleColumns.valid_until && <th className="p-4 font-medium">{t.estimates.validUntil}</th>}
                  {visibleColumns.actions && <th className="p-4 font-medium text-right">{t.common.actions}</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedProposals.map((proposal) => (
                  <tr key={proposal.id} className="border-b hover:bg-gray-50 transition-colors">
                    {visibleColumns.proposal_number && (
                      <td className="p-4">
                        <span className="font-medium text-blue-600">{proposal.proposal_number}</span>
                      </td>
                    )}
                    {visibleColumns.customer_name && (
                      <td className="p-4">
                        <div>
                          <button
                            onClick={() => navigate(createPageUrl('CustomerProfile') + '?name=' + encodeURIComponent(proposal.customer_name))}
                            className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                          >
                            {proposal.customer_name}
                          </button>
                          {proposal.customer_email && (
                            <div className="text-xs text-gray-500">{proposal.customer_email}</div>
                          )}
                        </div>
                      </td>
                    )}
                    {visibleColumns.title && (
                      <td className="p-4 text-gray-700">{proposal.title}</td>
                    )}
                    {visibleColumns.amount && (
                      <td className="p-4">
                        <div className="font-semibold text-green-600">
                          ${Number(proposal.amount || 0).toFixed(2) || '0.00'}
                        </div>
                      </td>
                    )}
                    {visibleColumns.status && (
                      <td className="p-4">
                        {getStatusBadge(proposal.status)}
                      </td>
                    )}
                    {visibleColumns.created_date && (
                      <td className="p-4 text-sm text-gray-600">
                        {proposal.created_date ? format(new Date(proposal.created_date), 'MMM d, yyyy') : '-'}
                      </td>
                    )}
                    {visibleColumns.valid_until && (
                      <td className="p-4 text-sm text-gray-600">
                        {proposal.valid_until ? format(new Date(proposal.valid_until), 'MMM d, yyyy') : '-'}
                      </td>
                    )}
                    {visibleColumns.actions && (
                      <td className="p-4 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDelete(proposal.id)}
                          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                          title={t.common.delete}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
                {paginatedProposals.length === 0 && (
                  <tr>
                    <td colSpan={Object.values(visibleColumns).filter(Boolean).length} className="py-12 text-center">
                      <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-500 text-lg">{t.common.noResults}</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {filteredProposals.length > 0 && itemsPerPage !== 99999 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <div className="text-sm text-gray-600">
                Showing {startIndex + 1} to {Math.min(endIndex, filteredProposals.length)} of {filteredProposals.length} entries
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  {t.common.previous}
                </Button>
                <span className="text-sm text-gray-600">
                  {t.common.pageOf?.(currentPage, totalPages) || `Page ${currentPage} of ${totalPages}`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  {t.common.next}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}