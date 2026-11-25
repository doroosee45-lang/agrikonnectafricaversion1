/**
 * Seconde instance temps réel, dans un PROCESSUS séparé, pour les recettes
 * multi-instances. Elle hérite de l'environnement du banc (même base embarquée,
 * même faux GoTrue) et n'a aucun canal commun avec la première instance : pas
 * d'adaptateur Socket.IO partagé, comme en production aujourd'hui.
 *
 * Écrit `PORT=<n>` sur la sortie standard une fois prête.
 * Variable : INSTANCE_FILET_MS (intervalle du filet de révocation).
 */
import http from 'node:http';

const { attachRealtime } = await import('../../../src/realtime/index.js');
const serveur = http.createServer();
await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
attachRealtime(serveur, { intervalleFiletMs: Number(process.env.INSTANCE_FILET_MS ?? 60_000) });
process.stdout.write(`PORT=${serveur.address().port}\n`);

process.on('SIGTERM', () => process.exit(0));
