import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_PERMISSION_MAP } from "./allPerms.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const manageApiPath = path.resolve(here, "../routes/(manage)/manage/api/+server.ts");

/**
 * The manage API rejects any action that is not present in `ACTION_PERMISSION_MAP` with an
 * "Unknown action" error before it reaches the handler. That makes the map easy to forget when a
 * new action is added — the endpoint compiles and the UI silently gets an error response. This
 * guard keeps the two in sync.
 */
describe("manage API action permissions", () => {
  const source = fs.readFileSync(manageApiPath, "utf8");

  const handledActions = Array.from(
    new Set(Array.from(source.matchAll(/action\s*[=!]==?\s*"([A-Za-z0-9_]+)"/g)).map((match) => match[1])),
  );

  it("finds action handlers in the manage API", () => {
    // Sanity check so a refactor of the comparison syntax cannot silently disable this test.
    expect(handledActions.length).toBeGreaterThan(50);
  });

  it("maps every handled action to a permission entry", () => {
    const missing = handledActions.filter(
      (action) => !Object.prototype.hasOwnProperty.call(ACTION_PERMISSION_MAP, action),
    );

    expect(missing).toEqual([]);
  });
});
