# Captions

Sous-titres automatiques pour vidéos TikTok / Instagram, 100 % en local sur le Mac (puce Apple M1 ou plus récente).

- Transcription : Whisper large-v3 (MLX, optimisé Apple Silicon), timestamps au mot près
- Correction du texte avant export + corrections automatiques mémorisées (ex. `bureautique => Burotic`)
- Style : police (Inter, Montserrat, Poppins, Roboto, Arial), graisse, taille, couleur, ombre, contour, position, majuscules
- Export : même résolution, même cadence, même codec (H.264 ou HEVC 10 bits), audio copié sans modification,
  vidéo réencodée en qualité visuellement identique (x264 CRF 15 / x265 CRF 16)

## Installer (une seule fois)

Le dépôt est privé : il faut un compte GitHub invité comme collaborateur
(Settings › Collaborators sur github.com/michaeljasmin/captions), et accepter l'invitation reçue par courriel.

Ensuite, ouvre l'app **Terminal** et colle :

```bash
/bin/zsh -c 'set -e
[[ -x /opt/homebrew/bin/brew ]] || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"
command -v gh >/dev/null || brew install gh
gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https --hostname github.com
gh auth setup-git
[[ -d ~/Captions ]] || gh repo clone michaeljasmin/captions ~/Captions
open ~/Captions/Installer.command'
```

Ce qui va se passer :

1. Homebrew s'installe si besoin : ton mot de passe Mac est demandé (rien ne s'affiche quand tu tapes, c'est normal).
2. GitHub affiche un code à 8 caractères : appuie sur Entrée, le navigateur s'ouvre, colle le code et autorise.
3. L'app est téléchargée dans le dossier `Captions` de ton dossier personnel, puis l'installateur s'ouvre :
   ffmpeg, Python et le modèle Whisper (~3 Go). Compte environ 15 minutes au total.

## Lancer

Double-clique `Captions.command` dans le dossier `Captions` (dans ton dossier personnel).
Le navigateur s'ouvre sur http://localhost:8765. Ferme la fenêtre Terminal pour arrêter l'app.

Astuce : glisse `Captions.command` dans le Dock (à droite de la ligne) pour l'avoir sous la main.

## Mises à jour

Automatiques : à chaque lancement, l'app récupère la dernière version sur GitHub.

## Fichiers

Les vidéos envoyées et exportées sont gardées dans `data/`. Supprime ce dossier pour libérer de l'espace.

Polices sous licence SIL Open Font License (voir `app/static/fonts/OFL-*.txt`).
