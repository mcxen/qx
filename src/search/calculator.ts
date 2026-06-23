export interface CalculationResult {
  expression: string;
  value: number;
  formatted: string;
}

type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "^" | "%" }
  | { type: "paren"; value: "(" | ")" };

const FUNCTIONS: Record<string, (value: number) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
};

const CONSTANTS: Record<string, number> = {
  e: Math.E,
  pi: Math.PI,
};

function normalizeInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed
    .replace(/^(=|calc(?:ulate)?\s+|计算\s*)/i, "")
    .replace(/[×x]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[，]/g, ",")
    .trim();

  const hasNumber = /\d/.test(withoutPrefix);
  const looksLikeMath =
    /^[\d\s+\-*/^%().,_a-z]+$/i.test(withoutPrefix) &&
    (/[+\-*/^%()]/.test(withoutPrefix) || /^(sqrt|abs|sin|cos|tan|ln|log)\b/i.test(withoutPrefix));

  return hasNumber && looksLikeMath ? withoutPrefix : null;
}

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const ch = expression[index];
    if (/\s|,|_/.test(ch)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const start = index;
      index += 1;
      while (index < expression.length && /[0-9._]/.test(expression[index])) index += 1;
      if (/[eE]/.test(expression[index] ?? "")) {
        index += 1;
        if (/[+-]/.test(expression[index] ?? "")) index += 1;
        while (index < expression.length && /\d/.test(expression[index])) index += 1;
      }
      const raw = expression.slice(start, index).replace(/_/g, "");
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      tokens.push({ type: "number", value });
      continue;
    }
    if (/[a-z]/i.test(ch)) {
      const start = index;
      index += 1;
      while (index < expression.length && /[a-z]/i.test(expression[index])) index += 1;
      tokens.push({ type: "identifier", value: expression.slice(start, index).toLowerCase() });
      continue;
    }
    if ("+-*/^%".includes(ch)) {
      tokens.push({ type: "operator", value: ch as Extract<Token, { type: "operator" }>["value"] });
      index += 1;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      index += 1;
      continue;
    }
    return null;
  }

  return tokens.length ? tokens : null;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): number | null {
    const value = this.expression();
    if (value === null || this.index !== this.tokens.length || !Number.isFinite(value)) return null;
    return value;
  }

  private expression(): number | null {
    let value = this.term();
    while (value !== null && this.matchOperator("+", "-")) {
      const op = this.previous().value;
      const rhs = this.term();
      if (rhs === null) return null;
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  private term(): number | null {
    let value = this.power();
    while (value !== null && this.matchOperator("*", "/", "%")) {
      const op = this.previous().value;
      const rhs = this.power();
      if (rhs === null) return null;
      if ((op === "/" || op === "%") && rhs === 0) return null;
      if (op === "*") value *= rhs;
      else if (op === "/") value /= rhs;
      else value %= rhs;
    }
    return value;
  }

  private power(): number | null {
    let value = this.unary();
    if (value !== null && this.matchOperator("^")) {
      const rhs = this.power();
      if (rhs === null) return null;
      value = value ** rhs;
    }
    return value;
  }

  private unary(): number | null {
    if (this.matchOperator("+")) return this.unary();
    if (this.matchOperator("-")) {
      const value = this.unary();
      return value === null ? null : -value;
    }
    return this.primary();
  }

  private primary(): number | null {
    const token = this.advance();
    if (!token) return null;
    if (token.type === "number") return token.value;
    if (token.type === "identifier") {
      if (token.value in CONSTANTS) return CONSTANTS[token.value];
      const fn = FUNCTIONS[token.value];
      if (!fn || !this.matchParen("(")) return null;
      const value = this.expression();
      if (value === null || !this.matchParen(")")) return null;
      const result = fn(value);
      return Number.isFinite(result) ? result : null;
    }
    if (token.type === "paren" && token.value === "(") {
      const value = this.expression();
      if (value === null || !this.matchParen(")")) return null;
      return value;
    }
    return null;
  }

  private matchOperator(...values: Array<Extract<Token, { type: "operator" }>["value"]>): boolean {
    const token = this.peek();
    if (token?.type === "operator" && values.includes(token.value as never)) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private matchParen(value: "(" | ")"): boolean {
    const token = this.peek();
    if (token?.type === "paren" && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private advance(): Token | undefined {
    const token = this.peek();
    if (token) this.index += 1;
    return token;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private previous(): Extract<Token, { type: "operator" }> {
    return this.tokens[this.index - 1] as Extract<Token, { type: "operator" }>;
  }
}

function formatNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER) {
    return value.toLocaleString("en-US");
  }
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-7)) {
    return value.toExponential(8).replace(/\.?0+e/, "e");
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 10,
    useGrouping: true,
  }).format(Number(value.toPrecision(12)));
}

export function calculateExpression(input: string): CalculationResult | null {
  const expression = normalizeInput(input);
  if (!expression) return null;
  const tokens = tokenize(expression);
  if (!tokens) return null;
  const value = new Parser(tokens).parse();
  if (value === null) return null;
  return {
    expression,
    value,
    formatted: formatNumber(value),
  };
}
