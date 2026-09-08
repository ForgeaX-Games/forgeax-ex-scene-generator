/**
 * Geometry DSL 解析器：Python-like SSA。
 *
 * 词法形态（手写递归下降，无正则回溯陷阱）：
 *   IDENT     [A-Za-z_][A-Za-z0-9_]*
 *   NUMBER    -?\d+(\.\d+)?([eE][+-]?\d+)?
 *   STRING    "..." 双引号；支持 \" \\ \n \t \r
 *   PUNCT     = ( ) [ ] , 注释 #
 *   KEYWORD   true / false
 *
 * 一行的合法形态：
 *   IDENT '=' IDENT '(' kwargs? ')'    -- 赋值语句
 *   kwargs := kwarg (',' kwarg)* ','?
 *   kwarg  := IDENT '=' value
 *   value  := NUMBER | STRING | true | false | IDENT (= ref) | '[' value (',' value)* ','? ']'
 *
 * 容错：行解析失败 → 记录错误 + 继续下一行；不抛异常。
 * 注释 / 空行：被 skip，但占 1 行号位。
 */

import type { Arg, Statement, GeometryError } from './types.js';

export interface ParseResult {
  statements: Statement[];
  errors: GeometryError[];
}

/** 入口：把 DSL 文本解析成语句数组 + 错误数组。永不抛异常。 */
export function parseDSL(source: string): ParseResult {
  const lines = source.split('\n');
  const statements: Statement[] = [];
  const errors: GeometryError[] = [];

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const stripped = stripComment(raw).trim();
    if (stripped === '') return; // 空行 / 纯注释

    try {
      const stmt = parseLine(stripped, lineNo);
      statements.push(stmt);
    } catch (e) {
      const err = e as GeometryError | Error;
      if (isGeometryError(err)) {
        errors.push(err);
      } else {
        errors.push({
          message: `unexpected parser failure: ${(err as Error).message ?? String(err)}`,
          line: lineNo,
          kind: 'parse',
        });
      }
    }
  });

  return { statements, errors };
}

// ── 行级解析 ─────────────────────────────────────────────────────────────────

function parseLine(text: string, line: number): Statement {
  const lex = new Lexer(text, line);

  // <id>
  const id = lex.expectIdent('expected statement name (id) at start of line');
  // =
  lex.expectPunct('=', "expected '=' after statement name");
  // <op>
  const op = lex.expectIdent("expected operator name after '='");
  // (
  lex.expectPunct('(', `expected '(' after operator '${op}'`);

  const args: Record<string, Arg> = {};
  if (!lex.peek(')')) {
    parseKwargs(lex, args);
  }
  lex.expectPunct(')', `expected ')' to close arguments of '${op}'`);
  lex.expectEnd(`unexpected trailing tokens after ')'`);

  return Object.freeze({ id, op, args: Object.freeze(args), line }) as Statement;
}

function parseKwargs(lex: Lexer, out: Record<string, Arg>): void {
  parseKwarg(lex, out);
  while (lex.consume(',')) {
    if (lex.peek(')')) break; // 容忍尾随逗号
    parseKwarg(lex, out);
  }
}

function parseKwarg(lex: Lexer, out: Record<string, Arg>): void {
  const key = lex.expectIdent('expected argument name');
  lex.expectPunct('=', `expected '=' after argument name '${key}'`);
  const val = parseValue(lex);
  if (key in out) {
    throw err(`duplicate argument '${key}'`, lex.line, 'parse');
  }
  out[key] = val;
}

function parseValue(lex: Lexer): Arg {
  // 数字
  if (lex.peekKind('number')) {
    const n = lex.takeNumber();
    return { kind: 'number', value: n };
  }
  // 字符串
  if (lex.peekKind('string')) {
    const s = lex.takeString();
    return { kind: 'string', value: s };
  }
  // bool 或 ref（都是 ident）
  if (lex.peekKind('ident')) {
    const name = lex.takeIdent();
    if (name === 'true')  return { kind: 'bool', value: true };
    if (name === 'false') return { kind: 'bool', value: false };
    return { kind: 'ref', name };
  }
  // 列表
  if (lex.consume('[')) {
    const items: Arg[] = [];
    if (!lex.peek(']')) {
      items.push(parseValue(lex));
      while (lex.consume(',')) {
        if (lex.peek(']')) break;
        items.push(parseValue(lex));
      }
    }
    lex.expectPunct(']', "expected ']' to close list");
    return { kind: 'list', items: Object.freeze(items) };
  }
  throw err('expected a value (number / string / true / false / ref / [list])', lex.line, 'parse');
}

// ── Lexer ─────────────────────────────────────────────────────────────────

type TokenKind = 'ident' | 'number' | 'string' | 'punct' | 'eof';

class Lexer {
  private pos = 0;
  constructor(private readonly src: string, readonly line: number) {}

  // — kind 探测 / 消费 —

  peekKind(kind: TokenKind): boolean {
    this.skipWs();
    if (kind === 'eof') return this.pos >= this.src.length;
    const ch = this.src[this.pos];
    if (ch === undefined) return false;
    if (kind === 'string') return ch === '"';
    if (kind === 'number') return ch === '-' || (ch >= '0' && ch <= '9');
    if (kind === 'ident') return isIdentStart(ch);
    return false;
  }

  peek(punct: string): boolean {
    this.skipWs();
    return this.src.startsWith(punct, this.pos);
  }

  consume(punct: string): boolean {
    this.skipWs();
    if (this.src.startsWith(punct, this.pos)) {
      this.pos += punct.length;
      return true;
    }
    return false;
  }

  // — 取值 —

  takeIdent(): string {
    this.skipWs();
    if (!isIdentStart(this.src[this.pos] ?? '')) {
      throw err('expected identifier', this.line, 'parse', this.pos);
    }
    let end = this.pos + 1;
    while (end < this.src.length && isIdentCont(this.src[end]!)) end++;
    const tok = this.src.slice(this.pos, end);
    this.pos = end;
    return tok;
  }

  takeNumber(): number {
    this.skipWs();
    const start = this.pos;
    if (this.src[this.pos] === '-') this.pos++;
    let sawDigit = false;
    while (this.pos < this.src.length && this.src[this.pos]! >= '0' && this.src[this.pos]! <= '9') {
      this.pos++;
      sawDigit = true;
    }
    if (this.src[this.pos] === '.') {
      this.pos++;
      while (this.pos < this.src.length && this.src[this.pos]! >= '0' && this.src[this.pos]! <= '9') {
        this.pos++;
        sawDigit = true;
      }
    }
    if (this.src[this.pos] === 'e' || this.src[this.pos] === 'E') {
      this.pos++;
      if (this.src[this.pos] === '+' || this.src[this.pos] === '-') this.pos++;
      while (this.pos < this.src.length && this.src[this.pos]! >= '0' && this.src[this.pos]! <= '9') {
        this.pos++;
        sawDigit = true;
      }
    }
    if (!sawDigit) throw err('malformed number', this.line, 'parse', start);
    const raw = this.src.slice(start, this.pos);
    const n = Number(raw);
    if (!Number.isFinite(n)) throw err(`number not finite: ${raw}`, this.line, 'parse', start);
    return n;
  }

  takeString(): string {
    this.skipWs();
    if (this.src[this.pos] !== '"') {
      throw err('expected string', this.line, 'parse', this.pos);
    }
    this.pos++; // 跳过开引号
    let out = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]!;
      if (ch === '"') {
        this.pos++;
        return out;
      }
      if (ch === '\\') {
        this.pos++;
        const esc = this.src[this.pos];
        if (esc === undefined) break;
        switch (esc) {
          case '"':  out += '"'; break;
          case '\\': out += '\\'; break;
          case 'n':  out += '\n'; break;
          case 't':  out += '\t'; break;
          case 'r':  out += '\r'; break;
          default:   out += esc;
        }
        this.pos++;
        continue;
      }
      out += ch;
      this.pos++;
    }
    throw err('unterminated string literal', this.line, 'parse');
  }

  // — 期望 / 失败定位 —

  expectIdent(msg: string): string {
    if (!this.peekKind('ident')) throw err(msg, this.line, 'parse', this.pos);
    return this.takeIdent();
  }

  expectPunct(p: string, msg: string): void {
    if (!this.consume(p)) throw err(msg, this.line, 'parse', this.pos);
  }

  expectEnd(msg: string): void {
    this.skipWs();
    if (this.pos < this.src.length) throw err(msg, this.line, 'parse', this.pos);
  }

  // — 内部 —

  private skipWs(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]!;
      if (ch === ' ' || ch === '\t' || ch === '\r') this.pos++;
      else break;
    }
  }
}

// ── 辅助 ─────────────────────────────────────────────────────────────────

function isIdentStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}
function isIdentCont(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

/** 去掉 # 注释（# 在字符串内不算注释）。 */
function stripComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      // 简易：跳过转义中的 \"
      if (i > 0 && line[i - 1] === '\\') continue;
      inStr = !inStr;
    } else if (ch === '#' && !inStr) {
      return line.slice(0, i);
    }
  }
  return line;
}

function err(message: string, line: number, kind: GeometryError['kind'], col?: number): GeometryError {
  return col === undefined ? { message, line, kind } : { message, line, col, kind };
}

function isGeometryError(e: unknown): e is GeometryError {
  return !!e && typeof e === 'object' && 'kind' in e && 'line' in e && 'message' in e;
}
