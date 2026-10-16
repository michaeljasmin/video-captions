#!/bin/zsh
# Double-clique ce fichier pour lancer l'app Captions, puis ferme la fenêtre Terminal pour l'arrêter.
# Tout est dans une fonction : le script est lu en entier avant de s'exécuter,
# donc une mise à jour de ce fichier par « git pull » ne casse pas le lancement en cours.
main() {
  cd "$(dirname "$0")"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)"
  if [[ ! -x .venv/bin/uvicorn ]]; then
    echo "L'app n'est pas encore installée : double-clique d'abord « Installer.command »."
    read -k1 "?Appuie sur une touche pour fermer."
    return 1
  fi

  PORT=8765
  if lsof -i :$PORT >/dev/null 2>&1; then
    open "http://localhost:$PORT"
    return 0
  fi

  if [[ -d .git ]]; then
    echo "Recherche de mises à jour…"
    # Pas de demande de mot de passe : si GitHub refuse, on lance simplement la version actuelle.
    if GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet 2>/dev/null; then
      echo "À jour : $(git log -1 --format='%s (%cr)')"
    else
      echo "Mise à jour impossible pour l'instant (hors ligne ?). Lancement de la version actuelle."
    fi
  fi

  # Réinstalle les dépendances seulement si requirements.txt a changé.
  REQ_HASH=$(shasum requirements.txt | cut -d' ' -f1)
  if [[ "$(cat .venv/.req-hash 2>/dev/null)" != "$REQ_HASH" ]]; then
    echo "Mise à jour des dépendances…"
    .venv/bin/pip install --quiet -r requirements.txt && echo "$REQ_HASH" > .venv/.req-hash
  fi

  (sleep 2 && open "http://localhost:$PORT") &
  exec .venv/bin/uvicorn app.server:app --port $PORT
}
main "$@"
exit
