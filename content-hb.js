// content-hb.js

// storage.content.js dosyasından fonksiyonları alıyoruz
const { saveToSync, removeFromSync } = window.storage.sync;

if (typeof browser === "undefined") {
    var browser = chrome;
}

// --- background.js ile iletişim (DB işlemleri için) ---
async function saveToDB(order) {
    return new Promise((resolve, reject) => {
        browser.runtime.sendMessage({ action: "saveToDB", order }, (response) => {
            if (browser.runtime.lastError) {
                return reject(new Error(browser.runtime.lastError.message));
            }
            resolve(response);
        });
    });
}

async function removeFromDB(id) {
    return new Promise((resolve, reject) => {
        browser.runtime.sendMessage({ action: "removeFromDB", id }, (response) => {
            if (browser.runtime.lastError) {
                return reject(new Error(browser.runtime.lastError.message));
            }
            resolve(response);
        });
    });
}

async function getFromSync(id) {
    return new Promise((resolve, reject) => {
        browser.runtime.sendMessage({ action: "hb_getProduct", id }, (response) => {
            if (browser.runtime.lastError) {
                return reject(new Error(browser.runtime.lastError.message));
            }
            resolve(response.data);
        });
    });
}

async function getAllFromSync() {
    return new Promise((resolve, reject) => {
        browser.runtime.sendMessage({ action: "getAllFromSync" }, (response) => {
            if (browser.runtime.lastError) {
                return reject(new Error(browser.runtime.lastError.message));
            }
            resolve(response.data || []); // Her zaman bir dizi döndür
        });
    });
}
// --- background.js ile iletişim SONU ---


// Global değişkenler
let currentPriceInfo = {
    price: null,
    status: "Yükleniyor..."
};
let currentProductId = null;
let priceObserver = null;
let buttonAnchorObserver = null;

// 1. Fiyat Bulucu (MutationObserver)
function findPrice() {
    try {
        const allElements = document.querySelectorAll('span, p, div');
        let priceFoundText = null;

        // ÖNCELİK 1: "Sepete özel" fiyatını bul
        for (const el of allElements) {
            const text = (el.textContent || "").trim();

            if (text === 'Sepete özel fiyat' || text === 'Sepete özel') {
                let priceElement = el.nextElementSibling;

                if (!priceElement && el.parentElement) {
                    priceElement = el.parentElement.nextElementSibling;
                }

                if (priceElement) {
                    let priceText = (priceElement.textContent || "").trim();
                    let innerPriceElement = priceElement.querySelector('span, div');
                    if (innerPriceElement && (innerPriceElement.textContent || "").includes('TL')) {
                        priceText = (innerPriceElement.textContent || "").trim();
                    }
                    if (priceText.includes('TL') && /\d/.test(priceText)) {
                        return priceText; // Sepete özel fiyat bulundu
                    }
                }
            }
        }

        // ÖNCELİK 2: Standart Fiyat Arama (Sepete özel yoksa)
        const mainPriceCandidates = document.querySelectorAll('[data-test-id="price-current-to-old"], [data-test-id="price-current"]');
        for (const el of mainPriceCandidates) {
            const text = (el.textContent || "").trim();
            if (text.includes('TL') && /\d/.test(text)) {
                return text; // Genel fiyat (data-test-id'den) bulundu
            }
        }

        // ÖNCELİK 3: Güçlü Fallback: En belirgin fiyat alanında TL içeren metni ara (Sadece rakam/TL)
        const priceArea = document.querySelector('.foQSHpIYwZWy8nHeqapl');
        if (priceArea) {
            const allSpans = priceArea.querySelectorAll('span, div');
            for (const el of allSpans) {
                const text = (el.textContent || "").trim();
                if (text.includes('TL') && /\d/.test(text) && text.length < 20) {
                    return text;
                }
            }
        }


        // ÖNCELİK 4: Stokta Yok kontrolü
        const outOfStockEl = document.querySelector('[data-test-id="product-info-stock-message"], [data-test-id="out-of-stock-container"]');
        if (outOfStockEl) {
            const stockText = (outOfStockEl.textContent || "").trim().toLowerCase();
            if (stockText.includes("tükendi") || stockText.includes("stokta yok") || stockText.includes("stokta bulunmuyor")) {
                return "STOKTA_YOK";
            }
        }

        return null;
    } catch (error) {
        console.error("AFT (HB) Fiyat aranırken hata:", error);
        return null;
    }
}

// Gözlemciyi başlat
function startPriceObserver() {
    if (priceObserver) {
        priceObserver.disconnect();
    }
    currentPriceInfo = { price: null, status: "Yükleniyor..." };

    console.log("AFT (HB): Gözlemci başlatılıyor (Fiyat/Stok durumu)...");

    // Gözlemciyi çalıştırmadan önce bir kez findPrice'ı çağır
    let priceText = findPrice(); // priceText: "STOKTA_YOK", "99,90 TL" veya null
    let price = null;
    let status = "Yükleniyor...";

    if (priceText) {
        if (priceText === "STOKTA_YOK") {
            status = "Stokta Yok";
            console.log("AFT (HB) Stokta Yok Bulundu (İlk Kontrol):");
        } else {
            price = priceText.trim(); // "99,90 TL" -> "99,90 TL" (TL kalsın ki parser TR formatı olduğunu anlasın)
            status = "✅";
            console.log("AFT (HB) Fiyat Bulundu (İlk Kontrol):", price);
        }

        currentPriceInfo.price = price;
        currentPriceInfo.status = status;

        updateFollowButtonState();
        sendPriceToBackground();
        return;
    }

    // Fiyat/stok ilk kontrolde bulunamadıysa gözlemciyi başlat
    priceObserver = new MutationObserver((mutationsList, observerInstance) => {
        priceText = findPrice();

        if (priceText) {
            let price = null;
            let status = "Yükleniyor...";

            if (priceText === "STOKTA_YOK") {
                status = "Stokta Yok";
                console.log("AFT (HB) Stokta Yok Bulundu (Gözlemci):");
            } else {
                price = priceText.trim(); // "99,90 TL" -> "99,90 TL"
                status = "✅";
                console.log("AFT (HB) Fiyat Bulundu (Gözlemci):", price);
            }

            currentPriceInfo.price = price;
            currentPriceInfo.status = status;

            updateFollowButtonState();
            sendPriceToBackground();
            observerInstance.disconnect();
        }
    });

    priceObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// 2. Buton Oluşturma
function updateButtonText(isFollowed, hasPrice, button, icon) {
    if (!button) return;
    let config;

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

    button.textContent = "";
    if (icon) {
        icon.textContent = config.icon;
        button.append(icon, document.createTextNode(" " + config.text));
    } else {
        button.textContent = config.icon + " " + config.text;
    }
    button.className = config.className;
    button.style.marginTop = "10px";
}

// Fiyat bulunduğunda veya takip durumu değiştiğinde butonu günceller
async function updateFollowButtonState() {
    const followButton = document.querySelector("#followButton");
    if (!followButton || !currentProductId) return;

    const product = await getFromSync(currentProductId);
    const isFollowed = !!product;
    const icon = followButton.querySelector(".icon");
    updateButtonText(isFollowed, !!currentPriceInfo.price, followButton, icon);
}

// Butonu sayfaya ekler
async function addFollowButton() {
    const asinMatch = window.location.pathname.match(/-p-([a-zA-Z0-9]+)/) || window.location.pathname.match(/-pm-([a-zA-Z0-9]+)/);
    currentProductId = asinMatch ? asinMatch[1] : null;

    if (!currentProductId) return;

    // 1. ÖNCE BAŞLIĞI BUL (MutationObserver bunu zaten bulmuştu)
    const titleElement = document.querySelector('h1[data-test-id="title"]');
    if (!titleElement) {
        console.warn("AFT (HB): Buton hedefi (h1) bulunamadı.");
        return;
    }

    // 2. YENİ HEDEF: Başlığı içeren ana kapsayıcıyı (title-area ve yıldızları tutan blok) bul.
    // Bu, "Fs23UaWoNQ0FHK6MOHE8" sınıfına sahip div'dir.
    let targetElement = titleElement.closest('.Fs23UaWoNQ0FHK6MOHE8');

    if (!targetElement) {
        console.warn("AFT (HB): Buton hedefi (ana kapsayıcı .Fs23UaWoNQ0FHK6MOHE8) bulunamadı. Başlığın altına ekleniyor.");
        // Fallback: Eğer o sınıfı bulamazsa, eski yöntem gibi başlığın kendisine döner.
        targetElement = titleElement;
    }

    const existing = document.querySelector("#followButton");
    if (existing) existing.remove();

    console.log("AFT (HB): Buton ekleniyor. SKU:", currentProductId);

    const product = await getFromSync(currentProductId);
    const isFollowed = !!product;

    const button = document.createElement("button");
    button.id = "followButton";
    button.className = "aft-follow-button-hb";

    const icon = document.createElement("span");
    icon.className = "icon";

    const statusDiv = document.createElement('div');
    statusDiv.id = 'aft-status-hb';
    statusDiv.textContent = currentPriceInfo.status;
    button.appendChild(statusDiv);

    updateButtonText(isFollowed, !!currentPriceInfo.price, button, icon);

    // 3. EKLEME YÖNTEMİ:
    // Butonu, başlık/yıldız bloğunun (targetElement) DIŞINA, hemen SONRASINA ekle.
    // Bu, onu "Satıcı" bloğundan önceye yerleştirecek ve React'in yeniden yüklemesinden etkilenmeyecek.
    targetElement.insertAdjacentElement("afterend", button);

    button.addEventListener("click", toggleFollow);

    if (currentPriceInfo.price) {
        updateFollowButtonState();
    }
}

// 3. Buton Eylemleri (toggleFollow)
async function toggleFollow() {
    if (!currentProductId) return;

    console.log("AFT (HB): Takip Et butonuna tıklandı.");
    const followButton = document.querySelector("#followButton");
    const icon = followButton.querySelector(".icon");

    try {
        const product = await getFromSync(currentProductId);
        const isFollowed = !!product;
        const date = new Date().toLocaleDateString("tr-TR");

        if (!isFollowed) {
            // --- Takip Et ---
            if (currentPriceInfo.status === "Yükleniyor...") {
                toast("Fiyat henüz yüklenmedi, lütfen bekleyin.", "warning");
                return;
            }

            const newProduct = await getProductInfo();

            const followList = await getAllFromSync();
            followList.push(newProduct);
            const result = await saveToSync(followList);

            if (!result.success) {
                toast(result.message || "Takip listesine eklenemedi.", "error");
                return;
            }

            const { url } = getProductImage();
            const dbData = {
                id: newProduct.id,
                no: followList.length,
                date,
                pic: null, // pic (Base64) artık kaydedilmiyor
                picUrl: url, // URL'i sync'e
                platform: 'HB'
            };
            await saveToDB([dbData]);

            toast("Takip listesine eklendi", "success");
            updateButtonText(true, !!newProduct.oldPrice, followButton, icon);

        } else {
            // --- Takipten Çık ---
            // 1. Ürünü sync storage'dan sil (storage.content.js'den gelen fonksiyon)
            await removeFromSync(currentProductId);

            // 2. Ürünü DB'den sil (background.js'e mesaj gönderir)
            await removeFromDB(currentProductId);

            toast("Takip listesinden silindi", "warning");

            // 3. Butonu "Takip Et" olarak güncelle
            // Not: currentPriceInfo.price, sayfa yüklendiğinde bulunan fiyattır.
            updateButtonText(false, !!currentPriceInfo.price, followButton, icon);
        }
    } catch (error) {
        console.error("AFT (HB) toggleFollow hata:", error);
        toast(`Bir hata oluştu: ${error.message}`, "error");
    }
}


// 4. Yardımcı Fonksiyonlar
async function getProductInfo() {
    const titleEl = document.querySelector('h1[data-test-id="title"]'); // GÜNCELLENDİ
    const title = titleEl ? titleEl.textContent.trim() : "";
    const url = window.location.href.split("?")[0];

    return {
        id: currentProductId,
        name: title,
        url: url,
        oldPrice: currentPriceInfo.price,
        newPrice: null,
        platform: 'HB'
    };
}

function getProductImage() {
    // Sadece URL'i alır
    const imgEl = document.querySelector('a[id="pdp-carousel__dot_item0"] img');
    let picUrl = imgEl ? imgEl.getAttribute('src') : null;

    if (picUrl) {
        picUrl = picUrl.replace("/48-64/", "/424-600/");
    } else {
        const mainImgEl = document.querySelector('li[id="pdp-carousel__slide0"] img');
        if (mainImgEl) {
            picUrl = mainImgEl.getAttribute('src');
        }
    }
    // Hem base64 (null) hem de url döndürerek toggleFollow ile uyumlu kalır
    return { base64: null, url: picUrl };
}

// ** YENİ ** Sessiz sekme kazıması için arka plana mesaj gönderir
function sendPriceToBackground() {
    // Fiyat null olabilir (stokta yok), ama productId ve status olmalı
    if (!currentProductId || !currentPriceInfo.status || currentPriceInfo.status === "Yükleniyor...") return;

    const picData = getProductImage();
    const titleEl = document.querySelector('h1[data-test-id="title"]');
    const name = titleEl ? titleEl.textContent.trim() : "";

    browser.runtime.sendMessage({
        action: "hb_price_found",
        price: currentPriceInfo.price, // Bu null olabilir
        status: currentPriceInfo.status, // "✅" veya "Stokta Yok"
        productId: currentProductId,
        picUrl: picData.url,
        name: name
    }).catch(e => console.log("AFT (HB): Arka plana fiyat gönderme hatası (normal)."));
    // Not: Arka plan dinlemede değilse hata verir, bu normaldir.
}

function toast(message, type) {
    const box = document.createElement("div");
    box.className = `toast ${type}`;
    box.innerText = message;
    document.body.querySelector(".toast")?.remove();
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3000);
}

// --- Script'i Başlatma MANTIĞI ---

function initializeScript() {
    console.log("AFT (HB): Script başlatılıyor...");
    currentPriceInfo = { price: null, status: "Yükleniyor..." };

    // Butonu eklemeyi dene (element hazırsa ekler, değilse gözlemci ekler)
    tryAddButtonWhenReady();

    // Fiyat gözlemcisini başlat
    startPriceObserver();
}

function tryAddButtonWhenReady() {
    const buttonAnchorSelector = 'h1[data-test-id="title"]';

    if (document.querySelector(buttonAnchorSelector)) {
        console.log("AFT (HB): Buton hedefi hazır, ekleniyor.");
        addFollowButton();
    } else {
        console.log("AFT (HB): Buton hedefi bekleniyor...");

        if (buttonAnchorObserver) buttonAnchorObserver.disconnect();

        buttonAnchorObserver = new MutationObserver((mutationsList, observer) => {
            if (document.querySelector(buttonAnchorSelector)) {
                console.log("AFT (HB): Buton hedefi bulundu, ekleniyor.");
                observer.disconnect();
                addFollowButton();
            }
        });

        buttonAnchorObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
}

function insertFollowButton(productDetails) {
    // 1. Mevcut butonu kaldır (sayfa yenilenmeden yeniden arama yapılabilmesi için)
    if (document.getElementById(FOLLOW_BUTTON_ID)) {
        return;
    }

    // 2. Butonu yerleştirmek için ana hedefi ara: Sepete Ekle butonu
    const addToCartButton = document.querySelector('[data-test-id="add-to-cart"] button');
    let targetContainer = null;

    if (addToCartButton) {
        // Sepete Ekle butonunun ana konteynerini buluyoruz
        // Bu genellikle VZMbm89fzHuumKKSNdPb veya üstündeki EVw3R49mJ4tM_lgmN7E_ div'i olmalıdır.
        const parentContainer = addToCartButton.closest('.EVw3R49mJ4tM_lgmN7E_') || addToCartButton.parentElement;

        // Sepete Ekle butonu ve diğer ilgili öğelerin olduğu kutu:
        targetContainer = parentContainer.querySelector('.VZMbm89fzHuumKKSNdPb');
    }

    // Eğer Sepete Ekle butonu yoksa (tükenmiş olabilir), fiyatın olduğu alanı deneyelim.
    if (!targetContainer) {
        targetContainer = document.querySelector('.EVw3R49mJ4tM_lgmN7E_');
    }

    // Her iki hedef de bulunamazsa çık
    if (!targetContainer) {
        console.log("AFT (HB): Takip butonu için yerleştirme noktası bulunamadı.");
        return;
    }

    // 3. Yeni butonu oluştur
    const button = document.createElement('button');
    button.id = FOLLOW_BUTTON_ID;
    button.className = 'aft-follow-button-hb';

    // ... (Buton metin ve aktif/pasif mantığı aynı kalacak) ...
    if (productDetails.isTracking) {
        button.textContent = "✅ TAKİP EDİLİYOR (HB)";
        button.classList.add('active');
    } else {
        button.textContent = "Fiyat Takibi Başlat (HB)";
    }

    const statusDiv = document.createElement('div');
    statusDiv.id = 'aft-status-hb';
    statusDiv.textContent = currentPriceInfo.status;
    button.appendChild(statusDiv);

    // 4. Butonu hedef konteynerin HEPSİNİN ÖNÜNE veya içine uygun bir yere ekle
    // Sepete Ekle butonu da VZMbm89fzHuumKKSNdPb içinde, bu yüzden en üstteki uygun alana ekleyelim.
    // targetContainer'ın hemen önüne eklemek en güvenli yöntemdir.
    targetContainer.parentElement.insertBefore(button, targetContainer);

    // 5. Olay dinleyicisini bağla
    button.addEventListener('click', () => {
        togglePriceTracking(productDetails, button);
    });

    updateFollowButtonState();
}

// Hepsiburada URL değişimlerini izle
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        console.log("AFT (HB): URL değişti, yeniden başlatılıyor.");
        initializeScript();
    }
}).observe(document.body, { childList: true, subtree: true });

// İlk yükleme
initializeScript();