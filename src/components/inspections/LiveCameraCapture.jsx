import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, RefreshCw, Mic, Ruler, Pencil, RotateCcw, Upload, X, MoreVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import ARMeasureMode from './ARMeasureMode';
import PhotoDrawingCanvas from './PhotoDrawingCanvas';
import { useAuth } from '@/lib/AuthContext';
import localDb from '@/api/localSdk';

function getDeviceLabel() {
    try {
        const ua = navigator.userAgent;
        if (/iPhone/.test(ua)) return 'iPhone';
        if (/iPad/.test(ua)) return 'iPad';
        if (/Android/.test(ua)) {
            const m = ua.match(/Android[^;]*;\s*([^)]+)\)/);
            return m ? m[1].trim().split(' ').slice(0, 2).join(' ') : 'Android';
        }
        if (/Mac/.test(ua)) return 'Mac';
        if (/Windows/.test(ua)) return 'Windows PC';
        return 'Unknown device';
    } catch (_) { return 'Unknown device'; }
}

function timeAgo(isoString) {
    if (!isoString) return null;
    try {
        const diff = Date.now() - new Date(isoString).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    } catch (_) { return null; }
}

const LiveCameraCapture = ({
    onUpload, onVoiceNote, onVoiceCaptionForLastPhoto,
    activeSection, setActiveSection, sections, sectionPhotoCount,
    onGuidedModeChange, jobId, companyId,
    onMeasurementSaved, onDrawAndAnalyze,
    onVoiceAccessoryCount, voiceCheatSheet
}) => {
    const { user } = useAuth();
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const recognitionRef = useRef(null);
    const lastUploadedPhotoIdRef = useRef(null);
    const streamRef = useRef(null);
    const voiceCommandModeRef = useRef(false);
    const isUploadingRef = useRef(false);
    const isCameraReadyRef = useRef(false);
    const takePhotoRef = useRef(null);
    const lastCaptureTimerRef = useRef(null);
    const voiceNoteBufferRef = useRef('');
    const voiceNoteTimerRef = useRef(null);

    const [stream, setStream] = useState(null);
    const [cameraError, setCameraError] = useState(null);
    const [facingMode, setFacingMode] = useState('environment');
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [uploadQueue, setUploadQueue] = useState([]);
    const [voiceCommandMode, setVoiceCommandMode] = useState(false);
    const [voiceModePreferred, setVoiceModePreferred] = useState(false);
    const [lastVoiceCommand, setLastVoiceCommand] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [arMeasureActive, setArMeasureActive] = useState(false);
    const [capturedBlob, setCapturedBlob] = useState(null);
    const [capturedObjectUrl, setCapturedObjectUrl] = useState(null);
    const [showDrawCanvas, setShowDrawCanvas] = useState(false);
    const [isDrawAnalyzing, setIsDrawAnalyzing] = useState(false);
    const [lastCaptureSrc, setLastCaptureSrc] = useState(null);

    // Inspector Mode state
    const [localActiveSection, setLocalActiveSectionState] = useState(() => sections?.[0] || '');
    const [recentNotes, setRecentNotes] = useState([]);
    const [showOverflowMenu, setShowOverflowMenu] = useState(false);
    const [showHelpPanel, setShowHelpPanel] = useState(false);
    const [hapticEnabled, setHapticEnabled] = useState(() => {
        try { return localStorage.getItem('crewcam_haptic') !== '0'; } catch (_) { return true; }
    });
    const hapticPrefIdRef = useRef(null);
    const facingModePrefIdRef = useRef(null);
    const voiceModePrefIdRef = useRef(null);

    // Tracks the device label + timestamp of the most recently saved pref (for sync hint)
    const [syncedFrom, setSyncedFrom] = useState(null); // { device_label, timestamp }

    // Sync haptic, camera facing, and voice mode preferences from server on mount (cross-device sync)
    useEffect(() => {
        if (!user?.email) return;
        let cancelled = false;
        // Reset banner state immediately so stale UI doesn't linger during async load
        setVoiceModePreferred(false);

        const loadPref = async (prefKey, onFound) => {
            try {
                const filter = { user_email: user.email, pref_key: prefKey };
                if (companyId) filter.company_id = companyId;
                let results = await localDb.entities.UserPreference.filter(filter);
                // Fallback: if company-scoped lookup returned nothing, try user-global row
                if ((!results || results.length === 0) && companyId) {
                    results = await localDb.entities.UserPreference.filter({
                        user_email: user.email, pref_key: prefKey
                    });
                }
                if (cancelled) return;
                if (results && results.length > 0) {
                    const pref = results.reduce((latest, row) =>
                        (row.updated_date || row.created_date || '') > (latest.updated_date || latest.created_date || '')
                            ? row : latest
                    , results[0]);
                    onFound(pref);
                    // Track the most recently synced pref for the sync hint in the overflow menu
                    const ts = pref.updated_date || pref.created_date || null;
                    setSyncedFrom(prev => {
                        if (!ts) return prev;
                        if (!prev || ts > prev.timestamp) {
                            return { device_label: pref.device_label || null, timestamp: ts };
                        }
                        return prev;
                    });
                }
            } catch (_) {}
        };

        loadPref('crewcam_haptic', (pref) => {
            hapticPrefIdRef.current = pref.id;
            const serverValue = pref.pref_value !== '0';
            setHapticEnabled(serverValue);
            try { localStorage.setItem('crewcam_haptic', serverValue ? '1' : '0'); } catch (_) {}
        });

        loadPref('crewcam_facing_mode', (pref) => {
            facingModePrefIdRef.current = pref.id;
            const mode = pref.pref_value === 'user' ? 'user' : 'environment';
            setFacingMode(mode);
        });

        loadPref('crewcam_voice_mode', (pref) => {
            voiceModePrefIdRef.current = pref.id;
            // Voice recognition cannot be auto-started without a user gesture,
            // so we surface a "Resume voice mode" prompt instead when pref is on.
            if (pref.pref_value === '1') {
                setVoiceModePreferred(true);
            }
        });

        return () => { cancelled = true; };
    }, [user?.email, companyId]);

    // Auto-dismiss the "Resume voice mode" banner after 6 seconds once it is
    // actually visible (camera ready, not already in voice mode, no captured photo)
    const bannerVisible = voiceModePreferred && isCameraReady && !voiceCommandMode && !capturedObjectUrl;
    useEffect(() => {
        if (!bannerVisible) return;
        const timer = setTimeout(() => setVoiceModePreferred(false), 6000);
        return () => clearTimeout(timer);
    }, [bannerVisible]);

    // Keep local section in sync when sections list first loads
    useEffect(() => {
        if (sections?.length && !localActiveSection) {
            setLocalActiveSectionState(sections[0]);
        }
    }, [sections]);

    // Keep local section in sync when parent activeSection changes (e.g. tapping section tabs)
    useEffect(() => {
        if (activeSection) {
            setLocalActiveSectionState(activeSection);
        }
    }, [activeSection]);

    // Close overflow menu on outside click
    useEffect(() => {
        if (!showOverflowMenu) return;
        const handler = () => setShowOverflowMenu(false);
        document.addEventListener('click', handler, true);
        return () => document.removeEventListener('click', handler, true);
    }, [showOverflowMenu]);

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
        // Compass direction slopes
        'north slope': 'North Slope',
        'north face': 'North Slope',
        'north side': 'North Slope',
        'south slope': 'South Slope',
        'south face': 'South Slope',
        'south side': 'South Slope',
        'east slope': 'East Slope',
        'east face': 'East Slope',
        'east side': 'East Slope',
        'west slope': 'West Slope',
        'west face': 'West Slope',
        'west side': 'West Slope',
        // Intercardinal (diagonal) direction slopes
        'northeast slope': 'Northeast Slope',
        'northeast face': 'Northeast Slope',
        'northeast side': 'Northeast Slope',
        'north east slope': 'Northeast Slope',
        'north east face': 'Northeast Slope',
        'north east side': 'Northeast Slope',
        'northwest slope': 'Northwest Slope',
        'northwest face': 'Northwest Slope',
        'northwest side': 'Northwest Slope',
        'north west slope': 'Northwest Slope',
        'north west face': 'Northwest Slope',
        'north west side': 'Northwest Slope',
        'southeast slope': 'Southeast Slope',
        'southeast face': 'Southeast Slope',
        'southeast side': 'Southeast Slope',
        'south east slope': 'Southeast Slope',
        'south east face': 'Southeast Slope',
        'south east side': 'Southeast Slope',
        'southwest slope': 'Southwest Slope',
        'southwest face': 'Southwest Slope',
        'southwest side': 'Southwest Slope',
        'south west slope': 'Southwest Slope',
        'south west face': 'Southwest Slope',
        'south west side': 'Southwest Slope',
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
        'ridge caps': 'Other',
        'ridge cap': 'Other',
        'ridgecaps': 'Other',
        'ridgecap': 'Other',
        'cap shingles': 'Other',
        'cap shingle': 'Other',
        'ridge line': 'Other',
        'ridgeline': 'Other',
        'ridge': 'Other',
        'hip cap': 'Other',
        'hip': 'Other',
        'chimney': 'Other',
        'skylight': 'Other',
        'other': 'Other',
        'misc': 'Other',
        'miscellaneous': 'Other',
        // Valley
        'valley flashing': 'Valley',
        'valley section': 'Valley',
        'valleys': 'Valley',
        'valley': 'Valley',
        // Fascia
        'fascia board': 'Fascia',
        'fascia boards': 'Fascia',
        'fascia': 'Fascia',
        'facia': 'Fascia',
        // Soffit
        'soffits': 'Soffit',
        'soffit panel': 'Soffit',
        'soffit': 'Soffit',
        // Eaves
        'eave edge': 'Eaves',
        'eave line': 'Eaves',
        'eaves': 'Eaves',
        'eave': 'Eaves',
        // Rake Edge
        'rake edge': 'Rake Edge',
        'rake edges': 'Rake Edge',
        'rake': 'Rake Edge',
        // Drip Edge
        'drip edge': 'Drip Edge',
        'drip edges': 'Drip Edge',
        // Pipe Boots / Pipe Flashings
        'pipe flashing': 'Pipe Boots',
        'pipe flashings': 'Pipe Boots',
        'pipe boots': 'Pipe Boots',
        'pipe boot': 'Pipe Boots',
        'plumbing flashing': 'Pipe Boots',
        // Vents
        'roof vents': 'Vents',
        'roof vent': 'Vents',
        'vents': 'Vents',
        'vent': 'Vents',
        // Decking / Sheathing
        'roof decking': 'Decking',
        'roof deck': 'Decking',
        'sheathing': 'Decking',
        'decking': 'Decking',
        'deck': 'Decking',
        // Underlayment / Felt
        'synthetic underlayment': 'Underlayment',
        'felt paper': 'Underlayment',
        'underlayment': 'Underlayment',
        'felt': 'Underlayment',
        // Ice & Water Shield
        'ice and water shield': 'Ice & Water Shield',
        'ice water shield': 'Ice & Water Shield',
        'ice barrier': 'Ice & Water Shield',
        'ice dam': 'Ice & Water Shield',
        // Garage
        'garage elevation': 'Garage',
        'garage': 'Garage',
        // Porch / Carport
        'porch roof': 'Porch',
        'porch': 'Porch',
        'carport': 'Carport',
        // Flat Roof / Low Slope
        'flat roof': 'Flat Roof',
        'low slope': 'Flat Roof',
        'modified bitumen': 'Flat Roof',
        'tpo': 'Flat Roof',
    };

    // Per-job voice alias index built from the actual sections list.
    // Returns a sorted array of [alias, sectionName, isSingleToken] tuples,
    // ordered longest-alias-first so the parse loop always picks the most
    // specific match without needing to re-sort on every transcript.
    const jobSectionIndex = useMemo(() => {
        if (!sections?.length) return [];

        const STOP_WORDS = new Set([
            'and', 'or', 'the', 'a', 'an', 'of', 'for', 'in', 'on',
            'at', 'to', 'by', 'with', 'over', 'under', 'is', 'as',
        ]);

        const seen = {};

        for (const section of sections) {
            const lower = section.toLowerCase();

            // Full lowercased name always maps to this section (highest priority)
            if (!(lower in seen)) seen[lower] = section;

            // Tokenise on whitespace, hyphens, slashes, underscores, parens, ampersands, commas
            const tokens = lower
                .split(/[\s\-\/\\_\(\)&,]+/)
                .filter(t => t.length > 1);

            const sigTokens = tokens.filter(t => !STOP_WORDS.has(t));

            // Generate all contiguous sub-sequences of significant tokens
            for (let len = sigTokens.length; len >= 1; len--) {
                for (let start = 0; start <= sigTokens.length - len; start++) {
                    const phrase = sigTokens.slice(start, start + len).join(' ');
                    if (phrase.length > 2 && !(phrase in seen)) {
                        seen[phrase] = section;
                    }
                }
            }
        }

        // Pre-sort longest-first so the detection loop always picks the most
        // specific alias; tag single-token entries so the caller can apply a
        // word-boundary guard instead of a plain includes() check.
        const sorted = Object.entries(seen)
            .sort((a, b) => b[0].length - a[0].length)
            .map(([alias, section]) => [alias, section, !alias.includes(' ')]);

        console.log('🗂️ Per-job section voice index built:', sorted.length, 'aliases for', sections.length, 'sections');
        return sorted;
    }, [sections]);

    // Multi-word photo triggers (includes() check).
    // Single-word triggers are handled with a word-boundary guard below.
    const photoTriggerKeywords = [
        'take photo', 'take a photo', 'take photos',
        'take picture', 'take a picture', 'take pictures',
        'photo now', 'picture now',
        'snap photo', 'snap it', 'snap',
        'capture photo', 'capture now', 'capture it',
        'get a photo', 'get a picture',
        'shoot it', 'shoot that',
    ];

    // Haptic pulse on photo capture (replaces beep — silent, no mic bleed)
    const vibratePhoto = useCallback(() => {
        if (!hapticEnabled) return;
        try { navigator.vibrate?.(80); } catch (_) {}
    }, [hapticEnabled]);

    // Quiet-on-Upload: abort mic while uploading, restart when queue drains
    useEffect(() => {
        if (uploadQueue.length > 0) {
            isUploadingRef.current = true;
            if (voiceCommandModeRef.current && recognitionRef.current) {
                try { recognitionRef.current.abort(); } catch (_) {}
            }
        } else if (isUploadingRef.current) {
            isUploadingRef.current = false;
            if (voiceCommandModeRef.current && recognitionRef.current) {
                setTimeout(() => {
                    if (voiceCommandModeRef.current && !isUploadingRef.current) {
                        try { recognitionRef.current.start(); } catch (_) {}
                    }
                }, 600);
            }
        }
    }, [uploadQueue.length]);

    // Voice-to-Counter parser
    const parseVoiceCounter = useCallback((transcript) => {
        const lower = transcript.toLowerCase();
        const numMap = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 };
        const accessories = [
            { key: 'pipe_boots', phrases: ['pipe boot', 'pipe boots', 'pipe-boot', 'pipeboots'] },
            { key: 'vents',      phrases: ['vent', 'vents'] },
            { key: 'chimneys',   phrases: ['chimney', 'chimneys'] },
        ];
        for (const acc of accessories) {
            const hasItem = acc.phrases.some(p => lower.includes(p));
            if (!hasItem) continue;
            const numbered = lower.match(
                /(?:add|count|mark|total|record|log|plus)?\s*(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(?:more\s+)?(?:pipe[\s-]boots?|vents?|chimneys?)/i
            );
            if (numbered) {
                const ns = numbered[1].toLowerCase();
                const delta = numMap[ns] ?? parseInt(ns, 10);
                if (!isNaN(delta) && delta >= 1) return { key: acc.key, delta };
            }
            if (/(?:add|another|one more|mark one|log one|record one)\s+(?:a\s+|an\s+)?(?:pipe[\s-]boots?|vent|chimney)/i.test(lower)) {
                return { key: acc.key, delta: 1 };
            }
        }
        return null;
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
                video: { facingMode: { ideal: mode }, width: { ideal: 4096 }, height: { ideal: 3072 } }
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
            if (err.name === 'NotAllowedError') {
                setCameraError('Camera permission denied. Tap Retry and allow access when prompted.');
                setIsCameraReady(false);
                return;
            }
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
            clearTimeout(lastCaptureTimerRef.current);
        };
    }, [facingMode]);

    // Keep ref in sync so voice handler closure always reads latest value
    isCameraReadyRef.current = isCameraReady;

    const takePhoto = async () => {
        if (!videoRef.current || !isCameraReadyRef.current) return;
        vibratePhoto();

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        const angle = screen.orientation?.angle ?? (window.innerWidth < window.innerHeight ? 0 : 90);
        const screenIsPortrait = angle === 0 || angle === 180;
        const videoIsLandscape = vw > vh;
        const needsRotation = screenIsPortrait && videoIsLandscape;

        if (needsRotation) {
            canvas.width = vh;
            canvas.height = vw;
            const ctx = canvas.getContext('2d');
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(angle === 180 ? -Math.PI / 2 : Math.PI / 2);
            ctx.drawImage(video, -vw / 2, -vh / 2);
            ctx.restore();
        } else {
            canvas.width = vw;
            canvas.height = vh;
            canvas.getContext('2d').drawImage(video, 0, 0);
        }

        if (videoRef.current) {
            videoRef.current.style.filter = 'brightness(2)';
            setTimeout(() => { if (videoRef.current) videoRef.current.style.filter = 'brightness(1)'; }, 120);
        }

        canvas.toBlob(async (blob) => {
            if (!blob) return;
            const thumbUrl = URL.createObjectURL(blob);
            clearTimeout(lastCaptureTimerRef.current);
            setLastCaptureSrc(thumbUrl);
            lastCaptureTimerRef.current = setTimeout(() => {
                setLastCaptureSrc(prev => {
                    if (prev === thumbUrl) URL.revokeObjectURL(thumbUrl);
                    return prev === thumbUrl ? null : prev;
                });
            }, 2500);
            const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
            setUploadQueue(prev => [...prev, file.name]);
            try {
                const result = await onUpload({ file, caption: '' });
                lastUploadedPhotoIdRef.current = result?.id;
            } catch (error) {
                console.error('Upload failed:', error);
            } finally {
                setUploadQueue(prev => prev.filter(name => name !== file.name));
            }
        }, 'image/jpeg', 0.92);
    };
    // Keep ref current so the recognition closure always calls the latest takePhoto
    takePhotoRef.current = takePhoto;

    const clearCaptured = useCallback(() => {
        if (capturedObjectUrl) URL.revokeObjectURL(capturedObjectUrl);
        setCapturedBlob(null);
        setCapturedObjectUrl(null);
        setShowDrawCanvas(false);
    }, [capturedObjectUrl]);

    const handleUploadCaptured = useCallback(async () => {
        if (!capturedBlob) return;
        const blob = capturedBlob;
        const objUrl = capturedObjectUrl;
        clearCaptured();
        const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setUploadQueue(prev => [...prev, file.name]);
        if (objUrl) URL.revokeObjectURL(objUrl);
        try {
            const result = await onUpload({ file, caption: '' });
            lastUploadedPhotoIdRef.current = result?.id;
            setUploadQueue(prev => prev.filter(name => name !== file.name));
        } catch (error) {
            console.error('Upload failed:', error);
            setUploadQueue(prev => prev.filter(name => name !== file.name));
        }
    }, [capturedBlob, capturedObjectUrl, clearCaptured, onUpload]);

    const handleDrawAndAnalyzeFromCapture = useCallback(async (annotatedBlob, strokeSummary) => {
        if (!capturedBlob || !onDrawAndAnalyze) return;
        setIsDrawAnalyzing(true);
        try {
            const originalFile = new File([capturedBlob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
            await onDrawAndAnalyze({ originalFile, annotatedBlob, strokeSummary });
            clearCaptured();
        } catch (err) {
            console.error('Draw & Analyze failed:', err);
            alert('Analysis failed: ' + (err.message || 'Unknown error'));
        } finally {
            setIsDrawAnalyzing(false);
        }
    }, [capturedBlob, onDrawAndAnalyze, clearCaptured]);

    const switchCamera = () => {
        const next = facingMode === 'user' ? 'environment' : 'user';
        setFacingMode(next);
        if (user?.email) {
            const devLabel = getDeviceLabel();
            const prefData = {
                user_email: user.email,
                company_id: companyId || null,
                pref_key: 'crewcam_facing_mode',
                pref_value: next,
                device_label: devLabel,
            };
            (async () => {
                try {
                    if (facingModePrefIdRef.current) {
                        await localDb.entities.UserPreference.update(facingModePrefIdRef.current, prefData);
                    } else {
                        const created = await localDb.entities.UserPreference.create(prefData);
                        facingModePrefIdRef.current = created?.id || null;
                    }
                    setSyncedFrom({ device_label: devLabel, timestamp: new Date().toISOString() });
                } catch (_) {}
            })();
        }
    };

    // Section helpers
    const changeSection = useCallback((section) => {
        setLocalActiveSectionState(section);
        if (setActiveSection) setActiveSection(section);
    }, [setActiveSection]);

    const addRecentNote = useCallback((note) => {
        setRecentNotes(prev => [note, ...prev].slice(0, 4));
        if (!hapticEnabled) return;
        try { navigator.vibrate?.([40, 40, 40]); } catch (_) {}
    }, [hapticEnabled]);

    const currentSectionIndex = sections ? sections.indexOf(localActiveSection) : -1;

    const goToPrevSection = useCallback(() => {
        if (!sections?.length) return;
        const idx = currentSectionIndex <= 0 ? sections.length - 1 : currentSectionIndex - 1;
        changeSection(sections[idx]);
    }, [sections, currentSectionIndex, changeSection]);

    const goToNextSection = useCallback(() => {
        if (!sections?.length) return;
        const idx = currentSectionIndex >= sections.length - 1 ? 0 : currentSectionIndex + 1;
        changeSection(sections[idx]);
    }, [sections, currentSectionIndex, changeSection]);

    // Parse voice command
    const parseVoiceCommand = useCallback((transcript) => {
        const lowerTranscript = transcript.toLowerCase().trim();
        console.log('🎤 Voice command received:', lowerTranscript);

        let detectedSection = null;
        let shouldTakePhoto = false;

        // --- Tier 1: Per-job index (custom section names, longest alias wins) ---
        // jobSectionIndex is a pre-sorted array of [alias, sectionName, isSingleToken]
        // tuples. Single-token aliases use a word-boundary regex to avoid matching
        // common words that appear mid-sentence (e.g. "front" in "in front of me").
        if (jobSectionIndex.length > 0) {
            for (const [alias, sectionName, isSingleToken] of jobSectionIndex) {
                const matched = isSingleToken
                    ? new RegExp(`(?<![a-z])${alias}(?![a-z])`).test(lowerTranscript)
                    : lowerTranscript.includes(alias);
                if (matched) {
                    detectedSection = sectionName;
                    console.log('🗂️ Section matched via job index:', alias, '→', detectedSection);
                    break;
                }
            }
        }

        // --- Tier 2: Static canonical keyword map (fallback for standard names) ---
        if (!detectedSection) {
            const sortedKeywords = Object.entries(sectionKeywords).sort((a, b) => b[0].length - a[0].length);
            for (const [keyword, sectionName] of sortedKeywords) {
                if (lowerTranscript.includes(keyword)) {
                    // Prefer the mapped name if it's in the actual sections list;
                    // otherwise fall back to a fuzzy match on the sections prop.
                    if (sections?.includes(sectionName)) {
                        detectedSection = sectionName;
                    } else {
                        const fuzzy = sections?.find(s => s.toLowerCase().includes(keyword));
                        if (fuzzy) detectedSection = fuzzy;
                    }
                    if (detectedSection) {
                        console.log('🗂️ Section matched via static keyword map:', keyword, '→', detectedSection);
                        break;
                    }
                }
            }
        }

        // --- Tier 3: Direct substring match against section names (last resort) ---
        if (!detectedSection && sections) {
            for (const s of sections) {
                if (lowerTranscript.includes(s.toLowerCase())) {
                    detectedSection = s;
                    console.log('🗂️ Section matched via direct substring:', s);
                    break;
                }
            }
        }

        // Photo trigger — multi-word check
        for (const trigger of photoTriggerKeywords) {
            if (lowerTranscript.includes(trigger)) {
                shouldTakePhoto = true;
                break;
            }
        }

        // Short triggers — word-boundary guard so "the photo was blurry" doesn't fire
        if (!shouldTakePhoto) {
            const words = lowerTranscript.trim().split(/\s+/);
            const singlePhotoWords = new Set(['photo', 'photos', 'picture', 'pictures', 'take', 'shoot']);
            if (
                (words[0] === 'capture' && words.length <= 2) ||
                (words.length === 1 && singlePhotoWords.has(words[0])) ||
                lowerTranscript === 'take a shot' ||
                lowerTranscript === 'take shots'
            ) {
                shouldTakePhoto = true;
            }
        }

        // Stop commands — checked LAST so "stop taking photos" is caught before
        // the photo-trigger logic would fire on "photo" / "photos".
        const stopPhrases = [
            'stop', 'done', 'exit', 'quit', 'end', 'finish',
            'stop listening', 'stop voice', 'end voice',
            'stop taking photos', 'stop taking pictures',
            'stop photos', 'stop pictures',
            'end hands free', 'end handsfree',
            'turn off voice', 'disable voice', 'cancel voice',
            'that\'s all', 'thats all', 'all done',
        ];
        const shouldStop = stopPhrases.some(p => lowerTranscript === p || lowerTranscript.startsWith(p + ' ') || lowerTranscript.endsWith(' ' + p));

        return { detectedSection, shouldTakePhoto, shouldStop, transcript: lowerTranscript };
    }, [sections, jobSectionIndex]);

    // Helper to save voice mode preference
    const saveVoiceModePref = useCallback(async (value) => {
        if (!user?.email) return;
        const devLabel = getDeviceLabel();
        const prefData = {
            user_email: user.email,
            company_id: companyId || null,
            pref_key: 'crewcam_voice_mode',
            pref_value: value ? '1' : '0',
            device_label: devLabel,
        };
        try {
            if (voiceModePrefIdRef.current) {
                await localDb.entities.UserPreference.update(voiceModePrefIdRef.current, prefData);
            } else {
                const created = await localDb.entities.UserPreference.create(prefData);
                voiceModePrefIdRef.current = created?.id || null;
            }
            setSyncedFrom({ device_label: devLabel, timestamp: new Date().toISOString() });
        } catch (_) {}
    }, [user?.email, companyId]);

    // Stop guided / inspector mode
    const stopGuidedMode = useCallback(() => {
        voiceCommandModeRef.current = false;
        recognitionRef.current?.stop();
        setVoiceCommandMode(false);
        setIsListening(false);
        setInterimTranscript('');
        setLastVoiceCommand('');
        if (onGuidedModeChange) onGuidedModeChange(false);
        saveVoiceModePref(false);
        // Flush any pending debounced note immediately on stop
        if (voiceNoteTimerRef.current) {
            clearTimeout(voiceNoteTimerRef.current);
            voiceNoteTimerRef.current = null;
            const buffered = voiceNoteBufferRef.current;
            voiceNoteBufferRef.current = '';
            if (buffered) {
                if (lastUploadedPhotoIdRef.current && onVoiceCaptionForLastPhoto) {
                    onVoiceCaptionForLastPhoto(lastUploadedPhotoIdRef.current, buffered);
                    lastUploadedPhotoIdRef.current = null;
                } else if (onVoiceNote) {
                    onVoiceNote(buffered);
                }
            }
        }
    }, [onGuidedModeChange, saveVoiceModePref, onVoiceCaptionForLastPhoto, onVoiceNote]);

    // Start inspector / guided mode
    const startVoiceCommandMode = useCallback(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('Voice recognition is not supported in your browser. Please try Google Chrome or Safari.');
            return;
        }
        if (voiceCommandModeRef.current) {
            stopGuidedMode();
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            voiceCommandModeRef.current = true;
            setVoiceCommandMode(true);
            setVoiceModePreferred(false);
            setIsListening(true);
            if (onGuidedModeChange) onGuidedModeChange(true);
            saveVoiceModePref(true);
        };

        recognition.onresult = async (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    const transcript = event.results[i][0].transcript.trim();
                    if (!transcript) continue;
                    setInterimTranscript('');
                    const { detectedSection, shouldTakePhoto, shouldStop } = parseVoiceCommand(transcript);
                    setLastVoiceCommand(transcript);

                    // Stop command — highest priority, exits immediately
                    if (shouldStop) {
                        stopGuidedMode();
                        continue;
                    }

                    // Voice-to-Counter
                    const counterHit = parseVoiceCounter(transcript);
                    if (counterHit && onVoiceAccessoryCount) {
                        onVoiceAccessoryCount(counterHit.key, counterHit.delta);
                        continue;
                    }

                    // Section switch
                    if (detectedSection) {
                        changeSection(detectedSection);
                    }

                    // Photo
                    if (shouldTakePhoto) {
                        setTimeout(() => { takePhotoRef.current?.(); }, detectedSection ? 400 : 0);
                    }

                    // Note — only when not a pure navigation or photo-only command
                    const lowerTrimmed = transcript.toLowerCase().trim();
                    const captureWords = lowerTrimmed.split(/\s+/);
                    const isOnlyPhotoTrigger = shouldTakePhoto && (
                        photoTriggerKeywords.some(t => lowerTrimmed === t) ||
                        lowerTrimmed === 'take' ||
                        lowerTrimmed === 'shoot' ||
                        lowerTrimmed === 'photo' ||
                        lowerTrimmed === 'picture' ||
                        (captureWords[0] === 'capture' && captureWords.length <= 2)
                    );
                    const isNavigationOnly = !!detectedSection && !shouldTakePhoto;

                    if (!isOnlyPhotoTrigger && !isNavigationOnly && transcript) {
                        const isDamage = /\b(damage|damaged|broken|missing|cracked|hail|impact|dent|puncture|tear|worn|lifted|bruising)\b/i.test(transcript);
                        const noteText = isDamage ? `⚠ ${transcript}` : transcript;

                        // Debounce note emission to handle Android Chrome firing isFinal=true
                        // multiple times for the same utterance as it refines the transcript.
                        // We keep the latest text in a buffer and only commit after 1.5s silence.
                        if (voiceNoteTimerRef.current) clearTimeout(voiceNoteTimerRef.current);
                        voiceNoteBufferRef.current = noteText;
                        voiceNoteTimerRef.current = setTimeout(() => {
                            const buffered = voiceNoteBufferRef.current;
                            voiceNoteBufferRef.current = '';
                            voiceNoteTimerRef.current = null;
                            if (!buffered) return;
                            if (lastUploadedPhotoIdRef.current && onVoiceCaptionForLastPhoto) {
                                onVoiceCaptionForLastPhoto(lastUploadedPhotoIdRef.current, buffered);
                                lastUploadedPhotoIdRef.current = null;
                                addRecentNote(buffered);
                            } else if (onVoiceNote) {
                                onVoiceNote(buffered);
                                addRecentNote(buffered);
                            }
                        }, 1500);
                    }
                } else {
                    interim += event.results[i][0].transcript;
                }
            }
            if (interim) setInterimTranscript(interim);
        };

        recognition.onend = () => {
            if (voiceCommandModeRef.current && !isUploadingRef.current) {
                try {
                    setTimeout(() => {
                        if (voiceCommandModeRef.current && !isUploadingRef.current) recognition.start();
                    }, 200);
                } catch (e) {
                    voiceCommandModeRef.current = false;
                    setVoiceCommandMode(false);
                    setIsListening(false);
                    if (onGuidedModeChange) onGuidedModeChange(false);
                }
            } else if (!voiceCommandModeRef.current) {
                setIsListening(false);
            }
        };

        recognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                alert('Microphone access is blocked. Please allow microphone access in your browser settings, then try again.');
                voiceCommandModeRef.current = false;
                setVoiceCommandMode(false);
                setIsListening(false);
                if (onGuidedModeChange) onGuidedModeChange(false);
                // Persist pref=0 so the resume banner doesn't reappear when mic is blocked
                saveVoiceModePref(false);
            } else if (event.error === 'no-speech' || event.error === 'audio-capture') {
                // no-speech is normal — let onend restart
            } else if (event.error !== 'aborted') {
                setTimeout(() => {
                    if (voiceCommandModeRef.current) {
                        try { recognition.start(); } catch (e) {}
                    }
                }, 500);
            }
        };

        try {
            recognition.start();
            recognitionRef.current = recognition;
        } catch (e) {
            console.error('Could not start recognition:', e);
            alert('Could not start voice recognition. Make sure no other app is using your microphone.');
        }
    }, [parseVoiceCommand, parseVoiceCounter, onVoiceAccessoryCount, changeSection, onVoiceCaptionForLastPhoto, onVoiceNote, stopGuidedMode, onGuidedModeChange, addRecentNote, saveVoiceModePref]);

    // ─── JSX ──────────────────────────────────────────────────────────────────

    const cameraHeightClass = voiceCommandMode
        ? 'h-[50vh] md:h-[42vh]'
        : 'h-[72vh] md:h-[60vh]';

    return (
        <div className="-mx-2 md:mx-0 md:mb-4 md:rounded-lg md:shadow md:border md:bg-card overflow-hidden">
            <div className="p-0 md:p-4 space-y-0 md:space-y-4">

                {/* ── Camera View ──────────────────────────────────────────── */}
                <div className={`relative w-full ${cameraHeightClass} bg-black md:rounded-lg overflow-hidden flex items-center justify-center text-white transition-all duration-300`}>
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-contain"
                        style={{ transition: 'filter 0.15s ease-out', background: '#000' }}
                    />

                    {/* Camera not ready */}
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

                    {/* Upload indicator */}
                    {uploadQueue.length > 0 && (
                        <div className="absolute top-2 left-2 z-10 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                            Uploading {uploadQueue.length} photo{uploadQueue.length > 1 ? 's' : ''}...
                        </div>
                    )}

                    {/* ── Floating "End Hands-Free" button — always visible in voice mode ── */}
                    {voiceCommandMode && isCameraReady && !capturedObjectUrl && (
                        <div className="absolute top-2 left-2 z-20">
                            <button
                                data-testid="button-end-handsfree-float"
                                onClick={stopGuidedMode}
                                className="flex items-center gap-1.5 bg-red-600/90 hover:bg-red-600 active:bg-red-700 backdrop-blur-sm text-white text-xs font-semibold px-3 py-2 rounded-full shadow-lg transition-colors"
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                                <X className="w-3.5 h-3.5" />
                                End Hands-Free
                            </button>
                        </div>
                    )}

                    {/* ── Top-right: overflow menu (both modes — Flip + Measure always accessible) */}
                    {isCameraReady && !capturedObjectUrl && (
                        <div className="absolute top-2 right-2 z-20">
                            <div className="relative" onClick={e => e.stopPropagation()}>
                                <button
                                    data-testid="button-overflow-menu"
                                    onClick={() => setShowOverflowMenu(p => !p)}
                                    className="w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white flex items-center justify-center shadow"
                                >
                                    <MoreVertical className="w-5 h-5" />
                                </button>
                                {showOverflowMenu && (
                                    <div className="absolute right-0 top-12 bg-black/85 backdrop-blur-md rounded-2xl shadow-2xl overflow-hidden z-30 min-w-[180px] border border-white/10">
                                        <button
                                            onClick={() => { switchCamera(); setShowOverflowMenu(false); }}
                                            className="flex items-center gap-3 w-full px-4 py-3 text-white text-sm hover:bg-white/10 active:bg-white/20"
                                        >
                                            <RefreshCw className="w-4 h-4 text-white/60" />
                                            Flip Camera
                                        </button>
                                        <div className="border-t border-white/10" />
                                        <button
                                            data-testid="button-ar-measure"
                                            onClick={() => { setArMeasureActive(true); setShowOverflowMenu(false); }}
                                            className="flex items-center gap-3 w-full px-4 py-3 text-white text-sm hover:bg-white/10 active:bg-white/20"
                                        >
                                            <Ruler className="w-4 h-4 text-white/60" />
                                            AR Measure
                                        </button>
                                        <div className="border-t border-white/10" />
                                        <button
                                            data-testid="button-toggle-haptic"
                                            onClick={async () => {
                                                const next = !hapticEnabled;
                                                setHapticEnabled(next);
                                                try { localStorage.setItem('crewcam_haptic', next ? '1' : '0'); } catch (_) {}
                                                setShowOverflowMenu(false);
                                                if (user?.email) {
                                                    try {
                                                        const devLabel = getDeviceLabel();
                                                        const prefData = {
                                                            user_email: user.email,
                                                            company_id: companyId || null,
                                                            pref_key: 'crewcam_haptic',
                                                            pref_value: next ? '1' : '0',
                                                            device_label: devLabel,
                                                        };
                                                        if (hapticPrefIdRef.current) {
                                                            await localDb.entities.UserPreference.update(hapticPrefIdRef.current, prefData);
                                                        } else {
                                                            const created = await localDb.entities.UserPreference.create(prefData);
                                                            hapticPrefIdRef.current = created?.id || null;
                                                        }
                                                        setSyncedFrom({ device_label: devLabel, timestamp: new Date().toISOString() });
                                                    } catch (_) {}
                                                }
                                            }}
                                            className="flex items-center gap-3 w-full px-4 py-3 text-white text-sm hover:bg-white/10 active:bg-white/20"
                                        >
                                            <span className="text-white/60 text-base leading-none">📳</span>
                                            Haptic {hapticEnabled ? 'On' : 'Off'}
                                        </button>
                                        {syncedFrom && (
                                            <>
                                                <div className="border-t border-white/10" />
                                                <div
                                                    data-testid="text-settings-sync-hint"
                                                    className="px-4 py-2.5 text-xs text-white/40 text-center leading-tight"
                                                >
                                                    Settings synced{syncedFrom.device_label ? ` from ${syncedFrom.device_label}` : ''}{syncedFrom.timestamp ? ` · ${timeAgo(syncedFrom.timestamp)}` : ''}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Resume voice mode banner — shown when saved preference says voice was on */}
                    {voiceModePreferred && isCameraReady && !voiceCommandMode && !capturedObjectUrl && (
                        <div className="absolute top-16 inset-x-0 flex justify-center z-20 px-4">
                            <button
                                data-testid="button-resume-voice-mode"
                                className="flex items-center gap-2 bg-black/70 text-white text-sm font-medium px-4 py-2 rounded-full border border-white/20 active:scale-95 transition-transform"
                                onClick={() => { setVoiceModePreferred(false); startVoiceCommandMode(); }}
                            >
                                <Mic className="w-4 h-4 text-green-400" />
                                Resume voice mode
                                <span
                                    className="ml-1 text-white/50 text-xs"
                                    onClick={(e) => { e.stopPropagation(); setVoiceModePreferred(false); }}
                                >✕</span>
                            </button>
                        </div>
                    )}

                    {/* Normal mode: big shutter button at bottom */}
                    {isCameraReady && !capturedObjectUrl && !voiceCommandMode && (
                        <div className="absolute bottom-4 inset-x-0 flex justify-center">
                            <button
                                data-testid="button-capture-photo"
                                className="w-20 h-20 rounded-full bg-white text-black active:scale-90 transition-transform border-4 border-white/30 shadow-lg flex items-center justify-center disabled:opacity-40"
                                onClick={takePhoto}
                                disabled={!isCameraReady}
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                                <div className="w-16 h-16 rounded-full border-2 border-black/10 flex items-center justify-center">
                                    <Camera className="w-8 h-8 text-black" />
                                </div>
                            </button>
                        </div>
                    )}

                    {/* Last-capture thumbnail — bottom-left, auto-fades */}
                    {lastCaptureSrc && (
                        <div className="absolute bottom-4 left-3 z-10 rounded-lg overflow-hidden border-2 border-white shadow-lg w-14 h-14 animate-in fade-in slide-in-from-bottom-2 duration-200">
                            <img src={lastCaptureSrc} alt="Just captured" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 flex items-end justify-center pb-0.5">
                                <span className="text-[9px] text-white font-semibold bg-black/50 rounded px-1">✓</span>
                            </div>
                        </div>
                    )}

                    {/* Captured photo preview overlay */}
                    {capturedObjectUrl && !showDrawCanvas && (
                        <div className="absolute inset-0 z-20 flex flex-col">
                            <img src={capturedObjectUrl} alt="Captured" className="w-full h-full object-cover" />
                            <div className="absolute inset-x-0 bottom-0 flex justify-center items-center gap-3 pb-4 pt-3 bg-gradient-to-t from-black/70 to-transparent">
                                <Button
                                    data-testid="button-retake"
                                    variant="ghost"
                                    className="text-white flex flex-col items-center gap-1 h-auto py-2"
                                    size="sm"
                                    onClick={clearCaptured}
                                >
                                    <RotateCcw className="w-5 h-5" />
                                    <span className="text-[10px]">Retake</span>
                                </Button>
                                <Button
                                    data-testid="button-upload-captured"
                                    size="sm"
                                    className="bg-white text-black hover:bg-gray-200 px-5 py-2 rounded-full font-semibold flex items-center gap-1.5"
                                    onClick={handleUploadCaptured}
                                >
                                    <Upload className="w-4 h-4" />
                                    Upload
                                </Button>
                                {false && onDrawAndAnalyze && (
                                    <Button
                                        data-testid="button-draw-analyze-capture"
                                        variant="ghost"
                                        className="text-blue-300 flex flex-col items-center gap-1 h-auto py-2"
                                        size="sm"
                                        onClick={() => setShowDrawCanvas(true)}
                                    >
                                        <Pencil className="w-5 h-5" />
                                        <span className="text-[10px]">Draw &amp; Analyze</span>
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
                {/* ── end camera view ─────────────────────────────────────── */}

                {/* ── Inspector Mode Control Panel ─────────────────────────── */}
                {voiceCommandMode && (
                    <div className="bg-gray-950 flex flex-col" style={{ minHeight: '44vh' }}>

                        {/* Section display + arrows */}
                        <div className="px-4 pt-3 pb-2 border-b border-white/5">
                            <div className="flex items-center gap-2 mb-2">
                                <button
                                    data-testid="button-prev-section"
                                    onClick={goToPrevSection}
                                    className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 flex items-center justify-center text-white flex-shrink-0 transition-colors"
                                    style={{ WebkitTapHighlightColor: 'transparent' }}
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>
                                <div className="flex-1 text-center min-w-0">
                                    <p className="text-white/40 text-[10px] uppercase tracking-widest mb-0.5">Current Section</p>
                                    <p className="text-white font-bold text-xl leading-tight truncate">{localActiveSection || 'No section selected'}</p>
                                </div>
                                <button
                                    data-testid="button-next-section"
                                    onClick={goToNextSection}
                                    className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 flex items-center justify-center text-white flex-shrink-0 transition-colors"
                                    style={{ WebkitTapHighlightColor: 'transparent' }}
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Section chips — tap to jump */}
                            {sections && sections.length > 0 && (
                                <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                                    {sections.map(section => (
                                        <button
                                            key={section}
                                            data-testid={`chip-section-${section}`}
                                            onClick={() => changeSection(section)}
                                            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                                localActiveSection === section
                                                    ? 'bg-green-500 text-white shadow-md'
                                                    : 'bg-white/10 text-white/60 hover:bg-white/20 active:bg-white/30'
                                            }`}
                                            style={{ WebkitTapHighlightColor: 'transparent' }}
                                        >
                                            {section}
                                            {sectionPhotoCount?.[section] > 0 && (
                                                <span className={`ml-1 text-[10px] ${localActiveSection === section ? 'text-green-100' : 'text-white/40'}`}>
                                                    {sectionPhotoCount[section]}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Mic ring + PHOTO button + Help */}
                        <div className="flex items-center justify-between px-6 py-3">
                            {/* Pulsing mic ring */}
                            <div className="relative w-16 h-16 flex items-center justify-center">
                                {isListening && (
                                    <div className="absolute inset-0 rounded-full border-[3px] border-green-400 animate-ping opacity-50" />
                                )}
                                <div className={`absolute inset-0 rounded-full border-[3px] transition-colors duration-300 ${isListening ? 'border-green-500' : 'border-gray-700'}`} />
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300 ${isListening ? 'bg-green-500' : 'bg-gray-700'}`}>
                                    <Mic className="w-5 h-5 text-white" />
                                </div>
                            </div>

                            {/* Big PHOTO button */}
                            <button
                                data-testid="button-capture-photo"
                                className="w-20 h-20 rounded-full bg-white active:scale-90 transition-transform border-4 border-white/20 shadow-xl flex items-center justify-center disabled:opacity-40"
                                onClick={takePhoto}
                                disabled={!isCameraReady}
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                                <div className="w-16 h-16 rounded-full border-2 border-black/10 flex items-center justify-center">
                                    <Camera className="w-8 h-8 text-black" />
                                </div>
                            </button>

                            {/* Help / commands toggle */}
                            <button
                                data-testid="button-help-panel"
                                onClick={() => setShowHelpPanel(p => !p)}
                                className={`w-16 h-16 rounded-full flex flex-col items-center justify-center gap-1 transition-colors ${showHelpPanel ? 'bg-white/20 text-white' : 'bg-white/10 text-white/50 hover:bg-white/15 hover:text-white/80'}`}
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                                <span className="text-lg font-bold leading-none">?</span>
                                <span className="text-[9px] uppercase tracking-wide">Help</span>
                            </button>
                        </div>

                        {/* Live transcript */}
                        <div className="px-4 pb-1 min-h-[28px] flex items-center justify-center">
                            {interimTranscript ? (
                                <p className="text-white/60 text-sm text-center italic truncate max-w-full">
                                    🎤 {interimTranscript}
                                </p>
                            ) : lastVoiceCommand ? (
                                <p className="text-white/40 text-xs text-center truncate max-w-full">
                                    "{lastVoiceCommand}"
                                </p>
                            ) : (
                                <p className="text-white/25 text-xs text-center">
                                    Say a section, "photo", or describe damage…
                                </p>
                            )}
                        </div>

                        {/* Recent notes log */}
                        {!showHelpPanel && recentNotes.length > 0 && (
                            <div className="px-4 pb-3 space-y-1.5">
                                <p className="text-white/25 text-[10px] uppercase tracking-widest">Recent Notes</p>
                                {recentNotes.map((note, i) => (
                                    <div key={i} className="flex items-start gap-2 bg-white/5 rounded-xl px-3 py-2">
                                        <span className="text-green-400 text-xs mt-0.5 flex-shrink-0">✓</span>
                                        <p className="text-white/70 text-xs leading-relaxed line-clamp-2">{note}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Help panel */}
                        {showHelpPanel && (
                            <div className="px-4 pb-2">
                                <div className="bg-white/5 rounded-2xl p-4 text-xs space-y-3 border border-white/10">
                                    <div>
                                        <p className="text-green-400 font-semibold mb-1">📷 Take photo</p>
                                        <p className="text-white/50">Say "photo", "take photo", "snap", or "shoot"</p>
                                    </div>
                                    <div>
                                        <p className="text-blue-400 font-semibold mb-1">📍 Switch section</p>
                                        <p className="text-white/50">Say section name: "front elevation", "gutters", "interior", "siding"…</p>
                                    </div>
                                    <div>
                                        <p className="text-yellow-400 font-semibold mb-1">🔢 Count accessories</p>
                                        <p className="text-white/50">"Add three pipe boots", "two vents", "another chimney"</p>
                                    </div>
                                    <div>
                                        <p className="text-red-400 font-semibold mb-1">🛑 Stop hands-free</p>
                                        <p className="text-white/50">Say "stop", "done", "exit", or "end hands free"</p>
                                    </div>
                                    <p className="text-white/25 text-[10px] pt-2 border-t border-white/10">
                                        Anything else is saved as a note automatically. Damage keywords get ⚠ flagged.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* End Hands-Free button — always visible at panel bottom */}
                        <div className="px-4 pb-3 pt-1 mt-auto">
                            <button
                                data-testid="button-end-handsfree"
                                onClick={stopGuidedMode}
                                className="w-full flex items-center justify-center gap-2 border border-red-500/50 text-red-400 hover:bg-red-500/10 active:bg-red-500/20 font-semibold py-3 rounded-2xl text-sm transition-colors"
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                                <X className="w-4 h-4" />
                                End Hands-Free
                            </button>
                        </div>
                    </div>
                )}
                {/* ── end inspector panel ──────────────────────────────────── */}

                {/* ── Normal mode: Start Hands-Free button ─────────────────── */}
                {!voiceCommandMode && (
                    <div className="bg-gray-950 px-4 py-3">
                        <button
                            data-testid="button-start-handsfree"
                            onClick={startVoiceCommandMode}
                            className="w-full flex items-center justify-center gap-3 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold py-4 rounded-2xl text-base transition-colors shadow-lg"
                            style={{ WebkitTapHighlightColor: 'transparent' }}
                        >
                            <Mic className="w-6 h-6" />
                            Start Hands-Free Inspection
                        </button>
                    </div>
                )}

                <div className="px-2 pb-2 md:px-0 md:pb-0">
                    <canvas ref={canvasRef} className="hidden" />
                </div>
            </div>

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

            {showDrawCanvas && capturedObjectUrl && (
                <PhotoDrawingCanvas
                    photoUrl={capturedObjectUrl}
                    isAnalyzing={isDrawAnalyzing}
                    onAnalyze={handleDrawAndAnalyzeFromCapture}
                    onClose={() => { if (!isDrawAnalyzing) setShowDrawCanvas(false); }}
                />
            )}
        </div>
    );
};

export default LiveCameraCapture;
