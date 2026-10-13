import { describe, expect, it } from 'vitest';
import {
  changeInvoiceCustomerName,
  getCompanyCustomerById,
  getInvoicesForCustomerId,
  isInvoiceUnlinked,
  selectInvoiceCustomer,
} from '@/utils/invoiceCustomerAssociation';

describe('invoice customer identity', () => {
  const customers = [
    { id: 'customer-1', company_id: 'company-1', name: 'Jordan Lee', email: 'jordan@example.test' },
    { id: 'customer-2', company_id: 'company-1', name: 'Jordan Lee', email: 'j.lee@example.test' },
    { id: 'customer-3', company_id: 'company-2', name: 'Jordan Lee', email: 'other@example.test' },
  ];

  it('selects one exact customer record, not a name match', () => {
    expect(getCompanyCustomerById(customers, 'customer-2', 'company-1')).toEqual(customers[1]);
    expect(getCompanyCustomerById(customers, 'Jordan Lee', 'company-1')).toBeNull();
    expect(getCompanyCustomerById(customers, 'customer-3', 'company-1')).toBeNull();
    expect(selectInvoiceCustomer(customers[1])).toEqual({
      customer_id: 'customer-2',
      customer_name: 'Jordan Lee',
      customer_email: 'j.lee@example.test',
    });
  });

  it('clears the selected customer ID when the invoice name is manually changed', () => {
    const form = {
      customer_id: 'customer-2',
      customer_name: 'Jordan Lee',
      customer_email: 'j.lee@example.test',
      amount: '1250.00',
      items: [{ description: 'Roof repair' }],
      invoice_number: 'INV-1001',
    };
    const changed = changeInvoiceCustomerName(form, 'Jordan Lee Jr.');
    expect(changed).toMatchObject({
      customer_id: '',
      customer_name: 'Jordan Lee Jr.',
      customer_email: '',
      amount: '',
      items: [],
      invoice_number: 'INV-1001',
    });
    expect(form.customer_id).toBe('customer-2');
  });

  it('shows invoices only for the chosen customer ID', () => {
    const invoices = [
      { id: 'linked-1', customer_id: 'customer-2', customer_name: 'Jordan Lee' },
      { id: 'same-name-other', customer_id: 'customer-1', customer_name: 'Jordan Lee' },
      { id: 'unlinked', customer_id: '', customer_name: 'Jordan Lee' },
    ];
    expect(getInvoicesForCustomerId(invoices, 'customer-2')).toEqual([invoices[0]]);
    expect(isInvoiceUnlinked(invoices[2])).toBe(true);
    expect(isInvoiceUnlinked(invoices[0])).toBe(false);
  });
});
