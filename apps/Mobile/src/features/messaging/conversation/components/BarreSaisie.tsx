import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, PanResponder, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { COLORS } from '@/theme/colors';
import { RADIUS, SPACING } from '@/theme/space';

import { corpsDocument, corpsNoteVocale, corpsPhoto, FILTRES_SELECTEUR, formatDuree, FORMATS_LISIBLES, preparerFichier, type Parcelle } from '../messageContent';
import { ErreurMedia, type useEnvoi } from '../useEnvoi';
import { useNoteVocale } from '../useNoteVocale';
import { ChoixParcelle } from './ChoixParcelle';

type Envoi = ReturnType<typeof useEnvoi>;

const LIGNES_MAX = 5;
const SEUIL_ANNULATION_PX = -80;
const APPUI_COURT_MS = 600;

export function BarreSaisie({ envoi }: { envoi: Envoi }) {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const insets = useSafeAreaInsets();
  // Clavier ouvert : la barre est collée au clavier, sans la marge de la barre de gestes.
  const clavierVisible = useKeyboardState((etat) => etat.isVisible);
  const [texte, setTexte] = useState('');
  const [hauteur, setHauteur] = useState(40);
  const [menu, setMenu] = useState(false);
  const [choixParcelle, setChoixParcelle] = useState(false);
  const [verrouille, setVerrouille] = useState(false);
  const [annulation, setAnnulation] = useState(false);
  const note = useNoteVocale();
  const debutAppui = useRef(0);
  const annuler = useRef(false);

  const erreur = (titre: string, corps: string) => Alert.alert(titre, corps);
  const erreurMedia = (e: unknown) => {
    if (e instanceof ErreurMedia && e.code === 'TROP_VOLUMINEUX') erreur(fr ? 'Fichier trop volumineux' : 'File too large', fr ? 'Maximum 5 Mo.' : 'Maximum 5 MB.');
    else if (e instanceof ErreurMedia) erreur(fr ? 'Format non accepté' : 'Unsupported format', `${fr ? 'Formats acceptés' : 'Accepted formats'} : ${FORMATS_LISIBLES}.`);
    else erreur(fr ? 'Envoi impossible' : 'Cannot send', fr ? 'Le fichier n’a pas pu être préparé.' : 'The file could not be prepared.');
  };

  /* ───── texte ───── */
  const envoyerTexte = async () => {
    const t = texte;
    if (!t.trim()) return;
    setTexte('');
    setHauteur(40);
    await envoi.envoyerTexte(t);
  };

  /* ───── médias ───── */
  const envoyerPhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    const nom = asset.fileName ?? `photo-${Date.now()}.jpg`;
    await envoi.envoyerMedia({ uri: asset.uri, nom: /\.(jpe?g|png|webp)$/i.test(nom) ? nom : `${nom}.jpg`, taille: asset.fileSize ?? 0, genre: 'IMAGE', corps: corpsPhoto() });
  };

  const camera = async () => {
    setMenu(false);
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) return erreur(fr ? 'Caméra refusée' : 'Camera denied', fr ? 'Autorise la caméra dans les réglages du téléphone.' : 'Allow the camera in your phone settings.');
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, exif: false });
    if (r.canceled || !r.assets[0]) return undefined;
    return envoyerPhoto(r.assets[0]).catch(erreurMedia);
  };

  const galerie = async () => {
    setMenu(false);
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, exif: false });
    if (r.canceled || !r.assets[0]) return undefined;
    return envoyerPhoto(r.assets[0]).catch(erreurMedia);
  };

  /**
   * Bouton « Fichier » : sélecteur NATIF (Android : stockage, Téléchargements,
   * Drive… ; iOS : app Fichiers). Aucune autorisation de stockage n'est
   * nécessaire : le système donne accès au seul fichier choisi, copié dans le
   * cache de l'application (lisible pour l'envoi, même hors ligne).
   */
  const fichier = async () => {
    setMenu(false);
    let resultat: DocumentPicker.DocumentPickerResult;
    try {
      resultat = await DocumentPicker.getDocumentAsync({ type: FILTRES_SELECTEUR, copyToCacheDirectory: true, multiple: false });
    } catch {
      return erreur(fr ? 'Fichiers inaccessibles' : 'Files unavailable', fr ? 'Le sélecteur de fichiers n’a pas pu s’ouvrir.' : 'The file picker could not be opened.');
    }
    if (resultat.canceled || !resultat.assets?.[0]) return undefined; // annulation : rien à faire
    const a = resultat.assets[0];
    const prepare = preparerFichier(a.name, a.mimeType);
    if (!prepare) return erreurMedia(new ErreurMedia('TYPE_REFUSE'));
    return envoi
      .envoyerMedia({
        uri: a.uri,
        nom: prepare.nom,
        mime: prepare.mime,
        taille: a.size ?? 0,
        genre: prepare.genre,
        corps: prepare.genre === 'IMAGE' ? corpsPhoto() : corpsDocument(prepare.nom),
      })
      .catch(erreurMedia);
  };

  const position = async () => {
    setMenu(false);
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return erreur(fr ? 'Localisation refusée' : 'Location denied', fr ? 'Autorise la localisation pour partager ta position.' : 'Allow location to share your position.');
    try {
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await envoi.envoyerPosition({ lat: p.coords.latitude, lng: p.coords.longitude, precisionM: p.coords.accuracy });
    } catch {
      erreur(fr ? 'Position introuvable' : 'Location unavailable', fr ? 'Active le GPS et réessaie à découvert.' : 'Turn on GPS and try again outdoors.');
    }
    return undefined;
  };

  const parcelleChoisie = async (p: Parcelle) => {
    setChoixParcelle(false);
    await envoi.envoyerParcelle(p);
  };

  /* ───── note vocale ───── */
  const terminerNote = async (abandon: boolean) => {
    setVerrouille(false);
    setAnnulation(false);
    const r = await note.arreter(abandon);
    if (!r) return;
    await envoi
      .envoyerMedia({ uri: r.uri, nom: `note-${Date.now()}.m4a`, taille: 0, genre: 'AUDIO', corps: corpsNoteVocale(r.dureeMs) })
      .catch(erreurMedia);
  };

  const commencerNote = async () => {
    annuler.current = false;
    debutAppui.current = Date.now();
    const ok = await note.demarrer();
    if (!ok) setVerrouille(false);
    if (!ok) erreur(fr ? 'Micro refusé' : 'Microphone denied', fr ? 'Autorise le micro pour envoyer des notes vocales.' : 'Allow the microphone to send voice notes.');
  };

  // Durée maximale atteinte : la note part d'elle-même (plafond serveur 5 Mo).
  useEffect(() => {
    if (note.depasse) void terminerNote(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.depasse]);

  // Le PanResponder est créé une fois : il appelle TOUJOURS les fonctions du dernier rendu.
  const actions = useRef({ commencerNote, terminerNote });
  actions.current = { commencerNote, terminerNote };

  const micro = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        void actions.current.commencerNote();
      },
      onPanResponderMove: (_e, g) => {
        const annule = g.dx < SEUIL_ANNULATION_PX;
        annuler.current = annule;
        setAnnulation(annule);
      },
      onPanResponderRelease: () => {
        // Appui court : enregistrement VERROUILLÉ (mains occupées, gants) ; on envoie au 2e toucher.
        if (Date.now() - debutAppui.current < APPUI_COURT_MS && !annuler.current) {
          setVerrouille(true);
          return;
        }
        void actions.current.terminerNote(annuler.current);
      },
      onPanResponderTerminate: () => {
        void actions.current.terminerNote(true);
      },
    }),
  ).current;

  const optionsMenu: Array<{ icone: keyof typeof Ionicons.glyphMap; libelle: string; action: () => void; couleur: string }> = [
    { icone: 'leaf', libelle: fr ? 'Parcelle' : 'Plot', action: () => { setMenu(false); setChoixParcelle(true); }, couleur: COLORS.forestGreen },
    { icone: 'location', libelle: fr ? 'Position GPS' : 'GPS location', action: () => void position(), couleur: '#D08A33' },
    { icone: 'document-attach', libelle: fr ? 'Fichier' : 'File', action: () => void fichier(), couleur: COLORS.error },
    { icone: 'images', libelle: fr ? 'Galerie' : 'Gallery', action: () => void galerie(), couleur: COLORS.info },
  ];

  const enregistrementVisible = note.enregistre;

  return (
    <View style={[styles.racine, { paddingBottom: clavierVisible ? SPACING.sm : Math.max(insets.bottom, SPACING.sm) }]}>
      {enregistrementVisible ? (
        <View style={styles.ligne}>
          <View style={[styles.champ, styles.enregistrement]}>
            <View style={styles.point} />
            <Text preset="bodyMedium" color={COLORS.error}>{formatDuree(note.dureeMs / 1000)}</Text>
            <Text preset="caption" color={annulation ? COLORS.error : COLORS.slateGray} style={styles.flex} numberOfLines={1}>
              {verrouille
                ? fr ? 'Enregistrement…' : 'Recording…'
                : annulation
                  ? fr ? 'Relâche pour annuler' : 'Release to cancel'
                  : fr ? '‹ Glisse pour annuler' : '‹ Slide to cancel'}
            </Text>
            {verrouille ? (
              <Pressable onPress={() => void terminerNote(true)} accessibilityRole="button" accessibilityLabel={fr ? 'Supprimer la note' : 'Delete note'} hitSlop={8}>
                <Ionicons name="trash-outline" size={22} color={COLORS.error} />
              </Pressable>
            ) : null}
          </View>
          {verrouille ? (
            <Pressable onPress={() => void terminerNote(false)} accessibilityRole="button" accessibilityLabel={fr ? 'Envoyer la note vocale' : 'Send voice note'} style={styles.principal}>
              <Ionicons name="send" size={22} color={COLORS.pureWhite} />
            </Pressable>
          ) : (
            <View {...micro.panHandlers} style={[styles.principal, styles.principalActif]}>
              <Ionicons name="mic" size={26} color={COLORS.pureWhite} />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.ligne}>
          <View style={styles.champ}>
            <Pressable onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel={fr ? 'Joindre' : 'Attach'} hitSlop={8} style={styles.icone}>
              <Ionicons name="add" size={26} color={COLORS.forestGreen} />
            </Pressable>
            <TextInput
              value={texte}
              onChangeText={(v) => {
                setTexte(v);
                if (v.trim()) envoi.signalerFrappe();
                else envoi.arreterFrappe();
              }}
              placeholder={fr ? 'Message' : 'Message'}
              placeholderTextColor={COLORS.slateGray}
              multiline
              maxLength={3000}
              onContentSizeChange={(e) => setHauteur(Math.min(Math.max(40, e.nativeEvent.contentSize.height), 22 * LIGNES_MAX + 18))}
              style={[styles.saisie, { height: hauteur }]}
              accessibilityLabel={fr ? 'Écrire un message' : 'Write a message'}
            />
            {!texte.trim() ? (
              <Pressable onPress={() => void camera()} accessibilityRole="button" accessibilityLabel={fr ? 'Prendre une photo' : 'Take a photo'} hitSlop={8} style={styles.icone}>
                <Ionicons name="camera" size={24} color={COLORS.slateGray} />
              </Pressable>
            ) : null}
          </View>
          {texte.trim() ? (
            <Pressable onPress={() => void envoyerTexte()} accessibilityRole="button" accessibilityLabel={fr ? 'Envoyer' : 'Send'} style={styles.principal}>
              <Ionicons name="send" size={22} color={COLORS.pureWhite} />
            </Pressable>
          ) : (
            <View
              {...micro.panHandlers}
              accessible
              accessibilityRole="button"
              accessibilityLabel={fr ? 'Note vocale : maintenir pour enregistrer, ou toucher pour enregistrer puis envoyer' : 'Voice note: hold to record, or tap to record then send'}
              style={styles.principal}
            >
              <Ionicons name="mic" size={26} color={COLORS.pureWhite} />
            </View>
          )}
        </View>
      )}

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.voile} onPress={() => setMenu(false)}>
          <View style={[styles.menu, { marginBottom: insets.bottom + 72 }]}>
            {optionsMenu.map((o) => (
              <Pressable key={o.libelle} onPress={o.action} accessibilityRole="button" style={styles.option}>
                <View style={[styles.optionIcone, { backgroundColor: o.couleur }]}>
                  <Ionicons name={o.icone} size={22} color={COLORS.pureWhite} />
                </View>
                <Text preset="caption" color={COLORS.textPrimary}>{o.libelle}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <ChoixParcelle visible={choixParcelle} onFermer={() => setChoixParcelle(false)} onChoisir={(p) => void parcelleChoisie(p)} />
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { paddingHorizontal: SPACING.sm, paddingTop: SPACING.sm, backgroundColor: COLORS.naturalWhite },
  ligne: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm },
  flex: { flex: 1 },
  champ: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.pureWhite,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.lightBorder,
    paddingHorizontal: SPACING.xs,
    minHeight: 48,
  },
  enregistrement: { alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md },
  point: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.error },
  icone: { padding: SPACING.sm },
  saisie: { flex: 1, fontSize: 16, color: COLORS.textPrimary, paddingTop: 12, paddingBottom: 8, paddingHorizontal: SPACING.xs },
  principal: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.forestGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  principalActif: { backgroundColor: COLORS.error, transform: [{ scale: 1.12 }] },
  voile: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.2)' },
  menu: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginHorizontal: SPACING.md,
    backgroundColor: COLORS.pureWhite,
    borderRadius: RADIUS.xl,
    paddingVertical: SPACING.lg,
  },
  option: { alignItems: 'center', gap: SPACING.xs, width: 76 },
  optionIcone: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
