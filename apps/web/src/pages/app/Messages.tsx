import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AuthGate, Button, Card, Chip, EmptyState, ErrorState, Input, LoadingState, Section, Text } from '@/components/ui';
import { api } from '@/services/http';
import { messagingApi } from '@/services/endpoints';
import { queryKeys } from '@/services/query';
import { useAuthStore } from '@/store/auth';
import { formatRelative } from '@/lib/format';
import { useI18n } from '@/i18n';
import { COLORS } from '@/theme';
import { CallButton } from '@/features/calls/CallButton';

type TabKey = 'DIRECT' | 'GROUP' | 'CALLS';

interface EnrichedConv {
  id: string;
  subjectType?: string | null;
  title?: string;
  subtitle?: string;
  unread?: number;
  status: string;
  updatedAt: string;
  adminOrgId?: string | null;
  participants?: Array<{ id: string; name: string; type: string; countryCode: string }>;
  lastMessage?: { body?: string } | null;
}

export default function AppMessages() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { id: routeConvId } = useParams<{ id?: string }>();
  const qc = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated');
  const userId = useAuthStore((s) => s.user?.id);
  const myOrgId = useAuthStore((s) => (s as { activeOrganizationId?: string; tenantId?: string }).activeOrganizationId ?? (s as { tenantId?: string }).tenantId);
  const permissions = useAuthStore((s) => s.permissions);
  const canWrite = permissions.includes('messages.write') || permissions.includes('*');

  const [tab, setTab] = useState<TabKey>('DIRECT');
  const [selectedId, setSelectedId] = useState<string>(routeConvId ?? '');
  const activeId = routeConvId || selectedId;

  const [showComposer, setShowComposer] = useState(false);
  const [composerMode, setComposerMode] = useState<'DIRECT' | 'GROUP'>('DIRECT');
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [pickedOrgs, setPickedOrgs] = useState<string[]>([]);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; body: string } | null>(null);
  const [memberToAdd, setMemberToAdd] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const convsQuery = useQuery({
    queryKey: queryKeys.messaging.conversations,
    queryFn: () => messagingApi.conversations({ limit: 80 }).then((r) => r.data),
    enabled: isAuthenticated,
    refetchInterval: 5000,
  });

  const contactsQuery = useQuery({
    queryKey: ['messaging', 'contacts'],
    queryFn: () => messagingApi.contacts().then((r) => r.data.items ?? []),
    enabled: isAuthenticated,
  });

  const callsQuery = useQuery({
    queryKey: ['calls', 'history'],
    queryFn: () => messagingApi.callsHistory().then((r) => r.data.items ?? []),
    enabled: isAuthenticated && tab === 'CALLS',
    refetchInterval: 10000,
  });

  const threadQuery = useQuery({
    queryKey: queryKeys.messaging.messages(activeId),
    queryFn: () => messagingApi.messages(activeId, { limit: 100 }).then((r) => r.data),
    enabled: isAuthenticated && Boolean(activeId),
    refetchInterval: 4000,
  });

  const selectConv = (cid: string) => {
    setSelectedId(cid);
    setReplyTo(null);
    navigate('/app/messages/' + cid);
  };

  const startDirect = useMutation({
    mutationFn: (targetOrgId: string) =>
      messagingApi.start({ subjectType: 'DIRECT', subjectId: targetOrgId, participantOrgIds: [targetOrgId] }),
    onSuccess: (res) => {
      setShowComposer(false);
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      const cid = (res.data as { id?: string })?.id;
      if (cid) selectConv(cid);
    },
    onError: (err) => setError(err),
  });

  const createGroup = useMutation({
    mutationFn: () => messagingApi.createGroup({ name: groupName.trim(), description: groupDesc.trim() || undefined, participantOrgIds: pickedOrgs }),
    onSuccess: (res) => {
      setShowComposer(false);
      setGroupName('');
      setGroupDesc('');
      setPickedOrgs([]);
      setTab('GROUP');
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      const cid = (res.data as { id?: string })?.id;
      if (cid) selectConv(cid);
    },
    onError: (err) => setError(err),
  });

  const sendMsg = useMutation({
    mutationFn: (payload?: { body: string; attachments?: string[] }) => {
      const prefix = replyTo ? `↪ « ${replyTo.body.slice(0, 60)} »\n` : '';
      const finalBody = payload?.body ?? `${prefix}${draft.trim()}`;
      return messagingApi.send(activeId, { body: finalBody, attachments: payload?.attachments ?? [] });
    },
    onSuccess: () => {
      setError(null);
      setDraft('');
      setReplyTo(null);
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.messages(activeId) });
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
    },
    onError: (err) => setError(err),
  });

  const addMember = useMutation({
    mutationFn: (orgId: string) => messagingApi.addMember(activeId, orgId),
    onSuccess: () => {
      setMemberToAdd('');
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.messages(activeId) });
    },
    onError: (err) => setError(err),
  });

  const removeMember = useMutation({
    mutationFn: (orgId: string) => messagingApi.removeMember(activeId, orgId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversations });
    },
    onError: (err) => setError(err),
  });

  const uploadBlobAndSend = async (blob: Blob, filename: string, mimeType: string, kind: 'AUDIO' | 'DOCUMENT' | 'IMAGE', label: string) => {
    setUploading(true);
    try {
      const presign = await api.post<{ media: { id: string; publicUrl?: string; storageKey: string }; uploadUrl: string }>('/media/upload-url', {
        filename,
        mimeType,
        sizeBytes: blob.size,
        kind,
      });
      await fetch(presign.data.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': mimeType } });
      const confirmed = await api.post<{ publicUrl?: string; storageKey: string }>('/media/' + presign.data.media.id + '/confirm');
      const url = confirmed.data.publicUrl || presign.data.media.publicUrl || presign.data.media.storageKey;
      sendMsg.mutate({ body: label, attachments: [url] });
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  };

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
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size > 0) void uploadBlobAndSend(blob, `note-vocale-${Date.now()}.webm`, 'audio/webm', 'AUDIO', 'Note vocale');
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      setError(err);
    }
  };

  const allConvs = ((convsQuery.data as { items?: EnrichedConv[] } | undefined)?.items ?? []).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const directConvs = allConvs.filter((c) => c.subjectType !== 'GROUP');
  const groupConvs = allConvs.filter((c) => c.subjectType === 'GROUP');
  const activeConv = allConvs.find((c) => c.id === activeId);
  const contacts = (contactsQuery.data ?? []).filter((c) => `${c.name} ${c.type} ${c.countryCode}`.toLowerCase().includes(search.toLowerCase()));
  const calls = callsQuery.data ?? [];
  const messages = (threadQuery.data as { items?: Array<{ id: string; senderId: string; body: string; attachments: string[]; createdAt: string }> } | undefined)?.items ?? [];

  return (
    <Section>
      <AuthGate isAuthenticated={isAuthenticated} title={t('ui.messagerie')} description={t('ui.filDeDiscussion')} icon="💬">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 360px) 1fr', gap: 16, minHeight: 580, alignItems: 'stretch' }}>
          {/* Panneau Gauche : Discussions · Groupes · Appels + Bouton + */}
          <Card tone="white" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text preset="h3" color={COLORS.forestGreen}>{t('ui.messagerie')}</Text>
              {canWrite ? (
                <Button label="+ Nouveau" onClick={() => { setComposerMode(tab === 'GROUP' ? 'GROUP' : 'DIRECT'); setShowComposer((v) => !v); }} />
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 4, borderRadius: 999 }}>
              {([
                { key: 'DIRECT', label: `Discussions (${directConvs.length})` },
                { key: 'GROUP', label: `Groupes (${groupConvs.length})` },
                { key: 'CALLS', label: 'Appels' },
              ] as const).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  style={{
                    flex: 1,
                    border: 'none',
                    borderRadius: 999,
                    padding: '6px 8px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: tab === item.key ? COLORS.forestGreen : 'transparent',
                    color: tab === item.key ? '#fff' : COLORS.forestGreen,
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {showComposer ? (
              <Card tone="pale" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button type="button" variant={composerMode === 'DIRECT' ? 'primary' : 'outline'} label="1-à-1" onClick={() => setComposerMode('DIRECT')} />
                  <Button type="button" variant={composerMode === 'GROUP' ? 'primary' : 'outline'} label="Groupe" onClick={() => setComposerMode('GROUP')} />
                </div>
                {composerMode === 'GROUP' ? (
                  <>
                    <Input label="Nom du groupe" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Ex: Équipe Logistique" />
                    <Input label="Objectif" value={groupDesc} onChange={(e) => setGroupDesc(e.target.value)} placeholder="Optionnel" />
                  </>
                ) : null}
                <Input label="Rechercher un contact" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, type, pays..." />
                <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {contacts.map((c) => {
                    const checked = pickedOrgs.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => (composerMode === 'DIRECT' ? startDirect.mutate(c.id) : setPickedOrgs((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id])))}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: checked ? '#dcfce7' : '#fff', cursor: 'pointer', textAlign: 'left' }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.forestGreen }}>{c.name}</span>
                        <span style={{ fontSize: 11, color: COLORS.slateGray }}>{(c as { role?: string }).role ?? c.type} · {(c as { agency?: string }).agency ?? c.countryCode}</span>
                      </button>
                    );
                  })}
                </div>
                {composerMode === 'GROUP' ? (
                  <Button label={`Créer le groupe (${pickedOrgs.length})`} disabled={groupName.trim().length < 2 || pickedOrgs.length === 0} loading={createGroup.isPending} onClick={() => createGroup.mutate()} />
                ) : null}
              </Card>
            ) : null}

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tab === 'CALLS' ? (
                callsQuery.isLoading ? <LoadingState count={3} height={54} /> : calls.length === 0 ? (
                  <EmptyState title="Aucun appel" description="Vos appels entrants, sortants et manqués apparaîtront ici." icon="📞" />
                ) : (
                  calls.map((c) => {
                    const sec = c.startedAt && c.endedAt ? Math.max(1, Math.round((new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000)) : null;
                    return (
                      <div key={c.id} onClick={() => selectConv(c.conversationId)} style={{ padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Text preset="bodySm" color={COLORS.forestGreen}>{c.initiator ? `${c.initiator.firstName ?? ''} ${c.initiator.lastName ?? ''}`.trim() : 'Appel audio'}</Text>
                          <Chip label={c.status} tone={c.status === 'MISSED' || c.status === 'DECLINED' ? 'warning' : 'success'} size="sm" />
                        </div>
                        <Text preset="caption" color={COLORS.slateGray}>{formatRelative(c.startedAt, locale)}{sec !== null ? ` · ${sec}s` : ''}</Text>
                      </div>
                    );
                  })
                )
              ) : convsQuery.isLoading ? (
                <LoadingState count={4} height={62} />
              ) : convsQuery.isError ? (
                <ErrorState error={convsQuery.error} onRetry={() => void convsQuery.refetch()} />
              ) : (
                (tab === 'DIRECT' ? directConvs : groupConvs).map((conv) => {
                  const selected = conv.id === activeId;
                  return (
                    <div
                      key={conv.id}
                      onClick={() => selectConv(conv.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: 10,
                        borderRadius: 10,
                        cursor: 'pointer',
                        background: selected ? COLORS.paleGreen : '#f8fafc',
                        border: selected ? `1px solid ${COLORS.forestGreen}` : '1px solid #e2e8f0',
                      }}
                    >
                      <div style={{ width: 38, height: 38, borderRadius: 19, background: COLORS.forestGreen, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
                        {(conv.title ?? 'DI').slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                          <Text preset="bodySm" color={COLORS.forestGreen} style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.title ?? 'Discussion'}</Text>
                          <Text preset="caption" color={COLORS.slateGray}>{formatRelative(conv.updatedAt, locale)}</Text>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 2 }}>
                          <Text preset="caption" color={COLORS.slateGray} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.lastMessage?.body ?? conv.subtitle}</Text>
                          {(conv.unread ?? 0) > 0 ? (
                            <span style={{ background: '#dc2626', color: '#fff', borderRadius: 999, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>{conv.unread}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* Panneau Droit : Fil de discussion actif, Groupes & Appels */}
          <Card tone="white" style={{ display: "flex", flexDirection: "column", minHeight: 580, padding: 16 }}>
            {!activeId ? (
              <EmptyState title="Sélectionnez une discussion" description="Choisissez une conversation à gauche ou cliquez sur « + Nouveau » pour démarrer un échange ou créer un groupe." icon="💬" />
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottom: "1px solid #e2e8f0", gap: 12 }}>
                  <div>
                    <Text preset="h3" color={COLORS.forestGreen}>{activeConv?.title ?? "Conversation"}</Text>
                    <Text preset="caption" color={COLORS.slateGray}>{activeConv?.subtitle ?? ""}</Text>
                  </div>
                  <CallButton conversationId={activeId} />
                </div>

                {activeConv?.subjectType === "GROUP" && activeConv.participants ? (
                  <div style={{ padding: "8px 10px", background: "#f8fafc", borderRadius: 8, marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    {activeConv.participants.map((p) => (
                      <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#e2e8f0", borderRadius: 999, padding: "2px 8px", fontSize: 11 }}>
                        {p.name}{p.id === activeConv.adminOrgId ? " (Admin)" : ""}
                        {activeConv.adminOrgId === myOrgId && p.id !== myOrgId ? (
                          <button type="button" onClick={() => removeMember.mutate(p.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#dc2626", fontWeight: 700 }}>×</button>
                        ) : null}
                      </span>
                    ))}
                    {activeConv.adminOrgId === myOrgId ? (
                      <select value={memberToAdd} onChange={(e) => { if (e.target.value) addMember.mutate(e.target.value); }} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 6 }}>
                        <option value="">+ Ajouter un membre...</option>
                        {(contactsQuery.data ?? []).filter((c) => !activeConv.participants?.some((p) => p.id === c.id)).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                ) : null}

                <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "14px 4px", maxHeight: 420 }}>
                  {threadQuery.isLoading ? <LoadingState count={3} height={50} /> : messages.map((m) => {
                    const isMine = m.senderId === userId;
                    return (
                      <div key={m.id} style={{ alignSelf: isMine ? "flex-end" : "flex-start", maxWidth: "78%", padding: "10px 14px", borderRadius: 12, background: isMine ? COLORS.paleGreen : "#f1f5f9" }}>
                        <Text preset="bodySm" color={COLORS.textPrimary} style={{ whiteSpace: "pre-wrap" }}>{m.body}</Text>
                        {m.attachments.map((att, idx) => (
                          <div key={idx} style={{ marginTop: 6 }}>
                            {m.body === "Note vocale" || /\.(webm|m4a|mp3|ogg|wav)$/i.test(att) ? (
                              <audio controls src={att} style={{ maxWidth: "100%", height: 34 }} />
                            ) : (
                              <a href={att} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: COLORS.forestGreen }}>Ouvrir la pièce jointe {idx + 1}</a>
                            )}
                          </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 4 }}>
                          <Text preset="caption" color={COLORS.slateGray}>{formatRelative(m.createdAt, locale)}</Text>
                          <button type="button" onClick={() => setReplyTo({ id: m.id, body: m.body })} style={{ border: "none", background: "transparent", color: COLORS.forestGreen, fontSize: 11, cursor: "pointer" }}>Répondre</button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {replyTo ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: COLORS.paleGreen, padding: "6px 10px", borderRadius: 8, marginBottom: 8 }}>
                    <Text preset="caption" color={COLORS.forestGreen}>Réponse à : « {replyTo.body.slice(0, 70)} »</Text>
                    <button type="button" onClick={() => setReplyTo(null)} style={{ border: "none", background: "transparent", cursor: "pointer" }}>✕</button>
                  </div>
                ) : null}

                {error ? <div style={{ marginBottom: 8 }}><ErrorState error={error} /></div> : null}

                <form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) sendMsg.mutate(undefined); }} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <Input label={t("ui.message")} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("ui.ecrivezVotreMessage")} maxLength={3000} />
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf,.doc,.docx"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadBlobAndSend(file, file.name, file.type || "application/octet-stream", file.type.startsWith("image/") ? "IMAGE" : "DOCUMENT", "Fichier : " + file.name);
                    }}
                  />
                  <Button type="button" variant="outline" label="Fichier" loading={uploading} onClick={() => fileInputRef.current?.click()} />
                  <Button type="button" variant={recording ? "primary" : "outline"} label={recording ? "Stop" : "Vocal"} loading={uploading} onClick={() => void toggleRecording()} />
                  <Button type="submit" label={t("ui.envoyer")} loading={sendMsg.isPending} disabled={!draft.trim()} />
                </form>
              </>
            )}
          </Card>
        </div>
      </AuthGate>
    </Section>
  );
}
