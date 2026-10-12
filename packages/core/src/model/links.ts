import { registerCategory } from "../categories.ts";
import { Document, type DocumentJSON, type Transaction } from "../document.ts";
import type { Element, ElementId, ParamValue } from "../element.ts";
import { Cat } from "./architecture.ts";
import { fromShared, projectLocation, toShared } from "./settings.ts";

// Linked models (Revit: Link Revit). A Link holds a snapshot of another Open-BIM project (so it
// draws without the file) and where that file lives, so it can be reloaded. It's placed either
// origin to origin or by shared coordinates (the two projects' survey locations), plus an offset.

export type LinkPositioning = "origin" | "shared";

export type LinkParams = {
  /** Where the linked file was loaded from (desktop path, or just a name in the browser). */
  path: string;
  /** The linked project, as saved. */
  json: { [key: string]: ParamValue };
  positioning: LinkPositioning;
  /** Extra move after positioning, mm, and rotation about the host origin, radians. */
  offset: { x: number; y: number; z: number };
  rotation: number;
};
export type Link = Element<LinkParams>;

registerCategory({ name: Cat.Link, dependencies: () => [], cascadeDelete: false, isType: false });

const docs = new WeakMap<object, Document>();

/** The linked project as a (read-only) document, parsed once per snapshot. */
export function linkDocument(link: Link): Document {
  let d = docs.get(link.params.json);
  if (!d) docs.set(link.params.json, (d = Document.fromJSON(link.params.json as unknown as DocumentJSON)));
  return d;
}

export function createLink(tx: Transaction, json: DocumentJSON, path: string, positioning: LinkPositioning = "origin"): Link {
  if ((json as { format?: string }).format !== "open-bim") throw new Error("That isn't an Open-BIM project");
  const name = path.split(/[\\/]/).pop() ?? path;
  return tx.create<LinkParams>(
    Cat.Link,
    { path, json: json as unknown as LinkParams["json"], positioning, offset: { x: 0, y: 0, z: 0 }, rotation: 0 },
    { name },
  ) as Link;
}

/** Replace a link's snapshot (Revit: Reload From). */
export function reloadLink(tx: Transaction, linkId: ElementId, json: DocumentJSON, path?: string): void {
  if ((json as { format?: string }).format !== "open-bim") throw new Error("That isn't an Open-BIM project");
  tx.update<LinkParams>(linkId, { json: json as unknown as LinkParams["json"], ...(path ? { path } : {}) });
}

/** Linked-project point (mm) → host project point (mm). */
export function linkTransform(host: Document, link: Link): (p: [number, number, number]) => [number, number, number] {
  const { offset, rotation, positioning } = link.params;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const base =
    positioning === "shared"
      ? (() => {
          const from = projectLocation(linkDocument(link));
          const to = projectLocation(host);
          return (p: [number, number, number]): [number, number, number] => {
            const q = fromShared(to, toShared(from, { x: p[0], y: p[1], z: p[2] }));
            return [q.x, q.y, q.z];
          };
        })()
      : (p: [number, number, number]) => p;
  return (p) => {
    const [x, y, z] = base(p);
    return [x * c - y * s + offset.x, x * s + y * c + offset.y, z + offset.z];
  };
}

export function links(doc: Document): Link[] {
  return doc.byCategory<LinkParams>(Cat.Link) as Link[];
}
