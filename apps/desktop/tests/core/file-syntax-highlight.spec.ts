import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  selectSidePanel,
} from "../helpers/electron-app";

const FILES: Record<string, { readonly content: string; readonly keyword: string }> = {
  "main.go": {
    content: 'package main\n\n/* started\n   finished */\nfunc main() {\n\tprintln("hi")\n}\n',
    keyword: "func",
  },
  "main.tf": {
    content: 'resource "aws_s3_bucket" "logs" {\n  bucket = "logs-${var.env}"\n}\n',
    keyword: "resource",
  },
  "App.java": { content: "public class App {\n  int count = 0;\n}\n", keyword: "public" },
  "lib.rs": { content: "pub fn answer() -> u32 {\n    42\n}\n", keyword: "fn" },
  "ci.yaml": { content: "jobs:\n  build:\n    runs-on: ubuntu-latest\n", keyword: "" },
};

async function openFile(window: Page, path: string): Promise<void> {
  await window
    .getByTestId("file-workbench-tree")
    .locator(`.file-workbench__tree-row--file[data-file-path="${path}"]`)
    .click();
  await expect(window.getByTestId("file-editor").locator(".file-editor__tab--active")).toHaveText(
    path,
  );
}

test("Files tab colours Go, Terraform, Java, Rust, YAML and long files", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("syntax-highlight-files");
  for (const [name, file] of Object.entries(FILES)) {
    await writeFile(join(workspacePath, name), file.content, "utf8");
  }
  // Previously files over 500 lines were shown without any colour.
  const longSource = Array.from(
    { length: 1_200 },
    (_, index) => `export const value${index} = ${index};`,
  ).join("\n");
  await writeFile(join(workspacePath, "long.ts"), longSource, "utf8");

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Syntax colours");
    await selectSidePanel(window, "Files");
    const preview = window.getByTestId("file-editor").getByTestId("file-workbench-preview");

    for (const [name, file] of Object.entries(FILES)) {
      await openFile(window, name);
      await expect(preview).toContainText(file.content.split("\n")[0]!);
      if (file.keyword) {
        await expect(
          preview.locator(".hljs-keyword", { hasText: file.keyword }).first(),
        ).toBeVisible();
      }
    }

    // Colours come from the theme: a keyword must not render in the plain text colour.
    await openFile(window, "main.go");
    const colours = await preview.evaluate((element) => ({
      plain: getComputedStyle(element).color,
      keyword: getComputedStyle(element.querySelector(".hljs-keyword")!).color,
      comment: getComputedStyle(
        element.querySelector('.file-editor__line[data-line="4"] .hljs-comment')!,
      ).color,
    }));
    expect(colours.keyword).not.toBe(colours.plain);
    // The second line of a block comment is still a comment.
    expect(colours.comment).not.toBe(colours.plain);

    await openFile(window, "ci.yaml");
    await expect(preview.locator(".hljs-attr", { hasText: "runs-on" })).toBeVisible();

    await openFile(window, "long.ts");
    await expect(preview).toHaveAttribute("data-language", "typescript");
    await expect(
      preview.locator('.file-editor__line[data-line="1200"] .hljs-keyword', { hasText: "export" }),
    ).toHaveCount(1);
  } finally {
    await harness.close();
  }
});
