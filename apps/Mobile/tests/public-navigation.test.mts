import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getNavbarLayout } from '../src/components/public-site/navbar-layout.ts';
import { LAYOUT, SPACING } from '../src/theme/space.ts';

describe('navigation publique', () => {
  it('propose les pages principales et conserve les destinations existantes', () => {
    const navbar = readFileSync(new URL('../src/components/public-site/Navbar.tsx', import.meta.url), 'utf8');
    const destinations = [...navbar.matchAll(/href:\s*'(\/[^']+)'/g)].map((match) => match[1]);
    for (const route of ['/accueil', '/a-propos', '/services', '/marches', '/farmers', '/projets', '/public-site/data', '/actualites', '/contact', '/tenders']) {
      assert.ok(destinations.includes(route), `${route} est absente de la navigation`);
    }
  });

  it('réserve la barre au-dessus du contenu et centre le menu sur mobile, tablette et desktop', () => {
    for (const width of [320, 390, 768, 1024, 1280, 1920]) {
      const insets = { top: 24, bottom: 20, left: 0, right: 0 };
      const layout = getNavbarLayout(width, 800, insets, LAYOUT, SPACING.sm);
      assert.equal(layout.barLeft, width - layout.barLeft - layout.barWidth);
      assert.ok(layout.barWidth <= 1180);
      assert.equal(layout.barTop, 32);
      assert.equal(layout.contentTop, layout.barTop + 58 + 8);
      assert.equal(layout.contentTop + layout.panelMaxHeight + insets.bottom + 8, 800);
    }
  });

  it('respecte les zones de sécurité latérales et les écrans courts', () => {
    const layout = getNavbarLayout(844, 390, { top: 0, bottom: 21, left: 47, right: 0 }, LAYOUT, SPACING.sm);
    assert.equal(layout.barLeft - 47, 844 - layout.barLeft - layout.barWidth);
    assert.ok(layout.contentTop + layout.panelMaxHeight <= 390 - 21);
  });
});
