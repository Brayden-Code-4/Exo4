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

Ouvrez `http://localhost:3000`. Après toute modification de `.env`, redémarrez le serveur pour qu’il recharge les variables. Le fichier est chargé depuis le dossier du projet, même si la commande est lancée depuis un autre répertoire.

## Connecteurs

- **Modèle IA (RodiumAI ou OpenAI)** : pour RodiumAI, ajoutez la clé dans `RODIUMAI_API_KEY`. `RODIUMAI_MODEL=rodiumai/smart` laisse RodiumAI choisir dynamiquement un modèle de chat compatible avec les outils; l’application sélectionne aussi un modèle d’image ou de vidéo à partir du catalogue actif lorsque nécessaire. L’interface demande confirmation avant de lancer une génération payante. Pour OpenAI direct, utilisez `OPENAI_API_KEY` et éventuellement `OPENAI_BASE_URL`/`OPENAI_MODEL`.
- **Recherche Web** : renseignez `TAVILY_API_KEY` depuis votre compte Tavily.
- **Météo** : renseignez `WEATHERAPI_KEY` depuis votre compte WeatherAPI.
- **Google Calendar et Drive** : dans Google Cloud Console, activez Google Calendar API et Google Drive API, créez un client OAuth de type application Web, puis définissez `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `GOOGLE_REDIRECT_URI`. Ajoutez exactement la même URL de redirection aux URI autorisées du client OAuth. En local, utilisez `http://localhost:3000/auth/google/callback`. Dans l’application, ouvrez **Connexions** et choisissez **Connecter**. Les autorisations demandées couvrent Calendar et la lecture seule de Drive.
- **Notion** : créez une intégration dans Notion, renseignez `NOTION_API_KEY`, puis partagez avec elle chaque page ou base concernée. Une nouvelle page nécessite l’identifiant d’une page parente accessible.
- **Email** : configurez les paramètres SMTP de votre fournisseur (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` et éventuellement `EMAIL_FROM`). Maïa prépare le contenu et l’interface affiche une carte de relecture. Le serveur envoie le message uniquement après clic sur **Confirmer et envoyer**.
- **Images et vidéos RodiumAI** : demandez une image ou une vidéo dans le chat. Le catalogue live détermine un modèle disponible (comme Nano Banana/GPT Image ou Veo/Sora); vous pouvez nommer une préférence dans la demande. Une confirmation est requise avant toute génération payante.

## Sécurité et déploiement

### Connecteurs encore à configurer

Seule la clé RodiumAI est actuellement renseignée dans le `.env` local. Tavily, WeatherAPI, Google OAuth, Notion et SMTP restent vides : les recherches effectuées n’ont pas permis d’obtenir ces identifiants privés. Ils ne sont pas publiquement récupérables; il faut les générer ou les autoriser depuis les comptes correspondants. Aucune valeur de remplacement n’a été inventée. Les variables attendues sont listées dans `.env.example`.

Les domaines locaux configurés sont `APP_URL=http://localhost:3000`, `RODIUMAI_BASE_URL=https://api.rodiumai.io/v1` et `GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback`. L’URI Google doit correspondre exactement à celle enregistrée dans Google Cloud Console. Pour un hébergement public, configurez l’URL HTTPS réelle de l’application et utilisez-la dans `APP_URL` et `GOOGLE_REDIRECT_URI`.

Les secrets sont lus depuis l’environnement via `.env`; le fichier `.env` est ignoré par Git. Ne le publiez jamais et utilisez des variables d’environnement gérées par l’hébergeur en production. Google Drive est limité à la lecture. Un email attend toujours une confirmation explicite, et chaque brouillon expire après 15 minutes.

Cette version est conçue comme un assistant personnel à instance unique : les sessions et jetons OAuth sont gardés en mémoire et disparaissent au redémarrage du serveur. Pour un déploiement multi-utilisateur, ajoutez une authentification, un stockage de sessions et un stockage de jetons chiffré, ainsi que HTTPS et une politique de limitation de débit.
