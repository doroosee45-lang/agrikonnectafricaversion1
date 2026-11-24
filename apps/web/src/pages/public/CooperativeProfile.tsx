import { useParams } from 'react-router-dom';

import { DetailPage } from '@/components/pages';
import { publicApi } from '@/services/endpoints';
import type { PublicOrganization } from '@/services/types';
import { Chip } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/i18n';

export default function PublicCooperativeProfile() {
  const { t, locale } = useI18n();
  const { slug } = useParams<{ slug: string }>();

  return (
    <DetailPage<PublicOrganization>
      public
      title={(organization) => organization.profile.tradingName ?? organization.name}
      subtitle={t('ui.profilPublieDeLaCooperative')}
      backHref="/public/cooperatives"
      backLabel={t('ui.retourAuxCooperatives')}
      queryKey={['public-organizations', slug ?? '']}
      fetch={() => publicApi.organization(slug ?? '').then((result) => result.data)}
      sections={(organization) => [
        {
          title: t('ui.identite'),
          fields: [
            { label: t('ui.nom'), value: organization.profile.officialName ?? organization.name },
            { label: t('ui.type'), value: <Chip label={organization.type} tone="neutral" size="sm" /> },
            { label: t('ui.pays'), value: organization.countryCode },
            ...(organization.profile.sector ? [{ label: 'Secteur', value: organization.profile.sector }] : []),
            { label: t('ui.enregistreeLe'), value: formatDate(organization.createdAt, locale) },
          ],
        },
        {
          title: t('ui.description'),
          fields: [
            { label: t('ui.presentation'), value: organization.profile.description ?? t('ui.aucuneDescriptionPubliee') },
            ...(organization.profile.activities?.length ? [{ label: 'Activités', value: organization.profile.activities.join(', ') }] : []),
            ...(organization.profile.locations?.length ? [{ label: 'Implantations', value: organization.profile.locations.join(', ') }] : []),
            ...(organization.profile.partners?.length ? [{ label: 'Partenaires', value: organization.profile.partners.join(', ') }] : []),
          ],
        },
        ...(organization.profile.officialPhone ||
        organization.profile.institutionalEmail ||
        organization.profile.website
          ? [{
              title: 'Coordonnées publiques',
              fields: [
                ...(organization.profile.officialPhone ? [{ label: 'Téléphone', value: organization.profile.officialPhone }] : []),
                ...(organization.profile.institutionalEmail ? [{ label: 'E-mail', value: organization.profile.institutionalEmail }] : []),
                ...(organization.profile.website ? [{ label: 'Site', value: organization.profile.website }] : []),
              ],
            }]
          : []),
      ]}
      notFoundTitle={t('ui.cooperativeIntrouvable')}
      notFoundDescription={t('ui.ceProfilNEstPasPublie')}
    />
  );
}
