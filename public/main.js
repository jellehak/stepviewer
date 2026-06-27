import * as THREE from "three/build/three.module.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import ocFactory from "opencascade.js/dist/opencascade.wasm.js";
import openCascadeHelper from "./common/openCascadeHelper.js";

const fileInput = document.getElementById("file-input");
const statusEl = document.getElementById("status");
const viewerEl = document.getElementById("viewer");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f6f9);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
camera.position.set(180, 120, 180);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewerEl.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 20, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(120, 180, 80);
scene.add(key);

const grid = new THREE.GridHelper(300, 30, 0x8ba3b8, 0xc6d3df);
scene.add(grid);

let modelObject = null;
let oc = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function resize() {
  const width = viewerEl.clientWidth;
  const height = viewerEl.clientHeight;
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function frame() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

async function initOc() {
  const distPath = "/node_modules/opencascade.js/dist/";
  return ocFactory({
    locateFile: (file) => `${distPath}${file}`
  });
}

function clearModel() {
  if (!modelObject) {
    return;
  }
  scene.remove(modelObject);
  modelObject.traverse((node) => {
    if (!node.isMesh) {
      return;
    }
    node.geometry?.dispose();
    node.material?.dispose();
  });
  modelObject = null;
}

function shapeToObject(ocInstance, shape) {
  openCascadeHelper.setOpenCascade(ocInstance);
  const facelist = openCascadeHelper.tessellate(shape);
  const [vertexCoord, normalCoord, triIndices] = openCascadeHelper.joinPrimitives(facelist);

  if (vertexCoord.length === 0 || triIndices.length === 0) {
    throw new Error("No triangulation produced from STEP model.");
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertexCoord, 3));
  geometry.setIndex(triIndices);

  if (normalCoord.length > 0) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normalCoord, 3));
  } else {
    geometry.computeVertexNormals();
  }

  geometry.computeBoundingBox();

  const material = new THREE.MeshStandardMaterial({
    color: 0xa8c5e6,
    metalness: 0.08,
    roughness: 0.45,
    side: THREE.DoubleSide
  });

  return new THREE.Mesh(geometry, material);
}

async function loadStep(file) {
  if (!oc) {
    setStatus("OpenCascade still loading...");
    return;
  }

  const extension = file.name.toLowerCase().split(".").pop();
  const fileType = extension === "stp" || extension === "step" ? "step" : "step";
  const virtualName = `file.${fileType}`;
  const virtualPath = `/${virtualName}`;
  const fileText = await file.text();

  try {
    if (oc.FS.analyzePath(virtualPath).exists) {
      oc.FS.unlink(virtualPath);
    }

    oc.FS.createDataFile("/", virtualName, fileText, true, true);

    const reader = new oc.STEPControl_Reader_1();
    const status = reader.ReadFile(virtualName);
    const done = oc.IFSelect_ReturnStatus?.IFSelect_RetDone;
    const isReadOk = status === done || status === 1 || String(status) === String(done);

    if (!isReadOk) {
      throw new Error(`STEP read failed (status: ${String(status)})`);
    }

    const transferred = typeof oc.Message_ProgressRange_1 === "function"
      ? reader.TransferRoots(new oc.Message_ProgressRange_1())
      : reader.TransferRoots();
    if (!transferred) {
      throw new Error("STEP transfer failed (no transferable roots).");
    }
    const shape = reader.OneShape();

    clearModel();
    modelObject = shapeToObject(oc, shape);
    scene.add(modelObject);

    const box = new THREE.Box3().setFromObject(modelObject);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    modelObject.position.sub(center);

    const fit = Math.max(size.x, size.y, size.z) || 1;
    camera.position.set(fit * 1.3, fit * 0.9, fit * 1.3);
    controls.target.set(0, 0, 0);
    controls.update();

    if (oc.FS.analyzePath(virtualPath).exists) {
      oc.FS.unlink(virtualPath);
    }

    setStatus(`Loaded ${file.name}`);
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`);
  }
}

function isStepFile(file) {
  const extension = file?.name?.toLowerCase().split(".").pop();
  return extension === "step" || extension === "stp";
}

async function handleIncomingFile(file) {
  if (!file) {
    return;
  }

  if (!isStepFile(file)) {
    setStatus("Unsupported file type. Drop a .step or .stp file.");
    return;
  }

  setStatus(`Reading ${file.name}...`);
  await loadStep(file);
}

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  await handleIncomingFile(file);
});

document.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
});

document.addEventListener("drop", async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  await handleIncomingFile(file);
});

window.addEventListener("resize", resize);
resize();
frame();

(async () => {
  try {
    oc = await initOc();
    setStatus("OpenCascade ready. Pick a STEP file.");
  } catch (error) {
    console.error(error);
    setStatus("Failed to initialize OpenCascade.");
  }
})();
