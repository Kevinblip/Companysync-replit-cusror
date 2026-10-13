import React from "react";

export default function StateFarmPreview({ template }) {
  const brand = template?.branding || {};
  const primary = brand.primary_color || "#2563eb"; // blue-600 fallback

  return (
    <div className="mt-6">
      <div className="mb-3 text-xs uppercase tracking-wider text-gray-500">Enhanced preview</div>
      <div className="rounded-lg border overflow-hidden bg-white shadow">
        <div
          className="px-6 py-4 text-white font-semibold"
          style={{ backgroundColor: primary }}
        >
          State Farm Standard — Sample Formatting
        </div>
        <div className="p-6 space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <section>
              <h5 className="font-semibold text-gray-800 mb-2">Executive Summary</h5>
              <div className="prose prose-sm max-w-none text-gray-700">
                <p>
                  Wind and hail damage consistent with storm activity was observed across
                  multiple roof sections. Recommended scope includes full roof
                  replacement with code-required underlayment and flashing.
                </p>
                <ul className="list-disc pl-5 mt-2">
                  <li>Shingle bruising and granule loss exceeding repair thresholds</li>
                  <li>Creased shingles on windward slopes</li>
                  <li>Damaged ridge cap and exposed fasteners</li>
                </ul>
              </div>
            </section>
            <section>
              <h5 className="font-semibold text-gray-800 mb-2">Claim Details</h5>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-gray-700">
                <div className="text-gray-500">Policy</div>
                <div>HO-3 Replacement Cost</div>
                <div className="text-gray-500">Deductible</div>
                <div>$1,000</div>
                <div className="text-gray-500">Inspection Date</div>
                <div>{new Date().toLocaleDateString()}</div>
                <div className="text-gray-500">Estimator</div>
                <div>Field Adjuster</div>
              </div>
            </section>
          </div>

          <section>
            <h5 className="font-semibold text-gray-800 mb-3">Damage Assessment (Sample)</h5>
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: primary }} className="text-white">
                  <tr>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Unit</th>
                    <th className="text-right px-3 py-2">Rate</th>
                    <th className="text-right px-3 py-2">RCV</th>
                    <th className="text-right px-3 py-2">ACV</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr className="bg-gray-50">
                    <td className="px-3 py-2">Remove & replace architectural shingles</td>
                    <td className="px-3 py-2 text-right">28.5</td>
                    <td className="px-3 py-2 text-right">SQ</td>
                    <td className="px-3 py-2 text-right">$350.00</td>
                    <td className="px-3 py-2 text-right">$9,975.00</td>
                    <td className="px-3 py-2 text-right">$8,977.50</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Ice & water shield (valleys/eaves)</td>
                    <td className="px-3 py-2 text-right">220</td>
                    <td className="px-3 py-2 text-right">LF</td>
                    <td className="px-3 py-2 text-right">$3.25</td>
                    <td className="px-3 py-2 text-right">$715.00</td>
                    <td className="px-3 py-2 text-right">$643.50</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h5 className="font-semibold text-gray-800 mb-3">Photo Captions Style</h5>
            <div className="grid sm:grid-cols-2 gap-4 text-xs text-gray-600">
              <figure className="border rounded-md p-3">
                <div className="h-28 bg-gray-100 rounded mb-2" />
                <figcaption>
                  Slope A — Hail bruise with granule loss (coin test confirmed)
                </figcaption>
              </figure>
              <figure className="border rounded-md p-3">
                <div className="h-28 bg-gray-100 rounded mb-2" />
                <figcaption>Ridge cap — Creased and lifted shingle tabs</figcaption>
              </figure>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}