// Collapsible Project Browser: every section heading (Views, Sheets, Schedules…) and sub-group
// (Floor Plans, Sections…) folds with a click. Applied after each render; the folded state is
// remembered in this browser.

const KEY = "open-bim.browser-collapsed";

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
const folded = load();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...folded]));
  } catch {
    // Not remembered.
  }
};

/** Fold sub-group `head` (a .subhead): hides the list items after it, up to the next sub-group. */
function applySub(head: HTMLElement, closed: boolean): void {
  head.classList.toggle("folded", closed);
  for (let n = head.nextElementSibling; n && !n.classList.contains("subhead") && n.classList.contains("list-item"); n = n.nextElementSibling) {
    (n as HTMLElement).hidden = closed;
  }
}

export function makeCollapsible(root: HTMLElement): void {
  for (const sec of root.querySelectorAll<HTMLElement>(":scope > .section")) {
    const h3 = sec.querySelector<HTMLElement>(":scope > h3");
    if (!h3) continue;
    const key = `s:${h3.textContent}`;
    h3.classList.add("fold-head");
    sec.classList.toggle("folded", folded.has(key));
    h3.onclick = () => {
      if (folded.has(key)) folded.delete(key);
      else folded.add(key);
      sec.classList.toggle("folded", folded.has(key));
      save();
    };
    for (const sub of sec.querySelectorAll<HTMLElement>(":scope > .subhead")) {
      const sk = `${key}/${sub.textContent}`;
      sub.classList.add("fold-head");
      applySub(sub, folded.has(sk));
      sub.onclick = () => {
        if (folded.has(sk)) folded.delete(sk);
        else folded.add(sk);
        applySub(sub, folded.has(sk));
        save();
      };
    }
  }
}
