import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppHeader } from '@/components/app/AppHeader';
import { AuthGate, Button, Card, EmptyState, ErrorState, Input, LoadingState, PressableScale, Screen, Section, Text } from '@/components/ui';
import { AvatarContact, BarreRecherche, Onglets, PastilleNonLus, apercuMessage, drapeau, heureListe, libelleTypeOrg } from '@/features/messaging/ui/ListeUi';
import { useI18n } from '@/i18n';
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
  // Filtre d'affichage local (aucun appel serveur).
  const [listSearch, setListSearch] = useState('');
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

  const fr = locale !== 'en';
  const unreadTotal = directItems.reduce((n, c) => n + (c.unread ?? 0), 0);
  const unreadGroups = groupItems.reduce((n, c) => n + (c.unread ?? 0), 0);
  const q = listSearch.trim().toLowerCase();
  const visibleItems = (tab === 'DIRECT' ? directItems : groupItems).filter(
    (c) => !q || [c.title ?? '', c.subtitle ?? '', c.lastMessage?.body ?? ''].join(' ').toLowerCase().includes(q),
  );
  const subtitleLabel = (subtitle?: string) => {
    if (!subtitle) return null;
    const [type, country] = subtitle.split(' · ');
    const typeLabel = libelleTypeOrg(type, locale);
    return typeLabel ? `${typeLabel}${country ? ` · ${drapeau(country)} ${country}` : ''}` : subtitle;
  };

  return (
    <Screen background={COLORS.naturalWhite}>
      <AppHeader title={t('ui.messagerie')} subtitle={fr ? 'Discussions · Groupes · Appels' : 'Chats · Groups · Calls'} />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title={t('ui.messagerie')} icon="chatbubbles-outline">
          <View style={styles.topRow}>
            <View style={styles.flex}>
              <BarreRecherche
                valeur={listSearch}
                onChange={setListSearch}
                placeholder={tab === 'CALLS' ? (fr ? 'Rechercher un appel' : 'Search calls') : fr ? 'Rechercher une discussion' : 'Search conversations'}
              />
            </View>
            {canWrite ? (
              <PressableScale
                onPress={() => router.push(('/messages/new?mode=' + (tab === 'GROUP' ? 'GROUP' : 'DIRECT')) as never)}
                accessibilityRole="button"
                accessibilityLabel="Nouvelle conversation"
                style={styles.plusBtn}
              >
                <Ionicons name={tab === 'GROUP' ? 'people' : 'create-outline'} size={21} color={COLORS.pureWhite} />
              </PressableScale>
            ) : null}
          </View>

          <Onglets
            valeur={tab}
            onChange={setTab}
            options={[
              { cle: 'DIRECT', libelle: fr ? 'Discussions' : 'Chats', icone: 'chatbubble-ellipses-outline', compteur: unreadTotal },
              { cle: 'GROUP', libelle: fr ? 'Groupes' : 'Groups', icone: 'people-outline', compteur: unreadGroups },
              { cle: 'CALLS', libelle: fr ? 'Appels' : 'Calls', icone: 'call-outline' },
            ]}
          />

          {tab === 'CALLS' ? (
            callsQuery.isLoading ? (
              <LoadingState count={3} height={68} />
            ) : calls.length === 0 ? (
              <EmptyState title="Aucun appel enregistré" description="Vos appels entrants, sortants et manqués apparaîtront ici." icon="call-outline" />
            ) : (
              <Card tone="white" padded={false} style={styles.listCard}>
                {calls
                  .filter((call) => {
                    const who = call.initiator ? `${call.initiator.firstName ?? ''} ${call.initiator.lastName ?? ''}` : '';
                    return !q || who.toLowerCase().includes(q);
                  })
                  .map((call, index) => {
                    const durationSec = call.startedAt && call.endedAt ? Math.max(1, Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)) : null;
                    const missed = call.status === 'MISSED' || call.status === 'DECLINED';
                    const who = call.initiator ? `${call.initiator.firstName ?? ''} ${call.initiator.lastName ?? ''}`.trim() : '';
                    const name = who || (fr ? 'Appel audio' : 'Audio call');
                    const status =
                      call.status === 'MISSED' ? (fr ? 'Manqué' : 'Missed')
                        : call.status === 'DECLINED' ? (fr ? 'Refusé' : 'Declined')
                          : call.status === 'ACTIVE' ? (fr ? 'En cours' : 'Ongoing')
                            : call.status === 'RINGING' ? (fr ? 'Sonnerie' : 'Ringing')
                              : fr ? 'Terminé' : 'Ended';
                    return (
                      <Pressable
                        key={call.id}
                        onPress={() => router.push(('/messages/' + call.conversationId) as never)}
                        android_ripple={{ color: 'rgba(18,76,52,0.06)' }}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.rowItem, index > 0 && styles.rowDivider, pressed && styles.rowPressed]}
                      >
                        <AvatarContact nom={name} cle={call.conversationId} taille={46} />
                        <View style={styles.rowBody}>
                          <Text preset="bodyMedium" color={missed ? COLORS.error : COLORS.textPrimary} numberOfLines={1}>{name}</Text>
                          <View style={styles.inline}>
                            <Ionicons name={missed ? 'arrow-down' : 'call'} size={13} color={missed ? COLORS.error : COLORS.livingGreen} />
                            <Text preset="caption" color={COLORS.slateGray} numberOfLines={1}>
                              {status}{durationSec !== null ? ` · ${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}` : ''}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.rowMeta}>
                          <Text preset="caption" color={COLORS.slateGray}>{heureListe(call.startedAt, locale)}</Text>
                          <Ionicons name="call-outline" size={18} color={COLORS.forestGreen} />
                        </View>
                      </Pressable>
                    );
                  })}
              </Card>
            )
          ) : query.isLoading ? (
            <LoadingState count={4} height={78} />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (tab === 'DIRECT' ? directItems : groupItems).length === 0 ? (
            <EmptyState
              title={tab === 'GROUP' ? 'Aucun groupe professionnel' : t('ui.aucuneConversation')}
              description="Appuyez sur le bouton de création en haut à droite pour démarrer un échange."
              icon={tab === 'GROUP' ? 'people-outline' : 'chatbubbles-outline'}
            />
          ) : visibleItems.length === 0 ? (
            <EmptyState
              title={fr ? 'Aucun résultat' : 'No results'}
              description={fr ? `Aucune discussion ne correspond à « ${listSearch} ».` : `No conversation matches “${listSearch}”.`}
              icon="search-outline"
            />
          ) : (
            <Card tone="white" padded={false} style={styles.listCard}>
              {visibleItems.map((item, index) => {
                const title = item.title ?? item.subjectType ?? 'Discussion';
                const unread = item.unread ?? 0;
                const preview = apercuMessage(item.lastMessage?.body);
                const meta = subtitleLabel(item.subtitle);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => router.push(('/messages/' + item.id) as never)}
                    android_ripple={{ color: 'rgba(18,76,52,0.06)' }}
                    accessibilityRole="button"
                    accessibilityLabel={`${title}${unread > 0 ? `, ${unread} non lus` : ''}`}
                    style={({ pressed }) => [styles.rowItem, index > 0 && styles.rowDivider, pressed && styles.rowPressed]}
                  >
                    <AvatarContact nom={title} cle={item.id} groupe={item.subjectType === 'GROUP'} />
                    <View style={styles.rowBody}>
                      <View style={styles.rowHead}>
                        <Text preset="bodyMedium" color={COLORS.textPrimary} numberOfLines={1} style={[styles.flex, unread > 0 && styles.bold]}>
                          {title}
                        </Text>
                        <Text preset="caption" color={unread > 0 ? COLORS.livingGreen : COLORS.slateGray} style={unread > 0 ? styles.bold : undefined}>
                          {heureListe(item.lastMessage?.createdAt ?? item.updatedAt, locale)}
                        </Text>
                      </View>
                      {meta ? <Text preset="caption" color={COLORS.slateGray} numberOfLines={1}>{meta}</Text> : null}
                      <View style={styles.rowHead}>
                        <View style={[styles.inline, styles.flex]}>
                          {preview.icone ? <Ionicons name={preview.icone} size={14} color={COLORS.slateGray} /> : null}
                          <Text preset="bodySm" color={unread > 0 ? COLORS.textPrimary : COLORS.slateGray} numberOfLines={1} style={styles.flex}>
                            {preview.texte || (fr ? 'Nouvelle conversation' : 'New conversation')}
                          </Text>
                        </View>
                        <PastilleNonLus n={unread} />
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
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
  section: { paddingTop: SPACING.sm, paddingBottom: 110, gap: SPACING.md },
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  plusBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.forestGreen, alignItems: 'center', justifyContent: 'center' },
  listCard: { overflow: 'hidden' },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.lightBorder },
  rowPressed: { backgroundColor: '#F4F8F5' },
  rowBody: { flex: 1, gap: 2 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  rowMeta: { alignItems: 'flex-end', gap: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Fenêtre de création (code conservé tel quel).
  tabs: { flexDirection: 'row', backgroundColor: COLORS.paleGreen, borderRadius: RADIUS.pill, padding: 3, gap: 4 },
  tabBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: 8, borderRadius: RADIUS.pill, alignItems: 'center' },
  tabBtnActive: { backgroundColor: COLORS.forestGreen },
  avatarSm: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.forestGreen, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: COLORS.pureWhite, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, gap: 12, maxHeight: '88%' },
  searchInput: { borderWidth: 1, borderColor: COLORS.lightBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: COLORS.naturalWhite },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: COLORS.lightBorder },
  contactPicked: { backgroundColor: COLORS.paleGreen, borderRadius: 8 },
});
