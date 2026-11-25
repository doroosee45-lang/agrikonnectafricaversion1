/**
 * Point d'entrée de l'application.
 *
 * L'ordre des imports compte : les gestionnaires de push en arrière-plan
 * (application fermée) sont enregistrés par effet de bord, AVANT le démarrage
 * de React par expo-router.
 *   1. notifications push générales (FCM) ;
 *   2. push d'appel : s'ils sont actifs, ils REMPLACENT le gestionnaire
 *      précédent (Firebase n'en garde qu'un), et gèrent la sonnerie.
 * Sans build natif (drapeaux absents, Expo Go, web), ils ne font rien.
 */
import './src/services/pushBackground';
import './src/features/calls/background';
import 'expo-router/entry';
