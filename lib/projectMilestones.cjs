const SEDGWICK_MILESTONES = [
  { key: 'claim_filed',          label: 'Claim Filed' },
  { key: 'adjuster_inspected',   label: 'Adjuster Inspected' },
  { key: 'supplement_approved',  label: 'Supplement Approved' },
  { key: 'scheduled',            label: 'Build Scheduled' },
  { key: 'materials_delivered',  label: 'Materials Delivered' },
  { key: 'build_complete',       label: 'Build Complete' },
  { key: 'final_invoice',        label: 'Final Invoice' },
];

const STANDARD_MILESTONES = [
  { key: 'signed',               label: 'Contract Signed' },
  { key: 'permit_filed',         label: 'Permit Filed' },
  { key: 'materials_delivered',  label: 'Materials Delivered' },
  { key: 'tear_off',             label: 'Tear-Off' },
  { key: 'build_complete',       label: 'Build Complete' },
  { key: 'final_invoice',        label: 'Final Invoice' },
];

const ALERT_KEYWORDS = ['leak', 'dog', 'gate', 'code', 'insurance', 'urgent', 'emergency'];

function getMilestones(projectType) {
  return projectType === 'sedgwick_claim' ? SEDGWICK_MILESTONES : STANDARD_MILESTONES;
}

function getMilestoneLabel(projectType, milestoneKey) {
  const list = getMilestones(projectType);
  return list.find(m => m.key === milestoneKey)?.label || milestoneKey;
}

module.exports = { SEDGWICK_MILESTONES, STANDARD_MILESTONES, ALERT_KEYWORDS, getMilestones, getMilestoneLabel };
