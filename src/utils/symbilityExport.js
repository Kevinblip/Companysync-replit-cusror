/**
 * Symbility code mapping — initial library of the most common
 * roofing / siding / gutter line items used by Symbility Claims Connect.
 * Mirrors the shape of xactimateExport.js so the AI prompt builder
 * can use either system without branching everywhere.
 */

export const SYMBILITY_CODE_ALIASES = {
  'shingles':         'RF-SHGL-ARCH',
  'arch shingles':    'RF-SHGL-ARCH',
  'architectural':    'RF-SHGL-ARCH',
  '3-tab':            'RF-SHGL-3TB',
  '3tab':             'RF-SHGL-3TB',
  'premium shingle':  'RF-SHGL-LUX',
  'felt':             'RF-UND-15LB',
  'felt 15':          'RF-UND-15LB',
  'felt 30':          'RF-UND-30LB',
  'synthetic':        'RF-UND-SYN',
  'synthetic underlayment': 'RF-UND-SYN',
  'ice water':        'RF-IWS',
  'ice & water':      'RF-IWS',
  'ice and water':    'RF-IWS',
  'starter':          'RF-STR',
  'starter strip':    'RF-STR',
  'ridge':            'RF-RDG',
  'ridge cap':        'RF-RDG',
  'drip':             'RF-DRP',
  'drip edge':        'RF-DRP',
  'step flashing':    'RF-FLS-STP',
  'flashing':         'RF-FLS',
  'apron flashing':   'RF-FLS-APR',
  'counter flashing': 'RF-FLS-CTR',
  'ridge vent':       'RF-VNT-RDG',
  'box vent':         'RF-VNT-BOX',
  'pipe boot':        'RF-VNT-PIPE',
  'pipe flashing':    'RF-VNT-PIPE',
  'plumbing boot':    'RF-VNT-PIPE',
  'plywood':          'RF-DEC-PLY',
  'osb':              'RF-DEC-OSB',
  'decking':          'RF-DEC-PLY',
  'tear off':         'RF-RMV',
  'remove shingles':  'RF-RMV',
  'gutter':           'GU-ALU-5',
  'gutters':          'GU-ALU-5',
  '6 inch gutter':    'GU-ALU-6',
  'downspout':        'GU-DSPT',
  'downspouts':       'GU-DSPT',
  'vinyl siding':     'SI-VNL',
  'siding':           'SI-VNL',
  'starter siding':   'SI-STR',
  'house wrap':       'SI-WRP',
  'tyvek':            'SI-WRP',
  'wrap':             'SI-WRP',
  'soffit':           'SI-SFT',
  'fascia':           'SI-FSC',
  'labor':            'GEN-LAB',
  'installation':     'GEN-LAB',
  'dump fee':         'GEN-DUMP',
  'detach reset':     'GEN-DR',
};

/**
 * Returns a short human-readable description of how the AI should
 * format its line items for a given pricing source. Used by the
 * voice → estimate prompt builder.
 */
export function getFormatInstructions(pricingSource) {
  const ps = (pricingSource || '').toLowerCase();
  if (ps === 'xactimate' || ps === 'xactimate_new') {
    return [
      `OUTPUT FORMAT: Xactimate`,
      `- Use Xactimate line item codes for every line. Common codes: RFG 300 (architectural shingles), RFG 240 (3-tab), RFG SYN (synthetic underlayment), RFG ICW (ice & water shield), RFG STR (starter), RFG RDG (ridge cap), RFG DRP (drip edge), RFG FLS (step flashing), RFG CBV (ridge vent), RFG VBX (box vent), RFG PPV (pipe boot), RFG RMV (tear off), RFG PLY/RFG OSB (decking), GUT ALU (gutter), GUT DWP (downspout), PNL AS / SID 180 (siding), SID HK (house wrap), SFT 1 (soffit), FSC 1 (fascia), RFG LAB (labor).`,
      `- Use the official Xactimate line item description text where possible.`,
      `- Include RCV and ACV columns. Do NOT add overhead & profit unless explicitly requested.`,
      `- Units: SQ for shingles/underlayment/decking, LF for ridge/hip/valley/rake/eave/flashing/gutters, EA for vents/boots/skylights/chimneys.`,
    ].join('\n');
  }
  if (ps === 'symbility') {
    return [
      `OUTPUT FORMAT: Symbility`,
      `- Use Symbility code structure for every line. Common codes: RF-SHGL-ARCH (architectural shingles), RF-SHGL-3TB (3-tab), RF-UND-SYN (synthetic underlayment), RF-IWS (ice & water), RF-STR (starter), RF-RDG (ridge cap), RF-DRP (drip edge), RF-FLS-STP (step flashing), RF-VNT-RDG (ridge vent), RF-VNT-BOX (box vent), RF-VNT-PIPE (pipe boot), RF-RMV (tear off), RF-DEC-PLY/RF-DEC-OSB (decking), GU-ALU-5 (5" aluminum gutter), GU-DSPT (downspout), SI-VNL (vinyl siding), SI-WRP (house wrap), SI-SFT (soffit), SI-FSC (fascia), GEN-LAB (labor), GEN-DUMP (dump fee), GEN-DR (detach & reset).`,
      `- Use the official Symbility line item description wording.`,
      `- Include RCV and ACV columns. No overhead & profit unless explicitly requested.`,
      `- Units: SQ for shingles/underlayment/decking, LF for linear measurements, EA for accessories.`,
    ].join('\n');
  }
  return [
    `OUTPUT FORMAT: Custom`,
    `- Use plain-English line item descriptions tailored to this contractor. No carrier-specific codes required.`,
    `- Standard units: SQ for shingles/underlayment, LF for linear runs, EA for accessories, HR for labor when appropriate.`,
  ].join('\n');
}

/**
 * Human-friendly label for a pricing source.
 */
export function formatLabel(pricingSource) {
  const ps = (pricingSource || '').toLowerCase();
  if (ps === 'xactimate' || ps === 'xactimate_new') return 'Xactimate';
  if (ps === 'symbility') return 'Symbility';
  return 'Custom';
}
