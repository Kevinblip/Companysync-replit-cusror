import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { filterPriceListBySource } from '@/lib/priceListUtils';
import { loadCompanyPriceCatalog } from '@/lib/loadCompanyPriceCatalog';

/**
 * Custom hook — fetches all PriceListItems for the current company and
 * returns them pre-filtered into the four source-specific lists used by
 * AIEstimator and any other pricing components.
 *
 * @param {Object|null} myCompany  The current company record (from useCurrentCompany)
 * @returns {{
 *   allPriceListItems: Array,
 *   xactimatePriceList: Array,
 *   xactimateNewPriceList: Array,
 *   customPriceList: Array,
 *   symbilityPriceList: Array,
 *   isLoading: boolean
 * }}
 */
export function usePriceList(myCompany) {
  const { data: allPriceListItems = [], isLoading } = useQuery({
    queryKey: ['price-list-items', myCompany?.id],
    queryFn: () => loadCompanyPriceCatalog(base44.entities.PriceListItem, myCompany?.id),
    enabled: !!myCompany,
    // Entity list endpoints can return null for a newly provisioned company.
    // React Query's default value only handles undefined, so normalize before
    // this hook feeds the collection into price-list filtering.
    select: (data) => Array.isArray(data) ? data : [],
  });

  const {
    xactimatePriceList,
    xactimateNewPriceList,
    customPriceList,
    symbilityPriceList,
  } = filterPriceListBySource(allPriceListItems);

  return {
    allPriceListItems,
    xactimatePriceList,
    xactimateNewPriceList,
    customPriceList,
    symbilityPriceList,
    isLoading,
  };
}
