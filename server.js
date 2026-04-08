const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const players = {};
const monsters = {};
let monsterIdCounter = 0;

const MAP_W = 3200;
const MAP_H = 3200;

const MONSTER_TYPES = [
  { type: 'goblin',      name: 'Orman Goblini',  hp: 80,   maxHp: 80,   atk: 4,  exp: 20,  size: 30 },
  { type: 'orc',         name: 'Ork Savaşçısı',  hp: 250,  maxHp: 250,  atk: 8,  exp: 90,  size: 46 },
  { type: 'skeleton',    name: 'İskelet',         hp: 150,  maxHp: 150,  atk: 6,  exp: 45,  size: 38 },
  { type: 'dark_mage',   name: 'Karanlık Büyücü', hp: 200,  maxHp: 200,  atk: 10, exp: 120, size: 42 },
  { type: 'dragon_boss', name: 'Kadim Ejderha',   hp: 1200, maxHp: 1200, atk: 18, exp: 500, size: 80 },
];

function spawnMonster() {
  const t = MONSTER_TYPES[Math.floor(Math.random() * MONSTER_TYPES.length)];
  const id = 'm' + (monsterIdCounter++);
  monsters[id] = {
    id,
    ...JSON.parse(JSON.stringify(t)),
    x: 200 + Math.random() * (MAP_W - 400),
    y: 200 + Math.random() * (MAP_H - 400),
    vx: 0, vy: 0,
    target: null,
    lastAttack: 0,
    respawnTimer: 0,
    alive: true,
  };
}

for (let i = 0; i < 60; i++) spawnMonster();

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const TICK = 100;
setInterval(() => {
  const now = Date.now();

  // Monster AI
  for (const id in monsters) {
    const m = monsters[id];
    if (!m.alive) {
      m.respawnTimer -= TICK;
      if (m.respawnTimer <= 0) {
        const t = MONSTER_TYPES.find(x => x.type === m.type);
        m.hp = t.maxHp;
        m.alive = true;
        m.x = 200 + Math.random() * (MAP_W - 400);
        m.y = 200 + Math.random() * (MAP_H - 400);
      }
      continue;
    }

    // Find nearest player — ama her canavar farklı oyuncuyu tercih etsin
    // Önce mevcut hedefini kontrol et, yakınsa devam et
    let nearest = null, nearestDist = 300;
    const playerList = Object.values(players).filter(p => p.joined && !p.dead);

    // Mevcut hedef hâlâ yakınsa ona devam et (hedef değiştirme sıklığını azalt)
    if (m.target && players[m.target] && players[m.target].joined) {
      const d = dist(m, players[m.target]);
      if (d < 350) {
        nearest = players[m.target];
        nearestDist = d;
      }
    }

    // Hedef yoksa veya çok uzaksa en yakın oyuncuyu bul
    // Ama aynı oyuncuya çok fazla canavar yığılmasın diye
    // her canavarın ID'sine göre farklı öncelik ver
    if (!nearest) {
      const mHash = parseInt(id.replace('m', '')) || 0;
      // Oyuncuları karıştır (canavar ID'sine göre farklı sıra)
      const shuffled = [...playerList].sort((a, b) => {
        const hashA = (a.id.charCodeAt(0) + mHash) % 100;
        const hashB = (b.id.charCodeAt(0) + mHash) % 100;
        return hashA - hashB;
      });
      for (const p of shuffled) {
        const d = dist(m, p);
        if (d < nearestDist) { nearest = p; nearestDist = d; break; }
      }
    }

    if (nearest) {
      m.target = nearest.id;
      const dx = nearest.x - m.x;
      const dy = nearest.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d > 50) {
        const speed = 0.9; // daha yavaş
        m.x += (dx / d) * speed * (TICK / 16);
        m.y += (dy / d) * speed * (TICK / 16);
      } else {
        // Attack — 2.5 saniyede bir
        if (now - m.lastAttack > 2500) {
          m.lastAttack = now;
          const dmg = m.atk + Math.floor(Math.random() * 3);
          nearest.hp -= dmg;
          if (nearest.hp < 0) nearest.hp = 0;
          // Sadece oyuncu join ettiyse ve ölü değilse hasar gönder
          if (nearest.joined && !nearest.dead) {
            io.to(nearest.id).emit('damaged', { dmg, hp: nearest.hp });
            // Ölüm kontrolü
            if (nearest.hp <= 0 && !nearest.dead) {
              nearest.dead = true;
              io.to(nearest.id).emit('died');
              // 5 saniye sonra respawn — güvenli bölgede
              setTimeout(() => {
                if (players[nearest.id]) {
                  players[nearest.id].hp = players[nearest.id].maxHp;
                  players[nearest.id].dead = false;
                  // Başlangıç bölgesine respawn
                  players[nearest.id].x = 1400 + Math.random() * 400;
                  players[nearest.id].y = 1400 + Math.random() * 400;
                  io.to(nearest.id).emit('respawned', {
                    hp: players[nearest.id].hp,
                    x: players[nearest.id].x,
                    y: players[nearest.id].y
                  });
                }
              }, 5000);
            }
          }
        }
      }
    } else {
      // Wander
      if (Math.random() < 0.02) {
        m.vx = (Math.random() - 0.5) * 1.5;
        m.vy = (Math.random() - 0.5) * 1.5;
      }
      m.x = Math.max(50, Math.min(MAP_W - 50, m.x + m.vx));
      m.y = Math.max(50, Math.min(MAP_H - 50, m.y + m.vy));
    }
  }

  io.emit('state', {
    players: Object.values(players).map(p => ({
      id: p.id, x: p.x, y: p.y, name: p.name, hp: p.hp, maxHp: p.maxHp,
      level: p.level, class: p.class, dir: p.dir, attacking: p.attacking
    })),
    monsters: Object.values(monsters).filter(m => m.alive).map(m => ({
      id: m.id, x: m.x, y: m.y, type: m.type, name: m.name,
      hp: m.hp, maxHp: m.maxHp, size: m.size
    }))
  });
}, TICK);

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', (data) => {
    players[socket.id] = {
      id: socket.id,
      name: data.name || 'Maceracı',
      class: data.class || 'warrior',
      x: 400 + Math.random() * 400,
      y: 400 + Math.random() * 400,
      hp: 200, maxHp: 200,
      level: 1, exp: 0, expNeeded: 100,
      atk: 20, def: 5,
      dir: 'down',
      attacking: false,
      lastAttack: 0,
      joined: false,
    };
    socket.emit('joined', { player: players[socket.id], mapW: MAP_W, mapH: MAP_H });
    // 1 saniye sonra hasar almaya başlar
    setTimeout(() => {
      if (players[socket.id]) players[socket.id].joined = true;
    }, 1000);
  });

  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p) return;
    p.x = Math.max(20, Math.min(MAP_W - 20, data.x));
    p.y = Math.max(20, Math.min(MAP_H - 20, data.y));
    p.dir = data.dir || p.dir;
  });

  socket.on('attack', (data) => {
    const p = players[socket.id];
    if (!p) return;
    const now = Date.now();
    if (now - p.lastAttack < 600) return;
    p.lastAttack = now;
    p.attacking = true;
    setTimeout(() => { if (players[socket.id]) players[socket.id].attacking = false; }, 300);

    // Hit nearby monsters
    const hits = [];
    for (const mid in monsters) {
      const m = monsters[mid];
      if (!m.alive) continue;
      if (dist(p, m) < 150) {
        const dmg = p.atk + Math.floor(Math.random() * 10);
        m.hp -= dmg;
        hits.push({ id: mid, dmg });
        if (m.hp <= 0) {
          m.alive = false;
          m.respawnTimer = 8000;
          // Give exp
          p.exp += m.exp;
          socket.emit('expGain', { exp: m.exp, total: p.exp, needed: p.expNeeded });
          // Level up check
          while (p.exp >= p.expNeeded) {
            p.exp -= p.expNeeded;
            p.level++;
            p.expNeeded = Math.floor(p.expNeeded * 1.5);
            p.maxHp += 30;
            p.hp = p.maxHp;
            p.atk += 5;
            p.def += 2;
            socket.emit('levelUp', { level: p.level, hp: p.hp, maxHp: p.maxHp, atk: p.atk });
          }
        }
      }
    }
    if (hits.length) socket.emit('hitResult', hits);
  });

  socket.on('chat', (msg) => {
    const p = players[socket.id];
    if (!p) return;
    io.emit('chat', { name: p.name, msg: msg.slice(0, 80) });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    console.log('Player disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3011;
server.listen(PORT, () => {
  console.log(`Gölge Diyarı Online çalışıyor - port ${PORT}`);

  // Self-ping: Render free plan'da uyumasın diye her 14 dakikada bir kendine istek at
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_URL) {
    const https = require('https');
    setInterval(() => {
      https.get(RENDER_URL, (res) => {
        console.log(`[Self-ping] ${new Date().toISOString()} - ${res.statusCode}`);
      }).on('error', (e) => {
        console.log(`[Self-ping hata] ${e.message}`);
      });
    }, 14 * 60 * 1000); // 14 dakika
    console.log(`Self-ping aktif: ${RENDER_URL}`);
  }
});
