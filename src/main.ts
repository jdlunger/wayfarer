import * as THREE from 'three';
import { input } from './input';
import { buildTerrainMesh, buildWater, groundHeight, WORLD, terrainColor, groundNormalY } from './terrain';
import { buildVegetation, buildVillage, findSpots, buildShards } from './world';
import { Player } from './player';
import { NPC, makeNPCDefs, makeOutskirtsDefs, state, SHARDS_NEEDED } from './npcs';
import { Dialogue } from './dialogue';
import { clamp, lerp, smoothstep } from './noise';

const $ = (id: string) => document.getElementById(id)!;

// ---------- Renderer ----------
const canvas = $('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 420);
scene.fog = new THREE.Fog('#cfe3f2', 90, 380);
scene.background = new THREE.Color('#cfe3f2');

// ---------- Quality presets ----------
interface Quality { name: string; pixelRatio: number; shadows: number; fogFar: number; }
const QUALITIES: Quality[] = [
  { name: 'Low', pixelRatio: 0.7, shadows: 0, fogFar: 240 },
  { name: 'Medium', pixelRatio: 1, shadows: 1024, fogFar: 380 },
  { name: 'High', pixelRatio: Math.min(window.devicePixelRatio, 2), shadows: 2048, fogFar: 380 },
];
let qIndex = 1;

// ---------- Lights ----------
const hemi = new THREE.HemisphereLight('#cfe8ff', '#5a6b3a', 1.0);
const sun = new THREE.DirectionalLight('#fff4e0', 2.0);
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.04;
scene.add(hemi, sun, sun.target);

// ---------- Sky dome (gradient shader, no textures) ----------
const skyUniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(400, 16, 12),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.5, h)), 1.0); }',
  }),
);
sky.renderOrder = -1;
scene.add(sky);

// Sun & moon discs
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(14, 16), new THREE.MeshBasicMaterial({ color: '#fff3c4', fog: false }));
const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(8, 16), new THREE.MeshBasicMaterial({ color: '#dfe8ff', fog: false }));
scene.add(sunDisc, moonDisc);

// ---------- World ----------
const loading = performance.now();
scene.add(buildTerrainMesh(), buildWater());
buildVegetation(scene);
const village = buildVillage(scene);
const spots = findSpots();
const shards = buildShards(scene, spots.shardSites.slice(0, 7));
const player = new Player(scene);
const labelsEl = $('labels');
const npcs = [...makeNPCDefs(village.spots), ...makeOutskirtsDefs(spots.shore, spots.hill)].map(d => new NPC(d, scene, labelsEl));
const pip = npcs.find(n => n.def.id === 'pip')!;
console.log(`World built in ${(performance.now() - loading).toFixed(0)} ms`);

const dialogue = new Dialogue();
let talkingTo: NPC | null = null;

// ---------- HUD ----------
const toastEl = $('toast');
let toastTimer = 0;
state.toast = (msg: string) => { toastEl.textContent = msg; toastEl.classList.add('show'); toastTimer = 3.5; };
state.onQuestDone = () => { village.lanternMat.emissiveIntensity = 1.6; village.lanternMat.color.set('#ffd28a'); state.toast('The lanterns of Thistlewick are lit!'); };

function updateQuestLog() {
  const lines: string[] = [];
  if (state.quest === 'none') lines.push('Explore the village. Someone by the well looks troubled.');
  if (state.quest === 'active') {
    lines.push(`<b>The Dark Lanterns</b>`);
    lines.push(state.shards >= SHARDS_NEEDED
      ? 'Return the glowshards to Elder Maren.'
      : `Find glowshards: ${state.shards}/${SHARDS_NEEDED}`);
    if (!state.mapRevealed) lines.push('<small>Tip: Sela the hermit may know where they fell.</small>');
  }
  if (state.quest === 'done') lines.push('<span class="done">The Dark Lanterns</span>');
  if (state.quest === 'done' && !state.boots) lines.push('Visit Tobin at the forge.');
  if (state.pip === 'hiding' && pip.hidden) lines.push('Find Pip — hiding somewhere outside the village.');
  $('quest').innerHTML = `<h3>Journal</h3>${lines.join('<br>')}`;
}

// ---------- Minimap ----------
const mini = $('minimap') as HTMLCanvasElement;
const mctx = mini.getContext('2d')!;
const MAP = 180;
const mapImg = document.createElement('canvas');
mapImg.width = mapImg.height = MAP;
{
  const ictx = mapImg.getContext('2d')!;
  const img = ictx.createImageData(MAP, MAP);
  const c = new THREE.Color();
  for (let py = 0; py < MAP; py++) {
    for (let px = 0; px < MAP; px++) {
      const x = (px / MAP - 0.5) * WORLD, z = (py / MAP - 0.5) * WORLD;
      const h = groundHeight(x, z);
      if (h < 0) c.set('#1d4e6b').lerp(new THREE.Color('#2f7aa0'), clamp(1 + h / 6, 0, 1));
      else {
        terrainColor(x, z, h, groundNormalY(x, z), c);
        c.multiplyScalar(0.75 + clamp(h / 60, 0, 0.4));
      }
      const i = (py * MAP + px) * 4;
      img.data[i] = c.r * 255; img.data[i + 1] = c.g * 255; img.data[i + 2] = c.b * 255; img.data[i + 3] = 255;
    }
  }
  ictx.putImageData(img, 0, 0);
}
const toMap = (v: number) => (v / WORLD + 0.5) * MAP;

function drawMinimap() {
  mctx.save();
  mctx.clearRect(0, 0, MAP, MAP);
  mctx.beginPath(); mctx.arc(MAP / 2, MAP / 2, MAP / 2, 0, Math.PI * 2); mctx.clip();
  mctx.drawImage(mapImg, 0, 0);
  if (state.mapRevealed) {
    for (const s of shards) if (!s.taken) dot(s.pos.x, s.pos.z, 3.5, '#8ff0ff', '#035');
  }
  for (const n of npcs) {
    if (n.def.id === 'pip' && state.pip === 'hiding') continue;
    dot(n.pos.x, n.pos.z, 2.5, '#ffd36b', '#432');
  }
  // Player arrow
  const px = toMap(player.pos.x), pz = toMap(player.pos.z);
  mctx.translate(px, pz);
  mctx.rotate(-player.heading);
  mctx.beginPath(); mctx.moveTo(0, 6); mctx.lineTo(4, -4); mctx.lineTo(0, -2); mctx.lineTo(-4, -4); mctx.closePath();
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 1.5; mctx.stroke(); mctx.fill();
  mctx.restore();
}
function dot(x: number, z: number, r: number, fill: string, stroke: string) {
  mctx.beginPath(); mctx.arc(toMap(x), toMap(z), r, 0, Math.PI * 2);
  mctx.fillStyle = fill; mctx.strokeStyle = stroke; mctx.lineWidth = 1; mctx.fill(); mctx.stroke();
}

// ---------- Quality / resize ----------
function applyQuality(announce = true) {
  const q = QUALITIES[qIndex];
  renderer.setPixelRatio(q.pixelRatio * renderScale);
  sun.castShadow = q.shadows > 0;
  if (q.shadows > 0 && sun.shadow.mapSize.x !== q.shadows) {
    sun.shadow.mapSize.set(q.shadows, q.shadows);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  (scene.fog as THREE.Fog).far = q.fogFar;
  camera.far = q.fogFar + 40;
  camera.updateProjectionMatrix();
  // Keep sky dome + sun/moon inside the far plane, or they get clipped to black.
  skyRadius = camera.far * 0.85;
  sky.scale.setScalar(skyRadius / 400);
  player.char.setBlobVisible(q.shadows === 0);
  npcs.forEach(n => n.char.setBlobVisible(q.shadows === 0));
  if (announce) state.toast(`Graphics: ${q.name}`);
}
let renderScale = 1;
let skyRadius = 400;
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
applyQuality(false);

// ---------- Day / night ----------
const DAY_LENGTH = 480; // seconds per full cycle
let dayTime = 0.3;      // 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
const C = {
  dayTop: new THREE.Color('#4f95e0'), dayBot: new THREE.Color('#cfe3f2'),
  duskTop: new THREE.Color('#3b4a7a'), duskBot: new THREE.Color('#f0a46a'),
  nightTop: new THREE.Color('#060a1c'), nightBot: new THREE.Color('#1a2444'),
};
const sunDir = new THREE.Vector3();
const tmpTop = new THREE.Color(), tmpBot = new THREE.Color();

function updateSky(dt: number) {
  dayTime = (dayTime + dt / DAY_LENGTH * (input.down('KeyT') ? 25 : 1)) % 1;
  const ang = (dayTime - 0.25) * Math.PI * 2;
  sunDir.set(Math.cos(ang) * 0.8, Math.sin(ang), 0.45).normalize();
  const elev = sunDir.y;
  const day = smoothstep(-0.12, 0.25, elev);
  const dusk = 1 - smoothstep(0.0, 0.35, Math.abs(elev));

  tmpTop.copy(C.nightTop).lerp(C.dayTop, day).lerp(C.duskTop, dusk * 0.5);
  tmpBot.copy(C.nightBot).lerp(C.dayBot, day).lerp(C.duskBot, dusk * 0.7);
  skyUniforms.top.value.copy(tmpTop);
  skyUniforms.bottom.value.copy(tmpBot);
  (scene.fog as THREE.Fog).color.copy(tmpBot);
  (scene.background as THREE.Color).copy(tmpBot);

  hemi.intensity = lerp(0.45, 1.05, day);
  hemi.color.set('#cfe8ff').lerp(new THREE.Color('#7f95d6'), 1 - day);
  // Moonlight takes over after sunset so nights stay readable.
  const moon = elev < 0;
  sun.color.set(moon ? '#9fb4ff' : '#fff1d6').lerp(new THREE.Color('#ffae6b'), moon ? 0 : dusk * 0.8);
  sun.intensity = moon ? 0.45 * smoothstep(0, 0.2, -elev) : 2.1 * smoothstep(0, 0.12, elev);

  const night = 1 - day;
  village.windowMat.emissiveIntensity = night * 1.2;
  if (state.quest === 'done') village.lanternMat.emissiveIntensity = 0.8 + night * 1.6;
  shardMatGlow = 0.6 + night * 1.2;
  return { lightDir: moon ? sunDir.clone().negate() : sunDir };
}
let shardMatGlow = 1;

// ---------- Camera ----------
let camDist = 7.5;
let camPitch = 0.32;
let camHeading = player.heading;
const camTarget = new THREE.Vector3();
const DISTS = [4.5, 7.5, 12];
let distIdx = 1;

function updateCamera(dt: number, locked: boolean) {
  if (!locked) {
    if (input.down('ArrowUp')) camPitch = Math.min(1.2, camPitch + dt * 1.2);
    if (input.down('ArrowDown')) camPitch = Math.max(-0.05, camPitch - dt * 1.2);
  }
  if (input.hit('KeyC')) { distIdx = (distIdx + 1) % DISTS.length; }
  camDist += (DISTS[distIdx] - camDist) * Math.min(1, dt * 6);

  let dh = player.heading - camHeading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  camHeading += dh * Math.min(1, dt * 8);

  let heading = camHeading, dist = camDist, pitch = camPitch;
  const focus = talkingTo ? talkingTo.pos : null;
  if (focus) {
    // Over-the-shoulder framing during conversations
    heading = Math.atan2(focus.x - player.pos.x, focus.z - player.pos.z) + 0.75;
    dist = 5.2; pitch = 0.22;
  }
  const want = new THREE.Vector3(player.pos.x, player.pos.y + 1.6, player.pos.z);
  camTarget.lerp(want, Math.min(1, dt * 12));
  if (camTarget.lengthSq() === 0 || camTarget.distanceTo(want) > 20) camTarget.copy(want);

  const cx = camTarget.x - Math.sin(heading) * Math.cos(pitch) * dist;
  const cz = camTarget.z - Math.cos(heading) * Math.cos(pitch) * dist;
  let cy = camTarget.y + Math.sin(pitch) * dist;
  cy = Math.max(cy, groundHeight(cx, cz) + 0.6, 0.4);
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), focus ? Math.min(1, dt * 4) : 1);
  const look = focus ? camTarget.clone().lerp(new THREE.Vector3(focus.x, focus.y + 1.5, focus.z), 0.5) : camTarget;
  camera.lookAt(look);
}

// ---------- Interaction ----------
const promptEl = $('prompt');
function nearestNPC(): NPC | null {
  let best: NPC | null = null, bestD = 3.2;
  for (const n of npcs) {
    if (n.mode === 'flee') continue;
    const d = Math.hypot(n.pos.x - player.pos.x, n.pos.z - player.pos.z);
    if (d < bestD && Math.abs(n.pos.y - player.pos.y) < 2) { best = n; bestD = d; }
  }
  return best;
}

function startTalk(n: NPC) {
  talkingTo = n;
  player.faceToward(n.pos);
  dialogue.open(n.def.name, n.def.script, () => {
    talkingTo = null;
    if (state.pipHideRequested) {
      state.pipHideRequested = false;
      state.pip = 'hiding';
      pip.flee(player.pos);
    }
    updateQuestLog();
  });
}

// Keep NPCs from walking through the player
function separate() {
  for (const n of npcs) {
    const dx = player.pos.x - n.pos.x, dz = player.pos.z - n.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.8 && d > 1e-4) { player.pos.x = n.pos.x + dx / d * 0.8; player.pos.z = n.pos.z + dz / d * 0.8; }
  }
}

// ---------- Labels ----------
const proj = new THREE.Vector3();
function updateLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  for (const n of npcs) {
    const d = camera.position.distanceTo(n.pos);
    const hiddenPip = n === pip && state.pip === 'hiding' && d > 12;
    proj.set(n.pos.x, n.pos.y + 2.35 * (n.def.style.scale ?? 1), n.pos.z).project(camera);
    if (d > 28 || proj.z > 1 || hiddenPip || (talkingTo === n)) { n.label.style.display = 'none'; continue; }
    n.label.style.display = '';
    n.label.style.opacity = String(clamp((28 - d) / 8, 0, 1));
    n.label.style.transform = `translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px) translate(-50%, -100%)`;
  }
}

// ---------- Main loop ----------
const helpEl = $('help');
const statsEl = $('stats');
let started = false;
let showStats = false;
let frames = 0, fpsTime = 0, fps = 0, slowTime = 0, logicAcc = 0;
let last = performance.now();
let mapTick = 0;
updateQuestLog();

function frame(now: number) {
  requestAnimationFrame(frame);
  const realDt = (now - last) / 1000;
  const dt = Math.min(0.05, realDt);
  const cpuStart = performance.now();
  last = now;

  if (!started) {
    if (input.anyHit()) { started = true; helpEl.classList.add('hidden'); }
  } else if (input.hit('KeyH') && !dialogue.active) {
    helpEl.classList.toggle('hidden');
  }
  const paused = !started || !helpEl.classList.contains('hidden');

  if (input.hit('KeyQ')) { qIndex = (qIndex + 1) % QUALITIES.length; renderScale = 1; applyQuality(); }
  if (input.hit('KeyF')) { showStats = !showStats; statsEl.style.display = showStats ? 'block' : 'none'; }

  const { lightDir } = updateSky(paused ? 0 : dt);

  if (!paused) {
    const inDialogue = dialogue.active;
    if (inDialogue) dialogue.update(dt);

    player.speedBoost = state.boots ? 1.35 : 1;
    player.update(dt, !inDialogue);
    for (const n of npcs) n.update(dt, player.pos, talkingTo === n);
    separate();

    // Pip vanishes to a hiding spot once he's out of sight
    if (state.pip === 'hiding' && pip.hidden && pip.mode !== 'flee') {
      pip.hidden = false;
      const spot = spots.hideSpots[(Math.random() * spots.hideSpots.length) | 0];
      pip.teleport(spot);
      updateQuestLog();
    }
    if (state.pip === 'found' && pip.pos.distanceTo(player.pos) > 60) pip.teleport(pip.def.home);

    // Interaction prompt
    const near = !inDialogue ? nearestNPC() : null;
    if (near) {
      promptEl.innerHTML = `<kbd>E</kbd> Talk to ${near.def.name}`;
      promptEl.style.display = 'block';
      if (input.hit('KeyE')) startTalk(near);
    } else promptEl.style.display = 'none';

    // Shards
    const t = now / 1000;
    for (const s of shards) {
      if (s.taken) continue;
      s.mesh.rotation.y = t * 1.5;
      s.mesh.position.y = groundHeight(s.pos.x, s.pos.z) + 1.2 + Math.sin(t * 2 + s.pos.x) * 0.15;
      (s.mesh.material as THREE.MeshLambertMaterial).emissiveIntensity = shardMatGlow;
      if (Math.hypot(s.pos.x - player.pos.x, s.pos.z - player.pos.z) < 1.4 && Math.abs(s.mesh.position.y - player.pos.y - 1) < 2.2) {
        s.taken = true;
        s.mesh.visible = s.beam.visible = false;
        state.shards++;
        state.toast(state.quest === 'none' ? 'Found a strange glowing crystal' : `Glowshard ${Math.min(state.shards, SHARDS_NEEDED)}/${SHARDS_NEEDED}`);
        updateQuestLog();
      }
    }
  }

  updateCamera(dt, dialogue.active || paused);

  // Shadow camera follows the player; snap to texels to prevent shimmering.
  const texel = 90 / sun.shadow.mapSize.x;
  const fx = Math.round(player.pos.x / texel) * texel, fz = Math.round(player.pos.z / texel) * texel;
  sun.target.position.set(fx, player.pos.y, fz);
  sun.position.set(fx + lightDir.x * 120, player.pos.y + lightDir.y * 120, fz + lightDir.z * 120);
  sky.position.copy(camera.position);
  sunDisc.position.copy(camera.position).addScaledVector(sunDir, skyRadius * 0.9);
  sunDisc.lookAt(camera.position);
  moonDisc.position.copy(camera.position).addScaledVector(sunDir, -skyRadius * 0.9);
  moonDisc.lookAt(camera.position);

  const logicMs = performance.now() - cpuStart;
  renderer.render(scene, camera);
  updateLabels();
  if (++mapTick % 3 === 0) drawMinimap();

  if (toastTimer > 0 && (toastTimer -= dt) <= 0) toastEl.classList.remove('show');

  // FPS + adaptive resolution: if we're consistently slow, render fewer pixels.
  frames++; fpsTime += realDt; logicAcc += logicMs;
  if (fpsTime >= 1) {
    fps = frames / fpsTime; const logicAvg = logicAcc / frames; frames = 0; fpsTime = 0; logicAcc = 0;
    if (started && fps < 30) slowTime++; else slowTime = 0;
    if (slowTime >= 3 && renderScale > 0.55) {
      renderScale = Math.max(0.55, renderScale - 0.15);
      applyQuality(false);
      slowTime = 0;
    }
    const info = renderer.info.render;
    statsEl.textContent = `${fps.toFixed(0)} fps  ${QUALITIES[qIndex].name} @${(renderScale * 100).toFixed(0)}%\ndraw calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  logic ${logicAvg.toFixed(2)}ms`;
  }

  input.endFrame();
}
requestAnimationFrame(frame);

// Handy for debugging from the browser console.
(window as unknown as Record<string, unknown>).game = { player, npcs, shards, state, setTime: (t: number) => { dayTime = t; } };
