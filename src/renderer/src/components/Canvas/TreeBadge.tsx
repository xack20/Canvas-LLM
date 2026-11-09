import clsx from "clsx";
import { ListTree } from "lucide-react";
import type { NodeId } from "@shared/types";
import { useCompareStore } from "@/hooks/useCompareStore";
import { useTreeStore } from "@/hooks/useTreeStore";

type Props = { nodeId: NodeId };

/**
 * Tree mode for the next send: the reply is an overview, and the pages it lists appear as
 * placeholders to write one by one or all at once. It replaces Compare for that send.
 */
export function TreeBadge({ nodeId }: Props) {
  const on = useTreeStore((s) => s.armed[nodeId] === true);
  const setArmed = useTreeStore((s) => s.setArmed);
  const setTicks = useCompareStore((s) => s.set);

  return (
    <div className="nodrag relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!on) setTicks(nodeId, []);
          setArmed(nodeId, !on);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          "flex items-center gap-1 rounded-sm border bg-card text-foreground px-1.5 py-[5px] text-xs font-medium cursor-pointer transition-colors",
          "hover:bg-muted",
          on
            ? "border-accent-brand/60 bg-accent-brand/15 ring-1 ring-accent-brand/30 hover:bg-accent-brand/25"
            : "border-border",
        )}
        style={{ fontFamily: "var(--font-geist-pixel-square)" }}
        title={
          on
            ? "Tree ON for this send: an overview, then a tree of pages to write · click to turn off"
            : "Tree: answer with an overview and a tree of pages you write on demand"
        }
        aria-pressed={on}
      >
        <ListTree className={clsx("h-[10px] w-[10px]", on ? "text-accent-brand" : "text-muted-foreground")} />
        <span className="tracking-tight text-[8px] uppercase">tree</span>
      </button>
    </div>
  );
}
