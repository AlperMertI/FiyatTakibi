// offscreen.js (Sadece Ses Çalar)

if (typeof browser === "undefined") {
  var browser = chrome;
}

// background.js'den gelen mesajları dinle
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // background.js'den gelen "playNotificationSound" mesajını dinle
  if (message.action === "playNotificationSound") {
    playNotificationSound(message.soundUrl);
    sendResponse({ success: true });
    return true; // Asenkron yanıt için
  }

  // --- RISK MODE TEST ---
  if (message.type === "loadUrl") {
    const iframe = document.getElementById('test-frame');
    if (iframe) {
      iframe.src = message.url;
      console.log(`Offscreen: Iframe src set to ${message.url}`);
      sendResponse({ success: true, message: "URL loading started" });
    } else {
      console.error("Offscreen: iframe element not found");
      sendResponse({ success: false, error: "iframe not found" });
    }
    return true;
  }
});

function playNotificationSound(soundUrl) {
  const audio = new Audio(soundUrl);
  audio.play().catch(e => {
    if (e.name === "NotAllowedError" || e.name === "AbortError") {
      console.warn("AFT Ses Hatası: Otomatik oynatma engellendi. Tarayıcının autoplay kısıtlaması olabilir.", e.message);
    } else {
      console.error("Ses çalma hatası:", e);
    }
  });
}