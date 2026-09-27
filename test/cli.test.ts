import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repo = process.cwd();

function run(
  command: string,
  args: string[],
  env: Record<string, string> = {},
) {
  return spawnSync(command, args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function requireSuccess(result: ReturnType<typeof run>) {
  if (result.status !== 0) {
    throw new Error(
      `command failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

describe("pic CLI", () => {
  it("publishes the pic executable and installer", () => {
    const manifest = JSON.parse(
      readFileSync(join(repo, "package.json"), "utf8"),
    );
    expect(manifest.bin).toEqual({ pic: "bin/pic" });
    expect(manifest.files).toContain("bin");
    expect(manifest.files).toContain("config");
    expect(manifest.files).toContain("scripts/config.mjs");
    expect(manifest.files).toContain("scripts/install.sh");
  });

  it("launches Pi with only the two reviewed extensions before user arguments", () => {
    const root = mkdtempSync(join(tmpdir(), "pic-launch-"));
    const fakePi = join(root, "fake-pi");
    const fakeAuth = join(root, "auth.ts");
    const fakePiCoder = join(root, "extension.js");
    writeFileSync(fakePi, '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n');
    writeFileSync(fakeAuth, "");
    writeFileSync(fakePiCoder, "");
    chmodSync(fakePi, 0o755);

    const result = run("bash", ["bin/pic", "--model", "anthropic/test"], {
      PIC_PI_BIN: fakePi,
      PIC_AUTH_EXTENSION: fakeAuth,
      PIC_CODER_EXTENSION: fakePiCoder,
    });
    requireSuccess(result);
    expect(result.stdout.trim().split("\n")).toEqual([
      "--no-extensions",
      "--extension",
      fakeAuth,
      "--extension",
      fakePiCoder,
      "--model",
      "anthropic/test",
    ]);
  });

  it("delegates pic update to the managed installer", () => {
    const root = mkdtempSync(join(tmpdir(), "pic-update-dispatch-"));
    const installer = join(root, "installer");
    writeFileSync(installer, '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\n');
    chmodSync(installer, 0o755);

    const result = run("bash", ["bin/pic", "update"], {
      PIC_INSTALLER: installer,
    });
    requireSuccess(result);
    expect(result.stdout.trim()).toBe("update");
  });

  it("delegates pic config to the configuration command", () => {
    const root = mkdtempSync(join(tmpdir(), "pic-config-dispatch-"));
    const configCli = join(root, "config.mjs");
    writeFileSync(
      configCli,
      'console.log(process.argv.slice(2).join("\\n"));\n',
    );

    const result = run(
      "bash",
      ["bin/pic", "config", "whitelist", "add", "anthropic/claude-sonnet-4-6"],
      { PIC_CONFIG_CLI: configCli },
    );
    requireSuccess(result);
    expect(result.stdout.trim().split("\n")).toEqual([
      "whitelist",
      "add",
      "anthropic/claude-sonnet-4-6",
    ]);
  });

  it("writes private whitelist and blacklist configuration with pic config", () => {
    const root = mkdtempSync(join(tmpdir(), "pic-config-write-"));
    const env = { XDG_CONFIG_HOME: root };
    requireSuccess(
      run(
        "node",
        [
          "scripts/config.mjs",
          "whitelist",
          "add",
          "anthropic/claude-sonnet-4-6",
        ],
        env,
      ),
    );
    requireSuccess(
      run(
        "node",
        ["scripts/config.mjs", "blacklist", "add", "openai-codex/gpt-5.6-sol"],
        env,
      ),
    );
    const path = join(root, "pi-coder", "config.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      allowModels: ["anthropic/claude-sonnet-4-6"],
      blockModels: ["openai-codex/gpt-5.6-sol"],
    });
    expect(lstatSync(join(root, "pi-coder")).mode & 0o777).toBe(0o700);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
  });

  it("shows the same legacy explicit policy that the runtime resolves", () => {
    const root = mkdtempSync(join(tmpdir(), "pic-config-show-"));
    const directory = join(root, "pi-coder");
    mkdirSync(directory);
    writeFileSync(
      join(directory, "config.json"),
      JSON.stringify({
        models: [{ provider: "anthropic", id: "legacy-only", tier: "strong" }],
        tierOverrides: {
          "anthropic/legacy-only": "invalid",
          "openai/future-model": "fast",
        },
      }),
    );
    const result = run("node", ["scripts/config.mjs", "show"], {
      XDG_CONFIG_HOME: root,
    });
    requireSuccess(result);
    expect(JSON.parse(result.stdout).resolvedModels).toEqual([
      { provider: "anthropic", id: "legacy-only", tier: "strong" },
    ]);
  });

  it("fails closed when config control fields have malformed shapes", () => {
    for (const malformed of [
      { allowModels: "not-an-array" },
      { blockModels: {} },
      { tierOverrides: [] },
    ]) {
      const root = mkdtempSync(join(tmpdir(), "pic-config-malformed-"));
      const directory = join(root, "pi-coder");
      mkdirSync(directory);
      writeFileSync(join(directory, "config.json"), JSON.stringify(malformed));
      const result = run("node", ["scripts/config.mjs", "show"], {
        XDG_CONFIG_HOME: root,
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("invalid configuration");
    }
  });

  it("migrates a legacy explicit policy before applying config commands", () => {
    const root = mkdtempSync(join(tmpdir(), "pic-config-migrate-"));
    const directory = join(root, "pi-coder");
    mkdirSync(directory);
    const path = join(directory, "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        models: [
          { provider: "anthropic", id: "legacy-a", tier: "balanced" },
          { provider: "openai-codex", id: "legacy-b", tier: "strong" },
        ],
      }),
    );
    const env = { XDG_CONFIG_HOME: root };
    requireSuccess(
      run(
        "node",
        ["scripts/config.mjs", "blacklist", "add", "anthropic/legacy-a"],
        env,
      ),
    );
    const migrated = JSON.parse(readFileSync(path, "utf8"));
    expect(migrated.models).toBeUndefined();
    expect(migrated.allowModels).toEqual([
      "anthropic/legacy-a",
      "openai-codex/legacy-b",
    ]);
    expect(migrated.tierOverrides).toEqual({
      "anthropic/legacy-a": "balanced",
      "openai-codex/legacy-b": "strong",
    });
    const show = run("node", ["scripts/config.mjs", "show"], env);
    requireSuccess(show);
    expect(JSON.parse(show.stdout).resolvedModels).toEqual([
      { provider: "openai-codex", id: "legacy-b", tier: "strong" },
    ]);
  });

  it("installs from main and pic update fast-forwards and rebuilds", () => {
    const root = mkdtempSync(join(tmpdir(), "pic-install-"));
    const source = join(root, "source");
    const home = join(root, "home");
    const binDir = join(root, "bin");
    const fakeBun = join(root, "bun");
    mkdirSync(join(source, "bin"), { recursive: true });
    mkdirSync(join(source, "scripts"), { recursive: true });
    cpSync(join(repo, "bin/pic"), join(source, "bin/pic"));
    cpSync(
      join(repo, "scripts/install.sh"),
      join(source, "scripts/install.sh"),
    );
    chmodSync(join(source, "bin/pic"), 0o755);
    chmodSync(join(source, "scripts/install.sh"), 0o755);
    writeFileSync(join(source, "package.json"), '{"name":"fixture"}\n');
    writeFileSync(join(source, "bun.lock"), "fixture\n");
    writeFileSync(join(source, ".gitignore"), "dist/\nnode_modules/\n");
    writeFileSync(
      fakeBun,
      `#!/usr/bin/env bash
set -eu
printf "%s\\n" "$*" >> "\${PIC_TEST_BUN_LOG}"
if [ "\${1:-}" = "--cwd" ]; then cd "$2"; shift 2; fi
is_build=0
case " $* " in *" run build "*) is_build=1 ;; esac
if [ "\${PIC_TEST_FAIL_BUILD_ONCE:-}" = "1" ] && [ "$is_build" = "1" ] && [ ! -e "\${PIC_TEST_FAIL_MARKER}" ]; then mkdir -p dist; : > dist/failed-artifact; touch "\${PIC_TEST_FAIL_MARKER}"; exit 42; fi
if [ "$is_build" = "1" ]; then mkdir -p dist; : > dist/extension.js; fi
`,
    );
    chmodSync(fakeBun, 0o755);
    for (const args of [
      ["init", "-b", "main"],
      ["config", "user.name", "Fixture"],
      ["config", "user.email", "fixture@example.invalid"],
      ["add", "."],
      ["commit", "-m", "initial"],
    ]) {
      const result = spawnSync("git", args, { cwd: source, encoding: "utf8" });
      requireSuccess(result);
    }
    const bunLog = join(root, "bun.log");
    const env = {
      PIC_REPOSITORY: source,
      PIC_HOME: home,
      PIC_BIN_DIR: binDir,
      PIC_BUN_BIN: fakeBun,
      PIC_TEST_BUN_LOG: bunLog,
    };
    const install = run("bash", ["scripts/install.sh", "install"], env);
    requireSuccess(install);
    expect(lstatSync(join(binDir, "pic")).isSymbolicLink()).toBe(true);
    expect(readFileSync(bunLog, "utf8")).toContain("install --frozen-lockfile");
    expect(readFileSync(bunLog, "utf8")).toContain("run build");

    writeFileSync(join(source, "marker"), "updated\n");
    for (const args of [
      ["add", "marker"],
      ["commit", "-m", "update"],
    ]) {
      const result = spawnSync("git", args, { cwd: source, encoding: "utf8" });
      requireSuccess(result);
    }
    const update = spawnSync(join(binDir, "pic"), ["update"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    requireSuccess(update);
    expect(readFileSync(join(home, "marker"), "utf8")).toBe("updated\n");

    const stableHead = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: home,
      encoding: "utf8",
    }).stdout.trim();
    writeFileSync(join(source, "failed-marker"), "must roll back\n");
    for (const args of [
      ["add", "failed-marker"],
      ["commit", "-m", "failing update"],
    ]) {
      const result = spawnSync("git", args, { cwd: source, encoding: "utf8" });
      requireSuccess(result);
    }
    const failedUpdate = spawnSync(join(binDir, "pic"), ["update"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        PIC_TEST_FAIL_BUILD_ONCE: "1",
        PIC_TEST_FAIL_MARKER: join(root, "failed-once"),
      },
    });
    expect(failedUpdate.status).not.toBe(0);
    const rolledBackHead = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: home,
      encoding: "utf8",
    }).stdout.trim();
    expect(rolledBackHead).toBe(stableHead);
    expect(() => readFileSync(join(home, "failed-marker"), "utf8")).toThrow();
    expect(() =>
      readFileSync(join(home, "dist/failed-artifact"), "utf8"),
    ).toThrow();

    requireSuccess(
      spawnSync("git", ["checkout", "-b", "work"], {
        cwd: home,
        encoding: "utf8",
      }),
    );
    const mainBefore = spawnSync("git", ["rev-parse", "main"], {
      cwd: home,
      encoding: "utf8",
    }).stdout.trim();
    const wrongBranchUpdate = spawnSync(join(binDir, "pic"), ["update"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    expect(wrongBranchUpdate.status).not.toBe(0);
    expect(wrongBranchUpdate.stderr).toContain("must be on main");
    const mainAfter = spawnSync("git", ["rev-parse", "main"], {
      cwd: home,
      encoding: "utf8",
    }).stdout.trim();
    expect(mainAfter).toBe(mainBefore);
  });

  it("refuses to adopt an existing checkout from another repository", () => {
    const root = mkdtempSync(join(tmpdir(), "pic-wrong-origin-"));
    const home = join(root, "home");
    mkdirSync(home);
    requireSuccess(
      spawnSync("git", ["init", "-b", "main"], { cwd: home, encoding: "utf8" }),
    );
    requireSuccess(
      spawnSync(
        "git",
        ["remote", "add", "origin", "https://example.invalid/not-pic.git"],
        {
          cwd: home,
          encoding: "utf8",
        },
      ),
    );
    const result = run("bash", ["scripts/install.sh", "install"], {
      PIC_HOME: home,
      PIC_REPOSITORY: "https://github.com/pal-bot/pi-coder.git",
      PIC_BUN_BIN: "/usr/bin/true",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unexpected origin");
  });

  it("refuses to replace a real directory at the pic link destination", () => {
    const root = mkdtempSync(join(tmpdir(), "pic-link-collision-"));
    const source = join(root, "source");
    const binDir = join(root, "bin");
    mkdirSync(source);
    mkdirSync(join(binDir, "pic"), { recursive: true });
    requireSuccess(
      spawnSync("git", ["init", "-b", "main"], {
        cwd: source,
        encoding: "utf8",
      }),
    );
    requireSuccess(
      spawnSync("git", ["remote", "add", "origin", source], {
        cwd: source,
        encoding: "utf8",
      }),
    );
    const result = run("bash", ["scripts/install.sh", "install"], {
      PIC_HOME: source,
      PIC_REPOSITORY: source,
      PIC_BIN_DIR: binDir,
      PIC_BUN_BIN: "/usr/bin/true",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refusing to replace");
  });
});
