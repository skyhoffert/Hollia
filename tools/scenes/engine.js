/* Hollia scene engine: client for the "scenes" tool.
   The world (worlds/<name>.js on the server) arrives in the welcome message,
   and the server keeps everyone's position in sync. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  let CFG = null, ME = null;

  const $ = (id) => document.getElementById(id);
  const svg = $("scene"), stage = $("stage"), tip = $("tip");

  /* ---------- helpers ---------- */
  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fragment(markup, parent) {
    const g = el("g", {}, parent);
    g.innerHTML = markup;
    return g;
  }
  function applyAnim(node, a) {
    if (!a) return;
    node.classList.add("a-" + a.type);
    if (a.reverse) node.classList.add("a-rev");
    if (a.dur) node.style.setProperty("--d", a.dur + "s");
    if (a.amount != null) node.style.setProperty("--amt", a.amount);
    if (a.origin) {
      node.style.setProperty("--ox", a.origin[0] + "px");
      node.style.setProperty("--oy", a.origin[1] + "px");
    }
  }
  const scene = (id) => CFG.scenes[id];
  const firstSpot = (s) => s.defaultSpot || Object.keys(s.spots || {})[0] || null;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function center(sh) {
    if (sh.type === "circle" || sh.type === "ellipse") return { x: sh.x, y: sh.y };
    if (sh.type === "rect") return { x: sh.x + sh.w / 2, y: sh.y + sh.h / 2 };
    const p = sh.points.trim().split(/[\s,]+/).map(Number);
    let x = 0, y = 0;
    for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; }
    return { x: x / (p.length / 2), y: y / (p.length / 2) };
  }
  function corner(sh) {
    if (sh.type === "circle") return { x: sh.x + sh.r * 0.75, y: sh.y - sh.r * 0.75 };
    if (sh.type === "ellipse") return { x: sh.x + sh.rx * 0.75, y: sh.y - sh.ry * 0.75 };
    if (sh.type === "rect") return { x: sh.x + sh.w, y: sh.y };
    return center(sh);
  }
  function shapeEl(sh, parent, cls) {
    const a = { class: cls };
    if (sh.type === "circle") return el("circle", { ...a, cx: sh.x, cy: sh.y, r: sh.r }, parent);
    if (sh.type === "ellipse") return el("ellipse", { ...a, cx: sh.x, cy: sh.y, rx: sh.rx, ry: sh.ry }, parent);
    if (sh.type === "rect") return el("rect", { ...a, x: sh.x, y: sh.y, width: sh.w, height: sh.h, rx: sh.rx ?? 6 }, parent);
    return el("polygon", { ...a, points: sh.points }, parent);
  }

  /* ---------- presence (server-synced) ----------
     The server's "players" message is the truth. Our own moves are applied
     locally right away so clicks feel instant, then sent to the server. */
  let net = null;
  const presence = {
    players: {},
    subs: [],
    set(list) {
      this.players = {};
      list.forEach((p) => (this.players[p.id] = p));
      this.emit();
    },
    // pos: where in a scene with positions (the seed farms); left out = unchanged.
    move(id, sceneId, spot, send = true, pos) {
      Object.assign(this.players[id], { scene: sceneId, spot }, pos !== undefined ? { pos } : {});
      this.emit();
      if (id === ME && send) net.send({ t: "move", scene: sceneId, spot });
    },
    // Only players who are connected right now show up in scenes.
    // pos (optional): only those at that position of the scene.
    at(sceneId, spot, pos) {
      return this.all().filter((p) => p.online && p.scene === sceneId && (spot == null || p.spot === spot) && (pos == null || p.pos === pos));
    },
    all() { return Object.values(this.players); },
    onChange(f) { this.subs.push(f); },
    emit() { this.subs.forEach((f) => f()); },
  };

  /* ---------- scene rendering ---------- */
  // currentPos: where in the current scene we are, for a scene with positions (the seed
  // farms; see the world file header), else null. Changes with the view, like current.
  let current = null, currentPos = null, hotRoot = null, leaveRoot = null, presRoot = null, birdRoot = null;
  // Animated layers of the current scene ({ a: anim, node }), so remote dots can move in step.
  let layerAnims = [];
  // Give node the anim, in step with a layer that has the same one (the spyglass sway):
  // copy that layer's place in its animation, since the dots are redrawn far more often.
  function animInStep(node, a) {
    applyAnim(node, a);
    const L = layerAnims.find((x) => x.a.type === a.type && x.a.dur === a.dur);
    const from = L?.node.getAnimations?.()[0], to = node.getAnimations?.()[0];
    if (from && to) to.currentTime = from.currentTime;
  }
  // A step link from where we are ({ step: "aheadLeft" } -> position id), or undefined.
  const stepTo = (dir) => scene(current)?.positions?.[currentPos]?.links?.[dir];
  // Others are only "here" on our own position, in a scene with positions.
  const posHere = () => (scene(current)?.positions ? currentPos : null);
  const isExit = (h) => !!(h.action?.goto || h.action?.step);
  let tipOwner = null, lastPointer = "mouse";

  function renderScene() {
    const s = scene(current);
    HolliaRounds.update(shared); // the fight log under scenes with rounds (rounds.js)
    svg.innerHTML = "";
    el("title", {}, svg).textContent = s.name;
    const layerRoot = el("g", {}, svg);
    // Layers with `chance: true` show only when this visit's roll hit, `chance: false` only when it missed.
    layerAnims = [];
    (s.layers || []).filter((L) => L.chance == null || L.chance === chanceHit()).forEach((L) => {
      const node = fragment(L.svg, layerRoot);
      applyAnim(node, L.anim);
      if (L.anim) layerAnims.push({ a: L.anim, node });
    });
    birdRoot = el("g", { class: "birds", "pointer-events": "none" }, svg); // above the scenery, below hotspots
    // Things fading out (a-emerge art whose flag went away) get their own layer under the
    // hotspots, so redraws of the hotspots (any flag or shared change) don't cut the fade short.
    leaveRoot = el("g", {}, svg);
    hotRoot = el("g", {}, svg);
    drawHotspots();
    presRoot = el("g", { class: "presence" }, svg);
    // SVG <animate> timing (begin="2s", play-once) counts from when the page
    // loaded, not from when this scene was drawn: start the clock over.
    try { svg.setCurrentTime(0); } catch {}
    $("sceneName").textContent = s.name;
    renderPresence();
    renderDesignPanel();
  }

  /* ---------- chance (scene.chance in the world) ----------
     The server rolls when you arrive and says { t: "chance", scene, hit, say? }.
     It arrives just after the scene is drawn, so the scene is drawn again. */
  let chance = null;
  const chanceHit = () => !!(chance && chance.scene === current && chance.hit);
  function onChance(m) {
    chance = m;
    setTimeout(() => {
      if (current !== m.scene) return;
      renderScene();
      if (m.say) narrate(m.say);
      if (m.hit) playSound(scene(current).chance?.sound); // e.g. the sea creature: success
    }, 200);
  }

  /* ---------- birds (scene.birds: [top, bottom] of its sky; meta.birds: { art, every }) ----------
     Now and then a pack of 1-3 small birds crosses the sky: random size (how far off), speed,
     height and direction, a loose straggling line with a little rise and dip. Just for show:
     each page on its own (players don't see the same birds), never clickable. Not while the
     page is paused or hidden. */
  let birdTimer = null;
  const rand = (a, b) => a + Math.random() * (b - a);
  function scheduleBirds(first = false) {
    clearTimeout(birdTimer);
    const [lo, hi] = CFG?.meta?.birds?.every || [20, 60];
    birdTimer = setTimeout(() => { flyBirds(); scheduleBirds(); }, (first ? rand(lo / 3, lo) : rand(lo, hi)) * 1000);
  }
  function flyBirds() {
    const band = scene(current)?.birds, art = CFG?.meta?.birds?.art;
    if (!band || !art || !birdRoot || document.hidden || document.body.classList.contains("paused")) return;
    const [VW] = CFG.meta.viewBox || [680, 400];
    const n = 1 + Math.floor(Math.random() * 3);
    const near = rand(0.6, 1.5); // bigger = closer: bigger and faster
    const dir = Math.random() < 0.5 ? 1 : -1;
    const y0 = rand(band[0], band[1]), climb = rand(-30, 30);
    const dur = (16 - near * 5) * 1000 * rand(0.85, 1.15);
    const xA = dir > 0 ? -30 : VW + 30, xB = dir > 0 ? VW + 30 : -30;
    for (let i = 0; i < n; i++) {
      const s = near * rand(0.8, 1.2);
      const dy = i ? (i % 2 ? -1 : 1) * rand(6, 14) * near : 0;
      const g = el("g", {}, birdRoot);
      // Mirrored when flying left; each bird flaps out of step with the others.
      const inner = el("g", { transform: `scale(${dir * s} ${s})` }, g);
      fragment(art.replace(/<animate /g, `<animate begin="-${rand(0, 1).toFixed(2)}s" `), inner);
      const at = (t) => ({ transform: `translate(${xA + (xB - xA) * t}px, ${y0 + dy + climb * t + Math.sin(t * Math.PI * 3 + i) * 4}px)` });
      g.animate([0, 0.25, 0.5, 0.75, 1].map(at), { duration: dur, delay: i * rand(250, 700), fill: "both" }).onfinish = () => g.remove();
    }
  }

  /* ---------- character scale ----------
     A hotspot's `scale` (world file) grows/shrinks its art and click area
     around its feet: the bottom-center of its shape, or `scaleAnchor: [x, y]`.
     Design mode (?design in the URL) adds local sliders that override it. */
  const DESIGN = new URLSearchParams(location.search).has("design");
  const designKey = (h) => `hollia.scale.${current}.${h.id}`;
  function designScale(h) {
    if (!DESIGN) return null;
    try { const v = localStorage.getItem(designKey(h)); return v == null ? null : +v; } catch { return null; }
  }
  const effScale = (h) => designScale(h) ?? h.scale ?? 1;
  function scaleAnchor(h) {
    if (h.scaleAnchor) return { x: h.scaleAnchor[0], y: h.scaleAnchor[1] };
    const sh = h.shape;
    if (sh.type === "rect") return { x: sh.x + sh.w / 2, y: sh.y + sh.h };
    if (sh.type === "circle") return { x: sh.x, y: sh.y + sh.r };
    if (sh.type === "ellipse") return { x: sh.x, y: sh.y + sh.ry };
    const p = sh.points.trim().split(/[\s,]+/).map(Number);
    return { x: center(sh).x, y: Math.max(...p.filter((_, i) => i % 2)) };
  }
  function applyScale(h, g) {
    const s = effScale(h);
    if (s === 1) return g.removeAttribute("transform");
    const a = scaleAnchor(h);
    g.setAttribute("transform", `translate(${a.x} ${a.y}) scale(${s}) translate(${-a.x} ${-a.y})`);
  }
  let hotEls = {};

  function renderDesignPanel() {
    const box = $("design");
    if (!DESIGN) return;
    box.hidden = false;
    box.innerHTML = "";
    const npcs = (scene(current).hotspots || []).filter((h) => h.art && !h.action?.goto);
    const head = document.createElement("h2");
    head.textContent = "Design: character sizes";
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "Only you see these sliders. Copy the sizes into the world file (scale: …) when you like them.";
    box.append(head, note);
    if (!npcs.length) { note.textContent = "No characters in this scene."; return; }
    npcs.forEach((h) => {
      const row = document.createElement("label");
      row.className = "row";
      const name = document.createElement("span"); name.textContent = h.label || h.id;
      const range = document.createElement("input");
      Object.assign(range, { type: "range", min: 0.3, max: 2.5, step: 0.05, value: effScale(h) });
      const out = document.createElement("output"); out.textContent = effScale(h).toFixed(2);
      const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "Reset";
      const set = (v) => {
        try { v == null ? localStorage.removeItem(designKey(h)) : localStorage.setItem(designKey(h), v); } catch {}
        range.value = effScale(h);
        out.textContent = effScale(h).toFixed(2);
        applyScale(h, hotEls[h.id]);
      };
      range.oninput = () => set(range.value);
      reset.onclick = (e) => { e.preventDefault(); set(null); };
      row.append(name, range, out, reset);
      box.append(row);
    });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy sizes";
    const result = document.createElement("pre");
    result.hidden = true;
    copy.onclick = async () => {
      const text = `Scene "${current}":\n` + npcs.map((h) => `  ${h.id}: scale ${effScale(h).toFixed(2)}`).join("\n");
      result.textContent = text;
      result.hidden = false;
      try { await navigator.clipboard.writeText(text); copy.textContent = "Copied!"; } catch { copy.textContent = "Copy from below"; }
      setTimeout(() => (copy.textContent = "Copy sizes"), 2000);
    };
    box.append(copy, result);
  }

  // Hotspots with `if` only show while their flags hold (e.g. gone once picked up).
  // redraw: a flag changed in this scene. One-shot animations (a-settle, a-rock) only play
  // on hotspots that just appeared; ones already showing keep still (clicking the lantern
  // mustn't rock the shovel again).
  // Art with a-emerge (rises in when it appears) also fades back down when its flag goes
  // away (the cave's rock golem): the old copy stays a moment, unclickable, fading out.
  function drawHotspots(redraw) {
    if (!hotRoot) return;
    const prev = redraw ? { ...hotEls } : {};
    hotRoot.innerHTML = "";
    hotEls = {};
    // A step exit only shows where this position has that link.
    const shown = (scene(current).hotspots || []).filter((h) => test(h.if) && (!h.action?.step || stepTo(h.action.step)));
    shown.forEach(drawHotspot);
    // appearSound: played when a flag brings it in while you're here (once, however many at once).
    if (redraw) { playSound(shown.find((h) => h.appearSound && !prev[h.id])?.appearSound); updateFight(); }
    for (const [id, g] of Object.entries(prev)) {
      if (hotEls[id]) hotEls[id].querySelectorAll(".a-settle, .a-rock, .a-emerge").forEach((e) => (e.style.animation = "none"));
      else if (g.querySelector(".a-emerge")) {
        g.querySelectorAll(".a-emerge").forEach((e) => (e.style.animation = "none"));
        g.removeAttribute("tabindex");
        g.classList.add("leaving");
        leaveRoot.append(g);
        setTimeout(() => g.remove(), 2000); // after the .leaving fade (1.8s, index.html)
      }
    }
  }
  // A scene's fightAmbient plays instead of its ambient while any `enemy: true` hotspot shows
  // (the cave). Enemy in: it comes in just after their appearSound; last one gone: slow fade back.
  const fighting = (s) => !!s?.fightAmbient && (s.hotspots || []).some((h) => h.enemy && test(h.if));
  const ambientOf = (s) => (fighting(s) ? s.fightAmbient : s.ambient);
  let fightTimer = null;
  function updateFight() {
    const s = scene(current);
    clearTimeout(fightTimer);
    if (!s?.fightAmbient) return;
    if (fighting(s)) fightTimer = setTimeout(() => { if (scene(current) === s && fighting(s)) HolliaAmbient.set(s.fightAmbient, 2000); }, 1200);
    else HolliaAmbient.set(s.ambient, 4000);
  }
  // One-off clip over the ambience: "sounds/x.ogg" or { src, volume }.
  function playSound(s) {
    if (s) typeof s === "string" ? HolliaAmbient.play(s) : HolliaAmbient.play(s.src, s.volume ?? 1);
  }
  function flagsChanged() {
    if ((scene(current)?.hotspots || []).some((h) => h.if != null)) { hideTip(); drawHotspots(true); }
  }

  function drawHotspot(h) {
    const g = el("g", { class: "hot" + (isExit(h) ? " exit" : ""), tabindex: 0, role: "button", "aria-label": h.label || h.id }, hotRoot);
    hotEls[h.id] = g;
    // anim: in step with a layer that has the same one (something inside the spyglass lens).
    if (h.art) { const node = fragment(h.art, g); if (h.anim) animInStep(node, h.anim); }
    shapeEl(h.shape, g, "hit ind-" + (h.indicator || "outline"));
    applyScale(h, g);

    g.addEventListener("pointerdown", (e) => (lastPointer = e.pointerType));
    g.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") showHover(h, g); });
    g.addEventListener("pointerleave", () => { if (tipOwner === h.id) hideTip(); });
    g.addEventListener("click", () => {
      if (locked()) return;
      // Touch has no hover: first tap shows the hover line, second tap acts.
      if (lastPointer === "touch" && h.hover && tipOwner !== h.id) { showHover(h, g); return; }
      hideTip();
      if (!isExit(h)) net.send({ t: "did", kind: "click", hotspot: h.id, label: h.label });
      run(h.action, h);
    });
    g.addEventListener("focus", () => showHover(h, g));
    g.addEventListener("blur", hideTip);
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); hideTip();
        if (locked()) return;
        if (!isExit(h)) net.send({ t: "did", kind: "click", hotspot: h.id, label: h.label });
        run(h.action, h);
      }
    });
  }

  // A player's colored circle with their initial in it.
  function letterDot(p, x, y, r, cls, parent = presRoot) {
    const g = el("g", { class: cls }, parent);
    el("circle", { cx: x, cy: y, r, fill: p.color }, g);
    el("text", { x, y: y + r * 0.44, "text-anchor": "middle", "font-size": r * 1.25 }, g).textContent =
      p.name[0].toUpperCase();
  }

  function renderPresence() {
    if (!presRoot) return;
    presRoot.innerHTML = "";
    const s = scene(current);

    // Other players standing at spots in this view. You see through your own
    // eyes, so your dot is never drawn; spots only say where OTHERS see you.
    for (const [spid, sp] of Object.entries(s.spots || {})) {
      const ps = presence.at(current, spid, posHere()).filter((p) => p.id !== ME);
      ps.forEach((p, i) => letterDot(p, sp.x + (i - (ps.length - 1) / 2) * 19, sp.y, 8, "pdot"));
    }

    // Players at other locations visible from here: smaller lettered dots, no
    // tooltip (an exit's hover already says who's there). rv.pos: one position of that scene.
    // rv.anim: the dots move with the view (the spyglass sway), in step with its layer.
    (s.remote || []).forEach((rv) => {
      const ps = presence.at(rv.scene, rv.spot, rv.pos);
      if (!ps.length) return;
      const g = rv.anim ? el("g", {}, presRoot) : presRoot;
      ps.forEach((p, i) => letterDot(p, rv.at[0] + (i - (ps.length - 1) / 2) * 13, rv.at[1], 6, "pdot remote", g));
      if (rv.anim) animInStep(g, rv.anim);
    });

    // Count of players already at each exit's destination
    (s.hotspots || []).forEach((h) => {
      if (!isExit(h) || h.badge === false) return;
      if (h.action.step && !stepTo(h.action.step)) return;
      const n = exitOthers(h).length;
      if (!n) return;
      const c = h.badgeAt ? { x: h.badgeAt[0], y: h.badgeAt[1] } : corner(h.shape);
      const g = el("g", { class: "badge" }, presRoot);
      el("circle", { cx: c.x, cy: c.y, r: 9 }, g);
      el("text", { x: c.x, y: c.y + 4, "text-anchor": "middle" }, g).textContent = n;
    });

    updateHud();
  }

  /* ---------- hover tooltips ---------- */
  // Hover says what the thing is, plainly and always the same: its hover text
  // if it has one (exits: "Down to the docks"), otherwise its label. Flavor
  // belongs in what clicking it says.
  // Other players at an exit's destination. A scene in an exclusive group (e.g. the
  // spyglass views) counts everyone in any scene of that group, since the exit can
  // drop you into whichever one was left in use.
  function othersAt(sceneId) {
    const g = scene(sceneId)?.exclusive?.group;
    const ids = g ? Object.keys(CFG.scenes).filter((id) => CFG.scenes[id].exclusive?.group === g) : [sceneId];
    return ids.flatMap((id) => presence.at(id)).filter((p) => p.id !== ME);
  }
  // Others where an exit leads: a scene (goto), or the position a step leads to.
  function exitOthers(h) {
    if (h.action?.step) return presence.at(current, null, stepTo(h.action.step)).filter((p) => p.id !== ME);
    return othersAt(h.action.goto);
  }
  function hoverText(h) {
    const speaker = null;
    const line = typeof h.hover === "string" ? h.hover : h.label || null;
    let extra = "";
    if (isExit(h)) {
      const others = exitOthers(h).map((p) => p.name);
      if (others.length) extra = "There now: " + others.join(", ");
    }
    return { speaker, line, extra };
  }
  function showHover(h, g) {
    const t = hoverText(h);
    if (!t.line && !t.extra) return;
    tip.innerHTML = "";
    if (t.speaker) { const b = document.createElement("b"); b.textContent = t.speaker; tip.append(b); }
    if (t.line) { const d = document.createElement("div"); d.textContent = t.line; tip.append(d); }
    if (t.extra) { const d = document.createElement("div"); d.className = "extra"; d.textContent = t.extra; tip.append(d); }
    placeTip(g);
    tipOwner = h.id;
  }
  function placeTip(anchor) {
    tip.hidden = false;
    const r = anchor.getBoundingClientRect(), c = stage.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left - c.left + r.width / 2;
    let y = r.top - c.top - 10;
    x = Math.max(tw / 2 + 6, Math.min(c.width - tw / 2 - 6, x));
    const below = y - th < 4;
    if (below) y = r.bottom - c.top + 10;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
    tip.style.transform = below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
  }
  function hideTip() { tip.hidden = true; tipOwner = null; }

  /* ---------- memory (flags) ----------
     Facts the server remembers about this player, e.g. "dockhand.annoyed".
     World files use them as:  set / unset  (string or list)  and
     if: "flag" | "!flag" | [all, of, these].
     "has:<item>" (or "!has:<item>") checks this player's hands and pack instead.
     "here.<x>" flags are client-only: never sent to the server, not on the DM page or
     in the log, and forgotten when you change scene (e.g. straightening the mirror). */
  let flags = new Set();
  let here = new Set();
  const isHere = (f) => f.startsWith("here.");
  /* ---------- roamers (world.roamers: the seed farms' winged creature) ----------
     Where each is comes from the activity's shared state: shared.roam[id] = { stage, until }
     (until: server clock). Past until it's home (route[0]); while its `gone` flag holds,
     nowhere. A timer redraws the scene when it flies home. */
  let shared = {}, clockSkew = 0, roamTimer = null;
  const serverNow = () => Date.now() + clockSkew;
  function onShared(sh, now) {
    shared = sh || {};
    if (now) clockSkew = now - Date.now();
    clearTimeout(roamTimer);
    const next = Object.values(shared.roam || {}).map((s) => s.until).filter((u) => u > serverNow());
    if (next.length) roamTimer = setTimeout(() => onShared(shared), Math.min(...next) - serverNow() + 50);
    flagsChanged();
    HolliaRounds.update(shared);
  }
  // heldBy: someone is talking to it at its last stop: it waits there, no countdown.
  function roamStage(id) {
    const s = shared.roam?.[id];
    return s && s.stage > 0 && (s.heldBy || s.until > serverNow()) ? s.stage : 0;
  }
  // Which position the roamer is at right now, or null.
  function roamAt(id) {
    const R = CFG?.roamers?.[id];
    if (!R?.route?.length || (R.gone && flags.has(R.gone))) return null;
    return R.route[roamStage(id)];
  }
  // "roam:<id>" here (my position), "roam:<id>:last" here at its last stop, "roam:<id>@<pos>" at pos.
  function holdsRoam(x) {
    const [, id, pos] = x.match(/^([^@:]+)(?:@(.+))?/) || [];
    const at = roamAt(id), R = CFG?.roamers?.[id];
    if (at == null) return false;
    if (pos != null) return at === pos;
    const hereNow = R.scene === current && at === currentPos;
    return x.endsWith(":last") ? hereNow && roamStage(id) === R.route.length - 1 : hereNow;
  }
  /* roam(id, act, dialogue): ask the server (act: poke when left out, talk, feed, release).
     talk: at its last stop it waits for us; once the server agrees, the conversation opens
     (roamTalk = id). Closing that conversation any way but a roam choice (Leave, a move, a
     freeze) sends release: it flies home. */
  let roamReq = 0, roamTalk = null;
  const roamWaiting = {};
  function roam(id, act, dialogue) {
    const req = ++roamReq;
    roamWaiting[req] = (r) => {
      if (act === "talk" && r.ok) { roamTalk = id; return openDialogue(dialogue); }
      if (!r.error) playSound(CFG.roamers?.[id]?.[act]?.sound); // e.g. feed.sound
      narrate(r.error || r.say);
    };
    if (act !== "release") narrate("…");
    net.send({ t: "roam", roamer: id, act, req });
  }

  /* trade(id): hand an item to an NPC (world.trades, a dialogue choice's { trade: id }). The
     server checks and swaps the items; we just say what happened (and play trade.sound). */
  let tradeReq = 0;
  const tradeWaiting = {};
  function trade(id) {
    const req = ++tradeReq;
    tradeWaiting[req] = (r) => {
      if (!r.error) playSound(CFG.trades?.[id]?.sound);
      narrate(r.error || r.say);
    };
    narrate("…");
    net.send({ t: "trade", id, req });
  }

  /* heal(id, limb): ask an NPC to give back one lost limb (world.heals, a dialogue choice's
     { heal: id, limb }). The server does it (once per player); we say what happened (and play
     heal.sound). */
  let healReq = 0;
  const healWaiting = {};
  function heal(id, limb) {
    const req = ++healReq;
    healWaiting[req] = (r) => {
      if (!r.error) playSound(CFG.heals?.[id]?.sound);
      narrate(r.error || r.say);
    };
    narrate("…");
    net.send({ t: "heal", id, limb, req });
  }

  // "pos:<id or tag>": we're at that position of this scene (or one with that tag).
  function holdsPos(x) {
    if (currentPos == null) return false;
    return currentPos === x || !!scene(current)?.positions?.[currentPos]?.tags?.includes(x);
  }
  // "lost:<limb>": I've lost that limb (left | right hands: the inventory; leftFoot | rightFoot: flags).
  function holdsLost(x) {
    if (x === "left" || x === "right") return HolliaPack.lost(x);
    return x === "leftFoot" ? flags.has("limb.lostLeftFoot") : x === "rightFoot" ? flags.has("limb.lostRightFoot") : false;
  }
  function holds(c) {
    return c.startsWith("has:") ? HolliaPack.has(c.slice(4)) : c.startsWith("lost:") ? holdsLost(c.slice(5))
      : c.startsWith("pos:") ? holdsPos(c.slice(4))
      : c.startsWith("roam:") ? holdsRoam(c.slice(5)) : isHere(c) ? here.has(c) : flags.has(c);
  }
  function test(cond) {
    if (cond == null) return true;
    return [].concat(cond).every((c) => (c.startsWith("!") ? !holds(c.slice(1)) : holds(c)));
  }
  function applyFlags(o) {
    const set = [].concat(o?.set || []), unset = [].concat(o?.unset || []);
    if (!set.length && !unset.length) return;
    set.forEach((f) => (isHere(f) ? here : flags).add(f));
    unset.forEach((f) => (isHere(f) ? here : flags).delete(f));
    const sset = set.filter((f) => !isHere(f)), sunset = unset.filter((f) => !isHere(f));
    if (sset.length || sunset.length) net.send({ t: "flag", set: sset, unset: sunset });
    flagsChanged();
  }

  /* ---------- actions, narration, dialogue (private to each player) ---------- */
  // h: the hotspot that was clicked (find needs it; dialogue choices have none).
  function run(a, h, claimed) {
    if (!a) return;
    // DM freezes. The server also refuses frozen moves; interactions are local,
    // so the client is what stops them.
    const moving = a.goto || a.step;
    if (moving && controls.move) return narrate("You can't go anywhere right now.");
    if (!moving && controls.interact) return narrate("Hold that thought. The DM has paused the action.");
    playSound(a.sound);
    if (a.find && h) {
      // Every find is look-first: say/set happen on the click, and a button under the line
      // picks it up (find.ask = its text). Flags for "taken" go in find.set (server, on success).
      applyFlags(a);
      const said = Array.isArray(a.say) ? pick(a.say) : a.say;
      narrate(said || "");
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "narr-act"; btn.textContent = a.find.ask || "Pick it up";
      btn.onclick = () => {
        if (locked()) return;
        if (controls.interact) return narrate("Hold that thought. The DM has paused the action.");
        narrate("…");
        HolliaPack.find(h.id, (r) => (r.error || playSound(a.find.takeSound), narrate(r.error || [a.find.takeSay && (Array.isArray(a.find.takeSay) ? pick(a.find.takeSay) : a.find.takeSay), r.say].filter(Boolean).join(" "))));
      };
      $("narr").append(" ", btn);
      return;
    }
    // One player at a time (hotspot exclusive: true, e.g. Old Fen): ask the server first.
    if (h?.exclusive && !claimed) return hold(h, () => run(a, h, true));
    if (a.roam) return roam(a.roam, a.act, a.dialogue);
    if (a.trade) return trade(a.trade);
    if (a.heal) return heal(a.heal, a.limb);
    // A minigame (world.games, game.js): the server takes the cost and rolls the try.
    if (a.game) return HolliaGame.start(a.game);
    if (a.offer) {
      // Tossing a coin in: the server takes it, counts, and sets any flags itself.
      narrate("…");
      return HolliaPack.offer(a.offer, (r) => narrate(r.error || r.say));
    }
    applyFlags(a);
    const said = a.say && (Array.isArray(a.say) ? pick(a.say) : a.say);
    // Opening a shop: its line shows in the shop (narration is hidden while trading).
    if (said && !a.shop) narrate(said);
    if (a.moveTo) presence.move(ME, current, a.moveTo);
    if (a.dialogue) openDialogue(a.dialogue);
    // Inventory hidden by the DM: shops and stashes stay shut (their panel is the pack's).
    if ((a.shop || a.stash) && controls.pack) narrate("Your things are put away for now.");
    else {
      if (a.shop) HolliaPack.openShop(a.shop, said);
      if (a.stash) HolliaPack.openStash(a.stash);
    }
    if (a.goto) go(a.goto, a.spot);
    // Along a link of where we are in this scene (the seed farms).
    if (a.step && stepTo(a.step)) go(current, null, false, null, stepTo(a.step));
  }
  function narrate(text) { $("narr").textContent = text || ""; }

  /* ---------- one player at a time (hotspots with exclusive: true; server handleHold) ----------
     A click claims the hotspot; the server says no (busySay) if someone else has it. Held while
     we're talking, trading or in a minigame; once none of those (body classes) is on, we let go.
     Leaving the scene or going offline lets go on the server's side. */
  let holdReq = 0, holding = null; // the hotspot id we hold
  const holdWaiting = {};
  // (A minigame being asked for counts: "Play the game" closes the talk before the game opens.)
  const engaged = () => HolliaGame.busy() || ["talking", "trading", "gaming"].some((c) => document.body.classList.contains(c));
  function hold(h, then) {
    const req = ++holdReq;
    holdWaiting[req] = (r) => {
      if (!r.ok) return narrate(r.error || "");
      holding = h.id;
      then();
      letGoIfIdle();
    };
    narrate("…");
    net.send({ t: "hold", spot: h.id, req });
  }
  function letGoIfIdle() {
    if (!holding || engaged()) return;
    holding = null;
    net.send({ t: "hold", release: true });
  }
  // Class changes can come in pairs (dialogue closes, then the shop opens): check after both.
  new MutationObserver(() => setTimeout(letGoIfIdle, 0)).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  /* ---------- moving ----------
     go() asks the server first and the view only changes once it says yes, to
     wherever it says (e.g. the spyglass's remembered view). A refusal ("someone
     is already at the spyglass") just shows the reason; nothing moves.
     fromServer: the DM moved us (or we reconnected somewhere): no asking.
     note: say this instead of the scene's narration.
     pos: a position in a scene with positions (a step inside it, or where the server put us). */
  let asking = null, moveReq = 0;
  function go(sceneId, spotId, fromServer = false, note = null, pos = null) {
    if (fromServer) return transition(sceneId, spotId, note, pos);
    if (!scene(sceneId)) return console.warn("Unknown scene:", sceneId);
    if (asking) return; // still waiting to hear about the last click
    const req = ++moveReq;
    asking = { req, timer: setTimeout(() => finishAsking({ req, error: "No answer from the server. Try again." }), 6000) };
    stage.classList.add("asking");
    net.send({ t: "move", scene: sceneId, spot: spotId || undefined, pos: pos ?? undefined, req });
  }
  function finishAsking(m) {
    if (!asking || m.req !== asking.req) return;
    clearTimeout(asking.timer);
    asking = null;
    stage.classList.remove("asking");
    if (m.error) return narrate(m.error);
    // A step to another position redraws the scene too (walking to the next farm).
    if (m.scene !== current || (m.pos ?? null) !== currentPos) transition(m.scene, m.spot, null, m.pos, true);
    else presence.move(ME, m.scene, m.spot, false);
  }

  // Change the view (the server already agreed, or told us to): fade out, swap, fade in.
  // FADE_MS is each half; it also drives the CSS fade (--fade on #stage).
  // body.fading: nothing works (locked(), CSS) from the start of the fade out until the new
  // scene has fully faded in. fadeSeq: a newer transition (e.g. DM move mid-fade) keeps it on.
  // Lost a foot (flags limb.lostLeftFoot / limb.lostRightFoot, the DM's call): your own moves take
  // longer, LIMP_MS each half with one gone, LIMP2_MS with both (a DM move doesn't). Just this
  // page; no server rule.
  const FADE = 1000, LIMP_MS = 2500, LIMP2_MS = 4000;
  let fadeSeq = 0;
  function transition(sceneId, spotId, note = null, pos = null, own = false) {
    const s = scene(sceneId);
    if (!s) return console.warn("Unknown scene:", sceneId);
    const feet = own ? ["limb.lostLeftFoot", "limb.lostRightFoot"].filter((f) => flags.has(f)).length : 0;
    const limp = feet > 0;
    const FADE_MS = feet === 2 ? LIMP2_MS : limp ? LIMP_MS : FADE;
    if (limp) narrate(feet === 2 ? "You drag yourself along…" : "You limp along…");
    if (own) playSound(CFG.meta.moveSound); // your own moves only: not the DM's (slides, moving people)
    chance = null;
    closeDialogue();
    hideTip();
    const seq = ++fadeSeq;
    document.body.classList.add("fading");
    setTimeout(() => { if (seq === fadeSeq) document.body.classList.remove("fading"); }, FADE_MS * 2);
    stage.style.setProperty("--fade", FADE_MS + "ms");
    stage.classList.add("fade");
    HolliaAmbient.set(ambientOf(s), FADE_MS * 2); // crossfade over the whole fade out + in
    setTimeout(() => {
      current = sceneId;
      currentPos = s.positions ? pos ?? s.startPos ?? null : null;
      here = new Set(); // "here.*" flags only last while you stay in a scene
      presence.move(ME, sceneId, spotId || firstSpot(s), false, currentPos);
      renderScene();
      HolliaPack.onScene(sceneId);
      narrate(note || s.narration);
      stage.classList.remove("fade");
    }, FADE_MS);
  }

  // start: "nodeId", or a list tried in order: [{ if: "x", node: "a" }, ..., "fallback"]
  function pickStart(d) {
    if (!Array.isArray(d.start)) return d.start;
    for (const s of d.start) {
      if (typeof s === "string") return s;
      if (test(s.if)) return s.node;
    }
    return Object.keys(d.nodes)[0];
  }

  function openDialogue(id, nodeId) {
    const d = CFG.dialogues?.[id];
    if (!d) return console.warn("Unknown dialogue:", id);
    const nid = nodeId || pickStart(d);
    const n = d.nodes[nid];
    if (!n) return console.warn("Unknown dialogue node:", id, nodeId);
    applyFlags(n); // reaching a line can set flags (e.g. the NPC storms off)
    const box = $("dlg");
    box.hidden = false;
    // While talking, the conversation is all you can do: the scene, inventory
    // and narration are locked/hidden (CSS on body.talking) until it ends.
    document.body.classList.add("talking");
    hideTip();
    box.innerHTML = "";
    const who = document.createElement("div"); who.className = "who"; who.textContent = n.speaker || d.speaker;
    const txt = document.createElement("p"); txt.textContent = n.text;
    const ch = document.createElement("div"); ch.className = "choices";
    // Choices whose `if` fails are hidden. No choices left = conversation over.
    const choices = (n.choices || []).filter((c) => test(c.if));
    (choices.length ? choices : [{ text: "Leave", end: true }]).forEach((c) => {
      const b = document.createElement("button");
      b.textContent = c.text;
      b.onclick = () => {
        net.send({ t: "did", kind: "choice", dialogue: id, node: nid, text: c.text });
        applyFlags(c);
        // A roam choice (throw the seed) settles a roamer conversation itself: no release.
        if (c.action?.roam) roamTalk = null;
        if (c.end || !c.next) closeDialogue(); else openDialogue(id, c.next);
        if (c.action) run(c.action);
      };
      ch.append(b);
    });
    box.append(who, txt, ch);
  }
  function closeDialogue() {
    const b = $("dlg"); b.hidden = true; b.innerHTML = "";
    document.body.classList.remove("talking");
    // Ended a roamer conversation without settling it: it flies home.
    if (roamTalk) { const id = roamTalk; roamTalk = null; roam(id, "release"); }
  }
  // In a conversation, the inventory is open ("packing"), or a shop/stash is open
  // ("trading", both set by pack.js), or a minigame ("gaming", game.js): only that.
  // Also mid scene change ("fading").
  const locked = () => ["talking", "trading", "packing", "fading", "gaming"].some((c) => document.body.classList.contains(c));
  // "Done" in a shop: back into a farewell line if the shop names one.
  function tradeDone(was) {
    const d = was.shop && CFG.shops?.[was.shop]?.done;
    if (d) openDialogue(d.dialogue, d.node);
  }

  /* ---------- DM announcements ----------
     { t: "announce", text } goes to everyone in the activity (a lost limb, an affliction, any line
     the DM sends): a gold banner over the scene for ANNOUNCE_MS, one after another if several come
     in. meta.announceSound (optional) plays with it. Players who aren't connected miss it. */
  const ANNOUNCE_MS = 8000;
  const announceQueue = [];
  let announcing = false;
  function announce(text) {
    announceQueue.push(text);
    if (!announcing) nextAnnounce();
  }
  function nextAnnounce() {
    const box = $("announce"), text = announceQueue.shift();
    if (text == null) { announcing = false; return; }
    announcing = true;
    box.textContent = text;
    box.hidden = false;
    box.classList.remove("out");
    if (CFG?.meta?.announceSound) HolliaAmbient.play(CFG.meta.announceSound);
    setTimeout(() => box.classList.add("out"), ANNOUNCE_MS - 600);
    setTimeout(() => { box.hidden = true; nextAnnounce(); }, ANNOUNCE_MS);
  }

  /* ---------- HUD: who's here, party roster ---------- */
  function updateHud() {
    const me = presence.players[ME];
    if (me?.scene) {
      const here = presence.at(current, null, posHere()).filter((p) => p.id !== ME).map((p) => p.name);
      $("here").textContent = here.length ? `Here with you: ${here.join(", ")}.` : "No one else is here.";
    }
    const ul = $("rosterList");
    ul.innerHTML = "";
    // You first, then online players, then those who stepped away.
    const order = (p) => (p.id === ME ? 0 : p.online ? 1 : 2);
    presence.all().sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).forEach((p) => {
      const li = document.createElement("li");
      if (!p.online) li.className = "away";
      const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = p.color;
      const nm = document.createElement("span"); nm.textContent = p.name + (p.id === ME ? " (you)" : "");
      li.append(dot, nm);
      if (p.bot) { const t = document.createElement("span"); t.className = "tag"; t.textContent = "bot"; li.append(t); }
      const where = document.createElement("span"); where.className = "where";
      // No locations here: the server only tells us where people are when our
      // character could see them (the scene dots and exit counts show that).
      where.textContent = !p.online ? "away" : p.id !== ME && p.scene === current && (posHere() == null || p.pos === posHere()) ? "here" : "";
      li.append(where);
      ul.append(li);
    });
  }

  /* ---------- DM controls ---------- */
  let controls = { move: false, interact: false, pack: false };
  function applyControls(c) {
    controls = { move: !!c?.move, interact: !!c?.interact, pack: !!c?.pack };
    // Inventory hidden by the DM: no pack button, and an open pack/shop/stash closes.
    document.body.classList.toggle("no-pack", controls.pack);
    if (controls.pack) HolliaPack.hide();
    stage.classList.toggle("no-move", controls.move);
    stage.classList.toggle("no-interact", controls.interact);
    if (controls.interact) closeDialogue();
    const f = [controls.move && "movement", controls.interact && "interaction"].filter(Boolean);
    $("frozen").hidden = !f.length;
    $("frozen").textContent = f.length ? `The DM has paused ${f.join(" and ")}.` : "";
  }

  /* ---------- boot ---------- */
  function start(w) {
    CFG = w.world;
    ME = w.you.id;
    const [VW, VH] = CFG.meta.viewBox || [680, 400];
    svg.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
    document.title = `${w.activity.name} · Hollia`;
    presence.players = {};
    w.players.forEach((p) => (presence.players[p.id] = p));
    // The server remembers where you were, so a refresh or reconnect puts you back.
    current = presence.players[ME].scene;
    currentPos = scene(current)?.positions ? presence.players[ME].pos ?? null : null;
    renderScene();
    narrate(scene(current).narration);
    // Fresh page: a scene with no ambient of its own has nothing to keep, so use the world's default.
    const s = scene(current);
    HolliaAmbient.set("ambient" in s ? ambientOf(s) : CFG.meta.ambient, 1500);
    scheduleBirds(true);
    preloadSounds();
  }

  // Every sound the world names (any "sounds/..." string: ambient, clips, voice lines), fetched
  // behind "Click to begin" with a 0-100 count. Clicking early is fine: the rest keep loading.
  function preloadSounds() {
    const found = [];
    (function walk(v) {
      if (typeof v === "string") { if (/^sounds\/[^"'<>\s]+\.(ogg|mp3)$/i.test(v)) found.push(v); }
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    })(CFG);
    const note = $("pauseNote");
    note.textContent = "Loading sounds… 0%";
    HolliaAmbient.preload(found, (pct) => {
      note.textContent = pct < 100 ? `Loading sounds… ${pct}%` : "Sound will play";
    });
  }

  presence.onChange(() => renderPresence());

  const status = $("status");
  let everOnline = false;
  net = Hollia.connect({
    onWelcome(w) {
      // A reconnect drops any move we were waiting to hear about.
      if (asking) finishAsking({ req: asking.req, error: "Reconnected. Try that again." });
      // Flags first: they decide which hotspots show. Shared state too (where roamers are).
      flags = new Set(w.flags || []);
      shared = w.shared || {};
      if (w.now) clockSkew = w.now - Date.now();
      // First welcome boots the scene; after a reconnect, only resync players
      // (unless the world changed shape and our scene vanished).
      if (!CFG || !w.world.scenes[current]) start(w);
      else {
        CFG = w.world; ME = w.you.id; presence.set(w.players);
        // The DM may have moved us while we were disconnected.
        if (w.you.scene !== current || (w.you.pos ?? null) !== currentPos) go(w.you.scene, w.you.spot, true, null, w.you.pos);
      }
      applyControls(w.controls);
      onShared(shared); // redraws hotspots, like flagsChanged()
      HolliaPack.onWelcome(w);
      HolliaGame.resume(w.game); // a minigame in progress or waiting for the DM
      // Going offline let go of what we held (one at a time): still busy with it, claim it again
      // (quietly, if someone else got it). After a refresh mid-minigame, the game names its hotspot
      // (games.<id>.hotspot; the server kept that hold). Otherwise nothing's held.
      const gameSpot = w.game && CFG.games?.[w.game.shells?.game || w.game.try?.game]?.hotspot;
      if (engaged() && (holding || gameSpot)) {
        holding = holding || gameSpot;
        net.send({ t: "hold", spot: holding, req: ++holdReq });
      } else holding = null;
    },
    onMessage(m) {
      if (m.t === "players") presence.set(m.players);
      else if (m.t === "flags") { flags = new Set(m.flags); flagsChanged(); }
      else if (m.t === "inv" || m.t === "place" || m.t === "inv-result" || m.t === "items") HolliaPack.onMessage(m);
      else if (m.t === "controls") applyControls(m.controls);
      else if (m.t === "moved") {
        // A refused move ("someone is already at the spyglass") brings us back with the reason.
        if (m.message && m.scene === current && (m.pos ?? null) === currentPos) narrate(m.message);
        else go(m.scene, null, true, m.message, m.pos);
      }
      else if (m.t === "chance") onChance(m);
      else if (m.t === "shared") onShared(m.shared, m.now);
      else if (m.t === "game-result" || m.t === "game-verdict" || m.t === "shells") HolliaGame.onMessage(m);
      else if (m.t === "announce") announce(m.text);
      else if (m.t === "sound") playSound(m.src); // the DM's Hit button (scene hitSound)
      else if (m.t === "roam-result") { roamWaiting[m.req]?.(m); delete roamWaiting[m.req]; }
      else if (m.t === "trade-result") { tradeWaiting[m.req]?.(m); delete tradeWaiting[m.req]; }
      else if (m.t === "heal-result") { healWaiting[m.req]?.(m); delete healWaiting[m.req]; }
      else if (m.t === "hold-result") { holdWaiting[m.req]?.(m); delete holdWaiting[m.req]; }
      else if (m.t === "move-result") finishAsking(m);
    },
    onError(m) { console.warn("Server:", m.message); },
    onStatus(s) {
      status.className = s;
      status.textContent = s === "online" ? Hollia.session()?.name || "Online" : s === "offline" ? "Reconnecting…" : "Connecting…";
      // No server: cover the page and block everything (clicks, keys) until it's back.
      // Not on the very first "connecting" (normal page load), only once it's been lost.
      if (s === "online") everOnline = true;
      const lost = s === "offline" || (s === "connecting" && everOnline);
      $("offline").hidden = !lost;
      document.querySelector("main").inert = lost || document.body.classList.contains("paused");
      if (lost) { hideTip(); document.activeElement?.blur?.(); }
    },
  });
  // Page starts paused (index.html: body.paused, #pause overlay): animations held, main inert.
  // The click to begin is also the interaction browsers need before sound plays (ambient.js unlock).
  $("pause").onclick = () => {
    document.body.classList.remove("paused");
    $("pause").hidden = true;
    document.querySelector("main").inert = !$("offline").hidden;
  };
  document.querySelector("main").inert = true;
  $("pause").focus();
  $("leave").onclick = $("offlineLeave").onclick = () => Hollia.logout();
  HolliaPack.init({ send: (m) => net.send(m), narrate, onDone: tradeDone });
  HolliaGame.init({ send: (m) => net.send(m), narrate, onIdle: () => letGoIfIdle(), onOpen: (id) => playSound(CFG.games?.[id]?.startSound),
    art: (id) => CFG.games?.[id]?.art,
    onWin: (id) => playSound(CFG.games?.[id]?.winSound),
    onLose: (id) => playSound(CFG.games?.[id]?.loseSound) });
  HolliaRounds.init({ send: (m) => net.send(m), now: serverNow, scene: () => current, def: () => scene(current), me: () => ME });

  window.HolliaEngine = { presence, go, run };
})();
