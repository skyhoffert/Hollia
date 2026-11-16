/* Rounds: the fight log and action box under a scene with  rounds: true  (the cave).
   Server side and the shared state's shape: "rounds" in server/activities.js.

   shared.rounds[scene] = { n, endsAt, cast, answered, log } comes with every "shared" message.
   While a round runs (endsAt in the future) the player types what they do and sends it
   (answer { text }); they can change it until the countdown ends. When it ends, everyone's
   actions and the DM's results appear in the log, which everyone in the scene sees.

   HolliaRounds.init({ send, now, scene, def, me })   getters: server clock, current scene id,
     its world entry, my player id
   HolliaRounds.update(shared)   after shared state changes or the scene changes */
window.HolliaRounds = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let o = null, shared = {}, clock = null, shownLog = "", shownRound = null;

  function round() {
    const s = o?.def();
    return s?.rounds ? shared.rounds?.[o.scene()] || null : null;
  }

  function entryHtml(e) {
    switch (e.k) {
      case "round": return `<li class="r-round">Round ${e.n}</li>`;
      case "act": return `<li class="r-act"><b>${esc(e.name)}</b>: ${esc(e.text)}</li>`;
      case "idle": return `<li class="r-idle"><b>${esc(e.name)}</b> did nothing.</li>`;
      case "dm": return `<li class="r-dm">${esc(e.text)}</li>`;
      default: return "";
    }
  }

  function tick() {
    const r = round();
    const left = r?.endsAt ? Math.ceil((r.endsAt - o.now()) / 1000) : 0;
    const open = left > 0;
    $("roundForm").hidden = !open;
    // After a round, until the DM posts what happened.
    $("roundWait").hidden = open || !r?.n || r.log[r.log.length - 1]?.k === "dm";
    if (open) $("roundClock").textContent = `${left}s`;
    else { clearInterval(clock); clock = null; }
  }

  function update(sh) {
    if (sh) shared = sh;
    const r = round();
    const box = $("rounds");
    box.hidden = !r || (!r.log.length && !r.endsAt);
    // Hidden (e.g. the DM cleared it for the next group, which starts at round 1 again): forget
    // the last round, so the next one starts with an empty box.
    if (box.hidden) { clearInterval(clock); clock = null; shownRound = null; shownLog = ""; return; }

    // Log: only redraw when it changed (keeps the scroll), then stick to the bottom.
    const key = o.scene() + ":" + r.log.length + ":" + (r.log[r.log.length - 1]?.text || "");
    if (key !== shownLog) {
      shownLog = key;
      const list = $("roundLog");
      list.innerHTML = r.log.map(entryHtml).join("");
      list.scrollTop = list.scrollHeight;
    }

    // A new round: clear last round's text and put the cursor in the box.
    if (r.endsAt && shownRound !== o.scene() + ":" + r.n) {
      shownRound = o.scene() + ":" + r.n;
      $("roundText").value = "";
      $("roundNote").textContent = "";
      $("roundLabel").textContent = `Round ${r.n}: what do you do?`;
      setTimeout(() => $("roundText").focus(), 50);
    }
    if (r.endsAt) $("roundNote").textContent = r.answered.includes(o.me())
      ? "Sent. You can change it until time runs out." : "";
    tick();
    if (r.endsAt && !clock) clock = setInterval(tick, 250);
  }

  function submit(e) {
    e?.preventDefault();
    const text = $("roundText").value.trim();
    if (!text || !round()?.endsAt) return;
    o.send({ t: "answer", text });
    $("roundNote").textContent = "Sending…";
  }

  function init(opts) {
    o = opts;
    $("roundForm").addEventListener("submit", submit);
    // Enter sends; Shift+Enter for a new line.
    $("roundText").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) submit(e);
      e.stopPropagation(); // typing here never triggers scene keys
    });
  }

  return { init, update };
})();
