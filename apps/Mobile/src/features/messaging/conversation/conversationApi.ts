import { localDb } from '@/db/database';
import type { LocalMessage } from '@/db/models';
import { api } from '@/services/api/http';

import type { AppelFil } from './timeline';

/**
 * Accès serveur de l'écran de discussion. Tout ce qui est reçu est écrit dans
 * la base locale (source unique de l'affichage) : l'écran fonctionne de la
 * même façon hors ligne, avec les dernières données connues.
 */

export interface MessageServeur {
  id: string;
  conversationId: string;
  senderId: string;
  senderOrgId: string;
  body: string;
  attachments: string[];
  readBy: string[];
  createdAt: string;
  /** URL signées de courte durée (affichage seulement). */
  attachmentUrls?: (string | null)[];
}

export interface Interlocuteur {
  organizationId: string;
  name: string;
  type: string;
  countryCode: string | null;
  slug: string | null;
  roles: string[];
  avatarUrl: string | null;
  memberSince: string | null;
}

export interface FicheConversation {
  conversationId: string;
  isGroup: boolean;
  peers: Interlocuteur[];
}

/* ───────── URL signées des médias (mémoire, durée de vie courte) ───────── */

const DUREE_URL_MS = 45 * 60 * 1000;
const urlsSignees = new Map<string, { urls: (string | null)[]; expire: number }>();

export function urlSigneePour(serverId: string | null, index = 0): string | null {
  if (!serverId) return null;
  const entree = urlsSignees.get(serverId);
  if (!entree || entree.expire < Date.now()) return null;
  return entree.urls[index] ?? null;
}

/* ───────── conversion ───────── */

export function versMessageLocal(m: MessageServeur): LocalMessage {
  const t = Date.parse(m.createdAt);
  return {
    id: m.id,
    server_id: m.id,
    local_temp_id: m.id,
    room_id: m.conversationId,
    sender_id: m.senderId,
    sender_org_id: m.senderOrgId,
    type: 'TEXT',
    content: m.body,
    local_media_uri: null,
    remote_media_url: m.attachments?.[0] ?? null,
    attachments: m.attachments ?? [],
    read_by: m.readBy ?? [],
    sync_status: 'SENT',
    retry_count: 0,
    error_message: null,
    created_at: t,
    updated_at: t,
    deleted_at: null,
  };
}

/**
 * Page du fil (la plus récente, ou avant `before`). Effets serveur : marque
 * les messages comme LUS et prévient l'expéditeur (`message:read`).
 * Écrit les messages en base locale et mémorise leurs URL signées.
 */
export async function tirerPageServeur(conversationId: string, before?: string): Promise<{ hasMore: boolean; nextCursor: string | null; recus: MessageServeur[] }> {
  const r = await api.get<{ messages: MessageServeur[] }>(`/messaging/conversations/${conversationId}/messages`, {
    params: { limit: 50, ...(before ? { before } : {}) },
  });
  const messages = r.data.messages ?? [];
  const expire = Date.now() + DUREE_URL_MS;
  for (const m of messages) {
    if (m.attachmentUrls?.length) urlsSignees.set(m.id, { urls: m.attachmentUrls, expire });
  }
  await localDb.applyServerDelta({ created: messages.map(versMessageLocal) });
  const meta = r.meta as { hasMore?: boolean; nextCursor?: string | null } | undefined;
  return { hasMore: Boolean(meta?.hasMore), nextCursor: meta?.nextCursor ?? null, recus: messages };
}

/* ───────── interlocuteurs et appels (mis en cache local pour le hors-ligne) ───────── */

const lireCache = async <T,>(cle: string): Promise<T | null> => {
  try {
    const brut = await localDb.getMeta(cle);
    return brut ? (JSON.parse(brut) as T) : null;
  } catch {
    return null;
  }
};

export async function chargerFiche(conversationId: string): Promise<FicheConversation | null> {
  const cle = `peers:${conversationId}`;
  try {
    const r = await api.get<FicheConversation>(`/messaging/conversations/${conversationId}/peers`);
    await localDb.setMeta(cle, JSON.stringify(r.data));
    return r.data;
  } catch {
    return lireCache<FicheConversation>(cle);
  }
}

export const ficheEnCache = (conversationId: string) => lireCache<FicheConversation>(`peers:${conversationId}`);

export async function chargerAppels(conversationId: string): Promise<AppelFil[]> {
  const cle = `calls:${conversationId}`;
  try {
    const r = await api.get<AppelFil[]>('/calls/history', { params: { conversationId } });
    await localDb.setMeta(cle, JSON.stringify(r.data ?? []));
    return r.data ?? [];
  } catch {
    return (await lireCache<AppelFil[]>(cle)) ?? [];
  }
}

export const appelsEnCache = async (conversationId: string) => (await lireCache<AppelFil[]>(`calls:${conversationId}`)) ?? [];

/* ───────── libellés ───────── */

const METIERS: Record<string, [string, string]> = {
  FARMER: ['Agriculteur', 'Farmer'],
  AGRONOMIST: ['Agronome', 'Agronomist'],
  RESEARCHER: ['Chercheur', 'Researcher'],
  STUDENT: ['Étudiant', 'Student'],
  PROFESSOR: ['Enseignant', 'Lecturer'],
  COOPERATIVE_ADMIN: ['Coopérative', 'Cooperative'],
  COOPERATIVE_MEMBER: ['Membre de coopérative', 'Cooperative member'],
  AGRICULTURAL_COMPANY: ['Entreprise agricole', 'Agricultural company'],
  BUYER: ['Acheteur', 'Buyer'],
  SUPPLIER: ['Fournisseur', 'Supplier'],
  TRANSPORTER: ['Transporteur', 'Transporter'],
  LAB_PARTNER: ['Laboratoire', 'Laboratory'],
};

export const libelleMetier = (role: string, locale: 'fr' | 'en') => METIERS[role]?.[locale === 'fr' ? 0 : 1] ?? null;
