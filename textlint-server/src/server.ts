import {
    createConnection, IConnection,
    ResponseError, InitializeResult, InitializeError,
    Command, Diagnostic, DiagnosticSeverity, Position, Range, Files,
    TextDocuments, TextDocument, TextEdit,
    ErrorMessageTracker, IPCMessageReader, IPCMessageWriter
} from "vscode-languageserver";

import Uri from "vscode-uri";

import * as fs from "fs";
import * as path from "path";

import {
    StatusNotification, NoConfigNotification, NoLibraryNotification, ExitNotification, AllFixesRequest,
    StartProgressNotification, StopProgressNotification
} from "vscode-textlint-shared";

import { TextLintFixRepository, AutoFix } from "./autofix";

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
                    textDocumentSync: documents.syncKind,
                    codeActionProvider: true
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
documents.onDidOpen(event => {
    fixrepos.set(event.document.uri, new TextLintFixRepository());
});
documents.onDidClose(event => {
    // cleanup errors
    let uri = event.document.uri;
    fixrepos.delete(uri);
    connection.sendDiagnostics({ uri, diagnostics: [] });
});

function validateSingle(textDocument: TextDocument) {
    try {
        sendStartProgress();
        validate(textDocument);
        sendOK();
    } catch (err) {
        sendError(err);
    } finally {
        sendStopProgress();
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
    sendStartProgress();
    Promise.all(promises).then(() => {
        tracker.sendErrors(connection);
        sendOK();
    }, errors => {
        tracker.sendErrors(connection);
        sendError(errors);
    }).then(() => sendStopProgress());
}

let fixrepos: Map<string/* uri */, TextLintFixRepository> = new Map();

function validate(doc: TextDocument) {
    if (fs.existsSync(optionPath())) {
        let engine = engineFactory();
        let uri = doc.uri;
        let ext = path.extname(Uri.parse(uri).fsPath);
        ext = ext ? ext : ".txt";
        let repo = fixrepos.get(uri);
        if (repo &&
            -1 < engine.availableExtensions.findIndex(s => s === ext)) {
            repo.clear();
            engine.executeOnText(doc.getText(), ext)
                .then(([results]) => {
                    return results.messages
                        .map(toDiagnostic)
                        .map(([msg, diag]) => {
                            repo.register(doc, diag, msg);
                            return diag;
                        });
                }).then(diagnostics => {
                    connection.sendDiagnostics({ uri, diagnostics });
                }, errors => sendError(errors));

        }
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
    //TRACE(JSON.stringify(message));
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

connection.onCodeAction(params => {
    let result: Command[] = [];
    let uri = params.textDocument.uri;
    let repo = fixrepos.get(uri);
    if (repo && repo.isEmpty() === false) {
        let doc = documents.get(uri);
        let toCMD = (title, edits) =>
            Command.create(title,
                "textlint.applyTextEdits",
                uri, repo.version, edits);
        let toTE = af => toTextEdit(doc, af);

        repo.find(params.context.diagnostics).forEach(af => {
            result.push(toCMD(`Fix this ${af.ruleId} problem`, [toTE(af)]));
            let same = repo.separatedValues(v => v.ruleId === af.ruleId);
            if (0 < same.length) {
                result.push(toCMD(`Fix all ${af.ruleId} problems`, same.map(toTE)));
            }
        });
        let all = repo.separatedValues();
        if (0 < all.length) {
            result.push(toCMD(`Fix all auto-fixable problems`, all.map(toTE)));
        }
    }
    return result;
});

function toTextEdit(textDocument: TextDocument, af: AutoFix): TextEdit {
    return TextEdit.replace(
        Range.create(
            textDocument.positionAt(af.fix.range[0]),
            textDocument.positionAt(af.fix.range[1])),
        af.fix.text || "");
}

connection.onRequest(AllFixesRequest.type, (params: AllFixesRequest.Params) => {
    let uri = params.textDocument.uri;
    let textDocument = documents.get(uri);
    let repo = fixrepos.get(uri);
    if (repo && repo.isEmpty() === false) {
        return {
            documentVersion: repo.version,
            edits: repo.separatedValues().map(af => toTextEdit(textDocument, af))
        };
    }
});

function sendStartProgress() {
    connection.sendNotification(StartProgressNotification.type);
}

function sendStopProgress() {
    connection.sendNotification(StopProgressNotification.type);
}

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
