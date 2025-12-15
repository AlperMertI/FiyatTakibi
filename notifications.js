//background > notifications.js
import { getAllFromSync } from "./storage.js";
import { parsePrice } from "./price-utils.js";

if (typeof browser === "undefined") {
  var browser = chrome;
}

export async function sendNotification(product, oldPrice, newPrice, type) {
  const settings = await getAllFromSync("settings");
  const threshold = parseFloat(settings.priceChangeThreshold);
  const oldPriceValue = parsePrice(oldPrice);
  const newPriceValue = parsePrice(newPrice);
  const priceChange = Math.abs(newPriceValue - oldPriceValue);
  const percentageChange = oldPriceValue ? (priceChange / oldPriceValue) * 100 : 0;
  const percentChangeRounded = Math.round(percentageChange);



  if (type === "stock") {
    const notificationId = `stock_${product.id}`;
    if (settings.notificationType === "n_on" && settings.visualNotificationType === "v_on" && settings.stockNotification === "s_on") {
      browser.notifications.create(notificationId, {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "",
        message: `Ürün Stoğa Girdi: ${newPrice}\n${product.name}`,
      });

    }
    if (settings.notificationType === "n_on" && settings.stockNotification === "s_on") {
      playNotificationSound(settings.stockSound);
    }
  } else if (type === "discount" && percentageChange >= threshold) {
    const notificationId = `discount_${product.id}`;
    if (settings.notificationType === "n_on" && settings.visualNotificationType === "v_on" && settings.discountNotification === "d_on") {
      browser.notifications.create(notificationId, {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "",
        message: `İndirim ${oldPrice} -> ${newPrice} (%${percentChangeRounded})\n${product.name}`,
      });

    }
    if (settings.notificationType === "n_on" && settings.discountNotification === "d_on") {
      playNotificationSound(settings.discountSound);
    }
  } else if (type === "priceIncrease" && percentageChange) {
    const notificationId = `priceIncrease_${product.id}`;
    if (settings.notificationType === "n_on" && settings.visualNotificationType === "v_on" && settings.priceIncreaseNotification === "pi_on") {
      browser.notifications.create(notificationId, {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "",
        message: `Zam ${oldPrice} -> ${newPrice} (%${percentChangeRounded})\n${product.name}`,
      });

    }
    if (settings.notificationType === "n_on" && settings.priceIncreaseNotification === "pi_on") {
      playNotificationSound(settings.priceIncreaseSound);
    }
  }
}

export async function playNotificationSound(soundName) {
  let soundUrl = soundName;
  // Eğer tam URL değilse, extension içindeki 'sound' klasöründen al
  if (!soundName.startsWith("http") && !soundName.startsWith("chrome-extension")) {
    soundUrl = browser.runtime.getURL(`sound/${soundName}.mp3`);
  }

  try {
    await ensureOffscreenDocument();
    // DÜZELTME: Hata kontrolü için callback eklendi
    browser.runtime.sendMessage({ action: "playNotificationSound", soundUrl: soundUrl }, () => {
      if (browser.runtime.lastError) {
        console.error("playNotificationSound hatası:", browser.runtime.lastError.message);
      }
    });
  } catch (error) {
    console.error("ensureOffscreenDocument (notifications.js) hatası:", error);
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = "offscreen.html";
  const reasons = ["AUDIO_PLAYBACK"];
  try {
    const hasOffscreen = await browser.offscreen.hasDocument();
    if (!hasOffscreen) {
      await browser.offscreen.createDocument({
        url: offscreenUrl,
        reasons: reasons,
        justification: "Bildirim sesi çalmak için",
      });
    }
  } catch (error) {
    console.error("Offscreen document kontrol edilirken veya yaratılırken hata oluştu:", error);
  }
}

export function showToast(message, type) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("visible");
  }, 100);
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 500);
  }, 3000);
}
