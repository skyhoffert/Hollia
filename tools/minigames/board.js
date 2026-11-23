/* The minigames scoreboard: one look for practice and for-real boards, live (a round still going)
   or saved. Used by the minigames page and the DM page (it loads this file too).

   MGBoard.html({ title, kind, rows, tiers, you?, live? }) -> HTML string
     rows: [{ id, name, color, score, done?, dropped?, retried? }] (done false = still playing)
     kind "practice": a Practice label. kind "real": the best score highlighted, with its tier.
   MGBoard.fromBoard(board) / MGBoard.fromRound(round) -> rows (saved board / shared.mg.round)
   MGBoard.tier(score, tiers) -> the tier for a score ({ min, name, say }) or null
   The styles are added to the page once, on load. */

window.MGBoard = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tier = (score, tiers) => [...(tiers || [])].sort((a, b) => b.min - a.min).find((t) => score >= t.min) || null;
  const fromBoard = (b) => (b?.scores || []).map((s) => ({ ...s, done: true }));
  const fromRound = (r) => (r?.cast || []).map((c) => {
    const s = r.scores?.[c.id] || {};
    return { ...c, score: s.score ?? 0, done: !!s.done, dropped: !!s.dropped };
  });

  function html({ title, kind, rows, tiers, you, live }) {
    const done = rows.filter((r) => r.done).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const playing = rows.filter((r) => !r.done);
    const real = kind === "real";
    const best = done[0];
    const t = real && best && !live ? tier(best.score, tiers) : null;
    let rank = 0, prev = null;
    const list = done.map((r, i) => {
      if (r.score !== prev) { rank = i + 1; prev = r.score; }
      const top = real && best && r.score === best.score;
      return `<li class="${top ? "best" : ""}${r.id === you ? " you" : ""}">
        <span class="rk">${rank}</span><span class="dot" style="background:${esc(r.color || "#e9e2d0")}"></span>
        <span class="nm">${esc(r.name)}${r.dropped ? ' <span class="tg" title="Left or lost the connection: their score so far">dropped</span>' : ""}${r.retried ? ' <span class="tg">retry</span>' : ""}</span>
        <span class="sc">${r.score}</span></li>`;
    }).join("");
    return `<div class="mgb">
      <div class="mgb-h"><b>${esc(title)}</b> <span class="mgb-k ${real ? "real" : ""}">${real ? "For real" : "Practice"}</span></div>
      ${t ? `<div class="mgb-tier"><b>${esc(t.name)}</b> repair: best score ${best.score}${t.say ? ` <span>${esc(t.say)}</span>` : ""}</div>` : ""}
      ${list ? `<ol>${list}</ol>` : ""}
      ${playing.length ? `<div class="mgb-wait">Still playing… ${playing.map((r) => esc(r.name)).join(", ")}</div>` : ""}
      ${!rows.length ? `<div class="mgb-wait">Nobody played this round.</div>` : ""}
    </div>`;
  }

  const css = `
  .mgb { background: #221c33; border: 1px solid #3a3152; border-radius: 12px; padding: 14px 16px; }
  .mgb-h { display: flex; align-items: center; gap: 10px; font: 500 19px Georgia, serif; }
  .mgb-k { font: 600 11px system-ui, sans-serif; letter-spacing: .05em; text-transform: uppercase; border-radius: 99px; padding: 2px 8px; background: #2f2745; color: #b9ad95; }
  .mgb-k.real { background: #4a3a1c; color: #f6c27a; }
  .mgb-tier { margin-top: 8px; padding: 6px 10px; border-radius: 8px; background: #2e2416; border: 1px solid #8a6f3a; color: #f4ead2; font-size: 14px; }
  .mgb-tier b { color: #f6c27a; }
  .mgb-tier span { color: #b9ad95; font-style: italic; }
  .mgb ol { list-style: none; margin: 10px 0 0; padding: 0; }
  .mgb li { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-top: 1px solid #2f2745; font-size: 16px; }
  .mgb li.best { background: rgba(246, 194, 122, .12); border-radius: 8px; }
  .mgb li.best .sc { color: #f6c27a; }
  .mgb li.you .nm { text-decoration: underline; text-underline-offset: 3px; }
  .mgb .rk { width: 22px; color: #9a8f7a; font-size: 13px; text-align: right; }
  .mgb .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .mgb .nm { flex: 1; }
  .mgb .sc { font: 600 20px Georgia, serif; min-width: 40px; text-align: right; }
  .mgb .tg { font-size: 11px; color: #9a8f7a; border: 1px solid #3a3152; border-radius: 4px; padding: 0 4px; }
  .mgb-wait { margin-top: 10px; color: #9a8f7a; font-size: 14px; font-style: italic; }`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  return { html, tier, fromBoard, fromRound };
})();
