import * as assert from 'assert';

import { workspace, window, commands, Uri, Extension, extensions } from 'vscode';
import { ExtensionInternal } from '../src/extension';

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

    if (!process.env.CI) {
        suite("with server", function () {
            setup(done => {
                internals.client.onReady().then(done);
            });
            test("handle file", done => {
                let data = `${workspace.rootPath}/testtest.txt`;
                internals.client.onNotification(PublishDiagnosticsNotification.type, (p) => {
                    let diags = p.diagnostics;
                    assert(diags);
                    assert.equal(2, diags.length);
                    done();
                });
                workspace.openTextDocument(data)
                    .then(doc => window.showTextDocument(doc));
            });
        });

    }
});


// https://github.com/Microsoft/vscode-mssql/blob/dev/test/initialization.test.ts
// https://github.com/HookyQR/VSCodeBeautify/blob/master/test/extension.test.js
// https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/vscode-api-commands.md
// https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/vscode-api.md
