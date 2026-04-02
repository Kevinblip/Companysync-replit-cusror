import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Video, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { base44 } from '@/api/base44Client';

export default function GoogleMeetButton({ defaultAttendees = [], companyId }) {
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    summary: '',
    description: '',
    startTime: '',
    endTime: '',
    attendees: defaultAttendees,
  });

  const handleInstantMeet = () => {
    // Open a new instant Google Meet
    window.open('https://meet.google.com/new', '_blank');
  };

  const handleScheduleMeet = async (e) => {
    e.preventDefault();
    setIsCreating(true);

    try {
      const response = await base44.functions.invoke('createGoogleMeet', {
        summary: formData.summary,
        description: formData.description,
        startTime: formData.startTime,
        endTime: formData.endTime,
        attendees: formData.attendees.split(',').map(e => e.trim()).filter(Boolean),
        companyId: companyId
      });

      if (response.data.success) {
        alert('✅ Meeting scheduled! Meet link: ' + response.data.meet_url);
        window.open(response.data.meet_url, '_blank');
        setOpen(false);
        setFormData({
          summary: '',
          description: '',
          startTime: '',
          endTime: '',
          attendees: '',
        });
      }
    } catch (error) {
      alert('Failed to create meeting: ' + error.message);
    }

    setIsCreating(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button 
            variant="outline" 
            className="gap-2 bg-white hover:bg-gray-50"
          >
            <Video className="w-4 h-4 text-green-600" />
            <span className="hidden md:inline">Google Meet</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Google Meet Options</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Button
              onClick={handleInstantMeet}
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              type="button"
            >
              <Video className="w-4 h-4 mr-2" />
              Start Instant Meeting
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">Or Schedule</span>
              </div>
            </div>

            <form onSubmit={handleScheduleMeet} className="space-y-4">
              <div>
                <Label htmlFor="meetSummary">Meeting Title *</Label>
                <Input
                  id="meetSummary"
                  value={formData.summary}
                  onChange={(e) => setFormData({...formData, summary: e.target.value})}
                  placeholder="Team Standup, Client Call, etc."
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="meetStart">Start Time *</Label>
                  <Input
                    id="meetStart"
                    type="datetime-local"
                    value={formData.startTime}
                    onChange={(e) => setFormData({...formData, startTime: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="meetEnd">End Time *</Label>
                  <Input
                    id="meetEnd"
                    type="datetime-local"
                    value={formData.endTime}
                    onChange={(e) => setFormData({...formData, endTime: e.target.value})}
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="meetAttendees">Attendees (comma-separated emails)</Label>
                <Input
                  id="meetAttendees"
                  value={formData.attendees}
                  onChange={(e) => setFormData({...formData, attendees: e.target.value})}
                  placeholder="john@example.com, jane@example.com"
                />
              </div>

              <div>
                <Label htmlFor="meetDescription">Description</Label>
                <Textarea
                  id="meetDescription"
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  rows={3}
                  placeholder="Meeting agenda..."
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="bg-green-600 hover:bg-green-700"
                  disabled={isCreating}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Video className="w-4 h-4 mr-2" />
                      Schedule Meet
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}