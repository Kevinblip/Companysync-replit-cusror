import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Percent, Trash2, Edit, Target, TrendingUp } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export default function CommissionRules() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState({
    rule_name: "",
    description: "",
    base_rate_percentage: 5,
    applies_to_staff_email: "",
    applies_to_role_id: "",
    trigger_entity_type: "Invoice",
    min_deal_amount: "",
    max_deal_amount: "",
    product_category: "",
    customer_type: "all",
    is_new_customer_only: false,
    tiered_rates: [],
    is_active: true,
    priority: 0
  });

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-rules'],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  React.useEffect(() => {
    if (user && companies.length > 0) {
      const ownedCompany = companies.find(c => c.created_by === user.email);
      if (ownedCompany) {
        setMyCompany(ownedCompany);
        return;
      }
      
      const staffProfile = staffProfiles[0];
      if (staffProfile?.company_id) {
        const staffCompany = companies.find(c => c.id === staffProfile.company_id);
        setMyCompany(staffCompany);
      }
    }
  }, [user, companies, staffProfiles]);

  const { data: commissionRules = [] } = useQuery({
    queryKey: ['commission-rules', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CommissionRule.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allStaff = [] } = useQuery({
    queryKey: ['all-staff', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: staffRoles = [] } = useQuery({
    queryKey: ['staff-roles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffRole.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createRuleMutation = useMutation({
    mutationFn: (data) => base44.entities.CommissionRule.create({
      ...data,
      company_id: myCompany?.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rules'] });
      handleCloseDialog();
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CommissionRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rules'] });
      handleCloseDialog();
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id) => base44.entities.CommissionRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rules'] });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!myCompany) {
      alert("Please set up your company first!");
      return;
    }

    const dataToSubmit = {
      ...formData,
      min_deal_amount: formData.min_deal_amount ? parseFloat(formData.min_deal_amount) : undefined,
      max_deal_amount: formData.max_deal_amount ? parseFloat(formData.max_deal_amount) : undefined,
    };

    if (editingRule) {
      updateRuleMutation.mutate({ id: editingRule.id, data: dataToSubmit });
    } else {
      createRuleMutation.mutate(dataToSubmit);
    }
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData({
      rule_name: rule.rule_name || "",
      description: rule.description || "",
      base_rate_percentage: rule.base_rate_percentage || 5,
      applies_to_staff_email: rule.applies_to_staff_email || "",
      applies_to_role_id: rule.applies_to_role_id || "",
      trigger_entity_type: rule.trigger_entity_type || "Invoice",
      min_deal_amount: rule.min_deal_amount || "",
      max_deal_amount: rule.max_deal_amount || "",
      product_category: rule.product_category || "",
      customer_type: rule.customer_type || "all",
      is_new_customer_only: rule.is_new_customer_only || false,
      tiered_rates: rule.tiered_rates || [],
      is_active: rule.is_active !== false,
      priority: rule.priority || 0
    });
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingRule(null);
    setFormData({
      rule_name: "",
      description: "",
      base_rate_percentage: 5,
      applies_to_staff_email: "",
      applies_to_role_id: "",
      trigger_entity_type: "Invoice",
      min_deal_amount: "",
      max_deal_amount: "",
      product_category: "",
      customer_type: "all",
      is_new_customer_only: false,
      tiered_rates: [],
      is_active: true,
      priority: 0
    });
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this commission rule?')) {
      deleteRuleMutation.mutate(id);
    }
  };

  const addTier = () => {
    setFormData({
      ...formData,
      tiered_rates: [
        ...formData.tiered_rates,
        { threshold_amount: 0, rate_percentage: 5 }
      ]
    });
  };

  const updateTier = (index, field, value) => {
    const newTiers = [...formData.tiered_rates];
    newTiers[index][field] = parseFloat(value) || 0;
    setFormData({ ...formData, tiered_rates: newTiers });
  };

  const removeTier = (index) => {
    const newTiers = formData.tiered_rates.filter((_, i) => i !== index);
    setFormData({ ...formData, tiered_rates: newTiers });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Commission Rules</h1>
          <p className="text-gray-500 mt-1">Define flexible commission structures for your team</p>
        </div>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingRule(null); handleCloseDialog(); setShowDialog(true); }} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              New Rule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingRule ? 'Edit Commission Rule' : 'Create Commission Rule'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Rule Name *</Label>
                  <Input
                    value={formData.rule_name}
                    onChange={(e) => setFormData({...formData, rule_name: e.target.value})}
                    placeholder="e.g., New Business Roofing Commission"
                    required
                  />
                </div>

                <div className="col-span-2">
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="When does this rule apply?"
                    rows={2}
                  />
                </div>

                <div>
                  <Label>Base Commission Rate % *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.base_rate_percentage}
                    onChange={(e) => setFormData({...formData, base_rate_percentage: parseFloat(e.target.value) || 0})}
                    required
                  />
                </div>

                <div>
                  <Label>Priority</Label>
                  <Input
                    type="number"
                    value={formData.priority}
                    onChange={(e) => setFormData({...formData, priority: parseInt(e.target.value) || 0})}
                    placeholder="0"
                  />
                </div>

                <div>
                  <Label>Applies to Staff (Optional)</Label>
                  <Select value={formData.applies_to_staff_email} onValueChange={(v) => setFormData({...formData, applies_to_staff_email: v})}>
                    <SelectTrigger>
                      <SelectValue placeholder="All staff" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Staff</SelectItem>
                      {allStaff.filter(s => s.user_email).map(staff => (
                        <SelectItem key={staff.user_email} value={staff.user_email}>
                          {staff.full_name || staff.user_email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Applies to Role (Optional)</Label>
                  <Select value={formData.applies_to_role_id} onValueChange={(v) => setFormData({...formData, applies_to_role_id: v})}>
                    <SelectTrigger>
                      <SelectValue placeholder="All roles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>All Roles</SelectItem>
                      {staffRoles.map(role => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Min Deal Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.min_deal_amount}
                    onChange={(e) => setFormData({...formData, min_deal_amount: e.target.value})}
                    placeholder="0"
                  />
                </div>

                <div>
                  <Label>Max Deal Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.max_deal_amount}
                    onChange={(e) => setFormData({...formData, max_deal_amount: e.target.value})}
                    placeholder="No limit"
                  />
                </div>

                <div>
                  <Label>Customer Type</Label>
                  <Select value={formData.customer_type} onValueChange={(v) => setFormData({...formData, customer_type: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Customers</SelectItem>
                      <SelectItem value="residential">Residential Only</SelectItem>
                      <SelectItem value="commercial">Commercial Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.is_new_customer_only}
                    onCheckedChange={(checked) => setFormData({...formData, is_new_customer_only: checked})}
                  />
                  <Label>New Customers Only</Label>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({...formData, is_active: checked})}
                  />
                  <Label>Active</Label>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-base font-semibold">Tiered Commission Rates (Optional)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addTier}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Tier
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  Define progressive rates based on cumulative sales. E.g., 5% for first $50k, 7% for next $50k, etc.
                </p>
                <div className="space-y-2">
                  {formData.tiered_rates.map((tier, index) => (
                    <div key={index} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1">
                        <Label className="text-xs">Threshold $</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={tier.threshold_amount}
                          onChange={(e) => updateTier(index, 'threshold_amount', e.target.value)}
                          placeholder="50000"
                        />
                      </div>
                      <div className="flex-1">
                        <Label className="text-xs">Rate %</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={tier.rate_percentage}
                          onChange={(e) => updateTier(index, 'rate_percentage', e.target.value)}
                          placeholder="7"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTier(index)}
                        className="mt-5 text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                  {editingRule ? 'Update Rule' : 'Create Rule'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {commissionRules.map(rule => (
          <Card key={rule.id} className={`${rule.is_active ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-gray-300 opacity-60'}`}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-gray-900">{rule.rule_name}</h3>
                    <Badge className="bg-blue-100 text-blue-700">
                      <Percent className="w-3 h-3 mr-1" />
                      {rule.base_rate_percentage}%
                    </Badge>
                    {!rule.is_active && (
                      <Badge variant="outline" className="bg-gray-100">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  
                  {rule.description && (
                    <p className="text-sm text-gray-600 mb-3">{rule.description}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {rule.applies_to_staff_email && (
                      <Badge variant="outline">
                        Staff: {allStaff.find(s => s.user_email === rule.applies_to_staff_email)?.full_name || rule.applies_to_staff_email}
                      </Badge>
                    )}
                    {rule.applies_to_role_id && (
                      <Badge variant="outline">
                        Role: {staffRoles.find(r => r.id === rule.applies_to_role_id)?.name || rule.applies_to_role_id}
                      </Badge>
                    )}
                    {rule.min_deal_amount && (
                      <Badge variant="outline">
                        Min: ${rule.min_deal_amount.toLocaleString()}
                      </Badge>
                    )}
                    {rule.max_deal_amount && (
                      <Badge variant="outline">
                        Max: ${rule.max_deal_amount.toLocaleString()}
                      </Badge>
                    )}
                    {rule.customer_type !== 'all' && (
                      <Badge variant="outline">
                        {rule.customer_type} only
                      </Badge>
                    )}
                    {rule.is_new_customer_only && (
                      <Badge className="bg-green-100 text-green-700">
                        New Customers Only
                      </Badge>
                    )}
                    <Badge className="bg-purple-100 text-purple-700">
                      Priority {rule.priority || 0}
                    </Badge>
                  </div>

                  {rule.tiered_rates && rule.tiered_rates.length > 0 && (
                    <div className="mt-4 p-3 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border border-yellow-200">
                      <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                        <TrendingUp className="w-4 h-4 text-orange-600" />
                        Progressive Tiers:
                      </p>
                      <div className="space-y-1">
                        {rule.tiered_rates.map((tier, idx) => (
                          <div key={idx} className="text-xs text-gray-700 flex items-center gap-2">
                            <Target className="w-3 h-3 text-orange-600" />
                            <span className="font-medium">
                              ${tier.threshold_amount.toLocaleString()}+ sales
                            </span>
                            <span className="text-gray-400">→</span>
                            <Badge className="bg-orange-100 text-orange-700 text-xs">
                              {tier.rate_percentage}%
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleEdit(rule)}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleDelete(rule.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {commissionRules.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <Target className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Commission Rules Yet</h3>
              <p className="text-gray-500 mb-4">Create your first rule to define how commissions are calculated</p>
              <Button onClick={() => setShowDialog(true)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                Create First Rule
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}