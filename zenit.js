/* Zenit — intérprete independiente
 * Extraído de zenit.html; conserva el intérprete original.
 * Uso: Zenit.ejecutar('imprimir("Hola")');
 */
const Zenit = (function () {
  'use strict';

  /* ---------------- TOKENIZER ---------------- */
  const KEYWORDS = new Set([
    'var', 'const', 'if', 'else', 'while', 'for', 'in', 'func', 'return',
    'true', 'false', 'null', 'and', 'or', 'not'
  ]);

  function tokenize(src) {
    const tokens = [];
    let i = 0, line = 1, col = 1;

    const push = (type, value, ln, cl) => tokens.push({ type, value, line: ln, col: cl });
    const peek = (k = 0) => src[i + k];
    const advance = () => {
      const ch = src[i++];
      if (ch === '\n') { line++; col = 1; } else col++;
      return ch;
    };

    while (i < src.length) {
      const ch = src[i];
      const sLine = line, sCol = col;

      if (ch === ' ' || ch === '\t' || ch === '\r') { advance(); continue; }

      if (ch === '#' || (ch === '/' && peek(1) === '/')) {
        while (i < src.length && src[i] !== '\n') advance();
        continue;
      }
      if (ch === '/' && peek(1) === '*') {
        advance(); advance();
        while (i < src.length && !(src[i] === '*' && peek(1) === '/')) advance();
        if (i < src.length) { advance(); advance(); }
        continue;
      }

      if (ch === '\n') { push('NEWLINE', '\n', sLine, sCol); advance(); continue; }

      if (/[0-9]/.test(ch)) {
        let num = '';
        while (i < src.length && /[0-9]/.test(src[i])) num += advance();
        if (src[i] === '.' && /[0-9]/.test(peek(1))) {
          num += advance();
          while (i < src.length && /[0-9]/.test(src[i])) num += advance();
        }
        push('NUMBER', parseFloat(num), sLine, sCol);
        continue;
      }

      if (ch === '"' || ch === "'") {
        const quote = advance();
        let str = '';
        while (i < src.length && src[i] !== quote) {
          if (src[i] === '\\') {
            advance();
            const e = advance();
            str += ({ n:'\n', t:'\t', r:'\r', '\\':'\\', '"':'"', "'":"'" }[e] ?? e);
          } else str += advance();
        }
        if (i >= src.length) throw new Error(`Línea ${sLine}: texto sin cerrar`);
        advance();
        push('STRING', str, sLine, sCol);
        continue;
      }

      if (/[a-zA-Z_]/.test(ch)) {
        let id = '';
        while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) id += advance();
        push(KEYWORDS.has(id) ? 'KEYWORD' : 'IDENT', id, sLine, sCol);
        continue;
      }

      const two = ['==','!=','<=','>=','&&','||','**','+=','-=','*=','/=','..'];
      let matched = false;
      for (const op of two) {
        if (src.substr(i, op.length) === op) {
          advance(); advance();
          push('OP', op, sLine, sCol);
          matched = true; break;
        }
      }
      if (matched) continue;

      if ('+-*/%<>=!(){}[],.'.includes(ch)) {
        push('OP', ch, sLine, sCol); advance(); continue;
      }

      throw new Error(`Línea ${sLine}, col ${sCol}: carácter inesperado '${ch}'`);
    }
    push('EOF', null, line, col);
    return tokens;
  }

  /* ---------------- PARSER ---------------- */
  class Parser {
    constructor(tokens) { this.tokens = tokens; this.pos = 0; }
    peek(k = 0) { return this.tokens[this.pos + k]; }
    check(type, value) {
      const t = this.peek();
      return !!t && t.type === type && (value === undefined || t.value === value);
    }
    match(type, value) { if (this.check(type, value)) { this.pos++; return true; } return false; }
    expect(type, value) {
      const t = this.peek();
      if (!this.check(type, value)) {
        const got = t ? (t.type === 'EOF' ? 'fin de archivo' : `'${t.value}'`) : 'fin de archivo';
        throw new Error(`Línea ${t ? t.line : '?'}: se esperaba ${type === 'OP' ? `'${value}'` : type}, se encontró ${got}`);
      }
      this.pos++;
      return t;
    }
    skipNewlines() { while (this.match('NEWLINE')); }

    parseProgram() {
      const body = [];
      this.skipNewlines();
      while (!this.check('EOF')) { body.push(this.parseStatement()); this.skipNewlines(); }
      return { type: 'Program', body };
    }

    parseStatement() {
      this.skipNewlines();
      const t = this.peek();
      if (t.type === 'KEYWORD') {
        switch (t.value) {
          case 'var': return this.parseVarDecl(false);
          case 'const': return this.parseVarDecl(true);
          case 'if': return this.parseIf();
          case 'while': return this.parseWhile();
          case 'for': return this.parseFor();
          case 'func':
            if (this.peek(1) && this.peek(1).type === 'IDENT') return this.parseFuncDecl();
            break;
          case 'return': return this.parseReturn();
        }
      }
      if (this.check('OP', '{')) return this.parseBlock();
      const expr = this.parseExpression();
      this.consumeTerminator();
      return { type: 'ExprStmt', expr, line: t.line };
    }

    parseVarDecl(isConst) {
      const kw = this.expect('KEYWORD', isConst ? 'const' : 'var');
      const name = this.expect('IDENT').value;
      let init = null;
      if (this.match('OP', '=')) init = this.parseExpression();
      this.consumeTerminator();
      return { type: 'VarDecl', name, init, isConst, line: kw.line };
    }

    consumeTerminator() {
      if (this.match('OP', ';')) { this.skipNewlines(); return; }
      if (this.check('NEWLINE')) { this.skipNewlines(); return; }
      if (this.check('EOF')) return;
      if (this.check('OP', '}')) return;
      if (this.check('KEYWORD', 'else')) return;
      const t = this.peek();
      throw new Error(`Línea ${t.line}: se esperaba fin de instrucción, se encontró '${t.value}'`);
    }

    parseIf() {
      const kw = this.expect('KEYWORD', 'if');
      const cond = this.parseExpression();
      const thenBlock = this.parseBlock();
      let elseBlock = null;
      const save = this.pos;
      this.skipNewlines();
      if (this.match('KEYWORD', 'else')) {
        this.skipNewlines();
        if (this.check('KEYWORD', 'if')) {
          elseBlock = { type: 'Block', body: [this.parseIf()] };
        } else {
          elseBlock = this.parseBlock();
        }
      } else { this.pos = save; }
      return { type: 'If', cond, thenBlock, elseBlock, line: kw.line };
    }

    parseWhile() {
      const kw = this.expect('KEYWORD', 'while');
      const cond = this.parseExpression();
      const body = this.parseBlock();
      return { type: 'While', cond, body, line: kw.line };
    }

    parseFor() {
      const kw = this.expect('KEYWORD', 'for');
      const name = this.expect('IDENT').value;
      this.expect('KEYWORD', 'in');
      const iterable = this.parseExpression();
      const body = this.parseBlock();
      return { type: 'For', name, iterable, body, line: kw.line };
    }

    parseFuncDecl() {
      const kw = this.expect('KEYWORD', 'func');
      const name = this.expect('IDENT').value;
      const params = this.parseParams();
      const body = this.parseBlock();
      return { type: 'FuncDecl', name, params, body, line: kw.line };
    }

    parseParams() {
      this.expect('OP', '(');
      const params = [];
      this.skipNewlines();
      if (!this.check('OP', ')')) {
        params.push(this.expect('IDENT').value);
        this.skipNewlines();
        while (this.match('OP', ',')) {
          this.skipNewlines();
          params.push(this.expect('IDENT').value);
          this.skipNewlines();
        }
      }
      this.expect('OP', ')');
      return params;
    }

    parseReturn() {
      const kw = this.expect('KEYWORD', 'return');
      let value = null;
      if (!this.check('NEWLINE') && !this.check('EOF') && !this.check('OP', '}')) {
        value = this.parseExpression();
      }
      this.consumeTerminator();
      return { type: 'Return', value, line: kw.line };
    }

    parseBlock() {
      this.expect('OP', '{');
      const body = [];
      this.skipNewlines();
      while (!this.check('OP', '}') && !this.check('EOF')) {
        body.push(this.parseStatement());
        this.skipNewlines();
      }
      this.expect('OP', '}');
      return { type: 'Block', body };
    }

    parseExpression() { return this.parseAssignment(); }

    parseAssignment() {
      const left = this.parseOr();
      if (['=','+=','-=','*=','/='].some(op => this.check('OP', op))) {
        const op = this.peek().value;
        this.pos++;
        const value = this.parseAssignment();
        if (left.type !== 'Identifier' && left.type !== 'Index') {
          throw new Error(`Línea ${left.line}: objetivo de asignación inválido`);
        }
        return { type: 'Assign', target: left, op, value, line: left.line };
      }
      return left;
    }

    parseOr() {
      let left = this.parseAnd();
      while (this.check('OP', '||') || this.check('KEYWORD', 'or')) {
        this.pos++;
        left = { type: 'Logical', op: '||', left, right: this.parseAnd() };
      }
      return left;
    }
    parseAnd() {
      let left = this.parseEquality();
      while (this.check('OP', '&&') || this.check('KEYWORD', 'and')) {
        this.pos++;
        left = { type: 'Logical', op: '&&', left, right: this.parseEquality() };
      }
      return left;
    }
    parseEquality() {
      let left = this.parseComparison();
      while (this.check('OP', '==') || this.check('OP', '!=')) {
        const op = this.peek().value; this.pos++;
        left = { type: 'Binary', op, left, right: this.parseComparison() };
      }
      return left;
    }
    parseComparison() {
      let left = this.parseRange();
      while (['<','>','<=','>='].some(op => this.check('OP', op))) {
        const op = this.peek().value; this.pos++;
        left = { type: 'Binary', op, left, right: this.parseRange() };
      }
      return left;
    }
    parseRange() {
      const left = this.parseAdditive();
      if (this.check('OP', '..')) {
        this.pos++;
        return { type: 'Range', start: left, end: this.parseAdditive() };
      }
      return left;
    }
    parseAdditive() {
      let left = this.parseMultiplicative();
      while (this.check('OP', '+') || this.check('OP', '-')) {
        const op = this.peek().value; this.pos++;
        left = { type: 'Binary', op, left, right: this.parseMultiplicative() };
      }
      return left;
    }
    parseMultiplicative() {
      let left = this.parsePower();
      while (['*','/','%'].some(op => this.check('OP', op))) {
        const op = this.peek().value; this.pos++;
        left = { type: 'Binary', op, left, right: this.parsePower() };
      }
      return left;
    }
    parsePower() {
      const left = this.parseUnary();
      if (this.check('OP', '**')) {
        this.pos++;
        return { type: 'Binary', op: '**', left, right: this.parsePower() };
      }
      return left;
    }
    parseUnary() {
      if (this.check('OP', '!') || this.check('OP', '-') || this.check('KEYWORD', 'not')) {
        const op = this.peek().value === 'not' ? '!' : this.peek().value;
        this.pos++;
        return { type: 'Unary', op, operand: this.parseUnary() };
      }
      return this.parseCall();
    }
    parseCall() {
      let expr = this.parsePrimary();
      while (true) {
        if (this.check('OP', '(')) {
          this.pos++;
          const args = [];
          this.skipNewlines();
          if (!this.check('OP', ')')) {
            args.push(this.parseExpression());
            this.skipNewlines();
            while (this.match('OP', ',')) {
              this.skipNewlines();
              args.push(this.parseExpression());
              this.skipNewlines();
            }
          }
          this.expect('OP', ')');
          expr = { type: 'Call', callee: expr, args };
        } else if (this.check('OP', '[')) {
          this.pos++;
          const index = this.parseExpression();
          this.expect('OP', ']');
          expr = { type: 'Index', object: expr, index, line: expr.line };
        } else break;
      }
      return expr;
    }
    parsePrimary() {
      const t = this.peek();
      if (t.type === 'NUMBER' || t.type === 'STRING') {
        this.pos++; return { type: 'Literal', value: t.value, line: t.line };
      }
      if (t.type === 'KEYWORD') {
        if (t.value === 'true') { this.pos++; return { type: 'Literal', value: true, line: t.line }; }
        if (t.value === 'false') { this.pos++; return { type: 'Literal', value: false, line: t.line }; }
        if (t.value === 'null') { this.pos++; return { type: 'Literal', value: null, line: t.line }; }
        if (t.value === 'func') {
          this.pos++;
          const params = this.parseParams();
          const body = this.parseBlock();
          return { type: 'FuncExpr', params, body, line: t.line };
        }
      }
      if (t.type === 'IDENT') { this.pos++; return { type: 'Identifier', name: t.value, line: t.line }; }
      if (this.check('OP', '(')) {
        this.pos++;
        const e = this.parseExpression();
        this.expect('OP', ')');
        return e;
      }
      if (this.check('OP', '[')) {
        this.pos++;
        const elements = [];
        this.skipNewlines();
        if (!this.check('OP', ']')) {
          elements.push(this.parseExpression());
          this.skipNewlines();
          while (this.match('OP', ',')) {
            this.skipNewlines();
            if (this.check('OP', ']')) break;
            elements.push(this.parseExpression());
            this.skipNewlines();
          }
        }
        this.expect('OP', ']');
        return { type: 'ListLiteral', elements, line: t.line };
      }
      throw new Error(`Línea ${t.line}: expresión inesperada '${t.value ?? 'fin de archivo'}'`);
    }
  }

  /* ---------------- ENTORNO ---------------- */
  class Environment {
    constructor(parent = null) { this.vars = new Map(); this.consts = new Set(); this.parent = parent; }
    define(name, value, isConst) {
      if (this.consts.has(name)) throw new Error(`No se puede redeclarar constante '${name}'`);
      this.vars.set(name, value);
      if (isConst) this.consts.add(name);
    }
    get(name) {
      let e = this;
      while (e) { if (e.vars.has(name)) return e.vars.get(name); e = e.parent; }
      throw new Error(`Variable no definida: '${name}'`);
    }
    set(name, value) {
      let e = this;
      while (e) {
        if (e.vars.has(name)) {
          if (e.consts.has(name)) throw new Error(`No se puede reasignar la constante '${name}'`);
          e.vars.set(name, value); return;
        }
        e = e.parent;
      }
      throw new Error(`Variable no definida: '${name}'`);
    }
  }

  class ReturnSignal { constructor(value) { this.value = value; } }

  /* ---------------- INTÉRPRETE ---------------- */
  const interp = {
    output: null,

    execute(ast, out) {
      this.output = out;
      const env = this.makeGlobalEnv();
      for (const stmt of ast.body) this.executeStatement(stmt, env);
    },

    makeGlobalEnv() {
      const env = new Environment();
      const self = this;
      const b = (name, fn) => env.define(name, { __builtin: true, name, fn }, true);

      b('imprimir', (...a) => { self.output(a.map(x => self.stringify(x)).join(' ')); return null; });
      b('print',    (...a) => { self.output(a.map(x => self.stringify(x)).join(' ')); return null; });
      b('longitud', x => (Array.isArray(x) || typeof x === 'string') ? x.length : (() => { throw new Error('longitud() requiere lista o texto'); })());
      b('len',      x => (Array.isArray(x) || typeof x === 'string') ? x.length : (() => { throw new Error('len() requiere lista o texto'); })());

      b('tipo', x => {
        if (x === null || x === undefined) return 'nulo';
        if (typeof x === 'number') return 'numero';
        if (typeof x === 'string') return 'texto';
        if (typeof x === 'boolean') return 'booleano';
        if (Array.isArray(x)) return 'lista';
        return 'funcion';
      });

      b('numero', x => {
        if (typeof x === 'number') return x;
        if (typeof x === 'boolean') return x ? 1 : 0;
        if (typeof x === 'string') { const n = parseFloat(x); return isNaN(n) ? null : n; }
        return null;
      });

      b('texto', x => self.stringify(x));
      b('str',   x => self.stringify(x));

      b('rango', (a, bb) => {
        const r = []; if (a <= bb) for (let i = a; i <= bb; i++) r.push(i);
        else for (let i = a; i >= bb; i--) r.push(i);
        return r;
      });

      b('agregar', (arr, v) => { if (!Array.isArray(arr)) throw new Error('agregar() requiere lista'); arr.push(v); return null; });
      b('quitar',  arr => { if (!Array.isArray(arr)) throw new Error('quitar() requiere lista'); return arr.pop(); });
      b('unir',    (arr, sep) => { if (!Array.isArray(arr)) throw new Error('unir() requiere lista'); return arr.map(x => self.stringify(x)).join(sep ?? ','); });
      b('dividir', (s, sep) => { if (typeof s !== 'string') throw new Error('dividir() requiere texto'); return s.split(sep ?? ''); });
      b('mayusculas', s => String(s).toUpperCase());
      b('minusculas', s => String(s).toLowerCase());
      b('contiene', (x, y) => Array.isArray(x) ? x.includes(y) : (typeof x === 'string' ? x.includes(y) : false));

      b('absoluto', Math.abs);
      b('raiz', Math.sqrt);
      b('potencia', Math.pow);
      b('redondear', Math.round);
      b('piso', Math.floor);
      b('techo', Math.ceil);
      b('aleatorio', Math.random);
      b('minimo', Math.min);
      b('maximo', Math.max);
      b('error', msg => { throw new Error(String(msg)); });

      const aliases = {
        'abs':'absoluto','sqrt':'raiz','pow':'potencia','round':'redondear',
        'floor':'piso','ceil':'techo','random':'aleatorio','min':'minimo','max':'maximo',
        'upper':'mayusculas','lower':'minusculas','append':'agregar','pop':'quitar',
        'join':'unir','split':'dividir','contains':'contiene','type':'tipo',
        'num':'numero','string':'texto','range':'rango','throw':'error'
      };
      for (const [a, t] of Object.entries(aliases)) env.define(a, env.get(t), true);

      return env;
    },

    stringify(v) {
      if (v === null || v === undefined) return 'nulo';
      if (typeof v === 'boolean') return v ? 'verdadero' : 'falso';
      if (typeof v === 'number') return String(v);
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return '[' + v.map(x => typeof x === 'string' ? `"${x}"` : this.stringify(x)).join(', ') + ']';
      if (v instanceof ZenitFunction) return `[función ${v.name}]`;
      if (v.__builtin) return `[función ${v.name}]`;
      return String(v);
    },

    truthy(v) {
      if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    },

    executeStatement(node, env) {
      try {
        switch (node.type) {
          case 'VarDecl': {
            const value = node.init ? this.evaluate(node.init, env) : null;
            env.define(node.name, value, node.isConst);
            return;
          }
          case 'ExprStmt': this.evaluate(node.expr, env); return;
          case 'If': {
            if (this.truthy(this.evaluate(node.cond, env))) this.executeBlock(node.thenBlock, env);
            else if (node.elseBlock) this.executeBlock(node.elseBlock, env);
            return;
          }
          case 'While': {
            let n = 0;
            while (this.truthy(this.evaluate(node.cond, env))) {
              this.executeBlock(node.body, env);
              if (++n > 500000) throw new Error('bucle while: demasiadas iteraciones');
            }
            return;
          }
          case 'For': {
            const it = this.evaluate(node.iterable, env);
            if (!Array.isArray(it) && typeof it !== 'string') {
              throw new Error('for requiere una lista o texto');
            }
            for (const item of it) {
              const loopEnv = new Environment(env);
              loopEnv.define(node.name, item, false);
              this.executeBlock(node.body, loopEnv);
            }
            return;
          }
          case 'FuncDecl': {
            env.define(node.name, new ZenitFunction(node.name, node.params, node.body, env), false);
            return;
          }
          case 'Return': throw new ReturnSignal(node.value ? this.evaluate(node.value, env) : null);
          case 'Block': this.executeBlock(node, env); return;
          default: throw new Error(`Instrucción desconocida: ${node.type}`);
        }
      } catch (e) {
        if (e instanceof ReturnSignal) throw e;
        if (e && !e.__zenitLine && node.line) {
          e.__zenitLine = node.line;
          e.message = `Línea ${node.line}: ${e.message}`;
        }
        throw e;
      }
    },

    executeBlock(node, env) {
      for (const s of node.body) this.executeStatement(s, env);
    },

    evaluate(node, env) {
      switch (node.type) {
        case 'Literal': return node.value;
        case 'Identifier': return env.get(node.name);
        case 'ListLiteral': return node.elements.map(e => this.evaluate(e, env));
        case 'Range': {
          const a = this.evaluate(node.start, env), b = this.evaluate(node.end, env);
          if (typeof a !== 'number' || typeof b !== 'number') throw new Error('el rango requiere números');
          const r = []; if (a <= b) for (let i = a; i <= b; i++) r.push(i);
          else for (let i = a; i >= b; i--) r.push(i);
          return r;
        }
        case 'Binary': {
          const l = this.evaluate(node.left, env);
          const r = this.evaluate(node.right, env);
          switch (node.op) {
            case '+': return (typeof l === 'string' || typeof r === 'string') ? this.stringify(l) + this.stringify(r) : l + r;
            case '-': return l - r;
            case '*': return l * r;
            case '/': if (r === 0) throw new Error('división por cero'); return l / r;
            case '%': return l % r;
            case '**': return Math.pow(l, r);
            case '==': return this.deepEqual(l, r);
            case '!=': return !this.deepEqual(l, r);
            case '<': return l < r;
            case '>': return l > r;
            case '<=': return l <= r;
            case '>=': return l >= r;
            default: throw new Error(`operador desconocido: ${node.op}`);
          }
        }
        case 'Logical': {
          const l = this.evaluate(node.left, env);
          if (node.op === '&&') return this.truthy(l) ? this.evaluate(node.right, env) : l;
          return this.truthy(l) ? l : this.evaluate(node.right, env);
        }
        case 'Unary': {
          const v = this.evaluate(node.operand, env);
          if (node.op === '-') return -v;
          if (node.op === '!') return !this.truthy(v);
          throw new Error(`operador unario desconocido: ${node.op}`);
        }
        case 'Call': {
          const callee = this.evaluate(node.callee, env);
          const args = node.args.map(a => this.evaluate(a, env));
          if (callee && callee.__builtin) return callee.fn(...args);
          if (callee instanceof ZenitFunction) return callee.call(args);
          throw new Error(`no es una función: ${this.stringify(callee)}`);
        }
        case 'Index': {
          const obj = this.evaluate(node.object, env);
          let idx = this.evaluate(node.index, env);
          if (Array.isArray(obj) || typeof obj === 'string') {
            if (typeof idx !== 'number') throw new Error('el índice debe ser numérico');
            if (idx < 0) idx = obj.length + idx;
            if (idx < 0 || idx >= obj.length) throw new Error(`índice fuera de rango (longitud ${obj.length})`);
            return obj[idx];
          }
          throw new Error('solo se pueden indexar listas o textos');
        }
        case 'Assign': {
          const value = this.evaluate(node.value, env);
          if (node.target.type === 'Identifier') {
            const name = node.target.name;
            if (node.op === '=') { env.set(name, value); }
            else {
              const cur = env.get(name);
              let v;
              switch (node.op) {
                case '+=': v = (typeof cur === 'string' || typeof value === 'string') ? this.stringify(cur) + this.stringify(value) : cur + value; break;
                case '-=': v = cur - value; break;
                case '*=': v = cur * value; break;
                case '/=': v = cur / value; break;
              }
              env.set(name, v);
            }
            return value;
          }
          if (node.target.type === 'Index') {
            const obj = this.evaluate(node.target.object, env);
            let idx = this.evaluate(node.target.index, env);
            if (!Array.isArray(obj)) throw new Error('solo se pueden reasignar índices de listas');
            if (idx < 0) idx = obj.length + idx;
            if (node.op === '=') obj[idx] = value;
            else {
              const cur = obj[idx];
              switch (node.op) {
                case '+=': obj[idx] = cur + value; break;
                case '-=': obj[idx] = cur - value; break;
                case '*=': obj[idx] = cur * value; break;
                case '/=': obj[idx] = cur / value; break;
              }
            }
            return value;
          }
          throw new Error('objetivo de asignación inválido');
        }
        case 'FuncExpr': return new ZenitFunction('<anónima>', node.params, node.body, env);
        default: throw new Error(`Expresión desconocida: ${node.type}`);
      }
    },

    deepEqual(a, b) {
      if (a === b) return true;
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!this.deepEqual(a[i], b[i])) return false;
        return true;
      }
      return false;
    }
  };

  class ZenitFunction {
    constructor(name, params, body, closure) {
      this.name = name; this.params = params; this.body = body; this.closure = closure;
    }
    call(args) {
      if (args.length !== this.params.length) {
        throw new Error(`la función '${this.name}' espera ${this.params.length} argumentos, recibió ${args.length}`);
      }
      const env = new Environment(this.closure);
      for (let i = 0; i < this.params.length; i++) env.define(this.params[i], args[i], false);
      try { interp.executeBlock(this.body, env); }
      catch (e) { if (e instanceof ReturnSignal) return e.value; throw e; }
      return null;
    }
  }

  /* ---------------- API PÚBLICA ---------------- */
  return {
    ejecutar(src, opts = {}) {
      const out = opts.output || (s => console.log(s));
      try {
        const tokens = tokenize(src);
        const ast = new Parser(tokens).parseProgram();
        interp.execute(ast, out);
      } catch (e) {
        if (e instanceof ReturnSignal) throw new Error('return fuera de función');
        throw e;
      }
    },
    ejecutarYObtener(src) {
      const lines = [];
      this.ejecutar(src, { output: s => lines.push(s) });
      return lines.join('\n');
    }
  };
})();

// Permite usar Zenit desde otras páginas web.
if (typeof window !== "undefined") window.Zenit = Zenit;
if (typeof globalThis !== "undefined") globalThis.Zenit = Zenit;
