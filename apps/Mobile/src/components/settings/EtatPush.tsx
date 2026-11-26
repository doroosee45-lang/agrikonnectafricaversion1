import { useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';

import { Button, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import {
  PUSH_DEMANDE,
  abonnerDiagnosticPush,
  enregistrerAppareilPush,
  envoyerNotificationTest,
  lireDiagnosticPush,
  type DiagnosticPush,
  type EtapePush,
} from '@/services/pushNotifications';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

const LIBELLES: Record<EtapePush, { fr: string; en: string; icone: keyof typeof Ionicons.glyphMap; couleur: string }> = {
  inactif: { fr: 'Désactivées dans ce build', en: 'Disabled in this build', icone: 'notifications-off-outline', couleur: COLORS.slateGray },
  'non-natif': { fr: 'Indisponibles ici', en: 'Unavailable here', icone: 'notifications-off-outline', couleur: COLORS.slateGray },
  'en-cours': { fr: 'Enregistrement…', en: 'Registering…', icone: 'sync-outline', couleur: COLORS.info },
  'permission-refusee': { fr: 'Autorisation refusée', en: 'Permission denied', icone: 'alert-circle', couleur: COLORS.error },
  'firebase-absent': { fr: 'Firebase indisponible', en: 'Firebase unavailable', icone: 'alert-circle', couleur: COLORS.error },
  'jeton-absent': { fr: 'Aucun jeton FCM', en: 'No FCM token', icone: 'alert-circle', couleur: COLORS.error },
  'envoi-echoue': { fr: 'Serveur injoignable', en: 'Server unreachable', icone: 'cloud-offline-outline', couleur: COLORS.warning },
  enregistre: { fr: 'Actives sur cet appareil', en: 'Active on this device', icone: 'checkmark-circle', couleur: COLORS.success },
};

/**
 * État RÉEL des notifications push sur cet appareil (étape atteinte et raison),
 * « Réessayer » et notification de test. Affiché dès que le build a le
 * drapeau push, y compris quand l'enregistrement échoue.
 */
export function EtatPush() {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const [diag, setDiag] = useState<DiagnosticPush>(lireDiagnosticPush());
  useEffect(() => abonnerDiagnosticPush(setDiag), []);

  const reessayer = useMutation({ mutationFn: enregistrerAppareilPush });
  const test = useMutation({
    mutationFn: envoyerNotificationTest,
    onSuccess: (bilan) =>
      Alert.alert(
        fr ? 'Notification de test' : 'Test notification',
        bilan.disabled
          ? fr ? 'Le serveur n’a pas de configuration FCM active (PUSH_ENABLED).' : 'The server has no active FCM configuration (PUSH_ENABLED).'
          : fr
            ? `${bilan.sent} envoyée(s), ${bilan.failed} échec(s) sur ${bilan.appareilsActifs} appareil(s).`
            : `${bilan.sent} sent, ${bilan.failed} failed on ${bilan.appareilsActifs} device(s).`,
      ),
    onError: (e) => Alert.alert(fr ? 'Échec de l’envoi' : 'Sending failed', e instanceof Error ? e.message : String(e)),
  });

  if (!PUSH_DEMANDE) return null;
  const l = LIBELLES[diag.etape];

  return (
    <View style={styles.bloc}>
      <View style={styles.ligne}>
        <Ionicons name={l.icone} size={18} color={l.couleur} />
        <Text preset="bodyMedium" color={l.couleur} style={styles.flex}>
          {fr ? 'Notifications push : ' : 'Push notifications: '}
          {fr ? l.fr : l.en}
        </Text>
      </View>
      {diag.detail ? (
        <Text preset="caption" color={COLORS.slateGray} selectable>{diag.detail}</Text>
      ) : null}
      <View style={styles.actions}>
        {diag.etape !== 'enregistre' ? (
          <Button
            label={fr ? 'Réessayer' : 'Retry'}
            icon="refresh"
            variant="outline"
            size="sm"
            loading={reessayer.isPending || diag.etape === 'en-cours'}
            onPress={() => reessayer.mutate()}
          />
        ) : null}
        {diag.etape === 'permission-refusee' ? (
          <Button label={fr ? 'Réglages' : 'Settings'} icon="settings-outline" variant="ghost" size="sm" onPress={() => void Linking.openSettings()} />
        ) : null}
        <Button
          label={fr ? 'Envoyer une notification de test' : 'Send a test notification'}
          icon="notifications-outline"
          variant="ghost"
          size="sm"
          disabled={diag.etape !== 'enregistre'}
          loading={test.isPending}
          onPress={() => test.mutate()}
          testID="push-test-button"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { gap: SPACING.xs, marginTop: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: '#F4F8F5' },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs },
});
