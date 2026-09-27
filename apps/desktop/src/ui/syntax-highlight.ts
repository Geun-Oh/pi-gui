import { LRUCache } from "lru-cache";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cmake from "highlight.js/lib/languages/cmake";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import go from "highlight.js/lib/languages/go";
import gradle from "highlight.js/lib/languages/gradle";
import groovy from "highlight.js/lib/languages/groovy";
import haskell from "highlight.js/lib/languages/haskell";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

type LanguageDefinition = Parameters<typeof hljs.registerLanguage>[1];

/**
 * Terraform / HCL. highlight.js 10 ships no grammar for it, so this covers the
 * syntax people read in a file viewer: blocks, attributes, interpolation,
 * heredocs, function calls and the three comment styles.
 */
const hcl: LanguageDefinition = () => {
  const interpolation = {
    className: "subst",
    begin: /[$%]\{/,
    end: /\}/,
    keywords: { literal: "true false null", keyword: "for in if else endif endfor" },
  };
  return {
    name: "HCL",
    aliases: ["terraform"],
    keywords: {
      keyword:
        "resource data variable output module provider terraform locals backend " +
        "required_providers dynamic content lifecycle provisioner connection moved import " +
        "check removed for in if",
      literal: "true false null",
      type: "string number bool list map set object tuple any",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      // A heredoc ends at a line holding only its own tag.
      hljs.END_SAME_AS_BEGIN({
        className: "string",
        begin: /<<-?\s*([A-Za-z_]\w*)\s*$/,
        end: /^\s*([A-Za-z_]\w*)\s*$/,
        contains: [interpolation],
      }),
      {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE, interpolation],
      },
      { className: "attr", begin: /\b[A-Za-z_][\w-]*(?=\s*=(?!=))/ },
      { className: "built_in", begin: /\b[a-z_][\w]*(?=\()/ },
      hljs.C_NUMBER_MODE,
    ],
  };
};

const LANGUAGES: Readonly<Record<string, LanguageDefinition>> = {
  bash,
  c,
  cmake,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  elixir,
  go,
  gradle,
  groovy,
  haskell,
  hcl,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  nginx,
  objectivec,
  perl,
  php,
  powershell,
  properties,
  protobuf,
  python,
  r,
  ruby,
  rust,
  scala,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const [name, definition] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, definition);
}

/** Diff hunks are highlighted per line, so their row cap stays small. */
export const MAX_HIGHLIGHTED_LINES = 500;
/** A whole file is highlighted in one pass; the file preview itself is capped at 200 KB. */
export const MAX_HIGHLIGHTED_FILE_LINES = 10_000;

interface HighlightToken {
  readonly className?: string;
  readonly children: HighlightLine;
}

export type HighlightTokenChild = string | HighlightToken;

export type HighlightLine = readonly HighlightTokenChild[];

const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  json5: "json",
  jsonl: "json",
  webmanifest: "json",
  py: "python",
  pyi: "python",
  pyw: "python",
  bzl: "python",
  star: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ksh: "bash",
  env: "bash",
  go: "go",
  java: "java",
  rs: "rust",
  yaml: "yaml",
  yml: "yaml",
  tf: "hcl",
  tfvars: "hcl",
  hcl: "hcl",
  nomad: "hcl",
  xml: "xml",
  html: "xml",
  htm: "xml",
  xhtml: "xml",
  svg: "xml",
  plist: "xml",
  xsd: "xml",
  xsl: "xml",
  csproj: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  ino: "cpp",
  cs: "csharp",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  rb: "ruby",
  rake: "ruby",
  gemspec: "ruby",
  php: "php",
  sql: "sql",
  lua: "lua",
  scala: "scala",
  sc: "scala",
  sbt: "scala",
  groovy: "groovy",
  gradle: "gradle",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  proto: "protobuf",
  diff: "diff",
  patch: "diff",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  r: "r",
  pl: "perl",
  pm: "perl",
  properties: "properties",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  toml: "ini",
  cmake: "cmake",
  m: "objectivec",
  mm: "objectivec",
  mk: "makefile",
  mak: "makefile",
  dockerfile: "dockerfile",
};

/** Files recognised by name rather than extension. */
const FILENAME_TO_LANGUAGE: Readonly<Record<string, string>> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  "cmakelists.txt": "cmake",
  jenkinsfile: "groovy",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  vagrantfile: "ruby",
  brewfile: "ruby",
  "build.bazel": "python",
  ".bashrc": "bash",
  ".bash_profile": "bash",
  ".zshrc": "bash",
  ".zprofile": "bash",
  ".profile": "bash",
  ".envrc": "bash",
  ".env": "bash",
  ".gitconfig": "ini",
  ".editorconfig": "ini",
  ".npmrc": "ini",
};

export function extensionToLanguage(filePath: string): string | undefined {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1).toLowerCase();
  const byName =
    FILENAME_TO_LANGUAGE[name] ??
    (name.startsWith("dockerfile.") ? "dockerfile" : undefined) ??
    (name.startsWith(".env.") ? "bash" : undefined);
  if (byName) return byName;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex < 0) return undefined;
  return EXTENSION_TO_LANGUAGE[name.slice(dotIndex + 1)];
}

const lineCache = new LRUCache<string, HighlightLine>({ max: 5000 });

export function highlightLine(line: string, language: string): HighlightLine {
  const cacheKey = `${language}\0${line}`;
  const cached = lineCache.get(cacheKey);
  if (cached) return cached;
  const html = hljs.highlight(line, { language, ignoreIllegals: true }).value;
  const tokens = parseHljsHtml(html);
  lineCache.set(cacheKey, tokens);
  return tokens;
}

/**
 * Highlight a whole file in one pass, then split it into lines. Unlike
 * {@link highlightLine}, block comments, multi-line strings, heredocs and YAML
 * block scalars keep their colour on every line they span. Returns exactly one
 * entry per `\n`-separated line of `content`.
 */
export function highlightLines(content: string, language: string): readonly HighlightLine[] {
  const html = hljs.highlight(content, { language, ignoreIllegals: true }).value;
  return splitTokenLines(parseHljsHtml(html));
}

interface MutableToken {
  readonly className?: string;
  readonly children: (string | MutableToken)[];
}

/** Close the open tokens at each newline and reopen them on the next line. */
function splitTokenLines(tokens: HighlightLine): readonly HighlightLine[] {
  let line: (string | MutableToken)[] = [];
  const lines = [line];
  let open: MutableToken[] = [];
  const container = () => open.at(-1)?.children ?? line;
  const startLine = () => {
    line = [];
    lines.push(line);
    open = open.map((token) => ({ className: token.className, children: [] }));
    let parent = line;
    for (const token of open) {
      parent.push(token);
      parent = token.children;
    }
  };
  const visit = (children: HighlightLine) => {
    for (const child of children) {
      if (typeof child === "string") {
        child.split("\n").forEach((part, index) => {
          if (index > 0) startLine();
          if (part) container().push(part);
        });
        continue;
      }
      const token: MutableToken = { className: child.className, children: [] };
      container().push(token);
      open.push(token);
      visit(child.children);
      open.pop();
    }
  };
  visit(tokens);
  return lines.map(pruneEmptyTokens);
}

function pruneEmptyTokens(children: readonly (string | MutableToken)[]): HighlightLine {
  return children.flatMap((child): HighlightTokenChild[] => {
    if (typeof child === "string") return [child];
    const nested = pruneEmptyTokens(child.children);
    return nested.length > 0 ? [{ className: child.className, children: nested }] : [];
  });
}

function parseHljsHtml(html: string): HighlightLine {
  const parser = new HljsHtmlParser(html);
  return parser.parseChildren(null);
}

class HljsHtmlParser {
  private pos = 0;
  constructor(private readonly source: string) {}

  parseChildren(closingTag: string | null): readonly HighlightTokenChild[] {
    const out: HighlightTokenChild[] = [];
    let textStart = this.pos;

    const flushText = (end: number): void => {
      if (end > textStart) {
        out.push(decodeEntities(this.source.slice(textStart, end)));
      }
    };

    while (this.pos < this.source.length) {
      const ch = this.source.charCodeAt(this.pos);
      if (ch !== 0x3c) {
        this.pos += 1;
        continue;
      }
      if (closingTag !== null && this.matchClosingTag(closingTag)) {
        flushText(this.pos);
        this.pos += closingTag.length + 3;
        return out;
      }
      const open = this.tryConsumeOpenSpan();
      if (open !== null) {
        flushText(open.tagStart);
        const children = this.parseChildren("span");
        out.push({ className: open.className, children });
        textStart = this.pos;
        continue;
      }
      this.pos += 1;
    }
    flushText(this.pos);
    return out;
  }

  private matchClosingTag(tag: string): boolean {
    const expected = `</${tag}>`;
    return this.source.startsWith(expected, this.pos);
  }

  private tryConsumeOpenSpan(): { className?: string; tagStart: number } | null {
    const tagStart = this.pos;
    if (!this.source.startsWith("<span", this.pos)) return null;
    const closeIdx = this.source.indexOf(">", this.pos);
    if (closeIdx < 0) return null;
    const inner = this.source.slice(this.pos + 5, closeIdx);
    const classMatch = /\sclass="([^"]*)"/.exec(inner);
    this.pos = closeIdx + 1;
    return { className: classMatch?.[1], tagStart };
  }
}

function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  // &amp; must be replaced last so &amp;lt; etc. survive intact.
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
