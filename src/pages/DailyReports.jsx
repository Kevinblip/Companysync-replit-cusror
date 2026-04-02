import React, { useState, useEffect, useRef } from "react";
import useTranslation from "@/hooks/useTranslation";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Calendar, Download, Award, Target, CheckCircle, AlertCircle, Trash2, RefreshCw, Info, Phone, Mail, MessageSquare, DollarSign, TrendingUp, Edit, Save, X, Plus, Upload, FileText, Camera, Maximize2, Users } from "lucide-react";
import { format } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function DailyReports() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingReport, setEditingReport] = useState(null);
  const [manualNotes, setManualNotes] = useState("");
  const [customSections, setCustomSections] = useState([]);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSection, setNewSection] = useState({ section_title: "", section_content: "", section_type: "notes" });
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showScreenshotView, setShowScreenshotView] = useState(false);
  const [screenshotReport, setScreenshotReport] = useState(null);
  const [showRegeneratePicker, setShowRegeneratePicker] = useState(false);
  const [regenerateDate, setRegenerateDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  });
  const fileInputRef = useRef(null);
  const screenshotRef = useRef(null);
  
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-reports', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  useEffect(() => {
    if (user && companies.length > 0) {
      const ownedCompany = companies.find(c => c.created_by === user.email);
      if (ownedCompany) {
        setMyCompany(ownedCompany);
        return;
      }
      
      if (staffProfiles.length === 0) {
        setMyCompany(null);
        return;
      }
      
      if (staffProfiles.length > 1) {
        console.warn(`⚠️ User ${user.email} has ${staffProfiles.length} staff profiles. Using company with most activity.`);
        
        const profilesByCompany = {};
        staffProfiles.forEach(profile => {
          const cid = profile.company_id;
          if (!profilesByCompany[cid]) {
            profilesByCompany[cid] = [];
          }
          profilesByCompany[cid].push(profile);
        });
        
        let bestCompanyId = null;
        let maxStaff = 0;
        
        Object.entries(profilesByCompany).forEach(([companyId, profiles]) => {
          if (profiles.length > maxStaff) {
            maxStaff = profiles.length;
            bestCompanyId = companyId;
          }
        });
        
        if (bestCompanyId) {
          setMyCompany(companies.find(c => c.id === bestCompanyId));
          return;
        }
      }
      
      const staffProfile = staffProfiles[0];
      if (staffProfile?.company_id) {
        setMyCompany(companies.find(c => c.id === staffProfile.company_id));
      }
    }
  }, [user, companies, staffProfiles]);

  const { data: reports = [] } = useQuery({
    queryKey: ['daily-reports', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const dailyReports = await base44.entities.DailyReport.filter({ company_id: myCompany.id });
      return dailyReports.sort((a, b) => new Date(b.created_date || b.created_at) - new Date(a.created_date || a.created_at));
    },
    enabled: !!myCompany,
    initialData: [],
  });

  const deleteReportMutation = useMutation({
    mutationFn: (id) => base44.entities.DailyReport.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
    },
  });

  const updateReportMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.DailyReport.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
      setEditingReport(null);
    },
  });

  const handleGenerateReport = async (date = null, reportType = 'end_of_day') => {
    if (!myCompany) {
      alert('Company not found');
      return;
    }

    let reportDateString;
    if (date) {
      reportDateString = date;
    } else {
      // Use company's timezone (default: America/New_York = EST)
      const companyTimezone = myCompany.settings?.time_zone || 'America/New_York';
      const now = new Date();
      
      console.log('🕐 Generating report for timezone:', companyTimezone);
      console.log('🕐 Browser time (UTC):', now.toISOString());
      
      const options = { timeZone: companyTimezone, year: 'numeric', month: '2-digit', day: '2-digit' };
      const formatter = new Intl.DateTimeFormat('en-US', options);
      const parts = formatter.formatToParts(now);
      const year = parts.find(p => p.type === 'year').value;
      const month = parts.find(p => p.type === 'month').value;
      const day = parts.find(p => p.type === 'day').value;
      reportDateString = `${year}-${month}-${day}`;
      
      console.log('🕐 Report date in EST:', reportDateString);
      console.log('🕐 Full formatted:', formatter.format(now));
    }

    const existingReport = reports.find(r => 
      r.report_date === reportDateString && r.report_type === reportType
    );
    if (existingReport) {
      const shouldRegenerate = window.confirm(
        `⚠️ A ${reportType === 'morning_briefing' ? 'morning briefing' : 'daily report'} for ${formatReportDate(reportDateString)} already exists.\n\n` +
        `Do you want to delete the old one and generate a fresh report?`
      );
      
      if (!shouldRegenerate) {
        return;
      }
      
      await deleteReportMutation.mutateAsync(existingReport.id);
    }

    setIsGenerating(true);

    try {
      const functionName = reportType === 'morning_briefing' ? 'generateMorningReport' : 'generateDailyReport';
      const response = await base44.functions.invoke(functionName, {
        reportDate: reportDateString,
        companyId: myCompany.id
      });

      if (response.data.success || response.data.reports_generated > 0) {
        queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
        alert(`✅ ${reportType === 'morning_briefing' ? 'Morning briefing' : 'Daily report'} generated by Lexi!`);
      } else {
        alert('❌ Failed: ' + (response.data.error || response.data.message || 'Unknown error'));
      }
    } catch (error) {
      alert('❌ Failed to generate report: ' + error.message);
    }

    setIsGenerating(false);
  };

  const handleDeleteReport = async (reportId, reportDate) => {
    if (!window.confirm(`Delete report for ${formatReportDate(reportDate)}?`)) {
      return;
    }
    
    deleteReportMutation.mutate(reportId);
  };

  const handleDeleteDuplicates = async () => {
    if (!window.confirm('⚠️ This will delete all duplicate reports, keeping only the LATEST report for each date. Continue?')) {
      return;
    }

    const reportsByDate = {};
    
    reports.forEach(report => {
      if (!reportsByDate[report.report_date]) {
        reportsByDate[report.report_date] = [];
      }
      reportsByDate[report.report_date].push(report);
    });

    let deletedCount = 0;
    for (const dateReports of Object.values(reportsByDate)) {
      if (dateReports.length > 1) {
        dateReports.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        
        for (let i = 1; i < dateReports.length; i++) {
          await deleteReportMutation.mutateAsync(dateReports[i].id);
          deletedCount++;
        }
      }
    }

    alert(`✅ Deleted ${deletedCount} duplicate reports!`);
  };

  const handleEditReport = (report) => {
    setEditingReport(report);
    setManualNotes(report.manual_notes || "");
    setCustomSections(report.custom_sections || []);
  };

  const handleSaveManualEdits = async () => {
    if (!editingReport) return;

    updateReportMutation.mutate({
      id: editingReport.id,
      data: {
        manual_notes: manualNotes,
        custom_sections: customSections
      }
    });
  };

  const handleAddSection = () => {
    if (!newSection.section_title || !newSection.section_content) {
      alert('Please fill in section title and content');
      return;
    }

    setCustomSections([...customSections, { ...newSection }]);
    setNewSection({ section_title: "", section_content: "", section_type: "notes" });
    setShowAddSection(false);
  };

  const handleDeleteSection = (index) => {
    setCustomSections(customSections.filter((_, i) => i !== index));
  };

  const handleFileUpload = async (e, report) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploadingFile(true);

    try {
      const currentAttachments = report.attachments || [];
      const newAttachments = [];

      for (const file of files) {
        const uploadResult = await base44.integrations.Core.UploadFile({ file });
        
        newAttachments.push({
          file_name: file.name,
          file_url: uploadResult.file_url,
          file_type: file.type,
          uploaded_by: user?.full_name || user?.email,
          uploaded_at: new Date().toISOString()
        });
      }

      await base44.entities.DailyReport.update(report.id, {
        attachments: [...currentAttachments, ...newAttachments]
      });

      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
    } catch (error) {
      alert('Failed to upload file: ' + error.message);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleOpenScreenshotView = (report) => {
    setScreenshotReport(report);
    setShowScreenshotView(true);
  };

  const downloadReport = (report) => {
    // Support both summary and ai_summary fields
    const reportSummary = report.summary || report.ai_summary || 'No summary available';
    
    const content = `
DAILY BUSINESS REPORT
${myCompany?.company_name || 'Your Company'}
Date: ${formatReportDate(report.report_date)}

${reportSummary}

🎯 HIGHLIGHTS:
${(report.highlights || []).map(h => `✓ ${h}`).join('\n')}

⚠️ CONCERNS:
${(report.concerns || []).map(c => `• ${c}`).join('\n')}

📊 COMPANY METRICS:
- New Leads: ${report.metrics?.new_leads || 0}
- New Customers: ${report.metrics?.new_customers || 0}
- Appointments: ${report.metrics?.appointments_scheduled || 0}
- Estimates Sent: ${report.metrics?.estimates_sent || 0}
- Invoices Sent: ${report.metrics?.invoices_sent || 0}
- Payments: ${report.metrics?.payments_received || 0} ($${Number(report.metrics?.payments_amount || 0).toFixed(2)})
- Tasks Done: ${report.metrics?.tasks_completed || 0}

📞 COMMUNICATIONS:
- Calls: ${report.metrics?.calls_made || 0} out / ${report.metrics?.calls_received || 0} in
- SMS: ${report.metrics?.sms_sent || 0} sent / ${report.metrics?.sms_received || 0} received
- Emails: ${report.metrics?.emails_sent || 0} sent

${report.staff_activity && report.staff_activity.length > 0 ? `
👥 TEAM PERFORMANCE BREAKDOWN:
${report.staff_activity.map(staff => `
${staff.staff_name}:
  • Activities: ${staff.total_activities}
  • Calls: ${staff.calls_made} out / ${staff.calls_received} in
  • Emails: ${staff.emails_sent}
  • SMS: ${staff.sms_sent}
  • Leads: ${staff.leads_created}
  • Estimates: ${staff.estimates_sent}
  • Invoices: ${staff.invoices_created}
  • Tasks: ${staff.tasks_completed}
  • Revenue: $${Number(staff.revenue_generated || 0).toFixed(2)}
  • Est. Commission: $${Number(staff.estimated_commission || 0).toFixed(2)}
`).join('\n')}
` : ''}

${report.follow_ups_needed && report.follow_ups_needed.length > 0 ? `
🔔 FOLLOW-UPS NEEDED:
${report.follow_ups_needed.map(f => `${f.priority === 'high' ? '🔴' : '🟡'} ${f.customer_name}: ${f.reason}${f.assigned_to ? ` - ${f.assigned_to}` : ''}`).join('\n')}
` : ''}

${report.manual_notes ? `
📝 MANUAL NOTES:
${report.manual_notes}
` : ''}

${report.custom_sections && report.custom_sections.length > 0 ? `
📋 CUSTOM SECTIONS:
${report.custom_sections.map(s => `
${s.section_title}:
${s.section_content}
`).join('\n')}
` : ''}

Generated by Lexi AI Assistant
    `;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-report-${report.report_date}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const formatReportDate = (dateString) => {
    if (!dateString) return 'Unknown Date';
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return format(date, 'EEEE, MMMM d, yyyy');
  };

  const reportsByDate = {};
  reports.forEach(report => {
    if (!reportsByDate[report.report_date]) {
      reportsByDate[report.report_date] = [];
    }
    reportsByDate[report.report_date].push(report);
  });

  const duplicatesExist = Object.values(reportsByDate).some(dateReports => dateReports.length > 1);

  const uniqueReports = Object.entries(reportsByDate).map(([date, dateReports]) => {
    const sorted = dateReports.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    return {
      date,
      latestReport: sorted[0],
      duplicateCount: sorted.length - 1,
      allReports: sorted
    };
  }).sort((a, b) => b.date.localeCompare(a.date));

  // Group reports by type
  const morningReports = reports.filter(r => r.report_type === 'morning_briefing');
  const eodReports = reports.filter(r => r.report_type === 'end_of_day' || !r.report_type);

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-purple-600" />
            {t.reports.dailyReports}
          </h1>
          <p className="text-gray-500 mt-1">AI-generated summaries + your operational notes</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {duplicatesExist && (
            <Button 
              onClick={handleDeleteDuplicates}
              variant="outline"
              className="border-red-500 text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t.common.delete} Duplicates
            </Button>
          )}

          {/* Regenerate for a past date */}
          {showRegeneratePicker ? (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-1.5">
              <span className="text-xs font-semibold text-amber-700 whitespace-nowrap">Fix date:</span>
              <Input
                type="date"
                value={regenerateDate}
                onChange={e => setRegenerateDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="h-8 w-36 text-sm border-amber-300"
                data-testid="input-regenerate-date"
              />
              <Button
                size="sm"
                onClick={() => { handleGenerateReport(regenerateDate, 'end_of_day'); setShowRegeneratePicker(false); }}
                disabled={isGenerating || !regenerateDate}
                className="bg-amber-500 hover:bg-amber-600 text-white h-8 text-xs"
                data-testid="button-regenerate-eod"
              >
                {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Regenerate EOD'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowRegeneratePicker(false)}
                className="h-8 text-amber-700 hover:bg-amber-100"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => setShowRegeneratePicker(true)}
              disabled={isGenerating}
              className="border-amber-400 text-amber-700 hover:bg-amber-50"
              data-testid="button-show-regenerate"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Fix Past Report
            </Button>
          )}

          <Button 
            onClick={() => handleGenerateReport(null, 'morning_briefing')}
            disabled={isGenerating}
            className="bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t.common.loading}
              </>
            ) : (
              <>
                🌅 Generate Morning Briefing
              </>
            )}
          </Button>
          <Button 
            onClick={() => handleGenerateReport(null, 'end_of_day')}
            disabled={isGenerating}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t.common.loading}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                {t.reports.generate}
              </>
            )}
          </Button>
        </div>
      </div>

      {duplicatesExist && (
        <Alert className="border-yellow-500 bg-yellow-50">
          <AlertDescription className="flex items-center justify-between">
            <span className="text-yellow-800">
              ⚠️ You have duplicate reports for some dates. Click "Delete Duplicates" to clean them up.
            </span>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {uniqueReports.map(({ date, latestReport, duplicateCount, allReports }) => {
          // Support both summary and ai_summary fields for backwards compatibility
          const reportSummary = latestReport.summary || latestReport.ai_summary || 'No summary available - please regenerate this report';
          
          return (
          <Card key={date} className="bg-white shadow-lg hover:shadow-xl transition-shadow">
            <CardHeader className={`border-b ${latestReport.report_type === 'morning_briefing' ? 'bg-gradient-to-r from-yellow-100 via-amber-100 to-orange-100 border-b-4 border-amber-400' : 'bg-gradient-to-r from-purple-50 to-blue-50'}`}>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-xl flex items-center gap-2">
                    {latestReport.report_type === 'morning_briefing' ? (
                      <>
                        <span className="text-2xl">🌅</span>
                        <span className="font-bold text-amber-900">{myCompany?.company_name || 'CompanySync'} - Morning Report</span>
                      </>
                    ) : (
                      <>
                        <Calendar className="w-5 h-5 text-purple-600" />
                        {formatReportDate(date)}
                      </>
                    )}
                    {duplicateCount > 0 && (
                      <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-300">
                        +{duplicateCount} duplicate{duplicateCount > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </CardTitle>
                  <p className={`text-sm mt-1 ${latestReport.report_type === 'morning_briefing' ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>
                    {latestReport.report_type === 'morning_briefing' ? formatReportDate(date) : `${t.reports.generate}d ${format(new Date(latestReport.created_date), 'MMM d, h:mm a')}`}
                  </p>
                  {latestReport.report_type === 'morning_briefing' && (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {latestReport.metrics?.overnight_storms > 0 && (
                        <Badge className="bg-gradient-to-r from-red-600 to-orange-600 text-white shadow-lg animate-pulse">
                          🌪️ {latestReport.metrics.overnight_storms} Storm{latestReport.metrics.overnight_storms > 1 ? 's' : ''} Detected
                        </Badge>
                      )}
                      {latestReport.metrics?.scheduled_events > 0 && (
                        <Badge className="bg-blue-600 text-white">📅 {latestReport.metrics.scheduled_events} Events Today</Badge>
                      )}
                      {latestReport.metrics?.critical_tasks > 0 && (
                        <Badge className="bg-red-600 text-white">🚨 {latestReport.metrics.critical_tasks} Critical Tasks</Badge>
                      )}
                      {latestReport.metrics?.new_leads > 0 && (
                        <Badge className="bg-green-600 text-white">🎯 {latestReport.metrics.new_leads} New Leads</Badge>
                      )}
                      {latestReport.metrics?.overdue_invoices > 0 && (
                        <Badge className="bg-orange-600 text-white">💰 {latestReport.metrics.overdue_invoices} Overdue</Badge>
                      )}
                      {latestReport.metrics?.pending_estimates > 0 && (
                        <Badge className="bg-purple-600 text-white">📊 {latestReport.metrics.pending_estimates} Pending Est.</Badge>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {duplicateCount > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        if (window.confirm(`Delete ${duplicateCount} older report${duplicateCount > 1 ? 's' : ''} for this date?`)) {
                          allReports.slice(1).forEach(r => deleteReportMutation.mutate(r.id));
                        }
                      }}
                      className="text-yellow-600 border-yellow-300 hover:bg-yellow-50"
                    >
                      <RefreshCw className="w-4 h-4 mr-1" />
                      Clean {duplicateCount}
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleOpenScreenshotView(latestReport)}
                  >
                    <Maximize2 className="w-4 h-4 mr-1" />
                    Screenshot View
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => downloadReport(latestReport)}
                  >
                    <Download className="w-4 h-4 mr-1" />
                    {t.common.download}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleEditReport(latestReport)}
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    {t.common.add} {t.common.notes}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleDeleteReport(latestReport.id, date)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-6">
              <div>
                {latestReport.report_type === 'morning_briefing' && (
                  <h3 className="font-semibold text-lg mb-3 text-amber-900">
                    **{myCompany?.company_name || 'CompanySync'} Morning Report**
                  </h3>
                )}
                <div className={`rounded-lg p-4 border-l-4 ${latestReport.report_type === 'morning_briefing' ? 'bg-yellow-50 border-amber-500' : 'bg-blue-50 border-blue-500'}`}>
                  <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{reportSummary}</p>
                </div>
              </div>

              {latestReport.report_type !== 'morning_briefing' && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Popover>
                    <PopoverTrigger asChild>
                      <div className="bg-green-50 rounded-lg p-3 border border-green-200 cursor-pointer hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-green-700 mb-1">{t.dashboard.totalLeads}</div>
                          <Info className="w-3 h-3 text-green-500" />
                        </div>
                        <div className="text-2xl font-bold text-green-900">{latestReport.metrics?.new_leads || 0}</div>
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                      <div className="space-y-2">
                        <h4 className="font-semibold">New Leads Today</h4>
                        <p className="text-sm text-gray-600">
                          Total new leads added to the system on {formatReportDate(date)}.
                        </p>
                        <div className="text-xs text-gray-500 mt-2">
                          <div>🎯 Status breakdown available in activities section</div>
                          <div>📊 Lead sources tracked in database</div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover>
                    <PopoverTrigger asChild>
                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-200 cursor-pointer hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-blue-700 mb-1">{t.calendar.appointment}s</div>
                          <Info className="w-3 h-3 text-blue-500" />
                        </div>
                        <div className="text-2xl font-bold text-blue-900">{latestReport.metrics?.appointments_scheduled || 0}</div>
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                      <div className="space-y-2">
                        <h4 className="font-semibold">Appointments Scheduled</h4>
                        <p className="text-sm text-gray-600">
                          New appointments created today. Check Activities section below for specific times and details.
                        </p>
                        {(latestReport.metrics?.appointments_updated || 0) > 0 && (
                          <div className="text-xs bg-yellow-50 p-2 rounded border border-yellow-200 text-yellow-800">
                            📅 {latestReport.metrics.appointments_updated} appointment(s) were also rescheduled today
                          </div>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover>
                    <PopoverTrigger asChild>
                      <div className="bg-purple-50 rounded-lg p-3 border border-purple-200 cursor-pointer hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-purple-700 mb-1">{t.estimates.title} {t.invoices.sent}</div>
                          <Info className="w-3 h-3 text-purple-500" />
                        </div>
                        <div className="text-2xl font-bold text-purple-900">{latestReport.metrics?.estimates_sent || 0}</div>
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                      <div className="space-y-2">
                        <h4 className="font-semibold">Estimates Sent to Customers</h4>
                        <p className="text-sm text-gray-600">
                          Estimates marked as 'sent' or 'viewed' today. These are actively in customer hands.
                        </p>
                        <div className="text-xs text-gray-500 mt-2">
                          💡 Track acceptance rate in Sales Dashboard
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Popover>
                    <PopoverTrigger asChild>
                      <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200 cursor-pointer hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-emerald-700 mb-1">{t.sidebar.payments}</div>
                          <Info className="w-3 h-3 text-emerald-500" />
                        </div>
                        <div className="text-2xl font-bold text-emerald-900">
                          ${((latestReport.metrics?.payments_amount || 0)).toFixed(0)}
                        </div>
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                      <div className="space-y-2">
                        <h4 className="font-semibold">Payments Received Today</h4>
                        <div className="text-sm text-gray-600 space-y-1">
                          <div>💰 Amount: ${((latestReport.metrics?.payments_amount || 0)).toFixed(2)}</div>
                          <div>📝 Transactions: {latestReport.metrics?.payments_received || 0}</div>
                        </div>
                        <div className="text-xs text-gray-500 mt-2 pt-2 border-t">
                          💡 Team commissions calculated automatically
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              {latestReport.highlights && latestReport.highlights.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    {latestReport.report_type === 'morning_briefing' ? 'Key Opportunities Today' : t.dashboard.recentActivity}
                  </h3>
                  <div className="space-y-2">
                    {latestReport.highlights.map((highlight, i) => (
                      <Popover key={i}>
                        <PopoverTrigger asChild>
                          <div className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer hover:shadow-md transition-shadow group ${
                            latestReport.report_type === 'morning_briefing' 
                              ? 'bg-green-100 border-green-300' 
                              : 'bg-green-50 border-green-200'
                          }`}>
                            <span className="text-green-600 font-bold">{latestReport.report_type === 'morning_briefing' ? '🎯' : '✓'}</span>
                            <p className="text-sm text-gray-700 flex-1">{highlight}</p>
                            <Info className="w-4 h-4 text-green-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                          <div className="space-y-2">
                            <h4 className="font-semibold text-green-700">
                              {latestReport.report_type === 'morning_briefing' ? 'Opportunity Details' : 'Highlight Details'}
                            </h4>
                            <p className="text-sm text-gray-600">{highlight}</p>
                            <div className="text-xs text-gray-500 pt-2 border-t">
                              💡 {latestReport.report_type === 'morning_briefing' ? 'Take action on these items today' : 'Check Activities section for specific staff contributions'}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    ))}
                  </div>
                </div>
              )}

              {latestReport.concerns && latestReport.concerns.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                    {latestReport.report_type === 'morning_briefing' ? 'Urgent Action Items' : 'Needs Attention'}
                  </h3>
                  <div className="space-y-2">
                    {latestReport.concerns.map((concern, i) => (
                      <Popover key={i}>
                        <PopoverTrigger asChild>
                          <div className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer hover:shadow-md transition-shadow group ${
                            latestReport.report_type === 'morning_briefing'
                              ? 'bg-red-100 border-red-300'
                              : 'bg-orange-50 border-orange-200'
                          }`}>
                            <span className={latestReport.report_type === 'morning_briefing' ? 'text-red-700 font-bold' : 'text-orange-600 font-bold'}>⚠️</span>
                            <p className="text-sm text-gray-700 flex-1">{concern}</p>
                            <Info className="w-4 h-4 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                          <div className="space-y-2">
                            <h4 className="font-semibold text-red-700">
                              {latestReport.report_type === 'morning_briefing' ? 'Urgent - Action Needed Today' : 'Action Required'}
                            </h4>
                            <p className="text-sm text-gray-600">{concern}</p>
                            <div className="text-xs text-gray-500 pt-2 border-t">
                              {latestReport.report_type === 'morning_briefing' 
                                ? '🚨 Priority action - address this first today'
                                : '🎯 Review follow-ups section below for specific action items'}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    ))}
                  </div>
                </div>
              )}

              {latestReport.staff_activity && latestReport.staff_activity.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Award className="w-5 h-5 text-blue-600" />
                    {t.reports.performance}
                  </h3>
                  <div className="grid gap-4">
                    {latestReport.staff_activity
                      .sort((a, b) => b.total_activities - a.total_activities)
                      .map((staff, index) => (
                      <Popover key={staff.staff_email}>
                        <PopoverTrigger asChild>
                          <Card className="bg-gradient-to-r from-gray-50 to-white border-l-4 border-l-blue-500 cursor-pointer hover:shadow-lg transition-shadow group">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center font-bold text-blue-600">
                                    #{index + 1}
                                  </div>
                                  <div>
                                    <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                                      {staff.staff_name}
                                      <Info className="w-4 h-4 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </h4>
                                    <p className="text-xs text-gray-500">{staff.total_activities || 0} activities</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-lg font-bold text-green-600">
                                    ${Number(staff.revenue_generated || 0).toFixed(2)}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    ~${Number(staff.estimated_commission || 0).toFixed(2)} commission
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                <div className="bg-blue-50 rounded p-2">
                                  <div className="text-gray-600">{t.calendar.call}s</div>
                                  <div className="font-semibold text-blue-900">
                                    {staff.calls_made || 0} out / {staff.calls_received || 0} in
                                  </div>
                                </div>
                                <div className="bg-purple-50 rounded p-2">
                                  <div className="text-gray-600">{t.customers.email}s</div>
                                  <div className="font-semibold text-purple-900">{staff.emails_sent || 0}</div>
                                </div>
                                <div className="bg-green-50 rounded p-2">
                                  <div className="text-gray-600">{t.sidebar.leads}</div>
                                  <div className="font-semibold text-green-900">{staff.leads_created || 0}</div>
                                </div>
                                <div className="bg-orange-50 rounded p-2">
                                  <div className="text-gray-600">{t.sidebar.estimates}</div>
                                  <div className="font-semibold text-orange-900">{staff.estimates_sent || 0}</div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </PopoverTrigger>
                        <PopoverContent className="w-96 p-0" side="right">
                          <ScrollArea className="max-h-[600px]">
                            <div className="p-4 space-y-3">
                              <div className="flex items-center gap-3 pb-3 border-b sticky top-0 bg-white z-10">
                                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center font-bold text-blue-600 text-lg">
                                  {staff.staff_name?.[0] || '?'}
                                </div>
                                <div>
                                  <h4 className="font-semibold text-lg">{staff.staff_name}</h4>
                                  <p className="text-xs text-gray-500">{staff.staff_email}</p>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="flex items-center gap-2">
                                    <Phone className="w-4 h-4 text-blue-500" />
                                    Outbound {t.calendar.call}s
                                  </span>
                                  <span className="font-semibold">{staff.calls_made || 0}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="flex items-center gap-2">
                                    <Phone className="w-4 h-4 text-green-500" />
                                    Inbound {t.calendar.call}s
                                  </span>
                                  <span className="font-semibold">{staff.calls_received || 0}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="flex items-center gap-2">
                                    <Mail className="w-4 h-4 text-purple-500" />
                                    {t.customers.email}s {t.invoices.sent}
                                  </span>
                                  <span className="font-semibold">{staff.emails_sent || 0}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="flex items-center gap-2">
                                    <MessageSquare className="w-4 h-4 text-blue-500" />
                                    SMS {t.invoices.sent}
                                  </span>
                                  <span className="font-semibold">{staff.sms_sent || 0}</span>
                                </div>
                              </div>

                              <div className="pt-2 border-t space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4 text-green-500" />
                                    {t.accounting.revenue} {t.reports.generate}d
                                  </span>
                                  <span className="font-bold text-green-600">${Number(staff.revenue_generated || 0).toFixed(2)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-blue-500" />
                                    Estimated {t.sidebar.commissionTracker}
                                  </span>
                                  <span className="font-bold text-blue-600">${Number(staff.estimated_commission || 0).toFixed(2)}</span>
                                </div>
                              </div>

                              <div className="pt-2 border-t">
                                <div className="text-xs text-gray-600 space-y-1">
                                  <div>✅ {t.sidebar.tasks} {t.common.completed}: {staff.tasks_completed || 0}</div>
                                  <div>📊 {t.sidebar.invoices} {t.reports.generate}d: {staff.invoices_created || 0}</div>
                                  <div>📈 {t.common.total} {t.sidebar.activityFeed}: {staff.total_activities || 0}</div>
                                </div>
                              </div>
                            </div>
                          </ScrollArea>
                        </PopoverContent>
                      </Popover>
                    ))}
                  </div>
                </div>
              )}

              {latestReport.follow_ups_needed && latestReport.follow_ups_needed.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Target className="w-5 h-5 text-blue-600" />
                    {latestReport.report_type === 'morning_briefing' ? 'Action Items for Today' : `${t.calendar.followUp}s ${t.common.required}`}
                  </h3>
                  <div className="space-y-2">
                    {latestReport.follow_ups_needed.map((followup, i) => (
                      <Popover key={i}>
                        <PopoverTrigger asChild>
                          <div className={`p-3 rounded-lg border cursor-pointer hover:shadow-md transition-shadow group ${
                            latestReport.report_type === 'morning_briefing'
                              ? followup.priority === 'high' ? 'bg-red-50 border-red-300' : 'bg-yellow-50 border-yellow-300'
                              : 'bg-blue-50 border-blue-200'
                          }`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-gray-900 flex items-center gap-2">
                                {followup.customer_name}
                                <Info className="w-4 h-4 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </span>
                              <Badge className={followup.priority === 'high' ? 'bg-red-600 text-white' : 'bg-amber-600 text-white'}>
                                {followup.priority}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-700">{followup.reason}</p>
                            {followup.assigned_to && (
                              <p className="text-xs text-gray-500 mt-1">{t.tasks.assignedTo}: {followup.assigned_to}</p>
                            )}
                            {!followup.assigned_to && latestReport.report_type === 'morning_briefing' && (
                              <p className="text-xs text-red-600 mt-1 font-medium">⚠️ NEEDS ASSIGNMENT</p>
                            )}
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-96">
                          <div className="space-y-3">
                            <div>
                              <h4 className="font-semibold text-lg">{followup.customer_name}</h4>
                              <Badge className={followup.priority === 'high' ? 'bg-red-500 mt-2' : 'bg-yellow-500 mt-2'}>
                                {followup.priority} Priority
                              </Badge>
                            </div>
                            
                            <div className="space-y-2 text-sm">
                              <div>
                                <span className="font-medium text-gray-700">Issue:</span>
                                <p className="text-gray-600 mt-1">{followup.reason}</p>
                              </div>
                              
                              {followup.assigned_to && (
                                <div>
                                  <span className="font-medium text-gray-700">Assigned to:</span>
                                  <p className="text-gray-600">{followup.assigned_to}</p>
                                </div>
                              )}

                              <div className="pt-2 border-t">
                                <span className="font-medium text-gray-700">Suggested Actions:</span>
                                <ul className="list-disc list-inside text-gray-600 mt-1 space-y-1">
                                  {followup.priority === 'high' ? (
                                    <>
                                      <li>Contact immediately via phone</li>
                                      <li>Send follow-up email if no answer</li>
                                      <li>Schedule callback task</li>
                                    </>
                                  ) : (
                                    <>
                                      <li>Send friendly check-in email</li>
                                      <li>Schedule follow-up call this week</li>
                                      <li>Update CRM notes with response</li>
                                    </>
                                  )}
                                </ul>
                              </div>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    ))}
                  </div>
                </div>
              )}

              {latestReport.assignments && latestReport.assignments.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-blue-600" />
                    {t.sidebar.tasks}
                  </h3>
                  <div className="space-y-3">
                    {latestReport.assignments.map((assignment, i) => (
                      <div key={i} className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-gray-900">{assignment.customer_name}</h4>
                          {assignment.status && (
                            <Badge variant="outline">{assignment.status}</Badge>
                          )}
                        </div>
                        {assignment.details && (
                          <p className="text-sm text-gray-700 mb-2">{assignment.details}</p>
                        )}
                        {assignment.communications && assignment.communications.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {assignment.communications.map((comm, idx) => (
                              <p key={idx} className="text-xs text-gray-600 pl-3 border-l-2 border-blue-300">
                                {comm}
                              </p>
                            ))}
                          </div>
                        )}
                        {assignment.assigned_to && (
                          <p className="text-xs text-gray-500 mt-2">
                            {t.tasks.assignedTo}: {assignment.assigned_to}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {latestReport.blast_messages && latestReport.blast_messages.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-purple-600" />
                    {t.sidebar.messages} {t.invoices.sent}
                  </h3>
                  <div className="space-y-3">
                    {latestReport.blast_messages.map((blast, i) => (
                      <div key={i} className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold text-gray-900">{blast.blast_type}</h4>
                          {blast.sent_at && (
                            <span className="text-xs text-gray-500">
                              {format(new Date(blast.sent_at), 'h:mm a')}
                            </span>
                          )}
                        </div>
                        <div className="bg-white p-3 rounded border border-purple-200 mb-2">
                          <p className="text-sm text-gray-700 whitespace-pre-wrap italic">
                            "{blast.message_content}"
                          </p>
                        </div>
                        {blast.recipients && blast.recipients.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-gray-600 font-semibold mb-1">
                              Recipients ({blast.recipients.length}):
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {blast.recipients.map((recipient, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {recipient}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {latestReport.scheduled_inspections && latestReport.scheduled_inspections.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-orange-600" />
                    {t.calendar.inspection}s
                  </h3>
                  <div className="grid gap-2">
                    {latestReport.scheduled_inspections.map((inspection, i) => (
                      <div key={i} className="bg-orange-50 p-3 rounded-lg border border-orange-200">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-gray-900">{inspection.customer_name}</span>
                          <span className="text-sm text-gray-600">{inspection.scheduled_time}</span>
                        </div>
                        {inspection.inspector && (
                          <p className="text-xs text-gray-500 mt-1">Inspector: {inspection.inspector}</p>
                        )}
                        {inspection.notes && (
                          <p className="text-sm text-gray-700 mt-2">{inspection.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {latestReport.recruitment_activity && latestReport.recruitment_activity.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Users className="w-5 h-5 text-teal-600" />
                    {t.sidebar.staffManagement}
                  </h3>
                  <div className="space-y-2">
                    {latestReport.recruitment_activity.map((recruit, i) => (
                      <div key={i} className="bg-teal-50 p-3 rounded-lg border border-teal-200">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-gray-900">{recruit.candidate_name}</span>
                          {recruit.status && (
                            <Badge variant="outline">{recruit.status}</Badge>
                          )}
                        </div>
                        {recruit.notes && (
                          <p className="text-sm text-gray-700">{recruit.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {latestReport.top_activities && latestReport.top_activities.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3">{t.sidebar.activityFeed}</h3>
                  <div className="space-y-2">
                    {latestReport.top_activities.map((activity, i) => (
                      <Popover key={i}>
                        <PopoverTrigger asChild>
                          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:shadow-md transition-shadow group">
                            <div className="w-2 h-2 rounded-full bg-purple-500 mt-1.5"></div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-900">{activity.description}</span>
                                <span className="text-xs text-gray-500">{activity.time}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-xs">{activity.type}</Badge>
                                {activity.staff_email && (
                                  <span className="text-xs text-gray-500">{activity.staff_email}</span>
                                )}
                                <Info className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                              </div>
                            </div>
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Badge variant="outline">{activity.type}</Badge>
                              <span className="text-xs text-gray-500">{activity.time}</span>
                            </div>
                            <p className="text-sm text-gray-700">{activity.description}</p>
                            {activity.staff_email && (
                              <div className="text-xs text-gray-500 pt-2 border-t">
                                👤 Performed by: {activity.staff_email}
                              </div>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    ))}
                  </div>
                </div>
              )}

              {latestReport.manual_notes && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" />
                    {t.common.notes}
                  </h3>
                  <div className="bg-indigo-50 rounded-lg p-4 border-l-4 border-indigo-500">
                    <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{latestReport.manual_notes}</p>
                  </div>
                </div>
              )}

              {latestReport.custom_sections && latestReport.custom_sections.length > 0 && (
                <div className="space-y-4">
                  {latestReport.custom_sections.map((section, i) => (
                    <div key={i}>
                      <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-blue-600" />
                        {section.section_title}
                      </h3>
                      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{section.section_content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {latestReport.attachments && latestReport.attachments.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Camera className="w-5 h-5 text-pink-600" />
                    {t.dashboard.photos}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {latestReport.attachments.map((file, i) => (
                      <a
                        key={i}
                        href={file.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        {file.file_type?.startsWith('image/') ? (
                          <img 
                            src={file.file_url} 
                            alt={file.file_name}
                            className="w-full h-32 object-cover rounded-lg border-2 border-gray-200 hover:border-blue-500 transition-colors"
                          />
                        ) : (
                          <div className="w-full h-32 bg-gray-100 rounded-lg border-2 border-gray-200 hover:border-blue-500 transition-colors flex flex-col items-center justify-center p-2">
                            <FileText className="w-8 h-8 text-gray-400 mb-2" />
                            <p className="text-xs text-center text-gray-600 truncate w-full">{file.file_name}</p>
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )})}

        {reports.length === 0 && (
          <Card className="bg-white">
            <CardContent className="py-12 text-center">
              <Sparkles className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg mb-2">{t.common.noResults}</p>
              <p className="text-gray-400 text-sm mb-4">Click the button above to generate your first daily report!</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={editingReport !== null} onOpenChange={() => setEditingReport(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.common.add} {t.common.notes}</DialogTitle>
            <p className="text-sm text-gray-500">
              Enhance Lexi's AI report with your operational notes, assignments, and photos
            </p>
          </DialogHeader>

          <div className="space-y-6">
            <div>
              <Label>General Notes</Label>
              <Textarea
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                rows={6}
                placeholder="Add your operational notes here...&#10;&#10;Example:&#10;- Brenda Bell - permit given to Raffy&#10;- Leonard Ulrich - asked Scott to call HO&#10;- Anthony President - Scott scheduled to inspect today"
                className="font-mono text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <Label>Custom Sections</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddSection(!showAddSection)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Section
                </Button>
              </div>

              {showAddSection && (
                <Card className="mb-3 bg-blue-50 border-blue-200">
                  <CardContent className="p-4 space-y-3">
                    <div>
                      <Label>Section Title</Label>
                      <Input
                        value={newSection.section_title}
                        onChange={(e) => setNewSection({...newSection, section_title: e.target.value})}
                        placeholder="e.g., Assignments, New Leads, Claims Updates"
                      />
                    </div>
                    <div>
                      <Label>Section Type</Label>
                      <Select
                        value={newSection.section_type}
                        onValueChange={(v) => setNewSection({...newSection, section_type: v})}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="assignments">Assignments</SelectItem>
                          <SelectItem value="inspections">Inspections</SelectItem>
                          <SelectItem value="follow_ups">Follow-ups</SelectItem>
                          <SelectItem value="claims">Claims</SelectItem>
                          <SelectItem value="blast_messages">Blast Messages</SelectItem>
                          <SelectItem value="recruitment">Recruitment</SelectItem>
                          <SelectItem value="notes">General Notes</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Content</Label>
                      <Textarea
                        value={newSection.section_content}
                        onChange={(e) => setNewSection({...newSection, section_content: e.target.value})}
                        rows={4}
                        placeholder="Enter section details..."
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleAddSection} size="sm" className="bg-blue-600">
                        <Save className="w-4 h-4 mr-2" />
                        Add Section
                      </Button>
                      <Button onClick={() => setShowAddSection(false)} variant="outline" size="sm">
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {customSections.length > 0 && (
                <div className="space-y-2">
                  {customSections.map((section, i) => (
                    <Card key={i} className="bg-gray-50">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{section.section_type}</Badge>
                            <span className="font-semibold">{section.section_title}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteSection(i)}
                            className="h-6 w-6 text-red-600"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{section.section_content}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label>Attach Photos/Files</Label>
              <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-blue-500 transition-colors cursor-pointer">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx"
                  onChange={(e) => handleFileUpload(e, editingReport)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  className="w-full"
                >
                  {uploadingFile ? (
                    <Loader2 className="w-8 h-8 mx-auto mb-2 text-gray-400 animate-spin" />
                  ) : (
                    <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                  )}
                  <p className="text-sm text-gray-600">
                    {uploadingFile ? 'Uploading...' : 'Click to upload photos or documents'}
                  </p>
                </button>
              </div>

              {editingReport?.attachments && editingReport.attachments.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {editingReport.attachments.map((file, i) => (
                    <div key={i} className="relative group">
                      {file.file_type?.startsWith('image/') ? (
                        <img 
                          src={file.file_url} 
                          alt={file.file_name}
                          className="w-full h-24 object-cover rounded border"
                        />
                      ) : (
                        <div className="w-full h-24 bg-gray-100 rounded border flex items-center justify-center">
                          <FileText className="w-6 h-6 text-gray-400" />
                        </div>
                      )}
                      <div className="text-xs text-gray-500 truncate mt-1">{file.file_name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setEditingReport(null)}>
                {t.common.cancel}
              </Button>
              <Button onClick={handleSaveManualEdits} className="bg-blue-600 hover:bg-blue-700">
                <Save className="w-4 h-4 mr-2" />
                {t.common.save} {t.common.actions}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showScreenshotView} onOpenChange={setShowScreenshotView}>
        <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto p-0">
          <div ref={screenshotRef} className="bg-white p-8">
            {screenshotReport && (
              <>
                <div className="text-center mb-8 pb-6 border-b-2 border-gray-300">
                  {myCompany?.logo_url && (
                    <img 
                      src={myCompany.logo_url} 
                      alt="Company Logo" 
                      className="h-16 mx-auto mb-4"
                    />
                  )}
                  <h1 className="text-3xl font-bold text-gray-900">
                    {myCompany?.company_name || 'Daily Business Report'}
                  </h1>
                  <p className="text-xl text-gray-600 mt-2">
                    {formatReportDate(screenshotReport.report_date)}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Generated by Lexi AI • {format(new Date(screenshotReport.created_date), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>

                <div className="mb-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                    {screenshotReport.report_type === 'morning_briefing' 
                      ? `${myCompany?.company_name || 'CompanySync'} Morning Report`
                      : 'Executive Summary'}
                  </h2>
                  <div className={`rounded-lg p-4 border-l-4 ${screenshotReport.report_type === 'morning_briefing' ? 'bg-yellow-50 border-amber-500' : 'bg-blue-50 border-blue-500'}`}>
                    <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{screenshotReport.summary || screenshotReport.ai_summary || 'No summary available'}</p>
                  </div>
                </div>

                <div className="mb-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-3">Key Metrics</h2>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-green-50 rounded-lg p-3 border border-green-200 text-center">
                      <div className="text-xs text-green-700 mb-1">{t.dashboard.totalLeads}</div>
                      <div className="text-2xl font-bold text-green-900">{screenshotReport.metrics?.new_leads || 0}</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 border border-blue-200 text-center">
                      <div className="text-xs text-blue-700 mb-1">{t.calendar.appointment}s</div>
                      <div className="text-2xl font-bold text-blue-900">{screenshotReport.metrics?.appointments_scheduled || 0}</div>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3 border border-purple-200 text-center">
                      <div className="text-xs text-purple-700 mb-1">{t.sidebar.estimates}</div>
                      <div className="text-2xl font-bold text-purple-900">{screenshotReport.metrics?.estimates_sent || 0}</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200 text-center">
                      <div className="text-xs text-emerald-700 mb-1">{t.accounting.revenue}</div>
                      <div className="text-2xl font-bold text-emerald-900">${Number(screenshotReport.metrics?.payments_amount || 0).toFixed(0)}</div>
                    </div>
                  </div>
                  
                  {/* Additional Metrics Row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    <div className="bg-sky-50 rounded-lg p-3 border border-sky-200 text-center">
                      <div className="text-xs text-sky-700 mb-1">{t.calendar.call}s</div>
                      <div className="text-lg font-bold text-sky-900">
                        {screenshotReport.metrics?.calls_made || 0} out / {screenshotReport.metrics?.calls_received || 0} in
                      </div>
                    </div>
                    <div className="bg-violet-50 rounded-lg p-3 border border-violet-200 text-center">
                      <div className="text-xs text-violet-700 mb-1">{t.customers.email}s {t.invoices.sent}</div>
                      <div className="text-2xl font-bold text-violet-900">{screenshotReport.metrics?.emails_sent || 0}</div>
                    </div>
                    <div className="bg-cyan-50 rounded-lg p-3 border border-cyan-200 text-center">
                      <div className="text-xs text-cyan-700 mb-1">SMS</div>
                      <div className="text-lg font-bold text-cyan-900">
                        {screenshotReport.metrics?.sms_sent || 0} sent / {screenshotReport.metrics?.sms_received || 0} in
                      </div>
                    </div>
                    <div className="bg-teal-50 rounded-lg p-3 border border-teal-200 text-center">
                      <div className="text-xs text-teal-700 mb-1">New {t.sidebar.customers}</div>
                      <div className="text-2xl font-bold text-teal-900">{screenshotReport.metrics?.new_customers || 0}</div>
                    </div>
                  </div>

                  {/* Third Metrics Row */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                    <div className="bg-amber-50 rounded-lg p-3 border border-amber-200 text-center">
                      <div className="text-xs text-amber-700 mb-1">{t.sidebar.invoices} {t.reports.generate}d</div>
                      <div className="text-2xl font-bold text-amber-900">{screenshotReport.metrics?.invoices_sent || 0}</div>
                    </div>
                    <div className="bg-lime-50 rounded-lg p-3 border border-lime-200 text-center">
                      <div className="text-xs text-lime-700 mb-1">{t.sidebar.tasks} {t.common.completed}</div>
                      <div className="text-2xl font-bold text-lime-900">{screenshotReport.metrics?.tasks_completed || 0}</div>
                    </div>
                    <div className="bg-rose-50 rounded-lg p-3 border border-rose-200 text-center">
                      <div className="text-xs text-rose-700 mb-1">{t.sidebar.payments} Received</div>
                      <div className="text-2xl font-bold text-rose-900">{screenshotReport.metrics?.payments_received || 0}</div>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6 mb-6">
                  {screenshotReport.highlights && screenshotReport.highlights.length > 0 && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        {t.dashboard.recentActivity}
                      </h2>
                      <div className="space-y-2">
                        {screenshotReport.highlights.map((highlight, i) => (
                          <div key={i} className="flex items-start gap-2 bg-green-50 p-3 rounded-lg border border-green-200">
                            <span className="text-green-600 font-bold">✓</span>
                            <p className="text-sm text-gray-700">{highlight}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {screenshotReport.concerns && screenshotReport.concerns.length > 0 && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-orange-600" />
                        Needs Attention
                      </h2>
                      <div className="space-y-2">
                        {screenshotReport.concerns.map((concern, i) => (
                          <div key={i} className="flex items-start gap-2 bg-orange-50 p-3 rounded-lg border border-orange-200">
                            <span className="text-orange-600 font-bold">⚠️</span>
                            <p className="text-sm text-gray-700">{concern}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {screenshotReport.staff_activity && screenshotReport.staff_activity.length > 0 && (
                  <div className="mb-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <Award className="w-5 h-5 text-blue-600" />
                      {t.reports.performance}
                    </h2>
                    {screenshotReport.staff_activity.slice(0, 5).map((staff, index) => (
                      <div key={staff.staff_email} className="bg-gray-50 rounded-lg p-4 mb-3 border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold text-gray-900">#{index + 1} {staff.staff_name}</h4>
                          <div className="text-right">
                            <div className="font-bold text-green-600">${Number(staff.revenue_generated || 0).toFixed(2)}</div>
                            <div className="text-xs text-gray-500">~${Number(staff.estimated_commission || 0).toFixed(2)} commission</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div>{t.calendar.call}s: <strong>{staff.calls_made || 0}/{staff.calls_received || 0}</strong></div>
                          <div>{t.customers.email}s: <strong>{staff.emails_sent || 0}</strong></div>
                          <div>{t.sidebar.leads}: <strong>{staff.leads_created || 0}</strong></div>
                          <div>{t.sidebar.activityFeed}: <strong>{staff.total_activities || 0}</strong></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {screenshotReport.manual_notes && (
                  <div className="mb-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-indigo-600" />
                      Operational Notes
                    </h2>
                    <div className="bg-indigo-50 rounded-lg p-4 border-l-4 border-indigo-500">
                      <p className="text-gray-800 leading-relaxed whitespace-pre-wrap font-mono text-sm">{screenshotReport.manual_notes}</p>
                    </div>
                  </div>
                )}

                {screenshotReport.custom_sections && screenshotReport.custom_sections.length > 0 && (
                  <div className="mb-6 space-y-4">
                    {screenshotReport.custom_sections.map((section, i) => (
                      <div key={i}>
                        <h2 className="text-xl font-bold text-gray-900 mb-3">
                          {section.section_title}
                        </h2>
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                          <p className="text-gray-800 leading-relaxed whitespace-pre-wrap font-mono text-sm">{section.section_content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {screenshotReport.attachments && screenshotReport.attachments.length > 0 && (
                  <div className="mb-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <Camera className="w-5 h-5 text-pink-600" />
                      Attachments
                    </h2>
                    <div className="grid grid-cols-3 gap-3">
                      {screenshotReport.attachments.map((file, i) => (
                        file.file_type?.startsWith('image/') && (
                          <img 
                            key={i}
                            src={file.file_url} 
                            alt={file.file_name}
                            className="w-full h-48 object-cover rounded-lg border-2 border-gray-200"
                          />
                        )
                      ))}
                    </div>
                  </div>
                )}

                {screenshotReport.follow_ups_needed && screenshotReport.follow_ups_needed.length > 0 && (
                  <div className="mb-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <Target className="w-5 h-5 text-blue-600" />
                      Follow-ups Needed
                    </h2>
                    <div className="space-y-2">
                      {screenshotReport.follow_ups_needed.map((followup, i) => (
                        <div key={i} className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-gray-900">{followup.customer_name}</span>
                            <Badge className={followup.priority === 'high' ? 'bg-red-500' : 'bg-yellow-500'}>
                              {followup.priority}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-700">{followup.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-center mt-8 pt-6 border-t-2 border-gray-300">
                  <p className="text-sm text-gray-500">
                    Generated by Lexi AI Assistant • {myCompany?.company_name}
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="sticky bottom-0 bg-white border-t p-4 flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowScreenshotView(false)}>
              Close
            </Button>
            <Button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700">
              <Download className="w-4 h-4 mr-2" />
              Print / Save as PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}