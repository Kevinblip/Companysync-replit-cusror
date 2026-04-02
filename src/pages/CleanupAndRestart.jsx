import React, { useState, useEffect } from 'react';
import { isPlatformAdminCheck } from '@/hooks/usePlatformAdmin';
import { useMutation, useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Trash2, AlertTriangle, CheckCircle, Rocket, 
  Database, Building2, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function CleanupAndRestart() {
  const [user, setUser] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const navigate = useNavigate();

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [], isFetched: companiesFetched } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list(),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);
  const isPlatformOwner = isPlatformAdminCheck(user, myCompany, null);

  useEffect(() => {
    if (user && companiesFetched && !isPlatformOwner) {
      navigate(createPageUrl('Dashboard'), { replace: true });
    }
  }, [user, companiesFetched, isPlatformOwner, navigate]);

  const legacyCompanies = companies.filter(c => 
    c.company_name?.toLowerCase().includes('yicn') || 
    c.company_name?.toLowerCase().includes('roofing')
  );

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const result = await base44.functions.invoke('cleanupYICNAndCreateSaaS', {});
      return result.data;
    },
    onSuccess: (data) => {
      toast.success('Cleanup complete! CompanySync is ready.');
      setTimeout(() => {
        window.location.href = createPageUrl('Dashboard');
      }, 2000);
    },
    onError: (error) => {
      toast.error(`Cleanup failed: ${error.message}`);
    }
  });

  if (!user || !companiesFetched) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!isPlatformOwner) {
    return null;
  }

  const handleCleanup = () => {
    if (confirmText !== 'DELETE LEGACY') {
      toast.error('Please type "DELETE LEGACY" to confirm');
      return;
    }
    cleanupMutation.mutate();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-red-500 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
          <Trash2 className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold">Clean Slate Setup</h1>
        <p className="text-gray-500 mt-2">Delete legacy data and start fresh with CompanySync</p>
      </div>

      <Alert className="bg-red-50 border-red-200">
        <AlertTriangle className="w-4 h-4 text-red-600" />
        <AlertDescription className="text-red-900">
          <strong>⚠️ CRITICAL WARNING:</strong> This action will permanently delete ALL legacy data 
          including customers, invoices, staff, expenses, and transactions. This cannot be undone.
          <br/><br/>
          <strong>Before proceeding:</strong> Go to <strong>Backup Manager</strong> and create a complete backup!
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            What Will Be Deleted
          </CardTitle>
          <CardDescription>
            Found {legacyCompanies.length} legacy company record(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {legacyCompanies.map(company => (
              <div key={company.id} className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
                <div>
                  <p className="font-medium">{company.company_name}</p>
                  <p className="text-sm text-gray-500">ID: {company.id}</p>
                </div>
                <Trash2 className="w-4 h-4 text-red-600" />
              </div>
            ))}
          </div>
          
          <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-1 text-sm">
            <p>✅ All customers and leads</p>
            <p>✅ All invoices and estimates</p>
            <p>✅ All payments and expenses</p>
            <p>✅ All tasks and projects</p>
            <p>✅ All staff profiles</p>
            <p>✅ All accounting transactions</p>
            <p>✅ All documents and contracts</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-green-200 bg-green-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="w-5 h-5 text-green-600" />
            What Will Be Created
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Building2 className="w-5 h-5 text-green-600 mt-1" />
              <div>
                <p className="font-medium">CompanySync SaaS Platform</p>
                <p className="text-sm text-gray-600">Your new multi-tenant business management platform</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 mt-1" />
              <div>
                <p className="font-medium">Admin Access</p>
                <p className="text-sm text-gray-600">You'll be set as the super admin with full permissions</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 mt-1" />
              <div>
                <p className="font-medium">Enterprise Plan</p>
                <p className="text-sm text-gray-600">All features enabled for your SaaS platform</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Confirm Deletion</CardTitle>
          <CardDescription>Type "DELETE LEGACY" to proceed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE LEGACY"
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
          />

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => navigate(createPageUrl('Dashboard'))}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCleanup}
              disabled={confirmText !== 'DELETE LEGACY' || cleanupMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            >
              {cleanupMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cleaning Up...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Legacy & Create CompanySync
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Alert className="bg-blue-50 border-blue-200">
        <AlertDescription className="text-blue-900">
          <strong>💡 Next Steps:</strong> After cleanup completes, you'll be redirected to your fresh 
          CompanySync dashboard. You can then invite new subscribers with lifetime access.
        </AlertDescription>
      </Alert>
    </div>
  );
}