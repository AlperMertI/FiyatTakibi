// price.js
import { getAllFromSync, saveToDB, getAllFromDB, saveToSync } from "./storage.js";
import { updateProductPrice, updateBadgeCount } from "./update.js";
import { sendNotification } from "./notifications.js";
import { sendPriceChange } from "./sendUrl.js";
import { parsePrice } from "./price-utils.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

export async function checkPrices(callbacks = {}) {
  const settings = (await browser.storage.sync.get("settings")).settings || {};
  const CONCURRENT_LIMIT = parseInt(settings.concurrentCheckLimit || 4, 10);
  const followList = await getAllFromSync();
  if (followList.length === 0) {
    await updateBadgeCount([]);
    return true;
  }

  const { onProductProcessed, onProductProcessStart } = callbacks;

  const dbData = await getAllFromDB();
  const dbMap = new Map(dbData.map(p => [p.id, p]));

  const beforeUpdateMap = new Map();
  followList.forEach(product => {
    beforeUpdateMap.set(product.id, {
      oldPrice: parsePrice(product.oldPrice),
      oldNewPrice: parsePrice(product.newPrice),
      oldNewPriceString: product.newPrice,
      oldStatus: product.status
    });
  });

  const productsToNukeForImage = [];
  const needsImageMap = new Map();

  for (const product of followList) {
    const dbProduct = dbMap.get(product.id);
    const needsImage = !dbProduct || !dbProduct.picUrl;
    needsImageMap.set(product.id, needsImage);
    if (needsImage) {
      product.newPrice = null;
      productsToNukeForImage.push({ id: product.id, newPrice: null });
    }
  }

  if (productsToNukeForImage.length > 0) {
    await saveToDB(productsToNukeForImage);
    await saveToSync(followList);
  }

  const updatedProductsList = [];
  const queue = [...followList];

  async function worker() {
    while (queue.length > 0) {
      const product = queue.shift();
      if (!product) continue;

      if (onProductProcessStart) {
        onProductProcessStart(product);
      }

      const needsImageUpdate = needsImageMap.get(product.id);

      try {
        const updatedProduct = await updateProductPrice(product, needsImageUpdate);

        if (onProductProcessed) {
          onProductProcessed(updatedProduct);
        }
        updatedProductsList.push(updatedProduct);
      } catch (err) {
        console.error(`Fiyat güncelleme hatası (ID: ${product.id}):`, err);
        product.status = "‼️";
        if (onProductProcessed) {
          onProductProcessed(product);
        }
        updatedProductsList.push(product);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENT_LIMIT; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  for (const product of updatedProductsList) {
    if (product.status === "‼️") continue;

    const { oldPrice, oldNewPrice, oldNewPriceString } = beforeUpdateMap.get(product.id);
    const newPriceString = product.newPrice;
    const newPrice = parsePrice(newPriceString);

    // Değişim zamanı için şu anı al
    const nowISO = new Date().toISOString();
    let hasChange = false;

    if (newPrice > 0 && !oldPrice) {
      product.status = "➕";
      product.lastChangeDate = nowISO; // Değişim tarihi kaydet
      hasChange = true;
      await sendNotification(product, "Stokta Yok", newPriceString, "stock");
      await sendPriceChange(product.id, newPriceString);
    } else if (!isNaN(newPrice) && newPrice > 0 && newPrice < oldNewPrice) {
      product.status = "⬇️";
      product.lastChangeDate = nowISO; // Değişim tarihi kaydet
      product.previousPrice = oldNewPriceString; // Önceki fiyatı kaydet
      hasChange = true;
      console.log(`Fiyat düştü -> ${product.id}: ${oldNewPriceString} -> ${newPriceString}`);
      await sendNotification(product, oldNewPriceString, newPriceString, "discount");
      await sendPriceChange(product.id, newPriceString);
    } else if (!isNaN(newPrice) && newPrice > oldNewPrice) {
      product.status = "⬆️";
      product.lastChangeDate = nowISO; // Değişim tarihi kaydet
      product.previousPrice = oldNewPriceString; // Önceki fiyatı kaydet
      hasChange = true;
      console.log(`Fiyat arttı -> ${product.id}: ${oldNewPriceString} -> ${newPriceString}`);
      await sendNotification(product, oldNewPriceString, newPriceString, "priceIncrease");
      await sendPriceChange(product.id, newPriceString);
    }
    else if (!isNaN(newPrice) && newPrice === oldNewPrice) {
      product.status = "🟰";
    }
    else if (!isNaN(newPrice) && newPrice === oldPrice && isNaN(oldNewPrice)) {
      product.status = "🟰";
    }
  }

  await saveToSync(updatedProductsList);
  await updateBadgeCount(updatedProductsList);

  const now = new Date();
  const formattedTime = `${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")}/${now.getFullYear()} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  await browser.storage.sync.set({ lastUpdateTime: formattedTime });

  return true;
}