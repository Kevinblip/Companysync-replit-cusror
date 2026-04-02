import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, Camera, Loader2, ArrowLeft, AlertCircle, Trash2, Mail, DollarSign, CheckCircle, KeyRound, Eye, EyeOff, Phone, Wifi } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const ONBOARDING_CHECKLIST = {
  'Claims Specialist Onboarding': [
    '1099 Form', 'Independent contract agreement', '2 shirts 1 sweatshirt',
    'Business Cards', 'Tablet', 'Safety training acknowledgement', 'Waiver release form',
    'Copy of Drivers license and proof of insurance', 'Social security number/EIN',
    'ID badge', 'lanyard and clipboard', 'CompanySync CRM app training', 'Safety/Compliance Training',
    'Field Training', 'Ladder', 'Drone', 'Roof/Siding Picture App', 'Certification Award'
  ]
};

const DEPARTMENTS = [
  'Punch Out', 'Free Inspection (Insurance)', 'Free Inspection (Retail)', 'Interior',
  'Gutter', 'Roof Repair', 'Roof Replacement', 'Insurance Claims Specialist',
  'Siding', 'Sales', 'Roof Inspection(Accuserve)'
];

const PERMISSIONS_CONFIG = [
    {
        group: "Core CRM",
        features: [
            { name: "Leads", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Customers", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Estimates", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own", "view_all_templates"] },
            { name: "Proposals", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own", "view_all_templates"] },
            { name: "Invoices", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Payments", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Items", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Projects", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own", "create_timesheets", "edit_milestones"] },
            { name: "Tasks", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own", "edit_timesheets", "delete_own_timesheets", "delete_global_timesheets"] },
            { name: "Reminders", capabilities: ["view_own", "view_global", "create", "edit", "delete"] },
            { name: "Contracts", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
        ],
    },
    {
        group: "AI & Automation",
        features: [
            { name: "AI Estimator", capabilities: ["view", "create", "generate_images", "generate_audio"] },
            { name: "Lexi AI", capabilities: ["view", "chat", "edit_memory"] },
            { name: "Permit Assistant", capabilities: ["view", "generate"] },
            { name: "Daily Reports", capabilities: ["view", "generate"] },
            { name: "AI Staff", capabilities: ["view", "create", "edit"] },
            { name: "Video Training", capabilities: ["view", "create", "generate"] },
            { name: "Workflows", capabilities: ["view", "create", "edit", "delete", "activate"] },
            { name: "Campaigns", capabilities: ["view", "create", "edit", "delete", "send"] },
        ],
    },
    {
        group: "Inspections & Field Work",
        features: [
            { name: "Inspections", capabilities: ["view_own", "view_global", "create", "capture_photos", "edit_own", "delete_own"] },
            { name: "Lead Inspections", capabilities: ["view_own", "create", "edit"] },
            { name: "Drone Analysis", capabilities: ["view", "upload", "analyze"] },
            { name: "Storm Tracking", capabilities: ["view", "generate_leads"] },
            { name: "Property Importer", capabilities: ["view", "import"] },
            { name: "Lead Finder", capabilities: ["view", "search", "export"] },
            { name: "Field Sales Tracker", capabilities: ["view", "track_activity"] },
            { name: "Field Rep App", capabilities: ["view", "log_activity"] },
            { name: "Territory Manager", capabilities: ["view", "create", "edit", "assign"] },
            { name: "Subcontractors", capabilities: ["view", "create", "edit", "delete", "search"] },
        ],
    },
    {
        group: "Communication",
        features: [
            { name: "Communication Hub", capabilities: ["view_own", "view_global", "audio_call", "video_call", "send_sms", "send_email"] },
            { name: "Live Call Dashboard", capabilities: ["view", "view_global"] },
            { name: "Mailbox", capabilities: ["view_own", "view_global", "send", "delete_own"] },
            { name: "Messages", capabilities: ["view_own", "view_global", "send"] },
            { name: "Email Templates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "SMS Templates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Zoom Meeting", capabilities: ["view", "create"] },
        ],
    },
    {
        group: "Finance & Accounting",
        features: [
            { name: "Bills", capabilities: ["view_own", "view_global", "create", "edit", "approve", "delete"] },
            { name: "Accounting Setup", capabilities: ["view", "configure"] },
            { name: "Accounting Dashboard", capabilities: ["view_own", "view_global"] },
            { name: "Transactions", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Journal Entry", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Transfer Funds", capabilities: ["view", "create", "approve"] },
            { name: "Chart of Accounts", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Bank Reconciliation", capabilities: ["view", "reconcile"] },
            { name: "Accounting Reports", capabilities: ["view_own", "view_global", "export"] },
            { name: "Expenses", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Payouts", capabilities: ["view_own", "view_global", "create", "approve", "process"] },
            { name: "Commission Report", capabilities: ["view_own", "view_global"] },
            { name: "Family Commissions", capabilities: ["view_own", "view_global", "create", "edit", "process_payouts"] },
        ],
    },
    {
        group: "Documents & Files",
        features: [
            { name: "Documents", capabilities: ["view_own", "view_global", "upload", "delete_own"] },
            { name: "Contract Templates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Contract Signing", capabilities: ["view_own", "view_global", "create", "send"] },
            { name: "Knowledge Base", capabilities: ["view", "create", "edit", "delete"] },
        ],
    },
    {
        group: "Reports & Analytics",
        features: [
            { name: "Reports", capabilities: ["view_own", "view_global", "view_timesheets_report"] },
            { name: "Analytics Dashboard", capabilities: ["view_own", "view_global"] },
            { name: "Report Builder", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Sales Reports", capabilities: ["view_own", "view_global"] },
            { name: "Sales Dashboard", capabilities: ["view_own", "view_global"] },
            { name: "Competitor Analysis", capabilities: ["view", "create"] },
        ],
    },
    {
        group: "Administrative",
        features: [
            { name: "General Settings", capabilities: ["view", "edit"] },
            { name: "Notification Diagnostics", capabilities: ["view", "run"] },
            { name: "Company Setup", capabilities: ["view", "edit"] },
            { name: "PDF Branding", capabilities: ["view", "edit"] },
            { name: "Report Templates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Staff Management", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Roles Management", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Round Robin Settings", capabilities: ["view", "edit"] },
            { name: "Templates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Data Import", capabilities: ["view", "import"] },
            { name: "Task Importer", capabilities: ["view", "import"] },
            { name: "Utilities", capabilities: ["view", "cleanup", "run_repairs"] },
            { name: "Bulk Import", capabilities: ["view", "import"] },
            { name: "Custom Fields", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Menu Setup", capabilities: ["view", "edit"] },
            { name: "Tax Rates", capabilities: ["view", "create", "edit", "delete"] },
            { name: "Integration Manager", capabilities: ["view", "configure"] },
            { name: "Google Chat Settings", capabilities: ["view", "configure"] },
            { name: "Slack Settings", capabilities: ["view", "configure"] },
        ],
    },
    {
        group: "Other Features",
        features: [
            { name: "Calendar", capabilities: ["view_own", "view_global", "create", "edit_own", "delete_own"] },
            { name: "Activity", capabilities: ["view_own", "view_global"] },
            { name: "Review Requests", capabilities: ["view_own", "view_global", "create", "send"] },
            { name: "Map", capabilities: ["view"] },
            { name: "Subscription", capabilities: ["view", "manage"] },
        ],
    }
];

export default function StaffProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const userEmail = urlParams.get("email");
  const isNewUser = userEmail === 'new';

  console.log('🔍 StaffProfilePage Debug:', { userEmail, isNewUser }); // Debug log

  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState({});
  const [isUploading, setIsUploading] = useState(false);
  const [emailDebugLog, setEmailDebugLog] = useState([]);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [setPasswordValue, setSetPasswordValue] = useState('');
  const [setPasswordConfirm, setSetPasswordConfirm] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [connectingPhone, setConnectingPhone] = useState(false);
  const [connectResult, setConnectResult] = useState(null);
  const avatarFileRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['current-user-profile', currentUser?.email],
    queryFn: () => currentUser ? base44.entities.StaffProfile.filter({ user_email: currentUser.email }) : [],
    enabled: !!currentUser,
    initialData: [],
  });

  const myCompany = React.useMemo(() => {
    if (!currentUser) return null;
    const ownedCompany = companies.find(c => c.created_by === currentUser.email);
    if (ownedCompany) return ownedCompany;
    const staffProfile = staffProfiles[0];
    if (staffProfile?.company_id) {
      return companies.find(c => c.id === staffProfile.company_id);
    }
    return null;
  }, [currentUser, companies, staffProfiles]);

  const { data: staffRoles = [] } = useQuery({
    queryKey: ['staff-roles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffRole.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: profileData, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['staff-profile', userEmail],
    queryFn: async () => {
        if (isNewUser) {
          console.log('✅ New user mode - returning null');
          return null;
        }
        console.log('📊 Fetching profile for:', userEmail);
        const profiles = await base44.entities.StaffProfile.filter({ user_email: userEmail });
        return profiles[0];
    },
    enabled: !!userEmail && !isNewUser,
  });

  useEffect(() => {
    console.log('🔄 Profile useEffect triggered:', { isNewUser, profileData });
    if (isNewUser) {
      console.log('✅ Setting up NEW user profile');
      setProfile({
        full_name: '',
        email: '',
        role_id: '',
        role_name: '',
        is_administrator: false,
        can_process_commission_payments: false,
        position: '',
        phone: '',
        hourly_rate: 0,
        commission_rate: '',
        twilio_number: '',
        cell_phone: '',
        call_routing_mode: 'sarah_answers',
        availability_status: 'available',
        whatsapp_enabled: false,
        social_facebook: '',
        social_linkedin: '',
        social_skype: '',
        email_signature: '',
        departments: [],
        onboarding_checklist: {},
        avatar_url: '',
        permissions: {},
        invite_sent: false,
        invite_sent_at: null,
        requires_ladder_assist: false,
        default_ladder_assist_cost: 100,
        preferred_language: 'en',
        data: {},
      });
    } else if (profileData) {
      console.log('✅ Setting up EXISTING user profile');
      setProfile({
        profile_id: profileData.id,
        full_name: profileData.full_name || '',
        email: profileData.user_email || '',
        role_id: profileData.role_id || '',
        role_name: profileData.role_name || '',
        is_administrator: profileData.is_administrator || false,
        can_process_commission_payments: profileData.can_process_commission_payments || false,
        position: profileData.position || '',
        phone: profileData.phone || '',
        hourly_rate: profileData.hourly_rate || 0,
        commission_rate: profileData.commission_rate === null ? '' : (profileData.commission_rate || ''), // Explicitly handle null to empty string for display
        twilio_number: profileData.twilio_number || '',
        cell_phone: profileData.cell_phone || '',
        call_routing_mode: profileData.call_routing_mode || 'sarah_answers',
        availability_status: profileData.availability_status || 'available',
        whatsapp_enabled: profileData.whatsapp_enabled || false,
        social_facebook: profileData.social_facebook || '',
        social_linkedin: profileData.social_linkedin || '',
        social_skype: profileData.social_skype || '',
        email_signature: profileData.email_signature || '',
        departments: profileData.departments || [],
        onboarding_checklist: profileData.onboarding_checklist || {},
        avatar_url: profileData.avatar_url || '',
        permissions: profileData.permissions || {},
        invite_sent: profileData.invite_sent || false,
        invite_sent_at: profileData.invite_sent_at,
        requires_ladder_assist: profileData.requires_ladder_assist || false,
        default_ladder_assist_cost: profileData.default_ladder_assist_cost || 100,
        preferred_language: profileData.preferred_language || 'en',
        data: profileData.data || {},
      });
    }
  }, [profileData, isNewUser]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (!myCompany?.id) {
        throw new Error("Company setup required");
      }

      const profilePayload = {
        user_email: data.email,
        company_id: myCompany.id,
        full_name: data.full_name,
        role_id: data.role_id,
        role_name: data.role_name,
        is_administrator: (currentUser?.email === myCompany?.created_by) ? (data.is_administrator || false) : false,
        can_process_commission_payments: data.can_process_commission_payments,
        position: data.position,
        phone: data.phone,
        hourly_rate: data.hourly_rate,
        commission_rate: data.commission_rate === '' ? null : data.commission_rate,
        twilio_number: data.twilio_number,
        cell_phone: data.cell_phone,
        call_routing_mode: data.call_routing_mode,
        availability_status: data.availability_status,
        whatsapp_enabled: data.whatsapp_enabled,
        social_facebook: data.social_facebook,
        social_linkedin: data.social_linkedin,
        social_skype: data.social_skype,
        email_signature: data.email_signature,
        departments: data.departments,
        onboarding_checklist: data.onboarding_checklist,
        avatar_url: data.avatar_url,
        is_active: true,
        permissions: data.permissions,
        requires_ladder_assist: data.requires_ladder_assist,
        default_ladder_assist_cost: data.default_ladder_assist_cost,
        preferred_language: data.preferred_language || 'en',
        data: data.data || {},
      };

      let savedProfile;
      const isCreating = !data.profile_id;
      
      if (data.profile_id) {
        savedProfile = await base44.entities.StaffProfile.update(data.profile_id, profilePayload);
      } else {
        savedProfile = await base44.entities.StaffProfile.create(profilePayload);
      }
      
      // Trigger workflows for staff creation/update
      if (myCompany?.id) {
        try {
          const triggerType = isCreating ? 'staff_created' : 'staff_updated';
          await base44.functions.invoke('triggerWorkflow', {
            triggerType,
            companyId: myCompany.id,
            entityType: 'StaffProfile',
            entityId: savedProfile.id,
            entityData: {
              staff_name: savedProfile.full_name,
              staff_email: savedProfile.user_email,
              position: savedProfile.position,
              role_name: savedProfile.role_name,
              is_administrator: savedProfile.is_administrator,
              app_url: window.location.origin
            }
          });
        } catch (error) {
          console.error('Workflow trigger failed (non-critical):', error);
        }
      }
      
      return savedProfile;
    },
    onSuccess: (savedProfile) => {
      queryClient.invalidateQueries({ queryKey: ['company-staff-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['staff-profile', userEmail] }); // Invalidate specific profile query

      const wasNewUserCreation = !profile.profile_id; // Check if it was a new creation before state update

      setProfile(prev => ({
        ...prev,
        profile_id: savedProfile.id,
        // Update invite status if it was changed during the save operation, or if it's new
        invite_sent: savedProfile.invite_sent || prev.invite_sent,
        invite_sent_at: savedProfile.invite_sent_at || prev.invite_sent_at,
        role_id: savedProfile.role_id || prev.role_id, // Ensure role_id is updated
        role_name: savedProfile.role_name || prev.role_name, // Ensure role_name is updated
        commission_rate: savedProfile.commission_rate === null ? '' : (savedProfile.commission_rate || ''), // Ensure commission rate is updated correctly, handle null from DB
      }));
      
      // If it's an existing profile, show a generic success message.
      // New user creation will be handled by specific alerts after saving.
      if (!wasNewUserCreation) {
        alert("✅ Profile saved successfully!");
      } else {
        alert("✅ Profile created successfully!");
        navigate(createPageUrl('StaffProfilePage', { email: savedProfile.user_email })); // Redirect to newly created profile
      }
    },
    onError: (error) => {
      alert(`❌ Failed to save profile: ${error.message}`);
    }
  });

  const sendInviteMutation = useMutation({
    mutationFn: async () => {
      if (!profile.email) {
        throw new Error('Email address is required');
      }

      if (!myCompany?.id) {
        throw new Error('Company not found');
      }

      if (!myCompany?.email) {
        throw new Error('Company email not configured. Please update your company settings.');
      }

      const inviteUrl = `${window.location.origin}`; 
      
      setEmailDebugLog(prev => [...prev, `📧 Attempting to send to: ${profile.email} via SendEmail function`]);
      
      try {
        // Get role name for the email
        const roleName = profile.role_name || 'Staff Member';
        
        // Use the CRM email function instead of Core.SendEmail
        const forgotPasswordUrl = `${inviteUrl}/ForgotPassword`;
        const inviteHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1e293b; margin-bottom: 8px;">You're Invited to ${myCompany?.company_name || 'Our Team'}!</h1>
            <p style="color: #64748b; font-size: 15px;">Hi ${profile.full_name},</p>
            <p style="color: #334155; font-size: 15px;">
              You've been added as a <strong>${roleName}</strong> at <strong>${myCompany?.company_name || 'our company'}</strong>. 
              We're excited to have you on the team!
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <h2 style="color: #1e293b; font-size: 18px; margin-bottom: 16px;">Set Up Your Account in 2 Steps</h2>
            <ol style="color: #334155; font-size: 15px; line-height: 1.8; padding-left: 20px;">
              <li>Click the button below to go to the password setup page</li>
              <li>Enter your email (<strong>${profile.email}</strong>) and click <strong>"Send Reset Link"</strong></li>
              <li>Check your inbox for a link to set your password — you'll be logged in automatically!</li>
            </ol>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${forgotPasswordUrl}" style="display: inline-block; background-color: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">
                Set Up My Password
              </a>
            </div>
            <p style="color: #64748b; font-size: 14px;">
              Your access level: <strong>${roleName}</strong><br/>
              ${myCompany?.created_by === profile.email ? '✅ You have administrator access to all features.' : '📋 Your permissions are configured by your administrator.'}
            </p>
            <p style="color: #94a3b8; font-size: 13px; word-break: break-all;">
              Or copy this link: ${forgotPasswordUrl}
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="color: #94a3b8; font-size: 12px;">&copy; ${new Date().getFullYear()} CompanySync — Roofing Business Management</p>
          </div>
        `;
        const emailResult = await base44.functions.invoke('sendEmailFromCRM', {
          to: profile.email,
          subject: `You're invited to join ${myCompany?.company_name || 'our team'} on CompanySync!`,
          html: inviteHtml,
          companyId: myCompany.id
        });

        setEmailDebugLog(prev => [...prev, `✅ Email function returned: ${JSON.stringify(emailResult)}`]);

        if (profile.profile_id) {
          const updatedProfile = await base44.entities.StaffProfile.update(profile.profile_id, {
            invite_sent: true,
            invite_sent_at: new Date().toISOString()
          });
          
          setProfile(prev => ({
            ...prev,
            invite_sent: updatedProfile.invite_sent,
            invite_sent_at: updatedProfile.invite_sent_at,
          }));
        }

        return emailResult;
      } catch (emailError) {
        setEmailDebugLog(prev => [...prev, `❌ Error: ${emailError.message}`]);
        throw emailError;
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['staff-profile', userEmail] });
      alert(`✅ Invite email sent to ${profile.email}!\n\nThey should use "Forgot Password" to set up their account.\n\nCheck spam/junk folder if not received.`);
    },
    onError: (error) => {
      alert(`❌ Failed to send invite: ${error.message}`);
    }
  });

  const setStaffPasswordMutation = useMutation({
    mutationFn: async ({ staffEmail, password }) => {
      const resp = await fetch('/api/admin/set-staff-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffEmail, password }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to set password');
      return data;
    },
    onSuccess: () => {
      setShowSetPassword(false);
      setSetPasswordValue('');
      setSetPasswordConfirm('');
      queryClient.invalidateQueries({ queryKey: ['staff-profile', userEmail] });
      alert(`✅ Password set successfully! ${profile.email} can now log in directly with that password.`);
    },
    onError: (error) => {
      alert(`❌ Failed to set password: ${error.message}`);
    }
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (id) => base44.entities.StaffProfile.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-staff-profiles'] });
      alert("✅ Staff member deleted");
      navigate(createPageUrl('StaffManagement'));
    },
  });

  const handleCopyInviteLink = () => {
    const appUrl = window.location.origin;
    const forgotUrl = `${appUrl}/ForgotPassword`;
    const inviteMessage = `Hi ${profile.full_name},

You've been invited to join ${myCompany?.company_name || 'our team'} on CompanySync!

To set up your account:
1. Go to: ${forgotUrl}
2. Enter your email: ${profile.email}
3. Click "Send Reset Link" and check your inbox
4. Click the link in the email to set your password and log in

Welcome to the team!`;

    navigator.clipboard.writeText(inviteMessage);
    alert('✅ Invite message copied to clipboard!\n\nPaste and send this via text, WhatsApp, or another method.');
  };

  const handleFieldChange = (field, value) => {
    setProfile(p => ({ ...p, [field]: value }));
  };

  const handleConnectToSarah = async () => {
    const twilioNum = profile.twilio_number?.trim();
    if (!twilioNum) {
      setConnectResult({ success: false, message: 'Please enter a Twilio phone number first.' });
      return;
    }
    if (!myCompany?.id) {
      setConnectResult({ success: false, message: 'Company not found.' });
      return;
    }
    setConnectingPhone(true);
    setConnectResult(null);
    try {
      const settingsRows = await base44.entities.TwilioSettings.filter({ company_id: myCompany.id });
      const settings = settingsRows[0];
      if (!settings?.account_sid || !settings?.auth_token) {
        setConnectResult({ success: false, message: 'No Twilio credentials found. Please set up Twilio in Sarah Settings first.' });
        return;
      }
      const resp = await fetch('/api/twilio/auto-provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_sid: settings.account_sid,
          auth_token: settings.auth_token,
          phone_number: twilioNum,
          company_id: myCompany.id,
          company_name: myCompany.company_name || myCompany.name || '',
          rep_name: profile.full_name || profile.name || '',
          rep_email: profile.user_email || '',
          cell_phone: profile.cell_phone || '',
          routing_mode: profile.call_routing_mode || 'sarah_answers',
        })
      });
      const data = await resp.json();
      setConnectResult({ success: !!data.success, message: data.message || (data.success ? 'Connected!' : data.error || 'Failed') });
    } catch (e) {
      setConnectResult({ success: false, message: e.message });
    } finally {
      setConnectingPhone(false);
    }
  };

  const handlePermissionChange = (feature, capability) => {
    setProfile(p => {
      const newPermissions = { ...(p.permissions || {}) };
      if (!newPermissions[feature]) newPermissions[feature] = {};
      newPermissions[feature][capability] = !newPermissions[feature][capability];
      return { ...p, permissions: newPermissions };
    });
  };

  const handleSave = () => {
    console.log('💾 Attempting to save profile:', profile);
    console.log('📧 Email value:', profile.email);
    console.log('👤 Name value:', profile.full_name);
    
    if (!profile.full_name || !profile.full_name.trim()) {
      alert("❌ Name is required");
      return;
    }
    
    if (!profile.email || !profile.email.trim()) {
      alert("❌ Email is required");
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(profile.email)) {
      alert("❌ Please enter a valid email address");
      return;
    }
    
    saveMutation.mutate(profile);
  };

  const handleAvatarUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsUploading(true);
    try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        handleFieldChange('avatar_url', file_url);
    } catch(err) {
        alert('Upload failed: ' + err.message);
    } finally {
        setIsUploading(false);
    }
  };

  const handleChecklistChange = (checklistName, item) => {
    setProfile(p => {
        const currentChecklist = { ...(p.onboarding_checklist?.[checklistName] || {}) };
        currentChecklist[item] = !currentChecklist[item];
        const newOnboarding = { ...(p.onboarding_checklist || {}), [checklistName]: currentChecklist };
        return { ...p, onboarding_checklist: newOnboarding };
    });
  };

  const handleDepartmentChange = (department) => {
      setProfile(p => {
          const currentDepartments = p.departments || [];
          const newDepartments = currentDepartments.includes(department)
              ? currentDepartments.filter(d => d !== department)
              : [...currentDepartments, department];
          return { ...p, departments: newDepartments };
      });
  };

  const handleRoleChange = (roleId) => {
    const selectedRole = staffRoles.find(r => r.id === roleId);
    setProfile(p => ({
      ...p,
      role_id: roleId,
      role_name: selectedRole?.name || '',
      permissions: selectedRole?.permissions || {}
    }));
  };

  const handleDelete = () => {
    if (window.confirm(`⚠️ Delete ${profile.full_name}?\n\nThis will remove their profile. Are you sure?`)) {
      deleteProfileMutation.mutate(profile.profile_id);
    }
  };

  if (isLoadingProfile) return <div className="p-6">Loading...</div>;

  const fullNameParts = profile.full_name?.split(' ') || [];
  const firstName = fullNameParts[0] || '';
  const lastName = fullNameParts.slice(1).join(' ') || '';

  console.log('🎨 Rendering form - isNewUser:', isNewUser, 'email:', profile.email);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => navigate(createPageUrl('StaffManagement'))}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{isNewUser ? 'Add New Staff Member' : profile.full_name}</h1>
            <p className="text-gray-500 mt-1">{isNewUser ? 'Set up their profile' : profile.email}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {profile.profile_id && (
            <>
              <Button 
                variant="outline"
                onClick={() => sendInviteMutation.mutate()}
                disabled={sendInviteMutation.isPending}
                className="text-blue-600 hover:text-blue-700"
              >
                {sendInviteMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                Send Invite
              </Button>
              <Button 
                variant="outline"
                onClick={handleCopyInviteLink}
                className="text-green-600 hover:text-green-700"
              >
                📋 Copy Invite Link
              </Button>
              <Button 
                variant="outline" 
                onClick={handleDelete}
                disabled={deleteProfileMutation.isPending}
                className="text-red-600 hover:text-red-700"
              >
                {deleteProfileMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {isNewUser && (
        <Alert className="bg-blue-50 border-blue-200">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-900">
            <strong>Creating New Staff Member:</strong> Fill in their details below. After saving, you can send them an invite email.
          </AlertDescription>
        </Alert>
      )}

      {profile.profile_id && !profile.invite_sent && (
        <Alert className="bg-yellow-50 border-yellow-200">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-yellow-900">
            <strong>⚠️ Invite Not Sent:</strong> This staff member hasn't received their login credentials yet.
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={() => sendInviteMutation.mutate()} disabled={sendInviteMutation.isPending}>
                {sendInviteMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                Send Invite Email
              </Button>
              <Button size="sm" onClick={handleCopyInviteLink} variant="outline">
                📋 Copy Invite Message
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {profile.invite_sent && profile.invite_sent_at && (
        <Alert className="bg-green-50 border-green-200">
          <Mail className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-900">
            ✅ Invite email sent on {new Date(profile.invite_sent_at).toLocaleDateString()}
          </AlertDescription>
        </Alert>
      )}

      {emailDebugLog.length > 0 && (
        <Alert className="bg-gray-50 border-gray-200">
          <AlertCircle className="h-4 w-4 text-gray-600" />
          <AlertDescription>
            <strong className="text-gray-900">Email Debug Log:</strong>
            <pre className="text-xs mt-2 text-gray-700 whitespace-pre-wrap">
              {emailDebugLog.join('\n')}
            </pre>
          </AlertDescription>
        </Alert>
      )}

      {profile.profile_id && profile.email && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <button
            type="button"
            data-testid="button-set-password-toggle"
            onClick={() => setShowSetPassword(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 rounded-lg transition-colors"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <KeyRound className="w-4 h-4 text-gray-500" />
              Set Password Directly for This Staff Member
            </div>
            <span className="text-xs text-gray-400">{showSetPassword ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {showSetPassword && (
            <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
              <p className="text-xs text-gray-500">
                Set a password on behalf of <strong>{profile.email}</strong>. They can then log in directly — no email required.
              </p>
              <div>
                <Label className="text-xs">New Password (min 8 characters)</Label>
                <div className="relative mt-1">
                  <Input
                    data-testid="input-set-password"
                    type={showPasswordText ? 'text' : 'password'}
                    value={setPasswordValue}
                    onChange={e => setSetPasswordValue(e.target.value)}
                    placeholder="Enter password..."
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordText(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Confirm Password</Label>
                <Input
                  data-testid="input-confirm-password"
                  type={showPasswordText ? 'text' : 'password'}
                  value={setPasswordConfirm}
                  onChange={e => setSetPasswordConfirm(e.target.value)}
                  placeholder="Confirm password..."
                  className="mt-1"
                />
              </div>
              {setPasswordValue && setPasswordConfirm && setPasswordValue !== setPasswordConfirm && (
                <p className="text-xs text-red-500">Passwords do not match</p>
              )}
              <Button
                data-testid="button-set-password-submit"
                size="sm"
                onClick={() => {
                  if (setPasswordValue !== setPasswordConfirm) { alert('Passwords do not match'); return; }
                  if (setPasswordValue.length < 8) { alert('Password must be at least 8 characters'); return; }
                  setStaffPasswordMutation.mutate({ staffEmail: profile.email, password: setPasswordValue });
                }}
                disabled={setStaffPasswordMutation.isPending || !setPasswordValue || !setPasswordConfirm}
              >
                {setStaffPasswordMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
                Set Password
              </Button>
            </div>
          )}
        </div>
      )}

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6 mt-6">
          <Card>
            <CardHeader><CardTitle>Profile Information</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <Avatar className="w-20 h-20">
                  <AvatarImage src={profile.avatar_url} />
                  <AvatarFallback>{profile.full_name?.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <input type="file" ref={avatarFileRef} onChange={handleAvatarUpload} className="hidden" accept="image/*" />
                <Button variant="outline" onClick={() => avatarFileRef.current?.click()} disabled={isUploading}>
                    {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Camera className="w-4 h-4 mr-2" />}
                    Upload Photo
                </Button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <Checkbox 
                    id="is-admin"
                    checked={profile.is_administrator || false}
                    onCheckedChange={(checked) => handleFieldChange('is_administrator', checked)}
                    disabled={currentUser?.email !== myCompany?.created_by}
                  />
                  <Label htmlFor="is-admin" className="text-sm font-semibold cursor-pointer">
                    Administrator (Full Access - Bypasses Role Permissions)
                    {currentUser?.email !== myCompany?.created_by && (
                      <span className="block text-xs font-normal text-gray-500 mt-1">Only the company owner can grant admin access</span>
                    )}
                  </Label>
                </div>

                <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <Checkbox 
                    id="can-process-payments"
                    checked={profile.can_process_commission_payments || false}
                    onCheckedChange={(checked) => handleFieldChange('can_process_commission_payments', checked)}
                  />
                  <Label htmlFor="can-process-payments" className="text-sm font-semibold cursor-pointer">
                    🔒 Can Process Commission Payments (Required for direct deposit authorization)
                  </Label>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label>First Name *</Label>
                  <Input 
                    value={firstName} 
                    onChange={(e) => handleFieldChange('full_name', `${e.target.value} ${lastName}`.trim())} 
                    placeholder="Enter first name"
                  />
                </div>
                <div>
                  <Label>Last Name *</Label>
                  <Input 
                    value={lastName} 
                    onChange={(e) => handleFieldChange('full_name', `${firstName} ${e.target.value}`.trim())} 
                    placeholder="Enter last name"
                  />
                </div>
                <div>
                  <Label>Email *</Label>
                  <Input 
                    type="email"
                    value={profile.email || ''} 
                    onChange={(e) => handleFieldChange('email', e.target.value)} 
                    placeholder="Enter email address"
                  />
                  <p className="text-xs text-gray-500 mt-1">Staff member's email address</p>
                </div>
                <div>
                  <Label>Role</Label>
                  <Select
                    value={profile.role_id || 'none'}
                    onValueChange={(value) => {
                      if (value === 'none') {
                        handleFieldChange('role_id', '');
                        handleFieldChange('role_name', '');
                        handleFieldChange('permissions', {});
                      } else {
                        handleRoleChange(value);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a role..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Role Assigned</SelectItem>
                      {staffRoles.map(role => (
                        <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">
                    Assign a role to grant permissions
                  </p>
                </div>
                <div>
                  <Label>Position / Job Title</Label>
                  <Input 
                    value={profile.position || ''} 
                    onChange={(e) => handleFieldChange('position', e.target.value)}
                  />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input 
                    value={profile.phone || ''} 
                    onChange={(e) => handleFieldChange('phone', e.target.value)}
                  />
                </div>
                <div>
                  <Label>Hourly Rate</Label>
                  <Input 
                    type="number" 
                    value={profile.hourly_rate || 0} 
                    onChange={(e) => handleFieldChange('hourly_rate', parseFloat(e.target.value) || 0)} 
                  />
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  Commission Structure (Optional)
                </h3>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <Label className="text-base font-semibold">Commission Rate (%)</Label>
                  <Input 
                    type="number" 
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="e.g., 5 for 5%, 10 for 10%, 9.8 for 9.8%"
                    value={profile.commission_rate === '' || profile.commission_rate === null || profile.commission_rate === undefined ? '' : profile.commission_rate} 
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '') {
                        handleFieldChange('commission_rate', '');
                      } else {
                        const parsed = parseFloat(value);
                        if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
                          handleFieldChange('commission_rate', parsed);
                        } else if (value === '-' && parsed === 0) { // Allow negative sign for input, but not for final value
                          handleFieldChange('commission_rate', value);
                        }
                      }
                    }} 
                    className="mt-2 text-lg font-semibold"
                  />
                  <p className="text-sm text-gray-600 mt-2">
                    💡 This percentage will be used to calculate their commission from paid invoices
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Leave empty if this person is not on commission (e.g., 1099 contractors)
                  </p>
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="font-semibold text-lg mb-4">Ladder Assistant Settings</h3>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-4">
                    <Checkbox
                      id="requires-ladder-assist"
                      checked={profile.requires_ladder_assist || false}
                      onCheckedChange={(checked) => handleFieldChange('requires_ladder_assist', checked)}
                    />
                    <Label htmlFor="requires-ladder-assist" className="cursor-pointer">
                      This rep typically requires ladder assistance for inspections
                    </Label>
                  </div>
                  {profile.requires_ladder_assist && (
                    <div className="ml-7">
                      <Label>Default Ladder Assist Cost</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={profile.default_ladder_assist_cost || 100}
                        onChange={(e) => handleFieldChange('default_ladder_assist_cost', parseFloat(e.target.value) || 0)}
                      />
                      <p className="text-xs text-gray-600 mt-1">
                        This will be the default cost when creating inspections for this rep
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="font-semibold text-lg mb-4">Phone & Call Routing</h3>

                <div className="flex items-center justify-between mb-4 p-3 rounded-lg border" style={{ backgroundColor: profile.availability_status === 'available' ? '#f0fdf4' : '#fef2f2', borderColor: profile.availability_status === 'available' ? '#bbf7d0' : '#fecaca' }}>
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${profile.availability_status === 'available' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <div>
                      <p className="font-medium text-sm">{profile.availability_status === 'available' ? 'Available' : 'Unavailable'}</p>
                      <p className="text-xs text-gray-500">
                        {profile.availability_status === 'available'
                          ? 'Calls will follow routing rules below'
                          : 'Sarah will handle all calls for this rep'}
                      </p>
                    </div>
                  </div>
                  <Switch
                    data-testid="switch-availability"
                    checked={profile.availability_status === 'available'}
                    onCheckedChange={(checked) => handleFieldChange('availability_status', checked ? 'available' : 'unavailable')}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Twilio Number (Business Line)</Label>
                    <Input
                      data-testid="input-twilio-number"
                      value={profile.twilio_number || ''}
                      onChange={(e) => { handleFieldChange('twilio_number', e.target.value); setConnectResult(null); }}
                      placeholder="+1 (555) 123-4567"
                    />
                    <p className="text-xs text-gray-500 mt-1">This rep's dedicated Twilio number for inbound calls</p>
                    {profile.twilio_number && (
                      <div className="mt-2">
                        <Button
                          data-testid="button-connect-sarah"
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleConnectToSarah}
                          disabled={connectingPhone}
                          className="text-xs"
                        >
                          {connectingPhone ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wifi className="h-3 w-3 mr-1" />}
                          {connectingPhone ? 'Connecting...' : 'Connect this number to Sarah'}
                        </Button>
                        {connectResult && (
                          <p className={`text-xs mt-1 ${connectResult.success ? 'text-green-600' : 'text-red-600'}`}>
                            {connectResult.success ? '✓ ' : '✗ '}{connectResult.message}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label>Personal Cell Phone</Label>
                    <Input
                      data-testid="input-cell-phone"
                      value={profile.cell_phone || ''}
                      onChange={(e) => handleFieldChange('cell_phone', e.target.value)}
                      placeholder="+1 (555) 987-6543"
                    />
                    <p className="text-xs text-gray-500 mt-1">Calls forward here when routing is set to cell</p>
                  </div>
                </div>

                <div className="mt-4">
                  <Label>Call Routing Mode</Label>
                  <Select
                    value={profile.call_routing_mode || 'sarah_answers'}
                    onValueChange={(v) => handleFieldChange('call_routing_mode', v)}
                  >
                    <SelectTrigger data-testid="select-call-routing" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="forward_to_cell">Forward to Cell Phone</SelectItem>
                      <SelectItem value="sarah_answers">Sarah Answers (AI handles the call)</SelectItem>
                      <SelectItem value="sarah_then_transfer">Sarah Answers, Then Transfers to Cell</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">
                    {profile.call_routing_mode === 'forward_to_cell' && 'Your cell rings first (~4 rings). If you don\'t answer, Sarah takes over. If you\'re off duty, Sarah answers immediately.'}
                    {profile.call_routing_mode === 'sarah_answers' && 'Sarah handles the call, saves lead info, and notifies this rep'}
                    {profile.call_routing_mode === 'sarah_then_transfer' && 'Sarah greets the caller, collects info, then transfers to this rep\'s cell'}
                    {!profile.call_routing_mode && 'Sarah handles the call, saves lead info, and notifies this rep'}
                  </p>
                </div>

                <div className="mt-4 p-4 rounded-lg border border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="font-medium text-sm">Business Hours Scheduling</h4>
                      <p className="text-xs text-gray-500">Outside these hours, Sarah will automatically handle all calls</p>
                    </div>
                    <Switch
                      data-testid="switch-business-hours"
                      checked={!!(profile.data?.after_hours_enabled)}
                      onCheckedChange={(checked) => handleFieldChange('data', { ...(profile.data || {}), after_hours_enabled: checked })}
                    />
                  </div>
                  {profile.data?.after_hours_enabled && (
                    <div className="grid grid-cols-2 gap-4 mt-3">
                      <div>
                        <Label className="text-xs">Available From</Label>
                        <input
                          type="time"
                          data-testid="input-hours-start"
                          value={profile.data?.after_hours_start || '08:00'}
                          onChange={(e) => handleFieldChange('data', { ...(profile.data || {}), after_hours_start: e.target.value })}
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Available Until</Label>
                        <input
                          type="time"
                          data-testid="input-hours-end"
                          value={profile.data?.after_hours_end || '18:00'}
                          onChange={(e) => handleFieldChange('data', { ...(profile.data || {}), after_hours_end: e.target.value })}
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="whatsapp-enabled"
                      checked={profile.whatsapp_enabled || false}
                      onCheckedChange={(checked) => handleFieldChange('whatsapp_enabled', checked)}
                    />
                    <Label htmlFor="whatsapp-enabled">WhatsApp Enabled</Label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Facebook</Label>
                  <Input value={profile.social_facebook || ''} onChange={(e) => handleFieldChange('social_facebook', e.target.value)} />
                </div>
                <div>
                  <Label>LinkedIn</Label>
                  <Input value={profile.social_linkedin || ''} onChange={(e) => handleFieldChange('social_linkedin', e.target.value)} />
                </div>
                <div>
                  <Label>Skype</Label>
                  <Input value={profile.social_skype || ''} onChange={(e) => handleFieldChange('social_skype', e.target.value)} />
                </div>
              </div>

              <div>
                <Label>Email Signature</Label>
                <Textarea value={profile.email_signature || ''} onChange={e => handleFieldChange('email_signature', e.target.value)} />
              </div>

              <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                <h3 className="font-semibold text-base mb-3">Personal Preferences</h3>
                <div className="max-w-xs">
                  <Label htmlFor="preferred-language" className="mb-1 block">Interface Language</Label>
                  <Select
                    value={profile.preferred_language || 'en'}
                    onValueChange={(v) => {
                      handleFieldChange('preferred_language', v);
                      localStorage.setItem('crewcam_language', v);
                      window.dispatchEvent(new StorageEvent('storage', { key: 'crewcam_language', newValue: v }));
                    }}
                  >
                    <SelectTrigger id="preferred-language" data-testid="select-preferred-language">
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Español (Spanish)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">This only affects your own view — other staff keep their own language setting.</p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-2">Member Departments</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {DEPARTMENTS.map(dept => (
                    <div key={dept} className="flex items-center gap-2">
                      <Checkbox
                        id={`dept-${dept}`}
                        checked={profile.departments?.includes(dept) || false}
                        onCheckedChange={() => handleDepartmentChange(dept)}
                      />
                      <Label htmlFor={`dept-${dept}`} className="font-normal">{dept}</Label>
                    </div>
                  ))}
                </div>
              </div>

              {Object.entries(ONBOARDING_CHECKLIST).map(([listName, items]) => (
                <div key={listName}>
                  <h3 className="font-semibold text-lg mb-2">{listName}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {items.map(item => (
                      <div key={item} className="flex items-center gap-2">
                        <Checkbox
                          id={`onboard-${listName}-${item}`}
                          checked={profile.onboarding_checklist?.[listName]?.[item] || false}
                          onCheckedChange={() => handleChecklistChange(listName, item)}
                        />
                        <Label htmlFor={`onboard-${listName}-${item}`} className="font-normal text-sm">{item}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions" className="space-y-6 mt-6">
          {PERMISSIONS_CONFIG.map(({ group, features }) => (
            <Card key={group}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{group}</CardTitle>
                <p className="text-sm text-gray-500">Configure what this staff member can access (ignored if Administrator)</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {features.map(({ name, capabilities }) => (
                    <div key={name} className="border-b pb-3 last:border-0">
                      <h4 className="font-semibold text-sm mb-2">{name}</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {capabilities.map(capability => (
                          <div key={capability} className="flex items-center gap-2">
                            <Checkbox
                              id={`${name}-${capability}`}
                              checked={profile.permissions?.[name]?.[capability] || false}
                              onCheckedChange={() => handlePermissionChange(name, capability)}
                              disabled={profile.is_administrator}
                              data-testid={`perm-${name}-${capability}`}
                            />
                            <Label 
                              htmlFor={`${name}-${capability}`} 
                              className={`font-normal text-xs ${profile.is_administrator ? 'text-gray-400' : ''}`}
                            >
                              {capability.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          {isNewUser ? 'Create Profile' : 'Save Profile'}
        </Button>
      </div>
    </div>
  );
}