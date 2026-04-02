import React, { useState, useEffect } from "react";
import PdfViewer from "@/components/PdfViewer";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Send, Eye, X, Maximize2, CheckCircle, Mail, MessageCircle, FileCheck, Sparkles } from "lucide-react";
import { createPageUrl } from "@/utils";
import { useNavigate, useLocation } from "react-router-dom";
import SignaturePad from "../components/SignaturePad";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

export default function SignContractRep() {
  const navigate = useNavigate();
  const location = useLocation();

  const getSessionId = () => {
    if (location.state?.sessionId) return String(location.state.sessionId);
    const params = new URLSearchParams(location.search);
    if (params.get('sessionId')) return params.get('sessionId');
    const winParams = new URLSearchParams(window.location.search);
    return winParams.get('sessionId') || null;
  };

  const getTemplateId = () => {
    const params = new URLSearchParams(location.search);
    if (params.get('templateId')) return params.get('templateId');
    const winParams = new URLSearchParams(window.location.search);
    return winParams.get('templateId') || null;
  };

  const [sessionId, setSessionId] = useState(getSessionId);
  const templateId = getTemplateId();
  const [formValues, setFormValues] = useState({});
  const [signatureData, setSignatureData] = useState(null);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [showFilledPreview, setShowFilledPreview] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(() => !!(templateId && !getSessionId()));
  const [showFinalPreview, setShowFinalPreview] = useState(false);
  const [signedSessionData, setSignedSessionData] = useState(null);
  const [isTestMode, setIsTestMode] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    contract_name: "",
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    delivery_method: "email",
    create_as_lead: false
  });
  const [user, setUser] = useState(null);
  const [contactSearch, setContactSearch] = useState("");
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const newId = getSessionId();
    if (newId && newId !== sessionId) {
      setSessionId(newId);
    }
  }, [location.search, location.state]);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: session, isLoading: sessionLoading, error: sessionError } = useQuery({
    queryKey: ['signing-session', sessionId],
    queryFn: async () => {
      const result = await base44.entities.ContractSigningSession.get(sessionId);
      if (!result) {
        throw new Error('Session not found');
      }
      return result;
    },
    enabled: !!sessionId,
    retry: 2,
  });

  const { data: template, isLoading: templateLoading, error: templateError } = useQuery({
    queryKey: ['contract-template', session?.template_id || templateId],
    queryFn: async () => {
      const tid = session?.template_id || templateId;
      // FIX: Use .get() for direct ID lookup to bypass company filtering on specific resources
      const result = await base44.entities.ContractTemplate.get(tid);
      if (!result) {
        throw new Error('Template not found');
      }
      return result;
    },
    enabled: !!(session?.template_id || templateId),
    retry: 2,
  });

  const { company: myCompany } = useCurrentCompany(user);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, '-created_date', 1000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, '-created_date', 1000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const allContacts = React.useMemo(() => {
    const contacts = [
      ...customers.map(c => {
        const displayName = c.name || c.company || c.full_name || c.email?.split('@')[0] || 'Unnamed Customer';
        return {
          ...c,
          type: 'customer',
          displayName,
          searchText: `${displayName} ${c.email || ''} ${c.phone || ''} ${c.company || ''}`.toLowerCase(),
          email: c.email || '',
          phone: c.phone || ''
        };
      }),
      ...leads.map(l => {
        const displayName = l.name || l.company || l.full_name || l.email?.split('@')[0] || 'Unnamed Lead';
        return {
          ...l,
          type: 'lead',
          displayName,
          searchText: `${displayName} ${l.email || ''} ${l.phone || ''} ${l.company || ''}`.toLowerCase(),
          email: l.email || '',
          phone: l.phone || ''
        };
      })
    ];

    return contacts
      .filter(c => {
        const name = c.displayName.toLowerCase();
        const isInvalidName = name === 'unnamed customer' || name === 'unnamed lead' || name.trim() === '';
        return !isInvalidName;
      })
      .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
  }, [customers, leads]);

  const filteredContacts = React.useMemo(() => {
    if (!contactSearch) return allContacts;
    const search = contactSearch.toLowerCase();
    return allContacts.filter(c => c.searchText.includes(search));
  }, [allContacts, contactSearch]);

  const handleSelectContact = (contact) => {
    setCustomerForm({
      ...customerForm,
      customer_name: contact.displayName,
      customer_email: contact.email || '',
      customer_phone: contact.phone || '',
      contract_name: customerForm.contract_name || `${contact.displayName} - ${template?.template_name || 'Contract'}`
    });
    setContactSearch(contact.displayName);
    setShowContactDropdown(false);
  };

  const createSessionMutation = useMutation({
    mutationFn: async (data) => {
      if (data.create_as_lead) {
        await base44.entities.Lead.create({
          company_id: myCompany?.id,
          name: data.customer_name,
          email: data.customer_email,
          phone: data.customer_phone,
          status: "new",
          source: "manual",
          lead_source: "Contract Signing"
        });
      }

      const session = await base44.entities.ContractSigningSession.create({
        company_id: myCompany?.id,
        template_id: templateId,
        template_name: template.template_name,
        contract_name: data.contract_name,
        customer_name: data.customer_name,
        customer_email: data.customer_email,
        customer_phone: data.customer_phone,
        delivery_method: data.delivery_method,
        rep_name: user?.full_name,
        rep_email: user?.email,
        status: 'draft',
        current_signer: 'rep',
        fillable_fields: template.fillable_fields || []
      });

      return session;
    },
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ['signing-sessions'] });
      setSessionId(String(newSession.id));
      setShowCustomerForm(false);
    },
    onError: (error) => {
      console.error('❌ Session creation error:', error);
      alert('❌ Failed to start signing: ' + error.message);
    }
  });

  const signMutation = useMutation({
    mutationFn: async ({ fields, signature }) => {
      return await base44.entities.ContractSigningSession.update(session.id, {
        rep_fields: fields,
        rep_signature_url: signature,
        rep_signed_at: new Date().toISOString(),
        status: 'signed_by_rep',
        current_signer: 'rep'
      });
    },
    onSuccess: async (updatedSession) => {
      queryClient.invalidateQueries({ queryKey: ['signing-session'] });
      setSignedSessionData(updatedSession);
      setShowFinalPreview(true);
    },
    onError: (error) => {
      console.error('❌ Signing error:', error);
      alert('❌ Failed to save signature: ' + error.message);
    }
  });

  const sendToCustomerMutation = useMutation({
    mutationFn: async (sessionId) => {
      console.log('🚀 Sending to customer, sessionId:', sessionId);
      
      const currentSession = signedSessionData || session;
      const sessionData = {
        base44_session_id: String(sessionId),
        company_id: currentSession.company_id,
        template_id: currentSession.template_id || template?.id,
        template_name: currentSession.template_name || template?.template_name,
        contract_name: currentSession.contract_name,
        customer_name: currentSession.customer_name,
        customer_email: currentSession.customer_email,
        customer_phone: currentSession.customer_phone,
        delivery_method: currentSession.delivery_method || 'email',
        rep_name: currentSession.rep_name || user?.full_name,
        rep_email: currentSession.rep_email || user?.email,
        rep_fields: currentSession.rep_fields || formValues,
        rep_signature_url: currentSession.rep_signature_url || signatureData,
        rep_signed_at: currentSession.rep_signed_at || new Date().toISOString(),
        fillable_fields: template?.fillable_fields || currentSession.fillable_fields || [],
        original_file_url: template?.original_file_url || '',
      };

      const token = localStorage.getItem('base44_access_token');
      const sendRes = await fetch('/api/contracts/send-signing-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId: String(sessionId), sessionData }),
      });
      const sendData = await sendRes.json();
      
      console.log('📧 Send response:', sendData);
      
      if (!sendData?.success) {
        throw new Error(sendData?.error || 'Failed to send');
      }
      
      await base44.entities.ContractSigningSession.update(sessionId, {
        status: 'awaiting_customer',
        current_signer: 'customer'
      });
      
      return sendData;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['signing-session'] });
      alert(`✅ Contract sent to ${signedSessionData.customer_name} via ${signedSessionData.delivery_method}!\n\n${data.message}`);
      setShowFinalPreview(false);
      navigate(createPageUrl('ContractSigning'));
    },
    onError: (error) => {
      console.error('❌ Send error:', error);
      alert('❌ Failed to send: ' + error.message);
    }
  });

  const handleSubmit = async () => {
    if (!signatureData) {
      alert('❌ Please sign the document first');
      return;
    }

    const repFields = template.fillable_fields.filter(f => f.filled_by === 'rep' && f.field_type !== 'signature');
    const missingRequired = repFields.filter(f => f.required && !formValues[f.field_name]);
    
    if (missingRequired.length > 0) {
      alert(`❌ Please fill in required fields: ${missingRequired.map(f => f.field_label).join(', ')}`);
      return;
    }

    await signMutation.mutateAsync({
      fields: formValues,
      signature: signatureData
    });
  };

  const handleTestMode = () => {
    const testSignature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    setSignatureData(testSignature);
    
    const repFields = template.fillable_fields.filter(f => f.filled_by === 'rep');
    const testValues = {};
    repFields.forEach(field => {
      if (field.field_type !== 'signature') {
        if (field.field_type === 'date') {
          testValues[field.field_name] = new Date().toISOString().split('T')[0];
        } else if (field.field_type === 'email') {
          testValues[field.field_name] = 'test@example.com';
        } else if (field.field_type === 'phone') {
          testValues[field.field_name] = '(555) 123-4567';
        } else if (field.field_type === 'currency') {
          testValues[field.field_name] = '1000.00';
        } else {
          testValues[field.field_name] = `Test ${field.field_label}`;
        }
      }
    });
    setFormValues(testValues);
    setIsTestMode(true);
    alert('✅ Test mode activated! All fields auto-filled. Click "Sign & Preview" to continue.');
  };

  const handleCustomerFormSubmit = (e) => {
    e.preventDefault();
    if (!customerForm.contract_name || !customerForm.customer_name) {
      alert('Please fill in required fields');
      return;
    }
    if (customerForm.delivery_method === 'email' && !customerForm.customer_email) {
      alert('Please provide customer email');
      return;
    }
    if (customerForm.delivery_method === 'sms' && !customerForm.customer_phone) {
      alert('Please provide customer phone');
      return;
    }
    createSessionMutation.mutate(customerForm);
  };

  useEffect(() => {
    if (template && showCustomerForm) {
      setCustomerForm(prev => ({
        ...prev,
        contract_name: template.template_name
      }));
    }
  }, [template, showCustomerForm]);

  if (showCustomerForm && template) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Start Signing: {template.template_name}</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert className="bg-blue-50 border-blue-200 mb-6">
              <AlertDescription>
                <strong>📋 Workflow:</strong> You'll sign first, then we'll send it to the customer for their signature.
              </AlertDescription>
            </Alert>

            <form onSubmit={handleCustomerFormSubmit} className="space-y-4">
              <div>
                <Label>Job/Contract Description *</Label>
                <p className="text-xs text-gray-500 mb-2">What's this for? (e.g., "Smith Property - Roof Replacement")</p>
                <Input
                  value={customerForm.contract_name}
                  onChange={(e) => setCustomerForm({...customerForm, contract_name: e.target.value})}
                  placeholder="e.g., Stone Residence - Storm Damage Repair"
                  required
                />
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3">Customer Information</h4>

                <div className="mb-3 relative">
                  <Label>Search Customer/Lead</Label>
                  <div className="relative">
                    <Input
                      value={contactSearch}
                      onChange={(e) => {
                        const value = e.target.value;
                        setContactSearch(value);
                        setShowContactDropdown(true);
                        if (!value) {
                          setCustomerForm(prev => ({
                            ...prev,
                            customer_name: "",
                            customer_email: "",
                            customer_phone: "",
                            create_as_lead: true
                          }));
                        }
                      }}
                      onFocus={() => setShowContactDropdown(true)}
                      onBlur={() => setTimeout(() => setShowContactDropdown(false), 300)}
                      placeholder="Click to see all contacts or type to search..."
                      className="pr-10"
                    />
                    {contactSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setContactSearch("");
                          setShowContactDropdown(true);
                          setCustomerForm(prev => ({
                            ...prev,
                            customer_name: "",
                            customer_email: "",
                            customer_phone: "",
                            create_as_lead: true
                          }));
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
                          <p className="font-medium">No contacts found</p>
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

                <div className="flex items-center gap-2 mb-3 p-2 bg-green-50 border border-green-200 rounded">
                  <input
                    type="checkbox"
                    id="create-lead"
                    checked={customerForm.create_as_lead}
                    onChange={(e) => setCustomerForm({...customerForm, create_as_lead: e.target.checked})}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="create-lead" className="cursor-pointer text-sm">
                    <span className="font-medium">Create as new lead</span>
                    <span className="block text-xs text-gray-600">(Check if this is a NEW customer)</span>
                  </Label>
                </div>

                <div className="mb-3">
                  <Label>Customer Full Name *</Label>
                  <Input
                    value={customerForm.customer_name}
                    onChange={(e) => setCustomerForm({...customerForm, customer_name: e.target.value})}
                    placeholder="Auto-fills from search above"
                    required
                  />
                </div>

                <div className="mb-3">
                  <Label>How to Send Contract *</Label>
                  <div className="flex gap-4 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="delivery"
                        value="email"
                        checked={customerForm.delivery_method === 'email'}
                        onChange={(e) => setCustomerForm({...customerForm, delivery_method: e.target.value})}
                        className="w-4 h-4"
                      />
                      <span>📧 Email</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="delivery"
                        value="sms"
                        checked={customerForm.delivery_method === 'sms'}
                        onChange={(e) => setCustomerForm({...customerForm, delivery_method: e.target.value})}
                        className="w-4 h-4"
                      />
                      <span>📱 SMS</span>
                    </label>
                  </div>
                </div>

                <div className="mb-3">
                  <Label>Customer Email {customerForm.delivery_method === 'email' ? '*' : ''}</Label>
                  <Input
                    type="email"
                    value={customerForm.customer_email}
                    onChange={(e) => setCustomerForm({...customerForm, customer_email: e.target.value})}
                    placeholder="Auto-fills from search above"
                    required={customerForm.delivery_method === 'email'}
                  />
                </div>

                <div>
                  <Label>Customer Phone {customerForm.delivery_method === 'sms' ? '*' : ''}</Label>
                  <Input
                    type="tel"
                    value={customerForm.customer_phone}
                    onChange={(e) => setCustomerForm({...customerForm, customer_phone: e.target.value})}
                    placeholder="Auto-fills from search above"
                    required={customerForm.delivery_method === 'sms'}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.history.back()}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createSessionMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {createSessionMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Start Signing
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sessionError || templateError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <X className="w-12 h-12 mx-auto mb-4 text-red-500" />
            <h2 className="text-xl font-bold mb-2">Error Loading Contract</h2>
            <p className="text-gray-600 mb-4">
              {sessionError?.message || templateError?.message || 'Could not load the signing session.'}
            </p>
            <p className="text-xs text-gray-400 mb-4">Session ID: {sessionId || 'none'}</p>
            <Button onClick={() => navigate(createPageUrl('ContractTemplates'))}>
              Back to Templates
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!session || !template) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-sm text-gray-500">Loading contract session...</p>
          <p className="text-xs text-gray-400 mt-1">Session: {sessionId || 'none'}</p>
        </div>
      </div>
    );
  }

  if (session.status !== 'draft' && session.status !== 'signed_by_rep' && !showFinalPreview) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="p-12 text-center">
            <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600" />
            <h2 className="text-2xl font-bold mb-2">Already Signed</h2>
            <p className="text-gray-600">This contract has already been signed by you.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const repFields = template.fillable_fields?.filter(f => f.filled_by === 'rep') || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Complete & Sign Contract</h1>
        <p className="text-gray-500 mt-1">{template.template_name}</p>
        <Badge className="mt-2 bg-blue-100 text-blue-700">
          Rep/Sales Person Signature (Step 1)
        </Badge>
      </div>

      <div className="flex items-center justify-between mb-6">
        <Alert className="bg-blue-50 border-blue-200 flex-1">
          <AlertDescription>
            <strong>📋 Workflow:</strong> Fill in your fields below, sign, and we will automatically send it to {session.customer_name} for their signature via {session.delivery_method}.
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={handleTestMode}
          className="ml-4 border-2 border-yellow-400 bg-yellow-50 hover:bg-yellow-100 text-yellow-800"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Test Mode
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Your Fields to Fill</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilledPreview(true)}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview Filled Data
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-gray-50 p-3 rounded border">
              <p className="text-sm"><strong>Contract:</strong> {session.contract_name}</p>
              <p className="text-sm"><strong>Customer:</strong> {session.customer_name}</p>
            </div>

            {repFields.length === 0 && (
              <Alert>
                <AlertDescription>
                  No fields detected for rep. You can still sign below.
                </AlertDescription>
              </Alert>
            )}

            {repFields.map((field) => {
              if (field.field_type === 'signature') return null;

              return (
                <div key={field.field_name}>
                  <Label>
                    {field.field_label}
                    {field.required && <span className="text-red-500"> *</span>}
                  </Label>
                  {field.field_type === 'date' ? (
                    <Input
                      type="date"
                      value={formValues[field.field_name] || ''}
                      onChange={(e) => setFormValues({...formValues, [field.field_name]: e.target.value})}
                      required={field.required}
                      placeholder={field.placeholder}
                    />
                  ) : field.field_type === 'email' ? (
                    <Input
                      type="email"
                      value={formValues[field.field_name] || ''}
                      onChange={(e) => setFormValues({...formValues, [field.field_name]: e.target.value})}
                      placeholder={field.placeholder}
                      required={field.required}
                    />
                  ) : field.field_type === 'phone' ? (
                    <Input
                      type="tel"
                      value={formValues[field.field_name] || ''}
                      onChange={(e) => setFormValues({...formValues, [field.field_name]: e.target.value})}
                      placeholder={field.placeholder || "(XXX) XXX-XXXX"}
                      required={field.required}
                    />
                  ) : field.field_type === 'currency' ? (
                    <Input
                      type="number"
                      step="0.01"
                      value={formValues[field.field_name] || ''}
                      onChange={(e) => setFormValues({...formValues, [field.field_name]: e.target.value})}
                      placeholder={field.placeholder || "0.00"}
                      required={field.required}
                    />
                  ) : (
                    <Input
                      type="text"
                      value={formValues[field.field_name] || ''}
                      onChange={(e) => setFormValues({...formValues, [field.field_name]: e.target.value})}
                      placeholder={field.placeholder}
                      required={field.required}
                    />
                  )}
                </div>
              );
            })}

            <div className="border-t pt-4 mt-4">
              <Label className="text-lg font-bold text-gray-900 block mb-2">
                Your Signature *
              </Label>
              <p className="text-sm text-gray-600 mb-3">
                Draw your signature using your mouse or finger
              </p>
              <SignaturePad onSignatureChange={setSignatureData} />
            </div>

            <Button
              onClick={handleSubmit}
              disabled={signMutation.isPending || !signatureData}
              className="w-full bg-blue-600 hover:bg-blue-700 text-lg py-6"
            >
              {signMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Signing...
                </>
              ) : (
                <>
                  <FileCheck className="w-5 h-5 mr-2" />
                  Sign & Preview
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="sticky top-6">
          <Card className="h-[800px]">
            <CardHeader className="border-b bg-gray-50">
              <div className="flex items-center justify-between">
                <CardTitle>Original Template</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPdfPreview(true)}
                  className="text-blue-600 hover:text-blue-700"
                >
                  <Maximize2 className="w-4 h-4 mr-1" />
                  Full Screen
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 h-[720px] flex flex-col">
              <PdfViewer
                src={`/api/proxy-pdf?url=${encodeURIComponent(template.original_file_url || '')}`}
                className="w-full flex-1 border-0"
                title="Contract Preview"
              />
              <div className="text-center py-1 bg-gray-50 border-t">
                <a href={template.original_file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                  Open in new tab ↗
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Full Screen Original Preview */}
      {showPdfPreview && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-6xl h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b bg-gray-50">
              <h2 className="text-xl font-bold">Original Template</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowPdfPreview(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col">
              <PdfViewer
                src={`/api/proxy-pdf?url=${encodeURIComponent(template.original_file_url || '')}`}
                className="w-full flex-1 border-0"
                title="Contract Full Preview"
              />
              <div className="text-center py-1 bg-gray-50 border-t">
                <a href={template.original_file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                  Open in new tab ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filled Data Preview for Rep */}
      {showFilledPreview && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b bg-gray-50">
              <h2 className="text-xl font-bold">Preview: What You Are Filling</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowFilledPreview(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="bg-blue-50 border-l-4 border-blue-600 p-4 mb-4">
                <h3 className="font-bold text-lg mb-2">{session.contract_name}</h3>
                <p className="text-sm text-gray-700">Template: {template.template_name}</p>
                <p className="text-sm text-gray-700">Customer: {session.customer_name}</p>
                <p className="text-sm text-gray-700">Rep: {session.rep_name}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-blue-900 mb-3 text-lg">✅ Your Filled Fields:</h4>
                  {repFields.length === 0 ? (
                    <p className="text-gray-500 text-sm">No fields to fill for rep</p>
                  ) : (
                    <div className="space-y-2">
                      {repFields.map(field => {
                        if (field.field_type === 'signature') {
                          return (
                            <div key={field.field_name} className="bg-white p-3 rounded border">
                              <Label className="text-sm text-gray-600">{field.field_label}</Label>
                              {signatureData ? (
                                <div className="mt-2 border rounded p-2 bg-gray-50">
                                  <img src={signatureData} alt="Signature" className="h-16" />
                                </div>
                              ) : (
                                <p className="text-red-500 text-sm mt-1">[Not signed yet]</p>
                              )}
                            </div>
                          );
                        }
                        return (
                          <div key={field.field_name} className="bg-white p-3 rounded border">
                            <Label className="text-sm text-gray-600">{field.field_label}</Label>
                            <p className="font-medium mt-1">
                              {formValues[field.field_name] || <span className="text-gray-400">[Not filled]</span>}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold text-orange-900 mb-3 text-lg">⏳ Customer Will Fill:</h4>
                  {template.fillable_fields?.filter(f => f.filled_by === 'customer').length === 0 ? (
                    <p className="text-gray-500 text-sm">No fields for customer</p>
                  ) : (
                    <div className="space-y-2">
                      {template.fillable_fields.filter(f => f.filled_by === 'customer').map(field => (
                        <div key={field.field_name} className="bg-orange-50 p-3 rounded border border-orange-200">
                          <Label className="text-sm text-gray-600">{field.field_label}</Label>
                          <p className="text-sm text-orange-600 mt-1">[Waiting for customer signature]</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Final Preview Before Sending */}
      {showFinalPreview && signedSessionData && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-0 md:p-4">
          <div className="bg-white rounded-lg w-full md:max-w-4xl h-full md:h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 md:p-6 border-b bg-gradient-to-r from-green-50 to-blue-50 flex-shrink-0">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-gray-900">✅ You Have Signed!</h2>
                <p className="text-xs md:text-sm text-gray-600 mt-1">Review before sending to customer</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowFinalPreview(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ paddingBottom: '180px' }}>
              <Alert className="bg-blue-50 border-blue-200 mb-6">
                <AlertDescription>
                  <strong>Next Step:</strong> Review your signature and information below, then click "Send to Customer" to deliver the contract to {signedSessionData.customer_name} via {signedSessionData.delivery_method}.
                </AlertDescription>
              </Alert>

              <div className="bg-gray-50 border-2 border-green-200 rounded-lg p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">{signedSessionData.contract_name}</h3>
                    <p className="text-sm text-gray-600">Template: {template.template_name}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Customer:</p>
                    <p className="font-semibold text-gray-900">{signedSessionData.customer_name}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Will be sent via:</p>
                    <p className="font-semibold text-gray-900 capitalize">{signedSessionData.delivery_method}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Rep/Sales Person:</p>
                    <p className="font-semibold text-gray-900">{signedSessionData.rep_name}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Signed at:</p>
                    <p className="font-semibold text-gray-900">{new Date(signedSessionData.rep_signed_at).toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h4 className="font-semibold text-gray-900 mb-3 text-lg">Your Signed Information:</h4>
                  {repFields.length === 0 ? (
                    <p className="text-gray-500 text-sm">No fields filled</p>
                  ) : (
                    <div className="space-y-3">
                      {repFields.map(field => {
                        if (field.field_type === 'signature') {
                          return (
                            <div key={field.field_name} className="bg-white p-4 rounded-lg border-2 border-green-200">
                              <Label className="text-sm font-semibold text-gray-700">{field.field_label}</Label>
                              {signedSessionData.rep_signature_url && (
                                <div className="mt-3 border-2 border-green-300 rounded-lg p-3 bg-green-50">
                                  <img src={signedSessionData.rep_signature_url} alt="Your Signature" className="h-20" />
                                </div>
                              )}
                            </div>
                          );
                        }
                        const fieldValue = signedSessionData.rep_fields?.[field.field_name];
                        return (
                          <div key={field.field_name} className="bg-white p-4 rounded-lg border">
                            <Label className="text-sm text-gray-600">{field.field_label}</Label>
                            <p className="font-medium text-gray-900 mt-1">
                              {fieldValue || <span className="text-gray-400">—</span>}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border-t pt-6">
                  <h4 className="font-semibold text-gray-900 mb-3 text-lg">Customer Will Fill:</h4>
                  {template.fillable_fields?.filter(f => f.filled_by === 'customer').length === 0 ? (
                    <p className="text-gray-500 text-sm">No fields for customer</p>
                  ) : (
                    <div className="space-y-2">
                      {template.fillable_fields.filter(f => f.filled_by === 'customer').map(field => (
                        <div key={field.field_name} className="bg-orange-50 p-3 rounded-lg border border-orange-200">
                          <Label className="text-sm text-gray-600">{field.field_label}</Label>
                          <p className="text-sm text-orange-600 mt-1 italic">Waiting for customer to fill</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t md:border-t-0 p-3 md:p-6 bg-white flex flex-row items-center justify-between gap-2 fixed md:static bottom-6 left-4 right-4 md:inset-auto md:w-full rounded-xl md:rounded-none border md:border-0 shadow-2xl md:shadow-none z-[210] safe-area-bottom">
              <Button
                variant="outline"
                onClick={() => setShowFinalPreview(false)}
                className="flex-1 md:flex-none md:w-auto h-12 text-sm md:text-base"
              >
                Cancel
              </Button>
              <Button
                onClick={() => sendToCustomerMutation.mutate(signedSessionData.id)}
                disabled={sendToCustomerMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-sm md:text-lg px-4 md:px-8 h-12 flex-1 md:flex-none md:w-auto"
              >
                {sendToCustomerMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 md:w-5 md:h-5 mr-1 md:mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 md:w-5 md:h-5 mr-1 md:mr-2" />
                    Send
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}