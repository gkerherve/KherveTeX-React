"""Port khervedoc/example_docs/*.py to src/core/exampleDocs/*.ts.

The example documents are some 9 000 lines of model constructors and long
string literals. Translating them by machine keeps every string exactly as
Python has it (escapes, implicit concatenation, raw strings) and keeps each
module's functions, order and comments, so the TypeScript diffs against
the Python side by side. The few functions that compute with dates live as
hand-written TypeScript in MANUAL below.

    python3 scripts/port_examples.py [path/to/KherveTeX]

tests/examples.parity.test.ts checks the result against Python's own
documents (scripts/make_golden_examples.py).
"""
from __future__ import annotations

import ast
import dataclasses
import io
import re
import sys
import tokenize
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "KherveTeX"
sys.path.insert(0, str(SRC))

from khervedoc import model  # noqa: E402

OUT = HERE / "src" / "core" / "exampleDocs"
DOCS = SRC / "khervedoc" / "example_docs"

MODULES = ["start", "journals", "journal_classes", "book_classes", "thesis_classes",
           "letters", "long_form", "planning", "science", "teaching"]

MODEL_CLASSES = {
    n: [f.name for f in dataclasses.fields(getattr(model, n)) if f.init and f.name != "type"]
    for n in ["Text", "MathInline", "Link", "Footnote", "Citation", "CrossRef", "InlineRaw",
              "Highlight", "Comment", "Paragraph", "Section", "MathBlock", "ListItem", "List",
              "Figure", "Table", "RawLatex", "Title", "Author", "Affiliation", "Correspondence",
              "Abstract", "Keywords", "Frame", "Theorem", "Document", "DocMeta"]
}
MODEL_CONSTS = {"DEFAULT_PACKAGES"}
HELPERS = {"_meta", "_p", "_items", "_ord_items"}
RUNTIME = {"range", "enumerate", "pyLen", "pySum", "pyAdd", "pyRepeat", "pyIn", "pySplit"}
PY_TS = {"strip", "pyFixed", "pyRound", "pyRe", "reMatch", "truthy", "zpad"}

TS_RESERVED = {"function", "new", "default", "case", "var", "class", "delete", "switch",
               "this", "void", "with", "enum", "export", "extends", "super", "typeof",
               "instanceof", "let", "const", "interface", "package", "private",
               "protected", "public", "static", "yield", "await", "arguments", "eval"}


def camel(name: str) -> str:
    if name.upper() == name:
        return name
    lead = len(name) - len(name.lstrip("_"))
    parts = name[lead:].split("_")
    out = "_" * lead + parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])
    return out + "_" if out in TS_RESERVED else out


def ts_str(s: str) -> str:
    out = []
    for ch in s:
        o = ord(ch)
        if ch == "\\":
            out.append("\\\\")
        elif ch == "'":
            out.append("\\'")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\t":
            out.append("\\t")
        elif ch == "\r":
            out.append("\\r")
        elif o < 0x20 or o in (0x2028, 0x2029, 0x7f) or 0xd800 <= o <= 0xdfff:
            out.append(f"\\u{o:04x}")
        else:
            out.append(ch)
    return "'" + "".join(out) + "'"


def ts_tpl(s: str) -> str:
    out = []
    for ch in s:
        o = ord(ch)
        if ch == "\\":
            out.append("\\\\")
        elif ch == "`":
            out.append("\\`")
        elif ch == "$":
            out.append("\\$")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\t":
            out.append("\\t")
        elif o < 0x20 or o in (0x2028, 0x2029, 0x7f):
            out.append(f"\\u{o:04x}")
        else:
            out.append(ch)
    return "".join(out)


@dataclasses.dataclass
class Sig:
    params: list[str]          # positional-or-keyword
    defaults: dict             # name -> ast default
    vararg: str | None
    kwonly: list[str]
    kwonly_defaults: dict
    kwarg: str | None
    module: str


def signature(fn: ast.FunctionDef | ast.Lambda, module: str) -> Sig:
    a = fn.args
    params = [x.arg for x in a.args]
    defaults = dict(zip(params[len(params) - len(a.defaults):], a.defaults))
    kwd = {x.arg: d for x, d in zip(a.kwonlyargs, a.kw_defaults) if d is not None}
    return Sig(params, defaults, a.vararg.arg if a.vararg else None,
               [x.arg for x in a.kwonlyargs], kwd, a.kwarg.arg if a.kwarg else None, module)


class Unsupported(Exception):
    pass


WIDTH = 92


def hang(s: str) -> str:
    """Continuation lines of a statement's value sit two spaces in, unless
    the value opens a bracket on its first line."""
    first, _, rest = s.partition("\n")
    if not rest or first.rstrip()[-1:] in "([{":
        return s
    return first + "\n" + indent(rest)


def indent(s: str, n: int = 2) -> str:
    pad = " " * n
    return "\n".join(pad + line if line else line for line in s.split("\n"))


class Module:
    def __init__(self, name: str, sigs: dict[str, Sig]):
        self.mod = name
        self.path = DOCS / f"{name}.py"
        self.src = self.path.read_text(encoding="utf-8")
        self.lines = self.src.split("\n")
        self.tree = ast.parse(self.src)
        self.sigs = sigs
        self.imports: dict[str, str] = {}   # python name -> source module
        self.used: dict[str, set[str]] = {}  # ts module path -> names
        self.comments: dict[int, str] = {}
        self.trailing: dict[int, str] = {}
        toks = tokenize.generate_tokens(io.StringIO(self.src).readline)
        for t in toks:
            if t.type == tokenize.COMMENT:
                line = self.lines[t.start[0] - 1]
                if line.strip().startswith("#"):
                    self.comments[t.start[0]] = t.string
                else:
                    self.trailing[t.start[0]] = t.string
        self.locals_stack: list[set[str]] = []
        self.nested: dict[str, Sig] = {}
        self.types: dict[str, set[str]] = {}
        self.str_names: set[str] = set()
        self.num_names: set[str] = set()

    # ---------------------------------------------------------------- utils

    def use_type(self, mod: str, name: str) -> str:
        self.types.setdefault(mod, set()).add(name)
        return name

    def use(self, mod: str, name: str) -> str:
        self.used.setdefault(mod, set()).add(name)
        return name

    def comments_between(self, a: int, b: int, depth_ok=True) -> list[str]:
        out = []
        for ln in range(a + 1, b):
            if ln in self.comments:
                out.append("//" + self.comments[ln][1:])
        return out

    def name(self, n: str) -> str:
        if self.locals_stack and any(n in s for s in self.locals_stack):
            return camel(n)
        if n in MODEL_CLASSES or n == "ListNode":
            return self.use("../exampleHelpers.ts", n)
        if n in MODEL_CONSTS:
            return self.use("../exampleHelpers.ts", n)
        if n in self.imports:
            src = self.imports[n]
            if src == "helpers":
                return self.use("../exampleHelpers.ts", camel(n))
            if src == "model":
                return self.use("../exampleHelpers.ts", n)
            return self.use(f"./{camel(src)}.ts", camel(n))
        if n == "None":
            return "null"
        if n == "True":
            return "true"
        if n == "False":
            return "false"
        return camel(n)

    # ---------------------------------------------------------- expressions

    def is_str(self, e) -> bool:
        if isinstance(e, ast.Constant) and isinstance(e.value, str):
            return True
        if isinstance(e, ast.JoinedStr):
            return True
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.Add):
            return self.is_str(e.left) or self.is_str(e.right)
        if isinstance(e, ast.Call) and isinstance(e.func, ast.Attribute) and e.func.attr in ("join", "strip", "upper", "lower", "replace"):
            return True
        if isinstance(e, ast.Name) and e.id in getattr(self, "str_names", set()):
            return True
        return False

    def is_list(self, e) -> bool:
        if isinstance(e, (ast.List, ast.ListComp)):
            return True
        if isinstance(e, ast.Name) and e.id in ("DEFAULT_PACKAGES",):
            return True
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.Add):
            return self.is_list(e.left) or self.is_list(e.right)
        if isinstance(e, ast.Call) and isinstance(e.func, ast.Name) and e.func.id in ("_no_amsmath", "list", "_article_body"):
            return True
        return False

    def is_bool(self, e) -> bool:
        if isinstance(e, ast.Compare):
            return True
        if isinstance(e, ast.Constant) and isinstance(e.value, bool):
            return True
        if isinstance(e, ast.Call) and isinstance(e.func, ast.Name) and e.func.id == "isinstance":
            return True
        if isinstance(e, ast.UnaryOp) and isinstance(e.op, ast.Not):
            return True
        if isinstance(e, ast.BoolOp):
            return all(self.is_bool(v) for v in e.values)
        if isinstance(e, ast.Call) and isinstance(e.func, ast.Attribute) and e.func.attr in ("startswith", "endswith"):
            return True
        if isinstance(e, ast.Call) and isinstance(e.func, ast.Attribute) and isinstance(e.func.value, ast.Name) and e.func.value.id == "re":
            return False
        return False

    def test(self, e) -> str:
        if isinstance(e, ast.BoolOp):
            sym = " && " if isinstance(e.op, ast.And) else " || "
            return sym.join(f"({self.test(v)})" if isinstance(v, ast.BoolOp) else self.test(v) for v in e.values)
        if self.is_bool(e):
            return self.expr(e)
        if isinstance(e, ast.Call) and isinstance(e.func, ast.Attribute) and isinstance(e.func.value, ast.Name) and e.func.value.id == "re":
            return self.expr(e) + " !== null"
        return f"{self.use('../py.ts', 'truthy')}({self.expr(e)})"

    def atom(self, e) -> str:
        s = self.expr(e)
        if isinstance(e, (ast.BinOp, ast.BoolOp, ast.Compare, ast.IfExp, ast.UnaryOp, ast.Lambda)):
            return f"({s})"
        return s

    def seq(self, open_: str, close: str, items: list[tuple[int | None, str]], end_line: int | None = None,
            force_break=False) -> str:
        """Lay out a bracketed list: one line when it fits and carries no
        comments, else one element per line with the comments above it."""
        flat = ", ".join(s for _, s in items)
        has_comments = False
        rendered = []
        prev = None
        for ln, s in items:
            cs = []
            if ln is not None and prev is not None:
                cs = self.comments_between(prev, ln)
            if cs:
                has_comments = True
            rendered.append((cs, s))
            if ln is not None:
                prev = ln
        if len(items) == 1 and not has_comments and items[0][1][:1] in "{[" and open_ in "([":
            return open_ + items[0][1] + close
        if not force_break and not has_comments and "\n" not in flat and len(flat) + 4 <= WIDTH:
            if open_ == "{" and flat:
                return "{ " + flat + " }"
            return open_ + flat + close
        body = []
        for cs, s in rendered:
            body.extend(cs)
            body.append(s + ",")
        return open_ + "\n" + indent("\n".join(body)) + "\n" + close

    def elem_line(self, e) -> int | None:
        return getattr(e, "lineno", None)

    def string_const(self, e: ast.Constant) -> str:
        seg = ast.get_source_segment(self.src, e)
        if seg is None:
            return ts_str(e.value)
        pieces = []
        try:
            for t in tokenize.generate_tokens(io.StringIO(seg).readline):
                if t.type == tokenize.STRING:
                    pieces.append(ast.literal_eval(t.string))
        except (tokenize.TokenError, SyntaxError):
            return ts_str(e.value)
        if "".join(pieces) != e.value or len(pieces) <= 1:
            return ts_str(e.value)
        lits = [ts_str(p) for p in pieces if p != ""] or ["''"]
        if len(lits) == 1:
            return lits[0]
        return (" +\n").join(lits)

    def fstring(self, e: ast.JoinedStr) -> str:
        out = []
        for v in e.values:
            if isinstance(v, ast.Constant):
                out.append(ts_tpl(v.value))
            else:
                assert isinstance(v, ast.FormattedValue)
                inner = self.expr(v.value)
                if v.conversion != -1:
                    raise Unsupported("f-string conversion")
                if v.format_spec is None:
                    out.append("${" + inner + "}")
                else:
                    spec = "".join(c.value for c in v.format_spec.values if isinstance(c, ast.Constant))
                    m = re.fullmatch(r"\.(\d+)f", spec)
                    if m:
                        out.append("${" + f"{self.use('../py.ts', 'pyFixed')}({inner}, {m.group(1)})" + "}")
                    elif spec == "g":
                        out.append("${" + f"{self.use('./runtime.ts', 'pyFormatG')}({inner})" + "}")
                    elif re.fullmatch(r"0(\d+)d", spec):
                        out.append("${" + f"{self.use('../py.ts', 'zpad')}({inner}, {spec[1:-1]})" + "}")
                    else:
                        raise Unsupported(f"format spec {spec}")
        return "`" + "".join(out) + "`"

    def expr(self, e) -> str:
        m = getattr(self, "x_" + type(e).__name__, None)
        if m is None:
            raise Unsupported(f"{type(e).__name__} at line {getattr(e, 'lineno', '?')}: {ast.unparse(e)[:80]}")
        return m(e)

    def x_Constant(self, e):
        v = e.value
        if isinstance(v, bool):
            return "true" if v else "false"
        if v is None:
            return "null"
        if isinstance(v, str):
            return self.string_const(e)
        if isinstance(v, (int, float)):
            return repr(v)
        raise Unsupported(repr(v))

    def x_JoinedStr(self, e):
        return self.fstring(e)

    def x_Name(self, e):
        return self.name(e.id)

    def x_List(self, e):
        return self.seq("[", "]", [(self.elem_line(x), self.expr(x)) for x in e.elts])

    def x_Tuple(self, e):
        s = self.x_List(e)
        if e.elts and all(isinstance(x, (ast.Constant, ast.UnaryOp)) for x in e.elts):
            return s + " as const"
        return s

    def x_Starred(self, e):
        return "..." + self.spread(e.value)

    def spread(self, e) -> str:
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.Add) and self.is_list(e):
            return self.expr(e)
        if isinstance(e, ast.BinOp) and isinstance(e.op, ast.Mult) and isinstance(e.left, ast.List):
            return self.expr(e)
        return self.atom(e)

    def x_Dict(self, e):
        items = []
        for k, v in zip(e.keys, e.values):
            if k is None:
                items.append((self.elem_line(v), "..." + self.atom(v)))
            elif isinstance(k, ast.Constant) and isinstance(k.value, str):
                key = k.value if re.fullmatch(r"[A-Za-z_$][\w$]*", k.value) else ts_str(k.value)
                items.append((self.elem_line(k), f"{key}: {self.expr(v)}"))
            else:
                items.append((self.elem_line(k), f"[{self.expr(k)}]: {self.expr(v)}"))
        if not items:
            return "{}"
        return self.seq("{", "}", items)

    def x_Attribute(self, e):
        if isinstance(e.value, ast.Name) and e.value.id == "math":
            return "Math." + {"pi": "PI", "e": "E"}.get(e.attr, e.attr)
        return f"{self.atom(e.value)}.{e.attr}"

    def x_Subscript(self, e):
        v = self.atom(e.value)
        s = e.slice
        if isinstance(s, ast.Slice):
            if s.step is not None:
                raise Unsupported("slice step")
            lo = self.expr(s.lower) if s.lower else "0"
            return f"{v}.slice({lo}{', ' + self.expr(s.upper) if s.upper else ''})"
        if isinstance(s, ast.UnaryOp) and isinstance(s.op, ast.USub):
            return f"{v}.at({self.expr(s)})"
        return f"{v}[{self.expr(s)}]"

    def x_UnaryOp(self, e):
        if isinstance(e.op, ast.USub):
            return "-" + self.atom(e.operand)
        if isinstance(e.op, ast.UAdd):
            return "+" + self.atom(e.operand)
        if isinstance(e.op, ast.Not):
            return "!" + (self.atom(e.operand) if self.is_bool(e.operand) else self.test(e.operand))
        raise Unsupported("unary")

    def x_BinOp(self, e):
        op = e.op
        if isinstance(op, ast.Add):
            if self.is_list(e.left) or self.is_list(e.right):
                parts = []

                def flatten(side):
                    if isinstance(side, ast.List):
                        for x in side.elts:
                            if isinstance(x, ast.Starred):
                                parts.append((self.elem_line(x), "..." + self.spread(x.value)))
                            else:
                                parts.append((self.elem_line(x), self.expr(x)))
                    elif isinstance(side, ast.BinOp) and isinstance(side.op, ast.Add) and self.is_list(side):
                        flatten(side.left)
                        flatten(side.right)
                    else:
                        parts.append((self.elem_line(side), "..." + self.spread(side)))
                flatten(e.left)
                flatten(e.right)
                return self.seq("[", "]", parts)
            if self.is_str(e.left) or self.is_str(e.right):
                left = self.expr(e.left) if isinstance(e.left, ast.BinOp) and isinstance(e.left.op, ast.Add) else self.atom(e.left)
                right = self.atom(e.right)
                joiner = " +\n" if ("\n" in left or "\n" in right or len(left) + len(right) > WIDTH) else " + "
                return left + joiner + right
            if self.is_num(e.left) or self.is_num(e.right):
                return f"{self.atom(e.left)} + {self.atom(e.right)}"
            return f"{self.use('./runtime.ts', 'pyAdd')}({self.expr(e.left)}, {self.expr(e.right)})"
        if isinstance(op, ast.Mult):
            if isinstance(e.left, ast.List):
                return f"{self.use('./runtime.ts', 'pyRepeat')}({self.expr(e.left)}, {self.expr(e.right)})"
            if self.is_str(e.left):
                return f"{self.atom(e.left)}.repeat({self.expr(e.right)})"
            return f"{self.atom(e.left)} * {self.atom(e.right)}"
        sym = {ast.Sub: "-", ast.Div: "/", ast.Pow: "**"}.get(type(op))
        if sym is None:
            raise Unsupported(f"binop {type(op).__name__}")
        return f"{self.atom(e.left)} {sym} {self.atom(e.right)}"

    def is_num(self, e) -> bool:
        if isinstance(e, ast.Constant) and isinstance(e.value, (int, float)) and not isinstance(e.value, bool):
            return True
        if isinstance(e, ast.BinOp) and not isinstance(e.op, ast.Add):
            return not isinstance(e.op, ast.Mult) or not (self.is_list(e.left) or self.is_str(e.left))
        if isinstance(e, ast.BinOp):
            return self.is_num(e.left) or self.is_num(e.right)
        if isinstance(e, ast.UnaryOp) and isinstance(e.op, ast.USub):
            return True
        if isinstance(e, ast.Name) and e.id in getattr(self, "num_names", set()):
            return True
        if isinstance(e, ast.Call) and isinstance(e.func, ast.Attribute) and isinstance(e.func.value, ast.Name) and e.func.value.id == "math":
            return True
        return False

    def x_Compare(self, e):
        parts = []
        left = e.left
        for op, right in zip(e.ops, e.comparators):
            a, b = self.atom(left), self.atom(right)
            if isinstance(op, ast.Is):
                parts.append(f"{a} == {b}" if b == "null" else f"{a} === {b}")
            elif isinstance(op, ast.IsNot):
                parts.append(f"{a} != {b}" if b == "null" else f"{a} !== {b}")
            elif isinstance(op, ast.In):
                parts.append(f"{self.use('./runtime.ts', 'pyIn')}({self.expr(left)}, {self.expr(right)})")
            elif isinstance(op, ast.NotIn):
                parts.append(f"!{self.use('./runtime.ts', 'pyIn')}({self.expr(left)}, {self.expr(right)})")
            else:
                sym = {ast.Eq: "===", ast.NotEq: "!==", ast.Lt: "<", ast.LtE: "<=",
                       ast.Gt: ">", ast.GtE: ">="}[type(op)]
                parts.append(f"{a} {sym} {b}")
            left = right
        return " && ".join(parts)

    def x_BoolOp(self, e):
        if not all(self.is_bool(v) for v in e.values):
            raise Unsupported("non-boolean and/or")
        sym = " && " if isinstance(e.op, ast.And) else " || "
        return sym.join(self.atom(v) for v in e.values)

    def x_IfExp(self, e):
        return f"{self.test(e.test)} ? {self.atom(e.body)} : {self.atom(e.orelse)}"

    def x_Lambda(self, e):
        self.locals_stack.append({a.arg for a in e.args.args})
        try:
            params = ", ".join(camel(a.arg) + ": any" for a in e.args.args)
            return f"({params}) => {self.atom(e.body) if isinstance(e.body, ast.Dict) else self.expr(e.body)}"
        finally:
            self.locals_stack.pop()

    def target(self, t) -> str:
        if isinstance(t, ast.Name):
            return camel(t.id)
        if isinstance(t, (ast.Tuple, ast.List)):
            return "[" + ", ".join(self.target(x) for x in t.elts) + "]"
        raise Unsupported("target")

    def names_in_target(self, t) -> set[str]:
        if isinstance(t, ast.Name):
            return {t.id}
        if isinstance(t, (ast.Tuple, ast.List)):
            return set().union(*(self.names_in_target(x) for x in t.elts))
        return set()

    def iterable(self, e) -> str:
        return self.expr(e)

    def comprehension(self, elt_fn, gens) -> str:
        """[elt for t in it if c ...] as map/filter/flatMap."""
        g = gens[0]
        if g.is_async:
            raise Unsupported("async")
        names = self.names_in_target(g.target)
        self.locals_stack.append(names)
        try:
            src = self.iterable(g.iter)
            tgt = self.target(g.target) + ": any"
            if isinstance(g.target, ast.Name) and g.target.id == "_":
                tgt = ""
            for cond in g.ifs:
                src = f"{self.atom_src(src)}.filter(({tgt}) => {self.test(cond)})"
            if len(gens) > 1:
                inner = self.comprehension(elt_fn, gens[1:])
                return f"{self.atom_src(src)}.flatMap(({tgt}) => {inner})"
            return f"{self.atom_src(src)}.map(({tgt}) => {elt_fn()})"
        finally:
            self.locals_stack.pop()

    def atom_src(self, s: str) -> str:
        return s if re.fullmatch(r"[\w.$]+(\(.*\))?|\[.*\]", s, re.S) else f"({s})"

    def x_ListComp(self, e):
        return self.comprehension(lambda: self.atom(e.elt) if isinstance(e.elt, ast.Dict) else self.expr(e.elt),
                                  e.generators)

    x_GeneratorExp = x_ListComp

    def x_DictComp(self, e):
        return "Object.fromEntries(" + self.comprehension(
            lambda: f"[{self.expr(e.key)}, {self.expr(e.value)}]", e.generators) + ")"

    # ---------------------------------------------------------------- calls

    def x_Call(self, e):
        f = e.func
        if isinstance(f, ast.Name):
            n = f.id
            local = self.locals_stack and any(n in s for s in self.locals_stack)
            if not local and (n in MODEL_CLASSES or (n in self.imports and self.imports[n] == "model" and n not in MODEL_CONSTS)):
                cls = "List" if n == "ListNode" else n
                return self.model_call(n, cls, e)
            if n in self.nested:
                return self.user_call(n, self.nested[n], e)
            if not local and n in self.sigs_for():
                return self.user_call(n, self.sigs_for()[n], e)
            if not local:
                b = self.builtin(n, e)
                if b is not None:
                    return b
            if e.keywords:
                raise Unsupported(f"kwargs to {n}")
            return f"{self.name(n)}({', '.join(self.expr(a) for a in e.args)})"
        if isinstance(f, ast.Attribute):
            return self.method(f, e)
        raise Unsupported("call")

    def sigs_for(self) -> dict[str, Sig]:
        out = {}
        for k, s in self.sigs.items():
            mod, name = k
            if mod == self.mod and name in self.local_defs:
                out[name] = s
            elif name in self.imports and self.imports[name] == mod:
                out[name] = s
            elif mod == "helpers" and name in self.imports and self.imports[name] == "helpers":
                out[name] = s
        return out

    def model_call(self, pyname: str, cls: str, e) -> str:
        fields = MODEL_CLASSES[cls]
        items = []
        for i, a in enumerate(e.args):
            if isinstance(a, ast.Starred):
                raise Unsupported("starred model arg")
            v = self.expr(a)
            items.append((self.elem_line(a), fields[i] if v == fields[i] else f"{fields[i]}: {v}"))
        for k in e.keywords:
            if k.arg is None:
                items.append((self.elem_line(k.value), "..." + self.atom(k.value)))
            else:
                if k.arg not in fields:
                    raise Unsupported(f"{cls} has no {k.arg}")
                v = self.expr(k.value)
                items.append((self.elem_line(k), k.arg if v == k.arg else f"{k.arg}: {v}"))
        return f"{self.name(pyname)}(" + (self.seq("{", "}", items) if items else "") + ")"

    def user_call(self, n: str, sig: Sig, e) -> str:
        pos: list[str | None] = [None] * len(sig.params)
        var: list[tuple[int | None, str]] = []
        opts: list[tuple[int | None, str]] = []
        kw: list[tuple[int | None, str]] = []
        i = 0
        for a in e.args:
            if isinstance(a, ast.Starred):
                if sig.vararg is None:
                    raise Unsupported("star into non-vararg")
                var.append((self.elem_line(a), "..." + self.atom(a.value)))
                continue
            if i < len(sig.params):
                pos[i] = self.expr(a)
                i += 1
            elif sig.vararg:
                var.append((self.elem_line(a), self.expr(a)))
            else:
                raise Unsupported(f"too many args to {n}")
        for k in e.keywords:
            if k.arg is None:
                if not sig.kwarg:
                    raise Unsupported("** into no-kwarg")
                kw.append((self.elem_line(k.value), "..." + self.atom(k.value)))
            elif k.arg in sig.params:
                pos[sig.params.index(k.arg)] = self.expr(k.value)
            elif k.arg in sig.kwonly:
                opts.append((self.elem_line(k), f"{camel(k.arg)}: {self.expr(k.value)}"))
            elif sig.kwarg:
                kw.append((self.elem_line(k), f"{k.arg}: {self.expr(k.value)}"))
            else:
                raise Unsupported(f"{n} has no {k.arg}")
        while pos and pos[-1] is None:
            pos.pop()
        args: list[tuple[int | None, str]] = [(None, p if p is not None else "undefined") for p in pos]
        need_opts = sig.kwonly and (opts or var or sig.kwarg)
        if sig.kwonly and sig.vararg:
            args += [(None, "undefined")] * (len(sig.params) - len(pos))
            args.append((None, self.seq("{", "}", opts) if opts else "{}"))
        elif sig.kwonly and opts:
            args.append((None, self.seq("{", "}", opts)))
        del need_opts
        if sig.kwarg and (kw or var):
            if not (sig.kwonly and sig.vararg):
                args += [(None, "undefined")] * (len(sig.params) - len(pos))
            args.append((None, self.seq("{", "}", kw) if kw else "{}"))
        if var:
            args += var
        # Line numbers on positional args so comments between them survive.
        lines = []
        for (ln, s) in args:
            lines.append((ln, s))
        fn = self.name(n)
        positional_src = [a for a in e.args]
        if not var and positional_src and len(args) == len(pos):
            lines = [(self.elem_line(a) if j < len(positional_src) else None, s)
                     for j, (_, s) in enumerate(args) for a in [positional_src[min(j, len(positional_src) - 1)]]]
        return fn + self.seq("(", ")", lines)

    def builtin(self, n: str, e) -> str | None:
        args = e.args
        if n == "len":
            return f"{self.use('./runtime.ts', 'pyLen')}({self.expr(args[0])})"
        if n == "range":
            return f"{self.use('./runtime.ts', 'range')}({', '.join(self.expr(a) for a in args)})"
        if n == "enumerate":
            return f"{self.use('./runtime.ts', 'enumerate')}({self.expr(args[0])})"
        if n == "sum":
            return f"{self.use('./runtime.ts', 'pySum')}({self.expr(args[0])})"
        if n in ("min", "max") and len(args) > 1:
            return f"Math.{n}({', '.join(self.expr(a) for a in args)})"
        if n == "str":
            return f"String({self.expr(args[0])})"
        if n == "list":
            return f"[...{self.atom(args[0])}]"
        if n == "round":
            return f"{self.use('../py.ts', 'pyRound')}({', '.join(self.expr(a) for a in args)})"
        if n == "isinstance":
            v = self.atom(args[0])
            t = args[1]
            if isinstance(t, ast.Name):
                if t.id == "str":
                    return f"typeof {v} === 'string'"
                if t.id == "tuple":
                    return f"Array.isArray({v})"
                if t.id in MODEL_CLASSES:
                    return f"{v}.type === '{t.id}'"
            raise Unsupported(f"isinstance {ast.unparse(t)}")
        if n == "import_body_fragment":
            return f"{self.use('../importers.ts', 'importBodyFragment')}({self.expr(args[0])})"
        return None

    def method(self, f: ast.Attribute, e) -> str:
        obj = f.value
        a = [self.expr(x) for x in e.args]
        if e.keywords:
            raise Unsupported(f"kwargs to .{f.attr}")
        if isinstance(obj, ast.Name) and obj.id == "math":
            return f"Math.{f.attr}({', '.join(a)})"
        if isinstance(obj, ast.Name) and obj.id == "re" and f.attr == "match":
            return f"{self.use('../py.ts', 'reMatch')}({self.use('../py.ts', 'pyRe')}({a[0]}), {a[1]})"
        o = self.atom(obj)
        if f.attr == "join":
            return f"{self.atom_src(a[0])}.join({o})"
        if f.attr == "append":
            return f"{o}.push({a[0]})"
        if f.attr == "extend":
            return f"{o}.push(...{a[0]})"
        if f.attr == "split" and len(a) == 2:
            return f"{self.use('./runtime.ts', 'pySplit')}({o}, {a[0]}, {a[1]})"
        if f.attr == "strip" and not a:
            return f"{self.use('../py.ts', 'strip')}({o})"
        if f.attr == "setdefault":
            return f"{self.use('./runtime.ts', 'pySetdefault')}({o}, {', '.join(a)})"
        if f.attr == "update":
            return f"Object.assign({o}, {a[0]})"
        if f.attr in ("replace", "startsWith", "endsWith"):
            return f"{o}.{'replaceAll' if f.attr == 'replace' else f.attr}({', '.join(a)})"
        raise Unsupported(f"method .{f.attr}")

    # ----------------------------------------------------------- statements

    def assigned_names(self, body) -> dict[str, int]:
        counts: dict[str, int] = {}

        def visit(stmts, top):
            for s in stmts:
                if isinstance(s, ast.Assign):
                    for t in s.targets:
                        for n in self.names_in_target(t):
                            counts[n] = counts.get(n, 0) + (1 if top else 2)
                elif isinstance(s, ast.AugAssign):
                    for n in self.names_in_target(s.target):
                        counts[n] = counts.get(n, 0) + 2
                elif isinstance(s, ast.For):
                    visit(s.body, False)
                elif isinstance(s, ast.If):
                    visit(s.body, False)
                    visit(s.orelse, False)
        visit(body, True)
        return counts

    def stmts(self, body, declared: set[str], counts: dict[str, int], prev_line: int) -> list[str]:
        out = []
        for s in body:
            out.extend(self.comments_between(prev_line, s.lineno))
            out.extend(self.stmt(s, declared, counts))
            prev_line = s.end_lineno
        return out

    def stmt(self, s, declared, counts) -> list[str]:
        if isinstance(s, ast.Expr):
            if isinstance(s.value, ast.Constant) and isinstance(s.value.value, str):
                return []
            return [self.expr(s.value)]
        if isinstance(s, ast.Return):
            if s.value is None:
                return ["return"]
            v = self.expr(s.value)
            if isinstance(s.value, ast.Tuple):
                pass
            return ["return " + hang(v)]
        if isinstance(s, (ast.Import, ast.ImportFrom)):
            self.collect_import(s)
            return []
        if isinstance(s, ast.Assign):
            if len(s.targets) != 1:
                raise Unsupported("multi-assign")
            t = s.targets[0]
            if isinstance(t, ast.Attribute):
                return [f"{self.expr(t)} = {self.expr(s.value)}"]
            names = self.names_in_target(t)
            self.locals_stack[-1].update(names)
            snapshot = {k: set(v) for k, v in self.used.items()}
            v = self.expr(s.value)
            tgt = self.target(t)
            if isinstance(t, ast.Name) and not self.is_used(t.id, s):
                self.used = snapshot
                return [f"// {t.id} is never used: {hang(v).split(chr(10))[0]}"]
            if names <= declared:
                return [f"{tgt} = {hang(v)}"]
            new = names - declared
            declared.update(names)
            kw = "const" if all(counts.get(n, 0) <= 1 for n in new) and new == names else "let"
            return [f"{kw} {tgt} = {hang(v)}"]
        if isinstance(s, ast.AugAssign):
            sym = {ast.Add: "+=", ast.Sub: "-=", ast.Mult: "*="}[type(s.op)]
            return [f"{self.expr(s.target)} {sym} {self.expr(s.value)}"]
        if isinstance(s, ast.For):
            names = self.names_in_target(s.target)
            self.locals_stack[-1].update(names)
            reassigned = any(counts.get(n, 0) > 0 for n in names)
            kw = "let" if reassigned else "const"
            inner_declared = set(declared) | names
            body = self.stmts(s.body, inner_declared, counts, s.lineno)
            if s.orelse:
                raise Unsupported("for-else")
            tgt = self.target(s.target)
            if isinstance(s.target, ast.Tuple):
                used = [x.id if self.is_used(x.id, s) else "" for x in s.target.elts]
                while used and not used[-1]:
                    used.pop()
                tgt = "[" + ", ".join(camel(x) if x else "" for x in used) + "]"
            return [f"for ({kw} {tgt} of {self.iterable(s.iter)}) {{"] + \
                [indent(x) for x in body] + ["}"]
        if isinstance(s, ast.If):
            out = [f"if ({self.test(s.test)}) {{"]
            out += [indent(x) for x in self.stmts(s.body, set(declared), counts, s.lineno)]
            orelse = s.orelse
            while orelse:
                if len(orelse) == 1 and isinstance(orelse[0], ast.If):
                    o = orelse[0]
                    out.append(f"}} else if ({self.test(o.test)}) {{")
                    out += [indent(x) for x in self.stmts(o.body, set(declared), counts, o.lineno)]
                    orelse = o.orelse
                else:
                    out.append("} else {")
                    out += [indent(x) for x in self.stmts(orelse, set(declared), counts, orelse[0].lineno - 1)]
                    orelse = []
            out.append("}")
            return out
        if isinstance(s, ast.FunctionDef):
            sig = signature(s, self.mod)
            self.nested[s.name] = sig
            self.locals_stack[-1].add(s.name)
            saved = (self.str_names, self.num_names, self.cur_fn)
            lines = self.function_body(s, sig)
            self.str_names, self.num_names, self.cur_fn = saved
            return lines
        raise Unsupported(f"statement {type(s).__name__} at {s.lineno}")

    def is_used(self, name: str, at) -> bool:
        for n in ast.walk(self.cur_fn):
            if isinstance(n, ast.Name) and n.id == name and isinstance(n.ctx, ast.Load):
                return True
        return False

    def docstring(self, node) -> list[str]:
        d = ast.get_docstring(node)
        if not d:
            return []
        return ["// " + line if line else "//" for line in d.split("\n")]

    def ts_type(self, ann) -> str:
        if ann is None:
            return "any"
        if isinstance(ann, ast.Name):
            return {"str": "string", "int": "number", "float": "number", "bool": "boolean"}.get(ann.id, "any")
        if isinstance(ann, ast.BinOp) and isinstance(ann.op, ast.BitOr):
            parts = [self.ts_type(ann.left), self.ts_type(ann.right)]
            if "any" in parts:
                return "any"
            return " | ".join(parts)
        if isinstance(ann, ast.Constant) and ann.value is None:
            return "null"
        return "any"

    def ts_params(self, fn: ast.FunctionDef, sig: Sig) -> str:
        out = []
        anns = {a.arg: a.annotation for a in fn.args.args + fn.args.kwonlyargs}
        for p in sig.params:
            t = self.ts_type(anns.get(p))
            if p in sig.defaults:
                out.append(f"{camel(p)}: {t} = {self.expr(sig.defaults[p])}")
            else:
                out.append(f"{camel(p)}: {t}")
        if sig.kwonly:
            inner = ", ".join(
                f"{camel(k)} = {self.expr(sig.kwonly_defaults[k])}" if k in sig.kwonly_defaults else camel(k)
                for k in sig.kwonly)
            types = "; ".join(f"{camel(k)}?: {self.ts_type(anns.get(k))}" for k in sig.kwonly)
            out.append("{ " + inner + " }: { " + types + " } = {}")
        if sig.kwarg:
            out.append(f"{camel(sig.kwarg)}: Record<string, unknown> = {{}}")
        if sig.vararg:
            out.append(f"...{camel(sig.vararg)}: any[]")
        return ", ".join(out)

    def function(self, fn: ast.FunctionDef) -> list[str]:
        manual = MANUAL.get((self.mod, fn.name))
        if manual is not None:
            for name, mod in manual[1]:
                self.use(mod, name)
            return manual[0].strip("\n").split("\n")
        return self.function_body(fn, self.sigs[(self.mod, fn.name)], export=True)

    def function_body(self, fn: ast.FunctionDef, sig: Sig, export=False) -> list[str]:
        args = set(sig.params) | set(sig.kwonly) | {x for x in (sig.vararg, sig.kwarg) if x}
        self.locals_stack.append(set(args))
        try:
            # Names assigned to strings / numbers, for + and *.
            self.str_names = set()
            self.num_names = set()
            for n in ast.walk(fn):
                if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
                    if self.is_str(n.value):
                        self.str_names.add(n.targets[0].id)
                    elif self.is_num(n.value):
                        self.num_names.add(n.targets[0].id)
            for n in ast.walk(fn):
                if isinstance(n, ast.For) and isinstance(n.iter, (ast.Tuple, ast.List)):
                    elts = n.iter.elts
                    if all(isinstance(x, ast.Constant) and isinstance(x.value, (int, float)) for x in elts):
                        self.num_names |= self.names_in_target(n.target)
            params = self.ts_params(fn, sig)
            counts = self.assigned_names(fn.body)
            self.cur_fn = fn
            for_targets = set()
            for n in ast.walk(fn):
                if isinstance(n, ast.For):
                    for_targets |= self.names_in_target(n.target)
            hoist = sorted(n for n, c in counts.items() if c >= 2 and n not in for_targets and n not in args)
            body = fn.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                start = body[0].end_lineno
                body = body[1:]
            else:
                start = fn.body[0].lineno - 1
            lines = self.stmts(body, set(args) | set(hoist), counts, start)
            if hoist:
                self.locals_stack[-1].update(hoist)
                lines = ["let " + ", ".join(camel(n) for n in hoist)] + lines
        finally:
            self.locals_stack.pop()
        kw = "export function" if export else "function"
        ret = ""
        if isinstance(fn.returns, ast.Name) and fn.returns.id == "Document":
            ret = ": " + self.use_type("../model.ts", "Document as KDocument").split(" as ")[-1]
        return self.docstring(fn) + [f"{kw} {camel(fn.name)}({params}){ret} {{"] + \
            [indent(x) for x in lines] + ["}"]

    def collect_import(self, s):
        if isinstance(s, ast.Import):
            for a in s.names:
                if a.name not in ("math", "re", "calendar", "datetime"):
                    raise Unsupported(f"import {a.name}")
            return
        if s.module == "__future__":
            return
        mod = s.module or ""
        for a in s.names:
            local = a.asname or a.name
            if s.level == 2 and mod == "model":
                self.imports[local] = "model"
                if a.asname and a.name == "List":
                    pass
            elif s.level == 2 and mod == "example_helpers":
                self.imports[local] = "helpers"
            elif s.level == 2 and mod == "importers":
                self.imports[local] = "importers"
            elif s.level == 1:
                self.imports[local] = mod
            else:
                raise Unsupported(f"from {mod} import")

    def render(self) -> str:
        self.local_defs = {n.name for n in self.tree.body if isinstance(n, ast.FunctionDef)}
        for s in self.tree.body:
            if isinstance(s, (ast.Import, ast.ImportFrom)):
                self.collect_import(s)
        for n in ast.walk(self.tree):
            if isinstance(n, ast.FunctionDef):
                for s in ast.walk(n):
                    if isinstance(s, (ast.Import, ast.ImportFrom)):
                        self.collect_import(s)
        body_out: list[str] = []
        prev = 0
        module_doc = self.docstring(self.tree)
        for s in self.tree.body:
            if isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant) and isinstance(s.value.value, str):
                prev = s.end_lineno
                continue
            cs = self.comments_between(prev, s.lineno)
            if isinstance(s, (ast.Import, ast.ImportFrom)):
                prev = s.end_lineno
                continue
            if body_out and (isinstance(s, ast.FunctionDef) or cs):
                body_out.append("")
            body_out.extend(cs)
            if isinstance(s, ast.FunctionDef):
                if s.decorator_list:
                    raise Unsupported("decorator")
                body_out.extend(self.function(s))
            elif isinstance(s, ast.Assign):
                self.locals_stack = []
                t = s.targets[0]
                trail = self.trailing.get(s.lineno)
                if isinstance(t, ast.Tuple) and isinstance(s.value, ast.Tuple):
                    for tn, tv in zip(t.elts, s.value.elts):
                        body_out.append(f"export const {self.target(tn)} = {self.expr(tv)}")
                else:
                    line = f"export const {self.target(t)} = {hang(self.expr(s.value))}"
                    if trail:
                        line += "  //" + trail[1:]
                    body_out.append(line)
            else:
                raise Unsupported(f"module statement {type(s).__name__}")
            prev = s.end_lineno
        head = [f"// Generated by scripts/port_examples.py from khervedoc/example_docs/{self.mod}.py:",
                "// edit the Python and regenerate, or edit MANUAL in the script."]
        if module_doc:
            head += ["//"] + module_doc
        imports = []
        for mod in sorted(self.types):
            imports.append(f"import type {{ {', '.join(sorted(self.types[mod]))} }} from '{mod}'")
        for mod in sorted(self.used, key=lambda m: (not m.startswith("../"), m)):
            names = sorted(self.used[mod], key=lambda x: (x.lower(), x))
            line = f"import {{ {', '.join(names)} }} from '{mod}'"
            if len(line) > 100:
                line = "import {\n" + indent(",\n".join(names)) + ",\n} from '" + mod + "'"
            imports.append(line)
        return "\n".join(head + [""] + imports + [""] + body_out) + "\n"


# Hand-written TypeScript for functions that compute with dates (datetime
# and calendar) or Python's float types: (code, [(name, module) imports]).
MANUAL: dict[tuple[str, str], tuple[str, list[tuple[str, str]]]] = {}

_RT = "./runtime.ts"
_EH = "../exampleHelpers.ts"

MANUAL[("planning", "_planner_meta")] = ("""
export function _plannerMeta(stretch: number, kw: Record<string, unknown> = {}) {
  const pre = _PLANNER_PREAMBLE + `\\n\\\\renewcommand{\\\\arraystretch}{${pyFloat(stretch)}}`
  const base: Record<string, unknown> = {
    title: '', author: '', body_font_pt: 10, line_spacing: 1.0,
    paragraph_indent: false, page_size: 'A4',
    packages: [...DEFAULT_PACKAGES, 'array', 'booktabs', 'xcolor'],
    preamble_extras: pre,
  }
  Object.assign(base, kw)
  return _meta(base)
}
""", [("pyFloat", "../py.ts"), ("DEFAULT_PACKAGES", _EH), ("_meta", _EH)])

MANUAL[("planning", "_a")] = ("""
// Column spec of p-columns that exactly fill the text width: a None
// entry takes whatever the fixed ones leave, and 'c' stays a centred
// column of natural width.
export function _a(textCm: number, ...widths: (number | null)[]) {
  const fixed = pySum(widths.filter((w) => w !== null))
  const n = widths.length
  const sep = n * 2 * 5 * 0.03515 + (n + 1) * 0.02
  const flex = widths.filter((w) => w === null)
  const share = pyRound((textCm - fixed - sep) / Math.max(flex.length, 1), 2)
  return widths.map((w) => `p{${pyFloat(w === null ? share : w)}cm}`).join('')
}
""", [("pySum", _RT), ("pyRound", "../py.ts"), ("pyFloat", "../py.ts")])

MANUAL[("planning", "_fmt_day")] = ("""
export function _fmtDay(d: PyDate) {
  return `${DAY_NAME[d.weekday()]} ${d.day} ${MONTH_NAME[d.month]}`
}
""", [("PyDate", _RT), ("DAY_NAME", _RT), ("MONTH_NAME", _RT)])

MANUAL[("planning", "_week_start")] = ("""
export function _weekStart(today: PyDate) {
  return today.addDays(-today.weekday())
}
""", [("PyDate", _RT)])

MANUAL[("planning", "daily_journal")] = ("""
// Printable one-page daily planner for today: priorities, an hourly
// schedule from 07:00 to 19:00, a follow-up list and a short evening
// note. Built from the current date each time it is opened.
export function dailyJournal() {
  const today = PyDate.today()
  const iso = today.isocalendar()
  const hours = range(7, 20).map((h) => [`${zpad(h, 2)}:00`, '', ''])
  return Document({
    meta: _plannerMeta(1.95, {
      margin_left_cm: 1.6, margin_right_cm: 1.6,
      margin_top_cm: 1.3, margin_bottom_cm: 1.0,
    }),
    children: [
      Title({ children: [Text({ text: _fmtDay(today) })] }),
      Author({ children: [Text({
        text: `${today.year} · week ${iso[1]} · day ` +
          `${today.yday()}` })] }),
      _h('Top priorities'),
      Table({ rows: _blankRows(3), alignment: _a(17.8, 0.7, null), style: 'grid' }),
      _h('Schedule'),
      Table({ rows: [['Time', 'Plan', 'Notes'], ...hours],
        alignment: _a(17.8, 1.3, null, 4.6), style: 'grid', header: true }),
      _h('To do and follow up'),
      Table({ rows: _blankRows(2), alignment: _a(17.8, 0.7, null),
        style: 'grid' }),
      _h('Evening review'),
      Table({ rows: [['One win', ''], ['One lesson', ''],
        ['First task tomorrow', '']],
      alignment: _a(17.8, 3.6, null), style: 'grid' }),
    ],
  })
}
""", [("PyDate", _RT), ("range", _RT), ("zpad", "../py.ts"), ("Document", _EH), ("Title", _EH),
      ("Text", _EH), ("Author", _EH), ("Table", _EH)])

MANUAL[("planning", "weekly_journal")] = ("""
// Printable weekly planner for the current week (Monday to Sunday):
// goals, a day-by-day plan with today shaded, a habit tracker and an
// end-of-week review.
export function weeklyJournal() {
  const today = PyDate.today()
  const mon = _weekStart(today)
  const sun = mon.addDays(6)
  const days = range(7).map((i) => mon.addDays(i))
  let span
  if (mon.month === sun.month) {
    span = `${mon.day}–${sun.day} ${MONTH_NAME[sun.month]} ${sun.year}`
  } else {
    span = (`${mon.day} ${MONTH_NAME[mon.month]} – ` +
      `${sun.day} ${MONTH_NAME[sun.month]} ${sun.year}`)
  }

  const plan = [['Day', 'Plan and appointments', 'Evening']]
  const shading: Record<string, string> = {}
  for (const [i, d] of enumerate(days)) {
    plan.push([`${DAY_ABBR[d.weekday()]} ${d.day}`, '', ''])
    if (d.equals(today)) {
      Object.assign(shading, Object.fromEntries(range(3).map((c) => [`${i + 1},${c}`, _TINT])))
    }
  }

  const habits = [['Habit', 'M', 'T', 'W', 'T', 'F', 'S', 'S'], ...[
    'Exercise (30 min)', 'Read (20 pages)', 'In bed before 23:00',
    'Two litres of water', 'Plan tomorrow', ''].map((h) => [h, '', '', '', '', '', '', ''])]

  const review = [['Review', 'Notes'], ['Wins', ''], ['', ''],
    ['To improve', ''], ['', ''],
    ['Carry over', ''], ['', '']]

  return Document({
    meta: _plannerMeta(1.7, {
      margin_left_cm: 1.8, margin_right_cm: 1.8,
      margin_top_cm: 1.4, margin_bottom_cm: 1.2,
    }),
    children: [
      Title({ children: [Text({ text: `Week ${today.isocalendar()[1]}` })] }),
      Author({ children: [Text({ text: span })] }),
      _h('Goals for the week'),
      Table({ rows: _blankRows(3), alignment: _a(17.4, 0.7, null), style: 'grid' }),
      _h('Week at a glance'),
      Table({ rows: plan, alignment: _a(17.4, 1.7, null, 4.9), style: 'grid',
        header: true, shading }),
      _h('Habit tracker'),
      Table({ rows: habits, alignment: _a(17.4, null, ...pyRepeat([1.1], 7)), style: 'grid',
        header: true }),
      _h('End-of-week review'),
      Table({ rows: review, alignment: _a(17.4, 2.6, null), style: 'grid',
        header: true,
        merges: [[1, 0, 2, 1], [3, 0, 2, 1], [5, 0, 2, 1]] }),
    ],
  })
}
""", [("PyDate", _RT), ("range", _RT), ("enumerate", _RT), ("pyRepeat", _RT), ("MONTH_NAME", _RT),
      ("DAY_ABBR", _RT), ("Document", _EH), ("Title", _EH), ("Text", _EH), ("Author", _EH),
      ("Table", _EH)])

MANUAL[("planning", "monthly_journal")] = ("""
// Printable monthly planner for the current month: goals, a week by
// week outline with dates, key dates, a small metrics table and a
// month-end review.
export function monthlyJournal() {
  const today = PyDate.today()
  const [y, m] = [today.year, today.month]
  const weeks = monthDatesCalendar(y, m)
  const outline = [['Week', 'Dates', 'Focus', 'Milestones']]
  const shading: Record<string, string> = {}
  for (const [i, w] of enumerate(weeks)) {
    const first = PyDate.max(w[0], new PyDate(y, m, 1))
    const last = PyDate.min(w.at(-1)!, new PyDate(y, m, monthDays(y, m)))
    let dates
    if (first.equals(last)) {
      dates = `${first.day} ${MONTH_ABBR[m]}`
    } else {
      dates = `${first.day}–${last.day} ${MONTH_ABBR[m]}`
    }
    outline.push([String(w[0].isocalendar()[1]), dates, '', ''])
    if (w[0].compare(today) <= 0 && today.compare(w.at(-1)!) <= 0) {
      Object.assign(shading, Object.fromEntries(range(4).map((c) => [`${i + 1},${c}`, _TINT])))
    }
  }

  return Document({
    meta: _plannerMeta(1.4, {
      margin_left_cm: 2.0, margin_right_cm: 2.0,
      margin_top_cm: 1.6, margin_bottom_cm: 1.4,
    }),
    children: [
      Title({ children: [Text({ text: `${MONTH_NAME[m]} ${y}` })] }),
      Author({ children: [Text({ text: 'Monthly planner' })] }),
      _h('Goals for the month'),
      Table({ rows: [['', 'Goal', 'How I will know it is done'],
        ...range(4).map(() => [_BOX, '', ''])],
      alignment: _a(17.0, 0.7, null, 6.5), style: 'grid', header: true }),
      _h('Week by week'),
      Table({ rows: outline, alignment: _a(17.0, 1.4, 2.8, null, 5.4),
        style: 'grid', header: true, shading }),
      _h('Key dates'),
      Table({ rows: [['Date', 'Event'], ...range(5).map(() => ['', ''])],
        alignment: _a(17.0, 2.6, null), style: 'grid', header: true }),
      _h('Measures'),
      Table({ rows: [['Measure', 'Target', 'Actual'],
        ['Focused work (hours)', '', ''],
        ['Exercise days', '', ''],
        ['Pages or chapters read', '', ''],
        ['Money in / out', '', '']],
      alignment: _a(17.0, null, 4.6, 4.6), style: 'grid',
      header: true }),
      _h('Month-end review'),
      Table({ rows: [['Review', 'Notes'],
        ['What went well', ''], ['', ''],
        ['What to change', ''], ['', ''],
        ['Next month', ''], ['', '']],
      alignment: _a(17.0, 3.6, null), style: 'grid', header: true,
      merges: [[1, 0, 2, 1], [3, 0, 2, 1], [5, 0, 2, 1]] }),
    ],
  })
}
""", [("PyDate", _RT), ("range", _RT), ("enumerate", _RT), ("monthDatesCalendar", _RT),
      ("monthDays", _RT), ("MONTH_NAME", _RT), ("MONTH_ABBR", _RT), ("Document", _EH),
      ("Title", _EH), ("Text", _EH), ("Author", _EH), ("Table", _EH)])

MANUAL[("planning", "_calendar_latex")] = ("""
// Landscape wall-calendar grid: the month name and year above seven
// weekday columns; every cell has the day number at the top and room to
// write below. Days of the neighbouring months are greyed, today is
// marked with a black number.
export function _calendarLatex(year: number, month: number, today: PyDate | null = null) {
  const weeks = monthDatesCalendar(year, month)
  const cellH = pyRound(16.2 / weeks.length, 2)
  const L = [
    '\\\\noindent{\\\\fontsize{34}{36}\\\\selectfont\\\\bfseries ' +
    `${MONTH_NAME[month]}}\\\\hfill{\\\\fontsize{26}{30}` +
    `\\\\selectfont\\\\color{black!55}${year}}\\\\par\\\\vspace{5pt}`,
    '\\\\setlength{\\\\tabcolsep}{2pt}\\\\renewcommand{\\\\arraystretch}{1}',
    '\\\\noindent\\\\makebox[\\\\textwidth][c]{%',
    '\\\\begin{tabular}{|' + 'l|'.repeat(7) + '}',
    '\\\\hline',
    DAY_NAME.map((n) =>
      `\\\\parbox[c][0.7cm][c]{3.85cm}{\\\\centering\\\\bfseries ` +
      `\\\\textsc{${n}}}`).join(' & ') + ' \\\\\\\\',
    '\\\\hline',
  ]
  for (const w of weeks) {
    const cells = []
    for (const d of w) {
      let num
      if (today !== null && d.equals(today)) {
        num = (`\\\\colorbox{black}{\\\\textcolor{white}` +
          `{\\\\bfseries\\\\,${d.day}\\\\,}}`)
      } else if (d.month !== month) {
        num = `\\\\textcolor{black!40}{${d.day}}`
      } else {
        num = `\\\\textbf{${d.day}}`
      }
      cells.push(
        `\\\\parbox[t][${pyFloat(cellH)}cm][t]{3.85cm}` +
        `{\\\\raggedleft\\\\small ${num}}`)
    }
    L.push(cells.join(' & ') + ' \\\\\\\\')
    L.push('\\\\hline')
  }
  L.push('\\\\end{tabular}}')
  return L.join('\\n')
}
""", [("PyDate", _RT), ("monthDatesCalendar", _RT), ("MONTH_NAME", _RT), ("DAY_NAME", _RT),
      ("pyRound", "../py.ts"), ("pyFloat", "../py.ts")])

MANUAL[("planning", "calendar")] = ("""
// Landscape monthly calendar for the current month: one big page,
// weekday headers, a tall writing space in every day and today marked.
export function calendar() {
  const today = PyDate.today()
  return Document({
    meta: _meta({
      title: '', author: '', body_font_pt: 10,
      margin_left_cm: 0.8, margin_right_cm: 0.8,
      margin_top_cm: 0.8, margin_bottom_cm: 0.6,
      paragraph_indent: true, line_spacing: 1.0, page_size: 'A4',
      class_options: 'landscape',
      preamble_extras: '\\\\geometry{landscape}\\n\\\\pagestyle{empty}',
      packages: [...DEFAULT_PACKAGES, 'array', 'xcolor'],
    }),
    children: [
      RawLatex({ text: _calendarLatex(today.year, today.month, today) }),
    ],
  })
}
""", [("PyDate", _RT), ("Document", _EH), ("_meta", _EH), ("DEFAULT_PACKAGES", _EH), ("RawLatex", _EH)])

MANUAL[("planning", "_nodate")] = ("""
export function _nodate(meta: any) {
  meta.preamble_extras += '\\n\\\\date{}'
  return meta
}
""", [])


def main() -> None:
    sigs: dict[tuple[str, str], Sig] = {}
    helpers = ast.parse((SRC / "khervedoc" / "example_helpers.py").read_text(encoding="utf-8"))
    for n in helpers.body:
        if isinstance(n, ast.FunctionDef):
            sigs[("helpers", n.name)] = signature(n, "helpers")
    for name in MODULES:
        tree = ast.parse((DOCS / f"{name}.py").read_text(encoding="utf-8"))
        for n in tree.body:
            if isinstance(n, ast.FunctionDef):
                sigs[(name, n.name)] = signature(n, name)
    OUT.mkdir(parents=True, exist_ok=True)
    failed = False
    for name in MODULES:
        m = Module(name, sigs)
        try:
            text = m.render()
        except Unsupported as exc:
            print(f"{name}: {exc}")
            failed = True
            continue
        (OUT / f"{camel(name)}.ts").write_text(text, encoding="utf-8")
        print(f"{name}.py -> src/core/exampleDocs/{camel(name)}.ts")
    if failed:
        sys.exit(1)
    write_examples_index()


def write_examples_index() -> None:
    """examples.py: the gallery, from Python's own list so the labels and
    one-line descriptions are the same strings."""
    from khervedoc import examples
    imports: dict[str, list[str]] = {}
    for _c, _l, f, _d in examples.GALLERY:
        mod = f.__module__.rsplit(".", 1)[-1]
        imports.setdefault(mod, []).append(camel(f.__name__))
    doc = ast.get_docstring(ast.parse((SRC / "khervedoc" / "examples.py").read_text(encoding="utf-8")))
    out = ["// Generated by scripts/port_examples.py from khervedoc/examples.py.", "//"]
    out += ["// " + line if line else "//" for line in doc.split("\n")]
    out += ["", "import type { Document } from './model.ts'"]
    for mod in sorted(imports, key=camel):
        names = sorted(set(imports[mod]), key=str.lower)
        line = f"import {{ {', '.join(names)} }} from './exampleDocs/{camel(mod)}.ts'"
        if len(line) > 100:
            line = "import {\n" + indent(",\n".join(names)) + ",\n} from './exampleDocs/" + camel(mod) + ".ts'"
        out.append(line)
    out += ["", "export type Factory = () => Document", ""]
    out.append("export const GALLERY_CATEGORIES: readonly string[] = [")
    out.append(indent(", ".join(ts_str(c) for c in examples.GALLERY_CATEGORIES) + ","))
    out.append("]")
    out += ["", "// (category, label, factory, one line for the user), in gallery order.",
            "export const GALLERY: [string, string, Factory, string][] = ["]
    prev = None
    for c, label, f, d in examples.GALLERY:
        if prev is not None and c != prev:
            out.append("")
        prev = c
        out.append(indent(f"[{ts_str(c)}, {ts_str(label)}, {camel(f.__name__)},"))
        out.append(indent(f"  {ts_str(d)}],"))
    out.append("]")
    out += ["", "// Every example as (label, factory), the welcome tour first: what the welcome",
            "// page lists and what the compile checks and the offline bundle cover.",
            "export const EXAMPLES: [string, Factory][] = GALLERY.map(([, label, f]) => [label, f])",
            "export const JOURNAL_EXAMPLES: [string, Factory][] = GALLERY",
            "  .filter(([c]) => c === 'Journals').map(([, label, f]) => [label, f])",
            "",
            "// The factories examples.py re-exports, for callers that name one",
            "// (examples.welcome, examples.blank).",
            "export {"]
    out.append(indent(",\n".join(sorted({camel(f.__name__) for _c, _l, f, _d in examples.GALLERY}, key=str.lower)) + ","))
    out.append("}")
    (HERE / "src" / "core" / "examples.ts").write_text("\n".join(out) + "\n", encoding="utf-8")
    print("examples.py -> src/core/examples.ts")


if __name__ == "__main__":
    main()
