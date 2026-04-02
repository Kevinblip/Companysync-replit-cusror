import React from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Wrench } from "lucide-react";

export default function RunRepairs() {
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const { data } = await base44.functions.invoke("runDataRepairs", {});
      setResult(data);
      alert(
        `Repairs Complete\n\n` +
          `Cleanup: ${data?.results?.cleanupAllOrphanedData ? "OK" : "Skipped"}\n` +
          `Fix Payments: ${data?.results?.fixPaymentCompanyIds ? "OK" : "Skipped"}\n` +
          `Link Estimates: ${data?.results?.linkAllEstimatesToCustomers ? "OK" : "Skipped"}\n` +
          `Backfill Commissions: ${data?.results?.backfillInvoiceCommissions ? "OK" : "Skipped"}\n\n` +
          `Lexi Test: ${data?.diagnostics?.lexi?.success ? "OK" : "Check Logs"}`
      );
    } catch (e) {
      alert("Failed to run repairs: " + e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Card className="border-blue-300 bg-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-blue-600" />
            One-Click Data Repair
          </CardTitle>
          <CardDescription>
            Fix hidden sales, link estimates, backfill commissions, and reattach payments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={handleRun} disabled={running} className="w-full bg-blue-600 hover:bg-blue-700">
            <RefreshCw className={`w-4 h-4 mr-2 ${running ? "animate-spin" : ""}`} />
            {running ? "Running Repairs..." : "Run Repairs Now"}
          </Button>
          {result && (
            <div className="text-xs text-gray-700 whitespace-pre-wrap bg-white border rounded p-3">
              {JSON.stringify(result, null, 2)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}