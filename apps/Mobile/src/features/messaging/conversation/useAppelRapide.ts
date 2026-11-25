import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { callsApi } from '@/features/calls/callsApi';
import { useCalls } from '@/features/calls/useCalls';
import { useI18n } from '@/i18n';

/**
 * Appel vocal en un geste depuis l'en-tête ou une carte « Appel manqué ».
 * Conversation 1-à-1 avec une seule personne joignable : appel direct.
 * Plusieurs personnes : choix rapide. Le serveur revérifie tout.
 */
export function useAppelRapide(conversationId: string) {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const disponible = useCalls((s) => s.disponible);
  const phase = useCalls((s) => s.phase);
  const appeler = useCalls((s) => s.appeler);
  const [prepare, setPrepare] = useState(false);
  const occupe = prepare || !['idle', 'ended', 'error'].includes(phase);

  const lancer = useCallback(async () => {
    if (!disponible) {
      Alert.alert(
        fr ? 'Appels indisponibles' : 'Calls unavailable',
        fr
          ? 'Les appels audio ne sont pas disponibles sur cet appareil (build sans module d’appel) ou sur le serveur.'
          : 'Audio calls are not available on this device (build without the call module) or on the server.',
      );
      return;
    }
    if (occupe) return;
    setPrepare(true);
    try {
      const { data } = await callsApi.eligible(conversationId);
      if (!data.callable || data.people.length === 0) {
        Alert.alert(fr ? 'Appel impossible' : 'Cannot call', fr ? 'Aucune personne joignable dans cette conversation.' : 'Nobody can be reached in this conversation.');
        return;
      }
      if (data.people.length === 1) {
        await appeler(conversationId, [data.people[0].userId]);
        return;
      }
      Alert.alert(
        fr ? 'Appeler' : 'Call',
        undefined,
        [
          ...data.people.slice(0, 4).map((p) => ({
            text: `${p.name ?? '—'} · ${p.organizationName}`,
            onPress: () => void appeler(conversationId, [p.userId]),
          })),
          { text: fr ? 'Annuler' : 'Cancel', style: 'cancel' as const },
        ],
      );
    } catch {
      Alert.alert(fr ? 'Appel impossible' : 'Cannot call', fr ? 'Vérifie ta connexion et réessaie.' : 'Check your connection and try again.');
    } finally {
      setPrepare(false);
    }
  }, [appeler, conversationId, disponible, fr, occupe]);

  return { lancer, disponible, occupe };
}
