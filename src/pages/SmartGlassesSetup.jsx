import React, { useState } from "react";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, CheckCircle, Mail, Camera, Upload, AlertCircle, ShoppingCart, Lock, ArrowRight, Zap, Glasses, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";

// Upsell Component
function SmartGlassesUpsell({ myCompany, user }) {
  const navigate = useNavigate();
  const [isOrdering, setIsOrdering] = useState(false);
  const [orderForm, setOrderForm] = useState({
    quantity: 1,
    notes: ""
  });

  const handleOrder = async () => {
    try {
      // Send email to admin
      await base44.functions.invoke("sendEmailWithResend", {
        to: "kevinstone@yicnteam.com", // Admin email
        subject: `🕶️ Smart Glasses Order Request - ${myCompany?.company_name}`,
        html: `
          <h1>New Smart Glasses Order Request</h1>
          <p><strong>Company:</strong> ${myCompany?.company_name} (ID: ${myCompany?.id})</p>
          <p><strong>User:</strong> ${user?.full_name} (${user?.email})</p>
          <p><strong>Quantity:</strong> ${orderForm.quantity}</p>
          <p><strong>Notes:</strong> ${orderForm.notes}</p>
        `
      });

      setIsOrdering(false);
      toast.success("Order request sent! We'll contact you shortly.");
    } catch (error) {
      toast.error("Failed to send order request");
      console.error(error);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-12">
      {/* Hero Section */}
      <div className="text-center space-y-6 py-12">
        <div className="mx-auto w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center shadow-lg mb-6">
          <Glasses className="w-12 h-12 text-white" />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-900 to-purple-900">
          Inspection of the Future
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          Equip your team with Ray-Ban Meta Smart Glasses. Capture hands-free photos and videos that instantly sync to your CRM.
        </p>
        <div className="flex justify-center gap-4 pt-4">
          <Dialog open={isOrdering} onOpenChange={setIsOrdering}>
            <DialogTrigger asChild>
              <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:opacity-90 shadow-lg text-lg px-8 h-12 rounded-full">
                Order Glasses
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Order Ray-Ban Meta Smart Glasses</DialogTitle>
                <DialogDescription>
                  We'll prepare a quote and contact you to finalize the order.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input 
                    type="number" 
                    min="1"
                    value={orderForm.quantity}
                    onChange={(e) => setOrderForm({...orderForm, quantity: parseInt(e.target.value)})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Additional Notes / Shipping Address</Label>
                  <Textarea 
                    placeholder="Enter shipping details or special requests..."
                    value={orderForm.notes}
                    onChange={(e) => setOrderForm({...orderForm, notes: e.target.value})}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOrdering(false)}>Cancel</Button>
                <Button onClick={handleOrder} className="bg-blue-600 text-white">Submit Request</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          
          <Button size="lg" variant="outline" className="text-lg px-8 h-12 rounded-full" onClick={() => navigate(createPageUrl('Pricing'))}>
             Upgrade Plan
          </Button>
        </div>
      </div>

      {/* Benefits Grid */}
      <div className="grid md:grid-cols-3 gap-8">
        <Card className="border-none shadow-md hover:shadow-xl transition-shadow bg-gradient-to-br from-white to-blue-50">
          <CardHeader>
            <Camera className="w-10 h-10 text-blue-600 mb-2" />
            <CardTitle>Hands-Free Capture</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">Inspect roofs safely with both hands free. Just say "Hey Meta, take a photo" to capture high-res evidence.</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-md hover:shadow-xl transition-shadow bg-gradient-to-br from-white to-purple-50">
          <CardHeader>
            <Zap className="w-10 h-10 text-purple-600 mb-2" />
            <CardTitle>Instant Sync</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">Photos automatically upload to the CRM and link to the correct customer job instantly.</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-md hover:shadow-xl transition-shadow bg-gradient-to-br from-white to-indigo-50">
          <CardHeader>
            <CheckCircle className="w-10 h-10 text-indigo-600 mb-2" />
            <CardTitle>Professional Proof</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">Give homeowners and adjusters undeniable, timestamped visual proof without climbing down the ladder.</p>
          </CardContent>
        </Card>
      </div>

      {/* Feature Gating Notice */}
      <Alert className="bg-gray-900 border-gray-800 text-white">
        <Lock className="w-5 h-5 text-yellow-400" />
        <AlertDescription className="ml-2 flex items-center justify-between w-full">
          <span>This feature is available on <strong>Business</strong> and <strong>Enterprise</strong> plans.</span>
          <Button variant="link" className="text-yellow-400 hover:text-yellow-300 p-0 h-auto" onClick={() => navigate(createPageUrl('Pricing'))}>
            Upgrade to Unlock <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}

export default function SmartGlassesSetup() {
  const [user, setUser] = useState(null);
  const [copied, setCopied] = useState(false);
  const [domain, setDomain] = useState('crewcam.com');

  const [alias, setAlias] = useState('');
  const [isEditingAlias, setIsEditingAlias] = useState(false);
  const [isSavingAlias, setIsSavingAlias] = useState(false);

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    // Force crewcam.com as requested
    setDomain('crewcam.com');
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date", 50),
    initialData: [],
  });



  const myCompany = React.useMemo(() => {
    return companies.find(c => c.created_by === user?.email) || companies[0];
  }, [companies, user]);

  // Fetch recent uploads
  const { data: recentUploads = [], refetch: refetchUploads } = useQuery({
    queryKey: ['smart-glasses-uploads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.JobMedia.filter({ 
      company_id: myCompany.id, 
      source: 'smart_glasses',
      is_deleted: { $ne: true }
    }, "-created_date", 12) : [],
    enabled: !!myCompany,
    refetchInterval: 5000, // Poll every 5s to see new uploads instantly
  });

  React.useEffect(() => {
    if (myCompany?.smart_glasses_alias) {
      setAlias(myCompany.smart_glasses_alias);
    }
  }, [myCompany]);

  // Logic to check access
  const hasAccess = React.useMemo(() => {
    if (!myCompany) return false;
    
    // Explicitly enabled via settings
    if (myCompany.settings?.enable_smart_glasses_integration) return true;
    
    // Plan based access
    const plan = myCompany.subscription_plan || 'trial';
    // Access for Business (professional) and Enterprise
    // Also include trial for now if you want them to test it? Or maybe force upgrade?
    // Let's go with user request: "Upgrade" implies gating.
    // Assuming 'professional' = Business tier based on Layout.js logic
    const allowedPlans = ['professional', 'enterprise'];
    
    // Check if platform admin company
    if (isPlatformAdminCheck(null, myCompany, null)) return true;

    return allowedPlans.includes(plan);
  }, [myCompany]);

  // Loading state
  if (!user || !myCompany) return <div className="p-12 text-center text-gray-500">Loading...</div>;

  // Show Upsell if no access
  if (!hasAccess) {
    return <SmartGlassesUpsell myCompany={myCompany} user={user} />;
  }

  // --- EXISTING SETUP CONTENT (Access Granted) ---
  
  // Use alias if available, otherwise fall back to ID
  const emailIdentifier = myCompany?.smart_glasses_alias || myCompany?.id;
  // Always use "photos-" prefix to ensure email routing works correctly
  const prefix = 'photos-';
  const smartGlassesEmail = emailIdentifier ? `${prefix}${emailIdentifier}@${domain}` : null;

  const handleSaveAlias = async (valueOverride) => {
    const valueToSave = typeof valueOverride === 'string' ? valueOverride : alias;
    if (!valueToSave?.trim()) return;
    
    // Simple validation: alphanumeric, hyphens only
    const cleanAlias = valueToSave.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    
    if (cleanAlias.length < 3) {
      toast.error("Alias must be at least 3 characters");
      return;
    }

    setIsSavingAlias(true);
    try {
      await base44.entities.Company.update(myCompany.id, {
        smart_glasses_alias: cleanAlias
      });
      
      toast.success("Email alias updated!");
      setIsEditingAlias(false);
      
      // Refresh to show new email immediately
      setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      toast.error("Failed to update alias");
      console.error(error);
    } finally {
      setIsSavingAlias(false);
    }
  };

  const handleCopy = () => {
    if (smartGlassesEmail) {
      navigator.clipboard.writeText(smartGlassesEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-8 rounded-lg flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">📷 Smart Glasses Integration</h1>
          <p className="text-blue-100">
            Upload inspection photos instantly from Ray-Ban Meta smart glasses
          </p>
        </div>
        <div className="hidden md:block">
           <Glasses className="w-16 h-16 text-white/20" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Your Smart Glasses Email
          </CardTitle>
          <CardDescription>
            Use this email address to send photos from your smart glasses
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {smartGlassesEmail ? (
            <>
              <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-4 md:p-6 text-center overflow-hidden relative">
                {/* Visual helper for long emails */}
                <div className="text-lg md:text-2xl font-mono font-bold text-gray-900 mb-4 select-all">
                  {smartGlassesEmail && smartGlassesEmail.length > 35 ? (
                    <div className="flex flex-col items-center">
                      {!myCompany?.smart_glasses_alias && <span className="text-gray-500 text-sm md:text-base">photos-</span>}
                      <span className="bg-yellow-100 px-2 rounded break-all leading-tight my-1">
                        {emailIdentifier}
                      </span>
                      <span className="text-gray-500 text-sm md:text-base">@{domain}</span>
                    </div>
                  ) : (
                     <span className="break-all">{smartGlassesEmail}</span>
                  )}
                </div>
                
                <div className="flex flex-col md:flex-row gap-3 justify-center items-center">
                  <Button onClick={handleCopy} variant="outline" className="gap-2 w-full md:w-auto">
                    {copied ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy
                      </>
                    )}
                  </Button>
                  
                  {!myCompany?.smart_glasses_alias ? (
                    <Button 
                      onClick={() => {
                        const suggested = 'smartglasses';
                        handleSaveAlias(suggested);
                      }}
                      className="bg-blue-600 hover:bg-blue-700 w-full md:w-auto shadow-sm"
                    >
                      Use Short Email
                    </Button>
                  ) : (
                    <Button 
                      variant="ghost" 
                      onClick={() => setIsEditingAlias(true)}
                      className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 w-full md:w-auto"
                    >
                      Change Alias
                    </Button>
                  )}

                  <Dialog open={isEditingAlias} onOpenChange={setIsEditingAlias}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Customize Smart Glasses Email</DialogTitle>
                        <DialogDescription>
                          Create a shorter, easier to read email address for your smart glasses.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Email Alias</Label>
                          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded border">
                            <Input 
                              value={alias} 
                              onChange={(e) => setAlias(e.target.value)} 
                              placeholder="smartglasses"
                              className="font-mono border-0 bg-transparent focus-visible:ring-0 px-0 h-auto text-sm text-right"
                              autoFocus
                            />
                            <span className="text-gray-500 font-mono text-sm">@{domain}</span>
                          </div>
                          <p className="text-xs text-gray-500">
                            Create a custom email address (e.g. <strong>smartglasses</strong>@{domain})
                          </p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditingAlias(false)}>Cancel</Button>
                        <Button onClick={handleSaveAlias} disabled={isSavingAlias} className="bg-blue-600 text-white">
                          {isSavingAlias ? "Saving..." : "Save Short Email"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              <Alert className="bg-blue-50 border-blue-200">
                <AlertCircle className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  <strong>Company ID:</strong> {myCompany.id}
                  <br />
                  <strong>Company Name:</strong> {myCompany.company_name || 'Your Company'}
                </AlertDescription>
              </Alert>
            </>
          ) : (
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-yellow-900">
                Loading your company information...
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Recent Uploads Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Recent Uploads
            </CardTitle>
            <CardDescription>
              Photos received from your smart glasses
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={async () => {
              const { data } = await refetchUploads();
              toast.success("Checked for new photos!");
            }}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {recentUploads.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {recentUploads.map((media) => (
                <div key={media.id} className="group relative aspect-square bg-gray-100 rounded-lg overflow-hidden border">
                  {media.file_type === 'video' ? (
                    <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white">
                      <span className="text-xs">Video</span>
                    </div>
                  ) : (
                    <img 
                      src={media.file_url} 
                      alt="Smart glasses upload" 
                      className="w-full h-full object-cover"
                    />
                  )}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                    <p className="text-xs text-white truncate">
                      {new Date(media.created_date).toLocaleTimeString()}
                    </p>
                    <p className="text-[10px] text-gray-300 truncate">
                      {media.uploaded_by_name}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed">
              <Camera className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                No photos received yet. Try sending one!
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            How to Use Smart Glasses
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <h3 className="font-semibold">Take Photos</h3>
                <p className="text-sm text-gray-600">
                  Use your Ray-Ban Meta smart glasses to capture inspection photos
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                2
              </div>
              <div>
                <h3 className="font-semibold">Share via Email</h3>
                <p className="text-sm text-gray-600">
                  From the Meta View app, share photos to: <span className="font-mono font-bold">{smartGlassesEmail || 'your email above'}</span>
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                3
              </div>
              <div>
                <h3 className="font-semibold">Auto-Upload</h3>
                <p className="text-sm text-gray-600">
                  Photos are automatically uploaded and linked to your CrewCam jobs when possible
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                ✓
              </div>
              <div>
                <h3 className="font-semibold">View in CRM</h3>
                <p className="text-sm text-gray-600">
                  Find your uploaded photos in the CrewCam Dashboard or linked inspection jobs
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Webhook Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900">
              ✅ Email webhook is active and processing photos automatically
              <br />
              <span className="text-xs text-green-700">
                Function: <code>smartGlassesEmailWebhook</code> (handles photo attachments)
              </span>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}