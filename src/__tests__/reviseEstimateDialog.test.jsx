import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import ReviseEstimateDialog, {
  aiEstimatorEditSearch,
  estimateIsFiled,
} from '@/components/estimates/ReviseEstimateDialog';

afterEach(() => cleanup());

describe('estimate revision helpers', () => {
  it('treats only sent, accepted, and declined as already filed', () => {
    expect(estimateIsFiled('draft')).toBe(false);
    expect(estimateIsFiled('')).toBe(false);
    expect(estimateIsFiled(undefined)).toBe(false);
    expect(estimateIsFiled('Sent')).toBe(true);
    expect(estimateIsFiled('accepted')).toBe(true);
    expect(estimateIsFiled('declined')).toBe(true);
  });

  it('points the AI estimator at the same estimate', () => {
    const search = aiEstimatorEditSearch({
      id: 'est_1',
      estimate_number: 'EST-0001',
      customer_name: 'Ada',
      claim_number: 'CLM-9',
      property_address: '1 Main',
    });
    const params = new URLSearchParams(search);
    expect(params.get('edit_estimate_id')).toBe('est_1');
    expect(params.get('estimate_number')).toBe('EST-0001');
    expect(params.get('customer_name')).toBe('Ada');
    expect(params.get('claim_number')).toBe('CLM-9');
    expect(params.get('property_address')).toBe('1 Main');
  });
});

describe('ReviseEstimateDialog', () => {
  const draft = {
    estimate_number: 'EST-0001',
    customer_name: 'Ada Lovelace',
    status: 'draft',
  };

  it('leads a draft with editing this estimate', () => {
    const onEditHere = vi.fn();
    const onOpenAiEstimator = vi.fn();
    const onCreateCopy = vi.fn();
    render(
      <ReviseEstimateDialog
        open
        onOpenChange={() => {}}
        estimate={draft}
        onEditHere={onEditHere}
        onOpenAiEstimator={onOpenAiEstimator}
        onCreateCopy={onCreateCopy}
      />,
    );

    expect(screen.getByText('Change this estimate')).toBeTruthy();
    expect(screen.getByText(/still a draft/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-edit-estimate-here'));
    fireEvent.click(screen.getByTestId('button-open-ai-estimator-revise'));
    expect(onEditHere).toHaveBeenCalledOnce();
    expect(onOpenAiEstimator).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('button-kind-change-order'));
    const create = screen.getByTestId('button-create-supplement-confirm');
    expect(create).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByTestId('input-change-order-reason'), {
      target: { value: 'Added two skylights' },
    });
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    expect(onCreateCopy).toHaveBeenCalledWith({
      asChangeOrder: true,
      reason: 'Added two skylights',
    });
  });

  it('leads a sent estimate with a supplement copy and still offers an in-place edit', () => {
    const onCreateCopy = vi.fn();
    const onEditHere = vi.fn();
    render(
      <ReviseEstimateDialog
        open
        onOpenChange={() => {}}
        estimate={{ ...draft, status: 'sent' }}
        onEditHere={onEditHere}
        onOpenAiEstimator={() => {}}
        onCreateCopy={onCreateCopy}
      />,
    );

    expect(screen.getByText('Supplement or change order')).toBeTruthy();
    expect(screen.getByText(/already sent/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-edit-estimate-here'));
    expect(onEditHere).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('button-create-supplement-confirm'));
    expect(onCreateCopy).toHaveBeenCalledWith({ asChangeOrder: false, reason: '' });
  });
});
