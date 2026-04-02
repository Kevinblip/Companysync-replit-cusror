import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mic, Send, Loader2, Paperclip, Volume2, AlertCircle, Save, MessageSquare, Plus, Trash2, Upload, CheckCircle2, Edit, Star, TrendingUp, Brain, Lightbulb, Sparkles, Settings as SettingsIcon, Square } from "lucide-react";
import { format } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import ReactMarkdown from "react-markdown";
import GeminiLiveNativeClient from "@/components/ai/GeminiLiveNativeClient";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

export default function LexiWorkspace() {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessionName, setSessionName] = useState("");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [microphoneError, setMicrophoneError] = useState(null);
  const [microphonePermission, setMicrophonePermission] = useState('unknown');
  const [isTesting, setIsTesting] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isWaitingForHeyLexi, setIsWaitingForHeyLexi] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [showConfirmationDialog, setShowConfirmationDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [nativeVoiceMode, setNativeVoiceMode] = useState(false);

  // Memory state
  const [showAddMemory, setShowAddMemory] = useState(false);
  const [editingMemory, setEditingMemory] = useState(null);
  const [memoryForm, setMemoryForm] = useState({
    key: "",
    value: "",
    description: "",
    importance: 5,
    category: "lexi"
  });
  
  // Settings state
  const [voiceId, setVoiceId] = useState('Kore');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [engine, setEngine] = useState('gemini');
  const [loadedFromDB, setLoadedFromDB] = useState(false);
  const [engineDirty, setEngineDirty] = useState(false);
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const wakeWordRecognitionRef = useRef(null);
  const interruptRecognitionRef = useRef(null);
  const isInterruptRunningRef = useRef(false);
  const audioRef = useRef(null);
  const isRecognitionRunningRef = useRef(false);
  const isWakeWordRunningRef = useRef(false);

  const queryClient = useQueryClient();

  const testMicrophone = async () => {
    setIsTesting(true);
    setMicrophoneError(null);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      stream.getTracks().forEach(track => track.stop());
      setMicrophonePermission('granted');
      setMicrophoneError(null);
      alert('✅ Microphone is working! You can now use voice features.');
    } catch (error) {
      console.error('Microphone test failed:', error);
      setMicrophonePermission('denied');
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setMicrophoneError('⚠️ Microphone permission denied. Go to browser settings and allow microphone access.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setMicrophoneError('❌ No microphone found on this device.');
      } else if (error.name === 'NotSupportedError') {
        setMicrophoneError('❌ Microphone not supported on this browser.');
      } else {
        setMicrophoneError('Microphone access error: ' + error.message);
      }
    } finally {
      setIsTesting(false);
    }
  };

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  useEffect(() => {
    base44.auth.me().then((u) => {
      setUser(u);
    }).catch(() => {});
  }, []);

  // Set initial greeting message once we have both user and staff profile
  useEffect(() => {
    if (!user || messages.length > 0) return;

    const staffProfile = staffProfiles.find(s => s.user_email === user.email);
    const displayName = staffProfile?.full_name?.split(' ')[0] || user.full_name?.split(' ')[0] || user.email.split('@')[0];
    
    setMessages([{
      role: 'assistant',
      content: `👋 Hi ${displayName}! I'm Lexi, your AI assistant. How can I help you today?`,
      timestamp: new Date().toISOString()
    }]);
  }, [user, staffProfiles]);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date", 1),
    initialData: [],
  });

  const myCompany = React.useMemo(() => {
    return companies.find(c => c.created_by === user?.email) || companies[0];
  }, [companies, user]);

  const { data: savedConversations = [] } = useQuery({
    queryKey: ['lexi-conversations', user?.email],
    queryFn: () => user ? base44.entities.ConversationHistory.filter({ 
      user_email: user.email,
      ai_assistant: 'lexi'
    }, '-created_date', 50) : [],
    enabled: !!user,
    initialData: [],
  });

  const conversationSessions = React.useMemo(() => {
    const sessions = {};
    savedConversations.forEach(msg => {
      if (!sessions[msg.session_id]) {
        sessions[msg.session_id] = {
          session_id: msg.session_id,
          messages: [],
          last_updated: msg.created_date,
          summary: msg.context_summary || 'Conversation'
        };
      }
      sessions[msg.session_id].messages.push(msg);
      if (msg.created_date > sessions[msg.session_id].last_updated) {
        sessions[msg.session_id].last_updated = msg.created_date;
      }
    });
    
    return Object.values(sessions).sort((a, b) => 
      new Date(b.last_updated) - new Date(a.last_updated)
    );
  }, [savedConversations]);

  // Load AI memories
  const { data: memories = [] } = useQuery({
    queryKey: ['ai-memories', user?.email],
    queryFn: () => user ? base44.entities.AIMemory.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  // Load pending Lexi approval tasks
  const { data: pendingApprovals = [], refetch: refetchApprovals } = useQuery({
    queryKey: ['lexi-approvals', myCompany?.id],
    queryFn: () => myCompany?.id
      ? base44.entities.Task.filter({ company_id: myCompany.id, status: 'pending_ai_approval' }, '-created_at', 50)
      : [],
    enabled: !!myCompany?.id,
    initialData: [],
    refetchInterval: 15000,
  });

  const activeMemories = memories.filter(m => m.is_active);
  const inactiveMemories = memories.filter(m => !m.is_active);

  // Load Lexi settings from company
  useEffect(() => {
    if (!myCompany || loadedFromDB) return;
    setVoiceId(myCompany.lexi_voice_id || 'Puck');
    setSystemPrompt(myCompany.lexi_system_prompt || '');
    setVoiceEnabled(myCompany.lexi_voice_enabled !== false);
    const newEngine = myCompany.lexi_engine || 'gemini';
    setEngine(newEngine);
    setLoadedFromDB(true);
  }, [myCompany, loadedFromDB]);

  const saveConversationMutation = useMutation({
    mutationFn: async ({ sessionId, name }) => {
      const sessionMessages = messages.filter(m => m.role !== 'system');
      
      let conversationName = name;
      if (!conversationName || conversationName === 'Conversation') {
        const firstUserMessage = sessionMessages.find(m => m.role === 'user');
        if (firstUserMessage) {
          conversationName = firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '');
        } else {
          conversationName = 'Conversation';
        }
      }
      
      for (const msg of sessionMessages) {
        await base44.entities.ConversationHistory.create({
          user_email: user.email,
          ai_assistant: 'lexi',
          session_id: sessionId,
          message_role: msg.role,
          message_content: msg.content,
          context_summary: conversationName,
          importance: 5
        });
      }
      
      return sessionId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lexi-conversations'] });
      setShowSaveDialog(false);
      setSessionName("");
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async (sessionId) => {
      const messagesToDelete = savedConversations.filter(m => m.session_id === sessionId);
      for (const msg of messagesToDelete) {
        await base44.entities.ConversationHistory.delete(msg.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lexi-conversations'] });
    },
  });

  // Memory mutations
  const createMemoryMutation = useMutation({
    mutationFn: (data) => base44.entities.AIMemory.create({
      ...data,
      user_email: user.email,
      is_active: true
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-memories'] });
      setShowAddMemory(false);
      setMemoryForm({ key: "", value: "", description: "", importance: 5, category: "lexi" });
    },
  });

  const updateMemoryMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AIMemory.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-memories'] });
      setEditingMemory(null);
      setShowAddMemory(false);
    },
  });

  const deleteMemoryMutation = useMutation({
    mutationFn: (id) => base44.entities.AIMemory.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-memories'] });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => base44.entities.AIMemory.update(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-memories'] });
    },
  });

  // Save settings mutation
  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Company.update(myCompany.id, {
        lexi_voice_id: voiceId,
        lexi_system_prompt: systemPrompt,
        lexi_voice_enabled: voiceEnabled,
        lexi_engine: engine
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      alert("✅ Lexi settings saved!");
    },
  });

  const testVoice = async () => {
    try {
      alert('🔊 Testing voice...');
      
      const response = await base44.functions.invoke('geminiTTS', {
        text: "Hi! I'm Lexi, your AI assistant. This is how I sound with the selected voice.",
        voice: voiceId,
        assistantName: 'lexi'
      });

      let audioBlob;

      if (response.data && typeof response.data === 'object' && response.data.audio_url) {
        const res = await fetch(response.data.audio_url);
        audioBlob = await res.blob();
      } else if (response.data instanceof Blob) {
        audioBlob = response.data;
      } else if (response.data instanceof ArrayBuffer) {
        audioBlob = new Blob([response.data], { type: 'audio/mpeg' });
      } else if (response.data instanceof Uint8Array) {
        audioBlob = new Blob([response.data], { type: 'audio/mpeg' });
      } else if (typeof response.data === 'string' && response.data.startsWith('data:')) {
        const res = await fetch(response.data);
        audioBlob = await res.blob();
      } else {
        throw new Error('Received invalid audio format.');
      }

      if (audioBlob.size === 0) {
        throw new Error('Received empty audio.');
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      await audio.play();
      alert('✅ Voice preview played!');
    } catch (error) {
      console.error('❌ Test voice error:', error);
      alert(error.message || 'Failed to test voice');
    }
  };

  const geminiVoices = [
    { id: 'Aoede',  name: 'Aoede — Warm, Clear ♀' },
    { id: 'Kore',   name: 'Kore — Bright, Energetic ♀' },
    { id: 'Leda',   name: 'Leda — Soft, Soothing ♀' },
    { id: 'Zephyr', name: 'Zephyr — Calm, Breezy ♀' },
    { id: 'Charon', name: 'Charon — Informational ♂' },
    { id: 'Fenrir', name: 'Fenrir — Excitable, Bold ♂' },
    { id: 'Orus',   name: 'Orus — Firm, Steady ♂' },
    { id: 'Puck',   name: 'Puck — Upbeat, Playful ♂' },
  ];

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        setMicrophoneError('Speech recognition not supported. Please use Chrome, Edge, or Safari.');
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      recognition.timeout = 8000;  // 8 second timeout

      recognition.onstart = () => {
        console.log('🎤 Speech recognition started');
        isRecognitionRunningRef.current = true;
        setIsListening(true);
        setMicrophoneError(null);
      };

      recognition.onresult = async (event) => {
        const browserTranscript = event.results[0][0].transcript;
        console.log('🎤 Speech detected:', browserTranscript);
        console.log('📊 Audio chunks collected:', audioChunksRef.current.length);

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          console.log('⏹️ Stopping MediaRecorder...');
          mediaRecorderRef.current.stop();

          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());

          mediaRecorderRef.current.onstop = async () => {
            console.log('✅ MediaRecorder stopped, processing audio...');

            if (audioChunksRef.current.length === 0) {
              console.warn('⚠️ No audio chunks captured, using browser transcript');
              setInput(browserTranscript);
              setIsListening(false);

              if (voiceMode && browserTranscript.trim()) {
                setTimeout(() => handleSendMessage(browserTranscript, true), 100);
              }
              return;
            }

            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            console.log('📦 Audio blob created:', audioBlob.size, 'bytes');

            try {
              console.log('🚀 Sending to Whisper...');
              const formData = new FormData();
              formData.append('audio', audioBlob, 'recording.webm');

              const response = await base44.functions.invoke('lexiVoiceTranscribe', formData);
              console.log('📥 Whisper response:', response);

              if (response.data?.success && response.data?.text) {
                const transcript = response.data.text;
                console.log('✅ Whisper transcription:', transcript);

                setInput(transcript);
                setIsListening(false);

                if (voiceMode && transcript.trim()) {
                  setTimeout(() => handleSendMessage(transcript, true), 100);
                }
              } else if (response.data?.fallback) {
                console.log('⚠️ Whisper unavailable, using browser:', browserTranscript);
                setInput(browserTranscript);
                setIsListening(false);

                if (voiceMode && browserTranscript.trim()) {
                  setTimeout(() => handleSendMessage(browserTranscript, true), 100);
                }
              } else {
                console.log('⚠️ No valid transcription, using browser:', browserTranscript);
                setInput(browserTranscript);
                setIsListening(false);

                if (voiceMode && browserTranscript.trim()) {
                  setTimeout(() => handleSendMessage(browserTranscript, true), 100);
                }
              }
            } catch (error) {
              console.error('❌ Whisper error:', error);
              console.log('🔄 Fallback to browser transcript:', browserTranscript);
              setInput(browserTranscript);
              setIsListening(false);

              if (voiceMode && browserTranscript.trim()) {
                setTimeout(() => handleSendMessage(browserTranscript, true), 100);
              }
            }
          };
        } else {
          console.log('⚠️ MediaRecorder not active, using browser transcript');
          setInput(browserTranscript);
          setIsListening(false);

          if (voiceMode && browserTranscript.trim()) {
            setTimeout(() => handleSendMessage(browserTranscript, true), 100);
          }
        }
      };

      recognition.onerror = (event) => {
        console.error('🎤 Speech recognition error:', event.error);
        isRecognitionRunningRef.current = false;
        setIsListening(false);

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setMicrophoneError('⚠️ Microphone access denied. Click "Test Microphone" to grant permission.');
          setMicrophonePermission('denied');
        } else if (event.error === 'aborted') {
          console.log('🛑 Recognition aborted (manual stop)');
          setMicrophoneError(null);
        } else if (event.error === 'no-speech') {
          setMicrophoneError('No speech detected. Please try again and speak clearly.');
        } else if (event.error === 'network') {
          setMicrophoneError('Network error. Please check your internet connection.');
        } else {
          setMicrophoneError(`Error: ${event.error}. Please try again.`);
        }
      };

      recognition.onend = () => {
        console.log('🎤 Speech recognition ended');
        isRecognitionRunningRef.current = false;
        setIsListening(false);

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }

        if (voiceMode && !isSpeaking) {
          setTimeout(() => {
            if (voiceMode && recognitionRef.current && !isRecognitionRunningRef.current && !isSpeaking) {
              try {
                recognitionRef.current.start();
                console.log('🎤 Auto-restarted listening (continuous voice mode)');
              } catch (e) {
                console.warn('Could not auto-restart recognition:', e.message);
              }
            }
          }, 1500);
        }
      };

      recognitionRef.current = recognition;

      return () => {
        if (isRecognitionRunningRef.current) {
          try {
            recognition.stop();
          } catch (e) {
            console.log('Cleanup: recognition already stopped or not running', e);
          }
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      };
    }
  }, [voiceMode]);

  useEffect(() => {
    if (!voiceMode || typeof window === 'undefined') {
      if (wakeWordRecognitionRef.current && isWakeWordRunningRef.current) {
        try {
          wakeWordRecognitionRef.current.stop();
          isWakeWordRunningRef.current = false;
        } catch (e) {}
      }
      setIsWaitingForHeyLexi(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setMicrophoneError('Speech recognition not supported in this browser.');
      setVoiceMode(false);
      return;
    }

    const wakeWordRecognition = new SpeechRecognition();
    wakeWordRecognition.continuous = true;
    wakeWordRecognition.interimResults = true;
    wakeWordRecognition.lang = 'en-US';
    wakeWordRecognition.timeout = 0;  // Keep listening indefinitely on mobile

    wakeWordRecognition.onstart = () => {
      isWakeWordRunningRef.current = true;
      setIsWaitingForHeyLexi(true);
      setMicrophoneError(null);
    };

    wakeWordRecognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(result => result[0].transcript)
        .join('')
        .toLowerCase();

      console.log('🎤 Heard:', transcript);

      if (transcript.includes('hey lexi') || transcript.includes('hey lexie') || transcript.includes('ok lexi') || transcript.includes('hey lexy')) {
        console.log('✅ Wake word detected:', transcript);
        
        try {
          if (isWakeWordRunningRef.current) {
            wakeWordRecognition.stop();
            isWakeWordRunningRef.current = false;
          }
        } catch (e) {}
        
        setIsWaitingForHeyLexi(false);
        
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          oscillator.frequency.value = 800;
          oscillator.type = 'sine';
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.2);
        } catch (e) {}
        
        setTimeout(() => {
          if (recognitionRef.current && !isRecognitionRunningRef.current) {
            try {
              console.log('🎤 Starting listening after wake word...');
              recognitionRef.current.start();
            } catch (e) {
              console.error('❌ Failed to start listening:', e);
              setMicrophoneError('Failed to start listening. Please grant microphone permission.');
            }
          }
        }, 500);  // Increased delay for mobile
      }
    };

    wakeWordRecognition.onerror = (event) => {
      console.log('🎤 Wake word error:', event.error);
      isWakeWordRunningRef.current = false;
      
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicrophoneError('⚠️ Microphone access denied. Click "Enable Mic" to grant permission.');
        setMicrophonePermission('denied');
        setVoiceMode(false);
        return;
      }
      
      if (event.error === 'aborted') {
        console.log('🛑 Wake word aborted (manual stop)');
        return;
      }
      
      if (voiceMode && !isRecognitionRunningRef.current) {
        console.log('🔄 Restarting wake word detection...');
        setTimeout(() => {
          if (voiceMode && !isWakeWordRunningRef.current && !isRecognitionRunningRef.current) {
            try {
              wakeWordRecognition.start();
              console.log('✅ Wake word detection restarted');
            } catch (e) {
              console.error('❌ Failed to restart:', e);
            }
          }
        }, 1000);
      }
    };

    wakeWordRecognition.onend = () => {
      console.log('🎤 Wake word detection ended');
      isWakeWordRunningRef.current = false;
      
      if (voiceMode) {
        console.log('🔄 Auto-restarting wake word detection...');
        setTimeout(() => {
          if (voiceMode && !isWakeWordRunningRef.current && !isRecognitionRunningRef.current) {
            try {
              wakeWordRecognition.start();
              console.log('✅ Wake word detection restarted');
            } catch (e) {
              console.error('❌ Restart failed:', e);
            }
          }
        }, 300);
      } else {
        setIsWaitingForHeyLexi(false);
      }
    };

    wakeWordRecognitionRef.current = wakeWordRecognition;

    if (!isWakeWordRunningRef.current && !isRecognitionRunningRef.current) {
      try {
        wakeWordRecognition.start();
      } catch (e) {
        setMicrophoneError('Failed to start voice mode. Please click "Enable Mic".');
      }
    }

    return () => {
      if (isWakeWordRunningRef.current) {
        try {
          wakeWordRecognition.stop();
          isWakeWordRunningRef.current = false;
        } catch (e) {}
      }
    };
  }, [voiceMode]);

  const { data: knowledgeArticles = [] } = useQuery({
    queryKey: ['knowledge-base', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.KnowledgeBaseArticle.filter({
      company_id: myCompany.id,
      is_ai_training: true,
      is_published: true
    }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file) => {
      const response = await base44.integrations.Core.UploadFile({ file });
      return response.file_url;
    },
    onSuccess: async (avatarUrl) => {
      if (myCompany) {
        await base44.entities.Company.update(myCompany.id, {
          lexi_avatar_url: avatarUrl
        });
        queryClient.invalidateQueries({ queryKey: ['companies'] });
      }
    },
  });

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    setUploadingAvatar(true);
    try {
      const newAvatarUrl = await uploadAvatarMutation.mutateAsync(file);
      alert('✅ Lexi avatar updated successfully!');
    } catch (error) {
      alert('❌ Failed to upload avatar: ' + error.message);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const speakResponse = async (text) => {
    try {
      setIsSpeaking(true);
      console.log('🔊 Attempting Gemini TTS with Kore voice for Lexi...');

      const response = await base44.functions.invoke('geminiTTS', {
        text: text,
        assistantName: 'lexi'
      });

      console.log('🔊 Gemini TTS response:', response);

      if (response.data?.audio_url) {
        console.log('✅ Got Gemini TTS audio URL (Kore voice):', response.data.audio_url);

        if (audioRef.current) {
          audioRef.current.src = response.data.audio_url;

          audioRef.current.onended = () => {
            setIsSpeaking(false);
            stopInterruptListener();
            console.log('🔊 Speech finished, auto-starting listening...');

            if (voiceMode && recognitionRef.current && !isRecognitionRunningRef.current) {
              setTimeout(() => {
                try {
                  recognitionRef.current.start();
                  console.log('🎤 Mic re-opened for continuous conversation');
                } catch (e) {
                  console.error('Failed to auto-start listening:', e);
                }
              }, 1500);
            }
          };

          if (recognitionRef.current && isRecognitionRunningRef.current) {
            try { recognitionRef.current.stop(); } catch (e) {}
          }

          await audioRef.current.play();
          startInterruptListener();
        }
      } else {
        console.warn('⚠️ Gemini TTS failed - falling back to browser speech synthesis');
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          utterance.onend = () => {
            setIsSpeaking(false);
            if (voiceMode && recognitionRef.current && !isRecognitionRunningRef.current) {
              setTimeout(() => { try { recognitionRef.current.start(); } catch (e) {} }, 1500);
            }
          };
          utterance.onerror = () => setIsSpeaking(false);
          window.speechSynthesis.speak(utterance);
        } else {
          setIsSpeaking(false);
        }
      }
    } catch (error) {
      console.error('❌ Speech error, falling back to browser TTS:', error);
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        try {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1.0;
          utterance.onend = () => setIsSpeaking(false);
          utterance.onerror = () => setIsSpeaking(false);
          window.speechSynthesis.speak(utterance);
        } catch (e) {
          setIsSpeaking(false);
        }
      } else {
        setIsSpeaking(false);
      }
    }
  };

  const stopInterruptListener = () => {
    if (interruptRecognitionRef.current && isInterruptRunningRef.current) {
      try {
        interruptRecognitionRef.current.stop();
      } catch (e) {}
      isInterruptRunningRef.current = false;
    }
  };

  const startInterruptListener = () => {
    if (!voiceMode || typeof window === 'undefined') return;
    stopInterruptListener();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const ir = new SpeechRecognition();
    ir.continuous = true;
    ir.interimResults = true;
    ir.lang = 'en-US';
    ir.maxAlternatives = 1;

    ir.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        if (/cancel|stop|shut up|be quiet|enough|never ?mind/i.test(text)) {
          console.log('🛑 Voice interrupt detected:', text);
          stopSpeaking();
          return;
        }
      }
    };

    ir.onstart = () => {
      isInterruptRunningRef.current = true;
      console.log('🎤 Interrupt listener active');
    };
    ir.onend = () => {
      isInterruptRunningRef.current = false;
    };
    ir.onerror = () => {
      isInterruptRunningRef.current = false;
    };

    interruptRecognitionRef.current = ir;
    try {
      ir.start();
    } catch (e) {
      console.warn('Could not start interrupt listener:', e.message);
    }
  };

  const stopSpeaking = () => {
    console.log('🛑 Stopping Lexi speech');
    stopInterruptListener();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = '';
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);

    if (voiceMode && recognitionRef.current && !isRecognitionRunningRef.current) {
      setTimeout(() => {
        try {
          recognitionRef.current.start();
          console.log('🎤 Mic re-opened after cancel');
        } catch (e) {}
      }, 400);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadedFiles(prev => [...prev, { name: file.name, url: file_url, type: file.type }]);
      alert(`✅ File uploaded: ${file.name}`);
    } catch (error) {
      console.error('File upload error:', error);
      alert('Failed to upload file: ' + error.message);
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleSendMessage = async (messageText, shouldSpeak = false) => {
    const userMessage = messageText || input.trim();
    if (!userMessage) return;

    console.log('📤 Sending message with company ID:', myCompany?.id);

    setInput("");
    setIsLoading(true);

    const newMessages = [...messages, {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
      attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined
    }];
    
    setMessages(newMessages);

    try {
      const response = await base44.functions.invoke('lexiChat', {
        message: userMessage,
        conversationHistory: newMessages.slice(-20).map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        companyId: myCompany.id,
        sessionId: currentSessionId,
        file_urls: uploadedFiles.length > 0 ? uploadedFiles : undefined,
      });

      console.log('📥 Lexi response:', response.data);

      setUploadedFiles([]);

      if (response.data.requires_confirmation && response.data.proposed_action) {
        console.log('⚠️ Lexi is asking for confirmation - AUTO-APPROVING AND EXECUTING...');

        const action = response.data.proposed_action;

        if (action.type === 'email' && action.to && action.subject && action.message) {
          console.log('📧 Auto-executing email send...');
          try {
            const emailResult = await base44.functions.invoke('sendEmailFromCRM', {
              to: action.to,
              subject: action.subject,
              message: action.message,
              contactName: action.contact_name,
              companyId: myCompany.id
            });

            if (emailResult.data?.success !== false && !emailResult.data?.error) {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `✅ Email sent to ${action.to}: "${action.subject}"`,
                timestamp: new Date().toISOString(),
                actions: [{ tool: 'Email', result: `Sent to ${action.to}` }]
              }]);
            } else {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `❌ Failed to send email: ${emailResult.data?.error || 'Unknown error'}`,
                timestamp: new Date().toISOString()
              }]);
            }
            return;
          } catch (err) {
            console.error('Email send error:', err);
          }
        } else if (action.type === 'sms' && action.to && action.message) {
          console.log('💬 Auto-executing SMS send...');
          try {
            const smsResult = await base44.functions.invoke('sendSMS', {
              to: action.to,
              message: action.message,
              contactName: action.contact_name,
              companyId: myCompany.id,
              senderEmail: user?.email
            });

            if (smsResult.data?.success !== false && !smsResult.data?.error) {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `✅ SMS sent to ${action.to}`,
                timestamp: new Date().toISOString(),
                actions: [{ tool: 'SMS', result: `Sent to ${action.to}` }]
              }]);
            } else {
              setMessages(prev => [...prev, {
                role: 'assistant',
                content: `❌ Failed to send SMS: ${smsResult.data?.error || 'Unknown error'}`,
                timestamp: new Date().toISOString()
              }]);
            }
            return;
          } catch (err) {
            console.error('SMS send error:', err);
          }
        }
      }

      // Handle Lexi's proposed action (executive review pattern)
      if (response.data.proposed_action?.type === 'ai_proposed_action' && myCompany?.id) {
        const pa = response.data.proposed_action;
        const taskTitle = pa.action_type === 'delete_entity'
          ? `⚠️ Lexi proposes: Delete ${pa.entity_name} "${pa.entity_label}"`
          : `⚠️ Lexi proposes: ${pa.action_type} on ${pa.entity_name} "${pa.entity_label}"`;
        try {
          await base44.entities.Task.create({
            company_id: myCompany.id,
            title: taskTitle,
            description: `Reason: ${pa.reason}\n\nProposed by Lexi (AI Assistant) on behalf of ${pa.proposed_by}.`,
            status: 'pending_ai_approval',
            priority: 'high',
            data: {
              action_type: pa.action_type,
              entity_name: pa.entity_name,
              entity_id: pa.entity_id,
              entity_label: pa.entity_label,
              reason: pa.reason,
              proposed_by: pa.proposed_by,
              source: 'lexi_ai',
            }
          });
          refetchApprovals();
        } catch (err) {
          console.error('[LexiApproval] Failed to create approval task:', err);
        }
      }

      const assistantResponse = response.data.response || 'I encountered an error. Please try again.';

      if (response.data.actions_executed?.length > 0) {
        console.log('✅ Actions executed:', response.data.actions_executed);
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assistantResponse,
        timestamp: new Date().toISOString(),
        actions: response.data.actions_executed || []
      }]);

      if (voiceMode || shouldSpeak) {
        const cleanText = assistantResponse
          .replace(/\*\*/g, '')
          .replace(/\*/g, '')
          .replace(/#{1,6}\s/g, '')
          .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/^[-•]\s/gm, '')
          .replace(/^\d+\.\s/gm, '')
          .replace(/"/g, '')
          .replace(/'/g, '')
          .replace(/\n\n+/g, '. ')
          .replace(/\n/g, ', ')
          .trim();

        await speakResponse(cleanText);
      }

      if (response.data.actions_executed?.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['leads'] });
        queryClient.invalidateQueries({ queryKey: ['customers'] });
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
      }
    } catch (error) {
      console.error("Lexi AI Assistant error:", error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message || "An unknown error occurred."}`,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = () => handleSendMessage();

  const handleVoiceInput = async () => {
    if (!recognitionRef.current) {
      setMicrophoneError("Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.");
      return;
    }

    // On mobile, ensure microphone permission is granted before starting
    if (microphonePermission !== 'granted') {
      setMicrophoneError("⚠️ Please click 'Enable Mic' first to grant microphone permission.");
      await testMicrophone();
      return;
    }

    if (isListening || isRecognitionRunningRef.current) {
      try {
        recognitionRef.current.stop();
        isRecognitionRunningRef.current = false;
        setIsListening(false);
      } catch (e) {
        console.log('Error stopping recognition:', e);
      }
    } else {
      try {
        setMicrophoneError(null);
        console.log('🎤 Starting speech recognition...');
        recognitionRef.current.start();
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        isRecognitionRunningRef.current = false;
        setIsListening(false);
        
        if (error.message.includes('not-allowed') || error.message.includes('permission') || error.name === 'NotAllowedError') {
          setMicrophoneError('⚠️ Microphone access denied. Click "Enable Mic" to grant permission.');
          setMicrophonePermission('denied');
        } else {
          setMicrophoneError('Failed to start voice input. Please try again or click "Enable Mic".');
        }
      }
    }
  };

  const handleSaveConversation = () => {
    if (messages.length <= 1) {
      alert('No conversation to save yet!');
      return;
    }
    
    const sessionId = currentSessionId || `session_${Date.now()}`;
    setCurrentSessionId(sessionId);
    
    const firstUserMessage = messages.find(m => m.role === 'user');
    if (firstUserMessage) {
      const autoName = firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '');
      setSessionName(autoName);
    }
    
    setShowSaveDialog(true);
  };

  const handleLoadConversation = (session) => {
    const loadedMessages = session.messages
      .sort((a, b) => new Date(a.created_date) - new Date(b.created_date))
      .map(msg => ({
        role: msg.message_role,
        content: msg.message_content,
        timestamp: msg.created_date
      }));
    
    setMessages(loadedMessages);
    setCurrentSessionId(session.session_id);
    setShowHistoryDialog(false);
  };

  const handleNewChat = () => {
    const staffProfile = staffProfiles.find(s => s.user_email === user?.email);
    const displayName = staffProfile?.full_name?.split(' ')[0] || user?.full_name?.split(' ')[0] || user?.email.split('@')[0];
    
    setMessages([{
      role: 'assistant',
      content: `👋 Hi ${displayName}! I'm Lexi, your AI assistant. How can I help you today?`,
      timestamp: new Date().toISOString()
    }]);
    setCurrentSessionId(null);
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;

    setShowConfirmationDialog(false);
    setIsLoading(true);

    try {
      if (pendingAction.type === 'email') {
        console.log('📧 Sending email...');
        await base44.functions.invoke('sendEmailFromCRM', {
          to: pendingAction.to,
          subject: pendingAction.subject || 'Message from ' + (myCompany?.company_name || 'our team'),
          message: pendingAction.message,
          contactName: pendingAction.contact_name,
          companyId: myCompany?.id
        });

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ Email sent to ${pendingAction.to}`,
          timestamp: new Date().toISOString()
        }]);
      } else if (pendingAction.type === 'sms') {
        console.log('💬 Sending SMS...');
        await base44.functions.invoke('sendSMS', {
          to: pendingAction.to,
          message: pendingAction.message,
          contactName: pendingAction.contact_name,
          companyId: myCompany?.id,
          senderEmail: user?.email
        });

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ Text message sent to ${pendingAction.to}`,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (error) {
      console.error('❌ Failed to send:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Failed to send: ${error.message}`,
        timestamp: new Date().toISOString()
      }]);
    }

    setPendingAction(null);
    setIsLoading(false);
  };

  const handleEditMemory = (memory) => {
    setEditingMemory(memory);
    setMemoryForm({
      key: memory.key,
      value: memory.value,
      description: memory.description,
      importance: memory.importance,
      category: memory.category
    });
    setShowAddMemory(true);
  };

  const handleDeleteMemory = (id) => {
    if (window.confirm("Delete this memory? Lexi will forget this information.")) {
      deleteMemoryMutation.mutate(id);
    }
  };

  const handleSubmitMemory = (e) => {
    e.preventDefault();
    if (!user) return;

    if (editingMemory) {
      updateMemoryMutation.mutate({
        id: editingMemory.id,
        data: memoryForm
      });
    } else {
      createMemoryMutation.mutate(memoryForm);
    }
  };

  const getImportanceColor = (importance) => {
    if (importance >= 8) return "bg-red-100 text-red-800";
    if (importance >= 5) return "bg-yellow-100 text-yellow-800";
    return "bg-gray-100 text-gray-800";
  };

  const normalizeEngine = (val) => {
    const s = (val || '').toString().toLowerCase();
    if (!s) return 'gemini';
    if (s.includes('openai') || s.includes('gpt')) return 'openai';
    if (s.includes('gemini') || s.includes('flash')) return 'gemini';
    return s === 'openai' || s === 'gemini' ? s : 'gemini';
  };

  return (
    <Tabs defaultValue="chat" className="h-screen flex flex-col bg-gradient-to-br from-purple-50 via-blue-50 to-pink-50">
      <audio ref={audioRef} onEnded={() => setIsSpeaking(false)} />
      
      {/* Header with tabs */}
      <div className="bg-gradient-to-r from-purple-600 via-blue-600 to-pink-600 text-white p-4 md:p-6 shadow-lg flex-shrink-0">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-4">
            <Dialog>
              <DialogTrigger asChild>
                <button className="w-12 h-12 md:w-16 md:h-16 rounded-full overflow-hidden border-4 border-white shadow-lg flex-shrink-0 hover:opacity-80 transition-opacity cursor-pointer">
                  <img 
                    src={myCompany?.lexi_avatar_url || "https://api.dicebear.com/7.x/bottts/svg?seed=lexi&backgroundColor=b6e3f4"} 
                    alt="Lexi"
                    className="w-full h-full object-cover"
                  />
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Customize Lexi's Avatar</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <img 
                      src={myCompany?.lexi_avatar_url || "https://api.dicebear.com/7.x/bottts/svg?seed=lexi&backgroundColor=b6e3f4"} 
                      alt="Current Lexi Avatar"
                      className="w-32 h-32 rounded-full object-cover border-4 border-purple-200"
                    />
                  </div>

                  <div>
                    <Label htmlFor="avatar-upload">Upload New Avatar</Label>
                    <input
                      id="avatar-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                    <label htmlFor="avatar-upload">
                      <Button 
                        type="button" 
                        variant="outline" 
                        className="w-full mt-2" 
                        asChild
                        disabled={uploadingAvatar}
                      >
                        <span className="cursor-pointer">
                          <Upload className="w-4 h-4 mr-2" />
                          {uploadingAvatar ? 'Uploading...' : 'Choose Image'}
                        </span>
                      </Button>
                    </label>
                    <p className="text-xs text-gray-500 mt-2">
                      Recommended: Square image, 500x500px or larger
                    </p>
                  </div>

                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertDescription className="text-blue-800">
                      Upload a custom avatar to personalize Lexi's appearance throughout your CRM. 
                      This avatar will appear in the AI Assistant, notifications, and anywhere Lexi is mentioned.
                    </AlertDescription>
                  </Alert>
                </div>
              </DialogContent>
            </Dialog>

            <div className="flex-1 min-w-0">
              <h1 className="text-xl md:text-2xl font-bold">AI Assistant</h1>
            </div>

            {/* Top-right icon buttons */}
            <div className="flex items-center gap-1 ml-auto">
              <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" title="Conversation history" data-testid="button-chat-history">
                    <MessageSquare className="w-5 h-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Saved Conversations</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {conversationSessions.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">No saved conversations yet</p>
                    ) : (
                      conversationSessions.map(session => (
                        <div key={session.session_id} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{session.summary}</p>
                            <p className="text-sm text-gray-500">
                              {format(new Date(session.last_updated), 'MMM d, yyyy h:mm a')} · {session.messages.length} messages
                            </p>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => handleLoadConversation(session)}>Load</Button>
                          <Button variant="ghost" size="icon" onClick={() => { if (window.confirm('Delete this conversation?')) { deleteConversationMutation.mutate(session.session_id); } }}>
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </DialogContent>
              </Dialog>

              <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={handleSaveConversation} title="Save conversation" data-testid="button-save-conversation">
                <Save className="w-5 h-5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={testMicrophone}
                disabled={isTesting}
                className={microphonePermission === 'granted' ? "text-white hover:bg-white/20" : "text-yellow-300 hover:bg-white/20 animate-pulse"}
                title={microphonePermission === 'granted' ? 'Microphone OK' : 'Enable microphone'}
                data-testid="button-mic-permission"
              >
                {isTesting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />}
              </Button>
            </div>
          </div>

          <TabsList className="grid w-full grid-cols-4 bg-white/20 mt-4 max-w-xl mx-auto">
            <TabsTrigger value="chat" className="data-[state=active]:bg-white data-[state=active]:text-purple-600">
              💬 Chat
            </TabsTrigger>
            <TabsTrigger value="approvals" className="data-[state=active]:bg-white data-[state=active]:text-purple-600 relative">
              ✅ Approvals
              {pendingApprovals.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {pendingApprovals.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="memory" className="data-[state=active]:bg-white data-[state=active]:text-purple-600">
              🧠 Memory
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-white data-[state=active]:text-purple-600">
              ⚙️ Settings
            </TabsTrigger>
          </TabsList>

        </div>
      </div>

      {/* Chat Tab */}
      <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden m-0 data-[state=active]:flex">
        {nativeVoiceMode && (
          <div className="p-4 md:p-6 border-b">
            <div className="max-w-4xl mx-auto">
              <ErrorBoundary fallback={
                <div className="p-4 text-center text-sm text-red-500" data-testid="lexi-voice-error">
                  Voice mode encountered an error. <button className="underline" onClick={() => { setNativeVoiceMode(false); setVoiceMode(false); }}>Switch to text mode</button>
                </div>
              }>
                <GeminiLiveNativeClient
                  companyId={myCompany?.id}
                  onFallbackToTTS={() => {
                    setNativeVoiceMode(false);
                    setVoiceMode(true);
                  }}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
          <div className="max-w-4xl mx-auto space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full overflow-hidden flex-shrink-0 border-2 border-purple-200">
                    <img 
                      src={myCompany?.lexi_avatar_url || "https://api.dicebear.com/7.x/bottts/svg?seed=lexi&backgroundColor=b6e3f4"} 
                      alt="Lexi"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                {msg.role === 'user' && (
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                    {user?.full_name?.[0] || 'U'}
                  </div>
                )}
                <div className={`flex-1 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <div className={`inline-block max-w-[85%] md:max-w-[80%] p-3 md:p-4 rounded-2xl shadow-md ${
                    msg.role === 'user' 
                      ? 'bg-gradient-to-br from-blue-500 to-purple-500 text-white' 
                      : 'bg-white text-gray-800'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div className="text-sm md:text-base prose prose-sm max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm md:text-base whitespace-pre-wrap break-words">{msg.content}</div>
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {msg.attachments.map((file, i) => (
                              <div key={i} className="text-xs bg-white/20 px-2 py-1 rounded">
                                📎 {file.name}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {msg.timestamp && (
                      <div className={`text-xs mt-2 ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'}`}>
                        {format(new Date(msg.timestamp), 'h:mm a')}
                      </div>
                    )}
                    {msg.actions && msg.actions.length > 0 && (
                      <div className={`text-xs mt-2 p-2 rounded-md ${msg.role === 'user' ? 'bg-blue-600 text-blue-100' : 'bg-gray-100 text-gray-600'}`}>
                        <p className="font-semibold mb-1">Actions taken:</p>
                        <ul className="list-disc list-inside">
                          {msg.actions.map((action, actionIdx) => (
                            <li key={actionIdx}>
                              {action.tool_name || 'Action'}: {action.result || 'Completed'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="border-t bg-white shadow-2xl p-3 md:p-4 mb-14 md:mb-0">
          <div className="max-w-4xl mx-auto">
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileUpload}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.txt"
            />
            
            {uploadedFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {uploadedFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-purple-100 px-3 py-1 rounded-full text-sm">
                    <Paperclip className="w-3 h-3" />
                    {file.name}
                    <button
                      onClick={() => setUploadedFiles(prev => prev.filter((_, i) => i !== idx))}
                      className="hover:text-red-600"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 items-end">
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="min-h-[44px] min-w-[44px] border-2 border-purple-200 hover:border-purple-500 flex-shrink-0"
                size="icon"
                disabled={isUploadingFile}
              >
                {isUploadingFile ? (
                  <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
                ) : (
                  <Paperclip className="w-5 h-5 text-purple-600" />
                )}
              </Button>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask Lexi anything..."
                className="flex-1 min-h-[44px] max-h-32 resize-none text-base border-2 border-purple-200 focus:border-purple-500"
                rows={1}
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 min-h-[44px] min-w-[44px] flex-shrink-0"
                size="icon"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </Button>
              <Button
                onClick={handleVoiceInput}
                variant="outline"
                className={`min-h-[44px] min-w-[44px] border-2 flex-shrink-0 ${
                  isListening 
                    ? 'border-red-500 bg-red-50 hover:border-red-600 hover:bg-red-100 animate-pulse' 
                    : 'border-purple-200 hover:border-purple-500'
                }`}
                size="icon"
                title={microphonePermission === 'denied' ? 'Click "Enable Mic" first' : isListening ? 'Listening... (click to stop)' : 'Click and speak'}
                disabled={microphonePermission === 'denied' || isLoading}
              >
                {isListening ? (
                  <div className="relative">
                    <Mic className="w-5 h-5 text-red-600" />
                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  </div>
                ) : (
                  <Mic className="w-5 h-5 text-purple-600" />
                )}
              </Button>
            </div>
            {isListening && (
              <div className="text-center mt-2 text-sm font-semibold text-purple-600 flex items-center justify-center gap-2">
                <div className="flex gap-1">
                  <div className="w-1 h-4 bg-purple-600 rounded-full animate-pulse" style={{animationDelay: '0ms'}}></div>
                  <div className="w-1 h-5 bg-purple-600 rounded-full animate-pulse" style={{animationDelay: '150ms'}}></div>
                  <div className="w-1 h-6 bg-purple-600 rounded-full animate-pulse" style={{animationDelay: '300ms'}}></div>
                  <div className="w-1 h-5 bg-purple-600 rounded-full animate-pulse" style={{animationDelay: '450ms'}}></div>
                  <div className="w-1 h-4 bg-purple-600 rounded-full animate-pulse" style={{animationDelay: '600ms'}}></div>
                </div>
                <span>Listening... Speak now</span>
              </div>
            )}
            {isSpeaking && (
              <div className="text-center mt-2 flex items-center justify-center gap-2">
                <Volume2 className="w-4 h-4 animate-pulse text-blue-600" />
                <span className="text-sm font-semibold text-blue-600">Lexi is speaking...</span>
                <button
                  onClick={stopSpeaking}
                  className="ml-2 inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white text-xs px-3 py-1 rounded-full cursor-pointer transition-colors"
                  data-testid="button-stop-speaking-chat"
                >
                  <Square className="w-3 h-3 fill-current" />
                  Stop
                </button>
              </div>
            )}
          </div>
        </div>
      </TabsContent>

      {/* Approvals Tab */}
      <TabsContent value="approvals" className="flex-1 overflow-y-auto p-6 m-0 data-[state=active]:block">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Lexi Approvals</h2>
            <p className="text-gray-500 mt-1">Actions Lexi has proposed that require your review. Approve or reject each one.</p>
          </div>

          {pendingApprovals.length === 0 ? (
            <Card className="border-dashed border-2 border-gray-200">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-400 mb-3" />
                <p className="text-lg font-medium text-gray-700">No pending approvals</p>
                <p className="text-sm text-gray-400 mt-1">When Lexi proposes a deletion or sensitive action, it will appear here for your review.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {pendingApprovals.map(task => (
                <Card key={task.id} className="border-orange-200 bg-orange-50" data-testid={`approval-card-${task.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base font-semibold text-orange-900">{task.title}</CardTitle>
                        {task.description && (
                          <CardDescription className="text-orange-700 mt-1 text-sm whitespace-pre-line">{task.description}</CardDescription>
                        )}
                      </div>
                      <Badge className="bg-orange-200 text-orange-800 shrink-0">Pending Review</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {task.data?.action_type === 'delete_entity' && (
                      <div className="bg-white rounded-lg p-3 border border-orange-200 mb-4 text-sm">
                        <p className="font-medium text-gray-700">Action: <span className="text-red-600">Permanently delete</span></p>
                        <p className="text-gray-600">Record: <strong>{task.data.entity_label}</strong> ({task.data.entity_name})</p>
                        <p className="text-gray-500 text-xs mt-1">This cannot be undone.</p>
                      </div>
                    )}
                    <div className="flex gap-3 mt-2">
                      <Button
                        data-testid={`btn-approve-${task.id}`}
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={async () => {
                          try {
                            const result = await base44.functions.invoke('executeApprovedLexiAction', {
                              task_id: task.id,
                              company_id: myCompany?.id,
                            });
                            if (result.data?.success) {
                              refetchApprovals();
                            } else {
                              alert('❌ ' + (result.data?.error || 'Failed to execute action'));
                            }
                          } catch (e) {
                            alert('❌ Error: ' + e.message);
                          }
                        }}
                      >
                        ✅ Approve
                      </Button>
                      <Button
                        data-testid={`btn-reject-${task.id}`}
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        onClick={async () => {
                          try {
                            const result = await base44.functions.invoke('rejectLexiAction', {
                              task_id: task.id,
                              company_id: myCompany?.id,
                            });
                            if (result.data?.success) {
                              refetchApprovals();
                            } else {
                              alert('❌ ' + (result.data?.error || 'Failed to reject'));
                            }
                          } catch (e) {
                            alert('❌ Error: ' + e.message);
                          }
                        }}
                      >
                        ❌ Reject
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      {/* Memory Tab */}
      <TabsContent value="memory" className="flex-1 overflow-y-auto p-6 m-0 data-[state=active]:block">
        <div className="max-w-5xl mx-auto space-y-6">
          <Alert className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
            <Lightbulb className="w-5 h-5 text-purple-600" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-semibold text-purple-900">💡 What is Lexi Memory?</p>
                <p className="text-sm text-purple-800">
                  <strong>Personal preferences about YOU.</strong> Tell Lexi your work style, preferences, and habits. 
                  These are private to you and help Lexi give personalized responses.
                </p>
                <div className="mt-3 text-xs text-purple-700 space-y-1">
                  <p><strong>Examples:</strong></p>
                  <ul className="list-disc list-inside ml-2">
                    <li>"I prefer scheduling appointments after 2 PM"</li>
                    <li>"My typical waste factor is 15%"</li>
                    <li>"Always remind me to follow up on Thursdays"</li>
                    <li>"I work with State Farm insurance most often"</li>
                  </ul>
                </div>
                <p className="text-xs text-purple-700 mt-2">
                  <strong>💡 Tip:</strong> Just tell Lexi these things in conversation! She'll automatically save important preferences.
                </p>
              </div>
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6 text-center">
                <div className="text-4xl font-bold text-purple-600">{activeMemories.length}</div>
                <p className="text-sm text-gray-600 mt-1">Active Memories</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <div className="text-4xl font-bold text-gray-400">{inactiveMemories.length}</div>
                <p className="text-sm text-gray-600 mt-1">Inactive Memories</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <div className="text-4xl font-bold text-orange-600">
                  {activeMemories.filter(m => m.importance >= 8).length}
                </div>
                <p className="text-sm text-gray-600 mt-1">High Priority</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Star className="w-5 h-5 text-purple-600" />
                  <CardTitle>Active Memories</CardTitle>
                </div>
                <Button 
                  onClick={() => {
                    setEditingMemory(null);
                    setMemoryForm({ key: "", value: "", description: "", importance: 5, category: "lexi" });
                    setShowAddMemory(true);
                  }}
                  className="bg-purple-600 hover:bg-purple-700 gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Memory
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {activeMemories.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Brain className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p className="font-medium">No memories yet</p>
                  <p className="text-sm mt-1">Lexi will learn about you as you interact!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeMemories
                    .sort((a, b) => b.importance - a.importance)
                    .map((memory) => (
                      <div key={memory.id} className="border border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-gray-900">{memory.key}</h3>
                              <Badge className={getImportanceColor(memory.importance)}>
                                Priority: {memory.importance}
                              </Badge>
                              <Badge variant="outline">{memory.category}</Badge>
                            </div>
                            <p className="text-sm text-gray-600 mb-2">{memory.description}</p>
                            <p className="text-sm font-medium text-purple-600">"{memory.value}"</p>
                            {memory.access_count > 0 && (
                              <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                                <TrendingUp className="w-3 h-3" />
                                Used {memory.access_count} times
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 ml-4">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditMemory(memory)}
                              className="h-8 w-8"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleActiveMutation.mutate({ id: memory.id, is_active: false })}
                              className="h-8 w-8 text-gray-600"
                              title="Deactivate"
                            >
                              <Star className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteMemory(memory.id)}
                              className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          {inactiveMemories.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-gray-500">Inactive Memories</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {inactiveMemories.map((memory) => (
                    <div key={memory.id} className="border border-gray-200 rounded-lg p-4 opacity-60">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold text-gray-700">{memory.key}</h3>
                            <Badge variant="outline">{memory.category}</Badge>
                          </div>
                          <p className="text-sm text-gray-600 mb-2">{memory.description}</p>
                          <p className="text-sm text-gray-700">"{memory.value}"</p>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleActiveMutation.mutate({ id: memory.id, is_active: true })}
                            className="h-8 w-8 text-purple-600"
                            title="Reactivate"
                          >
                            <Star className="w-4 h-4 fill-purple-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteMemory(memory.id)}
                            className="h-8 w-8 text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </TabsContent>

      {/* Settings Tab */}
      <TabsContent value="settings" className="flex-1 overflow-y-auto p-6 m-0 data-[state=active]:block">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Voice Settings Card */}
          <Card data-testid="card-voice-settings">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="w-5 h-5 text-purple-600" />
                Voice Settings
              </CardTitle>
              <CardDescription>Configure Lexi's voice and microphone behaviour</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Continuous Voice</p>
                    <p className="text-xs text-gray-500">Lexi listens continuously while active</p>
                  </div>
                  <Switch
                    checked={voiceMode}
                    onCheckedChange={(checked) => {
                      if (checked && microphonePermission !== 'granted') {
                        testMicrophone();
                        return;
                      }
                      setVoiceMode(checked);
                      setMicrophoneError(null);
                    }}
                    disabled={microphonePermission === 'denied'}
                    data-testid="switch-voice-mode"
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Native S2S Mode</p>
                    <p className="text-xs text-gray-500">Use Gemini's native speech-to-speech</p>
                  </div>
                  <Switch
                    checked={nativeVoiceMode}
                    onCheckedChange={setNativeVoiceMode}
                    data-testid="switch-native-s2s"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Voice Engine</label>
                  <select
                    value={engine}
                    onChange={(e) => { setEngine(e.target.value); setEngineDirty(true); }}
                    className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    data-testid="select-voice-engine"
                  >
                    <option value="gemini">Gemini</option>
                    <option value="browser">Browser TTS</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Voice</label>
                  <select
                    value={voiceId}
                    onChange={(e) => setVoiceId(e.target.value)}
                    className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    data-testid="select-voice"
                  >
                    {geminiVoices.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => {
                    if (wakeWordRecognitionRef.current && isWakeWordRunningRef.current) {
                      try { wakeWordRecognitionRef.current.stop(); isWakeWordRunningRef.current = false; setIsWaitingForHeyLexi(false); } catch (e) {}
                    }
                    if (recognitionRef.current && !isRecognitionRunningRef.current) {
                      try { setMicrophoneError(null); recognitionRef.current.start(); } catch (e) { setMicrophoneError('Failed to start. Please try again.'); }
                    }
                  }}
                  disabled={isListening || isSpeaking}
                  className="bg-green-600 hover:bg-green-700 text-white"
                  data-testid="button-tap-to-speak"
                >
                  <Mic className="w-4 h-4 mr-2" />
                  {isListening ? 'Listening...' : 'Tap to Speak Once'}
                </Button>
                {isSpeaking && (
                  <Button variant="destructive" onClick={stopSpeaking} data-testid="button-stop-speaking">
                    <Square className="w-4 h-4 mr-2 fill-current" />
                    Stop Lexi
                  </Button>
                )}
                {microphoneError && (
                  <p className="text-red-500 text-xs">{microphoneError}</p>
                )}
                {voiceMode && isListening && (
                  <div className="flex items-center gap-2 text-green-600 text-xs">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    Listening...
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Avatar</CardTitle>
              <CardDescription>Upload a custom avatar for Lexi</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6">
                <img 
                  src={myCompany?.lexi_avatar_url || "https://api.dicebear.com/7.x/bottts/svg?seed=lexi&backgroundColor=b6e3f4"} 
                  alt="Lexi Avatar"
                  className="w-24 h-24 rounded-full object-cover border-4 border-purple-200"
                />
                <div className="flex-1">
                  <input
                    id="avatar-upload-settings"
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                  <label htmlFor="avatar-upload-settings">
                    <Button 
                      type="button" 
                      variant="outline" 
                      asChild
                      disabled={uploadingAvatar}
                    >
                      <span className="cursor-pointer flex items-center gap-2">
                        {uploadingAvatar ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4" />
                            Upload New Avatar
                          </>
                        )}
                      </span>
                    </Button>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    Recommended: Square image, 500x500px or larger
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI Engine (Beta)</CardTitle>
              <CardDescription>Choose the model Lexi uses for conversations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Engine</Label>
                <Select 
                  value={engine} 
                  onValueChange={(v) => {
                    const canon = normalizeEngine(v);
                    setEngine(canon);
                    setEngineDirty(true);
                    setLoadedFromDB(true);
                  }}
                >
                  <SelectTrigger className="w-full mt-2">
                    <SelectValue placeholder="Select engine" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Gemini 2.5 Flash (default)</SelectItem>
                    <SelectItem value="openai">OpenAI (GPT‑4o)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-2">
                  Gemini enables low-latency voice and better realtime performance. You can switch back instantly if needed.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Live (Real‑time) — Beta</CardTitle>
              <CardDescription>Enable Gemini Multimodal Live API for push‑to‑talk voice</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-600">We'll use short‑lived tokens so the browser can open a secure WebSocket directly to Gemini.</p>
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  try {
                    const { data } = await base44.functions.invoke('createGeminiEphemeralToken', {});
                    if (!data?.token) throw new Error(data?.error || 'Failed to create token');
                    console.log('Ephemeral token created:', data);
                    alert('✅ Live token ready (expires soon)');
                  } catch (e) {
                    alert('Live token failed: ' + (e?.message || 'Unknown error'));
                  }
                }}
              >
                <Sparkles className="w-4 h-4 mr-2" /> Test Live Token
              </Button>
              <p className="text-xs text-gray-500">Next: we'll wire a mic streamer to use this token for real‑time voice.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
                <CardTitle>Voice Settings</CardTitle>
                <CardDescription>Choose Lexi's voice (Gemini voices)</CardDescription>
              </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  {voiceEnabled ? (
                    <Volume2 className="w-5 h-5 text-purple-600" />
                  ) : (
                    <Volume2 className="w-5 h-5 text-gray-400" />
                  )}
                  <div>
                    <Label className="text-base font-semibold">Enable Voice Responses</Label>
                    <p className="text-sm text-gray-500 mt-1">
                      {voiceEnabled ? "Lexi will respond with voice audio" : "Lexi will respond with text only"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={voiceEnabled}
                  onCheckedChange={setVoiceEnabled}
                />
              </div>

              {voiceEnabled && (
                <>
                  <div>
                    <Label>Voice (Gemini)</Label>
                    <Select value={voiceId} onValueChange={setVoiceId}>
                      <SelectTrigger className="w-full mt-2">
                        <SelectValue placeholder="Select a voice" />
                      </SelectTrigger>
                      <SelectContent>
                        {geminiVoices.map(voice => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={testVoice}
                    variant="outline"
                    className="w-full"
                  >
                    <Volume2 className="w-4 h-4 mr-2" />
                    Test Voice
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Personality & Behavior</CardTitle>
              <CardDescription>Customize Lexi's system prompt (optional - leave blank for default)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>System Prompt</Label>
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are Lexi, a helpful AI assistant for a roofing/contracting CRM..."
                  rows={8}
                  className="mt-2 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Define how Lexi should behave, her tone, and priorities. Leave blank to use the default prompt.
                </p>
              </div>

              <Alert className="bg-blue-50 border-blue-200">
                <AlertDescription className="text-blue-800 text-sm">
                  💡 <strong>Tips:</strong> Be specific about tone (friendly, professional, casual), response style (concise, detailed), 
                  and any industry-specific knowledge she should prioritize.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={() => saveSettingsMutation.mutate()}
              disabled={saveSettingsMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {saveSettingsMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Settings
                </>
              )}
            </Button>
          </div>
        </div>
      </TabsContent>

      {/* Dialogs */}
      <Dialog open={showConfirmationDialog} onOpenChange={setShowConfirmationDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.type === 'email' ? '📧 Confirm Email' : '💬 Confirm Text Message'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-yellow-800">
                Review the message below before sending. You can edit the recipient and message if needed.
              </AlertDescription>
            </Alert>

            <div>
              <Label>To</Label>
              <Input
                value={pendingAction?.to || ''}
                onChange={(e) => setPendingAction({...pendingAction, to: e.target.value})}
                placeholder={pendingAction?.type === 'email' ? 'customer@example.com' : '+1234567890'}
              />
            </div>

            {pendingAction?.type === 'email' && (
              <div>
                <Label>Subject</Label>
                <Input
                  value={pendingAction?.subject || ''}
                  onChange={(e) => setPendingAction({...pendingAction, subject: e.target.value})}
                  placeholder="Email subject"
                />
              </div>
            )}

            <div>
              <Label>Message</Label>
              <Textarea
                value={pendingAction?.message || ''}
                onChange={(e) => setPendingAction({...pendingAction, message: e.target.value})}
                rows={8}
                className="font-mono text-sm"
              />
            </div>

            <div>
              <Label>Contact Name (Optional)</Label>
              <Input
                value={pendingAction?.contact_name || ''}
                onChange={(e) => setPendingAction({...pendingAction, contact_name: e.target.value})}
                placeholder="John Doe"
              />
            </div>
          </div>

          <DialogFooter className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirmationDialog(false);
                setPendingAction(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAction}
              disabled={!pendingAction?.to || !pendingAction?.message}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {pendingAction?.type === 'email' ? '📧 Send Email' : '💬 Send Text'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Conversation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Conversation Name</Label>
              <Input
                placeholder="e.g., Estimate for John Doe"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                Leave as-is or edit to customize
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  saveConversationMutation.mutate({
                    sessionId: currentSessionId,
                    name: sessionName || 'Conversation'
                  });
                }}
                disabled={saveConversationMutation.isPending}
              >
                {saveConversationMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddMemory} onOpenChange={(open) => {
        if (!open) {
          setShowAddMemory(false);
          setEditingMemory(null);
          setMemoryForm({ key: "", value: "", description: "", importance: 5, category: "lexi" });
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMemory ? "Edit Memory" : "Add New Memory"}</DialogTitle>
            <DialogDescription>
              Tell Lexi something to remember about you
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitMemory} className="space-y-4">
            <div>
              <Label>Memory Key *</Label>
              <Input
                value={memoryForm.key}
                onChange={(e) => setMemoryForm({...memoryForm, key: e.target.value})}
                placeholder="e.g., preferred_meeting_time"
                required
              />
              <p className="text-xs text-gray-500 mt-1">A unique identifier for this memory</p>
            </div>

            <div>
              <Label>Value *</Label>
              <Input
                value={memoryForm.value}
                onChange={(e) => setMemoryForm({...memoryForm, value: e.target.value})}
                placeholder="e.g., afternoons after 2 PM"
                required
              />
            </div>

            <div>
              <Label>Description *</Label>
              <Textarea
                value={memoryForm.description}
                onChange={(e) => setMemoryForm({...memoryForm, description: e.target.value})}
                placeholder="e.g., User prefers meetings in the afternoon"
                rows={3}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Importance (1-10)</Label>
                <Select 
                  value={memoryForm.importance.toString()} 
                  onValueChange={(value) => setMemoryForm({...memoryForm, importance: parseInt(value)})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1,2,3,4,5,6,7,8,9,10].map(n => (
                      <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">Higher = more important</p>
              </div>

              <div>
                <Label>Category</Label>
                <Select 
                  value={memoryForm.category} 
                  onValueChange={(value) => setMemoryForm({...memoryForm, category: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lexi">Lexi</SelectItem>
                    <SelectItem value="estimator">AI Estimator</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => {
                setShowAddMemory(false);
                setEditingMemory(null);
                setMemoryForm({ key: "", value: "", description: "", importance: 5, category: "lexi" });
              }}>
                Cancel
              </Button>
              <Button type="submit" className="bg-purple-600 hover:bg-purple-700">
                {editingMemory ? "Update Memory" : "Save Memory"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}