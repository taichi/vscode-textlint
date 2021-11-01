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
    filename: "[name].js",
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
  entry: {
    extension: "./src/node/extension.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist", "node"),
  },
  plugins: [
    new webpack.EnvironmentPlugin({
      EXTENSION_NAME: `${extensionPackage.publisher}.${extensionPackage.name}`,
      EXTENSION_VERSION: extensionPackage.version,
    }),
  ],
});

/**@type {import('webpack').Configuration}*/
const webClient = merge(config, {
  target: "webworker",
  entry: {
    extension: "./src/web/extension.ts",
    "test/index": "./test/web/index.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist", "web"),
    filename: "[name].js",
  },
  resolve: {
    mainFields: ["browser", "main", "module"],
    fallback: {
      assert: require.resolve("assert"),
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: "process/browser",
    }),
  ],
});

/**@type {import('webpack').Configuration}*/
const server = merge(config, {
  entry: {
    server: "../textlint-server/src/node/server.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist", "node"),
  },
});

module.exports = [client, webClient, server];
