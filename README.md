# Mathteroid

An Asteroids-style browser game for practicing arithmetic facts (+ − × ÷, 1–12).
Shoot the asteroid carrying the answer; wrong answers split rocks, three collisions end a level.
See [docs/VISION.md](docs/VISION.md) for the full product vision and roadmap.

**Status:** Phase 1 prototype — game only, progress saved in the browser (`localStorage`).

## Run

```sh
npm install
npm run dev        # http://localhost:5173 (hot reload)
npm run preview    # build, then serve on the LAN for playtesting (port 4173)
npm run dev:lan    # dev server on the LAN (port 5173)
npm test           # vitest (learning engine, store, audio)
npm run build      # typecheck + production bundle in dist/
```

`preview` and `dev:lan` use `scripts/lan.sh`: it asks for sudo, opens the port in UFW
for the local subnet only, prints the URL to give the kids, and removes the UFW rule
when you press Ctrl-C (or the server exits). `preview:local` serves without touching
the firewall.

Game engine sandbox (loadout switcher, event log): `http://localhost:5173/src/game/dev.html`

## Layout

| Path | What |
|---|---|
| `src/types.ts` | Shared contracts between modules |
| `src/catalog.ts` | Hangar items (ships, colors, lasers, trails, perks) |
| `src/learning/` | Curriculum stages, adaptive fact selection, accuracy + speed mastery gate |
| `src/game/` | Three.js engine: flight, asteroids, lasers, aim assist, HUD, touch controls |
| `src/store/` | Profiles + persistence (async `ProfileStore`; backend drops in for Phase 2), stardust economy |
| `src/audio/` | Synthesized SFX, procedural music, text-to-speech |
| `src/ui/` | Screens (pilot picker, hangar, results, …) |
| `src/main.ts` | Wiring and screen flow |

## Controls

- **Keyboard:** Arrows/WASD fly, Space fire, P/Esc pause.
- **Touch:** left-side joystick, FIRE button, tap an asteroid to auto-aim.
- **Mouse:** click an asteroid to auto-aim.
