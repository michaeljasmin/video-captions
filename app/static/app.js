"use strict";

const $ = (id) => document.getElementById(id);

const DEFAULT_STYLE = {
  font: "Inter", weight: 700, size: 6.5, pos: 68, color: "#ffffff",
  shadow: 70, outline: false, upper: false, punct: false, words: 4,
};

const state = {
  view: "home",
  meta: null,        // infos de la vidéo ouverte (largeur, hauteur, durée…)
  words: [],         // mots Whisper avec timestamps
  captions: [],      // { start, end, text, edited }
  style: { ...DEFAULT_STYLE },
  savedSnap: null,   // état au dernier enregistrement, pour savoir s'il y a des changements
  settings: { presets: [], vocabulary: { prompt: "", rules: "" }, lastStyle: null },
  drawnKey: null,    // évite de redessiner l'aperçu inutilement
};

// ---------- Outils ----------

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function errorText(body) {
  try { return JSON.parse(body).detail || body; } catch { return body || "Erreur inconnue"; }
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(errorText(await res.text()));
  return res.json();
}

function putJSON(path, data) {
  return api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}

function setStatus(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.className = "status " + kind;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

function fmtDuration(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, "0")}`;
}

function fmtSize(bytes) {
  return bytes > 1e9 ? (bytes / 1e9).toFixed(2) + " Go" : (bytes / 1e6).toFixed(1) + " Mo";
}

function fmtAgo(seconds) {
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `il y a ${Math.floor(diff / 86400)} j`;
  return new Date(seconds * 1000).toLocaleDateString("fr-CA", { day: "numeric", month: "short" });
}

function projectName(meta) {
  return (meta.name || "Vidéo").replace(/\.[^.]+$/, "");
}

// Fenêtre de choix : renvoie la valeur du bouton cliqué (Échap = premier bouton).
function modal({ title, text, buttons }) {
  return new Promise((resolve) => {
    $("modalTitle").textContent = title;
    $("modalText").textContent = text;
    const box = $("modalButtons");
    box.innerHTML = "";
    const close = (value) => {
      $("modal").classList.add("hidden");
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(buttons[0].value); }
    };
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.textContent = b.label;
      btn.className = b.primary ? "primary inline" : b.danger ? "danger inline" : "ghost inline";
      btn.addEventListener("click", () => close(b.value));
      box.append(btn);
    }
    document.addEventListener("keydown", onKey, true);
    $("modal").classList.remove("hidden");
    box.lastElementChild.focus();
  });
}

// ---------- Réglages de l'app (presets, vocabulaire, dernier style) ----------

const saveSettings = debounce(() => putJSON("/api/settings", state.settings).catch(() => {}), 400);

async function loadSettings() {
  const saved = await api("/api/settings").catch(() => ({}));
  state.settings = {
    presets: [], lastStyle: null, ...saved,
    vocabulary: { prompt: "", rules: "", ...(saved.vocabulary || {}) },
  };
  // Reprend les réglages de la version précédente (mémoire du navigateur) une seule fois.
  try {
    if (!saved.vocabulary && localStorage.getItem("captions-rules")) {
      state.settings.vocabulary.rules = localStorage.getItem("captions-rules");
    }
    if (!saved.lastStyle && localStorage.getItem("captions-style")) {
      state.settings.lastStyle = JSON.parse(localStorage.getItem("captions-style"));
    }
  } catch {}
  if (!saved.vocabulary || !saved.lastStyle) saveSettings();

  $("prompt").value = state.settings.vocabulary.prompt;
  rulesInput.value = state.settings.vocabulary.rules;
  updateRulesCount();
  renderPresets();
}

$("prompt").addEventListener("input", () => {
  state.settings.vocabulary.prompt = $("prompt").value;
  saveSettings();
});

// ---------- Enregistrement du projet ----------

function snapshot() {
  return JSON.stringify({ captions: state.captions, style: state.style, language: $("language").value });
}

function isDirty() {
  return state.view === "editor" && state.savedSnap !== null && snapshot() !== state.savedSnap;
}

function refreshDirty() {
  const dirty = isDirty();
  $("saveBtn").disabled = !dirty;
  $("saved").textContent = dirty ? "Modifications non enregistrées" : state.savedSnap ? "Enregistré" : "";
  $("saved").classList.toggle("dirty", dirty);
}

async function saveProject() {
  if (!state.meta) return;
  const snap = snapshot();
  $("saved").textContent = "Enregistrement…";
  try {
    await putJSON(`/api/projects/${state.meta.id}`, JSON.parse(snap));
    state.savedSnap = snap;
  } catch (e) {
    await modal({ title: "Enregistrement impossible", text: e.message, buttons: [{ label: "OK", value: "ok" }] });
  }
  refreshDirty();
}

$("saveBtn").addEventListener("click", saveProject);
$("language").addEventListener("change", refreshDirty);

// Demande quoi faire des changements non enregistrés. Renvoie false si l'utilisateur annule.
async function confirmLeave() {
  if (!isDirty()) return true;
  const choice = await modal({
    title: "Enregistrer les modifications ?",
    text: `Les changements apportés à « ${projectName(state.meta)} » seront perdus si tu ne les enregistres pas.`,
    buttons: [
      { label: "Annuler", value: "cancel" },
      { label: "Ne pas enregistrer", value: "discard" },
      { label: "Enregistrer", value: "save", primary: true },
    ],
  });
  if (choice === "cancel") return false;
  if (choice === "save") await saveProject();
  return true;
}

// Utilisés par Captions.app au moment de quitter.
window.hasUnsavedChanges = () => isDirty();
window.unsavedProjectName = () => (state.meta ? projectName(state.meta) : "");
window.saveNow = async () => { await saveProject(); return !isDirty(); };

// ---------- Annuler / Rétablir ----------

const history = { undo: [], redo: [], lastKey: null, lastTime: 0 };

// À appeler juste AVANT une modification. Les frappes successives dans le même champ
// (ou les mouvements d'un même curseur) ne forment qu'une seule étape.
function checkpoint(key = null) {
  const now = Date.now();
  if (key && key === history.lastKey && now - history.lastTime < 1500) {
    history.lastTime = now;
    return;
  }
  history.undo.push(JSON.stringify({ captions: state.captions, style: state.style }));
  if (history.undo.length > 200) history.undo.shift();
  history.redo = [];
  history.lastKey = key;
  history.lastTime = now;
  updateHistoryButtons();
}

function resetHistory() {
  history.undo = [];
  history.redo = [];
  history.lastKey = null;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $("undoBtn").disabled = !history.undo.length;
  $("redoBtn").disabled = !history.redo.length;
}

function restoreState(json) {
  const s = JSON.parse(json);
  const wordsChanged = s.style.words !== state.style.words;
  state.captions = s.captions;
  state.style = s.style;
  syncStyleInputs();
  renderCaptionList();
  if (wordsChanged) $("o-words").textContent = state.style.words;
  ensureFont().then(invalidatePreview);
  invalidatePreview();
  afterChange();
}

function undo() {
  if (!history.undo.length) return;
  history.redo.push(JSON.stringify({ captions: state.captions, style: state.style }));
  restoreState(history.undo.pop());
  history.lastKey = null;
  updateHistoryButtons();
}

function redo() {
  if (!history.redo.length) return;
  history.undo.push(JSON.stringify({ captions: state.captions, style: state.style }));
  restoreState(history.redo.pop());
  history.lastKey = null;
  updateHistoryButtons();
}

$("undoBtn").addEventListener("click", undo);
$("redoBtn").addEventListener("click", redo);

// Après toute modification du projet.
function afterChange() {
  refreshDirty();
  syncPresetSelect();
}

// ---------- Style ----------

const styleInputs = {
  font: "s-font", weight: "s-weight", size: "s-size", pos: "s-pos", color: "s-color",
  shadow: "s-shadow", outline: "s-outline", upper: "s-upper", punct: "s-punct", words: "s-words",
};

function syncStyleInputs() {
  for (const [key, id] of Object.entries(styleInputs)) {
    const el = $(id);
    if (el.type === "checkbox") el.checked = state.style[key];
    else el.value = state.style[key];
  }
  $("o-size").textContent = Number(state.style.size).toFixed(1);
  $("o-pos").textContent = state.style.pos + " %";
  $("o-shadow").textContent = state.style.shadow + " %";
  $("o-words").textContent = state.style.words;
  syncPresetSelect();
}

function rememberStyle() {
  state.settings.lastStyle = { ...state.style };
  saveSettings();
}

for (const [key, id] of Object.entries(styleInputs)) {
  $(id).addEventListener("input", (e) => {
    const el = e.target;
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (["weight", "size", "pos", "shadow", "words"].includes(key)) value = Number(value);
    checkpoint("style-" + key);
    state.style[key] = value;
    syncStyleInputs();
    if (key === "words" && state.words.length) buildCaptions();
    if (key === "font" || key === "weight") ensureFont().then(invalidatePreview);
    invalidatePreview();
    rememberStyle();
    afterChange();
  });
}

function applyStyle(style) {
  checkpoint();
  const wordsChanged = style.words !== state.style.words;
  state.style = { ...DEFAULT_STYLE, ...style };
  syncStyleInputs();
  if (wordsChanged && state.words.length) buildCaptions();
  ensureFont().then(invalidatePreview);
  invalidatePreview();
  rememberStyle();
  afterChange();
}

$("resetStyle").addEventListener("click", () => applyStyle({ ...DEFAULT_STYLE, words: state.style.words }));

function ensureFont() {
  if (state.style.font === "Arial") return Promise.resolve();
  return document.fonts.load(`${state.style.weight} 100px "${state.style.font}"`);
}

// ---------- Presets de style ----------

const sameStyle = (a, b) => Object.keys(DEFAULT_STYLE).every((k) => a[k] === b[k]);

function renderPresets() {
  const select = $("presetSelect");
  select.innerHTML = '<option value="">Presets…</option>';
  for (const p of state.settings.presets) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    select.append(opt);
  }
  syncPresetSelect();
}

function syncPresetSelect() {
  const match = state.settings.presets.find((p) => sameStyle({ ...DEFAULT_STYLE, ...p.style }, state.style));
  $("presetSelect").value = match ? match.name : "";
  $("presetDelete").classList.toggle("hidden", !match);
}

$("presetSelect").addEventListener("change", (e) => {
  const preset = state.settings.presets.find((p) => p.name === e.target.value);
  if (preset) applyStyle(preset.style);
});

$("presetSave").addEventListener("click", () => {
  $("presetForm").classList.remove("hidden");
  $("presetName").value = $("presetSelect").value;
  $("presetName").focus();
  $("presetName").select();
});

function closePresetForm() {
  $("presetForm").classList.add("hidden");
}

$("presetCancel").addEventListener("click", closePresetForm);
$("presetName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("presetConfirm").click();
  if (e.key === "Escape") closePresetForm();
});

$("presetConfirm").addEventListener("click", () => {
  const name = $("presetName").value.trim();
  if (!name) return $("presetName").focus();
  const presets = state.settings.presets.filter((p) => p.name !== name); // même nom = mise à jour
  presets.push({ name, style: { ...state.style } });
  presets.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  state.settings.presets = presets;
  saveSettings();
  renderPresets();
  closePresetForm();
});

$("presetDelete").addEventListener("click", async () => {
  const name = $("presetSelect").value;
  const choice = await modal({
    title: `Supprimer le preset « ${name} » ?`,
    text: "Le style actuel de la vidéo ne change pas.",
    buttons: [{ label: "Annuler", value: "cancel" }, { label: "Supprimer", value: "delete", danger: true }],
  });
  if (choice !== "delete") return;
  state.settings.presets = state.settings.presets.filter((p) => p.name !== name);
  saveSettings();
  renderPresets();
});

// ---------- Rendu d'une caption (partagé entre l'aperçu et l'export) ----------

function displayText(text) {
  let t = text;
  if (state.style.punct) t = t.replace(/[.,;:!?…«»"“”]/g, "").replace(/\s+/g, " ");
  if (state.style.upper) t = t.toLocaleUpperCase("fr");
  return t.trim();
}

function layoutCaption(ctx, text, W, H) {
  const st = state.style;
  const px = (st.size / 100) * Math.min(W, H);
  ctx.font = `${st.weight} ${px}px "${st.font}"`;
  const maxWidth = W * 0.84;

  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? line + " " + word : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const lineHeight = px * 1.18;
  const totalHeight = lines.length * lineHeight;
  const top = (st.pos / 100) * H - totalHeight / 2;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const pad = Math.ceil(px * 0.6); // marge pour l'ombre et le contour

  return {
    px, W,
    lines: lines.map((l, i) => ({ text: l, y: top + i * lineHeight + lineHeight / 2 })),
    box: {
      x: Math.floor(W / 2 - widest / 2) - pad,
      y: Math.floor(top) - pad,
      w: Math.ceil(widest) + 2 * pad + 2,
      h: Math.ceil(totalHeight) + 2 * pad + 2,
    },
  };
}

function drawCaption(ctx, layout, ox = 0, oy = 0) {
  const st = state.style;
  const { px, W } = layout;
  const strength = st.shadow / 100;
  ctx.font = `${st.weight} ${px}px "${st.font}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.fillStyle = st.color;

  const passes = strength > 0
    ? [
        { blur: px * 0.3, dy: px * 0.04, alpha: 0.75 * strength },  // halo doux
        { blur: px * 0.08, dy: px * 0.03, alpha: Math.min(1, 0.9 * strength) }, // ombre serrée
      ]
    : [{ blur: 0, dy: 0, alpha: 0 }];

  for (const l of layout.lines) {
    const x = W / 2 - ox;
    const y = l.y - oy;
    for (const p of passes) {
      ctx.shadowColor = `rgba(0,0,0,${p.alpha})`;
      ctx.shadowBlur = p.blur;
      ctx.shadowOffsetY = p.dy;
      if (st.outline) {
        ctx.lineWidth = px * 0.14;
        ctx.strokeStyle = "#000";
        ctx.strokeText(l.text, x, y);
      } else {
        ctx.fillText(l.text, x, y);
      }
    }
    ctx.shadowColor = "transparent";
    ctx.fillText(l.text, x, y);
  }
}

// ---------- Aperçu ----------

const video = $("video");
const overlay = $("overlay");
const octx = overlay.getContext("2d");

function activeIndex(t) {
  return state.captions.findIndex((c) => t >= c.start && t < c.end);
}

function invalidatePreview() {
  state.drawnKey = null;
}

function previewLoop() {
  if (state.meta && state.view === "editor") {
    const i = activeIndex(video.currentTime);
    const key = i + "|" + (i >= 0 ? state.captions[i].text : "");
    if (key !== state.drawnKey) {
      state.drawnKey = key;
      octx.clearRect(0, 0, overlay.width, overlay.height);
      if (i >= 0) {
        const text = displayText(state.captions[i].text);
        if (text) drawCaption(octx, layoutCaption(octx, text, overlay.width, overlay.height));
      }
      highlightCaption(i);
    }
  }
  requestAnimationFrame(previewLoop);
}

function fitStage() {
  if (!state.meta) return;
  const col = document.querySelector(".stage-col");
  const availW = col.clientWidth;
  const availH = window.innerHeight - 57 - 40 - 30;
  const scale = Math.min(availW / state.meta.width, availH / state.meta.height);
  $("stage").style.width = Math.floor(state.meta.width * scale) + "px";
  $("stage").style.height = Math.floor(state.meta.height * scale) + "px";
}
window.addEventListener("resize", fitStage);

// ---------- Accueil ----------

function showView(view) {
  state.view = view;
  const editor = view === "editor";
  $("home").classList.toggle("hidden", editor);
  $("editor").classList.toggle("hidden", !editor);
  $("editorNav").classList.toggle("hidden", !editor);
  $("saveBtn").classList.toggle("hidden", !editor);
  $("newVideo").classList.toggle("hidden", editor);
  $("title").textContent = editor ? projectName(state.meta) : "Captions";
  $("version").classList.toggle("hidden", editor);
  if (!editor) $("saved").textContent = "";
}

async function goHome() {
  if (!(await confirmLeave())) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
  state.meta = null;
  state.savedSnap = null;
  showView("home");
  renderProjects();
}

$("homeBtn").addEventListener("click", goHome);

async function renderProjects() {
  const projects = await api("/api/projects").catch(() => []);
  const list = $("projects");
  list.innerHTML = "";
  $("projectsTitle").classList.toggle("hidden", !projects.length);
  $("drop").classList.toggle("compact", projects.length > 0);

  for (const p of projects) {
    const card = document.createElement("div");
    card.className = "project";
    card.title = "Ouvrir";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.style.aspectRatio = `${p.width} / ${p.height}`;
    const img = document.createElement("img");
    img.src = `/api/projects/${p.id}/thumb`;
    img.loading = "lazy";
    thumb.append(img);
    const dur = document.createElement("span");
    dur.className = "dur";
    dur.textContent = fmtDuration(p.duration);
    thumb.append(dur);

    const name = document.createElement("div");
    name.className = "pname";
    name.textContent = p.name;

    const info = document.createElement("div");
    info.className = "pinfo";
    const status = p.captions ? `${p.captions} captions` : p.transcribed ? "Transcrite" : "Pas encore transcrite";
    info.textContent = `${status} · ${fmtAgo(p.updated)} · ${fmtSize(p.size)}`;

    const del = document.createElement("button");
    del.className = "pdel";
    del.title = "Supprimer cette vidéo";
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      const choice = await modal({
        title: `Supprimer « ${p.name} » ?`,
        text: `La vidéo, son texte et ses exports dans Captions seront supprimés (${fmtSize(p.size)} libérés). Ta vidéo d'origine sur ton Mac n'est pas touchée.`,
        buttons: [{ label: "Annuler", value: "cancel" }, { label: "Supprimer", value: "delete", danger: true }],
      });
      if (choice !== "delete") return;
      try {
        await api(`/api/projects/${p.id}`, { method: "DELETE" });
      } catch (err) {
        await modal({ title: "Suppression impossible", text: err.message, buttons: [{ label: "OK", value: "ok" }] });
      }
      renderProjects();
    });

    card.append(thumb, name, info, del);
    card.addEventListener("click", () => openProject(p.id));
    list.append(card);
  }
}

// ---------- Upload ----------

function uploadFile(file) {
  setStatus("uploadStatus", "Import… 0 %");
  const xhr = new XMLHttpRequest();
  const form = new FormData();
  form.append("file", file);
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) setStatus("uploadStatus", `Import… ${Math.round((e.loaded / e.total) * 100)} %`);
  };
  xhr.onload = async () => {
    if (xhr.status !== 200) {
      setStatus("uploadStatus", errorText(xhr.responseText), "error");
      return;
    }
    setStatus("uploadStatus", "");
    const meta = JSON.parse(xhr.responseText);
    // Nouveau projet : dernier style utilisé, enregistré tout de suite.
    await putJSON(`/api/projects/${meta.id}`, {
      captions: [], style: { ...DEFAULT_STYLE, ...(state.settings.lastStyle || {}) }, language: "fr",
    });
    openProject(meta.id);
  };
  xhr.onerror = () => setStatus("uploadStatus", "Le moteur de Captions ne répond pas. Relance l'app.", "error");
  xhr.open("POST", "/api/upload");
  xhr.send(form);
}

const drop = $("drop");
$("pick").addEventListener("click", () => $("fileInput").click());
$("newVideo").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (e) => {
  if (e.target.files[0]) uploadFile(e.target.files[0]);
  e.target.value = "";
});
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
});

// ---------- Ouverture d'un projet ----------

async function openProject(id) {
  let data;
  try {
    data = await api(`/api/projects/${id}`);
  } catch (e) {
    setStatus("uploadStatus", e.message, "error");
    return;
  }
  const { meta, project, words } = data;
  state.meta = meta;
  state.words = words;
  state.style = { ...DEFAULT_STYLE, ...(project.style || state.settings.lastStyle || {}) };
  $("language").value = project.language || "fr";
  if (project.captions && project.captions.length) state.captions = project.captions;
  else if (words.length) buildCaptions(); // transcrite mais jamais enregistrée
  else state.captions = [];
  // État enregistré sur le disque : si on vient de reconstruire les captions, le projet est « modifié ».
  state.savedSnap = JSON.stringify({ captions: project.captions || [], style: state.style, language: $("language").value });
  resetHistory();

  overlay.width = meta.width;
  overlay.height = meta.height;
  video.src = `/api/video/${meta.id}`;
  $("videoInfo").textContent =
    `${meta.width}×${meta.height} · ${meta.fps} i/s · ${fmtTime(meta.duration)} · ${meta.codec.toUpperCase()}`;

  setStatus("transcribeStatus", "");
  $("transcribeBtn").disabled = false;
  $("transcribeBtn").textContent = words.length ? "Relancer la transcription" : "Transcrire la vidéo";
  setStatus("exportStatus", "");
  $("exportBar").classList.add("hidden");
  $("downloadLink").classList.add("hidden");

  showView("editor");
  syncStyleInputs();
  renderCaptionList();
  fitStage();
  ensureFont().then(invalidatePreview);
  invalidatePreview();
  refreshDirty();
  resumeJobs(meta.id);
}

// Une transcription ou un export lancé avant de revenir à l'accueil continue en arrière-plan.
async function resumeJobs(id) {
  const t = await api(`/api/transcribe/${id}`).catch(() => null);
  if (t && (t.status === "queued" || t.status === "running")) {
    $("transcribeBtn").disabled = true;
    pollTranscription(id);
  }
  const e = await api(`/api/export/${id}`).catch(() => null);
  if (e && (e.status === "queued" || e.status === "running" || e.status === "done")) {
    $("exportBar").classList.remove("hidden");
    pollExport(id);
  }
}

// ---------- Transcription ----------

$("transcribeBtn").addEventListener("click", async () => {
  const id = state.meta.id;
  const btn = $("transcribeBtn");
  btn.disabled = true;
  const form = new FormData();
  form.append("language", $("language").value);
  form.append("prompt", $("prompt").value);
  try {
    await api(`/api/transcribe/${id}`, { method: "POST", body: form });
  } catch (e) {
    setStatus("transcribeStatus", e.message, "error");
    btn.disabled = false;
    return;
  }
  pollTranscription(id);
});

async function pollTranscription(id) {
  const job = await api(`/api/transcribe/${id}`).catch(() => null);
  const here = state.meta?.id === id;
  if (!job) return;

  if (job.status === "done") {
    if (here) {
      checkpoint();
      state.words = job.words;
      buildCaptions();
      afterChange();
      setStatus("transcribeStatus", `Terminé en ${Math.round(job.elapsed)} s · ${job.words.length} mots`, "ok");
      $("transcribeBtn").disabled = false;
      $("transcribeBtn").textContent = "Relancer la transcription";
    } else {
      // Terminée pendant qu'on était ailleurs : on enregistre le résultat dans le projet.
      const { project } = await api(`/api/projects/${id}`);
      const style = { ...DEFAULT_STYLE, ...(project.style || state.settings.lastStyle || {}) };
      const captions = chunkWords(applyRulesToWords(job.words), style.words);
      await putJSON(`/api/projects/${id}`, { ...project, captions, style });
      if (state.view === "home") renderProjects();
    }
    return;
  }
  if (job.status === "error") {
    if (here) {
      setStatus("transcribeStatus", "Erreur : " + job.error, "error");
      $("transcribeBtn").disabled = false;
    }
    return;
  }
  if (here) {
    const hint = job.elapsed < 20 ? " (chargement du modèle)" : "";
    setStatus("transcribeStatus", `Transcription en cours… ${Math.round(job.elapsed)} s${hint}`);
  }
  setTimeout(() => pollTranscription(id), 1000);
}

// ---------- Corrections automatiques ----------

const rulesInput = $("rules");

function parseRules() {
  return rulesInput.value.split("\n")
    .map((line) => line.split("=>").map((s) => s.trim()))
    .filter(([from, to]) => from && to !== undefined)
    .map(([from, to]) => {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      // \b ne gère pas les accents : on délimite avec « pas une lettre ».
      return [new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), to];
    });
}

function applyRules(text) {
  return parseRules().reduce((t, [re, to]) => t.replace(re, to), text);
}

function updateRulesCount() {
  const n = parseRules().length;
  $("rulesCount").textContent = n ? `· ${n}` : "";
}

rulesInput.addEventListener("input", () => {
  state.settings.vocabulary.rules = rulesInput.value;
  saveSettings();
  updateRulesCount();
});

$("applyRules").addEventListener("click", () => {
  checkpoint();
  for (const c of state.captions) {
    const next = applyRules(c.text);
    if (next !== c.text) Object.assign(c, { text: next, edited: true });
  }
  renderCaptionList();
  invalidatePreview();
  afterChange();
});

// Applique les règles sur la suite de mots, avant le découpage, pour qu'une expression
// (« assis debout ») ne soit jamais coupée entre deux captions.
function applyRulesToWords(words) {
  const norm = (s) => s.toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}'’-]/gu, "");
  const rules = rulesInput.value.split("\n")
    .map((line) => line.split("=>").map((s) => s.trim()))
    .filter(([from, to]) => from && to !== undefined)
    .map(([from, to]) => ({ from: from.split(/\s+/).map(norm), to }));

  const out = [];
  for (let i = 0; i < words.length; i++) {
    const rule = rules.find((r) =>
      r.from.every((f, k) => words[i + k] && words[i + k].seg === words[i].seg && norm(words[i + k].text) === f));
    if (!rule) {
      out.push(words[i]);
      continue;
    }
    const last = words[i + rule.from.length - 1];
    const trailing = last.text.match(/[^\p{L}\p{N}]*$/u)[0]; // garde la ponctuation finale
    out.push({ ...words[i], text: rule.to + trailing, end: last.end });
    i += rule.from.length - 1;
  }
  return out;
}

// ---------- Découpage en captions ----------

function chunkWords(words, max) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(" "), edited: false });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (
      cur.length >= max ||
      w.start - prev.end > 0.6 ||               // pause
      w.seg !== prev.seg ||                      // nouvelle phrase Whisper
      /[.!?…]$/.test(prev.text) ||
      (/[,;:]$/.test(prev.text) && cur.length >= 2)
    )) flush();
    cur.push(w);
  }
  flush();

  // Évite le clignotement entre deux captions rapprochées, et laisse la dernière un peu à l'écran.
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    if (next && next.start - out[i].end < 0.5) out[i].end = next.start;
    else out[i].end = Math.min(out[i].end + 0.3, next ? next.start : out[i].end + 0.3);
  }
  return out;
}

function buildCaptions() {
  state.captions = chunkWords(applyRulesToWords(state.words), state.style.words);
  renderCaptionList();
  invalidatePreview();
}

function renderCaptionList() {
  const list = $("captions");
  list.innerHTML = "";
  highlighted = -1;
  $("capCount").textContent = state.captions.length ? `· ${state.captions.length} captions` : "";
  $("exportBtn").disabled = !state.captions.length;
  if (!state.captions.length) {
    list.innerHTML = state.words.length
      ? '<div class="empty">Aucun texte détecté.</div>'
      : '<div class="empty">Lance la transcription pour voir le texte ici.</div>';
    return;
  }
  state.captions.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "cap";
    row.dataset.i = i;

    const t = document.createElement("div");
    t.className = "t";
    t.textContent = fmtTime(c.start);
    t.title = `${c.start.toFixed(2)} s → ${c.end.toFixed(2)} s`;
    t.addEventListener("click", () => { video.currentTime = c.start + 0.01; });

    const ta = document.createElement("textarea");
    ta.rows = 1;
    ta.value = c.text;
    ta.className = c.edited ? "edited" : "";
    ta.addEventListener("input", () => {
      checkpoint("text-" + i);
      c.text = ta.value.replace(/\s*\n\s*/g, " ");
      c.edited = true;
      ta.className = "edited";
      autosize(ta);
      invalidatePreview();
      afterChange();
    });
    ta.addEventListener("focus", () => {
      if (video.paused) video.currentTime = c.start + 0.01;
    });

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "×";
    del.title = "Supprimer cette caption (⌘Z pour annuler)";
    del.addEventListener("click", () => {
      checkpoint();
      state.captions.splice(i, 1);
      renderCaptionList();
      invalidatePreview();
      afterChange();
    });

    row.append(t, ta, del);
    list.append(row);
    requestAnimationFrame(() => autosize(ta));
  });
}

function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + 2 + "px";
}

let highlighted = -1;
function highlightCaption(i) {
  if (i === highlighted) return;
  const list = $("captions");
  list.querySelector(".cap.active")?.classList.remove("active");
  highlighted = i;
  const row = list.querySelector(`.cap[data-i="${i}"]`);
  if (!row) return;
  row.classList.add("active");
  if (!video.paused && !list.contains(document.activeElement)) {
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// ---------- Export ----------

$("exportBtn").addEventListener("click", async () => {
  const id = state.meta.id;
  const btn = $("exportBtn");
  btn.disabled = true;
  $("downloadLink").classList.add("hidden");
  setStatus("exportStatus", "Préparation des captions…");
  await ensureFont();

  const { width: W, height: H } = state.meta;
  const measure = document.createElement("canvas").getContext("2d");
  const form = new FormData();
  const items = [];
  for (const c of state.captions) {
    const text = displayText(c.text);
    if (!text) continue;
    const layout = layoutCaption(measure, text, W, H);
    const canvas = document.createElement("canvas");
    canvas.width = layout.box.w;
    canvas.height = layout.box.h;
    drawCaption(canvas.getContext("2d"), layout, layout.box.x, layout.box.y);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    form.append(`png${items.length}`, blob, `${items.length}.png`);
    items.push({ start: c.start, end: c.end, x: layout.box.x, y: layout.box.y });
  }
  form.append("captions", JSON.stringify(items));

  try {
    await api(`/api/export/${id}`, { method: "POST", body: form });
  } catch (e) {
    setStatus("exportStatus", e.message, "error");
    btn.disabled = false;
    return;
  }
  $("exportBar").classList.remove("hidden");
  pollExport(id);
});

async function pollExport(id) {
  if (state.meta?.id !== id) return; // on a quitté la vidéo : on reprendra en la rouvrant
  const job = await api(`/api/export/${id}`).catch(() => null);
  if (!job || state.meta?.id !== id) return;
  $("exportBar").firstElementChild.style.width = Math.round((job.progress || 0) * 100) + "%";
  if (job.status === "done") {
    setStatus("exportStatus", `Prête · ${fmtSize(job.size)}`, "ok");
    const link = $("downloadLink");
    link.href = `/api/export/${id}/download`;
    link.textContent = native ? "Enregistrer la vidéo…" : `Télécharger ${job.download_name}`;
    link.dataset.path = job.path;
    link.dataset.name = job.download_name;
    link.classList.remove("hidden");
    $("exportBtn").disabled = !state.captions.length;
    return;
  }
  if (job.status === "error") {
    setStatus("exportStatus", "Erreur : " + job.error, "error");
    $("exportBar").classList.add("hidden");
    $("exportBtn").disabled = false;
    return;
  }
  $("exportBtn").disabled = true;
  setStatus("exportStatus", `Export en cours… ${Math.round((job.progress || 0) * 100)} % · ${Math.round(job.elapsed)} s`);
  setTimeout(() => pollExport(id), 700);
}

// ---------- App Mac (Captions.app) : fenêtre « Enregistrer sous… » native ----------

const native = window.webkit?.messageHandlers?.captions;

$("downloadLink").addEventListener("click", (e) => {
  if (!native) return; // navigateur : téléchargement classique
  e.preventDefault();
  native.postMessage({ type: "save", path: e.currentTarget.dataset.path, name: e.currentTarget.dataset.name });
});
window.nativeSaveStarted = () => setStatus("exportStatus", "Enregistrement de la vidéo…");
window.nativeSaved = (path) => setStatus("exportStatus", `Vidéo enregistrée : ${path.split("/").pop()}`, "ok");
window.nativeSaveFailed = (msg) => setStatus("exportStatus", "Enregistrement impossible : " + msg, "error");

// Un fichier lâché à côté de la zone de dépôt ne doit pas remplacer la page.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

// Le navigateur (hors app Mac) avertit aussi avant de fermer l'onglet.
window.addEventListener("beforeunload", (e) => {
  if (isDirty()) e.preventDefault();
});

// ---------- Raccourcis ----------

document.addEventListener("keydown", (e) => {
  if (state.view !== "editor" || !$("modal").classList.contains("hidden")) return;
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (cmd && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (isDirty()) saveProject();
    return;
  }
  if (e.target.matches("input, textarea, select")) return;
  if (e.code === "Space") {
    e.preventDefault();
    video.paused ? video.play() : video.pause();
  }
});

// ---------- Démarrage ----------

syncStyleInputs();
requestAnimationFrame(previewLoop);
loadSettings().then(renderProjects);
api("/api/version").then((v) => { $("version").textContent = `Version ${v.version}`; }).catch(() => {});
