// The content engine from the film, built live in three.js: an isometric island where topic cards ride a
// belt through five stations (script, voice, visuals, edit, publish) and land on a phone and a monitor.
// It plays an intro on first load, follows the pointer a little, and the camera flies station to station
// as the "How it works" panels scroll by. Everything degrades to the poster image without WebGL.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const canvas = document.getElementById("world");
const root = document.documentElement;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = () => innerWidth < 760;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch (e) {
  root.classList.add("no-webgl");
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, small() ? 1.75 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const ISO_DIR = new THREE.Vector3(1, 0.9, 1).normalize();
const CAM_DIST = 120;

// ---------- palette (the film's) ----------
const C = {
  tile: 0xf8f6fe, tileAlt: 0xeee9fb, base: 0x9b8ae6, baseDark: 0x8473d8, belt: 0x2c2650, chevron: 0x4a4280,
  hopper: 0xea4b50, roof: 0xfbf0d8, window: 0xfff4cc, tree: 0x7ed7b1, treeDark: 0x5cc49b, trunk: 0x8b6b57,
  cloud: 0xffffff, card: 0xffffff, screen: 0x231d45, check: 0x2fbf88,
};
const STATIONS = [
  { key: "script", label: "SCRIPT", color: 0xf0866a, x: -4.7, h: 1.9, w: 1.7 },
  { key: "voice", label: "VOICE", color: 0x5ccfa2, x: -2.3, h: 2.5, w: 1.7 },
  { key: "visuals", label: "VISUALS", color: 0x6ba7f1, x: 0.1, h: 1.8, w: 1.7 },
  { key: "edit", label: "EDIT", color: 0xf2c454, x: 2.5, h: 1.5, w: 1.7 },
  { key: "publish", label: "PUBLISH", color: 0xa694f1, x: 4.9, h: 3.0, w: 1.3 },
];
const TOPICS = [
  "Never hold in a sneeze", "Why you get goosebumps", "Brain freeze, explained",
  "Why hiccups happen", "Why yawns are contagious", "The muscle 1 in 7 people lack",
];

// ---------- helpers ----------
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...extra });
const rbox = (w, h, d, r = 0.08, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2));
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const phase = (t, start, dur) => clamp01((t - start) / dur);
function shadowed(mesh, cast = true, receive = true) { mesh.castShadow = cast; mesh.receiveShadow = receive; return mesh; }

function textTexture(text, { size = 72, weight = 700, color = "#2c2650", width = 512, height = 128, align = "left", font = "Sora" } = {}) {
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.font = `${weight} ${size}px "${font}", sans-serif`;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillText(text, align === "left" ? 8 : width / 2, height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function groundLabel(text, w, h, opts) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(text, opts), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc4f4, 1.65));
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.position.set(-6, 16, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(small() ? 1024 : 2048, small() ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 12, bottom: -12, near: 1, far: 50 });
sun.shadow.bias = -0.0006;
sun.shadow.radius = 4;
scene.add(sun);

// ---------- island ----------
const world = new THREE.Group();
scene.add(world);

const base = shadowed(new THREE.Mesh(rbox(21, 1.1, 9.6, 0.45, 5), mat(C.base)), false, true);
base.position.y = -0.55;
world.add(base);
const lip = new THREE.Mesh(rbox(20.6, 0.12, 9.2, 0.05), mat(C.baseDark));
lip.position.y = -0.03;
world.add(lip);

const COLS = 20, ROWS = 9;
const tileGeo = rbox(0.93, 0.2, 0.93, 0.07, 2);
const tiles = new THREE.InstancedMesh(tileGeo, mat(0xffffff), COLS * ROWS);
tiles.castShadow = false; tiles.receiveShadow = true;
const tileData = [];
const tmp = new THREE.Object3D();
const tileColor = new THREE.Color();
for (let i = 0; i < COLS; i++) {
  for (let j = 0; j < ROWS; j++) {
    const x = -9.5 + i, z = -4 + j;
    const d = Math.hypot(x + 8, z - 0.6);
    tileData.push({ x, z, delay: d * 0.045 + Math.random() * 0.05 });
    tileColor.setHex((i + j) % 2 ? C.tile : C.tileAlt);
    tiles.setColorAt(i * ROWS + j, tileColor);
  }
}
world.add(tiles);
function placeTiles(t) {
  tileData.forEach((d, k) => {
    const p = reduceMotion ? 1 : phase(t, d.delay, 0.55);
    tmp.position.set(d.x, 0.1 + (1 - easeOutBack(p)) * 7, d.z);
    tmp.rotation.set(0, 0, (1 - easeOutCubic(p)) * 0.6);
    const s = p === 0 ? 0.0001 : 1;
    tmp.scale.set(s, s, s);
    tmp.updateMatrix();
    tiles.setMatrixAt(k, tmp.matrix);
  });
  tiles.instanceMatrix.needsUpdate = true;
}

// belt with scrolling chevrons
function chevronTexture() {
  const c = document.createElement("canvas"); c.width = 128; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#2c2650"; g.fillRect(0, 0, 128, 64);
  g.strokeStyle = "#4b4384"; g.lineWidth = 7; g.lineCap = "round";
  g.beginPath(); g.moveTo(48, 14); g.lineTo(72, 32); g.lineTo(48, 50); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(16, 1); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const BELT_Z = 0.55, BELT_Y = 0.36, BELT_START = -7.6, BELT_END = 6.6;
const chevrons = chevronTexture();
const belt = shadowed(new THREE.Mesh(rbox(BELT_END - BELT_START + 0.8, 0.24, 1.25, 0.1), [
  mat(C.belt), mat(C.belt), new THREE.MeshStandardMaterial({ map: chevrons, roughness: 0.9 }), mat(C.belt), mat(C.belt), mat(C.belt),
]));
belt.position.set((BELT_START + BELT_END) / 2, BELT_Y - 0.12, BELT_Z);
world.add(belt);
const rollers = [BELT_START - 0.4, BELT_END + 0.4].map((x) => {
  const r = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.3, 20), mat(C.belt)));
  r.rotation.x = Math.PI / 2; r.position.set(x, BELT_Y - 0.12, BELT_Z);
  world.add(r);
  return r;
});

// topic hopper (the red frame where cards enter)
const hopper = new THREE.Group();
const bar = (w, h, d) => shadowed(new THREE.Mesh(rbox(w, h, d, 0.06), mat(C.hopper)));
[[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]].forEach(([dx, dz]) => {
  const post = bar(0.16, 1.5, 0.16); post.position.set(dx, 0.75, dz); hopper.add(post);
});
[[0, 1.5, -0.65, 1.46, 0.16], [0, 1.5, 0.65, 1.46, 0.16]].forEach(([x, y, z, w, d]) => { const b = bar(w, 0.16, d); b.position.set(x, y, z); hopper.add(b); });
[[-0.65, 1.5, 0], [0.65, 1.5, 0]].forEach(([x, y, z]) => { const b = bar(0.16, 0.16, 1.46); b.position.set(x, y, z); hopper.add(b); });
hopper.position.set(BELT_START + 0.3, 0.2, BELT_Z);
world.add(hopper);

// stations
const buildings = [];
STATIONS.forEach((s, idx) => {
  const g = new THREE.Group();
  g.position.set(s.x, 0.2, -1.75);
  const body = shadowed(new THREE.Mesh(rbox(s.w, s.h, 1.6, 0.12), mat(s.color)));
  body.position.y = s.h / 2;
  body.userData.station = idx;
  g.add(body);
  const roof = shadowed(new THREE.Mesh(rbox(s.w + 0.16, 0.18, 1.76, 0.07), mat(C.roof)));
  roof.position.y = s.h + 0.05;
  g.add(roof);

  // windows on the two faces the camera sees
  const winMat = new THREE.MeshStandardMaterial({ color: C.window, emissive: 0xffe9a8, emissiveIntensity: 0.25, roughness: 0.6 });
  const rows = Math.max(2, Math.floor((s.h - 0.4) / 0.42)), cols = s.w > 1.5 ? 3 : 2;
  const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.24, 0.04), winMat, rows * cols * 2);
  let n = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const y = 0.42 + r * 0.42;
    const x = (c - (cols - 1) / 2) * (s.w / (cols + 0.4));
    tmp.position.set(x, y, 0.81); tmp.rotation.set(0, 0, 0); tmp.scale.set(1, 1, 1); tmp.updateMatrix(); wins.setMatrixAt(n++, tmp.matrix);
    tmp.position.set(s.w / 2 + 0.01, y, (c - (cols - 1) / 2) * 0.42); tmp.rotation.set(0, Math.PI / 2, 0); tmp.updateMatrix(); wins.setMatrixAt(n++, tmp.matrix);
  }
  g.add(wins);

  // gantry over the belt in the station's colour
  const gmat = mat(s.color);
  const pipe = (len, axis) => {
    const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, len, 14), gmat));
    if (axis === "z") m.rotation.x = Math.PI / 2;
    return m;
  };
  const postA = pipe(1.25); postA.position.set(-0.35, 0.62, 2.5); g.add(postA);
  const top = pipe(1.75, "z"); top.position.set(-0.35, 1.24, 1.66); g.add(top);
  const out = pipe(0.5); out.position.set(-0.35, 1.0, 0.85); g.add(out);

  // a small prop on each roof, like the film
  const prop = new THREE.Group();
  prop.position.y = s.h + 0.14;
  if (s.key === "script") {
    const board = shadowed(new THREE.Mesh(rbox(0.9, 0.62, 0.05, 0.02), mat(0xffffff)));
    board.position.set(0, 0.42, 0); prop.add(board);
    for (let k = 0; k < 3; k++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.62 - k * 0.12, 0.05, 0.02), mat(0x8f86c4)); l.position.set(-0.05, 0.56 - k * 0.12, 0.035); prop.add(l); }
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2), mat(0xcab9a0)); stick.position.y = 0.06; prop.add(stick);
  } else if (s.key === "voice") {
    prop.userData.bars = [0, 1, 2, 3].map((k) => {
      const b = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 12), mat(0x2fa77d)));
      b.position.set(-0.45 + k * 0.3, 0.2, 0); prop.add(b); return b;
    });
  } else if (s.key === "visuals") {
    const sph = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), mat(0xe9474c))); sph.position.set(-0.4, 0.22, 0.1); prop.add(sph);
    const cone = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 20), mat(0xf2c454))); cone.position.set(0.05, 0.21, -0.1); prop.add(cone);
    const cube = shadowed(new THREE.Mesh(rbox(0.32, 0.32, 0.32, 0.05), mat(0x7b6be0))); cube.position.set(0.45, 0.17, 0.15); cube.rotation.y = 0.6; prop.add(cube);
    prop.userData.spin = cube;
  } else if (s.key === "edit") {
    const tray = shadowed(new THREE.Mesh(rbox(1.25, 0.1, 0.52, 0.04), mat(C.belt))); tray.position.y = 0.05; prop.add(tray);
    [0xea4b50, 0x6ba7f1, 0x5ccfa2, 0xa694f1].forEach((col, k) => { const clip = new THREE.Mesh(rbox(0.25, 0.08, 0.34, 0.03), mat(col)); clip.position.set(-0.42 + k * 0.28, 0.13, 0); prop.add(clip); });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.42), mat(0xea4b50)); head.position.set(0.1, 0.16, 0); prop.add(head);
    prop.userData.playhead = head;
  } else if (s.key === "publish") {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9), mat(0xcab9a0)); mast.position.y = 0.45; prop.add(mast);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 12), mat(0xea4b50)); ball.position.y = 0.98; prop.add(ball);
    prop.userData.rings = [0.3, 0.52, 0.72].map((y, k) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.2 + k * 0.03, 0.025, 8, 32), mat(0x7b6be0));
      r.rotation.x = Math.PI / 2; r.position.y = y; prop.add(r); return r;
    });
  }
  g.add(prop);

  world.add(g);
  buildings.push({ s, g, body, roof, wins, winMat, prop, gantry: [postA, top, out], pulse: 0 });
});

// ground labels, as painted in the film
let labels = [];
function buildLabels() {
  labels.forEach((l) => world.remove(l));
  labels = [];
  const add = (mesh, x, z, rot = 0) => { mesh.position.set(x, 0.215, z); mesh.rotation.z = rot; world.add(mesh); labels.push(mesh); };
  add(groundLabel("TOPIC", 2.2, 0.55, { size: 80 }), BELT_START + 0.5, 2.0);
  STATIONS.forEach((s, i) => add(groundLabel(`0${i + 1} ${s.label}`, 2.4, 0.5, { size: 62 }), s.x + 0.3, 2.0));
  add(groundLabel("YOUTUBE", 2.2, 0.5, { size: 64 }), 9.3, 2.0, Math.PI / 2);
  add(groundLabel("INSTAGRAM", 2.4, 0.5, { size: 60 }), 6.6, 4.15);
  // the price plaque
  const plaque = shadowed(new THREE.Mesh(rbox(2.9, 0.12, 1.2, 0.06), mat(0xffffff)), false, true);
  plaque.position.set(-0.4, 0.26, 3.15); world.add(plaque); labels.push(plaque);
  const priceTex = (() => {
    const c = document.createElement("canvas"); c.width = 768; c.height = 320;
    const g = c.getContext("2d");
    g.fillStyle = "#2c2650"; g.font = '600 72px "Sora", sans-serif'; g.fillText("under", 40, 110);
    g.fillStyle = "#ea4b50"; g.font = '800 170px "Sora", sans-serif'; g.fillText("$1", 250, 230);
    g.fillStyle = "#2c2650"; g.font = '600 72px "Sora", sans-serif'; g.fillText("a video", 470, 230);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  })();
  const price = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.1), new THREE.MeshBasicMaterial({ map: priceTex, transparent: true, depthWrite: false }));
  price.rotation.x = -Math.PI / 2; price.position.set(-0.4, 0.33, 3.15); world.add(price); labels.push(price);
}

// screens at the end of the line
function screenTexture(title, vertical) {
  const c = document.createElement("canvas"); c.width = vertical ? 256 : 512; c.height = vertical ? 456 : 300;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, c.height);
  grd.addColorStop(0, "#2a2160"); grd.addColorStop(1, "#5a3f9e");
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#ffd36b"; g.beginPath(); g.arc(c.width * 0.72, c.height * 0.3, c.width * 0.08, 0, 7); g.fill();
  g.fillStyle = "#ffffff"; g.font = `800 ${vertical ? 30 : 40}px "Sora", sans-serif`;
  const words = title.toUpperCase().split(" "); let line = "", y = vertical ? c.height * 0.55 : c.height * 0.45;
  words.forEach((w) => { if (g.measureText(line + w).width > c.width * 0.8) { g.fillText(line, c.width * 0.08, y); y += vertical ? 36 : 46; line = ""; } line += w + " "; });
  g.fillText(line, c.width * 0.08, y);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function device(w, h, standH, vertical) {
  const g = new THREE.Group();
  const stand = shadowed(new THREE.Mesh(rbox(w * 0.75, 0.16, 0.7, 0.05), mat(0xffffff))); stand.position.y = 0.08; g.add(stand);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, standH, 0.08), mat(C.screen)); neck.position.y = 0.16 + standH / 2; g.add(neck);
  const frame = shadowed(new THREE.Mesh(rbox(w, h, 0.14, 0.06), mat(C.screen))); frame.position.y = 0.16 + standH + h / 2; g.add(frame);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.12, h - 0.12), new THREE.MeshBasicMaterial({ map: screenTexture(TOPICS[0], vertical) }));
  glass.position.set(0, frame.position.y, 0.075); g.add(glass);
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), new THREE.MeshBasicMaterial({ color: C.check }));
  badge.position.set(w / 2 - 0.12, frame.position.y + h / 2 - 0.12, 0.09); badge.scale.setScalar(0.001); g.add(badge);
  return { g, glass, badge, frame, vertical, flash: 0 };
}
const monitor = device(2.2, 1.35, 0.55, false);
monitor.g.position.set(8.0, 0.2, 1.7); monitor.g.rotation.y = Math.PI / 4 - 0.25;
const phone = device(0.62, 1.15, 0.3, true);
phone.g.position.set(6.4, 0.2, 3.0); phone.g.rotation.y = Math.PI / 4 + 0.1;
world.add(monitor.g, phone.g);
const screens = [monitor, phone];

// trees
const trees = [];
const treeSpots = [[-9.1, -3.6], [-8.4, 3.4], [-6.3, -3.3], [-3.6, 3.6], [-1.3, -3.6], [1.4, 3.7], [3.7, -3.4], [6.2, -3.2], [8.9, -1.8], [9.1, 3.6], [-9.2, 1.2], [4.4, 3.5]];
treeSpots.forEach(([x, z], k) => {
  const g = new THREE.Group();
  const trunk = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8), mat(C.trunk))); trunk.position.y = 0.2; g.add(trunk);
  const crown = shadowed(new THREE.Mesh(k % 3 === 0 ? new THREE.ConeGeometry(0.42, 1.0, 7) : new THREE.IcosahedronGeometry(0.42, 0), mat(k % 2 ? C.tree : C.treeDark, { flatShading: true })));
  crown.position.y = k % 3 === 0 ? 0.85 : 0.72; g.add(crown);
  g.position.set(x, 0.2, z);
  world.add(g);
  trees.push({ g, delay: 2.1 + k * 0.05 });
});

// clouds (outside the island group so they don't swing with it)
const clouds = [];
[[-12, 3.5, -6, 1.3], [12, 4.8, -4, 1.0], [-10, 2.2, 7, 0.9], [11, 2.6, 7.5, 1.2], [2, 6.5, -9, 0.8]].forEach(([x, y, z, s], k) => {
  const g = new THREE.Group();
  [[0, 0, 0, 0.9], [0.9, -0.15, 0.2, 0.65], [-0.85, -0.2, 0.1, 0.6], [0.3, 0.35, -0.2, 0.6]].forEach(([dx, dy, dz, r]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat(C.cloud, { roughness: 1 }));
    m.position.set(dx, dy, dz); g.add(m);
  });
  const flat = new THREE.Mesh(rbox(2.6, 0.5, 1.2, 0.24), mat(C.cloud, { roughness: 1 })); flat.position.y = -0.45; g.add(flat);
  g.position.set(x, y, z); g.scale.setScalar(s);
  scene.add(g);
  clouds.push({ g, y, phase: k * 1.7 });
});

// topic cards riding the belt
const stripeIdle = mat(0xb9b0e0);
const stripeMats = STATIONS.map((s) => mat(s.color));
const cardGeo = rbox(0.78, 0.07, 0.56, 0.03);
const cards = [];
for (let k = 0; k < 5; k++) {
  const m = shadowed(new THREE.Mesh(cardGeo, mat(C.card)), true, false);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.01, 0.08), stripeIdle);
  stripe.position.set(-0.02, 0.04, -0.1); m.add(stripe);
  const stripe2 = stripe.clone(); stripe2.scale.x = 0.6; stripe2.position.set(-0.1, 0.04, 0.05); m.add(stripe2);
  m.visible = false;
  world.add(m);
  cards.push({ m, stripe, offset: k / 5, topic: k, lastStation: -1, flying: 0 });
}

// ---------- framing, scroll and pointer ----------
const state = { t0: performance.now(), focus: -1, focusAmt: 0, scrollFade: 1, visible: true, pointer: new THREE.Vector2(), hover: -1 };
const camTarget = new THREE.Vector3(), camTargetGoal = new THREE.Vector3();
let zoom = 0.6, zoomGoal = 1;
let viewH = 14;

function stationWorldPos(i) {
  if (i < 0) return new THREE.Vector3(0.3, 0.6, 0.4);
  const p = i === 0 ? new THREE.Vector3(BELT_START + 0.3, 1.0, BELT_Z) : new THREE.Vector3(STATIONS[i - 1].x, STATIONS[i - 1].h * 0.55, -0.6);
  return world.localToWorld(p);
}
function frame() {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  renderer.setSize(w, h, false);
  viewH = aspect < 0.8 ? 23 / aspect : aspect < 1.3 ? 24 : 23;   // phones: fit the island's width
  const halfH = viewH / 2, halfW = halfH * aspect;
  Object.assign(camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
  camera.updateProjectionMatrix();
}
// camera right/up vectors in world space, for nudging the island into the free side of the screen
const camRight = new THREE.Vector3(), camUp = new THREE.Vector3();
function goal() {
  const aspect = innerWidth / innerHeight;
  const halfH = viewH / 2 / zoomGoal, halfW = halfH * aspect;
  camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  camUp.setFromMatrixColumn(camera.matrixWorld, 1);
  const focus = stationWorldPos(state.focus);
  camTargetGoal.copy(state.focus < 0 ? new THREE.Vector3(0.3, 0, 0.4) : focus);
  if (aspect >= 1.1) camTargetGoal.addScaledVector(camRight, -halfW * (state.focus < 0 ? 0.56 : 0.42));
  else camTargetGoal.addScaledVector(camUp, halfH * (state.focus < 0 ? 0.6 : -0.34));
}
addEventListener("resize", frame);
addEventListener("pointermove", (e) => {
  state.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});

// which "How it works" panel is in view drives the camera
const panels = [...document.querySelectorAll("[data-step]")];
const how = document.getElementById("how");
function onScroll() {
  const mid = innerHeight * 0.55;
  let best = -1, bestD = Infinity;
  panels.forEach((p) => {
    const r = p.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (r.bottom > 0 && r.top < innerHeight && d < bestD) { bestD = d; best = +p.dataset.step; }
  });
  const hr = how.getBoundingClientRect();
  state.focus = hr.top < innerHeight * 0.45 && hr.bottom > innerHeight * 0.5 ? best : -1;
  zoomGoal = state.focus < 0 ? 1 : small() ? 2.3 : 2.1;
  // fade the world out once the walkthrough is over
  const fade = clamp01((hr.bottom - innerHeight * 0.35) / (innerHeight * 0.45));
  state.scrollFade = fade;
  canvas.style.opacity = fade.toFixed(3);
  panels.forEach((p) => p.classList.toggle("active", +p.dataset.step === state.focus));
}
addEventListener("scroll", onScroll, { passive: true });
document.addEventListener("visibilitychange", () => { state.visible = !document.hidden; });

// hover a building for its name
const ray = new THREE.Raycaster();
const tip = document.getElementById("tip");
function updateHover() {
  if (small() || state.scrollFade < 0.5) { tip.classList.remove("on"); return; }
  ray.setFromCamera(state.pointer, camera);
  const hit = ray.intersectObjects(buildings.map((b) => b.body), false)[0];
  const idx = hit ? hit.object.userData.station : -1;
  state.hover = idx;
  canvas.style.cursor = idx >= 0 ? "pointer" : "";
  if (idx >= 0) {
    tip.textContent = `0${idx + 1} · ${STATIONS[idx].label.toLowerCase()}`;
    tip.style.transform = `translate(${(state.pointer.x + 1) / 2 * innerWidth + 14}px, ${(1 - state.pointer.y) / 2 * innerHeight + 14}px)`;
    tip.classList.add("on");
  } else tip.classList.remove("on");
}
canvas.addEventListener("click", () => {
  if (state.hover >= 0) document.querySelector(`[data-step="${state.hover + 1}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
});

// the engine log under the hero headline
const logEl = document.getElementById("log");
function logLine(text) {
  if (!logEl) return;
  const li = document.createElement("li");
  const now = new Date();
  li.innerHTML = `<span>${now.toTimeString().slice(0, 8)}</span> ${text}`;
  logEl.prepend(li);
  while (logEl.children.length > 4) logEl.lastChild.remove();
}

// ---------- animation ----------
const SPEED = 0.06; // belt loops per second
const clock = new THREE.Clock();
function update(t, dt) {
  const intro = reduceMotion ? 99 : t;
  placeTilesOnce(intro);

  // base and belt fade/scale in
  base.scale.setScalar(0.94 + 0.06 * easeOutCubic(phase(intro, 0, 0.6)));
  const beltP = easeOutBack(phase(intro, 1.5, 0.6));
  belt.scale.set(Math.max(0.001, beltP), 1, 1); rollers.forEach((r) => r.scale.setScalar(Math.max(0.001, beltP)));
  hopper.scale.setScalar(Math.max(0.001, easeOutBack(phase(intro, 1.2, 0.5))));
  chevrons.offset.x -= dt * 1.4;

  // buildings grow: plinth, walls with overshoot, roof a beat later
  buildings.forEach((b, i) => {
    const p = phase(intro, 1.0 + i * 0.16, 0.7);
    b.g.scale.set(1, Math.max(0.001, easeOutBack(p)), 1);
    b.roof.visible = p > 0.35;
    b.prop.scale.setScalar(Math.max(0.001, easeOutBack(phase(intro, 1.5 + i * 0.16, 0.5))));
    b.gantry.forEach((g) => (g.scale.y = Math.max(0.001, easeOutBack(phase(intro, 1.7 + i * 0.12, 0.5)))));
    // highlight: focused (scroll), hovered, or a card passing
    const want = state.focus === i + 1 ? 1 : state.hover === i ? 0.7 : 0;
    b.pulse += (Math.max(want, b.flash || 0) - b.pulse) * Math.min(1, dt * 6);
    b.flash = Math.max(0, (b.flash || 0) - dt * 1.6);
    b.winMat.emissiveIntensity = 0.25 + b.pulse * 1.4;
    b.body.position.y = b.s.h / 2 + b.pulse * 0.08;
    const pr = b.prop.userData;
    if (pr.bars) pr.bars.forEach((bar, k) => { const s = 0.3 + 0.7 * Math.abs(Math.sin(t * 5 + k * 1.3)) * (0.5 + b.pulse); bar.scale.y = s; bar.position.y = 0.06 + s / 2; });
    if (pr.spin) pr.spin.rotation.y += dt * (0.6 + b.pulse * 2);
    if (pr.playhead) pr.playhead.position.x = -0.5 + ((t * 0.35) % 1);
    if (pr.rings) pr.rings.forEach((r, k) => { r.scale.setScalar(1 + 0.25 * Math.sin(t * 3 - k * 0.8) * (0.4 + b.pulse)); });
  });

  // cards: enter at the hopper, ride the belt, light each station, then hop onto a screen
  const running = intro > 2.4;
  cards.forEach((c, k) => {
    if (!running) { c.m.visible = false; return; }
    const u = ((t - 2.4) * SPEED + c.offset) % 1;
    const x = BELT_START + 0.3 + u * (BELT_END - BELT_START - 0.3);
    c.m.visible = true;
    if (u < 0.93) {
      c.m.position.set(x, BELT_Y + 0.06, BELT_Z);
      c.m.rotation.set(0, 0, 0);
      c.m.scale.setScalar(Math.min(1, u / 0.03));
      const st = STATIONS.findIndex((s) => Math.abs(x - s.x) < 0.35);
      if (st >= 0 && st !== c.lastStation) {
        c.lastStation = st;
        buildings[st].flash = 1;
        c.stripe.material = stripeMats[st];
        if (st === 4 && state.scrollFade > 0.2) logLine(`<b>published</b> “${TOPICS[c.topic]}” → YouTube Shorts, Instagram Reels`);
        else if (st === 0 && state.scrollFade > 0.2) logLine(`script ✓ “${TOPICS[c.topic]}”`);
      }
    } else {
      // hop onto the phone or the monitor
      const f = (u - 0.93) / 0.07;
      const dest = screens[k % 2];
      const to = dest.g.position.clone().add(new THREE.Vector3(0, 1.1, 0));
      const from = new THREE.Vector3(BELT_END - 0.1, BELT_Y + 0.06, BELT_Z);
      c.m.position.lerpVectors(from, to, f);
      c.m.position.y += Math.sin(f * Math.PI) * 1.6;
      c.m.rotation.set(f * 1.2, f * 2.0, 0);
      c.m.scale.setScalar(1 - f * 0.9);
      if (f > 0.9 && !c.landed) {
        c.landed = true;
        dest.flash = 1;
        dest.glass.material.map.dispose();
        dest.glass.material.map = screenTexture(TOPICS[c.topic], dest.vertical);
        dest.glass.material.needsUpdate = true;
      }
    }
    if (u < 0.05) { if (c.landed) c.topic = (c.topic + cards.length) % TOPICS.length; c.landed = false; c.lastStation = -1; c.stripe.material = stripeIdle; }
  });
  screens.forEach((s) => {
    s.flash = Math.max(0, s.flash - dt * 1.2);
    s.badge.scale.setScalar(0.001 + easeOutBack(clamp01(s.flash * 2)) * 1);
    s.frame.scale.setScalar(1 + s.flash * 0.04);
  });

  trees.forEach((tr) => tr.g.scale.setScalar(Math.max(0.001, easeOutBack(phase(intro, tr.delay, 0.45)))));
  clouds.forEach((c) => { c.g.position.y = c.y + Math.sin(t * 0.5 + c.phase) * 0.25; c.g.position.x += dt * 0.08; if (c.g.position.x > 16) c.g.position.x = -16; });

  // pointer parallax: the island turns a little toward the pointer
  if (!reduceMotion && !small()) {
    world.rotation.y += ((state.pointer.x * 0.1) - world.rotation.y) * Math.min(1, dt * 2.5);
  }

  // camera: a slow settle on first load, then follow the scroll focus
  const settle = reduceMotion ? 1 : easeInOut(phase(t, 0, 3.2));
  goal();
  camTarget.lerp(camTargetGoal, Math.min(1, dt * (state.focus < 0 ? 2.2 : 3)));
  zoom += ((zoomGoal * (0.82 + 0.18 * settle)) - zoom) * Math.min(1, dt * 2.6);
  const orbit = (1 - settle) * 0.5;
  const dir = ISO_DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit);
  camera.position.copy(camTarget).addScaledVector(dir, CAM_DIST);
  camera.lookAt(camTarget);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}
let tilesDone = false;
function placeTilesOnce(t) {
  if (tilesDone) return;
  placeTiles(t);
  if (reduceMotion || t > 3) tilesDone = true;
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!state.visible || state.scrollFade <= 0.001) return;
  const t = (performance.now() - state.t0) / 1000;
  update(t, dt);
  updateHover();
  renderer.render(scene, camera);
}

// start once the fonts are in, so the painted labels use Sora
Promise.race([Promise.all([document.fonts.load('700 64px "Sora"'), document.fonts.load('800 64px "Sora"')]), new Promise((r) => setTimeout(r, 1500))]).then(() => {
  buildLabels();
  frame();
  onScroll();
  camTarget.copy(new THREE.Vector3(0.3, 0, 0.4));
  goal();
  camTarget.copy(camTargetGoal);
  state.t0 = performance.now();
  root.classList.remove("no-webgl");
  root.classList.add("world-ready");
  logLine("engine started · 5 stations online");
  loop();
});
