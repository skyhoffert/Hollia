/* Minigames: the locked-in game view over the scene (world.games; server side and the rules:
   "games" in server/activities.js). One kind so far, "timing": something moves, fakes, then gives
   a tell just before the real moment; pull back between the tell and the strike to win. Each
   flavor is its own art, one file each in tools/scenes/games/<flavor>.js, loaded the first
   time a game with that flavor opens: "gull" (the shore gull), "pivot" (jump the seed farm pivot
   arm's drag hose; the farm kids dare you), "hunt" (shoot a hare as it dashes between two bushes;
   the Archon archer). A flavor may also use the world's games.<id>.art (hunt does).
   New flavor: copy one of those files, rename it and the HolliaGame.flavor("<name>", ...) in it,
   and set flavor: "<name>" on the game in the world (check-world checks the file exists).

   The server rolls each try's timeline (try.plan, from the player's level) and takes the cost
   item; this page plays it and judges the timing:
     plan = { speed, moves: [{ at, len }] (fakes), tell, strike, end }   (ms from the start)
     pull before tell -> "early", between tell and strike (+ a hair) -> "win", none by then -> "late".
   A win is settled at once. A loss waits ("…") until the DM picks what happens (game-verdict).

   HolliaGame.init({ send, narrate, onEnd, art })   onEnd: the view closed (the engine redraws);
                                   art(gameId): the world's games.<id>.art (flavor's draw gets it)
   HolliaGame.start(gameId)        ask the server for a try (a hotspot's or choice's action: { game })
   HolliaGame.resume(game)         welcome: { try, pending? } -> back into it after a refresh
   HolliaGame.onMessage(m)         game-result / game-verdict / shells
   HolliaGame.flavor(name, def)    a games/<flavor>.js file registers its art (see "flavors" below)
   HolliaGame.busy()               a game is open or being asked for (the engine keeps a hotspot held)
   While open, body.gaming locks the scene like a conversation.

   Kind "shells" (the street hustler; server: "the shell game" in server/activities.js): he puts a
   coin under one of three shells and shuffles them (here, just for show), the player picks one,
   then it waits ("…") on the DM, who marks it right or wrong. The view only shows what the server
   says (shells = { round, rounds, pot, stage, pick, canGoOn }): stage pick / wait / won / over. */
window.HolliaGame = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const GRACE = 60; // ms after the strike that a pull still counts
  let o = null, req = 0, waiting = {}, starting = false;
  let cur = null; // { try, t0, pulled, result, art, raf, doneSent, pending }

  /* ---------- flavors: art + how it looks at each moment ----------
     HolliaGame.flavor("<name>", { button?, draw }) in tools/scenes/games/<name>.js.
     draw(svg, art) -> frame({ f, crouch, tell, pulled, hit, after, t, plan, since, result }) where f is
     how far the strike has come (0..1; during a fake, how far the fake has come, up to 0.42),
     crouch the wind-up before it (0..1), tell true during the tell, pulled how far the player has
     pulled back (0..1), hit the strike landed on them, after: ms since it was decided, t the try's
     clock (ms; stops where an early pull froze it), plan the try's timeline, since ms since the
     player acted (null before), result "win" | "early" | "late" | undefined.
     button: the action button's text (default "Pull back!"). */
  // Flavors register themselves from tools/scenes/games/<flavor>.js (HolliaGame.flavor),
  // loaded the first time a game with that flavor opens (or resumes).
  const FLAVORS = {};
  const loading = {}; // flavor -> [callbacks waiting for its file]
  function flavor(name, def) {
    FLAVORS[name] = def;
    (loading[name] || []).forEach((fn) => fn());
    delete loading[name];
  }
  // Run fn once the flavor's art is here (loads games/<name>.js the first time). A file that's
  // missing or broken: fn runs anyway and open() says the game isn't built.
  function withFlavor(name, fn) {
    if (FLAVORS[name] || !/^[a-z0-9_-]+$/i.test(name || "")) return fn();
    if (loading[name]) return loading[name].push(fn);
    loading[name] = [fn];
    const el = document.createElement("script");
    el.src = `games/${name}.js`;
    el.onerror = () => { const w = loading[name] || []; delete loading[name]; w.forEach((f) => f()); };
    document.head.appendChild(el);
  }

  /* ---------- the timing runner (every flavor) ---------- */
  function state(plan, t) {
    let f = 0, crouch = 0;
    for (const m of plan.moves) if (t >= m.at && t <= m.at + m.len) f = Math.max(f, 0.42 * Math.sin(Math.PI * (t - m.at) / m.len));
    const tell = t >= plan.tell && t < plan.strike;
    if (tell) crouch = (t - plan.tell) / (plan.strike - plan.tell);
    const strikeLen = 110 / plan.speed;
    if (t >= plan.strike) f = Math.min(1, (t - plan.strike) / strikeLen);
    return { f, crouch, tell };
  }

  function frame() {
    if (!cur) return;
    const p = cur.try.plan, now = performance.now(), t = now - cur.t0;
    if (!cur.result && !cur.pending && t > p.strike + GRACE) judge(t, "late");
    const s = state(p, cur.frozenAt ?? t);
    s.t = cur.frozenAt ?? t; s.plan = p; s.result = cur.result;
    s.since = cur.pulledAt != null ? t - cur.pulledAt : null;
    s.pulled = cur.pulledAt != null ? Math.min(1, (t - cur.pulledAt) / 160) : 0;
    s.hit = cur.result === "late";
    s.after = cur.result ? now - cur.judgedAt : 0;
    cur.art(s);
    // A little after it's decided, tell the server (once).
    if (cur.result && !cur.doneSent && now - cur.judgedAt > 900) sendDone();
    cur.raf = requestAnimationFrame(frame);
  }

  function judge(t, result) {
    cur.result = result;
    cur.judgedAt = performance.now();
    // Pulled back early: the gull stops mid-move; a win lets the strike finish on empty air.
    if (result === "early") cur.frozenAt = t;
    $("gamePull").disabled = true;
    $("gameMsg").textContent = "";
  }

  function pull() {
    if (!cur || cur.result || cur.pending || cur.pulledAt != null) return;
    const t = performance.now() - cur.t0, p = cur.try.plan;
    cur.pulledAt = t;
    judge(t, t < p.tell ? "early" : t <= p.strike + GRACE ? "win" : "late");
  }

  function sendDone() {
    cur.doneSent = true;
    ask({ op: "done", id: cur.try.id, result: cur.result }, (r) => {
      if (!cur) return;
      if (r.error) return finish(r.error);
      if (r.pending) { o.onLose?.(cur.try.game); return wait(r.say); } // its loseSound
      if (cur.result === "win") o.onWin?.(cur.try.game); // its winSound
      else o.onLose?.(cur.try.game); // a no-risk game's miss: settled at once, its loseSound
      finish(r.say || "");
    });
  }

  /* ---------- the shell game (kind "shells") ----------
     sh = { s: shells view from the server, pos: [x of shell 0, 1, 2], raf, phase, over } */
  let sh = null;
  const SX = [200, 340, 480], SY = 268; // where the three shells rest (scene coordinates)
  function shellsDraw() {
    const svg = $("gameView");
    // Placeholder art: an upturned crate under a lantern, three clay shells, a gold coin.
    svg.innerHTML = `
      <rect width="680" height="400" fill="#171c2b"/>
      <ellipse cx="340" cy="90" rx="260" ry="120" fill="#ffd27a" opacity=".06"/>
      <rect x="0" y="300" width="680" height="100" fill="#4d4334"/>
      <rect x="110" y="270" width="460" height="90" fill="#6b4a30"/>
      <rect x="110" y="270" width="460" height="10" fill="#8a5f3c"/>
      <path d="M110 312 H570 M110 336 H570" stroke="#5a3d27" stroke-width="3"/>
      <g id="shCoin" opacity="0"><ellipse rx="15" ry="6" fill="#f0c860"/><ellipse rx="9" ry="3" fill="#ffe08a"/></g>
      <g id="shShells">${[0, 1, 2].map((i) => `
        <g class="shell" data-shell="${i}" tabindex="0" role="button" aria-label="Shell ${i + 1}">
          <ellipse class="sh-ring" cx="0" cy="2" rx="46" ry="12" fill="none" stroke="#f6c27a" stroke-width="3" opacity="0"/>
          <path d="M-38 0 Q-36 -52 0 -54 Q36 -52 38 0 Z" fill="#a8744a"/>
          <path d="M-24 -10 Q-22 -40 0 -42 Q22 -40 24 -10" fill="none" stroke="#8a5a36" stroke-width="3"/>
          <ellipse cx="0" cy="0" rx="38" ry="7" fill="#7a5234"/>
          <rect x="-46" y="-60" width="92" height="70" fill="transparent"/>
        </g>`).join("")}</g>`;
    svg.querySelectorAll(".shell").forEach((g) => {
      const go = () => shellsPick(+g.dataset.shell);
      g.addEventListener("click", go);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }
  // Place the shells (x per shell; lift: how far each is raised) and the coin.
  function shellsPlace(pos, lift = [0, 0, 0], coinAt = null) {
    const svg = $("gameView");
    svg.querySelectorAll(".shell").forEach((g, i) => {
      g.setAttribute("transform", `translate(${pos[i]} ${SY - lift[i]})`);
      const ring = g.querySelector(".sh-ring");
      ring.setAttribute("opacity", sh.s.pick === i && sh.s.stage !== "pick" ? 1 : 0);
      g.style.cursor = sh.s.stage === "pick" && !sh.phase ? "pointer" : "default";
    });
    const coin = svg.querySelector("#shCoin");
    coin.setAttribute("opacity", coinAt == null ? 0 : 1);
    if (coinAt != null) coin.setAttribute("transform", `translate(${coinAt} ${SY - 2})`);
  }
  // Run an animation: step(t ms) returns false when done.
  function shellsAnim(step, then) {
    cancelAnimationFrame(sh.raf);
    const t0 = performance.now();
    const tick = () => {
      if (!sh) return;
      if (step(performance.now() - t0) === false) return then?.();
      sh.raf = requestAnimationFrame(tick);
    };
    sh.raf = requestAnimationFrame(tick);
  }
  // The coin goes under the middle shell, then the shuffle: swaps, faster and faster.
  function shellsShuffle() {
    sh.phase = "shuffle";
    const LIFT = 70, n = 9 + Math.floor(Math.random() * 4);
    const swaps = Array.from({ length: n }, () => { const a = Math.floor(Math.random() * 3); return [a, (a + 1 + Math.floor(Math.random() * 2)) % 3]; });
    // 0-700 ms: middle shell lifts, coin shown; 700-1200: drops over it; then the swaps.
    shellsAnim((t) => {
      if (t < 1200) {
        const up = t < 400 ? t / 400 : t < 700 ? 1 : Math.max(0, 1 - (t - 700) / 300);
        shellsPlace(SX, [0, LIFT * up, 0], t < 1000 ? SX[1] : null);
        return true;
      }
      // Worked out fresh each frame: swaps already done, then the one in progress.
      let u = t - 1200;
      const order = [0, 1, 2], pos = SX.slice(); // order[slot] = the shell in that slot
      for (let k = 0; k < swaps.length; k++) {
        const len = Math.max(150, 380 - k * 28);
        if (u >= len) { const [a, b] = swaps[k]; [order[a], order[b]] = [order[b], order[a]]; u -= len; continue; }
        const [a, b] = swaps[k], f = 0.5 - Math.cos(Math.PI * u / len) / 2;
        for (let i = 0; i < 3; i++) pos[i] = SX[order.indexOf(i)];
        const sa = order[a], sb = order[b];
        pos[sa] = SX[a] + (SX[b] - SX[a]) * f;
        pos[sb] = SX[b] + (SX[a] - SX[b]) * f;
        // One shell hops a little over the other.
        const lift = [0, 0, 0]; lift[sa] = 18 * Math.sin(Math.PI * f);
        shellsPlace(pos, lift);
        return true;
      }
      return false;
    }, () => {
      // Shells end up in the slots: shell i is just "whatever's in slot i" from here on.
      sh.phase = null;
      shellsPlace(SX);
      const m = $("gameMsg");
      m.textContent = [m.textContent, "Pick a shell."].filter(Boolean).join(" ");
    });
  }
  // The DM's call: lift the picked shell (coin under it if right); wrong: the coin's under another.
  function shellsReveal(right) {
    const pick = sh.s.pick ?? 1, other = [0, 1, 2].filter((i) => i !== pick)[Math.floor(Math.random() * 2)];
    sh.phase = "reveal";
    shellsAnim((t) => {
      const up = Math.min(1, t / 350) * 70, lift = [0, 0, 0];
      lift[pick] = up;
      if (!right && t > 700) lift[other] = Math.min(1, (t - 700) / 350) * 70;
      shellsPlace(SX, lift, right ? SX[pick] : t > 700 ? SX[other] : null);
      return t < (right ? 900 : 1500);
    }, () => { sh.phase = null; });
  }
  function shellsButtons() {
    const s = sh.s;
    $("gamePull").hidden = true;
    $("shellsGo").hidden = s.stage !== "won" || !s.canGoOn;
    $("shellsTake").hidden = s.stage !== "won";
    $("shellsTake").textContent = `Take the ${s.pot} coins and go`;
    $("shellsGo").textContent = "Go on (add a coin)";
    $("gameDone").hidden = s.stage !== "over";
    const focus = s.stage === "won" ? (s.canGoOn ? "shellsGo" : "shellsTake") : s.stage === "over" ? "gameDone" : null;
    if (focus) setTimeout(() => $(focus)?.focus(), 50);
  }
  function shellsOpen(s, say) {
    close(true);
    sh = { s, pos: SX.slice() };
    document.body.classList.add("gaming");
    $("game").hidden = false;
    $("gameView").toggleAttribute("hidden", false);
    shellsDraw();
    shellsShow(say, true);
  }
  // Show the state the server sent (fresh: just opened).
  function shellsShow(say, fresh) {
    const s = sh.s;
    shellsButtons();
    $("gameMsg").textContent = [say, s.stage === "wait" ? "…" : ""].filter(Boolean).join(" ");
    if (s.stage === "pick") {
      if (fresh || !sh.shuffled) { sh.shuffled = true; shellsShuffle(); }
      return;
    }
    if (!sh.phase) shellsPlace(SX);
  }
  function shellsResume(s) {
    if (sh?.s.id === s.id) { sh.s = s; return shellsShow(""); }
    shellsOpen(s, s.stage === "wait" ? "He waits for the call." : "");
  }
  // From the server: the DM's call, or the answer to a pick / go on / take.
  function shellsUpdate(s, say, right) {
    if (!s) return;
    if (!sh || sh.s.id !== s.id) return shellsOpen(s, say);
    const was = sh.s.stage;
    const newRound = s.round !== sh.s.round;
    sh.s = s;
    if (newRound) sh.shuffled = false;
    if (was === "wait" && right != null) { shellsReveal(right); right ? o.onWin?.(s.game) : o.onLose?.(s.game); } // the DM's call: winSound / loseSound
    if (s.stage === "over") sh.over = true;
    shellsShow(say);
  }
  function shellsPick(i) {
    if (!sh || sh.s.stage !== "pick" || sh.phase || sh.picking) return;
    sh.picking = true;
    sh.s = { ...sh.s, pick: i };
    shellsAsk({ op: "pick", shell: i }, () => { if (sh) sh.picking = false; });
  }
  function shellsAsk(msg, after) {
    if (!sh || sh.asking) return;
    sh.asking = true;
    $("shellsGo").disabled = $("shellsTake").disabled = true;
    ask({ id: sh.s.id, ...msg }, (r) => {
      if (!sh) return;
      sh.asking = false;
      $("shellsGo").disabled = $("shellsTake").disabled = false;
      after?.();
      if (r.error) { if (r.shells) sh.s = r.shells; shellsButtons(); $("gameMsg").textContent = r.error; return; }
      if (r.shells.stage === "over") sh.over = true;
      shellsUpdate(r.shells, r.say);
    });
  }
  function shellsClose(quiet) {
    if (!sh) return;
    cancelAnimationFrame(sh.raf);
    const said = sh.over ? $("gameMsg").textContent : "";
    sh = null;
    ["shellsGo", "shellsTake"].forEach((id) => { if ($(id)) $(id).hidden = true; });
    document.body.classList.remove("gaming");
    $("game").hidden = true;
    $("gameView").toggleAttribute("hidden", true);
    $("gameView").innerHTML = "";
    if (!quiet) { o.narrate(said); o.onEnd?.(); }
  }

  /* ---------- the view ---------- */
  function open(tr, say) {
    close(true);
    const F = FLAVORS[tr.flavor];
    if (!F) { o.narrate("(That game isn't built yet.)"); return; }
    document.body.classList.add("gaming");
    $("game").hidden = false;
    $("gameView").toggleAttribute("hidden", false); // an <svg>: no .hidden property, use the attribute
    $("gameDone").hidden = true;
    $("gamePull").hidden = false;
    $("gamePull").disabled = false;
    $("gamePull").textContent = F.button || "Pull back!";
    $("gameMsg").textContent = say || "";
    cur = { try: tr, t0: performance.now() + 300, art: F.draw($("gameView"), o.art?.(tr.game)) };
    cur.raf = requestAnimationFrame(frame);
    setTimeout(() => $("gamePull").focus(), 50);
  }
  // A loss: waiting for the DM ("…"), still locked in.
  function wait(say) {
    if (!cur) return;
    cur.pending = true;
    $("gamePull").hidden = true;
    $("gameMsg").textContent = [say, "…"].filter(Boolean).join(" ");
  }
  // Settled (a win, or the DM's verdict): the line stays up with a Done button.
  function finish(text) {
    if (!cur) return;
    cur.pending = false;
    cur.finished = text;
    $("gamePull").hidden = true;
    $("gameMsg").textContent = text;
    $("gameDone").hidden = false;
    setTimeout(() => $("gameDone").focus(), 50);
  }
  function close(quiet) {
    if (cur?.raf) cancelAnimationFrame(cur.raf);
    const said = cur?.finished;
    cur = null;
    document.body.classList.remove("gaming");
    $("game").hidden = true;
    $("gameView").toggleAttribute("hidden", true);
    $("gameView").innerHTML = "";
    if (!quiet) { o.narrate(said || ""); o.onEnd?.(); }
  }

  function ask(msg, cb) {
    const id = ++req;
    waiting[id] = cb;
    o.send({ t: "game", req: id, ...msg });
  }

  function start(gameId) {
    if (cur || sh || starting) return;
    starting = true;
    o.narrate("…");
    ask({ op: "start", game: gameId }, (r) => {
      if (r.error) { starting = false; o.narrate(r.error); return o.onIdle?.(); }
      if (r.shells) { starting = false; o.narrate(""); o.onOpen?.(gameId); return shellsOpen(r.shells, r.say); }
      // Still "starting" (busy) while its art loads, so the engine keeps the hotspot held.
      withFlavor(r.try.flavor, () => {
        starting = false;
        o.narrate("");
        o.onOpen?.(gameId); // its startSound (not on a resume after refresh)
        open(r.try, r.say);
      });
    });
  }

  // After a refresh or reconnect: replay an unfinished try, or keep waiting on the DM.
  function resume(g) {
    if (g?.shells) return shellsResume(g.shells);
    if (sh && !sh.over) shellsClose(true);
    if (!g?.try) { if (cur && !cur.finished) close(true); return; }
    if (cur?.try.id === g.try.id) return;
    withFlavor(g.try.flavor, () => {
      if (cur?.try.id === g.try.id) return;
      open(g.try);
      if (!cur) return; // no art for it (open said so)
      if (g.pending) {
        cur.result = g.pending.result; cur.judgedAt = performance.now() - 2000; cur.doneSent = true;
        cur.t0 = performance.now() - g.try.plan.end; cur.pulledAt = g.pending.result === "late" ? null : g.try.plan.tell - 1;
        if (g.pending.result === "early") cur.frozenAt = cur.pulledAt;
        wait("");
      }
    });
  }

  function onMessage(m) {
    if (m.t === "shells") return shellsUpdate(m.shells, m.say, m.right);
    if (m.t === "game-result") { waiting[m.req]?.(m); delete waiting[m.req]; }
    else if (m.t === "game-verdict") { if (cur) finish(m.text); else o.narrate(m.text); }
  }

  function init(opts) {
    o = opts;
    $("gamePull").onclick = pull;
    $("gameView").addEventListener("pointerdown", (e) => { e.preventDefault(); pull(); });
    $("gameDone").onclick = () => (sh ? shellsClose() : close());
    // The shell game's own buttons, next to Done.
    const row = $("gameDone").parentNode;
    for (const [id, text, fn] of [["shellsGo", "Go on", () => shellsAsk({ op: "next" })], ["shellsTake", "Take the pot", () => shellsAsk({ op: "take" })]]) {
      const b = document.createElement("button");
      b.type = "button"; b.id = id; b.hidden = true; b.textContent = text; b.onclick = fn;
      row.insertBefore(b, $("gameDone"));
    }
    document.addEventListener("keydown", (e) => {
      if (!cur || cur.result || cur.pending) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); pull(); }
    });
  }

  return { init, start, resume, onMessage, flavor, active: () => !!(cur || sh), busy: () => !!(cur || sh || starting) };
})();
