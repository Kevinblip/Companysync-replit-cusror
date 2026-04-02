import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, Trash2, Edit } from "lucide-react";
import { format } from "date-fns";
import { getColorForEventType } from "./EventFormDialog";

export default function EventDetailDialog({
  selectedEvent,
  onClose,
  onEdit,
  onDelete,
  isDeleting,
}) {
  if (!selectedEvent) return null;

  return (
    <Dialog open={selectedEvent !== null} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">{selectedEvent?.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-gray-600">
            <CalendarIcon className="w-5 h-5" />
            <div>
              <div className="font-medium">
                {(() => {
                  try {
                    const date = new Date(selectedEvent.start_time);
                    return !isNaN(date.getTime()) ? format(date, 'EEEE, MMMM d, yyyy') : 'Invalid Date';
                  } catch (e) { return 'Invalid Date'; }
                })()}
              </div>
              <div className="text-sm">
                {(() => {
                  try {
                    const start = new Date(selectedEvent.start_time);
                    const end = selectedEvent.end_time ? new Date(selectedEvent.end_time) : null;
                    const validStart = !isNaN(start.getTime());
                    const validEnd = end && !isNaN(end.getTime());
                    if (!validStart) return 'Invalid Time';
                    return (
                      <>
                        {format(start, 'h:mm a')}
                        {validEnd && ` - ${format(end, 'h:mm a')}`}
                      </>
                    );
                  } catch (e) { return 'Invalid Time'; }
                })()}
              </div>
            </div>
          </div>

          {selectedEvent.event_type && (
            <div>
              <span className="font-semibold">Type: </span>
              <Badge
                variant="outline"
                style={{
                  backgroundColor: (selectedEvent.color || getColorForEventType(selectedEvent.event_type)) + '20',
                  borderColor: selectedEvent.color || getColorForEventType(selectedEvent.event_type),
                  color: selectedEvent.color || getColorForEventType(selectedEvent.event_type)
                }}
              >
                {selectedEvent.event_type.replace(/_/g, ' ')}
              </Badge>
            </div>
          )}

          {selectedEvent.description && (
            <div>
              <span className="font-semibold">Description:</span>
              <p className="text-gray-600 mt-1">{selectedEvent.description}</p>
            </div>
          )}

          {selectedEvent.location && (
            <div>
              <span className="font-semibold">Location: </span>
              {selectedEvent.location}
            </div>
          )}

          {selectedEvent.assigned_to && (
            <div>
              <span className="font-semibold">Assigned to: </span>
              {selectedEvent.assigned_to}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => onDelete(selectedEvent.id)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              disabled={isDeleting}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
            <Button
              variant="outline"
              onClick={() => onEdit(selectedEvent)}
            >
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
            <Button onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
