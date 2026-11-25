/**
 * Application d'un message reçu du serveur dans la base locale (synchronisation
 * différée) — logique PURE, sans import React Native : exécutée telle quelle par
 * `database.ts` (expo-sqlite) et par les recettes du backend (node:sqlite).
 *
 * OFF-4b : la fusion ne se faisait que sur `local_temp_id`. Un message envoyé par
 * le repli REST recevait un identifiant serveur différent de son identifiant
 * local ; au tirage suivant, il revenait avec `local_temp_id = id serveur`,
 * n'entrait pas en conflit sur `local_temp_id` et violait `UNIQUE(server_id)` :
 * toute l'application du delta échouait. On cherche désormais la ligne
 * existante par `server_id` OU par `local_temp_id`, et on la met à jour.
 */
import type { LocalMessage } from './models';

/** Accès SQL minimal (expo-sqlite : getFirstAsync / runAsync). */
export interface ExecuteurSql {
  premier<T>(sql: string, params: unknown[]): Promise<T | null | undefined>;
  executer(sql: string, params: unknown[]): Promise<unknown>;
}

export const SQL_TROUVER_LIGNE = 'SELECT local_temp_id FROM messages WHERE server_id = ? OR local_temp_id = ? LIMIT 1';

export const SQL_METTRE_A_JOUR =
  "UPDATE messages SET server_id = ?, content = ?, remote_media_url = ?, attachments = ?, read_by = ?, sync_status = 'SENT', updated_at = ?, deleted_at = ? WHERE local_temp_id = ?";

/** Insertion d'un message inconnu localement (requête reprise de database.ts). */
export const SQL_INSERER =
  `INSERT INTO messages (id, server_id, local_temp_id, room_id, sender_id, sender_org_id, type, content, local_media_uri, remote_media_url, attachments, read_by, sync_status, retry_count, error_message, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'SENT', 0, NULL, ?, ?, ?) ON CONFLICT(local_temp_id) DO UPDATE SET server_id = excluded.server_id, content = excluded.content, remote_media_url = excluded.remote_media_url, attachments = excluded.attachments, read_by = excluded.read_by, sync_status = 'SENT', updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`;

/** Identifiant serveur d'un message reçu. */
export const cleServeur = (m: Pick<LocalMessage, 'server_id' | 'id'>): string => m.server_id ?? m.id;

/** Applique un message serveur : mise à jour de la ligne existante, sinon insertion. */
export async function appliquerMessageServeur(db: ExecuteurSql, m: LocalMessage): Promise<'maj' | 'insertion'> {
  const serveur = cleServeur(m);
  const existante = await db.premier<{ local_temp_id: string }>(SQL_TROUVER_LIGNE, [serveur, m.local_temp_id || serveur]);
  if (existante) {
    await db.executer(SQL_METTRE_A_JOUR, [
      serveur,
      m.content,
      m.remote_media_url ?? null,
      JSON.stringify(m.attachments ?? []),
      JSON.stringify(m.read_by ?? []),
      m.updated_at,
      m.deleted_at ?? null,
      existante.local_temp_id,
    ]);
    return 'maj';
  }
  await db.executer(SQL_INSERER, [
    m.id,
    serveur,
    m.local_temp_id || serveur,
    m.room_id,
    m.sender_id,
    m.sender_org_id,
    m.type ?? 'TEXT',
    m.content,
    m.remote_media_url ?? null,
    JSON.stringify(m.attachments ?? []),
    JSON.stringify(m.read_by ?? []),
    m.created_at,
    m.updated_at,
    m.deleted_at ?? null,
  ]);
  return 'insertion';
}

/** Variante mémoire (Web) : clé locale de la ligne déjà présente, sinon null. */
export function cleLocaleExistante(messages: Iterable<LocalMessage>, m: LocalMessage): string | null {
  const serveur = cleServeur(m);
  for (const local of messages) {
    if (local.server_id === serveur || local.local_temp_id === (m.local_temp_id || serveur)) return local.local_temp_id;
  }
  return null;
}
