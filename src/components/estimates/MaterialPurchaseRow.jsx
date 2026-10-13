import React from 'react';

export default function MaterialPurchaseRow({ item }) {
  const hasOrder = item.order_quantity != null
    && Number.isFinite(Number(item.order_quantity))
    && Number(item.order_quantity) >= 0
    && Boolean(item.order_unit);
  return (
    <tr className="border-b hover:bg-gray-50">
      <td className="px-4 py-2.5 text-gray-900">{item.name || item.description}</td>
      <td className="px-3 py-2.5 text-right text-gray-700 tabular-nums">{item.quantity}</td>
      <td className="px-3 py-2.5 text-gray-600">{item.unit}</td>
      <td className="px-3 py-2.5 text-right font-semibold text-green-800 bg-green-50 tabular-nums">{hasOrder ? item.order_quantity : '—'}</td>
      <td className="px-3 py-2.5 text-green-800 bg-green-50">{hasOrder ? item.order_unit : '—'}</td>
      <td className="px-4 py-2.5 text-gray-500 text-xs">
        {!hasOrder && <span>Refresh this saved list to calculate order quantities. </span>}
        {item.order_note && <span>{item.order_note} </span>}
        {item.notes}
      </td>
    </tr>
  );
}
