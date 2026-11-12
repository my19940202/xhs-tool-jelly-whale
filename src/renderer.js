import * as THREE from 'three-whale';


import { GLSL_FULL_VS, GLSL_MESH_VS, GLSL_POS_VS, GLSL_SHADOW_FS, GLSL_HEIGHT_FS, GLSL_FLOOR_FS, GLSL_PROPS_FS, GLSL_BACK_FS, GLSL_COPY_FS, GLSL_JELLY_FS, GLSL_LINE_VS, GLSL_LINE_FS, GLSL_POST_FS } from './shaders.js';
// Adapted from the public Blue Whale Jelly artifact. See SOURCE.md.
// ===== renderer.js =====
// ─────────────────────────────────────────────────────────────
//  three.js renderer (WebGL2). Passes, each a THREE.Scene drawn into a render target:
//    key-light shadow map · top-down height map (contact AO)
//    · scene (the sweep; the milky layer, eyes, baleen and bubbles; 4× MSAA, half float)
//    · jelly back-face depth · clear jelly (refraction / absorption / scattering; 4× MSAA) + mesh overlay
//    · NeutralToneMapping + sRGB to the canvas
// ─────────────────────────────────────────────────────────────

const MSAA = 4;
const DYN = 10;   // floats per vertex in the dynamic buffer: position, normal, the centre + radius of the bead it belongs to

class Renderer {
  static async create(canvas, A) {
    if (!canvas.getContext('webgl2')) throw new Error('no-webgl2');
    const r = new Renderer(canvas, A);
    try { r.check(); return r; } catch (error) { r.dispose(); throw error; }
  }

  constructor(canvas, A) {
    const R = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    R.autoClear = false;
    R.toneMapping = THREE.NeutralToneMapping;
    R.toneMappingExposure = 1.0;
    R.outputColorSpace = THREE.SRGBColorSpace;
    if (!R.extensions.has('EXT_color_buffer_float')) { R.dispose(); throw new Error('no-float-targets'); }
    this.three = R;
    this.canvas = canvas;
    const mesh = A.mesh;
    this.mesh = mesh;
    this.nV = mesh.rest.length / 3;
    this.lost = false;
    this.abort = new AbortController();
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; this.onLost?.(); }, { signal: this.abort.signal });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.onRestored?.(); }, { signal: this.abort.signal });

    // ── the whale and everything in it: one interleaved dynamic buffer (skinned position, normal, bead centre) ──
    this.dyn = new Float32Array(this.nV * DYN);
    this.dynBuf = new THREE.InterleavedBuffer(this.dyn, DYN).setUsage(THREE.DynamicDrawUsage);
    const aPos = new THREE.InterleavedBufferAttribute(this.dynBuf, 3, 0);
    const aNrm = new THREE.InterleavedBufferAttribute(this.dynBuf, 3, 3);
    const aCtr = new THREE.InterleavedBufferAttribute(this.dynBuf, 4, 6);
    const aRest = new THREE.BufferAttribute(mesh.rest, 3);
    const aMat = new THREE.BufferAttribute(mesh.mat, 1);
    const aIdx = new THREE.BufferAttribute(mesh.index, 1);
    const geo = (first, count) => {
      const g = new THREE.BufferGeometry();
      g.setIndex(aIdx);
      g.setAttribute('position', aPos); g.setAttribute('normal', aNrm); g.setAttribute('ctr', aCtr);
      g.setAttribute('rest', aRest); g.setAttribute('mat', aMat);
      g.setDrawRange(first, count);
      return g;
    };
    const gBody = geo(0, mesh.body.count);
    const gCasters = geo(0, mesh.body.count + mesh.seeds.count);
    const gProps = geo(mesh.seeds.first, mesh.seeds.count);

    this.linePos = new THREE.BufferAttribute(new Float32Array(A.nParticles * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const gLines = new THREE.BufferGeometry();
    gLines.setAttribute('position', this.linePos);
    gLines.setIndex(new THREE.BufferAttribute(A.simEdges, 1));

    // ── render targets ──
    this.shadowSize = 2048; this.topSize = 1024;
    this.shadowRT = new THREE.WebGLRenderTarget(this.shadowSize, this.shadowSize, {
      type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    const dt = new THREE.DepthTexture(this.shadowSize, this.shadowSize, THREE.FloatType);
    dt.minFilter = dt.magFilter = THREE.LinearFilter;
    dt.compareFunction = THREE.LessCompare;
    this.shadowRT.depthTexture = dt;
    this.heightRT = new THREE.WebGLRenderTarget(this.topSize, this.topSize, {
      type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    const hdrOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, samples: MSAA };
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, hdrOpts);
    this.hdrRT = new THREE.WebGLRenderTarget(1, 1, hdrOpts);
    this.backRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });

    // ── one uniform block shared by every material ──
    const v3 = () => ({ value: new THREE.Vector3() }), v4 = () => ({ value: new THREE.Vector4() }), m4 = () => ({ value: new THREE.Matrix4() });
    this.U = {
      uViewProj: m4(), uInvViewProj: m4(), uLightVP: m4(), uTopVP: m4(),
      uCamPos: v4(), uCamFwd: v3(), uKeyDir: v4(), uScreen: v4(),
      uFlesh: v4(), uFleshDeep: v3(), uPale: v3(), uSkin: v3(), uSeed: v3(), uRough: { value: 0.07 },
      uMisc: v4(), uBg: v3(), uShadowTint: v3(), uAril: v3(), uGlowP: v4(), uGlowC: v3(), uMottle: v4(), uKrill: v3(),
      uShadowDepth: { value: this.shadowRT.texture }, uShadowCmp: { value: dt }, uHeight: { value: this.heightRT.texture },
      uSceneTex: { value: this.sceneRT.texture }, uBackTex: { value: this.backRT.texture }, uHdr: { value: this.hdrRT.texture },
    };
    const mat = (vs, fs, extra = {}) => new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: vs, fragmentShader: fs, toneMapped: false, ...extra });
    const fullscreen = new THREE.PlaneGeometry(2, 2);
    const add = (scene, g, m, order, Kind = THREE.Mesh) => {
      const o = new Kind(g, m); o.frustumCulled = false; o.renderOrder = order; o.matrixAutoUpdate = false; scene.add(o);
      return o;
    };

    this.materials = {
      shadow: mat(GLSL_POS_VS, GLSL_SHADOW_FS, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
      height: mat(GLSL_POS_VS, GLSL_HEIGHT_FS, { side: THREE.DoubleSide }),
      floor: mat(GLSL_FULL_VS, GLSL_FLOOR_FS, { depthTest: false, depthWrite: false }),
      props: mat(GLSL_MESH_VS, GLSL_PROPS_FS),
      back: mat(GLSL_POS_VS, GLSL_BACK_FS, { side: THREE.BackSide }),
      copy: mat(GLSL_FULL_VS, GLSL_COPY_FS, { depthTest: false, depthWrite: false }),
      depth: mat(GLSL_POS_VS, 'void main() { gl_FragColor = vec4(0.0); }', { colorWrite: false }),
      jelly: mat(GLSL_MESH_VS, GLSL_JELLY_FS),
      lines: mat(GLSL_LINE_VS, GLSL_LINE_FS, {
        transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      }),
      post: new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: GLSL_FULL_VS, fragmentShader: GLSL_POST_FS, depthTest: false, depthWrite: false, toneMapped: true }),
    };
    const M = this.materials;
    this.shadowScene = new THREE.Scene(); add(this.shadowScene, gCasters, M.shadow, 0);
    // the height map only takes the body: a small loose drop would print a ring of dots in the contact shading
    this.heightScene = new THREE.Scene(); add(this.heightScene, gBody, M.height, 0);
    this.sceneScene = new THREE.Scene();
    add(this.sceneScene, fullscreen, M.floor, 0); add(this.sceneScene, gProps, M.props, 1);
    this.backScene = new THREE.Scene(); add(this.backScene, gBody, M.back, 0);
    this.mainScene = new THREE.Scene();
    add(this.mainScene, fullscreen, M.copy, 0);
    add(this.mainScene, gProps, M.depth, 1);
    add(this.mainScene, gBody, M.jelly, 2);
    this.lines = add(this.mainScene, gLines, M.lines, 5, THREE.LineSegments);
    this.postScene = new THREE.Scene(); add(this.postScene, fullscreen, M.post, 0);
    for (const s of [this.shadowScene, this.heightScene, this.sceneScene, this.backScene, this.mainScene, this.postScene]) s.matrixWorldAutoUpdate = false;

    // ── cameras ──
    this.camera = new THREE.PerspectiveCamera(27, 1, 0.1, 80);
    this.lightCam = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 16);
    this.lightCam.up.set(0, 0, 1);
    this.topCam = new THREE.OrthographicCamera(-3.2, 3.2, 3.2, -3.2, 0, 5);
    this.topCam.up.set(0, 0, -1);
    this.w = 0; this.h = 0;
  }

  dispose() {
    this.abort.abort();
    const geometries = new Set();
    for (const scene of [this.shadowScene, this.heightScene, this.sceneScene, this.backScene, this.mainScene, this.postScene]) scene.traverse(o => { if (o.geometry) geometries.add(o.geometry); });
    geometries.forEach(g => g.dispose());
    Object.values(this.materials).forEach(m => m.dispose());
    for (const rt of [this.shadowRT, this.heightRT, this.sceneRT, this.backRT, this.hdrRT]) rt.dispose();
    this.three.dispose();
  }

  check() {
    const R = this.three, errs = [];
    const prev = R.debug.onShaderError;
    R.debug.onShaderError = (gl, program, vs, fs) => {
      errs.push((gl.getProgramInfoLog(program) || '') + (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || ''));
    };
    if (!this.w) this.resize(2, 2, 2, 2, 1);
    this.draw(true);
    R.debug.onShaderError = prev;
    if (errs.length) throw new Error('GLSL compile error\n' + errs.join('\n').slice(0, 1500));
  }

  resize(w, h, cssW, cssH, dpr) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.three.setPixelRatio(dpr);
    this.three.setSize(cssW, cssH, false);
    const size = this.three.getDrawingBufferSize(new THREE.Vector2());
    this.w = size.x; this.h = size.y;
    for (const rt of [this.sceneRT, this.hdrRT, this.backRT]) rt.setSize(this.w, this.h);
  }

  // cam = { viewProj, invViewProj, pos, fwd } · light = { dir, intensity, at } · P a palette · S = { time, exposure, meshAlpha, bg, dark, glowP, glowC }
  setUniforms(cam, light, P, S) {
    const U = this.U;
    U.uViewProj.value.fromArray(cam.viewProj); U.uInvViewProj.value.fromArray(cam.invViewProj);
    const at = light.at, d = light.dir;
    this.lightCam.position.set(at[0] + d[0] * 8, at[1] + d[1] * 8, at[2] + d[2] * 8);
    this.lightCam.lookAt(at[0], at[1], at[2]);
    this.lightCam.updateMatrixWorld();
    U.uLightVP.value.multiplyMatrices(this.lightCam.projectionMatrix, this.lightCam.matrixWorldInverse);
    // top-down height map: a camera under the floor looking up, so the lowest surface wins; depth = (y + 1) / 5
    this.topCam.position.set(at[0], -1, at[2]);
    this.topCam.lookAt(at[0], 1, at[2]);
    this.topCam.updateMatrixWorld();
    U.uTopVP.value.multiplyMatrices(this.topCam.projectionMatrix, this.topCam.matrixWorldInverse);
    U.uCamPos.value.set(cam.pos[0], cam.pos[1], cam.pos[2], S.time);
    U.uCamFwd.value.fromArray(cam.fwd);
    U.uKeyDir.value.set(d[0], d[1], d[2], light.intensity);
    U.uScreen.value.set(this.w, this.h, 1 / this.w, 1 / this.h);
    U.uFlesh.value.set(P.flesh[0], P.flesh[1], P.flesh[2], P.density);
    U.uFleshDeep.value.fromArray(P.fleshDeep);
    U.uPale.value.fromArray(P.pale); U.uSkin.value.fromArray(P.skin); U.uSeed.value.fromArray(P.seed);
    U.uRough.value = P.rough;
    U.uMisc.value.set(S.exposure, S.meshAlpha, 0, S.dark || 0);
    U.uBg.value.fromArray(S.bg);
    U.uShadowTint.value.fromArray(P.shadowTint);
    U.uAril.value.fromArray(P.aril); U.uKrill.value.fromArray(P.krill);
    U.uMottle.value.set(P.mottle[0], P.mottle[1], P.mottle[2], P.mottleW);
    U.uGlowP.value.fromArray(S.glowP);
    U.uGlowC.value.fromArray(S.glowC);
    this.three.toneMappingExposure = S.exposure;
  }

  uploadGeometry(particles, showMesh) {
    this.dynBuf.needsUpdate = true;
    if (showMesh) { this.linePos.array.set(particles); this.linePos.needsUpdate = true; }
  }

  draw(showMesh) {
    if (this.lost) return;
    const R = this.three;
    R.setClearColor(0xffffff, 1);
    R.setRenderTarget(this.shadowRT); R.clear(true, true, false); R.render(this.shadowScene, this.lightCam);
    R.setRenderTarget(this.heightRT); R.clear(true, true, false); R.render(this.heightScene, this.topCam);
    R.setClearColor(0x000000, 1);
    R.setRenderTarget(this.sceneRT); R.clear(true, true, false); R.render(this.sceneScene, this.camera);
    R.setRenderTarget(this.backRT); R.clear(true, true, false); R.render(this.backScene, this.camera);
    this.lines.visible = !!showMesh;
    R.setRenderTarget(this.hdrRT); R.clear(true, true, false); R.render(this.mainScene, this.camera);
    R.setRenderTarget(null); R.render(this.postScene, this.camera);
  }
}



export { MSAA, DYN, Renderer };
