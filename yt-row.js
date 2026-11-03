/* 유튜브 로잉 VR (youtube-rowing.bat이 주입)
 * - 이 페이지의 유튜브 영상을 헤드셋 전체 화면(구면)에 띄움 (360 / 360 상하입체 / 180 좌우입체)
 * - 싱글 스컬 선체, 리거, 노(캐치·드라이브·피니시·페더링), 물 위 노 자국, 뱃머리 물살
 * - 컨트롤러를 핸들처럼 당기는 동작 → 배 속도 → 영상 재생 속도
 * - 소리: 실제 녹음(노 첨벙·노받이·물방울, 속도별 물소리 3겹), 좌우 입체음
 * 필요: window.THREE (r128). 영상은 내려받지 않는다. 개인 테스트용.
 */
(() => {
  "use strict";
  if (window.__rowVR) { window.__rowVR.toggle(); return; }

  // ======================================================================
  // 상태
  // ======================================================================
  const S = {
    on: true, mode: "smooth", tau: 3, vRef: 11 / 3.6, power: 1, format: "360", quality: "hd1440", water: true,
    p: 0, pPrev: 0, hv: 0, v: 0, vSmooth: 0, rate: 0, dist: 0,
    peak: false, strokes: [], spm: 0, strokeStart: 0,
    phase: "recovery", phaseT: 0, drivePower: 0, lastPower: 0.5, peakVel: 0,
    pf: 0, pfPrev: 0, vel: 0, upFrames: 0,
    brake: 0, trig: 0, handY: null, handBase: null,
    dMax: 0.55, dMin: 0.22, yaw: null,
    xr: false, hands: 0, last: performance.now(),
  };
  try { Object.assign(S, JSON.parse(localStorage.getItem("rowvr.yt3") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("rowvr.yt3", JSON.stringify({ mode: S.mode, tau: S.tau, vRef: S.vRef, power: S.power, format: S.format, quality: S.quality, water: S.water })); } catch (e) {} };
  const video = () => document.querySelector("video.html5-main-video") || document.querySelector("video");
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;

  // ======================================================================
  // 패널
  // ======================================================================
  const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
  const panel = el("div", "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;max-height:calc(100vh - 32px);overflow-y:auto;background:#151c20;color:#e6ecee;border:1px solid #f2a33a;border-radius:12px;padding:14px;font:14px/1.5 system-ui,'Malgun Gothic',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)");
  panel.appendChild(el("div", "font-weight:700;font-size:15px;margin-bottom:4px;color:#f2a33a", "로잉 VR"));
  const status = el("div", "font-size:13px;color:#8d9ba1;margin-bottom:10px", "");
  panel.appendChild(status);
  const btnCss = "background:#2a3338;color:#e6ecee;border:1px solid #3d4a51;border-radius:8px;padding:8px 10px;font:500 13px system-ui,sans-serif;cursor:pointer";
  const onCss = ";background:rgba(242,163,58,.25);border-color:#f2a33a";

  const stats = el("div", "display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font:600 18px ui-monospace,Consolas,monospace;margin-bottom:10px");
  const mkStat = (k) => { const w = el("div"); w.appendChild(el("div", "font:400 11px system-ui,sans-serif;color:#8d9ba1", k)); const v = el("div", "", "-"); w.appendChild(v); stats.appendChild(w); return v; };
  const sPace = mkStat("페이스/500m"), sSpm = mkStat("spm"), sRate = mkStat("배속");
  panel.appendChild(stats);

  const settings = el("div", "display:none;border-top:1px solid #3d4a51;padding-top:10px;margin-top:4px");
  const segRow = (label, opts, get, set) => {
    settings.appendChild(el("div", "font-size:12px;color:#8d9ba1;margin-bottom:4px", label));
    const r = el("div", `display:grid;grid-template-columns:repeat(${opts.length},1fr);gap:6px;margin-bottom:10px`);
    const bs = {};
    const paint = () => { for (const [k, b] of Object.entries(bs)) b.style.cssText = btnCss + (String(get()) === k ? onCss : ""); };
    for (const [k, text] of opts) { const b = el("button", btnCss, text); b.onclick = () => { set(k); paint(); save(); }; bs[k] = b; r.appendChild(b); }
    paint(); settings.appendChild(r); return paint;
  };
  segRow("영상 형식", [["360", "360"], ["360tb", "360 입체"], ["180", "180 입체"]], () => S.format, k => { S.format = k; if (scene) buildVideoMeshes(); });
  segRow("화질", [["hd1440", "1440p (부드럽게)"], ["hd2160", "4K (선명하게)"]], () => S.quality, k => { S.quality = k; setQuality(); });
  segRow("소리", [["true", "물소리 (음악 끄기)"], ["false", "유튜브 소리"]], () => S.water, k => { S.water = k === "true"; applySound(); });
  const paintMode = segRow("영상 속도 반응 (VR 안에서는 A 버튼)", [["smooth", "부드럽게"], ["instant", "즉각"]], () => S.mode, k => { S.mode = k; });
  const slider = (label, min, max, step, get, set, fmt) => {
    const wrap = el("div", "margin-bottom:6px");
    const top = el("div", "display:flex;justify-content:space-between;font-size:12px;color:#8d9ba1");
    const val = el("b", "color:#e6ecee;font-family:ui-monospace,Consolas,monospace", fmt(get()));
    top.append(el("span", "", label), val);
    const r = el("input", "width:100%;accent-color:#f2a33a");
    r.type = "range"; r.min = min; r.max = max; r.step = step; r.value = get();
    r.oninput = () => { set(+r.value); val.textContent = fmt(+r.value); save(); };
    wrap.append(top, r); settings.appendChild(wrap);
  };
  slider("촬영 당시 배 속도", 3, 25, 1, () => Math.round(S.vRef * 3.6), v => S.vRef = v / 3.6, v => v + " km/h");
  slider("부드러움", 0.5, 8, 0.5, () => S.tau, v => S.tau = v, v => v.toFixed(1) + "초");
  slider("당기는 힘", 0.3, 3, 0.1, () => S.power, v => S.power = v, v => v.toFixed(1) + "×");
  settings.appendChild(el("div", "font-size:12px;color:#8d9ba1;margin:6px 0 8px",
    "VR 안에서: 컨트롤러를 핸들처럼 모아 쥐고 팔을 뻗었다가 몸 쪽으로 당기세요. 머리·컨트롤러·손 인식을 함께 써서, 로잉머신에선 컨트롤러 없이 핸들만 잡고 저어도 됩니다. 멈추려면 트리거를 당기거나 손을 들어 올려 노를 물에 박으세요. 그립 버튼 = 정면 다시 맞추기, A 버튼 = 반응 방식, 메타 버튼 = 종료."));
  const closeBtn = el("button", btnCss + ";width:100%", "패널 닫기");
  closeBtn.onclick = () => api.toggle();
  settings.appendChild(closeBtn);

  const setBtn = el("button", btnCss + ";width:100%;margin-bottom:8px", "설정 열기 ▾");
  setBtn.onclick = () => { const open = settings.style.display === "none"; settings.style.display = open ? "block" : "none"; setBtn.textContent = open ? "설정 닫기 ▴" : "설정 열기 ▾"; };
  const vrBtn = el("button", "width:100%;background:#f2a33a;color:#1a1206;border:0;border-radius:10px;padding:12px;font:700 16px system-ui,sans-serif;cursor:pointer;margin-top:8px", "VR 시작");
  panel.append(setBtn, settings, vrBtn);
  (document.body || document.documentElement).appendChild(panel);
  const setStatus = (t) => { status.textContent = t; };
  if (!window.THREE) setStatus("3D 엔진이 없습니다. youtube-rowing.bat으로 실행해 주세요.");
  else setStatus(navigator.xr ? "영상이 재생되는지 확인한 뒤 'VR 시작'을 누르세요." : "이 브라우저는 VR을 지원하지 않습니다.");

  // ======================================================================
  // 화질 고정
  // ======================================================================
  function setQuality() {
    const mp = document.getElementById("movie_player");
    try { if (mp && mp.setPlaybackQualityRange) mp.setPlaybackQualityRange(S.quality, S.quality); } catch (e) {}
    try { if (mp && mp.setPlaybackQuality) mp.setPlaybackQuality(S.quality); } catch (e) {}
  }
  setQuality();

  // ======================================================================
  // 소리 (실제 녹음 — Pixabay, Pixabay Content License)
  // ======================================================================
  let actx = null, master = null, SB = null, loops = null, soundsLoading = false;
  function initAudio() {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; return; }
    master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
    loadSounds();
  }
  async function loadSounds() {
    if (soundsLoading || !actx) return; soundsLoading = true;
    let data = window.__rowSounds;
    if (!data) { try { data = await (await fetch("https://madmachine-x.github.io/rowing-vr/sounds.json")).json(); } catch (e) { data = null; } }
    if (!data || !data.soft) { soundsLoading = false; return; }
    const dec = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return actx.decodeAudioData(u.buffer); };
    try {
      const all = (arr) => Promise.all(arr.map(dec));
      SB = { soft: await all(data.soft), hard: await all(data.hard), clunk: await all(data.clunk), drip: await all(data.drip),
             lap: await dec(data.lap), glide: await dec(data.glide), rush: await dec(data.rush) };
      if (S.xr && S.water) startLoops();
    } catch (e) { SB = null; }
  }
  function startLoops() {
    if (!actx || !SB || loops) return;
    const mk = (buf, g0) => {
      const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = actx.createGain(); g.gain.value = g0;
      src.connect(g); g.connect(master); src.start(0, Math.random() * buf.duration);
      return { src, g };
    };
    loops = { lap: mk(SB.lap, 0.6), glide: mk(SB.glide, 0.0), rush: mk(SB.rush, 0.0) };
  }
  function stopLoops() { if (!loops) return; for (const k in loops) { try { loops[k].src.stop(); } catch (e) {} } loops = null; }
  function updateLoops() {
    if (!loops || !actx) return;
    const v = S.vSmooth, t = actx.currentTime;
    // 멈춤: 잔잔한 물결 / 활주: 배 밑 물소리 / 빠름: 물살
    const lap = 0.55 * (1 - smooth(v / 1.8)) + 0.12;
    const glide = 0.9 * smooth(v / 1.6) * (1 - 0.35 * smooth((v - 3) / 1.5));
    const rush = 0.8 * smooth((v - 2.2) / 2);
    loops.lap.g.gain.setTargetAtTime(lap, t, 0.35);
    loops.glide.g.gain.setTargetAtTime(glide, t, 0.35);
    loops.rush.g.gain.setTargetAtTime(rush, t, 0.35);
    loops.glide.src.playbackRate.setTargetAtTime(0.92 + 0.18 * smooth(v / 4.5), t, 0.5);
    // 드라이브 중 배가 밀릴 때 물소리가 살짝 커짐
    const surge = S.phase === "drive" ? 0.18 * S.drivePower : 0;
    master.gain.setTargetAtTime(0.85 + surge, t, 0.12);
  }
  const lastPick = {};
  function pick(pool, key) {
    let i = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && i === lastPick[key]) i = (i + 1) % pool.length;
    lastPick[key] = i; return pool[i];
  }
  // 좌우 노 위치에서 나는 소리 (왼쪽 노는 왼쪽 귀, 오른쪽 노는 오른쪽 귀)
  function playAt(buf, pan, vol, delay, rate) {
    if (!actx || !buf) return;
    const src = actx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = rate || (0.96 + Math.random() * 0.08);
    const g = actx.createGain(); g.gain.value = vol;
    let node = g;
    if (actx.createStereoPanner) { const p = actx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    src.connect(g); node.connect(master); src.start(actx.currentTime + (delay || 0));
  }
  function sndCatch(power) {
    if (!SB || !S.water) return;
    const hard = power > 0.55, pool = hard ? SB.hard : SB.soft, key = hard ? "hard" : "soft";
    const vol = 0.55 + 0.45 * power;
    playAt(pick(pool, key + "L"), -0.65, vol, 0, null);
    playAt(pick(pool, key + "R"), 0.65, vol * 0.92, 0.012 + Math.random() * 0.02, null);   // 두 노가 아주 살짝 어긋나게
  }
  function sndClunk(vol) {
    if (!SB || !S.water) return;
    playAt(pick(SB.clunk, "cL"), -0.8, vol, 0, 0.97 + Math.random() * 0.06);
    playAt(pick(SB.clunk, "cR"), 0.8, vol * 0.9, 0.02 + Math.random() * 0.03, 0.97 + Math.random() * 0.06);
  }
  function sndDrip() {
    if (!SB || !S.water) return;
    playAt(pick(SB.drip, "dL"), -0.75, 0.5, 0.05, null);
    playAt(pick(SB.drip, "dR"), 0.75, 0.45, 0.12, null);
  }
  // 노를 물에 박아 세울 때: 큰 첨벙 + 블레이드에 물이 부딪히는 '쏴아' 소리(속도에 비례)
  let brakeSnd = null;
  function sndBrakeStart(v) {
    if (!SB || !S.water || !actx) return;
    const strength = smooth(v / 3.5);
    playAt(pick(SB.hard, "bL"), -0.7, 0.5 + 0.5 * strength, 0, 0.9);
    playAt(pick(SB.hard, "bR"), 0.7, 0.5 + 0.45 * strength, 0.015, 0.92);
    if (brakeSnd) return;
    const src = actx.createBufferSource(); src.buffer = SB.rush; src.loop = true; src.playbackRate.value = 1.25;
    const bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.6;
    const g = actx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(master); src.start(0, Math.random() * SB.rush.duration);
    brakeSnd = { src, g, bp };
  }
  function updateBrakeSound() {
    if (!brakeSnd || !actx) return;
    const t = actx.currentTime, on = S.phase === "brake";
    const lvl = on ? 1.6 * smooth(S.v / 3) * S.brake : 0;
    brakeSnd.g.gain.setTargetAtTime(lvl, t, on ? 0.05 : 0.25);
    brakeSnd.src.playbackRate.setTargetAtTime(0.9 + 0.5 * smooth(S.v / 4), t, 0.1);
    brakeSnd.bp.frequency.setTargetAtTime(500 + 900 * smooth(S.v / 4), t, 0.1);
    if (!on && S.phaseT > 1.2) { try { brakeSnd.src.stop(); } catch (e) {} brakeSnd = null; }
  }
  function applySound() {
    const vid = video();
    if (S.xr && S.water) { if (vid) vid.muted = true; startLoops(); }
    else { if (vid) vid.muted = false; stopLoops(); }
  }

  // ======================================================================
  // 3D 장면
  // ======================================================================
  let renderer = null, scene = null, camera = null, worldGroup = null, videoGroup = null, boat = null;
  let vtex = null, texOK = true, lastVideoTime = -1, hemi = null, sun = null;
  const WATER_Y = -0.92;          // 눈높이 기준 수면 높이
  const PIN_Y = -0.62, PIN_X = 0.80, PIN_Z = -0.05;
  const OUTBOARD = 1.98;          // 노받이~블레이드 끝
  const oars = [], puddles = [], drops = [], spray = [], grips = [];
  let wake = null, coachTex = null, coachCtx = null;

  function initScene() {
    const T = window.THREE;
    renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(1);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local");
    if (renderer.outputEncoding !== undefined) renderer.outputEncoding = T.sRGBEncoding;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(80, 1, 0.03, 500);
    worldGroup = new T.Group(); scene.add(worldGroup);
    videoGroup = new T.Group(); scene.add(videoGroup);
    hemi = new T.HemisphereLight(0xdfe9f3, 0x46524a, 1.25); scene.add(hemi);
    sun = new T.DirectionalLight(0xfff4e0, 1.0); sun.position.set(-2, 6, 3); scene.add(sun);

    vtex = new T.Texture();
    vtex.minFilter = T.LinearFilter; vtex.magFilter = T.LinearFilter; vtex.generateMipmaps = false;
    if (vtex.encoding !== undefined) vtex.encoding = T.sRGBEncoding;
    buildVideoMeshes();
    buildBoat();
  }

  function editUV(geo, fu, fv) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) { if (fu) uv.setX(i, fu(uv.getX(i))); if (fv) uv.setY(i, fv(uv.getY(i))); }
    uv.needsUpdate = true; return geo;
  }
  function buildVideoMeshes() {
    const T = window.THREE;
    while (videoGroup.children.length) { const m = videoGroup.children.pop(); m.geometry.dispose(); m.material.dispose(); }
    const mat = () => new T.MeshBasicMaterial({ map: vtex, depthWrite: false, toneMapped: false });
    const R = 200;
    if (S.format === "360") {
      const g = new T.SphereGeometry(R, 96, 64); g.scale(-1, 1, 1);
      const m = new T.Mesh(g, mat()); m.rotation.y = -Math.PI / 2; m.renderOrder = -10; videoGroup.add(m);
    } else if (S.format === "360tb") {
      for (const eye of [1, 2]) {
        const g = new T.SphereGeometry(R, 96, 64); g.scale(-1, 1, 1);
        editUV(g, null, v => eye === 1 ? 0.5 + v * 0.5 : v * 0.5);
        const m = new T.Mesh(g, mat()); m.rotation.y = -Math.PI / 2; m.layers.set(eye); m.renderOrder = -10; videoGroup.add(m);
      }
    } else {
      for (const eye of [1, 2]) {
        const g = new T.SphereGeometry(R, 64, 64, Math.PI, Math.PI); g.scale(-1, 1, 1);
        editUV(g, u => u * 0.5 + (eye === 2 ? 0.5 : 0), null);
        const m = new T.Mesh(g, mat()); m.layers.set(eye); m.renderOrder = -10; videoGroup.add(m);
      }
    }
  }

  // ---------- 싱글 스컬 ----------
  function hullGeometry(T) {
    // 길이 방향(z) 단면을 이어 붙인 가늘고 긴 선체. 앞쪽(-z)이 뱃머리.
    const N = 60, zBow = -4.6, zStern = 2.6;
    const beamAt = (z) => {            // 반폭(m): 콕핏 부근 0.155, 끝으로 갈수록 뾰족
      const t = z < -0.2 ? (z - zBow) / (-0.2 - zBow) : 1 - (z + 0.2) / (zStern + 0.2) * 0.85;
      return 0.155 * Math.pow(clamp(t, 0, 1), 0.62);
    };
    const depthAt = (z) => 0.13 * Math.pow(clamp(beamAt(z) / 0.155, 0, 1), 0.8) + 0.01;
    const M = 14, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const z = lerp(zBow, zStern, i / N), b = beamAt(z), d = depthAt(z);
      for (let j = 0; j <= M; j++) { const a = Math.PI * (j / M); pos.push(Math.cos(a) * b, -Math.sin(a) * d, z); }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b2 = a + M + 1; idx.push(a, b2, a + 1, a + 1, b2, b2 + 1); }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return { geo: g, beamAt, zBow, zStern };
  }
  function deckGeometry(T, beamAt, z0, z1, crown) {
    const N = 40, M = 6, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const z = lerp(z0, z1, i / N), b = beamAt(z);
      for (let j = 0; j <= M; j++) { const u = j / M * 2 - 1; pos.push(u * b, crown * (1 - u * u) * (b / 0.155), z); }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b2 = a + M + 1; idx.push(a, a + 1, b2, a + 1, b2 + 1, b2); }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  function bladeGeometry(T) {
    // 비대칭 '빅 블레이드' 모양 (위가 길고 아래가 짧은 도끼날)
    const sh = new T.Shape();
    sh.moveTo(0, 0.02);
    sh.bezierCurveTo(0.12, 0.09, 0.32, 0.12, 0.47, 0.10);
    sh.bezierCurveTo(0.50, 0.04, 0.50, -0.06, 0.45, -0.10);
    sh.bezierCurveTo(0.30, -0.11, 0.12, -0.07, 0, -0.02);
    sh.lineTo(0, 0.02);
    const g = new T.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1, curveSegments: 12 });
    g.translate(0, 0, -0.006);
    return g;
  }
  function buildBoat() {
    const T = window.THREE;
    boat = new T.Group(); worldGroup.add(boat);
    const DS = T.DoubleSide;
    const white = new T.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.32, metalness: 0.05, side: DS });
    const carbon = new T.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.45, metalness: 0.2, side: DS });
    const accent = new T.MeshStandardMaterial({ color: 0xf2a33a, roughness: 0.4, side: DS });
    const rubber = new T.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.9 });

    // 수면 가림막: 물 아래 부분(선체 바닥, 물에 잠긴 블레이드)은 안 보이게
    const mask = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshBasicMaterial({ colorWrite: false }));
    mask.rotation.x = -Math.PI / 2; mask.position.y = WATER_Y; mask.renderOrder = -5; boat.add(mask);

    const H = hullGeometry(T);
    const hull = new T.Mesh(H.geo, white); hull.position.y = WATER_Y + 0.085; boat.add(hull);
    const hy = hull.position.y;
    // 앞뒤 갑판 (콕핏 앞은 카본, 뒤는 흰색)
    const deckF = new T.Mesh(deckGeometry(T, H.beamAt, H.zBow + 0.02, -0.75, 0.018), white); deckF.position.y = hy; boat.add(deckF);
    const deckR = new T.Mesh(deckGeometry(T, H.beamAt, 0.85, H.zStern - 0.02, 0.018), white); deckR.position.y = hy; boat.add(deckR);
    // 물막이(스플래시 박스): 콕핏 앞 V자
    for (const s of [-1, 1]) {
      const w = new T.Mesh(new T.BoxGeometry(0.008, 0.045, 0.24), carbon);
      w.position.set(s * 0.06, hy + 0.035, -0.86); w.rotation.y = -s * 0.42; boat.add(w);
    }
    // 뱃머리 공 + 가는 줄무늬
    const ball = new T.Mesh(new T.SphereGeometry(0.022, 16, 12), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
    ball.position.set(0, hy + 0.012, H.zBow - 0.005); boat.add(ball);
    const spine = new T.Mesh(new T.BoxGeometry(0.03, 0.006, 3.6), carbon);
    spine.position.set(0, hy + 0.019, -2.6); boat.add(spine);
    for (const s of [-1, 1]) {   // 뱃전 가는 주황 줄
      const stripe = new T.Mesh(new T.BoxGeometry(0.004, 0.004, 3.4), accent);
      stripe.position.set(s * 0.05, hy + 0.012, -2.2); stripe.rotation.y = s * 0.018; boat.add(stripe);
    }
    // 콕핏 바닥과 발판
    const pit = new T.Mesh(new T.PlaneGeometry(0.24, 1.6), new T.MeshStandardMaterial({ color: 0x2f3438, roughness: 0.9 }));
    pit.rotation.x = -Math.PI / 2; pit.position.set(0, hy - 0.02, 0.05); boat.add(pit);
    const stretcher = new T.Mesh(new T.BoxGeometry(0.26, 0.16, 0.02), carbon);
    stretcher.position.set(0, hy + 0.04, -0.72); stretcher.rotation.x = -0.7; boat.add(stretcher);
    for (const s of [-1, 1]) {
      const shoe = new T.Mesh(new T.BoxGeometry(0.09, 0.07, 0.24), rubber);
      shoe.position.set(s * 0.06, hy + 0.07, -0.62); shoe.rotation.x = -0.7; boat.add(shoe);
    }
    // 스피드코치(발판 위 작은 계기판)
    const coachCv = document.createElement("canvas"); coachCv.width = 256; coachCv.height = 160;
    coachCtx = coachCv.getContext("2d"); coachTex = new T.CanvasTexture(coachCv);
    if (coachTex.encoding !== undefined) coachTex.encoding = T.sRGBEncoding;
    const coachBody = new T.Mesh(new T.BoxGeometry(0.15, 0.10, 0.03), carbon);
    coachBody.position.set(0, hy + 0.17, -0.80); coachBody.rotation.x = -0.55; boat.add(coachBody);
    const coachScreen = new T.Mesh(new T.PlaneGeometry(0.13, 0.08), new T.MeshBasicMaterial({ map: coachTex, toneMapped: false }));
    coachScreen.position.set(0, 0, 0.016); coachBody.add(coachScreen);

    // 날개형 리거 (선체 → 노받이)
    for (const s of [-1, 1]) {
      const curve = new T.CatmullRomCurve3([
        new T.Vector3(s * 0.14, hy + 0.03, 0.45),
        new T.Vector3(s * 0.45, PIN_Y - 0.05, 0.20),
        new T.Vector3(s * PIN_X, PIN_Y - 0.03, PIN_Z),
        new T.Vector3(s * 0.45, PIN_Y - 0.05, -0.30),
        new T.Vector3(s * 0.14, hy + 0.03, -0.55),
      ]);
      boat.add(new T.Mesh(new T.TubeGeometry(curve, 40, 0.016, 8, false), carbon));
      const pin = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.16, 8), new T.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.8, roughness: 0.3 }));
      pin.position.set(s * PIN_X, PIN_Y + 0.05, PIN_Z); boat.add(pin);
      const gate = new T.Mesh(new T.BoxGeometry(0.05, 0.07, 0.06), new T.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.6 }));
      gate.position.set(s * PIN_X, PIN_Y + 0.06, PIN_Z); boat.add(gate);
    }

    // 노: 노받이를 축으로 도는 그룹
    const bladeGeo = bladeGeometry(T);
    for (const s of [-1, 1]) {
      const pivot = new T.Group(); pivot.position.set(s * PIN_X, PIN_Y + 0.06, PIN_Z); boat.add(pivot);
      const pitch = new T.Group(); pivot.add(pitch);          // 블레이드 높이(위아래)
      const shaft = new T.Mesh(new T.CylinderGeometry(0.0145, 0.019, OUTBOARD - 0.40, 10), carbon);
      shaft.rotation.z = Math.PI / 2; shaft.position.x = s * ((OUTBOARD - 0.40) / 2 + 0.02); pitch.add(shaft);
      const collar = new T.Mesh(new T.CylinderGeometry(0.024, 0.024, 0.07, 10), white);
      collar.rotation.z = Math.PI / 2; collar.position.x = s * 0.06; pitch.add(collar);
      const inboard = new T.Mesh(new T.CylinderGeometry(0.016, 0.016, 0.30, 10), carbon);
      inboard.rotation.z = Math.PI / 2; inboard.position.x = -s * 0.15; pitch.add(inboard);
      const feather = new T.Group(); feather.position.x = s * (OUTBOARD - 0.42); pitch.add(feather);   // 블레이드 회전축
      const blade = new T.Mesh(bladeGeo, accent); blade.scale.x = s; feather.add(blade);
      const bladeTip = new T.Object3D(); bladeTip.position.x = s * 0.30; feather.add(bladeTip);
      oars.push({ s, pivot, pitch, feather, blade, bladeTip, sweep: 0, height: 0.2, fea: 1 });
    }
    // 손잡이(컨트롤러 위치에 표시)
    for (let i = 0; i < 2; i++) {
      const g = new T.Mesh(new T.CylinderGeometry(0.017, 0.017, 0.12, 10), rubber); g.visible = false;
      scene.add(g); grips.push(g);
    }

    // 뱃머리 물살(V자 흰 물결)
    const wc = document.createElement("canvas"); wc.width = 128; wc.height = 512;
    const w = wc.getContext("2d");
    for (let k = 0; k < 220; k++) {
      const y = Math.random() * 512, spread = 10 * (1 + y / 160), x = 64 + (Math.random() - 0.5) * spread;
      w.fillStyle = `rgba(255,255,255,${0.35 * (1 - y / 512)})`; w.fillRect(x, y, 2 + Math.random() * 3, 6 + Math.random() * 14);
    }
    const wtex = new T.CanvasTexture(wc);
    const wmat = new T.MeshBasicMaterial({ map: wtex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    wake = new T.Group(); boat.add(wake);
    for (const s of [-1, 1]) {
      const m = new T.Mesh(new T.PlaneGeometry(0.22, 3.6), wmat);
      m.rotation.x = -Math.PI / 2; m.rotation.z = s * 0.20; m.position.set(s * 0.33, WATER_Y + 0.01, H.zBow + 1.8); wake.add(m);
    }
    wake.userData.mat = wmat;
  }

  // ---------- 물 위 노 자국(퍼들), 물보라, 물방울 ----------
  let puddleTex = null, dropGeo = null, dropMat = null;
  function ensureFx() {
    const T = window.THREE;
    if (puddleTex) return;
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d");
    // 가운데: 소용돌이로 매끈해진 수면(조금 어둡고 반들반들)
    const rg = g.createRadialGradient(128, 128, 8, 128, 128, 110);
    rg.addColorStop(0, "rgba(10,20,25,0.45)"); rg.addColorStop(0.6, "rgba(15,28,33,0.30)"); rg.addColorStop(1, "rgba(15,28,33,0)");
    g.fillStyle = rg; g.beginPath(); g.arc(128, 128, 110, 0, Math.PI * 2); g.fill();
    // 테두리: 끊어진 흰 거품 고리 두 겹
    g.lineCap = "round";
    for (const [r, w, a] of [[98, 10, 0.95], [80, 6, 0.6], [62, 3, 0.35]]) {
      for (let k = 0; k < 18; k++) {
        const a0 = Math.random() * Math.PI * 2, len = 0.2 + Math.random() * 0.5;
        g.strokeStyle = `rgba(255,255,255,${a * (0.6 + Math.random() * 0.4)})`; g.lineWidth = w * (0.6 + Math.random() * 0.6);
        g.beginPath(); g.arc(128, 128, r + (Math.random() - 0.5) * 8, a0, a0 + len); g.stroke();
      }
    }
    // 소용돌이 줄무늬
    for (let k = 0; k < 5; k++) {
      g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 2;
      g.beginPath(); for (let t = 0; t < 1; t += 0.02) { const a = k * 1.25 + t * 4, r = 20 + t * 60; const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r; t ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    }
    puddleTex = new T.CanvasTexture(c);
    dropGeo = new T.SphereGeometry(0.008, 6, 4);
    dropMat = new T.MeshBasicMaterial({ color: 0xeef6ff, transparent: true, opacity: 0.85 });
  }
  function bladeWorld(o) { const v = new window.THREE.Vector3(); o.bladeTip.getWorldPosition(v); boat.worldToLocal(v); return v; }
  function addPuddle(o, strength) {
    const T = window.THREE; ensureFx();
    const p = bladeWorld(o);
    for (let k = 0; k < 2; k++) {
      const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: puddleTex, transparent: true, depthWrite: false, opacity: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x + (k ? o.s * 0.12 : 0), WATER_Y + 0.012, p.z + (k ? 0.1 : 0));
      const sc = (k ? 0.35 : 0.5) * (0.7 + 0.5 * strength);
      m.scale.set(sc, sc, sc);
      m.userData = { t: 0, life: 7 + Math.random() * 2, grow: 0.06 + Math.random() * 0.04, spin: (Math.random() - 0.5) * 0.4 };
      boat.add(m); puddles.push(m);
    }
  }
  function addSpray(o, strength, n) {
    const T = window.THREE; ensureFx();
    const p = bladeWorld(o);
    for (let k = 0; k < n; k++) {
      const m = new T.Mesh(dropGeo, dropMat.clone());
      m.position.set(p.x + (Math.random() - 0.5) * 0.2, WATER_Y + 0.01, p.z + (Math.random() - 0.5) * 0.15);
      m.userData = { v: new T.Vector3((Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 1.2 * strength, (Math.random() - 0.3) * 0.9), t: 0, life: 0.5 + Math.random() * 0.3 };
      boat.add(m); spray.push(m);
    }
  }
  function addDrip(o) {
    const T = window.THREE; ensureFx();
    const p = bladeWorld(o);
    const m = new T.Mesh(dropGeo, dropMat.clone());
    m.position.copy(p); m.position.x += (Math.random() - 0.5) * 0.15; m.scale.setScalar(0.6 + Math.random() * 0.6);
    m.userData = { v: new T.Vector3(0, -0.2, 0), t: 0, life: 1.2, drip: true };
    boat.add(m); drops.push(m);
  }
  function updateFx(dt) {
    const v = S.v;
    for (let i = puddles.length - 1; i >= 0; i--) {
      const m = puddles[i], u = m.userData; u.t += dt;
      m.position.z += v * dt;                                  // 배가 앞으로 가므로 자국은 뒤로 흘러감
      const s = m.scale.x + u.grow * dt; m.scale.set(s, s, s); m.rotation.z += u.spin * dt;
      m.material.opacity = Math.pow(1 - u.t / u.life, 1.4);
      if (u.t > u.life || m.position.z > 12) { boat.remove(m); m.geometry.dispose(); m.material.dispose(); puddles.splice(i, 1); }
    }
    for (const arr of [spray, drops]) for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i], u = m.userData; u.t += dt;
      u.v.y -= 9.8 * dt; m.position.addScaledVector(u.v, dt); m.position.z += v * dt * (u.drip ? 0 : 0.5);
      m.material.opacity = 0.85 * (1 - u.t / u.life);
      if (u.t > u.life || m.position.y < WATER_Y - 0.02) { boat.remove(m); m.material.dispose(); arr.splice(i, 1); }
    }
    if (wake) wake.userData.mat.opacity = 0.55 * smooth((S.vSmooth - 0.4) / 3);
  }

  // ---------- 노 동작 ----------
  // 단계: recovery(물 밖, 눕힘) → 캐치 직전 세우기 → drive(물속) → finish(빼기) → recovery
  let squared = false, dripTimer = 0, brakeFx = 0, foamFx = 0, brakeBuzz = 0;
  function updateOars(dt) {
    // 손 위치 p(0=팔 뻗음, 1=당김) → 노 각도. 손이 앞이면 블레이드도 앞 (앞을 보고 젓는 방식)
    const sweepDeg = (p) => { const d = clamp((0.5 - p) / 0.55, -1, 1); return Math.asin(d) * 180 / Math.PI * 0.78; };  // 약 +62° ~ -48°
    // 손떨림을 걸러낸 위치(pf)와 속도(vel)로 단계를 판정
    const k = 1 - Math.exp(-dt * 16);
    S.pfPrev = S.pf; S.pf = lerp(S.pf, S.p, k);
    const rawVel = (S.pf - S.pfPrev) / Math.max(dt, 1e-3);
    S.vel = lerp(S.vel, rawVel, 1 - Math.exp(-dt * 12));
    const target = sweepDeg(S.pf);
    S.phaseT += dt;
    if (S.phase === "drive") S.peakVel = Math.max(S.peakVel, S.vel);
    // 노 박기(브레이크): 트리거를 당기거나 손을 들어 올리면
    if (S.phase !== "brake" && S.brake > 0.35 && S.phase !== "drive") setPhase("brake");
    else if (S.phase === "brake" && S.brake < 0.15) setPhase("recovery");
    // 드라이브 시작: 리커버리 중(0.3초 이상)에만, 앞쪽 절반에서, 몸 쪽으로 분명히 당기기 시작할 때(2프레임 연속)
    if (S.phase === "recovery") {
      S.upFrames = (S.vel > 0.5 && S.pf < 0.55) ? S.upFrames + 1 : 0;
      if (S.upFrames >= 2 && S.phaseT > 0.3) setPhase("drive");
    } else if (S.phase === "drive") {
      if (S.phaseT > 0.25 && (S.pf > 0.92 || (S.vel < 0.15 && S.pf > 0.55))) setPhase("finish");
      else if (S.phaseT > 0.25 && S.vel < -0.4) setPhase("recovery");     // 끝까지 안 당기고 바로 돌아온 경우
    } else if (S.phase === "finish") {
      if (S.vel < -0.3 || S.phaseT > 1.5) setPhase("recovery");
    }

    const nearCatch = S.phase === "recovery" && S.pf < 0.2 && S.vel < 0.3;
    if (nearCatch && !squared) { squared = true; sndClunk(0.35); }      // 블레이드 세우는 '딸깍'
    if (S.phase === "drive") squared = false;

    for (const o of oars) {
      if (S.phase !== "brake") o.sweep = lerp(o.sweep, target, 1 - Math.exp(-dt * 18));
      let hTarget, fTarget;
      if (S.phase === "brake") {                                                  // 세운 채 물에 박음, 노는 옆으로 고정
        o.sweep = lerp(o.sweep, 8, 1 - Math.exp(-dt * 3));
        hTarget = -0.07; fTarget = 0;
      } else if (S.phase === "drive") { hTarget = -0.06; fTarget = 0; }          // 물속, 세움
      else if (S.phase === "finish") { hTarget = 0.10; fTarget = 0; }           // 빼는 중
      else { hTarget = nearCatch ? 0.07 : 0.17; fTarget = nearCatch ? 0 : 1; }  // 물 위, 눕힘 / 입수 직전 세움
      o.height = lerp(o.height, hTarget, 1 - Math.exp(-dt * (S.phase === "drive" ? 22 : 9)));
      o.fea = lerp(o.fea, fTarget, 1 - Math.exp(-dt * 14));
      o.pivot.rotation.y = o.s * o.sweep * Math.PI / 180;
      const bladeY = WATER_Y + o.height, dy = bladeY - (PIN_Y + 0.06);
      o.pitch.rotation.z = o.s * Math.atan2(dy, OUTBOARD - 0.2);
      o.feather.rotation.x = -o.s * o.fea * Math.PI / 2 * 0.95;
    }
    // 블레이드 앞에 일어나는 흰 물(브레이크 중, 속도에 비례)
    for (const o of oars) {
      if (!o.foam) {
        ensureFx();
        const T = window.THREE;
        o.foam = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: puddleTex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
        o.foam.rotation.x = -Math.PI / 2; boat.add(o.foam);
      }
      const want = S.phase === "brake" ? smooth(S.v / 2.5) * S.brake : 0;
      o.foam.material.opacity = lerp(o.foam.material.opacity, want, 1 - Math.exp(-dt * 8));
      if (o.foam.material.opacity > 0.01) {
        const bp = bladeWorld(o); o.foam.position.set(bp.x, WATER_Y + 0.014, bp.z - 0.08);
        const sc = 0.35 + 0.45 * smooth(S.v / 3.5); o.foam.scale.set(sc * 1.4, sc, 1); o.foam.rotation.z += dt * 1.5;
      }
    }
    // 브레이크 중: 블레이드에 물이 부딪혀 하얗게 일어남(속도에 비례)
    if (S.phase === "brake" && S.v > 0.3) {
      brakeFx -= dt;
      if (brakeFx <= 0) {
        brakeFx = 0.05;
        const n = Math.round(2 + 10 * smooth(S.v / 3.5) * S.brake);
        for (const o of oars) addSpray(o, 0.4 + 0.6 * smooth(S.v / 3.5), n);
        foamFx -= 1; if (foamFx <= 0) { foamFx = 3; for (const o of oars) addPuddle(o, 0.4 + 0.6 * smooth(S.v / 3.5)); }
      }
      brakeBuzz -= dt;
      if (brakeBuzz <= 0) { brakeBuzz = 0.12; haptic(0.15 + 0.6 * smooth(S.v / 3.5) * S.brake, 90); }
    }
    if (S.phase === "recovery" && S.phaseT < 0.9) {                       // 노를 든 직후 물방울
      dripTimer -= dt;
      if (dripTimer <= 0) { dripTimer = 0.07 + Math.random() * 0.1; for (const o of oars) if (Math.random() < 0.7) addDrip(o); }
    }
  }
  function setPhase(ph) {
    const prev = S.phase; S.phase = ph; S.phaseT = 0;
    if (ph === "drive") {
      S.strokeStart = performance.now(); S.peakVel = S.vel; S.catches = (S.catches || 0) + 1; S.catchLog = (S.catchLog || []).concat([+S.pf.toFixed(2)]);
      // 캐치 순간엔 아직 속도가 덜 붙어 있으므로 직전 스트로크 세기를 함께 반영
      const power = clamp(0.5 * S.lastPower + 0.5 * clamp(S.vel / 2.5, 0, 1), 0.15, 1);
      S.drivePower = power;
      sndCatch(power);
      for (const o of oars) addSpray(o, power, 6 + Math.round(10 * power));
      haptic(0.35 + 0.4 * power, 40);
    } else if (ph === "brake") {
      S.upFrames = 0;
      sndBrakeStart(S.v);
      for (const o of oars) addSpray(o, 0.5 + 0.5 * smooth(S.v / 3.5), 8 + Math.round(14 * smooth(S.v / 3.5)));
      haptic(0.4 + 0.5 * smooth(S.v / 3.5), 80);
    } else if (ph === "finish") {
      S.lastPower = clamp(S.peakVel / 2.6, 0.15, 1);
      for (const o of oars) addPuddle(o, S.lastPower);
    } else if (ph === "recovery" && prev === "brake") {
      sndClunk(0.25);                                                     // 노를 물에서 빼며 눕힘
    } else if (ph === "recovery" && prev !== "recovery") {
      if (prev === "drive") S.lastPower = clamp(S.peakVel / 2.6, 0.15, 1);
      sndClunk(0.28); sndDrip();                                          // 블레이드 눕히는 '딸깍' + 물방울
      for (const o of oars) addSpray(o, 0.3, 4);
    }
  }
  let padsNow = [];
  function haptic(v, ms) { for (const g of padsNow) { const h = g.hapticActuators && g.hapticActuators[0]; if (h && h.pulse) h.pulse(v, ms).catch(() => {}); } }

  // ---------- 선체 미세한 움직임 ----------
  let rollT = Math.random() * 10;
  function updateBoatMotion(dt) {
    rollT += dt;
    const sinceCatch = (performance.now() - S.strokeStart) / 1000;
    const check = Math.exp(-sinceCatch * 7) * 0.006;                 // 캐치 직후 뱃머리가 살짝 숙여짐
    const lift = S.phase === "drive" ? 0.003 * S.drivePower : (S.phase === "brake" ? -0.008 * smooth(S.v / 3) * S.brake : 0);
    boat.rotation.x = lerp(boat.rotation.x, -check + lift, 1 - Math.exp(-dt * 6));
    boat.rotation.z = 0.004 * Math.sin(rollT * 0.9) + 0.002 * Math.sin(rollT * 2.3);   // 균형 잡는 미세한 흔들림
    boat.position.y = 0.004 * Math.sin(rollT * 1.7) * smooth(S.vSmooth / 2);
  }

  // ---------- 스피드코치 화면 ----------
  let coachLast = 0;
  function drawCoach(now) {
    if (!coachCtx || now - coachLast < 250) return; coachLast = now;
    const c = coachCtx;
    c.fillStyle = "#c9d3c5"; c.fillRect(0, 0, 256, 160);
    c.fillStyle = "#1d2420";
    c.font = "600 56px ui-monospace,Consolas,monospace"; c.textAlign = "center";
    c.fillText(S.vSmooth > 0.3 ? fmtPace(500 / S.vSmooth) : "--:--", 128, 70);
    c.font = "600 34px ui-monospace,Consolas,monospace";
    c.textAlign = "left"; c.fillText(String(Math.round(S.spm)), 18, 135);
    c.textAlign = "right"; c.fillText(Math.floor(S.dist) + "m", 240, 135);
    c.font = "500 14px system-ui,sans-serif"; c.textAlign = "left"; c.fillText("SPM", 18, 100);
    c.textAlign = "right"; c.fillText("/500m", 240, 20);
    coachTex.needsUpdate = true;
  }

  // ---------- 영상 색에 맞춰 조명 ----------
  let lightLast = 0;
  const probe = document.createElement("canvas"); probe.width = 16; probe.height = 8;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  function updateLight(now) {
    if (now - lightLast < 2000) return; lightLast = now;
    const vid = video(); if (!vid || vid.readyState < 2) return;
    try {
      pctx.drawImage(vid, 0, 0, 16, 8);
      const d = pctx.getImageData(0, 0, 16, 8).data;
      const avg = (y0, y1) => { let r = 0, g = 0, b = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return [r / n / 255, g / n / 255, b / n / 255]; };
      const sky = avg(0, 3), wat = avg(5, 8);
      hemi.color.setRGB(0.5 + sky[0] * 0.6, 0.5 + sky[1] * 0.6, 0.5 + sky[2] * 0.6);
      hemi.groundColor.setRGB(wat[0] * 0.8, wat[1] * 0.8, wat[2] * 0.8);
      sun.intensity = 0.5 + 0.9 * (0.3 * sky[0] + 0.6 * sky[1] + 0.1 * sky[2]);
    } catch (e) {}
  }

  // ======================================================================
  // 영상 텍스처
  // ======================================================================
  function uploadVideo() {
    const vid = video();
    if (!vid || vid.readyState < 3 || !texOK) return;
    if (vid.currentTime === lastVideoTime) return;
    lastVideoTime = vid.currentTime;
    if (vtex.image !== vid) vtex.image = vid;
    vtex.needsUpdate = true;
  }

  // ======================================================================
  // VR 세션
  // ======================================================================
  let session = null, aPrev = false;
  async function startVR() {
    if (session) { session.end(); return; }
    if (!window.THREE) { setStatus("3D 엔진이 없습니다. youtube-rowing.bat으로 실행해 주세요."); return; }
    const vid = video();
    if (!vid) { setStatus("유튜브 영상을 찾지 못했습니다. 영상 페이지에서 실행해 주세요."); return; }
    initAudio(); if (actx && actx.state === "suspended") actx.resume();
    setQuality();
    try { session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "hand-tracking"] }); }
    catch (e) { setStatus("VR을 시작하지 못했습니다: " + e.message); session = null; return; }
    if (!renderer) initScene();
    camera.layers.disable(1);
    if (renderer.xr.setFoveation) renderer.xr.setFoveation(1);
    await renderer.xr.setSession(session);
    S.xr = true; S.yaw = null; texOK = true; lastVideoTime = -1;
    vrBtn.textContent = "VR 종료"; setStatus("VR 실행 중");
    vid.pause();
    applySound();
    session.addEventListener("end", () => {
      S.xr = false; session = null; vrBtn.textContent = "VR 시작";
      setStatus("VR 종료됨. 다시 'VR 시작'을 누르면 이어서 됩니다.");
      const v = video(); if (v) v.playbackRate = 1;
      applySound(); renderer.setAnimationLoop(null);
    });
    renderer.setAnimationLoop(onXRFrame);
  }
  vrBtn.onclick = startVR;

  function recenter(xrCam) {
    const T = window.THREE;
    const pos = new T.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
    const dir = new T.Vector3(0, 0, -1).applyQuaternion(new T.Quaternion().setFromRotationMatrix(xrCam.matrixWorld));
    S.yaw = Math.atan2(-dir.x, -dir.z);
    worldGroup.position.copy(pos); worldGroup.rotation.set(0, S.yaw, 0);
  }

  let headPos = null;
  function onXRFrame(t, frame) {
    if (!session || !frame) return;
    const T = window.THREE;
    const now = performance.now();
    const xrCam = renderer.xr.getCamera(camera);
    if (!headPos) headPos = new T.Vector3();
    headPos.setFromMatrixPosition(xrCam.matrixWorld);
    if (S.yaw === null && headPos.lengthSq() > 0) recenter(xrCam);
    // 배경 영상은 머리 위치를 따라감(무한히 먼 풍경), 방향은 정면 기준
    videoGroup.position.copy(headPos); videoGroup.rotation.set(0, S.yaw || 0, 0);

    readControllers(frame, now);
    step(now);
    const dt = Math.min(0.05, (now - (onXRFrame.last || now)) / 1000); onXRFrame.last = now;
    updateOars(dt); updateFx(dt); updateBoatMotion(dt); drawCoach(now); updateLight(now); updateLoops(); updateBrakeSound();
    uploadVideo();
    renderer.render(scene, camera);
  }

  // ---------- 동작 인식: 머리 + 컨트롤러 + 손을 함께 ----------
  // 각 신호를 따로 0(캐치)~1(피니시)로 맞춘 뒤, 지금 믿을 만한 정도에 따라 섞는다.
  function mkNorm(minRange) {
    return {
      max: null, min: null, oMax: null, oMin: null, minRange,
      upd(d, dt) {
        if (this.max === null) { this.max = d + minRange / 2; this.min = d - minRange / 2; this.oMax = d; this.oMin = d; }
        this.max = Math.max(d, this.max - 0.02 * dt); this.min = Math.min(d, this.min + 0.02 * dt);
        if (this.max - this.min < minRange) { const m = (this.max + this.min) / 2; this.max = m + minRange / 2; this.min = m - minRange / 2; }
        this.oMax = Math.max(d, this.oMax - 0.03 * dt); this.oMin = Math.min(d, this.oMin + 0.03 * dt);   // 실제로 움직인 폭
        return clamp((this.max - d) / (this.max - this.min), 0, 1);
      },
      range() { return this.oMax === null ? 0 : this.oMax - this.oMin; },
    };
  }
  const NORM = { ctrl: mkNorm(0.30), hand: mkNorm(0.30), head: mkNorm(0.15) };
  const W = { ctrl: 0, hand: 0, head: 0 }, lastP = {};
  S.srcText = "";
  function readControllers(frame, now) {
    const ref = renderer.xr.getReferenceSpace();
    const yaw = S.yaw || 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const ox = worldGroup.position.x, oz = worldGroup.position.z;      // 정면 맞춘 자리(시트 기준점)
    const along = (x, z) => (x - ox) * fx + (z - oz) * fz;              // 앞쪽으로 얼마나 나가 있나
    const dt = Math.min(0.05, (now - (readControllers.t || now)) / 1000); readControllers.t = now;
    let aNow = false, gi = 0, trig = 0;
    const acc = { ctrl: [0, 0, 0], hand: [0, 0, 0] };                    // [앞쪽 합, 높이 합, 개수]
    padsNow = [];
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (gp && !src.hand) {
        if (gp.buttons[1] && gp.buttons[1].pressed) S.yaw = null;
        if (src.handedness === "right" && gp.buttons[4] && gp.buttons[4].pressed) aNow = true;
        padsNow.push(gp);
        if (gp.buttons[0]) trig = Math.max(trig, gp.buttons[0].value || (gp.buttons[0].pressed ? 1 : 0));
      }
      let pos = null, kind = null;
      if (src.hand && frame.getJointPose) {                              // 손 인식: 손목 위치
        const wrist = src.hand.get ? src.hand.get("wrist") : null;
        const jp = wrist ? frame.getJointPose(wrist, ref) : null;
        if (jp) { pos = jp.transform.position; kind = "hand"; }
      } else if (src.gripSpace) {                                        // 컨트롤러
        const gpz = frame.getPose(src.gripSpace, ref);
        if (gpz && !gpz.emulatedPosition) { pos = gpz.transform.position; kind = "ctrl"; }
      }
      if (!pos) continue;
      const a = acc[kind]; a[0] += along(pos.x, pos.z); a[1] += pos.y; a[2]++;
      if (grips[gi]) { grips[gi].visible = true; grips[gi].position.set(pos.x, pos.y, pos.z); grips[gi].rotation.set(0, yaw, Math.PI / 2); gi++; }
    }
    for (; gi < grips.length; gi++) grips[gi].visible = false;
    if (aNow && !aPrev) { S.mode = S.mode === "smooth" ? "instant" : "smooth"; paintMode(); save(); }
    aPrev = aNow;
    S.trig = trig;
    if (S.yaw === null) { S.brake = trig; return; }

    // 각 신호를 0~1로
    const P = {}, target = { ctrl: 0, hand: 0, head: 0 };
    for (const k of ["ctrl", "hand"]) {
      const a = acc[k];
      if (a[2]) {
        P[k] = NORM[k].upd(a[0] / a[2], dt);
        target[k] = (k === "ctrl" ? 1.0 : 0.7) * Math.max(0.05, smooth((NORM[k].range() - 0.12) / 0.2));
      }
    }
    P.head = NORM.head.upd(along(headPos.x, headPos.z), dt);
    target.head = 0.6 * Math.max(0.05, smooth((NORM.head.range() - 0.08) / 0.15));
    // 믿을 만한 정도를 서서히 바꿔서 신호가 끊기거나 잡혀도 튀지 않게
    let sw = 0, sp = 0;
    for (const k of ["ctrl", "hand", "head"]) {
      W[k] = lerp(W[k], target[k], 1 - Math.exp(-dt * 3));
      if (P[k] !== undefined) lastP[k] = P[k];
      const v = P[k] !== undefined ? P[k] : lastP[k];          // 잠깐 끊긴 신호는 마지막 값을 붙잡은 채 비중만 줄임
      if (v !== undefined && W[k] > 0.005) { sw += W[k]; sp += W[k] * v; }
    }
    if (sw > 0.02) S.p = sp / sw;
    const names = { ctrl: "컨트롤러", hand: "손", head: "머리" };
    S.srcText = ["head", "ctrl", "hand"].filter(k => P[k] !== undefined && W[k] > 0.15).map(k => names[k]).join(" + ") || "움직임 기다리는 중";
    S.hands = acc.ctrl[2] + acc.hand[2];

    // 노 박기: 트리거, 또는 손(컨트롤러·손 인식)을 멈추고 6cm 이상 들어 올림
    const hn = acc.ctrl[2] + acc.hand[2];
    let raise = 0;
    if (hn) {
      const hy = (acc.ctrl[1] + acc.hand[1]) / hn;
      if (S.handBase === null) S.handBase = hy;
      if (S.phase !== "brake") S.handBase = lerp(S.handBase, hy, 1 - Math.exp(-dt * 0.4));
      S.handY = hy;
      raise = (S.vel > -0.4 && S.vel < 0.4) ? smooth((hy - S.handBase - 0.06) / 0.07) : 0;
    }
    S.brake = Math.max(trig, raise);
  }

  // ======================================================================
  // 물리 + 영상 배속
  // ======================================================================
  const K_DRIVE = 1.9, C_DRAG = 0.06, C_LIN = 0.05;
  function tick(now) {
    if (!S.on) return;
    requestAnimationFrame(tick);
    if (!S.xr) step(now);
  }
  function step(now) {
    const dt = Math.min(0.05, (now - S.last) / 1000); S.last = now;
    if (!S.xr && S.p > 0) S.p = Math.max(0, S.p - dt / 1.4);
    const hv = (S.p - S.pPrev) / Math.max(dt, 1e-3);
    S.hv = lerp(S.hv, hv, 1 - Math.exp(-dt * 25));
    let a = -C_DRAG * S.v * Math.abs(S.v) - C_LIN * S.v;
    if (S.phase === "brake") a -= S.brake * (1.0 * S.v + 0.10 * S.v * S.v);   // 노를 박으면 1~2초 안에 섬
    if (hv > 0.05 && S.phase !== "brake") a += K_DRIVE * S.power * Math.min(hv, 6) ** 2;
    S.v = Math.max(0, S.v + a * dt); S.dist += S.v * dt;
    if (S.p > 0.75) S.peak = true;
    if (S.peak && S.p < 0.15) { S.peak = false; S.strokes.push(now); if (S.strokes.length > 4) S.strokes.shift(); }
    S.pPrev = S.p;
    const st = S.strokes;
    S.spm = st.length >= 2 && now - st[st.length - 1] < 6000 ? 60000 * (st.length - 1) / (st[st.length - 1] - st[0]) : 0;
    const tauEff = S.phase === "brake" ? Math.min(S.tau, 0.35) : S.tau;      // 브레이크는 영상에도 바로 반영
    S.vSmooth += (S.v - S.vSmooth) * (1 - Math.exp(-dt / tauEff));
    S.rate = Math.min(2, (S.mode === "smooth" ? S.vSmooth : S.v) / S.vRef);

    const vid = video();
    if (vid && S.xr) {
      if (S.rate < 0.07) { if (!vid.paused) vid.pause(); }
      else {
        const r = Math.max(0.07, S.rate);
        if (Math.abs(vid.playbackRate - r) > 0.01) vid.playbackRate = r;
        if (vid.paused) vid.play().catch(() => {});
      }
    }
    if (now - (step.ui || 0) > 200) {
      step.ui = now;
      sPace.textContent = S.vSmooth > 0.3 ? fmtPace(500 / S.vSmooth) : "--:--";
      sSpm.textContent = Math.round(S.spm);
      sRate.textContent = S.rate.toFixed(2);
      if (S.xr && texOK) setStatus("VR 실행 중 · 인식: " + S.srcText);
    }
  }
  const fmtPace = s => { s = Math.min(s, 599); return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };

  const api = window.__rowVR = {
    toggle() {
      S.on = !S.on;
      panel.style.display = S.on ? "" : "none";
      if (!S.on) { if (session) session.end(); const v = video(); if (v) { v.playbackRate = 1; v.muted = false; } stopLoops(); }
      if (S.on) { S.last = performance.now(); requestAnimationFrame(tick); }
    },
    // PC 미리보기/테스트용: VR 없이 한 장면 그리기
    _preview(host, w, h) {
      if (!renderer) initScene();
      renderer.setSize(w || 960, h || 540); camera.aspect = (w || 960) / (h || 540); camera.updateProjectionMatrix();
      camera.position.set(0, 0, 0); camera.lookAt(0, -0.45, -2.2);
      (host || document.body).appendChild(renderer.domElement);
      return {
        renderer, scene, camera, S,
        brake(b) { S.brake = b; },
        fuse(mockSession, mockFrame, head, dt) {       // 테스트용: 가짜 VR 프레임으로 인식 + 노 단계 판정
          const saved = session; session = mockSession;
          if (!headPos) headPos = new window.THREE.Vector3();
          headPos.set(head[0], head[1], head[2]); if (S.yaw === null) S.yaw = 0;
          const now = (this._t = (this._t || 1000) + dt * 1000);
          readControllers(mockFrame, now); session = saved;
          updateOars(dt);
          return { p: S.p, src: S.srcText, W: { ...W }, phase: S.phase, catches: S.catches || 0 };
        },
        phys(dt) { const now = performance.now(); S.last = now - dt * 1000; step(now); },
        step(dt, p) { S.pPrev = S.p; S.p = p; S.hv = (S.p - S.pPrev) / dt; if (S.phase !== "brake") { S.v = Math.max(S.v, 3); S.vSmooth = 3; } updateOars(dt); updateFx(dt); updateBoatMotion(dt); drawCoach(performance.now() + 1000 * Math.random()); },
        render() { renderer.render(scene, camera); },
        counts() { return { puddles: puddles.length, spray: spray.length, drops: drops.length, phase: S.phase, puddleZ: puddles.map(m => +m.position.z.toFixed(2)), puddleOp: puddles.map(m => +m.material.opacity.toFixed(2)) }; },
      };
    },
  };
  requestAnimationFrame(tick);
})();
