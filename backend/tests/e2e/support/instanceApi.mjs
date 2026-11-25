/**
 * Serveur API dans un PROCESSUS séparé, pour les recettes d'interruption
 * (arrêt brutal pendant une transaction). Il hérite de l'environnement du banc
 * (même base embarquée, même faux GoTrue). Écrit `PORT=<n>` une fois prêt.
 */
const { createApp } = await import('../../../src/app.js');
const serveur = createApp().listen(0, '127.0.0.1', () => {
  process.stdout.write(`PORT=${serveur.address().port}\n`);
});
