#!/usr/bin/env python3
import ast
import json
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple


def get_source_lines(path: str) -> List[str]:
    with open(path, "r", encoding="utf-8") as f:
        return f.read().splitlines()


def safe_unparse(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:
        return ""


def callee_name(call: ast.Call) -> str:
    fn = call.func
    if isinstance(fn, ast.Name):
        return fn.id
    if isinstance(fn, ast.Attribute):
        parts = []
        cur = fn
        while isinstance(cur, ast.Attribute):
            parts.append(cur.attr)
            cur = cur.value
        if isinstance(cur, ast.Name):
            parts.append(cur.id)
        parts.reverse()
        return ".".join(parts)
    return ""


def args_preview(call: ast.Call, max_len: int = 96) -> str:
    parts = []
    for a in call.args:
        s = safe_unparse(a).strip()
        if s:
            parts.append(s)
    for kw in call.keywords:
        if kw.arg is None:
            s = safe_unparse(kw.value).strip()
            if s:
                parts.append("**" + s)
        else:
            s = safe_unparse(kw.value).strip()
            if s:
                parts.append(f"{kw.arg}={s}")
    out = ", ".join(parts)
    if len(out) > max_len:
        out = out[: max_len - 3] + "..."
    return out


def loop_header_preview(loop_node: ast.AST, source_lines: List[str]) -> str:
    lineno = getattr(loop_node, "lineno", None)
    if not lineno:
        return ""
    i = lineno - 1
    if 0 <= i < len(source_lines):
        line = source_lines[i].strip()
        if len(line) > 96:
            line = line[:93] + "..."
        return line
    return ""


def collect_assigned_names(target: ast.AST, out: Set[str]) -> None:
    """Collect only simple local variable names (identifiers) assigned in a function."""
    if isinstance(target, ast.Name):
        out.add(target.id)
        return
    if isinstance(target, (ast.Tuple, ast.List)):
        for elt in target.elts:
            collect_assigned_names(elt, out)
        return
    # Do NOT collect Attribute/Subscript here; those are writes, not locals.


def collect_write_targets(target: ast.AST, out: Set[str]) -> None:
    """Collect write targets like obj.attr or arr[i] assigned in a function."""
    if isinstance(target, (ast.Attribute, ast.Subscript)):
        s = safe_unparse(target).strip()
        if s:
            out.add(s)
        return
    if isinstance(target, (ast.Tuple, ast.List)):
        for elt in target.elts:
            collect_write_targets(elt, out)
        return


def call_preview(call: ast.Call, max_len: int = 96) -> str:
    """Return a compact preview like: fn(a, b, kw=c)."""
    name = callee_name(call)
    a = args_preview(call, max_len=max_len)
    out = f"{name}({a})" if a else f"{name}()"
    if len(out) > max_len:
        out = out[: max_len - 3] + "..."
    return out


def is_write_to_buffer(stmt: ast.AST) -> bool:
    # Heuristic: any assignment to Subscript/Attribute counts as "writes"
    targets = []
    if isinstance(stmt, ast.Assign):
        targets = stmt.targets
    elif isinstance(stmt, ast.AnnAssign):
        targets = [stmt.target]
    elif isinstance(stmt, ast.AugAssign):
        targets = [stmt.target]
    for t in targets:
        if isinstance(t, (ast.Subscript, ast.Attribute)):
            return True
        if isinstance(t, (ast.Tuple, ast.List)):
            for elt in t.elts:
                if isinstance(elt, (ast.Subscript, ast.Attribute)):
                    return True
    return False


@dataclass
class FuncInfo:
    function_name: str
    start_line: int
    end_line: int
    line_count: int
    desc: str
    args: List[str] = field(default_factory=list)
    local_vars: Set[str] = field(default_factory=set)
    local_functions: Set[str] = field(default_factory=set)
    writes_any: bool = False
    writes_targets: Set[str] = field(default_factory=set)
    returns_any: bool = False
    returns_exprs: List[str] = field(default_factory=list)
    invokes: List[Dict[str, Any]] = field(default_factory=list)


class ModuleScanner(ast.NodeVisitor):
    def __init__(self, source_lines: List[str]) -> None:
        self.source_lines = source_lines
        self.imports: List[str] = []
        self.global_vars: List[str] = []
        self.constants: List[str] = []
        self.funcs: Dict[str, FuncInfo] = {}
        self._module_level_assigns: List[ast.AST] = []

    def visit_Import(self, node: ast.Import) -> None:
        for n in node.names:
            if n.asname:
                self.imports.append(f"import {n.name} as {n.asname}")
            else:
                self.imports.append(f"import {n.name}")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        mod = node.module or ""
        for n in node.names:
            if n.asname:
                self.imports.append(f"from {mod} import {n.name} as {n.asname}")
            else:
                self.imports.append(f"from {mod} import {n.name}")

    def visit_Assign(self, node: ast.Assign) -> None:
        # Only treat as globals if module-level; NodeVisitor doesn't provide parent,
        # so we collect and decide in a pre-pass outside this visitor if desired.
        self._module_level_assigns.append(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        self._module_level_assigns.append(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._record_func(node)
        # Do not descend here; we’ll analyze bodies in a separate pass
        return

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._record_func(node)
        return

    def _record_func(self, node: ast.AST) -> None:
        name = getattr(node, "name", "")
        start = getattr(node, "lineno", 0) or 0
        end = getattr(node, "end_lineno", 0) or 0
        if end <= 0 and start > 0:
            end = start
        line_count = (end - start + 1) if (start > 0 and end > 0) else 0
        desc = ast.get_docstring(node) or ""
        args = []
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for a in node.args.args:
                args.append(a.arg)
            if node.args.vararg:
                args.append("*" + node.args.vararg.arg)
            for a in node.args.kwonlyargs:
                args.append(a.arg)
            if node.args.kwarg:
                args.append("**" + node.args.kwarg.arg)

        self.funcs[name] = FuncInfo(
            function_name=name,
            start_line=start,
            end_line=end,
            line_count=line_count,
            desc=desc.strip(),
            args=args,
        )


class FunctionBodyScanner(ast.NodeVisitor):
    def __init__(self, source_lines: List[str]) -> None:
        self.source_lines = source_lines
        self.loop_stack: List[ast.AST] = []
        self.assigned: Set[str] = set()
        self.write_targets: Set[str] = set()
        self.return_exprs: List[str] = []
        self.local_funcs: Set[str] = set()
        self.calls: List[Tuple[ast.Call, bool, Optional[ast.AST]]] = []
        self.writes_any: bool = False
        self.returns_any: bool = False

    def generic_visit(self, node: ast.AST) -> None:
        # Track writes (heuristic + capture exact targets)
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            targets: List[ast.AST] = []
            if isinstance(node, ast.Assign):
                targets = node.targets
            elif isinstance(node, ast.AnnAssign):
                targets = [node.target]
            elif isinstance(node, ast.AugAssign):
                targets = [node.target]

            for t in targets:
                collect_write_targets(t, self.write_targets)

            if is_write_to_buffer(node):
                self.writes_any = True

        # Track returns
        if isinstance(node, ast.Return):
            self.returns_any = True
            if node.value is None:
                self.return_exprs.append("None")
            else:
                s = safe_unparse(node.value).strip()
                self.return_exprs.append(s if s else "<expr>")

        super().generic_visit(node)

    def visit_For(self, node: ast.For) -> None:
        self.loop_stack.append(node)
        self._collect_loop_target(node.target)
        self.generic_visit(node)
        self.loop_stack.pop()

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.loop_stack.append(node)
        self._collect_loop_target(node.target)
        self.generic_visit(node)
        self.loop_stack.pop()

    def visit_While(self, node: ast.While) -> None:
        self.loop_stack.append(node)
        self.generic_visit(node)
        self.loop_stack.pop()

    def visit_Assign(self, node: ast.Assign) -> None:
        for t in node.targets:
            collect_assigned_names(t, self.assigned)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        collect_assigned_names(node.target, self.assigned)
        self.generic_visit(node)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        collect_assigned_names(node.target, self.assigned)
        self.generic_visit(node)

    def visit_With(self, node: ast.With) -> None:
        for item in node.items:
            if item.optional_vars is not None:
                collect_assigned_names(item.optional_vars, self.assigned)
        self.generic_visit(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        if node.name:
            self.assigned.add(node.name)
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        # nested/local function
        self.local_funcs.add(node.name)
        # don’t descend into nested function body for parent’s locals/calls
        return

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.local_funcs.add(node.name)
        return

    def visit_Call(self, node: ast.Call) -> None:
        in_loop = len(self.loop_stack) > 0
        loop_node = self.loop_stack[-1] if in_loop else None
        self.calls.append((node, in_loop, loop_node))
        self.generic_visit(node)

    def _collect_loop_target(self, target: ast.AST) -> None:
        collect_assigned_names(target, self.assigned)


def build_globals(tree: ast.Module) -> Dict[str, List[str]]:
    imports: List[str] = []
    global_vars: Set[str] = set()
    constants: Set[str] = set()

    for node in tree.body:
        if isinstance(node, ast.Import):
            for n in node.names:
                if n.asname:
                    imports.append(f"import {n.name} as {n.asname}")
                else:
                    imports.append(f"import {n.name}")
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            for n in node.names:
                if n.asname:
                    imports.append(f"from {mod} import {n.name} as {n.asname}")
                else:
                    imports.append(f"from {mod} import {n.name}")
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    global_vars.add(t.id)
                    if t.id.isupper():
                        constants.add(t.id)
        elif isinstance(node, ast.AnnAssign):
            t = node.target
            if isinstance(t, ast.Name):
                global_vars.add(t.id)
                if t.id.isupper():
                    constants.add(t.id)

    return {
        "imports": sorted(imports),
        "global_vars": sorted(global_vars),
        "constants": sorted(constants),
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: py_intel.py path/to/file.py", file=sys.stderr)
        return 2

    path = sys.argv[1]
    source_lines = get_source_lines(path)
    src = "\n".join(source_lines)

    tree = ast.parse(src, filename=path, type_comments=True)

    globals_info = build_globals(tree)

    # First pass: discover functions + boundaries + docstrings + args
    ms = ModuleScanner(source_lines)
    ms.visit(tree)

    # Second pass: scan each function body for locals, nested funcs, writes/returns
    for fn_name, finfo in ms.funcs.items():
        # locate the AST node again
        fn_node = None
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == fn_name:
                fn_node = node
                break
        if fn_node is None:
            continue

        bs = FunctionBodyScanner(source_lines)
        for stmt in fn_node.body:
            bs.visit(stmt)

        finfo.local_vars = bs.assigned
        finfo.local_functions = bs.local_funcs
        finfo.writes_any = bs.writes_any
        finfo.writes_targets = bs.write_targets
        finfo.returns_any = bs.returns_any
        finfo.returns_exprs = bs.return_exprs

    # Third pass: build invoke map (callsites where defined functions are called)
    defined = set(ms.funcs.keys())

    class CallsiteScanner(ast.NodeVisitor):
        def __init__(self) -> None:
            self.loop_stack: List[ast.AST] = []

        def visit_For(self, node: ast.For) -> None:
            self.loop_stack.append(node)
            self.generic_visit(node)
            self.loop_stack.pop()

        def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
            self.loop_stack.append(node)
            self.generic_visit(node)
            self.loop_stack.pop()

        def visit_While(self, node: ast.While) -> None:
            self.loop_stack.append(node)
            self.generic_visit(node)
            self.loop_stack.pop()

        def visit_Call(self, node: ast.Call) -> None:
            name = callee_name(node)
            # Normalize call target so `self.foo()` / `obj.foo()` can match a defined `foo`.
            # Keep the original fully-unparsed name for debugging.
            short = name.split(".")[-1] if name else ""
            target = short if short in defined else name

            if target in defined:
                in_loop = len(self.loop_stack) > 0
                loop_node = self.loop_stack[-1] if in_loop else None
                entry: Dict[str, Any] = {
                    "line": getattr(node, "lineno", 0) or 0,
                    "context": "loop" if in_loop else "single",
                    "callee": target,
                    "callee_full": name,
                    "args_preview": call_preview(node),
                }
                if in_loop:
                    entry["loop_header_preview"] = loop_header_preview(loop_node, source_lines)
                ms.funcs[target].invokes.append(entry)
            self.generic_visit(node)

    cs = CallsiteScanner()
    cs.visit(tree)

    # Emit JSON in your format
    out = {
        "globals": {
            "imports": globals_info["imports"],
            "global_vars": globals_info["global_vars"],
            "constants": globals_info["constants"],
        },
        "functions": [],
    }

    # stable order by start line
    funcs_sorted = sorted(ms.funcs.values(), key=lambda x: (x.start_line, x.function_name))
    for f in funcs_sorted:
        out["functions"].append(
            {
                "function_name": f.function_name,
                "start_line": f.start_line,
                "line_count": f.line_count,
                "end_line": f.end_line,
                "desc": f.desc,
                "invokes": {
                    "total": len(f.invokes),
                    "invoke_list": sorted(f.invokes, key=lambda e: e.get("line", 0)),
                },
                "inputs": {
                    "args": f.args,
                },
                "locals": {
                    "local_vars": sorted(f.local_vars),
                    "local_functions": sorted(f.local_functions),
                },
                "writes": {
                    "none": (not f.writes_any and len(f.writes_targets) == 0),
                    "targets": sorted(f.writes_targets),
                },
                "returns": {
                    "none": (not f.returns_any),
                    "returns": f.returns_exprs,
                },
            }
        )

    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
