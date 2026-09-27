import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedConversationSessionFixture,
  selectSession,
  waitForTimelineLayout,
  type DesktopHarness,
} from "../helpers/electron-app";
import { sessionFilePathFromCatalog } from "../helpers/session-file";

interface ChatRequest {
  readonly model?: string;
  readonly messages?: readonly unknown[];
}

/** An OpenAI-compatible endpoint that streams "Side answer <n>" and records each request. */
async function startModelServer() {
  const requests: ChatRequest[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = (raw ? JSON.parse(raw) : {}) as ChatRequest;
      requests.push(body);
      // Left unanswered so the run stays in flight until the user stops it.
      if (raw.includes("Hang until stopped")) return;
      const model = body.model ?? "fixture";
      const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
        id: "chatcmpl-side-chat",
        object: "chat.completion.chunk",
        created: 0,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      });
      const send = (payload: unknown) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
      response.writeHead(200, { "content-type": "text/event-stream" });
      send(chunk({ role: "assistant", content: "" }, null));
      for (const word of `Side answer ${requests.length} from the branch.`.split(/(?<= )/)) {
        send(chunk({ content: word }, null));
      }
      send(chunk({}, "stop"));
      send({
        id: "chatcmpl-side-chat",
        object: "chat.completion.chunk",
        created: 0,
        model,
        choices: [],
        usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
      });
      response.end("data: [DONE]\n\n");
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function seedFixtureModel(agentDir: string, baseUrl: string): Promise<void> {
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["side-test/fixture"],
  });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "side-test",
      defaultModel: "fixture",
      enabledModels: ["side-test/fixture"],
    }),
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "side-test": {
          baseUrl,
          api: "openai-completions",
          apiKey: "unused",
          models: [{ id: "fixture" }],
        },
      },
    }),
  );
}

async function openSideChatFromChooser(window: Page): Promise<void> {
  const workbench = window.getByTestId("workbench");
  if (!(await workbench.isVisible())) await window.getByTestId("toggle-side-panel").click();
  await window.getByTestId("workbench-add-tab").click();
  await window.getByTestId("workbench-choice-side-chat").click();
}

function requestText(request: ChatRequest | undefined): string {
  return JSON.stringify(request?.messages ?? []);
}

async function launch(userDataDir: string, agentDir: string, workspacePath: string) {
  return launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });
}

test("side chats branch a thread, answer beside it, quote a selection and come back after relaunch", async () => {
  test.setTimeout(120_000);
  const server = await startModelServer();
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("side-chat-workspace");
  await seedFixtureModel(agentDir, server.baseUrl);
  const thread = await seedConversationSessionFixture(agentDir, workspacePath, {
    title: "Retry policy thread",
    model: { provider: "side-test", id: "fixture" },
    messages: [
      { role: "user", text: "How should the uploader retry?" },
      { role: "assistant", text: "Use exponential backoff with jitter, capped at five attempts." },
      { role: "user", text: "What about idempotency?" },
      { role: "assistant", text: "Send an Idempotency-Key header on every upload request." },
    ],
  });

  let harness: DesktopHarness | undefined = await launch(userDataDir, agentDir, workspacePath);
  try {
    let window = await harness.firstWindow();
    await selectSession(window, thread.title);
    const threadTranscript = window.locator(".conversation--thread").getByTestId("transcript");
    await expect(threadTranscript).toContainText("Idempotency-Key");

    // 1. Open a side chat from the side panel's tool chooser.
    await openSideChatFromChooser(window);
    const panel = window.getByTestId("side-chat-panel");
    await expect(panel).toBeVisible();
    await expect(window.getByRole("tab", { name: "Side chat", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel.getByTestId("side-chat-inherited")).toContainText(
      "4 earlier messages from the thread are included as context.",
    );
    await expect(panel.getByTestId("side-chat-empty")).toBeVisible();

    // It is a pi branch: its own session file, cloned from the thread, named by its header.
    let state = await getDesktopState(window);
    const workspace = state.workspaces.find((entry) => entry.path === workspacePath)!;
    const firstSideChatId = Object.entries(state.sideChatsBySession).find(
      ([, record]) => record.parentSessionId === thread.sessionId,
    )?.[0];
    expect(firstSideChatId).toBeDefined();
    const firstSideChat = {
      workspaceId: workspace.id,
      sessionId: firstSideChatId!.slice(workspace.id.length + 1),
    };
    const threadFile = await sessionFilePathFromCatalog(userDataDir, {
      workspaceId: workspace.id,
      sessionId: thread.sessionId,
    });
    const sideChatFile = await sessionFilePathFromCatalog(userDataDir, firstSideChat);
    const header = JSON.parse((await readFile(sideChatFile, "utf8")).split("\n")[0]!) as {
      parentSession?: string;
    };
    expect(header.parentSession).toBe(threadFile);
    // Side chats never show up as threads.
    await expect(window.locator(".session-row")).toHaveCount(1);

    // 2. Ask a question: the branch answers with the thread's history as context.
    await panel.getByTestId("side-chat-composer").fill("Summarize the retry advice.");
    await panel.getByTestId("side-chat-composer").press("Enter");
    const sideTranscript = panel.getByTestId("side-chat-transcript");
    await expect(sideTranscript).toContainText("Summarize the retry advice.");
    await expect(sideTranscript).toContainText("Side answer 1 from the branch.");
    await expect(panel).toHaveAttribute("data-state", "idle");
    expect(requestText(server.requests[0])).toContain("Use exponential backoff with jitter");
    expect(requestText(server.requests[0])).toContain("Summarize the retry advice.");
    // The inherited history stays out of the panel, and the thread is untouched.
    await expect(sideTranscript).not.toContainText("How should the uploader retry?");
    await expect(threadTranscript).not.toContainText("Side answer");
    // "Show" reveals what the branch inherited.
    await panel.getByRole("button", { name: "Show", exact: true }).click();
    await expect(sideTranscript).toContainText("How should the uploader retry?");
    await panel.getByRole("button", { name: "Hide", exact: true }).click();
    await expect(sideTranscript).not.toContainText("How should the uploader retry?");

    // 3. Select text in the thread and ask about it in a new side chat.
    await waitForTimelineLayout(window);
    const answer = threadTranscript
      .locator(".timeline-item--assistant", { hasText: "Idempotency-Key" })
      .locator(".message__content p");
    const box = (await answer.boundingBox())!;
    await window.mouse.move(box.x + 1, box.y + box.height / 2);
    await window.mouse.down();
    await window.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
    await window.mouse.up();
    const ask = window.getByTestId("ask-in-side-chat");
    await expect(ask).toBeVisible();
    // A compact pill just below the selection, not a row across the thread.
    const askBox = (await ask.boundingBox())!;
    expect(askBox.width).toBeLessThan(260);
    expect(askBox.y).toBeGreaterThan(box.y);
    expect(askBox.y).toBeLessThan(box.y + box.height + 60);
    await ask.click();

    await expect(window.getByRole("tab", { name: "Side chat 2", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const quotedPanel = window.getByTestId("side-chat-panel");
    await expect(quotedPanel.getByTestId("side-chat-quote")).toContainText(
      "Send an Idempotency-Key header on every upload request.",
    );
    await expect(quotedPanel.getByTestId("side-chat-composer")).toBeFocused();
    await window.keyboard.type("Why does this matter?");
    await quotedPanel.getByTestId("side-chat-send").click();
    await expect(quotedPanel.getByTestId("side-chat-transcript")).toContainText(
      "Side answer 2 from the branch.",
    );
    await expect(quotedPanel.getByTestId("side-chat-quote")).toHaveCount(0);
    const quotedRequest = requestText(server.requests[1]);
    expect(quotedRequest).toContain("> Send an Idempotency-Key header on every upload request.");
    expect(quotedRequest).toContain("Why does this matter?");

    state = await getDesktopState(window);
    expect(
      Object.values(state.sideChatsBySession).filter(
        (record) => record.parentSessionId === thread.sessionId,
      ),
    ).toHaveLength(2);
    await expect(window.locator(".session-row")).toHaveCount(1);

    // The keyboard shortcut branches the thread again.
    await window.getByTestId("composer").focus();
    await window.keyboard.press(desktopShortcut("Alt+KeyS"));
    await expect(window.getByRole("tab", { name: "Side chat 3", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const third = window.getByTestId("side-chat-panel");
    await expect(third.getByTestId("side-chat-composer")).toBeFocused();
    // A run in flight can be stopped from the side chat, and the thread never ran.
    await window.keyboard.type("Hang until stopped.");
    await window.keyboard.press("Enter");
    await expect(third).toHaveAttribute("data-state", "running");
    await third.getByTestId("side-chat-stop").click();
    await expect(third).toHaveAttribute("data-state", "idle");
    state = await getDesktopState(window);
    expect(
      state.workspaces[0]?.sessions.find((session) => session.id === thread.sessionId)?.status,
    ).toBe("idle");

    // 4. After a relaunch the thread still has its side chats and their own answers.
    await harness.close();
    harness = await launch(userDataDir, agentDir, workspacePath);
    window = await harness.firstWindow();
    await selectSession(window, thread.title);
    await expect(window.locator(".session-row")).toHaveCount(1);
    const firstTab = window.getByRole("tab", { name: "Side chat", exact: true });
    await expect(window.getByRole("tab", { name: "Side chat 2", exact: true })).toBeVisible();
    await firstTab.click();
    const restored = window.getByTestId("side-chat-panel");
    await expect(restored.getByTestId("side-chat-transcript")).toContainText(
      "Side answer 1 from the branch.",
    );
    await expect(restored.getByTestId("side-chat-transcript")).not.toContainText(
      "How should the uploader retry?",
    );

    // Closing a tab keeps the branch; the chooser offers it again.
    await window.getByRole("button", { name: "Close Side chat tab" }).click();
    await window.getByTestId("workbench-add-tab").click();
    await window
      .getByTestId("workbench-side-chat-history")
      .filter({ hasText: "Summarize the retry advice." })
      .click();
    await expect(
      window.getByTestId("side-chat-panel").getByTestId("side-chat-transcript"),
    ).toContainText("Side answer 1 from the branch.");
  } finally {
    await harness?.close();
    await server.close();
  }
});
