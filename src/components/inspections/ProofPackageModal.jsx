import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { base44 } from '@/api/base44Client';
import {
  Package, Download, Link as LinkIcon, Upload, CheckCircle, Loader2,
  Copy, ExternalLink, FileText, Image as ImageIcon, Building2, AlertTriangle, X, Mail, Send
} from 'lucide-react';

export default function ProofPackageModal({ open, onClose, job, media, company, techEvidenceMedia = [], inspectionType = 'insurance' }) {
  const isRetail = inspectionType === 'retail';
  const fileInputRef = useRef(null);

  const [tab, setTab] = useState('link');
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [includeBranding, setIncludeBranding] = useState(true);
  const [includeXactimate, setIncludeXactimate] = useState(false);
  const [xactimatePdf, setXactimatePdf] = useState(null);
  const [xactimateName, setXactimateName] = useState('');
  const [uploadStatus, setUploadStatus] = useState('idle'); // idle | uploading | done | error
  const [uploadError, setUploadError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Email adjuster state
  const [adjusterEmail, setAdjusterEmail] = useState('');
  const [adjusterName, setAdjusterName] = useState('');
  const [adjusterNote, setAdjusterNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null); // { pdfAttached, portalUrl, warning }
  const [sendError, setSendError] = useState('');

  const photos = (media || []).filter(m => m.file_type === 'photo');
  const photoCount = photos.length;
  const analyzedCount = photos.filter(p => p.ai_analysis).length;

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setUploadStatus('error');
      setUploadError('Please select a PDF file.');
      return;
    }
    setUploadStatus('uploading');
    setUploadError('');
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setXactimatePdf(file_url);
      setXactimateName(file.name);
      setIncludeXactimate(true);
      setUploadStatus('done');
    } catch (err) {
      setUploadStatus('error');
      setUploadError(err.message || 'Upload failed. Please try again.');
    }
  };

  const clearUpload = (e) => {
    e.stopPropagation();
    setXactimatePdf(null);
    setXactimateName('');
    setIncludeXactimate(false);
    setUploadStatus('idle');
    setUploadError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGenerateLink = async () => {
    if (!job) return;
    setGenerating(true);
    setGenError('');
    try {
      const result = await base44.functions.invoke('createProofPackage', {
        inspection_job_id: job.id,
        company_id: job.company_id,
        xactimate_pdf_url: includeXactimate ? xactimatePdf : null,
        include_annotations: includeAnnotations,
        include_branding: includeBranding,
        include_xactimate: includeXactimate,
        property_address: job.property_address,
        client_name: job.client_name || job.customer_name,
      });
      const pkg = result?.data || result;
      if (pkg?.portal_url) {
        setShareUrl(pkg.portal_url);
      } else {
        setGenError('Could not generate link. Please try again.');
      }
    } catch (err) {
      setGenError(err.message || 'Failed to create package.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendToAdjuster = async () => {
    if (!job || !adjusterEmail) return;
    setSending(true);
    setSendError('');
    setSendResult(null);
    try {
      const result = await base44.functions.invoke('sendProofPackageEmail', {
        adjuster_email: adjusterEmail.trim(),
        adjuster_name: adjusterName.trim() || undefined,
        note: adjusterNote.trim() || undefined,
        inspection_job_id: job.id,
        company_id: job.company_id,
        include_annotations: includeAnnotations,
        include_branding: includeBranding,
        xactimate_pdf_url: includeXactimate ? xactimatePdf : null,
        property_address: job.property_address,
        client_name: job.client_name || job.customer_name,
      });
      const r = result?.data || result;
      if (r?.success === false || r?.error) {
        setSendError(r.message || r.error || 'Failed to send email. Please try again.');
      } else {
        setSendResult({
          pdfAttached: r?.pdf_attached ?? false,
          portalUrl: r?.portal_url || shareUrl || '',
          warning: r?.pdf_warning || null,
        });
        // Cache the portal URL if the server generated one.
        if (r?.portal_url && !shareUrl) setShareUrl(r.portal_url);
      }
    } catch (err) {
      setSendError(err.message || 'Failed to send email. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!job) return;
    setGenerating(true);
    setGenError('');
    try {
      const result = await base44.functions.invoke('generateProofPackagePDF', {
        inspection_job_id: job.id,
        company_id: job.company_id,
        xactimate_pdf_url: includeXactimate ? xactimatePdf : null,
        include_annotations: includeAnnotations,
        include_branding: includeBranding,
        media: photos.slice(0, 60),
        tech_evidence_media: techEvidenceMedia,
        property_address: job.property_address,
        client_name: job.client_name || job.customer_name,
        inspection_type: inspectionType,
      });
      const pdfResult = result?.data || result;
      if (pdfResult?.base64) {
        const byteChars = atob(pdfResult.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proof-package-${(job.property_address || 'report').split(',')[0].replace(/\s+/g, '-')}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        setGenError('PDF generation failed. Please try again.');
      }
    } catch (err) {
      setGenError(err.message || 'PDF generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Package className={`w-5 h-5 ${isRetail ? 'text-emerald-600' : 'text-blue-600'}`} />
            {isRetail ? 'Retail Proposal Package' : 'Damage Evidence Report'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-700">{photoCount}</div>
              <div className="text-xs text-blue-600 mt-0.5">Photos</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-700">{analyzedCount}</div>
              <div className="text-xs text-green-600 mt-0.5">AI Analyzed</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-purple-700 text-sm leading-tight mt-1">{job?.damage_type || '—'}</div>
              <div className="text-xs text-purple-600 mt-0.5">Damage Type</div>
            </div>
          </div>

          {/* Options */}
          <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Package Contents</p>

            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm cursor-pointer" htmlFor="toggle-annotations">
                <ImageIcon className="w-4 h-4 text-blue-500" />
                AI Photo Annotations
              </Label>
              <Switch
                id="toggle-annotations"
                checked={includeAnnotations}
                onCheckedChange={setIncludeAnnotations}
                data-testid="switch-include-annotations"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm cursor-pointer" htmlFor="toggle-branding">
                <Building2 className="w-4 h-4 text-gray-500" />
                Company Branding & Logo
              </Label>
              <Switch
                id="toggle-branding"
                checked={includeBranding}
                onCheckedChange={setIncludeBranding}
                data-testid="switch-include-branding"
              />
            </div>

            {/* PDF Upload */}
            <div className="pt-1">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileSelect}
              />

              {uploadStatus === 'done' ? (
                <div className="flex items-center gap-3 bg-green-50 border border-green-300 rounded-lg p-3">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 truncate">{xactimateName}</p>
                    <p className="text-xs text-green-600">Estimate uploaded — will be included in package</p>
                  </div>
                  <button onClick={clearUpload} className="text-green-500 hover:text-red-500 transition-colors flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : uploadStatus === 'uploading' ? (
                <div className="flex items-center justify-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span className="text-sm text-blue-700">Uploading estimate...</span>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-300 rounded-lg p-3 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors"
                  data-testid="upload-xactimate-area"
                >
                  <div className="flex items-center justify-center gap-2 text-gray-500">
                    <Upload className="w-4 h-4" />
                    <span className="text-sm">
                      {uploadStatus === 'error' ? (
                        <span className="text-red-600">{uploadError}</span>
                      ) : (
                        'Attach Xactimate / Symbility PDF (optional)'
                      )}
                    </span>
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* Delivery tabs */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="link" className="flex-1 gap-1 text-xs" data-testid="tab-share-link">
                <LinkIcon className="w-3.5 h-3.5" />
                Web Link
              </TabsTrigger>
              <TabsTrigger value="pdf" className="flex-1 gap-1 text-xs" data-testid="tab-download-pdf">
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </TabsTrigger>
              {!isRetail && (
                <TabsTrigger value="email" className="flex-1 gap-1 text-xs" data-testid="tab-email-adjuster">
                  <Mail className="w-3.5 h-3.5" />
                  Email Adjuster
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="link" className="space-y-3 pt-2">
              <p className="text-sm text-gray-600">
                {isRetail
                  ? 'Generates a private link the homeowner can open to view all inspection photos and your proposal.'
                  : 'Generates a private link the adjuster can open in any browser to view all photos, AI analysis, and download the full report.'}
              </p>

              {shareUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <span className="text-sm font-mono text-green-800 flex-1 truncate">{shareUrl}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 gap-2"
                      onClick={handleCopyLink}
                      variant="outline"
                      data-testid="button-copy-link"
                    >
                      {copied ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copied!' : 'Copy Link'}
                    </Button>
                    <Button
                      className="gap-2"
                      variant="outline"
                      onClick={() => window.open(shareUrl, '_blank')}
                      data-testid="button-open-portal"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Preview
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {photoCount === 0 && (
                    <div className="flex items-center gap-2 text-amber-700 text-sm bg-amber-50 rounded-lg p-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      Add photos to the inspection before generating a package.
                    </div>
                  )}
                  <Button
                    className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={handleGenerateLink}
                    disabled={generating || photoCount === 0}
                    data-testid="button-generate-link"
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
                    {generating ? 'Generating...' : isRetail ? 'Generate Customer Portal Link' : 'Generate Adjuster Portal Link'}
                  </Button>
                </>
              )}
            </TabsContent>

            <TabsContent value="pdf" className="space-y-3 pt-2">
              <p className="text-sm text-gray-600">
                {isRetail
                  ? `Downloads a clean, customer-friendly PDF proposal with all inspection photos${uploadStatus === 'done' ? ', your uploaded estimate,' : ''} and your company branding.`
                  : `Downloads the complete Damage Evidence Report with all photos, AI analysis, inspector findings, and scope of work${uploadStatus === 'done' ? ', plus your uploaded estimate' : ''}.`}
              </p>
              {photoCount === 0 && (
                <div className="flex items-center gap-2 text-amber-700 text-sm bg-amber-50 rounded-lg p-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Add photos to the inspection before generating a package.
                </div>
              )}
              <Button
                className="w-full gap-2 bg-gray-800 hover:bg-gray-900 text-white"
                onClick={handleDownloadPdf}
                disabled={generating || photoCount === 0}
                data-testid="button-download-pdf-package"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {generating ? 'Building PDF...' : isRetail ? 'Download Retail Proposal PDF' : 'Download Damage Evidence Report'}
              </Button>
            </TabsContent>

            {!isRetail && (
              <TabsContent value="email" className="space-y-3 pt-2">
                <p className="text-sm text-gray-600">
                  Sends the Claims Defense PDF directly to the adjuster's inbox — no portal login needed. A web portal link is also included in the email as a fallback.
                </p>

                {sendResult ? (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-green-800">
                          Email sent to {adjusterEmail}
                        </p>
                        <p className="text-xs text-green-700 mt-0.5">
                          {sendResult.pdfAttached
                            ? 'Claims Defense PDF attached.'
                            : 'Portal link included (PDF not attached).'}
                        </p>
                      </div>
                    </div>
                    {sendResult.warning && (
                      <div className="flex items-start gap-2 text-amber-700 text-xs bg-amber-50 rounded-lg p-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        {sendResult.warning}
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => { setSendResult(null); setSendError(''); setAdjusterEmail(''); setAdjusterName(''); setAdjusterNote(''); }}
                    >
                      Send to Another Adjuster
                    </Button>
                  </div>
                ) : (
                  <>
                    {photoCount === 0 && (
                      <div className="flex items-center gap-2 text-amber-700 text-sm bg-amber-50 rounded-lg p-2">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        Add photos to the inspection before sending.
                      </div>
                    )}
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs font-medium text-gray-700 block mb-1">
                          Adjuster Email <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          value={adjusterEmail}
                          onChange={e => setAdjusterEmail(e.target.value)}
                          placeholder="adjuster@insuranceco.com"
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          data-testid="input-adjuster-email"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700 block mb-1">
                          Adjuster Name <span className="text-gray-400">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={adjusterName}
                          onChange={e => setAdjusterName(e.target.value)}
                          placeholder="e.g. John Smith"
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          data-testid="input-adjuster-name"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700 block mb-1">
                          Note to Adjuster <span className="text-gray-400">(optional)</span>
                        </label>
                        <textarea
                          value={adjusterNote}
                          onChange={e => setAdjusterNote(e.target.value)}
                          placeholder="Add any additional context for the adjuster…"
                          rows={2}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                          data-testid="input-adjuster-note"
                        />
                      </div>
                    </div>
                    {sendError && (
                      <div className="flex items-center gap-2 text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        {sendError}
                      </div>
                    )}
                    <Button
                      className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={handleSendToAdjuster}
                      disabled={sending || !adjusterEmail.trim() || photoCount === 0}
                      data-testid="button-send-to-adjuster"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {sending ? 'Generating PDF & Sending…' : 'Send to Adjuster'}
                    </Button>
                    <p className="text-xs text-gray-500 text-center">
                      The PDF will be generated and attached automatically.
                    </p>
                  </>
                )}
              </TabsContent>
            )}
          </Tabs>

          {/* Error display */}
          {genError && (
            <div className="flex items-center gap-2 text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {genError}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
