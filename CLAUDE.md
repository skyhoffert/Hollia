# Hollia (frontend)

Public repo: the browser pages, served by GitHub Pages. The private backend (server, worlds, data,
tests, notes) is its own git repo in `Hollia-backend/`, ignored here via `.git/info/exclude`.
**Read `Hollia-backend/CLAUDE.md` before working**: it has the project rules, status and issue list.

- Nothing from the backend goes in this repo: no keys, data, world content, lore or notes, and never
  the server's address (players type it on the login page).
- Paths: links go through `Hollia.root` (site root) or are relative, never `/...`: on GitHub Pages
  the site lives under `/<repo>/`.
- Server <-> page messages: `PROTOCOL.md` (rules for changing it: `Hollia-backend/CLAUDE.md`).
- Local: `node serve.js` (http://localhost:3000) plus the backend (`npm start` in `Hollia-backend/`).
- Commit each repo separately: run git here for the frontend, in `Hollia-backend/` for the backend.
