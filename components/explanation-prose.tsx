import type { ReactNode } from "react";
import type { MapSelection } from "@/lib/map/scene";

/** Deliberately supports only the prompt's inline code, bold and bullet subset. */
export function ExplanationProse({ content, paths, onSelect }: {
  content: string; paths: MapSelection[]; onSelect: (selection: MapSelection) => void;
}) {
  const ordered = [...paths].sort((a, b) => b.path.length - a.path.length);
  function linkPaths(value: string, prefix: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    let cursor = 0;
    while (cursor < value.length) {
      const next = ordered.map((selection) => {
        let index = value.indexOf(selection.path, cursor);
        while (index >= 0) {
          const end = index + selection.path.length;
          const before = index === 0 || !/[\w./-]/.test(value[index - 1]);
          const after = !/[\w/-]/.test(value[end] ?? "") && !(value[end] === "." && /[\w/]/.test(value[end + 1] ?? ""));
          if (before && after) break;
          index = value.indexOf(selection.path, index + 1);
        }
        return { selection, index };
      }).filter(({ index }) => index >= 0)
        .sort((a, b) => a.index - b.index || b.selection.path.length - a.selection.path.length)[0];
      if (!next) { nodes.push(value.slice(cursor)); break; }
      nodes.push(value.slice(cursor, next.index));
      nodes.push(<button key={`${prefix}:${next.index}`} type="button" className="explanation-path"
        data-map-file={next.selection.type === "file" ? next.selection.path : undefined}
        onClick={() => onSelect(next.selection)}>{next.selection.path}</button>);
      cursor = next.index + next.selection.path.length;
    }
    return nodes;
  }
  function inline(value: string, prefix: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
      const id = `${prefix}:${match.index}`;
      nodes.push(...linkPaths(value.slice(cursor, match.index).replace(/[`*#]/g, ""), id));
      nodes.push(match[1] !== undefined ? <code key={id}>{linkPaths(match[1], id)}</code>
        : <strong key={id}>{inline(match[2], `${id}:bold`)}</strong>);
      cursor = match.index + match[0].length;
    }
    nodes.push(...linkPaths(value.slice(cursor).replace(/[`*#]/g, ""), `${prefix}:end`));
    return nodes;
  }
  const blocks: { bullet: boolean; lines: string[] }[] = [];
  // Unsupported Markdown is reduced to prose. No raw HTML or external links are rendered.
  for (const raw of content.replace(/\r/g, "").replace(/```[^\n]*\n?/g, "").split("\n")) {
    const line = raw.replace(/^\s*#{1,6}\s*/, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
    if (!line) { blocks.push({ bullet: false, lines: [] }); continue; }
    const bullet = /^[-*+]\s+/.test(line);
    const text = bullet ? line.replace(/^[-*+]\s+/, "") : line;
    const last = blocks.at(-1);
    if (last?.lines.length && last.bullet === bullet) last.lines.push(text);
    else blocks.push({ bullet, lines: [text] });
  }
  return <div className="explanation-prose">{blocks.filter((block) => block.lines.length).map((block, index) => block.bullet
    ? <ul key={index}>{block.lines.map((line, row) => <li key={row}>{inline(line, `${index}:${row}`)}</li>)}</ul>
    : <p key={index}>{inline(block.lines.join(" "), String(index))}</p>)}</div>;
}
