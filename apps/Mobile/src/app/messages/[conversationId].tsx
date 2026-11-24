import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppHeader } from '@/components/app/AppHeader';
import { AuthGate, Button, Card, Chip, ErrorState, Input, LoadingState, Screen, Section, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { messagingApi } from '@/services/api/endpoints';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { CallButton } from '@/features/calls/CallButton';
import { SPACING } from '@/theme/space';

export default function ConversationDetail() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated');
  const userId = useAuthStore((s) => s.user?.id);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const query = useQuery({
    queryKey: queryKeys.messaging.messages(conversationId ?? ''),
    queryFn: () => messagingApi.messages(conversationId ?? '', { limit: 60 }).then((r) => r.data),
    enabled: isAuthenticated && Boolean(conversationId),
    refetchInterval: 4000,
  });

  const convListQ = useQuery({
    queryKey: queryKeys.messaging.conversations,
    queryFn: () => messagingApi.conversations({ limit: 80 }).then((r) => r.data),
    enabled: isAuthenticated,
  });

  const contactsQ = useQuery({
    queryKey: ['messaging', 'contacts'],
    queryFn: () => messagingApi.contacts().then((r) => r.data.items),
    enabled: isAuthenticated && showMembers,
  });

  const send = useMutation({
    mutationFn: () => {
      const payloadBody = replyTo ? `↪ « ${replyTo.slice(0, 60)} »\n${body.trim()}` : body.trim();
      return messagingApi.send(conversationId ?? '', { body: payloadBody });
    },
    onSuccess: () => { setBody(''); setReplyTo(null); setError(null); void query.refetch(); void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations }); },
    onError: (caught) => setError(caught),
  });

  const addMember = useMutation({
    mutationFn: (orgId: string) => messagingApi.addMember(conversationId ?? '', orgId),
    onSuccess: () => { void query.refetch(); void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations }); },
  });

  const removeMember = useMutation({
    mutationFn: (orgId: string) => messagingApi.removeMember(conversationId ?? '', orgId),
    onSuccess: () => { void query.refetch(); void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations }); },
  });

  const convMeta = ((convListQ.data as { items?: Array<{ id: string; title?: string; subtitle?: string; subjectType?: string; adminOrgId?: string; participants?: Array<{ id: string; name: string; type: string }> }> } | undefined)?.items ?? []).find((c) => c.id === conversationId);
  const messages = query.data?.items ?? [];
  const isGroup = convMeta?.subjectType === 'GROUP';

  return (
    <Screen background={COLORS.naturalWhite}>
      <AppHeader title={convMeta?.title ?? t('ui.conversation')} subtitle={convMeta?.subtitle ?? t('ui.filDeDiscussion')} />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title={t('ui.conversation')} icon="chatbubbles-outline">
          <View style={styles.toolbar}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={18} color={COLORS.forestGreen} />
              <Text preset="bodySm" color={COLORS.forestGreen}>Discussions</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {isGroup ? <Button label={showMembers ? 'Masquer membres' : 'Membres'} variant="outline" onPress={() => setShowMembers((v) => !v)} /> : null}
              {conversationId ? <CallButton conversationId={conversationId} /> : null}
            </View>
          </View>

          {isGroup && showMembers ? (
            <Card tone="pale" style={{ gap: 8 }}>
              <Text preset="bodyMedium" color={COLORS.forestGreen}>Participants du groupe ({convMeta?.participants?.length ?? 0})</Text>
              {(convMeta?.participants ?? []).map((p) => (
                <View key={p.id} style={styles.memberRow}>
                  <Text preset="bodySm" color={COLORS.forestGreen}>{p.name} {p.id === convMeta?.adminOrgId ? '(Admin)' : ''}</Text>
                  {p.id !== convMeta?.adminOrgId ? (
                    <Pressable onPress={() => removeMember.mutate(p.id)}><Chip label="Retirer" tone="warning" size="sm" /></Pressable>
                  ) : null}
                </View>
              ))}
              <Text preset="caption" color={COLORS.slateGray}>Ajouter un membre autorisé :</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(contactsQ.data ?? []).filter((c) => !(convMeta?.participants ?? []).some((p) => p.id === c.id)).slice(0, 6).map((c) => (
                  <Button key={c.id} label={`+ ${c.name}`} variant="outline" onPress={() => addMember.mutate(c.id)} />
                ))}
              </View>
            </Card>
          ) : null}

          {query.isLoading ? <LoadingState count={3} height={80} /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : (
            <>
              <View style={styles.list}>
                {messages.map((item) => (
                  <Card key={item.id} tone={item.senderId === userId ? 'pale' : 'white'} style={styles.message}>
                    <Text preset="bodySm">{item.body}</Text>
                    {item.attachments?.map((att, idx) => (
                      <Button key={idx} label="Écouter / Ouvrir la pièce jointe" variant="outline" onPress={() => void Linking.openURL(att)} />
                    ))}
                    <View style={styles.memberRow}>
                      <Text preset="caption" color={COLORS.slateGray}>{formatDate(item.createdAt, locale)}</Text>
                      <Pressable onPress={() => setReplyTo(item.body)}><Text preset="caption" color={COLORS.forestGreen}>Répondre</Text></Pressable>
                    </View>
                  </Card>
                ))}
              </View>
              <Card tone="white" style={{ gap: 6 }}>
                {replyTo ? (
                  <View style={styles.replyBanner}>
                    <Text preset="caption" color={COLORS.forestGreen} numberOfLines={1} style={{ flex: 1 }}>Réponse à : {replyTo}</Text>
                    <Pressable onPress={() => setReplyTo(null)}><Ionicons name="close" size={16} color={COLORS.slateGray} /></Pressable>
                  </View>
                ) : null}
                <View style={styles.inputRow}>
                  <Input label="" value={body} onChangeText={setBody} placeholder={t('ui.ecrireUnMessage')} containerStyle={styles.input} />
                  <Button label={t('ui.envoyer')} onPress={() => send.mutate()} loading={send.isPending} disabled={body.trim().length === 0} />
                </View>
                {error ? <ErrorState error={error} /> : null}
              </Card>
            </>
          )}
        </AuthGate>
      </Section>
    </Screen>
  );
}
const styles = StyleSheet.create({
  section: { paddingTop: SPACING.sm, paddingBottom: 96, gap: SPACING.md },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  memberRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  list: { gap: SPACING.sm, marginBottom: SPACING.md },
  message: { gap: 4 },
  replyBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.paleGreen, padding: 6, borderRadius: 6 },
  inputRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-end' },
  input: { flex: 1 },
});
