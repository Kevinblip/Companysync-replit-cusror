import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Zap, FlaskConical, Tag, ArrowUpDown } from 'lucide-react';
import { useRoleBasedData } from '@/components/hooks/useRoleBasedData';
import { useToast } from '@/components/ui/use-toast';

const CATEGORIES = [
  'Roofing Labor',
  'Roofing Materials',
  'Subcontractor',
  'Insurance Payment',
  'Down Payment',
  'Final Payment',
  'Permit / Inspection',
  'Equipment Rental',
  'Overhead',
  'Refund',
  'Warranty',
  'Miscellaneous',
];

const TRANSACTION_TYPES = [
  { value: 'revenue', label: 'Revenue (Income)' },
  { value: 'expense', label: 'Expense (Cost)' },
];

const emptyRule = {
  pattern: '',
  category: '',
  transaction_type: 'revenue',
  priority: 0,
  is_active: true,
  notes: '',
};

export default function MappingRules() {
  const { myCompany, isAdmin } = useRoleBasedData();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showDialog, setShowDialog] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [form, setForm] = useState(emptyRule);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [testDescription, setTestDescription] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  const [autoCatLoading, setAutoCatLoading] = useState(false);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['transaction-mapping-rules', myCompany?.id],
    queryFn: () =>
      myCompany
        ? base44.entities.TransactionMappingRule.filter(
            { company_id: myCompany.id },
            '-priority',
            1000
          )
        : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TransactionMappingRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transaction-mapping-rules', myCompany?.id] });
      toast({ title: 'Rule created' });
      setShowDialog(false);
    },
    onError: (err) => toast({ title: 'Error creating rule', description: err.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TransactionMappingRule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transaction-mapping-rules', myCompany?.id] });
      toast({ title: 'Rule updated' });
      setShowDialog(false);
    },
    onError: (err) => toast({ title: 'Error updating rule', description: err.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TransactionMappingRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transaction-mapping-rules', myCompany?.id] });
      toast({ title: 'Rule deleted' });
      setDeleteTarget(null);
    },
    onError: (err) => toast({ title: 'Error deleting rule', description: err.message, variant: 'destructive' }),
  });

  function openNew() {
    setEditingRule(null);
    setForm({ ...emptyRule });
    setShowDialog(true);
  }

  function openEdit(rule) {
    setEditingRule(rule);
    setForm({
      pattern: rule.pattern || '',
      category: rule.category || '',
      transaction_type: rule.transaction_type || 'revenue',
      priority: rule.priority ?? 0,
      is_active: rule.is_active !== false,
      notes: rule.notes || '',
    });
    setShowDialog(true);
  }

  function handleSave() {
    if (!form.pattern.trim()) {
      toast({ title: 'Pattern is required', variant: 'destructive' });
      return;
    }
    if (!form.category) {
      toast({ title: 'Category is required', variant: 'destructive' });
      return;
    }
    const payload = {
      ...form,
      company_id: myCompany.id,
      priority: Number(form.priority) || 0,
    };
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  async function handleTest() {
    if (!testDescription.trim() || !myCompany) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(
        `/api/local/suggest-category?description=${encodeURIComponent(testDescription)}&company_id=${myCompany.id}`
      );
      const data = await res.json();
      setTestResult(data.suggestion);
    } catch (err) {
      toast({ title: 'Test failed', description: err.message, variant: 'destructive' });
    } finally {
      setTestLoading(false);
    }
  }

  async function handleAutoCategorize() {
    if (!myCompany) return;
    setAutoCatLoading(true);
    try {
      const res = await fetch('/api/local/auto-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: myCompany.id }),
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      toast({
        title: `Auto-categorization complete`,
        description: `${data.updated} of ${data.total} payments categorized`,
      });
    } catch (err) {
      toast({ title: 'Auto-categorization failed', description: err.message, variant: 'destructive' });
    } finally {
      setAutoCatLoading(false);
    }
  }

  const sortedRules = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const typeColor = (type) =>
    type === 'revenue'
      ? 'bg-green-100 text-green-800'
      : 'bg-orange-100 text-orange-800';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Mapping Rules</h1>
          <p className="text-gray-500 mt-1">
            Auto-categorize transactions by matching description keywords to categories
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openNew} data-testid="button-add-rule">
            <Plus className="w-4 h-4 mr-2" /> Add Rule
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="w-4 h-4" /> Test a Description
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="Paste a payment description to see which rule matches…"
              value={testDescription}
              onChange={(e) => setTestDescription(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTest()}
              data-testid="input-test-description"
              className="flex-1"
            />
            <Button variant="outline" onClick={handleTest} disabled={testLoading || !testDescription.trim()} data-testid="button-test-rule">
              {testLoading ? 'Testing…' : 'Test'}
            </Button>
            {isAdmin && (
              <Button onClick={handleAutoCategorize} disabled={autoCatLoading} data-testid="button-auto-categorize">
                <Zap className="w-4 h-4 mr-2" />
                {autoCatLoading ? 'Running…' : 'Auto-Categorize All'}
              </Button>
            )}
          </div>
          {testResult !== undefined && testResult !== null && (
            <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200 text-sm" data-testid="text-test-result">
              <span className="font-semibold text-green-800">Match found:</span>{' '}
              pattern <span className="font-mono bg-white px-1 rounded">{testResult.pattern}</span> →{' '}
              <Badge className={typeColor(testResult.transaction_type)}>{testResult.transaction_type}</Badge>{' '}
              <span className="font-medium">{testResult.category}</span>
            </div>
          )}
          {testResult === null && testDescription && !testLoading && (
            <div className="mt-3 p-3 rounded-lg bg-gray-50 border text-sm text-gray-500" data-testid="text-test-no-match">
              No rule matched this description.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag className="w-4 h-4" /> {rules.length} Rule{rules.length !== 1 ? 's' : ''}
            </CardTitle>
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <ArrowUpDown className="w-3 h-3" /> Sorted by priority (highest first)
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center text-gray-400 py-12">Loading rules…</div>
          ) : sortedRules.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              No rules yet. Add your first rule to start auto-categorizing transactions.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-semibold text-sm">Priority</th>
                    <th className="text-left p-2 font-semibold text-sm">Pattern (keyword)</th>
                    <th className="text-left p-2 font-semibold text-sm">Category</th>
                    <th className="text-left p-2 font-semibold text-sm">Type</th>
                    <th className="text-left p-2 font-semibold text-sm">Status</th>
                    <th className="text-left p-2 font-semibold text-sm">Notes</th>
                    {isAdmin && <th className="text-right p-2 font-semibold text-sm">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedRules.map((rule) => (
                    <tr key={rule.id} className="border-b hover:bg-gray-50" data-testid={`row-rule-${rule.id}`}>
                      <td className="p-2 text-sm font-mono text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-700 font-bold text-xs">
                          {rule.priority || 0}
                        </span>
                      </td>
                      <td className="p-2 text-sm">
                        <span className="font-mono bg-blue-50 text-blue-800 px-2 py-0.5 rounded text-xs border border-blue-200">
                          {rule.pattern}
                        </span>
                      </td>
                      <td className="p-2 text-sm font-medium">{rule.category}</td>
                      <td className="p-2">
                        <Badge className={`text-xs capitalize ${typeColor(rule.transaction_type)}`}>
                          {rule.transaction_type || 'revenue'}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <Badge className={rule.is_active !== false ? 'bg-green-100 text-green-800 text-xs' : 'bg-gray-100 text-gray-500 text-xs'}>
                          {rule.is_active !== false ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs text-gray-500 max-w-xs truncate">{rule.notes || '—'}</td>
                      {isAdmin && (
                        <td className="p-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(rule)}
                              data-testid={`button-edit-rule-${rule.id}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => setDeleteTarget(rule)}
                              data-testid={`button-delete-rule-${rule.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Rule' : 'Add Mapping Rule'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pattern">Pattern (keyword / substring)</Label>
              <Input
                id="pattern"
                placeholder="e.g. state farm, deposit, labor"
                value={form.pattern}
                onChange={(e) => setForm({ ...form, pattern: e.target.value })}
                data-testid="input-rule-pattern"
              />
              <p className="text-xs text-gray-400">Case-insensitive substring match against payment description + notes</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger data-testid="select-rule-category">
                  <SelectValue placeholder="Select a category…" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                  <SelectItem value="__custom__">Custom…</SelectItem>
                </SelectContent>
              </Select>
              {form.category === '__custom__' && (
                <Input
                  placeholder="Enter custom category name"
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  data-testid="input-rule-custom-category"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transaction_type">Transaction Type</Label>
              <Select
                value={form.transaction_type}
                onValueChange={(v) => setForm({ ...form, transaction_type: v })}
              >
                <SelectTrigger data-testid="select-rule-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSACTION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priority">Priority (higher = checked first)</Label>
              <Input
                id="priority"
                type="number"
                min={0}
                max={999}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                data-testid="input-rule-priority"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Internal notes about this rule…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                data-testid="input-rule-notes"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="is_active"
                checked={form.is_active !== false}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                data-testid="switch-rule-active"
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-rule"
            >
              {editingRule ? 'Save Changes' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              The rule <span className="font-mono font-semibold">{deleteTarget?.pattern}</span> → {deleteTarget?.category} will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete-rule"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
