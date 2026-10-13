import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileImage,
  ImagePlus,
  Info,
  Loader2,
  Ruler,
  Upload,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const MAX_PHOTOS = 12;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function normalizeError(response, fallback) {
  return response.json()
    .catch(() => ({}))
    .then((body) => new Error(body.error || fallback));
}

export default function PhotoMeasurementUploader({ invoiceId, jobId, companyId, onComplete }) {
  const inputRef = useRef(null);
  const filesRef = useRef([]);
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [latestMeasurement, setLatestMeasurement] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const loadHistory = useCallback(async () => {
    if (!invoiceId && !jobId) {
      setIsLoadingHistory(false);
      return;
    }
    try {
      const params = new URLSearchParams();
      if (invoiceId) params.set('invoice_id', invoiceId);
      if (jobId) params.set('job_id', jobId);
      if (companyId) params.set('company_id', companyId);
      const response = await fetch(`/api/measurements?${params.toString()}`);
      if (!response.ok) throw await normalizeError(response, 'Could not load previous measurements.');
      const body = await response.json();
      setLatestMeasurement(body.measurements?.[0] || null);
    } catch (loadError) {
      // History is helpful but should not prevent a new analysis.
      console.warn('[PhotoMeasurementUploader] history load failed:', loadError.message);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [companyId, invoiceId, jobId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => () => {
    filesRef.current.forEach((item) => URL.revokeObjectURL(item.preview));
  }, []);

  const addFiles = useCallback((incoming) => {
    setError('');
    const selected = Array.from(incoming || []);
    const imageFiles = selected.filter((file) => ACCEPTED_TYPES.has(file.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name));
    const accepted = imageFiles.filter((file) => file.size <= MAX_FILE_BYTES);
    if (imageFiles.length !== selected.length) setError('Only JPG, PNG, WebP, GIF, and HEIC images can be analyzed.');
    else if (accepted.length !== imageFiles.length) setError('Each photo must be 12 MB or smaller.');
    setFiles((current) => {
      const slots = MAX_PHOTOS - current.length;
      if (accepted.length > slots) setError(`You can add up to ${MAX_PHOTOS} photos per analysis.`);
      return [
        ...current,
        ...accepted.slice(0, slots).map((file) => ({
          id: `${file.name}-${file.lastModified}-${Math.random()}`,
          file,
          preview: URL.createObjectURL(file),
        })),
      ];
    });
  }, []);

  const removeFile = (id) => {
    setFiles((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return current.filter((entry) => entry.id !== id);
    });
  };

  const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const response = await fetch('/api/integrations/upload', { method: 'POST', body: formData });
    if (!response.ok) throw await normalizeError(response, `Could not upload ${file.name}.`);
    const body = await response.json();
    if (!body.file_url) throw new Error(`Could not upload ${file.name}.`);
    return body.file_url;
  };

  const analyze = async () => {
    if (files.length < 2) {
      setError('Add at least two exterior photos from different angles.');
      return;
    }
    setError('');
    setIsAnalyzing(true);
    try {
      const photoUrls = await Promise.all(files.map((item) => uploadFile(item.file)));
      const response = await fetch('/api/measurements/analyze-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId || undefined,
          invoice_id: invoiceId || undefined,
          job_id: jobId || undefined,
          photo_urls: photoUrls,
        }),
      });
      if (!response.ok) throw await normalizeError(response, 'Photo measurement failed.');
      const body = await response.json();
      setLatestMeasurement(body.measurement);
      files.forEach((item) => URL.revokeObjectURL(item.preview));
      setFiles([]);
      onComplete?.(body.measurement);
    } catch (analysisError) {
      setError(analysisError.message || 'Photo measurement failed. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analysis = latestMeasurement?.raw_analysis || latestMeasurement;
  const measurements = analysis?.measurements || latestMeasurement || {};
  const breakdown = analysis?.breakdown || {};
  const isCompleted = latestMeasurement?.status === 'completed' || !!latestMeasurement?.measurements;

  return (
    <div className="space-y-5">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Ruler className="h-5 w-5 text-blue-600" />
            Photo-based measurements
          </CardTitle>
          <p className="text-sm text-slate-500">
            Upload clear exterior views to create a planning measurement. This does not change the invoice or create an estimate.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              addFiles(event.dataTransfer.files);
            }}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
              multiple
              className="hidden"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <Upload className="mx-auto mb-2 h-8 w-8 text-slate-400" />
            <p className="font-medium text-slate-700">Drop exterior photos here</p>
            <p className="mt-1 text-xs text-slate-500">or click to choose 2–{MAX_PHOTOS} photos from different angles</p>
          </div>

          {files.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {files.map((item) => (
                <div key={item.id} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                  <img src={item.preview} alt={item.file.name} className="h-28 w-full object-cover" />
                  <button
                    type="button"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removeFile(item.id)}
                    className="absolute right-1 top-1 rounded-full bg-slate-900/75 p-1 text-white opacity-90 hover:bg-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <p className="truncate px-2 py-1.5 text-[11px] text-slate-600">{item.file.name}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Info className="h-4 w-4" />
              Use daylight photos that show complete walls, roof edges, windows, and doors.
            </div>
            <Button type="button" onClick={analyze} disabled={isAnalyzing || files.length < 2}>
              {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
              {isAnalyzing ? 'Analyzing photos…' : 'Analyze photos'}
            </Button>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {!isLoadingHistory && isCompleted && (
        <Card className="border-blue-100 bg-blue-50/40 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Latest measurement summary
              </CardTitle>
              <Badge variant="secondary">
                {formatNumber(analysis?.confidence ?? latestMeasurement?.confidence, 0)}% confidence
              </Badge>
            </div>
            {latestMeasurement?.created_at && (
              <p className="text-xs text-slate-500">
                Analyzed {new Date(latestMeasurement.created_at).toLocaleString()}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ['Siding', measurements.siding_sq, 'sq'],
                ['Trim', measurements.trim_linear_ft, 'linear ft'],
                ['Roof pitch', measurements.roof_pitch, ''],
                ['Windows', measurements.window_count, ''],
                ['Doors', measurements.door_count, ''],
              ].map(([label, value, unit]) => (
                <div key={label} className="rounded-lg border border-blue-100 bg-white p-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {typeof value === 'number' ? formatNumber(value) : (value || '—')}
                  </p>
                  {unit && <p className="text-[11px] text-slate-500">{unit}</p>}
                </div>
              ))}
            </div>
            {(breakdown.siding_area_sq_ft_net !== null || breakdown.assumptions?.length > 0 || analysis?.notes) && (
              <div className="space-y-2 text-sm text-slate-600">
                {breakdown.siding_area_sq_ft_net !== null && breakdown.siding_area_sq_ft_net !== undefined && (
                  <p>Estimated net siding area: <strong>{formatNumber(breakdown.siding_area_sq_ft_net)} sq ft</strong></p>
                )}
                {analysis?.notes && <p>{analysis.notes}</p>}
                {breakdown.assumptions?.length > 0 && (
                  <p className="text-xs text-slate-500">Assumptions: {breakdown.assumptions.join(' ')}</p>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <FileImage className="h-4 w-4" />
              Photo-based values are planning estimates. Confirm dimensions in the field before ordering materials.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}