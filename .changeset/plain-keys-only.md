---
"@dynjandi/cli": patch
---

`dynjandi setup` now refuses a `DYNJANDI_API_KEY` that holds anything but printable ASCII, so a key with a character above U+00FF exits 3 with "DYNJANDI_API_KEY is not usable" instead of exiting 1 with "could not reach".
