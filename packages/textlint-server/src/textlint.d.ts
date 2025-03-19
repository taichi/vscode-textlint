interface TextLintFixCommand {
  text: string;
  range: [number, number];
  isAbsolute: boolean;
}

interface TextLintMessage {
  // See src/shared/type/MessageType.js
  // Message Type
  type: string;
  // Rule Id
  ruleId: string;
  message: string;
  // optional data
  data?: unknown;
  // FixCommand
  fix?: TextLintFixCommand;
  // location info
  // Text -> AST TxtNode(0-based columns) -> textlint -> TextLintMessage(**1-based columns**)
  line: number; // start with 1
  column: number; // start with 1
  // indexed-location
  index: number; // start with 0
  // Severity Level
  // See src/shared/type/SeverityLevel.js
  severity?: number;
}
export interface TextlintFixResult {
  filePath: string;
  // fixed content
  output: string;
  // all messages = pre-applyingMessages + remainingMessages
  // it is same with one of `TextlintResult`
  messages: TextLintMessage[];
  // applied fixable messages
  applyingMessages: TextLintMessage[];
  // original means original for applyingMessages and remainingMessages
  // pre-applyingMessages + remainingMessages
  remainingMessages: TextLintMessage[];
}

interface TextLintResult {
  filePath: string;
  messages: TextLintMessage[];
}

type ScanFilePathResult =
  | {
      status: "ok";
    }
  | {
      status: "ignored";
    }
  | {
      status: "error";
    };

interface TextLintEngine {
  availableExtensions: string[];

  executeOnText(text: string, ext: string): Thenable<TextLintResult[]>;
}
type TextlintKernelDescriptor = unknown;
export type CreateLinterOptions = {
  descriptor: TextlintKernelDescriptor;
  ignoreFilePath?: string;
  quiet?: boolean;
  cache?: boolean;
  cacheLocation?: string;
};
export type createLinter = (options: CreateLinterOptions) => {
  lintFiles(files: string[]): Promise<TextLintResult[]>;
  lintText(text: string, filePath: string): Promise<TextLintResult>;
  fixFiles(files: string[]): Promise<TextlintFixResult[]>;
  fixText(text: string, filePath: string): Promise<TextlintFixResult>;
  scanFilePath?(filePath: string): Promise<ScanFilePathResult>;
};
