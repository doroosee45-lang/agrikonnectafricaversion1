import { Linking, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { FarmerHeader } from '@/components/farmer/FarmerHeader';
import { AuthGate, Button, Card, Chip, Divider, ErrorState, LoadingState, Screen, Section, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { API_BASE_URL } from '@/lib/config';
import { formatDate } from '@/lib/format';
import { lotApi } from '@/services/api/endpoints';
import type { PublicLot } from '@/services/api/types';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { SPACING } from '@/theme/space';
import { useState } from 'react';

export default function FarmerLotDetail() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { locale } = useI18n();
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const [qrError, setQrError] = useState<unknown>(null);
  const query = useQuery({
    queryKey: queryKeys.lots.one(id ?? ''),
    queryFn: () => lotApi.get(id ?? '').then((r) => r.data),
    enabled: isAuthenticated && Boolean(id),
    retry: false,
  });
  const lot = query.data;

  const openQrCode = async (code: string) => {
    try {
      const baseUrl = API_BASE_URL.replace(/\/+$/, '');
      await Linking.openURL(`${baseUrl}/public/lots/${encodeURIComponent(code)}/qr.png`);
      setQrError(null);
    } catch (error) {
      setQrError(error);
    }
  };

  return (
    <Screen background={COLORS.naturalWhite}>
      <FarmerHeader title={lot?.code ?? '—'} subtitle={t('ui.ficheDeTracabiliteDuLot')} />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title={t('ui.lot')} icon="pricetag-outline">
          <Button
            label={t('ui.mesLots')}
            icon="arrow-back"
            variant="ghost"
            onPress={() => router.replace('/farmer/lots')}
          />
          {query.isLoading ? <LoadingState count={1} height={120} /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !lot ? <Text preset="body">{t('ui.lotIntrouvable_704a3')}</Text> : (
            <>
              <Card tone="white" style={styles.card}>
                <View style={styles.field}>
                  <Text preset="caption" color={COLORS.slateGray}>{t('ui.code')}</Text>
                  <Text preset="bodyMedium" style={styles.monospace}>{lot.code}</Text>
                </View>
                <View style={styles.field}>
                  <Text preset="caption" color={COLORS.slateGray}>{t('ui.culture')}</Text>
                  <Text preset="bodySm">{lot.crop?.name ?? lot.crop?.slug ?? '—'}</Text>
                </View>
                <View style={styles.field}>
                  <Text preset="caption" color={COLORS.slateGray}>{t('ui.statut')}</Text>
                  <Chip label={lot.status} tone="neutral" size="sm" />
                </View>
                <View style={styles.field}>
                  <Text preset="caption" color={COLORS.slateGray}>{t('ui.creeLe')}</Text>
                  <Text preset="bodySm">{formatDate(lot.createdAt, locale)}</Text>
                </View>
              </Card>
              <Button label={t('ui.qrCode')} variant="outline" onPress={() => void openQrCode(lot.code)} />
              {qrError ? <ErrorState error={qrError} /> : null}
              <Button
                label={t('ui.fichePublique')}
                variant="ghost"
                onPress={() => router.push(`/public-site/lot/${encodeURIComponent(lot.code)}` as never)}
              />

              <View style={styles.detailSection}>
                <Text preset="overline" color={COLORS.slateGray}>{t('ui.chaineDeTracabilite')}</Text>
                <Card tone="pale" style={styles.card}>
                  <Text preset="bodySm" color={COLORS.slateGray}>
                    {lot.verification.certification === false ? t('ui.aucuneCertificationNEstAssocieeA') : lot.verification.note}
                  </Text>
                  <Divider />
                  <Text preset="caption" color={COLORS.slateGray}>{t('ui.journalDesEtapes')}</Text>
                  {lot.timeline.length === 0 ? (
                    <Text preset="bodySm">{t('ui.aucuneEtapeEnregistree')}</Text>
                  ) : (
                    <View style={styles.timeline}>
                      {lot.timeline.map((step, index) => (
                        <View key={`${step.type}-${index}`} style={styles.timelineRow}>
                          <Text preset="caption" color={COLORS.slateGray}>{formatDate(step.at, locale)}</Text>
                          <Text preset="bodySm">{step.type}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Card>
              </View>

              <View style={styles.detailSection}>
                <Text preset="overline" color={COLORS.slateGray}>{t('ui.divulgation')}</Text>
                <Card tone="white" style={styles.card}>
                  <Text preset="bodySm">{t('ui.regleAppliquee', { rule: lot.disclosure.rule })}</Text>
                  <View style={styles.field}>
                    <Text preset="caption" color={COLORS.slateGray}>{t('ui.champsMasques')}</Text>
                    <Text preset="bodySm">
                      {lot.disclosure.hiddenFields.length > 0 ? lot.disclosure.hiddenFields.join(', ') : t('ui.aucun')}
                    </Text>
                  </View>
                </Card>
              </View>
            </>
          )}
        </AuthGate>
      </Section>
    </Screen>
  );
}
const styles = StyleSheet.create({
  section: { paddingTop: SPACING.sm, paddingBottom: SPACING.xxl, gap: SPACING.md },
  card: { gap: SPACING.sm },
  field: { gap: 4 },
  detailSection: { gap: SPACING.sm },
  monospace: { fontFamily: 'monospace' },
  timeline: { gap: SPACING.sm },
  timelineRow: { gap: 2 },
});
