import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A file for `GIT_CONFIG_GLOBAL`, so the machine's own Git configuration (a global ignore file, say) cannot change
 * which files a test sees as ignored. It points `core.excludesFile` at an empty file of its own: with no setting,
 * Git still reads `$XDG_CONFIG_HOME/git/ignore` (or `~/.config/git/ignore`), where `*.tmp` is common. Not
 * `os.devNull`: Git for Windows cannot read `\\.\nul` as a config file, and every command then fails with
 * "unable to access '\\.\nul': Invalid argument".
 */
export async function createEmptyGitConfig(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dynjandi-gitconfig-"));
  const excludes = join(directory, "ignore");
  await writeFile(excludes, "");
  const path = join(directory, "config");
  // Forward slashes: Git for Windows reads them, and a backslash would be an escape inside the quoted value.
  await writeFile(path, `[core]\n\texcludesFile = "${excludes.replaceAll("\\", "/")}"\n`);
  return path;
}

export async function removeEmptyGitConfig(path: string): Promise<void> {
  await rm(dirname(path), { recursive: true, force: true });
}
