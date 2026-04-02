import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Edit2, User, Link as LinkIcon, CheckSquare } from "lucide-react";
import { toast } from 'sonner';

export default function FilteredTasksList({ 
  tasks, 
  columns, 
  staffProfiles,
  activeFilter,
  onTaskClick,
  onUpdateTask,
  getTaskAssignees 
}) {
  const getPriorityColor = (priority) => {
    const colors = {
      'high': 'bg-red-100 text-red-700',
      'medium': 'bg-orange-100 text-orange-700',
      'low': 'bg-blue-100 text-blue-700',
    };
    return colors[priority] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="p-6">
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b bg-gray-50">
            <div className="font-bold text-xl text-gray-900">
              {tasks.length} {activeFilter ? activeFilter.replace('-', ' ') : ''} {tasks.length === 1 ? 'Task' : 'Tasks'}
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 text-sm">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 text-sm">Task Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 text-sm">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 text-sm">Due Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 text-sm">Days Overdue</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 text-sm">Assigned To</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 text-sm">Priority</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 text-sm">Quick Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-4 py-12 text-center">
                      <CheckSquare className="w-16 h-16 mx-auto mb-4 text-green-500" />
                      <p className="font-bold text-xl text-green-600">All clear!</p>
                      <p className="text-gray-600 mt-2">No {activeFilter || ''} tasks found</p>
                    </td>
                  </tr>
                ) : (
                  tasks.map((task, idx) => {
                    const isOverdue = task.due_date && new Date(task.due_date) < new Date();
                    const daysPastDue = task.due_date ? Math.floor((new Date() - new Date(task.due_date)) / (1000 * 60 * 60 * 24)) : 0;
                    const assignees = getTaskAssignees(task);
                    
                    return (
                      <tr 
                        key={task.id} 
                        className={`border-b hover:bg-blue-50 transition-colors ${isOverdue ? 'bg-red-50' : ''}`}
                      >
                        <td className="px-4 py-4 text-gray-900 font-bold">{idx + 1}</td>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-blue-600 hover:underline cursor-pointer" onClick={() => onTaskClick(task)}>
                            {task.name}
                          </div>
                          {task.related_to && (
                            <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                              <LinkIcon className="w-3 h-3" />
                              {task.related_to}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={task.column}
                            onValueChange={(v) => {
                              onUpdateTask({
                                id: task.id,
                                data: { ...task, column: v }
                              });
                              toast.success('Status updated!');
                            }}
                          >
                            <SelectTrigger 
                              className="h-8 border-0 font-medium"
                              style={{ 
                                backgroundColor: columns.find(c => c.id === task.column)?.color + '20',
                                color: columns.find(c => c.id === task.column)?.color,
                              }}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {columns.map(col => (
                                <SelectItem key={col.id} value={col.id}>
                                  <div className="flex items-center gap-2">
                                    <div 
                                      className="w-3 h-3 rounded-full" 
                                      style={{ backgroundColor: col.color }}
                                    />
                                    {col.name}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-4">
                          <div className={isOverdue ? 'text-red-600 font-bold' : 'text-gray-700'}>
                            {task.due_date ? format(new Date(task.due_date), 'MMM d, yyyy') : 'No due date'}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          {isOverdue && daysPastDue > 0 ? (
                            <Badge className="bg-red-600 text-white font-bold px-3 py-1">
                              🔥 {daysPastDue} {daysPastDue === 1 ? 'day' : 'days'}
                            </Badge>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {assignees.length > 0 ? (
                            <div className="font-medium text-gray-900">
                              {assignees.map(a => a.name).join(', ')}
                            </div>
                          ) : (
                            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 font-bold border-yellow-400">
                              ⚠️ Unassigned
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <Badge className={getPriorityColor(task.priority) + ' font-semibold'}>
                            {task.priority.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex gap-2">
                            {assignees.length === 0 ? (
                              <Select
                                value=""
                                onValueChange={(v) => {
                                  const staff = staffProfiles.find(s => s.user_email === v);
                                  if (staff) {
                                    onUpdateTask({
                                      id: task.id,
                                      data: {
                                        ...task,
                                        assignees: [{
                                          email: staff.user_email,
                                          name: staff.full_name,
                                          avatar: staff.avatar_url
                                        }],
                                        assigned_to: staff.user_email,
                                        assigned_to_name: staff.full_name
                                      }
                                    });
                                    toast.success(`✅ Assigned to ${staff.full_name}`);
                                  }
                                }}
                              >
                                <SelectTrigger className="w-40 h-9 bg-blue-600 text-white hover:bg-blue-700 border-0 font-semibold">
                                  <SelectValue placeholder="🎯 Assign Now →" />
                                </SelectTrigger>
                                <SelectContent>
                                  {staffProfiles.map(staff => (
                                    <SelectItem key={staff.user_email} value={staff.user_email}>
                                      {staff.full_name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onTaskClick(task)}
                                className="hover:bg-blue-50 font-medium"
                              >
                                <Edit2 className="w-4 h-4 mr-2" />
                                Open Task
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}