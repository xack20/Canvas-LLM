import { useEffect, useMemo, useState } from "react";
import type { KimiModelInfo, NodeId } from "@shared/types";
import { contextView, type ContextView } from "@shared/contextSize";
import { kimiWindowFor } from "@/lib/kimiWindow";
import { useCanvasStore } from "./useCanvasStore";

// One read of the Kimi config per renderer; a failed read is tried again next time.
let kimiModels: Promise<KimiModelInfo[]> | null = null;
function loadKimiModels(): Promise<KimiModelInfo[]> {
  kimiModels ??= window.api.providers.kimiModels().catch(() => {
    kimiModels = null;
    return [];
  });
  return kimiModels;
}

/**
 * A node's context size for the badge and bar: Claude, Codex and Kimi nodes. Cursor and local models report
 * nothing, so they get none. A Kimi node that was never measured (auto mode) is estimated
 * against its model's configured window instead of the 200k default.
 */
export function useContextView(nodeId: NodeId): ContextView | null {
  const provider = useCanvasStore((s) => s.getEffectiveProvider(nodeId));
  const nodes = useCanvasStore((s) => s.nodes);
  const ownModel = useCanvasStore((s) =>
    s.nodes[nodeId]?.data.nodeSettings?.provider === "kimi" ? s.nodes[nodeId]?.data.nodeSettings?.model : undefined,
  );
  const [kimiWindow, setKimiWindow] = useState<number | undefined>();
  useEffect(() => {
    if (provider !== "kimi") return;
    let live = true;
    void loadKimiModels().then((models) => live && setKimiWindow(kimiWindowFor(models, ownModel)));
    return () => {
      live = false;
    };
  }, [provider, ownModel]);

  return useMemo(
    () => (provider === "cursor" || provider === "local" ? null : contextView(nodeId, nodes, { defaultWindow: provider === "kimi" ? kimiWindow : undefined })),
    [provider, nodeId, nodes, kimiWindow],
  );
}
