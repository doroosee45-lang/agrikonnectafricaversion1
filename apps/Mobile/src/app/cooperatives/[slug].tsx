import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';

import { AppHeader } from '@/components/app/AppHeader';
import { Card, Chip, ErrorState, LoadingState, Screen, Section, Text } from '@/components/ui';
import { publicApi } from '@/services/api/endpoints';
import { COLORS } from '@/theme/colors';
import { SPACING } from '@/theme/space';

export default function CooperativeDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const query = useQuery({
    queryKey: ['public-organizations', slug ?? ''],
    queryFn: () => publicApi.organization(slug ?? '').then((result) => result.data),
    enabled: Boolean(slug),
  });
  const organization = query.data;
  const profile = organization?.profile;

  return (
    <Screen background={COLORS.naturalWhite}>
      <AppHeader title={profile?.tradingName ?? organization?.name ?? 'Organisation'} subtitle="Profil public" />
      <Section bare contentStyle={styles.section}>
        {query.isLoading ? (
          <LoadingState count={2} height={120} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : organization ? (
          <>
            <Card tone="white" style={styles.card}>
              <Text preset="h2">{profile?.officialName ?? organization.name}</Text>
              <View style={styles.chips}>
                <Chip label={organization.type} tone="neutral" size="sm" />
                <Chip label={organization.countryCode} tone="neutral" size="sm" />
                {profile?.sector ? <Chip label={profile.sector} tone="info" size="sm" /> : null}
              </View>
              {profile?.description ? <Text preset="bodySm" color={COLORS.slateGray}>{profile.description}</Text> : null}
              {profile?.activities?.length ? <Text preset="caption">Activités : {profile.activities.join(', ')}</Text> : null}
              {profile?.locations?.length ? <Text preset="caption">Implantations : {profile.locations.join(', ')}</Text> : null}
              {profile?.partners?.length ? <Text preset="caption">Partenaires : {profile.partners.join(', ')}</Text> : null}
            </Card>
            {profile?.officialPhone || profile?.institutionalEmail || profile?.website ? (
              <Card tone="white" style={styles.card}>
                <Text preset="h3">Coordonnées publiques</Text>
                {profile.officialPhone ? <Text preset="bodySm">{profile.officialPhone}</Text> : null}
                {profile.institutionalEmail ? <Text preset="bodySm">{profile.institutionalEmail}</Text> : null}
                {profile.website ? <Text preset="bodySm">{profile.website}</Text> : null}
              </Card>
            ) : null}
          </>
        ) : null}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: SPACING.sm, paddingBottom: SPACING.xxl, gap: SPACING.md },
  card: { gap: SPACING.sm },
  chips: { flexDirection: 'row', gap: SPACING.xs, flexWrap: 'wrap' },
});
