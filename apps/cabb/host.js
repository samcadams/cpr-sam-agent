import { gm } from "../../scripts/host/validate.js";
import { cabbConfig, cabbDay, cabbMap, cabbPlaces, cabNumber, creditLabel, gmDelayMs, OPEN_RIDE, partyPickup, pickupMs, quote, rideCredit, tripMs, ZONES } from "./model.js";
import { mapConfig, ownCabbRoad } from "../map/model.js";
import { loadGraph } from "../map/sidecars.js";
import { formatMoney, hasWallet } from "../../scripts/model/money.js";
import { displayName } from "../../scripts/model/threads.js";
import { agentTimestamp } from "../../scripts/util/agentTime.js";
import { formatDuration } from "../../scripts/util/text.js";

/*
 * Host: Combat Cabb (see apps/cabb/model.js). A booking dispatches a cab; at its ETA the cab is there and
 * the fare is charged through BangMe (or the cab leaves without them); it waits there until the GM
 * says it leaves (the tokens are in); after the trip it's arrived.
 * Each step is an Agent alert for the rider and a card for the GM, who moves the tokens and can hurry
 * a cab along or cancel it. With the trip timer off (GM setting), a ride arrives only when the GM says; the GM
 * can also set or clear any open ride's pickup or arrival time by hand ("time"). A ride the rider's Lifestyle covers
 * (model.js rideCredit) costs nothing: the credit is taken at booking and given back if the ride is cancelled. Timers run on the host, with the app clock (host/clock.js) as a backstop.
 * Methods run on the store (`this`); see host/index.js.
 */

export const requests = {
  "cabb-book": "_onCabbBook",
  "cabb-cancel": "_onCabbCancel",
  "cabb-gm": gm("_onCabbGm")
};

const FROM = "Combat Cabb";

/** Closed rides kept (the open ones always are). */
const KEEP_CLOSED = 40;

const owns = (user, actor) => !!actor?.testUserPermission(user, "OWNER");

export const methods = {
  async _onCabbBook(user, { actorId, from: fromId, to: toId }) {
    const actor = game.actors.get(actorId);
    if (!actor || user.isGM || !owns(user, actor) || !this._citinet(actor, "cabb")) return;
    if (Object.values(this.apps.rides).some(r => r.actorId === actor.id && OPEN_RIDE.has(r.status))) {
      return this._alertNow(actor.id, { kind: "event", from: FROM, text: "You already have a cab coming." });
    }
    const cfg = cabbConfig();
    const map = cabbMap(cfg);
    const places = cabbPlaces(cfg, map, user); // only the pins this player sees
    const from = partyPickup(cfg, map, places) ?? places.find(p => p.id === fromId);
    const to = places.find(p => p.id === toId);
    if (!from || !to || from.id === to.id) return;
    // By road when the Map has its road network; the same quote the player's phone showed.
    const own = mapConfig();
    const net = map ? await loadGraph(own.roads) : null;
    const road = net ? ownCabbRoad(own, net, from, to) : null;
    const { mi, km, fare: fullFare, zone } = quote(from, to, cfg, cabbDay(), road?.miles);
    const free = rideCredit(actor, from, to, this.apps.rideCredits);
    const credit = free?.ok ? { lifestyle: free.lifestyle, key: free.key } : null;
    const fare = credit ? 0 : fullFare;
    if (!credit && hasWallet(actor) && actor.system.wealth.value < fare) {
      return this._alertNow(actor.id, { kind: "money", from: FROM, text: `Booking declined: the fare is ${formatMoney(fare)} and your account can't cover it.` });
    }
    const id = foundry.utils.randomID();
    const wait = pickupMs(cfg);
    const ride = {
      id, actorId: actor.id, from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name }, mi, km, fare, zone, road: !!road,
      status: "enroute", eta: Date.now() + wait, arrive: null, tripMs: tripMs(km, cfg), cab: cabNumber(), ts: Date.now(), time: agentTimestamp().time,
      credit, fullFare
    };
    this.apps.rides[id] = ride;
    if (credit) this.apps.rideCredits[actor.id] = { actorId: actor.id, key: credit.key, rideId: id, ts: Date.now() };
    this._cabbTimer(wait);
    this._gmCard({
      id: `cabb:${id}`, title: FROM,
      body: `${displayName(actor)} booked a cab: ${from.name} → ${to.name}, ${mi} mi, ${credit ? `free (${credit.lifestyle} Lifestyle; ${formatMoney(fullFare)})` : formatMoney(fare)}${zone ? ` (${ZONES[zone]})` : ""}. Pickup in ${formatDuration(wait)}.`,
      icon: "fa-taxi", open: { app: "cabb" },
      actions: [
        { label: "Here now", icon: "fa-taxi", request: "cabb-gm", data: { rideId: id, action: "here" } },
        { label: "Cancel", icon: "fa-ban", request: "cabb-gm", data: { rideId: id, action: "cancel" } }
      ]
    });
    this._pushApps([this._alert(actor.id, { kind: "event", from: FROM, text: `Cabb ${ride.cab} is on its way to ${from.name}. ETA ${formatDuration(wait)}.${credit ? ` ${creditLabel(credit)}.` : ""}` })]);
  },

  /** The rider calls it off before the cab gets there (nothing is charged). */
  _onCabbCancel(user, { rideId }) {
    const ride = this.apps.rides[rideId];
    if (!ride || ride.status !== "enroute" || !owns(user, game.actors.get(ride.actorId))) return;
    ride.status = "cancelled";
    this._cabbReleaseCredit(ride);
    this._gmCard({ id: `cabb:${ride.id}`, title: FROM, body: `${displayName(game.actors.get(ride.actorId))} cancelled their cab to ${ride.to.name}.`, icon: "fa-taxi", open: { app: "cabb" } });
    this._pushApps([this._alert(ride.actorId, { kind: "event", from: FROM, text: `Cabb ${ride.cab} cancelled. No charge.` })]);
  },

  /**
   * GM: the cab is here now, leaves now, has arrived now, is cancelled (refunded if it was paid for), or
   * gets a new pickup or arrival time (`minutes` from now; none: no timer, it waits for the GM).
   */
  async _onCabbGm(user, { rideId, action, minutes }) {
    const ride = this.apps.rides[rideId];
    if (!ride || !OPEN_RIDE.has(ride.status)) return;
    const ids = [];
    if (action === "here" && ride.status === "enroute") ids.push(await this._cabbPickup(ride));
    else if (action === "depart" && ride.status === "waiting") ids.push(this._cabbDepart(ride));
    else if (action === "arrived" && ride.status === "riding") ids.push(this._cabbArrive(ride));
    else if (action === "time" && (ride.status === "enroute" || ride.status === "riding")) ids.push(this._cabbRetime(ride, gmDelayMs(minutes)));
    else if (action === "cancel") {
      const paid = !ride.credit && (ride.status === "waiting" || ride.status === "riding");
      if (paid) {
        const actor = game.actors.get(ride.actorId);
        await this._transfer(null, actor, ride.fare, `Combat Cabb refund: ${ride.from.name} → ${ride.to.name}`);
        this._ledger(ride.actorId, ride.fare, `Refund: ${ride.from.name} → ${ride.to.name}`, "cabb", FROM);
      }
      ride.status = "cancelled";
      const freed = this._cabbReleaseCredit(ride);
      this._gmCard({ id: `cabb:${ride.id}`, title: FROM, body: `Cabb ${ride.cab} cancelled.`, icon: "fa-taxi" });
      ids.push(this._alert(ride.actorId, { kind: "event", from: FROM, text: `Cabb ${ride.cab} cancelled by dispatch.${paid ? ` ${formatMoney(ride.fare)} refunded.` : ""}${freed ? ` Your ${ride.credit.lifestyle} Lifestyle's free ride is still yours.` : ""}` }));
    } else return;
    this._pushApps(ids.filter(Boolean));
  },

  /** A cancelled ride gives its Lifestyle credit back (if it still holds it). Returns whether it did. */
  _cabbReleaseCredit(ride) {
    const used = ride.credit ? this.apps.rideCredits[ride.actorId] : null;
    if (used?.rideId !== ride.id) return false;
    delete this.apps.rideCredits[ride.actorId];
    return true;
  },

  /** Wake up for a ride's next step (the clock catches anything this misses). */
  _cabbTimer(ms) {
    setTimeout(() => this.isHost && this._enqueue(() => this._tickCabb()), ms + 50)?.unref?.();
  },

  /** Rides whose time has come: pickups and arrivals (leaving is the GM's call). */
  async _tickCabb() {
    const now = Date.now();
    const ids = [];
    for (const ride of Object.values(this.apps.rides)) {
      if (ride.status === "enroute" && ride.eta && now >= ride.eta) ids.push(await this._cabbPickup(ride));
      else if (ride.status === "riding" && ride.arrive && now >= ride.arrive) ids.push(this._cabbArrive(ride));
    }
    if (!ids.length) return;
    const closed = Object.values(this.apps.rides).filter(r => !OPEN_RIDE.has(r.status)).sort((a, b) => b.ts - a.ts);
    for (const old of closed.slice(KEEP_CLOSED)) delete this.apps.rides[old.id];
    this._pushApps(ids.filter(Boolean));
  },

  /** The cab is here: charge the fare (or it leaves), then wait for the GM. Returns the rider's alert id. */
  async _cabbPickup(ride) {
    const actor = game.actors.get(ride.actorId);
    const who = actor ? displayName(actor) : "?";
    const trip = `${ride.from.name} → ${ride.to.name}`;
    if (!actor || (!ride.credit && hasWallet(actor) && !(await this._transfer(actor, null, ride.fare, `Combat Cabb: ${trip}`)))) {
      ride.status = "declined";
      this._cabbReleaseCredit(ride);
      this._gmCard({ id: `cabb:${ride.id}`, title: FROM, body: `${who}'s payment was declined: Cabb ${ride.cab} left without them.`, icon: "fa-taxi", open: { app: "cabb" } });
      return this._alert(ride.actorId, { kind: "money", from: FROM, text: `Payment declined. Cabb ${ride.cab} left without you.` });
    }
    if (!ride.credit && hasWallet(actor)) this._ledger(actor.id, -ride.fare, trip, "cabb", FROM);
    ride.status = "waiting";
    ride.eta = Date.now();
    this._gmCard({
      id: `cabb:${ride.id}`, title: FROM,
      body: `Cabb ${ride.cab} is at ${ride.from.name} for ${who} (${ride.credit ? `free: ${ride.credit.lifestyle} Lifestyle` : `${formatMoney(ride.fare)} paid`}). It waits until you send it off to ${ride.to.name}.`,
      icon: "fa-taxi", open: { app: "cabb" },
      actions: [
        { label: "Depart", icon: "fa-road", request: "cabb-gm", data: { rideId: ride.id, action: "depart" } },
        { label: "Cancel (refund)", icon: "fa-ban", request: "cabb-gm", data: { rideId: ride.id, action: "cancel" } }
      ]
    });
    return this._alert(ride.actorId, {
      kind: "money", from: FROM,
      text: `Cabb ${ride.cab} is here. Get in. ${ride.credit ? `${creditLabel(ride.credit)}.` : `${formatMoney(ride.fare)} charged.`}`
    });
  },

  /** GM: everyone's in, the cab leaves for the destination (on the trip timer, unless it's off). Returns the rider's alert id. */
  _cabbDepart(ride) {
    const timed = cabbConfig().tripTimer !== false;
    ride.status = "riding";
    ride.arrive = timed ? Date.now() + ride.tripMs : null;
    if (timed) this._cabbTimer(ride.tripMs);
    this._cabbRidingCard(ride);
    return this._alert(ride.actorId, {
      kind: "event", from: FROM,
      text: timed ? `Cabb ${ride.cab} is moving. ${ride.to.name} in about ${formatDuration(ride.tripMs)}.` : `Cabb ${ride.cab} is moving. Next stop: ${ride.to.name}.`
    });
  },

  /** The GM's card for a ride on its way to the destination. */
  _cabbRidingCard(ride) {
    const actor = game.actors.get(ride.actorId);
    const when = ride.arrive ? `Arriving at ${ride.to.name} in ${formatDuration(ride.arrive - Date.now())}.` : `No timer: it arrives at ${ride.to.name} when you say.`;
    this._gmCard({
      id: `cabb:${ride.id}`, title: FROM,
      body: `Cabb ${ride.cab} left with ${actor ? displayName(actor) : "?"}. ${when}`,
      icon: "fa-taxi", open: { app: "cabb" },
      actions: [{ label: "Arrived now", icon: "fa-flag-checkered", request: "cabb-gm", data: { rideId: ride.id, action: "arrived" } }]
    });
  },

  /** GM: a new pickup (on its way) or arrival (riding) time, `ms` from now; null: no timer. Returns the rider's alert id. */
  _cabbRetime(ride, ms) {
    const at = ms ? Date.now() + ms : null;
    if (ms) this._cabbTimer(ms);
    if (ride.status === "enroute") {
      ride.eta = at;
      return this._alert(ride.actorId, {
        kind: "event", from: FROM,
        text: ms ? `Cabb ${ride.cab}: new ETA to ${ride.from.name}, ${formatDuration(ms)}.` : `Cabb ${ride.cab} is delayed on its way to ${ride.from.name}. Hang tight.`
      });
    }
    ride.arrive = at;
    this._cabbRidingCard(ride);
    return this._alert(ride.actorId, {
      kind: "event", from: FROM,
      text: ms ? `Cabb ${ride.cab}: ${ride.to.name} in about ${formatDuration(ms)}.` : `Cabb ${ride.cab}: traffic. ${ride.to.name} when the streets allow.`
    });
  },

  _cabbArrive(ride) {
    ride.status = "arrived";
    ride.arrive = Date.now();
    const actor = game.actors.get(ride.actorId);
    this._gmCard({ id: `cabb:${ride.id}`, title: FROM, body: `${actor ? displayName(actor) : "?"} arrived at ${ride.to.name}.`, icon: "fa-flag-checkered", open: { app: "cabb" } });
    return this._alert(ride.actorId, { kind: "event", from: FROM, text: `Arrived: ${ride.to.name}. Thanks for riding Combat Cabb. Mind the bullet holes.` });
  }
};
