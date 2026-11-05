# Testing

Three layers, cheapest first. The first two are automated; run them after every change. The third is
for what only a person can judge: how it looks, sounds and feels.

| | What | How long | Needs |
|---|---|---|---|
| `npm test` | Node unit tests (`tests/*.test.js`), Foundry stubbed | ~30 s | nothing |
| `npm run test:live` | Real flows in the test world (`livetestingenv`, or `hqtesting`), GM and player clients (`tests/live/`) | ~3 min | the world running, a claimed fpw lane |
| Look and listen | The short list at the end | as long as you like | a browser |

## 1. Unit tests: `npm test`

`node --test tests/`. The store runs as the host with a stand-in for Foundry (`tests/foundry-stub.js`);
players' requests arrive over a fake socket exactly as over the wire.

| File | Covers |
|---|---|
| `host.test.js` | The host's rules: who may send what, privacy (hidden caller ID, who receives a thread), money (double pay, overdraft), calls, groups, jobs, contacts, no signal, Communications off, share to chat |
| `model.test.js` | Data shapes and helpers: thread keys, sides, roles, money cards, wounds, home screen, skins, the clock |
| `ui.test.js` | Every `data-action` has one handler; templates and partials exist; what each page shows (GM Phone pickers, contact cards, dock, lock screen, split view, skins' extras, SIM tiles, redraw rules) |
| `apps.test.js` | Every app's model and host side (SAAI, Biomonitor, BangMe!, Trauma Team, Alex and Alex AI, WatchBox, The Garden and Dating, Notes, Calendar, Flappy Chrome, Combat Cabb, Achieve!, Gacha); the app folders (`apps/<id>/`) agree with the built lists (`npm run apps`), templates, styles and settings |
| `tools.test.js` | The dev tools: changelog fragments (`changes/`, `npm run changelog`) |
| `market.test.js`, `shop.test.js`, `cbk.test.js` | Great River (price cap or delivery fee, the drone), the shops' shared item/price rules (`model/shop.js`), CBK (presets, buying, receipts, booth pick-up, hand over, refund) |
| `storage.test.js` | The world data folder: split files, monthly tables, uploads only of changes, retries, never overwriting unreadable history, migrations |
| `api.test.js` | The macro API (`API.md`) |
| `director.test.js` | The GM Director: apps' `director.js` listed by `npm run apps`, the Dashboard's approvals, calls ringing on the Director, the call strip |
| `ncart.test.js`, `redline.test.js`, `breach.test.js`, `route.test.js` | The games' rules (fair chunks/tracks/grids, physics, boards, plausible scores) and road routing |
| `garden.test.js`, `garden-writer.test.js`, `garden-drafts.test.js` | The Garden clock (Garden time, backdating, growth, a fake Simple Calendar across month and year), the writer side (profiles, corps, formats, happenings, seeds, Stir), and the drafts (the garden-drafts v1 parser, the writer pack, inbox → approve → posts, replies and texts going out) |

## 2. Live suite: `npm run test:live`

Real clicks and typing on the real phones, through the foundry-playwright driver (fpw). The suite:

- uses your **lane's** clients: `ClaudeGMN` (GM Phone) and `ClaudePlayerN` (player, with the character fpw assigned it: `ClaudeN Solo` in hqtesting, a copied real character in livetestingenv; specs never rely on its name),
- takes the **active GM** for its run (`fpw gm claim`), so the lane GM is the phone's host, and always
  hands it back,
- fails a test on a thrown error **or any console error** in either client while it ran,
- screenshots both phones for every failure (`~/.claude/foundry-pw/shots/laneN/fail-*.png`),
- leaves its data in the test world (livetestingenv or hqtesting) with the `ClaudeN ` prefix (that world is messy on purpose).

```bash
fpw lane claim --module cpr-sam-agent --feature "..." --intent "..."   # first, as for any Foundry work
npm run test:live                        # everything
npm run test:live -- calls messages      # spec files whose name contains these
npm run test:live -- --grep "hidden"     # tests whose name matches
npm run test:live -- --bail              # stop at the first failure
npm run test:live -- --no-host           # don't take the active GM (when you already hold it)
npm run test:live -- --help              # usage; an unknown option or spec name is refused (exit 2 / error)
node tests/live/try.mjs pl 'await go("bangme"); return text(".agent-info")'   # poke a client with the helpers
```

| Spec | What it plays through |
|---|---|
| `startup` | Module and host up on both clients; every file in `module.json` served; every app that's on is on the phone and opens (player and GM Phone, Control included) |
| `messages` | New-text styles (Badge only, pop-up, Open the phone); typing and sending a reply; Viewed; reactions; hidden caller ID never reaching the player, then Reveal; PC to PC; deleting a conversation and its return; sharing to chat |
| `calls` | GM rings a player (pop-up with the phone away, the incoming screen with it open); Answer, Hang up and the "Call · m:ss" log; a player rings an NPC, the GM answers as them and ends it; Decline; the minimised call card; a second call ("Hang up and answer") |
| `money-jobs` | A bill paid once however fast it's tapped; declining; money held until Transfer; a hidden job, revealed with a notice that opens it; a job offered in a text and accepted |
| `control` | No signal (status bar, Send off, texts held, the restored pop-up); Jobs off and on; blocking; texts only; a contact request approved |
| `apps` | Agent alert answered (with its tag); Ask Alex; The Garden (GM post in the feed, player post); Trauma Team panic → Dispatch → countdown; WatchBox arm → armed → alarm → disarm; Notes; Calendar; a BangMe! pay point; Gacha buy and pull; Achieve! award; a Combat Cabb booking and cancel |
| `games` | Flappy Chrome, NCART Runner, REDLINE (Quick Race, pause, end) and BREACH practice: start, run, end, no errors |
| `pool` | App Store: Installed rows readable; uninstall, Featured lists it again, free reinstall; Subscribe → the GM's bill → lapse (the lock screen) → Renew → Cancel; a Fixer's sideloaded package paid in a conversation. The fixtures give the lane's PCs every app while the App Store is on |
| `host` | Texts survive the host reloading; the player is served again afterwards |
| `market` | Great River (NC Market until 2026-10-21): order → GM approve → in the gear; price on request; Setup; Featured and Hot Deals; GM Shop hide/unavailable; typed quantity and Re-order; delivery fee + drone + Deliver now |
| `cbk` | CBK: Searching for database until GO LIVE; categories → listing → BUY NOW!!! (charged, receipt, sold out); pick-up at the booth puts it in the gear; a market from Black Chrome's preset C |
| `bezel` | The phone's hardware: LED, earpiece and camera in the header; the window rings with an incoming call, glows on the call, goes dark after; the LED shows unread texts and goes out with the last of them |
| `garden` | The Garden clock with Simple Calendar (dates across a month and a year boundary; a +2h skip lets queued posts out backdated; System time and back keeps the order); Log an event + Stir at the table; the Writer tab; a player opening the Garden noted for the writer, with nothing of the writer's reaching them. Moves world time and puts it back |
| `garden-drafts` | A garden-drafts v1 batch written into the world's inbox over the server folder → the Drafts tab (count, mix bar, badges) → cut one, Approve → the due post and its reply backdated, the later post queued, a private text received, a Dating profile; the writer pack saved |

**Writing a spec.** A `tests/live/<name>.live.mjs` file calls `test(name, async ctx => …)` from
`lib.mjs`. `ctx` has `gm`, `pl`, `pc` / `other` (the lane's two PCs), `npc`, `contact`, `prefix` and a
per-run `tag`. `await pl.run(fn, args)` runs `fn(args)` inside the player's page with the helpers in
scope (`go(app)`, `tap(sel)`, `fill`, `choose`, `dialog`/`inDialog`/`press`, `until`, `el`/`els`/`text`,
`phone`/`closePhone`, `api`, `store`, `AgentPhone`; see `lib.mjs`). Return plain JSON. Drive the UI the
way a player would (taps on `data-action` controls), check the result on the other side, and put
anything a test switches off back in a `finally`. Lessons so far: wait for the page you're about to
tap to be drawn (a control found mid-redraw is replaced under the click); `innerText` follows CSS
`text-transform`, so compare text case-insensitively; give each run its own names where an earlier
run's leftovers would change the outcome.

**Not automated yet** (good next specs): group chats and group calls with several NPCs; services
(request buttons, phone lines, billing); the GM Phone's pickers, SIM tiles and "act as" token strip;
contact cards (rename, notes); attachments (map pins, photos, a player's photo upload); BangMe! Bang
between two PCs within 20 m, anchored pay points and goods; Trauma Team billing on world time and the
Biomonitor; Alex rolls and Data Pool answers; Garden queue, Dating and Reputation; Achieve! trade-ins and
Mystery Boxes; Gacha selling and giving; a real BREACH run (GM approval, roll); REDLINE set tracks,
ghosts and the board; Map routes; Control's Clock, Clear app data and phone wipe; the Agent Monitor and
Jobs popout; a second player client (privacy across players).

## 3. Look and listen

What a script can't judge. Go through the parts you changed; the whole list before a release.

- **Skins:** every skin (Settings → Skin, and the Neuron HUD on an Internal Agent) reads well: the inbox, a
  conversation with a money card and a photo, a group with several NPCs, a contact card, a call and the
  call bar, a dropdown (it opens upwards near the bottom), Control, the lock screen. Also at 150 % text
  size, and the skins' extras (Segotari type-out, Field Med vitals, the Neuron HUD's opacity, a
  Sponsored Cybereye's ads).
- **Windows:** in Chrome or Edge on Windows the phone's dropdowns are readable.
- **Sound:** text tone and ringtone heard near the ringing token, not twice by its owner; silent mode
  mutes; no tones while a character has no signal (an Agent alert or a Bang still speaks); WatchBox's
  alarm at the phone's spot; the games' sounds and music.
- **Hands on:** drag and resize the phone (the grip bar is never covered); drag a phone wider than
  600 px for the split view; drag the minimised call card and double-click it home; drag actors onto
  the GM Phone and the Contacts manager; reorder home-screen tiles.
- **Dice:** the sheet rolls with Dice So Nice for REDLINE's grid, Ask Alex's Library Search and BREACH's
  Backdoor, and play waits for the dice.
- **Games feel:** Flappy Chrome, NCART Runner and REDLINE play smoothly at full size; controls respond;
  initials entry on a board score; BREACH's timer and daemons light up.
- **Map:** the Map app and NAV scene: pins, the lens, routes drawn on the roads, the crew's marker.
- **Blood:** Control → Blood → Preview, and a PC below half HP gets it on their phone only.
- **Time:** Control → Clock (system, another date, set by the GM, Simple Calendar) shows on every phone.
