/* Click the Circles: a simple test game. Circles pop up one after another at seeded spots (same
   for everyone in the round) and fade after `life` seconds; click them before they go.
   Settings (world practice / real): gap (seconds between circles), life (seconds each stays),
   r (radius). Score: share of circles clicked, 0-100. */

MG.register("circles", {
  create(ctx) {
    const { W, H, rng, input, limit } = ctx;
    const gap = ctx.set.gap ?? 0.6, life = ctx.set.life ?? 1.5, R = ctx.set.r ?? 36;
    const circles = [];
    for (let t = 0.3; t + 0.4 < limit; t += gap)
      circles.push({ t, x: rng.range(R + 20, W - R - 20), y: rng.range(R + 50, H - R - 50), hit: false });
    const live = (c, t) => !c.hit && t >= c.t && t < c.t + life;
    let now = 0;
    return {
      update(dt, t) {
        now = t;
        for (const e of input.take()) {
          if (e.type !== "down" || e.button !== 0) continue;
          // Newest circle first, if they overlap.
          for (let i = circles.length - 1; i >= 0; i--) {
            const c = circles[i];
            if (live(c, t) && Math.hypot(e.x - c.x, e.y - c.y) <= R) { c.hit = true; ctx.sound("hit"); break; }
          }
        }
      },
      draw(g, t) {
        g.fillStyle = "#20242e"; g.fillRect(0, 0, W, H);
        for (const c of circles) {
          if (!live(c, t)) continue;
          const k = (t - c.t) / life; // 0 -> 1 over its life
          g.globalAlpha = 1 - k * 0.7;
          g.beginPath(); g.arc(c.x, c.y, R, 0, Math.PI * 2);
          g.fillStyle = "#4f9fd9"; g.fill();
          // Shrinking ring: time left.
          g.beginPath(); g.arc(c.x, c.y, R * (1 - k) + 4, 0, Math.PI * 2);
          g.strokeStyle = "#e6e9ef"; g.lineWidth = 2; g.stroke();
          g.globalAlpha = 1;
        }
        const shown = circles.filter((c) => c.t <= t).length, hits = circles.filter((c) => c.hit).length;
        g.fillStyle = "#c9cfdb"; g.font = "16px system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "alphabetic";
        g.fillText(`Clicked ${hits} / ${shown}`, 16, H - 16);
      },
      score() { return circles.length ? (100 * circles.filter((c) => c.hit).length) / circles.length : 0; },
      done() { return now > circles[circles.length - 1].t + life; },
    };
  },
});
