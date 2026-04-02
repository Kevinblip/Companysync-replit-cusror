import React from "react";
import GeminiLiveClient from "@/components/ai/GeminiLiveClient";
import { Sparkles } from "lucide-react";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";

export default function LiveVoice() {
  const { myCompany } = useRoleBasedData();

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Sparkles className="w-7 h-7 text-purple-600" />
        <div>
          <h1 className="text-2xl font-bold">Live Voice</h1>
          <p className="text-gray-500 text-sm">Push-to-talk Gemini Live (mobile-friendly beta)</p>
        </div>
      </div>
      <GeminiLiveClient 
        systemPrompt="You are Sarah, a professional, friendly, and highly capable executive AI assistant for a construction and roofing company. You are efficient, witty, and concise. Keep your responses short and conversational." 
        companyId={myCompany?.id}
      />
    </div>
  );
}