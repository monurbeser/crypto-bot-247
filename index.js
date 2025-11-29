const axios = require('axios');

// --- AYARLAR ---
const DISCORD_URL = process.env.DISCORD_URL; // Render ayarlarından çekecek
const SENSITIVITY = process.env.SENSITIVITY || 50; // Varsayılan 50
const API_URL = 'https://api.binance.com/api/v3/ticker/24hr';

// Spam Koruması (Hafıza)
let sentAlerts = {};

console.log(`BOT BAŞLATILDI... Hassasiyet: %${SENSITIVITY}`);

if (!DISCORD_URL) {
    console.error("HATA: Discord URL bulunamadı! Lütfen Environment Variable ekleyin.");
    process.exit(1);
}

// Ana Döngü (Her 1 dakikada bir çalışır)
setInterval(runAnalysis, 60 * 1000);
runAnalysis(); // İlk başlatmada hemen çalıştır

async function runAnalysis() {
    try {
        console.log(`[${new Date().toLocaleTimeString()}] Piyasa taranıyor...`);
        const response = await axios.get(API_URL);
        const data = response.data;

        // 1. Filtreleme (USDT ve Hacim)
        let coins = data.filter(t => 
            t.symbol.endsWith('USDT') && 
            parseFloat(t.quoteVolume) > 5000000 && 
            !t.symbol.includes('DOWN') && !t.symbol.includes('UP')
        );

        // 2. Analiz Et
        const analyzed = coins.map(analyzeCoin);
        
        // 3. Puan Sıralaması
        analyzed.sort((a, b) => b.finalScore - a.finalScore);

        // 4. Baraj Puanı (Slider Mantığı)
        const threshold = 90 - (SENSITIVITY * 0.40);
        console.log(`Baraj Puanı: ${threshold}`);

        // 5. Sinyal Kontrolü
        analyzed.forEach(coin => {
            if (coin.finalScore >= threshold && coin.finalScore > 60) {
                checkAndSendAlert(coin);
            }
        });

    } catch (error) {
        console.error("API Hatası:", error.message);
    }
}

function analyzeCoin(ticker) {
    const price = parseFloat(ticker.lastPrice);
    const high = parseFloat(ticker.highPrice);
    const low = parseFloat(ticker.lowPrice);
    const change = parseFloat(ticker.priceChangePercent);
    const sym = ticker.symbol.replace('USDT', '');
    const rangePos = (price - low) / (high - low);

    let techScore = 40;
    
    // Puanlama Algoritması
    if (change > 2) techScore += 10;
    if (change > 5) techScore += 10;
    if (rangePos > 0.75) techScore += 10;
    if (rangePos < 0.15 && change < -3) techScore += 15;
    if (Math.abs(change) > 15) techScore += 5;

    let direction = "NÖTR";
    let reason = "Yatay";

    if (techScore >= 60) {
        if (rangePos > 0.65) { direction = "LONG"; reason = "Trend Güçlü"; }
        else if (rangePos < 0.2) { direction = "LONG"; reason = "Dip Tepkisi"; }
    } else if (change > 12 && rangePos > 0.9) {
        direction = "SHORT"; reason = "Aşırı Alım"; techScore = 70;
    }

    let leverage = techScore > 80 ? "20x" : (techScore > 65 ? "10x" : "5x");
    const tp = direction === "LONG" ? price * 1.03 : price * 0.97;
    const sl = direction === "LONG" ? price * 0.98 : price * 1.02;

    return { sym, price, change, finalScore: techScore, direction, leverage, tp, sl, reason };
}

async function checkAndSendAlert(coin) {
    const now = Date.now();
    const lastSent = sentAlerts[coin.sym] || 0;

    // 30 Dakika Spam Koruması
    if (now - lastSent > 30 * 60 * 1000) {
        console.log(`Sinyal Bulundu: ${coin.sym} - Puan: ${coin.finalScore}`);
        
        const isLong = coin.direction === 'LONG';
        const color = isLong ? 3066993 : 15158332; // Yeşil veya Kırmızı

        const embed = {
            title: `${isLong ? '🟢 GÜÇLÜ AL' : '🔴 GÜÇLÜ SAT'}: ${coin.sym}`,
            description: `**Puan:** ${Math.floor(coin.finalScore)}\n**Fiyat:** $${coin.price}\n**Kaldıraç:** ${coin.leverage}\n**Neden:** ${coin.reason}\n\n🎯 Hedef: $${coin.tp.toFixed(4)}\n🛑 Stop: $${coin.sl.toFixed(4)}`,
            color: color,
            footer: { text: "AI Predator 24/7 Cloud Bot" },
            timestamp: new Date().toISOString()
        };

        try {
            await axios.post(DISCORD_URL, {
                username: "Crypto Bot 24/7",
                embeds: [embed]
            });
            sentAlerts[coin.sym] = now;
            console.log("Discord bildirimi gönderildi.");
        } catch (err) {
            console.error("Discord Gönderim Hatası:", err.message);
        }
    }
}
