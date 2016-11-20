import {
    createConnection, IConnection,
    ResponseError,
    InitializeResult, InitializeError,
    Diagnostic, DiagnosticSeverity, Position, Range, Files,
    TextDocuments, TextDocument, TextEdit,
    ErrorMessageTracker, IPCMessageReader, IPCMessageWriter
} from "vscode-languageserver";

import Uri from "vscode-uri";

import * as fs from "fs";
import * as path from "path";

import {
    StatusNotification, NoConfigNotification, NoLibraryNotification, ExitNotification, AllFixesRequest
} from "vscode-textlint-shared";

import { TextLintMessage } from "./textlint";
import { TextLintFixRepository } from "./autofix";

let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
let documents: TextDocuments = new TextDocuments();
let workspaceRoot: string;
let settings;
let engineFactory;
documents.listen(connection);

function optionPath() {
    return path.join(workspaceRoot, ".textlintrc");
}

connection.onInitialize((params): Thenable<InitializeResult | ResponseError<InitializeError>> => {
    workspaceRoot = params.rootPath;
    let {
        nodePath
    } = params.initializationOptions;
    return Files.resolveModule2(workspaceRoot, "textlint", nodePath, TRACE)
        .then(value => value, error => {
            connection.sendNotification(NoLibraryNotification.type);
            return Promise.reject(error);
        })
        .then(mod => {
            engineFactory = () => {
                return new mod.TextLintEngine({
                    configFile: optionPath()
                });
            };
            return {
                capabilities: {
                    textDocumentSync: documents.syncKind
                }
            };
        });

});
connection.onDidChangeConfiguration((change) => {
    settings = change.settings.textlint;
    validateMany(documents.all());
});
connection.onDidChangeWatchedFiles((params) => {
    validateMany(documents.all());
});

documents.onDidChangeContent(event => {
    if (settings.run === "onType") {
        validateSingle(event.document);
    }
});
documents.onDidSave(event => {
    if (settings.run === "onSave") {
        validateSingle(event.document);
    }
});
documents.onDidOpen(event => { });
documents.onDidClose(event => {
    // cleanup errors
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

function validateSingle(textDocument: TextDocument) {
    try {
        validate(textDocument);
        sendOK();
    } catch (err) {
        sendError(err);
    }
}
function validateMany(textDocuments: TextDocument[]) {
    let tracker = new ErrorMessageTracker();
    let promises = textDocuments.map(doc => {
        return new Promise((resolve, reject) => {
            try {
                validate(doc);
                resolve(StatusNotification.Status.OK);
            } catch (err) {
                tracker.add(err.message);
                reject(err);
            }
        });
    });
    Promise.all(promises).then(() => {
        tracker.sendErrors(connection);
        sendOK();
    }, errors => {
        tracker.sendErrors(connection);
        sendError(errors);
    });
}

let fixrepos: Map<string/* uri */, TextLintFixRepository> = new Map();

function validate(doc: TextDocument) {
    if (fs.existsSync(optionPath())) {
        let engine = engineFactory();
        let uri = doc.uri;
        let ext = path.extname(Uri.parse(uri).fsPath);
        fixrepos.delete(uri);
        engine.executeOnText(doc.getText(), ext ? ext : ".txt")
            .then(([results]) => {
                return results.messages
                    .map(toDiagnostic)
                    .map(([msg, diag]) => {
                        let repo = fixrepos.get(uri);
                        if (!repo) {
                            repo = new TextLintFixRepository();
                            fixrepos.set(uri, repo);
                        }
                        repo.register(doc, diag, msg);
                        return diag;
                    });
            }).then(diagnostics => {
                connection.sendDiagnostics({ uri, diagnostics });
            }, errors => sendError(errors));
    } else {
        connection.sendNotification(NoConfigNotification.type);
    }
}

function toDiagnosticSeverity(severity?: number): DiagnosticSeverity {
    switch (severity) {
        case 2: return DiagnosticSeverity.Error;
        case 1: return DiagnosticSeverity.Warning;
        case 0: return DiagnosticSeverity.Information;
    }
    return DiagnosticSeverity.Information;
}

function toDiagnostic(message: TextLintMessage): [TextLintMessage, Diagnostic] {
    TRACE(JSON.stringify(message));
    let txt = message.ruleId ? `${message.message} (${message.ruleId})` : message.message;
    let pos = Position.create(Math.max(0, message.line - 1), Math.max(0, message.column - 1));
    let diag: Diagnostic = {
        message: txt,
        severity: toDiagnosticSeverity(message.severity),
        source: "textlint",
        range: Range.create(pos, pos),
        code: message.ruleId
    };
    return [message, diag];
}

connection.onRequest(AllFixesRequest.type, (params: AllFixesRequest.Params) => {
    let uri = params.textDocument.uri;
    let textDocument = documents.get(uri);
    let repo = fixrepos.get(uri);
    if (repo) {
        if (repo.empty === false) {
            return {
                documentVersion: repo.version,
                edits: repo.separatedValues().map(af => {
                    return TextEdit.replace(
                        Range.create(
                            textDocument.positionAt(af.fix.range[0]),
                            textDocument.positionAt(af.fix.range[1])),
                        af.fix.text || "");
                })
            };
        }
    }
});

function sendOK() {
    connection.sendNotification(StatusNotification.type, { status: StatusNotification.Status.OK });
}
function sendError(error) {
    connection.sendNotification(StatusNotification.type,
        {
            status: StatusNotification.Status.ERROR,
            message: <string>error.message,
            cause: error.stack
        });
}

const nodeExit = process.exit;
process.exit = (code?: number) => {
    let stack = new Error("stack");
    connection.sendNotification(ExitNotification.type, { code: code ? code : 0, message: stack.stack });
    setTimeout(() => {
        nodeExit(code);
    }, 1000);
};

function TRACE(message: string, verbose?: string): void {
    connection.tracer.log(message, verbose);
}

connection.listen();
