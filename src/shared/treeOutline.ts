/**
 * Tree mode: the first reply is an overview plus a `<tree-outline>` block that lists branches and
 * the pages under each. The renderer turns it into nodes (`buildTree.ts`); a page is written later.
 */

export type TreeTopic = { title: string; blurb: string; question: string };
export type TreeBranch = { title: string; summary: string; topics: TreeTopic[] };
export type TreeOutline = { branches: TreeBranch[] };

export const TREE_OPEN = "<tree-outline>";
export const TREE_CLOSE = "</tree-outline>";

export const MAX_BRANCHES = 10;
export const MAX_TOPICS = 8;
/** Branches and pages together, so a vague prompt can't fill the canvas. */
export const MAX_TREE_NODES = 60;

const TITLE_MAX = 80;
const LINE_MAX = 240;
const QUESTION_MAX = 600;

/** Appended to the system prompt of a tree run (in place of the next-steps instruction). */
export const TREE_PLAN_INSTRUCTION = `TREE MODE: The user wants this answer laid out as a tree of pages they open one by one. If the question is about their project, you may look at it first. Then reply with a short overview (under 250 words; a table of the main branches with a one-line description each) and end with this block:

${TREE_OPEN}
{"branches":[{"title":"Branch title","summary":"One sentence on what this branch covers.","topics":[{"title":"Page title","blurb":"One line on what the page covers.","question":"A complete, standalone question this page answers."}]}]}
${TREE_CLOSE}

Rules:
- Use 3–${MAX_BRANCHES} branches (fewer for a narrow subject), each with 2–${MAX_TOPICS} topics. Go from the basics to the details.
- Pages stand alone: no required reading order, and each question must make sense without the others.
- Titles are at most 6 words. Summary and blurb are one line each.
- The block is valid JSON on its own lines, not in a code fence, and nothing follows it.
- Do not write the pages themselves; the user asks for them later.`;

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Drops a ```json fence the model sometimes adds inside the block. */
const unfence = (body: string): string => body.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/**
 * The outline in a `<tree-outline>` body, trimmed to the caps; null when it holds no usable branch.
 * Entries missing a title (or a page missing its question) are skipped rather than failing the tree.
 */
export function parseTreeOutline(body: string): TreeOutline | null {
  let raw: unknown;
  try {
    raw = JSON.parse(unfence(body));
  } catch {
    return null;
  }
  const rawBranches = (raw as { branches?: unknown } | null)?.branches;
  if (!Array.isArray(rawBranches)) return null;

  const branches: TreeBranch[] = [];
  let nodes = 0;
  for (const rb of rawBranches.slice(0, MAX_BRANCHES)) {
    const title = text(rb?.title, TITLE_MAX);
    if (!title || nodes >= MAX_TREE_NODES) continue;
    nodes += 1;
    const topics: TreeTopic[] = [];
    const rawTopics: unknown[] = Array.isArray(rb?.topics) ? rb.topics : [];
    for (const rt of rawTopics.slice(0, MAX_TOPICS)) {
      const t = rt as { title?: unknown; blurb?: unknown; question?: unknown } | null;
      const topicTitle = text(t?.title, TITLE_MAX);
      const question = text(t?.question, QUESTION_MAX);
      if (!topicTitle || !question || nodes >= MAX_TREE_NODES) continue;
      nodes += 1;
      topics.push({ title: topicTitle, blurb: text(t?.blurb, LINE_MAX), question });
    }
    branches.push({ title, summary: text(rb?.summary, LINE_MAX), topics });
  }
  return branches.length > 0 ? { branches } : null;
}

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/** The text of a branch node: its summary and a table of its pages. Written by us, not the model. */
export function branchIndexMarkdown(branch: TreeBranch): string {
  const rows = branch.topics.map((t) => `| **${cell(t.title)}** | ${cell(t.blurb)} |`);
  const table = rows.length > 0 ? `\n\n| Page | What it covers |\n|---|---|\n${rows.join("\n")}` : "";
  return `${branch.summary}${table}`.trim();
}
