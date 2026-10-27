# Kanka Chat

**👉 Uygulamayı aç: https://aliaskin.github.io/konu-mauygulamas-/**

Tarayıcıda çalışan, Discord benzeri bir sohbet uygulaması. Kurulum, hesap ya da sunucu gerektirmez.
Mesajlar, ses ve görüntü doğrudan arkadaşlarının cihazlarına (P2P, WebRTC) uçtan uca şifreli gider.

## Özellikler

- **Sunucular ve kanallar**: sunucu oluştur, davet linki/kodu ile arkadaş ekle, metin ve ses kanalları aç, düzenle, sil
- **Yazılı sohbet**: markdown (`**kalın**`, `*italik*`, `` `kod` ``, ```` ``` ```` blokları, `||spoiler||`), @bahsetme, yanıtlama,
  düzenleme (↑ tuşu), silme, emoji tepkileri, “yazıyor…” göstergesi, okunmamış rozetleri
- **Resim ve dosya paylaşımı**: yapıştır, sürükle-bırak veya ＋ butonu (resimler otomatik sıkıştırılır, dosyalar 100 MB'a kadar)
- **🎵 Müzik botu**: ses kanalındayken `!play şarkı adı`, `!play YouTube linki` veya `!play Spotify şarkı linki`;
  `!skip`, `!pause`, `!resume`, `!stop`, `!queue`, `!np`, `!remove 2`, `!ses 50` (herkes için bot sesi), `!help`.
  Müzik panelindeki kaydırıcı ve 🔇 düğmesi yalnızca senin duyduğun bot sesini ayarlar. Video gösterilmez: oynatıcı görünmez ve
  1×1 pikseldir, YouTube en düşük video kalitesini seçtiği için ek işlemci/internet yükü neredeyse yoktur. Kanaldaki herkes aynı şarkıyı senkron dinler
  (sonradan katılan doğru saniyeden girer). Herkes gerçek çalma konumunu 2 saniyede bir paylaşır; yavaş yükleyen ya da reklam
  izleyen kişi, şarkısı başlar başlamaz diğerlerine yetişir (fark ~0,1 sn), kimse geri sarılmaz ve aynı yeri iki kez duymaz.
  Her dinleyici şarkıyı kendi tarayıcısındaki resmi YouTube oynatıcısıyla çalar;
  kimsenin bilgisayarı başkası için ses yayınlamaz. Müzik sesi herkesin kendi kontrolündedir
- **Direkt mesajlar (DM)**: üye listesinde birine tıkla → “Mesaj gönder”
- **Sesli sohbet**: yankı engelleme, konuşan kişinin yeşil çerçevesi, sustur/sağırlaştır, bas-konuş (push-to-talk),
  kişi başı ses seviyesi, giriş hassasiyeti
- **🤫 Yapay zekâ gürültü engelleme** (varsayılan açık, Ayarlar → Ses): mikrofon RNNoise 0.2 yapay sinir ağından ve akıllı bir
  ses kapısından geçer. Sen konuşmuyorken mikrofonun tamamen sessizdir: **klavye, fare tıkırtısı, nefes, fan, uğultu** gitmez;
  konuşurken de arka plan gürültüsü silinir. Kendi ses seviyeni öğrenir; senden belirgin biçimde kısık gelen **arka plan
  konuşmalarını** (odadaki başkaları, TV) da keser (ayrı anahtarla kapatılabilir). “Mikrofon testi” ile kendi sesini filtrelenmiş
  hâliyle dinleyebilirsin. Ayrı bir ses iş parçacığında çalışır; susturulmuşken ya da bas-konuş bırakılmışken hiç işlemci harcamaz
- **Kopmaya dayanıklı sesli kanal**: bağlantısı sessizce yenilenen kişinin sesi kendiliğinden yeniden kurulur; ses akışları
  düzenli denetlenir, gitmeyen ya da gelmeyen ses onarılır. Biriyle doğrudan bağlantı kurulamazsa o kişi kanalda 🔗 ile görünür,
  sesi ve mesajları ikinize de bağlı bir arkadaş üzerinden gelir. Habersiz kopan kişi “yeniden bağlanıyor” (⏳) olarak görünür,
  geri gelince giriş/çıkış sesi çalmadan devam eder
- **Görüntülü sohbet**: kamera aç/kapa, tıkla büyüt, tam ekran
- **Ekran paylaşımı**: **Kaynak** (ekranın kendi çözünürlüğü, en net) / 4K / 1440p / 1080p / 720p, 30 / 60 / **120 FPS**, “Oyun/Video” (akıcılık) veya “Yazı/Kod” (netlik) modu,
  **oyun/bilgisayar sesi** (stereo, 192 kbps) ve **yankı koruması**: yayıncının bilgisayarında çalan sohbet sesleri
  yayın sesinden çıkarılır, kimse kendi sesini yayından geri duymaz (oyun sesi bozulmaz),
  izleyici başına ayrı “yayın sesi” seviyesi, yayın sırasında kesintisiz kalite değiştirme, tam ekran ve resim içinde resim,
  kutucukta canlı kalite göstergesi (çözünürlük · FPS · codec · bit hızı)
- **Kalıcı hesap**: hesabın (kimlik, ad, sunucular) tarayıcıda üç ayrı yerde saklanır (localStorage, IndexedDB, çerez);
  biri silinse bile otomatik geri gelir. Ayarlar → Profil → **Hesap yedeği** koduyla başka bilgisayara taşınabilir
- **Bilgisayara yüklenebilir uygulama**: soldaki 💻 butonu veya tarayıcının “Yükle” simgesi; masaüstünden ayrı pencerede açılır
- Mobil uyumlu arayüz

## 💻 Windows uygulaması

**İndir:** https://github.com/aliaskin/konu-mauygulamas-/releases/latest/download/KankaChat-Setup.exe
(kurulumsuz tek dosya: `KankaChat-Portable.exe`, Linux: `KankaChat.AppImage`, hepsi [Releases](https://github.com/aliaskin/konu-mauygulamas-/releases/latest) sayfasında)

Tarayıcının yapamadıklarını ekler:
- **Bas-konuş oyun içindeyken de çalışır**: klavye tuşu veya fare yan tuşu (Ayarlar → Ses → Bas-konuş)
- **Genel kısayol**: oyundayken `Ctrl+Shift+M` mikrofonu aç/kapat (yanlışlıkla basılmasın diye sağırlaştırma kısayolu yok)
- **Kendi ekran seçicisi**: oyun sesi kutucuk işaretlemeden otomatik alınır (Windows), sohbet sesleri yankı korumasıyla temizlenir
- **Müzik botunda YouTube reklamları engellenir** (Ayarlar → Masaüstü'den kapatılabilir). Tarayıcıda engellemek için uBlock Origin eklentisi
- Sistem tepsisi (kapatınca arka planda çalışır), bilgisayar açılınca başlama, görev çubuğunda bahsetme rozeti
- Küçültülünce yavaşlamaz; dizüstülerde yayın için harici ekran kartını kullanır
- **Hep güncel**: arayüz her açılışta web sürümünden yüklenir, yeni özellikler yeniden kurmadan gelir

Kod imzası olmadığı için Windows ilk açılışta “bilinmeyen yayıncı” uyarısı verebilir: **Ek bilgi → Yine de çalıştır**.
Uygulama ayrı bir depolama kullanır; tarayıcıdaki hesabını taşımak için Ayarlar → Profil → **Hesap yedeği** kodunu kullan.
Kaynak: `desktop/` (Electron). Yerelde çalıştırmak için `cd desktop && npm install && npm start`.

## Performans (PC'yi yormaması için)

- Framework yok: saf JavaScript, tek dosya (~155 KB), boşta neredeyse sıfır CPU
- **Donanım kodlama**: tarayıcıya hangi codec'leri ekran kartıyla kodlayıp çözebildiği sorulur (AV1 › VP9 › H.264);
  yayın, hem yayıncının GPU'suyla kodlanabilen hem de izleyicinin GPU'suyla çözülebilen codec ile gönderilir
- Ekran yayını yalnızca **“Yayını İzle”ye basan** kişilere gönderilir (Discord gibi); kimse izlemiyorsa hiç kodlama yapılmaz
- **İzleyiciye göre kalite**: her izleyiciye, yayının onun ekranında kapladığı alanın iki katı netlikte görüntü gider
  (tam ekranda monitörünün çözünürlüğü kadar). 1080p monitöre 4K gönderilmez; ızgaradaki küçük kutucuğa 360p/30,
  alt şeritteki küçük resme 360p/15 gider. İzleyici sohbete geçerse veya sekmeyi kapatırsa o kişi için kodlama tamamen durur
  (ses devam eder), geri dönünce anında devam eder
- **Yük bütçesi**: her izleyici ayrı kodlama demek. Toplam yük bütçeyi aşarsa önce FPS (120→60), sonra çözünürlük kademeli düşürülür;
  donanım kodlayıcı yoksa bütçe daha sıkı uygulanır. Yayıncının kutucuğunda “yük dengeleniyor” yazar
- Yayıncının kendi önizlemesi 15 FPS'lik hafif bir kopyadır; tam kaliteyi kendine göstermek için GPU harcanmaz
- Bit hızı çözünürlük, FPS, codec verimliliği ve içerik türüne göre hesaplanır; ağ ya da işlemci yetmezse tarayıcı otomatik
  düşürür ve kutucukta uyarı gösterilir
- Kamera/ekran için bit hızı ve FPS sınırları; kişi sayısı arttıkça kamera kalitesi otomatik düşer
- Konuşma algılama yalnızca kendi mikrofonunu analiz eder (saniyede 10 kez), başkalarının sesi tekrar işlenmez
- Ses odası görünümü kapalıyken video çözülmez; mesaj listesi sınırlı sayıda öğe çizer
- Ayarlar → Görüntü → **Yayın kalitesi: Düşük** ile en zayıf bilgisayarlarda da çalışır

## Yayınlama (GitHub Pages)

Uygulama GitHub Pages ile `gh-pages` dalından yayınlanır. `src/` altında yapılan her değişiklik
push edildiğinde `.github/workflows/pages.yml` uygulamayı derleyip `gh-pages` dalını otomatik günceller.

HTTPS veren herhangi bir statik barındırma (Netlify, Cloudflare Pages, Vercel…) da olur: tek yapman gereken `docs/index.html` dosyasını yüklemek.

## Nasıl kullanılır

1. Linki aç, kullanıcı adını yaz.
2. Soldaki **＋** ile sunucu oluştur. Açılan pencereden **davet linkini** kopyalayıp arkadaşlarına gönder.
3. Arkadaşların linki açınca sunucuya katılır. Ses kanalına tıklayınca sesli sohbete girersin.
   Alttaki 📷 ve 🖥️ butonları kamerayı ve ekran paylaşımını açar.

## Bilmen gerekenler

- **Müzik botunda isimle arama**: herkese açık YouTube arama sunucuları (Piped/Invidious) kullanılır; bunlar zaman zaman
  çalışmayabilir. En güvenilir yol: sunucu adına tıkla → ⚙️ Sunucu ayarları → **YouTube API anahtarı** (ücretsiz;
  console.cloud.google.com → YouTube Data API v3 → API anahtarı). Bir kişinin girmesi yeter, sunucudaki herkese gider.
  YouTube linkleri anahtarsız da her zaman çalışır. Spotify'dan yalnızca tek şarkı linkleri açılır (şarkı YouTube'da bulunup çalınır).
- **Yankı koruması** sesi yayıncının bilgisayarında temizler: arkadaşların sesi ve izlediği yayınların sesi çıkarılır.
  YouTube oynatıcısının (müzik botu) sesi tarayıcı güvenliği gereği yakalanamaz; müzik çalarken sistem sesini paylaşırsan
  müzik yayında da duyulabilir.

- **Fare imleci**: “Fare imlecini yayında gösterme” açıkken tarayıcıdan imleci yakalamaması istenir. Bunu henüz desteklemeyen
  tarayıcılarda (ör. Chrome 141) oyunda fare ortada görünürse oyunun görüntü modunu **Kenarlıksız / Pencereli tam ekran** yap:
  bu modda oyun imleci kendisi gizler ve yayında da görünmez.
- **Oyun sesi**: paylaşım penceresinde **“Tüm ekran”**ı seçip **“Sistem sesini de paylaş”**ı işaretle (Windows'ta Chrome/Edge).
  Sekme paylaşırken “Sekme sesini de paylaş”. Tarayıcılar tek bir pencere paylaşılırken ses vermez; macOS'ta sistem sesi
  tarayıcı ve işletim sistemi sürümüne bağlıdır.
- Tarayıcı ayarlarından “site verilerini ve çerezleri sil” yapılırsa hesap da silinir; bu yüzden hesap yedek kodunu bir yere kaydet.

- Sunucu olmadığı için mesaj geçmişi herkesin kendi tarayıcısında saklanır ve çevrimiçi olan üyeler arasında eşitlenir.
  Sen yokken yazılan mesajlar, o sırada çevrimiçi olan biri tekrar geldiğinde sana da gelir.
- Eşleşme (birbirini bulma) herkese açık Nostr röleleri üzerinden yapılır; içerik bu rölelerden geçmez.
- Bağlantı doğrudan kurulur. Çok katı ağlarda (bazı mobil operatörler, kurumsal ağlar) iki kişi doğrudan bağlanamayabilir:
  önce herkese açık bir yedek aktarım sunucusu (TURN) denenir; o da olmazsa ses ve mesajlar, ikisine de bağlı bir arkadaş
  üzerinden aktarılır (🔗). Yalnızca iki kişiyseniz ve ikisi de olmazsa başka bir ağ (ev Wi-Fi'ı) dene.
- **Gürültü engelleme** ilk kullanımda 1,4 MB'lık model dosyasını bir kez indirir (sonra önbellekten gelir). Arka plan
  konuşması engeli ses seviyesine bakar: mikrofondan uzaklaşınca sesin kesiliyorsa Ayarlar → Ses'ten bu anahtarı kapat.
- Mesh yapı nedeniyle sesli/görüntülü odalar ~8 kişiye kadar en iyi sonucu verir (arkadaş grubu için ideal).
- Davet kodu sunucunun şifresidir; yalnızca güvendiğin kişilerle paylaş.

## Geliştirme

```sh
npm install
npm run build   # src/ → docs/index.html
npx serve docs  # http://localhost:3000
```

Kaynaklar: `src/main.js` (uygulama), `src/media.js` (codec seçimi, SDP ayarları, yayın bit hızı ve istatistikler), `src/voice.js` (gürültü engelleme ve ses kapısı), `src/echo.js` (yayın sesi yankı koruması), `src/music.js` (müzik botu), `src/style.css` (tema), `src/index.html` (iskelet), `build.mjs` (tek dosyaya paketleme).

Üçüncü taraf bileşenler: gürültü engelleme modeli `public/rnnoise.wasm`, [xiph/rnnoise](https://github.com/xiph/rnnoise) 0.2 (BSD-3-Clause)
ve [jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm) derlemesidir (Apache-2.0); lisans metinleri `public/THIRD_PARTY_NOTICES.txt` dosyasında.
Özel Nostr röleleri için: `index.html?relay=wss://röle1,wss://röle2`. Codec'i zorlamak için: `?codec=AV1` (veya `VP9`, `H264`, `VP8`).
