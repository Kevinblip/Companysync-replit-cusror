import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Download, Upload, CheckCircle2, AlertCircle, FileText, Loader2, Sparkles } from "lucide-react";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";

export default function EstimateImporter() {
  const [file, setFile] = useState(null);
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

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setExtractedData(null);
      setResult(null);
    }
  };

  const extractEstimate = async () => {
    if (!file || !myCompany) {
      alert('Please select a file and ensure company is set up');
      return;
    }

    setExtracting(true);
    setResult(null);

    try {
      // Step 1: Upload file
      setResult({ type: 'info', message: '📤 Uploading PDF...' });
      const uploadResult = await base44.integrations.Core.UploadFile({ file });
      const fileUrl = uploadResult.file_url;

      // Step 2: Extract with Claude
      setResult({ type: 'info', message: '🤖 AI is reading your estimate... (30-60 seconds)' });
      
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
          message: `✅ Extracted ${extractResult.data.line_items.length} line items! Total: $${extractResult.data.line_items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0).toFixed(2)}` 
        });
      } else {
        setResult({ 
          type: 'error', 
          message: '❌ Could not extract line items. Please check if the PDF is readable.' 
        });
      }
    } catch (error) {
      console.error('Extraction error:', error);
      setResult({ 
        type: 'error', 
        message: `❌ Error: ${error.message || 'Unknown error occurred'}` 
      });
    }

    setExtracting(false);
  };

  const importToDatabase = async () => {
    if (!extractedData || !myCompany) return;

    setImporting(true);
    setResult({ type: 'info', message: '💾 Saving to database...' });

    try {
      const { line_items, report_type, total_from_report, message } = extractedData;
      
      // Group line items into estimates
      const estimatesMap = new Map();
      
      for (const item of line_items) {
        const estimateNum = item.estimate_number || 'EST-' + Date.now();
        
        if (!estimatesMap.has(estimateNum)) {
          estimatesMap.set(estimateNum, {
            estimate_number: estimateNum,
            customer_name: item.customer_name || 'Unknown Customer',
            status: item.status || 'draft',
            valid_until: item.valid_until || null,
            insurance_company: item.insurance_company || '',
            adjuster_name: item.adjuster_name || '',
            adjuster_phone: item.adjuster_phone || '',
            claim_number: item.claim_number || '',
            notes: `Imported from PDF via AI extraction. ${message || ''}`,
            items: [],
            company_id: myCompany.id
          });
        }

        const estimate = estimatesMap.get(estimateNum);
        const qty = parseFloat(item.quantity) || 0;
        const rate = parseFloat(item.unit_price) || 0;
        
        estimate.items.push({
          code: item.code || '',
          description: item.description,
          quantity: qty,
          unit: item.unit || 'EA',
          rate: rate,
          amount: qty * rate
        });
      }

      // Save estimates to database
      let imported = 0;
      for (const estimate of estimatesMap.values()) {
        const subtotal = estimate.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        estimate.amount = subtotal;
        estimate.total_tax = 0;

        await base44.entities.Estimate.create(estimate);
        imported++;
      }

      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      
      setResult({ 
        type: 'success', 
        message: `🎉 SUCCESS! Imported ${imported} estimate(s) with ${line_items.length} total line items!` 
      });

      // Reset after 3 seconds
      setTimeout(() => {
        setFile(null);
        setExtractedData(null);
        setResult(null);
      }, 3000);

    } catch (error) {
      console.error('Import error:', error);
      setResult({ 
        type: 'error', 
        message: `❌ Import failed: ${error.message}` 
      });
    }

    setImporting(false);
  };

  const downloadCSV = () => {
    if (!extractedData) return;

    const csvRows = ['Estimate #,Customer Name,Status,Expiry Date,Line #,Description,Quantity,Unit,Unit Price,Tax Rate %'];
    
    extractedData.line_items.forEach((item, idx) => {
      const estimateNum = item.estimate_number || 'EST-' + Date.now();
      const customerName = item.customer_name || 'Unknown Customer';
      const status = item.status || 'draft';
      const expiryDate = item.valid_until || '';
      const lineNum = idx + 1;
      const description = (item.description || '').replace(/"/g, '""');
      const qty = item.quantity || 0;
      const unit = item.unit || 'EA';
      const price = item.unit_price || 0;
      
      csvRows.push(
        `"${estimateNum}","${customerName}","${status}","${expiryDate}",${lineNum},"${description}",${qty},"${unit}",${price},0`
      );
    });

    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extracted_estimate.csv';
    a.click();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">AI Estimate Importer</h1>
        <p className="text-gray-500 mt-1">Upload estimate PDFs and let AI extract all line items automatically!</p>
      </div>

      <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-blue-600" />
            AI-Powered PDF Extraction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-white border-blue-300">
            <AlertDescription>
              <strong>🎯 How it works:</strong>
              <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
                <li>Upload your estimate PDF (like the Estimate-1600 you showed me)</li>
                <li>AI reads and extracts ALL line items automatically</li>
                <li>Review the extracted data</li>
                <li>Click "Import to Database" - Done! 🎉</li>
              </ol>
            </AlertDescription>
          </Alert>

          <div className="bg-white rounded-lg p-6 border-2 border-dashed border-blue-300 hover:border-blue-500 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept=".pdf"
              className="hidden"
            />
            
            {!file ? (
              <div className="text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-12 h-12 mx-auto mb-3 text-blue-500" />
                <p className="font-medium text-gray-700">Click to upload PDF estimate</p>
                <p className="text-sm text-gray-500 mt-1">Supports any estimate format</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-3 p-4 bg-blue-50 rounded-lg">
                  <FileText className="w-8 h-8 text-blue-600" />
                  <div className="text-left">
                    <p className="font-medium text-gray-900">{file.name}</p>
                    <p className="text-sm text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <Button
                    onClick={extractEstimate}
                    disabled={extracting}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600"
                    size="lg"
                  >
                    {extracting ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        AI is Extracting...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5 mr-2" />
                        Extract with AI
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
              result.type === 'error' ? 'bg-red-50 border-red-200' :
              'bg-blue-50 border-blue-200'
            }>
              <AlertDescription className="flex items-center gap-2">
                {result.type === 'success' && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                {result.type === 'error' && <AlertCircle className="w-4 h-4 text-red-600" />}
                {result.message}
              </AlertDescription>
            </Alert>
          )}

          {extractedData && extractedData.line_items?.length > 0 && (
            <div className="bg-white rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">Extracted Data Preview</h3>
                <Button variant="outline" size="sm" onClick={downloadCSV}>
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
                    {extractedData.line_items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="p-2 border-b">{idx + 1}</td>
                        <td className="p-2 border-b">{item.description}</td>
                        <td className="p-2 text-center border-b">{item.quantity}</td>
                        <td className="p-2 text-center border-b">{item.unit}</td>
                        <td className="p-2 text-right border-b">${parseFloat(item.unit_price || 0).toFixed(2)}</td>
                        <td className="p-2 text-right border-b font-semibold">
                          ${Number((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-blue-50 font-bold">
                      <td colSpan="5" className="p-2 text-right border-t-2">TOTAL:</td>
                      <td className="p-2 text-right border-t-2">
                        ${extractedData.line_items.reduce((sum, item) => 
                          sum + ((item.quantity || 0) * (item.unit_price || 0)), 0
                        ).toFixed(2)}
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
              >
                {importing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Importing to Database...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    Import {extractedData.line_items.length} Line Items to Database
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