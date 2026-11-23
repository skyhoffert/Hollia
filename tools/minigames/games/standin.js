/* Stand-in game: plays for any world game that has no games/<id>.js yet, so rounds, scoreboards,
   retries and bots can be tested before the real games exist. Knots light up one at a time on a
   swaying deck; click each, close to its center. Score: average closeness over all knots (the
   unclicked ones count 0). Uses only the shared kit: seed, motion, input. */

MG.register("standin", {
  create(ctx) {
    const { W, H, rng, motion, input } = ctx;
    const N = ctx.kind === "real" ? 14 : 8;
    const R = ctx.kind === "real" ? 26 : 40;
    const knots = Array.from({ length: N }, () => ({ x: rng.range(120, W - 120), y: rng.range(120, H - 110), hit: null }));
    let i = 0, m = motion(0);
    // Where knot k is on screen right now (it rides the deck).
    const at = (k) => {
      const c = Math.cos(m.roll), s = Math.sin(m.roll), dx = k.x - W / 2, dy = k.y - H / 2;
      return { x: W / 2 + dx * c - dy * s + m.x, y: H / 2 + dx * s + dy * c + m.y };
    };
    return {
      update(dt, t) {
        m = motion(t);
        for (const e of input.take()) {
          if (e.type !== "down" || e.button !== 0 || i >= N) continue;
          const p = at(knots[i]), d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d <= R) { knots[i].hit = 1 - d / R; i++; ctx.sound("hit"); }
        }
      },
      draw(g, t) {
        g.fillStyle = "#3b2c1e"; g.fillRect(0, 0, W, H);
        g.save();
        g.translate(W / 2 + m.x, H / 2 + m.y); g.rotate(m.roll); g.translate(-W / 2, -H / 2);
        // Deck planks.
        for (let y = -60; y < H + 60; y += 40) {
          g.fillStyle = (y / 40) % 2 ? "#6b4f33" : "#634830"; g.fillRect(-80, y, W + 160, 38);
        }
        // Thread between the knots already tied.
        g.strokeStyle = "#e9e2d0"; g.lineWidth = 3; g.beginPath();
        knots.slice(0, i).forEach((k, n) => (n ? g.lineTo(k.x, k.y) : g.moveTo(k.x, k.y)));
        g.stroke();
        knots.forEach((k, n) => {
          if (n > i) return;
          const lit = n === i;
          g.beginPath(); g.arc(k.x, k.y, lit ? R * (1 + 0.08 * Math.sin(t * 8)) : 9, 0, Math.PI * 2);
          g.fillStyle = lit ? "rgba(246, 194, 122, .35)" : "#c9a24a"; g.fill();
          if (lit) { g.strokeStyle = "#f6c27a"; g.lineWidth = 2; g.stroke(); g.beginPath(); g.arc(k.x, k.y, 5, 0, Math.PI * 2); g.fillStyle = "#f6c27a"; g.fill(); }
        });
        g.restore();
        g.fillStyle = "#d8ccb0"; g.font = "15px system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "alphabetic";
        g.fillText(`Stand-in game (${ctx.game.name} isn't built yet): click each glowing knot. ${i}/${N}`, 16, H - 16);
      },
      score() { return (100 * knots.reduce((a, k) => a + (k.hit || 0), 0)) / N; },
      done() { return i >= N; },
    };
  },
});
