import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppHeader } from '@/components/app/AppHeader';
import { AuthGate, Button, Card, EmptyState, ErrorState, Input, LoadingState, Screen, Section, Text } from '@/components/ui';
import { AvatarContact, BarreRecherche, Onglets, drapeau } from '@/features/messaging/ui/ListeUi';
import { messagingApi } from '@/services/api/endpoints';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

const ROLE_LABELS: Record<string, string> = {
  FARMER: 'Producteur agricole',
  COOPERATIVE_ADMIN: 'Administrateur de coopérative',
  COOPERATIVE_MEMBER: 'Membre de coopérative',
  AGRICULTURAL_COMPANY: 'Entreprise agricole',
  BUYER: 'Acheteur professionnel',
  SUPPLIER: 'Fournisseur d’intrants',
  TRANSPORTER: 'Transporteur & Logistique',
  AGRONOMIST: 'Agronome conseil',
  LAB_PARTNER: 'Laboratoire partenaire',
  SUPER_ADMIN: 'Administration plateforme',
  ADMIN: 'Administration',
  MODERATOR: 'Modération',
  SUPPORT_AGENT: 'Support opérationnel',
  INDIVIDUAL: 'Compte individuel',
  COOPERATIVE: 'Coopérative',
  COMPANY: 'Entreprise',
};

interface DirectoryContact {
  id: string;
  name: string;
  agency?: string;
  role?: string;
  type: string;
  countryCode: string;
  avatarUrl?: string | null;
}

export default function NewConversationScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const qc = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated');

  const [mode, setMode] = useState<'DIRECT' | 'GROUP'>(params.mode === 'GROUP' ? 'GROUP' : 'DIRECT');
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const contactsQuery = useQuery({
    queryKey: ['messaging', 'contacts'],
    queryFn: () => messagingApi.contacts().then((r) => (r.data.items ?? []) as DirectoryContact[]),
    enabled: isAuthenticated,
  });

  const startDirect = useMutation({
    mutationFn: (targetOrgId: string) => {
      setPendingId(targetOrgId);
      return messagingApi.start({ subjectType: 'DIRECT', subjectId: targetOrgId, participantOrgIds: [targetOrgId] });
    },
    onSuccess: (res) => {
      setPendingId(null);
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      const cid = (res.data as { id?: string })?.id;
      if (cid) router.replace(('/messages/' + cid) as never);
    },
    onError: () => setPendingId(null),
  });

  const createGroup = useMutation({
    mutationFn: () =>
      messagingApi.createGroup({ name: groupName.trim(), description: groupDesc.trim() || undefined, participantOrgIds: selectedIds }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      const cid = (res.data as { id?: string })?.id;
      if (cid) router.replace(('/messages/' + cid) as never);
    },
  });

  const allContacts = contactsQuery.data ?? [];
  const filtered = allContacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const roleLabel = ROLE_LABELS[c.role ?? c.type] ?? c.role ?? c.type;
    return [c.name, c.agency ?? '', roleLabel, c.countryCode].join(' ').toLowerCase().includes(q);
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Présentation : tri alphabétique et regroupement par initiale (affichage seulement).
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  const sections: Array<{ letter: string; items: DirectoryContact[] }> = [];
  for (const c of sorted) {
    const letter = (c.name.trim()[0] ?? '#').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const key = /[A-Z]/.test(letter) ? letter : '#';
    const last = sections[sections.length - 1];
    if (last && last.letter === key) last.items.push(c);
    else sections.push({ letter: key, items: [c] });
  }
  const selectedContacts = allContacts.filter((c) => selectedIds.includes(c.id));

  return (
    <Screen background={COLORS.naturalWhite}>
      <AppHeader title="Nouvelle conversation" subtitle="Annuaire professionnel autorisé" />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title="Nouvelle conversation" icon="people-outline">
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <Ionicons name="shield-checkmark" size={18} color={COLORS.forestGreen} />
            </View>
            <Text preset="bodySm" color={COLORS.slateGray} style={styles.flex}>
              Échangez de façon sécurisée avec les collaborateurs, coopératives et partenaires autorisés de votre périmètre.
            </Text>
          </View>

          <Onglets
            valeur={mode}
            onChange={setMode}
            options={[
              { cle: 'DIRECT', libelle: 'Discussion directe', icone: 'person-outline' },
              { cle: 'GROUP', libelle: 'Groupe', icone: 'people-outline', compteur: selectedIds.length },
            ]}
          />

          {mode === 'GROUP' ? (
            <Card tone="white" style={styles.groupCard}>
              <View style={styles.groupHead}>
                <AvatarContact nom={groupName || 'Groupe'} groupe taille={44} />
                <View style={styles.flex}>
                  <Text preset="bodyMedium" color={COLORS.textPrimary}>Nouveau groupe professionnel</Text>
                  <Text preset="caption" color={COLORS.slateGray}>Nommez le groupe puis choisissez ses membres.</Text>
                </View>
              </View>
              <Input label="Nom du groupe" value={groupName} onChangeText={setGroupName} placeholder="Ex: Équipe Logistique · Agence Nord" />
              <Input label="Description ou service (optionnel)" value={groupDesc} onChangeText={setGroupDesc} placeholder="Ex: Suivi des livraisons et collectes" />
              {selectedContacts.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectedStrip}>
                  {selectedContacts.map((c) => (
                    <Pressable key={c.id} onPress={() => toggleSelect(c.id)} accessibilityRole="button" accessibilityLabel={`Retirer ${c.name}`} style={styles.selectedItem}>
                      <View>
                        <AvatarContact nom={c.name} cle={c.id} uri={c.avatarUrl} taille={44} />
                        <View style={styles.removeBadge}>
                          <Ionicons name="close" size={11} color={COLORS.pureWhite} />
                        </View>
                      </View>
                      <Text preset="caption" color={COLORS.textPrimary} numberOfLines={1} style={styles.selectedName}>{c.name.split(' ')[0]}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </Card>
          ) : null}

          <BarreRecherche valeur={search} onChange={setSearch} placeholder="Rechercher par nom, fonction ou agence…" />

          {contactsQuery.isLoading ? (
            <LoadingState count={4} height={72} />
          ) : contactsQuery.isError ? (
            <ErrorState error={contactsQuery.error} onRetry={() => void contactsQuery.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Aucun utilisateur trouvé"
              description={search ? 'Aucun contact autorisé ne correspond à « ' + search + ' ».' : 'Aucun contact disponible dans votre périmètre.'}
              icon="search-outline"
            />
          ) : (
            <View style={styles.list}>
              <Text preset="caption" color={COLORS.slateGray} style={styles.count}>
                {filtered.length} contact{filtered.length > 1 ? 's' : ''}{search ? ' trouvé' + (filtered.length > 1 ? 's' : '') : ' disponible' + (filtered.length > 1 ? 's' : '')}
              </Text>
              {sections.map((section) => (
                <View key={section.letter} style={styles.sectionBlock}>
                  <Text preset="caption" color={COLORS.forestGreen} style={styles.letter}>{section.letter}</Text>
                  <Card tone="white" padded={false} style={styles.listCard}>
                    {section.items.map((contact, index) => {
                      const roleLabel = ROLE_LABELS[contact.role ?? contact.type] ?? contact.role ?? contact.type;
                      const isSelected = selectedIds.includes(contact.id);
                      const isPending = startDirect.isPending && pendingId === contact.id;
                      const onRowPress = () => (mode === 'DIRECT' ? startDirect.mutate(contact.id) : toggleSelect(contact.id));
                      return (
                        <Pressable
                          key={contact.id}
                          onPress={onRowPress}
                          disabled={mode === 'DIRECT' && startDirect.isPending}
                          android_ripple={{ color: 'rgba(18,76,52,0.06)' }}
                          accessibilityRole={mode === 'GROUP' ? 'checkbox' : 'button'}
                          accessibilityState={mode === 'GROUP' ? { checked: isSelected } : undefined}
                          accessibilityLabel={mode === 'DIRECT' ? `Démarrer la discussion avec ${contact.name}` : `${isSelected ? 'Retirer' : 'Ajouter'} ${contact.name}`}
                          style={({ pressed }) => [styles.rowItem, index > 0 && styles.rowDivider, (pressed || isSelected) && styles.rowActive]}
                        >
                          <AvatarContact nom={contact.name} cle={contact.id} uri={contact.avatarUrl} taille={48} selectionne={mode === 'GROUP' && isSelected} />
                          <View style={styles.rowBody}>
                            <Text preset="bodyMedium" color={COLORS.textPrimary} numberOfLines={1}>{contact.name}</Text>
                            <View style={styles.metaRow}>
                              <View style={styles.roleBadge}>
                                <Text preset="caption" color={COLORS.forestGreen} style={styles.roleText} numberOfLines={1}>{roleLabel}</Text>
                              </View>
                              <Text preset="caption" color={COLORS.slateGray}>{drapeau(contact.countryCode)} {contact.countryCode}</Text>
                            </View>
                            {contact.agency && contact.agency !== contact.name ? (
                              <Text preset="caption" color={COLORS.slateGray} numberOfLines={1}>{contact.agency}</Text>
                            ) : null}
                          </View>
                          {mode === 'DIRECT' ? (
                            <View style={styles.actionBtn}>
                              {isPending ? (
                                <ActivityIndicator size="small" color={COLORS.pureWhite} />
                              ) : (
                                <Ionicons name="chatbubble-ellipses" size={18} color={COLORS.pureWhite} />
                              )}
                            </View>
                          ) : (
                            <Ionicons
                              name={isSelected ? 'checkmark-circle' : 'add-circle-outline'}
                              size={28}
                              color={isSelected ? COLORS.forestGreen : COLORS.slateGray}
                            />
                          )}
                        </Pressable>
                      );
                    })}
                  </Card>
                </View>
              ))}
            </View>
          )}

          {mode === 'GROUP' ? (
            <Button
              label={'Créer le groupe (' + selectedIds.length + ' membre(s))'}
              icon="people"
              disabled={groupName.trim().length < 2 || selectedIds.length === 0}
              loading={createGroup.isPending}
              onPress={() => createGroup.mutate()}
            />
          ) : null}
        </AuthGate>
      </Section>
    </Screen>
  );
}
const styles = StyleSheet.create({
  section: { paddingTop: SPACING.sm, paddingBottom: 110, gap: SPACING.md },
  flex: { flex: 1 },
  intro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: '#F2F8F4',
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(18,76,52,0.08)',
  },
  introIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.pureWhite, alignItems: 'center', justifyContent: 'center' },
  groupCard: { gap: SPACING.md },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  selectedStrip: { gap: SPACING.md, paddingTop: SPACING.xs },
  selectedItem: { alignItems: 'center', width: 56, gap: 4 },
  selectedName: { maxWidth: 56, textAlign: 'center' },
  removeBadge: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.slateGray,
    borderWidth: 2,
    borderColor: COLORS.pureWhite,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { gap: SPACING.md },
  count: { marginLeft: SPACING.xs },
  sectionBlock: { gap: SPACING.xs },
  letter: { fontWeight: '700', marginLeft: SPACING.sm, letterSpacing: 0.6 },
  listCard: { overflow: 'hidden' },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.lightBorder },
  rowActive: { backgroundColor: '#F2F8F4' },
  rowBody: { flex: 1, gap: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexWrap: 'wrap' },
  roleBadge: { backgroundColor: '#E6F3EC', borderRadius: RADIUS.pill, paddingHorizontal: SPACING.sm, paddingVertical: 2, maxWidth: 200 },
  roleText: { fontSize: 11, fontWeight: '600' },
  actionBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.forestGreen, alignItems: 'center', justifyContent: 'center' },
});
