/* Hull Patch (world game "hull"): a jagged hole in the hull, seen from inside, the sea spraying
   through. One plank at a time: drag it over the hole and hammer it down.

   Dragging: the point you grab is pulled toward the mouse on a springy lag, so the plank is towed
   where you pull. Grab near the middle and it slides; grab near an end and pull sideways, and it
   swings around the far end (the plank resists sliding more than turning, so the far end stays
   about put). The ship keeps shoving it (drift, lurches), and the planks shake (vibrate, rotate).

   Hammer: Space or right-click nails the plank exactly where it is that moment (shake included).
   It stays only if both nail spots (one near each end) are on solid hull: the wood around the
   hole, or a plank already nailed. Otherwise it falls into the sea. The nail spots show green
   (solid) or red (over the hole) while you hold it.

   Score: how much of the hole is covered by nailed planks (0-100). Done early when out of planks
   or the hole is covered.

   Settings (world games[hull].practice / .real): hole "simple" | "irregular", planks, length and
   width (px on the 960x600 canvas), drift (the ship shoving it), vibrate (shake, px),
   rotate (the ship turning it). Sounds by name: "hit" (nailed), "splash" (fell in). */

MG.register("hull", {
  create(ctx) {
    const { W, H, rng, motion, input, set } = ctx;
    const N = set.planks ?? 6;
    const L = set.length ?? 450, PW = set.width ?? 50, HALF = L / 2, NAIL = HALF - 16;
    const drift = set.drift ?? 1, vib = set.vibrate ?? 0, rot = set.rotate ?? 0;
    const TAU = Math.PI * 2;

    /* ---------- the hole (seeded: the same for everyone) ---------- */
    const irregular = set.hole === "irregular";
    const hc = { x: W / 2 + (irregular ? rng.range(-30, 30) : 0), y: 280 + (irregular ? rng.range(-12, 12) : 0) };
    const rx = irregular ? 190 : 165, ry = irregular ? 118 : 100, nv = irregular ? 34 : 26;
    const hole = [];
    for (let i = 0; i < nv; i++) {
      const a = (i / nv) * TAU;
      let k = irregular ? rng.range(0.8, 1.1) : rng.range(0.95, 1.04);
      if (irregular && rng() < 0.2) k *= rng() < 0.5 ? 1.22 : 0.74; // a spike out or a notch in
      hole.push({ x: hc.x + Math.cos(a) * rx * k, y: hc.y + Math.sin(a) * ry * k });
    }
    const inHole = (p) => {
      let inside = false;
      for (let i = 0, j = hole.length - 1; i < hole.length; j = i++) {
        const a = hole[i], b = hole[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    const holePath = (g) => { g.beginPath(); hole.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); };

    // Planks: where each one turns up (bottom of the view), seeded.
    const spawns = Array.from({ length: N }, () => ({
      x: W / 2 + rng.range(-70, 70), y: 525 + rng.range(-8, 8),
      a: rng.range(-1, 1) * (irregular ? 0.18 : 0.05), grain: rng(),
    }));
    const ph = Array.from({ length: 8 }, () => rng.range(0, TAU)); // phases for the ship's shoves and the shake

    /* ---------- coverage: sample points inside the hole ---------- */
    const STEP = 5, cells = [];
    const xs = hole.map((p) => p.x), ys = hole.map((p) => p.y);
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += STEP)
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += STEP) if (inHole({ x, y })) cells.push({ x, y });
    const covered = new Uint8Array(cells.length);
    let nCovered = 0, open = cells.slice();

    const inPlank = (p, pt, padL = 0, padW = 0) => {
      const dx = pt.x - p.x, dy = pt.y - p.y, c = Math.cos(p.a), s = Math.sin(p.a);
      return Math.abs(dx * c + dy * s) <= HALF + padL && Math.abs(-dx * s + dy * c) <= PW / 2 + padW;
    };
    const ends = (p) => [-1, 1].map((k) => ({ x: p.x + Math.cos(p.a) * NAIL * k, y: p.y + Math.sin(p.a) * NAIL * k }));
    const tacked = [];
    const solid = (pt) => pt.x > 8 && pt.x < W - 8 && pt.y > 8 && pt.y < H - 8 && (!inHole(pt) || tacked.some((p) => inPlank(p, pt)));
    function cover(p) {
      cells.forEach((c, i) => { if (!covered[i] && inPlank(p, c)) { covered[i] = 1; nCovered++; } });
      open = cells.filter((c, i) => !covered[i]);
    }

    /* ---------- the plank in hand ---------- */
    let cur = null, next = 0, spawnAt = 0, grab = null, m = motion(0);
    const falling = [], flashes = [];
    function spawn() {
      const s = spawns[next++];
      cur = { x: s.x, y: s.y, a: s.a, vx: 0, vy: 0, va: 0, grain: s.grain };
    }
    spawn();
    // The shake: where the plank really is right now (this is what gets nailed).
    const pose = (t) => cur && {
      x: cur.x + vib * 4 * (Math.sin(31 * t + ph[0]) + 0.5 * Math.sin(53 * t + ph[1])) / 1.5,
      y: cur.y + vib * 4 * (Math.sin(37 * t + ph[2]) + 0.5 * Math.sin(47 * t + ph[3])) / 1.5,
      a: cur.a + rot * 0.012 * Math.sin(23 * t + ph[4]),
      grain: cur.grain,
    };

    function hammer(t) {
      if (!cur) return;
      const p = pose(t), [e1, e2] = ends(p);
      grab = null;
      if (solid(e1) && solid(e2)) {
        tacked.push(p);
        cover(p);
        flashes.push({ ...e1, t }, { ...e2, t });
        ctx.sound("hit");
      } else {
        falling.push({ ...p, vy: -80, va: (p.a >= 0 ? 1 : -1) * 1.3, t0: t });
        ctx.sound("splash");
      }
      cur = null;
      spawnAt = t + 0.45;
    }

    // Towed by the grab point (a spring), shoved by the ship, slowed by drag. Mass 1; inertia
    // (L/2)^2 and angular drag DL*(L/2)^2 make the far end the pivot when you pull an end.
    const K = 40, C = 5, DL = 6, I = HALF * HALF;
    function physics(dt, t) {
      const c = cur, lurch = m.lurch * (m.dir || 0);
      const ex = drift * (55 * Math.sin(1.1 * t + ph[5]) + 30 * Math.sin(2.3 * t + ph[6]) + 700 * lurch);
      const ey = drift * (40 * Math.sin(1.4 * t + ph[7]) - 260 * m.lurch);
      const ea = rot * (0.9 * Math.sin(0.8 * t + ph[4]) + 7 * lurch);
      const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
      for (let k = 0; k < n; k++) {
        let ax = ex - DL * c.vx, ay = ey - DL * c.vy, aa = ea - DL * c.va;
        if (grab) {
          const cs = Math.cos(c.a), sn = Math.sin(c.a);
          const rx2 = grab.x * cs - grab.y * sn, ry2 = grab.x * sn + grab.y * cs;
          const gvx = c.vx - c.va * ry2, gvy = c.vy + c.va * rx2;
          const fx = K * (input.x - (c.x + rx2)) - C * gvx, fy = K * (input.y - (c.y + ry2)) - C * gvy;
          ax += fx; ay += fy; aa += (rx2 * fy - ry2 * fx) / I;
        }
        // Soft walls: the plank stays in view.
        if (c.x < 40) ax += 60 * (40 - c.x); if (c.x > W - 40) ax -= 60 * (c.x - W + 40);
        if (c.y < 40) ay += 60 * (40 - c.y); if (c.y > H - 30) ay -= 60 * (c.y - H + 30);
        c.vx += ax * h; c.vy += ay * h; c.va += aa * h;
        c.x += c.vx * h; c.y += c.vy * h; c.a += c.va * h;
      }
    }

    /* ---------- art: the hull wall, drawn once (hole punched out) ---------- */
    const art = MG.rng(ctx.seed ^ 0x2545f491); // art only, so it never shifts the layout's numbers
    const wall = document.createElement("canvas");
    wall.width = W; wall.height = H;
    {
      const g = wall.getContext("2d"), BH = 46;
      for (let y = 0, row = 0; y < H; y += BH, row++) {
        g.fillStyle = row % 2 ? "#5b412a" : "#644832"; g.fillRect(0, y, W, BH);
        g.strokeStyle = "rgba(30, 18, 8, .35)"; g.lineWidth = 1;
        for (let k = 0; k < 3; k++) { // grain
          const gy = y + 10 + k * 12 + art.range(-3, 3);
          g.beginPath(); g.moveTo(0, gy);
          for (let x = 0; x <= W; x += 80) g.lineTo(x, gy + art.range(-2, 2));
          g.stroke();
        }
        g.fillStyle = "#2b1d12"; g.fillRect(0, y, W, 2); // seam
        for (let x = ((row * 173) % 260) + 40; x < W; x += 260 + (row % 3) * 40) g.fillRect(x, y, 2, BH); // butt joints
      }
      for (const x of [62, W - 62]) { // ribs
        const gr = g.createLinearGradient(x - 28, 0, x + 28, 0);
        gr.addColorStop(0, "#3a2818"); gr.addColorStop(0.5, "#4e3621"); gr.addColorStop(1, "#33231a");
        g.fillStyle = gr; g.fillRect(x - 28, 0, 56, H);
        for (let y = 30; y < H; y += 92) { g.fillStyle = "#2a2a2e"; g.beginPath(); g.arc(x, y, 4, 0, TAU); g.fill(); }
      }
      g.globalCompositeOperation = "destination-out";
      holePath(g); g.fill();
      g.globalCompositeOperation = "source-over";
      // Splintered edge: raw wood, dark inner line, splinters poking in.
      holePath(g); g.strokeStyle = "#b98b55"; g.lineWidth = 9; g.lineJoin = "round"; g.stroke();
      holePath(g); g.strokeStyle = "#3a2716"; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = "#c49660";
      for (const p of hole) {
        const dx = hc.x - p.x, dy = hc.y - p.y, d = Math.hypot(dx, dy), len = art.range(8, 22);
        const nx = -dy / d, ny = dx / d, w = art.range(2, 4);
        g.beginPath(); g.moveTo(p.x + nx * w, p.y + ny * w); g.lineTo(p.x - nx * w, p.y - ny * w);
        g.lineTo(p.x + (dx / d) * len, p.y + (dy / d) * len); g.closePath(); g.fill();
      }
    }

    function sea(g, t) {
      g.save(); holePath(g); g.clip();
      g.fillStyle = "#56656f"; g.fillRect(0, 0, W, H); // mist and sky
      g.translate(hc.x, hc.y - 18 + m.y * 2.2);
      g.rotate(m.roll * 3);
      const wave = (x) => 7 * Math.sin(x * 0.028 + t * 2.1) + 3 * Math.sin(x * 0.071 - t * 3.3);
      const gr = g.createLinearGradient(0, -10, 0, 220);
      gr.addColorStop(0, "#245464"); gr.addColorStop(1, "#08171f");
      g.fillStyle = gr; g.beginPath(); g.moveTo(-320, 260);
      for (let x = -320; x <= 320; x += 16) g.lineTo(x, wave(x));
      g.lineTo(320, 260); g.closePath(); g.fill();
      g.strokeStyle = "rgba(215, 238, 242, .55)"; g.lineWidth = 2; g.beginPath();
      for (let x = -320; x <= 320; x += 16) (x === -320 ? g.moveTo(x, wave(x)) : g.lineTo(x, wave(x)));
      g.stroke();
      g.restore();
    }

    // Spray through whatever's still open: droplets fly out of the hole toward you and fall.
    function spray(g, t) {
      if (!open.length) return;
      const count = Math.round(6 + 80 * (open.length / cells.length));
      for (let i = 0; i < count; i++) {
        const P = 0.8 + (i % 7) * 0.11, f = t / P + ((i * 0.618034) % 1), cyc = Math.floor(f), age = f - cyc;
        const o = open[(((i * 73856093) ^ (cyc * 19349663)) >>> 0) % open.length];
        const dx = o.x - hc.x, dy = o.y - hc.y, d = Math.hypot(dx, dy) || 1, sp = 90 + (i % 5) * 25;
        const x = o.x + (dx / d) * sp * age, y = o.y + (dy / d) * sp * age * 0.6 + 260 * age * age;
        g.fillStyle = `rgba(205, 232, 245, ${0.7 * (1 - age)})`;
        g.beginPath(); g.arc(x, y, 2.6 * (1 - age) + 0.6, 0, TAU); g.fill();
      }
    }

    function plank(g, p, { alpha = 1, nails = false, lifted = false } = {}) {
      g.save(); g.globalAlpha = alpha; g.translate(p.x, p.y); g.rotate(p.a);
      g.fillStyle = "rgba(0, 0, 0, .35)";
      g.fillRect(-HALF + (lifted ? 8 : 3), -PW / 2 + (lifted ? 12 : 4), L, PW);
      const gr = g.createLinearGradient(0, -PW / 2, 0, PW / 2);
      gr.addColorStop(0, "#c39867"); gr.addColorStop(0.5, "#a97c4c"); gr.addColorStop(1, "#8b623a");
      g.fillStyle = gr; g.fillRect(-HALF, -PW / 2, L, PW);
      g.strokeStyle = "rgba(70, 40, 16, .4)"; g.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const y = -PW / 2 + PW * (0.18 + 0.21 * k);
        g.beginPath(); g.moveTo(-HALF, y);
        g.bezierCurveTo(-HALF / 3, y + 3 * Math.sin(p.grain * 9 + k), HALF / 3, y - 3 * Math.cos(p.grain * 7 + k), HALF, y);
        g.stroke();
      }
      g.fillStyle = "rgba(80, 48, 20, .55)";
      g.beginPath(); g.ellipse((p.grain - 0.5) * L * 0.6, (p.grain - 0.5) * PW * 0.3, 7, 3.5, 0, 0, TAU); g.fill();
      g.fillStyle = "rgba(60, 36, 16, .5)"; g.fillRect(-HALF, -PW / 2, 6, PW); g.fillRect(HALF - 6, -PW / 2, 6, PW);
      g.strokeStyle = "#4a3018"; g.lineWidth = 2; g.strokeRect(-HALF, -PW / 2, L, PW);
      if (nails) for (const sx of [-NAIL, NAIL]) for (const sy of [-PW / 4, PW / 4]) {
        g.fillStyle = "#6f757c"; g.beginPath(); g.arc(sx, sy, 3.4, 0, TAU); g.fill();
        g.fillStyle = "#cfd4d9"; g.beginPath(); g.arc(sx - 1, sy - 1, 1.2, 0, TAU); g.fill();
      }
      g.restore();
    }

    function lantern(g, t) {
      const ax = 200, len = 92, a = m.roll * 9 + 0.05 * Math.sin(t * 1.3);
      const x = ax + Math.sin(a) * len, y = Math.cos(a) * len;
      g.strokeStyle = "#2a2420"; g.lineWidth = 2; g.beginPath(); g.moveTo(ax, 0); g.lineTo(x, y); g.stroke();
      g.save(); g.globalCompositeOperation = "lighter";
      const glow = g.createRadialGradient(x, y + 16, 4, x, y + 16, 190);
      glow.addColorStop(0, "rgba(255, 200, 120, .28)"); glow.addColorStop(1, "rgba(255, 200, 120, 0)");
      g.fillStyle = glow; g.fillRect(x - 190, y - 174, 380, 380); g.restore();
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = "#2f2a25"; g.fillRect(-11, 0, 22, 6);
      g.fillStyle = "#ffd28a"; g.fillRect(-8, 6, 16, 22);
      g.strokeStyle = "#2f2a25"; g.lineWidth = 2; g.strokeRect(-8, 6, 16, 22);
      g.fillStyle = "#2f2a25"; g.fillRect(-11, 28, 22, 5);
      g.restore();
    }

    let vignette = null;
    return {
      update(dt, t) {
        m = motion(t);
        for (const e of input.take()) {
          if (e.type === "down" && e.button === 0 && cur && inPlank(pose(t), e, 10, 14)) {
            // Where on the plank you took hold of it (its own coordinates).
            const dx = e.x - cur.x, dy = e.y - cur.y, c = Math.cos(cur.a), s = Math.sin(cur.a);
            grab = { x: Math.max(-HALF, Math.min(HALF, dx * c + dy * s)), y: Math.max(-PW / 2, Math.min(PW / 2, -dx * s + dy * c)) };
          } else if (e.type === "up" && e.button === 0) grab = null;
          else if ((e.type === "down" && e.button === 2) || (e.type === "key" && e.key === " ")) hammer(t);
        }
        if (!cur && next < N && t >= spawnAt && nCovered < cells.length) spawn();
        if (cur) physics(dt, t);
        for (const f of falling) { f.y += f.vy * dt; f.vy += 1100 * dt; f.a += f.va * dt; }
        while (falling.length && t - falling[0].t0 > 1.3) falling.shift();
        while (flashes.length && t - flashes[0].t > 0.35) flashes.shift();
        ctx.canvas.style.cursor = grab ? "grabbing" : cur && inPlank(pose(t), input, 10, 14) ? "grab" : "default";
      },

      draw(g, t) {
        sea(g, t);
        g.drawImage(wall, 0, 0);
        for (const p of tacked) plank(g, p, { nails: true });
        spray(g, t);
        for (const f of falling) plank(g, f, { alpha: Math.max(0, 1 - (t - f.t0) / 1.3), lifted: true });
        const p = pose(t);
        if (p) {
          plank(g, p, { lifted: true });
          for (const e of ends(p)) { // nail spots: green = solid wood, red = over the hole
            const ok = solid(e);
            g.strokeStyle = ok ? "#9be08f" : "#ff6b6b"; g.lineWidth = 3;
            g.beginPath(); g.arc(e.x, e.y, 8, 0, TAU); g.stroke();
            g.fillStyle = ok ? "rgba(155, 224, 143, .35)" : "rgba(255, 107, 107, .35)"; g.fill();
          }
        }
        for (const f of flashes) {
          const k = (t - f.t) / 0.35;
          g.strokeStyle = `rgba(255, 244, 214, ${1 - k})`; g.lineWidth = 3;
          g.beginPath(); g.arc(f.x, f.y, 6 + 34 * k, 0, TAU); g.stroke();
        }
        lantern(g, t);
        if (!vignette) {
          vignette = g.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 620);
          vignette.addColorStop(0, "rgba(0, 0, 0, 0)"); vignette.addColorStop(1, "rgba(0, 0, 0, .55)");
        }
        g.fillStyle = vignette; g.fillRect(0, 0, W, H);
        // Status line.
        g.fillStyle = "rgba(10, 8, 18, .6)"; g.fillRect(0, H - 34, W, 34);
        g.font = "15px system-ui, sans-serif"; g.textBaseline = "middle"; g.fillStyle = "#f4ead2";
        g.textAlign = "left"; g.fillText(`Planks left: ${N - next + (cur ? 1 : 0)}`, 16, H - 17);
        g.textAlign = "right"; g.fillText(`Patched: ${Math.floor((100 * nCovered) / cells.length)}%`, W - 16, H - 17);
        g.textAlign = "center"; g.fillStyle = "#b9ad95";
        g.fillText("Drag to move · drag an end to swing it · Space or right-click: hammer", W / 2, H - 17);
      },

      score() { return (100 * nCovered) / cells.length; },
      done() { return (next >= N && !cur && !falling.length) || nCovered >= cells.length; },
    };
  },
});
