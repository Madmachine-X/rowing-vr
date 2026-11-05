/* 유튜브 하이킹 VR — 걷는 만큼 360 영상이 흘러감
 * - 제자리 걸음: 걸음 빠르기(분당 걸음)로 속도를 정함
 * - 러닝머신: 설정한 러닝머신 속도로 가고, 걸음은 '걷는 중/멈춤' 판단에만 씀 (뛰기는 지원하지 않음)
 * - 안전: 러닝머신에서 뒤로 밀리거나 두 손이 손잡이를 놓으면 경고 + 진동
 * 필요: window.THREE (r128), window.StepDetector (step-detect.js). 영상은 내려받지 않는다. 개인 테스트용.
 */
(() => {
  "use strict";
  if (window.__rowVR && window.__rowVR.kind === "hike") { window.__rowVR.toggle(); return; }
  const T = window.THREE;

  // ---------- 상태 ----------
  const S = {
    on: true, walk: "inplace", tmKmh: 3.0, vRefKmh: 4.0, baseCad: 105, tau: 1.5, format: "360", quality: "hd1440", sound: "nature", surface: "gravel", stream: false, blend: true,
    kmh: 0, kmhSmooth: 0, rate: 0, dist: 0, xr: false, yaw: null, warn: "", warnT: 0,
  };
  try { Object.assign(S, JSON.parse(localStorage.getItem("rowvr.hike1") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("rowvr.hike1", JSON.stringify({ walk: S.walk, tmKmh: S.tmKmh, vRefKmh: S.vRefKmh, baseCad: S.baseCad, tau: S.tau, format: S.format, quality: S.quality, sound: S.sound, surface: S.surface, stream: S.stream, blend: S.blend })); } catch (e) {} };
  const video = () => document.querySelector("video.html5-main-video") || document.querySelector("video");
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  let det = new StepDetector();
  const vidKey = () => { try { return "y:" + (new URLSearchParams(location.search).get("v") || location.pathname); } catch (e) { return "y:"; } };
  const loadVYaw = () => { try { return +(localStorage.getItem("rowvr.vyaw." + vidKey()) || 0); } catch (e) { return 0; } };
  const saveVYaw = () => { try { localStorage.setItem("rowvr.vyaw." + vidKey(), String(S.vYaw)); } catch (e) {} };
  S.vYaw = loadVYaw();

  // ---------- 패널 ----------
  const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
  const panel = el("div", "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;max-height:calc(100vh - 32px);overflow-y:auto;background:#151c20;color:#e6ecee;border:1px solid #5cc98a;border-radius:12px;padding:14px;font:14px/1.5 system-ui,'Malgun Gothic',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)");
  panel.appendChild(el("div", "font-weight:700;font-size:15px;margin-bottom:4px;color:#5cc98a", "하이킹 VR"));
  const status = el("div", "color:#8d9ba1;font-size:13px;margin-bottom:10px", "");
  panel.appendChild(status);
  const stats = el("div", "display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;text-align:center");
  const stat = (k) => { const b = el("div", "background:#0f1518;border-radius:8px;padding:6px 2px"); const v = el("div", "font:700 18px ui-monospace,Consolas,monospace", "-"); b.append(v, el("div", "font-size:11px;color:#8d9ba1", k)); stats.appendChild(b); return v; };
  const sSteps = stat("걸음"), sKmh = stat("km/h"), sRate = stat("영상 배속");
  panel.appendChild(stats);
  const vrBtn = el("button", "width:100%;padding:14px;margin-bottom:12px;border-radius:10px;border:0;background:#5cc98a;color:#08140d;font-weight:700;font-size:16px;cursor:pointer", "VR 시작");
  panel.appendChild(vrBtn);   // 화면이 작아도 보이게 맨 위쪽에
  const btnCss = "flex:1;padding:8px 4px;border-radius:8px;border:1px solid rgba(160,180,190,.25);background:#0f1518;color:#e6ecee;cursor:pointer;font:inherit;font-size:13px";
  function segRow(label, opts, get, set, parent) {
    const wrap = el("div", "margin-bottom:10px"); wrap.appendChild(el("div", "font-size:12px;color:#8d9ba1;margin-bottom:4px", label));
    const row = el("div", "display:flex;gap:6px"); const bs = [];
    for (const [k, t] of opts) { const b = el("button", btnCss, t); b.onclick = () => { set(k); save(); paint(); }; bs.push([k, b]); row.appendChild(b); }
    const paint = () => bs.forEach(([k, b]) => { const on = String(get()) === String(k); b.style.borderColor = on ? "#5cc98a" : "rgba(160,180,190,.25)"; b.style.background = on ? "rgba(92,201,138,.12)" : "#0f1518"; });
    paint(); wrap.appendChild(row); (parent || panel).appendChild(wrap); return paint;
  }
  function stepper(label, get, set, step, lo, hi, fmt, parent) {
    const wrap = el("div", "margin-bottom:10px"); wrap.appendChild(el("div", "font-size:12px;color:#8d9ba1;margin-bottom:4px", label));
    const row = el("div", "display:flex;gap:6px;align-items:center");
    const out = el("div", "flex:1.4;text-align:center;font:700 16px ui-monospace,Consolas,monospace");
    const dn = el("button", btnCss, "−"), up = el("button", btnCss, "+");
    const paint = () => out.textContent = fmt(get());
    dn.onclick = () => { set(clamp(+(get() - step).toFixed(2), lo, hi)); save(); paint(); };
    up.onclick = () => { set(clamp(+(get() + step).toFixed(2), lo, hi)); save(); paint(); };
    row.append(dn, out, up); wrap.appendChild(row); (parent || panel).appendChild(wrap); paint(); return wrap;
  }
  let tmBox, cadBox, paintYaw = () => {};
  segRow("걷는 방식", [["inplace", "제자리 걸음"], ["treadmill", "러닝머신"]], () => S.walk, k => { S.walk = k; showWalk(); });
  tmBox = stepper("러닝머신 속도 (걷기 전용, 최대 6)", () => S.tmKmh, v => S.tmKmh = v, 0.5, 0.5, 6, v => v.toFixed(1) + " km/h");
  cadBox = stepper("평소 걸음 빠르기 (이 빠르기면 4 km/h쯤)", () => S.baseCad, v => S.baseCad = v, 5, 70, 140, v => v + " 걸음/분");
  const showWalk = () => { tmBox.style.display = S.walk === "treadmill" ? "" : "none"; cadBox.style.display = S.walk === "inplace" ? "" : "none"; };
  showWalk();
  segRow("소리", [["nature", "자연 소리 + 발소리"], ["video", "영상 원래 소리"]], () => S.sound, k => { S.sound = k; applySound(); });
  const setBtn = el("button", "width:100%;padding:8px;margin-bottom:10px;border-radius:8px;border:1px solid rgba(160,180,190,.25);background:transparent;color:#8d9ba1;cursor:pointer;font:inherit;font-size:13px", "설정 더 보기 ▾");
  const settings = el("div", "display:none");
  setBtn.onclick = () => { const o = settings.style.display === "none"; settings.style.display = o ? "" : "none"; setBtn.textContent = o ? "설정 접기 ▴" : "설정 더 보기 ▾"; };
  const paintFormat = segRow("영상 형식", [["360", "360"], ["360tb", "360 입체"], ["180", "180 입체"]], () => S.format, k => { S.format = k; if (scene) buildVideoMeshes(); }, settings);
  segRow("발소리", [["gravel", "자갈길"], ["dirt", "흙길"], ["leaf", "낙엽"], ["off", "끄기"]], () => S.surface, k => { S.surface = k; }, settings);
  segRow("계곡물 소리", [["true", "켜기"], ["false", "끄기"]], () => S.stream, k => { S.stream = k === "true"; updateAmbGains(); }, settings);
  segRow("장면 부드럽게 (느리게 걸을 때 끊김 줄임)", [["true", "켜기"], ["false", "끄기"]], () => S.blend, k => { S.blend = k === "true"; }, settings);
  (() => {   // 영상 방향: 영상 속 진행 방향을 정면으로
    const wrap = el("div", "margin-bottom:10px"); wrap.appendChild(el("div", "font-size:12px;color:#8d9ba1;margin-bottom:4px", "영상 방향 (영상 속 길 방향을 정면으로) · VR 안에서는 B/Y 버튼·스틱"));
    const row = el("div", "display:flex;gap:6px;align-items:center"); const out = el("div", "flex:1.2;text-align:center;font:700 15px ui-monospace,Consolas,monospace");
    paintYaw = () => { let d = Math.round(S.vYaw * 180 / Math.PI) % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; out.textContent = (d > 0 ? "+" : "") + d + "°"; };
    const b = (t, f) => { const x = el("button", btnCss, t); x.onclick = () => { f(); paintYaw(); saveVYaw(); }; return x; };
    row.append(b("◀ 15°", () => S.vYaw += Math.PI / 12), out, b("15° ▶", () => S.vYaw -= Math.PI / 12), b("0°", () => S.vYaw = 0));
    wrap.appendChild(row); settings.appendChild(wrap); paintYaw();
  })();
  segRow("화질", [["hd1440", "1440p (부드럽게)"], ["hd2160", "4K (선명하게)"]], () => S.quality, k => { S.quality = k; setQuality(); }, settings);
  stepper("촬영 당시 걷던 속도", () => S.vRefKmh, v => S.vRefKmh = v, 0.5, 2, 7, v => v.toFixed(1) + " km/h", settings);
  stepper("부드러움 (속도가 바뀌는 데 걸리는 시간)", () => S.tau, v => S.tau = v, 0.5, 0.5, 5, v => v.toFixed(1) + "초", settings);
  const toRow = el("button", "width:100%;padding:8px;margin-bottom:10px;border-radius:8px;border:1px solid rgba(160,180,190,.25);background:transparent;color:#f2a33a;cursor:pointer;font:inherit;font-size:13px", "로잉 모드로 바꾸기");
  settings.appendChild(toRow);
  panel.append(setBtn, settings);
  (document.body || document.documentElement).appendChild(panel);
  const setStatus = t => { status.textContent = t; };
  setStatus(!navigator.xr ? "이 브라우저는 VR을 지원하지 않습니다. Quest에서 열어 주세요." : "영상이 재생되는지 확인한 뒤 'VR 시작'을 누르세요.");

  function setQuality() {
    const mp = document.getElementById("movie_player");
    try { if (mp && mp.setPlaybackQualityRange) mp.setPlaybackQualityRange(S.quality, S.quality); } catch (e) {}
    try { if (mp && mp.setPlaybackQuality) mp.setPlaybackQuality(S.quality); } catch (e) {}
  }
  setQuality();

  // ---------- 소리: 자연 배경음(계속 흐름) + 걸음마다 발소리 ----------
  // 녹음 출처: 발소리 Kenney Impact Sounds (CC0), 자연음은 hike-sounds 파일의 출처 표기 참고
  let actx = null, master = null, SB = null, ambs = null, soundsLoading = false, lastPick = {}, stepSide = 1;
  function initAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    actx = new AC(); master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
    loadSounds();
  }
  async function loadSounds() {
    if (SB || soundsLoading || !actx) return; soundsLoading = true;
    try {
      const src = window.__hikeSounds; if (!src) return;
      const dec = async (u) => actx.decodeAudioData(await (await fetch(u)).arrayBuffer());
      const out = { gravel: [], dirt: [], leaf: [], amb: [] };
      for (const k of ["gravel", "dirt", "leaf"]) for (const u of (src[k] || [])) { try { out[k].push(await dec(u)); } catch (e) {} }
      for (const a of (src.amb || [])) { try { out.amb.push({ name: a.name, buf: await dec(a.data), gain: a.gain || 0 }); } catch (e) {} }
      SB = out; applySound();
    } finally { soundsLoading = false; }
  }
  const hasAmb = () => SB && SB.amb.length > 0;
  const ambGain = a => a.name === "stream" ? (S.stream ? 0.45 : 0) : a.gain;
  function updateAmbGains() { if (!ambs || !actx) return; ambs.forEach((x, i) => x.g.gain.setTargetAtTime(ambGain(SB.amb[i]), actx.currentTime, 0.8)); }
  function startAmb() {
    if (ambs || !hasAmb()) return;
    ambs = SB.amb.map((a, i) => {
      const src = actx.createBufferSource(); src.buffer = a.buf; src.loop = true;
      const g = actx.createGain(); g.gain.value = 0; src.connect(g); g.connect(master);
      src.start(0, Math.random() * Math.max(0, a.buf.duration - 1));
      g.gain.setTargetAtTime(ambGain(a), actx.currentTime, 1.2);     // 천천히 들어옴
      return { src, g };
    });
  }
  function stopAmb() { if (!ambs) return; for (const a of ambs) { try { a.g.gain.setTargetAtTime(0, actx.currentTime, 0.3); a.src.stop(actx.currentTime + 1.5); } catch (e) {} } ambs = null; }
  function applySound() {
    const vid = video();
    const nature = S.sound === "nature" && S.xr;
    if (nature && hasAmb()) { startAmb(); if (vid) vid.muted = true; }
    else { stopAmb(); if (vid && S.xr) vid.muted = false; }
    if (!S.xr && vid) vid.muted = false;
  }
  function playStep(amp) {
    if (!actx || !SB || S.sound !== "nature" || S.surface === "off") return;
    const pool = SB[S.surface]; if (!pool || !pool.length) return;
    let i = Math.floor(Math.random() * pool.length); if (pool.length > 1 && i === lastPick[S.surface]) i = (i + 1) % pool.length; lastPick[S.surface] = i;
    const src = actx.createBufferSource(); src.buffer = pool[i]; src.playbackRate.value = 0.93 + Math.random() * 0.14;
    const g = actx.createGain(); const base = { gravel: 0.8, dirt: 1.0, leaf: 0.6 }[S.surface] || 0.8;
    g.gain.value = base * clamp(0.55 + amp / 0.04, 0.55, 1.0) * (0.85 + Math.random() * 0.3);
    stepSide = -stepSide;
    let node = g;
    if (actx.createStereoPanner) { const pn = actx.createStereoPanner(); pn.pan.value = 0.18 * stepSide; g.connect(pn); node = pn; }
    src.connect(g); node.connect(master); src.start();
  }

  // ---------- 3D: 영상 구 + 발밑 안내판 ----------
  let renderer, scene, camera, videoGroup, vtex, vtex2, blendU, hud, hudCtx, hudTex, texOK = false, lastVideoTime = -1;
  // 장면 섞기: 새 장면이 오면 두 텍스처 중 오래된 쪽에 올리고, 다음 장면이 올 때까지 이전→지금으로 서서히 넘어감
  const FB = { cur: 0, frames: 0, lastWall: 0, interval: 1 / 30, fresh: false, vid: null, rvfc: false };
  // 영상이 '실제로 새 장면을 보여 줄 때'를 알려 주는 기능(requestVideoFrameCallback) 사용. 없으면 재생 시간으로 추정
  function watchFrames(vid) {
    if (FB.vid === vid) return; FB.vid = vid;
    if (!vid.requestVideoFrameCallback) return;
    FB.rvfc = true;
    const on = () => { FB.fresh = true; if (FB.vid === vid) vid.requestVideoFrameCallback(on); };
    vid.requestVideoFrameCallback(on);
  }
  function initScene() {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(1); renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType("local-floor");
    if (renderer.outputEncoding !== undefined) renderer.outputEncoding = T.sRGBEncoding;
    scene = new T.Scene(); camera = new T.PerspectiveCamera(80, 1, 0.03, 500);
    videoGroup = new T.Group(); scene.add(videoGroup);
    const mkTex = () => { const x = new T.Texture(); x.minFilter = T.LinearFilter; x.magFilter = T.LinearFilter; x.generateMipmaps = false; return x; };
    vtex = mkTex(); vtex2 = mkTex();
    blendU = { tA: { value: vtex }, tB: { value: vtex2 }, k: { value: 1 }, useB: { value: 0 } };
    buildVideoMeshes();
    const c = document.createElement("canvas"); c.width = 768; c.height = 256; hudCtx = c.getContext("2d");
    hudTex = new T.CanvasTexture(c); hudTex.minFilter = T.LinearFilter;
    hud = new T.Mesh(new T.PlaneGeometry(0.6, 0.2), new T.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, toneMapped: false }));
    hud.renderOrder = 10; scene.add(hud);
  }
  function editUV(geo, fu, fv) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) { if (fu) uv.setX(i, fu(uv.getX(i))); if (fv) uv.setY(i, fv(uv.getY(i))); } uv.needsUpdate = true; return geo; }
  function buildVideoMeshes() {
    while (videoGroup.children.length) { const m = videoGroup.children.pop(); m.geometry.dispose(); m.material.dispose(); }
    const mat = () => new T.ShaderMaterial({
      uniforms: blendU, depthWrite: false, toneMapped: false,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      // useB=0: A가 지금 장면, B가 직전 장면 / useB=1: 반대. k: 0=직전, 1=지금
      fragmentShader: "uniform sampler2D tA; uniform sampler2D tB; uniform float k; uniform float useB; varying vec2 vUv; void main(){ vec4 a = texture2D(tA, vUv); vec4 b = texture2D(tB, vUv); vec4 cur = mix(a, b, useB); vec4 prev = mix(b, a, useB); gl_FragColor = vec4(mix(prev.rgb, cur.rgb, k), 1.0); }",
    }), R = 200;
    if (S.format === "360") { const g = new T.SphereGeometry(R, 96, 64); g.scale(-1, 1, 1); const m = new T.Mesh(g, mat()); m.rotation.y = -Math.PI / 2; videoGroup.add(m); }
    else if (S.format === "360tb") {
      for (const eye of [1, 2]) { const g = new T.SphereGeometry(R, 96, 64); g.scale(-1, 1, 1); editUV(g, null, v => eye === 1 ? 0.5 + v * 0.5 : v * 0.5); const m = new T.Mesh(g, mat()); m.rotation.y = -Math.PI / 2; m.layers.set(eye); videoGroup.add(m); }
    } else {
      for (const eye of [1, 2]) { const g = new T.SphereGeometry(R, 64, 64, Math.PI, Math.PI); g.scale(-1, 1, 1); editUV(g, u => u * 0.5 + (eye === 2 ? 0.5 : 0), null); const m = new T.Mesh(g, mat()); m.layers.set(eye); videoGroup.add(m); }
    }
  }
  function uploadVideo() {
    const vid = video(); if (!vid || vid.readyState < 3 || !texOK) return;
    const now = performance.now() / 1000;
    watchFrames(vid);
    let isNew;
    if (FB.rvfc) { isNew = FB.fresh; FB.fresh = false; if (FB.frames === 0) isNew = true; }
    else { const fi = Math.floor(vid.currentTime * 30); isNew = fi !== lastVideoTime; lastVideoTime = fi; }   // 30장/초로 가정
    if (isNew) {
      // 새 장면: 오래된 쪽 텍스처에 올리고 그쪽을 '지금'으로
      FB.cur = 1 - FB.cur;
      const t = FB.cur === 0 ? vtex : vtex2;
      if (t.image !== vid) t.image = vid; t.needsUpdate = true;
      if (FB.frames < 2) { const o = FB.cur === 0 ? vtex2 : vtex; if (o.image !== vid) { o.image = vid; o.needsUpdate = true; } }
      const gap = now - FB.lastWall; FB.lastWall = now; FB.frames++;
      if (gap > 0.005 && gap < 1.5) FB.interval += (gap - FB.interval) * 0.15;   // 장면이 바뀌는 평균 간격
      blendU.useB.value = FB.cur;
    }
    // 섞는 비율: 장면 간격의 대부분 동안 서서히 넘어감 (빠른 재생에선 거의 바로 바뀜)
    const span = Math.max(0.001, FB.interval * 0.9);
    blendU.k.value = S.blend ? Math.min(1, (now - FB.lastWall) / span) : 1;
  }
  function drawHud() {
    const g = hudCtx, W = 768, H = 256, warn = S.warn;
    g.clearRect(0, 0, W, H);
    g.fillStyle = warn ? "rgba(150,30,20,0.88)" : "rgba(13,17,20,0.72)";
    g.beginPath(); g.moveTo(32, 0); g.arcTo(W, 0, W, H, 32); g.arcTo(W, H, 0, H, 32); g.arcTo(0, H, 0, 0, 32); g.arcTo(0, 0, W, 0, 32); g.fill();
    g.textBaseline = "middle"; g.fillStyle = "#fff";
    if (warn) { g.font = "700 54px sans-serif"; g.textAlign = "center"; g.fillText(warn, W / 2, H / 2); g.textAlign = "left"; return; }
    g.font = "700 78px sans-serif"; g.fillText(S.kmhSmooth.toFixed(1), 40, 112);
    g.font = "500 34px sans-serif"; g.fillStyle = "#8d9ba1"; g.fillText("km/h", 40 + g.measureText("00.0").width * 2.25, 120);
    g.font = "500 34px sans-serif"; g.fillStyle = "#e6ecee";
    g.fillText(`${det.count} 걸음 · ${(S.dist / 1000).toFixed(2)} km`, 400, 90);
    g.fillStyle = "#8d9ba1"; g.font = "500 30px sans-serif";
    const walking = det.walking(S.t || 0);
    g.fillText(walking ? (S.walk === "treadmill" ? "러닝머신 " + S.tmKmh.toFixed(1) + " km/h" : Math.round(det.cadence) + " 걸음/분") : (det.cand.length ? "걸음 확인 중…" : "걸으면 출발해요"), 400, 140);
    g.fillText("그립: 정면 다시 맞추기", 40, 208);
  }

  // ---------- 걸음 → 속도 → 영상 ----------
  const handH = [[], []];
  function handMoving(i, t) {   // 최근 1초 동안 손이 5cm 넘게 움직였나 (null = 손 인식 안 됨)
    const h = handH[i]; while (h.length && t - h[0][0] > 1) h.shift();
    if (h.length < 10 || t - h[h.length - 1][0] > 0.5) return null;
    let r = 0; for (let k = 1; k < 4; k++) { let lo = Infinity, hi = -Infinity; for (const q of h) { lo = Math.min(lo, q[k]); hi = Math.max(hi, q[k]); } r = Math.max(r, hi - lo); }
    return r > 0.05;
  }
  let start = null, handsOffT = null, warnBuzz = 0, lastWalkT = -10, rateT = 0;
  function update(t, dt, head, hands) {
    S.t = t;
    const ev = det.push(t, head.y);
    if (ev && S.xr) playStep(ev.amp);
    hands.forEach((p, i) => { if (p) handH[i].push([t, p.x, p.y, p.z]); });
    if (det.walking(t)) lastWalkT = t;
    const walking = t - lastWalkT < 0.8 || det.walking(t);              // 0.8초 여유
    S.kmh = !walking ? 0 : S.walk === "treadmill" ? S.tmKmh : cadenceToKmh(det.cadence, S.baseCad) * (4.0 / 3.8);
    const tau = S.kmh < S.kmhSmooth ? Math.min(S.tau, 1.0) : S.tau;          // 멈출 때는 더 빨리 섬
    S.kmhSmooth += (S.kmh - S.kmhSmooth) * (1 - Math.exp(-dt / tau));
    if (S.kmhSmooth < 0.05 && S.kmh === 0) S.kmhSmooth = 0;
    S.dist += S.kmhSmooth / 3.6 * dt;
    S.rate = Math.min(2, S.kmhSmooth / S.vRefKmh);
    // 안전 경고
    let warn = "";
    if (start) {
      const dx = head.x - start.x, dz = head.z - start.z, fwd = -(dx * Math.sin(S.yaw) + dz * Math.cos(S.yaw));
      if (S.walk === "treadmill") {
        if (fwd < -0.35) warn = "뒤로 밀렸어요 · 앞으로 오세요";
        const m = [handMoving(0, t), handMoving(1, t)].filter(x => x !== null);
        if (walking && m.length === 2 && m.every(Boolean)) { handsOffT = handsOffT || t; if (t - handsOffT > 2) warn = warn || "손잡이를 잡아 주세요"; } else handsOffT = null;
      } else if (Math.hypot(dx, dz) > 0.6) warn = "제자리에서 벗어났어요";
    }
    S.warn = warn;
    if (warn && t - warnBuzz > 1) { warnBuzz = t; haptic(0.6, 120); }
  }
  function applyVideo() {
    const vid = video(); if (!vid || !S.xr) return;
    if (S.rate < 0.07) { if (!vid.paused) vid.pause(); }
    else {
      const r = Math.max(0.1, Math.round(S.rate * 20) / 20);           // 0.05 단위로
      const now = performance.now() / 1000, diff = Math.abs(vid.playbackRate - r);
      if (diff >= 0.15 || (diff >= 0.05 && now - rateT > 0.7)) { vid.playbackRate = r; rateT = now; }
      if (vid.paused) vid.play().catch(() => {});
    }
  }
  let pads = [];
  function haptic(v, ms) { for (const g of pads) { const h = g.hapticActuators && g.hapticActuators[0]; if (h && h.pulse) h.pulse(v, ms).catch(() => {}); } }

  // ---------- VR 세션 ----------
  let session = null, headPos = null, lastT = 0, hudT = 0, bPrev = false, yawDirty = 0;
  async function startVR() {
    if (session) { session.end(); return; }
    const vid = video(); if (!vid) { setStatus("유튜브 영상을 찾지 못했습니다. 영상 페이지에서 실행해 주세요."); return; }
    setQuality();
    try { session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "hand-tracking"] }); }
    catch (e) { setStatus("VR을 시작하지 못했습니다: " + e.message); session = null; return; }
    if (!renderer) initScene();
    camera.layers.disable(1);
    if (renderer.xr.setFoveation) renderer.xr.setFoveation(1);
    await renderer.xr.setSession(session);
    S.xr = true; S.yaw = null; start = null; texOK = true; lastVideoTime = -1; det = new StepDetector(); S.kmhSmooth = 0;
    vrBtn.textContent = "VR 종료"; setStatus("VR 실행 중 · 걸으면 출발해요");
    vid.pause();
    initAudio(); if (actx && actx.state === "suspended") actx.resume();
    applySound();
    session.addEventListener("squeeze", () => { S.yaw = null; });
    session.addEventListener("end", () => {
      S.xr = false; session = null; vrBtn.textContent = "VR 시작"; setStatus("VR 종료됨. 다시 'VR 시작'을 누르면 이어서 됩니다.");
      const v = video(); if (v) v.playbackRate = 1; renderer.setAnimationLoop(null); applySound();
    });
    renderer.setAnimationLoop(onXRFrame);
  }
  vrBtn.onclick = startVR;
  function onXRFrame(time, frame) {
    if (!session || !frame) return;
    const t = time / 1000, dt = Math.min(0.05, Math.max(0.001, t - (lastT || t))); lastT = t;
    const xrCam = renderer.xr.getCamera(camera);
    if (!headPos) headPos = new T.Vector3();
    headPos.setFromMatrixPosition(xrCam.matrixWorld);
    if (S.yaw === null && headPos.lengthSq() > 0) {        // 지금 보는 방향 = 정면, 지금 선 자리 = 기준
      const dir = new T.Vector3(0, 0, -1).applyQuaternion(new T.Quaternion().setFromRotationMatrix(xrCam.matrixWorld));
      S.yaw = Math.atan2(-dir.x, -dir.z); start = { x: headPos.x, z: headPos.z };
    }
    videoGroup.position.copy(headPos); videoGroup.rotation.set(0, (S.yaw || 0) + S.vYaw, 0);
    // 손: 손 인식이면 손목, 아니면 컨트롤러
    const ref = renderer.xr.getReferenceSpace(), hands = [null, null]; pads = [];
    let bNow = false, stickX = 0;
    for (const src of session.inputSources) {
      if (src.gamepad) {
        pads.push(src.gamepad); const gp = src.gamepad;
        if (!src.hand && gp.buttons[5] && gp.buttons[5].pressed) bNow = true;
        if (gp.axes && gp.axes.length >= 4 && Math.abs(gp.axes[2]) > Math.abs(stickX)) stickX = gp.axes[2];
      }
      const i = src.handedness === "left" ? 0 : src.handedness === "right" ? 1 : -1; if (i < 0) continue;
      let p = null;
      try {
        if (src.hand && frame.getJointPose) { const w = src.hand.get("wrist"), jp = w && frame.getJointPose(w, ref); if (jp) p = jp.transform.position; }
        else if (src.gripSpace) { const gp = frame.getPose(src.gripSpace, ref); if (gp) p = gp.transform.position; }
      } catch (e) {}
      if (p) hands[i] = { x: p.x, y: p.y, z: p.z };
    }
    // 스틱 좌우 = 영상 돌리기, B/Y = 지금 보는 쪽을 정면(길 방향)으로
    if (Math.abs(stickX) > 0.35) { S.vYaw -= stickX * dt * 1.0; yawDirty = t; } else if (yawDirty && t - yawDirty > 0.5) { yawDirty = 0; saveVYaw(); paintYaw(); }
    if (bNow && !bPrev && S.yaw !== null) {
      const dir = new T.Vector3(0, 0, -1).applyQuaternion(new T.Quaternion().setFromRotationMatrix(xrCam.matrixWorld));
      S.vYaw += S.yaw - Math.atan2(-dir.x, -dir.z); S.vYaw = Math.atan2(Math.sin(S.vYaw), Math.cos(S.vYaw)); saveVYaw(); paintYaw(); haptic(0.5, 80);
    }
    bPrev = bNow;
    update(t, dt, { x: headPos.x, y: headPos.y, z: headPos.z }, hands);
    applyVideo();
    // 안내판: 정면 아래쪽(내려다보면 보임), 머리를 천천히 따라감
    const y = S.yaw || 0, tx = headPos.x - Math.sin(y) * 0.9, tz = headPos.z - Math.cos(y) * 0.9, ty = headPos.y - 0.62;
    if (!hud.userData.init) { hud.position.set(tx, ty, tz); hud.userData.init = true; }
    hud.position.x += (tx - hud.position.x) * 0.1; hud.position.y += (ty - hud.position.y) * 0.1; hud.position.z += (tz - hud.position.z) * 0.1;
    hud.rotation.set(-0.6, y, 0, "YXZ");
    if (t - hudT > 0.1) { hudT = t; drawHud(); hudTex.needsUpdate = true; }
    uploadVideo();
    renderer.render(scene, camera);
  }

  // ---------- 패널 숫자 ----------
  let uiT = 0;
  function ui(now) {
    if (!S.on) return; requestAnimationFrame(ui);
    if (now - uiT < 200) return; uiT = now;
    sSteps.textContent = det.count; sKmh.textContent = S.kmhSmooth.toFixed(1); sRate.textContent = S.rate.toFixed(2);
    if (S.xr) setStatus(S.warn ? "⚠ " + S.warn : det.walking(S.t || 0) ? "걷는 중" : "VR 실행 중 · 걸으면 출발해요");
  }
  requestAnimationFrame(ui);

  // ---------- 로잉 모드로 ----------
  toRow.onclick = async () => {
    api.toggle(); panel.remove(); window.__rowVR = null; window.__rowvrForce = "row";
    try { await window.__rowvrRun("yt-row.js"); } catch (e) { alert("로잉 모드를 불러오지 못했습니다: " + e.message); }
  };

  const api = window.__rowVR = {
    kind: "hike",
    setFormat(f) { S.format = f; save(); if (scene) buildVideoMeshes(); paintFormat(); },
    getState() { return S; },
    toggle() {
      S.on = !S.on; panel.style.display = S.on ? "" : "none";
      if (!S.on) { if (session) session.end(); const v = video(); if (v) { v.playbackRate = 1; v.muted = false; } stopAmb(); }
      else requestAnimationFrame(ui);
    },
    _sim(t, dt, head, hands, yaw) { S.xr = true; if (S.yaw === null) { S.yaw = yaw || 0; start = { x: head.x, z: head.z }; } update(t, dt, head, hands || [null, null]); applyVideo(); return { kmh: S.kmh, kmhSmooth: S.kmhSmooth, rate: S.rate, warn: S.warn, steps: det.count }; },
    _hud() { if (!renderer) initScene(); drawHud(); return hudCtx.canvas.toDataURL(); },
    _audio() { initAudio(); return { actx: !!actx, loaded: SB ? { gravel: SB.gravel.length, dirt: SB.dirt.length, leaf: SB.leaf.length, amb: SB.amb.length } : null }; },
    _step(amp) { playStep(amp || 0.02); },
    _render(w, h) {   // 테스트용: VR 없이 한 장면 그리기
      if (!renderer) initScene(); texOK = true;
      if (!renderer.domElement.parentNode) { renderer.setSize(w || 320, h || 180); document.body.appendChild(renderer.domElement); }
      uploadVideo(); renderer.render(scene, camera);
      const g = renderer.getContext(), px = new Uint8Array(4); g.readPixels((w || 320) >> 1, (h || 180) >> 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
      return { k: +blendU.k.value.toFixed(2), px: px[0], interval: +FB.interval.toFixed(3) };
    },
    _reset() { lastWalkT = -10; det = new StepDetector(); S.kmhSmooth = 0; S.dist = 0; S.yaw = null; start = null; handH[0] = []; handH[1] = []; },
  };
})();
