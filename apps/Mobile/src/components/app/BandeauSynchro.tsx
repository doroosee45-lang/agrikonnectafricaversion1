import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOnlineManager } from '@/components/app/useOnlineManager';

import { Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import {
  abonnerEcritures,
  rejouerEcritures,
  resumeFile,
  supprimerEcriture,
} from '@/services/ecrituresHorsLigne';
import type { EcritureEnAttente } from '@/services/fileEcritures';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

/**
 * Bandeau d'état hors ligne : « Hors ligne », écritures en attente
 * d'envoi (exploitations, parcelles, récoltes) et refus du serveur, avec
 * « Synchroniser ». Rien n'est affiché quand tout est envoyé et en ligne.
 */
export function BandeauSynchro() {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const enLigne = useOnlineManager();
  const [file, setFile] = useState<EcritureEnAttente[]>([]);
  useEffect(() => abonnerEcritures(setFile), []);
  const { enAttente, refusees } = resumeFile(file);

  if (enLigne && file.length === 0) return null;

  const details = () =>
    Alert.alert(
      fr ? 'Envois en attente' : 'Pending uploads',
      file
        .map((e) => `• ${e.libelle}${e.refusDefinitif ? (fr ? ` — refusé : ${e.erreur ?? ''}` : ` — rejected: ${e.erreur ?? ''}`) : ''}`)
        .join('\n') || (fr ? 'Rien en attente.' : 'Nothing pending.'),
      [
        ...(refusees > 0
          ? [{
              text: fr ? 'Retirer les refusés' : 'Remove rejected',
              style: 'destructive' as const,
              onPress: () => file.filter((e) => e.refusDefinitif).forEach((e) => void supprimerEcriture(e.id)),
            }]
          : []),
        { text: 'OK' },
      ],
    );

  return (
    <Pressable onPress={details} accessibilityRole="button" style={[styles.bandeau, refusees > 0 ? styles.alerte : enLigne ? styles.attente : styles.horsLigne]}>
      <Ionicons name={enLigne ? (refusees > 0 ? 'alert-circle' : 'cloud-upload-outline') : 'cloud-offline-outline'} size={16} color={COLORS.textPrimary} />
      <Text preset="caption" color={COLORS.textPrimary} style={styles.flex} numberOfLines={2}>
        {!enLigne ? (fr ? 'Hors ligne — vos saisies sont gardées sur le téléphone. ' : 'Offline — your entries are kept on the phone. ') : ''}
        {enAttente > 0 ? (fr ? `${enAttente} envoi(s) en attente.` : `${enAttente} pending.`) : ''}
        {refusees > 0 ? (fr ? ` ${refusees} refusé(s) par le serveur.` : ` ${refusees} rejected.`) : ''}
      </Text>
      {enLigne && enAttente > 0 ? (
        <Pressable onPress={() => void rejouerEcritures()} hitSlop={8} accessibilityRole="button" accessibilityLabel={fr ? 'Synchroniser' : 'Sync'}>
          <Ionicons name="refresh" size={18} color={COLORS.forestGreen} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bandeau: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.lg, marginTop: SPACING.sm },
  horsLigne: { backgroundColor: '#F0E2CC' },
  attente: { backgroundColor: '#E4EEF8' },
  alerte: { backgroundColor: '#FEF2F2' },
  flex: { flex: 1 },
});
