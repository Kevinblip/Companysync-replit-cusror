import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 Starting task status standardization...');

        const tasks = await base44.asServiceRole.entities.Task.list('', 10000);
        console.log(`📊 Found ${tasks.length} total tasks`);

        // Define the mapping of old statuses to new standard ones
        const statusMapping = {
            // Already standard (no change needed)
            'not_started': 'not_started',
            'in_progress': 'in_progress',
            'job_completed': 'job_completed',
            
            // Common variations to map
            'pending': 'not_started',
            'todo': 'not_started',
            'open': 'not_started',
            'new': 'not_started',
            'backlog': 'not_started',
            
            'active': 'in_progress',
            'started': 'in_progress',
            'working': 'in_progress',
            'ongoing': 'in_progress',
            
            'done': 'job_completed',
            'completed': 'job_completed',
            'finished': 'job_completed',
            'closed': 'job_completed',
            'resolved': 'job_completed',
            
            // Special cases
            'testing': 'in_progress',
            'review': 'in_progress',
            'awaiting_feedback': 'in_progress',
            'on_hold': 'not_started',
            'blocked': 'not_started',
            'cancelled': 'job_completed', // Or we could add a cancelled status if needed
        };

        let updatedCount = 0;
        const statusCounts = {};
        const errors = [];

        for (const task of tasks) {
            const currentStatus = task.status?.toLowerCase();
            
            // Count current status distribution
            statusCounts[currentStatus] = (statusCounts[currentStatus] || 0) + 1;

            // Skip if already using standard status
            if (['not_started', 'in_progress', 'job_completed'].includes(currentStatus)) {
                continue;
            }

            // Map to new status
            const newStatus = statusMapping[currentStatus] || 'not_started';

            try {
                await base44.asServiceRole.entities.Task.update(task.id, {
                    status: newStatus
                });
                updatedCount++;
                console.log(`✅ Updated task "${task.name}": ${currentStatus} → ${newStatus}`);
            } catch (error) {
                errors.push({
                    task_id: task.id,
                    task_name: task.name,
                    old_status: currentStatus,
                    error: error.message
                });
                console.error(`❌ Failed to update task ${task.id}:`, error);
            }
        }

        const summary = {
            total_tasks: tasks.length,
            already_standard: tasks.filter(t => 
                ['not_started', 'in_progress', 'job_completed'].includes(t.status?.toLowerCase())
            ).length,
            successfully_updated: updatedCount,
            status_distribution: statusCounts,
            errors: errors.length,
            error_details: errors
        };

        console.log('✅ Status standardization complete:', summary);

        return Response.json({
            success: true,
            summary,
            mapping_used: statusMapping
        });

    } catch (error) {
        console.error('❌ Task status standardization error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});