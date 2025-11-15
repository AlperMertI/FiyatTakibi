// options.js
import { getAllFromDB, getAllFromSync, saveToSync, STORAGE_CONFIG, saveToDB } from "./storage.js"; import { showToast } from "./notifications.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

const settings = [
  "priceCheckInterval",
  "concurrentCheckLimit",
  "notificationType",
  "discountNotification",
  "discountSound",
  "stockNotification",
  "stockSound",
  "priceIncreaseNotification",
  "priceIncreaseSound",
  "priceChangeThreshold",
  "visualNotificationType",
];

const soundOptions = [
  "Capri",
  "Cuckoo",
  "Dewdrop",
  "DingDong",
  "Doorbell",
  "News",
  "Pixiedust",
  "S_Chirps",
  "S_On_Time",
  "S_Opener",
  "S_Postman",
  "S_Pure_Bell",
  "S_Temple_Bell",
  "Whistle",
  "Whistling_Bird",
];

const soundSelectIds = ["discountSound", "stockSound", "priceIncreaseSound"];

const loadFollowListBlocks = () => getAllFromSync();

const getSettingRow = (nameOrId) => {
  const el = document.querySelector(`[name="${nameOrId}"]`) || document.getElementById(nameOrId);
  return el?.closest(".setting-row") || null;
};

const toggleVisibility = (name, condition) => {
  const row = getSettingRow(name);
  if (row) row.classList.toggle("hidden-option", !condition);
};

const updateRangeText = (value) => {
  const el = document.getElementById("rangeValue");
  if (el) el.textContent = value == 0 ? "Her Zaman" : `${value}%`;
};

const toggleSoundOptions = () => {
  const nt = document.querySelector('[name="notificationType"]:checked')?.value;
  const on = nt === "n_on";
  const val = (name) => document.querySelector(`[name="${name}"]:checked`)?.value;
  const cm = {
    discountNotification: on,
    discountSound: on && val("discountNotification") === "d_on",
    stockNotification: on,
    stockSound: on && val("stockNotification") === "s_on",
    priceIncreaseNotification: on,
    priceIncreaseSound: on && val("priceIncreaseNotification") === "pi_on",
    visualNotificationType: on,
    priceChangeThreshold: on,
  };
  Object.entries(cm).forEach(([k, c]) => toggleVisibility(k, c));
};

const updateSetting = (name, value) => {
  browser.storage.sync.get("settings").then(({ settings = {} }) => {
    settings[name] = value;
    browser.storage.sync.set({ settings }).then(() => showToast("Ayarlar kaydedildi!", "success"));
  });
};

const populateSoundOptions = () => {
  soundSelectIds.forEach((id) => {
    const select = document.getElementById(id);
    if (select) {
      select.innerHTML = "";
      soundOptions.forEach((sound) => {
        const option = document.createElement("option");
        option.value = sound;
        option.textContent = sound;
        select.appendChild(option);
      });
    }
  });
};

const playSound = (sound) => {
  try {
    const audio = new Audio(`sound/${sound}.mp3`);
    audio.play().catch(() => showToast(`Ses çalma hatası: ${sound}.mp3 oynatılamadı.`, "error"));
  } catch (e) {
    showToast(`Ses çalma hatası: ${e.message}`, "error");
  }
};

const importProducts = async () => {
  try {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "application/json" });
    input.onchange = async ({ target }) => {
      const file = target.files[0];
      const reader = new FileReader();
      reader.onload = async () => {
        let newList = JSON.parse(reader.result);
        if (!Array.isArray(newList)) return showToast("Geçersiz JSON formatı: Dizi bekleniyor.", "error");

        const invalid = newList.filter((p) => !p.id || typeof p.id !== "string" || !p.id.trim());
        if (invalid.length) return showToast(`Geçersiz veri: ${invalid.length} ürünün ID alanı eksik veya hatalı.`, "error");

        const existing = await loadFollowListBlocks();
        const ids = new Set(existing.map((p) => p.id));
        const unique = newList.filter((p) => !ids.has(p.id));

        if (!unique.length) return showToast(`İçe aktarılan ${newList.length} ürün zaten listede.`, "info");

        const max = STORAGE_CONFIG.MAX_ITEMS - existing.length;
        const added = Math.min(unique.length, Math.max(max, 0));
        const skipped = unique.length - added;

        // 1. Eklenecek öğeleri al
        const addedItems = unique.slice(0, added);

        // 2. SYNC için güvenli listeyi oluştur (Büyük 'pic' ve 'picUrl' alanları hariç)
        const syncSafeAddedItems = addedItems.map(p => ({
          id: p.id,
          name: p.name,
          oldPrice: p.oldPrice,
          newPrice: p.newPrice,
          status: p.status,
          url: p.url,
          platform: p.platform,
          group: p.group || "",
        }));

        // 3. 'existing' (zaten sync'de olan) ve yeni 'sync-safe' listeyi birleştir
        const updatedSyncList = [...existing, ...syncSafeAddedItems];
        const result = await saveToSync(updatedSyncList); // Bu artık 8KB kotasını aşmayacak

        // 4. DB listesini oluştur (Resimler ve sıralama bilgisi buraya)
        if (result.success && addedItems.length > 0) {
          const dbItems = [];
          const date = new Date().toLocaleDateString("tr-TR");

          addedItems.forEach((p, index) => {
            dbItems.push({
              id: p.id,
              no: existing.length + index + 1,
              date: p.date || date,
              pic: p.pic || null,
              picUrl: p.picUrl || null,
              group: p.group || ""
            });
          });

          await saveToDB(dbItems); // Ekstra veriyi DB'ye kaydet
        }

        showToast(
          result.success ? `${added} yeni ürün eklendi${skipped > 0 ? `, ${skipped} ürün kota nedeniyle atlandı.` : "."}` : result.message,
          result.success ? "success" : "error"
        );

        if (result.success && added > 0) {
          showToast("Aktarılan ürünler için arka planda görsel/fiyat kontrolü başlatılıyor...", "info");
          try {
            // DÜZELTME: browser.runtime.sendMessage Promise olarak sarmalanıyor
            await new Promise((resolve, reject) => {
              browser.runtime.sendMessage({ action: "runPriceCheck" }, (response) => {
                if (browser.runtime.lastError) {
                  reject(browser.runtime.lastError);
                } else if (response && !response.success) {
                  reject(new Error(response.error || "Bilinmeyen hata"));
                } else {
                  resolve(response);
                }
              });
            });
          } catch (e) {
            console.warn("Otomatik fiyat kontrolü tetiklenemedi:", e);
          }
        }

      };
      reader.onerror = () => showToast("Dosya okuma başarısız.", "error");
      reader.readAsText(file);
    };
    input.click();
  } catch (e) {
    showToast(`İçe aktarma başlatılamadı: ${e.message}`, "error");
  }
};

const exportProducts = async () => {
  try {
    // 1. Her iki kaynaktan da veriyi çek
    const syncData = await getAllFromSync(); // Ana veri (isim, fiyat, url)
    const dbData = await getAllFromDB();     // Ekstra veri (picUrl, pic, no, group)

    // 2. Verileri birleştir
    const dbMap = new Map(dbData.map(item => [item.id, item]));
    const data = syncData.map(product => ({
      ...product, // sync verisi
      ...(dbMap.get(product.id) || {}) // DB verisi
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), {
      href: url,
      download: "Amazon Takip Listesi.json",
    }).click();
    showToast(`${data.length} ürün dışarı aktarıldı.`, "success");
  } catch (e) {
    showToast(`Ürünler dışarı aktarılırken hata oluştu: ${e.message}`, "error");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const buttonsContainer = document.querySelector(".export-import-buttons");
  if (buttonsContainer) {
    buttonsContainer.innerHTML = `
            <button id="import-json">İçe Aktar</button>
            <button id="export-json">Dışarı Aktar</button>
            <button id="clear-data" style="background-color: var(--reset-button-bg);">Fabrika Ayarlarına Dön</button>
        `;
  }

  populateSoundOptions();

  browser.storage.sync.get("settings").then(({ settings: loaded = {} }) => {
    settings.forEach((key) => {
      const val = loaded[key];
      const el = document.querySelector(`[name="${key}"]`);
      if (val !== undefined && el) {
        const radio = document.querySelector(`[name="${key}"][value="${val}"]`);
        if (radio) radio.checked = true;
        else if (["SELECT", "INPUT"].includes(el.tagName)) el.value = val;
      }
    });
    toggleSoundOptions();
    updateRangeText(loaded.priceChangeThreshold);
  });

  document.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("change", ({ target }) => {
      const { name, value, type } = target;
      const val = type === "range" ? parseInt(value, 10) : value;
      updateSetting(name, val);
      toggleSoundOptions();
      if (name === "priceChangeThreshold") updateRangeText(value);
    });
  });

  soundSelectIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", (e) => playSound(e.target.value));
  });

  document.getElementById("import-json")?.addEventListener("click", importProducts);
  document.getElementById("export-json")?.addEventListener("click", exportProducts);
  document.getElementById("clear-data")?.addEventListener("click", async () => {
    if (confirm("Verileri ve ayarları silmek istediğinize emin misiniz?")) {
      await browser.storage.sync.clear();
      showToast("Veriler silindi ve varsayılan ayarlar geri yüklendi.", "success");
      location.reload();
    }
  });

  const fixButton = document.getElementById("fix-data");
  if (fixButton) {
    fixButton.addEventListener("click", async () => {
      try {
        const allData = await browser.storage.sync.get(null);
        const blockKeys = Object.keys(allData).filter((k) => k.startsWith("block_"));
        const blockItems = blockKeys.flatMap((k) => allData[k]);

        if (blockItems.length > 0) {
          const blob = new Blob([JSON.stringify(blockItems, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          Object.assign(document.createElement("a"), {
            href: url,
            download: "AmazonTakipListesiEskiVerisi.json",
          }).click();
          showToast(`${blockItems.length} ürün dışa aktarıldı.`, "success");
          return;
        }
        const allProducts = await getAllFromSync();
        const updatedProducts = allProducts.map(({ group = "", id, name, oldPrice }) => ({
          group,
          id,
          name,
          oldPrice,
          newPrice: null,
          status: null,
          url: `https://www.amazon.com.tr/dp/${id}?th=1&psc=1`,
        }));
        await saveToSync(updatedProducts);
        showToast("Veriler başarıyla güncellendi!", "success");
      } catch (e) {
        console.error("Veri işlenirken hata oluştu:", e);
        showToast("Veri işlenirken hata oluştu.", "error");
      }
    });
  }

  try {
    document.getElementById("extension-version").textContent = browser.runtime.getManifest().version;
  } catch (e) {
    showToast(`Eklenti sürümü alınırken hata: ${e.message}`, "error");
  }
});
