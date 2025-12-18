from playwright.sync_api import sync_playwright
import json
import re
from datetime import datetime

def scrape_akakce_final_direct():
    # Bulduğumuz veri adresi
    cdn_url = "https://akakce-g.akamaized.net/416312584:29677:17.2:s"
    
    print("1. Tarayıcı başlatılıyor...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        
        # Referer ayarı: Sunucuya "Ben Akakçe'den geliyorum" diyoruz.
        # Bu sayede 403 Forbidden hatası almayız.
        context = browser.new_context(
            extra_http_headers={
                "Referer": "https://www.akakce.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        )
        page = context.new_page()

        print(f"2. Veri adresine gidiliyor: {cdn_url}")
        
        # Doğrudan adrese git (CORS hatasını bypass eder)
        response = page.goto(cdn_url)
        
        # Sayfanın içeriğini (body) al
        # Akakçe bu URL'de veriyi düz metin olarak (Plain Text) sunar.
        raw_text = page.locator("body").inner_text()
        
        if not raw_text or len(raw_text) < 10:
            print("HATA: Sayfa boş geldi veya veri indirilemedi.")
            print(f"Status Code: {response.status}")
            return

        print(f"\n--> Veri İndirildi! (Uzunluk: {len(raw_text)} karakter)")
        # print(f"Örnek İçerik: {raw_text[:100]}...") # Merak edersen açabilirsin

        # --- PARSE İŞLEMİ (Veriyi Çözümleme) ---
        print("3. Veri çözümleniyor...")
        
        parsed_data = []
        
        # YÖNTEM 1: JSON Formatı mı?
        if raw_text.strip().startswith(("{", "[")):
            try:
                data = json.loads(raw_text)
                if isinstance(data, dict) and 'd' in data and 'y' in data:
                    parsed_data = list(zip(data['d'], data['y']))
                    print("-> Format: Standart JSON (d/y)")
            except:
                pass
        
        # YÖNTEM 2: Regex ile Sayı Avı
        # Eğer JSON değilse veya bozuksa, içindeki [tarih, fiyat] ikililerini avlayalım.
        if not parsed_data:
            # Desen: [1709424000000, 459.9] gibi yapıları bulur
            # Açıklama: Köşeli parantez, 10-13 haneli sayı, virgül, ondalıklı sayı, kapa parantez
            pattern = r'\[\s*(\d{10,13})\s*,\s*(\d+(?:\.\d+)?)\s*\]'
            matches = re.findall(pattern, raw_text)
            
            if matches:
                print(f"-> Regex ile {len(matches)} veri noktası kurtarıldı.")
                for m in matches:
                    parsed_data.append((float(m[0]), float(m[1])))
        
        # --- SONUÇLARI GÖSTER VE KAYDET ---
        if parsed_data:
            print("\n" + "="*50)
            print("SONUÇLAR (Son 15 Gün)")
            print("="*50)
            
            # Tarihe göre sırala
            parsed_data.sort(key=lambda x: x[0])
            
            clean_list = []
            seen_dates = set()
            
            for ts, price in parsed_data:
                # Timestamp düzeltmesi (Milisaniye -> Saniye)
                if ts > 100000000000: ts /= 1000
                
                date_str = datetime.fromtimestamp(ts).strftime('%d-%m-%Y')
                
                # Sadece son verileri ve tekrar etmeyenleri alalım
                # (Akakçe bazen aynı gün için birden fazla fiyat verir, sonuncusunu alalım)
                # Buradaki mantık: Aynı gün gelirse üzerine yazarız, böylece günün son fiyatı kalır.
                
                # Listeye ekleme mantığı (Basitleştirilmiş)
                print(f"Tarih: {date_str} \t| Fiyat: {price} TL")
                
                # Temiz listeye ekle (Mükerrer kontrolü yapmadan tüm geçmişi verelim)
                clean_list.append({"tarih": date_str, "fiyat": price})

            # JSON Dosyasına Kaydet
            with open("akakce_fiyat_gecmisi_final.json", "w", encoding="utf-8") as f:
                json.dump(clean_list, f, ensure_ascii=False, indent=4)
                
            print("\n" + "="*50)
            print(f"Tüm veriler 'akakce_fiyat_gecmisi_final.json' dosyasına kaydedildi.")
            print("İşlem Başarıyla Tamamlandı.")
            
        else:
            print("\n[UYARI] Veri indirildi ama bilinen formatlara uymuyor.")
            print("Ham veriyi incelemek için 'raw_data_dump.txt' dosyasına bakınız.")
            with open("raw_data_dump.txt", "w", encoding="utf-8") as f:
                f.write(raw_text)

        browser.close()

if __name__ == "__main__":
    scrape_akakce_final_direct()