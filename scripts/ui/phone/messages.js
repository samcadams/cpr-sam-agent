/* Helpers for showing messages, shared by the phone's pages. */

/** Messages for a conversation page: common fields plus `map(m, i)`, with a date line when the day changes. */
export function datedMessages(raw, map) {
  let lastDate = null;
  return raw.map((m, i) => {
    const dateLabel = m.date && m.date !== lastDate ? m.date : null;
    if (m.date) lastDate = m.date;
    return {
      id: m.id,
      text: m.text,
      time: m.time,
      dateLabel,
      system: m.system,
      call: m.call,
      location: m.location,
      image: m.image,
      rawMoney: m.money,
      ...map(m, i)
    };
  });
}

const JOB_STATUS = { offered: "Offer", accepted: "Accepted", declined: "Declined" };

/**
 * A job offer in a message, as a card. canRespond: this phone is the one the offer is for (and can
 * use its phone right now).
 */
export function jobCard(message, canRespond) {
  const job = message.job;
  if (!job) return null;
  return {
    ...job,
    statusLabel: job.by && job.status !== "offered" ? `${JOB_STATUS[job.status]} · ${job.by}` : JOB_STATUS[job.status],
    canRespond: canRespond && job.status === "offered",
    canOpen: job.status === "accepted"
  };
}

/** Group a message's reactions into chips: [{ emoji, count, mine }]. */
export function reactionChips(message, myKey) {
  const chips = new Map();
  for (const [key, emoji] of Object.entries(message.reactions ?? {})) {
    const chip = chips.get(emoji) ?? { emoji, count: 0, mine: false };
    chip.count += 1;
    chip.label = chip.count > 1 ? chip.count : "";
    if (key === myKey) chip.mine = true;
    chips.set(emoji, chip);
  }
  return [...chips.values()];
}

/**
 * Inbox preview: the latest message, unless someone reacted more recently.
 * @returns {{ preview: string, ts: number }}
 */
export function latest(thread, messagePreview) {
  const last = thread?.messages.at(-1);
  const reaction = thread?.lastReaction;
  if (reaction && reaction.ts > (last?.ts ?? 0)) {
    const who = reaction.userId === game.user.id ? "You" : reaction.by;
    return { preview: `${who} reacted with ${reaction.emoji}`, ts: reaction.ts };
  }
  return { preview: messagePreview, ts: last?.ts ?? 0 };
}
