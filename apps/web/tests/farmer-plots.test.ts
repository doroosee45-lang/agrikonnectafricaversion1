import { describe, expect, it } from 'vitest';

import { getFarmerPlotParams } from '@/pages/farmer/Plots/query';

describe('filtre des parcelles Farmer', () => {
  it('transmet farmId depuis la query string avec la limite de liste', () => {
    expect(getFarmerPlotParams(new URLSearchParams('farmId=farm-identifier-123'))).toEqual({
      limit: 100,
      farmId: 'farm-identifier-123',
    });
  });

  it('conserve la liste complète quand farmId est absent ou vide', () => {
    expect(getFarmerPlotParams(new URLSearchParams())).toEqual({ limit: 100 });
    expect(getFarmerPlotParams(new URLSearchParams('farmId=%20%20'))).toEqual({ limit: 100 });
  });
});
