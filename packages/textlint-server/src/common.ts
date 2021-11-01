import {
  CodeAction,
  CodeActionKind,
  Command,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  TextDocuments,
  TextEdit,
  Connection,
} from "vscode-languageserver";

import { TextDocument } from "vscode-languageserver-textdocument";

import { AllFixesRequest, StatusNotification, StartProgressNotification, StopProgressNotification } from "./types";

import { TextlintFixRepository, AutoFix } from "./autofix";

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

export function toDiagnostic(message: TextLintMessage): [TextLintMessage, Diagnostic] {
  const txt = message.ruleId ? `${message.message} (${message.ruleId})` : message.message;
  const pos_start = Position.create(Math.max(0, message.line - 1), Math.max(0, message.column - 1));
  let offset = 0;
  if (message.message.indexOf("->") >= 0) {
    offset = message.message.indexOf(" ->");
  }
  // eslint-disable-next-line quotes
  if (message.message.indexOf('"') >= 0) {
    // eslint-disable-next-line quotes
    offset = message.message.indexOf('"', message.message.indexOf('"') + 1) - 1;
  }
  const pos_end = Position.create(Math.max(0, message.line - 1), Math.max(0, message.column - 1) + offset);
  const diag: Diagnostic = {
    message: txt,
    severity: toDiagnosticSeverity(message.severity),
    source: "textlint",
    range: Range.create(pos_start, pos_end),
    code: message.ruleId,
  };
  return [message, diag];
}

let inProgress = 0;
export function sendStartProgress(con: Connection) {
  if (inProgress < 1) {
    inProgress = 0;
    con.sendNotification(StartProgressNotification.type);
  }
  inProgress++;
}

export function sendStopProgress(con: Connection) {
  if (--inProgress < 1) {
    inProgress = 0;
    con.sendNotification(StopProgressNotification.type);
  }
}

export function sendOK(con: Connection) {
  con.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.OK,
  });
}
export function sendError(con: Connection, error) {
  const msg = error.message ? error.message : error;
  con.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.ERROR,
    message: <string>msg,
    cause: error.stack,
  });
}

export function configureCodeAction(
  con: Connection,
  documents: TextDocuments<TextDocument>,
  fixRepo: Map<string /* uri */, TextlintFixRepository>,
  TRACE: (message: string, data?: unknown) => void
) {
  con.onCodeAction((params) => {
    TRACE("onCodeAction", params);
    const result: CodeAction[] = [];
    const uri = params.textDocument.uri;
    const repo = fixRepo.get(uri);
    if (repo && repo.isEmpty() === false) {
      const doc = documents.get(uri);
      const toAction = (title, edits) => {
        const cmd = Command.create(title, "textlint.applyTextEdits", uri, repo.version, edits);
        return CodeAction.create(title, cmd, CodeActionKind.QuickFix);
      };
      const toTE = (af) => toTextEdit(doc, af);

      repo.find(params.context.diagnostics).forEach((af) => {
        result.push(toAction(`Fix this ${af.ruleId} problem`, [toTE(af)]));
        const same = repo.separatedValues((v) => v.ruleId === af.ruleId);
        if (0 < same.length) {
          result.push(toAction(`Fix all ${af.ruleId} problems`, same.map(toTE)));
        }
      });
      const all = repo.separatedValues();
      if (0 < all.length) {
        result.push(toAction(`Fix all auto-fixable problems`, all.map(toTE)));
      }
    }
    return result;
  });

  function toTextEdit(textDocument: TextDocument, af: AutoFix): TextEdit {
    return TextEdit.replace(
      Range.create(textDocument.positionAt(af.fix.range[0]), textDocument.positionAt(af.fix.range[1])),
      af.fix.text || ""
    );
  }

  con.onRequest(AllFixesRequest.type, (params: AllFixesRequest.Params) => {
    const uri = params.textDocument.uri;
    TRACE(`AllFixesRequest ${uri}`);
    const textDocument = documents.get(uri);
    const repo = fixRepo.get(uri);
    if (repo && repo.isEmpty() === false) {
      return {
        documentVersion: repo.version,
        edits: repo.separatedValues().map((af) => toTextEdit(textDocument, af)),
      };
    }
  });
}
