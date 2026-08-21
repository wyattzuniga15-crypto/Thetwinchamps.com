"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

/**
 * Markdown with GFM tables/lists, LaTeX math (KaTeX), and syntax-highlighted
 * code blocks. Memoized — re-rendering large chat histories is the main
 * client-side cost.
 */
function preprocessMath(text: string): string {
  // Normalize \( \) / \[ \] LaTeX delimiters to $ / $$ which remark-math understands.
  return text
    .replace(/\\\[((?:[^\\]|\\[^\]])*?)\\\]/g, (_m, expr) => `$$${expr}$$`)
    .replace(/\\\(((?:[^\\]|\\[^)])*?)\\\)/g, (_m, expr) => `$${expr}$`);
}

const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-tutor">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }], rehypeHighlight]}
      >
        {preprocessMath(text)}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;
