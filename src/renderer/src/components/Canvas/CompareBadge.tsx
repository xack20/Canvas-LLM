import { useEffect, useMemo, useState } from "react";
import { GitCompare } from "lucide-react";
import type { CodexModelInfo, KimiModelInfo, LocalModelInfo, NodeId, Provider } from "@shared/types";
import { findClaudeModel } from "@shared/claudeModels";
import { splitClaudeModels, withoutFailed } from "@shared/modelCatalog";
import { useCanvasStore } from "@/hooks/useCanvasStore";
import { useClaudeModelList } from "@/hooks/useClaudeModels";
import { useCompareStore } from "@/hooks/useCompareStore";
import { useModelChecksStore } from "@/hooks/useModelChecksStore";
import { useProviderInfo } from "@/hooks/useProviderInfo";
import { MAX_COMPARE_EXTRA, targetKey, toggleTarget, type CompareTarget } from "@/lib/compareTargets";
import { BadgePopover } from "./BadgePopover";
import { ModelOption } from "./ModelOption";
import { ProviderLogo } from "./ProviderLogo";

type Props = { nodeId: NodeId; popoverSide?: "top" | "bottom" };
const NO_TARGETS: CompareTarget[] = [];

/**
 * Pick extra models before sending: the prompt then also goes to a sibling node per model, so the
 * answers sit side by side. Hidden on a blank merge node (it has several parents).
 */
export function CompareBadge({ nodeId, popoverSide }: Props) {
  const picked = useCompareStore((s) => s.byNode[nodeId] ?? NO_TARGETS);
  const setPicked = useCompareStore((s) => s.set);
  const mergeInput = useCanvasStore((s) => {
    const chat = s.nodes[nodeId]?.data.chat;
    return !!chat && chat.parentIds.length > 1 && chat.messages.length === 0;
  });
  const provider = useCanvasStore((s) => s.getEffectiveProvider(nodeId));
  const ownModel = useCanvasStore((s) => s.nodes[nodeId]?.data.nodeSettings?.model);
  const ownProvider = useCanvasStore((s) => s.nodes[nodeId]?.data.nodeSettings?.provider);
  const { claudeModelId } = useProviderInfo(provider);
  const claudeList = useClaudeModelList()?.models;

  if (mergeInput) return null;

  // The node's own model is always in the compare, so it isn't offered again.
  const ownKey = targetKey({
    provider,
    model:
      provider === "claude"
        ? (findClaudeModel(claudeList ?? [], ownModel ?? claudeModelId)?.value ?? ownModel ?? claudeModelId)
        : ownProvider === provider
          ? ownModel
          : undefined,
  });
  const toggle = (target: CompareTarget): void => setPicked(nodeId, toggleTarget(picked, target));
  const full = picked.length >= MAX_COMPARE_EXTRA;

  return (
    <BadgePopover
      side={popoverSide}
      title={
        picked.length > 0
          ? `Also sends this prompt to ${picked.length} more model${picked.length === 1 ? "" : "s"} · click to change`
          : "Compare: also send the prompt to other models"
      }
      overridden={picked.length > 0}
      ariaHasPopup="listbox"
      panelClassName="w-[264px]"
      label={
        <>
          <GitCompare className="h-[10px] w-[10px] text-muted-foreground" />
          <span className="tracking-tight text-[8px] uppercase">
            {picked.length > 0 ? `+${picked.length}` : "compare"}
          </span>
        </>
      }
    >
      {() => (
        <div role="listbox" aria-label="Compare models" aria-multiselectable className="nowheel max-h-[340px] overflow-y-auto pb-1">
          <p className="px-2.5 pt-2 pb-1 text-[9px] text-muted-foreground">
            Also send to (up to {MAX_COMPARE_EXTRA}). Each gets its own node and asks before it acts.
          </p>
          <CompareModelRows ownKey={ownKey} picked={picked} full={full} onToggle={toggle} />
          <p className="mt-1 border-t border-border px-2.5 pt-1.5 text-[9px] text-muted-foreground">
            Cursor can't ask for approval, so it isn't offered here.
          </p>
        </div>
      )}
    </BadgePopover>
  );
}

type RowsProps = { ownKey: string; picked: CompareTarget[]; full: boolean; onToggle: (t: CompareTarget) => void };

/** Mounted with the popover, so the lists are read when it opens. */
function CompareModelRows({ ownKey, picked, full, onToggle }: RowsProps) {
  const checks = useModelChecksStore((s) => s.checks);
  const loadChecks = useModelChecksStore((s) => s.load);
  const claude = useClaudeModelList()?.models;
  const [codex, setCodex] = useState<CodexModelInfo[]>([]);
  const [kimi, setKimi] = useState<KimiModelInfo[]>([]);
  const [local, setLocal] = useState<LocalModelInfo[]>([]);
  useEffect(() => {
    void window.api.providers.localModels().then(setLocal).catch(() => setLocal([]));
    void loadChecks();
    void window.api.providers.codexRuntime().then((r) => setCodex(r.models)).catch(() => setCodex([]));
    void window.api.providers.kimiModels().then(setKimi).catch(() => setKimi([]));
  }, [loadChecks]);

  const groups = useMemo(() => {
    const claudeLatest = withoutFailed(splitClaudeModels(claude ?? []).latest, "claude", checks, (m) => m.value);
    const claudeTargets = claudeLatest.map((m) => ({ provider: "claude" as const, model: m.value, label: m.displayName }));
    const codexTargets = withoutFailed(codex, "codex", checks, (m) => m.id).map((m) => ({
      provider: "codex" as const,
      model: m.id,
      label: m.displayName,
    }));
    const kimiTargets = withoutFailed(
      kimi.filter((m) => m.latest),
      "kimi",
      checks,
      (m) => m.id,
    ).map((m) => ({ provider: "kimi" as const, model: m.id, label: m.displayName }));
    const localTargets = local.map((m) => ({ provider: "local" as const, model: m.id, label: m.displayName }));
    return [
      { provider: "claude" as Provider, title: "Claude", targets: claudeTargets },
      { provider: "codex" as Provider, title: "Codex", targets: codexTargets },
      { provider: "kimi" as Provider, title: "Kimi", targets: kimiTargets },
      { provider: "local" as Provider, title: "Local", targets: localTargets },
    ];
  }, [claude, codex, kimi, local, checks]);

  const pickedKeys = new Set(picked.map(targetKey));
  return (
    <>
      {groups.map(({ provider, title, targets }) => {
        const offered = targets.filter((t) => targetKey(t) !== ownKey);
        if (offered.length === 0) return null;
        return (
          <div key={provider}>
            <div
              className="mt-1 flex items-center gap-1.5 border-t border-border px-2.5 pt-2 pb-1 text-[8px] uppercase tracking-[0.14em] text-muted-foreground"
              style={{ fontFamily: "var(--font-geist-mono)" }}
            >
              <ProviderLogo provider={provider} size={9} />
              {title}
            </div>
            {offered.map((t) => {
              const on = pickedKeys.has(targetKey(t));
              return (
                <ModelOption
                  key={targetKey(t)}
                  provider={t.provider}
                  active={on}
                  title={t.label}
                  subtitle={!on && full ? `Limit of ${MAX_COMPARE_EXTRA} reached` : (t.model ?? "")}
                  onSelect={() => onToggle(t)}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
}
