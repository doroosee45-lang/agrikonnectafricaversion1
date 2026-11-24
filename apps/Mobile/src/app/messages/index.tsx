import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppHeader } from '@/components/app/AppHeader';
import { AuthGate, Button, Card, Chip, EmptyState, ErrorState, Input, LoadingState, Screen, Section, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { messagingApi } from '@/services/api/endpoints';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

type TabKey = 'DIRECT' | 'GROUP' | 'CALLS';

interface EnrichedConversation {
  id: string;
  subjectType?: string | null;
  title?: string;
  subtitle?: string;
  unread?: number;
  status: string;
  updatedAt: string;
  lastMessage?: { body?: string; createdAt?: string } | null;
}

export default function MessagesScreen() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated');
  const permissions = useAuthStore((s) => s.permissions);
  const canWrite = permissions.includes('messages.write') || permissions.includes('*');

  const [tab, setTab] = useState<TabKey>('DIRECT');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'DIRECT' | 'GROUP'>('DIRECT');
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);

  const query = useQuery({
    queryKey: queryKeys.messaging.conversations,
    queryFn: () => messagingApi.conversations({ limit: 80 }).then((r) => r.data),
    enabled: isAuthenticated,
    refetchInterval: 6000,
  });

  const contactsQuery = useQuery({
    queryKey: ['messaging', 'contacts'],
    queryFn: () => messagingApi.contacts().then((r) => r.data.items),
    enabled: isAuthenticated,
  });

  const callsQuery = useQuery({
    queryKey: ['calls', 'history'],
    queryFn: () => messagingApi.callsHistory().then((r) => r.data.items ?? []),
    enabled: isAuthenticated && tab === 'CALLS',
    refetchInterval: 10000,
  });

  const startDirect = useMutation({
    mutationFn: (targetOrgId: string) =>
      messagingApi.start({ subjectType: 'DIRECT', subjectId: targetOrgId, participantOrgIds: [targetOrgId] }),
    onSuccess: (res) => {
      setModalOpen(false);
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      const convId = (res.data as { id?: string })?.id;
      if (convId) router.push(('/messages/' + convId) as never);
    },
  });

  const createGroup = useMutation({
    mutationFn: () => messagingApi.createGroup({ name: groupName.trim(), description: groupDesc.trim() || undefined, participantOrgIds: selectedOrgs }),
    onSuccess: (res) => {
      setModalOpen(false);
      setGroupName('');
      setGroupDesc('');
      setSelectedOrgs([]);
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      const convId = (res.data as { id?: string })?.id;
      if (convId) router.push(('/messages/' + convId) as never);
    },
  });

  const allItems = ((query.data as { items?: EnrichedConversation[] } | undefined)?.items ?? []).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const directItems = allItems.filter((c) => c.subjectType !== 'GROUP');
  const groupItems = allItems.filter((c) => c.subjectType === 'GROUP');
  const contacts = (contactsQuery.data ?? []).filter((c) => `${c.name} ${c.type} ${c.countryCode}`.toLowerCase().includes(search.toLowerCase()));
  const calls = callsQuery.data ?? [];
  const toggleOrg = (id: string) => setSelectedOrgs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Screen background={COLORS.naturalWhite}>
      <AppHeader title={t('ui.messagerie')} subtitle="Discussions · Groupes · Appels" />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title={t('ui.messagerie')} icon="chatbubbles-outline">
          <View style={styles.topRow}>
            <View style={styles.tabs}>
              {([
                { key: 'DIRECT', label: `Discussions (${directItems.length})` },
                { key: 'GROUP', label: `Groupes (${groupItems.length})` },
                { key: 'CALLS', label: 'Appels' },
              ] as const).map((item) => (
                <Pressable key={item.key} onPress={() => setTab(item.key)} style={[styles.tabBtn, tab === item.key ? styles.tabBtnActive : null]}>
                  <Text preset="caption" color={tab === item.key ? COLORS.pureWhite : COLORS.forestGreen} style={styles.tabText}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {canWrite ? (
              <Pressable onPress={() => router.push(('/messages/new?mode=' + (tab === 'GROUP' ? 'GROUP' : 'DIRECT')) as never)} accessibilityLabel="Nouvelle conversation" style={styles.plusBtn}>
                <Ionicons name="add" size={24} color={COLORS.pureWhite} />
              </Pressable>
            ) : null}
          </View>

          {tab === 'CALLS' ? (
            <View style={{ gap: SPACING.sm }}>
              {callsQuery.isLoading ? <LoadingState count={3} height={68} /> : calls.length === 0 ? (
                <EmptyState title="Aucun appel enregistré" description="Vos appels entrants, sortants et manqués apparaîtront ici." icon="call-outline" />
              ) : (
                calls.map((call) => {
                  const durationSec = call.startedAt && call.endedAt ? Math.max(1, Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)) : null;
                  const missed = call.status === 'MISSED' || call.status === 'DECLINED';
                  return (
                    <Pressable key={call.id} onPress={() => router.push(('/messages/' + call.conversationId) as never)}>
                      <Card tone="white" style={styles.card}>
                        <View style={styles.row}>
                          <Text preset="bodyMedium" color={COLORS.forestGreen}>
                            {call.initiator ? `${call.initiator.firstName ?? ''} ${call.initiator.lastName ?? ''}`.trim() : 'Appel audio'}
                          </Text>
                          <Chip label={call.status} tone={missed ? 'warning' : 'success'} size="sm" />
                        </View>
                        <Text preset="caption" color={COLORS.slateGray}>
                          {formatDate(call.startedAt, locale)}{durationSec !== null ? ` · Durée : ${durationSec}s` : ''}
                        </Text>
                      </Card>
                    </Pressable>
                  );
                })
              )}
            </View>
          ) : query.isLoading ? (
            <LoadingState count={4} height={78} />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (tab === 'DIRECT' ? directItems : groupItems).length === 0 ? (
            <EmptyState
              title={tab === 'GROUP' ? 'Aucun groupe professionnel' : t('ui.aucuneConversation')}
              description="Appuyez sur le bouton + en haut à droite pour démarrer un échange."
              icon={tab === 'GROUP' ? 'people-outline' : 'chatbubbles-outline'}
            />
          ) : (
            <View style={{ gap: SPACING.sm }}>
              {(tab === 'DIRECT' ? directItems : groupItems).map((item) => {
                const title = item.title ?? item.subjectType ?? 'Discussion';
                return (
                  <Pressable key={item.id} onPress={() => router.push(('/messages/' + item.id) as never)}>
                    <Card tone="white" style={styles.convCard}>
                      <View style={styles.avatar}>
                        <Text preset="bodyMedium" color={COLORS.pureWhite}>{title.slice(0, 2).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={styles.row}>
                          <Text preset="h3" color={COLORS.forestGreen} numberOfLines={1} style={{ flex: 1 }}>{title}</Text>
                          <Text preset="caption" color={COLORS.slateGray}>{formatDate(item.updatedAt, locale)}</Text>
                        </View>
                        {item.subtitle ? <Text preset="caption" color={COLORS.slateGray}>{item.subtitle}</Text> : null}
                        <View style={styles.row}>
                          <Text preset="bodySm" color={COLORS.slateGray} numberOfLines={1} style={{ flex: 1 }}>
                            {item.lastMessage?.body ?? 'Nouvelle conversation'}
                          </Text>
                          {(item.unread ?? 0) > 0 ? (
                            <View style={styles.unreadPill}>
                              <Text preset="caption" color={COLORS.pureWhite} style={{ fontSize: 11, fontWeight: '700' }}>{String(item.unread)}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          )}
        </AuthGate>
      </Section>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <View style={styles.row}>
              <Text preset="h3" color={COLORS.forestGreen}>{modalMode === 'GROUP' ? 'Créer un groupe' : 'Nouvelle discussion'}</Text>
              <Pressable onPress={() => setModalOpen(false)}><Ionicons name="close" size={24} color={COLORS.slateGray} /></Pressable>
            </View>
            <View style={styles.tabs}>
              <Pressable onPress={() => setModalMode('DIRECT')} style={[styles.tabBtn, modalMode === 'DIRECT' ? styles.tabBtnActive : null]}>
                <Text preset="caption" color={modalMode === 'DIRECT' ? COLORS.pureWhite : COLORS.forestGreen}>1-à-1</Text>
              </Pressable>
              <Pressable onPress={() => setModalMode('GROUP')} style={[styles.tabBtn, modalMode === 'GROUP' ? styles.tabBtnActive : null]}>
                <Text preset="caption" color={modalMode === 'GROUP' ? COLORS.pureWhite : COLORS.forestGreen}>Groupe</Text>
              </Pressable>
            </View>
            {modalMode === 'GROUP' ? (
              <View style={{ gap: 8 }}>
                <Input label="Nom du groupe" value={groupName} onChangeText={setGroupName} placeholder="Ex: Coopérative Nord · Logistique" />
                <Input label="Description" value={groupDesc} onChangeText={setGroupDesc} placeholder="Optionnel" />
              </View>
            ) : null}
            <TextInput value={search} onChangeText={setSearch} placeholder="Rechercher un contact autorisé..." style={styles.searchInput} />
            <ScrollView style={{ maxHeight: 260 }}>
              {contacts.map((c) => {
                const picked = selectedOrgs.includes(c.id);
                return (
                  <Pressable key={c.id} onPress={() => (modalMode === 'DIRECT' ? startDirect.mutate(c.id) : toggleOrg(c.id))} style={[styles.contactItem, picked ? styles.contactPicked : null]}>
                    <View style={styles.avatarSm}>
                      <Text preset="caption" color={COLORS.pureWhite}>{c.name.slice(0, 2).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text preset="bodyMedium" color={COLORS.forestGreen}>{c.name}</Text>
                      <Text preset="caption" color={COLORS.slateGray}>{c.type} · {c.countryCode}</Text>
                    </View>
                    <Ionicons name={modalMode === 'GROUP' ? (picked ? 'checkmark-circle' : 'ellipse-outline') : 'chevron-forward'} size={20} color={picked ? COLORS.forestGreen : COLORS.slateGray} />
                  </Pressable>
                );
              })}
            </ScrollView>
            {modalMode === 'GROUP' ? (
              <Button label={`Créer le groupe (${selectedOrgs.length})`} disabled={groupName.trim().length < 2 || selectedOrgs.length === 0} loading={createGroup.isPending} onPress={() => createGroup.mutate()} />
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: SPACING.sm, paddingBottom: 96, gap: SPACING.md },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tabs: { flex: 1, flexDirection: 'row', backgroundColor: COLORS.paleGreen, borderRadius: RADIUS.pill, padding: 3, gap: 4 },
  tabBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: 8, borderRadius: RADIUS.pill, alignItems: 'center' },
  tabBtnActive: { backgroundColor: COLORS.forestGreen },
  tabText: { fontWeight: '600', fontSize: 11 },
  plusBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.forestGreen, alignItems: 'center', justifyContent: 'center' },
  card: { gap: 4 },
  convCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.forestGreen, alignItems: 'center', justifyContent: 'center' },
  avatarSm: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.forestGreen, alignItems: 'center', justifyContent: 'center' },
row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
unreadPill: { backgroundColor: '#dc2626', borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
modalBox: { backgroundColor: COLORS.pureWhite, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, gap: 12, maxHeight: '88%' },
searchInput: { borderWidth: 1, borderColor: COLORS.lightBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: COLORS.naturalWhite },
contactItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: COLORS.lightBorder },
contactPicked: { backgroundColor: COLORS.paleGreen, borderRadius: 8 },
});
