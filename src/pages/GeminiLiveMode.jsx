import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Car } from "lucide-react";
import GeminiLiveNativeClient from "@/components/ai/GeminiLiveNativeClient";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";

// Drive Mode — a dedicated full-screen entry point for a continuous,
// hands-free Lexi session. It uses the same server-authenticated native bridge
// (/ws/lexi-native) as the assistant panel; the only difference is that
// hands-free is forced on, so silence never ends the session and the screen is
// kept awake while the phone sits in a car mount.
export default function GeminiLiveMode() {
  const navigate = useNavigate();
  const { myCompany } = useRoleBasedData();

  return (
    <div className="h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 flex flex-col">
      <div className="p-4 border-b bg-white shadow-sm flex items-center gap-3">
        <Button
          onClick={() => navigate('/AIAssistant')}
          variant="ghost"
          size="icon"
          className="text-gray-600 hover:bg-gray-100"
          data-testid="button-exit-drive-mode"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Car className="w-5 h-5 text-indigo-600" />
        <h1 className="text-xl font-bold text-gray-800">Drive Mode</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
        <div className="w-full max-w-xl space-y-3">
          <p className="text-sm text-gray-600 text-center" data-testid="text-drive-mode-hint">
            Start the session once, then keep both hands on the wheel. Lexi stays
            listening through pauses until you tap stop.
          </p>
          <GeminiLiveNativeClient
            companyId={myCompany?.id}
            driveMode
          />
        </div>
      </div>
    </div>
  );
}
