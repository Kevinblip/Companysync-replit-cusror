import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const formData = await req.formData();
        const callSid = formData.get('CallSid');
        const recordingUrl = formData.get('RecordingUrl');
        const recordingSid = formData.get('RecordingSid');

        const base44 = createClientFromRequest(req);

        // Find the communication record
        const comms = await base44.asServiceRole.entities.Communication.filter({ 
            twilio_sid: callSid 
        });

        if (comms && comms.length > 0) {
            const comm = comms[0];
            
            // Update with recording URL
            await base44.asServiceRole.entities.Communication.update(comm.id, {
                recording_url: recordingUrl + '.mp3' // Add .mp3 extension for proper playback
            });

            // If transcription is enabled, trigger it
            const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ 
                company_id: comm.company_id 
            });

            if (twilioSettings && twilioSettings[0]?.enable_transcription) {
                // TODO: Trigger transcription (can be done with OpenAI Whisper or Twilio's transcription service)
                // For now, we'll skip this - can add later if needed
            }
        }

        return new Response('OK');

    } catch (error) {
        console.error('Recording Webhook Error:', error);
        return new Response('ERROR');
    }
});