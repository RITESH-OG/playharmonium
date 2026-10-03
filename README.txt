# RaagSetu — Virtual Harmonium

Open `index.html` in a modern browser.

Features:
- Play harmonium notes by clicking/tapping keys.
- Play using the mapped computer keyboard.
- Web Audio synthesized harmonium sound; no external audio files required.
- Reverb, volume, transpose, octave and reed controls.
- Recording using MediaRecorder; saves a WebM audio file.
- Light/dark mode.
- Responsive desktop/mobile layout.
- Settings and help dialogs.

Keyboard:
White keys: A S D F G H J K L ; ' Z X C V B
Black keys: Q W E R T Y U I O P [ ]
Arrow Up/Down: volume
Left/Right: transpose
Page Up/Page Down: octave
Alt + Left/Right: reeds
Tab: reverb
Space: stop all notes

Sound update: the instrument now uses a custom harmonium-style additive synthesis engine tuned from the supplied reference recording, with reed harmonics, delayed vibrato, soft attack, release and subtle bellows noise.

The latest build includes sounds/sa.wav through sounds/ni.wav extracted from the supplied reference recording. Keys use these reference timbres and Web Audio playback-rate transposition.
