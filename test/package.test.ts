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

it("configures manual semantic-release without npm publication", () => {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  );
  expect(manifest.scripts["release:dry-run"]).toBe(
    "semantic-release --dry-run",
  );
  expect(manifest.devDependencies["semantic-release"]).toBe("25.0.9");

  const config = JSON.parse(
    readFileSync(join(process.cwd(), ".releaserc.json"), "utf8"),
  );
  expect(config.branches).toEqual(["main"]);
  expect(config.plugins).toContainEqual([
    "@semantic-release/npm",
    { npmPublish: false },
  ]);

  const workflow = readFileSync(
    join(process.cwd(), ".github/workflows/release.yml"),
    "utf8",
  );
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("node-version: 24");
  expect(workflow).toContain("contents: read");
  expect(workflow).toContain("needs: verify");
  expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2);
  expect(workflow).not.toMatch(/^\s+push:/m);
  expect(workflow).not.toContain("NPM_TOKEN");
});
