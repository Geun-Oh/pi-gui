import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { SessionRef } from "@pi-gui/session-driver/types";
import type { SessionRecord } from "../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../contracts/ipc";
import { sideChatKey, sideChatOwnRows, type SideChatRecord } from "../../../contracts/side-chat";
import { ConversationTimeline } from "../conversation/conversation-timeline";
import { useRunningLabel } from "../conversation/hooks/use-running-label";
import { useTimelineViewport } from "../conversation/hooks/use-timeline-viewport";
import { buildDisplayTimelineItems } from "../conversation/timeline-turns";
import type { WorkspaceFileLine } from "../conversation/workspace-file-line";
import { ArrowUpIcon, ChatIcon, CloseIcon, StopSquareIcon } from "../../ui/icons";
import { composeSideChatMessage, type SideChatDraft } from "./side-chat-messages";
import { useSideChatTranscript } from "./use-side-chat-transcript";
import type { SideChats } from "./use-side-chats";
import type { DesktopAppState, WorkspaceRecord } from "../../../contracts/desktop-state";

/** The side chat tab `sessionId` of the thread `parent`, fed from the thread's side chats. */
export function SideChatTab({
  api,
  snapshot,
  workspace,
  parent,
  parentTitle,
  sessionId,
  sideChats,
  onOpenWorkspaceFileLine,
  onCloseTab,
}: {
  readonly api: PiDesktopApi;
  readonly snapshot: DesktopAppState;
  readonly workspace: WorkspaceRecord;
  readonly parent: SessionRecord;
  readonly parentTitle: string;
  readonly sessionId: string;
  readonly sideChats: SideChats;
  readonly onOpenWorkspaceFileLine: (target: WorkspaceFileLine) => void;
  readonly onCloseTab: () => void;
}) {
  const key = `${workspace.id}:${sessionId}`;
  const record = snapshot.sideChatsBySession[key];
  return (
    <SideChatPanel
      api={api}
      autoFocus={sideChats.focusKey === key}
      draft={sideChats.draftFor(key)}
      onAutoFocused={sideChats.clearFocus}
      onCloseTab={onCloseTab}
      onDraftChange={(draft) => sideChats.setDraft(key, draft)}
      onOpenWorkspaceFileLine={onOpenWorkspaceFileLine}
      parentTitle={parentTitle}
      record={record?.parentSessionId === parent.id ? record : undefined}
      session={workspace.sessions.find((session) => session.id === sessionId)}
      target={{ workspaceId: workspace.id, sessionId }}
      threadRowIds={sideChats.threadRowIds}
      workspacePath={workspace.path}
    />
  );
}

interface SideChatPanelProps {
  readonly api: PiDesktopApi;
  readonly target: SessionRef;
  readonly record: SideChatRecord | undefined;
  readonly session: SessionRecord | undefined;
  readonly parentTitle: string;
  /** Row identities in the thread's transcript; the side chat inherited these. */
  readonly threadRowIds: ReadonlySet<string>;
  readonly workspacePath: string;
  readonly draft: SideChatDraft;
  readonly onDraftChange: (draft: SideChatDraft) => void;
  /** Focus the question box once, e.g. right after "Ask in side chat". */
  readonly autoFocus: boolean;
  readonly onAutoFocused: () => void;
  readonly onOpenWorkspaceFileLine: (target: WorkspaceFileLine) => void;
  readonly onCloseTab: () => void;
}

const CLOSED_SEARCH = {
  isOpen: false,
  query: "",
  matchCount: 0,
  activeIndex: 0,
  inputRef: { current: null },
  search: () => undefined,
  goToMatch: () => undefined,
  close: () => undefined,
};

/** A side chat tab: its own agent on a branch of the thread, with a compact composer. */
export function SideChatPanel(props: SideChatPanelProps) {
  const { record, session } = props;
  if (!record || !session) {
    return (
      <div className="workbench__unavailable" role="status" data-testid="side-chat-unavailable">
        <ChatIcon />
        <h2>This side chat is no longer available</h2>
        <p>Its session was removed. The thread itself is unchanged.</p>
        <button className="button" onClick={props.onCloseTab} type="button">
          Close tab
        </button>
      </div>
    );
  }
  return <SideChatConversation {...props} record={record} session={session} />;
}

function SideChatConversation({
  api,
  target,
  record,
  session,
  parentTitle,
  threadRowIds,
  workspacePath,
  draft,
  onDraftChange,
  autoFocus,
  onAutoFocused,
  onOpenWorkspaceFileLine,
}: SideChatPanelProps & { readonly record: SideChatRecord; readonly session: SessionRecord }) {
  const { transcript, error: transcriptError } = useSideChatTranscript(api, target);
  const [showInherited, setShowInherited] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const paneRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const running = session.status === "running";
  const runningLabel = useRunningLabel(running ? session.runningSince : undefined);

  const own = useMemo(
    () => (transcript ? sideChatOwnRows(transcript, record.branchedAt, threadRowIds) : []),
    [record.branchedAt, threadRowIds, transcript],
  );
  const inheritedMessages = useMemo(() => {
    if (!transcript) return 0;
    const ownIds = new Set(own.map((item) => item.id));
    return transcript.filter((item) => item.kind === "message" && !ownIds.has(item.id)).length;
  }, [own, transcript]);
  const visible = showInherited ? (transcript ?? []) : own;
  const rows = useMemo(
    () => buildDisplayTimelineItems(visible, { lastTurnRunning: running }),
    [running, visible],
  );
  const viewport = useTimelineViewport({
    sessionKey: `${sideChatKey(target)}:${showInherited ? "all" : "own"}`,
    rows,
    active: true,
    transcriptReady: transcript !== null,
    paneRef,
  });

  useEffect(() => {
    if (!autoFocus) return;
    composerRef.current?.focus();
    onAutoFocused();
  }, [autoFocus, onAutoFocused]);

  const message = composeSideChatMessage(draft);
  const canSend = Boolean(message) && !running && !sending;

  const send = () => {
    if (!canSend) return;
    const submitted = draft;
    setSending(true);
    setSendError("");
    onDraftChange({ text: "", quote: "" });
    // Resolves when the answer is complete; the transcript streams in meanwhile.
    api.sendSideChatMessage({ target, text: message }).then(
      () => setSending(false),
      (error: unknown) => {
        setSending(false);
        setSendError(error instanceof Error ? error.message : String(error));
        onDraftChange(submitted);
      },
    );
  };
  const stop = () => {
    void api.stopSideChat(target).catch((error: unknown) => {
      setSendError(error instanceof Error ? error.message : String(error));
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <section
      aria-label="Side chat"
      className="side-panel side-chat"
      data-state={running ? "running" : "idle"}
      data-testid="side-chat-panel"
    >
      <header className="side-chat__header">
        <span className="side-chat__branch" title={session.title}>
          Branched from <strong>{parentTitle || "this thread"}</strong>
        </span>
        {running ? <span className="side-chat__status">{runningLabel}</span> : null}
      </header>
      {inheritedMessages > 0 ? (
        <div className="side-chat__inherited" data-testid="side-chat-inherited">
          <span>
            {inheritedMessages} earlier {inheritedMessages === 1 ? "message" : "messages"} from the
            thread {inheritedMessages === 1 ? "is" : "are"} included as context.
          </span>
          <button
            className="side-chat__link"
            onClick={() => setShowInherited((current) => !current)}
            type="button"
          >
            {showInherited ? "Hide" : "Show"}
          </button>
        </div>
      ) : null}
      <div className="side-chat__timeline">
        <ConversationTimeline
          isTranscriptLoading={transcript === null && !transcriptError}
          onOpenWorkspaceFileLine={onOpenWorkspaceFileLine}
          threadSearch={CLOSED_SEARCH}
          transcript={visible}
          transcriptFailed={transcriptError ? { retrying: false } : null}
          variant="side-chat"
          viewport={viewport}
          workspacePath={workspacePath}
        />
      </div>
      <div className="side-chat__composer composer">
        <div className="composer__surface">
          {draft.quote ? (
            <div className="side-chat__quote" data-testid="side-chat-quote">
              <blockquote>{draft.quote}</blockquote>
              <button
                aria-label="Remove quoted text"
                className="icon-button side-chat__quote-remove"
                onClick={() => onDraftChange({ ...draft, quote: "" })}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>
          ) : null}
          {sendError ? (
            <div
              className="composer__error error-banner"
              data-testid="side-chat-error"
              role="alert"
            >
              {sendError}
            </div>
          ) : null}
          <textarea
            aria-label="Side chat message"
            data-testid="side-chat-composer"
            onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
            onKeyDown={onKeyDown}
            placeholder={draft.quote ? "Ask about the quoted text…" : "Ask a side question…"}
            ref={composerRef}
            rows={2}
            value={draft.text}
          />
          <div className="side-chat__composer-bar">
            <span className="composer__hint">Answers stay in this side chat.</span>
            {running ? (
              <button
                aria-label="Stop side chat"
                className="button button--primary button--cta-icon"
                data-testid="side-chat-stop"
                onClick={stop}
                type="button"
              >
                <StopSquareIcon />
              </button>
            ) : (
              <button
                aria-label="Send to side chat"
                className="button button--primary button--cta-icon"
                data-testid="side-chat-send"
                disabled={!canSend}
                onClick={send}
                type="button"
              >
                <ArrowUpIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
