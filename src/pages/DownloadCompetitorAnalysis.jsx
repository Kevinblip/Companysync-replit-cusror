import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FileDown, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function DownloadCompetitorAnalysis() {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const response = await base44.functions.invoke('generateCompetitorAnalysisPDF', {});
      
      // Create blob from response
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      
      // Download
      const a = document.createElement('a');
      a.href = url;
      a.download = `AI-Receptionist-Competitive-Analysis-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      window.URL.revokeObjectURL(url);
      a.remove();
      
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to generate PDF: ' + error.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 bg-gradient-to-br from-blue-50 to-purple-50 min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Competitor Analysis Report</h1>
        <p className="text-gray-600 mt-1">Download comprehensive PDF analysis</p>
      </div>

      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="w-6 h-6 text-blue-600" />
            AI Receptionist Competitive Analysis
          </CardTitle>
          <CardDescription>
            Detailed comparison of Jobber Receptionist, JobNimbus AssistAI, and our platform
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h3 className="font-semibold text-blue-900 mb-2">Report Includes:</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>✓ Executive summary with key statistics</li>
              <li>✓ Complete feature comparison across all platforms</li>
              <li>✓ Current capabilities and critical gaps</li>
              <li>✓ Prioritized enhancement roadmap (HIGH/MEDIUM/LOW)</li>
              <li>✓ 7 unique competitive advantages</li>
              <li>✓ 4-step winning strategy</li>
            </ul>
          </div>

          <Button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-lg h-12"
          >
            {downloading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <FileDown className="w-5 h-5 mr-2" />
                Download Competitor Analysis PDF
              </>
            )}
          </Button>

          <p className="text-xs text-gray-500 text-center">
            Multi-page PDF report • Printable format • Generated {new Date().toLocaleDateString()}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}