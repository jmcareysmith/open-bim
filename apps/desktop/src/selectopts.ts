// Selection options (Revit's status bar toggles at the bottom right): select pinned elements, and
// drag elements on selection (press on any element and drag to move it). Remembered per browser.

const KEY = "open-bim.selectOptions";

export interface SelectOptions {
  /** Pinned elements can be picked (off: clicks and boxes pass over them). */
  selectPinned: boolean;
  /** Press on an unselected element and drag: it moves (off: only the selection drags). */
  dragOnSelection: boolean;
}

function load(): SelectOptions {
  const d: SelectOptions = { selectPinned: true, dragOnSelection: false };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SelectOptions>) };
  } catch {
    return d;
  }
}

export const selectOptions: SelectOptions = load();

export function setSelectOption<K extends keyof SelectOptions>(k: K, v: SelectOptions[K]): void {
  selectOptions[k] = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(selectOptions));
  } catch {
    /* not remembered */
  }
}
