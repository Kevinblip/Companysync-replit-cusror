import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, CheckSquare } from "lucide-react";

export default function TaskSettings() {
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const [taskSettings, setTaskSettings] = useState({
    kanban_limit: 50,
    allow_staff_view_all_tasks: true,
    allow_customers_add_comments: true,
    auto_assign_task_creator_as_follower: true,
    auto_set_task_creator_as_follower_on_comment: true,
    stop_timer_on_new_timer: true,
    change_task_status_on_timer_start: false,
    billable_option_checked_by_default: true,
    timer_round_off: 5,
    default_status_when_created: 'not_started',
    default_priority: 'medium',
  });

  useEffect(() => {
    if (myCompany?.settings?.tasks) {
      setTaskSettings({ ...taskSettings, ...myCompany.settings.tasks });
    }
  }, [myCompany]);

  const updateMutation = useMutation({
    mutationFn: (data) => {
      const currentSettings = myCompany.settings || {};
      return base44.entities.Company.update(myCompany.id, { 
        settings: { ...currentSettings, tasks: data } 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      alert('✅ Task Settings saved!');
    },
  });

  const handleSave = () => {
    updateMutation.mutate(taskSettings);
  };

  if (!myCompany) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Task Settings</h1>
          <p className="text-gray-500 mt-1">Configure task management preferences</p>
        </div>
        <Button onClick={handleSave} className="bg-green-600 hover:bg-green-700">
          <Save className="w-4 h-4 mr-2" />
          Save Settings
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Task Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Limit tasks kanban rows per status</Label>
            <Input
              type="number"
              value={taskSettings.kanban_limit}
              onChange={(e) => setTaskSettings({...taskSettings, kanban_limit: parseInt(e.target.value)})}
            />
          </div>

          <div>
            <Label>Default status when new task is created</Label>
            <Select value={taskSettings.default_status_when_created} onValueChange={(v) => setTaskSettings({...taskSettings, default_status_when_created: v})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="not_started">Not Started</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Default Priority</Label>
            <Select value={taskSettings.default_priority} onValueChange={(v) => setTaskSettings({...taskSettings, default_priority: v})}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div>
              <Label className="text-base">Allow all staff to see all tasks related to projects</Label>
              <p className="text-sm text-gray-500">Excludes non-staff</p>
            </div>
            <Switch
              checked={taskSettings.allow_staff_view_all_tasks}
              onCheckedChange={(v) => setTaskSettings({...taskSettings, allow_staff_view_all_tasks: v})}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div>
              <Label className="text-base">Allow customer/staff to add/edit task comments only in the first hour</Label>
              <p className="text-sm text-gray-500">Administrators not applied</p>
            </div>
            <Switch
              checked={taskSettings.allow_customers_add_comments}
              onCheckedChange={(v) => setTaskSettings({...taskSettings, allow_customers_add_comments: v})}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div>
              <Label className="text-base">Auto assign task creator when new task is created</Label>
            </div>
            <Switch
              checked={taskSettings.auto_assign_task_creator_as_follower}
              onCheckedChange={(v) => setTaskSettings({...taskSettings, auto_assign_task_creator_as_follower: v})}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div>
              <Label className="text-base">Auto set task creator as task follower when new task is created</Label>
            </div>
            <Switch
              checked={taskSettings.auto_set_task_creator_as_follower_on_comment}
              onCheckedChange={(v) => setTaskSettings({...taskSettings, auto_set_task_creator_as_follower_on_comment: v})}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div>
              <Label className="text-base">Stop all other started timers when starting new timer</Label>
            </div>
            <Switch
              checked={taskSettings.stop_timer_on_new_timer}
              onCheckedChange={(v) => setTaskSettings({...taskSettings, stop_timer_on_new_timer: v})}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div>
              <Label className="text-base">Change task status to In Progress on timer started</Label>
              <p className="text-sm text-gray-500">Valid only if task status is Not Started</p>
            </div>
            <Switch
              checked={taskSettings.change_task_status_on_timer_start}
              onCheckedChange={(v) => setTaskSettings({...taskSettings, change_task_status_on_timer_start: v})}
            />
          </div>

          <div className="flex items-center justify-between py-3 border-t">
            <div>
              <Label className="text-base">Billable option is by default checked when new task is created?</Label>
              <p className="text-sm text-gray-500">Only from admin area</p>
            </div>
            <Switch
              checked={taskSettings.billable_option_checked_by_default}
              onCheckedChange={(v) => setTaskSettings({...taskSettings, billable_option_checked_by_default: v})}
            />
          </div>

          <div>
            <Label>Round off task timer</Label>
            <div className="flex gap-2 items-center">
              <Select value={taskSettings.timer_round_off.toString()} onValueChange={(v) => setTaskSettings({...taskSettings, timer_round_off: parseInt(v)})}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Don't round</SelectItem>
                  <SelectItem value="5">5 minutes</SelectItem>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-gray-500">Applied to the Timesheets overview report and when invoicing a task/project.</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}