/* 유튜브 로잉 북마크 (자체 VR 화면 방식)
 * youtube.com 영상 페이지에서 실행 → 패널의 "VR 시작"을 누르면
 * 이 페이지의 유튜브 영상을 헤드셋 전체 화면(구면)에 띄우고,
 * 컨트롤러를 핸들처럼 당기는 동작에 맞춰 재생 속도를 바꾼다.
 * 영상은 내려받지 않는다. 개인 테스트용.
 */
(() => {
  "use strict";
  if (window.__rowVR) { window.__rowVR.toggle(); return; }

  const S = {
    on: true, mode: "smooth", tau: 3, vRef: 11 / 3.6, power: 1, format: "360", quality: "hd1440", water: true,
    p: 0, pPrev: 0, v: 0, vSmooth: 0, rate: 0, dist: 0,
    peak: false, strokes: [], spm: 0,
    dMax: 0.55, dMin: 0.22, yaw: null, recenter: false,
    xr: false, hands: 0, last: performance.now(),
  };
  try { Object.assign(S, JSON.parse(localStorage.getItem("rowvr.yt2") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("rowvr.yt2", JSON.stringify({ mode: S.mode, tau: S.tau, vRef: S.vRef, power: S.power, format: S.format, quality: S.quality, water: S.water })); } catch (e) {} };
  const video = () => document.querySelector("video.html5-main-video") || document.querySelector("video");

  // ---------- 패널 ----------
  const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
  const panel = el("div", "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;background:#151c20;color:#e6ecee;border:1px solid #f2a33a;border-radius:12px;padding:14px;font:14px/1.5 system-ui,'Malgun Gothic',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)");
  panel.appendChild(el("div", "font-weight:700;font-size:15px;margin-bottom:4px;color:#f2a33a", "로잉 VR"));
  const status = el("div", "font-size:13px;color:#8d9ba1;margin-bottom:10px", "");
  panel.appendChild(status);

  const btnCss = "background:#2a3338;color:#e6ecee;border:1px solid #3d4a51;border-radius:8px;padding:8px 10px;font:500 13px system-ui,sans-serif;cursor:pointer";
  const onCss = ";background:rgba(242,163,58,.25);border-color:#f2a33a";
  const vrBtn = el("button", "width:100%;background:#f2a33a;color:#1a1206;border:0;border-radius:10px;padding:12px;font:700 16px system-ui,sans-serif;cursor:pointer;margin-bottom:10px", "VR 시작");
  panel.appendChild(vrBtn);

  panel.appendChild(el("div", "font-size:12px;color:#8d9ba1;margin-bottom:4px", "영상 형식"));
  const fmtRow = el("div", "display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px");
  const fmts = [["360", "360"], ["360tb", "360 입체"], ["180", "180 입체"]];
  const fmtBtns = {};
  for (const [k, label] of fmts) {
    const b = el("button", btnCss, label);
    b.onclick = () => { S.format = k; paintFmt(); save(); };
    fmtBtns[k] = b; fmtRow.appendChild(b);
  }
  const paintFmt = () => { for (const [k, b] of Object.entries(fmtBtns)) b.style.cssText = btnCss + (k === S.format ? onCss : ""); };
  paintFmt();
  panel.appendChild(fmtRow);

  const toggleRow = (label, opts, get, set) => {
    panel.appendChild(el("div", "font-size:12px;color:#8d9ba1;margin-bottom:4px", label));
    const r = el("div", "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px");
    const bs = {};
    const paint = () => { for (const [k, b] of Object.entries(bs)) b.style.cssText = btnCss + (String(get()) === k ? onCss : ""); };
    for (const [k, text] of opts) { const b = el("button", btnCss, text); b.onclick = () => { set(k); paint(); save(); }; bs[k] = b; r.appendChild(b); }
    paint(); panel.appendChild(r);
  };
  toggleRow("화질", [["hd1440", "1440p (부드럽게)"], ["hd2160", "4K (선명하게)"]], () => S.quality, k => { S.quality = k; setQuality(); });
  toggleRow("소리", [["true", "물소리 (음악 끄기)"], ["false", "유튜브 소리"]], () => S.water, k => { S.water = k === "true"; applySound(); });

  const stats = el("div", "display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font:600 18px ui-monospace,Consolas,monospace;margin-bottom:10px");
  const mkStat = (k) => { const w = el("div"); w.appendChild(el("div", "font:400 11px system-ui,sans-serif;color:#8d9ba1", k)); const v = el("div", "", "-"); w.appendChild(v); stats.appendChild(w); return v; };
  const sPace = mkStat("페이스/500m"), sSpm = mkStat("spm"), sRate = mkStat("배속");
  panel.appendChild(stats);

  const row = el("div", "display:flex;gap:6px;margin-bottom:8px");
  const modeBtn = el("button", btnCss, "");
  const setModeText = () => { modeBtn.textContent = S.mode === "smooth" ? "반응: 부드럽게" : "반응: 즉각"; };
  modeBtn.onclick = () => { S.mode = S.mode === "smooth" ? "instant" : "smooth"; setModeText(); save(); };
  setModeText();
  const offBtn = el("button", btnCss, "닫기");
  offBtn.onclick = () => api.toggle();
  row.append(modeBtn, offBtn);
  panel.appendChild(row);

  const slider = (label, min, max, step, get, set, fmt) => {
    const wrap = el("div", "margin-bottom:6px");
    const top = el("div", "display:flex;justify-content:space-between;font-size:12px;color:#8d9ba1");
    const val = el("b", "color:#e6ecee;font-family:ui-monospace,Consolas,monospace", fmt(get()));
    top.append(el("span", "", label), val);
    const r = el("input", "width:100%;accent-color:#f2a33a");
    r.type = "range"; r.min = min; r.max = max; r.step = step; r.value = get();
    r.oninput = () => { set(+r.value); val.textContent = fmt(+r.value); save(); };
    wrap.append(top, r); panel.appendChild(wrap);
  };
  slider("촬영 당시 배 속도", 3, 25, 1, () => Math.round(S.vRef * 3.6), v => S.vRef = v / 3.6, v => v + " km/h");
  slider("부드러움", 0.5, 8, 0.5, () => S.tau, v => S.tau = v, v => v.toFixed(1) + "초");
  slider("당기는 힘", 0.3, 3, 0.1, () => S.power, v => S.power = v, v => v.toFixed(1) + "×");
  panel.appendChild(el("div", "font-size:12px;color:#8d9ba1;margin-top:6px",
    "VR 안에서: 컨트롤러를 핸들처럼 모아 쥐고 팔을 뻗었다가 몸 쪽으로 당기세요. 당길 때마다 짧게 진동합니다. 그립 버튼 = 정면 다시 맞추기, A 버튼 = 반응 방식 전환, 메타 버튼 = 종료."));
  (document.body || document.documentElement).appendChild(panel);
  const setStatus = (t) => { status.textContent = t; };
  setStatus(navigator.xr ? "유튜브 영상이 재생되는지 확인한 뒤 'VR 시작'을 누르세요." : "이 브라우저는 VR을 지원하지 않습니다.");

  // ---------- 화질 고정 ----------
  function setQuality() {
    const mp = document.getElementById("movie_player");
    try { if (mp && mp.setPlaybackQualityRange) mp.setPlaybackQualityRange(S.quality, S.quality); } catch (e) {}
    try { if (mp && mp.setPlaybackQuality) mp.setPlaybackQuality(S.quality); } catch (e) {}
  }
  setQuality();

  // ---------- 소리: 유튜브 음악 대신 물소리 ----------
  let actx = null, noise = null, ambGain = null, ambSrc = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      noise = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
      const d = noise.getChannelData(0); let last = 0;
      for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } // 낮게 웅웅대는 물살 소리
    } catch (e) { actx = null; }
  }
  function startAmbience() {
    if (!actx || ambSrc) return;
    ambSrc = actx.createBufferSource(); ambSrc.buffer = noise; ambSrc.loop = true;
    const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
    ambGain = actx.createGain(); ambGain.gain.value = 0.05;
    ambSrc.connect(lp); lp.connect(ambGain); ambGain.connect(actx.destination); ambSrc.start();
  }
  function stopAmbience() { try { if (ambSrc) ambSrc.stop(); } catch (e) {} ambSrc = null; ambGain = null; }
  function splashSound(vol) {
    if (!actx || !S.water) return;
    const src = actx.createBufferSource(); src.buffer = noise;
    const bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900 + Math.random() * 600; bp.Q.value = 0.9;
    const g = actx.createGain(), t = actx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(bp); bp.connect(g); g.connect(actx.destination); src.start(t, Math.random()); src.stop(t + 0.55);
  }
  function applySound() {
    const vid = video();
    if (S.xr && S.water) { if (vid) vid.muted = true; startAmbience(); }
    else { if (vid) vid.muted = false; stopAmbience(); }
  }

  // ---------- WebGL: 영상 구면 그리기 ----------
  let gl = null, prog = null, tex = null, buf = null, loc = {}, lastVideoTime = -1, texOK = true;
  const VS = "attribute vec2 p; varying vec2 v; void main(){ v=p; gl_Position=vec4(p,0.0,1.0); }";
  const FS = [
    "precision highp float;",
    "varying vec2 v;",
    "uniform mat4 invVP;",          // (투영*시선회전)의 역행렬
    "uniform sampler2D tex;",
    "uniform int fmt;",             // 0=360, 1=360 상하입체, 2=180 좌우입체
    "uniform int eye;",             // 0=왼쪽, 1=오른쪽
    "uniform float yaw;",
    "void main(){",
    "  vec4 w = invVP * vec4(v, 1.0, 1.0);",
    "  vec3 d = normalize(w.xyz / w.w);",
    "  float c = cos(yaw), s = sin(yaw);",
    "  d = vec3(c*d.x - s*d.z, d.y, s*d.x + c*d.z);",     // 정면 맞추기
    "  float lon = atan(d.x, -d.z);",                      // 정면=0, 오른쪽=+
    "  float lat = asin(clamp(d.y, -1.0, 1.0));",
    "  vec2 uv; ",
    "  if (fmt == 2) {",
    "    if (abs(lon) > 1.5708) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }",
    "    uv = vec2((lon / 3.14159265 + 0.5) * 0.5 + (eye == 1 ? 0.5 : 0.0), 0.5 - lat / 3.14159265);",
    "  } else {",
    "    uv = vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.14159265);",
    "    if (fmt == 1) uv.y = uv.y * 0.5 + (eye == 1 ? 0.5 : 0.0);",
    "  }",
    "  gl_FragColor = texture2D(tex, uv);",
    "}",
  ].join("\n");

  function initGL(canvas) {
    gl = canvas.getContext("webgl", { xrCompatible: true, antialias: false });
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const n of ["invVP", "tex", "fmt", "eye", "yaw"]) loc[n] = gl.getUniformLocation(prog, n);
    loc.p = gl.getAttribLocation(prog, "p");
    tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  function uploadVideo() {
    const vid = video();
    if (!vid || vid.readyState < 3 || !texOK) return;   // 충분히 받아진 프레임만
    if (vid.currentTime === lastVideoTime) return;
    lastVideoTime = vid.currentTime;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid); }
    catch (e) { texOK = false; setStatus("유튜브가 영상 화면을 넘겨주지 않았습니다(" + e.name + "). 이 방식은 이 브라우저에서 쓸 수 없어요."); }
  }

  // 4x4 행렬 (column-major)
  function mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function inv(m) {
    const o = new Float32Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
      b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
      b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return o; det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  }

  // ---------- VR 세션 ----------
  let session = null, refSpace = null, canvas = null, aPrev = false;
  async function startVR() {
    if (session) { session.end(); return; }
    const vid = video();
    if (!vid) { setStatus("유튜브 영상을 찾지 못했습니다. 영상 페이지에서 실행해 주세요."); return; }
    initAudio(); if (actx && actx.state === "suspended") actx.resume();
    setQuality();
    try {
      session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor"] });
    } catch (e) { setStatus("VR을 시작하지 못했습니다: " + e.message); session = null; return; }
    if (!canvas) { canvas = document.createElement("canvas"); initGL(canvas); }
    await gl.makeXRCompatible();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    refSpace = await session.requestReferenceSpace("local");
    S.xr = true; S.yaw = null; texOK = true; lastVideoTime = -1;
    vrBtn.textContent = "VR 종료";
    setStatus("VR 실행 중");
    vid.pause();
    applySound();
    session.addEventListener("end", () => {
      S.xr = false; session = null; vrBtn.textContent = "VR 시작";
      setStatus("VR 종료됨. 다시 'VR 시작'을 누르면 이어서 됩니다.");
      const v = video(); if (v) v.playbackRate = 1;
      applySound();
    });
    session.requestAnimationFrame(onXRFrame);
  }
  vrBtn.onclick = startVR;

  function onXRFrame(t, frame) {
    if (!session) return;
    session.requestAnimationFrame(onXRFrame);
    const pose = frame.getViewerPose(refSpace);
    if (!pose) return;
    const hp = pose.transform.position, hq = pose.transform.orientation;
    if (S.yaw === null) {
      const fx = -2 * (hq.x * hq.z + hq.w * hq.y), fz = -(1 - 2 * (hq.x * hq.x + hq.y * hq.y));
      S.yaw = Math.atan2(-fx, -fz);   // 지금 보는 방향을 영상의 정면으로
    }
    readControllers(t, frame, hp);
    step(performance.now());   // VR 중에는 페이지 쪽 화면 갱신이 멈출 수 있어 여기서 물리 계산

    // 그리기
    uploadVideo();
    const layer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc.tex, 0);
    gl.uniform1i(loc.fmt, S.format === "360tb" ? 1 : S.format === "180" ? 2 : 0);
    gl.uniform1f(loc.yaw, S.yaw);
    pose.views.forEach((view, i) => {
      const vp = layer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      const vm = Float32Array.from(view.transform.inverse.matrix);
      vm[12] = vm[13] = vm[14] = 0;   // 회전만 (영상은 무한히 먼 배경)
      gl.uniformMatrix4fv(loc.invVP, false, inv(mul(view.projectionMatrix, vm)));
      gl.uniform1i(loc.eye, view.eye === "right" ? 1 : (view.eye === "left" ? 0 : i));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
  }

  function readControllers(t, frame, hp) {
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);
    let sum = 0, n = 0, pads = [], aNow = false;
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (gp) {
        if (gp.buttons[1] && gp.buttons[1].pressed) S.yaw = null;                       // 그립: 정면 다시 맞추기
        if (src.handedness === "right" && gp.buttons[4] && gp.buttons[4].pressed) aNow = true;
      }
      if (!src.gripSpace) continue;
      const p = frame.getPose(src.gripSpace, refSpace);
      if (!p) continue;
      const c = p.transform.position;
      sum += (c.x - hp.x) * fx + (c.z - hp.z) * fz; n++;
      if (gp) pads.push(gp);
    }
    if (aNow && !aPrev) { S.mode = S.mode === "smooth" ? "instant" : "smooth"; setModeText(); save(); }
    aPrev = aNow;
    S.hands = n;
    if (!n || S.yaw === null) return;
    const d = sum / n, dt = Math.min(0.05, (t - (readControllers.t || t)) / 1000); readControllers.t = t;
    S.dMax = Math.max(d, S.dMax - 0.015 * dt);
    S.dMin = Math.min(d, S.dMin + 0.015 * dt);
    if (S.dMax - S.dMin < 0.22) { const m = (S.dMax + S.dMin) / 2; S.dMax = m + 0.11; S.dMin = m - 0.11; }
    const pNew = Math.min(1, Math.max(0, (S.dMax - d) / (S.dMax - S.dMin)));
    if (S.p < 0.06 && pNew >= 0.06) { splashSound(1); for (const g of pads) { const h = g.hapticActuators && g.hapticActuators[0]; if (h && h.pulse) h.pulse(0.4, 40).catch(() => {}); } }
    if (S.p < 0.95 && pNew >= 0.95) splashSound(0.4);
    S.p = pNew;
  }

  // ---------- 물리 + 영상 배속 ----------
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
    let a = -C_DRAG * S.v * Math.abs(S.v) - C_LIN * S.v;
    if (hv > 0.05) a += K_DRIVE * S.power * Math.min(hv, 6) ** 2;
    S.v = Math.max(0, S.v + a * dt); S.dist += S.v * dt;
    if (S.p > 0.75) S.peak = true;
    if (S.peak && S.p < 0.15) { S.peak = false; S.strokes.push(now); if (S.strokes.length > 4) S.strokes.shift(); }
    S.pPrev = S.p;
    const st = S.strokes;
    S.spm = st.length >= 2 && now - st[st.length - 1] < 6000 ? 60000 * (st.length - 1) / (st[st.length - 1] - st[0]) : 0;
    S.vSmooth += (S.v - S.vSmooth) * (1 - Math.exp(-dt / S.tau));
    S.rate = Math.min(2, (S.mode === "smooth" ? S.vSmooth : S.v) / S.vRef);
    if (ambGain && actx) ambGain.gain.setTargetAtTime(0.04 + 0.22 * Math.min(1, S.vSmooth / 4), actx.currentTime, 0.3);

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
      if (S.xr && texOK) setStatus(S.hands ? "VR 실행 중 · 컨트롤러 " + S.hands + "개 인식" : "VR 실행 중 · 컨트롤러를 찾는 중");
    }
  }
  const fmtPace = s => { s = Math.min(s, 599); return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };

  const api = window.__rowVR = {
    toggle() {
      S.on = !S.on;
      panel.style.display = S.on ? "" : "none";
      if (!S.on) { if (session) session.end(); const v = video(); if (v) { v.playbackRate = 1; v.muted = false; } stopAmbience(); }
      if (S.on) { S.last = performance.now(); requestAnimationFrame(tick); }
    },
  };
  requestAnimationFrame(tick);
})();
