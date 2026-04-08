// ─── SOCKET ───────────────────────────────────────────────────────────────────
const socket = window.io();

// ─── CANVAS SETUP ─────────────────────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;top:0;left:0;display:block;';
document.getElementById('gameContainer').appendChild(canvas);
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const TILE_W   = 128;
const TILE_H   = 64;
const MAP_TILES = 80;
const SPEED    = 220; // server units per second

// ─── CAMERA ───────────────────────────────────────────────────────────────────
const cam = { x: 0, y: 0 };

// Convert server coords → isometric world position
function serverToIso(sx, sy) {
  const tx = sx / 40;
  const ty = sy / 40;
  return {
    x: (tx - ty) * (TILE_W / 2),
    y: (tx + ty) * (TILE_H / 2)
  };
}

// Isometric world → canvas screen (applies camera)
function isoToScreen(wx, wy) {
  return {
    x: wx - cam.x + canvas.width  / 2,
    y: wy - cam.y + canvas.height / 2
  };
}

// Combined helper
function serverToScreen(sx, sy) {
  const iso = serverToIso(sx, sy);
  return isoToScreen(iso.x, iso.y);
}

// ─── TILE MAP ─────────────────────────────────────────────────────────────────
// 0=grass 1=dirt 2=stone 3=water
const tileMap = [];
(function generateMap() {
  for (let ty = 0; ty < MAP_TILES; ty++) {
    tileMap[ty] = [];
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const n = Math.sin(tx * 0.18) * Math.cos(ty * 0.18)
              + Math.sin(tx * 0.07 + 1.3) * Math.cos(ty * 0.09 + 0.7)
              + Math.sin(tx * 0.04 + ty * 0.05) * 0.5;
      if (n < -0.6)       tileMap[ty][tx] = 3; // water
      else if (n < -0.1)  tileMap[ty][tx] = 1; // dirt
      else if (n < 0.4)   tileMap[ty][tx] = 0; // grass
      else                tileMap[ty][tx] = 2; // stone
    }
  }
})();

const TILE_COLORS = ['#2d5a1b', '#7a5c3a', '#5a5a6a', '#1a3a6a'];
const TILE_TOP    = ['#3a7a22', '#9a7a50', '#7a7a8a', '#2a5a9a'];
const TILE_MINI   = ['#3a7a22', '#9a7a50', '#7a7a8a', '#2a5a9a'];

function drawTile(tx, ty, t) {
  const wx = (tx - ty) * (TILE_W / 2);
  const wy = (tx + ty) * (TILE_H / 2);
  const s  = isoToScreen(wx, wy);
  const cx = s.x, cy = s.y;

  // Cull
  if (cx < -TILE_W || cx > canvas.width  + TILE_W) return;
  if (cy < -TILE_H || cy > canvas.height + TILE_H) return;

  // Side face
  ctx.fillStyle = TILE_COLORS[t];
  ctx.beginPath();
  ctx.moveTo(cx,            cy + TILE_H / 2);
  ctx.lineTo(cx + TILE_W / 2, cy + TILE_H);
  ctx.lineTo(cx + TILE_W / 2, cy + TILE_H + 8);
  ctx.lineTo(cx,            cy + TILE_H / 2 + 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = TILE_COLORS[t];
  ctx.beginPath();
  ctx.moveTo(cx,            cy + TILE_H / 2);
  ctx.lineTo(cx - TILE_W / 2, cy + TILE_H);
  ctx.lineTo(cx - TILE_W / 2, cy + TILE_H + 8);
  ctx.lineTo(cx,            cy + TILE_H / 2 + 8);
  ctx.closePath();
  ctx.fill();

  // Top face
  ctx.fillStyle = TILE_TOP[t];
  ctx.beginPath();
  ctx.moveTo(cx,            cy);
  ctx.lineTo(cx + TILE_W / 2, cy + TILE_H / 2);
  ctx.lineTo(cx,            cy + TILE_H);
  ctx.lineTo(cx - TILE_W / 2, cy + TILE_H / 2);
  ctx.closePath();
  ctx.fill();

  // Water shimmer
  if (t === 3) {
    ctx.fillStyle = 'rgba(100,180,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(cx,            cy);
    ctx.lineTo(cx + TILE_W / 2, cy + TILE_H / 2);
    ctx.lineTo(cx,            cy + TILE_H);
    ctx.lineTo(cx - TILE_W / 2, cy + TILE_H / 2);
    ctx.closePath();
    ctx.fill();
  }
}

// ─── DRAW CHARACTERS ──────────────────────────────────────────────────────────
const CLASS_COLORS = {
  warrior: '#e74c3c',
  mage:    '#9b59b6',
  archer:  '#27ae60',
  rogue:   '#2c3e50'
};

function drawCharacter(sx, sy, name, hp, maxHp, cls, isMe, attacking) {
  const s = serverToScreen(sx, sy);
  const x = s.x, y = s.y;
  const col = CLASS_COLORS[cls] || '#e74c3c';
  const t = Date.now() / 1000;

  // Walk bob animation
  const isMoving = isMe && (Math.abs(joystickDx) > 0.1 || Math.abs(joystickDy) > 0.1 ||
    keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] ||
    keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight']);
  const bob = isMoving ? Math.sin(t * 10) * 2 : 0;
  const legSwing = isMoving ? Math.sin(t * 10) * 5 : 0;

  // Attack swing
  const atkSwing = attacking ? Math.sin(t * 20) * 12 : 0;

  // Shadow (squish when bobbing)
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4, 18 + Math.abs(bob) * 0.5, 8 - Math.abs(bob) * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs (animated)
  ctx.fillStyle = cls === 'warrior' ? '#7f1d1d' : cls === 'mage' ? '#4c1d95' : cls === 'archer' ? '#14532d' : '#1f2937';
  // Left leg
  ctx.save();
  ctx.translate(x - 5, y - 2 + bob);
  ctx.rotate(legSwing * 0.05);
  ctx.fillRect(-4, 0, 8, 12);
  ctx.restore();
  // Right leg
  ctx.save();
  ctx.translate(x + 5, y - 2 + bob);
  ctx.rotate(-legSwing * 0.05);
  ctx.fillRect(-4, 0, 8, 12);
  ctx.restore();

  // Body
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(x, y - 12 + bob, 12, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Armor shine
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.ellipse(x - 3, y - 16 + bob, 5, 6, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#f5cba7';
  ctx.beginPath();
  ctx.arc(x, y - 30 + bob, 9, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.arc(x - 3, y - 31 + bob, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 3, y - 31 + bob, 1.5, 0, Math.PI * 2); ctx.fill();

  // Class weapon with attack animation
  if (cls === 'warrior') {
    const swingX = attacking ? atkSwing : 0;
    const swingY = attacking ? -Math.abs(atkSwing) * 0.5 : 0;
    ctx.strokeStyle = attacking ? '#ff6b6b' : '#c0c0c0';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 10 + swingX, y - 18 + bob + swingY);
    ctx.lineTo(x + 24 + swingX, y - 40 + bob + swingY);
    ctx.stroke();
    // Guard
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 6 + swingX, y - 26 + bob + swingY);
    ctx.lineTo(x + 18 + swingX, y - 28 + bob + swingY);
    ctx.stroke();
    // Attack flash
    if (attacking) {
      ctx.fillStyle = 'rgba(255,100,100,0.3)';
      ctx.beginPath();
      ctx.arc(x + 20 + swingX, y - 38 + bob, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (cls === 'mage') {
    ctx.strokeStyle = attacking ? '#da8fff' : '#9b59b6';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 18 + bob);
    ctx.lineTo(x - 24, y - 42 + bob);
    ctx.stroke();
    const orbPulse = attacking ? 8 + Math.sin(t * 15) * 3 : 5;
    ctx.fillStyle = attacking ? '#ff88ff' : '#c39bd3';
    ctx.shadowColor = attacking ? '#ff00ff' : '#9b59b6';
    ctx.shadowBlur = attacking ? 12 : 6;
    ctx.beginPath();
    ctx.arc(x - 24, y - 44 + bob, orbPulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (attacking) {
      ctx.fillStyle = 'rgba(200,0,255,0.2)';
      ctx.beginPath();
      ctx.arc(x - 24, y - 44 + bob, 20, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (cls === 'archer') {
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 14, y - 24 + bob, 10, -0.8, 0.8);
    ctx.stroke();
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 14, y - 34 + bob);
    ctx.lineTo(x + 14, y - 14 + bob);
    ctx.stroke();
    if (attacking) {
      // Arrow flying
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 14, y - 24 + bob);
      ctx.lineTo(x + 14 + atkSwing * 2, y - 24 + bob - Math.abs(atkSwing));
      ctx.stroke();
    }
  } else if (cls === 'rogue') {
    const daggerSwing = attacking ? atkSwing * 0.5 : 0;
    ctx.strokeStyle = attacking ? '#e0e0e0' : '#888';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 8 + daggerSwing, y - 18 + bob - daggerSwing);
    ctx.lineTo(x + 20 + daggerSwing, y - 32 + bob - daggerSwing);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 8 - daggerSwing, y - 18 + bob - daggerSwing);
    ctx.lineTo(x - 20 - daggerSwing, y - 32 + bob - daggerSwing);
    ctx.stroke();
  }

  // Outline if me
  if (isMe) {
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y - 10, 14, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // HP bar
  const bw = 36, bh = 5;
  ctx.fillStyle = '#333';
  ctx.fillRect(x - bw/2, y - 46, bw, bh);
  ctx.fillStyle = hp / maxHp > 0.5 ? '#2ecc71' : hp / maxHp > 0.25 ? '#f39c12' : '#e74c3c';
  ctx.fillRect(x - bw/2, y - 46, bw * (hp / maxHp), bh);

  // Name
  ctx.fillStyle = isMe ? '#ffd700' : '#e0d0ff';
  ctx.font = '11px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText(name, x, y - 50);
}

// ─── DRAW MONSTERS ────────────────────────────────────────────────────────────
function drawMonster(m) {
  const s = serverToScreen(m.x, m.y);
  const x = s.x, y = s.y;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4, m.size * 0.45, m.size * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  if (m.type === 'goblin') {
    ctx.fillStyle = '#4a7c3f';
    ctx.beginPath();
    ctx.ellipse(x, y - 8, 10, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a9c4f';
    ctx.beginPath();
    ctx.arc(x, y - 24, 8, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    ctx.fillStyle = '#4a7c3f';
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 28); ctx.lineTo(x - 14, y - 36); ctx.lineTo(x - 4, y - 28);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 8, y - 28); ctx.lineTo(x + 14, y - 36); ctx.lineTo(x + 4, y - 28);
    ctx.fill();
    // Eyes
    ctx.fillStyle = '#ff0';
    ctx.beginPath(); ctx.arc(x - 3, y - 25, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 3, y - 25, 2, 0, Math.PI * 2); ctx.fill();

  } else if (m.type === 'orc') {
    ctx.fillStyle = '#5a7a40';
    ctx.beginPath();
    ctx.ellipse(x, y - 10, 18, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6a8a50';
    ctx.beginPath();
    ctx.arc(x, y - 34, 14, 0, Math.PI * 2);
    ctx.fill();
    // Tusks
    ctx.fillStyle = '#fffde7';
    ctx.beginPath(); ctx.moveTo(x - 5, y - 28); ctx.lineTo(x - 7, y - 20); ctx.lineTo(x - 3, y - 20); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 5, y - 28); ctx.lineTo(x + 7, y - 20); ctx.lineTo(x + 3, y - 20); ctx.fill();
    // Axe
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x + 16, y - 10); ctx.lineTo(x + 28, y - 30); ctx.stroke();
    ctx.fillStyle = '#aaa';
    ctx.beginPath(); ctx.moveTo(x + 28, y - 30); ctx.lineTo(x + 36, y - 38); ctx.lineTo(x + 24, y - 36); ctx.fill();

  } else if (m.type === 'skeleton') {
    ctx.strokeStyle = '#e8e8d0';
    ctx.lineWidth = 3;
    // Spine
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 30); ctx.stroke();
    // Ribs
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(x, y - 10 - i * 7); ctx.lineTo(x - 10, y - 8 - i * 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - 10 - i * 7); ctx.lineTo(x + 10, y - 8 - i * 7); ctx.stroke();
    }
    // Arms
    ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x - 16, y - 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x + 16, y - 10); ctx.stroke();
    // Skull
    ctx.fillStyle = '#e8e8d0';
    ctx.beginPath(); ctx.arc(x, y - 38, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(x - 4, y - 40, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4, y - 40, 3, 0, Math.PI * 2); ctx.fill();

  } else if (m.type === 'dark_mage') {
    // Robe
    ctx.fillStyle = '#2d0050';
    ctx.beginPath();
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x + 14, y);
    ctx.lineTo(x + 10, y - 30);
    ctx.lineTo(x - 10, y - 30);
    ctx.closePath();
    ctx.fill();
    // Hood
    ctx.fillStyle = '#1a0030';
    ctx.beginPath(); ctx.arc(x, y - 36, 12, 0, Math.PI * 2); ctx.fill();
    // Eyes glow
    ctx.fillStyle = '#cc00ff';
    ctx.beginPath(); ctx.arc(x - 4, y - 38, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4, y - 38, 3, 0, Math.PI * 2); ctx.fill();
    // Staff
    ctx.strokeStyle = '#6a0dad';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x - 20, y - 44); ctx.stroke();
    ctx.fillStyle = '#cc00ff';
    ctx.beginPath(); ctx.arc(x - 20, y - 46, 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = '#cc00ff';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(x - 20, y - 46, 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

  } else if (m.type === 'dragon_boss') {
    // Wings
    ctx.fillStyle = 'rgba(180,20,20,0.6)';
    ctx.beginPath();
    ctx.moveTo(x, y - 20);
    ctx.lineTo(x - 50, y - 50);
    ctx.lineTo(x - 30, y - 10);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y - 20);
    ctx.lineTo(x + 50, y - 50);
    ctx.lineTo(x + 30, y - 10);
    ctx.closePath();
    ctx.fill();
    // Body
    ctx.fillStyle = '#8b0000';
    ctx.beginPath(); ctx.ellipse(x, y - 14, 22, 28, 0, 0, Math.PI * 2); ctx.fill();
    // Head
    ctx.fillStyle = '#a00000';
    ctx.beginPath(); ctx.ellipse(x, y - 46, 16, 14, 0, 0, Math.PI * 2); ctx.fill();
    // Horns
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 10, y - 56); ctx.lineTo(x - 16, y - 70); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 10, y - 56); ctx.lineTo(x + 16, y - 70); ctx.stroke();
    // Eyes
    ctx.fillStyle = '#ff4400';
    ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(x - 6, y - 48, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 6, y - 48, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // HP bar
  const bw = Math.max(36, m.size * 0.8);
  ctx.fillStyle = '#333';
  ctx.fillRect(x - bw/2, y - m.size - 14, bw, 5);
  ctx.fillStyle = m.hp / m.maxHp > 0.5 ? '#2ecc71' : m.hp / m.maxHp > 0.25 ? '#f39c12' : '#e74c3c';
  ctx.fillRect(x - bw/2, y - m.size - 14, bw * (m.hp / m.maxHp), 5);

  // Name
  ctx.fillStyle = '#ffaaaa';
  ctx.font = '10px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText(m.name, x, y - m.size - 18);
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────
let myId     = null;
let myPlayer = null;   // local authoritative copy
const players  = {};
const monsters = {};

let lastTs    = 0;
let lastEmit  = 0;
let gameRunning = false;

// Input
const keys = {};
let joystickActive = false;
let joystickDx = 0, joystickDy = 0;
let joystickCenterX = 0, joystickCenterY = 0;

// ─── KEYBOARD ─────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Enter') toggleChat();
  if ((e.code === 'Space' || e.code === 'KeyF') && gameRunning) doAttack();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ─── MOBILE DETECTION ─────────────────────────────────────────────────────────
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

function showMobileControls() {
  document.getElementById('joystickBase').style.display    = 'flex';
  document.getElementById('mobileAttackBtn').style.display = 'flex';
  document.getElementById('mobileSkillsWrap').style.display = 'flex';
  document.getElementById('controls').style.display        = 'none';
  document.getElementById('skillBar').style.display        = 'none';
}

// ─── JOYSTICK ─────────────────────────────────────────────────────────────────
const joystickBase  = document.getElementById('joystickBase');
const joystickThumb = document.getElementById('joystickThumb');

joystickBase.addEventListener('touchstart', e => {
  e.preventDefault();
  joystickActive = true;
  const rect = joystickBase.getBoundingClientRect();
  joystickCenterX = rect.left + rect.width  / 2;
  joystickCenterY = rect.top  + rect.height / 2;
}, { passive: false });

joystickBase.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!joystickActive) return;
  const t = e.touches[0];
  let dx = t.clientX - joystickCenterX;
  let dy = t.clientY - joystickCenterY;
  const dist = Math.hypot(dx, dy);
  const maxR = 38;
  if (dist > maxR) { dx = dx / dist * maxR; dy = dy / dist * maxR; }
  joystickDx = dx / maxR;
  joystickDy = dy / maxR;
  joystickThumb.style.left = (60 - 22 + dx) + 'px';
  joystickThumb.style.top  = (60 - 22 + dy) + 'px';
}, { passive: false });

function resetJoystick() {
  joystickActive = false;
  joystickDx = 0; joystickDy = 0;
  joystickThumb.style.left = '38px';
  joystickThumb.style.top  = '38px';
}

joystickBase.addEventListener('touchend',    resetJoystick, { passive: false });
joystickBase.addEventListener('touchcancel', resetJoystick, { passive: false });

// ─── MOBILE ATTACK ────────────────────────────────────────────────────────────
const mobileAttackBtn = document.getElementById('mobileAttackBtn');
mobileAttackBtn.addEventListener('touchstart', e => {
  e.preventDefault();
  e.stopPropagation();
  doAttack();
}, { passive: false });
// Fallback for click too
mobileAttackBtn.addEventListener('click', e => {
  e.preventDefault();
  doAttack();
});

// Mobile skill buttons
document.querySelectorAll('.mob-skill').forEach((btn, i) => {
  btn.addEventListener('touchstart', e => {
    e.preventDefault();
    e.stopPropagation();
    doAttack(); // all skills trigger attack for now
  }, { passive: false });
  btn.addEventListener('click', e => { e.preventDefault(); doAttack(); });
});

// Hasar sayısı (canvas üzerinde yüzen metin)
function spawnDamageNumber(wx, wy, text, color) {
  effects.push({
    type: 'dmg_text',
    wx, wy: wy - 20,
    text, color: color || '#fff',
    life: 1.0, maxLife: 1.0,
    vy: -30
  });
}

// ─── EFFECTS SYSTEM ──────────────────────────────────────────────────────────
const effects = [];

// Genişleyen halka efekti
function spawnRing(wx, wy, color, maxR, duration) {
  effects.push({ type: 'ring', wx, wy, color, r: 0, maxR, life: duration, maxLife: duration });
}

// Ok efekti (başlangıç → hedef yönünde uçar)
function spawnArrow(wx, wy, angle, color, speed) {
  effects.push({ type: 'arrow', wx, wy, angle, color, speed: speed || 400, life: 0.5, maxLife: 0.5 });
}

// Parçacık patlaması
function spawnBurst(wx, wy, color, count) {
  for (let i = 0; i < (count || 8); i++) {
    const angle = (i / (count || 8)) * Math.PI * 2;
    const speed = 60 + Math.random() * 80;
    effects.push({
      type: 'particle',
      wx, wy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      r: 3 + Math.random() * 3,
      life: 0.5 + Math.random() * 0.3,
      maxLife: 0.8
    });
  }
}

// Büyü dalgası (dönen parçacıklar)
function spawnMagicWave(wx, wy, color) {
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    effects.push({
      type: 'magic_orb',
      wx, wy,
      angle,
      radius: 10,
      maxRadius: 50,
      color,
      life: 0.6,
      maxLife: 0.6
    });
  }
}

function updateAndDrawEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    if (e.life <= 0) { effects.splice(i, 1); continue; }

    const alpha = Math.max(0, e.life / e.maxLife);
    const s = serverToScreen(e.wx, e.wy);

    if (e.type === 'ring') {
      // Genişleyen halka
      const progress = 1 - (e.life / e.maxLife);
      e.r = e.maxR * progress;
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 3 * alpha + 1;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, e.r, 0, Math.PI * 2);
      ctx.stroke();
      // İkinci iç halka
      if (e.r > 10) {
        ctx.globalAlpha = alpha * 0.4;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, e.r * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

    } else if (e.type === 'arrow') {
      // Uçan ok
      const traveled = (1 - e.life / e.maxLife) * e.speed * e.maxLife;
      const ax = e.wx + Math.cos(e.angle) * traveled / 10; // server coords
      const ay = e.wy + Math.sin(e.angle) * traveled / 10;
      const as = serverToScreen(ax, ay);
      const tailX = as.x - Math.cos(e.angle) * 20;
      const tailY = as.y - Math.sin(e.angle) * 20;
      ctx.save();
      ctx.globalAlpha = alpha;
      // Ok gövdesi
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(as.x, as.y);
      ctx.stroke();
      // Ok ucu
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(as.x, as.y, 3, 0, Math.PI * 2);
      ctx.fill();
      // Kuyruk iz
      ctx.strokeStyle = 'rgba(255,215,0,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tailX - Math.cos(e.angle) * 15, tailY - Math.sin(e.angle) * 15);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      ctx.restore();

    } else if (e.type === 'particle') {
      // Parçacık
      e.wx += e.vx * dt / 10;
      e.wy += e.vy * dt / 10;
      const ps = serverToScreen(e.wx, e.wy);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = e.color;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(ps.x, ps.y, e.r * alpha, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

    } else if (e.type === 'magic_orb') {
      // Dönen büyü küreleri
      const progress = 1 - (e.life / e.maxLife);
      e.radius = 10 + (e.maxRadius - 10) * progress;
      e.angle += dt * 8;
      const ox = e.wx + Math.cos(e.angle) * e.radius / 10;
      const oy = e.wy + Math.sin(e.angle) * e.radius / 10;
      const os = serverToScreen(ox, oy);
      ctx.save();
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = e.color;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(os.x, os.y, 4 * alpha + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

    } else if (e.type === 'dmg_text') {
      e.wy += e.vy * dt / 10;
      const ds = serverToScreen(e.wx, e.wy);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${14 + (1 - alpha) * 4}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillStyle = e.color;
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText(e.text, ds.x, ds.y);
      ctx.restore();
    }
  }
}

// ─── ATTACK ───────────────────────────────────────────────────────────────────
let lastAttackTime = 0;
function doAttack() {
  if (!myPlayer || !gameRunning) return;
  const now = Date.now();
  if (now - lastAttackTime < 500) return;
  lastAttackTime = now;
  socket.emit('attack', {});

  // Sınıfa göre saldırı efekti
  const cls = myPlayer.class || 'warrior';
  const wx = myPlayer.x, wy = myPlayer.y;

  if (cls === 'warrior') {
    // Kılıç darbesi: genişleyen kırmızı halka + parçacıklar
    spawnRing(wx, wy, '#ef4444', 60, 0.4);
    spawnRing(wx, wy, '#fca5a5', 40, 0.3);
    spawnBurst(wx, wy, '#ef4444', 6);
  } else if (cls === 'mage') {
    // Büyü dalgası: dönen mor küreler + halka
    spawnMagicWave(wx, wy, '#c084fc');
    spawnRing(wx, wy, '#a855f7', 70, 0.5);
    spawnBurst(wx, wy, '#c084fc', 10);
  } else if (cls === 'archer') {
    // 3 yönde ok fırlat
    const angles = [-0.3, 0, 0.3];
    angles.forEach(offset => {
      const baseAngle = Math.atan2(joystickDy || 1, joystickDx || 0);
      spawnArrow(wx, wy, baseAngle + offset, '#ffd700', 500);
    });
    spawnRing(wx, wy, '#fbbf24', 30, 0.25);
  } else if (cls === 'rogue') {
    // Hızlı çift bıçak: iki küçük halka + parçacıklar
    spawnRing(wx, wy, '#94a3b8', 45, 0.25);
    spawnRing(wx, wy, '#e2e8f0', 25, 0.2);
    spawnBurst(wx, wy, '#94a3b8', 12);
  }

  // Buton feedback
  mobileAttackBtn.style.transform = 'scale(0.85)';
  setTimeout(() => { mobileAttackBtn.style.transform = ''; }, 150);
}

// ─── CHAT ─────────────────────────────────────────────────────────────────────
let chatOpen = false;
function toggleChat() {
  chatOpen = !chatOpen;
  const row = document.getElementById('chatInputRow');
  const inp = document.getElementById('chatInput');
  row.style.display = chatOpen ? 'flex' : 'none';
  if (chatOpen) inp.focus();
}

document.getElementById('chatSend').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.code === 'Enter') { sendChat(); e.stopPropagation(); }
});

function sendChat() {
  const inp = document.getElementById('chatInput');
  const msg = inp.value.trim();
  if (msg) { socket.emit('chat', msg); inp.value = ''; }
  toggleChat();
}

function addChatMsg(name, msg) {
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-name">${name}:</span> ${msg}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  // Remove old messages
  while (box.children.length > 20) box.removeChild(box.firstChild);
}

// ─── HUD UPDATE ───────────────────────────────────────────────────────────────
function updateHUD() {
  if (!myPlayer) return;
  const hp = myPlayer.hp, maxHp = myPlayer.maxHp;
  const mp = myPlayer.mp || 100, maxMp = myPlayer.maxMp || 100;
  const exp = myPlayer.exp || 0, expNeeded = myPlayer.expNeeded || 100;

  document.getElementById('hpBar').style.width  = Math.max(0, hp / maxHp * 100) + '%';
  document.getElementById('mpBar').style.width  = Math.max(0, mp / maxMp * 100) + '%';
  document.getElementById('expBar').style.width = Math.max(0, exp / expNeeded * 100) + '%';
  document.getElementById('hpVal').textContent  = `${Math.max(0,hp)}/${maxHp}`;
  document.getElementById('mpVal').textContent  = `${mp}/${maxMp}`;
  document.getElementById('expVal').textContent = `${exp}/${expNeeded}`;
  document.getElementById('charName').textContent  = myPlayer.name;
  document.getElementById('charLevel').textContent = `Sv.${myPlayer.level}`;
}

// ─── MINIMAP ──────────────────────────────────────────────────────────────────
const miniCanvas = document.getElementById('minimap');
const miniCtx    = miniCanvas.getContext('2d');
const MINI_W = 130, MINI_H = 130;
const MINI_SCALE = MINI_W / (MAP_TILES);

function drawMinimap() {
  miniCtx.fillStyle = '#0a0010';
  miniCtx.fillRect(0, 0, MINI_W, MINI_H);

  // Tiles
  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      miniCtx.fillStyle = TILE_MINI[tileMap[ty][tx]];
      miniCtx.fillRect(tx * MINI_SCALE, ty * MINI_SCALE, MINI_SCALE + 0.5, MINI_SCALE + 0.5);
    }
  }

  // Other players
  for (const id in players) {
    const p = players[id];
    const mx = (p.x / 40) * MINI_SCALE;
    const my = (p.y / 40) * MINI_SCALE;
    miniCtx.fillStyle = id === myId ? '#ffd700' : '#4af';
    miniCtx.beginPath();
    miniCtx.arc(mx, my, id === myId ? 3 : 2, 0, Math.PI * 2);
    miniCtx.fill();
  }

  // Monsters
  for (const id in monsters) {
    const m = monsters[id];
    const mx = (m.x / 40) * MINI_SCALE;
    const my = (m.y / 40) * MINI_SCALE;
    miniCtx.fillStyle = m.type === 'dragon_boss' ? '#ff4400' : '#f44';
    miniCtx.beginPath();
    miniCtx.arc(mx, my, m.type === 'dragon_boss' ? 3 : 1.5, 0, Math.PI * 2);
    miniCtx.fill();
  }
}

// ─── GAME LOOP ────────────────────────────────────────────────────────────────
function gameLoop(ts) {
  requestAnimationFrame(gameLoop);
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  if (!myPlayer) return;

  // 1. Move player
  let dx = 0, dy = 0;
  if (keys['KeyW'] || keys['ArrowUp'])    dy -= 1;
  if (keys['KeyS'] || keys['ArrowDown'])  dy += 1;
  if (keys['KeyA'] || keys['ArrowLeft'])  dx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

  dx += joystickDx;
  dy += joystickDy;

  const len = Math.hypot(dx, dy);
  if (len > 0) {
    dx /= len; dy /= len;
    myPlayer.x = Math.max(20, Math.min(3180, myPlayer.x + dx * SPEED * dt));
    myPlayer.y = Math.max(20, Math.min(3180, myPlayer.y + dy * SPEED * dt));

    // Emit throttled
    const now = Date.now();
    if (now - lastEmit > 80) {
      lastEmit = now;
      const dir = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down'  : 'up');
      socket.emit('move', { x: myPlayer.x, y: myPlayer.y, dir });
    }
  }

  // 2. Update camera target = player iso position
  const isoPos = serverToIso(myPlayer.x, myPlayer.y);
  const targetX = isoPos.x;
  const targetY = isoPos.y;

  // 3. Lerp camera
  cam.x += (targetX - cam.x) * 0.1;
  cam.y += (targetY - cam.y) * 0.1;

  // 4. Clear canvas
  ctx.fillStyle = '#0a0010';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 5. Draw tiles (visible only)
  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      drawTile(tx, ty, tileMap[ty][tx]);
    }
  }

  // 6. Collect all entities, sort by iso Y (depth)
  const entities = [];

  for (const id in players) {
    const p = players[id];
    const iso = serverToIso(p.x, p.y);
    entities.push({ depth: iso.y, type: 'player', data: p, isMe: id === myId });
  }

  // Also draw myPlayer (local) if not in players yet
  if (myPlayer && !players[myId]) {
    const iso = serverToIso(myPlayer.x, myPlayer.y);
    entities.push({ depth: iso.y, type: 'player', data: myPlayer, isMe: true });
  }

  for (const id in monsters) {
    const m = monsters[id];
    const iso = serverToIso(m.x, m.y);
    entities.push({ depth: iso.y, type: 'monster', data: m });
  }

  entities.sort((a, b) => a.depth - b.depth);

  for (const e of entities) {
    if (e.type === 'player') {
      const p = e.data;
      drawCharacter(p.x, p.y, p.name, p.hp, p.maxHp, p.class, e.isMe, p.attacking);
    } else {
      drawMonster(e.data);
    }
  }

  // 7. Effects (saldırı animasyonları)
  updateAndDrawEffects(dt);

  // 8. HUD + minimap
  updateHUD();
  drawMinimap();
}

// ─── SOCKET EVENTS ────────────────────────────────────────────────────────────
socket.on('joined', data => {
  myId = socket.id;
  myPlayer = { ...data.player, mp: 100, maxMp: 100 };

  // Init camera immediately to player position
  const iso = serverToIso(myPlayer.x, myPlayer.y);
  cam.x = iso.x;
  cam.y = iso.y;

  // Hide loading
  document.getElementById('loadingOverlay').style.display = 'none';
  gameRunning = true;
});

socket.on('state', data => {
  // Update other players
  for (const p of data.players) {
    if (p.id === myId) {
      // Sync server hp/level but keep local x/y
      if (myPlayer) {
        myPlayer.hp    = p.hp;
        myPlayer.maxHp = p.maxHp;
        myPlayer.level = p.level;
        myPlayer.name  = p.name;
        myPlayer.class = p.class;
      }
    } else {
      players[p.id] = p;
    }
  }

  // Remove disconnected players
  const serverIds = new Set(data.players.map(p => p.id));
  for (const id in players) {
    if (!serverIds.has(id)) delete players[id];
  }

  // Update monsters
  for (const k in monsters) delete monsters[k];
  for (const m of data.monsters) monsters[m.id] = m;
});

socket.on('damaged', data => {
  if (myPlayer) {
    myPlayer.hp = data.hp;
    // Flash red
    canvas.style.boxShadow = '0 0 0 6px rgba(239,68,68,0.8) inset';
    setTimeout(() => { canvas.style.boxShadow = ''; }, 200);
  }
});

socket.on('hitResult', hits => {
  for (const hit of hits) {
    const m = monsters[hit.id];
    if (m) {
      // Düşmana çarpma efekti
      spawnRing(m.x, m.y, '#ff4444', 35, 0.3);
      spawnBurst(m.x, m.y, '#ff8800', 5);
      // Hasar sayısı
      spawnDamageNumber(m.x, m.y, '-' + hit.dmg, '#ffd700');
    }
  }
});

socket.on('expGain', data => {
  if (myPlayer) {
    myPlayer.exp    = data.total;
    myPlayer.expNeeded = data.needed;
  }
});

socket.on('levelUp', data => {
  if (myPlayer) {
    myPlayer.level = data.level;
    myPlayer.hp    = data.hp;
    myPlayer.maxHp = data.maxHp;
  }
  const popup = document.getElementById('levelUpPopup');
  popup.style.display = 'block';
  popup.textContent = `⬆️ SEVİYE ${data.level} OLDU!`;
  setTimeout(() => { popup.style.display = 'none'; }, 2500);
});

socket.on('died', () => {
  const ds = document.getElementById('deathScreen');
  ds.style.display = 'flex';
  let t = 5;
  document.getElementById('respawnTimer').textContent = t;
  const iv = setInterval(() => {
    t--;
    document.getElementById('respawnTimer').textContent = t;
    if (t <= 0) clearInterval(iv);
  }, 1000);
});

socket.on('respawned', data => {
  document.getElementById('deathScreen').style.display = 'none';
  if (myPlayer) {
    myPlayer.hp = data.hp;
    myPlayer.x  = data.x;
    myPlayer.y  = data.y;
    // Snap camera
    const iso = serverToIso(myPlayer.x, myPlayer.y);
    cam.x = iso.x;
    cam.y = iso.y;
  }
});

socket.on('chat', data => {
  addChatMsg(data.name, data.msg);
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
let selectedClass = 'warrior';

document.querySelectorAll('.class-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedClass = card.dataset.class;
  });
});

document.getElementById('startBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim() || 'Maceracı';

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display  = 'block';

  // Show loading
  const lo = document.getElementById('loadingOverlay');
  lo.style.display = 'flex';

  // Resize canvas now that container is visible
  resize();

  if (isTouch) showMobileControls();

  socket.emit('join', { name, class: selectedClass });
  requestAnimationFrame(gameLoop);
});
