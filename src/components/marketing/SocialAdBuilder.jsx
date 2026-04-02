import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Facebook, Instagram, Youtube, Video, Upload, Sparkles, Target, DollarSign, LayoutTemplate, Zap, Loader2, BookTemplate, Headphones, Linkedin, CheckCircle2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";


export default function SocialAdBuilder({ user, myCompany, initialTemplate }) {
  const [platform, setPlatform] = useState("facebook");
  const [objective, setObjective] = useState("leads");
  const [budget, setBudget] = useState(50);
  const [duration, setDuration] = useState(7);
  const [audienceType, setAudienceType] = useState("retargeting");
  const [adCopy, setAdCopy] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [headline, setHeadline] = useState("");
  const [images, setImages] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [creativeIdea, setCreativeIdea] = useState("");

  const imageUrl = images[0] || ""; // Backward compatibility helper
  const [videoUrl, setVideoUrl] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoScript, setVideoScript] = useState("");
  const [isScriptExpanded, setIsScriptExpanded] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [avatars, setAvatars] = useState([]);
  const [loadingAvatars, setLoadingAvatars] = useState(false);

  // Auto-cycle slides for preview
  React.useEffect(() => {
    if (images.length > 1 && !videoUrl) {
      const interval = setInterval(() => {
        setCurrentSlide(curr => (curr + 1) % images.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [images, videoUrl]);
  
  // Visual customization state
  const [textPosition, setTextPosition] = useState("bottom"); // 'top', 'bottom', 'middle'
  const [textSize, setTextSize] = useState("medium"); // 'small', 'medium', 'large'
  const [showLogo, setShowLogo] = useState(true);
  
  // Brand customization state
  const [brandName, setBrandName] = useState(myCompany?.company_name || "");
  const [brandLogo, setBrandLogo] = useState(myCompany?.logo_url || "");
  const [brandPhone, setBrandPhone] = useState(myCompany?.phone_number || "");
  const [showPhone, setShowPhone] = useState(false);

  // Update brand info when myCompany loads/changes
  React.useEffect(() => {
    if (myCompany) {
      if (!brandName) setBrandName(myCompany.company_name || "");
      if (!brandLogo) setBrandLogo(myCompany.logo_url || "");
      if (!brandPhone) setBrandPhone(myCompany.phone_number || "");
    }
  }, [myCompany]);
  
  const settingsRef = React.useRef(null);

  React.useEffect(() => {
    if (initialTemplate) {
      setPlatform(initialTemplate.platform || "facebook");
      setObjective(initialTemplate.objective || "leads");
      setHeadline(initialTemplate.headline || "");
      setAdCopy(initialTemplate.primary_text || initialTemplate.body || "");
      setCreativeIdea(initialTemplate.creative_idea || "");
      if (initialTemplate.audience_type) setAudienceType(initialTemplate.audience_type);
      if (initialTemplate.videoScript) {
        setVideoScript(initialTemplate.videoScript);
        setIsScriptExpanded(true);
      }
      
      // Clear image/video when switching templates
      setImages([]);
      setVideoUrl("");
      setAudioUrl("");
      
      // Hide templates and scroll to settings
      setShowTemplates(false);
      setTimeout(() => {
        settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [initialTemplate]);

  // Mock integration status - in a real app, this would check backend
  const [isConnected, setIsConnected] = useState({
    facebook: false,
    instagram: false,
    youtube: false,
    tiktok: false
  });

  const handleGenerateCreative = async () => {
    setGenerating(true);
    try {
      const prompt = `Generate a high-converting ${platform} ad for a ${myCompany?.industry || 'roofing'} company named "${myCompany?.company_name}".
      Objective: ${objective}
      Audience: ${audienceType}
      Location: ${myCompany?.company_address || 'Local'}
      
      The copy MUST be personalized for "${myCompany?.company_name}".
      
      Return a JSON with:
      - headline: Catchy headline (max 40 chars)
      - primary_text: Main ad text (max 125 chars) - Include company name or offer naturally.
      - description: Link description (max 30 chars)
      - visual_scenes: An array of 3-5 distinct visual scene descriptions for a video slideshow. Each description should be detailed enough for an AI image generator.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            primary_text: { type: "string" },
            description: { type: "string" },
            visual_scenes: { 
              type: "array", 
              items: { type: "string" } 
            }
          }
        }
      });

      setHeadline(response.headline);
      setAdCopy(response.primary_text);
      
      // Store the first scene as the "creative idea" for fallback
      const scenes = response.visual_scenes || [];
      if (scenes.length > 0) {
        setCreativeIdea(scenes[0]);
      }

      // Trigger image generation for all scenes
      setImages([]); // Clear previous
      setGeneratingImage(true);
      
      // Generate images in parallel (limit concurrency if needed, but 3-5 is fine)
      try {
        await Promise.all(scenes.map(scene => generateImage(scene, true)));
      } finally {
        setGeneratingImage(false);
      }

    } catch (error) {
      console.error("Error generating creative:", error);
      alert("Failed to generate ad content. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const generateImage = async (idea, silent = false) => {
    if (!silent) setGeneratingImage(true);
    try {
      const promptText = idea || `Professional service photo for ${myCompany?.industry || 'roofing'} company, happy customers, bright lighting`;
      const imageRes = await base44.integrations.Core.GenerateImage({
        prompt: `Professional high quality advertising photo for a ${myCompany?.industry || 'roofing'} company. ${promptText}. Photorealistic, 4k, bright lighting.`
      });
      
      if (imageRes && imageRes.url) {
        setImages(prev => [...prev, imageRes.url]);
      } else {
        throw new Error("No image URL returned");
      }
    } catch (imgErr) {
      console.error("Image generation failed:", imgErr);
      // Optional: alert("Image generation failed. Click 'Regenerate Image' to try again.");
    } finally {
      if (!silent) setGeneratingImage(false);
    }
  };

  const handleConnect = (plat) => {
    // In a real implementation, this would trigger OAuth
    // For now, we simulate connection or ask for secrets via specific UI flow (not implemented here)
    let secretsNeeded = 'API Keys';
    if (plat === 'facebook' || plat === 'instagram') secretsNeeded = 'Facebook App ID & Secret';
    if (plat === 'google' || plat === 'youtube') secretsNeeded = 'Google Client ID & Secret';
    if (plat === 'tiktok') secretsNeeded = 'TikTok App ID & Secret';
    if (plat === 'linkedin') secretsNeeded = 'LinkedIn Client ID & Secret';
    
    alert(`To connect ${plat}, we need to authorize with ${secretsNeeded}. This feature is coming soon!`);
    // Simulating connection for demo
    // setIsConnected({ ...isConnected, [plat]: true });
  };

  const handleGenerateVideo = async (mode = 'avatar') => {
    const scriptToUse = videoScript || `${headline}. ${adCopy}`;
    
    if (!scriptToUse) {
      alert("Please generate ad copy or enter a video script first.");
      return;
    }
    
    setGeneratingVideo(true);
    try {
      // If No Avatar mode (Image + Audio) and no image exists, generate one first
      if (mode === 'audio_only' && !imageUrl) {
        // notify user
        // We'll just auto-generate
        try {
           const promptText = creativeIdea || headline || "Professional roofing service";
           const imageRes = await base44.integrations.Core.GenerateImage({
             prompt: `Professional high quality advertising photo for a ${myCompany?.industry || 'roofing'} company. ${promptText}. Photorealistic, 4k, bright lighting.`
           });
           if (imageRes && imageRes.url) {
             setImages(prev => prev.length === 0 ? [imageRes.url] : prev);
           }
        } catch (imgErr) {
           console.error("Auto-image gen failed:", imgErr);
        }
      }
      const aspectRatio = platform === 'tiktok' || platform === 'instagram' ? "9:16" : "16:9";
      
      const res = await base44.functions.invoke("generateMarketingVideo", {
        script: scriptToUse,
        background_url: imageUrl || null, // Use generated image as background if available
        title: `Ad for ${myCompany?.company_name || 'My Company'}`,
        aspect_ratio: aspectRatio,
        mode: mode, // 'avatar' (HeyGen) or 'audio_only' (ElevenLabs)
        avatar_id: selectedAvatar
      });

      if (mode === 'audio_only') {
        if (res.data && res.data.data && res.data.data.audio_base64) {
          setAudioUrl(res.data.data.audio_base64);
          // Clear video if we have audio only
          setVideoUrl("");
        } else {
          throw new Error("Failed to generate audio");
        }
      } else {
        // Avatar Video Mode
        if (res.data && res.data.data && res.data.data.video_id) {
          alert(`Video generation started! ID: ${res.data.data.video_id}. It will appear here shortly.`);
          checkVideoStatus(res.data.data.video_id);
        } else {
          throw new Error("Failed to start video generation");
        }
      }
    } catch (error) {
      console.error("Gen error:", error);
      const msg = error.response?.data?.error || error.message;
      
      // Smart Fallback suggestion
      if (mode === 'avatar' && (msg.includes("HeyGen") || msg.includes("401") || msg.includes("500"))) {
        if (confirm(`HeyGen Avatar generation failed (${msg}). \n\nWould you like to generate a Voiceover (Audio) instead using ElevenLabs?`)) {
          await handleGenerateVideo('audio_only');
          return; // Don't turn off loading yet
        }
      } else {
        alert("Failed to generate: " + msg);
      }
    } finally {
      setGeneratingVideo(false);
    }
  };

  React.useEffect(() => {
    // Fetch avatars on load
    const fetchAvatars = async () => {
      setLoadingAvatars(true);
      try {
        const res = await base44.functions.invoke("generateHeyGenVideo", { action: 'list_avatars' });
        if (res.data && res.data.data && res.data.data.avatars) {
          setAvatars(res.data.data.avatars);
          if (res.data.data.avatars.length > 0) {
            setSelectedAvatar(res.data.data.avatars[0].avatar_id);
          }
        }
      } catch (e) {
        console.error("Failed to load avatars", e);
      } finally {
        setLoadingAvatars(false);
      }
    };
    fetchAvatars();
  }, []);

  const checkVideoStatus = async (videoId) => {
    // Simple polling for demo purposes (try 3 times)
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 20) { // Stop after 1 minute (3s * 20)
        clearInterval(interval); 
        return;
      }
      
      try {
        // Reuse the existing heygen function for status check
        const res = await base44.functions.invoke("generateHeyGenVideo", {
          action: "check_status",
          videoId: videoId
        });
        
        const status = res.data.data.status;
        if (status === "completed" && res.data.data.video_url) {
          setVideoUrl(res.data.data.video_url);
          clearInterval(interval);
        } else if (status === "failed") {
          const errorMsg = res.data.data.error?.message || res.data.data.error || JSON.stringify(res.data.data.error) || "Unknown error";
          alert(`Video generation failed: ${errorMsg}`);
          clearInterval(interval);
        }
      } catch (e) {
        console.error("Polling error", e);
      }
    }, 5000);
  };

  const createCampaignRecord = async () => {
    try {
      await base44.entities.Campaign.create({
        company_id: myCompany?.id,
        campaign_name: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Ad - ${headline.substring(0, 30)}...`,
        campaign_type: `${platform}_ad`,
        campaign_platform: platform,
        status: "active", // Or scheduled
        target_audience: audienceType === 'local' ? 'leads' : 'retargeting', // simplified mapping
        budget_daily: budget,
        notes: `Objective: ${objective}. Duration: ${duration} days. \nCopy: ${adCopy}`,
        ad_creative_id: videoUrl || audioUrl || imageUrl || "text_only",
        created_by: user?.email
      });
      alert(`✅ Campaign "${headline.substring(0, 20)}..." created successfully! View it in your Campaigns list.`);
    } catch (error) {
      console.error("Failed to create campaign record:", error);
      alert("Failed to save campaign record: " + error.message);
    }
  };

  const handleSaveDraft = async () => {
    try {
      await base44.entities.Campaign.create({
        company_id: myCompany?.id,
        campaign_name: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Ad (Draft) - ${headline ? headline.substring(0, 30) : 'Untitled'}...`,
        campaign_type: `${platform}_ad`,
        campaign_platform: platform,
        status: "draft",
        target_audience: audienceType === 'local' ? 'leads' : 'retargeting',
        budget_daily: budget,
        notes: `Objective: ${objective}. Duration: ${duration} days. \nCopy: ${adCopy}`,
        ad_creative_id: videoUrl || audioUrl || imageUrl || "text_only",
        created_by: user?.email
      });
      alert(`Draft saved to Campaigns!`);
    } catch (error) {
      console.error("Failed to save draft:", error);
      alert("Failed to save draft: " + error.message);
    }
  };



  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card 
          className={`cursor-pointer border-2 transition-all ${platform === 'facebook' ? 'border-blue-600 bg-blue-50' : 'hover:border-blue-300'}`}
          onClick={() => setPlatform('facebook')}
        >
          <CardContent className="p-4 flex flex-col items-center text-center">
            <Facebook className={`w-8 h-8 mb-2 ${platform === 'facebook' ? 'text-blue-600' : 'text-gray-500'}`} />
            <h3 className="font-semibold">Facebook Ads</h3>
            <p className="text-xs text-gray-500">Best for retargeting & leads</p>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer border-2 transition-all ${platform === 'instagram' ? 'border-pink-600 bg-pink-50' : 'hover:border-pink-300'}`}
          onClick={() => setPlatform('instagram')}
        >
          <CardContent className="p-4 flex flex-col items-center text-center">
            <Instagram className={`w-8 h-8 mb-2 ${platform === 'instagram' ? 'text-pink-600' : 'text-gray-500'}`} />
            <h3 className="font-semibold">Instagram Ads</h3>
            <p className="text-xs text-gray-500">Visual brand building</p>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer border-2 transition-all ${platform === 'linkedin' ? 'border-blue-700 bg-blue-50' : 'hover:border-blue-400'}`}
          onClick={() => setPlatform('linkedin')}
        >
          <CardContent className="p-4 flex flex-col items-center text-center">
            <Linkedin className={`w-8 h-8 mb-2 ${platform === 'linkedin' ? 'text-blue-700' : 'text-gray-500'}`} />
            <h3 className="font-semibold">LinkedIn Ads</h3>
            <p className="text-xs text-gray-500">B2B & Professional</p>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer border-2 transition-all ${platform === 'youtube' ? 'border-red-600 bg-red-50' : 'hover:border-red-300'}`}
          onClick={() => setPlatform('youtube')}
        >
          <CardContent className="p-4 flex flex-col items-center text-center">
            <Youtube className={`w-8 h-8 mb-2 ${platform === 'youtube' ? 'text-red-600' : 'text-gray-500'}`} />
            <h3 className="font-semibold">YouTube Ads</h3>
            <p className="text-xs text-gray-500">Video reach & education</p>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer border-2 transition-all ${platform === 'tiktok' ? 'border-black bg-gray-50' : 'hover:border-gray-400'}`}
          onClick={() => setPlatform('tiktok')}
        >
          <CardContent className="p-4 flex flex-col items-center text-center">
            <Video className={`w-8 h-8 mb-2 ${platform === 'tiktok' ? 'text-black' : 'text-gray-500'}`} />
            <h3 className="font-semibold">TikTok Ads</h3>
            <p className="text-xs text-gray-500">Viral video reach</p>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer border-2 transition-all ${platform === 'google' ? 'border-green-600 bg-green-50' : 'hover:border-green-300'}`}
          onClick={() => setPlatform('google')}
        >
          <CardContent className="p-4 flex flex-col items-center text-center">
            <Target className={`w-8 h-8 mb-2 ${platform === 'google' ? 'text-green-600' : 'text-gray-500'}`} />
            <h3 className="font-semibold">Google Ads</h3>
            <p className="text-xs text-gray-500">Search & intent targeting</p>
          </CardContent>
        </Card>
      </div>



      <Card ref={settingsRef}>
        <CardHeader>
          <CardTitle>Campaign Settings</CardTitle>
          <CardDescription>Targeting and budget for your {platform} campaign</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <Label>Campaign Objective</Label>
                <Select value={objective} onValueChange={setObjective}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="leads">Lead Generation (Forms)</SelectItem>
                    <SelectItem value="traffic">Website Traffic</SelectItem>
                    <SelectItem value="awareness">Brand Awareness</SelectItem>
                    <SelectItem value="conversion">Conversions/Sales</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Audience Targeting</Label>
                <Select value={audienceType} onValueChange={setAudienceType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retargeting">Retargeting (Website Visitors)</SelectItem>
                    <SelectItem value="customers">Existing Customers (Upsell)</SelectItem>
                    <SelectItem value="lookalike">Lookalike Audience (Similar to Customers)</SelectItem>
                    <SelectItem value="local">Local Area (Geo-Fencing)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  {audienceType === 'lookalike' && "AI will analyze your customer list to find similar people on " + platform}
                  {audienceType === 'retargeting' && "Show ads to people who visited your site but didn't convert"}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-2">
                  <Label>Daily Budget</Label>
                  <span className="font-semibold">${budget}</span>
                </div>
                <Slider 
                  value={[budget]} 
                  onValueChange={(v) => setBudget(v[0])} 
                  max={500} 
                  step={5} 
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>$5</span>
                  <span>$500</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <Label>Duration (Days)</Label>
                  <span className="font-semibold">{duration} days</span>
                </div>
                <Slider 
                  value={[duration]} 
                  onValueChange={(v) => setDuration(v[0])} 
                  max={30} 
                  step={1} 
                  className="py-2"
                />
              </div>

              <div className="bg-gray-100 p-3 rounded-lg flex justify-between items-center">
                <span className="text-sm font-medium">Estimated Reach:</span>
                <span className="font-bold text-lg">~{Math.floor(budget * 40 * duration).toLocaleString()} people</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ad Creative & Copy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 mb-4">
             <Button 
              onClick={handleGenerateCreative} 
              disabled={generating}
              className="bg-purple-600 hover:bg-purple-700 text-white w-full"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Generate Ad Copy & Image with AI
            </Button>
            
            <div className="border rounded-lg p-3 bg-gray-50 mb-4">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold flex items-center gap-2">
                  <Video className="w-4 h-4 text-purple-600" />
                  Video Script
                </Label>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setIsScriptExpanded(!isScriptExpanded)}>
                  {isScriptExpanded ? 'Hide' : 'Edit Script'}
                </Button>
              </div>
              
              {isScriptExpanded && (
                <div className="space-y-2 mb-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <p className="text-xs text-gray-500">
                    Paste your script or outline below. For AI avatars, use text to be spoken.
                  </p>
                  <Textarea // Assuming Textarea is imported from ui/textarea, if not I need to check imports. It wasn't imported in previous file content!
                    value={videoScript}
                    onChange={(e) => setVideoScript(e.target.value)}
                    placeholder="Enter the spoken script for the video here..."
                    className="min-h-[100px] bg-white text-sm"
                  />
                  <div className="flex justify-end">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={async () => {
                        if (!videoScript) return;
                        setGenerating(true);
                        try {
                          const res = await base44.integrations.Core.InvokeLLM({
                            prompt: `Convert this video outline/notes into a natural spoken script for a spokesperson (approx 30-60 seconds).
                            
IMPORTANT: Output ONLY the spoken words to be read by the text-to-speech engine. 
Do NOT include scene descriptions, camera directions, "Narrator:", "Music:", or any other non-spoken text.
Just the raw script text.

Input:\n\n${videoScript}`
                          });
                          setVideoScript(res);
                        } catch(e) {
                          alert("Failed to convert: " + e.message);
                        } finally {
                          setGenerating(false);
                        }
                      }}
                      disabled={generating || !videoScript}
                    >
                      {generating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
                      Convert Outline to Script
                    </Button>
                  </div>
                </div>
              )}

              <div className="mb-4">
                <Label className="text-sm font-semibold mb-2 block">Choose Avatar</Label>
                {loadingAvatars ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading avatars...
                  </div>
                ) : avatars.length > 0 ? (
                  <div className="flex gap-3 overflow-x-auto pb-3">
                    <div 
                      onClick={() => setSelectedAvatar(null)}
                      className={`relative flex-shrink-0 cursor-pointer rounded-lg overflow-hidden border-2 transition-all w-24 h-24 flex flex-col items-center justify-center bg-gray-50 ${
                        selectedAvatar === null ? 'border-pink-600 ring-2 ring-pink-200' : 'border-gray-200 hover:border-pink-300'
                      }`}
                    >
                      <Video className="w-8 h-8 text-gray-400 mb-1" />
                      <span className="text-[10px] text-gray-600 font-medium text-center leading-tight">No Avatar<br/>(Image Only)</span>
                      {selectedAvatar === null && (
                        <div className="absolute top-1 right-1 bg-pink-600 rounded-full p-0.5">
                          <CheckCircle2 className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                    {avatars.map(av => (
                      <div 
                        key={av.avatar_id}
                        onClick={() => setSelectedAvatar(av.avatar_id)}
                        className={`relative flex-shrink-0 cursor-pointer rounded-lg overflow-hidden border-2 transition-all w-24 h-24 ${
                          selectedAvatar === av.avatar_id ? 'border-purple-600 ring-2 ring-purple-200' : 'border-gray-200 hover:border-purple-300'
                        }`}
                      >
                        <img 
                          src={av.preview_image_url || av.thumbnail_url} 
                          alt={av.avatar_name} 
                          className="w-full h-full object-cover"
                        />
                        {selectedAvatar === av.avatar_id && (
                          <div className="absolute inset-0 bg-purple-600/20 flex items-center justify-center">
                            <div className="bg-purple-600 text-white rounded-full p-1">
                              <Sparkles className="w-3 h-3" />
                            </div>
                          </div>
                        )}
                        <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] p-1 text-center truncate">
                          {av.avatar_name}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No avatars found or HeyGen not connected.</p>
                )}
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold block">Visuals & Scenes ({images.length})</Label>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => setImages([])} 
                    className="h-6 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                    disabled={images.length === 0}
                  >
                    Clear All
                  </Button>
                </div>
                
                {/* Images List */}
                {images.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative w-20 h-20 flex-shrink-0 group">
                        <img src={img} className="w-full h-full object-cover rounded-md border border-gray-200" />
                        <button 
                          onClick={() => setImages(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1 truncate">
                          Scene {idx + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input 
                    placeholder="Enter image URL to add..." 
                    className="flex-1 bg-white text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.currentTarget.value) {
                        setImages(prev => [...prev, e.currentTarget.value]);
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                  <input
                    type="file"
                    id="bg-image-upload"
                    className="hidden"
                    accept="image/*"
                    multiple
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length === 0) return;
                      
                      for (const file of files) {
                        try {
                          const res = await base44.integrations.Core.UploadFile({ file });
                          setImages(prev => [...prev, res.file_url]);
                        } catch (err) {
                          console.error("Upload failed", err);
                        }
                      }
                    }}
                  />
                  <label htmlFor="bg-image-upload">
                    <Button variant="outline" size="icon" asChild className="cursor-pointer" title="Upload Images">
                      <span><Upload className="w-4 h-4" /></span>
                    </Button>
                  </label>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    onClick={() => generateImage(creativeIdea)}
                    title="Generate New AI Scene"
                  >
                    <Sparkles className="w-4 h-4 text-purple-600" />
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-1">Upload photos or generate AI scenes. Multiple images will create a slideshow.</p>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex gap-2 flex-wrap">
                  <Button 
                    onClick={() => handleGenerateVideo('avatar')}
                    disabled={generatingVideo || (!headline && !adCopy && !videoScript) || !selectedAvatar}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!selectedAvatar ? "Select an avatar above to enable" : "Generate video with AI Avatar"}
                  >
                    {generatingVideo ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Video className="w-4 h-4 mr-2" />}
                    Generate Avatar Video (HeyGen)
                  </Button>
                  <Button 
                    onClick={() => handleGenerateVideo('audio_only')}
                    disabled={generatingVideo || (!headline && !adCopy && !videoScript)}
                    className="bg-pink-600 hover:bg-pink-700 text-white flex-1"
                  >
                    {generatingVideo ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Video className="w-4 h-4 mr-2" />}
                    Generate Video (No Avatar)
                  </Button>
                </div>
                <div className="flex justify-end">
                  <button 
                    onClick={async () => {
                      try {
                        const res = await base44.functions.invoke("generateHeyGenVideo", { action: 'list_avatars' });
                        if (res.data && res.data.data) {
                          alert("✅ HeyGen Connection Successful! API Key is valid.");
                        } else {
                          alert("❌ HeyGen Connection Failed. Please check your API Key.");
                        }
                      } catch (e) {
                        alert("❌ Connection Test Error: " + (e.response?.data?.error || e.message));
                      }
                    }}
                    className="text-xs text-gray-500 hover:text-indigo-600 underline flex items-center gap-1"
                  >
                    <Zap className="w-3 h-3" /> Test HeyGen Connection
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <Label>Headline</Label>
                <Input 
                  value={headline} 
                  onChange={(e) => setHeadline(e.target.value)} 
                  placeholder="e.g., Get a Free Roof Inspection Today!"
                />
              </div>
              <div>
                <Label>Primary Text</Label>
                <Input // Changed to TextArea in real scenario, keeping simple for now
                  value={adCopy}
                  onChange={(e) => setAdCopy(e.target.value)}
                  placeholder="Main ad text..."
                  className="h-24" // Make it look more like textarea
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="border rounded-lg bg-gray-50 flex flex-col items-center justify-center min-h-[250px] overflow-hidden relative group">
              {generatingImage ? (
                <div className="flex flex-col items-center justify-center p-6 text-purple-600">
                  <Loader2 className="w-10 h-10 animate-spin mb-3" />
                  <p className="font-medium">Generating AI Image...</p>
                  <p className="text-xs text-purple-400 mt-1">This takes a few seconds</p>
                </div>
              ) : videoUrl ? (
                <div className="relative w-full h-full bg-black flex items-center justify-center">
                  <video 
                    src={videoUrl} 
                    controls 
                    className="max-h-[400px] w-full object-contain" 
                    autoPlay 
                    loop 
                    muted
                  />
                  <div className="absolute top-2 right-2">
                     <Button 
                       size="sm" 
                       variant="secondary" 
                       onClick={() => setVideoUrl("")} // Clear to show image again
                       className="shadow-lg text-xs"
                     >
                       Show Image
                     </Button>
                   </div>
                </div>
              ) : audioUrl && images.length === 0 ? (
                 /* Audio only case - fallback if image gen failed */
                 <div className="flex flex-col items-center justify-center p-6 w-full h-full bg-gray-900 text-white min-h-[300px]">
                    <div className="text-center mb-4">
                      <Headphones className="w-12 h-12 mb-2 text-purple-400 mx-auto" />
                      <p className="text-sm font-medium">Audio Generated</p>
                      <p className="text-xs text-gray-400">Add visuals to create a video slideshow</p>
                    </div>
                    <audio controls src={audioUrl} className="w-full max-w-md" />
                    <Button 
                       size="sm" 
                       variant="outline" 
                       onClick={() => generateImage(creativeIdea || headline)}
                       className="mt-6 border-purple-500 text-purple-400 hover:bg-purple-900/50"
                    >
                       <Sparkles className="w-4 h-4 mr-2" />
                       Generate AI Scene
                    </Button>
                 </div>
              ) : images.length > 0 ? (
                <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden group/preview">
                   {/* Slideshow */}
                   {images.map((img, idx) => (
                     <img 
                       key={idx}
                       src={img} 
                       alt={`Scene ${idx + 1}`} 
                       className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${idx === currentSlide ? 'opacity-100' : 'opacity-0'}`} 
                     />
                   ))}

                   {/* Slide Indicators */}
                   {images.length > 1 && (
                     <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex gap-1 z-20">
                       {images.map((_, idx) => (
                         <div 
                           key={idx} 
                           className={`w-1.5 h-1.5 rounded-full shadow-sm transition-colors ${idx === currentSlide ? 'bg-white' : 'bg-white/40'}`}
                         />
                       ))}
                     </div>
                   )}

                   {/* Audio Player Overlay */}
                   {audioUrl && (
                     <div className="absolute bottom-12 left-4 right-4 z-10">
                       <audio controls autoPlay src={audioUrl} className="w-full h-8 shadow-lg rounded-full opacity-90 hover:opacity-100 transition-opacity" />
                     </div>
                   )}

                   {/* Ad Text Overlay */}
                   <div 
                     className={`absolute left-0 right-0 bg-black/30 hover:bg-black/40 text-white p-6 transition-all duration-300 backdrop-blur-sm
                       ${textPosition === 'top' ? 'top-0 bottom-auto' : textPosition === 'middle' ? 'top-1/2 -translate-y-1/2' : 'bottom-0 top-auto'}
                     `}
                   >
                     <div className="flex justify-between items-start mb-3">
                       {showLogo && brandName && (
                         <div className="flex items-center gap-3 opacity-95 bg-black/30 p-2 rounded-lg backdrop-blur-md border border-white/10">
                           {brandLogo ? (
                             <img src={brandLogo} alt="Logo" className="w-8 h-8 rounded object-contain bg-white/10 p-1" />
                           ) : (
                             <div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center text-xs font-bold">
                               {brandName.substring(0,2).toUpperCase()}
                             </div>
                           )}
                           <div className="flex flex-col">
                             <span className="text-sm font-bold tracking-wider uppercase leading-none">{brandName}</span>
                             {showPhone && brandPhone && <span className="text-[10px] opacity-80 mt-1">{brandPhone}</span>}
                           </div>
                         </div>
                       )}
                     </div>
                     
                     <p className={`font-extrabold leading-tight mb-2 drop-shadow-md
                       ${textSize === 'small' ? 'text-base' : textSize === 'medium' ? 'text-xl' : 'text-3xl'}
                     `}>
                       {headline || "Your Headline Here"}
                     </p>
                     <p className={`opacity-95 drop-shadow leading-relaxed
                       ${textSize === 'small' ? 'text-sm' : textSize === 'medium' ? 'text-base' : 'text-lg'}
                     `}>
                       {adCopy || "Primary text..."}
                     </p>
                     
                     <div className="mt-4 flex items-center gap-3">
                       <span className="bg-blue-600 text-white text-sm font-bold px-6 py-2 rounded-full hover:bg-blue-700 cursor-pointer shadow-lg transition-transform hover:scale-105">
                         {objective === 'leads' ? 'Sign Up Now' : 'Learn More'}
                       </span>
                     </div>
                   </div>

                   {/* Customization Controls (Visible on Hover) */}
                   <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2 z-20">
                     <div className="bg-black/80 rounded-lg p-1 flex flex-col gap-1 backdrop-blur-sm">
                       <Label className="text-[10px] text-white text-center font-bold">Position</Label>
                       <div className="flex gap-1">
                         <Button size="icon" variant={textPosition === 'top' ? "default" : "ghost"} className="h-6 w-6" onClick={() => setTextPosition('top')} title="Top">
                           <LayoutTemplate className="w-3 h-3 rotate-180" />
                         </Button>
                         <Button size="icon" variant={textPosition === 'middle' ? "default" : "ghost"} className="h-6 w-6" onClick={() => setTextPosition('middle')} title="Middle">
                           <LayoutTemplate className="w-3 h-3 rotate-90" />
                         </Button>
                         <Button size="icon" variant={textPosition === 'bottom' ? "default" : "ghost"} className="h-6 w-6" onClick={() => setTextPosition('bottom')} title="Bottom">
                           <LayoutTemplate className="w-3 h-3" />
                         </Button>
                       </div>
                     </div>

                     <div className="bg-black/80 rounded-lg p-1 flex flex-col gap-1 backdrop-blur-sm">
                        <Label className="text-[10px] text-white text-center font-bold">Size</Label>
                        <div className="flex gap-1 justify-center">
                          <Button size="icon" variant={textSize === 'small' ? "default" : "ghost"} className="h-6 w-6" onClick={() => setTextSize('small')} title="Small">
                            <span className="text-xs">A</span>
                          </Button>
                          <Button size="icon" variant={textSize === 'medium' ? "default" : "ghost"} className="h-6 w-6" onClick={() => setTextSize('medium')} title="Medium">
                            <span className="text-sm font-bold">A</span>
                          </Button>
                          <Button size="icon" variant={textSize === 'large' ? "default" : "ghost"} className="h-6 w-6" onClick={() => setTextSize('large')} title="Large">
                            <span className="text-lg font-bold">A</span>
                          </Button>
                        </div>
                     </div>
                     
                     <Button 
                       size="sm" 
                       variant="secondary" 
                       onClick={() => generateImage(creativeIdea)}
                       className="shadow-lg"
                     >
                       <Sparkles className="w-3 h-3 mr-1" /> New Image
                     </Button>
                   </div>
                </div>
              ) : (
                <div className="text-center text-gray-400 p-4 w-full">
                  <LayoutTemplate className="w-12 h-12 mx-auto mb-2" />
                  <p>Ad Preview will appear here</p>
                  {creativeIdea && <p className="text-xs mt-2 italic text-gray-500 max-w-xs mx-auto mb-3">Idea: {creativeIdea}</p>}
                  
                  {(headline || adCopy) && (
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => generateImage(creativeIdea)}
                      className="mt-2 text-purple-600 border-purple-200 hover:bg-purple-50"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate Image
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Branding Controls */}
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <LayoutTemplate className="w-4 h-4 text-gray-500" />
                Customize Branding
              </h4>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Company Name</Label>
                    <Input 
                      value={brandName} 
                      onChange={(e) => setBrandName(e.target.value)} 
                      className="h-8 text-xs bg-white"
                      placeholder="My Company"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Logo URL</Label>
                    <Input 
                      value={brandLogo} 
                      onChange={(e) => setBrandLogo(e.target.value)} 
                      className="h-8 text-xs bg-white"
                      placeholder="https://..."
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch id="show-logo" checked={showLogo} onCheckedChange={setShowLogo} />
                    <Label htmlFor="show-logo" className="text-xs font-normal">Show Logo</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="show-phone" checked={showPhone} onCheckedChange={setShowPhone} />
                    <Label htmlFor="show-phone" className="text-xs font-normal">Show Phone</Label>
                  </div>
                </div>
                {showPhone && (
                  <div>
                    <Label className="text-xs">Phone Number</Label>
                    <Input 
                      value={brandPhone} 
                      onChange={(e) => setBrandPhone(e.target.value)} 
                      className="h-8 text-xs bg-white"
                      placeholder="(555) 123-4567"
                    />
                  </div>
                )}
              </div>
            </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={handleSaveDraft}>Save Draft</Button>
        <Button 
          className="bg-green-600 hover:bg-green-700"
          onClick={() => {
            if (!isConnected[platform]) {
              // For now, allow creation even if not connected, just warn
              // handleConnect(platform);
              // But create the record anyway so they see it in the list
              createCampaignRecord();
            } else {
              createCampaignRecord();
            }
          }}
        >
          <Zap className="w-4 h-4 mr-2" />
          Launch Campaign
        </Button>
      </div>
    </div>
  );
}