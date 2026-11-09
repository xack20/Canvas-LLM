import { create } from "zustand";
import type { NodeId } from "@shared/types";

type TreeState = {
  /** Nodes whose next send plans a tree. Transient, like the compare ticks: a tree is always deliberate. */
  armed: Record<NodeId, true>;
  /** Why a node's tree couldn't be built, until the user retries or edits the prompt. */
  errors: Record<NodeId, string>;
  /** Roots (or branches) whose "Write all" queue is running. */
  writingAll: Record<NodeId, true>;
  setArmed: (nodeId: NodeId, on: boolean) => void;
  /** Returns whether the node was armed and clears it. */
  take: (nodeId: NodeId) => boolean;
  setError: (nodeId: NodeId, message?: string) => void;
  setWritingAll: (nodeId: NodeId, on: boolean) => void;
};

const without = <T,>(rec: Record<NodeId, T>, key: NodeId): Record<NodeId, T> => {
  const { [key]: _gone, ...rest } = rec;
  return rest;
};

/**
 * How to send each mounted placeholder's question: its own `submit`, called from the click or the
 * queue like a typed prompt. (A prefill consumed by the prompt box inside an effect made React Flow
 * and the canvas re-render without end when the node was already on screen.)
 */
const pageWriters = new Map<NodeId, () => void>();

export function registerPageWriter(nodeId: NodeId, write: () => void): () => void {
  pageWriters.set(nodeId, write);
  return () => {
    if (pageWriters.get(nodeId) === write) pageWriters.delete(nodeId);
  };
}

/** Sends the page's question; false when the node isn't on screen (or isn't a placeholder). */
export function writePage(nodeId: NodeId): boolean {
  const write = pageWriters.get(nodeId);
  if (!write) return false;
  write();
  return true;
}

export const useTreeStore = create<TreeState>((set, get) => ({
  armed: {},
  errors: {},
  writingAll: {},
  setArmed: (nodeId, on) => set((s) => ({ armed: on ? { ...s.armed, [nodeId]: true } : without(s.armed, nodeId) })),
  take: (nodeId) => {
    const was = get().armed[nodeId] === true;
    if (was) get().setArmed(nodeId, false);
    return was;
  },
  setError: (nodeId, message) =>
    set((s) => ({ errors: message ? { ...s.errors, [nodeId]: message } : without(s.errors, nodeId) })),
  setWritingAll: (nodeId, on) =>
    set((s) => ({ writingAll: on ? { ...s.writingAll, [nodeId]: true } : without(s.writingAll, nodeId) })),
}));
