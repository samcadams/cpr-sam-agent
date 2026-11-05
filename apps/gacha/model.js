import { MODULE_ID } from "../../scripts/config.js";

/*
 * Gacha: junk capsules players buy with zCreds for a digital collectible of some rarity. zCreds are
 * bought with eddies (BangMe!) in bundles, at a poor rate, and a purchase can fail (the eddies go
 * anyway). They keep collectibles on a shelf, pin favourites to its top, show them off in chat, trade
 * them, and sell duplicates back for almost nothing. The GM can turn a Legendary into a real item.
 * Duplicates work like Genshin Impact's: each spare is a level, C1 to C6, worked out from the shelf, so
 * selling or giving one away lowers it; spares past C6 are worth more (constellation(), saleValue()).
 * (Mr. Amaze's Mystery Boxes are Achieve!'s: apps/achieve/boxes.js.)
 *
 * The GM's settings: the world setting "gachaConfig", merged over GACHA_DEFAULTS.
 * The data: the host's tables "gachaShelves", "gachaPity", "gachaCreds" and "gachaFavs" (apps/manifest.js;
 * a player sees their own characters'), which gachaData() hands out:
 *   { shelves: { [actorId]: [Pull] }, pity: { [actorId]: Pity }, creds: { [actorId]: zCreds },
 *     favs: { [actorId]: [cid] } (pinned collectibles, FAV_MAX at most, in order) }
 *   (Older worlds kept the shelves in the world setting "gacha"; the host moves them, apps/gacha/host.js.)
 *   Pull: { id, cid (a collectible id), name, rarity, icon, img, ts, real: null | { name } }
 *   Pity: { sinceEpic, sinceLegendary } pulls since the character's last Epic-or-better, and Legendary
 *
 * Pity (PITY): a character's 10th pull without an Epic or better is one; from their 74th pull without
 * a Legendary its weight rises each pull, and the 90th is one. Only rarities that have collectibles
 * and a weight count, so a GM who switches Legendaries off (weight 0) gets none.
 */

export const GACHA_DEFAULTS = {
  pullCost: 160, // zCreds a pull
  // What zCreds cost in eddies: a bad rate (22-27eb a pull), and never a whole number of pulls. The
  // smallest buys none at all; the biggest is the "best value".
  bundles: [
    { eb: 10, zc: 60 },
    { eb: 50, zc: 330 },
    { eb: 120, zc: 820 },
    { eb: 300, zc: 2100 }
  ],
  failChance: 20, // % of zCred purchases that fail, charged anyway
  sell: { common: 1, uncommon: 2, rare: 3, epic: 5, legendary: 8 }, // zCreds for a duplicate
  // Per-mille weights (sum = 1000) -> 68% / 24% / 6% / 1.4% / 0.6%
  weights: { common: 680, uncommon: 240, rare: 60, epic: 14, legendary: 6 },
  collectibles: null, // the GM's own list (null: COLLECTIBLES)
  legendaryRewards: [], // what "Make it real" offers first: [{ uuid, name, img }] (none: any item)
  chat: true // show-offs in chat
};

export const RARITIES = {
  common: { name: "Common", color: "#9aa0b4" },
  uncommon: { name: "Uncommon", color: "#3ecf6e" },
  rare: { name: "Rare", color: "#3aa0ff" },
  epic: { name: "Epic", color: "#b25cff" },
  legendary: { name: "Legendary", color: "#ffb020" }
};

export const PITY = {
  epicGuarantee: 10, // every 10th pull is Epic or better if none hit
  legendarySoftStart: 74, // from pull 74, legendary chance rises each pull
  legendarySoftStep: 60, // +6% (per-mille) per pull past soft start
  legendaryHard: 90 // pull 90 is a guaranteed Legendary
};

/** Pinned favourites a character can have. */
export const FAV_MAX = 5;

/** The most curated Legendary rewards. */
export const REWARDS_MAX = 50;

/** The highest level a collectible's spares give it, and what a spare past that sells for (Genshin's ratio). */
export const CONSTELLATION_MAX = 6;
export const PAST_MAX_SELL = 2.5;

/** The weights before 1.2 were out of 100; the host moves a world's saved ones once (apps/gacha/host.js). */
export const OLD_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };

/** The Uncommons with a picture. Every Rare, Epic and Legendary has one; Commons keep their icons. */
const UNCOMMON_PICTURES = new Set(["waving-cat", "desk-bonsai", "snow-globe", "vinyl-record", "fuzzy-dice", "karaoke-mic", "game-cartridge", "gold-chain", "windup-robot", "toy-rocket", "pager", "hand-fan", "mood-ring", "real-leaf", "desert-skull"]);

/** A default collectible's picture, if it has one (images/gacha, with its CREDITS.md). */
const picture = (id, rarity) => (rarity === "common" || (rarity === "uncommon" && !UNCOMMON_PICTURES.has(id)) ? "" : `modules/${MODULE_ID}/images/gacha/${id}.webp`);

/**
 * Junk capsules' collectibles: [id, name, rarity, Font Awesome icon, a line about it]. A picture (`img`:
 * a web address or a file path) is shown instead of the icon: the GM's own can have one, and picture()
 * gives the defaults theirs.
 */
export const COLLECTIBLES = [
  // Common: street junk, cheap snacks, little sad things
  ["pixel-pigeon", "Pixel Pigeon", "common", "fa-crow", "Flappy flappy flappy"],
  ["noodle-cup", "Noodle Cup", "common", "fa-mug-hot", "Mmmmmmm yum"],
  ["glitch-cat", "Glitch Cat", "common", "fa-cat", "Me..... ow?"],
  ["lucky-die", "Lucky Die", "common", "fa-dice-six", "Six... six.... six-FUCK"],
  ["retro-floppy", "Retro Floppy", "common", "fa-floppy-disk", "This ain't shit compared to a data shard."],
  ["rainy-window", "Rainy Window", "common", "fa-cloud-rain", "My tea's gone cold, I'm wondering why..."],
  ["static-screen", "Static Screen", "common", "fa-tv", "God damn blackouts."],
  ["toxic-puddle", "Toxic Puddle", "common", "fa-droplet", "Mmmh, refreshing!"],
  ["neon-heart", "Neon Heart", "common", "fa-heart", "Don't drop it."],
  ["dancing-cactus", "Dancing Cactus", "common", "fa-seedling", "Punch it, and it dances!"],
  ["spinning-coin", "Spinning Coin", "common", "fa-coins", "Rotates."],
  ["sad-battery", "Sad Battery", "common", "fa-battery-quarter", "Aww :("],
  ["rice-ball", "Rice Ball Buddy", "common", "fa-bowl-rice", "Yummy... not edible"],
  ["bubble-tea", "Bubble Tea", "common", "fa-glass-water", "Microplastics straight to the gut"],
  ["empty-capsule", "Empty Capsule", "common", "fa-egg", "Well that's a bummer."],
  ["transit-pass", "Expired Transit Pass", "common", "fa-bus", "Fuck."],
  ["neon-tube", "Neon Tube", "common", "fa-lightbulb", "Emits a little buzz"],
  ["rubber-duck", "Rubber Duck", "common", "fa-kiwi-bird", "Quack!"],
  ["paper-crane", "Paper Crane", "common", "fa-dove", "How cute!"],
  ["smiley-sticker", "Smiley Sticker", "common", "fa-face-smile", "Peeling at one corner."],
  ["fortune-cookie", "Fortune Cookie", "common", "fa-cookie", "Fortune: \"Shit blown smooth off.\""],
  ["clear-umbrella", "Clear Umbrella", "common", "fa-umbrella", "Found, lost, found by someone else."],
  ["burned-disc", "Burned Disc", "common", "fa-compact-disc", "Track 4 skips. Track 4 is the good one."],
  ["flip-phone", "Flip Phone", "common", "fa-mobile-retro", "Snap it shut to end an argument."],
  ["mystery-key", "Mystery Key", "common", "fa-key", "Opens something. Somewhere."],
  ["single-sock", "Single Sock", "common", "fa-socks", "Its partner is out there."],
  ["traffic-cone", "Traffic Cone", "common", "fa-road-barrier", "Wherever it goes, it's in the way."],
  ["hotel-soap", "Hotel Soap", "common", "fa-soap", "Unwrapped. Unused. Untrusted."],
  ["synthcoffee", "Synthcoffee", "common", "fa-mug-saucer", "Tastes like brown."],
  ["dead-pixel", "Dead Pixel", "common", "fa-square", "Rare in screens. Common here."],
  ["cartoon-bandage", "Cartoon Bandage", "common", "fa-bandage", "Covers nothing important."],
  ["street-dog", "Street Dog", "common", "fa-hotdog", "Meat: legally."],
  ["cold-pizza", "Cold Pizza", "common", "fa-pizza-slice", "Better than it has any right to be."],
  ["wiped-chip", "Wiped Chip", "common", "fa-sd-card", "Formatted, wiped, and wiped again."],
  ["cracked-shades", "Cracked Shades", "common", "fa-glasses", "Still cooler than you."],
  ["tangled-earbuds", "Tangled Earbuds", "common", "fa-headphones", "Can't be untangled. Collect as-is."],
  ["lost-glove", "Lost Glove", "common", "fa-mitten", "Waving from a fence post."],
  ["ice-cube", "Ice Cube", "common", "fa-cube", "Melts in forty seconds. Collect quickly."],
  ["plastic-ring", "Plastic Ring", "common", "fa-ring", "Means nothing. Means everything."],
  ["little-cloud", "Little Cloud", "common", "fa-cloud", "Follows you. Rains on you, specifically."],
  ["plastic-sushi", "Plastic Sushi", "common", "fa-fish", "Display model. Do not eat. People do."],
  ["pothole", "Pothole", "common", "fa-road", "It's been there longer than you have."],
  ["unskippable-ad", "Unskippable Ad", "common", "fa-rectangle-ad", "Watch to the end to receive nothing."],
  ["long-receipt", "Very Long Receipt", "common", "fa-receipt", "Three items. Nine feet of paper."],
  ["chewed-gum", "Chewed Gum", "common", "fa-face-grin-tongue", "The flavor's gone. The personality remains."],
  ["thumbtack", "Thumbtack", "common", "fa-thumbtack", "Holds up the important stuff."],
  ["earthworm", "Earthworm", "common", "fa-worm", "Found in actual soil. Remarkable."],
  ["jar-smog", "Jar of Smog", "common", "fa-smog", "Local air. Limited shelf life (yours)."],
  ["broken-compass", "Broken Compass", "common", "fa-compass", "Points at whatever you're avoiding."],
  ["paw-print", "Muddy Paw Print", "common", "fa-paw", "Something walked across your screen."],
  ["sticky-note", "Sticky Note", "common", "fa-note-sticky", "Says DON'T FORGET. Doesn't say what."],
  ["bent-paperclip", "Bent Paperclip", "common", "fa-paperclip", "Tried to be a lockpick. Didn't work."],
  ["late-notice", "Late Notice", "common", "fa-file-lines", "Rent was due yesterday. And the day before."],
  ["vat-bacon", "Vat Bacon", "common", "fa-bacon", "Grown in a tank. Crispy in spirit."],
  ["burnt-toast", "Burnt Toast", "common", "fa-bread-slice", "Your toaster has opinions."],
  ["baby-tooth", "Baby Tooth", "common", "fa-tooth", "Whose? Unclear."],
  ["foam-earplug", "Foam Earplug", "common", "fa-ear-deaf", "For sleeping next to the freeway."],
  ["raffle-ticket", "Raffle Ticket", "common", "fa-ticket", "Number 4471. They drew 4472."],
  ["traffic-light", "Traffic Light", "common", "fa-traffic-light", "Stuck on yellow. Living dangerously."],
  ["spare-button", "Spare Button", "common", "fa-circle-dot", "Came with the jacket. Outlived the jacket."],

  // Uncommon: desk toys, fashion, knockoffs, pocket tech
  ["holo-koi", "Holo Koi", "uncommon", "fa-fish-fins", "Swims around your screen. Grants no luck."],
  ["waving-cat", "Waving Cat", "uncommon", "fa-hand", "Waves. Won't stop waving."],
  ["desk-bonsai", "Desk Bonsai", "uncommon", "fa-tree", "Older than your building. Treat it better."],
  ["glow-shrimp", "Glow Shrimp", "uncommon", "fa-shrimp", "Lives in a cube of blue gel. Seems happy."],
  ["snow-globe", "Snow Globe", "uncommon", "fa-snowflake", "The only snow you'll see this year."],
  ["protection-charm", "Protection Charm", "uncommon", "fa-hamsa", "Protects against bad luck. Not bullets."],
  ["pocket-pet", "Pocket Pet", "uncommon", "fa-egg", "Hatches into something. Dies if ignored."],
  ["idol-card", "Idol Trading Card", "uncommon", "fa-star", "Mint condition. You've never heard of her."],
  ["mascot-pin", "Mascot Pin", "uncommon", "fa-face-grin-stars", "A smiling bean. It sells insurance."],
  ["synth-feather", "Synthetic Feather", "uncommon", "fa-feather", "From a bird that was never real."],
  ["cat-headphones", "Cat-Ear Headphones", "uncommon", "fa-headphones-simple", "The ears light up when the bass hits."],
  ["pocket-boombox", "Pocket Boombox", "uncommon", "fa-radio", "Plays one song on loop. You'll learn to love it."],
  ["high-score", "High Score Plaque", "uncommon", "fa-trophy", "AAA. 9,999,999. Nobody knows who AAA is."],
  ["vinyl-record", "Vinyl Record", "uncommon", "fa-record-vinyl", "Nobody owns a player. Doesn't matter."],
  ["hoverboard-decal", "Hoverboard Decal", "uncommon", "fa-person-skating", "Doesn't hover. Barely boards."],
  ["chrome-grin", "Chrome Grin", "uncommon", "fa-teeth", "Shiny. Opens bottles."],
  ["glow-lipstick", "Glow Lipstick", "uncommon", "fa-face-kiss-wink-heart", "Shade: Plausible Deniability."],
  ["flash-sheet", "Flash Tattoo Sheet", "uncommon", "fa-pen-nib", "Moves when you flex. Peels when you sweat."],
  ["eye-color-pack", "Eye Color Pack", "uncommon", "fa-eye", "Seven shades of \"I'm fine.\""],
  ["holo-hair-dye", "Holo Hair Dye", "uncommon", "fa-palette", "Washes out in one rain. So, tomorrow."],
  ["knockoff-bag", "Knockoff Handbag", "uncommon", "fa-bag-shopping", "Lois Vuitten. Close enough."],
  ["fake-watch", "Fake Watch", "uncommon", "fa-clock", "Right twice a day."],
  ["karaoke-mic", "Karaoke Mic", "uncommon", "fa-microphone", "Autotune stuck on maximum."],
  ["bootleg-recording", "Bootleg Recording", "uncommon", "fa-film", "The label says BEACH DAY. It is not a beach day."],
  ["shaved-ice", "Shaved Ice", "uncommon", "fa-ice-cream", "Flavor: Blue."],
  ["fuzzy-dice", "Fuzzy Dice", "uncommon", "fa-dice", "Hang them in the car you don't have."],
  ["tiny-apartment", "Tiny Apartment", "uncommon", "fa-house", "Four square meters. Still bigger than yours."],
  ["vending-machine", "Talking Vending Machine", "uncommon", "fa-cash-register", "Says thank you in nine languages. Never vends."],
  ["desert-skull", "Desert Skull", "uncommon", "fa-skull-crossbones", "Adds character to any room."],
  ["filter-mask", "Designer Filter Mask", "uncommon", "fa-mask-face", "Breathes easy. Looks better."],
  ["damp-banknote", "Damp Banknote", "uncommon", "fa-money-bill-wave", "Laundered. Still slightly wet."],
  ["real-leaf", "Real Leaf", "uncommon", "fa-leaf", "Grew on an actual tree. Smell it."],
  ["plush-meteor", "Plush Meteor", "uncommon", "fa-meteor", "Soft. Incoming."],
  ["windup-robot", "Wind-Up Robot", "uncommon", "fa-robot", "Walks into walls with total confidence."],
  ["toy-rocket", "Toy Rocket", "uncommon", "fa-rocket", "Went further than you ever will."],
  ["pager", "Pager", "uncommon", "fa-tower-broadcast", "Still beeping with messages from 2004."],
  ["hand-fan", "Hand Fan", "uncommon", "fa-fan", "Moves the hot air somewhere else."],
  ["mini-neon-sign", "Mini Neon Sign", "uncommon", "fa-sign-hanging", "Says OPEN. You're not."],
  ["gold-chain", "Gold Chain", "uncommon", "fa-link", "Plated. Heavily plated."],
  ["game-cartridge", "Game Cartridge", "uncommon", "fa-gamepad", "Blow on it first."],
  ["blender", "Blender", "uncommon", "fa-blender", "Blends anything. Has blended things it shouldn't."],
  ["hollow-dumbbell", "Hollow Dumbbell", "uncommon", "fa-dumbbell", "For the photo."],
  ["scratch-card", "Scratch Card", "uncommon", "fa-ticket-simple", "Scratched. Lost. Framed it anyway."],
  ["mood-ring", "Mood Ring", "uncommon", "fa-circle-half-stroke", "Stuck on \"anxious.\" Probably accurate."],
  ["lucky-cat-keychain", "Cat Keychain", "uncommon", "fa-cat", "Jingles. Bites (gently)."],

  // Rare: real nature, antiques, fine things
  ["honeybee", "Honeybee", "rare", "fa-bug", "A real one, in resin. Ask your grandmother what they did."],
  ["clean-raindrop", "Clean Raindrop", "rare", "fa-droplet-slash", "Tested, certified, clear. Not from around here."],
  ["goldfish", "Goldfish", "rare", "fa-fish", "Has outlived three owners."],
  ["bottled-sunbeam", "Bottled Sunbeam", "rare", "fa-sun", "Ten minutes of unfiltered afternoon."],
  ["birdsong", "Birdsong Recording", "rare", "fa-dove", "A sparrow, recorded 2011. Play it when it's quiet."],
  ["neon-sword", "Neon Sword Charm", "rare", "fa-bolt", "Lights up. Cuts nothing."],
  ["vintage-vr", "Vintage VR Headset", "rare", "fa-vr-cardboard", "Cardboard. Sincere."],
  ["tiny-crt", "Tiny CRT", "rare", "fa-desktop", "Hums at a frequency only dogs and nostalgia can hear."],
  ["chrome-skull", "Chrome Skull", "rare", "fa-skull", "Polished to a mirror. Mostly decorative."],
  ["four-leaf-clover", "Four-Leaf Clover", "rare", "fa-clover", "Grown wild. No lab. Genuinely lucky, allegedly."],
  ["holo-idol", "Holo Idol Figure", "rare", "fa-person-dress", "Dances a twelve-second loop. Sings off-key."],
  ["pet-drone", "Pet Drone", "rare", "fa-plane-up", "Follows you everywhere. Reports to someone."],
  ["fox-mask", "Fox Mask", "rare", "fa-masks-theater", "A festival mask. Hides a face nicely."],
  ["data-crystal", "Data Crystal", "rare", "fa-gem", "A poem in every facet. Nobody's read them."],
  ["lava-lamp", "Lava Lamp", "rare", "fa-flask", "Wax goes up. Wax comes down. Time passes."],
  ["classic-car", "Classic Car Model", "rare", "fa-car", "Ran on gasoline. Imagine."],
  ["jukebox-token", "Jukebox Token", "rare", "fa-music", "Plays any song. They're all the same song."],
  ["polar-bear-photo", "Polar Bear Photo", "rare", "fa-camera", "A real bear on real ice. Wild."],
  ["antique-smartphone", "Antique Smartphone", "rare", "fa-mobile-screen", "One screen, one camera, one whole life."],
  ["haunted-arcade", "Haunted Arcade Cabinet", "rare", "fa-ghost", "Plays itself at 3 a.m. Wins."],
  ["real-snowflake", "Real Snowflake", "rare", "fa-snowflake", "Preserved at forty below. Every one's different."],
  ["real-rose", "Real Rose", "rare", "fa-spa", "Grown in dirt, under sky. Thorns included."],
  ["silk-tie", "Silk Tie", "rare", "fa-user-tie", "Worn to one promotion and two layoffs."],
  ["waving-cyberarm", "Waving Cyberarm", "rare", "fa-hand-back-fist", "Waves at you from the shelf. Full chrome."],
  ["square-of-grass", "Square of Grass", "rare", "fa-seedling", "One square foot. Go on, touch it."],
  ["giant-robot", "Giant Robot Figure", "rare", "fa-shield-halved", "Poseable. Transforms into a slightly different robot."],
  ["glass-heart", "Glass Heart", "rare", "fa-heart-pulse", "Beats. Breaks. Replaceable."],
  ["piggy-bank", "Piggy Bank", "rare", "fa-piggy-bank", "Shake it. Something rattles. Probably a bolt."],
  ["firework", "Firework", "rare", "fa-burst", "Goes off once on your screen. Then it's just smoke."],
  ["gold-phone-shell", "Gold Phone Shell", "rare", "fa-mobile-screen-button", "Ostentatious. Excellent."],

  // Epic: things that are mostly gone
  ["captured-aurora", "Captured Aurora", "epic", "fa-wand-magic-sparkles", "Northern lights in a jar. Shimmers when you're not looking."],
  ["whale-song", "Whale Song", "epic", "fa-water", "The last recorded humpback. Turn it up."],
  ["starfield", "Starfield", "epic", "fa-star", "The night sky with no light pollution. Looks fake."],
  ["pocket-dragon", "Pocket Dragon", "epic", "fa-dragon", "Curls around your clock. Sneezes sparks."],
  ["fountain-pen", "Exec Fountain Pen", "epic", "fa-pen-fancy", "Signs contracts. Ends careers. Writes smooth."],
  ["skyline-diorama", "City Skyline Diorama", "epic", "fa-city", "Every window a story. Most of them sad."],
  ["island-deed", "Island Deed", "epic", "fa-umbrella-beach", "One square meter of an island. Underwater since '38."],
  ["snowman", "Snowman", "epic", "fa-snowman", "A whole snowman. Melting as you read this."],
  ["dart-frog", "Poison Dart Frog", "epic", "fa-frog", "Real. Tiny. Lethal. Adorable."],
  ["chrome-motorcycle", "Chrome Motorcycle", "epic", "fa-motorcycle", "A model bike. Revs if you blow on it."],
  ["orbital-postcard", "Orbital Postcard", "epic", "fa-satellite", "Wish you were here. (You can't afford here.)"],
  ["penthouse-keycard", "Penthouse Keycard", "epic", "fa-id-card", "Floor 140. The card works. You won't."],
  ["sealed-console", "Sealed Game Console", "epic", "fa-gamepad", "Never opened. Worth more than your apartment."],
  ["robot-butler", "Robot Butler", "epic", "fa-bell-concierge", "Tiny. Bows. Judges your posture."],
  ["mechanical-watch", "Mechanical Watch", "epic", "fa-stopwatch", "No battery, no chip, no Net. Just gears. Unsettling."],

  // Legendary: impossible things
  ["golden-pigeon", "Golden Chromed Pigeon", "legendary", "fa-crow", "The best score on the board, made solid."],
  ["whole-tree", "A Whole Tree", "legendary", "fa-tree", "A real, living tree, held in trust. You'll never see it."],
  ["blue-sky", "Blue Sky", "legendary", "fa-cloud-sun", "A cloudless sky, filmed in 1997. Hard to look at."],
  ["pygmy-hippo", "Pygmy Hippo", "legendary", "fa-hippo", "Last of its kind, digitally preserved. Very round."],
  ["empty-box", "Empty Box", "legendary", "fa-box-open", "The rarest pull there is. Contains nothing. Priced accordingly."],
  ["moon-rock", "Moon Rock", "legendary", "fa-moon", "Authenticated. Actually from the moon. Smells like gunpowder."],
  ["black-card", "Black Card", "legendary", "fa-credit-card", "No limit. Not your name."],
  ["golden-crown", "Golden Crown", "legendary", "fa-crown", "King of the capsule machine."],
  ["old-website", "An Old Website", "legendary", "fa-globe", "One page from the old Net, from before it went bad."],
  ["your-face", "Your Face", "legendary", "fa-face-meh", "Somebody trademarked it. This is your licensed copy."],
  ["unopened-capsule", "Unopened Capsule", "legendary", "fa-gift", "Nobody knows what's inside. Nobody ever will."]
].map(([id, name, rarity, icon, text]) => ({ id, name, rarity, icon, img: picture(id, rarity), text }));

export function gachaConfig() {
  const saved = game.settings.get(MODULE_ID, "gachaConfig") ?? {};
  const bundles = GACHA_DEFAULTS.bundles.map((b, i) => ({ ...b, ...(saved.bundles?.[i] ?? {}) }));
  return { ...GACHA_DEFAULTS, ...saved, bundles, weights: { ...GACHA_DEFAULTS.weights, ...(saved.weights ?? {}) }, sell: { ...GACHA_DEFAULTS.sell, ...(saved.sell ?? {}) }, legendaryRewards: cleanRewards(saved.legendaryRewards) };
}

/** zCreds as the phone writes them: "1,050 zC". */
export const formatCreds = n => `${Math.floor(Number(n) || 0).toLocaleString()} zC`;

/**
 * The pulls on a shelf that can be sold: every copy of a collectible but one. The one kept is one
 * made real (if any), else the oldest. Newest first.
 */
export function duplicates(shelf = []) {
  const keep = new Map();
  for (const p of [...shelf].sort((a, b) => a.ts - b.ts)) {
    const k = keep.get(p.cid);
    if (!k || (p.real && !k.real)) keep.set(p.cid, p);
  }
  const kept = new Set([...keep.values()].map(p => p.id));
  return shelf.filter(p => !kept.has(p.id)).sort((a, b) => b.ts - a.ts);
}

/** What `count` copies of a collectible add up to: its level, and the spares past the highest one. */
export function constellation(count) {
  const spares = Math.max(0, count - 1);
  return { level: Math.min(spares, CONSTELLATION_MAX), over: Math.max(0, spares - CONSTELLATION_MAX) };
}

/** What selling these pulls off this shelf pays, one at a time: `sell` by rarity, more for a spare past the highest level. */
export function saleValue(shelf = [], sold = [], sell = {}) {
  const copies = new Map();
  for (const p of shelf) copies.set(p.cid, (copies.get(p.cid) ?? 0) + 1);
  return sold.reduce((zc, p) => {
    const count = copies.get(p.cid) ?? 1;
    copies.set(p.cid, count - 1);
    const price = Math.max(0, Math.floor(Number(sell[p.rarity]) || 0));
    return zc + (constellation(count).over ? Math.round(price * PAST_MAX_SELL) : price);
  }, 0);
}

/** A picture's address: http(s), or a path on the Foundry server (nothing like javascript:). */
export function cleanImg(img) {
  const src = String(img ?? "").trim().slice(0, 500);
  return /^https?:\/\//i.test(src) || !/^[a-z][a-z0-9+.-]*:/i.test(src) ? src : "";
}

/** A collectible as the GM wrote it, in range. */
export function cleanCollectible(c = {}) {
  const name = String(c.name ?? "").trim().slice(0, 60) || "Collectible";
  return {
    id: String(c.id ?? "").trim() || `c-${foundry.utils.randomID(8)}`,
    name,
    rarity: RARITIES[c.rarity] ? c.rarity : "common",
    icon: /^fa-[a-z0-9-]+$/.test(String(c.icon ?? "").trim()) ? c.icon.trim() : "fa-cube",
    img: cleanImg(c.img),
    text: String(c.text ?? "").trim().slice(0, 200)
  };
}

export const collectibles = (cfg = gachaConfig()) => (cfg.collectibles ?? COLLECTIBLES).map(cleanCollectible);

/** The GM's curated Legendary rewards, in range: Items by uuid, each once, REWARDS_MAX at most. */
export function cleanRewards(list) {
  const uuids = new Set();
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    const uuid = String(r?.uuid ?? "").trim();
    if (!/^(Compendium|Item|Actor|Scene)\.[\w.-]+$/.test(uuid) || uuids.has(uuid)) continue;
    uuids.add(uuid);
    out.push({ uuid, name: String(r.name ?? "").trim().slice(0, 100) || "Reward", img: cleanImg(r.img) });
  }
  return out.slice(0, REWARDS_MAX);
}

/** A rarity for a pull (weights by rarity; `r` in [0, 1)). Only rarities that have collectibles count. */
export function rollRarity(weights, list, r = Math.random()) {
  const have = Object.keys(RARITIES).filter(k => list.some(c => c.rarity === k) && Number(weights[k]) > 0);
  const total = have.reduce((n, k) => n + Number(weights[k]), 0);
  let at = r * total;
  for (const k of have) {
    at -= Number(weights[k]);
    if (at < 0) return k;
  }
  return have.at(-1) ?? null;
}

const RANK = Object.keys(RARITIES);
const EPIC = RANK.indexOf("epic");

/**
 * The weights for a character's next pull, with pity (PITY): `pity` is their counters before it. The
 * soft step is per mille of the GM's total, so it means the same whatever the weights add up to.
 */
export function pityWeights(weights, list, pity = {}) {
  const has = k => list.some(c => c.rarity === k) && Number(weights[k]) > 0;
  const total = RANK.filter(has).reduce((n, k) => n + Number(weights[k]), 0);
  const nth = (pity.sinceLegendary ?? 0) + 1; // this pull, counted since the last Legendary
  if (nth >= PITY.legendaryHard && has("legendary")) return { legendary: 1 };
  const w = { ...weights };
  if (nth >= PITY.legendarySoftStart && has("legendary")) {
    w.legendary = Number(w.legendary) + ((nth - (PITY.legendarySoftStart - 1)) * PITY.legendarySoftStep * total) / 1000;
  }
  if ((pity.sinceEpic ?? 0) + 1 >= PITY.epicGuarantee && RANK.slice(EPIC).some(has)) {
    for (const k of RANK.slice(0, EPIC)) w[k] = 0;
  }
  return w;
}

/** The counters after a pull of this rarity: an Epic or better resets one, a Legendary both. */
export function nextPity(pity = {}, rarity) {
  if (rarity === "legendary") return { sinceEpic: 0, sinceLegendary: 0 };
  const sinceLegendary = (pity.sinceLegendary ?? 0) + 1;
  return { sinceEpic: RANK.indexOf(rarity) >= EPIC ? 0 : (pity.sinceEpic ?? 0) + 1, sinceLegendary };
}

/** A pull: a collectible of a rolled rarity (with the character's pity counters, if given). */
export function pullCollectible(cfg, rand = Math.random, pity = {}) {
  const list = collectibles(cfg);
  const rarity = rollRarity(pityWeights(cfg.weights, list, pity), list, rand());
  const pool = list.filter(c => c.rarity === rarity);
  return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
}

/** Odds as percentages, for the phone: { rarity: "12.5" }. */
export function odds(weights, list) {
  const have = Object.keys(RARITIES).filter(k => list.some(c => c.rarity === k) && Number(weights[k]) > 0);
  const total = have.reduce((n, k) => n + Number(weights[k]), 0) || 1;
  return Object.fromEntries(have.map(k => [k, ((Number(weights[k]) / total) * 100).toFixed(Number(weights[k]) / total < 0.1 ? 1 : 0)]));
}

/** The shelves, pity counters, zCreds and favourites, from the app data (`store.apps`, or the host's own). */
export const gachaData = apps => ({
  shelves: apps?.gachaShelves ?? {},
  pity: apps?.gachaPity ?? {},
  creds: apps?.gachaCreds ?? {},
  favs: apps?.gachaFavs ?? {}
});
