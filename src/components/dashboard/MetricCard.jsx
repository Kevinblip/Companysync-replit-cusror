import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

export default function MetricCard({ title, value, subtitle, icon: Icon, color, trend }) {
  return (
    <Card className={`${color} border-0 shadow-lg hover:shadow-xl transition-all duration-300`}>
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className="text-sm font-medium text-white/80 mb-1">{title}</p>
            <h3 className="text-3xl font-bold text-white">{value}</h3>
          </div>
          <div className="p-3 bg-white/20 rounded-lg">
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/70">{subtitle}</p>
          {trend && (
            <div className="flex items-center gap-1 text-white/90">
              {trend > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span className="text-xs font-medium">{Math.abs(trend)}%</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}