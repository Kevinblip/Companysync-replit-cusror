import React from "react";
import { Card, CardContent } from "@/components/ui/card";

export default function ConversionMetric({ title, value, subtitle, trend }) {
  return (
    <Card className="bg-white border border-gray-200 shadow hover:shadow-md transition-all duration-300">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-600">{title}</h4>
          {trend && (
            <span className="text-xs text-green-600 font-medium">+{trend}</span>
          )}
        </div>
        <div className="text-2xl font-bold text-gray-900 mb-1">{value}</div>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </CardContent>
    </Card>
  );
}