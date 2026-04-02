import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wind, Plus, Info, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function VentilationCalculator({ 
  roofAreaSqFt, 
  onAddItems,
  open,
  onOpenChange 
}) {
  const [ventData, setVentData] = useState({
    existingBoxVents: 0,
    boxVentNFA: 50, // sq inches
    existingTurbines: 0,
    turbineNFA: 80, // sq inches
    existingRidgeVent: 0, // linear feet
    ridgeVentNFA: 18, // sq inches per LF
    soffitExisting: true // assuming existing soffit is sufficient for now, focusing on exhaust
  });

  const [calculation, setCalculation] = useState(null);

  useEffect(() => {
    if (roofAreaSqFt && open) {
      calculateVentilation();
    }
  }, [roofAreaSqFt, ventData, open]);

  const calculateVentilation = () => {
    // 1. Calculate Required Total Exhaust NFA (Net Free Area)
    // Rule: 1 sq ft NFA per 300 sq ft attic floor (approx roof area/footprint)
    // For balanced system: 50% intake, 50% exhaust.
    // Total NFA needed = RoofArea / 300.
    // Exhaust NFA needed = Total NFA / 2.
    
    // Using roof area as a proxy for attic floor (conservative estimate if pitch is steep, but standard)
    // Ideally we use footprint, but roof area is safer (more ventilation is better than less)
    const totalRequiredNFA = roofAreaSqFt / 300; // in sq ft
    const requiredExhaustNFA = totalRequiredNFA / 2; // in sq ft
    
    // 2. Calculate Existing Exhaust NFA
    const boxVentNFASqFt = (ventData.existingBoxVents * ventData.boxVentNFA) / 144;
    const turbineNFASqFt = (ventData.existingTurbines * ventData.turbineNFA) / 144;
    const ridgeVentNFASqFt = (ventData.existingRidgeVent * ventData.ridgeVentNFA) / 144;
    
    const currentExhaustNFA = boxVentNFASqFt + turbineNFASqFt + ridgeVentNFASqFt;
    
    // 3. Determine Deficit
    const deficitSqFt = requiredExhaustNFA - currentExhaustNFA;
    
    // 4. Recommendations
    const neededRidgeVentLF = deficitSqFt > 0 ? Math.ceil((deficitSqFt * 144) / ventData.ridgeVentNFA) : 0;
    const neededBoxVents = deficitSqFt > 0 ? Math.ceil((deficitSqFt * 144) / ventData.boxVentNFA) : 0;
    
    setCalculation({
      requiredExhaustNFA,
      currentExhaustNFA,
      deficitSqFt,
      neededRidgeVentLF,
      neededBoxVents,
      status: deficitSqFt <= 0.1 ? 'good' : 'deficit' // 0.1 tolerance
    });
  };

  const handleAddRidgeVent = () => {
    if (!calculation || calculation.neededRidgeVentLF <= 0) return;
    
    onAddItems([
      {
        code: "RFG VEN", // Standard placeholder code
        description: `Ridge Vent Installation (Added to meet 1:300 code - Deficit was ${calculation.deficitSqFt.toFixed(2)} sq ft)`,
        quantity: calculation.neededRidgeVentLF,
        unit: "LF",
        rate: 0, // Should be filled by price list if available in parent
        category: "Roofing"
      }
    ]);
    onOpenChange(false);
  };
  
  const handleAddBoxVents = () => {
    if (!calculation || calculation.neededBoxVents <= 0) return;
    
    onAddItems([
      {
        code: "RFG VENT",
        description: `Box Vent Installation (Added to meet 1:300 code - Deficit was ${calculation.deficitSqFt.toFixed(2)} sq ft)`,
        quantity: calculation.neededBoxVents,
        unit: "EA",
        rate: 0,
        category: "Roofing"
      }
    ]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wind className="w-5 h-5 text-blue-600" />
            Ventilation Calculator
          </DialogTitle>
          <DialogDescription>
            Check if existing ventilation meets the 1:300 code standard based on {Math.round(roofAreaSqFt || 0).toLocaleString()} sq ft roof area.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Inputs */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm text-gray-900 border-b pb-2">Existing Exhaust Ventilation</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Box Vents (Quantity)</Label>
                <div className="flex gap-2">
                  <Input 
                    type="number" 
                    min="0"
                    value={ventData.existingBoxVents}
                    onChange={(e) => setVentData({...ventData, existingBoxVents: parseInt(e.target.value) || 0})}
                  />
                  <div className="w-24 shrink-0">
                    <Label className="text-[10px] text-gray-500">NFA (in²)</Label>
                    <Input 
                      className="h-7 text-xs" 
                      value={ventData.boxVentNFA}
                      onChange={(e) => setVentData({...ventData, boxVentNFA: parseInt(e.target.value) || 50})}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Turbine Vents (Quantity)</Label>
                <div className="flex gap-2">
                  <Input 
                    type="number" 
                    min="0"
                    value={ventData.existingTurbines}
                    onChange={(e) => setVentData({...ventData, existingTurbines: parseInt(e.target.value) || 0})}
                  />
                  <div className="w-24 shrink-0">
                    <Label className="text-[10px] text-gray-500">NFA (in²)</Label>
                    <Input 
                      className="h-7 text-xs" 
                      value={ventData.turbineNFA}
                      onChange={(e) => setVentData({...ventData, turbineNFA: parseInt(e.target.value) || 80})}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2 col-span-2">
                <Label>Existing Ridge Vent (Linear Feet)</Label>
                <div className="flex gap-2">
                  <Input 
                    type="number" 
                    min="0"
                    value={ventData.existingRidgeVent}
                    onChange={(e) => setVentData({...ventData, existingRidgeVent: parseInt(e.target.value) || 0})}
                  />
                  <div className="w-24 shrink-0">
                    <Label className="text-[10px] text-gray-500">NFA/ft (in²)</Label>
                    <Input 
                      className="h-7 text-xs" 
                      value={ventData.ridgeVentNFA}
                      onChange={(e) => setVentData({...ventData, ridgeVentNFA: parseInt(e.target.value) || 18})}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Results */}
          {calculation && (
            <div className={`rounded-lg border p-4 ${calculation.status === 'good' ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}`}>
              <div className="flex items-start gap-3">
                {calculation.status === 'good' ? (
                  <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-6 h-6 text-orange-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 space-y-1">
                  <h4 className={`font-semibold ${calculation.status === 'good' ? 'text-green-900' : 'text-orange-900'}`}>
                    {calculation.status === 'good' ? 'Ventilation Sufficient' : 'Insufficient Ventilation'}
                  </h4>
                  <p className="text-sm text-gray-700">
                    Required Exhaust NFA: <strong>{calculation.requiredExhaustNFA.toFixed(2)} sq ft</strong>
                    <br />
                    Current Exhaust NFA: <strong>{calculation.currentExhaustNFA.toFixed(2)} sq ft</strong>
                  </p>
                  
                  {calculation.status === 'deficit' && (
                    <div className="mt-3 pt-3 border-t border-orange-200/50">
                      <p className="text-sm font-medium text-orange-900 mb-2">Recommended Additions (Choose One):</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="bg-white border-orange-300 text-orange-800 hover:bg-orange-100 h-auto py-2 flex-col gap-1"
                          onClick={handleAddRidgeVent}
                        >
                          <span className="font-bold text-lg">+{calculation.neededRidgeVentLF} LF</span>
                          <span className="text-xs font-normal">Ridge Vent</span>
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="bg-white border-orange-300 text-orange-800 hover:bg-orange-100 h-auto py-2 flex-col gap-1"
                          onClick={handleAddBoxVents}
                        >
                          <span className="font-bold text-lg">+{calculation.neededBoxVents} EA</span>
                          <span className="text-xs font-normal">Box Vents</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}