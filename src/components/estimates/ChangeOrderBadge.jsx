import React from 'react';
import {
  isChangeOrder,
  changeOrderStatus,
  CHANGE_ORDER_APPROVED,
  CHANGE_ORDER_REJECTED,
} from '@/lib/changeOrders';

const STATUS_STYLES = {
  approved: { className: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Approved' },
  rejected: { className: 'bg-red-100 text-red-700 border-red-200', label: 'Rejected' },
  pending: { className: 'bg-purple-100 text-purple-700 border-purple-200', label: 'Pending approval' },
};

/**
 * The chain badge for a child estimate.
 *
 * A change order and an insurance supplement live on the same parent/child
 * chain, so the badge is the only thing that tells the office which one it is
 * looking at — purple CO with its approval state, or the original orange SUPP.
 * Rendered everywhere the chain is shown so the two never look alike.
 */
export default function ChangeOrderBadge({ estimate, size = 'sm', className = '' }) {
  const padding = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs';

  if (!isChangeOrder(estimate)) {
    return (
      <span
        className={`inline-flex items-center rounded font-medium bg-orange-100 text-orange-700 ${padding} ${className}`}
        data-testid={`badge-supplement-${estimate?.id || 'unknown'}`}
      >
        SUPP
      </span>
    );
  }

  const status = changeOrderStatus(estimate);
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-semibold ${style.className} ${padding} ${className}`}
      title={`Change order — ${style.label}${estimate.change_order_reason ? `: ${estimate.change_order_reason}` : ''}`}
      data-testid={`badge-change-order-${estimate?.id || 'unknown'}`}
    >
      CO
      <span className="font-normal opacity-80">
        {status === CHANGE_ORDER_APPROVED ? '✓' : status === CHANGE_ORDER_REJECTED ? '✕' : '⏳'}
      </span>
    </span>
  );
}
