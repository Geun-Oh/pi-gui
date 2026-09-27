import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { SessionSupervisor } from "../dist/session-supervisor.js";
import { createAgentSessionRuntimeWithNpmFallback } from "../dist/npm-package-fallback.js";
import { forcePersistPiSession } from "../dist/compat/pi-session-persistence.js";

const assistant = (text: string) => ({
  role: "assistant" as const,
  content: [{ type: "text" as const, text }],
  api: "openai-completions" as const,
  provider: "fixture",
  model: "fixture",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
  timestamp: Date.now(),
});

async function readHeader(path: string): Promise<{ id: string; parentSession?: string }> {
  const [first] = (await readFile(path, "utf8")).split("\n");
  return JSON.parse(first ?? "{}") as { id: string; parentSession?: string };
}

await test("cloneSession copies the active branch into a new session that names its parent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-clone-session-"));
  const agentDir = join(root, "agent");
  const workspacePath = join(root, "workspace");
  await mkdir(agentDir);
  await mkdir(workspacePath);
  await writeFile(join(agentDir, "auth.json"), "{}");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  const runtimes: AgentSessionRuntime[] = [];
  const supervisor = new SessionSupervisor({
    agentDir,
    catalogFilePath: join(root, "catalogs.json"),
    createAgentSessionRuntimeImpl: async (options) => {
      const runtime = await createAgentSessionRuntimeWithNpmFallback(options);
      runtimes.push(runtime);
      return runtime;
    },
  });
  const workspace = await supervisor.registerWorkspace(workspacePath);
  const source = await supervisor.createSession(workspace, { title: "Main thread" });
  const manager = runtimes[0]!.session.sessionManager;
  const firstQuestion = manager.appendMessage({
    role: "user",
    content: "first question",
    timestamp: Date.now(),
  });
  manager.appendMessage(assistant("first answer"));
  // An abandoned branch must not be copied: only the active path is.
  manager.branch(firstQuestion);
  manager.appendMessage(assistant("rewritten answer"));
  manager.appendMessage({ role: "user", content: "second question", timestamp: Date.now() });
  const leafId = manager.appendMessage(assistant("second answer"));
  forcePersistPiSession(manager);

  const clone = await supervisor.cloneSession(source.ref, { title: "Side chat" });

  assert.equal(clone.title, "Side chat");
  assert.equal(clone.ref.workspaceId, source.ref.workspaceId);
  assert.notEqual(clone.ref.sessionId, source.ref.sessionId);
  const messages = (await supervisor.getTranscript(clone.ref)).flatMap((item) =>
    item.kind === "message" ? [{ id: item.id, text: item.text }] : [],
  );
  assert.deepEqual(
    messages.map((message) => message.text),
    ["first question", "rewritten answer", "second question", "second answer"],
  );
  assert.equal(messages.at(-1)?.id, leafId, "entry identities are kept");

  const sourceFile = await supervisor.getSessionFilePath(source.ref);
  const cloneFile = await supervisor.getSessionFilePath(clone.ref);
  assert.ok(sourceFile && cloneFile && sourceFile !== cloneFile);
  assert.equal((await readHeader(cloneFile)).parentSession, sourceFile);
  assert.equal((await readHeader(cloneFile)).id, clone.ref.sessionId);

  // The source keeps its own leaf and history.
  const sourceTexts = (await supervisor.getTranscript(source.ref)).flatMap((item) =>
    item.kind === "message" ? [item.text] : [],
  );
  assert.deepEqual(sourceTexts, [
    "first question",
    "rewritten answer",
    "second question",
    "second answer",
  ]);

  await supervisor.closeSession(clone.ref);
  await supervisor.closeSession(source.ref);
});
