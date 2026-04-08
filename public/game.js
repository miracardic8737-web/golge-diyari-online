// ═══════════════════════════════════════════════════════════════
// SHADOWREALM ONLINE — game.js
// Dark Fantasy MMORPG · Three.js ES Module
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

// ─── COORDINATE HELPERS ──────────────────────────────────────────────────────
const MAP_W = 3200, MAP_H = 3200;
const toWorld = (sx, sy) => ({ x: (sx - 1600) / 10, z: (sy - 1600) / 10 });
const toServer = (wx, wz) => ({ x: wx * 10 + 1600, y: wz * 10 + 1600 });

// ─── STATE ────────────────────────────────────────────────────────────────────
const socket = window.io();
let myId = null;
let myClass = 'warrior';
let myName = 'Kahraman';
let myData = { hp: 200, maxHp: 200, mp: 100, maxMp: 100, exp: 0, expNeeded: 100, level: 1 };
const playerMeshes = {};
const monsterMeshes = {};
const keys = {};
let chatOpen = false;
let lastMoveEmit = 0;
const skillCooldowns = [0, 0, 0, 0];
const SKILL_CDS = [600, 3000, 6000, 2000];
const attackFlashes = [];
const damageNumbers = [];

// ─── RENDERER ─────────────────────────────────────────────────────────────────
const container = document.getElementById('threeContainer');
const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;

const renderer = new THREE.WebGLRenderer({
  antialias: !isMobileDevice, // mobilde antialias kapat
  powerPreference: 'high-performance'
});
// Mobilde pixelRatio 1'de tut, masaüstünde max 2
renderer.setPixelRatio(isMobileDevice ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !isMobileDevice; // mobilde gölge kapat
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
container.appendChild(renderer.domElement);

// ─── SCENE ────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0814);
// Mobilde fog daha yoğun yap → daha az nesne render edilir
scene.fog = new THREE.FogExp2(0x0d0a1e, isMobileDevice ? 0.018 : 0.008);

// ─── CAMERA ───────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
const CAM_OFFSET = new THREE.Vector3(0, 45, 40);
let camTarget = new THREE.Vector3();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── LIGHTING ─────────────────────────────────────────────────────────────────
// Moonlight
const moonLight = new THREE.DirectionalLight(0x8899cc, 1.2);
moonLight.position.set(60, 100, 40);
moonLight.castShadow = !isMobileDevice;
moonLight.shadow.mapSize.set(isMobileDevice ? 512 : 4096, isMobileDevice ? 512 : 4096);
moonLight.shadow.camera.near = 1;
moonLight.shadow.camera.far = 500;
moonLight.shadow.camera.left = -180;
moonLight.shadow.camera.right = 180;
moonLight.shadow.camera.top = 180;
moonLight.shadow.camera.bottom = -180;
moonLight.shadow.bias = -0.0003;
scene.add(moonLight);

// Ambient
const ambient = new THREE.AmbientLight(0x1a1428, 1.5);
scene.add(ambient);

// Hemisphere
const hemi = new THREE.HemisphereLight(0x334466, 0x1a1a0a, 0.8);
scene.add(hemi);

// Atmosphere point lights — mobilde kapat (büyük performans kazancı)
if (!isMobileDevice) {
  const atmLights = [
    { color: 0x2244aa, pos: [-80, 8, -60], intensity: 1.2, range: 60 },
    { color: 0x6622aa, pos: [70, 6, 80],   intensity: 1.0, range: 55 },
    { color: 0xaa4400, pos: [-60, 5, 90],  intensity: 0.9, range: 50 },
    { color: 0x224488, pos: [90, 7, -70],  intensity: 1.1, range: 58 },
    { color: 0x441166, pos: [0, 6, -100],  intensity: 0.8, range: 45 },
  ];
  atmLights.forEach(({ color, pos, intensity, range }) => {
    const l = new THREE.PointLight(color, intensity, range);
    l.position.set(...pos);
    scene.add(l);
  });
}

// ─── TERRAIN ──────────────────────────────────────────────────────────────────
function heightAt(x, z) {
  const nx = x / 320, nz = z / 320;
  return Math.sin(nx * 12) * Math.cos(nz * 9) * 1.8
       + Math.sin(nx * 5 + nz * 7) * 2.8
       + Math.cos(nx * 20 + nz * 15) * 0.6
       + Math.sin(nx * 3 - nz * 4) * 1.2;
}

function buildTerrain() {
  const W = 320, segs = isMobileDevice ? 30 : 100;
  const geo = new THREE.PlaneGeometry(W, W, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    // Vertex colors: dark greens, browns, grey for rocky
    const t = (h + 5) / 10;
    const rocky = Math.abs(Math.sin(x * 0.3) * Math.cos(z * 0.25)) > 0.6;
    if (rocky) {
      colors.push(0.22 + t * 0.1, 0.20 + t * 0.08, 0.24 + t * 0.1); // grey-purple
    } else if (t > 0.65) {
      colors.push(0.28 + t * 0.12, 0.22 + t * 0.1, 0.14 + t * 0.06); // brown
    } else {
      colors.push(0.08 + t * 0.12, 0.18 + t * 0.18, 0.06 + t * 0.08); // dark green
    }
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);
  return mesh;
}
buildTerrain();

// ─── ENVIRONMENT HELPERS ──────────────────────────────────────────────────────
const rng = (a, b) => a + Math.random() * (b - a);
function randPos(margin = 20) {
  return { x: rng(-160 + margin, 160 - margin), z: rng(-160 + margin, 160 - margin) };
}

// Statik nesne ekle: matrixAutoUpdate kapat, frustumCulled aç
function addStatic(mesh) {
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.frustumCulled = true;
  scene.add(mesh);
  return mesh;
}

// ─── TREES (250) ──────────────────────────────────────────────────────────────
{
  const treeCount = isMobileDevice ? 60 : 250;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1, 5);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3d2010 });
  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  trunkInst.castShadow = !isMobileDevice;
  trunkInst.frustumCulled = true;
  scene.add(trunkInst);

  const canopyGeo = new THREE.ConeGeometry(1, 1, isMobileDevice ? 5 : 7);
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x0d2b1a });
  const canopyInst = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount * 2);
  canopyInst.castShadow = !isMobileDevice;
  canopyInst.frustumCulled = true;
  scene.add(canopyInst);

  const dummy = new THREE.Object3D();
  for (let i = 0; i < treeCount; i++) {
    const p = randPos(5);
    const ty = heightAt(p.x, p.z);
    const trunkH = rng(2, 4);
    const sc = rng(0.7, 1.4);

    // Trunk
    dummy.position.set(p.x, ty + trunkH * sc / 2, p.z);
    dummy.scale.set(sc, trunkH * sc, sc);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    // Canopy layers (2 per tree for instanced)
    for (let c = 0; c < 2; c++) {
      const ch = rng(2, 4) * sc;
      const cr = rng(1.2, 2.2) * sc * (1 - c * 0.2);
      dummy.position.set(p.x, ty + trunkH * sc + c * ch * 0.5 + ch / 2 - 0.3, p.z);
      dummy.scale.set(cr, ch, cr);
      dummy.rotation.y = rng(0, Math.PI);
      dummy.updateMatrix();
      canopyInst.setMatrixAt(i * 2 + c, dummy.matrix);
    }
  }
  trunkInst.instanceMatrix.needsUpdate = true;
  canopyInst.instanceMatrix.needsUpdate = true;
}

// ─── ROCKS (100) ──────────────────────────────────────────────────────────────
{
  const rockCount = isMobileDevice ? 25 : 100;
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x4a4a5a });
  const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rockInst.castShadow = !isMobileDevice;
  rockInst.frustumCulled = true;
  scene.add(rockInst);

  const dummy = new THREE.Object3D();
  for (let i = 0; i < rockCount; i++) {
    const p = randPos(5);
    const ty = heightAt(p.x, p.z);
    const s = rng(0.3, 1.4);
    dummy.position.set(p.x, ty + s * 0.4, p.z);
    dummy.scale.set(s * rng(0.8, 1.2), s * rng(0.6, 1.0), s * rng(0.8, 1.2));
    dummy.rotation.set(rng(0, Math.PI), rng(0, Math.PI), rng(0, Math.PI));
    dummy.updateMatrix();
    rockInst.setMatrixAt(i, dummy.matrix);
  }
  rockInst.instanceMatrix.needsUpdate = true;
}

// ─── STONE PILLARS (30) ───────────────────────────────────────────────────────
{
  const pillarCount = isMobileDevice ? 6 : 30;
  const pillarGeo = new THREE.CylinderGeometry(0.55, 0.65, 1, 7);
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x2d3a2d });
  const pillarInst = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarCount);
  pillarInst.castShadow = !isMobileDevice;
  pillarInst.frustumCulled = true;
  scene.add(pillarInst);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < pillarCount; i++) {
    const p = randPos(10);
    const ty = heightAt(p.x, p.z);
    const h = rng(4, 10);
    dummy.position.set(p.x, ty + h / 2, p.z);
    dummy.scale.set(1, h, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    pillarInst.setMatrixAt(i, dummy.matrix);
  }
  pillarInst.instanceMatrix.needsUpdate = true;
}

// ─── TORCHES (40) ─────────────────────────────────────────────────────────────
const torchObjects = [];
for (let i = 0; i < (isMobileDevice ? 15 : 40); i++) {
  const p = randPos(8);
  const ty = heightAt(p.x, p.z);
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 2.0, 5),
    new THREE.MeshLambertMaterial({ color: 0x3d2010 })
  );
  stick.position.set(p.x, ty + 1.0, p.z);
  stick.castShadow = !isMobileDevice;
  addStatic(stick);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.42, 6),
    new THREE.MeshBasicMaterial({ color: 0xff8800 })
  );
  flame.position.set(p.x, ty + 2.15, p.z);
  scene.add(flame); // flame animasyonlu, static değil
  // Mobilde torch ışığı kapat
  if (!isMobileDevice) {
    const light = new THREE.PointLight(0xff6600, 2.0, 15);
    light.position.set(p.x, ty + 2.3, p.z);
    scene.add(light);
    torchObjects.push({ flame, light, baseY: ty + 2.15, baseIntensity: 2.0 });
  } else {
    torchObjects.push({ flame, light: null, baseY: ty + 2.15, baseIntensity: 2.0 });
  }
}

// ─── MAGICAL CRYSTALS (20) ────────────────────────────────────────────────────
const crystalObjects = [];
const crystalColors = [0x4488ff, 0x8844ff, 0x44ffcc, 0xaa44ff, 0x2266ff];
for (let i = 0; i < (isMobileDevice ? 6 : 20); i++) {
  const p = randPos(12);
  const ty = heightAt(p.x, p.z);
  const col = crystalColors[i % crystalColors.length];
  const h = rng(1.5, 3.5);
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(rng(0.3, 0.6), 0),
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.3 })
  );
  crystal.scale.set(rng(0.5, 1.0), h, rng(0.5, 1.0));
  crystal.position.set(p.x, ty + h * 0.5, p.z);
  crystal.rotation.y = rng(0, Math.PI);
  crystal.castShadow = !isMobileDevice;
  addStatic(crystal);
  // Mobilde kristal ışığı kapat
  if (!isMobileDevice) {
    const cLight = new THREE.PointLight(col, 1.5, 12);
    cLight.position.set(p.x, ty + h * 0.5, p.z);
    scene.add(cLight);
    crystalObjects.push({ crystal, light: cLight, baseEmissive: 0.6 });
  } else {
    crystalObjects.push({ crystal, light: null, baseEmissive: 0.6 });
  }
}

// ─── GRASS PATCHES ────────────────────────────────────────────────────────────
const grassMat = new THREE.MeshBasicMaterial({ color: 0x0d2010, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
if (!isMobileDevice) {
  for (let i = 0; i < 300; i++) {
  const p = randPos(3);
  const ty = heightAt(p.x, p.z);
  for (let g = 0; g < 4; g++) {
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(rng(0.3, 0.7), rng(0.4, 0.9)), grassMat);
    blade.position.set(p.x + rng(-0.5, 0.5), ty + 0.2, p.z + rng(-0.5, 0.5));
    blade.rotation.y = rng(0, Math.PI);
    scene.add(blade);
  }
}
}

// ─── LABEL / HP BAR SPRITES ───────────────────────────────────────────────────
function makeLabel(name, hp, maxHp, nameColor = '#ffd700') {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 80);
  // Name shadow
  ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
  ctx.fillStyle = nameColor;
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(name, 128, 22);
  ctx.shadowBlur = 0;
  // HP bar background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(24, 30, 208, 16);
  // HP bar fill gradient
  const pct = Math.max(0, Math.min(1, hp / maxHp));
  const grad = ctx.createLinearGradient(24, 0, 232, 0);
  if (pct > 0.5) { grad.addColorStop(0, '#166534'); grad.addColorStop(1, '#22c55e'); }
  else if (pct > 0.25) { grad.addColorStop(0, '#92400e'); grad.addColorStop(1, '#f59e0b'); }
  else { grad.addColorStop(0, '#7f1d1d'); grad.addColorStop(1, '#ef4444'); }
  ctx.fillStyle = grad;
  ctx.fillRect(24, 30, 208 * pct, 16);
  // HP bar border
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(24, 30, 208, 16);
  // HP text
  ctx.fillStyle = '#fff';
  ctx.font = '11px Arial';
  ctx.fillText(`${Math.ceil(hp)} / ${maxHp}`, 128, 43);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.5, 1.4, 1);
  return sprite;
}

function updateLabel(sprite, name, hp, maxHp, nameColor = '#ffd700') {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 80);
  ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
  ctx.fillStyle = nameColor;
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(name, 128, 22);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(24, 30, 208, 16);
  const pct = Math.max(0, Math.min(1, hp / maxHp));
  const grad = ctx.createLinearGradient(24, 0, 232, 0);
  if (pct > 0.5) { grad.addColorStop(0, '#166534'); grad.addColorStop(1, '#22c55e'); }
  else if (pct > 0.25) { grad.addColorStop(0, '#92400e'); grad.addColorStop(1, '#f59e0b'); }
  else { grad.addColorStop(0, '#7f1d1d'); grad.addColorStop(1, '#ef4444'); }
  ctx.fillStyle = grad;
  ctx.fillRect(24, 30, 208 * pct, 16);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(24, 30, 208, 16);
  ctx.fillStyle = '#fff';
  ctx.font = '11px Arial';
  ctx.fillText(`${Math.ceil(hp)} / ${maxHp}`, 128, 43);
  sprite.material.map.dispose();
  sprite.material.map = new THREE.CanvasTexture(canvas);
  sprite.material.needsUpdate = true;
}

// ─── CHARACTER MESHES ─────────────────────────────────────────────────────────
const CLASS_LIGHT_COLORS = { warrior: 0xff4422, mage: 0x8844ff, archer: 0x22cc66, assassin: 0x334455 };

function buildCharacterMesh(cls) {
  const g = new THREE.Group();

  if (cls === 'warrior') {
    // Legs
    const legMat = new THREE.MeshLambertMaterial({ color: 0x1a1a3a });
    [-0.24, 0.24].forEach(lx => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.75, 0.32), legMat);
      leg.position.set(lx, 0.52, 0); leg.castShadow = true; g.add(leg);
    });
    // Body (armor)
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8b0000 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.05, 0.52), bodyMat);
    body.position.y = 1.25; body.castShadow = true; g.add(body);
    // Belt
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.14, 0.54), new THREE.MeshLambertMaterial({ color: 0x8b6914 }));
    belt.position.y = 0.88; g.add(belt);
    // Pauldrons (shoulder armor)
    const pMat = new THREE.MeshLambertMaterial({ color: 0xcc2222 });
    [-0.58, 0.58].forEach(px => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.42), pMat);
      p.position.set(px, 1.72, 0); p.castShadow = true; g.add(p);
    });
    // Arms (wider)
    const armMat = new THREE.MeshLambertMaterial({ color: 0x8b0000 });
    [-0.68, 0.68].forEach(ax => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.72, 0.28), armMat);
      arm.position.set(ax, 1.22, 0); arm.castShadow = true; g.add(arm);
    });
    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), new THREE.MeshLambertMaterial({ color: 0xffcc99 }));
    head.position.y = 2.08; head.castShadow = true; g.add(head);
    // Helmet
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.38, 0.68), new THREE.MeshLambertMaterial({ color: 0xcc2222 }));
    helm.position.y = 2.52; helm.castShadow = true; g.add(helm);
    // Visor slit
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.06), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    visor.position.set(0, 2.46, 0.35); g.add(visor);
    // Gold trim on helmet
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.06, 0.70), new THREE.MeshLambertMaterial({ color: 0xd4a017 }));
    trim.position.y = 2.34; g.add(trim);
    // Sword (right hand)
    const guardMat = new THREE.MeshLambertMaterial({ color: 0xd4a017 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.06), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
    blade.position.set(0.95, 1.5, 0); blade.castShadow = true; g.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.1), guardMat);
    guard.position.set(0.95, 0.88, 0); g.add(guard);
    // Shield (left arm)
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.52), new THREE.MeshLambertMaterial({ color: 0x8b0000 }));
    shield.position.set(-0.95, 1.2, 0); shield.castShadow = true; g.add(shield);
    const shieldBoss = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), guardMat);
    shieldBoss.position.set(-0.95, 1.2, 0.28); g.add(shieldBoss);

  } else if (cls === 'mage') {
    // Legs (robe bottom)
    const robeMat = new THREE.MeshLambertMaterial({ color: 0x2d0a5e });
    const robeBot = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.9, 0.52), robeMat);
    robeBot.position.y = 0.55; robeBot.castShadow = true; g.add(robeBot);
    // Robe sides (flowing)
    [-0.44, 0.44].forEach(rx => {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.8, 0.48), new THREE.MeshLambertMaterial({ color: 0x3d0a7a }));
      side.position.set(rx, 0.5, 0); g.add(side);
    });
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.0, 0.48), new THREE.MeshLambertMaterial({ color: 0x3d0a7a }));
    body.position.y = 1.3; body.castShadow = true; g.add(body);
    // Robe trim
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.08, 0.50), new THREE.MeshLambertMaterial({ color: 0xd4a017 }));
    trim.position.y = 0.82; g.add(trim);
    // Arms
    [-0.58, 0.58].forEach(ax => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.68, 0.24), new THREE.MeshLambertMaterial({ color: 0x3d0a7a }));
      arm.position.set(ax, 1.28, 0); arm.castShadow = true; g.add(arm);
    });
    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.58, 0.58), new THREE.MeshLambertMaterial({ color: 0xffcc99 }));
    head.position.y = 2.06; head.castShadow = true; g.add(head);
    // Beard
    const beard = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.12), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    beard.position.set(0, 1.82, 0.28); g.add(beard);
    // Pointed hat
    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.1, 8), new THREE.MeshLambertMaterial({ color: 0x1a0040 }));
    hatBrim.position.y = 2.42; g.add(hatBrim);
    const hatCone = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.1, 8), new THREE.MeshLambertMaterial({ color: 0x1a0040 }));
    hatCone.position.y = 3.02; g.add(hatCone);
    // Hat star
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: 0xffd700 }));
    star.position.y = 3.62; g.add(star);
    // Staff
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 6), new THREE.MeshLambertMaterial({ color: 0x5c3a1e }));
    staff.position.set(0.82, 1.6, 0); staff.castShadow = true; g.add(staff);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), new THREE.MeshStandardMaterial({ color: 0x4488ff, emissive: 0x2244ff, emissiveIntensity: 1.0, roughness: 0.1 }));
    orb.position.set(0.82, 2.68, 0); g.add(orb);
    const orbLight = new THREE.PointLight(0x4488ff, 1.5, 8);
    orbLight.position.set(0.82, 2.68, 0); g.add(orbLight);

  } else if (cls === 'archer') {
    // Legs
    const legMat = new THREE.MeshLambertMaterial({ color: 0x3d2a10 });
    [-0.22, 0.22].forEach(lx => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.72, 0.28), legMat);
      leg.position.set(lx, 0.5, 0); leg.castShadow = true; g.add(leg);
    });
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.98, 0.44), new THREE.MeshLambertMaterial({ color: 0x4a6a28 }));
    body.position.y = 1.22; body.castShadow = true; g.add(body);
    // Arms with bracers
    [-0.56, 0.56].forEach(ax => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.68, 0.24), new THREE.MeshLambertMaterial({ color: 0x4a6a28 }));
      arm.position.set(ax, 1.22, 0); arm.castShadow = true; g.add(arm);
      const bracer = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.26), new THREE.MeshLambertMaterial({ color: 0x5c3a1e }));
      bracer.position.set(ax, 0.92, 0); g.add(bracer);
    });
    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.56), new THREE.MeshLambertMaterial({ color: 0xffcc99 }));
    head.position.y = 2.02; head.castShadow = true; g.add(head);
    // Hood
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), new THREE.MeshLambertMaterial({ color: 0x2d4a18 }));
    hood.position.y = 2.18; g.add(hood);
    // Quiver on back
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 6), new THREE.MeshLambertMaterial({ color: 0x5c3a1e }));
    quiver.position.set(-0.3, 1.4, -0.32); quiver.rotation.z = 0.2; g.add(quiver);
    for (let a = 0; a < 3; a++) {
      const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4), new THREE.MeshLambertMaterial({ color: 0x8b6914 }));
      arrow.position.set(-0.28 + a * 0.04, 1.75, -0.32); g.add(arrow);
    }
    // Bow
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 6, 14, Math.PI), new THREE.MeshLambertMaterial({ color: 0x5c3a1e }));
    bow.position.set(0.82, 1.4, 0); bow.rotation.z = Math.PI / 2; bow.castShadow = true; g.add(bow);
    // Bowstring
    const strGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.42, 0), new THREE.Vector3(0, -0.42, 0)]);
    const bowStr = new THREE.Line(strGeo, new THREE.LineBasicMaterial({ color: 0xdddddd }));
    bowStr.position.set(0.82, 1.4, 0); g.add(bowStr);

  } else if (cls === 'assassin') {
    // Slim legs
    const legMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    [-0.20, 0.20].forEach(lx => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.72, 0.26), legMat);
      leg.position.set(lx, 0.5, 0); leg.castShadow = true; g.add(leg);
    });
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.96, 0.40), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
    body.position.y = 1.2; body.castShadow = true; g.add(body);
    // Cloak (angled planes behind)
    const cloakMat = new THREE.MeshLambertMaterial({ color: 0x0d0d0d, side: THREE.DoubleSide });
    const cloak = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.4), cloakMat);
    cloak.position.set(0, 1.1, -0.28); g.add(cloak);
    const cloakL = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.2), cloakMat);
    cloakL.position.set(-0.5, 1.0, -0.2); cloakL.rotation.y = 0.4; g.add(cloakL);
    const cloakR = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.2), cloakMat);
    cloakR.position.set(0.5, 1.0, -0.2); cloakR.rotation.y = -0.4; g.add(cloakR);
    // Arms
    [-0.52, 0.52].forEach(ax => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.66, 0.22), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
      arm.position.set(ax, 1.2, 0); arm.castShadow = true; g.add(arm);
    });
    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.54, 0.54), new THREE.MeshLambertMaterial({ color: 0xffcc99 }));
    head.position.y = 2.0; head.castShadow = true; g.add(head);
    // Mask (face plate)
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.08), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    mask.position.set(0, 1.96, 0.3); g.add(mask);
    // Mask eye slits
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    [-0.12, 0.12].forEach(ex => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.06), eyeMat);
      eye.position.set(ex, 2.0, 0.35); g.add(eye);
    });
    // Hood
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshLambertMaterial({ color: 0x0d0d0d }));
    hood.position.y = 2.14; g.add(hood);
    // Dual daggers
    const dagMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const dagHandleMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    [0.78, -0.78].forEach((dx, i) => {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.7, 0.05), dagMat);
      blade.position.set(dx, 1.3, 0); blade.castShadow = true; g.add(blade);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.09), dagHandleMat);
      handle.position.set(dx, 0.98, 0); g.add(handle);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.08), dagMat);
      guard.position.set(dx, 1.1, 0); g.add(guard);
    });
  }

  // Self-illumination point light
  const selfLight = new THREE.PointLight(CLASS_LIGHT_COLORS[cls] || 0xffffff, 0.4, 3);
  selfLight.position.y = 1.5;
  g.add(selfLight);

  g.userData.idlePhase = Math.random() * Math.PI * 2;
  g.userData.attackTimer = 0;
  return g;
}

// ─── MONSTER MESHES ───────────────────────────────────────────────────────────
const MONSTER_AURA_COLORS = {
  goblin: 0x22aa44,
  orc: 0x446622,
  skeleton: 0xaaaacc,
  dark_mage: 0x6622aa,
  dragon_boss: 0xff4400,
};

function buildMonsterMesh(type) {
  const g = new THREE.Group();

  if (type === 'goblin') {
    // Small hunched creature
    const skinMat = new THREE.MeshLambertMaterial({ color: 0x3a7a2a });
    // Legs
    [-0.14, 0.14].forEach(lx => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.44, 0.2), new THREE.MeshLambertMaterial({ color: 0x2a5a1a }));
      leg.position.set(lx, 0.32, 0.06); leg.castShadow = true; g.add(leg);
    });
    // Body (hunched)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.58, 0.38), skinMat);
    body.position.set(0, 0.78, 0.08); body.rotation.x = 0.25; body.castShadow = true; g.add(body);
    // Arms
    [-0.36, 0.36].forEach(ax => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), skinMat);
      arm.position.set(ax, 0.72, 0.1); arm.castShadow = true; g.add(arm);
    });
    // Head (big)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.48, 0.48), skinMat);
    head.position.set(0, 1.28, 0.1); head.castShadow = true; g.add(head);
    // Big ears
    [-0.32, 0.32].forEach(ex => {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 5), new THREE.MeshLambertMaterial({ color: 0x2a5a1a }));
      ear.position.set(ex, 1.52, 0.1); ear.rotation.z = ex < 0 ? -0.4 : 0.4; g.add(ear);
    });
    // Beady red eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    [-0.12, 0.12].forEach(ex => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), eyeMat);
      eye.position.set(ex, 1.32, 0.26); g.add(eye);
    });
    // Club
    const clubHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 5), new THREE.MeshLambertMaterial({ color: 0x5c3a1e }));
    clubHandle.position.set(0.5, 0.9, 0.1); clubHandle.rotation.z = 0.4; clubHandle.castShadow = true; g.add(clubHandle);
    const clubHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), new THREE.MeshLambertMaterial({ color: 0x4a3a2a }));
    clubHead.position.set(0.72, 1.22, 0.1); g.add(clubHead);

  } else if (type === 'orc') {
    // Large muscular humanoid
    const skinMat = new THREE.MeshLambertMaterial({ color: 0x4a6a2a });
    // Legs
    [-0.32, 0.32].forEach(lx => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.88, 0.42), new THREE.MeshLambertMaterial({ color: 0x3a5a1a }));
      leg.position.set(lx, 0.54, 0); leg.castShadow = true; g.add(leg);
    });
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.62), skinMat);
    body.position.y = 1.38; body.castShadow = true; g.add(body);
    // Armor plates on chest
    const plateMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.12), plateMat);
    chest.position.set(0, 1.5, 0.34); g.add(chest);
    // Arms (thick)
    [-0.78, 0.78].forEach(ax => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.88, 0.36), skinMat);
      arm.position.set(ax, 1.38, 0); arm.castShadow = true; g.add(arm);
    });
    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.68, 0.68), skinMat);
    head.position.y = 2.12; head.castShadow = true; g.add(head);
    // Tusks (white cones)
    const tuskMat = new THREE.MeshLambertMaterial({ color: 0xeeeecc });
    [-0.18, 0.18].forEach(tx => {
      const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 5), tuskMat);
      tusk.position.set(tx, 1.88, 0.36); tusk.rotation.x = 0.3; g.add(tusk);
    });
    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
    [-0.18, 0.18].forEach(ex => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), eyeMat);
      eye.position.set(ex, 2.2, 0.36); g.add(eye);
    });
    // Axe
    const axeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), new THREE.MeshLambertMaterial({ color: 0x5c3a1e }));
    axeHandle.position.set(1.0, 1.5, 0); axeHandle.castShadow = true; g.add(axeHandle);
    const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.5), new THREE.MeshLambertMaterial({ color: 0x888888 }));
    axeHead.position.set(1.0, 2.1, 0); g.add(axeHead);

  } else if (type === 'skeleton') {
    // White/grey bones
    const boneMat = new THREE.MeshLambertMaterial({ color: 0xddddcc });
    const darkBone = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    // Legs (thin)
    [-0.18, 0.18].forEach(lx => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.16), boneMat);
      leg.position.set(lx, 0.46, 0); leg.castShadow = true; g.add(leg);
      // Knee joint
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), darkBone);
      knee.position.set(lx, 0.82, 0); g.add(knee);
    });
    // Pelvis
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.2, 0.28), boneMat);
    pelvis.position.y = 0.92; g.add(pelvis);
    // Rib cage (multiple thin boxes)
    for (let r = 0; r < 4; r++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.1, 0.36), boneMat);
      rib.position.y = 1.12 + r * 0.18; g.add(rib);
    }
    // Spine
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), boneMat);
    spine.position.y = 1.2; g.add(spine);
    // Arms (thin)
    [-0.44, 0.44].forEach(ax => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.68, 0.14), boneMat);
      arm.position.set(ax, 1.38, 0); arm.castShadow = true; g.add(arm);
    });
    // Skull
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.52), boneMat);
    skull.position.y = 2.06; skull.castShadow = true; g.add(skull);
    // Jaw
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.28), boneMat);
    jaw.position.set(0, 1.82, 0.1); g.add(jaw);
    // Glowing eye sockets
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x44ffaa });
    [-0.14, 0.14].forEach(ex => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), eyeMat);
      eye.position.set(ex, 2.1, 0.28); g.add(eye);
    });
    // Sword
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.06), new THREE.MeshLambertMaterial({ color: 0x999999 }));
    sword.position.set(0.72, 1.5, 0); sword.castShadow = true; g.add(sword);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.1), new THREE.MeshLambertMaterial({ color: 0x777777 }));
    guard.position.set(0.72, 0.98, 0); g.add(guard);

  } else if (type === 'dark_mage') {
    // Robed figure
    const robeMat = new THREE.MeshLambertMaterial({ color: 0x1a0030 });
    const robeBot = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.88, 0.48), robeMat);
    robeBot.position.y = 0.54; robeBot.castShadow = true; g.add(robeBot);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.96, 0.44), new THREE.MeshLambertMaterial({ color: 0x220044 }));
    body.position.y = 1.28; body.castShadow = true; g.add(body);
    [-0.52, 0.52].forEach(ax => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.64, 0.22), robeMat);
      arm.position.set(ax, 1.26, 0); arm.castShadow = true; g.add(arm);
    });
    // Head (skull-like)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.54, 0.54), new THREE.MeshLambertMaterial({ color: 0x2a1a3a }));
    head.position.y = 2.02; head.castShadow = true; g.add(head);
    // Hood
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 8, 0, Math.PI * 2, 0, Math.PI * 0.65), new THREE.MeshLambertMaterial({ color: 0x0d0020 }));
    hood.position.y = 2.18; g.add(hood);
    // Glowing purple eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xcc44ff });
    [-0.13, 0.13].forEach(ex => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), eyeMat);
      eye.position.set(ex, 2.08, 0.3); g.add(eye);
    });
    // Skull staff
    const staffMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 6), new THREE.MeshLambertMaterial({ color: 0x1a0a2a }));
    staffMesh.position.set(0.78, 1.6, 0); staffMesh.castShadow = true; g.add(staffMesh);
    const skullTop = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), new THREE.MeshLambertMaterial({ color: 0xddddcc }));
    skullTop.position.set(0.78, 2.68, 0); g.add(skullTop);
    const skullEyeMat = new THREE.MeshBasicMaterial({ color: 0xaa00ff });
    [-0.07, 0.07].forEach(ex => {
      const se = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 5), skullEyeMat);
      se.position.set(0.78 + ex, 2.72, 0.16); g.add(se);
    });
    // Floating dark orbs
    for (let o = 0; o < 3; o++) {
      const angle = (o / 3) * Math.PI * 2;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshStandardMaterial({ color: 0x440088, emissive: 0x220044, emissiveIntensity: 1.0 }));
      orb.position.set(Math.cos(angle) * 1.0, 1.6, Math.sin(angle) * 1.0);
      orb.userData.orbAngle = angle;
      orb.userData.orbRadius = 1.0;
      g.add(orb);
      g.userData['orb' + o] = orb;
    }

  } else if (type === 'dragon_boss') {
    // LARGE quadruped dragon
    const scaleMat = new THREE.MeshLambertMaterial({ color: 0x8b1a00 });
    const darkScaleMat = new THREE.MeshLambertMaterial({ color: 0x5a1000 });
    const s = 2.2; // scale factor
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2 * s, 1.0 * s, 1.0 * s), scaleMat);
    body.position.set(0, 1.4 * s, 0); body.castShadow = true; g.add(body);
    // Scale details on body (many small boxes)
    for (let sc = 0; sc < 16; sc++) {
      const sx2 = (sc % 4 - 1.5) * 0.5 * s;
      const sy2 = (Math.floor(sc / 4) % 2 - 0.5) * 0.3 * s;
      const scBox = new THREE.Mesh(new THREE.BoxGeometry(0.22 * s, 0.14 * s, 0.12 * s), darkScaleMat);
      scBox.position.set(sx2, 1.4 * s + sy2, 0.52 * s); g.add(scBox);
    }
    // Neck
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 1.2 * s, 0.7 * s), scaleMat);
    neck.position.set(1.2 * s, 2.0 * s, 0); neck.rotation.z = -0.4; neck.castShadow = true; g.add(neck);
    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 0.7 * s, 0.8 * s), scaleMat);
    head.position.set(2.0 * s, 2.8 * s, 0); head.castShadow = true; g.add(head);
    // Snout
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.6 * s, 0.4 * s, 0.7 * s), scaleMat);
    snout.position.set(2.6 * s, 2.6 * s, 0); g.add(snout);
    // Horns
    const hornMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    [-0.22 * s, 0.22 * s].forEach(hx => {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12 * s, 0.7 * s, 5), hornMat);
      horn.position.set(2.0 * s, 3.4 * s, hx); horn.rotation.z = hx < 0 ? -0.3 : 0.3; g.add(horn);
    });
    // Fire-colored eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
    [-0.2 * s, 0.2 * s].forEach(ex => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12 * s, 8, 8), eyeMat);
      eye.position.set(2.4 * s, 2.85 * s, ex); g.add(eye);
    });
    // 4 legs
    const legMat = new THREE.MeshLambertMaterial({ color: 0x6b1400 });
    [[-0.7 * s, 0.3 * s], [0.7 * s, 0.3 * s], [-0.7 * s, -0.3 * s], [0.7 * s, -0.3 * s]].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.44 * s, 1.0 * s, 0.44 * s), legMat);
      leg.position.set(lx, 0.6 * s, lz); leg.castShadow = true; g.add(leg);
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.12 * s, 0.3 * s, 4), hornMat);
      claw.position.set(lx, 0.08 * s, lz); claw.rotation.x = Math.PI; g.add(claw);
    });
    // Wings (angled planes)
    const wingMat = new THREE.MeshLambertMaterial({ color: 0x6b0a00, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    [-1, 1].forEach(side => {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(2.8 * s, 1.6 * s), wingMat);
      wing.position.set(0, 2.2 * s, side * 1.8 * s);
      wing.rotation.y = side * 0.5; wing.rotation.z = side * 0.3;
      wing.castShadow = true; g.add(wing);
      // Wing membrane detail
      const wingRib = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 1.8 * s, 0.06 * s), darkScaleMat);
      wingRib.position.set(0, 2.2 * s, side * 1.8 * s); wingRib.rotation.z = side * 0.3; g.add(wingRib);
    });
    // Tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.8 * s, 0.4 * s, 0.4 * s), scaleMat);
    tail.position.set(-1.6 * s, 1.2 * s, 0); tail.rotation.z = 0.2; tail.castShadow = true; g.add(tail);
    const tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.2 * s, 0.6 * s, 5), hornMat);
    tailTip.position.set(-2.6 * s, 1.0 * s, 0); tailTip.rotation.z = -Math.PI / 2; g.add(tailTip);
  }

  // Aura (BackSide sphere)
  const auraColor = MONSTER_AURA_COLORS[type] || 0xffffff;
  const auraSize = type === 'dragon_boss' ? 8.0 : 2.5;
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(auraSize, 12, 12),
    new THREE.MeshBasicMaterial({ color: auraColor, side: THREE.BackSide, transparent: true, opacity: 0.12 })
  );
  g.add(aura);
  g.userData.aura = aura;
  g.userData.idlePhase = Math.random() * Math.PI * 2;
  return g;
}

// ─── PLAYER / MONSTER MANAGEMENT ─────────────────────────────────────────────
let myMesh = null;

function getOrCreatePlayer(id, cls) {
  if (playerMeshes[id]) return playerMeshes[id];
  const mesh = buildCharacterMesh(cls || 'warrior');
  const label = makeLabel('...', 200, 200, '#ffe066');
  label.position.y = 3.8;
  mesh.add(label);
  scene.add(mesh);
  playerMeshes[id] = { mesh, label, hp: 200, maxHp: 200, name: '...', cls: cls || 'warrior' };
  return playerMeshes[id];
}

const MONSTER_LABEL_HEIGHT = { goblin: 2.8, orc: 3.8, skeleton: 3.2, dark_mage: 3.6, dragon_boss: 9.0 };

function getOrCreateMonster(id, type) {
  if (monsterMeshes[id]) return monsterMeshes[id];
  const mesh = buildMonsterMesh(type);
  const labelY = MONSTER_LABEL_HEIGHT[type] || 3.5;
  const label = makeLabel(type, 100, 100, '#ff8844');
  label.position.y = labelY;
  mesh.add(label);
  scene.add(mesh);
  monsterMeshes[id] = { mesh, label, hp: 100, maxHp: 100, name: type, type };
  return monsterMeshes[id];
}

function removePlayer(id) {
  if (playerMeshes[id]) { scene.remove(playerMeshes[id].mesh); delete playerMeshes[id]; }
}
function removeMonster(id) {
  if (monsterMeshes[id]) { scene.remove(monsterMeshes[id].mesh); delete monsterMeshes[id]; }
}

// ─── ATTACK FLASH RING ────────────────────────────────────────────────────────
function showAttackFlash(wx, wy, wz) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.8, 28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(wx, wy + 0.1, wz);
  scene.add(ring);
  attackFlashes.push({ ring, timer: 0.3 });
}

// ─── FLOATING DAMAGE NUMBERS ──────────────────────────────────────────────────
function spawnDamageNumber(dmg, wx, wz, isPlayer = false) {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; pointer-events:none; z-index:9999;
    font-size:${isPlayer ? '20px' : '24px'};
    font-weight:900;
    color:${isPlayer ? '#ff4444' : '#ffdd00'};
    text-shadow:0 0 6px #000, 0 2px 4px #000;
    transition:transform 1s ease-out, opacity 1s ease-out;
  `;
  el.textContent = (isPlayer ? '-' : '-') + dmg;
  const vec = new THREE.Vector3(wx, 2.5, wz);
  vec.project(camera);
  const sx = (vec.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-vec.y * 0.5 + 0.5) * window.innerHeight;
  el.style.left = sx + 'px';
  el.style.top = sy + 'px';
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = 'translateY(-70px) scale(0.8)';
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 1100);
}

// ─── SCREEN FLASH ─────────────────────────────────────────────────────────────
function screenFlash(type) {
  const el = document.getElementById('screenFlash');
  el.className = type;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 120);
  setTimeout(() => { el.className = ''; }, 300);
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
function showNotif(text, cls = '') {
  const area = document.getElementById('notifArea');
  const div = document.createElement('div');
  div.className = 'notif' + (cls ? ' ' + cls : '');
  div.textContent = text;
  area.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// ─── HUD UPDATE ───────────────────────────────────────────────────────────────
function updateHUD() {
  const d = myData;
  const hpPct = Math.max(0, Math.min(100, (d.hp / d.maxHp) * 100));
  const mpPct = Math.max(0, Math.min(100, (d.mp / d.maxMp) * 100));
  const expPct = Math.max(0, Math.min(100, (d.exp / d.expNeeded) * 100));
  document.getElementById('hpBar').style.width = hpPct + '%';
  document.getElementById('mpBar').style.width = mpPct + '%';
  document.getElementById('expBar').style.width = expPct + '%';
  document.getElementById('hpVal').textContent = `${Math.ceil(d.hp)}/${d.maxHp}`;
  document.getElementById('mpVal').textContent = `${Math.ceil(d.mp)}/${d.maxMp}`;
  document.getElementById('expVal').textContent = `${Math.floor(d.exp)}/${d.expNeeded}`;
  document.getElementById('charName').textContent = myName;
  document.getElementById('charLevel').textContent = 'Lv.' + d.level;
  document.getElementById('charAvatar').className = myClass + '-avatar';
}

// ─── MINIMAP ──────────────────────────────────────────────────────────────────
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

function drawMinimap(players, monsters) {
  const W = 150, H = 150;
  minimapCtx.fillStyle = '#060412';
  minimapCtx.fillRect(0, 0, W, H);
  // Grid lines
  minimapCtx.strokeStyle = '#1a0a30';
  minimapCtx.lineWidth = 0.5;
  for (let i = 1; i < 5; i++) {
    minimapCtx.beginPath();
    minimapCtx.moveTo(i * 30, 0); minimapCtx.lineTo(i * 30, H);
    minimapCtx.moveTo(0, i * 30); minimapCtx.lineTo(W, i * 30);
    minimapCtx.stroke();
  }
  // Monsters
  for (const m of monsters) {
    const mx = (m.x / MAP_W) * W;
    const my = (m.y / MAP_H) * H;
    minimapCtx.fillStyle = m.type === 'dragon_boss' ? '#ff6600' : '#cc2222';
    minimapCtx.beginPath();
    minimapCtx.arc(mx, my, m.type === 'dragon_boss' ? 4 : 2, 0, Math.PI * 2);
    minimapCtx.fill();
  }
  // Other players
  for (const p of players) {
    if (p.id === myId) continue;
    const px = (p.x / MAP_W) * W;
    const py = (p.y / MAP_H) * H;
    minimapCtx.fillStyle = '#4488ff';
    minimapCtx.beginPath();
    minimapCtx.arc(px, py, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }
  // Self
  if (myMesh) {
    const wp = toServer(myMesh.position.x, myMesh.position.z);
    const px = (wp.x / MAP_W) * W;
    const py = (wp.y / MAP_H) * H;
    // Direction line
    const dir = myMesh.rotation.y;
    minimapCtx.strokeStyle = '#ffff44';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.beginPath();
    minimapCtx.moveTo(px, py);
    minimapCtx.lineTo(px + Math.sin(dir) * 8, py - Math.cos(dir) * 8);
    minimapCtx.stroke();
    // Dot
    minimapCtx.fillStyle = '#ffff00';
    minimapCtx.beginPath();
    minimapCtx.arc(px, py, 4, 0, Math.PI * 2);
    minimapCtx.fill();
    // Camera viewport rect
    minimapCtx.strokeStyle = 'rgba(255,255,255,0.15)';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(px - 12, py - 12, 24, 24);
  }
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (chatOpen) return;
  keys[e.code] = true;
  if (e.code === 'Enter') {
    chatOpen = true;
    document.getElementById('chatInputRow').style.display = 'flex';
    document.getElementById('chatInput').focus();
    return;
  }
  const skillMap = { KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3 };
  if (skillMap[e.code] !== undefined) triggerSkill(skillMap[e.code]);
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

renderer.domElement.addEventListener('click', () => {
  if (!myMesh || chatOpen) return;
  triggerSkill(0);
});

// Chat
document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.code === 'Enter') {
    const msg = document.getElementById('chatInput').value.trim();
    if (msg) socket.emit('chat', msg);
    document.getElementById('chatInput').value = '';
    document.getElementById('chatInputRow').style.display = 'none';
    chatOpen = false;
  }
  if (e.code === 'Escape') {
    document.getElementById('chatInputRow').style.display = 'none';
    chatOpen = false;
  }
});
document.getElementById('chatSendBtn').addEventListener('click', () => {
  const msg = document.getElementById('chatInput').value.trim();
  if (msg) socket.emit('chat', msg);
  document.getElementById('chatInput').value = '';
  document.getElementById('chatInputRow').style.display = 'none';
  chatOpen = false;
});

// ─── MOBILE JOYSTICK ──────────────────────────────────────────────────────────
const joystickBase = document.getElementById('joystickBase');
const joystickThumb = document.getElementById('joystickThumb');
let joystickActive = false;
let joystickStartX = 0, joystickStartY = 0;
let joystickDX = 0, joystickDY = 0;
const JOYSTICK_MAX = 40;

joystickBase.addEventListener('touchstart', e => {
  e.preventDefault();
  joystickActive = true;
  const rect = joystickBase.getBoundingClientRect();
  joystickStartX = rect.left + rect.width / 2;
  joystickStartY = rect.top + rect.height / 2;
}, { passive: false });

joystickBase.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!joystickActive) return;
  const t = e.touches[0];
  let dx = t.clientX - joystickStartX;
  let dy = t.clientY - joystickStartY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > JOYSTICK_MAX) {
    dx = (dx / dist) * JOYSTICK_MAX;
    dy = (dy / dist) * JOYSTICK_MAX;
  }
  joystickDX = dx / JOYSTICK_MAX;
  joystickDY = dy / JOYSTICK_MAX;
  joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;
}, { passive: false });

joystickBase.addEventListener('touchend', e => {
  e.preventDefault();
  joystickActive = false;
  joystickDX = 0; joystickDY = 0;
  joystickThumb.style.transform = 'translate(0,0)';
}, { passive: false });

// Mobile skill buttons
document.getElementById('mobileAttackBtn').addEventListener('touchstart', e => {
  e.preventDefault(); triggerSkill(0);
}, { passive: false });
document.querySelectorAll('.mobileSkillBtn').forEach(btn => {
  btn.addEventListener('touchstart', e => {
    e.preventDefault();
    triggerSkill(parseInt(btn.dataset.skill));
  }, { passive: false });
});

// ─── SKILL TRIGGER ────────────────────────────────────────────────────────────
function triggerSkill(idx) {
  const now = Date.now();
  if (now < skillCooldowns[idx]) return;
  skillCooldowns[idx] = now + SKILL_CDS[idx];
  socket.emit('attack', { skill: idx });
  if (myMesh) showAttackFlash(myMesh.position.x, myMesh.position.y, myMesh.position.z);
  if (idx > 0) {
    const names = ['', 'Güçlü Vuruş!', 'Kasırga!', 'Gölge Adımı!'];
    showNotif(names[idx], idx === 3 ? 'exp' : '');
  }
  // Visual cooldown overlay
  const cdEl = document.getElementById('cd' + idx);
  if (cdEl) {
    const duration = SKILL_CDS[idx];
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 1 - elapsed / duration);
      cdEl.style.height = (pct * 100) + '%';
      if (pct > 0) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// ─── SOCKET EVENTS ────────────────────────────────────────────────────────────
socket.on('joined', (data) => {
  myId = socket.id;
  const p = data.player;
  myData.hp = p.hp; myData.maxHp = p.maxHp;
  myData.level = p.level; myData.exp = p.exp; myData.expNeeded = p.expNeeded || 100;
  myData.mp = 100; myData.maxMp = 100;
  const entry = getOrCreatePlayer(myId, myClass);
  myMesh = entry.mesh;
  const wp = toWorld(p.x, p.y);
  myMesh.position.set(wp.x, heightAt(wp.x, wp.z), wp.z);
  updateHUD();
  // Hide loading
  const overlay = document.getElementById('loadingOverlay');
  overlay.style.opacity = '0';
  setTimeout(() => { overlay.style.display = 'none'; }, 700);
  // Add system chat
  addChatMsg('system', 'Gölge Diyarı\'na hoş geldiniz!');
});

socket.on('state', (data) => {
  const { players, monsters } = data;
  const seenP = new Set();
  for (const p of players) {
    seenP.add(p.id);
    const entry = getOrCreatePlayer(p.id, p.class);
    const wp = toWorld(p.x, p.y);
    const ty = heightAt(wp.x, wp.z);
    if (p.id === myId) {
      // Server reconciliation (gentle)
      myMesh.position.x += (wp.x - myMesh.position.x) * 0.15;
      myMesh.position.z += (wp.z - myMesh.position.z) * 0.15;
      myMesh.position.y = ty;
    } else {
      entry.mesh.position.x += (wp.x - entry.mesh.position.x) * 0.2;
      entry.mesh.position.z += (wp.z - entry.mesh.position.z) * 0.2;
      entry.mesh.position.y = ty;
    }
    if (entry.hp !== p.hp || entry.maxHp !== p.maxHp || entry.name !== p.name) {
      entry.hp = p.hp; entry.maxHp = p.maxHp; entry.name = p.name;
      updateLabel(entry.label, p.name, p.hp, p.maxHp, p.id === myId ? '#ffe066' : '#ffffff');
    }
    if (p.id === myId) {
      myData.hp = p.hp; myData.maxHp = p.maxHp; myData.level = p.level;
      updateHUD();
    }
  }
  for (const id in playerMeshes) { if (!seenP.has(id)) removePlayer(id); }

  const seenM = new Set();
  for (const m of monsters) {
    seenM.add(m.id);
    const entry = getOrCreateMonster(m.id, m.type);
    const wp = toWorld(m.x, m.y);
    const ty = heightAt(wp.x, wp.z);
    entry.mesh.position.x += (wp.x - entry.mesh.position.x) * 0.18;
    entry.mesh.position.z += (wp.z - entry.mesh.position.z) * 0.18;
    entry.mesh.position.y = ty;
    if (entry.hp !== m.hp || entry.maxHp !== m.maxHp || entry.name !== m.name) {
      entry.hp = m.hp; entry.maxHp = m.maxHp; entry.name = m.name;
      updateLabel(entry.label, m.name, m.hp, m.maxHp, '#ff8844');
    }
  }
  for (const id in monsterMeshes) { if (!seenM.has(id)) removeMonster(id); }

  drawMinimap(players, monsters);
});

socket.on('damaged', (data) => {
  // Yükleme ekranı hâlâ görünüyorsa hasarı yoksay
  const overlay = document.getElementById('loadingOverlay');
  if (!myId || (overlay && overlay.style.display !== 'none' && overlay.style.opacity !== '0')) return;
  myData.hp = data.hp;
  updateHUD();
  if (myMesh) spawnDamageNumber(data.dmg, myMesh.position.x, myMesh.position.z, true);
  screenFlash('red');
  showNotif(`-${data.dmg} CAN`, 'dmg');
});

socket.on('expGain', (data) => {
  myData.exp = data.total;
  myData.expNeeded = data.needed;
  updateHUD();
  showNotif(`+${data.exp} DENEYİM`, 'exp');
});

socket.on('levelUp', (data) => {
  myData.level = data.level;
  myData.hp = data.hp; myData.maxHp = data.maxHp;
  updateHUD();
  screenFlash('gold');
  showNotif(`SEVİYE ATLADI! Seviye ${data.level}`, 'lvl');
  addChatMsg('system', `${myName} seviye ${data.level} oldu!`);
});

socket.on('hitResult', (hits) => {
  for (const hit of hits) {
    const entry = monsterMeshes[hit.id];
    if (entry) spawnDamageNumber(hit.dmg, entry.mesh.position.x, entry.mesh.position.z, false);
  }
});

socket.on('chat', (data) => {
  addChatMsg(data.name, data.msg);
});

function addChatMsg(name, msg) {
  const log = document.getElementById('chatLog');
  const p = document.createElement('p');
  if (name === 'system') {
    p.innerHTML = `<span class="sys">${msg}</span>`;
  } else {
    p.innerHTML = `<span class="cn">${name}:</span> ${msg}`;
  }
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
  // Keep max 50 messages
  while (log.children.length > 50) log.removeChild(log.firstChild);
}

// ─── MOVEMENT ─────────────────────────────────────────────────────────────────
const MOVE_SPEED = 0.3;
const tmpVec = new THREE.Vector3();

function processMovement(delta) {
  if (!myMesh) return;
  let dx = 0, dz = 0;

  // Keyboard
  if (keys['KeyW'] || keys['ArrowUp'])    dz -= 1;
  if (keys['KeyS'] || keys['ArrowDown'])  dz += 1;
  if (keys['KeyA'] || keys['ArrowLeft'])  dx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

  // Mobile joystick
  if (joystickActive) {
    dx += joystickDX;
    dz += joystickDY;
  }

  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 0.01) {
    dx /= len; dz /= len;
    const speed = MOVE_SPEED * delta * 60;
    myMesh.position.x += dx * speed;
    myMesh.position.z += dz * speed;
    // Clamp to world
    myMesh.position.x = Math.max(-155, Math.min(155, myMesh.position.x));
    myMesh.position.z = Math.max(-155, Math.min(155, myMesh.position.z));
    // Terrain snap
    myMesh.position.y = heightAt(myMesh.position.x, myMesh.position.z);
    // Face direction
    myMesh.rotation.y = Math.atan2(dx, dz);
    // Throttled emit
    const now = Date.now();
    if (now - lastMoveEmit > 80) {
      lastMoveEmit = now;
      const sp = toServer(myMesh.position.x, myMesh.position.z);
      socket.emit('move', { x: sp.x, y: sp.y, dir: myMesh.rotation.y });
    }
  }
}

// ─── CAMERA FOLLOW ────────────────────────────────────────────────────────────
function updateCamera() {
  if (!myMesh) return;
  const target = myMesh.position.clone().add(CAM_OFFSET);
  camera.position.lerp(target, 0.08);
  camTarget.lerp(myMesh.position, 0.1);
  camera.lookAt(camTarget);
}

// ─── MP REGEN ─────────────────────────────────────────────────────────────────
let mpRegenTimer = 0;
function regenMP(delta) {
  mpRegenTimer += delta;
  if (mpRegenTimer > 2.0) {
    mpRegenTimer = 0;
    if (myData.mp < myData.maxMp) {
      myData.mp = Math.min(myData.maxMp, myData.mp + 3);
      updateHUD();
    }
  }
}

// ─── ANIMATION LOOP ───────────────────────────────────────────────────────────
const clock = new THREE.Clock();
// Mobilde 30fps cap, masaüstünde sınırsız
const TARGET_FPS = isMobileDevice ? 30 : 60;
const FRAME_TIME = 1000 / TARGET_FPS;
let lastFrameTime = 0;

function animate(now = 0) {
  requestAnimationFrame(animate);
  // FPS throttle
  if (now - lastFrameTime < FRAME_TIME) return;
  lastFrameTime = now;

  const delta = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.getElapsedTime();

  processMovement(delta);
  updateCamera();
  regenMP(delta);

  // Torch flicker — mobilde sadece renk değiştir, ışık yok
  for (const t of torchObjects) {
    const flicker = Math.sin(elapsed * 12 + t.baseY) * 0.5 + Math.sin(elapsed * 7.3 + t.baseY * 2) * 0.3;
    t.flame.position.y = t.baseY + flicker * 0.08;
    t.flame.scale.set(1 + flicker * 0.15, 1 + flicker * 0.2, 1 + flicker * 0.15);
    if (t.light) t.light.intensity = t.baseIntensity + flicker * 0.6;
    t.flame.material.color.setRGB(1.0, 0.4 + flicker * 0.1, 0.0);
  }

  // Crystal pulse — mobilde ışık yok
  for (const c of crystalObjects) {
    const pulse = Math.sin(elapsed * 2.5 + c.crystal.position.x) * 0.5 + 0.5;
    c.crystal.material.emissiveIntensity = c.baseEmissive + pulse * 0.4;
    if (c.light) c.light.intensity = 1.0 + pulse * 1.0;
    c.crystal.rotation.y += delta * 0.5;
  }

  // Monster animations
  for (const id in monsterMeshes) {
    const entry = monsterMeshes[id];
    const mesh = entry.mesh;
    // Aura slow rotation
    if (mesh.userData.aura) {
      mesh.userData.aura.rotation.y += delta * 0.3;
    }
    // Idle bob
    const phase = mesh.userData.idlePhase || 0;
    mesh.position.y = heightAt(mesh.position.x, mesh.position.z) + Math.sin(elapsed * 1.5 + phase) * 0.08;
    // Dark mage orb rotation
    if (entry.type === 'dark_mage') {
      for (let o = 0; o < 3; o++) {
        const orb = mesh.userData['orb' + o];
        if (orb) {
          const angle = orb.userData.orbAngle + elapsed * 1.2;
          orb.position.set(Math.cos(angle) * 1.0, 1.6, Math.sin(angle) * 1.0);
        }
      }
    }
  }

  // Player idle bob
  for (const id in playerMeshes) {
    const entry = playerMeshes[id];
    if (id === myId) continue;
    const phase = entry.mesh.userData.idlePhase || 0;
    entry.mesh.position.y = heightAt(entry.mesh.position.x, entry.mesh.position.z) + Math.sin(elapsed * 2.0 + phase) * 0.05;
  }
  // My player idle bob
  if (myMesh) {
    const phase = myMesh.userData.idlePhase || 0;
    const baseY = heightAt(myMesh.position.x, myMesh.position.z);
    myMesh.position.y = baseY + Math.sin(elapsed * 2.0 + phase) * 0.05;
  }

  // Attack flash rings
  for (let i = attackFlashes.length - 1; i >= 0; i--) {
    const f = attackFlashes[i];
    f.timer -= delta;
    const pct = f.timer / 0.3;
    f.ring.scale.set(1 + (1 - pct) * 1.5, 1 + (1 - pct) * 1.5, 1);
    f.ring.material.opacity = pct * 0.9;
    if (f.timer <= 0) {
      scene.remove(f.ring);
      attackFlashes.splice(i, 1);
    }
  }

  // Billboard labels face camera
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  for (const id in playerMeshes) {
    const label = playerMeshes[id].label;
    if (label) label.quaternion.copy(camera.quaternion);
  }
  for (const id in monsterMeshes) {
    const label = monsterMeshes[id].label;
    if (label) label.quaternion.copy(camera.quaternion);
  }

  renderer.render(scene, camera);
}

// ─── LOADING SCREEN ───────────────────────────────────────────────────────────
function runLoadingBar() {
  const fill = document.getElementById('loadingFill');
  const pct = document.getElementById('loadingPct');
  const texts = ['Diyar hazırlanıyor...', 'Canavarlar çağrılıyor...', 'Meşaleler yakılıyor...', 'Ölüler uyanıyor...', 'Portal açılıyor...'];
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 8 + 3;
    if (progress > 100) progress = 100;
    fill.style.width = progress + '%';
    pct.textContent = Math.floor(progress) + '%';
    document.getElementById('loadingText').textContent = texts[Math.floor(progress / 25)] || texts[4];
    if (progress >= 100) clearInterval(interval);
  }, 80);
}

// ─── MOBİL SOHBET BUTONU ─────────────────────────────────────────────────────
const mobileChatBtn = document.getElementById('mobileChatBtn');
if (mobileChatBtn) {
  mobileChatBtn.addEventListener('touchstart', e => {
    e.preventDefault();
    chatOpen = true;
    document.getElementById('chatInputRow').style.display = 'flex';
    document.getElementById('chatInput').focus();
  }, { passive: false });
}

// ─── LOGIN SCREEN LOGIC ───────────────────────────────────────────────────────
let selectedClass = 'warrior';
document.querySelectorAll('.classCard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.classCard').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedClass = card.dataset.class;
  });
});

document.getElementById('startBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim() || 'Maceracı';
  myName = name;
  myClass = selectedClass;
  // Show game screen
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'block';
  // Start loading bar
  runLoadingBar();
  // Start render loop
  animate();
  // Join server
  socket.emit('join', { name, class: selectedClass });
});

// Allow Enter key on name input
document.getElementById('playerName').addEventListener('keydown', e => {
  if (e.code === 'Enter') document.getElementById('startBtn').click();
});

// ─── DETECT MOBILE ────────────────────────────────────────────────────────────
function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
}
if (isMobile()) {
  document.getElementById('mobileControls').style.display = 'block';
  document.getElementById('controls').style.display = 'none';
  document.getElementById('skillBar').style.display = 'none';
}
