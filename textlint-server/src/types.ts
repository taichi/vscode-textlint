
import { NotificationType0, NotificationType, RequestType } from "vscode-jsonrpc";
import { TextDocumentIdentifier, TextEdit } from "vscode-languageserver-types";


export namespace ExitNotification {
    export interface ExitParams {
        code: number;
        message: string;
    }
    export const type = new NotificationType<ExitParams>("textlint/exit");
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
    export const type = new NotificationType<StatusParams>("textlint/status");
}

export namespace NoConfigNotification {
    export const type = new NotificationType0("textlint/noconfig");
}

export namespace NoLibraryNotification {
    export const type = new NotificationType0("textlint/nolibrary");
}

export namespace AllFixesRequest {
    export interface Params {
        textDocument: TextDocumentIdentifier;
    }

    export interface Result {
        documentVersion: number;
        edits: TextEdit[];
    }

    export const type = new RequestType<Params, Result, void>("textDocument/textlint/allFixes");
}

export namespace StartProgressNotification {
    export const type = new NotificationType0("textlint/progress/start");
}

export namespace StopProgressNotification {
    export const type = new NotificationType0("textlint/progress/stop");
}
