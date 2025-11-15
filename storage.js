//storage.js
if (typeof browser === "undefined") {
  var browser = chrome;
}

export const STORAGE_CONFIG = { MAX_ITEMS: 100 };

const DB_NAME = "AFT";
const STORE_NAME = "aft";
const DB_VERSION = 1;

// IndexedDB bağlantısını Promise tabanlı döndürür
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Tüm ürünleri IndexedDB'den çeker (Geliştirilmiş)
export async function getAllFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Ürünleri IndexedDB'ye kaydeder veya günceller (Geliştirilmiş)
export async function saveToDB(dataArray) {
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  // Her bir kaydetme/güncelleme işlemini Promise içine alır
  const promises = dataArray.map(item => {
    return new Promise((resolve, reject) => {
      const getRequest = store.get(item.id);
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        // Mevcut ile yeni veriyi birleştir ve kaydet (PUT işlemi)
        const mergedItem = existing ? { ...existing, ...item } : item;
        const putRequest = store.put(mergedItem);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  });

  await Promise.all(promises);
  // IndexedDB işlemi tamamlandı
}

// Ürünü IndexedDB'den siler (Geliştirilmiş)
export async function removeFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}


export async function removeFromSync(id) {
  try {
    await browser.storage.sync.remove(id);
    await removeFromDB(id);
    return true;
  } catch (error) {
    throw new Error(`Ürün silinirken hata oluştu: ${error.message}`);
  }
}

export async function saveToSync(items) {
  try {
    if (!Array.isArray(items)) {
      throw new Error("'items' bir dizi olmalıdır.");
    }
    if (items.length === 0) {
      await clearAllStorage();
      return { success: true, message: "Depolama temizlendi." };
    }

    let itemsToSave = items;
    if (items.length > STORAGE_CONFIG.MAX_ITEMS) {
      itemsToSave = items.slice(0, STORAGE_CONFIG.MAX_ITEMS);
    }

    const groupedData = {};
    for (const item of itemsToSave) {
      groupedData[item.id] = item;
    }
    await browser.storage.sync.set(groupedData);

    return { success: true, message: "Ürünler kaydedildi." };
  } catch (error) {
    return { success: false, message: `İçe aktarma hatası: ${error.message}` };
  }
}

export async function getAllFromSync(key) {
  try {
    if (key) {
      const data = await browser.storage.sync.get(key);
      return data[key];
    }
    const keys = await browser.storage.sync.get(null);
    const productKeys = Object.keys(keys)
      .filter((k) => k !== "settings" && k !== "lastUpdateTime")
      .sort();
    return productKeys.map((k) => keys[k]);
  } catch (error) {
    throw new Error(`Veri alınamadı: ${error.message}`);
  }
}

export async function clearAllStorage() {
  try {
    const keys = await browser.storage.sync.get(null);
    const productKeys = Object.keys(keys).filter((key) => key !== "settings" && key !== "lastUpdateTime"); if (productKeys.length === 0) return true;
    await Promise.all(productKeys.map((key) => browser.storage.sync.remove(key)));
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return true;
  } catch (error) {
    throw new Error(`Depolama temizlenemedi: ${error.message}`);
  }
}