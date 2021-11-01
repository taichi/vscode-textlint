import { ExtensionContext } from "vscode";

import { ErrorHandler, ErrorAction, CloseAction, CommonLanguageClient } from "vscode-languageclient";

import { LanguageClient, ServerOptions, TransportKind } from "vscode-languageclient/node";

import { Utils as URIUtils } from "vscode-uri";

import { ExtensionInternal, configureClient, newClientOptions, disposeAutoFixOnSave } from "../common";

import { ExitNotification } from "../types";

export function activate(context: ExtensionContext): ExtensionInternal {
  const client = newNodeClient(context);
  return configureClient(context, client);
}

function newNodeClient(context: ExtensionContext): CommonLanguageClient {
  const module = URIUtils.joinPath(context.extensionUri, "dist", "server.js").fsPath;

  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6011"] } },
  };

  // eslint-disable-next-line prefer-const
  let defaultErrorHandler: ErrorHandler;
  let serverCalledProcessExit = false;

  const clientOptions = newClientOptions(
    (error) => {
      client.error("Server initialization failed.", error);
      return false;
    },
    {
      error: (error, message, count): ErrorAction => {
        return defaultErrorHandler.error(error, message, count);
      },
      closed: (): CloseAction => {
        if (serverCalledProcessExit) {
          return CloseAction.DoNotRestart;
        }
        return defaultErrorHandler.closed();
      },
    }
  );

  const client = new LanguageClient("textlint", serverOptions, clientOptions);
  defaultErrorHandler = client.createDefaultErrorHandler();
  client.onReady().then(() => {
    client.onNotification(ExitNotification.type, () => {
      serverCalledProcessExit = true;
    });
  });
  return client;
}

export function deactivate() {
  disposeAutoFixOnSave();
}
