import { useState } from 'react';
import { Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppHeader } from '@/components/app/AppHeader';
import { AuthGate, Button, Card, Chip, EmptyState, ErrorState, Input, LoadingState, Screen, Section, Text } from '@/components/ui';
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

  return (
    <Screen background={COLORS.naturalWhite}>
      <AppHeader title="Nouvelle conversation" subtitle="Annuaire professionnel autorisé" />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title="Nouvelle conversation" icon="people-outline">
          <Text preset="bodySm" color={COLORS.slateGray} style={styles.intro}>
            Recherchez un collaborateur, une coopérative ou un partenaire autorisé dans votre périmètre pour démarrer un échange sécurisé.
          </Text>

          <View style={styles.modeSwitch}>
            <Pressable onPress={() => setMode('DIRECT')} style={[styles.modeBtn, mode === 'DIRECT' ? styles.modeBtnActive : null]}>
              <Ionicons name="person-outline" size={16} color={mode === 'DIRECT' ? COLORS.pureWhite : COLORS.forestGreen} />
              <Text preset="caption" color={mode === 'DIRECT' ? COLORS.pureWhite : COLORS.forestGreen} style={styles.modeLabel}>
                Discussion directe
              </Text>
            </Pressable>
            <Pressable onPress={() => setMode('GROUP')} style={[styles.modeBtn, mode === 'GROUP' ? styles.modeBtnActive : null]}>
              <Ionicons name="people-outline" size={16} color={mode === 'GROUP' ? COLORS.pureWhite : COLORS.forestGreen} />
              <Text preset="caption" color={mode === 'GROUP' ? COLORS.pureWhite : COLORS.forestGreen} style={styles.modeLabel}>
                Groupe professionnel
              </Text>
            </Pressable>
          </View>

          {mode === 'GROUP' ? (
            <Card tone="white" style={styles.groupCard}>
              <Input label="Nom du groupe" value={groupName} onChangeText={setGroupName} placeholder="Ex: Équipe Logistique · Agence Nord" />
              <Input label="Description ou service (optionnel)" value={groupDesc} onChangeText={setGroupDesc} placeholder="Ex: Suivi des livraisons et collectes" />
            </Card>
          ) : null}

          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={20} color={COLORS.slateGray} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Rechercher par nom, fonction ou agence..."
              placeholderTextColor={COLORS.slateGray}
              style={styles.searchInput}
            />
            {search.length > 0 ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={COLORS.slateGray} />
              </Pressable>
            ) : null}
          </View>

          {contactsQuery.isLoading ? (
            <LoadingState count={4} height={92} />
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
              {filtered.map((contact) => {
                const roleLabel = ROLE_LABELS[contact.role ?? contact.type] ?? contact.role ?? contact.type;
                const initials = contact.name.slice(0, 2).toUpperCase();
                const isSelected = selectedIds.includes(contact.id);
                return (
                  <Card key={contact.id} tone="white" style={[styles.contactCard, isSelected ? styles.contactCardSelected : null]}>
                    <View style={styles.cardTop}>
                      {contact.avatarUrl ? (
                        <Image source={{ uri: contact.avatarUrl }} style={styles.avatarImg} />
                      ) : (
                        <View style={styles.avatarCircle}>
                          <Text preset="bodyMedium" color={COLORS.pureWhite}>{initials}</Text>
                        </View>
                      )}
                      <View style={styles.cardInfo}>
                        <Text preset="h3" color={COLORS.forestGreen} numberOfLines={1}>{contact.name}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          <Chip label={roleLabel} tone="info" size="sm" />
                          {contact.agency && contact.agency !== contact.name ? (
                            <Text preset="caption" color={COLORS.slateGray} numberOfLines={1}>{contact.agency}</Text>
                          ) : null}
                        </View>
                        <Text preset="caption" color={COLORS.slateGray}>Pays : {contact.countryCode}</Text>
                      </View>
                    </View>
                    <View style={styles.cardAction}>
                      {mode === 'DIRECT' ? (
                        <Button
                          label="Démarrer la discussion"
                          loading={startDirect.isPending && pendingId === contact.id}
                          onPress={() => startDirect.mutate(contact.id)}
                        />
                      ) : (
                        <Button
                          label={isSelected ? 'Retirer du groupe' : 'Ajouter au groupe'}
                          variant={isSelected ? 'primary' : 'outline'}
                          onPress={() => toggleSelect(contact.id)}
                        />
                      )}
                    </View>
                  </Card>
                );
              })}
            </View>
          )}

          {mode === 'GROUP' ? (
            <Button
              label={'Créer le groupe (' + selectedIds.length + ' membre(s))'}
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
intro: { lineHeight: 20 },
modeSwitch: { flexDirection: 'row', backgroundColor: COLORS.paleGreen, borderRadius: RADIUS.lg, padding: 4, gap: 6 },
modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: RADIUS.md },
modeBtnActive: { backgroundColor: COLORS.forestGreen },
modeLabel: { fontWeight: '600', fontSize: 13 },
groupCard: { gap: SPACING.sm, padding: SPACING.md },
searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.pureWhite, borderWidth: 1, borderColor: COLORS.lightBorder, borderRadius: RADIUS.lg, paddingHorizontal: 14, height: 48 },
searchInput: { flex: 1, fontSize: 14, color: COLORS.forestGreen },
list: { gap: SPACING.sm },
contactCard: { padding: SPACING.md, gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.lightBorder },
contactCardSelected: { borderColor: COLORS.forestGreen, backgroundColor: COLORS.paleGreen },
cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
avatarCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.forestGreen, alignItems: 'center', justifyContent: 'center' },
avatarImg: { width: 48, height: 48, borderRadius: 24 },
cardInfo: { flex: 1, gap: 3 },
cardAction: { alignItems: 'stretch' },
});
