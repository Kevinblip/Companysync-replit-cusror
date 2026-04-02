import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";

export default function WorkflowDebug() {
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const [testing, setTesting] = useState(null);
  const [results, setResults] = useState({});

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  useEffect(() => {
    if (user && companies.length > 0) {
      const company = companies.find(c => c.created_by === user.email);
      setMyCompany(company);
    }
  }, [user, companies]);

  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => base44.entities.Workflow.filter({ company_id: myCompany?.id }),
    enabled: !!myCompany,
    initialData: [],
  });

  const testWorkflow = async (workflow) => {
    setTesting(workflow.id);
    try {
      // Create test entity data based on trigger type
      let entityData = {
        company_name: myCompany?.company_name || 'Test Company',
        app_url: window.location.origin
      };

      // Add trigger-specific data
      switch (workflow.trigger_type) {
        case 'estimate_created':
          entityData = {
            ...entityData,
            estimate_number: 'TEST-001',
            customer_name: 'Test Customer',
            customer_email: 'test@example.com',
            amount: 5000,
            status: 'draft'
          };
          break;
        case 'task_completed':
          entityData = {
            ...entityData,
            task_name: 'Test Task',
            completed_by: user?.full_name || 'Test User'
          };
          break;
        case 'customer_created':
          entityData = {
            ...entityData,
            customer_name: 'Test Customer',
            customer_email: 'test@example.com',
            customer_phone: '+1234567890'
          };
          break;
        default:
          entityData = {
            ...entityData,
            name: 'Test Entity',
            customer_name: 'Test Customer',
            customer_email: 'test@example.com'
          };
      }

      console.log(`🧪 Testing workflow: ${workflow.workflow_name}`);
      console.log('   → Entity data:', entityData);

      const response = await base44.functions.invoke('triggerWorkflow', {
        triggerType: workflow.trigger_type,
        companyId: myCompany.id,
        entityType: 'Test',
        entityId: 'test-' + Date.now(),
        entityData: entityData
      });

      console.log('✅ Workflow response:', response);

      setResults(prev => ({
        ...prev,
        [workflow.id]: {
          success: true,
          message: response.data?.message || 'Success',
          timestamp: new Date().toLocaleTimeString()
        }
      }));
    } catch (error) {
      console.error('❌ Workflow test error:', error);
      setResults(prev => ({
        ...prev,
        [workflow.id]: {
          success: false,
          message: error.message,
          timestamp: new Date().toLocaleTimeString()
        }
      }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Workflow Debug</h1>
        <p className="text-gray-600">Test each workflow individually to see what's working</p>
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-900">
            <strong>📝 Instructions:</strong> Click "Test" on each workflow. Check the browser console (F12) and Dashboard → Code → Functions → executeWorkflow logs for detailed output.
          </p>
        </div>
      </div>

      {workflows.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-gray-500">No workflows found</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {workflows.map((workflow) => {
          const result = results[workflow.id];
          const isTesting = testing === workflow.id;

          return (
            <Card key={workflow.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {workflow.workflow_name}
                      {workflow.is_active ? (
                        <Badge className="bg-green-100 text-green-700">Active</Badge>
                      ) : (
                        <Badge className="bg-gray-100 text-gray-700">Inactive</Badge>
                      )}
                    </CardTitle>
                    <p className="text-sm text-gray-600 mt-1">{workflow.description}</p>
                    <p className="text-xs text-gray-500 mt-1">Trigger: {workflow.trigger_type}</p>
                  </div>
                  <Button
                    onClick={() => testWorkflow(workflow)}
                    disabled={isTesting || !workflow.is_active}
                    size="sm"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      'Test'
                    )}
                  </Button>
                </div>
              </CardHeader>
              {result && (
                <CardContent>
                  <div className={`p-3 rounded-lg ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    <div className="flex items-start gap-2">
                      {result.success ? (
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className={`font-medium ${result.success ? 'text-green-900' : 'text-red-900'}`}>
                          {result.message}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">{result.timestamp}</p>
                        {!result.success && (
                          <p className="text-xs text-red-700 mt-2">
                            Check console (F12) and function logs for details
                          </p>
                        )}
                        {result.success && (
                          <div className="mt-2 space-y-1">
                            <p className="text-xs text-gray-700">
                              <strong>Actions in this workflow:</strong>
                            </p>
                            {workflow.actions?.map((action, idx) => (
                              <p key={idx} className="text-xs text-gray-600">
                                • Step {action.step}: {action.action_type} {action.description ? `- ${action.description}` : ''}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}