import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Inbox, Send, Archive, Trash2, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import useTranslation from "@/hooks/useTranslation";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";

export default function Mailbox() {
  const { t } = useTranslation();
  const { isAdmin, hasPermission, isPermissionsReady } = useRoleBasedData();

  // 🔐 Gate: only users with communication_hub view access may use this page
  const canView = !isPermissionsReady || isAdmin || hasPermission('communication_hub', 'view');
  // 🔐 Gate: only users with communication_hub create access may compose messages
  const canCompose = isAdmin || hasPermission('communication_hub', 'create');

  if (isPermissionsReady && !canView) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <Mail className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500">You don't have permission to view the mailbox.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.mailbox}</h1>
          <p className="text-gray-500 mt-1">{t.communication.emailThreads}</p>
        </div>
        {canCompose && (
          <Button className="bg-blue-600 hover:bg-blue-700" data-testid="button-compose-message">
            <Mail className="w-4 h-4" />
            {t.communication.newMessage}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="hover-elevate cursor-pointer overflow-visible">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Inbox className="w-5 h-5 text-blue-600" />
              <span className="font-medium">{t.communication.inbound}</span>
            </div>
            <Badge variant="default" className="ml-auto">0</Badge>
          </CardContent>
        </Card>

        <Card className="hover-elevate cursor-pointer overflow-visible">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Send className="w-5 h-5 text-green-600" />
              <span className="font-medium">{t.communication.outbound}</span>
            </div>
            <Badge variant="outline" className="ml-auto">0</Badge>
          </CardContent>
        </Card>

        <Card className="hover-elevate cursor-pointer overflow-visible">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Star className="w-5 h-5 text-yellow-600" />
              <span className="font-medium">{t.common.starred || "Starred"}</span>
            </div>
            <Badge variant="outline" className="ml-auto">0</Badge>
          </CardContent>
        </Card>

        <Card className="hover-elevate cursor-pointer overflow-visible">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Archive className="w-5 h-5 text-purple-600" />
              <span className="font-medium">{t.sidebar.archive || "Archive"}</span>
            </div>
            <Badge variant="outline" className="ml-auto">0</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2 flex-wrap">
          <CardTitle>{t.communication.inbound}</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-12 text-gray-500">
          <Mail className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p>{t.communication.noMessages}</p>
          <p className="text-sm mt-1">Connect your email account in {t.settings.integrations}</p>
        </CardContent>
      </Card>
    </div>
  );
}
