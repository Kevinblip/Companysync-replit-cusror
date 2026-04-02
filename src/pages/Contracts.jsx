import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  Plus,
  FileSignature,
  CheckCircle,
  Clock,
  XCircle,
  Edit,
  Trash2,
  Search,
  AlertTriangle,
  X
} from "lucide-react";
import { format } from "date-fns";
import useTranslation from "@/hooks/useTranslation";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";

export default function Contracts() {
  const { t } = useTranslation();
  const [showDialog, setShowDialog] = useState(false);
  const [editingContract, setEditingContract] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [createAsNewLead, setCreateAsNewLead] = useState(false);
  const [formData, setFormData] = useState({
    contract_name: "",
    customer_name: "",
    contract_type: "service",
    start_date: "",
    end_date: "",
    value: 0,
    status: "draft",
    terms: "",
    notes: ""
  });

  const queryClient = useQueryClient();

  const { myCompany, filterCustomers, filterLeads, filterByCustomerRelation } = useRoleBasedData();

  const { data: allContracts = [] } = useQuery({
    queryKey: ['contracts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Contract.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: contractTemplates = [] } = useQuery({
    queryKey: ['contract-templates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ContractTemplate.filter({ company_id: myCompany.id, is_active: true }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const customers = useMemo(() => filterCustomers(allCustomers), [allCustomers, filterCustomers]);
  const leads = useMemo(() => filterLeads(allLeads), [allLeads, filterLeads]);
  const contracts = useMemo(() => filterByCustomerRelation(allContracts, customers, 'contracts'), [allContracts, customers, filterByCustomerRelation]);

  // Combine customers and leads with BETTER name extraction
  const allContacts = useMemo(() => {
    const contacts = [
      ...customers.map(c => {
        // Priority: name > company > full_name > email > "Unnamed"
        const displayName = c.name || c.company || c.full_name || c.email?.split('@')[0] || 'Unnamed Customer';
        return { 
          ...c, 
          type: 'customer',
          displayName,
          searchText: `${displayName} ${c.email || ''} ${c.phone || ''}`.toLowerCase(),
          email: c.email || '',
          phone: c.phone || ''
        };
      }),
      ...leads.map(l => {
        // Priority: name > company > full_name > email > "Unnamed"
        const displayName = l.name || l.company || l.full_name || l.email?.split('@')[0] || 'Unnamed Lead';
        return { 
          ...l, 
          type: 'lead',
          displayName,
          searchText: `${displayName} ${l.email || ''} ${l.phone || ''}`.toLowerCase(),
          email: l.email || '',
          phone: l.phone || ''
        };
      })
    ];
    
    // Filter out contacts with bad display names (dates, addresses, etc.)
    return contacts
      .filter(c => {
        // Exclude if displayName looks like a date or address
        const name = c.displayName.toLowerCase();
        return !name.match(/^\d{4}-\d{2}-\d{2}/) && // Not a date
               !name.match(/^\d+\s+\w+\s+(st|ave|dr|rd|blvd|ln)/i) && // Not an address
               name !== 'unknown';
      })
      .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
  }, [customers, leads]);

  // filteredContacts for the contact selection dropdown in the dialog
  const filteredContacts = useMemo(() => {
    if (!contactSearch) return allContacts;
    const search = contactSearch.toLowerCase();
    return allContacts.filter(c => c.searchText.includes(search));
  }, [allContacts, contactSearch]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // 🔥 FIX #8: Add company_id when creating contracts
      return base44.entities.Contract.create({
        ...data,
        company_id: myCompany?.id
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      handleCloseDialog();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Contract.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      handleCloseDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Contract.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingContract) {
      updateMutation.mutate({ id: editingContract.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingContract(null);
    setContactSearch("");
    setShowContactDropdown(false);
    setCreateAsNewLead(false);
    setFormData({
      contract_name: "",
      customer_name: "",
      contract_type: "service",
      start_date: "",
      end_date: "",
      value: 0,
      status: "draft",
      terms: "",
      notes: ""
    });
  };

  const handleEdit = (contract) => {
    setEditingContract(contract);
    setFormData({
      contract_name: contract.contract_name || "",
      customer_name: contract.customer_name || "",
      contract_type: contract.contract_type || "service",
      start_date: contract.start_date?.split('T')[0] || "",
      end_date: contract.end_date?.split('T')[0] || "",
      value: contract.value || 0,
      status: contract.status || "draft",
      terms: contract.terms || "",
      notes: contract.notes || ""
    });
    setShowDialog(true);
  };

  const handleDelete = (id) => {
    if (window.confirm(`${t.common.delete}?`)) {
      deleteMutation.mutate(id);
    }
  };

  const handleTestSigningFlow = async () => {
    if (contractTemplates.length === 0) {
      alert('⚠️ Please create a contract template first in Contract Templates page');
      return;
    }

    const template = contractTemplates[0];
    
    try {
      // Step 1: Create signing session
      const session = await base44.entities.ContractSigningSession.create({
        company_id: myCompany?.id,
        template_id: template.id,
        template_name: template.template_name,
        contract_name: "TEST - Sample Contract",
        customer_name: "Kevin Stone",
        customer_email: "kevinstone@yicnteam.com",
        customer_phone: "+15555555555",
        delivery_method: "email",
        rep_name: user?.full_name || "Test Rep",
        rep_email: user?.email || "rep@test.com",
        status: 'awaiting_customer',
        current_signer: 'customer'
      });

      const sessionData = {
        base44_session_id: String(session.id),
        company_id: myCompany?.id,
        template_id: template.id,
        template_name: template.template_name,
        contract_name: "TEST - Sample Contract",
        customer_name: "Kevin Stone",
        customer_email: "kevinstone@yicnteam.com",
        customer_phone: "+15555555555",
        delivery_method: "email",
        rep_name: user?.full_name || "Test Rep",
        rep_email: user?.email || "rep@test.com",
        rep_fields: {},
        rep_signature_url: null,
        rep_signed_at: new Date().toISOString(),
        fillable_fields: template.fillable_fields || [],
        original_file_url: template.original_file_url || '',
      };

      const token = localStorage.getItem('base44_access_token');
      const sendRes = await fetch('/api/contracts/send-signing-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId: String(session.id), sessionData }),
      });
      const sendResult = await sendRes.json();

      if (sendResult?.success) {
        alert(`✅ Test email sent successfully to kevinstone@yicnteam.com!\n\nSigning link: ${sendResult.signing_link}`);
      } else {
        alert('❌ Failed to send email: ' + (sendResult?.error || 'Unknown error'));
      }
      
      queryClient.invalidateQueries({ queryKey: ['signing-sessions'] });
    } catch (error) {
      alert('❌ Test failed: ' + error.message);
    }
  };

  const handleSelectContact = (contact) => {
    setFormData({
      ...formData,
      customer_name: contact.displayName
    });
    setContactSearch(contact.displayName);
    setShowContactDropdown(false);
    setCreateAsNewLead(false);
  };

  const pendingContracts = contracts.filter(c => c.status === 'draft').length;
  const activeContracts = contracts.filter(c => c.status === 'active').length;
  const expiringSoon = contracts.filter(c => {
    if (!c.end_date || c.status !== 'active') return false;
    const endDate = new Date(c.end_date);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
  }).length;
  const expiredContracts = contracts.filter(c => c.status === 'expired').length;

  // filteredContractsTable for the main table search functionality
  const filteredContractsTable = contracts.filter(contract =>
    contract.contract_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contract.customer_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status) => {
    const colors = {
      'draft': 'bg-gray-100 text-gray-700 border-gray-200',
      'active': 'bg-green-100 text-green-700 border-green-200',
      'expired': 'bg-red-100 text-red-700 border-red-200',
      'terminated': 'bg-orange-100 text-orange-700 border-orange-200'
    };
    return colors[status] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const getStatusIcon = (status) => {
    const icons = {
      'draft': Clock,
      'active': CheckCircle,
      'expired': XCircle,
      'terminated': AlertTriangle
    };
    return icons[status] || Clock;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.contracts.title}</h1>
          <p className="text-gray-500 mt-1">Manage customer contracts and agreements</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                {t.contracts.createContract}
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingContract ? t.contracts.editContract : t.contracts.createContract}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="contract-name">{t.contracts.contractTitle} *</Label>
                {contractTemplates.length > 0 ? (
                  <>
                    <Select
                      value={formData.contract_name}
                      onValueChange={(value) => setFormData({...formData, contract_name: value})}
                    >
                      <SelectTrigger id="contract-name">
                        <SelectValue placeholder="Select a contract template..." />
                      </SelectTrigger>
                      <SelectContent>
                        {contractTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.template_name}>
                            {template.template_name}
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">Custom (Type Your Own)</SelectItem>
                      </SelectContent>
                    </Select>
                    {formData.contract_name === 'custom' && (
                      <Input
                        className="mt-2"
                        value={formData.contract_name}
                        onChange={(e) => setFormData({...formData, contract_name: e.target.value})}
                        placeholder="Enter custom contract name..."
                        required
                      />
                    )}
                  </>
                ) : (
                  <Input
                    id="contract-name"
                    value={formData.contract_name}
                    onChange={(e) => setFormData({...formData, contract_name: e.target.value})}
                    placeholder="e.g., Annual Maintenance Agreement"
                    required
                  />
                )}
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <Label>{t.common.search} {t.contracts.customer}</Label>
                  <div className="relative">
                    <Input
                      value={contactSearch}
                      onChange={(e) => {
                        const value = e.target.value;
                        setContactSearch(value);
                        setShowContactDropdown(true);
                        if (!value) {
                          setFormData(prev => ({
                            ...prev,
                            customer_name: ""
                          }));
                          setCreateAsNewLead(true);
                        }
                      }}
                      onFocus={() => setShowContactDropdown(true)}
                      onBlur={() => {
                        setTimeout(() => setShowContactDropdown(false), 300);
                      }}
                      placeholder="Click to see all contacts or type to search..."
                      className="pr-10"
                    />
                    {contactSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setContactSearch("");
                          setShowContactDropdown(true);
                          setFormData(prev => ({
                            ...prev,
                            customer_name: ""
                          }));
                          setCreateAsNewLead(true);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {showContactDropdown && (
                    <div className="absolute z-[100] w-full mt-1 bg-white border-2 border-blue-300 rounded-lg shadow-xl max-h-80 overflow-y-auto">
                      {(contactSearch ? filteredContacts : allContacts).length === 0 ? (
                        <div className="px-4 py-8 text-center text-gray-500">
                          <p className="font-medium">{t.common.noResults}</p>
                          <p className="text-xs mt-1">Type a name and check "Create as new lead" below</p>
                        </div>
                      ) : (
                        (contactSearch ? filteredContacts : allContacts).map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              handleSelectContact(contact);
                            }}
                            className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b last:border-b-0 flex items-center gap-3 transition-colors"
                          >
                            <Badge
                              variant={contact.type === 'customer' ? 'default' : 'secondary'}
                              className="text-xs shrink-0"
                            >
                              {contact.type}
                            </Badge>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900 truncate">{contact.displayName}</div>
                              {contact.email && (
                                <div className="text-xs text-gray-500 truncate">{contact.email}</div>
                              )}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  <p className="text-xs text-gray-600 mt-1 font-medium">
                    {contactSearch 
                      ? `${filteredContacts.length} of ${allContacts.length} contacts` 
                      : `${allContacts.length} total contacts available`}
                  </p>
                </div>

                <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded">
                  <input
                    type="checkbox"
                    id="create-new-lead"
                    checked={createAsNewLead}
                    onChange={(e) => setCreateAsNewLead(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="create-new-lead" className="cursor-pointer text-sm">
                    <span className="font-medium">Create as new lead</span>
                    <span className="block text-xs text-gray-600">(Check if this is a NEW customer)</span>
                  </Label>
                </div>

                <div>
                  <Label htmlFor="customer-name-input">{t.contracts.customer} *</Label>
                  <Input
                    id="customer-name-input"
                    value={formData.customer_name}
                    onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
                    placeholder="Auto-fills from search above"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="contract-type">Contract Type</Label>
                  <Select
                    value={formData.contract_type}
                    onValueChange={(value) => setFormData({...formData, contract_type: value})}
                  >
                    <SelectTrigger id="contract-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="service">Service</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="subscription">Subscription</SelectItem>
                      <SelectItem value="project">Project</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="value">Contract Value ($)</Label>
                  <Input
                    id="value"
                    type="number"
                    step="0.01"
                    value={formData.value}
                    onChange={(e) => setFormData({...formData, value: parseFloat(e.target.value)})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="start-date">{t.contracts.date} *</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="end-date">End Date *</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => setFormData({...formData, end_date: e.target.value})}
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="status">{t.contracts.status}</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({...formData, status: value})}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">{t.contracts.draft}</SelectItem>
                    <SelectItem value="active">{t.common.active}</SelectItem>
                    <SelectItem value="expired">{t.contracts.expired}</SelectItem>
                    <SelectItem value="terminated">{t.common.cancelled}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="terms">Terms & Conditions</Label>
                <Textarea
                  id="terms"
                  value={formData.terms}
                  onChange={(e) => setFormData({...formData, terms: e.target.value})}
                  rows={4}
                  placeholder="Enter contract terms and conditions..."
                />
              </div>

              <div>
                <Label htmlFor="notes">{t.common.notes}</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  rows={3}
                  placeholder="Internal notes (not visible to customer)..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  {t.common.cancel}
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                  {editingContract ? t.common.update : t.contracts.createContract}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-6">
            <Clock className="w-8 h-8 text-blue-600 mb-2" />
            <h3 className="text-2xl font-bold">{pendingContracts}</h3>
            <p className="text-sm text-gray-600">{t.contracts.pending}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <CardContent className="p-6">
            <CheckCircle className="w-8 h-8 text-green-600 mb-2" />
            <h3 className="text-2xl font-bold">{activeContracts}</h3>
            <p className="text-sm text-gray-600">{t.common.active}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-yellow-50 border-orange-200">
          <CardContent className="p-6">
            <AlertTriangle className="w-8 h-8 text-orange-600 mb-2" />
            <h3 className="text-2xl font-bold">{expiringSoon}</h3>
            <p className="text-sm text-gray-600">Expiring Soon</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-pink-50 border-red-200">
          <CardContent className="p-6">
            <XCircle className="w-8 h-8 text-red-600 mb-2" />
            <h3 className="text-2xl font-bold">{expiredContracts}</h3>
            <p className="text-sm text-gray-600">{t.contracts.expired}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t.contracts.title}</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder={`${t.common.search}...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredContractsTable.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FileSignature className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>{t.common.noResults}</p>
              <p className="text-sm mt-1">Create your first contract to get started!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="pb-3 font-medium">{t.contracts.contractTitle}</th>
                    <th className="pb-3 font-medium">{t.contracts.customer}</th>
                    <th className="pb-3 font-medium">Type</th>
                    <th className="pb-3 font-medium">{t.common.amount}</th>
                    <th className="pb-3 font-medium">Start Date</th>
                    <th className="pb-3 font-medium">End Date</th>
                    <th className="pb-3 font-medium">{t.contracts.status}</th>
                    <th className="pb-3 font-medium">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContractsTable.map((contract) => {
                    const StatusIcon = getStatusIcon(contract.status);
                    return (
                      <tr key={contract.id} className="border-b hover:bg-gray-50">
                        <td className="py-4 font-medium">{contract.contract_name}</td>
                        <td className="py-4 text-gray-600">{contract.customer_name}</td>
                        <td className="py-4 text-sm text-gray-600 capitalize">
                          {contract.contract_type?.replace('_', ' ')}
                        </td>
                        <td className="py-4 font-semibold text-green-600">
                          ${contract.value?.toFixed(2) || '0.00'}
                        </td>
                        <td className="py-4 text-sm text-gray-600">
                          {contract.start_date ? format(new Date(contract.start_date), 'MMM d, yyyy') : '-'}
                        </td>
                        <td className="py-4 text-sm text-gray-600">
                          {contract.end_date ? format(new Date(contract.end_date), 'MMM d, yyyy') : '-'}
                        </td>
                        <td className="py-4">
                          <Badge variant="outline" className={`${getStatusColor(contract.status)} flex items-center gap-1 w-fit`}>
                            <StatusIcon className="w-3 h-3" />
                            {contract.status === 'draft' ? t.contracts.draft :
                             contract.status === 'active' ? t.common.active :
                             contract.status === 'expired' ? t.contracts.expired :
                             contract.status === 'terminated' ? t.common.cancelled :
                             contract.status}
                          </Badge>
                        </td>
                        <td className="py-4">
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(contract)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(contract.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}