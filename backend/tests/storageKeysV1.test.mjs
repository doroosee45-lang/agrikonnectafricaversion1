import './helpers/pinTestEnv.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estCleStockageConforme,
  estCleDeLOrganisation,
  nouvelleCleStockage,
  prefixeStockage,
} from '../src/shared/storageKeys.js';
import { ALLOWED_MIME } from '../src/modules/media/media.schema.js';

/**
 * A3 — grammaire unique des clés de stockage (shared/storageKeys.js).
 * Unitaire, sans base : TESTÉ.
 */

const ORG = '01M89499P24N5GXEJ4EBC2T8AC';
const AUTRE = '01M8949A58DY2JTP0EYCDRX2NJ';
const U = '0b6f1d2e-3c4a-4b5d-8e6f-7a8b9c0d1e2f';

test('A3 — toute clé générée par le serveur est conforme, pour chaque type MIME autorisé', () => {
  for (const extension of new Set(Object.values(ALLOWED_MIME))) {
    for (const categorie of ['media', 'documents']) {
      const cle = nouvelleCleStockage(ORG, categorie, extension);
      assert.ok(estCleStockageConforme(cle), cle);
      assert.ok(estCleDeLOrganisation(cle, ORG), cle);
      assert.equal(estCleDeLOrganisation(cle, AUTRE), false, cle);
    }
  }
});

test('A3 — variantes malveillantes ou mal formées : toutes refusées', () => {
  const refusees = [
    `${ORG}/../${AUTRE}/documents/2026-11/${U}.pdf`,
    `${ORG}/media/../../${AUTRE}/documents/2026-11/${U}.pdf`,
    `../${ORG}/media/2026-11/${U}.jpg`,
    `./${ORG}/media/2026-11/${U}.jpg`,
    `${ORG}//media/2026-11/${U}.jpg`,
    `${ORG}/media/2026-11//${U}.jpg`,
    `${ORG}/autre/2026-11/${U}.jpg`,
    `${ORG}/media/2026-13/${U}.jpg`,
    `${ORG}/media/2026-11/photo.jpg`,
    `${ORG}/media/2026-11/${U}`,
    `${ORG}/media/2026-11/${U}.jpg%2e%2e`,
    `${ORG}\\media\\2026-11\\${U}.jpg`,
    `https://exemple.cd/${ORG}/media/2026-11/${U}.jpg`,
    '',
    123,
    null,
  ];
  for (const cle of refusees) assert.equal(estCleStockageConforme(cle), false, JSON.stringify(cle));
});

test('A3 — le préfixe d’organisation garde le même assainissement que `storageKey`', () => {
  assert.equal(prefixeStockage(ORG), `${ORG}/`);
  assert.equal(prefixeStockage('org avec/espace'), 'org_avec_espace/');
});
