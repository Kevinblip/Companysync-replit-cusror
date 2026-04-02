import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  ChevronDown,
  User,
  FileText,
  RefreshCw
} from "lucide-react";
import { format } from "date-fns";

export default function WorkflowActivityLog() {
  const [expandedId, setExpandedId] = useState(null);

  const { data: executions = [], isLoading, refetch } = useQuery({
    queryKey: ['workflow-executions-log'],
    queryFn: () => base44.entities.WorkflowExecution.list("-created_date", 50),
    refetchInterval: 10000 // Auto-refresh every 10 seconds
  });

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700 border-green-200';
      case 'failed': return 'bg-red-100 text-red-700 border-red-200';
      case 'active': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'waiting_for_trigger': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'stopped': return 'bg-gray-100 text-gray-700 border-gray-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-4 h-4" />;
      case 'failed': return <XCircle className="w-4 h-4" />;
      case 'active': return <Activity className="w-4 h-4 animate-pulse" />;
      case 'waiting_for_trigger': return <Clock className="w-4 h-4" />;
      default: return <Activity className="w-4 h-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Activity className="w-8 h-8 mx-auto mb-2 animate-pulse" />
        Loading activity log...
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-600" />
          Recent Workflow Activity
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {executions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No workflow activity found.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {executions.map((exec) => (
              <div 
                key={exec.id} 
                className={`border rounded-lg transition-all duration-200 ${
                  expandedId === exec.id ? 'bg-gray-50 border-blue-200 shadow-sm' : 'bg-white hover:border-blue-200'
                }`}
              >
                <div 
                  className="p-4 flex items-center justify-between cursor-pointer"
                  onClick={() => toggleExpand(exec.id)}
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className={`p-2 rounded-full ${getStatusColor(exec.status).split(' ')[0]}`}>
                      {getStatusIcon(exec.status)}
                    </div>
                    
                    <div>
                      <h4 className="font-medium text-gray-900 flex items-center gap-2">
                        {exec.workflow_name}
                        <span className="text-gray-400 text-xs font-normal">
                          • {format(new Date(exec.created_date), 'MMM d, h:mm a')}
                        </span>
                      </h4>
                      <div className="flex items-center gap-3 text-sm text-gray-600 mt-1">
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {exec.entity_name} ({exec.entity_type})
                        </div>
                        {exec.current_step > 0 && (
                          <span className="text-xs bg-gray-200 px-2 py-0.5 rounded-full">
                            Step {exec.current_step}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={`${getStatusColor(exec.status)} capitalize`}>
                      {exec.status?.replace(/_/g, ' ')}
                    </Badge>
                    {expandedId === exec.id ? (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </div>

                {expandedId === exec.id && (
                  <div className="px-4 pb-4 pt-0 border-t border-gray-100 mt-2">
                    <h5 className="text-sm font-semibold text-gray-700 mt-3 mb-2">Execution Log</h5>
                    <ScrollArea className="h-[200px] rounded border bg-white p-2">
                      {exec.execution_log && exec.execution_log.length > 0 ? (
                        <div className="space-y-2">
                          {exec.execution_log.slice().reverse().map((log, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-sm p-2 rounded hover:bg-gray-50">
                              <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${log.success ? 'bg-green-500' : 'bg-red-500'}`} />
                              <div className="flex-1">
                                <div className="flex justify-between">
                                  <span className="font-medium text-gray-900 capitalize">
                                    {log.action?.replace(/_/g, ' ')} (Step {log.step})
                                  </span>
                                  <span className="text-xs text-gray-400">
                                    {log.timestamp ? format(new Date(log.timestamp), 'h:mm:ss a') : ''}
                                  </span>
                                </div>
                                <p className={`text-gray-600 mt-0.5 ${!log.success ? 'text-red-600' : ''}`}>
                                  {log.message}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 text-center py-4">No logs available</p>
                      )}
                    </ScrollArea>
                    
                    {exec.next_action_time && exec.status === 'active' && (
                      <div className="mt-3 text-sm text-blue-600 bg-blue-50 p-2 rounded flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Next action scheduled for: {format(new Date(exec.next_action_time), 'MMM d, h:mm a')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}