import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  expectNewThreadWorkspace,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  spawnDesktopProcess,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

async function exitOf(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const [code] = (await once(child, "exit")) as [number | null];
  return code;
}

test("pi-gui <folder> opens the folder at launch and in the already running app", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const known = await makeWorkspace("cli-known-folder");
  const launched = await makeWorkspace("cli-launch-folder");
  const later = await makeWorkspace("cli-second-launch-folder");

  // `pi-gui <folder>` starts the app binary with the folder as an argument.
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [known],
    extraArgs: [launched],
    testMode: "background",
  });
  let second: ChildProcess | undefined;
  try {
    const window = await harness.firstWindow();
    // Opened like File > Open Folder: added, selected, and ready for a new thread.
    await expectNewThreadWorkspace(window, launched);
    const launchedWorkspace = await waitForWorkspaceByPath(window, launched);
    expect((await getDesktopState(window)).selectedWorkspaceId).toBe(launchedWorkspace.id);

    // A second launch hands its folder to the running app and exits.
    second = await spawnDesktopProcess(userDataDir, {
      agentDir,
      extraArgs: [later],
      testMode: "background",
    });
    expect(await exitOf(second)).toBe(0);
    await expectNewThreadWorkspace(window, later);
    const state = await getDesktopState(window);
    expect(state.workspaces.map((workspace) => workspace.path).sort()).toEqual(
      [known, launched, later].sort(),
    );
    expect(
      await harness.electronApp.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);

    // Naming a folder that is already open selects it again rather than adding a copy.
    second = await spawnDesktopProcess(userDataDir, {
      agentDir,
      extraArgs: [known],
      testMode: "background",
    });
    expect(await exitOf(second)).toBe(0);
    await expectNewThreadWorkspace(window, known);
    expect((await getDesktopState(window)).workspaces).toHaveLength(3);
  } finally {
    if (second && second.exitCode === null && second.signalCode === null) second.kill();
    await harness.close();
  }
});
