# vscode-textlint ![push](https://github.com/taichi/vscode-textlint/actions/workflows/push.yml/badge.svg)

This repository is no longer being actively maintained. I've passed the torch to the community, and the project has found a new home.
If you're looking for the actively maintained version of vscode-textlint, please head over to:

https://github.com/textlint/vscode-textlint

Extension to integrate [textlint](https://textlint.github.io/) into VSCode.

## Development setup

- open `vscode-textlint.code-workspace` by VS Code
- run `npm install` inside the **root** folder
- hit F5 to build and debug the extension

## How to release

1. run `npm upgrade` inside the **root** folder
2. run `npm install` inside the **root** folder
3. run `vsce publish` inside the **packages/textlint** folder
