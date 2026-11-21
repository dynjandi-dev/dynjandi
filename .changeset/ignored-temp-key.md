---
"@dynjandi/cli": patch
---

`dynjandi setup` now makes sure Git ignores the temporary file that holds the key until the env file is replaced, adding `/<file name>.*.tmp` to the `.gitignore` when nothing covers it, so a run killed mid-write cannot leave a key `git add -A` would commit.
