/* Shared pieces for every minigame (the session 2 ship repairs): one seeded random generator, one
   ship-motion function and one mouse/keyboard input, so every player in a round (same seed) sees
   the same thing. Plus the round runner (countdown, clock, time's up, settle, score reports).

   A game is one file, games/<id>.js (id = the world's games[].id), that registers itself:

     MG.register("hull", {
       create(ctx) -> {
         update(dt, t)   dt: seconds since the last frame; t: seconds since the round started
         draw(g, t)      g: the canvas 2D context, W x H logical pixels (MG.W, MG.H)
         score()         0-100 so far (reported every couple of seconds; counts if they drop)
         end?(t)         time's up: last change before the settle seconds (the seeds' storm lurch)
         done?()         true = finished early (all stitches done, Done pressed): ends their round
       }
     })

   ctx: { W, H, seed, kind ("practice"|"real"), set (the world's practice/real settings), limit,
          settle, rng (MG.rng(seed): same numbers for everyone), motion (MG.motion(seed, rough):
          t -> { x, y, roll, lurch, dir }), input (MG.input), sound(name) (the game's world sounds,
          e.g. "hit"), game (the world's entry: name, intro, ...), canvas (e.g. its style.cursor;
          reset when the round ends) }
   Draw everything from t and the game's own state; don't use Math.random() or Date.now() (that
   breaks "everyone sees the same thing"). Desktop only: mouse and keyboard, no touch. */

window.MG = (() => {
  const W = 960, H = 600;
  const games = {};
  const register = (id, def) => (games[id] = def);

  /* Seeded random: mulberry32. r() in [0, 1); r.range(a, b), r.int(a, b) (inclusive), r.pick(list). */
  function rng(seed) {
    let s = seed >>> 0;
    const r = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (a, b) => a + r() * (b - a);
    r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
    r.pick = (list) => list[Math.floor(r() * list.length)];
    return r;
  }

  /* Ship motion: roll (radians), heave/sway (px) and lurch (0-1, a sudden jolt that fades), all
     from t (seconds) alone, so every player's ship moves the same. rough: 0 (still) to 1 (the
     for-real seas); more than 1 is rougher still. Lurches come every 4-9 s (seeded). */
  function motion(seed, rough = 1) {
    const r = rng(seed ^ 0x5bd1e995);
    const waves = [0, 1, 2].map((i) => ({ f: r.range(0.12, 0.35) * (i + 1), p: r.range(0, Math.PI * 2), a: 1 / (i + 1) }));
    const lurches = [];
    for (let t = r.range(3, 6); t < 600; t += r.range(4, 9)) lurches.push({ t, dir: r() < 0.5 ? -1 : 1, size: r.range(0.6, 1) });
    return (t) => {
      let roll = 0, heave = 0, sway = 0;
      for (const w of waves) {
        roll += Math.sin(t * w.f * 2 * Math.PI + w.p) * w.a;
        heave += Math.sin(t * w.f * 1.7 * Math.PI + w.p * 1.3) * w.a;
        sway += Math.cos(t * w.f * 1.3 * Math.PI + w.p * 0.7) * w.a;
      }
      // The latest lurch at or before t, fading over ~1.2 s.
      let lurch = 0, dir = 0;
      for (const L of lurches) {
        if (L.t > t) break;
        const k = Math.exp(-(t - L.t) * 2.5) * L.size;
        if (k > lurch) { lurch = k; dir = L.dir; }
      }
      return {
        roll: rough * (roll * 0.025 + dir * lurch * 0.06),
        y: rough * (heave * 8 + lurch * 6),
        x: rough * (sway * 6 + dir * lurch * 18),
        lurch: lurch * Math.min(1, rough),
        dir, // which way the latest lurch throws things: -1 left, 1 right (0 before the first)
      };
    };
  }

  /* Mouse and keyboard on the canvas, in its W x H coordinates.
     input.x / .y (pointer), .buttons (Set of 0 left, 2 right), .keys (Set of e.key, lowercased),
     input.take() -> events since the last call: { type: "down"|"up", x, y, button } |
     { type: "key", key } | { type: "wheel", dy } (dy: +1 / -1 per notch). Right-click doesn't open
     the browser menu over the canvas, and the wheel doesn't scroll the page there. */
  function input(canvas) {
    const st = { x: W / 2, y: H / 2, buttons: new Set(), keys: new Set(), queue: [] };
    const at = (e) => {
      const b = canvas.getBoundingClientRect();
      st.x = ((e.clientX - b.left) / b.width) * W;
      st.y = ((e.clientY - b.top) / b.height) * H;
    };
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); offs.push(() => el.removeEventListener(ev, fn, opt)); };
    const offs = [];
    on(canvas, "mousemove", at);
    on(canvas, "mousedown", (e) => { at(e); st.buttons.add(e.button); st.queue.push({ type: "down", x: st.x, y: st.y, button: e.button }); e.preventDefault(); });
    on(window, "mouseup", (e) => { at(e); st.buttons.delete(e.button); st.queue.push({ type: "up", x: st.x, y: st.y, button: e.button }); });
    on(canvas, "contextmenu", (e) => e.preventDefault());
    on(canvas, "wheel", (e) => { e.preventDefault(); st.queue.push({ type: "wheel", dy: Math.sign(e.deltaY) }); }, { passive: false });
    on(window, "keydown", (e) => {
      if (e.target.closest?.("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === " ") e.preventDefault(); // Space drops the mast section, not scrolls the page
      if (!e.repeat) st.queue.push({ type: "key", key: k });
      st.keys.add(k);
    });
    on(window, "keyup", (e) => st.keys.delete(e.key.toLowerCase()));
    on(window, "blur", () => { st.keys.clear(); st.buttons.clear(); });
    return {
      get x() { return st.x; }, get y() { return st.y; }, buttons: st.buttons, keys: st.keys,
      take() { const q = st.queue; st.queue = []; return q; },
      stop() { offs.forEach((f) => f()); },
    };
  }

  /* Run one round of a game on a canvas.
     opts: { canvas, def (the registered game), game (world entry), kind, seed, startsAt, endsAt
             (ms on clock()), clock (() -> ms, the server's clock), sound(name), onProgress(score),
             onDone(score), waiting? (the line under the score once done; default "Waiting for the crew…") }
     Before startsAt: the first frame with a 3-2-1 over it (a beep per number). Then the game until
     endsAt or its done(); then end() and `settle` more seconds of play (the tower settles), then
     onDone(score). Returns { setTimes(startsAt, endsAt) (the DM ended it early), stop() }. */
  function run(o) {
    const { canvas, def, game } = o;
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d");
    const set = (o.kind === "real" ? game.real : game.practice) || {};
    const inp = input(canvas);
    const ctx = { W, H, seed: o.seed, kind: o.kind, set, limit: game.limit, settle: game.settle || 0,
                  rng: rng(o.seed), motion: motion(o.seed, o.kind === "real" ? 1 : 0.35), input: inp,
                  sound: (name) => o.sound?.(name), game, canvas };
    let inst;
    try { inst = def.create(ctx); } catch (e) { console.error(e); inst = null; }
    let startsAt = o.startsAt, endsAt = o.endsAt, stopped = false, phase = "count", endedAt = null;
    let lastT = null, lastBeep = null, lastProgress = 0;
    const safe = (f, ...a) => { try { return f?.apply(inst, a); } catch (e) { console.error(e); } };
    const score = () => Math.max(0, Math.min(100, Math.round(Number(safe(inst?.score)) || 0)));

    function frame() {
      if (stopped) return;
      const now = o.clock();
      const t = Math.max(0, (now - startsAt) / 1000);
      if (phase === "count" && now >= startsAt) { phase = "play"; lastT = 0; }
      if (phase === "play" && (now >= endsAt || safe(inst?.done))) {
        phase = "settle"; endedAt = now;
        safe(inst?.end, t);
        o.sound?.("horn");
      }
      if (phase === "settle" && now >= endedAt + ctx.settle * 1000) {
        phase = "over";
        inp.stop();
        canvas.style.cursor = "";
        draw(t, "over");
        return o.onDone?.(score());
      }
      if (phase !== "count") {
        const dt = Math.min(0.1, Math.max(0, t - (lastT ?? t)));
        lastT = t;
        if (phase === "settle") inp.take(); // no more moves after time's up
        safe(inst?.update, dt, t);
        if (phase === "play" && now - lastProgress > 2000) { lastProgress = now; o.onProgress?.(score()); }
      } else {
        inp.take();
        const n = Math.ceil((startsAt - now) / 1000);
        if (n !== lastBeep && n <= 3) { lastBeep = n; o.sound?.("beep"); }
      }
      draw(t, phase);
      requestAnimationFrame(frame);
    }

    function draw(t, ph) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      g.save();
      safe(inst?.draw, g, ph === "count" ? 0 : t);
      g.restore();
      if (!inst) banner(g, "This game failed to load.", "Your score will be 0. Tell the DM.");
      // Time bar along the top.
      const left = ph === "count" ? 1 : Math.max(0, (endsAt - Math.max(startsAt, o.clock())) / (endsAt - startsAt));
      g.fillStyle = "rgba(10, 8, 18, .55)"; g.fillRect(0, 0, W, 8);
      g.fillStyle = left > 0.25 ? "#f6c27a" : "#ff8a6b"; g.fillRect(0, 0, W * left, 8);
      if (ph === "count") {
        const n = Math.max(1, Math.ceil((startsAt - o.clock()) / 1000));
        g.fillStyle = "rgba(10, 8, 18, .55)"; g.fillRect(0, 0, W, H);
        g.fillStyle = "#f4ead2"; g.textAlign = "center"; g.textBaseline = "middle";
        g.font = "600 140px Georgia, serif"; g.fillText(String(n), W / 2, H / 2 - 20);
        g.font = "22px Georgia, serif"; g.fillStyle = "#d8ccb0";
        g.fillText(o.kind === "real" ? "For real" : "Practice", W / 2, H / 2 + 80);
      } else if (ph === "settle" || ph === "over") {
        banner(g, ph === "over" ? `Score: ${score()}` : "Time!", ph === "over" ? (o.waiting ?? "Waiting for the crew…") : "");
      }
    }
    requestAnimationFrame(frame);
    return {
      setTimes(s, e) { startsAt = Math.min(startsAt, s); endsAt = e; },
      stop() { stopped = true; inp.stop(); canvas.style.cursor = ""; },
      get phase() { return phase; },
    };
  }

  function banner(g, big, small) {
    g.fillStyle = "rgba(10, 8, 18, .6)"; g.fillRect(0, H / 2 - 70, W, 140);
    g.fillStyle = "#f6c27a"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "600 56px Georgia, serif"; g.fillText(big, W / 2, H / 2 - (small ? 14 : 0));
    if (small) { g.font = "18px system-ui, sans-serif"; g.fillStyle = "#d8ccb0"; g.fillText(small, W / 2, H / 2 + 38); }
  }

  return { W, H, games, register, rng, motion, input, run };
})();
