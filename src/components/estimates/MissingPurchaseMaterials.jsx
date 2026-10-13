import React from 'react';

export default function MissingPurchaseMaterials({ items = [], pricingIncomplete = false }) {
  if (!items.length && !pricingIncomplete) return null;
  return (
    <div role="alert" data-testid="missing-purchase-materials" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {pricingIncomplete && <p className="mb-2"><strong>Prices still need review.</strong> The material quantities below come from your existing line items, including rows awaiting catalog pricing. Pending prices do not remove materials from this list.</p>}
      {items.length > 0 && <>
      <p className="font-semibold">Siding accessories needing quantities</p>
      <p className="mt-1">These are not in the estimate scope. Add the required quantities to the estimate and regenerate the list, or confirm they are not needed. No amounts have been guessed.</p>
      <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
        {items.map((item, index) => <li key={`${item.description || item.material || item.name}-${index}`}>{item.description || item.material || item.name || 'Accessory'} — confirm qty ({item.unit})</li>)}
      </ul>
      </>}
    </div>
  );
}
