import { base44 } from "@/api/base44Client";

export const analyzeEstimateCompleteness = async (data) => {
  const response = await base44.functions.invoke('analyzeEstimateCompleteness', data);
  if (response.error) throw new Error(response.error);
  return response.data || response;
};

export const generateMaterialList = async (data) => {
  const response = await base44.functions.invoke('generateMaterialList', data);
  if (response.error) throw new Error(response.error);
  return response.data || response;
};
