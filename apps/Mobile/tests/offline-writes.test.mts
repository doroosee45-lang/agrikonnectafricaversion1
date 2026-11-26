import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classerReponse, delaiProchainEssai, pretes, resumeFile, type EcritureEnAttente } from '../src/services/fileEcritures.ts';

const e = (o: Partial<EcritureEnAttente> & { id: string; creeLe: number }): EcritureEnAttente => ({
  methode: 'POST', url: '/plots', corps: {}, cleIdempotence: `k-${o.id}`, libelle: o.id, invalider: [], tentatives: 0, prochainEssai: 0, ...o,
});

describe('écritures hors ligne — file d’attente', () => {
  it('réponses : succès envoyé ; réseau, 409 en cours, 429, 5xx réessayés ; validation refusée définitivement', () => {
    assert.equal(classerReponse(201), 'envoyee');
    for (const s of [0, 408, 409, 429, 500, 503]) assert.equal(classerReponse(s), 'reessayer', String(s));
    for (const s of [400, 401, 403, 404, 422]) assert.equal(classerReponse(s), 'refusee', String(s));
  });
  it('ordre FIFO, refus définitifs et essais futurs exclus', () => {
    const file = [
      e({ id: 'c', creeLe: 3 }),
      e({ id: 'a', creeLe: 1 }),
      e({ id: 'refus', creeLe: 0, refusDefinitif: true }),
      e({ id: 'plus-tard', creeLe: 2, prochainEssai: 10_000 }),
    ];
    assert.deepEqual(pretes(file, 5_000).map((x) => x.id), ['a', 'c']);
    assert.deepEqual(resumeFile(file), { enAttente: 3, refusees: 1, total: 4 });
  });
  it('délai de nouvel essai croissant et plafonné', () => {
    assert.equal(delaiProchainEssai(1), 5_000);
    assert.equal(delaiProchainEssai(3), 20_000);
    assert.equal(delaiProchainEssai(50), 600_000);
  });
});
