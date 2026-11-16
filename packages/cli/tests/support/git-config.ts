import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * An empty file for `GIT_CONFIG_GLOBAL`, so the machine's own Git configuration (a global ignore file, say) cannot
 * change which files a test sees as ignored. Not `os.devNull`: Git for Windows cannot read `\\.\nul` as a config
 * file, and every command then fails with "unable to access '\\.\nul': Invalid argument".
 */
export async function createEmptyGitConfig(): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "dynjandi-gitconfig-")), "config");
  await writeFile(path, "");
  return path;
}

export async function removeEmptyGitConfig(path: string): Promise<void> {
  await rm(dirname(path), { recursive: true, force: true });
}
