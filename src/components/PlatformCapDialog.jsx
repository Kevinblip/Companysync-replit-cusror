import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Key, Zap } from "lucide-react";

/**
 * PlatformCapDialog — shown when a platform-key monthly cap is hit.
 *
 * Triggered by the 'platform-cap-reached' CustomEvent dispatched in
 * base44Client.js when any function call returns { cap_reached: true }.
 *
 * Props:
 *   alert  — { message, configure_url } from the event detail, or null/undefined to hide
 *   onClose — callback to clear the alert
 */
export default function PlatformCapDialog({ alert, onClose }) {
  const navigate = useNavigate();
  const open = !!alert;

  function handleConfigure() {
    onClose?.();
    navigate(alert?.configure_url || "/APIKeysSettings");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Platform Usage Limit Reached
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-600 mt-2 leading-relaxed">
            {alert?.message || "You've reached the monthly usage limit for platform API keys."}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 my-2">
          <div className="flex items-start gap-3">
            <Key className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-900">Remove this limit instantly</p>
              <p className="text-xs text-blue-700 mt-1">
                Connect your own Google Gemini or Twilio account in <strong>Settings → API Keys</strong>.
                BYOK subscribers have no platform usage caps — you pay your provider directly.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={onClose}>Maybe Later</Button>
          <Button onClick={handleConfigure} className="bg-blue-600 hover:bg-blue-700 text-white">
            <Key className="w-4 h-4 mr-2" />
            Configure API Keys
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
