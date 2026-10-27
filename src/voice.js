// Gelişmiş gürültü engelleme (mikrofon).
//
// Zincir: ham mikrofon → RNNoise 0.2 (yapay zekâ gürültü bastırma, 48 kHz tam bant) → akıllı ses kapısı → gönderilen ses
//
// - RNNoise: fan, klima, uğultu, klavye/fare tıkırtısı, nefes gibi konuşma olmayan sesleri bastırır ve her
//   10 ms'lik kare için "burada konuşma var mı" olasılığını (VAD) verir.
// - Ses kapısı: konuşmuyorken çıkışı tamamen sessize alır (klavye, nefes, tıkırtı hiç gitmez).
//   Kendi konuşma seviyeni öğrenir; ondan belirgin biçimde kısık gelen konuşmaları (odadaki başkaları,
//   televizyon, mikrofona uzak sesler) da keser. Açılış yumuşak ve hızlıdır, kelime başları kırpılmaz;
//   kelime aralarında kapanmaz (250 ms bekleme).
// - İşlemci: modeli yalnızca mikrofon açıkken ve ses varken çalıştırır (susturulmuşken ya da bas-konuş
//   bırakılmışken hiç çalışmaz). Ses iş parçacığında (AudioWorklet) çalışır, arayüzü yavaşlatmaz.
//
// Model dosyası (public/rnnoise.wasm): xiph/rnnoise 0.2 (BSD-3-Clause), jitsi/rnnoise-wasm derlemesi (Apache-2.0).

const FR = 480 // RNNoise kare boyu: 48 kHz'de 10 ms

// Hem ses iş parçacığında hem de testlerde çalışan saf sinyal işleme çekirdeği
export const VOICE_CORE = `
const FR = ${FR}
const ATT = 1 - Math.exp(-1 / (0.0015 * 48000)) // ~1.5 ms açılış
const REL = Math.exp(-1 / (0.05 * 48000)) // ~50 ms kapanış
const dB = e => 10 * Math.log10(e + 1e-12)
class VoiceCore {
  constructor(x, opts) {
    this.x = x
    this.st = x.h(0) // rnnoise_create(varsayılan model)
    this.pin = x.e(FR * 4) // malloc
    this.pout = x.e(FR * 4)
    this.bg = !opts || opts.bg !== false
    this.out = new Float32Array(FR)
    this.open = false
    this.hold = 0
    this.sl = -30 // kendi konuşma seviyem (dBFS); konuştukça öğrenilir
    this.recent = 0 // son net konuşmadan beri kalan kare sayısı (cümle bağlamı)
    // Ayar değerleri (testlerle seçildi): açılış payı, cümle içi tolerans, üst sınır
    this.m1 = (opts && opts.m1) ?? 14
    this.rx = (opts && opts.rx) ?? 8
    this.cap = (opts && opts.cap) ?? -28
    this.fb = (opts && opts.fb) ?? 0.01
    this.up = (opts && opts.up) ?? 0.085
    this.dn = (opts && opts.dn) ?? 0.015
    this.g = 0
    this.vad = 0
    this.lvl = -120
  }
  // Başlangıç eşiği (bir süre sustuktan sonra konuşma başlarken): kendi sesimin yüksek hecelerinden 14 dB aşağısı.
  // Üst sınır -28 dBFS: bundan yüksek her konuşma her zaman geçer.
  // Değerler, temiz konuşma + kalabalık/uzak konuşma kayıtlarıyla yapılan taramayla seçildi: konuşma kaybı %1.3,
  // kullanıcıdan 18-26 dB kısık arka plan konuşması %0 geçiyor.
  thr() { return this.bg ? Math.min(this.cap, Math.max(-62, this.sl - this.m1)) : -62 }
  frame(inp) {
    const x = this.x
    let ein = 0
    for (let i = 0; i < FR; i++) ein += inp[i] * inp[i]
    if (ein < 1e-10) {
      // Susturulmuş / bas-konuş bırakılmış: model çalışmaz (işlemci harcamaz)
      this.out.fill(0)
      this.open = false
      this.hold = 0
      this.g = 0
      this.vad = 0
      this.lvl = -120
      this.recent = 0
      return this.out
    }
    // Bellek görünümleri yalnızca wasm belleği büyüyünce yeniden oluşturulur (ses iş parçacığında çöp üretmesin)
    if (this.buf !== x.c.buffer) { this.buf = x.c.buffer; this.H = new Float32Array(this.buf, this.pin, FR); this.O = new Float32Array(this.buf, this.pout, FR) }
    const H = this.H, O = this.O
    for (let i = 0; i < FR; i++) H[i] = inp[i] * 32768
    const vad = x.j(this.st, this.pout, this.pin) // rnnoise_process_frame
    const out = this.out
    let eout = 0
    for (let i = 0; i < FR; i++) { const v = O[i] / 32768; out[i] = v; eout += v * v }
    // RNNoise çıkışı bir kare gecikmeli, VAD ise en yeni kareyi de görür: kelime başı kaçmaz
    const L = dB(eout / FR)
    const T = this.thr()
    // Cümle bağlamı: son 1.5 sn içinde açıkça benim seviyemde (yüksek hecelerimden en fazla 12 dB alçak) konuşma
    // olduysa alçak heceler de geçer (8 dB tolerans). Yalnızca kısık/uzak konuşma varsa bağlam kurulmaz, eşik sıkıdır.
    const near = this.recent > 0
    const To = near ? Math.max(-62, T - this.rx) : T
    const Ts = Math.max(-62, To - 6)
    const speech = (vad >= 0.6 && L > To) || (this.open && vad >= 0.25 && L > Ts)
    if (speech) { this.open = true; this.hold = 25 } else if (this.hold > 0) this.hold--
    else this.open = false
    if (speech && vad > 0.85 && L > Math.max(T, Math.min(-30, this.sl - 12))) this.recent = 150; else if (this.recent > 0) this.recent--
    // Kendi konuşma seviyemi öğren: eşiği geçen net konuşma karelerinin ~%85'lik dilimi (sesli harfler).
    // Eşiği geçemeyen (arka plan) konuşma öğrenilmez; tek bir bağırma da seviyeyi bir anda zıplatmaz.
    if (vad > 0.9 && L > T) this.sl = Math.min(-12, Math.max(-50, this.sl + (L > this.sl ? this.up : -this.dn)))
    // Mikrofondan uzaklaştım / sesim kısıldı: eşiğin hemen altında (6 dB içinde) uzun süren net konuşma varsa
    // seviyeyi yavaşça (1 dB/sn) indir. Çok kısık uzak sesler bunu tetiklemez. (Otomatik ses seviyesi açıkken
    // tarayıcı da kısılan sesi birkaç saniyede toparlar.)
    else if (this.bg && !this.open && vad > 0.95 && L > T - 6) this.sl = Math.max(-50, this.sl - this.fb)
    this.vad = vad
    this.lvl = L
    const tgt = this.open ? 1 : 0
    let g = this.g
    for (let i = 0; i < FR; i++) {
      g = tgt > g ? g + (1 - g) * ATT : g * REL
      out[i] *= g
    }
    this.g = g < 1e-4 ? 0 : g
    return out
  }
}
`

export const VOICE_WORKLET = VOICE_CORE + `
class KdVoice extends AudioWorkletProcessor {
  constructor(o) {
    super()
    const p = (o && o.processorOptions) || {}
    this.bg = p.bg !== false
    this.debug = !!p.debug
    this.core = null
    this.dead = false
    this.ib = new Float32Array(FR)
    this.ni = 0
    // Çıkış halkası: 448 örnek sıfırla başlar (128'lik bloklarla 480'lik kareler arasındaki fark)
    this.ob = new Float32Array(4096)
    this.or = 0
    this.ow = 448
    this.frames = 0
    this.port.onmessage = e => {
      const d = e.data
      if (d === 'destroy') this.dead = true
      else if (d && typeof d.bg === 'boolean') { this.bg = d.bg; if (this.core) this.core.bg = d.bg }
    }
    if (p.wasm) this.init(p.wasm).catch(err => this.port.postMessage({error: String(err && err.message || err)}))
  }
  async init(bytes) {
    let mem
    const imports = {a: {
      a: req => { try { mem.grow(Math.ceil((req - mem.buffer.byteLength) / 65536)); return 1 } catch (e) { return 0 } }, // emscripten_resize_heap
      b: (d, s, n) => { new Uint8Array(mem.buffer).copyWithin(d, s, s + n) } // emscripten_memcpy_big
    }}
    const {instance} = await WebAssembly.instantiate(bytes, imports)
    const x = instance.exports
    mem = x.c
    x.d()
    this.core = new VoiceCore(x, {bg: this.bg})
    this.port.postMessage({ready: true})
  }
  process(inputs, outputs) {
    if (this.dead) return false
    const out = outputs[0] && outputs[0][0]
    if (!out) return true
    const inp = inputs[0] && inputs[0][0]
    const core = this.core
    if (!core) {
      // Model yüklenirken ses kesilmesin
      if (inp) out.set(inp); else out.fill(0)
      return true
    }
    const n = out.length, ib = this.ib, ob = this.ob, M = ob.length
    for (let i = 0; i < n; i++) {
      ib[this.ni++] = inp ? inp[i] : 0
      if (this.ni === FR) {
        this.ni = 0
        const f = core.frame(ib)
        for (let k = 0; k < FR; k++) { ob[this.ow] = f[k]; this.ow = (this.ow + 1) % M }
        if (this.debug && ++this.frames % 10 === 0) this.port.postMessage({dbg: 1, open: core.open, vad: core.vad, lvl: core.lvl, sl: core.sl})
      }
    }
    for (let i = 0; i < n; i++) {
      if (this.or === this.ow) { out[i] = 0; continue }
      out[i] = ob[this.or]
      ob[this.or] = 0
      this.or = (this.or + 1) % M
    }
    return true
  }
}
registerProcessor('kd-voice', KdVoice)
`

let wasmP = null
// Model dosyasını bir kez indir (tarayıcı önbelleğinde kalır)
export function loadDenoiser(url = 'rnnoise.wasm') {
  wasmP ||= fetch(url).then(r => {
    if (!r.ok) throw new Error('rnnoise.wasm ' + r.status)
    return r.arrayBuffer()
  })
  wasmP.catch(() => { wasmP = null })
  return wasmP
}

let moduleUrl = null
export async function createVoiceChain(ac, raw, opts = {}) {
  if (!ac?.audioWorklet || ac.sampleRate !== 48000 || typeof WebAssembly !== 'object') throw new Error('desteklenmiyor')
  const bytes = await loadDenoiser()
  moduleUrl ||= URL.createObjectURL(new Blob([VOICE_WORKLET], {type: 'application/javascript'}))
  await ac.audioWorklet.addModule(moduleUrl)
  const node = new AudioWorkletNode(ac, 'kd-voice', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
    processorOptions: {wasm: bytes, bg: opts.bg !== false, debug: !!opts.debug}
  })
  const src = ac.createMediaStreamSource(raw)
  const dst = ac.createMediaStreamDestination()
  dst.channelCount = 1
  src.connect(node)
  node.connect(dst)
  // Yalnızca bu hattın kendi izini durdur (iz sonradan başka bir akışa taşınmış olabilir)
  const track = dst.stream.getAudioTracks()[0]
  const stop = () => {
    try { src.disconnect() } catch {}
    try { node.disconnect() } catch {}
    try { node.port.postMessage('destroy') } catch {}
    node.port.onmessage = null
    track?.stop()
  }
  try {
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('zaman aşımı')), 8000)
      node.port.onmessage = e => {
        const d = e.data
        if (d?.ready) { clearTimeout(to); res() } else if (d?.error) { clearTimeout(to); rej(new Error(d.error)) }
      }
    })
  } catch (e) { stop(); throw e }
  node.port.onmessage = e => { if (e.data?.dbg) opts.onDebug?.(e.data) }
  return {
    stream: dst.stream,
    setBg(b) { node.port.postMessage({bg: !!b}) },
    stop
  }
}
