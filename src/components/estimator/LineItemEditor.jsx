import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";

export default function LineItemEditor({ items = [], onChange }) {
  const handleAddItem = () => {
    const newItem = {
      code: "",
      description: "",
      quantity: 1,
      unit: "EA",
      rate: 0,
      depreciation_rate: 0,
      amount: 0
    };
    onChange([...items, newItem]);
  };

  const handleUpdateItem = (index, field, value) => {
    const updated = [...items];
    updated[index][field] = value;
    
    // Auto-calculate amount (RCV) when quantity or rate changes
    if (field === 'quantity' || field === 'rate') {
      const qty = parseFloat(updated[index].quantity) || 0;
      const rate = parseFloat(updated[index].rate) || 0;
      updated[index].amount = qty * rate;
    }
    
    onChange(updated);
  };

  const handleDeleteItem = (index) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const calculateDepreciation = (item) => {
    const rcv = item.amount || 0;
    const deprRate = item.depreciation_rate || 0;
    return rcv * (deprRate / 100);
  };

  const calculateACV = (item) => {
    const rcv = item.amount || 0;
    const depr = calculateDepreciation(item);
    return rcv - depr;
  };

  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      <div className="flex items-center justify-between p-4 bg-gray-50 border-b">
        <h3 className="font-semibold text-gray-700">NEW SECTION</h3>
        <Button onClick={handleAddItem} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          Add Line Item
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-white border-b">
            <tr>
              <th className="text-left p-3 font-semibold text-gray-700 w-12">LINE</th>
              <th className="text-left p-3 font-semibold text-gray-700">DESCRIPTION</th>
              <th className="text-center p-3 font-semibold text-gray-700 w-24">QTY</th>
              <th className="text-center p-3 font-semibold text-gray-700 w-20">UNIT</th>
              <th className="text-right p-3 font-semibold text-gray-700 w-28">UNIT PRICE</th>
              <th className="text-right p-3 font-semibold text-blue-600 w-28">RCV</th>
              <th className="text-right p-3 font-semibold text-red-600 w-32">DEPRECIATION</th>
              <th className="text-right p-3 font-semibold text-purple-600 w-28">ACV</th>
              <th className="text-center p-3 font-semibold text-gray-700 w-24">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index} className="border-b hover:bg-gray-50">
                <td className="p-3 text-gray-600">{index + 1}</td>
                <td className="p-3">
                  <Input
                    value={item.description || ""}
                    onChange={(e) => handleUpdateItem(index, 'description', e.target.value)}
                    placeholder="Enter description"
                    className="border-0 focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="p-3">
                  <Input
                    type="number"
                    step="0.01"
                    value={item.quantity || ""}
                    onChange={(e) => handleUpdateItem(index, 'quantity', parseFloat(e.target.value))}
                    className="text-center border-gray-200"
                  />
                </td>
                <td className="p-3">
                  <Input
                    value={item.unit || "EA"}
                    onChange={(e) => handleUpdateItem(index, 'unit', e.target.value)}
                    className="text-center border-gray-200"
                  />
                </td>
                <td className="p-3">
                  <Input
                    type="number"
                    step="0.01"
                    value={item.rate || ""}
                    onChange={(e) => handleUpdateItem(index, 'rate', parseFloat(e.target.value))}
                    className="text-right border-gray-200"
                  />
                </td>
                <td className="p-3 text-right text-blue-600 font-semibold">
                  ${Number(item.amount || 0).toFixed(2)}
                </td>
                <td className="p-3 text-right text-red-600 font-semibold">
                  ${calculateDepreciation(item).toFixed(2)}
                </td>
                <td className="p-3 text-right text-purple-600 font-semibold">
                  ${calculateACV(item).toFixed(2)}
                </td>
                <td className="p-3 text-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteItem(index)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="p-12 text-center text-gray-500">
                  <p className="text-lg mb-2">No line items yet</p>
                  <p className="text-sm">Click "Add Line Item" to get started</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {items.length > 0 && (
        <div className="p-4 bg-gray-50 border-t">
          <div className="flex justify-end gap-12 text-sm font-semibold">
            <div className="text-blue-600">
              Total RCV: ${items.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)}
            </div>
            <div className="text-red-600">
              Total Depreciation: ${items.reduce((sum, item) => sum + calculateDepreciation(item), 0).toFixed(2)}
            </div>
            <div className="text-purple-600">
              Total ACV: ${items.reduce((sum, item) => sum + calculateACV(item), 0).toFixed(2)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}