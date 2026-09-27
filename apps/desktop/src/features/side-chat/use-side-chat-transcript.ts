import { useEffect, useState } from "react";
import type { SessionRef } from "@pi-gui/session-driver/types";
import type { TranscriptMessage } from "../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../contracts/ipc";
import { sideChatKey } from "../../../contracts/side-chat";

interface SideChatTranscriptState {
  readonly key: string;
  readonly transcript: readonly TranscriptMessage[] | null;
  readonly error: string;
}

/** Follows one side chat's transcript while its panel is mounted. */
export function useSideChatTranscript(
  api: PiDesktopApi,
  target: SessionRef,
): Omit<SideChatTranscriptState, "key"> {
  const key = sideChatKey(target);
  const [state, setState] = useState<SideChatTranscriptState>({
    key,
    transcript: null,
    error: "",
  });
  const { workspaceId, sessionId } = target;

  useEffect(() => {
    const ref = { workspaceId, sessionId };
    const watchedKey = sideChatKey(ref);
    let active = true;
    setState({ key: watchedKey, transcript: null, error: "" });
    // Pushes and the watch reply share one ordered IPC channel, so the latest applies last.
    const stop = api.onSideChatTranscriptChanged((payload) => {
      if (active && payload.workspaceId === workspaceId && payload.sessionId === sessionId) {
        setState({ key: watchedKey, transcript: payload.transcript, error: "" });
      }
    });
    api.watchSideChat(ref).then(
      (payload) => {
        if (active) setState({ key: watchedKey, transcript: payload.transcript, error: "" });
      },
      (error: unknown) => {
        if (active) {
          setState({
            key: watchedKey,
            transcript: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      active = false;
      stop();
      void api.unwatchSideChat(ref).catch(() => undefined);
    };
  }, [api, sessionId, workspaceId]);

  return state.key === key ? state : { transcript: null, error: "" };
}
