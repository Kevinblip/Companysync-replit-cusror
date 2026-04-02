import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, DollarSign, TrendingUp, Calendar, Edit, Trash2, Send, CheckCircle2, Link as LinkIcon, Copy, TestTube } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

export default function FamilyCommissions() {
  const [user, setUser] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [testMode, setTestMode] = useState(false);
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    phone: "",
    commission_percentage: 1,
    notes: "",
    bank_account_holder: "",
    bank_account_number: "",
    bank_routing_number: "",
    bank_name: "",
    auto_payout_enabled: false,
    minimum_payout_threshold: 50
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies', user?.email],
    queryFn: () => base44.entities.Company.list("-created_date"),
    enabled: !!user,
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email) || companies[0];

  const { data: familyMembers = [] } = useQuery({
    queryKey: ['family-members', myCompany?.id],
    queryFn: () => base44.entities.FamilyMember.filter({ company_id: myCompany.id }),
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: commissionRecords = [] } = useQuery({
    queryKey: ['family-commission-records', myCompany?.id],
    queryFn: () => base44.entities.FamilyCommissionRecord.filter({ company_id: myCompany.id }),
    enabled: !!myCompany,
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      if (editingMember) {
        return await base44.entities.FamilyMember.update(editingMember.id, data);
      } else {
        return await base44.entities.FamilyMember.create({
          ...data,
          company_id: myCompany.id
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['family-members'] });
      setDialogOpen(false);
      setEditingMember(null);
      setFormData({
        full_name: "",
        email: "",
        phone: "",
        commission_percentage: 0.5,
        notes: ""
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }) => {
      return await base44.entities.FamilyMember.update(id, { is_active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['family-members'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.FamilyMember.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['family-members'] });
    },
  });

  const updateCommissionStatusMutation = useMutation({
    mutationFn: async ({ id, status, paid_date }) => {
      return await base44.entities.FamilyCommissionRecord.update(id, { 
        status,
        paid_date: status === 'paid' ? paid_date || new Date().toISOString() : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['family-commission-records'] });
    },
  });

  const payoutMutation = useMutation({
    mutationFn: async ({ family_member_id, test_mode }) => {
      const response = await base44.functions.invoke('processFamilyCommissionPayout', {
        family_member_id,
        test_mode: test_mode || false
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['family-commission-records'] });
      queryClient.invalidateQueries({ queryKey: ['family-members'] });
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.error || 'Payout failed');
      }
    },
    onError: (error) => {
      toast.error('Payout failed: ' + error.message);
    }
  });

  const generateLinkMutation = useMutation({
    mutationFn: async (family_member_id) => {
      const response = await base44.functions.invoke('generateFamilyBankSetupLink', {
        family_member_id
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        navigator.clipboard.writeText(data.setup_link);
        toast.success('Setup link copied to clipboard!');
      }
    },
    onError: (error) => {
      toast.error('Failed to generate link: ' + error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const handleEdit = (member) => {
    setEditingMember(member);
    setFormData({
      full_name: member.full_name,
      email: member.email || "",
      phone: member.phone || "",
      commission_percentage: member.commission_percentage || 1,
      notes: member.notes || "",
      bank_account_holder: member.bank_account_holder || "",
      bank_account_number: member.bank_account_number || "",
      bank_routing_number: member.bank_routing_number || "",
      bank_name: member.bank_name || "",
      auto_payout_enabled: member.auto_payout_enabled || false,
      minimum_payout_threshold: member.minimum_payout_threshold || 50
    });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingMember(null);
    setFormData({
      full_name: "",
      email: "",
      phone: "",
      commission_percentage: 1,
      notes: "",
      bank_account_holder: "",
      bank_account_number: "",
      bank_routing_number: "",
      bank_name: "",
      auto_payout_enabled: false,
      minimum_payout_threshold: 50
    });
  };

  const totalEarned = familyMembers.reduce((sum, m) => sum + Number(m.total_earned || 0), 0);
  const totalPending = commissionRecords.filter(r => r.status === 'pending').reduce((sum, r) => sum + Number(r.commission_amount || 0), 0);

  // Determine who's next in round-robin
  const activeMembers = familyMembers.filter(m => m.is_active);
  const nextInLine = activeMembers.sort((a, b) => {
    const aDate = a.last_commission_date ? new Date(a.last_commission_date) : new Date(0);
    const bDate = b.last_commission_date ? new Date(b.last_commission_date) : new Date(0);
    return aDate - bDate;
  })[0];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Family Commissions</h1>
          <p className="text-gray-600 mt-1">
            Automatically distribute commissions from every sale to family members in round-robin (customizable % per member)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
            <TestTube className="w-4 h-4 text-gray-600" />
            <Label className="text-sm font-medium cursor-pointer">Test Mode</Label>
            <Switch
              checked={testMode}
              onCheckedChange={setTestMode}
            />
          </div>
          <Button
            onClick={async () => {
              const now = new Date();
              const currentMonth = now.getMonth() + 1;
              const currentYear = now.getFullYear();
              
              if (confirm(`Process family commissions for all payments from ${currentMonth}/${currentYear}?`)) {
                toast.info('Processing commissions...');
                try {
                  const result = await base44.functions.invoke('backfillFamilyCommissions', {
                    company_id: myCompany.id,
                    month: currentMonth,
                    year: currentYear
                  });
                  if (result.data.success) {
                    toast.success(`✅ Distributed ${result.data.distributed} commissions! (${result.data.already_had_commission} already processed)`);
                    queryClient.invalidateQueries({ queryKey: ['family-members'] });
                    queryClient.invalidateQueries({ queryKey: ['family-commission-records'] });
                  }
                } catch (error) {
                  toast.error('Failed: ' + error.message);
                }
              }
            }}
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
          >
            Process This Month
          </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditingMember(null)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Family Member
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingMember ? 'Edit' : 'Add'} Family Member</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Full Name *</Label>
                <Input
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Email (for notifications)</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              <div>
                <Label>Commission Percentage (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.commission_percentage}
                  onChange={(e) => setFormData({ ...formData, commission_percentage: parseFloat(e.target.value) })}
                />
              </div>
              <div>
                <Label>Notes</Label>
                <Input
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>

              <div className="border-t pt-4 space-y-4">
                <h3 className="font-semibold text-sm">Bank Account Details (for Auto-Payout)</h3>

                <div>
                  <Label>Account Holder Name</Label>
                  <Input
                    value={formData.bank_account_holder}
                    onChange={(e) => setFormData({ ...formData, bank_account_holder: e.target.value })}
                    placeholder="Full name on bank account"
                  />
                </div>

                <div>
                  <Label>Bank Name</Label>
                  <Input
                    value={formData.bank_name}
                    onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                    placeholder="e.g. Chase, Bank of America"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Account Number</Label>
                    <Input
                      value={formData.bank_account_number}
                      onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
                      placeholder="Account number"
                    />
                  </div>
                  <div>
                    <Label>Routing Number</Label>
                    <Input
                      value={formData.bank_routing_number}
                      onChange={(e) => setFormData({ ...formData, bank_routing_number: e.target.value })}
                      placeholder="9-digit routing"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                  <div>
                    <Label className="font-medium">Enable Auto-Payout</Label>
                    <p className="text-xs text-gray-600 mt-1">Automatically send via Wise when threshold is met</p>
                  </div>
                  <Switch
                    checked={formData.auto_payout_enabled}
                    onCheckedChange={(checked) => setFormData({ ...formData, auto_payout_enabled: checked })}
                  />
                </div>

                {formData.auto_payout_enabled && (
                  <div>
                    <Label>Minimum Payout Threshold ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.minimum_payout_threshold}
                      onChange={(e) => setFormData({ ...formData, minimum_payout_threshold: parseFloat(e.target.value) })}
                    />
                    <p className="text-xs text-gray-500 mt-1">Only auto-pay when balance reaches this amount</p>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingMember ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="w-4 h-4" />
              Active Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{familyMembers.filter(m => m.is_active).length}</div>
            <p className="text-xs text-gray-500">In round-robin rotation</p>
          </CardContent>
        </Card>

        <Card className="border-2 border-blue-500 bg-blue-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              Next Up
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {nextInLine ? nextInLine.full_name : 'None'}
            </div>
            <p className="text-xs text-gray-600">
              {nextInLine?.last_commission_date 
                ? `Last: ${new Date(nextInLine.last_commission_date).toLocaleDateString()}`
                : 'Never received'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Total Earned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">${totalEarned.toFixed(2)}</div>
            <p className="text-xs text-gray-500">All time commissions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Pending Payouts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">${totalPending.toFixed(2)}</div>
            <p className="text-xs text-gray-500">Awaiting payment</p>
          </CardContent>
        </Card>
      </div>

      {testMode && (
        <Alert className="bg-orange-50 border-orange-200">
          <TestTube className="w-4 h-4 text-orange-600" />
          <AlertDescription className="text-orange-900">
            <strong>Test Mode Active:</strong> Payouts will be marked as paid without actually sending money via Wise. Perfect for testing the flow!
          </AlertDescription>
        </Alert>
      )}

      {familyMembers.length === 0 && (
        <Alert>
          <Users className="w-4 h-4" />
          <AlertDescription>
            No family members added yet. Click "Add Family Member" to start distributing commissions.
          </AlertDescription>
        </Alert>
      )}

      {familyMembers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Family Members</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Commission %</TableHead>
                  <TableHead>Total Earned</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead>Bank Setup</TableHead>
                  <TableHead>Auto-Pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {familyMembers.map((member) => {
                  const pendingCommissions = commissionRecords.filter(
                    r => r.family_member_id === member.id && r.status === 'pending'
                  );
                  const pendingAmount = pendingCommissions.reduce((sum, r) => sum + r.commission_amount, 0);
                  const hasBankSetup = member.bank_account_number && member.bank_routing_number;

                  return (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.full_name}</TableCell>
                      <TableCell>{member.email || '-'}</TableCell>
                      <TableCell>{member.commission_percentage || 1}%</TableCell>
                      <TableCell>${Number(member.total_earned || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-orange-600">
                            ${Number(pendingAmount || 0).toFixed(2)}
                          </span>
                          {pendingCommissions.length > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {pendingCommissions.length} pending
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {hasBankSetup ? (
                          <Badge className="bg-green-600 flex items-center gap-1 w-fit">
                            <CheckCircle2 className="w-3 h-3" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-500">Not setup</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {member.auto_payout_enabled ? (
                          <Badge className="bg-blue-600">Enabled</Badge>
                        ) : (
                          <Badge variant="outline">Manual</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={member.is_active}
                          onCheckedChange={(checked) =>
                            toggleActiveMutation.mutate({ id: member.id, is_active: checked })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {!hasBankSetup && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-blue-300 text-blue-600 hover:bg-blue-50"
                              onClick={() => generateLinkMutation.mutate(member.id)}
                              disabled={generateLinkMutation.isPending}
                              title="Send setup link to family member"
                            >
                              <LinkIcon className="w-4 h-4 mr-1" />
                              Send Link
                            </Button>
                          )}
                          {hasBankSetup && pendingAmount > 0 && (
                            <Button
                              size="sm"
                              variant="default"
                              className={testMode ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700"}
                              onClick={() => {
                                const message = testMode 
                                  ? `TEST: Mark $${Number(pendingAmount || 0).toFixed(2)} as paid without sending money?`
                                  : `LIVE: Send $${Number(pendingAmount || 0).toFixed(2)} to ${member.full_name} via Wise?`;
                                if (confirm(message)) {
                                  payoutMutation.mutate({ family_member_id: member.id, test_mode: testMode });
                                }
                              }}
                              disabled={payoutMutation.isPending}
                            >
                              {testMode && <TestTube className="w-4 h-4 mr-1" />}
                              {!testMode && <Send className="w-4 h-4 mr-1" />}
                              {testMode ? 'Test Pay' : 'Pay Now'}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(member)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm('Delete this family member?')) {
                                deleteMutation.mutate(member.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Commission History</CardTitle>
        </CardHeader>
        <CardContent>
          {commissionRecords.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No commissions distributed yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Family Member</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Payment ID</TableHead>
                  <TableHead>Sale Amount</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissionRecords
                  .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
                  .slice(0, 50)
                  .map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>
                        {new Date(record.payment_date || record.created_date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{record.family_member_name}</TableCell>
                      <TableCell>{record.customer_name || '-'}</TableCell>
                      <TableCell>
                        <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                          {record.invoice_number || 'N/A'}
                        </code>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                          {record.payment_id?.substring(0, 8) || 'N/A'}...
                        </code>
                      </TableCell>
                      <TableCell>${Number(record.sale_amount || 0).toFixed(2)}</TableCell>
                      <TableCell className="font-semibold text-green-600">
                        ${Number(record.commission_amount || 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            record.status === 'paid'
                              ? 'default'
                              : record.status === 'pending'
                              ? 'secondary'
                              : 'destructive'
                          }
                        >
                          {record.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {record.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateCommissionStatusMutation.mutate({
                                id: record.id,
                                status: 'paid',
                                paid_date: new Date().toISOString()
                              })
                            }
                          >
                            Mark Paid
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}