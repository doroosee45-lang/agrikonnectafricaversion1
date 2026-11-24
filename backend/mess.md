# MISSION — CORRECTION DES ERREURS API ET AMÉLIORATION COMPLÈTE DE LA MESSAGERIE UTILISATEUR

Je constate plusieurs dysfonctionnements dans l'application. Je te demande de les examiner, de les corriger directement dans le code existant et d'améliorer considérablement l'expérience d'échange entre les utilisateurs.

Cette mission comporte deux volets : la correction des erreurs techniques et la modernisation de l'espace de messagerie.

## 1. Correction des erreurs techniques

Voici les erreurs actuellement observées dans l'application :

### A. Problème de permission

```text
Permission requise : media.upload
ID : 3c916577-1d3c-46ee-a61c-13b695cd01bb
```

Vérifie :
- Pourquoi la permission `media.upload` est refusée.
- Quel rôle et quelles autorisations sont nécessaires pour envoyer des fichiers.
- Si les permissions attribuées aux différents profils correspondent aux règles définies dans le projet.
- Si le contrôle des permissions est correctement appliqué côté backend et frontend.

Corrige le problème sans contourner le système de sécurité ni accorder des permissions excessives aux utilisateurs.

### B. Erreur 404 — Chargement des commandes

```text
GET /api/v1/orders?limit=20
404 (Not Found)
```

Vérifie pourquoi cette route retourne une erreur 404.

Examine :
- L'existence de la route dans le Core API.
- Son enregistrement dans le système de routage.
- Le contrôleur et le service associés.
- Les permissions nécessaires.
- La correspondance entre l'URL appelée par le frontend et l'API réellement disponible.

Corrige l'intégration pour permettre le chargement réel des commandes.

### C. Erreur 403 — Vérification du profil

```text
GET /api/v1/verifications/me
403 (Forbidden)
```

Vérifie :
- La configuration de l'authentification.
- Les permissions nécessaires pour consulter ses propres vérifications.
- Le contrôle d'accès aux données personnelles.
- La cohérence entre l'identité de l'utilisateur connecté et les informations demandées.

Un utilisateur autorisé doit pouvoir consulter le statut de sa propre vérification sans accéder aux informations privées des autres utilisateurs.

### D. Erreur 403 — Téléversement des fichiers

```text
POST /api/v1/media/upload-url
403 (Forbidden)
```

Vérifie toute la chaîne de téléversement :
- La permission `media.upload`.
- La génération de l'URL de téléversement.
- L'authentification et les autorisations.
- La configuration du stockage.
- La validation du type et de la taille des fichiers.
- La confirmation de l'enregistrement et de l'accès au fichier.

Ne te contente pas de supprimer les erreurs dans la console. Corrige leur cause réelle.

## 2. Refonte complète de l'espace de messagerie

Actuellement, je rencontre un problème important : les messages envoyés ne sont pas clairement visibles, les messages reçus sont difficiles à comprendre et je ne parviens pas à suivre correctement les échanges entre les utilisateurs.

Je souhaite donc une véritable refonte de l'espace de communication de l'application, en prenant **WhatsApp comme référence d'expérience utilisateur**, sans copier son identité visuelle ni son interface à l'identique.

L'objectif est de disposer d'une messagerie moderne, intuitive, fluide et professionnelle.

### A. Interface générale

Créer une interface organisée en deux espaces principaux :

**Panneau gauche : liste des conversations**
- Photo ou avatar de l'utilisateur.
- Nom du correspondant.
- Dernier message échangé.
- Heure ou date du dernier message.
- Nombre de messages non lus.
- Indicateur de présence ou de disponibilité, si cette information existe.
- Recherche de conversations.
- Possibilité de retrouver rapidement un utilisateur.

**Panneau droit : conversation active**
- En-tête avec le nom et l'avatar du correspondant.
- Historique complet des messages.
- Messages envoyés alignés à droite.
- Messages reçus alignés à gauche.
- Horodatage des messages.
- Indication des messages envoyés, délivrés et lus, uniquement si ces états sont réellement disponibles.
- Zone de rédaction en bas de la conversation.
- Bouton d'envoi clairement identifiable.

Sur mobile, l'interface doit être entièrement responsive, avec une navigation adaptée entre la liste des conversations et la discussion ouverte.

### B. Gestion des messages

Je veux pouvoir :
- Envoyer et recevoir des messages textuels.
- Voir immédiatement les messages que j'envoie.
- Recevoir et afficher clairement les messages des autres utilisateurs.
- Retrouver l'historique des conversations.
- Voir les nouveaux messages sans devoir actualiser manuellement la page.
- Connaître la date et l'heure des échanges.
- Répondre à un message précis.
- Copier un message.
- Rechercher un message dans une conversation.
- Gérer les messages non lus.
- Consulter les conversations précédentes.

Les messages doivent apparaître dans le bon ordre, sans doublons, sans disparition et sans confusion entre les différents correspondants.

### C. Partage de fichiers et de médias

Prévoir une expérience de partage inspirée de WhatsApp permettant, selon les permissions disponibles :
- D'envoyer des images.
- De partager des documents PDF.
- De transmettre des fichiers autorisés.
- De visualiser les images directement dans la conversation.
- De télécharger les documents reçus.
- De consulter les informations essentielles des fichiers partagés.

Le téléversement doit être réellement fonctionnel et respecter les autorisations du système.

### D. Expérience utilisateur et notifications

Améliorer la fluidité des échanges :
- Actualisation automatique des conversations.
- Réception des nouveaux messages en temps réel, si l'infrastructure le permet.
- Notifications visuelles des nouveaux messages.
- Indicateurs de messages non lus.
- Conservation de la conversation ouverte après l'envoi d'un message.
- Affichage d'un état de chargement pendant les opérations.
- Messages d'erreur compréhensibles en cas d'échec.
- Gestion correcte des problèmes de connexion.

Éviter les rechargements inutiles et les pertes de messages lors des changements de page.

## 3. Exigences techniques et architecture

Avant de développer, examine le système de messagerie déjà présent dans le projet.

Ne crée pas un deuxième système de messagerie si un système existe déjà.

Vérifie les modèles de données, les API, les services, les permissions, les événements temps réel et les composants frontend.

Respecte l'architecture existante et les décisions techniques du projet.

Les échanges doivent être persistés dans la base de données. Ne crée pas une messagerie simulée avec des données fictives ou des messages conservés uniquement dans le navigateur.

La sécurité doit être garantie :
- Chaque utilisateur ne consulte que les conversations auxquelles il est autorisé à participer.
- Les messages privés ne doivent jamais être accessibles à des tiers non autorisés.
- Les fichiers partagés doivent être protégés.
- Les autorisations doivent être vérifiées côté serveur.
- Les événements temps réel doivent respecter les mêmes règles d'accès que les API.

## 4. Tests obligatoires

Après les corrections et la refonte, réalise des tests réels portant notamment sur :

1. L'envoi d'un message entre deux comptes différents.
2. La réception du message par le destinataire.
3. La visibilité du message envoyé chez l'expéditeur.
4. La persistance des messages après actualisation.
5. L'affichage correct de l'historique.
6. La gestion des messages non lus.
7. L'envoi et la réception de fichiers.
8. Les autorisations entre utilisateurs.
9. La réception des nouveaux messages.
10. L'affichage sur ordinateur, tablette et téléphone.

Vérifie également que les erreurs 404 et 403 identifiées sont réellement corrigées et qu'aucune régression n'a été introduite.

## 5. Livrable attendu

Je souhaite recevoir :
- Les corrections effectuées dans le code existant.
- La nouvelle interface complète de messagerie.
- Les éventuelles modifications nécessaires des API et intégrations.
- Les tests exécutés avec leurs résultats.
- La liste des fichiers modifiés.
- Les éventuelles dépendances ou configurations externes restant à effectuer.

**Mon objectif :** disposer d'un véritable espace de communication entre les utilisateurs, aussi simple et agréable à utiliser que WhatsApp, mais parfaitement intégré à Trans Africa Canada.

Je veux pouvoir envoyer un message, le voir immédiatement dans ma conversation, recevoir une réponse, retrouver tous les échanges et partager des documents sans difficulté.

Ne livre pas uniquement une maquette visuelle. Je demande une fonctionnalité réellement opérationnelle, connectée au backend existant, sécurisée et testée.

Prends le temps nécessaire pour examiner et comprendre le système avant d'intervenir. La qualité et le fonctionnement réel sont prioritaires sur la rapidité.