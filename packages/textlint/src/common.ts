import * as minimatch from "minimatch";

import {
  workspace,
  window,
  commands,
  ExtensionContext,
  Disposable,
  QuickPickItem,
  WorkspaceFolder,
  TextDocumentSaveReason,
  TextEditor,
} from "vscode";

import {
  TextEdit,
  State as ServerState,
  ErrorHandler,
  RevealOutputChannelOn,
  LanguageClientOptions,
  CommonLanguageClient,
  InitializationFailedHandler,
} from "vscode-languageclient";

import { LogTraceNotification } from "vscode-jsonrpc";

import { Utils as URIUtils } from "vscode-uri";

import {
  StatusNotification,
  NoConfigNotification,
  NoLibraryNotification,
  AllFixesRequest,
  StartProgressNotification,
  StopProgressNotification,
} from "./types";

import { Status, StatusBar } from "./status";

export interface ExtensionInternal {
  client: CommonLanguageClient;
  statusBar: StatusBar;
  onAllFixesComplete(fn: (te: TextEditor, edits: TextEdit[], ok: boolean) => void);
}

export function newClientOptions(
  initializationFailedHandler: InitializationFailedHandler,
  errorHandler: ErrorHandler
): LanguageClientOptions {
  return {
    documentSelector: getConfig<string[]>("languages").map((id) => {
      return { language: id, scheme: "file" };
    }),
    diagnosticCollectionName: "textlint",
    revealOutputChannelOn: RevealOutputChannelOn.Error,
    synchronize: {
      configurationSection: "textlint",
      fileEvents: [
        workspace.createFileSystemWatcher("**/package.json"),
        workspace.createFileSystemWatcher("**/.textlintrc"),
        workspace.createFileSystemWatcher("**/.textlintrc.{js,json,yml,yaml}"),
        workspace.createFileSystemWatcher("**/.textlintignore"),
      ],
    },
    initializationOptions: () => {
      return {
        configPath: getConfig("configPath"),
        ignorePath: getConfig("ignorePath"),
        nodePath: getConfig("nodePath"),
        run: getConfig("run"),
        trace: getConfig("trace", "off"),
      };
    },
    initializationFailedHandler,
    errorHandler,
  };
}

export function configureClient(context: ExtensionContext, client: CommonLanguageClient): ExtensionInternal {
  const statusBar = new StatusBar(getConfig("languages"));
  client.onReady().then(() => {
    client.onDidChangeState((event) => {
      statusBar.serverRunning = event.newState === ServerState.Running;
    });
    client.onNotification(StatusNotification.type, (p: StatusNotification.StatusParams) => {
      statusBar.status = to(p.status);
      if (p.message || p.cause) {
        statusBar.status.log(client, p.message, p.cause);
      }
    });
    client.onNotification(NoConfigNotification.type, (p) => {
      statusBar.status = Status.WARN;
      statusBar.status.log(
        client,
        `No textlint configuration (e.g .textlintrc) found in ${p.workspaceFolder} .
File will not be validated. Consider running the 'Create .textlintrc file' command.`
      );
    });
    client.onNotification(NoLibraryNotification.type, (p) => {
      statusBar.status = Status.ERROR;
      statusBar.status.log(
        client,
        `Failed to load the textlint library in ${p.workspaceFolder} .
To use textlint in this workspace please install textlint using 'npm install textlint' or globally using 'npm install -g textlint'.
You need to reopen the workspace after installing textlint.`
      );
    });
    client.onNotification(StartProgressNotification.type, () => statusBar.startProgress());
    client.onNotification(StopProgressNotification.type, () => statusBar.stopProgress());

    client.onNotification(LogTraceNotification.type, (p) => client.info(p.message, p.verbose));
    const changeConfigHandler = () => configureAutoFixOnSave(client);
    workspace.onDidChangeConfiguration(changeConfigHandler);
    changeConfigHandler();
  });
  context.subscriptions.push(
    commands.registerCommand("textlint.createConfig", createConfig),
    commands.registerCommand("textlint.applyTextEdits", makeApplyFixFn(client)),
    commands.registerCommand("textlint.executeAutofix", makeAutoFixFn(client)),
    commands.registerCommand("textlint.showOutputChannel", () => client.outputChannel.show()),
    client.start(),
    statusBar
  );
  // for testing purpose
  return {
    client,
    statusBar,
    onAllFixesComplete,
  };
}

async function createConfig() {
  const folders = workspace.workspaceFolders;
  if (!folders) {
    await window.showErrorMessage(
      "An textlint configuration can only be generated if VS Code is opened on a workspace folder."
    );
    return;
  }

  const noConfigs = await filterNoConfigFolders(folders);

  if (noConfigs.length < 1 && 0 < folders.length) {
    await window.showErrorMessage("textlint configuration file already exists in this workspace.");
    return;
  }

  if (noConfigs.length === 1) {
    await emitConfig(noConfigs[0]);
  } else {
    const item = await window.showQuickPick(toQuickPickItems(noConfigs));
    if (item) {
      await emitConfig(item.folder);
    }
  }
}

async function filterNoConfigFolders(folders: readonly WorkspaceFolder[]): Promise<WorkspaceFolder[]> {
  const result = [];
  outer: for (const folder of folders) {
    const candidates = ["", ".js", ".yaml", ".yml", ".json"].map((ext) =>
      URIUtils.joinPath(folder.uri, ".textlintrc" + ext)
    );
    for (const configPath of candidates) {
      try {
        await workspace.fs.stat(configPath);
        continue outer;
        // eslint-disable-next-line no-empty
      } catch {}
    }
    result.push(folder);
  }
  return result;
}

async function emitConfig(folder: WorkspaceFolder) {
  if (folder) {
    await workspace.fs.writeFile(
      URIUtils.joinPath(folder.uri, ".textlintrc"),
      Buffer.from(
        `{
  "filters": {},
  "rules": {}
}`,
        "utf8"
      )
    );
  }
}

function toQuickPickItems(folders: WorkspaceFolder[]): ({ folder: WorkspaceFolder } & QuickPickItem)[] {
  return folders.map((folder) => {
    return {
      label: folder.name,
      description: folder.uri.path,
      folder,
    };
  });
}

let autoFixOnSave: Disposable;

function configureAutoFixOnSave(client: CommonLanguageClient) {
  const auto = getConfig("autoFixOnSave", false);
  disposeAutoFixOnSave();

  if (auto) {
    const languages = new Set(getConfig("languages"));
    autoFixOnSave = workspace.onWillSaveTextDocument((event) => {
      const doc = event.document;
      const target = getConfig("targetPath", null);
      if (
        languages.has(doc.languageId) &&
        event.reason !== TextDocumentSaveReason.AfterDelay &&
        (target === "" ||
          minimatch(workspace.asRelativePath(doc.uri), target, {
            matchBase: true,
          }))
      ) {
        const version = doc.version;
        const uri: string = doc.uri.toString();
        event.waitUntil(
          client.sendRequest(AllFixesRequest.type, { textDocument: { uri } }).then((result: AllFixesRequest.Result) => {
            return result && result.documentVersion === version
              ? client.protocol2CodeConverter.asTextEdits(result.edits)
              : [];
          })
        );
      }
    });
  }
}

export function disposeAutoFixOnSave() {
  if (autoFixOnSave) {
    autoFixOnSave.dispose();
    autoFixOnSave = undefined;
  }
}

function makeAutoFixFn(client: CommonLanguageClient) {
  return () => {
    const textEditor = window.activeTextEditor;
    if (textEditor) {
      const uri: string = textEditor.document.uri.toString();
      client.sendRequest(AllFixesRequest.type, { textDocument: { uri } }).then(
        async (result: AllFixesRequest.Result) => {
          if (result) {
            await applyTextEdits(client, uri, result.documentVersion, result.edits);
          }
        },
        (error) => {
          client.error("Failed to apply textlint fixes to the document.", error);
        }
      );
    }
  };
}

function makeApplyFixFn(client: CommonLanguageClient) {
  return async (uri: string, documentVersion: number, edits: TextEdit[]) => {
    await applyTextEdits(client, uri, documentVersion, edits);
  };
}

const allFixesCompletes = [];
function onAllFixesComplete(fn: (te: TextEditor, edits: TextEdit[], ok: boolean) => void) {
  allFixesCompletes.push(fn);
}

async function applyTextEdits(
  client: CommonLanguageClient,
  uri: string,
  documentVersion: number,
  edits: TextEdit[]
): Promise<boolean> {
  const textEditor = window.activeTextEditor;
  if (textEditor && textEditor.document.uri.toString() === uri) {
    if (textEditor.document.version === documentVersion) {
      return textEditor
        .edit((mutator) => {
          edits.forEach((ed) => mutator.replace(client.protocol2CodeConverter.asRange(ed.range), ed.newText));
        })
        .then(
          (ok) => {
            client.info("AllFixesComplete");
            allFixesCompletes.forEach((fn) => fn(textEditor, edits, ok));
            return true;
          },
          (errors) => {
            client.error(errors.message, errors.stack);
          }
        );
    } else {
      window.showInformationMessage(`textlint fixes are outdated and can't be applied to ${uri}`);
      return true;
    }
  }
}

function config() {
  return workspace.getConfiguration("textlint");
}

function getConfig<T>(section: string, defaults?: T) {
  return config().get<T>(section, defaults);
}

function to(status: StatusNotification.Status): Status {
  switch (status) {
    case StatusNotification.Status.OK:
      return Status.OK;
    case StatusNotification.Status.WARN:
      return Status.WARN;
    case StatusNotification.Status.ERROR:
      return Status.ERROR;
    default:
      return Status.ERROR;
  }
}
