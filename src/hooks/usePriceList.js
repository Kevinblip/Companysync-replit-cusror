import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { filterPriceListBySource } from '@/lib/priceListUtils';

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
    queryKey: ['all-price-list-items', myCompany?.id],
    queryFn: () =>
      myCompany
        ? base44.entities.PriceListItem.filter({ company_id: myCompany.id }, '-created_date', 10000)
        : [],
    enabled: !!myCompany,
    initialData: [],
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
