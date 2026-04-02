import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, MapPin, Building2, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LeadFinder() {
  const [searching, setSearching] = useState(false);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Search className="w-8 h-8 text-blue-600" />
          Lead Finder
        </h1>
        <p className="text-gray-500 mt-1">Find potential customers in your area</p>
      </div>

      <Alert className="bg-purple-50 border-purple-200">
        <Sparkles className="w-4 h-4 text-purple-600" />
        <AlertDescription>
          <strong>AI-Powered Lead Discovery!</strong> Find homeowners with storm damage, old roofs, or insurance claims.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Search Criteria</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Location (City or ZIP Code)</Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input placeholder="Enter city or ZIP code" className="pl-10" />
            </div>
          </div>

          <div>
            <Label>Search Radius (miles)</Label>
            <Input type="number" defaultValue={10} />
          </div>

          <div>
            <Label>Property Type</Label>
            <select className="w-full border rounded-md p-2">
              <option>All Properties</option>
              <option>Residential</option>
              <option>Commercial</option>
            </select>
          </div>

          <Button className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
            <Search className="w-4 h-4 mr-2" />
            Find Leads
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search Results</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-12 text-gray-500">
          <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p>No results yet</p>
          <p className="text-sm mt-1">Enter search criteria to find potential leads</p>
        </CardContent>
      </Card>
    </div>
  );
}