// This is the existing shared seed catalog shown on the Items screen, not
// another subscriber's private price list. The server retains tenant guards.
export const SHARED_PRICE_CATALOG_COMPANY_ID = '695944e3c1fb00b7ab716c6f';

export async function loadCompanyPriceCatalog(entity, companyId, initialLimit = 50000) {
  if (!companyId) return [];
  let limit = initialLimit;
  while (true) {
    const result = await entity.filter({
      company_id: { $in: [...new Set([companyId, SHARED_PRICE_CATALOG_COMPANY_ID])] },
    }, '-created_date', limit);
    if (result == null) return [];
    if (!Array.isArray(result)) throw new Error('The line-item catalog could not be loaded.');
    if (result.length < limit) return result;
    // Do not silently drop older uploads when a company exceeds one fetch.
    if (limit >= 2147483647) throw new Error('The line-item catalog exceeds the supported query size.');
    limit = Math.min(limit * 2, 2147483647);
  }
}
