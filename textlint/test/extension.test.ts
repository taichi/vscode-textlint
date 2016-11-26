import * as assert from "assert";
import * as fs from "fs-extra";


import { workspace, window, commands, Uri, Extension, extensions } from "vscode";
import { ExtensionInternal } from "../src/extension";

import { PublishDiagnosticsNotification } from "./types";

suite("Extension Tests", () => {
    let extension: Extension<ExtensionInternal>;
    let internals: ExtensionInternal;
    setup(done => {
        extension = extensions.getExtension("taichi.vscode-textlint");
        extension.activate().then(v => {
            internals = v;
            done();
        });
    });

    suite("basic behavior", () => {
        test("activate extension", () => {
            assert(extension.isActive);
            assert(internals.client);
            assert(internals.statusBar);
        });
    });

    suite("with server", function () {
        let original = `${workspace.rootPath}/testtest.txt`;
        let newfile = `${workspace.rootPath}/testtest2.txt`;
        let timelag = () => new Promise(resolve => setTimeout(resolve, 300));
        setup(done => {
            internals.client.onReady().then(done);
            fs.copySync(original, newfile);
        });
        teardown(done => {
            fs.unlink(newfile, err => {
                commands.executeCommand("workbench.action.closeAllEditors");
                done();
            });
        });
        test("lint file", done => {
            internals.client.onNotification(PublishDiagnosticsNotification.type, p => {
                let diags = p.diagnostics;
                assert(diags);
                assert.equal(2, diags.length);

                internals.client.onNotification(PublishDiagnosticsNotification.type, p => 1);
                done();
            });
            workspace.openTextDocument(newfile)
                .then(doc => window.showTextDocument(doc));
        });
        test("fix file", done => {
            workspace.openTextDocument(newfile)
                .then(doc => window.showTextDocument(doc))
                .then(ed => commands.executeCommand("textlint.executeAutofix"))
                .then(timelag)
                .then(() => commands.executeCommand("workbench.action.files.save"))
                .then(() => {
                    let ed = window.activeTextEditor;
                    assert(ed.document.getText().indexOf("yuo") < 0);
                    done();
                });
        });
    });
});


// https://github.com/Microsoft/vscode-mssql/blob/dev/test/initialization.test.ts
// https://github.com/HookyQR/VSCodeBeautify/blob/master/test/extension.test.js
// https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/vscode-api-commands.md
// https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/vscode-api.md
