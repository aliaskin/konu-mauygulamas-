// Yankı koruması: ekran paylaşımında "sistem sesi" alınırken, bu sayfanın çaldığı sohbet
// seslerini (arkadaşların konuşması, diğer yayınların sesi) yakalanan sesten çıkarır.
// Böylece izleyiciler kendi seslerini yayından geri duymaz; oyun sesi olduğu gibi kalır.
//
// Yöntem: Çaldığımız seslerin karışımı (referans) elimizde. Sistem sesindeki kopyası bu
// referansın gecikmiş ve ölçeklenmiş hâli. Gecikme ana iş parçacığında GCC-PHAT çapraz
// korelasyonla bulunur, ince ayar ve çıkarma ses iş parçacığında kısa bir NLMS süzgeciyle yapılır.

const DEC = 8 // gecikme aramasında örnek seyreltme
const WIN = 8192 // seyreltilmiş pencere (48 kHz'de ~1.4 sn)
const FFT_N = 16384
const MAX_LAG = 6000 // seyreltilmiş örnek (~1 sn)

export const WORKLET_SRC = `
const DEC = ${DEC}, WIN = ${WIN}, TAPS = 8, FR = 12, RING = 1 << 16, LAM = 1 - 1 / (sampleRate * 3), LAMC = 1 - 1 / sampleRate
class KdEcho extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ref = new Float32Array(RING)
    this.wi = 0
    this.coarse = -1 // ana iş parçacığından gelen kaba gecikme
    this.center = -1 // örnek hassasiyetinde gecikme
    this.corr = new Float64Array(2 * FR + 1)
    this.cn = 0
    this.cand = -1
    this.votes = 0
    this.w = [new Float64Array(TAPS), new Float64Array(TAPS)]
    this.xv = new Float64Array(TAPS)
    this.R = new Float64Array(TAPS * TAPS)
    this.pL = new Float64Array(TAPS)
    this.pR = new Float64Array(TAPS)
    this.sn = 0
    this.dn = 0
    this.dRef = new Float32Array(WIN)
    this.dSys = new Float32Array(WIN)
    this.di = 0
    this.dc = 0
    this.accR = 0
    this.accS = 0
    this.accN = 0
    this.energy = 0
    this.waiting = false
    this.port.onmessage = e => {
      const d = e.data
      if (d && d.dbg) { this.dbg = true; return }
      if (!d || !('delay' in d)) return
      this.waiting = false
      if (typeof d.delay !== 'number') return
      const nd = Math.max(FR + TAPS, Math.round(d.delay))
      if (this.coarse < 0 || Math.abs(nd - this.coarse) > DEC) {
        this.coarse = nd
        this.corr.fill(0)
        this.votes = 0
        if (this.center < 0) this.setCenter(nd)
      }
    }
  }
  setCenter(c) {
    this.center = c
    this.w[0].fill(0)
    this.w[1].fill(0)
    this.R.fill(0)
    this.pL.fill(0)
    this.pR.fill(0)
  }
  // (R + δI) w = p, simetrik R'nin üst üçgeni tutulur; Cholesky ile her iki kanal için çöz
  solve() {
    const T = TAPS, R = this.R
    let tr = 0
    for (let k = 0; k < T; k++) tr += R[k * T + k]
    if (tr < 1e-3) return
    const d = tr / T * 1e-3
    const L = new Float64Array(T * T)
    for (let i = 0; i < T; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = (i === j ? R[i * T + i] + d : R[j * T + i])
        for (let k = 0; k < j; k++) sum -= L[i * T + k] * L[j * T + k]
        if (i === j) { if (sum <= 0) return; L[i * T + i] = Math.sqrt(sum) } else L[i * T + j] = sum / L[j * T + j]
      }
    }
    for (const [p, w] of [[this.pL, this.w[0]], [this.pR, this.w[1]]]) {
      const y = new Float64Array(T)
      for (let i = 0; i < T; i++) { let sum = p[i]; for (let k = 0; k < i; k++) sum -= L[i * T + k] * y[k]; y[i] = sum / L[i * T + i] }
      for (let i = T - 1; i >= 0; i--) { let sum = y[i]; for (let k = i + 1; k < T; k++) sum -= L[k * T + i] * w[k]; w[i] = sum / L[i * T + i] }
    }
  }
  process(inputs, outputs) {
    const sys = inputs[0], refIn = inputs[1], out = outputs[0]
    const n = out[0].length
    const r0 = refIn && refIn[0]
    const sL = sys && sys[0], sR = sys && (sys[1] || sys[0])
    if (!sL) { for (const ch of out) ch.fill(0); return true }
    const oL = out[0], oR = out[1] || out[0]
    const ring = this.ref, mask = RING - 1
    for (let i = 0; i < n; i++) {
      const x = r0 ? r0[i] : 0
      ring[this.wi] = x
      const sm = (sL[i] + sR[i]) * 0.5
      // 1) kaba gecikme araması için seyreltilmiş kopyalar (ana iş parçacığında çözülür)
      this.accR += x
      this.accS += sm
      if (++this.accN === DEC) {
        // Seyreltilmiş halka tampon; son WIN örnek, yarım pencerede bir (≈0.7 sn) gönderilir
        const rv = this.accR / DEC
        const di = this.di
        this.energy += rv * rv - this.dRef[di] * this.dRef[di]
        this.dRef[di] = rv
        this.dSys[di] = this.accS / DEC
        this.accR = this.accS = 0
        this.accN = 0
        this.di = (di + 1) % WIN
        if (++this.dc >= WIN / 2) {
          this.dc = 0
          if (!this.waiting && this.energy / WIN > 1e-6) {
            this.waiting = true
            const r = new Float32Array(WIN), y = new Float32Array(WIN), k = WIN - this.di
            r.set(this.dRef.subarray(this.di)); r.set(this.dRef.subarray(0, this.di), k)
            y.set(this.dSys.subarray(this.di)); y.set(this.dSys.subarray(0, this.di), k)
            this.port.postMessage({ref: r, sys: y}, [r.buffer, y.buffer])
          }
        }
      }
      // 2) kaba gecikmenin ±FR çevresinde tam örnek hassasiyetinde çapraz korelasyon
      const C = this.coarse
      if (C > 0) {
        const corr = this.corr
        for (let j = 0; j <= 2 * FR; j++) corr[j] = corr[j] * LAMC + sm * ring[(this.wi - (C - FR + j)) & mask]
        if (++this.cn === 2048) {
          this.cn = 0
          let bj = 0
          for (let j = 1; j <= 2 * FR; j++) if (Math.abs(corr[j]) > Math.abs(corr[bj])) bj = j
          const fine = C - FR + bj
          // Yeni değer ancak üst üste 3 kez aynı çıkarsa kabul edilir (oyun sesi baskınken anlık sapmalar süzgeci sıfırlamasın)
          this.votes = fine === this.cand ? this.votes + 1 : 1
          this.cand = fine
          if (Math.abs(fine - this.center) > 1 && this.votes >= 3 && Math.abs(corr[bj]) > 1e-4) this.setCenter(fine)
        }
      }
      // 3) Yankı süzgeci: tam gecikmenin çevresindeki TAPS örnek için katsayılar, son birkaç
      //    saniyenin ilinti matrislerinden en küçük kareler ile çözülür (oyun sesi ortalamada söner)
      const D = this.center
      if (D > 0) {
        const base = this.wi - D + TAPS / 2
        const xv = this.xv, R = this.R, pL = this.pL, pR = this.pR, wL = this.w[0], wR = this.w[1], lam = LAM
        let yL = 0, yR = 0
        for (let k = 0; k < TAPS; k++) {
          const v = ring[(base - k) & mask]
          xv[k] = v
          yL += wL[k] * v
          yR += wR[k] * v
        }
        oL[i] = sL[i] - yL
        oR[i] = sR[i] - yR
        for (let a = 0; a < TAPS; a++) {
          const va = xv[a]
          pL[a] = pL[a] * lam + sL[i] * va
          pR[a] = pR[a] * lam + sR[i] * va
          const row = a * TAPS
          for (let c = a; c < TAPS; c++) R[row + c] = R[row + c] * lam + va * xv[c]
        }
        if (++this.sn === 1024) {
          this.sn = 0
          this.solve()
          if (this.dbg && ++this.dn % 40 === 0) this.port.postMessage({st: {center: this.center, coarse: this.coarse, cand: this.cand, w: Array.from(this.w[0]).map(x => +x.toFixed(3))}})
        }
      } else {
        oL[i] = sL[i]
        oR[i] = sR[i]
      }
      this.wi = (this.wi + 1) & mask
    }
    return true
  }
}
registerProcessor('kd-echo', KdEcho)
`

// ---- ana iş parçacığı: GCC-PHAT ile gecikme tahmini ----
let tw = null
function fft(re, im, inv) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  if (!tw || tw.n !== n) {
    tw = {n, c: new Float64Array(n / 2), s: new Float64Array(n / 2)}
    for (let i = 0; i < n / 2; i++) { tw.c[i] = Math.cos(2 * Math.PI * i / n); tw.s[i] = Math.sin(2 * Math.PI * i / n) }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const c = tw.c[k * step], s = inv ? tw.s[k * step] : -tw.s[k * step]
        const a = i + k, b = a + half
        const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c
        re[b] = re[a] - xr; im[b] = im[a] - xi
        re[a] += xr; im[a] += xi
      }
    }
  }
}
// Sistem sesi (sys) referansa (ref) göre kaç örnek gecikmeli? Güvenilir değilse null.
export function estimateDelay(ref, sys) {
  const ar = new Float64Array(FFT_N), ai = new Float64Array(FFT_N)
  const br = new Float64Array(FFT_N), bi = new Float64Array(FFT_N)
  ar.set(ref)
  br.set(sys)
  fft(ar, ai, false)
  fft(br, bi, false)
  for (let i = 0; i < FFT_N; i++) {
    // conj(A) * B, faz dönüşümü (PHAT) ile normalize
    const r = ar[i] * br[i] + ai[i] * bi[i]
    const m = ar[i] * bi[i] - ai[i] * br[i]
    const mag = Math.hypot(r, m) + 1e-12
    ar[i] = r / mag
    ai[i] = m / mag
  }
  fft(ar, ai, true)
  let best = 0, bestV = -Infinity, sum = 0
  for (let l = 0; l <= MAX_LAG; l++) {
    const v = ar[l]
    sum += Math.abs(v)
    if (v > bestV) { bestV = v; best = l }
  }
  const mean = sum / (MAX_LAG + 1)
  return bestV > mean * 8 ? best * DEC : null
}

// Sistem sesi izinden, sohbet sesleri temizlenmiş yeni bir ses izi üretir.
// refBus: sayfanın çaldığı seslerin (mono) karışımının bağlandığı GainNode.
let moduleUrl = null
export async function createEchoGuard(ac, sysTrack, refBus) {
  if (!ac.audioWorklet) return null
  moduleUrl ||= URL.createObjectURL(new Blob([WORKLET_SRC], {type: 'application/javascript'}))
  await ac.audioWorklet.addModule(moduleUrl)
  const src = ac.createMediaStreamSource(new MediaStream([sysTrack]))
  const node = new AudioWorkletNode(ac, 'kd-echo', {
    numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit'
  })
  const dst = ac.createMediaStreamDestination()
  dst.channelCount = 2
  src.connect(node, 0, 0)
  refBus.connect(node, 0, 1)
  node.connect(dst)
  node.port.onmessage = e => {
    const d = e.data
    if (!d || !d.ref) return
    let delay = null
    try { delay = estimateDelay(d.ref, d.sys) } catch {}
    node.port.postMessage({delay})
  }
  const track = dst.stream.getAudioTracks()[0]
  return {
    track,
    stop() {
      try { src.disconnect() } catch {}
      try { refBus.disconnect(node) } catch {}
      try { node.disconnect() } catch {}
      node.port.onmessage = null
      track.stop()
    }
  }
}
