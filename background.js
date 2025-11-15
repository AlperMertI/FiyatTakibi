// background.js
import { saveToDB, removeFromDB, getAllFromSync, saveToSync } from "./storage.js";
import { checkPrices } from "./price.js";
import { updateProductPrice } from "./update.js";

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
    browser.tabs.create({ url: product.url, active: false })
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

  // options.js'den gelen anlık güncelleme talebi
  if (message.action === "runPriceCheck") {
    console.log("AFT: Manuel fiyat/görsel kontrolü tetiklendi.");
    checkPrices({})
      .then(() => {
        console.log("AFT: Manuel kontrol tamamlandı.");
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error("AFT: Manuel kontrol hatası:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
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