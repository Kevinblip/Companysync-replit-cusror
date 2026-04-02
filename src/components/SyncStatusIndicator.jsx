import { useState, useEffect } from 'react';
import { Database, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export default function SyncStatusIndicator({ syncStatus, lastSynced, compact = false }) {
  const [dbHealth, setDbHealth] = useState(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch('/api/local/health');
        if (response.ok) {
          const data = await response.json();
          setDbHealth(data.success ? 'connected' : 'error');
        } else {
          setDbHealth('error');
        }
      } catch {
        setDbHealth('error');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${dbHealth === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
              <Database className="w-3 h-3 text-gray-400" />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Local DB: {dbHealth === 'connected' ? 'Connected' : 'Disconnected'}</p>
            {lastSynced && <p>Last sync: {new Date(lastSynced).toLocaleTimeString()}</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {syncStatus === 'syncing' && (
        <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">
          <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
          Syncing
        </Badge>
      )}
      {syncStatus === 'synced' && (
        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Synced
        </Badge>
      )}
      {syncStatus === 'error' && (
        <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
          <AlertCircle className="w-3 h-3 mr-1" />
          Sync Error
        </Badge>
      )}
      {dbHealth === 'connected' && (
        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
          <Database className="w-3 h-3 mr-1" />
          DB Connected
        </Badge>
      )}
    </div>
  );
}
