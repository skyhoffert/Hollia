/* Shared browser helper for every Hollia tool page.

   Hollia.login(key, { name, activity })  used by the login page (see below)
   Hollia.connect({ ... })        open the tool's live connection (auto-reconnects)
       onWelcome(msg)   first welcome AND every welcome after a reconnect
       onMessage(msg)   everything else the server sends (e.g. { t: "players" }, { t: "controls" })
                        "closed" and "switch" are handled here: back to the login page,
                        which re-enters with the saved key
       onError(msg)     server rejected something
       onStatus(s)      "connecting" | "online" | "offline"
     returns { send(msg), stop(done?) }  stop: hang up for good (no reconnect), e.g. the minigames
                                         page's ?solo mode once it has the world
   Hollia.session()               saved { token, name, activity, tool } or null
   Hollia.logout()                forget the session, back to the login page
   Hollia.versionProblem(msg)     welcome / dm-welcome from a server on another protocol
                                  version -> what to tell the player, else null
   Hollia.server() / setServer(a) the game server's address, as the player typed it ("1.2.3.4:3001",
                                  "example.org", "wss://example.org/ws"). Kept only in this browser
                                  (localStorage): the pages are public, the address isn't in them.
   Hollia.wsUrl()                 that address as a WebSocket URL, or null if none is set
   Hollia.root                    the site's root URL (the login page), wherever the site is hosted:
                                  "/" locally, "/<repo>/" on GitHub Pages. Links go through it. */

window.Hollia = (() => {
  const KEY = "hollia.session";
  // Protocol version (PROTOCOL.md). Must match the server's (server/activities.js PROTOCOL).
  const PROTOCOL = 1;
  function versionProblem(m) {
    const v = m?.protocol;
    if (v === PROTOCOL) return null;
    // Server ahead: this page is old (cached). Server behind (or too old to say): it hasn't restarted yet.
    return typeof v === "number" && v > PROTOCOL
      ? "The game was updated. Refresh the page to get the new version."
      : "The game is being updated. Try again in a minute.";
  }
  // This file sits at the site root, so its own URL gives the root (pages live at different depths).
  const ROOT = new URL(".", document.currentScript.src).href;

  const SERVER = "hollia.server";
  function server() {
    try { return localStorage.getItem(SERVER) || ""; } catch { return serverMemory; }
  }
  let serverMemory = "";
  function setServer(addr) {
    serverMemory = String(addr || "").trim();
    try { serverMemory ? localStorage.setItem(SERVER, serverMemory) : localStorage.removeItem(SERVER); } catch {}
  }
  // "1.2.3.4:3001" -> ws(s)://1.2.3.4:3001/ws. No scheme: wss on an https page (browsers block ws there).
  function toWsUrl(addr) {
    let a = String(addr || "").trim();
    if (!a) return null;
    a = a.replace(/^http(s?):\/\//i, "ws$1://");
    if (!/^wss?:\/\//i.test(a)) a = (location.protocol === "https:" ? "wss://" : "ws://") + a;
    try {
      const u = new URL(a);
      if (u.pathname === "/" || u.pathname === "") u.pathname = "/ws";
      return u.href;
    } catch { return null; }
  }
  const wsUrl = () => toWsUrl(server());

  function session() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  }
  function remember(welcome) {
    const s = { token: welcome.token, name: welcome.you.name, activity: welcome.activity.name, tool: welcome.activity.tool };
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: works until refresh */ }
    memory = s;
  }
  let memory = null;
  function forget() {
    memory = null;
    try { localStorage.removeItem(KEY); } catch {}
  }
  const current = () => session() || memory;

  // Resolves with the server's answer: "welcome" (you're in), "choose" (pick an
  // activity, then call again with { activity }) or "need-name" (guest key).
  function login(key, { name, activity } = {}) {
    return new Promise((resolve, reject) => {
      const url = wsUrl();
      if (!url) return reject({ code: "no-server", message: "Enter the server address." });
      let ws;
      try { ws = new WebSocket(url); } catch { return reject({ code: "no-server", message: "That server address doesn't look right." }); }
      ws.onopen = () => ws.send(JSON.stringify({ t: "join", key, name, activity }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        // Wrong protocol version: "outdated" (refresh the page) or "updating" (the login page
        // keeps retrying until the server catches up).
        const why = m.t === "welcome" && versionProblem(m);
        if (why) { reject({ code: m.protocol > PROTOCOL ? "outdated" : "updating", message: why }); return ws.close(); }
        if (m.t === "welcome") remember(m);
        if (["welcome", "choose", "need-name", "dm-key"].includes(m.t)) { resolve(m); ws.close(); }
        else if (m.t === "error") { reject(m); ws.close(); }
      };
      ws.onerror = () => reject({ code: "network", message: "Can't reach the server. Check the address." });
    });
  }

  function connect({ onWelcome, onMessage, onError, onStatus }) {
    const s = current();
    if (!s || !wsUrl()) { location.href = ROOT; return { send() {} }; }
    let ws, delay = 1000, stopped = false, onStopped = null;
    function open() {
      stopped = false;
      onStatus?.("connecting");
      ws = new WebSocket(wsUrl());
      ws.onopen = () => ws.send(JSON.stringify({ t: "resume", token: current()?.token }));
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === "welcome" && versionProblem(m)) {
          // Server and page on different protocol versions: back to the login page, which loads
          // the current page files and logs in again with the saved key (retrying while the
          // server is behind).
          const q = new URLSearchParams({ auto: 1, msg: versionProblem(m) });
          if (m.activity?.id) q.set("activity", m.activity.id);
          stop(() => (location.href = ROOT + "?" + q));
        }
        else if (m.t === "welcome") { delay = 1000; remember(m); onStatus?.("online"); onWelcome?.(m); }
        else if (m.t === "closed" || m.t === "switch") {
          // The DM closed this activity or is moving everyone. The login page
          // retries the saved key: next activity, a choice, or "waiting for the DM".
          forget();
          const q = new URLSearchParams({ auto: 1, msg: m.message });
          if (m.activity) q.set("activity", m.activity);
          stop(() => (location.href = ROOT + "?" + q));
        } else if (m.t === "error") {
          if (m.code === "bad-token" || m.code === "closed") {
            forget();
            location.href = ROOT + "?msg=" + encodeURIComponent(m.message);
          } else onError?.(m);
        } else onMessage?.(m);
      };
      ws.onclose = () => {
        if (stopped) return onStopped?.();
        onStatus?.("offline");
        setTimeout(() => !stopped && open(), delay);
        delay = Math.min(delay * 2, 8000);
      };
    }
    // Close on purpose (no auto-reconnect) and call done once the server has seen it.
    function stop(done) {
      stopped = true;
      let called = false;
      onStopped = () => { if (!called) { called = true; done?.(); } };
      if (ws.readyState === WebSocket.CLOSED) return onStopped();
      ws.close();
      setTimeout(onStopped, 1000); // don't hang if the server is unreachable
    }
    // Leaving or refreshing the page: hang up right away instead of letting the
    // browser keep the socket open for a few seconds (it looked like you were
    // still logged in). Coming back via the Back button reconnects.
    addEventListener("pagehide", () => stop());
    addEventListener("pageshow", (e) => { if (e.persisted) open(); });
    open();
    live = { stop };
    return { send(m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }, stop };
  }
  let live = null;

  function logout() {
    forget();
    const home = () => (location.href = ROOT);
    live ? live.stop(home) : home();
  }

  return { login, connect, session: current, logout, versionProblem, server, setServer, wsUrl, toWsUrl, root: ROOT };
})();
