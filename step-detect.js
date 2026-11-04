/* 걸음 인식 (머리 위아래 흔들림 기반) — 하이킹 모드와 측정 화면이 함께 씀
 * 입력: 매 프레임 머리 높이(y, m)와 시간(초)
 * 출력: 걸음 이벤트, 분당 걸음(cadence), 흔들림 폭, 걷는 중 여부
 * 방식: 자세 변화 제거 → 떨림 제거 → 데드밴드가 있는 최저점 찾기(발 디딤) → 리듬이 3번 고르게 반복되면 '걷는 중' 확정
 */
(function (root) {
  "use strict";
  function StepDetector(opts) {
    opts = opts || {};
    this.minInterval = opts.minInterval || 0.28;   // 초: 이보다 빠른 걸음은 무시(약 210걸음/분)
    this.maxInterval = opts.maxInterval || 1.6;    // 초: 이보다 느리면 멈춘 것으로
    this.minAmp = opts.minAmp || 0.003;            // m: 최소 흔들림 폭 (3mm)
    this.reset();
  }
  StepDetector.prototype.reset = function () {
    this.t = null; this.base = null; this.lp = 0;
    this.dir = "down"; this.curMin = Infinity; this.curMinT = 0; this.curMax = -Infinity; this.lastMax = null;
    this.ampAvg = 0.008;
    this.cand = []; this.candAmp = []; this.confirmed = false;   // 리듬이 확인되기 전 후보 걸음
    this.steps = []; this.intervals = []; this.count = 0;
    this.lastStepT = -10; this.cadence = 0; this.amp = 0;
  };
  // 한 프레임 넣기. 걸음이 확정되면 그 걸음 정보를 돌려줌
  StepDetector.prototype.push = function (t, y) {
    if (this.t === null) { this.t = t; this.base = y; return null; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    // 1) 자세 변화(천천히 기대거나 숙이기)는 빼고 걸음 흔들림만: 1.2초 평균을 기준선으로
    this.base += (y - this.base) * (1 - Math.exp(-dt / 1.2));
    const hp = y - this.base;
    // 2) 떨림 제거: 약 6Hz 아래만 통과
    this.lp += (hp - this.lp) * (1 - Math.exp(-dt * 2 * Math.PI * 6));
    // 3) 데드밴드(h)가 있는 최고점/최저점 찾기 — 작은 떨림으로는 방향이 바뀌지 않음
    const h = Math.max(0.0015, 0.25 * this.ampAvg);
    let ev = null;
    if (this.dir === "down") {
      if (this.lp < this.curMin) { this.curMin = this.lp; this.curMinT = t; }
      if (this.lp > this.curMin + h) {                                // 다시 올라옴 = 최저점(발 디딤) 확정
        const sinceMax = this.lastMax === null ? 0 : this.lastMax - this.curMin;
        ev = this._onMin(this.curMinT, sinceMax);
        this.dir = "up"; this.curMax = this.lp;
      }
    } else {
      if (this.lp > this.curMax) this.curMax = this.lp;
      if (this.lp < this.curMax - h) { this.lastMax = this.curMax; this.dir = "down"; this.curMin = this.lp; this.curMinT = t; }
    }
    // 오래 걸음이 없으면 '걷는 중' 해제
    if (this.confirmed && t - this.lastStepT > this.maxInterval * 1.3) { this.confirmed = false; this.cadence = 0; this.intervals = []; this.cand = []; this.candAmp = []; }
    if (!this.confirmed) this.ampAvg += (0.008 - this.ampAvg) * (1 - Math.exp(-dt / 4));
    return ev;
  };
  StepDetector.prototype._onMin = function (t, sinceMax) {
    const thr = Math.max(this.minAmp, 0.35 * this.ampAvg);
    if (sinceMax < thr) return null;
    const last = this.cand.length ? this.cand[this.cand.length - 1] : -10;
    if (t - last < this.minInterval) return null;
    const gap = t - this.lastStepT;
    this.cand.push(t); this.candAmp.push(sinceMax);
    if (this.cand.length > 4) { this.cand.shift(); this.candAmp.shift(); }
    const c = this.cand, ivs = [];
    for (let i = 1; i < c.length; i++) ivs.push(c[i] - c[i - 1]);
    const recent = ivs.slice(-3);
    const steady = recent.length >= 3 && recent.every(x => x >= this.minInterval && x <= this.maxInterval) &&
                   Math.max.apply(null, recent) / Math.min.apply(null, recent) < 1.6 &&
                   Math.max.apply(null, this.candAmp) / Math.min.apply(null, this.candAmp) < 2.5;   // 흔들림 크기도 고르게
    const okNow = this.confirmed && ivs.length && ivs[ivs.length - 1] <= this.maxInterval;
    if (steady && !this.confirmed) {
      this.confirmed = true;
      for (const ct of c) { this.count++; this.steps.push(ct); }      // 확정되면 앞선 후보도 걸음으로 셈
      for (const x of recent) this.intervals.push(x);
    } else if (okNow) {
      this.count++; this.steps.push(t); this.intervals.push(gap);
    }
    if (this.intervals.length > 8) this.intervals.splice(0, this.intervals.length - 8);
    if (!this.confirmed) return null;
    this.amp = sinceMax;
    this.ampAvg += (sinceMax - this.ampAvg) * 0.25;
    this.lastStepT = t;
    const iv = this.intervals.slice().sort((a, b) => a - b);
    this.cadence = iv.length >= 2 ? 60 / iv[Math.floor(iv.length / 2)] : 0;
    return { t, amp: sinceMax, cadence: this.cadence };
  };
  StepDetector.prototype.walking = function (t) { return this.confirmed && t - this.lastStepT < Math.max(1.2, 1.6 * (this.cadence ? 60 / this.cadence : 1)); };
  StepDetector.prototype.signal = function () { return this.lp; };

  // 걸음 빠르기 → 걷는 속도(제자리 걸음용). 평소 걸음(base)으로 사람마다 보정
  function cadenceToKmh(cad, base) {
    base = base || 105;
    if (!cad) return 0;
    return Math.max(0, Math.min(6, 3.8 * Math.pow(cad / base, 1.6)));   // 평소 약 3.8km/h, 빠를수록 더 빨라짐
  }
  root.StepDetector = StepDetector;
  root.cadenceToKmh = cadenceToKmh;
  if (typeof module !== "undefined") module.exports = { StepDetector, cadenceToKmh };
})(typeof window !== "undefined" ? window : globalThis);
