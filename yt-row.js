/* 유튜브 로잉 북마크
 * youtube.com 영상 페이지에서 실행 → 유튜브 VR 모드(고글 버튼)로 들어가면
 * 컨트롤러를 핸들처럼 당기는 동작에 맞춰 영상 재생 속도를 바꾼다.
 * 영상은 내려받지 않고 유튜브 플레이어의 배속만 조절한다. 개인 테스트용.
 */
(() => {
  "use strict";
  if (window.__rowVR) { window.__rowVR.toggle(); return; }

  const S = {
    on: true, mode: "smooth", tau: 3, vRef: 11 / 3.6, power: 1,
    p: 0, pPrev: 0, v: 0, vSmooth: 0, rate: 0, dist: 0,
    peak: false, strokes: [], spm: 0,
    dMax: 0.55, dMin: 0.22, yaw: null,
    xr: false, hands: 0, last: performance.now(),
  };
  try { Object.assign(S, JSON.parse(localStorage.getItem("rowvr.yt") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("rowvr.yt", JSON.stringify({ mode: S.mode, tau: S.tau, vRef: S.vRef, power: S.power })); } catch (e) {} };

  const video = () => document.querySelector("video.html5-main-video") || document.querySelector("video");

  // ---------- 패널 (VR 밖에서 보임) ----------
  const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
  const panel = el("div", "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;background:#151c20;color:#e6ecee;border:1px solid #f2a33a;border-radius:12px;padding:14px;font:14px/1.5 system-ui,'Malgun Gothic',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)");
  const title = el("div", "font-weight:700;font-size:15px;margin-bottom:6px;color:#f2a33a", "로잉 VR 켜짐");
  const status = el("div", "font-size:13px;color:#8d9ba1;margin-bottom:10px", "");
  const stats = el("div", "display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font:600 18px ui-monospace,Consolas,monospace;margin-bottom:10px");
  const mkStat = (k) => { const w = el("div"); w.appendChild(el("div", "font:400 11px system-ui,sans-serif;color:#8d9ba1", k)); const v = el("div", "", "-"); w.appendChild(v); stats.appendChild(w); return v; };
  const sPace = mkStat("페이스/500m"), sSpm = mkStat("spm"), sRate = mkStat("배속");
  panel.append(title, status, stats);

  const btnCss = "background:#2a3338;color:#e6ecee;border:1px solid #3d4a51;border-radius:8px;padding:7px 10px;font:500 13px system-ui,sans-serif;cursor:pointer";
  const row = el("div", "display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap");
  const modeBtn = el("button", btnCss, "");
  const setModeText = () => { modeBtn.textContent = S.mode === "smooth" ? "반응: 부드럽게" : "반응: 즉각"; };
  modeBtn.onclick = () => { S.mode = S.mode === "smooth" ? "instant" : "smooth"; setModeText(); save(); };
  setModeText();
  const offBtn = el("button", btnCss, "끄기");
  offBtn.onclick = () => api.toggle();
  row.append(modeBtn, offBtn);
  panel.appendChild(row);

  const slider = (label, min, max, step, get, set, fmt) => {
    const wrap = el("div", "margin-bottom:6px");
    const top = el("div", "display:flex;justify-content:space-between;font-size:12px;color:#8d9ba1");
    const lab = el("span", "", label), val = el("b", "color:#e6ecee;font-family:ui-monospace,Consolas,monospace", fmt(get()));
    top.append(lab, val);
    const r = el("input", "width:100%;accent-color:#f2a33a");
    r.type = "range"; r.min = min; r.max = max; r.step = step; r.value = get();
    r.oninput = () => { set(+r.value); val.textContent = fmt(+r.value); save(); };
    wrap.append(top, r); panel.appendChild(wrap);
  };
  slider("촬영 당시 배 속도", 3, 25, 1, () => Math.round(S.vRef * 3.6), v => S.vRef = v / 3.6, v => v + " km/h");
  slider("부드러움", 0.5, 8, 0.5, () => S.tau, v => S.tau = v, v => v.toFixed(1) + "초");
  slider("당기는 힘", 0.3, 3, 0.1, () => S.power, v => S.power = v, v => v.toFixed(1) + "×");
  panel.appendChild(el("div", "font-size:12px;color:#8d9ba1;margin-top:6px",
    "이제 영상의 VR(고글) 버튼을 눌러 들어가세요. 컨트롤러를 핸들처럼 모아 쥐고 팔을 뻗었다가 몸 쪽으로 당기면 됩니다. 캐치마다 컨트롤러가 짧게 진동합니다."));
  document.body.appendChild(panel);

  const setStatus = (t) => { status.textContent = t; };
  setStatus(navigator.xr ? "VR 모드 대기 중" : "이 브라우저는 VR 모드를 지원하지 않습니다");

  // ---------- 유튜브 VR 세션 가로채기 ----------
  const proto = window.XRSystem && XRSystem.prototype;
  const origRequest = proto && proto.requestSession;
  if (origRequest && !proto.__rowPatched) {
    proto.__rowPatched = true;
    proto.requestSession = function (mode, opts) {
      return origRequest.call(this, mode, opts).then(session => {
        if (mode === "immersive-vr" && window.__rowVR) window.__rowVR.attach(session);
        return session;
      });
    };
  }

  let session = null, refSpace = null;
  function attach(sess) {
    session = sess; S.xr = true; S.yaw = null;
    setStatus("VR 모드 연결됨. 저어 보세요");
    sess.addEventListener("end", () => { S.xr = false; session = null; refSpace = null; setStatus("VR 모드 종료됨. 다시 들어가면 이어서 작동합니다"); });
    sess.requestReferenceSpace("local").then(r => { refSpace = r; sess.requestAnimationFrame(onXRFrame); })
      .catch(e => setStatus("컨트롤러 위치를 읽지 못했습니다: " + e.message));
  }

  function onXRFrame(t, frame) {
    if (!session) return;
    session.requestAnimationFrame(onXRFrame);
    const view = frame.getViewerPose(refSpace);
    if (!view) return;
    const hp = view.transform.position, hq = view.transform.orientation;
    if (S.yaw === null) {
      // 처음 들어간 순간 보고 있는 방향을 정면으로
      const fx = -2 * (hq.x * hq.z + hq.w * hq.y), fz = -(1 - 2 * (hq.x * hq.x + hq.y * hq.y));
      S.yaw = Math.atan2(fx, fz);
    }
    const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
    let sum = 0, n = 0, pads = [];
    for (const src of session.inputSources) {
      if (!src.gripSpace) continue;
      const pose = frame.getPose(src.gripSpace, refSpace);
      if (!pose) continue;
      const c = pose.transform.position;
      sum += (c.x - hp.x) * fx + (c.z - hp.z) * fz; n++;
      if (src.gamepad) pads.push(src.gamepad);
      // 그립 버튼 = 정면 다시 맞추기
      if (src.gamepad && src.gamepad.buttons[1] && src.gamepad.buttons[1].pressed) S.yaw = null;
    }
    S.hands = n;
    if (n) {
      const d = sum / n, dt = Math.min(0.05, (t - S.last) / 1000);
      S.dMax = Math.max(d, S.dMax - 0.015 * dt);
      S.dMin = Math.min(d, S.dMin + 0.015 * dt);
      if (S.dMax - S.dMin < 0.22) { const m = (S.dMax + S.dMin) / 2; S.dMax = m + 0.11; S.dMin = m - 0.11; }
      S.p = Math.min(1, Math.max(0, (S.dMax - d) / (S.dMax - S.dMin)));
      // 캐치 순간 짧은 진동
      if (S.pPrev < 0.06 && S.p >= 0.06) for (const g of pads) { const h = g.hapticActuators && g.hapticActuators[0]; if (h && h.pulse) h.pulse(0.4, 40).catch(() => {}); }
    }
  }

  // ---------- 물리 + 영상 배속 (PC 데모와 같은 모델) ----------
  const K_DRIVE = 1.9, C_DRAG = 0.06, C_LIN = 0.05;
  function tick(now) {
    if (!S.on) return;
    requestAnimationFrame(tick);
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

    const vid = video();
    if (vid && (S.xr || S.v > 0.01)) {
      if (S.rate < 0.07) { if (!vid.paused) vid.pause(); }
      else {
        const r = Math.max(0.07, S.rate);
        if (Math.abs(vid.playbackRate - r) > 0.01) vid.playbackRate = r;
        if (vid.paused) vid.play().catch(() => {});
      }
    }
    if (now - (tick.ui || 0) > 200) {
      tick.ui = now;
      sPace.textContent = S.vSmooth > 0.3 ? fmtPace(500 / S.vSmooth) : "--:--";
      sSpm.textContent = Math.round(S.spm);
      sRate.textContent = S.rate.toFixed(2);
      if (S.xr) setStatus(S.hands ? "VR 연결됨 · 컨트롤러 " + S.hands + "개 인식" : "VR 연결됨 · 컨트롤러를 찾는 중");
    }
  }
  const fmtPace = s => { s = Math.min(s, 599); return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };

  const api = window.__rowVR = {
    attach,
    toggle() {
      S.on = !S.on;
      panel.style.display = S.on ? "" : "none";
      const vid = video();
      if (!S.on && vid) vid.playbackRate = 1;
      if (S.on) { S.last = performance.now(); requestAnimationFrame(tick); }
    },
  };
  requestAnimationFrame(tick);
})();
