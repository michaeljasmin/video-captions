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
2. L'app est téléchargée dans le dossier `Captions` de ton dossier personnel, et l'installateur s'ouvre.
3. Il installe Homebrew si besoin (ton mot de passe Mac est demandé, rien ne s'affiche quand tu tapes, c'est normal),
   puis ffmpeg, Python et le modèle Whisper (~3 Go). Compte environ 15 minutes au total.

## Lancer

Double-clique `Captions.command` dans le dossier `Captions` (dans ton dossier personnel).
Le navigateur s'ouvre sur http://localhost:8765. Ferme la fenêtre Terminal pour arrêter l'app.

Astuce : glisse `Captions.command` dans le Dock (à droite de la ligne) pour l'avoir sous la main.

## Mises à jour

Automatiques : à chaque lancement, l'app récupère la dernière version sur GitHub.

## Fichiers

Les vidéos envoyées et exportées sont gardées dans `data/`. Supprime ce dossier pour libérer de l'espace.

Polices sous licence SIL Open Font License (voir `app/static/fonts/OFL-*.txt`).
