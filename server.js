require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const pendingEmails = new Map();
const pendingMedia = new Map();
const googleTokens = new Map(); // For a single-user local app. Use encrypted persistent storage in production.
const sessions = new Map();

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  let sid = req.headers['x-session-id'];
  if (!sid || !sessions.has(sid)) { sid = crypto.randomUUID(); sessions.set(sid, { createdAt: Date.now() }); }
  req.sessionId = sid;
  res.setHeader('X-Session-Id', sid);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const openai = () => {
  const key = process.env.RODIUMAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('La clé RODIUMAI_API_KEY manque dans le fichier .env.');
  const baseURL = process.env.RODIUMAI_API_KEY
    ? (process.env.RODIUMAI_BASE_URL || 'https://api.rodiumai.io/v1')
    : process.env.OPENAI_BASE_URL;
  return new OpenAI({ apiKey: key, ...(baseURL ? { baseURL } : {}) });
};
const rodiumKey = () => process.env.RODIUMAI_API_KEY || (process.env.OPENAI_BASE_URL?.includes('rodiumai.io') ? process.env.OPENAI_API_KEY : null);
const rodiumBase = () => process.env.RODIUMAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.rodiumai.io/v1';
const env = (name) => {
  if (!process.env[name]) throw new Error(`La variable ${name} manque dans le fichier .env.`);
  return process.env[name];
};
const getGoogleOAuth = () => new google.auth.OAuth2(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'), process.env.GOOGLE_REDIRECT_URI || `${APP_URL}/auth/google/callback`);
const googleClient = (sid) => {
  const token = googleTokens.get(sid);
  if (!token) throw new Error('Google n’est pas connecté. Utilise le bouton « Connecter Google » puis réessaie.');
  const auth = getGoogleOAuth(); auth.setCredentials(token); return auth;
};

const tools = [
  { type: 'function', function: { name: 'web_search', description: 'Recherche des informations récentes sur le Web et renvoie des extraits avec leurs URL sources. À utiliser pour les faits récents, les actualités et les questions nécessitant des sources.', parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_weather', description: 'Consulte les conditions météo actuelles et la prévision d’une ville.', parameters: { type: 'object', properties: { location: { type: 'string', description: 'Ville et pays si nécessaire' }, days: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['location'], additionalProperties: false } } },
  { type: 'function', function: { name: 'calendar_action', description: 'Consulte, recherche, crée, modifie ou supprime un événement Google Calendar. Demande les précisions nécessaires avant toute écriture. Utilise des dates ISO avec fuseau horaire.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'search', 'create', 'update', 'delete'] }, query: { type: 'string' }, event_id: { type: 'string' }, summary: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' }, start: { type: 'string', description: 'Date/heure ISO 8601 avec fuseau, ex. 2026-10-24T09:00:00+00:00' }, end: { type: 'string' }, time_min: { type: 'string' }, time_max: { type: 'string' }, max_results: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['action'], additionalProperties: false } } },
  { type: 'function', function: { name: 'prepare_email', description: 'Prépare un email et le place en attente de confirmation humaine. Ne l’envoie jamais directement : présente clairement le destinataire, le sujet et le message à l’utilisateur; l’interface lui fera confirmer.', parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'], additionalProperties: false } } },
  { type: 'function', function: { name: 'notion_action', description: 'Recherche dans Notion, lit une page ou crée une page dans une base Notion accessible à l’intégration.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['search', 'read', 'create'] }, query: { type: 'string' }, page_id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, parent_id: { type: 'string', description: 'ID de page ou de base pour créer la page' } }, required: ['action'], additionalProperties: false } } },
  { type: 'function', function: { name: 'drive_action', description: 'Recherche des fichiers Google Drive, renvoie leurs métadonnées et lit le contenu des documents texte/Google Docs.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['search', 'read'] }, query: { type: 'string' }, file_id: { type: 'string' }, max_results: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['action'], additionalProperties: false } } }
  ,{ type: 'function', function: { name: 'list_ai_models', description: 'Liste les modèles RodiumAI disponibles pour le chat, les images ou les vidéos. Utilise cet outil si la personne demande quels modèles sont disponibles.', parameters: { type: 'object', properties: { task: { type: 'string', enum: ['all', 'chat', 'image', 'video'] } }, additionalProperties: false } } }
  ,{ type: 'function', function: { name: 'create_image', description: 'Prépare une image à générer via RodiumAI. L’interface demandera confirmation avant d’engager la génération payante. Peut sélectionner automatiquement un modèle image disponible ou respecter un modèle nommé.', parameters: { type: 'object', properties: { prompt: { type: 'string' }, model_preference: { type: 'string', description: 'Facultatif, nom de modèle ou préférence comme Nano Banana, GPT Image, moins cher, meilleure qualité.' }, size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'] }, quality: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['prompt'], additionalProperties: false } } }
  ,{ type: 'function', function: { name: 'create_video', description: 'Prépare une vidéo à générer via RodiumAI (par exemple Sora ou Veo). Une carte affichera le modèle, la durée et demandera confirmation avant de lancer l’appel payant.', parameters: { type: 'object', properties: { prompt: { type: 'string' }, model_preference: { type: 'string', description: 'Facultatif, par exemple Sora, Veo, plus rapide, moins cher ou meilleure qualité.' }, duration_seconds: { type: 'number', minimum: 4, maximum: 12 }, aspect_ratio: { type: 'string', enum: ['16:9', '9:16'] } }, required: ['prompt'], additionalProperties: false } } }
];

async function rodiumModels() {
  const key = rodiumKey(); if (!key) throw new Error('Configure RODIUMAI_API_KEY dans .env pour accéder au catalogue RodiumAI.');
  const r = await fetch(`${rodiumBase().replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${key}` } });
  const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || 'Impossible de charger le catalogue RodiumAI.');
  return data.data || [];
}
function modelId(model) { return model.id || model.model || model.slug || ''; }
function chooseRodiumModel(models, type, preference='') {
  const matching = models.filter(m => {
    const id = modelId(m).toLowerCase(); const caps = m.rodiumai_capabilities || m.capabilities || {};
    const inputs = caps.input_modalities || []; const outputs = caps.output_modalities || [];
    if (type === 'image') return /image|imagen|nano-banana/.test(id) || outputs.includes('image');
    if (type === 'video') return /sora|veo|video/.test(id) || outputs.includes('video');
    return caps.supports_tools !== false;
  });
  if (!matching.length) throw new Error(`Aucun modèle RodiumAI ${type === 'image' ? 'd’image' : 'vidéo'} disponible avec cette clé.`);
  const pref = preference.toLowerCase().trim();
  if (pref) { const exact = matching.find(m => modelId(m).toLowerCase().includes(pref)); if (exact) return exact; const alias = pref.includes('sora') ? 'sora' : pref.includes('veo') ? 'veo' : pref.includes('banana') ? 'gemini' : pref.includes('gpt') ? 'gpt-image' : ''; if (alias) { const m = matching.find(x => modelId(x).toLowerCase().includes(alias)); if (m) return m; } }
  if (type === 'image') return matching.find(m => /gemini-3\.1-flash-image|nano-banana-2/.test(modelId(m).toLowerCase())) || matching.find(m => /gpt-image-1\.5/.test(modelId(m).toLowerCase())) || matching[0];
  if (type === 'video') return matching.find(m => /veo-3\.1-fast/.test(modelId(m).toLowerCase())) || matching.find(m => /sora-2/.test(modelId(m).toLowerCase())) || matching[0];
  return matching[0];
}

async function runTool(name, args, sid) {
  if (name === 'web_search') {
    const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: env('TAVILY_API_KEY'), query: args.query, max_results: args.max_results || 5, include_answer: false }) });
    if (!r.ok) throw new Error(`Recherche Web indisponible (${r.status}).`);
    const data = await r.json(); return { results: (data.results || []).map(x => ({ title: x.title, url: x.url, content: x.content, published_date: x.published_date })) };
  }
  if (name === 'get_weather') {
    const url = new URL('https://api.weatherapi.com/v1/forecast.json'); url.search = new URLSearchParams({ key: env('WEATHERAPI_KEY'), q: args.location, days: String(args.days || 1), aqi: 'no', alerts: 'no' });
    const r = await fetch(url); const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || 'Service météo indisponible.');
    return { location: data.location.name, region: data.location.region, country: data.location.country, localtime: data.location.localtime, current: data.current, forecast: data.forecast?.forecastday };
  }
  if (name === 'calendar_action') {
    const calendar = google.calendar({ version: 'v3', auth: googleClient(sid) }); const action = args.action;
    if (action === 'list' || action === 'search') {
      const r = await calendar.events.list({ calendarId: 'primary', timeMin: args.time_min || new Date().toISOString(), timeMax: args.time_max, q: action === 'search' ? args.query : undefined, maxResults: args.max_results || 10, singleEvents: true, orderBy: 'startTime' });
      return { events: (r.data.items || []).map(e => ({ id: e.id, summary: e.summary, description: e.description, location: e.location, start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, htmlLink: e.htmlLink })) };
    }
    if (action === 'create') { const r = await calendar.events.insert({ calendarId: 'primary', requestBody: { summary: args.summary, description: args.description, location: args.location, start: { dateTime: args.start }, end: { dateTime: args.end } } }); return { event: r.data }; }
    if (action === 'update') { const r = await calendar.events.patch({ calendarId: 'primary', eventId: args.event_id, requestBody: { summary: args.summary, description: args.description, location: args.location, ...(args.start ? { start: { dateTime: args.start } } : {}), ...(args.end ? { end: { dateTime: args.end } } : {}) } }); return { event: r.data }; }
    if (action === 'delete') { await calendar.events.delete({ calendarId: 'primary', eventId: args.event_id }); return { deleted: true, event_id: args.event_id }; }
  }
  if (name === 'prepare_email') {
    const id = crypto.randomUUID(); pendingEmails.set(id, { ...args, sid, expires: Date.now() + 15 * 60 * 1000 });
    return { status: 'confirmation_required', confirmation_id: id, to: args.to, subject: args.subject, body: args.body, message: 'Email en attente. Il faut une confirmation explicite dans l’interface avant envoi.' };
  }
  if (name === 'notion_action') {
    const headers = { Authorization: `Bearer ${env('NOTION_API_KEY')}`, 'Notion-Version': process.env.NOTION_VERSION || '2022-06-28', 'Content-Type': 'application/json' };
    if (args.action === 'search') { const r = await fetch('https://api.notion.com/v1/search', { method: 'POST', headers, body: JSON.stringify({ query: args.query || '', page_size: 10 }) }); const d = await r.json(); if (!r.ok) throw new Error(d.message || 'Recherche Notion indisponible.'); return { results: (d.results || []).map(x => ({ id: x.id, type: x.object, title: x.title?.map(t => t.plain_text).join('') || x.properties?.title?.title?.map(t => t.plain_text).join(''), url: x.url, last_edited_time: x.last_edited_time })) }; }
    if (args.action === 'read') { const r = await fetch(`https://api.notion.com/v1/blocks/${encodeURIComponent(args.page_id)}/children?page_size=100`, { headers }); const d = await r.json(); if (!r.ok) throw new Error(d.message || 'Lecture Notion indisponible.'); return { blocks: (d.results || []).map(b => ({ type: b.type, text: b[b.type]?.rich_text?.map(t => t.plain_text).join('') || b[b.type]?.title?.map(t => t.plain_text).join('') || '' })) }; }
    if (args.action === 'create') { const parent = args.parent_id ? { page_id: args.parent_id } : null; if (!parent) throw new Error('Indique une page ou une base Notion parent (parent_id) pour créer la note.'); const children = (args.content || '').split('\n').filter(Boolean).map(line => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }] } })); const r = await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers, body: JSON.stringify({ parent, properties: { title: { title: [{ text: { content: args.title || 'Note sans titre' } }] } }, children }) }); const d = await r.json(); if (!r.ok) throw new Error(d.message || 'Création Notion indisponible.'); return { id: d.id, url: d.url, title: args.title }; }
  }
  if (name === 'drive_action') {
    const drive = google.drive({ version: 'v3', auth: googleClient(sid) });
    if (args.action === 'search') { const safe = (args.query || '').replace(/'/g, "\\'"); const r = await drive.files.list({ q: `name contains '${safe}' and trashed = false`, pageSize: args.max_results || 10, fields: 'files(id,name,mimeType,modifiedTime,webViewLink,description,size)', orderBy: 'modifiedTime desc' }); return { files: r.data.files }; }
    const meta = await drive.files.get({ fileId: args.file_id, fields: 'id,name,mimeType,modifiedTime,webViewLink,description' });
    if (meta.data.mimeType === 'application/vnd.google-apps.document') { const r = await drive.files.export({ fileId: args.file_id, mimeType: 'text/plain' }); return { metadata: meta.data, content: String(r.data).slice(0, 16000) }; }
    if (meta.data.mimeType?.startsWith('text/')) { const r = await drive.files.get({ fileId: args.file_id, alt: 'media' }); return { metadata: meta.data, content: String(r.data).slice(0, 16000) }; }
    return { metadata: meta.data, note: 'Aperçu du contenu non disponible pour ce format.' };
  }
  if (name === 'list_ai_models') {
    const models = await rodiumModels(); const task = args.task || 'all';
    const filtered = task === 'all' ? models : models.filter(m => { const id = modelId(m).toLowerCase(); const caps = m.rodiumai_capabilities || m.capabilities || {}; return task === 'image' ? /image|imagen|nano-banana/.test(id) || (caps.output_modalities || []).includes('image') : task === 'video' ? /sora|veo|video/.test(id) || (caps.output_modalities || []).includes('video') : !/image|imagen|nano-banana|sora|veo|video/.test(id) && caps.supports_tools !== false; });
    return { models: filtered.slice(0, 80).map(m => ({ id: modelId(m), name: m.name, capabilities: m.rodiumai_capabilities || m.capabilities })) };
  }
  if (name === 'create_image' || name === 'create_video') {
    const type = name === 'create_image' ? 'image' : 'video'; const models = await rodiumModels(); const selected = chooseRodiumModel(models, type, args.model_preference || '');
    const id = crypto.randomUUID(); const options = type === 'image' ? { size: args.size || '1024x1024', quality: args.quality || 'medium' } : { duration_seconds: args.duration_seconds || 8, aspect_ratio: args.aspect_ratio || '16:9' };
    pendingMedia.set(id, { id, sid, type, prompt: args.prompt, model: modelId(selected), options, expires: Date.now() + 15 * 60 * 1000 });
    return { status: 'confirmation_required', confirmation_id: id, type, model: modelId(selected), prompt: args.prompt, options, message: 'Génération non lancée : la personne doit confirmer dans l’interface.' };
  }
  throw new Error(`Outil inconnu : ${name}`);
}

app.get('/api/status', (req, res) => res.json({ configured: { openai: !!(process.env.RODIUMAI_API_KEY || process.env.OPENAI_API_KEY), web: !!process.env.TAVILY_API_KEY, weather: !!process.env.WEATHERAPI_KEY, google: googleTokens.has(req.sessionId), googleReady: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), notion: !!process.env.NOTION_API_KEY, email: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) } }));
function makeGoogleAuthUrl(sid) { const oauth = getGoogleOAuth(); const state = crypto.randomBytes(24).toString('hex'); sessions.get(sid).oauthState = state; return oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', state, scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/drive.readonly'] }); }
app.get('/api/auth/google/url', (req, res) => { try { res.json({ url: makeGoogleAuthUrl(req.sessionId) }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.get('/auth/google', (req, res) => { try { res.redirect(makeGoogleAuthUrl(req.sessionId)); } catch (e) { res.status(400).send(e.message); } });
app.get('/auth/google/callback', async (req, res) => { try { const session = sessions.get(req.headers['x-session-id']); const sid = req.query.state ? [...sessions.entries()].find(([, s]) => s.oauthState === req.query.state)?.[0] : null; if (!sid) return res.status(400).send('Session OAuth invalide. Relance la connexion depuis l’application.'); const oauth = getGoogleOAuth(); const { tokens } = await oauth.getToken(req.query.code); googleTokens.set(sid, tokens); sessions.get(sid).oauthState = null; res.redirect('/?connected=google'); } catch (e) { res.status(400).send(`Connexion Google impossible : ${e.message}`); } });
app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [] } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'Écris un message pour commencer.' });
    const safeMessages = messages.slice(-24).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 12000) })).filter(m => ['user', 'assistant'].includes(m.role));
    const conversation = [{ role: 'system', content: `Tu es MAÏA, une assistante personnelle attentive, compétente et naturelle. Réponds en français sauf si l’utilisateur écrit dans une autre langue. Sois chaleureuse sans être bavarde, précise, et dis clairement ce que tu as pu ou non vérifier. Tu peux utiliser plusieurs outils et enchaîner leurs résultats pour répondre à une demande complexe. Choisis dynamiquement les outils utiles; ne prétends jamais avoir consulté un service sans l’avoir appelé. Pour les recherches Web, cite les sources avec leurs URL exactes. Pour un email, prépare-le avec prepare_email, puis indique qu’il attend confirmation; ne dis jamais qu’il a été envoyé. Avant toute création, modification ou suppression d’événement, vérifie que les détails indispensables sont présents; la suppression nécessite un identifiant d’événement non ambigu. Les outils Notion/Drive ne voient que le contenu partagé avec l’intégration. Si une intégration manque, explique simplement comment la configurer.` }, ...safeMessages];
    const client = openai(); let response; let iterations = 0;
    do {
      response = await client.chat.completions.create({ model: process.env.RODIUMAI_MODEL || process.env.OPENAI_MODEL || (process.env.RODIUMAI_API_KEY ? 'rodiumai/smart' : 'gpt-4o-mini'), messages: conversation, tools, tool_choice: 'auto', temperature: 0.4 });
      const assistant = response.choices[0].message; conversation.push(assistant);
      if (!assistant.tool_calls?.length) break;
      for (const call of assistant.tool_calls) {
        let result;
        try { result = await runTool(call.function.name, JSON.parse(call.function.arguments), req.sessionId); }
        catch (err) { result = { error: err.message }; }
        conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    } while (++iterations < 8);
    const waiting = [...pendingEmails.entries()].filter(([, e]) => e.sid === req.sessionId && e.expires > Date.now()).map(([id, e]) => ({ id, to: e.to, subject: e.subject, body: e.body }));
    const mediaWaiting = [...pendingMedia.values()].filter(e => e.sid === req.sessionId && e.expires > Date.now()).map(({ id, type, prompt, model, options }) => ({ id, type, prompt, model, options }));
    res.json({ reply: response.choices[0].message.content || 'Je n’ai pas pu formuler de réponse. Réessaie avec un peu plus de détails.', pendingEmails: waiting, pendingMedia: mediaWaiting });
  } catch (e) { console.error('chat:', e.message); res.status(500).json({ error: e.message || 'Une erreur est survenue.' }); }
});
app.post('/api/email/confirm', async (req, res) => {
  try {
    const item = pendingEmails.get(req.body?.id);
    if (!item || item.sid !== req.sessionId || item.expires < Date.now()) return res.status(404).json({ error: 'Cette confirmation a expiré ou n’existe plus. Demande à préparer le message à nouveau.' });
    const transporter = nodemailer.createTransport({ host: env('SMTP_HOST'), port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: { user: env('SMTP_USER'), pass: env('SMTP_PASSWORD') } });
    await transporter.sendMail({ from: process.env.EMAIL_FROM || process.env.SMTP_USER, to: item.to, subject: item.subject, text: item.body });
    pendingEmails.delete(req.body.id); res.json({ sent: true, to: item.to, subject: item.subject });
  } catch (e) { res.status(500).json({ error: e.message || 'Envoi impossible.' }); }
});
app.post('/api/email/cancel', (req, res) => { const item = pendingEmails.get(req.body?.id); if (item?.sid === req.sessionId) pendingEmails.delete(req.body.id); res.json({ cancelled: true }); });
app.post('/api/media/cancel', (req, res) => { const item = pendingMedia.get(req.body?.id); if (item?.sid === req.sessionId) pendingMedia.delete(req.body.id); res.json({ cancelled: true }); });
app.post('/api/media/confirm', async (req, res) => {
  try {
    const item = pendingMedia.get(req.body?.id);
    if (!item || item.sid !== req.sessionId || item.expires < Date.now()) return res.status(404).json({ error: 'Cette confirmation a expiré. Demande à préparer la génération à nouveau.' });
    const key = env('RODIUMAI_API_KEY'); const base = rodiumBase().replace(/\/$/, '');
    const endpoint = item.type === 'image' ? 'images/generations' : 'videos/generations';
    const body = { model: item.model, prompt: item.prompt, ...item.options };
    const response = await fetch(`${base}/${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(item.type === 'video' ? 12 * 60 * 1000 : 3 * 60 * 1000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `RodiumAI a refusé la génération (${response.status}).`);
    const output = data.data?.[0]; if (!output) throw new Error('RodiumAI n’a retourné aucun média.');
    const ext = item.type === 'video' ? 'mp4' : (output.mime_type || 'image/png').split('/')[1]?.split(';')[0] || 'png';
    let url = output.url;
    if (output.b64_json) { const dir = path.join(__dirname, 'public', 'generated'); await fs.mkdir(dir, { recursive: true }); const filename = `${crypto.randomUUID()}.${ext}`; await fs.writeFile(path.join(dir, filename), Buffer.from(output.b64_json, 'base64')); url = `/generated/${filename}`; }
    pendingMedia.delete(item.id);
    if (!url) throw new Error('RodiumAI a retourné un média sans fichier exploitable.');
    res.json({ type: item.type, model: item.model, url, duration_seconds: data.duration_seconds || item.options.duration_seconds });
  } catch (e) { res.status(500).json({ error: e.message || 'La génération a échoué.' }); }
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const server = app.listen(PORT, () => console.log(`MAÏA est prête sur ${APP_URL}`));
server.timeout = 12 * 60 * 1000;
