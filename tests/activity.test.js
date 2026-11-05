import "./foundry-stub.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { landsIn } from "../scripts/ui/activity.js";

/* Input reaching the activity tracker: only DOM nodes inside the phone count. */

class FakeNode {
  constructor(parent = null) { this.parent = parent; }
  contains(other) {
    for (let n = other; n; n = n.parent) if (n === this) return true;
    return false;
  }
}
const hadNode = "Node" in globalThis;
globalThis.Node ??= FakeNode;
after(() => { if (!hadNode) delete globalThis.Node; });

test("input inside the phone counts, outside doesn't", () => {
  const phone = new FakeNode();
  assert.equal(landsIn(phone, new FakeNode(phone)), true);
  assert.equal(landsIn(phone, new FakeNode()), false);
});

test("gamepad input with a non-Node target is ignored, not thrown on", () => {
  const phone = new FakeNode();
  phone.contains = () => { throw new TypeError("parameter 1 is not of type 'Node'"); };
  for (const target of [{ type: "gamepad" }, globalThis, null, undefined, 3]) assert.equal(landsIn(phone, target), false);
});

test("no phone in hand: nothing counts", () => {
  assert.equal(landsIn(undefined, new FakeNode()), false);
});
