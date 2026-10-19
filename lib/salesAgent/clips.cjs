'use strict';

const { readJson } = require('./paths.cjs');

const EXCLUDED_IDS = new Set(['clip14-financing']);
const BANNED = /hearth|greensky|wisetack|abc supply|financ|clip14/i;

function loadRawClips() {
  const clips = readJson('config/salesDemoClips.json');
  if (!Array.isArray(clips)) throw new Error('sales clip map must be an array');
  return clips;
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/\(sidebar tour clip[^)]*\)/gi, '')
    .replace(/[^.]*\b(hearth|greensky|wisetack|abc supply|financ\w*)\b[^.]*\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isBanned(value) {
  return BANNED.test(String(value || ''));
}

function agentClips() {
  return loadRawClips()
    .filter((clip) => clip && !EXCLUDED_IDS.has(clip.id) && !isBanned(clip.id))
    .map((clip) => {
      const moments = (clip.key_moments || [])
        .filter((moment) => !isBanned(moment.label))
        .map((moment) => ({
          label: sanitizeText(moment.label),
          start: Number(moment.start),
          end: Number(moment.end),
        }))
        .filter((moment) => Number.isFinite(moment.start) && Number.isFinite(moment.end) && moment.end > moment.start);
      const desc = sanitizeText(clip.desc) || sanitizeText(clip.title);
      return {
        id: clip.id,
        title: sanitizeText(clip.title),
        tag: sanitizeText(clip.tag),
        desc,
        url: `https://getcompanysync.com/videos/${clip.id}.mp4`,
        keyMoments: moments,
      };
    })
    .filter((clip) => clip.title && !isBanned(clip.title) && !isBanned(clip.desc));
}

function clipById(id) {
  return agentClips().find((clip) => clip.id === id) || null;
}

function resolveClip(id, start, end) {
  const clip = clipById(id);
  if (!clip) return { ok: false, error: 'That clip is not available.' };
  let startSec = start == null || start === '' ? null : Number(start);
  let endSec = end == null || end === '' ? null : Number(end);
  if (startSec != null && !Number.isFinite(startSec)) return { ok: false, error: 'Clip start is not a time.' };
  if (endSec != null && !Number.isFinite(endSec)) return { ok: false, error: 'Clip end is not a time.' };
  if (startSec != null && endSec != null) {
    const moment = clip.keyMoments.find((item) => Math.abs(item.start - startSec) < 0.6 && Math.abs(item.end - endSec) < 0.6);
    const matchesKnown = !!moment;
    if (!matchesKnown && clip.keyMoments.length) {
      const nearest = clip.keyMoments.find((item) => startSec >= item.start - 0.6 && endSec <= item.end + 0.6);
      if (!nearest) {
        startSec = clip.keyMoments[0].start;
        endSec = clip.keyMoments[0].end;
      }
    }
  } else if (clip.keyMoments.length) {
    startSec = clip.keyMoments[0].start;
    endSec = clip.keyMoments[0].end;
  } else {
    startSec = 0;
    endSec = 30;
  }
  if (!(endSec > startSec)) return { ok: false, error: 'Clip window is empty.' };
  if (endSec - startSec > 45) endSec = startSec + 30;
  return {
    ok: true,
    id: clip.id,
    title: clip.title,
    url: clip.url,
    start: Math.max(0, startSec),
    end: endSec,
  };
}

function previewClipForTrade(trade) {
  const value = String(trade || '').toLowerCase();
  const prefer = value.includes('siding') ? 'clip30-siding-estimator'
    : (value.includes('gutter') || value.includes('exterior')) ? 'clip06-invoices'
      : (value.includes('storm') || value.includes('insurance')) ? 'clip28-lead-finder-storm'
        : (value.includes('retail') || value.includes('residential')) ? 'clip20-aivoice'
          : 'clip04-ai-estimator';
  return clipById(prefer) || clipById('clip01-dashboard');
}

module.exports = {
  EXCLUDED_IDS,
  loadRawClips,
  agentClips,
  clipById,
  resolveClip,
  previewClipForTrade,
};
