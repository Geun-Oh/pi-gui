/** Longest selection kept as a quote; the model gets the thread itself as context anyway. */
export const MAX_SIDE_CHAT_QUOTE_LENGTH = 8_000;

/** What the user is writing in one side chat, kept while its tab is not showing. */
export interface SideChatDraft {
  readonly text: string;
  /** Text selected in the thread and attached with "Ask in side chat". */
  readonly quote: string;
}

export const EMPTY_SIDE_CHAT_DRAFT: SideChatDraft = { text: "", quote: "" };

/** Normalise text selected in the transcript into a quote. */
export function quoteFromSelection(selected: string): string {
  const normalized = selected
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.length > MAX_SIDE_CHAT_QUOTE_LENGTH
    ? `${normalized.slice(0, MAX_SIDE_CHAT_QUOTE_LENGTH).trimEnd()}…`
    : normalized;
}

/** The message sent to the side chat: the quote as a Markdown block quote, then the question. */
export function composeSideChatMessage(draft: SideChatDraft): string {
  const question = draft.text.trim();
  const quote = draft.quote.trim();
  if (!quote) return question;
  const block = quote
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return question ? `${block}\n\n${question}` : block;
}
