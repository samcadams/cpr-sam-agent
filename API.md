# Functional Agent: macro API

Everything the GM Phone does on cue — a fixer texting when the crew leaves the bar, a dead zone in
the Combat Zone, a news post when the bomb goes off — can be done from a macro, a Monk's Active
Tiles action, or another module.

```js
const agent = game.modules.get("cpr-sam-agent").api;
await agent.text({ to: "V", from: "Rogue", text: "Afterlife. Now." });
```

The API is there once Foundry is `ready`. Other modules can wait for it:

```js
Hooks.once("cpr-sam-agent.ready", agent => { /* … */ });
```

## How it works

- **Characters** can be given as an Actor, a Token (or TokenDocument), an actor id, a UUID, or a
  name (the sheet's or its token's). Where it says *character(s)*, a list works too.
- **Contacts** (`from`) are a name, as on the character's contact list. A name they don't have yet
  becomes a new contact, just like typing a new name on the GM Phone. An NPC's Actor works too (its
  token name is used).
- **GMs only:** everything that changes something is for GMs, as on the GM Phone. A player running
  it gets an error. Reading (`hasSignal`, `feature`, `trauma.covered`, `watchbox.status`, …) works
  for anyone, for what their client can see.
- **Promises:** calls that change things return a promise. On the active GM's client it resolves
  once the change is made, so the next line sees it. On another GM's client it resolves once the
  change is sent to the active GM.
- **Errors** say what's wrong (`cpr-sam-agent | No Garden account "@nobody".`). A macro that doesn't
  catch them shows them in the console.
- **Switches are respected:** while Communications are off, texts and calls are dropped; while Jobs
  are off, offers can't be made. A character with no signal gets texts later, when service returns.
- An actor with no Agent (or Internal Agent) can't use the phone; texts to them are still saved.

## Communications

### `text({ to, from, text, image?, hidden? })`

Text a character from a contact.

| | |
|---|---|
| `to` | character |
| `from` | contact name, or an NPC's Actor |
| `text` | the message |
| `image` | optional: a server path or `https://` link to a picture |
| `hidden` | `true` texts from an Unknown Number (reveal it later on the GM Phone) |

### `call({ to, from, hidden? })`

Ring a character's Agent from a contact. Answer it on the GM Phone as usual.

### `endCalls({ to? })`

End every call a character is on, or every call if `to` is left out. Returns how many ended.

### `addContact({ to, name?, actor?, img? })`

Give one or more characters a contact (characters who already have it are left alone). With `actor`
(an NPC's sheet) the contact is linked to it and uses its name and picture unless you give others.

### `openConversation({ to, from, hidden? })`

Open the GM Phone on a character's conversation with a contact (it must exist already).

## Agent alerts

### `alert({ to, text, choices?, kind?, tag? })`

An alert from the character's own Agent, like the GM Phone's Agent app.

| | |
|---|---|
| `to` | character(s) |
| `text` | the alert |
| `choices` | up to three answer buttons, e.g. `["Yes", "No"]` |
| `kind` | `advice` (default), `reminder`, `event`, `warning`, `biometric`, `money`, `trauma`, `garden`, `alex`, `ncpd`, `raid` (CBK's full-screen raid warning: no choices shown), `system` |
| `tag` | your own label, returned with the answer (below) |

When a player answers, the GM still gets the usual card, and the active GM's client calls the hook
**`cpr-sam-agent.alertAnswered`** with
`{ alertId, actorId, choice, text, tag, userId }`. See the recipe below.

## Signal and Control's switches

### `hasSignal(character)` → `boolean`

### `setSignal(characters, on)`

Switch cellular service off (`false`) or back on (`true`), as Control → Characters does. Texts sent
while it's off wait until it's back.

### `feature(name)` → `boolean` and `setFeature(name, on)`

Control's switches: `comms` (Contacts, Messages and Calls together), `jobs`, `jobsAvailable`,
`locations`, `images`, `playerImages`, `freeInternal`, `blood`, and the apps: `app_agent`,
`app_garden`, `app_alex`, `app_bangme`, `app_trauma`, `app_watchbox`.

## Money (`money.*`)

### `money.request({ to, from? | service?, amount, note? })`

Ask a character to pay, from a contact (`from`) or a service (`service`: its name or id, set up in
the GM Phone's Contacts app). They pay from the conversation.

### `money.send({ to, from? | service?, amount, note? })`

Send a character eurobucks from a contact or service. If the contact is linked to a sheet with a
wallet, it comes out of that sheet. The character Transfers it in from the conversation or BangMe!.

### `money.adjust({ actor, amount, memo? })`

Add to (positive) or take from (negative) a character's wallet directly, with a line in BangMe!'s
ledger ("Eurobank"). Taking more than they have is refused.

### `money.invoice({ to, from, amount, memo?, tag? })`

Send a character a BangMe! invoice under any name (`from`). Nothing moves until they pay; they answer on
their Agent or in BangMe!, and the GM can cancel it there. Throws if `money.canInvoice` says no. `tag` (up to
100 characters) is your own label: it comes back with the `invoiceSettled` hook and `money.invoices`.

### `money.canInvoice(actor)` → boolean

BangMe! is on in Control and the character has a wallet and an Agent. They don't need BangMe! installed yet:
the Agent tells them to install it, and the invoice waits.

### `money.invoices({ tag? })` → `[{ id, actorId, from, amount, memo, status, tag }]`

The invoices sent to characters, newest first. `status`: `pending`, `paid`, `declined` or `cancelled`. GM only.

## Jobs (`jobs.*`)

### `jobs.save({ id?, name?, description?, img?, status?, hidden? })` → job id

Without `id`, makes a new job (hidden and Available unless you say otherwise) and returns its id.
With `id`, changes only the fields you give. `status`: `available`, `active` (In Progress),
`completed` or `failed`. Revealing a job, or changing a visible job's status, notifies players as
the Jobs app does.

### `jobs.offer({ job, to, from, text? })`

Offer a job (id or name) in a text from a contact. The player accepts or declines in the
conversation, and accepting reveals it and starts it.

### `jobs.setStatus(job, status, { reveal? })`

Shorthand for `jobs.save` with a new status. `reveal: true` also shows a hidden job.

## The Garden (`garden.*`)

### `garden.post({ as, text, image?, outcome?, delay?, rep? })`

Post as an account: a handle (`"@network54"`), an account id, or `"@random"` (a random citizen).

| | |
|---|---|
| `outcome` | one of the Garden's outcomes, by id or name (random if left out) |
| `delay` | in-game minutes from now (the Garden clock: world time when the phones follow it, else real time): it joins the queue instead of posting at once |
| `rep` | a Reputation event: `{ actor, delta, reason }`, or a list of them |

### `garden.queue(lines, { as?, every?, jitter? })`

Queue posts, exactly like the Queue posts dialog: a string with one post per line, or a list of
lines, each `text`, `text | picture`, or `@handle | text | picture | outcome`. Lines without a
handle post `as` (default `"@random"`). One goes out every `every` in-game minutes (default 5), give or take
`jitter`.

### `garden.pause()` / `garden.resume()`

Pause or resume the queue's clock.

### `garden.accounts()` → `[{ id, handle, name, kind, followers, actorId }]`

### `garden.logEvent({ what?, place?, who?, heat?, public?, keywords?, note?, stir?, thing? })`

Log a happening for the Garden's writer (the `garden-writer` skill). With no `what`, it opens the
**Log an event** pop-up (place and who prefilled from the active scene), the one the hotbar macro
opens (Garden → Writer → "Put Log an event on my hotbar"). Otherwise it's logged at once:

| | |
|---|---|
| `what` | one line: what happened |
| `place` | where |
| `who` | characters involved (Actor, id or name; a list) |
| `heat` | `small`, `local` (default), `big` or `citywide`: how far word travels |
| `public` | `false`: background only; the writer never states it |
| `keywords`, `note` | keywords (a list or "a, b"), and a note to the writer |
| `stir` | instant chatter from the Stir reactions word lists, over the next in-game hour (and the next real minutes) |
| `thing` | what the chatter calls it ("the shootout") |

### `garden.plantSeed({ what?, keywords?, obvious?, by?, sources? })`

Something the writer should get the city talking about before it matters. No `what`: the pop-up's
**Plant a seed** tab. `obvious`: `subtle` (default) or `clear`; `by`: in-game seconds from now (or
none); `sources`: accounts (handles) who should say it.

## Trauma Team (`trauma.*`)

### `trauma.grant({ actor, plan, sponsor? })`

Give a character a plan (its name or id, e.g. `"Executive"`), paid for by `sponsor` (never billed).

### `trauma.revoke(actor)`

End their coverage.

### `trauma.dispatch(actor, { reason? })`

Open a Trauma Team call for the character, as if they'd pressed the panic button. The GM gets the
dispatch card. Only one open call per character.

### `trauma.covered(actor)` → `boolean`

### `trauma.status(actor)` → subscription

A copy of a character's coverage (a player's client sees only their own characters'):

| | |
|---|---|
| `status` | `"none"`, `"active"` or `"lapsed"` (a billed plan they couldn't pay) |
| `covered` | `true` while the plan is active and still exists |
| `plan` | `{ id, name, price, days, execRank, note }`, or `null` |
| `memberId` | e.g. `"TT-4821-0937"` |
| `sponsor` | who pays for it (never billed), or `null` (billed every `plan.days` days) |
| `auto` | `true` for an Exec's corporate plan given by their Teamwork rank |
| `since`, `nextDue` | world time in seconds; `nextDue` is `null` when it's never billed |
| `biolink`, `noAds` | the player's switches: Biomonitor linked, no sales offers |
| `billedBy` | the module billing paid plans instead of the Agent (see `handOffBilling`), or `null` |

### `trauma.plans()` → `[{ id, name, price, days, execRank, note }]`

### `trauma.update({ actor, plan?, status?, sponsor?, nextDue?, biolink?, noAds?, notify? })`

Change a character's coverage. Only what you give changes, and nothing is charged (use
`money.adjust` for that).

| | |
|---|---|
| `plan` | a plan's id or name; `null` for none |
| `status` | `"active"`, `"lapsed"` or `"none"` (ends it, keeping the player's switches) |
| `sponsor` | a name: never billed. `null`: billed, next due a period from now unless `nextDue` says |
| `nextDue` | when it's next billed, in world time (seconds) |
| `biolink`, `noAds` | the player's switches (`biolink` needs a Biomonitor) |
| `notify` | text for an Agent alert from Trauma Team International; silent without it |

### `trauma.handOffBilling(by)` and `trauma.billedBy()` → `string | null`

Let another module bill Trauma Team, e.g. `"CPR HQ"` with its Lifestyle bill. While it's set, the Agent
charges nothing: no monthly bills, no charge when a player subscribes on their phone, and paid plans
don't lapse on their own. The GM Phone's Trauma Team app says who bills instead. Call it on every client
each session, e.g. in the `cpr-sam-agent.ready` hook; `handOffBilling(null)` hands billing back (paid
plans are then next billed a period later). `trauma.status` reports it as `billedBy`.

Every change, from the phones or from here, calls the **`cpr-sam-agent.traumaChanged`** hook on each
client that can see it, with `{ actorId, ...status }` (the same fields as `trauma.status`).

## App Store (`pool.*`)

While the App Store app (id `pool`) is switched on in Control, each character's phone shows only the
apps installed on it: the preinstalled ones, and what they get from the store. With it off, every app switched on in Control is on every phone. `app` is an app id
(`"cabb"`, `"watchbox"`, `"breach"`…; see `scripts/apps/manifest.js`). `has`, `grant` and `revoke` also take an
add-on (`"bigsaai"`, Ask Alex's Big SAAI: `ADDONS` in `apps/pool/model.js`), which counts whether or not the App Store is on.

### `pool.on()` → `boolean`

### `pool.installed(actor)` → `[appId]`

The apps on the character's Agent (every app that's switched on, while the App Store is off).

### `pool.has(actor, app)` → `boolean`

Installed and not locked by a lapsed subscription. For an add-on: bought or granted, and not revoked.

### `pool.grant({ actor, app })`

GM: install an app on a character's Agent, free. It lifts a revoke and ends a subscription to it.

### `pool.revoke({ actor, app, reason?, refund? })`

GM: take an app off a character's Agent; the player is told `reason` ("Bricked by a virus").
`refund: true` pays back what they paid for it. A revoked app can't be reinstalled until it's granted.

### `pool.sideload({ actor, app, price?, from?, note? })`

GM: a Fixer's app package in the conversation with `from` (a contact name, default "Fixer"; created if
needed). With a `price` it comes with a money request, and paying it installs the app; free, the player
taps Install.

## Subscriptions (`subscriptions.*`)

Monthly App Store apps. Nothing is charged by itself: subscribing on the phone pays the first month, and the
GM sends later months from the GM Phone's App Store page, unless another module bills them.

### `subscriptions.state(actor)` → `{ items, total, billedBy }`

`items`: `[{ app, name, price, status: "active" | "lapsed", since, paidThrough, sponsor }]`; `total`: a
month of the active ones nobody sponsors; `billedBy`: see below.

### `subscriptions.handOffBilling(by)` and `subscriptions.billedBy()` → `string | null`

Bill subscriptions yourself, as with Trauma Team (e.g. `"CPR HQ"` with its Lifestyle bill). While it's
set, subscribing charges nothing, the App Store's own bill is off and nothing lapses on its own; the phone
says "Billed with your monthly CPR HQ bill". Call it on every client each session; `null` hands it back.

### `subscriptions.update({ actor, app, status?, sponsor?, notify? })`

GM: `status` `"active"`, `"lapsed"` (the app stays installed, locked behind Renew) or `"cancelled"`
(uninstalled); `sponsor` a name (never billed) or `null`; `notify` an Agent alert from the App Store.

### `subscriptions.bill(actor, { all? })`

GM: the App Store's own bill, one BangMe! payment itemised in the receipt: the subscriptions whose month ran
out, or `all` the active ones. If they can't pay, those lapse. Does nothing while another module bills.

Every change calls the **`cpr-sam-agent.subscriptionsChanged`** hook on each client that can see it,
with `{ actorId, ...subscriptions.state }`.

## WatchBox (`watchbox.*`)

### `watchbox.status(actor)` → `"off" | "assessing" | "armed" | "alarm"`

### `watchbox.trigger(actor)`

Set off a character's armed WatchBox (the alarm sounds at the phone). It must be armed first.

## DataPool (`screamsheet.*`)

The screamsheet reader (app id `screamsheet`): each character's Agent crawls the Data Pool for clippings that
mention them (their name, Garden handle, aliases, crews and the terms they add). A clipping's `dv` is how deep
it's buried: 0 (a Headline, the daily crawl finds it), 13 Buried, 15 Deep, 17 Ghost (a deep crawl's Library
Search must reach it). `reach: "subjects"` keeps it to its subjects and their crews.

### `screamsheet.publish({ headline, body?, outlet?, byline?, image?, subjects?, tags?, dv?, reach?, spin?, rep?, hours?, draft?, title? })` → clipping id

GM. A plain sheet (headline, byline, the body as paragraphs, an optional image). `outlet`: `n54`, `wns`
(default), `street`, `board` (a Data Pool board), `blotter`, `custom`. `subjects`: characters it's about
(always pulled by them). `rep`: `{ actor, delta, reason }` or a list, put on the sheets when it goes out.
`hours`: world time from now; `draft: true` leaves it on the GM's desk.

### `screamsheet.drafts()` → `[clipping]`

GM. The desk's drafts (yours, macros', and the suggested ones from Reputation events, viral Garden posts and
journal entries).

### `screamsheet.pulled(character)` → `[clipping]`

The clippings a character's Agent has pulled (what this client can see).

### `screamsheet.crawl(character?, { roll? })`

GM. Crawl now: without `roll`, the passive crawl (Headlines that match) for one character or everyone; with
`roll`, a deep crawl for that character taken as is (everything matching up to that DV).

## Phones (`phone.*`)

### `phone.open()`, `phone.close()`, `phone.toggle()`

This user's phone: the GM Phone for a GM, otherwise the player's Agent (for their selected token
or assigned character).

## Map (`map.*`)

A *place* is a spot on the NAV scene, as Messages shares it: `{ sceneId?, noteId?, x?, y?, label? }` (`x`, `y` in
scene px; with `noteId` the pin's own spot is used). Only places on the Map's scene (Combat Cabb's NAV scene, or the
scene named NAV) can be shown.

### `map.open(place)` → `Promise<boolean>`

Opens this user's phone on the Map at the place: a pin they can see is picked (its card opens), anything else gets a
marker. `false` when the Map can't show it (the Map isn't on their phone, another scene): the scene itself is
opened instead, as before.

### `map.embed(element, place, { onOpen?, route? })` → `{ map, destroy() } | null`

Draws a small map of the place into `element` (emptied): the districts around it and the pin (or a marker), fixed
(it doesn't pan or zoom, so it never catches the page's scroll). A tap opens the Map there (`onOpen(place)` to do
something else). `route: { points: [x0, y0, …] }` draws a line on it (scene px). `null` when it can't be shown.
Call `destroy()` before throwing the element away. Inside the phone, a template can simply emit
`<div class="agent-mapembed" data-scene-id data-note-id data-x data-y data-label></div>`: every phone redraw fills
those, and a tap opens the Map on that phone.

### `map.canShow(place)` → `boolean`

## Director (`director.*`)

The GM's wide control window (tabs: Dashboard, Comms; more to come). Its button sits beside the GM
Phone's; a key can open it too (Configure Controls → "Director (GM)", unbound at first). While it's open,
calls ring on it instead of the GM Phone (client setting "Calls ring on the Director", on by default).

### `director.open()`, `director.close()`, `director.toggle()`

GM only.

### `director.detach()`

GM only, with the Director open. Moves it into its own browser window (for a second monitor); closing
that window docks it back. Browsers only allow this from a click (a macro button counts).

## Agent Monitor (`monitor.*`)

The GM's see-through window of every player character's Agent: whether it's out, the app and
screen its player is on, whether they're typing, their last few actions, and the GM's own news
(signal, silent, calls, rides, WatchBox, Trauma Team, unread), with a button per phone to cut or restore its signal. The GM opens it from the binoculars
in the GM Phone's header, or a key (Configure Controls → "Agent Monitor (GM)", unbound at first).
Players' clients report straight to the GMs; nothing is saved.

### `monitor.open()`, `monitor.close()`, `monitor.toggle()`

GM only.

### `monitor.activity()` → `{ [userId]: { report, log } }`

GM only. What each player's client last reported. `report`: `{ actorId, actorName, agent, open,
minimized, locked, app, appName, icon, screen, typing, since, ts }`; `log`: `[{ id, text, ts, actorId }]`,
newest last (the last 12). Dismissing lines in the monitor only hides them on that GM's screen.

### `monitor.note(text)`

On a player's client: add a line to the GM's log for what they're doing (e.g. from another
module's own Agent feature). Does nothing on a GM's client.

### `monitor.registerScreen(appId, fn)`

On every client: the line the monitor shows for an app's screen. `fn(phone, ctx)` runs on the
player's client with their phone (its page state, e.g. `phone.view`, `phone.questId`) and returns a
string, or null for just the app's name. Replaces the built-in line for that app.

## Other

### `characters()` → `[{ id, name }]`

Every player character.

### `version`

The API's version: `1`. It goes up only when something here changes in a way old macros would
notice.

`store` and `AgentPhone` are also on the API object for debugging. They're the module's internals,
not part of the API, and change between versions.

## Hooks

| Hook | Where | Arguments |
|---|---|---|
| `cpr-sam-agent.ready` | every client | `api` |
| `cpr-sam-agent.alertAnswered` | the active GM's client | `{ alertId, actorId, choice, text, tag, userId }` |
| `cpr-sam-agent.invoiceSettled` | the active GM's client | `{ invoiceId, status, actorId, amount, memo, tag, userId }`: an invoice was paid, declined or cancelled (`actorId`: the payer, null if that's the GM) |
| `cpr-sam-agent.received` | each client a new text reaches (not the sender's) | `thread`, `message` |
| `cpr-sam-agent.traumaChanged` | each client that can see the character's coverage | `{ actorId, ...trauma.status }` |
| `cpr-sam-agent.subscriptionsChanged` | each client that can see the character's apps | `{ actorId, ...subscriptions.state }` |
| `cpr-sam-agent.screamPublished` | the active GM's client | `clipping`: a DataPool clipping that just went out |
| `cpr-sam-agent.request` | the client that sent it | `type`, `data`: a request the phone (or API) just sent the host |
| `cpr-sam-agent.screen` | the client whose phone it is | `phone`: its page changed without a redraw (tells the Agent Monitor) |
| `cpr-sam-agent.input` | the client whose phone it is | `phone`: its page took input outside the phone's window (a game's keys); keeps the phone from going idle |
| `cpr-sam-agent.activity` | GM clients | `{ userId, report, did }`: a player's Agent Monitor report, or `did` (`{ id, text, ts, actorId }`) |

For `received`, `thread.actorId` is the character's id and `thread.contact` the contact's name (in a
one-to-one conversation); `message.text` is the text and `message.from` is `"pc"` when the
character wrote it. On the GM's client it fires for texts players send.

## Recipes

**A fixer texts the selected token's character** (`token` is the selected token in a hotbar macro;
a trigger module that runs macros may pass the triggering token another way):

```js
const agent = game.modules.get("cpr-sam-agent").api;
await agent.text({ to: token, from: "Rogue", text: "Saw you walk in. Back booth." });
```

**Dead zone:** cut everyone's signal, and bring it back later.

```js
const agent = game.modules.get("cpr-sam-agent").api;
const crew = agent.characters().map(c => c.id);
await agent.setSignal(crew, false);
// … later
await agent.setSignal(crew, true);
```

**Ask the crew, and act on the answer:**

```js
const agent = game.modules.get("cpr-sam-agent").api;
await agent.alert({ to: "V", kind: "warning", text: "Unknown AV approaching. Reroute?", choices: ["Reroute", "Hold"], tag: "av-reroute" });

// In a world script or a macro run once per session:
Hooks.on("cpr-sam-agent.alertAnswered", ({ tag, choice, actorId }) => {
  if (tag !== "av-reroute") return;
  ChatMessage.create({ content: `${game.actors.get(actorId).name} chose to ${choice.toLowerCase()}.` });
});
```

**News for the job the crew just finished,** with Reputation for each of them:

```js
const agent = game.modules.get("cpr-sam-agent").api;
await agent.garden.post({
  as: "@network54", text: "Shootout at the Arasaka docks leaves three dead.", outcome: "Viral",
  rep: [{ actor: "V", delta: 1, reason: "Arasaka docks" }, { actor: "Judy", delta: 1, reason: "Arasaka docks" }]
});
await agent.garden.queue(["anyone else hear that?", "the docks are crawling with NCPD", "@network54 | Update: suspects fled north"], { every: 3, jitter: 1 });
```

**Prep and offer a job:**

```js
const agent = game.modules.get("cpr-sam-agent").api;
const job = await agent.jobs.save({ name: "Totentanz", description: "Get Rogue's package out of Totentanz.\nPay: 2000eb each." });
await agent.jobs.offer({ job, to: "V", from: "Rogue", text: "Got something for you." });
```

**Bill for a ride, then pay the crew:**

```js
const agent = game.modules.get("cpr-sam-agent").api;
await agent.money.request({ to: "V", from: "Delamain", amount: 50, note: "Ride to Watson" });
for (const { id } of agent.characters()) await agent.money.send({ to: id, from: "Rogue", amount: 2000, note: "Totentanz" });
```

**Another module follows Trauma Team coverage** (e.g. an HQ's medbay that only helps the uncovered):

```js
Hooks.once("cpr-sam-agent.ready", agent => {
  for (const { id, name } of agent.characters()) console.log(name, agent.trauma.status(id).status);
  Hooks.on("cpr-sam-agent.traumaChanged", ({ actorId, status, plan }) => {
    console.log(game.actors.get(actorId).name, status, plan?.name);
  });
});

// GM: the crew's corp picks up the bill, then the deal falls through and V pays from next month.
const agent = game.modules.get("cpr-sam-agent").api;
await agent.trauma.update({ actor: "V", plan: "Silver", status: "active", sponsor: "Arasaka", notify: "Silver coverage, courtesy of Arasaka." });
await agent.trauma.update({ actor: "V", sponsor: null, nextDue: game.time.worldTime + 30 * 86400 });
```
