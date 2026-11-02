/**
 * ASCII shark ocean, painted on a full-window canvas that sits behind the
 * Harness UI. Ported from stackedlol/ascii-sharks (world + renderer), trimmed
 * to run as a self-contained client plugin module.
 *
 * The canvas is mounted as the first child of <body> at z-index 0 and the app
 * root is lifted to z-index 1, so the ocean shows through every surface the
 * theme leaves transparent (see style.css for the scrim rules).
 */
window.__ModuleLoader__.load({
  id: 'dsh-shark-bg',
  factory(require) {
    'use strict';
    const React = require('react');
    const { useCallback, useEffect, useState } = React;

    // ── math ────────────────────────────────────────────────────────────
    const TAU = Math.PI * 2;
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const rand = (lo, hi) => lo + Math.random() * (hi - lo);
    const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));

    function smoothstep(e0, e1, x) {
      const t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    }

    function angleDiff(a, b) {
      let d = (b - a) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return d;
    }

    function hash3(x, y, z) {
      let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    }

    const K1 = 1 / 260;
    const K2 = 1 / 310;
    const K3 = 1 / 190;
    const CURRENT_SCALE = 3400;

    /** Divergence-free ocean current: the curl of a drifting stream function. */
    function current(x, y, t, out) {
      const a = x * K1 + t * 0.07;
      const b = y * K2 - t * 0.05;
      const c = (x + y) * K3 + t * 0.11;
      out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
      out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
      return out;
    }

    // ── species ─────────────────────────────────────────────────────────
    const SPECIES = [
      { name: 'sardine', cruise: 36, maxSpeed: 64, minSpeed: 18, weight: 3, schoolSize: [18, 28], spacing: [1.8, 1.1], align: 1.6, cohesion: 1.6, jitter: 40, mill: 70, verticalDrag: 0.5 },
      { name: 'anchovy', cruise: 46, maxSpeed: 78, minSpeed: 22, weight: 3, schoolSize: [20, 32], spacing: [1.5, 1], align: 3.2, cohesion: 0.45, jitter: 30, mill: 0, verticalDrag: 1.4 },
      { name: 'silverside', cruise: 40, maxSpeed: 70, minSpeed: 20, weight: 3, schoolSize: [12, 20], spacing: [2, 1.1], align: 2.4, cohesion: 1.1, jitter: 35, mill: 0, verticalDrag: 1.6 },
      { name: 'mackerel', cruise: 32, maxSpeed: 60, minSpeed: 16, weight: 2, schoolSize: [5, 9], spacing: [2.6, 1.3], align: 2, cohesion: 0.9, jitter: 25, mill: 0, verticalDrag: 2 },
      { name: 'goby', cruise: 26, maxSpeed: 56, minSpeed: 10, weight: 1, schoolSize: [8, 12], spacing: [1.4, 1.1], align: 0.35, cohesion: 1.4, jitter: 110, mill: 0, verticalDrag: 0.3 },
    ];
    const TOTAL_WEIGHT = SPECIES.reduce((sum, s) => sum + s.weight, 0);
    function pickSpecies() {
      let r = Math.random() * TOTAL_WEIGHT;
      for (let i = 0; i < SPECIES.length; i++) {
        r -= SPECIES[i].weight;
        if (r <= 0) return i;
      }
      return 0;
    }

    // ── world ───────────────────────────────────────────────────────────
    const SHARK_NODES = 20;
    const FISH_SEPARATION_K = 420;
    const FISH_ALIGN_K = 1.4;
    const FISH_COHESION_K = 1;
    const FISH_FLEE_K = 1100;
    const BLIND_COS = -0.6;

    /**
     * The cast, largest first. `sharkCount` takes the first N of these, so a
     * bigger number adds the smaller species instead of cloning the big one.
     */
    const SHARK_CAST = [
      { kind: 'classic', size: 1 },
      { kind: 'classic', size: 0.74 },
      { kind: 'hammerhead', size: 0.88 },
      { kind: 'tiger', size: 0.8 },
      { kind: 'mako', size: 0.62 },
      { kind: 'zebra', size: 0.56 },
      { kind: 'thresher', size: 0.82 },
      { kind: 'nurse', size: 0.7 },
      { kind: 'greathammer', size: 0.9 },
      { kind: 'classic', size: 0.46 },
      { kind: 'mako', size: 0.4 },
      { kind: 'zebra', size: 0.34 },
    ];

    /** Pick `count` sharks from the cast, cycling when more are asked for. */
    function sharksFor(count) {
      const out = [];
      for (let i = 0; i < count; i++) out.push(SHARK_CAST[i % SHARK_CAST.length]);
      return out;
    }

    class World {
      constructor(sharkSpecs, fishCount) {
        this.sharkSpecs = sharkSpecs;
        this.fishCount = fishCount;
        /** 游动速度倍率：1 是原始速度。 */
        this.speed = 1;
        /** 鱼群密度（百分比），45 与原始版本相当。 */
        this.fishDensity = 45;
        /** 鲨鱼体型倍率：1 是默认尺寸。 */
        this.sharkScale = 1;
        this.width = 0;
        this.height = 0;
        this.time = 0;
        this.fish = [];
        this.sharks = [];
        this.events = [];
        this.pointer = { x: 0, y: 0, active: false };
        this.perception = 60;
        this.sepX = [];
        this.sepY = [];
        this.foreignSep = 40;
        this.bucketCols = 0;
        this.bucketRows = 0;
        this.bucketHead = new Int32Array(0);
        this.bucketCount = new Uint16Array(0);
        this.bucketNext = new Int32Array(0);
        this.lastSpawn = 0;
        this.tmp = { x: 0, y: 0 };
      }

      resize(width, height, cellW, cellH) {
        const first = this.width === 0;
        this.width = width;
        this.height = height;
        this.sepX = SPECIES.map((sp) => sp.spacing[0] * cellW);
        this.sepY = SPECIES.map((sp) => sp.spacing[1] * cellH);
        this.perception = Math.max(cellH * 3, cellW * 5.5);
        this.foreignSep = cellW * 3;
        if (first || this.fish.length === 0) {
          this.seed();
          return;
        }
        for (const f of this.fish) {
          f.x = clamp(f.x, 0, width);
          f.y = clamp(f.y, 0, height);
        }
      }

      seed() {
        const W = this.width;
        const H = this.height;
        const minSide = Math.min(W, H);
        const baseLength = clamp(minSide * 0.34, 150, 380) * this.sharkScale;
        const sharkCount = this.sharkSpecs.length;

        this.sharks = [];
        for (let i = 0; i < sharkCount; i++) {
          const spec = this.sharkSpecs[i];
          const length = baseLength * spec.size;
          const orbitRadius = minSide * rand(0.28, 0.4);
          const a = (i / sharkCount) * TAU + rand(-0.4, 0.4);
          const orbitDir = i % 2 === 0 ? 1 : -1;
          const x = W / 2 + Math.cos(a) * orbitRadius * (W / minSide) * 0.9;
          const y = H / 2 + Math.sin(a) * orbitRadius;
          const heading = a + (orbitDir * Math.PI) / 2;
          const nodes = new Float32Array(SHARK_NODES * 2);
          const seg = length / (SHARK_NODES - 1);
          for (let n = 0; n < SHARK_NODES; n++) {
            nodes[n * 2] = x - Math.cos(heading) * seg * n;
            nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
          }
          this.sharks.push({
            id: i + 1,
            kind: spec.kind,
            length,
            nodes,
            heading,
            speed: 30,
            phase: rand(0, TAU),
            turn: 0,
            hunger: rand(0.25, 0.75),
            wander: 0,
            orbitDir,
            orbitRadius,
            target: null,
            retargetAt: 0,
            depth: spec.size,
          });
        }
        // Smaller (farther) sharks draw first so the big one swims over them.
        this.sharks.sort((a, b) => a.length - b.length);

        const total = this.fishCount ?? clamp(
          Math.round(((W * H) / 9000) * (this.fishDensity / 45)),
          0,
          400,
        );
        this.fish = [];
        while (this.fish.length < total) {
          const species = pickSpecies();
          const sp = SPECIES[species];
          const size = Math.min(randInt(sp.schoolSize[0], sp.schoolSize[1]), total - this.fish.length);
          const millDir = Math.random() < 0.5 ? 1 : -1;
          const cx = rand(W * 0.06, W * 0.94);
          const cy = rand(H * 0.08, H * 0.92);
          const dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5);
          for (let k = 0; k < size; k++) {
            this.fish.push({
              x: cx + rand(-1, 1) * this.sepX[species] * Math.sqrt(size),
              y: cy + rand(-1, 1) * this.sepY[species] * Math.sqrt(size) * 0.6,
              vx: Math.cos(dir) * sp.cruise,
              vy: Math.sin(dir) * sp.cruise,
              species,
              alarm: 0,
              alive: true,
              respawnAt: 0,
              phase: rand(0, TAU),
              turn: 0,
              depth: rand(0.55, 1),
              millDir,
            });
          }
        }
        this.bucketNext = new Int32Array(this.fish.length);
      }

      splash(x, y) {
        this.events.push({ kind: 'splash', x, y });
        const r = 240;
        for (const f of this.fish) {
          if (!f.alive) continue;
          const dx = f.x - x;
          const dy = f.y - y;
          const d = Math.hypot(dx, dy);
          if (d > r || d < 1e-3) continue;
          const k = (1 - d / r) * 260;
          f.vx += (dx / d) * k;
          f.vy += (dy / d) * k;
          f.alarm = 1;
        }
      }

      step(dt) {
        this.time += dt * this.speed;
        this.rebuildHash();
        this.stepFish(dt * this.speed);
        this.stepSharks(dt * this.speed);
        this.respawn();
      }

      rebuildHash() {
        const size = this.perception;
        const pad = 2;
        this.bucketCols = Math.ceil(this.width / size) + pad * 2;
        this.bucketRows = Math.ceil(this.height / size) + pad * 2;
        const n = this.bucketCols * this.bucketRows;
        if (this.bucketHead.length !== n) {
          this.bucketHead = new Int32Array(n);
          this.bucketCount = new Uint16Array(n);
        }
        this.bucketHead.fill(-1);
        this.bucketCount.fill(0);
        if (this.bucketNext.length !== this.fish.length) this.bucketNext = new Int32Array(this.fish.length);
        for (let i = 0; i < this.fish.length; i++) {
          const f = this.fish[i];
          if (!f.alive) continue;
          const b = this.bucketOf(f.x, f.y);
          this.bucketNext[i] = this.bucketHead[b];
          this.bucketHead[b] = i;
          this.bucketCount[b]++;
        }
      }

      bucketOf(x, y) {
        const size = this.perception;
        const c = clamp(Math.floor(x / size) + 2, 0, this.bucketCols - 1);
        const r = clamp(Math.floor(y / size) + 2, 0, this.bucketRows - 1);
        return r * this.bucketCols + c;
      }

      stepFish(dt) {
        const fish = this.fish;
        const sharks = this.sharks;
        const pointer = this.pointer;
        const W = this.width;
        const H = this.height;
        const time = this.time;
        const R = this.perception;
        const R2 = R * R;
        const foreignSep = this.foreignSep;
        const size = this.perception;
        const cols = this.bucketCols;
        const rows = this.bucketRows;
        const head = this.bucketHead;
        const next = this.bucketNext;
        const cur = this.tmp;
        const calmDecay = Math.exp(-dt * 0.7);
        const contagion = Math.min(1, dt * 6);

        for (let i = 0; i < fish.length; i++) {
          const f = fish[i];
          if (!f.alive) continue;
          const sp = SPECIES[f.species];
          const spread = 1 + 1.8 * f.alarm;
          const sepX = this.sepX[f.species] * spread;
          const sepY = this.sepY[f.species] * spread;

          const speed = Math.hypot(f.vx, f.vy) || 1;
          const hx = f.vx / speed;
          const hy = f.vy / speed;

          let ax = 0;
          let ay = 0;
          let sx = 0;
          let sy = 0;
          let avx = 0;
          let avy = 0;
          let cx = 0;
          let cy = 0;
          let n = 0;
          let neighbourAlarm = 0;

          const bc = clamp(Math.floor(f.x / size) + 2, 0, cols - 1);
          const br = clamp(Math.floor(f.y / size) + 2, 0, rows - 1);
          for (let r = Math.max(0, br - 1); r <= Math.min(rows - 1, br + 1); r++) {
            for (let c = Math.max(0, bc - 1); c <= Math.min(cols - 1, bc + 1); c++) {
              let j = head[r * cols + c];
              while (j !== -1) {
                if (j !== i) {
                  const o = fish[j];
                  const dx = o.x - f.x;
                  const dy = o.y - f.y;
                  const d2 = dx * dx + dy * dy;
                  if (d2 < R2 && d2 > 1e-6) {
                    const d = Math.sqrt(d2);
                    // Blind zone directly behind the fish.
                    if ((dx * hx + dy * hy) / d > BLIND_COS) {
                      const qx = dx / sepX;
                      const qy = dy / sepY;
                      const q2 = qx * qx + qy * qy;
                      if (q2 < 1) {
                        const q = Math.sqrt(q2) || 1e-3;
                        const k = (1 - q) / q;
                        sx -= qx * k;
                        sy -= qy * k;
                      }
                      if (o.species === f.species) {
                        avx += o.vx;
                        avy += o.vy;
                        cx += dx;
                        cy += dy;
                        n++;
                      } else if (d < foreignSep) {
                        const k = ((1 - d / foreignSep) / d) * 0.6;
                        sx -= dx * k;
                        sy -= dy * k;
                      }
                      if (o.alarm > neighbourAlarm) neighbourAlarm = o.alarm;
                    }
                  }
                }
                j = next[j];
              }
            }
          }

          ax += sx * FISH_SEPARATION_K;
          ay += sy * FISH_SEPARATION_K;
          if (n > 0) {
            const alignK = FISH_ALIGN_K * sp.align;
            const cohesionK = FISH_COHESION_K * sp.cohesion * (1 - 0.8 * f.alarm);
            ax += (avx / n - f.vx) * alignK + (cx / n) * cohesionK;
            ay += (avy / n - f.vy) * alignK + (cy / n) * cohesionK;
            if (sp.mill > 0) {
              const cl = Math.hypot(cx, cy) || 1;
              ax += (-cy / cl) * f.millDir * sp.mill * (1 - f.alarm);
              ay += (cx / cl) * f.millDir * sp.mill * (1 - f.alarm);
            }
          }

          // Predators: nearest point on the front half of each shark.
          let fear = 0;
          for (const sh of sharks) {
            const fearR = sh.length * 0.6 + 60;
            let best = Infinity;
            let bx = 0;
            let by = 0;
            for (let k = 0; k <= 12; k += 3) {
              const nx = sh.nodes[k * 2];
              const ny = sh.nodes[k * 2 + 1];
              const d2 = (f.x - nx) ** 2 + (f.y - ny) ** 2;
              if (d2 < best) {
                best = d2;
                bx = nx;
                by = ny;
              }
            }
            const d = Math.sqrt(best);
            if (d >= fearR || d < 1e-3) continue;
            let w = 1 - d / fearR;
            w *= w;
            const awayX = (f.x - bx) / d;
            const awayY = (f.y - by) / d;
            const shx = Math.cos(sh.heading);
            const shy = Math.sin(sh.heading);
            const side = shx * (f.y - sh.nodes[1]) - shy * (f.x - sh.nodes[0]) >= 0 ? 1 : -1;
            ax += (awayX * 0.7 - shy * side * 0.9) * FISH_FLEE_K * w;
            ay += (awayY * 0.7 + shx * side * 0.9) * FISH_FLEE_K * w;
            fear = Math.max(fear, Math.sqrt(w));
          }

          if (pointer.active) {
            const pr = 130;
            const dx = f.x - pointer.x;
            const dy = f.y - pointer.y;
            const d = Math.hypot(dx, dy);
            if (d < pr && d > 1e-3) {
              const w = (1 - d / pr) ** 2;
              ax += (dx / d) * FISH_FLEE_K * w;
              ay += (dy / d) * FISH_FLEE_K * w;
              fear = Math.max(fear, Math.sqrt(w) * 0.8);
            }
          }

          let alarm = Math.max(f.alarm * calmDecay, fear);
          const relayed = neighbourAlarm * 0.86;
          if (relayed > alarm) alarm += (relayed - alarm) * contagion;
          f.alarm = alarm;

          // Soft walls.
          const m = 36;
          if (f.x < m) ax += (m - f.x) * 7;
          else if (f.x > W - m) ax -= (f.x - (W - m)) * 7;
          if (f.y < m) ay += (m - f.y) * 7;
          else if (f.y > H - m) ay -= (f.y - (H - m)) * 7;

          current(f.x, f.y, time, cur);
          ax += cur.x * 0.5 + (Math.random() - 0.5) * sp.jitter;
          ay += cur.y * 0.5 + (Math.random() - 0.5) * sp.jitter;
          ay -= f.vy * sp.verticalDrag * (1 - 0.7 * f.alarm);

          const preferred = sp.cruise * (1 + 1.3 * f.alarm);
          ax += (preferred - speed) * hx * 1.6;
          ay += (preferred - speed) * hy * 1.6;

          const before = Math.atan2(f.vy, f.vx);
          f.vx += ax * dt;
          f.vy += ay * dt;
          const maxSpeed = sp.maxSpeed * (1 + 1.8 * f.alarm);
          const s = Math.hypot(f.vx, f.vy);
          if (s > maxSpeed) {
            f.vx *= maxSpeed / s;
            f.vy *= maxSpeed / s;
          } else if (s < sp.minSpeed && s > 1e-3) {
            f.vx *= sp.minSpeed / s;
            f.vy *= sp.minSpeed / s;
          }
          f.turn += (angleDiff(before, Math.atan2(f.vy, f.vx)) / dt - f.turn) * Math.min(1, dt * 8);
          f.phase += dt * (7 + Math.hypot(f.vx, f.vy) * 0.12);
          f.x = clamp(f.x + f.vx * dt, -60, W + 60);
          f.y = clamp(f.y + f.vy * dt, -60, H + 60);
        }
      }

      stepSharks(dt) {
        const sharks = this.sharks;
        const W = this.width;
        const H = this.height;
        const time = this.time;
        const minSide = Math.min(W, H);
        const cxW = W / 2;
        const cyW = H / 2;

        for (const sh of sharks) {
          const L = sh.length;
          const nodes = sh.nodes;
          const hx = nodes[0];
          const hy = nodes[1];

          sh.hunger = Math.min(1, sh.hunger + dt * 0.03);

          let dx = Math.cos(sh.heading);
          let dy = Math.sin(sh.heading);

          // Wander: a slowly drifting offset on a circle ahead of the snout.
          sh.wander = clamp(sh.wander + (Math.random() - 0.5) * dt * 3.2, -1.1, 1.1);
          dx += Math.cos(sh.heading + sh.wander) * 0.45;
          dy += Math.sin(sh.heading + sh.wander) * 0.45;

          if (time >= sh.retargetAt) {
            sh.target = this.findPrey(sh);
            sh.retargetAt = time + 0.45;
          }
          const t = sh.target;
          let hunting = false;
          let closing = 0;
          if (t && t.alive && sh.hunger > 0.3) {
            const tx = t.x + t.vx * 0.35 - hx;
            const ty = t.y + t.vy * 0.35 - hy;
            const d = Math.hypot(tx, ty) || 1;
            const w = 1.4 + 2.6 * sh.hunger;
            dx += (tx / d) * w;
            dy += (ty / d) * w;
            hunting = true;
            closing = clamp(1 - d / (L * 0.9), 0, 1);
          } else {
            // Patrol: a lazy circuit.
            const rx = (hx - cxW) / (W / minSide);
            const ry = hy - cyW;
            const r = Math.hypot(rx, ry) || 1;
            const radius = sh.orbitRadius * (1 + 0.15 * Math.sin(time * 0.05 + sh.id));
            const radial = clamp((radius - r) / radius, -1, 1);
            dx += ((-ry / r) * sh.orbitDir + (rx / r) * radial * 0.9) * 0.55;
            dy += ((rx / r) * sh.orbitDir + (ry / r) * radial * 0.9) * 0.55;
          }

          // Give other sharks room.
          for (const other of sharks) {
            if (other === sh) continue;
            for (let k = 0; k < SHARK_NODES; k += 4) {
              const ox = hx - other.nodes[k * 2];
              const oy = hy - other.nodes[k * 2 + 1];
              const d = Math.hypot(ox, oy);
              const range = (L + other.length) * 0.45;
              if (d < range && d > 1e-3) {
                const w = (1 - d / range) * 3;
                dx += (ox / d) * w;
                dy += (oy / d) * w;
              }
            }
          }

          // Keep the middle mostly clear: a soft elliptical no-swim zone.
          const ex = (hx - cxW) / (W * 0.3);
          const ey = (hy - cyW) / (H * 0.16);
          const e2 = ex * ex + ey * ey;
          if (e2 < 1) {
            const e = Math.sqrt(e2) || 1e-3;
            const w = (1 - e) * (hunting ? 1 : 2.5);
            dx += (ex / e) * w;
            dy += (ey / e) * w;
          }

          const over = Math.max(-hx, hx - W, -hy, hy - H);
          if (over > -L * 0.05) {
            const w = clamp((over + L * 0.05) / (L * 0.35), 0, 1) * 3.5;
            const toX = cxW - hx;
            const toY = cyW - hy;
            const d = Math.hypot(toX, toY) || 1;
            dx += (toX / d) * w;
            dy += (toY / d) * w;
          }

          const desired = Math.atan2(dy, dx);
          const agility = Math.min(hunting ? 1.7 + closing : 0.8, sh.speed / (L * 0.22));
          const maxTurn = agility * dt;
          const turned = clamp(angleDiff(sh.heading, desired), -maxTurn, maxTurn);
          sh.heading += turned;
          sh.turn += (turned / dt - sh.turn) * Math.min(1, dt * 3);

          const cruise = 30 + L * 0.04;
          const targetSpeed = hunting ? cruise * (1.45 + closing * 1.5) : cruise;
          sh.speed += (targetSpeed - sh.speed) * Math.min(1, dt * 1.1);
          sh.phase += dt * (2 + sh.speed / 24);

          nodes[0] += Math.cos(sh.heading) * sh.speed * dt;
          nodes[1] += Math.sin(sh.heading) * sh.speed * dt;

          // Follow-the-leader spine with a per-joint bend limit.
          const seg = L / (SHARK_NODES - 1);
          const maxBend = 0.16;
          let prevAngle = sh.heading + Math.PI;
          for (let k = 1; k < SHARK_NODES; k++) {
            const px = nodes[(k - 1) * 2];
            const py = nodes[(k - 1) * 2 + 1];
            let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
            angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
            nodes[k * 2] = px + Math.cos(angle) * seg;
            nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
            prevAngle = angle;
          }

          if (sh.hunger > 0.15) {
            const mouthR = L * 0.05 + 8;
            const mx = nodes[0];
            const my = nodes[1];
            for (const f of this.fish) {
              if (!f.alive) continue;
              if ((f.x - mx) ** 2 + (f.y - my) ** 2 < mouthR * mouthR) {
                f.alive = false;
                f.respawnAt = time + rand(3, 8);
                sh.hunger = Math.max(0, sh.hunger - 0.16);
                this.events.push({ kind: 'eat', x: f.x, y: f.y });
              }
            }
          }
        }
      }

      findPrey(sh) {
        const range = sh.length * 0.9 + 160;
        const hx = sh.nodes[0];
        const hy = sh.nodes[1];
        const fx = Math.cos(sh.heading);
        const fy = Math.sin(sh.heading);
        let best = null;
        let bestScore = Infinity;
        let currentScore = Infinity;

        for (const f of this.fish) {
          if (!f.alive) continue;
          const dx = f.x - hx;
          const dy = f.y - hy;
          const d = Math.hypot(dx, dy);
          if (d > range || d < 1e-3) continue;
          const cos = (dx * fx + dy * fy) / d;
          if (cos < 0.2) continue;
          const crowd = this.bucketCount[this.bucketOf(f.x, f.y)];
          const score = d * (1 + (1 - cos) * 0.8) * (1 + crowd * 0.07);
          if (score < bestScore) {
            bestScore = score;
            best = f;
          }
          if (f === sh.target) currentScore = score;
        }
        if (sh.target && currentScore < bestScore * 1.3) return sh.target;
        return best;
      }

      respawn() {
        const time = this.time;
        const W = this.width;
        const H = this.height;
        const due = [];
        for (const f of this.fish) if (!f.alive && f.respawnAt <= time) due.push(f);
        if (due.length === 0) return;
        if (due.length < 6 && time - this.lastSpawn < 9) return;
        this.lastSpawn = time;

        const side = randInt(0, 3);
        const along = rand(0.15, 0.85);
        const x = side === 0 ? -20 : side === 1 ? W + 20 : along * W;
        const y = side === 2 ? -20 : side === 3 ? H + 20 : along * H;
        const inward = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.5, 0.5);
        const species = pickSpecies();
        const sp = SPECIES[species];
        const millDir = Math.random() < 0.5 ? 1 : -1;
        for (const f of due.slice(0, sp.schoolSize[1])) {
          f.alive = true;
          f.species = species;
          f.alarm = 0;
          f.turn = 0;
          f.millDir = millDir;
          f.x = x + rand(-1, 1) * this.perception;
          f.y = y + rand(-1, 1) * this.perception;
          f.vx = Math.cos(inward) * sp.cruise * 1.4;
          f.vy = Math.sin(inward) * sp.cruise * 1.4;
        }
      }
    }

    // ── shark shapes ────────────────────────────────────────────────────
    const ALPHA_LEVELS = 6;
    const FISH_ALPHAS = [0.28, 0.42, 0.58, 0.74, 0.9];
    const DOT_RGB = [[48, 52, 235], [52, 205, 60], [228, 50, 44], [190, 212, 255], [110, 230, 255]];
    const DOT_BASE_ALPHA = [1, 1, 1, 1, 1];
    const WAKE = DOT_RGB.length - 1;
    const ACCENTS = ['#e0892c', '#e03a32', '#b44ae0', '#33c8cc', '#3cb54a', '#3150e8', '#d9c14a'];
    const SKIN_RAMP = ':;t%SX8#@';
    const FIN_GLYPHS = '%;tS:';
    const RIDGE_GLYPHS = '@8%';
    const EDGE_HEAVY = ':;';
    const EDGE_LIGHT = ".',`";
    const FLAG_BODY = 1;
    const FLAG_EDGE = 2;
    const FLAG_FIN = 3;
    const FLAG_RIDGE = 4;
    const FLAG_EYE = 5;
    const FLAG_MARK = 6;
    const MARK_GLYPHS = '#%@';
    const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

    function classicHalfWidth(s) {
      if (s < 0.13) return 0.09 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.95);
      if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
      if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);
      const k = (s - 0.84) / 0.16;
      return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
    }

    const SHAPES = {
      classic: {
        halfWidth: classicHalfWidth,
        pectoral: [0.15, 0.43, 0.55, 0.26],
        falcate: true,
        pelvic: [0.57, 0.65, 0.69, 0.085],
        caudal: 0.085,
        dorsal: [0.33, 0.47],
        secondDorsal: [0.71, 0.76],
        eye: [0.1, 0.14],
        gills: [0.19, 0.29],
        tint: [0.92, 0.97, 1.05],
      },
      hammerhead: {
        halfWidth: (s) => {
          if (s < 0.06) return 0.045;
          if (s < 0.3) return 0.045 + 0.061 * smoothstep(0.06, 0.3, s);
          return classicHalfWidth(s) * 0.92;
        },
        head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
        pectoral: [0.17, 0.4, 0.5, 0.22],
        falcate: true,
        pelvic: [0.56, 0.63, 0.67, 0.075],
        caudal: 0.11,
        dorsal: [0.28, 0.44],
        secondDorsal: [0.7, 0.74],
        eye: null,
        gills: [0.16, 0.26],
        tint: [0.96, 0.98, 0.9],
      },
      tiger: {
        halfWidth: (s) => {
          if (s < 0.13) return 0.1 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.45);
          if (s < 0.3) return 0.1 + 0.014 * smoothstep(0.13, 0.3, s);
          if (s < 0.84) return 0.019 + 0.095 * Math.pow(1 - (s - 0.3) / 0.54, 1.2);
          const k = (s - 0.84) / 0.16;
          return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
        },
        pectoral: [0.15, 0.42, 0.53, 0.25],
        falcate: true,
        pelvic: [0.57, 0.65, 0.69, 0.085],
        caudal: 0.095,
        dorsal: [0.33, 0.46],
        secondDorsal: [0.71, 0.75],
        eye: [0.08, 0.12],
        gills: [0.19, 0.28],
        tint: [1.02, 0.95, 0.84],
      },
      zebra: {
        halfWidth: (s) => {
          if (s < 0.1) return 0.075 * Math.pow(Math.sin(((s / 0.1) * Math.PI) / 2), 0.7);
          if (s < 0.28) return 0.075 + 0.025 * smoothstep(0.1, 0.28, s);
          if (s < 0.55) return 0.022 + 0.078 * Math.pow(1 - (s - 0.28) / 0.27, 1.1);
          const k = (s - 0.55) / 0.45;
          return 0.022 * (1 - k * k) + 0.012 * Math.sin(k * Math.PI);
        },
        pectoral: [0.12, 0.3, 0.36, 0.19],
        falcate: false,
        pelvic: [0.42, 0.48, 0.51, 0.065],
        caudal: 0,
        dorsal: [0.36, 0.44],
        secondDorsal: [0.49, 0.53],
        eye: [0.06, 0.09],
        gills: [0.13, 0.2],
        tint: [1.08, 0.97, 0.74],
      },
      greathammer: {
        halfWidth: (s) => {
          if (s < 0.05) return 0.04;
          if (s < 0.3) return 0.04 + 0.07 * smoothstep(0.05, 0.3, s);
          return classicHalfWidth(s) * 0.95;
        },
        head: { span: 0.21, sweep: 0.006, depth: 0.085, notch: 0.014 },
        pectoral: [0.16, 0.38, 0.49, 0.24],
        falcate: true,
        pelvic: [0.55, 0.62, 0.67, 0.085],
        caudal: 0.13,
        dorsal: [0.24, 0.45],
        secondDorsal: [0.68, 0.74],
        eye: null,
        gills: [0.15, 0.25],
        tint: [0.86, 0.93, 1.02],
      },
      mako: {
        halfWidth: (s) => {
          if (s < 0.17) return 0.088 * Math.pow(Math.sin(((s / 0.17) * Math.PI) / 2), 1.5);
          if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s);
          if (s < 0.86) return 0.014 + 0.086 * Math.pow(1 - (s - 0.32) / 0.54, 1.45);
          const k = (s - 0.86) / 0.14;
          return 0.014 * (1 - k) + 0.01 * Math.sin(k * Math.PI);
        },
        pectoral: [0.18, 0.4, 0.5, 0.21],
        falcate: true,
        pelvic: [0.58, 0.64, 0.68, 0.06],
        caudal: 0.13,
        dorsal: [0.34, 0.45],
        secondDorsal: [0.76, 0.79],
        eye: [0.11, 0.15],
        gills: [0.2, 0.3],
        tint: [0.78, 0.9, 1.2],
      },
      thresher: {
        halfWidth: (s) => {
          if (s < 0.08) return 0.07 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.75);
          if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s);
          if (s < 0.48) return 0.012 + 0.078 * Math.pow(1 - (s - 0.2) / 0.28, 1.3);
          const k = (s - 0.48) / 0.52;
          return 0.012 * (1 - k) + 0.006 * Math.sin(k * Math.PI * 0.9) + 0.002;
        },
        pectoral: [0.12, 0.27, 0.36, 0.2],
        falcate: true,
        pelvic: [0.37, 0.41, 0.44, 0.045],
        caudal: 0,
        dorsal: [0.24, 0.32],
        secondDorsal: [0.45, 0.47],
        eye: [0.05, 0.1],
        gills: [0.11, 0.18],
        tint: [1.0, 0.9, 1.08],
      },
      nurse: {
        halfWidth: (s) => {
          if (s < 0.08) return 0.085 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.4);
          if (s < 0.3) return 0.085 + 0.02 * smoothstep(0.08, 0.3, s);
          if (s < 0.72) return 0.022 + 0.083 * Math.pow(1 - (s - 0.3) / 0.42, 1.1);
          const k = (s - 0.72) / 0.28;
          return 0.022 * (1 - k * k) + 0.014 * Math.sin(k * Math.PI);
        },
        pectoral: [0.16, 0.34, 0.4, 0.17],
        falcate: false,
        pelvic: [0.45, 0.52, 0.55, 0.075],
        caudal: 0,
        dorsal: [0.5, 0.58],
        secondDorsal: [0.63, 0.69],
        eye: [0.05, 0.075],
        gills: [0.14, 0.22],
        tint: [1.1, 0.96, 0.76],
      },
    };
    const KINDS = Object.keys(SHAPES);

    function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
      const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
      const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
      const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      return !(neg && pos);
    }

    // ── renderer ────────────────────────────────────────────────────────
    const DARK_BASE = '#070a0f';
    const DARK_GRID = 'rgba(255,255,255,0.055)';
    const LIGHT_BASE = '#eff4fa';
    const LIGHT_GRID = 'rgba(15,20,28,0.07)';

    class AsciiRenderer {
      constructor(canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('2D canvas unavailable');
        this.canvas = canvas;
        this.ctx = ctx;
        this.bg = document.createElement('canvas');
        this.dpr = 1;
        this.width = 0;
        this.height = 0;
        this.cw = 12;
        this.ch = 18;
        this.cols = 0;
        this.rows = 0;
        this.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        this.dark = true;
        this.gridScale = 1;

        this.dotKind = new Uint8Array(0);
        this.dotPhase = new Float32Array(0);
        this.dotFreq = new Float32Array(0);
        this.energy = new Float32Array(0);
        this.energyTmp = new Float32Array(0);
        this.heat = new Float32Array(0);
        this.bucketOf = new Uint8Array(0);
        this.bucketOrder = new Int32Array(0);
        this.bucketCounts = new Int32Array(DOT_RGB.length * ALPHA_LEVELS + 1);
        this.dotStyles = [];

        this.sharkFlag = new Uint8Array(0);
        this.sharkShade = new Float32Array(0);
        this.sharkKey = new Uint32Array(0);
        this.sharkDepth = new Float32Array(0);
        this.sharkKind = new Uint8Array(0);
        this.sharkShadow = new Uint8Array(0);
        this.spine = new Float32Array(SHARK_NODES * 2);
        this.arc = new Float32Array(SHARK_NODES);
        this.arcTotal = 1;
        this.shape = SHAPES.classic;
        this.sharkId = 0;
        this.finTipLeft = 0;
        this.finTipRight = 0;
        this.hitFlag = 0;
        this.hitShade = 0;
        this.hitS = 0;
        this.hitV = 0;
        this.hitDist = 0;

        this.fishStamp = new Uint32Array(0);
        this.frameId = 0;
        this.fishBuckets = FISH_ALPHAS.map(() => []);
        this.fishStyles = FISH_ALPHAS.map((a) => `rgba(230,238,255,${a})`);

        for (let c = 0; c < DOT_RGB.length; c++) {
          const rgb = DOT_RGB[c];
          for (let l = 0; l < ALPHA_LEVELS; l++) {
            const a = (DOT_BASE_ALPHA[c] * (l + 1)) / ALPHA_LEVELS;
            this.dotStyles.push(`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`);
          }
        }
      }

      setDark(dark) {
        if (this.dark === dark) return;
        this.dark = dark;
        this.fishStyles = FISH_ALPHAS.map((a) => (dark ? `rgba(230,238,255,${a})` : `rgba(26,34,48,${a})`));
        if (this.cols > 0) this.paintBackground();
      }

      /** 网格线明暗倍率：1 是默认，0 表示完全不要网格。 */
      setGridScale(scale) {
        const next = Number.isFinite(scale) ? clamp(scale, 0, 3) : 1;
        if (this.gridScale === next) return;
        this.gridScale = next;
        if (this.cols > 0) this.paintBackground();
      }

      setFontFamily(family) {
        if (family) this.fontFamily = family;
      }

      resize(width, height, dpr) {
        const prevCols = this.cols;
        const prevRows = this.rows;
        this.width = width;
        this.height = height;
        this.dpr = dpr;
        this.cw = clamp(Math.round(width / 124), 8, 13);
        this.ch = Math.round(this.cw * 1.45);
        this.cols = Math.ceil(width / this.cw);
        this.rows = Math.ceil(height / this.ch);

        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.bg.width = this.canvas.width;
        this.bg.height = this.canvas.height;

        const n = this.cols * this.rows;
        if (this.cols !== prevCols || this.rows !== prevRows) {
          this.dotKind = new Uint8Array(n);
          this.dotPhase = new Float32Array(n);
          this.dotFreq = new Float32Array(n);
          this.energy = new Float32Array(n);
          this.energyTmp = new Float32Array(n);
          this.heat = new Float32Array(n);
          this.bucketOf = new Uint8Array(n);
          this.bucketOrder = new Int32Array(n);
          this.sharkFlag = new Uint8Array(n);
          this.sharkShade = new Float32Array(n);
          this.sharkKey = new Uint32Array(n);
          this.sharkDepth = new Float32Array(n);
          this.sharkKind = new Uint8Array(n);
          this.sharkShadow = new Uint8Array(n);
          this.fishStamp = new Uint32Array(n);
        }

        for (let i = 0; i < n; i++) {
          const col = i % this.cols;
          const row = (i / this.cols) | 0;
          this.dotKind[i] = 0;
          this.dotPhase[i] = hash3(col, row, 23) * Math.PI * 2;
          this.dotFreq[i] = 0.3 + hash3(col, row, 37) * 1.1;
        }
        this.paintBackground();
      }

      paintBackground() {
        const g = this.bg.getContext('2d');
        if (!g) return;
        const W = this.width;
        const H = this.height;
        const dpr = this.dpr;
        const cw = this.cw;
        const ch = this.ch;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = this.dark ? DARK_BASE : LIGHT_BASE;
        g.fillRect(0, 0, W, H);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = this.gridScale;
        g.strokeStyle = this.dark ? DARK_GRID : LIGHT_GRID;
        g.lineWidth = 1;
        g.beginPath();
        for (let c = 0; c <= Math.ceil(W / cw); c++) {
          const x = Math.round(c * cw * dpr) + 0.5;
          g.moveTo(x, 0);
          g.lineTo(x, H * dpr);
        }
        for (let r = 0; r <= Math.ceil(H / ch); r++) {
          const y = Math.round(r * ch * dpr) + 0.5;
          g.moveTo(0, y);
          g.lineTo(W * dpr, y);
        }
        g.stroke();
        g.globalAlpha = 1;
      }

      render(world, dt) {
        const ctx = this.ctx;
        const dpr = this.dpr;
        const cols = this.cols;
        const ch = this.ch;
        if (cols === 0) return;
        const t = world.time;

        this.consumeEvents(world);
        this.rasterizeSharks(world.sharks, t);
        this.depositWake(world);
        this.diffuse(dt);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.bg, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.markFish(world);
        this.drawDots(t);

        ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        this.drawHeat();
        this.drawFish();
        this.drawSharks(t);
      }

      cellIndex(x, y) {
        const c = Math.floor(x / this.cw);
        const r = Math.floor(y / this.ch);
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
        return r * this.cols + c;
      }

      stamp(field, x, y, radius, amount) {
        const c0 = Math.floor(x / this.cw);
        const r0 = Math.floor(y / this.ch);
        for (let r = r0 - radius; r <= r0 + radius; r++) {
          for (let c = c0 - radius; c <= c0 + radius; c++) {
            if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
            const d = Math.hypot(c - c0, (r - r0) * 1.4);
            if (d > radius + 0.5) continue;
            const i = r * this.cols + c;
            field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
          }
        }
      }

      consumeEvents(world) {
        for (const e of world.events) {
          if (e.kind === 'eat') {
            this.stamp(this.heat, e.x, e.y, 2, 1);
            this.stamp(this.energy, e.x, e.y, 3, 0.9);
          } else {
            this.stamp(this.energy, e.x, e.y, 6, 1.4);
          }
        }
        world.events.length = 0;
      }

      depositWake(world) {
        const energy = this.energy;
        for (const f of world.fish) {
          if (!f.alive) continue;
          const i = this.cellIndex(f.x, f.y);
          if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.012 + f.alarm * 0.03);
        }
        for (const sh of world.sharks) {
          for (let k = SHARK_NODES - 6; k < SHARK_NODES; k++) {
            const i = this.cellIndex(sh.nodes[k * 2], sh.nodes[k * 2 + 1]);
            if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.05 + sh.speed * 0.0012);
          }
        }
        if (world.pointer.active) this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
      }

      diffuse(dt) {
        const cols = this.cols;
        const rows = this.rows;
        const energy = this.energy;
        const tmp = this.energyTmp;
        const heat = this.heat;
        const decay = Math.exp(-dt * 1.5);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            const l = c > 0 ? energy[i - 1] : energy[i];
            const rt = c < cols - 1 ? energy[i + 1] : energy[i];
            const u = r > 0 ? energy[i - cols] : energy[i];
            const d = r < rows - 1 ? energy[i + cols] : energy[i];
            tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
          }
        }
        this.energy = tmp;
        this.energyTmp = energy;
        const heatDecay = Math.exp(-dt * 2.2);
        for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;
      }

      sampleShark(px, py, L) {
        const spine = this.spine;
        const arc = this.arc;
        const N = SHARK_NODES;
        let best = Infinity;
        let bestS = 0;
        let bestSign = 1;
        let bestNx = 0;
        let bestNy = 0;
        for (let k = 0; k < N - 1; k++) {
          const ax = spine[k * 2];
          const ay = spine[k * 2 + 1];
          const sx = spine[(k + 1) * 2] - ax;
          const sy = spine[(k + 1) * 2 + 1] - ay;
          const len2 = sx * sx + sy * sy || 1;
          const u = clamp(((px - ax) * sx + (py - ay) * sy) / len2, 0, 1);
          const qx = ax + sx * u;
          const qy = ay + sy * u;
          const d2 = (px - qx) ** 2 + (py - qy) ** 2;
          if (d2 < best) {
            best = d2;
            const len = Math.sqrt(len2);
            bestS = (arc[k] + u * len) / this.arcTotal;
            bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
            bestNx = (-sy / len) * bestSign;
            bestNy = (sx / len) * bestSign;
          }
        }

        const a = Math.sqrt(best);
        const s = bestS;
        const u = s * L;
        const shape = this.shape;
        const w = shape.halfWidth(s) * L;
        this.hitDist = a;
        this.hitS = s;
        this.hitV = a * bestSign;

        const head = shape.head;
        if (head && u < L * (head.sweep + head.depth + head.notch)) {
          const span = L * head.span;
          const r = a / span;
          const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14);
          const depth = L * head.depth * (1 - 0.2 * r * r * r * r);
          if (r <= 1 && u >= front && u <= front + depth) {
            this.hitFlag = r > 0.84 ? FLAG_EYE : FLAG_BODY;
            this.hitShade = r > 0.84 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0);
            return true;
          }
        }

        if (a <= w) {
          const across = a / (w || 1);
          const facing = (bestNx * -0.6 + bestNy * -0.8) * across;
          let shade = 0.58 - across * across * 0.42 + facing * 0.26;
          let flag = FLAG_BODY;
          if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) {
            flag = FLAG_RIDGE;
            shade = 1;
          } else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) {
            shade = Math.max(shade, 0.82);
          } else if (shape.eye && s > shape.eye[0] && s < shape.eye[1] && across > 0.6) {
            flag = FLAG_EYE;
            shade = 0;
          } else if (s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {
            if (Math.floor(((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0])) * 5) % 2 === 0) shade *= 0.45;
          } else if (s < 0.05) {
            shade = Math.max(shade, 0.7);
          } else if (shape === SHAPES.zebra && s > 0.08 && s < 0.55 && (across < 0.1 || Math.abs(across - 0.6) < 0.08)) {
            shade = Math.max(shade, 0.8);
          } else if (this.marked(s, a * bestSign, L, across)) {
            flag = FLAG_MARK;
          }
          this.hitFlag = flag;
          this.hitShade = shade;
          return true;
        }

        const tip = bestSign > 0 ? this.finTipRight : this.finTipLeft;
        const p0 = shape.pectoral[0];
        const p1 = shape.pectoral[1];
        const p2 = shape.pectoral[2];
        if (
          inTriangle(u, a, L * p0, 0, L * p1, 0, L * p2, tip) &&
          !(shape.falcate && inTriangle(u, a, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip))
        ) {
          this.hitFlag = this.marked(s, a * bestSign, L, 0) ? FLAG_MARK : FLAG_FIN;
          this.hitShade = 0.38 + 0.22 * (1 - clamp(a / tip, 0, 1));
          return true;
        }
        const v0 = shape.pelvic[0];
        const v1 = shape.pelvic[1];
        const v2 = shape.pelvic[2];
        const vr = shape.pelvic[3];
        if (
          inTriangle(u, a, L * v0, 0, L * v1, 0, L * v2, L * vr) ||
          (shape.caudal > 0 && inTriangle(u, a, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal))
        ) {
          this.hitFlag = FLAG_FIN;
          this.hitShade = 0.36;
          return true;
        }
        return false;
      }

      marked(s, v, L, across) {
        if (this.shape === SHAPES.tiger) {
          if (s < 0.2 || s > 0.9 || across > 0.85) return false;
          const wobble = 0.35 * Math.sin((v / L) * 25 + s * 5);
          const bar = Math.sin(s * Math.PI * 2 * 9 + wobble);
          return bar > 0.65 - 0.5 * smoothstep(0.2, 0.42, s) + 0.4 * smoothstep(0.8, 0.9, s);
        }
        if (this.shape === SHAPES.zebra) {
          if (s < 0.07) return false;
          const gu = (s * L) / (L * 0.06);
          const gv = v / (L * 0.045);
          const cu = Math.floor(gu);
          const cv = Math.floor(gv);
          const jx = hash3(cu, cv, this.sharkId) * 0.5 + 0.25;
          const jy = hash3(cu, cv, this.sharkId + 11) * 0.5 + 0.25;
          return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < 0.08;
        }
        return false;
      }

      rasterizeSharks(sharks, t) {
        const sharkFlag = this.sharkFlag;
        const sharkShade = this.sharkShade;
        const sharkKey = this.sharkKey;
        const sharkDepth = this.sharkDepth;
        const sharkKind = this.sharkKind;
        const sharkShadow = this.sharkShadow;
        const spine = this.spine;
        const arc = this.arc;
        const cw = this.cw;
        const ch = this.ch;
        const cols = this.cols;
        const rows = this.rows;
        sharkFlag.fill(0);
        sharkShadow.fill(0);

        for (const sh of sharks) {
          const L = sh.length;
          const N = SHARK_NODES;
          const n = sh.nodes;
          const swim = clamp(sh.speed / 60, 0.4, 1.4);
          this.shape = SHAPES[sh.kind] || SHAPES.classic;
          this.sharkId = sh.id;
          const kindIndex = KINDS.indexOf(sh.kind);

          for (let k = 0; k < N; k++) {
            const s = k / (N - 1);
            const a = Math.max(0, k - 1);
            const b = Math.min(N - 1, k + 1);
            let tx = n[a * 2] - n[b * 2];
            let ty = n[a * 2 + 1] - n[b * 2 + 1];
            const tl = Math.hypot(tx, ty) || 1;
            tx /= tl;
            ty /= tl;
            const amp = L * 0.05 * (0.1 + 0.9 * Math.pow(s, 1.8)) * swim;
            const off = amp * Math.sin(sh.phase - s * 5.2);
            spine[k * 2] = n[k * 2] - ty * off;
            spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
          }
          arc[0] = 0;
          for (let k = 1; k < N; k++) {
            arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
          }
          this.arcTotal = arc[N - 1] || 1;

          const bank = clamp(sh.turn * 0.45, -0.35, 0.35);
          const flex = 1 + 0.06 * Math.sin(sh.phase * 0.5);
          const reachFin = this.shape.pectoral[3];
          this.finTipRight = L * reachFin * flex * (1 - bank);
          this.finTipLeft = L * reachFin * flex * (1 + bank);

          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (let k = 0; k < N; k++) {
            minX = Math.min(minX, spine[k * 2]);
            maxX = Math.max(maxX, spine[k * 2]);
            minY = Math.min(minY, spine[k * 2 + 1]);
            maxY = Math.max(maxY, spine[k * 2 + 1]);
          }
          const reach = L * 0.36;
          const c0 = Math.max(0, Math.floor((minX - reach) / cw));
          const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
          const r0 = Math.max(0, Math.floor((minY - reach) / ch));
          const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
          if (c0 > c1 || r0 > r1) continue;

          const skipBeyond = reach + Math.hypot(cw, ch);
          const shadowDc = Math.round((L * 0.035) / cw) + 1;
          const shadowDr = Math.round((L * 0.02) / ch) + 1;

          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              const x = c * cw;
              const y = r * ch;
              const centerHit = this.sampleShark(x + cw / 2, y + ch / 2, L);
              if (!centerHit && this.hitDist > skipBeyond) continue;
              const flag = this.hitFlag;
              const shade = this.hitShade;
              const s = this.hitS;
              const v = this.hitV;

              let hits = centerHit ? 1 : 0;
              for (let k = 0; k < SUBSAMPLES.length; k += 2) {
                if (this.sampleShark(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch, L)) hits++;
              }
              if (hits === 0) continue;
              const coverage = hits / 5;

              const i = r * cols + c;
              const key = (hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), sh.id) * 4294967295) >>> 0;
              sharkKey[i] = key;
              sharkDepth[i] = sh.depth;
              sharkKind[i] = kindIndex;

              if (centerHit && coverage >= 0.6) {
                sharkFlag[i] = flag;
                const flicker = (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.06;
                sharkShade[i] = clamp(shade + flicker, 0, 1);
                const sc = c + shadowDc;
                const sr = r + shadowDr;
                if (sc < cols && sr < rows) sharkShadow[sr * cols + sc] = 1;
              } else {
                sharkFlag[i] = FLAG_EDGE;
                sharkShade[i] = coverage;
              }
            }
          }
        }
      }

      drawSharks(t) {
        const ctx = this.ctx;
        const cols = this.cols;
        const rows = this.rows;
        const cw = this.cw;
        const ch = this.ch;
        const sharkFlag = this.sharkFlag;
        const sharkShade = this.sharkShade;
        const sharkKey = this.sharkKey;
        const sharkDepth = this.sharkDepth;
        const sharkKind = this.sharkKind;
        const dark = this.dark;
        const n = cols * rows;
        for (let i = 0; i < n; i++) {
          const flag = sharkFlag[i];
          if (!flag) continue;
          const col = i % cols;
          const row = (i / cols) | 0;
          const x = col * cw;
          const y = row * ch;
          const key = sharkKey[i];
          const shade = sharkShade[i];
          const dim = 0.7 + 0.3 * sharkDepth[i];
          const tint = SHAPES[KINDS[sharkKind[i]] || 'classic'].tint;

          const tick = Math.floor(t * 2.4 + (key % 997) / 97);
          const roll = hash3(key, tick, 7);

          if (flag === FLAG_EDGE) {
            const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
            let color;
            if (roll < 0.07) {
              color = ACCENTS[key % ACCENTS.length];
            } else if (dark) {
              const g = (70 + shade * 80) * dim;
              color = `rgb(${Math.round(g * tint[0])},${Math.round(g * tint[1])},${Math.min(255, Math.round(g * tint[2] + 6))})`;
            } else {
              const g = 255 - (70 + shade * 80) * dim * 0.7;
              color = `rgb(${Math.round(g * tint[0])},${Math.round(g * tint[1])},${Math.round(g * tint[2])})`;
            }
            ctx.fillStyle = color;
            ctx.fillText(set[(key >>> 8) % set.length], x + cw / 2, y + ch / 2 + 1);
            continue;
          }

          let level;
          let glyph;
          if (flag === FLAG_RIDGE) {
            level = 226;
            glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
          } else if (flag === FLAG_EYE) {
            level = 12;
            glyph = 'o';
          } else if (flag === FLAG_MARK) {
            level = 24 + shade * 22;
            glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
          } else if (flag === FLAG_FIN) {
            level = 40 + shade * 120;
            glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
          } else {
            level = 46 + shade * 160;
            const jitter = ((key >>> 4) % 3) - 1;
            glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
          }
          level *= dim;

          if (dark) {
            ctx.fillStyle = `rgb(${Math.min(255, Math.round(level * tint[0]))},${Math.min(255, Math.round(level * tint[1]))},${Math.min(255, Math.round(level * tint[2] + 4))})`;
          } else {
            const g = 255 - level * 0.62;
            ctx.fillStyle = `rgb(${Math.round(g * tint[0])},${Math.round(g * tint[1])},${Math.round(g * tint[2])})`;
          }
          ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

          let color;
          if (flag === FLAG_EYE) color = dark ? '#9aa0ad' : '#5b6472';
          else if (flag === FLAG_MARK) color = dark ? `rgb(${Math.round(70 * tint[0])},${Math.round(70 * tint[1])},${Math.round(70 * tint[2])})` : '#3a4150';
          else if (roll < 0.09) color = ACCENTS[key % ACCENTS.length];
          else if (roll < 0.13) color = dark ? '#ffffff' : '#101318';
          else if (dark) color = shade > 0.55 ? '#0e0f13' : '#1b1d24';
          else color = shade > 0.55 ? '#20252d' : '#3b424e';
          ctx.fillStyle = color;
          ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
        }
      }

      markFish(world) {
        const fishStamp = this.fishStamp;
        const fishBuckets = this.fishBuckets;
        const sharkFlag = this.sharkFlag;
        const frame = ++this.frameId;
        for (const bucket of fishBuckets) bucket.length = 0;
        for (let pass = 0; pass < 2; pass++) {
          for (const f of world.fish) {
            if (!f.alive || (f.depth > 0.78 ? 0 : 1) !== pass) continue;
            const i = this.cellIndex(f.x, f.y);
            if (i < 0 || fishStamp[i] === frame || sharkFlag[i]) continue;
            fishStamp[i] = frame;
            const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1);
            const v = 0.3 + (0.4 * (f.depth - 0.55)) / 0.45 + 0.3 * Math.max(glint, f.alarm);
            fishBuckets[clamp(Math.floor(v * FISH_ALPHAS.length), 0, FISH_ALPHAS.length - 1)].push(i);
          }
        }
      }

      drawFish() {
        const ctx = this.ctx;
        const cw = this.cw;
        const ch = this.ch;
        const cols = this.cols;
        const fishBuckets = this.fishBuckets;
        for (let b = 0; b < fishBuckets.length; b++) {
          const bucket = fishBuckets[b];
          if (!bucket.length) continue;
          ctx.fillStyle = this.fishStyles[b];
          for (const i of bucket) {
            ctx.fillText('-', (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
          }
        }
      }

      drawHeat() {
        const ctx = this.ctx;
        const heat = this.heat;
        const cols = this.cols;
        const cw = this.cw;
        const ch = this.ch;
        for (let i = 0; i < heat.length; i++) {
          const h = heat[i];
          if (h < 0.08) continue;
          const col = i % cols;
          const row = (i / cols) | 0;
          ctx.fillStyle = h > 0.5 ? `rgba(255,120,60,${h.toFixed(2)})` : `rgba(220,40,40,${(h * 1.6).toFixed(2)})`;
          ctx.fillText(h > 0.6 ? '*' : '·', col * cw + cw / 2, row * ch + ch / 2 + 1);
        }
      }

      drawDots(t) {
        const ctx = this.ctx;
        const cols = this.cols;
        const rows = this.rows;
        const cw = this.cw;
        const ch = this.ch;
        const dotKind = this.dotKind;
        const dotPhase = this.dotPhase;
        const dotFreq = this.dotFreq;
        const energy = this.energy;
        const sharkFlag = this.sharkFlag;
        const sharkShadow = this.sharkShadow;
        const fishStamp = this.fishStamp;
        const frameId = this.frameId;
        const bucketOf = this.bucketOf;
        const bucketOrder = this.bucketOrder;
        const bucketCounts = this.bucketCounts;
        const n = cols * rows;
        const SKIP = bucketCounts.length - 1;
        bucketCounts.fill(0);

        for (let i = 0; i < n; i++) {
          const e = energy[i];
          const kind = dotKind[i];
          if (sharkFlag[i] || fishStamp[i] === frameId || (kind === 0 && e < 0.45)) {
            bucketOf[i] = SKIP;
            continue;
          }
          let bucket;
          if (e > 0.45) {
            const level = clamp(Math.floor((e - 0.45) * 5), 0, ALPHA_LEVELS - 1);
            bucket = WAKE * ALPHA_LEVELS + level;
          } else {
            const col = i % cols;
            const row = (i / cols) | 0;
            const twinkle = 0.5 + 0.5 * Math.sin(t * dotFreq[i] + dotPhase[i]);
            const caustic = 0.85 + 0.15 * Math.sin(col * 0.11 + t * 0.35) * Math.sin(row * 0.17 - t * 0.27);
            let v = clamp((0.55 + 0.45 * twinkle) * caustic + e * 2, 0, 1);
            if (sharkShadow[i]) v *= 0.2;
            bucket = (kind - 1) * ALPHA_LEVELS + clamp(Math.floor(v * ALPHA_LEVELS), 0, ALPHA_LEVELS - 1);
          }
          bucketOf[i] = bucket;
          bucketCounts[bucket]++;
        }

        const starts = new Int32Array(bucketCounts.length);
        for (let b = 1; b < bucketCounts.length; b++) starts[b] = starts[b - 1] + bucketCounts[b - 1];
        const cursor = starts.slice();
        for (let i = 0; i < n; i++) {
          const b = bucketOf[i];
          if (b !== SKIP) bucketOrder[cursor[b]++] = i;
        }

        const small = Math.max(2, Math.round(cw * 0.19));
        const large = small + 1;
        for (let b = 0; b < SKIP; b++) {
          const count = bucketCounts[b];
          if (!count) continue;
          ctx.fillStyle = this.dotStyles[b];
          const size = b >= WAKE * ALPHA_LEVELS ? large : small;
          const start = starts[b];
          for (let k = start; k < start + count; k++) {
            const i = bucketOrder[k];
            const col = i % cols;
            const row = (i / cols) | 0;
            ctx.fillRect(Math.round(col * cw + cw * 0.66 - size / 2), Math.round(row * ch + ch * 0.64 - size / 2), size, size);
          }
        }
      }
    }

    // ── mounting ────────────────────────────────────────────────────────
    const STEP = 1 / 60;
    const MAX_STEPS = 4;
    const NS = 'dsh-shark-bg';
    const ROUTE = '/dsh-shark';

    /** 与宿主 src/config.js 的 DEFAULTS 保持一致；页面拿不到宿主时用它兜底。 */
    const FALLBACK = {
      enabled: true,
      veil: 58,
      veilStrong: 88,
      sharkCount: 6,
      sharkSize: 1,
      fishDensity: 45,
      speed: 1,
      gridScale: 1,
      still: false,
    };

    const VEIL = 'color-mix(in srgb, var(--dsw-alias-bg-base) var(--shark-veil), transparent)';
    const VEIL_STRONG = 'color-mix(in srgb, var(--dsw-alias-bg-base) var(--shark-veil-strong), transparent)';

    /** 遮罩浓度写在 :root 的自定义属性上，改一个变量就能整页生效。 */
    function applyVeil(veil, veilStrong) {
      const root = document.documentElement;
      root.style.setProperty('--shark-veil', `${veil}%`);
      root.style.setProperty('--shark-veil-strong', `${veilStrong}%`);
    }

    const STYLE = `
      /* How much of the shell's own background stays on top of the water.
         Raise it for a subtler ocean, lower it for a bolder one. The values
         come from the settings page (--shark-veil / --shark-veil-strong). */
      html {
        --shark-veil: 58%;
        --shark-veil-strong: 88%;
      }

      [data-shark-ocean] {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
        pointer-events: none;
        display: block;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      /* The ocean is the page background: the shell goes clear, and the
         topmost large surface of each column becomes the single veil the
         water reads through. Cards, menus and popovers keep their own solid
         layers and are never touched. */
      html, body { background: transparent !important; }
      #root { position: relative; z-index: 1; background: transparent !important; }

      /* Exactly one veil per stacking path. Nested veils would multiply:
         two 58% layers already leave under 18% of the water visible. */
      [data-shark-veil] { background: ${VEIL} !important; }

      /* Any other large opaque surface inside a veiled column goes clear, so
         the veil above it is the only thing between the water and the text. */
      [data-shark-clear] { background: transparent !important; }

      /* The window-titlebar strip is painted by a ::before pseudo element;
         it sits on top of the veiled frame, so it must not add a second layer. */
      [class*="_frame"]::before { background: transparent !important; }

      /* The composer seat fades a solid band over the bottom of the chat, so
         it needs its own stronger veil to keep the input area readable. */
      [class*="_composerSeat"] {
        background: linear-gradient(180deg, transparent 0px, ${VEIL_STRONG} 36px) !important;
      }

      /* Nothing extra is needed for the disabled state: applyVeil() pushes both
         variables to 100%, which turns every veil back into the shell's own
         solid colour. */
    `;

    function injectCss() {
      const existing = document.querySelector('style[data-plugin-css="' + NS + '"]');
      if (existing) return;
      const style = document.createElement('style');
      style.dataset.pluginCss = NS;
      style.textContent = STYLE;
      document.head.appendChild(style);
    }

    function removeCss() {
      const style = document.querySelector('style[data-plugin-css="' + NS + '"]');
      if (style) style.remove();
    }

    function isDark() {
      return document.body ? document.body.hasAttribute('data-ds-dark-theme') : true;
    }

    // ── runtime veil probe ──────────────────────────────────────────────
    // The shell's class names carry a hash prefix that changes between
    // releases, so CSS suffix matching is a guess. Instead, measure what is
    // actually on screen: the outermost large opaque surface gets the veil,
    // and every large opaque surface nested inside it goes clear. That keeps
    // exactly one veil between the water and the text — stacking two 58%
    // layers would leave under 18% of the ocean visible.
    const VEIL_AREA = 0.06;
    const VEIL_MIN_SIDE = 90;

    function paints(el) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number(style.opacity) === 0) return false;
      const color = style.backgroundColor;
      const image = style.backgroundImage;
      const flat = Boolean(color) && color !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(color);
      const painted = Boolean(image) && image !== 'none';
      return flat || painted;
    }

    /** Floating chrome — menus, popovers, toasts, dialogs — must stay solid. */
    function isFloating(el) {
      if (el.hasAttribute('data-shell-overlay')) return true;
      if (el.closest('[data-shell-overlay]')) return true;
      const role = el.getAttribute('role');
      if (role === 'dialog' || role === 'menu' || role === 'listbox' || role === 'tooltip') return true;
      if (el.hasAttribute('data-shark-ocean')) return true;
      return false;
    }

    function probeVeil() {
      const root = document.getElementById('root');
      if (!root) return;

      for (const el of root.querySelectorAll('[data-shark-veil],[data-shark-clear]')) {
        el.removeAttribute('data-shark-veil');
        el.removeAttribute('data-shark-clear');
      }

      const minArea = window.innerWidth * window.innerHeight * VEIL_AREA;

      const walk = (node, veiled) => {
        for (const el of node.children) {
          if (isFloating(el)) continue;
          const box = el.getBoundingClientRect();
          const big = box.width >= VEIL_MIN_SIDE && box.height >= VEIL_MIN_SIDE && box.width * box.height >= minArea;
          let nested = veiled;
          if (big && paints(el)) {
            if (veiled) {
              el.setAttribute('data-shark-clear', '');
            } else {
              el.setAttribute('data-shark-veil', '');
              nested = true;
            }
          }
          walk(el, nested);
        }
      };

      walk(root, false);
    }

    function clearVeil() {
      for (const el of document.querySelectorAll('[data-shark-veil],[data-shark-clear]')) {
        el.removeAttribute('data-shark-veil');
        el.removeAttribute('data-shark-clear');
      }
    }

    /**
     * 把一份配置套到正在运行的场景上。
     *
     * 只做“增量”：数量、体型、密度这类需要重建世界的改动才重建，
     * 其余（遮罩、速度、网格）都是就地生效，不会让画面跳一下。
     */
    function applyConfig(scene, cfg) {
      const prev = scene.cfg;
      scene.cfg = cfg;

      applyVeil(cfg.enabled ? cfg.veil : 100, cfg.enabled ? cfg.veilStrong : 100);
      scene.canvas.style.display = cfg.enabled ? 'block' : 'none';

      scene.world.speed = cfg.speed;
      scene.renderer.setGridScale(cfg.gridScale);

      const shapeChanged =
        prev === undefined ||
        prev.sharkCount !== cfg.sharkCount ||
        prev.sharkSize !== cfg.sharkSize ||
        prev.fishDensity !== cfg.fishDensity;
      if (shapeChanged) scene.reseed(cfg);

      scene.setPaused(cfg.still);
    }

    /** Create the ocean layer, start the loop, and return a teardown. */
    function mountOcean(initial) {
      injectCss();
      applyVeil(initial.enabled ? initial.veil : 100, initial.enabled ? initial.veilStrong : 100);

      const canvas = document.createElement('canvas');
      canvas.dataset.sharkOcean = '';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.display = initial.enabled ? 'block' : 'none';
      document.body.insertBefore(canvas, document.body.firstChild);

      const world = new World(sharksFor(initial.sharkCount));
      world.sharkScale = initial.sharkSize;
      world.fishDensity = initial.fishDensity;
      world.speed = initial.speed;
      const renderer = new AsciiRenderer(canvas);
      renderer.setGridScale(initial.gridScale);
      const tmp = { x: 0, y: 0 };
      let raf = 0;
      let last = 0;
      let acc = 0;
      let disposed = false;
      let visible = true;
      let paused = initial.still;

      const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

      function resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.resize(w, h, dpr());
        world.resize(w, h, renderer.cw, renderer.ch);
      }

      resize();

      const ro = new ResizeObserver(resize);
      ro.observe(document.documentElement);

      // Re-probe when the shell mounts, switches theme, or opens a session:
      // the layout rebuilds its columns and would otherwise keep old veil marks.
      // Throttled, not debounced — streaming chat output mutates the tree
      // continuously, so a debounce would never settle.
      let probeTimer = 0;
      let lastProbe = 0;
      const PROBE_GAP = 1500;
      function scheduleProbe() {
        if (disposed || probeTimer) return;
        const wait = Math.max(0, PROBE_GAP - (performance.now() - lastProbe));
        probeTimer = setTimeout(() => {
          probeTimer = 0;
          if (disposed) return;
          lastProbe = performance.now();
          probeVeil();
        }, wait);
      }
      scheduleProbe();

      const mo = new MutationObserver(scheduleProbe);
      mo.observe(document.getElementById('root') ?? document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-ds-dark-theme', 'data-side', 'data-sidebar-collapsed'],
      });

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

      function frame(now) {
        raf = requestAnimationFrame(frame);
        if (disposed) return;
        if (!visible) {
          last = 0;
          return;
        }
        const dt = last ? Math.min((now - last) / 1000, 0.25) : STEP;
        last = now;
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < MAX_STEPS) {
          world.step(STEP);
          acc -= STEP;
          steps++;
        }
        if (steps === MAX_STEPS) acc = 0;
        renderer.setDark(isDark());
        renderer.render(world, steps > 0 ? steps * STEP : dt);
      }

      function still() {
        for (let i = 0; i < 240; i++) world.step(STEP);
        renderer.setDark(isDark());
        renderer.render(world, STEP);
      }

      /** 静止模式：不推进时间，只把当前这一帧重画一遍。 */
      function repaint() {
        renderer.setDark(isDark());
        renderer.render(world, STEP);
      }

      function setPaused(next) {
        if (paused === next) return;
        paused = next;
        if (next) {
          // Freeze on the frame that is already on screen instead of
          // fast-forwarding 240 steps, which would visibly jump.
          repaint();
        } else {
          last = 0;
          acc = 0;
          if (!raf) raf = requestAnimationFrame(frame);
        }
      }

      /** 数量/体型/密度变化后重建世界，画面从新的布局重新开始。 */
      function reseed(cfg) {
        world.sharkSpecs = sharksFor(cfg.sharkCount);
        world.sharkScale = cfg.sharkSize;
        world.fishDensity = cfg.fishDensity;
        world.fishCount = undefined;
        world.width = 0;
        world.fish = [];
        world.sharks = [];
        world.events = [];
        world.resize(window.innerWidth, window.innerHeight, renderer.cw, renderer.ch);
        if (paused) still();
      }

      const scene = {
        canvas,
        world,
        renderer,
        // Seed the baseline with what mountOcean already built, so the first
        // applyConfig only rebuilds when the Host value actually differs.
        cfg: initial,
        setPaused,
        reseed,
      };

      if (reduce.matches) paused = true;
      if (paused) {
        still();
      } else {
        raf = requestAnimationFrame(frame);
      }

      const onPointerMove = (e) => {
        world.pointer.x = e.clientX;
        world.pointer.y = e.clientY;
        world.pointer.active = true;
      };
      const onPointerDown = (e) => {
        world.splash(e.clientX, e.clientY);
      };
      const onPointerLeave = () => {
        world.pointer.active = false;
      };
      const onVisibility = () => {
        visible = !document.hidden;
        last = 0;
      };
      const onBlur = () => {
        world.pointer.active = false;
      };

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerdown', onPointerDown, { passive: true });
      document.documentElement.addEventListener('pointerleave', onPointerLeave);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('blur', onBlur);

      scene.dispose = () => {
        disposed = true;
        if (raf) cancelAnimationFrame(raf);
        clearTimeout(probeTimer);
        mo.disconnect();
        ro.disconnect();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerdown', onPointerDown);
        document.documentElement.removeEventListener('pointerleave', onPointerLeave);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('blur', onBlur);
        clearVeil();
        canvas.remove();
        removeCss();
        world.fish.length = 0;
        world.sharks.length = 0;
        void tmp;
        void repaint;
      };

      return scene;
    }

    // ── settings bridge ──────────────────────────────────────────────────
    // The page writes through the Host route; the ocean listens for the
    // broadcast so a change lands on screen without a reload.
    const CONFIG_EVENT = 'dsh-shark-bg:config';

    /** 客户端侧的兜底归一化：宿主给的值越界时也不至于把画面搞坏。 */
    function normalizeClientConfig(raw) {
      const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const out = { ...FALLBACK };
      for (const key of Object.keys(FALLBACK)) {
        if (typeof FALLBACK[key] === 'boolean') {
          if (typeof source[key] === 'boolean') out[key] = source[key];
        } else if (Number.isFinite(Number(source[key]))) {
          out[key] = Number(source[key]);
        }
      }
      return out;
    }

    async function fetchConfig() {
      try {
        const response = await fetch(`${ROUTE}/state`, { headers: { accept: 'application/json' } });
        if (!response.ok) return undefined;
        const data = await response.json();
        return normalizeClientConfig(data?.state);
      } catch {
        return undefined;
      }
    }

    // ── settings page ────────────────────────────────────────────────────
    const PANEL_CSS = `.dsh-shark{
  --r-border:var(--dsw-alias-border-l1,#e5e6eb);
  --r-border-strong:var(--dsw-alias-border-l2,#c9cdd4);
  --r-hover:var(--dsw-alias-interactive-bg-hover,rgba(31,35,41,.05));
  --r-bg:var(--dsw-alias-bg-layer-1,#fff);
  --r-text:var(--dsw-alias-label-primary,#1f2329);
  --r-secondary:var(--dsw-alias-label-secondary,#646a73);
  --r-muted:var(--dsw-alias-label-tertiary,#8f959e);
  --r-accent:var(--dsw-alias-button-info-fill,#4d6bfe);
  --r-danger:var(--dsw-alias-state-error-primary,#d92d20);
  max-width:720px;margin:0 auto;color:var(--r-text);font-size:13px;line-height:1.6;
}
.dsh-shark__page{height:100%;overflow:auto;padding:30px 38px 56px;box-sizing:border-box;background:transparent}
.dsh-shark__title{font-size:16px;font-weight:600;margin:0 0 4px}
.dsh-shark__hint{color:var(--r-secondary);font-size:12px;margin:0 0 18px}
.dsh-shark__row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--r-border)}
.dsh-shark__row:last-child{border-bottom:none}
.dsh-shark__label{font-size:13px;font-weight:500}
.dsh-shark__note{color:var(--r-muted);font-size:12px;margin-top:2px}
.dsh-shark__control{flex:none;min-width:230px;display:flex;align-items:center;justify-content:flex-end;gap:10px}
.dsh-shark__control input[type=range]{width:150px;accent-color:var(--r-accent)}
.dsh-shark__value{min-width:52px;text-align:right;font-variant-numeric:tabular-nums;color:var(--r-secondary);font-size:12px}
.dsh-shark__switch{position:relative;width:38px;height:22px;flex:none}
.dsh-shark__switch input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.dsh-shark__track{display:block;width:38px;height:22px;border-radius:11px;background:var(--r-border-strong);transition:background .15s;position:relative}
.dsh-shark__track::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.dsh-shark__switch input:checked + .dsh-shark__track{background:var(--r-accent)}
.dsh-shark__switch input:checked + .dsh-shark__track::after{transform:translateX(16px)}
.dsh-shark__actions{display:flex;gap:10px;margin-top:20px}
.dsh-shark__btn{font:inherit;color:var(--r-text);background:var(--r-bg);border:1px solid var(--r-border);border-radius:9px;padding:6px 16px;cursor:pointer}
.dsh-shark__btn:hover{background:var(--r-hover)}
.dsh-shark__btn.primary{background:var(--r-accent);border-color:var(--r-accent);color:#fff}
.dsh-shark__status{margin-top:10px;font-size:12px;color:var(--r-muted);min-height:18px}
.dsh-shark__status.error{color:var(--r-danger)}
@media (max-width:640px){
  .dsh-shark__page{padding:20px 18px 40px}
  .dsh-shark__row{flex-direction:column;gap:8px}
  .dsh-shark__control{width:100%;justify-content:flex-start}
}
`;

    function injectPanelCss() {
      const tag = `${NS}-panel`;
      if (document.querySelector(`style[data-plugin-css="${tag}"]`)) return;
      const style = document.createElement('style');
      style.dataset.pluginCss = tag;
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }

    const zh = {
      nav: '鲨鱼背景',
      title: '背景鲨鱼',
      hint: '在界面背后游动的 ASCII 鲨鱼。改动即时生效，不需要刷新页面。',
      enabled: '启用背景',
      enabledHint: '关掉后画面恢复成默认外观，设置会保留。',
      veil: '界面遮罩',
      veilHint: '越大海水越淡、文字越清楚；越小鲨鱼越明显。',
      veilStrong: '输入区遮罩',
      veilStrongHint: '底部输入框与聊天流交界处的浓度，太小会影响打字时的可读性。',
      sharkCount: '鲨鱼数量',
      sharkCountHint: '0 表示只留海水与鱼群。数量多时会依次加入更小的种类。',
      sharkSize: '鲨鱼体型',
      sharkSizeHint: '相对默认尺寸的倍率。',
      fishDensity: '鱼群密度',
      fishDensityHint: '0 表示没有小鱼，只有鲨鱼。',
      speed: '游速',
      speedHint: '整体时间流速，1 是原始速度。',
      gridScale: '网格浓度',
      gridScaleHint: '背景网格线的明显程度，0 表示完全去掉。',
      still: '静止画面',
      stillHint: '不播放动画，只保留一帧。省电，也适合截图。',
      reset: '恢复默认',
      reload: '重新载入',
      saving: '保存中…',
      saved: '已保存',
      loadFailed: '读取设置失败',
      saveFailed: '保存失败',
      unavailable: '无法连接宿主服务，请确认插件已加载。',
    };

    const en = {
      nav: 'Shark background',
      title: 'Background sharks',
      hint: 'ASCII sharks swimming behind the interface. Changes apply immediately, no reload needed.',
      enabled: 'Enable the background',
      enabledHint: 'Turning it off restores the default look; the settings are kept.',
      veil: 'Interface veil',
      veilHint: 'Higher fades the water and sharpens the text; lower makes the sharks bolder.',
      veilStrong: 'Composer veil',
      veilStrongHint: 'Density at the bottom edge where the chat meets the input box.',
      sharkCount: 'Shark count',
      sharkCountHint: '0 leaves only water and fish. Extra sharks add smaller species in turn.',
      sharkSize: 'Shark size',
      sharkSizeHint: 'Multiplier on the default body length.',
      fishDensity: 'Fish density',
      fishDensityHint: '0 removes the schools and leaves only sharks.',
      speed: 'Swim speed',
      speedHint: 'Overall time scale; 1 is the original speed.',
      gridScale: 'Grid density',
      gridScaleHint: 'How visible the background grid is; 0 removes it.',
      still: 'Still frame',
      stillHint: 'Freeze the animation on one frame. Saves power and suits screenshots.',
      reset: 'Restore defaults',
      reload: 'Reload',
      saving: 'Saving…',
      saved: 'Saved',
      loadFailed: 'Could not load the settings',
      saveFailed: 'Could not save',
      unavailable: 'Host service unreachable — check that the plugin is loaded.',
    };

    /** 一行滑块；数值由宿主归一化后回传，这里只负责显示。 */
    function Slider(props) {
      const { id, label, note, value, min, max, step, format, disabled, onChange, t } = props;
      return React.createElement('div', { className: 'dsh-shark__row' },
        React.createElement('div', null,
          React.createElement('div', { className: 'dsh-shark__label' }, label),
          React.createElement('div', { className: 'dsh-shark__note' }, note)),
        React.createElement('div', { className: 'dsh-shark__control' },
          React.createElement('input', {
            id,
            type: 'range',
            min,
            max,
            step,
            value,
            disabled,
            onChange: (event) => onChange(Number(event.target.value)),
          }),
          React.createElement('span', { className: 'dsh-shark__value' },
            format ? format(value) : String(value))))
    }

    function Toggle(props) {
      const { id, label, note, checked, disabled, onChange } = props;
      return React.createElement('div', { className: 'dsh-shark__row' },
        React.createElement('div', null,
          React.createElement('div', { className: 'dsh-shark__label' }, label),
          React.createElement('div', { className: 'dsh-shark__note' }, note)),
        React.createElement('div', { className: 'dsh-shark__control' },
          React.createElement('label', { className: 'dsh-shark__switch' },
            React.createElement('input', {
              id,
              type: 'checkbox',
              checked,
              disabled,
              onChange: (event) => onChange(event.target.checked),
            }),
            React.createElement('span', { className: 'dsh-shark__track' })))
      )
    }

    async function requestState(method, body) {
      const response = await fetch(`${ROUTE}/state`, {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data;
      try {
        data = await response.json();
      } catch {
        data = undefined;
      }
      if (!response.ok) {
        const detail = data && typeof data.detail === 'string' ? data.detail : `HTTP ${response.status}`;
        throw new Error(detail);
      }
      return data;
    }

    function SharkSettingsPage(props) {
      const { t } = props;
      injectPanelCss();
      const [state, setState] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [status, setStatus] = useState('');

      const load = useCallback(async () => {
        try {
          const data = await requestState('GET');
          setState(normalizeClientConfig(data?.state));
          setError('');
        } catch (failure) {
          setError(`${t('loadFailed')}：${failure.message}`);
        }
      }, [t]);

      useEffect(() => { load(); }, [load]);

      const save = useCallback(async (patch) => {
        // 先就地更新，滑块才跟手；失败时用服务端回传的状态覆盖回来。
        setState((prev) => (prev ? normalizeClientConfig({ ...prev, ...patch }) : prev));
        setBusy(true);
        setStatus(t('saving'));
        try {
          const data = await requestState('POST', patch);
          const next = normalizeClientConfig(data?.state);
          setState(next);
          window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: next }));
          setStatus(t('saved'));
          setError('');
        } catch (failure) {
          setError(`${t('saveFailed')}：${failure.message}`);
          setStatus('');
          load();
        } finally {
          setBusy(false);
        }
      }, [load, t]);

      if (state === null) {
        return React.createElement('div', { className: 'dsh-shark dsh-shark__page' },
          React.createElement('h2', { className: 'dsh-shark__title' }, t('title')),
          error
            ? React.createElement('div', { className: 'dsh-shark__status error' }, error)
            : React.createElement('div', { className: 'dsh-shark__status' }, t('saving')));
      }

      const disabled = busy;

      return React.createElement('div', { className: 'dsh-shark dsh-shark__page' },
        React.createElement('h2', { className: 'dsh-shark__title' }, t('title')),
        React.createElement('p', { className: 'dsh-shark__hint' }, t('hint')),

        React.createElement(Toggle, {
          id: 'dsh-shark-enabled',
          label: t('enabled'),
          note: t('enabledHint'),
          checked: state.enabled,
          disabled,
          onChange: (value) => save({ enabled: value }),
        }),

        React.createElement(Slider, {
          id: 'dsh-shark-veil',
          label: t('veil'),
          note: t('veilHint'),
          value: state.veil,
          min: 0,
          max: 100,
          step: 1,
          format: (value) => `${value}%`,
          disabled,
          onChange: (value) => save({ veil: value }),
          t,
        }),

        React.createElement(Slider, {
          id: 'dsh-shark-veil-strong',
          label: t('veilStrong'),
          note: t('veilStrongHint'),
          value: state.veilStrong,
          min: 0,
          max: 100,
          step: 1,
          format: (value) => `${value}%`,
          disabled,
          onChange: (value) => save({ veilStrong: value }),
          t,
        }),

        React.createElement(Slider, {
          id: 'dsh-shark-count',
          label: t('sharkCount'),
          note: t('sharkCountHint'),
          value: state.sharkCount,
          min: 0,
          max: 12,
          step: 1,
          disabled,
          onChange: (value) => save({ sharkCount: value }),
          t,
        }),

        React.createElement(Slider, {
          id: 'dsh-shark-size',
          label: t('sharkSize'),
          note: t('sharkSizeHint'),
          value: state.sharkSize,
          min: 0.4,
          max: 2,
          step: 0.05,
          format: (value) => `${value.toFixed(2)}×`,
          disabled,
          onChange: (value) => save({ sharkSize: value }),
          t,
        }),

        React.createElement(Slider, {
          id: 'dsh-shark-fish',
          label: t('fishDensity'),
          note: t('fishDensityHint'),
          value: state.fishDensity,
          min: 0,
          max: 100,
          step: 1,
          format: (value) => `${value}%`,
          disabled,
          onChange: (value) => save({ fishDensity: value }),
          t,
        }),

        React.createElement(Slider, {
          id: 'dsh-shark-speed',
          label: t('speed'),
          note: t('speedHint'),
          value: state.speed,
          min: 0.2,
          max: 3,
          step: 0.05,
          format: (value) => `${value.toFixed(2)}×`,
          disabled,
          onChange: (value) => save({ speed: value }),
          t,
        }),

        React.createElement(Slider, {
          id: 'dsh-shark-grid',
          label: t('gridScale'),
          note: t('gridScaleHint'),
          value: state.gridScale,
          min: 0,
          max: 3,
          step: 0.05,
          format: (value) => `${value.toFixed(2)}×`,
          disabled,
          onChange: (value) => save({ gridScale: value }),
          t,
        }),

        React.createElement(Toggle, {
          id: 'dsh-shark-still',
          label: t('still'),
          note: t('stillHint'),
          checked: state.still,
          disabled,
          onChange: (value) => save({ still: value }),
        }),

        React.createElement('div', { className: 'dsh-shark__actions' },
          React.createElement('button', {
            className: 'dsh-shark__btn primary',
            onClick: () => save(FALLBACK),
          }, t('reset')),
          React.createElement('button', {
            className: 'dsh-shark__btn',
            onClick: () => load(),
          }, t('reload'))),

        error
          ? React.createElement('div', { className: 'dsh-shark__status error' }, error)
          : React.createElement('div', { className: 'dsh-shark__status' }, status));
    }

    function registerSettingsPage(ctx) {
      if (typeof ctx.locale?.register === 'function') {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-shark-bg: dictionaries');
      }
      const t = typeof ctx.locale?.bind === 'function'
        ? ctx.locale.bind(NS)
        : (key) => zh[key] ?? key;

      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register({
          name: 'settings.section',
          id: 'shark-bg',
          order: 37,
          label: () => t('nav'),
          inject: () => ({ t }),
        }, SharkSettingsPage);
      });
    }

    const plugin = {
      name: 'dsh-shark-bg',
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const started = mountOcean(FALLBACK);
          const scene = started;
          fetchConfig().then((cfg) => {
            if (cfg) applyConfig(scene, cfg);
          });
          const onConfig = (event) => {
            applyConfig(scene, normalizeClientConfig(event?.detail));
          };
          window.addEventListener(CONFIG_EVENT, onConfig);
          return () => {
            window.removeEventListener(CONFIG_EVENT, onConfig);
            started.dispose();
          };
        }, 'dsh-shark-bg: ascii shark ocean layer');

        registerSettingsPage(ctx);
      },
    };

    return plugin;
  },
});
