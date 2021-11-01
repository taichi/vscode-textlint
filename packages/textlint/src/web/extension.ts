import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage("now active in the web extension host!");
}

export function deactivate() {
  console.log("now deactivate in the web extension host!");
}
