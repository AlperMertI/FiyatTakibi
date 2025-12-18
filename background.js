// background.js
import { saveToDB, removeFromDB, getAllFromSync, saveToSync, getProductFromDB, getAllFromDB } from "./storage.js";
import { checkPrices } from "./price.js";
import { updateProductPrice } from "./update.js";
import { decodePriceData } from "./src/akakce_decoder.js";

// --- AKAKÇE KUYRUK YÖNETİMİ ---
const akakceQueue = [];
let isProcessingAkakce = false;

function processAkakceQueue() {
  if (isProcessingAkakce || akakceQueue.length === 0) return;

  isProcessingAkakce = true;
  const item = akakceQueue.shift();
  const { message, sendResponse, beforeStart } = item;

  if (beforeStart) beforeStart();

  console.log(`AFT (BG): Kuyruktan işlem başlıyor: ${message.productName}`);

  performAkakceScrape(message)
    .then(response => {
      sendResponse(response);
    })
    .catch(err => {
      sendResponse({ success: false, error: err.message });
    })
    .finally(() => {
      // 3 Saniye Bekle (Rate Limit / Sekme Karmaşasını Önleme)
      console.log("AFT (BG): Sonraki işlem için 15-20 saniye bekleniyor (Anti-Bot)...");
      const randomDelay = Math.floor(Math.random() * 5000) + 15000;
      setTimeout(() => {
        if (updateState.isPaused) {
          // Wait for resume...
          const checkResume = setInterval(() => {
            if (!updateState.isPaused || !updateState.isUpdating) {
              clearInterval(checkResume);
              if (updateState.isUpdating) {
                isProcessingAkakce = false;
                processAkakceQueue();
              }
            }
          }, 1000);
          return;
        }
        isProcessingAkakce = false;
        processAkakceQueue();

        if (typeof updateState !== 'undefined' && updateState.isUpdating) {
          updateState.akakceQueueSize = akakceQueue.length;
          browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
        }
      }, randomDelay);
    });
}

function performAkakceScrape(message) {
  const productName = message.productName;
  return searchAkakce(productName)
    .then(productUrl => {
      console.log(`AFT (BG): Ürün bulundu, URL: ${productUrl}`);
      return createAkakceTabPromise(productUrl).then(data => ({ data, productUrl }));
    })
    .then(async ({ data, productUrl }) => {
      console.log("AFT (BG): Akakçe verisi başarıyla alındı (Ham).");
      if (data && data.success) {
        let finalData = null;

        try {
          if (data.directData) {
            console.log("AFT (BG): Hijacked verisi alındı, formatlanıyor...");
            finalData = formatHijackedData(data.directData);
          } else if (data.cdnUrl) {
            console.log("AFT (BG): CDN URL alındı, fetch yapılıyor:", data.cdnUrl);
            try {
              const cdnRes = await fetch(data.cdnUrl);
              if (cdnRes.ok) {
                const txt = await cdnRes.text();
                try {
                  const json = JSON.parse(txt);
                  finalData = formatHijackedData(json);
                } catch (e) {
                  console.log("AFT (BG): CDN verisi Text/JS formatında. Temizleniyor...");
                  let cleanedTxt = txt;
                  const match = txt.match(/_PRGJ\s*=\s*['"]([^'"]+)['"]/);
                  if (match && match[1]) cleanedTxt = match[1];
                  finalData = decodePriceData(cleanedTxt);
                }
              } else {
                throw new Error("CDN Fetch Failed: " + cdnRes.status);
              }
            } catch (fetchErr) {
              console.error("AFT (BG): CDN Fetch Hatası:", fetchErr);
              throw fetchErr;
            }
          } else if (data.rawData) {
            console.log("AFT (BG): Raw String verisi alındı, decode ediliyor...");
            finalData = decodePriceData(data.rawData);
          }

          if (finalData) {
            return { success: true, data: finalData, currentPrice: data.currentPrice, productUrl: productUrl };
          } else {
            return { success: false, error: "Veri formatlanamadı." };
          }
        } catch (e) {
          console.error("AFT (BG): Veri işleme hatası:", e);
          return { success: false, error: "Veri işlenemedi: " + e.message };
        }
      } else {
        return { ...data, productUrl: productUrl };
      }
    });
}


// --- AKAKÇE KUYRUK YÖNETİMİ FONKSİYONLARI ---

function createAkakceTabPromise(url) {
  return new Promise((resolve, reject) => {
    let tabId = null;
    let timeoutId = null;

    // Failsafe (45 sn)
    timeoutId = setTimeout(() => {
      if (tabId) browser.tabs.remove(tabId).catch(() => { });
      reject(new Error("Akakçe kazıma zaman aşımı (45s)"));
    }, 45000);

    browser.tabs.create({ url: url, active: false }).then(tab => {
      tabId = tab.id;

      const updateListener = (tId, changeInfo, t) => {
        if (tId !== tabId) return;

        // Herhangi bir başlık veya durum değişiminde Cloudflare kontrolü yap
        const title = t.title || "";
        if (title.includes("Cloudflare") || title.includes("Just a moment") || title.includes("şimdi doğrulayın") || title.includes("Verify")) {
          console.warn("AFT (BG): Akakçe engeli tespit edildi. Pencere ve Sekme öne alınıyor...");
          if (t.windowId) {
            browser.windows.update(t.windowId, { focused: true }).catch(() => { });
          }
          browser.tabs.update(tabId, { active: true }).catch(() => { });
          return;
        }

        if (changeInfo.status === 'complete') {
          browser.tabs.onUpdated.removeListener(updateListener);

          browser.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content-akakce.js"]
          }).then(() => {
            console.log("AFT (BG): Content script manuel inject edildi.");
            startMessaging();
          }).catch(err => {
            console.warn("AFT (BG): Script injection failed:", err);
            startMessaging();
          });

          function startMessaging() {
            let attempts = 0;
            const maxAttempts = 10;
            const sendScrapeMessage = () => {
              if (!updateState.isUpdating) {
                clearTimeout(timeoutId);
                browser.tabs.remove(tabId).catch(() => { });
                return;
              }
              browser.tabs.sendMessage(tabId, { type: "SCRAPE_AKAKCE_HISTORY" })
                .then(response => {
                  clearTimeout(timeoutId);
                  browser.tabs.remove(tabId).catch(() => { });
                  resolve(response || { success: false, error: "Boş yanıt" });
                })
                .catch(err => {
                  attempts++;
                  if (attempts < maxAttempts) setTimeout(sendScrapeMessage, 1500);
                  else {
                    clearTimeout(timeoutId);
                    browser.tabs.remove(tabId).catch(() => { });
                    reject(new Error("İçerik betiği yanıt vermiyor"));
                  }
                });
            };
            setTimeout(sendScrapeMessage, 1000);
          }
        }
      };

      browser.tabs.onUpdated.addListener(updateListener);
    });
  });
}

function formatHijackedData(hijacked) {
  // Beklenen Çıktı: [{tarih: "DD.MM.YYYY", fiyat: 123.45}]
  // Girdi 1: { d: ["2024-01-01", ...], y: [100, ...] }
  // Girdi 2: [[timestamp, price], ...]

  const result = [];

  try {
    if (Array.isArray(hijacked)) {
      // [[ts, price], ...] formatı
      // Timestamp ms veya s olabilir. 2023 yılı ~1.6 milyar saniye.

      hijacked.forEach(item => {
        let ts = item[0];
        const price = item[1];

        // Eğer saniye cinsindense (örn 167... - 10 hane), ms yap (13 hane)
        if (ts < 100000000000) ts *= 1000;

        const date = new Date(ts);
        const dateStr = date.toLocaleDateString("tr-TR"); // "DD.MM.YYYY"
        // Content chart "." istiyor olabilir veya tarih objesi kuruyordur.
        // Content chart: new Date(d.tarih) diyor. O zaman ISO formatı daha güvenli: YYYY-MM-DD
        // Ancak tr-TR formatı "DD.MM.YYYY" dönerse new Date("31.12.2023") bazı tarayıcılarda çalışır bazılarıında çalışmaz.
        // decodePriceData fonksiyonu "DD-MM-YYYY" string dönüyor.
        // Biz de aynı formatı koruyalım veya ISO kullanalım. content chart "new Date(d.tarih)" kullanıyor.
        // "YYYY-MM-DD" en garantisidir.

        const isoDate = date.toISOString().split('T')[0];
        result.push({ tarih: isoDate, fiyat: price });
      });
    } else if (typeof hijacked === 'object' && hijacked.d && hijacked.y) {
      // { d: [...], y: [...] }
      // d dizisi genellikle string tarih içerir ("2023-01-01")
      const dates = hijacked.d;
      const prices = hijacked.y;

      for (let i = 0; i < dates.length; i++) {
        // Tarih formatı "2023-01-01" ise dokunma
        // "01-01-2023" ise çevir... Genellikle YYYY-MM-DD gelir.
        result.push({ tarih: dates[i], fiyat: prices[i] });
      }
    }
  } catch (e) {
    console.error("Hijack formatlayıcı hatası:", e);
  }
  return result;
}

function searchAkakce(productName) {
  return new Promise((resolve, reject) => {
    const searchUrl = `https://www.akakce.com/arama/?q=${encodeURIComponent(productName)}`;
    let tabId = null;

    // Sekme oluştur
    browser.tabs.create({ url: searchUrl, active: false }).then(tab => {
      tabId = tab.id;

      // Script inject et (sonucu bulmak için)
      browser.tabs.onUpdated.addListener(function updateListener(tId, changeInfo, t) {
        if (tId === tabId && changeInfo.status === 'complete') {
          browser.tabs.onUpdated.removeListener(updateListener);

          browser.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
              // En iyi eşleşmeyi bul
              // Redirect linklerinden (/c/ veya ?z=) kaçın ve gerçek ürün linki (.html) bulmaya çalış
              const items = document.querySelectorAll('ul#APL li a, .search-results li a');
              let bestUrl = null;

              for (let item of items) {
                const href = item.href;
                // Reklam veya kategori linki olmayan, doğrudan ürün linki (.html ile biten veya standart format)
                if (href && !href.includes('/c/?') && !href.includes('?z=') && href.includes('.html')) {
                  bestUrl = href;
                  break;
                }
              }

              // Eğer filtreli bulamazsak yine de ilkini dön (fallback)
              if (!bestUrl && items.length > 0) bestUrl = items[0].href;

              return bestUrl;
            }
          }).then(results => {
            const url = results[0].result;
            browser.tabs.remove(tabId);
            if (url) resolve(url);
            else reject(new Error("Ürün bulunamadı"));
          }).catch(err => {
            if (tabId) browser.tabs.remove(tabId);
            reject(err);
          });
        }
      });
    });
  });
}


if (typeof browser === "undefined") {
  var browser = chrome;
}

let creating; // 'offscreen' belgesi oluşturulurken oluşabilecek race condition'ı engeller

// 'offscreen' belgesini başlatan fonksiyon (SADECE SES İÇİN)
async function setupOffscreenDocument(path) {
  if (await browser.offscreen.hasDocument()) {
    return;
  }
  if (creating) {
    await creating;
  } else {
    try {
      creating = browser.offscreen.createDocument({
        url: path,
        reasons: ['AUDIO_PLAYBACK'], // Sadece ses izni
        justification: 'Bildirim sesi çalmak için',
      });
      await creating;
    } catch (error) {
      console.error("Offscreen belgesi oluşturulamadı:", error.message);
    } finally {
      creating = null;
    }
  }
}

// Sessiz sekme açar, fiyatı bekler, sekmeyi kapatır ***
export function createTabPromise(product) {
  return new Promise((resolve, reject) => {
    let tabId = null;
    let timeoutId = null;

    // 1. Geçici mesaj dinleyicisi
    // Sadece bu işlem için özel bir dinleyici oluşturuyoruz
    const messageListener = (msg, sender) => {
      // Mesajın 'hb_price_found' olduğundan, bu sekmeden geldiğinden
      // ve doğru ürüne ait olduğundan emin ol
      if (msg.action === "hb_price_found" && sender.tab.id === tabId && msg.productId === product.id) {

        console.log(`AFT (BG): ${product.id} için fiyat alındı: ${msg.price}`);

        clearTimeout(timeoutId); // Zaman aşımını temizle
        browser.runtime.onMessage.removeListener(messageListener); // Dinleyiciyi kaldır
        browser.tabs.remove(tabId); // Sekmeyi kapat

        // update.js'ye sonucu döndür
        resolve({ price: msg.price, status: msg.status, picUrl: msg.picUrl, name: msg.name });
      }
    };

    browser.runtime.onMessage.addListener(messageListener);

    // 2. Sekmeyi oluştur (aktif olmadan)
    // Önce uygun bir pencere bul
    browser.windows.getAll({ windowTypes: ['normal'] })
      .then(windows => {
        let createProps = { url: product.url, active: false };
        if (windows.length > 0) {
          // Varsa ilk normal pencereyi kullan (odaklanmış olması tercih edilir ama şart değil)
          // Son odaklanana göre sıralama garantisi yok ama genellikle bir tane vardır.
          // Listenin sonuncusu genellikle son aktif olandır Chrome'da ama garanti değil.
          // Basitçe ilkini alıyoruz.
          const focused = windows.find(w => w.focused);
          createProps.windowId = focused ? focused.id : windows[0].id;
        }
        // Pencere yoksa windowId eklemiyoruz, bu durumda "No current window" hatası devam edebilir
        // ama kullanıcı tarayıcıyı tamamen kapattıysa zaten yapacak bir şey yok (headless çalışmıyoruz).

        return browser.tabs.create(createProps);
      })
      .then(tab => {
        tabId = tab.id;

        // 3. Failsafe: 30 saniye içinde cevap gelmezse
        timeoutId = setTimeout(() => {
          browser.runtime.onMessage.removeListener(messageListener);
          if (tabId) browser.tabs.remove(tabId);
          console.warn(`AFT (BG): ${product.id} için kazıma zaman aşımına uğradı.`);
          reject(new Error("Zaman aşımı (30s)"));
        }, 30000); // 30 saniye

      })
      .catch(err => {
        browser.runtime.onMessage.removeListener(messageListener);
        reject(err);
      });
  });
}


// --- GÜNCELLEME DURUMU YÖNETİMİ ---
let updateState = {
  isUpdating: false,
  isPaused: false,
  phase: "idle", // 'idle', 'amazon', 'hb', 'akakce'
  processedCount: 0,
  totalCount: 0,
  akakceQueueSize: 0,
  processedIds: [],
  processingIds: [], // Şu an işlenenler
  queueIds: []       // Sırada bekleyenler
};

// Yardımcı: Akakçe Yanıtını İşle ve Kaydet
async function handleAkakceResponse(product, response) {
  if (response && (response.success || response.partial)) {
    let changed = false;
    let newAkakceUrl = null;

    if (response.productUrl && response.productUrl !== product.akakceUrl) {
      newAkakceUrl = response.productUrl;
      changed = true;
    }

    let newHistory = product.akakceHistory || [];
    if (response.data && response.data.length > 0) {
      newHistory = response.data;
      changed = true;
    } else if (response.currentPrice) {
      const todayStr = new Date().toISOString().split('T')[0];
      const numericPrice = typeof response.currentPrice === 'string' ?
        parseFloat(response.currentPrice.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '')) :
        response.currentPrice;

      const lastEntry = newHistory[newHistory.length - 1];
      if (lastEntry && (lastEntry.tarih || lastEntry.date || "").startsWith(todayStr)) {
        lastEntry.fiyat = numericPrice;
      } else {
        newHistory.push({ tarih: todayStr, fiyat: numericPrice });
      }
      changed = true;
    }

    const updates = { id: product.id, lastAkakceFetch: new Date().toISOString() };
    if (newAkakceUrl) updates.akakceUrl = newAkakceUrl;
    if (newHistory) updates.akakceHistory = newHistory;
    await saveToDB([updates]);

    if (changed) {
      const lastPrice = newHistory.length > 0 ? newHistory[newHistory.length - 1].fiyat : "N/A";
      console.log(`AFT (BG): Akakçe verisi güncellendi: ${product.name} | Yeni Fiyat: ${lastPrice} TL`);
    } else {
      console.log(`AFT (BG): Akakçe verisi değişmedi veya bulunamadı: ${product.name}. Zaman damgası güncellendi.`);
    }
  } else {
    // Başarısız olsa bile zaman damgasını güncelle ki 24 saat boyunca tekrar denemesin (bot koruması için)
    await saveToDB([{ id: product.id, lastAkakceFetch: new Date().toISOString() }]);
    console.log(`AFT (BG): Akakçe taraması başarısız veya veri yok: ${product.name}. Başarısız deneme kaydedildi.`);
  }
}

function monitorAkakceQueue() {
  const interval = setInterval(() => {
    updateState.akakceQueueSize = akakceQueue.length + (isProcessingAkakce ? 1 : 0);

    if (updateState.phase === 'akakce' && updateState.akakceQueueSize === 0 && !isProcessingAkakce) {
      console.log("AFT: Tüm güncellemeler tamamlandı.");
      updateState.isUpdating = false;
      updateState.phase = "idle";
      browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
      clearInterval(interval);
    }
  }, 1000);
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Amazon (ve HB) için IndexedDB kayıtları
  if (message.action === "saveToDB") {
    saveToDB(message.order)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (message.action === "removeFromDB") {
    removeFromDB(message.id)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === "GET_UPDATE_STATUS") {
    // Akakçe kuyruk boyutunu güncelle (anlık)
    updateState.akakceQueueSize = akakceQueue.length + (isProcessingAkakce ? 1 : 0);
    sendResponse({ state: updateState });
    return false;
  }

  if (message.action === "TOGGLE_PAUSE_UPDATE") {
    updateState.isPaused = !updateState.isPaused;
    console.log(`AFT (BG): Güncelleme ${updateState.isPaused ? 'DURAKLATILDI' : 'DEVAM ETTİRİLDİ'}.`);
    browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
    sendResponse({ success: true, isPaused: updateState.isPaused });
    return false;
  }

  if (message.action === "STOP_UPDATE") {
    console.log("AFT (BG): Güncelleme DURDURULUYOR...");
    updateState.isUpdating = false;
    updateState.isPaused = false;
    updateState.phase = "idle";
    akakceQueue = [];
    browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
    sendResponse({ success: true });
    return false;
  }

  // options.js'den gelen anlık güncelleme talebi

  // --- GÜNCELLEME DURUMU YÖNETİMİ ---
  if (message.action === "START_FULL_UPDATE") {
    if (updateState.isUpdating) {
      sendResponse({ success: false, message: "Güncelleme zaten devam ediyor." });
      return false;
    }

    console.log("AFT (BG): Tam güncelleme başlatılıyor...");

    (async () => {
      try {
        const [allProducts, dbProducts] = await Promise.all([getAllFromSync(), getAllFromDB()]);
        const dbMap = new Map(dbProducts.map(p => [p.id, p]));
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

        const amazonItems = allProducts.filter(p => p.platform !== 'HB');
        const hbItems = allProducts.filter(p => p.platform === 'HB');

        // Helper: Akakçe güncellenmeli mi?
        const checkShouldUpdateAkakce = (p) => {
          const hasUrl = !!p.akakceUrl;
          if (!hasUrl && p.platform === 'HB') return false;

          const dbP = dbMap.get(p.id);
          const lastFetch = dbP?.lastAkakceFetch;

          // Eğer hiç taranmadıysa (lastFetch yoksa) mutlaka tara
          if (!lastFetch) return true;

          const lastFetchDate = new Date(lastFetch);
          // 24 saat kuralı (lastAkakceFetch üzerinden)
          return lastFetchDate < oneDayAgo;
        };

        const akakceItems = allProducts.filter(checkShouldUpdateAkakce);
        const totalSteps = amazonItems.length + hbItems.length + akakceItems.length;

        updateState = {
          isUpdating: true,
          phase: "amazon",
          processedCount: 0,
          totalCount: totalSteps,
          akakceQueueSize: 0,
          processedIds: [],
          processingIds: [],
          queueIds: allProducts.map(p => p.id)
        };

        console.log(`AFT (BG): Toplam ${allProducts.length} ürün, ${totalSteps} işlem adımı belirlendi.`);
        console.log(`AFT (BG): Akakçe aşamasına ${akakceItems.length} ürün dahil edildi.`);
        browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });

        // PHASE 1: AMAZON
        console.log(`AFT (BG): Phase 1 (Amazon) başlıyor...`);
        await checkPrices({
          filter: p => p.platform !== 'HB',
          onProductProcessStart: (product) => {
            if (!updateState.isUpdating) return;
            updateState.processingIds.push(product.id);
            updateState.queueIds = updateState.queueIds.filter(id => id !== product.id);
            browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
          },
          onProductProcessed: (product) => {
            if (!updateState.isUpdating) return;
            updateState.processedCount++;
            updateState.processingIds = updateState.processingIds.filter(id => id !== product.id);
            browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
          }
        });

        if (!updateState.isUpdating) return;

        // PAUSE Check
        while (updateState.isPaused && updateState.isUpdating) {
          await new Promise(r => setTimeout(r, 1000));
        }
        if (!updateState.isUpdating) return;

        // PHASE 2: HEPSIBURADA
        updateState.phase = "hb";
        console.log(`AFT (BG): Phase 2 (HB) başlıyor...`);
        browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });

        await checkPrices({
          filter: p => p.platform === 'HB',
          onProductProcessStart: (product) => {
            if (!updateState.isUpdating) return;
            updateState.processingIds.push(product.id);
            updateState.queueIds = updateState.queueIds.filter(id => id !== product.id);
            browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
          },
          onProductProcessed: (product) => {
            if (!updateState.isUpdating) return;
            updateState.processedCount++;

            // Akakçe fazında işlenmeyecekse bitti sayılır
            if (!checkShouldUpdateAkakce(product)) {
              updateState.processedIds.push(product.id);
            }

            updateState.processingIds = updateState.processingIds.filter(id => id !== product.id);
            browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
          }
        });

        if (!updateState.isUpdating) return;

        // Amazon bittikten sonra ama Akakçe'ye girmeyecekleri işaretle
        allProducts.forEach(p => {
          if (p.platform !== 'HB' && !updateState.processedIds.includes(p.id)) {
            if (!checkShouldUpdateAkakce(p)) {
              updateState.processedIds.push(p.id);
            }
          }
        });

        // PAUSE Check
        while (updateState.isPaused && updateState.isUpdating) {
          await new Promise(r => setTimeout(r, 1000));
        }
        if (!updateState.isUpdating) return;

        // PHASE 3: AKAKÇE
        updateState.phase = "akakce";
        console.log(`AFT (BG): Phase 3 (Akakçe) başlıyor...`);

        akakceItems.forEach(product => {
          const hasAkakceUrl = !!product.akakceUrl;
          const requestItem = {
            message: hasAkakceUrl ?
              { action: "SCRAPE_AKAKCE_HISTORY", url: product.akakceUrl, productName: product.name } :
              { action: "SEARCH_AND_SCRAPE_AKAKCE_HISTORY", productName: product.name, priority: false },
            beforeStart: () => {
              if (!updateState.isUpdating) return false;
              updateState.processingIds.push(product.id);
              browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
              return true;
            },
            sendResponse: (response) => {
              if (!updateState.isUpdating) return;
              handleAkakceResponse(product, response).then(() => {
                updateState.processedCount++;
                updateState.processedIds.push(product.id);
                updateState.processingIds = updateState.processingIds.filter(id => id !== product.id);
                updateState.akakceQueueSize = akakceQueue.length;
                browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
              });
            }
          };
          akakceQueue.push(requestItem);
        });

        updateState.akakceQueueSize = akakceQueue.length;
        browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });

        processAkakceQueue();
        monitorAkakceQueue();

      } catch (error) {
        console.error("AFT (BG): Güncelleme hatası!", error);
        updateState.isUpdating = false;
        updateState.phase = "error";
        browser.runtime.sendMessage({ action: "UPDATE_STATUS", state: updateState }).catch(() => { });
      }
    })();

    sendResponse({ success: true, message: "Güncelleme başlatıldı." });
    return false;
  }


  // Content script'lerden (Amazon ve HB) gelen 'getAllFromSync' talebi
  if (message.action === "getAllFromSync") {
    getAllFromSync()
      .then(products => sendResponse({ success: true, data: products }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Content script'lerden (Amazon ve HB) gelen 'hb_getProduct' (tekil ürün) talebi
  if (message.action === "hb_getProduct") {
    getAllFromSync(message.id) // getAllFromSync (storage.js) ID ile çağrılınca tek ürün getirir
      .then(product => sendResponse({ success: true, data: product }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // HB ARKA PLAN KAZIMA İSTEĞİ ***
  if (message.action === "hb_run_background_scrape") {
    const product = message.product;

    createTabPromise(product)
      .then(priceData => {
        // priceData = { price, status, picUrl }
        sendResponse({ success: true, data: priceData });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message, data: { price: null, status: "‼️", picUrl: null } });
      });
    return true; // Asenkron
  }

  // --- LOCAL DB READ ---
  if (message.action === "GET_PRODUCT_DATA") {
    getProductFromDB(message.id)
      .then(product => sendResponse({ success: true, product: product }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // AKAKÇE FİYAT GEÇMİŞİ KAZIMA (SCRAPE_AKAKCE_HISTORY) ***
  if (message.action === "SCRAPE_AKAKCE_HISTORY") {
    const akakceUrl = message.url;
    createAkakceTabPromise(akakceUrl)
      .then(data => sendResponse(data))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Asenkron
  }

  // AKAKÇE ARA VE KAZI (SEARCH_AND_SCRAPE_AKAKCE_HISTORY)
  if (message.action === "SEARCH_AND_SCRAPE_AKAKCE_HISTORY") {
    console.log(`AFT (BG): Akakçe isteği kuyruğa eklendi: ${message.productName} (Öncelik: ${message.priority})`);

    // Kuyruğa ekle
    const requestItem = {
      message: message,
      sendResponse: sendResponse
    };

    if (message.priority) {
      akakceQueue.unshift(requestItem); // Öncelikli ise başa ekle
    } else {
      akakceQueue.push(requestItem);
    }

    processAkakceQueue();
    return true; // Asenkron yanıt vereceğiz
  }



  // MAIN WORLD'da Highcharts kontrolü (Lazy Load için)
  if (message.action === "CHECK_HIGHCHARTS_READY") {
    browser.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: () => {
        return !!(window.Highcharts && window.Highcharts.charts);
      }
    })
      .then(results => {
        const ready = (results && results[0]) ? results[0].result : false;
        sendResponse({ ready: ready });
      })
      .catch(() => sendResponse({ ready: false }));
    return true;
  }

  // MAIN WORLD'da Highcharts ve Veri Çıkarma
  if (message.action === "EXTRACT_HIGHCHARTS_DATA") {
    browser.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: () => {
        try {
          let data = null;

          // Yöntem 1: Global Highcharts
          if (window.Highcharts && window.Highcharts.charts) {
            const validCharts = window.Highcharts.charts.filter(c => c);
            if (validCharts.length > 0) {
              // En çok veriye sahip grafiği bul
              const bestChart = validCharts.reduce((prev, current) => {
                const prevLen = (prev.series && prev.series[0] && prev.series[0].data) ? prev.series[0].data.length : 0;
                const currLen = (current.series && current.series[0] && current.series[0].data) ? current.series[0].data.length : 0;
                return (currLen > prevLen) ? current : prev;
              });

              if (bestChart && bestChart.series && bestChart.series[0]) {
                data = bestChart.series[0].data.map(p => ({ date: p.x, price: p.y }));
              }
            }
          }

          // Yöntem 2: DOM Elementi Üzerinden (jQuery veya Highcharts expando)
          if (!data) {
            const cs = document.querySelector('#cs');
            // Bazı sitelerde (akakçe gibi) highcharts verisi elemente bağlı olabilir
            if (cs && cs.highcharts) { // Eğer jQuery plugini varsa
              const chart = cs.highcharts(); // Bu fonksiyon olmayabilir
              if (chart && chart.series && chart.series[0]) {
                data = chart.series[0].data.map(p => ({ date: p.x, price: p.y }));
              }
            }
          }

          if (data) return { success: true, data: data };

          // Yöntem 3: Hiçbir şey bulunamadıysa, ekrandaki özeti kazı (Fallback)
          // Örn: "6 Ay›n En Düşüğü: 296 TL"
          const summary = {};
          const stats = document.querySelectorAll('.graphs-w li, .graphs-w b');
          stats.forEach(el => {
            const text = el.innerText;
            if (text.includes("En Düşük")) summary.low = text.replace(/[^0-9,]/g, '') + " TL";
            if (text.includes("En Yüksek")) summary.high = text.replace(/[^0-9,]/g, '') + " TL";
          });

          return { error: "Highcharts objesi bulunamadı", debug: "DOM Scrape", summary: summary };

        } catch (e) {
          return { error: e.toString(), debug: "Script Error" };
        }
      }
    })
      .then(results => {
        if (results && results[0] && results[0].result) {
          sendResponse(results[0].result);
        } else {
          sendResponse({ error: "Script boş döndü." });
        }
      })
      .catch(err => {
        sendResponse({ error: err.message });
      });
    return true;
  }



  // URL'DEN ÜRÜN EKLEME
  if (message.action === "addNewProductFromUrl") {
    const { url, id, platform } = message;

    (async () => {
      try {
        const products = await getAllFromSync();

        // 1. Zaten var mı kontrol et
        if (products.some(p => p.id === id)) {
          sendResponse({ success: false, message: "Bu ürün zaten takip listenizde." });
          return;
        }

        // 2. Limiti kontrol et (storage.js'den MAX_ITEMS'ı alamadığımız için 100 varsayıyoruz)
        const MAX_ITEMS = 100;
        if (products.length >= MAX_ITEMS) {
          sendResponse({ success: false, message: `Takip limiti (${MAX_ITEMS}) doldu.` });
          return;
        }

        // 3. Ürün bilgilerini çekmek için updateProductPrice'ı çağır
        const partialProduct = { id, url, platform };
        // needsImageUpdate = true, görselin mutlaka çekilmesini sağlar
        const updatedProduct = await updateProductPrice(partialProduct, true);

        // 4. Bilgi çekilebildi mi kontrol et
        if (updatedProduct.status === "‼️" || !updatedProduct.name) {
          sendResponse({ success: false, message: "Ürün bilgileri alınamadı. Sayfa yapısı değişmiş olabilir." });
          return;
        }

        // 5. Ürünü oluştur ve kaydet
        const date = new Date().toLocaleDateString("tr-TR");

        // Sync'e kaydedilecek temel veri
        const newSyncItem = {
          id: updatedProduct.id,
          name: updatedProduct.name,
          url: updatedProduct.url,
          platform: updatedProduct.platform,
          group: "",
          oldPrice: updatedProduct.newPrice, // Bulunan ilk fiyat 'oldPrice'a yazılır
          newPrice: null,
          status: null // Durum sıfırlanır
        };

        products.push(newSyncItem);
        await saveToSync(products); // Sync'i güncelle

        // DB'ye tam veriyi kaydet (sıra no, resim vs.)
        await saveToDB([{
          id: updatedProduct.id,
          no: products.length, // Son sıra
          date: date,
          pic: null, // pic (base64) artık kullanmıyoruz
          picUrl: updatedProduct.picUrl,
          name: updatedProduct.name,
          group: ""
        }]);

        sendResponse({ success: true, message: "Ürün başarıyla eklendi." });

      } catch (error) {
        console.error("addNewProductFromUrl hatası:", error);
        sendResponse({ success: false, message: `Hata: ${error.message}` });
      }
    })();

    return true; // Asenkron yanıt için gereklidir
  }

  // ESKİ HB KAZIMA İLE İLGİLİ TÜM LİSTENER'LAR KALDIRILDI
});

// --- BİLDİRİM TIKLAMA OLAYI (PERSISTENT) ---
browser.notifications.onClicked.addListener((notificationId) => {
  // notificationId formatları: "stock_ID", "discount_ID", "priceIncrease_ID"
  let productId = null;

  if (notificationId.startsWith("stock_")) {
    productId = notificationId.replace("stock_", "");
  } else if (notificationId.startsWith("discount_")) {
    productId = notificationId.replace("discount_", "");
  } else if (notificationId.startsWith("priceIncrease_")) {
    productId = notificationId.replace("priceIncrease_", "");
  }

  if (productId) {
    getAllFromSync(productId)
      .then((product) => {
        if (product && product.url) {
          browser.tabs.create({ url: product.url });
        } else {
          console.warn(`AFT: Bildirim tıklandı ama ürün bulunamadı (ID: ${productId})`);
        }
      })
      .catch((err) => console.error("AFT: Bildirim tıklama hatası:", err));
  }
});


browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.hasOwnProperty("settings")) {
    if (!changes.settings.newValue) {
      const defaultSettings = getDefaultSettings();
      browser.storage.sync.set({ settings: defaultSettings }).then(() => {
        console.log("Varsayılan ayarlar geri yüklendi.");
        schedulePriceCheck(defaultSettings);
      });
    } else {
      console.log("Ayarlar değişti:", changes.settings.newValue);
      applySettings(changes.settings.newValue);
    }
  }
});

browser.runtime.onInstalled.addListener(async () => {
  console.log("Eklenti yüklendi.");
  const settings = (await browser.storage.sync.get("settings")).settings || getDefaultSettings();
  if (settings.priceCheckInterval !== "0") {
    initializeSettings();
  }
});

browser.runtime.onStartup.addListener(async () => {
  console.log("Tarayıcı yeniden başlatıldı.");
  const settings = (await browser.storage.sync.get("settings")).settings || getDefaultSettings();
  if (settings.priceCheckInterval !== "0") {
    initializeSettings();
    checkPrices({});
  }
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "priceCheckAlarm") {
    checkPrices({});
  }
});

async function initializeSettings() {
  const defaultSettings = getDefaultSettings();
  const data = await browser.storage.sync.get("settings");
  if (!data.settings) {
    await browser.storage.sync.set({ settings: defaultSettings });
    console.log("Varsayılan ayarlar yüklendi.");
    schedulePriceCheck(defaultSettings);
  } else {
    console.log("Ayarlar yüklendi.");
    schedulePriceCheck(data.settings);
  }
}

function schedulePriceCheck(settings) {
  if (settings) {
    browser.alarms.clear("priceCheckAlarm");
    if (settings.priceCheckInterval === "0") {
      console.log("Fiyat kontrolü devre dışı bırakıldı.");
      return;
    }
    console.log(`Fiyat kontrolleri her ${settings.priceCheckInterval} dakikada bir yapılacak.`);
    browser.alarms.create("priceCheckAlarm", {
      periodInMinutes: parseInt(settings.priceCheckInterval),
    });
  } else {
    console.error("Ayarlar yüklenemedi.");
  }
}

function applySettings(newSettings) {
  schedulePriceCheck(newSettings);
}

function getDefaultSettings() {
  return {
    priceCheckInterval: "60",
    concurrentCheckLimit: "4",
    notificationType: "n_on",
    discountNotification: "d_on",
    discountSound: "Capri",
    stockNotification: "s_on",
    stockSound: "Capri",
    priceIncreaseNotification: "pi_on",
    priceIncreaseSound: "Capri",
    priceChangeThreshold: "5",
    visualNotificationType: "v_on",
  };
}