import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AuthGate, Button, Card, EmptyState, ErrorState, Input, LoadingState, Section, Text } from '@/components/ui';
import { api } from '@/services/http';
import { messagingApi } from '@/services/endpoints';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { formatRelative } from '@/lib/format';
import { useI18n } from '@/i18n';
import { COLORS, DURATION, EASE } from '@/theme';
import { CallButton } from '@/features/calls/CallButton';

export default function AppConversation() {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const userId = useAuthStore((state) => state.user?.id);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [recording, setRecording] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const thread = useQuery({
    queryKey: queryKeys.messaging.messages(id ?? ''),
    queryFn: () => messagingApi.messages(id ?? '', { limit: 100 }).then((result) => result.data),
    enabled: isAuthenticated && Boolean(id),
    refetchInterval: 4000,
  });

  const send = useMutation({
    mutationFn: (payload?: { body: string; attachments?: string[] }) =>
      messagingApi.send(id ?? '', payload ?? { body: draft.trim() }),
    onSuccess: () => {
      setError(null);
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.messaging.messages(id ?? '') });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
    },
    onError: (caught) => setError(caught),
  });

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) return;
        setUploadingAudio(true);
        try {
          const presign = await api.post<{ media: { id: string; publicUrl?: string; storageKey: string }; uploadUrl: string }>('/media/upload-url', {
            filename: 'note-vocale-' + Date.now() + '.webm',
            mimeType: 'audio/webm',
            sizeBytes: blob.size,
            kind: 'AUDIO',
          });
          await fetch(presign.data.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'audio/webm' } });
          const confirmed = await api.post<{ publicUrl?: string; storageKey: string }>('/media/' + presign.data.media.id + '/confirm');
          const audioUrl = confirmed.data.publicUrl || presign.data.media.publicUrl || presign.data.media.storageKey;
          send.mutate({ body: 'Note vocale', attachments: [audioUrl] });
        } catch (err) {
          setError(err);
        } finally {
          setUploadingAudio(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      setError(err);
    }
  };

  const messages = thread.data?.items ?? [];

  return (
    <Section>
      <AuthGate isAuthenticated={isAuthenticated} title={t('ui.conversation')} description={t('ui.filDeDiscussion')} icon="💬">
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Link to="/app/messages" style={{ fontSize: 13, color: COLORS.slateGray, textDecoration: 'none' }}>{t('ui.retourALaMessagerie')}</Link>
          {id ? <CallButton conversationId={id} /> : null}
        </div>
        <Card tone="white" style={{ display: 'flex', flexDirection: 'column', minHeight: 480 }}>
          {thread.isLoading ? <LoadingState count={4} height={60} /> : thread.isError ? <ErrorState error={thread.error} onRetry={() => void thread.refetch()} showRequestId /> : (
            <>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16, maxHeight: 460 }}>
                {messages.length === 0 ? <EmptyState title={t('ui.aucunMessage')} description={t('ui.envoyezLePremierMessageDeCette')} icon="✉️" /> : (
                  messages.map((message, index) => {
                    const isMine = message.senderId === userId;
                    const isAudio = message.body === 'Note vocale';
                    return (
                      <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: DURATION.fast / 1000, delay: Math.min(index, 12) * 0.02, ease: EASE.out }}
                        style={{ alignSelf: isMine ? 'flex-end' : 'flex-start', maxWidth: '80%', padding: '10px 14px', backgroundColor: isMine ? COLORS.paleGreen : '#f1f5f9', borderRadius: 'var(--radius-md)' }}
                      >
                        <Text preset="bodySm" color={COLORS.textPrimary} style={{ lineHeight: 1.6 }}>{message.body}</Text>
                        {message.attachments.map((att, i) => (
                          <div key={i} style={{ marginTop: 6 }}>
                            {isAudio || att.endsWith('.webm') || att.endsWith('.m4a') || att.endsWith('.mp3') ? (
                              <audio controls src={att} style={{ maxWidth: '100%', height: 34 }} />
                            ) : (
                              <a href={att} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: COLORS.forestGreen }}>Pièce jointe {i + 1}</a>
                            )}
                          </div>
                        ))}
                        <Text preset="caption" color={COLORS.slateGray} style={{ marginTop: 4 }}>{formatRelative(message.createdAt, locale)}</Text>
                      </motion.div>
                    );
                  })
                )}
              </div>
              {error ? <div style={{ marginBottom: 12 }}><ErrorState error={error} showRequestId /></div> : null}
              <form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate(undefined); }} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Input label={t('ui.message')} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('ui.ecrivezVotreMessage')} maxLength={3000} />
                </div>
                <Button type="button" variant={recording ? 'primary' : 'outline'} label={recording ? 'Stop' : 'Vocal'} loading={uploadingAudio} onClick={() => void toggleRecording()} />
                <Button label={t('ui.envoyer')} type="submit" loading={send.isPending} disabled={!draft.trim()} />
              </form>
            </>
          )}
        </Card>
      </AuthGate>
    </Section>
  );
}
