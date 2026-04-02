import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Layout, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function PageBuilder() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Page Builder</h1>
        <p className="text-gray-500 mt-1">Create custom pages for your website</p>
      </div>

      <Alert className="bg-purple-50 border-purple-200">
        <Sparkles className="w-4 h-4 text-purple-600" />
        <AlertDescription>
          <strong>Coming Soon!</strong> Build custom landing pages, customer portals, and more with our drag-and-drop page builder.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="p-12 text-center text-gray-500">
          <Layout className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold mb-2">Page Builder</h3>
          <p>Visual page builder coming soon</p>
        </CardContent>
      </Card>
    </div>
  );
}