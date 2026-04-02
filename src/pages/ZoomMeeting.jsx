import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Video, Calendar, Users, ExternalLink } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ZoomMeeting() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Video className="w-8 h-8 text-blue-600" />
          Zoom Meetings
        </h1>
        <p className="text-gray-500 mt-1">Schedule and manage video meetings with customers</p>
      </div>

      <Alert className="bg-blue-50 border-blue-200">
        <AlertDescription>
          To use Zoom integration, go to <strong>Integration Manager</strong> and connect your Zoom account.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-6 text-center">
            <Video className="w-12 h-12 mx-auto mb-4 text-blue-600" />
            <h3 className="font-bold text-lg mb-2">Start Instant Meeting</h3>
            <p className="text-sm text-gray-600 mb-4">Launch a meeting right now</p>
            <Button className="w-full bg-blue-600 hover:bg-blue-700">
              <Video className="w-4 h-4 mr-2" />
              Start Meeting
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
          <CardContent className="p-6 text-center">
            <Calendar className="w-12 h-12 mx-auto mb-4 text-purple-600" />
            <h3 className="font-bold text-lg mb-2">Schedule Meeting</h3>
            <p className="text-sm text-gray-600 mb-4">Plan a meeting for later</p>
            <Button className="w-full bg-purple-600 hover:bg-purple-700">
              <Calendar className="w-4 h-4 mr-2" />
              Schedule
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <CardContent className="p-6 text-center">
            <Users className="w-12 h-12 mx-auto mb-4 text-green-600" />
            <h3 className="font-bold text-lg mb-2">Join Meeting</h3>
            <p className="text-sm text-gray-600 mb-4">Enter a meeting ID</p>
            <Button className="w-full bg-green-600 hover:bg-green-700">
              <ExternalLink className="w-4 h-4 mr-2" />
              Join
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white shadow-md">
        <CardContent className="p-12 text-center text-gray-500">
          <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold mb-2">No Upcoming Meetings</h3>
          <p>Your scheduled Zoom meetings will appear here</p>
        </CardContent>
      </Card>
    </div>
  );
}