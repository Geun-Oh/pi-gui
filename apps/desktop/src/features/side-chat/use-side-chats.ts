import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SessionRef } from "@pi-gui/session-driver/types";
import type { DesktopAppState, TranscriptMessage } from "../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../contracts/ipc";
import { SIDE_CHAT_TITLE_PREFIX, sideChatKey } from "../../../contracts/side-chat";
import type { ToolRef } from "../../../contracts/workbench";
import { applySnapshotIfNewer } from "../../app/desktop-app-state";
import { formatRelativeTime } from "../../lib/string-utils";
import { EMPTY_SIDE_CHAT_DRAFT, type SideChatDraft } from "./side-chat-messages";

interface UseSideChatsOptions {
  readonly api: PiDesktopApi | undefined;
  readonly snapshot: DesktopAppState | null;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  /** The thread open in the main pane. */
  readonly target: SessionRef | null;
  readonly threadTranscript: readonly TranscriptMessage[];
  readonly workbench: {
    readonly view: { readonly tools: readonly ToolRef[] };
    readonly openTool: (tool: ToolRef) => void;
    readonly openToolFor: (target: SessionRef, tool: ToolRef) => void;
  };
}

/** Side chats of the open thread: branching new ones, their drafts and closed history. */
export function useSideChats({
  api,
  snapshot,
  setSnapshot,
  target,
  threadTranscript,
  workbench,
}: UseSideChatsOptions) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, SideChatDraft>>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [focusKey, setFocusKey] = useState("");
  const pendingRef = useRef(false);
  const current = useRef({ api, target, workbench });
  current.current = { api, target, workbench };

  const open = useCallback(
    (quote = "") => {
      const { api: desktopApi, target: parent } = current.current;
      if (!desktopApi || !parent || pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setError("");
      void desktopApi
        .openSideChat(parent)
        .then(
          ({ sideChat, state }) => {
            applySnapshotIfNewer(setSnapshot, state);
            const key = sideChatKey(sideChat);
            setDrafts((existing) => ({ ...existing, [key]: { text: "", quote } }));
            setFocusKey(key);
            // The tab belongs to the thread that asked, even if another one is showing now.
            current.current.workbench.openToolFor(parent, {
              kind: "side-chat",
              sessionId: sideChat.sessionId,
            });
          },
          (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
        )
        .finally(() => {
          pendingRef.current = false;
          setPending(false);
        });
    },
    [setSnapshot],
  );

  const targetKey = target ? sideChatKey(target) : "";
  useEffect(() => setError(""), [targetKey]);

  const threadRowIds = useMemo(
    () => new Set(threadTranscript.map((item) => item.id)),
    [threadTranscript],
  );

  const history = useMemo(() => {
    const workspace = snapshot?.workspaces.find((entry) => entry.id === target?.workspaceId);
    if (!snapshot || !workspace || !target) return [];
    const openTabs = new Set(
      workbench.view.tools.flatMap((tool) => (tool.kind === "side-chat" ? [tool.sessionId] : [])),
    );
    return workspace.sessions
      .filter(
        (session) =>
          !openTabs.has(session.id) &&
          snapshot.sideChatsBySession[`${workspace.id}:${session.id}`]?.parentSessionId ===
            target.sessionId,
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => ({
        sessionId: session.id,
        label: session.title.startsWith(SIDE_CHAT_TITLE_PREFIX)
          ? session.title.slice(SIDE_CHAT_TITLE_PREFIX.length)
          : session.title,
        updatedAt: formatRelativeTime(session.updatedAt),
      }));
  }, [snapshot, target, workbench.view.tools]);

  return {
    open,
    pending,
    error,
    history,
    threadRowIds,
    reopen: useCallback(
      (sessionId: string) => current.current.workbench.openTool({ kind: "side-chat", sessionId }),
      [],
    ),
    draftFor: (key: string) => drafts[key] ?? EMPTY_SIDE_CHAT_DRAFT,
    setDraft: useCallback(
      (key: string, draft: SideChatDraft) =>
        setDrafts((existing) => ({ ...existing, [key]: draft })),
      [],
    ),
    focusKey,
    clearFocus: useCallback(() => setFocusKey(""), []),
  };
}

export type SideChats = ReturnType<typeof useSideChats>;
