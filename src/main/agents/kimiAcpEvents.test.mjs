// .mjs keeps the bun:test import out of `bun run typecheck`.
import { describe, expect, test } from "bun:test";
import { acpUpdateEvents, permissionOutcome, permissionQuestion } from "./kimiAcpEvents.ts";

const text = (t) => [{ type: "content", content: { type: "text", text: t } }];
const request = {
  toolCall: { toolCallId: "t1", title: "Bash", content: text("Requesting approval to Running: rm -rf build") },
  options: [
    { optionId: "approve_once", kind: "allow_once" },
    { optionId: "approve_always", kind: "allow_always" },
    { optionId: "reject", kind: "reject_once" },
  ],
};
const answered = (decision) => ({ id: "r", cancelled: false, answers: { decision } });

describe("acpUpdateEvents", () => {
  test("a usage_update becomes an exact context measurement; a malformed one is dropped", () => {
    const [ev] = acpUpdateEvents({ sessionUpdate: "usage_update", used: 15164, size: 262144 });
    expect(ev).toMatchObject({ kind: "context", context: { tokens: 15164, window: 262144, exact: true } });
    expect(acpUpdateEvents({ sessionUpdate: "usage_update", used: 1 })).toEqual([]);
  });

  test("message and thought chunks become text and thinking deltas", () => {
    expect(acpUpdateEvents({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })).toEqual([{ kind: "text_delta", text: "hi" }]);
    expect(acpUpdateEvents({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hm" } })).toEqual([{ kind: "thinking_delta", text: "hm" }]);
    expect(acpUpdateEvents({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } })).toEqual([]);
  });

  test("a tool call opens a tool_use and only the final status closes it", () => {
    expect(acpUpdateEvents({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Bash", status: "pending" })).toEqual([
      { kind: "tool_use", toolUseId: "t1", name: "Bash", input: {} },
    ]);
    expect(acpUpdateEvents({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" })).toEqual([]);
    expect(acpUpdateEvents({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: text("ok\n") })).toEqual([
      { kind: "tool_result", toolUseId: "t1", content: "ok\n", isError: false },
    ]);
    expect(acpUpdateEvents({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed", rawOutput: "boom" })).toEqual([
      { kind: "tool_result", toolUseId: "t1", content: "boom", isError: true },
    ]);
  });

  test("Antigravity's tool call keeps its name and input", () => {
    const rawInput = { CommandLine: "ls", toolSummary: "Run ls command" };
    expect(acpUpdateEvents({ sessionUpdate: "tool_call", toolCallId: "c1", name: "run_command", title: "ls", kind: "execute", rawInput })).toEqual([
      { kind: "tool_use", toolUseId: "c1", name: "run_command", input: rawInput },
    ]);
  });

  test("other updates and junk make no events", () => {
    for (const update of [{ sessionUpdate: "available_commands_update" }, { sessionUpdate: "session_info_update" }, null, "x"]) {
      expect(acpUpdateEvents(update)).toEqual([]);
    }
  });
});

describe("permissionQuestion", () => {
  test("shows the call the way Claude's prompt does, with the command as the preview", () => {
    const q = permissionQuestion(request);
    expect(q).toMatchObject({ id: "decision", header: "Approval", question: "Allow Kimi to use Bash?" });
    expect(q.options.map((o) => o.label)).toEqual(["Allow once", "Always allow", "Deny"]);
    expect(q.options[0].preview).toBe("Running: rm -rf build");
  });

  test("names the agent and takes the command preview from rawInput (Antigravity)", () => {
    const q = permissionQuestion(
      {
        toolCall: { title: "ls", rawInput: { CommandLine: "ls -la" } },
        options: [
          { optionId: "allow", kind: "allow_once" },
          { optionId: "deny", kind: "reject_once" },
        ],
      },
      "Antigravity",
    );
    expect(q.question).toBe("Allow Antigravity to use ls?");
    expect(q.options.map((o) => o.label)).toEqual(["Allow once", "Deny"]);
    expect(q.options[0].preview).toBe("ls -la");
    expect(q.options[1].description).toContain("Antigravity");
  });

  test("offers only what Kimi offered", () => {
    const q = permissionQuestion({ ...request, options: [request.options[0], request.options[2]] });
    expect(q.options.map((o) => o.label)).toEqual(["Allow once", "Deny"]);
  });
});

describe("permissionOutcome", () => {
  test("each answer selects the matching Kimi option", () => {
    expect(permissionOutcome(request, answered("Allow once"))).toEqual({ outcome: "selected", optionId: "approve_once" });
    expect(permissionOutcome(request, answered("Always allow"))).toEqual({ outcome: "selected", optionId: "approve_always" });
    expect(permissionOutcome(request, answered("Deny"))).toEqual({ outcome: "selected", optionId: "reject" });
  });

  test("a cancelled, unknown or unavailable answer cancels the call instead of approving it", () => {
    expect(permissionOutcome(request, { id: "r", cancelled: true })).toEqual({ outcome: "cancelled" });
    expect(permissionOutcome(request, answered("Something else"))).toEqual({ outcome: "cancelled" });
    expect(permissionOutcome({ options: [request.options[2]] }, answered("Allow once"))).toEqual({ outcome: "cancelled" });
  });
});
