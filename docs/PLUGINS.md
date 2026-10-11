# Plugins and scripting

Open-BIM runs JavaScript, both typed in the **Console** (toolbar → Console, or the `` ` `` key)
and as **plugins** (ES modules loaded from the console's *Load plugin…*). Loaded plugins are kept
in the app's local storage and reload at start-up.

## Console

Enter runs the input; Shift+Enter adds a line; ↑/↓ step through history. A single expression
prints its value (`doc.byCategory("Wall").length`). Use `return` to get a result from a longer
script. These are in scope:

| Name | What |
|---|---|
| `api` | The plugin API (below) |
| `doc` | The open document (the family while you're editing one) |
| `core`, `geometry` | Every export of `@open-bim/core` and `@open-bim/geometry` |
| `print(...)` | Write to the console |
| `selection` | The selected elements |

Model edits go through transactions, the same as in the app, and each one is a single undo step:

```js
api.transact("Grid line", (tx) => core.createGrid(tx, doc, { x: 0, y: -2000 }, { x: 0, y: 12000 }));
```

## Plugin modules

```js
export default {
  name: "My plugin",
  activate(api) {
    api.addCommand({ id: "count-walls", label: "Count walls", run() {
      api.status(`${api.doc.byCategory("Wall").length} walls`);
    } });
    // Optionally return a cleanup function, called when the plugin is unloaded.
  },
};
```

`export function activate(api)` (with an optional `export const name`) and
`export default function activate(api)` also work. Each command gets a button in the console bar.
See `examples/plugins/room-numbering.js`.

## API (version 1)

| Member | |
|---|---|
| `version` | `1` |
| `doc` | Live `Document` (`all()`, `get(id)`, `byCategory(cat)`, `transact`, `undo`, `on`) |
| `core`, `geometry` | Package exports (`Cat`, `createWall`, `scheduleTable`, `roomBoundary`, …) |
| `transact(name, fn)` | Run `fn(tx)` as one undoable transaction |
| `selection()` / `select(ids)` | Read or set the selection |
| `activeView()` / `activeLevel()` | Current view and level elements |
| `status(text)` / `print(...values)` | Status bar / console output |
| `addCommand({ id, label, run })` | Register a command (only during `activate`) |
| `run(id)` | Run a registered command |
| `onChange(fn)` | Model change notifications; returns an unsubscribe function |

The API is also available in the browser's developer tools as `openBim`.

Plugins run with the app's full rights, the same as Revit macros. Only load plugins you trust.
