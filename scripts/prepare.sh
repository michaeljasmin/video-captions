#!/bin/zsh
# Appelé par Captions.app avant de démarrer le serveur. En cas d'échec, la sortie s'affiche dans une fenêtre d'erreur.
#   check   cherche une mise à jour sur GitHub ; si oui, affiche « UPDATE », la version actuelle,
#           la nouvelle, puis la liste des nouveautés (une par ligne)
#   update  installe la mise à jour ; affiche « RELAUNCH » si l'app Mac elle-même a été reconstruite
#   start   vérifie seulement les dépendances avant le démarrage
#   (rien)  ancien comportement (apps installées avant la fenêtre de mise à jour) : met à jour sans demander
# Tout est dans une fonction : le script est lu en entier avant de s'exécuter,
# donc une mise à jour de ce fichier par « git pull » ne casse pas l'exécution en cours.
APP_DIR="${0:A:h:h}"

git_quiet() {
  GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 "$@"
}

# Dépendances Python : réinstallées seulement si requirements.txt a changé.
ensure_deps() {
  local hash=$(shasum requirements.txt | cut -d' ' -f1)
  [[ "$(cat .venv/.req-hash 2>/dev/null)" == "$hash" ]] && return 0
  if ! .venv/bin/pip install --quiet -r requirements.txt >>"$LOG" 2>&1; then
    echo "L'installation des dépendances a échoué. Détails : $APP_DIR/$LOG"
    return 1
  fi
  echo "$hash" > .venv/.req-hash
}

app_outdated() {
  [[ "$(cat .venv/.app-hash 2>/dev/null)" != "$(zsh scripts/build-app.sh --hash)" ]]
}

main() {
  cd "$APP_DIR" || { echo "Dossier de l'app introuvable : $APP_DIR"; return 1; }
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)"
  [[ -x .venv/bin/uvicorn ]] || { echo "L'installation est incomplète. Relance l'installation (voir le README)."; return 1; }
  mkdir -p data
  LOG=data/server.log

  case "$1" in
    check)
      [[ -d .git ]] && git_quiet fetch --quiet >>"$LOG" 2>&1 || return 0  # hors ligne : rien à proposer
      local behind=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
      [[ "$behind" -gt 0 ]] || return 0
      echo "UPDATE"
      git rev-list --count HEAD
      git rev-list --count @{u}
      git log --format='%s' HEAD..@{u} | head -8
      ;;
    update)
      if ! git_quiet pull --ff-only --quiet >>"$LOG" 2>&1; then
        echo "La mise à jour n'a pas pu être téléchargée. Détails : $APP_DIR/$LOG"
        return 1
      fi
      ensure_deps || return 1
      if app_outdated; then
        if ! zsh scripts/build-app.sh >>"$LOG" 2>&1; then
          echo "La nouvelle version de l'app n'a pas pu être construite. Détails : $APP_DIR/$LOG"
          return 1
        fi
        echo "RELAUNCH"
      fi
      ;;
    start)
      ensure_deps || return 1
      # Filet de sécurité : app pas à jour par rapport au code (reconstruite pour le prochain lancement).
      app_outdated && (zsh scripts/build-app.sh >>"$LOG" 2>&1 &!)
      ;;
    *)
      [[ -d .git ]] && { git_quiet pull --ff-only --quiet >>"$LOG" 2>&1 || echo "$(date) mise à jour ignorée" >>"$LOG"; }
      ensure_deps || return 1
      app_outdated && (zsh scripts/build-app.sh >>"$LOG" 2>&1 &!)
      ;;
  esac
  return 0
}
main "$@"
exit
