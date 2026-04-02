import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const formData = await req.formData();
        const callSid = formData.get('CallSid');
        const callStatus = formData.get('CallStatus');
        const callDuration = formData.get('CallDuration');

        console.log(`📞 Call Status Webhook: SID=${callSid}, Status=${callStatus}, Duration=${callDuration}`);

        const base44 = createClientFromRequest(req);

        // Find the communication record
        const comms = await base44.asServiceRole.entities.Communication.filter({ 
            twilio_sid: callSid 
        });

        if (comms && comms.length > 0) {
            const comm = comms[0];
            
            // Map Twilio status to our status and outcome
            // Twilio statuses: initiated, ringing, in-progress, completed, busy, failed, no-answer, canceled
            let status = 'pending';
            let outcome = null;
            
            const duration = callDuration ? parseInt(callDuration) : 0;
            
            if (callStatus === 'completed') {
                // Only mark as "completed" if there was actual talk time
                if (duration > 0) {
                    status = 'completed';
                    outcome = 'successful';
                } else {
                    // Call ended without being answered (duration 0)
                    status = 'failed';
                    outcome = 'no_answer';
                }
            } else if (callStatus === 'busy') {
                status = 'failed';
                outcome = 'no_answer';
            } else if (callStatus === 'failed') {
                status = 'failed';
                outcome = 'no_answer';
            } else if (callStatus === 'no-answer') {
                status = 'failed';
                outcome = 'no_answer';
            } else if (callStatus === 'canceled') {
                status = 'failed';
                outcome = 'no_answer';
            } else if (callStatus === 'in-progress') {
                status = 'sent'; // Call connected
            } else if (callStatus === 'ringing' || callStatus === 'initiated') {
                status = 'pending';
            }
            
            // Update the call status
            const updateData = {
                status: status,
                duration_minutes: duration > 0 ? Math.ceil(duration / 60) : 0,
                cost: duration > 0 ? (duration / 60) * 0.013 : 0 // Approximate $0.013/min
            };
            
            if (outcome) {
                updateData.outcome = outcome;
            }
            
            console.log(`📞 Updating Communication ${comm.id}: status=${status}, outcome=${outcome}, duration=${duration}s`);
            
            await base44.asServiceRole.entities.Communication.update(comm.id, updateData);
        }

        return new Response('OK');

    } catch (error) {
        console.error('Call Status Webhook Error:', error);
        return new Response('ERROR');
    }
});