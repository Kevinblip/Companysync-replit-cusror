import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Camera, CheckCircle, AlertCircle, Upload, X, Image } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

const MAX_SIZE_MB = 20;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const UPLOAD_TARGET_BYTES = 400 * 1024; // ~400 KB — faster on mobile cell data
// Keep uploads sequential on mobile. Multiple image requests at once can exhaust
// Android Chrome's memory/network queue and make every fetch reject.
const UPLOAD_CONCURRENCY = 1;
const UPLOAD_TIMEOUT_MS = 45_000;
const UPLOAD_RETRIES = 3;
const makeUploadId = () => (
  globalThis.crypto?.randomUUID?.()
  || `crew_${Date.now()}_${Math.random().toString(36).slice(2)}`
);

async function compressImage(file, maxDimension = 2048, quality = 0.82) {
  return new Promise((resolve) => {
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Iteratively compress until file is under UPLOAD_TARGET_BYTES (fast on mobile)
async function compressToTarget(file) {
  const steps = [
    [1600, 0.80],
    [1200, 0.72],
    [900, 0.65],
    [700, 0.58],
  ];
  let result = file;
  for (const [dim, q] of steps) {
    if (result.size <= UPLOAD_TARGET_BYTES) break;
    result = await compressImage(file, dim, q);
  }
  return result;
}

async function uploadCrewPhoto({ token, customerId, file, uploadId, index }) {
  let lastError = null;
  for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
    const body = new FormData();
    body.append("portal_token", token);
    body.append("customer_id", customerId || "");
    body.append("upload_id", uploadId);
    body.append("photo", file, file.name || `crew-photo-${index + 1}.jpg`);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const resp = await fetch("/api/public/crew-photos", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (resp.ok || ![408, 425, 429, 500, 502, 503, 504].includes(resp.status) || attempt === UPLOAD_RETRIES) {
        return resp;
      }
      lastError = new Error(`Server error (${resp.status})`);
    } catch (err) {
      lastError = err;
      if (attempt === UPLOAD_RETRIES) throw err;
    } finally {
      window.clearTimeout(timeout);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 700 * attempt));
  }
  throw lastError || new Error("Upload failed");
}

export default function CrewPhotoUpload() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const cid = searchParams.get("cid");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [done, setDone] = useState(false);

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, failed: 0 });
  const [lastError, setLastError] = useState(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!token) { setError("Invalid upload link — token missing."); setLoading(false); return; }
    fetch(`/api/public/portal?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.customer) {
          if (cid && data.customer.id !== cid) { setError("Invalid upload link."); }
          else setCustomer(data.customer);
        } else {
          setError("Invalid or expired upload link.");
        }
      })
      .catch(() => setError("Failed to load. Check your connection and try again."))
      .finally(() => setLoading(false));
  }, [token, cid]);

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const valid = files.filter((f) => {
      if (!f.type.startsWith("image/") && !f.name.match(/\.(heic|heif)$/i)) {
        toast.error(`${f.name} is not a valid image file`);
        return false;
      }
      return true;
    });
    // Do not point every thumbnail at the original camera file. Android Chrome
    // decodes those full-resolution images even when they are displayed tiny,
    // which can kill the tab before a large batch finishes uploading.
    const newPreviews = [];
    for (const f of valid) {
      let previewFile = f;
      try { previewFile = await compressImage(f, 320, 0.62); } catch (_) {}
      newPreviews.push({
        file: f,
        uploadId: makeUploadId(),
        url: URL.createObjectURL(previewFile),
        status: "pending",
      });
    }
    setSelectedFiles((prev) => [...prev, ...valid]);
    setPreviews((prev) => [...prev, ...newPreviews]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index) => {
    URL.revokeObjectURL(previews[index]?.url);
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (!selectedFiles.length || uploading) return;
    setUploading(true);
    setLastError(null);
    const total = selectedFiles.length;
    setUploadProgress({ current: 0, total, failed: 0 });

    // Mutable counters shared across concurrent workers (safe: JS is single-threaded)
    let finishedCount = 0;
    let failedCount = 0;
    let firstErrMsg = null;

    // Index queue — each worker pulls the next index until empty
    const queue = Array.from({ length: total }, (_, i) => i);

    const processOne = async (i) => {
      try {
        let file = selectedFiles[i];
        // Mark as compressing so the user sees activity immediately
        setPreviews((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "compressing" } : p));
        if (file.size > MAX_SIZE_BYTES) file = await compressImage(file, 2048, 0.78);
        if (file.size > MAX_SIZE_BYTES) {
          const msg = `${selectedFiles[i].name} is too large even after compression — skipped`;
          toast.error(msg);
          if (!firstErrMsg) firstErrMsg = msg;
          failedCount++;
          setPreviews((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "failed" } : p));
          finishedCount++;
          setUploadProgress({ current: finishedCount, total, failed: failedCount });
          return;
        }
        const compressedFile = await compressToTarget(file);
        setPreviews((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "uploading" } : p));
        const resp = await uploadCrewPhoto({
          token,
          customerId: cid || customer?.id || "",
          file: compressedFile,
          uploadId: previews[i]?.uploadId || makeUploadId(),
          index: i,
        });
        if (!resp.ok) {
          let errMsg = `Server error (${resp.status})`;
          try { const d = await resp.json(); errMsg = d.error || errMsg; } catch (_) {}
          failedCount++;
          if (!firstErrMsg) firstErrMsg = errMsg;
          setPreviews((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "failed" } : p));
          if (failedCount <= 3) toast.error(`Photo ${i + 1}: ${errMsg}`);
        } else {
          const data = await resp.json();
          if (data.success) {
            setPreviews((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "done" } : p));
          } else {
            const errMsg = data.error || `Failed to upload photo ${i + 1}`;
            failedCount++;
            if (!firstErrMsg) firstErrMsg = errMsg;
            setPreviews((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "failed" } : p));
            if (failedCount <= 3) toast.error(errMsg);
          }
        }
      } catch (err) {
        failedCount++;
        if (!firstErrMsg) firstErrMsg = err.message || "Connection error";
        setPreviews((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "failed" } : p));
        if (failedCount <= 3) toast.error(`Photo ${i + 1} failed — check your connection`);
      }
      finishedCount++;
      setUploadProgress({ current: finishedCount, total, failed: failedCount });
    };

    // Run UPLOAD_CONCURRENCY workers in parallel, each draining the shared queue
    const worker = async () => {
      while (queue.length > 0) {
        const idx = queue.shift();
        if (idx !== undefined) await processOne(idx);
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, () => worker()));

    setUploading(false);
    if (failedCount === 0) {
      setDone(true);
    } else {
      setLastError({ failed: failedCount, total, message: firstErrMsg });
      if (failedCount < total) toast.error(`${failedCount} of ${total} photos failed.`);
    }
  };

  const retryFailed = () => {
    const failedIndexes = previews.map((p, i) => p.status === "failed" ? i : -1).filter(i => i !== -1);
    const newFiles = failedIndexes.map(i => selectedFiles[i]);
    const newPreviews = failedIndexes.map(i => ({
      file: selectedFiles[i],
      uploadId: previews[i].uploadId || crypto.randomUUID(),
      url: previews[i].url,
      status: "pending",
    }));
    setSelectedFiles(newFiles);
    setPreviews(newPreviews);
    setLastError(null);
    setUploadProgress({ current: 0, total: 0, failed: 0 });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-blue-900">
        <Toaster richColors position="top-center" />
        <div className="text-center text-white">
          <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin" />
          <p className="text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-blue-900 p-4">
        <Toaster richColors position="top-center" />
        <Card className="w-full max-w-sm">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Invalid Link</h2>
            <p className="text-gray-600 text-sm">{error}</p>
            <p className="text-gray-400 text-xs mt-3">Please ask your crew manager for a new link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-blue-900 p-4">
        <Toaster richColors position="top-center" />
        <Card className="w-full max-w-sm">
          <CardContent className="p-8 text-center">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Photos Sent!</h2>
            <p className="text-gray-600 text-sm">
              {uploadProgress.current} photo{uploadProgress.current !== 1 ? "s" : ""} uploaded successfully.
              Your team will be notified.
            </p>
            <Button
              className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => {
                setSelectedFiles([]);
                setPreviews([]);
                setDone(false);
                setUploadProgress({ current: 0, total: 0, failed: 0 });
              }}
            >
              <Camera className="w-4 h-4 mr-2" />
              Upload More Photos
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pct = uploadProgress.total > 0 ? Math.round((uploadProgress.current / uploadProgress.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-blue-900 p-4">
      <Toaster richColors position="top-center" />

      <div className="max-w-md mx-auto pt-8 pb-16">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center mx-auto mb-3">
            <Camera className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Upload Job Photos</h1>
          <p className="text-blue-200 text-sm mt-1">
            {customer?.name}
            {customer?.street && <span className="block text-blue-300 text-xs mt-0.5">{customer.street}{customer.city ? `, ${customer.city}` : ""}</span>}
          </p>
        </div>

        <Card className="shadow-xl">
          <CardContent className="p-5 space-y-4">
            {selectedFiles.length === 0 ? (
              <label
                htmlFor="crew-photo-input"
                data-testid="button-add-photos"
                className="w-full border-2 border-dashed border-blue-300 rounded-xl p-10 flex flex-col items-center gap-3 text-blue-600 hover:bg-blue-50 active:bg-blue-100 transition-colors cursor-pointer"
              >
                <Image className="w-12 h-12 text-blue-400" />
                <span className="text-lg font-semibold">Tap to Add Photos</span>
                <span className="text-sm text-gray-400">Select from gallery or take a new photo</span>
              </label>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {previews.map((p, i) => (
                    <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                      <img src={p.url} alt="" className="w-full h-full object-cover" />
                      {p.status === "done" && (
                        <div className="absolute inset-0 bg-green-500/60 flex items-center justify-center">
                          <CheckCircle className="w-8 h-8 text-white" />
                        </div>
                      )}
                      {p.status === "failed" && (
                        <div className="absolute inset-0 bg-red-500/60 flex items-center justify-center">
                          <AlertCircle className="w-8 h-8 text-white" />
                        </div>
                      )}
                      {p.status === "compressing" && (
                        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1">
                          <Loader2 className="w-6 h-6 text-white animate-spin" />
                          <span className="text-white text-xs font-medium">Compressing</span>
                        </div>
                      )}
                      {p.status === "uploading" && (
                        <div className="absolute inset-0 bg-blue-600/55 flex flex-col items-center justify-center gap-1">
                          <Loader2 className="w-6 h-6 text-white animate-spin" />
                          <span className="text-white text-xs font-medium">Uploading</span>
                        </div>
                      )}
                      {p.status === "pending" && !uploading && (
                        <button
                          onClick={() => removeFile(i)}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center"
                        >
                          <X className="w-3.5 h-3.5 text-white" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {!uploading && (
                  <label
                    htmlFor="crew-photo-input"
                    data-testid="button-add-more-photos"
                    className="w-full border border-dashed border-blue-300 rounded-lg py-3 text-sm text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    Add More Photos
                  </label>
                )}

                {uploading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Uploading {uploadProgress.current} of {uploadProgress.total}...</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            <input
              id="crew-photo-input"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-file-photos"
            />

            {selectedFiles.length > 0 && !uploading && (
              <div className="flex items-center gap-2 pt-1">
                <Badge variant="secondary" className="text-xs">
                  {selectedFiles.length} photo{selectedFiles.length !== 1 ? "s" : ""} selected
                </Badge>
              </div>
            )}

            {lastError && !uploading && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-red-700">
                      {lastError.failed === lastError.total
                        ? `All ${lastError.total} photos failed`
                        : `${lastError.failed} of ${lastError.total} photos failed`}
                    </p>
                    {lastError.message && (
                      <p className="text-xs text-red-600 mt-0.5 break-words">{lastError.message}</p>
                    )}
                  </div>
                </div>
                {lastError.failed > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-red-300 text-red-700 hover:bg-red-100 text-xs h-8"
                    onClick={retryFailed}
                  >
                    Retry {lastError.failed} Failed Photo{lastError.failed !== 1 ? "s" : ""}
                  </Button>
                )}
              </div>
            )}

            <Button
              data-testid="button-upload-photos"
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || uploading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white h-12 text-base font-semibold"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5 mr-2" />
                  Send {selectedFiles.length > 0 ? `${selectedFiles.length} ` : ""}Photo{selectedFiles.length !== 1 ? "s" : ""}
                </>
              )}
            </Button>

            <p className="text-xs text-gray-400 text-center">
              Photos go directly to the job profile. No account needed.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
