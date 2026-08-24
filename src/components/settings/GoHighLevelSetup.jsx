import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from "lucide-react";

function formatSyncTime(value) {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function GoHighLevelSetup({ companyId, compact = false }) {
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [pushNewLeads, setPushNewLeads] = useState(true);
  const [importContacts, setImportContacts] = useState(true);
  const [formError, setFormError] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ["ghl-status", companyId],
    queryFn: async () => {
      const response = await base44.functions.invoke("getGHLStatus", { company_id: companyId });
      return response.data || response;
    },
    enabled: !!companyId,
  });

  useEffect(() => {
    if (status?.location_id) setLocationId(status.location_id);
    if (status?.push_new_leads !== undefined) setPushNewLeads(status.push_new_leads !== false);
    if (status?.import_contacts !== undefined) setImportContacts(status.import_contacts !== false);
  }, [status?.location_id, status?.push_new_leads, status?.import_contacts]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke("saveGHLSettings", {
        company_id: companyId,
        location_id: locationId.trim(),
        api_key: apiKey.trim() || undefined,
        push_new_leads: pushNewLeads,
        import_contacts: importContacts,
        is_enabled: true,
      });
      const data = response.data || response;
      if (data?.success === false) throw new Error(data.error || "Failed to save GoHighLevel settings");
      return data;
    },
    onSuccess: (data) => {
      setApiKey("");
      setFormError(null);
      setSyncResult(null);
      queryClient.setQueryData(["ghl-status", companyId], data);
      queryClient.invalidateQueries({ queryKey: ["ghl-status"] });
    },
    onError: (err) => setFormError(err.message),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke("syncGHLContacts", { company_id: companyId });
      const data = response.data || response;
      if (data?.success === false) throw new Error(data.error || "Sync failed");
      return data;
    },
    onSuccess: (data) => {
      setSyncResult(data);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["ghl-status"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (err) => setFormError(err.message),
  });

  if (!companyId) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Company context is required before GoHighLevel can be configured.</AlertDescription>
      </Alert>
    );
  }

  const connected = !!status?.connected;

  return (
    <div className="space-y-5" data-testid="ghl-setup">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900">Connection status</p>
          <p className="text-sm text-gray-500">
            Last sync: {formatSyncTime(status?.last_sync_at)}
            {status?.location_name ? ` · ${status.location_name}` : ""}
          </p>
        </div>
        {isLoading ? (
          <Badge className="bg-gray-100 text-gray-600">Checking…</Badge>
        ) : connected ? (
          <Badge className="bg-green-100 text-green-700" data-testid="ghl-status-connected">Connected</Badge>
        ) : (
          <Badge className="bg-gray-100 text-gray-600" data-testid="ghl-status-disconnected">Not Connected</Badge>
        )}
      </div>

      {status?.last_sync_error && (
        <Alert className="bg-red-50 border-red-200">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            Last sync error: {status.last_sync_error}
          </AlertDescription>
        </Alert>
      )}

      <Alert className="bg-orange-50 border-orange-200">
        <AlertDescription className="text-orange-900 text-sm space-y-2">
          <p>
            Create a <strong>Private Integration</strong> in GoHighLevel (Settings → Integrations → Private Integrations)
            with contacts and location scopes. Copy the Location ID from Settings → Business Profile
            (or the <code className="bg-white px-1 rounded">/location/…</code> segment in the GHL URL).
          </p>
          <a
            href="https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            Official HighLevel Private Integration docs <ExternalLink className="w-3 h-3" />
          </a>
        </AlertDescription>
      </Alert>

      <div className="space-y-3">
        <div>
          <Label htmlFor="ghl-location-id">Location ID</Label>
          <Input
            id="ghl-location-id"
            data-testid="input-ghl-location-id"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            placeholder="e.g. ve9EPM428h8vShlRW1KT"
            className="mt-1 font-mono"
          />
        </div>
        <div>
          <Label htmlFor="ghl-api-key">Private Integration token / API key</Label>
          <Input
            id="ghl-api-key"
            data-testid="input-ghl-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status?.has_api_key ? `Saved token ${status.api_key_masked} — paste a new one to replace` : "Paste your GHL Private Integration token"}
            className="mt-1 font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">
            Stored with the same company-secret pattern as Twilio. The full token is never shown again after save.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div>
            <p className="font-medium text-gray-900">Import GHL contacts as leads</p>
            <p className="text-sm text-gray-500">GHL → CompanySync</p>
          </div>
          <Switch checked={importContacts} onCheckedChange={setImportContacts} data-testid="switch-ghl-import" />
        </div>
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div>
            <p className="font-medium text-gray-900">Push new CompanySync leads</p>
            <p className="text-sm text-gray-500">CompanySync → GHL (leads without a GHL contact id)</p>
          </div>
          <Switch checked={pushNewLeads} onCheckedChange={setPushNewLeads} data-testid="switch-ghl-push" />
        </div>
      </div>

      {formError && (
        <Alert className="bg-red-50 border-red-200">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">{formError}</AlertDescription>
        </Alert>
      )}

      {saveMutation.isSuccess && !formError && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">Settings saved and connection verified.</AlertDescription>
        </Alert>
      )}

      {syncResult?.success && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 space-y-1">
            <p className="font-medium">Sync finished</p>
            <p className="text-sm">{syncResult.message}</p>
          </AlertDescription>
        </Alert>
      )}

      <div className={`flex flex-wrap gap-3 ${compact ? "" : "pt-2"}`}>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !locationId.trim() || (!apiKey.trim() && !status?.has_api_key)}
          className="bg-orange-600 hover:bg-orange-700"
          data-testid="button-ghl-save"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
          Save &amp; verify
        </Button>
        <Button
          variant="outline"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || !connected}
          data-testid="button-ghl-sync"
        >
          {syncMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Sync now
        </Button>
        <Button variant="ghost" onClick={() => refetch()} disabled={isLoading}>
          Refresh status
        </Button>
      </div>
    </div>
  );
}
