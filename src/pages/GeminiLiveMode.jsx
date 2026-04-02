import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import GeminiLiveClient from "@/components/ai/GeminiLiveClient";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";

export default function GeminiLiveMode() {
  const navigate = useNavigate();
  const { myCompany } = useRoleBasedData();

  const systemPrompt = myCompany ? `You are Lexi, an AI assistant for ${myCompany.company_name}.

📋 COMPANY CONTEXT:
- Company Name: ${myCompany.company_name}
- Your CRM System: CompanySync

🔒 CRITICAL SECURITY RULES:
1. You work EXCLUSIVELY for ${myCompany.company_name}. This is your ONLY client.
2. You CANNOT access data from any other company (including Salesforce, HubSpot, or any external systems).
3. When asked "what is the name of this company" or "what company am I with", ALWAYS answer: "${myCompany.company_name}".
4. Your CRM platform is called "CompanySync" - NEVER mention external CRM names.
5. If you don't have information, say you don't know - DO NOT make up information.

🎯 Keep responses short and conversational. Be warm, professional, and helpful.` : undefined;

  return (
    <div className="h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 flex flex-col">
      <div className="p-4 border-b bg-white shadow-sm flex items-center gap-3">
        <Button 
          onClick={() => navigate('/AIAssistant')}
          variant="ghost"
          size="icon"
          className="text-gray-600 hover:bg-gray-100"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-xl font-bold text-gray-800">Gemini Live Voice Chat</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
        <div className="w-full max-w-xl">
          <GeminiLiveClient 
            systemPrompt={systemPrompt}
            companyId={myCompany?.id}
          />
        </div>
      </div>
    </div>
  );
}