import { ScrollText } from "lucide-react";

/** Longest system prompt the box accepts: far more than instructions need, short of a pasted book. */
export const SYSTEM_PROMPT_MAX = 20000;

type Props = { value: string; onChange: (value: string) => void };

/** Standing instructions sent with every chat, for every provider. Saved with the rest of Settings. */
export function SystemPromptSetting({ value, onChange }: Props) {
  return (
    <div className="w-full px-3 py-3 rounded-xl border bg-card border-border">
      <label htmlFor="system-prompt" className="flex items-center gap-3 text-sm font-medium text-foreground">
        <ScrollText className="w-4 h-4" />
        System prompt
      </label>
      <p className="mt-0.5 mb-2 text-xs text-muted-foreground">
        Standing instructions added to every new conversation, for every provider. LMCanvas adds its own after
        yours. A conversation that is already running may keep the prompt it started with.
      </p>
      <textarea
        id="system-prompt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={SYSTEM_PROMPT_MAX}
        rows={4}
        spellCheck={false}
        placeholder="e.g. Answer in plain English and keep replies short."
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      />
    </div>
  );
}
