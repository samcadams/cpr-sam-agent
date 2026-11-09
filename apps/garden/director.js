import { store } from "../../scripts/store.js";
import { gardenWriterOn } from "../../scripts/model/features.js";

/*
 * The Garden in the GM Director (scripts/ui/director/): each draft batch from the garden-writer
 * skill waiting in the Dashboard's "Waiting on you", with Review opening the Garden's Drafts page.
 */

/** Draft batches waiting, as approval rows (see ui/director/views/dashboard.js). None while the writer's tools are hidden. */
export function approvals() {
  if (!gardenWriterOn()) return [];
  return Object.values(store.garden.drafts?.batches ?? {}).map(batch => ({
    key: batch.id,
    ts: batch.ts,
    source: "The Garden",
    title: `Writer batch ${batch.id}${batch.errors?.length ? ` (${batch.errors.length} error${batch.errors.length > 1 ? "s" : ""})` : ""}`,
    detail: batch.summary ?? "",
    actions: [{ action: "goto", label: "Review", primary: true, data: { tab: "garden", gardenTab: "drafts" } }]
  }));
}
