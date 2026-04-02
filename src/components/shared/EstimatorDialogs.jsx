import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Upload, Loader2, Sparkles, Plus, Brain, Trash2, Ruler, HardHat, Shield, FileText, BookOpen, X
} from "lucide-react";
import MaterialListDialog from "@/components/shared/MaterialListDialog";
import VentilationCalculator from "../estimator/VentilationCalculator";

export default function EstimatorDialogs({ ctx }) {
  const {
    showConfig, setShowConfig,
    config, setConfig,
    isInsuranceJob, setIsInsuranceJob,
    setPricingSource, setMessages,
    formats,
    showVentilationCalc, setShowVentilationCalc,
    satelliteAnalysis, analyzedStructures, currentEstimate,
    handleAddVentilationItems,
    showMemoryDialog, setShowMemoryDialog,
    savedMissedItems, deleteMissedItemFromMemory,
    newMemoryItem, setNewMemoryItem, saveMissedItemToMemory,
    showSuggestions, setShowSuggestions,
    suggestions, handleAddSuggestedItem,
    showMergeDialog, setShowMergeDialog,
    mergeFiles, setMergeFiles,
    lineItems, setLineItems,
    isMerging, setIsMerging,
    saveToHistory,
    convertMeasurementsToLineItemsArray,
    convertSidingMeasurementsToLineItemsArray,
    showMaterialList, setShowMaterialList,
    materialListData, downloadMaterialList,
    showDuplicateDialog, setShowDuplicateDialog,
    duplicateCustomer, setDuplicateCustomer,
    customerInfo, pendingSaveData, setPendingSaveData,
    completeSaveEstimate,
    showProductionDialog, setShowProductionDialog,
    productionEmail, setProductionEmail,
    productionNote, setProductionNote,
    isSendingProduction, setIsSendingProduction,
    showAdjusterDialog, setShowAdjusterDialog,
    adjusterName, setAdjusterName,
    adjusterEmail, setAdjusterEmail,
    adjusterClaimNumber, setAdjusterClaimNumber,
    adjusterNote, setAdjusterNote,
    isSendingAdjuster, setIsSendingAdjuster,
    showTrainingLibrary, setShowTrainingLibrary,
    trainingDocuments, trainingFileInputRef, isUploadingTraining,
    handleUploadTrainingFile, deleteTrainingDocument,
    base44, t,
  } = ctx;

  return (
    <>
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.sidebar.aiEstimator}</DialogTitle>
            <DialogDescription>{t.settings.generalSettings}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Your Specialty</Label>
              <Select value={config.specialty} onValueChange={(v) => setConfig({...config, specialty: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="roofing">Roofing</SelectItem>
                  <SelectItem value="siding">Siding</SelectItem>
                  <SelectItem value="gutters">Gutters</SelectItem>
                  <SelectItem value="windows">Windows & Doors</SelectItem>
                  <SelectItem value="general">General Contractor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {config.specialty === 'siding' && (
              <div className="p-4 bg-teal-50 border border-teal-200 rounded-lg space-y-3">
                <Label className="text-base font-semibold text-teal-900 flex items-center gap-2">
                  <Ruler className="w-4 h-4" />
                  Satellite Siding Settings
                </Label>
                <p className="text-xs text-teal-700">Used when measuring wall areas from satellite.</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">Stories</Label>
                    <Select value={config.storyCount || '1'} onValueChange={(v) => setConfig({...config, storyCount: v})}>
                      <SelectTrigger data-testid="select-story-count" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 Story</SelectItem>
                        <SelectItem value="1.5">1.5 Stories</SelectItem>
                        <SelectItem value="2">2 Stories</SelectItem>
                        <SelectItem value="2.5">2.5 Stories</SelectItem>
                        <SelectItem value="3">3 Stories</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Story Height</Label>
                    <Select value={config.storyHeightFt || '9'} onValueChange={(v) => setConfig({...config, storyHeightFt: v})}>
                      <SelectTrigger data-testid="select-story-height" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="8">8 ft</SelectItem>
                        <SelectItem value="9">9 ft</SelectItem>
                        <SelectItem value="10">10 ft</SelectItem>
                        <SelectItem value="12">12 ft</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Opening Deduction</Label>
                    <Select value={config.openingDeductionPct || '15'} onValueChange={(v) => setConfig({...config, openingDeductionPct: v})}>
                      <SelectTrigger data-testid="select-opening-deduction" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10%</SelectItem>
                        <SelectItem value="15">15%</SelectItem>
                        <SelectItem value="20">20%</SelectItem>
                        <SelectItem value="25">25%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Waste Factor</Label>
                    <Select value={config.sidingWastePct ?? '10'} onValueChange={(v) => setConfig({...config, sidingWastePct: v})}>
                      <SelectTrigger data-testid="select-siding-waste" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0% (no waste)</SelectItem>
                        <SelectItem value="5">5%</SelectItem>
                        <SelectItem value="8">8%</SelectItem>
                        <SelectItem value="10">10% (typical)</SelectItem>
                        <SelectItem value="12">12%</SelectItem>
                        <SelectItem value="15">15%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            <div>
              <Label>{t.common.description}</Label>
              <Input
                value={config.primaryMaterials}
                onChange={(e) => setConfig({...config, primaryMaterials: e.target.value})}
                placeholder="e.g., laminated shingles, vinyl siding"
              />
            </div>

            <div>
              <Label>Default Pricing Source</Label>
              <Select value={config.defaultPricingSource} onValueChange={(v) => setConfig({...config, defaultPricingSource: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xactimate">Xactimate (Old)</SelectItem>
                  <SelectItem value="xactimate_new">Xactimate New</SelectItem>
                  <SelectItem value="symbility">Symbility</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Default Template</Label>
              <Select value={config.defaultTemplate || '__none__'} onValueChange={(v) => setConfig({...config, defaultTemplate: v === '__none__' ? null : v})}>
                <SelectTrigger>
                  <SelectValue placeholder="None (Auto-detect)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (Default)</SelectItem>
                  {formats.map(format => (
                    <SelectItem key={format.id} value={format.id}>
                      {format.format_name} {format.insurance_company ? `(${format.insurance_company})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between p-4 bg-orange-50 border border-orange-200 rounded-lg">
              <div>
                <Label className="text-base font-semibold text-orange-900">Insurance Job Mode</Label>
                <p className="text-sm text-orange-700 mt-0.5">AI will automatically include insurance-required line items: Starter Strip, Ice & Water Shield, Drip Edge (code), Ridge Cap, each Pipe Boot, Step Flashing, Valley Metal. No O&P included.</p>
              </div>
              <Switch
                data-testid="toggle-insurance-job"
                checked={isInsuranceJob}
                onCheckedChange={(checked) => {
                  setIsInsuranceJob(checked);
                  localStorage.setItem('aiEstimatorInsuranceJob', checked ? 'true' : 'false');
                }}
              />
            </div>

            <Button
              onClick={() => {
                localStorage.setItem('aiEstimatorConfig', JSON.stringify(config));
                setPricingSource(config.defaultPricingSource);
                setShowConfig(false);
                setMessages([{
                  role: 'assistant',
                  content: `✅ ${t.settings.saved}`,
                  timestamp: new Date().toISOString()
                }]);
              }}
              className="w-full"
            >
              {t.settings.saveChanges}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ventilation Calculator */}
      <VentilationCalculator
        open={showVentilationCalc}
        onOpenChange={setShowVentilationCalc}
        roofAreaSqFt={
          (satelliteAnalysis?.roof_area_sq * 100) || 
          (analyzedStructures.reduce((sum, s) => sum + s.analysis.roof_area_sq, 0) * 100) || 
          (currentEstimate?.line_items?.find(i => i.unit === 'SQ')?.quantity * 100) || 
          2000 // Default fallback
        }
        onAddItems={handleAddVentilationItems}
      />

      {/* Missed Items Memory Dialog */}
      <Dialog open={showMemoryDialog} onOpenChange={setShowMemoryDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              Commonly Missed Items Memory
            </DialogTitle>
            <DialogDescription>
              Items saved here will be checked every time you run "Check Missing Items". Add items your team commonly forgets.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {savedMissedItems.length > 0 ? (
              <div className="space-y-2">
                {savedMissedItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 p-2 bg-gray-50 rounded-lg border">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      <div className="text-xs text-gray-500 truncate">{item.reason || item.cmd}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      data-testid={`delete-memory-${i}`}
                      onClick={async () => {
                        await deleteMissedItemFromMemory(item.label);
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-500 text-sm">
                No saved items yet. Items get saved automatically when you tap a suggestion from "Check Missing Items", or add one manually below.
              </div>
            )}

            <div className="border-t pt-4 space-y-3">
              <div className="text-sm font-medium">Add Custom Item</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Item Name</Label>
                  <Input
                    placeholder="e.g. Caulking"
                    value={newMemoryItem.label}
                    onChange={e => setNewMemoryItem(prev => ({ ...prev, label: e.target.value }))}
                    data-testid="input-memory-label"
                  />
                </div>
                <div>
                  <Label className="text-xs">Add Command</Label>
                  <Input
                    placeholder="e.g. add caulking sealant"
                    value={newMemoryItem.cmd}
                    onChange={e => setNewMemoryItem(prev => ({ ...prev, cmd: e.target.value }))}
                    data-testid="input-memory-cmd"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Reason / Note</Label>
                <Input
                  placeholder="e.g. Needed around all penetrations"
                  value={newMemoryItem.reason}
                  onChange={e => setNewMemoryItem(prev => ({ ...prev, reason: e.target.value }))}
                  data-testid="input-memory-reason"
                />
              </div>
              <div>
                <Label className="text-xs">Detection Keywords (comma-separated)</Label>
                <Input
                  placeholder="e.g. caulk, sealant, caulking"
                  value={newMemoryItem.keywords}
                  onChange={e => setNewMemoryItem(prev => ({ ...prev, keywords: e.target.value }))}
                  data-testid="input-memory-keywords"
                />
              </div>
              <Button
                className="w-full"
                disabled={!newMemoryItem.label || !newMemoryItem.cmd}
                data-testid="button-save-memory-item"
                onClick={async () => {
                  await saveMissedItemToMemory({
                    label: newMemoryItem.label,
                    cmd: newMemoryItem.cmd,
                    reason: newMemoryItem.reason || `Custom: ${newMemoryItem.label}`,
                    keywords: newMemoryItem.keywords 
                      ? newMemoryItem.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
                      : [newMemoryItem.label.toLowerCase()]
                  });
                  setNewMemoryItem({ label: '', cmd: '', reason: '', keywords: '' });
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Save to Memory
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Suggestions Dialog */}
      <Dialog open={showSuggestions} onOpenChange={setShowSuggestions}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-purple-600" />
              AI Estimate Review
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              {suggestions?.analysis_summary}
            </DialogDescription>
          </DialogHeader>

          {suggestions && (
            <div className="space-y-4">
              {/* Quality Score */}
              <div className="bg-white rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">Estimate Quality Score</span>
                  <Badge className={`text-lg px-4 py-1.5 ${
                    suggestions.estimate_quality_score >= 85 ? 'bg-green-600' :
                    suggestions.estimate_quality_score >= 70 ? 'bg-orange-500' :
                    'bg-red-600'
                  }`}>
                    {suggestions.estimate_quality_score}/100
                  </Badge>
                </div>
              </div>

              {/* Critical Items */}
              {suggestions.suggestions?.filter(s => s.priority === 'critical').length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    🔴 Critical Items (Usually Required)
                  </h3>
                  <div className="space-y-3">
                    {suggestions.suggestions.filter(s => s.priority === 'critical').map((item, idx) => (
                      <div key={idx} className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-900 mb-2">{item.item_description}</h4>
                            <p className="text-sm text-gray-700 mb-2">{item.reason}</p>
                            {item.calculation_note && (
                              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-2 mb-2">
                                <p className="text-xs text-gray-700 italic">💡 {item.calculation_note}</p>
                              </div>
                            )}
                            {item.typical_quantity && item.typical_unit && (
                              <div className="bg-gray-100 rounded px-3 py-1.5 inline-block mt-2">
                                <p className="text-sm font-medium text-gray-900">
                                  Suggested: {item.typical_quantity} {item.typical_unit}
                                </p>
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleAddSuggestedItem(item)}
                            className="bg-red-600 hover:bg-red-700 text-white px-6"
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommended Items */}
              {suggestions.suggestions?.filter(s => s.priority === 'recommended').length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    🟡 Recommended Items (Common for This Job Type)
                  </h3>
                  <div className="space-y-3">
                    {suggestions.suggestions.filter(s => s.priority === 'recommended').map((item, idx) => (
                      <div key={idx} className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-900 mb-2">{item.item_description}</h4>
                            <p className="text-sm text-gray-700 mb-2">{item.reason}</p>
                            {item.calculation_note && (
                              <div className="bg-yellow-100 border-l-4 border-yellow-400 p-2 mb-2">
                                <p className="text-xs text-gray-700 italic">💡 {item.calculation_note}</p>
                              </div>
                            )}
                            {item.typical_quantity && item.typical_unit && (
                              <div className="bg-gray-100 rounded px-3 py-1.5 inline-block mt-2">
                                <p className="text-sm font-medium text-gray-900">
                                  Suggested: {item.typical_quantity} {item.typical_unit}
                                </p>
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleAddSuggestedItem(item)}
                            className="bg-red-600 hover:bg-red-700 text-white px-6"
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Optional Items */}
              {suggestions.suggestions?.filter(s => s.priority === 'optional').length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    🔵 Optional Items (Upgrades/Add-ons)
                  </h3>
                  <div className="space-y-3">
                    {suggestions.suggestions.filter(s => s.priority === 'optional').map((item, idx) => (
                      <div key={idx} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-900 mb-2">{item.item_description}</h4>
                            <p className="text-sm text-gray-700 mb-2">{item.reason}</p>
                            {item.calculation_note && (
                              <div className="bg-blue-100 border-l-4 border-blue-400 p-2 mb-2">
                                <p className="text-xs text-gray-700 italic">💡 {item.calculation_note}</p>
                              </div>
                            )}
                            {item.typical_quantity && item.typical_unit && (
                              <div className="bg-gray-100 rounded px-3 py-1.5 inline-block mt-2">
                                <p className="text-sm font-medium text-gray-900">
                                  Suggested: {item.typical_quantity} {item.typical_unit}
                                </p>
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleAddSuggestedItem(item)}
                            className="bg-red-600 hover:bg-red-700 text-white px-6"
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No Suggestions */}
              {suggestions.suggestions?.length === 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                  <p className="text-lg font-semibold text-green-900 mb-1">✅ Estimate Looks Complete!</p>
                  <p className="text-sm text-green-700">No missing items detected based on industry standards.</p>
                </div>
              )}

              <div className="flex justify-end pt-4 border-t">
                <Button variant="outline" onClick={() => setShowSuggestions(false)}>
                  {t.common.close}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-blue-600" />
              Merge Additional Documents
            </DialogTitle>
            <DialogDescription>
              Upload roof, siding, or other estimates to merge with your current estimate
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900 mb-2">
                <strong>Current Estimate:</strong> {lineItems.length} items • ${lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0).toLocaleString()}
              </p>
              <p className="text-xs text-blue-700">
                Upload additional documents to add more line items to this estimate
              </p>
            </div>

            <div>
              <Label>Upload Documents (PDF, PNG, JPG)</Label>
              <input
                type="file"
                onChange={(e) => setMergeFiles(Array.from(e.target.files || []))}
                className="mt-2 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                accept=".pdf,.PDF,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG"
                multiple
              />
            </div>

            {mergeFiles.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-green-900 mb-2">Files to merge:</p>
                {mergeFiles.map((file, idx) => (
                  <p key={idx} className="text-xs text-green-700">• {file.name}</p>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => {
                setShowMergeDialog(false);
                setMergeFiles([]);
              }}>
                {t.common.cancel}
              </Button>
              <Button
                onClick={async () => {
                  if (mergeFiles.length === 0) {
                    alert('Select files to merge');
                    return;
                  }

                  setIsMerging(true);
                  saveToHistory(); // Save current state before merging

                  try {
                    const uploadedUrls = [];
                    for (const file of mergeFiles) {
                      const { file_url } = await base44.integrations.Core.UploadFile({ file });
                      uploadedUrls.push(file_url);
                    }

                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: `🔄 **Merging ${mergeFiles.length} documents into current estimate...**`,
                      timestamp: new Date().toISOString()
                    }]);

                    // Process each file and collect items
                    const newItems = [];
                    for (let i = 0; i < uploadedUrls.length; i++) {
                      const fileUrl = [uploadedUrls[i]];
                      const docName = mergeFiles[i].name;

                      const typeCheck = await base44.integrations.Core.InvokeLLM({
                        prompt: `What type of document is this? Respond with ONLY: "hover_measurement", "siding_measurement", or "insurance_estimate"`,
                        file_urls: fileUrl
                      });

                      const docType = typeCheck.toLowerCase().includes('siding') ? 'siding_measurement' :
                                    typeCheck.toLowerCase().includes('hover') ? 'hover_measurement' : 'insurance_estimate';

                      if (docType === 'hover_measurement') {
                        const measurements = await base44.integrations.Core.InvokeLLM({
                          prompt: `Extract roof measurements: roof_area_sq, ridge_lf, hip_lf, valley_lf, rake_lf, eave_lf, step_flashing_lf, apron_flashing_lf, pitch, gutter_lf, downspout_count`,
                          file_urls: fileUrl,
                          response_json_schema: {
                            type: "object",
                            properties: {
                              roof_area_sq: { type: "number" }, ridge_lf: { type: "number" }, hip_lf: { type: "number" },
                              valley_lf: { type: "number" }, rake_lf: { type: "number" }, eave_lf: { type: "number" },
                              step_flashing_lf: { type: "number" }, apron_flashing_lf: { type: "number" }, pitch: { type: "string" }, gutter_lf: { type: "number" },
                              downspout_count: { type: "number" }
                            }
                          }
                        });
                        const items = await convertMeasurementsToLineItemsArray(measurements);
                        newItems.push(...items);

                      } else if (docType === 'siding_measurement') {
                        const measurements = await base44.integrations.Core.InvokeLLM({
                          prompt: `Extract siding measurements: wall_area_sq, wall_top_lf, wall_bottom_lf, inside_corners_lf, outside_corners_lf`,
                          file_urls: fileUrl,
                          response_json_schema: {
                            type: "object",
                            properties: {
                              wall_area_sq: { type: "number" }, wall_top_lf: { type: "number" }, wall_bottom_lf: { type: "number" },
                              inside_corners_lf: { type: "number" }, outside_corners_lf: { type: "number" }
                            }
                          }
                        });
                        const items = await convertSidingMeasurementsToLineItemsArray(measurements);
                        newItems.push(...items);

                      } else {
                        const response = await base44.integrations.Core.InvokeLLM({
                          prompt: `Extract ALL line items with description, quantity, unit, rate`,
                          file_urls: fileUrl,
                          response_json_schema: {
                            type: "object",
                            properties: {
                              line_items: {
                                type: "array",
                                items: {
                                  type: "object",
                                  properties: {
                                    code: { type: "string" }, description: { type: "string" },
                                    quantity: { type: "number" }, unit: { type: "string" }, rate: { type: "number" }
                                  }
                                }
                              }
                            }
                          }
                        });

                        if (response?.line_items) {
                          const items = response.line_items.map((item, idx) => ({
                            line: lineItems.length + newItems.length + idx + 1,
                            code: item.code || '',
                            description: item.description,
                            quantity: Number(item.quantity) || 0,
                            unit: item.unit || 'EA',
                            rate: Number(item.rate) || 0,
                            rcv: (Number(item.rate) || 0) * (Number(item.quantity) || 0),
                            acv: (Number(item.rate) || 0) * (Number(item.quantity) || 0),
                            amount: (Number(item.rate) || 0) * (Number(item.quantity) || 0),
                            depreciation: 0
                          }));
                          newItems.push(...items);
                        }
                      }
                    }

                    // Merge with existing items
                    const mergedItems = [...lineItems, ...newItems].map((item, idx) => ({ ...item, line: idx + 1 }));
                    setLineItems(mergedItems);

                    const newTotal = mergedItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);

                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: `✅ **Merged ${mergeFiles.length} documents!**\n\n📊 Added ${newItems.length} new items\n💰 New total: $${newTotal.toLocaleString()}`,
                      timestamp: new Date().toISOString()
                    }]);

                    setShowMergeDialog(false);
                    setMergeFiles([]);
                  } catch (error) {
                    alert('Merge failed: ' + error.message);
                  }

                  setIsMerging(false);
                }}
                disabled={mergeFiles.length === 0 || isMerging}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isMerging ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Merging...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Merge {mergeFiles.length > 0 ? `${mergeFiles.length} Files` : 'Documents'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <MaterialListDialog
        open={showMaterialList}
        onOpenChange={setShowMaterialList}
        materialListData={materialListData}
        onDownload={downloadMaterialList}
        t={t}
      />

      {/* Duplicate Customer Dialog */}
      <Dialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>⚠️ Duplicate Customer Detected</DialogTitle>
            <DialogDescription>
              A customer with this email/phone already exists in your CRM.
            </DialogDescription>
          </DialogHeader>

          {duplicateCustomer && (
            <div className="space-y-4">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="font-semibold text-gray-900 mb-2">Existing Customer:</p>
                <div className="text-sm space-y-1">
                  <p><strong>Name:</strong> {duplicateCustomer.name}</p>
                  <p><strong>Email:</strong> {duplicateCustomer.email || 'N/A'}</p>
                  <p><strong>Phone:</strong> {duplicateCustomer.phone || 'N/A'}</p>
                  <p><strong>Address:</strong> {[duplicateCustomer.street, duplicateCustomer.city, duplicateCustomer.state, duplicateCustomer.zip].filter(Boolean).join(', ') || 'N/A'}</p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="font-semibold text-gray-900 mb-2">New Customer Info:</p>
                <div className="text-sm space-y-1">
                  <p><strong>Name:</strong> {customerInfo.customer_name}</p>
                  <p><strong>Email:</strong> {customerInfo.customer_email || 'N/A'}</p>
                  <p><strong>Phone:</strong> {customerInfo.customer_phone || 'N/A'}</p>
                  <p><strong>Address:</strong> {customerInfo.property_address || 'N/A'}</p>
                </div>
              </div>

              <p className="text-sm text-gray-600">
                What would you like to do?
              </p>

              <div className="flex flex-col gap-3">
                <Button
                  onClick={async () => {
                    // Update existing customer
                    const { companyId } = pendingSaveData;
                    await base44.entities.Customer.update(duplicateCustomer.id, {
                      name: customerInfo.customer_name || duplicateCustomer.name,
                      email: customerInfo.customer_email || duplicateCustomer.email,
                      phone: customerInfo.customer_phone || duplicateCustomer.phone,
                      street: customerInfo.property_address || duplicateCustomer.street,
                      insurance_company: customerInfo.insurance_company || duplicateCustomer.insurance_company,
                    });

                    setShowDuplicateDialog(false);

                    // Continue with save using existing customer ID
                    await completeSaveEstimate(duplicateCustomer.id, pendingSaveData);
                  }}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Update Existing Customer
                </Button>

                <Button
                  onClick={async () => {
                    // Create new duplicate customer
                    const { companyId } = pendingSaveData;
                    const newCustomer = await base44.entities.Customer.create({
                      company_id: companyId,
                      name: customerInfo.customer_name,
                      email: customerInfo.customer_email || '',
                      phone: customerInfo.customer_phone || '',
                      street: customerInfo.property_address || '',
                      insurance_company: customerInfo.insurance_company || '',
                    });

                    setShowDuplicateDialog(false);

                    // Continue with save using new customer ID
                    await completeSaveEstimate(newCustomer.id, pendingSaveData);
                  }}
                  variant="outline"
                  className="border-green-600 text-green-700 hover:bg-green-50"
                >
                  Create New Customer (Allow Duplicate)
                </Button>

                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDuplicateDialog(false);
                    setDuplicateCustomer(null);
                    setPendingSaveData(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Send to Production for Approval Dialog */}
      <Dialog open={showProductionDialog} onOpenChange={(open) => { setShowProductionDialog(open); if (!open) { setProductionEmail(''); setProductionNote(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardHat className="w-5 h-5 text-orange-600" />
              Send to Production for Approval
            </DialogTitle>
            <DialogDescription>
              Email this estimate to your production team for review and approval before work begins.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="production-email">Production Team Email <span className="text-red-500">*</span></Label>
              <Input
                id="production-email"
                data-testid="input-production-email"
                type="email"
                placeholder="production@yourcompany.com"
                value={productionEmail}
                onChange={e => setProductionEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="production-note">Note to Team (optional)</Label>
              <Textarea
                id="production-note"
                data-testid="input-production-note"
                placeholder="Any special instructions or context for the production crew..."
                rows={3}
                value={productionNote}
                onChange={e => setProductionNote(e.target.value)}
              />
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
              <strong>Estimate:</strong> {customerInfo.customer_name || 'Unnamed Customer'} — {lineItems.length} line item{lineItems.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowProductionDialog(false)}>Cancel</Button>
            <Button
              data-testid="button-send-production"
              disabled={!productionEmail.trim() || isSendingProduction}
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={async () => {
                if (!productionEmail.trim()) return;
                setIsSendingProduction(true);
                try {
                  const totalRcv = lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
                  const totalAcv = lineItems.reduce((acc, i) => acc + (Number(i.acv) || 0), 0);
                  await base44.functions.invoke('sendEstimateEmail', {
                    to: productionEmail.trim(),
                    customerName: customerInfo.customer_name || 'Customer',
                    estimateData: {
                      estimate_number: currentEstimate?.estimate_number || 'DRAFT',
                      estimate_title: currentEstimate?.title || 'Estimate',
                      line_items: lineItems,
                      total_rcv: totalRcv,
                      total_acv: totalAcv,
                    },
                    emailType: 'production_approval',
                    note: productionNote.trim(),
                  });
                  setMessages(prev => [...prev, { role: 'assistant', content: `✅ Estimate sent to production team at ${productionEmail} for approval.`, timestamp: new Date().toISOString() }]);
                  setShowProductionDialog(false);
                  setProductionEmail('');
                  setProductionNote('');
                } catch (err) {
                  alert('Failed to send: ' + err.message);
                } finally {
                  setIsSendingProduction(false);
                }
              }}
            >
              {isSendingProduction ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</> : <><HardHat className="w-4 h-4 mr-2" />Send for Approval</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send to Insurance Adjuster Dialog */}
      <Dialog open={showAdjusterDialog} onOpenChange={(open) => { setShowAdjusterDialog(open); if (!open) { setAdjusterName(''); setAdjusterEmail(''); setAdjusterClaimNumber(''); setAdjusterNote(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Send to Insurance Adjuster
            </DialogTitle>
            <DialogDescription>
              Send this estimate directly to the insurance adjuster handling the claim.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="adjuster-name">Adjuster Name <span className="text-red-500">*</span></Label>
                <Input
                  id="adjuster-name"
                  data-testid="input-adjuster-name"
                  placeholder="Jane Smith"
                  value={adjusterName}
                  onChange={e => setAdjusterName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="adjuster-claim">Claim Number</Label>
                <Input
                  id="adjuster-claim"
                  data-testid="input-adjuster-claim"
                  placeholder="CLM-2026-00001"
                  value={adjusterClaimNumber}
                  onChange={e => setAdjusterClaimNumber(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="adjuster-email">Adjuster Email <span className="text-red-500">*</span></Label>
              <Input
                id="adjuster-email"
                data-testid="input-adjuster-email"
                type="email"
                placeholder="adjuster@insuranceco.com"
                value={adjusterEmail}
                onChange={e => setAdjusterEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adjuster-note">Note to Adjuster (optional)</Label>
              <Textarea
                id="adjuster-note"
                data-testid="input-adjuster-note"
                placeholder="Supplemental notes, scope of damage, coverage questions..."
                rows={3}
                value={adjusterNote}
                onChange={e => setAdjusterNote(e.target.value)}
              />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <strong>Insured:</strong> {customerInfo.customer_name || 'Unnamed'} · <strong>Address:</strong> {customerInfo.property_address || 'N/A'}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowAdjusterDialog(false)}>Cancel</Button>
            <Button
              data-testid="button-send-adjuster"
              disabled={!adjusterEmail.trim() || !adjusterName.trim() || isSendingAdjuster}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={async () => {
                if (!adjusterEmail.trim() || !adjusterName.trim()) return;
                setIsSendingAdjuster(true);
                try {
                  const totalRcv = lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
                  const totalAcv = lineItems.reduce((acc, i) => acc + (Number(i.acv) || 0), 0);
                  await base44.functions.invoke('sendEstimateEmail', {
                    to: adjusterEmail.trim(),
                    customerName: adjusterName.trim(),
                    estimateData: {
                      estimate_number: currentEstimate?.estimate_number || 'DRAFT',
                      estimate_title: currentEstimate?.title || 'Estimate',
                      line_items: lineItems,
                      total_rcv: totalRcv,
                      total_acv: totalAcv,
                      insured_name: customerInfo.customer_name || '',
                      property_address: customerInfo.property_address || '',
                      claim_number: adjusterClaimNumber.trim(),
                    },
                    emailType: 'insurance_adjuster',
                    adjusterName: adjusterName.trim(),
                    claimNumber: adjusterClaimNumber.trim(),
                    note: adjusterNote.trim(),
                  });
                  setMessages(prev => [...prev, { role: 'assistant', content: `✅ Estimate sent to adjuster ${adjusterName} at ${adjusterEmail}${adjusterClaimNumber ? ` (Claim: ${adjusterClaimNumber})` : ''}.`, timestamp: new Date().toISOString() }]);
                  setShowAdjusterDialog(false);
                  setAdjusterName(''); setAdjusterEmail(''); setAdjusterClaimNumber(''); setAdjusterNote('');
                } catch (err) {
                  alert('Failed to send: ' + err.message);
                } finally {
                  setIsSendingAdjuster(false);
                }
              }}
            >
              {isSendingAdjuster ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</> : <><Shield className="w-4 h-4 mr-2" />Send to Adjuster</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Training Library Dialog */}
      <Dialog open={showTrainingLibrary} onOpenChange={setShowTrainingLibrary}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              AI Training Library
            </DialogTitle>
            <DialogDescription>
              Upload reference documents (EagleView, HOVER, Xactimate, insurance estimates) so the AI studies them and writes more accurate estimates every time.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Upload area */}
            <div
              className="border-2 border-dashed border-purple-200 rounded-xl p-6 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors"
              onClick={() => trainingFileInputRef?.current?.click()}
            >
              {isUploadingTraining ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
                  <p className="text-sm font-medium text-purple-700">Uploading & extracting training data...</p>
                  <p className="text-xs text-gray-500">The AI is reading your document — this takes 15-30 seconds</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <BookOpen className="w-8 h-8 text-purple-400" />
                  <p className="text-sm font-semibold text-gray-700">Click to upload a training document</p>
                  <p className="text-xs text-gray-500">EagleView, HOVER, Xactimate, insurance estimate — any PDF or image</p>
                  <p className="text-xs text-purple-600 font-medium mt-1">The AI will read it and remember measurement patterns for all future estimates</p>
                </div>
              )}
            </div>

            {/* Existing training docs */}
            {trainingDocuments.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-700">Stored Training Documents ({trainingDocuments.length})</p>
                {trainingDocuments.map((doc) => (
                  <div key={doc.id} className="flex items-start gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                    <FileText className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{doc.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-3">{doc.content?.slice(0, 200)}...</p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                      onClick={() => deleteTrainingDocument(doc.id)}
                      data-testid={`delete-training-${doc.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-sm text-gray-400">
                No training documents yet. Upload your first reference document above.
              </div>
            )}

            {trainingDocuments.length > 0 && (
              <div className="p-3 bg-green-50 rounded-lg border border-green-100 text-xs text-green-800">
                ✅ The AI is already using these {trainingDocuments.length} document{trainingDocuments.length > 1 ? 's' : ''} as reference for every estimate it builds.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
