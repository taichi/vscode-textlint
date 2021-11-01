import * as assert from "assert";
import * as fs from "fs-extra";
import * as path from "path";

import { workspace, window, commands, Extension, extensions, Disposable } from "vscode";
import { ExtensionInternal } from "../../src/common";

import { PublishDiagnosticsNotification } from "./types";

suite("Extension Tests", () => {
  let extension: Extension<ExtensionInternal>;
  let internals: ExtensionInternal;
  setup((done) => {
    commands.executeCommand("textlint.showOutputChannel");

    function waitForActive(resolve): void {
      const ext = extensions.getExtension("taichi.vscode-textlint");
      if (typeof ext === "undefined" || ext.isActive === false) {
        setTimeout(waitForActive.bind(null, resolve), 50);
      } else {
        extension = ext;
        internals = ext.exports;
        resolve();
      }
    }
    waitForActive(done);
  });

  suite("basic behavior", () => {
    test("activate extension", () => {
      assert(extension.isActive);
      assert(internals.client);
      assert(internals.statusBar);
    });
  });

  suite("with server", function () {
    const rootPath = workspace.workspaceFolders[0].uri.fsPath;
    const original = path.join(rootPath, "testtest.txt");
    const newfile = path.join(rootPath, "testtest2.txt");
    //const timelag = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
    const disposables: Disposable[] = [];
    setup(async () => {
      await fs.copy(original, newfile);
      await internals.client.onReady();
    });
    teardown(async () => {
      const p = new Promise((resolve) => {
        fs.unlink(newfile, () => {
          resolve(0);
        });
      });
      await commands.executeCommand("workbench.action.closeAllEditors");
      await p;
      disposables.forEach((d) => d.dispose());
    });
    test("lint file", async () => {
      const waiter = new Promise((resolve) => {
        internals.client.onNotification(PublishDiagnosticsNotification.type, (p) => {
          const d = p.diagnostics;
          if (d.length === 0) {
            return; // skip empty diagnostics
          }
          if (0 < d.length) {
            resolve(0);
          } else {
            console.log(`assertion failed length:${d.length}`, d);
          }
        });
      });
      const doc = await workspace.openTextDocument(newfile);
      await window.showTextDocument(doc);
      await waiter;
    });
    test("fix file", async () => {
      const p = new Promise((resolve, reject) => {
        internals.onAllFixesComplete((ed, edits, ok) => {
          if (ok && 0 < edits.length) {
            resolve("ok");
          } else {
            let s = `length:${edits.length} `;
            s += edits.map((ed) => `newText:${ed.newText}`).join(" ");
            reject(`assertion failed ${ok} ${ed.document.getText()} edits=${s}`);
          }
        });
      });
      const doc = await workspace.openTextDocument(newfile);
      await window.showTextDocument(doc);
      await commands.executeCommand("textlint.executeAutofix");
      await p;
    });
  });
});

// https://github.com/Microsoft/vscode-mssql/blob/dev/test/initialization.test.ts
// https://github.com/HookyQR/VSCodeBeautify/blob/master/test/extension.test.js
// https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/vscode-api-commands.md
// https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/vscode-api.md
