"use client";

import * as React from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CodeSnippet } from "@/lib/code-snippets";

SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);

/**
 * Tabbed code viewer. Renders the curated engine snippets with Prism
 * (one-dark theme) and a copy button.
 */
export function CodeViewer({
  snippets,
  defaultId,
}: {
  snippets: CodeSnippet[];
  defaultId?: string;
}) {
  const initial = defaultId ?? snippets[0]?.id ?? "";
  return (
    <Tabs defaultValue={initial} className="w-full">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-neutral-950/60 p-1">
        {snippets.map((s) => (
          <TabsTrigger
            key={s.id}
            value={s.id}
            className="font-mono text-xs data-[state=active]:bg-neutral-800 data-[state=active]:text-rose-200"
          >
            {s.filename}
          </TabsTrigger>
        ))}
      </TabsList>
      {snippets.map((s) => (
        <TabsContent key={s.id} value={s.id}>
          <CodeBlock snippet={s} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function CodeBlock({ snippet }: { snippet: CodeSnippet }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard not available
    }
  };
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/80">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-4 py-2">
        <p className="text-xs text-neutral-400">{snippet.description}</p>
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${snippet.filename}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100",
          )}
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-400" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="max-h-[34rem] overflow-auto [scrollbar-width:thin]">
        <SyntaxHighlighter
          language={snippet.language}
          style={oneDark}
          customStyle={{
            margin: 0,
            background: "transparent",
            padding: "1rem",
            fontSize: "12.5px",
            lineHeight: "1.55",
          }}
          codeTagProps={{
            style: {
              fontFamily:
                "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
            },
          }}
          showLineNumbers
          lineNumberStyle={{
            color: "#525252",
            minWidth: "2.5em",
            paddingRight: "1em",
            userSelect: "none",
          }}
        >
          {snippet.code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
