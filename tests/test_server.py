import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def upload(client, path):
    with open(path, "rb") as f:
        return client.post("/api/upload", files={"file": (path.name, f, "video/mp4")})


def wait_export(client, vid, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/export/{vid}").json()
        if job["status"] in {"done", "error"}:
            return job
        time.sleep(0.5)
    return client.get(f"/api/export/{vid}").json()


def export_captions(client, vid, media, captions):
    """Comme la page : une image par caption à la taille de la zone, plus l'image vide."""
    png, blank = (media / "caption.png").read_bytes(), (media / "blank.png").read_bytes()
    files = [(f"png{i}", (f"{i}.png", png, "image/png")) for i in range(len(captions))]
    files.append(("blank", ("blank.png", blank, "image/png")))
    data = {"captions": json.dumps(captions), "band": json.dumps({"x": 10, "y": 400})}
    res = client.post(f"/api/export/{vid}", data=data, files=files)
    assert res.status_code == 200, res.text


def export_many(client, vid, media, n):
    export_captions(client, vid, media, [{"start": i * 0.005, "end": i * 0.005 + 0.005} for i in range(n)])


# ---------- Import ----------

def test_upload_valid_video(client, media):
    res = upload(client, media / "video.mp4")
    assert res.status_code == 200
    meta = res.json()
    assert (meta["width"], meta["height"]) == (320, 568)
    assert meta["audio_codec"] == "aac"


def test_upload_corrupt_file_gives_clear_error_and_leaves_nothing(client, media, data_dir):
    res = upload(client, media / "corrupt.mp4")
    assert res.status_code == 400
    assert "illisible" in res.json()["detail"]
    assert not [p for p in data_dir.iterdir() if p.is_dir()]


# ---------- Transcription ----------

def test_transcribe_video_without_audio_is_refused_clearly(client, media):
    vid = upload(client, media / "mute.mp4").json()["id"]
    res = client.post(f"/api/transcribe/{vid}", data={"language": "fr"})
    assert res.status_code == 400
    assert "son" in res.json()["detail"]


# ---------- Export ----------

def test_export_with_many_captions_does_not_hang(client, media):
    """Bug : ffmpeg bloquait en écrivant ses messages dans un tuyau jamais lu (> ~500 captions)."""
    vid = upload(client, media / "video.mp4").json()["id"]
    export_many(client, vid, media, 600)
    job = wait_export(client, vid)
    assert job["status"] == "done", job


def test_export_survives_dock_open_file_limit(media, tmp_path):
    """Lancée depuis le Dock, l'app n'a droit qu'à 256 fichiers ouverts : l'export ne doit pas en dépendre."""
    script = f"""
import json, resource, sys, time
resource.setrlimit(resource.RLIMIT_NOFILE, (256, resource.getrlimit(resource.RLIMIT_NOFILE)[1]))
sys.path.insert(0, {str(ROOT)!r}); sys.path.insert(0, {str(Path(__file__).parent)!r})
from fastapi.testclient import TestClient
import app.server as server
from test_server import upload, export_many, wait_export
from pathlib import Path
media = Path({str(media)!r})
with TestClient(server.app) as c:
    vid = upload(c, media / "video.mp4").json()["id"]
    export_many(c, vid, media, 300)
    print(json.dumps(wait_export(c, vid)))
"""
    env = {**os.environ, "CAPTIONS_DATA": str(tmp_path / "data")}
    out = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, env=env, timeout=150)
    job = json.loads(out.stdout.strip().splitlines()[-1])
    assert job["status"] == "done", job


def test_export_error_is_a_single_readable_line(client, media, data_dir):
    vid = upload(client, media / "video.mp4").json()["id"]
    (data_dir / vid / "source.mp4").write_bytes(b"plus une video")  # source abîmée après l'import
    res = client.post(f"/api/export/{vid}", data={"captions": "[]"})
    assert res.status_code == 200
    job = wait_export(client, vid)
    assert job["status"] == "error"
    assert "\n" not in job["error"]


def brightness_at(path, t):
    """Luminosité moyenne (0-255) de la zone de caption (x=10, y=400, 80×20) à l'instant t."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t}", "-i", str(path), "-frames:v", "1",
                          "-vf", "crop=80:20:10:400,format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    return sum(raw) / len(raw)


def test_export_shows_each_caption_exactly_during_its_time(client, media, data_dir):
    vid = upload(client, media / "black.mp4").json()["id"]
    export_captions(client, vid, media, [{"start": 2.0, "end": 2.5}, {"start": 0.5, "end": 1.0}])  # désordre voulu
    job = wait_export(client, vid)
    assert job["status"] == "done", job
    out = data_dir / vid / "export.mp4"
    shown = {t: brightness_at(out, t) > 128 for t in (0.25, 0.6, 0.95, 1.5, 2.1, 2.45, 2.8)}
    assert shown == {0.25: False, 0.6: True, 0.95: True, 1.5: False, 2.1: True, 2.45: True, 2.8: False}


def test_export_without_captions_keeps_video_and_audio(client, media, data_dir):
    vid = upload(client, media / "video.mp4").json()["id"]
    assert client.post(f"/api/export/{vid}", data={"captions": "[]"}).status_code == 200
    assert wait_export(client, vid)["status"] == "done"
    streams = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0",
                              str(data_dir / vid / "export.mp4")], capture_output=True, text=True).stdout.split()
    assert streams == ["video", "audio"]
