import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';

export default function SmsSender() {
  const [toNumber, setToNumber] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState(null);

  // Get user's company
  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me()
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['companies', user?.email],
    queryFn: () => user ? base44.entities.Company.filter({ created_by: user.email }) : [],
    enabled: !!user
  });

  const companyId = staffProfiles[0]?.company_id || companies[0]?.id;
  const repTwilioNumber = staffProfiles[0]?.twilio_number || '';

  const handleSend = async () => {
    if (!toNumber || !messageBody) {
      alert('Please provide a phone number and message.');
      return;
    }

    setIsSending(true);
    setResult(null);

    try {
      const response = await base44.functions.invoke('sendSMS', {
        to: toNumber,
        body: messageBody,
        companyId: companyId,
        ...(repTwilioNumber ? { from: repTwilioNumber } : {}),
      });

      if (response.data.success) {
        setResult({ success: true, message: `SMS sent! SID: ${response.data.sid}` });
      } else {
        throw new Error(response.data.error || 'Unknown error from function');
      }
    } catch (error) {
      console.error('Error sending SMS:', error);
      setResult({ success: false, message: `Failed to send SMS: ${error.message}` });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="p-4 md:p-8 flex justify-center items-center min-h-screen bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Send a Test SMS</CardTitle>
          <CardDescription>Use the Twilio function to send a message.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="to-number">To Phone Number</Label>
            <Input
              id="to-number"
              placeholder="+15551234567 (E.164 format)"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              disabled={isSending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="message-body">Message</Label>
            <Textarea
              id="message-body"
              placeholder="Enter your message here..."
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              disabled={isSending}
            />
          </div>
          <Button onClick={handleSend} disabled={isSending} className="w-full">
            {isSending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Send SMS
          </Button>
          {result && (
            <div className={`p-3 rounded-md text-sm ${result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {result.message}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}