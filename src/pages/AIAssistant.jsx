import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Paperclip, AlertCircle, Save, MessageSquare, Trash2, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import GeminiLiveNativeClient from "@/components/ai/GeminiLiveNativeClient";
import ErrorBoundary from "@/components/ErrorBoundary";
import { format } from "date-fns";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import ReactMarkdown from "react-markdown";
import useTranslation from "@/hooks/useTranslation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";

export default function AIAssistant() {
  const { t } = useTranslation();
  const { user, myCompany, myStaffProfile } = useRoleBasedData();
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
  const [voiceEngine, setVoiceEngine] = useState('gemini'); // 'elevenlabs' or 'gemini'
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [elevenLabsVoice, setElevenLabsVoice] = useState('EXAVITQu4vr4xnSDxMaL'); // Default: Sarah
  const [geminiVoice, setGeminiVoice] = useState('Aoede'); // Default Gemini voice
  const [useNativeS2S, setUseNativeS2S] = useState(true);
  
  // BUG FIX: Prevent duplicate message submissions
  const isSubmittingRef = useRef(false);
  const lastSubmittedMessageRef = useRef('');
  const lastSubmitTimeRef = useRef(0);
  
  // VAD: Voice Activity Detection refs for silence detection
  const silenceTimeoutRef = useRef(null);
  const lastSpeechTimeRef = useRef(Date.now());
  const accumulatedTranscriptRef = useRef('');
  const SILENCE_THRESHOLD_MS = 1500; // Auto-send after 1.5s of silence
  
  // Interruption: AbortController for cancelling LLM requests
  const abortControllerRef = useRef(null);
  const currentRequestIdRef = useRef(0);
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const wakeWordRecognitionRef = useRef(null);
  const audioRef = useRef(null);
  const isRecognitionRunningRef = useRef(false);
  const isWakeWordRunningRef = useRef(false);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const testMicrophone = async () => {
    setIsTesting(true);
    setMicrophoneError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicrophonePermission('granted');
      setMicrophoneError(null);
    } catch (error) {
      console.error('Microphone test failed:', error);
      setMicrophonePermission('denied');
      setMicrophoneError('Microphone access denied. Please allow microphone access in your browser settings.');
    } finally {
      setIsTesting(false);
    }
  };

  // Auto-request microphone permission on mount
  React.useEffect(() => {
    if (typeof navigator !== 'undefined' && microphonePermission === 'unknown') {
      testMicrophone();
    }
  }, []);

  // Set initial greeting message once we have both user and company loaded
    useEffect(() => {
      if (!user || !myCompany?.id || messages.length > 0) return;

      const displayName = myStaffProfile?.full_name?.split(' ')[0] || user.full_name?.split(' ')[0] || user.email.split('@')[0];

      setMessages([{
        role: 'assistant',
        content: `Hi ${displayName}! ${t.ai.lexi}, ${t.ai.greeting}`,
        timestamp: new Date().toISOString()
      }]);
    }, [user, myCompany, myStaffProfile, t.ai.lexi, t.ai.greeting]);

  // Detect mobile and disable "Hey Lexi" wake word on mobile by default
  const isMobile = () => {
    if (typeof window === 'undefined') return false;
    return /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
  };

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
      recognition.continuous = true; // BUG FIX: Keep listening until user stops
      recognition.interimResults = true; // BUG FIX: Show partial results but only submit final
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = async () => {
        console.log('🎤 Speech recognition started');
        isRecognitionRunningRef.current = true;
        setIsListening(true);
        setMicrophoneError(null);
        
        // INTERRUPTION: Stop Lexi if speaking
        if (isSpeaking || isLoading) {
          console.log('⚡ Mic started while Lexi active - INTERRUPTING');
          interruptLexi();
        }
        
        // Reset accumulated transcript
        accumulatedTranscriptRef.current = '';
        lastSpeechTimeRef.current = Date.now();

        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

          let options = { mimeType: 'audio/webm' };
          if (!MediaRecorder.isTypeSupported('audio/webm')) {
            console.log('audio/webm not supported, trying audio/mp4');
            options = { mimeType: 'audio/mp4' };
          }
          if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.log('Using default codec');
            options = {};
          }

          const mediaRecorder = new MediaRecorder(stream, options);
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunksRef.current.push(event.data);
            }
          };

          mediaRecorder.onerror = (event) => {
            console.error('❌ MediaRecorder error:', event.error);
          };

          mediaRecorder.start();
          console.log('🎙️ Recording started');
        } catch (err) {
          console.error('❌ Failed to start recording:', err);
          setMicrophoneError('Failed to access microphone: ' + err.message);
        }
      };

      recognition.onresult = async (event) => {
        // INTERRUPTION: If Lexi is speaking or loading, stop immediately
        if (isSpeaking || isLoading) {
          console.log('⚡ User spoke while Lexi active - INTERRUPTING');
          interruptLexi();
        }
        
        // Track speech activity for VAD
        lastSpeechTimeRef.current = Date.now();
        
        // Clear any pending silence timeout
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
        
        // Accumulate transcripts
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }
        
        // Accumulate final transcript
        if (finalTranscript) {
          accumulatedTranscriptRef.current += ' ' + finalTranscript;
        }
        
        // Show current state in input (accumulated + interim)
        const displayText = (accumulatedTranscriptRef.current + ' ' + interimTranscript).trim();
        setInput(displayText);
        
        // VAD: Start silence detection timer
        silenceTimeoutRef.current = setTimeout(() => {
          const transcript = accumulatedTranscriptRef.current.trim();
          if (transcript && !isLoading && !isSubmittingRef.current) {
            // CANCEL: If the user said a cancel word, stop Lexi instead of sending
            if (isCancelCommand(transcript)) {
              console.log('🛑 Cancel word via VAD - interrupting Lexi:', transcript);
              accumulatedTranscriptRef.current = '';
              setInput('');
              interruptLexi();
              try { recognition.stop(); } catch (e) {}
              return;
            }
            console.log('🔇 Silence detected - auto-sending:', transcript);
            
            // Stop recognition before sending
            try {
              recognition.stop();
            } catch (e) {}
            
            // Reset accumulated transcript
            accumulatedTranscriptRef.current = '';
            
            // Send the message
            handleSendMessage(transcript, voiceMode);
          }
        }, SILENCE_THRESHOLD_MS);
      };

      recognition.onerror = (event) => {
        console.error('🎤 Speech recognition error:', event.error);
        console.error('🎤 Error details:', event);
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
          setMicrophoneError(null);
        } else if (event.error === 'network') {
          setMicrophoneError('Network error. Please check your internet connection.');
        } else {
          setMicrophoneError(`Error: ${event.error}. Please try again.`);
        }

        if (voiceMode && wakeWordRecognitionRef.current && !isWakeWordRunningRef.current && event.error !== 'not-allowed' && event.error !== 'service-not-allowed') {
          setTimeout(() => {
            if (voiceMode && !isWakeWordRunningRef.current && !isRecognitionRunningRef.current) {
              try { wakeWordRecognitionRef.current.start(); } catch (e) {}
            }
          }, 1000);
        }
      };

      recognition.onend = () => {
        console.log('🎤 Speech recognition ended');
        isRecognitionRunningRef.current = false;
        setIsListening(false);

        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        
        const transcript = accumulatedTranscriptRef.current.trim();
        if (transcript && !isLoading && !isSubmittingRef.current) {
          // CANCEL: intercept cancel words before sending
          if (isCancelCommand(transcript)) {
            console.log('🛑 Cancel word on recognition end - interrupting:', transcript);
            accumulatedTranscriptRef.current = '';
            setInput('');
            interruptLexi();
          } else {
            console.log('🎤 Recognition ended - sending accumulated:', transcript);
            accumulatedTranscriptRef.current = '';
            handleSendMessage(transcript, voiceMode);
          }
        }

        if (voiceMode && wakeWordRecognitionRef.current && !isWakeWordRunningRef.current) {
          setTimeout(() => {
            if (voiceMode && !isWakeWordRunningRef.current && !isRecognitionRunningRef.current) {
              try {
                wakeWordRecognitionRef.current.start();
                console.log('🔄 Wake word restarted after mic recognition ended');
              } catch (e) {}
            }
          }, 1000);
        }
      };

      recognitionRef.current = recognition;

      return () => {
        // Cleanup silence timeout
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
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
  }, [voiceMode, isSpeaking, isLoading]);

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

      // CANCEL: Check for stop/cancel words first — interrupt Lexi immediately
      const CANCEL_WORDS_WW = ['cancel', 'stop', 'stop it', 'stop talking', 'be quiet', 'shut up',
        'enough', 'never mind', 'nevermind', 'disregard', 'quiet', 'pause', 'shush',
        'ok stop', 'please stop', 'halt', 'silence'];
      const transcriptNorm = transcript.trim().replace(/[.!?,]/g, '');
      if (CANCEL_WORDS_WW.some(w => transcriptNorm === w || transcriptNorm.startsWith(w + ' ') || transcriptNorm.endsWith(' ' + w))) {
        console.log('🛑 Cancel word detected in wake word listener:', transcript);
        interruptLexi();
        return;
      }

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
              recognitionRef.current.start();
            } catch (e) {
              setMicrophoneError('Failed to start listening. Please try again.');
            }
          }
        }, 300);
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
      
      // Don't restart on aborted - manual stop
      if (event.error === 'aborted') {
        console.log('🛑 Wake word aborted (manual stop)');
        return;
      }
      
      // Restart on other errors with longer delay
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
      
      if (voiceMode && !isRecognitionRunningRef.current) {
        const delay = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 2000 : 500;
        setTimeout(() => {
          if (voiceMode && !isWakeWordRunningRef.current && !isRecognitionRunningRef.current && document.visibilityState === 'visible') {
            try {
              wakeWordRecognition.start();
              console.log('🔄 Wake word auto-restarted');
            } catch (e) {
              console.log('Wake word restart skipped:', e.message);
              setIsWaitingForHeyLexi(false);
            }
          } else {
            setIsWaitingForHeyLexi(false);
          }
        }, delay);
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && voiceMode && !isWakeWordRunningRef.current && !isRecognitionRunningRef.current) {
        setTimeout(() => {
          if (voiceMode && !isWakeWordRunningRef.current && !isRecognitionRunningRef.current) {
            try {
              wakeWordRecognition.start();
              console.log('🔄 Wake word restarted after tab visible');
            } catch (e) {}
          }
        }, 500);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (isWakeWordRunningRef.current) {
        try {
          wakeWordRecognition.stop();
          isWakeWordRunningRef.current = false;
        } catch (e) {}
      }
    };
  }, [voiceMode]);

  // Removed unused knowledge base query that might cause performance issues

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

  const stopSpeaking = () => {
    console.log('🛑 stopSpeaking called');
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = ''; // Clear source to prevent resume
    }
    setIsSpeaking(false);
  };
  
  // INTERRUPTION: Cancel any pending LLM request
  const cancelPendingRequest = () => {
    if (abortControllerRef.current) {
      console.log('🛑 Cancelling pending LLM request');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };
  
  // CANCEL WORDS: phrases that should stop Lexi rather than be sent as messages
  const CANCEL_WORDS = ['cancel', 'stop', 'stop it', 'stop talking', 'be quiet', 'shut up',
    'enough', 'never mind', 'nevermind', 'disregard', 'quiet', 'pause', 'shush',
    'ok stop', 'please stop', 'halt', 'silence'];
  
  const isCancelCommand = (text) => {
    if (!text) return false;
    const normalized = text.trim().toLowerCase().replace(/[.!?,]/g, '');
    return CANCEL_WORDS.some(word => normalized === word || normalized.startsWith(word + ' ') || normalized.endsWith(' ' + word));
  };

  // INTERRUPTION: Full stop - audio + requests
  const interruptLexi = () => {
    console.log('⚡ INTERRUPT: Stopping Lexi completely');
    stopSpeaking();
    cancelPendingRequest();
    setIsLoading(false);
  };

  // BUG FIX: Track TTS requests to prevent overlapping audio
  const ttsRequestIdRef = useRef(0);
  
  const speakResponse = async (text) => {
    // BUG FIX: Generate unique request ID and track it
    const requestId = ++ttsRequestIdRef.current;
    
    try {
      console.log('🔊 speakResponse CALLED, requestId:', requestId);

      // Stop any currently playing audio first
      stopSpeaking();
      setIsSpeaking(true);

      // Use selected voice engine
      const response = voiceEngine === 'gemini' 
        ? await base44.functions.invoke('geminiTTS', { text: text, voice: geminiVoice })
        : await base44.functions.invoke('elevenLabsSpeak', {
            text: text,
            voice_id: elevenLabsVoice
          });

      // BUG FIX: Check if this request is still current
      if (ttsRequestIdRef.current !== requestId) {
        console.log('⏭️ TTS request superseded, ignoring:', requestId);
        return;
      }

      if (response.data?.audio_url) {
        if (!audioRef.current) {
          console.error('❌ Audio element is NULL!');
          setIsSpeaking(false);
          return;
        }

        // BUG FIX: Stop current audio before setting new source
        if (audioRef.current.src) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }

        audioRef.current.src = response.data.audio_url;
        
        audioRef.current.onerror = (e) => {
          console.error('❌ Audio playback error:', e);
          setIsSpeaking(false);
        };

        audioRef.current.onended = () => {
          setIsSpeaking(false);

          if (voiceMode && wakeWordRecognitionRef.current && !isWakeWordRunningRef.current && !isRecognitionRunningRef.current) {
            setTimeout(() => {
              try {
                wakeWordRecognitionRef.current.start();
                console.log('🔄 Wake word restarted after TTS ended');
              } catch (e) {
                console.log('Wake word restart after TTS failed:', e.message);
              }
            }, 500);
          }
        };

        // BUG FIX: Final check before playing
        if (ttsRequestIdRef.current !== requestId) {
          console.log('⏭️ TTS request superseded before play:', requestId);
          setIsSpeaking(false);
          return;
        }

        try {
          await audioRef.current.play();
        } catch (playError) {
          console.error('❌ play() failed:', playError);
          setIsSpeaking(false);
          
          // BUG FIX: Only show error for user-initiated actions, not for interrupted playback
          if (playError.name === 'NotAllowedError') {
            console.log('🔇 Audio blocked by browser autoplay policy');
          }
          // Don't alert - this causes spam
        }
      } else {
        console.error('❌ No audio_url in backend response');
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error('❌ speakResponse error:', error);
      setIsSpeaking(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadedFiles(prev => [...prev, { name: file.name, url: file_url }]);
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

        // CANCEL: Safety net — if a cancel word slips through, stop Lexi instead of sending
        if (isCancelCommand(userMessage)) {
          console.log('🛑 Cancel word caught in handleSendMessage:', userMessage);
          setInput('');
          interruptLexi();
          return;
        }

        // BUG FIX: Prevent duplicate submissions
        const now = Date.now();
        const timeSinceLastSubmit = now - lastSubmitTimeRef.current;
        const isDuplicateMessage = userMessage === lastSubmittedMessageRef.current && timeSinceLastSubmit < 3000;
        
        if (isSubmittingRef.current || isDuplicateMessage) {
          console.log('⚠️ Blocked duplicate submission:', { 
            isSubmitting: isSubmittingRef.current, 
            isDuplicate: isDuplicateMessage,
            timeSinceLastSubmit 
          });
          return;
        }
        
        isSubmittingRef.current = true;
        lastSubmittedMessageRef.current = userMessage;
        lastSubmitTimeRef.current = now;

        // CRITICAL: Ensure company is loaded before sending to Lexi
        if (!myCompany?.id) {
          isSubmittingRef.current = false;
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '⚠️ Loading company context... Please wait a moment and try again.',
            timestamp: new Date().toISOString()
          }]);
          return;
        }

        console.log('📤 Sending message with company ID:', myCompany?.id, 'Company:', myCompany.company_name);

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
        if (!myCompany?.id) {
          throw new Error('Company ID not loaded. Please refresh the page.');
        }

        // INTERRUPTION: Cancel any pending request and create new AbortController
        cancelPendingRequest();
        abortControllerRef.current = new AbortController();
        const requestId = ++currentRequestIdRef.current;
        
        console.log('📤 Starting LLM request #', requestId);

        const response = await base44.functions.invoke('lexiChat', {
            message: userMessage,
            conversationHistory: newMessages.slice(-20).map(msg => ({
              role: msg.role,
              content: msg.content
            })),
            companyId: myCompany.id,
            sessionId: currentSessionId,
            file_urls: uploadedFiles.length > 0 ? uploadedFiles.map(f => f.url) : undefined,
          });
        
        // Check if this request was superseded
        if (currentRequestIdRef.current !== requestId) {
          console.log('⏭️ Request #', requestId, 'superseded, ignoring response');
          return;
        }

        console.log('📥 Lexi response:', response.data);

        setUploadedFiles([]);

        // 🚨 HANDLE CONFIRMATION REQUESTS
        if (response.data.requires_confirmation && response.data.proposed_action) {
          console.log('⚠️ Lexi needs confirmation for:', response.data.proposed_action.type);
          
          setPendingAction(response.data.proposed_action);
          setShowConfirmationDialog(true);
          setIsLoading(false);
          
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: response.data.response,
            timestamp: new Date().toISOString()
          }]);
          
          return;
        }

        const assistantResponse = response.data.response || 'I encountered an error. Please try again.';

        // Show actions executed in the UI
        if (response.data.actions_executed?.length > 0) {
          console.log('✅ Actions executed:', response.data.actions_executed);
        }

        // Show scheduling status in UI if calendar action was executed
        const calendarAction = response.data.actions_executed?.find(a => a.tool_name === 'create_event');
        if (calendarAction) {
          console.log('📅 Calendar event created:', calendarAction);
        }

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: assistantResponse,
          timestamp: new Date().toISOString(),
          actions: response.data.actions_executed || []
        }]);

        // 🔊 ALWAYS speak response when voice mode is enabled or shouldSpeak is true
        // But ONLY if this request is still current (not interrupted)
        if (currentRequestIdRef.current === requestId && (voiceMode || shouldSpeak)) {
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

          console.log('🔊 Speaking response (request #', requestId, ')');
          await speakResponse(cleanText);
        } else if (currentRequestIdRef.current !== requestId) {
          console.log('⏭️ Not speaking - request was superseded');
        }

        if (response.data.actions_executed?.length > 0) {
          queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
          queryClient.invalidateQueries({ queryKey: ['leads'] });
          queryClient.invalidateQueries({ queryKey: ['customers'] });
          queryClient.invalidateQueries({ queryKey: ['projects'] });
          queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
          queryClient.invalidateQueries({ queryKey: ['subcontractors'] });
          queryClient.invalidateQueries({ queryKey: ['estimates'] });
          queryClient.invalidateQueries({ queryKey: ['invoices'] });
          queryClient.invalidateQueries({ queryKey: ['payouts'] });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        }
      } catch (error) {
        console.error("Lexi AI Assistant error:", error);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Sorry, I encountered an error: ${error.message || "An unknown error occurred."}`,
          timestamp: new Date().toISOString()
        }]);
      }

    setIsLoading(false);
    isSubmittingRef.current = false;
  };

  const sendMessage = () => handleSendMessage();

  const handleVoiceInput = () => {
    if (!recognitionRef.current) {
      setMicrophoneError("Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.");
      return;
    }

    if (microphonePermission === 'denied' || microphonePermission === 'unknown') {
      setMicrophoneError("⚠️ Please click 'Enable Mic' first to grant microphone permission.");
      testMicrophone();
      return;
    }

    if (isListening || isRecognitionRunningRef.current) {
      // Stop listening and send accumulated transcript
      try {
        // Clear silence timeout
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
        
        recognitionRef.current.stop();
        isRecognitionRunningRef.current = false;
        setIsListening(false);
        
        // Send accumulated transcript or current input
        const transcript = accumulatedTranscriptRef.current.trim() || input.trim();
        accumulatedTranscriptRef.current = '';
        
        if (transcript && !isLoading && !isSubmittingRef.current) {
          // CANCEL: intercept cancel words
          if (isCancelCommand(transcript)) {
            console.log('🛑 Cancel word via mic stop - interrupting:', transcript);
            setInput('');
            interruptLexi();
          } else {
            console.log('🎤 Mic stopped - sending:', transcript);
            handleSendMessage(transcript, voiceMode);
          }
        }
      } catch (e) {
        console.log('Error stopping recognition:', e);
      }
    } else {
      try {
        setMicrophoneError(null);
        setInput(''); // Clear input before starting
        accumulatedTranscriptRef.current = ''; // Reset accumulated
        
        // INTERRUPTION: Stop Lexi before starting to listen
        if (isSpeaking || isLoading) {
          interruptLexi();
        }
        
        recognitionRef.current.start();
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        isRecognitionRunningRef.current = false;
        setIsListening(false);
        
        if (error.message.includes('not-allowed') || error.message.includes('permission')) {
          setMicrophoneError('⚠️ Microphone access denied. Click "Test Microphone" to grant permission.');
          setMicrophonePermission('denied');
        } else {
          setMicrophoneError('Failed to start voice input. Please try again or click "Test Microphone".');
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
    const displayName = myStaffProfile?.full_name?.split(' ')[0] || user?.full_name?.split(' ')[0] || user?.email.split('@')[0];

    setMessages([{
      role: 'assistant',
      content: `Hi ${displayName}! ${t.ai.lexi}, ${t.ai.greeting}`,
      timestamp: new Date().toISOString()
    }]);
    setCurrentSessionId(null);
  };

  // Build system prompt for S2S mode
  const systemPrompt = React.useMemo(() => {
    if (!myCompany || !user) return "You are Lexi, a helpful AI assistant.";

    const displayName = myStaffProfile?.full_name || user.full_name || user.email;
    const isAdmin = myCompany?.created_by === user.email || myStaffProfile?.is_super_admin;

    return `You are Lexi, an AI assistant for ${myCompany.company_name}.

👤 USER CONTEXT:
- Current User: ${displayName}
- Role: ${isAdmin ? 'Administrator' : myStaffProfile?.role_name || 'Staff Member'}

📋 COMPANY CONTEXT:
- Company Name: ${myCompany.company_name}
- Your CRM System: CompanySync

🔒 CRITICAL SECURITY RULES:
1. You work EXCLUSIVELY for ${myCompany.company_name}. This is your ONLY client.
2. You CANNOT access data from any other company.
3. When asked "what is the name of this company", ALWAYS answer: "${myCompany.company_name}".
4. Your CRM platform is called "CompanySync" - NEVER mention external CRM names like Salesforce or HubSpot.
5. If you don't have information, say you don't know - DO NOT make up information.

🎯 CAPABILITIES:
- You have access to ${myCompany.company_name}'s CRM data via CompanySync.
- Keep responses short and conversational (phone calls are typically brief).
- Be warm, professional, and helpful.`;
  }, [myCompany, user, myStaffProfile]);

  const handleConfirmAction = async () => {
    if (!pendingAction) return;

    setShowConfirmationDialog(false);
    setIsLoading(true);

    // Keep the action details visible in the thread
    const actionType = pendingAction.type === 'email' ? '📧 Email' : '💬 Text';
    const actionSummary = pendingAction.type === 'email' 
      ? `${actionType} to ${pendingAction.to}\nSubject: ${pendingAction.subject}\n\n${pendingAction.message}`
      : `${actionType} to ${pendingAction.to}: "${pendingAction.message}"`;

    setMessages(prev => [...prev, {
      role: 'user',
      content: `[Confirmed] ${actionSummary}`,
      timestamp: new Date().toISOString()
    }]);

    try {
      if (pendingAction.type === 'email') {
        console.log('📧 Sending email...');
        const response = await base44.functions.invoke('sendEmailFromCRM', {
          to: pendingAction.to,
          subject: pendingAction.subject || 'Message from ' + (myCompany?.company_name || 'our team'),
          message: pendingAction.message,
          contactName: pendingAction.contact_name,
          companyId: myCompany?.id
        });

        if (response.data && response.data.success === false) {
           throw new Error(response.data.error || 'Unknown error');
        }

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ Email sent successfully to ${pendingAction.to}`,
          timestamp: new Date().toISOString()
        }]);
      } else if (pendingAction.type === 'sms') {
        console.log('💬 Sending SMS...');
        const response = await base44.functions.invoke('sendSMS', {
          to: pendingAction.to,
          message: pendingAction.message,
          contactName: pendingAction.contact_name,
          companyId: myCompany?.id,
          senderEmail: user?.email
        });

        if (response.data && response.data.success === false) {
           throw new Error(response.data.error || 'Unknown error');
        }

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ Text message sent successfully to ${pendingAction.to}`,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (error) {
      console.error('❌ Failed to send:', error);
      // Special handling for 200 OK responses that contain error fields
      if (error.response?.data?.error) {
         setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ Failed to send: ${error.response.data.error}`,
          timestamp: new Date().toISOString()
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ Failed to send: ${error.message}`,
          timestamp: new Date().toISOString()
        }]);
      }
    }

    setPendingAction(null);
    setIsLoading(false);
  };

  return (
    <div className="flex flex-col h-screen" style={{background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 25%, #dbeafe 60%, #fce7f3 100%)'}}>
      <audio ref={audioRef} onEnded={() => setIsSpeaking(false)} />
      
      <div className="bg-gradient-to-r from-purple-600 via-blue-600 to-pink-600 text-white p-2 md:p-6 shadow-lg flex-shrink-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 md:gap-4">
            <Dialog>
              <DialogTrigger asChild>
                <button className="w-10 h-10 md:w-16 md:h-16 rounded-full overflow-hidden border-2 md:border-4 border-white shadow-lg flex-shrink-0 hover:opacity-80 transition-opacity cursor-pointer">
                  <img 
                    src={myCompany?.lexi_avatar_url || "https://api.dicebear.com/7.x/bottts/svg?seed=lexi&backgroundColor=b6e3f4"} 
                    alt="Lexi"
                    className="w-full h-full object-cover"
                  />
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t.ai.lexiSettings}</DialogTitle>
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
                    <Label htmlFor="avatar-upload">{t.common.upload} New Avatar</Label>
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
                          {uploadingAvatar ? t.common.loading : t.common.select + ' ' + t.common.image}
                        </span>
                      </Button>
                    </label>
                    <p className="text-xs text-gray-500 mt-2">
                      Recommended: Square image, 500x500px or larger
                    </p>
                  </div>

                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertDescription className="text-blue-800">
                      {t.settings.language === 'en' 
                        ? "Upload a custom avatar to personalize Lexi's appearance throughout your CRM. This avatar will appear in the AI Assistant, notifications, and anywhere Lexi is mentioned."
                        : "Sube un avatar personalizado para personalizar la apariencia de Lexi en todo tu CRM. Este avatar aparecerá en el Asistente de IA, las notificaciones y en cualquier lugar donde se mencione a Lexi."}
                    </AlertDescription>
                  </Alert>
                </div>
              </DialogContent>
            </Dialog>

            <div className="flex-1 min-w-0">
              <h1 className="text-lg md:text-3xl font-bold">{t.ai.aiAssistant}</h1>
            </div>
            
            <div className="flex items-center gap-2">
              <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
                <DialogTrigger asChild>
                  <Button variant="ghost" className="text-white hover:bg-white/20">
                    <MessageSquare className="w-5 h-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>{t.sidebar.lexiMemory}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {conversationSessions.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">{t.common.noResults}</p>
                    ) : (
                      conversationSessions.map(session => (
                        <div key={session.session_id} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{session.summary}</p>
                            <p className="text-sm text-gray-500">
                              {format(new Date(session.last_updated), 'MMM d, yyyy h:mm a')} · {session.messages.length} messages
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleLoadConversation(session)}
                          >
                            {t.common.view}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (window.confirm(t.customers.deleteConfirm)) {
                                deleteConversationMutation.mutate(session.session_id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </DialogContent>
              </Dialog>



              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={handleSaveConversation}
                title="Save conversation"
                data-testid="button-save-conversation"
              >
                <Save className="w-5 h-5" />
              </Button>

            </div>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-6 border-b bg-white/80 backdrop-blur-sm flex-shrink-0">
        <div className="max-w-4xl mx-auto">
          <ErrorBoundary fallback={
            <div className="text-center py-6 text-sm text-muted-foreground">
              Native voice mode failed to load. Please refresh the page.
            </div>
          }>
            <GeminiLiveNativeClient
              companyId={myCompany?.id}
              onFallbackToTTS={null}
            />
          </ErrorBoundary>
        </div>
      </div>

<div className="flex-1 overflow-y-auto p-4 md:p-6">
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

      <div className="border-t bg-white shadow-2xl p-2 md:p-3 pb-16 md:pb-3 flex-shrink-0">
          <div className="max-w-2xl mx-auto">
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

          <div className="flex gap-1.5 items-center">
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              className="h-10 w-10 border-2 border-purple-200 hover:border-purple-500 flex-shrink-0 p-0"
              size="icon"
              disabled={isUploadingFile}
            >
              {isUploadingFile ? (
                <Loader2 className="w-4 h-4 text-purple-600 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4 text-purple-600" />
              )}
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={t.ai.askQuestion}
              className="flex-1 h-10 text-sm md:text-base border-2 border-purple-200 focus:border-purple-500"
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 h-10 w-10 flex-shrink-0 p-0"
              size="icon"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

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
                {t.settings.language === 'en' ? 'Review the message below before sending. You can edit the recipient and message if needed.' : 'Revise el mensaje a continuación antes de enviarlo. Puede editar el destinatario y el mensaje si es necesario.'}
              </AlertDescription>
            </Alert>

            <div>
              <Label>{t.common.to}</Label>
              <Input
                value={pendingAction?.to || ''}
                onChange={(e) => setPendingAction({...pendingAction, to: e.target.value})}
                placeholder={pendingAction?.type === 'email' ? 'customer@example.com' : '+1234567890'}
              />
            </div>

            {pendingAction?.type === 'email' && (
              <div>
                <Label>{t.communication.subject}</Label>
                <Input
                  value={pendingAction?.subject || ''}
                  onChange={(e) => setPendingAction({...pendingAction, subject: e.target.value})}
                  placeholder="Email subject"
                />
              </div>
            )}

            <div>
              <Label>{t.communication.message}</Label>
              <Textarea
                value={pendingAction?.message || ''}
                onChange={(e) => setPendingAction({...pendingAction, message: e.target.value})}
                rows={8}
                className="font-mono text-sm"
              />
            </div>

            <div>
              <Label>{t.common.name} (Optional)</Label>
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
              {t.common.cancel}
            </Button>
            <Button
              onClick={handleConfirmAction}
              disabled={!pendingAction?.to || !pendingAction?.message}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {pendingAction?.type === 'email' ? `📧 ${t.communication.send} Email` : `💬 ${t.communication.send} Text`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.common.save} {t.sidebar.messages}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t.common.name}</Label>
              <Input
                placeholder="e.g., Estimate for John Doe"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
              />
                  <p className="text-xs text-gray-500 mt-1">
                {t.settings.language === 'en' ? 'Leave as-is or edit to customize' : 'Dejar como está o editar para personalizar'}
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
                {t.common.cancel}
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
                {saveConversationMutation.isPending ? t.settings.saving : t.common.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}