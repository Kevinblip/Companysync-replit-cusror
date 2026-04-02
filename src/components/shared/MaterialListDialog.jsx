import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ClipboardList, Download } from "lucide-react";

export default function MaterialListDialog({
  open,
  onOpenChange,
  materialListData,
  onDownload,
  t,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-[95vw] h-[92vh] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-green-600" />
            Material Purchase List
          </DialogTitle>
          <DialogDescription>
            {materialListData?.estimate.customer_name && `For: ${materialListData.estimate.customer_name}`}
          </DialogDescription>
        </DialogHeader>

        {materialListData && (
          <div className="space-y-6">
            {materialListData.material_calculations && materialListData.material_calculations.length > 0 && (
              <div className="bg-gradient-to-r from-blue-50 to-green-50 p-6 rounded-lg border-2 border-blue-300">
                <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  🛒 Materials to Purchase
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {materialListData.material_calculations.map((calc, idx) => (
                    <div key={idx} className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-500">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-lg text-gray-900">{calc.material}</h3>
                        <Badge className="ml-auto bg-blue-600 text-white text-lg px-3 py-1">
                          {calc.quantity} {calc.purchaseUnit || calc.unit}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-1">
                        <strong>Calculation:</strong> {calc.calculation}
                      </p>
                      <p className="text-xs text-gray-500 italic">{calc.notes}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  📦 Materials Breakdown
                  <Badge variant="outline">{materialListData.materials.length} items</Badge>
                </h3>
                <Badge className="bg-green-100 text-green-700">
                  ${Number(materialListData.totals.materials || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}
                </Badge>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold">{t.estimates.code}</th>
                      <th className="px-4 py-2 text-left text-sm font-semibold">{t.estimates.description}</th>
                      <th className="px-4 py-2 text-right text-sm font-semibold">{t.estimates.quantity}</th>
                      <th className="px-4 py-2 text-right text-sm font-semibold">{t.estimates.unit}</th>
                      <th className="px-4 py-2 text-right text-sm font-semibold">{t.estimates.unitPrice}</th>
                      <th className="px-4 py-2 text-right text-sm font-semibold">{t.estimates.amount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialListData.materials.map((item, idx) => {
                      const calc = materialListData.material_calculations?.find(c => {
                        const itemDesc = (item.description || item.name || '').toLowerCase();
                        const calcMaterial = (c.material || '').toLowerCase();

                        if (itemDesc.includes('shingle') && !itemDesc.includes('cap') && calcMaterial.includes('shingle') && !calcMaterial.includes('cap')) {
                          return true;
                        }
                        if ((itemDesc.includes('ridge') || itemDesc.includes('hip')) && (calcMaterial.includes('ridge') || calcMaterial.includes('hip'))) {
                          return true;
                        }
                        if (itemDesc.includes('valley') && calcMaterial.includes('valley')) {
                          return true;
                        }
                        if ((itemDesc.includes('underlayment') || itemDesc.includes('felt') || itemDesc.includes('synthetic')) &&
                            (calcMaterial.includes('underlayment') || calcMaterial.includes('felt') || calcMaterial.includes('synthetic'))) {
                          return true;
                        }
                        if (itemDesc.includes('drip') && calcMaterial.includes('drip')) {
                          return true;
                        }
                        if (itemDesc.includes('nail') && calcMaterial.includes('nail')) {
                          return true;
                        }
                        if (itemDesc.includes('starter') && calcMaterial.includes('starter')) {
                          return true;
                        }
                        if ((itemDesc.includes('ice') || itemDesc.includes('water shield')) && calcMaterial.includes('ice')) {
                          return true;
                        }
                        if (itemDesc.includes('step') && itemDesc.includes('flashing') && calcMaterial.includes('step')) {
                          return true;
                        }
                        return false;
                      });

                      return (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm font-mono">{item.code || ''}</td>
                          <td className="px-4 py-2 text-sm">
                            <div>{item.description || item.name}</div>
                            {item.notes && <div className="text-xs text-gray-500 italic">{item.notes}</div>}
                            {calc && (
                              <div className="text-xs text-blue-700 mt-1 font-medium">
                                🛒 Buy: {calc.quantity} {calc.purchaseUnit || calc.unit}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-sm text-right">{Number(item.quantity || 0).toFixed(2)}</td>
                          <td className="px-4 py-2 text-sm text-right">{item.unit}</td>
                          <td className="px-4 py-2 text-sm text-right">${Number(item.rate || item.unitCost || 0).toFixed(2)}</td>
                          <td className="px-4 py-2 text-sm text-right font-semibold">${Number(item.amount || item.totalCost || 0).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {materialListData.labor.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    👷 Labor & Services
                    <Badge variant="outline">{materialListData.labor.length} items</Badge>
                  </h3>
                  <Badge className="bg-blue-100 text-blue-700">
                    ${Number(materialListData.totals.labor || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}
                  </Badge>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-semibold">Code</th>
                        <th className="px-4 py-2 text-left text-sm font-semibold">Description</th>
                        <th className="px-4 py-2 text-right text-sm font-semibold">Qty</th>
                        <th className="px-4 py-2 text-right text-sm font-semibold">Unit</th>
                        <th className="px-4 py-2 text-right text-sm font-semibold">Rate</th>
                        <th className="px-4 py-2 text-right text-sm font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materialListData.labor.map((item, idx) => (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm font-mono">{item.code || ''}</td>
                          <td className="px-4 py-2 text-sm">
                            <div>{item.description || item.name}</div>
                            {item.notes && <div className="text-xs text-gray-500 italic">{item.notes}</div>}
                          </td>
                          <td className="px-4 py-2 text-sm text-right">{Number(item.quantity || 0).toFixed(2)}</td>
                          <td className="px-4 py-2 text-sm text-right">{item.unit}</td>
                          <td className="px-4 py-2 text-sm text-right">${Number(item.rate || item.unitCost || 0).toFixed(2)}</td>
                          <td className="px-4 py-2 text-sm text-right font-semibold">${Number(item.amount || item.totalCost || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {materialListData.other.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    📋 Other
                    <Badge variant="outline">{materialListData.other.length} items</Badge>
                  </h3>
                  <Badge className="bg-gray-100 text-gray-700">
                    ${Number(materialListData.totals.other || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}
                  </Badge>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-semibold">Code</th>
                        <th className="px-4 py-2 text-left text-sm font-semibold">Description</th>
                        <th className="px-4 py-2 text-right text-sm font-semibold">Qty</th>
                        <th className="px-4 py-2 text-right text-sm font-semibold">Unit</th>
                        <th className="px-4 py-2 text-right text-sm font-semibold">Rate</th>
                        <th className="px-4 py-2 text-right text-sm font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materialListData.other.map((item, idx) => (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm font-mono">{item.code || ''}</td>
                          <td className="px-4 py-2 text-sm">
                            <div>{item.description || item.name}</div>
                            {item.notes && <div className="text-xs text-gray-500 italic">{item.notes}</div>}
                          </td>
                          <td className="px-4 py-2 text-sm text-right">{Number(item.quantity || 0).toFixed(2)}</td>
                          <td className="px-4 py-2 text-sm text-right">{item.unit}</td>
                          <td className="px-4 py-2 text-sm text-right">${Number(item.rate || item.unitCost || 0).toFixed(2)}</td>
                          <td className="px-4 py-2 text-sm text-right font-semibold">${Number(item.amount || item.totalCost || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-gradient-to-r from-green-50 to-blue-50 p-6 rounded-lg border-2 border-green-200">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Materials:</span>
                  <span className="font-semibold">${Number(materialListData.totals.materials || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Labor:</span>
                  <span className="font-semibold">${Number(materialListData.totals.labor || 0).toFixed(2)}</span>
                </div>
                {materialListData.totals.other > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Other:</span>
                    <span className="font-semibold">${Number(materialListData.totals.other || 0).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-3 border-t-2 border-green-300">
                  <span className="text-gray-900">Grand Total:</span>
                  <span className="text-green-700">${Number(materialListData.totals.grand_total || 0).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button onClick={onDownload} className="flex-1 bg-green-600 hover:bg-green-700">
                <Download className="w-4 h-4 mr-2" />
                Download CSV
              </Button>
              <Button onClick={() => onOpenChange(false)} variant="outline" className="flex-1">
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
