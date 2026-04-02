import React from "react";

export default function StateFarmPreview({ template }) {
  const brand = template?.branding || {};
  const companyName = brand.header_text || "Your Company Name";

  return (
    <div className="mt-4 font-sans text-xs" style={{ color: '#1a1a1a', lineHeight: 1.4 }}>
      <div className="text-xs uppercase tracking-wider text-gray-400 mb-2">Xactimate / State Farm Format Preview</div>
      <div className="bg-white border border-gray-300 rounded shadow-sm overflow-hidden" style={{ fontFamily: 'Arial, sans-serif' }}>

        {/* Letterhead */}
        <div className="text-center px-6 pt-4 pb-3 border-b border-gray-200">
          <div className="font-bold text-sm text-gray-900">{companyName}</div>
          <div className="text-gray-500 text-xs">123 Main St · Cleveland, OH 44101 · (216) 555-0100</div>
          <div className="text-gray-500 text-xs mt-0.5">4/1/2026 8:00 AM</div>
        </div>

        {/* Insured info grid — matches Xactimate page 1 */}
        <div className="grid grid-cols-2 gap-0 border-b border-gray-200 text-xs">
          <div className="px-4 py-2 space-y-0.5 border-r border-gray-200">
            <div><span className="font-semibold">Insured:</span> Jane Doe</div>
            <div><span className="font-semibold">Property:</span> 11720 Example Ave</div>
            <div className="pl-12 text-gray-600">Cleveland, OH 44135</div>
            <div><span className="font-semibold">Home:</span> (216) 555-1234</div>
            <div><span className="font-semibold">Type of Loss:</span> Wind</div>
            <div><span className="font-semibold">Deductible:</span> $1,000.00</div>
          </div>
          <div className="px-4 py-2 space-y-0.5">
            <div><span className="font-semibold">Estimate:</span> EST-1001</div>
            <div><span className="font-semibold">Claim Number:</span> CLM-2024-001</div>
            <div><span className="font-semibold">Policy Number:</span> POL-98765</div>
            <div><span className="font-semibold">Price List:</span> OHCL28_MAR26</div>
            <div className="pl-14 text-gray-600">Restoration/Service/Remodel</div>
            <div><span className="font-semibold">Date of Loss:</span> 3/13/2026</div>
          </div>
        </div>

        {/* Summary for Dwelling */}
        <div className="px-4 py-2 border-b border-gray-200">
          <div className="font-bold text-xs mb-1 text-center underline">Summary for Dwelling</div>
          <table className="w-full text-xs">
            <tbody>
              {[
                ['Line Item Total', '5,496.18'],
                ['Material Sales Tax', '119.05'],
                ['Replacement Cost Value', '5,615.23'],
                ['Less Deductible', '(1,000.00)'],
              ].map(([label, val]) => (
                <tr key={label}>
                  <td className="py-0.5">{label}</td>
                  <td className="py-0.5 text-right">{val}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-400 font-bold">
                <td className="py-0.5">Net Payment</td>
                <td className="py-0.5 text-right">$4,615.23</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Line items table */}
        <div className="px-4 py-2">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-400">
                <th className="text-left py-1 font-semibold">DESCRIPTION</th>
                <th className="text-right py-1 font-semibold">QTY</th>
                <th className="text-right py-1 font-semibold">UNIT PRICE</th>
                <th className="text-right py-1 font-semibold">TAX</th>
                <th className="text-right py-1 font-semibold">RCV</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-0.5 pr-2">Remove 3 tab - 25 yr. - comp. shingle roofing</td>
                <td className="py-0.5 text-right">8.74 SQ</td>
                <td className="py-0.5 text-right">76.65</td>
                <td className="py-0.5 text-right">0.00</td>
                <td className="py-0.5 text-right">669.92</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-0.5 pr-2">3 tab - 25 yr. - comp. shingle roofing</td>
                <td className="py-0.5 text-right">9.00 SQ</td>
                <td className="py-0.5 text-right">263.37</td>
                <td className="py-0.5 text-right">79.21</td>
                <td className="py-0.5 text-right">2,449.54</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-0.5 pr-2">R&amp;R Drip edge</td>
                <td className="py-0.5 text-right">126.69 LF</td>
                <td className="py-0.5 text-right">3.63</td>
                <td className="py-0.5 text-right">11.35</td>
                <td className="py-0.5 text-right">471.23</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-400 font-semibold">
                <td colSpan={3} className="py-1 text-right pr-2">Totals:</td>
                <td className="py-1 text-right">119.05</td>
                <td className="py-1 text-right">5,615.23</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer disclaimer */}
        <div className="px-4 pb-3 text-gray-500 text-center" style={{ fontSize: '9px' }}>
          ALL AMOUNTS PAYABLE ARE SUBJECT TO THE TERMS, CONDITIONS AND LIMITS OF YOUR POLICY.
        </div>
      </div>
    </div>
  );
}
