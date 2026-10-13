import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getLastUsedCompanyId } from '@/lib/activeCompanySelection';
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
import { Calendar as CalendarIcon, Loader2, Send, CheckCircle, UserPlus, Search, Camera, ArrowRight, Plus, X } from 'lucide-react';
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
    const queryClient = useQueryClient();
    const [successData, setSuccessData] = useState(null);
    const [contactSource, setContactSource] = useState('new');
    const [selectedLead, setSelectedLead] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [openLeadSearch, setOpenLeadSearch] = useState(false);
    const [openCustomerSearch, setOpenCustomerSearch] = useState(false);
    const [openStormSearch, setOpenStormSearch] = useState(false);
    const [showNewSourceInput, setShowNewSourceInput] = useState(false);
    const [newSourceName, setNewSourceName] = useState('');
    
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
        storm_context: '',
        special_instructions: '',
        notes: '',
        status: 'assigned',
        lead_source: 'direct_call',
        ladder_assist_needed: false,
        ladder_assistant_name: '',
        ladder_assistant_email: '',
        ladder_assist_cost: 100,
        ladder_assistant_grant_access: false,
        drone_pilot_needed: false,
        drone_pilot_name: '',
        drone_pilot_email: '',
        drone_pilot_cost: 150,
        drone_pilot_grant_access: false,
        sales_rep_email: '',
        related_estimate_id: '',
        related_storm_event_id: '',
    });

    const [googleMapsApiKey, setGoogleMapsApiKey] = useState('');
    const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false);
    const [createLead, setCreateLead] = useState(true);
    const [sendCustomerReminders, setSendCustomerReminders] = useState(false);
    const [createCalendarEvent, setCreateCalendarEvent] = useState(true);
    const [createTask, setCreateTask] = useState(true);
    const [reminderMinutes, setReminderMinutes] = useState([1440, 360, 60]);

    const { data: leads = [] } = useQuery({
        queryKey: ['leads'],
        queryFn: () => base44.entities.Lead.list('-created_date'),
    });

    const { data: customers = [] } = useQuery({
        queryKey: ['customers'],
        queryFn: () => base44.entities.Customer.list('-created_date'),
    });

    const { data: estimates = [] } = useQuery({
        queryKey: ['estimates'],
        queryFn: () => base44.entities.Estimate.list('-created_date'),
    });

    const [searchQuery, setSearchQuery] = useState("");

    // Storm events are stored under a global master company_id — use the
    // listStormEvents handler to bypass the SDK's auto-scoped company filter.
    const { data: stormEvents = [], isLoading: isLoadingStorms } = useQuery({
        queryKey: ['storm-events-all'],
        queryFn: async () => {
            const res = await base44.functions.invoke('listStormEvents', { limit: 500 });
            return res?.data?.storms ?? res?.storms ?? [];
        },
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
                script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
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
                storm_context: existingJob.storm_context || '',
                special_instructions: existingJob.special_instructions || '',
                notes: existingJob.notes || '',
                status: existingJob.status || 'assigned',
                lead_source: existingJob.lead_source || 'direct_call',
                ladder_assist_needed: existingJob.ladder_assist_needed || false,
                ladder_assistant_name: existingJob.ladder_assistant_name || '',
                ladder_assistant_email: existingJob.ladder_assistant_email || '',
                ladder_assist_cost: existingJob.ladder_assist_cost || 100,
                ladder_assistant_grant_access: existingJob.ladder_assistant_grant_access || false,
                drone_pilot_needed: existingJob.drone_pilot_needed || false,
                drone_pilot_name: existingJob.drone_pilot_name || '',
                drone_pilot_email: existingJob.drone_pilot_email || '',
                drone_pilot_cost: existingJob.drone_pilot_cost || 150,
                drone_pilot_grant_access: existingJob.drone_pilot_grant_access || false,
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
                storm_context: '',
                special_instructions: '',
                notes: '',
                status: 'assigned',
                lead_source: 'direct_call',
                ladder_assist_needed: false,
                ladder_assistant_name: '',
                ladder_assistant_email: '',
                ladder_assist_cost: 100,
                ladder_assistant_grant_access: false,
                drone_pilot_needed: false,
                drone_pilot_name: '',
                drone_pilot_email: '',
                drone_pilot_cost: 150,
                drone_pilot_grant_access: false,
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
                insurance_claim_number: selectedCustomer.claim_number || selectedCustomer.insurance_claim_number || '',
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
                insurance_claim_number: selectedLead.claim_number || selectedLead.insurance_claim_number || '',
            }));
            setCreateLead(false);
        }
    }, [selectedLead, contactSource]);

    const resolvedCompanyId = (() => {
        try {
            const impersonated = sessionStorage.getItem('impersonating_company_id');
            if (impersonated) return impersonated;
            return getLastUsedCompanyId();
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

    const { data: inspectorProfiles = [] } = useQuery({
        queryKey: ['inspector-profiles-assignment', myCompany?.id],
        queryFn: () => base44.entities.InspectorProfile.filter({ company_id: myCompany?.id }, "-created_date", 200),
        enabled: !!myCompany?.id,
    });

    const allPilotOptions = [
        ...staffProfiles.map(s => ({
            id: `staff-${s.id}`,
            email: s.user_email || s.email,
            full_name: s.full_name || s.name,
        })),
        ...inspectorProfiles
            .filter(p => p.email && p.is_active !== false)
            .map(p => ({
                id: `inspector-${p.id}`,
                email: p.email,
                full_name: p.full_name || p.name,
            })),
    ];

    const { data: users = [] } = useQuery({
        queryKey: ['staffUsers'],
        queryFn: () => base44.entities.User.list(),
    });

    const { data: customLeadSources = [] } = useQuery({
        queryKey: ['leadSources', myCompany?.id],
        queryFn: () => base44.entities.LeadSource.filter({ company_id: myCompany?.id }),
        enabled: !!myCompany?.id,
    });

    const addLeadSourceMutation = useMutation({
        mutationFn: (name) => base44.entities.LeadSource.create({
            name,
            company_id: myCompany?.id,
            display_order: customLeadSources.length,
        }),
        onSuccess: (created) => {
            queryClient.invalidateQueries({ queryKey: ['leadSources', myCompany?.id] });
            setFormData(prev => ({ ...prev, lead_source: created.name }));
            setNewSourceName('');
            setShowNewSourceInput(false);
        },
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

                    // Sync assigned_to on linked lead and customer when reassigning
                    if (newJobData.assigned_to_email) {
                        const syncAssign = { assigned_to: newJobData.assigned_to_email };
                        try {
                            if (existingJob.related_lead_id) {
                                const lead = await base44.entities.Lead.get(existingJob.related_lead_id);
                                if (lead) {
                                    const existingUsers = lead.assigned_to_users || [];
                                    const updatedUsers = existingUsers.includes(newJobData.assigned_to_email) ? existingUsers : [...existingUsers, newJobData.assigned_to_email];
                                    await base44.entities.Lead.update(lead.id, { ...syncAssign, assigned_to_users: updatedUsers });
                                }
                            }
                        } catch (e) { console.error('Failed to sync lead assignment:', e); }
                        try {
                            if (existingJob.related_customer_id) {
                                const cust = await base44.entities.Customer.get(existingJob.related_customer_id);
                                if (cust) {
                                    const existingUsers = cust.assigned_to_users || [];
                                    const updatedUsers = existingUsers.includes(newJobData.assigned_to_email) ? existingUsers : [...existingUsers, newJobData.assigned_to_email];
                                    await base44.entities.Customer.update(cust.id, { ...syncAssign, assigned_to_users: updatedUsers });
                                }
                            }
                        } catch (e) { console.error('Failed to sync customer assignment:', e); }
                        try {
                            if (existingJob.related_task_id) {
                                await base44.entities.Task.update(existingJob.related_task_id, {
                                    assigned_to: newJobData.assigned_to_email,
                                    assignees: [{ email: newJobData.assigned_to_email, name: newJobData.assigned_to_email }],
                                });
                            }
                        } catch (e) { console.error('Failed to sync task assignment:', e); }
                    }
                } else {
                    job = await base44.entities.InspectionJob.create(jobDataWithLinks);

                    // Auto-create CalendarEvent so the inspection appears on the calendar immediately
                    try {
                        const dateStr = newJobData.scheduled_date || newJobData.inspection_date;
                        if (dateStr && companyId) {
                            const startDate = new Date(dateStr + 'T12:00:00');
                            if (newJobData.inspection_time) {
                                const [h, m] = newJobData.inspection_time.split(':');
                                startDate.setHours(parseInt(h), parseInt(m), 0, 0);
                            }
                            const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

                            const calEvent = await base44.entities.CalendarEvent.create({
                                company_id: companyId,
                                title: `Inspection: ${newJobData.client_name || newJobData.property_address}`,
                                description: `📍 ${newJobData.property_address || ''}\n👤 Client: ${newJobData.client_name || ''}\n📞 ${newJobData.client_phone || ''}\n🔍 Damage: ${newJobData.damage_type || 'Assessment'}\n⚡ Priority: ${newJobData.priority || 'Normal'}`,
                                start_time: startDate.toISOString(),
                                end_time: endDate.toISOString(),
                                event_type: 'inspection',
                                assigned_to: newJobData.assigned_to_email || user?.email,
                                location: newJobData.property_address || '',
                                related_customer: newJobData.client_name || '',
                                customer_name: newJobData.client_name || '',
                                customer_email: newJobData.client_email || '',
                                customer_phone: newJobData.client_phone || '',
                                send_customer_reminders: sendCustomerReminders || false,
                                status: 'scheduled',
                                color: '#10b981',
                            });
                            await base44.entities.InspectionJob.update(job.id, { calendar_event_id: calEvent.id });
                            job = { ...job, calendar_event_id: calEvent.id };
                        }
                    } catch (calErr) {
                        console.warn('[AssignmentDialog] Auto-calendar failed (non-blocking):', calErr?.message);
                    }
                }

                if (createLead && !existingJob && contactSource === 'new') {
                    try {
                        if (companyId) {
                            const addressParts = newJobData.property_address.split(',').map(s => s.trim());
                            const street = addressParts[0] || '';
                            const city = addressParts[1] || '';
                            const stateZip = addressParts[2] || '';
                            const [state, zip] = stateZip.split(' ').filter(Boolean);

                            const assignEmail = newJobData.assigned_to_email || user.email;
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
                                assigned_to: assignEmail,
                                assigned_to_users: [assignEmail],
                            });
                            leadId = lead.id;

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
                                assigned_to: assignEmail,
                                assigned_to_users: [assignEmail],
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

                // Sync assigned inspector to pre-existing linked lead / customer
                // (the update/reassign path already does this at the top of the mutation;
                //  new-job path only ran it for contactSource === 'new' via the create payload)
                if (!existingJob && newJobData.assigned_to_email && (contactSource === 'lead' || contactSource === 'customer')) {
                    const syncEmail = newJobData.assigned_to_email;
                    const addToUsers = (existing = []) =>
                        existing.includes(syncEmail) ? existing : [...existing, syncEmail];
                    try {
                        if (leadId) {
                            const [lead] = await base44.entities.Lead.filter({ id: leadId });
                            if (lead) {
                                await base44.entities.Lead.update(leadId, {
                                    assigned_to: syncEmail,
                                    assigned_to_users: addToUsers(lead.assigned_to_users),
                                });
                            }
                        }
                    } catch (e) { console.error('Failed to sync lead assignment on job create:', e); }
                    try {
                        if (customerId) {
                            const [cust] = await base44.entities.Customer.filter({ id: customerId });
                            if (cust) {
                                await base44.entities.Customer.update(customerId, {
                                    assigned_to: syncEmail,
                                    assigned_to_users: addToUsers(cust.assigned_to_users),
                                });
                            }
                        }
                    } catch (e) { console.error('Failed to sync customer assignment on job create:', e); }
                }

                // Grant CRM access to ladder assistant / drone pilot if requested
                try {
                    const extraAccessEmails = [
                        newJobData.ladder_assistant_grant_access && newJobData.ladder_assistant_email,
                        newJobData.drone_pilot_grant_access && newJobData.drone_pilot_email,
                    ].filter(Boolean);

                    if (extraAccessEmails.length > 0) {
                        const addToUsers = (existing = []) => {
                            const merged = [...existing];
                            extraAccessEmails.forEach(e => { if (!merged.includes(e)) merged.push(e); });
                            return merged;
                        };

                        if (leadId) {
                            const [lead] = await base44.entities.Lead.filter({ id: leadId });
                            if (lead) {
                                await base44.entities.Lead.update(leadId, {
                                    assigned_to_users: addToUsers(lead.assigned_to_users),
                                });
                            }
                        }
                        if (customerId) {
                            const [cust] = await base44.entities.Customer.filter({ id: customerId });
                            if (cust) {
                                await base44.entities.Customer.update(customerId, {
                                    assigned_to_users: addToUsers(cust.assigned_to_users),
                                });
                            }
                        }
                        console.log('✅ CRM access granted to:', extraAccessEmails);
                    }
                } catch (grantError) {
                    console.error('Failed to grant CRM access (non-critical):', grantError);
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

                let notificationResult = null;
                try {
                    notificationResult = await base44.functions.invoke('sendInspectionAssignment', {
                        jobId: job.id,
                        inspectorEmail: newJobData.assigned_to_email,
                        appUrl: window.location.origin,
                    });
                    console.log('✅ Notification result:', notificationResult);
                } catch (emailError) {
                    console.error('❌ Failed to send assignment notification:', emailError);
                    notificationResult = { success: false, message: emailError.message || 'Unknown error' };
                }

                return { job, leadId, customerId, calendarEventId, taskId, notificationResult };
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
            if (data.taskId) queryClient.invalidateQueries({ queryKey: ['my-assignments-tasks'] });
            if (data.leadId) queryClient.invalidateQueries({ queryKey: ['my-assignments-leads'] });
            // Refresh every surface that lists InspectionJobs so the new/updated job
            // (and its drone-pilot / ladder-assist flags) shows up immediately.
            queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
            queryClient.invalidateQueries({ queryKey: ['lead-inspections'] });
            queryClient.invalidateQueries({ queryKey: ['lead-inspection-jobs'] });
            queryClient.invalidateQueries({ queryKey: ['inspection-jobs-dashboard'] });
            queryClient.invalidateQueries({ queryKey: ['inspection-jobs-assists'] });
            queryClient.invalidateQueries({ queryKey: ['drone-inspections'] });
            queryClient.invalidateQueries({ queryKey: ['inspections'] });
            setSuccessData({ job: data.job, extras, notificationResult: data.notificationResult });
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
                            <h2 className="text-2xl font-bold text-gray-900 mb-1">Assignment Created!</h2>
                            <p className="text-gray-500 text-sm">
                                {successData.notificationResult?.message || 'Notifications sent.'}
                            </p>
                        </div>

                        {/* Notification delivery status */}
                        {successData.notificationResult?.details && (
                            <div className="bg-gray-50 rounded-lg px-5 py-3 text-left w-full max-w-sm space-y-1">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notifications</p>
                                {[
                                    { key: 'inspector_email', label: 'Inspector email', errorKey: 'inspector_email_error' },
                                    { key: 'inspector_sms', label: 'Inspector SMS', errorKey: 'inspector_sms_skip_reason' },
                                    { key: 'client_email', label: 'Homeowner email', errorKey: 'client_email_skip_reason' },
                                    { key: 'client_sms', label: 'Homeowner SMS', errorKey: 'client_sms_skip_reason' },
                                ].map(({ key, label, errorKey }) => {
                                    const sent = successData.notificationResult.details[key];
                                    const reason = successData.notificationResult.details[errorKey];
                                    return (
                                        <div key={key} className="flex items-start gap-2 text-sm">
                                            {sent
                                                ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                                : <X className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                                            }
                                            <span className={sent ? 'text-gray-700' : 'text-gray-400'}>
                                                {label}
                                                {!sent && reason && reason !== 'no email address on job' && reason !== 'no phone number on job' && reason !== 'no phone number on inspector profile' && reason !== 'no company ID' && reason !== 'placeholder value'
                                                    ? <span className="text-red-500 ml-1 text-xs">— {reason}</span>
                                                    : !sent ? <span className="text-gray-400 ml-1 text-xs">— not configured</span>
                                                    : null
                                                }
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

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
                            <Label htmlFor="storm_context">Storm Details <span className="text-gray-400 font-normal text-xs">(optional — helps AI find the right damage)</span></Label>
                            <Input
                                id="storm_context"
                                placeholder='e.g. "3/4 inch hail, 58 mph NW wind on June 12"'
                                value={formData.storm_context}
                                onChange={handleInputChange}
                                className="mt-1"
                            />
                        </div>
                        <div className="mt-4">
                            <div className="flex items-center justify-between mb-1">
                                <Label htmlFor="lead_source">Lead Source</Label>
                                <button
                                    type="button"
                                    onClick={() => { setShowNewSourceInput(true); setNewSourceName(''); }}
                                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                                    title="Add new lead source"
                                >
                                    <Plus className="w-3.5 h-3.5" /> Add Source
                                </button>
                            </div>
                            {showNewSourceInput ? (
                                <div className="flex gap-2">
                                    <Input
                                        autoFocus
                                        placeholder="e.g. Sedgwick, Farmers, Door Knock..."
                                        value={newSourceName}
                                        onChange={e => setNewSourceName(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && newSourceName.trim()) addLeadSourceMutation.mutate(newSourceName.trim());
                                            if (e.key === 'Escape') { setShowNewSourceInput(false); setNewSourceName(''); }
                                        }}
                                        className="flex-1"
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => newSourceName.trim() && addLeadSourceMutation.mutate(newSourceName.trim())}
                                        disabled={!newSourceName.trim() || addLeadSourceMutation.isPending}
                                    >
                                        {addLeadSourceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => { setShowNewSourceInput(false); setNewSourceName(''); }}
                                    >
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            ) : (
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
                                        {customLeadSources.length > 0 && (
                                            <>
                                                <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 border-t mt-1">Custom Sources</div>
                                                {customLeadSources.map(src => (
                                                    <SelectItem key={src.id} value={src.name}>{src.name}</SelectItem>
                                                ))}
                                            </>
                                        )}
                                    </SelectContent>
                                </Select>
                            )}
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
                                        <Label>Assistant ({t.common.optional})</Label>
                                        <Select
                                            value={formData.ladder_assistant_email || ''}
                                            onValueChange={(v) => {
                                                const person = allPilotOptions.find(p => p.email === v);
                                                setFormData(prev => ({
                                                    ...prev,
                                                    ladder_assistant_email: v,
                                                    ladder_assistant_name: person ? (person.full_name || '') : prev.ladder_assistant_name,
                                                }));
                                            }}
                                        >
                                            <SelectTrigger><SelectValue placeholder="Select assistant..." /></SelectTrigger>
                                            <SelectContent>
                                                {allPilotOptions.map(p => (
                                                    <SelectItem key={p.id} value={p.email}>
                                                        {p.full_name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {formData.ladder_assistant_email && (
                                            <>
                                                <p className="text-xs text-green-600 mt-1">✓ Will receive an assignment notification</p>
                                                <div className="flex items-center gap-2 mt-2 p-2 bg-white border border-yellow-300 rounded-md">
                                                    <Checkbox
                                                        id="ladder_assistant_grant_access"
                                                        checked={formData.ladder_assistant_grant_access}
                                                        onCheckedChange={(checked) => setFormData(prev => ({ ...prev, ladder_assistant_grant_access: checked }))}
                                                        data-testid="checkbox-ladder-grant-access"
                                                    />
                                                    <label htmlFor="ladder_assistant_grant_access" className="text-xs text-gray-700 cursor-pointer leading-tight">
                                                        <span className="font-medium">Grant full CRM access</span> — lets this person see the customer profile, estimates, invoices, and notes just like the assigned rep
                                                    </label>
                                                </div>
                                            </>
                                        )}
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
                        <SectionTitle>Drone Pilot</SectionTitle>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <div className="flex items-start gap-3 mb-3">
                                <Checkbox 
                                    id="drone_pilot_needed"
                                    checked={formData.drone_pilot_needed}
                                    onCheckedChange={(checked) => setFormData({...formData, drone_pilot_needed: checked})}
                                />
                                <div className="flex-1">
                                    <label htmlFor="drone_pilot_needed" className="font-medium text-gray-900 cursor-pointer">
                                        Drone Pilot Needed
                                    </label>
                                    <p className="text-xs text-gray-600 mt-1">
                                        Add a drone pilot for aerial imagery or hard-to-reach areas.
                                    </p>
                                </div>
                            </div>
                            {formData.drone_pilot_needed && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pl-7">
                                    <div>
                                        <Label>Drone Pilot ({t.common.optional})</Label>
                                        <Select
                                            value={formData.drone_pilot_email || ''}
                                            onValueChange={(v) => {
                                                const person = allPilotOptions.find(p => p.email === v);
                                                setFormData(prev => ({
                                                    ...prev,
                                                    drone_pilot_email: v,
                                                    drone_pilot_name: person ? (person.full_name || '') : prev.drone_pilot_name,
                                                }));
                                            }}
                                        >
                                            <SelectTrigger><SelectValue placeholder="Select pilot..." /></SelectTrigger>
                                            <SelectContent>
                                                {allPilotOptions.map(p => (
                                                    <SelectItem key={p.id} value={p.email}>
                                                        {p.full_name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {formData.drone_pilot_email && (
                                            <>
                                                <p className="text-xs text-green-600 mt-1">✓ Will receive an assignment notification</p>
                                                <div className="flex items-center gap-2 mt-2 p-2 bg-white border border-blue-300 rounded-md">
                                                    <Checkbox
                                                        id="drone_pilot_grant_access"
                                                        checked={formData.drone_pilot_grant_access}
                                                        onCheckedChange={(checked) => setFormData(prev => ({ ...prev, drone_pilot_grant_access: checked }))}
                                                        data-testid="checkbox-drone-grant-access"
                                                    />
                                                    <label htmlFor="drone_pilot_grant_access" className="text-xs text-gray-700 cursor-pointer leading-tight">
                                                        <span className="font-medium">Grant full CRM access</span> — lets this person see the customer profile, estimates, invoices, and notes just like the assigned rep
                                                    </label>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    <div>
                                        <Label htmlFor="drone_pilot_cost">Amount (Default $150)</Label>
                                        <Input 
                                            id="drone_pilot_cost" 
                                            type="number" 
                                            step="0.01"
                                            value={formData.drone_pilot_cost} 
                                            onChange={handleInputChange} 
                                        />
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
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="sendCustomerReminders"
                                        checked={sendCustomerReminders}
                                        onCheckedChange={setSendCustomerReminders}
                                        data-testid="checkbox-send-customer-reminders"
                                    />
                                    <label
                                        htmlFor="sendCustomerReminders"
                                        className="text-sm font-medium leading-none"
                                    >
                                        Send appointment reminders to homeowner (24 hr &amp; 1 hr before)
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