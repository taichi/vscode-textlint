import { window, StatusBarAlignment, TextEditor } from "vscode";

export interface Status {
  label: string;
  color: string;
  log: (
    logger: {
      info(message: string, data?: any): void;
      warn(message: string, data?: any): void;
      error(message: string, data?: any): void;
    },
    msg: string,
    data?: any
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
    this._delegate.tooltip = sr ? "textlint server is running." : "textlint server stopped.";
    this.update();
  }

  update() {
    this.updateWith(window.activeTextEditor);
  }

  updateWith(editor: TextEditor) {
    this._delegate.text = this.status.label;
    this.show(
      this.serverRunning === false ||
        this._status !== Status.OK ||
        (editor && 0 < this._supports.indexOf(editor.document.languageId))
    );
  }

  startProgress() {
    if (!this._intervalToken) {
      let c = 0;
      let orig = this._delegate.text;
      let chars = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
      let l = chars.length;
      this._intervalToken = setInterval(() => {
        let t = c++ % l;
        this._delegate.text = chars[t] + " " + orig;
      }, 300);
    }
  }

  stopProgress() {
    if (this._intervalToken) {
      let tk = this._intervalToken;
      this._intervalToken = null;
      clearInterval(tk);
      this.update();
    }
  }
}
