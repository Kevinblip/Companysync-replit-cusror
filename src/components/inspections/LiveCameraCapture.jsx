import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, RefreshCw, Mic, StopCircle, Volume2, Ruler } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import ARMeasureMode from './ARMeasureMode';

const LiveCameraCapture = ({ onUpload, onVoiceNote, onVoiceCaptionForLastPhoto, setActiveSection, sections, sectionPhotoCount, onGuidedModeChange, jobId, companyId, onMeasurementSaved }) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const recognitionRef = useRef(null);
    const audioRef = useRef(null);
    const lastUploadedPhotoIdRef = useRef(null);
    const isSpeakingRef = useRef(false);
    const streamRef = useRef(null);
    const [stream, setStream] = useState(null);
    const [cameraError, setCameraError] = useState(null);
    const [facingMode, setFacingMode] = useState('environment');
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [isRecordingVoice, setIsRecordingVoice] = useState(false);
    const [uploadQueue, setUploadQueue] = useState([]);
    const [voiceCommandMode, setVoiceCommandMode] = useState(false);
    const [lastVoiceCommand, setLastVoiceCommand] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [arMeasureActive, setArMeasureActive] = useState(false);

    // Extended section keywords for voice recognition
    const sectionKeywords = {
        'front elevation': 'Front Elevation',
        'front elev': 'Front Elevation',
        'right elevation': 'Right Elevation',
        'right elev': 'Right Elevation',
        'right side': 'Right Elevation',
        'rear elevation': 'Rear Elevation',
        'rear elev': 'Rear Elevation',
        'back elevation': 'Rear Elevation',
        'left elevation': 'Left Elevation',
        'left elev': 'Left Elevation',
        'left side': 'Left Elevation',
        'front slope': 'Front Slope',
        'right slope': 'Right Slope',
        'back slope': 'Back Slope',
        'rear slope': 'Back Slope',
        'left slope': 'Left Slope',
        'siding': 'Siding',
        'side wall': 'Siding',
        'sidewall': 'Siding',
        'gutters': 'Gutters',
        'gutter': 'Gutters',
        'gutter line': 'Gutters',
        'window seals': 'Window Seals',
        'window seal': 'Window Seals',
        'windows': 'Window Seals',
        'window': 'Window Seals',
        'soft metals': 'Soft Metals',
        'soft metal': 'Soft Metals',
        'step flashing': 'Soft Metals',
        'cap flashing': 'Soft Metals',
        'valley metal': 'Soft Metals',
        'flashing': 'Soft Metals',
        'interior': 'Interior',
        'inside': 'Interior',
        'attic': 'Interior',
        'ceiling': 'Interior',
        'ridge': 'Other',
        'ridgeline': 'Other',
        'hip': 'Other',
        'chimney': 'Other',
        'skylight': 'Other',
        'other': 'Other',
        'misc': 'Other',
        'miscellaneous': 'Other',
        // broad fallbacks last so specific ones win
        'front': 'Front Elevation',
        'rear': 'Rear Elevation',
        'back': 'Rear Elevation',
        'left': 'Left Elevation',
        'right': 'Right Elevation',
    };

    // Photo trigger keywords
    const photoTriggerKeywords = ['take photo', 'take picture', 'capture', 'photo', 'picture', 'snap', 'shoot', 'click'];

    // TTS helper — sets isSpeakingRef so mic recognition ignores echo
    const speak = useCallback((text) => {
        try {
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance(text);
            utter.rate = 1.05;
            utter.pitch = 1;
            utter.onstart = () => { isSpeakingRef.current = true; };
            utter.onend = () => {
                // Keep mic muted a bit longer to let audio tail off
                setTimeout(() => { isSpeakingRef.current = false; }, 600);
            };
            window.speechSynthesis.speak(utter);
        } catch (e) {
            console.log('TTS failed:', e);
        }
    }, []);

    // Create camera shutter sound
    useEffect(() => {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        const playShutterSound = () => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.1);
        };
        
        audioRef.current = { play: playShutterSound };
    }, []);

    // Confirmation beep
    const playConfirmBeep = useCallback(() => {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            oscillator.frequency.value = 1200;
            oscillator.type = 'sine';
            gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.15);
        } catch (e) {
            console.log('Beep failed');
        }
    }, []);

    const stopCurrentStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    }, []);

    const startCamera = useCallback(async (mode) => {
        stopCurrentStream();
        setCameraError(null);
        setIsCameraReady(false);

        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: mode } }
            });
            streamRef.current = newStream;
            setStream(newStream);
            if (videoRef.current) {
                videoRef.current.srcObject = newStream;
                await videoRef.current.play();
            }
            setIsCameraReady(true);
            setCameraError(null);
        } catch (err) {
            console.warn('Camera attempt failed:', err.name, 'trying fallback...');
            // Permission errors can't be fixed by retrying with different constraints
            if (err.name === 'NotAllowedError') {
                setCameraError('Camera permission denied. Tap Retry and allow access when prompted.');
                setIsCameraReady(false);
                return;
            }
            // For hardware/busy errors, try a bare video constraint as fallback
            try {
                const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
                streamRef.current = fallbackStream;
                setStream(fallbackStream);
                if (videoRef.current) {
                    videoRef.current.srcObject = fallbackStream;
                    await videoRef.current.play();
                }
                setIsCameraReady(true);
                setCameraError(null);
            } catch (fallbackErr) {
                console.error('Error accessing camera:', fallbackErr);
                const msg = fallbackErr.name === 'NotReadableError'
                    ? 'Camera is in use by another app. Close other apps and tap Retry.'
                    : 'Could not start camera. Tap Retry to try again.';
                setCameraError(msg);
                setIsCameraReady(false);
            }
        }
    }, [stopCurrentStream]);

    useEffect(() => {
        startCamera(facingMode);
        return () => {
            stopCurrentStream();
            if (recognitionRef.current) {
                try { recognitionRef.current.stop(); } catch (e) {}
            }
        };
    }, [facingMode]);

    const takePhoto = async () => {
        if (!videoRef.current || !isCameraReady) return;
        
        try {
            audioRef.current?.play();
        } catch (e) {}
        
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        if (videoRef.current) {
            videoRef.current.style.filter = 'brightness(1.8)';
            setTimeout(() => {
                if (videoRef.current) videoRef.current.style.filter = 'brightness(1)';
            }, 150);
        }
        
        canvas.toBlob(async (blob) => {
            if (!blob) return;
            const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
            setUploadQueue(prev => [...prev, file.name]);
            try {
                const result = await onUpload({ file, caption: '' });
                lastUploadedPhotoIdRef.current = result?.id;
                setUploadQueue(prev => prev.filter(name => name !== file.name));
            } catch (error) {
                console.error('Upload failed:', error);
                setUploadQueue(prev => prev.filter(name => name !== file.name));
            }
        }, 'image/jpeg', 0.9);
    };

    const switchCamera = () => {
        setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    };

    // Parse voice command for section and photo trigger
    const parseVoiceCommand = useCallback((transcript) => {
        const lowerTranscript = transcript.toLowerCase().trim();
        console.log('🎤 Voice command received:', lowerTranscript);
        
        let detectedSection = null;
        let shouldTakePhoto = false;

        // Check for section keywords — longer phrases first for specificity
        const sortedKeywords = Object.entries(sectionKeywords).sort((a, b) => b[0].length - a[0].length);
        for (const [keyword, sectionName] of sortedKeywords) {
            if (lowerTranscript.includes(keyword)) {
                detectedSection = sectionName;
                break;
            }
        }

        // Check for photo trigger keywords
        for (const trigger of photoTriggerKeywords) {
            if (lowerTranscript.includes(trigger)) {
                shouldTakePhoto = true;
                break;
            }
        }

        return { detectedSection, shouldTakePhoto, transcript: lowerTranscript };
    }, []);

    // Stop guided mode
    const stopGuidedMode = useCallback(() => {
        recognitionRef.current?.stop();
        setVoiceCommandMode(false);
        setIsListening(false);
        setInterimTranscript('');
        setLastVoiceCommand('');
        window.speechSynthesis.cancel();
        if (onGuidedModeChange) onGuidedModeChange(false);
    }, [onGuidedModeChange]);

    // Handle voice command mode (continuous listening)
    const startVoiceCommandMode = useCallback(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('Voice recognition is not supported in your browser. Please try Google Chrome or Safari.');
            return;
        }

        if (voiceCommandMode) {
            stopGuidedMode();
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            setVoiceCommandMode(true);
            setIsListening(true);
            playConfirmBeep();
            speak('Guided Inspection started. Say a section name to begin, then describe the damage.');
            console.log('🎤 Voice command mode started');
            if (onGuidedModeChange) onGuidedModeChange(true);
        };

        recognition.onresult = async (event) => {
            // Ignore everything while TTS is playing (prevents echo feedback)
            if (isSpeakingRef.current) return;
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    const transcript = event.results[i][0].transcript;
                    setInterimTranscript('');
                    const { detectedSection, shouldTakePhoto } = parseVoiceCommand(transcript);
                    setLastVoiceCommand(transcript);

                    if (detectedSection && setActiveSection && sections?.includes(detectedSection)) {
                        console.log('📍 Switching to section:', detectedSection);
                        setActiveSection(detectedSection);
                        playConfirmBeep();
                        speak(`Now on: ${detectedSection}`);
                    }

                    if (shouldTakePhoto) {
                        console.log('📸 Taking photo via voice command');
                        setTimeout(() => {
                            takePhoto();
                        }, detectedSection ? 400 : 0);
                    }

                    if (!detectedSection && !shouldTakePhoto && transcript.trim()) {
                        if (lastUploadedPhotoIdRef.current && onVoiceCaptionForLastPhoto) {
                            onVoiceCaptionForLastPhoto(lastUploadedPhotoIdRef.current, transcript);
                            lastUploadedPhotoIdRef.current = null;
                        } else if (onVoiceNote) {
                            onVoiceNote(transcript + ' ');
                        }
                    }
                } else {
                    interim += event.results[i][0].transcript;
                }
            }
            if (interim) setInterimTranscript(interim);
        };

        recognition.onend = () => {
            if (voiceCommandMode) {
                try {
                    recognition.start();
                } catch (e) {
                    console.log('Recognition restart failed');
                    setVoiceCommandMode(false);
                    setIsListening(false);
                    if (onGuidedModeChange) onGuidedModeChange(false);
                }
            } else {
                setIsListening(false);
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                alert('Voice recognition blocked. Please allow microphone access in your browser settings.');
                setVoiceCommandMode(false);
                setIsListening(false);
                if (onGuidedModeChange) onGuidedModeChange(false);
            } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
                setTimeout(() => {
                    if (voiceCommandMode) {
                        try { recognition.start(); } catch (e) {}
                    }
                }, 1000);
            }
        };

        try {
            recognition.start();
            recognitionRef.current = recognition;
        } catch (e) {
            console.error("Could not start recognition service:", e);
            alert("Could not start voice recognition. It might be already active or blocked by your browser.");
        }
    }, [voiceCommandMode, parseVoiceCommand, setActiveSection, sections, takePhoto, onVoiceCaptionForLastPhoto, onVoiceNote, playConfirmBeep, speak, stopGuidedMode, onGuidedModeChange]);

    // Simple voice note (single capture)
    const handleVoiceNote = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('Voice recognition is not supported in your browser. Please try Google Chrome or Safari.');
            return;
        }

        if (isRecordingVoice) {
            recognitionRef.current?.stop();
            setIsRecordingVoice(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => setIsRecordingVoice(true);
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            if (transcript) {
                if (lastUploadedPhotoIdRef.current && onVoiceCaptionForLastPhoto) {
                    onVoiceCaptionForLastPhoto(lastUploadedPhotoIdRef.current, transcript);
                    lastUploadedPhotoIdRef.current = null;
                } else if (onVoiceNote) {
                    onVoiceNote(transcript + ' ');
                }
            }
        };

        recognition.onend = () => setIsRecordingVoice(false);
        
        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            setIsRecordingVoice(false);
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                alert('Voice recognition blocked. Please allow microphone access in your browser settings.');
            } else {
                alert(`Voice recognition error: ${event.error}. Please try again.`);
            }
        };

        try {
            recognition.start();
            recognitionRef.current = recognition;
        } catch (e) {
            console.error("Could not start recognition service:", e);
            alert("Could not start voice recognition. It might be already active or blocked by your browser.");
        }
    };

    // Sections that appear in the progress tracker
    const progressSections = sections?.filter(s =>
        (sectionPhotoCount && sectionPhotoCount[s] > 0)
    ) || [];

    return (
        <Card className="mb-4">
            <CardContent className="p-2 md:p-4 space-y-4">
                <div className="relative w-full h-[50vh] md:h-96 bg-black rounded-lg overflow-hidden flex items-center justify-center text-white">
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                        style={{ transition: 'filter 0.15s ease-out' }}
                    />
                    
                    {!isCameraReady && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/90">
                            <div className="text-center px-6 max-w-sm">
                                <Camera className={`w-12 h-12 mx-auto mb-3 ${cameraError ? 'text-red-400' : 'animate-pulse text-white'}`} />
                                {cameraError ? (
                                    <>
                                        <p className="text-sm text-red-300 mb-5 leading-relaxed">{cameraError}</p>
                                        <button
                                            onClick={() => startCamera(facingMode)}
                                            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 py-2.5 rounded-full"
                                        >
                                            Retry Camera
                                        </button>
                                    </>
                                ) : (
                                    <p className="text-sm text-white/80">Starting camera...</p>
                                )}
                            </div>
                        </div>
                    )}
                    
                    {uploadQueue.length > 0 && (
                        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                            Uploading {uploadQueue.length} photo{uploadQueue.length > 1 ? 's' : ''}...
                        </div>
                    )}

                    {/* Guided Mode Indicator */}
                    {voiceCommandMode && (
                        <div className="absolute top-2 left-1/2 transform -translate-x-1/2 bg-green-600/90 backdrop-blur-sm px-4 py-2 rounded-full text-sm flex items-center gap-2 animate-pulse">
                            <Volume2 className="w-4 h-4" />
                            <span>Guided Mode Active</span>
                        </div>
                    )}

                    {/* Live interim transcript overlay */}
                    {interimTranscript && voiceCommandMode && (
                        <div className="absolute bottom-28 left-1/2 transform -translate-x-1/2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm text-white max-w-[85%] text-center italic">
                            {interimTranscript}
                        </div>
                    )}

                    {/* Last confirmed voice command */}
                    {lastVoiceCommand && voiceCommandMode && !interimTranscript && (
                        <div className="absolute bottom-28 left-1/2 transform -translate-x-1/2 bg-black/70 backdrop-blur-sm px-4 py-2 rounded-lg text-sm max-w-[90%] text-center">
                            "{lastVoiceCommand}"
                        </div>
                    )}
                    
                    {isCameraReady && (
                    <div className="absolute top-2 right-2 flex gap-2">
                        <Button variant="ghost" size="icon" className="text-white bg-black/30 hover:bg-black/50" onClick={switchCamera}>
                            <RefreshCw className="w-5 h-5" />
                        </Button>
                    </div>
                    )}

                    {isCameraReady && (
                    <div className="absolute bottom-2 inset-x-0 flex justify-center items-center gap-4 md:gap-8">
                        {/* Guided Mode Toggle */}
                        <Button 
                            variant="ghost" 
                            className={`text-white/80 flex flex-col items-center gap-1 h-auto py-2 ${voiceCommandMode ? 'text-green-400 bg-green-900/50' : ''}`} 
                            onClick={startVoiceCommandMode} 
                            size="sm"
                        >
                            <Volume2 className={`w-5 h-5 ${voiceCommandMode ? 'animate-pulse' : ''}`} />
                            <span className="text-[10px]">{voiceCommandMode ? 'Stop' : 'Hands-Free'}</span>
                        </Button>

                        {/* Simple Voice Note */}
                        <Button 
                            variant="ghost" 
                            className={`text-white/80 flex flex-col items-center gap-1 h-auto py-2 ${isRecordingVoice ? 'text-red-500 animate-pulse' : ''}`} 
                            onClick={handleVoiceNote} 
                            size="sm"
                        >
                            {isRecordingVoice ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                            <span className="text-[10px]">{isRecordingVoice ? 'Stop' : 'Note'}</span>
                        </Button>
                        
                        {/* Main Capture Button */}
                        <Button
                            size="icon"
                            className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-white text-black hover:bg-gray-200 border-4 border-black/20"
                            onClick={takePhoto}
                            disabled={!isCameraReady}
                        >
                            <Camera className="w-7 h-7 md:w-8 md:h-8" />
                        </Button>

                        {/* AR Measure Mode Button */}
                        <Button
                            data-testid="button-ar-measure"
                            variant="ghost"
                            className={`text-white/80 flex flex-col items-center gap-1 h-auto py-2 ${arMeasureActive ? 'text-yellow-400 bg-yellow-900/50' : ''}`}
                            onClick={e => { e.stopPropagation(); setArMeasureActive(true); }}
                            size="sm"
                        >
                            <Ruler className="w-5 h-5" />
                            <span className="text-[10px]">Measure</span>
                        </Button>
                        
                        <div className="w-24 absolute right-2 bottom-1" />
                    </div>
                    )}
                </div>

                {/* Section progress tracker */}
                {voiceCommandMode && progressSections.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                        {sections?.map(section => {
                            const count = sectionPhotoCount?.[section] || 0;
                            if (count === 0) return null;
                            return (
                                <span
                                    key={section}
                                    className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-300"
                                >
                                    <span>✓</span>
                                    <span>{section}</span>
                                    <span className="bg-green-200 rounded-full px-1">{count}</span>
                                </span>
                            );
                        })}
                    </div>
                )}

                {/* Voice Commands Help */}
                {voiceCommandMode && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                        <p className="font-semibold text-green-800 mb-2">🎤 Voice Commands:</p>
                        <div className="text-green-700 space-y-1 text-xs">
                            <p><strong>Switch section:</strong> "front elevation", "right elevation", "rear elevation", "left elevation"</p>
                            <p><strong>Slopes:</strong> "front slope", "right slope", "back slope", "left slope"</p>
                            <p><strong>Components:</strong> "siding", "gutters", "window seals", "soft metals", "flashing", "interior"</p>
                            <p><strong>Take photo:</strong> "photo", "capture", "snap"</p>
                            <p><strong>Damage notes:</strong> say anything else → saved as a note for the current section</p>
                        </div>
                    </div>
                )}

                <canvas ref={canvasRef} className="hidden" />
            </CardContent>

            {arMeasureActive && (
                <ARMeasureMode
                    videoRef={videoRef}
                    jobId={jobId}
                    companyId={companyId}
                    onSave={(measurements) => {
                        if (onMeasurementSaved) onMeasurementSaved(measurements);
                    }}
                    onClose={() => setArMeasureActive(false)}
                />
            )}
        </Card>
    );
};

export default LiveCameraCapture;
