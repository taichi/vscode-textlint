import {
  TextDocuments,
  TextDocumentSyncKind,
  ErrorMessageTracker,
  ProposedFeatures,
  WorkspaceFolder,
} from "vscode-languageserver";

import { createConnection, Files } from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";

import { Trace, LogTraceNotification } from "vscode-jsonrpc";
import { URI, Utils as URIUtils } from "vscode-uri";

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as glob from "glob";
import * as minimatch from "minimatch";

import { NoConfigNotification, NoLibraryNotification } from "../types";

import { TextlintFixRepository } from "../autofix";
import { configureCodeAction, toDiagnostic, sendStartProgress, sendStopProgress, sendOK, sendError } from "../common";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let trace: number;
let settings;
documents.listen(connection);

const engineRepo: Map<string /* workspaceFolder uri */, TextLintEngine> = new Map();
const fixRepo: Map<string /* uri */, TextlintFixRepository> = new Map();

connection.onInitialize(async (params) => {
  settings = params.initializationOptions;
  trace = Trace.fromString(settings.trace);
  configureCodeAction(connection, documents, fixRepo, TRACE);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      codeActionProvider: true,
      workspace: {
        workspaceFolders: {
          supported: true,
          changeNotifications: true,
        },
      },
    },
  };
});

documents.onDidChangeContent(async (event) => {
  const uri = event.document.uri;
  TRACE(`onDidChangeContent ${uri}`, settings.run);
  if (settings.run === "onType") {
    return validateSingle(event.document);
  }
});
documents.onDidSave(async (event) => {
  const uri = event.document.uri;
  TRACE(`onDidSave ${uri}`, settings.run);
  if (settings.run === "onSave") {
    return validateSingle(event.document);
  }
});

documents.onDidOpen(async (event) => {
  const uri = event.document.uri;
  TRACE(`onDidOpen ${uri}`);
  if (uri.startsWith("file:") && fixRepo.has(uri) === false) {
    fixRepo.set(uri, new TextlintFixRepository());
    return validateSingle(event.document);
  }
});

documents.onDidClose((event) => {
  const uri = event.document.uri;
  TRACE(`onDidClose ${uri}`);
  if (uri.startsWith("file:")) {
    fixRepo.delete(uri);
    connection.sendDiagnostics({ uri, diagnostics: [] });
  }
});

async function validateSingle(textDocument: TextDocument) {
  sendStartProgress(connection);
  try {
    await validate(textDocument);
    sendOK(connection);
  } catch (error) {
    sendError(connection, error);
  } finally {
    sendStopProgress(connection);
  }
}

async function validateMany(textDocuments: TextDocument[]) {
  const tracker = new ErrorMessageTracker();
  sendStartProgress(connection);
  try {
    for (const doc of textDocuments) {
      try {
        await validate(doc);
      } catch (err) {
        tracker.add(err.message);
      }
    }
  } finally {
    tracker.sendErrors(connection);
    sendStopProgress(connection);
  }
}

connection.onInitialized(async () => {
  const folders = await connection.workspace.getWorkspaceFolders();
  await configureEngine(folders);
  connection.workspace.onDidChangeWorkspaceFolders(async (event) => {
    for (const folder of event.removed) {
      engineRepo.delete(folder.uri);
    }
    await reConfigure();
  });
});

async function reConfigure() {
  TRACE(`reConfigure`);
  await configureEngine(await connection.workspace.getWorkspaceFolders());
  const docs = [];
  for (const uri of fixRepo.keys()) {
    TRACE(`reConfigure:push ${uri}`);
    connection.sendDiagnostics({ uri, diagnostics: [] });
    docs.push(documents.get(uri));
  }
  return validateMany(docs);
}

connection.onDidChangeConfiguration(async (change) => {
  const newone = change.settings.textlint;
  TRACE("onDidChangeConfiguration", newone);
  settings = newone;
  trace = Trace.fromString(newone.trace);
  await reConfigure();
});

connection.onDidChangeWatchedFiles(async () => {
  TRACE("onDidChangeWatchedFiles");
  await reConfigure();
});

async function configureEngine(folders: WorkspaceFolder[]) {
  for (const folder of folders) {
    TRACE(`configureEngine ${folder.uri}`);
    const root = URI.parse(folder.uri).fsPath;
    try {
      const configFile = lookupConfig(root);
      const ignoreFile = lookupIgnore(root);
      const mod = await resolveModule(root);
      const engine = new mod.TextLintEngine({
        configFile,
        ignoreFile,
      });
      engineRepo.set(folder.uri, engine);
    } catch (e) {
      TRACE("failed to configureEngine", e);
    }
  }
}

function candidates(root: string) {
  return () => glob.sync(`${root}/.textlintr{c.js,c.yaml,c.yml,c,c.json}`);
}

function lookupConfig(root: string): string | undefined {
  const roots = [
    candidates(root),
    () => {
      return fs.existsSync(settings.configPath) ? [settings.configPath] : [];
    },
    candidates(os.homedir()),
  ];
  for (const fn of roots) {
    const files = fn();
    if (0 < files.length) {
      return files[0];
    }
  }
  connection.sendNotification(NoConfigNotification.type, {
    workspaceFolder: root,
  });
}

function lookupIgnore(root: string): string | undefined {
  const ignorePath = settings.ignorePath || path.resolve(root, ".textlintignore");
  if (fs.existsSync(ignorePath)) {
    return ignorePath;
  }
}

async function resolveModule(root: string) {
  try {
    TRACE(`Module textlint resolve from ${root}`);
    const path = await Files.resolveModulePath(root, "textlint", settings.nodePath, TRACE);
    TRACE(`Module textlint got resolved to ${path}`);
    return loadModule(path);
  } catch (e) {
    connection.sendNotification(NoLibraryNotification.type, {
      workspaceFolder: root,
    });
    throw e;
  }
}

declare const __webpack_require__: typeof require;
declare const __non_webpack_require__: typeof require;
function loadModule(moduleName: string) {
  const r = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
  try {
    return r(moduleName);
  } catch (err) {
    TRACE("load failed", err);
  }
  return undefined;
}

function isTarget(root: string, file: string): boolean {
  const relativePath = file.substring(root.length);
  return (
    settings.targetPath === "" ||
    minimatch(relativePath, settings.targetPath, {
      matchBase: true,
    })
  );
}

function startsWith(target, prefix: string): boolean {
  if (target.length < prefix.length) {
    return false;
  }
  const tElements = target.split("/");
  const pElements = prefix.split("/");
  for (let i = 0; i < pElements.length; i++) {
    if (pElements[i] !== tElements[i]) {
      return false;
    }
  }

  return true;
}

function lookupEngine(doc: TextDocument): [string, TextLintEngine] {
  TRACE(`lookupEngine ${doc.uri}`);
  for (const ent of engineRepo.entries()) {
    if (startsWith(doc.uri, ent[0])) {
      TRACE(`lookupEngine ${doc.uri} => ${ent[0]}`);
      return ent;
    }
  }
  TRACE(`lookupEngine ${doc.uri} not found`);
  return ["", undefined];
}

async function validate(doc: TextDocument) {
  TRACE(`validate ${doc.uri}`);
  const uri = URI.parse(doc.uri);
  if (doc.uri.startsWith("file:") === false) {
    TRACE("validation skipped...");
    return;
  }

  const repo = fixRepo.get(doc.uri);
  if (repo) {
    const [folder, engine] = lookupEngine(doc);
    const ext = URIUtils.extname(uri);
    if (engine && -1 < engine.availableExtensions.findIndex((s) => s === ext) && isTarget(folder, uri.fsPath)) {
      repo.clear();
      try {
        const results = await engine.executeOnText(doc.getText(), ext);
        TRACE("results", results);
        for (const result of results) {
          const diagnostics = result.messages.map(toDiagnostic).map(([msg, diag]) => {
            repo.register(doc, diag, msg);
            return diag;
          });
          TRACE(`sendDiagnostics ${doc.uri}`);
          connection.sendDiagnostics({ uri: doc.uri, diagnostics });
        }
      } catch (e) {
        sendError(connection, e);
      }
    }
  }
}

function toVerbose(data?: unknown): string {
  let verbose = "";
  if (data) {
    verbose = typeof data === "string" ? data : JSON.stringify(data, Object.getOwnPropertyNames(data));
  }
  return verbose;
}

export function TRACE(message: string, data?: unknown) {
  switch (trace) {
    case Trace.Messages:
      connection.sendNotification(LogTraceNotification.type, {
        message,
      });
      break;
    case Trace.Verbose:
      connection.sendNotification(LogTraceNotification.type, {
        message,
        verbose: toVerbose(data),
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
