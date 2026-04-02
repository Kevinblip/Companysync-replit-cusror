import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { 
  Database, Download, Upload, AlertTriangle, CheckCircle, 
  Clock, Trash2, Shield
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function BackupManager() {
  const [user, setUser] = useState(null);
  const [backupName, setBackupName] = useState('');
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [deleteExisting, setDeleteExisting] = useState(true);

  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list('-created_date'),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['backup-staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  // Match Layout.js logic: check impersonation first, then staff profile, then owned
  const myCompany = React.useMemo(() => {
    // 1. Check impersonation
    const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
    if (impersonatedId) {
      const target = companies.find(c => c.id === impersonatedId);
      if (target) return target;
    }

    if (!user) return null;

    // 2. Check staff profile company
    const myProfile = staffProfiles.find(s => s.user_email === user.email);
    if (myProfile?.company_id) {
      const profileCompany = companies.find(c => c.id === myProfile.company_id);
      if (profileCompany) return profileCompany;
    }

    // 3. Fallback to owned company
    const ownedCompanies = companies.filter(c => c.created_by === user.email);
    if (ownedCompanies.length === 0) return null;
    return [...ownedCompanies].sort((a, b) => new Date(a.created_date) - new Date(b.created_date))[0];
  }, [user, companies, staffProfiles]);

  const { data: backups = [] } = useQuery({
    queryKey: ['complete-backups', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CompleteBackup.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createBackupMutation = useMutation({
    mutationFn: async (name) => {
      const result = await base44.functions.invoke('createCompleteBackup', {
        companyId: myCompany.id,
        backupName: name || `Backup - ${format(new Date(), 'MMM dd, yyyy h:mm a')}`
      });
      console.log('[BackupManager] Function result:', result);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (data) => {
      console.log('[BackupManager] Backup success - data:', data);
      queryClient.invalidateQueries({ queryKey: ['complete-backups'] });
      setBackupName('');
      const recordCount = data?.total_records || 0;
      toast.success(`Backup created with ${recordCount} records!`);
    },
    onError: (error) => {
      console.error('[BackupManager] Backup error:', error);
      toast.error(`Backup failed: ${error.message}`);
    }
  });

  const restoreBackupMutation = useMutation({
    mutationFn: async ({ backupId, deleteExistingData }) => {
      const result = await base44.functions.invoke('restoreFromCompleteBackup', {
        backupId,
        deleteExistingData
      });
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      setShowRestoreDialog(false);
      setSelectedBackup(null);
      toast.success(`Restored ${data.total_restored} records!`);
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    },
    onError: (error) => {
      toast.error(`Restore failed: ${error.message}`);
    }
  });

  const deleteBackupMutation = useMutation({
    mutationFn: (backupId) => base44.entities.CompleteBackup.delete(backupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complete-backups'] });
      toast.success('Backup deleted');
    }
  });

  const handleCreateBackup = () => {
    createBackupMutation.mutate(backupName);
  };

  const handleRestore = () => {
    if (!selectedBackup) return;
    restoreBackupMutation.mutate({
      backupId: selectedBackup.id,
      deleteExistingData: deleteExisting
    });
  };

  if (!myCompany) {
    return (
      <div className="p-6">
        <Alert>
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>Loading company data...</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-600" />
            Backup Manager
          </h1>
          <p className="text-gray-500 mt-1">Create failsafe backups and restore your data</p>
        </div>
      </div>

      <Alert className="bg-blue-50 border-blue-200">
        <Database className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          <strong>Current Company:</strong> {myCompany.company_name || 'CompanySync'}
          <br />
          <strong>Backup Coverage:</strong> All customers, leads, invoices, payments, estimates, tasks, and 50+ other entity types
        </AlertDescription>
      </Alert>

      {/* Create Backup Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            Create New Backup
          </CardTitle>
          <CardDescription>
            Save a complete snapshot of all your company data before making changes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Backup Name (optional)</Label>
            <Input
              placeholder={`Backup - ${format(new Date(), 'MMM dd, yyyy h:mm a')}`}
              value={backupName}
              onChange={(e) => setBackupName(e.target.value)}
            />
          </div>
          <Button 
            onClick={handleCreateBackup}
            disabled={createBackupMutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700"
            size="lg"
          >
            {createBackupMutation.isPending ? (
              <>
                <Clock className="w-5 h-5 mr-2 animate-spin" />
                Creating Backup...
              </>
            ) : (
              <>
                <Download className="w-5 h-5 mr-2" />
                Create Backup Now
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Existing Backups */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Available Backups ({backups.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {backups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Database className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No backups yet. Create your first backup above.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {backups.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)).map(backup => (
                <div key={backup.id} className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{backup.backup_name}</h3>
                    <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(new Date(backup.created_date), 'MMM dd, yyyy h:mm a')}
                      </span>
                      <Badge variant="outline">
                        {Object.values(backup.entity_counts || {}).reduce((sum, count) => sum + count, 0)} records
                      </Badge>
                    </div>
                    {backup.entity_counts && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Object.entries(backup.entity_counts)
                          .filter(([_, count]) => count > 0)
                          .slice(0, 5)
                          .map(([entity, count]) => (
                            <span key={entity} className="text-xs text-gray-500">
                              {entity}: {count}
                            </span>
                          ))}
                        {Object.keys(backup.entity_counts).length > 5 && (
                          <span className="text-xs text-gray-500">
                            +{Object.keys(backup.entity_counts).length - 5} more...
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedBackup(backup);
                        setShowRestoreDialog(true);
                      }}
                      className="text-green-600 border-green-600 hover:bg-green-50"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Restore
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (window.confirm('Delete this backup?')) {
                          deleteBackupMutation.mutate(backup.id);
                        }
                      }}
                      className="text-red-600 border-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Restore Dialog */}
      <Dialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              Restore Backup
            </DialogTitle>
            <DialogDescription>
              This will restore data from: <strong>{selectedBackup?.backup_name}</strong>
            </DialogDescription>
          </DialogHeader>
          
          <Alert className="bg-yellow-50 border-yellow-200">
            <AlertTriangle className="w-4 h-4 text-yellow-600" />
            <AlertDescription className="text-yellow-900">
              <strong>Warning:</strong> This action will replace your current data with the backup.
              Make sure you want to proceed.
            </AlertDescription>
          </Alert>

          <div className="flex items-center space-x-2 py-4">
            <input
              type="checkbox"
              id="delete-existing"
              checked={deleteExisting}
              onChange={(e) => setDeleteExisting(e.target.checked)}
              className="w-4 h-4"
            />
            <Label htmlFor="delete-existing" className="cursor-pointer">
              Delete existing data before restoring (recommended)
            </Label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRestoreDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleRestore}
              disabled={restoreBackupMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {restoreBackupMutation.isPending ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Confirm Restore
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}