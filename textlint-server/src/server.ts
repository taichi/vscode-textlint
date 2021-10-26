import {
  createConnection,
  CodeAction,
  CodeActionKind,
  Command,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  Files,
  TextDocuments,
  TextEdit,
  TextDocumentSyncKind,
  ErrorMessageTracker,
  ProposedFeatures,
  WorkspaceFolder,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import { Trace, LogTraceNotification } from "vscode-jsonrpc";
import { URI, Utils as URIUtils } from "vscode-uri";

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as glob from "glob";
import * as minimatch from "minimatch";

import {
  NoConfigNotification,
  NoLibraryNotification,
  AllFixesRequest,
  StatusNotification,
  StartProgressNotification,
  StopProgressNotification,
} from "./types";

import { TextlintFixRepository, AutoFix } from "./autofix";

let connection = createConnection(ProposedFeatures.all);
let documents = new TextDocuments(TextDocument);
let trace: number;
let settings;
documents.listen(connection);

const engineRepo: Map<string /* workspaceFolder uri */, TextLintEngine> =
  new Map();
let fixRepo: Map<string /* uri */, TextlintFixRepository> = new Map();

connection.onInitialize(async (params) => {
  settings = params.initializationOptions;
  trace = Trace.fromString(settings.trace);
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
    } catch (e) {}
  }
}

function lookupConfig(root: string): string | undefined {
  let roots = [
    candidates(root),
    () => {
      return fs.existsSync(settings.configPath) ? [settings.configPath] : [];
    },
    candidates(os.homedir()),
  ];
  for (const fn of roots) {
    let files = fn();
    if (0 < files.length) {
      return files[0];
    }
  }
  connection.sendNotification(NoConfigNotification.type, {
    workspaceFolder: root,
  });
}

function lookupIgnore(root: string): string | undefined {
  const ignorePath =
    settings.ignorePath || path.resolve(root, ".textlintignore");
  if (fs.existsSync(ignorePath)) {
    return ignorePath;
  }
}

async function resolveModule(root: string) {
  try {
    TRACE(`Module textlint resolve from ${root}`);
    const path = await Files.resolveModulePath(
      root,
      "textlint",
      settings.nodePath,
      TRACE
    );
    TRACE(`Module textlint got resolved to ${path}`);
    return require(path);
  } catch (e) {
    connection.sendNotification(NoLibraryNotification.type, {
      workspaceFolder: root,
    });
    throw e;
  }
}

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
  let newone = change.settings.textlint;
  TRACE(`onDidChangeConfiguration ${JSON.stringify(newone)}`);
  settings = newone;
  trace = Trace.fromString(newone.trace);
  await reConfigure();
});

connection.onDidChangeWatchedFiles(async (params) => {
  TRACE("onDidChangeWatchedFiles");
  await reConfigure();
});

documents.onDidChangeContent(async (event) => {
  let uri = event.document.uri;
  TRACE(`onDidChangeContent ${uri}`, settings.run);
  if (settings.run === "onType") {
    return validateSingle(event.document);
  }
});
documents.onDidSave(async (event) => {
  let uri = event.document.uri;
  TRACE(`onDidSave ${uri}`, settings.run);
  if (settings.run === "onSave") {
    return validateSingle(event.document);
  }
});

documents.onDidOpen(async (event) => {
  let uri = event.document.uri;
  TRACE(`onDidOpen ${uri}`);
  if (uri.startsWith("file:") && fixRepo.has(uri) === false) {
    fixRepo.set(uri, new TextlintFixRepository());
    return validateSingle(event.document);
  }
});

function clearDiagnostics(uri) {
  TRACE(`clearDiagnostics ${uri}`);
  if (uri.startsWith("file:")) {
    fixRepo.delete(uri);
    connection.sendDiagnostics({ uri, diagnostics: [] });
  }
}
documents.onDidClose((event) => {
  let uri = event.document.uri;
  TRACE(`onDidClose ${uri}`);
  clearDiagnostics(uri);
});

async function validateSingle(textDocument: TextDocument) {
  sendStartProgress();
  return validate(textDocument)
    .then(sendOK, (error) => {
      sendError(error);
    })
    .then(sendStopProgress);
}

async function validateMany(textDocuments: TextDocument[]) {
  let tracker = new ErrorMessageTracker();
  sendStartProgress();
  for (const doc of textDocuments) {
    try {
      await validate(doc);
    } catch (err) {
      tracker.add(err.message);
    }
  }
  tracker.sendErrors(connection);
  sendStopProgress();
}

function candidates(root: string) {
  return () => glob.sync(`${root}/.textlintr{c.js,c.yaml,c.yml,c,c.json}`);
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
    if (
      engine &&
      -1 < engine.availableExtensions.findIndex((s) => s === ext) &&
      isTarget(folder, uri.fsPath)
    ) {
      repo.clear();
      try {
        const results = await engine.executeOnText(doc.getText(), ext);
        TRACE("results", results);
        for (const result of results) {
          const diagnostics = result.messages
            .map(toDiagnostic)
            .map(([msg, diag]) => {
              repo.register(doc, diag, msg);
              return diag;
            });
          TRACE(`sendDiagnostics ${doc.uri}`);
          connection.sendDiagnostics({ uri: doc.uri, diagnostics });
        }
      } catch (e) {
        sendError(e);
      }
    }
  }
}

function toDiagnosticSeverity(severity?: number): DiagnosticSeverity {
  switch (severity) {
    case 2:
      return DiagnosticSeverity.Error;
    case 1:
      return DiagnosticSeverity.Warning;
    case 0:
      return DiagnosticSeverity.Information;
  }
  return DiagnosticSeverity.Information;
}

function toDiagnostic(message: TextLintMessage): [TextLintMessage, Diagnostic] {
  let txt = message.ruleId
    ? `${message.message} (${message.ruleId})`
    : message.message;
  let pos_start = Position.create(
    Math.max(0, message.line - 1),
    Math.max(0, message.column - 1)
  );
  var offset = 0;
  if (message.message.indexOf("->") >= 0) {
    offset = message.message.indexOf(" ->");
  }
  // eslint-disable-next-line quotes
  if (message.message.indexOf('"') >= 0) {
    // eslint-disable-next-line quotes
    offset = message.message.indexOf('"', message.message.indexOf('"') + 1) - 1;
  }
  let pos_end = Position.create(
    Math.max(0, message.line - 1),
    Math.max(0, message.column - 1) + offset
  );
  let diag: Diagnostic = {
    message: txt,
    severity: toDiagnosticSeverity(message.severity),
    source: "textlint",
    range: Range.create(pos_start, pos_end),
    code: message.ruleId,
  };
  return [message, diag];
}

connection.onCodeAction((params) => {
  TRACE("onCodeAction", params);
  let result: CodeAction[] = [];
  let uri = params.textDocument.uri;
  let repo = fixRepo.get(uri);
  if (repo && repo.isEmpty() === false) {
    let doc = documents.get(uri);
    let toAction = (title, edits) => {
      let cmd = Command.create(
        title,
        "textlint.applyTextEdits",
        uri,
        repo.version,
        edits
      );
      return CodeAction.create(title, cmd, CodeActionKind.QuickFix);
    };
    let toTE = (af) => toTextEdit(doc, af);

    repo.find(params.context.diagnostics).forEach((af) => {
      result.push(toAction(`Fix this ${af.ruleId} problem`, [toTE(af)]));
      let same = repo.separatedValues((v) => v.ruleId === af.ruleId);
      if (0 < same.length) {
        result.push(toAction(`Fix all ${af.ruleId} problems`, same.map(toTE)));
      }
    });
    let all = repo.separatedValues();
    if (0 < all.length) {
      result.push(toAction(`Fix all auto-fixable problems`, all.map(toTE)));
    }
  }
  return result;
});

function toTextEdit(textDocument: TextDocument, af: AutoFix): TextEdit {
  return TextEdit.replace(
    Range.create(
      textDocument.positionAt(af.fix.range[0]),
      textDocument.positionAt(af.fix.range[1])
    ),
    af.fix.text || ""
  );
}

connection.onRequest(AllFixesRequest.type, (params: AllFixesRequest.Params) => {
  let uri = params.textDocument.uri;
  TRACE(`AllFixesRequest ${uri}`);
  let textDocument = documents.get(uri);
  let repo = fixRepo.get(uri);
  if (repo && repo.isEmpty() === false) {
    return {
      documentVersion: repo.version,
      edits: repo.separatedValues().map((af) => toTextEdit(textDocument, af)),
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
  connection.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.OK,
  });
}
function sendError(error) {
  TRACE(`sendError ${error}`);
  let msg = error.message ? error.message : error;
  connection.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.ERROR,
    message: <string>msg,
    cause: error.stack,
  });
}

export function TRACE(message: string, data?: any) {
  switch (trace) {
    case Trace.Messages:
      connection.sendNotification(LogTraceNotification.type, {
        message,
      });
      break;
    case Trace.Verbose:
      let verbose = "";
      if (data) {
        verbose = typeof data === "string" ? data : JSON.stringify(data);
      }
      connection.sendNotification(LogTraceNotification.type, {
        message,
        verbose,
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
