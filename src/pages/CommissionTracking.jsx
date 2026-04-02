import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DollarSign,
  TrendingUp,
  Award,
  Target,
  Calendar,
  Download,
  Filter,
  Users,
  Percent,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";

export default function CommissionTracking() {
  const navigate = useNavigate();
  const [selectedPeriod, setSelectedPeriod] = useState('current_month');
  const [selectedStaff, setSelectedStaff] = useState('all');

  const { user, myCompany, isAdmin, effectiveUserEmail, isPermissionsReady } = useRoleBasedData();

  const { data: allStaffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-commission', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices-commission', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: commissionDeductions = [] } = useQuery({
    queryKey: ['commission-deductions', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CommissionDeduction.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: commissionRules = [] } = useQuery({
    queryKey: ['commission-rules', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CommissionRule.filter({ company_id: myCompany.id, is_active: true }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const visibleStaffProfiles = React.useMemo(() => {
    if (!isPermissionsReady) return [];
    if (isAdmin) return allStaffProfiles;
    // Non-admins can only see their own commission data
    return allStaffProfiles.filter(s => s.user_email === effectiveUserEmail);
  }, [allStaffProfiles, isAdmin, effectiveUserEmail, isPermissionsReady]);

  // Temporarily override allStaffProfiles with filtered version for calculateCommissionData
  const commissionData = React.useMemo(() => {
    const now = new Date();
    let startDate, endDate;
    if (selectedPeriod === 'current_month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (selectedPeriod === 'last_month') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (selectedPeriod === 'current_quarter') {
      const quarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), quarter * 3, 1);
      endDate = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
    } else if (selectedPeriod === 'ytd') {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = now;
    } else {
      startDate = new Date(0);
      endDate = now;
    }
    const periodInvoices = invoices.filter(inv => {
      if (!inv.issue_date || inv.status !== 'paid') return false;
      const issueDate = new Date(inv.issue_date);
      return issueDate >= startDate && issueDate <= endDate;
    });
    return visibleStaffProfiles.map(staff => {
      let totalSales = 0;
      let totalCommission = 0;
      let invoiceCount = 0;
      periodInvoices.forEach(inv => {
        if (inv.commission_splits && inv.commission_splits.length > 0) {
          const split = inv.commission_splits.find(s => s.user_email === staff.user_email);
          if (split) {
            const splitAmount = inv.amount * (split.split_percentage / 100);
            totalSales += splitAmount;
            const commissionRate = staff.commission_rate || 5;
            totalCommission += splitAmount * (commissionRate / 100);
            invoiceCount++;
          }
        } else if (inv.sale_agent === staff.user_email || inv.created_by === staff.user_email) {
          totalSales += inv.amount || 0;
          const commissionRate = staff.commission_rate || 5;
          totalCommission += (inv.amount || 0) * (commissionRate / 100);
          invoiceCount++;
        }
      });
      const periodDeductions = commissionDeductions.filter(ded => {
        if (ded.sales_rep_email !== staff.user_email) return false;
        if (!ded.deduction_date) return false;
        const dedDate = new Date(ded.deduction_date);
        return dedDate >= startDate && dedDate <= endDate;
      });
      const totalDeductions = periodDeductions.reduce((sum, ded) => sum + Number(ded.amount || 0), 0);
      const netCommission = totalCommission - totalDeductions;
      return {
        email: staff.user_email,
        name: staff.full_name || staff.user_email,
        avatar_url: staff.avatar_url,
        totalSales,
        totalCommission,
        totalDeductions,
        netCommission,
        invoiceCount,
        commission_rate: staff.commission_rate || 5,
        deductionCount: periodDeductions.length,
        commission_tier: staff.commission_tier,
        current_period_sales: staff.current_period_sales || 0,
        deductions: periodDeductions,
      };
    }).sort((a, b) => b.netCommission - a.netCommission);
  }, [visibleStaffProfiles, invoices, commissionDeductions, selectedPeriod]);

  const filteredData = selectedStaff === 'all' 
    ? commissionData 
    : commissionData.filter(c => c.email === selectedStaff);

  const totalSales = commissionData.reduce((sum, s) => sum + s.totalSales, 0);
  const totalCommissions = commissionData.reduce((sum, s) => sum + s.totalCommission, 0);
  const totalDeductions = commissionData.reduce((sum, s) => sum + s.totalDeductions, 0);
  const totalNet = totalCommissions - totalDeductions;

  const handleExport = () => {
    const headers = ['Staff Name', 'Email', 'Total Sales', 'Invoice Count', 'Gross Commission', 'Deductions', 'Net Commission', 'Commission Rate'];
    const rows = filteredData.map(staff => [
      staff.name,
      staff.email,
      Number(staff.totalSales || 0).toFixed(2),
      staff.invoiceCount,
      Number(staff.totalCommission || 0).toFixed(2),
      Number(staff.totalDeductions || 0).toFixed(2),
      Number(staff.netCommission || 0).toFixed(2),
      `${staff.commission_rate}%`
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commission_report_${selectedPeriod}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Commission Tracking</h1>
          <p className="text-gray-500 mt-1">Detailed sales and commission analytics</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(createPageUrl('CommissionReport'))}>
            <Calendar className="w-4 h-4 mr-2" />
            Old Report
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
        <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current_month">Current Month</SelectItem>
            <SelectItem value="last_month">Last Month</SelectItem>
            <SelectItem value="current_quarter">Current Quarter</SelectItem>
            <SelectItem value="ytd">Year to Date</SelectItem>
            <SelectItem value="all_time">All Time</SelectItem>
          </SelectContent>
        </Select>

        <Select value={selectedStaff} onValueChange={setSelectedStaff}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="All Staff Members" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Staff Members</SelectItem>
            {visibleStaffProfiles.filter(s => s.user_email).map(staff => (
              <SelectItem key={staff.user_email} value={staff.user_email}>
                {staff.full_name || staff.user_email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Total Sales</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">
                  ${totalSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </p>
              </div>
              <DollarSign className="w-10 h-10 text-blue-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Gross Commissions</p>
                <p className="text-2xl font-bold text-green-600 mt-1">
                  ${totalCommissions.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </p>
              </div>
              <TrendingUp className="w-10 h-10 text-green-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Total Deductions</p>
                <p className="text-2xl font-bold text-red-600 mt-1">
                  ${totalDeductions.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </p>
              </div>
              <ArrowDownRight className="w-10 h-10 text-red-600 opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600">Net Payable</p>
                <p className="text-2xl font-bold text-purple-600 mt-1">
                  ${totalNet.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </p>
              </div>
              <Award className="w-10 h-10 text-purple-600 opacity-20" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Staff Commission Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-gray-50">
                <tr className="text-left text-xs text-gray-600 uppercase">
                  <th className="p-4 font-medium">Staff Member</th>
                  <th className="p-4 font-medium">Rate</th>
                  <th className="p-4 font-medium">Sales</th>
                  <th className="p-4 font-medium">Deals</th>
                  <th className="p-4 font-medium">Gross Commission</th>
                  <th className="p-4 font-medium">Deductions</th>
                  <th className="p-4 font-medium">Net Commission</th>
                  <th className="p-4 font-medium">Tier</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((staff, index) => (
                  <tr key={staff.email} className="border-b hover:bg-gray-50">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-white font-bold text-sm">
                          {index + 1}
                        </div>
                        {staff.avatar_url ? (
                          <img src={staff.avatar_url} alt={staff.name} className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
                            {staff.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <p className="font-medium">{staff.name}</p>
                          <p className="text-xs text-gray-500">{staff.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant="outline" className="bg-blue-50 text-blue-700">
                        <Percent className="w-3 h-3 mr-1" />
                        {staff.commission_rate}%
                      </Badge>
                    </td>
                    <td className="p-4 font-semibold text-blue-600">
                      ${staff.totalSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                    <td className="p-4 text-gray-600">
                      {staff.invoiceCount}
                    </td>
                    <td className="p-4 font-semibold text-green-600">
                      ${staff.totalCommission.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                    <td className="p-4 font-semibold text-red-600">
                      -${staff.totalDeductions.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      {staff.deductionCount > 0 && (
                        <span className="text-xs text-gray-500 ml-1">({staff.deductionCount})</span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-lg text-purple-600">
                        ${staff.netCommission.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </div>
                    </td>
                    <td className="p-4">
                      {staff.commission_tier ? (
                        <Badge className="bg-yellow-100 text-yellow-800">
                          {staff.commission_tier}
                        </Badge>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredData.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-gray-500">
                      No commission data for selected period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {commissionRules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              Active Commission Rules
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {commissionRules.map(rule => (
                <div key={rule.id} className="p-4 border rounded-lg bg-gradient-to-r from-blue-50 to-purple-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{rule.rule_name}</h3>
                      {rule.description && (
                        <p className="text-sm text-gray-600 mt-1">{rule.description}</p>
                      )}
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className="bg-white">
                          <Percent className="w-3 h-3 mr-1" />
                          {rule.base_rate_percentage}% base rate
                        </Badge>
                        {rule.min_deal_amount && (
                          <Badge variant="outline" className="bg-white">
                            Min: ${rule.min_deal_amount.toLocaleString()}
                          </Badge>
                        )}
                        {rule.max_deal_amount && (
                          <Badge variant="outline" className="bg-white">
                            Max: ${rule.max_deal_amount.toLocaleString()}
                          </Badge>
                        )}
                        {rule.applies_to_staff_email && (
                          <Badge className="bg-blue-100 text-blue-700">
                            {allStaffProfiles.find(s => s.user_email === rule.applies_to_staff_email)?.full_name || rule.applies_to_staff_email}
                          </Badge>
                        )}
                      </div>
                      {rule.tiered_rates && rule.tiered_rates.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <p className="text-xs font-semibold text-gray-700">Tiered Rates:</p>
                          {rule.tiered_rates.map((tier, idx) => (
                            <div key={idx} className="text-xs text-gray-600 flex items-center gap-2">
                              <ArrowUpRight className="w-3 h-3 text-green-600" />
                              <span>
                                ${tier.threshold_amount.toLocaleString()}+ → {tier.rate_percentage}%
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Badge className="bg-green-100 text-green-700">
                      Priority {rule.priority || 0}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}