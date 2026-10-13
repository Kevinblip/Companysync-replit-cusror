import { createContext, useContext, useRef, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { queryClientInstance } from '@/lib/query-client';
import { annotateImage } from '@/components/inspections/ImageAnnotation';
import { X, Pause, Play, Upload, CheckCircle, AlertCircle } from 'lucide-react';

const UploadQueueContext = createContext(null);

export function useUploadQueue() {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) throw new Error('useUploadQueue must be used inside UploadQueueProvider');
  return ctx;
}

export function UploadQueueProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const [status, setStatus] = useState('idle'); // 'idle' | 'uploading' | 'paused' | 'stopped'
  const [progress, setProgress] = useState({ current: 0, total: 0, currentFileName: '', errors: 0 });
  const [recentlyFinished, setRecentlyFinished] = useState(false);

  const pausedRef = useRef(false);
  const stoppedRef = useRef(false);
  const processingRef = useRef(false);

  // Maximum number of photos processed concurrently.
  // 4 slots keeps Gemini API happy while cutting a 10-photo batch from ~90s → ~15s.
  const MAX_CONCURRENT = 4;

  const processQueue = useCallback(async (currentQueue) => {
    if (processingRef.current) return;
    processingRef.current = true;
    pausedRef.current = false;
    stoppedRef.current = false;

    const total = currentQueue.length;
    let completedCount = 0;
    let errorCount = 0;

    setStatus('uploading');
    setProgress({ current: 0, total, currentFileName: '', errors: 0 });

    // --- Semaphore ---
    // Limits how many items run concurrently without blocking the event loop.
    let activeSlots = 0;
    const slotWaiters = [];

    const acquireSlot = () => new Promise(resolve => {
      if (activeSlots < MAX_CONCURRENT) { activeSlots++; resolve(); }
      else slotWaiters.push(resolve);
    });

    const releaseSlot = () => {
      const next = slotWaiters.shift();
      if (next) { next(); } // hand slot directly to next waiter
      else { activeSlots--; }
    };

    // --- Per-item pipeline ---
    const processItem = async (item) => {
      // Honour pause before we touch anything (outside the slot so we don't hold it while waiting)
      while (pausedRef.current && !stoppedRef.current) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (stoppedRef.current) return;

      await acquireSlot();

      // Re-check stop after acquiring the slot (may have been set while waiting)
      if (stoppedRef.current) { releaseSlot(); return; }

      try {
        let file = item.file;

        // HEIC → JPEG conversion
        const ext = file.name?.toLowerCase().split('.').pop() ?? '';
        const isHeic = ext === 'heic' || ext === 'heif' || file.type === 'image/heic' || file.type === 'image/heif';
        if (isHeic) {
          try {
            // The large HEIC decoder is only needed for an actual HEIC upload,
            // not every sign-in, dashboard visit, or JPEG photo upload.
            const { default: heic2any } = await import('heic2any');
            const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
            const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
            const baseName = file.name.replace(/\.(heic|heif)$/i, '');
            file = new File([jpegBlob], `${baseName}.jpg`, { type: 'image/jpeg' });
          } catch {
            console.warn('[UploadQueue] HEIC conversion failed, using original');
          }
        }

        const { file_url } = await base44.integrations.Core.UploadFile({ file });

        let file_type = 'photo';
        if (file.type?.startsWith('video')) {
          file_type = 'video';
        } else if (file.name) {
          const e2 = file.name.toLowerCase().split('.').pop();
          if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(e2)) file_type = 'video';
        }

        const media = await base44.entities.JobMedia.create({
          related_entity_id: item.jobId,
          related_entity_type: 'InspectionJob',
          file_url,
          file_type,
          section: item.section,
          caption: file.name || 'Uploaded photo',
          uploaded_by_name: item.uploaderName || 'User',
          company_id: item.companyId,
        });

        // Show the photo in the gallery immediately, before AI is done
        queryClientInstance.invalidateQueries({ queryKey: ['inspectionMedia', item.jobId] });

        if (file_type === 'photo' && !item.skipAI) {
          try {
            const stormCtx = item.stormContext?.trim();
            const invokeParams = {
              photoUrl: file_url,
              section: item.section,
              ...(item.photoType ? { photoType: item.photoType } : {}),
              jobId: item.jobId,
              ...(stormCtx ? { inspectorNotes: stormCtx } : {}),
            };

            // Retry up to 3 attempts with exponential backoff for Gemini rate-limit errors.
            // A 429 / "quota" / "rate" signal in either a thrown error or the response body
            // indicates transient overload — backing off 2s, then 4s usually succeeds.
            let analysisResult;
            const MAX_AI_ATTEMPTS = 3;
            for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
              try {
                analysisResult = await base44.functions.invoke('analyzeCrewCamPhoto', invokeParams);

                // Server returned a rate-limit or quota error in the response body
                const serverErr = analysisResult?.data?.error || analysisResult?.data?.message || '';
                const isRateErr = /429|rate.?limit|quota/i.test(serverErr);
                if (isRateErr && attempt < MAX_AI_ATTEMPTS) {
                  const delay = attempt * 2000;
                  console.warn(`[UploadQueue] Gemini rate limit hit, retrying in ${delay}ms (attempt ${attempt}/${MAX_AI_ATTEMPTS})`);
                  await new Promise(r => setTimeout(r, delay));
                  continue;
                }
                break; // success or non-retryable error — exit loop
              } catch (invokeErr) {
                const isRateErr = /429|rate.?limit|quota/i.test(invokeErr?.message ?? '');
                if (isRateErr && attempt < MAX_AI_ATTEMPTS) {
                  const delay = attempt * 2000;
                  console.warn(`[UploadQueue] Gemini rate limit (thrown), retrying in ${delay}ms (attempt ${attempt}/${MAX_AI_ATTEMPTS})`);
                  await new Promise(r => setTimeout(r, delay));
                } else {
                  throw invokeErr; // non-rate-limit or final attempt — propagate
                }
              }
            }

            if (analysisResult?.data?.success) {
              const analysisData = analysisResult.data.analysis;
              let annotatedUrl = null;
              if (analysisData.detections?.length > 0) {
                try {
                  const annotatedBlob = await annotateImage(file_url, analysisData.detections, analysisData.possible_detections);
                  const annotatedFile = new File([annotatedBlob], `annotated_${Date.now()}.jpg`, { type: 'image/jpeg' });
                  const uploadRes = await base44.integrations.Core.UploadFile({ file: annotatedFile });
                  annotatedUrl = uploadRes.file_url;
                } catch {
                  console.warn('[UploadQueue] Annotation failed (non-critical)');
                }
              }
              await base44.entities.JobMedia.update(media.id, {
                ai_damage_analysis: analysisData,
                ...(analysisData.photo_type ? { photo_type: analysisData.photo_type } : {}),
                ...(annotatedUrl ? { annotated_url: annotatedUrl } : {}),
              });
              // Refresh again so AI badges appear on the card as each photo finishes
              queryClientInstance.invalidateQueries({ queryKey: ['inspectionMedia', item.jobId] });
            }
          } catch (aiErr) {
            console.warn('[UploadQueue] AI analysis failed (non-critical):', aiErr.message);
          }
        }

        completedCount++;
        setProgress(p => ({ ...p, current: p.current + 1, currentFileName: file.name }));
      } catch (err) {
        console.error('[UploadQueue] Upload failed for', item.file.name, err.message);
        errorCount++;
        setProgress(p => ({ ...p, current: p.current + 1, errors: p.errors + 1 }));
      } finally {
        releaseSlot();
      }
    };

    // Kick off all items; the semaphore throttles actual concurrency
    await Promise.allSettled(currentQueue.map(item => processItem(item)));

    processingRef.current = false;
    setQueue([]);

    if (stoppedRef.current) {
      setStatus('idle');
      setProgress({ current: 0, total: 0, currentFileName: '', errors: 0 });
    } else {
      setStatus('idle');
      setRecentlyFinished(true);
      setProgress({ current: completedCount, total: completedCount, currentFileName: '', errors: errorCount });
      setTimeout(() => {
        setRecentlyFinished(false);
        setProgress({ current: 0, total: 0, currentFileName: '', errors: 0 });
      }, 4000);
    }
  }, []);

  const enqueueFiles = useCallback(({ files, items: itemsArg, jobId, section, uploaderName, companyId, skipAI }) => {
    let items;
    if (itemsArg) {
      items = itemsArg;
    } else {
      items = Array.from(files).map(file => ({ file, jobId, section, uploaderName, companyId, skipAI }));
    }
    setQueue(items);
    processQueue(items);
  }, [processQueue]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setStatus('uploading');
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    pausedRef.current = false;
    setStatus('idle');
    setQueue([]);
  }, []);

  const isActive = status !== 'idle' || recentlyFinished;

  return (
    <UploadQueueContext.Provider value={{ enqueueFiles, pause, resume, stop, status, progress, isActive }}>
      {children}
      <UploadProgressWidget
        status={status}
        progress={progress}
        recentlyFinished={recentlyFinished}
        onPause={pause}
        onResume={resume}
        onStop={stop}
      />
    </UploadQueueContext.Provider>
  );
}

function UploadProgressWidget({ status, progress, recentlyFinished, onPause, onResume, onStop }) {
  const visible = status !== 'idle' || recentlyFinished;
  if (!visible) return null;

  const isDone = recentlyFinished && status === 'idle';
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] w-80 rounded-xl shadow-2xl border overflow-hidden"
      style={{ background: '#1e293b', borderColor: '#334155' }}
    >
      <div className="px-4 py-3 flex items-center justify-between" style={{ background: '#0f172a' }}>
        <div className="flex items-center gap-2">
          {isDone ? (
            progress.errors > 0
              ? <AlertCircle className="w-4 h-4 text-yellow-400" />
              : <CheckCircle className="w-4 h-4 text-green-400" />
          ) : (
            <Upload className="w-4 h-4 text-blue-400 animate-pulse" />
          )}
          <span className="text-sm font-semibold text-white">
            {isDone
              ? (progress.errors > 0 ? `Done — ${progress.errors} failed` : 'Upload complete!')
              : status === 'paused'
              ? 'Uploads paused'
              : `Uploading… ${progress.current} of ${progress.total}`}
          </span>
        </div>
        {isDone && (
          <button onClick={onStop} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {!isDone && (
        <>
          <div className="px-4 pt-3 pb-1">
            <div className="w-full bg-slate-700 rounded-full h-1.5">
              <div
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  background: status === 'paused' ? '#f59e0b' : '#3b82f6',
                }}
              />
            </div>
          </div>

          {progress.currentFileName && (
            <p className="px-4 py-1 text-xs text-slate-400 truncate">
              {status === 'paused' ? 'Paused on: ' : ''}{progress.currentFileName}
            </p>
          )}

          <div className="px-4 py-2 flex items-center gap-2 justify-end">
            {status === 'paused' ? (
              <button
                onClick={onResume}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                <Play className="w-3 h-3" /> Resume
              </button>
            ) : (
              <button
                onClick={onPause}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-600 hover:bg-slate-500 text-white transition-colors"
              >
                <Pause className="w-3 h-3" /> Pause
              </button>
            )}
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-900 hover:bg-red-800 text-red-200 transition-colors"
            >
              <X className="w-3 h-3" /> Stop
            </button>
          </div>
        </>
      )}
    </div>
  );
}
