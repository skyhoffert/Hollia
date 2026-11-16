/* Pack: the player's inventory panel in the scene viewer (the "Inventory"
   button under the scene opens it).

   Shows the two hands, the 3x3 bag, coins, and an open stash (the crew
   quarters' storage crate) or shop. There's no dropping things on the ground. Items move by dragging (mouse or
   touch; R or right-click turns an item mid-drag) or by tapping one and using
   its buttons.

   Nothing changes until the server says so: each action is sent as
   { t: "inv", op, req, ... } and the panel waits (dimmed) for
   inv-result { req, ok | error }. The server sends the new inventory ("inv")
   and the stashes here ("place") just before that answer.

   The engine (engine.js) calls:
     HolliaPack.init({ send, narrate })
     .onWelcome(welcome)  .onMessage(msg)  .onScene(sceneId)
     .find(hotspotId, done)  .openShop(id, line)  .openStash(id)

   While the panel is open, body gets "packing" and the scene is locked (no moving
   or clicking things) until it's closed, like a conversation.

   An open shop or stash takes over: body gets the "trading" class (the engine
   locks the scene and hides narration, like a conversation) and the only way
   out is the "Done" button, which calls init's onDone({ shop } | { stash }). */
window.HolliaPack = (() => {
  const GRID = 3;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let send = () => {}, narrate = () => {}, onDone = () => {};
  let world = null, items = {}, inv = null, place = null, scene = null;
  let open = false, stashOpen = null, shopOpen = null, selected = null, busy = null, reqN = 0;
  let msgTimer = null;
  let shopLine = null, wasOpen = false; // what opened the shop said; was the panel open before

  const def = (id) => items[id] || { name: id, w: 1, h: 1, art: "", desc: "", price: 0, hold: "one" };
  const size = (id) => [def(id).w, def(id).h];
  const dims = (e) => { const [w, h] = size(e.item); return e.turned ? [h, w] : [w, h]; };
  const tile = () => (innerWidth < 520 ? 44 : 52);

  /* ---------- talking to the server ---------- */
  function request(op, fields, done) {
    if (busy) return;
    const req = ++reqN;
    busy = { req, done, timer: setTimeout(() => finish({ req, error: "No answer from the server. Try again." }), 6000) };
    send({ t: "inv", op, req, ...fields });
    render();
  }
  function finish(r) {
    if (!busy || r.req !== busy.req) return;
    clearTimeout(busy.timer);
    const done = busy.done;
    busy = null;
    removeGhost();
    msg = { text: "", bad: false }; // drop "Waiting for the server…"
    if (r.error) message(r.error, true);
    else if (r.say && !done) message(r.say);
    render();
    done?.(r);
  }
  // Kept in msg so a redraw of the panel (which rebuilds #packMsg) doesn't wipe it.
  let msg = { text: "", bad: false };
  function showMsg() {
    const m = $("packMsg");
    if (!m) return;
    m.textContent = msg.text;
    m.className = msg.bad ? "bad" : "";
  }
  function message(text, bad = false) {
    msg = { text, bad };
    showMsg();
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { msg = { text: "", bad: false }; showMsg(); }, 5000);
  }

  /* ---------- where things are ---------- */
  // { entry, from: "bag"|"overflow"|"hand"|"stash", hand?, stash? }
  function findEntry(id) {
    if (!inv) return null;
    for (const h of ["left", "right", "both"]) if (inv.hands[h]?.id === id) return { entry: inv.hands[h], from: "hand", hand: h };
    for (const k of ["bag", "overflow"]) { const e = inv[k].find((x) => x.id === id); if (e) return { entry: e, from: k }; }
    for (const [sid, s] of Object.entries(place?.stashes || {})) {
      const e = s.items.find((x) => x.id === id);
      if (e) return { entry: e, from: "stash", stash: sid };
    }
    return null;
  }
  const own = (loc) => loc && ["bag", "overflow", "hand"].includes(loc.from);
  function fits(x, y, w, h, ignore) {
    if (x < 0 || y < 0 || x + w > GRID || y + h > GRID) return false;
    return inv.bag.every((e) => {
      if (e.id === ignore) return true;
      const [ew, eh] = dims(e);
      return !(x < e.at[0] + ew && e.at[0] < x + w && y < e.at[1] + eh && e.at[1] < y + h);
    });
  }
  // Hands this character lost (inv.lost, the DM's call after a lost minigame): they hold nothing,
  // and with one gone nothing two-handed can be held. The server enforces it too.
  const lostHand = (h) => (h === "both" ? !!inv?.lost?.length : !!inv?.lost?.includes(h));
  // Which hand a "hold it" button uses.
  function freeHand(item) {
    const k = def(item).hold;
    if (k === "both") return lostHand("both") ? null : "both";
    if (k !== "one" || inv.hands.both) return null;
    return !inv.hands.right && !lostHand("right") ? "right" : !inv.hands.left && !lostHand("left") ? "left" : null;
  }

  /* ---------- drawing ---------- */
  // An item's picture, fit into a w x h pixel box. turned = drawn sideways.
  function art(itemId, turned, wPx, hPx) {
    const d = def(itemId), W = d.w * 32, H = d.h * 32;
    const vb = turned ? `0 0 ${H} ${W}` : `0 0 ${W} ${H}`;
    const inner = turned ? `<g transform="translate(${H} 0) rotate(90)">${d.art}</g>` : d.art;
    return `<svg viewBox="${vb}" width="${wPx}" height="${hPx}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`;
  }
  // Spells (shards, scrolls) need attunement, per unique item (the DM sets it).
  const isSpell = (item) => ["shard", "scroll"].includes(def(item).kind);
  const attuned = (e) => !!inv?.attuned?.includes(e.id);
  function itemHtml(e, wPx, hPx, turned, style = "") {
    const d = def(e.item);
    const att = isSpell(e.item) && attuned(e);
    const label = d.name + (att ? " (attuned)" : "");
    return `<button type="button" class="item${selected === e.id ? " sel" : ""}" data-id="${esc(e.id)}" style="width:${wPx}px;height:${hPx}px;${style}"
              title="${esc(label)}" aria-label="${esc(label)}">${art(e.item, turned, wPx - 6, hPx - 6)}${att ? '<span class="att" aria-hidden="true">✦</span>' : ""}</button>`;
  }
  function pileHtml(pile, T) {
    if (!pile.items.length) return "";
    return pile.items.map((e) => { const [w, h] = size(e.item); return itemHtml(e, w * T, h * T, false); }).join("");
  }

  function render() {
    const box = $("pack");
    const btn = $("packBtn");
    if (btn) btn.classList.toggle("on", open);
    const trading = !!(inv && (shopOpen || stashOpen));
    document.body.classList.toggle("trading", trading);
    // Inventory open: the scene is locked, like a conversation (engine.js locked()).
    document.body.classList.toggle("packing", !!(open && inv));
    if (!box) return;
    box.hidden = !open || !inv;
    if (box.hidden) return;
    const T = tile(), t = Math.round(T * 0.7);
    const H = inv.hands;
    if (selected && !findEntry(selected)) selected = null;

    const hand = (side) => lostHand(side)
      ? `<div class="hand lost" style="width:${T + 8}px;height:${2 * T + 8}px"><span class="empty">${side} hand<br>lost</span></div>`
      : `
      <div class="hand" data-hand="${side}" style="width:${T + 8}px;height:${2 * T + 8}px">
        ${H[side] ? itemHtml(H[side], T, 2 * T, false) : `<span class="empty">${side} hand</span>`}
      </div>`;
    const hands = H.both
      ? `<div class="hands both"><div class="hand" data-hand="both" style="width:${2 * T + 22}px;height:${2 * T + 8}px">${itemHtml(H.both, 2 * T + 14, 2 * T, false)}</div></div>
         <div class="cap">both hands</div>`
      : `<div class="hands">${hand("left")}${hand("right")}</div><div class="cap">hands</div>`;

    const cells = Array.from({ length: GRID * GRID }, (_, i) => `<div class="cell" style="left:${(i % GRID) * T}px;top:${Math.floor(i / GRID) * T}px;width:${T}px;height:${T}px"></div>`).join("");
    const bagItems = inv.bag.map((e) => { const [w, h] = dims(e); return itemHtml(e, w * T, h * T, !!e.turned, `position:absolute;left:${e.at[0] * T}px;top:${e.at[1] * T}px`); }).join("");

    const stash = stashOpen && place?.stashes[stashOpen];
    const shop = shopOpen && world?.shops?.[shopOpen];

    box.innerHTML = `
      <div class="pack-head"><h2>${esc(shop ? shop.keeper || shop.name : stash ? stash.name : "Inventory")}</h2><span class="coins">◉ ${inv.coins} coins</span>
        <span id="packMsg"></span>${trading
          ? `<button type="button" class="done" data-close="trade">Done</button>`
          : `<button type="button" class="x" data-close="pack" aria-label="Close inventory">×</button>`}</div>
      ${shop && shopLine ? `<p class="shop-line">${esc(shopLine)}</p>` : ""}
      <div class="pack-main">
        <div class="col">${hands}</div>
        <div class="col"><div class="bag" style="width:${GRID * T}px;height:${GRID * T}px">${cells}${bagItems}<div class="preview" hidden></div></div><div class="cap">pack</div></div>
        <div class="col detail">${detailHtml()}</div>
      </div>
      ${inv.overflow.length ? `<div class="area overflow"><h3>Doesn't fit</h3><p class="note">Make room, then drag these into your pack or hands, or store them in the crew quarters.</p><div class="pile">${pileHtml(inv.overflow, t)}</div></div>` : ""}
      ${shop ? shopHtml(shop, t) : ""}
      ${stash ? `<div class="area drop" data-drop="stash:${esc(stashOpen)}"><h3>${esc(stash.name)}</h3>
           ${coinRow(stash.coins, "stash:" + stashOpen)}
           <div class="pile">${pileHtml(stash, t) || '<span class="note">Empty. Drag things here to store them.</span>'}</div></div>` : ""}`;
    box.classList.toggle("busy", !!busy);
    if (busy) message("Waiting for the server…"); else showMsg();
  }

  function coinRow(n, where) {
    return `<div class="coinrow">${n ? `◉ ${n} coins <button type="button" data-coins-take="${esc(where)}">Take</button>` : ""}
      <span class="spacer"></span>
      <input type="number" min="1" max="${inv.coins}" placeholder="coins" data-coins-amt="${esc(where)}" ${inv.coins ? "" : "disabled"}>
      <button type="button" data-coins-put="${esc(where)}" ${inv.coins ? "" : "disabled"}>Store</button></div>`;
  }

  function shopHtml(shop, t) {
    const rows = Object.entries(shop.sells || {}).map(([id, price]) => {
      const d = def(id);
      // Limited items (shop.stock): how many are left, from the server (place.stock).
      const left = place?.stock?.[shopOpen]?.[id];
      const count = left == null ? "" : ` <span class="note">${left ? `${left} left` : "sold out"}</span>`;
      return `<li><span class="mini">${art(id, false, t * 0.8, t * 0.8)}</span><span class="nm">${esc(d.name)} <span class="note">${d.w}x${d.h}</span>${count}</span>
        <span class="price">${price} ◉</span><button type="button" data-buy="${esc(id)}" ${inv.coins < price || left === 0 ? "disabled" : ""}>Buy</button></li>`;
    }).join("");
    return `<div class="area drop shop" data-drop="sell"><h3>${esc(shop.name)}</h3>
      <ul>${rows}</ul><p class="note">${esc(shop.keeper || "They")} buys things too: drag something here, or pick it and press Sell.</p></div>`;
  }

  function sellPrice(item) {
    const shop = world?.shops?.[shopOpen];
    if (!shop) return 0;
    if (shop.buys) return shop.buys[item] || 0;
    const base = def(item).price || 0;
    return base > 0 ? Math.max(1, Math.floor(base * (shop.buyRate ?? 0.5))) : 0;
  }

  function detailHtml() {
    const loc = selected && findEntry(selected);
    if (!loc) return `<p class="note">Drag things to move them. Tap one for more. While dragging, press R or right-click to turn it.</p>
      ${shopOpen || stashOpen ? "" : `<p class="note">Close the inventory to move or interact.</p>`}`;
    const e = loc.entry, d = def(e.item), b = [];
    const [w, h] = size(e.item);
    if (loc.from === "bag" && w !== h) b.push(["rotate", "Turn"]);
    if (loc.from !== "hand" && freeHand(e.item)) b.push(["hold", "Hold"]);
    // No free hand: offer to swap with what's held (the server checks the pack has room).
    else if (loc.from !== "hand" && own(loc) && d.hold) {
      const H = inv.hands;
      if (d.hold === "both") { if (!lostHand("both")) b.push(["swap:both", "Swap into both hands"]); }
      else if (H.both) b.push(["swap:right", `Swap for the ${def(H.both.item).name}`]);
      else for (const hd of ["left", "right"]) if (H[hd] && !lostHand(hd)) b.push(["swap:" + hd, `Swap for the ${def(H[hd].item).name}`]);
    }
    if (loc.from !== "bag") b.push(["stow", loc.from === "stash" ? "Take" : "Put in pack"]);
    if (own(loc) && stashOpen && place?.stashes[stashOpen]) b.push(["store", "Store"]);
    if (own(loc) && shopOpen && sellPrice(e.item)) b.push(["sell", `Sell for ${sellPrice(e.item)} ◉`]);
    if (own(loc) && !shopOpen && !stashOpen && pileHere(e.item)) b.push(["putback", pileHere(e.item).action.find.backLabel || "Put back"]);
    const where = { bag: "in your pack", overflow: "doesn't fit", hand: loc.hand === "both" ? "in both hands" : `in your ${loc.hand} hand`,
                    stash: `in the ${(place?.stashes[loc.stash]?.name || "crate").toLowerCase()}` }[loc.from];
    const holdNote = d.hold === "both" ? (lostHand("both") ? "Takes both hands (you've only got one)." : "Takes both hands.") : d.hold === "one" ? "One hand." : "Too big to hold.";
    return `<div class="sel-art">${art(e.item, false, 40, 40)}</div>
      <h3>${esc(d.name)}</h3><p class="note">${w}x${h} · ${esc(where)} · ${holdNote}</p>
      <p class="desc">${esc(d.desc)}</p>
      ${isSpell(e.item) ? (own(loc) && attuned(e)
        ? '<p class="attune on">✦ Attuned.</p>'
        : '<p class="attune off">Not attuned.</p>') : ""}
      <div class="acts">${b.map(([k, label]) => `<button type="button" data-act="${k}">${esc(label)}</button>`).join("")}</div>`;
  }

  /* ---------- actions ---------- */
  function act(kind) {
    const loc = findEntry(selected);
    if (!loc) return;
    const e = loc.entry;
    if (kind === "rotate") request("move", { id: e.id, to: { bag: e.at, turned: !e.turned } });
    if (kind === "hold") request("move", { id: e.id, to: { hand: freeHand(e.item) } });
    if (kind.startsWith("swap:")) request("move", { id: e.id, to: { hand: kind.slice(5) } });
    if (kind === "stow") request("move", { id: e.id, to: { bag: "auto" } });
    if (kind === "store") request("move", { id: e.id, to: { place: "stash:" + stashOpen } });
    if (kind === "sell") request("sell", { shop: shopOpen, id: e.id });
    if (kind === "putback") request("putback", { id: e.id });
  }

  // A pile in this scene you can keep taking from ({ find: { again: true } }) that gives
  // this item: it can go back on it (the server checks too).
  function pileHere(item) {
    return (world?.scenes?.[scene]?.hotspots || []).find((h) => {
      const f = h.action?.find;
      return f && typeof f === "object" && !Array.isArray(f) && f.again === true && [].concat(f.items || []).includes(item);
    });
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || busy) return;
    if (t.dataset.close === "pack") { open = false; return render(); }
    if (t.dataset.close === "trade") {
      const was = shopOpen ? { shop: shopOpen } : { stash: stashOpen };
      shopOpen = stashOpen = shopLine = selected = null;
      open = wasOpen;
      render();
      return onDone(was);
    }
    if (t.dataset.act) return act(t.dataset.act);
    if (t.dataset.buy) return request("buy", { shop: shopOpen, item: t.dataset.buy });
    if (t.dataset.coinsTake) {
      const where = t.dataset.coinsTake;
      const n = place.stashes[where.slice(6)]?.coins;
      return request("coins", { amount: n, from: where });
    }
    if (t.dataset.coinsPut) {
      const where = t.dataset.coinsPut;
      const n = Math.floor(+document.querySelector(`[data-coins-amt="${CSS.escape(where)}"]`)?.value);
      if (!(n > 0)) return message("How many coins?", true);
      return request("coins", { amount: n, to: where });
    }
    if (t.classList.contains("item") && !dragMoved) { selected = selected === t.dataset.id ? null : t.dataset.id; render(); }
  }

  /* ---------- drag and drop ---------- */
  let drag = null, dragMoved = false, ghost = null;

  function removeGhost() { ghost?.remove(); ghost = null; }
  function makeGhost() {
    removeGhost();
    const T = tile(), [w, h] = drag.turned ? [drag.h, drag.w] : [drag.w, drag.h];
    ghost = document.createElement("div");
    ghost.className = "pack-ghost";
    ghost.innerHTML = art(drag.item, drag.turned, w * T - 6, h * T - 6);
    Object.assign(ghost.style, { width: w * T + "px", height: h * T + "px" });
    document.body.append(ghost);
    drag.gx = Math.min(drag.gx, w * T - 4);
    drag.gy = Math.min(drag.gy, h * T - 4);
  }
  function placeGhost(x, y) { if (ghost) Object.assign(ghost.style, { left: x - drag.gx + "px", top: y - drag.gy + "px" }); }

  function onDown(ev) {
    const el = ev.target.closest(".item");
    if (!el || busy || ev.button > 0) return;
    const loc = findEntry(el.dataset.id);
    if (!loc) return;
    const r = el.getBoundingClientRect(), T = tile();
    const [w, h] = size(loc.entry.item);
    const turned = loc.from === "bag" && !!loc.entry.turned;
    const [dw, dh] = turned ? [h, w] : [w, h];
    // Keep the grab point under the finger, scaled to the item's bag size.
    drag = { id: loc.entry.id, item: loc.entry.item, loc, w, h, turned, x0: ev.clientX, y0: ev.clientY,
             gx: ((ev.clientX - r.left) / r.width) * dw * T, gy: ((ev.clientY - r.top) / r.height) * dh * T, el };
    dragMoved = false;
  }
  function onMove(ev) {
    if (!drag) return;
    if (!dragMoved) {
      if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 6) return;
      dragMoved = true;
      makeGhost();
      drag.el.classList.add("dragging");
    }
    ev.preventDefault();
    drag.lx = ev.clientX; drag.ly = ev.clientY;
    placeGhost(ev.clientX, ev.clientY);
    highlight(target(ev.clientX, ev.clientY));
  }
  function onUp(ev) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!dragMoved) return; // a tap: onClick selects it
    d.el.classList.remove("dragging");
    const tg = target(ev.clientX, ev.clientY, d);
    highlight(null);
    setTimeout(() => (dragMoved = false), 0);
    const done = drop(d, tg);
    if (done) { ghost?.classList.add("pending"); } else removeGhost();
  }
  function turnDrag() {
    if (!dragMoved || !drag || drag.w === drag.h) return;
    drag.turned = !drag.turned;
    [drag.gx, drag.gy] = [drag.gy, drag.gx];
    makeGhost();
    placeGhost(drag.lx, drag.ly);
    highlight(target(drag.lx, drag.ly));
  }

  // What's under the pointer: { bag: [x, y] } | { hand } | { drop: "stash:x" | "sell" } | null
  // d: the drag in progress (onUp has already cleared `drag`, so it passes its copy).
  function target(x, y, d = drag) {
    if (ghost) ghost.style.display = "none";
    const under = document.elementFromPoint(x, y);
    if (ghost) ghost.style.display = "";
    if (!under) return null;
    const bag = under.closest(".bag");
    if (bag) {
      const r = bag.getBoundingClientRect(), T = tile();
      // item: the pack item right under the pointer (dropping a held item on it swaps the two)
      const it = under.closest(".item")?.dataset.id;
      return { bag: [Math.round((x - d.gx - r.left) / T), Math.round((y - d.gy - r.top) / T)], el: bag, item: it !== d?.id ? it : undefined };
    }
    const hand = under.closest("[data-hand]");
    if (hand) return { hand: hand.dataset.hand, el: hand };
    const zone = under.closest("[data-drop]");
    if (zone) return { drop: zone.dataset.drop, el: zone };
    return null;
  }
  let lit = null;
  function highlight(tg) {
    lit?.classList.remove("over", "no");
    lit = null;
    const pv = document.querySelector("#pack .preview");
    if (pv) pv.hidden = true;
    if (!tg || !drag) return;
    if (tg.bag) {
      const [w, h] = drag.turned ? [drag.h, drag.w] : [drag.w, drag.h], T = tile();
      const ok = fits(tg.bag[0], tg.bag[1], w, h, drag.id) || canSwap(drag, tg) || !!packSwapAt(drag, tg);
      Object.assign(pv.style, { left: tg.bag[0] * T + "px", top: tg.bag[1] * T + "px", width: w * T + "px", height: h * T + "px" });
      pv.className = "preview" + (ok ? "" : " no");
      pv.hidden = false;
      return;
    }
    lit = tg.el;
    lit.classList.add("over");
  }
  // Dragging something held onto a holdable item in the pack swaps them (the server checks room).
  const canSwap = (d, tg) => { const t = d?.loc.from === "hand" && tg?.item && findEntry(tg.item); return !!(t && t.from === "bag" && items[t.entry.item]?.hold); };
  // Pack item onto pack item: where the dragged one should land. Same shape: exactly where
  // the other one is; otherwise where it was dropped. null: not a pack swap.
  function packSwapAt(d, tg) {
    const t = d?.loc.from === "bag" && tg?.item && findEntry(tg.item);
    if (!t || t.from !== "bag") return null;
    const [w, h] = d.turned ? [d.h, d.w] : [d.w, d.h];
    const [ow0, oh0] = size(t.entry.item), [ow, oh] = t.entry.turned ? [oh0, ow0] : [ow0, oh0];
    return w === ow && h === oh ? t.entry.at : tg.bag;
  }
  // Send the move for a drop. Returns true if something was sent.
  function drop(d, tg) {
    if (!tg) return false;
    const mine = own(d.loc);
    if (tg.bag) {
      const [w, h] = d.turned ? [d.h, d.w] : [d.w, d.h];
      if (!fits(tg.bag[0], tg.bag[1], w, h, d.id)) {
        // A held item dropped on a pack item: that item goes into the hand, this one into the pack.
        if (canSwap(d, tg)) { request("move", { id: tg.item, to: { hand: d.loc.hand } }); return true; }
        // A pack item dropped on another pack item: swap them (the server checks it all fits).
        const at = packSwapAt(d, tg);
        if (at) { request("move", { id: d.id, to: { bag: at, turned: d.turned, swap: tg.item } }); return true; }
        message("It doesn't fit there.", true); return false;
      }
      if (d.loc.from === "bag" && d.loc.entry.at[0] === tg.bag[0] && d.loc.entry.at[1] === tg.bag[1] && !!d.loc.entry.turned === d.turned) return false;
      request("move", { id: d.id, to: { bag: tg.bag, turned: d.turned } });
      return true;
    }
    if (tg.hand) {
      if (d.loc.from === "hand" && (d.loc.hand === tg.hand || d.loc.hand === "both")) return false;
      request("move", { id: d.id, to: { hand: tg.hand } });
      return true;
    }
    if (tg.drop === "sell") {
      if (!mine) return false;
      request("sell", { shop: shopOpen, id: d.id });
      return true;
    }
    if (tg.drop) {
      if (d.loc.from === "stash" && tg.drop === "stash:" + d.loc.stash) return false;
      request("move", { id: d.id, to: { place: tg.drop } });
      return true;
    }
    return false;
  }

  function wire() {
    const box = $("pack");
    box.addEventListener("click", onClick);
    box.addEventListener("pointerdown", onDown);
    addEventListener("pointermove", onMove, { passive: false });
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", () => { drag?.el.classList.remove("dragging"); drag = null; removeGhost(); highlight(null); });
    addEventListener("keydown", (e) => {
      if (drag && dragMoved && (e.key === "r" || e.key === "R")) turnDrag();
      if (drag && e.key === "Escape") { drag.el.classList.remove("dragging"); drag = null; removeGhost(); highlight(null); }
    });
    addEventListener("contextmenu", (e) => { if (drag && dragMoved) { e.preventDefault(); turnDrag(); } });
    // Touch: stop the page from scrolling while dragging an item.
    box.addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { passive: false });
    $("packBtn").onclick = () => { open = !open; render(); };
    addEventListener("resize", () => open && !drag && render());
  }

  /* ---------- engine hooks ---------- */
  return {
    // Is this item (worlds/items.js name) in my hands, pack or overflow? Stashes don't count.
    has(name) {
      if (!inv) return false;
      return Object.values(inv.hands || {}).some((e) => e?.item === name)
        || ["bag", "overflow"].some((k) => (inv[k] || []).some((e) => e.item === name));
    },
    // Has this character lost that hand ("left" | "right")? (the engine's "lost:" condition)
    lost(h) { return lostHand(h); },
    init(o) { send = o.send; narrate = o.narrate; onDone = o.onDone || onDone; wire(); },
    onWelcome(w) {
      world = w.world; items = w.items || {}; inv = w.inv || null; place = w.place || null;
      $("packBtn").hidden = !inv;
      if (busy) finish({ req: busy.req, error: "Reconnected. Check that it went through." });
      render();
    },
    onMessage(m) {
      if (m.t === "inv") { inv = m.inv; if (!busy) render(); }
      else if (m.t === "items") { items = m.items || {}; if (!busy) render(); } // the DM made a custom item
      else if (m.t === "place") { place = m.place; if (stashOpen && !place.stashes[stashOpen]) stashOpen = null; if (!busy) render(); }
      else if (m.t === "inv-result") finish(m);
    },
    // The DM hid inventory (engine.js applyControls): close the pack and any shop/stash.
    hide() { if (open || shopOpen || stashOpen) { open = false; stashOpen = shopOpen = shopLine = selected = null; render(); } },
    onScene(sceneId) { scene = sceneId; if (shopOpen || stashOpen) open = wasOpen; stashOpen = shopOpen = shopLine = selected = null; render(); },
    find(hotspot, done) {
      if (!inv) return done({ error: "You can't carry anything." });
      if (busy) return done({ error: "Hang on, still waiting on the last thing." });
      request("find", { hotspot }, done);
    },
    // Toss coins into an offering (world.offerings.<id>, e.g. the fountain). The server decides.
    offer(offering, done) {
      if (!inv) return done({ error: "You can't carry anything." });
      if (busy) return done({ error: "Hang on, still waiting on the last thing." });
      request("offer", { offering }, done);
    },
    openShop(id, line) { if (!inv) return; if (!shopOpen && !stashOpen) wasOpen = open; shopOpen = id; stashOpen = null; shopLine = line || null; open = true; render(); $("pack").scrollIntoView({ behavior: "smooth", block: "nearest" }); },
    openStash(id) { if (!inv) return; if (!shopOpen && !stashOpen) wasOpen = open; stashOpen = id; shopOpen = shopLine = null; open = true; render(); $("pack").scrollIntoView({ behavior: "smooth", block: "nearest" }); },
  };
})();
