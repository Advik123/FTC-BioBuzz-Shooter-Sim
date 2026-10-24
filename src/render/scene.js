// Renderer, camera, lights. Scene units are inches. `fieldRoot` is rotated so
// that its children can be authored directly in field coordinates (Z up).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc4e8);
  scene.fog = new THREE.Fog(0x9fc4e8, 600, 1400);

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-120, 260, 160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 700;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const fieldRoot = new THREE.Group();
  fieldRoot.rotation.x = -Math.PI / 2; // field (x, y, z-up) -> three (x, z, -y)
  scene.add(fieldRoot);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(900, 64),
    new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 1 }),
  );
  ground.position.z = -0.62;
  ground.receiveShadow = true;
  fieldRoot.add(ground);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  const views = {
    overview: { pos: [150, 160, 200], target: [0, 20, 0] },
    side: { pos: [230, 70, 0], target: [0, 40, 0] },
    behind: null, // set dynamically from the shooter position
    top: { pos: [0, 330, 0.01], target: [0, 0, 0] },
  };

  function setView(name, shooter) {
    let v = views[name];
    if (name === 'behind' && shooter) {
      const { releaseIn, heading } = shooter;
      const back = [releaseIn[0] - Math.cos(heading) * 70, releaseIn[1] - Math.sin(heading) * 70];
      v = { pos: [back[0], 55, -back[1]], target: [0, 45, 0] };
    }
    if (!v) v = views.overview;
    camera.position.set(...v.pos);
    controls.target.set(...v.target);
    controls.update();
  }
  setView('overview');

  const tickers = new Set();
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const f of tickers) f(dt, now);
    controls.update();
    renderer.render(scene, camera);
  });

  return { THREE, renderer, scene, camera, controls, fieldRoot, setView, onTick: (f) => tickers.add(f), offTick: (f) => tickers.delete(f) };
}
