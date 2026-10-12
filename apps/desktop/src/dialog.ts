// Small UI pieces: right-click context menus and modal dialogs.

export type MenuItem = { label: string; hint?: string; action: () => void; disabled?: boolean } | "-" | { heading: string };

let openMenu: HTMLDivElement | null = null;

export function closeContextMenu(): void {
  openMenu?.remove();
  openMenu = null;
}

/** Show a context menu at page coordinates; closes on pick, Esc or a click elsewhere. */
export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  for (const it of items) {
    if (it === "-") {
      menu.append(Object.assign(document.createElement("hr"), {}));
      continue;
    }
    if ("heading" in it) {
      const hd = document.createElement("div");
      hd.className = "context-heading";
      hd.textContent = it.heading;
      menu.append(hd);
      continue;
    }
    const b = document.createElement("button");
    b.disabled = !!it.disabled;
    b.append(Object.assign(document.createElement("span"), { textContent: it.label }));
    if (it.hint) b.append(Object.assign(document.createElement("kbd"), { textContent: it.hint }));
    b.onclick = () => {
      closeContextMenu();
      it.action();
    };
    menu.append(b);
  }
  document.body.append(menu);
  // Keep it on screen.
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  openMenu = menu;
}

window.addEventListener("pointerdown", (ev) => {
  if (openMenu && !openMenu.contains(ev.target as Node)) closeContextMenu();
});
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && openMenu) closeContextMenu();
});

/**
 * A modal dialog. `render` builds the body and is called again by the returned `refresh`
 * (e.g. after model changes). Returns a handle to refresh or close it.
 */
export function openDialog(title: string, render: () => HTMLElement, onClose?: () => void): { refresh(): void; close(): void } {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  const box = document.createElement("div");
  box.className = "dialog";
  const head = document.createElement("div");
  head.className = "dialog-head";
  const close = document.createElement("button");
  close.textContent = "Close";
  head.append(Object.assign(document.createElement("h2"), { textContent: title }), close);
  const body = document.createElement("div");
  body.className = "dialog-body";
  box.append(head, body);
  backdrop.append(box);
  document.body.append(backdrop);
  const refresh = () => {
    const top = body.scrollTop;
    body.replaceChildren(render());
    body.scrollTop = top;
  };
  const done = () => {
    backdrop.remove();
    window.removeEventListener("keydown", esc, true);
    onClose?.();
  };
  const esc = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.stopPropagation();
    done();
  };
  close.onclick = done;
  backdrop.onpointerdown = (ev) => {
    if (ev.target === backdrop) done();
  };
  window.addEventListener("keydown", esc, true);
  refresh();
  return { refresh, close: done };
}
