import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useSearchParams } from "react-router-dom";
import {
  FileText,
  Download,
  DollarSign,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  AlertCircle,
  MessageSquare,
  Phone,
  Image,
  ChevronRight,
  Send,
  User,
  Home,
  Camera,
  Upload,
  X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import InvoicePaymentOptions from "@/components/payments/InvoicePaymentOptions";
import { getInvoiceBalance, getInvoiceTrueTotal } from "@/utils/invoiceFinance";

// ── Milestone Stepper ─────────────────────────────────────────────────────────
function MilestoneStepper({ milestones, currentMilestone }) {
  const currentIdx = milestones.findIndex(m => m.key === currentMilestone);
  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="flex items-start min-w-max gap-0">
        {milestones.map((m, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          const future = idx > currentIdx;
          return (
            <div key={m.key} className="flex items-start">
              <div className="flex flex-col items-center" style={{ minWidth: 80, maxWidth: 100 }}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors
                  ${done ? 'bg-blue-600 border-blue-600 text-white' : active ? 'bg-white border-blue-600 text-blue-600' : 'bg-gray-100 border-gray-300 text-gray-400'}`}>
                  {done ? <CheckCircle2 className="w-5 h-5" /> : <span className="text-xs font-bold">{idx + 1}</span>}
                </div>
                <p className={`text-xs text-center mt-1 font-medium leading-tight px-1
                  ${done ? 'text-blue-600' : active ? 'text-blue-700 font-semibold' : 'text-gray-400'}`}>
                  {m.label}
                </p>
              </div>
              {idx < milestones.length - 1 && (
                <div className={`h-0.5 w-8 mt-4 mx-0 flex-shrink-0 ${done ? 'bg-blue-600' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Note Feed Entry ───────────────────────────────────────────────────────────
function LogEntry({ log }) {
  const isAlex = log.author_role === 'sarah';
  const isTeam = log.author_role === 'admin' || isAlex;
  return (
    <div className={`flex gap-3 ${isTeam ? '' : 'flex-row-reverse'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isAlex ? 'bg-purple-100' : isTeam ? 'bg-blue-100' : 'bg-green-100'}`}>
        {isAlex ? <span className="text-xs font-bold text-purple-600">A</span> : isTeam ? <User className="w-4 h-4 text-blue-600" /> : <Home className="w-4 h-4 text-green-600" />}
      </div>
      <div className={`flex-1 max-w-sm ${isTeam ? '' : 'text-right'}`}>
        <p className={`text-xs text-gray-500 mb-1 ${isTeam ? '' : 'text-right'}`}>
          {isAlex ? 'Alex (AI Update)' : isTeam ? 'Your Project Team' : 'You'} · {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
        </p>
        <div className={`rounded-2xl px-4 py-2.5 text-sm text-gray-800 ${isAlex ? 'bg-purple-50 border border-purple-100' : isTeam ? 'bg-blue-50 border border-blue-100' : 'bg-green-50 border border-green-100'}`}>
          {log.content_body}
        </div>
      </div>
    </div>
  );
}

export default function CustomerPortalPublic() {
  const [token, setToken] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSection, setActiveSection] = useState('project');
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [downloadingPDF, setDownloadingPDF] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoCaption, setPhotoCaption] = useState('');
  const photoInputRef = useRef(null);
  const [searchParams] = useSearchParams();
  const [isAdmin, setIsAdmin] = useState(false);
  const [reviewingPhoto, setReviewingPhoto] = useState(null);

  // Portal data — single source of truth from /api/public/portal
  const [portalData, setPortalData] = useState(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    // Accept ?token= (canonical) or legacy ?customer_id=
    const urlToken = searchParams.get('token') || searchParams.get('customer_id');
    if (!urlToken) {
      setError('Invalid portal link');
      setLoading(false);
      return;
    }
    setToken(urlToken);
    // Single authoritative call — token resolved server-side by portal_token field
    Promise.all([
      fetch(`/api/public/portal?token=${encodeURIComponent(urlToken)}`).then(r => r.json()),
      fetch(`/api/public/portal/admin-check?token=${encodeURIComponent(urlToken)}`).then(r => r.json()).catch(() => ({ isAdmin: false })),
    ]).then(([data, adminData]) => {
        if (data.success && data.customer) {
          setPortalData(data);
          setCustomer(data.customer);
        } else {
          setError('Invalid or expired portal link');
        }
        setIsAdmin(adminData.isAdmin === true);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load portal');
        setLoading(false);
      });
  }, [searchParams]);

  const { data: estimates = [] } = useQuery({
    queryKey: ['estimates', customer?.name],
    queryFn: () => base44.entities.Estimate.filter({ customer_name: customer?.name }),
    enabled: !!customer,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', customer?.name],
    queryFn: () => base44.entities.Invoice.filter({ customer_name: customer?.name }),
    enabled: !!customer,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', customer?.name],
    queryFn: () => base44.entities.Payment.filter({ customer_name: customer?.name }),
    enabled: !!customer,
  });

  const handlePayInvoice = async (invoice) => {
    setPayingInvoice(invoice.id);
    try {
      const response = await fetch('/api/public/portal/invoice-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, invoice_id: invoice.id }),
      });
      const data = await response.json();
      if (response.ok && data.success && data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        toast.error(data.error || 'Unable to start online payment');
        setPayingInvoice(null);
      }
    } catch (error) {
      toast.error('Payment failed: ' + error.message);
      setPayingInvoice(null);
    }
  };

  const handleDownloadPDF = async (invoice) => {
    setDownloadingPDF(invoice.id);
    try {
      const response = await base44.functions.invoke('generateInvoicePDF', { invoice, customer });
      if (response.data.success && response.data.pdf_url) {
        window.open(response.data.pdf_url, '_blank');
        toast.success('PDF generated successfully!');
      } else {
        toast.error('Failed to generate PDF');
      }
    } catch (error) {
      toast.error('PDF generation failed: ' + error.message);
    } finally {
      setDownloadingPDF(null);
    }
  };

  const handlePhotoFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast.error('Photo must be under 20 MB'); return; }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleClearPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoCaption('');
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const handleUploadPhoto = async (projectId) => {
    if (!photoFile || !photoPreview) return;
    setUploadingPhoto(true);
    try {
      const base64 = photoPreview.split(',')[1];
      const mimeType = photoFile.type || 'image/jpeg';
      const resp = await fetch('/api/public/portal/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, project_id: projectId, photo_base64: base64, mime_type: mimeType, caption: photoCaption.trim() }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('Photo uploaded — your project manager will review it shortly.');
        handleClearPhoto();
        await refreshPortalData();
      } else {
        toast.error(data.error || 'Failed to upload photo');
      }
    } catch {
      toast.error('Failed to upload photo. Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const refreshPortalData = async () => {
    if (!token) return;
    const refreshed = await fetch(`/api/public/portal?token=${encodeURIComponent(token)}`).then(r => r.json());
    if (refreshed.success) setPortalData(refreshed);
  };

  const handleApprovePhoto = async (projectId, photoId) => {
    setReviewingPhoto(photoId);
    try {
      const resp = await fetch(`/api/projects/${projectId}/photos/${photoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: true }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('Photo approved and published.');
        await refreshPortalData();
      } else {
        toast.error(data.error || 'Failed to approve photo');
      }
    } catch {
      toast.error('Failed to approve photo. Please try again.');
    } finally {
      setReviewingPhoto(null);
    }
  };

  const handleRejectPhoto = async (projectId, photoId) => {
    setReviewingPhoto(photoId);
    try {
      const resp = await fetch(`/api/projects/${projectId}/photos/${photoId}`, {
        method: 'DELETE',
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('Photo rejected and removed.');
        await refreshPortalData();
      } else {
        toast.error(data.error || 'Failed to reject photo');
      }
    } catch {
      toast.error('Failed to reject photo. Please try again.');
    } finally {
      setReviewingPhoto(null);
    }
  };

  const handleSubmitNote = async (projectId) => {
    if (!noteText.trim()) return;
    setSubmittingNote(true);
    try {
      const resp = await fetch('/api/public/portal/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, project_id: projectId, content_body: noteText.trim() }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('Message sent — your project manager will get back to you shortly.');
        setNoteText('');
        await refreshPortalData();
      } else {
        toast.error(data.error || 'Failed to send message');
      }
    } catch {
      toast.error('Failed to send message. Please try again.');
    } finally {
      setSubmittingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Card className="w-96">
          <CardContent className="p-8 text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-blue-600" />
            <p className="text-gray-600">Loading your portal...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Card className="w-96">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600 mb-4">{error || 'Invalid portal link'}</p>
            <p className="text-sm text-gray-500">Please contact us to get a new portal link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalOutstanding = invoices
    .filter(i => i.status !== 'cancelled')
    .reduce((sum, inv) => sum + getInvoiceBalance(inv), 0);
  const openEstimates = estimates.filter(e => e.status !== 'accepted' && e.status !== 'declined' && e.status !== 'expired');
  const portalProjects = portalData?.projects || [];
  const portalLogs = portalData?.logs || [];
  const portalPhotos = portalData?.photos || [];
  const pm = portalData?.pm;
  const claim = portalData?.claim || {};

  const NAV_TABS = [
    { key: 'project', label: 'My Project' },
    { key: 'claim', label: 'Claim Status' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'estimates', label: 'Estimates' },
    { key: 'payments', label: 'Payments' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 shadow-lg">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold">Welcome, {customer.name}!</h1>
          <p className="text-blue-100 mt-1 text-sm">Your project portal — track progress, ask questions, view documents</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 md:p-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="bg-white shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Balance Due</p>
              <p className="text-xl font-bold text-red-600">${totalOutstanding.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-white shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Open Estimates</p>
              <p className="text-xl font-bold text-blue-600">{openEstimates.length}</p>
            </CardContent>
          </Card>
          <Card className="bg-white shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Active Projects</p>
              <p className="text-xl font-bold text-green-600">{portalProjects.filter(p => p.status === 'in_progress').length}</p>
            </CardContent>
          </Card>
          <Card className="bg-white shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Completed</p>
              <p className="text-xl font-bold text-purple-600">{portalProjects.filter(p => p.status === 'completed').length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Nav tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {NAV_TABS.map(tab => (
            <Button
              key={tab.key}
              variant={activeSection === tab.key ? 'default' : 'outline'}
              onClick={() => setActiveSection(tab.key)}
              className={activeSection === tab.key ? 'bg-blue-600 hover:bg-blue-700' : ''}
              size="sm"
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {/* ── MY PROJECT TAB ──────────────────────────────────────────────── */}
        {activeSection === 'project' && (
          <div className="space-y-6">
            {portalLoading && (
              <Card className="bg-white shadow-md">
                <CardContent className="p-8 text-center">
                  <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-blue-500" />
                  <p className="text-gray-500 text-sm">Loading project details...</p>
                </CardContent>
              </Card>
            )}

            {!portalLoading && portalProjects.length === 0 && (
              <Card className="bg-white shadow-md">
                <CardContent className="p-10 text-center text-gray-500">
                  <Clock className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">No active projects yet</p>
                  <p className="text-sm mt-1">Your project details will appear here once work begins.</p>
                </CardContent>
              </Card>
            )}

            {portalProjects.map(project => {
              const projectLogs = portalLogs.filter(l => l.project_id === project.id);
              const projectPhotos = portalPhotos.filter(p => p.project_id === project.id);
              const milestones = project.milestones || [];
              const projectType = project.project_type === 'sedgwick_claim' ? 'Insurance Claim' : 'Standard Job';

              return (
                <div key={project.id} className="space-y-5">
                  {/* Project header */}
                  <Card className="bg-white shadow-md border-l-4 border-l-blue-500">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <h2 className="text-lg font-bold text-gray-900">{project.title || project.address || 'Your Roofing Project'}</h2>
                          {project.address && <p className="text-sm text-gray-500 mt-0.5">{project.address}</p>}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">{projectType}</Badge>
                          <Badge variant="outline" className={`text-xs ${project.status === 'completed' ? 'bg-green-50 text-green-700 border-green-200' : project.status === 'in_progress' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                            {project.status?.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Milestone stepper */}
                  {milestones.length > 0 && (
                    <Card className="bg-white shadow-md">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Project Progress</CardTitle>
                        {project.current_milestone && (
                          <p className="text-sm text-gray-500">
                            Current stage: <span className="font-semibold text-blue-700">{milestones.find(m => m.key === project.current_milestone)?.label || project.current_milestone}</span>
                          </p>
                        )}
                      </CardHeader>
                      <CardContent className="pt-2 pb-5">
                        {project.current_milestone ? (
                          <MilestoneStepper milestones={milestones} currentMilestone={project.current_milestone} />
                        ) : (
                          <p className="text-sm text-gray-400 italic">Progress tracking will begin once your project is activated.</p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Latest updates feed */}
                  {projectLogs.length > 0 && (
                    <Card className="bg-white shadow-md">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Latest Updates</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {projectLogs.slice(0, 5).map(log => <LogEntry key={log.id} log={log} />)}
                      </CardContent>
                    </Card>
                  )}

                  {/* Photo gallery — grouped by milestone */}
                  {(() => {
                    const publicPhotos = projectPhotos.filter(p => p.is_public);
                    const pendingPhotos = projectPhotos.filter(p => !p.is_public && p.uploaded_by && p.uploaded_by.startsWith('homeowner:'));
                    if (publicPhotos.length === 0 && pendingPhotos.length === 0) return null;
                    const ungrouped = publicPhotos.filter(p => !p.milestone);
                    const grouped = publicPhotos.filter(p => p.milestone).reduce((acc, photo) => {
                      const key = photo.milestone;
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(photo);
                      return acc;
                    }, {});
                    const renderGrid = (photos) => (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {photos.map(photo => (
                          <div key={photo.id} className="rounded-lg overflow-hidden border bg-gray-50">
                            <img
                              src={photo.photo_url}
                              alt={photo.caption || 'Project photo'}
                              className="w-full h-36 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => window.open(photo.photo_url, '_blank')}
                              onError={e => {
                                e.currentTarget.style.display = 'none';
                                if (e.currentTarget.nextElementSibling) e.currentTarget.nextElementSibling.hidden = false;
                              }}
                            />
                            <div hidden className="p-6 text-center text-sm text-gray-500">
                              Photo unavailable. Please contact your project team.
                            </div>
                            {photo.caption && (
                              <div className="p-2">
                                <p className="text-xs text-gray-700 break-words whitespace-pre-wrap">{photo.caption}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                    return (
                      <Card className="bg-white shadow-md">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Image className="w-4 h-4" /> Project Photos
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                          {Object.entries(grouped).map(([ms, photos]) => (
                            <div key={ms}>
                              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">
                                {ms.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                              </p>
                              {renderGrid(photos)}
                            </div>
                          ))}
                          {ungrouped.length > 0 && (
                            <div>
                              {Object.keys(grouped).length > 0 && <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Other</p>}
                              {renderGrid(ungrouped)}
                            </div>
                          )}
                          {pendingPhotos.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Waiting for review
                                {isAdmin && <span className="ml-1 text-xs font-normal text-yellow-600 normal-case tracking-normal">(Admin review required)</span>}
                              </p>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {pendingPhotos.map(photo => (
                                  <div key={photo.id} className="rounded-lg overflow-hidden border border-yellow-200 bg-yellow-50" data-testid={`pending-photo-${photo.id}`}>
                                    <div className="relative">
                                      <img
                                        src={photo.photo_url}
                                        alt={photo.caption || 'Your uploaded photo'}
                                        className="w-full h-36 object-cover grayscale opacity-60"
                                        onError={e => { e.target.style.display = 'none'; }}
                                      />
                                      <div className="absolute inset-0 flex items-end justify-center pb-2">
                                        <span className="text-xs bg-yellow-400 text-yellow-900 font-medium px-2 py-0.5 rounded-full shadow">Pending approval</span>
                                      </div>
                                    </div>
                                    {photo.caption && (
                                      <div className="px-2 pt-2">
                                        <p className="text-xs text-yellow-800 truncate">{photo.caption}</p>
                                      </div>
                                    )}
                                    {isAdmin && (
                                      <div className="flex gap-1.5 p-2">
                                        <Button
                                          size="sm"
                                          className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                                          disabled={reviewingPhoto === photo.id}
                                          onClick={() => handleApprovePhoto(project.id, photo.id)}
                                          data-testid={`button-approve-photo-${photo.id}`}
                                        >
                                          {reviewingPhoto === photo.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                                          Approve
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="flex-1 h-7 text-xs border-red-300 text-red-600 hover:bg-red-50"
                                          disabled={reviewingPhoto === photo.id}
                                          onClick={() => handleRejectPhoto(project.id, photo.id)}
                                          data-testid={`button-reject-photo-${photo.id}`}
                                        >
                                          {reviewingPhoto === photo.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3 mr-1" />}
                                          Reject
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* Note composer */}
                  <Card className="bg-white shadow-md border-l-4 border-l-green-400">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-green-600" /> Leave a note for your project manager
                      </CardTitle>
                      <p className="text-xs text-gray-400">Questions, concerns, or updates — we read every message.</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Textarea
                        placeholder="Type your message here..."
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        rows={3}
                        className="resize-none"
                        data-testid="input-homeowner-note"
                      />
                      <Button
                        onClick={() => handleSubmitNote(project.id)}
                        disabled={submittingNote || !noteText.trim()}
                        className="bg-green-600 hover:bg-green-700 text-white"
                        data-testid="button-submit-note"
                      >
                        {submittingNote ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                        Send Message
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Photo upload */}
                  <Card className="bg-white shadow-md border-l-4 border-l-blue-400">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Camera className="w-4 h-4 text-blue-600" /> Upload a photo
                      </CardTitle>
                      <p className="text-xs text-gray-400">Storm damage, a question about your roof, a pre-inspection shot — your PM will review it.</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {!photoPreview ? (
                        <label
                          className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-blue-200 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors"
                          data-testid="label-photo-upload"
                        >
                          <Upload className="w-6 h-6 text-blue-400 mb-1" />
                          <span className="text-xs text-blue-500 font-medium">Tap to choose a photo</span>
                          <span className="text-xs text-gray-400 mt-0.5">JPG, PNG, HEIC — up to 20 MB</span>
                          <input
                            ref={photoInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handlePhotoFileChange}
                            data-testid="input-photo-file"
                          />
                        </label>
                      ) : (
                        <div className="space-y-2">
                          <div className="relative rounded-lg overflow-hidden border bg-gray-50">
                            <img src={photoPreview} alt="Preview" className="w-full max-h-48 object-contain" data-testid="img-photo-preview" />
                            <button
                              onClick={handleClearPhoto}
                              className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
                              data-testid="button-clear-photo"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          <input
                            type="text"
                            placeholder="Add a caption (optional)"
                            value={photoCaption}
                            onChange={e => setPhotoCaption(e.target.value)}
                            className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            data-testid="input-photo-caption"
                          />
                          <Button
                            onClick={() => handleUploadPhoto(project.id)}
                            disabled={uploadingPhoto}
                            className="bg-blue-600 hover:bg-blue-700 text-white w-full"
                            data-testid="button-upload-photo"
                          >
                            {uploadingPhoto ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                            Send Photo
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* PM contact strip */}
                  {pm && (
                    <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100 shadow-sm">
                      <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                          {(pm.full_name || pm.email || '?')[0].toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-gray-900 text-sm">{pm.full_name || pm.email}</p>
                          <p className="text-xs text-gray-500">Your Project Manager</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {pm.cell_phone && (
                            <a href={`tel:${pm.cell_phone}`} className="flex items-center gap-1 text-blue-600 text-sm font-medium hover:underline" data-testid="link-call-pm">
                              <Phone className="w-4 h-4" /> {pm.cell_phone}
                            </a>
                          )}
                          {(pm.twilio_number || pm.cell_phone) && (
                            <a
                              href={`sms:${pm.twilio_number || pm.cell_phone}`}
                              className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
                              data-testid="link-text-sarah"
                            >
                              <MessageSquare className="w-3.5 h-3.5" /> Text Alex
                            </a>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── CLAIM STATUS TAB ──────────────────────────────────────────── */}
        {activeSection === 'claim' && (
          <div className="space-y-4">
            <Card className="bg-white shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your Insurance Claim</CardTitle>
                <p className="text-xs text-gray-400">This information is private — only you can see this page.</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Insurance Company</p>
                    <p className="font-medium text-gray-800">{claim.insurance_company || <span className="text-gray-400 italic text-sm">Not on file yet</span>}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Claim Number</p>
                    <p className="font-medium text-gray-800">{claim.claim_number || <span className="text-gray-400 italic text-sm">Not on file yet</span>}</p>
                  </div>
                  {claim.adjuster_name && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Your Adjuster</p>
                      <p className="font-medium text-gray-800">{claim.adjuster_name}</p>
                    </div>
                  )}
                  {claim.adjuster_phone && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Adjuster Phone</p>
                      <a href={`tel:${claim.adjuster_phone}`} className="font-medium text-blue-600 hover:underline">{claim.adjuster_phone}</a>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Contract Status</CardTitle>
              </CardHeader>
              <CardContent>
                {claim.contract_status === 'completed' ? (
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-green-700">Contract Fully Signed</p>
                      {claim.contract_signed_at && <p className="text-sm text-gray-500 mt-1">You signed on {format(new Date(claim.contract_signed_at), 'PPP')}</p>}
                      {claim.rep_signed_at && <p className="text-sm text-gray-500">Our team signed on {format(new Date(claim.rep_signed_at), 'PPP')}</p>}
                    </div>
                  </div>
                ) : (claim.contract_status === 'pending_customer' || claim.contract_status === 'sent') ? (
                  <div className="flex items-start gap-3">
                    <Clock className="w-6 h-6 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-yellow-700">Waiting for Your Signature</p>
                      <p className="text-sm text-gray-500 mt-1">Check your email or text for a signing link from us.</p>
                    </div>
                  </div>
                ) : claim.contract_status ? (
                  <div className="flex items-start gap-3">
                    <Clock className="w-6 h-6 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-gray-700">Contract In Progress</p>
                      <p className="text-sm text-gray-500 mt-1">Your contract is being prepared by your rep.</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <Clock className="w-6 h-6 text-gray-300 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-gray-500">No contract on file yet</p>
                      <p className="text-sm text-gray-400 mt-1">Your rep will send one when the time comes.</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-blue-50 border border-blue-100 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm font-semibold text-blue-800 mb-2">How your claim works</p>
                <ol className="text-sm text-blue-700 space-y-1.5 list-decimal list-inside">
                  <li>Contract signed — we file the claim with your insurance company</li>
                  <li>Insurance adjuster visits your property to inspect the damage</li>
                  <li>Insurance approves the work scope and issues the initial (ACV) check</li>
                  <li>We complete your project and request the depreciation release</li>
                  <li>Final payment received — project complete</li>
                </ol>
                <p className="text-xs text-blue-500 mt-3">
                  Have a question?{' '}
                  <button className="underline font-medium" onClick={() => setActiveSection('project')}>
                    Go to My Project
                  </button>{' '}
                  and leave a note for your project manager.
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── INVOICES TAB ──────────────────────────────────────────────── */}
        {activeSection === 'invoices' && (
          <Card className="bg-white shadow-lg">
            <CardHeader>
              <CardTitle>Invoices ({invoices.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {invoices.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p>No invoices yet</p>
                </div>
              ) : (
                invoices
                  .sort((a, b) => new Date(b.issue_date || b.created_date) - new Date(a.issue_date || a.created_date))
                  .map(invoice => {
                    const totalAmount = getInvoiceTrueTotal(invoice);
                    const amountDue = getInvoiceBalance(invoice);
                    return (
                      <Card key={invoice.id} className="border-2">
                        <CardContent className="p-3 sm:p-6">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <h3 className="text-lg font-semibold">Invoice #{invoice.invoice_number}</h3>
                              <Badge variant="outline" className={
                                invoice.status === 'paid' ? 'bg-green-100 text-green-700' :
                                invoice.status === 'overdue' ? 'bg-red-100 text-red-700' :
                                'bg-yellow-100 text-yellow-700'
                              }>
                                {invoice.status}
                              </Badge>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold">${totalAmount.toFixed(2)}</p>
                              {amountDue > 0 && <p className="text-red-600 font-semibold">Due: ${amountDue.toFixed(2)}</p>}
                            </div>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <Button size="sm" variant="outline" onClick={() => handleDownloadPDF(invoice)} disabled={downloadingPDF === invoice.id} data-testid={`button-download-pdf-${invoice.id}`}>
                              {downloadingPDF === invoice.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                              Download PDF
                            </Button>
                          </div>
                          {amountDue > 0 && invoice.status !== 'cancelled' && (
                            <InvoicePaymentOptions
                              invoiceNumber={invoice.invoice_number}
                              paymentOptions={portalData?.payment_options}
                              onStripePay={() => handlePayInvoice(invoice)}
                              isPaying={payingInvoice === invoice.id}
                            />
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
              )}
            </CardContent>
          </Card>
        )}

        {/* ── ESTIMATES TAB ──────────────────────────────────────────────── */}
        {activeSection === 'estimates' && (
          <Card className="bg-white shadow-lg">
            <CardHeader>
              <CardTitle>Estimates ({estimates.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {estimates.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p>No estimates yet</p>
                </div>
              ) : (
                estimates.map(estimate => (
                  <Card key={estimate.id} className="border-2">
                    <CardContent className="p-3 sm:p-6">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="text-lg font-semibold">Estimate #{estimate.estimate_number}</h3>
                          <Badge variant="outline" className={
                            estimate.status === 'accepted' ? 'bg-green-100 text-green-700' :
                            estimate.status === 'declined' ? 'bg-red-100 text-red-700' :
                            'bg-blue-100 text-blue-700'
                          }>
                            {estimate.status}
                          </Badge>
                          <p className="text-2xl font-bold mt-2">${Number(estimate.amount || 0).toFixed(2)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {/* ── PAYMENTS TAB ──────────────────────────────────────────────── */}
        {activeSection === 'payments' && (
          <Card className="bg-white shadow-lg">
            <CardHeader>
              <CardTitle>Payment History ({payments.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {payments.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <DollarSign className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p>No payment history yet</p>
                </div>
              ) : (
                payments.map(payment => (
                  <Card key={payment.id} className="border">
                    <CardContent className="p-4 flex justify-between items-center">
                      <div>
                        <p className="font-semibold">Payment #{payment.payment_number}</p>
                        <p className="text-sm text-gray-500">
                          {payment.payment_date ? format(new Date(payment.payment_date), 'MMM d, yyyy') : '—'} · {payment.payment_method}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-green-600">${Number(payment.amount || 0).toFixed(2)}</p>
                        <Badge className="bg-green-100 text-green-700">{payment.status}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
