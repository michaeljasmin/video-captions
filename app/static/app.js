"use strict";

const $ = (id) => document.getElementById(id);

const DEFAULT_STYLE = {
  font: "Inter", weight: 700, size: 6.5, pos: 68, color: "#ffffff",
  shadow: 70, outline: false, upper: false, punct: false, words: 4,
};

const state = {
  meta: null,        // infos de la vidéo (largeur, hauteur, durée…)
  words: [],         // mots Whisper avec timestamps
  captions: [],      // { start, end, text, edited }
  style: loadStyle(),
  drawnKey: null,    // évite de redessiner l'aperçu inutilement
};

// ---------- Style ----------

function loadStyle() {
  try {
    return { ...DEFAULT_STYLE, ...JSON.parse(localStorage.getItem("captions-style") || "{}") };
  } catch {
    return { ...DEFAULT_STYLE };
  }
}

function saveStyle() {
  try { localStorage.setItem("captions-style", JSON.stringify(state.style)); } catch {}
}

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
}

for (const [key, id] of Object.entries(styleInputs)) {
  $(id).addEventListener("input", (e) => {
    const el = e.target;
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (["weight", "size", "pos", "shadow", "words"].includes(key)) value = Number(value);

    if (key === "words" && state.captions.some((c) => c.edited)) {
      if (!confirm("Changer le nombre de mots refait le découpage et efface tes corrections. Continuer ?")) {
        el.value = state.style.words;
        return;
      }
    }
    state.style[key] = value;
    saveStyle();
    syncStyleInputs();
    if (key === "words" && state.words.length) buildCaptions();
    if (key === "font" || key === "weight") ensureFont().then(invalidatePreview);
    invalidatePreview();
  });
}

$("resetStyle").addEventListener("click", () => {
  const words = state.style.words;
  state.style = { ...DEFAULT_STYLE, words };
  saveStyle();
  syncStyleInputs();
  ensureFont().then(invalidatePreview);
});

function ensureFont() {
  if (state.style.font === "Arial") return Promise.resolve();
  return document.fonts.load(`${state.style.weight} 100px "${state.style.font}"`);
}

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
  if (state.meta) {
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
  const availH = window.innerHeight - 53 - 40 - 30;
  const scale = Math.min(availW / state.meta.width, availH / state.meta.height);
  $("stage").style.width = Math.floor(state.meta.width * scale) + "px";
  $("stage").style.height = Math.floor(state.meta.height * scale) + "px";
}
window.addEventListener("resize", fitStage);

// ---------- Upload ----------

function setStatus(id, text, kind = "") {
  const el = $(id);
  el.textContent = text;
  el.className = "status " + kind;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

function fmtSize(bytes) {
  return bytes > 1e9 ? (bytes / 1e9).toFixed(2) + " Go" : (bytes / 1e6).toFixed(1) + " Mo";
}

function uploadFile(file) {
  setStatus("uploadStatus", "Envoi… 0 %");
  const xhr = new XMLHttpRequest();
  const form = new FormData();
  form.append("file", file);
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) setStatus("uploadStatus", `Envoi… ${Math.round((e.loaded / e.total) * 100)} %`);
  };
  xhr.onload = () => {
    if (xhr.status !== 200) {
      setStatus("uploadStatus", errorText(xhr.responseText), "error");
      return;
    }
    openEditor(JSON.parse(xhr.responseText));
  };
  xhr.onerror = () => setStatus("uploadStatus", "Le serveur ne répond pas. Est-il lancé ?", "error");
  xhr.open("POST", "/api/upload");
  xhr.send(form);
}

function errorText(body) {
  try { return JSON.parse(body).detail || body; } catch { return body || "Erreur inconnue"; }
}

function openEditor(meta) {
  state.meta = meta;
  $("drop").classList.add("hidden");
  $("editor").classList.remove("hidden");
  $("newVideo").classList.remove("hidden");
  overlay.width = meta.width;
  overlay.height = meta.height;
  video.src = `/api/video/${meta.id}`;
  $("videoInfo").textContent =
    `${meta.name} · ${meta.width}×${meta.height} · ${meta.fps} i/s · ${fmtTime(meta.duration)} · ${meta.codec.toUpperCase()}`;
  fitStage();
  ensureFont().then(invalidatePreview);
}

const drop = $("drop");
$("pick").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (e) => e.target.files[0] && uploadFile(e.target.files[0]));
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
});
$("newVideo").addEventListener("click", () => {
  if (state.captions.length && !confirm("Quitter cette vidéo ? Les corrections non exportées seront perdues.")) return;
  location.reload();
});

// ---------- Transcription ----------

$("transcribeBtn").addEventListener("click", async () => {
  if (state.captions.some((c) => c.edited) && !confirm("Relancer la transcription efface tes corrections. Continuer ?")) return;
  const btn = $("transcribeBtn");
  btn.disabled = true;
  const form = new FormData();
  form.append("language", $("language").value);
  form.append("prompt", $("prompt").value);
  const res = await fetch(`/api/transcribe/${state.meta.id}`, { method: "POST", body: form });
  if (!res.ok) {
    setStatus("transcribeStatus", errorText(await res.text()), "error");
    btn.disabled = false;
    return;
  }
  pollTranscription();
});

async function pollTranscription() {
  const res = await fetch(`/api/transcribe/${state.meta.id}`);
  const job = await res.json();
  if (job.status === "done") {
    state.words = job.words;
    buildCaptions();
    setStatus("transcribeStatus", `Terminé en ${Math.round(job.elapsed)} s · ${job.words.length} mots`, "ok");
    $("transcribeBtn").disabled = false;
    $("transcribeBtn").textContent = "Relancer la transcription";
    return;
  }
  if (job.status === "error") {
    setStatus("transcribeStatus", "Erreur : " + job.error, "error");
    $("transcribeBtn").disabled = false;
    return;
  }
  const hint = job.elapsed < 20 ? " (chargement du modèle)" : "";
  setStatus("transcribeStatus", `Transcription en cours… ${Math.round(job.elapsed)} s${hint}`);
  setTimeout(pollTranscription, 1000);
}

// ---------- Corrections automatiques ----------

const rulesInput = $("rules");
try { rulesInput.value = localStorage.getItem("captions-rules") || ""; } catch {}

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
  try { localStorage.setItem("captions-rules", rulesInput.value); } catch {}
  updateRulesCount();
});

$("applyRules").addEventListener("click", () => {
  for (const c of state.captions) {
    const next = applyRules(c.text);
    if (next !== c.text) Object.assign(c, { text: next, edited: true });
  }
  renderCaptionList();
  invalidatePreview();
});
updateRulesCount();

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

function buildCaptions() {
  const max = state.style.words;
  const out = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(" "), edited: false });
    cur = [];
  };
  for (const w of applyRulesToWords(state.words)) {
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
  state.captions = out;
  renderCaptionList();
  invalidatePreview();
}

function renderCaptionList() {
  const list = $("captions");
  list.innerHTML = "";
  $("capCount").textContent = state.captions.length ? `· ${state.captions.length} captions` : "";
  $("exportBtn").disabled = !state.captions.length;
  if (!state.captions.length) {
    list.innerHTML = '<div class="empty">Aucun texte détecté.</div>';
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
      c.text = ta.value.replace(/\s*\n\s*/g, " ");
      c.edited = true;
      ta.className = "edited";
      autosize(ta);
      invalidatePreview();
    });
    ta.addEventListener("focus", () => {
      if (video.paused) video.currentTime = c.start + 0.01;
    });

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "×";
    del.title = "Supprimer cette caption";
    del.addEventListener("click", () => {
      state.captions.splice(i, 1);
      renderCaptionList();
      invalidatePreview();
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

  const res = await fetch(`/api/export/${state.meta.id}`, { method: "POST", body: form });
  if (!res.ok) {
    setStatus("exportStatus", errorText(await res.text()), "error");
    btn.disabled = false;
    return;
  }
  $("exportBar").classList.remove("hidden");
  pollExport();
});

async function pollExport() {
  const job = await (await fetch(`/api/export/${state.meta.id}`)).json();
  $("exportBar").firstElementChild.style.width = Math.round((job.progress || 0) * 100) + "%";
  if (job.status === "done") {
    setStatus("exportStatus", `Prêt en ${Math.round(job.elapsed)} s · ${fmtSize(job.size)}`, "ok");
    const link = $("downloadLink");
    link.href = `/api/export/${state.meta.id}/download`;
    link.textContent = `Télécharger ${job.download_name}`;
    link.classList.remove("hidden");
    $("exportBtn").disabled = false;
    return;
  }
  if (job.status === "error") {
    setStatus("exportStatus", "Erreur : " + job.error, "error");
    $("exportBar").classList.add("hidden");
    $("exportBtn").disabled = false;
    return;
  }
  setStatus("exportStatus", `Export en cours… ${Math.round((job.progress || 0) * 100)} % · ${Math.round(job.elapsed)} s`);
  setTimeout(pollExport, 700);
}

// ---------- Raccourcis ----------

document.addEventListener("keydown", (e) => {
  if (!state.meta || e.target.matches("input, textarea, select")) return;
  if (e.code === "Space") {
    e.preventDefault();
    video.paused ? video.play() : video.pause();
  }
});

syncStyleInputs();
requestAnimationFrame(previewLoop);
