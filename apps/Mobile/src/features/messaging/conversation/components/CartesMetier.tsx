import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, Path, Pattern, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

import { formatSurface, urlCarte, type Parcelle, type Position } from '../messageContent';

/**
 * Cartes métier du fil (position GPS, parcelle). Aperçu VECTORIEL dessiné sur
 * l'appareil : aucun fond de carte téléchargé (données mobiles, hors ligne).
 * Le toucher ouvre l'application Cartes du téléphone, ou la fiche parcelle.
 */
function MiniCarte({ mien, precision }: { mien: boolean; precision?: boolean }) {
  const trait = mien ? 'rgba(255,255,255,0.25)' : 'rgba(18,76,52,0.14)';
  const fond = mien ? 'rgba(255,255,255,0.10)' : '#EEF4EF';
  return (
    <Svg width="100%" height={110}>
      <Defs>
        <Pattern id="grille" width={22} height={22} patternUnits="userSpaceOnUse">
          <Line x1={0} y1={0} x2={22} y2={0} stroke={trait} strokeWidth={1} />
          <Line x1={0} y1={0} x2={0} y2={22} stroke={trait} strokeWidth={1} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height={110} fill={fond} />
      <Rect x={0} y={0} width="100%" height={110} fill="url(#grille)" />
      <Path d="M0 78 C 60 60, 120 96, 400 70" stroke={mien ? 'rgba(255,255,255,0.35)' : 'rgba(23,50,77,0.18)'} strokeWidth={6} fill="none" />
      {precision ? <Circle cx="50%" cy={50} r={26} fill="rgba(208,138,51,0.18)" stroke="rgba(208,138,51,0.6)" /> : null}
      <Circle cx="50%" cy={50} r={9} fill="#D08A33" stroke="#FFFFFF" strokeWidth={3} />
    </Svg>
  );
}

const ouvrirCartes = (lat: number, lng: number, libelle: string) => {
  const etiquette = encodeURIComponent(libelle);
  const natif = Platform.select({
    ios: `maps://?q=${etiquette}&ll=${lat},${lng}`,
    android: `geo:${lat},${lng}?q=${lat},${lng}(${etiquette})`,
  });
  void (natif ? Linking.openURL(natif).catch(() => Linking.openURL(urlCarte(lat, lng))) : Linking.openURL(urlCarte(lat, lng)));
};

export function CartePosition({ position, mien }: { position: Position; mien: boolean }) {
  const { locale } = useI18n();
  const couleur = mien ? COLORS.pureWhite : COLORS.textPrimary;
  const libelle = locale === 'fr' ? 'Position partagée' : 'Shared location';
  return (
    <Pressable
      onPress={() => ouvrirCartes(position.lat, position.lng, libelle)}
      accessibilityRole="link"
      accessibilityLabel={`${libelle}, ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`}
      style={styles.carte}
    >
      <MiniCarte mien={mien} precision={Boolean(position.precisionM)} />
      <View style={styles.legende}>
        <Ionicons name="location" size={16} color={mien ? COLORS.pureWhite : COLORS.forestGreen} />
        <View style={styles.flex}>
          <Text preset="bodyMedium" color={couleur}>{libelle}</Text>
          <Text preset="caption" color={mien ? 'rgba(255,255,255,0.8)' : COLORS.slateGray}>
            {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            {position.precisionM ? ` · ±${position.precisionM} m` : ''}
          </Text>
        </View>
        <Ionicons name="open-outline" size={16} color={mien ? COLORS.pureWhite : COLORS.slateGray} />
      </View>
    </Pressable>
  );
}

export function CarteParcelle({ parcelle, mien }: { parcelle: Parcelle; mien: boolean }) {
  const { locale } = useI18n();
  const couleur = mien ? COLORS.pureWhite : COLORS.textPrimary;
  const secondaire = mien ? 'rgba(255,255,255,0.8)' : COLORS.slateGray;
  const surface = formatSurface(parcelle.surfaceHa);
  // Ma parcelle : fiche complète. Parcelle d'un autre : la fiche n'est pas
  // accessible (autre organisation) → position sur la carte.
  const ouvrir = () =>
    mien
      ? router.push(`/farmer/plots/${encodeURIComponent(parcelle.plotId)}` as never)
      : ouvrirCartes(parcelle.lat, parcelle.lng, parcelle.nom);
  return (
    <Pressable onPress={ouvrir} accessibilityRole="link" accessibilityLabel={`${locale === 'fr' ? 'Parcelle' : 'Plot'} ${parcelle.nom}`} style={styles.carte}>
      <MiniCarte mien={mien} />
      <View style={styles.legende}>
        <Ionicons name="leaf" size={16} color={mien ? COLORS.pureWhite : COLORS.forestGreen} />
        <View style={styles.flex}>
          <Text preset="bodyMedium" color={couleur} numberOfLines={1}>{parcelle.nom}</Text>
          <Text preset="caption" color={secondaire} numberOfLines={1}>
            {[surface, parcelle.culture].filter(Boolean).join(' · ') || (locale === 'fr' ? 'Parcelle' : 'Plot')}
          </Text>
        </View>
        <Ionicons name={mien ? 'chevron-forward' : 'open-outline'} size={16} color={secondaire} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  carte: { width: 240, borderRadius: RADIUS.lg, overflow: 'hidden' },
  legende: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingTop: SPACING.sm },
  flex: { flex: 1 },
});
