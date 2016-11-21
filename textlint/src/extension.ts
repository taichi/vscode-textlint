import * as path from "path";
import * as fs from "fs";

import {
    workspace, window, commands, ExtensionContext, Disposable, TextDocumentSaveReason
} from "vscode";

import {
    LanguageClient, LanguageClientOptions, ServerOptions, TextEdit, Protocol2Code,
    State as ServerState,
    ErrorHandler, ErrorAction, CloseAction,
    TransportKind, RevealOutputChannelOn
} from "vscode-languageclient";

import {
    SUPPORT_LANGUAGES,
    StatusNotification, NoConfigNotification, NoLibraryNotification, ExitNotification, AllFixesRequest,
    StartProgressNotification, StopProgressNotification
} from "vscode-textlint-shared";

import { Status, StatusBar } from "./status";

export function activate(context: ExtensionContext) {
    let client = newClient(context);
    let statusBar = new StatusBar(SUPPORT_LANGUAGES);
    client.onDidChangeState(event => {
        statusBar.serverRunning = event.newState === ServerState.Running;
    });
    client.onNotification(StatusNotification.type, (p: StatusNotification.StatusParams) => {
        statusBar.status = to(p.status);
        if (p.message || p.cause) {
            statusBar.status.log(client, p.message, p.cause);
        }
    });
    client.onNotification(NoConfigNotification.type, p => {
        statusBar.status = Status.WARN;
        statusBar.status.log(client, `
No textlint configuration (e.g .textlintrc) found.
File will not be validated. Consider running the 'Create .textlintrc file' command.`);
    });
    client.onNotification(NoLibraryNotification.type, p => {
        statusBar.status = Status.ERROR;
        statusBar.status.log(client, `
Failed to load the textlint library.
To use textlint in this workspace please install textlint using \'npm install textlint\' or globally using \'npm install -g textlint\'.
You need to reopen the workspace after installing textlint.`);
    });
    client.onNotification(StartProgressNotification.type, () => statusBar.startProgress());
    client.onNotification(StopProgressNotification.type, () => statusBar.stopProgress());

    let changeConfigHandler = () => {
        configureAutoFixOnSave(client);
    };
    workspace.onDidChangeConfiguration(changeConfigHandler);
    changeConfigHandler();

    context.subscriptions.push(
        commands.registerCommand("textlint.createConfig", createConfig),
        commands.registerCommand("textlint.applyTextEdits", makeApplyFixFn(client)),
        commands.registerCommand("textlint.executeAutofix", makeAutoFixFn(client)),
        commands.registerCommand("textlint.showOutputChannel", () => client.outputChannel.show()),
        client.start(),
        statusBar
    );
}

function newClient(context: ExtensionContext): LanguageClient {
    let serverModule = context.asAbsolutePath(path.join("server", "server.js"));
    let debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };

    let serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
    };

    let defaultErrorHandler: ErrorHandler;
    let languages = SUPPORT_LANGUAGES;
    let serverCalledProcessExit = false;
    let clientOptions: LanguageClientOptions = {
        documentSelector: languages,
        diagnosticCollectionName: "textlint",
        revealOutputChannelOn: RevealOutputChannelOn.Error,
        synchronize: {
            configurationSection: "textlint",
            fileEvents: [
                workspace.createFileSystemWatcher("**/.textlintr{c.js,c.yaml,c.yml,c,c.json}"),
                workspace.createFileSystemWatcher("**/package.json")
            ],
            textDocumentFilter: doc => {
                let fsPath = doc.fileName;
                if (fsPath) {
                    let basename = path.basename(fsPath);
                    return /^\.textlintrc\./.test(basename);
                }
            }
        },
        initializationOptions: () => {
            return {
                nodePath: getConfig("nodePath")
            };
        },
        initializationFailedHandler: error => {
            client.error("Server initialization failed.", error);
            return false;
        },
        errorHandler: {
            error: (error, message, count): ErrorAction => {
                return defaultErrorHandler.error(error, message, count);
            },
            closed: (): CloseAction => {
                if (serverCalledProcessExit) {
                    return CloseAction.DoNotRestart;
                }
                return defaultErrorHandler.closed();
            }
        }
    };

    let client = new LanguageClient("textlint", serverOptions, clientOptions);
    defaultErrorHandler = client.createDefaultErrorHandler();
    client.onNotification(ExitNotification.type, p => {
        serverCalledProcessExit = true;
    });
    return client;
}

function createConfig() {
    if (workspace.rootPath) {
        let rc = path.join(workspace.rootPath, ".textlintrc");
        if (fs.existsSync(rc) === false) {
            fs.writeFileSync(rc, `{
  "filters": {},
  "rules": {}
}`, { encoding: 'utf8' });
        }
    } else {
        window.showErrorMessage("An textlint configuration can only be generated if VS Code is opened on a workspace folder.");
    }
}

let autoFixOnSave: Disposable;

function configureAutoFixOnSave(client: LanguageClient) {
    let auto = getConfig("autoFixOnSave", false);
    if (auto && !autoFixOnSave) {
        let languages = new Set(SUPPORT_LANGUAGES);
        autoFixOnSave = workspace.onWillSaveTextDocument(event => {
            let doc = event.document;
            if (languages.has(doc.languageId) && event.reason !== TextDocumentSaveReason.AfterDelay) {
                let version = doc.version;
                let uri: string = doc.uri.toString();
                event.waitUntil(
                    client.sendRequest(AllFixesRequest.type,
                        { textDocument: { uri } }).then((result: AllFixesRequest.Result) => {
                            return result && result.documentVersion === version ?
                                Protocol2Code.asTextEdits(result.edits) :
                                [];
                        })
                );
            }
        });
    }
    if (auto === false) {
        disposeAutoFixOnSave();
    }
}
function disposeAutoFixOnSave() {
    if (autoFixOnSave) {
        autoFixOnSave.dispose();
        autoFixOnSave = undefined;
    }
}

function makeAutoFixFn(client: LanguageClient) {
    return () => {
        let textEditor = window.activeTextEditor;
        if (textEditor) {
            let uri: string = textEditor.document.uri.toString();
            client.sendRequest(AllFixesRequest.type, { textDocument: { uri } })
                .then((result: AllFixesRequest.Result) => {
                    if (result) {
                        applyTextEdits(client, uri, result.documentVersion, result.edits);
                    }
                }, error => {
                    client.error("Failed to apply textlint fixes to the document.", error);
                });
        }
    };
}

function makeApplyFixFn(client: LanguageClient) {
    return (uri: string, documentVersion: number, edits: TextEdit[]) => {
        applyTextEdits(client, uri, documentVersion, edits);
    };
}

function applyTextEdits(client: LanguageClient, uri: string, documentVersion: number, edits: TextEdit[]) {
    let textEditor = window.activeTextEditor;
    if (textEditor && textEditor.document.uri.toString() === uri) {
        if (textEditor.document.version === documentVersion) {
            textEditor.edit(mutator => {
                edits.forEach(ed => mutator.replace(Protocol2Code.asRange(ed.range), ed.newText));
            }).then(ok => {
                // do nothing
            }, errors => {
                client.error(errors.message, errors.stack);
            });
        } else {
            window.showInformationMessage(`textlint fixes are outdated and can't be applied to ${uri}`);
        }
    }
}

export function deactivate() {
    disposeAutoFixOnSave();
}

function config() {
    return workspace.getConfiguration("textlint");
}

function getConfig<T>(section: string, defaults?: T) {
    return config().get<T>(section, defaults);
}

function to(status: StatusNotification.Status): Status {
    switch (status) {
        case StatusNotification.Status.OK: return Status.OK;
        case StatusNotification.Status.WARN: return Status.WARN;
        case StatusNotification.Status.ERROR: return Status.ERROR;
        default: return Status.ERROR;
    }
}
