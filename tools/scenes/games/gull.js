/* Minigame art, flavor "gull" (a kind "timing" game; the runner and the frame fields:
   tools/scenes/game.js, "flavors"). Loaded when a game with this flavor opens.
   The shore gull, close up: a handful of raw seed held out on the left, the gull on the right.
   Same look as worlds/npcs/gull.js (pale, glowing, gold beak). Placeholder art. */
HolliaGame.flavor("gull", {
  draw(svg) {
    svg.innerHTML = `
      <rect width="680" height="400" fill="#161d2e"/>
      <rect y="150" width="680" height="80" fill="#1a2d42"/>
      <path class="a-pulse" style="--d:3s" d="M0 232 Q170 222 340 230 Q510 238 680 226" fill="none" stroke="#dfe6ec" stroke-width="3" opacity=".5"/>
      <path d="M0 236 Q170 226 340 234 Q510 242 680 230 L680 400 L0 400 Z" fill="#4a4438"/>
      <g fill="#3a3530"><ellipse cx="90" cy="300" rx="14" ry="6"/><ellipse cx="610" cy="370" rx="18" ry="7"/><ellipse cx="380" cy="380" rx="10" ry="5"/></g>
      <g id="gSeedsDown"></g>
      <ellipse id="gGlow" cx="470" cy="240" rx="150" ry="120" fill="#cfe8ff" opacity=".1"/>
      <path d="M462 285 L456 340 M486 285 L488 340" stroke="#d9b48a" stroke-width="6" stroke-linecap="round"/>
      <polygon points="530,238 582,222 574,262" fill="#b9cfe6"/>
      <ellipse cx="482" cy="252" rx="62" ry="38" fill="#eef4ff"/>
      <ellipse cx="504" cy="244" rx="44" ry="20" fill="#b9cfe6" transform="rotate(-8 504 244)"/>
      <circle class="a-pulse" style="--d:1.6s" cx="592" cy="232" r="4" fill="#bfe6ff"/>
      <path id="gNeck" fill="none" stroke="#eef4ff" stroke-width="30" stroke-linecap="round"/>
      <g id="gHead">
        <circle r="25" fill="#eef4ff"/>
        <polygon id="gBeak" points="-22,-5 -54,3 -22,10" fill="#e8c070"/>
        <circle id="gEyeGlow" cx="-8" cy="-7" r="9" fill="#ffd27a" opacity="0"/>
        <circle id="gEye" cx="-8" cy="-7" r="4" fill="#2a3550"/>
      </g>
      <g id="gHand">
        <path d="M60 420 L190 318" stroke="#5a4a6a" stroke-width="46" stroke-linecap="round"/>
        <path d="M178 328 L222 306" stroke="#c9a27e" stroke-width="30" stroke-linecap="round"/>
        <ellipse cx="236" cy="304" rx="30" ry="12" fill="#c9a27e"/>
        <g id="gSeeds" fill="#d9c38a"><ellipse cx="226" cy="298" rx="4" ry="3"/><ellipse cx="238" cy="296" rx="4" ry="3"/>
          <ellipse cx="248" cy="299" rx="4" ry="3"/><ellipse cx="232" cy="292" rx="4" ry="3"/><ellipse cx="243" cy="291" rx="4" ry="3"/></g>
      </g>
      <circle id="gFlash" cx="240" cy="300" r="40" fill="#ff6b6b" opacity="0"/>`;
    const q = (id) => svg.querySelector("#" + id);
    const head = q("gHead"), neck = q("gNeck"), hand = q("gHand"), eyeGlow = q("gEyeGlow"), eye = q("gEye");
    const glow = q("gGlow"), flash = q("gFlash"), seeds = q("gSeeds"), down = q("gSeedsDown");
    const H0 = [404, 190], HIT = [290, 298], BACK = [26, 14]; // head at rest, at the hand, wind-up offset
    let dropped = false;
    return (s) => {
      const bob = Math.sin(performance.now() / 260) * 3 * (1 - s.f);
      const x = H0[0] + (HIT[0] - H0[0]) * s.f + BACK[0] * s.crouch;
      const y = H0[1] + (HIT[1] - H0[1]) * s.f + BACK[1] * s.crouch + bob;
      head.setAttribute("transform", `translate(${x} ${y}) rotate(${s.f * 18 - s.crouch * 10})`);
      neck.setAttribute("d", `M452 232 Q${(452 + x) / 2 + 20} ${(232 + y) / 2 - 10} ${x + 6} ${y + 4}`);
      eyeGlow.setAttribute("opacity", s.tell ? 0.85 : 0);
      eye.setAttribute("fill", s.tell ? "#fff3c4" : "#2a3550");
      glow.setAttribute("opacity", 0.1 + (s.tell ? 0.12 : 0));
      hand.setAttribute("transform", `translate(${-40 * s.pulled} ${130 * s.pulled})`);
      flash.setAttribute("opacity", s.hit ? Math.max(0, 0.5 - s.after / 1200) : 0);
      // The handful is used up either way: pulling back spills it on the shingle.
      if (s.pulled > 0 && !dropped) {
        dropped = true;
        seeds.setAttribute("opacity", 0);
        down.innerHTML = [[222, 352], [236, 360], [251, 355], [263, 366], [214, 368]]
          .map(([sx, sy]) => `<ellipse cx="${sx}" cy="${sy}" rx="4" ry="3" fill="#d9c38a"/>`).join("");
      }
    };
  },
});
