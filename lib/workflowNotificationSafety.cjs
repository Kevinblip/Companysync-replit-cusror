function isRedundantPlatformEstimateWorkflow(workflow, workflowId = '') {
  if (!workflow || String(workflow.trigger_type || '').toLowerCase() !== 'estimate_created') {
    return false;
  }

  const name = String(workflow.workflow_name || workflow.name || '').trim().toLowerCase();
  const createdBy = String(workflow.created_by || '').trim().toLowerCase();
  const id = String(workflowId || '').trim().toLowerCase();

  return name === 'new estimate follow-up'
    && (createdBy === 'platform' || id.startsWith('wf_custom_new_estimate_follow_up_'));
}

module.exports = { isRedundantPlatformEstimateWorkflow };