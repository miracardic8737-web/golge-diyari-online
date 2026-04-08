// ============================================================
// GÖLGE DİYARI ONLINE — Pure Canvas 2D Isometric RPG
// Albion Online style, NO Three.js
// ============================================================
const socket = window.io();

// ── Constants ────────────────────────────────────────────────
const TILE_W = 128;
const TILE_H = 64;
const MAP_TILES = 80;
const SERVER_TO_TILE = 1 / 40;
const CAMERA_LERP = 0.08;

// ── Canvas Setup ─────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.id = 'isoCanvas';
canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;';
document.getElementById('threeContainer').appendChild(canvas);
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── Isometric Helpers ─────────────────────────────────────────
function tileToIso(tx, ty) {
  return {
    x: (tx - ty) * (TILE_W / 2),
    y: (tx + ty) * (TILE_H / 2)
  };
}
function serverToTile(sx, sy) {
  return { tx: sx * SERVER_TO_TILE, ty: sy * SERVER_TO_TILE };
}

// ── Tile Map Generation ───────────────────────────────────────
// 0=grass, 1=dirt, 2=stone, 3=water
const tileMap = [];
for (let y = 0; y < MAP_TILES; y++) {
  tileMap[y] = [];
  for (let x = 0; x < MAP_TILES; x++) {
    const n = Math.sin(x * 0.3) * Math.cos(y * 0.3) +
              Math.sin(x * 0.07 + 1.2) * Math.cos(y * 0.11 + 0.5) * 2 +
              Math.sin(x * 0.15 + y * 0.08) * 0.5;
    if (n < -1.2) tileMap[y][x] = 3;       // water
    else if (n < -0.3) tileMap[y][x] = 1;  // dirt
    else if (n < 0.6) tileMap[y][x] = 0;   // grass
    else tileMap[y][x] = 2;                 // stone
  }
}

const TILE_COLORS = [
  ['#2d5a1b', '#3a7023', '#254d16', '#326118'], // grass variants
  ['#7a5c3a', '#8a6a45', '#6b4f30', '#7d5e3c'], // dirt variants
  ['#6b6b6b', '#787878', '#5e5e5e', '#717171'], // stone variants
  ['#1a3a5c', '#1e4570', '#162f4a', '#1b3d62'], // water variants
];

function getTileColor(type, tx, ty) {
  const variants = TILE_COLORS[type];
  const idx = ((tx * 7 + ty * 13) ^ (tx + ty * 3)) % variants.length;
  return variants[Math.abs(idx)];
}

// ── Environment Objects ───────────────────────────────────────
const envObjects = [];
const rng = (seed) => {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
};
const rand = rng(42);

for (let i = 0; i < 300; i++) {
  const tx = Math.floor(rand() * MAP_TILES);
  const ty = Math.floor(rand() * MAP_TILES);
  const ttype = tileMap[ty][tx];
  if (ttype === 3) continue; // no objects on water
  const r = rand();
  let otype;
  if (ttype === 0) otype = r < 0.6 ? 'tree' : 'rock';
  else if (ttype === 1) otype = r < 0.3 ? 'tree' : r < 0.7 ? 'rock' : 'ruin';
  else otype = r < 0.5 ? 'rock' : 'ruin';
  envObjects.push({ tx, ty, type: otype, seed: Math.floor(rand() * 1000) });
}

// ── Camera ────────────────────────────────────────────────────
const cam = { x: 0, y: 0, tx: 0, ty: 0 };

// ── Game State ────────────────────────────────────────────────
let myId = null;
let myPlayer = null;
const players = {};
const monsters = {};
const damageNumbers = [];
const notifications = [];
let lastTime = 0;

// ── Input ─────────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ── Skill Cooldowns ───────────────────────────────────────────
const SKILL_CDS = [600, 3000, 6000, 2000];
const skillLastUsed = [0, 0, 0, 0];

function useSkill(idx) {
  const now = Date.now();
  if (now - skillLastUsed[idx] < SKILL_CDS[idx]) return;
  skillLastUsed[idx] = now;
  if (idx === 0) socket.emit('attack');
  updateSkillCooldowns();
}

function updateSkillCooldowns() {
  const now = Date.now();
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById('cd' + i);
    if (!el) continue;
    const elapsed = now - skillLastUsed[i];
    const pct = Math.max(0, 1 - elapsed / SKILL_CDS[i]);
    el.style.height = (pct * 100) + '%';
  }
}
setInterval(updateSkillCooldowns, 50);

// ── Movement ──────────────────────────────────────────────────
let moveThrottle = 0;
const MOVE_SPEED = 160; // server units per second

function handleMovement(dt) {
  if (!myPlayer) return;
  let dx = 0, dy = 0;

  if (keys['KeyW'] || keys['ArrowUp'])    dy -= 1;
  if (keys['KeyS'] || keys['ArrowDown'])  dy += 1;
  if (keys['KeyA'] || keys['ArrowLeft'])  dx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

  // Joystick
  if (joystickActive) { dx += joystickDx; dy += joystickDy; }

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    myPlayer.x = Math.max(20, Math.min(3180, myPlayer.x + dx * MOVE_SPEED * dt));
    myPlayer.y = Math.max(20, Math.min(3180, myPlayer.y + dy * MOVE_SPEED * dt));

    let dir = 'down';
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
    else dir = dy > 0 ? 'down' : 'up';
    myPlayer.dir = dir;

    moveThrottle += dt;
    if (moveThrottle > 0.05) {
      moveThrottle = 0;
      socket.emit('move', { x: myPlayer.x, y: myPlayer.y, dir: myPlayer.dir });
    }
  }
}

// ── Keyboard Skills ───────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (e.code === 'KeyZ') useSkill(0);
  if (e.code === 'KeyX') useSkill(1);
  if (e.code === 'KeyC') useSkill(2);
  if (e.code === 'KeyV') useSkill(3);
  if (e.code === 'Enter') toggleChat();
});

// ── Canvas Click Attack ───────────────────────────────────────
canvas.addEventListener('click', () => useSkill(0));

// ── Drawing Helpers ───────────────────────────────────────────
function roundRect(cx, cy, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(cx + r, cy);
  ctx.lineTo(cx + w - r, cy);
  ctx.quadraticCurveTo(cx + w, cy, cx + w, cy + r);
  ctx.lineTo(cx + w, cy + h - r);
  ctx.quadraticCurveTo(cx + w, cy + h, cx + w - r, cy + h);
  ctx.lineTo(cx + r, cy + h);
  ctx.quadraticCurveTo(cx, cy + h, cx, cy + h - r);
  ctx.lineTo(cx, cy + r);
  ctx.quadraticCurveTo(cx, cy, cx + r, cy);
  ctx.closePath();
}

function drawIsoDiamond(cx, cy, w, h, fillColor, strokeColor) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

function drawIsoBox(cx, cy, w, h, depth, topColor, leftColor, rightColor) {
  // Top face
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + w / 2, cy + h / 2);
  ctx.lineTo(cx, cy + h);
  ctx.lineTo(cx - w / 2, cy + h / 2);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();
  // Left face
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy + h / 2);
  ctx.lineTo(cx, cy + h);
  ctx.lineTo(cx, cy + h + depth);
  ctx.lineTo(cx - w / 2, cy + h / 2 + depth);
  ctx.closePath();
  ctx.fillStyle = leftColor;
  ctx.fill();
  // Right face
  ctx.beginPath();
  ctx.moveTo(cx + w / 2, cy + h / 2);
  ctx.lineTo(cx, cy + h);
  ctx.lineTo(cx, cy + h + depth);
  ctx.lineTo(cx + w / 2, cy + h / 2 + depth);
  ctx.closePath();
  ctx.fillStyle = rightColor;
  ctx.fill();
}

// ── Draw Tile ─────────────────────────────────────────────────
function drawTile(tx, ty) {
  const iso = tileToIso(tx, ty);
  const sx = iso.x - cam.x + canvas.width / 2;
  const sy = iso.y - cam.y + canvas.height / 2;
  const type = tileMap[ty] ? tileMap[ty][tx] : 0;
  const color = getTileColor(type, tx, ty);

  // Water gets animated shimmer
  let fillColor = color;
  if (type === 3) {
    const shimmer = Math.sin(Date.now() * 0.002 + tx * 0.5 + ty * 0.3) * 8;
    fillColor = `hsl(${210 + shimmer},60%,${20 + shimmer * 0.3}%)`;
  }

  drawIsoDiamond(sx, sy, TILE_W, TILE_H, fillColor, 'rgba(0,0,0,0.15)');

  // Grass texture dots
  if (type === 0 && ((tx * 3 + ty * 7) % 5 === 0)) {
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.ellipse(sx + (tx % 3 - 1) * 8, sy + (ty % 3 - 1) * 4, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Draw Tree ─────────────────────────────────────────────────
function drawTree(sx, sy, seed) {
  const s = rng(seed);
  const h = 28 + s() * 14;
  const r = 14 + s() * 8;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 4, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Trunk
  ctx.fillStyle = '#5c3d1e';
  ctx.fillRect(sx - 4, sy - h * 0.4, 8, h * 0.5);
  // Canopy layers
  ctx.fillStyle = '#1a4d1a';
  ctx.beginPath();
  ctx.ellipse(sx, sy - h * 0.35, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#236b23';
  ctx.beginPath();
  ctx.ellipse(sx, sy - h * 0.5, r * 0.75, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2d8a2d';
  ctx.beginPath();
  ctx.ellipse(sx, sy - h * 0.62, r * 0.5, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── Draw Rock ─────────────────────────────────────────────────
function drawRock(sx, sy, seed) {
  const s = rng(seed);
  const w = 18 + s() * 12;
  const h = 10 + s() * 8;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + h * 0.5, w * 0.8, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Rock body (irregular polygon)
  ctx.fillStyle = '#7a7a7a';
  ctx.beginPath();
  ctx.moveTo(sx - w, sy + h * 0.3);
  ctx.lineTo(sx - w * 0.6, sy - h);
  ctx.lineTo(sx + w * 0.2, sy - h * 1.1);
  ctx.lineTo(sx + w, sy - h * 0.2);
  ctx.lineTo(sx + w * 0.7, sy + h * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#9a9a9a';
  ctx.beginPath();
  ctx.moveTo(sx - w * 0.5, sy - h * 0.5);
  ctx.lineTo(sx + w * 0.1, sy - h);
  ctx.lineTo(sx + w * 0.6, sy - h * 0.3);
  ctx.lineTo(sx + w * 0.3, sy);
  ctx.closePath();
  ctx.fill();
}

// ── Draw Ruin ─────────────────────────────────────────────────
function drawRuin(sx, sy, seed) {
  const s = rng(seed);
  const h = 30 + s() * 20;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 6, 16, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pillar box
  drawIsoBox(sx, sy - h, 24, 12, h, '#5a5a6a', '#3a3a4a', '#4a4a5a');
  // Crumble detail
  ctx.fillStyle = '#6a6a7a';
  ctx.fillRect(sx - 6, sy - h - 4, 5, 4);
  ctx.fillRect(sx + 3, sy - h - 2, 4, 3);
}

// ── Draw Player ───────────────────────────────────────────────
const CLASS_COLORS = {
  warrior:  { body: '#c0392b', armor: '#922b21', accent: '#e74c3c', weapon: '#aaa' },
  mage:     { body: '#7d3c98', armor: '#5b2c6f', accent: '#a569bd', weapon: '#7fb3d3' },
  archer:   { body: '#1e8449', armor: '#145a32', accent: '#27ae60', weapon: '#8b6914' },
  assassin: { body: '#2c3e50', armor: '#1a252f', accent: '#566573', weapon: '#717d7e' },
};

function drawCharacter(sx, sy, cls, hp, maxHp, name, isMe, attacking, dir) {
  const c = CLASS_COLORS[cls] || CLASS_COLORS.warrior;
  const pulse = attacking ? Math.sin(Date.now() * 0.02) * 3 : 0;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 2, 16, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.fillStyle = c.armor;
  ctx.fillRect(sx - 7, sy - 14, 6, 14);
  ctx.fillRect(sx + 1, sy - 14, 6, 14);

  // Body (torso)
  ctx.fillStyle = c.body;
  roundRect(sx - 10, sy - 32, 20, 20, 3);
  ctx.fill();

  // Armor highlight
  ctx.fillStyle = c.accent;
  roundRect(sx - 7, sy - 30, 14, 6, 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#f0c080';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 38, 9, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Helmet/hat
  ctx.fillStyle = c.armor;
  ctx.beginPath();
  if (cls === 'mage') {
    // Pointy hat
    ctx.moveTo(sx, sy - 56);
    ctx.lineTo(sx - 10, sy - 42);
    ctx.lineTo(sx + 10, sy - 42);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.ellipse(sx, sy - 44, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Weapon
  ctx.strokeStyle = c.weapon;
  ctx.lineWidth = 3;
  if (cls === 'warrior') {
    // Sword
    const swingOff = attacking ? 10 : 0;
    ctx.beginPath();
    ctx.moveTo(sx + 12 + swingOff, sy - 40 - swingOff);
    ctx.lineTo(sx + 18 + swingOff + pulse, sy - 20 - swingOff);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sx + 10 + swingOff, sy - 36 - swingOff);
    ctx.lineTo(sx + 16 + swingOff, sy - 38 - swingOff);
    ctx.stroke();
  } else if (cls === 'mage') {
    // Staff
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - 14, sy - 44);
    ctx.lineTo(sx - 12, sy - 10);
    ctx.stroke();
    ctx.fillStyle = '#7fb3d3';
    ctx.beginPath();
    ctx.arc(sx - 14, sy - 46, 5, 0, Math.PI * 2);
    ctx.fill();
    if (attacking) {
      ctx.fillStyle = 'rgba(127,179,211,0.5)';
      ctx.beginPath();
      ctx.arc(sx - 14, sy - 46, 10 + pulse, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (cls === 'archer') {
    // Bow
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx + 13, sy - 28, 12, -Math.PI * 0.6, Math.PI * 0.6);
    ctx.stroke();
    if (attacking) {
      ctx.beginPath();
      ctx.moveTo(sx + 13, sy - 36);
      ctx.lineTo(sx + 13, sy - 20);
      ctx.stroke();
    }
  } else if (cls === 'assassin') {
    // Dual daggers
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + 12, sy - 36 - pulse);
    ctx.lineTo(sx + 16, sy - 24 - pulse);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - 12, sy - 34 + pulse);
    ctx.lineTo(sx - 16, sy - 22 + pulse);
    ctx.stroke();
  }

  // HP bar
  const barW = 40;
  const barY = sy - 68;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(sx - barW / 2 - 1, barY - 1, barW + 2, 7);
  const hpPct = Math.max(0, hp / maxHp);
  const hpColor = hpPct > 0.6 ? '#2ecc71' : hpPct > 0.3 ? '#f39c12' : '#e74c3c';
  ctx.fillStyle = hpColor;
  ctx.fillRect(sx - barW / 2, barY, barW * hpPct, 5);

  // Name tag
  ctx.font = isMe ? 'bold 11px Arial' : '10px Arial';
  ctx.textAlign = 'center';
  ctx.fillStyle = isMe ? '#ffd700' : '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 3;
  ctx.fillText(name, sx, barY - 4);
  ctx.shadowBlur = 0;
}

// ── Draw Monster ──────────────────────────────────────────────
function drawMonster(sx, sy, type, hp, maxHp, name) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 2, 18, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (type === 'goblin') {
    // Small hunched green creature
    ctx.fillStyle = '#4a7c3f';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 8, 10, 14, 0.2, 0, Math.PI * 2); // hunched body
    ctx.fill();
    ctx.fillStyle = '#5a9c4f';
    ctx.beginPath();
    ctx.ellipse(sx - 2, sy - 22, 8, 9, -0.1, 0, Math.PI * 2); // head
    ctx.fill();
    // Ears
    ctx.fillStyle = '#4a7c3f';
    ctx.beginPath();
    ctx.moveTo(sx - 9, sy - 26); ctx.lineTo(sx - 14, sy - 32); ctx.lineTo(sx - 6, sy - 24);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx + 5, sy - 26); ctx.lineTo(sx + 10, sy - 32); ctx.lineTo(sx + 3, sy - 24);
    ctx.fill();
    // Eyes
    ctx.fillStyle = '#ff4400';
    ctx.beginPath(); ctx.arc(sx - 3, sy - 23, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + 3, sy - 23, 2, 0, Math.PI * 2); ctx.fill();
    // Weapon (crude club)
    ctx.strokeStyle = '#5c3d1e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx + 10, sy - 18); ctx.lineTo(sx + 14, sy - 4); ctx.stroke();
    ctx.fillStyle = '#5c3d1e';
    ctx.beginPath(); ctx.arc(sx + 14, sy - 3, 4, 0, Math.PI * 2); ctx.fill();

  } else if (type === 'orc') {
    // Large blocky grey-green
    ctx.fillStyle = '#5a7a4a';
    roundRect(sx - 16, sy - 36, 32, 36, 4);
    ctx.fill();
    ctx.fillStyle = '#4a6a3a';
    roundRect(sx - 14, sy - 36, 28, 14, 3); // armor chest
    ctx.fill();
    // Head
    ctx.fillStyle = '#6a8a5a';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 46, 14, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tusks
    ctx.fillStyle = '#ffffcc';
    ctx.beginPath(); ctx.moveTo(sx - 6, sy - 38); ctx.lineTo(sx - 8, sy - 32); ctx.lineTo(sx - 4, sy - 38); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx + 4, sy - 38); ctx.lineTo(sx + 8, sy - 32); ctx.lineTo(sx + 6, sy - 38); ctx.fill();
    // Eyes
    ctx.fillStyle = '#ff6600';
    ctx.beginPath(); ctx.arc(sx - 5, sy - 48, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + 5, sy - 48, 3, 0, Math.PI * 2); ctx.fill();
    // Axe
    ctx.strokeStyle = '#888'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx + 18, sy - 44); ctx.lineTo(sx + 18, sy - 10); ctx.stroke();
    ctx.fillStyle = '#aaa';
    ctx.beginPath();
    ctx.moveTo(sx + 18, sy - 44); ctx.lineTo(sx + 28, sy - 38); ctx.lineTo(sx + 26, sy - 28); ctx.lineTo(sx + 18, sy - 30);
    ctx.closePath(); ctx.fill();

  } else if (type === 'skeleton') {
    // White thin bony shape
    ctx.strokeStyle = '#e8e8d0'; ctx.lineWidth = 3;
    // Spine
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 36); ctx.stroke();
    // Ribs
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(sx, sy - 16 - i * 6);
      ctx.bezierCurveTo(sx - 14, sy - 18 - i * 6, sx - 14, sy - 12 - i * 6, sx, sy - 14 - i * 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx, sy - 16 - i * 6);
      ctx.bezierCurveTo(sx + 14, sy - 18 - i * 6, sx + 14, sy - 12 - i * 6, sx, sy - 14 - i * 6);
      ctx.stroke();
    }
    // Arms
    ctx.beginPath(); ctx.moveTo(sx, sy - 30); ctx.lineTo(sx - 16, sy - 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx, sy - 30); ctx.lineTo(sx + 16, sy - 18); ctx.stroke();
    // Legs
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 10, sy + 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 10, sy + 14); ctx.stroke();
    // Skull
    ctx.fillStyle = '#e8e8d0';
    ctx.beginPath(); ctx.ellipse(sx, sy - 44, 10, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(sx - 4, sy - 46, 3, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx + 4, sy - 46, 3, 4, 0, 0, Math.PI * 2); ctx.fill();
    // Sword
    ctx.strokeStyle = '#c0c0c0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx + 16, sy - 18); ctx.lineTo(sx + 22, sy - 4); ctx.stroke();

  } else if (type === 'dark_mage') {
    // Dark purple robed
    ctx.fillStyle = '#2d0a4e';
    ctx.beginPath();
    ctx.moveTo(sx, sy + 2);
    ctx.lineTo(sx - 18, sy - 20);
    ctx.lineTo(sx - 14, sy - 44);
    ctx.lineTo(sx + 14, sy - 44);
    ctx.lineTo(sx + 18, sy - 20);
    ctx.closePath();
    ctx.fill();
    // Robe highlight
    ctx.fillStyle = '#4a1a7a';
    ctx.beginPath();
    ctx.moveTo(sx, sy + 2);
    ctx.lineTo(sx - 8, sy - 20);
    ctx.lineTo(sx - 6, sy - 44);
    ctx.lineTo(sx + 6, sy - 44);
    ctx.lineTo(sx + 8, sy - 20);
    ctx.closePath();
    ctx.fill();
    // Head with hood
    ctx.fillStyle = '#1a0a2e';
    ctx.beginPath(); ctx.ellipse(sx, sy - 50, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#cc00ff';
    ctx.beginPath(); ctx.ellipse(sx, sy - 52, 5, 5, 0, 0, Math.PI * 2); ctx.fill(); // glowing face
    // Staff with orb
    ctx.strokeStyle = '#6a0dad'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx - 20, sy - 52); ctx.lineTo(sx - 16, sy - 4); ctx.stroke();
    const orbPulse = Math.sin(Date.now() * 0.004) * 3;
    ctx.fillStyle = `rgba(180,0,255,${0.7 + Math.sin(Date.now() * 0.004) * 0.3})`;
    ctx.beginPath(); ctx.arc(sx - 20, sy - 54, 7 + orbPulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(220,100,255,0.4)';
    ctx.beginPath(); ctx.arc(sx - 20, sy - 54, 12 + orbPulse, 0, Math.PI * 2); ctx.fill();

  } else if (type === 'dragon_boss') {
    // LARGE red dragon, top-down isometric view
    const t = Date.now() * 0.002;
    // Wing left
    ctx.fillStyle = 'rgba(120,0,0,0.8)';
    ctx.beginPath();
    ctx.moveTo(sx - 10, sy - 30);
    ctx.bezierCurveTo(sx - 50, sy - 60, sx - 60, sy - 20, sx - 40, sy + 10);
    ctx.lineTo(sx - 10, sy - 10);
    ctx.closePath();
    ctx.fill();
    // Wing right
    ctx.beginPath();
    ctx.moveTo(sx + 10, sy - 30);
    ctx.bezierCurveTo(sx + 50, sy - 60, sx + 60, sy - 20, sx + 40, sy + 10);
    ctx.lineTo(sx + 10, sy - 10);
    ctx.closePath();
    ctx.fill();
    // Wing membrane detail
    ctx.strokeStyle = 'rgba(180,0,0,0.5)'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 20);
      ctx.lineTo(sx - 40 + i * 8, sy + 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx + 10, sy - 20);
      ctx.lineTo(sx + 40 - i * 8, sy + 5);
      ctx.stroke();
    }
    // Body
    ctx.fillStyle = '#8b0000';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 20, 22, 32, 0, 0, Math.PI * 2);
    ctx.fill();
    // Scales
    ctx.fillStyle = '#a00000';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(sx + i * 7, sy - 20 + Math.abs(i) * 3, 5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Neck + Head
    ctx.fillStyle = '#8b0000';
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy - 48);
    ctx.lineTo(sx + 8, sy - 48);
    ctx.lineTo(sx + 6, sy - 36);
    ctx.lineTo(sx - 6, sy - 36);
    ctx.closePath();
    ctx.fill();
    // Head
    ctx.fillStyle = '#9b0000';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 56, 14, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    // Horns
    ctx.fillStyle = '#3a0000';
    ctx.beginPath(); ctx.moveTo(sx - 8, sy - 62); ctx.lineTo(sx - 14, sy - 74); ctx.lineTo(sx - 4, sy - 62); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx + 8, sy - 62); ctx.lineTo(sx + 14, sy - 74); ctx.lineTo(sx + 4, sy - 62); ctx.fill();
    // Eyes (glowing)
    const eyeGlow = 0.7 + Math.sin(t) * 0.3;
    ctx.fillStyle = `rgba(255,200,0,${eyeGlow})`;
    ctx.beginPath(); ctx.arc(sx - 5, sy - 58, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + 5, sy - 58, 3, 0, Math.PI * 2); ctx.fill();
    // Fire breath (when alive)
    if (Math.sin(t * 0.5) > 0.3) {
      const grad = ctx.createRadialGradient(sx, sy - 68, 2, sx, sy - 80, 20);
      grad.addColorStop(0, 'rgba(255,200,0,0.9)');
      grad.addColorStop(0.5, 'rgba(255,80,0,0.6)');
      grad.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(sx, sy - 80, 12, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Tail
    ctx.strokeStyle = '#8b0000'; ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(sx, sy + 10);
    ctx.bezierCurveTo(sx + 20, sy + 30, sx + 10, sy + 50, sx - 10, sy + 55);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx - 10, sy + 55);
    ctx.lineTo(sx - 18, sy + 62);
    ctx.stroke();
  }

  // HP bar
  const barW = type === 'dragon_boss' ? 70 : 40;
  const barY = sy - (type === 'dragon_boss' ? 90 : 72);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(sx - barW / 2 - 1, barY - 1, barW + 2, 7);
  const hpPct = Math.max(0, hp / maxHp);
  ctx.fillStyle = hpPct > 0.5 ? '#e74c3c' : '#c0392b';
  ctx.fillRect(sx - barW / 2, barY, barW * hpPct, 5);

  // Name
  ctx.font = type === 'dragon_boss' ? 'bold 12px Arial' : '9px Arial';
  ctx.textAlign = 'center';
  ctx.fillStyle = type === 'dragon_boss' ? '#ff4444' : '#ffaaaa';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 4;
  ctx.fillText(name, sx, barY - 4);
  ctx.shadowBlur = 0;
}

// ── Damage Numbers ────────────────────────────────────────────
function spawnDamageNumber(sx, sy, text, color) {
  damageNumbers.push({ sx, sy, text, color: color || '#fff', life: 1.2, vy: -60 });
}

function updateDamageNumbers(dt) {
  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const d = damageNumbers[i];
    d.life -= dt;
    d.sy += d.vy * dt;
    if (d.life <= 0) { damageNumbers.splice(i, 1); continue; }
    const alpha = Math.min(1, d.life * 2);
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = d.color.replace(')', `,${alpha})`).replace('rgb', 'rgba');
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText(d.text, d.sx, d.sy);
    ctx.shadowBlur = 0;
  }
}

// ── Minimap ───────────────────────────────────────────────────
const minimapCanvas = document.getElementById('minimap');
const mctx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
const MM_SIZE = 130;
const MM_TILE = MM_SIZE / MAP_TILES;

function drawMinimap() {
  if (!mctx) return;
  mctx.clearRect(0, 0, MM_SIZE, MM_SIZE);

  // Tiles
  for (let y = 0; y < MAP_TILES; y++) {
    for (let x = 0; x < MAP_TILES; x++) {
      const t = tileMap[y][x];
      mctx.fillStyle = ['#2d5a1b', '#7a5c3a', '#6b6b6b', '#1a3a5c'][t];
      mctx.fillRect(x * MM_TILE, y * MM_TILE, MM_TILE + 0.5, MM_TILE + 0.5);
    }
  }

  // Monsters
  mctx.fillStyle = '#e74c3c';
  for (const id in monsters) {
    const m = monsters[id];
    const tx = m.x * SERVER_TO_TILE;
    const ty = m.y * SERVER_TO_TILE;
    mctx.beginPath();
    mctx.arc(tx * MM_TILE, ty * MM_TILE, 1.5, 0, Math.PI * 2);
    mctx.fill();
  }

  // Other players
  mctx.fillStyle = '#3498db';
  for (const id in players) {
    if (id === myId) continue;
    const p = players[id];
    const tx = p.x * SERVER_TO_TILE;
    const ty = p.y * SERVER_TO_TILE;
    mctx.beginPath();
    mctx.arc(tx * MM_TILE, ty * MM_TILE, 2, 0, Math.PI * 2);
    mctx.fill();
  }

  // Self
  if (myPlayer) {
    const tx = myPlayer.x * SERVER_TO_TILE;
    const ty = myPlayer.y * SERVER_TO_TILE;
    mctx.fillStyle = '#f1c40f';
    mctx.beginPath();
    mctx.arc(tx * MM_TILE, ty * MM_TILE, 3, 0, Math.PI * 2);
    mctx.fill();
    // View indicator
    mctx.strokeStyle = 'rgba(241,196,15,0.4)';
    mctx.lineWidth = 1;
    mctx.strokeRect(tx * MM_TILE - 8, ty * MM_TILE - 6, 16, 12);
  }
}

// ── HUD Update ────────────────────────────────────────────────
function updateHUD() {
  if (!myPlayer) return;
  const p = myPlayer;
  const hpPct = (p.hp / p.maxHp * 100).toFixed(0);
  const mpPct = (p.mp / p.maxMp * 100).toFixed(0);
  const expPct = (p.exp / p.expNeeded * 100).toFixed(0);

  const hpBar = document.getElementById('hpBar');
  const mpBar = document.getElementById('mpBar');
  const expBar = document.getElementById('expBar');
  if (hpBar) hpBar.style.width = hpPct + '%';
  if (mpBar) mpBar.style.width = mpPct + '%';
  if (expBar) expBar.style.width = expPct + '%';

  const hpVal = document.getElementById('hpVal');
  const mpVal = document.getElementById('mpVal');
  const expVal = document.getElementById('expVal');
  if (hpVal) hpVal.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
  if (mpVal) mpVal.textContent = `${Math.ceil(p.mp)}/${p.maxMp}`;
  if (expVal) expVal.textContent = `${p.exp}/${p.expNeeded}`;

  const charName = document.getElementById('charName');
  const charLevel = document.getElementById('charLevel');
  if (charName) charName.textContent = p.name;
  if (charLevel) charLevel.textContent = 'Sv.' + p.level;

  const avatar = document.getElementById('charAvatar');
  if (avatar) avatar.className = (p.class || 'warrior') + '-avatar';
}

// ── Notifications ─────────────────────────────────────────────
function showNotif(text, color) {
  const area = document.getElementById('notifArea');
  if (!area) return;
  const el = document.createElement('div');
  el.className = 'notif';
  el.textContent = text;
  if (color) el.style.color = color;
  area.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Chat ──────────────────────────────────────────────────────
let chatOpen = false;
function toggleChat() {
  const row = document.getElementById('chatInputRow');
  const input = document.getElementById('chatInput');
  if (!row) return;
  chatOpen = !chatOpen;
  row.style.display = chatOpen ? 'flex' : 'none';
  if (chatOpen && input) input.focus();
}

function addChatMsg(name, msg) {
  const log = document.getElementById('chatLog');
  if (!log) return;
  const el = document.createElement('div');
  el.className = 'chatMsg';
  el.innerHTML = `<span class="chatName">${name}:</span> ${msg}`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 30) log.removeChild(log.firstChild);
}

const chatSendBtn = document.getElementById('chatSendBtn');
const chatInput = document.getElementById('chatInput');
if (chatSendBtn) chatSendBtn.addEventListener('click', sendChat);
if (chatInput) chatInput.addEventListener('keydown', e => {
  if (e.code === 'Enter') { sendChat(); e.preventDefault(); }
  e.stopPropagation();
});
function sendChat() {
  const input = document.getElementById('chatInput');
  if (!input || !input.value.trim()) return;
  socket.emit('chat', input.value.trim());
  input.value = '';
  toggleChat();
}

// ── Mobile Chat ───────────────────────────────────────────────
const mobileChatBtn = document.getElementById('mobileChatBtn');
if (mobileChatBtn) mobileChatBtn.addEventListener('click', toggleChat);

// ── Mobile Skill Buttons ──────────────────────────────────────
document.querySelectorAll('.mobileSkillBtn').forEach(btn => {
  btn.addEventListener('touchstart', e => {
    e.preventDefault();
    useSkill(parseInt(btn.dataset.skill));
  });
});
const mobileAttackBtn = document.getElementById('mobileAttackBtn');
if (mobileAttackBtn) mobileAttackBtn.addEventListener('touchstart', e => {
  e.preventDefault();
  useSkill(0);
});

// ── Virtual Joystick ──────────────────────────────────────────
let joystickActive = false;
let joystickDx = 0, joystickDy = 0;
let joystickOriginX = 0, joystickOriginY = 0;
const joystickBase = document.getElementById('joystickBase');
const joystickThumb = document.getElementById('joystickThumb');

if (joystickBase) {
  joystickBase.addEventListener('touchstart', e => {
    e.preventDefault();
    joystickActive = true;
    const t = e.touches[0];
    const rect = joystickBase.getBoundingClientRect();
    joystickOriginX = rect.left + rect.width / 2;
    joystickOriginY = rect.top + rect.height / 2;
  }, { passive: false });

  joystickBase.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!joystickActive) return;
    const t = e.touches[0];
    let dx = t.clientX - joystickOriginX;
    let dy = t.clientY - joystickOriginY;
    const dist = Math.hypot(dx, dy);
    const maxR = 40;
    if (dist > maxR) { dx = dx / dist * maxR; dy = dy / dist * maxR; }
    joystickDx = dx / maxR;
    joystickDy = dy / maxR;
    if (joystickThumb) {
      joystickThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
  }, { passive: false });

  const endJoystick = () => {
    joystickActive = false;
    joystickDx = 0; joystickDy = 0;
    if (joystickThumb) joystickThumb.style.transform = 'translate(-50%, -50%)';
  };
  joystickBase.addEventListener('touchend', endJoystick);
  joystickBase.addEventListener('touchcancel', endJoystick);
}

// ── Mobile Detection ──────────────────────────────────────────
const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const mobileControls = document.getElementById('mobileControls');
if (isMobile && mobileControls) mobileControls.style.display = 'flex';

// ── Screen Flash ──────────────────────────────────────────────
function screenFlash(color) {
  const el = document.getElementById('screenFlash');
  if (!el) return;
  el.style.background = color || 'rgba(255,0,0,0.35)';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 200);
}

// ── Main Render Loop ──────────────────────────────────────────
function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  handleMovement(dt);
  interpolatePlayers(dt);

  // Camera smooth follow — karakterin gövde merkezi ekran ortasında olsun
  if (myPlayer) {
    const { tx, ty } = serverToTile(myPlayer.x, myPlayer.y);
    const iso = tileToIso(tx, ty);
    // Karakterin ayakları tile merkezinde, gövdesi ~30px yukarıda
    // Kamerayı biraz yukarı kaydır ki karakter tam ortada görünsün
    cam.tx = iso.x - canvas.width / 2;
    cam.ty = iso.y - canvas.height / 2 - 30;
  }
  cam.x += (cam.tx - cam.x) * 0.12;
  cam.y += (cam.ty - cam.y) * 0.12;

  // ── 1. Sky gradient background
  const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  skyGrad.addColorStop(0, '#0d1b2a');
  skyGrad.addColorStop(0.5, '#1a2e44');
  skyGrad.addColorStop(1, '#0a1520');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ── 2. Determine visible tile range
  const margin = 3;
  const camTileX = (cam.x + canvas.width / 2) / (TILE_W / 2);
  const camTileY = (cam.y + canvas.height / 2) / (TILE_H / 2);
  const viewW = (canvas.width / (TILE_W / 2)) + margin * 2;
  const viewH = (canvas.height / (TILE_H / 2)) + margin * 2;

  // Collect render items: tiles + env objects + entities
  const renderItems = [];

  // ── 3. Tiles
  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const iso = tileToIso(tx, ty);
      const sx = iso.x - cam.x + canvas.width / 2;
      const sy = iso.y - cam.y + canvas.height / 2;
      // Frustum cull
      if (sx < -TILE_W || sx > canvas.width + TILE_W) continue;
      if (sy < -TILE_H || sy > canvas.height + TILE_H) continue;
      renderItems.push({ sortKey: tx + ty, type: 'tile', tx, ty, sx, sy });
    }
  }

  // ── 4. Env objects
  for (const obj of envObjects) {
    const iso = tileToIso(obj.tx, obj.ty);
    const sx = iso.x - cam.x + canvas.width / 2;
    const sy = iso.y - cam.y + canvas.height / 2;
    if (sx < -100 || sx > canvas.width + 100) continue;
    if (sy < -120 || sy > canvas.height + 120) continue;
    renderItems.push({ sortKey: obj.tx + obj.ty + 0.5, type: 'env', obj, sx, sy });
  }

  // ── 5. Entities (players + monsters)
  for (const id in players) {
    const p = players[id];
    // Use interpolated server coords for other players
    const rx = (id === myId) ? p.x : (p.renderX !== undefined ? p.renderX : p.x);
    const ry = (id === myId) ? p.y : (p.renderY !== undefined ? p.renderY : p.y);
    const { tx, ty } = serverToTile(rx, ry);
    const iso = tileToIso(tx, ty);
    const sx = iso.x - cam.x + canvas.width / 2;
    const sy = iso.y - cam.y + canvas.height / 2;
    if (sx < -80 || sx > canvas.width + 80) continue;
    if (sy < -100 || sy > canvas.height + 100) continue;
    renderItems.push({ sortKey: tx + ty + 0.6, type: 'player', p, sx, sy, isMe: id === myId });
  }

  for (const id in monsters) {
    const m = monsters[id];
    const { tx, ty } = serverToTile(m.x, m.y);
    const iso = tileToIso(tx, ty);
    const sx = iso.x - cam.x + canvas.width / 2;
    const sy = iso.y - cam.y + canvas.height / 2;
    if (sx < -100 || sx > canvas.width + 100) continue;
    if (sy < -120 || sy > canvas.height + 120) continue;
    renderItems.push({ sortKey: tx + ty + 0.55, type: 'monster', m, sx, sy });
  }

  // ── 6. Sort back-to-front (painter's algorithm)
  renderItems.sort((a, b) => a.sortKey - b.sortKey);

  // ── 7. Draw all items
  for (const item of renderItems) {
    if (item.type === 'tile') {
      drawTile(item.tx, item.ty);
    } else if (item.type === 'env') {
      const { obj, sx, sy } = item;
      if (obj.type === 'tree') drawTree(sx, sy - TILE_H / 2, obj.seed);
      else if (obj.type === 'rock') drawRock(sx, sy - TILE_H / 4, obj.seed);
      else if (obj.type === 'ruin') drawRuin(sx, sy - TILE_H / 4, obj.seed);
    } else if (item.type === 'player') {
      const { p, sx, sy, isMe } = item;
      drawCharacter(sx, sy - TILE_H / 2, p.class, p.hp, p.maxHp, p.name, isMe, p.attacking, p.dir);
    } else if (item.type === 'monster') {
      const { m, sx, sy } = item;
      drawMonster(sx, sy - TILE_H / 2, m.type, m.hp, m.maxHp, m.name);
    }
  }

  // ── 8. Damage numbers (screen space, no camera)
  updateDamageNumbers(dt);

  // ── 9. UI updates
  updateHUD();
  drawMinimap();

  requestAnimationFrame(gameLoop);
}

// ── Smooth Player Interpolation ───────────────────────────────
function interpolatePlayers(dt) {
  for (const id in players) {
    const p = players[id];
    if (id === myId) continue;
    if (p.renderX === undefined) { p.renderX = p.x; p.renderY = p.y; }
    const lerpSpeed = 12;
    const target = p.targetSX !== undefined ? p.targetSX : p.x;
    const targetY = p.targetSY !== undefined ? p.targetSY : p.y;
    p.renderX += (target - p.renderX) * Math.min(1, lerpSpeed * dt);
    p.renderY += (targetY - p.renderY) * Math.min(1, lerpSpeed * dt);
  }
}

// ── Socket Events ─────────────────────────────────────────────
socket.on('joined', (data) => {
  myId = socket.id;
  myPlayer = {
    ...data.player,
    mp: 100, maxMp: 100,
    renderX: 0, renderY: 0,
  };
  players[myId] = myPlayer;

  // Kamerayı hemen oyuncuya kilitle
  function initCamera() {
    const { tx, ty } = serverToTile(myPlayer.x, myPlayer.y);
    const iso = tileToIso(tx, ty);
    cam.x = cam.tx = iso.x - canvas.width / 2;
    cam.y = cam.ty = iso.y - canvas.height / 2 - 30;
  }
  initCamera();
  // Canvas henüz doğru boyutta olmayabilir, 100ms sonra tekrar ayarla
  setTimeout(initCamera, 100);
  setTimeout(initCamera, 500);

  // Start loading sequence
  startLoading();
});

socket.on('state', (data) => {
  // Update players
  const incoming = {};
  for (const p of data.players) {
    incoming[p.id] = true;
    if (p.id === myId) {
      if (myPlayer) {
        myPlayer.hp = p.hp;
        myPlayer.maxHp = p.maxHp;
        myPlayer.level = p.level;
        myPlayer.attacking = p.attacking;
      }
    } else {
      if (!players[p.id]) {
        players[p.id] = { ...p, renderX: p.x, renderY: p.y };
      } else {
        // Store server coords as target; interpolation uses server coords
        players[p.id].targetSX = p.x;
        players[p.id].targetSY = p.y;
        Object.assign(players[p.id], p);
      }
    }
  }
  for (const id in players) {
    if (id !== myId && !incoming[id]) delete players[id];
  }

  // Update monsters
  const incomingM = {};
  for (const m of data.monsters) {
    incomingM[m.id] = true;
    monsters[m.id] = m;
  }
  for (const id in monsters) {
    if (!incomingM[id]) delete monsters[id];
  }
});

socket.on('damaged', (data) => {
  if (myPlayer) {
    myPlayer.hp = data.hp;
    screenFlash('rgba(220,0,0,0.4)');
    spawnDamageNumber(canvas.width / 2, canvas.height / 2 - 80, '-' + data.dmg, 'rgb(255,80,80)');
  }
});

socket.on('hitResult', (hits) => {
  for (const hit of hits) {
    const m = monsters[hit.id];
    if (m) {
      const { tx, ty } = serverToTile(m.x, m.y);
      const iso = tileToIso(tx, ty);
      const sx = iso.x - cam.x + canvas.width / 2;
      const sy = iso.y - cam.y + canvas.height / 2 - TILE_H / 2 - 40;
      spawnDamageNumber(sx + (Math.random() - 0.5) * 20, sy, '-' + hit.dmg, 'rgb(255,220,50)');
    }
  }
});

socket.on('expGain', (data) => {
  if (myPlayer) {
    myPlayer.exp = data.total;
    myPlayer.expNeeded = data.needed;
  }
  showNotif(`+${data.exp} DEN`, '#f1c40f');
});

socket.on('levelUp', (data) => {
  if (myPlayer) {
    myPlayer.level = data.level;
    myPlayer.hp = data.hp;
    myPlayer.maxHp = data.maxHp;
  }
  showNotif(`⬆ SEVİYE ${data.level}! Tebrikler!`, '#f1c40f');
  screenFlash('rgba(255,215,0,0.3)');
});

socket.on('chat', (data) => {
  addChatMsg(data.name, data.msg);
});

socket.on('died', () => {
  if (!myPlayer) return;
  myPlayer.hp = 0;
  updateHUD();
  screenFlash('rgba(0,0,0,0.8)');
  showNotif('☠ ÖLDÜNÜZ! 5 saniye sonra yeniden doğuyorsunuz...', '#ff4444');
  // Ölüm ekranı göster
  const deathEl = document.getElementById('deathScreen');
  if (deathEl) deathEl.style.display = 'flex';
});

socket.on('respawned', (data) => {
  if (!myPlayer) return;
  myPlayer.hp = data.hp;
  myPlayer.x = data.x;
  myPlayer.y = data.y;
  updateHUD();
  showNotif('✨ Yeniden doğdunuz!', '#22c55e');
  const deathEl = document.getElementById('deathScreen');
  if (deathEl) deathEl.style.display = 'none';
  // Kamerayı yeni konuma taşı
  const { tx, ty } = serverToTile(myPlayer.x, myPlayer.y);
  const iso = tileToIso(tx, ty);
  cam.x = cam.tx = iso.x - canvas.width / 2;
  cam.y = cam.ty = iso.y - canvas.height / 2 - 30;
});

// ── Loading Screen ────────────────────────────────────────────
function startLoading() {
  const fill = document.getElementById('loadingFill');
  const pct = document.getElementById('loadingPct');
  const text = document.getElementById('loadingText');
  const overlay = document.getElementById('loadingOverlay');
  const msgs = ['Diyar hazırlanıyor...', 'Harita yükleniyor...', 'Canavarlar çağrılıyor...', 'Büyüler hazırlanıyor...', 'Giriş yapılıyor...'];
  let progress = 0;
  const interval = setInterval(() => {
    progress += 8 + Math.random() * 12;
    if (progress >= 100) { progress = 100; clearInterval(interval); }
    if (fill) fill.style.width = progress + '%';
    if (pct) pct.textContent = Math.floor(progress) + '%';
    if (text) text.textContent = msgs[Math.min(Math.floor(progress / 25), msgs.length - 1)];
    if (progress >= 100) {
      setTimeout(() => {
        if (overlay) overlay.style.display = 'none';
      }, 400);
    }
  }, 120);
}

// ── Login Screen ──────────────────────────────────────────────
let selectedClass = 'warrior';

document.querySelectorAll('.classCard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.classCard').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedClass = card.dataset.class;
  });
});

const startBtn = document.getElementById('startBtn');
if (startBtn) {
  startBtn.addEventListener('click', () => {
    const nameInput = document.getElementById('playerName');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
      if (nameInput) { nameInput.style.borderColor = '#e74c3c'; nameInput.focus(); }
      return;
    }
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    // Canvas'ı doğru boyuta getir (gameScreen görünür olduktan sonra)
    setTimeout(() => {
      resizeCanvas();
      // Mobil kontrolleri göster
      if (isMobile && mobileControls) mobileControls.style.display = 'block';
    }, 50);
    socket.emit('join', { name, class: selectedClass });
    requestAnimationFrame(gameLoop);
  });
}

// Enter key on name input
const nameInput = document.getElementById('playerName');
if (nameInput) {
  nameInput.addEventListener('keydown', e => {
    if (e.code === 'Enter') startBtn && startBtn.click();
  });
}
