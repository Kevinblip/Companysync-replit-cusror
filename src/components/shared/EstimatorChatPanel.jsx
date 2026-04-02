import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Upload, Loader2, Sparkles, Send, Paperclip, FileText, Save, X,
  UserCircle, ClipboardList, Download, Mail, Plus, Camera,
  AlertTriangle, Brain, Wind, Satellite
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Hammer, Share2, Package, TrendingUp, ArrowUp, DollarSign, HardHat, Shield } from "lucide-react";
import LineItemEditor from "../estimates/LineItemEditor";

export default function EstimatorChatPanel({ ctx }) {
  const {
    currentEstimate,
    messages, setMessages,
    isProcessing, isAnalyzing,
    userInput, setUserInput,
    lineItems, setLineItems,
    customerInfo, setCustomerInfo,
    selectedMode,
    isInsuranceJob,
    fileInputRef, messagesEndRef,
    handleSendMessage,
    handleAddSuggestedItem,
    processWithAI,
    checkMissingItems,
    missingSuggestions, setMissingSuggestions,
    saveMissedItemToMemory,
    savedMissedItems,
    handleFileSelect,
    competitorEstimates,
    selectedFormatId, handleFormatChange,
    pricingSource, handlePricingSourceChange,
    formats, currentFormat,
    getHeaderColorClass,
    selectedContactId, handleSelectContact,
    allContacts, allInspectionJobs,
    linkedInspectionJobId, setLinkedInspectionJobId,
    linkedJobMedia,
    roofTypeSelection, setRoofTypeSelection,
    handleRegenerateWithGutters,
    handleReviewEstimate,
    handleGenerateMaterialList, isGeneratingMaterials,
    setShowMergeDialog, setShowMemoryDialog,
    setShowVentilationCalc, setShowProductionDialog, setShowAdjusterDialog,
    handleExportToXactimate, isExporting,
    handleSaveEstimate,
    setShowMergeWithExistingDialog,
    saveToHistory,
    estimateOutputLanguage, setEstimateOutputLanguage,
    generateEstimateHTML,
    satelliteAnalysis, satelliteAddress,
    base44, t, navigate, user, myCompany, createPageUrl,
  } = ctx;

  return (
    <>
      {/* NEW: Chat Interface for AI Adjustments - Shows after estimate is created */}
      {currentEstimate && (
        <Card className="bg-white shadow-lg">
          <CardContent className="p-0">



            {/* Chat History Display */}
            <div className="h-[300px] overflow-y-auto p-6 space-y-4">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg p-4 ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}>
                    <div className="whitespace-pre-wrap">{msg.content}</div>

                    {/* Show Add buttons for suggestions inline */}
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {msg.suggestions.map((suggestion, sidx) => (
                          <Button
                            key={sidx}
                            size="sm"
                            variant="outline"
                            onClick={() => handleAddSuggestedItem(suggestion)}
                            className="w-full justify-start text-left bg-white hover:bg-blue-50 border-blue-300"
                          >
                            <Plus className="w-4 h-4 mr-2 flex-shrink-0" />
                            <span className="text-xs">Add {suggestion.item_description}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {(isProcessing || isAnalyzing) && (
                <div className="flex justify-start">
                  <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-6 border-2 border-blue-200">
                    <div className="flex flex-col items-center gap-3">
                      <div className="relative inline-block">
                        <div className="absolute inset-0 animate-ping opacity-30">
                          <svg className="w-12 h-12 mx-auto" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10 80 L50 20 L90 80 Z" fill="currentColor" className="text-purple-600" />
                          </svg>
                        </div>
                        <svg className="w-12 h-12 mx-auto animate-spin" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10 80 L50 20 L90 80 Z" fill="currentColor" className="text-purple-600" />
                        </svg>
                      </div>
                    <p className="text-sm font-medium text-gray-900">{t.ai.thinking}</p>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-4 bg-white">
              {isInsuranceJob && (
                <div data-testid="badge-insurance-mode-satellite" className="flex items-center gap-1.5 mb-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg w-fit">
                  <span className="text-orange-600 text-xs font-semibold">🏷️ Insurance Mode ON</span>
                  <span className="text-orange-500 text-xs">— AI will include all required insurance line items, no O&P</span>
                </div>
              )}
              <form onSubmit={handleSendMessage} className="flex gap-2">
                {selectedMode === 'document' && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileSelect}
                      className="hidden"
                      accept=".pdf,.PDF,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG"
                      multiple
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isProcessing}
                    >
                      <Paperclip className="w-5 h-5" />
                    </Button>
                  </>
                )}
                <Input
                  placeholder={t.ai.askQuestion}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  disabled={isProcessing}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  disabled={isProcessing}
                  className="bg-gradient-to-r from-blue-600 to-purple-600"
                >
                  <Send className="w-5 h-5" />
                </Button>
              </form>
              {lineItems.length > 0 && (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-1.5" data-testid="quick-action-chips">
                    {[
                      { label: 'Dumpster', cmd: 'add dumpster' },
                      { label: '10% Waste', cmd: 'add 10% waste' },
                      { label: 'O&P', cmd: 'add overhead and profit' },
                      { label: 'Steep', cmd: 'apply steep roof' },
                      { label: 'High Roof', cmd: 'apply high roof' },
                      { label: 'Pipe Boot', cmd: 'add 1 pipe boot' },
                      { label: 'Plywood', cmd: 'add 4 sheets plywood' },
                      { label: 'Vent', cmd: 'add 1 roof vent' },
                      { label: 'Skylight', cmd: 'add 1 skylight' },
                      { label: '15% Markup', cmd: '15% markup' },
                      { label: 'Permit', cmd: 'add permit' },
                      ...(competitorEstimates.length > 0 ? [{ label: '📊 Compare Competitors', cmd: 'Compare this estimate with the competitor estimates on file. Highlight major price differences, items we include that they don\'t, items they include that we don\'t, and overall value differences.', highlight: true }] : []),
                    ].map(chip => (
                      <button
                        key={chip.cmd}
                        type="button"
                        data-testid={`chip-${chip.label.toLowerCase().replace(/\s+/g, '-')}`}
                        onClick={() => {
                          setMessages(prev => [...prev, { role: 'user', content: chip.cmd, timestamp: new Date().toISOString() }]);
                          processWithAI(chip.cmd);
                        }}
                        disabled={isProcessing}
                        className={`px-2.5 py-1 text-xs font-medium rounded-full border hover-elevate disabled:opacity-50 transition-colors ${chip.highlight ? 'border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100' : 'border-gray-200 bg-gray-50 text-gray-700'}`}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  {missingSuggestions.length > 0 && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg" data-testid="missing-suggestions">
                      <div className="flex items-center gap-1 mb-1.5">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span className="text-xs font-semibold text-amber-800">Suggested Missing Items:</span>
                        <button onClick={() => setMissingSuggestions([])} className="ml-auto text-amber-400 hover:text-amber-600">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {missingSuggestions.map(s => (
                          <button
                            key={s.cmd}
                            type="button"
                            data-testid={`suggest-${s.label.toLowerCase().replace(/[\s&]+/g, '-')}`}
                            onClick={() => {
                              setMessages(prev => [...prev, { role: 'user', content: s.cmd, timestamp: new Date().toISOString() }]);
                              processWithAI(s.cmd);
                              setMissingSuggestions(prev => prev.filter(x => x.cmd !== s.cmd));
                              if (!s.fromMemory) {
                                saveMissedItemToMemory(s);
                              }
                            }}
                            disabled={isProcessing}
                            className={`px-2.5 py-1 text-xs font-medium rounded-full border disabled:opacity-50 ${s.fromMemory ? 'border-purple-300 bg-purple-50 text-purple-800' : 'border-amber-300 bg-amber-100 text-amber-800'} hover-elevate`}
                            title={`${s.reason}${!s.fromMemory ? ' (will save to memory)' : ' (from memory)'}`}
                          >
                            + {s.label} {s.fromMemory && '(saved)'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {currentEstimate && (
        <>
          <Card className="bg-white shadow-lg">
            <CardHeader className={`${getHeaderColorClass(currentFormat)} text-white`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <UserCircle className="w-5 h-5" />
                    {t.sidebar.customers}
                  </CardTitle>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                  <span className="text-sm text-white/90">Template:</span>
                  <Select value={selectedFormatId || ''} onValueChange={handleFormatChange}>
                    <SelectTrigger className="w-full sm:w-64 bg-white/20 text-white border-white/30">
                      <SelectValue placeholder="Auto (based on pricing)" />
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

                  <span className="text-sm text-white/90">Pricing:</span>
                  <Select value={pricingSource} onValueChange={handlePricingSourceChange}>
                    <SelectTrigger className="w-full sm:w-40 bg-white/20 text-white border-white/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="xactimate">Xactimate (Old)</SelectItem>
                      <SelectItem value="xactimate_new">Xactimate New 🆕</SelectItem>
                      <SelectItem value="symbility">Symbility</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <Label>Select Existing Contact (Optional)</Label>
                  <Select value={selectedContactId} onValueChange={handleSelectContact}>
                    <SelectTrigger>
                      <SelectValue placeholder="Search customers & leads..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allContacts.map(contact => (
                        <SelectItem key={contact.id} value={contact.id}>
                          {contact.displayName} ({contact.type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Link CrewCam Job (Optional)</Label>
                  <Select value={linkedInspectionJobId || '__none__'} onValueChange={(value) => {
                    const resolvedValue = value === '__none__' ? null : value;
                    setLinkedInspectionJobId(resolvedValue);
                    if (resolvedValue) {
                      const fetchPhotos = async () => {
                        const photos = await base44.entities.JobMedia.filter({ 
                          related_entity_id: value, 
                          related_entity_type: 'InspectionJob',
                          file_type: 'photo'
                        });
                        setMessages(prev => [...prev, {
                          role: 'assistant',
                          content: `🔗 **Linked to inspection job!**\n\n📸 ${photos.length} photos will be included in PDF exports.`,
                          timestamp: new Date().toISOString()
                        }]);
                      };
                      fetchPhotos();
                    }
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="None - No inspection photos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None - No inspection photos</SelectItem>
                      {allInspectionJobs.map(job => (
                        <SelectItem key={job.id} value={job.id}>
                          {job.property_address || job.client_name || `Job ${job.id.slice(0, 8)}`}
                          {job.status && ` (${job.status})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {linkedInspectionJobId && linkedJobMedia.length > 0 && (
                    <div className="mt-1 space-y-1">
                      <p className="text-xs text-green-600">
                        {linkedJobMedia.length} inspection photos linked
                      </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="button-import-damage"
                      onClick={() => {
                          const damageItems = [];
                          let totalHail = 0, totalWind = 0, totalMissing = 0;
                          linkedJobMedia.forEach(photo => {
                            totalHail += Number(photo.hail_count) || 0;
                            totalWind += Number(photo.wind_count) || 0;
                            totalMissing += Number(photo.missing_count) || 0;
                          });

                          if (totalHail > 0) damageItems.push({ desc: 'hail damage repair shingle', qty: totalHail, note: `${totalHail} hail impacts detected across ${linkedJobMedia.length} photos` });
                          if (totalWind > 0) damageItems.push({ desc: 'wind damage repair shingle', qty: totalWind, note: `${totalWind} wind damage areas detected` });
                          if (totalMissing > 0) damageItems.push({ desc: 'missing shingle replacement', qty: totalMissing, note: `${totalMissing} missing shingles detected` });

                          if (damageItems.length === 0) {
                            setMessages(prev => [...prev, {
                              role: 'assistant',
                              content: 'No damage data found in linked photos. Run AI analysis on photos in CrewCam first.',
                              timestamp: new Date().toISOString()
                            }]);
                            return;
                          }

                          saveToHistory();
                          const newItems = damageItems.map((d, i) => ({
                            line: lineItems.length + i + 1,
                            code: `DMG-${i + 1}`,
                            description: d.desc,
                            quantity: d.qty,
                            unit: 'EA',
                            rate: 0,
                            rcv: 0,
                            amount: 0,
                            category: 'DAMAGE REPAIR',
                            note: d.note
                          }));
                          setLineItems(prev => [...prev, ...newItems]);
                          setMessages(prev => [...prev, {
                            role: 'assistant',
                            content: `Imported ${damageItems.length} damage items from CrewCam:\n${damageItems.map(d => `- ${d.note}`).join('\n')}\n\nItems added with $0 pricing - search Xactimate codes to set proper rates.`,
                            timestamp: new Date().toISOString()
                          }]);
                        }}
                        className="text-xs w-full"
                      >
                        <Camera className="w-3 h-3 mr-1" />
                        Import Damage Items from Photos
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>{t.common.name}</Label>
                  <Input
                    value={customerInfo.customer_name}
                    onChange={(e) => setCustomerInfo({...customerInfo, customer_name: e.target.value})}
                    placeholder="John Smith"
                  />
                </div>
                <div>
                  <Label>{t.common.email}</Label>
                  <Input
                    type="email"
                    value={customerInfo.customer_email}
                    onChange={(e) => setCustomerInfo({...customerInfo, customer_email: e.target.value})}
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <Label>{t.common.phone}</Label>
                  <Input
                    value={customerInfo.customer_phone}
                    onChange={(e) => setCustomerInfo({...customerInfo, customer_phone: e.target.value})}
                    placeholder="(555) 123-4567"
                  />
                </div>
                <div>
                  <Label>{t.common.address}</Label>
                  <Input
                    value={customerInfo.property_address}
                    onChange={(e) => setCustomerInfo({...customerInfo, property_address: e.target.value})}
                    placeholder="123 Main St, City, ST 12345"
                  />
                </div>
                <div>
                  <Label>{t.inspections.claimNumber}</Label>
                  <Input
                    value={customerInfo.claim_number}
                    onChange={(e) => setCustomerInfo({...customerInfo, claim_number: e.target.value})}
                    placeholder="CLM-2024-001"
                  />
                </div>
                <div>
                  <Label>{t.inspections.insuranceCompany}</Label>
                  <Input
                    value={customerInfo.insurance_company}
                    onChange={(e) => setCustomerInfo({...customerInfo, insurance_company: e.target.value})}
                    placeholder="State Farm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <Label>{t.common.adjusterName || "Adjuster Name"}</Label>
                  <Input
                    value={customerInfo.adjuster_name}
                    onChange={(e) => setCustomerInfo({...customerInfo, adjuster_name: e.target.value})}
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <Label>{t.common.adjusterPhone || "Adjuster Phone"}</Label>
                  <Input
                    value={customerInfo.adjuster_phone}
                    onChange={(e) => setCustomerInfo({...customerInfo, adjuster_phone: e.target.value})}
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>

              <div className="mt-4">
                <Label>{t.common.notes}</Label>
                <Textarea
                  value={customerInfo.notes}
                  onChange={(e) => setCustomerInfo({...customerInfo, notes: e.target.value})}
                  placeholder="Additional project notes..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-lg">
            <CardHeader className={`${getHeaderColorClass(currentFormat)} text-white`}>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>{t.sidebar.estimates}</CardTitle>
                </div>
                <div className="flex gap-2 items-center">
                  <Badge className="bg-white/30 text-white text-xs">
                    {roofTypeSelection === 'shingles' ? `🏠 ${t.estimates.shingles}` : roofTypeSelection === 'metal' ? `🔩 ${t.estimates.metalRoof}` : `🏢 ${t.estimates.flatRoof}`}
                  </Badge>
                  <Badge className="bg-white/20 text-white">
                    {lineItems.length} {t.estimates.lineItems}
                  </Badge>
                  <Badge className="bg-white/20 text-white">
                    ${lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0).toLocaleString()}
                  </Badge>
                  <div className="flex items-center gap-1 bg-white/20 rounded-md p-0.5" title="PDF output language">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setEstimateOutputLanguage('en'); }}
                      className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${estimateOutputLanguage === 'en' ? 'bg-white text-blue-700' : 'text-white/80 hover:text-white'}`}
                      data-testid="button-estimate-lang-en"
                    >
                      EN
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setEstimateOutputLanguage('es'); }}
                      className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${estimateOutputLanguage === 'es' ? 'bg-white text-blue-700' : 'text-white/80 hover:text-white'}`}
                      data-testid="button-estimate-lang-es"
                    >
                      ES
                    </button>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <LineItemEditor
                items={lineItems}
                onChange={setLineItems}
                format={currentFormat}
              />

              {isInsuranceJob && lineItems.some(i => i.action || i.xactimate_code || i.remove_rate || i.replace_rate) && (() => {
                const catTotals = {};
                let lineItemTotal = 0, totalTax = 0, rcvTotal = 0;
                lineItems.forEach(item => {
                  const qty = parseFloat(item.quantity) || 0;
                  const removeRate = parseFloat(item.remove_rate) || 0;
                  const replaceRate = parseFloat(item.replace_rate) || (item.action === '-' ? 0 : parseFloat(item.rate) || 0);
                  const taxPct = parseFloat(item.tax_rate) || 0;
                  const removeLine = qty * removeRate;
                  const replaceLine = qty * replaceRate;
                  const taxLine = replaceLine * (taxPct / 100);
                  const totalLine = removeLine + replaceLine + taxLine;
                  lineItemTotal += removeLine + replaceLine;
                  totalTax += taxLine;
                  rcvTotal += totalLine;
                  const cat = (item.xactimate_code || '').split(' ')[0] || 'OTHER';
                  catTotals[cat] = (catTotals[cat] || 0) + totalLine;
                });
                const catLabels = { RFG: 'Roofing', DML: 'Demolition', GUT: 'Gutters', WTR: 'Waterproofing', STR: 'Structure', OTHER: 'Other' };
                return (
                  <div className="border-t border-orange-200 bg-orange-50/40 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Shield className="w-4 h-4 text-orange-600" />
                      <span className="text-sm font-semibold text-orange-800">Xactimate Format Preview (Insurance)</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-800 text-white">
                            <th className="px-2 py-2 text-left font-semibold">CODE</th>
                            <th className="px-2 py-2 text-center font-semibold">ACT</th>
                            <th className="px-2 py-2 text-left font-semibold">DESCRIPTION</th>
                            <th className="px-2 py-2 text-center font-semibold">QTY</th>
                            <th className="px-2 py-2 text-center font-semibold">UNIT</th>
                            <th className="px-2 py-2 text-right font-semibold">REMOVE RATE</th>
                            <th className="px-2 py-2 text-right font-semibold">REPLACE RATE</th>
                            <th className="px-2 py-2 text-right font-semibold">TAX</th>
                            <th className="px-2 py-2 text-right font-semibold">TOTAL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lineItems.map((item, idx) => {
                            const qty = parseFloat(item.quantity) || 0;
                            const removeRate = parseFloat(item.remove_rate) || 0;
                            const replaceRate = parseFloat(item.replace_rate) || (item.action === '-' ? 0 : parseFloat(item.rate) || 0);
                            const taxPct = parseFloat(item.tax_rate) || 0;
                            const removeLine = qty * removeRate;
                            const replaceLine = qty * replaceRate;
                            const taxLine = replaceLine * (taxPct / 100);
                            const totalLine = removeLine + replaceLine + taxLine;
                            const action = item.action || '+';
                            const actionColor = action === '-' ? 'text-red-600 border-red-500' : action === 'R&R' ? 'text-orange-600 border-orange-500' : 'text-green-600 border-green-500';
                            return (
                              <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{item.xactimate_code || item.code || ''}</td>
                                <td className="px-2 py-1.5 text-center">
                                  <span className={`inline-block px-1 py-0 text-xs font-bold border rounded ${actionColor}`}>{action}</span>
                                </td>
                                <td className="px-2 py-1.5">{item.description}</td>
                                <td className="px-2 py-1.5 text-center">{qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2)}</td>
                                <td className="px-2 py-1.5 text-center text-gray-500">{item.unit || 'EA'}</td>
                                <td className="px-2 py-1.5 text-right">{removeRate > 0 ? `$${removeRate.toFixed(2)}` : '—'}</td>
                                <td className="px-2 py-1.5 text-right">{replaceRate > 0 ? `$${replaceRate.toFixed(2)}` : '—'}</td>
                                <td className="px-2 py-1.5 text-right text-gray-500">{taxLine > 0 ? `$${taxLine.toFixed(2)}` : '—'}</td>
                                <td className="px-2 py-1.5 text-right font-semibold">${totalLine.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 border border-slate-200 rounded overflow-hidden max-w-xs">
                      <div className="bg-slate-700 text-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide">Summary for Dwelling</div>
                      <div className="divide-y divide-slate-100 text-xs">
                        <div className="flex justify-between px-3 py-1.5 bg-white">
                          <span className="text-gray-600">Line Item Total</span>
                          <span className="font-semibold">${lineItemTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between px-3 py-1.5 bg-gray-50">
                          <span className="text-gray-600">Total Tax</span>
                          <span className="font-semibold">${totalTax.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between px-3 py-2 bg-blue-900 text-white">
                          <span className="font-bold">RCV — Net Claim</span>
                          <span className="font-bold">${rcvTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                    {Object.keys(catTotals).length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-orange-800 mb-2">Recap by Category</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {Object.entries(catTotals).map(([cat, total]) => (
                            <div key={cat} className="bg-white border border-orange-200 rounded p-2 text-center">
                              <div className="text-xs text-gray-500">{catLabels[cat] || cat}</div>
                              <div className="text-sm font-bold text-gray-900">${total.toFixed(2)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="p-4 bg-gray-50 border-t flex items-center justify-between gap-3 sticky bottom-[80px] md:bottom-0 z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                {/* LEFT: Tools & Exports Dropdowns */}
                <div className="flex gap-2">
                  {/* TOOLS MENU */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="gap-2 bg-white" data-testid="button-tools">
                        {isGeneratingMaterials ? (
                          <Loader2 className="w-4 h-4 animate-spin text-green-600" />
                        ) : (
                          <Hammer className="w-4 h-4" />
                        )}
                        <span className="hidden sm:inline">{isGeneratingMaterials ? 'Generating...' : t.mobileNav.tools}</span>
                        {!isGeneratingMaterials && <ChevronDown className="w-3 h-3 opacity-50" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top" className="w-56">
                      <DropdownMenuLabel>{t.estimates.roofType}</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => {
                        setRoofTypeSelection('shingles');
                        if (currentEstimate) setTimeout(() => handleRegenerateWithGutters(), 100);
                      }}>
                        {roofTypeSelection === 'shingles' && <span className="mr-2">✓</span>}
                        🏠 {t.estimates.shingles}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        setRoofTypeSelection('metal');
                        if (currentEstimate) setTimeout(() => handleRegenerateWithGutters(), 100);
                      }}>
                        {roofTypeSelection === 'metal' && <span className="mr-2">✓</span>}
                        🔩 {t.estimates.metalRoof}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        setRoofTypeSelection('flat');
                        if (currentEstimate) setTimeout(() => handleRegenerateWithGutters(), 100);
                      }}>
                        {roofTypeSelection === 'flat' && <span className="mr-2">✓</span>}
                        🏢 {t.estimates.flatRoof}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>{t.estimates.smartTools}</DropdownMenuLabel>
                      <DropdownMenuItem onClick={handleReviewEstimate} disabled={isAnalyzing}>
                        <Sparkles className="w-4 h-4 mr-2 text-purple-600" />
                        {t.estimates.aiReview}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={checkMissingItems} data-testid="menu-check-missing">
                        <AlertTriangle className="w-4 h-4 mr-2 text-amber-500" />
                        {t.estimates.checkMissing}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowMemoryDialog(true)} data-testid="menu-manage-memory">
                        <Brain className="w-4 h-4 mr-2 text-purple-600" />
                        {t.ai.manageMemory} ({savedMissedItems.length})
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowVentilationCalc(true)}>
                        <Wind className="w-4 h-4 mr-2 text-blue-600" />
                        {t.estimates.ventilationCalculator}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleGenerateMaterialList} disabled={isGeneratingMaterials}>
                        <ClipboardList className="w-4 h-4 mr-2 text-green-600" />
                        {t.estimates.materialList}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowMergeDialog(true)}>
                        <Upload className="w-4 h-4 mr-2 text-blue-600" />
                        {t.estimates.mergeDocuments}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>{t.estimates.quickAdjustments}</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => processWithAI('add 10% waste')}>
                        <Package className="w-4 h-4 mr-2 text-orange-600" />
                        {t.estimates.addWaste}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => processWithAI('apply steep roof')}>
                        <TrendingUp className="w-4 h-4 mr-2 text-red-600" />
                        {t.estimates.applySteepCharge}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => processWithAI('apply high roof')}>
                        <ArrowUp className="w-4 h-4 mr-2 text-blue-600" />
                        {t.estimates.applyHighCharge}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => processWithAI('add 10% overhead and 10% profit')}>
                        <DollarSign className="w-4 h-4 mr-2 text-purple-600" />
                        {t.estimates.addProfit}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>{t.common.fieldOperations}</DropdownMenuLabel>
                      <DropdownMenuItem onClick={async () => {
                        try {
                          if (!user || !myCompany) {
                            alert('User or company information not available.');
                            return;
                          }
                          const newJob = await base44.entities.InspectionJob.create({
                            property_address: customerInfo.property_address || satelliteAddress?.address,
                            client_name: customerInfo.customer_name,
                            client_email: customerInfo.customer_email,
                            client_phone: customerInfo.customer_phone,
                            insurance_claim_number: customerInfo.claim_number,
                            status: 'in_progress',
                            assigned_to_email: user.email,
                            lead_source: 'ai_estimator',
                            company_id: myCompany?.id,
                            notes: `Inspection for estimate: ${currentEstimate?.title || 'AI Generated Estimate'}`,
                            inspection_type: 'Property Damage Assessment'
                          });
                          navigate(createPageUrl(`InspectionCapture?id=${newJob.id}`));
                        } catch (error) {
                          alert('Failed to create inspection: ' + error.message);
                        }
                      }}>
                        <Satellite className="w-4 h-4 mr-2" />
                        {t.estimates.startInspection}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* EXPORTS MENU */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="gap-2 bg-white">
                        <Share2 className="w-4 h-4" />
                        <span className="hidden sm:inline">{t.common.export}</span>
                        <ChevronDown className="w-3 h-3 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top" className="w-56">
                      <DropdownMenuLabel>{t.common.documents}</DropdownMenuLabel>
                      <DropdownMenuItem onClick={async () => {
                        try {
                          const isEsOutput = estimateOutputLanguage === 'es';
                          let descList = lineItems.map(i => i.description || '');
                          if (isEsOutput && descList.some(d => d.trim())) {
                            try {
                              const translateRes = await base44.functions.invoke('translateLineItems', { descriptions: descList });
                              if (Array.isArray(translateRes?.data?.translations) && translateRes.data.translations.length === descList.length) {
                                descList = translateRes.data.translations;
                              }
                            } catch (translateErr) {
                              console.warn('Translation failed, using original:', translateErr);
                            }
                          }
                          const companyAddr = [myCompany?.address, myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', ');
                          const formatIsInsurance = !!(
                            (currentFormat?.format_name || '').toLowerCase().match(/xactimate|state.?farm|allstate|farmers|liberty|travelers|nationwide|progressive/) ||
                            currentFormat?.insurance_company
                          );
                          const effectiveInsuranceJob = isInsuranceJob || formatIsInsurance ||
                            !!(customerInfo?.claim_number || customerInfo?.insurance_company);
                          const printHtml = generateEstimateHTML({
                            customerInfo,
                            lineItems,
                            descriptions: descList,
                            satelliteAnalysis,
                            satelliteAddress,
                            companyName: myCompany?.company_name || '',
                            companyLogoUrl: myCompany?.logo_url || '',
                            companyAddress: companyAddr,
                            companyPhone: myCompany?.phone || '',
                            estimateNumber: currentEstimate?.estimate_number || '',
                            lang: isEsOutput ? 'es' : 'en',
                            isInsuranceJob: effectiveInsuranceJob,
                          });
                          const win = window.open('', '_blank');
                          if (win) {
                            win.document.write(printHtml);
                            win.document.close();
                            setMessages(prev => [...prev, {
                              role: 'assistant', content: `✅ Estimate opened in new tab — click "Print / Save as PDF" to download.`, timestamp: new Date().toISOString()
                            }]);
                          } else {
                            alert('Pop-up blocked. Please allow pop-ups for this site and try again.');
                          }
                        } catch (error) { alert('Failed: ' + error.message); }
                      }}>
                        <Download className="w-4 h-4 mr-2" />
                        {t.estimates.downloadPDF}
                      </DropdownMenuItem>

                      <DropdownMenuItem onClick={async () => {
                        if (!linkedInspectionJobId) {
                          alert('Link an inspection job first.');
                          return;
                        }
                        try {
                          const response = await base44.functions.invoke('generateAdjusterReport', {
                            inspectionJobId: linkedInspectionJobId,
                            estimateId: null
                          });
                          const blob = new Blob([response.data], { type: 'application/pdf' });
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `adjuster-report.pdf`;
                          document.body.appendChild(a);
                          a.click();
                          window.URL.revokeObjectURL(url);
                          a.remove();
                        } catch (error) { alert('Failed: ' + error.message); }
                      }}>
                        <FileText className="w-4 h-4 mr-2" />
                        {t.accounting.reports}
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Send</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => setShowProductionDialog(true)} data-testid="menu-send-production">
                        <HardHat className="w-4 h-4 mr-2" />
                        Send to Production for Approval
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowAdjusterDialog(true)} data-testid="menu-send-adjuster">
                        <Shield className="w-4 h-4 mr-2" />
                        Send to Insurance Adjuster
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleExportToXactimate} disabled={isExporting}>
                        {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                        {t.estimates.exportXML}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* RIGHT: Primary Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!customerInfo.customer_email) {
                        alert('Enter customer email first');
                        return;
                      }
                      if (!window.confirm(`Send to ${customerInfo.customer_email}?`)) return;
                      try {
                        const totalRcv = lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
                        const totalAcv = lineItems.reduce((acc, i) => acc + (Number(i.acv) || 0), 0);
                        await base44.functions.invoke('sendEstimateEmail', {
                          to: customerInfo.customer_email,
                          customerName: customerInfo.customer_name,
                          estimateData: {
                            estimate_number: 'DRAFT',
                            estimate_title: currentEstimate?.title || 'Estimate',
                            line_items: lineItems,
                            total_rcv: totalRcv,
                            total_acv: totalAcv,
                            property_address: customerInfo.property_address,
                            notes: customerInfo.notes
                          },
                          format: currentFormat
                        });
                        alert(`✅ Sent!`);
                      } catch (error) { alert('Failed: ' + error.message); }
                    }}
                    disabled={!customerInfo.customer_email}
                    className="hidden sm:flex"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    {t.invoices.sendInvoice}
                  </Button>

                      <Button
                        variant="outline"
                        onClick={() => setShowMergeWithExistingDialog && setShowMergeWithExistingDialog(true)}
                        className="border-blue-500 text-blue-700 hover:bg-blue-50"
                        data-testid="button-merge-existing"
                      >
                        <Share2 className="w-4 h-4 mr-2" />
                        Merge into Existing
                      </Button>
                      <Button onClick={handleSaveEstimate} className="bg-green-600 hover:bg-green-700 text-white shadow-md">
                        <Save className="w-4 h-4 mr-2" />
                        Save as New
                      </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
