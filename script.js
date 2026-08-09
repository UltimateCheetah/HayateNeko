import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';

const { FaceLandmarker, HandLandmarker, FilesetResolver } = window.vision;

// ---------------------------------------------------------------------------
// Hard-coded default model. Swap the text field in the UI to load a different
// VRM, but this raw.githubusercontent URL always works out of the box.
// ---------------------------------------------------------------------------
const DEFAULT_VRM_URL =
  'https://raw.githubusercontent.com/UltimateCheetah/HayateNeko/main/Hayate%Neko.vrm';

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0d2a12, 0.035);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.35, 1.6);

// Orbit controls locked to pan + zoom only, so the model is always facing
// front and can never be spun around.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableRotate = false;
controls.enablePan = true;
controls.enableZoom = true;
controls.screenSpacePanningSpeed = 1.0;
controls.minDistance = 0.5;
controls.maxDistance = 4;
controls.update();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0x9fffc0, 0x0a2a10, 1.1);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff2d6, 1.2);
key.position.set(1.5, 3, 2);
scene.add(key);

const rim = new THREE.DirectionalLight(0x7ce8a5, 0.6);
rim.position.set(-2, 1.5, -1.5);
scene.add(rim);

// ---------------------------------------------------------------------------
// Procedural jungle backdrop (canvas texture) + drifting fireflies, so the
// scene doesn't depend on any external image asset.
// ---------------------------------------------------------------------------
function buildJungleTexture() {
  const w = 2048, h = 1152;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#123a1e');
  sky.addColorStop(0.55, '#0e2c17');
  sky.addColorStop(1, '#081c0f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // god-ray shafts
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * w;
    const grad = ctx.createLinearGradient(x, 0, x + 220, h);
    grad.addColorStop(0, '#eaffb0');
    grad.addColorStop(1, 'rgba(234,255,176,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 260, 0);
    ctx.lineTo(x + 60, h);
    ctx.lineTo(x - 140, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // layered foliage silhouettes (back to front, darker to more saturated)
  const layers = [
    { color: '#0a2312', baseY: h * 0.55, blobs: 26, size: [140, 260] },
    { color: '#0e3018', baseY: h * 0.68, blobs: 22, size: [160, 320] },
    { color: '#124018', baseY: h * 0.82, blobs: 18, size: [220, 420] },
  ];

  layers.forEach(layer => {
    ctx.fillStyle = layer.color;
    for (let i = 0; i < layer.blobs; i++) {
      const x = Math.random() * w;
      const y = layer.baseY + (Math.random() - 0.5) * 60;
      const r = layer.size[0] + Math.random() * (layer.size[1] - layer.size[0]);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ground haze
  const haze = ctx.createLinearGradient(0, h * 0.75, 0, h);
  haze.addColorStop(0, 'rgba(180,255,190,0)');
  haze.addColorStop(1, 'rgba(180,255,190,0.18)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, h * 0.75, w, h * 0.25);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const backdropGeo = new THREE.SphereGeometry(20, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.6);
const backdropMat = new THREE.MeshBasicMaterial({
  map: buildJungleTexture(),
  side: THREE.BackSide,
  fog: false,
});
const backdrop = new THREE.Mesh(backdropGeo, backdropMat);
backdrop.position.y = 2;
scene.add(backdrop);

// ground plane
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(20, 48),
  new THREE.MeshStandardMaterial({ color: 0x0e2412, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// fireflies
const fireflyCount = 60;
const fireflyGeo = new THREE.BufferGeometry();
const fireflyPos = new Float32Array(fireflyCount * 3);
for (let i = 0; i < fireflyCount; i++) {
  fireflyPos[i * 3] = (Math.random() - 0.5) * 8;
  fireflyPos[i * 3 + 1] = Math.random() * 3 + 0.2;
  fireflyPos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
}
fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3));
const fireflyMat = new THREE.PointsMaterial({
  color: 0xbaff8a, size: 0.02, transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const fireflies = new THREE.Points(fireflyGeo, fireflyMat);
scene.add(fireflies);

// ---------------------------------------------------------------------------
// VRM loading
// ---------------------------------------------------------------------------
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

let currentVrm = null;
const loadingEl = document.getElementById('loading');

function loadVrm(url) {
  loadingEl.classList.remove('hidden');
  loadingEl.textContent = 'Loading model…';

  loader.load(
    url,
    (gltf) => {
      const vrm = gltf.userData.vrm;

      if (currentVrm) {
        scene.remove(currentVrm.scene);
        VRMUtils.deepDispose(currentVrm.scene);
      }

      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.rotateVRM0(vrm); // face the model toward +Z (the camera)

      vrm.scene.traverse((obj) => { obj.frustumCulled = false; });

      // Lock the whole body's base rotation so nothing but tracked bones
      // (head / hands) can ever turn it away from the camera.
      vrm.scene.rotation.y = Math.PI + vrm.scene.rotation.y - vrm.scene.rotation.y; // no-op guard, kept explicit below
      lockedBaseRotationY = vrm.scene.rotation.y;

      scene.add(vrm.scene);
      currentVrm = vrm;
      loadingEl.classList.add('hidden');
    },
    (progress) => {
      if (progress.total) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        loadingEl.textContent = `Loading model… ${pct}%`;
      }
    },
    (error) => {
      console.error(error);
      loadingEl.textContent = 'Failed to load model — check the URL.';
    }
  );
}

let lockedBaseRotationY = 0;

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
document.getElementById('loadModelBtn').addEventListener('click', () => {
  const url = document.getElementById('vrmUrl').value.trim();
  if (url) loadVrm(url);
});

document.getElementById('zoomSlider').addEventListener('input', (e) => {
  const dist = parseFloat(e.target.value);
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
});

loadVrm(DEFAULT_VRM_URL);

// ---------------------------------------------------------------------------
// Webcam + MediaPipe face / hand tracking
// ---------------------------------------------------------------------------
const video = document.getElementById('webcam');
const camStatus = document.getElementById('camStatus');
const startCamBtn = document.getElementById('startCamBtn');

let faceLandmarker = null;
let handLandmarker = null;
let trackingActive = false;

async function initLandmarkers() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
  });

  handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
  });
}

startCamBtn.addEventListener('click', async () => {
  if (trackingActive) return;
  try {
    startCamBtn.disabled = true;
    startCamBtn.textContent = 'Starting…';

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    if (!faceLandmarker || !handLandmarker) await initLandmarkers();

    trackingActive = true;
    camStatus.textContent = 'camera on';
    camStatus.classList.add('active');
    startCamBtn.textContent = 'Tracking Active';
  } catch (err) {
    console.error(err);
    camStatus.textContent = 'camera denied';
    startCamBtn.disabled = false;
    startCamBtn.textContent = 'Start Camera Tracking';
  }
});

// smoothing helper
const lerp = (a, b, t) => a + (b - a) * t;

// current smoothed head euler (in radians), clamped so the body still reads
// as "facing front" even while looking around
const headRotation = { x: 0, y: 0, z: 0 };
const HEAD_CLAMP = { x: 0.5, y: 0.6, z: 0.35 };

function applyFaceTracking(result) {
  if (!currentVrm) return;
  const humanoid = currentVrm.humanoid;
  const expressionManager = currentVrm.expressionManager;

  // --- head rotation from the facial transformation matrix ---
  if (result.facialTransformationMatrixes && result.facialTransformationMatrixes.length) {
    const m = new THREE.Matrix4().fromArray(result.facialTransformationMatrixes[0].data);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');

    const targetX = THREE.MathUtils.clamp(-euler.x, -HEAD_CLAMP.x, HEAD_CLAMP.x);
    const targetY = THREE.MathUtils.clamp(-euler.y, -HEAD_CLAMP.y, HEAD_CLAMP.y);
    const targetZ = THREE.MathUtils.clamp(euler.z, -HEAD_CLAMP.z, HEAD_CLAMP.z);

    headRotation.x = lerp(headRotation.x, targetX, 0.25);
    headRotation.y = lerp(headRotation.y, targetY, 0.25);
    headRotation.z = lerp(headRotation.z, targetZ, 0.25);

    const headBone = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    if (headBone) {
      headBone.rotation.set(headRotation.x, headRotation.y, headRotation.z);
    }
    const neckBone = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck);
    if (neckBone) {
      neckBone.rotation.set(headRotation.x * 0.3, headRotation.y * 0.3, headRotation.z * 0.3);
    }
  }

  // --- blendshapes -> VRM expressions ---
  if (expressionManager && result.faceBlendshapes && result.faceBlendshapes.length) {
    const shapes = {};
    for (const cat of result.faceBlendshapes[0].categories) {
      shapes[cat.categoryName] = cat.score;
    }

    const blink = (l, r) => Math.min(1, (l + r) / 2);
    expressionManager.setValue('blink',
      lerp(expressionManager.getValue('blink') ?? 0,
        blink(shapes.eyeBlinkLeft || 0, shapes.eyeBlinkRight || 0), 0.4));

    const browUp = Math.min(1, ((shapes.browOuterUpLeft || 0) + (shapes.browOuterUpRight || 0)) / 2);
    expressionManager.setValue('surprised', lerp(expressionManager.getValue('surprised') ?? 0, browUp, 0.3));

    const smile = Math.min(1, ((shapes.mouthSmileLeft || 0) + (shapes.mouthSmileRight || 0)) / 2);
    expressionManager.setValue('happy', lerp(expressionManager.getValue('happy') ?? 0, smile, 0.3));

    // face-driven jaw open feeds into the lip sync mix below
    faceJawOpen = shapes.jawOpen || 0;
  }
}

function applyHandTracking(result) {
  if (!currentVrm || !result.landmarks || !result.landmarks.length) return;
  const humanoid = currentVrm.humanoid;

  result.landmarks.forEach((landmarks, i) => {
    // MediaPipe reports the mirrored camera image, so "Left" in handedness
    // corresponds to the user's right hand as seen selfie-style.
    const handedness = result.handedness[i][0].categoryName; // 'Left' | 'Right'
    const isUserRight = handedness === 'Left';

    const wrist = landmarks[0];
    const middleTip = landmarks[12];

    // wrist position drives lower-arm rotation so the hand roughly follows
    // where the user holds their real hand, within a small comfortable range
    const dx = (wrist.x - 0.5) * 2;   // -1..1 across frame
    const dy = (0.5 - wrist.y) * 2;   // -1..1, inverted so up = up

    const boneNames = isUserRight
      ? [VRMHumanBoneName.RightLowerArm, VRMHumanBoneName.RightHand]
      : [VRMHumanBoneName.LeftLowerArm, VRMHumanBoneName.LeftHand];

    const lowerArm = humanoid?.getNormalizedBoneNode(boneNames[0]);
    if (lowerArm) {
      const sign = isUserRight ? -1 : 1;
      const targetZ = THREE.MathUtils.clamp(sign * dx * 0.8, -0.9, 0.9);
      const targetX = THREE.MathUtils.clamp(-dy * 0.6, -0.6, 0.6);
      lowerArm.rotation.z = lerp(lowerArm.rotation.z, targetZ, 0.2);
      lowerArm.rotation.x = lerp(lowerArm.rotation.x, targetX, 0.2);
    }

    // simple per-finger curl from landmark distances (tip-to-wrist vs
    // knuckle-to-wrist) applied to proximal finger bones
    const fingers = [
      { name: 'Thumb', tip: 4, base: 2 },
      { name: 'Index', tip: 8, base: 5 },
      { name: 'Middle', tip: 12, base: 9 },
      { name: 'Ring', tip: 16, base: 13 },
      { name: 'Little', tip: 20, base: 17 },
    ];

    fingers.forEach((f) => {
      const tip = landmarks[f.tip];
      const base = landmarks[f.base];
      const tipDist = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
      const baseDist = Math.hypot(base.x - wrist.x, base.y - wrist.y);
      const curl = THREE.MathUtils.clamp(1 - tipDist / (baseDist + 0.0001), 0, 1);

      const side = isUserRight ? 'Right' : 'Left';
      const proximalBoneName = VRMHumanBoneName[`${side}${f.name}Proximal`];
      const bone = proximalBoneName ? humanoid?.getNormalizedBoneNode(proximalBoneName) : null;
      if (bone) {
        const curlAngle = curl * 1.1;
        bone.rotation.z = lerp(bone.rotation.z, isUserRight ? curlAngle : -curlAngle, 0.35);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Lip sync (mic amplitude) — combined with camera-based jaw open when both
// are active, so the mouth reacts to whichever signal is strongest.
// ---------------------------------------------------------------------------
const startMicBtn = document.getElementById('startMicBtn');
const micStatus = document.getElementById('micStatus');

let audioCtx = null, analyser = null, micData = null;
let micActive = false;
let faceJawOpen = 0;
let mouthOpenSmoothed = 0;

startMicBtn.addEventListener('click', async () => {
  if (micActive) return;
  try {
    startMicBtn.disabled = true;
    startMicBtn.textContent = 'Starting…';

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    micData = new Uint8Array(analyser.fftSize);

    micActive = true;
    micStatus.textContent = 'mic on';
    micStatus.classList.add('active');
    startMicBtn.textContent = 'Lip Sync Active';
  } catch (err) {
    console.error(err);
    micStatus.textContent = 'mic denied';
    startMicBtn.disabled = false;
    startMicBtn.textContent = 'Start Lip Sync (Mic)';
  }
});

function getMicVolume() {
  if (!analyser || !micData) return 0;
  analyser.getByteTimeDomainData(micData);
  let sumSquares = 0;
  for (let i = 0; i < micData.length; i++) {
    const norm = (micData[i] - 128) / 128;
    sumSquares += norm * norm;
  }
  const rms = Math.sqrt(sumSquares / micData.length);
  return THREE.MathUtils.clamp(rms * 6, 0, 1); // gain so normal speech reads clearly
}

function updateLipSync() {
  if (!currentVrm || !currentVrm.expressionManager) return;
  const micVolume = micActive ? getMicVolume() : 0;
  const target = Math.max(micVolume, faceJawOpen);
  mouthOpenSmoothed = lerp(mouthOpenSmoothed, target, 0.5);
  currentVrm.expressionManager.setValue('aa', mouthOpenSmoothed);
}

// ---------------------------------------------------------------------------
// Tracking loop (runs on video frames independent of the render loop)
// ---------------------------------------------------------------------------
function trackingLoop() {
  if (trackingActive && video.readyState >= 2) {
    const now = performance.now();
    const faceResult = faceLandmarker.detectForVideo(video, now);
    applyFaceTracking(faceResult);

    const handResult = handLandmarker.detectForVideo(video, now);
    applyHandTracking(handResult);
  }
  requestAnimationFrame(trackingLoop);
}
trackingLoop();

// ---------------------------------------------------------------------------
// Main render loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // gently keep the body locked front-on even as head/arms move
  if (currentVrm) {
    currentVrm.scene.rotation.y = lockedBaseRotationY;
    updateLipSync();
    currentVrm.update(delta);
  }

  // drifting fireflies
  const pos = fireflyGeo.attributes.position;
  for (let i = 0; i < fireflyCount; i++) {
    pos.array[i * 3 + 1] += Math.sin(elapsed + i) * 0.0006;
    pos.array[i * 3] += Math.cos(elapsed * 0.5 + i) * 0.0004;
  }
  pos.needsUpdate = true;

  controls.update();
  renderer.render(scene, camera);
}
animate();
