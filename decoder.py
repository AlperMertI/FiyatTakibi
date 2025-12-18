import json
from datetime import datetime, timedelta

def decode_akakce_data():
    # Sizin paylaştığınız ham veri (raw_data_dump.txt içinden alındı)
    raw_string = "69990.,51991n3,46793n7,44309n30,44951n21,43691n6,39322n7,38547n3,34693..,43024.,74990.,71200n9,36300n7,32600n6,29300n7,69990n3,46193n5,44309n14,39081n3,32133n3,30126n7,31201n4,29452n7,44154n6,31791n8,29126n5,30292n6,28333n13,25500n3,27052n11,26268n7,23641.,22409..,26783.,26817n7,26922n4,21399.,19199,15359..,13799.,22689,70217n3,64800,64800n9,52663..,46749,44412..,42099n3,46990..,45984n3,43685..,46990n4,49589n7,46118,45444.,42151..,42717n9,44334n3,45648,45444.,40900n3,36810.,33129.,29816.,26833..,29677n3,29677"
    
    print("Veri çözümleniyor...")
    
    price_history = []
    
    # Veriyi parçalarına ayır
    tokens = raw_string.split(',')
    
    # Veriler genellikle sondan başa (bugünden geçmişe) veya tam tersi olabilir.
    # Akakçe _PRGJ değişkeni genelde kronolojiktir (Eskiden Yeniye).
    # Listenin sonundaki 29677 (296 TL) güncel fiyata benziyorsa sıralama doğrudur.
    
    for token in tokens:
        days_to_repeat = 0
        price_val = 0
        
        # 1. Durum: 'n' harfi ile sıkıştırma (örn: 51991n3)
        if 'n' in token:
            parts = token.split('n')
            price_val = int(parts[0])
            days_to_repeat = int(parts[1]) # n'den sonraki sayı kadar ekle
            total_days = 1 + days_to_repeat
            
        # 2. Durum: '.' ile sıkıştırma (örn: 69990..)
        elif '.' in token:
            dots = token.count('.')
            price_val = int(token.replace('.', ''))
            days_to_repeat = dots # Nokta sayısı kadar ekle
            total_days = 1 + days_to_repeat
            
        # 3. Durum: Tek gün (örn: 46118)
        else:
            price_val = int(token)
            total_days = 1
            
        # Fiyatı TL'ye çevir (Kuruş -> Lira)
        # Örnek: 69990 -> 699.90 TL
        final_price = float(price_val) / 100
        
        # Listeye ekle (Tekrar sayısı kadar)
        for _ in range(total_days):
            price_history.append(final_price)
            
    print(f"Toplam {len(price_history)} günlük veri çıkarıldı.")
    
    # TARİHLERİ OLUŞTUR
    # Veri setinin son günü "Bugün" kabul edilir ve geriye doğru tarih atanır.
    today = datetime.now()
    dates_prices = []
    
    # Listeyi tersten gezerek bugünden geçmişe tarih verelim
    # (Ya da tam tersi: Listenin sonu bugündür.)
    
    for i in range(len(price_history)):
        # Sondan başa doğru indis: -1, -2, -3...
        price = price_history[-(i+1)]
        
        # Tarih hesapla: Bugün - i gün
        date_obj = today - timedelta(days=i)
        date_str = date_obj.strftime("%d-%m-%Y")
        
        dates_prices.append({"tarih": date_str, "fiyat": price})
    
    # Sonuçları kronolojik sıraya sok (Eskiden yeniye)
    dates_prices.reverse()
    
    print("\n" + "="*40)
    print("SONUÇLAR (Son 15 Gün)")
    print("="*40)
    
    for item in dates_prices[-15:]:
        print(f"Tarih: {item['tarih']} | Fiyat: {item['fiyat']:.2f} TL")
        
    # JSON Kaydı
    with open("akakce_cozulmus_veri.json", "w", encoding="utf-8") as f:
        json.dump(dates_prices, f, ensure_ascii=False, indent=4)
        
    print(f"\nVeriler 'akakce_cozulmus_veri.json' dosyasına kaydedildi.")

if __name__ == "__main__":
    decode_akakce_data()