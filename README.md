# Wayfarer

A small third-person open-world game for the browser: TypeScript + Three.js (WebGL2), no assets, everything procedural.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static files in dist/ — host anywhere
```

## Deployment
Pushes to `main` build and deploy to GitHub Pages via `.github/workflows/deploy.yml`
(one-time setup: repo **Settings → Pages → Source: GitHub Actions**).

## Controls
W/S walk · A/D strafe · ←/→ turn · ↑/↓ tilt camera · Shift run · Space jump · E talk / interact ·
G dance (once learned) · 1–4 / ↑↓ Enter pick dialogue · C camera distance · T (hold) fast-forward time · Q quality · F fps · H help

## What's on the island
A compact island with the village of Thistlewick at its heart: plaza, well, bell, notice board, market stall,
forge, bakery, farm (field, coop, sheep/cow pen, pig pen), orchard, pond, laundry line, woodcutter's yard and
campfire, plus a dock, an herbalist's hut in the woods and a hermit's camp on the hill.

- **16 villagers** with jobs and daily routines (hammering, chopping, hoeing, kneading, sweeping, fishing, playing
  the lute, hauling crates...). They chat with each other, kids play tag, everyone reacts to the bell, Brann panics
  at frogs, most go home at night while a few gather at the campfire, and once the lanterns are lit there's a
  festival in the plaza every evening.
- **~70 animals**: chickens, dogs (who chase chickens and visit villagers for pets), cats, sheep, cows, pigs,
  ducks, frogs, pigeons, gulls, deer and rabbits. Pet them, feed them their favourite food and they'll follow you.
- **Lots to press E on**: apple trees, berry bushes, mushrooms, flowers, barrels, treasure chests, benches,
  campfire (skip time), chopping stump, fishing off the dock, signposts, the scarecrow...
- **Side quests**: lost sheep, lost cat, apples for the baker, mushrooms for the herbalist, firewood, a runaway sock;
  sell goods to Ilsa and spend coins on a fishing rod or a very fancy hat.

## Layout
- `src/terrain.ts` — seeded heightmap island (simplex fbm + ridged mountains), village plateau + pond, vertex-coloured mesh, exact ground-height sampling
- `src/world.ts` — instanced trees/rocks/grass (chunked for culling), spot finding, glowshards
- `src/village.ts` — all buildings, props and interactables; static props are merged into a few chunked meshes
- `src/interact.ts` — interactable registry + hooks into the game loop
- `src/state.ts` — quest/inventory state
- `src/colliders.ts` — circle/box colliders in a spatial hash, walkable platforms (the dock)
- `src/character.ts` — blocky humanoids, procedural walk/jump/swim + activity poses and held props
- `src/animals.ts` — procedural low-poly animals and their behaviour
- `src/player.ts` — movement, slopes, jumping, swimming, sitting/actions
- `src/npcs.ts` — villager schedules/tasks, social behaviour (chats, tag, reactions), dialogue trees
- `src/dialogue.ts` — keyboard dialogue UI
- `src/main.ts` — renderer, day/night, camera, HUD, minimap, quality + adaptive resolution

## Performance choices
Lambert materials only, one shadow-casting light with a small follow-the-player shadow map,
fog-limited draw distance, instancing for all vegetation, no textures or post-processing,
pixel ratio capped at 1 on Medium, and automatic resolution drop if fps stays under 30.
