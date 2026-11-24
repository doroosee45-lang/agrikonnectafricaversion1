# COMPLÉMENT DE MISSION — HARMONISATION DU DESIGN, NAVIGATION MOBILE ET ESPACE DE COMMUNICATION PROFESSIONNEL

Je souhaite également améliorer et harmoniser l'expérience utilisateur de toute l'application, particulièrement sur mobile, ainsi que revoir l'organisation de l'espace de communication.

Mon objectif est d'obtenir une application moderne, cohérente, professionnelle et agréable à utiliser, avec une navigation adaptée à chaque profil utilisateur.

## 1. Harmonisation générale du design

Je veux une véritable cohérence visuelle et fonctionnelle dans toute l'application.

- Harmoniser les styles, les espacements, les marges et les alignements.
- Uniformiser les boutons, les icônes, les menus, les formulaires et les composants.
- Assurer une cohérence entre les différentes pages et les différents modules.
- Conserver strictement l'identité visuelle, les couleurs, les composants et les principes graphiques déjà utilisés dans le frontend existant.
- Éviter les différences de présentation injustifiées entre les modules.
- Améliorer la lisibilité, la hiérarchie des informations et la facilité d'utilisation.

Je veux que l'application donne l'impression d'être un seul produit professionnel parfaitement harmonisé, et non une juxtaposition de modules développés séparément.

## 2. Navigation mobile adaptée à chaque rôle

Chaque rôle utilisateur doit disposer d'une navigation mobile adaptée à ses responsabilités et à ses fonctionnalités autorisées.

La navigation doit être pensée en fonction des permissions réelles de chaque profil.

Elle doit notamment permettre d'accéder facilement aux fonctionnalités principales du rôle concerné.

**Exigence obligatoire : le bouton « Messages » doit être présent dans la navigation mobile de chaque rôle autorisé à utiliser la messagerie.**

Ce bouton ne doit pas disparaître selon les pages, les modules ou les changements de navigation.

Il doit également afficher un indicateur du nombre de messages non lus, lorsque cette information est disponible.

La navigation doit rester simple, accessible et cohérente sur les différents formats de téléphone.

## 3. Organisation de l'espace Messages

Lorsque l'utilisateur appuie sur le bouton « Messages » de sa navigation mobile, il doit accéder directement à un véritable espace de communication.

La première vue doit présenter la liste de ses conversations existantes.

### A. Liste des conversations

Afficher clairement :

- La photo ou l'avatar du correspondant.
- Son nom et, si nécessaire, sa fonction.
- Le dernier message échangé.
- La date ou l'heure du dernier message.
- Le nombre de messages non lus.
- Les indicateurs de présence, uniquement si disponibles.
- Un accès rapide à chaque conversation.

Les conversations doivent être classées de la plus récente à la plus ancienne, selon la date du dernier échange.

### B. Bouton « + » pour ajouter une conversation

Ajouter un bouton « + » clairement visible dans l'espace Messages.

Ce bouton doit permettre de démarrer une nouvelle conversation avec une autre personne autorisée à communiquer avec l'utilisateur.

Lorsqu'on appuie dessus, afficher une liste ou un moteur de recherche permettant de retrouver les utilisateurs disponibles, avec leur nom, leur photo et leur fonction.

Respecter strictement les règles d'accès et les restrictions de communication définies par les rôles.

Ne pas permettre de contacter arbitrairement des utilisateurs non autorisés.

## 4. Espace de communication : Discussions, Groupes et Appels

Je souhaite organiser l'espace de communication autour de trois sections principales, clairement accessibles :

### A. Discussions

Un espace dédié aux conversations individuelles entre utilisateurs.

Il doit permettre de consulter l'historique, envoyer et recevoir des messages, partager des documents et des images, répondre à un message précis et suivre les échanges.

### B. Groupes

Un espace permettant de créer et de gérer des groupes de discussion professionnels, selon les autorisations disponibles.

Prévoir :
- La création de groupes.
- Le nom et la photo du groupe.
- L'ajout et le retrait de membres autorisés.
- La liste des participants.
- Les échanges collectifs.
- L'identification des administrateurs du groupe.
- La gestion des droits et des responsabilités.

Les groupes doivent pouvoir servir aux communications entre équipes, agences, services et collaborateurs autorisés.

### C. Appels

Prévoir un espace dédié aux appels, avec une interface professionnelle.

Il doit permettre, selon les capacités réelles de l'infrastructure :
- De retrouver les contacts disponibles.
- D'initier un appel.
- De recevoir un appel.
- De consulter l'historique des appels.
- De distinguer les appels entrants, sortants et manqués.
- D'afficher la durée des appels lorsqu'elle est disponible.

Les appels audio et vidéo ne doivent pas être présentés comme opérationnels tant que leur infrastructure technique n'est pas réellement intégrée et testée.

## 5. Expérience mobile et ordinateur

L'expérience doit être soigneusement adaptée aux deux environnements.

**Sur mobile :**
- Navigation principale simple et persistante.
- Accès permanent au bouton Messages.
- Liste des conversations adaptée à la largeur de l'écran.
- Ouverture d'une conversation en plein écran.
- Retour facile à la liste des discussions.
- Bouton « + » facilement accessible.
- Navigation claire entre Discussions, Groupes et Appels.

**Sur ordinateur :**
- Présentation en deux panneaux : conversations à gauche et discussion active à droite.
- Accès rapide aux groupes et aux appels.
- Interface adaptée aux grands écrans.
- Espacement et alignement cohérents avec le reste de l'application.

## 6. Exigence de cohérence entre les rôles

La navigation doit être adaptée à chaque profil sans créer plusieurs systèmes différents.

Il faut conserver une architecture commune et afficher dynamiquement les menus en fonction des rôles et permissions réels.

Chaque utilisateur doit retrouver une expérience cohérente, même si les fonctionnalités disponibles diffèrent selon son niveau d'accès.

## 7. Résultat attendu

Je veux obtenir un véritable environnement de communication professionnel intégré à Trans Africa Canada, avec une expérience aussi intuitive que les grandes applications modernes de messagerie.

L'utilisateur doit pouvoir ouvrir son application, retrouver immédiatement ses conversations, démarrer une nouvelle discussion, accéder aux groupes et retrouver ses appels sans devoir chercher dans plusieurs menus.

**Important :** ne réalise pas uniquement des ajustements visuels. Vérifie également le fonctionnement réel de chaque bouton, de chaque navigation et de chaque fonctionnalité.

Respecte l'identité visuelle actuelle du frontend, l'architecture existante, les règles métier et les permissions du Core API.

Le résultat doit être harmonisé, responsive, professionnel, sécurisé et réellement opérationnel.