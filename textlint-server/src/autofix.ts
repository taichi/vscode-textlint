import {
    Diagnostic, TextDocument,
} from "vscode-languageserver";

import { TextLintMessage, TextLintFixCommand } from "./textlint";

export interface AutoFix {
    version: number;
    ruleId: string;
    fix: TextLintFixCommand;
}

export class TextLintFixRepository {
    map: Map<string, AutoFix> = new Map();
    register(doc: TextDocument, diag: Diagnostic, msg: TextLintMessage) {
        if (msg.fix && msg.ruleId) {
            let fix = {
                version: doc.version,
                ruleId: msg.ruleId,
                fix: msg.fix
            };
            this.map.set(this.toKey(diag), fix);
        }
    }

    find(diags: Diagnostic[]): AutoFix[] {
        return diags.map(d => this.map.get(this.toKey(d))).filter(af => af);
    }

    clear = () => this.map.clear();

    toKey(diagnostic: Diagnostic): string {
        let range = diagnostic.range;
        return `[${range.start.line},${range.start.character},${range.end.line},${range.end.character}]-${diagnostic.code}`;
    }

    isEmpty(): boolean {
        return this.map.size < 1;
    }

    get version(): number {
        let af = this.map.values().next().value;
        return af ? af.version : -1;
    }

    sortedValues(): AutoFix[] {
        let a = Array.from(this.map.values());
        return a.sort((left, right) => {
            let lr = left.fix.range;
            let rr = right.fix.range;
            if (lr[0] === rr[0]) {
                if (lr[1] === rr[1]) {
                    return 0;
                }
                return lr[1] < rr[1] ? -1 : 1;
            }
            return lr[0] < rr[0] ? -1 : 1;
        });
    }

    static overlaps(lastEdit: AutoFix, newEdit: AutoFix): boolean {
        return !!lastEdit && lastEdit.fix.range[1] > newEdit.fix.range[0];
    }

    separatedValues(filter: (ArutoFix) => boolean = () => true): AutoFix[] {
        let sv = this.sortedValues().filter(filter);
        if (sv.length < 1) {
            return sv;
        }
        let result: AutoFix[] = [];
        result.push(sv[0]);
        sv.reduce((prev, cur) => {
            if (TextLintFixRepository.overlaps(prev, cur) === false) {
                result.push(cur);
                return cur;
            }
            return prev;
        });
        return result;
    }
}
