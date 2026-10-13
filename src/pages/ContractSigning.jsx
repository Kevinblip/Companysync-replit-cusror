import React, { useState, useEffect, useMemo } from "react";
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
import PdfViewer from "@/components/PdfViewer";

const CONTRACT_DEFAULT = {
  header_company:"",header_phone:"",header_website:"",header_email:"",footer_address:"",
  title:"CONTINGENCY AGREEMENT",
  intro:"I/We, owner of the property located at :",
  para1:"Agree to have Contractor represent me/us and assist in obtaining my/our insurance company's good faith approval for the funds needed for restoration and repairs to said property.",
  para2:"If the insurance company does not agree to pay for needed repairs, this agreement is automatically terminated.",
  para3:"In such event, the property owner will not owe anything to Contractor; and Contractor will not be required to perform any restoration and repairs to said property.",
  para4:"Property owner agrees that Contractor will perform the repairs to the said property in accordance with the insurance company's damage and work scope. The property owner will pay to Contractor all checks from the insurance company, including:",
  item1:"The initial check (ACV) that comes with the detailed work scope from the insurance company. At this time property owner will be assisted in selecting any available options such as shingle style and color, etc. Contractor then orders all materials, schedules work to be done, and orders all inspections during and after repairs and installation.",
  item2:"The depreciation/supplement check that the insurance company pays after final inspection.",
  item3:"All supplemental funds from the insurance company for unforeseen costs. If these occur, they will be negotiated by Contractor and are paid by the insurance company.",
  item4:"Any upgrade that is selected will be due upon completion.",
  p2_intro:"This contract and any agreement made pursuant thereto (the \u201cAgreement\u201d) is between CONTRACTOR (the \u201cCompany\u201d) and the customer(s) named herein on the reverse side. This Agreement Is subject to all appropriate law, regulations, and ordinances in the State of Ohio and these terms and conditions.",
  b1:"This Agreement is composed of this page, the reverse (or front page) side of this page, the Pre-Start Checklist, the Scope of work Attachment if applicable, and all other documents referenced in or incorporated Into this Agreement.",
  b2:"The Company is not responsible for any damages on or below the roof due to leaks by excessive wind driven rain, ice, or hail during the period of warranty. EXCESSIVE WIND IS 65 M.P.H. THE WARRANTY IS NON-TRANSFERRABLE.",
  b3:"Property Owner acknowledges the value of the Contractor Services provided by CONTRACTOR.",
  b4:"THIS CONTRACT CANNOT BE CANCELLED ONCE WORK IS COMMENCED ON THE PROJECT EXCEPT BY MUTUAL WRITTEN AGREEMENT OF THE PARTIES.",
  b5:"Warranty is for 5 years on roof replacement, 1 year on siding replacement, 1 year on gutter repairs, and 1 year on all other repairs (including interior work.)",
  b6:"Payments are to be made: ACV + Deductible down payment AND Customer agrees to our percentage of completion billing policy.",
  b7:"Pay per Trade Policy: Customer agrees to pay in full at the completion of each trade on the project.",
  b8:"Company Retainage Policy: Customer agrees to pay in full at the time of completion of each contract. The maximum allowable retainage for any punch-out will be 5% of original contract price.",
  b9:"The Company\u2019s failure to enforce any right under this Agreement shall not be construed as a waiver of any subsequent right to enforce the same or any other right, term or condition.",
  b10:"You, the consumer, may cancel this transaction at any time prior to midnight of the 3rd business day after the date of this transaction.",
};

function getPdfViewerSource(url) {
  if (!url) return null;
  if (!url.startsWith('http')) {
    return url.startsWith('/') ? url : `/${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname === window.location.hostname) {
      return parsed.pathname + (parsed.search || '');
    }
  } catch (_) {}
  return `/api/proxy-pdf?url=${encodeURIComponent(url)}`;
}

function FilledContractRenderer({ htmlContent, mergedFields = {}, fieldDefs = [], repSignatureUrl, customerSignatureUrl, repSignedAt, customerSignedAt }) {
  let c = CONTRACT_DEFAULT;
  if (htmlContent) {
    try { c = { ...CONTRACT_DEFAULT, ...(typeof htmlContent === 'string' ? JSON.parse(htmlContent) : htmlContent) }; } catch (_) {}
  }

  const getVal = (...hints) => {
    for (const hint of hints) {
      const h = hint.toLowerCase();
      if (mergedFields[hint]) return mergedFields[hint];
      const byName = fieldDefs.find(f => f.field_name?.toLowerCase().includes(h));
      if (byName && mergedFields[byName.field_name]) return mergedFields[byName.field_name];
      const byLabel = fieldDefs.find(f => f.field_label?.toLowerCase().includes(h));
      if (byLabel && mergedFields[byLabel.field_name]) return mergedFields[byLabel.field_name];
      const dk = Object.keys(mergedFields).find(k => k.toLowerCase().includes(h));
      if (dk && mergedFields[dk]) return mergedFields[dk];
    }
    return null;
  };

  const filled = (val, minWidth = '120px') => val
    ? <strong style={{ color: '#111' }}>{val}</strong>
    : <span style={{ display: 'inline-block', borderBottom: '1px solid #888', minWidth }} />;

  const ps = { background:'#fff', padding:'32px 36px 28px', fontFamily:'Arial,sans-serif', fontSize:'12px', color:'#222', lineHeight:'1.45' };
  const cell = { padding: '3px 6px' };

  const nameVal    = getVal('customer_name','name','full_name','policyholder');
  const dateVal    = getVal('date','agreement_date','sign_date','contract_date');
  const addrVal    = getVal('property_address','address','street');
  const phoneVal   = getVal('phone','home_phone','cell_phone','mobile');
  const cityVal    = getVal('city');
  const stateVal   = getVal('state');
  const zipVal     = getVal('zip','postal','postal_code');
  const emailVal   = getVal('email','customer_email');
  const insVal     = getVal('insurance_company','insurance','insurer','carrier');
  const claimVal   = getVal('claim_number','claim_no','claim','policy_number','policy_no');
  const cityStateZip = [cityVal, stateVal, zipVal].filter(Boolean).join(' / ') || null;

  return (
    <div style={{ background:'#f0f0f0', padding:'12px' }}>
      <div style={{ ...ps, marginBottom:'12px', borderRadius:'4px' }}>
        {(c.header_company || c.header_phone) && (
          <div style={{ textAlign:'center', marginBottom:'14px' }}>
            {c.header_company && <div style={{ fontWeight:'bold', fontSize:'14px', letterSpacing:'0.5px' }}>{c.header_company}</div>}
            {(c.header_phone || c.header_website || c.header_email) && (
              <div style={{ fontSize:'11px', color:'#444', marginTop:'2px' }}>
                {[c.header_phone, c.header_website, c.header_email].filter(Boolean).join(' | ')}
              </div>
            )}
          </div>
        )}
        <hr style={{ borderColor:'#aaa', marginBottom:'10px' }} />
        <div style={{ textAlign:'center', fontWeight:'bold', fontSize:'15px', marginBottom:'14px', letterSpacing:'1px' }}>{c.title}</div>

        <div style={{ marginBottom:'12px' }}>
          <span style={{ fontWeight:'bold' }}>{c.intro}</span>
          <div style={{ borderBottom:'1px solid #555', minHeight:'20px', marginTop:'6px', fontWeight:'bold', paddingBottom:'2px' }}>{addrVal || ''}</div>
        </div>

        <p style={{ marginBottom:'8px' }}>{c.para1}</p>
        <p style={{ marginBottom:'8px' }}>{c.para2}</p>
        <p style={{ marginBottom:'8px' }}>{c.para3}</p>
        <p style={{ marginBottom:'8px' }}>{c.para4}</p>
        <ol style={{ paddingLeft:'22px', marginBottom:'12px' }}>
          {[c.item1,c.item2,c.item3,c.item4].filter(Boolean).map((item,i) => <li key={i} style={{ marginBottom:'6px' }}>{item}</li>)}
        </ol>

        <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:'12px', fontSize:'12px' }}>
          <tbody>
            <tr>
              <td style={cell}><span style={{ color:'#555' }}>Customer Name:</span> {filled(nameVal,'140px')}</td>
              <td style={cell}><span style={{ color:'#555' }}>Date:</span> {filled(dateVal,'80px')}</td>
            </tr>
            <tr>
              <td style={cell}><span style={{ color:'#555' }}>Property Address:</span> {filled(addrVal,'140px')}</td>
              <td style={cell}><span style={{ color:'#555' }}>Phone:</span> {filled(phoneVal,'90px')}</td>
            </tr>
            <tr>
              <td style={cell}><span style={{ color:'#555' }}>City / State / Zip:</span> {filled(cityStateZip,'120px')}</td>
              <td style={cell}><span style={{ color:'#555' }}>Email:</span> {filled(emailVal,'90px')}</td>
            </tr>
            <tr>
              <td style={cell}><span style={{ color:'#555' }}>Insurance Company:</span> {filled(insVal,'130px')}</td>
              <td style={cell}><span style={{ color:'#555' }}>Claim #:</span> {filled(claimVal,'80px')}</td>
            </tr>
          </tbody>
        </table>

        <table style={{ width:'100%', borderCollapse:'collapse', marginTop:'8px', fontSize:'12px' }}>
          <tbody>
            <tr>
              <td style={{ ...cell, width:'45%', verticalAlign:'bottom' }}>
                <div style={{ color:'#555', marginBottom:'2px' }}>Customer Signature:</div>
                <div style={{ borderBottom:'1px solid #555', minHeight:'44px', display:'flex', alignItems:'flex-end' }}>
                  {customerSignatureUrl
                    ? <img src={customerSignatureUrl} alt="Customer sig" style={{ maxHeight:'40px', maxWidth:'150px' }} />
                    : <span style={{ minWidth:'140px' }} />}
                </div>
                {customerSignedAt && <div style={{ fontSize:'10px', color:'#888', marginTop:'2px' }}>{new Date(customerSignedAt).toLocaleDateString()}</div>}
              </td>
              <td style={{ ...cell, width:'25%', verticalAlign:'bottom' }}>
                <div style={{ color:'#555', marginBottom:'2px' }}>Date:</div>
                <div style={{ borderBottom:'1px solid #555', minHeight:'44px', fontWeight:'bold', display:'flex', alignItems:'flex-end', paddingBottom:'4px' }}>
                  {customerSignedAt ? new Date(customerSignedAt).toLocaleDateString() : ''}
                </div>
              </td>
              <td style={{ ...cell, width:'30%', verticalAlign:'bottom' }}>
                <div style={{ color:'#555', marginBottom:'2px' }}>Rep Signature:</div>
                <div style={{ borderBottom:'1px solid #555', minHeight:'44px', display:'flex', alignItems:'flex-end' }}>
                  {repSignatureUrl
                    ? <img src={repSignatureUrl} alt="Rep sig" style={{ maxHeight:'40px', maxWidth:'100px' }} />
                    : <span style={{ minWidth:'90px' }} />}
                </div>
                {repSignedAt && <div style={{ fontSize:'10px', color:'#888', marginTop:'2px' }}>{new Date(repSignedAt).toLocaleDateString()}</div>}
              </td>
            </tr>
          </tbody>
        </table>

        {c.footer_address && <div style={{ textAlign:'center', fontSize:'10px', color:'#666', marginTop:'14px' }}>{c.footer_address}</div>}
      </div>

      <div style={{ ...ps, borderRadius:'4px' }}>
        <div style={{ textAlign:'center', fontWeight:'bold', fontSize:'13px', marginBottom:'12px' }}>TERMS AND CONDITIONS</div>
        {c.p2_intro && <p style={{ marginBottom:'10px', fontStyle:'italic', fontSize:'11px' }}>{c.p2_intro}</p>}
        {[c.b1,c.b2,c.b3,c.b4,c.b5,c.b6,c.b7,c.b8,c.b9,c.b10].filter(Boolean).map((block,i) => (
          <div key={i} style={{ display:'flex', gap:'8px', marginBottom:'8px' }}>
            <span style={{ fontWeight:'bold', minWidth:'18px' }}>{i+1}.</span>
            <span>{block}</span>
          </div>
        ))}
        {c.footer_address && <div style={{ textAlign:'center', fontSize:'10px', color:'#666', marginTop:'18px' }}>{c.footer_address}</div>}
      </div>
    </div>
  );
}

export default function ContractSigning() {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedSignature, setSelectedSignature] = useState(null);
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

  const { company: myCompany } = useCurrentCompany(user);
  const { isAdmin, hasPermission, filterCustomers, filterLeads } = useRoleBasedData();
  const canEdit = isAdmin || hasPermission('contract_signing', 'edit');
  const canDelete = isAdmin || hasPermission('contract_signing', 'delete');

  const { data: rawSigningSessions = [] } = useQuery({
    queryKey: ['signing-sessions', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ContractSigningSession.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany,
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany,
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany,
  });

  const customers = useMemo(() => filterCustomers(allCustomers), [allCustomers, filterCustomers]);
  const leads = useMemo(() => filterLeads(allLeads), [allLeads, filterLeads]);

  const signingSessions = useMemo(() => {
    if (isAdmin) return rawSigningSessions;
    const allowedEmails = new Set([
      ...customers.map(c => c.email).filter(Boolean),
      ...leads.map(l => l.email).filter(Boolean),
    ]);
    return rawSigningSessions.filter(s =>
      (s.customer_email && allowedEmails.has(s.customer_email)) ||
      s.created_by === user?.email
    );
  }, [rawSigningSessions, isAdmin, customers, leads, user]);

  const { data: estimates = [] } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany,
  });

  const { data: contracts = [] } = useQuery({
    queryKey: ['contracts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Contract.filter({ company_id: myCompany.id }, "-created_date", 500) : [],
    enabled: !!myCompany,
  });

  const { data: contractEditorContents = [] } = useQuery({
    queryKey: ['contract-editor-content', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ContractEditorContent.filter({ company_id: myCompany.id }, '-updated_date') : [],
    enabled: !!myCompany,
  });

  const { data: contractTemplates = [] } = useQuery({
    queryKey: ['contract-templates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ContractTemplate.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

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

  const sendToCustomerMutation = useMutation({
    mutationFn: async (session) => {
      const token = localStorage.getItem('base44_access_token');
      // Send only sessionId (no sessionData) so the server UPDATE-path refreshes the
      // existing signing_sessions row's token instead of inserting a duplicate row.
      const res = await fetch('/api/contracts/send-signing-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId: String(session.id) }),
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to send');
      await base44.entities.ContractSigningSession.update(session.id, {
        status: 'awaiting_customer',
        current_signer: 'customer',
        sent_to_customer_at: new Date().toISOString(),
      });
      return { data, session };
    },
    onSuccess: ({ data, session }) => {
      queryClient.invalidateQueries({ queryKey: ['signing-sessions'] });
      alert(`✅ Contract sent to ${session.customer_name} via ${session.delivery_method || 'SMS'}!\n\n${data.message || ''}`);
    },
    onError: (error) => {
      alert('❌ Failed to send to customer: ' + error.message);
    }
  });

  const handleDeleteSession = (session) => {
    if (session.status === 'awaiting_customer' && session.sent_to_customer_at) {
      alert(`⚠️ Cannot delete "${session.contract_name}" for ${session.customer_name} — this contract has already been sent and is awaiting the customer's signature. Deleting it would invalidate their signing link.\n\nIf you want to cancel, change the status to "Declined" or "Expired" first.`);
      return;
    }
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

  // Collapse legacy duplicate rows (an entity-create row + its SQL-inserted token row
  // share a base44_session_id link). Group by base44_session_id ?? id and keep the row
  // with the most-advanced status so a signed contract always shows Completed.
  const dedupedSessions = useMemo(() => {
    const rank = { completed: 5, customer_signed: 4, awaiting_customer: 3, signed_by_rep: 2, draft: 1, declined: 0, expired: 0 };
    const groups = new Map();
    for (const s of signingSessions) {
      const groupId = String(s.base44_session_id || s.id);
      const existing = groups.get(groupId);
      if (!existing || (rank[s.status] ?? -1) > (rank[existing.status] ?? -1)) {
        groups.set(groupId, s);
      }
    }
    return Array.from(groups.values());
  }, [signingSessions]);

  const stats = {
    total: dedupedSessions.length,
    pending: dedupedSessions.filter(s => s.status === 'awaiting_customer' || s.status === 'signed_by_rep').length,
    signed: dedupedSessions.filter(s => s.status === 'completed').length,
    declined: dedupedSessions.filter(s => s.status === 'declined').length
  };

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">E-Signature Requests</h1>
          <p className="text-gray-500 mt-1">Send documents for electronic signature</p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => window.open('/contract-editor', '_blank')}
            className="gap-1 text-gray-600 border-gray-300"
          >
            ✏️ Edit Contract Wording
          </Button>
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
          <CardContent className="p-3 sm:p-6">
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
          <CardContent className="p-3 sm:p-6">
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
          <CardContent className="p-3 sm:p-6">
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
          <CardContent className="p-3 sm:p-6">
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
          <CardTitle>Contract Signing Sessions ({dedupedSessions.length})</CardTitle>
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
                {dedupedSessions.map((session) => (
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
                        {session.status === 'signed_by_rep' && (
                          <Button
                            data-testid={`button-send-customer-${session.id}`}
                            size="sm"
                            variant="default"
                            className="bg-blue-600 hover:bg-blue-700 text-white gap-1"
                            onClick={() => {
                              const via = session.delivery_method || 'SMS';
                              if (window.confirm(`Send this contract to ${session.customer_name} via ${via} now?`)) {
                                sendToCustomerMutation.mutate(session);
                              }
                            }}
                            disabled={sendToCustomerMutation.isPending}
                            title={`Send to ${session.customer_name} via ${session.delivery_method || 'SMS'}`}
                          >
                            <Send className="w-4 h-4" />
                            <span className="hidden sm:inline">Send to Customer</span>
                          </Button>
                        )}
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
                {dedupedSessions.length === 0 && (
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
                  <p className="font-medium">{{ sms: 'SMS', email: 'Email' }[selectedSignature.delivery_method?.toLowerCase()] || selectedSignature.delivery_method || '—'}</p>
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

              {/* Signed Contract — rendered with all filled-in values and signatures */}
              {(() => {
                const mergedFields = {
                  ...(selectedSignature.pre_filled_values || {}),
                  ...(selectedSignature.rep_fields || {}),
                  ...(selectedSignature.customer_fields || {}),
                };
                const fieldDefs = selectedSignature.fillable_fields || [];
                const selectedTemplate = contractTemplates.find(
                  template => template.id === selectedSignature.template_id
                );
                const originalFileUrl = selectedSignature.original_file_url
                  || selectedSignature.final_pdf_url
                  || selectedTemplate?.original_file_url
                  || null;
                const hasUploadedDocument = !!originalFileUrl;
                const isLegacyContingency = !hasUploadedDocument
                  && String(selectedSignature.template_name || '').toLowerCase().includes('contingency');
                const htmlContent = selectedSignature.html_content
                  || selectedTemplate?.html_content
                  || (isLegacyContingency
                    ? contractEditorContents.find(ec => ec.company_id === myCompany?.id)?.content
                    : null)
                  || null;
                const pdfSource = getPdfViewerSource(
                  selectedSignature.final_pdf_url || originalFileUrl
                );
                return (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
                      <div className="flex items-center gap-2">
                        <FileSignature className="w-4 h-4 text-gray-600" />
                        <p className="text-sm font-semibold text-gray-700">
                          {selectedSignature.status === 'completed' ? 'Completed Signed Contract' : 'Contract Document'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {selectedSignature.final_pdf_url && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => window.open(selectedSignature.final_pdf_url, '_blank')}>
                            <Download className="w-3 h-3 mr-1" />Download PDF
                          </Button>
                        )}
                        {selectedSignature.original_file_url && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => window.open(selectedSignature.original_file_url, '_blank')}>
                            <ExternalLink className="w-3 h-3 mr-1" />Blank Template
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="overflow-y-auto" style={{ maxHeight: '580px' }}>
                      {pdfSource ? (
                        <PdfViewer
                          src={pdfSource}
                          className="min-h-[300px]"
                          style={{ maxHeight: '560px' }}
                        />
                      ) : htmlContent ? (
                        <FilledContractRenderer
                          htmlContent={htmlContent}
                          mergedFields={mergedFields}
                          fieldDefs={fieldDefs}
                          repSignatureUrl={selectedSignature.rep_signature_url}
                          customerSignatureUrl={selectedSignature.customer_signature_url}
                          repSignedAt={selectedSignature.rep_signed_at}
                          customerSignedAt={selectedSignature.customer_signed_at}
                        />
                      ) : (
                        <div className="p-8 text-center text-sm text-gray-500">
                          This contract does not have a document snapshot or template file to display.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

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