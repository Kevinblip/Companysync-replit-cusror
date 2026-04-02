import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Users, Calendar, TrendingUp, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Payroll() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Payroll Management</h1>
          <p className="text-gray-500 mt-1">Manage employee payments and payroll</p>
        </div>
        <Button className="bg-green-600 hover:bg-green-700">
          <Download className="w-4 h-4 mr-2" />
          Run Payroll
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="p-6">
            <DollarSign className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">$0.00</h3>
            <p className="text-sm opacity-80">Total Payroll</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-6">
            <Users className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">0</h3>
            <p className="text-sm opacity-80">Employees Paid</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="p-6">
            <Calendar className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">0</h3>
            <p className="text-sm opacity-80">Pending Payments</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="p-6">
            <TrendingUp className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">$0.00</h3>
            <p className="text-sm opacity-80">Avg Salary</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payroll History</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-12 text-gray-500">
          No payroll records yet
        </CardContent>
      </Card>
    </div>
  );
}