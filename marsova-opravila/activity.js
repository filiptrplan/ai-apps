import { strings } from "./strings.js";
import { formatPoints, formatTime } from "./format.js";

export const KIND_TO_GROUP = {
  chore_completed: "opravila", chore_undone: "opravila",
  reward_requested: "nagrade", reward_cancelled: "nagrade", reward_approved: "nagrade", reward_declined: "nagrade", reward_fulfilled: "nagrade",
  point_adjustment: "opravila",
};

// Turns one mo_activity_log row into what a timeline row needs to render:
// title/sub/amount plus (user-side only) whether an undo control applies.
// `undoneRefIds` = ids of chore_completed rows that already have a matching
// chore_undone row; `available` decides whether undo would go negative.
export function describeEntry(entry, undoneRefIds, available) {
  const time = formatTime(entry.created_at);
  switch (entry.kind) {
    case "chore_completed": {
      const undone = undoneRefIds.has(entry.id);
      const canUndo = !undone && available - entry.delta >= 0;
      const lockUndo = !undone && !canUndo;
      return {
        emoji: entry.emoji, title: entry.title, sub: strings.log.choreSub(time),
        amountText: "+" + formatPoints(entry.delta), amountClass: "pos",
        showUndo: canUndo, showLockUndo: lockUndo,
      };
    }
    case "chore_undone":
      return { emoji: entry.emoji, title: entry.title, sub: strings.log.choreUndoneSub(time), amountText: formatPoints(entry.delta), amountClass: "dim" };
    case "reward_requested":
      return { emoji: entry.emoji, title: entry.title, sub: strings.log.requestedSub(time), amountText: formatPoints(entry.delta), amountClass: "neg" };
    case "reward_cancelled":
      return { emoji: entry.emoji, title: entry.title, sub: strings.log.cancelledSub(time), amountText: "—", amountClass: "dim" };
    case "reward_approved":
      return { emoji: entry.emoji, title: entry.title, sub: strings.log.approvedSub(time), amountText: "—", amountClass: "dim", note: entry.admin_message };
    case "reward_declined":
      return { emoji: entry.emoji, title: entry.title, sub: strings.log.declinedSub(time), amountText: "—", amountClass: "dim", note: entry.admin_message };
    case "reward_fulfilled":
      return { emoji: entry.emoji, title: entry.title, sub: strings.log.fulfilledSub(time), amountText: "—", amountClass: "dim" };
    case "point_adjustment":
      return {
        emoji: entry.emoji, title: strings.log.adjustTitle, sub: strings.log.adjustSub(time),
        amountText: (entry.delta > 0 ? "+" : "") + formatPoints(entry.delta), amountClass: entry.delta >= 0 ? "pos" : "neg",
      };
    default:
      return { emoji: "✨", title: entry.title, sub: time, amountText: "—", amountClass: "dim" };
  }
}
