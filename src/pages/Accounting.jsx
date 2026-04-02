import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, PieChart } from "lucide-react";
import useTranslation from "@/hooks/useTranslation";

export default function Accounting() {
  const { t } = useTranslation();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.accounting.title} Overview</h1>
        <p className="text-gray-500 mt-1">Financial overview and {t.sidebar.accounting.toLowerCase()} management</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="p-6">
            <TrendingUp className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">$0.00</h3>
            <p className="text-sm opacity-80">Total Income</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white">
          <CardContent className="p-6">
            <TrendingDown className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">$0.00</h3>
            <p className="text-sm opacity-80">Total {t.accounting.expensesLabel}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-6">
            <DollarSign className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">$0.00</h3>
            <p className="text-sm opacity-80">Net {t.reports.profit}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="p-6">
            <PieChart className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">0%</h3>
            <p className="text-sm opacity-80">{t.reports.profit} Margin</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent {t.accounting.transactions}</CardTitle>
          </CardHeader>
          <CardContent className="text-center py-12 text-gray-500">
            {t.common.noResults}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.accounting.account} Summary</CardTitle>
          </CardHeader>
          <CardContent className="text-center py-12 text-gray-500">
            No {t.accounting.chartOfAccounts.toLowerCase()} configured
          </CardContent>
        </Card>
      </div>
    </div>
  );
}