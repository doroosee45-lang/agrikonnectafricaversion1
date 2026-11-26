import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  corpsDocument,
  corpsNoteVocale,
  corpsParcelle,
  corpsPhoto,
  corpsPosition,
  formatDuree,
  lireDureeNoteVocale,
  lireParcelle,
  lirePosition,
  mimeDepuisNom,
  typeAffichage,
} from '../src/features/messaging/conversation/messageContent.ts';
import { aAcquitter, construireFil, etatLivraison, libelleJour, type MessageFil } from '../src/features/messaging/conversation/timeline.ts';

const message = (o: Partial<MessageFil> & { created_at: number }): MessageFil => ({
  local_temp_id: `l-${o.created_at}`,
  server_id: `s-${o.created_at}`,
  sender_id: 'moi',
  content: 'bonjour',
  attachments: [],
  local_media_uri: null,
  read_by: [],
  sync_status: 'SENT',
  ...o,
});

describe('messagerie — contenus métier lisibles partout', () => {
  it('position : texte lisible + lien carte, relu à l’identique', () => {
    const corps = corpsPosition({ lat: -4.321704, lng: 15.312498, precisionM: 12.4 });
    assert.equal(corps, '📍 Position partagée (±12 m)\nhttps://maps.google.com/?q=-4.32170,15.31250');
    assert.deepEqual(lirePosition(corps), { lat: -4.3217, lng: 15.3125, precisionM: 12 });
    assert.throws(() => corpsPosition({ lat: 120, lng: 0 }));
  });
  it('parcelle : nom, surface, culture et identifiant relus ; sans identifiant ce n’est pas une parcelle', () => {
    const corps = corpsParcelle({ plotId: 'plot_ABC123', nom: 'Champ Nord', surfaceHa: 2.5, culture: 'Maïs', lat: 5.1, lng: -3.9 });
    assert.match(corps, /^🌱 Parcelle : Champ Nord — 2,50 ha \(Maïs\)\nhttps:\/\/maps\.google\.com\/\?q=5\.10000,-3\.90000&ak_plot=plot_ABC123$/);
    assert.deepEqual(lireParcelle(corps), { plotId: 'plot_ABC123', nom: 'Champ Nord', surfaceHa: 2.5, culture: 'Maïs', lat: 5.1, lng: -3.9 });
    assert.equal(lireParcelle('🌱 Parcelle : X\nhttps://maps.google.com/?q=1,2'), null);
  });
  it('note vocale, photo, document', () => {
    assert.equal(corpsNoteVocale(72_400), '🎤 Note vocale (1:12)');
    assert.equal(lireDureeNoteVocale('🎤 Note vocale (1:12)'), 72);
    assert.equal(corpsPhoto(), '📷 Photo');
    assert.equal(corpsDocument('  rapport.pdf '), '📄 rapport.pdf');
    assert.equal(formatDuree(3725), '1:02:05');
  });
  it('type d’affichage : extension de la pièce jointe, puis contenu métier', () => {
    assert.equal(typeAffichage({ content: '📷 Photo', attachments: ['org/media/2026-11/a.jpg'] }), 'IMAGE');
    assert.equal(typeAffichage({ content: '🎤', attachments: [], local_media_uri: 'file:///x/rec.m4a' }), 'AUDIO');
    assert.equal(typeAffichage({ content: '📄 a.pdf', attachments: ['org/documents/2026-11/a.pdf'] }), 'DOCUMENT');
    assert.equal(typeAffichage({ content: corpsPosition({ lat: 1, lng: 2 }) }), 'LOCATION');
    assert.equal(typeAffichage({ content: 'https://maps.google.com/?q=1,2 sans pictogramme' }), 'TEXT');
  });
  it('types MIME acceptés par le serveur', () => {
    assert.equal(mimeDepuisNom('photo.JPG'), 'image/jpeg');
    assert.equal(mimeDepuisNom('note.m4a'), 'audio/mp4');
    assert.equal(mimeDepuisNom('archive.zip'), null);
  });
});

describe('messagerie — fil (FlatList inversée)', () => {
  const maintenant = new Date(2026, 10, 25, 15, 0).getTime();
  const hier = new Date(2026, 10, 24, 9, 30).getTime();

  it('séparateurs de jour au-dessus de chaque jour ; élément 0 = le plus récent', () => {
    const fil = construireFil(
      [message({ created_at: hier }), message({ created_at: maintenant - 60_000, sender_id: 'autre' }), message({ created_at: maintenant - 30_000, sender_id: 'autre' })],
      [],
      { moi: 'moi', maintenant },
    );
    assert.deepEqual(fil.map((e) => e.kind), ['message', 'message', 'jour', 'message', 'jour']);
    assert.equal(fil[2].kind === 'jour' && fil[2].libelle, "Aujourd'hui");
    assert.equal(fil[4].kind === 'jour' && fil[4].libelle, 'Hier');
    assert.equal(fil[0].kind === 'message' && fil[0].suiteDuPrecedent, true, 'même expéditeur < 2 min : bulle groupée');
    assert.equal(fil[0].kind === 'message' && fil[0].mien, false);
  });
  it('appels intercalés à leur date', () => {
    const fil = construireFil(
      [message({ created_at: maintenant - 120_000 }), message({ created_at: maintenant - 10_000 })],
      [{ id: 'c1', status: 'MISSED', outgoing: false, createdAt: new Date(maintenant - 60_000).toISOString(), durationSec: 0 }],
      { moi: 'moi', maintenant },
    );
    assert.deepEqual(fil.map((e) => e.kind), ['message', 'appel', 'message', 'jour']);
  });
  it('coches : en attente, échec, envoyé, reçu, lu', () => {
    const recus = new Set(['s-2']);
    assert.equal(etatLivraison(message({ created_at: 1, sync_status: 'PENDING' }), 'moi', recus), 'PENDING');
    assert.equal(etatLivraison(message({ created_at: 1, sync_status: 'UPLOADING' }), 'moi', recus), 'PENDING');
    assert.equal(etatLivraison(message({ created_at: 1, sync_status: 'FAILED' }), 'moi', recus), 'FAILED');
    assert.equal(etatLivraison(message({ created_at: 1 }), 'moi', recus), 'SENT');
    assert.equal(etatLivraison(message({ created_at: 2 }), 'moi', recus), 'DELIVERED');
    assert.equal(etatLivraison(message({ created_at: 2, read_by: ['moi'] }), 'moi', recus), 'DELIVERED', 'ma propre lecture ne compte pas');
    assert.equal(etatLivraison(message({ created_at: 3, read_by: ['autre'] }), 'moi', recus), 'READ');
  });
  it('ordre stable entre deux messages de la même milliseconde', () => {
    const a = message({ created_at: 5, local_temp_id: 'a' });
    const b = message({ created_at: 5, local_temp_id: 'b' });
    assert.deepEqual(construireFil([b, a], [], { moi: 'moi', maintenant }).filter((e) => e.kind === 'message').map((e) => e.key), ['b', 'a']);
  });
  it('libellés de date et accusés à envoyer', () => {
    assert.equal(libelleJour(new Date(2025, 0, 3).getTime(), maintenant, 'fr'), '3 janvier 2025');
    assert.deepEqual(aAcquitter([message({ created_at: 1, sender_id: 'autre' }), message({ created_at: 2 }), message({ created_at: 3, sender_id: 'autre', server_id: null })], 'moi'), ['s-1']);
  });
});

import { preparerFichier } from '../src/features/messaging/conversation/messageContent.ts';

describe('messagerie — bouton « Fichier » (sélecteur natif)', () => {
  it('type annoncé par le système prioritaire ; extension ajoutée si le nom n’en a pas (Android content://)', () => {
    assert.deepEqual(preparerFichier('Rapport sol', 'application/pdf'), { nom: 'Rapport sol.pdf', mime: 'application/pdf', genre: 'DOCUMENT' });
    assert.deepEqual(preparerFichier('IMG_2026.JPG', 'image/jpeg'), { nom: 'IMG_2026.JPG', mime: 'image/jpeg', genre: 'IMAGE' });
    assert.deepEqual(preparerFichier('visite.mp4', 'video/mp4'), { nom: 'visite.mp4', mime: 'video/mp4', genre: 'DOCUMENT' });
    assert.deepEqual(preparerFichier('memo.mp3', 'audio/mpeg'), { nom: 'memo.mp3', mime: 'audio/mpeg', genre: 'AUDIO' });
  });
  it('type système absent ou générique : repli sur l’extension', () => {
    assert.deepEqual(preparerFichier('fiche.pdf', 'application/octet-stream'), { nom: 'fiche.pdf', mime: 'application/pdf', genre: 'DOCUMENT' });
    assert.deepEqual(preparerFichier('photo.png', null), { nom: 'photo.png', mime: 'image/png', genre: 'IMAGE' });
  });
  it('formats refusés par le serveur : null (message « format non accepté »)', () => {
    assert.equal(preparerFichier('contrat.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), null);
    assert.equal(preparerFichier('archive.zip', 'application/zip'), null);
    assert.equal(preparerFichier(null, null), null);
  });
});
