import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Trash2, AlertTriangle, Building2, Users, CheckCircle, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function DataCleanup() {
  const [user, setUser] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [cleanupReport, setCleanupReport] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const handleAnalyze = async () => {
    if (!selectedCompanyId) {
      alert('Please select your primary company first');
      return;
    }

    setIsAnalyzing(true);
    try {
      const result = await base44.functions.invoke('cleanupDuplicateCompanies', {
        targetCompanyId: selectedCompanyId,
        dryRun: true
      });
      setCleanupReport(result.data);
    } catch (error) {
      alert('Analysis failed: ' + error.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExecute = async () => {
    if (!selectedCompanyId) return;

    const confirmMessage = `⚠️ WARNING: This will permanently delete:

• ${cleanupReport.companies_to_delete.length} duplicate companies
• ${cleanupReport.staff_to_delete.length} duplicate staff profiles

Only "${cleanupReport.target_company.name}" and its ${cleanupReport.staff_to_keep.length} staff members will remain.

This action CANNOT be undone. Are you absolutely sure?`;

    if (!window.confirm(confirmMessage)) return;

    setIsExecuting(true);
    try {
      const result = await base44.functions.invoke('cleanupDuplicateCompanies', {
        targetCompanyId: selectedCompanyId,
        dryRun: false
      });
      
      alert(`✅ Cleanup Complete!\n\n` +
            `Deleted ${result.data.deleted_companies_count} companies\n` +
            `Deleted ${result.data.deleted_staff_count} duplicate staff profiles\n\n` +
            `Your data is now consolidated!`);
      
      setCleanupReport(result.data);
      
      // Refresh the page to reflect changes
      window.location.reload();
    } catch (error) {
      alert('Execution failed: ' + error.message);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Company Data Cleanup</h1>
        <p className="text-gray-600">Remove duplicate companies and staff profiles</p>
      </div>

      <Alert className="bg-yellow-50 border-yellow-200">
        <AlertTriangle className="w-4 h-4 text-yellow-600" />
        <AlertDescription className="text-yellow-800">
          <strong>Important:</strong> This tool identifies and removes duplicate data. 
          Always run "Analyze" first to preview changes before executing.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Step 1: Select Your Primary Company</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Which company should we keep? (All others will be removed)
              </label>
              <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select your primary company..." />
                </SelectTrigger>
                <SelectContent>
                  {companies.map(company => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.company_name || 'Unnamed Company'} 
                      <span className="text-gray-500 text-xs ml-2">
                        (Created by {company.created_by})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button 
              onClick={handleAnalyze} 
              disabled={!selectedCompanyId || isAnalyzing}
              className="w-full"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Building2 className="w-4 h-4 mr-2" />
                  Analyze Duplicates
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {cleanupReport && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Analysis Complete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-semibold text-green-900 mb-2">✅ Will Keep:</h3>
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    Company: {cleanupReport.target_company.name}
                  </p>
                  <p className="text-green-700">
                    {cleanupReport.staff_to_keep.length} staff members
                  </p>
                </div>
              </div>

              {cleanupReport.companies_to_delete.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h3 className="font-semibold text-red-900 mb-3 flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    Will Delete: {cleanupReport.companies_to_delete.length} Companies
                  </h3>
                  <div className="space-y-2">
                    {cleanupReport.companies_to_delete.map(company => (
                      <div key={company.id} className="text-sm bg-white p-2 rounded border border-red-100">
                        <div className="font-medium">{company.name}</div>
                        <div className="text-xs text-gray-500">ID: {company.id}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cleanupReport.duplicate_staff.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h3 className="font-semibold text-orange-900 mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Duplicate Staff Found: {cleanupReport.duplicate_staff.length}
                  </h3>
                  <div className="space-y-3">
                    {cleanupReport.duplicate_staff.map(dup => (
                      <div key={dup.email} className="bg-white p-3 rounded border border-orange-100">
                        <div className="font-medium mb-2">{dup.email}</div>
                        <div className="text-xs space-y-1">
                          {dup.profiles.map(profile => (
                            <div 
                              key={profile.id} 
                              className={`flex items-center justify-between p-1 rounded ${
                                profile.in_target_company ? 'bg-green-100' : 'bg-red-100'
                              }`}
                            >
                              <span>{profile.full_name}</span>
                              <Badge className={profile.in_target_company ? 'bg-green-600' : 'bg-red-600'}>
                                {profile.in_target_company ? 'Keep' : 'Delete'}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cleanupReport.staff_to_delete.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h3 className="font-semibold text-red-900 mb-3">
                    Will Delete: {cleanupReport.staff_to_delete.length} Duplicate Staff Profiles
                  </h3>
                  <div className="space-y-1 text-sm">
                    {cleanupReport.staff_to_delete.map(staff => (
                      <div key={staff.id} className="bg-white p-2 rounded border border-red-100">
                        {staff.full_name} ({staff.email})
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Alert className="bg-blue-50 border-blue-200">
                <AlertDescription className="text-blue-800">
                  <strong>Summary:</strong> This will consolidate all data under "{cleanupReport.target_company.name}" 
                  and remove {cleanupReport.companies_to_delete.length} duplicate companies plus {cleanupReport.staff_to_delete.length} duplicate staff profiles.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card className="border-red-200">
            <CardHeader className="bg-red-50">
              <CardTitle className="text-red-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Execute Cleanup
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <Alert className="bg-red-50 border-red-300 mb-4">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  <strong>WARNING:</strong> This action is permanent and cannot be undone. 
                  Make sure you've reviewed the analysis above carefully.
                </AlertDescription>
              </Alert>

              <Button
                onClick={handleExecute}
                disabled={isExecuting || cleanupReport.executed}
                className="w-full bg-red-600 hover:bg-red-700 h-12"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Executing Cleanup...
                  </>
                ) : cleanupReport.executed ? (
                  <>
                    <CheckCircle className="w-5 h-5 mr-2" />
                    Cleanup Already Executed
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5 mr-2" />
                    Execute Cleanup (Delete {cleanupReport.companies_to_delete.length + cleanupReport.staff_to_delete.length} Records)
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}