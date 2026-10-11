import * as core from "@open-bim/core";
import * as geometry from "@open-bim/geometry";
import { inspect, pluginFromModule, runScript, type Document, type Element, type ElementId, type PluginCommand, type Transaction } from "@open-bim/core";

// Plugin API and scripting console. Plugins and console scripts get the same `api` object: the
// live document, every core and geometry export, selection and view state, and commands. All
// model edits still go through `transact`, so a script or command is one undo step.

/** What the app exposes to the plugin host. */
export interface PluginHostApp {
  doc(): Document;
  selection(): ElementId[];
  setSelection(ids: ElementId[]): void;
  activeViewId(): ElementId | undefined;
  activeLevelId(): ElementId;
  status(text: string): void;
}

/** The plugin / script API (version 1). See docs/PLUGINS.md. */
export interface OpenBimApi {
  readonly version: 1;
  /** The open document (the family document while editing a family). */
  readonly doc: Document;
  /** All of @open-bim/core and @open-bim/geometry. */
  readonly core: typeof core;
  readonly geometry: typeof geometry;
  transact<T>(name: string, fn: (tx: Transaction) => T): T;
  selection(): Element[];
  select(ids: ElementId[]): void;
  activeView(): Element | undefined;
  activeLevel(): Element | undefined;
  status(text: string): void;
  /** Write to the console. */
  print(...values: unknown[]): void;
  /** Add a command (shown under Plugins in the console, runnable from scripts via api.run). */
  addCommand(cmd: PluginCommand): void;
  run(commandId: string): Promise<void>;
  /** Listen for model changes; returns an unsubscribe function. */
  onChange(fn: (c: core.ChangeSet) => void): () => void;
}

const STORE = "open-bim.plugins";

interface Loaded {
  name: string;
  source: string;
  commands: PluginCommand[];
  dispose?: () => void;
}

export class PluginHost {
  readonly api: OpenBimApi;
  private loaded = new Map<string, Loaded>();
  private current: Loaded | null = null;
  private printer: (line: string, kind?: "out" | "err") => void = () => {};
  /** Called when plugins or commands change. */
  onChanged: () => void = () => {};

  constructor(private app: PluginHostApp) {
    const host = this;
    const allCommands = () => [...host.loaded.values()].flatMap((l) => l.commands);
    this.api = {
      version: 1,
      get doc() {
        return app.doc();
      },
      core,
      geometry,
      transact: (name, fn) => app.doc().transact(name, fn),
      selection: () => app.selection().flatMap((id) => app.doc().get(id) ?? []),
      select: (ids) => app.setSelection(ids),
      activeView: () => {
        const id = app.activeViewId();
        return id ? app.doc().get(id) : undefined;
      },
      activeLevel: () => app.doc().get(app.activeLevelId()),
      status: (t) => app.status(t),
      print: (...values) => host.printer(values.map((v) => inspect(v)).join(" ")),
      addCommand: (cmd) => {
        if (!cmd || typeof cmd.run !== "function" || !cmd.id) throw new Error("Commands need an id and run()");
        const owner = host.current;
        if (!owner) throw new Error("Commands can only be added while a plugin activates");
        owner.commands = owner.commands.filter((c) => c.id !== cmd.id).concat({ id: cmd.id, label: cmd.label || cmd.id, run: cmd.run });
      },
      run: async (id) => {
        const cmd = allCommands().find((c) => c.id === id);
        if (!cmd) throw new Error(`No command "${id}"`);
        await cmd.run();
      },
      onChange: (fn) => app.doc().on(fn),
    };
  }

  setPrinter(p: (line: string, kind?: "out" | "err") => void): void {
    this.printer = p;
  }

  plugins(): { name: string; commands: PluginCommand[] }[] {
    return [...this.loaded.values()].map((l) => ({ name: l.name, commands: l.commands }));
  }

  /** Load (or reload) a plugin from ES module source. */
  async load(source: string, fileName = "Plugin", persist = true): Promise<string> {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    let mod: Record<string, unknown>;
    try {
      mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
    } finally {
      URL.revokeObjectURL(url);
    }
    const def = pluginFromModule<OpenBimApi>(mod, fileName.replace(/\.m?js$/, ""));
    this.unload(def.name, false);
    const entry: Loaded = { name: def.name, source, commands: [] };
    this.current = entry;
    try {
      const dispose = await def.activate(this.api);
      if (typeof dispose === "function") entry.dispose = dispose;
    } finally {
      this.current = null;
    }
    this.loaded.set(def.name, entry);
    if (persist) this.save();
    this.onChanged();
    return def.name;
  }

  unload(name: string, persist = true): void {
    const l = this.loaded.get(name);
    if (!l) return;
    try {
      l.dispose?.();
    } catch (err) {
      this.printer(`${name}: ${(err as Error).message}`, "err");
    }
    this.loaded.delete(name);
    if (persist) this.save();
    this.onChanged();
  }

  /** Reload plugins saved in this browser/WebView profile. */
  async restore(): Promise<void> {
    let saved: { name: string; source: string }[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(STORE) ?? "[]") as typeof saved;
    } catch {
      saved = [];
    }
    for (const p of saved) {
      try {
        await this.load(p.source, p.name, false);
      } catch (err) {
        this.printer(`Plugin ${p.name} failed to load: ${(err as Error).message}`, "err");
      }
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify([...this.loaded.values()].map((l) => ({ name: l.name, source: l.source }))));
    } catch {
      // Storage full or unavailable: plugins still work this session.
    }
  }

  /** Run console input with `api`, `doc`, `core`, `geometry`, `print` and `selection` in scope. */
  async runConsole(code: string): Promise<unknown> {
    const api = this.api;
    return runScript(code, { api, doc: api.doc, core, geometry, print: api.print, selection: api.selection() });
  }
}

/** The console panel: output log, input (Enter runs, Shift+Enter new line, ↑/↓ history), plugins. */
export function mountConsole(root: HTMLElement, host: PluginHost, openFile: () => Promise<{ text: string; name: string } | null>, afterRun: () => void): void {
  const out = document.createElement("div");
  out.className = "console-out";
  const input = document.createElement("textarea");
  input.className = "console-in";
  input.rows = 2;
  input.placeholder = "JavaScript: e.g. doc.byCategory(\"Wall\").length   (api, doc, core, geometry, print, selection)";
  const bar = document.createElement("div");
  bar.className = "console-bar";
  root.replaceChildren(bar, out, input);

  const print = (line: string, kind: "out" | "err" | "in" = "out") => {
    const div = document.createElement("div");
    div.className = `console-line ${kind}`;
    div.textContent = line;
    out.append(div);
    out.scrollTop = out.scrollHeight;
  };
  host.setPrinter((l, k) => print(l, k));

  const renderBar = () => {
    const title = document.createElement("strong");
    title.textContent = "Console";
    const load = document.createElement("button");
    load.textContent = "Load plugin…";
    load.onclick = async () => {
      const f = await openFile();
      if (!f) return;
      try {
        const name = await host.load(f.text, f.name);
        print(`Loaded plugin ${name}`);
      } catch (err) {
        print(`Plugin failed: ${(err as Error).message}`, "err");
      }
    };
    const clear = document.createElement("button");
    clear.textContent = "Clear";
    clear.onclick = () => out.replaceChildren();
    const items: HTMLElement[] = [title, load, clear];
    for (const p of host.plugins()) {
      const tag = document.createElement("span");
      tag.className = "console-plugin";
      tag.textContent = p.name;
      const rm = document.createElement("button");
      rm.textContent = "×";
      rm.title = `Unload ${p.name}`;
      rm.onclick = () => host.unload(p.name);
      tag.append(rm);
      items.push(tag);
      for (const c of p.commands) {
        const b = document.createElement("button");
        b.textContent = c.label;
        b.title = `${p.name}: ${c.id}`;
        b.onclick = async () => {
          try {
            await c.run();
          } catch (err) {
            print(`${c.label}: ${(err as Error).message}`, "err");
          }
          afterRun();
        };
        items.push(b);
      }
    }
    bar.replaceChildren(...items);
  };
  host.onChanged = renderBar;
  renderBar();

  const history: string[] = [];
  let at = 0;
  input.addEventListener("keydown", async (ev) => {
    ev.stopPropagation(); // keep tool shortcuts out of the console
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      const code = input.value.trim();
      if (!code) return;
      history.push(code);
      at = history.length;
      input.value = "";
      print(`> ${code}`, "in");
      try {
        const v = await host.runConsole(code);
        if (v !== undefined) print(inspect(v));
      } catch (err) {
        print(err instanceof Error ? `${err.name}: ${err.message}` : String(err), "err");
      }
      afterRun();
    } else if (ev.key === "ArrowUp" && !input.value.includes("\n") && at > 0) {
      ev.preventDefault();
      input.value = history[--at] ?? "";
    } else if (ev.key === "ArrowDown" && !input.value.includes("\n")) {
      ev.preventDefault();
      at = Math.min(history.length, at + 1);
      input.value = history[at] ?? "";
    }
  });
}
