import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { SPACING } from '@/theme/space';

import type { CallErrorCode, CallPhase } from './callMachine';
import type { CallStatus } from './types';
import { useCalls } from './useCalls';

const MESSAGE_ERREUR: Record<CallErrorCode, TranslationKey> = {
  microphone: 'ui.appelErreurMicroAppareil',
  network: 'ui.appelErreurReseau',
  unavailable: 'ui.appelErreurIndisponible',
  generic: 'ui.appelErreurGenerique',
};

const MESSAGE_FIN: Partial<Record<CallStatus, TranslationKey>> = {
  MISSED: 'ui.appelManque',
  DECLINED: 'ui.appelRefuse',
  CANCELLED: 'ui.appelAnnule',
};

/** Durée « m:ss » (ou « h:mm:ss ») depuis la prise de l'appel (horloge du serveur). */
export const dureeAppel = (depuis: string | null, maintenant: number) => {
  if (!depuis) return '0:00';
  const s = Math.max(0, Math.floor((maintenant - new Date(depuis).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

const initiales = (nom: string) =>
  nom
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** Halo animé autour de l'avatar pendant la sonnerie et la connexion. */
function Halo({ actif }: { actif: boolean }) {
  const anneaux = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    if (!actif) {
      anneaux.forEach((a) => a.setValue(0));
      return undefined;
    }
    const boucles = anneaux.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 900),
          Animated.timing(a, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    boucles.forEach((b) => b.start());
    return () => boucles.forEach((b) => b.stop());
  }, [actif, anneaux]);
  return (
    <>
      {anneaux.map((a, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            styles.anneau,
            {
              opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
              transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
            },
          ]}
        />
      ))}
    </>
  );
}

function BoutonRond({
  icone,
  libelle,
  onPress,
  couleur,
  couleurIcone = COLORS.pureWhite,
  taille = 66,
  desactive = false,
  actif = false,
  rotation = 0,
}: {
  icone: keyof typeof Ionicons.glyphMap;
  libelle: string;
  onPress: () => void;
  couleur: string;
  couleurIcone?: string;
  taille?: number;
  desactive?: boolean;
  actif?: boolean;
  /** Combiné raccroché : icône « call » tournée de 135°. */
  rotation?: number;
}) {
  return (
    <View style={styles.bouton}>
      <Pressable
        onPress={onPress}
        disabled={desactive}
        accessibilityRole="button"
        accessibilityLabel={libelle}
        accessibilityState={{ disabled: desactive, selected: actif }}
        style={({ pressed }) => [
          { width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur },
          styles.boutonRond,
          pressed && styles.appuye,
          desactive && styles.desactive,
        ]}
      >
        <Ionicons name={icone} size={taille * 0.42} color={couleurIcone} style={rotation ? { transform: [{ rotate: `${rotation}deg` }] } : undefined} />
      </Pressable>
      <Text preset="caption" color="rgba(255,255,255,0.85)" style={styles.libelle} numberOfLines={1}>
        {libelle}
      </Text>
    </View>
  );
}

/**
 * Écran d'appel PLEIN ÉCRAN (monté à la racine) : avatar et nom, état
 * (sonnerie, connexion, en cours avec durée, reconnexion, fin, erreur),
 * micro coupé/actif, raccrocher. Les boutons pilotent le magasin `useCalls`
 * (LiveKit réel : `setMicrophoneEnabled`, `leave/cancel` + `disconnect`).
 * Rien n'est rendu tant que les appels ne sont pas disponibles.
 */
export function CallOverlay() {
  const { t, locale } = useI18n();
  const fr = locale !== 'en';
  const insets = useSafeAreaInsets();
  const authentifie = useAuthStore((state) => state.status === 'authenticated');
  const { phase, call, muted, error, endStatus, demarrer, arreter, accepter, refuser, raccrocher, basculerMicro, fermer } = useCalls();
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [action, setAction] = useState<null | 'accepter' | 'refuser' | 'raccrocher' | 'micro'>(null);

  useEffect(() => {
    if (authentifie) void demarrer();
    else arreter();
  }, [authentifie, demarrer, arreter]);

  useEffect(() => {
    if (phase !== 'in_call' && phase !== 'reconnecting') return undefined;
    setMaintenant(Date.now());
    const minuteur = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(minuteur);
  }, [phase]);

  if (phase === 'idle' || (!call && phase !== 'error')) return null;

  const executer = (cle: NonNullable<typeof action>, fn: () => Promise<void>) => {
    if (action) return;
    setAction(cle);
    void fn().finally(() => setAction(null));
  };

  const hote = call?.participants.find((p) => p.isHost);
  const autres = call?.participants.filter((p) => !p.isHost) ?? [];
  const interlocuteur = call?.me?.isHost
    ? autres.map((p) => p.name ?? t('ui.appelAudio')).join(', ')
    : hote?.name ?? t('ui.appelAudio');

  const etat: Record<CallPhase, string> = {
    incoming: t('ui.appelEntrant'),
    outgoing: t('ui.appelSonnerie'),
    connecting: t('ui.appelConnexion'),
    in_call: dureeAppel(call?.startedAt ?? null, maintenant),
    reconnecting: t('ui.appelReconnexion'),
    ended: t(MESSAGE_FIN[endStatus ?? 'ENDED'] ?? 'ui.appelTermine'),
    error: t(MESSAGE_ERREUR[error ?? 'generic']),
    idle: '',
  };
  const enCommunication = ['outgoing', 'connecting', 'in_call', 'reconnecting'].includes(phase);
  const sonne = phase === 'incoming' || phase === 'outgoing' || phase === 'connecting';
  const termine = phase === 'ended' || phase === 'error';

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <StatusBar style="light" />
      <LinearGradient colors={['#0B2A1E', '#124C34', '#0E3A29']} style={[styles.ecran, { paddingTop: insets.top + SPACING.lg, paddingBottom: insets.bottom + SPACING.xl }]}>
        <View style={styles.entete}>
          <Ionicons name="lock-closed" size={13} color="rgba(255,255,255,0.7)" />
          <Text preset="caption" color="rgba(255,255,255,0.75)">{t('ui.appelAudio')}</Text>
        </View>

        <View style={styles.centre} accessibilityLiveRegion="assertive">
          <View style={styles.avatarZone}>
            <Halo actif={sonne} />
            <View style={styles.avatar}>
              {call && call.participants.length > 2 ? (
                <Ionicons name="people" size={56} color={COLORS.forestGreen} />
              ) : (
                <Text preset="display" color={COLORS.forestGreen} style={styles.initiales}>{initiales(interlocuteur)}</Text>
              )}
            </View>
          </View>
          <Text preset="h1" color={COLORS.pureWhite} style={styles.nom} numberOfLines={2}>{interlocuteur}</Text>
          <View style={styles.etat}>
            {phase === 'connecting' || phase === 'reconnecting' ? <ActivityIndicator size="small" color="rgba(255,255,255,0.85)" /> : null}
            {phase === 'in_call' ? <View style={styles.pointDirect} /> : null}
            <Text
              preset={phase === 'in_call' ? 'h3' : 'body'}
              color={phase === 'error' ? '#FFC9C2' : 'rgba(255,255,255,0.9)'}
              style={phase === 'in_call' ? styles.duree : styles.etatTexte}
            >
              {etat[phase]}
            </Text>
          </View>
          {call && call.participants.length > 2 ? (
            <Text preset="caption" color="rgba(255,255,255,0.7)">{t('ui.appelParticipants', { count: call.participants.length })}</Text>
          ) : null}
          {muted && enCommunication ? (
            <View style={styles.puceMuet} accessibilityLabel={fr ? 'Votre micro est coupé' : 'Your microphone is muted'}>
              <Ionicons name="mic-off" size={14} color="#0B2A1E" />
              <Text preset="caption" color="#0B2A1E">{fr ? 'Micro coupé : on ne vous entend pas' : 'Muted: they can’t hear you'}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.commandes}>
          {phase === 'incoming' ? (
            <View style={styles.ligne}>
              <BoutonRond
                icone="close"
                libelle={t('ui.appelRefuser')}
                couleur="#E5484D"
                taille={74}
                desactive={Boolean(action)}
                onPress={() => executer('refuser', refuser)}
              />
              <BoutonRond
                icone="call"
                libelle={t('ui.appelRepondre')}
                couleur="#2BB673"
                taille={74}
                desactive={Boolean(action)}
                onPress={() => executer('accepter', accepter)}
              />
            </View>
          ) : null}

          {enCommunication ? (
            <View style={styles.ligne}>
              <BoutonRond
                icone={muted ? 'mic-off' : 'mic'}
                libelle={muted ? t('ui.appelActiverMicro') : t('ui.appelCouperMicro')}
                couleur={muted ? COLORS.pureWhite : 'rgba(255,255,255,0.16)'}
                couleurIcone={muted ? '#0B2A1E' : COLORS.pureWhite}
                actif={muted}
                desactive={Boolean(action) || phase === 'connecting'}
                onPress={() => executer('micro', basculerMicro)}
              />
              <BoutonRond
                icone="call"
                libelle={t('ui.appelRaccrocher')}
                couleur="#E5484D"
                taille={76}
                rotation={135}
                desactive={action === 'raccrocher'}
                onPress={() => executer('raccrocher', raccrocher)}
              />
            </View>
          ) : null}

          {termine ? (
            <View style={styles.ligne}>
              <BoutonRond icone="close" libelle={t('ui.appelFermer')} couleur="rgba(255,255,255,0.16)" onPress={fermer} />
            </View>
          ) : null}

          <Text preset="caption" color="rgba(255,255,255,0.55)" style={styles.securite}>{t('ui.appelChiffrementTransport')}</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, justifyContent: 'space-between', paddingHorizontal: SPACING.xl },
  entete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  centre: { alignItems: 'center', gap: SPACING.md },
  avatarZone: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  anneau: { position: 'absolute', width: 132, height: 132, borderRadius: 66, backgroundColor: 'rgba(255,255,255,0.35)' },
  avatar: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: '#E6F3EC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  initiales: { fontSize: 46, lineHeight: 54 },
  nom: { textAlign: 'center' },
  etat: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 28 },
  etatTexte: { textAlign: 'center' },
  duree: { fontVariant: ['tabular-nums'], letterSpacing: 1 },
  pointDirect: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3DDC84' },
  puceMuet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.pureWhite,
    borderRadius: 999,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    marginTop: SPACING.sm,
  },
  commandes: { gap: SPACING.xl, alignItems: 'center' },
  ligne: { flexDirection: 'row', justifyContent: 'space-evenly', alignSelf: 'stretch' },
  bouton: { alignItems: 'center', gap: SPACING.sm, width: 110 },
  boutonRond: { alignItems: 'center', justifyContent: 'center' },
  appuye: { transform: [{ scale: 0.94 }], opacity: 0.9 },
  desactive: { opacity: 0.5 },
  libelle: { textAlign: 'center' },
  securite: { textAlign: 'center', maxWidth: 320 },
});
