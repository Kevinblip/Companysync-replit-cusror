import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, MessageSquare, FileText, Sparkles, Save, Copy, Send, Loader2, Edit, Palette, Upload, X, Video } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SocialAdBuilder from "@/components/marketing/SocialAdBuilder";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

export default function MarcusMarketing() {
  const [user, setUser] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generatedCopy, setGeneratedCopy] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [editingCopy, setEditingCopy] = useState(null);
  const [showSamples, setShowSamples] = useState(false);
  const [postcardDesign, setPostcardDesign] = useState({
    primaryColor: '#1e40af',
    accentColor: '#dc2626',
    logoUrl: '',
    companyName: '',
    phone: '',
    website: ''
  });
  const [formData, setFormData] = useState({
    type: 'email',
    context: 'storm_damage',
    recipientName: '',
    recipientEmail: '',
    recipientPhone: '',
    recipientAddress: '',
    recipientList: 'single', // single, all_leads, all_customers, my_leads, my_customers
    selectedContacts: [], // Array of selected contact IDs
    manualContacts: [], // Array of manually added contacts {name, email, phone, address}
    customData: {
      stormDate: '',
      damageType: '',
      offerDetails: '',
      urgency: ''
    }
  });
  const [contactSearch, setContactSearch] = useState('');
  const [manualContactForm, setManualContactForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: ''
  });
  const [importingCSV, setImportingCSV] = useState(false);
  
  // Chat with Marcus
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const chatEndRef = React.useRef(null);
  const [marcusSettings, setMarcusSettings] = useState(null);

  const [activeTab, setActiveTab] = useState("direct");
  const [selectedSocialTemplate, setSelectedSocialTemplate] = useState(null);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  // Auto-scroll to bottom when messages change
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const queryClient = useQueryClient();

  const [staffProfile, setStaffProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  React.useEffect(() => {
    const init = async () => {
      if (!myCompany) return;
      try {
        setPostcardDesign({
          primaryColor: myCompany.brand_primary_color || '#1e40af',
          accentColor: myCompany.brand_secondary_color || '#dc2626',
          logoUrl: myCompany.logo_url || '',
          companyName: myCompany.company_name || '',
          phone: myCompany.phone || '',
          website: myCompany.website || ''
        });

        const settings = await base44.entities.AssistantSettings.filter({ company_id: myCompany.id, assistant_name: 'marcus' });
        if (settings && settings.length > 0) {
          setMarcusSettings(settings[0]);
        }

        if (user) {
          const profiles = await base44.entities.StaffProfile.filter({ user_email: user.email, company_id: myCompany.id });
          if (profiles.length > 0) {
            setStaffProfile(profiles[0]);
            setIsAdmin(myCompany.created_by === user.email || profiles[0].is_super_admin);
          } else {
            setIsAdmin(myCompany.created_by === user.email);
          }
        }
      } catch (error) {
        console.error("Failed to initialize Marcus:", error);
      }
    };

    init();
  }, [myCompany, user]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      if (marcusSettings) {
        await base44.entities.AssistantSettings.update(marcusSettings.id, { avatar_url: file_url });
        setMarcusSettings({ ...marcusSettings, avatar_url: file_url });
      } else {
        const newSettings = await base44.entities.AssistantSettings.create({
          company_id: myCompany?.id,
          assistant_name: 'marcus',
          avatar_url: file_url,
          engine: 'gpt-4o', // Default for Marcus
          live_mode: false,
          voice_enabled: false
        });
        setMarcusSettings(newSettings);
      }
      alert('✅ Avatar updated!');
    } catch (error) {
      console.error("Avatar upload failed:", error);
      alert('Failed to upload avatar: ' + error.message);
    }
  };

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['email-templates', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const [defaults, company] = await Promise.all([
        base44.entities.EmailTemplate.filter({ company_id: myCompany.id, is_default: true }, "-created_date", 100),
        base44.entities.EmailTemplate.filter({ company_id: myCompany.id }, "-created_date", 100)
      ]);
      const all = [...defaults, ...company];
      return Array.from(new Map(all.map(item => [item.id, item])).values());
    },
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: smsTemplates = [] } = useQuery({
    queryKey: ['sms-templates', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const [defaults, company] = await Promise.all([
        base44.entities.SMSTemplate.filter({ company_id: myCompany.id, is_default: true }, "-created_date", 100),
        base44.entities.SMSTemplate.filter({ company_id: myCompany.id }, "-created_date", 100)
      ]);
      const all = [...defaults, ...company];
      return Array.from(new Map(all.map(item => [item.id, item])).values());
    },
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: campaignDrafts = [] } = useQuery({
    queryKey: ['campaign-drafts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Campaign.filter({ company_id: myCompany.id, status: 'draft' }, "-created_date", 5) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads-for-campaign', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", 5000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers-for-campaign', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 5000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allProperties = [] } = useQuery({
    queryKey: ['properties-for-campaign', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Property.filter({ company_id: myCompany.id }, "-created_date", 5000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // Filter contacts based on selection
  const availableContacts = React.useMemo(() => {
    if (!user || formData.recipientList === 'single') return [];

    let contacts = [];

    if (formData.recipientList === 'all_leads' || formData.recipientList === 'my_leads' || formData.recipientList === 'all_contacts' || formData.recipientList === 'my_contacts') {
      const filteredLeads = formData.recipientList.startsWith('my_') 
        ? allLeads.filter(l => l.assigned_to === user.email || l.assigned_to_users?.includes(user.email))
        : allLeads;
      
      contacts = [...contacts, ...filteredLeads.map(l => ({
        id: l.id,
        name: l.name,
        email: l.email,
        phone: l.phone,
        address: `${l.street || ''}, ${l.city || ''}, ${l.state || ''}`.trim(),
        type: 'lead',
        source: l.source
      }))];
    }

    if (formData.recipientList === 'all_customers' || formData.recipientList === 'my_customers' || formData.recipientList === 'all_contacts' || formData.recipientList === 'my_contacts') {
      const filteredCustomers = formData.recipientList.startsWith('my_') 
        ? allCustomers.filter(c => c.assigned_to === user.email || c.assigned_to_users?.includes(user.email))
        : allCustomers;
      
      contacts = [...contacts, ...filteredCustomers.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: `${c.street || ''}, ${c.city || ''}, ${c.state || ''}`.trim(),
        type: 'customer',
        source: c.source
      }))];
    }

    if (formData.recipientList === 'lead_finder') {
      contacts = allProperties.map(p => ({
        id: p.id,
        name: p.owner_name || 'Unknown Owner',
        email: p.owner_email,
        phone: p.owner_phone,
        address: p.full_address || `${p.street_address || ''}, ${p.city || ''}, ${p.state || ''}`.trim(),
        type: 'property',
        source: 'Lead Finder'
      }));
    }

    return contacts.filter(c => c.email || c.phone); // Only include contacts with email or phone
  }, [allLeads, allCustomers, allProperties, user, formData.recipientList]);

  // Filter contacts by search term
  const filteredContacts = React.useMemo(() => {
    if (!contactSearch) return availableContacts;
    
    const searchLower = contactSearch.toLowerCase();
    return availableContacts.filter(c => 
      c.name?.toLowerCase().includes(searchLower) ||
      c.email?.toLowerCase().includes(searchLower) ||
      c.phone?.includes(contactSearch) ||
      c.address?.toLowerCase().includes(searchLower)
    );
  }, [availableContacts, contactSearch]);

  const handleSelectAll = () => {
    setFormData({
      ...formData,
      selectedContacts: availableContacts.map(c => c.id)
    });
  };

  const handleDeselectAll = () => {
    setFormData({
      ...formData,
      selectedContacts: []
    });
  };

  const handleToggleContact = (contactId) => {
    setFormData({
      ...formData,
      selectedContacts: formData.selectedContacts.includes(contactId)
        ? formData.selectedContacts.filter(id => id !== contactId)
        : [...formData.selectedContacts, contactId]
    });
  };

  const handleAddManualContact = () => {
    if (!manualContactForm.name.trim() || (!manualContactForm.email.trim() && !manualContactForm.phone.trim())) {
      alert('Please enter at least a name and either email or phone');
      return;
    }

    setFormData({
      ...formData,
      manualContacts: [...formData.manualContacts, { ...manualContactForm, id: 'manual_' + Date.now() }]
    });

    setManualContactForm({ name: '', email: '', phone: '', address: '' });
  };

  const handleRemoveManualContact = (contactId) => {
    setFormData({
      ...formData,
      manualContacts: formData.manualContacts.filter(c => c.id !== contactId)
    });
  };

  const handleCSVImport = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportingCSV(true);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          alert('❌ CSV file must have headers and at least one data row');
          setImportingCSV(false);
          return;
        }

        // Parse header row
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        
        // Find column indices
        const nameIdx = headers.findIndex(h => h.includes('name'));
        const emailIdx = headers.findIndex(h => h.includes('email'));
        const phoneIdx = headers.findIndex(h => h.includes('phone'));
        const addressIdx = headers.findIndex(h => h.includes('address'));

        // Parse data rows
        const newContacts = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          
          const name = nameIdx >= 0 ? values[nameIdx] : '';
          const email = emailIdx >= 0 ? values[emailIdx] : '';
          const phone = phoneIdx >= 0 ? values[phoneIdx] : '';
          const address = addressIdx >= 0 ? values[addressIdx] : '';

          if (name && (email || phone)) {
            newContacts.push({
              id: 'csv_' + Date.now() + '_' + i,
              name,
              email,
              phone,
              address
            });
          }
        }

        if (newContacts.length === 0) {
          alert('❌ No valid contacts found in CSV. Make sure your file has Name and (Email or Phone) columns.');
          setImportingCSV(false);
          return;
        }

        // Ask for confirmation before importing
        const confirmImport = confirm(
          `Ready to import ${newContacts.length} contacts from CSV?\n\n` +
          `First contact: ${newContacts[0].name}\n` +
          `${newContacts[0].email || newContacts[0].phone}\n\n` +
          `Click OK to add them to your campaign.`
        );

        if (!confirmImport) {
          setImportingCSV(false);
          return;
        }

        setFormData({
          ...formData,
          manualContacts: [...formData.manualContacts, ...newContacts]
        });

        alert(`✅ Imported ${newContacts.length} contacts from CSV!`);
        setImportingCSV(false);
      } catch (error) {
        alert('❌ Failed to parse CSV: ' + error.message);
        setImportingCSV(false);
      }
    };

    reader.onerror = () => {
      alert('❌ Failed to read file');
      setImportingCSV(false);
    };

    reader.readAsText(file);
    event.target.value = ''; // Reset input
  };

  const saveEmailTemplateMutation = useMutation({
    mutationFn: (data) => base44.entities.EmailTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      alert('✅ Email template saved!');
    },
  });

  const saveSMSTemplateMutation = useMutation({
    mutationFn: (data) => base44.entities.SMSTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-templates'] });
      alert('✅ SMS template saved!');
    },
  });

  const handleGenerateCampaign = async () => {
    if (!formData.type || !formData.context) {
      alert('Please select campaign type and context');
      return;
    }

    // Validate recipient selection
    if (formData.recipientList === 'single') {
      if (!formData.recipientName.trim()) {
        alert('Please enter a recipient name or select "Send To" a contact list');
        return;
      }
    } else {
      if (formData.selectedContacts.length === 0) {
        alert(`Please select at least one contact from your ${formData.recipientList.replace(/_/g, ' ')} list`);
        return;
      }
    }

    setGenerating(true);
    try {
      // Get selected contacts with their info
      const selectedContactsData = availableContacts.filter(c => 
        formData.selectedContacts.includes(c.id)
      );

      // Generate SINGLE template copy (we'll personalize it per contact)
      const result = await base44.functions.invoke('generateMarketingCopy', {
        type: formData.type,
        context: formData.context,
        recipientName: formData.recipientList === 'single' 
          ? formData.recipientName 
          : selectedContactsData[0]?.name || 'Valued Customer',
        recipientAddress: formData.recipientList === 'single'
          ? formData.recipientAddress
          : selectedContactsData[0]?.address,
        companyName: myCompany?.company_name,
        customData: formData.customData
      });

      // Store both the template and the recipients (include manual contacts)
      setGeneratedCopy({
        ...result.data,
        isBulk: formData.recipientList !== 'single',
        recipients: formData.recipientList === 'single' 
          ? [{
              name: formData.recipientName,
              address: formData.recipientAddress,
              email: formData.recipientEmail,
              phone: formData.recipientPhone
            }]
          : [...selectedContactsData, ...formData.manualContacts]
      });
      
      setEditingCopy(result.data.copy.copy); // Initialize editing with generated copy
      setShowPreview(true);
    } catch (error) {
      console.error('Error generating campaign:', error);
      alert('❌ Failed to generate campaign: ' + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!generatedCopy) return;

    const templateName = prompt('Enter template name:');
    if (!templateName) return;

    try {
      const templateBody = editingCopy || generatedCopy.copy.copy;
      
      if (formData.type === 'email') {
        await saveEmailTemplateMutation.mutateAsync({
          company_id: myCompany?.id,
          template_name: templateName,
          subject: generatedCopy.copy.subject || 'No Subject',
          body: templateBody,
          is_active: true,
          category: formData.context
        });
      } else if (formData.type === 'sms') {
        await saveSMSTemplateMutation.mutateAsync({
          company_id: myCompany?.id,
          template_name: templateName,
          message: templateBody,
          is_active: true,
          category: formData.context
        });
      } else if (formData.type === 'postcard' || formData.type === 'letter') {
        await base44.entities.EmailTemplate.create({
          company_id: myCompany?.id,
          template_name: templateName,
          subject: generatedCopy.copy.headline || 'Marketing Template',
          body: templateBody,
          is_active: true,
          category: formData.context,
          template_type: formData.type,
          design_settings: JSON.stringify(postcardDesign),
          cta_text: generatedCopy.copy.cta
        });
        alert('✅ ' + formData.type.charAt(0).toUpperCase() + formData.type.slice(1) + ' template saved!');
        queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      }
    } catch (error) {
      console.error('Error saving template:', error);
      alert('❌ Failed to save template: ' + error.message);
    }
  };

  const handleCopyToClipboard = () => {
    const text = editingCopy || generatedCopy?.copy?.copy || '';
    navigator.clipboard.writeText(text);
    alert('✅ Copied to clipboard!');
  };

  const handleRefineCopy = async () => {
    if (!refineInstruction.trim()) return;
    setIsRefining(true);
    try {
      const currentText = editingCopy || generatedCopy.copy.copy;
      const prompt = `You are Marcus, an expert marketing copywriter. 
      
      Current Draft:
      "${currentText}"
      
      User Instruction:
      "${refineInstruction}"
      
      Please rewrite the draft following the instructions. Keep the formatting suitable for the medium (${formData.type}). Return ONLY the new copy text.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: prompt
      });
      
      setEditingCopy(response);
      setRefineInstruction("");
    } catch (err) {
      alert("Failed to refine: " + err.message);
    } finally {
      setIsRefining(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!generatedCopy) return;
    try {
      const templateBody = editingCopy || generatedCopy.copy.copy;
      await base44.entities.Campaign.create({
        company_id: myCompany?.id,
        campaign_name: `${formData.type.toUpperCase()} Draft - ${new Date().toLocaleDateString()}`,
        campaign_type: formData.type === 'letter' ? 'print' : formData.type, // Map 'letter'/postcard to print or similar
        campaign_platform: formData.type === 'email' ? 'email' : formData.type === 'sms' ? 'sms' : 'print',
        status: "draft",
        target_audience: formData.recipientList === 'single' ? 'leads' : 'both', // Simplified default
        notes: `Context: ${formData.context}. \nDraft Copy:\n${templateBody.substring(0, 500)}...`,
        email_template_id: "draft", // Placeholder or handling needed
        created_by: user?.email
      });
      alert('✅ Saved as Draft Campaign!');
      queryClient.invalidateQueries({ queryKey: ['campaign-drafts'] });
    } catch (error) {
      console.error("Failed to save draft:", error);
      alert("Failed to save draft: " + error.message);
    }
  };

  const handleLoadSavedTemplate = (template, type) => {
    setActiveTab('direct');
    setFormData({
      ...formData,
      type: type,
      context: template.category || 'general'
    });
    
    const content = type === 'email' ? template.body : template.message;
    
    setGeneratedCopy({
      copy: {
        subject: template.subject || '',
        copy: content || '',
        headline: '',
        cta: '',
        tips: []
      },
      isBulk: false,
      recipients: [],
      metadata: {
        type: type,
        context: template.category
      }
    });
    
    setEditingCopy(content || '');
    setShowPreview(true);
  };

  const campaignTypes = [
    { value: 'email', label: 'Email Campaign', icon: Mail },
    { value: 'sms', label: 'SMS Campaign', icon: MessageSquare },
    { value: 'postcard', label: 'Postcard', icon: FileText },
    { value: 'letter', label: 'Sales Letter', icon: FileText }
  ];

  const contextOptions = [
    { value: 'storm_damage', label: '🌩️ Storm Damage Follow-up' },
    { value: 'lead_followup', label: '📞 Lead Follow-up' },
    { value: 'property_import', label: '🏠 Property Importer Outreach' },
    { value: 'estimate_reminder', label: '💰 Estimate Reminder' },
    { value: 'payment_reminder', label: '💵 Payment Reminder' },
    { value: 'referral_request', label: '⭐ Referral Request' },
    { value: 'general', label: '✉️ General Marketing' }
  ];



  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadedFiles([...uploadedFiles, { name: file.name, url: file_url }]);
    } catch (error) {
      alert('Failed to upload file: ' + error.message);
    }
  };

  const handleChatSubmit = async () => {
    if (!chatInput.trim() && uploadedFiles.length === 0) return;

    const userMessage = {
      role: 'user',
      content: chatInput,
      files: uploadedFiles
    };

    setChatMessages([...chatMessages, userMessage]);
    setChatInput('');
    setUploadedFiles([]);
    setChatLoading(true);

    try {
      // Build context for Marcus
      const context = {
        companyName: myCompany?.company_name,
        user: user?.full_name,
        allLeads: allLeads.length,
        allCustomers: allCustomers.length,
        conversationHistory: chatMessages.map(m => ({
          role: m.role,
          content: m.content
        }))
      };

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are Marcus, an expert marketing copywriter and campaign manager. You help users plan and EXECUTE marketing campaigns.

PREVIOUS CONVERSATION HISTORY:
${context.conversationHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}

CURRENT USER MESSAGE: "${chatInput}"

${uploadedFiles.length > 0 ? `User uploaded ${uploadedFiles.length} file(s) as reference.` : ''}

CONTEXT:
- Company: ${context.companyName}
- User: ${context.user}
- Available contacts: ${context.allLeads} leads, ${context.allCustomers} customers

YOUR CAPABILITIES:
- Plan email, SMS, postcard, and letter campaigns
- CREATE SOCIAL ADS for Facebook, Instagram, and YouTube (guide user to Social Ads tab)
- Generate persuasive marketing copy and ad creatives
- EXECUTE campaigns by sending emails/SMS to selected contacts
- Suggest targeting strategies and audiences

If the user wants to SEND a campaign:
1. Confirm the campaign details (type, message, recipients)
2. Return a JSON action in this exact format:
{
  "action": "execute_campaign",
  "campaignType": "email" or "sms",
  "recipients": "all_customers" or "all_leads" or specific list,
  "subject": "email subject (if email)",
  "message": "the actual message to send",
  "personalize": true or false
}

If the user wants to CREATE A VIDEO or VIDEO SCRIPT:
1. Return a JSON action to open the video builder with the script:
{
  "action": "create_video_draft",
  "script": "the full video script or outline discussed",
  "platform": "facebook"
}

Otherwise, have a helpful marketing conversation.`,
        response_json_schema: null
      });

      const marcusReply = {
        role: 'assistant',
        content: response
      };

      // Check if Marcus wants to execute a campaign
      try {
        const actionMatch = response.match(/\{[\s\S]*"action"[\s\S]*\}/);
        if (actionMatch) {
          const action = JSON.parse(actionMatch[0]);
          
          if (action.action === 'execute_campaign') {
            marcusReply.campaignAction = action;
          } else if (action.action === 'create_video_draft') {
            marcusReply.videoAction = action;
          }
        }
      } catch (e) {
        // Not an action, just a regular response
      }

      setChatMessages([...chatMessages, userMessage, marcusReply]);
    } catch (error) {
      setChatMessages([...chatMessages, userMessage, {
        role: 'assistant',
        content: 'Sorry, I encountered an error: ' + error.message
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleExecuteCampaign = async (action) => {
    const confirmMsg = `Execute campaign?\n\nType: ${action.campaignType}\nTo: ${action.recipients}\nMessage preview: ${action.message.substring(0, 100)}...`;
    
    if (!confirm(confirmMsg)) return;

    try {
      let targetContacts = [];
      
      if (action.recipients === 'all_customers') {
        targetContacts = allCustomers.map(c => ({ name: c.name, email: c.email, phone: c.phone }));
      } else if (action.recipients === 'all_leads') {
        targetContacts = allLeads.map(l => ({ name: l.name, email: l.email, phone: l.phone }));
      }

      let successCount = 0;
      let failCount = 0;

      for (const contact of targetContacts) {
        try {
          let message = action.message;
          if (action.personalize) {
            message = message.replace(/\{name\}/g, contact.name || 'Valued Customer');
          }

          if (action.campaignType === 'email' && contact.email) {
            await base44.functions.invoke('sendEmailWithResend', {
              to: contact.email,
              subject: action.subject || 'Message from ' + myCompany?.company_name,
              body: message,
              fromName: myCompany?.company_name
            });
            successCount++;
          } else if (action.campaignType === 'sms' && contact.phone) {
            await base44.functions.invoke('sendSMS', {
              to: contact.phone,
              message: message,
              contactName: contact.name,
              companyId: myCompany?.id
            });
            successCount++;
          }
        } catch (error) {
          failCount++;
        }
      }

      const resultMsg = {
        role: 'assistant',
        content: `✅ Campaign executed!\n\nSent: ${successCount}\nFailed: ${failCount}`
      };

      setChatMessages([...chatMessages, resultMsg]);
    } catch (error) {
      alert('Campaign failed: ' + error.message);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="bg-gradient-to-r from-pink-500 to-red-600 text-white p-8 rounded-xl shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center overflow-hidden border-2 border-white/30">
                {marcusSettings?.avatar_url ? (
                  <img src={marcusSettings.avatar_url} alt="Marcus" className="w-full h-full object-cover" />
                ) : (
                  <Mail className="w-8 h-8" />
                )}
              </div>
              <label 
                htmlFor="marcus-avatar-upload" 
                className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
              >
                <Upload className="w-6 h-6 text-white" />
              </label>
              <input 
                type="file" 
                id="marcus-avatar-upload" 
                className="hidden" 
                accept="image/*"
                onChange={handleAvatarUpload}
              />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Marcus - Marketing Copywriter</h1>
              <p className="text-pink-100 mt-1">AI-powered Direct Response & Campaign Creation</p>
            </div>
          </div>
          <Button
            onClick={() => setShowChat(true)}
            className="bg-white text-pink-600 hover:bg-pink-50"
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Chat with Marcus
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="bg-white/20 text-white border-white/30">AIDA Formula</Badge>
          <Badge className="bg-white/20 text-white border-white/30">PAS Method</Badge>
          <Badge className="bg-white/20 text-white border-white/30">BAB Framework</Badge>
          <Badge className="bg-white/20 text-white border-white/30">High-Converting CTAs</Badge>
          <Badge className="bg-white/20 text-white border-white/30">Execute Campaigns</Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="direct">📧 Direct Marketing</TabsTrigger>
          <TabsTrigger value="social">📱 Social Media Ads</TabsTrigger>
          <TabsTrigger value="drafts">📂 Drafts & Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="direct">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-pink-600" />
              Create Campaign
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Campaign Type</Label>
              <Select value={formData.type} onValueChange={(v) => setFormData({...formData, type: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {campaignTypes.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Campaign Context</Label>
              <Select value={formData.context} onValueChange={(v) => setFormData({...formData, context: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contextOptions.map(ctx => (
                    <SelectItem key={ctx.value} value={ctx.value}>
                      {ctx.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Send To</Label>
              <Select value={formData.recipientList} onValueChange={(v) => setFormData({...formData, recipientList: v, selectedContacts: []})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single Recipient (Manual Entry)</SelectItem>
                  {isAdmin && (
                    <>
                      <SelectItem value="all_leads">🎯 All Leads</SelectItem>
                      <SelectItem value="all_customers">👥 All Customers</SelectItem>
                      <SelectItem value="all_contacts">📧 All Contacts (Leads + Customers)</SelectItem>
                      <SelectItem value="lead_finder">🔍 Lead Finder (Property Data)</SelectItem>
                    </>
                  )}
                  <SelectItem value="my_leads">📌 My Assigned Leads</SelectItem>
                  <SelectItem value="my_customers">📌 My Assigned Customers</SelectItem>
                  <SelectItem value="my_contacts">📌 My Assigned Contacts (Leads + Customers)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.recipientList !== 'single' && availableContacts.length > 0 && (
              <Card className="border-2 border-blue-200 bg-blue-50">
                <CardContent className="p-4 space-y-3">
                  <Alert className="bg-yellow-50 border-yellow-300 mb-3">
                    <AlertDescription className="text-xs">
                      ✅ Select contacts below. Marcus will personalize the message for each person using their name and address.
                    </AlertDescription>
                  </Alert>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm">Select Recipients</p>
                      <p className="text-xs text-gray-600">
                        {formData.selectedContacts.length} from CRM + {formData.manualContacts.length} manual = {formData.selectedContacts.length + formData.manualContacts.length} total
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={handleSelectAll}>
                        Select All
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleDeselectAll}>
                        Clear
                      </Button>
                    </div>
                  </div>
                  <Input
                    placeholder="🔍 Search by name, email, phone, or address..."
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    className="bg-white"
                  />
                  <div className="max-h-64 overflow-y-auto space-y-2 border rounded bg-white p-2">
                    {filteredContacts.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">No contacts found matching "{contactSearch}"</p>
                    ) : (
                      filteredContacts.map(contact => (
                      <div
                        key={contact.id}
                        onClick={() => handleToggleContact(contact.id)}
                        className={`p-3 border rounded cursor-pointer hover:bg-gray-50 transition-colors ${
                          formData.selectedContacts.includes(contact.id) ? 'border-blue-500 bg-blue-50' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={formData.selectedContacts.includes(contact.id)}
                            onChange={() => {}}
                            className="w-4 h-4"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm">{contact.name}</p>
                              <Badge variant="outline" className="text-xs">
                                {contact.type}
                              </Badge>
                            </div>
                            <div className="text-xs text-gray-600 space-y-0.5 mt-1">
                              {contact.email && <p>📧 {contact.email}</p>}
                              {contact.phone && <p>📞 {contact.phone}</p>}
                              {contact.address && <p>📍 {contact.address}</p>}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                    )}
                  </div>

                  {/* Manual Contact Entry */}
                  <div className="border-t pt-3 mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold text-sm">➕ Add Contacts Not in CRM</p>
                      <div>
                        <input
                          type="file"
                          id="csv-upload"
                          accept=".csv"
                          className="hidden"
                          onChange={handleCSVImport}
                          disabled={importingCSV}
                        />
                        <label htmlFor="csv-upload">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={importingCSV}
                            className="bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                            asChild
                          >
                            <span className="cursor-pointer flex items-center gap-1">
                              {importingCSV ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Importing...
                                </>
                              ) : (
                                <>
                                  📥 Import CSV
                                </>
                              )}
                            </span>
                          </Button>
                        </label>
                      </div>
                    </div>
                    <div className="space-y-2 bg-white p-3 rounded border">
                      <Input
                        placeholder="Name *"
                        value={manualContactForm.name}
                        onChange={(e) => setManualContactForm({...manualContactForm, name: e.target.value})}
                        className="text-sm"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Email"
                          type="email"
                          value={manualContactForm.email}
                          onChange={(e) => setManualContactForm({...manualContactForm, email: e.target.value})}
                          className="text-sm"
                        />
                        <Input
                          placeholder="Phone"
                          type="tel"
                          value={manualContactForm.phone}
                          onChange={(e) => setManualContactForm({...manualContactForm, phone: e.target.value})}
                          className="text-sm"
                        />
                      </div>
                      <Input
                        placeholder="Address (optional)"
                        value={manualContactForm.address}
                        onChange={(e) => setManualContactForm({...manualContactForm, address: e.target.value})}
                        className="text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={handleAddManualContact}
                        className="w-full bg-blue-600 hover:bg-blue-700"
                      >
                        Add to Recipients
                      </Button>
                    </div>

                    {/* Show manually added contacts */}
                    {formData.manualContacts.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-semibold text-gray-700">Manually Added ({formData.manualContacts.length}):</p>
                        {formData.manualContacts.map((contact) => (
                          <div key={contact.id} className="p-2 bg-green-50 border border-green-200 rounded flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-sm">{contact.name}</p>
                              <div className="text-xs text-gray-600">
                                {contact.email && <p>📧 {contact.email}</p>}
                                {contact.phone && <p>📞 {contact.phone}</p>}
                                {contact.address && <p>📍 {contact.address}</p>}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveManualContact(contact.id)}
                              className="text-red-600 hover:text-red-700 h-6 px-2"
                            >
                              ✕
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {formData.recipientList === 'single' && (
              <>
                <div>
                  <Label>Recipient Name</Label>
                  <Input
                    placeholder="John Smith"
                    value={formData.recipientName}
                    onChange={(e) => setFormData({...formData, recipientName: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Email {formData.type === 'email' && '*'}</Label>
                    <Input
                      type="email"
                      placeholder="john@example.com"
                      value={formData.recipientEmail}
                      onChange={(e) => setFormData({...formData, recipientEmail: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Phone {formData.type === 'sms' && '*'}</Label>
                    <Input
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={formData.recipientPhone}
                      onChange={(e) => setFormData({...formData, recipientPhone: e.target.value})}
                    />
                  </div>
                </div>

                <div>
                  <Label>Property Address (Optional)</Label>
                  <Input
                    placeholder="123 Main St, City, State"
                    value={formData.recipientAddress}
                    onChange={(e) => setFormData({...formData, recipientAddress: e.target.value})}
                  />
                </div>
              </>
            )}

            {formData.context === 'storm_damage' && (
              <>
                <div>
                  <Label>Storm Date</Label>
                  <Input
                    type="date"
                    value={formData.customData.stormDate}
                    onChange={(e) => setFormData({
                      ...formData,
                      customData: {...formData.customData, stormDate: e.target.value}
                    })}
                  />
                </div>
                <div>
                  <Label>Damage Type</Label>
                  <Input
                    placeholder="Hail, Wind, etc."
                    value={formData.customData.damageType}
                    onChange={(e) => setFormData({
                      ...formData,
                      customData: {...formData.customData, damageType: e.target.value}
                    })}
                  />
                </div>
              </>
            )}

            <div>
              <Label>Special Offer Details (Optional)</Label>
              <Textarea
                placeholder="$500 off, Free inspection, Insurance assistance..."
                value={formData.customData.offerDetails}
                onChange={(e) => setFormData({
                  ...formData,
                  customData: {...formData.customData, offerDetails: e.target.value}
                })}
                rows={2}
              />
            </div>

            {formData.type === 'postcard' && (
              <Card className="bg-gradient-to-r from-pink-50 to-purple-50 border-pink-200">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Palette className="w-5 h-5 text-pink-600" />
                    Postcard Design Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label>Primary Color (Background)</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={postcardDesign.primaryColor}
                          onChange={(e) => setPostcardDesign({ ...postcardDesign, primaryColor: e.target.value })}
                          className="w-20 h-10"
                        />
                        <Input
                          type="text"
                          value={postcardDesign.primaryColor}
                          onChange={(e) => setPostcardDesign({ ...postcardDesign, primaryColor: e.target.value })}
                          placeholder="#1e40af"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Accent Color (Buttons/Badges)</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={postcardDesign.accentColor}
                          onChange={(e) => setPostcardDesign({ ...postcardDesign, accentColor: e.target.value })}
                          className="w-20 h-10"
                        />
                        <Input
                          type="text"
                          value={postcardDesign.accentColor}
                          onChange={(e) => setPostcardDesign({ ...postcardDesign, accentColor: e.target.value })}
                          placeholder="#dc2626"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label>Company Logo URL</Label>
                    <Input
                      placeholder="https://example.com/logo.png"
                      value={postcardDesign.logoUrl}
                      onChange={(e) => setPostcardDesign({ ...postcardDesign, logoUrl: e.target.value })}
                    />
                    <p className="text-xs text-gray-600 mt-1">Paste your logo image URL</p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label>Company Name</Label>
                      <Input
                        placeholder="ROOFING CORP."
                        value={postcardDesign.companyName}
                        onChange={(e) => setPostcardDesign({ ...postcardDesign, companyName: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Phone Number</Label>
                      <Input
                        placeholder="555.555.5555"
                        value={postcardDesign.phone}
                        onChange={(e) => setPostcardDesign({ ...postcardDesign, phone: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Website</Label>
                    <Input
                      placeholder="www.yourcompany.com"
                      value={postcardDesign.website}
                      onChange={(e) => setPostcardDesign({ ...postcardDesign, website: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            <Button
              onClick={handleGenerateCampaign}
              disabled={generating}
              className="w-full bg-gradient-to-r from-pink-600 to-red-600 hover:from-pink-700 hover:to-red-700"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Marcus is writing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Campaign
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
      </TabsContent>

      <TabsContent value="drafts">
        <div className="max-w-4xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Drafts</CardTitle>
            </CardHeader>
            <CardContent>
              {campaignDrafts.length === 0 ? (
                <p className="text-sm text-gray-500">No drafts found.</p>
              ) : (
                <div className="space-y-2">
                  {campaignDrafts.map(draft => (
                    <div key={draft.id} className="flex items-center justify-between p-2 border rounded hover:bg-gray-50 cursor-pointer"
                      onClick={() => {
                        // Load draft into editor
                        setActiveTab('direct'); // Switch back to direct tab
                        setFormData({
                          ...formData,
                          type: draft.campaign_platform === 'email' ? 'email' : draft.campaign_platform === 'sms' ? 'sms' : 'postcard',
                          context: 'general' // Default context if not saved
                        });
                        setGeneratedCopy({
                          copy: {
                            copy: draft.notes?.split('Draft Copy:')[1]?.trim() || draft.notes || '',
                            subject: draft.campaign_name
                          },
                          isBulk: draft.target_audience === 'both' || draft.target_audience === 'leads' || draft.target_audience === 'customers',
                          recipients: [] // Recipients aren't saved in draft details usually, simplified reload
                        });
                        setEditingCopy(draft.notes?.split('Draft Copy:')[1]?.trim() || draft.notes || '');
                        setShowPreview(true);
                      }}
                    >
                      <div>
                        <p className="font-medium text-sm truncate max-w-[200px]">{draft.campaign_name}</p>
                        <p className="text-xs text-gray-500 capitalize">
                          {draft.campaign_platform?.replace('_', ' ') || draft.campaign_type?.replace('_', ' ')} • {new Date(draft.created_date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">Draft</Badge>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          <Edit className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Saved Email Templates</CardTitle>
            </CardHeader>
            <CardContent>
              {emailTemplates.length === 0 ? (
                <p className="text-sm text-gray-500">No templates yet. Generate your first campaign!</p>
              ) : (
                <div className="space-y-2">
                  {emailTemplates.map(template => (
                    <div 
                      key={template.id} 
                      className="flex items-center justify-between p-3 border rounded hover:bg-blue-50 cursor-pointer transition-colors group"
                      onClick={() => handleLoadSavedTemplate(template, 'email')}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{template.template_name}</p>
                          <Badge variant="outline" className="text-[10px] h-5 group-hover:bg-blue-200">
                            Click to Edit
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-500">{template.category}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-gray-100">{template.is_active ? 'Active' : 'Inactive'}</Badge>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 group-hover:text-blue-600">
                          <Edit className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Saved SMS Templates</CardTitle>
            </CardHeader>
            <CardContent>
              {smsTemplates.length === 0 ? (
                <p className="text-sm text-gray-500">No SMS templates yet.</p>
              ) : (
                <div className="space-y-2">
                  {smsTemplates.map(template => (
                    <div 
                      key={template.id} 
                      className="flex items-center justify-between p-3 border rounded hover:bg-blue-50 cursor-pointer transition-colors group"
                      onClick={() => handleLoadSavedTemplate(template, 'sms')}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{template.template_name}</p>
                          <Badge variant="outline" className="text-[10px] h-5 group-hover:bg-blue-200">
                            Click to Edit
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-1">{template.message}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-gray-100">{template.is_active ? 'Active' : 'Inactive'}</Badge>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 group-hover:text-blue-600">
                          <Edit className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-sm text-blue-800">
              💡 <strong>Pro Tip:</strong> Marcus learns from high-converting campaigns. The more you use and save templates, the better his suggestions become!
            </AlertDescription>
          </Alert>
        </div>
      </TabsContent>

      <TabsContent value="social">
        <SocialAdBuilder user={user} myCompany={myCompany} initialTemplate={selectedSocialTemplate} />
      </TabsContent>
      </Tabs>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Campaign Preview</span>
              {generatedCopy?.isBulk && (
                <Badge className="bg-blue-600 text-white">
                  Bulk: {generatedCopy.recipients.length} Recipients
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {generatedCopy && (
            <div className="space-y-4">
              {generatedCopy.isBulk && (
                <Alert className="bg-yellow-50 border-yellow-300">
                  <AlertDescription className="text-sm">
                    <strong>📧 How it works:</strong>
                    <ol className="ml-4 mt-2 space-y-1">
                      <li>1. Marcus generated a template based on your settings</li>
                      <li>2. Edit the template below - use <code className="bg-gray-200 px-1 rounded">{'{{name}}'}</code> for customer name, <code className="bg-gray-200 px-1 rounded">{'{{address}}'}</code> for address</li>
                      <li>3. We'll personalize it for each of the {generatedCopy.recipients.length} selected contacts</li>
                      <li>4. Review personalized messages in "Preview All" tab before sending</li>
                    </ol>
                  </AlertDescription>
                </Alert>
              )}
              {/* Email Preview */}
              {formData.type === 'email' && generatedCopy.copy.subject && (
                <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                  <div className="bg-gray-100 border-b p-3">
                    <div className="text-xs text-gray-600 mb-1">Subject:</div>
                    <div className="font-semibold text-sm">{generatedCopy.copy.subject}</div>
                  </div>
                  <div className="p-4 max-h-96 overflow-y-auto bg-white">
                    <div className="prose prose-sm max-w-none">
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {editingCopy || generatedCopy.copy.copy}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SMS Preview */}
              {formData.type === 'sms' && (
                <div className="border rounded-lg overflow-hidden bg-gradient-to-br from-blue-50 to-purple-50 p-4">
                  <div className="max-w-xs mx-auto">
                    <div className="bg-white rounded-2xl shadow-md p-4 relative">
                      <div className="absolute -top-1 -right-1 w-0 h-0 border-l-8 border-l-transparent border-t-8 border-t-white"></div>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">
                        {editingCopy || generatedCopy.copy.copy}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Postcard/Letter - Show editing area */}
              {(formData.type === 'postcard' || formData.type === 'letter') && generatedCopy.copy.headline && (
                <div>
                  <Label className="font-semibold">Headline:</Label>
                  <div className="mt-1 p-3 bg-blue-50 border border-blue-200 rounded">
                    <p className="text-xl font-bold">{generatedCopy.copy.headline}</p>
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <Label className="font-semibold">
                    {formData.type === 'email' ? 'Edit Email Body:' : 
                     formData.type === 'sms' ? 'Edit SMS Message:' :
                     formData.type === 'postcard' ? 'Edit Postcard Copy:' : 'Edit Letter:'}
                  </Label>
                  <div className="flex gap-2">
                    {generatedCopy.isBulk && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const allPreviews = generatedCopy.recipients.map((recipient, idx) => {
                            let personalizedText = editingCopy || generatedCopy.copy.copy;
                            personalizedText = personalizedText.replace(/\{name\}/g, recipient.name || 'Valued Customer');
                            personalizedText = personalizedText.replace(/\{customer_name\}/g, recipient.name || 'Valued Customer');
                            personalizedText = personalizedText.replace(/\{address\}/g, recipient.address || '');
                            return `${idx + 1}. TO: ${recipient.name}\n${recipient.email || recipient.phone || 'No contact info'}\n\n${personalizedText}\n\n${'='.repeat(50)}\n`;
                          }).join('\n');
                          
                          alert(allPreviews);
                        }}
                      >
                        Preview All ({generatedCopy.recipients.length})
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="bg-pink-50"
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Editing Mode
                    </Button>
                  </div>
                </div>

                <Alert className="bg-blue-50 border-blue-300 mb-3">
                  <AlertDescription className="text-xs">
                    💡 <strong>Edit below:</strong> Type <code className="bg-white px-1 rounded">{'{name}'}</code> to insert customer name, <code className="bg-white px-1 rounded">{'{address}'}</code> for their address
                  </AlertDescription>
                </Alert>

                {/* Refine with Marcus */}
                <div className="flex gap-2 mb-3 bg-pink-50 p-2 rounded-lg border border-pink-100">
                  <Input 
                    value={refineInstruction}
                    onChange={(e) => setRefineInstruction(e.target.value)}
                    placeholder="Tell Marcus how to edit this (e.g. 'Make it shorter', 'Add more urgency', 'Make it funnier')"
                    className="bg-white text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && handleRefineCopy()}
                  />
                  <Button 
                    size="sm" 
                    onClick={handleRefineCopy} 
                    disabled={isRefining || !refineInstruction.trim()}
                    className="bg-pink-600 hover:bg-pink-700 text-white shrink-0"
                  >
                    {isRefining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                    Refine
                  </Button>
                </div>

                <Textarea
                  value={editingCopy || generatedCopy.copy.copy}
                  onChange={(e) => setEditingCopy(e.target.value)}
                  rows={formData.type === 'sms' ? 8 : formData.type === 'postcard' ? 12 : 15}
                  className="font-mono text-sm"
                  placeholder="Marcus will generate your copy here..."
                />

                {formData.type === 'sms' && (
                  <p className="text-xs text-gray-600 mt-1">
                    Character count: {(editingCopy || generatedCopy.copy.copy).length} / 160
                  </p>
                )}

                {formData.type === 'postcard' && (
                  <div className="mt-4">
                    <Label className="font-semibold mb-2 block">Visual Preview:</Label>
                    <div className="border-4 border-gray-800 rounded-lg overflow-hidden bg-white shadow-2xl max-w-4xl mx-auto">
                    {/* Postcard Front - Hero Section */}
                    <div className="relative text-white" style={{ background: `linear-gradient(to bottom right, ${postcardDesign.primaryColor}, ${postcardDesign.primaryColor}dd)` }}>
                      {/* Top Corner Offer */}
                      <div className="absolute top-4 left-4 bg-yellow-400 text-gray-900 px-6 py-3 rounded-lg transform -rotate-3 shadow-xl">
                        <p className="text-2xl font-black">FREE</p>
                        <p className="text-sm font-bold">ESTIMATES</p>
                      </div>

                      {/* Service Badges */}
                      <div className="absolute top-4 right-4 space-y-2">
                        <div className="text-white px-6 py-2 rounded-full font-bold text-sm shadow-lg" style={{ backgroundColor: postcardDesign.accentColor }}>
                          STORM DAMAGE REPAIRS
                        </div>
                      </div>

                      {/* Image Placeholder Area */}
                      <div className="h-64 bg-gradient-to-b from-transparent to-black/30 flex items-center justify-center">
                        <div className="text-center p-8">
                          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border-2 border-white/30">
                            <p className="text-sm text-white/80 mb-2">📸 Hero Image Area</p>
                            <p className="text-xs text-white/60">Upload a house/roof photo for print version</p>
                          </div>
                        </div>
                      </div>

                      {/* Main Headline */}
                      {generatedCopy.copy.headline && (
                        <div className="py-4 px-6" style={{ backgroundColor: postcardDesign.accentColor }}>
                          <h1 className="text-3xl md:text-4xl font-black text-center text-white uppercase tracking-tight">
                            {generatedCopy.copy.headline}
                          </h1>
                        </div>
                      )}
                    </div>

                    {/* Body Content */}
                    <div className="bg-white p-8">
                      <div className="prose prose-sm max-w-none">
                        <div className="text-gray-800 whitespace-pre-wrap leading-relaxed">
                          {editingCopy || generatedCopy.copy.copy}
                        </div>
                      </div>
                    </div>

                    {/* Bottom CTA Section */}
                    <div className="text-white p-8" style={{ background: `linear-gradient(to right, ${postcardDesign.primaryColor}, ${postcardDesign.primaryColor}dd, ${postcardDesign.primaryColor})` }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {postcardDesign.logoUrl ? (
                            <img src={postcardDesign.logoUrl} alt="Logo" className="h-16 w-16 object-contain bg-white p-2 rounded" />
                          ) : (
                            <div className="w-16 h-16 bg-white rounded flex items-center justify-center">
                              <p className="font-bold text-xs" style={{ color: postcardDesign.primaryColor }}>LOGO</p>
                            </div>
                          )}
                          <div>
                            <p className="text-2xl font-bold">{postcardDesign.companyName || 'ROOFING CORP.'}</p>
                            {postcardDesign.website && (
                              <p className="text-sm opacity-80">{postcardDesign.website}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold opacity-80 mb-1">CALL TODAY</p>
                          <p className="text-4xl font-black" style={{ color: postcardDesign.accentColor }}>
                            {postcardDesign.phone || '555.555.5555'}
                          </p>
                          {generatedCopy.copy.cta && (
                            <p className="text-xs text-yellow-400 mt-2 font-bold uppercase">{generatedCopy.copy.cta}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Print Info Footer */}
                    <div className="bg-gray-100 p-3 text-center text-xs text-gray-600 border-t-4 border-gray-300">
                      📐 Standard 6x9" Postcard Layout • Print-Ready Design • EDDM Compatible
                    </div>
                  </div>
                  </div>
                )}

              </div>

              {generatedCopy.copy.cta && formData.type !== 'postcard' && (
                <div>
                  <Label className="font-semibold">Call-to-Action:</Label>
                  <div className="mt-1 p-3 bg-green-50 border border-green-200 rounded">
                    <p className="font-medium text-green-800">{generatedCopy.copy.cta}</p>
                  </div>
                </div>
              )}

              {generatedCopy.copy.tips && generatedCopy.copy.tips.length > 0 && (
                <div>
                  <Label className="font-semibold">Marcus's Pro Tips:</Label>
                  <ul className="mt-2 space-y-2">
                    {generatedCopy.copy.tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-pink-600 font-bold">•</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2 pt-4 border-t">
                <Button onClick={handleSaveDraft} variant="outline" className="border-gray-300">
                  <Save className="w-4 h-4 mr-2" />
                  Save Draft
                </Button>
                <Button onClick={handleSaveAsTemplate} className="bg-blue-600 hover:bg-blue-700">
                  <FileText className="w-4 h-4 mr-2" />
                  Save Template
                </Button>
                <Button onClick={handleCopyToClipboard} variant="outline">
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </Button>
                {generatedCopy.isBulk ? (
                  <Button 
                    className="flex-1 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
                    onClick={async () => {
                      const confirmSend = confirm(
                        `Ready to send this ${formData.type} to ${generatedCopy.recipients.length} contacts?\n\n` +
                        `Each message will be personalized with their name and details.\n\n` +
                        `Click OK to proceed.`
                      );
                      if (!confirmSend) return;

                      const templateBody = editingCopy || generatedCopy.copy.copy;
                      let successCount = 0;
                      let failCount = 0;

                      for (const recipient of generatedCopy.recipients) {
                        try {
                          let personalizedMessage = templateBody;
                          personalizedMessage = personalizedMessage.replace(/\{name\}/g, recipient.name || 'Valued Customer');
                          personalizedMessage = personalizedMessage.replace(/\{address\}/g, recipient.address || '');

                          if (formData.type === 'email') {
                            const personalizedSubject = (generatedCopy.copy.subject || 'Message from ' + myCompany?.company_name || '')
                              .replace(/\{name\}/g, recipient.name || 'Valued Customer')
                              .replace(/\{address\}/g, recipient.address || '');

                            await base44.functions.invoke('sendEmailWithResend', {
                              to: recipient.email,
                              subject: personalizedSubject,
                              body: personalizedMessage,
                              fromName: myCompany?.company_name || 'Marketing'
                            });
                          } else if (formData.type === 'sms') {
                            await base44.functions.invoke('sendSMS', {
                              to: recipient.phone,
                              message: personalizedMessage,
                              contactName: recipient.name,
                              companyId: myCompany?.id
                            });
                          }
                          successCount++;
                        } catch (error) {
                          console.error(`Failed to send to ${recipient.name}:`, error);
                          failCount++;
                        }
                      }

                      alert(`✅ Campaign sent!\n\nSuccess: ${successCount}\nFailed: ${failCount}`);
                      if (successCount > 0) {
                        setShowPreview(false);
                        setGeneratedCopy(null);
                        setEditingCopy(null);
                      }
                    }}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send to {generatedCopy.recipients.length} Contacts
                  </Button>
                ) : (
                  <Button 
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    onClick={async () => {
                      const recipient = generatedCopy.recipients[0];
                      const message = editingCopy || generatedCopy.copy.copy;

                      try {
                        if (formData.type === 'email') {
                          await base44.functions.invoke('sendEmailWithResend', {
                            to: recipient.email,
                            subject: generatedCopy.copy.subject || 'Message from ' + (myCompany?.company_name || 'us'),
                            body: message,
                            fromName: myCompany?.company_name || 'Marketing'
                          });
                          alert('✅ Email sent successfully!');
                        } else if (formData.type === 'sms') {
                          await base44.functions.invoke('sendSMS', {
                            to: recipient.phone,
                            message: message,
                            contactName: recipient.name,
                            companyId: myCompany?.id
                          });
                          alert('✅ SMS sent successfully!');
                        } else {
                          alert('For postcards and letters, use "Copy" to export the content for printing.');
                          return;
                        }
                        setShowPreview(false);
                        setGeneratedCopy(null);
                        setEditingCopy(null);
                      } catch (error) {
                        alert('❌ Failed to send: ' + error.message);
                      }
                    }}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send Now
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Chat with Marcus Dialog */}
      <Dialog open={showChat} onOpenChange={setShowChat}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-6 pb-2 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-pink-100 border border-pink-200 flex-shrink-0">
                {marcusSettings?.avatar_url ? (
                  <img src={marcusSettings.avatar_url} alt="Marcus" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <MessageSquare className="w-4 h-4 text-pink-600" />
                  </div>
                )}
              </div>
              Chat with Marcus - Marketing Strategy & Execution
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 px-6 py-2">
            <ScrollArea className="h-full border rounded-lg bg-gray-50">
              <div className="p-4">
                {chatMessages.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-pink-100 flex items-center justify-center">
                      {marcusSettings?.avatar_url ? (
                        <img src={marcusSettings.avatar_url} alt="Marcus" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        <Mail className="w-6 h-6 text-pink-400" />
                      )}
                    </div>
                    <p className="font-semibold mb-2">Start a conversation with Marcus</p>
                    <p className="text-sm">Try: "I want to send a Happy New Year message to all customers with our referral program details"</p>
                  </div>
                ) : (
                <div className="space-y-4">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-lg p-4 ${
                        msg.role === 'user' 
                          ? 'bg-pink-600 text-white' 
                          : 'bg-white border border-gray-200'
                      }`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        
                        {msg.files && msg.files.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {msg.files.map((file, i) => (
                              <div key={i} className="text-xs opacity-80">
                                📎 {file.name}
                              </div>
                            ))}
                          </div>
                        )}

                        {msg.campaignAction && (
                          <div className="mt-3 pt-3 border-t border-gray-300">
                            <Button
                              size="sm"
                              onClick={() => handleExecuteCampaign(msg.campaignAction)}
                              className="bg-green-600 hover:bg-green-700 text-white w-full"
                            >
                              <Send className="w-3 h-3 mr-2" />
                              Execute This Campaign
                            </Button>
                          </div>
                        )}

                        {msg.videoAction && (
                          <div className="mt-3 pt-3 border-t border-gray-300">
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedSocialTemplate({
                                  platform: msg.videoAction.platform || 'facebook',
                                  videoScript: msg.videoAction.script
                                });
                                setActiveTab('social');
                                setShowChat(false);
                              }}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white w-full"
                            >
                              <Video className="w-3 h-3 mr-2" />
                              Open Video Builder with Script
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white border rounded-lg p-4">
                        <Loader2 className="w-5 h-5 animate-spin text-pink-600" />
                      </div>
                    </div>
                  )}
                  
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>
          </ScrollArea>
          </div>

          <div className="space-y-2 p-6 pt-2 shrink-0 bg-white">
            {uploadedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {uploadedFiles.map((file, idx) => (
                  <Badge key={idx} variant="outline" className="gap-2">
                    📎 {file.name}
                    <button
                      onClick={() => setUploadedFiles(uploadedFiles.filter((_, i) => i !== idx))}
                      className="ml-1 text-red-600 hover:text-red-800"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="file"
                id="chat-file-upload"
                className="hidden"
                onChange={handleFileUpload}
              />
              <label htmlFor="chat-file-upload">
                <Button variant="outline" size="icon" asChild>
                  <span className="cursor-pointer">
                    <Upload className="w-4 h-4" />
                  </span>
                </Button>
              </label>

              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleChatSubmit()}
                placeholder="Tell Marcus about your marketing idea..."
                className="flex-1"
              />
              
              <Button 
                onClick={handleChatSubmit}
                disabled={chatLoading || (!chatInput.trim() && uploadedFiles.length === 0)}
                className="bg-pink-600 hover:bg-pink-700"
              >
                {chatLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>

            <p className="text-xs text-gray-500 text-center">
              💡 Marcus can help plan campaigns and execute them directly (send emails/SMS)
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}