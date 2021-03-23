import { NotificationType } from "vscode-jsonrpc";
import { Diagnostic } from "vscode-languageserver-types";

export namespace PublishDiagnosticsNotification {
    export const type = new NotificationType<PublishDiagnosticsParams>("textDocument/publishDiagnostics");
}

export interface PublishDiagnosticsParams {
    uri: string;
    diagnostics: Diagnostic[];
}
