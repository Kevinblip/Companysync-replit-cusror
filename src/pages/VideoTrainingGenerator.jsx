import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useTranslation from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Video, Upload, X, Plus, Play, Download, Image as ImageIcon, RefreshCw, Sparkles, Save, FolderOpen, BookOpen } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function VideoTrainingGenerator() {
  const { t } = useTranslation();
  const [user, setUser] = React.useState(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDescription, setVideoDescription] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [masterNarrationPrompt, setMasterNarrationPrompt] = useState("");
  const [slides, setSlides] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [generatingVoiceover, setGeneratingVoiceover] = useState(false);
  const [generatingMasterNarration, setGeneratingMasterNarration] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("21m00Tcm4TlvDq8ikWAM");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);
  const audioRef = React.useRef(null);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = React.useMemo(() => {
    if (!user) return null;
    return companies.find(c => c.created_by === user.email);
  }, [user, companies]);

  const { data: savedVideos = [] } = useQuery({
    queryKey: ['training-videos', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.TrainingVideo.filter({ company_id: { $in: [myCompany.id, '695944e3c1fb00b7ab716c6f'] } }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const elevenLabsVoices = [
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel - Natural Female" },
    { id: "29vD33N1CtxCmqQRPOHJ", name: "Drew - Natural Male" },
    { id: "2EiwWnXFnvU5JabPnv8n", name: "Clyde - Professional Male" },
    { id: "5Q0t7uMcjvnagumLfvZi", name: "Paul - News Anchor" },
    { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi - Confident Female" },
    { id: "CYw3kZ02Hs0563khs1Fj", name: "Dave - British Male" },
    { id: "D38z5RcWu1voky8WS1ja", name: "Fin - Irish Male" },
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah - Soft Female" },
  ];

  const uploadImageMutation = useMutation({
    mutationFn: async (file) => {
      const result = await base44.integrations.Core.UploadFile({ file });
      return result.file_url;
    },
    onSuccess: () => {
      toast.success('Screenshot uploaded!');
    },
  });

  // Legacy single-slide generation (kept for manual regenerate button)
  const generateNarrationMutation = useMutation({
    mutationFn: async ({ imageUrl, slideNumber, totalSlides }) => {
       // ... existing logic can stay for single regeneration if needed, 
       // but we prefer master generation now.
       // Minimal implementation to keep code valid if called:
       const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Create short narration for slide ${slideNumber}. Context: ${videoTitle}. 
        Keep it factual and direct. Do NOT add generic ending lines like "This makes it easy".`,
        file_urls: imageUrl
      });
      return response.output || response;
    },
  });

  const generateMasterNarrationMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('generateMasterNarration', {
        slides: slides,
        videoTitle: videoTitle,
        customInstructions: customInstructions,
        masterNarrationPrompt: masterNarrationPrompt
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.narrations && Array.isArray(data.narrations)) {
        setSlides(prevSlides => prevSlides.map((slide, index) => ({
          ...slide,
          narration: data.narrations[index] || slide.narration || ""
        })));
        toast.success("Master narration generated successfully!");
      }
    },
    onError: (error) => {
      console.error("Master narration failed:", error);
      toast.error("Failed to generate master narration: " + error.message);
    }
  });

  const expandNarrationMutation = useMutation({
    mutationFn: async ({ slideId, currentNarration, topic, imageUrl, improvementPrompt }) => {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a professional software trainer.
The user wants to IMPROVE and ADD DETAIL to the narration for this specific slide.

CONTEXT:
Current Narration: "${currentNarration}"
Slide Topic: "${topic || 'General Overview'}"
Video Title: "${videoTitle}"
${improvementPrompt ? `USER INSTRUCTIONS FOR IMPROVEMENT: "${improvementPrompt}"` : ''}

INSTRUCTIONS:
Rewrite the narration to be more detailed, instructive, and helpful.
${improvementPrompt ? `- STRICTLY FOLLOW the user's specific instructions above.` : ''}
- If the current narration is too brief (e.g., "Click the button"), explain WHERE the button is and WHY to click it.
- **READ THE IMAGE**: Explicitly reference the exact text visible in the screenshot (e.g., "Click the blue 'Save' button in the top right", "Select 'Profile' from the menu").
- Describe the key UI elements shown in the screenshot that are relevant to the topic.
- Maintain a professional, friendly, spoken-word tone.
- Keep it to 2-4 sentences maximum (concise but informative).
- Do NOT repeat "Welcome" or introductions if not appropriate.
- Do NOT add generic value statements or fluff at the end.
- Do NOT preview the next slide (e.g. avoid "Next we will look at..."). Stick to the current slide only.

Return ONLY the new narration text.`,
        file_urls: imageUrl ? [imageUrl] : undefined,
        add_context_from_internet: false
      });
      return response.output || response;
    },
    onSuccess: (newNarration, variables) => {
      updateSlide(variables.slideId, 'narration', newNarration);
      // Clear the improvement prompt after success
      updateSlide(variables.slideId, 'improvementPrompt', '');
      toast.success("Narration improved!");
    },
    onError: (error) => {
      toast.error("Failed to expand narration: " + error.message);
    }
  });

  const analyzeSlideMutation = useMutation({
    mutationFn: async ({ slideId, imageUrl, videoTitle }) => {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this screenshot for a training video tutorial.
VIDEO TITLE CONTEXT: "${videoTitle || 'Software Tutorial'}"

TASK:
Identify the logical "Slide Topic" and the specific areas to focus on or ignore.

RETURN JSON format:
{
  "topic": "Short 2-4 word topic describing the action or screen (e.g. 'Creating New Lead', 'Dashboard Overview')",
  "focus_area": "What specific element is the user interacting with? (e.g. 'Save button top right', 'Left sidebar menu')",
  "ignore_area": "What parts are standard or irrelevant? (e.g. 'Browser address bar', 'Background windows')",
  "caption": "A short, punchy 3-5 word caption for the video overlay"
}`,
        file_urls: [imageUrl],
        response_json_schema: {
          type: "object",
          properties: {
            topic: { type: "string" },
            focus_area: { type: "string" },
            ignore_area: { type: "string" },
            caption: { type: "string" }
          }
        }
      });
      return { slideId, data: response };
    },
    onSuccess: ({ slideId, data }) => {
      setSlides(prev => prev.map(s => 
        s.id === slideId 
          ? { 
              ...s, 
              topic: data.topic || s.topic, 
              focus_area: data.focus_area || s.focus_area, 
              ignore_area: data.ignore_area || s.ignore_area, 
              caption: data.caption || s.caption,
              isAnalyzing: false
            } 
          : s
      ));
      toast.success("AI analyzed slide topic & focus!");
    },
    onError: (error, variables) => {
      console.error("Slide analysis failed:", error);
      setSlides(prev => prev.map(s => s.id === variables.slideId ? { ...s, isAnalyzing: false } : s));
    }
  });

  const generateVoiceoverMutation = useMutation({
    mutationFn: async ({ text, voice }) => {
      const response = await base44.functions.invoke('elevenLabsSpeak', {
        text,
        voice_id: voice
      });
      return response.data;
    },
  });

  const saveVideoMutation = useMutation({
    mutationFn: async (videoData) => {
      console.log('Save mutation started:', currentVideoId ? 'UPDATE' : 'CREATE');
      if (currentVideoId) {
        return await base44.entities.TrainingVideo.update(currentVideoId, videoData);
      } else {
        return await base44.entities.TrainingVideo.create(videoData);
      }
    },
    onSuccess: (data) => {
      console.log('Save successful:', data);
      setCurrentVideoId(data.id);
      queryClient.invalidateQueries({ queryKey: ['training-videos'] });
      toast.success('Video saved successfully!');
    },
    onError: (error) => {
      console.error('Save failed:', error);
      toast.error('Failed to save: ' + error.message);
    },
  });

  const deleteVideoMutation = useMutation({
    mutationFn: (videoId) => base44.entities.TrainingVideo.delete(videoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-videos'] });
      toast.success('Video deleted successfully!');
    },
  });

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const validImageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    
    // Check if any PDFs are included
    const hasPdf = files.some(f => f.type === 'application/pdf');
    if (hasPdf && files.length > 1) {
      toast.error('Please upload either multiple images OR one PDF, not both.');
      return;
    }

    // Validate all files
    for (const file of files) {
      const isPdf = file.type === 'application/pdf';
      if (!isPdf && !validImageTypes.includes(file.type)) {
        toast.error(`Invalid file type: ${file.name}. Please upload images (PNG, JPG, WebP) or PDF.`);
        return;
      }
    }

    try {
      toast.loading(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`, { id: 'upload' });
      
      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isPdf = file.type === 'application/pdf';
        
        // Upload file
        const url = await uploadImageMutation.mutateAsync(file);
        const newSlideId = String(Date.now() + i);
        
        // Add slide with empty state - waiting for master narration
        const newSlide = { 
          id: newSlideId, 
          imageUrl: url,
          caption: isPdf ? "PDF Document" : "",
          narration: "", 
          topic: "",     
          focus_area: "", 
          ignore_area: "", 
          audioUrl: null,
          isAnalyzing: true // Flag to show loading state
        };
        
        setSlides(prev => [...prev, newSlide]);

        // Trigger AI analysis for this slide immediately
        analyzeSlideMutation.mutate({ 
            slideId: newSlideId, 
            imageUrl: url, 
            videoTitle 
        });
      }

      toast.success(`${files.length} slide${files.length > 1 ? 's' : ''} uploaded! Analyzing topics...`, { id: 'upload' });
      
    } catch (error) {
      toast.error('Failed to process files: ' + error.message, { id: 'upload' });
    }
  };

  const handleReplaceImage = async (e, slideId) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      toast.loading('Replacing image...', { id: `replace-${slideId}` });
      const url = await uploadImageMutation.mutateAsync(file);
      
      setSlides(prev => prev.map(s => 
        s.id === slideId 
          ? { ...s, imageUrl: url, isAnalyzing: true } 
          : s
      ));

      // Trigger analysis for the new image
      analyzeSlideMutation.mutate({ 
        slideId, 
        imageUrl: url, 
        videoTitle 
      });

      toast.success('Image replaced & re-analyzing...', { id: `replace-${slideId}` });
    } catch (error) {
      toast.error('Failed to replace image: ' + error.message, { id: `replace-${slideId}` });
    }
  };

  const [insertIndex, setInsertIndex] = useState(null);

  const handleInsertSlide = async (e) => {
    const file = e.target.files?.[0];
    if (!file || insertIndex === null) return;

    try {
      toast.loading('Inserting slide...', { id: 'insert-slide' });
      const url = await uploadImageMutation.mutateAsync(file);
      const newSlideId = String(Date.now());
      
      const newSlide = { 
        id: newSlideId, 
        imageUrl: url,
        caption: file.type === 'application/pdf' ? "PDF Document" : "",
        narration: "", 
        topic: "",     
        focus_area: "", 
        ignore_area: "", 
        audioUrl: null,
        isAnalyzing: true 
      };

      setSlides(prev => {
        const newSlides = [...prev];
        newSlides.splice(insertIndex, 0, newSlide);
        return newSlides;
      });

      analyzeSlideMutation.mutate({ 
        slideId: newSlideId, 
        imageUrl: url, 
        videoTitle 
      });

      toast.success('Slide inserted & analyzing...', { id: 'insert-slide' });
      setInsertIndex(null);
    } catch (error) {
      toast.error('Failed to insert: ' + error.message, { id: 'insert-slide' });
    }
  };

  const updateSlide = (id, field, value) => {
    setSlides(prevSlides => prevSlides.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const removeSlide = (id) => {
    setSlides(prevSlides => prevSlides.filter(s => s.id !== id));
  };

  const regenerateNarration = async (slideId, imageUrl, slideIndex) => {
    try {
      toast.loading('Regenerating narration...', { id: `regen-${slideId}` });
      
      const narration = await generateNarrationMutation.mutateAsync({
        imageUrl,
        slideNumber: slideIndex + 1,
        totalSlides: slides.length
      });

      updateSlide(slideId, 'narration', typeof narration === 'string' ? narration : narration.text || '');
      toast.success('Narration regenerated!', { id: `regen-${slideId}` });
    } catch (error) {
      toast.error('Failed to regenerate: ' + error.message, { id: `regen-${slideId}` });
    }
  };

  const regenerateVoiceover = async (slideId, narrationText) => {
    if (!narrationText?.trim()) {
      toast.error('No narration text to generate audio from');
      return;
    }

    try {
      toast.loading('Generating voiceover...', { id: `voice-${slideId}` });
      
      const audio = await generateVoiceoverMutation.mutateAsync({
        text: narrationText,
        voice: selectedVoice
      });

      if (audio && audio.audio_url) {
        updateSlide(slideId, 'audioUrl', audio.audio_url);
        toast.success('Voiceover generated!', { id: `voice-${slideId}` });
      } else {
        toast.error('Voiceover generation did not return an audio URL.');
      }
    } catch (error) {
      toast.error('Failed to generate voiceover: ' + error.message, { id: `voice-${slideId}` });
    }
  };

  const generateAllVoiceovers = async () => {
    const slidesToProcess = slides.filter(s => s.narration && !s.audioUrl);
    
    if (slidesToProcess.length === 0) {
      toast.error('No slides need voiceovers - all slides already have audio');
      return;
    }

    setGeneratingVoiceover(true);
    toast.loading(`Generating voiceovers for ${slidesToProcess.length} slides...`, { id: 'generate-all' });
    
    let completed = 0;
    
    try {
      for (const slide of slidesToProcess) {
        const audio = await generateVoiceoverMutation.mutateAsync({
          text: slide.narration,
          voice: selectedVoice
        });
        
        if (audio && audio.audio_url) {
          setSlides(prevSlides => 
            prevSlides.map(s => String(s.id) === String(slide.id) ? { ...s, audioUrl: audio.audio_url } : s)
          );
        }
        
        completed++;
        toast.loading(`Generated ${completed}/${slidesToProcess.length} voiceovers...`, { id: 'generate-all' });
      }
      
      toast.success(`All ${completed} voiceovers generated!`, { id: 'generate-all' });
    } catch (error) {
      toast.error(`Failed after ${completed}/${slidesToProcess.length}: ${error.message}`, { id: 'generate-all' });
    } finally {
      setGeneratingVoiceover(false);
    }
  };

  const playPresentation = () => {
    if (slides.length === 0) {
      toast.error('Add some slides first!');
      return;
    }
    setCurrentSlide(0);
    setIsPlaying(true);
  };

  const stopPresentation = () => {
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  // Auto-advance to next slide when audio ends
  React.useEffect(() => {
    if (!isPlaying || !slides[currentSlide]) return;

    const currentSlideData = slides[currentSlide];
    
    if (currentSlideData.audioUrl && audioRef.current) {
      audioRef.current.src = currentSlideData.audioUrl + '';
      audioRef.current.play().catch(err => {
        console.error('Audio playback failed:', err);
        toast.error('Audio playback failed. Please check your audio files.');
        setIsPlaying(false);
      });
    } else {
      // No audio, advance after 3 seconds
      const timer = setTimeout(() => {
        if (currentSlide < slides.length - 1) {
          setCurrentSlide(currentSlide + 1);
        } else {
          setIsPlaying(false);
          toast.success('Presentation complete!');
        }
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [isPlaying, currentSlide, slides]);

  const handleAudioEnded = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      setIsPlaying(false);
      toast.success('Presentation complete!');
    }
  };

  const handleSaveVideo = async () => {
    if (!myCompany) {
      toast.error('Company not found - please refresh the page');
      console.error('Save failed: No company found');
      return;
    }

    if (slides.length === 0) {
      toast.error('Please add slides before saving');
      return;
    }

    // Use default title if not provided
    const title = videoTitle.trim() || `Training Video ${new Date().toLocaleDateString()}`;
    
    // Update the title state if it was auto-generated
    if (!videoTitle.trim()) {
      setVideoTitle(title);
    }

    const normalizedSlides = slides.map((s, idx) => ({
      ...s,
      id: String(s.id ?? `slide-${idx + 1}-${Date.now()}`)
    }));

    const videoData = {
      company_id: myCompany.id,
      title: title,
      description: videoDescription,
      slides: normalizedSlides,
      selected_voice: selectedVoice,
      custom_instructions: customInstructions,
      status: 'draft'
    };

    console.log('Saving video:', videoData);
    saveVideoMutation.mutate(videoData);
  };

  const handleLoadVideo = (video) => {
    setCurrentVideoId(video.id);
    setVideoTitle(video.title);
    setVideoDescription(video.description || "");
    const normalized = (video.slides || []).map((s, idx) => ({
      ...s,
      id: String(s?.id ?? `slide-${idx + 1}-${Date.now()}`)
    }));
    setSlides(normalized);
    setSelectedVoice(video.selected_voice || "21m00Tcm4TlvDq8ikWAM");
    setCustomInstructions(video.custom_instructions || "");
    setLoadDialogOpen(false);
    toast.success(`Loaded: ${video.title}`);
  };

  const handleNewVideo = () => {
    if (slides.length > 0 && !confirm('Start a new video? Current progress will be lost unless you save.')) {
      return;
    }
    setCurrentVideoId(null);
    setVideoTitle("");
    setVideoDescription("");
    setCustomInstructions("");
    setSlides([]);
    setCurrentSlide(0);
    setSelectedVoice("21m00Tcm4TlvDq8ikWAM");
  };

  const handleAddToKnowledgeBase = async () => {
    if (!currentVideoId) {
      toast.error('Please save the video first!');
      return;
    }

    try {
      const shareUrl = `${createPageUrl('TrainingVideoPlayer')}?id=${currentVideoId}`;
      
      await base44.entities.KnowledgeBaseArticle.create({
        company_id: myCompany.id,
        title: videoTitle || 'Training Video',
        content: `<p>${videoDescription || 'Step-by-step training video'}</p><p><a href="${shareUrl}" target="_blank">Watch Training Video</a></p><p><strong>Slides:</strong> ${slides.length}</p>`,
        category: 'Training Videos',
        is_published: true,
        is_ai_training: true,
        ai_assistant_targets: ['lexi', 'estimator', 'sarah', 'marcus'],
        priority: 8
      });

      queryClient.invalidateQueries({ queryKey: ['knowledge-base', myCompany?.id] });
      toast.success('Added to Knowledge Base!');
    } catch (error) {
      toast.error('Failed to add to Knowledge Base: ' + error.message);
    }
  };

  const handleBulkAddToKnowledgeBase = async () => {
    if (selectedVideoIds.length === 0) {
      toast.error('Please select videos to add');
      return;
    }

    try {
      toast.loading(`Adding ${selectedVideoIds.length} videos to Knowledge Base...`, { id: 'bulk-kb' });

      for (const videoId of selectedVideoIds) {
        const video = savedVideos.find(v => v.id === videoId);
        if (!video) continue;

        const shareUrl = `${createPageUrl('TrainingVideoPlayer')}?id=${video.id}`;
        
        await base44.entities.KnowledgeBaseArticle.create({
          company_id: myCompany.id,
          title: video.title,
          content: `<p>${video.description || 'Step-by-step training video'}</p><p><a href="${shareUrl}" target="_blank">Watch Training Video</a></p><p><strong>Slides:</strong> ${video.slides?.length || 0}</p>`,
          category: 'Training Videos',
          is_published: true,
          is_ai_training: true,
          ai_assistant_targets: ['lexi', 'estimator', 'sarah', 'marcus'],
          priority: 8
        });
      }

      queryClient.invalidateQueries({ queryKey: ['knowledge-base', myCompany?.id] });
      toast.success(`Added ${selectedVideoIds.length} videos to Knowledge Base!`, { id: 'bulk-kb' });
      setSelectedVideoIds([]);
    } catch (error) {
      toast.error('Failed to add videos: ' + error.message, { id: 'bulk-kb' });
    }
  };

  const handleDownloadSlides = async () => {
    if (slides.length === 0) {
      toast.error('Add slides first!');
      return;
    }

    const missingAudio = slides.filter(s => !s.audioUrl);
    if (missingAudio.length > 0) {
      toast.error(`All slides must have voiceover audio! ${missingAudio.length} slide(s) are missing audio.`);
      return;
    }

    setIsGeneratingVideo(true);
    toast.loading('Downloading slide assets...', { id: 'download-slides' });

    try {
      // Download each slide's image and audio
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        
        // Download image
        const imgLink = document.createElement('a');
        imgLink.href = slide.imageUrl;
        imgLink.download = `slide_${i + 1}.jpg`;
        document.body.appendChild(imgLink);
        imgLink.click();
        document.body.removeChild(imgLink);
        
        // Wait a bit to avoid download blocking
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Download audio
        const audioLink = document.createElement('a');
        audioLink.href = slide.audioUrl;
        audioLink.download = `slide_${i + 1}_audio.mp3`;
        document.body.appendChild(audioLink);
        audioLink.click();
        document.body.removeChild(audioLink);
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
        toast.loading(`Downloaded ${i + 1}/${slides.length} slides...`, { id: 'download-slides' });
      }

      toast.success('All slides downloaded! Use Windows Photos, iMovie, or CapCut to combine them into a video.', { 
        id: 'download-slides',
        duration: 8000 
      });
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to download: ' + error.message, { id: 'download-slides' });
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const handleDownloadMP4 = async () => {
    if (slides.length === 0) {
      toast.error('Add slides first!');
      return;
    }

    const missingAudio = slides.filter(s => !s.audioUrl);
    if (missingAudio.length > 0) {
      toast.error(`All slides must have voiceover audio! ${missingAudio.length} slide(s) are missing audio.`);
      return;
    }

    setIsGeneratingVideo(true);
    toast.loading('Preparing video... Loading all audio files first.', { id: 'generate-mp4' });

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');

      // STEP 1: Pre-load ALL images and audio with their exact durations
      const slideData = [];
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        toast.loading(`Loading slide ${i + 1}/${slides.length}...`, { id: 'generate-mp4' });

        // Load image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = slide.imageUrl;
        });

        // Load audio and get exact duration
        const audioResponse = await fetch(slide.audioUrl);
        const audioArrayBuffer = await audioResponse.arrayBuffer();
        
        // Decode to get exact duration
        const tempAudioContext = new AudioContext();
        const audioBuffer = await tempAudioContext.decodeAudioData(audioArrayBuffer.slice(0));
        const exactDuration = audioBuffer.duration;
        await tempAudioContext.close();

        slideData.push({
          img,
          audioArrayBuffer: audioArrayBuffer.slice(0), // Clone buffer
          duration: exactDuration,
          audioUrl: slide.audioUrl
        });
      }

      toast.loading('Recording video with synchronized audio...', { id: 'generate-mp4' });

      // STEP 2: Create audio context for recording
      const audioContext = new AudioContext();
      const audioDestination = audioContext.createMediaStreamDestination();

      // Combine video and audio streams
      const videoStream = canvas.captureStream(30);
      const combinedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ]);

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: 3000000,
        audioBitsPerSecond: 192000
      });

      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.start(100); // Collect data every 100ms for smoother output

      // STEP 3: Process each slide with EXACT timing
      const fps = 30;
      const frameInterval = 1000 / fps;

      for (let i = 0; i < slideData.length; i++) {
        const { img, audioArrayBuffer, duration } = slideData[i];
        toast.loading(`Recording slide ${i + 1}/${slideData.length}...`, { id: 'generate-mp4' });

        // Draw the slide image immediately
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
        const x = (canvas.width - img.width * scale) / 2;
        const y = (canvas.height - img.height * scale) / 2;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

        // Start audio playback for this slide
        const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioDestination);
        
        const audioStartTime = audioContext.currentTime;
        source.start(audioStartTime);

        // Calculate exact number of frames needed for this audio
        // Add small buffer (0.1s) to ensure audio completes before slide change
        const totalDurationMs = (duration + 0.1) * 1000;
        const totalFrames = Math.ceil(totalDurationMs / frameInterval);

        // Hold this frame for the exact duration of the audio
        for (let frame = 0; frame < totalFrames; frame++) {
          // Redraw same image (keeps canvas active for capture)
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
          
          // Wait exactly one frame interval
          await new Promise(resolve => setTimeout(resolve, frameInterval));
        }

        // Ensure audio is fully stopped before next slide
        try {
          source.stop();
        } catch (e) {
          // Audio may have already stopped naturally
        }

        // Small gap between slides for cleaner transitions
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Stop recording
      mediaRecorder.stop();

      await new Promise(resolve => {
        mediaRecorder.onstop = resolve;
      });

      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${videoTitle || 'training_video'}.webm`;
      a.click();
      
      URL.revokeObjectURL(url);
      await audioContext.close();

      toast.success('Video downloaded! Audio and slides are now properly synchronized.', { id: 'generate-mp4' });
    } catch (error) {
      console.error('Video generation error:', error);
      toast.error('Failed to generate video: ' + error.message, { id: 'generate-mp4' });
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Video className="w-8 h-8 text-purple-600" />
            {t.sidebar.videoTraining}
          </h1>
          <p className="text-gray-600 mt-2">Create step-by-step training videos using real CRM screenshots with AI voiceovers</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleNewVideo}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t.common.new}
          </Button>
          <Button
            onClick={handleSaveVideo}
            disabled={slides.length === 0 || saveVideoMutation.isPending}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
            title={slides.length === 0 ? "Add slides to enable save" : "Save your video"}
          >
            {saveVideoMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {currentVideoId ? t.common.update : t.common.save}
          </Button>
          <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4" />
                {t.common.view}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t.sidebar.videoTraining}</DialogTitle>
                <DialogDescription>Load a previously saved video to continue editing or add to Knowledge Base</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 mt-4">
                {savedVideos.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Video className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>{t.common.noResults}</p>
                  </div>
                ) : (
                  <>
                    {selectedVideoIds.length > 0 && (
                      <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                        <p className="text-sm font-medium text-blue-900">
                          {selectedVideoIds.length} video{selectedVideoIds.length > 1 ? 's' : ''} selected
                        </p>
                        <Button
                          size="sm"
                          onClick={handleBulkAddToKnowledgeBase}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <BookOpen className="w-4 h-4 mr-2" />
                          {t.sidebar.knowledgeBase}
                        </Button>
                      </div>
                    )}
                    {savedVideos.map((video) => (
                      <Card key={video.id} className="hover:bg-gray-50">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={selectedVideoIds.includes(video.id)}
                              onCheckedChange={(checked) => {
                                setSelectedVideoIds(prev => 
                                  checked 
                                    ? [...prev, video.id]
                                    : prev.filter(id => id !== video.id)
                                );
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex-1 cursor-pointer" onClick={() => handleLoadVideo(video)}>
                              <h3 className="font-semibold">{video.title}</h3>
                              <p className="text-sm text-gray-500 mt-1">
                                {video.slides?.length || 0} slides • 
                                {video.status === 'completed' ? ' Video generated' : ' Draft'}
                              </p>
                              <p className="text-xs text-gray-400 mt-1">
                                Last updated: {new Date(video.updated_date).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              {video.video_url && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(video.video_url, '_blank');
                                  }}
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                              )}
                              {video.company_id === myCompany?.id && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('Delete this video?')) {
                                      deleteVideoMutation.mutate(video.id);
                                    }
                                  }}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Slide Builder */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
              <CardHeader>
                <CardTitle>{t.sidebar.videoTraining}</CardTitle>
                <CardDescription>Upload CRM screenshots and add narration for each step</CardDescription>
              </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t.common.name}</Label>
                <Input
                  value={videoTitle}
                  onChange={(e) => setVideoTitle(e.target.value)}
                  placeholder="e.g., How to Create an Estimate"
                />
              </div>

              <div>
                <Label>{t.common.description} (Optional)</Label>
                <Textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="Add specific context or instructions to help AI generate better narration. Example: 'Focus on the buttons in the top right corner' or 'Explain why this step is important for insurance claims'"
                  rows={3}
                  className="text-sm"
                />
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-500">
                    Use this to fix misaligned narration - tell the AI what to focus on in your screenshots
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (!customInstructions?.trim()) {
                        toast.error('Please enter instructions first');
                        return;
                      }
                      try {
                        if (currentVideoId) {
                          await base44.entities.TrainingVideo.update(currentVideoId, { custom_instructions: customInstructions });
                          toast.success('Instructions saved');
                        } else {
                          handleSaveVideo(); // will save with instructions included
                        }
                      } catch (e) {
                        toast.error('Failed to save instructions: ' + e.message);
                      }
                    }}
                  >
                    {t.common.save}
                  </Button>
                </div>
              </div>

              <div>
                <Label>{t.ai.aiAssistant}</Label>
                <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {elevenLabsVoices.map((voice) => (
                      <SelectItem key={voice.id} value={voice.id}>
                        {voice.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
                  onChange={handleImageUpload}
                  className="hidden"
                  id="screenshot-upload"
                  multiple
                />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={handleInsertSlide}
                  className="hidden"
                  id="insert-slide-input"
                  onClick={(e) => { (e.target).value = null; }}
                />
                <label htmlFor="screenshot-upload" className="cursor-pointer">
                  <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                  <p className="font-medium text-gray-700">{t.common.upload} Screenshots or PDF</p>
                  <p className="text-sm text-gray-500 mt-1">Select multiple images or one PDF</p>
                  <p className="text-xs text-blue-600 mt-3 font-medium">Upload all slides first, then add topics to generate cohesive narration!</p>
                </label>
              </div>

              {/* Master Narration Button */}
              {slides.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 space-y-4">
                  <h3 className="text-lg font-semibold text-blue-900 text-center">Step 2: Generate Cohesive Narration</h3>
                  <p className="text-sm text-blue-700 max-w-2xl mx-auto text-center">
                    Fill in the <strong>Slide Topic</strong> for each slide below, then click the button. 
                    The AI will analyze ALL slides together to create a smooth, connected video script.
                  </p>
                  
                  <div className="bg-white rounded-lg p-4 border border-blue-100">
                    <Label className="text-sm font-semibold text-blue-800 mb-2 block">
                      Master Narration Instructions (Optional)
                    </Label>
                    <Textarea
                      value={masterNarrationPrompt}
                      onChange={(e) => setMasterNarrationPrompt(e.target.value)}
                      placeholder="Tell the AI how you want the narration to be generated:

Examples:
• 'Make it short and concise, 1-2 sentences per slide'
• 'Make it detailed for training new employees'
• 'Focus on the buttons and menu items visible in screenshots'
• 'This is a video about creating estimates for insurance claims'
• 'Use a friendly, conversational tone'
• 'Emphasize the step-by-step process'"
                      rows={4}
                      className="text-sm resize-none"
                    />
                    <p className="text-xs text-blue-600 mt-2">
                      Be specific! Tell the AI the video's purpose, desired length (short/long), tone, and focus areas.
                    </p>
                  </div>
                  
                  <div className="text-center">
                    <Button
                      onClick={() => generateMasterNarrationMutation.mutate()}
                      disabled={generateMasterNarrationMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700 text-lg py-6 px-8 h-auto shadow-lg"
                    >
                      {generateMasterNarrationMutation.isPending ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          {t.common.loading} {slides.length} slides...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-5 h-5 mr-2" />
                          {t.ai.generating}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Show example slide structure if no slides yet */}
              {slides.length === 0 && (
                <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <p className="text-sm font-semibold text-gray-700 mb-3">Preview: After uploading, each slide will have:</p>
                  <div className="space-y-2 opacity-60">
                    <div className="flex gap-3">
                      <div className="w-24 h-16 bg-gray-300 rounded flex items-center justify-center text-xs text-gray-500">
                        Screenshot
                      </div>
                      <div className="flex-1 space-y-2">
                        <Input placeholder="Caption (optional)" disabled />
                        <Textarea 
                          placeholder="Type your narration script here - what should the AI voice say for this slide?"
                          rows={2}
                          disabled
                          className="border-2 border-blue-300"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {slides.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{slides.length} {t.mobileNav.tools}</h3>
                    <div className="flex gap-2">
                      <Button
                        onClick={generateAllVoiceovers}
                        disabled={generatingVoiceover || slides.every(s => !s.narration || s.audioUrl)}
                        size="sm"
                        variant="outline"
                      >
                        {generatingVoiceover ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {t.ai.generating}
                          </>
                        ) : (
                          t.ai.generating
                        )}
                      </Button>
                      <Button
                        onClick={async () => {
                          // Clear all audio URLs first
                          const slidesWithoutAudio = slides.map(s => ({ ...s, audioUrl: null }));
                          setSlides(slidesWithoutAudio);

                          // Wait a tick for state to update
                          await new Promise(resolve => setTimeout(resolve, 100));

                          // Generate all voiceovers
                          generateAllVoiceovers();
                        }}
                        disabled={generatingVoiceover || slides.length === 0}
                        size="sm"
                      >
                        {t.common.refresh}
                      </Button>
                    </div>
                  </div>

                  {slides.map((slide, index) => (
                    <Card key={slide.id} className="group relative transition-all hover:shadow-md">
                      <CardContent className="p-4">
                        <div className="flex gap-4">
                            <div className="flex-shrink-0 relative group">
                            <div className="relative">
                              <img
                                src={slide.imageUrl}
                                alt={`Slide ${index + 1}`}
                                className="w-32 h-20 object-cover rounded border"
                              />
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded cursor-pointer">
                                <label className="cursor-pointer text-white text-xs font-medium flex flex-col items-center hover:scale-105 transition-transform">
                                  <Upload className="w-4 h-4 mb-1" />
                                  {t.common.refresh}
                                  <input 
                                    type="file" 
                                    className="hidden" 
                                    accept="image/png,image/jpeg,image/jpg,image/webp"
                                    onChange={(e) => handleReplaceImage(e, slide.id)}
                                    onClick={(e) => { (e.target).value = null; }} // Allow same file selection
                                  />
                                </label>
                              </div>
                            </div>
                            <p className="text-xs text-center text-gray-500 mt-1">{t.common.date} {index + 1}</p>
                          </div>
                          <div className="flex-1 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs font-semibold text-blue-600 flex items-center justify-between">
                                        {t.common.notes} ({t.common.optional})
                                        {slide.isAnalyzing && <span className="text-[10px] text-blue-500 animate-pulse flex items-center"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> {t.ai.thinking}</span>}
                                    </Label>
                                    <Input
                                        placeholder={slide.isAnalyzing ? t.ai.thinking : "e.g. 'Sidebar Menu' or 'Creating a Lead'"}
                                        value={slide.topic || ''}
                                        onChange={(e) => updateSlide(slide.id, 'topic', e.target.value)}
                                        className={`border-blue-200 bg-blue-50 transition-all ${slide.isAnalyzing ? "opacity-70" : ""}`}
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs text-gray-500">{t.common.notes} ({t.common.optional})</Label>
                                    <Input
                                        placeholder="Overlay text shown on video"
                                        value={slide.caption}
                                        onChange={(e) => updateSlide(slide.id, 'caption', e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs text-gray-500">Focus Area (Allowed)</Label>
                                    <Input
                                        placeholder="e.g. 'Left Sidebar only'"
                                        value={slide.focus_area || ''}
                                        onChange={(e) => updateSlide(slide.id, 'focus_area', e.target.value)}
                                        className="text-sm"
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs text-gray-500">Ignore Area (Hidden)</Label>
                                    <Input
                                        placeholder="e.g. 'Dashboard widgets'"
                                        value={slide.ignore_area || ''}
                                        onChange={(e) => updateSlide(slide.id, 'ignore_area', e.target.value)}
                                        className="text-sm"
                                    />
                                </div>
                            </div>

                            <div className="relative">
                              <Label className="text-xs font-semibold mb-1 block">{t.common.description}</Label>
                              <Textarea
                                placeholder={slide.narration ? "" : "Click 'Generate Master Narration' above to fill this automatically..."}
                                value={slide.narration}
                                onChange={(e) => updateSlide(slide.id, 'narration', e.target.value)}
                                rows={4}
                                className="pr-20 min-h-[100px]"
                              />
                              <div className="absolute top-2 right-2 flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => regenerateVoiceover(slide.id, slide.narration)}
                                  disabled={generateVoiceoverMutation.isPending}
                                  className="text-green-600 hover:text-green-700 h-7 w-7"
                                  title="Generate audio from text"
                                >
                                  <Play className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                            
                            <div className="flex gap-2 items-center bg-blue-50/50 p-2 rounded-md border border-blue-100">
                                <Input 
                                    placeholder="Tell AI how to improve this (e.g. 'Mention the Save button', 'Make it shorter')" 
                                    value={slide.improvementPrompt || ''}
                                    onChange={(e) => updateSlide(slide.id, 'improvementPrompt', e.target.value)}
                                    className="text-xs h-8 bg-white"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            expandNarrationMutation.mutate({
                                                slideId: slide.id,
                                                currentNarration: slide.narration,
                                                topic: slide.topic,
                                                imageUrl: slide.imageUrl,
                                                improvementPrompt: slide.improvementPrompt
                                            });
                                        }
                                    }}
                                />
                                <Button 
                                    size="sm"
                                    onClick={() => expandNarrationMutation.mutate({
                                        slideId: slide.id,
                                        currentNarration: slide.narration,
                                        topic: slide.topic,
                                        imageUrl: slide.imageUrl,
                                        improvementPrompt: slide.improvementPrompt
                                    })}
                                    disabled={expandNarrationMutation.isPending && expandNarrationMutation.variables?.slideId === slide.id}
                                    className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-xs shrink-0"
                                >
                                    {expandNarrationMutation.isPending && expandNarrationMutation.variables?.slideId === slide.id ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                        <>
                                            <Sparkles className="w-3 h-3 mr-1.5" />
                                            {t.common.update}
                                        </>
                                    )}
                                </Button>
                            </div>
                            {slide.audioUrl && (
                              <audio
                                controls
                                className="w-full h-8"
                                src={slide.audioUrl}
                                key={slide.audioUrl}
                                preload="metadata"
                              />
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeSlide(slide.id)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        
                        {/* Insert Button (Bottom Center) */}
                        <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-6 text-xs shadow-md border rounded-full bg-white hover:bg-blue-50 text-blue-600"
                            onClick={() => {
                              setInsertIndex(index + 1);
                              document.getElementById('insert-slide-input').click();
                            }}
                            title="Insert new slide after this one"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Insert Next
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Preview */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t.common.view}</CardTitle>
              <CardDescription>See how your training will look</CardDescription>
            </CardHeader>
            <CardContent>
              {slides.length === 0 ? (
                <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <ImageIcon className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                    <p className="text-sm">{t.common.upload} screenshots to begin</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative aspect-video bg-black rounded-lg overflow-hidden border-2 border-gray-300">
                    {slides[currentSlide]?.imageUrl ? (
                      <img
                        src={slides[currentSlide].imageUrl}
                        alt={`Slide ${currentSlide + 1}`}
                        className="w-full h-full object-contain"
                        crossOrigin="anonymous"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white">
                        <p>{t.common.noResults}</p>
                      </div>
                    )}

                    {/* Slide counter overlay */}
                    <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white px-3 py-1 rounded-full text-sm font-medium">
                      {t.common.date} {currentSlide + 1} of {slides.length}
                    </div>

                    {slides[currentSlide]?.caption && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white p-4">
                        <p className="text-center">{slides[currentSlide].caption}</p>
                      </div>
                    )}

                    {isPlaying && (
                      <div className="absolute top-4 left-4 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 animate-pulse">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                        PLAYING
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
                      disabled={currentSlide === 0}
                    >
                      {t.common.previous}
                    </Button>
                    <div className="flex-1 text-center text-sm text-gray-600">
                      {currentSlide + 1} / {slides.length}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentSlide(Math.min(slides.length - 1, currentSlide + 1))}
                      disabled={currentSlide === slides.length - 1}
                    >
                      {t.common.next}
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {!isPlaying ? (
                      <Button
                        onClick={playPresentation}
                        className="w-full bg-purple-600 hover:bg-purple-700"
                      >
                        <Play className="w-4 h-4 mr-2" />
                        {t.common.view}
                      </Button>
                    ) : (
                      <Button
                        onClick={stopPresentation}
                        variant="outline"
                        className="w-full border-red-300 text-red-600 hover:bg-red-50"
                      >
                        <X className="w-4 h-4 mr-2" />
                        {t.common.close}
                      </Button>
                    )}



                    <Button
                      onClick={() => {
                        if (!currentVideoId) {
                          toast.error('Please save the video first!');
                          return;
                        }
                        const shareUrl = `${window.location.origin}${createPageUrl('TrainingVideoPlayer')}?id=${currentVideoId}`;
                        navigator.clipboard.writeText(shareUrl);
                        toast.success('Share link copied to clipboard!\n\nSend this link to your team.');
                        window.open(shareUrl, '_blank');
                      }}
                      disabled={!currentVideoId}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      <Video className="w-4 h-4 mr-2" />
                      {currentVideoId ? t.common.view : t.common.save}
                    </Button>

                    <Button
                      onClick={handleAddToKnowledgeBase}
                      disabled={!currentVideoId}
                      className="w-full bg-green-600 hover:bg-green-700"
                    >
                      <BookOpen className="w-4 h-4 mr-2" />
                      {t.sidebar.knowledgeBase}
                    </Button>

                    <Button
                      onClick={handleDownloadMP4}
                      disabled={isGeneratingVideo || slides.length === 0 || slides.some(s => !s.audioUrl)}
                      className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold shadow-lg"
                    >
                      {isGeneratingVideo ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t.common.loading}
                        </>
                      ) : (
                        <>
                          <Video className="w-4 h-4 mr-2" />
                          {t.common.download} (MP4)
                        </>
                      )}
                    </Button>
                    
                    {slides.some(s => !s.audioUrl) && (
                      <p className="text-xs text-red-600 text-center mt-1">
                        Generate all voiceovers first
                      </p>
                    )}
                    
                    <p className="text-xs text-gray-500 text-center mt-2">
                      Downloads a complete MP4 video with all slides and audio combined.
                    </p>

                    <Button
                      onClick={handleDownloadSlides}
                      disabled={isGeneratingVideo || slides.length === 0}
                      variant="outline"
                      className="w-full"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {t.common.download}
                    </Button>
                    </div>

                  {/* Hidden audio player for auto-play */}
                  <audio 
                    ref={audioRef} 
                    onEnded={handleAudioEnded}
                    className="hidden"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Alert className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <AlertDescription className="text-sm text-purple-900">
              <strong>AI-Powered Training Builder:</strong>
              <ul className="mt-2 ml-4 space-y-1 text-xs">
                <li>1. Take screenshots of your CRM workflow</li>
                <li>2. Upload them - AI analyzes each screenshot</li>
                <li>3. AI generates detailed narration automatically</li>
                <li>4. Edit narration if needed (or regenerate)</li>
                <li>5. Generate AI voiceovers</li>
                <li>6. Click "Generate & Download MP4" - processed in your browser!</li>
              </ul>
              <p className="mt-3 text-xs font-semibold text-purple-700">
                Download slides + audio, then use FREE desktop software (Windows Photos/iMovie/CapCut) to compile!
              </p>
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>{t.sidebar.videoTraining}</CardTitle>
              <CardDescription>Manage your saved training videos</CardDescription>
            </CardHeader>
            <CardContent>
              {savedVideos.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">{t.common.noResults}.</p>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                  {savedVideos.map((video) => (
                    <div key={video.id} className="flex items-start justify-between p-3 border rounded-lg hover:bg-gray-50 group transition-colors">
                      <div className="cursor-pointer flex-1" onClick={() => handleLoadVideo(video)}>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm group-hover:text-purple-600 transition-colors line-clamp-1">{video.title}</h4>
                          {video.status === 'completed' && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">Ready</span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {video.slides?.length || 0} slides • {new Date(video.updated_date || video.created_date).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0 ml-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          onClick={() => handleLoadVideo(video)}
                          title={t.common.edit}
                        >
                          <FolderOpen className="w-4 h-4" />
                        </Button>
                        
                        {video.video_url && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(video.video_url, '_blank');
                            }}
                            title="Download Video"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        )}

                        {video.company_id === myCompany?.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm('Delete this video?')) {
                                deleteVideoMutation.mutate(video.id);
                              }
                            }}
                            title={t.common.delete}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}