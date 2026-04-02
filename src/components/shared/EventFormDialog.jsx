import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const EVENT_TYPE_COLORS = {
  meeting: '#3b82f6',
  inspection: '#10b981',
  call: '#8b5cf6',
  appointment: '#f59e0b',
  reminder: '#eab308',
  estimate: '#06b6d4',
  roofing_contractor: '#14b8a6',
  follow_up: '#ec4899',
  check_pickup: '#f97316',
  other: '#6b7280'
};

export const getColorForEventType = (eventType) => {
  return EVENT_TYPE_COLORS[eventType] || EVENT_TYPE_COLORS.other;
};

export default function EventFormDialog({
  open,
  onOpenChange,
  editingEvent,
  eventFormData,
  setEventFormData,
  onSubmit,
  isSubmitting,
  cancelLabel = "Cancel",
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingEvent ? 'Edit Event' : 'Add New Event'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="eventTitle">Event Title *</Label>
            <Input
              id="eventTitle"
              value={eventFormData.title}
              onChange={(e) => setEventFormData({...eventFormData, title: e.target.value})}
              required
              placeholder="Meeting, Inspection, Call, etc."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="startTime">Start Time *</Label>
              <Input
                id="startTime"
                type="datetime-local"
                value={eventFormData.start_time}
                onChange={(e) => setEventFormData({...eventFormData, start_time: e.target.value})}
                required
              />
            </div>
            <div>
              <Label htmlFor="endTime">End Time *</Label>
              <Input
                id="endTime"
                type="datetime-local"
                value={eventFormData.end_time}
                onChange={(e) => setEventFormData({...eventFormData, end_time: e.target.value})}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="eventType">Event Type</Label>
              <Select
                value={eventFormData.event_type || "meeting"}
                onValueChange={(v) => setEventFormData({
                  ...eventFormData,
                  event_type: v,
                  color: getColorForEventType(v)
                })}
              >
                <SelectTrigger id="eventType">
                  <SelectValue placeholder="Select event type"/>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="meeting">🟦 Meeting</SelectItem>
                  <SelectItem value="inspection">🟢 Inspection</SelectItem>
                  <SelectItem value="call">🟣 Call</SelectItem>
                  <SelectItem value="appointment">🟠 Appointment</SelectItem>
                  <SelectItem value="reminder">🟡 Reminder</SelectItem>
                  <SelectItem value="estimate">🔵 Estimate</SelectItem>
                  <SelectItem value="roofing_contractor">🟤 Roofing Contractor</SelectItem>
                  <SelectItem value="follow_up">🔴 Follow Up</SelectItem>
                  <SelectItem value="check_pickup">🟧 Check Pickup</SelectItem>
                  <SelectItem value="other">⚫ Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="eventColor">Color (auto-set by type)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="eventColor"
                  type="color"
                  value={eventFormData.color}
                  onChange={(e) => setEventFormData({...eventFormData, color: e.target.value})}
                  className="w-20"
                />
                <span className="text-sm text-gray-500">or customize</span>
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="eventLocation">Location</Label>
            <Input
              id="eventLocation"
              value={eventFormData.location}
              onChange={(e) => setEventFormData({...eventFormData, location: e.target.value})}
              placeholder="Address or meeting link"
            />
          </div>

          <div>
            <Label htmlFor="eventDescription">Description</Label>
            <Textarea
              id="eventDescription"
              value={eventFormData.description}
              onChange={(e) => setEventFormData({...eventFormData, description: e.target.value})}
              rows={3}
              placeholder="Event details..."
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="addGoogleMeet"
              checked={eventFormData.add_google_meet}
              onCheckedChange={(checked) => setEventFormData({...eventFormData, add_google_meet: checked})}
            />
            <Label htmlFor="addGoogleMeet">Add Google Meet link</Label>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
              {editingEvent ? (isSubmitting ? 'Updating...' : 'Update Event') : (isSubmitting ? 'Creating...' : 'Create Event')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
