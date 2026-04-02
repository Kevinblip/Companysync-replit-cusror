import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Edit, Trash2, Percent } from "lucide-react";

export default function TaxRates() {
  const [user, setUser] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingTax, setEditingTax] = useState(null);
  const [formData, setFormData] = useState({
    tax_name: "",
    tax_rate: "",
    is_default: false
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.TaxRate.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createTaxMutation = useMutation({
    mutationFn: (data) => base44.entities.TaxRate.create({ ...data, company_id: myCompany.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
      setShowDialog(false);
      setEditingTax(null);
      setFormData({ tax_name: "", tax_rate: "", is_default: false });
    },
  });

  const updateTaxMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TaxRate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
      setShowDialog(false);
      setEditingTax(null);
      setFormData({ tax_name: "", tax_rate: "", is_default: false });
    },
  });

  const deleteTaxMutation = useMutation({
    mutationFn: (id) => base44.entities.TaxRate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => base44.entities.TaxRate.update(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingTax) {
      updateTaxMutation.mutate({ id: editingTax.id, data: formData });
    } else {
      createTaxMutation.mutate(formData);
    }
  };

  const handleEdit = (tax) => {
    setEditingTax(tax);
    setFormData({
      tax_name: tax.tax_name,
      tax_rate: tax.tax_rate,
      is_default: tax.is_default || false
    });
    setShowDialog(true);
  };

  const handleDelete = (id) => {
    if (window.confirm("Are you sure you want to delete this tax rate?")) {
      deleteTaxMutation.mutate(id);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Percent className="w-8 h-8 text-green-600" />
            Tax Rates
          </h1>
          <p className="text-gray-500 mt-1">Manage tax rates for invoices and estimates</p>
        </div>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button className="bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-2" />
              New Tax Rate
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingTax ? 'Edit Tax Rate' : 'Create Tax Rate'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Tax Name *</Label>
                <Input
                  value={formData.tax_name}
                  onChange={(e) => setFormData({...formData, tax_name: e.target.value})}
                  placeholder="e.g., Sales Tax, Materials Tax"
                  required
                />
              </div>
              <div>
                <Label>Tax Rate (%) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.tax_rate}
                  onChange={(e) => setFormData({...formData, tax_rate: parseFloat(e.target.value) || ''})}
                  placeholder="8.00"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_default}
                  onCheckedChange={(checked) => setFormData({...formData, is_default: checked})}
                />
                <Label>Set as default tax rate</Label>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-green-600 hover:bg-green-700">
                  {editingTax ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Tax Rates</CardTitle>
        </CardHeader>
        <CardContent>
          {taxRates.length === 0 ? (
            <div className="text-center py-12">
              <Percent className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-600 mb-2">No Tax Rates</h3>
              <p className="text-gray-500 mb-4">Create your first tax rate to get started</p>
              <Button onClick={() => setShowDialog(true)} className="bg-green-600 hover:bg-green-700">
                <Plus className="w-4 h-4 mr-2" />
                Create Tax Rate
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {taxRates.map(tax => (
                <div key={tax.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="font-semibold text-gray-900">{tax.tax_name}</div>
                      <div className="text-sm text-gray-600">{tax.tax_rate}%</div>
                    </div>
                    {tax.is_default && (
                      <Badge className="bg-green-100 text-green-800">Default</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">Active</span>
                      <Switch
                        checked={tax.is_active ?? true}
                        onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: tax.id, is_active: checked })}
                      />
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleEdit(tax)}>
                      <Edit className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(tax.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}