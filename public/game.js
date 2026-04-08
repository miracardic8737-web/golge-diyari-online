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

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4, 18, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(x, y - 10, 12, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#f5cba7';
  ctx.beginPath();
  ctx.arc(x, y - 28, 9, 0, Math.PI * 2);
  ctx.fill();

  // Class weapon
  if (cls === 'warrior') {
    ctx.strokeStyle = attacking ? '#ff6b6b' : '#aaa';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 10, y - 20);
    ctx.lineTo(x + 22, y - 38);
    ctx.stroke();
  } else if (cls === 'mage') {
    ctx.strokeStyle = attacking ? '#da8fff' : '#9b59b6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 20);
    ctx.lineTo(x - 22, y - 40);
    ctx.stroke();
    ctx.fillStyle = attacking ? '#ff88ff' : '#c39bd3';
    ctx.beginPath();
    ctx.arc(x - 22, y - 42, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (cls === 'archer') {
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 14, y - 24, 10, -0.8, 0.8);
    ctx.stroke();
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 14, y - 34);
    ctx.lineTo(x + 14, y - 14);
    ctx.stroke();
  } else if (cls === 'rogue') {
    ctx.strokeStyle = attacking ? '#aaa' : '#666';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 8, y - 18);
    ctx.lineTo(x + 18, y - 30);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 10, y - 22);
    ctx.lineTo(x + 20, y - 28);
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

// ─── ATTACK ───────────────────────────────────────────────────────────────────
let lastAttackTime = 0;
function doAttack() {
  if (!myPlayer || !gameRunning) return;
  const now = Date.now();
  if (now - lastAttackTime < 500) return;
  lastAttackTime = now;
  socket.emit('attack', {});
  // Visual feedback - flash attack button
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

  // 7. HUD + minimap
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
  // Could show damage numbers — skip for now
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
