import { WebSocket } from 'ws';

/**
 * Client Socket.IO v4 minimal pour les recettes (Engine.IO v4, transport
 * WebSocket), parlé directement sur `ws` : aucune dépendance ajoutée.
 *
 * Par défaut, la promesse se résout à l'événement `ready` (rooms chargées).
 * `immediat: true` la résout dès l'acceptation de la connexion.
 */
export const connecterSocket = (port, token, { immediat = false, delaiAck = 5000 } = {}) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime/?EIO=4&transport=websocket`);
    const attentes = new Map();
    const evenements = [];
    let prochainAck = 0;
    const client = {
      ferme: false,
      evenements,
      emit: (...args) => ws.send(`42${JSON.stringify(args)}`),
      emitAck: (...args) =>
        new Promise((res, rej) => {
          const id = ++prochainAck;
          const delai = setTimeout(() => rej(new Error(`pas d'accusé pour ${args[0]}`)), delaiAck);
          attentes.set(id, (valeur) => {
            clearTimeout(delai);
            res(valeur);
          });
          ws.send(`42${id}${JSON.stringify(args)}`);
        }),
      recus: (nom) => evenements.filter(([e]) => e === nom).map(([, p]) => p),
      fermer: () => ws.close(),
    };
    ws.on('message', (data) => {
      const t = data.toString();
      if (t === '2') return ws.send('3');
      if (t[0] === '0') return ws.send(`40${JSON.stringify({ token })}`);
      if (t.startsWith('40')) return immediat ? resolve(client) : undefined;
      if (t.startsWith('44')) return reject(new Error(t));
      if (t.startsWith('41')) {
        client.ferme = true;
        return undefined;
      }
      if (t.startsWith('43')) {
        const [, id, corps] = /^43(\d+)([\s\S]*)$/.exec(t);
        attentes.get(Number(id))?.(JSON.parse(corps)[0]);
        return undefined;
      }
      if (t.startsWith('42')) {
        const evenement = JSON.parse(t.slice(2));
        evenements.push(evenement);
        if (evenement[0] === 'ready' && !immediat) resolve(client);
      }
      return undefined;
    });
    ws.on('close', () => {
      client.ferme = true;
    });
    ws.on('error', reject);
  });
