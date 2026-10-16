#!/bin/zsh
# Appelé par Captions.app avant de démarrer le serveur : mise à jour depuis GitHub, dépendances,
# et reconstruction de l'app si son code a changé. En cas d'échec, la sortie s'affiche dans une fenêtre d'erreur.
# Tout est dans une fonction : le script est lu en entier avant de s'exécuter,
# donc une mise à jour de ce fichier par « git pull » ne casse pas l'exécution en cours.
APP_DIR="${0:A:h:h}"

main() {
  cd "$APP_DIR" || { echo "Dossier de l'app introuvable : $APP_DIR"; return 1; }
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)"
  [[ -x .venv/bin/uvicorn ]] || { echo "L'installation est incomplète. Relance l'installation (voir le README)."; return 1; }
  mkdir -p data
  LOG=data/server.log

  # Mise à jour silencieuse ; hors ligne, on garde la version actuelle.
  if [[ -d .git ]]; then
    GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 \
      pull --ff-only --quiet >>"$LOG" 2>&1 || echo "$(date) mise à jour ignorée" >>"$LOG"
  fi

  # Dépendances : réinstallées seulement si requirements.txt a changé.
  REQ_HASH=$(shasum requirements.txt | cut -d' ' -f1)
  if [[ "$(cat .venv/.req-hash 2>/dev/null)" != "$REQ_HASH" ]]; then
    if ! .venv/bin/pip install --quiet -r requirements.txt >>"$LOG" 2>&1; then
      echo "La mise à jour des dépendances a échoué. Détails : $APP_DIR/$LOG"
      return 1
    fi
    echo "$REQ_HASH" > .venv/.req-hash
  fi

  # Le code de l'app Mac a changé : reconstruction en arrière-plan, active au prochain lancement.
  if [[ "$(cat .venv/.app-hash 2>/dev/null)" != "$(zsh scripts/build-app.sh --hash)" ]]; then
    (zsh scripts/build-app.sh >>"$LOG" 2>&1 || echo "$(date) reconstruction de l'app échouée" >>"$LOG") &!
  fi
  return 0
}
main "$@"
exit
