import { expect, test } from "@playwright/test";
import {
  extensionToLanguage,
  highlightLines,
  type HighlightLine,
} from "../../src/ui/syntax-highlight";

/** Class path to the first text leaf containing `text`, outermost first. */
function classesOf(
  line: HighlightLine,
  text: string,
  open: readonly string[] = [],
): string[] | undefined {
  for (const child of line) {
    if (typeof child === "string") {
      if (child.includes(text)) return [...open];
      continue;
    }
    const found = classesOf(child.children, text, [...open, child.className ?? ""]);
    if (found) return found;
  }
  return undefined;
}

function flatten(line: HighlightLine): string {
  return line
    .map((child) => (typeof child === "string" ? child : flatten(child.children)))
    .join("");
}

test("commonly used source and config files resolve to a grammar", () => {
  const expected: Record<string, string> = {
    "cmd/server/main.go": "go",
    "src/main/java/App.java": "java",
    "src/index.ts": "typescript",
    "src/App.tsx": "typescript",
    "scripts/build.mjs": "javascript",
    "web/app.js": "javascript",
    "crates/core/src/lib.rs": "rust",
    "tools/report.py": "python",
    ".github/workflows/ci.yml": "yaml",
    "deploy/values.yaml": "yaml",
    "package.json": "json",
    "infra/main.tf": "hcl",
    "infra/prod.tfvars": "hcl",
    Dockerfile: "dockerfile",
    "services/api/Dockerfile.dev": "dockerfile",
    Makefile: "makefile",
    "Cargo.toml": "ini",
    "README.md": "markdown",
    "native/module.cpp": "cpp",
    "styles/app.scss": "scss",
    "db/schema.sql": "sql",
    "scripts/setup.sh": "bash",
    "app/build.gradle": "gradle",
    "src/Main.kt": "kotlin",
  };
  for (const [path, language] of Object.entries(expected)) {
    expect(extensionToLanguage(path), path).toBe(language);
  }
  expect(extensionToLanguage("LICENSE")).toBeUndefined();
});

test("whole-file highlighting keeps multi-line tokens coloured on every line", () => {
  const source = [
    "package main",
    "",
    "/* first line of a block comment",
    "   second line of a block comment */",
    "func main() {",
    "\tquery := `SELECT *",
    "FROM users`",
    "}",
  ].join("\n");
  const lines = highlightLines(source, "go");

  expect(lines).toHaveLength(source.split("\n").length);
  expect(lines.map(flatten)).toEqual(source.split("\n"));
  expect(classesOf(lines[0]!, "package")).toEqual(["hljs-keyword"]);
  expect(classesOf(lines[3]!, "second line")).toEqual(["hljs-comment"]);
  expect(classesOf(lines[6]!, "FROM users")).toEqual(["hljs-string"]);
});

test("terraform blocks, attributes, interpolation and heredocs are highlighted", () => {
  const source = [
    'resource "aws_instance" "web" {',
    "  ami           = var.ami_id # pinned",
    '  instance_type = "t3.${var.size}"',
    "  user_data     = <<-EOT",
    "    echo ready",
    "  EOT",
    "}",
  ].join("\n");
  const lines = highlightLines(source, "hcl");

  expect(lines.map(flatten)).toEqual(source.split("\n"));
  expect(classesOf(lines[0]!, "resource")).toEqual(["hljs-keyword"]);
  expect(classesOf(lines[0]!, '"aws_instance"')).toEqual(["hljs-string"]);
  expect(classesOf(lines[1]!, "ami")).toEqual(["hljs-attr"]);
  expect(classesOf(lines[1]!, "# pinned")).toEqual(["hljs-comment"]);
  expect(classesOf(lines[2]!, "${var.size}")).toEqual(["hljs-string", "hljs-subst"]);
  expect(classesOf(lines[4]!, "echo ready")).toEqual(["hljs-string"]);
});

test("yaml keys and json strings are highlighted", () => {
  const yaml = highlightLines("jobs:\n  build:\n    runs-on: ubuntu-latest\n", "yaml");
  expect(classesOf(yaml[2]!, "runs-on")).toEqual(["hljs-attr"]);
  const json = highlightLines('{\n  "name": "pi-gui"\n}', "json");
  expect(classesOf(json[1]!, '"name"')).toEqual(["hljs-attr"]);
  expect(classesOf(json[1]!, '"pi-gui"')).toEqual(["hljs-string"]);
});
