# vscode-textlint [![CircleCI](https://circleci.com/gh/taichi/vscode-textlint.svg?style=svg)](https://circleci.com/gh/taichi/vscode-textlint) [![Build Status](https://dev.azure.com/ryushi/vscode-textlint/_apis/build/status/vscode-textlint-CI?branchName=master)](https://dev.azure.com/ryushi/vscode-textlint/_build/latest?definitionId=2&branchName=master)

Extension to integrate [textlint](https://textlint.github.io/) into VSCode.

## Development setup

- open `vscode-textlint.code-workspace` by VS Code
- run `npm install` inside the **textlint** folder
- run `npm run prepare:dev` inside the **textlint** folder
- run `npm run watch` inside the **textlint** folder
- hit F5 to build and debug the extension

## How to release

1. run `npm upgrade` inside the **textlint** folder
2. run `npm install` inside the **textlint** folder
3. run `npm login` inside the **textlint-server** folder
4. run `npm publish` inside the **textlint-server** folder
5. run `vsce publish` inside the **textlint** folder
