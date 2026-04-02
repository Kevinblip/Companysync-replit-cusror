import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  PlayCircle, CheckCircle2, XCircle, AlertTriangle, 
  Mail, MessageCircle, Bell, Settings, Loader2 
} from 'lucide-react';
import { toast } from 'sonner';

export default function NotificationDiagnostics() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);
  const [user, setUser] = useState(null);

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const runDiagnostics = async () => {
    setRunning(true);
    setReport(null);
    
    try {
      const result = await base44.functions.invoke('diagnoseNotifications');
      
      if (result.data.success) {
        setReport(result.data.report);
        toast.success('Diagnostic complete!');
      } else {
        toast.error('Diagnostic failed');
      }
    } catch (error) {
      toast.error('Failed to run diagnostics: ' + error.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">Notification System Diagnostics</h1>
        <p className="text-gray-600 mt-1">Test and verify email/SMS automation setup</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run Diagnostic Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            This will test your email and SMS notification systems, check configurations, 
            and send test messages to your account.
          </p>
          <Button
            onClick={runDiagnostics}
            disabled={running}
            size="lg"
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {running ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Running Diagnostics...
              </>
            ) : (
              <>
                <PlayCircle className="w-5 h-5 mr-2" />
                Start Diagnostic Test
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {report && (
        <>
          <Alert className={report.summary.critical_errors > 0 ? 'border-red-500 bg-red-50' : 'border-green-500 bg-green-50'}>
            <AlertDescription>
              <div className="flex items-center gap-2">
                {report.summary.critical_errors > 0 ? (
                  <XCircle className="w-5 h-5 text-red-600" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                )}
                <span className="font-bold text-lg">{report.summary.status}</span>
              </div>
              {report.summary.critical_errors > 0 && (
                <p className="mt-2 text-sm">
                  {report.summary.critical_errors} critical error(s), {report.summary.warnings} warning(s)
                </p>
              )}
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email System
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Configuration</span>
                    {report.checks.resend_configured ? (
                      <Badge className="bg-green-600">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Not Setup</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Test Result</span>
                    {report.checks.email_test?.includes('✅') ? (
                      <Badge className="bg-green-600">Passed</Badge>
                    ) : report.checks.email_test?.includes('❌') ? (
                      <Badge variant="destructive">Failed</Badge>
                    ) : (
                      <Badge variant="outline">Skipped</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">24h Activity</span>
                    <Badge variant="outline">{report.checks.emails_sent_24h} sent</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  SMS System
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Configuration</span>
                    {report.checks.twilio_configured ? (
                      <Badge className="bg-green-600">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Not Setup</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Test Result</span>
                    {report.checks.sms_test?.includes('✅') ? (
                      <Badge className="bg-green-600">Passed</Badge>
                    ) : report.checks.sms_test?.includes('❌') ? (
                      <Badge variant="destructive">Failed</Badge>
                    ) : (
                      <Badge variant="outline">Skipped</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">24h Activity</span>
                    <Badge variant="outline">{report.checks.sms_sent_24h} sent</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bell className="w-4 h-4" />
                  Workflows
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Active Workflows</span>
                    <Badge variant="outline">{report.checks.active_workflows}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Staff Members</span>
                    <Badge variant="outline">{report.checks.total_staff}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Admins</span>
                    <Badge variant="outline">{report.checks.admin_count}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {report.errors.length > 0 && (
            <Card className="border-red-200 bg-red-50">
              <CardHeader>
                <CardTitle className="text-red-900">Issues Detected</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {report.errors.map((error, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-red-900">{error}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Detailed Test Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(report.checks).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between py-2 border-b">
                    <span className="text-sm font-medium capitalize">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm text-gray-600">
                      {typeof value === 'boolean' ? (
                        value ? (
                          <Badge className="bg-green-600">Yes</Badge>
                        ) : (
                          <Badge variant="destructive">No</Badge>
                        )
                      ) : Array.isArray(value) ? (
                        value.length > 0 ? value.join(', ') : 'None'
                      ) : (
                        String(value)
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {report.checks.email_test?.includes('✅') && user && (
            <Alert className="border-green-500 bg-green-50">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                <strong>✅ Test email sent successfully!</strong> Check your inbox at {user.email}
              </AlertDescription>
            </Alert>
          )}

          {report.checks.sms_test?.includes('✅') && (
            <Alert className="border-green-500 bg-green-50">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                <strong>✅ Test SMS sent successfully!</strong> Check your phone at {report.checks.twilio_phone}
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}