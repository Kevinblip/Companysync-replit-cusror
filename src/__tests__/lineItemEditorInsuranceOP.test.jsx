import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LineItemEditor from '@/components/estimates/LineItemEditor';

function renderWithClient(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const opFormat = {
  format_name: 'Xactimate Standard (O&P)',
  show_rcv_acv: true,
  show_depreciation: false,
  show_op_column: true,
  overhead_profit_rate: 20,
  tax_rate: 0,
  rcv_label: 'RCV',
  acv_label: 'ACV',
};

const zeroOpFormat = {
  ...opFormat,
  overhead_profit_rate: 0,
};

const items = [
  { description: 'Test Shingles', quantity: 10, unit: 'SQ', rate: 100, amount: 1000, rcv: 1000, acv: 1000, depreciation_percent: 0 },
];

describe('LineItemEditor — Insurance Mode O&P suppression', () => {
  it('shows the O&P column/summary for a format with show_op_column when NOT in insurance mode', () => {
    renderWithClient(
      <LineItemEditor items={items} onChange={() => {}} format={opFormat} isInsuranceJob={false} />
    );
    expect(screen.getAllByText('O&P').length).toBeGreaterThan(0);
    expect(screen.getByText(/Total O&P \(20%\)/)).toBeInTheDocument();
  });

  it('hides the O&P column/summary for the SAME format when insurance mode IS on', () => {
    renderWithClient(
      <LineItemEditor items={items} onChange={() => {}} format={opFormat} isInsuranceJob={true} />
    );
    expect(screen.queryByText('O&P')).not.toBeInTheDocument();
    expect(screen.queryByText(/Total O&P/)).not.toBeInTheDocument();
  });

  it('respects an explicit 0% overhead_profit_rate instead of falling back to a 20% default', () => {
    renderWithClient(
      <LineItemEditor items={items} onChange={() => {}} format={zeroOpFormat} isInsuranceJob={false} />
    );
    expect(screen.getByText(/Total O&P \(0%\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Total O&P \(20%\)/)).not.toBeInTheDocument();
  });
});
