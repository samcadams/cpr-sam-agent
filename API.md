# Functional Agent: macro API

Everything the GM Phone does on cue — a fixer texting when the crew leaves the bar, a dead zone in
the Combat Zone, a news post when the bomb goes off — can be done from a macro, a Monk's Active
Tiles action, or another module.

```js
const agent = game.modules.get("cpr-slopagent").api;
await agent.text({ to: "V", from: "Rogue", text: "Afterlife. Now." });
```

The API is there once Foundry is `ready`. Other modules can wait for it:

```js
Hooks.once("cpr-slopagent.ready", agent => { /* … */ });
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
- **Errors** say what's wrong (`cpr-slopagent | No Garden account "@nobody".`). A macro that doesn't
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
| `kind` | `advice` (default), `reminder`, `event`, `warning`, `biometric`, `money`, `trauma`, `garden`, `alex`, `system` |
| `tag` | your own label, returned with the answer (below) |

When a player answers, the GM still gets the usual card, and the active GM's client calls the hook
**`cpr-slopagent.alertAnswered`** with
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
| `delay` | minutes from now: it joins the queue instead of posting at once |
| `rep` | a Reputation event: `{ actor, delta, reason }`, or a list of them |

### `garden.queue(lines, { as?, every?, jitter? })`

Queue posts, exactly like the Queue posts dialog: a string with one post per line, or a list of
lines, each `text`, `text | picture`, or `@handle | text | picture | outcome`. Lines without a
handle post `as` (default `"@random"`). One goes out every `every` minutes (default 5), give or take
`jitter`.

### `garden.pause()` / `garden.resume()`

Pause or resume the queue's clock.

### `garden.accounts()` → `[{ id, handle, name, kind, followers, actorId }]`

## Trauma Team (`trauma.*`)

### `trauma.grant({ actor, plan, sponsor? })`

Give a character a plan (its name or id, e.g. `"Executive"`), paid for by `sponsor` (never billed).

### `trauma.revoke(actor)`

End their coverage.

### `trauma.dispatch(actor, { reason? })`

Open a Trauma Team call for the character, as if they'd pressed the panic button. The GM gets the
dispatch card. Only one open call per character.

### `trauma.covered(actor)` → `boolean`

## WatchBox (`watchbox.*`)

### `watchbox.status(actor)` → `"off" | "assessing" | "armed" | "alarm"`

### `watchbox.trigger(actor)`

Set off a character's armed WatchBox (the alarm sounds at the phone). It must be armed first.

## Phones (`phone.*`)

### `phone.open()`, `phone.close()`, `phone.toggle()`

This user's phone: the GM Phone for a GM, otherwise the player's Agent (for their selected token
or assigned character).

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
| `cpr-slopagent.ready` | every client | `api` |
| `cpr-slopagent.alertAnswered` | the active GM's client | `{ alertId, actorId, choice, text, tag, userId }` |
| `cpr-slopagent.received` | each client a new text reaches (not the sender's) | `thread`, `message` |

For `received`, `thread.actorId` is the character's id and `thread.contact` the contact's name (in a
one-to-one conversation); `message.text` is the text and `message.from` is `"pc"` when the
character wrote it. On the GM's client it fires for texts players send.

## Recipes

**A fixer texts the selected token's character** (`token` is the selected token in a hotbar macro;
a trigger module that runs macros may pass the triggering token another way):

```js
const agent = game.modules.get("cpr-slopagent").api;
await agent.text({ to: token, from: "Rogue", text: "Saw you walk in. Back booth." });
```

**Dead zone:** cut everyone's signal, and bring it back later.

```js
const agent = game.modules.get("cpr-slopagent").api;
const crew = agent.characters().map(c => c.id);
await agent.setSignal(crew, false);
// … later
await agent.setSignal(crew, true);
```

**Ask the crew, and act on the answer:**

```js
const agent = game.modules.get("cpr-slopagent").api;
await agent.alert({ to: "V", kind: "warning", text: "Unknown AV approaching. Reroute?", choices: ["Reroute", "Hold"], tag: "av-reroute" });

// In a world script or a macro run once per session:
Hooks.on("cpr-slopagent.alertAnswered", ({ tag, choice, actorId }) => {
  if (tag !== "av-reroute") return;
  ChatMessage.create({ content: `${game.actors.get(actorId).name} chose to ${choice.toLowerCase()}.` });
});
```

**News for the job the crew just finished,** with Reputation for each of them:

```js
const agent = game.modules.get("cpr-slopagent").api;
await agent.garden.post({
  as: "@network54", text: "Shootout at the Arasaka docks leaves three dead.", outcome: "Viral",
  rep: [{ actor: "V", delta: 1, reason: "Arasaka docks" }, { actor: "Judy", delta: 1, reason: "Arasaka docks" }]
});
await agent.garden.queue(["anyone else hear that?", "the docks are crawling with NCPD", "@network54 | Update: suspects fled north"], { every: 3, jitter: 1 });
```

**Prep and offer a job:**

```js
const agent = game.modules.get("cpr-slopagent").api;
const job = await agent.jobs.save({ name: "Totentanz", description: "Get Rogue's package out of Totentanz.\nPay: 2000eb each." });
await agent.jobs.offer({ job, to: "V", from: "Rogue", text: "Got something for you." });
```

**Bill for a ride, then pay the crew:**

```js
const agent = game.modules.get("cpr-slopagent").api;
await agent.money.request({ to: "V", from: "Delamain", amount: 50, note: "Ride to Watson" });
for (const { id } of agent.characters()) await agent.money.send({ to: id, from: "Rogue", amount: 2000, note: "Totentanz" });
```
