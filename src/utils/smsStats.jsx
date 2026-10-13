import React from "react";

export const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
);
export const GSM7_EXTENDED = new Set('^{}\\[~]|€');

export function getSmsStats(text) {
  if (!text) return { chars: 0, segments: 0, billedUnits: 0, singleLimit: 160 };
  const chars = text.length;
  let isGsm7 = true;
  let septets = 0;
  for (const char of text) {
    if (GSM7_BASIC.has(char)) {
      septets += 1;
    } else if (GSM7_EXTENDED.has(char)) {
      septets += 2;
    } else {
      isGsm7 = false;
      break;
    }
  }
  if (isGsm7) {
    const segments = septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { chars, segments, billedUnits: septets, singleLimit: 160 };
  } else {
    const segments = chars <= 70 ? 1 : Math.ceil(chars / 67);
    return { chars, segments, billedUnits: chars, singleLimit: 70 };
  }
}

export function MergeFieldLengthWarning({ text, expandFn, testId }) {
  if (!text || !text.includes('{')) return null;
  const expanded = expandFn ? expandFn(text) : text;
  const raw = getSmsStats(text);
  const exp = getSmsStats(expanded);
  if (exp.segments <= raw.segments && exp.billedUnits <= raw.singleLimit) return null;
  return (
    <p
      data-testid={testId}
      className="text-xs mt-1 text-amber-600 font-semibold"
    >
      ⚠ With real values this may be ~{exp.chars} chars ({exp.segments} segment{exp.segments !== 1 ? "s" : ""}) — consider shortening.
    </p>
  );
}
