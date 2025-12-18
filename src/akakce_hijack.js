(function () {
    const originalParse = JSON.parse;
    // console.log("AFT: JSON Hijack başlatıldı.");

    // 1. JSON.parse Hook
    JSON.parse = function (text, reviver) {
        const parsed = originalParse(text, reviver);
        try {
            if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.d) && Array.isArray(parsed.y) && parsed.d.length > 5) {
                    window.postMessage({ type: 'AKAKCE_HIJACK_DATA', payload: parsed }, '*');
                }
                else if (Array.isArray(parsed) && parsed.length > 10 && Array.isArray(parsed[0]) && parsed[0].length === 2 && typeof parsed[0][0] === 'number') {
                    window.postMessage({ type: 'AKAKCE_HIJACK_DATA', payload: parsed }, '*');
                }
            }
        } catch (e) { }
        return parsed;
    };

    // 2. Performance Observer (Canlı İzleme)
    if (window.PerformanceObserver) {
        const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                // Sadece :s ile biten veya .js benzeri text verileri al. 
                // .png, .jpg, .css gibi statik dosyaları yoksay.
                // Hata kaynağı: name.includes("akakce-g") alan adı olduğu için her şeyi kabul ediyordu.
                if (entry.name.includes("akakce-g.akamaized.net") && entry.name.includes(":s")) {
                    window.postMessage({ type: 'AKAKCE_CDN_FOUND', url: entry.name }, '*');
                }
            });
        });
        observer.observe({ entryTypes: ["resource"] });
    }

    // 3. Mevcut kaynakları kontrol et
    function checkExisting() {
        try {
            const resources = performance.getEntriesByType("resource");
            // Sadece :s içerenleri al (Data file)
            const target = resources.find(r => r.name.includes("akakce-g.akamaized.net") && r.name.includes(":s"));
            if (target) {
                window.postMessage({ type: 'AKAKCE_CDN_FOUND', url: target.name }, '*');
            }
        } catch (e) { }
    }
    checkExisting();
    setInterval(checkExisting, 2000); // Yedek kontrol

})();
