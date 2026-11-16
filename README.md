# Hollia (pages)

The browser side of Hollia, a multiplayer tool for a D&D campaign: the login page, the scene
viewer players explore together, and the DM's control page. Plain HTML and JavaScript, no build step.
Hosted on GitHub Pages; the game server runs separately.

## Playing

Open the site, enter the **server address** and the **key** your DM gave you. The address is kept
only in your browser. A link ending in `?server=<address>` fills it in.

## Running locally

```
node serve.js        # http://localhost:8080 (PORT=... to change)
```

Log in with server `localhost:3000` (filled in automatically on localhost) while the game server
runs on this machine.

## Files

| Path | What it is |
|---|---|
| `index.html` | Login (server address + key) |
| `dm/index.html` | DM control page |
| `client.js` | Shared connection helper: server address, sessions, reconnects, site root |
| `tools/scenes/` | Scene viewer (`engine.js`), pack (`pack.js`), rounds (`rounds.js`), minigames (`game.js`, art in `games/`), ambient sound (`ambient.js`) |
| `sounds/` | Sound files the server's worlds name as `sounds/...` |
| `PROTOCOL.md` | Every message between the pages and the server |
| `serve.js` | Local file server (not used on GitHub Pages) |

Links are relative to the site root (`Hollia.root` in `client.js`), so the site works at a domain
root or under `/<repo>/` on GitHub Pages.
