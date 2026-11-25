import { Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';
import { SHADOWS } from '@/theme/shadows';

/**
 * Éléments VISUELS partagés par la liste des discussions et l'annuaire des
 * contacts de la messagerie (aucune logique métier).
 */

/* ───────── avatar à initiales ───────── */

/** Paires fond / texte de la palette de marque (contrastes AA). */
const TEINTES = [
  { fond: '#E6F3EC', texte: '#124C34' },
  { fond: '#F0E2CC', texte: '#6E4C1D' },
  { fond: '#E4EEF8', texte: '#17324D' },
  { fond: '#EDE7F6', texte: '#4A2F7A' },
  { fond: '#FDEBDD', texte: '#8A3A10' },
  { fond: '#E0F2F1', texte: '#0F5148' },
] as const;

const teinte = (cle: string) => {
  let h = 0;
  for (let i = 0; i < cle.length; i += 1) h = (h * 31 + cle.charCodeAt(i)) >>> 0;
  return TEINTES[h % TEINTES.length];
};

export const initiales = (nom: string) =>
  nom
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join('') || '?';

export function AvatarContact({
  nom,
  cle,
  uri,
  taille = 52,
  groupe = false,
  selectionne = false,
}: {
  nom: string;
  cle?: string;
  uri?: string | null;
  taille?: number;
  groupe?: boolean;
  selectionne?: boolean;
}) {
  const t = teinte(cle ?? nom);
  const rond = { width: taille, height: taille, borderRadius: taille / 2 };
  return (
    <View style={[rond, styles.avatar, { backgroundColor: t.fond }]}>
      {uri ? (
        <Image source={{ uri }} style={rond} accessibilityIgnoresInvertColors />
      ) : groupe ? (
        <Ionicons name="people" size={taille * 0.46} color={t.texte} />
      ) : (
        <Text preset="bodyMedium" color={t.texte} style={{ fontSize: taille * 0.36, lineHeight: taille * 0.44 }}>
          {initiales(nom)}
        </Text>
      )}
      {selectionne ? (
        <View style={styles.coche}>
          <Ionicons name="checkmark" size={12} color={COLORS.pureWhite} />
        </View>
      ) : null}
    </View>
  );
}

/* ───────── recherche ───────── */

export function BarreRecherche({ valeur, onChange, placeholder }: { valeur: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={styles.recherche}>
      <Ionicons name="search" size={18} color={COLORS.slateGray} />
      <TextInput
        value={valeur}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.slateGray}
        style={styles.rechercheTexte}
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel={placeholder}
      />
      {valeur.length > 0 ? (
        <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Effacer">
          <Ionicons name="close-circle" size={18} color={COLORS.slateGray} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ───────── onglets segmentés ───────── */

export function Onglets<K extends string>({
  valeur,
  onChange,
  options,
}: {
  valeur: K;
  onChange: (k: K) => void;
  options: ReadonlyArray<{ cle: K; libelle: string; icone?: keyof typeof Ionicons.glyphMap; compteur?: number }>;
}) {
  return (
    <View style={styles.onglets} accessibilityRole="tablist">
      {options.map((o) => {
        const actif = o.cle === valeur;
        return (
          <Pressable
            key={o.cle}
            onPress={() => onChange(o.cle)}
            accessibilityRole="tab"
            accessibilityState={{ selected: actif }}
            style={[styles.onglet, actif && styles.ongletActif]}
          >
            {o.icone ? <Ionicons name={o.icone} size={15} color={actif ? COLORS.forestGreen : COLORS.slateGray} /> : null}
            <Text preset="caption" color={actif ? COLORS.forestGreen : COLORS.slateGray} style={styles.ongletTexte} numberOfLines={1}>
              {o.libelle}
            </Text>
            {o.compteur ? (
              <View style={[styles.compteur, actif && styles.compteurActif]}>
                <Text preset="caption" color={actif ? COLORS.pureWhite : COLORS.forestGreen} style={styles.compteurTexte}>
                  {o.compteur > 99 ? '99+' : String(o.compteur)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ───────── pastille de non-lus ───────── */

export function PastilleNonLus({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <View style={styles.pastille} accessibilityLabel={`${n} non lu${n > 1 ? 's' : ''}`}>
      <Text preset="caption" color={COLORS.pureWhite} style={styles.pastilleTexte}>{n > 99 ? '99+' : String(n)}</Text>
    </View>
  );
}

/* ───────── formats d'affichage ───────── */

/** Heure de liste : « 14:32 », « Hier », « lun. », « 03/11/26 ». */
export function heureListe(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const maintenant = new Date();
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86_400_000);
  const fr = locale !== 'en';
  if (ecart === 0) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (ecart === 1) return fr ? 'Hier' : 'Yesterday';
  if (ecart > 1 && ecart < 7) return d.toLocaleDateString(fr ? 'fr-FR' : 'en-GB', { weekday: 'short' });
  return d.toLocaleDateString(fr ? 'fr-FR' : 'en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Drapeau emoji d'un code pays ISO (« CD » → 🇨🇩). */
export function drapeau(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const TYPES_ORG: Record<string, [string, string]> = {
  INDIVIDUAL: ['Individuel', 'Individual'],
  COOPERATIVE: ['Coopérative', 'Cooperative'],
  COMPANY: ['Entreprise', 'Company'],
};

export const libelleTypeOrg = (type: string | null | undefined, locale: string) =>
  type ? TYPES_ORG[type]?.[locale === 'en' ? 1 : 0] ?? null : null;

/** Aperçu du dernier message : pictogramme selon le contenu (note vocale, photo, document, position…). */
export function apercuMessage(corps: string | null | undefined): { icone: keyof typeof Ionicons.glyphMap | null; texte: string } {
  const t = (corps ?? '').trim();
  if (t.startsWith('🎤')) return { icone: 'mic', texte: t.replace(/^🎤\s*/, '') };
  if (t.startsWith('📷')) return { icone: 'camera', texte: t.replace(/^📷\s*/, '') };
  if (t.startsWith('📄')) return { icone: 'document-text', texte: t.replace(/^📄\s*/, '') };
  if (t.startsWith('📍')) return { icone: 'location', texte: t.split('\n')[0].replace(/^📍\s*/, '') };
  if (t.startsWith('🌱')) return { icone: 'leaf', texte: t.split('\n')[0].replace(/^🌱\s*/, '') };
  return { icone: null, texte: t.replace(/\s+/g, ' ') };
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  coche: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.forestGreen,
    borderWidth: 2,
    borderColor: COLORS.pureWhite,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recherche: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    height: 46,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.pureWhite,
    borderWidth: 1,
    borderColor: COLORS.lightBorder,
    ...SHADOWS.hairline,
  },
  rechercheTexte: { flex: 1, fontSize: 15, color: COLORS.textPrimary, paddingVertical: 0 },
  onglets: {
    flexDirection: 'row',
    backgroundColor: '#EAF0EB',
    borderRadius: RADIUS.pill,
    padding: 4,
    gap: 4,
  },
  onglet: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.pill,
  },
  ongletActif: { backgroundColor: COLORS.pureWhite, ...SHADOWS.card },
  ongletTexte: { fontWeight: '600', fontSize: 13 },
  compteur: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18,76,52,0.10)' },
  compteurActif: { backgroundColor: COLORS.forestGreen },
  compteurTexte: { fontSize: 11, fontWeight: '700', lineHeight: 14 },
  pastille: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    backgroundColor: COLORS.livingGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pastilleTexte: { fontSize: 11, fontWeight: '700', lineHeight: 14 },
});
