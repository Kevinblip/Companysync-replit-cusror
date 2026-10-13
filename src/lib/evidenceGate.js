/**
 * Claims Defense Evidence Gate — pure helpers
 *
 * These are extracted from InspectionCapture.jsx so they can be unit-tested
 * without mounting the full page component.
 *
 * Rules:
 *  - Keywords are scanned in scopeOfWork + sectionNotes text only.
 *    Photo captions live in media[].caption and are intentionally excluded.
 *  - isEvidenceBlocked is true only for insurance inspections.
 *  - isTechEvidenceComplete clears the gate once all three buckets are filled.
 */

export const TRIGGER_KEYWORDS = ['two layers', 'organic', 'brittle', 'discontinued'];

export const TECH_EVIDENCE_SECTIONS = {
  CORE_SAMPLE:   'Technical Evidence - Core Sample',
  MEASUREMENT:   'Technical Evidence - Measurement Proof',
  REPAIRABILITY: 'Technical Evidence - Repairability Test',
};

/**
 * Returns the subset of TRIGGER_KEYWORDS found in scopeOfWork or sectionNotes.
 * Photo captions (media[].caption) are intentionally NOT scanned here.
 *
 * @param {string} scopeOfWork
 * @param {Record<string, string>} sectionNotes  section-keyed text blobs
 * @returns {string[]} matched keywords
 */
export function detectTriggeredKeywords(scopeOfWork, sectionNotes) {
  const allText = [
    scopeOfWork || '',
    ...Object.values(sectionNotes || {}),
  ].join(' ').toLowerCase();
  return TRIGGER_KEYWORDS.filter(kw => allText.includes(kw));
}

/**
 * True when the evidence gate should block the Proof Package.
 * Only fires for insurance inspections that have at least one triggered keyword.
 *
 * @param {string[]} triggeredKeywords
 * @param {'insurance'|'retail'} inspectionType
 * @returns {boolean}
 */
export function isEvidenceBlocked(triggeredKeywords, inspectionType) {
  return triggeredKeywords.length > 0 && inspectionType === 'insurance';
}

/**
 * True when the gate is either not active OR all three evidence buckets are full.
 *
 * Required counts:
 *   coreSample   >= 1
 *   measurement  >= 1
 *   repairability >= 3
 *
 * @param {{ coreSample: unknown[], measurement: unknown[], repairability: unknown[] }} techEvidencePhotos
 * @param {string[]} triggeredKeywords
 * @param {'insurance'|'retail'} inspectionType
 * @returns {boolean}
 */
export function isTechEvidenceComplete(techEvidencePhotos, triggeredKeywords, inspectionType) {
  const blocked = isEvidenceBlocked(triggeredKeywords, inspectionType);
  return !blocked || (
    techEvidencePhotos.coreSample.length >= 1 &&
    techEvidencePhotos.measurement.length >= 1 &&
    techEvidencePhotos.repairability.length >= 3
  );
}
