#!/bin/zsh
# Installation de Captions (à faire une seule fois). Double-clique ce fichier.
set -e
cd "$(dirname "$0")"

say_step() { print -P "\n%F{blue}▶ $1%f"; }
fail() { print -P "\n%F{red}✗ $1%f"; read -k1 "?Appuie sur une touche pour fermer."; exit 1; }

[[ "$(uname -m)" == "arm64" ]] || fail "Ce Mac n'a pas de puce Apple (M1/M2/M3/M4). L'app ne peut pas tourner ici."

say_step "1/4 · Homebrew"
if ! command -v brew >/dev/null 2>&1 && [[ ! -x /opt/homebrew/bin/brew ]]; then
  echo "Homebrew n'est pas installé. Installation (ton mot de passe Mac sera demandé)…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$(/opt/homebrew/bin/brew shellenv)"
echo "OK"

say_step "2/4 · ffmpeg"
command -v ffmpeg >/dev/null 2>&1 || brew install ffmpeg
echo "OK : $(ffmpeg -version | head -1)"

say_step "3/4 · Python et dépendances"
PY=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v $candidate >/dev/null 2>&1 && $candidate -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
    PY=$(command -v $candidate); break
  fi
done
if [[ -z "$PY" ]]; then
  brew install python@3.12
  PY="$(brew --prefix python@3.12)/bin/python3.12"
fi
echo "Python : $PY"
[[ -x .venv/bin/python ]] || "$PY" -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt && shasum requirements.txt | cut -d" " -f1 > .venv/.req-hash
echo "OK"

say_step "4/4 · Modèle Whisper large-v3 (~3 Go, peut prendre quelques minutes)"
.venv/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('mlx-community/whisper-large-v3-mlx')"
echo "OK"

xattr -dr com.apple.quarantine . 2>/dev/null || true
print -P "\n%F{green}✓ Installation terminée. Double-clique « Captions.command » pour lancer l'app.%f"
read -k1 "?Appuie sur une touche pour fermer."
