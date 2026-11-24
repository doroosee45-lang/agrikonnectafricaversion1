import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { AppHeader } from '@/components/app/AppHeader';
import { AuthGate, Button, Card, Input, Screen, Section, Text } from '@/components/ui';
import { localDb } from '@/db/database';
import type { LocalMessage } from '@/db/models';
import { offlineSyncEngine } from '@/services/OfflineSyncEngine';
import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { COLORS } from '@/theme/colors';
import { CallButton } from '@/features/calls/CallButton';
import { SPACING } from '@/theme/space';

export default function ConversationDetail() {
  const { t, locale } = useI18n();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated');
  const userId = useAuthStore((s) => s.user?.id ?? 'local-user');

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [sending, setSending] = useState(false);

  // SSOT : L'interface lit UNIQUEMENT depuis localDb (SQLite / localStorage)
  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    const loadFromLocalDb = async () => {
      const rows = await localDb.getMessagesByRoom(conversationId);
      if (active) setMessages(rows);
    };
    void loadFromLocalDb();
    const unsub = localDb.subscribe(() => { void loadFromLocalDb(); });
    void offlineSyncEngine.syncNow();
    return () => { active = false; unsub(); };
  }, [conversationId]);

  const handleSend = async () => {
    const trimmed = body.trim();
    if (!trimmed || !conversationId || sending) return;
    setSending(true);
    try {
      const finalContent = replyTo ? '↪ « ' + replyTo.content.slice(0, 60) + ' »\n' + trimmed : trimmed;
      await offlineSyncEngine.sendTextMessage({
        roomId: conversationId,
        senderId: userId,
        content: finalContent,
      });
      setBody('');
      setReplyTo(null);
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen background={COLORS.naturalWhite}>
      <AppHeader title={t('ui.conversation')} subtitle="Mode hors-ligne actif (SSOT)" />
      <Section bare contentStyle={styles.section}>
        <AuthGate isAuthenticated={isAuthenticated} title={t('ui.conversation')} icon="chatbubbles-outline">
          <View style={styles.toolbar}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={COLORS.forestGreen} />
              <Text preset="bodySm" color={COLORS.forestGreen}>Discussions</Text>
            </Pressable>
            {conversationId ? <CallButton conversationId={conversationId} /> : null}
          </View>

          <View style={styles.list}>
            {messages.map((item) => {
              const isMine = item.sender_id === userId;
              const statusIcon =
                item.sync_status === 'SENT'
                  ? { name: 'checkmark-done' as const, color: COLORS.forestGreen, label: 'Envoyé' }
                  : item.sync_status === 'FAILED'
                    ? { name: 'alert-circle-outline' as const, color: '#dc2626', label: 'Nouvelle tentative...' }
                    : { name: 'time-outline' as const, color: '#b45309', label: 'En attente réseau' };

              return (
                <Card key={item.local_temp_id} tone={isMine ? 'pale' : 'white'} style={styles.message}>
                  <Text preset="bodySm">{item.content}</Text>
                  {item.attachments.map((att, idx) => (
                    <Button key={idx} label="Écouter / Ouvrir la pièce jointe" variant="outline" onPress={() => void Linking.openURL(att)} />
                  ))}
                  <View style={styles.metaRow}>
                    <Text preset="caption" color={COLORS.slateGray}>{formatDate(new Date(item.created_at).toISOString(), locale)}</Text>
                    <View style={styles.statusRow}>
                      {isMine ? (
                        <View style={styles.statusRow}>
                          <Ionicons name={statusIcon.name} size={14} color={statusIcon.color} />
                          <Text preset="caption" color={statusIcon.color} style={{ fontSize: 10 }}>{statusIcon.label}</Text>
                        </View>
                      ) : null}
                      <Pressable onPress={() => setReplyTo(item)}>
                        <Text preset="caption" color={COLORS.forestGreen}>Répondre</Text>
                      </Pressable>
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>

          <Card tone="white">
            {replyTo ? (
              <View style={styles.replyBanner}>
                <Text preset="caption" color={COLORS.forestGreen} style={{ flex: 1 }} numberOfLines={1}>
                  Réponse à : « {replyTo.content} »
                </Text>
                <Pressable onPress={() => setReplyTo(null)}>
                  <Ionicons name="close" size={18} color={COLORS.slateGray} />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.inputRow}>
              <Input label="" value={body} onChangeText={setBody} placeholder={t('ui.ecrireUnMessage')} containerStyle={styles.input} />
              <Button label={t('ui.envoyer')} onPress={() => void handleSend()} loading={sending} disabled={body.trim().length === 0} />
            </View>
          </Card>
        </AuthGate>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: SPACING.sm, paddingBottom: 100, gap: SPACING.md },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  list: { gap: SPACING.sm, marginBottom: SPACING.md },
  message: { gap: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  replyBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.paleGreen, padding: 6, borderRadius: 6, marginBottom: 6 },
  inputRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-end' },
  input: { flex: 1 },
});
