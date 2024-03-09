import { window, StatusBarAlignment, TextEditor } from "vscode";

export interface Status {
  label: string;
  color: string;
  log: (
    logger: {
      info(message: string, data?: unknown): void;
      warn(message: string, data?: unknown): void;
      error(message: string, data?: unknown): void;
    },
    msg: string,
    data?: unknown
  ) => void;
}

export namespace Status {
  export const OK: Status = {
    label: "textlint",
    color: "",
    log: (logger, msg, data?) => logger.info(msg, data),
  };
  export const WARN: Status = {
    label: "textlint: Warning",
    color: "yellow",
    log: (logger, msg, data?) => logger.warn(msg, data),
  };
  export const ERROR: Status = {
    label: "textlint: Error",
    color: "darkred",
    log: (logger, msg, data?) => logger.error(msg, data),
  };
}

export class StatusBar {
  private _delegate = window.createStatusBarItem(StatusBarAlignment.Right, 0);
  private _supports: string[];
  private _status = Status.OK;
  private _serverRunning = false;
  private _intervalToken;
  constructor(supports) {
    this._supports = supports;
    this._delegate.text = this._status.label;
    window.onDidChangeActiveTextEditor((te) => this.updateWith(te));
    this.update();
  }

  dispose() {
    this.stopProgress();
    this._delegate.dispose();
  }

  show(show: boolean) {
    if (show) {
      this._delegate.show();
    } else {
      this._delegate.hide();
    }
  }
  activate(languageId: string) {
    if (languageId === "") {
      return;
    }

    if (-1 !== this._supports.indexOf(languageId)) {
      this._delegate.color = "";
      this._delegate.tooltip =
        "need to restart this extension or check this extension setting and .textlintrc if textlint is not working.";
    } else {
      this._delegate.color = "#818589";
      this._delegate.tooltip = `textlint is inanctive on ${languageId}.`;
    }
  }

  get status(): Status {
    return this._status;
  }

  set status(s: Status) {
    this._status = s;
    this.update();
  }

  get serverRunning(): boolean {
    return this._serverRunning;
  }

  set serverRunning(sr: boolean) {
    this._serverRunning = sr;
    window.showInformationMessage(sr ? "textlint server is running." : "textlint server stopped.");
    this.update();
  }

  update() {
    this.updateWith(window.activeTextEditor);
  }

  updateWith(editor: TextEditor) {
    this._delegate.text = this.status.label;
    const languageId = editor?.document.languageId ?? "";
    this.activate(languageId);
    this.show(this.serverRunning === false || this._status !== Status.OK || -1 !== this._supports.indexOf(languageId));
  }

  startProgress() {
    if (!this._intervalToken) {
      let c = 0;
      const orig = this._delegate.text;
      const chars = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
      const l = chars.length;
      this._intervalToken = setInterval(() => {
        const t = c++ % l;
        this._delegate.text = chars[t] + " " + orig;
      }, 300);
    }
  }

  stopProgress() {
    if (this._intervalToken) {
      const tk = this._intervalToken;
      this._intervalToken = null;
      clearInterval(tk);
      this.update();
    }
  }
}
