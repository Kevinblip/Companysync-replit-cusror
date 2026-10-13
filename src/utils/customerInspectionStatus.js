export function hasManualCustomerInspection(customer) {
  const value = customer?.manual_inspected_date;
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isCustomerInspected(customer, job) {
  return job?.status === 'completed' || hasManualCustomerInspection(customer);
}

export async function saveCustomerInspectionMarks({ customers, date, email, clear = false, update }) {
  if (!clear) {
    const [year, month, day] = (date || '').split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
        parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
      throw new Error('Choose a valid inspection date.');
    }
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (parsed > today) throw new Error('The inspection date cannot be in the future.');
  }
  const records = [...new Map(customers.map(customer => [customer.id, customer])).values()];
  const failed = [];
  let successCount = 0;
  // Bound requests so a selected batch does not overwhelm the entity API.
  for (let offset = 0; offset < records.length; offset += 5) {
    await Promise.all(records.slice(offset, offset + 5).map(async customer => {
      try {
        await update(customer.id, {
          manual_inspected_date: clear ? null : date,
          manual_inspected_by: clear ? null : email,
        });
        successCount++;
      } catch (error) {
        failed.push({ customer, error: error.message || 'Update failed' });
      }
    }));
  }
  return { successCount, failed };
}
