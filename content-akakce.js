// content-akakce.js
// Bu script sadece arka planda açılan Akakçe sekmelerinde çalışır.

(function () {
    if (window.hasRunAFT) return;
    window.hasRunAFT = true;

    // Mesaj dinleyici
    if (typeof browser === "undefined") {
        var browser = chrome;
    }

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "SCRAPE_AKAKCE_HISTORY") {
            scrapeDataWithHijack().then(data => {
                sendResponse(data);
            });
            return true; // Asenkron yanıt için true dönmeli
        }
    });

    async function scrapeDataWithHijack() {
        // 1. GÜNCEL FİYATI AL (Her durumda lazım)
        let currentPrice = null;
        try {
            // Çoklu selector desteği
            const priceEl = document.querySelector('.pt_v8') || document.querySelector('.price') || document.querySelector('[itemprop="price"]');
            if (priceEl) {
                const text = priceEl.textContent.trim();
                const rawPrice = text.replace(/[^0-9,]/g, '').replace(',', '.');
                if (rawPrice) currentPrice = parseFloat(rawPrice);
            }
        } catch (e) { }

        // 2. ÖNCE KOLAY YOLU DENE: _PRGJ DEĞİŞKENİ (Gelişmiş)
        try {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent;
                if (content && (content.includes('_PRGJ') || content.includes('var _PRGJ'))) {
                    // _PRGJ = '...' veya var _PRGJ = '...'
                    // Bazen tek tırnak bazen çift tırnak
                    const match = content.match(/_PRGJ\s*=\s*(['"])([\s\S]*?)\1/);
                    if (match && match[2]) {
                        console.log("AFT: _PRGJ bulundu.");
                        return { success: true, rawData: match[2], currentPrice: currentPrice, method: "_PRGJ" };
                    }
                }
            }
        } catch (e) { }

        // 3. JSON HIJACKING + CLICK (Zor Yol)
        // Eğer değişken yoksa, grafik verisi lazy-load olabilir.
        // JSON.parse'ı override edecek scripti enjekte ediyoruz.

        console.log("AFT: _PRGJ bulunamadı, JSON Hijacking deneniyor...");

        return new Promise((resolve) => {
            // Zaman aşımı (10 saniye)
            const timeout = setTimeout(() => {
                // Son çare CDN URL taraması (Eğer hijack çalışmadıysa)
                const html = document.documentElement.outerHTML;
                const cdnMatch = html.match(/https?:\/\/[a-z0-9-]+\.akamaized\.net\/[0-9:a-zA-Z\.]+/);
                if (cdnMatch) {
                    // CDN bulduk, fetch edelim
                    fetch(cdnMatch[0]).then(r => r.text()).then(txt => {
                        resolve({ success: true, rawData: txt, currentPrice: currentPrice, method: "CDN_Fallback" });
                    }).catch(() => {
                        resolve({ success: false, error: "Zaman aşımı ve CDN hatası.", currentPrice });
                    });
                } else {
                    resolve({ success: false, error: "Veri bulunamadı (Timeout).", currentPrice });
                }
            }, 10000);

            // Veri yakalandığında çalışacak listener
            const messageHandler = (event) => {
                if (event.source !== window || !event.data) return;

                // 1. Direkt Data Yakalandı (JSON.parse)
                if (event.data.type === 'AKAKCE_HIJACK_DATA') {
                    console.log("AFT: JSON Data Yakalandı!", event.data.payload);
                    clearTimeout(timeout);
                    window.removeEventListener("message", messageHandler);

                    resolve({
                        success: true,
                        directData: event.data.payload,
                        currentPrice: currentPrice,
                        method: "Hijack"
                    });
                }

                // 2. CDN URL Yakalandı (Performance API)
                if (event.data.type === 'AKAKCE_CDN_FOUND') {
                    console.log("AFT: CDN URL Yakalandı, Background'a iletiliyor...", event.data.url);
                    // CORS yüzünden burada fetch edemiyoruz. URL'i background'a gönderelim.
                    clearTimeout(timeout);
                    window.removeEventListener("message", messageHandler);
                    resolve({
                        success: true,
                        cdnUrl: event.data.url,
                        currentPrice: currentPrice,
                        method: "CDN_Via_Perf"
                    });
                }
            };
            window.addEventListener("message", messageHandler);

            // Interceptor Script Enjeksiyonu ve Kontrol
            const script = document.createElement('script');
            script.src = browser.runtime.getURL('src/akakce_hijack.js');
            script.onload = function () { this.remove(); };
            (document.head || document.documentElement).appendChild(script);

            // "Fiyat Geçmişi" Butonu Kontrolü ve Tetikleme
            const checkForGraphAndClick = () => {
                const btn = document.querySelector("#PGM2_C");
                let found = false;

                if (btn) {
                    btn.click();
                    console.log("AFT: Butona (#PGM2_C) tıklandı.");
                    found = true;
                } else {
                    const spans = document.querySelectorAll('span, b, a, div');
                    for (let s of spans) {
                        if (s.textContent === 'Fiyat Geçmişi' || s.innerText === 'Fiyat Geçmişi') {
                            s.click();
                            console.log("AFT: 'Fiyat Geçmişi' elementine tıklandı.");
                            found = true;
                            break;
                        }
                    }
                }

                // Eğer buton yoksa ve zaten fiyatı bulduysak, boşuna 10sn bekleme!
                if (!found && currentPrice) {
                    console.log("AFT: Grafik butonu bulunamadı, hızlı çıkış yapılıyor.");
                    clearTimeout(timeout);
                    window.removeEventListener("message", messageHandler);
                    resolve({
                        success: false, // Grafik başarısız
                        error: "Grafik Verisi Yok (Hızlı Çıkış)",
                        currentPrice: currentPrice,
                        partial: true // Partial flag
                    });
                }
            };

            // Biraz bekle (1sn) sonra kontrol et
            setTimeout(checkForGraphAndClick, 1000);
        });
    }
})();
