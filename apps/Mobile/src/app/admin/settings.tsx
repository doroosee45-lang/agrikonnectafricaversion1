import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { AppHeader } from '@/components/app/AppHeader';
import { AuthGate, Button, Card, EmptyState, ErrorState, LoadingState, Reveal, Screen, Section, Text } from '@/components/ui';
import { adminApi } from '@/services/api/endpoints';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { SPACING } from '@/theme/space';
import { useI18n } from '@/i18n';

/** ADMIN — paramètres plateforme (lecture ; l'écriture passe par PUT /admin/settings). */
export default function AdminSettings() {
  const { t, locale } = useI18n();
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const canAccessSettings = useAuthStore((state) => state.can('admin.settings'));

  const settings = useQuery({
    queryKey: [...queryKeys.admin.dashboard({}), 'settings'],
    queryFn: () => adminApi.settings().then((result) => result.data),
    enabled: isAuthenticated && canAccessSettings,
  });

  const entries = Object.entries((settings.data ?? {}) as Record<string, unknown>);

  return (
    <Screen background={COLORS.naturalWhite}>
      <AppHeader title={t('ui.parametres_ef8f0')} subtitle={t('ui.valeursServiesParGetAdminSettings')} />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title={t('ui.parametres_ef8f0')} icon="settings-outline">
          {canAccessSettings ? (
            <Button
              label={locale === 'fr' ? 'Paramètres du compte' : 'Account settings'}
              variant="outline"
              onPress={() => router.push('/settings')}
            />
          ) : null}
          {!canAccessSettings ? (
            <EmptyState
              title={locale === 'fr' ? 'Accès réservé' : 'Access restricted'}
              description={locale === 'fr'
                ? 'Votre rôle ne dispose pas de la permission admin.settings.'
                : 'Your role does not have the admin.settings permission.'}
              icon="lock-closed-outline"
            />
          ) : settings.isLoading ? (
            <LoadingState count={2} height={100} />
          ) : settings.isError ? (
            <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
          ) : entries.length === 0 ? (
            <EmptyState title={t('ui.aucunParametre')} description={t('ui.aucunParametreExpose')} icon="settings-outline" />
          ) : (
            <View style={styles.list}>
              {entries.map(([key, value], index) => (
                <Reveal key={key} index={index} variant="up">
                  <Card tone="white" style={styles.row}>
                    <Text preset="caption" color={COLORS.slateGray}>{key}</Text>
                    <Text preset="bodySm" color={COLORS.textPrimary}>
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </Text>
                  </Card>
                </Reveal>
              ))}
            </View>
          )}
        </AuthGate>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: SPACING.sm, paddingBottom: SPACING.xxl, gap: SPACING.md },
  list: { gap: SPACING.sm },
  row: { gap: 4 },
});
