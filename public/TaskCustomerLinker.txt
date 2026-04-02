import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Check, X, Search, Link as LinkIcon, UserCheck, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function TaskCustomerLinker() {
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Task.filter({ company_id: myCompany.id }, '-created_date', 5000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, '-created_date', 5000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, '-created_date', 5000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, relatedTo }) => 
      base44.entities.Task.update(taskId, { related_to: relatedTo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task linked successfully!');
    },
    onError: (error) => {
      toast.error('Failed to link task: ' + error.message);
    }
  });

  // Find tasks without related_to
  const unlinkedTasks = React.useMemo(() => {
    return tasks.filter(t => !t.related_to || t.related_to.trim() === '');
  }, [tasks]);

  // Find potential matches for each task
  const taskMatches = React.useMemo(() => {
    return unlinkedTasks.map(task => {
      const taskName = task.name.toLowerCase();
      const allContacts = [
        ...customers.map(c => ({ ...c, type: 'customer', displayName: c.name })),
        ...leads.map(l => ({ ...l, type: 'lead', displayName: l.name }))
      ];

      // Try to find matches in task name
      const matches = allContacts.filter(contact => {
        const contactName = contact.displayName.toLowerCase();
        
        // Check if customer name appears in task name
        if (taskName.includes(contactName)) return true;
        
        // Check if task name appears in customer name
        if (contactName.includes(taskName)) return true;
        
        // Split both into words and check for significant overlap
        const taskWords = taskName.split(/[\s\-]+/).filter(w => w.length > 2);
        const contactWords = contactName.split(/[\s\-]+/).filter(w => w.length > 2);
        
        let matchCount = 0;
        taskWords.forEach(tw => {
          if (contactWords.some(cw => cw === tw || tw.includes(cw) || cw.includes(tw))) {
            matchCount++;
          }
        });
        
        // If at least 2 words match, it's a potential match
        return matchCount >= 2;
      });

      return {
        task,
        matches: matches.slice(0, 5) // Top 5 matches
      };
    });
  }, [unlinkedTasks, customers, leads]);

  const filteredTaskMatches = React.useMemo(() => {
    if (!searchTerm) return taskMatches;
    const search = searchTerm.toLowerCase();
    return taskMatches.filter(tm => 
      tm.task.name.toLowerCase().includes(search) ||
      tm.matches.some(m => m.displayName.toLowerCase().includes(search))
    );
  }, [taskMatches, searchTerm]);

  const handleLink = (taskId, contactName) => {
    updateTaskMutation.mutate({ taskId, relatedTo: contactName });
  };

  const handleSkip = (taskId) => {
    // Just mark as reviewed by adding a tag or note
    toast.info('Task skipped');
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Link Tasks to Customers</h1>
          <p className="text-gray-500 mt-1">
            Review and approve suggested customer/lead matches for {unlinkedTasks.length} unlinked tasks
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Unlinked Tasks ({filteredTaskMatches.length})</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search tasks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredTaskMatches.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <UserCheck className="w-12 h-12 mx-auto mb-3 text-green-500" />
              <p className="font-semibold text-lg">All tasks are linked!</p>
              <p className="text-sm mt-1">No unlinked tasks found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTaskMatches.map(({ task, matches }) => (
                <div key={task.id} className="p-4 border rounded-lg bg-gray-50">
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-gray-900">{task.name}</h3>
                        <Badge variant="outline">
                          {task.column?.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">
                        Created {new Date(task.created_date).toLocaleDateString()} by {task.created_by}
                      </p>

                      {matches.length === 0 ? (
                        <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-yellow-800">No automatic matches found</p>
                            <p className="text-xs text-yellow-700 mt-1">
                              You can manually select a customer/lead below
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3">
                          <p className="text-xs font-semibold text-gray-700 mb-2">
                            Suggested matches:
                          </p>
                          <div className="space-y-2">
                            {matches.map(match => (
                              <div
                                key={match.id}
                                className="flex items-center justify-between p-2 bg-white border rounded hover:border-blue-500 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant={match.type === 'customer' ? 'default' : 'secondary'}
                                    className="text-xs"
                                  >
                                    {match.type}
                                  </Badge>
                                  <span className="text-sm font-medium">{match.displayName}</span>
                                  {match.email && (
                                    <span className="text-xs text-gray-500">• {match.email}</span>
                                  )}
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => handleLink(task.id, match.displayName)}
                                  disabled={updateTaskMutation.isPending}
                                  className="bg-green-600 hover:bg-green-700"
                                >
                                  <Check className="w-4 h-4 mr-1" />
                                  Link
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-xs text-gray-500">Or select manually:</span>
                        <Select
                          onValueChange={(v) => {
                            if (v !== 'none') {
                              handleLink(task.id, v);
                            }
                          }}
                        >
                          <SelectTrigger className="w-64 h-8 text-xs">
                            <SelectValue placeholder="Choose customer/lead..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {customers.map(c => (
                              <SelectItem key={c.id} value={c.name}>
                                {c.name} (Customer)
                              </SelectItem>
                            ))}
                            {leads.map(l => (
                              <SelectItem key={l.id} value={l.name}>
                                {l.name} (Lead)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSkip(task.id)}
                      className="flex-shrink-0"
                    >
                      <X className="w-4 h-4 mr-1" />
                      Skip
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}