import React from 'react';
import { settlementFields, getInsuranceSettlementSummary } from '../../../lib/insuranceSettlement.js';

export default function InsuranceSettlementSummary({ value, repairTotal, onChange }) {
  const summary = getInsuranceSettlementSummary(value, repairTotal);
  if (!summary) return onChange ? (
    <div className="px-4 py-3 border-t">
      <button type="button" className="text-sm text-blue-700 underline" onClick={() => onChange({ basis: 'Carrier settlement — enter documented figures', conditions: [], warnings: [] })}>
        Add insurance settlement details (does not change repair prices)
      </button>
    </div>
  ) : null;
  return (
    <section className="border-t border-blue-200 bg-blue-50 p-4 space-y-3 text-sm" data-testid="insurance-settlement-summary">
      <h3 className="font-semibold text-blue-950">Insurance Settlement — as reported by carrier</h3>
      <p>{summary.settlement.basis}</p>
      {summary.settlement.source_reference && <p className="text-xs text-slate-600">Source: {summary.settlement.source_reference}</p>}
      <dl className="space-y-2">
        {summary.rows.map(row => <div key={row.key} className="flex justify-between gap-4">
          <dt>{row.label}</dt><dd className="font-semibold whitespace-nowrap">{row.display}</dd>
        </div>)}
      </dl>
      {summary.settlement.conditions.map((condition, index) => <p key={`condition-${index}`}>Condition: {condition}</p>)}
      {summary.warnings.length > 0 && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">
        <strong>Carrier figures need review</strong>
        <ul className="list-disc pl-5">{summary.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </div>}
      <p className="text-xs text-slate-600">{summary.notice}</p>
      {onChange && <details className="border-t pt-2">
        <summary className="cursor-pointer text-blue-700">Review / correct documented settlement figures</summary>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          {settlementFields.map(([key, label, kind]) => <label key={key} className="space-y-1">
            <span className="block">{label}</span>
            <input className="w-full border rounded bg-white p-2" type="number" min="0" max={kind === 'percent' ? 100 : undefined}
              step={kind === 'years' ? 1 : 0.01} value={value?.[key] ?? ''} placeholder="Not stated"
              onChange={event => onChange({ ...value, [key]: event.target.value === '' ? null : Number(event.target.value) })} />
          </label>)}
          <label className="sm:col-span-2">Source / section
            <input className="w-full border rounded bg-white p-2" value={value?.source_reference || ''} onChange={event => onChange({ ...value, source_reference: event.target.value })} />
          </label>
          <label className="sm:col-span-2">Payment conditions (one per line)
            <textarea className="w-full border rounded bg-white p-2" value={(value?.conditions || []).join('\n')} onChange={event => onChange({ ...value, conditions: event.target.value.split('\n') })} />
          </label>
          <label className="sm:col-span-2">Source conflicts / scope differences (one per line)
            <textarea className="w-full border rounded bg-white p-2" value={(value?.warnings || []).join('\n')} onChange={event => onChange({ ...value, warnings: event.target.value.split('\n') })} />
          </label>
        </div>
      </details>}
    </section>
  );
}
