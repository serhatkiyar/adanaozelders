// Güvenli matematik ifade ayrıştırıcı — y = f(x) grafik çizici için.
// HAM eval KULLANMAZ. Tokenizer → recursive-descent parser → kapanış (closure).
// Desteklenen: + - * / ^, tekli +/-, parantez, örtük çarpım (2x, 2(x+1), 2sin(x)),
// değişken x, sabitler (pi, e) ve tek-argümanlı fonksiyonlar (radyan).

export type CompiledFn = (x: number) => number;

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

const FUNCTIONS: Record<string, (a: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (a) => 1 / Math.tan(a),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: (a) => Math.log10(a),
  log2: (a) => Math.log2(a),
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
};

export const SUPPORTED_FUNCTIONS = Object.keys(FUNCTIONS);

type Token =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { t: "lp" }
  | { t: "rp" };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
      if (s[j] === ".") {
        j++;
        while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
      }
      tokens.push({ t: "num", v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === ".") {
      let j = i + 1;
      while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
      if (j === i + 1) throw new Error("Geçersiz sayı.");
      tokens.push({ t: "num", v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      let j = i;
      while (
        j < s.length &&
        ((s[j] >= "a" && s[j] <= "z") ||
          (s[j] >= "A" && s[j] <= "Z") ||
          (s[j] >= "0" && s[j] <= "9") ||
          s[j] === "_")
      )
        j++;
      tokens.push({ t: "id", v: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^") {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ t: "rp" });
      i++;
      continue;
    }
    throw new Error(`Beklenmeyen karakter: "${c}"`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  parse(): CompiledFn {
    const fn = this.parseExpr();
    if (this.pos < this.tokens.length) {
      throw new Error("Fazladan ifade.");
    }
    return fn;
  }

  // expr := term (('+'|'-') term)*
  private parseExpr(): CompiledFn {
    let left = this.parseTerm();
    for (;;) {
      const tok = this.peek();
      if (tok?.t === "op" && (tok.v === "+" || tok.v === "-")) {
        this.pos++;
        const right = this.parseTerm();
        const l = left;
        left = tok.v === "+" ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
      } else break;
    }
    return left;
  }

  // term := factor (('*'|'/') factor | örtük-çarpım factor)*
  private parseTerm(): CompiledFn {
    let left = this.parseFactor();
    for (;;) {
      const tok = this.peek();
      if (tok?.t === "op" && (tok.v === "*" || tok.v === "/")) {
        this.pos++;
        const right = this.parseFactor();
        const l = left;
        left = tok.v === "*" ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
      } else if (tok && (tok.t === "num" || tok.t === "id" || tok.t === "lp")) {
        // Örtük çarpım: 2x, 2(x+1), 2sin(x), (x+1)(x-1), x pi
        const right = this.parseFactor();
        const l = left;
        left = (x) => l(x) * right(x);
      } else break;
    }
    return left;
  }

  // factor := ('+'|'-') factor | power
  private parseFactor(): CompiledFn {
    const tok = this.peek();
    if (tok?.t === "op" && (tok.v === "+" || tok.v === "-")) {
      this.pos++;
      const operand = this.parseFactor();
      return tok.v === "-" ? (x) => -operand(x) : operand;
    }
    return this.parsePower();
  }

  // power := primary ('^' factor)?  (sağ-birleşim; üs işaretli olabilir: 2^-x)
  private parsePower(): CompiledFn {
    const base = this.parsePrimary();
    const tok = this.peek();
    if (tok?.t === "op" && tok.v === "^") {
      this.pos++;
      const exp = this.parseFactor();
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  }

  private parsePrimary(): CompiledFn {
    const tok = this.peek();
    if (!tok) throw new Error("İfade beklenmedik şekilde bitti.");

    if (tok.t === "num") {
      this.pos++;
      const v = tok.v;
      return () => v;
    }

    if (tok.t === "lp") {
      this.pos++;
      const inner = this.parseExpr();
      const close = this.peek();
      if (close?.t !== "rp") throw new Error("Kapanmayan parantez.");
      this.pos++;
      return inner;
    }

    if (tok.t === "id") {
      this.pos++;
      const name = tok.v;
      const fn = FUNCTIONS[name];
      if (fn) {
        const next = this.peek();
        if (next?.t !== "lp") throw new Error(`"${name}" için parantez gerekli.`);
        this.pos++;
        const arg = this.parseExpr();
        const close = this.peek();
        if (close?.t !== "rp") throw new Error("Kapanmayan parantez.");
        this.pos++;
        return (x) => fn(arg(x));
      }
      if (name === "x") return (x) => x;
      if (name in CONSTANTS) {
        const v = CONSTANTS[name];
        return () => v;
      }
      throw new Error(`Bilinmeyen: "${name}"`);
    }

    throw new Error("Geçersiz ifade.");
  }
}

/**
 * Formülü hızlı bir değerlendiriciye derler. Geçersizse Error fırlatır.
 * Çağıran (Grapher) hatayı yakalayıp kullanıcıya gösterir.
 */
export function compile(expr: string): CompiledFn {
  const trimmed = expr.trim();
  if (!trimmed) throw new Error("Boş ifade.");
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new Error("Boş ifade.");
  return new Parser(tokens).parse();
}
