# vscode-textlint

Extension to integrate [textlint](https://textlint.github.io/) into VSCode.

## Development setup

* run `npm install:all` inside the **textlint** folder
* run `npm run watch` inside the **textlint** folder
* open VS Code on **textlint** and **textlint-server** and **textlint-shared**

## Developing the server

* open VS Code on **textlint-server**
* run `npm run compile` or `npm run watch` to build the server and copy it into the **textlint** folder
* to debug press F5 which attaches a debugger to the server

## Developing the extension/client

* open VS Code on **textlint**
* run F5 to build and debug the extension
