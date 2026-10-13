import React, { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { compressWorkPhoto, WORK_PHOTO_LIMIT as PHOTO_LIMIT } from "@/utils/subcontractorWorkPhotos";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ImagePlus, Loader2, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

function photoFields(record) {
  const data = record?.data || {};
  return {
    id: record?.id,
    file_url: record?.file_url ?? data.file_url,
    file_name: record?.file_name ?? data.file_name ?? "Work photo",
    size_bytes: record?.size_bytes ?? data.size_bytes,
    uploaded_at: record?.uploaded_at ?? data.uploaded_at,
  };
}

export default function SubcontractorWorkPhotosDialog({ open, onOpenChange, subcontractor, companyId }) {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const operationLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [selectedPhotoId, setSelectedPhotoId] = useState(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);

  const queryKey = ["subcontractor-work-photos", companyId, subcontractor?.id];
  const { data: records = [], isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => base44.entities.SubcontractorWorkPhoto.filter({
      company_id: companyId,
      subcontractor_id: subcontractor.id,
    }),
    enabled: Boolean(open && companyId && subcontractor?.id),
  });

  const photos = useMemo(() => records.map(photoFields).filter((photo) => photo.id && photo.file_url), [records]);
  const photoCount = records.length;
  const selectedPhoto = photos.find((photo) => photo.id === selectedPhotoId) || photos[0];
  const canUpload = Boolean(companyId && subcontractor?.id && !isLoading && !isError && photoCount < PHOTO_LIMIT && !busy);

  const setOpen = (nextOpen) => {
    if (!nextOpen && (busy || operationLock.current)) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setSelectedPhotoId(null);
      setConfirmRemoveId(null);
    }
  };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || operationLock.current) return;
    if (!companyId || !subcontractor?.id) {
      toast.error("Choose a company and subcontractor before uploading photos.");
      return;
    }
    if (isLoading || isError) {
      toast.error(isError ? "The photo count could not be checked. Retry before uploading." : "Please wait while the photo count loads.");
      return;
    }
    if (photoCount >= PHOTO_LIMIT) {
      toast.error(`This portfolio already has the maximum of ${PHOTO_LIMIT} photos.`);
      return;
    }

    const unsupported = files.filter((file) => !ACCEPTED_TYPES.has(file.type));
    if (unsupported.length) {
      toast.error("Unsupported photo format. Choose JPEG, PNG, WebP, or AVIF; HEIC is not supported.");
    }
    const validFiles = files.filter((file) => ACCEPTED_TYPES.has(file.type));
    if (!validFiles.length) return;
    const availableSlots = PHOTO_LIMIT - photoCount;
    if (validFiles.length > availableSlots) {
      toast.error(`Only ${availableSlots} photo${availableSlots === 1 ? "" : "s"} can be added; the portfolio limit is ${PHOTO_LIMIT}.`);
      return;
    }

    operationLock.current = true;
    setBusy(true);
    let saved = 0;
    try {
      for (const file of validFiles) {
        const compressed = await compressWorkPhoto(file);
        const uploadResult = await base44.integrations.Core.UploadFile({ file: compressed });
        const fileUrl = uploadResult?.file_url;
        if (typeof fileUrl !== "string" || !fileUrl.trim()) {
          throw new Error(`The upload service did not return a photo URL for ${file.name}.`);
        }
        await base44.entities.SubcontractorWorkPhoto.create({
          company_id: companyId,
          subcontractor_id: subcontractor.id,
          file_url: fileUrl,
          file_name: file.name,
          size_bytes: compressed.size,
          uploaded_at: new Date().toISOString(),
        });
        saved += 1;
        await queryClient.invalidateQueries({ queryKey: ["subcontractor-work-photos", companyId] });
      }
      if (saved) toast.success(`${saved} work photo${saved === 1 ? "" : "s"} added.`);
    } catch (uploadError) {
      const detail = uploadError?.message || "An unexpected error occurred.";
      toast.error(saved
        ? `${saved} photo${saved === 1 ? "" : "s"} saved; upload stopped before all selected photos were added. ${detail}`
        : `Work photos were not saved. ${detail}`);
    } finally {
      operationLock.current = false;
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removePhoto = async (photo) => {
    if (busy || operationLock.current || !photo?.id) return;
    operationLock.current = true;
    setBusy(true);
    try {
      await base44.entities.SubcontractorWorkPhoto.delete(photo.id);
      await queryClient.invalidateQueries({ queryKey: ["subcontractor-work-photos", companyId] });
      setConfirmRemoveId(null);
      setSelectedPhotoId(null);
      toast.success("Photo removed from this subcontractor’s portfolio.");
    } catch (removeError) {
      toast.error(`Could not remove this work photo. ${removeError?.message || "Please try again."}`);
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={`max-h-[92dvh] overflow-y-auto sm:max-w-2xl ${busy ? "[&>button]:pointer-events-none [&>button]:opacity-40" : ""}`}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>Work photos · {subcontractor?.name || "Subcontractor"}</DialogTitle>
          <DialogDescription>
            A small portfolio of completed work to review before assigning a job.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Loading work photos">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="aspect-square animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium">Work photos could not be loaded.</p>
              <p className="mt-1 text-muted-foreground">{error?.message || "Check your connection and retry."}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : photos.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
              <ImagePlus className="mx-auto mb-2 h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">No work photos yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Add a few examples of their completed work.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
              <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-lg bg-muted/50">
                {selectedPhoto && (
                  <img
                    src={selectedPhoto.file_url}
                    alt={selectedPhoto.file_name}
                    className="max-h-[42dvh] w-full object-contain"
                  />
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:content-start">
                {photos.map((photo) => (
                  <button
                    type="button"
                    key={photo.id}
                    onClick={() => setSelectedPhotoId(photo.id)}
                    aria-label={`View ${photo.file_name}`}
                    aria-pressed={selectedPhoto?.id === photo.id}
                    className={`overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selectedPhoto?.id === photo.id ? "ring-2 ring-primary" : ""
                    }`}
                  >
                    <img src={photo.file_url} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
              {selectedPhoto && (
                <div className="flex min-w-0 items-center justify-between gap-2 sm:col-span-2">
                  <p className="truncate text-sm text-muted-foreground" title={selectedPhoto.file_name}>{selectedPhoto.file_name}</p>
                  {confirmRemoveId === selectedPhoto.id ? (
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <span className="mr-1 text-xs text-muted-foreground">Remove from this portfolio?</span>
                      <Button size="sm" variant="destructive" disabled={busy} onClick={() => removePhoto(selectedPhoto)}>Remove</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRemoveId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`Remove ${selectedPhoto.file_name} from portfolio`}
                      onClick={() => setConfirmRemoveId(selectedPhoto.id)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {isLoading || isError ? (
                <span>{isLoading ? "Checking portfolio limit…" : "Uploads disabled until photo count can be checked."}</span>
              ) : (
                <span>{photoCount} of {PHOTO_LIMIT} photos · Automatically compressed to ≤1600px and ≤350KB.</span>
              )}
              <p className="mt-1">JPEG, PNG, WebP, or AVIF. HEIC is not supported.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                className="sr-only"
                aria-label="Choose work photos"
                onChange={(event) => uploadFiles(event.target.files)}
                disabled={!canUpload}
              />
              <Button
                type="button"
                disabled={!canUpload}
                onClick={() => inputRef.current?.click()}
                aria-label={busy ? "Uploading work photos" : "Add work photos"}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                {busy ? "Uploading…" : "Add photos"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}