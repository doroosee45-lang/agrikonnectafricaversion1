import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { cheminPourNotification, contenuPremierPlan } from '../src/services/pushRoutage.ts';

describe('notifications push — écran ouvert au clic', () => {
  it('message : ouvre la conversation (identifiant encodé)', () => {
    assert.equal(cheminPourNotification({ type: 'MESSAGE_NEW', conversationId: 'conv 1' }), '/messages/conv%201');
  });
  it('appel : jamais traité ici (features/calls)', () => {
    assert.equal(cheminPourNotification({ genre: 'APPEL_ENTRANT', conversationId: 'c' }), null);
  });
  it('test : reste sur l’écran courant ; autre type : boîte de notifications', () => {
    assert.equal(cheminPourNotification({ type: 'PUSH_TEST' }), null);
    assert.equal(cheminPourNotification({ type: 'ALERT_THRESHOLD' }), '/notifications');
    assert.equal(cheminPourNotification(null), null);
  });
});

describe('notifications push — affichage au premier plan', () => {
  it('notification FCM : titre et corps repris', () => {
    assert.deepEqual(contenuPremierPlan({ notification: { title: 'Bonjour', body: 'Test' } }), { titre: 'Bonjour', corps: 'Test' });
  });
  it('message de données avec titre : affiché ; sans titre ni corps : ignoré', () => {
    assert.deepEqual(contenuPremierPlan({ data: { title: 'T', body: 'B' } }), { titre: 'T', corps: 'B' });
    assert.equal(contenuPremierPlan({ data: { type: 'SYNC' } }), null);
  });
  it('push d’appel : jamais affiché en bannière', () => {
    assert.equal(contenuPremierPlan({ notification: { title: 'Appel' }, data: { genre: 'APPEL_ENTRANT' } }), null);
  });
});
