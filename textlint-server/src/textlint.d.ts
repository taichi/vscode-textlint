
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
    data?: any;
    // FixCommand
    fix?: TextLintFixCommand;
    // location info
    // Text -> AST TxtNode(0-based columns) -> textlint -> TextLintMessage(**1-based columns**)
    line: number; // start with 1
    column: number;// start with 1
    // indexed-location
    index: number;// start with 0
    // Severity Level
    // See src/shared/type/SeverityLevel.js
    severity?: number;
}
