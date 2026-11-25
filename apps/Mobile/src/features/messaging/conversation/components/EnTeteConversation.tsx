import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppImage, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

import { libelleMetier, type FicheConversation } from '../conversationApi';
import type { Presence } from '../useConversation';

const initiales = (nom: string) =>
  nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase() ?? '')
    .join('') || '?';

function libellePresence(presence: Presence | null, fr: boolean): string | null {
  if (!presence) return null;
  if (presence.enLigne) return fr ? 'En ligne' : 'Online';
  if (!presence.vuA) return fr ? 'Hors ligne' : 'Offline';
  const vu = new Date(presence.vuA);
  const heure = `${String(vu.getHours()).padStart(2, '0')}:${String(vu.getMinutes()).padStart(2, '0')}`;
  const aujourdhui = new Date().toDateString() === vu.toDateString();
  return fr ? `Vu ${aujourdhui ? 'aujourd’hui' : 'récemment'} à ${heure}` : `Last seen ${aujourdhui ? 'today' : 'recently'} at ${heure}`;
}

interface Props {
  conversationId: string;
  titreDeRepli: string;
  fiche: FicheConversation | null;
  presence: Presence | null;
  ecrit: boolean;
  onAppelVocal: () => void;
  appelOccupe: boolean;
}

/**
 * En-tête fixe : retour · avatar et nom (→ fiche contact) · présence ou
 * « en train d'écrire… » · appel vocal (prioritaire) · appel vidéo (secondaire).
 */
export function EnTeteConversation({ conversationId, titreDeRepli, fiche, presence, ecrit, onAppelVocal, appelOccupe }: Props) {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const insets = useSafeAreaInsets();
  const pair = fiche?.peers[0] ?? null;
  const nom = fiche?.isGroup ? titreDeRepli : pair?.name ?? titreDeRepli;
  const metier = pair?.roles.map((r) => libelleMetier(r, fr ? 'fr' : 'en')).find(Boolean) ?? null;
  const sousTitre = ecrit
    ? fr ? 'en train d’écrire…' : 'typing…'
    : [libellePresence(presence, fr), metier].filter(Boolean).join(' · ') || (fr ? 'Discussion' : 'Conversation');

  const appelVideo = () =>
    Alert.alert(
      fr ? 'Appel vidéo' : 'Video call',
      fr
        ? 'L’appel vidéo arrivera dans une prochaine version. Utilise l’appel vocal, plus léger sur le réseau.'
        : 'Video calls are coming in a later version. Use a voice call, lighter on the network.',
    );

  return (
    <View style={[styles.racine, { paddingTop: insets.top + SPACING.xs }]}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages' as never))}
        accessibilityRole="button"
        accessibilityLabel={fr ? 'Retour aux discussions' : 'Back to conversations'}
        hitSlop={10}
        style={styles.retour}
      >
        <Ionicons name="arrow-back" size={24} color={COLORS.pureWhite} />
      </Pressable>

      <Pressable
        onPress={() => router.push(`/messages/contact/${encodeURIComponent(conversationId)}` as never)}
        accessibilityRole="button"
        accessibilityLabel={`${nom}. ${sousTitre}. ${fr ? 'Ouvrir la fiche' : 'Open profile'}`}
        style={styles.identite}
      >
        <View style={styles.avatar}>
          {pair?.avatarUrl ? (
            <AppImage uri={pair.avatarUrl} style={styles.avatarImage} radius={RADIUS.pill} />
          ) : (
            <Text preset="bodyMedium" color={COLORS.forestGreen}>{initiales(nom)}</Text>
          )}
          {presence?.enLigne ? <View style={styles.pastille} /> : null}
        </View>
        <View style={styles.textes}>
          <Text preset="bodyMedium" color={COLORS.pureWhite} numberOfLines={1}>{nom}</Text>
          <Text preset="caption" color={ecrit ? '#A7F3C5' : 'rgba(255,255,255,0.8)'} numberOfLines={1}>{sousTitre}</Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onAppelVocal}
        disabled={appelOccupe}
        accessibilityRole="button"
        accessibilityLabel={fr ? 'Appel vocal' : 'Voice call'}
        hitSlop={8}
        style={[styles.action, appelOccupe && styles.inactif]}
      >
        <Ionicons name="call" size={22} color={COLORS.pureWhite} />
      </Pressable>
      <Pressable onPress={appelVideo} accessibilityRole="button" accessibilityLabel={fr ? 'Appel vidéo (bientôt)' : 'Video call (soon)'} hitSlop={8} style={[styles.action, styles.inactif]}>
        <Ionicons name="videocam-outline" size={23} color={COLORS.pureWhite} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  racine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.forestGreen,
    paddingHorizontal: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  retour: { padding: SPACING.xs },
  identite: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.paleGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: 40, height: 40 },
  pastille: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#3DDC84',
    borderWidth: 2,
    borderColor: COLORS.forestGreen,
  },
  textes: { flex: 1 },
  action: { padding: SPACING.sm },
  inactif: { opacity: 0.55 },
});
