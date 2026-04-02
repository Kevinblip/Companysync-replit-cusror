import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Simple test cron to verify SDK works
Deno.serve(async (req) => {
    console.log('🧪 Testing workflow cron SDK connection...');
    
    try {
        const base44 = createClientFromRequest(req);
        
        // Try to fetch workflow executions
        const executions = await base44.asServiceRole.entities.WorkflowExecution.list('-created_date', 5);
        
        console.log('✅ Successfully fetched executions:', executions.length);
        
        return Response.json({
            success: true,
            message: 'SDK working correctly',
            executionsFound: executions.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
        
        return Response.json({
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});