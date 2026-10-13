import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Download, Upload, CheckCircle2, AlertCircle, FileText, Loader2, Sparkles, Zap } from "lucide-react";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";

// ─── Direct regex parser for Xactimate / Symbility text exports ─────────────
//
// Tries multiple column formats in priority order so it catches the maximum
// number of items regardless of which Xactimate export style was used.
//
// FORMAT A  {#} {desc} {qty} ${price} {unit} ${total}   ← Xactimate default
//   e.g.:  11  Replace - Cant Strip  133.88  $7.75  LF  $1,037.57
//
// FORMAT B  {#} {desc} {qty} {unit} ${price} ${total}   ← unit before price
//   e.g.:  11  Replace - Cant Strip  133.88  LF  $7.75  $1,037.57
//
// FORMAT C  {#} {desc} {qty} {unit} ${price}            ← no separate total
//   e.g.:   5  Replace - Animal Screen  67  EA  $21.67
//
// NOTE: Real Symbility PDF exports use the same column layout as Xactimate
// (first$ = per-unit price, second$ = line total). The `format` param is kept
// for future format-specific tweaks but currently both modes parse identically.

// FORMAT A: two dollar amounts, price then unit then total
// \$\s* allows "$ 7.75" (dollar sign as separate PDF text fragment) as well as "$7.75"
const RE_A = /^(\d+)\s+(.+?)\s+([\d,]+\.?\d*)\s+\$\s*([\d,]+\.?\d*)\s+([\w\/]+)\s+\$\s*([\d,]+\.?\d*)\s*$/;

// FORMAT B: two dollar amounts, unit then price then total
const RE_B = /^(\d+)\s+(.+?)\s+([\d,]+\.?\d*)\s+([\w\/]+)\s+\$\s*([\d,]+\.?\d*)\s+\$\s*([\d,]+\.?\d*)\s*$/;

// FORMAT C: one dollar amount — strict known-unit list to prevent false positives
const UNITS_PAT = 'EA|SQ|LF|SF|SY|SQFT|FT|GAL|LB|BOX|CS|PAIR|SET|ROLL|SHEET|KIT|EACH|FOOT|SQUARE|YARD|GALLON|POUND|CARTON|CASE|BUNDLE|HR|MO|DAY|LS|LOT|MSQ';
const RE_C = new RegExp(
  `^(\\d+)\\s+(.+?)\\s+([\\d,]+\\.?\\d*)\\s+(${UNITS_PAT})\\s+\\$\\s*([\\d,]+\\.?\\d*)\\s*$`,
  'i'
);

function parseNumeric(s) {
  return parseFloat((s || '').replace(/,/g, '')) || 0;
}

function parseEstimateTxt(text, _format = 'xactimate') {
  const lines = text.split(/\r?\n/);
  const items = [];
  let currentSection = '';
  let attempted = 0;
  const misses = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Skip continuation/note lines like "Includes 5% waste on quantity."
    if (/^Includes\b/i.test(line)) continue;

    // Detect section headers like "ROOFPLAN: Roofplan" or "EXTERIOR:"
    if (/^[A-Z][A-Z\s]+:/.test(line) && !RE_A.test(line)) {
      currentSection = line.replace(/:.*$/, '').trim();
      continue;
    }

    // Only attempt lines that start with a number (likely line items)
    if (!/^\d/.test(line)) continue;
    attempted++;

    let parsed = null;

    // ── Try FORMAT A ───────────────────────────────────────────────────────
    const mA = RE_A.exec(line);
    if (mA) {
      const [, lineNum, description, qtyRaw, firstAmt, unit, secondAmt] = mA;
      parsed = {
        line: parseInt(lineNum, 10),
        description: description.trim(),
        quantity: parseNumeric(qtyRaw),
        unit: unit.toUpperCase(),
        unit_price: parseNumeric(firstAmt),
        total: parseNumeric(secondAmt),
      };
    }

    // ── Try FORMAT B ───────────────────────────────────────────────────────
    if (!parsed) {
      const mB = RE_B.exec(line);
      if (mB) {
        const [, lineNum, description, qtyRaw, unit, priceRaw, totalRaw] = mB;
        parsed = {
          line: parseInt(lineNum, 10),
          description: description.trim(),
          quantity: parseNumeric(qtyRaw),
          unit: unit.toUpperCase(),
          unit_price: parseNumeric(priceRaw),
          total: parseNumeric(totalRaw),
        };
      }
    }

    // ── Try FORMAT C — one dollar amount ──────────────────────────────────
    if (!parsed) {
      const mC = RE_C.exec(line);
      if (mC) {
        const [, lineNum, description, qtyRaw, unit, amountRaw] = mC;
        const quantity = parseNumeric(qtyRaw);
        const amount   = parseNumeric(amountRaw);
        parsed = {
          line: parseInt(lineNum, 10),
          description: description.trim(),
          quantity,
          unit: unit.toUpperCase(),
          unit_price: amount,
          total: +(quantity * amount).toFixed(2),
        };
      }
    }

    if (!parsed) {
      if (misses.length < 10) misses.push(line);
      continue;
    }
    parsed.section = currentSection || 'General';
    items.push(parsed);
  }

  console.log(`[EstimateImporter] Parser: ${attempted} numeric lines attempted, ${items.length} matched, ${attempted - items.length} missed`);
  if (misses.length) console.log('[EstimateImporter] Sample misses:\n', misses.join('\n'));

  return items;
}

// Extract plain text from a PDF File using pdfjs-dist (browser).
// Groups text items by Y coordinate so each visual row becomes one string,
// then normalises "$ 7.75" → "$7.75" (dollar sign is often a separate PDF fragment).
async function extractPdfText(file) {
  // Dynamic import keeps pdfjs out of the main module initialisation path
  const pdfjsLib = await import('pdfjs-dist');
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }
  const buffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts = [];

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent({ includeMarkedContent: false });

    // Group by Y (round to nearest integer for tolerance)
    const rows = new Map();
    for (const it of content.items) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, s: it.str });
    }

    // Emit lines top-to-bottom
    const yKeys = [...rows.keys()].sort((a, b) => b - a);
    for (const y of yKeys) {
      const parts = rows.get(y).sort((a, b) => a.x - b.x).map(p => p.s);
      let line = parts.join(' ').replace(/\s+/g, ' ').trim();
      // Merge "$ 1,234.56" → "$1,234.56" (dollar sign stored as separate fragment)
      line = line.replace(/\$\s+(\d)/g, '$$$1');
      if (line) pageTexts.push(line);
    }
  }

  const fullText = pageTexts.join('\n');
  // Log a sample so we can verify the extraction in the browser console
  const sample = pageTexts.slice(0, 30).join('\n');
  console.log('[EstimateImporter] PDF extracted', pageTexts.length, 'lines. First 30:\n', sample);
  return fullText;
}

// Keep old name as alias so nothing else breaks
const parseXactimateTxt = (text) => parseEstimateTxt(text, 'xactimate');

// ─── Extract header info from text ─────────────────────────────────────────
function extractHeaderInfo(text) {
  const claimMatch  = text.match(/Claim\s+([\w-]+)/i);
  const insuredMatch = text.match(/INSURED[\s\S]{0,200}?\n([^\n]{3,80})\n/i) ||
                       text.match(/Raffy\s+\w+[^\n]*/i);
  return {
    claim_number:    claimMatch?.[1]  || '',
    customer_name:   insuredMatch?.[1]?.trim() || '',
  };
}

export default function EstimateImporter() {
  const [file, setFile] = useState(null);
  const [textFormat, setTextFormat] = useState('xactimate');
  const [extracting, setExtracting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [result, setResult] = useState(null);
  const fileInputRef = React.useRef(null);
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me(),
  });

  const { myCompany } = useRoleBasedData();

  const isTxtFile = file && (
    file.name.toLowerCase().endsWith('.txt') ||
    file.type === 'text/plain' ||
    file.type === ''
  );

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setExtractedData(null);
      setResult(null);
    }
  };

  const isPdfFile = file && (
    file.name.toLowerCase().endsWith('.pdf') ||
    file.type === 'application/pdf'
  );

  // ── Text-file / PDF direct parser (no AI, no token limits) ─────────────
  const extractFromText = async () => {
    setExtracting(true);

    try {
      let text;
      if (isPdfFile) {
        setResult({ type: 'info', message: 'Extracting text from PDF...' });
        text = await extractPdfText(file);
      } else {
        setResult({ type: 'info', message: 'Reading and parsing file...' });
        text = await file.text();
      }
      const line_items = parseEstimateTxt(text, textFormat);

      if (line_items.length === 0) {
        setResult({ type: 'error', message: 'No line items found. Make sure the correct text format is selected (Xactimate vs Symbility) and that this is a supported text export.' });
        setExtracting(false);
        return;
      }

      const header = extractHeaderInfo(text);
      const total  = line_items.reduce((s, i) => s + i.total, 0);

      setExtractedData({ line_items, ...header, total_from_report: total, source: 'text_parse' });
      setResult({
        type: 'success',
        message: `Parsed ${line_items.length.toLocaleString()} line items — $${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total`,
      });
    } catch (err) {
      console.error('Text parse error:', err);
      setResult({ type: 'error', message: `Parse failed: ${err.message}` });
    }

    setExtracting(false);
  };

  // ── AI PDF extractor (original path) ───────────────────────────────────
  const extractEstimate = async () => {
    if (!file || !myCompany) {
      alert('Please select a file and ensure company is set up');
      return;
    }

    // Route text files AND PDFs to the direct regex parser (bypasses AI token limits)
    if (isTxtFile || isPdfFile) {
      await extractFromText();
      return;
    }

    setExtracting(true);
    setResult(null);

    try {
      setResult({ type: 'info', message: 'Uploading PDF...' });
      const uploadResult = await base44.integrations.Core.UploadFile({ file });
      const fileUrl = uploadResult.file_url;

      setResult({ type: 'info', message: 'AI is reading your estimate... (30-60 seconds)' });
      
      const extractResult = await base44.functions.invoke('extractEstimateWithClaude', {
        fileUrl: fileUrl,
        description: 'Extract all line items from this estimate PDF',
        pricingSource: 'custom'
      });

      console.log('Extract result:', extractResult);

      if (extractResult.data.success && extractResult.data.line_items?.length > 0) {
        setExtractedData(extractResult.data);
        setResult({ 
          type: 'success', 
          message: `Extracted ${extractResult.data.line_items.length} line items! Total: $${extractResult.data.line_items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0).toFixed(2)}` 
        });
      } else {
        setResult({ 
          type: 'error', 
          message: 'Could not extract line items. Please check if the PDF is readable.' 
        });
      }
    } catch (error) {
      console.error('Extraction error:', error);
      setResult({ 
        type: 'error', 
        message: `Error: ${error.message || 'Unknown error occurred'}` 
      });
    }

    setExtracting(false);
  };

  const importToDatabase = async () => {
    if (!extractedData || !myCompany) return;

    setImporting(true);
    setResult({ type: 'info', message: 'Saving to database...' });

    try {
      const { line_items, customer_name, claim_number } = extractedData;
      
      const items = line_items.map(item => ({
        code:        item.code || '',
        description: item.description,
        quantity:    parseFloat(item.quantity) || 0,
        unit:        item.unit || 'EA',
        rate:        parseFloat(item.unit_price || item.rate) || 0,
        amount:      parseFloat(item.total || item.amount || ((item.quantity || 0) * (item.unit_price || item.rate || 0))) || 0,
      }));

      const subtotal = items.reduce((s, i) => s + (i.amount || 0), 0);

      const estimate = {
        estimate_number: 'EST-' + Date.now(),
        customer_name:   customer_name || 'Imported Estimate',
        claim_number:    claim_number  || '',
        status:          'draft',
        notes:           `Imported from ${file?.name || 'file'} — ${items.length.toLocaleString()} line items`,
        items,
        amount:    subtotal,
        total_tax: 0,
        company_id: myCompany.id,
      };

      await base44.entities.Estimate.create(estimate);
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      
      setResult({ 
        type: 'success', 
        message: `Imported ${items.length.toLocaleString()} line items successfully!` 
      });

      setTimeout(() => {
        setFile(null);
        setExtractedData(null);
        setResult(null);
      }, 3000);

    } catch (error) {
      console.error('Import error:', error);
      setResult({ 
        type: 'error', 
        message: `Import failed: ${error.message}` 
      });
    }

    setImporting(false);
  };

  const downloadCSV = () => {
    if (!extractedData) return;

    const csvRows = ['#,Description,Section,Quantity,Unit,Unit Price,Total'];
    
    extractedData.line_items.forEach((item, idx) => {
      const description = (item.description || '').replace(/"/g, '""');
      const section     = (item.section     || '').replace(/"/g, '""');
      csvRows.push(
        `${item.line || idx + 1},"${description}","${section}",${item.quantity},"${item.unit}",${item.unit_price || item.rate || 0},${item.total || item.amount || 0}`
      );
    });

    const csv  = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'extracted_estimate.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Estimate Importer</h1>
        <p className="text-gray-500 mt-1">Upload Xactimate text exports or PDF estimates to import all line items.</p>
      </div>

      <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-blue-600" />
            Import Line Items
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-white border-blue-300">
            <AlertDescription>
              <strong>Supported formats:</strong>
              <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                <li><span className="font-medium">Xactimate text (.txt)</span> — select "Xactimate" format, parsed instantly with no item limit</li>
                <li><span className="font-medium">Symbility text (.txt)</span> — select "Symbility" format before parsing (column order differs from Xactimate)</li>
                <li><span className="font-medium">PDF estimates</span> — AI extraction (best for shorter, custom estimates)</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="bg-white rounded-lg p-6 border-2 border-dashed border-blue-300 hover:border-blue-500 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept=".pdf,.txt,.text"
              className="hidden"
            />
            
            {!file ? (
              <div className="text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-12 h-12 mx-auto mb-3 text-blue-500" />
                <p className="font-medium text-gray-700">Click to upload your estimate file</p>
                <p className="text-sm text-gray-500 mt-1">PDF or text (.txt) — Xactimate exports supported</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-3 p-4 bg-blue-50 rounded-lg">
                  <FileText className="w-8 h-8 text-blue-600" />
                  <div className="text-left">
                    <p className="font-medium text-gray-900">{file.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-sm text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      {(isTxtFile || isPdfFile) && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                          <Zap className="w-3 h-3" /> Direct parse — no AI limit
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                
                {(isTxtFile || isPdfFile) && (
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border">
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Format:</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        data-testid="format-xactimate"
                        onClick={() => setTextFormat('xactimate')}
                        className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                          textFormat === 'xactimate'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                        }`}
                      >
                        Xactimate
                      </button>
                      <button
                        type="button"
                        data-testid="format-symbility"
                        onClick={() => setTextFormat('symbility')}
                        className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                          textFormat === 'symbility'
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-orange-400'
                        }`}
                      >
                        Symbility
                      </button>
                    </div>
                    <span className="text-xs text-gray-400 hidden sm:block">
                      Both Xactimate and Symbility exports use the same column layout: dollar amount is the per-unit price.
                    </span>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button
                    onClick={extractEstimate}
                    disabled={extracting}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600"
                    size="lg"
                    data-testid="button-extract"
                  >
                    {extracting ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        {(isTxtFile || isPdfFile) ? 'Parsing...' : 'AI is Extracting...'}
                      </>
                    ) : (
                      <>
                        {(isTxtFile || isPdfFile) ? <Zap className="w-5 h-5 mr-2" /> : <Sparkles className="w-5 h-5 mr-2" />}
                        {(isTxtFile || isPdfFile) ? 'Parse File' : 'Extract with AI'}
                      </>
                    )}
                  </Button>
                  
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFile(null);
                      setExtractedData(null);
                      setResult(null);
                    }}
                    data-testid="button-remove-file"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            )}
          </div>

          {result && (
            <Alert className={
              result.type === 'success' ? 'bg-green-50 border-green-200' :
              result.type === 'error'   ? 'bg-red-50 border-red-200'   :
              'bg-blue-50 border-blue-200'
            }>
              <AlertDescription className="flex items-center gap-2">
                {result.type === 'success' && <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />}
                {result.type === 'error'   && <AlertCircle  className="w-4 h-4 text-red-600 shrink-0" />}
                {result.message}
              </AlertDescription>
            </Alert>
          )}

          {extractedData && extractedData.line_items?.length > 0 && (
            <div className="bg-white rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">Extracted Data Preview</h3>
                  <p className="text-sm text-gray-500">{extractedData.line_items.length.toLocaleString()} line items</p>
                </div>
                <Button variant="outline" size="sm" onClick={downloadCSV} data-testid="button-download-csv">
                  <Download className="w-4 h-4 mr-2" />
                  Download CSV
                </Button>
              </div>

              <div className="overflow-x-auto max-h-96 border rounded">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="p-2 text-left border-b">#</th>
                      <th className="p-2 text-left border-b">Description</th>
                      <th className="p-2 text-center border-b">Qty</th>
                      <th className="p-2 text-center border-b">Unit</th>
                      <th className="p-2 text-right border-b">Unit Price</th>
                      <th className="p-2 text-right border-b">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extractedData.line_items.slice(0, 500).map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="p-2 border-b text-gray-400">{item.line || idx + 1}</td>
                        <td className="p-2 border-b">{item.description}</td>
                        <td className="p-2 text-center border-b">{Number(item.quantity).toLocaleString()}</td>
                        <td className="p-2 text-center border-b">{item.unit}</td>
                        <td className="p-2 text-right border-b">${parseFloat(item.unit_price || item.rate || 0).toFixed(2)}</td>
                        <td className="p-2 text-right border-b font-semibold">
                          ${parseFloat(item.total || item.amount || ((item.quantity || 0) * (item.unit_price || item.rate || 0))).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                    {extractedData.line_items.length > 500 && (
                      <tr className="bg-yellow-50">
                        <td colSpan="6" className="p-2 text-center text-sm text-yellow-700">
                          Showing first 500 of {extractedData.line_items.length.toLocaleString()} items — all will be imported
                        </td>
                      </tr>
                    )}
                    <tr className="bg-blue-50 font-bold">
                      <td colSpan="5" className="p-2 text-right border-t-2">TOTAL:</td>
                      <td className="p-2 text-right border-t-2">
                        ${extractedData.line_items.reduce((sum, item) =>
                          sum + parseFloat(item.total || item.amount || ((item.quantity || 0) * (item.unit_price || item.rate || 0))), 0
                        ).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <Button
                onClick={importToDatabase}
                disabled={importing}
                className="w-full bg-green-600 hover:bg-green-700"
                size="lg"
                data-testid="button-import"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Importing to Database...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    Import {extractedData.line_items.length.toLocaleString()} Line Items to Database
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
