
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert"; // Import Alert and AlertDescription
import { Brain, Plus, Trash2, Edit, Star, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function LexiMemory() {
  const [user, setUser] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingMemory, setEditingMemory] = useState(null);
  const [formData, setFormData] = useState({
    key: "",
    value: "",
    description: "",
    importance: 5,
    category: "lexi"
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: memories = [] } = useQuery({
    queryKey: ['ai-memories', user?.email],
    queryFn: () => user ? base44.entities.AIMemory.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  const createMemoryMutation = useMutation({
    mutationFn: (data) => base44.entities.AIMemory.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-memories'] });
      setShowDialog(false);
      resetForm();
    },
  });

  const updateMemoryMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AIMemory.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-memories'] });
      setShowDialog(false);
      resetForm();
    },
  });

  const deleteMemoryMutation = useMutation({
    mutationFn: (id) => base44.entities.AIMemory.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-memories'] });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => base44.entities.AIMemory.update(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-memories'] });
    },
  });

  const resetForm = () => {
    setFormData({
      key: "",
      value: "",
      description: "",
      importance: 5,
      category: "lexi"
    });
    setEditingMemory(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!user) return;

    if (editingMemory) {
      updateMemoryMutation.mutate({
        id: editingMemory.id,
        data: formData
      });
    } else {
      createMemoryMutation.mutate({
        ...formData,
        user_email: user.email
      });
    }
  };

  const handleEdit = (memory) => {
    setEditingMemory(memory);
    setFormData({
      key: memory.key,
      value: memory.value,
      description: memory.description,
      importance: memory.importance,
      category: memory.category
    });
    setShowDialog(true);
  };

  const handleDelete = (id) => {
    if (window.confirm("Delete this memory? Lexi will forget this information.")) {
      deleteMemoryMutation.mutate(id);
    }
  };

  const activeMemories = memories.filter(m => m.is_active);
  const inactiveMemories = memories.filter(m => !m.is_active);

  const getImportanceColor = (importance) => {
    if (importance >= 8) return "bg-red-100 text-red-800";
    if (importance >= 5) return "bg-yellow-100 text-yellow-800";
    return "bg-gray-100 text-gray-800";
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
            <Brain className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Lexi's Memory</h1>
            <p className="text-gray-500 mt-1">What Lexi remembers about you</p>
          </div>
        </div>

        <Dialog open={showDialog} onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="bg-purple-600 hover:bg-purple-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Memory
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingMemory ? "Edit Memory" : "Add New Memory"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Memory Key *</Label>
                <Input
                  value={formData.key}
                  onChange={(e) => setFormData({...formData, key: e.target.value})}
                  placeholder="e.g., preferred_meeting_time"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">A unique identifier for this memory</p>
              </div>

              <div>
                <Label>Value *</Label>
                <Input
                  value={formData.value}
                  onChange={(e) => setFormData({...formData, value: e.target.value})}
                  placeholder="e.g., afternoons after 2 PM"
                  required
                />
              </div>

              <div>
                <Label>Description *</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  placeholder="e.g., User prefers meetings in the afternoon"
                  rows={3}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Importance (1-10)</Label>
                  <Select 
                    value={formData.importance.toString()} 
                    onValueChange={(value) => setFormData({...formData, importance: parseInt(value)})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1,2,3,4,5,6,7,8,9,10].map(n => (
                        <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">Higher = more important</p>
                </div>

                <div>
                  <Label>Category</Label>
                  <Select 
                    value={formData.category} 
                    onValueChange={(value) => setFormData({...formData, category: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lexi">Lexi</SelectItem>
                      <SelectItem value="estimator">AI Estimator</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-purple-600 hover:bg-purple-700">
                  {editingMemory ? "Update Memory" : "Save Memory"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Info Card - NEW */}
      <Alert className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
        <Brain className="w-5 h-5 text-purple-600" />
        <AlertDescription>
          <div className="space-y-2">
            <p className="font-semibold text-purple-900">💡 What is Lexi Memory?</p>
            <p className="text-sm text-purple-800">
              <strong>Personal preferences about YOU.</strong> Tell Lexi your work style, preferences, and habits. 
              These are private to you and help Lexi give personalized responses.
            </p>
            <div className="mt-3 text-xs text-purple-700 space-y-1">
              <p><strong>Examples:</strong></p>
              <ul className="list-disc list-inside ml-2">
                <li>"I prefer scheduling appointments after 2 PM"</li>
                <li>"My typical waste factor is 15%"</li>
                <li>"Always remind me to follow up on Thursdays"</li>
                <li>"I work with State Farm insurance most often"</li>
              </ul>
            </div>
            <p className="text-xs text-purple-700 mt-2">
              <strong>💡 Tip:</strong> Just tell Lexi these things in conversation! She'll automatically save important preferences.
            </p>
          </div>
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-3xl font-bold text-purple-600">{activeMemories.length}</div>
            <div className="text-sm text-gray-600 mt-1">Active Memories</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-3xl font-bold text-gray-400">{inactiveMemories.length}</div>
            <div className="text-sm text-gray-600 mt-1">Inactive Memories</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-3xl font-bold text-blue-600">
              {activeMemories.filter(m => m.importance >= 8).length}
            </div>
            <div className="text-sm text-gray-600 mt-1">High Priority</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="w-5 h-5 text-purple-600" />
            Active Memories
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {activeMemories.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Brain className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p>No memories yet. Lexi will learn about you as you interact!</p>
              </div>
            ) : (
              activeMemories
                .sort((a, b) => b.importance - a.importance)
                .map((memory) => (
                  <div key={memory.id} className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900">{memory.key}</h3>
                          <Badge className={getImportanceColor(memory.importance)}>
                            Priority: {memory.importance}
                          </Badge>
                          <Badge variant="outline">{memory.category}</Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{memory.description}</p>
                        <p className="text-sm font-medium text-purple-600">"{memory.value}"</p>
                        {memory.access_count > 0 && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                            <TrendingUp className="w-3 h-3" />
                            Used {memory.access_count} times
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 ml-4">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(memory)}
                          className="h-8 w-8"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleActiveMutation.mutate({ id: memory.id, is_active: false })}
                          className="h-8 w-8 text-gray-600"
                          title="Deactivate"
                        >
                          <Star className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(memory.id)}
                          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
            )}
          </div>
        </CardContent>
      </Card>

      {inactiveMemories.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-gray-500">Inactive Memories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {inactiveMemories.map((memory) => (
                <div key={memory.id} className="border border-gray-200 rounded-lg p-4 opacity-60">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-gray-700">{memory.key}</h3>
                        <Badge variant="outline">{memory.category}</Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{memory.description}</p>
                      <p className="text-sm text-gray-700">"{memory.value}"</p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleActiveMutation.mutate({ id: memory.id, is_active: true })}
                        className="h-8 w-8 text-purple-600"
                        title="Reactivate"
                      >
                        <Star className="w-4 h-4 fill-purple-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(memory.id)}
                        className="h-8 w-8 text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
