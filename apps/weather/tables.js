/*
 * Night City Weather (R. Talsorian Games, 2021, free DLC): the tables and the rules, as data.
 * NCW p. 3: roll 1d6 twice on the month's table (Temperature, then Current Conditions); a 6 for
 * Current Conditions goes to Strange Weather: 1d10 for the condition, then its duration.
 * NCW pp. 4-5: what each temperature and condition does; p. 6: the gear that helps.
 * Plain data, no Foundry code. The rules text here is a short summary, with the book's page.
 */

/** The four tables, by in-world month (0 = January): Dec-Feb, Mar-May, Jun-Aug, Sep-Nov. */
export const SEASONS = [
  { id: "winter", name: "December to February" },
  { id: "spring", name: "March to May" },
  { id: "summer", name: "June to August" },
  { id: "autumn", name: "September to November" }
];

/** The table for a month (0-11). */
export const seasonOf = month => [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0][((Math.floor(month) % 12) + 12) % 12];

/** Temperature bands. Hot raises armor penalties (NCW p. 4). */
export const TEMPS = {
  cold: { name: "Cold", icon: "fas fa-temperature-low" },
  cool: { name: "Cool", icon: "fas fa-temperature-quarter" },
  warm: { name: "Warm", icon: "fas fa-temperature-half" },
  hot: { name: "Hot", icon: "fas fa-temperature-high" }
};

/**
 * Each season's 1d6 rows: [temperature band, °F, °C, condition]. As printed, including December to
 * February's 6 ("Cool, around 60°F/15°C"). "strange" sends you to the Strange Weather table.
 */
export const TABLES = [
  [["cold", 35, 2, "clear"], ["cold", 40, 4, "lightRain"], ["cold", 40, 4, "overcast"], ["cool", 50, 10, "overcast"], ["cool", 50, 10, "heavyRain"], ["cool", 60, 15, "strange"]],
  [["cold", 40, 4, "clear"], ["cool", 50, 10, "lightRain"], ["cool", 50, 10, "overcast"], ["cool", 50, 10, "lightRain"], ["warm", 60, 15, "heavyRain"], ["warm", 70, 21, "strange"]],
  [["warm", 60, 15, "lightRain"], ["warm", 70, 21, "clear"], ["warm", 70, 21, "overcast"], ["hot", 80, 27, "overcast"], ["hot", 80, 27, "clear"], ["hot", 90, 32, "strange"]],
  [["cool", 40, 4, "lightRain"], ["warm", 60, 15, "clear"], ["warm", 60, 15, "overcast"], ["warm", 60, 15, "overcast"], ["warm", 70, 21, "clear"], ["hot", 80, 27, "strange"]]
];

/** Strange Weather, 1d10 (NCW p. 3). 8 is a Cold Snap if it's Cool or Cold, a Heat Wave if Warm or Hot. */
export const STRANGE = ["radioactive", "ashStorm", "flooding", "bloodRain", "acidRain", "thunderstorm", "smog", "snapOrWave", "dustStorm", "blackout"];

/** Duration units, in seconds. */
export const UNITS = { minute: 60, hour: 3600, day: 86400 };

/*
 * Conditions. Fields:
 *   name, icon, strange       what shows; Strange Weather or a normal condition
 *   duration                  Strange Weather: { dice: 1d6, times, unit }
 *   penalty                   "GMs can, at their discretion, apply a −N penalty": a roll-dialog option, off by default
 *   penaltyWhen               what the penalty is for, on the rules card
 *   armor                     added to an existing armor penalty to REF, DEX and MOVE (Heat Wave)
 *   temp                      overrides the rolled temperature (Cold Snap, Heat Wave)
 *   rules                     the rules card's lines
 *   hazards                   the GM's tools for it (HAZARDS)
 *   protects                  gear that keeps you out of its hazards (GEAR keys)
 *   exposure                  Exposure (CP:R p. 181) applies; the gear that counts as protection
 *   page                      where it is in Night City Weather
 */
export const CONDITIONS = {
  clear: { name: "Clear", icon: "fas fa-sun", rules: ["No effect."] },
  overcast: { name: "Overcast", icon: "fas fa-cloud", rules: ["No effect."] },
  lightRain: {
    name: "Light Rain", sleet: "Light Sleet", icon: "fas fa-cloud-rain", page: 5,
    penalty: 1, penaltyWhen: "a check the wet makes harder (climbing a slippery fence, a maneuver on wet roads)",
    rules: ["Doesn't reduce visibility, but surfaces get slick."]
  },
  heavyRain: {
    name: "Heavy Rain", sleet: "Heavy Sleet", icon: "fas fa-cloud-showers-heavy", page: 5,
    penalty: 2, penaltyWhen: "any appropriate check, including Perception to see and ranged attacks at a distance",
    rules: ["Slick surfaces and poor visibility."]
  },
  radioactive: {
    name: "Radioactive Windstorm", icon: "fas fa-radiation", strange: true, duration: { times: 10, unit: "minute" }, page: 5,
    hazards: ["radburst"], protects: ["radsuit"],
    rules: ["Wind off the Hot Zone. Anyone exposed without a Radiation Suit or similar is treated as exposed to high level radiation (CP:R p. 181).", "Bursts start when the GM says, and last 1d6 Rounds."]
  },
  ashStorm: {
    name: "Ash Storm", icon: "fas fa-smog", strange: true, duration: { times: 10, unit: "minute" }, page: 4,
    penalty: 2, penaltyWhen: "any appropriate check, including Perception to see and ranged attacks at a distance",
    hazards: ["poison", "foreign"], protects: ["filter"],
    rules: [
      "More than one minute in it without Nasal Filters, an Anti-Smog Breathing Mask or similar: as if exposed to a Vial of Poison (DV13 Resist Torture/Drugs or 2d6 to HP, CP:R p. 355).",
      "They also get the Foreign Object Critical Injury, without its Bonus Damage. It can't be treated until they're out of the storm."
    ]
  },
  flooding: {
    name: "Flooding", icon: "fas fa-house-flood-water", strange: true, duration: { times: 1, unit: "day" }, page: 5,
    rules: ["Inches of water at street level; basements and tunnels can fill.", "Wading through a deeply flooded area uses the rules for other forms of movement (CP:R p. 169)."]
  },
  bloodRain: {
    name: "Blood Rain", icon: "fas fa-droplet", strange: true, duration: { times: 1, unit: "hour" }, page: 4,
    penalty: 1, penaltyWhen: "any appropriate check, including Perception to see and ranged attacks at a distance",
    protects: ["umbrella", "waterproof"],
    rules: ["Greasy, pinkish-red rain. Roll 1d6: 1-3 it works like Acid Rain (and smells worse); 4-6, once a minute, anyone exposed without protection is dosed as if with a Vial of Biotoxin (DV15 Resist Torture/Drugs or 3d6 to HP, CP:R p. 355).", "An umbrella or a Waterproof Jacket Lining gives +2 to those Resist Torture/Drugs Checks."]
  },
  acidRain: {
    name: "Acid Rain", icon: "fas fa-flask-vial", strange: true, duration: { times: 1, unit: "hour" }, page: 4,
    hazards: ["ablate"], protects: ["umbrella", "waterproof"],
    rules: ["Each full minute in it without protection ablates all worn armor by 1 SP.", "An umbrella or a Waterproof Jacket Lining negates it."]
  },
  thunderstorm: {
    name: "Deadly Thunderstorm", icon: "fas fa-cloud-bolt", strange: true, duration: { times: 10, unit: "minute" }, page: 5,
    penalty: 2, penaltyWhen: "any appropriate check, including Perception to see and ranged attacks at a distance",
    hazards: ["lightning"],
    rules: ["Every ten minutes the GM rolls 1d6: 1-3 the lightning strikes far away; 4-6 it hits the tallest structure or feature nearby, or else the tallest character or one holding a two-handed metal weapon (and anyone touching them).", "A strike is 6d6 damage to the body and counts as a flashbang grenade centred on them (CP:R p. 346)."]
  },
  smog: {
    name: "Inversion Smog", icon: "fas fa-smog", strange: true, duration: { times: 1, unit: "day" }, page: 5,
    penalty: 4, penaltyWhen: "any appropriate check, including Perception to see and ranged attacks at a distance",
    hazards: ["poison"], protects: ["filter"],
    rules: ["Smog as thick as pea soup. More than one minute in it without Nasal Filters, an Anti-Smog Breathing Mask or similar: as if exposed to a Vial of Poison (DV13 Resist Torture/Drugs or 2d6 to HP, CP:R p. 355)."]
  },
  coldSnap: {
    name: "Cold Snap", icon: "fas fa-snowflake", strange: true, duration: { times: 1, unit: "day" }, page: 4,
    temp: { temp: "cold", f: 25, c: -4, label: "Below freezing" },
    penalty: 2, penaltyWhen: "checks made on icy surfaces (black ice everywhere)",
    exposure: ["coldLining"],
    rules: ["Below freezing; overrides the rolled temperature. Exposure applies (CP:R p. 181).", "Black ice forms everywhere."]
  },
  heatWave: {
    name: "Heat Wave", icon: "fas fa-fire", strange: true, duration: { times: 1, unit: "day" }, page: 5,
    temp: { temp: "hot", f: 105, c: 41, label: "Low 100s to 110s" },
    armor: 2, exposure: ["hotLining"],
    rules: ["Overrides the rolled temperature. Exposure applies (CP:R p. 181).", "Any existing armor penalty to REF, DEX and MOVE gets 2 worse (−2 becomes −4)."]
  },
  dustStorm: {
    name: "Dust Storm", icon: "fas fa-wind", strange: true, duration: { times: 10, unit: "minute" }, page: 5,
    penalty: 2, penaltyWhen: "any appropriate check, including Perception to see and ranged attacks at a distance",
    hazards: ["foreign"], protects: ["filter"],
    rules: ["More than five minutes in it without Nasal Filters, an Anti-Smog Breathing Mask or similar: the Foreign Object Critical Injury, without its Bonus Damage. It can't be treated until they're out of the storm."]
  },
  blackout: {
    name: "Blackout", icon: "fas fa-plug-circle-xmark", strange: true, duration: { times: 1, unit: "day" }, page: 4,
    rules: ["Power, CitiNet and comms go down (1d10 blocks or zones around the crew, if random). Buildings without a generator have no power, and Agents can't call or reach the Data Pool."]
  }
};

/** What the hot temperature band does to armor (NCW p. 4): +1 to an existing armor penalty. */
export const HOT_ARMOR = 1;

/** Gear from the core book and NCW p. 6 that helps, matched by item name. */
export const GEAR = {
  umbrella: { name: "Umbrella", match: /umbrella/i },
  waterproof: { name: "Waterproof Jacket Lining", match: /waterproof (jacket )?lining/i },
  filter: { name: "Nasal Filters or an Anti-Smog Breathing Mask", match: /nasal filter|anti-?smog|breathing mask|gas mask|respirator/i },
  radsuit: { name: "Radiation Suit", match: /radiation suit|rad suit|hazmat/i },
  coldLining: { name: "Cold-Weather Jacket Lining", match: /cold-?weather (jacket )?lining/i },
  hotLining: { name: "Hot-Weather Jacket Lining", match: /hot-?weather (jacket )?lining/i }
};

/** The GM's tools for a condition's hazards (apps/weather/host.js). */
export const HAZARDS = {
  ablate: { name: "Ablate armor 1 SP", icon: "fas fa-shield-halved", hint: "For each full minute out in it: every worn armor loses 1 SP." },
  poison: { name: "Vial of Poison check", icon: "fas fa-skull-crossbones", hint: "DV13 Resist Torture/Drugs on their phones; a failure is 2d6 to HP (armor doesn't apply).", dv: 13, dice: "2d6" },
  biotoxin: { name: "Vial of Biotoxin check", icon: "fas fa-biohazard", hint: "DV15 Resist Torture/Drugs on their phones (+2 under an umbrella); a failure is 3d6 to HP (armor doesn't apply).", dv: 15, dice: "3d6" },
  foreign: { name: "Foreign Object", icon: "fas fa-lungs", hint: "Adds the Foreign Object Critical Injury (no Bonus Damage)." },
  lightning: { name: "Roll for lightning", icon: "fas fa-bolt", hint: "1d6 to chat: 1-3 far away, 4-6 a strike nearby." },
  strike: { name: "Lightning strike", icon: "fas fa-bolt-lightning", hint: "6d6 damage to the body, and a flashbang centred on them." },
  radburst: { name: "Radioactive burst", icon: "fas fa-radiation", hint: "1d6 Rounds of high level radiation (CP:R p. 181)." }
};

/**
 * Wacky the weatherman, 107.3 Morro Rock Radio: a one-liner per condition. Original lines in the spirit
 * of the book's sidebar. {f} and {c} are the temperature.
 */
export const WACKY = {
  clear: [
    "Clear skies over Night City! {f}°F, so the only thing raining on you today is your landlord.",
    "Not a cloud in sight, chooms. Get out there before something on fire changes that.",
    "Clear and {f}°F. Perfect weather for a drive-by: of the tourist sights, I mean!"
  ],
  overcast: [
    "Grey, grey, grey. {f}°F and overcast: you won't need shades, but you'll wear 'em anyway.",
    "Clouds all day, Night City. The smog's taking a breather, so the sky's covering for it.",
    "Overcast and {f}°F. Moody lighting, free of charge, courtesy of Mother Nature."
  ],
  lightRain: [
    "A little drizzle today, {f}°F. Watch your step on those fire escapes!",
    "Light rain, Night City! Your neon's gonna look gorgeous and your shoes are gonna hate you.",
    "Spitting rain all day. Drive slow, or at least drive slow-ish."
  ],
  heavyRain: [
    "It's coming down in buckets! Heavy rain all day: if you can't see the other guy, he can't see you.",
    "Big rain, Night City. Stay in, order noodles, tip your delivery guy, he's drowning out there.",
    "Heavy rain and {f}°F. Roads are slick and so is everyone on them."
  ],
  radioactive: [
    "Winds off the Hot Zone today! Radiation suit if you've got one, a very long nap if you don't.",
    "Radioactive windstorm, folks. Your Geiger counter's gonna sing. Don't sing along."
  ],
  ashStorm: [
    "Fires up north blew an ash storm our way! Nasal filters in, chooms, or you'll be coughing up the Badlands.",
    "Ash storm! Everything's grey, everything's gritty, and that's not just the economy."
  ],
  flooding: [
    "Water's coming up through the cracks again! Street level's a puddle, the basements are a swimming pool.",
    "Flooding downtown, Night City. Bring boots, leave the good chrome at home."
  ],
  bloodRain: [
    "Blood rain! Greasy, pink and smells like a corpo's conscience. Umbrellas up!",
    "The sky is crying blood, Night City! Don't drink it, don't bathe in it, don't ask what's in it."
  ],
  acidRain: [
    "Acid rain today! Your armor's gonna lose a few layers, so get under an umbrella, choom.",
    "Acid rain, Night City. Leave the leather at home unless you like it extra distressed."
  ],
  thunderstorm: [
    "Thunderstorm warning! If you're the tallest thing around, now's a great time to sit down.",
    "Lightning over Night City! Put down the big metal sword, and I mean right now."
  ],
  smog: [
    "Inversion smog, thick as pea soup! You can't see it coming and neither can the guy with the gun.",
    "Smog day, Night City! Masks on. If you can taste the air, it's already too late."
  ],
  coldSnap: [
    "Cold snap! Below freezing and black ice on every street. Walk like a penguin, chooms.",
    "It's freezing out there! Bundle up, and don't lick any lampposts."
  ],
  heatWave: [
    "Heat wave, Night City! It's gonna be hot, hot, hot: leave the heavy armor home or cook in it.",
    "Low hundreds and climbing! Your local food truck's frying on the sidewalk today."
  ],
  dustStorm: [
    "Dust storm blowing in off the Badlands! Nasal filters, goggles, and keep your mouth shut. Good advice anyway.",
    "Dust storm! Visibility's garbage and so's your sinus. Mask up."
  ],
  blackout: [
    "Grid's down in parts of town! If you're hearing this, you're on batteries. Enjoy it while it lasts.",
    "Blackout, Night City! No power, no Net, no calls. Just you and your thoughts. Scary, right?"
  ]
};
