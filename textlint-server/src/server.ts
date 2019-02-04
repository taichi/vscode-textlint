import {
    createConnection, IConnection, FileChangeType,
    Command, Diagnostic, DiagnosticSeverity, Position, Range, Files,
    TextDocuments, TextDocument, TextEdit,
    ErrorMessageTracker, IPCMessageReader, IPCMessageWriter
} from "vscode-languageserver";

import { Trace, LogTraceNotification } from "vscode-jsonrpc";
import Uri from "vscode-uri";

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as glob from "glob";

import {
    NoConfigNotification, NoLibraryNotification, ExitNotification,
    AllFixesRequest, StatusNotification,
    StartProgressNotification, StopProgressNotification
} from "./types";

import { TextLintFixRepository, AutoFix } from "./autofix";

let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
let documents: TextDocuments = new TextDocuments();
let workspaceRoot: string;
let trace: number;
let textlintModule;
let settings;
documents.listen(connection);

connection.onInitialize(params => {
    workspaceRoot = params.rootPath;
    settings = params.initializationOptions;
    trace = Trace.fromString(settings.trace);
    return resolveTextLint().then(() => {
        return {
            capabilities: {
                textDocumentSync: documents.syncKind,
                codeActionProvider: true
            }
        };
    });
});
connection.onDidChangeConfiguration(change => {
    let newone = change.settings.textlint;
    TRACE(`onDidChangeConfiguration ${JSON.stringify(newone)}`);
    if (settings.nodePath !== newone.nodePath) {
        textlintModule = null;
    }
    settings = newone;
    trace = Trace.fromString(newone.trace);
    return validateMany(documents.all());
});
connection.onDidChangeWatchedFiles(params => {
    TRACE("onDidChangeWatchedFiles");
    params.changes.forEach(event => {
        if (event.uri.endsWith("package.json") &&
            (event.type === FileChangeType.Created || event.type === FileChangeType.Changed)) {
            textlintModule = null;
        }
    });
    return validateMany(documents.all());
});

documents.onDidChangeContent(event => {
    let uri = event.document.uri;
    TRACE(`onDidChangeContent ${uri}`);
    if (settings.run === "onType") {
        return validateSingle(event.document);
    }
});
documents.onDidSave(event => {
    let uri = event.document.uri;
    TRACE(`onDidSave ${uri}`);
    if (settings.run === "onSave") {
        return validateSingle(event.document);
    }
});

function resolveTextLint(): Thenable<any> {
    return Files.resolveModule2(workspaceRoot, "textlint", settings.nodePath, TRACE)
        .then(value => value, error => {
            connection.sendNotification(NoLibraryNotification.type);
            return Promise.reject(error);
        }).then(mod => textlintModule = mod);
}

documents.onDidOpen(event => {
    let uri = event.document.uri;
    TRACE(`onDidOpen ${uri}`);
    if (uri.startsWith("file:") && fixrepos.has(uri) === false) {
        fixrepos.set(uri, new TextLintFixRepository(() => {
            if (textlintModule) {
                return Promise.resolve(textlintModule);
            }
            return resolveTextLint();
        }));
    }
});
documents.onDidClose(event => {
    // cleanup errors
    let uri = event.document.uri;
    if (uri.startsWith("file:")) {
        fixrepos.delete(uri);
        connection.sendDiagnostics({ uri, diagnostics: [] });
    }
});

function validateSingle(textDocument: TextDocument) {
    sendStartProgress();
    return validate(textDocument).then(sendOK, error => {
        sendError(error);
    }).then(sendStopProgress);
}

function validateMany(textDocuments: TextDocument[]) {
    let tracker = new ErrorMessageTracker();
    sendStartProgress();
    let promises = textDocuments.map(doc => {
        return validate(doc).then(undefined, error => {
            tracker.add(error.message);
            return Promise.reject(error);
        });
    });
    return Promise.all(promises).then(() => {
        tracker.sendErrors(connection);
        sendOK();
    }, errors => {
        tracker.sendErrors(connection);
        sendError(errors);
    }).then(sendStopProgress);
}

function candidates(root: string) {
    return () => glob.sync(`${root}/.textlintr{c.js,c.yaml,c.yml,c,c.json}`);
}

function findConfig(): string {
    let roots = [candidates(workspaceRoot), () => {
        return fs.existsSync(settings.configPath) ? [settings.configPath] : [];
    }, candidates(os.homedir())];
    for (const fn of roots) {
        let files = fn();
        if (0 < files.length) {
            return files[0];
        }
    }
    connection.sendNotification(NoConfigNotification.type);
    return "";
}

let fixrepos: Map<string/* uri */, TextLintFixRepository> = new Map();

function validate(doc: TextDocument): Thenable<void> {
    let uri = doc.uri;
    TRACE(`validate ${uri}`);
    if (!textlintModule || uri.startsWith("file:") === false) {
        TRACE("validation skiped...");
        return Promise.resolve();
    }
    let conf = findConfig();
    let repo = fixrepos.get(uri);
    if (conf && repo) {
        try {
            TRACE(`configuration file is ${conf}`);
            return repo.newEngine(conf).then(engine => {
                let ext = path.extname(Uri.parse(uri).fsPath);
                TRACE(`engine startd... ${ext}`);
                if (-1 < engine.availableExtensions.findIndex(s => s === ext)) {
                    repo.clear();
                    return engine.executeOnText(doc.getText(), ext)
                        .then(([results]) => {
                            return results.messages
                                .map(toDiagnostic)
                                .map(([msg, diag]) => {
                                    repo.register(doc, diag, msg);
                                    return diag;
                                });
                        }).then(diagnostics => {
                            TRACE(`sendDiagnostics ${uri}`);
                            connection.sendDiagnostics({ uri, diagnostics });
                        }, errors => sendError(errors));
                }
            });
        } catch (error) {
            return Promise.reject(error);
        }
    }
    return Promise.resolve();
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
    TRACE("onCodeAction", params);
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
    TRACE(`AllFixesRequest ${uri}`);
    let textDocument = documents.get(uri);
    let repo = fixrepos.get(uri);
    if (repo && repo.isEmpty() === false) {
        return {
            documentVersion: repo.version,
            edits: repo.separatedValues().map(af => toTextEdit(textDocument, af))
        };
    }
});

let inProgress = 0;
function sendStartProgress() {
    TRACE(`sendStartProgress ${inProgress}`);
    if (inProgress < 1) {
        inProgress = 0;
        connection.sendNotification(StartProgressNotification.type);
    }
    inProgress++;
}

function sendStopProgress() {
    TRACE(`sendStopProgress ${inProgress}`);
    if (--inProgress < 1) {
        inProgress = 0;
        connection.sendNotification(StopProgressNotification.type);
    }
}

function sendOK() {
    TRACE("sendOK");
    connection.sendNotification(StatusNotification.type, { status: StatusNotification.Status.OK });
}
function sendError(error) {
    TRACE(`sendError ${error}`);
    let msg = error.message ? error.message : error;
    connection.sendNotification(StatusNotification.type,
        {
            status: StatusNotification.Status.ERROR,
            message: <string>msg,
            cause: error.stack
        });
}

export function TRACE(message: string, data?: any) {
    switch (trace) {
        case Trace.Messages:
            connection.sendNotification(LogTraceNotification.type, {
                message
            });
            break;
        case Trace.Verbose:
            let verbose = "";
            if (data) {
                verbose = typeof data === "string" ? data : JSON.stringify(data);
            }
            connection.sendNotification(LogTraceNotification.type, {
                message, verbose
            });
            break;
        case Trace.Off:
            // do nothing.
            break;
        default:
            break;
    }
}

connection.listen();
