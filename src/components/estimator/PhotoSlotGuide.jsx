import { SLOT_ORIENTATION_HINT, slotHint } from '../../../functions/utils/photoSlotOrientation.js';

/**
 * Plan-view reminder drawn as the photographer stands in the street.
 * Front is at the bottom, nearest the viewer. Back Right sits at the
 * top-right of this plan, which is the viewer's left after they walk
 * around to the back.
 */
export function PhotoSlotGuide() {
  return (
    <div
      data-testid="photo-slot-orientation-guide"
      className="flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50/80 px-2 py-1.5"
    >
      <svg
        width="54"
        height="48"
        viewBox="0 0 54 48"
        aria-hidden="true"
        className="shrink-0 text-cyan-800"
      >
        <text x="27" y="8" textAnchor="middle" fontSize="4.5" fill="currentColor">back</text>
        <rect x="16" y="11" width="22" height="18" rx="1.5" fill="white" stroke="currentColor" strokeWidth="1.4" />
        <text x="27" y="22.5" textAnchor="middle" fontSize="5" fill="currentColor">FRONT</text>
        <text x="8" y="22" textAnchor="middle" fontSize="5" fill="currentColor">L</text>
        <text x="46" y="22" textAnchor="middle" fontSize="5" fill="currentColor">R</text>
        <path d="M27 38 V31" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M23.5 34.5 L27 31 L30.5 34.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <text x="27" y="46" textAnchor="middle" fontSize="5" fill="currentColor">STREET</text>
      </svg>
      <p className="text-[10px] leading-snug text-cyan-900">{SLOT_ORIENTATION_HINT}</p>
    </div>
  );
}

export function photoSlotHint(label) {
  return slotHint(label);
}
