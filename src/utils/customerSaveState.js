// Only update the matching internal ID. Names and addresses are not identities.
export function cacheSavedCustomer(queryClient, savedCustomer) {
  queryClient.setQueriesData({ queryKey: ['customers'] }, rows =>
    Array.isArray(rows)
      ? rows.map(row => row.id === savedCustomer.id ? { ...row, ...savedCustomer } : row)
      : rows
  );
  queryClient.setQueriesData({ queryKey: ['customer', savedCustomer.id] }, row =>
    row?.id === savedCustomer.id ? { ...row, ...savedCustomer } : row
  );
}

export function shouldRefreshCustomerDraft(draft, customerId) {
  return draft.id !== customerId || !draft.dirty;
}
