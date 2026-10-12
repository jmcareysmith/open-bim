// IFC GlobalIds: 128 bits written as 22 characters of IFC's base-64 alphabet (first character
// carries 2 bits). Element ids that are UUIDs map directly, so re-exports keep the same GlobalIds;
// other ids are hashed to 128 bits.

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

function bytesFrom(id: string): number[] {
  const hex = id.replace(/-/g, "");
  if (/^[0-9a-fA-F]{32}$/.test(hex)) return hex.match(/../g)!.map((b) => parseInt(b, 16));
  // FNV-1a over the id with four seeds, 32 bits each.
  const out: number[] = [];
  for (let seed = 0; seed < 4; seed++) {
    let h = (0x811c9dc5 ^ (seed * 0x9e3779b9)) >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  }
  return out;
}

/** 22-character IFC GlobalId for an element id (or any string key). */
export function ifcGuid(id: string): string {
  const b = bytesFrom(id);
  // 2 bits, then 21 groups of 6 bits = 128 bits.
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let s = "";
  for (let i = 0; i < 22; i++) {
    s = CHARS[Number(n & 63n)]! + s;
    n >>= 6n;
  }
  return s;
}

/** Inverse of `ifcGuid` for UUID-derived GlobalIds (used when re-importing our own files). */
export function uuidFromIfcGuid(g: string): string {
  if (g.length !== 22) throw new Error(`Not an IFC GlobalId: ${g}`);
  let n = 0n;
  for (const ch of g) {
    const v = CHARS.indexOf(ch);
    if (v < 0) throw new Error(`Not an IFC GlobalId: ${g}`);
    n = (n << 6n) | BigInt(v);
  }
  const hex = n.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
