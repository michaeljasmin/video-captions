"""Fixtures : un dossier de données jetable et de petites vidéos générées avec ffmpeg."""

import os
import struct
import subprocess
import sys
import zlib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


@pytest.fixture(scope="session")
def media(tmp_path_factory):
    d = tmp_path_factory.mktemp("media")
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x568:r=30:d=3", "-f", "lavfi", "-i", "sine=d=3",
           "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(d / "video.mp4"))
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x568:r=30:d=2", "-c:v", "libx264", "-preset", "ultrafast",
           str(d / "mute.mp4"))
    (d / "corrupt.mp4").write_bytes((d / "video.mp4").read_bytes()[5000:60000])

    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=320x568:r=30:d=3", "-f", "lavfi", "-i", "sine=d=3",
           "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(d / "black.mp4"))

    # Images RGBA 80×20 comme celles que la page envoie : une caption blanche opaque et l'image vide.
    (d / "caption.png").write_bytes(rgba_png(80, 20, b"\xff\xff\xff\xff"))
    (d / "blank.png").write_bytes(rgba_png(80, 20, b"\x00\x00\x00\x00"))
    return d


def rgba_png(w, h, pixel):
    raw = b"".join(b"\x00" + pixel * w for _ in range(h))
    chunk = lambda t, data: struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("CAPTIONS_DATA", str(tmp_path / "data"))
    return tmp_path / "data"


@pytest.fixture()
def client(data_dir):
    import importlib

    from fastapi.testclient import TestClient

    import app.server as server
    importlib.reload(server)  # relit CAPTIONS_DATA
    with TestClient(server.app) as c:
        yield c
