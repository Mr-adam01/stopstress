/* =========================================================
   STOP STRESS – logique du site
   1. Réglages et stockage local
   2. Textes (FR / EN) et thème
   3. Voix : fichiers MP3 ou synthèse vocale
   4. Séance guidée (introduction + exercice)
   5. Check-out
   6. Lecteur des conseils audio
   7. Affichage des onglets
   8. Démarrage
   ========================================================= */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- 1. Réglages et stockage local ---------- */

// Le stockage local peut être bloqué (navigation privée) : on ne plante jamais.
const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem('stopstress.' + key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem('stopstress.' + key, value); } catch { /* ignoré */ }
  }
};

const browserLang = (navigator.language || 'fr').toLowerCase();

const state = {
  lang: store.get('lang', browserLang.startsWith('fr') ? 'fr' : 'en'),
  voice: store.get('voice', 'feminine'),
  theme: store.get('theme', 'auto'),
  country: store.get('country', null),
  content: null,
  helplines: null,
  manifest: {},
  tab: 'breathe',
  emotion: null,
  intensity: 5,
  lastIntensity: null,
  lastExerciseId: null,
  exploreCat: 'all',
  tipsCat: 'all'
};

function saveSetting(key, value) {
  state[key] = value;
  store.set(key, value);
}

/* ---------- 2. Textes et thème ---------- */

// t('ui.home.lead') renvoie le texte dans la langue choisie.
function t(path) {
  const value = path.split('.').reduce((obj, key) => (obj ? obj[key] : undefined), state.content);
  return value === undefined ? '' : value;
}

function applyTexts() {
  document.documentElement.lang = state.lang;
  $$('[data-i18n]').forEach((el) => {
    const text = t(el.dataset.i18n);
    if (text) el.textContent = text;
  });
  $$('[data-i18n-aria]').forEach((el) => {
    const text = t(el.dataset.i18nAria);
    el.setAttribute('aria-label', text);
    el.setAttribute('title', text);
  });
  document.title = `STOP STRESS – ${t('ui.tagline')}`;
}

function isNightNow() {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 6;
}

function applyTheme() {
  const night = state.theme === 'night' || (state.theme === 'auto' && isNightNow());
  if (night) document.documentElement.dataset.theme = 'night';
  else delete document.documentElement.dataset.theme;
  $$('[data-logo]').forEach((img) => { img.src = `assets/logo/logo-horizontal${night ? '-dark' : ''}.png`; });
  $$('[data-stop-icon]').forEach((img) => { img.src = `assets/logo/icon${night ? '-dark' : ''}-256.png`; });
  $('meta[name="theme-color"]').setAttribute('content', night ? '#0B1D1F' : '#F1F4F1');
}

/* ---------- 3. Voix ---------- */

// Durée estimée d'une phrase lue lentement (environ 13 caractères par seconde).
function estimateMs(text) {
  return Math.max(1200, text.length * 75);
}

const FEMALE_HINTS = ['female', 'femme', 'amélie', 'amelie', 'audrey', 'aurélie', 'aurelie', 'marie', 'julie', 'hortense', 'denise', 'céline', 'celine', 'léa', 'virginie', 'chantal', 'sylvie', 'eloise', 'vivienne', 'charline', 'samantha', 'karen', 'moira', 'tessa', 'serena', 'fiona', 'victoria', 'susan', 'zira', 'hazel', 'jenny', 'aria', 'sonia', 'libby', 'emma', 'olivia', 'ava', 'allison', 'kate', 'catherine', 'martha', 'joana', 'flo', 'sandy', 'shelley', 'google français'];
const MALE_HINTS = ['thomas', 'daniel', 'nicolas', 'paul', 'henri', 'claude', 'jacques', 'yves', 'gerard', 'guillaume', 'rémy', 'remy', 'antoine', 'mathieu', 'alex', 'fred', 'aaron', 'arthur', 'david', 'mark', 'george', 'guy', 'ryan', 'james', 'oliver', 'rishi', 'gordon', 'reed', 'rocco', 'eddy', 'grandpa'];

const Voice = {
  muted: false,
  current: null,      // lecture en cours : { stop() }
  unlocked: false,
  cache: { key: null, voice: null, matched: false },

  // Sur iPhone, la voix doit être « réveillée » pendant un clic de l'utilisateur.
  unlock() {
    if (this.unlocked || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    this.unlocked = true;
  },

  hasFile(id) {
    const files = (state.manifest[state.lang] || {})[state.voice] || [];
    return files.includes(id);
  },

  // Choisit la meilleure voix de l'appareil pour la langue et le genre demandés.
  pickSystemVoice() {
    const key = state.lang + state.voice;
    if (this.cache.key === key && this.cache.voice) return this.cache;
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(state.lang));
    const wantFemale = state.voice === 'feminine';
    const isFemale = (name) => FEMALE_HINTS.some((h) => name.includes(h));
    const isMale = (name) => /\bmale\b/.test(name) || MALE_HINTS.some((h) => name.includes(h));

    let best = null;
    let bestScore = -1;
    for (const v of voices) {
      const name = v.name.toLowerCase();
      let score = 0;
      const female = isFemale(name);
      const male = !female && isMale(name);
      if ((wantFemale && female) || (!wantFemale && male)) score += 10;
      if (/natural|premium|enhanced|neural/.test(name)) score += 3;
      if (state.lang === 'fr' && v.lang.toLowerCase() === 'fr-fr') score += 1;
      if (state.lang === 'en' && v.lang.toLowerCase() === 'en-gb') score += 1;
      if (score > bestScore) { best = v; bestScore = score; }
    }
    this.cache = { key, voice: best, matched: bestScore >= 10 };
    return this.cache;
  },

  // Joue une phrase. Renvoie une promesse : 'ended' (fini) ou 'stopped' (interrompu).
  play(id, text) {
    this.stop();
    return new Promise((resolve) => {
      let done = false;
      let guard = null;
      const handle = {};
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        if (this.current === handle) this.current = null;
        resolve(result);
      };
      const estimate = estimateMs(text);

      const speak = () => {
        if (!('speechSynthesis' in window)) {
          handle.stop = () => finish('stopped');
          guard = setTimeout(() => finish('ended'), estimate);
          return;
        }
        const synth = window.speechSynthesis;
        const u = new SpeechSynthesisUtterance(text);
        const { voice, matched } = this.pickSystemVoice();
        u.lang = state.lang === 'fr' ? 'fr-FR' : 'en-GB';
        if (voice) u.voice = voice;
        u.rate = 0.88;
        // Si aucune voix du bon genre n'existe sur l'appareil, on ajuste la hauteur.
        u.pitch = matched ? 1 : (state.voice === 'feminine' ? 1.15 : 0.8);
        u.onend = () => finish('ended');
        u.onerror = () => finish('ended');
        handle.stop = () => { synth.cancel(); finish('stopped'); };
        synth.cancel();
        synth.speak(u);
        // Sécurité : certains navigateurs n'envoient jamais l'événement de fin.
        guard = setTimeout(() => finish('ended'), estimate * 2 + 4000);
      };

      this.current = handle;
      if (this.hasFile(id)) {
        const audio = new Audio(`audio/${state.lang}/${state.voice}/${id}.mp3`);
        handle.stop = () => { audio.pause(); finish('stopped'); };
        audio.onended = () => finish('ended');
        audio.onerror = () => { if (!done) speak(); };
        audio.play().catch(() => { if (!done) speak(); });
        guard = setTimeout(() => finish('ended'), estimate * 3 + 15000);
      } else {
        speak();
      }
    });
  },

  stop() {
    if (this.current) this.current.stop();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
};

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => { Voice.cache.key = null; };
}

/* ---------- 4. Séance guidée ---------- */

const CANCEL = Symbol('cancel');
let session = null;
let wakeLock = null;

const findExercise = (id) => state.content.exercises.find((e) => e.id === id);

function blockSeconds(block) {
  return block.reps * block.phases.reduce((sum, p) => sum + p.s, 0);
}

// Durée de l'exercice en secondes (hors introduction).
function exerciseSeconds(ex) {
  if (ex.type === 'breath') return ex.blocks.reduce((sum, b) => sum + blockSeconds(b), 0);
  return Math.round(ex.steps.reduce((sum, step) => {
    if (step.breath) return sum + blockSeconds(step.breath);
    return sum + estimateMs(step.t) / 1000 + step.w;
  }, 0));
}

function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function formatDuration(seconds) {
  if (seconds < 120) return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  return `${Math.round(seconds / 60)} min`;
}

// Le cercle : t = 0 (vide) à 1 (plein), animé pendant « seconds ».
function setCircle(target, seconds) {
  const fill = $('#breath-fill');
  const sun = $('#breath-sun');
  const scale = 0.55 + 0.45 * target;
  [fill, sun].forEach((el) => { el.style.transitionDuration = `${seconds}s`; });
  fill.style.transform = `scale(${scale})`;
  sun.style.transform = `translateY(calc(var(--size) * ${-scale / 2}))`;
}

function freezeCircle() {
  ['#breath-fill', '#breath-sun'].forEach((sel) => {
    const el = $(sel);
    const current = getComputedStyle(el).transform;
    el.style.transitionDuration = '0s';
    el.style.transform = current;
  });
}

function setIdle(on) {
  $('#breath').classList.toggle('idle', on);
  if (on) {
    $('#breath-fill').style.transform = '';
    $('#breath-sun').style.transform = '';
  }
}

function setSubtitle(text) { $('#session-subtitle').textContent = text; }
function setBreathText(label, count) {
  $('#breath-label').textContent = label;
  $('#breath-count').textContent = count || '';
}
function updateTimer(s) { $('#session-timer').textContent = formatClock(s.total - s.elapsed); }

function check(s) { if (s.cancelled) throw CANCEL; }

// Attente qui respecte la pause et l'arrêt. abortIf permet de sortir plus tôt.
async function wait(s, ms, { counts = false, abortIf } = {}) {
  let left = ms;
  while (left > 0) {
    check(s);
    if (abortIf && abortIf()) return;
    const step = Math.min(100, left);
    await sleep(step);
    if (!s.paused) {
      left -= step;
      s.phaseLeft = left;
      if (counts) {
        s.elapsed += step / 1000;
        updateTimer(s);
      }
    }
  }
  check(s);
}

async function waitWhilePaused(s) {
  while (s.paused) { check(s); await sleep(100); }
  check(s);
}

// Dit une phrase en entier ; si on met en pause, la phrase est rejouée à la reprise.
async function say(s, id, text, { abortIf, counts = false } = {}) {
  setSubtitle(text);
  for (;;) {
    await waitWhilePaused(s);
    if (abortIf && abortIf()) return;
    if (Voice.muted) { await wait(s, estimateMs(text), { counts, abortIf }); return; }
    const started = Date.now();
    const result = await Voice.play(id, text);
    check(s);
    if (counts) { s.elapsed += (Date.now() - started) / 1000; updateTimer(s); }
    if (result === 'ended') return;
    if (abortIf && abortIf()) return;
    if (Voice.muted) return;
  }
}

async function runBreathBlocks(s, blocks) {
  const totalReps = blocks.reduce((sum, b) => sum + b.reps, 0);
  let rep = 0;
  setIdle(false);
  for (const block of blocks) {
    for (let r = 0; r < block.reps; r++) {
      rep++;
      for (const phase of block.phases) {
        check(s);
        await waitWhilePaused(s);
        const target = phase.k === 'out' ? 0 : phase.k === 'hold' ? s.circleTarget : (phase.to ?? 1);
        s.circleTarget = target;
        s.phaseSeconds = phase.s;
        setCircle(target, phase.s);
        setBreathText(t(`ui.session.labels.${phase.k}`), `${rep}/${totalReps}`);
        const cueText = state.content.cues[phase.cue];
        setSubtitle(cueText);
        if (!Voice.muted) Voice.play(`cue-${phase.cue}`, cueText);
        if (navigator.vibrate) navigator.vibrate(phase.k === 'hold' ? 15 : 35);
        await wait(s, phase.s * 1000, { counts: true });
      }
    }
  }
}

async function runSteps(s, ex) {
  const textSteps = ex.steps.filter((step) => step.t).length;
  let n = 0;
  for (let i = 0; i < ex.steps.length; i++) {
    const step = ex.steps[i];
    check(s);
    if (step.breath) {
      await runBreathBlocks(s, [step.breath]);
      setIdle(true);
      continue;
    }
    n++;
    setIdle(true);
    setBreathText(`${n}/${textSteps}`, '');
    await say(s, `ex-${ex.id}-${i + 1}`, step.t, { counts: true });
    await wait(s, step.w * 1000, { counts: true });
  }
}

async function runSession(s) {
  const content = state.content;
  // Introduction : toujours lue, sauf si l'utilisateur la passe.
  $('#session-phase-name').textContent = t('ui.session.intro');
  $('#session-skip').hidden = false;
  setIdle(true);
  setBreathText(t('ui.session.ready'), '');
  updateTimer(s);
  const skipped = () => s.skipIntro;
  for (let i = 0; i < content.intro.length; i++) {
    if (s.skipIntro) break;
    await say(s, `intro-${i + 1}`, content.intro[i], { abortIf: skipped });
    await wait(s, 600, { abortIf: skipped });
  }
  s.inIntro = false;
  $('#session-skip').hidden = true;
  $('#session-phase-name').textContent = s.eyebrow;
  setSubtitle('');

  if (s.ex.type === 'breath') await runBreathBlocks(s, s.ex.blocks);
  else await runSteps(s, s.ex);

  setIdle(true);
  setBreathText('', '');
  await say(s, 'end', content.endPhrase);
  await wait(s, 600);
  endSession(true);
}

async function keepScreenOn(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* non disponible : sans importance */ }
}

function startSession(exerciseId, options = {}) {
  if (session) endSession(false);
  Voice.unlock();
  const ex = findExercise(exerciseId);
  if (!ex) return;
  closePlayer();
  $('#checkout').hidden = true;

  session = {
    ex,
    routine: options.routine || null,
    eyebrow: options.routine ? t(`ui.routine.${options.routine}`) : t(`ui.explore.cats.${ex.category}`),
    total: exerciseSeconds(ex),
    elapsed: 0,
    paused: false,
    cancelled: false,
    skipIntro: false,
    inIntro: true,
    circleTarget: 0,
    phaseSeconds: 0,
    phaseLeft: 0
  };
  state.lastExerciseId = ex.id;

  $('#session-title').textContent = ex.title;
  $('#session-pause-label').textContent = t('ui.session.pause');
  $('#session-pause use').setAttribute('href', '#i-pause');
  updateMuteButton();
  setSubtitle('');
  $('#session').hidden = false;
  document.body.style.overflow = 'hidden';
  keepScreenOn(true);
  $('#session-close').focus();

  const s = session;
  runSession(s).catch((err) => { if (err !== CANCEL) console.error(err); });
}

function endSession(showCheckout) {
  const s = session;
  if (!s) return;
  s.cancelled = true;
  session = null;
  Voice.stop();
  keepScreenOn(false);
  $('#session').hidden = true;
  document.body.style.overflow = '';
  if (showCheckout) {
    if (s.routine) markRoutineDone(s.routine);
    openCheckout();
  }
}

function togglePause() {
  const s = session;
  if (!s) return;
  s.paused = !s.paused;
  $('#session-pause-label').textContent = t(s.paused ? 'ui.session.resume' : 'ui.session.pause');
  $('#session-pause use').setAttribute('href', s.paused ? '#i-play' : '#i-pause');
  if (s.paused) {
    Voice.stop();
    freezeCircle();
    $('#session-phase-name').textContent = t('ui.session.paused');
  } else {
    $('#session-phase-name').textContent = s.inIntro ? t('ui.session.intro') : s.eyebrow;
    // Le cercle reprend là où il s'était arrêté, pour le temps restant de la phase.
    if (!$('#breath').classList.contains('idle')) setCircle(s.circleTarget, s.phaseLeft / 1000);
  }
}

function updateMuteButton() {
  const btn = $('#session-mute');
  const label = t(Voice.muted ? 'ui.session.unmute' : 'ui.session.mute');
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
  $('use', btn).setAttribute('href', Voice.muted ? '#i-volume-x' : '#i-volume');
}

/* ---------- 5. Check-out ---------- */

const CHECKOUT_KEYS = ['much', 'better', 'same', 'worse'];
let checkoutChoice = null;

function openCheckout() {
  checkoutChoice = null;
  $('#checkout-ask').hidden = false;
  $('#checkout-result').hidden = true;
  $('#checkout-validate').disabled = true;
  const box = $('#checkout-options');
  box.replaceChildren(...CHECKOUT_KEYS.map((key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.dataset.value = key;
    btn.append(document.createTextNode(t(`ui.checkout.options.${key}`)), svgIcon('check'));
    btn.addEventListener('click', () => {
      checkoutChoice = key;
      $$('.option', box).forEach((o) => o.setAttribute('aria-checked', String(o === btn)));
      $('#checkout-validate').disabled = false;
    });
    return btn;
  }));
  $('#checkout').hidden = false;
  $('#checkout').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeCheckout() {
  $('#checkout').hidden = true;
  document.body.style.overflow = '';
}

function showCheckoutResult() {
  const worse = checkoutChoice === 'worse';
  const same = checkoutChoice === 'same';
  const intense = (state.lastIntensity || 0) >= 9;
  $('#checkout-message').textContent = t(worse ? 'ui.checkout.msgWorse' : same ? 'ui.checkout.msgSame' : 'ui.checkout.msgBetter');

  // Aide mise en avant si ça ne va pas mieux, ou si l'intensité de départ était très forte.
  const helpBox = $('#checkout-help');
  helpBox.hidden = !(worse || intense);
  if (!helpBox.hidden) {
    $('#checkout-help-text').textContent = t('ui.checkout.helpText');
    const country = state.helplines.countries.find((c) => c.code === state.country);
    const lines = country ? [...country.listen.slice(0, 1), ...country.emergency.slice(0, 1)] : [];
    $('#checkout-help-numbers').replaceChildren(...lines.map((line, i) => helpLine(line, i > 0 || !country.listen.length)));
  }

  // Proposer un autre exercice si besoin.
  const another = $('#checkout-another');
  another.hidden = !(worse || same || intense);
  if (!another.hidden) {
    const pool = (state.emotion && state.content.recommend[state.emotion]) || ['sigh', 'grounding', 'coherence'];
    const ids = [...pool, 'sigh', 'grounding', 'coherence'].filter((id, i, arr) => id !== state.lastExerciseId && arr.indexOf(id) === i).slice(0, 2);
    $('#checkout-another-list').replaceChildren(...ids.map((id) => exerciseCard(findExercise(id))));
  }

  $('#checkout-ask').hidden = true;
  $('#checkout-result').hidden = false;
  $('#checkout').scrollTop = 0;
}

/* ---------- 6. Lecteur des conseils audio ---------- */

const player = { tip: null, index: 0, playing: false, token: 0 };
const TIP_PAUSE_MS = 2200; // silence entre deux phrases, pour laisser le temps d'intégrer

function tipSeconds(tip) {
  return tip.segments.reduce((sum, text) => sum + (estimateMs(text) + TIP_PAUSE_MS) / 1000, 0);
}

function openPlayer(tipId) {
  const tip = state.content.tips.find((x) => x.id === tipId);
  if (!tip) return;
  player.tip = tip;
  player.index = 0;
  $('#player-title').textContent = tip.title;
  $('#player-dur').textContent = t('ui.durationApprox').replace('{m}', Math.max(1, Math.round(tipSeconds(tip) / 60)));
  $('#player').hidden = false;
  $('#player').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  renderPlayer();
  playerPlay();
}

function renderPlayer() {
  const { tip, index, playing } = player;
  const total = tip.segments.length;
  $('#player-meta').textContent = `${t(`ui.tips.cats.${tip.category}`)} · ${index + 1}/${total}`;
  const [open, close] = state.lang === 'fr' ? ['« ', ' »'] : ['“', '”'];
  $('#player-sub').textContent = open + tip.segments[index] + close;
  $('#player-pos').textContent = `${index + 1}/${total}`;
  $('#player-bar').style.width = `${((index + 1) / total) * 100}%`;
  $('#player-prev').disabled = index === 0;
  $('#player-next').disabled = index === total - 1;
  const playBtn = $('#player-play');
  const label = t(playing ? 'ui.player.pause' : 'ui.player.play');
  playBtn.setAttribute('aria-label', label);
  playBtn.setAttribute('title', label);
  $('use', playBtn).setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('.player').classList.toggle('playing', playing);
}

async function playerRun(token) {
  const { tip } = player;
  while (player.index < tip.segments.length) {
    renderPlayer();
    const result = await Voice.play(`tip-${tip.id}-${player.index + 1}`, tip.segments[player.index]);
    if (token !== player.token || result === 'stopped') return;
    await sleep(TIP_PAUSE_MS);
    if (token !== player.token) return;
    if (player.index === tip.segments.length - 1) break;
    player.index++;
  }
  player.playing = false;
  renderPlayer();
}

function playerPlay() {
  Voice.unlock();
  player.token++;
  player.playing = true;
  playerRun(player.token);
}

function playerPause() {
  player.token++;
  player.playing = false;
  Voice.stop();
  renderPlayer();
}

function playerJump(delta) {
  const wasPlaying = player.playing;
  player.token++;
  Voice.stop();
  player.index = Math.min(player.tip.segments.length - 1, Math.max(0, player.index + delta));
  if (wasPlaying) playerPlay();
  else renderPlayer();
}

function closePlayer() {
  if ($('#player').hidden) return;
  player.token++;
  player.playing = false;
  Voice.stop();
  $('#player').hidden = true;
  document.body.style.overflow = '';
}

/* ---------- 7. Affichage des onglets ---------- */

function svgIcon(name, extraClass = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon ${extraClass}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

// Carte de séance (exercice ou conseil), construite sans innerHTML.
function card({ category, title, meta, tone, icon, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'session-card';
  const art = document.createElement('span');
  art.className = 'session-art';
  art.dataset.tone = tone || 'mist';
  art.append(svgIcon(icon, 'art-icon'));
  const info = document.createElement('span');
  info.className = 'session-info';
  const cat = document.createElement('span');
  cat.className = 'session-cat';
  cat.textContent = category;
  const name = document.createElement('span');
  name.className = 'session-name';
  name.textContent = title;
  const metaEl = document.createElement('span');
  metaEl.className = 'session-meta';
  metaEl.append(svgIcon('clock'), document.createTextNode(meta));
  info.append(cat, name, metaEl);
  btn.append(art, info, svgIcon('chevron-right', 'session-go'));
  btn.addEventListener('click', onClick);
  return btn;
}

const CATEGORY_ICON = { breathing: 'wind', body: 'compass', anger: 'wind' };

function exerciseCard(ex) {
  return card({
    category: t(`ui.explore.cats.${ex.category}`),
    title: ex.title,
    meta: formatDuration(exerciseSeconds(ex)),
    tone: ex.tone,
    icon: CATEGORY_ICON[ex.category] || 'wind',
    onClick: () => startSession(ex.id)
  });
}

function tipCard(tip) {
  return card({
    category: t(`ui.tips.cats.${tip.category}`),
    title: tip.title,
    meta: t('ui.durationApprox').replace('{m}', Math.max(1, Math.round(tipSeconds(tip) / 60))),
    tone: tip.category === 'anger' || tip.category === 'panic' ? 'dawn' : 'mist',
    icon: 'headphones',
    onClick: () => openPlayer(tip.id)
  });
}

function chip(label, selected, onClick, role) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip';
  btn.textContent = label;
  btn.setAttribute('role', role);
  btn.setAttribute(role === 'tab' ? 'aria-selected' : 'aria-checked', String(selected));
  btn.addEventListener('click', onClick);
  return btn;
}

function showTab(tab) {
  state.tab = tab;
  $$('.view').forEach((view) => { view.hidden = view.id !== `view-${tab}`; });
  $$('.tab').forEach((btn) => {
    if (btn.dataset.tab === tab) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  try { history.replaceState(null, '', `#${tab}`); } catch { /* ignoré */ }
  window.scrollTo(0, 0);
}

// --- Respirer (accueil) ---
const routinePeriod = () => (new Date().getHours() < 15 ? 'morning' : 'evening');
const todayKey = () => new Date().toISOString().slice(0, 10);

function markRoutineDone(period) {
  store.set(`routine.${period}`, todayKey());
  renderRoutine();
}

function renderRoutine() {
  const period = routinePeriod();
  const done = store.get(`routine.${period}`, '') === todayKey();
  $('#routine-title').textContent = t(`ui.routine.${period}`);
  $('#routine-done').hidden = !done;
  $('#routine-start-label').textContent = t(done ? 'ui.routine.again' : 'ui.routine.start');
}

function renderHome() {
  $('#greeting').textContent = t(new Date().getHours() < 18 ? 'ui.home.greetMorning' : 'ui.home.greetEvening');
  renderRoutine();
  const emotions = state.content.ui.checkin.emotions;
  $('#emotion-chips').replaceChildren(...Object.keys(emotions).map((key) => chip(emotions[key], state.emotion === key, () => {
    state.emotion = key;
    renderHome();
    $('#intensity-box').hidden = false;
  }, 'radio')));
  $('#intensity-box').hidden = !state.emotion;
  if (!$('#reco').hidden) renderReco();
}

function renderReco() {
  if (!state.emotion) return;
  state.lastIntensity = state.intensity;
  const notes = [];
  if (state.intensity >= 9) notes.push(t('ui.checkin.highIntensity'));
  if (state.emotion === 'panic') notes.push(t('ui.checkin.panicNote'));
  $('#reco-alert').hidden = notes.length === 0;
  $('#reco-alert-text').textContent = notes.join(' ');
  const ids = state.content.recommend[state.emotion] || [];
  $('#reco-list').replaceChildren(...ids.map((id) => exerciseCard(findExercise(id))));
  $('#reco').hidden = false;
}

// --- Explorer ---
function renderExplore() {
  const cats = state.content.ui.explore.cats;
  $('#explore-chips').replaceChildren(...Object.keys(cats).map((key) => chip(cats[key], state.exploreCat === key, () => {
    state.exploreCat = key;
    renderExplore();
  }, 'tab')));
  const list = state.content.exercises.filter((ex) => state.exploreCat === 'all' || ex.category === state.exploreCat);
  $('#explore-list').replaceChildren(...list.map(exerciseCard));
}

// --- Conseils ---
function renderTips() {
  const cats = state.content.ui.tips.cats;
  $('#tips-chips').replaceChildren(...Object.keys(cats).map((key) => chip(cats[key], state.tipsCat === key, () => {
    state.tipsCat = key;
    renderTips();
  }, 'tab')));
  const list = state.content.tips.filter((tip) => state.tipsCat === 'all' || tip.category === state.tipsCat);
  $('#tips-list').replaceChildren(...list.map(tipCard));
}

// --- Aide ---
function helpLine(line, isEmergency) {
  const row = document.createElement('div');
  row.className = `help-line${isEmergency ? ' emergency' : ''}`;
  const main = document.createElement('div');
  main.className = 'help-line-main';
  const number = document.createElement('span');
  number.className = 'help-number';
  number.textContent = line.number;
  const label = document.createElement('span');
  label.className = 'help-label';
  label.textContent = line.label[state.lang];
  main.append(number, label);
  if (line.note) {
    const note = document.createElement('span');
    note.className = 'help-note';
    note.textContent = line.note[state.lang];
    main.append(note);
  }
  const actions = document.createElement('div');
  actions.className = 'help-actions';
  const digits = line.number.replace(/\s/g, '');
  const link = (href, icon, text, cls) => {
    const a = document.createElement('a');
    a.className = `btn btn-sm ${cls}`;
    a.href = href;
    a.append(svgIcon(icon, 'icon-sm'), document.createTextNode(text));
    return a;
  };
  if (!line.smsOnly) actions.append(link(`tel:${digits}`, 'phone', t('ui.help.call'), 'btn-tide'));
  if (line.sms || line.smsOnly) {
    const body = line.smsBody ? `?&body=${encodeURIComponent(line.smsBody)}` : '';
    actions.append(link(`sms:${digits}${body}`, 'message', t('ui.help.text'), line.smsOnly ? 'btn-tide' : 'btn-outline'));
  }
  row.append(main, actions);
  return row;
}

function group(titleText, children) {
  const section = document.createElement('section');
  section.className = 'help-group';
  const title = document.createElement('h2');
  title.className = 'title';
  title.textContent = titleText;
  section.append(title, ...children);
  return section;
}

function directoryLink() {
  const a = document.createElement('a');
  a.className = 'help-line link-card';
  a.href = state.helplines.international.url;
  a.target = '_blank';
  a.rel = 'noopener';
  const main = document.createElement('span');
  main.className = 'help-line-main';
  const label = document.createElement('span');
  label.className = 'help-label';
  label.textContent = state.helplines.international.label[state.lang];
  const note = document.createElement('span');
  note.className = 'help-note';
  note.textContent = 'findahelpline.com';
  main.append(label, note);
  a.append(main, svgIcon('external'));
  return a;
}

function renderCountrySelects() {
  const sorted = [...state.helplines.countries].sort((a, b) => a.name[state.lang].localeCompare(b.name[state.lang], state.lang));
  $$('[data-country-select]').forEach((select) => {
    const options = sorted.map((c) => new Option(c.name[state.lang], c.code));
    options.push(new Option(t('ui.help.other'), 'OTHER'));
    select.replaceChildren(...options);
    select.value = state.country;
  });
}

function renderHelp() {
  const box = $('#help-content');
  const country = state.helplines.countries.find((c) => c.code === state.country);
  if (!country) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = t('ui.help.otherText');
    box.replaceChildren(p, directoryLink());
    return;
  }
  const parts = [group(t('ui.help.emergency'), country.emergency.map((line) => helpLine(line, true)))];
  const listen = country.listen.map((line) => helpLine(line, false));
  if (!listen.length) {
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = t('ui.help.noListen');
    listen.push(p);
  }
  listen.push(directoryLink());
  parts.push(group(t('ui.help.listen'), listen));
  box.replaceChildren(...parts);
}

// --- Réglages ---
function renderSettings() {
  $$('.segmented').forEach((seg) => {
    const current = state[seg.dataset.setting];
    $$('button', seg).forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.value === current)));
  });
}

function renderAll() {
  applyTexts();
  applyTheme();
  renderHome();
  renderExplore();
  renderTips();
  renderCountrySelects();
  renderHelp();
  renderSettings();
}

/* ---------- 8. Démarrage ---------- */

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return res.json();
}

async function loadContent() {
  state.content = await loadJson(`api/content/${state.lang}`);
  Voice.cache.key = null;
}

function defaultCountry() {
  const region = (navigator.language || '').split('-')[1];
  const code = region ? region.toUpperCase() : null;
  return state.helplines.countries.some((c) => c.code === code) ? code : 'OTHER';
}

function bindEvents() {
  $$('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-goto]');
    if (target) showTab(target.dataset.goto);
  });

  // Accueil
  $('#stop-btn').addEventListener('click', () => {
    state.lastIntensity = state.emotion ? state.intensity : null;
    startSession('sigh');
  });
  $('#routine-start').addEventListener('click', () => startSession('deep', { routine: routinePeriod() }));
  $('#intensity').addEventListener('input', (e) => {
    state.intensity = Number(e.target.value);
    $('#intensity-value').textContent = `${state.intensity}/10`;
  });
  $('#see-exercises').addEventListener('click', () => {
    renderReco();
    $('#reco').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Séance
  $('#session-close').addEventListener('click', () => endSession(false));
  $('#session-finish').addEventListener('click', () => endSession(true));
  $('#session-pause').addEventListener('click', togglePause);
  $('#session-skip').addEventListener('click', () => {
    if (!session) return;
    session.skipIntro = true;
    Voice.stop();
  });
  $('#session-mute').addEventListener('click', () => {
    Voice.muted = !Voice.muted;
    if (Voice.muted) Voice.stop();
    updateMuteButton();
  });

  // Check-out
  $('#checkout-validate').addEventListener('click', showCheckoutResult);
  $('#checkout-skip').addEventListener('click', () => { closeCheckout(); showTab('breathe'); });
  $('#checkout-home').addEventListener('click', () => { closeCheckout(); showTab('breathe'); });
  $('#checkout-help-btn').addEventListener('click', () => { closeCheckout(); showTab('help'); });

  // Lecteur
  $('#player-back').addEventListener('click', closePlayer);
  $('#player-play').addEventListener('click', () => (player.playing ? playerPause() : playerPlay()));
  $('#player-prev').addEventListener('click', () => playerJump(-1));
  $('#player-next').addEventListener('click', () => playerJump(1));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (session) endSession(false);
    else if (!$('#player').hidden) closePlayer();
  });

  // Réglages
  $('#open-settings').addEventListener('click', () => { renderSettings(); $('#settings').showModal(); });
  $$('.segmented button').forEach((btn) => btn.addEventListener('click', async () => {
    const key = btn.parentElement.dataset.setting;
    saveSetting(key, btn.dataset.value);
    if (key === 'lang') {
      try { await loadContent(); } catch (err) { console.error(err); }
      renderAll();
    } else if (key === 'theme') {
      applyTheme();
    } else if (key === 'voice') {
      Voice.cache.key = null;
    }
    renderSettings();
  }));
  $('#test-voice').addEventListener('click', () => {
    Voice.unlock();
    Voice.play('sample', state.content.voiceSample);
  });
  $$('[data-country-select]').forEach((select) => select.addEventListener('change', () => {
    saveSetting('country', select.value);
    $$('[data-country-select]').forEach((other) => { other.value = select.value; });
    renderHelp();
  }));
  $('#settings').addEventListener('close', () => Voice.stop());

  // Rappels agenda
  $('#open-reminders').addEventListener('click', () => $('#reminders').showModal());
  $('#reminders-close').addEventListener('click', () => $('#reminders').close());
  $('#reminders-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const params = new URLSearchParams({ lang: state.lang, wake: $('#wake-time').value, bed: $('#bed-time').value });
    window.location.href = `api/reminders.ics?${params}`;
    $('#reminders').close();
  });
  // Fermer une feuille en touchant le fond
  $$('dialog.sheet').forEach((dialog) => dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  }));

  // Thème automatique : on revérifie l'heure chaque minute (passage à 20 h).
  setInterval(() => {
    if (state.theme === 'auto') applyTheme();
    renderRoutine();
  }, 60000);
}

async function init() {
  applyTheme();
  try {
    const [helplines, manifest] = await Promise.all([
      loadJson('api/helplines'),
      loadJson('api/audio-manifest').catch(() => ({})),
      loadContent()
    ]);
    state.helplines = helplines;
    state.manifest = manifest;
  } catch (err) {
    console.error(err);
    $('#main').textContent = state.lang === 'fr'
      ? 'Impossible de charger le contenu. Vérifiez votre connexion puis rechargez la page.'
      : 'The content could not be loaded. Check your connection, then reload the page.';
    return;
  }
  if (!state.country) saveSetting('country', defaultCountry());
  bindEvents();
  renderAll();
  const hashTab = location.hash.slice(1);
  showTab(['breathe', 'explore', 'tips', 'help'].includes(hashTab) ? hashTab : 'breathe');
}

init();
