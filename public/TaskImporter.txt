import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Download, FileSpreadsheet, CheckCircle, AlertCircle, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function TaskImporter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [selectedBoard, setSelectedBoard] = useState("");

  const [user, setUser] = React.useState(null);

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  const { data: boards = [] } = useQuery({
    queryKey: ['task-boards', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.TaskBoard.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResults(null);
    }
  };

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const tasks = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const task = {};
      
      headers.forEach((header, index) => {
        task[header] = values[index] || '';
      });
      
      tasks.push(task);
    }
    
    return tasks;
  };

  const handleImport = async () => {
    if (!file || !selectedBoard) {
      alert('Please select a file and board!');
      return;
    }

    setImporting(true);
    
    try {
      const text = await file.text();
      const parsedTasks = parseCSV(text);
      
      let imported = 0;
      let skipped = 0;
      const errors = [];

      for (const taskData of parsedTasks) {
        try {
          const taskPayload = {
            name: taskData.name || taskData.task || taskData.title || 'Untitled Task',
            description: taskData.description || taskData.notes || '',
            board_id: selectedBoard,
            column: taskData.column || taskData.status || 'todo',
            priority: taskData.priority || 'medium',
            status: taskData.status === 'Completed' ? 'job_completed' : 'not_started',
            start_date: taskData.start_date || taskData.startdate || '',
            due_date: taskData.due_date || taskData.duedate || taskData.deadline || '',
            assigned_to: taskData.assigned_to || taskData.assignee || '',
            tags: taskData.tags ? taskData.tags.split(';') : [],
          };

          await base44.entities.Task.create(taskPayload);
          imported++;
        } catch (error) {
          skipped++;
          errors.push({ task: taskData.name || 'Unknown', error: error.message });
        }
      }

      setResults({
        total: parsedTasks.length,
        imported,
        skipped,
        errors
      });

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch (error) {
      alert('Import failed: ' + error.message);
    }
    
    setImporting(false);
  };

  const downloadTemplate = () => {
    const csv = 'name,description,column,priority,status,start_date,due_date,assigned_to,tags\n' +
                'Follow up with John Doe,Call to discuss proposal,todo,high,Not Started,2025-01-15,2025-01-20,user@example.com,sales;follow-up\n' +
                'Roof Install - Client Name,Complete roof installation,in_progress,medium,In Progress,2025-01-10,2025-01-25,rep@example.com,roofing;install';
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'task_import_template.csv';
    a.click();
  };

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate(createPageUrl('Tasks'))}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Tasks
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Import Tasks</h1>
          <p className="text-gray-500 mt-1">Bulk import tasks from CSV file</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              Upload CSV File
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Select Board *</Label>
              <Select value={selectedBoard} onValueChange={setSelectedBoard}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a board" />
                </SelectTrigger>
                <SelectContent>
                  {boards.map(board => (
                    <SelectItem key={board.id} value={board.id}>
                      {board.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Upload CSV File</Label>
              <Input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="mt-2"
              />
              {file && (
                <p className="text-sm text-green-600 mt-2">
                  ✓ {file.name} selected
                </p>
              )}
            </div>

            <Button
              onClick={handleImport}
              disabled={!file || !selectedBoard || importing}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {importing ? (
                <>Processing...</>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Import Tasks
                </>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={downloadTemplate}
              className="w-full"
            >
              <Download className="w-4 h-4 mr-2" />
              Download CSV Template
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CSV Format Guide</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm">
              <p className="text-gray-600">Your CSV should have these columns:</p>
              
              <div className="bg-gray-50 p-3 rounded-lg space-y-2">
                <div><strong>name</strong> - Task title (required)</div>
                <div><strong>description</strong> - Task details</div>
                <div><strong>column</strong> - todo, in_progress, or done</div>
                <div><strong>priority</strong> - low, medium, or high</div>
                <div><strong>status</strong> - Not Started, In Progress, Completed</div>
                <div><strong>start_date</strong> - YYYY-MM-DD format</div>
                <div><strong>due_date</strong> - YYYY-MM-DD format</div>
                <div><strong>assigned_to</strong> - Email address</div>
                <div><strong>tags</strong> - Separated by semicolons</div>
              </div>

              <div className="bg-blue-50 p-3 rounded-lg">
                <p className="text-blue-800 text-xs">
                  <strong>Tip:</strong> Download the template above to see an example format!
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {results && (
        <Card className="border-l-4 border-l-green-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              Import Complete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Total Records:</span>
                <span className="font-bold">{results.total}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-green-600">Successfully Imported:</span>
                <span className="font-bold text-green-600">{results.imported}</span>
              </div>
              {results.skipped > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-orange-600">Skipped:</span>
                  <span className="font-bold text-orange-600">{results.skipped}</span>
                </div>
              )}

              {results.errors.length > 0 && (
                <div className="mt-4 p-3 bg-red-50 rounded-lg">
                  <p className="font-semibold text-red-800 mb-2">Errors:</p>
                  <ul className="text-sm text-red-700 space-y-1">
                    {results.errors.slice(0, 5).map((err, idx) => (
                      <li key={idx}>• {err.task}: {err.error}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Button
                onClick={() => navigate(createPageUrl('Tasks'))}
                className="w-full mt-4"
              >
                View Imported Tasks
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}