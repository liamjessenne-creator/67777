/**
 * Interactive wireframe globe (HTML canvas, no dependencies).
 *
 * - Rotating dot-grid Earth with 2,000+ pseudo-random land points
 * - "Internet" arcs pulsing between random cities + node blips
 * - Drag to rotate, scroll to zoom (interactive)
 * - `onEnter` fires when the user clicks the globe (or presses Enter)
 * - `focus` prop: when true the globe drifts to the right half of the canvas
 *   so the landing headline can sit on the left
 */

import { useEffect, useRef } from "react";

interface City {
  name: string;
  lat: number;
  lon: number;
}

const CITIES: City[] = [
  { name: "Paris", lat: 48.85, lon: 2.35 },
  { name: "Lyon", lat: 45.76, lon: 4.83 },
  { name: "Marseille", lat: 43.29, lon: 5.37 },
  { name: "Lille", lat: 50.63, lon: 3.06 },
  { name: "Bordeaux", lat: 44.84, lon: -0.58 },
  { name: "Nantes", lat: 47.22, lon: -1.55 },
  { name: "Toulouse", lat: 43.6, lon: 1.44 },
  { name: "Strasbourg", lat: 48.57, lon: 7.75 },
  { name: "Bruxelles", lat: 50.85, lon: 4.35 },
  { name: "Genève", lat: 46.2, lon: 6.14 },
  { name: "Madrid", lat: 40.42, lon: -3.7 },
  { name: "Barcelona", lat: 41.39, lon: 2.17 },
  { name: "Milano", lat: 45.46, lon: 9.19 },
  { name: "Berlin", lat: 52.52, lon: 13.4 },
  { name: "London", lat: 51.51, lon: -0.13 },
  { name: "Amsterdam", lat: 52.37, lon: 4.9 },
  { name: "Lisboa", lat: 38.72, lon: -9.14 },
  { name: "Casablanca", lat: 33.57, lon: -7.59 },
  { name: "Algiers", lat: 36.75, lon: 3.06 },
  { name: "Tunis", lat: 36.8, lon: 10.18 },
  { name: "New York", lat: 40.71, lon: -74.0 },
  { name: "Montréal", lat: 45.5, lon: -73.57 },
  { name: "Dubai", lat: 25.2, lon: 55.27 },
  { name: "Singapore", lat: 1.35, lon: 103.82 },
  { name: "Tokyo", lat: 35.68, lon: 139.69 },
  { name: "São Paulo", lat: -23.55, lon: -46.63 },
];

/** Continents as lon/lat polygons (coarse but recognizable silhouettes). */
const LAND: Array<Array<[number, number]>> = [
  // North America
  [[-168, 66], [-140, 70], [-120, 69], [-95, 72], [-80, 73], [-62, 60], [-55, 52], [-65, 45], [-75, 40], [-81, 31], [-81, 25], [-97, 26], [-105, 22], [-97, 16], [-90, 14], [-83, 9], [-77, 8], [-85, 12], [-95, 16], [-105, 20], [-110, 24], [-117, 33], [-124, 40], [-125, 49], [-135, 58], [-155, 58], [-165, 60]],
  // Greenland
  [[-45, 60], [-25, 70], [-20, 76], [-30, 82], [-55, 82], [-60, 76], [-55, 68]],
  // South America
  [[-77, 8], [-70, 12], [-62, 10], [-52, 5], [-44, -2], [-35, -6], [-38, -13], [-48, -18], [-53, -25], [-58, -30], [-62, -35], [-65, -41], [-66, -47], [-69, -52], [-73, -50], [-72, -42], [-73, -35], [-70, -25], [-70, -18], [-76, -10], [-79, -4], [-80, 1]],
  // Europe
  [[-9, 43], [-9, 38], [-6, 36], [0, 38], [3, 42], [8, 44], [12, 44], [16, 42], [19, 40], [23, 37], [27, 40], [30, 46], [38, 47], [48, 48], [55, 52], [58, 58], [50, 62], [40, 66], [30, 70], [25, 71], [18, 68], [12, 65], [8, 63], [5, 61], [8, 57], [8, 54], [4, 52], [0, 49], [-2, 47], [-4, 44]],
  // UK + Ireland blob
  [[-10, 52], [-6, 55], [-8, 58], [-3, 59], [0, 53], [-2, 51], [-6, 50]],
  // Africa
  [[-17, 15], [-16, 20], [-10, 26], [-6, 33], [0, 36], [10, 37], [20, 32], [30, 31], [35, 28], [38, 22], [43, 12], [51, 12], [48, 5], [42, -1], [40, -10], [36, -18], [33, -26], [27, -34], [20, -35], [17, -30], [13, -22], [12, -14], [9, -6], [9, 0], [6, 4], [-4, 5], [-10, 6], [-14, 9]],
  // Middle East + Asia
  [[35, 28], [45, 26], [52, 24], [57, 23], [60, 25], [67, 24], [72, 20], [77, 8], [81, 13], [87, 21], [92, 22], [95, 16], [98, 10], [104, 2], [106, 10], [108, 16], [110, 21], [117, 23], [122, 30], [122, 37], [127, 40], [130, 43], [135, 47], [142, 50], [145, 55], [155, 58], [162, 60], [170, 62], [178, 65], [178, 70], [160, 70], [140, 72], [120, 73], [100, 76], [85, 74], [70, 72], [60, 70], [50, 68], [48, 60], [50, 52], [48, 48], [40, 47], [38, 44], [30, 46]],
  // India tip already in Asia; SE Asia islands
  [[95, 5], [105, -3], [115, -5], [125, -6], [135, -4], [141, -3], [132, 1], [120, 2], [108, 3]],
  // Australia
  [[114, -22], [114, -30], [118, -35], [125, -33], [132, -32], [138, -35], [144, -38], [150, -37], [153, -30], [153, -25], [147, -19], [142, -11], [136, -12], [130, -13], [125, -15], [120, -19]],
  // New Zealand
  [[173, -35], [176, -38], [174, -41], [170, -44], [167, -46], [170, -43], [173, -40]],
  // Japan
  [[130, 31], [134, 34], [138, 36], [141, 39], [142, 43], [140, 42], [137, 37], [133, 34], [129, 32]],
];

function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

interface LandPoint {
  lat: number;
  lon: number;
  size: number;
}

/** Deterministic pseudo-random land points (~2,200) sampled inside the polygons. */
function buildLandPoints(): LandPoint[] {
  const pts: LandPoint[] = [];
  const N = 3400;
  for (let i = 0; i < N; i++) {
    const lat = hash1(i * 3.13) * 160 - 80;
    const lon = hash1(i * 7.77 + 42) * 360 - 180;
    for (const poly of LAND) {
      let inside = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [xa, ya] = poly[a];
        const [xb, yb] = poly[b];
        if (yb > lat !== ya > lat && lon < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) {
          inside = !inside;
        }
      }
      if (inside) {
        pts.push({ lat, lon, size: 0.7 + hash1(i * 11.1) * 1.1 });
        break;
      }
    }
  }
  return pts;
}

interface Arc {
  a: City;
  b: City;
  t: number;
  speed: number;
  life: number;
}

interface Blip {
  city: City;
  t: number;
  next: number;
}

const DEG = Math.PI / 180;

function project(
  lat: number,
  lon: number,
  rotY: number,
  rotX: number,
  radius: number,
): { x: number; y: number; z: number } {
  const la = lat * DEG;
  const lo = lon * DEG + rotY;
  let x = Math.cos(la) * Math.sin(lo);
  let y = Math.sin(la);
  let z = Math.cos(la) * Math.cos(lo);
  // tilt around X axis
  const y2 = y * Math.cos(rotX) - z * Math.sin(rotX);
  const z2 = y * Math.sin(rotX) + z * Math.cos(rotX);
  return { x: x * radius, y: y2 * radius, z: z2 * radius };
}

interface Props {
  onEnter: () => void;
  /** When true, drift the globe toward the right half of the canvas. */
  focus?: boolean;
}

export function Globe({ onEnter, focus = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ rotY: 0, rotX: 0.42, autoSpin: true, zoom: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const landPoints = buildLandPoints();
    const arcs: Arc[] = [];
    const blips: Blip[] = CITIES.slice(0, 12).map((c) => ({
      city: c,
      t: 0,
      next: 1 + Math.random() * 5,
    }));

    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let focusX = 0.5;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(rect.width, 10);
      h = Math.max(rect.height, 10);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ---- interaction ----
    let dragging = false;
    let dragDist = 0;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      dragDist = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      stateRef.current.autoSpin = false;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      dragDist += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      stateRef.current.rotY += (e.clientX - lastX) * 0.005;
      stateRef.current.rotX = Math.max(
        -1.2,
        Math.min(1.2, stateRef.current.rotX + (e.clientY - lastY) * 0.005),
      );
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      dragging = false;
      setTimeout(() => (stateRef.current.autoSpin = true), 1200);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stateRef.current.zoom = Math.max(0.6, Math.min(2.2, stateRef.current.zoom - e.deltaY * 0.0012));
    };
    const onClick = () => {
      // Only treat a real click (not the end of a drag) as "enter"
      if (dragDist < 6) onEnter();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("click", onClick);

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const s = stateRef.current;
      if (s.autoSpin && !dragging) s.rotY += dt * 0.12;

      // smooth focus drift (globe center on the right half when focused)
      const targetX = focus ? 0.72 : 0.5;
      focusX += (targetX - focusX) * Math.min(1, dt * 2.5);

      const cx = w * focusX;
      const cy = h * 0.52;
      const R = Math.min(w, h) * 0.33 * s.zoom;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // ambient glow
      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.9);
      glow.addColorStop(0, "rgba(16,185,129,0.10)");
      glow.addColorStop(0.5, "rgba(16,185,129,0.03)");
      glow.addColorStop(1, "rgba(16,185,129,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // limb (edge circle)
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(16,185,129,0.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // inner latitude/longitude graticule (back faces dimmed)
      ctx.lineWidth = 0.6;
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 5) {
          const p = project(lat, lon, s.rotY, s.rotX, R);
          if (p.z < 0) {
            started = false;
            continue;
          }
          const px = cx + p.x;
          const py = cy - p.y;
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = "rgba(148,163,184,0.10)";
        ctx.stroke();
      }
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath();
        let started = false;
        for (let lat = -90; lat <= 90; lat += 5) {
          const p = project(lat, lon, s.rotY, s.rotX, R);
          if (p.z < 0) {
            started = false;
            continue;
          }
          const px = cx + p.x;
          const py = cy - p.y;
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = "rgba(148,163,184,0.10)";
        ctx.stroke();
      }

      // land points
      for (const pt of landPoints) {
        const p = project(pt.lat, pt.lon, s.rotY, s.rotX, R);
        if (p.z < 0) continue;
        const depth = 0.35 + 0.65 * p.z; // brighter near the limb center
        ctx.fillStyle = `rgba(52,211,153,${0.14 + 0.5 * depth})`;
        ctx.fillRect(cx + p.x - pt.size / 2, cy - p.y - pt.size / 2, pt.size, pt.size);
      }

      // city nodes + arcs
      for (const c of CITIES) {
        const p = project(c.lat, c.lon, s.rotY, s.rotX, R);
        if (p.z <= 0) continue;
        const px = cx + p.x;
        const py = cy - p.y;
        ctx.beginPath();
        ctx.arc(px, py, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(94,234,212,0.85)";
        ctx.fill();
      }

      // spawn arcs + blips
      for (const b of blips) {
        b.next -= dt;
        if (b.next <= 0) {
          b.next = 4 + Math.random() * 7;
          const other = CITIES[Math.floor(Math.random() * CITIES.length)];
          if (other !== b.city) {
            arcs.push({ a: b.city, b: other, t: 0, speed: 0.5 + Math.random() * 0.4, life: 3.2 });
          }
          b.t = 1;
        }
        if (b.t > 0) {
          b.t = Math.max(0, b.t - dt * 1.4);
          const p = project(b.city.lat, b.city.lon, s.rotY, s.rotX, R);
          if (p.z > 0) {
            const r = 2 + 8 * (1 - b.t);
            ctx.beginPath();
            ctx.arc(cx + p.x, cy - p.y, r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(94,234,212,${0.5 * b.t})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      for (let i = arcs.length - 1; i >= 0; i--) {
        const arc = arcs[i];
        arc.t += dt * arc.speed;
        if (arc.t >= 1.6) {
          arcs.splice(i, 1);
          continue;
        }
        arc.life -= dt;
        const A = project(arc.a.lat, arc.a.lon, s.rotY, s.rotX, R);
        const B = project(arc.b.lat, arc.b.lon, s.rotY, s.rotX, R);
        if (A.z < 0 && B.z < 0) continue;
        const ax = cx + A.x;
        const ay = cy - A.y;
        const bx = cx + B.x;
        const by = cy - B.y;
        // quadratic control point: lift the arc away from the globe center
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const dx = mx - cx;
        const dy = my - cy;
        const dl = Math.hypot(dx, dy) || 1;
        const lift = 0.35 + 0.25 * Math.hypot(bx - ax, by - ay) / (2 * R);
        const qx = mx + (dx / dl) * dl * lift;
        const qy = my + (dy / dl) * dl * lift;
        const alpha = Math.max(0, Math.min(1, arc.life)) * 0.8;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(qx, qy, bx, by);
        ctx.strokeStyle = `rgba(45,212,191,${0.16 * alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        // traveling pulse
        if (arc.t <= 1) {
          const t = arc.t;
          const px = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * qx + t * t * bx;
          const py = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * qy + t * t * by;
          ctx.beginPath();
          ctx.arc(px, py, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(153,246,228,${alpha})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(45,212,191,${0.25 * alpha})`;
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("click", onClick);
    };
  }, [onEnter, focus]);

  return (
    <canvas
      ref={canvasRef}
      role="button"
      tabIndex={0}
      aria-label="Interactive globe — click to open GeoLead Finder AI"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEnter();
        }
      }}
      className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing focus:outline-none"
    />
  );
}
