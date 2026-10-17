"""Captions locales : transcription Whisper (MLX) + incrustation des sous-titres avec ffmpeg."""

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
STATIC = Path(__file__).resolve().parent / "static"
DATA.mkdir(exist_ok=True)

WHISPER_MODEL = "mlx-community/whisper-large-v3-mlx"

app = FastAPI()
jobs: dict[str, dict] = {}  # état en mémoire des transcriptions / exports
whisper_lock = threading.Lock()  # un seul modèle en mémoire à la fois


def busy() -> bool:
    return any(j.get("status") in {"queued", "running"} for j in jobs.values())


def stop_ffmpeg():
    for job in jobs.values():
        if job.get("proc"):
            job["proc"].kill()


def parent_watchdog():
    """Lancé par Captions.app : si l'app disparaît (plantage, arrêt forcé), on s'arrête aussi."""
    parent = os.getppid()
    while True:
        time.sleep(2)
        if os.getppid() != parent:
            stop_ffmpeg()
            os._exit(0)


threading.Thread(target=parent_watchdog, daemon=True).start()


@app.on_event("shutdown")
def on_shutdown():
    stop_ffmpeg()


@app.middleware("http")
async def no_cache_for_app_files(request: Request, call_next):
    """La page, le JS et le CSS changent à chaque mise à jour : jamais de copie périmée en cache."""
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


def app_version() -> str:
    """Numéro de version = nombre de commits (augmente à chaque mise à jour publiée)."""
    try:
        return subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=ROOT,
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "dev"


VERSION = app_version()


@app.get("/api/version")
def version():
    return {"version": VERSION}


@app.get("/api/busy")
def is_busy():
    return {"busy": busy()}


@app.get("/api/ping")
def ping():
    return {"app": "captions"}


def job_dir(vid: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", vid):
        raise HTTPException(400, "id invalide")
    d = DATA / vid
    if not d.exists():
        raise HTTPException(404, "vidéo introuvable")
    return d


def read_meta(d: Path) -> dict:
    return json.loads((d / "meta.json").read_text())


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    info = json.loads(out)
    video = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    if video is None:
        raise HTTPException(400, "Aucune piste vidéo dans ce fichier")
    audio = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)

    rotation = 0
    for sd in video.get("side_data_list", []):
        if "rotation" in sd:
            rotation = int(sd["rotation"])
    w, h = video["width"], video["height"]
    if abs(rotation) % 180 == 90:  # ffmpeg et le navigateur appliquent la rotation
        w, h = h, w

    num, den = video.get("avg_frame_rate", "0/1").split("/")
    fps = float(num) / float(den) if float(den) else 0

    return {
        "width": w,
        "height": h,
        "duration": float(info["format"].get("duration", video.get("duration", 0))),
        "fps": round(fps, 3),
        "codec": video["codec_name"],
        "pix_fmt": video.get("pix_fmt", "yuv420p"),
        "bit_rate": int(video.get("bit_rate") or info["format"].get("bit_rate") or 0),
        "color_primaries": video.get("color_primaries"),
        "color_transfer": video.get("color_transfer"),
        "color_space": video.get("color_space"),
        "audio_codec": audio["codec_name"] if audio else None,
    }


# ---------- Upload ----------

@app.post("/api/upload")
def upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "video.mp4").suffix.lower() or ".mp4"
    if ext not in {".mp4", ".mov", ".m4v", ".mkv", ".webm"}:
        raise HTTPException(400, f"Format non supporté : {ext}")
    vid = uuid.uuid4().hex[:12]
    d = DATA / vid
    d.mkdir()
    src = d / f"source{ext}"
    with src.open("wb") as f:
        shutil.copyfileobj(file.file, f, length=1024 * 1024)
    try:
        info = probe(src)
    except Exception:
        shutil.rmtree(d)
        raise
    meta = {"id": vid, "name": file.filename, "ext": ext, "created": time.time(), **info}
    (d / "meta.json").write_text(json.dumps(meta))
    make_thumb(d, meta)
    return meta


@app.get("/api/video/{vid}")
def video(vid: str):
    d = job_dir(vid)
    return FileResponse(d / f"source{read_meta(d)['ext']}")


# ---------- Brouillons ----------

def make_thumb(d: Path, meta: dict) -> Path:
    thumb = d / "thumb.jpg"
    if not thumb.exists():
        t = min(1.0, meta["duration"] / 2)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(d / f"source{meta['ext']}"),
                        "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", str(thumb)])
    return thumb


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, data):
    tmp = path.with_suffix(".tmp")  # écriture atomique : jamais de fichier à moitié écrit
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    tmp.replace(path)


@app.get("/api/projects")
def list_projects():
    out = []
    for d in DATA.iterdir():
        if not (re.fullmatch(r"[a-f0-9]{12}", d.name) and (d / "meta.json").exists()):
            continue
        meta = read_meta(d)
        project = read_json(d / "project.json", {})
        out.append({
            "id": d.name,
            "name": display_name(d, meta),
            "duration": meta["duration"],
            "width": meta["width"],
            "height": meta["height"],
            "updated": project.get("updated") or meta.get("created") or d.stat().st_mtime,
            "captions": len(project.get("captions") or []),
            "transcribed": (d / "words.json").exists(),
            "size": sum(f.stat().st_size for f in d.rglob("*") if f.is_file()),
        })
    return sorted(out, key=lambda p: p["updated"], reverse=True)


@app.get("/api/projects/{vid}")
def get_project(vid: str):
    d = job_dir(vid)
    return {"meta": read_meta(d), "project": read_json(d / "project.json", {}),
            "words": read_json(d / "words.json", [])}


@app.put("/api/projects/{vid}")
async def save_project(vid: str, request: Request):
    d = job_dir(vid)
    project = read_json(d / "project.json", {})  # garde les champs non envoyés (ex. le nom)
    project.update(await request.json())
    project["updated"] = time.time()
    write_json(d / "project.json", project)
    return {"updated": project["updated"]}


@app.put("/api/projects/{vid}/name")
async def rename_project(vid: str, request: Request):
    d = job_dir(vid)
    name = str((await request.json()).get("name", "")).strip()[:120]
    if not name:
        raise HTTPException(400, "Le nom ne peut pas être vide")
    project = read_json(d / "project.json", {})
    project["name"] = name
    write_json(d / "project.json", project)
    return {"name": name}


def display_name(d: Path, meta: dict) -> str:
    return read_json(d / "project.json", {}).get("name") or Path(meta.get("name") or "Vidéo").stem


@app.delete("/api/projects/{vid}")
def delete_project(vid: str):
    d = job_dir(vid)
    if any(jobs.get(f"{k}-{vid}", {}).get("status") in {"queued", "running"} for k in "te"):
        raise HTTPException(409, "Une transcription ou un export est en cours pour cette vidéo")
    shutil.rmtree(d)
    jobs.pop(f"t-{vid}", None)
    jobs.pop(f"e-{vid}", None)
    return {"deleted": vid}


@app.get("/api/projects/{vid}/thumb")
def project_thumb(vid: str):
    d = job_dir(vid)
    return FileResponse(make_thumb(d, read_meta(d)))


# ---------- Réglages de l'app (presets de style, vocabulaire) ----------

SETTINGS = DATA / "settings.json"


@app.get("/api/settings")
def get_settings():
    return read_json(SETTINGS, {})


@app.put("/api/settings")
async def save_settings(request: Request):
    settings = await request.json()
    write_json(SETTINGS, settings)
    return {"ok": True}


# ---------- Transcription ----------

def run_transcription(vid: str, language: str | None, prompt: str):
    job = jobs[f"t-{vid}"]
    d = DATA / vid
    try:
        import mlx_whisper

        with whisper_lock:
            job["status"] = "running"
            result = mlx_whisper.transcribe(
                str(d / f"source{read_meta(d)['ext']}"),
                path_or_hf_repo=WHISPER_MODEL,
                language=language,
                word_timestamps=True,
                # Le prompt n'est conservé d'une fenêtre de 30 s à l'autre que si on garde le contexte précédent.
                initial_prompt=f"Vocabulaire : {prompt}." if prompt else None,
                hallucination_silence_threshold=2.0,
            )
        words = []
        for seg_index, seg in enumerate(result["segments"]):
            for w in seg.get("words", []):
                text = w["word"].strip()
                if not text:
                    continue
                # Whisper découpe parfois « aujourd'hui » en « aujourd » + « 'hui » : un mot sans espace
                # initiale est la suite du précédent.
                if words and words[-1]["seg"] == seg_index and not w["word"].startswith(" "):
                    words[-1]["text"] += text
                    words[-1]["end"] = round(w["end"], 3)
                    continue
                # Ponctuation isolée (« monde ! ») : collée au mot précédent avec une espace insécable.
                if words and re.fullmatch(r"[^\w]+", text):
                    words[-1]["text"] += (" " if text[0] in "!?:;»" else "") + text
                    continue
                words.append({"text": text, "start": round(w["start"], 3),
                              "end": round(w["end"], 3), "seg": seg_index})
        (d / "words.json").write_text(json.dumps(words, ensure_ascii=False))
        job.update(status="done", words=words, language=result.get("language"))
    except Exception as e:  # remonté tel quel à l'interface
        job.update(status="error", error=str(e))


@app.post("/api/transcribe/{vid}")
def transcribe(vid: str, language: str = Form("fr"), prompt: str = Form("")):
    job_dir(vid)
    key = f"t-{vid}"
    if jobs.get(key, {}).get("status") in {"queued", "running"}:
        return jobs[key]
    jobs[key] = {"status": "queued", "started": time.time()}
    lang = None if language == "auto" else language
    threading.Thread(target=run_transcription, args=(vid, lang, prompt.strip()), daemon=True).start()
    return jobs[key]


@app.get("/api/transcribe/{vid}")
def transcribe_status(vid: str):
    job = jobs.get(f"t-{vid}")
    if job is None:
        raise HTTPException(404, "aucune transcription en cours")
    return {**job, "elapsed": round(time.time() - job["started"], 1)}


# ---------- Export ----------

def encoder_args(meta: dict) -> tuple[list[str], str]:
    """Réencodage visuellement sans perte, en gardant le codec, la profondeur et les couleurs d'origine."""
    pix_fmt = meta["pix_fmt"]
    ten_bit = "10" in pix_fmt
    if ten_bit or meta["codec"] == "hevc":
        out_fmt = "yuv420p10le" if ten_bit else "yuv420p"
        args = ["-c:v", "libx265", "-crf", "16", "-preset", "medium", "-tag:v", "hvc1",
                "-x265-params", "log-level=error", "-pix_fmt", out_fmt]
    else:
        out_fmt = "yuv420p"
        args = ["-c:v", "libx264", "-crf", "15", "-preset", "slow", "-pix_fmt", out_fmt]
    for flag, key in (("-color_primaries", "color_primaries"), ("-color_trc", "color_transfer"),
                      ("-colorspace", "color_space")):
        if meta.get(key) and meta[key] != "unknown":
            args += [flag, meta[key]]
    overlay_fmt = "yuv420p10" if ten_bit else "yuv420"
    return args, overlay_fmt


def run_export(vid: str, captions: list[dict]):
    job = jobs[f"e-{vid}"]
    d = DATA / vid
    meta = read_meta(d)
    src = d / f"source{meta['ext']}"
    out_ext = ".mov" if meta["ext"] == ".mov" else ".mp4"
    out = d / f"export{out_ext}"
    enc, overlay_fmt = encoder_args(meta)

    cmd = ["ffmpeg", "-y", "-hide_banner", "-nostats", "-progress", "pipe:1", "-i", str(src)]
    for i in range(len(captions)):
        cmd += ["-i", str(d / "captions" / f"{i}.png")]

    parts, prev = [], "[0:v]"
    for i, c in enumerate(captions):
        label = f"[v{i + 1}]"
        parts.append(
            f"{prev}[{i + 1}:v]overlay=x={int(c['x'])}:y={int(c['y'])}:format={overlay_fmt}"
            f":enable='gte(t,{c['start']:.3f})*lt(t,{c['end']:.3f})'{label}"
        )
        prev = label
    if parts:
        cmd += ["-filter_complex", ";".join(parts), "-map", prev]
    else:
        cmd += ["-map", "0:v:0"]

    audio = ["-map", "0:a?", "-c:a", "copy"]
    if out_ext == ".mp4" and meta["audio_codec"] not in {None, "aac", "mp3", "alac", "opus", "ac3", "eac3"}:
        audio = ["-map", "0:a?", "-c:a", "aac", "-b:a", "320k"]

    cmd += enc + audio + ["-fps_mode", "passthrough", "-map_metadata", "0",
                          "-movflags", "+faststart", str(out)]

    total_us = max(meta["duration"], 0.1) * 1_000_000
    try:
        job["status"] = "running"
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        job["proc"] = proc
        for line in proc.stdout:
            if line.startswith("out_time_us=") and line.strip()[12:].isdigit():
                job["progress"] = min(0.99, int(line.strip()[12:]) / total_us)
        stderr = proc.stderr.read()
        if proc.wait() != 0:
            raise RuntimeError(stderr.strip().splitlines()[-1] if stderr.strip() else "ffmpeg a échoué")
        safe = re.sub(r'[/:\\]', "-", display_name(d, meta))  # caractères interdits dans un nom de fichier
        name = safe + "_captions" + out_ext
        job.update(status="done", progress=1.0, file=out.name, download_name=name,
                   size=out.stat().st_size, path=str(out))
    except Exception as e:
        job.update(status="error", error=str(e))
    finally:
        job.pop("proc", None)


@app.post("/api/export/{vid}")
async def export(vid: str, request: Request):
    d = job_dir(vid)
    key = f"e-{vid}"
    if jobs.get(key, {}).get("status") in {"queued", "running"}:
        raise HTTPException(409, "Un export est déjà en cours")

    form = await request.form(max_files=5000)
    captions = json.loads(form["captions"])
    cap_dir = d / "captions"
    shutil.rmtree(cap_dir, ignore_errors=True)
    cap_dir.mkdir()
    for i in range(len(captions)):
        (cap_dir / f"{i}.png").write_bytes(await form[f"png{i}"].read())

    jobs[key] = {"status": "queued", "progress": 0.0, "started": time.time()}
    threading.Thread(target=run_export, args=(vid, captions), daemon=True).start()
    return {"status": "queued"}


@app.get("/api/export/{vid}")
def export_status(vid: str):
    job = jobs.get(f"e-{vid}")
    if job is None:
        raise HTTPException(404, "aucun export")
    return {k: v for k, v in job.items() if k != "proc"} | {"elapsed": round(time.time() - job["started"], 1)}


@app.get("/api/export/{vid}/download")
def export_download(vid: str):
    d = job_dir(vid)
    job = jobs.get(f"e-{vid}")
    if not job or job.get("status") != "done":
        raise HTTPException(404, "export non disponible")
    return FileResponse(d / job["file"], filename=job["download_name"])


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
