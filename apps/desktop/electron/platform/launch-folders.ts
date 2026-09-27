import { realpathSync, statSync } from "node:fs";
import path from "node:path";

/** What a second `pi-gui <folder>` launch hands to the running app. */
export interface LaunchFolderRequest {
  readonly folders: readonly string[];
}

/**
 * Existing folders named on a launch command line, as canonical absolute paths.
 * Switches (Chromium's, macOS `-psn_…`) and the app's own entry directory
 * (`electron .` during development) are not folders to open.
 */
export function launchFoldersFromArgv(
  argv: readonly string[],
  options: { readonly cwd: string; readonly appPath: string },
): string[] {
  const appPath = canonicalDirectory(options.appPath) ?? path.resolve(options.appPath);
  const folders: string[] = [];
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith("-")) continue;
    const folder = canonicalDirectory(path.resolve(options.cwd, arg));
    if (folder && folder !== appPath && !folders.includes(folder)) folders.push(folder);
  }
  return folders;
}

/** Folders forwarded by another instance, checked again on this side of the handoff. */
export function launchFoldersFromRequest(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const folders = (value as { readonly folders?: unknown }).folders;
  if (!Array.isArray(folders)) return [];
  const result: string[] = [];
  for (const entry of folders) {
    if (typeof entry !== "string" || !path.isAbsolute(entry)) continue;
    const folder = canonicalDirectory(entry);
    if (folder && !result.includes(folder)) result.push(folder);
  }
  return result;
}

function canonicalDirectory(candidate: string): string | undefined {
  try {
    const resolved = realpathSync(candidate);
    return statSync(resolved).isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}
