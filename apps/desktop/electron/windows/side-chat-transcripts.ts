import type { WebContents } from "electron";
import type { SessionRef } from "@pi-gui/session-driver";
import { desktopIpc } from "../../contracts/ipc";
import { sideChatKey, type SideChatTranscript } from "../../contracts/side-chat";

export interface SideChatTranscriptSource {
  loadSideChatTranscript(sessionRef: SessionRef): Promise<void>;
  sideChatTranscript(sessionRef: SessionRef): SideChatTranscript;
  subscribeToSessionTranscripts(listener: (sessionRef: SessionRef) => void): () => void;
}

/**
 * Pushes a side chat's transcript to each renderer showing it. The selected-thread
 * publisher only follows a window's selection, and a side chat is never selected.
 * Transcript arrays are replaced on every write, so identity detects a change.
 */
export class SideChatTranscriptPublisher {
  private readonly watchers = new Map<WebContents, Map<string, unknown>>();

  constructor(private readonly source: SideChatTranscriptSource) {
    source.subscribeToSessionTranscripts((sessionRef) => this.publish(sessionRef));
  }

  async watch(contents: WebContents, sessionRef: SessionRef): Promise<SideChatTranscript> {
    const key = sideChatKey(sessionRef);
    // Registered before loading, so an update during the read is still pushed.
    this.watched(contents).set(key, undefined);
    await this.source.loadSideChatTranscript(sessionRef);
    const payload = this.source.sideChatTranscript(sessionRef);
    this.watchers.get(contents)?.set(key, payload.transcript);
    return payload;
  }

  unwatch(contents: WebContents, sessionRef: SessionRef): void {
    this.watchers.get(contents)?.delete(sideChatKey(sessionRef));
  }

  private watched(contents: WebContents): Map<string, unknown> {
    const existing = this.watchers.get(contents);
    if (existing) return existing;
    const keys = new Map<string, unknown>();
    this.watchers.set(contents, keys);
    contents.once("destroyed", () => this.watchers.delete(contents));
    contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) this.watchers.get(contents)?.clear();
    });
    return keys;
  }

  private publish(sessionRef: SessionRef): void {
    const key = sideChatKey(sessionRef);
    let payload: SideChatTranscript | undefined;
    for (const [contents, keys] of this.watchers) {
      if (!keys.has(key) || contents.isDestroyed()) continue;
      payload ??= this.source.sideChatTranscript(sessionRef);
      if (keys.get(key) === payload.transcript) continue;
      keys.set(key, payload.transcript);
      contents.send(desktopIpc.sideChatTranscriptChanged, payload);
    }
  }
}
