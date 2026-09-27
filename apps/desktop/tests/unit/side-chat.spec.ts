import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createEmptyDesktopAppState,
  type SessionRecord,
  type WorkspaceRecord,
} from "../../contracts/desktop-state";
import { sideChatOwnRows, sideChatTitleFor, threadRefForSession } from "../../contracts/side-chat";
import { decodeTaskWorkbenchTemplate, toolRefId, type ToolRef } from "../../contracts/workbench";
import {
  decodePersistedUiState,
  readPersistedUiState,
  writePersistedUiState,
} from "../../electron/persistence/app-store-persistence";
import {
  composeSideChatMessage,
  MAX_SIDE_CHAT_QUOTE_LENGTH,
  quoteFromSelection,
} from "../../src/features/side-chat/side-chat-messages";
import { buildThreadSidebarModel } from "../../src/features/threads/thread-groups";
import { desktopCommands, getDesktopCommandFromShortcut } from "../../contracts/ipc";

test("Command+Option+S opens a side chat, even when Option makes the key ß", () => {
  const chord = { modifier: true, alt: true, shift: false };
  expect(getDesktopCommandFromShortcut({ ...chord, key: "s", code: "KeyS" })).toBe(
    desktopCommands.openSideChat,
  );
  expect(getDesktopCommandFromShortcut({ ...chord, key: "ß", code: "KeyS" })).toBe(
    desktopCommands.openSideChat,
  );
  expect(
    getDesktopCommandFromShortcut({ ...chord, shift: true, key: "S", code: "KeyS" }),
  ).toBeUndefined();
  expect(
    getDesktopCommandFromShortcut({ modifier: true, shift: false, key: "s", code: "KeyS" }),
  ).toBeUndefined();
});

const row = (id: string, createdAt: string) => ({ id, createdAt });

test("a side chat shows only the rows it added after branching", () => {
  const branchedAt = "2026-09-26T10:00:00.000Z";
  const transcript = [
    row("inherited-question", "2026-09-26T09:58:00.000Z"),
    // A thread row stamped after the branch (clock skew) is still inherited by identity.
    row("inherited-future-answer", "2026-09-26T10:05:00.000Z"),
    row("side-question", "2026-09-26T10:01:00.000Z"),
    row("side-answer", "2026-09-26T10:01:05.000Z"),
  ];
  const threadRows = new Set(["inherited-question", "inherited-future-answer"]);
  expect(sideChatOwnRows(transcript, branchedAt, threadRows).map((item) => item.id)).toEqual([
    "side-question",
    "side-answer",
  ]);
  // Without the thread's rows (main process), the branch instant alone decides.
  expect(sideChatOwnRows(transcript, branchedAt).map((item) => item.id)).toEqual([
    "inherited-future-answer",
    "side-question",
    "side-answer",
  ]);
});

test("the selected text is attached as a block quote above the question", () => {
  const quote = quoteFromSelection("  Send an Idempotency-Key\r\n\r\n\r\n\r\nheader\u00a0please  ");
  expect(quote).toBe("Send an Idempotency-Key\n\nheader please");
  expect(composeSideChatMessage({ quote, text: "  Why?  " })).toBe(
    "> Send an Idempotency-Key\n>\n> header please\n\nWhy?",
  );
  expect(composeSideChatMessage({ quote: "", text: "Just a question" })).toBe("Just a question");
  expect(composeSideChatMessage({ quote: "Only a quote", text: " " })).toBe("> Only a quote");
  expect(quoteFromSelection("x".repeat(MAX_SIDE_CHAT_QUOTE_LENGTH + 50))).toHaveLength(
    MAX_SIDE_CHAT_QUOTE_LENGTH + 1,
  );
});

test("a side chat is named after its first question, or its quote", () => {
  expect(sideChatTitleFor("> Send the header\n\nWhy does this matter?")).toBe(
    "Side chat: Why does this matter?",
  );
  expect(sideChatTitleFor("> Send the header\n> on every request")).toBe(
    "Side chat: Send the header on every request",
  );
  expect(sideChatTitleFor("word ".repeat(40))).toHaveLength("Side chat: ".length + 60);
});

test("notifications and fallbacks resolve a side chat to its thread", () => {
  const sideChats = { "ws:side": { parentSessionId: "thread", branchedAt: "" } };
  expect(threadRefForSession(sideChats, { workspaceId: "ws", sessionId: "side" })).toEqual({
    workspaceId: "ws",
    sessionId: "thread",
  });
  expect(threadRefForSession(sideChats, { workspaceId: "ws", sessionId: "thread" })).toEqual({
    workspaceId: "ws",
    sessionId: "thread",
  });
});

function template(tools: readonly unknown[]) {
  return {
    visibility: "visible",
    tools,
    selection: { kind: "chooser" },
    files: {
      workspaceId: "ws",
      tabs: { tabs: [], active: null, line: null, lineNonce: 0, retained: [] },
    },
    changes: { workspaceId: "ws", selectedPath: null, scope: { kind: "uncommitted" } },
  };
}

test("workbench layouts keep one tab per side chat and reject mixed tool fields", () => {
  const first: ToolRef = { kind: "side-chat", sessionId: "side-1" };
  const second: ToolRef = { kind: "side-chat", sessionId: "side-2" };
  const decoded = decodeTaskWorkbenchTemplate({
    ...template([{ kind: "changes" }, first, second]),
    selection: { kind: "tool", toolId: toolRefId(second) },
  });
  expect(decoded.tools).toEqual([{ kind: "changes" }, first, second]);
  expect(toolRefId(first)).not.toBe(toolRefId(second));

  for (const tools of [
    [first, first],
    [{ kind: "side-chat", sessionId: "side-1", viewId: "view" }],
    [{ kind: "side-chat" }],
    [{ kind: "files", sessionId: "side-1" }],
    [{ kind: "extension", extensionId: "ext", viewId: "view", sessionId: "side-1" }],
  ]) {
    expect(() => decodeTaskWorkbenchTemplate(template(tools)), JSON.stringify(tools)).toThrow(
      /Invalid workbench template/,
    );
  }
});

test("ui-state v20 stores side chats and keeps a copy of the v19 file it replaces", async () => {
  const dir = await mkdtemp(join(tmpdir(), "side-chat-ui-state-"));
  const path = join(dir, "ui-state.json");
  const original = `${JSON.stringify({ version: 19, composerDraft: "keep me" })}\n`;
  await writeFile(path, original);
  const sideChatsBySession = {
    "ws:side-1": { parentSessionId: "thread", branchedAt: "2026-09-26T10:00:00.000Z" },
  };

  await writePersistedUiState(path, { composerDraft: "keep me", sideChatsBySession });

  const saved = await readPersistedUiState(path);
  expect(saved.version).toBe(20);
  expect(saved.sideChatsBySession).toEqual(sideChatsBySession);
  const copies = (await readdir(dir)).filter((name) =>
    /^ui-state\.pre-workbench-v19\..+\.json$/.test(name),
  );
  expect(copies).toHaveLength(1);
  expect(await readFile(join(dir, copies[0]!), "utf8")).toBe(original);

  for (const invalid of [
    { "ws:side": { parentSessionId: "thread" } },
    { "ws:side": { parentSessionId: 7, branchedAt: "2026-09-26T10:00:00.000Z" } },
    { "ws:side": { parentSessionId: "thread", branchedAt: "now", extra: true } },
    ["not", "a", "map"],
  ]) {
    expect(() => decodePersistedUiState({ version: 20, sideChatsBySession: invalid })).toThrow(
      /sideChatsBySession/,
    );
  }
  expect(() => decodePersistedUiState({ version: 21 })).toThrow(/version/);
});

test("side chats stay out of the sidebar, switcher and shortcut order", () => {
  const session = (id: string, title: string): SessionRecord => ({
    id,
    title,
    preview: "",
    status: "idle",
    hasUnseenUpdate: false,
    updatedAt: "2026-09-26T10:00:00.000Z",
  });
  const workspace: WorkspaceRecord = {
    id: "ws",
    name: "project",
    path: "/tmp/project",
    lastOpenedAt: "2026-09-26T10:00:00.000Z",
    kind: "primary",
    sessions: [session("thread", "Thread"), session("side", "Side chat: Why?")],
  };
  const model = buildThreadSidebarModel({
    ...createEmptyDesktopAppState(),
    workspaces: [workspace],
    sideChatsBySession: { "ws:side": { parentSessionId: "thread", branchedAt: "" } },
  });
  expect(model.recencyOrder.map((entry) => entry.session.id)).toEqual(["thread"]);
  expect(
    model.recencySections.flatMap((section) => section.threads.map((entry) => entry.session.id)),
  ).toEqual(["thread"]);
});
