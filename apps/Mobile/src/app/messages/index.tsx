import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';

import { AppHeader } from '@/components/app/AppHeader';
import { AuthGate, Chip, Button, Card, EmptyState, ErrorState, LoadingState, Screen, Section, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { messagingApi } from '@/services/api/endpoints';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { SPACING } from '@/theme/space';

export default function MessagesScreen() {
  const { t, locale } = useI18n();
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');

  const query = useQuery({
    queryKey: queryKeys.messaging.conversations,
    queryFn: () => messagingApi.conversations({ limit: 50 }).then((r) => r.data),
    enabled: isAuthenticated,
    retry: false,
  });

  const contactsQuery = useQuery({
    queryKey: ['messaging', 'contacts'],
    queryFn: () => messagingApi.contacts().then((r) => r.data.items),
    enabled: isAuthenticated,
  });

  const startConv = useMutation({
    mutationFn: (targetOrgId: string) =>
      messagingApi.start({ subjectType: 'DIRECT', subjectId: targetOrgId, participantOrgIds: [targetOrgId] }),
    onSuccess: (res) => {
      const convId = (res.data as { id?: string })?.id;
      if (convId) router.push(('/messages/' + convId) as never);
    },
  });

  const items = query.data?.items ?? [];
  const contacts = contactsQuery.data ?? [];

  return (
    <Screen background={COLORS.naturalWhite}>
      <AppHeader title={t('ui.messagerie')} subtitle={t('ui.conversations')} />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title={t('ui.messagerie')} icon="chatbubbles-outline">
          {contacts.length > 0 ? (
            <Card tone="pale" style={styles.contactsCard}>
              <Text preset="bodyMedium" color={COLORS.forestGreen}>Nouvelle discussion</Text>
              <View style={styles.contactRow}>
                {contacts.slice(0, 6).map((c) => (
                  <Button
                    key={c.id}
                    label={c.name}
                    variant="outline"
                    loading={startConv.isPending}
                    onPress={() => startConv.mutate(c.id)}
                  />
                ))}
              </View>
            </Card>
          ) : null}

          {query.isLoading ? <LoadingState count={3} height={80} /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : items.length === 0 ? (
            <EmptyState title={t('ui.aucuneConversation')} description={t('ui.filDeDiscussion')} icon="chatbubbles-outline" />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable onPress={() => router.push(('/messages/' + item.id) as never)}>
                  <Card tone="white" style={styles.card}>
                    <View style={styles.row}>
                      <Text preset="h3" color={COLORS.forestGreen}>{item.subjectType ?? 'DIRECT'}</Text>
                      <Chip label={item.status} tone="info" size="sm" />
                    </View>
                    <Text preset="caption" color={COLORS.slateGray}>{formatDate(item.updatedAt, locale)}</Text>
                  </Card>
                </Pressable>
              )}
            />
          )}
        </AuthGate>
      </Section>
    </Screen>
  );
}
const styles = StyleSheet.create({ section: { paddingTop: SPACING.sm, paddingBottom: SPACING.xxl, gap: SPACING.md }, contactsCard: { gap: SPACING.xs, marginBottom: SPACING.sm }, contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }, card: { marginBottom: SPACING.sm, gap: 4 }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } });
