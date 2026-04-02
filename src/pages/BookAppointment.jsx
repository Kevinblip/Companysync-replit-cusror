import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, CheckCircle, Clock, Phone, Mail, User, MapPin } from "lucide-react";
import { format, addDays, setHours, setMinutes } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const INDUSTRY_DEFAULTS = {
  roofing: {
    show_property_address: true,
    property_address_required: true,
    show_email: true,
    show_message: true,
    service_types: [
      { value: "roofing_inspection", label: "Roofing Inspection" },
      { value: "roof_repair", label: "Roof Repair" },
      { value: "roof_replacement", label: "Roof Replacement" },
      { value: "storm_damage", label: "Storm Damage Assessment" },
      { value: "gutter_service", label: "Gutter Service" },
      { value: "other", label: "Other" },
    ],
    heading: "Schedule an Appointment",
  },
  construction: {
    show_property_address: true,
    property_address_required: true,
    show_email: true,
    show_message: true,
    service_types: [
      { value: "consultation", label: "Consultation" },
      { value: "estimate", label: "Free Estimate" },
      { value: "inspection", label: "Site Inspection" },
      { value: "other", label: "Other" },
    ],
    heading: "Schedule an Appointment",
  },
  _saas: {
    show_property_address: false,
    property_address_required: false,
    show_email: true,
    show_message: true,
    service_types: [
      { value: "demo", label: "Product Demo" },
      { value: "onboarding", label: "Onboarding Session" },
      { value: "technical_support", label: "Technical Support" },
      { value: "consultation", label: "Consultation" },
      { value: "billing", label: "Billing Support" },
      { value: "other", label: "Other" },
    ],
    heading: "Schedule a Demo",
  },
};

function getFormConfig(company) {
  // If company has explicit booking_form_config, use it (check if ANY field was set)
  const cfg = company?.booking_form_config;
  if (cfg && typeof cfg === 'object') {
    // Determine the industry defaults to merge as fallback for service_types
    const isCompanySync = company?.id === 'companysync_master_001';
    const industryDefaults = isCompanySync 
      ? INDUSTRY_DEFAULTS._saas 
      : (INDUSTRY_DEFAULTS[company?.industry] || INDUSTRY_DEFAULTS.roofing);

    return {
      show_property_address: cfg.show_property_address ?? industryDefaults.show_property_address,
      property_address_required: cfg.property_address_required ?? industryDefaults.property_address_required,
      show_email: cfg.show_email ?? industryDefaults.show_email,
      show_message: cfg.show_message ?? industryDefaults.show_message,
      heading: cfg.heading || industryDefaults.heading,
      confirmation_message: cfg.confirmation_message || "",
      service_types: cfg.service_types?.length > 0 ? cfg.service_types : industryDefaults.service_types,
    };
  }
  // CompanySync itself uses SaaS defaults
  if (company?.id === 'companysync_master_001') return INDUSTRY_DEFAULTS._saas;
  // Otherwise fall back to industry
  return INDUSTRY_DEFAULTS[company?.industry] || INDUSTRY_DEFAULTS.roofing;
}

export default function BookAppointment() {
  const queryClient = useQueryClient();
  const [bookingToken, setBookingToken] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  
  const [formData, setFormData] = useState({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    property_address: "",
    preferred_date: "",
    preferred_time: "",
    service_type: "",
    message: "",
  });

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const cid = urlParams.get('company_id');
    
    if (token) setBookingToken(token);
    if (cid) setCompanyId(cid);
    
    // Pre-fill phone if included
    const phone = urlParams.get('phone');
    if (phone) {
      setFormData(prev => ({ ...prev, customer_phone: phone }));
    }
  }, []);

  // If no company_id in URL, try to get the current user's company
  const { data: currentUser } = useQuery({
    queryKey: ['booking-current-user'],
    queryFn: () => base44.auth.me(),
    enabled: !companyId,
    retry: false,
  });

  const { data: userStaffProfiles = [] } = useQuery({
    queryKey: ['booking-staff-profiles', currentUser?.email],
    queryFn: () => base44.entities.StaffProfile.filter({ user_email: currentUser.email }),
    enabled: !!currentUser?.email && !companyId,
    initialData: [],
  });

  const { data: allCompanies = [] } = useQuery({
    queryKey: ['booking-user-companies', currentUser?.email],
    queryFn: () => base44.entities.Company.filter({ created_by: currentUser.email }),
    enabled: !!currentUser?.email && !companyId,
    initialData: [],
  });

  // Auto-set companyId from user's company if not in URL
  useEffect(() => {
    if (companyId) return;
    // Try staff profile company first
    if (userStaffProfiles.length > 0 && userStaffProfiles[0].company_id) {
      setCompanyId(userStaffProfiles[0].company_id);
      return;
    }
    // Then owned company
    if (allCompanies.length > 0) {
      setCompanyId(allCompanies[0].id);
    }
  }, [allCompanies, userStaffProfiles, companyId]);

  const { data: company, isLoading: isLoadingCompany } = useQuery({
    queryKey: ['company-booking', companyId],
    queryFn: () => companyId ? base44.entities.Company.filter({ id: companyId }).then(res => res[0]) : null,
    enabled: !!companyId,
  });

  // Debug: log what config is being used
  useEffect(() => {
    if (company) {
      console.log('📋 BookAppointment - Company loaded:', company.company_name);
      console.log('📋 BookAppointment - booking_form_config from DB:', JSON.stringify(company.booking_form_config));
      console.log('📋 BookAppointment - Resolved formConfig:', JSON.stringify(getFormConfig(company)));
    }
  }, [company]);

  // Only compute formConfig once company is loaded
  const formConfig = company ? getFormConfig(company) : null;

  // Set default service type once config is ready
  useEffect(() => {
    if (formConfig?.service_types?.length > 0 && !formData.service_type) {
      setFormData(prev => ({ ...prev, service_type: formConfig.service_types[0].value }));
    }
  }, [formConfig]);

  const createAppointmentMutation = useMutation({
    mutationFn: async (data) => {
      const startTime = new Date(`${data.preferred_date}T${data.preferred_time}`);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour duration

      // Create calendar event
      const event = await base44.entities.CalendarEvent.create({
        company_id: companyId,
        title: `${data.service_type.replace(/_/g, ' ')} - ${data.customer_name}`,
        description: data.message,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        event_type: "appointment",
        location: data.property_address || "",
        related_customer: data.customer_name,
        color: "#10b981",
      });

      // Create or update customer/lead
      try {
        await base44.entities.Customer.create({
          company_id: companyId,
          name: data.customer_name,
          email: data.customer_email,
          phone: data.customer_phone,
          source: "website",
        });
      } catch (error) {
        console.log('Customer might already exist:', error);
      }

      // Send confirmation SMS if phone provided
      if (data.customer_phone) {
        try {
          await base44.functions.invoke('sendSMS', {
            to: data.customer_phone,
            message: `✅ Appointment confirmed for ${format(startTime, 'MMM d')} at ${format(startTime, 'h:mm a')}. We'll see you soon! - ${company?.company_name || 'Your Company'}`,
            contactName: data.customer_name,
            companyId: companyId
          });
        } catch (error) {
          console.error('SMS confirmation failed:', error);
        }
      }

      return event;
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createAppointmentMutation.mutate(formData);
  };

  const generateTimeSlots = () => {
    const slots = [];
    for (let hour = 8; hour <= 17; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
      slots.push(`${hour.toString().padStart(2, '0')}:30`);
    }
    return slots;
  };

  const nextAvailableDates = [];
  for (let i = 1; i <= 14; i++) {
    nextAvailableDates.push(addDays(new Date(), i));
  }

  // Show loading while company data is being fetched
  if (!company && (companyId || !companyId)) {
    // Still loading - show spinner instead of default roofing form
    if (isLoadingCompany || (!companyId && !currentUser)) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center p-4">
          <div className="text-center">
            <Clock className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
            <p className="text-gray-600">Loading booking form...</p>
          </div>
        </div>
      );
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardContent className="p-12 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Appointment Confirmed!</h2>
            <p className="text-gray-600 mb-6">
              We've received your appointment request for {format(new Date(`${formData.preferred_date}T${formData.preferred_time}`), 'MMMM d, yyyy')} at {formData.preferred_time}.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              You'll receive a confirmation text message shortly. We look forward to seeing you!
            </p>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">Questions?</p>
              <a href="tel:2167777154" className="flex items-center justify-center gap-2 text-blue-600 hover:underline">
                <Phone className="w-4 h-4" />
                216-777-7154
              </a>
              {company?.email && (
                <a href={`mailto:${company.email}`} className="flex items-center justify-center gap-2 text-blue-600 hover:underline">
                  <Mail className="w-4 h-4" />
                  {company.email}
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-green-600 text-white">
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Calendar className="w-6 h-6" />
            {formConfig?.heading || "Schedule an Appointment"}
          </CardTitle>
          {company && (
            <p className="text-blue-100 text-sm mt-2">
              with {company.company_name}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="customer_name" className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Full Name *
                </Label>
                <Input
                  id="customer_name"
                  value={formData.customer_name}
                  onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
                  placeholder="John Doe"
                  required
                />
              </div>

              <div>
                <Label htmlFor="customer_phone" className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  Phone Number *
                </Label>
                <Input
                  id="customer_phone"
                  type="tel"
                  value={formData.customer_phone}
                  onChange={(e) => setFormData({...formData, customer_phone: e.target.value})}
                  placeholder="(555) 123-4567"
                  required
                />
              </div>
            </div>

            {formConfig?.show_email === true && (
              <div>
                <Label htmlFor="customer_email" className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email (Optional)
                </Label>
                <Input
                  id="customer_email"
                  type="email"
                  value={formData.customer_email}
                  onChange={(e) => setFormData({...formData, customer_email: e.target.value})}
                  placeholder="john@example.com"
                />
              </div>
            )}

            {formConfig?.show_property_address === true && (
              <div>
                <Label htmlFor="property_address" className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Property Address {formConfig?.property_address_required ? '*' : '(Optional)'}
                </Label>
                <Input
                  id="property_address"
                  value={formData.property_address}
                  onChange={(e) => setFormData({...formData, property_address: e.target.value})}
                  placeholder="123 Main St, City, ST 12345"
                  required={formConfig?.property_address_required}
                />
              </div>
            )}

            <div>
              <Label htmlFor="service_type">Service Type *</Label>
              <Select 
                value={formData.service_type} 
                onValueChange={(v) => setFormData({...formData, service_type: v})}
              >
                <SelectTrigger id="service_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(formConfig?.service_types || []).map(st => (
                    <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="preferred_date" className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Preferred Date *
                </Label>
                <Select 
                  value={formData.preferred_date} 
                  onValueChange={(v) => setFormData({...formData, preferred_date: v})}
                  required
                >
                  <SelectTrigger id="preferred_date">
                    <SelectValue placeholder="Select a date..." />
                  </SelectTrigger>
                  <SelectContent>
                    {nextAvailableDates.map(date => (
                      <SelectItem key={date.toISOString()} value={format(date, 'yyyy-MM-dd')}>
                        {format(date, 'EEEE, MMMM d, yyyy')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="preferred_time" className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Preferred Time *
                </Label>
                <Select 
                  value={formData.preferred_time} 
                  onValueChange={(v) => setFormData({...formData, preferred_time: v})}
                  required
                >
                  <SelectTrigger id="preferred_time">
                    <SelectValue placeholder="Select a time..." />
                  </SelectTrigger>
                  <SelectContent>
                    {generateTimeSlots().map(time => (
                      <SelectItem key={time} value={time}>
                        {format(new Date(`2000-01-01T${time}`), 'h:mm a')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formConfig?.show_message === true && (
              <div>
                <Label htmlFor="message">Additional Information (Optional)</Label>
                <Textarea
                  id="message"
                  value={formData.message}
                  onChange={(e) => setFormData({...formData, message: e.target.value})}
                  placeholder="Tell us about your needs or any special requests..."
                  rows={4}
                />
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full bg-gradient-to-r from-blue-600 to-green-600 hover:from-blue-700 hover:to-green-700 text-lg py-6"
              disabled={createAppointmentMutation.isPending}
            >
              {createAppointmentMutation.isPending ? (
                <>
                  <Clock className="w-5 h-5 mr-2 animate-spin" />
                  Booking...
                </>
              ) : (
                <>
                  <Calendar className="w-5 h-5 mr-2" />
                  Book Appointment
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            <p>{formConfig?.confirmation_message || "We'll confirm your appointment within 24 hours"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}