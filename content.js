// content.js
const { saveToSync, removeFromSync } = window.storage.sync;

if (typeof browser === "undefined") {
  var browser = chrome;
}

async function saveToDB(order) {
  return new Promise((resolve, reject) => { // reject eklendi
    browser.runtime.sendMessage({ action: "saveToDB", order }, (response) => {
      // DÜZELTME: lastError kontrolü eklendi
      if (browser.runtime.lastError) {
        return reject(new Error(browser.runtime.lastError.message));
      }
      resolve(response);
    });
  });
}

async function removeFromDB(id) {
  return new Promise((resolve, reject) => { // reject eklendi
    browser.runtime.sendMessage({ action: "removeFromDB", id }, (response) => {
      // DÜZELTME: lastError kontrolü eklendi
      if (browser.runtime.lastError) {
        return reject(new Error(browser.runtime.lastError.message));
      }
      resolve(response);
    });
  });
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateImage" && message.id) {
    const asin = message.id;
    if (getASIN() !== asin) return;

    const product = getProduct(asin);
    if (!product || product.variationsValid === false) return;

    getProductImage().then(async ({ base64, url }) => {
      if (base64 || url) {
        await saveToDB([{ id: asin, pic: base64, picUrl: url }]);
        console.log("Görsel güncellendi:", asin);
      }
    });
  }
});

let previousASIN = "";
addFollowButton();
document.querySelector("#twister_feature_div")?.addEventListener("click", () => {
  setTimeout(detectAsinChange, 3000);
});

function getBlocks(data) {
  return Object.keys(data)
    .filter((key) => /^[A-Z0-9]{10}$/.test(key))
    .map((key) => data[key]);
}

function getPrice() {
  const selectors = ["#corePrice_feature_div", "#corePriceDisplay_desktop_feature_div"];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const getText = (cls, def = "") => el.querySelector(cls)?.textContent.trim() || def;
    const whole = getText(".a-price-whole");
    if (whole) return `${whole}${getText(".a-price-fraction", "00")}${getText(".a-price-symbol")}`;
  }

  const fallback = document.querySelector("#corePrice_feature_div .a-price.a-size-medium .a-offscreen");
  return fallback?.textContent.trim() || null;
}

function getASIN() {
  const match = window.location.href.match(/(?:\/dp\/|\/gp\/product\/|\/)([A-Z0-9]{10})(?:[/?]|$)/);
  return match ? match[1] : null;
}

function detectAsinChange() {
  const currentASIN = getASIN() || "";
  if (currentASIN === previousASIN) return;
  previousASIN = currentASIN;
  addFollowButton();
}

function updateButton(isFollowed, hasPrice, button, icon, forceSelect = false) {
  if (!button) return;
  let config;
  if (forceSelect) {
    config = {
      className: "notify-btn",
      icon: "🔔",
      text: "Takip Etmek için Seçim Yapın",
    };
  } else {
    config = hasPrice
      ? {
        className: isFollowed ? "unfollow-btn" : "follow-btn",
        icon: isFollowed ? "🔕" : "🔔",
        text: isFollowed ? "Takipten Çık" : "Takip Et",
      }
      : {
        className: isFollowed ? "unfollow-btn" : "notify-btn",
        icon: isFollowed ? "🔕" : "🔔",
        text: isFollowed ? "Takipten Çık" : "Stoğa Gelince Bildir",
      };
  }

  button.textContent = "";
  icon.textContent = config.icon;
  button.append(icon, document.createTextNode(config.text));
  button.className = config.className;
}

function addFollowButton() {
  const existing = document.querySelector("#followButton");
  if (existing) existing.remove();

  const title = document.querySelector("#productTitle");
  if (!title) return;
  console.log("addFollowButton çağrıldı.");
  const asin = getASIN();
  const product = getProduct(asin);
  if (!product) return;

  browser.storage.sync.get(null).then((data) => {
    const blocks = getBlocks(data);
    const isFollowed = blocks.some((item) => item.id === asin);

    const button = document.createElement("button");
    button.id = "followButton";

    const icon = document.createElement("span");
    icon.className = "icon";

    updateButton(isFollowed, !!product.oldPrice, button, icon, product.variationsValid === false);

    title.insertAdjacentElement("afterend", button);
    button.addEventListener("click", toggleFollow);
    console.log("Takip butonu eklendi");
    window.getPriceHistory(asin);
  });
}

async function getProductImage() {
  // Amazon kazıyıcısı (update.js) ile aynı mantığı kullan
  let picUrl = null;
  try {
    const imgTag = document.querySelector("#imgTagWrapperId img#landingImage");
    if (imgTag) {
      // Önce yüksek çözünürlüklü 'data-old-hires' attribute'unu dene
      picUrl = imgTag.getAttribute("data-old-hires");
      if (!picUrl) {
        // Yoksa normal 'src' attribute'unu al
        picUrl = imgTag.getAttribute("src");
      }
    }
  } catch (e) {
    console.error("AFT (Content) getProductImage hatası:", e);
  }

  // DİKKAT: Artık base64 (pic) döndürmüyoruz, sadece url (picUrl)
  return { base64: null, url: picUrl };
}

async function toggleFollow() {
  console.log("Takip Et butonuna tıklandı.");
  const asin = getASIN();
  if (!asin) return;

  try {
    const product = getProduct(asin);
    if (product && product.variationsValid === false) {
      toast("Takip edebilmek için lütfen renk ve beden seçiniz", "warning");
      return;
    }

    const data = await browser.storage.sync.get(null);
    let followList = getBlocks(data);
    const index = followList.findIndex((item) => item.id === asin);
    const date = new Date().toLocaleDateString("tr-TR");

    if (index === -1) {
      const { id, name, url, oldPrice, newPrice } = product;
      followList.push({ id, date, name, url, oldPrice, newPrice });

      const result = await saveToSync(followList);
      if (!result.success) {
        if (result.message.includes("doldu")) {
          toast(result.message, "error");
        }
        return;
      }

      // Sadece 'picUrl' alınıyor, 'pic' (base64) artık alınmıyor.
      const { url: picUrl } = await getProductImage();

      const no = followList.length;

      // DB'ye 'pic: null' gönderilerek eski base64 verisi temizleniyor.
      await saveToDB([{ id, no, date, pic: null, picUrl: picUrl }]);

      console.log("Ürün takip listesine eklendi:", asin);
      toast("Takip listesine eklendi", "success");
      await saveToMysl(id, oldPrice, url, name, product.categories);
      updateButton(true, !!oldPrice, document.querySelector("#followButton"), document.querySelector("#followButton .icon"));
    } else {
      followList.splice(index, 1);
      await removeFromSync(asin);
      await removeFromDB(asin);
      await saveToSync(followList);

      console.log("Ürün takip listesinden silindi:", asin);
      toast("Takip listesinden silindi", "warning");
      updateButton(false, !!product?.oldPrice, document.querySelector("#followButton"), document.querySelector("#followButton .icon"));
    }
  } catch (error) {
    console.error("toggleFollow hata:", error);
  }
}

async function saveToMysl(id, price, url, name, categories) {
  if (parseFloat(price || "0") === 0) return;
  try {
    const data = new URLSearchParams();
    data.append("productId", id);
    data.append("price", price);
    data.append("url", url);
    data.append("productName", name);
    categories.forEach((cat, i) => data.append(`category${i}`, cat));
    console.log("Gönderilen:", id, name, price);
    console.log("Kategori:", categories.join(" > "));
    const res = await fetch("https://amazon.aft.web.tr/SavePriceMysql.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: data,
    });
    console.log("HTTP yanıt kodu:", res.status);
    if (!res.ok) throw new Error("Veri gönderme sırasında hata oluştu.");
    console.log("Veri başarıyla gönderildi.");
  } catch (error) {
    console.error("Veri gönderilirken hata oluştu:", error.message);
  }
}

function getProduct(asin) {
  const titleEl = document.querySelector("#productTitle");
  const title = titleEl ? titleEl.innerText.trim() : "";
  const url = `${window.location.origin}/dp/${asin}?th=1&psc=1`;
  const price = getPrice();
  const product = {
    id: asin,
    name: title,
    url,
    oldPrice: price,
    newPrice: null,
    categories: [],
    variationsValid: true,
  };

  document.querySelectorAll("#wayfinding-breadcrumbs_feature_div ul li span a").forEach((el) => product.categories.push(el.innerText.trim()));

  const moda = document.querySelector("#wayfinding-breadcrumbs_feature_div > ul > li:nth-child(1) > span > a");
  if (moda && moda.innerText.toLowerCase().includes("moda")) {
    const size = document.querySelector("#dropdown_selected_size_name > span > span > span")?.innerText.trim();
    const color = document.querySelector("#dropdown_selected_color_name > span > span > span")?.innerText.trim();
    const inlineSize = document.querySelector("#inline-twister-expanded-dimension-text-size_name")?.innerText.trim();

    if (size === "Seç" || color === "Seç" || ["Beden Seçin", "Numara Seçin", "Ölçü Seçin"].includes(inlineSize || "")) {
      product.variationsValid = false;
    }

    const variations = [
      size,
      inlineSize,
      color,
      document.querySelector("#inline-twister-expanded-dimension-text-color_name")?.innerText,
      document.querySelector("#variation_color_name > div.a-row > span")?.innerText,
    ]
      .filter(Boolean)
      .join(", ");
    if (variations) product.name += ` (${variations})`;
  }

  return product;
}

function toast(message, type) {
  const box = document.createElement("div");
  box.className = `toast ${type}`;
  box.innerText = message;
  document.body.querySelector(".toast")?.remove();
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3000);
}

window.getLivePrice = getPrice;
window.toast = toast;
