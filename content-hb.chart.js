// content-hb.chart.js
// Hepsiburada için Grafik Entegrasyonu

// storage.content.js fonksiyonları (bu dosya storage.content.js'den sonra yüklenir)
const { getAllFromSync: getAllFromSyncHB } = window.storage ? window.storage.sync : { getAllFromSync: async () => [] };

async function fetchYanyoDataHB(productName) {
    // Yanyo API genellikle ASIN (Amazon ID) ile çalışır.
    // HB için ürün ismiyle arama yapabilir veya EAN/Barcode bulabilirsek onu kullanabiliriz.
    // Şimdilik sadece Akakçe'ye güveneceğiz, Yanyo'yu pas geçiyoruz.
    return [];
}

async function getHBPriceHistory() {
    try {
        // Ürün Linkinden ID bul
        const url = window.location.href;
        let productId = null;
        const match = url.match(/-p-([a-zA-Z0-9]+)/) || url.match(/-pm-([a-zA-Z0-9]+)/);
        if (match) productId = match[1];

        if (!productId) return;

        // Ürün İsmini Bul
        const titleEl = document.querySelector('h1[data-test-id="title"]'); // HB için standart
        const productTitle = titleEl ? titleEl.textContent.trim() : "";

        // 1. Yerel (Eklenti) Verisi
        // AFT, kendi veritabanında HB geçmişi tutmaz (sadece son fiyat/takip listesi).
        // Ancak kullanıcının takip listesinde bu ürün varsa, belki geçmişi localde biriktirebilirdik?
        // Şu anki mimaride HB geçmişi localde tutulmuyor gibi görünüyor (Sadece anlık takikp).
        // O yüzden yerel grafik verisi YOK varsayıyoruz. 
        // Veya background'dan çekmeyi deneyebiliriz.

        let localData = [];
        // Eğer ileride local geçmiş tutulursa buraya eklenebilir.

        // 2. Akakçe Verisi
        let akakceData = [];
        let akakceCurrentPrice = null;

        if (productTitle) {
            const akakceRes = await new Promise(resolve => {
                chrome.runtime.sendMessage({ action: "SEARCH_AND_SCRAPE_AKAKCE_HISTORY", productName: productTitle }, response => {
                    resolve(response);
                });
            });

            if (akakceRes && akakceRes.success && akakceRes.data) {
                akakceData = akakceRes.data;
                akakceCurrentPrice = akakceRes.currentPrice;
            }
        }

        // Eğer hiçbir veri yoksa çık
        if (akakceData.length < 2) return;

        // HB Sayfasına Grafiği Ekle
        // HB DOM yapısı Amazon'dan farklı.
        // Grafiği "Ürün Açıklaması" veya Fiyatın altına eklemeliyiz.
        // Hedef: .Fs23UaWoNQ0FHK6MOHE8 (Fiyat/Başlık Container) veya .product-detail-module

        // Amazon chart.js'deki insertBox ve insertChart fonksiyonlarını buraya uyarlayalım.
        // HB'de "box" (analiz kutusu) göstermek yerine direkt grafiği basalım.

        insertChartHB(akakceData, akakceCurrentPrice);

    } catch (err) {
        console.error("getHBPriceHistory hata:", err);
    }
}

function insertChartHB(akakceData, currentPrice) {
    if (!akakceData || akakceData.length === 0) return;

    // Hedef Elementi Seç
    // Genellikle "Sepete Ekle" butonunun olduğu alt kısım veya ürün özellikleri öncesi.
    const targetElement = document.querySelector('.yolo-pdp-collapse') || document.querySelector('#productDescription') || document.querySelector('div[data-test-id="pdp-description"]')?.parentElement;

    // Fallback: Başlık alanı sonrasına
    const titleArea = document.querySelector('h1[data-test-id="title"]')?.closest('div');

    const injectionPoint = targetElement || titleArea;
    if (!injectionPoint) return;

    // Varsa eskisini sil
    document.querySelector("#aft-hb-chart-container")?.remove();

    // Container Oluştur
    const container = document.createElement("div");
    container.id = "aft-hb-chart-container";
    container.style.cssText = "margin: 20px 0; padding: 15px; background: #fff; border: 1px solid #ddd; border-radius: 8px;";

    // Başlık/Bilgi
    let headerHtml = `<h3 style="margin-bottom:10px; font-size:16px;">Fiyat Geçmişi (Akakçe)</h3>`;
    if (currentPrice) {
        headerHtml += `<div style="margin-bottom:10px; font-size:14px; color:#555;"><b>Akakçe Güncel Fiyat:</b> <span style="color:#e91e63; font-weight:bold;">${currentPrice.toLocaleString('tr-TR')} TL</span></div>`;
    }
    headerHtml += `<div style="font-size:11px; color:#888; margin-bottom:10px;">Veriler Akakçe tarafından sağlanmaktadır.</div>`;

    container.innerHTML = headerHtml;

    // Grafik Div
    const chartDiv = document.createElement("div");
    chartDiv.style.cssText = "width: 100%; height: 300px;";
    container.appendChild(chartDiv);

    // Ekle
    injectionPoint.insertAdjacentElement("beforebegin", container); // Açıklamadan hemen önce

    // ECharts Başlat
    const chart = echarts.init(chartDiv);

    const dataPoints = akakceData.map(d => d.fiyat);
    const labels = akakceData.map(d => new Date(d.tarih).toLocaleDateString("tr-TR"));
    const rawEntries = akakceData;

    const minY = Math.min(...dataPoints) - 10;
    const maxY = Math.max(...dataPoints) + 10;

    chart.setOption({
        tooltip: {
            trigger: "axis",
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            formatter: (params) => {
                if (!params || params.length === 0) return "";
                const p = params[0];
                const date = p.name;
                const val = p.value;
                return `<div style="font-weight:bold; border-bottom:1px solid #ddd; margin-bottom:5px;">${date}</div>
                        <div style="color:${p.color}">● Akakçe: <b>${val.toLocaleString('tr-TR')} TL</b></div>`;
            }
        },
        grid: { left: "3%", right: "4%", bottom: "3%", containLabel: true },
        xAxis: {
            type: "category",
            boundaryGap: false,
            data: labels
        },
        yAxis: {
            type: "value",
            min: minY > 0 ? minY : 0,
            max: maxY,
            axisLabel: { formatter: (v) => `₺${Math.round(v)}` }
        },
        series: [{
            name: 'Akakçe',
            type: 'line',
            smooth: true,
            symbol: 'none',
            sampling: 'lttb',
            itemStyle: { color: '#e91e63' },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(233, 30, 99, 0.5)' },
                    { offset: 1, color: 'rgba(233, 30, 99, 0.1)' }
                ])
            },
            data: dataPoints
        }]
    });
}

// Sayfa yüklendiğinde çalıştır
// HB single page app gibi davranabilir, URL değişimini content-hb.js izliyor.
// Biz de setTimeout ile veya content-hb.js'den tetiklenerek çalışmalıyız.
// Basitçe:
setTimeout(getHBPriceHistory, 2000); // 2sn gecikme ile dene

// URL değişimini izlemek için basit observer (content-hb.js zaten yapıyor ama bu bağımsız dosya)
let lastUrlHB = location.href;
new MutationObserver(() => {
    if (location.href !== lastUrlHB) {
        lastUrlHB = location.href;
        setTimeout(getHBPriceHistory, 2500);
    }
}).observe(document.body, { childList: true, subtree: true });
