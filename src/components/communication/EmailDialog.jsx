import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Mail, Send, Loader2, FileText, CheckCircle2, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function EmailDialog({ open, onOpenChange, defaultTo, defaultName }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [sending, setSending] = useState(false);
  const [submission, setSubmission] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [formData, setFormData] = useState({
    contactName: '',
    to: '',
    cc: '',
    subject: '',
    message: ''
  });

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  // Fetch Staff Profile to support team members
  const { data: staffProfile } = useQuery({
    queryKey: ['staff-profile-email-dialog', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }).then(res => res[0]) : null,
    enabled: !!user
  });

  useEffect(() => {
    if (!user) return;

    const fetchCompany = async () => {
      try {
        // 1. Try to find company owned by user
        const ownedCompanies = await base44.entities.Company.filter({ created_by: user.email });
        if (ownedCompanies.length > 0) {
          setCompany(ownedCompanies[0]);
          return;
        }

        // 2. If not owner, check staff profile
        if (staffProfile?.company_id) {
          const staffCompany = await base44.entities.Company.get(staffProfile.company_id);
          if (staffCompany) {
            setCompany(staffCompany);
          }
        }
      } catch (err) {
        console.error('Error fetching company:', err);
      }
    };

    fetchCompany();
  }, [user, staffProfile]);

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['email-templates', company?.id],
    queryFn: () => base44.entities.EmailTemplate.filter({ 
      is_active: true, 
      company_id: { $in: [company?.id, '695944e3c1fb00b7ab716c6f'] } 
    }),
    enabled: !!company,
  });

  // Set default values when dialog opens
  useEffect(() => {
    if (open) {
      setFormData(prev => ({
        ...prev,
        to: defaultTo || '',
        contactName: defaultName || '',
        cc: ''
      }));
      setSelectedTemplate('');
      setSubmission(null);
    }
  }, [open, defaultTo, defaultName]);

  const handleTemplateSelect = (templateId) => {
    setSelectedTemplate(templateId);
    
    if (!templateId || templateId === 'none') { // Modified to check for 'none' as well
      setFormData(prev => ({ ...prev, subject: '', message: '' }));
      return;
    }
    
    const template = emailTemplates.find(t => t.id === templateId);
    if (template) {
      let subjectText = template.subject;
      let bodyText = template.body;
      
      // Use CURRENT contactName from formData (set from defaultName)
      const customerName = formData.contactName || 'Customer';
      
      // Replace ALL name variations
      subjectText = subjectText.replace(/\{customer_name\}/g, customerName);
      subjectText = subjectText.replace(/\{contact_name\}/g, customerName);
      subjectText = subjectText.replace(/\{lead_name\}/g, customerName);
      subjectText = subjectText.replace(/\{name\}/g, customerName);
      
      bodyText = bodyText.replace(/\{customer_name\}/g, customerName);
      bodyText = bodyText.replace(/\{contact_name\}/g, customerName);
      bodyText = bodyText.replace(/\{lead_name\}/g, customerName);
      bodyText = bodyText.replace(/\{name\}/g, customerName);
      
      const companyName = company?.company_name || 'Our Company';
      subjectText = subjectText.replace(/\{company_name\}/g, companyName);
      bodyText = bodyText.replace(/\{company_name\}/g, companyName);
      
      setFormData(prev => ({
        ...prev,
        subject: subjectText,
        message: bodyText
      }));
    }
  };

  const handleSendEmail = async () => {
    if (!formData.to || !formData.subject || !formData.message) {
      alert('Please fill in all required fields');
      return;
    }

    setSending(true);
    setSubmission(null);

    try {
      console.log('📧 Sending email...');
      
      const ccList = formData.cc
        ? formData.cc.split(',').map(e => e.trim()).filter(Boolean)
        : [];

      const result = await base44.integrations.Core.SendEmail({
        to: formData.to,
        ...(ccList.length > 0 && { cc: ccList }),
        subject: formData.subject,
        body: formData.message,
        contactName: formData.contactName,
        manualSend: true,
      });

      if (!result?.success || !result?.id) {
        throw new Error('Email was not accepted by the delivery provider');
      }

      console.log('Email submitted to provider:', result);

      // A provider receipt proves the send request reached Postmark/SES/Resend;
      // it does not prove the recipient's mailbox accepted or displayed it.
      // Do not use success language here — bounces and spam filtering happen
      // after this point. Hand the user the record instead of a claim, so the
      // real outcome (delivered / bounced) is one click away when it arrives.
      setSubmission({
        to: formData.to,
        subject: formData.subject,
        communicationId: result.communicationId || null,
        provider: result.provider || null,
      });

      setFormData({
        contactName: '',
        to: '',
        cc: '',
        subject: '',
        message: ''
      });
      setSelectedTemplate('');
    } catch (error) {
      console.error('❌ Error sending email:', error);
      alert('❌ Failed to send email: ' + error.message);
    } finally {
      setSending(false);
    }
  };

  const viewDeliveryStatus = () => {
    const base = createPageUrl('Communication');
    navigate(submission?.communicationId ? `${base}?comm=${encodeURIComponent(submission.communicationId)}` : base);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Send Email
          </DialogTitle>
        </DialogHeader>

        {submission ? (
          <div className="space-y-4" data-testid="panel-email-submitted">
            <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
              <div className="text-sm">
                <p className="font-semibold">Email submitted successfully{submission.provider ? ` via ${submission.provider}` : ''}.</p>
                <p className="mt-1">To: {submission.to}</p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setSubmission(null);
                  onOpenChange(false);
                }}
              >
                Close
              </Button>
              <Button
                onClick={viewDeliveryStatus}
                className="bg-blue-600 hover:bg-blue-700"
                data-testid="button-view-delivery-status"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View delivery status
              </Button>
            </div>
          </div>
        ) : (
        <>
        <Alert className="bg-blue-50 border-blue-200">
          <AlertDescription className="text-sm text-blue-800">
            Emails are submitted through CompanySync&apos;s delivery provider. A provider receipt is not confirmation that the recipient&apos;s inbox received the message.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div>
            <Label>Contact Name (Optional)</Label>
            <Input
              placeholder="John Doe"
              value={formData.contactName}
              onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
            />
          </div>

          <div>
            <Label>To *</Label>
            <Input
              type="email"
              placeholder="customer@example.com"
              value={formData.to}
              onChange={(e) => setFormData({ ...formData, to: e.target.value })}
              required
              data-testid="input-email-to"
            />
          </div>

          <div>
            <Label>CC <span className="text-gray-400 font-normal">(Optional — separate multiple with commas)</span></Label>
            <Input
              type="text"
              placeholder="manager@example.com, admin@example.com"
              value={formData.cc}
              onChange={(e) => setFormData({ ...formData, cc: e.target.value })}
              data-testid="input-email-cc"
            />
          </div>

          {emailTemplates.length > 0 && (
            <div>
              <Label htmlFor="email-template">Use Template (Optional)</Label>
              <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                <SelectTrigger id="email-template">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Write Custom Email)</SelectItem>
                  {emailTemplates.map(template => (
                    <SelectItem key={template.id} value={template.id}>
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {template.template_name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate && selectedTemplate !== 'none' && ( // Modified to check for 'none'
                <p className="text-xs text-green-600 mt-1">
                  ✓ Template loaded - you can edit it before sending
                </p>
              )}
            </div>
          )}

          <div>
            <Label>Subject *</Label>
            <Input
              placeholder="Regarding your roofing estimate..."
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              required
            />
          </div>

          <div>
            <Label>Message *</Label>
            <Textarea
              placeholder="Hi [Name],

I hope this email finds you well. I wanted to follow up regarding..."
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              rows={10}
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setFormData({
                  contactName: '',
                  to: '',
                  cc: '',
                  subject: '',
                  message: ''
                });
                setSelectedTemplate('');
                onOpenChange(false);
              }}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendEmail}
              disabled={!formData.to || !formData.subject || !formData.message || sending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Email
                </>
              )}
            </Button>
          </div>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}