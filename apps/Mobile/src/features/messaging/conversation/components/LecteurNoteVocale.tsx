import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { Text } from '@/components/ui';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

import { formatDuree } from '../messageContent';

/** Lecture d'une note vocale : fichier local (hors ligne) ou URL signée. */
export function LecteurNoteVocale({ source, dureeSec, mien }: { source: string | null; dureeSec: number | null; mien: boolean }) {
  const player = useAudioPlayer(source ? { uri: source } : null);
  const statut = useAudioPlayerStatus(player);
  const couleur = mien ? COLORS.pureWhite : COLORS.forestGreen;
  const total = statut.duration > 0 ? statut.duration : dureeSec ?? 0;
  const progression = total > 0 ? Math.min(1, statut.currentTime / total) : 0;

  useEffect(() => {
    if (statut.didJustFinish) void player.seekTo(0);
  }, [statut.didJustFinish, player]);

  const basculer = () => {
    if (!source) return;
    if (statut.playing) player.pause();
    else player.play();
  };

  return (
    <View style={styles.ligne}>
      <Pressable
        onPress={basculer}
        disabled={!source}
        accessibilityRole="button"
        accessibilityLabel={statut.playing ? 'Pause' : 'Lire la note vocale'}
        style={[styles.bouton, { borderColor: couleur, opacity: source ? 1 : 0.4 }]}
      >
        <Ionicons name={statut.playing ? 'pause' : 'play'} size={18} color={couleur} />
      </Pressable>
      <View style={styles.flex}>
        <View style={[styles.piste, { backgroundColor: mien ? 'rgba(255,255,255,0.3)' : COLORS.lightBorder }]}>
          <View style={[styles.avance, { width: `${progression * 100}%`, backgroundColor: couleur }]} />
        </View>
        <Text preset="caption" color={mien ? 'rgba(255,255,255,0.85)' : COLORS.slateGray}>
          {statut.playing || statut.currentTime > 0 ? formatDuree(statut.currentTime) : formatDuree(total)}
          {source ? '' : ' · …'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minWidth: 200 },
  bouton: { width: 36, height: 36, borderRadius: RADIUS.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 4 },
  piste: { height: 4, borderRadius: 2, overflow: 'hidden' },
  avance: { height: 4 },
});
