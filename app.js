/* Speak Easy - learning pack with voice practice. All processing happens on this device. */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtPause = s => esc(s).replace(/\[([^\]]+)\]/g, '<span class="pz">$1</span>');
const app = $('#app');
let DATA = null;
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const state = { user: LS.get('se_user', ''), voice: LS.get('se_voice', 'f'), words: LS.get('se_words', true) };

/* ---------- IndexedDB for recordings ---------- */
let dbP = null;
function db() {
  if (dbP) return dbP;
  dbP = new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('no idb'));
    const r = indexedDB.open('speak-easy', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('takes');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbP;
}
async function idbPut(key, val) { try { const d = await db(); await new Promise((res, rej) => { const t = d.transaction('takes', 'readwrite'); t.objectStore('takes').put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { console.warn('save failed', e); } }
async function idbGet(key) { try { const d = await db(); return await new Promise((res, rej) => { const r = d.transaction('takes').objectStore('takes').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); } catch { return undefined; } }

/* ---------- Progress ---------- */
const progKey = () => 'se_prog_' + state.user.toLowerCase();
const getProg = () => LS.get(progKey(), {});
function saveScore(pid, score) {
  const p = getProg(); const prev = p[pid] || { best: 0, tries: 0 };
  p[pid] = { best: Math.max(prev.best, score), tries: prev.tries + 1, last: score, at: Date.now() };
  LS.set(progKey(), p); return p[pid];
}
function lessonProgress(l) {
  const p = getProg(); const done = l.phrases.filter(x => p[x.id]);
  const avg = done.length ? Math.round(done.reduce((a, x) => a + p[x.id].best, 0) / done.length) : 0;
  return { done: done.length, total: l.phrases.length, avg };
}

/* ---------- Theme ---------- */
const THEMES = { light: ['☀️', 'Light'], dark: ['🌙', 'Dark'], auto: ['🌓', 'Auto'] };
const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
let themePref = LS.get('se_theme', 'auto'); if (!THEMES[themePref]) themePref = 'auto';
function applyTheme() {
  const dark = themePref === 'dark' || (themePref === 'auto' && mq && mq.matches);
  const r = document.documentElement; r.setAttribute('data-theme', dark ? 'dark' : 'light'); r.setAttribute('data-theme-pref', themePref);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', dark ? '#0b1620' : '#0f3d5e');
  const [ic, nm] = THEMES[themePref]; $('#themeIcon').textContent = ic; $('#themeName').textContent = nm;
  $('#themeBtn').setAttribute('aria-label', 'Colour theme: ' + nm + '. Tap to change.');
  redrawWaves();
}
function cycleTheme() { themePref = { light: 'dark', dark: 'auto', auto: 'light' }[themePref]; LS.set('se_theme', themePref); applyTheme(); toast('Theme: ' + THEMES[themePref][1] + (themePref === 'auto' ? ' (follows your phone setting)' : '')); }
if (mq) (mq.addEventListener ? mq.addEventListener('change', () => themePref === 'auto' && applyTheme()) : mq.addListener(() => themePref === 'auto' && applyTheme()));
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function redrawWaves() { document.querySelectorAll('canvas[data-wave]').forEach(cv => cv._wave && drawWave(cv, ...cv._wave)); }

/* ---------- Toast ---------- */
function toast(msg, ms = 2600) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }

/* ---------- Users ---------- */
function updateHeader() {
  $('#userName').textContent = state.user || 'Name';
  $('#voiceName').textContent = state.voice === 'm' ? 'Luke' : 'Leah';
}
function askName() {
  const dlg = $('#nameDlg'); const users = LS.get('se_users', []);
  const list = $('#nameList'); list.innerHTML = '';
  users.forEach(u => { const b = document.createElement('button'); b.type = 'button'; b.textContent = u; b.onclick = () => { $('#nameInput').value = u; setUser(u); $('#nameDlg').close && $('#nameDlg').close(); }; list.appendChild(b); });
  $('#nameInput').value = '';
  if (users.length) { const lab = document.createElement('p'); lab.className = 'muted'; lab.style.cssText = 'width:100%;margin:0;font-size:.85rem'; lab.textContent = 'Names used on this device:'; list.prepend(lab); }
  if (dlg.showModal) dlg.showModal(); else { const n = prompt('Who is practising?', state.user || ''); if (n) setUser(n); }
}
function setUser(n) {
  n = n.trim().replace(/\s+/g, ' ').slice(0, 30); if (!n) return;
  n = n.charAt(0).toUpperCase() + n.slice(1);
  state.user = n; LS.set('se_user', n);
  const users = LS.get('se_users', []); if (!users.some(u => u.toLowerCase() === n.toLowerCase())) { users.push(n); LS.set('se_users', users); }
  updateHeader(); route();
}
$('#nameForm').addEventListener('submit', e => { setUser($('#nameInput').value); });
$('#userBtn').onclick = askName;
$('#themeBtn').onclick = cycleTheme;
applyTheme();
$('#voiceBtn').onclick = () => { state.voice = state.voice === 'f' ? 'm' : 'f'; LS.set('se_voice', state.voice); updateHeader(); stopModel(); toast('Example voice: ' + DATA.voices[state.voice]); };

/* ---------- Audio helpers ---------- */
let actx = null;
const ctx = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
const modelUrl = (pid, v = state.voice) => (window.SE_AUDIO ? window.SE_AUDIO[`${pid}-${v}`] : `audio/${pid}-${v}.mp3`);
const modelCache = new Map();
async function decode(buf) {
  const c = ctx();
  return await new Promise((res, rej) => { const p = c.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
}
async function modelAnalysis(pid) {
  const k = pid + state.voice;
  if (!modelCache.has(k)) modelCache.set(k, (async () => { const r = await fetch(modelUrl(pid)); if (!r.ok) throw new Error('Example audio missing'); return analyze(await decode(await r.arrayBuffer())); })());
  return modelCache.get(k);
}
const player = new Audio(); player.preload = 'none'; let playingBtn = null;
function stopModel() { player.pause(); if (playingBtn) { playingBtn.innerHTML = '▶ Play example'; playingBtn = null; } }
player.onended = stopModel;
player.onerror = () => { if (playingBtn) toast('Could not play the example audio.'); stopModel(); };
function playModel(pid, btn) {
  if (playingBtn === btn) return stopModel();
  stopModel(); player.src = modelUrl(pid); playingBtn = btn; btn.innerHTML = '⏸ Stop';
  player.play().catch(err => { console.warn(err); stopModel(); });
}

/* ---------- Analysis ---------- */
function percentile(arr, p) { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))]; }
function std(a) { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }
function analyze(buffer) {
  const sr = buffer.sampleRate; const n = buffer.length;
  const data = new Float32Array(n);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) { const c = buffer.getChannelData(ch); for (let i = 0; i < n; i++) data[i] += c[i] / buffer.numberOfChannels; }
  const hop = Math.round(sr * 0.02); const frames = Math.floor(n / hop);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; const o = f * hop; for (let i = 0; i < hop; i++) { const v = data[o + i]; s += v * v; } rms[f] = Math.sqrt(s / hop); }
  const arr = Array.from(rms); const noise = percentile(arr, 0.1); const peak = percentile(arr, 0.95);
  const thr = Math.max(noise * 2.5, peak * 0.1, 0.002);
  const voiced = arr.map(v => v > thr);
  // smooth: fill 1-frame gaps
  for (let f = 1; f < frames - 1; f++) if (!voiced[f] && voiced[f - 1] && voiced[f + 1]) voiced[f] = true;
  const first = voiced.indexOf(true), last = voiced.lastIndexOf(true);
  const res = { duration: n / sr, sr, peaks: peaksOf(data, 600), peak };
  if (first < 0 || peak < 0.004) { res.silent = true; return res; }
  res.speakStart = first * 0.02; res.speakEnd = (last + 1) * 0.02; res.speak = res.speakEnd - res.speakStart;
  // pauses >= 220 ms inside speech
  const minPause = 11; const pauses = []; let run = 0;
  for (let f = first; f <= last; f++) { if (!voiced[f]) run++; else { if (run >= minPause) pauses.push(run * 0.02); run = 0; } }
  res.pauses = pauses.length; res.pauseTotal = pauses.reduce((a, b) => a + b, 0); res.pauseMax = pauses.length ? Math.max(...pauses) : 0;
  const db = []; for (let f = first; f <= last; f++) if (voiced[f]) db.push(20 * Math.log10(rms[f] + 1e-9));
  res.loudVar = std(db);
  // pitch via normalised autocorrelation on a decimated signal
  const dec = Math.max(1, Math.floor(sr / 11000)); const dsr = sr / dec; const m = Math.floor(n / dec);
  const d = new Float32Array(m); for (let i = 0; i < m; i++) { let s = 0; for (let j = 0; j < dec; j++) s += data[i * dec + j]; d[i] = s / dec; }
  const win = Math.round(dsr * 0.04), minLag = Math.floor(dsr / 400), maxLag = Math.ceil(dsr / 70);
  const pitches = [];
  for (let f = first; f <= last; f += 2) {
    if (!voiced[f] || rms[f] < thr * 1.5) continue;
    const o = Math.floor(f * hop / dec); if (o + win + maxLag >= m) break;
    let e0 = 0; for (let i = 0; i < win; i++) e0 += d[o + i] * d[o + i]; if (e0 <= 0) continue;
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) { let s = 0, e1 = 0; for (let i = 0; i < win; i++) { const b = d[o + i + lag]; s += d[o + i] * b; e1 += b * b; } const r = s / Math.sqrt(e0 * e1 + 1e-12); if (r > best) { best = r; bestLag = lag; } }
    if (best > 0.6 && bestLag) pitches.push(dsr / bestLag);
  }
  if (pitches.length >= 5) {
    const med = percentile(pitches, 0.5);
    const st = pitches.filter(p => p > med * 0.6 && p < med * 1.7).map(p => 12 * Math.log2(p / med));
    res.pitchMed = med; res.pitchVar = std(st); res.pitchN = st.length;
  }
  return res;
}
function peaksOf(data, buckets) {
  const out = new Float32Array(buckets * 2); const step = Math.max(1, Math.floor(data.length / buckets));
  for (let b = 0; b < buckets; b++) { let mn = 0, mx = 0; const o = b * step; for (let i = 0; i < step && o + i < data.length; i++) { const v = data[o + i]; if (v < mn) mn = v; if (v > mx) mx = v; } out[2 * b] = mn; out[2 * b + 1] = mx; }
  return out;
}
function drawWave(canvas, a, colorVar, maxDur) {
  canvas._wave = [a, colorVar, maxDur]; canvas.dataset.wave = '1';
  const dpr = window.devicePixelRatio || 1; const w = canvas.clientWidth || 300, h = canvas.clientHeight || 64;
  canvas.width = w * dpr; canvas.height = h * dpr; const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const usedW = w * Math.min(1, a.duration / maxDur);
  if (a.speakStart != null) { g.fillStyle = cssVar('--wavebg'); g.fillRect(a.speakStart / a.duration * usedW, 0, (a.speak / a.duration) * usedW, h); }
  g.strokeStyle = cssVar('--waveaxis'); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  const p = a.peaks, nb = p.length / 2; let amp = 0; for (let i = 0; i < p.length; i++) amp = Math.max(amp, Math.abs(p[i])); amp = amp || 1;
  g.fillStyle = cssVar(colorVar);
  for (let b = 0; b < nb; b++) { const x = b / nb * usedW; const y1 = h / 2 - (p[2 * b + 1] / amp) * (h / 2 - 2); const y2 = h / 2 - (p[2 * b] / amp) * (h / 2 - 2); g.fillRect(x, y1, Math.max(1, usedW / nb), Math.max(1, y2 - y1)); }
}
/* ---------- Words ---------- */
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = 'x x twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
function numWords(n) {
  if (n < 20) return ONES[n]; if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numWords(n % 100) : '');
  if (n < 1e6) return numWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numWords(n % 1000) : '');
  return String(n);
}
function normWords(s) {
  s = s.toLowerCase().replace(/r\s?(\d[\d\s,]*\d|\d)/g, (m, d) => d + ' rand').replace(/(\d)[\s,](?=\d{3}\b)/g, '$1')
    .replace(/\b(\d{1,6})\b/g, (m, d) => numWords(+d)).replace(/[’']/g, '').replace(/[^a-z\s]/g, ' ').replace(/\band\b/g, ' ');
  return s.split(/\s+/).filter(Boolean);
}
function wordMatch(target, said) {
  const t = normWords(target), s = normWords(said);
  const L = Array.from({ length: t.length + 1 }, () => new Array(s.length + 1).fill(0));
  for (let i = t.length - 1; i >= 0; i--) for (let j = s.length - 1; j >= 0; j--) L[i][j] = t[i] === s[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const hit = new Array(t.length).fill(false); let i = 0, j = 0;
  while (i < t.length && j < s.length) { if (t[i] === s[j]) { hit[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  return { pct: t.length ? Math.round(100 * L[0][0] / t.length) : 0, words: t, hit };
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/* ---------- Comparison ---------- */
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
function compare(phrase, model, you, wm) {
  const words = phrase.words;
  const mW = words / model.speak * 60, yW = words / you.speak * 60;
  const paceDiff = (yW - mW) / mW;
  const parts = []; const tips = [];
  const pace = clamp(100 - Math.abs(paceDiff) * 150); parts.push([pace, 30]);
  if (paceDiff > 0.12) tips.push(`You spoke ${Math.round(paceDiff * 100)}% faster than the example. Slow down, and pause after the key point.`);
  else if (paceDiff < -0.2) tips.push(`You spoke ${Math.round(-paceDiff * 100)}% slower than the example. Keep the pauses, but move a little quicker between them.`);
  else tips.push('Your pace is close to the example. Well done.');
  const pd = you.pauses - model.pauses;
  const pauseS = clamp(100 - Math.abs(pd) * 18 - Math.max(0, you.pauseMax - Math.max(1.2, model.pauseMax * 2)) * 25); parts.push([pauseS, 20]);
  if (pd < 0 && model.pauses > 0) tips.push(`The example has ${model.pauses} clear pause${model.pauses > 1 ? 's' : ''}. You had ${you.pauses}. Add a short pause at the commas and before the key words.`);
  else if (pd > 1) tips.push(`You paused ${you.pauses} times (the example pauses ${model.pauses} times). Try to say each sentence in one smooth breath.`);
  if (you.pauseMax > Math.max(1.2, model.pauseMax * 2)) tips.push(`Your longest pause was ${you.pauseMax.toFixed(1)} seconds. Know your next words before you start, so the gaps stay short.`);
  let expr, exprLabel;
  if (you.pitchVar != null && model.pitchVar != null) { const r = you.pitchVar / model.pitchVar; expr = r >= 0.8 ? clamp(100 - Math.max(0, r - 1.8) * 40) : clamp(100 * r / 0.8); exprLabel = 'pitch';
    if (r < 0.6) tips.push('Your voice sounded quite flat (monotone). Lift your voice on the important words, and let it drop at the end of statements.');
    else if (r > 2) tips.push('Your pitch jumped around a lot. Keep it steadier and save the lift for the key words.');
    else tips.push('Good voice movement. You do not sound monotone.');
  } else { const r = (you.loudVar || 0) / (model.loudVar || 1); expr = r >= 0.7 ? 100 : clamp(100 * r / 0.7); exprLabel = 'volume';
    if (r < 0.5) tips.push('Your volume stayed very even. Put a little more weight on the key words.'); }
  parts.push([expr, 25]);
  if (you.peak < 0.03) tips.push('The recording is quite soft. Hold the phone a bit closer, or speak up a little.');
  if (wm) { parts.push([wm.pct, 25]); if (wm.pct < 80) tips.push(`About ${wm.pct}% of the words matched the script. Read it once more before you record, and say every word clearly.`); }
  const score = Math.round(parts.reduce((a, [v, w]) => a + v * w, 0) / parts.reduce((a, [, w]) => a + w, 0));
  return { score, mW, yW, paceDiff, pace, pauseS, expr, exprLabel, tips };
}

/* ---------- Recording ---------- */
function pickMime() { const c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']; if (!window.MediaRecorder) return null; for (const m of c) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m; return ''; }
let active = null;
async function startRec(phrase, box) {
  if (active) return stopRec();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast('Recording needs a secure (https) page in Chrome, Edge, Firefox or Safari.', 4000); return; }
  stopModel();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { toast('Microphone permission was not given. Allow the microphone for this site and try again.', 4500); return; }
  const mime = pickMime(); const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = []; rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
  const btn = $('.rec', box); btn.classList.add('on'); const t0 = Date.now();
  const tick = setInterval(() => { btn.textContent = '■ Stop ' + ((Date.now() - t0) / 1000).toFixed(0) + 's'; }, 250);
  btn.textContent = '■ Stop 0s';
  let transcript = '', recog = null;
  if (SR && state.words) {
    try { recog = new SR(); recog.lang = 'en-ZA'; recog.continuous = true; recog.interimResults = true;
      recog.onresult = ev => { transcript = Array.from(ev.results).map(r => r[0].transcript).join(' '); };
      recog.onerror = ev => { console.warn('speech recognition:', ev.error); };
      recog.start(); } catch (e) { recog = null; }
  }
  const auto = setTimeout(() => stopRec(), 60000);
  active = { rec, stream, box, phrase, tick, auto, recog, done: null };
  active.done = new Promise(res => { rec.onstop = res; });
  rec.start(250);
  active.finish = async () => {
    clearInterval(tick); clearTimeout(auto); btn.classList.remove('on'); btn.textContent = '● Record again';
    stream.getTracks().forEach(t => t.stop());
    if (recog) { await new Promise(r => { const to = setTimeout(r, 1500); recog.onend = () => { clearTimeout(to); r(); }; try { recog.stop(); } catch { r(); } }); }
    const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
    await handleTake(phrase, box, blob, recog ? transcript : null, true);
  };
}
async function stopRec() {
  const a = active; if (!a) return; active = null;
  try { a.rec.stop(); } catch {}
  await a.done; await a.finish();
}
async function handleTake(phrase, box, blob, transcript, fresh) {
  const out = $('.result', box); out.innerHTML = '<p class="muted">Comparing…</p>';
  const url = URL.createObjectURL(blob);
  let you, model;
  try { [model, you] = await Promise.all([modelAnalysis(phrase.id), decode(await blob.arrayBuffer()).then(analyze)]); }
  catch (e) { console.warn(e); out.innerHTML = '<div class="warn">Sorry, this recording could not be read on this device. Try again.</div>'; return; }
  const yourPlay = `<button class="btn" data-act="playme">▶ Play my take</button>`;
  if (you.silent || !you.speak || you.speak < 0.4) { out.innerHTML = `<div class="warn">We couldn't hear much speech in that take. Check that the microphone is allowed and not muted, then record again.</div><div class="ctrls">${yourPlay}</div>`; bindMe(out, url); return; }
  const wm = transcript != null && transcript.trim() ? wordMatch(phrase.t, transcript) : null;
  const c = compare(phrase, model, you, wm);
  let best;
  if (fresh) { best = saveScore(phrase.id, c.score); idbPut(state.user.toLowerCase() + '|' + phrase.id, { blob, transcript, at: Date.now(), score: c.score, voice: state.voice }); }
  else best = getProg()[phrase.id];
  const maxDur = Math.max(model.duration, you.duration);
  const f = (v, d = 1) => (v == null ? '–' : v.toFixed(d));
  out.innerHTML = `
    <div class="wave">
      <figure><figcaption><span style="color:var(--model)">Example (${esc(state.voice === 'm' ? 'Luke' : 'Leah')})</span><span>${f(model.duration)} s</span></figcaption><canvas class="cm"></canvas></figure>
      <figure><figcaption><span style="color:var(--you)">You</span><span>${f(you.duration)} s</span></figcaption><canvas class="cy"></canvas></figure>
    </div>
    <div class="cmp">
      <div class="score"><div class="ring" style="--p:${c.score}"><span>${c.score}</span></div>
        <div><b>${c.score >= 85 ? 'Excellent!' : c.score >= 70 ? 'Good take' : c.score >= 50 ? 'Getting there' : 'Keep practising'}</b><br><span class="best">Your best: ${best ? best.best : c.score} · tries: ${best ? best.tries : 1}</span></div></div>
      <table class="m"><thead><tr><th></th><th>Example</th><th>You</th></tr></thead><tbody>
        <tr><td>Speaking time</td><td>${f(model.speak)} s</td><td>${f(you.speak)} s</td></tr>
        <tr><td>Pace (words per minute)</td><td>${Math.round(c.mW)}</td><td>${Math.round(c.yW)}</td></tr>
        <tr><td>Pauses (longer than 0.2 s)</td><td>${model.pauses} · ${f(model.pauseTotal)} s</td><td>${you.pauses} · ${f(you.pauseTotal)} s</td></tr>
        <tr><td>Pitch movement (semitones)</td><td>${f(model.pitchVar)}</td><td>${f(you.pitchVar)}</td></tr>
        <tr><td>Volume movement (decibels)</td><td>${f(model.loudVar)}</td><td>${f(you.loudVar)}</td></tr>
        ${wm ? `<tr><td>Words matched</td><td>–</td><td>${wm.pct}%</td></tr>` : ''}
      </tbody></table>
      <ul class="tips">${c.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      ${wm ? `<div class="transcript"><b>What we heard:</b> “${esc(transcript)}”<br><b>Script words:</b> ${wm.words.map((w, i) => `<span class="${wm.hit[i] ? 'hit' : 'miss'}">${esc(w)}</span>`).join(' ')}</div>`
        : `<p class="muted transcript">${SR ? (state.words ? 'No words were recognised this time, so the score uses sound only.' : 'Word checking is switched off.') : 'Word checking works in Chrome or Edge (including Chrome on Android). This browser scores the sound only.'}</p>`}
    </div>
    <div class="ctrls">${yourPlay}<button class="btn" data-act="playboth">▶ Example, then me</button></div>`;
  requestAnimationFrame(() => { drawWave($('.cm', out), model, '--model', maxDur); drawWave($('.cy', out), you, '--you', maxDur); });
  bindMe(out, url, phrase);
  const lb = $('.lbest', box); if (lb && best) lb.textContent = `Best ${best.best}`;
  out.dataset.done = '1';
}
function bindMe(out, url, phrase) {
  const me = new Audio(url);
  const pm = $('[data-act=playme]', out); if (pm) pm.onclick = () => { stopModel(); me.currentTime = 0; me.play(); };
  const pb = $('[data-act=playboth]', out); if (pb) pb.onclick = () => { stopModel(); const m = new Audio(modelUrl(phrase.id)); m.onended = () => setTimeout(() => { me.currentTime = 0; me.play(); }, 500); m.play(); };
}

/* ---------- Views ---------- */
function home() {
  document.title = 'Speak Easy';
  const p = getProg(); const tried = Object.keys(p).length; const all = DATA.lessons.reduce((a, l) => a + l.phrases.length, 0);
  const avg = tried ? Math.round(Object.values(p).reduce((a, x) => a + x.best, 0) / tried) : 0;
  const started = DATA.lessons.filter(l => lessonProgress(l).done).length;
  app.innerHTML = `
  <section class="hero">
    <h1>Speak Easy</h1>
    <p>13 short lessons to sound confident, clear and likeable at work, with clients and in your team. Read the lesson, hear how it should sound, then record yourself and compare.</p>
    <div class="stats"><div class="stat"><b>${started}/13</b>lessons started</div><div class="stat"><b>${tried}/${all}</b>lines practised</div><div class="stat"><b>${avg || '–'}</b>average best score</div></div>
  </section>
  <section class="how"><h3>How to use it</h3><ol>
    <li>Pick a lesson and read it: the ideas, the steps, the Do and Don't list and the “How to say it” guide.</li>
    <li>Tap <b>▶ Play example</b> to hear each line spoken the right way.</li>
    <li>Tap <b>● Record</b>, say the line, and tap <b>■ Stop</b>. You'll see your score, the two sound waves and simple tips.</li>
    <li>Repeat until you beat your best score. Do the practice drill at the end of each lesson.</li></ol>
    <p class="muted" style="margin:.4em 0 0">Practising as <b>${esc(state.user || '…')}</b>. Tap your name at the top to switch person. Tap the 🔊 voice button to switch between Leah and Luke, and the ☀️ / 🌙 button for light, dark or automatic colours.</p></section>
  <div class="grid">${DATA.lessons.map(l => { const pr = lessonProgress(l); return `
    <a class="lcard" href="#/lesson/${l.id}"><span class="ic">${l.icon}</span><span style="flex:1;min-width:0">
      <span class="t">${l.n}. ${esc(l.title)}</span><br><span class="s">${pr.done ? `${pr.done}/${pr.total} lines · best average ${pr.avg}` : esc(l.goal)}</span>
      <span class="bar"><i style="width:${pr.done ? Math.max(4, pr.avg * pr.done / pr.total) : 0}%"></i></span></span></a>`; }).join('')}</div>`;
}
function lessonView(id) {
  const i = DATA.lessons.findIndex(l => l.id === id); if (i < 0) return home();
  const l = DATA.lessons[i], prev = DATA.lessons[i - 1], next = DATA.lessons[i + 1]; const p = getProg();
  document.title = `${l.title} · Speak Easy`;
  const secs = [['learn', 'Learn'], ['steps', 'Method'], ['dodont', 'Do / Don\'t'], ['howto', 'How to say it'], ['examples', 'At work'], ['practice', 'Practise'], ['drill', 'Drill']];
  app.innerHTML = `
  <a href="#/" class="crumb">← All lessons</a>
  <h1>${l.icon} ${l.n}. ${esc(l.title)}</h1>
  <div class="goal"><b>Goal:</b> ${esc(l.goal)}</div>
  <nav class="toc">${secs.map(([k, v]) => `<a href="javascript:void 0" data-go="${k}">${v}</a>`).join('')}</nav>
  <section class="sec" id="s-learn"><h2>The lesson</h2><p class="lead">${esc(l.intro)}</p><h3>Key ideas</h3><ul>${l.ideas.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>
  <section class="sec" id="s-steps"><h2>Step-by-step method</h2><ol>${l.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></section>
  <section class="sec" id="s-dodont"><h2>Do and don't</h2><div class="dd"><div class="do"><h3>Do</h3><ul>${l.dos.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div><div class="dont"><h3>Don't</h3><ul>${l.donts.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div></section>
  <section class="sec" id="s-howto"><h2>How to say it</h2><p>${esc(l.howto)}</p>
    ${l.badgood.map(([b, g]) => `<div class="bg"><div class="b"><span class="lab">✘ Sounds weak</span>${fmtPause(b)}</div><div class="g"><span class="lab">✔ Sounds strong</span>${fmtPause(g)}</div></div>`).join('')}
    <p class="muted" style="font-size:.85rem"><span class="pz">pause</span> means a short silence of about one second.</p></section>
  <section class="sec" id="s-examples"><h2>At work</h2><ul>${l.examples.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>
  <section class="sec" id="s-practice"><h2>Practise out loud</h2>
    <p class="muted">Read the script, play the example, then record yourself. ${SR ? `<label style="white-space:nowrap"><input type="checkbox" id="wordsChk" ${state.words ? 'checked' : ''}> Check my words</label>` : ''}</p>
    ${location.protocol !== 'https:' && !/^(localhost|127\.)/.test(location.hostname) ? '<div class="warn">Recording needs a secure (https) link. Playing the examples still works.</div>' : ''}
    ${l.phrases.map((ph, k) => `
    <div class="phrase" data-pid="${ph.id}">
      <div class="num">Line ${k + 1} <span class="lbest best" style="float:right">${p[ph.id] ? 'Best ' + p[ph.id].best : ''}</span></div>
      <p class="script">“${esc(ph.t)}”</p>
      <div class="note"><b>How it should sound:</b> ${esc(ph.how)}</div>
      <div class="ctrls"><button class="btn primary" data-act="play">▶ Play example</button><button class="btn rec" data-act="rec">● Record</button><button class="btn" data-act="last" hidden>↺ My last take</button></div>
      <div class="result"></div>
    </div>`).join('')}</section>
  <section class="sec drill" id="s-drill"><h2>Practice drill</h2><p>${esc(l.drill)}</p></section>
  <div class="pager">${prev ? `<a class="btn" href="#/lesson/${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="btn primary" href="#/lesson/${next.id}">${esc(next.title)} →</a>` : '<a class="btn primary" href="#/">All lessons</a>'}</div>`;
  app.querySelectorAll('[data-go]').forEach(a => a.onclick = () => $('#s-' + a.dataset.go).scrollIntoView({ behavior: 'smooth' }));
  const wc = $('#wordsChk'); if (wc) wc.onchange = () => { state.words = wc.checked; LS.set('se_words', state.words); };
  app.querySelectorAll('.phrase').forEach(box => {
    const ph = l.phrases.find(x => x.id === box.dataset.pid);
    $('[data-act=play]', box).onclick = e => playModel(ph.id, e.currentTarget);
    $('[data-act=rec]', box).onclick = () => startRec(ph, box);
    const lb = $('[data-act=last]', box);
    idbGet(state.user.toLowerCase() + '|' + ph.id).then(t => { if (t && t.blob) { lb.hidden = false; lb.onclick = () => { lb.hidden = true; handleTake(ph, box, t.blob, t.transcript, false); }; } });
  });
  window.scrollTo(0, 0);
}
function route() {
  if (active) { try { active.rec.stop(); active.stream.getTracks().forEach(t => t.stop()); } catch {} active = null; }
  stopModel();
  const m = location.hash.match(/^#\/lesson\/([\w-]+)/);
  if (m) lessonView(m[1]); else home();
}
window.addEventListener('hashchange', route);

(window.SE_DATA ? Promise.resolve(window.SE_DATA) : fetch("content.json").then(r => r.json())).then(d => { DATA = d; updateHeader(); route(); if (!state.user) askName(); })
  .catch(e => { app.innerHTML = '<div class="warn">Could not load the lessons. Check your connection and refresh.</div>'; console.error(e); });
})();
