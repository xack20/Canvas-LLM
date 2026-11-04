import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { shellEnv } from "../../shellPath";

type Args = Record<string, unknown>;
export type ToolOutcome = { content: string; isError: boolean };

const MAX_OUTPUT = 20_000;
const MAX_READ_LINES = 2000;
const MAX_MATCHES = 100;
const MAX_FILES_SCANNED = 5000;
const MAX_GREP_FILE_BYTES = 1_000_000;
const BASH_TIMEOUT_MS = 120_000;
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "out", ".next"]);

// Named like Claude Code's tools so approvals and the node's tool display treat them the same.
const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required } },
});
const str = (description: string) => ({ type: "string", description });

export const LOCAL_TOOLS = [
  fn(
    "Read",
    "Read a text file. Returns numbered lines.",
    { file_path: str("Path relative to the working folder"), offset: { type: "number", description: "First line (1-based)" }, limit: { type: "number", description: "Number of lines" } },
    ["file_path"],
  ),
  fn("LS", "List the files and folders in a directory.", { path: str("Directory, relative to the working folder (default: the folder itself)") }, []),
  fn("Glob", "Find files by glob pattern, e.g. src/**/*.ts.", { pattern: str("Glob pattern") }, ["pattern"]),
  fn(
    "Grep",
    "Search file contents with a regular expression. Returns path:line: text.",
    { pattern: str("Regular expression"), path: str("Directory to search (default: the working folder)") },
    ["pattern"],
  ),
  fn("Write", "Create or overwrite a file.", { file_path: str("Path relative to the working folder"), content: str("Full file content") }, ["file_path", "content"]),
  fn(
    "Edit",
    "Replace one exact piece of text in a file. old_string must appear exactly once.",
    { file_path: str("Path relative to the working folder"), old_string: str("Exact text to replace"), new_string: str("Replacement text") },
    ["file_path", "old_string", "new_string"],
  ),
  fn("Bash", "Run a shell command in the working folder and return its output.", { command: str("The command") }, ["command"]),
];

export const LOCAL_TOOL_NAMES = new Set(LOCAL_TOOLS.map((t) => t.function.name));

function arg(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`Missing text argument "${key}".`);
  return v;
}

const isOutside = (from: string, to: string): boolean => {
  const rel = relative(from, to);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
};

/**
 * The file tools stay inside the working folder, symlinks included: the nearest existing part of
 * the path is resolved to its real location before it is checked. shortcut: a link swapped in
 * between this check and the file operation isn't caught; upgrade if the folder is shared with others.
 */
export async function resolveInside(cwd: string, p: string): Promise<string> {
  const abs = resolve(cwd, p);
  if (isOutside(cwd, abs)) throw new Error(`${p} is outside the working folder.`);
  const root = await realpath(cwd);
  for (let probe = abs; ; probe = dirname(probe)) {
    try {
      if (isOutside(root, await realpath(probe))) throw new Error(`${p} is outside the working folder.`);
      return abs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" || dirname(probe) === probe) throw err;
      // A link whose target doesn't exist yet would be written through to wherever it points.
      if ((await lstat(probe).catch(() => null))?.isSymbolicLink()) throw new Error(`${p} goes through a link that points nowhere.`);
    }
  }
}

const clip = (text: string): string =>
  text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[output truncated at ${MAX_OUTPUT} characters]` : text;

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Every file under `dir` as a path relative to `root`, skipping dependency and build folders. */
async function walk(root: string, dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FILES_SCANNED) break;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) await walk(root, join(dir, entry.name), out);
    } else if (entry.isFile()) out.push(relative(root, join(dir, entry.name)).split(sep).join("/"));
  }
  return out;
}

async function read(cwd: string, args: Args): Promise<string> {
  const lines = (await readFile(await resolveInside(cwd, arg(args, "file_path")), "utf8")).split("\n");
  const start = Math.max(1, typeof args.offset === "number" ? Math.floor(args.offset) : 1);
  const count = Math.min(MAX_READ_LINES, typeof args.limit === "number" ? Math.floor(args.limit) : MAX_READ_LINES);
  return lines
    .slice(start - 1, start - 1 + count)
    .map((line, i) => `${String(start + i).padStart(5)}\t${line}`)
    .join("\n");
}

async function ls(cwd: string, args: Args): Promise<string> {
  const entries = await readdir(await resolveInside(cwd, typeof args.path === "string" ? args.path : "."), { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join("\n") || "(empty)";
}

async function glob(cwd: string, args: Args): Promise<string> {
  const re = globToRegExp(arg(args, "pattern"));
  const hits = (await walk(cwd, cwd)).filter((f) => re.test(f));
  return hits.length ? hits.slice(0, 200).join("\n") : "No files matched.";
}

async function grep(cwd: string, args: Args): Promise<string> {
  const base = await resolveInside(cwd, typeof args.path === "string" ? args.path : ".");
  let re: RegExp;
  try {
    re = new RegExp(arg(args, "pattern"));
  } catch {
    re = new RegExp(arg(args, "pattern").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  const matches: string[] = [];
  for (const file of await walk(cwd, base)) {
    if (matches.length >= MAX_MATCHES) break;
    const abs = join(cwd, file);
    if ((await stat(abs)).size > MAX_GREP_FILE_BYTES) continue;
    const text = await readFile(abs, "utf8");
    if (text.slice(0, 1000).includes("\0")) continue;
    text.split("\n").forEach((line, i) => {
      if (matches.length < MAX_MATCHES && re.test(line)) matches.push(`${file}:${i + 1}: ${line.trim().slice(0, 300)}`);
    });
  }
  return matches.length ? matches.join("\n") : "No matches.";
}

async function write(cwd: string, args: Args): Promise<string> {
  const path = await resolveInside(cwd, arg(args, "file_path"));
  const content = arg(args, "content");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return `Wrote ${content.length} characters to ${relative(cwd, path)}.`;
}

async function edit(cwd: string, args: Args): Promise<string> {
  const path = await resolveInside(cwd, arg(args, "file_path"));
  const oldText = arg(args, "old_string");
  const text = await readFile(path, "utf8");
  const count = oldText ? text.split(oldText).length - 1 : 0;
  if (count !== 1) throw new Error(count === 0 ? "old_string was not found in the file." : `old_string appears ${count} times; include more context so it is unique.`);
  await writeFile(path, text.replace(oldText, () => arg(args, "new_string")), "utf8");
  return `Edited ${relative(cwd, path)}.`;
}

async function bash(cwd: string, args: Args, signal: AbortSignal): Promise<string> {
  const command = arg(args, "command");
  const env = await shellEnv();
  const win = process.platform === "win32";
  return new Promise((resolveRun) => {
    const proc = spawn(win ? (env.ComSpec ?? "cmd.exe") : "/bin/sh", win ? ["/d", "/s", "/c", command] : ["-c", command], {
      cwd,
      env,
      windowsHide: true,
    });
    let output = "";
    const collect = (chunk: Buffer): void => {
      output = (output + chunk.toString("utf8")).slice(-MAX_OUTPUT * 2);
    };
    proc.stdout.on("data", collect);
    proc.stderr.on("data", collect);
    const stop = (): void => void proc.kill("SIGTERM");
    const timer = setTimeout(stop, BASH_TIMEOUT_MS);
    signal.addEventListener("abort", stop, { once: true });
    const finish = (tail: string): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      resolveRun(`${output.trimEnd()}\n${tail}`.trim());
    };
    proc.on("error", (err) => finish(`[could not start the command: ${err.message}]`));
    proc.on("close", (code, sig) => finish(sig ? `[stopped by ${sig}]` : `[exit code ${code}]`));
  });
}

/** Runs one tool call. Failures come back as an error result the model can react to. */
export async function runLocalTool(name: string, args: Args, cwd: string, signal: AbortSignal): Promise<ToolOutcome> {
  try {
    const content =
      name === "Read" ? await read(cwd, args)
      : name === "LS" ? await ls(cwd, args)
      : name === "Glob" ? await glob(cwd, args)
      : name === "Grep" ? await grep(cwd, args)
      : name === "Write" ? await write(cwd, args)
      : name === "Edit" ? await edit(cwd, args)
      : name === "Bash" ? await bash(cwd, args, signal)
      : undefined;
    if (content === undefined) return { content: `Unknown tool "${name}".`, isError: true };
    return { content: clip(content), isError: false };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
