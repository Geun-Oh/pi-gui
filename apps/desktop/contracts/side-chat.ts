import type { SessionRef } from "@pi-gui/session-driver/types";
import type { WorkspaceRecord } from "./desktop-state";
import type { TranscriptMessage } from "./timeline-types";

/**
 * A side chat is a pi branch of a thread: its session is a clone of the thread's
 * active branch at `branchedAt`, run by its own agent beside the thread. It lives in
 * that thread's side panel and never in thread lists.
 */
export interface SideChatRecord {
  /** The thread it branched from, always in the side chat's own workspace. */
  readonly parentSessionId: string;
  /** Transcript rows created before this instant are the inherited thread history. */
  readonly branchedAt: string;
}

export interface SideChatTranscript {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly transcript: readonly TranscriptMessage[];
}

export interface SendSideChatMessageInput {
  readonly target: SessionRef;
  readonly text: string;
}

/** Keyed like other per-session records: `${workspaceId}:${sessionId}`. */
export function sideChatKey(ref: SessionRef): string {
  return `${ref.workspaceId}:${ref.sessionId}`;
}

/** Side chat sessions are named `Side chat: <thread>`, then after their first question. */
export const SIDE_CHAT_TITLE_PREFIX = "Side chat: ";

/** A title from the first message: its question, or the quoted text when it has none. */
export function sideChatTitleFor(message: string): string {
  const lines = message.split("\n").map((line) => line.trim());
  const question = lines.filter((line) => line && !line.startsWith(">")).join(" ");
  const quote = lines
    .filter((line) => line.startsWith(">"))
    .map((line) => line.replace(/^>\s?/, ""))
    .join(" ");
  const text = (question || quote).replace(/\s+/g, " ").trim();
  return `${SIDE_CHAT_TITLE_PREFIX}${text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text}`;
}

/**
 * Rows the side chat added after branching, without the inherited thread history:
 * rows from before `branchedAt`, and rows the thread itself still shows (a clone keeps
 * entry identities, which also covers thread timestamps later than the branch).
 */
export function sideChatOwnRows<T extends { readonly id: string; readonly createdAt: string }>(
  transcript: readonly T[],
  branchedAt: string,
  threadRowIds: ReadonlySet<string> = new Set(),
): readonly T[] {
  const cutoff = Date.parse(branchedAt);
  return transcript.filter(
    (item) => !(Date.parse(item.createdAt) < cutoff) && !threadRowIds.has(item.id),
  );
}

/** The thread whose view shows `ref`: a side chat's parent, otherwise the session itself. */
export function threadRefForSession(
  sideChats: Readonly<Record<string, SideChatRecord>> | undefined,
  ref: SessionRef,
): SessionRef {
  const record = sideChats?.[sideChatKey(ref)];
  return record ? { workspaceId: ref.workspaceId, sessionId: record.parentSessionId } : ref;
}

/** Workspaces without their side chat sessions, for places that list or pick threads. */
export function withoutSideChats(
  workspaces: readonly WorkspaceRecord[],
  sideChats: Readonly<Record<string, SideChatRecord>>,
): WorkspaceRecord[] {
  return workspaces.map((workspace) => ({
    ...workspace,
    sessions: workspace.sessions.filter((session) => !sideChats[`${workspace.id}:${session.id}`]),
  }));
}
