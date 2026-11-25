import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';

/**
 * Note vocale légère pour le réseau rural : AAC mono 32 kb/s (~240 Ko/min),
 * bien sous le plafond serveur de 5 Mo (≈ 20 min). Fichier .m4a (audio/mp4).
 */
export const OPTIONS_NOTE_VOCALE: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

/** Durée maximale d'une note (le serveur refuse au-delà de 5 Mo). */
export const DUREE_MAX_NOTE_MS = 10 * 60 * 1000;
/** En dessous, l'appui est considéré comme accidentel : rien n'est envoyé. */
export const DUREE_MIN_NOTE_MS = 800;

export type ResultatNote = { uri: string; dureeMs: number } | null;

export function useNoteVocale() {
  const recorder = useAudioRecorder(OPTIONS_NOTE_VOCALE);
  const [enregistre, setEnregistre] = useState(false);
  const [dureeMs, setDureeMs] = useState(0);
  const debut = useRef(0);
  const minuterie = useRef<ReturnType<typeof setInterval> | null>(null);
  // Démarrage asynchrone (permission, préparation) : l'arrêt l'attend, même
  // si l'appui est relâché avant qu'il ne soit terminé (aucun enregistrement orphelin).
  const demarrage = useRef<Promise<boolean> | null>(null);

  const arreterMinuterie = () => {
    if (minuterie.current) clearInterval(minuterie.current);
    minuterie.current = null;
  };

  /** Démarre ; `false` si le micro est refusé. */
  const demarrer = useCallback((): Promise<boolean> => {
    if (demarrage.current) return demarrage.current;
    demarrage.current = (async () => {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) return false;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      debut.current = Date.now();
      setDureeMs(0);
      setEnregistre(true);
      minuterie.current = setInterval(() => setDureeMs(Date.now() - debut.current), 250);
      return true;
    })().catch(() => false);
    return demarrage.current;
  }, [recorder]);

  /** Arrête ; renvoie le fichier, ou `null` si annulé ou trop court. */
  const arreter = useCallback(
    async (annuler = false): Promise<ResultatNote> => {
      const enCours = demarrage.current;
      demarrage.current = null;
      if (!enCours || !(await enCours)) return null;
      arreterMinuterie();
      setEnregistre(false);
      const duree = Date.now() - debut.current;
      try {
        await recorder.stop();
      } finally {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      }
      if (annuler || duree < DUREE_MIN_NOTE_MS || !recorder.uri) return null;
      return { uri: recorder.uri, dureeMs: Math.min(duree, DUREE_MAX_NOTE_MS) };
    },
    [recorder],
  );

  useEffect(() => () => arreterMinuterie(), []);

  return { enregistre, dureeMs, demarrer, arreter, depasse: dureeMs >= DUREE_MAX_NOTE_MS };
}
