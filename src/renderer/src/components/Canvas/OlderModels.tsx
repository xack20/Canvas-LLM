import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";

type Props = { count: number; defaultOpen?: boolean; label?: string; children: ReactNode };

/** Older models, tucked away: they were not checked and are rarely what you want. */
export function OlderModels({ count, defaultOpen = false, label = "Older models", children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2.5 py-1 text-left text-[9px] text-muted-foreground hover:text-foreground cursor-pointer"
      >
        <ChevronRight className={clsx("h-2.5 w-2.5 transition-transform", open && "rotate-90")} />
        {label} ({count})
      </button>
      {open && children}
    </>
  );
}
