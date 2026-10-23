# MAÏA — assistant personnel

MAÏA est une application web de chat en français. Le modèle choisit les outils adaptés à chaque demande et peut en combiner plusieurs dans une même conversation : recherche Web, météo, Google Calendar, email, Notion et Google Drive.

## Démarrer

Prérequis : Node.js 20 ou plus récent.

```sh
npm install
```

Copiez `.env.example` vers `.env`, puis renseignez les clés et paramètres des services que vous voulez activer. Le serveur affiche l’adresse locale au démarrage :

```sh
npm start
```

Ouvrez `http://localhost:3000`. Les services dont la configuration manque restent désactivés; Maïa explique comment les connecter si une demande en dépend.

## Connecteurs

- **Modèle IA (RodiumAI ou OpenAI)** : pour RodiumAI, ajoutez la clé dans `RODIUMAI_API_KEY`. `RODIUMAI_MODEL=rodiumai/smart` laisse RodiumAI choisir dynamiquement un modèle de chat compatible avec les outils; l’application sélectionne aussi un modèle d’image ou de vidéo à partir du catalogue actif lorsque nécessaire. L’interface demande confirmation avant de lancer une génération payante. Pour OpenAI direct, utilisez `OPENAI_API_KEY` et éventuellement `OPENAI_BASE_URL`/`OPENAI_MODEL`.
- **Recherche Web** : ajoutez `TAVILY_API_KEY`.
- **Météo** : ajoutez `WEATHERAPI_KEY`.
- **Google Calendar et Drive** : dans Google Cloud Console, activez Google Calendar API et Google Drive API, créez un client OAuth de type application Web, puis définissez `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `GOOGLE_REDIRECT_URI`. Ajoutez exactement la même URL de redirection aux URI autorisées du client OAuth. Pour l’installation locale, la valeur par défaut est `http://localhost:3000/auth/google/callback`. Dans l’application, ouvrez **Connexions** et choisissez **Connecter**. Les autorisations demandées sont Calendar et lecture seule de Drive.
- **Notion** : créez une intégration, ajoutez `NOTION_API_KEY`, puis partagez chaque page ou base concernée avec cette intégration dans Notion. Une nouvelle page nécessite l’identifiant d’une page parente accessible.
- **Email** : configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` et éventuellement `EMAIL_FROM`. Maïa prépare le contenu et l’interface affiche une carte de relecture. Le serveur envoie le message uniquement après clic sur **Confirmer et envoyer**.
- **Images et vidéos RodiumAI** : demandez une image ou une vidéo dans le chat. Le catalogue live détermine un modèle disponible (comme Nano Banana/GPT Image ou Veo/Sora); vous pouvez nommer une préférence dans la demande. Une confirmation est requise avant toute génération payante.

## Sécurité et déploiement

Les secrets sont lus depuis l’environnement via `.env`; le fichier `.env` est ignoré par Git. Ne le publiez jamais et utilisez des variables d’environnement gérées par l’hébergeur en production. Google Drive est limité à la lecture. Un email attend toujours une confirmation explicite, et chaque brouillon expire après 15 minutes.

Cette version est conçue comme un assistant personnel à instance unique : les sessions et jetons OAuth sont gardés en mémoire et disparaissent au redémarrage du serveur. Pour un déploiement multi-utilisateur, ajoutez une authentification, un stockage de sessions et un stockage de jetons chiffré, ainsi que HTTPS et une politique de limitation de débit.
