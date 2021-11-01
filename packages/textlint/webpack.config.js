"use strict";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpack = require("webpack");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const extensionPackage = require("./package.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const merge = require("merge-options");

/**@type {import('webpack').Configuration}*/
const config = {
  target: "node",
  output: {
    libraryTarget: "commonjs",
  },
  stats: {
    errorDetails: true,
  },
  devtool: "source-map",
  externals: [
    {
      vscode: "commonjs vscode",
      textlint: "commonjs textlint",
    },
  ],
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
};

/**@type {import('webpack').Configuration}*/
const client = merge(config, {
  entry: "./src/node/extension.ts",
  output: {
    path: path.resolve(__dirname, "dist", "node"),
    filename: "extension.js",
  },
  plugins: [
    new webpack.EnvironmentPlugin({
      EXTENSION_NAME: `${extensionPackage.publisher}.${extensionPackage.name}`,
      EXTENSION_VERSION: extensionPackage.version,
    }),
  ],
});

/**@type {import('webpack').Configuration}*/
const server = merge(config, {
  entry: "../textlint-server/src/node/server.ts",
  output: {
    path: path.resolve(__dirname, "dist", "node"),
    filename: "server.js",
  },
});

module.exports = [client, server];
