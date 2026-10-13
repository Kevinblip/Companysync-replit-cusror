import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Palette } from "lucide-react";

export default function PDFSettings() {
  return (
    <main className="p-3 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">PDF Settings</h1>
        <p className="text-gray-600 mt-1">Configure the PDF branding options supported by your company.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>PDF branding</CardTitle>
          <CardDescription>
            Set your logo, colors, footer text, and default terms for standard estimates and invoices on the PDF Branding page.
            Font, header text, and logo position are omitted because active PDF renderers do not use those settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/PDFBranding">
              <Palette className="w-4 h-4 mr-2" />
              Open PDF Branding
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}