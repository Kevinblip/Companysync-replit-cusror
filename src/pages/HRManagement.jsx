import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Calendar, FileText, Award, Clock, TrendingUp } from "lucide-react";

export default function HRManagement() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">HR Management</h1>
        <p className="text-gray-500 mt-1">Manage your team and HR operations</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-6">
            <Users className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">0</h3>
            <p className="text-sm opacity-80">Total Employees</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="p-6">
            <Clock className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">0</h3>
            <p className="text-sm opacity-80">On Duty Today</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="p-6">
            <Calendar className="w-8 h-8 mb-2" />
            <h3 className="text-2xl font-bold">0</h3>
            <p className="text-sm opacity-80">On Leave</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded cursor-pointer">
              <Users className="w-5 h-5 text-blue-600" />
              <span>Add New Employee</span>
            </div>
            <div className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded cursor-pointer">
              <Calendar className="w-5 h-5 text-green-600" />
              <span>Manage Leave Requests</span>
            </div>
            <div className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded cursor-pointer">
              <FileText className="w-5 h-5 text-purple-600" />
              <span>View Timesheets</span>
            </div>
            <div className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded cursor-pointer">
              <Award className="w-5 h-5 text-orange-600" />
              <span>Performance Reviews</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="text-center py-12 text-gray-500">
            No HR activity yet
          </CardContent>
        </Card>
      </div>
    </div>
  );
}