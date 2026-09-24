// Hero 3D scene: a Cans n Cats soda can floating in a field of teal/orange particles, with
// sound-wave rings and a spectrum ring pulsing like audio. Drag to spin, the can leans
// toward the pointer, and the scene drifts as the page scrolls.
// If WebGL is unavailable the static logo in .hero-fallback stays visible instead.
import * as THREE from "./vendor/three.module.min.js";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";

const stage = document.querySelector("[data-hero-stage]");
const canvas = stage?.querySelector("canvas");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const TEAL = new THREE.Color("#19e3dc");
const ORANGE = new THREE.Color("#ff7a1a");
const BODY_HEIGHT = 2.5;
const RADIUS = 1;

if (stage && canvas && hasWebGL()) {
  init().catch((error) => console.warn("3D hero unavailable:", error));
}

function hasWebGL() {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
  } catch {
    return false;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// --- Textures ----------------------------------------------------------------

function drawLabel(logo) {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 816;
  const g = c.getContext("2d");
  const W = c.width;
  const H = c.height;

  // Brushed orange aluminium.
  const base = g.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, "#ff8a2a");
  base.addColorStop(0.5, "#f26410");
  base.addColorStop(1, "#b8430b");
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * 0.05})`;
    g.fillRect(0, Math.random() * H, W, Math.random() * 2 + 0.5);
  }

  // Dark bands top and bottom with a dashed teal trace.
  g.fillStyle = "#0b0e12";
  g.fillRect(0, 0, W, 64);
  g.fillRect(0, H - 64, W, 64);
  g.strokeStyle = "#19e3dc";
  g.lineWidth = 4;
  g.setLineDash([26, 18]);
  [32, H - 32].forEach((y) => {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  });
  g.setLineDash([]);

  // Circuit "whiskers" running from the logo panel around the can.
  const traces = [
    [230, 290, 150],
    [290, 408, 0],
    [350, 520, -150],
  ];
  g.lineWidth = 6;
  traces.forEach(([, y, bend]) => {
    for (const side of [-1, 1]) {
      const x0 = W / 2 + side * 340;
      const x1 = W / 2 + side * 520;
      const x2 = W / 2 + side * 880;
      g.strokeStyle = "rgba(11,14,18,0.85)";
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.lineTo(x1 + side * 60, y + bend * 0.4);
      g.lineTo(x2, y + bend * 0.4);
      g.stroke();
      g.fillStyle = "#0b0e12";
      g.fillRect(x2 - 14, y + bend * 0.4 - 14, 28, 28);
      g.fillStyle = "#19e3dc";
      g.fillRect(x2 - 7, y + bend * 0.4 - 7, 14, 14);
    }
  });

  // Logo panel on the front (u = 0.5 faces the camera).
  const size = 620;
  const px = W / 2 - size / 2;
  const py = (H - size) / 2;
  g.save();
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowBlur = 30;
  roundRect(g, px, py, size, size, 42);
  g.fillStyle = "#0b0e12";
  g.fill();
  g.restore();
  g.save();
  roundRect(g, px, py, size, size, 42);
  g.clip();
  g.drawImage(logo, px, py, size, size);
  g.restore();
  g.lineWidth = 6;
  g.strokeStyle = "#19e3dc";
  roundRect(g, px, py, size, size, 42);
  g.stroke();

  // Side copy.
  g.fillStyle = "#0b0e12";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = '800 64px "Bricolage", "Inter", sans-serif';
  g.fillText("TECH TALK", W * 0.17, H / 2 - 50);
  g.fillText("PODCAST", W * 0.17, H / 2 + 30);
  g.font = '700 30px "Inter", sans-serif';
  g.fillText("LISTENER-LED · EST. 2026", W * 0.17, H / 2 + 110);

  g.font = '800 58px "Bricolage", "Inter", sans-serif';
  g.fillText("AI · CYBER", W * 0.83, H / 2 - 50);
  g.fillText("PRIVACY", W * 0.83, H / 2 + 25);
  g.font = '700 30px "Inter", sans-serif';
  g.fillText("NO HYPE · NO JARGON", W * 0.83, H / 2 + 105);

  // Back: barcode and episode stamp (wraps across the u = 0 / 1 seam).
  for (const x0 of [-120, W - 120]) {
    let x = x0;
    for (let i = 0; i < 38; i++) {
      const w = [3, 5, 8][i % 3 === 0 ? 2 : (i * 7) % 2];
      g.fillStyle = "#0b0e12";
      g.fillRect(x, H / 2 - 120, w, 170);
      x += w + ((i * 5) % 3) + 3;
    }
  }
  g.font = '800 34px "Inter", sans-serif';
  g.fillText("EP 01", 0, H / 2 + 100);
  g.fillText("EP 01", W, H / 2 + 100);

  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- Scene -------------------------------------------------------------------

function buildCan(labelTexture) {
  const can = new THREE.Group();
  const aluminium = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 1, roughness: 0.22 });
  const darkAluminium = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, metalness: 1, roughness: 0.38 });
  const top = BODY_HEIGHT / 2;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(RADIUS, RADIUS, BODY_HEIGHT, 128, 1, true, Math.PI, Math.PI * 2),
    new THREE.MeshStandardMaterial({ map: labelTexture, metalness: 0.55, roughness: 0.3, envMapIntensity: 1.15 }),
  );
  can.add(body);

  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.84, RADIUS, 0.3, 128, 1, true), aluminium);
  shoulder.position.y = top + 0.15;
  can.add(shoulder);

  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.03, 96), darkAluminium);
  lid.position.y = top + 0.26;
  can.add(lid);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.835, 0.05, 20, 128), aluminium);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = top + 0.3;
  can.add(rim);

  // Pull tab: a flat rounded ring riveted to the lid, plus the dark mouth opening.
  const tabShape = new THREE.Shape();
  tabShape.absarc(0, 0, 0.26, 0, Math.PI * 2, false);
  const tabHole = new THREE.Path();
  tabHole.absarc(0, 0.04, 0.14, 0, Math.PI * 2, true);
  tabShape.holes.push(tabHole);
  const tab = new THREE.Mesh(
    new THREE.ExtrudeGeometry(tabShape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 32 }),
    aluminium,
  );
  tab.rotation.x = -Math.PI / 2;
  tab.scale.set(1, 1.35, 1);
  tab.position.set(0, top + 0.29, 0.12);
  can.add(tab);

  const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 24), aluminium);
  rivet.position.set(0, top + 0.29, 0);
  can.add(rivet);

  const mouth = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 40),
    new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 0.3, roughness: 0.8 }),
  );
  mouth.rotation.x = -Math.PI / 2;
  mouth.scale.set(1.35, 0.9, 1);
  mouth.position.set(0, top + 0.28, -0.45);
  can.add(mouth);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, 0.8, 0.22, 128, 1, true), aluminium);
  base.position.y = -top - 0.11;
  can.add(base);

  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.8, 64), darkAluminium);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -top - 0.22;
  can.add(bottom);

  return can;
}

function buildSpectrum() {
  const count = 72;
  const bars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.07, 1, 0.07).translate(0, 0.5, 0),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
    count,
  );
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const t = Math.abs(i / count - 0.5) * 2;
    bars.setColorAt(i, color.copy(TEAL).lerp(ORANGE, t));
  }
  bars.instanceColor.needsUpdate = true;
  bars.userData.count = count;
  return bars;
}

function buildRing(radius, color, opacity) {
  return new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.012, 8, 220),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, toneMapped: false }),
  );
}

function buildParticles(sprite) {
  const count = window.innerWidth < 700 ? 700 : 1600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = 3.2 + Math.random() * 7;
    const theta = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 9;
    positions.set([Math.cos(theta) * r, y, Math.sin(theta) * r - 2], i * 3);
    const pick = Math.random();
    c.copy(pick < 0.55 ? TEAL : pick < 0.85 ? ORANGE : new THREE.Color("#ffffff"));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.07,
      map: sprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
}

async function init() {
  await Promise.race([
    Promise.all([document.fonts.load('800 64px "Bricolage"'), document.fonts.load('700 30px "Inter"')]),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => {});
  const logo = await loadImage("/image.webp");

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.3, 9.5);

  const teal = new THREE.PointLight(TEAL, 28, 12);
  teal.position.set(-3.5, 1.5, 2.5);
  const orange = new THREE.PointLight(ORANGE, 30, 12);
  orange.position.set(3.5, -1, 1.5);
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2, 4, 5);
  scene.add(teal, orange, key);

  const labelTexture = new THREE.CanvasTexture(drawLabel(logo));
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  labelTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const world = new THREE.Group();
  scene.add(world);

  const rig = new THREE.Group(); // tilts toward the pointer
  world.add(rig);
  const can = buildCan(labelTexture);
  can.rotation.set(0.08, -0.5, 0.06);
  rig.add(can);

  const sprite = glowTexture();

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: sprite, color: TEAL, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  halo.scale.set(6.5, 6.5, 1);
  halo.position.z = -1.5;
  world.add(halo);

  const floorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 5),
    new THREE.MeshBasicMaterial({ map: sprite, color: ORANGE, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = -2;
  world.add(floorGlow);

  const spectrum = buildSpectrum();
  spectrum.position.y = -2;
  world.add(spectrum);

  const rings = new THREE.Group();
  const ringA = buildRing(2.35, TEAL, 0.75);
  const ringB = buildRing(2.75, ORANGE, 0.5);
  const ringC = buildRing(3.2, TEAL, 0.25);
  ringA.rotation.x = Math.PI / 2.3;
  ringB.rotation.x = Math.PI / 2.1;
  ringB.rotation.y = 0.35;
  ringC.rotation.x = Math.PI / 1.9;
  ringC.rotation.y = -0.3;
  rings.add(ringA, ringB, ringC);
  world.add(rings);

  const satellites = [ringA, ringB].map((ring, i) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sprite, color: i ? ORANGE : TEAL, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    s.scale.setScalar(0.35);
    ring.add(s);
    return s;
  });

  const particles = buildParticles(sprite);
  scene.add(particles);

  // --- Layout ----------------------------------------------------------------
  let width = 0;
  let height = 0;
  let wide = true;
  const resize = () => {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    wide = camera.aspect > 1.05;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * camera.aspect;
    if (wide) {
      world.position.set(halfW * 0.5, -0.05, 0);
      world.scale.setScalar(Math.min(1, (halfH * 2) / 7.4));
    } else {
      world.position.set(0, 0.25, 0);
      world.scale.setScalar(Math.min(0.95, (halfW * 2) / 7.2));
    }
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(stage);

  // --- Interaction -----------------------------------------------------------
  const pointer = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  let spinVelocity = 0;
  let dragging = false;
  let lastX = 0;

  window.addEventListener("pointermove", (event) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    if (dragging) {
      spinVelocity += (event.clientX - lastX) * 0.0022;
      lastX = event.clientX;
    }
  }, { passive: true });
  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    stage.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
  });
  const endDrag = () => {
    dragging = false;
    stage.classList.remove("is-dragging");
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // --- Loop ------------------------------------------------------------------
  const clock = new THREE.Clock();
  const dummy = new THREE.Object3D();
  let visible = true;
  let frame = 0;

  const render = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const scroll = Math.min(1, window.scrollY / Math.max(1, stage.offsetHeight));

    // "Audio": a couple of layered sines with a kick every ~0.55s.
    const kick = Math.pow(Math.max(0, Math.sin(t * Math.PI * 1.8)), 12);

    spinVelocity *= dragging ? 0.9 : 0.95;
    can.rotation.y += (reduceMotion ? 0 : 0.35 * dt) + spinVelocity;
    can.position.y = Math.sin(t * 1.3) * 0.09;

    tilt.x += (pointer.y * 0.22 - tilt.x) * 0.06;
    tilt.y += (pointer.x * 0.35 - tilt.y) * 0.06;
    rig.rotation.x = tilt.x;
    rig.rotation.z = -tilt.y * 0.35;
    rig.rotation.y = tilt.y * 0.4;

    const bars = spectrum.userData.count;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2;
      const level =
        0.12 +
        0.5 * Math.abs(Math.sin(t * 3.1 + i * 0.55) * Math.sin(t * 1.7 + i * 0.21)) +
        0.35 * kick * (0.5 + 0.5 * Math.sin(i * 1.3));
      dummy.position.set(Math.cos(a) * 2.05, 0, Math.sin(a) * 2.05);
      dummy.rotation.set(0, -a, 0);
      dummy.scale.set(1, level, 1);
      dummy.updateMatrix();
      spectrum.setMatrixAt(i, dummy.matrix);
    }
    spectrum.instanceMatrix.needsUpdate = true;
    spectrum.rotation.y = t * 0.15;

    rings.rotation.y = t * 0.12;
    ringA.scale.setScalar(1 + kick * 0.045);
    ringB.rotation.z = t * 0.2;
    ringC.rotation.z = -t * 0.1;
    satellites[0].position.set(Math.cos(t * 0.9) * 2.35, Math.sin(t * 0.9) * 2.35, 0);
    satellites[1].position.set(Math.cos(-t * 0.6 + 2) * 2.75, Math.sin(-t * 0.6 + 2) * 2.75, 0);

    halo.material.opacity = 0.28 + kick * 0.14;
    floorGlow.material.opacity = 0.45 + kick * 0.2;

    particles.rotation.y = t * 0.03 + pointer.x * 0.08;
    particles.rotation.x = pointer.y * 0.04;

    camera.position.x += (pointer.x * 0.5 - camera.position.x) * 0.04;
    camera.position.y += (0.3 - pointer.y * 0.35 - camera.position.y) * 0.04;
    camera.lookAt(wide ? world.position.x * 0.35 : 0, world.position.y * 0.4, 0);

    world.position.y = (wide ? -0.05 : 0.25) + scroll * 1.6;
    world.rotation.x = scroll * 0.35;

    renderer.render(scene, camera);
  };

  const loop = () => {
    frame = 0;
    if (!visible) return;
    render();
    frame = requestAnimationFrame(loop);
  };
  const start = () => {
    if (!frame && visible && !document.hidden) frame = requestAnimationFrame(loop);
  };

  render();
  stage.classList.add("is-live");

  if (reduceMotion) {
    new ResizeObserver(() => render()).observe(stage);
    canvas.addEventListener("pointermove", () => dragging && render());
    return;
  }

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
  }).observe(stage);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else start();
  });
  start();
}
