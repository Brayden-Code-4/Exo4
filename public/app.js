const $ = (s) => document.querySelector(s);
const input = $('#messageInput'), form = $('#chatForm'), messagesEl = $('#messages');
const sessionKey = 'maia-session';
let sessionId = localStorage.getItem(sessionKey) || '';
let history = [];
let pending = new Map();
const serviceMeta = [
  ['openai','Maïa','Modèle IA'], ['web','Recherche web','Actualités et sources'], ['weather','Météo','Prévisions locales'], ['google','Google Calendar & Drive','Agenda et documents'], ['notion','Notion','Vos notes et pages'], ['email','Email','Envoi avec confirmation']
];
async function api(url, options={}) {
  const headers = { 'Content-Type':'application/json', ...(sessionId ? {'X-Session-Id':sessionId}:{}), ...(options.headers||{}) };
  const response = await fetch(url, {...options, headers});
  const sid = response.headers.get('X-Session-Id'); if (sid) { sessionId=sid; localStorage.setItem(sessionKey,sid); }
  const data=await response.json().catch(()=>({})); if(!response.ok) throw new Error(data.error||`Erreur ${response.status}`); return data;
}
function renderServices(config) {
  const list=$('#integrationList'); list.innerHTML='';
  for(const [key,name,sub] of serviceMeta) { const connected=key==='google'?config.google:config[key];
    const row=document.createElement('div'); row.className='integration-row';
    const icon=document.createElement('span'); icon.className=`service-icon service-${key}`; icon.textContent={openai:'✳',web:'⌕',weather:'☼',google:'G',notion:'N',email:'↗'}[key];
    const labels=document.createElement('span'); labels.className='integration-label'; labels.innerHTML=`<strong>${name}</strong><small>${key==='google'&&connected?'Connecté':connected?sub:'À configurer'}</small>`;
    const status=document.createElement('span'); status.className=`status-indicator ${connected?'connected':''}`; status.title=connected?'Connecté':'Non configuré'; row.append(icon,labels,status); list.append(row);
  }
  const configured=Object.entries(config).filter(([k,v])=>k!=='googleReady'&&v).length;
  $('#connectionSummary').textContent=config.google?`${configured} services prêts, dont Google connecté`: `${configured} services configurés • Google ${config.googleReady?'à connecter':'à configurer'}`;
  const ms=$('#modalServices'); ms.innerHTML='';
  for(const [key,name,sub] of serviceMeta) { const connected=key==='google'?config.google:config[key]; const row=document.createElement('div'); row.className='modal-service'; row.innerHTML=`<span class="service-icon service-${key}">${{openai:'✳',web:'⌕',weather:'☼',google:'G',notion:'N',email:'↗'}[key]}</span><span><strong>${name}</strong><small>${key==='google'&&!connected?(config.googleReady?'Relier votre compte Google':'Clés Google manquantes'):connected?'Prêt à l’emploi':sub}</small></span>${key==='google'&&!connected&&config.googleReady?'<a class="google-connect" href="/auth/google">Connecter</a>':`<i class="status-indicator ${connected?'connected':''}"></i>`}`; ms.append(row); }
}
async function loadStatus(){try{const d=await api('/api/status');renderServices(d.configured);}catch{$('#connectionSummary').textContent='Serveur indisponible';}}
function escapeHtml(s=''){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function formatText(s=''){const links=[];s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>{const i=links.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>`)-1;return `@@LINK${i}@@`;});let html=escapeHtml(s).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer">$1 ↗</a>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');return html.replace(/@@LINK(\d+)@@/g,(_,i)=>links[Number(i)]||'');}
function addMessage(role,text){const item=document.createElement('article');item.className=`message ${role}`;const avatar=document.createElement('div');avatar.className='message-avatar';avatar.textContent=role==='assistant'?'✳':'M';const body=document.createElement('div');body.className='message-body';body.innerHTML=`<div class="message-name">${role==='assistant'?'Maïa':'Vous'} <span>${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span></div><div class="message-text">${formatText(text)}</div>`;item.append(avatar,body);messagesEl.append(item);messagesEl.scrollTop=messagesEl.scrollHeight;return item;}
function emailCard(email){const card=document.createElement('div');card.className='email-confirm-card';card.innerHTML=`<div class="email-card-top"><span class="email-card-icon">↗</span><div><strong>Un email est prêt à partir</strong><small>Vérifiez son contenu avant l’envoi</small></div></div><div class="email-fields"><div><small>À</small><strong>${escapeHtml(email.to)}</strong></div><div><small>Objet</small><strong>${escapeHtml(email.subject)}</strong></div><p>${escapeHtml(email.body)}</p></div><div class="email-actions"><button class="cancel-email">Annuler</button><button class="confirm-email">Confirmer et envoyer</button></div>`;
card.querySelector('.confirm-email').onclick=async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='Envoi…';try{const d=await api('/api/email/confirm',{method:'POST',body:JSON.stringify({id:email.id})});card.classList.add('email-sent');card.querySelector('.email-actions').innerHTML='';const s=document.createElement('small');s.className='email-success';s.textContent=`✓ Envoyé à ${d.to}`;card.append(s);toast('Votre email a bien été envoyé.');}catch(err){b.disabled=false;b.textContent='Confirmer et envoyer';toast(err.message);}};
card.querySelector('.cancel-email').onclick=async()=>{try{await api('/api/email/cancel',{method:'POST',body:JSON.stringify({id:email.id})});}catch{}card.remove();toast('Email annulé.');};return card;}
function mediaCard(media){const card=document.createElement('div');card.className='email-confirm-card media-confirm-card';const video=media.type==='video';const details=video?`${media.options.duration_seconds} secondes · ${media.options.aspect_ratio}`:media.options.size;card.innerHTML=`<div class="email-card-top"><span class="email-card-icon">${video?'▶':'✦'}</span><div><strong>${video?'Une vidéo':'Une image'} est prête à générer</strong><small>${escapeHtml(media.model)} · ${escapeHtml(details)}</small></div></div><div class="email-fields"><p>${escapeHtml(media.prompt)}</p><small class="media-cost-note">Cette génération peut consommer des crédits RodiumAI. Vérifiez votre choix avant de confirmer.</small></div><div class="email-actions"><button class="cancel-email">Annuler</button><button class="confirm-email">${video?'Confirmer et créer la vidéo':'Confirmer et créer l’image'}</button></div>`;
card.querySelector('.confirm-email').onclick=async e=>{const b=e.currentTarget;b.disabled=true;b.textContent=video?'Création en cours…':'Génération…';try{const d=await api('/api/media/confirm',{method:'POST',body:JSON.stringify({id:media.id})});card.querySelector('.email-actions').remove();card.querySelector('.email-fields').remove();const result=document.createElement('div');result.className='generated-media';if(d.type==='video'){const player=document.createElement('video');player.controls=true;player.playsInline=true;player.src=d.url;result.append(player);}else{const img=document.createElement('img');img.src=d.url;img.alt=media.prompt;result.append(img);}const link=document.createElement('a');link.href=d.url;link.target='_blank';link.rel='noopener noreferrer';link.download='';link.className='media-download';link.textContent='Ouvrir ou télécharger ↗';result.append(link);card.append(result);toast(video?'Votre vidéo est prête.':'Votre image est prête.');}catch(err){b.disabled=false;b.textContent=video?'Réessayer la génération':'Réessayer';toast(err.message);}};
card.querySelector('.cancel-email').onclick=async()=>{try{await api('/api/media/cancel',{method:'POST',body:JSON.stringify({id:media.id})});}catch{}card.remove();toast('Génération annulée.');};return card;}
function toast(text){const el=$('#toast');el.textContent=text;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3200);}
function setBusy(busy){$('#sendButton').disabled=busy;input.disabled=busy;form.classList.toggle('busy',busy);}
async function send(text){text=text.trim();if(!text)return;$('#welcome').classList.add('hidden');addMessage('user',text);history.push({role:'user',content:text});input.value='';input.style.height='auto';setBusy(true);
 const thinking=addMessage('assistant','');thinking.querySelector('.message-text').innerHTML='<span class="thinking"><i></i><i></i><i></i><span>Je m’en occupe</span></span>';
 try{const d=await api('/api/chat',{method:'POST',body:JSON.stringify({messages:history})});thinking.querySelector('.message-text').innerHTML=formatText(d.reply);history.push({role:'assistant',content:d.reply});for(const email of d.pendingEmails||[]){if(!pending.has(email.id)){pending.set(email.id,email);thinking.querySelector('.message-body').append(emailCard(email));}}for(const media of d.pendingMedia||[]){if(!pending.has(media.id)){pending.set(media.id,media);thinking.querySelector('.message-body').append(mediaCard(media));}}}
 catch(err){thinking.querySelector('.message-text').textContent=err.message;thinking.classList.add('error');} finally{setBusy(false);input.focus();messagesEl.scrollTop=messagesEl.scrollHeight;}}
form.addEventListener('submit',e=>{e.preventDefault();send(input.value);});
input.addEventListener('input',()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px';});
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});
document.querySelectorAll('.suggestion').forEach(b=>b.addEventListener('click',()=>send(b.dataset.prompt)));
$('#newChat').onclick=()=>{history=[];pending.clear();messagesEl.innerHTML='';$('#welcome').classList.remove('hidden');input.focus();};
$('#connectionsNav').onclick=()=>{$('#modalBackdrop').classList.add('open');};
$('#closeModal').onclick=$('#closeModalBottom').onclick=()=>$('#modalBackdrop').classList.remove('open');
$('#modalServices').addEventListener('click',async e=>{const link=e.target.closest('.google-connect');if(!link)return;e.preventDefault();try{const d=await api('/api/auth/google/url');location.href=d.url;}catch(err){toast(err.message);}});
$('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')e.currentTarget.classList.remove('open');});
$('#helpButton').onclick=()=>toast('Écrivez naturellement : Maïa choisira les outils utiles à votre demande.');
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#newChat').click();}});
if(new URLSearchParams(location.search).has('connected')){history.replaceState({},'', '/');toast('Google est connecté à votre espace.');}
loadStatus();
