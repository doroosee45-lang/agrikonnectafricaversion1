import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppImage, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { COLORS } from '@/theme/colors';
import { SPACING } from '@/theme/space';

import { BarreSaisie } from './components/BarreSaisie';
import { Bulle, CarteAppel, IndicateurFrappe, SeparateurJour } from './components/ElementsFil';
import { EnTeteConversation } from './components/EnTeteConversation';
import type { ElementFil } from './timeline';
import { useAppelRapide } from './useAppelRapide';
import { useConversation } from './useConversation';
import { useEnvoi } from './useEnvoi';

/**
 * Écran de discussion 1-à-1 (ergonomie de messagerie instantanée).
 *
 * En-tête fixe · fil en FlatList INVERSÉE (le plus récent en bas, chargement
 * des anciens messages en remontant) · barre de saisie fixe au-dessus du
 * clavier. Hors ligne : tout s'affiche depuis la base locale et les envois
 * restent « en attente » jusqu'au retour du réseau.
 */
export function EcranConversation({ conversationId, titreDeRepli }: { conversationId: string; titreDeRepli: string }) {
  const { locale } = useI18n();
  const fr = locale !== 'en';
  const conv = useConversation(conversationId);
  const envoi = useEnvoi(conversationId);
  const appel = useAppelRapide(conversationId);
  const [image, setImage] = useState<string | null>(null);

  const rendu = useCallback(
    ({ item }: { item: ElementFil }) => {
      switch (item.kind) {
        case 'jour':
          return <SeparateurJour libelle={item.libelle} />;
        case 'appel':
          return (
            <CarteAppel
              appel={item.appel}
              heure={item.heure}
              onRappeler={item.appel.status === 'ENDED' && item.appel.outgoing ? undefined : () => void appel.lancer()}
            />
          );
        default:
          return (
            <Bulle
              message={item.message}
              mien={item.mien}
              etat={item.etat}
              heure={item.heure}
              suiteDuPrecedent={item.suiteDuPrecedent}
              onRenvoyer={(id) => void envoi.renvoyer(id)}
              onImage={setImage}
            />
          );
      }
    },
    [appel, envoi],
  );

  return (
    <View style={styles.racine}>
      <EnTeteConversation
        conversationId={conversationId}
        titreDeRepli={titreDeRepli}
        fiche={conv.fiche}
        presence={conv.presence}
        ecrit={conv.ecrit}
        onAppelVocal={() => void appel.lancer()}
        appelOccupe={appel.occupe}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={conv.fil}
          inverted
          keyExtractor={(e) => e.key}
          renderItem={rendu}
          onEndReached={() => void conv.chargerPlusAnciens()}
          onEndReachedThreshold={0.4}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={11}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={styles.contenu}
          // Liste inversée : l'en-tête de liste s'affiche EN BAS (au-dessus de la saisie).
          ListHeaderComponent={<IndicateurFrappe visible={conv.ecrit} />}
          ListFooterComponent={
            conv.chargementAncien ? <ActivityIndicator style={styles.chargement} color={COLORS.forestGreen} /> : undefined
          }
          ListEmptyComponent={
            <View style={styles.vide}>
              <Ionicons name="chatbubbles-outline" size={36} color={COLORS.slateGray} />
              <Text preset="bodySm" color={COLORS.slateGray} style={styles.videTexte}>
                {fr
                  ? 'Aucun message. Écris, envoie une note vocale, une photo du terrain ou partage une parcelle.'
                  : 'No messages yet. Write, send a voice note, a field photo or share a plot.'}
              </Text>
            </View>
          }
        />
        <BarreSaisie envoi={envoi} />
      </KeyboardAvoidingView>

      <Modal visible={Boolean(image)} transparent animationType="fade" onRequestClose={() => setImage(null)}>
        <Pressable style={styles.visionneuse} onPress={() => setImage(null)} accessibilityRole="button" accessibilityLabel={fr ? 'Fermer la photo' : 'Close photo'}>
          {image ? <AppImage uri={image} style={styles.pleinEcran} fit="contain" /> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1, backgroundColor: '#ECE9E1' },
  flex: { flex: 1 },
  contenu: { paddingVertical: SPACING.sm, flexGrow: 1 },
  chargement: { marginVertical: SPACING.md },
  // Liste inversée : le contenu vide est retourné, on le redresse.
  vide: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, padding: SPACING.xl, transform: [{ scaleY: -1 }] },
  videTexte: { textAlign: 'center' },
  visionneuse: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  pleinEcran: { width: '100%', height: '80%' },
});
