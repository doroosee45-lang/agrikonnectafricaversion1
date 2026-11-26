import { memo, useEffect, useRef } from 'react';
import { Alert, Animated, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppImage, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

import { urlSigneePour } from '../conversationApi';
import { formatDuree, lireDureeNoteVocale, lireParcelle, lirePosition, typeAffichage } from '../messageContent';
import type { AppelFil, EtatLivraison, MessageFil } from '../timeline';
import { CarteParcelle, CartePosition } from './CartesMetier';
import { LecteurNoteVocale } from './LecteurNoteVocale';

/* ─────────────── séparateur de jour ─────────────── */

export function SeparateurJour({ libelle }: { libelle: string }) {
  return (
    <View style={styles.jour} accessibilityRole="header">
      <Text preset="caption" color={COLORS.slateGray} style={styles.jourTexte}>{libelle}</Text>
    </View>
  );
}

/* ─────────────── coches ─────────────── */

function Coches({ etat, mien }: { etat: EtatLivraison; mien: boolean }) {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const clair = mien ? 'rgba(255,255,255,0.85)' : COLORS.slateGray;
  const conf: Record<EtatLivraison, { icone: keyof typeof Ionicons.glyphMap; couleur: string; a11y: string }> = {
    PENDING: { icone: 'time-outline', couleur: clair, a11y: fr ? 'En attente' : 'Pending' },
    FAILED: { icone: 'alert-circle', couleur: '#FFD7D2', a11y: fr ? 'Échec de l’envoi' : 'Not sent' },
    SENT: { icone: 'checkmark', couleur: clair, a11y: fr ? 'Envoyé' : 'Sent' },
    DELIVERED: { icone: 'checkmark-done', couleur: clair, a11y: fr ? 'Reçu' : 'Delivered' },
    READ: { icone: 'checkmark-done', couleur: '#7CE3A8', a11y: fr ? 'Lu' : 'Read' },
  };
  const c = conf[etat];
  return <Ionicons name={c.icone} size={15} color={c.couleur} accessibilityLabel={c.a11y} />;
}

/* ─────────────── bulle de message ─────────────── */

interface BulleProps {
  message: MessageFil;
  mien: boolean;
  etat: EtatLivraison;
  heure: string;
  suiteDuPrecedent: boolean;
  onRenvoyer: (localTempId: string) => void;
  onImage: (uri: string) => void;
}

function BulleBrute({ message, mien, etat, heure, suiteDuPrecedent, onRenvoyer, onImage }: BulleProps) {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const type = typeAffichage(message);
  const couleurTexte = mien ? COLORS.pureWhite : COLORS.textPrimary;
  // Source d'un média : fichier local d'abord (hors ligne), sinon URL signée.
  const sourceMedia = message.local_media_uri ?? urlSigneePour(message.server_id);

  let contenu: React.ReactNode;
  switch (type) {
    case 'IMAGE':
      contenu = (
        <Pressable onPress={() => sourceMedia && onImage(sourceMedia)} accessibilityRole="imagebutton" accessibilityLabel={fr ? 'Photo' : 'Photo'}>
          <AppImage uri={sourceMedia} style={styles.image} radius={RADIUS.lg} fallbackLabel={fr ? 'Photo' : 'Photo'} />
        </Pressable>
      );
      break;
    case 'AUDIO':
      contenu = <LecteurNoteVocale source={sourceMedia} dureeSec={lireDureeNoteVocale(message.content)} mien={mien} />;
      break;
    case 'DOCUMENT': {
      const nom = message.content.replace(/^📄\s*/, '');
      const ext = /\.([A-Za-z0-9]{2,5})$/.exec(nom)?.[1]?.toUpperCase() ?? 'FICHIER';
      // Ouverture par l'URL signée https (lecteur PDF, navigateur, lecteur vidéo).
      // Un fichier local (file://) n'est pas ouvrable par une autre application
      // sur Android : tant qu'il n'est pas envoyé, on l'explique.
      const urlDistante = urlSigneePour(message.server_id);
      const ouvrir = () => {
        if (urlDistante) {
          void Linking.openURL(urlDistante).catch(() =>
            Alert.alert(fr ? 'Ouverture impossible' : 'Cannot open', fr ? 'Aucune application ne peut ouvrir ce fichier.' : 'No app can open this file.'),
          );
          return;
        }
        Alert.alert(
          nom,
          message.sync_status === 'SENT'
            ? fr ? 'Le lien du fichier se charge, réessaie dans un instant.' : 'The file link is loading, try again shortly.'
            : fr ? 'Le fichier sera disponible dès son envoi.' : 'The file will be available once sent.',
        );
      };
      contenu = (
        <Pressable onPress={ouvrir} accessibilityRole="link" accessibilityLabel={`${fr ? 'Ouvrir' : 'Open'} ${nom}`} style={styles.document}>
          <View style={[styles.docIcone, { backgroundColor: mien ? 'rgba(255,255,255,0.18)' : '#FDECEA' }]}>
            <Ionicons name={ext === 'MP4' ? 'videocam' : 'document-text'} size={22} color={mien ? COLORS.pureWhite : COLORS.error} />
          </View>
          <View style={styles.flex}>
            <Text preset="bodySm" color={couleurTexte} numberOfLines={2}>{nom}</Text>
            <Text preset="caption" color={mien ? 'rgba(255,255,255,0.75)' : COLORS.slateGray}>
              {ext} · {urlDistante ? (fr ? 'Toucher pour ouvrir' : 'Tap to open') : message.sync_status === 'SENT' ? '…' : fr ? 'En attente d’envoi' : 'Waiting to send'}
            </Text>
          </View>
          <Ionicons name="open-outline" size={18} color={couleurTexte} />
        </Pressable>
      );
      break;
    }
    case 'LOCATION': {
      const position = lirePosition(message.content);
      contenu = position ? <CartePosition position={position} mien={mien} /> : null;
      break;
    }
    case 'PARCEL': {
      const parcelle = lireParcelle(message.content);
      contenu = parcelle ? <CarteParcelle parcelle={parcelle} mien={mien} /> : null;
      break;
    }
    default:
      contenu = <Text preset="body" color={couleurTexte} selectable>{message.content}</Text>;
  }

  return (
    <View style={[styles.rangee, mien ? styles.droite : styles.gauche, suiteDuPrecedent ? styles.serre : null]}>
      <View
        style={[
          styles.bulle,
          mien ? styles.bulleMienne : styles.bulleRecue,
          !suiteDuPrecedent && (mien ? styles.queueDroite : styles.queueGauche),
        ]}
      >
        {contenu}
        <View style={styles.pied}>
          <Text preset="caption" color={mien ? 'rgba(255,255,255,0.8)' : COLORS.slateGray} style={styles.heure}>{heure}</Text>
          {mien ? <Coches etat={etat} mien={mien} /> : null}
        </View>
      </View>
      {mien && etat === 'FAILED' ? (
        <Pressable onPress={() => onRenvoyer(message.local_temp_id)} accessibilityRole="button" style={styles.renvoyer}>
          <Ionicons name="refresh" size={14} color={COLORS.error} />
          <Text preset="caption" color={COLORS.error}>{fr ? 'Non envoyé · Renvoyer' : 'Not sent · Retry'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const Bulle = memo(
  BulleBrute,
  (a, b) =>
    a.message === b.message && a.etat === b.etat && a.suiteDuPrecedent === b.suiteDuPrecedent && a.heure === b.heure,
);

/* ─────────────── carte d'appel ─────────────── */

export function CarteAppel({ appel, heure, onRappeler }: { appel: AppelFil; heure: string; onRappeler?: () => void }) {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const manque = appel.status === 'MISSED' || (appel.status !== 'ENDED' && !appel.outgoing);
  const sansReponse = !manque && appel.status !== 'ENDED';
  const titre = manque
    ? fr ? 'Appel vocal manqué' : 'Missed voice call'
    : sansReponse
      ? fr ? 'Appel vocal sans réponse' : 'Unanswered voice call'
      : appel.outgoing
        ? fr ? 'Appel vocal sortant' : 'Outgoing voice call'
        : fr ? 'Appel vocal entrant' : 'Incoming voice call';
  const detail = appel.status === 'ENDED' && appel.durationSec > 0 ? `${formatDuree(appel.durationSec)} · ${heure}` : heure;
  return (
    <View style={styles.appelRangee}>
      <View style={[styles.appel, manque && styles.appelManque]}>
        <Ionicons
          name={manque ? 'call' : appel.outgoing ? 'arrow-up-circle' : 'arrow-down-circle'}
          size={20}
          color={manque ? COLORS.error : COLORS.forestGreen}
        />
        <View style={styles.flex}>
          <Text preset="bodyMedium" color={manque ? COLORS.error : COLORS.textPrimary}>{titre}</Text>
          <Text preset="caption" color={COLORS.slateGray}>{detail}</Text>
        </View>
        {onRappeler ? (
          <Pressable onPress={onRappeler} accessibilityRole="button" accessibilityLabel={fr ? 'Rappeler' : 'Call back'} style={styles.rappel}>
            <Ionicons name="call" size={16} color={COLORS.pureWhite} />
            <Text preset="caption" color={COLORS.pureWhite}>{fr ? 'Rappeler' : 'Call back'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/* ─────────────── « en train d'écrire… » ─────────────── */

export function IndicateurFrappe({ visible }: { visible: boolean }) {
  const { locale } = useI18n();
  const opacite = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    if (!visible) return undefined;
    const boucle = Animated.loop(
      Animated.sequence([
        Animated.timing(opacite, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(opacite, { toValue: 0.3, duration: 500, useNativeDriver: true }),
      ]),
    );
    boucle.start();
    return () => boucle.stop();
  }, [visible, opacite]);
  if (!visible) return null;
  return (
    <View style={[styles.rangee, styles.gauche]} accessibilityLiveRegion="polite">
      <Animated.View style={[styles.bulle, styles.bulleRecue, styles.frappe, { opacity: opacite }]}>
        <Text preset="bodySm" color={COLORS.slateGray}>{locale === 'en' ? 'typing…' : 'en train d’écrire…'}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  jour: { alignItems: 'center', marginVertical: SPACING.md },
  jourTexte: {
    backgroundColor: COLORS.pureWhite,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.lightBorder,
  },
  rangee: { paddingHorizontal: SPACING.md, marginTop: SPACING.sm },
  serre: { marginTop: 2 },
  droite: { alignItems: 'flex-end' },
  gauche: { alignItems: 'flex-start' },
  bulle: { maxWidth: '82%', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: 6, borderRadius: RADIUS.xl, gap: 4 },
  bulleMienne: { backgroundColor: COLORS.forestGreen },
  bulleRecue: { backgroundColor: COLORS.pureWhite, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lightBorder },
  queueDroite: { borderBottomRightRadius: 4 },
  queueGauche: { borderBottomLeftRadius: 4 },
  pied: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  heure: { fontSize: 11 },
  image: { width: 220, height: 220 },
  document: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minWidth: 220 },
  docIcone: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  renvoyer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  appelRangee: { alignItems: 'center', marginTop: SPACING.sm, paddingHorizontal: SPACING.md },
  appel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.pureWhite,
    borderRadius: RADIUS.xl,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.lightBorder,
    minWidth: 260,
  },
  appelManque: { borderColor: 'rgba(180,35,24,0.35)' },
  rappel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.forestGreen,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
  },
  frappe: { paddingBottom: SPACING.sm },
});
