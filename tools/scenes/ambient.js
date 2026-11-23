/* Ambient sound for the scenes page: one looping background track, crossfaded on scene change.
   Scenes say  ambient: "sounds/x.ogg"  (path from the site root); null = silence; left out (undefined)
   = keep what's playing. A list,  ambient: ["sounds/a.ogg", "sounds/b.ogg"] , layers the tracks: they
   loop together, the new ones started at the same moment once all have loaded (the voyage's sea plus
   fight music). A track playing before and after a change just keeps going (the sea carries on from
   Rough Water into The Hafgufa while the fight music fades in). Web Audio for gapless loops. preload() fetches every sound on page load
   (engine.js, behind "Click to begin"); anything not in yet loads the first time it's needed.
   Browsers keep the AudioContext suspended until the first click/key; it resumes then
   (the page's "Click to begin" overlay, #pause, makes sure that click comes first).
   Mute + volume: #sound button and #soundVol slider, saved in localStorage. */
(function () {
  const KEY = "hollia.ambient";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  let muted = !!saved.muted;
  let volume = typeof saved.volume === "number" ? saved.volume : 0.4;

  let ctx = null, master = null;
  const buffers = new Map(); // src -> Promise<AudioBuffer|null>
  let cur = new Map();       // src -> { node, gain } now playing (one per layered track)
  let want;                  // tracks wanted, joined by "|" ("" = silence, undefined = nothing set yet)
  let seq = 0;               // newer set() calls win over slow loads

  function ensureCtx() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
  }
  const bytes = new Map();   // src -> Promise<ArrayBuffer> (preload(): fetched, not decoded yet)
  function fetchBytes(src, onChunk) {
    if (!bytes.has(src)) {
      // "sounds/..." is from the site root, which is "/<repo>/" on GitHub Pages (Hollia.root).
      bytes.set(src, fetch(new URL(src, Hollia.root)).then(async (r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        if (!onChunk || !r.body) return r.arrayBuffer();
        onChunk(0, +r.headers.get("Content-Length") || 0);
        const reader = r.body.getReader(), parts = [];
        let n = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value); n += value.length; onChunk(value.length, 0);
        }
        const out = new Uint8Array(n);
        let at = 0;
        for (const p of parts) { out.set(p, at); at += p.length; }
        return out.buffer;
      }).catch((e) => { bytes.delete(src); throw e; }));
    }
    return bytes.get(src);
  }
  // Decoded only when first played: decoded audio is ~10x the file size in memory.
  function load(src) {
    if (!buffers.has(src)) {
      buffers.set(src, fetchBytes(src)
        .then((b) => { bytes.delete(src); return ctx.decodeAudioData(b); })
        .catch((e) => { buffers.delete(src); console.warn("Ambient sound failed:", src, e); return null; }));
    }
    return buffers.get(src);
  }

  // Switch to src (a track, a list of tracks to layer, or null) over fadeMs (old fades out while
  // new fades in).
  function set(src, fadeMs = 1000) {
    if (src === undefined) return;
    const list = [].concat(src || []).filter(Boolean);
    const key = list.join("|");
    if (key === want) return;
    want = key;
    const tok = ++seq;
    ensureCtx();
    const f = fadeMs / 1000;
    // Tracks not wanted any more fade out; ones still wanted keep playing (brought back to full
    // if they were fading out).
    for (const [s, { node, gain }] of cur) {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      if (list.includes(s)) { gain.gain.linearRampToValueAtTime(1, t + f); continue; }
      gain.gain.linearRampToValueAtTime(0, t + f);
      node.stop(t + f + 0.05);
      cur.delete(s);
    }
    const fresh = list.filter((s) => !cur.has(s));
    if (!fresh.length) return;
    Promise.all(fresh.map(load)).then((bufs) => {
      if (tok !== seq) return;
      const t = ctx.currentTime;
      for (const [i, buf] of bufs.entries()) {
        if (!buf || cur.has(fresh[i])) continue;
        const node = ctx.createBufferSource();
        node.buffer = buf;
        node.loop = true;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(1, t + f);
        node.connect(gain).connect(master);
        node.start(t);
        cur.set(fresh[i], { node, gain });
      }
    });
  }

  // One-off clip (voice line, effect) over the ambience. A new clip cuts off the last one.
  // Follows mute and the whole slider; louder than the ambience at every setting (square root:
  // 0.63 at the default 0.4 slider, full at 100%). Was min(1, volume * 2.5): full from 40% up, so
  // the top of the slider only moved the music.
  let fx = null, fxGain = null;
  const fxLevel = () => (muted ? 0 : Math.sqrt(volume));
  // gain: this clip's own level (from the world's  sound: { src, volume } ), 1 = as recorded.
  function play(src, gain = 1) {
    ensureCtx();
    if (!fxGain) { fxGain = ctx.createGain(); fxGain.gain.value = fxLevel(); fxGain.connect(ctx.destination); }
    if (ctx.state !== "running") ctx.resume();
    load(src).then((buf) => {
      if (!buf) return;
      try { fx?.stop(); } catch {}
      fx = ctx.createBufferSource();
      fx.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = gain;
      fx.connect(g).connect(fxGain);
      fx.start();
    });
  }

  // Fetch every sound up front (the "Click to begin" overlay) so nothing waits on the network
  // later. onProgress(0..100), by bytes; never goes backwards; 100 once all are in (failures count
  // as done: those load again when played).
  function preload(srcs, onProgress) {
    const list = [...new Set(srcs)].filter((s) => !buffers.has(s) && !bytes.has(s));
    if (!list.length) return Promise.resolve(onProgress?.(100));
    let got = 0, total = 0, shown = 0, heard = 0;
    const tick = () => {
      // Until every file's size is known, count the unknown ones at the average known size.
      const est = heard < list.length ? total + (total / Math.max(heard, 1)) * (list.length - heard) : total;
      const pct = Math.min(99, Math.floor((100 * got) / (est || 1)));
      if (pct > shown) onProgress?.((shown = pct));
    };
    return Promise.all(list.map((src) => fetchBytes(src, (add, size) => {
      if (size) { total += size; heard++; }
      got += add; tick();
    }).catch((e) => console.warn("Preload failed:", src, e)))).then(() => onProgress?.(100));
  }

  // Autoplay unlock: resume on the first interaction (any later one too, if it got suspended).
  const unlock = () => { if (ctx && ctx.state !== "running") ctx.resume(); };
  addEventListener("pointerdown", unlock, true);
  addEventListener("keydown", unlock, true);

  /* ---------- controls ---------- */
  const btn = document.getElementById("sound"), slider = document.getElementById("soundVol");
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ muted, volume })); } catch {} }
  function apply() {
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
    if (fxGain) fxGain.gain.setTargetAtTime(fxLevel(), ctx.currentTime, 0.05);
    if (btn) {
      btn.textContent = muted ? "Sound: off" : "Sound: on";
      btn.setAttribute("aria-pressed", String(!muted));
    }
    if (slider) slider.value = Math.round(volume * 100);
  }
  if (btn) btn.onclick = () => { muted = !muted; apply(); save(); };
  if (slider) slider.oninput = () => {
    volume = slider.value / 100;
    if (muted && volume > 0) muted = false;
    apply(); save();
  };
  apply();

  window.HolliaAmbient = { set, play, preload };
})();
