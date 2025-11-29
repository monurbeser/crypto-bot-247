const axios = require('axios');
const http = require('http');

// --- 1. RENDER İÇİN KAPILARI AÇMA (DÜZELTİLDİ) ---
// Render otomatik olarak PORT değişkenini atar.
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Bot Aktif ve Calisiyor!');
});

// KİLİT NOKTA: '0.0.0.0' olmak zorunda. Yoksa Render göremez.
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ WEB SUNUCUSU BAŞLATILDI: Port ${PORT}`);
});
// -----------------------------------------------------

// --- 2. BOT AYARLARI ---
const DISCORD_URL = process.env.DISCORD_URL; 
const SHEET_URL = process.env.SHEET_URL; 
const SENSITIVITY = process.env.SENSITIVITY || 50; 
const API_URL = 'https://api.binance.com/api/v3/ticker/24hr';

let sentAlerts = {}; 

console.log(`🤖 ULTRA BOT BAŞLATILDI... Hassasiyet: %${SENSITIVITY}`);

if (!DISCORD_URL) {
    console.error("UYARI: Discord URL yok. Bildirim gitmeyecek.");
}

// 3. DÖNGÜYÜ BAŞLAT (Her 60 saniyede bir)
setInterval(runAnalysis, 60 * 1000);

// İlk taramayı hemen yapma, sunucu otursun diye 5 saniye bekle
setTimeout(runAnalysis, 5000);

async function runAnalysis() {
    try {
        const now = new Date();
        // Saat dilimi ayarı
        const timeStr = now.toLocaleTimeString('tr-TR', { 
            timeZone: 'Europe/Istanbul', 
            hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' 
        });

        console.log(`[${timeStr}] 🔍 Piyasa taranıyor...`);
        
        let response;
        try {
            response = await axios.get(API_URL);
        } catch (apiErr) {
            console.error("Binance API Hatası:", apiErr.message);
            return;
        }

        const data = response.data;

        // FİLTRELEME
        let coins = data.filter(t => 
            t.symbol.endsWith('USDT') && 
            parseFloat(t.quoteVolume) > 10000000 && 
            !t.symbol.includes('DOWN') && !t.symbol.includes('UP')
        );

        // ANALİZ
        const analyzed = coins.map(analyzeCoin);
        analyzed.sort((a, b) => b.finalScore - a.finalScore);

        // BARAJ PUANI
        const threshold = 90 - (SENSITIVITY * 0.40);

        // SİNYAL KONTROLÜ
        for (const coin of analyzed) {
            if (coin.finalScore >= threshold && coin.finalScore > 60) {
                const lastSent = sentAlerts[coin.sym] || 0;
                
                // 45 Dakika Spam Koruması
                if (Date.now() - lastSent > 45 * 60 * 1000) { 
                    await sendDiscordAlert(coin, timeStr);
                    if (SHEET_URL) await logToSheets(coin, timeStr);
                    sentAlerts[coin.sym] = Date.now();
                }
            }
        }

    } catch (error) {
        console.error("Döngü Hatası:", error.message);
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
    
    if (change > 2) techScore += 10;
    if (change > 5) techScore += 10;
    if (rangePos > 0.8) techScore += 10;
    if (rangePos < 0.15 && change < -3) techScore += 15;
    if (Math.abs(change) > 10) techScore += 5; 

    let direction = "NÖTR";
    let reason = "Yatay";

    if (techScore >= 60) {
        if (rangePos > 0.7) { direction = "LONG"; reason = "Trend Güçlü"; }
        else if (rangePos < 0.2) { direction = "LONG"; reason = "Dip Tepkisi"; }
    } else if (change > 15 && rangePos > 0.95) {
        direction = "SHORT"; reason = "Aşırı Alım"; techScore = 75;
    }

    let tp, sl, riskReward;
    if (direction === "LONG") {
        if (techScore > 80) {
            tp = price * 1.06; sl = price * 0.985; riskReward = "Agresif (1:4)";
        } else {
            tp = price * 1.03; sl = price * 0.98; riskReward = "Standart (1:1.5)";
        }
    } else { 
        if (techScore > 80) {
            tp = price * 0.94; sl = price * 1.015; riskReward = "Agresif (1:4)";
        } else {
            tp = price * 0.97; sl = price * 1.02; riskReward = "Standart (1:1.5)";
        }
    }

    let leverage = techScore > 80 ? "20x" : (techScore > 65 ? "10x" : "5x");
    return { sym, price, change, finalScore: techScore, direction, leverage, tp, sl, reason, riskReward };
}

async function sendDiscordAlert(coin, timeStr) {
    if (!DISCORD_URL) return;
    
    const isLong = coin.direction === 'LONG';
    const color = isLong ? 3066993 : 15158332; 

    const embed = {
        title: `${isLong ? '🟢 GÜÇLÜ AL' : '🔴 GÜÇLÜ SAT'}: ${coin.sym}`,
        description: `⏱ **Saat:** ${timeStr}\n📊 **Puan:** ${Math.floor(coin.finalScore)}\n💰 **Fiyat:** $${coin.price}\n\n🎯 **Hedef:** $${coin.tp.toFixed(4)}\n🛡️ **Stop:** $${coin.sl.toFixed(4)}\n⚖️ **R/R:** ${coin.riskReward}\n\n💡 **AI:** ${coin.reason}\n🚀 **Lev:** ${coin.leverage}`,
        color: color,
        footer: { text: "AI Predator Cloud Bot" }
    };

    try {
        await axios.post(DISCORD_URL, {
            username: "Crypto Bot 24/7",
            embeds: [embed]
        });
        console.log(`✅ Discord Gönderildi: ${coin.sym}`);
    } catch (err) {
        console.error("Discord Hatası:", err.message);
    }
}

async function logToSheets(coin, timeStr) {
    try {
        await axios.post(SHEET_URL, {
            date: timeStr,
            symbol: coin.sym,
            type: coin.direction,
            price: coin.price,
            tp: coin.tp.toFixed(4),
            sl: coin.sl.toFixed(4),
            score: Math.floor(coin.finalScore)
        });
        console.log(`✅ Sheet Kaydedildi: ${coin.sym}`);
    } catch (err) {
        console.error("Sheets Hatası:", err.message);
    }
}
