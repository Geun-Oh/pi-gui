import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { installCliCommand } from "../../electron/platform/cli-command";
import {
  launchFoldersFromArgv,
  launchFoldersFromRequest,
} from "../../electron/platform/launch-folders";

const execFileAsync = promisify(execFile);
const launcher = resolve(__dirname, "../../resources/bin/pi-gui");

async function tempDir(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

test("argv yields existing folders, skipping switches, files and the app's own entry", async () => {
  const root = await tempDir("launch-folders-");
  const project = join(root, "project");
  const appPath = join(root, "app");
  await mkdir(project);
  await mkdir(appPath);
  await writeFile(join(root, "notes.txt"), "not a folder");
  await symlink(project, join(root, "project-link"));

  expect(
    launchFoldersFromArgv(
      [
        "/Applications/pi-gui.app/Contents/MacOS/pi-gui",
        "--inspect=0",
        "-psn_0_12345",
        appPath,
        "project",
        "./project-link",
        "notes.txt",
        "missing",
        project,
      ],
      { cwd: root, appPath },
    ),
  ).toEqual([project]);
  // Development launches (`electron .`) name only the app itself.
  expect(launchFoldersFromArgv(["electron", "."], { cwd: appPath, appPath })).toEqual([]);
});

test("forwarded folders must be absolute existing folders", async () => {
  const root = await tempDir("launch-request-");
  expect(
    launchFoldersFromRequest({ folders: [root, root, "relative", join(root, "gone"), 7] }),
  ).toEqual([root]);
  expect(launchFoldersFromRequest(undefined)).toEqual([]);
  expect(launchFoldersFromRequest({ folders: "nope" })).toEqual([]);
});

test("installing the command links it, replaces a stale link and keeps other files", async () => {
  const root = await tempDir("cli-install-");
  const target = join(root, "bin", "pi-gui");

  await installCliCommand(launcher, target);
  expect(await readlink(target)).toBe(launcher);
  await installCliCommand(launcher, target);
  expect(await readlink(target)).toBe(launcher);

  const stale = join(root, "old-pi-gui");
  await installCliCommand(stale, target);
  expect(await readlink(target)).toBe(stale);

  const occupied = join(root, "occupied");
  await writeFile(occupied, "someone else's tool");
  await expect(installCliCommand(launcher, occupied)).rejects.toThrow(/not a link/);
  expect((await lstat(occupied)).isSymbolicLink()).toBe(false);
});

test("the launcher passes absolute folders to the app, defaulting to the current one", async () => {
  const root = await tempDir("cli-launcher-");
  const project = join(root, "my project");
  await mkdir(project);
  const record = join(root, "args.txt");
  const fakeApp = join(root, "fake-pi-gui");
  await writeFile(
    fakeApp,
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(`${record}.tmp`)}\nmv ${JSON.stringify(`${record}.tmp`)} ${JSON.stringify(record)}\n`,
  );
  await chmod(fakeApp, 0o755);
  // Invoke through a link, the way /usr/local/bin/pi-gui runs it.
  const linked = join(root, "pi-gui");
  await symlink(launcher, linked);
  const env = { ...process.env, PI_GUI_EXECUTABLE: fakeApp };
  const recordedArgs = async () => {
    await expect.poll(() => readFile(record, "utf8").catch(() => "")).not.toBe("");
    const args = (await readFile(record, "utf8")).trimEnd().split("\n");
    await writeFile(record, "");
    return args;
  };

  await execFileAsync(linked, [], { cwd: project, env });
  expect(await recordedArgs()).toEqual([project]);

  await execFileAsync(linked, ["my project", "."], { cwd: root, env });
  expect(await recordedArgs()).toEqual([project, root]);

  await expect(execFileAsync(linked, ["missing"], { cwd: root, env })).rejects.toMatchObject({
    stderr: expect.stringContaining("missing is not a folder"),
  });
});
