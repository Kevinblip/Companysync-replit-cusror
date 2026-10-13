import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, MapPin, User, AlertTriangle, Check, X } from "lucide-react";
import { format } from "date-fns";

export default function ProposedEventCard({ action, onConfirm, onCancel, isConfirming }) {
  if (!action || !action.data) return null;

  const eventData = action.data;
  
  // ROBUST date parsing with fallback
  let eventDate;
  try {
    if (!eventData.start_time) {
      // No date provided - use tomorrow at 10am
      eventDate = new Date();
      eventDate.setDate(eventDate.getDate() + 1);
      eventDate.setHours(10, 0, 0, 0);
      console.warn('⚠️ No start_time provided, using tomorrow at 10am');
    } else {
      eventDate = new Date(eventData.start_time);
      
      // Check if date is valid
      if (isNaN(eventDate.getTime())) {
        console.error('❌ Invalid date:', eventData.start_time);
        // Fallback to tomorrow at 10am
        eventDate = new Date();
        eventDate.setDate(eventDate.getDate() + 1);
        eventDate.setHours(10, 0, 0, 0);
      } else {
        // Date is valid - check if it's in the past
        const now = new Date();
        if (eventDate < now) {
          console.warn('⚠️ Event date is in the past:', eventDate);
          // Move to tomorrow, keep the time
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(eventDate.getHours(), eventDate.getMinutes(), 0, 0);
          eventDate = tomorrow;
        }
      }
    }
    
    console.log('✅ Final event date:', eventDate.toISOString());
  } catch (error) {
    console.error('Error parsing event date:', error);
    // Ultimate fallback - tomorrow at 10am
    eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 1);
    eventDate.setHours(10, 0, 0, 0);
  }

  const isConflict = action.isConflict || false;

  return (
    <Card className={`mt-4 ${isConflict ? 'border-red-300 bg-red-50' : 'border-blue-300 bg-blue-50'}`}>
      <CardContent className="p-4">
        {isConflict && (
          <div className="flex items-center gap-2 mb-3 text-red-700 bg-red-100 p-2 rounded">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Scheduling Conflict</span>
            <p className="text-xs">This proposed time overlaps with an existing event on your calendar. Please edit the time before confirming.</p>
          </div>
        )}

        <div className="mb-3">
          <h4 className="font-bold text-lg text-gray-900">{eventData.title || 'New Event'}</h4>
          {eventData.description && (
            <p className="text-sm text-gray-600 mt-1">{eventData.description}</p>
          )}
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-blue-600" />
            <span className="font-medium">Date:</span>
            <span>{format(eventDate, 'EEEE, MMMM d, yyyy')}</span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-blue-600" />
            <span className="font-medium">Time:</span>
            <span>{format(eventDate, 'h:mm a')}</span>
          </div>

          {eventData.location && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-blue-600" />
              <span className="font-medium">Location:</span>
              <span>{eventData.location}</span>
            </div>
          )}

          {eventData.assigned_to && (
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-blue-600" />
              <span className="font-medium">Assigned to:</span>
              <span>{eventData.assigned_to}</span>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="text-xs">
              {(eventData.event_type || 'meeting').replace(/_/g, ' ')}
            </Badge>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => {
              // Update the event data with the corrected date before confirming
              const correctedEventData = {
                ...eventData,
                start_time: eventDate.toISOString()
              };
              onConfirm(correctedEventData);
            }}
            disabled={isConfirming}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          >
            {isConfirming ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Scheduling...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Confirm & Schedule
              </>
            )}
          </Button>
          <Button
            onClick={onCancel}
            disabled={isConfirming}
            variant="outline"
            className="flex-1 border-gray-300 hover:bg-gray-100"
          >
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}