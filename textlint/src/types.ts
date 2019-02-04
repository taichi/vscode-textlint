
import { NotificationType0, NotificationType, RequestType } from "vscode-jsonrpc";
import { TextDocumentIdentifier, TextEdit } from "vscode-languageserver-types";

export const SUPPORT_LANGUAGES = ["plaintext", "markdown", "html", "tex", "latex", "doctex"];

export namespace ExitNotification {
    export interface ExitParams {
        code: number;
        message: string;
    }
    export const type = new NotificationType<ExitParams, void>("textlint/exit");
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
    export const type = new NotificationType<StatusParams, void>("textlint/status");
}

export namespace NoConfigNotification {
    export const type = new NotificationType0<void>("textlint/noconfig");
}

export namespace NoLibraryNotification {
    export const type = new NotificationType0<void>("textlint/nolibrary");
}

export namespace AllFixesRequest {
    export interface Params {
        textDocument: TextDocumentIdentifier;
    }

    export interface Result {
        documentVersion: number;
        edits: TextEdit[];
    }

    export const type = new RequestType<Params, Result, void, void>("textDocument/textlint/allFixes");
}

export namespace StartProgressNotification {
    export const type = new NotificationType0<void>("textlint/progress/start");
}

export namespace StopProgressNotification {
    export const type = new NotificationType0<void>("textlint/progress/stop");
}
