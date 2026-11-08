import {
  createGraph,
  graphs,
  linkNodes,
  newNodeId,
  nodeDef,
  nodeDefs,
  removeNodes,
  runGraph,
  type Document,
  type ElementId,
  type Graph,
  type GraphNode,
  type GraphParams,
  type NodeResult,
  type ParamValue,
} from "@open-bim/core";

// Visual programming editor (Revit: Dynamo): a canvas of nodes and links for the project's graphs.
// Drag the background to pan, a node's title to move it, an output dot onto an input dot to link
// (click a link to remove it); Delete removes the selected node. Unlinked inputs take typed values.
// Run (or Automatic) evaluates the graph; values show under each node, errors in red.

export interface GraphEditorHost {
  doc: Document;
  status(s: string): void;
  selection(): ElementId[];
}

let open: { close(): void } | null = null;

/** Short text for a value under a node (Watch shows more). */
function preview(doc: Document, v: unknown, full: boolean): string {
  const one = (x: unknown): string => {
    if (x === null || x === undefined) return "null";
    if (typeof x === "number") return String(Math.round(x * 1000) / 1000);
    if (typeof x === "string") {
      // Element ids show as the element.
      const e = doc.get(x);
      if (e) return e.name ? `${e.category} "${e.name}"` : e.category;
      return x.length > 24 ? `${x.slice(0, 24)}…` : x;
    }
    if (typeof x === "boolean") return String(x);
    if (Array.isArray(x)) return `[${x.length}]`;
    const o = x as { x?: number; y?: number; start?: unknown };
    if (typeof o.x === "number" && typeof o.y === "number") return `(${Math.round(o.x)}, ${Math.round(o.y)})`;
    if (o.start) return "line";
    return "{…}";
  };
  if (!Array.isArray(v)) return one(v);
  const n = full ? 12 : 3;
  return `${v.length} items: ${v.slice(0, n).map(one).join(", ")}${v.length > n ? ", …" : ""}`;
}

export function openGraphEditor(host: GraphEditorHost): void {
  open?.close();
  const { doc } = host;
  const root = document.createElement("div");
  root.className = "ge";
  document.body.append(root);
  let graphId: ElementId | null = graphs(doc)[0]?.id ?? null;
  let results = new Map<string, NodeResult>();
  let selected: string | null = null;
  let pan = { x: 40, y: 40 };
  let running = false;

  const g = (): Graph | undefined => (graphId ? (doc.get(graphId) as Graph | undefined) : undefined);
  const save = (name: string, next: Pick<GraphParams, "nodes" | "links">) => {
    const cur = g();
    if (!cur) return;
    try {
      doc.transact(name, (tx) => tx.update<GraphParams>(cur.id, { nodes: next.nodes, links: next.links }));
    } catch (e) {
      host.status(`⚠ ${(e as Error).message}`);
    }
  };
  const run = () => {
    const cur = g();
    if (!cur) return;
    running = true;
    try {
      results = runGraph(doc, cur.id, { selection: host.selection() });
      const errors = [...results.values()].filter((r) => r.error).length;
      host.status(errors ? `⚠ Graph ran with ${errors} node error(s).` : `Graph ran: ${results.size} node(s).`);
    } catch (e) {
      host.status(`⚠ ${(e as Error).message}`);
    } finally {
      running = false;
    }
    render();
  };
  // Automatic: run after edits and model changes (not the graph's own runs).
  let timer: number | undefined;
  const off = doc.on((c) => {
    if (running || c.name.startsWith("Run ")) return;
    if (g()?.params.automatic) {
      clearTimeout(timer);
      timer = window.setTimeout(run, 150);
    }
    render();
  });

  const close = () => {
    off();
    clearTimeout(timer);
    root.remove();
    window.removeEventListener("keydown", onKey, true);
    open = null;
  };
  open = { close };
  const onKey = (ev: KeyboardEvent) => {
    if (!root.isConnected) return;
    const tag = (ev.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    } else if ((ev.key === "Delete" || ev.key === "Backspace") && selected) {
      ev.stopPropagation();
      ev.preventDefault();
      const cur = g();
      if (cur) save("Delete node", removeNodes(cur.params, [selected]));
      selected = null;
    }
  };
  window.addEventListener("keydown", onKey, true);

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };

  function addNode(type: string, at?: { x: number; y: number }) {
    const cur = g();
    if (!cur) return;
    const canvas = root.querySelector(".ge-canvas") as HTMLElement | null;
    const r = canvas?.getBoundingClientRect();
    const pos = at ?? { x: (r ? r.width / 2 : 300) - pan.x - 80 + Math.random() * 40, y: (r ? r.height / 3 : 200) - pan.y + Math.random() * 40 };
    const node: GraphNode = { id: newNodeId(cur.params), type, x: Math.round(pos.x), y: Math.round(pos.y), values: {} };
    selected = node.id;
    save(`Add ${nodeDef(type)?.label ?? type}`, { nodes: [...cur.params.nodes, node], links: cur.params.links });
  }

  function render() {
    const cur = g();
    root.replaceChildren();
    // Top bar: graph, New / Rename / Delete, Run, Automatic, Close.
    const bar = el("div", "ge-bar");
    const pick = el("select");
    for (const x of graphs(doc)) pick.append(new Option(x.name ?? "Graph", x.id, false, x.id === graphId));
    if (!graphs(doc).length) pick.append(new Option("(no graphs)", ""));
    pick.onchange = () => {
      graphId = pick.value || null;
      results = new Map();
      render();
    };
    const btn = (label: string, fn: () => void, title = "") => {
      const b = el("button", "", label);
      b.title = title;
      b.onclick = fn;
      return b;
    };
    const auto = el("input");
    auto.type = "checkbox";
    auto.checked = !!cur?.params.automatic;
    auto.disabled = !cur;
    auto.onchange = () => cur && doc.transact(auto.checked ? "Automatic runs on" : "Automatic runs off", (tx) => tx.update<GraphParams>(cur.id, { automatic: auto.checked }));
    const autoLabel = el("label", "ge-auto");
    autoLabel.append(auto, " Automatic");
    bar.append(
      el("strong", "", "Visual Programming"),
      pick,
      btn("New", () => {
        const name = `Graph ${graphs(doc).length + 1}`;
        doc.transact("New graph", (tx) => {
          graphId = createGraph(tx, name).id;
        });
      }),
      btn("Rename", () => {
        if (!cur) return;
        const name = prompt("Graph name", cur.name ?? "");
        if (name) doc.transact("Rename graph", (tx) => tx.setName(cur.id, name));
      }),
      btn("Delete", () => {
        if (!cur || !confirm(`Delete ${cur.name ?? "this graph"}? Elements it made stay in the model.`)) return;
        doc.transact("Delete graph", (tx) => tx.delete(cur.id));
        graphId = graphs(doc)[0]?.id ?? null;
        render();
      }),
      btn("▶ Run", run, "Run the graph (one undo step)"),
      autoLabel,
      el("span", "ge-spacer"),
      btn("Close", close, "Esc"),
    );
    root.append(bar);

    const body = el("div", "ge-body");
    root.append(body);
    // Library: search, then nodes by group; click to add.
    const lib = el("div", "ge-lib");
    const search = el("input");
    search.placeholder = "Search nodes…";
    const list = el("div", "ge-libList");
    const fill = () => {
      list.replaceChildren();
      const q = search.value.trim().toLowerCase();
      const groups = new Map<string, ReturnType<typeof nodeDefs>>();
      for (const d of nodeDefs()) if (!q || d.label.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)) groups.set(d.category, [...(groups.get(d.category) ?? []), d]);
      for (const [cat, ds] of groups) {
        list.append(el("div", "ge-libCat", cat));
        for (const d of ds) {
          const b = el("button", "ge-libItem", d.label);
          b.disabled = !cur;
          b.onclick = () => addNode(d.type);
          list.append(b);
        }
      }
    };
    search.oninput = fill;
    search.onkeydown = (e) => {
      if (e.key === "Enter") (list.querySelector(".ge-libItem") as HTMLButtonElement | null)?.click();
    };
    fill();
    lib.append(search, list);
    body.append(lib);

    const canvas = el("div", "ge-canvas");
    body.append(canvas);
    if (!cur) {
      canvas.append(el("div", "ge-empty", "No graph yet: click New."));
      return;
    }
    const world = el("div", "ge-world");
    world.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.classList.add("ge-links");
    world.append(svg);
    canvas.append(world);

    // Pan by dragging the background.
    canvas.onpointerdown = (ev) => {
      if (ev.target !== canvas && ev.target !== world && ev.target !== svg) return;
      selected = null;
      root.querySelectorAll(".ge-node.sel").forEach((n) => n.classList.remove("sel"));
      const s = { x: ev.clientX - pan.x, y: ev.clientY - pan.y };
      const move = (e: PointerEvent) => {
        pan = { x: e.clientX - s.x, y: e.clientY - s.y };
        world.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

    const portEls = new Map<string, HTMLElement>();
    const params = cur.params;
    for (const n of params.nodes) {
      const d = nodeDef(n.type);
      const r = results.get(n.id);
      const box = el("div", `ge-node${n.id === selected ? " sel" : ""}${r?.error ? " err" : ""}`);
      box.style.left = `${n.x}px`;
      box.style.top = `${n.y}px`;
      const title = el("div", "ge-title", d?.label ?? n.type);
      box.append(title);
      // Move by the title.
      title.onpointerdown = (ev) => {
        ev.stopPropagation();
        selected = n.id;
        root.querySelectorAll(".ge-node.sel").forEach((x) => x.classList.remove("sel"));
        box.classList.add("sel");
        const s = { x: ev.clientX - n.x, y: ev.clientY - n.y };
        let moved = false;
        const move = (e: PointerEvent) => {
          moved = true;
          box.style.left = `${e.clientX - s.x}px`;
          box.style.top = `${e.clientY - s.y}px`;
          drawLinks();
        };
        const up = (e: PointerEvent) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          if (moved) save("Move node", { nodes: params.nodes.map((x) => (x.id === n.id ? { ...x, x: Math.round(e.clientX - s.x), y: Math.round(e.clientY - s.y) } : x)), links: params.links });
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      };
      const setValue = (key: string, v: ParamValue) =>
        save("Node value", { nodes: params.nodes.map((x) => (x.id === n.id ? { ...x, values: { ...x.values, [key]: v } } : x)), links: params.links });
      // Settings (slider range, formula, category…).
      for (const s of d?.settings ?? []) {
        const cur2 = n.values?.[s.name];
        let input: HTMLInputElement | HTMLSelectElement;
        if (s.type === "select") {
          input = el("select");
          for (const o of s.options ?? []) input.append(new Option(o, o, false, o === cur2));
        } else {
          input = el("input");
          input.type = s.type === "boolean" ? "checkbox" : s.type === "number" ? "number" : "text";
          // A slider's value is a slider over its range.
          if (n.type === "slider" && s.name === "value") {
            input.type = "range";
            input.min = String(n.values?.min ?? 0);
            input.max = String(n.values?.max ?? 10000);
            input.step = String(n.values?.step ?? 100);
          }
          if (s.type === "boolean") input.checked = !!cur2;
          else input.value = cur2 === undefined || cur2 === null ? "" : String(cur2);
        }
        input.onchange = () => setValue(s.name, input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input instanceof HTMLInputElement && (input.type === "number" || input.type === "range") ? Number(input.value) : input.value);
        const row = el("label", "ge-setting");
        row.append(el("span", "", s.name), input);
        box.append(row);
      }
      // Ports: inputs left (with a value box when unlinked), outputs right.
      const ports = el("div", "ge-ports");
      const ins = el("div", "ge-ins");
      const outs = el("div", "ge-outs");
      for (const p of d?.inputs ?? []) {
        const linked = params.links.some((l) => l.to.node === n.id && l.to.port === p.name);
        const row = el("div", "ge-port in");
        const dot = el("span", "ge-dot");
        dot.dataset.node = n.id;
        dot.dataset.port = p.name;
        dot.dataset.dir = "in";
        portEls.set(`in:${n.id}:${p.name}`, dot);
        row.append(dot, el("span", "", p.name));
        if (!linked && (p.type === "number" || p.type === "string")) {
          const v = el("input", "ge-val");
          v.type = p.type === "number" ? "number" : "text";
          const val = n.values?.[p.name] ?? p.default;
          v.value = val === undefined || val === null ? "" : String(val);
          v.onchange = () => setValue(p.name, p.type === "number" ? Number(v.value) : v.value);
          row.append(v);
        }
        ins.append(row);
      }
      for (const p of d?.outputs ?? []) {
        const row = el("div", "ge-port out");
        const dot = el("span", "ge-dot");
        portEls.set(`out:${n.id}:${p.name}`, dot);
        row.append(el("span", "", p.name), dot);
        // Drag from an output onto an input to link.
        dot.onpointerdown = (ev) => {
          ev.stopPropagation();
          const temp = document.createElementNS(NS, "path");
          temp.classList.add("ge-temp");
          svg.append(temp);
          const wr = world.getBoundingClientRect();
          const a = centre(dot, wr);
          const move = (e: PointerEvent) => temp.setAttribute("d", curve(a, { x: e.clientX - wr.left, y: e.clientY - wr.top }));
          const up = (e: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            temp.remove();
            const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".ge-port.in")?.querySelector(".ge-dot") as HTMLElement | null;
            if (!target?.dataset.node || !target.dataset.port) return;
            try {
              save("Link nodes", linkNodes(params, { node: n.id, port: p.name }, { node: target.dataset.node, port: target.dataset.port }));
            } catch (err) {
              host.status(`⚠ ${(err as Error).message}`);
            }
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        };
        outs.append(row);
      }
      ports.append(ins, outs);
      box.append(ports);
      if (r?.error) box.append(el("div", "ge-error", r.error));
      else if (r) {
        const watch = n.type === "watch";
        for (const p of d?.outputs ?? []) if (!watch || p.name === "value") box.append(el("div", watch ? "ge-watch" : "ge-out", `${watch ? "" : `${p.name}: `}${preview(doc, r.outputs[p.name], watch)}`));
      }
      box.onpointerdown = () => {
        selected = n.id;
        root.querySelectorAll(".ge-node.sel").forEach((x) => x.classList.remove("sel"));
        box.classList.add("sel");
      };
      world.append(box);
    }

    function centre(dot: HTMLElement, wr: DOMRect) {
      const b = dot.getBoundingClientRect();
      return { x: b.left + b.width / 2 - wr.left, y: b.top + b.height / 2 - wr.top };
    }
    function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
      const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
      return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
    }
    function drawLinks() {
      for (const p of [...svg.querySelectorAll("path:not(.ge-temp)")]) p.remove();
      const wr = world.getBoundingClientRect();
      for (const l of params.links) {
        const a = portEls.get(`out:${l.from.node}:${l.from.port}`);
        const b = portEls.get(`in:${l.to.node}:${l.to.port}`);
        if (!a || !b) continue;
        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", curve(centre(a, wr), centre(b, wr)));
        path.classList.add("ge-link");
        const t = document.createElementNS(NS, "title");
        t.textContent = "Click to remove the link";
        path.append(t);
        path.addEventListener("click", () => save("Remove link", { nodes: params.nodes, links: params.links.filter((x) => x !== l) }));
        svg.append(path);
      }
    }
    requestAnimationFrame(drawLinks);
  }
  render();
}
