import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Send } from 'lucide-react';
import AssignmentDialog from '../components/inspections/AssignmentDialog';
import useTranslation from "@/hooks/useTranslation";

export default function NewInspection() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <Button variant="ghost" onClick={() => navigate(createPageUrl('InspectionsDashboard'))} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> {t.common.back}
        </Button>
        
        <div className="bg-white p-8 rounded-lg shadow-md text-center">
            <h1 className="text-2xl font-bold mb-2">{t.sidebar.newCrewcamJob}</h1>
            <p className="text-gray-600 mb-6">Assign a new job to a vetted inspector and notify them instantly.</p>
            <Button size="lg" onClick={() => setIsDialogOpen(true)}>
                <Send className="mr-2 h-5 w-5" /> {t.inspections.sendReport}
            </Button>
        </div>

        <AssignmentDialog 
            isOpen={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            onAssignmentSent={(job) => {
                setIsDialogOpen(false);
                // Optionally navigate to the job or dashboard
                navigate(createPageUrl('InspectionsDashboard'));
            }}
        />
      </div>
    </div>
  );
}
