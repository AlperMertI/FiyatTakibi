// storage.content.js
if (typeof browser === "undefined") {
  var browser = chrome;
}

const STORAGE_CONFIG = {MAX_ITEMS: 100};

window.storage = {
  sync: {
    async saveToSync(items) {
      try {
        if (!Array.isArray(items)) {
          throw new Error("'items' bir dizi olmalıdır.");
        }
        if (items.length === 0) {
          await window.storage.sync.clearStorage();
          return {success: true, message: "Depolama temizlendi."};
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

        return {success: true, message: "Ürünler kaydedildi."};
      } catch (error) {
        return {success: false, message: `İçe aktarma hatası: ${error.message}`};
      }
    },

    async removeFromSync(id) {
      try {
        await browser.storage.sync.remove(id);
        return true;
      } catch (error) {
        throw new Error(`Ürün silinirken hata oluştu: ${error.message}`);
      }
    },
  },
};
