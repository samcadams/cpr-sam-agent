/*
 * Mr. Amaze's Mystery Boxes (Achievements and Loot Boxes), in Achieve!: a character gets one by trading
 * in an achievement (or the GM gives one). The Table of Mystery (1d10) says which box; opening it (an
 * Action) rolls 1d6 on that box's table for what's inside: real gear, matched to the Cyberpunk RED
 * compendiums (model/items.js), which the GM confirms before it lands on the opener's sheet.
 *
 * The data: the host's table "boxes" (apps/manifest.js; a player sees their own characters'):
 *   { [id]: Box }
 *   Box: { id, actorId, table (1–10), status: "sealed"|"opening"|"open", source (what it came from),
 *     roll (1–6), openedBy (actorId), contents: [{ name, uuid|null, qty }], text?, loaded?, given?, ts }
 *     "opening": rolled, waiting for the GM; "open": the GM gave it.
 *   (Boxes used to be Gacha's, in the table "gachaBoxes"; the host moves them, apps/achieve/host.js.)
 */

/** An item to find in the compendiums: its exact name, and (when the name is shared) its type or pack. */
const it = (name, qty = 1, extra = {}) => ({ name, qty, ...extra });

/**
 * The Table of Mystery and its ten boxes, from the DLC. `bc`: from Black Chrome; `dlc`: from a free
 * DLC; `loaded`: a weapon that comes fully loaded (the GM picks the ammunition).
 */
export const MYSTERY_BOXES = [
  { name: "A box bound tightly in rope", contents: [
    { text: "Rope x2, each 60 m/yards", items: [it("Rope (60m/yd)", 2)] },
    { text: "Virtuality Goggles", items: [it("Virtuality Goggles")] },
    { text: "Grapple Gun", items: [it("Grapple Gun")] },
    { text: "Vial of Poison", items: [it("Vial of Poison", 1, { pack: "core_gear" })] },
    { text: "Urban Flash Jewelry", items: [it("Urban Flash Jewelry")] },
    { text: "Cybermatrix Gang Jazzler", dlc: "12 Days of Cybermas", items: [it("Gang Jazzler")] }
  ] },
  { name: "A box covered in chipped paint", contents: [
    { text: "Teargas Grenade", items: [it("Grenade (Teargas)")] },
    { text: "Fully Loaded GunMart Smart Special", bc: true, loaded: true, items: [it("GunMart Smart Special")] },
    { text: "Bicycle", dlc: "Spinning Your Wheels", items: [it("Bicycle")] },
    { text: "Flare Gun and a Road Flare", dlc: "Woodchipper's Garage", items: [it("Flare Gun"), it("Road Flare")] },
    { text: "Bulletproof Shield", items: [it("Bullet Proof Shield")] },
    { text: "Fully Loaded Militech Crusher", dlc: "12 Days of Gunmas", loaded: true, items: [it("Crusher")] }
  ] },
  { name: "A box dripping wet with fluid", contents: [
    { text: "Can of Smash x5", items: [it("Smash", 5, { pack: "core_drugs" })] },
    { text: "Airhypo loaded with Black Lace", items: [it("Airhypo", 1, { type: "gear" }), it("Black Lace")] },
    { text: "Bodyweight AutoInjector", dlc: "Hornet's Pharmacy", items: [it("Bodyweight AutoInjector")] },
    { text: "Everest VentureWare AirWell 50", bc: true, items: [it("Everest VentureWare AirWell 50")] },
    { text: "Poison Grenade", items: [it("Grenade (Poison)")] },
    { text: "T-R4 Detonator Fluid", bc: true, items: [it("TR-4 Detonator Fluid")] }
  ] },
  { name: "A box freezing cold to the touch", contents: [
    { text: "Bohemian Mirrorshades", items: [it("Bohemian Mirrorshades")] },
    { text: "Street Viper Riding Suit", bc: true, items: [it("Street Viper Riding Suit")] },
    { text: "Two Sponsored Cybereyes", bc: true, items: [it("Sponsored Cybereye", 2)] },
    { text: "SkidRow Trench", bc: true, items: [it("Skid Row Trench")] },
    { text: "Airhypo loaded with Prime Time", dlc: "Hornet's Pharmacy", items: [it("Airhypo", 1, { type: "gear" }), it("Prime Time")] },
    { text: "Laser Light Street Jacket", bc: true, items: [it("Laser Light Street Jacket")] }
  ] },
  { name: "A box handsomely gift wrapped", contents: [
    { text: "Binoculars", items: [it("Binoculars")] },
    { text: "Light Armorjack Body", items: [it("Light Armorjack (Body)")] },
    { text: "Excellent Quality Medium Pistol", items: [it("Medium Pistol (Excellent)")] },
    { text: "Video Camera", items: [it("Video Camera")] },
    { text: "NeuTongue", dlc: "Must Have Cyberware Deals", items: [it("NeuTongue", 1, { pack: "dlc_must-have-cyberware-deals" })] },
    { text: "Reflex Co-Processor", bc: true, items: [it("Reflex Co-Processor", 1, { pack: "black-chrome_cyberware" })] }
  ] },
  { name: "A box marked with a lime green X", contents: [
    { text: "A boxed copy of Elflines Online", items: [it("Elflines Online")] },
    { text: "Two Disposable Cell Phones", items: [it("Disposable Cell Phone", 2)] },
    { text: "Modular Finger Cyberhand", bc: true, items: [it("Modular Finger Cyberhand")] },
    { text: "Leisurewear Jewelry", items: [it("Leisurewear Jewelry")] },
    { text: "Agent", items: [it("Agent", 1, { type: "gear" })] },
    { text: "Smart Glasses", items: [it("Smart Glasses")] }
  ] },
  { name: "A box melted out of shape", contents: [
    { text: "Scavenged Armor Body", dlc: "Black Chrome+", items: [it("Scavenged Armor")] },
    { text: "Incendiary Grenade", items: [it("Grenade (Incendiary)")] },
    { text: "Neo-Soviet Cyberarm", bc: true, items: [it("Neo-Soviet Cyberarm")] },
    { text: "Fully loaded Stolbovoy ST-5 Assault Rifle", dlc: "12 Days of Gunmas", loaded: true, items: [it("ST-5 Assault Rifle")] },
    { text: "Fully Loaded Everest VentureWare SurvivalMaster", dlc: "Black Chrome+", loaded: true, items: [it("SurvivalMaster")] },
    { text: "Fully Loaded Flamethrower", loaded: true, items: [it("Flamethrower", 1, { pack: "core_weapons" })] }
  ] },
  { name: "A box sealed with a lipstick kiss", contents: [
    { text: "Light Melee Weapon", items: [it("Light Melee")] },
    { text: "Mr. Studd™ Sexual Implant", items: [it("Mr. Studd Sexual Implant")] },
    { text: "Shuriken Tornado Grenade", bc: true, items: [it("Grenade (Shuriken Tornado)")] },
    { text: "Asia Pop Footwear", items: [it("Asia Pop Footwear")] },
    { text: "Two Businesswear Tops", items: [it("Businesswear Top", 2)] },
    { text: "White Hornet Tanto", bc: true, items: [it("White Hornet Tanto")] }
  ] },
  { name: "A box reeking of oil", contents: [
    { text: "Fully Loaded GunMart Bubba Buster", bc: true, loaded: true, items: [it("GunMart Bubba Buster")] },
    { text: "Fully Loaded Overlord Handcannon", bc: true, loaded: true, items: [it("Overlord Handcannon")] },
    { text: "Nomad Leathers Footwear", items: [it("Nomad Leathers Footwear")] },
    { text: "Fully Loaded Poor Quality Sniper Rifle", loaded: true, items: [it("Sniper Rifle (Poor)")] },
    { text: "Sniping Scope", items: [it("Sniping Scope")] },
    { text: "Smartgun Link", items: [it("Smartgun Link")] }
  ] },
  { name: "A box showing signs of repair", contents: [
    { text: "Utility Tomahawk", bc: true, items: [it("Utility Tomahawk")] },
    { text: "Holo Projector Palm", dlc: "Must Have Cyberware Deals", items: [it("Holo Projector Palm")] },
    { text: "Techtool", items: [it("Techtool")] },
    { text: "Audio Recorder", items: [it("Audio Recorder", 1, { type: "gear" })] },
    { text: "Armor Piercing Grenade", items: [it("Grenade (Armor-Piercing)")] },
    { text: "Techscanner Cyberware", items: [it("Techscanner", 1, { type: "cyberware" })] }
  ] }
];

/** A box's name from its Table of Mystery roll (1–10). */
export const boxName = table => MYSTERY_BOXES[table - 1]?.name ?? "A Mystery Box";

/** What's inside a box for a 1d6 roll. */
export const boxContents = (table, roll) => MYSTERY_BOXES[table - 1]?.contents[roll - 1] ?? null;

/** Every box, from the app data (`store.apps`, or the host's own): { [id]: Box }. */
export const boxesData = apps => apps?.boxes ?? {};
