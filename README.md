# Wayfarer

A small third-person open-world game for the browser: TypeScript + Three.js (WebGL2), no assets, everything procedural.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static files in dist/ — host anywhere
```

## Controls
W/S walk · A/D strafe · ←/→ turn · ↑/↓ tilt camera · Shift run · Space jump · E talk ·
1–4 / ↑↓ Enter pick dialogue · C camera distance · T (hold) fast-forward time · Q quality · F fps · H help

## Layout
- `src/terrain.ts` — seeded heightmap island (simplex fbm + ridged mountains), vertex-coloured mesh, exact ground-height sampling
- `src/world.ts` — instanced trees/rocks/grass (chunked for culling), village, glowshards
- `src/colliders.ts` — circle/box colliders in a spatial hash
- `src/character.ts` — blocky humanoids, 6 draw calls each, procedural walk/jump/swim animation
- `src/player.ts` — movement, slopes, jumping, swimming
- `src/npcs.ts` — NPC wander/face/bark behaviour, dialogue trees, quest state
- `src/dialogue.ts` — keyboard dialogue UI
- `src/main.ts` — renderer, day/night, camera, HUD, minimap, quality + adaptive resolution

## Performance choices
Lambert materials only, one shadow-casting light with a small follow-the-player shadow map,
fog-limited draw distance, instancing for all vegetation, no textures or post-processing,
pixel ratio capped at 1 on Medium, and automatic resolution drop if fps stays under 30.
