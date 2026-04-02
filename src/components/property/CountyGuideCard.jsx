import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  ExternalLink, 
  MapPin, 
  ChevronRight,
  FileSpreadsheet,
  CheckCircle2
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const countyGuides = [
  {
    name: "Cuyahoga County",
    city: "Cleveland",
    state: "OH",
    url: "https://myplace.cuyahogacounty.us/",
    difficulty: "Easy",
    avgProperties: "500-2,000 per zip",
    steps: [
      "Visit myplace.cuyahogacounty.us",
      "Click 'Property Search' in the menu",
      "Select 'Address' search option",
      "Enter zip code (e.g., 44102, 44103, 44105)",
      "Click the search button (magnifying glass)",
      "Results will appear - could be 500-2,000 properties",
      "Click 'Download Addresses (CSV)' button",
      "Save the file and upload it here!"
    ],
    tips: [
      "Search multiple zip codes separately for better targeting",
      "Filter by 'Owner Occupancy: No' to find rental properties",
      "Older properties (pre-2000) more likely need roof work"
    ],
    popularZips: ["44102", "44103", "44105", "44106", "44108"]
  },
  {
    name: "Richland County",
    city: "Mansfield",
    state: "OH",
    url: "https://richlandcountyoh.us/auditor/",
    difficulty: "Easy",
    avgProperties: "300-800 per zip",
    steps: [
      "Go to richlandcountyoh.us/auditor",
      "Click 'Property Search'",
      "Use 'Advanced Search' option",
      "Filter by zip code (e.g., 44903, 44906)",
      "Click 'Search'",
      "Click 'Export to CSV' or 'Download'",
      "Open file and upload here"
    ],
    tips: [
      "Mansfield gets frequent hail storms - great for roofing leads",
      "Focus on 44903, 44906, 44907 for highest density"
    ],
    popularZips: ["44903", "44906", "44907"]
  },
  {
    name: "Summit County",
    city: "Akron",
    state: "OH",
    url: "https://fiscaloffice.summitoh.net/",
    difficulty: "Medium",
    avgProperties: "800-1,500 per zip",
    steps: [
      "Visit fiscaloffice.summitoh.net",
      "Go to 'Property Search'",
      "Click 'Advanced Search'",
      "Enter zip code or select area",
      "Apply filters (optional: property type, year built)",
      "Click 'Export to Excel' or CSV option",
      "Download and upload here"
    ],
    tips: [
      "Large county - use zip codes to narrow down",
      "Commercial properties available too"
    ],
    popularZips: ["44301", "44303", "44304", "44305"]
  },
  {
    name: "Franklin County",
    city: "Columbus",
    state: "OH",
    url: "https://propertymax.franklincountyauditor.com/",
    difficulty: "Medium",
    avgProperties: "1,000-3,000 per zip",
    steps: [
      "Go to propertymax.franklincountyauditor.com",
      "Use 'Quick Search' → 'Advanced Options'",
      "Select zip codes (e.g., 43085, 43201)",
      "Set property type filters if needed",
      "Click 'Search'",
      "Look for 'Download' or 'Export' button",
      "Save CSV and upload here"
    ],
    tips: [
      "Very large county - narrow by specific neighborhoods",
      "High-value properties in 43017, 43085, 43016"
    ],
    popularZips: ["43085", "43201", "43214", "43229"]
  }
];

export default function CountyGuideCard() {
  const [expandedCounty, setExpandedCounty] = useState(null);

  return (
    <Card className="bg-white shadow-lg">
      <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-purple-50">
        <CardTitle className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-blue-600" />
          County-by-County Property Data Guides
        </CardTitle>
        <p className="text-sm text-gray-600 mt-1">
          Step-by-step instructions for Ohio's major counties
        </p>
      </CardHeader>
      <CardContent className="p-6 space-y-3">
        {countyGuides.map((county, index) => (
          <Collapsible
            key={index}
            open={expandedCounty === county.name}
            onOpenChange={() => setExpandedCounty(expandedCounty === county.name ? null : county.name)}
          >
            <div className="border rounded-lg overflow-hidden hover:shadow-md transition-shadow">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-bold text-lg">{county.name}</h3>
                      <Badge variant={county.difficulty === "Easy" ? "default" : "secondary"}>
                        {county.difficulty}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {county.city}, {county.state} • {county.avgProperties}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(county.url, '_blank');
                      }}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Visit
                    </Button>
                    <ChevronRight 
                      className={`w-5 h-5 transition-transform ${
                        expandedCounty === county.name ? 'rotate-90' : ''
                      }`}
                    />
                  </div>
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="border-t bg-gray-50 p-4 space-y-4">
                  {/* Steps */}
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4" />
                      Step-by-Step Instructions
                    </h4>
                    <ol className="space-y-2">
                      {county.steps.map((step, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm">
                          <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">
                            {i + 1}
                          </div>
                          <span className="pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Tips */}
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <h4 className="font-semibold mb-2 text-sm text-green-900">
                      💡 Pro Tips
                    </h4>
                    <ul className="space-y-1">
                      {county.tips.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-green-800">
                          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Popular Zip Codes */}
                  <div>
                    <h4 className="font-semibold mb-2 text-sm">Popular Zip Codes</h4>
                    <div className="flex flex-wrap gap-2">
                      {county.popularZips.map((zip) => (
                        <Badge key={zip} variant="outline" className="font-mono">
                          {zip}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Action Button */}
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    onClick={() => window.open(county.url, '_blank')}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Go to {county.name} Website
                  </Button>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </CardContent>
    </Card>
  );
}