# Captions

Sous-titres automatiques pour vidéos TikTok / Instagram, 100 % en local sur le Mac (puce Apple M1 ou plus récente).

- Transcription : Whisper large-v3 (MLX, optimisé Apple Silicon), timestamps au mot près
- Correction du texte avant export + corrections automatiques mémorisées (ex. `bureautique => Burotic`)
- Style : police (Inter, Montserrat, Poppins, Roboto, Arial), graisse, taille, couleur, ombre, contour, position, majuscules
- Export : même résolution, même cadence, même codec (H.264 ou HEVC 10 bits), audio copié sans modification,
  vidéo réencodée en qualité visuellement identique (x264 CRF 15 / x265 CRF 16)

## Installer (une seule fois)

Ouvre l'app **Terminal** et colle :

```bash
git clone https://github.com/michaeljasmin/video-captions.git ~/Captions && open ~/Captions/Installer.command
```

Ce qui va se passer :

1. Si le Mac propose d'installer les « outils de ligne de commande », accepte, attends la fin, puis recolle la commande.
2. Le code est téléchargé dans le dossier `Captions` de ton dossier personnel (ne le déplace pas), et l'installateur s'ouvre.
3. Il installe Homebrew si besoin (ton mot de passe Mac est demandé, rien ne s'affiche quand tu tapes, c'est normal),
   puis ffmpeg, Python, le modèle Whisper (~3 Go) et l'app **Captions** dans le dossier Applications.
   Compte environ 15 minutes au total. À la fin, l'app s'ouvre toute seule.

## Lancer

Ouvre **Captions** depuis le dossier Applications, le Launchpad ou Spotlight (⌘ Espace, « Captions »).
L'app s'ouvre dans le navigateur. Pour l'avoir sous la main, glisse-la dans le Dock.

Rien à fermer : l'app s'arrête toute seule 10 minutes après la fermeture de son onglet.
En cas de problème, une fenêtre d'erreur s'affiche (journal : `data/server.log`).

## Mises à jour

Automatiques et silencieuses : à chaque lancement, l'app récupère la dernière version sur GitHub.

## Désinstaller

Attention : ça supprime aussi les vidéos gardées dans `~/Captions/data`. Récupère d'abord celles que tu veux garder.

Ouvre l'app **Terminal** et colle :

```bash
pkill -f "uvicorn app.server:app"; rm -rf /Applications/Captions.app ~/Applications/Captions.app ~/Captions ~/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-mlx
```

Ça arrête l'app, puis supprime l'app, son dossier et le modèle Whisper (~3 Go libérés).
Si Captions est dans le Dock : clic droit › Options › Retirer du Dock.

Homebrew, ffmpeg et Python restent installés, car d'autres outils peuvent s'en servir.
Pour retirer aussi ffmpeg : `brew uninstall ffmpeg`.

## Fichiers

Les vidéos envoyées et exportées sont gardées dans `data/`. Supprime ce dossier pour libérer de l'espace.

Polices sous licence SIL Open Font License (voir `app/static/fonts/OFL-*.txt`).
