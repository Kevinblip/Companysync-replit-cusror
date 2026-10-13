import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Normalize phone number
function normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '').slice(-10);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { customer_name, customer_phone, customer_email, property_address, company_id, duration_minutes = 45, requested_time } = await req.json();

        if (!customer_name || !customer_phone) {
            return Response.json({ error: 'customer_name and customer_phone required' }, { status: 400 });
        }

        // 🔒 CRITICAL: Check for duplicate appointments BEFORE booking
        const normalizedPhone = normalizePhone(customer_phone);
        const existingEvents = await base44.asServiceRole.entities.CalendarEvent.filter({
            company_id,
            status: 'scheduled'
        });
        
        const now = new Date();
        const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        
        const duplicateAppt = existingEvents.find(event => {
            if (!event.start_time) return false;
            const eventDate = new Date(event.start_time);
            if (eventDate < now || eventDate > thirtyDaysOut) return false;
            
            const desc = (event.description || '').toLowerCase();
            const title = (event.title || '').toLowerCase();
            return desc.includes(normalizedPhone) || desc.includes(customer_phone) || title.includes(normalizedPhone);
        });

        if (duplicateAppt) {
            console.log('⚠️ Duplicate appointment found - not booking');
            return Response.json({
                success: false,
                duplicate: true,
                existing_appointment: {
                    date: new Date(duplicateAppt.start_time).toLocaleDateString('en-US', { 
                        weekday: 'long', month: 'short', day: 'numeric' 
                    }),
                    time: new Date(duplicateAppt.start_time).toLocaleTimeString('en-US', { 
                        hour: 'numeric', minute: '2-digit' 
                    })
                }
            });
        }

        // Get available staff (admins or those with calendar access)
        const staff = await base44.asServiceRole.entities.StaffProfile.filter({ 
            company_id,
            is_active: true 
        });

        const availableStaff = staff.filter(s => s.is_administrator || s.can_manage_calendar);

        if (availableStaff.length === 0) {
            return Response.json({ error: 'No staff available for booking' }, { status: 400 });
        }

        // Parse requested time if provided
        const now = new Date();
        const businessStart = 9; // 9 AM
        const businessEnd = 17; // 5 PM
        const bufferMinutes = 15; // Buffer between appointments
        
        let preferredSlot = null;
        
        if (requested_time) {
            console.log('🕐 Parsing requested time:', requested_time);
            
            // Try to parse time from text like "2 pm today" or "2:00"
            const timeMatch = requested_time.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
            const todayMatch = requested_time.match(/today/i);
            
            if (timeMatch) {
                let hour = parseInt(timeMatch[1]);
                const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                const period = timeMatch[3]?.toLowerCase();
                
                // Convert to 24-hour format
                if (period === 'pm' && hour !== 12) hour += 12;
                if (period === 'am' && hour === 12) hour = 0;
                // If no period specified and hour is 1-7, assume PM for business context
                if (!period && hour >= 1 && hour <= 7) hour += 12;
                
                const targetDate = new Date(now);
                if (todayMatch) {
                    targetDate.setHours(hour, minute, 0, 0);
                    // If the time has passed today, it's invalid
                    if (targetDate <= now) {
                        console.log('❌ Requested time has passed');
                        preferredSlot = null;
                    } else {
                        preferredSlot = targetDate;
                        console.log('✅ Preferred slot (today):', preferredSlot.toISOString());
                    }
                } else {
                    // Default to tomorrow if no "today" specified
                    targetDate.setDate(targetDate.getDate() + 1);
                    targetDate.setHours(hour, minute, 0, 0);
                    preferredSlot = targetDate;
                    console.log('✅ Preferred slot (tomorrow):', preferredSlot.toISOString());
                }
                
                // Validate business hours
                if (preferredSlot && (hour < businessStart || hour >= businessEnd)) {
                    console.log('❌ Outside business hours');
                    preferredSlot = null;
                }
            }
        }

        let availableSlot = null;
        let assignedStaff = null;

        console.log(`🔍 Checking availability for ${availableStaff.length} staff members`);

        // Get ALL scheduled events once to avoid repeated queries
        const allEvents = await base44.asServiceRole.entities.CalendarEvent.filter({
            company_id,
            status: 'scheduled'
        });
        
        console.log(`📅 Found ${allEvents.length} total scheduled events`);

        // If customer requested a specific time, check that first
        if (preferredSlot) {
            const slotStart = preferredSlot;
            const slotEnd = new Date(slotStart);
            slotEnd.setMinutes(slotEnd.getMinutes() + duration_minutes);
            
            console.log('🔍 Checking preferred slot:', slotStart.toISOString(), '-', slotEnd.toISOString());

            for (const staffMember of availableStaff) {
                if (!staffMember.user_email) continue;

                // Add buffer to requested slot
                const slotStartWithBuffer = new Date(slotStart);
                slotStartWithBuffer.setMinutes(slotStartWithBuffer.getMinutes() - bufferMinutes);
                const slotEndWithBuffer = new Date(slotEnd);
                slotEndWithBuffer.setMinutes(slotEndWithBuffer.getMinutes() + bufferMinutes);

                // Filter to events that overlap (including buffer) for THIS staff member
                const conflictingEvents = allEvents.filter(event => {
                    if (event.assigned_to !== staffMember.user_email) return false;
                    
                    const eventStart = new Date(event.start_time);
                    const eventEnd = new Date(event.end_time);
                    const overlaps = (slotStartWithBuffer < eventEnd && slotEndWithBuffer > eventStart);
                    
                    if (overlaps) {
                        console.log(`❌ CONFLICT for ${staffMember.user_email}:`, event.title, 'at', eventStart.toISOString());
                    }
                    
                    return overlaps;
                });

                if (conflictingEvents.length === 0) {
                    console.log(`✅ Preferred time available for ${staffMember.user_email}`);
                    availableSlot = { start: slotStart, end: slotEnd };
                    assignedStaff = staffMember;
                    break;
                } else {
                    console.log(`❌ ${conflictingEvents.length} conflict(s) for ${staffMember.user_email}, trying next staff`);
                }
            }
        }

        // If preferred time not available or not specified, find next available slot
        if (!availableSlot) {
            for (let day = 0; day < 7; day++) {
                const checkDate = new Date(now);
                checkDate.setDate(checkDate.getDate() + day);
                
                // Skip weekends
                if (checkDate.getDay() === 0 || checkDate.getDay() === 6) continue;

                for (let hour = businessStart; hour < businessEnd; hour++) {
                    const slotStart = new Date(checkDate);
                    slotStart.setHours(hour, 0, 0, 0);
                    
                    // Skip past times today
                    if (slotStart <= now) continue;
                    
                    const slotEnd = new Date(slotStart);
                    slotEnd.setMinutes(slotEnd.getMinutes() + duration_minutes);

                    // Check each staff member for availability (with buffer)
                    for (const staffMember of availableStaff) {
                        if (!staffMember.user_email) continue;

                        // Add buffer to check slot
                        const checkStart = new Date(slotStart);
                        checkStart.setMinutes(checkStart.getMinutes() - bufferMinutes);
                        const checkEnd = new Date(slotEnd);
                        checkEnd.setMinutes(checkEnd.getMinutes() + bufferMinutes);

                        // Check if THIS staff member has conflicts (including buffer)
                        const conflictingEvents = allEvents.filter(event => {
                            if (event.assigned_to !== staffMember.user_email) return false;
                            
                            const eventStart = new Date(event.start_time);
                            const eventEnd = new Date(event.end_time);
                            return (checkStart < eventEnd && checkEnd > eventStart);
                        });

                        if (conflictingEvents.length === 0) {
                            console.log(`✅ Found available slot: ${slotStart.toISOString()} for ${staffMember.user_email}`);
                            availableSlot = { start: slotStart, end: slotEnd };
                            assignedStaff = staffMember;
                            break;
                        }
                    }

                    if (availableSlot) break;
                }

                if (availableSlot) break;
            }
        }

        if (!availableSlot) {
            console.log('❌ No available slots found');
            console.log('   Checked staff:', availableStaff.map(s => s.user_email));
            console.log('   Business hours:', businessStart, '-', businessEnd);
            console.log('   Days checked: 7');
            return Response.json({ 
                success: false, 
                message: 'No available slots found in the next 7 days' 
            });
        }
        
        console.log('✅ Found slot:', availableSlot.start.toISOString());
        console.log('   Assigned to:', assignedStaff.user_email);

        // Create CalendarEvent in CRM
        console.log('📝 Creating CRM event...');
        const event = await base44.asServiceRole.entities.CalendarEvent.create({
            company_id,
            title: `Inspection - ${customer_name}`,
            description: `Property: ${property_address || 'Not specified'}\nPhone: ${customer_phone}\nEmail: ${customer_email || 'Not provided'}\nBooked by: Sarah AI`,
            start_time: availableSlot.start.toISOString(),
            end_time: availableSlot.end.toISOString(),
            assigned_to: assignedStaff.user_email,
            attendees: [assignedStaff.user_email],
            related_customer: customer_name,
            event_type: 'inspection',
            status: 'scheduled',
            location: property_address || '',
            send_email_notification: true,
            email_reminder_minutes: [60, 10]
        });
        
        console.log('✅ CRM event created:', event.id);
        
        // Notify admins about new appointment
        const staffList = await base44.asServiceRole.entities.StaffProfile.filter({ company_id });
        const admins = staffList.filter(s => s.is_administrator);
        for (const admin of admins) {
            await base44.asServiceRole.entities.Notification.create({
                company_id,
                user_email: admin.user_email,
                title: '📅 Sarah Booked Appointment',
                message: `${customer_name} - ${formattedDate} at ${formattedTime}`,
                type: 'calendar',
                link_url: '/Calendar',
                is_read: false
            });
        }

        // Sync to Google Calendar via existing sync function
        try {
            await base44.asServiceRole.functions.invoke('syncCRMToGoogleCalendar', {
                event_id: event.id
            });
            console.log('✅ Synced to Google Calendar');
        } catch (e) {
            console.warn('Failed to sync to Google Calendar:', e);
        }

        // Send confirmation SMS
        const formattedDate = availableSlot.start.toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric' 
        });
        const formattedTime = availableSlot.start.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
        });

        const matchedPreferred = preferredSlot && 
            Math.abs(availableSlot.start - preferredSlot) < 60000; // Within 1 minute

        const firstName = customer_name.split(' ')[0];
        const staffFirstName = assignedStaff.full_name?.split(' ')[0] || assignedStaff.user_email;

        let confirmationMessage;
        if (matchedPreferred) {
            confirmationMessage = `Perfect, ${firstName}! I've scheduled your inspection for ${formattedDate} at ${formattedTime}. ${staffFirstName} will meet you at ${property_address || 'your property'}. You'll receive an email confirmation shortly.`;
        } else if (requested_time) {
            confirmationMessage = `${firstName}, your requested time wasn't available, but I've booked the next opening: ${formattedDate} at ${formattedTime}. ${staffFirstName} will meet you at ${property_address || 'your property'}. Confirmation email on the way!`;
        } else {
            confirmationMessage = `Great news, ${firstName}! I've scheduled your inspection for ${formattedDate} at ${formattedTime}. ${staffFirstName} will meet you at ${property_address || 'your property'}. Confirmation email coming shortly!`;
        }

        return Response.json({
            success: true,
            event_id: event.id,
            matched_requested_time: matchedPreferred,
            appointment: {
                date: formattedDate,
                time: formattedTime,
                staff: assignedStaff.full_name || assignedStaff.user_email,
                confirmation_message: confirmationMessage
            }
        });

    } catch (error) {
        console.error('Booking error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});