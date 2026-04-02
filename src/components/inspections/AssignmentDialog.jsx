import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Loader2, Send, CheckCircle, UserPlus, Search, Camera, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GoogleAddressAutocomplete } from '@/components/GoogleAddressAutocomplete';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import useTranslation from "@/hooks/useTranslation";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';

const SectionTitle = ({ children }) => (
    <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">{children}</h3>
);

export default function AssignmentDialog({ isOpen, onOpenChange, existingJob = null, onAssignmentSent, prefillCustomer = null, prefillLead = null }) {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [successData, setSuccessData] = useState(null);
    const [contactSource, setContactSource] = useState('new');
    const [selectedLead, setSelectedLead] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [openLeadSearch, setOpenLeadSearch] = useState(false);
    const [openCustomerSearch, setOpenCustomerSearch] = useState(false);
    const [openStormSearch, setOpenStormSearch] = useState(false);
    
    const [user, setUser] = useState(null);

    useEffect(() => {
        base44.auth.me().then(setUser).catch(() => {});
    }, []);

    const [formData, setFormData] = useState({
        property_address: '',
        property_type: 'Residential',
        inspection_type: 'Property Damage Assessment',
        access_instructions: '',
        client_name: '',
        client_phone: '',
        client_email: '',
        assigned_to_email: user?.email || '',
        priority: 'Normal',
        scheduled_date: '',
        inspection_time: '',
        damage_type: '',
        date_of_loss: '',
        insurance_claim_number: '',
        special_instructions: '',
        notes: '',
        status: 'assigned',
        lead_source: 'direct_call',
        ladder_assist_needed: false,
        ladder_assistant_name: '',
        ladder_assist_cost: 100,
        sales_rep_email: '',
        related_estimate_id: '',
        related_storm_event_id: '',
    });

    const [googleMapsApiKey, setGoogleMapsApiKey] = useState('');
    const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false);
    const [createLead, setCreateLead] = useState(true);
    const [createCalendarEvent, setCreateCalendarEvent] = useState(true);
    const [createTask, setCreateTask] = useState(true);
    const [reminderMinutes, setReminderMinutes] = useState([1440, 360, 60]);

    const { data: leads = [] } = useQuery({
        queryKey: ['leads'],
        queryFn: () => base44.entities.Lead.list('-created_date'),
        initialData: [],
    });

    const { data: customers = [] } = useQuery({
        queryKey: ['customers'],
        queryFn: () => base44.entities.Customer.list('-created_date'),
        initialData: [],
    });

    const { data: estimates = [] } = useQuery({
        queryKey: ['estimates'],
        queryFn: () => base44.entities.Estimate.list('-created_date'),
        initialData: [],
    });

    const [searchQuery, setSearchQuery] = useState("");

    const { data: stormEvents = [], isLoading: isLoadingStorms } = useQuery({
        queryKey: ['storm-events-all'],
        queryFn: () => base44.entities.StormEvent.list('-start_time', 5000),
        initialData: [],
    });

    const filteredStorms = React.useMemo(() => {
        if (!searchQuery) return stormEvents;
        const lowerQuery = searchQuery.toLowerCase();
        return stormEvents.filter(storm => {
            const titleMatch = storm.title?.toLowerCase().includes(lowerQuery);
            const areaMatch = storm.affected_areas?.some(area => area.toLowerCase().includes(lowerQuery));
            const dateMatch = storm.start_time && format(new Date(storm.start_time), 'yyyy-MM-dd').includes(lowerQuery);
            return titleMatch || areaMatch || dateMatch;
        });
    }, [stormEvents, searchQuery]);

    useEffect(() => {
        const loadGoogleMaps = async () => {
            // Check if already loaded
            if (window.google?.maps?.places) {
                setGoogleMapsLoaded(true);
                return;
            }

            try {
                const response = await base44.functions.invoke('getGoogleMapsApiKey');
                const { apiKey } = response.data;

                if (!apiKey) {
                    throw new Error('Google Maps API key not configured');
                }

                setGoogleMapsApiKey(apiKey);

                // Load the Google Maps script with ALL libraries (same as AIEstimator)
                const script = document.createElement('script');
                script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry,drawing`;
                script.async = true;
                script.defer = true;

                script.onload = () => {
                    console.log('✅ Google Maps loaded in AssignmentDialog');
                    setGoogleMapsLoaded(true);
                };

                script.onerror = () => {
                    console.error('❌ Failed to load Google Maps in AssignmentDialog');
                };

                document.head.appendChild(script);
            } catch (error) {
                console.error('Error loading Google Maps:', error);
            }
        };

        loadGoogleMaps();
    }, []);

    useEffect(() => {
        if (existingJob) {
            setFormData({
                property_address: existingJob.property_address || '',
                property_type: existingJob.property_type || 'Residential',
                inspection_type: existingJob.inspection_type || 'Property Damage Assessment',
                access_instructions: existingJob.access_instructions || '',
                client_name: existingJob.client_name || '',
                client_phone: existingJob.client_phone || '',
                client_email: existingJob.client_email || '',
                assigned_to_email: existingJob.assigned_to_email || user?.email || '',
                priority: existingJob.priority || 'Normal',
                scheduled_date: existingJob.scheduled_date || '',
                inspection_time: existingJob.inspection_time || '',
                damage_type: existingJob.damage_type || '',
                date_of_loss: existingJob.date_of_loss || '',
                insurance_claim_number: existingJob.insurance_claim_number || '',
                special_instructions: existingJob.special_instructions || '',
                notes: existingJob.notes || '',
                status: existingJob.status || 'assigned',
                lead_source: existingJob.lead_source || 'direct_call',
                ladder_assist_needed: existingJob.ladder_assist_needed || false,
                ladder_assistant_name: existingJob.ladder_assistant_name || '',
                ladder_assist_cost: existingJob.ladder_assist_cost || 100,
                sales_rep_email: existingJob.sales_rep_email || '',
                related_estimate_id: existingJob.related_estimate_id || '',
                related_storm_event_id: existingJob.related_storm_event_id || '',
            });
            
            if (existingJob.related_customer_id) {
                setContactSource('customer');
                const customer = customers.find(c => c.id === existingJob.related_customer_id);
                setSelectedCustomer(customer);
            } else if (existingJob.related_lead_id) {
                setContactSource('lead');
                const lead = leads.find(l => l.id === existingJob.related_lead_id);
                setSelectedLead(lead);
            } else {
                setContactSource('new');
            }
        } else {
            const emptyForm = {
                property_address: '',
                property_type: 'Residential',
                inspection_type: 'Property Damage Assessment',
                access_instructions: '',
                client_name: '',
                client_phone: '',
                client_email: '',
                assigned_to_email: '',
                priority: 'Normal',
                scheduled_date: '',
                inspection_time: '',
                damage_type: '',
                date_of_loss: '',
                insurance_claim_number: '',
                special_instructions: '',
                notes: '',
                status: 'assigned',
                lead_source: 'direct_call',
                ladder_assist_needed: false,
                ladder_assistant_name: '',
                ladder_assist_cost: 100,
                sales_rep_email: '',
                related_estimate_id: '',
                related_storm_event_id: '',
            };
            if (prefillCustomer) {
                const addr = [prefillCustomer.street, prefillCustomer.city, prefillCustomer.state, prefillCustomer.zip].filter(Boolean).join(', ');
                setFormData({ ...emptyForm, client_name: prefillCustomer.name || '', client_phone: prefillCustomer.phone || prefillCustomer.phone_2 || '', client_email: prefillCustomer.email || '', property_address: addr });
                setContactSource('customer');
                setSelectedCustomer(prefillCustomer);
                setSelectedLead(null);
                setCreateLead(false);
            } else if (prefillLead) {
                const addr = [prefillLead.street, prefillLead.city, prefillLead.state, prefillLead.zip].filter(Boolean).join(', ');
                setFormData({ ...emptyForm, client_name: prefillLead.name || '', client_phone: prefillLead.phone || prefillLead.phone_2 || '', client_email: prefillLead.email || '', property_address: addr });
                setContactSource('lead');
                setSelectedLead(prefillLead);
                setSelectedCustomer(null);
                setCreateLead(false);
            } else {
                setFormData(emptyForm);
                setContactSource('new');
                setSelectedLead(null);
                setSelectedCustomer(null);
                setCreateLead(true);
            }
        }
        }, [existingJob, isOpen, customers, leads, user, prefillCustomer, prefillLead]);

    useEffect(() => {
        if (selectedCustomer && contactSource === 'customer') {
            let fullAddress = '';
            if (selectedCustomer.address) {
                fullAddress = selectedCustomer.address;
            } else {
                const parts = [
                    selectedCustomer.street,
                    selectedCustomer.city,
                    selectedCustomer.state,
                    selectedCustomer.zip
                ].filter(Boolean);
                fullAddress = parts.join(', ');
            }

            setFormData(prev => ({
                ...prev,
                client_name: selectedCustomer.name,
                client_phone: selectedCustomer.phone || '',
                client_email: selectedCustomer.email || '',
                property_address: fullAddress,
                insurance_claim_number: selectedCustomer.insurance_claim_number || '',
            }));
            setCreateLead(false);
        }
    }, [selectedCustomer, contactSource]);

    useEffect(() => {
        if (selectedLead && contactSource === 'lead') {
            let fullAddress = '';
            if (selectedLead.address) {
                fullAddress = selectedLead.address;
            } else {
                const parts = [
                    selectedLead.street,
                    selectedLead.city,
                    selectedLead.state,
                    selectedLead.zip
                ].filter(Boolean);
                fullAddress = parts.join(', ');
            }

            setFormData(prev => ({
                ...prev,
                client_name: selectedLead.name,
                client_phone: selectedLead.phone || '',
                client_email: selectedLead.email || '',
                property_address: fullAddress,
                insurance_claim_number: selectedLead.insurance_claim_number || '',
            }));
            setCreateLead(false);
        }
    }, [selectedLead, contactSource]);

    const resolvedCompanyId = (() => {
        try {
            const impersonated = sessionStorage.getItem('impersonating_company_id');
            if (impersonated) return impersonated;
            return localStorage.getItem('last_used_company_id') || null;
        } catch { return null; }
    })();

    const { data: myCompany } = useQuery({
        queryKey: ['myCompany-assignment', resolvedCompanyId],
        queryFn: async () => {
            if (resolvedCompanyId) {
                const companies = await base44.entities.Company.filter({ id: resolvedCompanyId });
                if (companies.length > 0) return companies[0];
            }
            const u = await base44.auth.me();
            if (!u?.email) return null;
            const owned = await base44.entities.Company.filter({ created_by: u.email });
            if (owned.length > 0) return owned[0];
            const profiles = await base44.entities.StaffProfile.filter({ user_email: u.email });
            if (profiles.length > 0) {
                const coms = await base44.entities.Company.filter({ id: profiles[0].company_id });
                return coms[0] || null;
            }
            return null;
        },
        enabled: !!resolvedCompanyId || isOpen,
        staleTime: 5 * 60 * 1000,
    });

    const { data: staffProfiles = [] } = useQuery({
        queryKey: ['staff-profiles-assignment', myCompany?.id],
        queryFn: async () => {
            console.log('[AssignmentDialog] Fetching staff for company:', myCompany?.id);
            const staff = await base44.entities.StaffProfile.filter({ company_id: myCompany?.id }, "-created_date", 200);
            console.log('[AssignmentDialog] Raw staff count:', staff?.length, staff?.map(s => s.full_name || s.name));
            const filtered = (staff || []).filter(s => (s.user_email || s.email) && s.is_active !== false);
            console.log('[AssignmentDialog] Filtered staff count:', filtered.length);
            return filtered;
        },
        enabled: !!myCompany?.id,
    });

    const { data: users = [] } = useQuery({
        queryKey: ['staffUsers'],
        queryFn: () => base44.entities.User.list(),
    });

    const createJobMutation = useMutation({
        mutationFn: async (newJobData) => {
            let job;
            let leadId = selectedLead?.id || null;
            let customerId = selectedCustomer?.id || null;
            let calendarEventId = null;
            let taskId = null;

            try {
                // Resolve company ID first
                let companyId = myCompany?.id;
                const user = await base44.auth.me();
                
                if (!companyId) {
                    const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
                    if (staffProfiles && staffProfiles.length > 0) {
                        companyId = staffProfiles[0].company_id;
                    } else {
                        const companies = await base44.entities.Company.filter({ created_by: user.email });
                        if (companies && companies.length > 0) {
                            companyId = companies[0].id;
                        }
                    }
                }

                const jobDataWithLinks = {
                    ...newJobData,
                    related_lead_id: leadId,
                    related_customer_id: customerId,
                    company_id: companyId,
                    // Mirror scheduled_date → inspection_date so Dashboard weekly panel can find it
                    inspection_date: newJobData.scheduled_date || newJobData.inspection_date || null,
                };

                if (existingJob) {
                    job = await base44.entities.InspectionJob.update(existingJob.id, jobDataWithLinks);
                } else {
                    job = await base44.entities.InspectionJob.create(jobDataWithLinks);
                }

                if (createLead && !existingJob && contactSource === 'new') {
                    try {
                        if (companyId) {
                            const addressParts = newJobData.property_address.split(',').map(s => s.trim());
                            const street = addressParts[0] || '';
                            const city = addressParts[1] || '';
                            const stateZip = addressParts[2] || '';
                            const [state, zip] = stateZip.split(' ').filter(Boolean);

                            // Create Lead with assigned_to set to the creator
                            const lead = await base44.entities.Lead.create({
                                company_id: companyId,
                                name: newJobData.client_name,
                                email: newJobData.client_email || '',
                                phone: newJobData.client_phone || '',
                                street: street || newJobData.property_address,
                                city: city || '',
                                state: state || '',
                                zip: zip || '',
                                status: 'new',
                                source: newJobData.lead_source || 'other',
                                lead_source: `Inspection: ${newJobData.inspection_type}`,
                                notes: `Inspection scheduled for ${newJobData.scheduled_date || 'TBD'}.\nDamage Type: ${newJobData.damage_type || 'TBD'}\nPriority: ${newJobData.priority}`,
                                value: 0,
                                is_active: true,
                                assigned_to: user.email,
                                assigned_to_users: [user.email],
                            });
                            leadId = lead.id;

                            // Also create Customer record with assigned_to set to the creator
                            const customer = await base44.entities.Customer.create({
                                company_id: companyId,
                                name: newJobData.client_name,
                                email: newJobData.client_email || '',
                                phone: newJobData.client_phone || '',
                                street: street || newJobData.property_address,
                                city: city || '',
                                state: state || '',
                                zip: zip || '',
                                source: newJobData.lead_source || 'other',
                                notes: `Created from Inspection: ${newJobData.inspection_type}`,
                                is_active: true,
                                assigned_to: user.email,
                                assigned_to_users: [user.email],
                            });
                            customerId = customer.id;

                            await base44.entities.InspectionJob.update(job.id, {
                                related_lead_id: leadId,
                                related_customer_id: customerId
                            });
                        }
                    } catch (leadError) {
                        console.error('Failed to create lead/customer (non-critical):', leadError);
                    }
                }

                if (createTask && newJobData.scheduled_date) {
                    try {
                        const user = await base44.auth.me();
                        const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
                        let companyId = myCompany?.id;
                        
                        if (!companyId && staffProfiles && staffProfiles.length > 0) {
                            companyId = staffProfiles[0].company_id;
                        }

                        const boards = await base44.entities.TaskBoard.filter({ is_default: true, company_id: companyId });
                        const defaultBoard = boards[0];

                        if (defaultBoard) {
                            const task = await base44.entities.Task.create({
                                name: `Inspection: ${newJobData.client_name} - ${newJobData.property_address}`,
                                description: `Property Damage Assessment\n\nDamage Type: ${newJobData.damage_type || 'TBD'}\nDate of Loss: ${newJobData.date_of_loss || 'Unknown'}\nClaim #: ${newJobData.insurance_claim_number || 'N/A'}\n\n${newJobData.special_instructions || ''}`,
                                board_id: defaultBoard.id,
                                column: defaultBoard.columns[0]?.id || 'not_started',
                                priority: newJobData.priority === 'Urgent' ? 'high' : newJobData.priority === 'High' ? 'high' : 'medium',
                                start_date: newJobData.scheduled_date,
                                due_date: newJobData.scheduled_date,
                                assigned_to: newJobData.assigned_to_email,
                                assignees: newJobData.assigned_to_email ? [{
                                    email: newJobData.assigned_to_email,
                                    name: users.find(u => u.email === newJobData.assigned_to_email)?.full_name || newJobData.assigned_to_email,
                                    avatar: users.find(u => u.email === newJobData.assigned_to_email)?.avatar_url || ''
                                }] : [],
                                related_to: newJobData.client_name,
                                tags: ['inspection', newJobData.damage_type].filter(Boolean),
                                company_id: companyId,
                            });
                            taskId = task.id;

                            await base44.entities.InspectionJob.update(job.id, {
                                related_task_id: taskId
                            });
                        }
                    } catch (taskError) {
                        console.error('Failed to create task (non-critical):', taskError);
                    }
                }

                if (createCalendarEvent && newJobData.scheduled_date) {
                    try {
                        const startDate = new Date(newJobData.scheduled_date + 'T12:00:00');
                        if (newJobData.inspection_time) {
                            const [hours, minutes] = newJobData.inspection_time.split(':');
                            startDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                        }
                        
                        const endDate = new Date(startDate);
                        endDate.setHours(startDate.getHours() + 2);

                        // Include both inspector and creator so it appears in both personal calendars
                        const attendees = [newJobData.assigned_to_email, user.email].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

                        const calendarEvent = await base44.entities.CalendarEvent.create({
                            company_id: companyId,
                            title: `Inspection: ${newJobData.client_name}`,
                            description: `📍 ${newJobData.property_address}\n\n👤 Client: ${newJobData.client_name}\n📞 ${newJobData.client_phone}\n\n🔍 Damage: ${newJobData.damage_type || 'Assessment'}\n⚡ Priority: ${newJobData.priority}\n\n${newJobData.special_instructions ? '📝 Special Instructions:\n' + newJobData.special_instructions : ''}`,
                            start_time: startDate.toISOString(),
                            end_time: endDate.toISOString(),
                            event_type: 'inspection',
                            assigned_to: newJobData.assigned_to_email,
                            attendees: attendees,
                            related_customer: newJobData.client_name,
                            status: 'scheduled',
                            color: '#10b981',
                            send_email_notification: true,
                            email_reminder_minutes: reminderMinutes,
                            send_sms_notification: false,
                            sms_reminder_minutes: reminderMinutes,
                            send_browser_notification: true,
                            browser_reminder_minutes: reminderMinutes,
                        });
                        calendarEventId = calendarEvent.id;

                        await base44.entities.InspectionJob.update(job.id, {
                            calendar_event_id: calendarEventId
                        });
                    } catch (calendarError) {
                        console.error('Failed to create calendar event (non-critical):', calendarError);
                    }
                }

                try {
                    const emailResult = await base44.functions.invoke('sendInspectionAssignment', {
                        jobId: job.id,
                        inspectorEmail: newJobData.assigned_to_email
                    });
                    console.log('✅ Email result:', emailResult);
                } catch (emailError) {
                    console.error('❌ Failed to send assignment email:', emailError);
                    alert(`⚠️ Assignment created but emails failed to send: ${emailError.message || 'Unknown error'}\n\nPlease manually notify the inspector.`);
                }

                return { job, leadId, customerId, calendarEventId, taskId };
            } catch (error) {
                console.error('Error creating inspection job:', error);
                throw error;
            }
        },
        onSuccess: (data) => {
            const extras = [];
            if (data.leadId && contactSource === 'new') extras.push('Lead created in CRM');
            if (data.taskId) extras.push('Task created');
            if (data.calendarEventId) extras.push('Added to calendar');
            if (selectedLead) extras.push(`Linked to: ${selectedLead.name}`);
            if (selectedCustomer) extras.push(`Linked to: ${selectedCustomer.name}`);
            setSuccessData({ job: data.job, extras });
            onAssignmentSent(data.job);
        },
        onError: (error) => {
            console.error('Assignment error:', error);
            alert('❌ Failed to create assignment: ' + (error.message || 'Unknown error'));
        }
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!formData.assigned_to_email) {
            alert('Please select an inspector to assign.');
            return;
        }
        createJobMutation.mutate(formData);
    };

    const handleInputChange = (e) => {
        const { id, value } = e.target;
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleSelectChange = (id, value) => {
        setFormData(prev => ({...prev, [id]: value}));
    };
    
    const handlePlaceSelected = (address) => {
        setFormData(prev => ({ ...prev, property_address: address }));
    };

    const handleInteractOutside = (e) => {
        const target = e.target;
        if (target.closest('.pac-container')) {
            e.preventDefault();
        }
    };

    const suggestedEstimates = estimates.filter(est =>
        est.customer_name?.toLowerCase().includes(formData.client_name?.toLowerCase() || '') ||
        est.property_address?.toLowerCase().includes(formData.property_address?.toLowerCase() || '')
    );

    const linkedEstimate = estimates.find(e => e.id === formData.related_estimate_id);
    const linkedStorm = stormEvents.find(s => s.id === formData.related_storm_event_id);

    const handleClose = () => {
        setSuccessData(null);
        onOpenChange(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose} modal={true}>
            <DialogContent 
                className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
                onInteractOutside={handleInteractOutside}
            >
                {successData ? (
                    <div className="flex flex-col items-center justify-center py-10 px-6 text-center space-y-6">
                        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                            <CheckCircle className="w-10 h-10 text-green-600" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-1">Assignment Sent!</h2>
                            <p className="text-gray-500 text-sm">The inspector has been notified by email and admin has been alerted.</p>
                        </div>
                        {successData.extras.length > 0 && (
                            <div className="bg-gray-50 rounded-lg px-6 py-3 text-left w-full max-w-sm">
                                {successData.extras.map((e, i) => (
                                    <div key={i} className="flex items-center gap-2 py-1 text-sm text-gray-700">
                                        <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                        {e}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm pt-2">
                            <Button
                                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-2"
                                onClick={() => {
                                    handleClose();
                                    navigate(createPageUrl('InspectionCapture') + `?jobId=${successData.job.id}`);
                                }}
                            >
                                <Camera className="w-4 h-4" />
                                Start Capturing Photos
                            </Button>
                            <Button
                                variant="outline"
                                className="flex-1 gap-2"
                                onClick={handleClose}
                            >
                                {t.common.completed}
                                <ArrowRight className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                ) : (
                <>
                <DialogHeader>
                    <DialogTitle>{existingJob ? t.common.edit : t.common.send || 'Send'} Inspector Assignment</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6 overflow-y-auto px-1">
                    {!existingJob && (
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border-2 border-blue-200">
                            <SectionTitle>🔗 Link to CRM</SectionTitle>
                            <RadioGroup value={contactSource} onValueChange={setContactSource}>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="flex items-center space-x-2 p-3 bg-white rounded border hover:border-blue-400 transition-colors">
                                        <RadioGroupItem value="new" id="new" />
                                        <Label htmlFor="new" className="cursor-pointer flex-1">
                                            <div className="font-semibold">New Contact</div>
                                            <div className="text-xs text-gray-500">Create new lead</div>
                                        </Label>
                                    </div>
                                    <div className="flex items-center space-x-2 p-3 bg-white rounded border hover:border-blue-400 transition-colors">
                                        <RadioGroupItem value="lead" id="lead" />
                                        <Label htmlFor="lead" className="cursor-pointer flex-1">
                                            <div className="font-semibold">{t.leads.title}</div>
                                            <div className="text-xs text-gray-500">{t.common.select} from CRM</div>
                                        </Label>
                                    </div>
                                    <div className="flex items-center space-x-2 p-3 bg-white rounded border hover:border-blue-400 transition-colors">
                                        <RadioGroupItem value="customer" id="customer" />
                                        <Label htmlFor="customer" className="cursor-pointer flex-1">
                                            <div className="font-semibold">{t.customers.title}</div>
                                            <div className="text-xs text-gray-500">{t.common.select} from CRM</div>
                                        </Label>
                                    </div>
                                </div>
                            </RadioGroup>

                            {contactSource === 'lead' && (
                                <div className="mt-4">
                                    <Label>{t.common.select} {t.leads.title}</Label>
                                    <Popover open={openLeadSearch} onOpenChange={setOpenLeadSearch}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                className="w-full justify-between"
                                            >
                                                {selectedLead ? selectedLead.name : t.leads.searchLeads}
                                                <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-full p-0">
                                            <Command>
                                                <CommandInput placeholder={t.leads.searchLeads} />
                                                <CommandEmpty>{t.leads.noLeads}</CommandEmpty>
                                                <CommandGroup className="max-h-64 overflow-y-auto">
                                                    {leads.map((lead) => (
                                                        <CommandItem
                                                            key={lead.id}
                                                            onSelect={() => {
                                                                setSelectedLead(lead);
                                                                setOpenLeadSearch(false);
                                                            }}
                                                        >
                                                            <div className="flex flex-col items-start">
                                                                <span className="font-semibold">{lead.name}</span>
                                                                <span className="text-xs text-gray-500">{lead.phone} • {lead.email}</span>
                                                                <span className="text-xs text-gray-400">{lead.street}, {lead.city}</span>
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    {selectedLead && (
                                        <Alert className="mt-2 bg-green-50 border-green-300">
                                            <CheckCircle className="h-4 w-4 text-green-600" />
                                            <AlertDescription className="text-green-800">
                                                ✅ {t.leads.title} {t.common.selected}: {selectedLead.name} - Fields auto-populated!
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                </div>
                            )}

                            {contactSource === 'customer' && (
                                <div className="mt-4">
                                    <Label>{t.common.select} {t.customers.title}</Label>
                                    <Popover open={openCustomerSearch} onOpenChange={setOpenCustomerSearch}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                className="w-full justify-between"
                                            >
                                                {selectedCustomer ? selectedCustomer.name : t.customers.searchCustomers}
                                                <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-full p-0">
                                            <Command>
                                                <CommandInput placeholder={t.customers.searchCustomers} />
                                                <CommandEmpty>{t.customers.noCustomers}</CommandEmpty>
                                                <CommandGroup className="max-h-64 overflow-y-auto">
                                                    {customers.map((customer) => (
                                                        <CommandItem
                                                            key={customer.id}
                                                            onSelect={() => {
                                                                setSelectedCustomer(customer);
                                                                setOpenCustomerSearch(false);
                                                            }}
                                                        >
                                                            <div className="flex flex-col items-start">
                                                                <span className="font-semibold">{customer.name}</span>
                                                                <span className="text-xs text-gray-500">{customer.phone} • {customer.email}</span>
                                                                <span className="text-xs text-gray-400">{customer.street}, {customer.city}</span>
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    {selectedCustomer && (
                                        <Alert className="mt-2 bg-green-50 border-green-300">
                                            <CheckCircle className="h-4 w-4 text-green-600" />
                                            <AlertDescription className="text-green-800">
                                                ✅ {t.customers.title} {t.common.selected}: {selectedCustomer.name} - Fields auto-populated!
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <SectionTitle>Site Information</SectionTitle>
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <Label htmlFor="property_address">{t.inspections.propertyAddress} *</Label>
                                    {googleMapsLoaded ? (
                                        <GoogleAddressAutocomplete
                                            onAddressSelect={(address, details) => {
                                                setFormData(prev => ({ ...prev, property_address: address }));
                                            }}
                                            placeholder="Enter the inspection site address..."
                                            initialAddress={formData.property_address}
                                            key={`address-${selectedLead?.id || selectedCustomer?.id || 'new'}`}
                                        />
                                    ) : (
                                        <Input 
                                            id="property_address"
                                            value={formData.property_address}
                                            onChange={(e) => setFormData(prev => ({ ...prev, property_address: e.target.value }))}
                                            placeholder={t.common.loading}
                                            disabled
                                        />
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="property_type">{t.inspections.roofType}</Label>
                                    <Select value={formData.property_type} onValueChange={(v) => handleSelectChange('property_type', v)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Residential">Residential</SelectItem>
                                            <SelectItem value="Commercial">Commercial</SelectItem>
                                            <SelectItem value="Multi-Family">Multi-Family</SelectItem>
                                            <SelectItem value="Industrial">Industrial</SelectItem>
                                            <SelectItem value="Other">Other</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label htmlFor="inspection_type">Inspection Type *</Label>
                                    <Input id="inspection_type" value={formData.inspection_type} onChange={handleInputChange} required />
                                </div>
                            </div>
                             <div>
                                <Label htmlFor="access_instructions">Access Instructions</Label>
                                <Textarea id="access_instructions" placeholder="Gate codes, key location, contact for access, parking instructions..." value={formData.access_instructions} onChange={handleInputChange} />
                            </div>
                        </div>
                    </div>

                    <div>
                        <SectionTitle>Property Contact Information</SectionTitle>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <Label htmlFor="client_name">{t.inspections.clientName} *</Label>
                                <Input id="client_name" placeholder="Property owner/manager name" value={formData.client_name} onChange={handleInputChange} required />
                            </div>
                            <div>
                                <Label htmlFor="client_phone">{t.inspections.clientPhone} *</Label>
                                <Input id="client_phone" type="tel" placeholder="(555) 123-4567" value={formData.client_phone} onChange={handleInputChange} required />
                            </div>
                            <div>
                                <Label htmlFor="client_email">{t.inspections.clientEmail}</Label>
                                <Input id="client_email" type="email" placeholder="contact@example.com" value={formData.client_email} onChange={handleInputChange} />
                            </div>
                        </div>
                    </div>

                    <div>
                        <SectionTitle>Inspector Assignment</SectionTitle>
                        <Label htmlFor="assigned_to_email">{t.common.select} Vetted Inspector</Label>
                        <Select 
                            value={formData.assigned_to_email} 
                            onValueChange={(v) => handleSelectChange('assigned_to_email', v)}
                        >
                            <SelectTrigger id="assigned_to_email">
                                <SelectValue placeholder="Choose an inspector..." />
                            </SelectTrigger>
                            <SelectContent>
                                {staffProfiles.map((staff) => (
                                    <SelectItem key={staff.id} value={staff.user_email || staff.email}>
                                        {staff.full_name || staff.name} ({staff.user_email || staff.email})
                                    </SelectItem>
                                ))}
                                {staffProfiles.length === 0 && (
                                    <SelectItem value="none" disabled>No staff members found</SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <SectionTitle>Assignment Details</SectionTitle>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <Label htmlFor="priority">{t.tasks.priority}</Label>
                                <Select value={formData.priority} onValueChange={(v) => handleSelectChange('priority', v)}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Low">{t.tasks.low}</SelectItem>
                                        <SelectItem value="Normal">{t.tasks.medium}</SelectItem>
                                        <SelectItem value="High">{t.tasks.high}</SelectItem>
                                        <SelectItem value="Urgent">Urgent</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                             <div>
                                <Label htmlFor="scheduled_date">{t.common.date}</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant={"outline"}
                                            className="w-full justify-start text-left font-normal"
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {formData.scheduled_date ? format(new Date(formData.scheduled_date + 'T12:00:00'), "PPP") : <span>{t.common.select} {t.common.date}</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={formData.scheduled_date ? new Date(formData.scheduled_date + 'T12:00:00') : undefined}
                                            onSelect={(date) => handleSelectChange('scheduled_date', date ? format(date, 'yyyy-MM-dd') : '')}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div>
                                <Label htmlFor="inspection_time">Inspection Time</Label>
                                <Input id="inspection_time" type="time" value={formData.inspection_time} onChange={handleInputChange} />
                            </div>
                        </div>
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                            <div>
                                <Label htmlFor="damage_type">{t.inspections.damageAssessment}</Label>
                                <Input id="damage_type" placeholder="Wind, Hail, Water, Fire, etc." value={formData.damage_type} onChange={handleInputChange} />
                            </div>
                            <div>
                                <Label htmlFor="date_of_loss">Date of Loss</Label>
                                <Input id="date_of_loss" type="date" value={formData.date_of_loss} onChange={handleInputChange} />
                            </div>
                             <div>
                                <Label htmlFor="insurance_claim_number">{t.inspections.claimNumber}</Label>
                                <Input id="insurance_claim_number" placeholder="Claim reference number" value={formData.insurance_claim_number} onChange={handleInputChange} />
                            </div>
                        </div>
                        <div className="mt-4">
                            <Label htmlFor="lead_source">Lead Source</Label>
                            <Select value={formData.lead_source} onValueChange={(v) => handleSelectChange('lead_source', v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="website">Website</SelectItem>
                                    <SelectItem value="referral">Referral</SelectItem>
                                    <SelectItem value="social_media">Social Media</SelectItem>
                                    <SelectItem value="storm_tracker">Storm Tracker</SelectItem>
                                    <SelectItem value="property_importer">Property Importer</SelectItem>
                                    <SelectItem value="direct_call">Direct Call</SelectItem>
                                    <SelectItem value="walk_in">Walk-in</SelectItem>
                                    <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="mt-4">
                            <Label htmlFor="special_instructions">Special Instructions</Label>
                            <Textarea id="special_instructions" placeholder="Specific areas to focus on, safety concerns, equipment needed..." value={formData.special_instructions} onChange={handleInputChange} />
                        </div>
                    </div>

                    {/* NEW: Link Estimate & Storm Event */}
                    <div>
                        <SectionTitle>🔗 Link Estimate & Storm Data</SectionTitle>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="related_estimate_id">Link Xactimate Estimate</Label>
                                <Select 
                                    value={formData.related_estimate_id || 'none'} 
                                    onValueChange={(v) => handleSelectChange('related_estimate_id', v === 'none' ? '' : v)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="No estimate linked" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">{t.common.none}</SelectItem>
                                        {suggestedEstimates.length > 0 && (
                                            <>
                                                <div className="px-2 py-1.5 text-xs font-semibold text-blue-600">🎯 Suggested</div>
                                                {suggestedEstimates.map(est => (
                                                    <SelectItem key={est.id} value={est.id}>
                                                        {est.estimate_number} - {est.customer_name} (${Number(est.amount || 0).toFixed(2)})
                                                    </SelectItem>
                                                ))}
                                                <div className="px-2 py-1.5 text-xs font-semibold text-gray-600 border-t mt-1">All Estimates</div>
                                            </>
                                        )}
                                        {estimates.filter(e => !suggestedEstimates.includes(e)).map(est => (
                                            <SelectItem key={est.id} value={est.id}>
                                                {est.estimate_number} - {est.customer_name} (${Number(est.amount || 0).toFixed(2)})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {linkedEstimate && (
                                    <Alert 
                                        className="mt-2 bg-green-50 border-green-300 cursor-pointer hover:bg-green-100 transition-colors" 
                                        onClick={() => window.open(createPageUrl('EstimateEditor') + `?id=${linkedEstimate.id}`, '_blank')}
                                    >
                                        <CheckCircle className="h-4 w-4 text-green-600" />
                                        <AlertDescription className="text-green-800 flex items-center justify-between">
                                            <span>✅ {linkedEstimate.estimate_number} - ${Number(linkedEstimate.amount || 0).toFixed(2)}</span>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                        </AlertDescription>
                                    </Alert>
                                )}
                            </div>

                            <div>
                                <Label>Link Storm Event</Label>
                                <Popover open={openStormSearch} onOpenChange={setOpenStormSearch}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            role="combobox"
                                            aria-expanded={openStormSearch}
                                            className="w-full justify-between h-auto py-2"
                                        >
                                            {linkedStorm ? (
                                                <div className="flex flex-col items-start text-left overflow-hidden w-full">
                                                     <span className="font-medium truncate w-full">{linkedStorm.title}</span>
                                                     <span className="text-xs text-muted-foreground truncate w-full">
                                                        {format(new Date(linkedStorm.start_time), 'MMM d, yyyy')} • {linkedStorm.affected_areas?.slice(0, 3).join(', ')}{linkedStorm.affected_areas?.length > 3 ? '...' : ''}
                                                     </span>
                                                </div>
                                            ) : (
                                                "Select storm event..."
                                            )}
                                            <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[400px] p-0" align="start">
                                        <Command shouldFilter={false}>
                                            <CommandInput 
                                                placeholder="Search storm or city..." 
                                                value={searchQuery}
                                                onValueChange={setSearchQuery}
                                            />
                                            <CommandList>
                                                {isLoadingStorms ? (
                                                    <div className="py-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        {t.common.loading}
                                                    </div>
                                                ) : (
                                                    <>
                                                        <CommandEmpty>{t.common.noResults}</CommandEmpty>
                                                        <CommandGroup>
                                                            <CommandItem
                                                                value="none"
                                                                onSelect={() => {
                                                                    handleSelectChange('related_storm_event_id', '');
                                                                    setOpenStormSearch(false);
                                                                }}
                                                            >
                                                                {t.common.none}
                                                            </CommandItem>
                                                            {filteredStorms.map((storm) => (
                                                                <CommandItem
                                                            key={storm.id}
                                                            value={storm.id}
                                                            onSelect={() => {
                                                                handleSelectChange('related_storm_event_id', storm.id);
                                                                setOpenStormSearch(false);
                                                            }}
                                                        >
                                                            <div className="flex flex-col w-full">
                                                                <div className="flex justify-between items-center">
                                                                    <span className="font-semibold">{storm.title}</span>
                                                                    <span className="text-xs text-muted-foreground">{format(new Date(storm.start_time), 'MMM d, yyyy')}</span>
                                                                </div>
                                                                <div className="text-xs text-gray-600 mt-1">
                                                                    {storm.affected_areas?.join(', ')}
                                                                </div>
                                                                <div className="flex gap-2 mt-1">
                                                                    {storm.hail_size_inches > 0 && (
                                                                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-blue-200 bg-blue-50 text-blue-700">
                                                                            {storm.hail_size_inches}" Hail
                                                                        </Badge>
                                                                    )}
                                                                    {storm.wind_speed_mph > 0 && (
                                                                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-orange-200 bg-orange-50 text-orange-700">
                                                                            {storm.wind_speed_mph} mph Wind
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {formData.related_storm_event_id === storm.id && (
                                                                <CheckCircle className="ml-auto h-4 w-4 text-primary opacity-50" />
                                                            )}
                                                        </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    </>
                                                )}
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                {linkedStorm && (
                                    <Alert 
                                        className="mt-2 bg-orange-50 border-orange-300 cursor-pointer hover:bg-orange-100 transition-colors" 
                                        onClick={() => window.open(createPageUrl('StormReport') + `?id=${linkedStorm.id}`, '_blank')}
                                    >
                                        <CheckCircle className="h-4 w-4 text-orange-600" />
                                        <AlertDescription className="text-orange-800">
                                            <div className="flex items-center justify-between">
                                                <div className="flex-1">
                                                    <div>⚡ {linkedStorm.title}
                                                    {linkedStorm.start_time && ` (${format(new Date(linkedStorm.start_time), 'MMM d, yyyy')})`}</div>
                                                    <div className="text-xs mt-1 text-orange-700/80">
                                                        📍 {linkedStorm.affected_areas?.join(', ')}
                                                    </div>
                                                </div>
                                                <svg className="w-4 h-4 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                </svg>
                                            </div>
                                        </AlertDescription>
                                    </Alert>
                                )}
                                {stormEvents.length === 0 && (
                                    <p className="text-xs text-gray-500 mt-1">
                                        No active storms. Track storms in Storm Tracker.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <SectionTitle>Ladder Assistant</SectionTitle>
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                            <div className="flex items-start gap-3 mb-3">
                                <Checkbox 
                                    id="ladder_assist_needed"
                                    checked={formData.ladder_assist_needed}
                                    onCheckedChange={(checked) => setFormData({...formData, ladder_assist_needed: checked})}
                                />
                                <div className="flex-1">
                                    <label htmlFor="ladder_assist_needed" className="font-medium text-gray-900 cursor-pointer">
                                        {t.inspections.ladderAssistNeeded}
                                    </label>
                                    <p className="text-xs text-gray-600 mt-1">
                                        {t.inspections.ladderAssistNote}
                                    </p>
                                </div>
                            </div>

                            {formData.ladder_assist_needed && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pl-7">
                                    <div>
                                        <Label htmlFor="ladder_assistant_name">Assistant Name ({t.common.optional})</Label>
                                        <Input 
                                            id="ladder_assistant_name" 
                                            placeholder="Who is helping?" 
                                            value={formData.ladder_assistant_name} 
                                            onChange={handleInputChange} 
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor="ladder_assist_cost">{t.common.amount} (Default $100)</Label>
                                        <Input 
                                            id="ladder_assist_cost" 
                                            type="number" 
                                            step="0.01"
                                            value={formData.ladder_assist_cost} 
                                            onChange={handleInputChange} 
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <Label htmlFor="sales_rep_email">Sales Rep (Paying for Assist)</Label>
                                        <Select 
                                            value={formData.sales_rep_email || formData.assigned_to_email} 
                                            onValueChange={(v) => handleSelectChange('sales_rep_email', v)}
                                        >
                                            <SelectTrigger><SelectValue placeholder="Select sales rep..." /></SelectTrigger>
                                            <SelectContent>
                                                {staffProfiles.map(staff => <SelectItem key={staff.id} value={staff.user_email || staff.email}>{staff.full_name || staff.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-gray-500 mt-1">
                                            Defaults to assigned inspector. Change if a different sales rep is paying.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div>
                        <SectionTitle>{t.common.notes}</SectionTitle>
                         <Textarea id="notes" placeholder="Any additional information, context, or requirements for this inspection..." value={formData.notes} onChange={handleInputChange} />
                    </div>

                    {!existingJob && (
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                            <h4 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                                <UserPlus className="w-5 h-5" />
                                Auto-create CRM Actions
                            </h4>
                            <div className="space-y-3">
                                {contactSource === 'new' && (
                                    <div className="flex items-center space-x-2">
                                        <Checkbox 
                                            id="createLead" 
                                            checked={createLead}
                                            onCheckedChange={setCreateLead}
                                        />
                                        <label
                                            htmlFor="createLead"
                                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                        >
                                            {t.inspections.createLeadInCRM}
                                        </label>
                                    </div>
                                )}
                                <div className="flex items-center space-x-2">
                                    <Checkbox 
                                        id="createTask" 
                                        checked={createTask}
                                        onCheckedChange={setCreateTask}
                                    />
                                    <label
                                        htmlFor="createTask"
                                        className="text-sm font-medium leading-none"
                                    >
                                        {t.inspections.createInspectionTask}
                                    </label>
                                </div>
                                {!formData.scheduled_date && (
                                    <p className="text-xs text-amber-600 ml-6">⚠️ {t.inspections.scheduledDateRequired}</p>
                                )}
                                <div className="flex items-center space-x-2">
                                    <Checkbox 
                                        id="createCalendarEvent" 
                                        checked={createCalendarEvent}
                                        onCheckedChange={setCreateCalendarEvent}
                                    />
                                    <label
                                        htmlFor="createCalendarEvent"
                                        className="text-sm font-medium leading-none"
                                    >
                                        {t.common.add} to {t.sidebar.calendar} ({t.inspections.preventsDoubleBooking})
                                    </label>
                                </div>
                                {!formData.scheduled_date && (
                                    <p className="text-xs text-amber-600 ml-6">⚠️ A scheduled date is required to add a calendar event.</p>
                                )}
                                {createCalendarEvent && (
                                    <div className="ml-6 mt-2 space-y-1">
                                        <p className="text-xs font-medium text-gray-600">Reminders (before inspection)</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {[
                                                { label: '24h', minutes: 1440 },
                                                { label: '6h',  minutes: 360  },
                                                { label: '1h',  minutes: 60   },
                                                { label: '30m', minutes: 30   },
                                                { label: '15m', minutes: 15   },
                                            ].map(({ label, minutes }) => {
                                                const active = reminderMinutes.includes(minutes);
                                                return (
                                                    <button
                                                        key={minutes}
                                                        type="button"
                                                        data-testid={`reminder-toggle-${minutes}`}
                                                        onClick={() => setReminderMinutes(prev =>
                                                            active ? prev.filter(m => m !== minutes) : [...prev, minutes].sort((a, b) => b - a)
                                                        )}
                                                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                                                            active
                                                                ? 'bg-blue-600 text-white border-blue-600'
                                                                : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                                                        }`}
                                                    >
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {reminderMinutes.length === 0 && (
                                            <p className="text-xs text-amber-600">Select at least one reminder time.</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                </form>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={handleClose}>{t.common.cancel}</Button>
                    <Button type="button" onClick={handleSubmit} disabled={createJobMutation.isPending}>
                        {createJobMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        {existingJob ? t.common.update : t.common.send || 'Send'} Assignment
                    </Button>
                </DialogFooter>
                </>
                )}
            </DialogContent>
        </Dialog>
    );
}