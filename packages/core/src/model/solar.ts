import type { Document } from "../document.ts";
import { projectLocation, type SiteLocation } from "./settings.ts";
import { viewSunDate, type ViewParams } from "./viewdefs.ts";

// Sun position for renders and shadow studies: NZTM2000 → latitude/longitude, then the NOAA solar
// position equations (accurate to well under a degree, plenty for daylight). Grid convergence
// (true vs grid north, ±2° across NZ) is ignored.

const RAD = Math.PI / 180;

/** NZTM2000 (EPSG:2193) eastings/northings in metres → latitude/longitude in degrees (GRS80). */
export function nztmToLatLon(e: number, n: number): { lat: number; lon: number } {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const lon0 = 173 * RAD;
  const fe = 1600000;
  const fn = 10000000;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const x = e - fe;
  const y = n - fn;
  // Footpoint latitude from the meridian distance.
  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1);
  const c = Math.cos(phi1);
  const t = Math.tan(phi1) ** 2;
  const c1 = ep2 * c * c;
  const n1 = a / Math.sqrt(1 - e2 * s * s);
  const r1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
  const d = x / (n1 * k0);
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      ((d * d) / 2 - ((5 + 3 * t + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t + 298 * c1 + 45 * t * t - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon = lon0 + (d - ((1 + 2 * t + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t - 3 * c1 * c1 + 8 * ep2 + 24 * t * t) * d ** 5) / 120) / c;
  return { lat: lat / RAD, lon: lon / RAD };
}

/**
 * Sun position at an instant (UTC via the Date) and place: azimuth in degrees clockwise from true
 * north, altitude in degrees above the horizon.
 */
export function sunPosition(date: Date, lat: number, lon: number): { azimuth: number; altitude: number } {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const centre = Math.sin(m * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * jc) + Math.sin(3 * m * RAD) * 0.000289;
  const trueLong = l0 + centre;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const obliq0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = obliq0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));
  const yv = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime =
    4 *
    (yv * Math.sin(2 * l0 * RAD) -
      2 * ecc * Math.sin(m * RAD) +
      4 * ecc * yv * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * yv * yv * Math.sin(4 * l0 * RAD) -
      1.25 * ecc * ecc * Math.sin(2 * m * RAD)) /
    RAD;
  const minutes = (((date.getTime() / 60000) % 1440) + 1440) % 1440;
  const trueSolar = (((minutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = (trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZen = Math.min(1, Math.max(-1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle)));
  const zen = Math.acos(cosZen);
  const az = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180;
  return { azimuth: ((az % 360) + 360) % 360, altitude: 90 - zen / RAD };
}

/** The site's latitude/longitude (NZTM locations; others fall back to Wellington). */
export function siteLatLon(loc: SiteLocation): { lat: number; lon: number } {
  if (loc.epsg === 2193 && loc.eastings > 0 && loc.northings > 0) return nztmToLatLon(loc.eastings, loc.northings);
  return { lat: -41.29, lon: 174.78 };
}

/**
 * Unit vector towards the sun in project coordinates (x, y plan, z up), for the project's location
 * and orientation, plus the raw angles.
 */
export function sunDirection(doc: Document, date: Date): { x: number; y: number; z: number; azimuth: number; altitude: number } {
  const { lat, lon } = siteLatLon(projectLocation(doc));
  const { azimuth, altitude } = sunPosition(date, lat, lon);
  return sunFromAngles(doc, azimuth, altitude);
}

/** Direction towards a sun at `azimuth` (degrees from true north, clockwise) and `altitude` above the horizon, in project axes. */
export function sunFromAngles(doc: Document, azimuth: number, altitude: number): { x: number; y: number; z: number; azimuth: number; altitude: number } {
  const loc = projectLocation(doc);
  const alt = altitude * RAD;
  // Grid (east, north) components, then into project axes (project X is `rotation` from east).
  const e = Math.sin(azimuth * RAD) * Math.cos(alt);
  const n = Math.cos(azimuth * RAD) * Math.cos(alt);
  const c = Math.cos(loc.rotation);
  const s = Math.sin(loc.rotation);
  return { x: e * c + n * s, y: -e * s + n * c, z: Math.sin(alt), azimuth, altitude };
}

/** The sun a 3D view shows: its Lighting angles, or the true sun at its study's current frame. */
export function viewSun(doc: Document, p: ViewParams): { x: number; y: number; z: number; azimuth: number; altitude: number } {
  if (p.sun?.study === "lighting") return sunFromAngles(doc, p.sun.azimuth ?? 135, p.sun.altitude ?? 35);
  return sunDirection(doc, viewSunDate(p));
}
