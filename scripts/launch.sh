#!/bin/zsh
# Démarrage silencieux, appelé par Captions.app : mise à jour, serveur en arrière-plan, ouverture du navigateur.
# Tout message sur stderr + code de sortie ≠ 0 est affiché à l'utilisateur dans une fenêtre d'erreur.
# Tout est dans une fonction : le script est lu en entier avant de s'exécuter,
# donc une mise à jour de ce fichier par « git pull » ne casse pas le lancement en cours.
APP_DIR="${0:A:h:h}"

main() {
  cd "$APP_DIR" || { echo "Dossier de l'app introuvable : $APP_DIR" >&2; return 1; }
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)"
  PORT=8765
  URL="http://localhost:$PORT"

  if [[ ! -x .venv/bin/uvicorn ]]; then
    echo "L'installation est incomplète. Relance l'installation (voir le README)." >&2
    return 1
  fi

  # Déjà lancée : on ouvre simplement le navigateur.
  if curl -sf --max-time 2 "$URL/api/ping" >/dev/null; then
    open "$URL"
    return 0
  fi
  if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Le port $PORT est utilisé par un autre programme." >&2
    return 1
  fi

  mkdir -p data
  LOG=data/server.log

  # Mise à jour silencieuse ; hors ligne, on garde la version actuelle.
  if [[ -d .git ]]; then
    GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 \
      pull --ff-only --quiet >>"$LOG" 2>&1 || echo "$(date) mise à jour ignorée" >>"$LOG"
  fi

  # Réinstalle les dépendances seulement si requirements.txt a changé.
  REQ_HASH=$(shasum requirements.txt | cut -d' ' -f1)
  if [[ "$(cat .venv/.req-hash 2>/dev/null)" != "$REQ_HASH" ]]; then
    osascript -e 'display notification "Installation de la mise à jour (1 à 2 minutes)…" with title "Captions"'
    if ! .venv/bin/pip install --quiet -r requirements.txt >>"$LOG" 2>&1; then
      echo "La mise à jour des dépendances a échoué. Détails : $APP_DIR/$LOG" >&2
      return 1
    fi
    echo "$REQ_HASH" > .venv/.req-hash
  fi

  # Serveur détaché : il s'arrête tout seul quand plus aucun onglet n'est ouvert (voir server.py).
  echo "--- $(date) démarrage" >>"$LOG"
  nohup .venv/bin/uvicorn app.server:app --port $PORT --log-level warning >>"$LOG" 2>&1 </dev/null &!

  for _ in {1..60}; do
    if curl -sf --max-time 1 "$URL/api/ping" >/dev/null; then
      open "$URL"
      return 0
    fi
    sleep 0.5
  done
  echo "Le serveur n'a pas démarré. Dernières lignes du journal :" >&2
  tail -5 "$LOG" >&2
  return 1
}
main "$@"
exit
