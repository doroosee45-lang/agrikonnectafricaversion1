/**
 * Règles PURES des notifications push (sans module natif) : testées sous Node
 * (tests/push-notifications.test.mts).
 */

/** Genres réservés aux appels audio : traités par `features/calls`, jamais affichés ici. */
const GENRES_APPEL = new Set(['APPEL_ENTRANT', 'APPEL_TERMINE']);

export type DonneesPush = Record<string, string | undefined>;

export interface MessagePush {
  messageId?: string;
  notification?: { title?: string; body?: string } | null;
  data?: DonneesPush;
}

/** Écran à ouvrir pour une notification (pur, testé). `null` = rester où l'on est. */
export function cheminPourNotification(donnees: DonneesPush | undefined | null): string | null {
  if (!donnees) return null;
  if (donnees.genre && GENRES_APPEL.has(donnees.genre)) return null;
  if (donnees.conversationId) return `/messages/${encodeURIComponent(donnees.conversationId)}`;
  if (donnees.type === 'PUSH_TEST') return null;
  return '/notifications';
}

/** Titre et corps à afficher au premier plan (pur, testé). `null` = ne rien afficher. */
export function contenuPremierPlan(message: MessagePush): { titre: string; corps: string } | null {
  if (message.data?.genre && GENRES_APPEL.has(message.data.genre)) return null;
  const titre = message.notification?.title ?? message.data?.title;
  const corps = message.notification?.body ?? message.data?.body ?? '';
  if (!titre && !corps) return null;
  return { titre: titre ?? 'AgriKonnect', corps };
}
