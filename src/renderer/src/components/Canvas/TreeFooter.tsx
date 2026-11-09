import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import type { NodeId } from "@shared/types";
import { useCanvasStore, useCanvasStoreApi } from "@/hooks/useCanvasStore";
import { useTreeStore, writePage } from "@/hooks/useTreeStore";
import { goDeeper, writeAll } from "@/lib/buildTree";
import { plannedDescendants } from "@/lib/treeNodes";

type Props = {
  nodeId: NodeId;
  /** Re-sends this node's prompt as a tree (after the outline failed). */
  onRetry: () => void;
};

// A click must not also select the node: sending a page and selecting its node in one click made
// React Flow and the canvas re-render without end. The other node buttons stop it the same way.
const stop = (e: React.SyntheticEvent): void => e.stopPropagation();

const BUTTON =
  "nodrag rounded-sm border border-border bg-card px-2 py-1 text-[10px] font-medium text-foreground cursor-pointer transition-colors hover:bg-muted";

/** Under a node: why a tree failed, Write all for the pages below it, Write for a planned page, Go deeper. */
export function TreeFooter({ nodeId, onRetry }: Props) {
  const api = useCanvasStoreApi();
  const error = useTreeStore((s) => s.errors[nodeId]);
  const writing = useTreeStore((s) => s.writingAll[nodeId] === true);
  const setWritingAll = useTreeStore((s) => s.setWritingAll);
  const planned = useCanvasStore((s) => s.nodes[nodeId]?.data.planned);
  const canGoDeeper = useCanvasStore((s) => {
    const n = s.nodes[nodeId];
    const reply = n?.data.chat.messages.find((m) => m.role === "assistant");
    return n?.data.treePage === true && !n.data.planned && reply?.status === "complete";
  });
  const unwritten = useCanvasStore(useShallow((s) => plannedDescendants(s.nodes, nodeId))).length;
  const writeOne = useCallback(() => void writePage(nodeId), [nodeId]);

  if (!error && !planned && !canGoDeeper && unwritten === 0 && !writing) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
      {error && (
        <>
          <span className="text-[11px] text-destructive">Couldn't build the tree: {error}</span>
          <button type="button" className={BUTTON} onMouseDown={stop} onClick={(e) => { stop(e); onRetry(); }}>
            Retry as a tree
          </button>
        </>
      )}
      {planned && (
        <button type="button" className={BUTTON} onMouseDown={stop} onClick={(e) => { stop(e); writeOne(); }} title="Write this page (Enter sends your edited question)">
          Write
        </button>
      )}
      {canGoDeeper && (
        <button type="button" className={BUTTON} onMouseDown={stop} onClick={(e) => { stop(e); goDeeper(api, nodeId); }} title="Plan sub-topics under this page">
          Go deeper
        </button>
      )}
      {(unwritten > 0 || writing) &&
        (writing ? (
          <button type="button" className={BUTTON} onMouseDown={stop} onClick={(e) => { stop(e); setWritingAll(nodeId, false); }}>
            Stop writing ({unwritten} left)
          </button>
        ) : (
          <button type="button" className={BUTTON} onMouseDown={stop} onClick={(e) => { stop(e); writeAll(api, nodeId); }}>
            Write all ({unwritten})
          </button>
        ))}
    </div>
  );
}
