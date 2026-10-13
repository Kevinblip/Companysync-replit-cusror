import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Database, Download, Upload, AlertTriangle, CheckCircle,
  Clock, Trash2, Shield, FileUp, Pin, PinOff, Settings as SettingsIcon, CalendarClock
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const RETENTION_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days (recommended)' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
];

const TYPE_BADGE_STYLE = {
  manual: 'bg-purple-100 text-purple-700 border-purple-300',
  daily: 'bg-blue-100 text-blue-700 border-blue-300',
  weekly: 'bg-green-100 text-green-700 border-green-300',
  monthly: 'bg-amber-100 text-amber-700 border-amber-300',
};

function expiryFromTypeAndSettings(type, settings) {
  const days = type === 'monthly' ? 730
    : type === 'weekly' ? 180
    : type === 'manual' ? null
    : (settings?.retention_days || 60);
  if (days === null) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export default function BackupManager() {
  const [user, setUser] = useState(null);
  const [backupName, setBackupName] = useState('');
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState(null);
  const [deleteExisting, setDeleteExisting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const uploadInputRef = useRef(null);

  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list('-created_date'),
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['backup-staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
  });

  const myCompany = React.useMemo(() => {
    const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
    if (impersonatedId) {
      const target = companies.find(c => c.id === impersonatedId);
      if (target) return target;
    }
    if (!user) return null;
    const myProfile = staffProfiles.find(s => s.user_email === user.email);
    if (myProfile?.company_id) {
      const profileCompany = companies.find(c => c.id === myProfile.company_id);
      if (profileCompany) return profileCompany;
    }
    const ownedCompanies = companies.filter(c => c.created_by === user.email);
    if (ownedCompanies.length === 0) return null;
    return [...ownedCompanies].sort((a, b) => new Date(a.created_date) - new Date(b.created_date))[0];
  }, [user, companies, staffProfiles]);

  // IMPORTANT: never list backups through the generic entity API — each backup
  // row contains the company's ENTIRE dataset (multi-MB), so listing all of
  // them at once blows past the deployment's response-size limit and the page
  // silently shows "No backups yet". This endpoint returns metadata only.
  const { data: backups = [], isError: backupsLoadFailed } = useQuery({
    queryKey: ['complete-backups', myCompany?.id],
    queryFn: async () => {
      const result = await base44.functions.invoke('listCompanyBackups', { companyId: myCompany.id });
      if (result.error) throw new Error(result.error);
      return result.data?.backups || [];
    },
    enabled: !!myCompany,
  });

  const { data: settingsList = [] } = useQuery({
    queryKey: ['backup-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.BackupSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const settings = settingsList[0] || {
    retention_days: 60,
    weekly_enabled: true,
    monthly_enabled: true,
    email_enabled: true,
  };

  const sortedBackups = React.useMemo(
    () => [...backups].sort((a, b) => new Date(b.created_date) - new Date(a.created_date)),
    [backups]
  );

  const lastBackup = sortedBackups[0];

  // Compute next scheduled (2 AM tomorrow or today if before 2 AM)
  const nextScheduled = React.useMemo(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (now.getHours() >= 2) next.setDate(next.getDate() + 1);
    return next;
  }, []);

  const saveSettingsMutation = useMutation({
    mutationFn: async (newSettings) => {
      if (settingsList[0]) {
        return base44.entities.BackupSettings.update(settingsList[0].id, newSettings);
      }
      return base44.entities.BackupSettings.create({ ...newSettings, company_id: myCompany.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-settings'] });
      toast.success('Backup settings saved');
    },
    onError: (e) => toast.error(`Save failed: ${e.message}`),
  });

  const createBackupMutation = useMutation({
    mutationFn: async (name) => {
      const result = await base44.functions.invoke('createCompleteBackup', {
        companyId: myCompany.id,
        backupName: name || `Manual Backup - ${format(new Date(), 'MMM dd, yyyy h:mm a')}`
      });
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['complete-backups'] });
      setBackupName('');
      const recordCount = data?.data?.total_records ?? data?.total_records ?? 0;
      toast.success(`Backup created with ${recordCount} records!`);
    },
    onError: (error) => toast.error(`Backup failed: ${error.message}`)
  });

  const restoreBackupMutation = useMutation({
    mutationFn: async ({ backupId, deleteExistingData }) => {
      const result = await base44.functions.invoke('restoreFromCompleteBackup', {
        backupId,
        deleteExistingData
      });
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      setShowRestoreDialog(false);
      setSelectedBackup(null);
      const recordCount = data?.data?.total_restored ?? data?.total_restored ?? 0;
      toast.success(`Restored ${recordCount} records!`);
      setTimeout(() => window.location.reload(), 1500);
    },
    onError: (error) => toast.error(`Restore failed: ${error.message}`)
  });

  const deleteBackupMutation = useMutation({
    mutationFn: (backupId) => base44.entities.CompleteBackup.delete(backupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complete-backups'] });
      toast.success('Backup deleted');
    },
    onError: (e) => toast.error(`Delete failed: ${e.message}`),
  });

  const togglePinMutation = useMutation({
    mutationFn: async (backup) => {
      const newPinned = !backup.pinned;
      return base44.entities.CompleteBackup.update(backup.id, {
        pinned: newPinned,
        expires_at: newPinned ? null : expiryFromTypeAndSettings(backup.backup_type || 'daily', settings),
        expiry_warning_sent: false,
      });
    },
    onSuccess: (_, backup) => {
      queryClient.invalidateQueries({ queryKey: ['complete-backups'] });
      toast.success(backup.pinned ? 'Backup unpinned' : 'Backup pinned — never auto-deletes');
    },
    onError: (e) => toast.error(`Pin failed: ${e.message}`),
  });

  const handleDownloadBackup = async (backup) => {
    // The list only holds metadata — fetch this ONE backup's full payload now.
    let full = backup;
    if (!backup.backup_data) {
      try {
        full = await base44.entities.CompleteBackup.get(backup.id);
      } catch (err) {
        toast.error(`Could not fetch backup data: ${err.message}`);
        return;
      }
    }
    if (!full?.backup_data || Object.keys(full.backup_data).length === 0) {
      toast.error('This backup has no data attached — it may only exist in cloud storage. Contact support before deleting it.');
      return;
    }
    const exportData = {
      backup_name: full.backup_name,
      company_name: full.company_name,
      total_records: full.total_records,
      entity_counts: full.entity_counts,
      backup_data: full.backup_data,
      backup_type: full.backup_type,
      exported_at: new Date().toISOString(),
      version: '1.0'
    };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (full.backup_name || 'backup').replace(/[^a-z0-9]/gi, '_');
    a.download = `${safeName}_${format(new Date(full.created_date || backup.created_date), 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = async () => {
    if (sortedBackups.length === 0) {
      toast.error('No backups to download');
      return;
    }
    toast.info(`Preparing ${sortedBackups.length} backups... this can take a minute for large companies.`);
    // Download each as a separate file, fetched one at a time so we never pull
    // every multi-MB payload into memory at once.
    for (const backup of sortedBackups) {
      await handleDownloadBackup(backup);
      await new Promise(r => setTimeout(r, 250));
    }
    toast.success('All backups downloaded');
  };

  const handleUploadBackup = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      toast.error('Please select a .json backup file');
      return;
    }
    setIsUploading(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.backup_data && !data.entity_counts) {
        throw new Error('This does not appear to be a valid CompanySync backup file.');
      }
      const importedName = data.backup_name
        ? `${data.backup_name} (Uploaded)`
        : `Uploaded Backup - ${format(new Date(), 'MMM dd, yyyy h:mm a')}`;
      await base44.entities.CompleteBackup.create({
        backup_name: importedName,
        company_id: myCompany.id,
        company_name: myCompany.company_name,
        total_records: data.total_records || 0,
        entity_counts: data.entity_counts || {},
        backup_data: data.backup_data || {},
        backup_type: 'manual',
        pinned: true,
        expires_at: null,
        uploaded: true,
      });
      queryClient.invalidateQueries({ queryKey: ['complete-backups'] });
      toast.success(`Backup "${importedName}" uploaded! You can now restore from it.`);
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  if (!myCompany) {
    return (
      <div className="p-3 sm:p-6">
        <Alert>
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>Loading company data...</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-600" />
            Backup Manager
          </h1>
          <p className="text-gray-500 mt-1">Automatic backups, smart retention, and one-click restore</p>
        </div>
      </div>

      {/* Status Banner */}
      <Card className="border-2 border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {lastBackup ? (
                <CheckCircle className="w-8 h-8 text-green-600" />
              ) : (
                <AlertTriangle className="w-8 h-8 text-yellow-600" />
              )}
              <div>
                <div className="text-sm text-gray-600">Last backup</div>
                <div className="text-lg font-semibold" data-testid="text-last-backup">
                  {lastBackup
                    ? `${formatDistanceToNow(new Date(lastBackup.created_date))} ago`
                    : 'No backups yet'}
                </div>
                {lastBackup && (
                  <div className="text-xs text-gray-500">
                    {format(new Date(lastBackup.created_date), 'MMM dd, yyyy h:mm a')} · {lastBackup.total_records || 0} records
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <CalendarClock className="w-8 h-8 text-blue-600" />
              <div>
                <div className="text-sm text-gray-600">Next scheduled</div>
                <div className="text-lg font-semibold" data-testid="text-next-backup">
                  {format(nextScheduled, 'MMM dd, h:mm a')}
                </div>
                <div className="text-xs text-gray-500">Auto-runs daily at 2:00 AM</div>
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600">Company</div>
              <div className="text-lg font-semibold">{myCompany.company_name || 'CompanySync'}</div>
              <div className="text-xs text-gray-500">{backups.length} backups stored</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settings Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" />
            Auto-Backup Settings
          </CardTitle>
          <CardDescription>
            Daily backups run automatically at 2 AM. Old ones are auto-deleted on the schedule below — pinned and manual backups are kept forever.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Daily backup retention</Label>
              <Select
                value={String(settings.retention_days || 60)}
                onValueChange={(v) => saveSettingsMutation.mutate({ ...settings, retention_days: parseInt(v) })}
              >
                <SelectTrigger data-testid="select-retention-days">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETENTION_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">Daily backups older than this are auto-deleted.</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>Keep weekly snapshots</Label>
                <p className="text-xs text-gray-500">Sunday backups are kept for 6 months</p>
              </div>
              <Switch
                checked={settings.weekly_enabled !== false}
                onCheckedChange={(v) => saveSettingsMutation.mutate({ ...settings, weekly_enabled: v })}
                data-testid="switch-weekly-enabled"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Keep monthly snapshots</Label>
                <p className="text-xs text-gray-500">1st-of-month backups are kept for 2 years</p>
              </div>
              <Switch
                checked={settings.monthly_enabled !== false}
                onCheckedChange={(v) => saveSettingsMutation.mutate({ ...settings, monthly_enabled: v })}
                data-testid="switch-monthly-enabled"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Email backup notifications</Label>
                <p className="text-xs text-gray-500">Get an email each time a backup runs and 7 days before any backup is auto-deleted</p>
              </div>
              <Switch
                checked={settings.email_enabled !== false}
                onCheckedChange={(v) => saveSettingsMutation.mutate({ ...settings, email_enabled: v })}
                data-testid="switch-email-enabled"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Manual Create */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            Create Manual Backup
          </CardTitle>
          <CardDescription>
            Manual backups are pinned by default and never auto-delete. Great to run before risky changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Backup Name (optional)</Label>
            <Input
              placeholder={`Manual Backup - ${format(new Date(), 'MMM dd, yyyy h:mm a')}`}
              value={backupName}
              onChange={(e) => setBackupName(e.target.value)}
              data-testid="input-backup-name"
            />
          </div>
          <Button
            onClick={() => createBackupMutation.mutate(backupName)}
            disabled={createBackupMutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700"
            size="lg"
            data-testid="button-create-backup"
          >
            {createBackupMutation.isPending ? (
              <><Clock className="w-5 h-5 mr-2 animate-spin" />Creating Backup...</>
            ) : (
              <><Download className="w-5 h-5 mr-2" />Create Backup Now</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="w-5 h-5" />
            Upload Backup File
          </CardTitle>
          <CardDescription>Import a previously exported backup (.json) to restore your data</CardDescription>
        </CardHeader>
        <CardContent>
          <input
            type="file"
            accept=".json"
            ref={uploadInputRef}
            onChange={handleUploadBackup}
            className="hidden"
            data-testid="input-upload-backup"
          />
          <Button
            variant="outline"
            onClick={() => uploadInputRef.current?.click()}
            disabled={isUploading}
            className="w-full border-dashed border-2 h-16 text-gray-600 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50"
            data-testid="button-upload-backup"
          >
            {isUploading ? (
              <><Clock className="w-5 h-5 mr-2 animate-spin" />Uploading...</>
            ) : (
              <><FileUp className="w-5 h-5 mr-2" />Click to Select Backup File (.json)</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Backup History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Backup History ({backups.length})
            </CardTitle>
            <CardDescription>Pin important backups so they're never auto-deleted</CardDescription>
          </div>
          {sortedBackups.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadAll}
              data-testid="button-download-all-backups"
            >
              <Download className="w-4 h-4 mr-1" />
              Download All
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {backupsLoadFailed ? (
            <div className="text-center py-8 text-amber-600" data-testid="text-backups-load-error">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-amber-400" />
              <p className="font-medium">Couldn't load your backup list.</p>
              <p className="text-sm text-gray-500 mt-1">Your backups are still safe — this is only a display problem. Try refreshing the page.</p>
            </div>
          ) : sortedBackups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Database className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No backups yet. Daily backups will appear here automatically at 2 AM.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedBackups.map(backup => {
                const type = backup.backup_type || 'manual';
                const typeStyle = TYPE_BADGE_STYLE[type] || TYPE_BADGE_STYLE.manual;
                const records = backup.total_records ?? Object.values(backup.entity_counts || {}).reduce((s, c) => s + c, 0);
                return (
                  <div key={backup.id} className="flex items-center justify-between p-4 border rounded-lg bg-gray-50" data-testid={`row-backup-${backup.id}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{backup.backup_name}</h3>
                        <Badge className={`border ${typeStyle}`} variant="outline">
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </Badge>
                        {backup.pinned && (
                          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 border" variant="outline">
                            <Pin className="w-3 h-3 mr-1" />Pinned
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-gray-600 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(backup.created_date), 'MMM dd, yyyy h:mm a')}
                        </span>
                        <Badge variant="outline">{records} records</Badge>
                        {backup.expires_at && !backup.pinned && (
                          <span className="text-xs text-orange-600">
                            Auto-deletes {format(new Date(backup.expires_at), 'MMM dd, yyyy')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => togglePinMutation.mutate(backup)}
                        disabled={togglePinMutation.isPending}
                        className={backup.pinned ? 'text-gray-600' : 'text-yellow-700 border-yellow-400 hover:bg-yellow-50'}
                        data-testid={`button-pin-backup-${backup.id}`}
                        title={backup.pinned ? 'Unpin (will follow auto-delete schedule)' : 'Pin (never auto-delete)'}
                      >
                        {backup.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownloadBackup(backup)}
                        className="text-blue-600 border-blue-300 hover:bg-blue-50"
                        data-testid={`button-download-backup-${backup.id}`}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setSelectedBackup(backup); setShowRestoreDialog(true); }}
                        className="text-green-600 border-green-600 hover:bg-green-50"
                        data-testid={`button-restore-backup-${backup.id}`}
                      >
                        <Upload className="w-4 h-4 mr-1" />
                        Restore
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (window.confirm(`Delete backup "${backup.backup_name}"? This cannot be undone.`)) {
                            deleteBackupMutation.mutate(backup.id);
                          }
                        }}
                        className="text-red-600 border-red-600 hover:bg-red-50"
                        data-testid={`button-delete-backup-${backup.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
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
          <Alert className="bg-blue-50 border-blue-200">
            <AlertTriangle className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              By default this <strong>merges</strong> the backup into your current data — existing
              records are updated and missing ones are added. Nothing is deleted unless you check
              the box below.
            </AlertDescription>
          </Alert>
          <div className="flex items-start space-x-2 py-4">
            <input
              type="checkbox"
              id="delete-existing"
              checked={deleteExisting}
              onChange={(e) => setDeleteExisting(e.target.checked)}
              className="w-4 h-4 mt-1"
              data-testid="checkbox-delete-existing"
            />
            <Label htmlFor="delete-existing" className="cursor-pointer">
              <span className="text-red-700 font-semibold">Delete existing data first</span>
              <span className="block text-xs text-gray-500 font-normal">
                Danger: permanently removes current records for the types in this backup before restoring. Leave unchecked to merge safely.
              </span>
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRestoreDialog(false)} data-testid="button-cancel-restore">
              Cancel
            </Button>
            <Button
              onClick={() => selectedBackup && restoreBackupMutation.mutate({ backupId: selectedBackup.id, deleteExistingData: deleteExisting })}
              disabled={restoreBackupMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
              data-testid="button-confirm-restore"
            >
              {restoreBackupMutation.isPending ? (
                <><Clock className="w-4 h-4 mr-2 animate-spin" />Restoring...</>
              ) : (
                <><CheckCircle className="w-4 h-4 mr-2" />Confirm Restore</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
