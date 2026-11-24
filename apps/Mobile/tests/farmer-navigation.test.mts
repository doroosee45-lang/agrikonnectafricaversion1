import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canShowFarmerNavigation } from '../src/lib/farmer-navigation.ts';

describe('navigation producteur', () => {
  it('exige un rôle producteur et la permission du module', () => {
    assert.equal(canShowFarmerNavigation('/farmer/plots', ['FARMER'], ['plots.read']), true);
    assert.equal(canShowFarmerNavigation('/farmer/plots', ['FARMER'], []), false);
    assert.equal(canShowFarmerNavigation('/farmer/plots', ['INVESTOR'], ['plots.read']), false);
    assert.equal(canShowFarmerNavigation('/farmer/plots', ['FARMER'], ['*']), true);
  });

  it('ne montre pas les entrées réservées au producteur à un autre rôle', () => {
    assert.equal(canShowFarmerNavigation('/farmer/profile', ['FARMER'], []), true);
    assert.equal(canShowFarmerNavigation('/farmer/profile', ['INVESTOR'], ['*']), false);
  });
});
