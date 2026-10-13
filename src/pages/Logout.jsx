import React, { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2 } from "lucide-react";

export default function Logout() {
  useEffect(() => {
    const performLogout = async () => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        await base44.auth.logout();
      } catch (error) {
        console.error("Logout error:", error);
        window.location.href = '/';
      }
    };
    
    performLogout();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
        <p className="text-gray-600 font-medium">Logging out...</p>
      </div>
    </div>
  );
}