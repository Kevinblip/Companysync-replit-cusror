import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Video, Calendar, Users, ExternalLink, Link as LinkIcon, CheckCircle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/components/ui/use-toast";
import { createPageUrl } from "@/utils";

export default function GoogleMeet() {
  const { toast } = useToast();
  const [meetCode, setMeetCode] = useState("");

  const { data: user } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const isGoogleConnected = !!(
    user?.google_access_token || user?.google_calendar_connected
  );

  const openMeet = (path = "") => {
    window.open(`https://meet.google.com/${path}`, "_blank", "noopener,noreferrer");
  };

  const joinMeeting = () => {
    const code = meetCode.trim().replace(/^https?:\/\/meet\.google\.com\//i, "");
    if (!code) {
      toast({ title: "Enter a meeting link or code first", variant: "destructive" });
      return;
    }
    openMeet(code);
  };

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <span className="text-3xl">🎥</span>
          Google Meet
        </h1>
        <p className="text-gray-500 mt-1">
          Start or join video calls with customers and your team
        </p>
      </div>

      {/* Integration status */}
      {isGoogleConnected ? (
        <Alert className="bg-green-50 border-green-300">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-800">
            <strong>Google Calendar is connected.</strong> Every new meeting event you create
            on the <a href={createPageUrl("Calendar")} className="underline font-medium">Calendar</a> page
            will automatically have a Google Meet link added — no extra clicks needed. You can
            uncheck it per event if you don't want one.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="bg-blue-50 border-blue-200">
          <Info className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            <strong>Connect Google Calendar</strong> to get Google Meet links automatically
            added to every meeting you schedule.{" "}
            <a href={createPageUrl("CalendarSettings")} className="underline font-medium">
              Connect now →
            </a>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-3 sm:p-6 text-center">
            <Video className="w-12 h-12 mx-auto mb-4 text-blue-600" />
            <h3 className="font-bold text-lg mb-2">Start New Meeting</h3>
            <p className="text-sm text-gray-600 mb-4">
              Launch an instant meeting and share the link
            </p>
            <Button
              data-testid="start-meet-btn"
              className="w-full bg-blue-600 hover:bg-blue-700"
              onClick={() => openMeet("new")}
            >
              <Video className="w-4 h-4 mr-2" />
              Start Meeting
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <CardContent className="p-3 sm:p-6 text-center">
            <Calendar className="w-12 h-12 mx-auto mb-4 text-green-600" />
            <h3 className="font-bold text-lg mb-2">Schedule in Calendar</h3>
            <p className="text-sm text-gray-600 mb-4">
              {isGoogleConnected
                ? "Meet link auto-added when you create a Meeting event"
                : "Book a meeting — connect Google Calendar for auto Meet links"}
            </p>
            <Button
              data-testid="schedule-meet-btn"
              className="w-full bg-green-600 hover:bg-green-700"
              onClick={() => window.open(createPageUrl("Calendar"), "_self")}
            >
              <Calendar className="w-4 h-4 mr-2" />
              Open Calendar
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
          <CardContent className="p-3 sm:p-6 text-center">
            <Users className="w-12 h-12 mx-auto mb-4 text-purple-600" />
            <h3 className="font-bold text-lg mb-2">Join a Meeting</h3>
            <p className="text-sm text-gray-600 mb-4">
              Enter a meeting code or paste the full link
            </p>
            <div className="space-y-2">
              <Input
                data-testid="meet-code-input"
                placeholder="abc-defg-hij or full link"
                value={meetCode}
                onChange={e => setMeetCode(e.target.value)}
                onKeyDown={e => e.key === "Enter" && joinMeeting()}
                className="text-sm"
              />
              <Button
                data-testid="join-meet-btn"
                className="w-full bg-purple-600 hover:bg-purple-700"
                onClick={joinMeeting}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Join
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-gray-500" />
            Quick Links
          </h3>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" size="sm" onClick={() => openMeet()}>
              <ExternalLink className="w-3 h-3 mr-1.5" />
              Open Google Meet
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("https://calendar.google.com", "_blank", "noopener,noreferrer")}
            >
              <Calendar className="w-3 h-3 mr-1.5" />
              Google Calendar
            </Button>
            {!isGoogleConnected && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(createPageUrl("CalendarSettings"), "_self")}
              >
                <CheckCircle className="w-3 h-3 mr-1.5 text-green-600" />
                Connect Google Calendar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
