/* Minigame art, flavor "pivot" (a kind "timing" game; the runner and the frame fields:
   tools/scenes/game.js, "flavors"). Loaded when a game with this flavor opens.
   The seed farm pivot jump (the farm kids' dare): standing in a furrow at night, the pivot
   arm comes round from the right, high overhead, its weighted drag hose skimming the frost
   at knee height. It lurches and stalls (the fakes); the water hissing on is the tell; then
   the arm swings through. Jump the hose. Placeholder art. */
HolliaGame.flavor("pivot", {
  button: "Jump!",
  draw(svg) {
    const rows = [250, 264, 282, 306, 336, 372].map((y, i) =>
      `<path d="M0 ${y} Q340 ${y - 6 - i} 680 ${y}" fill="none" stroke="#5e6b42" stroke-width="${3 + i * 1.6}" opacity=".9"/>`).join("");
    const frost = [[60, 262], [180, 286], [300, 250], [420, 310], [530, 270], [640, 340], [110, 352], [470, 380]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6"/>`).join("");
    // The arm, drawn with its leading drag hose at x = 0, the ground at y = 0.
    const truss = Array.from({ length: 9 }, (_, i) => `M${i * 110} -208 L${i * 110 + 55} -176 L${i * 110 + 110} -208`).join(" ");
    const drops = [110, 220, 330, 440, 550, 660].map((x) => `
        <path d="M${x} -192 L${x} -150" stroke="#6a7080" stroke-width="2"/>
        <circle cx="${x}" cy="-148" r="3" fill="#8a909e"/>
        <path class="pvSpray" d="M${x - 16} -126 Q${x} -160 ${x + 16} -126" fill="none" stroke="#dff2ff" stroke-width="2" opacity="0"/>`).join("");
    svg.innerHTML = `
      <rect width="680" height="400" fill="#161d2e"/>
      <rect y="150" width="680" height="80" fill="#202a3e"/>
      <g fill="#e8eef8"><circle cx="70" cy="40" r="1.3"/><circle cx="250" cy="70" r="1"/><circle cx="420" cy="30" r="1.4"/><circle cx="610" cy="80" r="1.1"/></g>
      <rect y="230" width="680" height="170" fill="#4f4536"/>
      ${rows}
      <g fill="#cfdbe2" opacity=".55">${frost}</g>
      <ellipse id="pvShadow" cx="214" cy="344" rx="16" ry="4" fill="#2c261e" opacity=".6"/>
      <!-- The player: a plain oval placeholder (player characters are Archons; no likeness). -->
      <g id="pvPlayer"><ellipse cx="214" cy="302" rx="17" ry="42" fill="#c9d6e8" stroke="#8fa2bd" stroke-width="2"/></g>
      <g id="pvArm">
        <path d="M-20 -208 L1000 -208 M-20 -176 L1000 -176" stroke="#5a5f6e" stroke-width="4"/>
        <path d="${truss}" fill="none" stroke="#5a5f6e" stroke-width="2.5"/>
        ${drops}
        <path d="M8 -176 Q4 -90 12 -26" fill="none" stroke="#3e434e" stroke-width="5"/>
        <rect x="-6" y="-30" width="34" height="12" rx="3" fill="#7a808e"/>
        <path id="pvLowSpray" d="M-14 -16 Q11 -2 36 -16" fill="none" stroke="#dff2ff" stroke-width="2.5" opacity="0"/>
        <ellipse id="pvMist" cx="300" cy="-120" rx="380" ry="70" fill="#dff2ff" opacity="0"/>
      </g>
      <circle id="pvFlash" cx="214" cy="320" r="46" fill="#9fd8ff" opacity="0"/>`;
    const q = (id) => svg.querySelector("#" + id);
    const arm = q("pvArm"), player = q("pvPlayer"), shadow = q("pvShadow"), flash = q("pvFlash"), mist = q("pvMist"), low = q("pvLowSpray");
    const sprays = [...svg.querySelectorAll(".pvSpray")];
    const X0 = 560, XHIT = 210, GROUND = 344;
    const clamp = (v) => Math.max(0, Math.min(1, v));
    return (s) => {
      const p = s.plan, strikeLen = 110 / p.speed, passT = p.strike + strikeLen;
      // How far round the arm has come (0 = start, 1 = at the player): a slow creep, the fakes
      // lurch it on and it settles back, the tell carries it closer, the strike swings it in.
      let k;
      if (s.t < p.tell) k = 0.3 * clamp(s.t / p.tell) + 0.2 * (s.f / 0.42);
      else if (s.t < p.strike) k = 0.3 + 0.4 * s.crouch;
      else k = 0.7 + 0.3 * s.f;
      let x = X0 + (XHIT - X0) * k;
      if (s.t > passT && s.result !== "late") x = XHIT - (s.t - passT) * 1.1; // sweeps on past
      if (s.result === "late") x = Math.max(XHIT - 40, x - (s.t - passT) * 0.15);
      const shake = s.f > 0 && s.t < p.tell ? Math.sin(s.t / 18) * 1.5 : 0;
      arm.setAttribute("transform", `translate(${x} ${GROUND + shake})`);
      // Water: off until the tell (the hiss), then on.
      const wet = s.t >= p.tell ? 0.85 + Math.sin(s.t / 40) * 0.15 : 0;
      sprays.forEach((e) => e.setAttribute("opacity", wet));
      low.setAttribute("opacity", wet);
      mist.setAttribute("opacity", wet * 0.1);
      // The player: a jump (win: up until the hose has gone under; early: up and straight back
      // down), knocked flat when it's late.
      let up = 0, tilt = 0;
      if (s.since != null && s.result !== "late") {
        const u = s.since;
        if (s.result === "win") {
          const down = Math.max(300, passT + 160 - (s.t - u)); // when to come down, after the jump
          up = u < 150 ? u / 150 : u < down ? 1 : Math.max(0, 1 - (u - down) / 220);
        } else up = Math.sin(Math.PI * clamp(u / 520));
      }
      if (s.hit) tilt = -80 * clamp(s.after / 260);
      player.setAttribute("transform", `translate(0 ${-70 * up}) rotate(${tilt} 214 ${GROUND})`);
      shadow.setAttribute("rx", 16 - 6 * up);
      flash.setAttribute("opacity", s.hit ? Math.max(0, 0.45 - s.after / 1400) : 0);
    };
  },
});
