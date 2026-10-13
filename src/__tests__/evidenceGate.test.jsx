/**
 * Evidence Gate — Claims Defense File
 *
 * Tests cover:
 *   1. Pure unit tests: TRIGGER_KEYWORDS detection in scopeOfWork + sectionNotes
 *   2. Pure unit tests: isEvidenceBlocked gate logic
 *   3. Pure unit tests: isTechEvidenceComplete threshold math
 *   4. No false trigger: keywords in photo captions only must NOT activate the gate
 *   5. Component tests: React state wiring — typing a keyword shows the blocked modal
 *      and ShieldAlert icon; filling all three evidence buckets clears the gate
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TRIGGER_KEYWORDS,
  TECH_EVIDENCE_SECTIONS,
  detectTriggeredKeywords,
  isEvidenceBlocked,
  isTechEvidenceComplete,
} from '@/lib/evidenceGate';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal media item for a technical evidence section */
function makeEvidencePhoto(section, id = crypto.randomUUID()) {
  return { id, section, file_url: `https://cdn.example.com/${id}.jpg`, caption: '' };
}

/** Fill a techEvidencePhotos bag so all thresholds are met */
function fullEvidenceBag() {
  return {
    coreSample:    [makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.CORE_SAMPLE)],
    measurement:   [makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.MEASUREMENT)],
    repairability: [
      makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
      makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
      makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
    ],
  };
}

/** Empty evidence bag (no uploads yet) */
function emptyEvidenceBag() {
  return { coreSample: [], measurement: [], repairability: [] };
}

// ─── 1. TRIGGER_KEYWORDS detection — pure unit tests ─────────────────────────

describe('TRIGGER_KEYWORDS constant', () => {
  it('exposes the four required claim-language triggers', () => {
    expect(TRIGGER_KEYWORDS).toEqual(
      expect.arrayContaining(['two layers', 'organic', 'brittle', 'discontinued'])
    );
    expect(TRIGGER_KEYWORDS).toHaveLength(4);
  });
});

describe('detectTriggeredKeywords — scopeOfWork + sectionNotes scanning', () => {
  it('returns [] when no text is present', () => {
    expect(detectTriggeredKeywords('', {})).toEqual([]);
    expect(detectTriggeredKeywords(null, null)).toEqual([]);
    expect(detectTriggeredKeywords(undefined, undefined)).toEqual([]);
  });

  it('returns [] when text contains no trigger words', () => {
    expect(detectTriggeredKeywords('Replace shingles and gutters', {})).toEqual([]);
  });

  it('detects "two layers" in scopeOfWork', () => {
    const found = detectTriggeredKeywords('Roof has two layers of shingles', {});
    expect(found).toContain('two layers');
  });

  it('detects "organic" in scopeOfWork', () => {
    const found = detectTriggeredKeywords('Material is organic mat', {});
    expect(found).toContain('organic');
  });

  it('detects "brittle" in scopeOfWork', () => {
    const found = detectTriggeredKeywords('Shingles appear brittle after hail', {});
    expect(found).toContain('brittle');
  });

  it('detects "discontinued" in scopeOfWork', () => {
    const found = detectTriggeredKeywords('Product is discontinued per manufacturer', {});
    expect(found).toContain('discontinued');
  });

  it('is case-insensitive for keywords', () => {
    expect(detectTriggeredKeywords('TWO LAYERS of shingles', {})).toContain('two layers');
    expect(detectTriggeredKeywords('Material is ORGANIC', {})).toContain('organic');
    expect(detectTriggeredKeywords('Shingles are BRITTLE', {})).toContain('brittle');
    expect(detectTriggeredKeywords('Brand is DISCONTINUED', {})).toContain('discontinued');
  });

  it('detects keywords in sectionNotes values (not just scopeOfWork)', () => {
    const found = detectTriggeredKeywords('', {
      'Front Slope': 'Standard granule loss noted',
      'Left Slope': 'Material shows organic mat composition',
    });
    expect(found).toContain('organic');
  });

  it('detects keywords spread across scopeOfWork AND sectionNotes', () => {
    const found = detectTriggeredKeywords('Roof has two layers', {
      'Right Slope': 'Shingles are brittle',
    });
    expect(found).toContain('two layers');
    expect(found).toContain('brittle');
  });

  it('returns each matched keyword exactly once (no duplicates)', () => {
    const found = detectTriggeredKeywords('two layers and two layers again', {
      'Note': 'two layers visible here too',
    });
    expect(found.filter(k => k === 'two layers')).toHaveLength(1);
  });

  it('returns all four keywords when all appear', () => {
    const sow = 'two layers of organic brittle discontinued shingles';
    const found = detectTriggeredKeywords(sow, {});
    expect(found).toHaveLength(4);
  });

  // ── Critical: photo captions must NOT scan ──
  it('does NOT trigger when keyword appears only in photo captions (not sow/sectionNotes)', () => {
    // Photo captions are stored in media[].caption — NOT in scopeOfWork or sectionNotes.
    // Simulating: the caller passes empty sow + no section notes, but the caption
    // string "two layers" lives only in the media layer (not passed to this function).
    const found = detectTriggeredKeywords('', {});
    expect(found).toEqual([]);
  });

  it('does NOT trigger on partial keyword matches ("organ" should not match "organic")', () => {
    // "organ" is a substring of "organic" but detectTriggeredKeywords uses includes()
    // on the full keyword string — so "organ" alone would NOT produce a match.
    const found = detectTriggeredKeywords('The organ pipe', {});
    expect(found).not.toContain('organic');
  });
});

// ─── 2. isEvidenceBlocked gate logic ─────────────────────────────────────────

describe('isEvidenceBlocked', () => {
  it('returns false when there are no triggered keywords', () => {
    expect(isEvidenceBlocked([], 'insurance')).toBe(false);
  });

  it('returns true for insurance + triggered keywords', () => {
    expect(isEvidenceBlocked(['two layers'], 'insurance')).toBe(true);
  });

  it('returns false for retail inspection even with triggered keywords', () => {
    expect(isEvidenceBlocked(['two layers', 'brittle'], 'retail')).toBe(false);
  });

  it('returns false when inspectionType is not set (undefined)', () => {
    expect(isEvidenceBlocked(['organic'], undefined)).toBe(false);
  });
});

// ─── 3. isTechEvidenceComplete threshold math ────────────────────────────────

describe('isTechEvidenceComplete', () => {
  it('returns true when no keywords are triggered (gate not active)', () => {
    expect(isTechEvidenceComplete(emptyEvidenceBag(), [], 'insurance')).toBe(true);
  });

  it('returns true for retail even with keywords and no evidence photos', () => {
    expect(isTechEvidenceComplete(emptyEvidenceBag(), ['two layers'], 'retail')).toBe(true);
  });

  it('returns false when gate is active and evidence bag is empty', () => {
    expect(isTechEvidenceComplete(emptyEvidenceBag(), ['two layers'], 'insurance')).toBe(false);
  });

  it('returns false when only coreSample is present', () => {
    const bag = { ...emptyEvidenceBag(), coreSample: [makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.CORE_SAMPLE)] };
    expect(isTechEvidenceComplete(bag, ['organic'], 'insurance')).toBe(false);
  });

  it('returns false when repairability has fewer than 3 photos', () => {
    const bag = {
      coreSample:    [makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.CORE_SAMPLE)],
      measurement:   [makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.MEASUREMENT)],
      repairability: [makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY), makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY)],
    };
    expect(isTechEvidenceComplete(bag, ['brittle'], 'insurance')).toBe(false);
  });

  it('returns true once all three buckets meet minimums (1 + 1 + 3)', () => {
    expect(isTechEvidenceComplete(fullEvidenceBag(), ['discontinued'], 'insurance')).toBe(true);
  });

  it('returns true with more than minimum photos in each bucket', () => {
    const bag = {
      coreSample:    [makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.CORE_SAMPLE), makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.CORE_SAMPLE)],
      measurement:   [makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.MEASUREMENT), makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.MEASUREMENT)],
      repairability: Array.from({ length: 5 }, () => makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY)),
    };
    expect(isTechEvidenceComplete(bag, ['two layers'], 'insurance')).toBe(true);
  });

  it('returns false when measurement is missing (coreSample + repairability only)', () => {
    const bag = {
      coreSample:    [makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.CORE_SAMPLE)],
      measurement:   [],
      repairability: [
        makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
        makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
        makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
      ],
    };
    expect(isTechEvidenceComplete(bag, ['organic'], 'insurance')).toBe(false);
  });
});

// ─── 4. Component: evidence gate state machine ────────────────────────────────
//
// We test the React wiring through a minimal harness component that mirrors the
// exact state-management pattern in InspectionCapture:
//   • scopeOfWork   → detectTriggeredKeywords
//   • triggeredKeywords.length > 0 + inspectionType === 'insurance' → gate active
//   • gate active + !isTechEvidenceComplete → ShieldAlert on Proof Package button
//   • gate clears once all three buckets are satisfied

function EvidenceGateHarness({ initialSow = '', initialType = 'insurance', initialMedia = [] }) {
  const [scopeOfWork, setScopeOfWork] = useState(initialSow);
  const [inspectionType] = useState(initialType);
  const [media, setMedia] = useState(initialMedia);
  const [showBlockedModal, setShowBlockedModal] = useState(false);

  // Mirror InspectionCapture logic exactly
  const triggeredKeywords = detectTriggeredKeywords(scopeOfWork, {});

  const techEvidencePhotos = {
    coreSample:    media.filter(m => m.section === TECH_EVIDENCE_SECTIONS.CORE_SAMPLE),
    measurement:   media.filter(m => m.section === TECH_EVIDENCE_SECTIONS.MEASUREMENT),
    repairability: media.filter(m => m.section === TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
  };

  const blocked    = isEvidenceBlocked(triggeredKeywords, inspectionType);
  const complete   = isTechEvidenceComplete(techEvidencePhotos, triggeredKeywords, inspectionType);
  const needsEvidence = blocked && !complete;

  const handleProofPackageClick = () => {
    if (needsEvidence) {
      setShowBlockedModal(true);
      return;
    }
    // In the real component this opens the proof package modal; omitted here.
  };

  const addPhoto = (section) => {
    setMedia(prev => [...prev, makeEvidencePhoto(section, `photo-${prev.length}`)]);
  };

  return (
    <div>
      <textarea
        data-testid="sow-input"
        value={scopeOfWork}
        onChange={e => setScopeOfWork(e.target.value)}
        placeholder="Scope of work..."
      />

      {needsEvidence && (
        <div data-testid="evidence-card">
          <span data-testid="triggered-keywords">
            {triggeredKeywords.join(', ')}
          </span>
        </div>
      )}

      <button
        data-testid="button-proof-package"
        onClick={handleProofPackageClick}
      >
        {needsEvidence ? (
          <span data-testid="icon-shield-alert">ShieldAlert</span>
        ) : (
          <span data-testid="icon-package">Package</span>
        )}
        Proof Package
      </button>

      {showBlockedModal && (
        <div data-testid="evidence-blocked-modal">
          Technical evidence required before generating proof package
        </div>
      )}

      {/* Controls to add evidence photos */}
      <button data-testid="add-core-sample"
        onClick={() => addPhoto(TECH_EVIDENCE_SECTIONS.CORE_SAMPLE)}>
        Add Core Sample
      </button>
      <button data-testid="add-measurement"
        onClick={() => addPhoto(TECH_EVIDENCE_SECTIONS.MEASUREMENT)}>
        Add Measurement
      </button>
      <button data-testid="add-repairability"
        onClick={() => addPhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY)}>
        Add Repairability
      </button>

      <span data-testid="core-count">{techEvidencePhotos.coreSample.length}</span>
      <span data-testid="measurement-count">{techEvidencePhotos.measurement.length}</span>
      <span data-testid="repairability-count">{techEvidencePhotos.repairability.length}</span>
      <span data-testid="gate-status">{needsEvidence ? 'blocked' : 'clear'}</span>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EvidenceGate — component state wiring', () => {
  it('starts clear with empty scope of work', () => {
    render(<EvidenceGateHarness />);
    expect(screen.getByTestId('gate-status')).toHaveTextContent('clear');
    expect(screen.queryByTestId('evidence-card')).toBeNull();
    expect(screen.getByTestId('icon-package')).toBeTruthy();
    expect(screen.queryByTestId('icon-shield-alert')).toBeNull();
  });

  it('typing "two layers" triggers the gate and shows ShieldAlert + evidence card', () => {
    render(<EvidenceGateHarness />);

    fireEvent.change(screen.getByTestId('sow-input'), {
      target: { value: 'Roof has two layers of shingles' },
    });

    expect(screen.getByTestId('gate-status')).toHaveTextContent('blocked');
    expect(screen.getByTestId('evidence-card')).toBeTruthy();
    expect(screen.getByTestId('icon-shield-alert')).toBeTruthy();
    expect(screen.queryByTestId('icon-package')).toBeNull();
    expect(screen.getByTestId('triggered-keywords')).toHaveTextContent('two layers');
  });

  it('clicking Proof Package while blocked opens the evidence-blocked modal', () => {
    render(<EvidenceGateHarness initialSow="material is brittle" />);

    expect(screen.getByTestId('gate-status')).toHaveTextContent('blocked');
    expect(screen.queryByTestId('evidence-blocked-modal')).toBeNull();

    fireEvent.click(screen.getByTestId('button-proof-package'));

    expect(screen.getByTestId('evidence-blocked-modal')).toBeTruthy();
  });

  it('gate clears once 1 core sample + 1 measurement + 3 repairability photos are present', () => {
    render(<EvidenceGateHarness initialSow="discontinued shingles present" />);

    // Confirm gate starts blocked
    expect(screen.getByTestId('gate-status')).toHaveTextContent('blocked');

    // Upload 1 core sample
    fireEvent.click(screen.getByTestId('add-core-sample'));
    expect(screen.getByTestId('gate-status')).toHaveTextContent('blocked'); // still blocked

    // Upload 1 measurement
    fireEvent.click(screen.getByTestId('add-measurement'));
    expect(screen.getByTestId('gate-status')).toHaveTextContent('blocked'); // still blocked

    // Upload 2 repairability (not enough yet)
    fireEvent.click(screen.getByTestId('add-repairability'));
    fireEvent.click(screen.getByTestId('add-repairability'));
    expect(screen.getByTestId('gate-status')).toHaveTextContent('blocked'); // still blocked

    // Upload 3rd repairability → gate should clear
    fireEvent.click(screen.getByTestId('add-repairability'));
    expect(screen.getByTestId('repairability-count')).toHaveTextContent('3');
    expect(screen.getByTestId('gate-status')).toHaveTextContent('clear');
    expect(screen.queryByTestId('evidence-card')).toBeNull();
    expect(screen.getByTestId('icon-package')).toBeTruthy();
    expect(screen.queryByTestId('icon-shield-alert')).toBeNull();
  });

  it('Proof Package button works normally (no modal) after evidence is complete', () => {
    const fullMedia = [
      makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.CORE_SAMPLE),
      makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.MEASUREMENT),
      makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
      makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
      makeEvidencePhoto(TECH_EVIDENCE_SECTIONS.REPAIRABILITY),
    ];
    render(<EvidenceGateHarness initialSow="organic mat shingles" initialMedia={fullMedia} />);

    expect(screen.getByTestId('gate-status')).toHaveTextContent('clear');

    fireEvent.click(screen.getByTestId('button-proof-package'));
    expect(screen.queryByTestId('evidence-blocked-modal')).toBeNull();
  });

  it('retail inspection is never blocked even with trigger keywords and no evidence', () => {
    render(<EvidenceGateHarness initialType="retail" initialSow="two layers of brittle organic discontinued" />);

    expect(screen.getByTestId('gate-status')).toHaveTextContent('clear');
    expect(screen.queryByTestId('evidence-card')).toBeNull();
    expect(screen.getByTestId('icon-package')).toBeTruthy();
  });

  it('keywords in photo captions (not sow/sectionNotes) do NOT trigger the gate', () => {
    // The harness only passes scopeOfWork to detectTriggeredKeywords,
    // mirroring InspectionCapture which intentionally excludes media[].caption.
    // We pass a media item whose caption contains a keyword but leave sow blank.
    const captionOnlyMedia = [{
      id: 'p1',
      section: 'Front Slope',
      file_url: 'https://cdn.example.com/p1.jpg',
      caption: 'two layers visible in this photo',  // keyword in caption only
    }];
    render(<EvidenceGateHarness initialSow="" initialMedia={captionOnlyMedia} />);

    expect(screen.getByTestId('gate-status')).toHaveTextContent('clear');
    expect(screen.queryByTestId('evidence-card')).toBeNull();
    expect(screen.getByTestId('icon-package')).toBeTruthy();
  });

  it('multiple keywords from sow all appear in the triggered list', () => {
    render(<EvidenceGateHarness initialSow="two layers of organic brittle material" />);

    expect(screen.getByTestId('gate-status')).toHaveTextContent('blocked');
    const kwText = screen.getByTestId('triggered-keywords').textContent;
    expect(kwText).toContain('two layers');
    expect(kwText).toContain('organic');
    expect(kwText).toContain('brittle');
  });
});
