import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESPACES_MOBILE, EQUIVALENTS_WEB, espaceCourant, routesEspace } from '../src/lib/space-nav.ts';

/**
 * PARITÉ DE NAVIGATION Web ↔ Mobile : chaque entrée de la barre latérale Web
 * (apps/web/src/lib/space-nav.ts), espace par espace, est présente dans le menu
 * Mobile du même espace, et mène à un écran Mobile qui existe.
 */
const WEB = fileURLToPath(new URL('../../web/src/lib/space-nav.ts', import.meta.url));
const APP = fileURLToPath(new URL('../src/app/', import.meta.url));

const fichiers = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fichiers(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []));
const routes = fichiers(APP)
  .filter((f) => !/_layout\.tsx$/.test(f) && !/\+not-found/.test(f))
  .map((f) => relative(APP, f).split(sep).join('/').replace(/\.tsx?$/, ''))
  .map((r) => r.split('/').filter((s) => !/^\(.*\)$/.test(s)))
  .map((s) => (s[s.length - 1] === 'index' ? s.slice(0, -1) : s));
const existe = (url: string) => {
  const segs = url.split('/').filter(Boolean);
  return routes.some((r) => r.length === segs.length && r.every((s, i) => /^\[.*\]$/.test(s) || s === segs[i]));
};

/** Liens Web par espace : blocs `id: '<espace>'` successifs du fichier Web. */
function liensWeb(): Record<string, string[]> {
  const source = readFileSync(WEB, 'utf8');
  const blocs = source.split(/\n\s*\{\s*\n\s*id: '/).slice(1);
  return Object.fromEntries(
    blocs.map((b) => {
      const id = b.slice(0, b.indexOf("'"));
      return [id, [...new Set([...b.matchAll(/to: '([^']+)'/g)].map((m) => m[1]))]];
    }),
  );
}

describe('parité de navigation Web ↔ Mobile', () => {
  const web = liensWeb();

  it('les quatre espaces Web existent sur Mobile', () => {
    assert.deepEqual(Object.keys(web).sort(), ESPACES_MOBILE.map((e) => e.id).sort());
  });

  for (const espace of ESPACES_MOBILE) {
    it(`espace « ${espace.id} » : toutes les rubriques Web sont dans le menu Mobile`, () => {
      const mobile = new Set(routesEspace(espace));
      const manquantes = (web[espace.id] ?? []).map((r) => EQUIVALENTS_WEB[r] ?? r).filter((r) => !mobile.has(r));
      assert.deepEqual(manquantes, []);
    });
    it(`espace « ${espace.id} » : chaque entrée du menu Mobile mène à un écran existant`, () => {
      assert.deepEqual(routesEspace(espace).filter((r) => !existe(r)), []);
    });
  }

  it('espace affiché : d’après l’écran courant, sinon d’après le rôle', () => {
    assert.equal(espaceCourant('/admin/users', 'app'), 'admin');
    assert.equal(espaceCourant('/organization/members', 'app'), 'organization');
    assert.equal(espaceCourant('/messages', 'organization'), 'organization');
    assert.equal(espaceCourant('/profil', 'app'), 'app');
  });
});
