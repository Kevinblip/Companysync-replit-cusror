import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSearchParams } from "react-router-dom";
import {
  FileText,
  Download,
  DollarSign,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  CreditCard,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export default function CustomerPortalPublic() {
  const [token, setToken] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [customerFiles, setCustomerFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSection, setActiveSection] = useState('overview');
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [downloadingPDF, setDownloadingPDF] = useState(null);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const customerId = searchParams.get('customer_id');
    const urlToken = searchParams.get('token');
    const targetId = customerId || urlToken;

    if (!targetId) {
      setError('Invalid portal link');
      setLoading(false);
      return;
    }

    setToken(targetId);

    if (customerId) {
      fetch(`/api/public/customer?id=${encodeURIComponent(customerId)}`)
        .then(r => r.json())
        .then(data => {
          if (!data.success || !data.customer) {
            setError('Invalid or expired portal link');
          } else {
            setCustomer(data.customer);
          }
          setLoading(false);
        })
        .catch(() => {
          setError('Failed to load portal');
          setLoading(false);
        });
    } else {
      base44.entities.Customer.filter({ portal_token: urlToken })
        .then(customers => {
          if (customers.length === 0) {
            setError('Invalid or expired portal link');
            setLoading(false);
            return;
          }
          setCustomer(customers[0]);
          setLoading(false);
        })
        .catch(() => {
          setError('Failed to load portal');
          setLoading(false);
        });
    }
  }, [searchParams]);

  const { data: estimates = [] } = useQuery({
    queryKey: ['estimates', customer?.name],
    queryFn: () => base44.entities.Estimate.filter({ customer_name: customer?.name }),
    enabled: !!customer,
    initialData: [],
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', customer?.name],
    queryFn: () => base44.entities.Invoice.filter({ customer_name: customer?.name }),
    enabled: !!customer,
    initialData: [],
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', customer?.name],
    queryFn: () => base44.entities.Payment.filter({ customer_name: customer?.name }),
    enabled: !!customer,
    initialData: [],
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', customer?.name],
    queryFn: () => base44.entities.Project.filter({ customer_name: customer?.name }),
    enabled: !!customer,
    initialData: [],
  });

  const { data: appointments = [] } = useQuery({
    queryKey: ['appointments', customer?.name],
    queryFn: () => base44.entities.CalendarEvent.filter({ related_customer: customer?.name }),
    enabled: !!customer,
    initialData: [],
  });

  useEffect(() => {
    if (!customer?.id) return;
    fetch(`/api/local/entity/Document?company_id=${encodeURIComponent(customer.company_id || '')}`)
      .then((res) => res.json())
      .then((docs) => {
        const files = (docs || []).filter((file) => {
          const text = `${file.document_name || ''} ${file.description || ''} ${file.file_url || ''} ${JSON.stringify(file.data || {})}`.toLowerCase();
          return text.includes(String(customer.id).toLowerCase()) || text.includes(String(customer.name || '').toLowerCase());
        });
        setCustomerFiles(files);
      })
      .catch(() => setCustomerFiles([]));
  }, [customer?.id, customer?.name, customer?.company_id]);

  const handlePayInvoice = async (invoice) => {
    setPayingInvoice(invoice.id);
    try {
      const response = await base44.functions.invoke('createInvoiceCheckout', {
        invoice_id: invoice.id
      });
      
      if (response.data.success && response.data.checkout_url) {
        window.location.href = response.data.checkout_url;
      } else {
        toast.error('Failed to create checkout session');
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
      const response = await base44.functions.invoke('generateInvoicePDF', {
        invoice: invoice,
        customer: customer
      });
      
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
    .filter(i => i.status !== 'paid' && i.status !== 'cancelled')
    .reduce((sum, inv) => sum + (Number(inv.amount || 0) - Number(inv.amount_paid || 0)), 0);

  const openEstimates = estimates.filter(e => 
    e.status !== 'accepted' && e.status !== 'declined' && e.status !== 'expired'
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50">
      <Toaster richColors position="top-right" />
      
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 shadow-lg">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold">Welcome, {customer.name}! 👋</h1>
          <p className="text-blue-100 mt-2">Your customer portal</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {customerFiles.length > 0 && (
          <Card className="bg-white shadow-lg mb-6">
            <CardHeader>
              <CardTitle>Photos & Files</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {customerFiles.map((file) => {
                  const isImage = (file.file_type || file.mime_type || '').startsWith('image/');
                  return (
                    <div key={file.id} className="border rounded-lg overflow-hidden bg-gray-50">
                      {isImage ? (
                        <img src={file.file_url} alt={file.document_name || 'Customer file'} className="w-full h-40 object-cover" />
                      ) : (
                        <div className="w-full h-40 flex items-center justify-center">
                          <FileText className="w-10 h-10 text-gray-400" />
                        </div>
                      )}
                      <div className="p-3">
                        <p className="text-sm font-medium truncate">{file.document_name || 'File'}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-white shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Balance Due</p>
                  <p className="text-2xl font-bold text-red-600">${totalOutstanding.toFixed(2)}</p>
                </div>
                <DollarSign className="w-8 h-8 text-red-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Open Estimates</p>
                  <p className="text-2xl font-bold text-blue-600">{openEstimates.length}</p>
                </div>
                <FileText className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Active Projects</p>
                  <p className="text-2xl font-bold text-green-600">
                    {projects.filter(p => p.status === 'in_progress').length}
                  </p>
                </div>
                <Clock className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Completed</p>
                  <p className="text-2xl font-bold text-purple-600">
                    {projects.filter(p => p.status === 'completed').length}
                  </p>
                </div>
                <CheckCircle2 className="w-8 h-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Navigation Tabs */}
        <Card className="bg-white shadow-lg mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-2">
              {['overview', 'invoices', 'estimates', 'payments', 'projects', 'appointments'].map(section => (
                <Button
                  key={section}
                  variant={activeSection === section ? 'default' : 'outline'}
                  onClick={() => setActiveSection(section)}
                  className="capitalize"
                >
                  {section}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Content Sections */}
        {activeSection === 'overview' && (
          <Card className="bg-white shadow-lg">
            <CardHeader>
              <CardTitle>Your Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-gray-500">Name</p>
                <p className="text-lg font-semibold">{customer.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Email</p>
                <p className="text-lg font-semibold">{customer.email}</p>
              </div>
              {customer.phone && (
                <div>
                  <p className="text-sm font-medium text-gray-500">Phone</p>
                  <p className="text-lg font-semibold">{customer.phone}</p>
                </div>
              )}
              {(customer.street || customer.address) && (
                <div className="md:col-span-2">
                  <p className="text-sm font-medium text-gray-500">Address</p>
                  <p className="text-lg font-semibold">
                    {customer.street || customer.address}
                    {customer.city && `, ${customer.city}`}
                    {customer.state && `, ${customer.state}`}
                    {customer.zip && ` ${customer.zip}`}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
                    const amountDue = (invoice.amount || 0) - (invoice.amount_paid || 0);
                    return (
                      <Card key={invoice.id} className="border-2">
                        <CardContent className="p-6">
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
                              <p className="text-2xl font-bold">${Number(invoice.amount || 0).toFixed(2)}</p>
                              {amountDue > 0 && (
                                <p className="text-red-600 font-semibold">Due: ${amountDue.toFixed(2)}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownloadPDF(invoice)}
                              disabled={downloadingPDF === invoice.id}
                            >
                              {downloadingPDF === invoice.id ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Download className="w-4 h-4 mr-2" />
                              )}
                              Download PDF
                            </Button>
                            {amountDue > 0 && invoice.status !== 'paid' && (
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700"
                                onClick={() => handlePayInvoice(invoice)}
                                disabled={payingInvoice === invoice.id}
                              >
                                {payingInvoice === invoice.id ? (
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                  <CreditCard className="w-4 h-4 mr-2" />
                                )}
                                Pay ${amountDue.toFixed(2)}
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
              )}
            </CardContent>
          </Card>
        )}

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
                    <CardContent className="p-6">
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
                          {format(new Date(payment.payment_date), 'MMM d, yyyy')} • {payment.payment_method}
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

        {activeSection === 'projects' && (
          <Card className="bg-white shadow-lg">
            <CardHeader>
              <CardTitle>Projects ({projects.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {projects.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Clock className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p>No projects yet</p>
                </div>
              ) : (
                projects.map(project => (
                  <Card key={project.id} className="border">
                    <CardContent className="p-6">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="text-lg font-semibold">{project.name}</h3>
                          <p className="text-sm text-gray-600 mt-1">{project.description}</p>
                        </div>
                        <Badge variant="outline" className={
                          project.status === 'completed' ? 'bg-green-100 text-green-700' :
                          project.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-700'
                        }>
                          {project.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {activeSection === 'appointments' && (
          <Card className="bg-white shadow-lg">
            <CardHeader>
              <CardTitle>Appointments ({appointments.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {appointments.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p>No appointments scheduled</p>
                </div>
              ) : (
                appointments.map(appt => (
                  <Card key={appt.id} className="border">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-16 h-16 bg-blue-100 rounded-lg flex flex-col items-center justify-center">
                          <p className="text-2xl font-bold text-blue-600">
                            {format(new Date(appt.start_time), 'd')}
                          </p>
                          <p className="text-xs text-blue-600">
                            {format(new Date(appt.start_time), 'MMM')}
                          </p>
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg">{appt.title}</h3>
                          <p className="text-sm text-gray-600 mt-1">{appt.description}</p>
                          <p className="text-sm text-gray-600 mt-2">
                            📅 {format(new Date(appt.start_time), 'MMM d, yyyy h:mm a')}
                          </p>
                          {appt.location && (
                            <p className="text-sm text-gray-600">📍 {appt.location}</p>
                          )}
                        </div>
                        <Badge variant="outline" className={
                          appt.status === 'completed' ? 'bg-green-100 text-green-700' :
                          appt.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700'
                        }>
                          {appt.status}
                        </Badge>
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