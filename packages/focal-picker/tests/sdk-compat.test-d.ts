import type { UploadOptions } from "@dynjandi/sdk";
import { expectTypeOf, test } from "vitest";
import type { FocalPoint } from "../src/index";

// The picker has no runtime dependency on the SDK (D1): the only thing they share is the shape `{ x, y }`.
// This is where that is held. If `FocalPoint` stops being assignable to what `upload` accepts as `focal`,
// `tsc` (pnpm typecheck) and `vitest --typecheck` (pnpm test) both fail here.
test("a FocalPoint is what `upload` accepts as `focal`", () => {
  expectTypeOf<FocalPoint>().toExtend<NonNullable<UploadOptions["focal"]>>();

  const options: UploadOptions = { focal: { x: 0.5, y: 0.5 } satisfies FocalPoint };
  expectTypeOf(options.focal).toExtend<FocalPoint | undefined>();
});
