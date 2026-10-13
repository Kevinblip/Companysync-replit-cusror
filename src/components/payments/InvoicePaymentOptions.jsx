import React from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const METHODS = [
  ['zelle_email', 'Zelle', value => `Send to ${value}`],
  ['cashapp_handle', 'Cash App', value => `Send to ${value.startsWith('$') ? value : `$${value}`}`],
  ['venmo_handle', 'Venmo', value => `Send to ${value.startsWith('@') ? value : `@${value}`}`],
  ['check_payment_instructions', 'Check', value => value],
  ['cash_payment_instructions', 'Cash', value => value],
];

export default function InvoicePaymentOptions({
  invoiceNumber,
  paymentOptions = {},
  onStripePay,
  isPaying = false,
}) {
  const configured = METHODS.filter(([key]) => paymentOptions[key]);

  return (
    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <p className="text-sm font-semibold text-blue-950">Payment options</p>
      <p className="mt-0.5 text-xs text-blue-800">
        Include invoice #{invoiceNumber} with manual payments.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700"
          onClick={onStripePay}
          disabled={isPaying}
        >
          {isPaying
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <CreditCard className="mr-2 h-4 w-4" />}
          Pay securely online
        </Button>
      </div>
      {configured.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {configured.map(([key, label, format]) => (
            <div key={key} className="rounded-md border border-blue-100 bg-white p-2">
              <p className="text-xs font-semibold text-gray-900">{label}</p>
              <p className="mt-1 whitespace-pre-line break-words text-xs text-gray-700">
                {format(paymentOptions[key])}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}