import React, { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function SetupWizard() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(`/QuickSetup${window.location.search || ''}`, { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  );
}