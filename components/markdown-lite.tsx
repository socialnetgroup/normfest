const BOLD = /\*\*([^*]+)\*\*/g;
const HEADING = /^(#{1,3})\s+(.*)/;
const LIST_ITEM = /^[-•]\s+|^\d+[.)]\s+/;
const HR = /^-{3,}$/;

/** Renders **bold** spans within a line of text - the only inline markdown
 * construct real model output (chat/coaching reports/generated descriptions)
 * reliably produces. Everything else passes through as plain text. */
function renderInline(text: string) {
  const parts = text.split(BOLD);
  return parts.map((part, i) =>
    // split() on a capturing group alternates [plain, captured, plain, captured, ...] -
    // odd indices are always the bolded group content.
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}

/** Minimal markdown renderer for raw LLM output (chat replies, AI coaching
 * reports, AI-generated product descriptions) - real paragraphs, **bold**,
 * bullet lines, and light heading/rule support, instead of showing literal
 * asterisks in a whitespace-pre-line blob. Not a full markdown parser -
 * covers exactly what this app's own prompts produce. */
export function MarkdownLite({ content, className }: { content: string; className?: string }) {
  const lines = content.split("\n").map((l) => l.trim());
  return (
    <div className={className ?? "flex flex-col gap-2"}>
      {lines.map((line, i) => {
        if (!line) return null;
        if (HR.test(line)) return <hr key={i} className="my-1 border-t" />;
        const heading = line.match(HEADING);
        if (heading) {
          const level = heading[1].length;
          return (
            <p key={i} className={level === 1 ? "font-heading text-base font-bold" : "font-semibold"}>
              {renderInline(heading[2])}
            </p>
          );
        }
        if (LIST_ITEM.test(line)) {
          return (
            <p key={i} className="pl-4 leading-relaxed before:mr-2 before:-ml-4 before:text-primary before:content-['•']">
              {renderInline(line.replace(LIST_ITEM, ""))}
            </p>
          );
        }
        return (
          <p key={i} className="leading-relaxed">
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}
