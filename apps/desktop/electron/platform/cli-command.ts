import { execFile } from "node:child_process";
import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** On the default macOS PATH (`/etc/paths`), unlike Homebrew's prefix on Apple silicon. */
export const CLI_COMMAND_TARGET = "/usr/local/bin/pi-gui";

/** The `pi-gui` launcher script that ships with this build. */
export function cliScriptPath(options: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
}): string {
  return options.isPackaged
    ? path.join(options.resourcesPath, "bin", "pi-gui")
    : path.join(options.appPath, "resources", "bin", "pi-gui");
}

/**
 * Link the launcher into PATH. An existing link is replaced; any other file is
 * left alone. macOS asks for an administrator password only when the target
 * directory is not writable.
 */
export async function installCliCommand(
  source: string,
  target: string = CLI_COMMAND_TARGET,
): Promise<void> {
  const existing = await lstat(target).catch((error: unknown) => {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (existing && !existing.isSymbolicLink()) {
    throw new Error(`${target} already exists and is not a link. Remove it, then try again.`);
  }
  if (existing && (await readlink(target)) === source) return;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    if (existing) await unlink(target);
    await symlink(source, target);
  } catch (error) {
    if (!isErrorCode(error, "EACCES") && !isErrorCode(error, "EPERM")) throw error;
    if (process.platform !== "darwin") throw error;
    const command = `mkdir -p ${shellQuote(path.dirname(target))} && ln -sfn ${shellQuote(source)} ${shellQuote(target)}`;
    await execFileAsync("osascript", [
      "-e",
      `do shell script "${command.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" with administrator privileges`,
    ]);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
