# vscode-textlint ![push](https://github.com/taichi/vscode-textlint/actions/workflows/push.yml/badge.svg)

Extension to integrate [textlint](https://textlint.github.io/) into VSCode.

## Development setup

- open `vscode-textlint.code-workspace` by VS Code
- run `npm install` inside the **root** folder
- hit F5 to build and debug the extension

## How to release

1. run `npm upgrade` inside the **root** folder
2. run `npm install` inside the **root** folder
3. run `vsce publish` inside the **packages/textlint** folder
