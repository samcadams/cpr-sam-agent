# Smoke test

Run after every refactor phase. You need one GM client and at least one player client (a second
browser or a private window logged in as a player works). Keep the browser console open on both:
any red error is a failure.

Setup: two player characters (PC A, PC B), each owned by a player and carrying an item named
"Agent". One NPC actor on the scene. A scene with at least one map pin (Note).

## Startup
- [ ] GM loads with no console errors; the GM Phone button (tower icon) appears.
- [ ] GM Phone opens straight onto "All conversations" with every conversation listed.
- [ ] Player loads with no console errors; the Agent button appears when PC A is selected/assigned.
- [ ] Removing the Agent item hides the player's button and closes their phone.

## Contacts
- [ ] GM: actor sheet header "Contacts" opens the manager; dragging an actor in adds a contact.
- [ ] Player: request a number → GM gets a pop-up; approve (linked to a sheet) → player gets
      "Contact added" and the contact shows up.
- [ ] Player: deny path shows "Request denied".

## Direct texts
- [ ] Player texts an NPC contact → GM gets a pop-up and text tone; GM replies from the GM Phone.
- [ ] Unread badges appear and clear when the conversation is opened.
- [ ] GM "Set viewed" shows "Viewed" under the player's last message.
- [ ] PC A texts PC B → PC B's player gets it; reactions and "Viewed" show on both sides.
- [ ] Attach a map pin and "My Current Location"; clicking the pin pans and pings the map.
- [ ] GM attaches a photo; clicking it opens the image.
- [ ] GM texts with hidden caller ID → player sees "Unknown Number"; GM reveals → it merges into
      the named conversation.
- [ ] GM blocks a contact → player can't text or call it.
- [ ] GM sets a contact to "texts only" (phone-slash in the Contacts manager, or the switch on its contact card)
      → the player has no call button for it and can still text; the GM can still call the player as them.
- [ ] React to a message; open the emoji picker and click elsewhere on the phone → it closes.
- [ ] Player deletes a conversation → it vanishes; it comes back when a new message arrives.

## GM Phone: acting as
- [ ] Texting from the GM Phone shows a yellow "TEXTING AS <NPC> → <PC>" strip, the NPC in its colour.
- [ ] Hidden caller ID shows in that strip.
- [ ] Group with several NPCs: the strip holds the "speak as" dropdown; sending and reacting use the chosen NPC.
- [ ] Service thread: "REPLYING AS <SERVICE> → <PC>".
- [ ] Incoming call: "RECEIVING CALL AS <NPC>"; during the call: "ON CALL AS <NPC>"; the call bar (after
      "Messages" on the call screen) says "On a call as <NPC>".

## GM Control app (GM Phone only)
- [ ] The GM Phone's dock has a fourth app, Control; players' phones don't.
- [ ] Jobs off → the Jobs app disappears for everyone; players get no job notices. Back on → it returns.
- [ ] "Available" tab off → players see only In Progress / Completed / Failed; the GM still sees Available.
- [ ] Map pins off → no location button; Photos off → no photo button (GM included).
- [ ] "Players can send photos" on → a player with file-browser permission can attach and send a picture.
- [ ] Characters: cut V's signal → V's phone shows NO SIGNAL, can't send or call; calling V is a missed call;
      texts to V don't arrive. Restore → they arrive, with a "N new while you had no signal" pop-up.
      The GM inbox picker shows "(no signal)" meanwhile.
- [ ] Wipe V's phone (with and without "also clear contacts") → V's conversations and requests are gone,
      V leaves their groups, Judy keeps her side of a V–Judy chat.
- [ ] Contacts and Services manager buttons open those windows.
- [ ] Look: change the emoji, "Viewed", "NO SIGNAL", the hidden caller ID label and an icon → the phones update;
      "Reset the look" puts the defaults back.
- [ ] Scrub all is here now (and gone from the phone's own Settings page).

## GM Phone: starting conversations
- [ ] GM Phone, a PC's inbox, "+": the list shows that PC's contacts (with conversations first) and other
      characters. Picking a contact with a conversation opens it; picking another sheet adds it to the PC's
      contacts (with its portrait) and opens a new conversation.
- [ ] Dropping an actor onto the dialog selects it. "Other name" still works for someone with no sheet.
- [ ] With "Hide caller ID", picking a sheet doesn't add it to the PC's contacts.
- [ ] Dropping a PC onto the GM Phone switches to their inbox; then dropping an NPC opens texting them as it.

## Job offers
- [ ] In a GM conversation, the job button (compose bar) attaches a job, shown as "Job offer: …"; send it.
- [ ] The player sees a card with the job's name, first line and picture (even though it's hidden), with
      Accept and Decline. Another player can't answer it.
- [ ] Accept → the job appears In Progress for everyone, the GM sees "V accepted the job …", the card shows
      "Accepted · V" and "Open in Jobs" opens it. Decline leaves the job as it was.
- [ ] Also in a group chat (any member can answer) and from a service conversation.
- [ ] With Jobs off (Control) there's no job button.

## Calls: minimised
- [ ] During a call, "Minimise" on the call screen closes the phone to a small ACTIVE CALL card by the phone
      button: timer, who's on it (the GM also sees "As <NPC>"), hang up, and a button to reopen the call.
- [ ] Minimising the phone window (header) also shows the card; opening the phone hides it.
- [ ] Hanging up from the card ends the call; the card goes away.

## Dropdowns (1.4.0; test in Chrome or Edge on Windows too, where the old ones were unreadable)
- [ ] Settings → Theme: the list opens inside the phone, readable, the current theme highlighted; picking
      one applies it. Same for an Internal Agent's HUD theme.
- [ ] Jobs → a job → Status (GM); the GM Phone's two pickers; a group's "speak as".
- [ ] A dropdown near the bottom of the phone opens upwards; clicking elsewhere closes it.

## GM Phone: one phone (1.4.0)
- [ ] GMs have no token (Agent) button any more, whatever is selected.
- [ ] The inbox and Contacts have two pickers: whose phone (All phones / each PC, with unread counts) and
      "as" (Anyone / each NPC in its colour, with unread counts).
- [ ] As Rogue on all phones: only conversations Rogue is in, named after the PC. As Rogue on V's phone: only
      V's conversations with Rogue. "+" asks which PC (as Rogue), or opens V's conversation with Rogue at once.
- [ ] Select an NPC token with the GM Phone open: a "Selected: <token> · Act as <token>" strip appears; nothing
      switches until you click it. × hides it until you select something else. Selecting a PC's token offers
      "Open <PC>'s phone".
- [ ] Dropping an NPC on the GM Phone with All phones chosen makes it the "as" NPC.
- [ ] A direct conversation on the GM Phone is headed by the PC (not the NPC); the strip says who the GM is.
- [ ] Inbox rows have the NPC's colour down the edge; hidden caller ID rows have a "hidden" tag.
- [ ] Money on the GM Phone: the dialog says "Paying and billing as <NPC>" (and whose sheet, if linked).

## Contact cards (1.4.0)
- [ ] Player: tap the name at the top of a conversation → the contact card: picture, name, Messages, Call
      (not for a texts-only contact), a large notes box that saves, and "Delete from this phone".
- [ ] Player: Contacts app → tap a contact → the card, with "Send text"; it opens the conversation, and Back
      goes card → Contacts. Services still open their conversation directly.
- [ ] GM: the card says "In V's contacts" (or "Not in…", or "Caller ID hidden from V"), shows V's notes
      shortened with "Show all", and has Texts only / Blocked switches, Reveal caller ID, Delete conversation,
      the picture (unlinked NPCs) or Sheet (linked ones).
- [ ] The conversation header shows a note icon when there are notes; the old inline notes panel is gone.

## Several NPCs (1.4.0)
- [ ] Group with V, Rogue and Takemura: on the GM Phone each NPC's message is labelled with its name in its
      colour, and the bubble edge takes the colour. Players see senders in colour too.
- [ ] Pick Takemura in "speak as", reload Foundry: still Takemura. "Add an NPC…" in that dropdown adds one.
- [ ] V calls the group: the GM Phone shows one call card with Answer per NPC and "Answer as all"; the
      pop-up says "for Rogue, Takemura" and "Choose…" opens the phone. Answer as both; "Leave" on Takemura
      leaves Rogue on the call.
- [ ] On a call as Rogue, Add → Takemura: Takemura is on the call at once; nothing rings for the GM.
- [ ] A group call the GM starts as Rogue rings only the players.
- [ ] Two calls at once (V calls Rogue, Judy calls Kerry): both show as cards. "End call" ends one for everyone.
- [ ] Minimised call card: "As Rogue, Takemura"; hang up takes both off.

## Redraws (1.5.0; the GM Phone open while two players text each other)
- [ ] Open the emoji picker, a dropdown ("Whose phone", "Texting as") or start typing notes or quick
      replies: nothing closes or loses text while messages arrive. Click away: the phone catches up.
- [ ] Scroll the inbox or Control: it stays put as messages arrive. Toggle a character's cellular
      service in Control: the page doesn't jump to the top.
- [ ] Reading an old part of a conversation, a new message doesn't yank you down; at the bottom, it does.
- [ ] An incoming call still takes the phone over at once.

## Settings and skins (1.5.0)
- [ ] Players have a Settings app in the dock; Messages has no gear. The GM Phone has no Settings app;
      its look and quick replies are in Control under "This GM Phone".
- [ ] Each skin (Neon Agent, Burner, Street Zine, Braindance): inbox, a conversation with a money card
      and a photo, a group with several NPCs ("Texting as" readable), the contact card, a call and the
      call bar, a dropdown, the lock screen.
- [ ] Colour palette only shows for Neon Agent and Braindance. "App bar down the side" only for Neon Agent.
- [ ] Burner: text readable everywhere (labels in Control, SERVICE tags, the GM's inbox names); the
      earpiece dots don't clip; unread counts sit beside the softkey labels; the call bar is an inverted line.
- [ ] Braindance: no REC light. Zine: the call bar is readable.
- [ ] An Internal Agent shows the Braindance HUD with the HUD palettes and opacity slider. Ticking
      "Disable forced Internal Agent theming" gives the normal skin choice.

## Lock screen, split view, SIM tiles (1.5.0)
- [ ] Player: take the phone out with its button → lock screen with the time and unread conversations.
      A notification opens its conversation; anywhere else unlocks. Switch it off in Settings.
- [ ] Opening the phone from a toast or a call skips the lock screen.
- [ ] Drag a phone wider than 600px: the list stays on the left; narrow again: back to one page.
- [ ] GM: tick "NPC SIM tiles" in Control: tiles above the inbox with unread counts; one acts as that
      NPC, tapping it again goes back to everyone.

## Blood (1.5.0)
- [ ] Control → Blood on the screen → Preview here: the spatter as Seriously and as Mortally Wounded.
- [ ] Switch it on; drop a PC below half HP: their player's phone gets bloody, below 1 HP heavier. Heal
      them: it clears. Other players don't see it.

## Contacts and calls (1.5.0)
- [ ] Player: rename a contact on its card: the new name shows in the inbox, conversation, contacts,
      notifications and calls. GM: the card says "Renamed to …", the conversation header "V calls them …".
- [ ] Player: Group info → tap another member → their card; Back returns to Group info.
- [ ] An unowned actor of type "character" is listed only under NPCs in the member picker, and calling
      her rings the GM Phone.
- [ ] Player on a call; the GM (or another player) calls them: the incoming screen asks "Hang up and
      answer?" above Decline and Hang up & Answer, both labelled without hovering (the toast too).
      Answering ends the first call.
- [ ] Resize every skin by the grip bar along the bottom edge; it's never covered.
- [ ] Player: Settings → Reaction keyboard: change it (typed, or with Pick); reactions offer their set,
      other players still get the GM's. "Use the GM's set" undoes it.
- [ ] Burner: call logs, "declined" requests and the money button are dark ink, not faint or green.
- [ ] A gear Agent on Braindance gets HUD colours and the HUD opacity slider; at its top the HUD is solid.
- [ ] Minimised call card: drag it by its top line; it stays there after reloads; double-click puts it
      back. GM on as two NPCs: each has its own Leave.

## Control, photos, jobs (1.5.0)
- [ ] Label and icon fields show their values (NO SIGNAL, Viewed, fas fa-…); clearing one goes back to
      the default.
- [ ] Reaction emoji → Pick: tap emoji to add or remove them.
- [ ] GM conversation: "Set as Viewed" under the player's newest message; gone once used.
- [ ] Players can send photos on: a player attaches a link, and (with "Use File Browser") a file from
      the server. "Players can upload photos" on: they can upload, and the file lands in
      `worlds/<world>/slopphone/agent-photos`. Off again: Foundry's permission is off too.
- [ ] Jobs: objectives' up/down arrows reorder them (branches move with their parent). The Available
      tab says whether players can see it, with jobs listed or not.

## Agent-model skins (1.6.0; relaunch the world first: new stylesheets)
- [ ] Settings → Skin lists Zetatech Grade A and A-Plus, Double Agent, Segotari Agent (2019), Wyzard
      Merlyn, Microtech Dot, the three Field Agents, Burner, Street Zine and the four HUDs. Each one:
      readable inbox, conversation, Settings, and the resize grip still works.
- [ ] Zetatech and Merlyn take the colour palette; the others say they bring their own colours.
- [ ] A-Plus: the newest message lifts off the screen; an incoming call's portrait floats.
- [ ] Double Agent: the lid screen shows the clock and the newest message (ticker), or the caller.
- [ ] Segotari 2019: the newest message from the other side types out once; ▼ blinks on it;
      money shows "ITEM GET!", a job offer "QUEST ACCEPTED?"; the dock is a ▶ menu.
- [ ] Field Agent: Med shows the vitals strip (HP from the sheet; it turns amber, then red and
      flashing, as HP drops).
- [ ] Internal Agent (forced): Skin lists only the four HUDs. BrainGen shows a SPONSORED line (the GM
      can write them in Control → BrainGen ads); PiR2 is plain white; Neuron has no panels.

## Apps (1.6.0)
- [ ] The dock has an Apps button; the home screen lists Agent, The Garden, Ask Alex Anything,
      BangMe!, Trauma Team, WatchBox (no WatchBox on an Internal Agent). Control → Apps turns each off.
- [ ] Agent: name it; the status bar shows the name. GM Phone → Agent: pick PCs, write an alert with
      answers ("Book it, Not now"), Send: the player's pop-up is signed with the Agent's name and has
      the answers as buttons; answering tells the GM. Save an alert; load it again.
- [ ] Cutting and restoring a character's signal: the "signal restored" pop-up comes from their Agent.
- [ ] Give PC A an item named "Biomonitor": dropping their HP below half pops "Seriously Wounded"
      from the Agent, and the Agent app shows their vitals.
- [ ] BangMe!: balance and ledger match the sheet and past transfers; money held for them has a
      Transfer button. Two PCs' tokens within 20 m: Bang someone → the other player gets Accept /
      Decline → money moves, both ledgers show it, and the receiver gets the BANG! pop-up. Further
      than 20 m: not in the list.
- [ ] GM BangMe!: add a pay point with prices; players see it only while it's open; paying debits the
      sheet and pops a card for the GM. Adjust and Export (CSV) work.
- [ ] Trauma Team: Subscribe charges the first month; "It's the 1st" bills again; with too little money
      the plan lapses and the Agent offers "Pay now". GM gives a plan ("Corporate plan"): never billed.
- [ ] Panic button: the GM gets an urgent card (Dispatch / Show); Dispatch with an ETA shows the
      player a countdown; Arrived and Close. With a Biomonitor linked, dropping HP below BODY calls
      on its own ("TRAUMA TEAM NOTIFIED").
- [ ] Ask Alex Anything: a question shows "Alex is crawling the Pool…" until the GM answers. The GM
      can ask for a roll (the player's Roll button posts Library Search +2 to chat and the GM sees
      the total) or mark No results. A Journal entry in a "Data Pool" folder answers at once.
- [ ] WatchBox: Arm → the phone becomes the eye (ASSESSING, then ARMED after 5 world minutes, or the
      GM's "Done assessing"). A hidden yellow square is on the map for the GM. Trigger → the alarm
      sounds at the phone's spot. The player can
      only disarm from inside the square.
- [ ] The Garden: Feed and News. A player reads without an account; "Make an account" makes @their_name.
      Post, sprout, graft, reply. Posts' numbers climb over a few minutes and citizens reply.
- [ ] GM Garden: post as any account, now or in N minutes; Queue posts (a list, one every N minutes);
      pause and resume; Accounts: new, edit, random citizens. A ★ Reputation event with +1 raises the
      PC's Reputation on the sheet; their Patch shows it.
- [ ] The Garden Dating: create a profile (or use the Patch); Spark → GM card → Match → the player's
      Agent says it's a match; GM "Ask out" → the player accepts → GM card to narrate the date.

## 1.0.0: the data folder
- [ ] A new world: the GM loads it and `slopphone/` appears with `threads/`, `apps/`, `garden/` and
      `agent-photos/` (before anything is sent). After a text: `messages.json` and its thread file.
- [ ] Send a text, reload the GM: it's still there. Only that conversation's file (and
      `messages.json` for a new conversation) has a new modified time.
- [ ] Delete a conversation: its file in `threads/` is emptied to `{}`; reload: it stays gone.
- [ ] A player uploads a photo: it lands in `slopphone/agent-photos/`.
- [ ] Another GM takes over as host (the first logs out): texts still save.
- [ ] Trauma Team (GM): Add a plan "Street Medic", 100, every 7 days → players see "100eb/wk" and
      can subscribe; 7 world days later they're billed. Edit Silver's Exec rank to 4 → the Exec rule's
      note updates. Remove a plan someone is on → the confirm says so; within 30 s they get "Your
      plan has been discontinued" and show no coverage. "Back to the default plans" brings back
      Silver and Executive. The last plan can't be removed.
- [ ] The Garden → Control → Pages: "One feed" on → no News tab on any phone, news posts in the
      Feed; "Post as" a news account opens the Feed. "The Garden Dating" off → no Dating tab (GM
      and players), no Garden badge for searching sparks; on again → profiles are still there.
- [ ] Trauma Team call (GM): "Dispatch in [5] Minutes" (and "Rounds" in a combat) on one line,
      Close and Show below; after dispatch, Arrived on its own line.
- [ ] WatchBox: tokens walking into the square do nothing; the GM's Trigger sounds the alarm.
- [ ] The Garden as a player with an account: the handle at the top right is a link; tap it: your
      Patch (Edit my Patch shows). Back returns to the feed. Without an account: the name, not a link.
- [ ] The Garden as the GM, open any post: "As" above the reply box lists NPC, news and corporate
      accounts (no characters'); reply as @ncpd_alerts: the reply shows under that handle on every
      phone. Mention a character's handle in it: they get an Agent alert.
- [ ] Open @ncpd_alerts' Patch after replying as it: "Replies" under its posts shows the reply,
      "Replying to @v" and the post's text; tap either: the post opens; Back: the Patch again. A
      character's Patch shows their replies the same way.
- [ ] GM, in a post: a trash icon on NPC and citizen replies, none on characters'. Delete one: it
      goes on every phone, and from the Patch's Replies. Players see no trash icons.
- [ ] GM, The Garden: open "As" (composer, then in a post): a search box at the top, focused; type
      `ncpd`: only @ncpd_alerts is left; Enter picks it. Reopen: the box is empty and the list full.
      Queue → pen on a post → "Posted by": type in the box beside it, the list narrows.
- [ ] A post set to Viral, left to grow: its citizen replies never repeat a line.
- [ ] A player replies to a post with another character's handle (`@judy`): Judy's Agent alerts her.
- [ ] Dating, a player with a Garden account and no profile: only "Use my Garden Patch". Without an
      account: only "Create a dating profile".
- [ ] Dating: the GM picks a profile for V, V taps Spark: the match is in V's Contacts and Messages
      (an empty conversation), and in the GM Phone's "Acting as" list. The match row reads "Open
      Messages" (rename the Messages app in Control: the button follows). Tap it: the conversation.
- [ ] GM, Garden → Dating → Matches → "Text them": write a text, Send: the GM Phone is in Messages,
      in V's conversation with the match, acting as them; V gets the text as usual.
- [ ] V deletes the match (trash, confirm): gone from Matches and from Contacts; the GM gets a card.
- [ ] Composer star: every character is listed; V `1`, Judy `-1`, reason: Send: both sheets change,
      the post reads "#rep V (+1), Judy (-1)". Tap the "#rep" line before posting: the dialog shows
      what's set. `0`: tagged, no change. Queue → pen: the same rows, filled in.
- [ ] Settings → Look (Neon Agent) and Control: the side-bar checkbox reads "Vertical Dock".
- [ ] Foundry's module settings no longer list "Hidden caller ID label" or "New text notification".
      Control → Labels → Hidden caller ID still changes what players see.
- [ ] Settings → Look and dock → New texts: V on "Open the phone", Judy on "Badge only" (same
      player): a text to V opens the phone, a text to Judy only badges. The GM Phone's choice in
      Control applies to the GM only.

## 1.11.0 (relaunch the world first: new stylesheets)
- [ ] Settings → Look → Text size: dragging grows and shrinks the text live (percent beside it);
      letting go keeps it after closing and reopening the phone. Other users' phones don't change.
- [ ] At 150% on Burner, Zetatech, Field and a HUD: the inbox, a conversation, the Garden and a call
      still fit (text wraps, nothing hidden). The GM gets the same slider in Control.
- [ ] Garden → Queue → Queue posts → Choose a .txt file with `hello`, `fire | <a picture path>`,
      `@network54 | breaking` and `@brand_new | hi`. Posts fills with the lines (file name beside
      the button); Queue: four posts, two @random, one a new @brand_new account (Accounts tab), the
      picture icon on the second. Typing the same lines queues the same. "No handle posts as" set
      to the composer's account: `hello` goes out as that account.
- [ ] A PC and an NPC sheet with a portrait different from their token: the inbox, conversation
      header, contact card, Contacts, a group's members, a call and a text notification all show the
      portrait, zoomed in slightly. A contact given its own picture keeps it.
- [ ] Queue posts: "Choose a .txt file" is on one line, the file's name beside it.
- [ ] Control → Clear app data → Messages with a character picked: only their conversations go (they
      leave groups); Everyone: all go. Contacts and notes: their contacts, notes and renames go.
      No Danger zone; no eraser under Characters; no Contacts or Services buttons (still in the
      Contacts app's header).
- [ ] Control → Labels holds the labels, then App names. "Reset Emoji, Labels, and Icons to
      Default" resets those and keeps the money prefix and suffix.
- [ ] Select a PC token: "Open V's phone" shows in Messages, not in Control, Jobs or other apps.
- [ ] Control → Every phone → Clock: System time shows your computer's time; On another date shows
      that date with the real time. Set by the GM: enter a date and time, every phone (a player's too)
      shows it and it keeps running; new texts are stamped with it. Untick "Day": "October 31, 2045".
      Simple Calendar (module active): its date and time; the clock follows it as time passes.
- [ ] Cut a PC's signal (Control → Characters), their token on the active scene, another player
      nearby: text them, text a group they're in, react to their message: no sound for anyone. An Agent
      alert or a Bang still sounds for them (the Agent speaks). Restore signal: tones again.
- [ ] Rename a player's character (GM Phone open on Control): Characters shows the new name at once.
- [ ] Pen on a queued post: change each field, save: the row shows it; Post now posts it that way
      (picture, outcome, Reputation on the sheet). While paused, "Goes out in 2" = 2 min after Resume.

## 1.10.0
- [ ] Jobs: delete a job: it disappears at once.
- [ ] Control → Clear app data: pick a character, clear their Notifications: others' stay. Everyone:
      Random citizens: they and their posts go; news accounts stay.

## 1.9.0
- [ ] Neon Agent (and a few other skins): wide buttons, Make an account, Bang, Agent answers are the
      skin's colours, not white with dark text.
- [ ] Settings → Look and dock → Home screen: the dock goes, a Home button appears (try several
      skins); taking the phone out opens the home screen with every app; the Home button's badge
      counts what's waiting. Back to Dock: as before.
- [ ] Your own Garden Patch doesn't show your dating profile.

## 1.8.0
- [ ] GM Phone: Messages gear (photos, uploads, map pins, quick replies); Jobs gear (Available tab).
      Control sections fold and stay folded across redraws.
- [ ] Control → Every phone: set the money prefix to blank and the suffix to "eb": prices read "500eb".
- [ ] Every skin: buttons (Agent answers, Bang, Make an account, wide buttons) are readable.
- [ ] Open an app from Apps; tap Apps: the Apps screen; tap it again: back in the app.
- [ ] Garden: graft a post; it shows on your Patch as "@you grafted this". Dating: only the round
      Algorithm button; edit age and prompts in place. Accounts: set an attitude; it replies to posts.
      Control → Word lists: Read one; Choose your own file; back to built in.
- [ ] Trauma Team: Dispatch with a 1-minute ETA: after a minute the player's Agent says STAND CLEAR OF
      THE LZ and you get a card. Turn off "Players can turn the offers off": the player's box is gone.
- [ ] Alex: no categories; the first screen introduces Alex; a Data Pool answer shows its entry only
      on the GM Phone.

## 1.7.0
- [ ] Settings → Dock: untick Contacts, tick The Garden: the dock changes; Contacts is on the Apps screen.
      At five, the rest can't be ticked. Same in Control for the GM Phone.
- [ ] Control: Characters first; Apps has Jobs; App names change the dock, Apps screen and headers.
      "Players can turn off the Internal Agent HUD" off: the box is gone from an Internal Agent's Settings.
- [ ] Jobs → Available (GM): the "Hide/Show in Control" link flips the tab for players.
- [ ] Double Agent: open other pages; the ticker carries on instead of restarting.
- [ ] BrainGen: the SPONSORED line stays put across pages. Merlyn and Neuron: the opacity slider.
- [ ] Garden → Control: add an outcome; post with it; change a word list (e.g. replies) and see it used.
- [ ] Garden → Accounts: pin one (first in "As"); the pen-nib button opens Feed posting as it.
- [ ] Queue "@random | test": posts as a citizen. Set "Messages go to" on an account: a player's
      Message opens that conversation (or asks for the number).
- [ ] Dating: Activate the Algorithm → GM card → pick a profile → the player Sparks → matched.
- [ ] Alex: Enter sends; the player gets a pop-up when you answer; the answer appears word by word.
      Categories edit; "Create an example entry" makes the Data Pool folder and an entry.
- [ ] Trauma Team: in a combat, "Dispatch (rounds)" counts down as rounds advance. "It's the 1st"
      pops "Payment received".
- [ ] WatchBox: ASSESSING counts down; the module setting changes the alarm sound.

## Groups
- [ ] Player creates a group with PC B and an NPC; all see it; GM speaks as the NPC.
- [ ] Rename, add a member, remove a member (the removed player loses the group).

## Calls
- [ ] Player calls an NPC → GM sees an Answer/Decline pop-up; answer → both show the call screen
      with a running timer; hang up → "Call · m:ss" is logged in the thread.
- [ ] Unanswered call times out after 30 s → "Missed call".
- [ ] Group call; adding someone mid-call.
- [ ] With tokens on the scene: the ringtone is heard near the ringing token, not by its owner twice.

## Services
- [ ] GM Phone → Services: labels read "Request buttons", "Phone lines", "Allow PCs to text"; no money checkbox.
- [ ] Create one with request buttons, two phone lines and texting on.
- [ ] Player presses a request button → GM is notified and replies; player types freely.
- [ ] Player's service page has one phone icon in the header: it lists both lines; picking one rings the GM.
      With a single line, the icon rings straight away. Clicking elsewhere closes the list.
- [ ] Player has no money button on the service; the GM does and can bill (request) at any time.
- [ ] Player pays the GM's bill; the note shows inside the money card, above the buttons.

## Money (use PCs with eurobucks on their sheets)
- [ ] Player sends €$100 to PC B → A's wealth drops at once; B presses Transfer → B's wealth rises.
- [ ] Sender cancels an untransferred send → refunded.
- [ ] Request money; pay it; decline one; cancel one.
- [ ] A note sent with money appears inside the money card, above Pay/Decline/Transfer/Cancel.
- [ ] Double-click Pay quickly → charged only once.
- [ ] Sending more than the balance is refused.

## Quests
- [ ] GM creates a hidden job → players see nothing; unhide → players get "New job".
- [ ] Add nested objectives, hide one (its children vanish for players), cycle states → notices.
- [ ] Change job status → players get the matching notice; quests dot clears when opened.

## Privacy
- [ ] With a hidden-caller-ID thread active, the player's console shows no errors and the player's
      phone shows "Unknown Number" (the real name is no longer even sent to their browser).
- [ ] A second player doesn't receive the first player's conversations (nothing appears on their
      phone, even if they own no shared characters).

## Settings & misc
- [ ] Skin and palette changes apply (Settings app, or Control for the GM Phone).
- [ ] Quick replies send; silent mode mutes the text tone.
- [ ] Reload the GM → history is still there (loaded from `worlds/<world>/slopphone/`).
- [ ] GM "Scrub" wipes conversations for everyone.
