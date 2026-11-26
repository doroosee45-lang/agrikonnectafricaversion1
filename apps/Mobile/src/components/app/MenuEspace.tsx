import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ESPACES_MOBILE, type IdEspace } from '@/lib/space-nav';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

/**
 * Menu d'espace MOBILE = barre latérale Web du même espace (lib/space-nav.ts) :
 * mêmes groupes, mêmes entrées, mêmes sous-entrées. Ouvert depuis la barre du
 * bas (« Menu »). Les droits restent appliqués par le serveur et par chaque écran.
 */
export function MenuEspace({ espace, visible, onFermer }: { espace: IdEspace; visible: boolean; onFermer: () => void }) {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const insets = useSafeAreaInsets();
  const chemin = usePathname();
  const def = ESPACES_MOBILE.find((e) => e.id === espace);
  if (!def) return null;
  const aller = (route: string) => {
    onFermer();
    router.push(route as never);
  };
  const texte = (x: { fr: string; en: string }) => (fr ? x.fr : x.en);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <Pressable style={styles.voile} onPress={onFermer} accessibilityRole="button" accessibilityLabel={fr ? 'Fermer le menu' : 'Close menu'}>
        <Pressable style={[styles.feuille, { paddingBottom: insets.bottom + SPACING.md }]} onPress={() => undefined}>
          <View style={styles.poignee} />
          <Text preset="h3" color={COLORS.forestGreen}>{texte(def.titre)}</Text>
          <ScrollView contentContainerStyle={styles.liste} showsVerticalScrollIndicator={false}>
            {def.groupes.map((groupe) => (
              <View key={groupe.titre.fr} style={styles.groupe}>
                <Text preset="caption" color={COLORS.slateGray} style={styles.titreGroupe}>{texte(groupe.titre).toUpperCase()}</Text>
                {groupe.items.map((item) => (
                  <View key={item.route + item.libelle.fr}>
                    <Pressable
                      onPress={() => aller(item.route)}
                      accessibilityRole="link"
                      style={({ pressed }) => [styles.ligne, chemin === item.route && styles.actif, pressed && styles.appuye]}
                    >
                      <Ionicons name={(item.icone ?? 'ellipse-outline') as keyof typeof Ionicons.glyphMap} size={20} color={COLORS.forestGreen} />
                      <Text preset="bodyMedium" color={COLORS.textPrimary} style={styles.flex}>{texte(item.libelle)}</Text>
                      <Ionicons name="chevron-forward" size={16} color={COLORS.slateGray} />
                    </Pressable>
                    {(item.enfants ?? [])
                      .filter((enfant) => enfant.route !== item.route)
                      .map((enfant) => (
                        <Pressable
                          key={enfant.route}
                          onPress={() => aller(enfant.route)}
                          accessibilityRole="link"
                          style={({ pressed }) => [styles.sousLigne, chemin === enfant.route && styles.actif, pressed && styles.appuye]}
                        >
                          <Text preset="bodySm" color={COLORS.textPrimary}>{texte(enfant.libelle)}</Text>
                        </Pressable>
                      ))}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  voile: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  feuille: { maxHeight: '82%', backgroundColor: COLORS.pureWhite, borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.sm },
  poignee: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.lightBorder, marginBottom: SPACING.sm },
  liste: { gap: SPACING.md, paddingBottom: SPACING.md },
  groupe: { gap: 2 },
  titreGroupe: { letterSpacing: 0.6, marginBottom: SPACING.xs },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.lg },
  sousLigne: { paddingVertical: SPACING.sm, paddingLeft: 52, paddingRight: SPACING.sm, borderRadius: RADIUS.md },
  actif: { backgroundColor: '#E6F3EC' },
  appuye: { backgroundColor: '#F2F8F4' },
  flex: { flex: 1 },
});
