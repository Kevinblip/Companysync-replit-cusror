import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  FileText,
  Download,
  DollarSign,
  Calendar,
  CheckCircle2,
  Clock,
  MessageCircle,
  Send,
  Paperclip,
  CreditCard,
  Eye,
  ThumbsUp,
  ThumbsDown,
  User,
  Plus,
  Loader2,
  LogOut
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export default function CustomerPortal() {
  const { user, logout } = useAuth();
  const [viewingDocument, setViewingDocument] = useState(null);
  const [newMessage, setNewMessage] = useState("");
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [activeSection, setActiveSection] = useState('profile');
  const [newNote, setNewNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [downloadingPDF, setDownloadingPDF] = useState(null);

  const queryClient = useQueryClient();

  // Check for payment success/cancel in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const invoiceNum = params.get('invoice');

    if (paymentStatus === 'success' && invoiceNum) {
      toast.success(`Payment successful for invoice ${invoiceNum}!`);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (paymentStatus === 'cancelled') {
      toast.error('Payment cancelled');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [queryClient]);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', user?.email],
    queryFn: () => base44.entities.Customer.filter({ email: user?.email }),
    enabled: !!user,
    initialData: [],
  });

  const customer = customers[0];

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

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', customer?.name],
    queryFn: () => base44.entities.Payment.filter({ customer_name: customer?.name }),
    enabled: !!customer,
    initialData: [],
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['documents', customer?.name],
    queryFn: () => base44.entities.Document.filter({
      related_customer: customer?.name,
      is_customer_visible: true
    }),
    enabled: !!customer,
    initialData: [],
  });

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', user?.email],
    queryFn: () => base44.entities.Message.filter({
      to_user_email: user?.email
    }),
    enabled: !!user,
    initialData: [],
  });

  const addNoteMutation = useMutation({
    mutationFn: async (noteText) => {
      if (!customer) throw new Error("Customer data is not available.");
      
      const newNoteObj = {
        id: Date.now().toString(),
        note: noteText,
        created_at: new Date().toISOString(),
        created_by: user?.full_name || 'Customer'
      };

      const existingNotes = customer.customer_notes || [];
      const updatedNotes = [...existingNotes, newNoteObj];

      return await base44.entities.Customer.update(customer.id, {
        customer_notes: updatedNotes
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', user?.email] });
      setNewNote('');
      setIsSavingNote(false);
    },
    onError: (error) => {
      console.error('Failed to add note:', error);
      alert('Failed to add note. Please try again.');
      setIsSavingNote(false);
    }
  });

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Card className="w-96">
          <CardContent className="p-8 text-center">
            <p className="text-gray-500">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <Card className="w-96">
          <CardContent className="p-8 text-center">
            <p className="text-gray-500">No customer account found for {user.email}</p>
            <p className="text-sm text-gray-400 mt-2">Please contact support</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalOutstanding = invoices
    .filter(i => i.status !== 'paid' && i.status !== 'cancelled')
    .reduce((sum, inv) => sum + Number(inv.amount || 0), 0);

  const openEstimates = estimates.filter(e => e.status !== 'accepted' && e.status !== 'declined' && e.status !== 'expired');
  const completedProjects = projects.filter(p => p.status === 'completed');
  const upcomingAppointments = appointments.filter(a => {
    return new Date(a.start_time) > new Date() && a.status === 'scheduled';
  }).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  const handleAcceptEstimate = async (estimate) => {
    if (window.confirm('Accept this estimate?')) {
      await base44.entities.Estimate.update(estimate.id, {
        ...estimate,
        status: 'accepted'
      });
      alert('Estimate accepted! We will contact you shortly.');
      queryClient.invalidateQueries({ queryKey: ['estimates', customer?.name] });
    }
  };

  const handleDeclineEstimate = async (estimate) => {
    if (window.confirm('Decline this estimate?')) {
      await base44.entities.Estimate.update(estimate.id, {
        ...estimate,
        status: 'declined'
      });
      alert('Estimate declined.');
      queryClient.invalidateQueries({ queryKey: ['estimates', customer?.name] });
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    await base44.entities.Message.create({
      from_user_email: user.email,
      from_user_name: user.full_name,
      to_user_email: 'support@company.com', // Or get from company settings
      to_user_name: 'Support Team',
      subject: 'Customer inquiry',
      message_body: newMessage,
      message_type: 'customer_to_staff',
      conversation_id: selectedConversation || `conv_${Date.now()}`
    });

    setNewMessage("");
    alert('Message sent! We will respond shortly.');
    queryClient.invalidateQueries({ queryKey: ['messages', user?.email] });
  };

  const handleAddNote = () => {
    if (!newNote.trim()) {
      alert('Please enter a note');
      return;
    }

    setIsSavingNote(true);
    addNoteMutation.mutate(newNote);
  };

  const handlePayInvoice = async (invoice) => {
    setPayingInvoice(invoice.id);
    try {
      const response = await base44.functions.invoke('createInvoiceCheckout', {
        invoice_id: invoice.id
      });
      
      if (response.data.success && response.data.checkout_url) {
        // Redirect to Stripe checkout
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
        // Open PDF in new tab
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

  const renderProfileContent = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Outstanding Balance</p>
                <p className="text-2xl font-bold text-red-600">${totalOutstanding.toLocaleString()}</p>
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
                <p className="text-2xl font-bold text-green-600">{projects.filter(p => p.status === 'in_progress').length}</p>
              </div>
              <Clock className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Completed Projects</p>
                <p className="text-2xl font-bold text-purple-600">{completedProjects.length}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white shadow-lg">
        <CardHeader>
          <CardTitle>Your Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-gray-500">Full Name</p>
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
          {customer.address && (
            <div className="md:col-span-2">
              <p className="text-sm font-medium text-gray-500">Address</p>
              <p className="text-lg font-semibold">{customer.address}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderEstimatesContent = () => (
    <Card className="bg-white shadow-lg p-6">
      <CardTitle className="mb-4">Estimates ({estimates.length})</CardTitle>
      <div className="space-y-4">
        {estimates.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p>No estimates yet</p>
          </div>
        ) : (
          estimates.map((estimate) => (
            <Card key={estimate.id} className="bg-gray-50">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold">
                        Estimate #{estimate.estimate_number}
                      </h3>
                      <Badge variant="outline" className={
                        estimate.status === 'accepted' ? 'bg-green-100 text-green-700 border-green-200' :
                        estimate.status === 'declined' ? 'bg-red-100 text-red-700 border-red-200' :
                        estimate.status === 'expired' ? 'bg-gray-100 text-gray-700 border-gray-200' :
                        'bg-blue-100 text-blue-700 border-blue-200'
                      }>
                        {estimate.status}
                      </Badge>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 mb-2">
                      ${(estimate.amount || 0).toLocaleString()}
                    </p>
                    {estimate.valid_until && (
                      <p className="text-sm text-gray-500">
                        Valid until: {format(new Date(estimate.valid_until), 'MMM d, yyyy')}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setViewingDocument({ type: 'estimate', data: estimate })}
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View
                    </Button>
                    {estimate.status === 'sent' || estimate.status === 'viewed' ? (
                      <>
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() => handleAcceptEstimate(estimate)}
                        >
                          <ThumbsUp className="w-4 h-4 mr-2" />
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 border-red-300 hover:bg-red-50"
                          onClick={() => handleDeclineEstimate(estimate)}
                        >
                          <ThumbsDown className="w-4 h-4 mr-2" />
                          Decline
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </Card>
  );

  const renderInvoicesContent = () => {
    const paidInvoices = invoices.filter(i => i.status === 'paid');
    const unpaidInvoices = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled');
    const totalOutstanding = unpaidInvoices.reduce((sum, i) => sum + (Number(i.amount || 0) - Number(i.amount_paid || 0)), 0);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white">
            <CardContent className="p-6">
              <p className="text-sm opacity-90">Outstanding Balance</p>
              <p className="text-3xl font-bold mt-2">${totalOutstanding.toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
              <p className="text-xs opacity-75 mt-1">{unpaidInvoices.length} unpaid invoice(s)</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
            <CardContent className="p-6">
              <p className="text-sm opacity-90">Paid to Date</p>
              <p className="text-3xl font-bold mt-2">${paidInvoices.reduce((sum, i) => sum + Number(i.amount || 0), 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
              <p className="text-xs opacity-75 mt-1">{paidInvoices.length} paid invoice(s)</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white shadow-lg p-6">
          <CardTitle className="mb-4">All Invoices ({invoices.length})</CardTitle>
          <div className="space-y-4">
            {invoices.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p>No invoices yet</p>
              </div>
            ) : (
              invoices
                .sort((a, b) => new Date(b.issue_date || b.created_date) - new Date(a.issue_date || a.created_date))
                .map((invoice) => {
                  const totalAmount = invoice.amount || 0;
                  const amountPaid = invoice.amount_paid || 0;
                  const amountDue = totalAmount - amountPaid;

                  return (
                    <Card key={invoice.id} className="bg-gray-50 border-2">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between flex-wrap gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="text-lg font-semibold">
                                Invoice #{invoice.invoice_number}
                              </h3>
                              <Badge variant="outline" className={
                                invoice.status === 'paid' ? 'bg-green-100 text-green-700 border-green-200' :
                                invoice.status === 'partially_paid' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                invoice.status === 'overdue' ? 'bg-red-100 text-red-700 border-red-200' :
                                'bg-yellow-100 text-yellow-700 border-yellow-200'
                              }>
                                {invoice.status === 'partially_paid' ? 'Partially Paid' : invoice.status}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-4 mb-3">
                              <div>
                                <p className="text-sm text-gray-500">Total Amount</p>
                                <p className="text-2xl font-bold text-gray-900">
                                  ${totalAmount.toLocaleString('en-US', {minimumFractionDigits: 2})}
                                </p>
                              </div>
                              {amountPaid > 0 && (
                                <div>
                                  <p className="text-sm text-gray-500">Amount Paid</p>
                                  <p className="text-lg font-semibold text-green-600">
                                    ${amountPaid.toLocaleString('en-US', {minimumFractionDigits: 2})}
                                  </p>
                                </div>
                              )}
                            </div>
                            {amountDue > 0 && (
                              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                                <p className="text-sm font-medium text-red-900">Amount Due</p>
                                <p className="text-xl font-bold text-red-600">
                                  ${amountDue.toLocaleString('en-US', {minimumFractionDigits: 2})}
                                </p>
                              </div>
                            )}
                            <div className="flex gap-4 text-sm">
                              {invoice.issue_date && (
                                <p className="text-gray-500">
                                  Issued: {format(new Date(invoice.issue_date), 'MMM d, yyyy')}
                                </p>
                              )}
                              {invoice.due_date && (
                                <p className="text-gray-500">
                                  Due: {format(new Date(invoice.due_date), 'MMM d, yyyy')}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-2 flex-wrap">
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
                            {invoice.status !== 'paid' && invoice.status !== 'cancelled' && amountDue > 0 && (
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
                                Pay ${amountDue.toLocaleString('en-US', {minimumFractionDigits: 2})}
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
            )}
          </div>
        </Card>
      </div>
    );
  };

  const renderPaymentsContent = () => (
    <Card className="bg-white shadow-lg p-6">
      <CardTitle className="mb-4">Payment History ({payments.length})</CardTitle>
      <div className="space-y-4">
        {payments.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <DollarSign className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p>No payment history yet</p>
          </div>
        ) : (
          payments.map((payment) => (
            <Card key={payment.id} className="bg-gray-50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">Payment #{payment.payment_number}</p>
                    <p className="text-sm text-gray-500">
                      {format(new Date(payment.payment_date), 'MMM d, yyyy')} • {payment.payment_method}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-green-600">
                      ${(payment.amount || 0).toLocaleString()}
                    </p>
                    <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200">
                      {payment.status}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </Card>
  );

  const renderProjectsContent = () => (
    <Card className="bg-white shadow-lg p-6">
      <CardTitle className="mb-4">Projects ({projects.length})</CardTitle>
      <div className="space-y-4">
        {projects.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Clock className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p>No projects yet</p>
          </div>
        ) : (
          projects.map((project) => (
            <Card key={project.id} className="bg-gray-50">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">{project.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">{project.description}</p>
                  </div>
                  <Badge variant="outline" className={
                    project.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' :
                    project.status === 'in_progress' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                    'bg-gray-100 text-gray-700 border-gray-200'
                  }>
                    {project.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {project.start_date && (
                    <div>
                      <p className="text-gray-500">Start Date</p>
                      <p className="font-semibold">{format(new Date(project.start_date), 'MMM d, yyyy')}</p>
                    </div>
                  )}
                  {project.deadline && (
                    <div>
                      <p className="text-gray-500">Deadline</p>
                      <p className="font-semibold">{format(new Date(project.deadline), 'MMM d, yyyy')}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </Card>
  );

  const renderAppointmentsContent = () => (
    <Card className="bg-white shadow-lg p-6">
      <CardTitle className="mb-4">Appointments ({appointments.length})</CardTitle>
      <div className="space-y-4">
        {appointments.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p>No appointments scheduled</p>
          </div>
        ) : (
          appointments.map((appointment) => (
            <Card key={appointment.id} className="bg-gray-50">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 bg-blue-100 rounded-lg flex flex-col items-center justify-center">
                      <p className="text-2xl font-bold text-blue-600">
                        {format(new Date(appointment.start_time), 'd')}
                      </p>
                      <p className="text-xs text-blue-600">
                        {format(new Date(appointment.start_time), 'MMM')}
                      </p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">{appointment.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">{appointment.description}</p>
                      <p className="text-sm text-gray-600 mt-2">
                        📅 {format(new Date(appointment.start_time), 'MMM d, yyyy h:mm a')}
                      </p>
                      {appointment.location && (
                        <p className="text-sm text-gray-600">📍 {appointment.location}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className={
                    appointment.status === 'completed' ? 'bg-green-100 text-green-700 border-green-200' :
                    appointment.status === 'cancelled' ? 'bg-red-100 text-red-700 border-red-200' :
                    'bg-blue-100 text-blue-700 border-blue-200'
                  }>
                    {appointment.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </Card>
  );

  const renderDocumentsContent = () => (
    <Card className="bg-white shadow-lg p-6">
      <CardTitle className="mb-4">Documents ({documents.length})</CardTitle>
      <div className="space-y-4">
        {documents.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p>No documents available</p>
          </div>
        ) : (
          documents.map((doc) => (
            <Card key={doc.id} className="bg-gray-50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="w-8 h-8 text-blue-500" />
                    <div>
                      <p className="font-semibold">{doc.document_name}</p>
                      <p className="text-sm text-gray-500">
                        {format(new Date(doc.created_date), 'MMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(doc.file_url, '_blank')}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </Card>
  );

  const renderMessagesContent = () => (
    <Card className="bg-white shadow-lg p-6">
      <CardTitle className="mb-4">Messages</CardTitle>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="col-span-1 space-y-2">
          <h3 className="font-semibold mb-2">Conversations</h3>
          {messages.length === 0 ? (
            <p className="text-sm text-gray-500">No messages yet</p>
          ) : (
            messages.map((msg) => (
              <Card
                key={msg.id}
                className={`cursor-pointer hover:bg-gray-50 ${selectedConversation === msg.conversation_id ? 'border-blue-500 bg-blue-50' : !msg.is_read ? 'border-blue-300' : ''}`}
                onClick={() => setSelectedConversation(msg.conversation_id)}
              >
                <CardContent className="p-3">
                  <p className="font-semibold text-sm">{msg.subject || 'No subject'}</p>
                  <p className="text-xs text-gray-500 truncate">{msg.message_body}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {format(new Date(msg.created_date), 'MMM d')}
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="col-span-1 md:col-span-2">
          <Card className="h-[600px] flex flex-col">
            <CardHeader className="border-b">
              <CardTitle>Conversation {selectedConversation ? `#${selectedConversation.substring(selectedConversation.lastIndexOf('_') + 1)}` : ''}</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-4 flex flex-col">
              <div className="flex-1 overflow-y-auto mb-4">
                {selectedConversation && messages.filter(m => m.conversation_id === selectedConversation).length > 0 ? (
                  messages.filter(m => m.conversation_id === selectedConversation).map(msg => (
                    <div key={msg.id} className="mb-4 p-3 bg-gray-50 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-semibold text-sm">{msg.from_user_name}</p>
                        <p className="text-xs text-gray-500">
                          {format(new Date(msg.created_date), 'MMM d, h:mm a')}
                        </p>
                      </div>
                      <p className="text-sm">{msg.message_body}</p>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p>Select a conversation or send a new message.</p>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <Textarea
                  placeholder="Type your message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  rows={4}
                />
                <div className="flex justify-between">
                  <Button variant="outline" size="sm">
                    <Paperclip className="w-4 h-4 mr-2" />
                    Attach File
                  </Button>
                  <Button
                    onClick={handleSendMessage}
                    disabled={!newMessage.trim()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send Message
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Card>
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'profile':
        return renderProfileContent();
      case 'estimates':
        return renderEstimatesContent();
      case 'invoices':
        return renderInvoicesContent();
      case 'payments':
        return renderPaymentsContent();
      case 'projects':
        return renderProjectsContent();
      case 'appointments':
        return renderAppointmentsContent();
      case 'documents':
        return renderDocumentsContent();
      case 'messages':
        return renderMessagesContent();
      case 'notes':
        const customerNotes = customer?.customer_notes || [];

        return (
          <div className="space-y-6">
            <Card className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">My Notes</h2>
              <p className="text-sm text-gray-600 mb-4">
                Keep track of important information, questions, or reminders about your account.
              </p>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="new-note">Add New Note</Label>
                  <Textarea
                    id="new-note"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Enter your note here..."
                    rows={4}
                    className="mt-1"
                  />
                </div>

                <Button
                  onClick={handleAddNote}
                  disabled={isSavingNote || !newNote.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {isSavingNote ? (
                    <>
                      <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Note
                    </>
                  )}
                </Button>
              </div>
            </Card>

            {customerNotes.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-gray-900">Previous Notes</h3>
                {customerNotes
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                  .map((note) => (
                    <Card key={note.id} className="bg-white shadow-sm">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-blue-600" />
                            <span className="text-sm font-medium text-gray-900">{note.created_by}</span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}
                          </span>
                        </div>
                        <p className="text-gray-700 whitespace-pre-wrap">{note.note}</p>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            ) : (
              <Card className="bg-gray-50">
                <CardContent className="p-12 text-center">
                  <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-gray-500">No notes yet</p>
                  <p className="text-sm text-gray-400 mt-1">Add your first note above</p>
                </CardContent>
              </Card>
            )}
          </div>
        );
      case 'reminders': {
        const now = new Date();
        const upcomingAppointments = appointments
          .filter(a => new Date(a.start_time) >= now)
          .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
        const pastAppointments = appointments
          .filter(a => new Date(a.start_time) < now)
          .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
          .slice(0, 5);

        const getReminderBadges = (apt) => {
          const start = new Date(apt.start_time);
          const hoursUntil = (start - now) / 3600000;
          const badges = [];
          if (hoursUntil > 24) badges.push({ label: '24hr reminder pending', color: 'bg-blue-100 text-blue-700' });
          else if (hoursUntil > 6) badges.push({ label: '24hr reminder sent', color: 'bg-green-100 text-green-700' });
          if (hoursUntil > 6) badges.push({ label: '6hr reminder pending', color: 'bg-blue-100 text-blue-700' });
          else if (hoursUntil > 1) badges.push({ label: '6hr reminder sent', color: 'bg-green-100 text-green-700' });
          if (hoursUntil > 1) badges.push({ label: '1hr reminder pending', color: 'bg-blue-100 text-blue-700' });
          else badges.push({ label: '1hr reminder sent', color: 'bg-green-100 text-green-700' });
          return badges;
        };

        return (
          <div className="space-y-6">
            {/* Reminder policy banner */}
            <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
              <CardContent className="p-5 flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <Clock className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Automatic Appointment Reminders</h3>
                  <p className="text-sm text-gray-600">
                    You will automatically receive an <strong>email and text message</strong> reminder at
                    <strong> 24 hours</strong>, <strong>6 hours</strong>, and <strong>1 hour</strong> before each scheduled appointment.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Upcoming appointments */}
            <Card className="bg-white shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-600" />
                  Upcoming Appointments ({upcomingAppointments.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {upcomingAppointments.length === 0 ? (
                  <div className="text-center py-8">
                    <Calendar className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-gray-500">No upcoming appointments scheduled.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {upcomingAppointments.map((apt) => {
                      const start = new Date(apt.start_time);
                      const hoursUntil = Math.round((start - now) / 3600000);
                      const reminderBadges = getReminderBadges(apt);
                      return (
                        <div key={apt.id} data-testid={`reminder-appointment-${apt.id}`} className="border rounded-xl p-4 hover:shadow-md transition-shadow">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-gray-900">{apt.title}</h4>
                              {apt.description && (
                                <p className="text-sm text-gray-500 mt-0.5">{apt.description}</p>
                              )}
                              <div className="flex flex-wrap gap-2 mt-2">
                                <span className="inline-flex items-center gap-1 text-sm text-gray-700 bg-gray-100 rounded-full px-3 py-0.5">
                                  <Calendar className="w-3 h-3" />
                                  {format(start, "EEEE, MMM d, yyyy")}
                                </span>
                                <span className="inline-flex items-center gap-1 text-sm text-gray-700 bg-gray-100 rounded-full px-3 py-0.5">
                                  <Clock className="w-3 h-3" />
                                  {format(start, "h:mm a")}
                                </span>
                                {apt.location && (
                                  <span className="inline-flex items-center gap-1 text-sm text-gray-700 bg-gray-100 rounded-full px-3 py-0.5">
                                    📍 {apt.location}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                                hoursUntil <= 1 ? 'bg-red-100 text-red-700' :
                                hoursUntil <= 6 ? 'bg-orange-100 text-orange-700' :
                                hoursUntil <= 24 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-blue-100 text-blue-700'
                              }`}>
                                {hoursUntil <= 1 ? 'In < 1 hr' :
                                 hoursUntil < 24 ? `In ${hoursUntil}h` :
                                 `In ${Math.round(hoursUntil / 24)}d`}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3 pt-3 border-t flex flex-wrap gap-2">
                            <span className="text-xs text-gray-500 self-center">Reminders:</span>
                            {reminderBadges.map((b, i) => (
                              <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.color}`}>
                                {b.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Past appointments */}
            {pastAppointments.length > 0 && (
              <Card className="bg-white shadow-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-gray-600">
                    <CheckCircle2 className="w-5 h-5" />
                    Recent Completed ({pastAppointments.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {pastAppointments.map((apt) => (
                      <div key={apt.id} className="flex items-center gap-3 text-sm text-gray-600 py-2 border-b last:border-0">
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span className="font-medium text-gray-800">{apt.title}</span>
                        <span className="ml-auto text-gray-400 whitespace-nowrap">
                          {format(new Date(apt.start_time), "MMM d, yyyy")}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        );
      }
      default:
        return renderProfileContent();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50">
      <Toaster richColors position="top-right" />
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-8 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Welcome back, {customer.name}! 👋</h1>
            <p className="text-blue-100 mt-2">Your customer portal dashboard</p>
          </div>
          <Button
            variant="ghost"
            className="text-white hover:bg-white/10"
            onClick={() => logout()}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <Card className="lg:col-span-1 h-fit bg-white shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 border-b pb-4 mb-4">
                <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
                  {customer.name[0]}
                </div>
                <div>
                  <p className="font-semibold text-gray-800">{customer.name}</p>
                  <p className="text-sm text-gray-500">{customer.email}</p>
                </div>
              </div>

              <nav className="space-y-1">
                <button
                  onClick={() => setActiveSection('profile')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === 'profile'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <User className="w-5 h-5" />
                  <span className="font-medium">Profile</span>
                </button>

                <button
                  onClick={() => setActiveSection('estimates')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === 'estimates'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <FileText className="w-5 h-5" />
                  <span className="font-medium">Estimates</span>
                  {estimates.length > 0 && (
                    <Badge className="ml-auto bg-blue-600">
                      {estimates.length}
                    </Badge>
                  )}
                </button>

                <button
                  onClick={() => setActiveSection('invoices')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === 'invoices'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <DollarSign className="w-5 h-5" />
                  <span className="font-medium">Invoices</span>
                  {invoices.length > 0 && (
                    <Badge className="ml-auto bg-blue-600">
                      {invoices.length}
                    </Badge>
                  )}
                </button>

                <button
                  onClick={() => setActiveSection('payments')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === 'payments'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <CreditCard className="w-5 h-5" />
                  <span className="font-medium">Payments</span>
                  {payments.length > 0 && (
                    <Badge className="ml-auto bg-blue-600">
                      {payments.length}
                    </Badge>
                  )}
                </button>

                <button
                  onClick={() => setActiveSection('projects')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === 'projects'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Clock className="w-5 h-5" />
                  <span className="font-medium">Projects</span>
                  {projects.length > 0 && (
                    <Badge className="ml-auto bg-blue-600">
                      {projects.length}
                    </Badge>
                  )}
                </button>

                <button
                  onClick={() => setActiveSection('appointments')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === 'appointments'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Calendar className="w-5 h-5" />
                  <span className="font-medium">Appointments</span>
                  {appointments.length > 0 && (
                    <Badge className="ml-auto bg-blue-600">
                      {appointments.length}
                    </Badge>
                  )}
                </button>

                <button
                  onClick={() => setActiveSection('documents')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === 'documents'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <FileText className="w-5 h-5" />
                  <span className="font-medium">Documents</span>
                  {documents.length > 0 && (
                    <Badge className="ml-auto bg-blue-600">
                      {documents.length}
                    </Badge>
                  )}
                </button>

                <button
                  onClick={() => setActiveSection('messages')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === 'messages'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <MessageCircle className="w-5 h-5" />
                  <span className="font-medium">Messages</span>
                  {messages.filter(m => !m.is_read).length > 0 && (
                    <Badge className="ml-auto bg-blue-600">
                      {messages.filter(m => !m.is_read).length}
                    </Badge>
                  )}
                </button>

                <button
                  onClick={() => setActiveSection('notes')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === 'notes'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <FileText className="w-5 h-5" />
                  <span className="font-medium">Notes</span>
                  {customer?.customer_notes?.length > 0 && (
                    <Badge className="ml-auto bg-blue-600">
                      {customer.customer_notes.length}
                    </Badge>
                  )}
                </button>

                <button
                  onClick={() => setActiveSection('reminders')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === 'reminders'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Clock className="w-5 h-5" />
                  <span className="font-medium">Reminders</span>
                </button>
              </nav>
            </CardContent>
          </Card>

          <div className="lg:col-span-3">
            {renderContent()}
          </div>
        </div>
      </div>

      {viewingDocument && (
        <Dialog open={!!viewingDocument} onOpenChange={() => setViewingDocument(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {viewingDocument.type === 'estimate'
                  ? `Estimate #${viewingDocument.data.estimate_number}`
                  : `Invoice #${viewingDocument.data.invoice_number}`}
              </DialogTitle>
            </DialogHeader>
            <div className="pt-4">
              <p className="text-gray-700">
                Viewing {viewingDocument.type} for ${viewingDocument.data.amount?.toLocaleString()}.
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Document ID: {viewingDocument.data.id}
              </p>
              {viewingDocument.data.file_url && (
                <Button className="mt-4" onClick={() => window.open(viewingDocument.data.file_url, '_blank')}>
                  <Download className="w-4 h-4 mr-2" /> Open Document
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}