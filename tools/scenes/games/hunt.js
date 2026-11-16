/* Minigame art, flavor "hunt" (a kind "timing" game; the runner and the frame fields:
   tools/scenes/game.js, "flavors"). Loaded when a game with this flavor opens.
   The archer's hunt (the Archon archer at the crossroads): first person, holding a drawn bow,
   out in the scrub at night. A frost hare hides in the near (left) bush; its head pokes out and
   the bush rustles (the fakes); then it breaks cover and bounds across the gap to the far bush
   (the tell: it's in the open; the strike: it's gone). Shoot while it's in the open. The
   background and the two bushes come from the world (games.<id>.art = { back, cover: [left,
   right], lane: [gap left x, gap right x, ground y] }, drawn with worlds/lib/art.js); this
   draws the hare, the bow and the arrow. Placeholder art. */
HolliaGame.flavor("hunt", {
  button: "Shoot!",
  draw(svg, art = {}) {
    const [X0, X1, Y] = art.lane || [287, 393, 284];
    const cover = art.cover || [];
    // Arrow pointing up, its head at 0,0 (on the bow, in flight, stuck in the ground).
    const ARROW = `<path d="M0 6 L0 116" stroke="#b89870" stroke-width="3"/>
      <polygon points="-6,8 0,-6 6,8" fill="#cfd6dc"/>
      <path d="M0 102 L-7 118 M0 102 L7 118" stroke="#a8473a" stroke-width="3"/>`;
    svg.innerHTML = `
      ${art.back || `<rect width="680" height="400" fill="#161d2e"/>`}
      <g id="hnPrey">
        <ellipse id="hnGlow" cx="0" cy="-14" rx="34" ry="20" fill="#cfe8ff" opacity=".12"/>
        <ellipse cx="-14" cy="-5" rx="10" ry="6" fill="#d9e2ec"/>
        <ellipse cx="-2" cy="-13" rx="20" ry="11" fill="#eef4ff"/>
        <circle cx="-22" cy="-15" r="5" fill="#fff"/>
        <ellipse cx="9" cy="-36" rx="3.5" ry="11" transform="rotate(-28 9 -36)" fill="#d9e2ec"/>
        <ellipse cx="14" cy="-36" rx="3.5" ry="11" transform="rotate(-14 14 -36)" fill="#eef4ff"/>
        <ellipse cx="18" cy="-20" rx="9" ry="7" fill="#eef4ff"/>
        <circle cx="22" cy="-21" r="1.6" fill="#2a3550"/>
        <path id="hnLeg" d="M12 -6 L18 0" stroke="#d9e2ec" stroke-width="4" stroke-linecap="round"/>
        <path id="hnHitArrow" d="M-4 -16 L-14 -40" stroke="#b89870" stroke-width="2" opacity="0"/>
      </g>
      <g id="hnCoverL">${cover[0] || ""}</g>
      <g id="hnCoverR">${cover[1] || ""}</g>
      <g id="hnFly" opacity="0">${ARROW}</g>
      <!-- The bow seen from behind, held level: grip farthest away (up), tips nearer, the
           string drawn back to the nock at the bottom. Left arm and hand on the grip, right
           hand at the nock. -->
      <g id="hnBow">
        <path d="M150 430 L326 338" stroke="#5a4a6a" stroke-width="40" stroke-linecap="round"/>
        <path id="hnString" fill="none" stroke="#e8e0c8" stroke-width="1.6"/>
        <path d="M206 362 Q214 350 230 350 Q290 334 340 330 Q390 334 450 350 Q466 350 474 362" fill="none" stroke="#7a5234" stroke-width="8" stroke-linecap="round"/>
        <g id="hnNocked" transform="translate(340 300)">${ARROW}</g>
        <rect x="324" y="322" width="32" height="22" rx="9" fill="#c9a27e"/>
        <g id="hnDrawHand"><path d="M372 440 L350 414" stroke="#5a4a6a" stroke-width="34" stroke-linecap="round"/>
          <circle cx="344" cy="410" r="13" fill="#c9a27e"/></g>
      </g>`;
    const q = (id) => svg.querySelector("#" + id);
    const prey = q("hnPrey"), glow = q("hnGlow"), leg = q("hnLeg"), hitArrow = q("hnHitArrow");
    const coverL = q("hnCoverL"), coverR = q("hnCoverR"), fly = q("hnFly"), bow = q("hnBow");
    const str = q("hnString"), nocked = q("hnNocked"), drawHand = q("hnDrawHand");
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const HID = X0 - 45, IN = X0 - 20, OUT = X1 + 20, GONE = X1 + 72, HOPS = 3;
    const FLY = 150, HEAD = [340, 300]; // arrow flight ms, where the nocked arrow's head sits
    // Where the hare is at try time t (f: how far a fake has come, 0..0.42).
    const at = (t, p, f) => {
      if (t < p.tell) return { x: HID + 32 * (f / 0.42), y: 0 };
      const k = (t - p.tell) / (p.strike - p.tell), x = Math.min(GONE, IN + (OUT - IN) * k);
      return { x, y: -Math.abs(Math.sin(Math.PI * HOPS * k)) * 9, gone: x >= GONE };
    };
    return (s) => {
      const p = s.plan, shot = s.since != null && s.result !== "late", shotT = shot ? s.t - s.since : null;
      // The hare: on a hit it keeps going until the arrow lands, then drops.
      let pos, hitK = 0;
      if (s.result === "win") {
        const hitT = Math.min(shotT + FLY, p.strike);
        pos = at(Math.min(s.t, hitT), p, 0);
        hitK = s.t > hitT ? clamp((s.t - hitT) / 250) : 0;
        if (hitK) pos.y = 0;
      } else pos = at(s.t, p, s.f);
      // Spooked by an early shot: a moment later it's gone back through the bush.
      const fade = s.result === "early" ? 1 - clamp((s.since - FLY - 150) / 250) : 1;
      prey.setAttribute("transform", `translate(${pos.x + 6 * hitK} ${Y + pos.y}) rotate(${-14 * hitK}) scale(1 ${1 - 0.35 * hitK})`);
      prey.setAttribute("opacity", pos.gone ? 0 : fade);
      glow.setAttribute("opacity", 0.12 * (1 - hitK));
      hitArrow.setAttribute("opacity", hitK ? 1 : 0);
      leg.setAttribute("d", s.t >= p.tell && !hitK ? "M10 -6 L22 -2" : "M12 -6 L18 0");
      // Bushes rustle: the near one during the fakes and as it breaks out (or when spooked),
      // the far one as it dives in.
      const rustle = (on) => (on ? Math.sin(performance.now() / 22) * 1.6 : 0);
      const spooked = s.result === "early" && s.since > FLY && s.since < FLY + 500;
      coverL.setAttribute("transform", `translate(${rustle((s.f > 0 && s.t < p.tell) || (s.t >= p.tell && s.t < p.tell + 180) || spooked)} 0)`);
      coverR.setAttribute("transform", `translate(${rustle(s.t >= p.strike && s.t < p.strike + 400 && s.result !== "win")} 0)`);
      // The bow: string drawn back until the shot, then snapped straight.
      str.setAttribute("d", shot ? "M206 362 L474 362" : "M206 362 L340 412 L474 362");
      nocked.setAttribute("opacity", shot ? 0 : 1);
      drawHand.setAttribute("transform", shot ? "translate(14 10)" : "");
      // Too slow: the hare's gone and the bow sinks.
      bow.setAttribute("transform", s.result === "late" ? `translate(0 ${30 * clamp(s.after / 600)})` : "");
      // The arrow in flight, shrinking into the distance: to where the hare will be (a hit), or
      // into the frozen dirt in the gap (early) where it stays.
      if (shot) {
        const to = s.result === "win" ? [at(Math.min(shotT + FLY, p.strike), p, 0).x, Y - 14] : [(X0 + X1) / 2, Y + 6];
        const k = clamp(s.since / FLY), x = HEAD[0] + (to[0] - HEAD[0]) * k, y = HEAD[1] + (to[1] - HEAD[1]) * k;
        const ang = Math.atan2(to[0] - HEAD[0], HEAD[1] - to[1]) * 180 / Math.PI;
        fly.setAttribute("transform", `translate(${x} ${y}) rotate(${ang}) scale(${1 - 0.72 * k})`);
        fly.setAttribute("opacity", s.result === "win" && k >= 1 ? 0 : 1);
      } else fly.setAttribute("opacity", 0);
    };
  },
});
