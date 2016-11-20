
import { NotificationType, RequestType } from "vscode-jsonrpc";
import { TextDocumentIdentifier, TextEdit } from "vscode-languageserver-types";

export namespace ExitNotification {
    export interface ExitParams {
        code: number;
        message: string;
    }
    export const type: NotificationType<ExitParams> = { method: "textlint/exit" };
}

export namespace StatusNotification {
    export enum Status {
        OK = 1,
        WARN = 2,
        ERROR = 3
    }
    export interface StatusParams {
        status: Status;
        message?: string;
        cause?: any;
    }
    export const type: NotificationType<StatusParams> = { method: "textlint/status" };
}

export namespace NoConfigNotification {
    export const type: NotificationType<void> = { method: "textlint/noconfig" };
}

export namespace NoLibraryNotification {
    export const type: NotificationType<void> = { method: "textlint/nolibrary" };
}

export namespace AllFixesRequest {
    export interface Params {
        textDocument: TextDocumentIdentifier;
    }

    export interface Result {
        documentVersion: number;
        edits: TextEdit[];
    }

    export const type: RequestType<Params, Result, void> = { method: "textDocument/textlint/allFixes" };
}
