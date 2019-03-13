# vscode-textlint [![CircleCI](https://circleci.com/gh/taichi/vscode-textlint.svg?style=svg)](https://circleci.com/gh/taichi/vscode-textlint) [![Build Status](https://dev.azure.com/ryushi/vscode-textlint/_apis/build/status/vscode-textlint-CI?branchName=master)](https://dev.azure.com/ryushi/vscode-textlint/_build/latest?definitionId=2&branchName=master)

Extension to integrate [textlint](https://textlint.github.io/) into VSCode.

## Development setup

* open `vscode-textlint.code-workspace` by VS Code
* run `npm run prepare:dev` inside the **textlint** folder
* run `npm install` inside the **textlint** folder
* run `npm run watch` inside the **textlint** folder
* hit F5 to build and debug the extension

## How to release
1. run 'ncu -u' inside the **textlint-server** and **textlint** folder
2. run `npm run publish` inside the **textlint-server** folder
3. run `vsce publish` inside the **textlint** folder
