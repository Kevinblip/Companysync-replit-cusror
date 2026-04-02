import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Sparkles, ArrowLeft, Facebook, Instagram, Video, MapPin, Wrench, MessageSquare, Plus, Trash2, Glasses, Search, CloudLightning, Users, Camera, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const iconOptions = {
  Sparkles, Facebook, Instagram, Video, MapPin, Wrench, MessageSquare, Glasses, Search, CloudLightning, Users, Camera, BarChart3
};

const defaultFeatures = [
  { name: "Facebook Lead Ads", icon: "Facebook", color: "bg-blue-600", description: "Auto-capture leads from Facebook ads directly into CRM", category: "Marketing" },
  { name: "Facebook Pages", icon: "Facebook", color: "bg-blue-500", description: "Manage messages and comments from Facebook Pages", category: "Marketing" },
  { name: "Instagram Business", icon: "Instagram", color: "from-purple-500 to-pink-500", description: "Sync DMs and comments to your CRM automatically", category: "Marketing" },
  { name: "TikTok Lead Ads", icon: "Video", color: "bg-black", description: "Capture TikTok ad leads in real-time", category: "Marketing" },
  { name: "Google My Business", icon: "MapPin", color: "bg-green-600", description: "Review monitoring and automated responses", category: "Marketing" },
  { name: "Google Chat", icon: "MessageSquare", color: "bg-blue-500", description: "Send notifications and updates to Google Chat spaces", category: "Communication" },
  { name: "ABC Supply", icon: "Wrench", color: "bg-orange-600", description: "One-click material ordering from estimates", category: "Materials" },
  { name: "SRS Distribution", icon: "Wrench", color: "bg-blue-600", description: "Direct ordering integration with SRS", category: "Materials" },
  { name: "Beacon Building Products", icon: "Wrench", color: "bg-red-600", description: "Material ordering from Beacon", category: "Materials" },
  { name: "Symbility Integration", icon: "Sparkles", color: "bg-purple-600", description: "Bi-directional claims and estimate sync", category: "Insurance" }
];

const colorOptions = [
  { value: "bg-blue-600", label: "Blue" },
  { value: "bg-green-600", label: "Green" },
  { value: "bg-red-600", label: "Red" },
  { value: "bg-purple-600", label: "Purple" },
  { value: "bg-orange-600", label: "Orange" },
  { value: "bg-black", label: "Black" },
  { value: "bg-gray-600", label: "Gray" },
];

export default function ComingSoon({ 
  title = "Coming Soon", 
  description = "This feature is currently under development and will be available soon.",
  showBackButton = true 
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newFeature, setNewFeature] = useState({ name: '', description: '', icon: 'Sparkles', color: 'bg-blue-600', category: 'Feature' });

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  const myCompany = React.useMemo(() => {
    if (!user) return null;
    const ownedCompany = companies.find(c => c.created_by === user.email);
    if (ownedCompany) return ownedCompany;
    const staffProfile = staffProfiles[0];
    if (staffProfile?.company_id) {
      return companies.find(c => c.id === staffProfile.company_id);
    }
    return null;
  }, [user, companies, staffProfiles]);

  const isAdmin = myCompany?.created_by === user?.email || user?.platform_role === 'super_admin';

  const { data: menuSettings = [] } = useQuery({
    queryKey: ['menu-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.MenuSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const currentSettings = menuSettings[0];
  const customFeatures = currentSettings?.coming_soon_features || [];
  const upcomingFeatures = customFeatures.length > 0 ? customFeatures : defaultFeatures;

  const saveMutation = useMutation({
    mutationFn: async (features) => {
      if (currentSettings) {
        return base44.entities.MenuSettings.update(currentSettings.id, { coming_soon_features: features });
      } else if (myCompany) {
        return base44.entities.MenuSettings.create({ company_id: myCompany.id, coming_soon_features: features });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-settings', myCompany?.id] });
      setShowAddDialog(false);
      setNewFeature({ name: '', description: '', icon: 'Sparkles', color: 'bg-blue-600', category: 'Feature' });
    }
  });

  const handleAdd = () => {
    if (!newFeature.name) return;
    const features = [...upcomingFeatures, newFeature];
    saveMutation.mutate(features);
  };

  const handleDelete = (idx) => {
    const features = upcomingFeatures.filter((_, i) => i !== idx);
    saveMutation.mutate(features);
  };

  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-blue-50 to-purple-50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
          
          <h1 className="text-4xl font-bold text-gray-900 mb-4">{title}</h1>
          <p className="text-gray-600 mb-6">{description}</p>
          
          <div className="flex gap-2 justify-center">
            {showBackButton && (
              <Button 
                onClick={() => navigate(createPageUrl('Dashboard'))}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            )}
            
            {isAdmin && (
              <Button 
                onClick={() => setShowAddDialog(true)}
                variant="outline"
                className="border-purple-300 text-purple-700 hover:bg-purple-50"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Feature
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-12">
          {upcomingFeatures.map((feature, idx) => {
            const Icon = typeof feature.icon === 'string' ? iconOptions[feature.icon] || Sparkles : feature.icon;
            const colorClass = feature.color?.startsWith('from-') 
              ? `bg-gradient-to-r ${feature.color}` 
              : feature.color || 'bg-blue-600';

            return (
              <Card key={idx} className="hover:shadow-lg transition-shadow relative group">
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-700 hover:bg-red-50"
                    onClick={() => handleDelete(idx)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div className={`w-12 h-12 ${colorClass} rounded-lg flex items-center justify-center text-white flex-shrink-0`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-lg">{feature.name}</CardTitle>
                      <Badge className="mt-1 bg-purple-100 text-purple-700 text-xs">
                        {feature.category}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">{feature.description}</CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Coming Soon Feature</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Feature Name</label>
              <Input 
                value={newFeature.name} 
                onChange={(e) => setNewFeature({ ...newFeature, name: e.target.value })}
                placeholder="e.g., Smart Glasses"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea 
                value={newFeature.description} 
                onChange={(e) => setNewFeature({ ...newFeature, description: e.target.value })}
                placeholder="What does this feature do?"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Category</label>
              <Input 
                value={newFeature.category} 
                onChange={(e) => setNewFeature({ ...newFeature, category: e.target.value })}
                placeholder="e.g., Operations, Marketing"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Icon</label>
                <Select value={newFeature.icon} onValueChange={(v) => setNewFeature({ ...newFeature, icon: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(iconOptions).map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Color</label>
                <Select value={newFeature.color} onValueChange={(v) => setNewFeature({ ...newFeature, color: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {colorOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!newFeature.name || saveMutation.isPending}>
              {saveMutation.isPending ? 'Adding...' : 'Add Feature'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}