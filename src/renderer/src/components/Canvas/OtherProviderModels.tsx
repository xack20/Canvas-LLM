import { useEffect, useState, type ReactNode } from "react";
import type { CodexModelInfo, KimiModelInfo, LocalModelInfo, NodeId, NodeSettings, Provider } from "@shared/types";
import { isNewSinceCheck, withoutFailed } from "@shared/modelCatalog";
import { useCanvasStore } from "@/hooks/useCanvasStore";
import { useModelChecksStore } from "@/hooks/useModelChecksStore";
import { OlderModels } from "./OlderModels";
import { ModelOption } from "./ModelOption";
import { ProviderLogo } from "./ProviderLogo";

type Props = { nodeId: NodeId; close: () => void };

/** Fields a provider switch must not carry over: effort levels and tiers differ per provider. */
const RESET: Partial<NodeSettings> = { reasoningEffort: undefined, serviceTier: undefined };

/**
 * The Codex, Cursor, Kimi and Local sections of the node model picker. Picking a model sets the node's
 * provider and model together. A section is hidden when its CLI has nothing to offer (not
 * installed, or no models in its config). Mounted with the picker, so lists are read on open.
 */
export function OtherProviderModels({ nodeId, close }: Props) {
  const provider = useCanvasStore((s) => s.getEffectiveProvider(nodeId));
  const own = useCanvasStore((s) => s.nodes[nodeId]?.data.nodeSettings);
  const settingsModels = useCanvasStore((s) => s.providerConfigs);
  const setNodeSettings = useCanvasStore((s) => s.setNodeSettings);

  // A model on the node belongs to the provider the node chose; anything else is a leftover.
  const nodeModel = (p: Provider): string | undefined => (own?.provider === p ? own.model : undefined);
  const pick = (patch: Partial<NodeSettings>): void => {
    setNodeSettings(nodeId, patch);
    close();
  };

  return (
    <>
      <CodexSection
        activeModel={provider === "codex" ? (nodeModel("codex") ?? settingsModels?.codex?.model) : undefined}
        onSelect={(model) =>
          pick({
            provider: "codex",
            model: model.id,
            // Staying on Codex keeps the effort and tier when the new model still offers them.
            ...(provider === "codex" && own?.reasoningEffort && model.supportedReasoningEfforts.includes(own.reasoningEffort)
              ? {}
              : { reasoningEffort: undefined }),
            ...(provider === "codex" ? {} : { serviceTier: undefined }),
          })
        }
      />
      <CursorSection
        active={provider === "cursor"}
        onSelect={() => pick({ provider: "cursor", model: undefined, ...RESET })}
      />
      <KimiSection
        activeModel={provider === "kimi" ? nodeModel("kimi") : undefined}
        onSelect={(model) => pick({ provider: "kimi", model, ...RESET })}
      />
      <LocalSection
        activeModel={provider === "local" ? nodeModel("local") : undefined}
        onSelect={(model) => pick({ provider: "local", model, ...RESET })}
      />
    </>
  );
}

function Section({ provider, title, children }: { provider: Provider; title: string; children: ReactNode }) {
  return (
    <>
      <div
        className="mt-1 flex items-center gap-1.5 border-t border-border px-2.5 pt-2 pb-1 text-[8px] uppercase tracking-[0.14em] text-muted-foreground"
        style={{ fontFamily: "var(--font-geist-mono)" }}
      >
        <ProviderLogo provider={provider} size={9} />
        {title}
      </div>
      {children}
    </>
  );
}

function CodexSection({
  activeModel,
  onSelect,
}: {
  activeModel: string | undefined;
  onSelect: (model: CodexModelInfo) => void;
}) {
  const [runtime, setRuntime] = useState<{ models: CodexModelInfo[]; defaultModelId?: string } | null>(null);
  useEffect(() => {
    void window.api.providers
      .codexRuntime()
      .then(setRuntime)
      .catch(() => setRuntime(null));
  }, []);
  const checks = useModelChecksStore((s) => s.checks);
  if (!runtime) return null;
  const models = withoutFailed(runtime.models, "codex", checks, (m) => m.id);
  if (models.length === 0) return null;
  const active = activeModel ?? runtime.defaultModelId;
  return (
    <Section provider="codex" title="Codex">
      {models.map((model) => (
        <ModelOption
          key={model.id}
          provider="codex"
          active={active === model.id}
          title={model.displayName}
          subtitle={`${model.description}${isNewSinceCheck(checks, "codex", model.id) ? " · not checked" : ""}`}
          onSelect={() => onSelect(model)}
        />
      ))}
    </Section>
  );
}

function CursorSection({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    void window.api.providers
      .authStatus("cursor")
      .then((s) => setInstalled(s.installed))
      .catch(() => setInstalled(false));
  }, []);
  if (!installed) return null;
  // shortcut: Cursor's CLI can't be asked for its models here, so only its own "Auto" choice is
  // offered; a specific model can still be set in Settings. Upgrade when the CLI lists models.
  return (
    <Section provider="cursor" title="Cursor">
      <ModelOption provider="cursor" active={active} title="Auto" subtitle="Cursor picks the model" onSelect={onSelect} />
    </Section>
  );
}

function KimiSection({
  activeModel,
  onSelect,
}: {
  activeModel: string | undefined;
  onSelect: (model: string) => void;
}) {
  const [models, setModels] = useState<KimiModelInfo[]>([]);
  useEffect(() => {
    void window.api.providers
      .kimiModels()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);
  const checks = useModelChecksStore((s) => s.checks);
  if (models.length === 0) return null;
  const latest = withoutFailed(
    models.filter((m) => m.latest),
    "kimi",
    checks,
    (m) => m.id,
  );
  const older = models.filter((m) => !m.latest);
  const row = (model: KimiModelInfo) => (
    <ModelOption
      key={model.id}
      provider="kimi"
      active={activeModel === model.id}
      title={model.displayName}
      subtitle={`${model.contextSize ? `${Math.round(model.contextSize / 1024)}K context · ` : ""}${model.id}${
        isNewSinceCheck(checks, "kimi", model.id) ? " · not checked" : ""
      }`}
      onSelect={() => onSelect(model.id)}
    />
  );
  return (
    <Section provider="kimi" title="Kimi">
      {latest.map(row)}
      <OlderModels count={older.length} defaultOpen={older.some((m) => m.id === activeModel)}>
        {older.map(row)}
      </OlderModels>
    </Section>
  );
}

/** Models served by LM Studio or Ollama right now; hidden when neither has one. */
function LocalSection({
  activeModel,
  onSelect,
}: {
  activeModel: string | undefined;
  onSelect: (model: string) => void;
}) {
  const [models, setModels] = useState<LocalModelInfo[]>([]);
  useEffect(() => {
    void window.api.providers
      .localModels()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);
  if (models.length === 0) return null;
  return (
    <Section provider="local" title="Local">
      {models.map((model) => (
        <ModelOption
          key={model.id}
          provider="local"
          active={activeModel === model.id}
          title={model.displayName}
          subtitle={`${model.server === "lmstudio" ? "LM Studio" : "Ollama"}${
            model.contextSize ? ` · ${Math.round(model.contextSize / 1024)}K context` : ""
          }`}
          onSelect={() => onSelect(model.id)}
        />
      ))}
    </Section>
  );
}
