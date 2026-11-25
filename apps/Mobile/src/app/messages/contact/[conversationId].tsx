import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';

import { AppHeader } from '@/components/app/AppHeader';
import { AppImage, AuthGate, Card, Screen, Section, Text } from '@/components/ui';
import { chargerFiche, ficheEnCache, libelleMetier, type FicheConversation } from '@/features/messaging/conversation/conversationApi';
import { useI18n } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

const TYPES: Record<string, [string, string]> = {
  INDIVIDUAL: ['Compte individuel', 'Individual account'],
  COOPERATIVE: ['Coopérative', 'Cooperative'],
  COMPANY: ['Entreprise', 'Company'],
};

/**
 * Fiche de l'interlocuteur, ouverte depuis l'en-tête de la discussion :
 * métier (Agriculteur, Agronome, Chercheur, Étudiant…), type, pays, ancienneté.
 * Aucune donnée de contact privée (le serveur n'en renvoie pas). Hors ligne :
 * dernière fiche connue.
 */
export default function FicheContact() {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated');
  const [fiche, setFiche] = useState<FicheConversation | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    let actif = true;
    void ficheEnCache(conversationId).then((f) => actif && f && setFiche(f));
    void chargerFiche(conversationId).then((f) => actif && f && setFiche(f));
    return () => {
      actif = false;
    };
  }, [conversationId]);

  return (
    <Screen background={COLORS.naturalWhite}>
      <AppHeader title={fr ? 'Contact' : 'Contact'} subtitle={fiche?.isGroup ? (fr ? 'Participants' : 'Participants') : undefined} />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title={fr ? 'Contact' : 'Contact'} icon="person-outline">
          {(fiche?.peers ?? []).map((p) => {
            const metiers = p.roles.map((r) => libelleMetier(r, fr ? 'fr' : 'en')).filter(Boolean);
            return (
              <Card key={p.organizationId} tone="white" style={styles.carte}>
                <View style={styles.identite}>
                  <View style={styles.avatar}>
                    {p.avatarUrl ? (
                      <AppImage uri={p.avatarUrl} style={styles.avatar} radius={RADIUS.pill} />
                    ) : (
                      <Ionicons name={p.type === 'INDIVIDUAL' ? 'person' : 'business'} size={30} color={COLORS.forestGreen} />
                    )}
                  </View>
                  <View style={styles.flex}>
                    <Text preset="h3">{p.name}</Text>
                    <Text preset="bodySm" color={COLORS.slateGray}>
                      {[TYPES[p.type]?.[fr ? 0 : 1] ?? p.type, p.countryCode].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
                {metiers.length > 0 ? (
                  <View style={styles.metiers}>
                    {metiers.map((m) => (
                      <View key={m} style={styles.puce}>
                        <Text preset="caption" color={COLORS.forestGreen}>{m}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {p.memberSince ? (
                  <Text preset="caption" color={COLORS.slateGray}>
                    {fr ? 'Membre depuis ' : 'Member since '}
                    {new Date(p.memberSince).toLocaleDateString(fr ? 'fr-FR' : 'en-GB', { month: 'long', year: 'numeric' })}
                  </Text>
                ) : null}
              </Card>
            );
          })}
          {!fiche ? <Text preset="bodySm" color={COLORS.slateGray}>{fr ? 'Fiche indisponible hors ligne.' : 'Profile unavailable offline.'}</Text> : null}
        </AuthGate>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: SPACING.md },
  carte: { gap: SPACING.md },
  identite: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  avatar: { width: 64, height: 64, borderRadius: RADIUS.pill, backgroundColor: COLORS.paleGreen, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  metiers: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  puce: { backgroundColor: COLORS.paleGreen, borderRadius: RADIUS.pill, paddingHorizontal: SPACING.md, paddingVertical: 4 },
});
