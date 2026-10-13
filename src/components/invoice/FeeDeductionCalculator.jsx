import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { calculateFeeDeduction, deductionTypeLabel } from '@/utils/paymentDeductionTypes';
import { previewStandaloneDeduction } from '@/utils/standaloneDeduction';

export default function FeeDeductionCalculator({ types, invoiceTotal, remainingBalance, pending, onRecord }) {
  const [deductionType, setDeductionType] = useState('');
  const [mode, setMode] = useState('amount');
  const [value, setValue] = useState('');
  const [baseKind, setBaseKind] = useState('remaining_balance');
  const [customBase, setCustomBase] = useState('');
  const input = { mode, value, baseKind, customBase, invoiceTotal, remainingBalance };
  const result = calculateFeeDeduction(input);
  const preview = previewStandaloneDeduction(mode === 'amount' ? value : result.amount, remainingBalance);
  const validationError = (mode === 'amount' ? preview.error : '') || result.error || preview.error;
  const switchMode = (next) => {
    setValue(result.amount ? String(next === 'amount' ? result.amount : result.percent) : '');
    setMode(next);
  };
  const selectClass = 'w-full h-10 rounded-md border border-amber-300 bg-white px-3 text-sm';

  return (
    <div className="space-y-3">
      <fieldset disabled={pending} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="fee-deduction-type">Deduction Type</Label>
          <Select value={deductionType} disabled={pending} onValueChange={(name) => {
            setDeductionType(name);
            const selected = types.find(type => type.name === name);
            setMode(selected?.percent ? 'percentage' : 'amount');
            setValue(selected?.percent ? String(selected.percent) : '');
          }}>
            <SelectTrigger id="fee-deduction-type" className="bg-white border-amber-300" data-testid="select-deduction-type">
              <SelectValue placeholder="Select type…" />
            </SelectTrigger>
            <SelectContent>
              {types.map(type => <SelectItem key={type.name} value={type.name}>{deductionTypeLabel(type)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="deduction-base-kind">Percentage Base</Label>
          <select id="deduction-base-kind" className={selectClass} value={baseKind}
            onChange={e => setBaseKind(e.target.value)} data-testid="select-deduction-base">
            <option value="remaining_balance">Remaining balance — ${remainingBalance.toFixed(2)}</option>
            <option value="invoice_total">Invoice total — ${invoiceTotal.toFixed(2)}</option>
            <option value="custom">Custom gross amount</option>
          </select>
        </div>
        {baseKind === 'custom' && (
          <div>
            <Label htmlFor="deduction-custom-base">Custom gross amount ($)</Label>
            <Input id="deduction-custom-base" type="number" min="0.01" step="0.01"
              value={customBase} onChange={e => setCustomBase(e.target.value)}
              className="bg-white border-amber-300" data-testid="input-deduction-base" />
            <p className="text-xs text-amber-700">Amount before the fee, not the net payment received.</p>
          </div>
        )}
        <div>
          <Label htmlFor="deduction-entry-mode">Enter fee as</Label>
          <select id="deduction-entry-mode" className={selectClass} value={mode}
            onChange={e => switchMode(e.target.value)} data-testid="select-deduction-mode">
            <option value="amount">Dollar amount</option>
            <option value="percentage">Percentage</option>
          </select>
        </div>
        <div>
          <Label htmlFor="deduction-value">{mode === 'percentage' ? 'Fee percentage (%)' : 'Amount withheld ($)'}</Label>
          <Input id="deduction-value" type="number" min={mode === 'percentage' ? '0.000001' : '0.01'}
            max={mode === 'percentage' ? '100' : remainingBalance.toFixed(2)} step={mode === 'percentage' ? 'any' : '0.01'}
            value={value} onChange={e => setValue(e.target.value)} className="bg-white border-amber-300"
            placeholder={mode === 'amount' ? 'Enter fee amount' : 'Enter percentage'}
            aria-invalid={!!validationError} aria-describedby="standalone-deduction-preview"
            data-testid={mode === 'percentage' ? 'input-deduction-percentage' : 'input-standalone-deduction-amount'} />
        </div>
      </fieldset>
      {result.amount != null && (
        <p className="text-sm text-amber-800" aria-live="polite" data-testid="text-deduction-rate-math">
          {mode === 'amount' ? 'Approximately ' : ''}{result.percent}% of {result.baseLabel} ${result.base.toFixed(2)}
          {' = '}<strong>${result.amount.toFixed(2)} fee</strong>.
        </p>
      )}
      <p id="standalone-deduction-preview" aria-live="polite" role={validationError ? 'alert' : undefined}
        className="text-sm text-amber-900" data-testid="text-deduction-balance-preview">
        {validationError || <>Balance after deduction: <strong>${preview.remainingBalance.toFixed(2)}</strong>{preview.remainingBalance === 0 ? ' — this closes the balance.' : ' — this amount remains due.'}</>}
      </p>
      <Button className="w-full bg-amber-600 hover:bg-amber-700 text-white"
        disabled={pending || !types.some(type => type.name === deductionType) || !!validationError}
        onClick={() => { if (!validationError) onRecord({ deductionType, ...input }); }}
        data-testid="button-record-standalone-deduction">
        {pending ? 'Recording…' : !validationError && preview.remainingBalance === 0 ? 'Record Deduction + Close Balance' : 'Record Deduction'}
      </Button>
    </div>
  );
}