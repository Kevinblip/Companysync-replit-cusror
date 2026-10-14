import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const FACT_LABELS = [
  ['name', 'Name'],
  ['address', 'Address'],
  ['roof_issue', 'Roof issue'],
  ['insurance_carrier', 'Insurance'],
  ['claim_number', 'Claim'],
  ['appointment', 'Appointment'],
  ['preferences', 'Preferences'],
  ['last_outcome', 'Last outcome'],
];

export default function CallerMemoryCard({ companyId, phone, customerId, leadId }) {
  const enabled = Boolean(companyId && (phone || customerId || leadId));
  const { data, isLoading } = useQuery({
    queryKey: ['caller-memory', companyId, phone || '', customerId || '', leadId || ''],
    enabled,
    queryFn: async () => {
      const res = await base44.functions.invoke('getCallerMemory', {
        companyId,
        phone: phone || '',
        customerId: customerId || '',
        leadId: leadId || '',
      });
      return res?.data || { found: false };
    },
  });

  if (!enabled) return null;

  const facts = data?.facts || {};
  const factRows = FACT_LABELS.filter(([key]) => facts[key]);

  return (
    <Card data-testid="caller-memory-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Caller memory</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-gray-700">
        {isLoading && <p className="text-gray-500">Loading caller memory…</p>}
        {!isLoading && !data?.found && (
          <p className="text-gray-500">No saved caller memory for this contact yet.</p>
        )}
        {!isLoading && data?.found && (
          <>
            {data.contact_name && <p className="font-medium text-gray-900">{data.contact_name}</p>}
            {data.summary && <p className="whitespace-pre-wrap">{data.summary}</p>}
            {factRows.length > 0 && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {factRows.map(([key, label]) => (
                  <div key={key}>
                    <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
                    <dd>{facts[key]}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
