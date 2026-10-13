import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, UserRound } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

function customerLocation(customer) {
  return [
    customer.street || customer.address,
    customer.city,
    customer.state,
    customer.zip,
  ].filter(Boolean).join(', ');
}

export default function CustomerIdentityPickerDialog({
  open,
  onOpenChange,
  customers = [],
  selectedCustomerId,
  onSelect,
  title = 'Choose a customer',
  description = 'Select the correct customer record. Contact details help distinguish people with the same name.',
}) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = customers.filter((customer) => {
      if (!query) return true;
      return [
        customer.name,
        customer.email,
        customer.phone,
        customer.phone_2,
        customer.customer_number,
        customerLocation(customer),
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
    return rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [customers, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, phone, or address"
            className="pl-9"
            aria-label="Search customers"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-1 pr-1">
          {matches.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No matching customers.</p>
          ) : matches.map((customer) => {
            const location = customerLocation(customer);
            const selected = String(customer.id) === String(selectedCustomerId || '');
            return (
              <button
                key={customer.id}
                type="button"
                onClick={() => onSelect?.(customer)}
                className={`w-full rounded-md border p-3 text-left transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                aria-pressed={selected}
                data-testid={`customer-choice-${customer.id}`}
              >
                <span className="flex items-start gap-3">
                  <UserRound className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium text-gray-900">
                      <span className="truncate">{customer.name || 'Unnamed customer'}</span>
                      {customer.customer_number != null && (
                        <span className="flex-shrink-0 text-xs font-normal text-gray-500">
                          #{customer.customer_number}
                        </span>
                      )}
                      {selected && <Check className="h-4 w-4 flex-shrink-0 text-blue-600" />}
                    </span>
                    <span className="mt-0.5 block break-words text-xs text-gray-600">
                      {[customer.email, customer.phone || customer.phone_2, location].filter(Boolean).join(' · ') || 'No contact details'}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
