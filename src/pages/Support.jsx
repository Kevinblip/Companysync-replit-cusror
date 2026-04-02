import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Headphones, Plus, Clock, CheckCircle, AlertCircle } from "lucide-react";

export default function Support() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Support Tickets</h1>
          <p className="text-gray-500 mt-1">Manage customer support requests</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          New Ticket
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-yellow-50 to-orange-50 border-yellow-200">
          <CardContent className="p-6">
            <Clock className="w-8 h-8 text-yellow-600 mb-2" />
            <h3 className="text-2xl font-bold">0</h3>
            <p className="text-sm text-gray-600">Open</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-6">
            <AlertCircle className="w-8 h-8 text-blue-600 mb-2" />
            <h3 className="text-2xl font-bold">0</h3>
            <p className="text-sm text-gray-600">In Progress</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <CardContent className="p-6">
            <CheckCircle className="w-8 h-8 text-green-600 mb-2" />
            <h3 className="text-2xl font-bold">0</h3>
            <p className="text-sm text-gray-600">Resolved</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
          <CardContent className="p-6">
            <Headphones className="w-8 h-8 text-purple-600 mb-2" />
            <h3 className="text-2xl font-bold">0</h3>
            <p className="text-sm text-gray-600">Total</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Support Tickets</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-12 text-gray-500">
          <Headphones className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p>No support tickets yet</p>
        </CardContent>
      </Card>
    </div>
  );
}