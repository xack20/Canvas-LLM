// .mjs keeps the bun:test import out of `bun run typecheck`.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globToRegExp, resolveInside, runLocalTool } from "./tools.ts";

const cwd = mkdtempSync(join(tmpdir(), "local-tools-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));
mkdirSync(join(cwd, "src/deep"), { recursive: true });
mkdirSync(join(cwd, "node_modules/pkg"), { recursive: true });
writeFileSync(join(cwd, "a.txt"), "one\ntwo\nthree\n");
writeFileSync(join(cwd, "src/deep/b.ts"), "export const answer = 42;\n");
writeFileSync(join(cwd, "node_modules/pkg/skip.ts"), "answer\n");
const signal = new AbortController().signal;
const run = (name, args) => runLocalTool(name, args, cwd, signal);

describe("file tools stay inside the working folder", () => {
  test("paths that climb out are refused", async () => {
    await expect(resolveInside(cwd, "../x")).rejects.toThrow("outside");
    await expect(resolveInside(cwd, "/etc/passwd")).rejects.toThrow("outside");
    expect(await resolveInside(cwd, "..hidden")).toBe(join(cwd, "..hidden"));
    expect(await resolveInside(cwd, "not/yet/there.txt")).toBe(join(cwd, "not/yet/there.txt"));
    expect(await run("Read", { file_path: "../x" })).toMatchObject({ isError: true });
    expect(await run("Write", { file_path: "/tmp/nope.txt", content: "x" })).toMatchObject({ isError: true });
  });
});

describe("symlinks can't lead out of the working folder", () => {
  const outside = mkdtempSync(join(tmpdir(), "local-outside-"));
  afterAll(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync(outside, join(cwd, "linkdir"));
  symlinkSync(join(outside, "secret.txt"), join(cwd, "linkfile"));

  test("reading or writing through a link to outside is refused", async () => {
    expect(await run("Read", { file_path: "linkfile" })).toMatchObject({ isError: true });
    expect(await run("Read", { file_path: "linkdir/secret.txt" })).toMatchObject({ isError: true });
    expect(await run("Write", { file_path: "linkdir/new.txt", content: "x" })).toMatchObject({ isError: true });
    expect(await run("LS", { path: "linkdir" })).toMatchObject({ isError: true });
  });

  test("a link to a path that doesn't exist yet can't be used to create a file outside", async () => {
    symlinkSync(join(outside, "created.txt"), join(cwd, "dangling"));
    symlinkSync(join(outside, "newdir"), join(cwd, "danglingdir"));
    expect(await run("Write", { file_path: "dangling", content: "x" })).toMatchObject({ isError: true });
    expect(await run("Write", { file_path: "danglingdir/f.txt", content: "x" })).toMatchObject({ isError: true });
    expect(existsSync(join(outside, "created.txt"))).toBe(false);
    expect(existsSync(join(outside, "newdir"))).toBe(false);
  });

  test("Glob and Grep don't follow links out", async () => {
    expect((await run("Grep", { pattern: "secret" })).content).toBe("No matches.");
    expect((await run("Glob", { pattern: "**/*.txt" })).content).not.toContain("secret.txt");
  });
});

describe("tools", () => {
  test("Read numbers lines and honours offset and limit", async () => {
    expect((await run("Read", { file_path: "a.txt", offset: 2, limit: 1 })).content).toBe("    2\ttwo");
  });

  test("LS lists with a slash after folders", async () => {
    expect((await run("LS", {})).content.split("\n")).toEqual(["a.txt", "dangling", "danglingdir", "linkdir", "linkfile", "node_modules/", "src/"]);
  });

  test("Glob matches nested paths and skips dependency folders", async () => {
    expect((await run("Glob", { pattern: "**/*.ts" })).content).toBe("src/deep/b.ts");
    expect((await run("Glob", { pattern: "*.nothing" })).content).toBe("No files matched.");
    expect(globToRegExp("src/**/*.ts").test("src/deep/b.ts")).toBe(true);
    expect(globToRegExp("*.ts").test("src/b.ts")).toBe(false);
  });

  test("Grep reports path:line: text, skipping dependency folders", async () => {
    expect((await run("Grep", { pattern: "answer" })).content).toBe("src/deep/b.ts:1: export const answer = 42;");
    expect((await run("Grep", { pattern: "zzz" })).content).toBe("No matches.");
  });

  test("Write creates folders; Edit needs exactly one match", async () => {
    await run("Write", { file_path: "new/dir/c.txt", content: "hello world" });
    expect(readFileSync(join(cwd, "new/dir/c.txt"), "utf8")).toBe("hello world");
    expect(await run("Edit", { file_path: "new/dir/c.txt", old_string: "world", new_string: "there $&" })).toMatchObject({ isError: false });
    expect(readFileSync(join(cwd, "new/dir/c.txt"), "utf8")).toBe("hello there $&");
    expect((await run("Edit", { file_path: "a.txt", old_string: "zzz", new_string: "y" })).content).toContain("not found");
    writeFileSync(join(cwd, "dup.txt"), "x x");
    expect((await run("Edit", { file_path: "dup.txt", old_string: "x", new_string: "y" })).content).toContain("2 times");
  });

  test("Bash runs in the folder and reports the exit code", async () => {
    const { content } = await run("Bash", { command: "pwd && echo hi >&2 && exit 3" });
    expect(content).toContain("hi");
    expect(content).toContain("local-tools-");
    expect(content.endsWith("[exit code 3]")).toBe(true);
  });

  test("an unknown tool or a missing argument is an error result, not a throw", async () => {
    expect(await run("Nope", {})).toMatchObject({ isError: true });
    expect(await run("Read", {})).toMatchObject({ isError: true });
  });
});
