import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';

import { FarmerHeader } from '@/components/farmer/FarmerHeader';
import { AuthGate, Button, Card, ErrorState, Input, Screen, Section, Text } from '@/components/ui';
import { ENREGISTRE_HORS_LIGNE, ecrireOuMettreEnFile } from '@/services/ecrituresHorsLigne';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { SPACING } from '@/theme/space';
import { useI18n } from '@/i18n';

export default function FarmerFarmCreate() {
  const { t } = useI18n();
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('CD');
  const [province, setProvince] = useState('');
  const [error, setError] = useState<unknown>(null);

  // Hors ligne : l'exploitation est gardée sur le téléphone et envoyée au retour du réseau.
  const create = useMutation({
    mutationFn: () =>
      ecrireOuMettreEnFile({
        methode: 'POST',
        url: '/farms',
        corps: { name: name.trim(), countryCode, province: province.trim() || undefined },
        libelle: `${t('ui.nouvelleExploitation')} « ${name.trim()} »`,
        invalider: [queryKeys.farms.all as unknown as string[], queryKeys.me as unknown as string[]],
      }),
    onSuccess: (resultat) => {
      setError(null);
      if (resultat.enFile) Alert.alert(t('ui.nouvelleExploitation'), ENREGISTRE_HORS_LIGNE);
      router.push('/farmer/farms');
    },
    onError: (caught) => setError(caught),
  });

  return (
    <Screen background={COLORS.naturalWhite}>
      <FarmerHeader title={t('ui.nouvelleExploitation')} subtitle={t('ui.lesInformationsSaisiesSontMarqueesDeclarees')} />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title={t('ui.nouvelleExploitation')} icon="add-circle-outline">
          <Card tone="white">
            <View style={styles.form}>
              <Input label={t('ui.nom')} value={name} onChangeText={setName} />
              <View style={styles.row2}>
                <Input label={t('ui.codePays')} value={countryCode} onChangeText={(v) => setCountryCode(v.toUpperCase().slice(0, 2))} maxLength={2} />
                <Input label={t('ui.province')} value={province} onChangeText={setProvince} />
              </View>
              {error ? <ErrorState error={error} /> : null}
              <Button label={t('ui.creer')} onPress={() => create.mutate()} loading={create.isPending} disabled={!name.trim()} />
            </View>
          </Card>
        </AuthGate>
      </Section>
    </Screen>
  );
}
const styles = StyleSheet.create({ section: { paddingTop: SPACING.sm, paddingBottom: SPACING.xxl, gap: SPACING.md }, form: { gap: SPACING.md }, row2: { flexDirection: 'row', gap: SPACING.sm } });
