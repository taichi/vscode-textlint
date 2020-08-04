# VS Code textlint extension

Integrates [textlint](https://textlint.github.io/) into VS Code. If you are new to textlint check the [documentation](https://textlint.github.io/).

![hover](https://github.com/taichi/vscode-textlint/raw/master/imgs/hover.png?raw=true)

![codeaction](https://github.com/taichi/vscode-textlint/raw/master/imgs/codeaction.png?raw=true)

The extension uses the textlint library installed in the opened workspace folder. If the folder doesn't provide one the
extension looks for a global install version. If you haven't installed textlint either locally or globally do so by running
`npm install textlint` in the workspace folder for a local install or `npm install -g textlint` for a global install.

On new folders you might also need to create a `.textlintrc` configuration file. You can do this by either running
[`textlint --init`](https://github.com/textlint/textlint/blob/master/docs/getting-started.md#configuration) in a terminal or by using the VS Code
command `Create '.textlintrc' file`.

## Settings Options

* `textlint.autoFixOnSave`
  * by default is `false`. if you set `true`, Automatically fix auto-fixable errors on save.
* `textlint.run`
  * run the linter `onSave` or `onType`, default is `onType`.
* `textlint.nodePath`
  * use this setting if an installed textlint package can't be detected, for example `/myGlobalNodePackages/node_modules`.
* `textlint.trace`
  * Traces the communication between VSCode and the textlint linter service.
* `textlint.configPath`
  * absolute path to textlint config file.
  * workspace settings are prioritize.
* `textlint.targetPath`
  * set a glob pattern.

## Commands

This extension contributes the following commands to the Command palette.

* Create '.textlintrc' File
  * creates a new .eslintrc.json file.
* Fix all auto-fixable Problems
  * applies textlint auto-fix resolutions to all fixable problems.

## Release Notes

### 0.8.0
* add sets a target path support.
  * thanks for @bells17 !!

### 0.7.0
* add sets a target path support.
  * thanks for @bells17 !!

### 0.6.8
* change default value of `textlint.run` to `onSave`
* run tests on Azure Pipelines.

### 0.6.5
* add tex file support including `.tex`, `.latex`, `.doctex`.
* this feature works with [LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop) and [textlint-plugin-latex2e](https://github.com/ta2gch/textlint-plugin-latex2e).

### 0.5.0
* add `configPath` to configuration. recommend to use your user settings.

### 0.4.0
* read configuration file from `HOME` dir
  * if you want to use global configuration, you should install textlint and plugins globally.

### 0.3.0
* update runtime dependencies

### 0.2.3
* add tracing option.

### 0.2.2
* fix some bug.

### 0.2.1
* add progress notification to StatusBar

### 0.2.0
* Supports fixing errors.

### 0.1.0
* Initial Release
