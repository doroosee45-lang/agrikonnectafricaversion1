import { Stack, useLocalSearchParams } from 'expo-router';

import { AuthGate, Screen } from '@/components/ui';
import { EcranConversation } from '@/features/messaging/conversation/EcranConversation';
import { useI18n } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';

/**
 * Discussion 1-à-1 : l'écran complet vit dans
 * `features/messaging/conversation/` (en-tête, fil, barre de saisie).
 */
export default function ConversationDetail() {
  const { t } = useI18n();
  const { conversationId, title } = useLocalSearchParams<{ conversationId: string; title?: string }>();
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated');

  if (!isAuthenticated || !conversationId) {
    return (
      <Screen background={COLORS.naturalWhite}>
        <AuthGate isAuthenticated={isAuthenticated} title={t('ui.conversation')} icon="chatbubbles-outline">
          {null}
        </AuthGate>
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <EcranConversation conversationId={conversationId} titreDeRepli={title ?? t('ui.conversation')} />
    </>
  );
}
