import { Fragment, type ReactNode } from "react";
import { getFileLinkDisplayPath } from "@/lib/file-links";
import { cn } from "@/lib/utils";

type MarkdownBlock =
  | {
      type: "heading";
      level: number;
      text: string;
    }
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "list";
      ordered: boolean;
      items: string[];
    }
  | {
      type: "blockquote";
      content: string;
    }
  | {
      type: "code";
      language: string;
      code: string;
    }
  | {
      type: "hr";
    };

function normalizeMarkdown(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n").trim();
}

function isHorizontalRule(line: string) {
  return /^([-*_])(?:\s*\1){2,}\s*$/.test(line.trim());
}

function isFencedCodeStart(line: string) {
  return line.match(/^```([\w-]+)?\s*$/);
}

function isHeading(line: string) {
  return line.match(/^(#{1,6})\s+(.+)$/);
}

function isOrderedListItem(line: string) {
  return /^\d+\.\s+/.test(line);
}

function isUnorderedListItem(line: string) {
  return /^[-*+]\s+/.test(line);
}

function isBlockquoteLine(line: string) {
  return /^\s*>/.test(line);
}

function isStandaloneBlock(line: string) {
  return Boolean(
    isFencedCodeStart(line) ||
      isHeading(line) ||
      isHorizontalRule(line) ||
      isOrderedListItem(line) ||
      isUnorderedListItem(line) ||
      isBlockquoteLine(line),
  );
}

function joinParagraphLines(lines: string[]) {
  return lines
    .map((line) => line.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectListItems(
  lines: string[],
  startIndex: number,
  ordered: boolean,
) {
  const items: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const match = ordered
      ? line.match(/^\d+\.\s+(.+)$/)
      : line.match(/^[-*+]\s+(.+)$/);

    if (!match?.[1]) {
      break;
    }

    const itemLines = [match[1].trim()];
    index += 1;

    while (index < lines.length) {
      const continuationLine = lines[index] ?? "";

      if (!continuationLine.trim()) {
        index += 1;
        break;
      }

      if (
        (ordered && isOrderedListItem(continuationLine)) ||
        (!ordered && isUnorderedListItem(continuationLine)) ||
        isStandaloneBlock(continuationLine)
      ) {
        break;
      }

      itemLines.push(continuationLine.trim());
      index += 1;
    }

    items.push(joinParagraphLines(itemLines));
  }

  return {
    block: {
      type: "list",
      ordered,
      items,
    } satisfies MarkdownBlock,
    nextIndex: index,
  };
}

function parseMarkdownBlocks(markdown: string) {
  const normalizedMarkdown = normalizeMarkdown(markdown);

  if (!normalizedMarkdown) {
    return [] satisfies MarkdownBlock[];
  }

  const lines = normalizedMarkdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fencedCodeStart = isFencedCodeStart(line);

    if (fencedCodeStart) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({
        type: "code",
        language: fencedCodeStart[1]?.trim() ?? "",
        code: codeLines.join("\n"),
      });
      continue;
    }

    const heading = isHeading(line);

    if (heading?.[2]) {
      blocks.push({
        type: "heading",
        level: Math.min(heading[1]?.length ?? 1, 6),
        text: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    if (isBlockquoteLine(line)) {
      const quoteLines: string[] = [];

      while (index < lines.length) {
        const currentLine = lines[index] ?? "";

        if (!currentLine.trim()) {
          quoteLines.push("");
          index += 1;
          continue;
        }

        if (!isBlockquoteLine(currentLine)) {
          break;
        }

        quoteLines.push(currentLine.replace(/^\s*>\s?/, ""));
        index += 1;
      }

      blocks.push({
        type: "blockquote",
        content: quoteLines.join("\n").trim(),
      });
      continue;
    }

    if (isOrderedListItem(line)) {
      const { block, nextIndex } = collectListItems(lines, index, true);
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    if (isUnorderedListItem(line)) {
      const { block, nextIndex } = collectListItems(lines, index, false);
      blocks.push(block);
      index = nextIndex;
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const currentLine = lines[index] ?? "";

      if (!currentLine.trim()) {
        index += 1;
        break;
      }

      if (isStandaloneBlock(currentLine)) {
        break;
      }

      paragraphLines.push(currentLine);
      index += 1;
    }

    const paragraph = joinParagraphLines(paragraphLines);

    if (paragraph) {
      blocks.push({
        type: "paragraph",
        text: paragraph,
      });
    }
  }

  return blocks;
}

function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href);
}

function isFileHref(href: string) {
  return (
    href.startsWith("/") ||
    href.startsWith("./") ||
    href.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(href)
  );
}

function isFilePathLike(value: string) {
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /\/[^/\s]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?$/.test(value)
  );
}

function isCommandLike(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue || isFilePathLike(trimmedValue)) {
    return false;
  }

  const primaryToken = trimmedValue.split(/\s+/)[0]?.toLowerCase() ?? "";

  return (
    [
      "npm",
      "pnpm",
      "yarn",
      "bun",
      "npx",
      "git",
      "node",
      "deno",
      "python",
      "python3",
      "pip",
      "pip3",
      "uv",
      "tsx",
      "tsc",
      "next",
      "vite",
      "docker",
      "docker-compose",
      "kubectl",
      "make",
      "cargo",
      "go",
      "java",
      "javac",
      "pytest",
      "jest",
      "vitest",
      "rg",
      "grep",
      "find",
      "ls",
      "cat",
      "sed",
      "head",
      "tail",
      "pwd",
      "cd",
      "cp",
      "mv",
      "rm",
      "mkdir",
      "touch",
      "chmod",
      "curl",
      "wget",
    ].includes(primaryToken) ||
    /\s--?[\w-]+/.test(trimmedValue)
  );
}

function trimTrailingUrlPunctuation(url: string) {
  return url.replace(/[),.;!?]+$/, "");
}

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  onFileClick?: (href: string) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let tokenIndex = 0;
  const inlinePattern =
    /(\[([^\]]+)\]\(([^)\s]+)\)|`([^`\n]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*|(https?:\/\/[^\s<]+))/;

  while (remaining) {
    const match = remaining.match(inlinePattern);

    if (!match || match.index === undefined) {
      nodes.push(
        <Fragment key={`${keyPrefix}-text-${tokenIndex}`}>{remaining}</Fragment>,
      );
      break;
    }

    if (match.index > 0) {
      nodes.push(
        <Fragment key={`${keyPrefix}-text-${tokenIndex}`}>
          {remaining.slice(0, match.index)}
        </Fragment>,
      );
      tokenIndex += 1;
    }

    const [fullMatch] = match;
    const inlineKey = `${keyPrefix}-inline-${tokenIndex}`;

    if (match[2] && match[3]) {
      const label = match[2].trim();
      const href = match[3].trim();

      nodes.push(
        isExternalHref(href) ? (
          <a
            key={inlineKey}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#0f5c7a] underline decoration-[#8ab8c7] underline-offset-4 transition-colors hover:text-[#09384a]"
          >
            {label}
          </a>
        ) : isFileHref(href) ? (
          <span key={inlineKey} className="group/tooltip relative inline-flex">
            {onFileClick ? (
              <button
                type="button"
                onClick={() => {
                  onFileClick(href);
                }}
                title={getFileLinkDisplayPath(href)}
                className="font-medium text-[#2583ff] decoration-transparent underline-offset-4 transition-[color,text-decoration-color] hover:text-[#0e66d8] hover:underline hover:decoration-current cursor-pointer outline-none focus-visible:underline focus-visible:decoration-current"
              >
                {label}
              </button>
            ) : (
              <span className="font-medium text-[#2583ff] decoration-transparent underline-offset-4 transition-[color,text-decoration-color] hover:text-[#0e66d8] hover:underline hover:decoration-current">
                {label}
              </span>
            )}
            <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-max max-w-[36rem] translate-y-1 rounded-xl border border-black/8 bg-[#1f1f1c] px-3 py-2 text-[13px] leading-5 text-white opacity-0 shadow-[0_16px_40px_rgba(15,23,42,0.24)] transition-all duration-150 group-hover/tooltip:translate-y-0 group-hover/tooltip:opacity-100">
              <span className="block break-all">{getFileLinkDisplayPath(href)}</span>
            </span>
          </span>
        ) : (
          <span
            key={inlineKey}
            title={href}
            className="rounded-md bg-[#efeee8] px-1.5 py-0.5 font-mono text-[13px] text-[#474741]"
          >
            {label}
          </span>
        ),
      );
    } else if (match[4]) {
      nodes.push(
        <code
          key={inlineKey}
          className={cn(
            "font-mono text-[13px]",
            isCommandLike(match[4])
              ? "rounded-full border border-[#e7e5dc] bg-[#f4f3ee] px-2.5 py-1 text-[#2f2f2a] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
              : "rounded-md bg-[#efeee8] px-1.5 py-0.5 text-[#474741]",
          )}
        >
          {match[4]}
        </code>,
      );
    } else if (match[5]) {
      nodes.push(
        <strong key={inlineKey} className="font-semibold text-[#11110f]">
          {renderInlineMarkdown(match[5], `${inlineKey}-strong`, onFileClick)}
        </strong>,
      );
    } else if (match[6]) {
      nodes.push(
        <em key={inlineKey} className="italic text-[#454540]">
          {renderInlineMarkdown(match[6], `${inlineKey}-em`, onFileClick)}
        </em>,
      );
    } else if (match[7]) {
      const href = trimTrailingUrlPunctuation(match[7]);

      nodes.push(
        <a
          key={inlineKey}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[#0f5c7a] underline decoration-[#8ab8c7] underline-offset-4 transition-colors hover:text-[#09384a]"
        >
          {href}
        </a>,
      );
    }

    remaining = remaining.slice(match.index + fullMatch.length);
    tokenIndex += 1;
  }

  return nodes;
}

function renderMarkdownBlocks(
  blocks: MarkdownBlock[],
  keyPrefix: string,
  compact = false,
  onFileClick?: (href: string) => void,
) {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${block.type}-${index}`;

    if (block.type === "heading") {
      if (block.level === 1) {
        return (
          <h1
            key={key}
            className="font-semibold tracking-tight text-[#11110f]"
          >
            {renderInlineMarkdown(block.text, `${key}-content`, onFileClick)}
          </h1>
        );
      }

      if (block.level === 2) {
        return (
          <h2
            key={key}
            className="font-semibold tracking-tight text-[#11110f]"
          >
            {renderInlineMarkdown(block.text, `${key}-content`, onFileClick)}
          </h2>
        );
      }

      return (
        <h3
          key={key}
          className="font-semibold text-[#191916]"
        >
          {renderInlineMarkdown(block.text, `${key}-content`, onFileClick)}
        </h3>
      );
    }

    if (block.type === "paragraph") {
      return (
        <p key={key} className="break-words text-[#2a2a26]">
          {renderInlineMarkdown(block.text, `${key}-content`, onFileClick)}
        </p>
      );
    }

    if (block.type === "list") {
      const ListTag = block.ordered ? "ol" : "ul";

      return (
        <ListTag
          key={key}
          className={cn(
            "space-y-2 pl-5 text-[#2a2a26]",
            block.ordered ? "list-decimal" : "list-disc",
            "marker:text-[#8d8d86]",
          )}
        >
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-item-${itemIndex}`} className="pl-1">
              {renderInlineMarkdown(
                item,
                `${key}-item-${itemIndex}`,
                onFileClick,
              )}
            </li>
          ))}
        </ListTag>
      );
    }

    if (block.type === "blockquote") {
      return (
        <blockquote
          key={key}
          className="border-l-2 border-[#d9d6ca] pl-4 text-[#5f5f58]"
        >
          <div className={compact ? "space-y-2" : "space-y-3"}>
            {renderMarkdownBlocks(
              parseMarkdownBlocks(block.content),
              `${key}-quote`,
              true,
              onFileClick,
            )}
          </div>
        </blockquote>
      );
    }

    if (block.type === "code") {
      return (
        <div
          key={key}
          className="overflow-hidden rounded-[8px] border border-black/10 bg-[#111111] text-[#f7f7f2]"
        >
          {block.language ? (
            <div className="border-b border-white/10 px-4 py-2 text-[13px] uppercase tracking-[0.16em] text-white/55">
              {block.language}
            </div>
          ) : null}
          <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-5">
            <code>{block.code}</code>
          </pre>
        </div>
      );
    }

    return <div key={key} className="border-t border-black/8" />;
  });
}

export function MessageMarkdown({
  content,
  className,
  onFileClick,
}: {
  content: string;
  className?: string;
  onFileClick?: (href: string) => void;
}) {
  const blocks = parseMarkdownBlocks(content);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div
      data-no-translate
      className={cn("space-y-4 text-[13px] leading-5", className)}
    >
      {renderMarkdownBlocks(blocks, "markdown-root", false, onFileClick)}
    </div>
  );
}
