import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("loads the pinned Anthropic OAuth compatibility extension first", () => {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  );
  expect(manifest.dependencies?.["@gotgenes/pi-anthropic-auth"]).toBe("3.3.2");
  expect(manifest.pi.extensions).toEqual([
    "./node_modules/@gotgenes/pi-anthropic-auth/src/index.ts",
    "./dist/extension.js",
  ]);
});
