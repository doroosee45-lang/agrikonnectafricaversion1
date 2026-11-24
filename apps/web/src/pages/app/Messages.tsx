import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';

import { AuthGate, Button, Card, Chip, EmptyState, ErrorState, LoadingState, Section, Text } from '@/components/ui';
import { messagingApi } from '@/services/endpoints';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { formatRelative } from '@/lib/format';
import { useI18n } from '@/i18n';
import { COLORS, DURATION, EASE } from '@/theme';

export default function AppMessages() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const [selectedOrgId, setSelectedOrgId] = useState('');

  const query = useQuery({
    queryKey: queryKeys.messaging.conversations,
    queryFn: () => messagingApi.conversations({ limit: 50 }).then((result) => result.data),
    enabled: isAuthenticated,
  });

  const contactsQuery = useQuery({
    queryKey: ['messaging', 'contacts'],
    queryFn: () => messagingApi.contacts().then((r) => r.data.items),
    enabled: isAuthenticated,
  });

  const startConv = useMutation({
    mutationFn: (targetOrgId: string) =>
      messagingApi.start({ subjectType: 'DIRECT', subjectId: targetOrgId, participantOrgIds: [targetOrgId] }),
    onSuccess: (res) => {
      const convId = (res.data as { id?: string })?.id;
      if (convId) navigate('/app/messages/' + convId);
    },
  });

  const items = query.data?.items ?? [];
  const contacts = contactsQuery.data ?? [];

  return (
    <Section>
      <AuthGate isAuthenticated={isAuthenticated} title={t('ui.messagerie')} description={t('ui.filDeDiscussion')} icon="💬">
        <div style={{ marginBottom: 16 }}>
          <Text preset="h2" color={COLORS.forestGreen}>{t('ui.conversations')}</Text>
        </div>
        <Card tone="pale" style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)} style={{ flex: 1, minWidth: 220, padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff' }}>
            <option value="">Choisir un contact / coopérative / producteur...</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type} - {c.countryCode})</option>)}
          </select>
          <Button label="Démarrer une discussion" disabled={!selectedOrgId} loading={startConv.isPending} onClick={() => { if (selectedOrgId) startConv.mutate(selectedOrgId); }} />
        </Card>
        {query.isLoading ? <LoadingState count={3} height={80} /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} showRequestId /> : items.length === 0 ? (
          <EmptyState title={t('ui.aucuneConversation')} description="Sélectionnez un contact ci-dessus pour démarrer votre première discussion ou appel audio." icon="💬" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((conversation, index) => (
              <motion.div key={conversation.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DURATION.base / 1000, delay: Math.min(index, 8) * 0.04, ease: EASE.out }}>
                <Link to={'/app/messages/' + conversation.id} style={{ textDecoration: 'none' }}>
                  <Card tone="white">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <div>
                        <Text preset="h3" color={COLORS.forestGreen}>{conversation.subjectType ?? 'DIRECT'}</Text>
                        <Text preset="caption" color={COLORS.slateGray}>{t('ui.miseAJour')}{formatRelative(conversation.updatedAt, locale)}</Text>
                      </div>
                      <Chip label={conversation.status} tone="info" size="sm" />
                    </div>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </AuthGate>
    </Section>
  );
}
