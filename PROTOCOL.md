# Hollia protocol

How the browser pages (this repo) and the Hollia server talk. **Protocol version 1.**

The server is the source of truth for everything players share: where everyone is, inventories,
memory flags, minigames, the DM's controls. The pages draw what the server says and ask it to
change things. When a message changes, this file changes in the same commit (see "Changing the
protocol" at the end).

## Connection

- One WebSocket per page at `/ws` on the server: `wss://` when the page is https, `ws://` otherwise.
  The pages are hosted apart from the server (GitHub Pages), so they don't know where it is: the
  player types its address on the login page (`1.2.3.4:3000`, `example.org`, `wss://example.org/ws`;
  no path = `/ws`), or it comes in the link as `?server=...`. `Hollia.toWsUrl` in `client.js` turns it into the URL.
- Plain HTTP `GET /` on the server answers `Hollia server` (a reachability check); nothing else is served over HTTP.
- Every message is one JSON object with a string field `t` (its type). Anything else is ignored.
- Limits: 16 KB per message, 30 messages per second per connection (extra ones are dropped).
- The server pings every 30 s and drops connections that don't answer.
- **Requests and answers.** Messages that want an answer carry a `req` (any number the page picks);
  the answer is `<type>-result` with the same `req`. Anything the change caused (new inventory,
  flags, ...) is sent **before** the answer, so when the answer arrives the page is up to date.
- **Asset paths.** Sounds named by the server (`"sounds/x.ogg"`) are paths under the front end's
  root, not the server's.
- **Errors**: `error { code, message }`. `message` is player-facing text; `code` is one of:

  | code | when | the page should |
  |---|---|---|
  | `bad-json` | message wasn't JSON | (a bug) |
  | `slow-down` | too many failed logins from this IP (10 per 5 min) | show the message |
  | `not-joined` | a game message before `join` / `resume` | log in |
  | `bad-key` | key matches nobody (`join`), or not a DM key (`dm-login`) | show the message |
  | `bad-token` | saved session is unknown or expired | forget it, back to login |
  | `closed` | activity closed, or no access any more | forget the session, back to login |
  | `nothing-open` | personal key, but no activity open for them | wait and retry (login page: every 4 s) |
  | `bad-name` / `name-taken` | guest name invalid / in use | ask again |
  | `not-dm` | `dm` message without a DM login | DM page: back to its login |
  | `rejected` | a request that isn't allowed right now | show the message |
  | `server` | server bug | show the message |

## Logging in

Pages store things in `localStorage`: `hollia.session` (`{ token, name, activity, tool }`),
`hollia.key`, `hollia.guestName`, `hollia.dmKey`, `hollia.server` (the address as typed).

**Login page** (`index.html`, via `Hollia.login` in `client.js`): opens a socket just for this, sends

```
join { key, activity?, name?, bot? }
```

and gets one of:

| answer | meaning | next |
|---|---|---|
| `welcome {...}` | you're in (below) | save the session, go to `/tools/<activity.tool>/` |
| `choose { you: { name }, activities: [{ id, name }] }` | personal key, several activities open | `join` again with `activity` |
| `need-name { activity }` | a guest key (`activity` = its name) | `join` again with `name` (1-24 chars) |
| `dm-key {}` | the DM's key | save it as `hollia.dmKey`, go to `/dm/` |
| `error` | see the table above | |

`bot: true` marks a guest as a bot (simulated players): not logged, carries nothing.

**Tool pages** (`Hollia.connect`): open the socket and send `resume { token }` (the saved session).
Answer: `welcome`, or `error` `bad-token` / `closed`. On a dropped connection the page reconnects
(1 s, doubling to 8 s) and resumes again; every reconnect gets a fresh full `welcome`.

## welcome

The full state for this player, sent on every login, resume and DM reset of the activity.

```
welcome {
  protocol,                   the server's protocol version (see "Changing the protocol")
  token,                      session token (save it; resume with it)
  you: <player>,              yourself
  activity: { id, name, tool },
  players: [<player>],        everyone in the activity (yourself included)
  controls: <controls>,
  shared: <shared>,
  now,                        server clock (ms); pages keep the offset for timed things
  flags: [string],            your memory flags (world.* and character flags included)
  game: <game> | null,        a minigame you're in the middle of (refresh: carry on)
  items: <catalog>,           scenes tool only: the item catalog
  inv: <inv>,                 scenes tool only: your inventory
  place: <place>,             scenes tool only: stashes and shop stock where you are
  world: <world>              scenes tool only: the whole world (see "The world")
}
```

### Shapes

- **`<player>`**: `{ id, name, color, bot, guest, online, scene?, spot?, pos? }`. `scene` / `spot` /
  `pos` (where they are) are only there for players your character could see: you, anyone in your
  scene, anyone one exit away or in a view your scene shows (`remote`), and in a scene with
  positions only those on your position or one step from it. Everyone else's location stays secret.
- **`<controls>`**: `{ move, interact, pack }`, each true while the DM has frozen it
  (`pack`: inventory hidden).
- **`<shared>`**: activity-wide state, everything optional:
  - `flags: { "world.<fact>": true }` (also in everyone's `flags` list)
  - `roam: { <roamerId>: { stage, until?, heldBy? } }`: `stage` = index in the roamer's route,
    `until` = server ms when it flies home, `heldBy` = player id it's waiting for
  - `last: { <group>: sceneId }`: the last scene used in a remembering exclusive group (the spyglass)
  - `rounds: { <sceneId>: { n, endsAt, cast: [{ id, name }], answered: [playerId], log: [entry] } }`:
    timed rounds (the cave fight). `endsAt` = server ms or null. Log entries:
    `{ k: "round", n } | { k: "act", name, text } | { k: "idle", name } | { k: "dm", text }`
- **`<catalog>`**: `{ <itemId>: { name, w, h, kind, custom?, spell?, price, desc, art, hold } }`.
  `art` = SVG markup in a `w*32` by `h*32` box. `hold`: which hands it takes.
- **`<inv>`**: `{ coins, hands: { left?, right? } | { both }, bag: [<item>], overflow: [<item>], attuned: [id], lost: ["left"|"right"], flags: [string] }`.
  `<item>` = `{ id, item, at?: [x, y], turned? }` (`item` = catalog id; `at` only in the 3x3 bag).
- **`<place>`**: `{ scene, stashes: { <stashId>: { name, coins, items: [<item>] } }, stock: { <shopId>: { <itemId>: n } } }`.
  Stashes reachable from your scene right now; `stock` = limited shop items left.
- **`<game>`**: one of
  - `{ try: <try> }`: a timing minigame in progress
  - `{ try: <try>, pending: { result, at } }`: lost, waiting for the DM's verdict
  - `{ shells: <shells> }`: a shell game in progress
- **`<try>`**: `{ id, game, flavor, level, plan: { speed, moves: [{ at, len }], tell, strike, end } }`.
  Times in ms from the start. `flavor` picks the page's drawing (`games/<flavor>.js`).
- **`<shells>`**: `{ id, game, round, rounds, pot, stage: "pick"|"wait"|"won"|"over", pick: 0-2|null, canGoOn }`.

## The world

`welcome.world` is the activity's world file as JSON (functions dropped). The scenes engine draws
it; its full authoring format is `worlds/FORMAT.md` in the server repo. The page reads:

| key | used by | what |
|---|---|---|
| `meta` | engine | `viewBox`, `startScene`, `ambient`, `birds`, `moveSound`, `announceSound` |
| `scenes` | engine | every scene: art layers, hotspots, exits, spots, positions, narration, sounds |
| `dialogues` | engine | conversations (nodes, choices, conditions, actions) |
| `shops` | pack | what each shop sells and buys |
| `trades`, `heals` | engine | NPC trades and limb heals offered in dialogue |
| `roamers` | engine | roaming creatures (route, timings, lines) |
| `games` | game | minigames (kind, flavor, art, lines) |

Everything in `world` reaches every player's browser: anything secret in it can be read with the
browser's dev tools.

## Player messages (page -> server)

All need a session (`join` / `resume` first).

| message | answer | what |
|---|---|---|
| `move { scene, spot?, pos?, req? }` | `move-result { req, scene, spot, pos, error? }` | go somewhere. `pos` alone (same scene) = one step in a scene with positions. The answer says where you actually are (maybe not where you asked, e.g. the spyglass's remembered view). Without `req` (bots): `error` + `moved` on refusal. |
| `leave {}` | `players` to everyone | leave the activity for good (bots, guests) |
| `flag { set?, unset? }` | `flags` (to everyone if a `world.*` flag changed) | remember / forget facts. Names `[A-Za-z0-9_.:-]{1,48}`. |
| `inv { op, req, ... }` | `inv-result { req, ok?, error?, say?, first? }` | inventory action, see below |
| `trade { id, req }` | `trade-result { req, ok?, say?, error? }` | an NPC trade (`world.trades.<id>`) |
| `heal { id, limb, req }` | `heal-result { req, ok?, say?, error? }` | an NPC heal (`world.heals.<id>`); `limb`: `left` `right` `leftFoot` `rightFoot` |
| `roam { roamer, act?, req }` | `roam-result { req, ok?, say?, error? }` | a roamer. `act`: none = poke it on, `talk`, `feed`, `release` |
| `hold { spot, req }` | `hold-result { req, ok?, error? }` | claim a one-at-a-time hotspot in your scene |
| `hold { release: true }` | none | let go of everything you hold |
| `game { op, req, ... }` | `game-result { req, ... }` | minigames, see below |
| `answer { text }` | `shared` to everyone | your action for the running round (max 300 chars) |
| `did { kind: "click", hotspot, label }` / `did { kind: "choice", dialogue, node, text }` | none | for the play log only |

### inv ops

| op | fields | what |
|---|---|---|
| `move` | `id, to` | `to`: `{ bag: [x, y], turned? }`, `{ bag: "auto" }`, `{ hand: "left"\|"right"\|"both" }`, `{ place: "stash:<id>" }`. The item can be in a stash you can reach. |
| `coins` | `amount, to \| from` | `"stash:<id>"` |
| `find` | `hotspot` | pick up what a hotspot here holds |
| `putback` | `id` | throw an item back on a pile here |
| `offer` | `offering` | toss coins into `world.offerings.<id>` |
| `buy` | `shop, item` | |
| `sell` | `shop, id` | |

`first: true` on the answer = the first time this find was picked up.

### game ops

| op | fields | answer fields |
|---|---|---|
| `start` | `game` | `try, say?` (timing) or `shells, say?` (shell game) |
| `done` | `id, result: "win"\|"early"\|"late"` | `say?`, plus `pending` if the DM decides what a loss costs |
| `pick` | `id, shell: 0-2` | `shells, say?` (stage "wait": the DM marks it) |
| `next` | `id` | `shells, say?` (another round, puts in the ante) |
| `take` | `id` | `shells, say?` (pays the pot out, over) |

Any answer can be `{ req, error }` instead. The page judges the timing itself (it's among friends).

## Server messages (server -> page)

Pushed whenever something changes, besides the answers above.

| message | what |
|---|---|
| `players { players: [<player>] }` | the full player list, on every change (visibility as in `welcome`) |
| `controls { controls }` | the DM froze / unfroze something |
| `flags { flags }` | your flag list changed |
| `inv { inv }` | your inventory changed |
| `place { place }` | stashes / stock where you are changed (or you moved) |
| `items { items: <catalog> }` | the DM made a new item: the whole catalog |
| `shared { shared, now }` | activity-wide state changed |
| `moved { scene, pos?, message? }` | you were moved (by the DM), or (no `req`) your move was refused |
| `chance { scene, hit, say? }` | the roll for this visit to a scene with `chance` |
| `shells { shells, say, right? }` | the DM marked your shell pick, or called the game off |
| `game-verdict { text, choice }` | the DM settled your lost minigame; you're free again |
| `announce { text }` | a DM line for everyone (banner); `meta.announceSound` plays |
| `sound { src }` | play a clip (the DM's Hit button in a rounds scene) |
| `closed { message }` | you were removed (activity closed, access gone): forget the session, login page |
| `switch { activity, message }` | the DM is moving everyone to another activity: login page, which re-joins with `activity` |

## DM page

`/dm/` logs in on its own socket with the saved DM key:

```
dm-login { key }  ->  dm-welcome { protocol, you: { name } }, then dm-state, then dm-log
```

Then it sends `dm { do, activity?, ... }`. There's **no success answer**: the result shows in the
next `dm-state` (sent at most every 100 ms after any change). Failures come back as `error`
(`rejected`, `not-dm`).

| do | fields | what |
|---|---|---|
| `new-item` | `item: { name, w, h, desc?, color?, kind?, spell? }` | make a custom item (no `activity`). Also `dm-made-item { id, name }` to the DM, `items` to players. |
| `reset-characters` | | every character back to the starting kit (no `activity`) |
| `open` / `close` | | open or close the activity |
| `freeze` | `move?, interact?, pack?` (booleans) | freeze / unfreeze |
| `send-all` | | open it and move every roster player into it, at its start |
| `reset` | | the activity back to its start (inventories kept) |
| `flags` | `player?, set?, unset?` | one player's flags; no `player` = `world.*` flags only |
| `round` | `scene, op: start\|end\|say\|clear, seconds?, text?, hit?` | run timed rounds; `hit` plays the scene's hit sound |
| `announce` | `text` | a line for everyone (max 300 chars) |
| `game` | `player, choice: off\|affliction\|hand\|foot, name?, hand?, foot?, announce?` | settle a lost minigame |
| `shells` | `player, right` or `player, end: true` | mark a shell pick, or call the game off (coins back) |
| `limb` | `player, limb: left\|right\|leftFoot\|rightFoot, back?` | take a hand/foot, or give it back |
| `tool` | `action: { move: playerId\|"all", scene }` | scenes: move players (`scene` can be `"id@pos"`) |
| `inv` | `action` | edit an inventory or stash: `{ player \| place, give \| remove \| coins \| kit \| attune \| restoreHand \| restore \| empty, ... }` |

Server -> DM page:

| message | what |
|---|---|
| `dm-state { now, roster, items, activities }` | everything, on every change. `roster: [{ id, name, dm, color }]`; each activity: `{ id, name, tool, content, open, only, guestKey, controls, worldFlags, rounds, answers, players, places, ... }`, players with `flags`, `game`, `gameLevels`, `gameCoins`, `inv`; scenes activities add `scenes`, `toggles`, `roundScenes`, `games`, `shellsAnte`, `gameAnnounce`, `afflictions`, `announcements` (or `error` if the world failed to load). |
| `dm-log { entries }` | the last 500 play log entries, on login |
| `dm-log-entry { entry }` | each new log entry, live. Entries: `{ ts, ev, activity?, player?, name?, ... }` |

## Changing the protocol

- Any change to a message (new type, new or renamed field, changed meaning) updates this file in
  the same commit as the code.
- Bump the version when a change would break a page that's one version behind (a removed or
  renamed field, a changed meaning). Adding an optional field doesn't need a bump. The version
  lives in three places that must match: the top of this file, `PROTOCOL` in `client.js`, and
  `PROTOCOL` in the server (`server/activities.js`).
- **Mismatch handling.** The server sends its version in `welcome` and `dm-welcome`; pages compare
  (`Hollia.versionProblem` in `client.js`) and don't play on a mismatch:
  - server newer (the page is an old cached copy): "The game was updated. Refresh the page..."
    The login page shows it (code `outdated`); a tool page goes back to the login page, whose
    reload usually picks up the new files and logs straight back in.
  - server older or no version (not restarted yet): "The game is being updated. Try again in a
    minute." The login page keeps retrying every 4 s (code `updating`) until the server matches.
  - DM page: a toast and "Version mismatch" in its status; it keeps reconnecting.
- The front end (GitHub Pages) updates on push; the server updates when it restarts. Ship breaking
  changes to both together.
