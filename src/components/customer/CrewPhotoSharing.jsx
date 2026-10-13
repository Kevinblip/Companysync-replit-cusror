import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getMilestones } from '../../../lib/projectMilestones.js';

async function sharingRequest(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.error || 'Could not update homeowner photo sharing.');
  }
  return data;
}

export function useCrewPhotoSharing(customerId, companyId, enabled) {
  return useQuery({
    queryKey: ['crew-photo-sharing', companyId, customerId],
    queryFn: () => sharingRequest(`/api/projects/crew/photos?customer_id=${encodeURIComponent(customerId)}`),
    enabled: !!customerId && !!companyId && enabled,
    staleTime: 0,
  });
}

export default function CrewPhotoSharing({ customer, companyId, photos, sharing, onSendPortal }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [captions, setCaptions] = useState({});
  const [milestone, setMilestone] = useState('');
  const [broken, setBroken] = useState(new Set());
  const projects = sharing.data?.projects || [];
  const shares = sharing.data?.shares || [];
  const selectedProject = projects.find(p => p.id === projectId);
  const visibleShares = shares.filter(s => s.is_public);
  const refresh = () => queryClient.invalidateQueries({
    queryKey: ['crew-photo-sharing', companyId, customer?.id],
  });

  useEffect(() => {
    setOpen(false);
    setSelected(new Set());
    setCaptions({});
    setBroken(new Set());
    setProjectId('');
  }, [customer?.id]);

  const publish = useMutation({
    mutationFn: () => {
      if (!projectId || !selected.size) throw new Error('Choose a project and at least one photo.');
      if (selected.size > 50) throw new Error('Share up to 50 photos at a time.');
      if ([...selected].some(id => broken.has(id))) throw new Error('Remove unavailable photos before sharing.');
      return sharingRequest(`/api/projects/${encodeURIComponent(projectId)}/photos/crew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customer.id,
          photos: [...selected].map(media_id => ({
            media_id,
            ...(Object.hasOwn(captions, media_id) ? { caption: captions[media_id] } : {}),
            milestone: milestone || null,
          })),
        }),
      });
    },
    onSuccess: async () => {
      await refresh();
      setSelected(new Set());
      toast.success('Selected photos are now visible in the homeowner portal.');
    },
    onError: error => toast.error(error.message),
  });

  const hide = useMutation({
    mutationFn: share => sharingRequest(
      `/api/projects/${encodeURIComponent(share.project_id)}/photos/${encodeURIComponent(share.id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: false }),
      },
    ),
    onSuccess: async () => {
      await refresh();
      toast.success('Hidden from the homeowner portal. The original crew photo is unchanged.');
    },
    onError: error => toast.error(error.message),
  });
  const busy = publish.isPending || hide.isPending;

  function openSharing() {
    setProjectId(projects.length === 1 ? projects[0].id : '');
    setMilestone('');
    setSelected(new Set());
    setCaptions({});
    setOpen(true);
  }

  return (
    <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-blue-900">Homeowner photo gallery</p>
          <p className="mt-1 text-xs text-blue-800">
            {sharing.isLoading ? 'Checking shared photos…' : sharing.isError
              ? 'Sharing status could not be loaded.'
              : `${new Set(visibleShares.map(s => s.source_media_id)).size} crew photos shared. Other crew photos stay off the portal.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onSendPortal} data-testid="crew-photo-portal-link">
            Copy / send portal link
          </Button>
          <Button size="sm" onClick={openSharing} disabled={!sharing.data || sharing.isError}
            data-testid="crew-photo-manage-sharing">
            <Share2 className="mr-2 h-4 w-4" /> Manage homeowner photos
          </Button>
        </div>
      </div>
      {sharing.isError && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-red-700">
          <span>{sharing.error?.message}</span>
          <Button size="sm" variant="outline" onClick={() => sharing.refetch()}>Retry</Button>
        </div>
      )}
      <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
        <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Choose photos for the homeowner</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600">
            Only photos you publish here appear in the portal. The portal link also includes the
            customer’s existing project and document information; it is not a photos-only link.
          </p>
          {projects.length === 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              No project is linked to this customer by ID. Link the customer to a project in Projects first.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="crew-share-project">Project</Label>
                  <select id="crew-share-project" data-testid="crew-share-project"
                    className="mt-1 w-full rounded-md border bg-white p-2 text-sm"
                    value={projectId} disabled={busy}
                    onChange={event => { setProjectId(event.target.value); setMilestone(''); }}>
                    <option value="">Choose a project</option>
                    {projects.map(project => <option key={project.id} value={project.id}>
                      {project.name || project.title || project.address || project.id}
                    </option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="crew-share-milestone">Milestone (optional)</Label>
                  <select id="crew-share-milestone" className="mt-1 w-full rounded-md border bg-white p-2 text-sm"
                    value={milestone} disabled={!selectedProject || busy} onChange={e => setMilestone(e.target.value)}>
                    <option value="">Other / no milestone</option>
                    {getMilestones(selectedProject?.project_type).map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map(photo => {
                  const isSelected = selected.has(photo.id);
                  const alreadyShared = shares.some(s => s.source_media_id === photo.id && s.project_id === projectId && s.is_public);
                  const unavailable = broken.has(photo.id) || !(photo.file_url || photo.url);
                  return (
                    <div key={photo.id} className={`rounded-lg border p-2 ${isSelected ? 'border-blue-500 bg-blue-50' : ''}`}>
                      <label className="block cursor-pointer">
                        <div className="relative mb-2 aspect-square overflow-hidden rounded bg-gray-100">
                          {!unavailable && <img src={photo.file_url || photo.url} alt={photo.caption || 'Crew photo'}
                            className="h-full w-full object-cover" loading="lazy"
                            onError={() => setBroken(prev => new Set([...prev, photo.id]))} />}
                          {unavailable && <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-red-700">
                            Photo unavailable — cannot share
                          </span>}
                        </div>
                        <span className="flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={isSelected} disabled={unavailable || busy || (!isSelected && selected.size >= 50)}
                            data-testid={`crew-share-select-${photo.id}`}
                            onChange={() => setSelected(prev => {
                              const next = new Set(prev);
                              if (next.has(photo.id)) next.delete(photo.id); else next.add(photo.id);
                              return next;
                            })} />
                          {alreadyShared ? 'Shared on this project' : 'Select photo'}
                        </span>
                      </label>
                      {isSelected && <Input className="mt-2 text-xs" aria-label={`Caption for ${photo.caption || 'selected photo'}`}
                        placeholder="Caption (optional)" maxLength={500} disabled={busy}
                        value={captions[photo.id] ?? photo.caption ?? ''}
                        onChange={e => setCaptions(prev => ({ ...prev, [photo.id]: e.target.value }))} />}
                    </div>
                  );
                })}
              </div>
              {photos.length === 0 && <p className="text-sm text-gray-500">No crew photos available yet.</p>}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <p className="text-sm text-gray-600">{selected.size} selected (up to 50 at a time)</p>
                <Button onClick={() => publish.mutate()} data-testid="crew-share-publish"
                  disabled={busy || !projectId || !selected.size || [...selected].some(id => broken.has(id))}>
                  {publish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Publish selected photos
                </Button>
              </div>
            </>
          )}
          {visibleShares.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <h3 className="text-sm font-semibold"><Eye className="mr-1 inline h-4 w-4" /> Currently shared</h3>
              {visibleShares.map(share => {
                const photo = photos.find(p => p.id === share.source_media_id);
                const project = projects.find(p => p.id === share.project_id);
                return (
                  <div key={share.id} className="flex items-center gap-3 rounded border p-2">
                    {(photo?.file_url || photo?.url) && <img src={photo.file_url || photo.url}
                      alt={share.caption || 'Shared crew photo'} className="h-12 w-12 shrink-0 rounded object-cover" />}
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm">{share.caption || photo?.caption || 'Crew photo'}</p>
                      <p className="text-xs text-gray-500">{project?.name || project?.title || project?.address || share.project_id}</p>
                    </div>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => hide.mutate(share)}
                      data-testid={`crew-share-hide-${share.id}`}>
                      <EyeOff className="mr-1 h-4 w-4" /> Hide
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-gray-500">
            Hiding removes a photo from the portal, not from the CRM or copies already downloaded.
            Existing direct image URLs are not revoked.
          </p>
          <Button variant="outline" onClick={() => { setOpen(false); onSendPortal(); }} disabled={busy}>
            Copy / send homeowner portal link
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}