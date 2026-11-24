export function getFarmerPlotParams(searchParams: URLSearchParams) {
  const farmId = searchParams.get('farmId')?.trim();
  return { limit: 100, ...(farmId ? { farmId } : {}) };
}
