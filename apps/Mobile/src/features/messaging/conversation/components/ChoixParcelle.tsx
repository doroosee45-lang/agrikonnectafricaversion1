import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, LoadingState, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { plotApi } from '@/services/api/endpoints';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

import { formatSurface, type Parcelle } from '../messageContent';

/**
 * Choix d'une de MES parcelles à partager. Seules les parcelles localisées
 * (latitude/longitude) peuvent l'être : la carte du fil en a besoin.
 */
export function ChoixParcelle({ visible, onFermer, onChoisir }: { visible: boolean; onFermer: () => void; onChoisir: (p: Parcelle) => void }) {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const insets = useSafeAreaInsets();
  const parcelles = useQuery({
    queryKey: ['plots', 'partage-messagerie'],
    queryFn: () => plotApi.list({ limit: 100 }).then((r) => r.data),
    enabled: visible,
    staleTime: 60_000,
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onFermer}>
      <View style={styles.voile}>
        <View style={[styles.feuille, { paddingBottom: insets.bottom + SPACING.md }]}>
          <View style={styles.entete}>
            <Text preset="h3">{fr ? 'Partager une parcelle' : 'Share a plot'}</Text>
            <Pressable onPress={onFermer} accessibilityRole="button" accessibilityLabel={fr ? 'Fermer' : 'Close'} hitSlop={10}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </Pressable>
          </View>
          {parcelles.isLoading ? (
            <LoadingState count={3} height={56} />
          ) : parcelles.isError ? (
            <ErrorState error={parcelles.error} onRetry={() => void parcelles.refetch()} />
          ) : (
            <FlatList
              data={parcelles.data ?? []}
              keyExtractor={(p) => p.id}
              ListEmptyComponent={<Text preset="bodySm" color={COLORS.slateGray}>{fr ? 'Aucune parcelle enregistrée.' : 'No plot yet.'}</Text>}
              renderItem={({ item }) => {
                const localisee = item.latitude != null && item.longitude != null;
                return (
                  <Pressable
                    disabled={!localisee}
                    onPress={() =>
                      onChoisir({ plotId: item.id, nom: item.name, surfaceHa: item.areaHa, lat: Number(item.latitude), lng: Number(item.longitude) })
                    }
                    accessibilityRole="button"
                    style={[styles.ligne, !localisee && styles.inactive]}
                  >
                    <Ionicons name="leaf" size={22} color={COLORS.forestGreen} />
                    <View style={styles.flex}>
                      <Text preset="bodyMedium">{item.name}</Text>
                      <Text preset="caption" color={COLORS.slateGray}>
                        {localisee ? formatSurface(item.areaHa) ?? (fr ? 'Surface inconnue' : 'Unknown area') : fr ? 'Sans position GPS : non partageable' : 'No GPS position: cannot share'}
                      </Text>
                    </View>
                    <Ionicons name="send" size={18} color={localisee ? COLORS.forestGreen : COLORS.slateGray} />
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  voile: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.25)' },
  feuille: { maxHeight: '70%', backgroundColor: COLORS.pureWhite, borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl, padding: SPACING.lg, gap: SPACING.md },
  entete: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.lightBorder },
  inactive: { opacity: 0.5 },
  flex: { flex: 1 },
});
