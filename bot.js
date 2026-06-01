// ============================================================
//  SlaydTop Bot — MUKAMMAL MULOYIM VERSION
//  16 ta xizmat, 4 til, Groq AI, bepul foydalanish
//  Yozgi aksiya: 2 OY BEPUL + 3 ta do'st = MUTLAQO BEPUL
// ============================================================

const { Telegraf, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const Database = require('better-sqlite3');
const PptxGenJS  = require('pptxgenjs');
const Jimp       = require('jimp');
const PDFDocument = require('pdfkit');
const fs         = require('fs');
const path       = require('path');
const http       = require('http');
const { execSync, spawn } = require('child_process');
const https      = require('https');

// ==================== KONFIGURATSIYA ====================
const BOT_TOKEN      = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const GROQ_KEY       = (process.env.GROQ_API_KEY       || '').trim();
const ADMIN_ID       = Number(process.env.ADMIN_ID     || 0);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME       || 'admin';
const ADMIN_PHONE    = process.env.ADMIN_PHONE          || '+998901234567';
const BOT_USERNAME   = process.env.BOT_USERNAME         || 'SlaydTop_2_bot';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'SlaydTop_01';
const CARD_NUMBER = process.env.CARD_NUMBER || '';
const CARD_OWNER  = process.env.CARD_OWNER  || '';

console.log('GROQ:', GROQ_KEY ? `OK (${GROQ_KEY.length} belgi)` : 'YOQ!');
if (!BOT_TOKEN) { console.error('TELEGRAM_BOT_TOKEN topilmadi!'); process.exit(1); }

// ==================== PAPKALAR ====================
const DATA_DIR      = path.join(__dirname, 'data');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const TEMP_DIR      = path.join(__dirname, 'temp');
[DATA_DIR, TEMPLATES_DIR, TEMP_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ==================== SQLITE DATABASE ====================
const db = new Database(path.join(DATA_DIR, 'slaydtop.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, data TEXT);
  CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, data TEXT);
  CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data TEXT);
  CREATE TABLE IF NOT EXISTS contact_messages (id TEXT PRIMARY KEY, data TEXT);
`);

function loadJson(filePath, def) {
    const table = filePath.includes('users') ? 'users' : filePath.includes('payments') ? 'payments' : 'orders';
    if (table === 'users') {
        const rows = db.prepare('SELECT id, data FROM users').all();
        if (!rows.length) return def;
        const obj = {};
        rows.forEach(r => { obj[r.id] = JSON.parse(r.data); });
        return obj;
    } else {
        const rows = db.prepare(`SELECT data FROM ${table}`).all();
        return rows.length ? rows.map(r => JSON.parse(r.data)) : def;
    }
}
function saveJson(filePath, data) {
    const table = filePath.includes('users') ? 'users' : filePath.includes('payments') ? 'payments' : 'orders';
    if (table === 'users') {
        const insert = db.prepare('INSERT OR REPLACE INTO users (id, data) VALUES (?, ?)');
        const run = db.transaction((obj) => { Object.entries(obj).forEach(([k, v]) => insert.run(k, JSON.stringify(v))); });
        run(data);
    } else {
        const insert = db.prepare(`INSERT OR REPLACE INTO ${table} (id, data) VALUES (?, ?)`);
        const run = db.transaction((arr) => { arr.forEach(v => insert.run(v.id, JSON.stringify(v))); });
        run(data);
    }
}

const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const ORDERS_FILE   = path.join(DATA_DIR, 'orders.json');

// ==================== NARXLAR ====================
const PRICES = {
    slide_small : 0,
    slide_big   : 0,
    test        : 0,
    crossword   : 0,
    essay       : 0,
    referat     : 0,
    tezis       : 0,
    maqola      : 0,
    infografika : 0,
    rasm        : 0,
    pdf         : 0
};
const FREE_SLIDES = 9999;

// ========== YOZ AKSIYASI REJIMI ==========
const SUMMER_FREE = true;
const SUMMER_END = new Date('2025-09-01T00:00:00');

function isSummerFree() {
    return true; // 2026 yil bepul davr
}

// ==================== YORDAMCHI: TIL Olish ====================
function getLang(userId) {
    const users = loadJson(USERS_FILE, {});
    return users[userId]?.lang || 'uz';
}

// ==================== KO'P TILLI MATNLAR (MUKAMMAL MULOYIM) ====================
const T = {
    uz: {
        welcome: `🌟 Assalomu alaykum!\n\n*SlaydTop* botiga xush kelibsiz! 👋\n\nSizni ko'rib turganimizdan juda xursandmiz! 😊\nIltimos, tilni tanlang:`,
        enterName: `✨ Ajoyib tanlov!\n\nKeling, tanishib olaylik, do'stim 😊\n\n*Ismingizni kiriting:*\n_(Masalan: Sardor)_`,
        registered: (name) =>
            `🎉 *Tabriklaymiz, ${name}!* 🎉\n\n` +
            `✅ Siz muvaffaqiyatli ro'yxatdan o'tdingiz!\n\n` +
            `🎁 *SIZGA SOVG'A:* 2 OY davomida barcha xizmatlardan *MUTLAQO BEPUL* foydalanish!\n\n` +
            `📅 *Aksiya muddati:* 1-Sentabrgacha\n` +
            `📢 *Shart:* @SlaydTop_01 kanalida qolishingiz kerak\n\n` +
            `🔥 *SUPER AKSiya:* Faqat 3 ta do'stingizni taklif qilsangiz — *MUTLAQO BEPUL* foydalanish imkonini *umrbod* qo'lga kiritasiz!\n\n` +
            `Keling, boshlaymiz! 👇`,
        mainMenu: (name) => `${name} jon, xizmatni tanlang 👇\n\n📢 *Yagona shart:* @SlaydTop_01 kanalimizga a'zo bo'lsangiz kifoya!\n🔥 Hech qanday cheklovlarsiz, bemalol foydalaning! 😊`,
        balance: (u) => {
            const now = new Date();
            const freeUntil = u.freeUntil ? new Date(u.freeUntil) : null;
            const isFree = isSummerFree() || (freeUntil && now < freeUntil);
            let tariffText = isFree ? '✅ *MUTLAQO BEPUL* (2 oy davomida)' : '💳 *To\'lovli rejim*';
            if (u.invitedCount >= 3) tariffText = '🎁 *MUTLAQO BEPUL* (Do\'stlar taklifi orqali — umrbod!)';
            return `💰 *Sizning hisobingiz*\n\n` +
                `👤 *Ism:* ${u.name}\n` +
                `💳 *Balans:* ${(u.balance||0).toLocaleString()} so'm\n` +
                `📊 *Tarif:* ${tariffText}\n` +
                `👥 *Taklif qilganlar:* ${u.invitedCount || 0} ta\n` +
                `📋 *Jami buyurtmalar:* ${u.totalOrders||0} ta`;
        },
        cancel: '❌ Bekor qilish',
        back: '🏠 Asosiy Menyu',
        lowBalance: (need, has) =>
            `😊 Kechirasiz, balansingiz yetarli emas\n\n` +
            `💰 Kerak: ${need.toLocaleString()} so'm\n` +
            `💳 Sizda: ${has.toLocaleString()} so'm\n\n` +
            `Afsuski, hozircha to'lov tizimi vaqtincha yopiq. \n` +
            `Ammo xotirjam bo'ling! Sizga 2 OY *BEPUL* foydalanish berilgan! 🎁`,
        payClick: (sum) => `💳 CLICK orqali to'lov\n\n💰 Summa: ${sum.toLocaleString()} so'm\n🏦 Karta: ${CARD_NUMBER}\n👤 Ism: ${CARD_OWNER}\n\n✅ To'lov qilgandan so'ng CHEK rasmini yuboring!`,
        payPayme: (sum) => `💳 PAYME orqali to'lov\n\n💰 Summa: ${sum.toLocaleString()} so'm\n🏦 Karta: ${CARD_NUMBER}\n👤 Ism: ${CARD_OWNER}\n\n✅ To'lov qilgandan so'ng CHEK rasmini yuboring!`,
        checkReceived: `⏳ Chekingiz qabul qilindi!\n\nAdmin tekshirib, balansingizni to'ldiradi.\nOdatda 5-15 daqiqa ichida ✅`,
        payApproved: (amount, newBal) => `✅ To'lovingiz tasdiqlandi! 🏆\nBalansingizga ${amount.toLocaleString()} so'm qo'shildi!\n💰 Yangi balans: ${newBal.toLocaleString()} so'm`,
        free: (userId, botUser, invitedCount) => {
            const remain = Math.max(0, 3 - (invitedCount || 0));
            return `🎁 *Bepul foydalanish olish usullari*\n\n` +
                `1️⃣ *Rasmdan PDF* — DOIMO BEPUL ♾️\n\n` +
                `2️⃣ *Aksiya:* Sizda hozir 2 OY BEPUL foydalanish bor!\n\n` +
                `3️⃣ *Do'stlaringizni taklif qiling!*\n` +
                `   👥 Hozircha: ${invitedCount || 0} ta\n` +
                `   🎯 Yana ${remain} ta do'st taklif qilsangiz → *UMRBOD BEPUL!*\n\n` +
                `🔗 *Sizning havolangiz:*\nhttps://t.me/${botUser}?start=ref_${userId}`;
        },
        settings: (u) => `⚙️ *Sozlamalar*\n\n👤 Ism: ${u.name}\n🌐 Til: O'zbek 🇺🇿`,
        help: `❓ *Yordam markazi*\n\nQuyidagi tugmalardan birini tanlang:`,
        helpDetails: `📖 *BOTDAN FOYDALANISH BO'YICHA Qo'LLANMA*\n\n` +
            `*/start* — Botni ishga tushirish. Til tanlash va ro'yxatdan o'tish.\n\n` +
            `*/restart* — Botni qayta ishga tushirish. Agar nimadir to'g'ri ishlamayotgandab os'ani qayta boshlash.\n\n` +
            `*/manuel* — Bu qo'llanmani ko'rish. Bot qanday ishlashini tushunish uchun.\n\n` +
            `*/yordam* — Yordam markazi. Texnik muammolar, to'lov savollari, admin bilan bog'lanish.\n\n` +
            `*/admin* — Admin bilan bog'lanish. Savollaringizni yozing, 1 daqiqadan 10 soatgacha javob beramiz!\n\n` +
            `*/sozlama* — Tilni o'zgartirish va sozlamalar.\n\n` +
            `*QANDAY ISHLATISH?*\n` +
            `1️⃣ Start tugmasini bosing\n` +
            `2️⃣ Tilni tanlang\n` +
            `3️⃣ Ismingizni kiriting\n` +
            `4️⃣ @SlaydTop_01 kanaliga a'zo bo'ling\n` +
            `5️⃣ Xizmatni tanlang va foydalaning!\n\n` +
            `*SUPER AKSiya:* 3 ta do'stingizni taklif qilsangiz — UMRBOD BEPUL! 🎁`,
        adminMsg: `👨‍💻 *Admin bilan bog'lanish*\n\nXabaringizni shu yerga yozing, hurmatli foydalanuvchi! 💬\n\n⏰ Savollaringizga 1 daqiqadan 10 soat ichida aniq javob qaytariladi.\n\nIltimos, savolingizni batafsil yozing:`,
        msgSent: `✅ Xabaringiz adminga yuborildi! 🎉\n\nTez orada javob beramiz, sabrli bo'ling! 😊`,
        creating: `⏳ *Tayyorlanmoqda...*\n\n🤖 AI ma'lumot yig'moqda\n🎨 Dizayn qilinmoqda\n📎 Fayl tayyorlanmoqda\n\nBu 15-30 soniya davom etadi, iltimos kuting ⌛`,
        ready: (type, topic, price) => `✅ *${type} tayyor!* 🎉\n\n📌 Mavzu: ${topic}\n💰 Narx: ${price > 0 ? price.toLocaleString()+' so\'m' : 'MUTLAQO BEPUL 🎁'}\n\n1️⃣ dan 5️⃣ gacha baholang:`,
        rateThank: (r) => r===5 ? '👏 Ajoyib! Katta rahmat, do\'stim!' : r>=4 ? '👏 Juda yaxshi! Rahmat!' : r>=3 ? '🙂 Rahmat! Yana yaxshilashga harakat qilamiz!' : '🙏 Fikringiz uchun rahmat!',
        error: `😊 Kichik nosozlik yuz berdi. Iltimos, qayta urinib ko'ring!\nAgar muammo takrorlansa, /yordam bo'limiga murojaat qiling.`,
        invalidInput: `😊 Iltimos, to'g'ri ma'lumot kiriting. Yordam uchun /yordam ni bosing.`,
        pdfFree: `📄 *Rasmdan PDF* — MUTLAQO BEPUL! 🎁\n\nRasmingizni yuboring, men PDF ga aylantirib beraman!\n\n✅ JPG, PNG, WEBP qabul qilinadi\n✅ Bir vaqtda 10 tagacha rasm\n✅ Cheksiz foydalanish mumkin\n\nRasmni yuboring: 👇`,
        pdfGot: (n) => `✅ Rasm qabul qilindi! (${n} ta)\n\nYana rasm qo'shmoqchimisiz?`,
        pdfDone: (n) => `🎉 PDF tayyor!\n\n${n} ta rasmdan PDF yaratildi.\nYuklab oling! ⬇️`,
        slideCreate: '🎞 Yangi Slayd',
        imgToPdf: '📄 Rasmdan PDF',
        referatMustaqil: '📚 Referat / Mustaqil Ish',
        essayEsse: '✍ Insho / Esse',
        test: '📝 Yangi Test',
        crossword: '🔲 Yangi Krassvord',
        tezis: '🎓 Tezis',
        maqola: '📰 Maqola',
        infografika: '📊 Infografika',
        rasmYaratish: '🖼 Rasm Yaratish (AI)',
        qrKod: '🔗 QR Kod',
        pdfSiqish: '📦 PDF Siqish',
        audioToMp3: '🎬 Audio/Video → MP3',
        pptxToPdf: '📊 PPTX → PDF',
        docxToPdf: '📝 DOCX → PDF',
        pdfToWord: '📄 PDF → Word',
        balansim: '💰 Mening Hisobim',
        bepulOlish: '🎁 Bepul Olish',
        yordam: '❓ Yordam',
        sozlamalar: '⚙ Sozlamalar',
        adminPanel: '👨‍💻 Admin Panel',
        slideCountPrompt: (topic) => `🎯 Mavzu qabul qilindi: *${topic}*\n\nNechta slayd bo'lsin?`,
        slidePackageInfo: (topic, count, price, paket, isFree) =>
            `${paket.emoji} ${paket.nom} Paketi\n\n📌 Mavzu: ${topic}\n📊 Slaydlar: ${count} ta\n💰 Narx: ${price > 0 ? price.toLocaleString() + ' so\'m' : 'MUTLAQO BEPUL 🎁'}\n\n🎨 Shablon tanlang yoki shablonsiz davom eting:\n💡 2 ta raqam yozsangiz (masalan: 3 7) — 2 xil variant olasiz!`,
        slideCreating: (paket, isDual) =>
            `⏳ ${paket.emoji} ${paket.nom} paketi tayyorlanmoqda...\n\n🤖 AI ma'lumot yig'moqda\n🎨 Dizayn ishlanmoqda\n` +
            (isDual ? `🎁 2 ta variant tayyorlanmoqda\n` : '') +
            `📎 Fayl yaratilmoqda\n\nBu 20-40 soniya davom etadi ⌛`,
        slideReady1: (paket, topic, count, price, isFree) =>
            `✅ *Slaydingiz tayyor!* 🎉\n\n${paket.emoji} Paket: ${paket.nom}\n📌 Mavzu: ${topic}\n📊 ${count} ta slayd\n💰 ${isFree ? 'MUTLAQO BEPUL 🎁' : price.toLocaleString()+' so\'m'}`,
        slideReady2: (paket, isFree, price) =>
            `✅ *Ikkala variant tayyor!* 🎉\n\n${paket.emoji} Paket: ${paket.nom}\n💰 Narx: ${isFree ? 'MUTLAQO BEPUL 🎁' : price.toLocaleString()+' so\'m'}\n\nYoqqanini saqlang! 😊`,
        slideVariant: (n, tmpl, topic, count) => `🎨 Variant ${n} — Shablon #${tmpl?.replace('template_','')||'A'}\n📌 ${topic}\n📊 ${count} ta slayd`,
        testPrompt: (balance, price) => `📝 *Test Yaratish*\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: MUTLAQO BEPUL 🎁\n\nTest mavzusini kiriting:\n_(Masalan: Biologiya — O\'simliklar haqida)_`,
        testReady: (topic, count, price) => `✅ *Test tayyor!* 🎉\n\n📌 Mavzu: ${topic}\n📝 ${count} ta savol\n💰 MUTLAQO BEPUL 🎁`,
        crossPrompt: (balance, price) => `🔲 *Krassvord Yaratish*\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: MUTLAQO BEPUL 🎁\n\nMavzuni kiriting:\n_(Masalan: Jahon geografiyasi)_`,
        crossReady: (topic, count, price) => `✅ *Krassvord tayyor!* 🎉\n\n📌 Mavzu: ${topic}\n🔲 ${count} ta savol\n💰 MUTLAQO BEPUL 🎁`,
        essayTypePrompt: (balance, price) => `✍️ *Insho yoki Esse?*\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: MUTLAQO BEPUL 🎁 (500-1000 so'z)`,
        essayTopicPrompt: (type, balance, price) => `✍️ *${type === 'insho' ? 'Insho' : 'Esse'} mavzusini kiriting:*\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: MUTLAQO BEPUL 🎁`,
        essayReady: (type, topic, words, price) => `✅ *${type === 'insho' ? 'Insho' : 'Esse'} tayyor!* 🎉\n\n📌 Mavzu: ${topic}\n✍️ ${words} so'z\n💰 MUTLAQO BEPUL 🎁`,
        referatTypePrompt: (balance, price) => `📚 *Referat yoki Mustaqil Ish?*\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: MUTLAQO BEPUL 🎁 (10-20 bet)`,
        referatTopicPrompt: (type) => `📚 *${type === 'referat' ? 'Referat' : 'Mustaqil Ish'} mavzusini kiriting:*`,
        referatReady: (type, topic, pages, price) => `✅ *${type === 'referat' ? 'Referat' : 'Mustaqil ish'} tayyor!* 🎉\n\n📌 Mavzu: ${topic}\n📋 ${pages} bet\n💰 MUTLAQO BEPUL 🎁`,
        tezisPrompt: (balance, price) => `🎓 *Tezis Yaratish*\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: MUTLAQO BEPUL 🎁 (3-10 bet)\n\nMavzuni kiriting:`,
        tezisReady: (topic, pages, price) => `✅ *Tezis tayyor!* 🎉\n\n📌 Mavzu: ${topic}\n📋 ${pages} bet\n💰 MUTLAQO BEPUL 🎁`,
        maqolaPrompt: (balance, price) => `📰 *Maqola Yaratish*\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: MUTLAQO BEPUL 🎁 (3-10 bet)\n\nMavzuni kiriting:`,
        maqolaReady: (topic, pages, price) => `✅ *Maqola tayyor!* 🎉\n\n📌 Mavzu: ${topic}\n📋 ${pages} bet\n💰 MUTLAQO BEPUL 🎁`,
        infoPrompt: (balance, price) => `📊 *Infografika Yaratish*\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: MUTLAQO BEPUL 🎁\n\nMavzu yoki qisqa ma'lumot kiriting:\n_(Masalan: O\'zbekiston aholisi haqida)_`,
        infoReady: (topic, price) => `✅ *Infografika tayyor!* 🎉\n\n📌 Mavzu: ${topic}\n💰 MUTLAQO BEPUL 🎁`,
        rasmPrompt: (balance, price) => `🖼 *AI Rasm Yaratish*\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: MUTLAQO BEPUL 🎁\n\nRasm tavsifini kiriting:\n_(Masalan: tog\'lar orasidagi ko\'l, kech vaqti, rangli)_`,
        rasmReady: (price, prompt) =>
            `🖼 *AI Rasm uchun Professional Prompt Tayyor!* 🎉\n\n💰 MUTLAQO BEPUL 🎁\n\n📝 Quyidagi promptni Midjourney, DALL-E yoki Stable Diffusion da ishlating:\n\n${prompt.slice(0, 900)}`,
        slideInfo: (balance) =>
            `✨ *Slayd Yaratish*\n\n💰 Balansingiz: ${(balance||0).toLocaleString()} so'm\n\n📦 Paketlar:\n` +
            `🎁 Sinov — MUTLAQO BEPUL\n⚡ Iqtidor — MUTLAQO BEPUL\n💎 Professional — MUTLAQO BEPUL\n👑 Premium — MUTLAQO BEPUL\n🌟 Infinity — MUTLAQO BEPUL\n\n📌 Mavzuni kiriting:`,
        chooseCount: 'Nechta?',
        chooseDiff: 'Qiyinlik darajasini tanlang:',
        chooseTopic: '✍️ Ajoyib! Mavzuni yozing:',
        choosePages: 'Nechta bet?',
        enterWords: 'Nechta so\'z bo\'lsin?',
        chooseType: 'Turini tanlang:',
        templateInfo: (channel, site) =>
            `🎨 Bizda 50 ta premium shablon bor!\n\n📲 Ko'rish uchun:\n1️⃣ Kanal: ${channel}\n2️⃣ Sayt: ${site}\n\n` +
            `✅ Ko'rib chiqqach, 2 ta shablon raqamini yuboring!\n📌 Masalan: 3 7\n(Ikki raqam — ikki xil dizayn siz uchun tayyorlanadi 🎁)`,
        nameTooShort: 'Iltimos, to\'g\'ri ism kiriting (kamida 2 harf):',
        surnameTooShort: 'Iltimos, to\'g\'ri familya kiriting:',
        topicTooShort: 'Mavzu juda qisqa. Batafsilroq yozing:',
        infoTooShort: 'Ma\'lumot juda qisqa:',
        pdfCreating: '⏳ PDF yaratilmoqda... ⌛',
        pdfNoImages: 'Rasmlar topilmadi.',
        pdfMaxImages: 'Maksimal 10 ta rasm yuklandi. PDF yaratilmoqda...',
        pdfSendMore: '📸 Rasmni yuboring:',
        pdfCreateOrSend: '📸 Rasmni yuboring yoki "PDF yaratish" tugmasini bosing:',
        paymentChoose: 'To\'lov usulini tanlang:',
        paymentClick: 'Click',
        paymentPayme: 'Payme',
        paymentAdmin: 'Admin bilan bog\'lanish',
        paymentSendCheck: 'Chek yuborish',
        paymentCheckSent: 'Chek yuborildi!',
        adminContactInfo: (username, phone) => `👨‍💻 Admin bilan bog\'lanish:\nTelegram: @${username}\nTel: ${phone}\n\n⏰ Javob vaqti: 1 daqiqadan 10 soatgacha`,
        helpBot: `🔄 /start bosing yoki /restart komandasini yuboring.\n\nAgar muammo davom etsa, @${CHANNEL_USERNAME} ga yozing.`,
        helpPayment: (username, phone) => `💳 To\'lov muammosi uchun adminga murojaat qiling: @${username}\nTel: ${phone}`,
        helpFile: (username) => `📄 Fayl kelmagan bo\'lsa, /start bosing va qayta urinib ko\'ring.\nAdmin: @${username}`,
        editNamePrompt: '✏️ Yangi ismingizni kiriting:',
        editSurnamePrompt: '✏️ Yangi familyangizni kiriting:',
        nameUpdated: '✅ Ism yangilandi!',
        surnameUpdated: '✅ Familya yangilandi!',
        cancelDone: '✅ Bekor qilindi. Asosiy menyuga qaytish...',
        ratingPrompt: '1️⃣ dan 5️⃣ gacha baholang:',
        checkSendPrompt: `✅ To\'lov qilgandan so\'ng CHEK rasmini yuboring!`,
        referralMsg: (count) => `🎁 ${count} ta do\'stingiz qo'shildi! Sizga umrbod BEPUL foydalanish berildi! 🎉`,
        balanceAdminAdd: (amount) => `🎁 Admin balansingizga ${parseInt(amount).toLocaleString()} so'm qo'shdi!`,
        broadcastDone: (sent, failed) => `✅ Yuborildi: ${sent}\n❌ Xato: ${failed}`,
        broadcasting: (count) => `⏳ ${count} ta foydalanuvchiga yuborilmoqda...`,
        noPendingPayments: '✅ Kutilayotgan to\'lovlar yo\'q.',
        pendingPaymentsHeader: (count) => `💰 Kutilayotgan to\'lovlar (${count}):\n\n`,
        paymentApprovedAdmin: (userId, amount) => `✅ To\'lov tasdiqlandi! Foydalanuvchi: ${userId}, Summa: ${parseInt(amount).toLocaleString()} so'm`,
        approveFormatError: '❌ Format: /approve PAYMENT_ID',
        approveNotFound: '❌ To\'lov topilmadi yoki allaqachon tasdiqlangan!',
        balanceFormatError: '❌ Format: /balance USER_ID SUMMA',
        noAccess: '🔒 Kechirasiz, sizga ruxsat yo\'q!',
        restored: '🔄 Qayta ishga tushirildi! Keling, boshlaymiz! 👋',
        defaultReply: (name) => `${name} jon, xizmatni tanlang 👇`,
        imgUploadError: 'Rasm yuklab olishda xato yuz berdi. Qayta yuboring.',
        pdfBuildError: 'PDF yaratishda xatolik.',
        adminStats: (users, orders, revenue) =>
            `📊 Statistika\n👥 ${users} foydalanuvchi\n📋 ${orders} buyurtma\n💵 ${revenue.toLocaleString()} so'm daromad`,
        adminPanelInfo: (users, pending, orders, revenue) =>
            `👨‍💻 Admin Panel\n\n👥 Foydalanuvchilar: ${users}\n💰 Kutilayotgan to\'lovlar: ${pending}\n📊 Buyurtmalar: ${orders}\n💵 Jami daromad: ${revenue.toLocaleString()} so'm`,
        contactAdminPrompt: 'Xabaringizni yozing:',
        newContactMsg: (name, surname, username, userId, text) =>
            `👨‍💻 Yangi murojaat!\n\nKim: ${name} ${surname} (@${username||'yo\'q'})\nID: ${userId}\n\nXabar: ${text}`,
        newPaymentNotify: (name, surname, userId, type, amount, paymentId) =>
            `💰 Yangi to\'lov!\n\nKim: ${name} ${surname}\nID: ${userId}\nTuri: ${type.toUpperCase()}\nSumma: ${amount.toLocaleString()} so'm\n\nTasdiqlash: /approve ${paymentId}`,
        currency: 'so\'m',
        freeLabel: 'MUTLAQO BEPUL',
        slide: 'slayd',
        slides: 'ta slayd',
        questions: 'ta savol',
        difficulty: 'Daraja',
        of: 'dan',
        test: 'TEST',
        crossword: 'KRASSVORD',
        answers: 'Javoblar Kaliti',
        thesis: 'TEZIS',
        infographic: 'INFOGRAFIKA',
        facts: 'Faktlar',
        article: 'MAQOLA',
        topic: 'Mavzu',
        price: 'Narx',
        balanceLabel: 'Balans',
        packageLabel: 'Paket',
        infinityPackage: '🌟 Infinity — MUTLAQO BEPUL',
        month: 'oy',
        freeSlideLeft: (n) => `🎁 Sizda ${n} ta bepul slayd bor!\n\n`,
        payPerMonth: '/oy',
        and: 'va',
        referralCount: (n) => `👥 Taklif qilganlar: ${n} ta`,
        selectService: 'Xizmatni tanlang',
        creatingPdf: 'PDF yaratilmoqda',
        done: '🎉 Mana, tayyor! Yoqdi deb umid qilaman, do\'stim! 😊',
        startText: 'Bot ishga tushdi',
        stopText: 'Bot to\'xtatildi',
        serverRunning: (port) => `Health check: port ${port}`,
        botRunning: '✅ SlaydTop Bot ishga tushdi! Mukammal muloyim versiya.',
        botError: '❌ Bot ishga tushirishda xato:',
        unexpectedError: '😔 Kutilmagan xatolik. /start bosing.',
        helpChoose: 'Muammoingizni tanlang:',
        checkReceivedNotify: 'Chek qabul qilindi!',
        qrWelcome: `🔗 *QR Kod Yaratish* — MUTLAQO BEPUL!\n\nHavola yoki matnni yuboring:\n\nMasalan:\n• https://youtube.com/...\n• https://instagram.com/...\n• Ism va telefon raqam\n\n📱 Telefon kamerasida skanerlang!`,
        shareReferral: (link) => `🎁 *Do'stlaringizni taklif qiling!*\n\n🔗 Sizning havolangiz:\n${link}\n\n*3 ta do'stingizni taklif qiling va UMRBOD BEPUL foydalaning!* 🎉\n\n📲 Havolani ulashing va do'stlaringizga aytib qo'ying!`,
        referralSuccess: (count) => `🎉 *TABRIKLAYMIZ!* 🎉\n\n${count} ta do'stingiz qo'shildi!\n\n✅ Endi siz *UMRBOD MUTLAQO BEPUL* foydalanishingiz mumkin!\n🎁 Bu sizning sovg'angiz!\n\nRahmat, do'stim! ❤️`,
        referralProgress: (count) => `📊 *Taklif holati*\n\n👥 Hozircha: ${count} ta do'st\n🎯 Yana ${Math.max(0, 3-count)} ta kerak\n\n*3 ta do'st = UMRBOD BEPUL!* 🎁`,
        rules: `📜 *BOT FOYDALANISH QOIDALARI*\n\n` +
            `1️⃣ @SlaydTop_01 kanalidan chiqib ketmang\n` +
            `2️⃣ Botdan yaxshi maqsadda foydalaning\n` +
            `3️⃣ Do'stlaringizni taklif qiling — umrbod bepul oling!\n\n` +
            `❤️ Rahmat! Siz bilan ishlash biz uchun baxt!`,
        summerPromo: `🔥 *YOZ AKSIYASI!* 🔥\n\n` +
            `📅 1-Sentabrgacha BARCHA xizmatlar *MUTLAQO BEPUL!*\n\n` +
            `🎞 Slayd | 📚 Referat | ✍️ Insho\n` +
            `🎓 Tezis | 📰 Maqola | 📊 Infografika\n` +
            `🖼 Rasm | 📝 Test | 🔲 Krassvord\n` +
            `📄 PDF | 🔗 QR | 🎬 Audio/Video → MP3\n` +
            `📊 PPTX→PDF | 📝 DOCX→PDF | 📄 PDF→Word\n\n` +
            `*Hammasi BEPUL!* 🎁\n\n` +
            `💡 *Bonus:* 3 ta do'st taklif qilsangiz — *UMRBOD BEPUL!*`,
        qrReady: (text) => `✅ *QR Kod tayyor!*\n\n🔗 ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}\n\n📱 Telefon kamerasida skanerlang!`,
    },
    ru: {
        welcome: `🌟 Здравствуйте!\n\nДобро пожаловать в *SlaydTop*! 👋\n\nМы очень рады вас видеть! 😊\nПожалуйста, выберите язык:`,
        enterName: `✨ Отличный выбор!\n\nДавайте познакомимся, друг мой 😊\n\n*Введите ваше имя:*\n_(Например: Иван)_`,
        registered: (name) =>
            `🎉 *Поздравляем, ${name}!* 🎉\n\n` +
            `✅ Вы успешно зарегистрировались!\n\n` +
            `🎁 *ВАМ ПОДАРОК:* 2 МЕСЯЦА бесплатного использования всех услуг — *АБСОЛЮТНО БЕСПЛАТНО!*\n\n` +
            `📅 *Срок акции:* до 1 Сентября\n` +
            `📢 *Условие:* оставайтесь в канале @SlaydTop_01\n\n` +
            `🔥 *СУПЕР АКЦИЯ:* Пригласите всего 3 друзей — получите *БЕСПЛАТНЫЙ* доступ *НАВСЕГДА!*\n\n` +
            `Начнём! 👇`,
        mainMenu: (name) => `${name}, выберите услугу 👇\n\n📢 *Единственное условие:* быть подписанным на @SlaydTop_01\n🔥 Без ограничений, пользуйтесь с удовольствием! 😊`,
        balance: (u) => {
            const now = new Date();
            const freeUntil = u.freeUntil ? new Date(u.freeUntil) : null;
            const isFree = isSummerFree() || (freeUntil && now < freeUntil);
            let tariffText = isFree ? '✅ *АБСОЛЮТНО БЕСПЛАТНО* (2 месяца)' : '💳 *Платный режим*';
            if (u.invitedCount >= 3) tariffText = '🎁 *АБСОЛЮТНО БЕСПЛАТНО* (Через друзей — навсегда!)';
            return `💰 *Ваш счёт*\n\n` +
                `👤 *Имя:* ${u.name}\n` +
                `💳 *Баланс:* ${(u.balance||0).toLocaleString()} сум\n` +
                `📊 *Тариф:* ${tariffText}\n` +
                `👥 *Приглашено:* ${u.invitedCount || 0}\n` +
                `📋 *Всего заказов:* ${u.totalOrders||0}`;
        },
        cancel: '❌ Отмена',
        back: '🏠 Главное меню',
        lowBalance: (need, has) =>
            `😊 Извините, недостаточно средств\n\n` +
            `💰 Нужно: ${need.toLocaleString()} сум\n` +
            `💳 У вас: ${has.toLocaleString()} сум\n\n` +
            `К сожалению, оплата временно недоступна.\n` +
            `Но не волнуйтесь! У вас есть 2 МЕСЯЦА *БЕСПЛАТНОГО* использования! 🎁`,
        payClick: (sum) => `💳 Оплата через CLICK\n\n💰 Сумма: ${sum.toLocaleString()} сум\n🏦 Карта: ${CARD_NUMBER}\n👤 Имя: ${CARD_OWNER}\n\n✅ После оплаты отправьте ЧЕК!`,
        payPayme: (sum) => `💳 Оплата через PAYME\n\n💰 Сумма: ${sum.toLocaleString()} сум\n🏦 Карта: ${CARD_NUMBER}\n👤 Имя: ${CARD_OWNER}\n\n✅ После оплаты отправьте ЧЕК!`,
        checkReceived: `⏳ Чек получен!\n\nАдмин проверит и пополнит баланс.\nОбычно 5-15 минут ✅`,
        payApproved: (amount, newBal) => `✅ Оплата подтверждена! 🏆\nНа баланс добавлено ${amount.toLocaleString()} сум!\n💰 Новый баланс: ${newBal.toLocaleString()} сум`,
        free: (userId, botUser, invitedCount) => {
            const remain = Math.max(0, 3 - (invitedCount || 0));
            return `🎁 *Способы получить бесплатный доступ*\n\n` +
                `1️⃣ *Фото в PDF* — ВСЕГДА БЕСПЛАТНО ♾️\n\n` +
                `2️⃣ *Акция:* У вас сейчас 2 МЕСЯЦА БЕСПЛАТНО!\n\n` +
                `3️⃣ *Пригласите друзей!*\n` +
                `   👥 Сейчас: ${invitedCount || 0}\n` +
                `   🎯 Ещё ${remain} друга — и *НАВСЕГДА БЕСПЛАТНО!*\n\n` +
                `🔗 *Ваша ссылка:*\nhttps://t.me/${botUser}?start=ref_${userId}`;
        },
        settings: (u) => `⚙️ *Настройки*\n\n👤 Имя: ${u.name}\n🌐 Язык: Русский 🇷🇺`,
        help: `❓ *Центр помощи*\n\nВыберите проблему:`,
        helpDetails: `📖 *РУКОВОДСТВО ПО ИСПОЛЬЗОВАНИЮ*\n\n` +
            `*/start* — Запуск бота. Выбор языка и регистрация.\n\n` +
            `*/restart* — Перезапуск бота. Если что-то работает неправильно.\n\n` +
            `*/manuel* — Это руководство.\n\n` +
            `*/yordam* — Центр помощи. Технические проблемы, вопросы об оплате, связь с админом.\n\n` +
            `*/admin* — Связь с админом. Напишите вопросы, ответим от 1 минуты до 10 часов!\n\n` +
            `*/sozlama* — Изменить язык и настройки.\n\n` +
            `*КАК ИСПОЛЬЗОВАТЬ?*\n` +
            `1️⃣ Нажмите Start\n` +
            `2️⃣ Выберите язык\n` +
            `3️⃣ Введите имя\n` +
            `4️⃣ Подпишитесь на @SlaydTop_01\n` +
            `5️⃣ Выберите услугу и пользуйтесь!\n\n` +
            `*СУПЕР АКЦИЯ:* Пригласите 3 друзей — НАВСЕГДА БЕСПЛАТНО! 🎁`,
        adminMsg: `👨‍💻 *Связь с администратором*\n\nНапишите ваше сообщение здесь, уважаемый пользователь! 💬\n\n⏰ Мы ответим на ваши вопросы от 1 минуты до 10 часов.\n\nПожалуйста, опишите ваш вопрос подробно:`,
        msgSent: `✅ Сообщение отправлено администратору! 🎉\n\nМы ответим вам скоро, будьте терпеливы! 😊`,
        creating: `⏳ *Готовится...*\n\n🤖 AI собирает данные\n🎨 Создаётся дизайн\n📎 Готовится файл\n\nЭто займёт 15-30 секунд, пожалуйста подождите ⌛`,
        ready: (type, topic, price) => `✅ *${type} готов!* 🎉\n\n📌 Тема: ${topic}\n💰 Цена: ${price > 0 ? price.toLocaleString()+' сум' : 'АБСОЛЮТНО БЕСПЛАТНО 🎁'}\n\nОцените от 1️⃣ до 5️⃣:`,
        rateThank: (r) => r===5 ? '👏 Отлично! Большое спасибо, друг мой!' : r>=4 ? '👏 Очень хорошо! Спасибо!' : r>=3 ? '🙂 Спасибо! Постараемся улучшить!' : '🙏 Спасибо за отзыв!',
        error: `😊 Произошла небольшая ошибка. Пожалуйста, попробуйте ещё раз!\nЕсли проблема повторится, обратитесь в раздел /yordam.`,
        invalidInput: `😊 Пожалуйста, введите правильные данные. Нажмите /yordam для помощи.`,
        pdfFree: `📄 *Фото в PDF* — АБСОЛЮТНО БЕСПЛАТНО! 🎁\n\nОтправьте фото, я конвертирую в PDF!\n\n✅ Принимаются JPG, PNG, WEBP\n✅ До 10 фото за раз\n✅ Безлимитное использование\n\nОтправьте фото: 👇`,
        pdfGot: (n) => `✅ Фото получено! (${n} шт)\n\nХотите добавить ещё?`,
        pdfDone: (n) => `🎉 PDF готов!\n\n${n} фото конвертировано в PDF.\nСкачайте! ⬇️`,
        slideCreate: '🎞 Новый Слайд',
        imgToPdf: '📄 Фото в PDF',
        referatMustaqil: '📚 Реферат / Самост. Работа',
        essayEsse: '✍ Сочинение / Эссе',
        test: '📝 Новый Тест',
        crossword: '🔲 Новый Кроссворд',
        tezis: '🎓 Тезис',
        maqola: '📰 Статья',
        infografika: '📊 Инфографика',
        rasmYaratish: '🖼 Создать Картинку (AI)',
        qrKod: '🔗 QR Код',
        pdfSiqish: '📦 Сжать PDF',
        audioToMp3: '🎬 Audio/Video → MP3',
        pptxToPdf: '📊 PPTX → PDF',
        docxToPdf: '📝 DOCX → PDF',
        pdfToWord: '📄 PDF → Word',
        balansim: '💰 Мой Счёт',
        bepulOlish: '🎁 Бесплатно',
        yordam: '❓ Помощь',
        sozlamalar: '⚙ Настройки',
        adminPanel: '👨‍💻 Админ Панель',
        testPrompt: (balance, price) => `📝 *Создание Теста*\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: АБСОЛЮТНО БЕСПЛАТНО 🎁\n\nВведите тему теста:\n_(Например: Биология — Растения)_`,
        testReady: (topic, count, price) => `✅ *Тест готов!* 🎉\n\n📌 Тема: ${topic}\n📝 ${count} вопросов\n💰 АБСОЛЮТНО БЕСПЛАТНО 🎁`,
        crossPrompt: (balance, price) => `🔲 *Создание Кроссворда*\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: АБСОЛЮТНО БЕСПЛАТНО 🎁\n\nВведите тему:\n_(Например: Мировая география)_`,
        crossReady: (topic, count, price) => `✅ *Кроссворд готов!* 🎉\n\n📌 Тема: ${topic}\n🔲 ${count} вопросов\n💰 АБСОЛЮТНО БЕСПЛАТНО 🎁`,
        essayTypePrompt: (balance, price) => `✍️ *Сочинение или Эссе?*\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: АБСОЛЮТНО БЕСПЛАТНО 🎁 (500-1000 слов)`,
        essayTopicPrompt: (type, balance, price) => `✍️ *Введите тему ${type === 'insho' ? 'сочинения' : 'эссе'}:*\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: АБСОЛЮТНО БЕСПЛАТНО 🎁`,
        essayReady: (type, topic, words, price) => `✅ *${type === 'insho' ? 'Сочинение' : 'Эссе'} готово!* 🎉\n\n📌 Тема: ${topic}\n✍️ ${words} слов\n💰 АБСОЛЮТНО БЕСПЛАТНО 🎁`,
        referatTypePrompt: (balance, price) => `📚 *Реферат или Самостоятельная Работа?*\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: АБСОЛЮТНО БЕСПЛАТНО 🎁 (10-20 стр)`,
        referatTopicPrompt: (type) => `📚 *Введите тему ${type === 'referat' ? 'реферата' : 'самостоятельной работы'}:*`,
        referatReady: (type, topic, pages, price) => `✅ *${type === 'referat' ? 'Реферат' : 'Самостоятельная работа'} готов!* 🎉\n\n📌 Тема: ${topic}\n📋 ${pages} стр\n💰 АБСОЛЮТНО БЕСПЛАТНО 🎁`,
        tezisPrompt: (balance, price) => `🎓 *Создание Тезиса*\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: АБСОЛЮТНО БЕСПЛАТНО 🎁 (3-10 стр)\n\nВведите тему:`,
        tezisReady: (topic, pages, price) => `✅ *Тезис готов!* 🎉\n\n📌 Тема: ${topic}\n📋 ${pages} стр\n💰 АБСОЛЮТНО БЕСПЛАТНО 🎁`,
        maqolaPrompt: (balance, price) => `📰 *Создание Статьи*\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: АБСОЛЮТНО БЕСПЛАТНО 🎁 (3-10 стр)\n\nВведите тему:`,
        maqolaReady: (topic, pages, price) => `✅ *Статья готова!* 🎉\n\n📌 Тема: ${topic}\n📋 ${pages} стр\n💰 АБСОЛЮТНО БЕСПЛАТНО 🎁`,
        infoPrompt: (balance, price) => `📊 *Создание Инфографики*\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: АБСОЛЮТНО БЕСПЛАТНО 🎁\n\nВведите тему:\n_(Например: Население Узбекистана)_`,
        infoReady: (topic, price) => `✅ *Инфографика готова!* 🎉\n\n📌 Тема: ${topic}\n💰 АБСОЛЮТНО БЕСПЛАТНО 🎁`,
        rasmPrompt: (balance, price) => `🖼 *AI Создание Картинки*\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: АБСОЛЮТНО БЕСПЛАТНО 🎁\n\nОпишите картинку:\n_(Например: озеро в горах, ночь, красочное)_`,
        rasmReady: (price, prompt) =>
            `🖼 *AI Профессиональный Промпт Готов!* 🎉\n\n💰 АБСОЛЮТНО БЕСПЛАТНО 🎁\n\n📝 Используйте этот промпт в Midjourney, DALL-E или Stable Diffusion:\n\n${prompt.slice(0, 900)}`,
        nameTooShort: 'Пожалуйста, введите правильное имя (минимум 2 буквы):',
        topicTooShort: 'Тема слишком короткая. Напишите подробнее:',
        infoTooShort: 'Информация слишком короткая:',
        pdfCreating: '⏳ Создание PDF... ⌛',
        pdfNoImages: 'Фото не найдены.',
        pdfMaxImages: 'Максимум 10 фото загружено. Создание PDF...',
        pdfSendMore: '📸 Отправьте фото:',
        pdfCreateOrSend: '📸 Отправьте фото или нажмите "Создать PDF":',
        paymentChoose: 'Выберите способ оплаты:',
        adminContactInfo: (username, phone) => `👨‍💻 Связь с админом:\nTelegram: @${username}\nТел: ${phone}\n\n⏰ Время ответа: от 1 минуты до 10 часов`,
        helpBot: `🔄 Нажмите /start или отправьте /restart.\n\nЕсли проблема осталась, напишите @${CHANNEL_USERNAME}.`,
        cancelDone: '✅ Отменено. Возврат в главное меню...',
        ratingPrompt: 'Оцените от 1️⃣ до 5️⃣:',
        referralMsg: (count) => `🎁 ${count} друзей присоединилось! Вам дан бесплатный доступ НАВСЕГДА! 🎉`,
        noAccess: '🔒 Извините, у вас нет доступа!',
        restored: '🔄 Перезапущено! Начнём заново! 👋',
        defaultReply: (name) => `${name}, выберите услугу 👇`,
        helpDetails: ``, // Will use uz version fallback
        currency: 'сум',
        freeLabel: 'АБСОЛЮТНО БЕСПЛАТНО',
        done: '🎉 Готово! Надеюсь, вам понравилось, друг мой! 😊',
        startText: 'Бот запущен',
        stopText: 'Бот остановлен',
        botRunning: '✅ SlaydTop Bot запущен! Мукаммал вежливая версия.',
        botError: '❌ Ошибка запуска бота:',
        unexpectedError: '😔 Неожиданная ошибка. Нажмите /start.',
        helpChoose: 'Выберите проблему:',
        checkReceivedNotify: 'Чек получен!',
        qrWelcome: `🔗 *QR Код* — АБСОЛЮТНО БЕСПЛАТНО!\n\nОтправьте ссылку или текст:\n\nПример:\n• https://youtube.com/...\n• Имя и телефон\n\n📱 Сканируйте камерой телефона!`,
        shareReferral: (link) => `🎁 *Пригласите друзей!*\n\n🔗 *Ваша ссылка:*\n${link}\n\n*Пригласите 3 друзей и получите БЕСПЛАТНЫЙ доступ НАВСЕГДА!* 🎉`,
        referralSuccess: (count) => `🎉 *ПОЗДРАВЛЯЕМ!* 🎉\n\n${count} друзей присоединилось!\n\n✅ Теперь у вас *АБСОЛЮТНО БЕСПЛАТНЫЙ* доступ НАВСЕГДА!\n🎁 Это ваш подарок!\n\nСпасибо, друг мой! ❤️`,
        referralProgress: (count) => `📊 *Статус приглашений*\n\n👥 Сейчас: ${count}\n🎯 Ещё ${Math.max(0, 3-count)} нужно\n\n*3 друга = НАВСЕГДА БЕСПЛАТНО!* 🎁`,
        rules: `📜 *ПРАВИЛА ИСПОЛЬЗОВАНИЯ*\n\n` +
            `1️⃣ Не отписывайтесь от @SlaydTop_01\n` +
            `2️⃣ Используйте бота во благо\n` +
            `3️⃣ Приглашайте друзей — получайте бесплатно навсегда!\n\n` +
            `❤️ Спасибо! Работать с вами — наше счастье!`,
        qrReady: (text) => `✅ *QR Код готов!*\n\n🔗 ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}\n\n📱 Сканируйте камерой телефона!`,
    },
    en: {
        welcome: `🌟 Hello!\n\nWelcome to *SlaydTop*! 👋\n\nWe are so happy to see you! 😊\nPlease select your language:`,
        enterName: `✨ Great choice!\n\nLet's get acquainted, my friend 😊\n\n*Enter your name:*\n_(Example: John)_`,
        registered: (name) =>
            `🎉 *Congratulations, ${name}!* 🎉\n\n` +
            `✅ You have successfully registered!\n\n` +
            `🎁 *YOUR GIFT:* 2 MONTHS of absolutely *FREE* access to all services!\n\n` +
            `📅 *Promo period:* Until September 1\n` +
            `📢 *Condition:* Stay subscribed to @SlaydTop_01\n\n` +
            `🔥 *SUPER PROMO:* Invite just 3 friends — get *FREE* access *FOREVER!*\n\n` +
            `Let's start! 👇`,
        mainMenu: (name) => `${name}, select a service 👇\n\n📢 *Only condition:* Be subscribed to @SlaydTop_01\n🔥 No limits, enjoy! 😊`,
        balance: (u) => {
            const now = new Date();
            const freeUntil = u.freeUntil ? new Date(u.freeUntil) : null;
            const isFree = isSummerFree() || (freeUntil && now < freeUntil);
            let tariffText = isFree ? '✅ *ABSOLUTELY FREE* (2 months)' : '💳 *Paid mode*';
            if (u.invitedCount >= 3) tariffText = '🎁 *ABSOLUTELY FREE* (Via friends — forever!)';
            return `💰 *Your Account*\n\n` +
                `👤 *Name:* ${u.name}\n` +
                `💳 *Balance:* ${(u.balance||0).toLocaleString()} sum\n` +
                `📊 *Plan:* ${tariffText}\n` +
                `👥 *Invited:* ${u.invitedCount || 0}\n` +
                `📋 *Total orders:* ${u.totalOrders||0}`;
        },
        cancel: '❌ Cancel',
        back: '🏠 Main Menu',
        help: `❓ *Help Center*\n\nSelect your issue:`,
        adminMsg: `👨‍💻 *Contact Admin*\n\nWrite your message here, dear user! 💬\n\n⏰ We will reply to your questions within 1 minute to 10 hours.\n\nPlease describe your question in detail:`,
        msgSent: `✅ Message sent to admin! 🎉\n\nWe will reply soon, please be patient! 😊`,
        settings: (u) => `⚙️ *Settings*\n\n👤 Name: ${u.name}\n🌐 Language: English 🇬🇧`,
        defaultReply: (name) => `${name}, please select a service 👇`,
        done: '🎉 Here you go! Hope you like it, my friend! 😊',
        startText: 'Bot started',
        stopText: 'Bot stopped',
        botRunning: '✅ SlaydTop Bot started! Perfect polite version.',
        botError: '❌ Bot launch error:',
        unexpectedError: '😔 Unexpected error. Press /start.',
        currency: 'sum',
        freeLabel: 'ABSOLUTELY FREE',
        nameTooShort: 'Please enter a valid name (at least 2 letters):',
        topicTooShort: 'Topic is too short. Please write more details:',
        restored: '🔄 Restarted! Let\'s begin! 👋',
        noAccess: '🔒 Sorry, access denied!',
        helpDetails: `📖 *USER GUIDE*\n\n` +
            `*/start* — Start the bot. Language selection and registration.\n\n` +
            `*/restart* — Restart the bot. If something isn't working right.\n\n` +
            `*/manuel* — This guide.\n\n` +
            `*/yordam* — Help center. Technical issues, payment questions, contact admin.\n\n` +
            `*/admin* — Contact admin. Write your questions, we reply within 1 min to 10 hours!\n\n` +
            `*/sozlama* — Change language and settings.\n\n` +
            `*HOW TO USE?*\n` +
            `1️⃣ Press Start\n` +
            `2️⃣ Select language\n` +
            `3️⃣ Enter your name\n` +
            `4️⃣ Subscribe to @SlaydTop_01\n` +
            `5️⃣ Select a service and enjoy!\n\n` +
            `*SUPER PROMO:* Invite 3 friends — FREE FOREVER! 🎁`,
        qrWelcome: `🔗 *QR Code Creator* — ABSOLUTELY FREE!\n\nSend a link or text:\n\nExample:\n• https://youtube.com/...\n• Name and phone number\n\n📱 Scan with your phone camera!`,
        shareReferral: (link) => `🎁 *Invite Your Friends!*\n\n🔗 *Your link:*\n${link}\n\n*Invite 3 friends and get FREE access FOREVER!* 🎉`,
        referralSuccess: (count) => `🎉 *CONGRATULATIONS!* 🎉\n\n${count} friends joined!\n\n✅ You now have *ABSOLUTELY FREE* access FOREVER!\n🎁 This is your gift!\n\nThank you, my friend! ❤️`,
        referralProgress: (count) => `📊 *Invitation Status*\n\n👥 So far: ${count}\n🎯 Need ${Math.max(0, 3-count)} more\n\n*3 friends = FREE FOREVER!* 🎁`,
        rules: `📜 *USAGE RULES*\n\n` +
            `1️⃣ Don't leave @SlaydTop_01 channel\n` +
            `2️⃣ Use the bot for good purposes\n` +
            `3️⃣ Invite friends — get free access forever!\n\n` +
            `❤️ Thank you! Working with you is our pleasure!`,
        qrReady: (text) => `✅ *QR Code Ready!*\n\n🔗 ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}\n\n📱 Scan with phone camera!`,
    },
    id: {
        welcome: `🌟 Halo!\n\nSelamat datang di *SlaydTop*! 👋\n\nKami sangat senang melihat Anda! 😊\nSilakan pilih bahasa:`,
        enterName: `✨ Pilihan bagus!\n\nMari berkenalan, teman ku 😊\n\n*Masukkan nama Anda:*\n_(Contoh: Budi)_`,
        registered: (name) =>
            `🎉 *Selamat, ${name}!* 🎉\n\n` +
            `✅ Anda berhasil terdaftar!\n\n` +
            `🎁 *HADIAH ANDA:* 2 BULAN akses *GRATIS* ke semua layanan!\n\n` +
            `📅 *Masa promosi:* Sampai 1 September\n` +
            `📢 *Syarat:* Tetap berlangganan @SlaydTop_01\n\n` +
            `🔥 *SUPER PROMO:* Undang hanya 3 teman — dapatkan akses *GRATIS* *SELAMANYA!*\n\n` +
            `Mari mulai! 👇`,
        mainMenu: (name) => `${name}, pilih layanan 👇\n\n📢 *Satu syarat:* Berlangganan @SlaydTop_01\n🔥 Tanpa batas, nikmati! 😊`,
        balance: (u) => {
            const now = new Date();
            const freeUntil = u.freeUntil ? new Date(u.freeUntil) : null;
            const isFree = isSummerFree() || (freeUntil && now < freeUntil);
            let tariffText = isFree ? '✅ *GRATIS TOTAL* (2 bulan)' : '💳 *Mode berbayar*';
            if (u.invitedCount >= 3) tariffText = '🎁 *GRATIS TOTAL* (Via teman — selamanya!)';
            return `💰 *Akun Anda*\n\n` +
                `👤 *Nama:* ${u.name}\n` +
                `💳 *Saldo:* ${(u.balance||0).toLocaleString()} sum\n` +
                `📊 *Tarif:* ${tariffText}\n` +
                `👥 *Mengundang:* ${u.invitedCount || 0}\n` +
                `📋 *Total pesanan:* ${u.totalOrders||0}`;
        },
        cancel: '❌ Batal',
        back: '🏠 Menu Utama',
        help: `❓ *Pusat Bantuan*\n\nPilih masalah Anda:`,
        adminMsg: `👨‍💻 *Hubungi Admin*\n\nTulis pesan Anda di sini, pengguna yang terhormat! 💬\n\n⏰ Kami akan menjawab pertanyaan Anda dalam 1 menit hingga 10 jam.\n\nSilakan jelaskan pertanyaan Anda secara detail:`,
        msgSent: `✅ Pesan terkirim ke admin! 🎉\n\nKami akan segera membalas, mohon bersabar! 😊`,
        settings: (u) => `⚙️ *Pengaturan*\n\n👤 Nama: ${u.name}\n🌐 Bahasa: Indonesia 🇮🇩`,
        defaultReply: (name) => `${name}, silakan pilih layanan 👇`,
        done: '🎉 Selesai! Semoga Anda suka, teman ku! 😊',
        restored: '🔄 Dimulai ulang! Mari mulai! 👋',
        noAccess: '🔒 Maaf, akses ditolak!',
        startText: 'Bot dimulai',
        stopText: 'Bot dihentikan',
        botRunning: '✅ SlaydTop Bot dimulai! Versi sopan sempurna.',
        botError: '❌ Error menjalankan bot:',
        currency: 'sum',
        freeLabel: 'GRATIS TOTAL',
        nameTooShort: 'Silakan masukkan nama yang valid (minimal 2 huruf):',
        topicTooShort: 'Topik terlalu singkat. Tulis lebih detail:',
        unexpectedError: '😔 Error tak terduga. Tekan /start.',
        helpDetails: ``, // Will fallback
        qrWelcome: `🔗 *QR Code* — GRATIS TOTAL!\n\nKirim tautan atau teks:\n\nContoh:\n• https://youtube.com/...\n• Nama dan nomor telepon\n\n📱 Pindai dengan kamera ponsel!`,
        shareReferral: (link) => `🎁 *Undang Teman Anda!*\n\n🔗 *Tautan Anda:*\n${link}\n\n*Undang 3 teman dan dapatkan GRATIS SELAMANYA!* 🎉`,
        referralSuccess: (count) => `🎉 *SELAMAT!* 🎉\n\n${count} teman bergabung!\n\n✅ Anda sekarang memiliki akses *GRATIS TOTAL* SELAMANYA!\n🎁 Ini hadiah Anda!\n\nTerima kasih, teman ku! ❤️`,
        referralProgress: (count) => `📊 *Status Undangan*\n\n👥 Sejauh ini: ${count}\n🎯 Perlu ${Math.max(0, 3-count)} lagi\n\n*3 teman = GRATIS SELAMANYA!* 🎁`,
        rules: `📜 *ATURAN PENGGUNAAN*\n\n` +
            `1️⃣ Jangan berhenti berlangganan @SlaydTop_01\n` +
            `2️⃣ Gunakan bot untuk tujuan baik\n` +
            `3️⃣ Undang teman — dapatkan gratis selamanya!\n\n` +
            `❤️ Terima kasih! Bekerja dengan Anda adalah kebahagiaan kami!`,
        qrReady: (text) => `✅ *QR Code Siap!*\n\n🔗 ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}\n\n📱 Pindai dengan kamera ponsel!`,
    }
};

// ==================== TIL FUNKSIYASI ====================
function t(userId, key, ...args) {
    const lang = getLang(userId);
    const fn = T[lang]?.[key] || T.uz[key];
    if (!fn) return key;
    return typeof fn === 'function' ? fn(...args) : fn;
}

// ==================== PAKET TIZIMI ====================
function getPaket(count, isFree, lang = 'uz') {
    const labels = {
        uz: { sinov: 'Sinov', iqtidor: 'Iqtidor', professional: 'Professional', premium: 'Premium' },
        ru: { sinov: 'Пробный', iqtidor: 'Талант', professional: 'Профи', premium: 'Премиум' },
        en: { sinov: 'Trial', iqtidor: 'Talent', professional: 'Pro', premium: 'Premium' },
        id: { sinov: 'Percobaan', iqtidor: 'Bakat', professional: 'Pro', premium: 'Premium' },
    };
    const l = labels[lang] || labels.uz;
    if (isFree) return { nom: l.sinov, emoji: '🎁', narx: 0, min: 1, max: 4 };
    if (count <= 4)  return { nom: l.sinov, emoji: '🎁', narx: 0, min: 1, max: 4 };
    if (count <= 12) return { nom: l.iqtidor, emoji: '⚡', narx: 0, min: 5, max: 12 };
    if (count <= 20) return { nom: l.professional, emoji: '💎', narx: 0, min: 13, max: 20 };
    if (count <= 30) return { nom: l.premium, emoji: '👑', narx: 0, min: 21, max: 30 };
    return { nom: l.premium, emoji: '👑', narx: 0, min: 21, max: 30 };
}

// ==================== FOYDALANUVCHI (FAQAT ISM, FAMILYA YO'Q) ====================
function getUser(userId) {
    const users = loadJson(USERS_FILE, {});
    if (!users[userId]) {
        const freeUntilDate = new Date();
        freeUntilDate.setMonth(freeUntilDate.getMonth() + 2);
        users[userId] = {
            id: userId, name: '', lang: 'uz',
            balance: 0, freeUsed: 0, totalOrders: 0,
            registered: false, step: 'LANG_SELECT',
            invitedBy: null, invitedCount: 0,
            freeUntil: freeUntilDate.toISOString()
        };
        saveJson(USERS_FILE, users);
    }
    return users[userId];
}
function updateUser(userId, upd) {
    const users = loadJson(USERS_FILE, {});
    users[userId] = { ...users[userId], ...upd };
    saveJson(USERS_FILE, users);
    return users[userId];
}

// ==================== TO'LOV ====================
function addPayment(userId, amount, type, details = {}) {
    const payments = loadJson(PAYMENTS_FILE, []);
    const p = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        userId, amount, type, status: 'pending', details,
        createdAt: new Date().toISOString()
    };
    payments.push(p);
    saveJson(PAYMENTS_FILE, payments);
    return p;
}
function approvePayment(paymentId) {
    const payments = loadJson(PAYMENTS_FILE, []);
    const p = payments.find(x => x.id === paymentId);
    if (!p || p.status !== 'pending') return null;
    p.status = 'approved';
    p.approvedAt = new Date().toISOString();
    saveJson(PAYMENTS_FILE, payments);
    const user = getUser(p.userId);
    updateUser(p.userId, { balance: (user.balance || 0) + p.amount });
    return p;
}
function getPendingPayments() {
    return loadJson(PAYMENTS_FILE, []).filter(p => p.status === 'pending');
}

// ==================== BUYURTMA ====================
function addOrder(userId, type, details) {
    const orders = loadJson(ORDERS_FILE, []);
    orders.push({ id: Date.now().toString(36), userId, type, details, createdAt: new Date().toISOString() });
    saveJson(ORDERS_FILE, orders);
    const u = getUser(userId);
    updateUser(userId, { totalOrders: (u.totalOrders || 0) + 1 });
}

// ==================== KLAVIATURALAR (CHIROYLI TARTIBDA) ====================
const KB = {
    langSelect: () => Markup.inlineKeyboard([
        [Markup.button.callback('🇺🇿 O\'zbek', 'lang_uz'), Markup.button.callback('🇷🇺 Русский', 'lang_ru')],
        [Markup.button.callback('🇬🇧 English', 'lang_en'), Markup.button.callback('🇮🇩 Indonesia', 'lang_id')]
    ]),
    mainMenu: (lang = 'uz', isAdmin = false, name = '') => {
        const l = T[lang] || T.uz;
        const rows = [
            [l.slideCreate, l.referatMustaqil],
            [l.essayEsse, l.tezis],
            [l.maqola, l.infografika],
            [l.rasmYaratish, l.imgToPdf],
            [l.qrKod, l.test],
            [l.crossword, l.pdfSiqish],
            [l.audioToMp3, l.pptxToPdf],
            [l.docxToPdf, l.pdfToWord],
            [l.balansim, l.bepulOlish],
            [l.yordam, l.sozlamalar],
        ];
        if (isAdmin) rows.push([l.adminPanel]);
        return Markup.keyboard(rows).resize();
    },
    cancel: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        return Markup.keyboard([[`❌ ${l.cancel}`]]).resize();
    },
    slideCount: (lang = 'uz') => Markup.keyboard([
        ['1', '5', '7', '8'],
        ['10', '12', '15', '20'],
        ['25', '30', '❌ Bekor qilish']
    ]).resize(),
    templateMenu: (lang = 'uz') => {
        const labels = {
            uz: { view: '🖼 Shablonlarni Ko\'rish', normal: '📋 Oddiy Shablon', chart: '📈 Diagrammali Shablon', pic: '🖼 /pic — O\'z Rasmim', ai: '🤖 AI Rasm [1-Sentabr]', no: '✨ Shablonsiz (Tez)' },
            ru: { view: '🖼 Посмотреть шаблоны', normal: '📋 Обычный шаблон', chart: '📈 С диаграммой', pic: '🖼 /pic — Своё фото', ai: '🤖 AI Фото [1 Сентября]', no: '✨ Без шаблона (Быстро)' },
            en: { view: '🖼 View Templates', normal: '📋 Normal Template', chart: '📈 With Chart', pic: '🖼 /pic — My Photo', ai: '🤖 AI Image [Sep 1]', no: '✨ No Template (Fast)' },
            id: { view: '🖼 Lihat Template', normal: '📋 Template Biasa', chart: '📈 Dengan Diagram', pic: '🖼 /pic — Foto Saya', ai: '🤖 Gambar AI [1 Sep]', no: '✨ Tanpa Template' }
        };
        const lb = labels[lang] || labels.uz;
        const l = T[lang] || T.uz;
        return Markup.keyboard([
            [lb.view],
            [lb.normal, lb.chart],
            [lb.pic, lb.ai],
            [lb.no, '❌ Bekor qilish']
        ]).resize();
    },
    testCount: (lang = 'uz') => Markup.keyboard([
        ['10 ta', '15 ta', '20 ta'],
        ['❌ Bekor qilish']
    ]).resize(),
    difficulty: (lang = 'uz') => {
        const labels = {
            uz: ['🟢 Oson', '🟡 O\'rta', '🔴 Qiyin'],
            ru: ['🟢 Лёгкий', '🟡 Средний', '🔴 Сложный'],
            en: ['🟢 Easy', '🟡 Medium', '🔴 Hard'],
            id: ['🟢 Mudah', '🟡 Sedang', '🔴 Sulit'],
        };
        const l = labels[lang] || labels.uz;
        return Markup.keyboard([[l[0], l[1], l[2]], ['❌ Bekor qilish']]).resize();
    },
    crosswordCount: (lang = 'uz') => Markup.keyboard([
        ['10 ta', '15 ta', '20 ta'],
        ['❌ Bekor qilish']
    ]).resize(),
    essayType: (lang = 'uz') => {
        const labels = {
            uz: ['📝 Insho', '📝 Esse'],
            ru: ['📝 Сочинение', '📝 Эссе'],
            en: ['📝 Composition', '📝 Essay'],
            id: ['📝 Karangan', '📝 Esai'],
        };
        const l = labels[lang] || labels.uz;
        return Markup.keyboard([[l[0], l[1]], ['❌ Bekor qilish']]).resize();
    },
    essayWords: (lang = 'uz') => Markup.keyboard([
        ['500', '700', '1000'],
        ['❌ Bekor qilish']
    ]).resize(),
    referatType: (lang = 'uz') => {
        const labels = {
            uz: ['📚 Referat', '📑 Mustaqil Ish'],
            ru: ['📚 Реферат', '📑 Самост. Работа'],
            en: ['📚 Essay', '📑 Indep. Work'],
            id: ['📚 Esai', '📑 Tugas Mandiri'],
        };
        const l = labels[lang] || labels.uz;
        return Markup.keyboard([[l[0], l[1]], ['❌ Bekor qilish']]).resize();
    },
    pageCount: (lang = 'uz') => {
        const label = lang === 'ru' ? 'стр' : lang === 'id' ? 'hal' : lang === 'en' ? 'pages' : 'bet';
        return Markup.keyboard([
            [`10 ${label}`, `15 ${label}`, `20 ${label}`],
            ['❌ Bekor qilish']
        ]).resize();
    },
    pageCountSmall: (lang = 'uz') => {
        const label = lang === 'ru' ? 'стр' : lang === 'id' ? 'hal' : lang === 'en' ? 'pages' : 'bet';
        return Markup.keyboard([
            [`3 ${label}`, `5 ${label}`, `7 ${label}`, `10 ${label}`],
            ['❌ Bekor qilish']
        ]).resize();
    },
    payment: (lang = 'uz') => Markup.keyboard([
        ['💳 Click', '💳 Payme'],
        ['👨‍💻 Admin bilan bog\'lanish'],
        ['❌ Bekor qilish']
    ]).resize(),
    checkSend: (lang = 'uz') => Markup.keyboard([
        ['📸 Chek yuborish'],
        ['❌ Bekor qilish']
    ]).resize(),
    pdfMore: (lang = 'uz') => Markup.keyboard([
        ['➕ Yana rasm qo\'shish', '📄 PDF yaratish'],
        ['❌ Bekor qilish']
    ]).resize(),
    help: (lang = 'uz') => {
        const labels = {
            uz: ['📱 Bot ishlamayapti', '💳 To\'lov muammosi', '📄 Fayl kelmadi', '👨‍💻 Admin bilan bog\'lanish'],
            ru: ['📱 Бот не работает', '💳 Проблема с оплатой', '📄 Файл не пришёл', '👨‍💻 Связь с админом'],
            en: ['📱 Bot not working', '💳 Payment issue', '📄 File not received', '👨‍💻 Contact admin'],
            id: ['📱 Bot tidak berfungsi', '💳 Masalah pembayaran', '📄 File tidak diterima', '👨‍💻 Hubungi admin'],
        };
        const l = labels[lang] || labels.uz;
        return Markup.inlineKeyboard([
            [Markup.button.callback(l[0], 'help_bot')],
            [Markup.button.callback(l[1], 'help_payment')],
            [Markup.button.callback(l[2], 'help_file')],
            [Markup.button.callback(l[3], 'help_admin')]
        ]);
    },
    settings: (lang = 'uz') => {
        const labels = {
            uz: ['✏️ Ismni o\'zgartirish', '🌐 Tilni o\'zgartirish'],
            ru: ['✏️ Изменить имя', '🌐 Изменить язык'],
            en: ['✏️ Change name', '🌐 Change language'],
            id: ['✏️ Ubah nama', '🌐 Ubah bahasa'],
        };
        const l = labels[lang] || labels.uz;
        return Markup.inlineKeyboard([
            [Markup.button.callback(l[0], 'edit_name')],
            [Markup.button.callback(l[1], 'edit_lang')]
        ]);
    },
    rating: () => Markup.inlineKeyboard([[
        Markup.button.callback('⭐1', 'rate_1'),
        Markup.button.callback('⭐⭐2', 'rate_2'),
        Markup.button.callback('⭐⭐⭐3', 'rate_3'),
        Markup.button.callback('⭐⭐⭐⭐4', 'rate_4'),
        Markup.button.callback('⭐⭐⭐⭐⭐5', 'rate_5')
    ]]),
    adminPanel: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        return Markup.keyboard([
            [`📋 To\'lovlar`, `👥 Foydalanuvchilar`],
            [`📢 Xabar yuborish`, `📊 Statistika`],
            [`📩 Murojaatlar`, `👥 Batafsil Jadval`],
            [`🏠 Asosiy Menyu`]
        ]).resize();
    },
    // Yangi: Referral bo'limi uchun klaviatura
    referralMenu: (lang = 'uz') => {
        return Markup.inlineKeyboard([
            [Markup.button.callback('📤 Havolani Ulashish', 'share_referral')],
            [Markup.button.callback('📊 Taklif Holati', 'referral_status')]
        ]);
    },
    // Yangi: Yordam menyu
    helpMainMenu: (lang = 'uz') => {
        const labels = {
            uz: ['/start haqida', '/restart haqida', '/manuel — Qo\'llanma', '/admin bilan bog\'lanish', '/sozlama — Sozlamalar', '⬅️ Orqaga'],
            ru: ['О /start', 'О /restart', '/manuel — Руководство', 'Связь с /admin', '/sozlama — Настройки', '⬅️ Назад'],
            en: ['About /start', 'About /restart', '/manuel — Guide', 'Contact /admin', '/sozlama — Settings', '⬅️ Back'],
            id: ['Tentang /start', 'Tentang /restart', '/manuel — Panduan', 'Hubungi /admin', '/sozlama — Pengaturan', '⬅️ Kembali'],
        };
        const l = labels[lang] || labels.uz;
        return Markup.keyboard([
            [l[0], l[1]],
            [l[2], l[3]],
            [l[4]],
            [l[5]]
        ]).resize();
    },
    backToHelp: (lang = 'uz') => Markup.keyboard([['⬅️ Orqaga']]).resize(),
};

// ==================== GROQ AI ====================
async function groqAI(prompt, systemMsg) {
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                max_tokens: 4000,
                temperature: 0.7,
                messages: [
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ]
            })
        });
        const data = await res.json();
        if (!data?.choices?.[0]?.message?.content) {
            console.error('GROQ xato:', JSON.stringify(data).slice(0, 300));
            return null;
        }
        return data.choices[0].message.content;
    } catch (err) {
        console.error('GROQ fetch xato:', err.message);
        return null;
    }
}

// ==================== TIL BUYURUQLARI ====================
function langInstruction(lang) {
    const instructions = {
        uz: "Qat'iy qoida: JAVOB FAQAT O'ZBEK TILIDA BO'LSIN! Boshqa til ishlatmang!",
        ru: "Строгое правило: ОТВЕТ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ! Не используйте другие языки!",
        en: "Strict rule: ANSWER ONLY IN ENGLISH! Do not use any other language!",
        id: "Aturan ketat: JAWAB HANYA DALAM BAHASA INDONESIA! Jangan gunakan bahasa lain!"
    };
    return instructions[lang] || instructions.uz;
}

// ==================== AI KONTENT FUNKSIYALARI ====================
async function aiSlides(topic, count, lang = 'uz') {
    return groqAI(`"${topic}" mavzusida ${count} ta slayd uchun professional reja tayyorlang.
FORMAT (qat'iy):
SLIDE: Sarlavha | Batafsil matn (3-5 gap)
...
Jami ${count} ta SLIDE: bo'lishi SHART.\n${langInstruction(lang)}`);
}

async function aiTest(topic, count, diff, lang = 'uz') {
    const diffLabels = {
        uz: { easy: 'Oson', medium: "O'rta", hard: 'Qiyin' },
        ru: { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' },
        en: { easy: 'Easy', medium: 'Medium', hard: 'Hard' },
        id: { easy: 'Mudah', medium: 'Sedang', hard: 'Sulit' },
    };
    const d = diffLabels[lang] || diffLabels.uz;
    let diffText = diff;
    if (diff.includes('Oson') || diff.includes('Лёгк') || diff.includes('Easy') || diff.includes('Mudah')) diffText = d.easy;
    else if (diff.includes('Qiyin') || diff.includes('Сложн') || diff.includes('Hard') || diff.includes('Sulit')) diffText = d.hard;
    else diffText = d.medium;

    return groqAI(`"${topic}" mavzusida ${count} ta test savoli yarating. Qiyinlik: ${diffText}
FORMAT:
TEST: 1 | Savol matni | A) ... | B) ... | C) ... | D) ... | To'g'ri: A
...
Jami ${count} ta TEST: \n${langInstruction(lang)}`);
}

async function aiCrossword(topic, count, lang = 'uz') {
    return groqAI(`"${topic}" mavzusida ${count} ta krassvord savoli tayyorlang.
FORMAT:
SAVOL: 1 | Savol matni | JAVOB
...
JAVOB — lotin harflarda, bo'shliqsiz, 3-15 harf. Jami ${count} ta SAVOL: \n${langInstruction(lang)}`);
}

async function aiEssay(topic, type, words, lang = 'uz') {
    const typeLabels = {
        uz: { insho: 'insho', esse: 'esse' },
        ru: { insho: 'сочинение', esse: 'эссе' },
        en: { insho: 'composition', esse: 'essay' },
        id: { insho: 'karangan', esse: 'esai' },
    };
    const tl = typeLabels[lang] || typeLabels.uz;
    const typeName = type === 'insho' ? tl.insho : tl.esse;
    return groqAI(`"${topic}" mavzusida ${words} so'zdan iborat ${typeName} yozing. Kirish, asosiy qism, xulosa bo'lsin. \n${langInstruction(lang)}`);
}

async function aiReferat(topic, type, pages, lang = 'uz') {
    const typeLabels = {
        uz: { referat: 'Referat', mustaqil: 'Mustaqil Ish' },
        ru: { referat: 'Реферат', mustaqil: 'Самостоятельная Работа' },
        en: { referat: 'Essay', mustaqil: 'Independent Work' },
        id: { referat: 'Esai', mustaqil: 'Tugas Mandiri' },
    };
    const tl = typeLabels[lang] || typeLabels.uz;
    const typeName = type === 'referat' ? tl.referat : tl.mustaqil;
    return groqAI(`"${topic}" mavzusida ${pages} betlik ${typeName} tayyorlang.
FORMAT:
BET: 1 | Muqova | ...
BET: 2 | Reja | ...
BET: 3 | Kirish | ...
BET: N | ... | ...
Jami ${pages} ta BET: \n${langInstruction(lang)}`);
}

async function aiTezis(topic, pages, lang = 'uz') {
    return groqAI(`"${topic}" mavzusida ${pages} betlik konferensiya tezisi yozing. Ilmiy uslub. \n${langInstruction(lang)}`);
}

async function aiMaqola(topic, pages, lang = 'uz') {
    return groqAI(`"${topic}" mavzusida ${pages} betlik maqola yozing. Ilmiy-publitsistik uslub. \n${langInstruction(lang)}`);
}

async function aiInfografika(topic, lang = 'uz') {
    return groqAI(`"${topic}" haqida infografika uchun 8-10 ta qisqa, statistik va faktli ma'lumot tayyorlang.
FORMAT:
FAKT: Qisqa matn (raqam yoki %)
...
${langInstruction(lang)}`);
}

async function aiRasm(description, lang = 'uz') {
    return groqAI(`Quyidagi tavsif asosida professional badiiy tasvir uchun batafsil inglizcha prompt yozing (Stable Diffusion uchun):
"${description}"
Faqat prompt-ni yozing, boshqa narsa yozmang.\n${langInstruction(lang)}`);
}


// ==================== POLLINATIONS.AI RASM YUKLOVCHI ====================
async function downloadPollinationsImage(prompt, filePath, retries = 2) {
    const safePrompt = encodeURIComponent(prompt.replace(/['"]/g, '').slice(0, 200));
    const url = `https://image.pollinations.ai/prompt/${safePrompt}?width=800&height=450&nologo=true&seed=${Date.now() % 9999}`;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            await new Promise((resolve, reject) => {
                const req = https.get(url, { timeout: 18000 }, (res) => {
                    if (res.statusCode === 301 || res.statusCode === 302) {
                        https.get(res.headers.location, (r2) => {
                            const out = fs.createWriteStream(filePath);
                            r2.pipe(out);
                            out.on('finish', () => { out.close(); resolve(); });
                            out.on('error', reject);
                        }).on('error', reject);
                        return;
                    }
                    if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
                    const out = fs.createWriteStream(filePath);
                    res.pipe(out);
                    out.on('finish', () => { out.close(); resolve(); });
                    out.on('error', reject);
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            });
            const stat = fs.statSync(filePath);
            if (stat.size > 2000) return filePath;
        } catch (e) {
            console.warn(`Pollinations attempt ${attempt+1} failed:`, e.message);
            try { fs.unlinkSync(filePath); } catch (_) {}
        }
        if (attempt < retries) await new Promise(r => setTimeout(r, 1500));
    }
    return null;
}

// ==================== PPTX LABELS ====================
function pptxLabels(lang = 'uz') {
    const labels = {
        uz: { preparedBy: 'Tayyorladi', user: 'Foydalanuvchi', slide: 'slayd', slides: 'ta slayd', questions: 'ta savol', difficulty: 'Daraja', of: 'dan', test: 'TEST', crossword: 'KRASSVORD', answers: 'Javoblar Kaliti', thesis: 'TEZIS', infographic: 'INFOGRAFIKA', facts: 'Faktlar', article: 'MAQOLA' },
        ru: { preparedBy: 'Подготовил', user: 'Пользователь', slide: 'слайд', slides: 'слайдов', questions: 'вопросов', difficulty: 'Сложность', of: 'из', test: 'ТЕСТ', crossword: 'КРОССВОРД', answers: 'Ключ Ответов', thesis: 'ТЕЗИС', infographic: 'ИНФОГРАФИКА', facts: 'Факты', article: 'СТАТЬЯ' },
        en: { preparedBy: 'Prepared by', user: 'User', slide: 'slide', slides: 'slides', questions: 'questions', difficulty: 'Difficulty', of: 'of', test: 'TEST', crossword: 'CROSSWORD', answers: 'Answer Key', thesis: 'THESIS', infographic: 'INFOGRAPHIC', facts: 'Facts', article: 'ARTICLE' },
        id: { preparedBy: 'Diproses oleh', user: 'Pengguna', slide: 'slide', slides: 'slide', questions: 'pertanyaan', difficulty: 'Tingkat', of: 'dari', test: 'UJIAN', crossword: 'TTS', answers: 'Kunci Jawaban', thesis: 'TESIS', infographic: 'INFOGRAFIS', facts: 'Fakta', article: 'ARTIKEL' },
    };
    return labels[lang] || labels.uz;
}

function randColor() {
    const schemes = [
        { primary: '1a237e', bg: 'F5F5F5', text: '333333' },
        { primary: 'b71c1c', bg: 'FFF5F5', text: '333333' },
        { primary: '1b5e20', bg: 'F1F8E9', text: '333333' },
        { primary: '4a148c', bg: 'F3E5F5', text: '333333' },
        { primary: '006064', bg: 'E0F7FA', text: '333333' },
        { primary: 'e65100', bg: 'FFF3E0', text: '333333' },
    ];
    return schemes[Math.floor(Math.random() * schemes.length)];
}

// ==================== SLAYD PPTX YARATUVCHI ====================
async function makeSlidePptx(topic, aiText, userId, slideCount, templateId, lang = 'uz', userPicPath = null) {
    const pptx = new PptxGenJS();
    const user = getUser(userId);
    const clr = randColor();
    const lbl = pptxLabels(lang);
    pptx.layout = 'LAYOUT_16x9';
    pptx.title = topic;

    const parts = aiText.split(/SLIDE:/i).map(s => s.trim()).filter(s => s.length > 5);
    const limit = Math.min(parts.length || 1, slideCount);

    const slides = [];
    for (let i = 0; i < limit; i++) {
        const raw = parts[i] || '';
        let title = '', content = '';
        if (raw.includes('|')) {
            const sp = raw.split('|').map(x => x.trim());
            title = sp[0].replace(/^\d+[:.\-]?\s*/, '');
            content = sp.slice(1).join('\n');
        } else {
            const lines = raw.split('\n').filter(l => l.trim());
            title = lines[0]?.replace(/^\d+[:.\-]?\s*/, '') || `${topic} — ${i+1}`;
            content = lines.slice(1).join('\n');
        }
        slides.push({ title, content });
    }

    const coverImgPath = path.join(TEMP_DIR, `cover_${userId}_${Date.now()}.jpg`);
    const coverPrompt = `${topic}, professional presentation background, cinematic, high quality, abstract`;
    const coverImg = await downloadPollinationsImage(coverPrompt, coverImgPath);

    const cover = pptx.addSlide();
    if (coverImg) {
        cover.addImage({ path: coverImg, x: 0, y: 0, w: 10, h: 5.63, sizing: { type: 'cover', w: 10, h: 5.63 } });
        cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: '000000', transparency: 45 } });
    } else {
        cover.background = { color: clr.primary };
    }
    if (userPicPath && fs.existsSync(userPicPath)) {
        try {
            cover.addImage({ path: userPicPath, x: 0, y: 0, w: 10, h: 5.63, sizing: { type: 'cover', w: 10, h: 5.63 } });
            cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: '000000', transparency: 45 } });
        } catch(e) {
            cover.background = { color: clr.primary };
        }
    }
    cover.addText(topic, {
        x: 0.5, y: 1.3, w: '90%',
        fontSize: 34, bold: true, color: 'FFFFFF',
        align: 'center', fontFace: 'Arial',
        shadow: { type: 'outer', color: '000000', blur: 8, offset: 2, angle: 45 }
    });
    cover.addShape(pptx.ShapeType.line, { x: 2, y: 3.1, w: 6, h: 0, line: { color: 'FFFFFF', width: 2, transparency: 40 } });
    cover.addText(
        `${lbl.preparedBy}: ${user.name || lbl.user}\nSlaydTop AI`,
        { x: 0.5, y: 3.3, w: '90%', fontSize: 14, color: 'E0E0E0', align: 'center' }
    );

    const imgPaths = [];
    const imgPromises = slides.map((sl, i) => {
        const imgPath = path.join(TEMP_DIR, `slide_img_${userId}_${i}_${Date.now()}.jpg`);
        imgPaths.push(imgPath);
        const prompt = `${sl.title}, ${topic}, educational illustration, clean background, professional`;
        return downloadPollinationsImage(prompt, imgPath);
    });
    const downloadedImgs = await Promise.allSettled(imgPromises);

    for (let i = 0; i < limit; i++) {
        const { title, content } = slides[i];
        const imgResult = downloadedImgs[i];
        const imgFile = (imgResult.status === 'fulfilled' && imgResult.value) ? imgResult.value : null;

        const sl = pptx.addSlide();
        sl.background = { color: clr.bg };
        sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: clr.primary } });
        sl.addText(title || `${topic} — ${i+1}`, {
            x: 0.4, y: 0.22, w: '90%',
            fontSize: 22, bold: true, color: 'FFFFFF'
        });

        if (imgFile) {
            if (content) {
                sl.addText(content, {
                    x: 0.4, y: 1.25, w: 5.4,
                    fontSize: 14, color: clr.text,
                    lineSpacing: 24, valign: 'top'
                });
            }
            sl.addImage({
                path: imgFile,
                x: 6.0, y: 1.18, w: 3.7, h: 3.8,
                sizing: { type: 'contain', w: 3.7, h: 3.8 }
            });
            sl.addShape(pptx.ShapeType.rect, {
                x: 5.98, y: 1.16, w: 3.74, h: 3.84,
                fill: { type: 'none' },
                line: { color: clr.primary, width: 1.5, transparency: 60 }
            });
        } else {
            if (content) {
                sl.addText(content, {
                    x: 0.4, y: 1.25, w: '92%',
                    fontSize: 15, color: clr.text,
                    lineSpacing: 26, valign: 'top'
                });
            }
        }

        sl.addText(`${i+1} / ${limit}`, {
            x: 8.5, y: 5.1, w: 1.3,
            fontSize: 9, color: '999999', align: 'right'
        });
        sl.addText('SlaydTop AI', {
            x: 0.3, y: 5.1, w: 2,
            fontSize: 8, color: 'BBBBBB', italic: true
        });
    }

    const filePath = path.join(TEMP_DIR, `Slayd_${userId}_${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: filePath });

    try { if (coverImg) fs.unlinkSync(coverImg); } catch (_) {}
    for (const imgPath of imgPaths) {
        try { fs.unlinkSync(imgPath); } catch (_) {}
    }

    return filePath;
}

// ==================== DIAGRAMMALI SLAYD ====================
async function makeChartSlidePptx(topic, aiText, userId, slideCount, lang = 'uz') {
    const pptx = new PptxGenJS();
    const user = getUser(userId);
    pptx.layout = 'LAYOUT_16x9';
    pptx.title = topic;

    const chartColors = ['4472C4', 'ED7D31', 'A9D18E', 'FF0000', '9E480E', 'FFC000'];
    const bgColors = [
        { primary: '1565C0', bg: 'E3F2FD', text: '0D2137' },
        { primary: '2E7D32', bg: 'E8F5E9', text: '0A2E0C' },
        { primary: '6A1B9A', bg: 'F3E5F5', text: '2D0B4E' },
        { primary: 'BF360C', bg: 'FBE9E7', text: '4E1103' },
    ];
    const clr = bgColors[Math.floor(Math.random() * bgColors.length)];

    const cover = pptx.addSlide();
    cover.background = { color: clr.primary };
    cover.addText(`📈 ${topic}`, { x: 0.5, y: 1.2, w: '90%', fontSize: 34, bold: true, color: 'FFFFFF', align: 'center' });
    cover.addShape(pptx.ShapeType.line, { x: 2, y: 3.0, w: 6, h: 0, line: { color: 'FFFFFF', width: 2, transparency: 40 } });
    cover.addText(`${user.name || ''}\nSlaydTop AI — Diagrammali`, { x: 0.5, y: 3.2, w: '90%', fontSize: 13, color: 'E0E0E0', align: 'center' });

    const parts = aiText.split(/SLIDE:/i).map(s => s.trim()).filter(s => s.length > 5);
    const limit = Math.min(parts.length || 1, slideCount);

    for (let i = 0; i < limit; i++) {
        const raw = parts[i] || '';
        let title = '', content = '';
        if (raw.includes('|')) {
            const sp = raw.split('|').map(x => x.trim());
            title = sp[0].replace(/^\d+[:.\-]?\s*/, '');
            content = sp.slice(1).join('\n');
        } else {
            const lines = raw.split('\n').filter(l => l.trim());
            title = lines[0]?.replace(/^\d+[:.\-]?\s*/, '') || `${topic} — ${i+1}`;
            content = lines.slice(1).join('\n');
        }

        const sl = pptx.addSlide();
        sl.background = { color: clr.bg };
        sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.05, fill: { color: clr.primary } });
        sl.addText(title || `${topic} — ${i+1}`, { x: 0.4, y: 0.2, w: '90%', fontSize: 21, bold: true, color: 'FFFFFF' });

        if (content) {
            sl.addText(content, { x: 0.3, y: 1.15, w: 4.8, fontSize: 13, color: clr.text, lineSpacing: 22, valign: 'top' });
        }

        const chartType = i % 3 === 0 ? pptx.ChartType.bar : i % 3 === 1 ? pptx.ChartType.pie : pptx.ChartType.line;
        const labels = ['A', 'B', 'C', 'D', 'E'];
        const values = [
            Math.floor(Math.random() * 70) + 30,
            Math.floor(Math.random() * 70) + 30,
            Math.floor(Math.random() * 70) + 30,
            Math.floor(Math.random() * 70) + 30,
            Math.floor(Math.random() * 70) + 30,
        ];

        try {
            sl.addChart(chartType, [{ name: title, labels, values }], {
                x: 5.2, y: 1.1, w: 4.5, h: 3.9,
                showLegend: false, showValue: true,
                chartColors, dataLabelFontSize: 10,
            });
        } catch(e) {
            sl.addShape(pptx.ShapeType.rect, { x: 5.2, y: 1.1, w: 4.5, h: 3.9, fill: { color: clr.primary, transparency: 85 }, line: { color: clr.primary, width: 1 } });
            sl.addText('📊 Diagramma', { x: 5.5, y: 2.8, w: 4, fontSize: 14, color: clr.primary, align: 'center' });
        }

        sl.addText(`${i+1} / ${limit}`, { x: 8.5, y: 5.1, w: 1.3, fontSize: 9, color: '999999', align: 'right' });
        sl.addText('SlaydTop AI', { x: 0.3, y: 5.1, w: 2, fontSize: 8, color: 'BBBBBB', italic: true });
    }

    const filePath = path.join(TEMP_DIR, `Chart_${userId}_${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: filePath });
    return filePath;
}

// ==================== TEST PPTX ====================
async function makeTestPptx(topic, aiText, userId, testCount, difficulty, lang = 'uz') {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    const lbl = pptxLabels(lang);

    const tests = aiText.split(/TEST:/i).map(s => s.trim()).filter(s => s.length > 5);
    const items = [];
    tests.forEach(t => {
        const p = t.split('|').map(x => x.trim());
        if (p.length >= 6) items.push({ q: p[1], opts: p.slice(2, 6), ans: p[6] || '' });
    });
    const limit = Math.min(items.length, testCount);

    const cover = pptx.addSlide();
    cover.background = { color: '4A148C' };
    cover.addText(lbl.test, { x: 0.5, y: 1.2, w: '90%', fontSize: 38, bold: true, color: 'FFFFFF', align: 'center' });
    cover.addText(`${lbl.topic}: ${topic}\n${lbl.difficulty}: ${difficulty}\n${limit} ${lbl.questions}`, { x: 0.5, y: 2.5, w: '90%', fontSize: 16, color: 'E1BEE7', align: 'center' });

    for (let i = 0; i < limit; i += 2) {
        const sl = pptx.addSlide();
        sl.background = { color: 'F3E5F5' };
        sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.85, fill: { color: '7B1FA2' } });
        const qLabel = lang === 'ru' ? 'Вопросы' : lang === 'en' ? 'Questions' : lang === 'id' ? 'Pertanyaan' : 'Savollar';
        sl.addText(`${qLabel} ${i+1}–${Math.min(i+2, limit)}`, { x: 0.5, y: 0.2, w: '90%', fontSize: 16, bold: true, color: 'FFFFFF' });
        let y = 1.0;
        for (let j = i; j < Math.min(i+2, limit); j++) {
            const item = items[j];
            sl.addText(`${j+1}. ${item.q}`, { x: 0.5, y, w: '90%', fontSize: 13, bold: true, color: '4A148C' });
            y += 0.38;
            item.opts.forEach(opt => { sl.addText(`  ${opt}`, { x: 0.8, y, w: '85%', fontSize: 12, color: '333333' }); y += 0.3; });
            y += 0.2;
        }
    }

    const ans = pptx.addSlide();
    ans.background = { color: 'E8F5E9' };
    ans.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: '2E7D32' } });
    ans.addText(lbl.answers, { x: 0.5, y: 0.28, w: '90%', fontSize: 22, bold: true, color: 'FFFFFF' });
    let keyText = '';
    items.slice(0, limit).forEach((it, i) => { const m = it.ans?.match(/[A-D]/); keyText += `${i+1}. ${m?m[0]:'?'}   `; if ((i+1)%5===0) keyText+='\n'; });
    ans.addText(keyText, { x: 0.5, y: 1.4, w: '90%', fontSize: 16, color: '333333', lineSpacing: 28 });

    const filePath = path.join(TEMP_DIR, `Test_${userId}_${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: filePath });
    return filePath;
}

// ==================== KRASSVORD PPTX ====================
async function makeCrosswordPptx(topic, aiText, userId, count, lang = 'uz') {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    const lbl = pptxLabels(lang);

    const qs = aiText.split(/SAVOL:/i).map(s => s.trim()).filter(s => s.length > 3);
    const items = [];
    qs.forEach(q => {
        const p = q.split('|').map(x => x.trim());
        if (p.length >= 2) items.push({ text: p[1] || p[0], answer: (p[2] || '').toUpperCase().replace(/\s/g,'') });
    });
    const limit = Math.min(items.length, count);

    const cover = pptx.addSlide();
    cover.background = { color: '1B5E20' };
    cover.addText(lbl.crossword, { x: 0.5, y: 1.2, w: '90%', fontSize: 36, bold: true, color: 'FFFFFF', align: 'center' });
    cover.addText(`${lbl.topic}: ${topic}\n${limit} ${lbl.questions}\nSlaydTop AI`, { x: 0.5, y: 2.5, w: '90%', fontSize: 14, color: 'C8E6C9', align: 'center' });

    const qListLabel = lang === 'ru' ? 'Список вопросов' : lang === 'en' ? 'Question List' : lang === 'id' ? 'Daftar Pertanyaan' : 'Savollar ro\'yxati';
    const qSlide = pptx.addSlide();
    qSlide.background = { color: 'E8F5E9' };
    qSlide.addText(qListLabel, { x: 0.5, y: 0.3, w: '90%', fontSize: 22, bold: true, color: '1B5E20' });
    qSlide.addText(items.slice(0, limit).map((q,i) => `${i+1}. ${q.text}`).join('\n'), { x: 0.5, y: 1.0, w: '90%', fontSize: 14, color: '333333', lineSpacing: 22 });

    const ansSlide = pptx.addSlide();
    ansSlide.background = { color: 'E3F2FD' };
    ansSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: '1565C0' } });
    ansSlide.addText(lbl.answers, { x: 0.5, y: 0.28, w: '90%', fontSize: 22, bold: true, color: 'FFFFFF' });
    const charLabel = lang === 'ru' ? 'букв' : lang === 'en' ? 'chars' : lang === 'id' ? 'huruf' : 'harf';
    ansSlide.addText(items.slice(0, limit).map((q,i) => `${i+1}. ${q.answer} (${q.answer.length} ${charLabel})`).join('\n'), { x: 0.5, y: 1.3, w: '90%', fontSize: 14, color: '333333', lineSpacing: 22 });

    const filePath = path.join(TEMP_DIR, `Krassvord_${userId}_${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: filePath });
    return filePath;
}

// ==================== MATN PPTX (Referat, Insho, Tezis, Maqola) ====================
async function makeTextPptx(title, content, userId, type, lang = 'uz') {
    const pptx = new PptxGenJS();
    const clr = randColor();
    pptx.layout = 'LAYOUT_16x9';
    const lbl = pptxLabels(lang);

    const cover = pptx.addSlide();
    cover.background = { color: clr.primary };
    cover.addText(title.toUpperCase(), { x: 0.5, y: 1.3, w: '90%', fontSize: 36, bold: true, color: 'FFFFFF', align: 'center' });

    const user = getUser(userId);
    const doneByLabel = lang === 'ru' ? 'Выполнил' : lang === 'en' ? 'Done by' : lang === 'id' ? 'Dibuat oleh' : 'Tayyorladi';
    cover.addText(`${doneByLabel}: ${user.name || ''}\nSlaydTop AI`, { x: 0.5, y: 3.0, w: '90%', fontSize: 14, color: 'E0E0E0', align: 'center' });

    if (content.includes('BET:')) {
        const pages = content.split(/BET:/i).map(s => s.trim()).filter(s => s.length > 3);
        pages.forEach((pg, i) => {
            const p = pg.split('|').map(x => x.trim());
            const pgTitle = p[1] || `${lbl.page} ${i+1}`;
            const pgContent = p.slice(2).join('\n') || p[0];
            const sl = pptx.addSlide();
            sl.background = { color: clr.bg };
            sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.0, fill: { color: clr.primary } });
            sl.addText(pgTitle, { x: 0.5, y: 0.25, w: '90%', fontSize: 20, bold: true, color: 'FFFFFF' });
            sl.addText(pgContent, { x: 0.5, y: 1.2, w: '90%', fontSize: 13, color: clr.text, lineSpacing: 22 });
            sl.addText(`${i+1}`, { x: 8.5, y: 5.0, w: 1, fontSize: 9, color: '999999', align: 'right' });
        });
    } else {
        const chunkSize = 1200;
        const chunks = [];
        for (let i = 0; i < content.length; i += chunkSize) chunks.push(content.slice(i, i + chunkSize));
        chunks.forEach((chunk, i) => {
            const sl = pptx.addSlide();
            sl.background = { color: clr.bg };
            sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.85, fill: { color: clr.primary } });
            sl.addText(title, { x: 0.5, y: 0.2, w: '90%', fontSize: 18, bold: true, color: 'FFFFFF' });
            sl.addText(chunk, { x: 0.5, y: 1.1, w: '90%', fontSize: 13, color: clr.text, lineSpacing: 22 });
            sl.addText(`${i+1}`, { x: 8.5, y: 5.0, w: 1, fontSize: 9, color: '999999', align: 'right' });
        });
    }

    const filePath = path.join(TEMP_DIR, `${type}_${userId}_${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: filePath });
    return filePath;
}

// ==================== INFOGRAFIKA PPTX ====================
async function makeInfoPptx(topic, aiText, userId, lang = 'uz') {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    const clr = { primary: '006064', bg: 'E0F7FA', text: '004D40' };
    const lbl = pptxLabels(lang);

    const cover = pptx.addSlide();
    cover.background = { color: clr.primary };
    cover.addText(`📊 ${lbl.infographic}`, { x: 0.5, y: 1.2, w: '90%', fontSize: 32, bold: true, color: 'FFFFFF', align: 'center' });
    cover.addText(topic, { x: 0.5, y: 2.5, w: '90%', fontSize: 20, color: 'B2EBF2', align: 'center' });
    cover.addText('SlaydTop AI', { x: 0.5, y: 3.5, w: '90%', fontSize: 12, color: '80DEEA', align: 'center' });

    const facts = aiText.split(/FAKT:/i).map(s => s.trim()).filter(s => s.length > 3);

    for (let i = 0; i < facts.length; i += 4) {
        const sl = pptx.addSlide();
        sl.background = { color: clr.bg };
        sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.9, fill: { color: clr.primary } });
        sl.addText(`${topic} — ${lbl.facts}`, { x: 0.5, y: 0.2, w: '90%', fontSize: 18, bold: true, color: 'FFFFFF' });

        let y = 1.1;
        for (let j = i; j < Math.min(i+4, facts.length); j++) {
            sl.addShape(pptx.ShapeType.rect, { x: 0.4, y, w: 0.05, h: 0.4, fill: { color: clr.primary } });
            sl.addText(facts[j], { x: 0.7, y: y+0.05, w: '85%', fontSize: 14, color: clr.text, bold: j===i });
            y += 0.85;
        }
    }

    const filePath = path.join(TEMP_DIR, `Infografika_${userId}_${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: filePath });
    return filePath;
}

// ==================== RASMDAN PDF ====================
async function imagesToPdf(imagePaths, userId) {
    return new Promise(async (resolve, reject) => {
        try {
            const pdfPath = path.join(TEMP_DIR, `PDF_${userId}_${Date.now()}.pdf`);
            const doc = new PDFDocument({ autoFirstPage: false, margin: 20 });
            const writeStream = fs.createWriteStream(pdfPath);
            doc.pipe(writeStream);

            for (const imgPath of imagePaths) {
                try {
                    const jimpImg = await Jimp.read(imgPath);
                    const origW = jimpImg.getWidth();
                    const origH = jimpImg.getHeight();

                    const pageW = 595.28, pageH = 841.89;
                    const margin = 20;
                    const maxW = pageW - margin * 2;
                    const maxH = pageH - margin * 2;

                    let drawW = origW, drawH = origH;
                    if (drawW > maxW) { drawH = drawH * maxW / drawW; drawW = maxW; }
                    if (drawH > maxH) { drawW = drawW * maxH / drawH; drawH = maxH; }

                    const convertedPath = imgPath + '_conv.jpg';
                    await jimpImg.quality(85).writeAsync(convertedPath);

                    doc.addPage({ size: 'A4', margin: 0 });
                    const x = (pageW - drawW) / 2;
                    const y = (pageH - drawH) / 2;
                    doc.image(convertedPath, x, y, { width: drawW, height: drawH });

                    try { fs.unlinkSync(convertedPath); } catch (_) {}
                } catch (imgErr) {
                    console.error('Rasm o\'qishda xato:', imgErr.message);
                }
            }

            doc.end();
            writeStream.on('finish', () => resolve(pdfPath));
            writeStream.on('error', reject);
        } catch (err) {
            reject(err);
        }
    });
}

// ==================== BOT ====================
const bot = new Telegraf(BOT_TOKEN);
bot.use(new LocalSession({ database: path.join(DATA_DIR, 'sessions.json') }).middleware());
bot.use((ctx, next) => { if (!ctx.session) ctx.session = {}; return next(); });

// ==================== REACTION MIDDLEWARE ====================
bot.use(async (ctx, next) => {
    if (ctx.message && ctx.chat && ctx.message.message_id) {
        try {
            await ctx.telegram.callApi('setMessageReaction', {
                chat_id: ctx.chat.id,
                message_id: ctx.message.message_id,
                reaction: [{ type: 'emoji', emoji: '👍' }],
                is_big: false
            });
        } catch (_) {}
    }
    return next();
});

// ==================== KANAL OBUNA TEKSHIRUVI ====================
async function isSubscribed(userId) {
    try {
        const member = await bot.telegram.getChatMember('@SlaydTop_01', userId);
        return ['member','administrator','creator'].includes(member.status);
    } catch(_) {
        return true;
    }
}

async function checkAndAskSubscribe(ctx) {
    const userId = ctx.from.id;
    if (userId === ADMIN_ID) return true;
    const subscribed = await isSubscribed(userId);
    if (!subscribed) {
        await ctx.reply(
            '📢 *Botdan foydalanish uchun kanalimizga a\'zo bo\'ling!*\n\n' +
            '👉 https://t.me/SlaydTop_01\n\n' +
            'A\'zo bo\'lgandan keyin /start bosing.',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '📢 Kanalga O\'tish', url: 'https://t.me/SlaydTop_01' },
                        { text: '✅ A\'zo bo\'ldim', callback_data: 'check_sub' }
                    ]]
                }
            }
        );
        return false;
    }
    return true;
}

// ==================== START HANDLER ====================
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);

    // Kanal obuna tekshiruvi
    if (userId !== ADMIN_ID) {
        const ok = await isSubscribed(userId);
        if (!ok) {
            return ctx.reply(
                '📢 *Botdan foydalanish uchun kanalimizga a\'zo bo\'ling!*\n\n' +
                '✅ A\'zo bo\'lgandan keyin /start bosing.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '📢 Kanalga O\'tish', url: 'https://t.me/SlaydTop_01' },
                            { text: '✅ A\'zo bo\'ldim', callback_data: 'check_sub' }
                        ]]
                    }
                }
            );
        }
    }

    // Referral tekshirish
    const startPayload = ctx.startPayload;
    if (startPayload?.startsWith('ref_')) {
        const inviterId = parseInt(startPayload.slice(4));
        if (inviterId && inviterId !== userId && !user.invitedBy) {
            updateUser(userId, { invitedBy: inviterId });
            const inv = getUser(inviterId);
            const newCount = (inv.invitedCount || 0) + 1;
            updateUser(inviterId, { invitedCount: newCount });

            // 3 ta do'st = umrbod bepul
            if (newCount >= 3 && !inv.permanentFree) {
                updateUser(inviterId, { permanentFree: true });
                try {
                    const invLang = getLang(inviterId);
                    await bot.telegram.sendMessage(inviterId,
                        T[invLang]?.referralSuccess?.(newCount) || T.uz.referralSuccess(newCount),
                        { parse_mode: 'Markdown' }
                    );
                } catch (_) {}
            } else {
                const invLang = getLang(inviterId);
                try {
                    await bot.telegram.sendMessage(inviterId,
                        T[invLang]?.referralProgress?.(newCount) || T.uz.referralProgress(newCount),
                        { parse_mode: 'Markdown' }
                    );
                } catch (_) {}
            }
        }
    }

    const lang = getLang(userId);
    if (!user.registered) {
        updateUser(userId, { step: 'LANG_SELECT' });
        return ctx.reply(T[lang]?.welcome || T.uz.welcome, { parse_mode: 'Markdown', ...KB.langSelect() });
    }

    return ctx.reply(t(userId, 'mainMenu', user.name || 'Do\'stim'), {
        parse_mode: 'Markdown',
        ...KB.mainMenu(lang, userId === ADMIN_ID)
    });
});

// ==================== /restart COMMAND ====================
bot.command('restart', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    updateUser(userId, { step: 'MAIN_MENU' });
    const user = getUser(userId);
    return ctx.reply(t(userId, 'restored'), KB.mainMenu(lang, userId === ADMIN_ID));
});

// ==================== /manuel COMMAND ====================
bot.command('manuel', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const helpText = T[lang]?.helpDetails || T.uz.helpDetails;
    return ctx.reply(helpText, {
        parse_mode: 'Markdown',
        ...KB.mainMenu(lang, userId === ADMIN_ID)
    });
});

// ==================== /yordam COMMAND ====================
bot.command('yordam', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    updateUser(userId, { step: 'HELP_SECTION' });
    return ctx.reply(t(userId, 'help'), { ...KB.help(lang), parse_mode: 'Markdown' });
});

// ==================== /admin COMMAND ====================
bot.command('admin', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    updateUser(userId, { step: 'CONTACT_ADMIN' });
    return ctx.reply(t(userId, 'adminMsg'), {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['❌ Bekor qilish']]).resize()
    });
});

// ==================== /sozlama COMMAND ====================
bot.command('sozlama', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    const lang = getLang(userId);
    return ctx.reply(t(userId, 'settings', user), { ...KB.settings(lang), parse_mode: 'Markdown' });
});

// ==================== TIL TANLASH CALLBACK ====================
bot.action(/lang_(uz|ru|en|id)/, async (ctx) => {
    const lang = ctx.match[1];
    const userId = ctx.from.id;
    updateUser(userId, { lang, step: 'WAITING_NAME' });
    await ctx.answerCbQuery('✅ Til tanlandi!');
    await ctx.editMessageText('✅');
    return ctx.reply(T[lang]?.enterName || T.uz.enterName, {
        parse_mode: 'Markdown',
        ...KB.cancel(lang)
    });
});

// ==================== KANAL TEKSHIRUV CALLBACK ====================
bot.action('check_sub', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    const ok = await isSubscribed(userId);
    if (ok) {
        await ctx.editMessageText('✅ Rahmat! Kanalga a\'zo bo\'ldingiz!');
        const user = getUser(userId);
        const lang = getLang(userId);
        if (!user.registered) {
            updateUser(userId, { step: 'LANG_SELECT' });
            return ctx.reply(T[lang]?.welcome || T.uz.welcome, { parse_mode: 'Markdown', ...KB.langSelect() });
        }
        return ctx.reply(t(userId, 'mainMenu', user.name || 'Do\'stim'), {
            parse_mode: 'Markdown',
            ...KB.mainMenu(lang, userId === ADMIN_ID)
        });
    } else {
        return ctx.answerCbQuery('Hali a\'zo emassiz! Avval kanalga a\'zo bo\'ling.', { show_alert: true });
    }
});

// ==================== BAHOLASH CALLBACK ====================
bot.action(/rate_(\d)/, async (ctx) => {
    const r = parseInt(ctx.match[1]);
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const rateLabels = {
        uz: `⭐ ${r} ta yulduz! Rahmat!`,
        ru: `⭐ ${r} звёзд! Спасибо!`,
        en: `⭐ ${r} stars! Thanks!`,
        id: `⭐ ${r} bintang! Terima kasih!`,
    };
    await ctx.answerCbQuery(rateLabels[lang] || rateLabels.uz);
    try { await ctx.editMessageReplyMarkup({}); } catch (_) {}
    await ctx.reply(t(userId, 'rateThank', r), KB.mainMenu(lang, userId === ADMIN_ID));
});

// ==================== REFERRAL CALLBACKS ====================
bot.action('share_referral', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    await ctx.answerCbQuery();
    const link = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;
    const shareText = T[lang]?.shareReferral?.(link) || T.uz.shareReferral(link);
    await ctx.reply(shareText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: '📤 Do\'stlarga yuborish', url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('🎁 SlaydTop bot — barcha xizmatlar BEPUL! Qo\'shil!')}` }
            ]]
        }
    });
});

bot.action('referral_status', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const user = getUser(userId);
    await ctx.answerCbQuery();
    const statusText = T[lang]?.referralProgress?.(user.invitedCount || 0) || T.uz.referralProgress(user.invitedCount || 0);
    await ctx.reply(statusText, { parse_mode: 'Markdown' });
});

// ==================== YORDAM CALLBACKLARI ====================
bot.action('help_bot', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    await ctx.answerCbQuery();
    await ctx.reply(t(userId, 'helpBot'), KB.mainMenu(lang, userId === ADMIN_ID));
});
bot.action('help_payment', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    await ctx.answerCbQuery();
    await ctx.reply(t(userId, 'helpPayment', ADMIN_USERNAME, ADMIN_PHONE), KB.mainMenu(lang, userId === ADMIN_ID));
});
bot.action('help_file', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    await ctx.answerCbQuery();
    await ctx.reply(t(userId, 'helpFile', ADMIN_USERNAME), KB.mainMenu(lang, userId === ADMIN_ID));
});
bot.action('help_admin', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    await ctx.answerCbQuery();
    updateUser(userId, { step: 'CONTACT_ADMIN' });
    await ctx.reply(t(userId, 'adminMsg'), {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['❌ Bekor qilish']]).resize()
    });
});

// ==================== SOZLAMALAR CALLBACKLARI ====================
bot.action('edit_name', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    await ctx.answerCbQuery();
    updateUser(userId, { step: 'EDIT_NAME' });
    await ctx.reply(t(userId, 'editNamePrompt'), KB.cancel(lang));
});
bot.action('edit_lang', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    updateUser(userId, { step: 'LANG_SELECT' });
    return ctx.reply(t(userId, 'welcome'), { parse_mode: 'Markdown', ...KB.langSelect() });
});

// ==================== ASOSIY MENYU HANDLERLARI ====================

// --- BALANS ---
bot.hears([/💰 .*/, '💰 Mening Hisobim', '💰 Мой Счёт', '💰 My Account', '💰 Saldo Saya'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    return ctx.reply(t(userId, 'balance', user), {
        parse_mode: 'Markdown',
        ...KB.mainMenu(lang, userId === ADMIN_ID)
    });
});

// --- BEPUL OLISH (Referral bo'limi) ---
bot.hears([/🎁 .*/, '🎁 Bepul Olish', '🎁 Бесплатно', '🎁 Get Free', '🎁 Gratis'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    const link = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;
    const freeText = t(userId, 'free', userId, BOT_USERNAME, user.invitedCount || 0);
    return ctx.reply(freeText, {
        parse_mode: 'Markdown',
        ...KB.referralMenu(lang),
        ...KB.mainMenu(lang, userId === ADMIN_ID)
    });
});

// --- YORDAM ---
bot.hears([/❓ .*/, '❓ Yordam', '❓ Помощь', '❓ Help', '❓ Bantuan'], async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    updateUser(userId, { step: 'HELP_SECTION' });
    return ctx.reply(t(userId, 'help'), { ...KB.help(lang), parse_mode: 'Markdown' });
});

// --- SOZLAMALAR ---
bot.hears([/⚙️ .*/, '⚙ Sozlamalar', '⚙ Настройки', '⚙ Settings', '⚙ Pengaturan'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    const lang = getLang(userId);
    return ctx.reply(t(userId, 'settings', user), { ...KB.settings(lang), parse_mode: 'Markdown' });
});

// --- SLAYD YARATISH ---
bot.hears([/🎞 .*/, '🎞 Yangi Slayd', '🎞 Новый Слайд', '🎞 New Slide', '🎞 Slide Baru'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'SLAYD_TOPIC' });

    const summerMsg = isSummerFree()
        ? `\n\n🔥 *YOZ AKSIYASI — 1-SENTABRGACHA!*\n🎁 *Barcha xizmatlar MUTLAQO BEPUL!*\n`
        : '';

    const paketlar = `🎁 Sinov — MUTLAQO BEPUL\n⚡ Iqtidor — MUTLAQO BEPUL\n💎 Professional — MUTLAQO BEPUL\n👑 Premium — MUTLAQO BEPUL`;

    return ctx.reply(
        `🎞 *Yangi Slayd Yaratish*${summerMsg}\n\n💰 Balansingiz: ${(user.balance||0).toLocaleString()} so'm\n\n📦 Paketlar:\n${paketlar}\n🌟 Infinity — MUTLAQO BEPUL\n\n📌 *Mavzuni kiriting:*`,
        { parse_mode: 'Markdown', ...KB.cancel(lang) }
    );
});

// --- RASMDAN PDF ---
bot.hears([/📄 .*/, '📄 Rasmdan PDF', '📄 Фото в PDF', '📄 Image to PDF', '📄 Gambar ke PDF'], async (ctx) => {
    const userId = ctx.from.id;
    if (!getUser(userId).registered) return;
    const lang = getLang(userId);
    ctx.session.pdfImages = [];
    updateUser(userId, { step: 'PDF_WAITING' });
    return ctx.reply(t(userId, 'pdfFree'), { parse_mode: 'Markdown', ...KB.cancel(lang) });
});

// --- REFERAT / MUSTAQIL ---
bot.hears([/📚 .*/, '📚 Referat / Mustaqil Ish', '📚 Реферат / Самост. Работа', '📚 Essay / Research', '📚 Esai / Penelitian'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'REFERAT_TYPE' });
    return ctx.reply(t(userId, 'referatTypePrompt', user.balance || 0, 0), KB.referatType(lang));
});

// --- INSHO / ESSE ---
bot.hears([/✍️ .*/, '✍ Insho / Esse', '✍ Сочинение / Эссе', '✍ Composition / Essay', '✍ Karangan / Esai'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'ESSAY_TYPE' });
    return ctx.reply(t(userId, 'essayTypePrompt', user.balance || 0, 0), KB.essayType(lang));
});

// --- TEST ---
bot.hears([/📝 .*/, '📝 Yangi Test', '📝 Новый Тест', '📝 New Test', '📝 Ujian Baru'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'TEST_TOPIC' });
    return ctx.reply(t(userId, 'testPrompt', user.balance || 0, 0), { parse_mode: 'Markdown', ...KB.cancel(lang) });
});

// --- KRASSVORD ---
bot.hears([/🔲 .*/, '🔲 Yangi Krassvord', '🔲 Новый Кроссворд', '🔲 New Crossword', '🔲 TTS Baru'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'CROSS_TOPIC' });
    return ctx.reply(t(userId, 'crossPrompt', user.balance || 0, 0), { parse_mode: 'Markdown', ...KB.cancel(lang) });
});

// --- TEZIS ---
bot.hears([/🎓 .*/, '🎓 Tezis', '🎓 Тезис', '🎓 Thesis', '🎓 Tesis'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'TEZIS_TOPIC' });
    return ctx.reply(t(userId, 'tezisPrompt', user.balance || 0, 0), { parse_mode: 'Markdown', ...KB.cancel(lang) });
});

// --- MAQOLA ---
bot.hears([/📰 .*/, '📰 Maqola', '📰 Статья', '📰 Article', '📰 Artikel'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'MAQOLA_TOPIC' });
    return ctx.reply(t(userId, 'maqolaPrompt', user.balance || 0, 0), { parse_mode: 'Markdown', ...KB.cancel(lang) });
});

// --- INFOGRAFIKA ---
bot.hears([/📊 .*/, '📊 Infografika', '📊 Инфографика', '📊 Infographic', '📊 Infografis'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'INFO_TOPIC' });
    return ctx.reply(t(userId, 'infoPrompt', user.balance || 0, 0), { parse_mode: 'Markdown', ...KB.cancel(lang) });
});

// --- RASM YARATISH ---
bot.hears([/🖼 .*/, '🖼 Rasm Yaratish (AI)', '🖼 Создать Картинку (AI)', '🖼 Create Image (AI)', '🖼 Buat Gambar (AI)'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'RASM_DESC' });
    return ctx.reply(t(userId, 'rasmPrompt', user.balance || 0, 0), { parse_mode: 'Markdown', ...KB.cancel(lang) });
});

// --- QR KOD ---
bot.hears([/🔗 .*/, '🔗 QR Kod', '🔗 QR Код', '🔗 QR Code', '🔗 Kode QR'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    updateUser(userId, { step: 'QR_INPUT' });
    return ctx.reply(T[getLang(userId)]?.qrWelcome || T.uz.qrWelcome, {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['❌ Bekor qilish']]).resize()
    });
});

// --- PDF SIQISH ---
bot.hears([/📦 .*/, '📦 PDF Siqish', '📦 Сжать PDF', '📦 Compress PDF', '📦 Kompres PDF'], async (ctx) => {
    const userId = ctx.from.id;
    if (!getUser(userId).registered) return;
    updateUser(userId, { step: 'PDF_COMPRESS_WAITING' });
    return ctx.reply(
        `📦 *PDF Siqish* — MUTLAQO BEPUL! 🎁\n\n` +
        `PDF faylni yuboring, men uni sifatini yo'qotmay kichraytirib beraman!\n\n` +
        `✅ Katta hajmdagi PDF fayllar\n` +
        `✅ Sifat saqlanadi\n` +
        `✅ 50 MB gacha\n\n📎 PDF faylni yuboring:`,
        { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
});

// --- PPTX → PDF ---
bot.hears([/📊 PPTX .*/], async (ctx) => {
    const userId = ctx.from.id;
    if (!getUser(userId).registered) return;
    return ctx.reply(
        `📊 *PPTX → PDF* — MUTLAQO BEPUL! 🎁\n\n` +
        `PPTX yoki PPT faylni yuboring, men PDF ga o'girib beraman!\n\n✅ Format buzilmadi\n✅ 50 MB gacha`,
        { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
});

// --- DOCX → PDF ---
bot.hears([/📝 DOCX .*/], async (ctx) => {
    const userId = ctx.from.id;
    if (!getUser(userId).registered) return;
    return ctx.reply(
        `📝 *DOCX → PDF* — MUTLAQO BEPUL! 🎁\n\n` +
        `Word faylni (DOCX yoki DOC) yuboring, men PDF ga o'girib beraman!\n\n✅ Matn va jadvallar saqlanadi\n✅ 50 MB gacha`,
        { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
});

// --- PDF → Word ---
bot.hears([/📄 PDF → Word/], async (ctx) => {
    const userId = ctx.from.id;
    if (!getUser(userId).registered) return;
    updateUser(userId, { step: 'PDF_TO_WORD_WAITING' });
    return ctx.reply(
        `📄 *PDF → Word* — MUTLAQO BEPUL! 🎁\n\n` +
        `PDF faylni yuboring, men Word (DOCX) ga o'girib beraman!\n\n✅ Matn saqlanadi\n⚠️ Murakkab formatlash to'liq saqlanmasligi mumkin\n✅ 50 MB gacha`,
        { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
});

// --- Audio/Video → MP3 ---
bot.hears([/🎬 .*/], async (ctx) => {
    const userId = ctx.from.id;
    if (!getUser(userId).registered) return;
    return ctx.reply(
        `🎬 *Audio/Video → MP3* — MUTLAQO BEPUL! 🎁\n\n` +
        `Faylni yuboring, men MP3 ga o'girib beraman!\n\n` +
        `✅ Video: MP4, AVI, MKV, MOV, FLV, WEBM\n` +
        `✅ Audio: WAV, FLAC, OGG, AAC, M4A, WMA, OPUS\n` +
        `✅ 50 MB gacha`,
        { parse_mode: 'Markdown', ...Markup.keyboard([['❌ Bekor qilish']]).resize() }
    );
});

// --- Admin bilan bog'lanish ---
bot.hears([/👨‍💻 .*/], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'CONTACT_ADMIN' });
    return ctx.reply(t(userId, 'adminMsg'), {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['❌ Bekor qilish']]).resize()
    });
});

// --- ASOSIY MENYU QAYTISH ---
bot.hears([/🏠 .*/, '🏠 Asosiy Menyu', '🏠 Главное меню', '🏠 Main Menu', '🏠 Menu Utama'], async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const user = getUser(userId);
    updateUser(userId, { step: 'MAIN_MENU' });
    return ctx.reply(t(userId, 'mainMenu', user.name || 'Do\'stim'), {
        parse_mode: 'Markdown',
        ...KB.mainMenu(lang, userId === ADMIN_ID)
    });
});

// --- ORQAGA ---
bot.hears([/⬅️ .*/, '⬅️ Orqaga', '⬅️ Назад', '⬅️ Back', '⬅️ Kembali'], async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const user = getUser(userId);
    updateUser(userId, { step: 'MAIN_MENU' });
    return ctx.reply(t(userId, 'mainMenu', user.name || 'Do\'stim'), {
        parse_mode: 'Markdown',
        ...KB.mainMenu(lang, userId === ADMIN_ID)
    });
});

// --- Bekor qilish ---
bot.hears('❌ Bekor qilish', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    const user = getUser(userId);
    ctx.session.pdfImages = [];
    updateUser(userId, { step: 'MAIN_MENU' });
    return ctx.reply(t(userId, 'cancelDone'), KB.mainMenu(lang, userId === ADMIN_ID));
});


// ==================== ADMIN PANEL ====================
bot.hears([/👨‍💻 Admin Panel/], async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    if (userId !== ADMIN_ID) return ctx.reply(t(userId, 'noAccess'));

    const users = loadJson(USERS_FILE, {});
    const payments = loadJson(PAYMENTS_FILE, []);
    const orders = loadJson(ORDERS_FILE, []);
    const pendingCount = payments.filter(p => p.status === 'pending').length;
    const totalRevenue = payments.filter(p => p.status === 'approved').reduce((s,p) => s+p.amount, 0);

    return ctx.reply(
        t(userId, 'adminPanelInfo', Object.keys(users).length, pendingCount, orders.length, totalRevenue),
        KB.adminPanel(lang)
    );
});

// --- ADMIN PANEL TUGMALARI ---
bot.hears([/📋 .*/, /👥 .*/, /📢 .*/, /📊 .*/, /📩 .*/], async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) return;
    const lang = getLang(userId);
    const text = ctx.message.text;

    if (text.includes('📋') || text.includes('To\'lovlar')) {
        const pending = getPendingPayments();
        if (!pending.length) return ctx.reply(t(userId, 'noPendingPayments'));
        let msg = t(userId, 'pendingPaymentsHeader', pending.length);
        pending.slice(0, 10).forEach(p => {
            const u = getUser(p.userId);
            msg += `🆔 ${p.id}\n👤 ${u?.name||'?'} (${p.userId})\n💵 ${p.amount.toLocaleString()} so'm — ${p.type.toUpperCase()}\n✅ /approve ${p.id}\n\n`;
        });
        return ctx.reply(msg);
    }

    if (text.includes('👥') && !text.includes('Batafsil')) {
        const users = Object.values(loadJson(USERS_FILE, {}));
        const orders = loadJson(ORDERS_FILE, []);
        let msg = `👥 Foydalanuvchilar (${users.length} ta):\n\n`;
        users.slice(0, 20).forEach((u, i) => {
            const userOrders = orders.filter(o => String(o.userId) === String(u.id));
            const lastOrder = userOrders.length ? userOrders[userOrders.length - 1] : null;
            const lastTime = lastOrder ? new Date(lastOrder.createdAt).toLocaleDateString('uz-UZ') : '—';
            msg += `${i+1}. ${u.name}\n`;
            msg += `   💰 Balans: ${(u.balance||0).toLocaleString()} so'm\n`;
            msg += `   📋 Buyurtmalar: ${u.totalOrders||0} ta | 🕐 Oxirgi: ${lastTime}\n\n`;
        });
        if (users.length > 20) msg += `... va yana ${users.length - 20} ta\n`;
        return ctx.reply(msg);
    }

    if (text.includes('📢') || text.includes('Xabar')) {
        updateUser(ADMIN_ID, { step: 'BROADCASTING' });
        return ctx.reply(t(userId, 'broadcasting', Object.keys(loadJson(USERS_FILE, {})).length), KB.cancel(lang));
    }

    if (text.includes('📊') || text.includes('Statistika')) {
        const users = loadJson(USERS_FILE, {});
        const payments = loadJson(PAYMENTS_FILE, []);
        const orders = loadJson(ORDERS_FILE, []);
        const totalRevenue = payments.filter(p=>p.status==='approved').reduce((s,p)=>s+p.amount,0);
        const byType = {};
        orders.forEach(o => { byType[o.type] = (byType[o.type]||0)+1; });
        let msg = `📊 Statistika\n\n👥 ${Object.keys(users).length}\n💵 ${totalRevenue.toLocaleString()} so'm\n📋 ${orders.length}\n\nTurlari bo'yicha:\n`;
        Object.entries(byType).forEach(([k,v]) => msg += `  ${k}: ${v}\n`);
        return ctx.reply(msg);
    }

    if (text.includes('📩') || text.includes('Murojaatlar')) {
        let msgs = [];
        try {
            const rows = db.prepare('SELECT data FROM contact_messages ORDER BY rowid DESC LIMIT 20').all();
            msgs = rows.map(r => JSON.parse(r.data));
        } catch(_) {}
        if (!msgs.length) return ctx.reply('📩 Hozircha murojaatlar yo\'q.');
        let reply = `📩 Oxirgi murojaatlar (${msgs.length}):\n\n`;
        msgs.forEach((m, i) => {
            reply += `${i+1}. 👤 ${m.name} (@${m.username||'—'}) | ID: ${m.userId}\n`;
            reply += `   📅 ${new Date(m.createdAt).toLocaleString('uz-UZ')}\n`;
            reply += `   💬 ${m.text.slice(0,150)}${m.text.length>150?'...':''}\n\n`;
        });
        return ctx.reply(reply);
    }

    if (text.includes('Batafsil Jadval')) {
        const users = Object.values(loadJson(USERS_FILE, {}));
        const orders = loadJson(ORDERS_FILE, []);
        let msg = `📊 FOYDALANUVCHILAR JADVALI\n${'─'.repeat(30)}\n\n`;
        users.forEach((u, i) => {
            const userOrders = orders.filter(o => String(o.userId) === String(u.id));
            const ordersByType = {};
            userOrders.forEach(o => { ordersByType[o.type] = (ordersByType[o.type]||0)+1; });
            const lastOrder = userOrders.length ? userOrders[userOrders.length-1] : null;
            const lastTime = lastOrder ? new Date(lastOrder.createdAt).toLocaleString('uz-UZ') : '—';
            msg += `${i+1}. ${u.name}\n`;
            msg += `   🆔 ${u.id} | @${u.username||'—'}\n`;
            msg += `   🕐 Oxirgi: ${lastTime}\n`;
            msg += `   💰 ${(u.balance||0).toLocaleString()} so'm | 📋 ${u.totalOrders||0} ta\n`;
            if (Object.keys(ordersByType).length) {
                msg += `   📂 ${Object.entries(ordersByType).map(([k,v])=>`${k}:${v}`).join(', ')}\n`;
            }
            msg += '\n';
            if (msg.length > 3500) {
                msg += `... va yana ${users.length - i - 1} ta\n`;
                ctx.reply(msg);
                msg = '';
            }
        });
        if (msg) return ctx.reply(msg);
    }
});

// ==================== ADMIN KOMANDALARI ====================
bot.command('pending', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const pending = getPendingPayments();
    if (!pending.length) return ctx.reply(t(ADMIN_ID, 'noPendingPayments'));
    let msg = `💰 Kutilayotgan to'lovlar:\n\n`;
    pending.forEach(p => {
        const u = getUser(p.userId);
        msg += `ID: ${p.id}\nKim: ${u?.name||'?'}\nSumma: ${p.amount.toLocaleString()} so'm\nTuri: ${p.type}\nTasdiqlash: /approve ${p.id}\n\n`;
    });
    return ctx.reply(msg);
});

bot.command('approve', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const paymentId = ctx.message.text.split(' ')[1];
    if (!paymentId) return ctx.reply('❌ Format: /approve PAYMENT_ID');
    const p = approvePayment(paymentId);
    if (!p) return ctx.reply('❌ To\'lov topilmadi!');
    const newUser = getUser(p.userId);
    try {
        await bot.telegram.sendMessage(p.userId, t(p.userId, 'payApproved', p.amount, newUser.balance), KB.mainMenu(getLang(p.userId), false));
    } catch (_) {}
    return ctx.reply(`✅ To'lov tasdiqlandi! ${p.userId}: +${p.amount.toLocaleString()} so'm`);
});

bot.command('balance', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const [, targetId, amount] = ctx.message.text.split(' ');
    if (!targetId || !amount || isNaN(+amount)) return ctx.reply('❌ Format: /balance USER_ID SUMMA');
    const u = getUser(parseInt(targetId));
    updateUser(parseInt(targetId), { balance: (u.balance||0) + parseInt(amount) });
    try { await bot.telegram.sendMessage(parseInt(targetId), t(parseInt(targetId), 'balanceAdminAdd', parseInt(amount))); } catch (_) {}
    return ctx.reply(`✅ ${targetId}: +${parseInt(amount).toLocaleString()} so'm`);
});

bot.command('stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const users = loadJson(USERS_FILE, {});
    const orders = loadJson(ORDERS_FILE, []);
    const payments = loadJson(PAYMENTS_FILE, []);
    const rev = payments.filter(p=>p.status==='approved').reduce((s,p)=>s+p.amount,0);
    return ctx.reply(t(ADMIN_ID, 'adminStats', Object.keys(users).length, orders.length, rev));
});

// ==================== RASM HANDLER (PHOTO) ====================
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    const lang = getLang(userId);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];

    // SLAYD uchun /pic rasm qabul qilish
    if (user.step === 'SLAYD_PIC_WAIT') {
        try {
            const fileLink = await ctx.telegram.getFileLink(photo.file_id);
            const imgPath = path.join(TEMP_DIR, `user_pic_${userId}_${Date.now()}.jpg`);
            await new Promise((resolve, reject) => {
                const proto = fileLink.href.startsWith('https') ? https : require('http');
                const file = fs.createWriteStream(imgPath);
                proto.get(fileLink.href, res => {
                    res.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                }).on('error', reject);
            });
            ctx.session.userPicPath = imgPath;
            ctx.session.slideType = 'pic';
            updateUser(userId, { step: 'SLAYD_TEMPLATE' });
            await ctx.reply(`✅ Rasm qabul qilindi! Slayd yaratilmoqda...`);
            return doCreateSlide(ctx, userId);
        } catch(e) {
            return ctx.reply('😔 Rasm yuklab olishda xato. Qayta yuboring.');
        }
    }

    // To'lov cheki
    if (user.step === 'WAITING_CLICK_CHECK' || user.step === 'WAITING_PAYME_CHECK') {
        const payType = user.step === 'WAITING_CLICK_CHECK' ? 'click' : 'payme';
        const amount = ctx.session.neededAmount || 0;
        const payment = addPayment(userId, amount, payType, { fileId: photo.file_id });

        if (ADMIN_ID) {
            try {
                await bot.telegram.sendPhoto(ADMIN_ID, photo.file_id, {
                    caption: `💰 Yangi to'lov!\n\nKim: ${user.name}\nID: ${userId}\nTuri: ${payType.toUpperCase()}\nSumma: ${amount.toLocaleString()} so'm\n\nTasdiqlash: /approve ${payment.id}`
                });
            } catch (_) {}
        }
        updateUser(userId, { step: 'PAYMENT_PENDING' });
        return ctx.reply(t(userId, 'checkReceived'), KB.mainMenu(lang, userId === ADMIN_ID));
    }

    // Rasmdan PDF
    if (user.step === 'PDF_WAITING') {
        if (!ctx.session.pdfImages) ctx.session.pdfImages = [];

        try {
            const fileLink = await ctx.telegram.getFileLink(photo.file_id);
            const imgRes = await fetch(fileLink.href);
            const imgBuf = Buffer.from(await imgRes.arrayBuffer());
            const tmpPath = path.join(TEMP_DIR, `img_${userId}_${Date.now()}.jpg`);
            fs.writeFileSync(tmpPath, imgBuf);
            ctx.session.pdfImages.push(tmpPath);
        } catch (e) {
            return ctx.reply(t(userId, 'imgUploadError'));
        }

        const count = ctx.session.pdfImages.length;
        if (count >= 10) {
            return buildAndSendPdf(ctx, userId);
        }
        return ctx.reply(t(userId, 'pdfGot', count), KB.pdfMore(lang));
    }
});

async function buildAndSendPdf(ctx, userId) {
    const lang = getLang(userId);
    const images = ctx.session.pdfImages || [];
    if (!images.length) return ctx.reply(t(userId, 'pdfNoImages'), KB.cancel(lang));

    await ctx.reply(t(userId, 'pdfCreating'));
    try {
        const pdfPath = await imagesToPdf(images, userId);
        await ctx.replyWithDocument({ source: pdfPath }, {
            caption: t(userId, 'pdfDone', images.length)
        });
        addOrder(userId, 'pdf', { count: images.length, price: 0 });
        images.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
        fs.unlinkSync(pdfPath);
        ctx.session.pdfImages = [];
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'done'), KB.mainMenu(lang, userId === ADMIN_ID));
    } catch (err) {
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId === ADMIN_ID));
    }
}

// ==================== FAYL HANDLER (DOCUMENT) ====================
bot.on('document', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    const lang = getLang(userId);
    if (!user.registered) return;

    const doc = ctx.message.document;
    const mime = doc.mime_type || '';
    const fileName = doc.file_name || 'fayl';

    if (doc.file_size > 50 * 1024 * 1024) {
        return ctx.reply('😔 Fayl hajmi 50MB dan katta. Kichikroq fayl yuboring.');
    }

    await ctx.reply('⏳ Fayl qabul qilindi. Tayyorlanmoqda...');

    try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const ext = path.extname(fileName) || '.bin';
        const inputPath = path.join(TEMP_DIR, `in_${userId}_${Date.now()}${ext}`);

        await new Promise((resolve, reject) => {
            const proto = fileLink.href.startsWith('https') ? https : http;
            const file = fs.createWriteStream(inputPath);
            proto.get(fileLink.href, res => {
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
            }).on('error', reject);
        });

        // PPTX → PDF
        if (mime.includes('presentation') || ext === '.pptx' || ext === '.ppt') {
            await ctx.reply("📊 PPTX → PDF ga o'girilmoqda...");
            execSync(`libreoffice --headless --convert-to pdf --outdir "${TEMP_DIR}" "${inputPath}"`, { timeout: 60000 });
            const pdfName = path.basename(inputPath, ext) + '.pdf';
            const pdfPath = path.join(TEMP_DIR, pdfName);
            if (fs.existsSync(pdfPath)) {
                await ctx.replyWithDocument({ source: pdfPath }, { caption: `✅ PDF tayyor!\n\n📄 ${fileName} → PDF\n✅ Format buzilmadi` });
                try { fs.unlinkSync(pdfPath); } catch(_) {}
            } else {
                await ctx.reply('😔 Konvertatsiya xatosi.');
            }
            try { fs.unlinkSync(inputPath); } catch(_) {}
            return;
        }

        // WORD → PDF
        if (mime.includes('word') || ext === '.docx' || ext === '.doc') {
            await ctx.reply("📝 Word → PDF ga o'girilmoqda...");
            execSync(`libreoffice --headless --convert-to pdf --outdir "${TEMP_DIR}" "${inputPath}"`, { timeout: 60000 });
            const pdfName = path.basename(inputPath, ext) + '.pdf';
            const pdfPath = path.join(TEMP_DIR, pdfName);
            if (fs.existsSync(pdfPath)) {
                await ctx.replyWithDocument({ source: pdfPath }, { caption: `✅ PDF tayyor!\n\n📄 ${fileName} → PDF\n✅ Matn va jadvallar saqlandi` });
                try { fs.unlinkSync(pdfPath); } catch(_) {}
            } else {
                await ctx.reply('😔 Konvertatsiya xatosi.');
            }
            try { fs.unlinkSync(inputPath); } catch(_) {}
            return;
        }

        // PDF → WORD yoki PDF SIQISH
        if (mime === 'application/pdf' || ext === '.pdf') {
            if (user.step === 'PDF_TO_WORD_WAITING') {
                await ctx.reply("🔄 PDF → Word ga o'girilmoqda...");
                try {
                    execSync(`libreoffice --headless --convert-to docx --outdir "${TEMP_DIR}" "${inputPath}"`, { timeout: 60000 });
                    const baseName = path.basename(inputPath, '.pdf');
                    const convertedPath = path.join(TEMP_DIR, baseName + '.docx');
                    if (fs.existsSync(convertedPath)) {
                        await ctx.replyWithDocument({ source: convertedPath }, {
                            caption: `✅ Word fayl tayyor!\n\n📄 ${fileName} → DOCX`
                        });
                        try { fs.unlinkSync(convertedPath); } catch(_) {}
                    } else {
                        await ctx.reply('😔 Konvertatsiya xatosi.');
                    }
                } catch(e) {
                    await ctx.reply('😔 PDF → Word xatosi.');
                }
                updateUser(userId, { step: 'MAIN_MENU' });
                try { fs.unlinkSync(inputPath); } catch(_) {}
                return;
            }
            // PDF SIQISH
            await ctx.reply('📦 PDF siqilmoqda...');
            const outPath = path.join(TEMP_DIR, `compressed_${userId}_${Date.now()}.pdf`);
            try {
                execSync(
                    `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outPath}" "${inputPath}"`,
                    { timeout: 60000 }
                );
                const origSize = fs.statSync(inputPath).size;
                const newSize  = fs.statSync(outPath).size;
                const saved = Math.round((1 - newSize / origSize) * 100);
                await ctx.replyWithDocument({ source: outPath }, {
                    caption: `✅ PDF siqildi!\n\n📊 Asl hajm: ${(origSize/1024/1024).toFixed(2)} MB\n📉 Yangi hajm: ${(newSize/1024/1024).toFixed(2)} MB\n💾 Tejaldi: ${saved}%`
                });
                try { fs.unlinkSync(outPath); } catch(_) {}
            } catch(e) {
                await ctx.reply('😔 PDF siqishda xatolik.');
            }
            try { fs.unlinkSync(inputPath); } catch(_) {}
            return;
        }

        // Audio/Video → MP3
        if (mime.includes('video') || mime.includes('audio') ||
            ['.mp4','.avi','.mkv','.mov','.flv','.webm','.mp3','.ogg','.wav','.flac','.aac','.m4a','.wma','.opus','.amr'].includes(ext)) {
            await ctx.reply('🎵 Audio/Video dan MP3 ajratilmoqda...');
            const mp3Path = path.join(TEMP_DIR, `audio_${userId}_${Date.now()}.mp3`);
            await new Promise((resolve, reject) => {
                const proc = spawn('ffmpeg', [
                    '-i', inputPath,
                    '-vn',
                    '-acodec', 'libmp3lame',
                    '-ab', '128k',
                    '-y', mp3Path
                ]);
                proc.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg error')));
                proc.on('error', reject);
            });

            await ctx.replyWithAudio({ source: mp3Path }, {
                caption: `✅ MP3 tayyor!\n\n🎵 ${fileName} → MP3\n🎧 Sifat: 128kbps`
            });
            try { fs.unlinkSync(mp3Path); } catch(_) {}
            try { fs.unlinkSync(inputPath); } catch(_) {}
            return;
        }

        // Noma'lum fayl
        try { fs.unlinkSync(inputPath); } catch(_) {}
        return ctx.reply(
            `😊 Bu fayl turi qo'llab-quvvatlanmaydi.\n\n✅ Qabul qilinadi:\n📊 PPTX/PPT → PDF\n📝 DOCX/DOC → PDF\n📄 PDF → Siqish\n🔄 PDF → Word\n🎬 Video/Audio → MP3`
        );

    } catch(e) {
        return ctx.reply('😔 Xatolik yuz berdi. Qayta urining.');
    }
});

// ==================== ASOSIY MATN HANDLER ====================
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    let user = getUser(userId);
    const text = ctx.message.text;
    const lang = getLang(userId);

    // === REGISTRATSIYA (FAQAT ISM, FAMILYA YO'Q) ===
    if (!user.registered) {
        if (user.step === 'WAITING_NAME') {
            if (text.length < 2) return ctx.reply(t(userId, 'nameTooShort'));
            updateUser(userId, { name: text, registered: true, step: 'MAIN_MENU', freeUsed: 0, username: ctx.from.username || '', createdAt: new Date().toISOString() });
            user = getUser(userId);

            // Tabrik + qoidalar + aksiya
            const welcomeMsg = t(userId, 'registered', user.name);
            const rulesMsg = T[lang]?.rules || T.uz.rules;
            const promoMsg = T[lang]?.summerPromo || T.uz.summerPromo;

            await ctx.reply(welcomeMsg, { parse_mode: 'Markdown', ...KB.mainMenu(lang, userId === ADMIN_ID) });
            await ctx.reply(rulesMsg, { parse_mode: 'Markdown' });
            return ctx.reply(promoMsg, { parse_mode: 'Markdown' });
        }
        if (user.step === 'LANG_SELECT') return ctx.reply(t(userId, 'welcome'), { parse_mode: 'Markdown', ...KB.langSelect() });
        return;
    }

    // ====== Bekor qilish ======
    if (text === `❌ ${t(userId, 'cancel')}` || text === '❌ Bekor qilish') {
        ctx.session.pdfImages = [];
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'cancelDone'), KB.mainMenu(lang, userId === ADMIN_ID));
    }

    // ====== SLAYD TOPIC ======
    if (user.step === 'SLAYD_TOPIC') {
        if (text.length < 3) return ctx.reply(t(userId, 'topicTooShort'));
        ctx.session.topic = text;
        updateUser(userId, { step: 'SLAYD_COUNT' });
        return ctx.reply(t(userId, 'slideCountPrompt', text), KB.slideCount(lang));
    }

    if (user.step === 'SLAYD_COUNT') {
        const count = parseInt(text.replace(/\D/g, ''));
        if (isNaN(count) || count < 1 || count > 30) return ctx.reply(t(userId, 'invalidInput'));
        ctx.session.slideCount = count;
        const isFree = true;
        const paket = getPaket(count, isFree, lang);
        ctx.session.slidePrice = 0;
        updateUser(userId, { step: 'SLAYD_TEMPLATE' });
        return ctx.reply(t(userId, 'slidePackageInfo', ctx.session.topic, count, 0, paket, true), KB.templateMenu(lang));
    }

    if (user.step === 'SLAYD_TEMPLATE') {
        const viewLabels = ['ko\'rish', 'Посмотреть', 'View', 'Lihat'];
        if (viewLabels.some(v => text.toLowerCase().includes(v.toLowerCase()))) {
            const channelLink = `https://t.me/${CHANNEL_USERNAME}`;
            const siteLink = 'https://sardorsherqobilogli-art.github.io/slidetop01_bot-';
            return ctx.reply(
                `🎨 50 ta premium shablon mavjud!\n\n📲 Ko'rish uchun:\n1️⃣ Kanal: ${channelLink}\n2️⃣ Sayt: ${siteLink}\n\n✅ Ko'rib chiqqach, shablon raqamini yuboring (1-50)\n💡 Yoki quyidagi usullardan birini tanlang:`,
                KB.templateMenu(lang)
            );
        }

        const aiLabels = ['AI Rasm', 'AI Фото', 'AI Image', 'Gambar AI', '1-Sentabr', '1 Сентября'];
        if (aiLabels.some(v => text.includes(v))) {
            return ctx.reply(
                `🤖 AI Rasm Yaratish\n\n⏳ Bu bo'lim hozircha tayyorlanmoqda.\n🗓 Ochilish sanasi: 1-Sentabr 2025`,
                KB.templateMenu(lang)
            );
        }

        const chartLabels = ['Diagramma', 'диаграмм', 'Chart', 'Diagram'];
        if (chartLabels.some(v => text.includes(v))) {
            ctx.session.slideType = 'chart';
            ctx.session.templateId = null;
            ctx.session.templateId2 = null;
            return doCreateSlide(ctx, userId);
        }

        const picLabels = ['/pic', 'Rasmim', 'Фото', 'My Photo', 'Foto Saya'];
        if (picLabels.some(v => text.includes(v))) {
            ctx.session.slideType = 'pic';
            ctx.session.templateId = null;
            ctx.session.templateId2 = null;
            updateUser(userId, { step: 'SLAYD_PIC_WAIT' });
            return ctx.reply(
                `🖼 Rasmingizni yuboring!\n\n📌 Mavzu: ${ctx.session.topic}\n\n✅ 1 ta rasm yuboring — slaydning muqova qismiga qo'yiladi.`,
                KB.cancel(lang)
            );
        }

        ctx.session.slideType = 'normal';
        const rawParts = text.trim().split(/\s+/);
        const numParts = rawParts.map(Number).filter(n => !isNaN(n) && n >= 1 && n <= 50);
        if (numParts.length >= 2) {
            ctx.session.templateId  = `template_${String(numParts[0]).padStart(2,'0')}`;
            ctx.session.templateId2 = `template_${String(numParts[1]).padStart(2,'0')}`;
        } else {
            const tNum = parseInt(text);
            ctx.session.templateId  = (!isNaN(tNum) && tNum >= 1 && tNum <= 50) ? `template_${String(tNum).padStart(2,'0')}` : null;
            ctx.session.templateId2 = null;
        }
        return doCreateSlide(ctx, userId);
    }

    if (user.step === 'SLAYD_PIC_WAIT') {
        return ctx.reply(`📸 Iltimos, rasm (foto) yuboring. Matn emas — rasm kerak!`, KB.cancel(lang));
    }

    // ====== PDF ======
    if (user.step === 'PDF_WAITING') {
        const pdfCreateWords = ['PDF yaratish', 'Создать PDF', 'Create PDF', 'Buat PDF'];
        const addMoreWords = ['Yana rasm', 'Добавить фото', 'Add more', 'Tambah'];
        if (pdfCreateWords.some(w => text.includes(w))) return buildAndSendPdf(ctx, userId);
        if (addMoreWords.some(w => text.includes(w))) return ctx.reply(t(userId, 'pdfSendMore'));
        return ctx.reply(t(userId, 'pdfCreateOrSend'), KB.pdfMore(lang));
    }

    // ====== QR KOD ======
    if (user.step === 'QR_INPUT') {
        updateUser(userId, { step: 'MAIN_MENU' });
        try {
            const QRCode = require('qrcode');
            const qrPath = path.join(TEMP_DIR, `qr_${userId}_${Date.now()}.png`);
            await QRCode.toFile(qrPath, text, {
                width: 400, margin: 2,
                color: { dark: '#000000', light: '#ffffff' }
            });
            const qrCaption = T[lang]?.qrReady?.(text) || T.uz.qrReady(text);
            await ctx.replyWithPhoto({ source: qrPath }, { caption: qrCaption, parse_mode: 'Markdown' });
            try { fs.unlinkSync(qrPath); } catch(_) {}
        } catch(e) {
            await ctx.reply('😔 Xatolik. Qayta urining.');
        }
        return;
    }

    // ====== TEST ======
    if (user.step === 'TEST_TOPIC') {
        if (text.length < 3) return ctx.reply(t(userId, 'topicTooShort'));
        ctx.session.testTopic = text;
        updateUser(userId, { step: 'TEST_COUNT' });
        return ctx.reply(t(userId, 'chooseCount'), KB.testCount(lang));
    }
    if (user.step === 'TEST_COUNT') {
        const count = parseInt(text);
        if (!count || count < 10 || count > 20) return ctx.reply(t(userId, 'invalidInput'));
        ctx.session.testCount = count;
        updateUser(userId, { step: 'TEST_DIFF' });
        return ctx.reply(t(userId, 'chooseDiff'), KB.difficulty(lang));
    }
    if (user.step === 'TEST_DIFF') {
        const easyWords = ['Oson', 'Лёгк', 'Easy', 'Mudah'];
        const hardWords = ['Qiyin', 'Сложн', 'Hard', 'Sulit'];
        const medWords = ["O'rta", 'Средн', 'Medium', 'Sedang'];
        let diffText = "O'rta";
        if (easyWords.some(w => text.includes(w))) diffText = easyWords[0];
        else if (hardWords.some(w => text.includes(w))) diffText = hardWords[0];
        else diffText = medWords[0];
        ctx.session.testDiff = diffText;
        return doCreateTest(ctx, userId);
    }

    // ====== KRASSVORD ======
    if (user.step === 'CROSS_TOPIC') {
        if (text.length < 3) return ctx.reply(t(userId, 'topicTooShort'));
        ctx.session.crossTopic = text;
        updateUser(userId, { step: 'CROSS_COUNT' });
        return ctx.reply(t(userId, 'chooseCount'), KB.crosswordCount(lang));
    }
    if (user.step === 'CROSS_COUNT') {
        const count = parseInt(text) || 10;
        ctx.session.crossCount = count;
        return doCreateCrossword(ctx, userId);
    }

    // ====== INSHO/ESSE ======
    if (user.step === 'ESSAY_TYPE') {
        const inshoWords = ['Insho', 'Сочинение', 'Composition', 'Karangan'];
        ctx.session.essayType = inshoWords.some(w => text.includes(w)) ? 'insho' : 'esse';
        updateUser(userId, { step: 'ESSAY_TOPIC' });
        return ctx.reply(t(userId, 'essayTopicPrompt', ctx.session.essayType, user.balance||0, 0), { parse_mode: 'Markdown', ...KB.cancel(lang) });
    }
    if (user.step === 'ESSAY_TOPIC') {
        if (text.length < 3) return ctx.reply(t(userId, 'topicTooShort'));
        ctx.session.essayTopic = text;
        updateUser(userId, { step: 'ESSAY_WORDS' });
        return ctx.reply(t(userId, 'enterWords'), KB.essayWords(lang));
    }
    if (user.step === 'ESSAY_WORDS') {
        const words = parseInt(text) || 500;
        ctx.session.essayWords = words;
        return doCreateEssay(ctx, userId);
    }

    // ====== REFERAT/MUSTAQIL ======
    if (user.step === 'REFERAT_TYPE') {
        const refWords = ['Referat', 'Реферат', 'Essay', 'Esai'];
        ctx.session.referatType = refWords.some(w => text.includes(w)) ? 'referat' : 'mustaqil';
        updateUser(userId, { step: 'REFERAT_TOPIC' });
        return ctx.reply(t(userId, 'referatTopicPrompt', ctx.session.referatType), KB.cancel(lang));
    }
    if (user.step === 'REFERAT_TOPIC') {
        if (text.length < 3) return ctx.reply(t(userId, 'topicTooShort'));
        ctx.session.referatTopic = text;
        updateUser(userId, { step: 'REFERAT_PAGES' });
        return ctx.reply(t(userId, 'choosePages'), KB.pageCount(lang));
    }
    if (user.step === 'REFERAT_PAGES') {
        const pages = parseInt(text) || 10;
        ctx.session.referatPages = pages;
        return doCreateReferat(ctx, userId);
    }

    // ====== TEZIS ======
    if (user.step === 'TEZIS_TOPIC') {
        if (text.length < 3) return ctx.reply(t(userId, 'topicTooShort'));
        ctx.session.tezisTopic = text;
        updateUser(userId, { step: 'TEZIS_PAGES' });
        return ctx.reply(t(userId, 'choosePages'), KB.pageCountSmall(lang));
    }
    if (user.step === 'TEZIS_PAGES') {
        const pages = parseInt(text) || 3;
        ctx.session.tezisPages = pages;
        return doCreateTezis(ctx, userId);
    }

    // ====== MAQOLA ======
    if (user.step === 'MAQOLA_TOPIC') {
        if (text.length < 3) return ctx.reply(t(userId, 'topicTooShort'));
        ctx.session.maqolaTopic = text;
        updateUser(userId, { step: 'MAQOLA_PAGES' });
        return ctx.reply(t(userId, 'choosePages'), KB.pageCountSmall(lang));
    }
    if (user.step === 'MAQOLA_PAGES') {
        const pages = parseInt(text) || 3;
        ctx.session.maqolaPages = pages;
        return doCreateMaqola(ctx, userId);
    }

    // ====== INFOGRAFIKA ======
    if (user.step === 'INFO_TOPIC') {
        if (text.length < 3) return ctx.reply(t(userId, 'infoTooShort'));
        ctx.session.infoTopic = text;
        return doCreateInfo(ctx, userId);
    }

    // ====== RASM ======
    if (user.step === 'RASM_DESC') {
        ctx.session.rasmDesc = text;
        return doCreateRasm(ctx, userId);
    }

    // ====== TO'LOV ======
    if (user.step === 'NEED_PAYMENT') {
        if (text.includes('Click') || text.includes('CLICK')) {
            updateUser(userId, { step: 'WAITING_CLICK_CHECK' });
            return ctx.reply(t(userId, 'payClick', ctx.session.neededAmount || 0), KB.checkSend(lang));
        }
        if (text.includes('Payme') || text.includes('PAYME')) {
            updateUser(userId, { step: 'WAITING_PAYME_CHECK' });
            return ctx.reply(t(userId, 'payPayme', ctx.session.neededAmount || 0), KB.checkSend(lang));
        }
        if (text.includes('Admin') || text.includes('Админ')) {
            return ctx.reply(t(userId, 'adminContactInfo', ADMIN_USERNAME, ADMIN_PHONE));
        }
    }

    // ====== SOZLAMALAR ======
    if (user.step === 'EDIT_NAME') {
        if (text.length < 2) return ctx.reply(t(userId, 'nameTooShort'));
        updateUser(userId, { name: text, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'nameUpdated'), KB.mainMenu(lang, userId === ADMIN_ID));
    }

    // ====== ADMIN MUROJAAT ======
    if (user.step === 'CONTACT_ADMIN') {
        try {
            const msgId = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
            const msgData = {
                id: msgId, userId, name: user.name,
                username: ctx.from.username || '',
                text, createdAt: new Date().toISOString()
            };
            db.prepare('INSERT OR REPLACE INTO contact_messages (id, data) VALUES (?, ?)').run(msgId, JSON.stringify(msgData));
        } catch(_) {}

        if (ADMIN_ID) {
            try {
                await bot.telegram.sendMessage(ADMIN_ID,
                    `📩 YANGI MUROJAAT!\n\n👤 ${user.name}\n🆔 ${userId}\n🔗 TG: @${ctx.from.username||'—'}\n\n💬 Xabar:\n${text}`
                );
            } catch (_) {}
        }
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'msgSent'), KB.mainMenu(lang, userId === ADMIN_ID));
    }

    // ====== ADMIN BROADCAST ======
    if (userId === ADMIN_ID && user.step === 'BROADCASTING') {
        const allUsers = Object.keys(loadJson(USERS_FILE, {}));
        await ctx.reply(t(ADMIN_ID, 'broadcasting', allUsers.length));
        let sent = 0, failed = 0;
        for (const uid of allUsers) {
            try { await bot.telegram.sendMessage(uid, text); sent++; } catch (_) { failed++; }
            await new Promise(r => setTimeout(r, 50));
        }
        updateUser(ADMIN_ID, { step: 'MAIN_MENU' });
        return ctx.reply(t(ADMIN_ID, 'broadcastDone', sent, failed), KB.adminPanel(lang));
    }

    // Default
    if (!user.step || user.step === 'MAIN_MENU' || user.step === 'PAYMENT_PENDING' || user.step === 'HELP_SECTION') {
        return ctx.reply(t(userId, 'defaultReply', user.name || 'Do\'stim'), KB.mainMenu(lang, userId === ADMIN_ID));
    }
});

// ==================== ISHLOV BERISH FUNKSIYALARI ====================

async function doCreateSlide(ctx, userId) {
    const user = getUser(userId);
    const lang = getLang(userId);
    const topic = ctx.session.topic;
    const count = ctx.session.slideCount || 5;
    const paket = getPaket(count, true, lang);
    const tmpl1 = ctx.session.templateId;
    const tmpl2 = ctx.session.templateId2;
    const isDual = !!(tmpl1 && tmpl2);
    const slideType = ctx.session.slideType || 'normal';
    const userPicPath = ctx.session.userPicPath || null;

    const processMsgs = {
        normal: `⏳ ${paket.emoji} ${paket.nom} tayyorlanmoqda...\n\n📋 Shablon tanlanmoqda\n🤖 AI matn yozmoqda\n🎨 Dizayn ishlanmoqda\n📎 Fayl tayyorlanmoqda\n\nBu 20-40 soniya davom etadi ⌛`,
        chart:  `⏳ ${paket.emoji} Diagrammali slayd tayyorlanmoqda...\n\n🤖 AI matn yozmoqda\n📈 Grafiklar chizilmoqda\n📊 Diagrammalar qo'shilmoqda\n\nBu 20-40 soniya davom etadi ⌛`,
        pic:    `⏳ ${paket.emoji} Rasmli slayd tayyorlanmoqda...\n\n🖼 Rasmingiz joylashtirilmoqda\n🤖 AI matn yozmoqda\n🎨 Dizayn ishlanmoqda\n\nBu 20-40 soniya davom etadi ⌛`,
    };
    await ctx.reply(processMsgs[slideType] || processMsgs.normal, { reply_markup: { remove_keyboard: true } });

    try {
        updateUser(userId, { freeUsed: (user.freeUsed || 0) + 1 });

        const aiText = await aiSlides(topic, count, lang);
        if (!aiText) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId === ADMIN_ID));
        }

        if (slideType === 'chart') {
            const filePath = await makeChartSlidePptx(topic, aiText, userId, count, lang);
            await ctx.replyWithDocument({ source: filePath }, {
                caption: `✅ Diagrammali slayd tayyor! 🎉\n\n${paket.emoji} Paket: ${paket.nom}\n📌 Mavzu: ${topic}\n📊 ${count} ta slayd\n💰 MUTLAQO BEPUL 🎁`
            });
            try { fs.unlinkSync(filePath); } catch(_) {}

        } else if (slideType === 'pic' && userPicPath && fs.existsSync(userPicPath)) {
            const filePath = await makeSlidePptx(topic, aiText, userId, count, tmpl1, lang, userPicPath);
            await ctx.replyWithDocument({ source: filePath }, {
                caption: `✅ Rasmli slayd tayyor! 🎉\n\n${paket.emoji} Paket: ${paket.nom}\n📌 Mavzu: ${topic}\n📊 ${count} ta slayd\n💰 MUTLAQO BEPUL 🎁`
            });
            try { fs.unlinkSync(filePath); } catch(_) {}
            try { fs.unlinkSync(userPicPath); } catch(_) {}

        } else if (isDual) {
            const [file1, file2] = await Promise.all([
                makeSlidePptx(topic, aiText, userId, count, tmpl1, lang),
                makeSlidePptx(topic, aiText, userId, count, tmpl2, lang)
            ]);
            await ctx.replyWithDocument({ source: file1 }, { caption: `🎨 Variant 1 — Shablon #${tmpl1?.replace('template_','')||'A'}\n📌 ${topic}\n📊 ${count} ta slayd` });
            await ctx.replyWithDocument({ source: file2 }, { caption: `🎨 Variant 2 — Shablon #${tmpl2?.replace('template_','')||'B'}\n📌 ${topic}\n📊 ${count} ta slayd` });
            await ctx.reply(`✅ Ikkala variant tayyor! 🎉\n\n${paket.emoji} ${paket.nom}\n💰 MUTLAQO BEPUL 🎁\n\nYoqqanini saqlang! 😊`);
            try { fs.unlinkSync(file1); } catch(_) {}
            try { fs.unlinkSync(file2); } catch(_) {}

        } else {
            const filePath = await makeSlidePptx(topic, aiText, userId, count, tmpl1, lang);
            await ctx.replyWithDocument({ source: filePath }, {
                caption: t(userId, 'slideReady1', paket, topic, count, 0, true)
            });
            try { fs.unlinkSync(filePath); } catch(_) {}
        }

        ctx.session.slideType = null;
        ctx.session.userPicPath = null;
        ctx.session.templateId = null;
        ctx.session.templateId2 = null;

        addOrder(userId, 'slides', { topic, count, price: 0, type: slideType, dual: isDual });
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        console.error('Slayd xato:', err.message);
        ctx.session.slideType = null;
        ctx.session.userPicPath = null;
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId === ADMIN_ID));
    }
}

async function doCreateTest(ctx, userId) {
    const lang = getLang(userId);
    const topic = ctx.session.testTopic;
    const count = ctx.session.testCount || 10;
    const diff = ctx.session.testDiff || "O'rta";

    await ctx.reply(t(userId, 'creating'));
    try {
        const aiText = await aiTest(topic, count, diff, lang);
        if (!aiText) return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
        const filePath = await makeTestPptx(topic, aiText, userId, count, diff, lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'testReady', topic, count, 0) });
        addOrder(userId, 'test', { topic, count, diff, price: 0 });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateCrossword(ctx, userId) {
    const lang = getLang(userId);
    const topic = ctx.session.crossTopic;
    const count = ctx.session.crossCount || 10;

    await ctx.reply(t(userId, 'creating'));
    try {
        const aiText = await aiCrossword(topic, count, lang);
        if (!aiText) return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
        const filePath = await makeCrosswordPptx(topic, aiText, userId, count, lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'crossReady', topic, count, 0) });
        addOrder(userId, 'krassvord', { topic, count, price: 0 });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateEssay(ctx, userId) {
    const lang = getLang(userId);
    const topic = ctx.session.essayTopic;
    const type = ctx.session.essayType || 'insho';
    const words = ctx.session.essayWords || 500;

    await ctx.reply(t(userId, 'creating'));
    try {
        const aiText = await aiEssay(topic, type, words, lang);
        if (!aiText) return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
        const filePath = await makeTextPptx(topic, aiText, userId, type === 'insho' ? 'Insho' : 'Esse', lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'essayReady', type, topic, words, 0) });
        addOrder(userId, type, { topic, words, price: 0 });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateReferat(ctx, userId) {
    const lang = getLang(userId);
    const topic = ctx.session.referatTopic;
    const type = ctx.session.referatType || 'referat';
    const pages = ctx.session.referatPages || 10;

    await ctx.reply(t(userId, 'creating'));
    try {
        const aiText = await aiReferat(topic, type, pages, lang);
        if (!aiText) return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
        const filePath = await makeTextPptx(topic, aiText, userId, type === 'referat' ? 'Referat' : 'MustaqilIsh', lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'referatReady', type, topic, pages, 0) });
        addOrder(userId, type, { topic, pages, price: 0 });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateTezis(ctx, userId) {
    const lang = getLang(userId);
    const topic = ctx.session.tezisTopic;
    const pages = ctx.session.tezisPages || 3;

    await ctx.reply(t(userId, 'creating'));
    try {
        const aiText = await aiTezis(topic, pages, lang);
        if (!aiText) return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
        const filePath = await makeTextPptx(topic, aiText, userId, 'Tezis', lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'tezisReady', topic, pages, 0) });
        addOrder(userId, 'tezis', { topic, pages, price: 0 });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateMaqola(ctx, userId) {
    const lang = getLang(userId);
    const topic = ctx.session.maqolaTopic;
    const pages = ctx.session.maqolaPages || 3;

    await ctx.reply(t(userId, 'creating'));
    try {
        const aiText = await aiMaqola(topic, pages, lang);
        if (!aiText) return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
        const filePath = await makeTextPptx(topic, aiText, userId, 'Maqola', lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'maqolaReady', topic, pages, 0) });
        addOrder(userId, 'maqola', { topic, pages, price: 0 });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateInfo(ctx, userId) {
    const lang = getLang(userId);
    const topic = ctx.session.infoTopic;

    await ctx.reply(t(userId, 'creating'));
    try {
        const aiText = await aiInfografika(topic, lang);
        if (!aiText) return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
        const filePath = await makeInfoPptx(topic, aiText, userId, lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'infoReady', topic, 0) });
        addOrder(userId, 'infografika', { topic, price: 0 });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateRasm(ctx, userId) {
    const lang = getLang(userId);
    const desc = ctx.session.rasmDesc;

    await ctx.reply(t(userId, 'creating'));
    try {
        const prompt = await aiRasm(desc, lang);
        if (!prompt) return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));

        updateUser(userId, { step: 'MAIN_MENU' });
        addOrder(userId, 'rasm', { desc, price: 0 });
        return ctx.reply(t(userId, 'rasmReady', 0, prompt), { parse_mode: 'Markdown', ...KB.mainMenu(lang, userId === ADMIN_ID) });
    } catch (err) {
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

// ==================== XATO HANDLER ====================
bot.catch((err, ctx) => {
    console.error('Bot xato:', err.message, '\nCtx:', ctx?.updateType);
    try {
        const userId = ctx?.from?.id;
        if (userId) {
            const lang = getLang(userId);
            ctx.reply(t(userId, 'unexpectedError')).catch(() => {});
        }
    } catch (_) {}
});

// ==================== BOTNI ISHGA TUSHIRISH ====================
bot.launch()
    .then(() => console.log('✅ SlaydTop Bot ishga tushdi! Mukammal muloyim versiya.'))
    .catch(err => { console.error('❌ Bot xato:', err); process.exit(1); });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Health check server
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SlaydTop Bot is running! ✅ Mukammal muloyim versiya.');
}).listen(process.env.PORT || 3000, () => console.log(`Health check: port ${process.env.PORT || 3000}`));
