"use strict";

const webpack = require("webpack");
const path = require("path");
const extensionPackage = require("./package.json");
const merge = require("merge-options");

/**@type {import('webpack').Configuration}*/
const config = {
  target: "node",
  output: {
    path: path.resolve(__dirname, "dist"),
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
  entry: "./src/extension.ts",
  output: {
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
  entry: "../textlint-server/src/server.ts",
  output: {
    filename: "server.js",
  },
});

module.exports = [client, server];
