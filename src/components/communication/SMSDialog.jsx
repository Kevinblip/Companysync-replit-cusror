import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send, X, Loader2, Paperclip, File as FileIcon, FileText } from "lucide-react";
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SMSDialog({ open, onOpenChange, defaultTo, defaultName, defaultFrom, companyId: propCompanyId }) {
  const [user, setUser] = useState(null);
  const [to, setTo] = useState('');
  const [contactName, setContactName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const fileInputRef = useRef(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const [repTwilioNumber, setRepTwilioNumber] = useState('');

  const { data: twilioConfig, isLoading: isLoadingTwilioConfig } = useQuery({
    queryKey: ['twilio-settings', user?.email, propCompanyId],
    queryFn: async () => {
      if (!user) return null;
      let companyId = propCompanyId;
      let repNumber = '';

      // Always fetch the staff profile to get the rep's personal Twilio number,
      // regardless of whether companyId was already supplied via props.
      const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
      if (staffProfiles && staffProfiles.length > 0) {
        repNumber = staffProfiles[0].twilio_number || '';
        if (!companyId) {
          companyId = staffProfiles[0].company_id;
        }
      }

      if (!companyId) {
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        if (companies && companies.length > 0) {
          companyId = companies[0].id;
        }
      }

      if (!companyId) {
        console.error("Could not determine company for user:", user?.email || 'unknown');
        return null;
      }

      if (repNumber) setRepTwilioNumber(repNumber);
      
      const settings = await base44.entities.TwilioSettings.filter({ company_id: companyId });
      return settings[0] || null;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000,
  });

  const { data: myCompany } = useQuery({
    queryKey: ['company', user?.email, propCompanyId],
    queryFn: async () => {
      if (propCompanyId) {
        const companies = await base44.entities.Company.filter({ id: propCompanyId });
        return companies[0] || null;
      }
      if (!user) return null;
      const companies = await base44.entities.Company.list("-created_date", 1);
      return companies.find(c => c.created_by === user.email) || companies[0];
    },
    enabled: !!user,
  });

  const { data: smsTemplates = [] } = useQuery({
    queryKey: ['sms-templates', myCompany?.id],
    queryFn: () => base44.entities.SMSTemplate.filter({ 
      is_active: true, 
      company_id: { $in: [myCompany?.id, '695944e3c1fb00b7ab716c6f'] } 
    }),
    enabled: !!myCompany,
    initialData: [],
  });

  // Properly set default values when dialog opens
  useEffect(() => {
    if (open) {
      setTo(defaultTo || '');
      setContactName(defaultName || '');
      setError(null);
      setAttachments([]);
      setSelectedTemplate('');
    }
  }, [open, defaultTo, defaultName]);

  // Use current contactName state when replacing merge fields
  const handleTemplateSelect = (templateId) => {
    setSelectedTemplate(templateId);
    
    if (templateId === 'none' || !templateId) { // Check for 'none' or empty string/null
      setMessage('');
      return;
    }
    
    const template = smsTemplates.find(t => t.id === templateId);
    if (template) {
      let messageText = template.message;
      
      // FIX: Use the CURRENT contactName from state (which was set from defaultName)
      const customerName = contactName || 'Customer';
      
      // Replace ALL name variations
      messageText = messageText.replace(/\{customer_name\}/g, customerName);
      messageText = messageText.replace(/\{contact_name\}/g, customerName);
      messageText = messageText.replace(/\{lead_name\}/g, customerName);
      messageText = messageText.replace(/\{name\}/g, customerName);
      
      // Replace company name
      const companyName = myCompany?.company_name || 'Our Company';
      messageText = messageText.replace(/\{company_name\}/g, companyName);
      
      setMessage(messageText);
    }
  };

  const sendSMSMutation = useMutation({
    mutationFn: async (data) => {
      const response = await base44.functions.invoke('sendSMS', data);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      
      if (data.success) {
        alert("✅ SMS sent successfully!\n\nCheck Twilio logs if it doesn't arrive: https://console.twilio.com/us1/monitor/logs/sms");
        setTo("");
        setContactName("");
        setMessage("");
        setAttachments([]);
        setSelectedTemplate('');
        setError(null);
        onOpenChange(false);
      } else {
        setError(data.message || data.error || "Failed to send SMS due to an unknown issue.");
      }
    },
    onError: (error) => {
      const errorMsg = error.response?.data?.error || error.message || "An unexpected error occurred.";
      setError(errorMsg);
    }
  });

  const handleSend = () => {
    if (!to || !message) {
      setError("Please fill in phone number and message.");
      return;
    }

    // ALLOW SYSTEM DEFAULT: Check if company config exists, otherwise assume system-wide env vars are set
    // if (!twilioConfig || !twilioConfig.company_id || !twilioConfig.account_sid || !twilioConfig.auth_token || !twilioConfig.main_phone_number) {
    //   setError("Twilio is not configured for your company. Please ensure your company has Twilio SID, Auth Token, and a valid Main Company Number.");
    //   return;
    // }

    setError(null);

    let formattedNumber = to.replace(/\D/g, '');
    
    if (formattedNumber.length === 10) {
      formattedNumber = '+1' + formattedNumber;
    } else if (formattedNumber.length === 11 && formattedNumber.startsWith('1')) {
      formattedNumber = '+' + formattedNumber;
    } else if (!formattedNumber.startsWith('+')) {
      formattedNumber = '+' + formattedNumber;
    }

    let finalMessage = message;
    if (attachments.length > 0) {
        finalMessage += '\n\n---\nFiles:\n';
        attachments.forEach(file => {
            finalMessage += `${file.name}: ${file.url}\n`;
        });
    }

    const fromNumber = defaultFrom || repTwilioNumber || '';
    sendSMSMutation.mutate({
      to: formattedNumber,
      message: finalMessage,
      body: finalMessage,
      contactName: contactName || 'Unknown',
      companyId: propCompanyId || twilioConfig?.company_id,
      senderEmail: user?.email,
      ...(fromNumber ? { from: fromNumber } : {}),
    });
  };

  const formatPhoneDisplay = (value) => {
    const cleaned = value.replace(/\D/g, '');
    
    if (cleaned.length === 0) return '';
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    if (cleaned.length <= 10) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    
    if (value.startsWith('+') && cleaned.length > 10) return `+${cleaned}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  };

  const handlePhoneChange = (e) => {
    const value = e.target.value;
    const cleaned = value.replace(/\D/g, '');
    setTo(cleaned);
  };

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setIsUploading(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setAttachments(prev => [...prev, { name: file.name, url: file_url }]);
      }
    } catch (error) {
      console.error("File upload error:", error);
      setError("Failed to upload file. Please try again.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setIsUploading(false);
    }
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const remainingChars = 160 - message.length;
  // const isSendDisabled = sendSMSMutation.isPending || isLoadingTwilioConfig || !twilioConfig?.main_phone_number || isUploading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 mr-1 text-purple-600" />
            Send Text Message
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pb-24 md:pb-4">
          <div>
            <Label htmlFor="sms-name">Contact Name</Label>
            <Input
              id="sms-name"
              placeholder="John Doe"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="sms-to">Phone Number *</Label>
            <Input
              id="sms-to"
              type="tel"
              placeholder="+1 (555) 123-4567"
              value={formatPhoneDisplay(to)}
              onChange={handlePhoneChange}
            />
            <p className="text-xs text-gray-500 mt-1">
              Automatically adds +1 for US numbers
            </p>
            {(defaultFrom || repTwilioNumber) && (
              <p className="text-xs text-blue-600 mt-1 font-medium">
                Sending from: {(() => {
                  const raw = (defaultFrom || repTwilioNumber || '').replace(/\D/g, '');
                  if (raw.length === 11 && raw.startsWith('1')) return `(${raw.slice(1,4)}) ${raw.slice(4,7)}-${raw.slice(7)}`;
                  if (raw.length === 10) return `(${raw.slice(0,3)}) ${raw.slice(3,6)}-${raw.slice(6)}`;
                  return defaultFrom || repTwilioNumber;
                })()}
              </p>
            )}
          </div>

          {smsTemplates.length > 0 && (
            <div>
              <Label htmlFor="sms-template">Use Template (Optional)</Label>
              <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                <SelectTrigger id="sms-template">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Write Custom Message)</SelectItem>
                  {smsTemplates.map(template => (
                    <SelectItem key={template.id} value={template.id}>
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {template.template_name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate && selectedTemplate !== 'none' && ( // Only show if a template is actually selected
                <p className="text-xs text-green-600 mt-1">
                  ✓ Template loaded - you can edit it before sending
                </p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="sms-message">Message *</Label>
            <Textarea
              id="sms-message"
              rows={6}
              placeholder="Type your message here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">
              {remainingChars > 0 ? `${remainingChars} characters remaining for first segment.` : `Message will be split into multiple segments.`}
            </p>
          </div>
          
          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4 mr-2" />
              )}
              {isUploading ? 'Uploading...' : 'Attach File(s)'}
            </Button>
             <p className="text-xs text-gray-500 mt-1">
              Attachments are sent as links and may increase message cost.
            </p>
          </div>

          {attachments.length > 0 && (
            <div className="space-y-2 p-3 bg-gray-50 rounded-lg border">
              <p className="text-sm font-medium">Attachments:</p>
              {attachments.map((file, index) => (
                <div key={index} className="flex items-center justify-between text-sm bg-white p-2 rounded border">
                  <div className="flex items-center gap-2">
                    <FileIcon className="w-4 h-4 text-gray-500" />
                    <span className="truncate max-w-xs">{file.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAttachment(index)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {isLoadingTwilioConfig && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800 flex items-center">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading Twilio configuration...
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">
                ❌ <strong>Error:</strong> {error}
              </p>
              {error.includes('verified') && (
                <a 
                  href="https://console.twilio.com/us1/develop/phone-numbers/manage/verified" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline mt-2 inline-block"
                >
                  → Verify phone numbers in Twilio Console
                </a>
              )}
            </div>
          )}

          {!error && !isLoadingTwilioConfig && (!twilioConfig || !twilioConfig.main_phone_number) && (
             <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
             <p className="text-sm text-blue-800">
               ℹ️ <strong>System Twilio:</strong> Using system-wide Twilio configuration since no company settings were found.
             </p>
           </div>
          )}

          {!error && !isLoadingTwilioConfig && twilioConfig?.main_phone_number && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-800">
                ✅ <strong>Real Twilio SMS</strong> - Messages will send from {twilioConfig.main_phone_number}.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setTo("");
                setContactName("");
                setMessage("");
                setAttachments([]);
                setSelectedTemplate('');
                setError(null);
                onOpenChange(false);
              }}
              disabled={sendSMSMutation.isPending}
              className="min-h-[48px]"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={sendSMSMutation.isPending || isUploading}
              className="bg-purple-600 hover:bg-purple-700 min-h-[48px]"
            >
              {sendSMSMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send SMS
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}