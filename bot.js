// ============================================================
//  SlaydTop Bot — To'liq versiya (4 TILLI: UZ, RU, EN, ID)
//  Groq API + jimp (Rasmdan PDF) + PptxGenJS
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
const https      = require('https');

// ==================== KONFIGURATSIYA ====================
const BOT_TOKEN      = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const GROQ_KEY       = (process.env.GROQ_API_KEY       || '').trim();
const ADMIN_ID       = Number(process.env.ADMIN_ID     || 0);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME       || 'admin';
const ADMIN_PHONE    = process.env.ADMIN_PHONE          || '+998901234567';
const BOT_USERNAME   = process.env.BOT_USERNAME         || 'SlaydTop_2_bot';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME   || 'slaydtop_kanal';
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
    slide_small : 2000,
    slide_big   : 3500,
    test        : 2000,
    crossword   : 1500,
    essay       : 1500,
    referat     : 2500,
    tezis       : 3000,
    maqola      : 2500,
    infografika : 1500,
    rasm        : 1000,
    pdf         : 0
};
const FREE_SLIDES = 9999; // Yoz aksiyasi — hammasi bepul!

// ========== YOZ AKSIYASI REJIMI ==========
// true = hammasi bepul (1-sentabrgacha)
// false = oddiy to'lov tizimi
const SUMMER_FREE = true;
const SUMMER_END = new Date('2025-09-01T00:00:00');

function isSummerFree() {
    return SUMMER_FREE && new Date() < SUMMER_END;
}

// ==================== YORDAMCHI: TIL Olish ====================
function getLang(userId) {
    const users = loadJson(USERS_FILE, {});
    return users[userId]?.lang || 'uz';
}

// ==================== KO'P TILLI MATNLAR ====================
const T = {
    uz: {
        welcome: `🌟 SlaydTop ga xush kelibsiz!\nIltimos, tilni tanlang:`,
        enterName: `✨ Ajoyib tanlov!\n\nEndi tanishib olaylik 😊\nIsmingizni kiriting:\n(Masalan: Sardor)`,
        enterSurname: (name) => `🎉 Zo'r ism, ${name}!\n\nFamilyangizni kiriting:\n(Masalan: Yoldoshev)`,
        registered: (name, freeCount) =>
            `🏆 Tabriklaymiz, ${name}!\n\nSiz muvaffaqiyatli ro'yxatdan o'tdingiz!\n\n🎁 Sizga BEPUL sovg'alar:\n✅ ${freeCount} ta slayd — BEPUL\n✅ Rasmdan PDF — MUTLAQO BEPUL (doimo)\n\nBoshlaylikmi? 👇`,
        mainMenu: `Xizmatni tanlang 👇`,
        balance: (u) =>
            `💰 Sizning hisobingiz\n\n👤 ${u.name} ${u.surname}\n💳 Balans: ${(u.balance||0).toLocaleString()} so'm\n🎁 Bepul slayd: ${Math.max(0, FREE_SLIDES-(u.freeUsed||0))} ta qoldi\n📊 Jami buyurtmalar: ${u.totalOrders||0} ta`,
        cancel: '❌ Bekor qilish',
        back: '◀️ Asosiy Menyu',
        lowBalance: (need, has) =>
            `😔 Balansda yetarli mablag' yo'q\n\n💰 Kerak: ${need.toLocaleString()} so'm\n💳 Sizda: ${has.toLocaleString()} so'm\n\nTo'lov usulini tanlang:`,
        payClick: (sum) =>
            `💳 CLICK orqali to'lov\n\n💰 Summa: ${sum.toLocaleString()} so'm\n🏦 Karta: ${CARD_NUMBER}\n👤 Ism: ${CARD_OWNER}\n\n✅ To'lov qilgandan so'ng CHEK rasmini yuboring!`,
        payPayme: (sum) =>
            `💳 PAYME orqali to'lov\n\n💰 Summa: ${sum.toLocaleString()} so'm\n🏦 Karta: ${CARD_NUMBER}\n👤 Ism: ${CARD_OWNER}\n\n✅ To'lov qilgandan so'ng CHEK rasmini yuboring!`,
        checkReceived: `⏳ Chekingiz qabul qilindi!\n\nAdmin tekshirib, balansingizni to'ldiradi.\nOdatda 5-15 daqiqa ichida ✅`,
        payApproved: (amount, newBal) =>
            `✅ To'lovingiz tasdiqlandi! 🏆\nBalansingizga ${amount.toLocaleString()} so'm qo'shildi!\n💰 Yangi balans: ${newBal.toLocaleString()} so'm`,
        free: (userId, botUser) =>
            `🎁 Bepul xizmatlar\n\n1️⃣ Rasmdan PDF — DOIMO BEPUL ♾️\n\n2️⃣ Do'st taklif qiling:\nHar 5 do'st = +3,000 so'm balans\n\n🔗 Sizning havolangiz:\nhttps://t.me/${botUser}?start=ref_${userId}`,
        settings: (u) =>
            `⚙️ Sozlamalar\n\n👤 Ism: ${u.name}\n📝 Familya: ${u.surname}\n🌐 Til: O'zbek 🇺🇿`,
        help: `❓ Yordam markazi\n\nMuammoingizni tanlang:`,
        adminMsg: `Xabaringizni yozing, adminlarimiz tez orada javob beradi:`,
        msgSent: `✅ Xabaringiz adminga yuborildi! Tez orada javob beramiz!`,
        creating: `⏳ Tayyorlanmoqda...\n\n🤖 AI ma'lumot yig'moqda\n🎨 Dizayn qilinmoqda\n📎 Fayl tayyorlanmoqda\n\nBu 15-30 soniya davom etadi ⌛`,
        ready: (type, topic, price) =>
            `✅ ${type} tayyor! 🎉\n\n📌 Mavzu: ${topic}\n💰 Narx: ${price > 0 ? price.toLocaleString()+' so\'m' : 'BEPUL'}\n\n1️⃣ dan 5️⃣ gacha baholang:`,
        rateThank: (r) => r===5 ? '👏 Ajoyib! Katta rahmat!' : r>=4 ? '👏 Juda yaxshi! Rahmat!' : r>=3 ? '🙂 Rahmat! Yana yaxshilashga harakat qilamiz!' : '🙏 Fikringiz uchun rahmat!',
        error: `😔 Xatolik yuz berdi. Iltimos, qayta urinib ko'ring.`,
        invalidInput: `😊 Iltimos, to'g'ri ma'lumot kiriting.`,
        pdfFree: `📄 Rasmdan PDF — MUTLAQO BEPUL! 🎁\n\nRasmingizni yuboring, men PDF ga aylantirib beraman!\n\n✅ JPG, PNG, WEBP qabul qilinadi\n✅ Bir vaqtda 10 tagacha rasm\n✅ Cheksiz foydalanish mumkin\n\nRasmni yuboring: 👇`,
        pdfGot: (n) => `✅ Rasm qabul qilindi! (${n} ta)\n\nYana rasm qo'shmoqchimisiz?`,
        pdfDone: (n) => `🎉 PDF tayyor!\n\n${n} ta rasmdan PDF yaratildi.\nYuklab oling! ⬇️`,
        // Qo'shimcha kalitlar
        slideCreate: 'Slayd Yaratish',
        imgToPdf: 'Rasmdan PDF',
        referatMustaqil: 'Referat/Mustaqil',
        essayEsse: 'Insho/Esse',
        test: 'Test',
        crossword: 'Krassvord',
        tezis: 'Tezis',
        maqola: 'Maqola',
        infografika: 'Infografika',
        rasmYaratish: 'Rasm Yaratish',
        balansim: 'Balansim',
        bepulOlish: 'Bepul olish',
        yordam: 'Yordam',
        sozlamalar: 'Sozlamalar',
        adminPanel: 'Admin Panel',
        slideCountPrompt: (topic) => `🎯 Mavzu qabul qilindi: ${topic}\n\nNechta slayd bo'lsin?`,
        slidePackageInfo: (topic, count, price, paket, isFree) =>
            `${paket.emoji} ${paket.nom} Paketi\n\n📌 Mavzu: ${topic}\n📊 Slaydlar: ${count} ta\n💰 Narx: ${price > 0 ? price.toLocaleString() + ' so\'m' : 'BEPUL 🎁'}\n\n🎨 Shablon tanlang yoki shablonsiz davom eting:\n💡 2 ta raqam yozsangiz (masalan: 3 7) — 2 xil variant olasiz!`,
        slideCreating: (paket, isDual) =>
            `⏳ ${paket.emoji} ${paket.nom} paketi tayyorlanmoqda...\n\n🤖 AI ma'lumot yig'moqda\n🎨 Dizayn ishlanmoqda\n` +
            (isDual ? `🎁 2 ta variant tayyorlanmoqda\n` : '') +
            `📎 Fayl yaratilmoqda\n\nBu 20-40 soniya davom etadi ⌛`,
        slideReady1: (paket, topic, count, price, isFree) =>
            `✅ Slaydingiz tayyor! 🎉\n\n${paket.emoji} Paket: ${paket.nom}\n📌 Mavzu: ${topic}\n📊 ${count} ta slayd\n💰 ${isFree ? 'BEPUL' : price.toLocaleString()+' so\'m'}`,
        slideReady2: (paket, isFree, price) =>
            `✅ Ikkala variant tayyor! 🎉\n\n${paket.emoji} Paket: ${paket.nom}\n💰 Narx: ${isFree ? 'BEPUL' : price.toLocaleString()+' so\'m'}\n\nYoqqanini saqlang! 😊`,
        slideVariant: (n, tmpl, topic, count) => `🎨 Variant ${n} — Shablon #${tmpl?.replace('template_','')||'A'}\n📌 ${topic}\n📊 ${count} ta slayd`,
        testPrompt: (balance, price) => `📝 Test Yaratish\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: ${price.toLocaleString()} so'm (10-20 savol)\n\nTest mavzusini kiriting:\n(Masalan: Biologiya — O'simliklar)`,
        testReady: (topic, count, price) => `✅ Test tayyor! 🎉\n\n📌 Mavzu: ${topic}\n📝 ${count} ta savol\n💰 ${price.toLocaleString()} so'm`,
        crossPrompt: (balance, price) => `🔲 Krassvord Yaratish\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: ${price.toLocaleString()} so'm\n\nMavzuni kiriting:`,
        crossReady: (topic, count, price) => `✅ Krassvord tayyor! 🎉\n\n📌 Mavzu: ${topic}\n🔲 ${count} ta savol\n💰 ${price.toLocaleString()} so'm`,
        essayTypePrompt: (balance, price) => `✍️ Insho yoki Esse?\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: ${price.toLocaleString()} so'm (500-1000 so'z)`,
        essayTopicPrompt: (type, balance, price) => `✍️ ${type === 'insho' ? 'Insho' : 'Esse'} mavzusini kiriting:\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: ${price.toLocaleString()} so'm (500-1000 so'z)`,
        essayReady: (type, topic, words, price) => `✅ ${type === 'insho' ? 'Insho' : 'Esse'} tayyor! 🎉\n\n📌 Mavzu: ${topic}\n✍️ ${words} so'z\n💰 ${price.toLocaleString()} so'm`,
        referatTypePrompt: (balance, price) => `📚 Referat yoki Mustaqil Ish?\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: ${price.toLocaleString()} so'm (10-20 bet)`,
        referatTopicPrompt: (type) => `📚 ${type === 'referat' ? 'Referat' : 'Mustaqil Ish'} mavzusini kiriting:`,
        referatReady: (type, topic, pages, price) => `✅ ${type === 'referat' ? 'Referat' : 'Mustaqil ish'} tayyor! 🎉\n\n📌 Mavzu: ${topic}\n📋 ${pages} bet\n💰 ${price.toLocaleString()} so'm`,
        tezisPrompt: (balance, price) => `🎓 Tezis Yaratish\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: ${price.toLocaleString()} so'm (3-10 bet)\n\nMavzuni kiriting:`,
        tezisReady: (topic, pages, price) => `✅ Tezis tayyor! 🎉\n\n📌 Mavzu: ${topic}\n📋 ${pages} bet\n💰 ${price.toLocaleString()} so'm`,
        maqolaPrompt: (balance, price) => `📰 Maqola Yaratish\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: ${price.toLocaleString()} so'm (3-10 bet)\n\nMavzuni kiriting:`,
        maqolaReady: (topic, pages, price) => `✅ Maqola tayyor! 🎉\n\n📌 Mavzu: ${topic}\n📋 ${pages} bet\n💰 ${price.toLocaleString()} so'm`,
        infoPrompt: (balance, price) => `📊 Infografika Yaratish\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: ${price.toLocaleString()} so'm\n\nMavzu yoki qisqa ma'lumot kiriting:\n(Masalan: O'zbekiston aholisi haqida)`,
        infoReady: (topic, price) => `✅ Infografika tayyor! 🎉\n\n📌 Mavzu: ${topic}\n💰 ${price.toLocaleString()} so'm`,
        rasmPrompt: (balance, price) => `🖼 AI Rasm Yaratish\n\n💰 Balans: ${(balance||0).toLocaleString()} so'm\n📌 Narx: ${price.toLocaleString()} so'm\n\nRasm tavsifini kiriting:\n(Masalan: tog'lar orasidagi ko'l, kech vaqti, rangli)`,
        rasmReady: (price, prompt) =>
            `🖼 AI Rasm uchun Professional Prompt Tayyor! 🎉\n\n💰 ${price.toLocaleString()} so'm\n\n📝 Quyidagi promptni Midjourney, DALL-E yoki Stable Diffusion da ishlating:\n\n${prompt.slice(0, 900)}`,
        slideInfo: (balance) =>
            `✨ Slayd Yaratish\n\n💰 Balansingiz: ${(balance||0).toLocaleString()} so'm\n\n📦 Paketlar:\n` +
            `🎁 Sinov       — BEPUL (1 ta slayd)\n⚡ Iqtidor     — 2,000 so'm (5–12 ta)\n💎 Professional — 3,500 so'm (13–20 ta)\n👑 Premium     — 6,000 so'm (21–30 ta)\n🌟 Infinity    — 50,000 so'm/oy (cheksiz)\n\n📌 Mavzuni kiriting:`,
        chooseCount: 'Nechta?',
        chooseDiff: 'Qiyinlik darajasini tanlang:',
        chooseTopic: 'Mavzuni kiriting:',
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
        adminContactInfo: (username, phone) => `👨‍💻 Admin bilan bog'lanish:\nTelegram: @${username}\nTel: ${phone}`,
        helpBot: `🔄 /start bosing yoki /reset komandasini yuboring.\n\nAgar muammo davom etsa, @${CHANNEL_USERNAME} ga yozing.`,
        helpPayment: (username, phone) => `💳 To'lov muammosi uchun adminga murojaat qiling: @${username}\nTel: ${phone}`,
        helpFile: (username) => `📄 Fayl kelmagan bo'lsa, /start bosing va qayta urinib ko'ring.\nAdmin: @${username}`,
        editNamePrompt: '✏️ Yangi ismingizni kiriting:',
        editSurnamePrompt: '✏️ Yangi familyangizni kiriting:',
        nameUpdated: '✅ Ism yangilandi!',
        surnameUpdated: '✅ Familya yangilandi!',
        cancelDone: '✅ Bekor qilindi.',
        ratingPrompt: '1️⃣ dan 5️⃣ gacha baholang:',
        checkSendPrompt: `✅ To'lov qilgandan so'ng CHEK rasmini yuboring!`,
        referralMsg: (count) => `🎁 5 ta do'stingiz qo'shildi! Balansingizga 3,000 so'm qo'shildi! 🎉`,
        balanceAdminAdd: (amount) => `🎁 Admin balansingizga ${parseInt(amount).toLocaleString()} so'm qo'shdi!`,
        broadcastDone: (sent, failed) => `✅ Yuborildi: ${sent}\n❌ Xato: ${failed}`,
        broadcasting: (count) => `⏳ ${count} ta foydalanuvchiga yuborilmoqda...`,
        noPendingPayments: '✅ Kutilayotgan to\'lovlar yo\'q.',
        pendingPaymentsHeader: (count) => `💰 Kutilayotgan to'lovlar (${count}):\n\n`,
        paymentApprovedAdmin: (userId, amount) => `✅ To'lov tasdiqlandi! Foydalanuvchi: ${userId}, Summa: ${parseInt(amount).toLocaleString()} so'm`,
        approveFormatError: '❌ Format: /approve PAYMENT_ID',
        approveNotFound: '❌ To\'lov topilmadi yoki allaqachon tasdiqlangan!',
        balanceFormatError: '❌ Format: /balance USER_ID SUMMA',
        noAccess: '🔒 Sizga ruxsat yo\'q!',
        restored: '🔄 Tiklandi!',
        defaultReply: 'Xizmatni tanlang!',
        imgUploadError: 'Rasm yuklab olishda xato yuz berdi. Qayta yuboring.',
        pdfBuildError: 'PDF yaratishda xatolik.',
        adminStats: (users, orders, revenue) =>
            `📊 Statistika\n👥 ${users} foydalanuvchi\n📋 ${orders} buyurtma\n💵 ${revenue.toLocaleString()} so'm daromad`,
        adminPanelInfo: (users, pending, orders, revenue) =>
            `👨‍💻 Admin Panel\n\n👥 Foydalanuvchilar: ${users}\n💰 Kutilayotgan to'lovlar: ${pending}\n📊 Buyurtmalar: ${orders}\n💵 Jami daromad: ${revenue.toLocaleString()} so'm`,
        contactAdminPrompt: 'Xabaringizni yozing:',
        newContactMsg: (name, surname, username, userId, text) =>
            `👨‍💻 Yangi murojaat!\n\nKim: ${name} ${surname} (@${username||'yo\'q'})\nID: ${userId}\n\nXabar: ${text}`,
        newPaymentNotify: (name, surname, userId, type, amount, paymentId) =>
            `💰 Yangi to'lov!\n\nKim: ${name} ${surname}\nID: ${userId}\nTuri: ${type.toUpperCase()}\nSumma: ${amount.toLocaleString()} so'm\n\nTasdiqlash: /approve ${paymentId}`,
        currency: 'so\'m',
        freeLabel: 'BEPUL',
        slide: 'slayd',
        slides: 'ta slayd',
        page: 'bet',
        pages: 'ta',
        words: 'so\'z',
        questions: 'ta savol',
        topic: 'Mavzu',
        price: 'Narx',
        balanceLabel: 'Balans',
        packageLabel: 'Paket',
        infinityPackage: '🌟 Infinity    — 50,000 so\'m/oy (cheksiz)',
        month: 'oy',
        freeSlideLeft: (n) => `🎁 Sizda ${n} ta bepul slayd bor!\n\n`,
        payPerMonth: '/oy',
        and: 'va',
        referralCount: (n) => `👥 Taklif qilganlar: ${n} ta`,
        selectService: 'Xizmatni tanlang',
        creatingPdf: 'PDF yaratilmoqda',
        done: 'Bajarildi',
        startText: 'Bot ishga tushdi',
        stopText: 'Bot to\'xtatildi',
        serverRunning: (port) => `Health check: port ${port}`,
        botRunning: '✅ SlaydTop Bot ishga tushdi!',
        botError: '❌ Bot ishga tushirishda xato:',
        unexpectedError: '😔 Kutilmagan xatolik. /start bosing.',
        helpChoose: 'Muammoingizni tanlang:',
        checkReceivedNotify: 'Chek qabul qilindi!',
    },
    ru: {
        welcome: `🌟 Добро пожаловать в SlaydTop!\nПожалуйста, выберите язык:`,
        enterName: `✨ Отличный выбор!\n\nДавайте познакомимся 😊\nВведите ваше имя:\n(Например: Иван)`,
        enterSurname: (name) => `🎉 Отличное имя, ${name}!\n\nВведите вашу фамилию:\n(Например: Иванов)`,
        registered: (name, freeCount) => `🏆 Поздравляем, ${name}!\n\nВы успешно зарегистрировались!\n\n🎁 Ваши БЕСПЛАТНЫЕ подарки:\n✅ ${freeCount} слайд — БЕСПЛАТНО\n✅ Фото в PDF — ВСЕГДА БЕСПЛАТНО\n\nНачнём? 👇`,
        mainMenu: `Выберите услугу 👇`,
        balance: (u) => `💰 Ваш счёт\n\n👤 ${u.name} ${u.surname}\n💳 Баланс: ${(u.balance||0).toLocaleString()} сум\n🎁 Бесплатных слайдов: ${Math.max(0, FREE_SLIDES-(u.freeUsed||0))}\n📊 Всего заказов: ${u.totalOrders||0}`,
        cancel: '❌ Отмена',
        back: '◀️ Главное меню',
        lowBalance: (need, has) => `😔 Недостаточно средств\n\n💰 Нужно: ${need.toLocaleString()} сум\n💳 У вас: ${has.toLocaleString()} сум\n\nВыберите способ оплаты:`,
        payClick: (sum) => `💳 Оплата через CLICK\n\n💰 Сумма: ${sum.toLocaleString()} сум\n🏦 Карта: ${CARD_NUMBER}\n👤 Имя: ${CARD_OWNER}\n\n✅ После оплаты отправьте ЧЕК!`,
        payPayme: (sum) => `💳 Оплата через PAYME\n\n💰 Сумма: ${sum.toLocaleString()} сум\n🏦 Карта: ${CARD_NUMBER}\n👤 Имя: ${CARD_OWNER}\n\n✅ После оплаты отправьте ЧЕК!`,
        checkReceived: `⏳ Чек получен!\n\nАдмин проверит и пополнит баланс.\nОбычно 5-15 минут ✅`,
        payApproved: (amount, newBal) => `✅ Оплата подтверждена! 🏆\nНа баланс добавлено ${amount.toLocaleString()} сум!\n💰 Новый баланс: ${newBal.toLocaleString()} сум`,
        free: (userId, botUser) => `🎁 Бесплатные услуги\n\n1️⃣ Фото в PDF — ВСЕГДА БЕСПЛАТНО ♾️\n\n2️⃣ Приглашайте друзей:\nКаждые 5 друзей = +3,000 сум\n\n🔗 Ваша ссылка:\nhttps://t.me/${botUser}?start=ref_${userId}`,
        settings: (u) => `⚙️ Настройки\n\n👤 Имя: ${u.name}\n📝 Фамилия: ${u.surname}\n🌐 Язык: Русский 🇷🇺`,
        help: `❓ Центр помощи\n\nВыберите проблему:`,
        adminMsg: `Напишите ваше сообщение, администратор ответит вам:`,
        msgSent: `✅ Сообщение отправлено администратору!`,
        creating: `⏳ Готовится...\n\n🤖 AI собирает данные\n🎨 Создаётся дизайн\n📎 Готовится файл\n\nЭто займёт 15-30 секунд ⌛`,
        ready: (type, topic, price) => `✅ ${type} готов! 🎉\n\n📌 Тема: ${topic}\n💰 Цена: ${price > 0 ? price.toLocaleString()+' сум' : 'БЕСПЛАТНО'}\n\nОцените от 1️⃣ до 5️⃣:`,
        rateThank: (r) => r===5 ? '👏 Отлично! Большое спасибо!' : r>=4 ? '👏 Очень хорошо! Спасибо!' : r>=3 ? '🙂 Спасибо! Постараемся улучшить!' : '🙏 Спасибо за отзыв!',
        error: `😔 Произошла ошибка. Попробуйте ещё раз.`,
        invalidInput: `😊 Пожалуйста, введите правильные данные.`,
        pdfFree: `📄 Фото в PDF — АБСОЛЮТНО БЕСПЛАТНО! 🎁\n\nОтправьте фото, я конвертирую в PDF!\n\n✅ JPG, PNG, WEBP принимаются\n✅ До 10 фото за раз\n✅ Безлимитное использование\n\nОтправьте фото: 👇`,
        pdfGot: (n) => `✅ Фото получено! (${n} шт)\n\nХотите добавить ещё?`,
        pdfDone: (n) => `🎉 PDF готов!\n\n${n} фото конвертировано в PDF.\nСкачайте! ⬇️`,
        slideCreate: 'Создать Слайд',
        imgToPdf: 'Фото в PDF',
        referatMustaqil: 'Реферат/Работа',
        essayEsse: 'Сочинение/Эссе',
        test: 'Тест',
        crossword: 'Кроссворд',
        tezis: 'Тезис',
        maqola: 'Статья',
        infografika: 'Инфографика',
        rasmYaratish: 'Создать Картинку',
        balansim: 'Мой Баланс',
        bepulOlish: 'Бесплатно',
        yordam: 'Помощь',
        sozlamalar: 'Настройки',
        adminPanel: 'Админ Панель',
        slideCountPrompt: (topic) => `🎯 Тема принята: ${topic}\n\nСколько слайдов?`,
        slidePackageInfo: (topic, count, price, paket, isFree) =>
            `${paket.emoji} Пакет ${paket.nomRu || paket.nom}\n\n📌 Тема: ${topic}\n📊 Слайдов: ${count}\n💰 Цена: ${price > 0 ? price.toLocaleString() + ' сум' : 'БЕСПЛАТНО 🎁'}\n\n🎨 Выберите шаблон или продолжите без:\n💡 Напишите 2 числа (например: 3 7) — 2 варианта!`,
        slideCreating: (paket, isDual) =>
            `⏳ ${paket.emoji} Пакет ${paket.nomRu || paket.nom} готовится...\n\n🤖 AI собирает данные\n🎨 Дизайн создаётся\n` +
            (isDual ? `🎁 2 варианта готовятся\n` : '') +
            `📎 Файл создаётся\n\nЭто займёт 20-40 секунд ⌛`,
        slideReady1: (paket, topic, count, price, isFree) =>
            `✅ Слайд готов! 🎉\n\n${paket.emoji} Пакет: ${paket.nomRu || paket.nom}\n📌 Тема: ${topic}\n📊 ${count} слайдов\n💰 ${isFree ? 'БЕСПЛАТНО' : price.toLocaleString()+' сум'}`,
        slideReady2: (paket, isFree, price) =>
            `✅ Оба варианта готовы! 🎉\n\n${paket.emoji} Пакет: ${paket.nomRu || paket.nom}\n💰 Цена: ${isFree ? 'БЕСПЛАТНО' : price.toLocaleString()+' сум'}\n\nСохраните понравившийся! 😊`,
        slideVariant: (n, tmpl, topic, count) => `🎨 Вариант ${n} — Шаблон #${tmpl?.replace('template_','')||'A'}\n📌 ${topic}\n📊 ${count} слайдов`,
        testPrompt: (balance, price) => `📝 Создание Теста\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: ${price.toLocaleString()} сум (10-20 вопросов)\n\nВведите тему теста:\n(Например: Биология — Растения)`,
        testReady: (topic, count, price) => `✅ Тест готов! 🎉\n\n📌 Тема: ${topic}\n📝 ${count} вопросов\n💰 ${price.toLocaleString()} сум`,
        crossPrompt: (balance, price) => `🔲 Создание Кроссворда\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: ${price.toLocaleString()} сум\n\nВведите тему:`,
        crossReady: (topic, count, price) => `✅ Кроссворд готов! 🎉\n\n📌 Тема: ${topic}\n🔲 ${count} вопросов\n💰 ${price.toLocaleString()} сум`,
        essayTypePrompt: (balance, price) => `✍️ Сочинение или Эссе?\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: ${price.toLocaleString()} сум (500-1000 слов)`,
        essayTopicPrompt: (type, balance, price) => `✍️ Введите тему ${type === 'insho' ? 'сочинения' : 'эссе'}:\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: ${price.toLocaleString()} сум`,
        essayReady: (type, topic, words, price) => `✅ ${type === 'insho' ? 'Сочинение' : 'Эссе'} готово! 🎉\n\n📌 Тема: ${topic}\n✍️ ${words} слов\n💰 ${price.toLocaleString()} сум`,
        referatTypePrompt: (balance, price) => `📚 Реферат или Самостоятельная Работа?\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: ${price.toLocaleString()} сум (10-20 стр)`,
        referatTopicPrompt: (type) => `📚 Введите тему ${type === 'referat' ? 'реферата' : 'самостоятельной работы'}:`,
        referatReady: (type, topic, pages, price) => `✅ ${type === 'referat' ? 'Реферат' : 'Самостоятельная работа'} готов! 🎉\n\n📌 Тема: ${topic}\n📋 ${pages} стр\n💰 ${price.toLocaleString()} сум`,
        tezisPrompt: (balance, price) => `🎓 Создание Тезиса\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: ${price.toLocaleString()} сум (3-10 стр)\n\nВведите тему:`,
        tezisReady: (topic, pages, price) => `✅ Тезис готов! 🎉\n\n📌 Тема: ${topic}\n📋 ${pages} стр\n💰 ${price.toLocaleString()} сум`,
        maqolaPrompt: (balance, price) => `📰 Создание Статьи\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: ${price.toLocaleString()} сум (3-10 стр)\n\nВведите тему:`,
        maqolaReady: (topic, pages, price) => `✅ Статья готова! 🎉\n\n📌 Тема: ${topic}\n📋 ${pages} стр\n💰 ${price.toLocaleString()} сум`,
        infoPrompt: (balance, price) => `📊 Создание Инфографики\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: ${price.toLocaleString()} сум\n\nВведите тему:\n(Например: Население Узбекистана)`,
        infoReady: (topic, price) => `✅ Инфографика готова! 🎉\n\n📌 Тема: ${topic}\n💰 ${price.toLocaleString()} сум`,
        rasmPrompt: (balance, price) => `🖼 AI Создание Картинки\n\n💰 Баланс: ${(balance||0).toLocaleString()} сум\n📌 Цена: ${price.toLocaleString()} сум\n\nОпишите картинку:\n(Например: озеро в горах, ночь, красочное)`,
        rasmReady: (price, prompt) =>
            `🖼 AI Профессиональный Промпт Готов! 🎉\n\n💰 ${price.toLocaleString()} сум\n\n📝 Используйте этот промпт в Midjourney, DALL-E или Stable Diffusion:\n\n${prompt.slice(0, 900)}`,
        slideInfo: (balance) =>
            `✨ Создание Слайда\n\n💰 Ваш баланс: ${(balance||0).toLocaleString()} сум\n\n📦 Пакеты:\n` +
            `🎁 Пробный    — БЕСПЛАТНО (1 слайд)\n⚡ Талант     — 2,000 сум (5–12)\n💎 Профи      — 3,500 сум (13–20)\n👑 Премиум    — 6,000 сум (21–30)\n🌟 Бесконечно — 50,000 сум/мес (безлимит)\n\n📌 Введите тему:`,
        chooseCount: 'Сколько?',
        chooseDiff: 'Выберите сложность:',
        chooseTopic: 'Введите тему:',
        choosePages: 'Сколько страниц?',
        enterWords: 'Сколько слов?',
        chooseType: 'Выберите тип:',
        templateInfo: (channel, site) =>
            `🎨 У нас 50 премиум шаблонов!\n\n📲 Для просмотра:\n1️⃣ Канал: ${channel}\n2️⃣ Сайт: ${site}\n\n` +
            `✅ После просмотра отправьте 2 номера шаблонов!\n📌 Например: 3 7\n(Два номера — два дизайна 🎁)`,
        nameTooShort: 'Пожалуйста, введите правильное имя (минимум 2 буквы):',
        surnameTooShort: 'Пожалуйста, введите правильную фамилию:',
        topicTooShort: 'Тема слишком короткая. Напишите подробнее:',
        infoTooShort: 'Информация слишком короткая:',
        pdfCreating: '⏳ Создание PDF... ⌛',
        pdfNoImages: 'Фото не найдены.',
        pdfMaxImages: 'Максимум 10 фото загружено. Создание PDF...',
        pdfSendMore: '📸 Отправьте фото:',
        pdfCreateOrSend: '📸 Отправьте фото или нажмите "Создать PDF":',
        paymentChoose: 'Выберите способ оплаты:',
        paymentClick: 'Click',
        paymentPayme: 'Payme',
        paymentAdmin: 'Связаться с админом',
        paymentSendCheck: 'Отправить чек',
        paymentCheckSent: 'Чек отправлен!',
        adminContactInfo: (username, phone) => `👨‍💻 Связь с админом:\nTelegram: @${username}\nТел: ${phone}`,
        helpBot: `🔄 Нажмите /start или отправьте /reset.\n\nЕсли проблема осталась, напишите @${CHANNEL_USERNAME}.`,
        helpPayment: (username, phone) => `💳 По вопросам оплаты обратитесь к админу: @${username}\nТел: ${phone}`,
        helpFile: (username) => `📄 Если файл не пришёл, нажмите /start и попробуйте снова.\nАдмин: @${username}`,
        editNamePrompt: '✏️ Введите новое имя:',
        editSurnamePrompt: '✏️ Введите новую фамилию:',
        nameUpdated: '✅ Имя обновлено!',
        surnameUpdated: '✅ Фамилия обновлена!',
        cancelDone: '✅ Отменено.',
        ratingPrompt: 'Оцените от 1️⃣ до 5️⃣:',
        checkSendPrompt: `✅ После оплаты отправьте фото ЧЕКА!`,
        referralMsg: (count) => `🎁 5 друзей присоединились! На баланс добавлено 3,000 сум! 🎉`,
        balanceAdminAdd: (amount) => `🎁 Админ добавил ${parseInt(amount).toLocaleString()} сум на ваш баланс!`,
        broadcastDone: (sent, failed) => `✅ Отправлено: ${sent}\n❌ Ошибка: ${failed}`,
        broadcasting: (count) => `⏳ Отправка ${count} пользователям...`,
        noPendingPayments: '✅ Ожидающих платежей нет.',
        pendingPaymentsHeader: (count) => `💰 Ожидающие платежи (${count}):\n\n`,
        paymentApprovedAdmin: (userId, amount) => `✅ Платеж подтверждён! Пользователь: ${userId}, Сумма: ${parseInt(amount).toLocaleString()} сум`,
        approveFormatError: '❌ Формат: /approve PAYMENT_ID',
        approveNotFound: '❌ Платёж не найден или уже подтверждён!',
        balanceFormatError: '❌ Формат: /balance USER_ID СУММА',
        noAccess: '🔒 Доступ запрещён!',
        restored: '🔄 Восстановлено!',
        defaultReply: 'Выберите услугу!',
        imgUploadError: 'Ошибка загрузки фото. Попробуйте снова.',
        pdfBuildError: 'Ошибка создания PDF.',
        adminStats: (users, orders, revenue) =>
            `📊 Статистика\n👥 ${users} пользователей\n📋 ${orders} заказов\n💵 ${revenue.toLocaleString()} сум доход`,
        adminPanelInfo: (users, pending, orders, revenue) =>
            `👨‍💻 Админ Панель\n\n👥 Пользователей: ${users}\n💰 Ожидают: ${pending}\n📊 Заказов: ${orders}\n💵 Доход: ${revenue.toLocaleString()} сум`,
        contactAdminPrompt: 'Напишите ваше сообщение:',
        newContactMsg: (name, surname, username, userId, text) =>
            `👨‍💻 Новое обращение!\n\nОт: ${name} ${surname} (@${username||'нет'})\nID: ${userId}\n\nСообщение: ${text}`,
        newPaymentNotify: (name, surname, userId, type, amount, paymentId) =>
            `💰 Новый платёж!\n\nОт: ${name} ${surname}\nID: ${userId}\nТип: ${type.toUpperCase()}\nСумма: ${amount.toLocaleString()} сум\n\nПодтвердить: /approve ${paymentId}`,
        currency: 'сум',
        freeLabel: 'БЕСПЛАТНО',
        slide: 'слайд',
        slides: 'слайдов',
        page: 'стр',
        pages: 'стр',
        words: 'слов',
        questions: 'вопросов',
        topic: 'Тема',
        price: 'Цена',
        balanceLabel: 'Баланс',
        packageLabel: 'Пакет',
        infinityPackage: '🌟 Бесконечно — 50,000 сум/мес (безлимит)',
        month: 'мес',
        payPerMonth: '/мес',
        freeSlideLeft: (n) => `🎁 У вас ${n} бесплатных слайдов!\n\n`,
        and: 'и',
        referralCount: (n) => `👥 Приглашено: ${n}`,
        selectService: 'Выберите услугу',
        creatingPdf: 'Создание PDF',
        done: 'Готово',
        startText: 'Бот запущен',
        stopText: 'Бот остановлен',
        serverRunning: (port) => `Health check: порт ${port}`,
        botRunning: '✅ SlaydTop Bot запущен!',
        botError: '❌ Ошибка запуска бота:',
        unexpectedError: '😔 Неожиданная ошибка. Нажмите /start.',
        helpChoose: 'Выберите проблему:',
        checkReceivedNotify: 'Чек получен!',
    },
    en: {
        welcome: `🌟 Welcome to SlaydTop!\nPlease select your language:`,
        enterName: `✨ Great choice!\n\nLet's get acquainted 😊\nEnter your name:\n(Example: John)`,
        enterSurname: (name) => `🎉 Great name, ${name}!\n\nEnter your surname:\n(Example: Smith)`,
        registered: (name, freeCount) => `🏆 Congratulations, ${name}!\n\nYou have successfully registered!\n\n🎁 Your FREE gifts:\n✅ ${freeCount} slide — FREE\n✅ Image to PDF — ALWAYS FREE\n\nLet's start? 👇`,
        mainMenu: `Select a service 👇`,
        balance: (u) => `💰 Your account\n\n👤 ${u.name} ${u.surname}\n💳 Balance: ${(u.balance||0).toLocaleString()} sum\n🎁 Free slides: ${Math.max(0, FREE_SLIDES-(u.freeUsed||0))}\n📊 Total orders: ${u.totalOrders||0}`,
        cancel: '❌ Cancel',
        back: '◀️ Main Menu',
        lowBalance: (need, has) => `😔 Insufficient balance\n\n💰 Required: ${need.toLocaleString()} sum\n💳 You have: ${has.toLocaleString()} sum\n\nSelect payment method:`,
        payClick: (sum) => `💳 Payment via CLICK\n\n💰 Amount: ${sum.toLocaleString()} sum\n🏦 Card: ${CARD_NUMBER}\n👤 Name: ${CARD_OWNER}\n\n✅ Send RECEIPT after payment!`,
        payPayme: (sum) => `💳 Payment via PAYME\n\n💰 Amount: ${sum.toLocaleString()} sum\n🏦 Card: ${CARD_NUMBER}\n👤 Name: ${CARD_OWNER}\n\n✅ Send RECEIPT after payment!`,
        checkReceived: `⏳ Receipt received!\n\nAdmin will verify and top up your balance.\nUsually 5-15 minutes ✅`,
        payApproved: (amount, newBal) => `✅ Payment confirmed! 🏆\n${amount.toLocaleString()} sum added to balance!\n💰 New balance: ${newBal.toLocaleString()} sum`,
        free: (userId, botUser) => `🎁 Free services\n\n1️⃣ Image to PDF — ALWAYS FREE ♾️\n\n2️⃣ Invite friends:\nEvery 5 friends = +3,000 sum\n\n🔗 Your link:\nhttps://t.me/${botUser}?start=ref_${userId}`,
        settings: (u) => `⚙️ Settings\n\n👤 Name: ${u.name}\n📝 Surname: ${u.surname}\n🌐 Language: English 🇬🇧`,
        help: `❓ Help center\n\nSelect your issue:`,
        adminMsg: `Write your message, admin will reply soon:`,
        msgSent: `✅ Message sent to admin!`,
        creating: `⏳ Preparing...\n\n🤖 AI collecting data\n🎨 Designing\n📎 Preparing file\n\nThis takes 15-30 seconds ⌛`,
        ready: (type, topic, price) => `✅ ${type} ready! 🎉\n\n📌 Topic: ${topic}\n💰 Price: ${price > 0 ? price.toLocaleString()+' sum' : 'FREE'}\n\nRate from 1️⃣ to 5️⃣:`,
        rateThank: (r) => r===5 ? '👏 Excellent! Thank you!' : r>=4 ? '👏 Very good! Thanks!' : r>=3 ? '🙂 Thanks! We will improve!' : '🙏 Thank you for feedback!',
        error: `😔 An error occurred. Please try again.`,
        invalidInput: `😊 Please enter valid information.`,
        pdfFree: `📄 Image to PDF — ABSOLUTELY FREE! 🎁\n\nSend your image, I will convert to PDF!\n\n✅ JPG, PNG, WEBP accepted\n✅ Up to 10 images at once\n✅ Unlimited use\n\nSend image: 👇`,
        pdfGot: (n) => `✅ Image received! (${n})\n\nWant to add more?`,
        pdfDone: (n) => `🎉 PDF ready!\n\n${n} images converted to PDF.\nDownload! ⬇️`,
        slideCreate: 'Create Slide',
        imgToPdf: 'Image to PDF',
        referatMustaqil: 'Essay/Research',
        essayEsse: 'Essay/Composition',
        test: 'Test',
        crossword: 'Crossword',
        tezis: 'Thesis',
        maqola: 'Article',
        infografika: 'Infographic',
        rasmYaratish: 'Create Image',
        balansim: 'My Balance',
        bepulOlish: 'Get Free',
        yordam: 'Help',
        sozlamalar: 'Settings',
        adminPanel: 'Admin Panel',
        slideCountPrompt: (topic) => `🎯 Topic accepted: ${topic}\n\nHow many slides?`,
        slidePackageInfo: (topic, count, price, paket, isFree) =>
            `${paket.emoji} ${paket.nomEn || paket.nom} Package\n\n📌 Topic: ${topic}\n📊 Slides: ${count}\n💰 Price: ${price > 0 ? price.toLocaleString() + ' sum' : 'FREE 🎁'}\n\n🎨 Choose template or continue without:\n💡 Type 2 numbers (e.g. 3 7) — 2 variants!`,
        slideCreating: (paket, isDual) =>
            `⏳ ${paket.emoji} ${paket.nomEn || paket.nom} package preparing...\n\n🤖 AI collecting data\n🎨 Designing\n` +
            (isDual ? `🎁 2 variants preparing\n` : '') +
            `📎 File preparing\n\nThis takes 20-40 seconds ⌛`,
        slideReady1: (paket, topic, count, price, isFree) =>
            `✅ Your slide is ready! 🎉\n\n${paket.emoji} Package: ${paket.nomEn || paket.nom}\n📌 Topic: ${topic}\n📊 ${count} slides\n💰 ${isFree ? 'FREE' : price.toLocaleString()+' sum'}`,
        slideReady2: (paket, isFree, price) =>
            `✅ Both variants ready! 🎉\n\n${paket.emoji} Package: ${paket.nomEn || paket.nom}\n💰 Price: ${isFree ? 'FREE' : price.toLocaleString()+' sum'}\n\nSave the one you like! 😊`,
        slideVariant: (n, tmpl, topic, count) => `🎨 Variant ${n} — Template #${tmpl?.replace('template_','')||'A'}\n📌 ${topic}\n📊 ${count} slides`,
        testPrompt: (balance, price) => `📝 Create Test\n\n💰 Balance: ${(balance||0).toLocaleString()} sum\n📌 Price: ${price.toLocaleString()} sum (10-20 questions)\n\nEnter test topic:\n(Example: Biology — Plants)`,
        testReady: (topic, count, price) => `✅ Test ready! 🎉\n\n📌 Topic: ${topic}\n📝 ${count} questions\n💰 ${price.toLocaleString()} sum`,
        crossPrompt: (balance, price) => `🔲 Create Crossword\n\n💰 Balance: ${(balance||0).toLocaleString()} sum\n📌 Price: ${price.toLocaleString()} sum\n\nEnter topic:`,
        crossReady: (topic, count, price) => `✅ Crossword ready! 🎉\n\n📌 Topic: ${topic}\n🔲 ${count} questions\n💰 ${price.toLocaleString()} sum`,
        essayTypePrompt: (balance, price) => `✍️ Composition or Essay?\n\n💰 Balance: ${(balance||0).toLocaleString()} sum\n📌 Price: ${price.toLocaleString()} sum (500-1000 words)`,
        essayTopicPrompt: (type, balance, price) => `✍️ Enter ${type === 'insho' ? 'composition' : 'essay'} topic:\n\n💰 Balance: ${(balance||0).toLocaleString()} sum\n📌 Price: ${price.toLocaleString()} sum`,
        essayReady: (type, topic, words, price) => `✅ ${type === 'insho' ? 'Composition' : 'Essay'} ready! 🎉\n\n📌 Topic: ${topic}\n✍️ ${words} words\n💰 ${price.toLocaleString()} sum`,
        referatTypePrompt: (balance, price) => `📚 Essay or Independent Work?\n\n💰 Balance: ${(balance||0).toLocaleString()} sum\n📌 Price: ${price.toLocaleString()} sum (10-20 pages)`,
        referatTopicPrompt: (type) => `📚 Enter ${type === 'referat' ? 'essay' : 'independent work'} topic:`,
        referatReady: (type, topic, pages, price) => `✅ ${type === 'referat' ? 'Essay' : 'Independent work'} ready! 🎉\n\n📌 Topic: ${topic}\n📋 ${pages} pages\n💰 ${price.toLocaleString()} sum`,
        tezisPrompt: (balance, price) => `🎓 Create Thesis\n\n💰 Balance: ${(balance||0).toLocaleString()} sum\n📌 Price: ${price.toLocaleString()} sum (3-10 pages)\n\nEnter topic:`,
        tezisReady: (topic, pages, price) => `✅ Thesis ready! 🎉\n\n📌 Topic: ${topic}\n📋 ${pages} pages\n💰 ${price.toLocaleString()} sum`,
        maqolaPrompt: (balance, price) => `📰 Create Article\n\n💰 Balance: ${(balance||0).toLocaleString()} sum\n📌 Price: ${price.toLocaleString()} sum (3-10 pages)\n\nEnter topic:`,
        maqolaReady: (topic, pages, price) => `✅ Article ready! 🎉\n\n📌 Topic: ${topic}\n📋 ${pages} pages\n💰 ${price.toLocaleString()} sum`,
        infoPrompt: (balance, price) => `📊 Create Infographic\n\n💰 Balance: ${(balance||0).toLocaleString()} sum\n📌 Price: ${price.toLocaleString()} sum\n\nEnter topic:\n(Example: Population of Uzbekistan)`,
        infoReady: (topic, price) => `✅ Infographic ready! 🎉\n\n📌 Topic: ${topic}\n💰 ${price.toLocaleString()} sum`,
        rasmPrompt: (balance, price) => `🖼 AI Image Creation\n\n💰 Balance: ${(balance||0).toLocaleString()} sum\n📌 Price: ${price.toLocaleString()} sum\n\nDescribe the image:\n(Example: lake in mountains, night, colorful)`,
        rasmReady: (price, prompt) =>
            `🖼 AI Professional Prompt Ready! 🎉\n\n💰 ${price.toLocaleString()} sum\n\n📝 Use this prompt in Midjourney, DALL-E or Stable Diffusion:\n\n${prompt.slice(0, 900)}`,
        slideInfo: (balance) =>
            `✨ Create Slide\n\n💰 Your balance: ${(balance||0).toLocaleString()} sum\n\n📦 Packages:\n` +
            `🎁 Trial      — FREE (1 slide)\n⚡ Talent     — 2,000 sum (5–12)\n💎 Pro        — 3,500 sum (13–20)\n👑 Premium    — 6,000 sum (21–30)\n🌟 Infinity   — 50,000 sum/month (unlimited)\n\n📌 Enter topic:`,
        chooseCount: 'How many?',
        chooseDiff: 'Choose difficulty:',
        chooseTopic: 'Enter topic:',
        choosePages: 'How many pages?',
        enterWords: 'How many words?',
        chooseType: 'Choose type:',
        templateInfo: (channel, site) =>
            `🎨 We have 50 premium templates!\n\n📲 To view:\n1️⃣ Channel: ${channel}\n2️⃣ Website: ${site}\n\n` +
            `✅ After viewing, send 2 template numbers!\n📌 Example: 3 7\n(Two numbers — two designs 🎁)`,
        nameTooShort: 'Please enter a valid name (at least 2 letters):',
        surnameTooShort: 'Please enter a valid surname:',
        topicTooShort: 'Topic is too short. Please write more details:',
        infoTooShort: 'Information is too short:',
        pdfCreating: '⏳ Creating PDF... ⌛',
        pdfNoImages: 'No images found.',
        pdfMaxImages: 'Maximum 10 images uploaded. Creating PDF...',
        pdfSendMore: '📸 Send a photo:',
        pdfCreateOrSend: '📸 Send a photo or press "Create PDF":',
        paymentChoose: 'Select payment method:',
        paymentClick: 'Click',
        paymentPayme: 'Payme',
        paymentAdmin: 'Contact Admin',
        paymentSendCheck: 'Send receipt',
        paymentCheckSent: 'Receipt sent!',
        adminContactInfo: (username, phone) => `👨‍💻 Contact Admin:\nTelegram: @${username}\nPhone: ${phone}`,
        helpBot: `🔄 Press /start or send /reset.\n\nIf problem persists, contact @${CHANNEL_USERNAME}.`,
        helpPayment: (username, phone) => `💳 For payment issues contact admin: @${username}\nPhone: ${phone}`,
        helpFile: (username) => `📄 If file not received, press /start and try again.\nAdmin: @${username}`,
        editNamePrompt: '✏️ Enter new name:',
        editSurnamePrompt: '✏️ Enter new surname:',
        nameUpdated: '✅ Name updated!',
        surnameUpdated: '✅ Surname updated!',
        cancelDone: '✅ Cancelled.',
        ratingPrompt: 'Rate from 1️⃣ to 5️⃣:',
        checkSendPrompt: `✅ Send receipt photo after payment!`,
        referralMsg: (count) => `🎁 5 friends joined! 3,000 sum added to your balance! 🎉`,
        balanceAdminAdd: (amount) => `🎁 Admin added ${parseInt(amount).toLocaleString()} sum to your balance!`,
        broadcastDone: (sent, failed) => `✅ Sent: ${sent}\n❌ Failed: ${failed}`,
        broadcasting: (count) => `⏳ Sending to ${count} users...`,
        noPendingPayments: '✅ No pending payments.',
        pendingPaymentsHeader: (count) => `💰 Pending payments (${count}):\n\n`,
        paymentApprovedAdmin: (userId, amount) => `✅ Payment approved! User: ${userId}, Amount: ${parseInt(amount).toLocaleString()} sum`,
        approveFormatError: '❌ Format: /approve PAYMENT_ID',
        approveNotFound: '❌ Payment not found or already approved!',
        balanceFormatError: '❌ Format: /balance USER_ID AMOUNT',
        noAccess: '🔒 Access denied!',
        restored: '🔄 Restored!',
        defaultReply: 'Please select a service!',
        imgUploadError: 'Error uploading image. Please try again.',
        pdfBuildError: 'Error creating PDF.',
        adminStats: (users, orders, revenue) =>
            `📊 Statistics\n👥 ${users} users\n📋 ${orders} orders\n💵 ${revenue.toLocaleString()} sum revenue`,
        adminPanelInfo: (users, pending, orders, revenue) =>
            `👨‍💻 Admin Panel\n\n👥 Users: ${users}\n💰 Pending: ${pending}\n📊 Orders: ${orders}\n💵 Revenue: ${revenue.toLocaleString()} sum`,
        contactAdminPrompt: 'Write your message:',
        newContactMsg: (name, surname, username, userId, text) =>
            `👨‍💻 New message!\n\nFrom: ${name} ${surname} (@${username||'none'})\nID: ${userId}\n\nMessage: ${text}`,
        newPaymentNotify: (name, surname, userId, type, amount, paymentId) =>
            `💰 New payment!\n\nFrom: ${name} ${surname}\nID: ${userId}\nType: ${type.toUpperCase()}\nAmount: ${amount.toLocaleString()} sum\n\nApprove: /approve ${paymentId}`,
        currency: 'sum',
        freeLabel: 'FREE',
        slide: 'slide',
        slides: 'slides',
        page: 'page',
        pages: 'pages',
        words: 'words',
        questions: 'questions',
        topic: 'Topic',
        price: 'Price',
        balanceLabel: 'Balance',
        packageLabel: 'Package',
        infinityPackage: '🌟 Infinity   — 50,000 sum/month (unlimited)',
        month: 'month',
        payPerMonth: '/month',
        freeSlideLeft: (n) => `🎁 You have ${n} free slides!\n\n`,
        and: 'and',
        referralCount: (n) => `👥 Invited: ${n}`,
        selectService: 'Select a service',
        creatingPdf: 'Creating PDF',
        done: 'Done',
        startText: 'Bot started',
        stopText: 'Bot stopped',
        serverRunning: (port) => `Health check: port ${port}`,
        botRunning: '✅ SlaydTop Bot started!',
        botError: '❌ Bot launch error:',
        unexpectedError: '😔 Unexpected error. Press /start.',
        helpChoose: 'Select your issue:',
        checkReceivedNotify: 'Receipt received!',
    },
    id: {
        welcome: `🌟 Selamat datang di SlaydTop!\nSilakan pilih bahasa:`,
        enterName: `✨ Pilihan bagus!\n\nMari berkenalan 😊\nMasukkan nama Anda:\n(Contoh: Budi)`,
        enterSurname: (name) => `🎉 Nama bagus, ${name}!\n\nMasukkan nama belakang Anda:\n(Contoh: Santoso)`,
        registered: (name, freeCount) => `🏆 Selamat, ${name}!\n\nAnda berhasil terdaftar!\n\n🎁 Hadiah GRATIS Anda:\n✅ ${freeCount} slide — GRATIS\n✅ Gambar ke PDF — SELALU GRATIS\n\nMari mulai? 👇`,
        mainMenu: `Pilih layanan 👇`,
        balance: (u) => `💰 Akun Anda\n\n👤 ${u.name} ${u.surname}\n💳 Saldo: ${(u.balance||0).toLocaleString()} sum\n🎁 Slide gratis: ${Math.max(0, FREE_SLIDES-(u.freeUsed||0))}\n📊 Total pesanan: ${u.totalOrders||0}`,
        cancel: '❌ Batal',
        back: '◀️ Menu Utama',
        lowBalance: (need, has) => `😔 Saldo tidak cukup\n\n💰 Diperlukan: ${need.toLocaleString()} sum\n💳 Anda punya: ${has.toLocaleString()} sum\n\nPilih metode pembayaran:`,
        payClick: (sum) => `💳 Pembayaran via CLICK\n\n💰 Jumlah: ${sum.toLocaleString()} sum\n🏦 Kartu: ${CARD_NUMBER}\n👤 Nama: ${CARD_OWNER}\n\n✅ Kirim BUKTI setelah pembayaran!`,
        payPayme: (sum) => `💳 Pembayaran via PAYME\n\n💰 Jumlah: ${sum.toLocaleString()} sum\n🏦 Kartu: ${CARD_NUMBER}\n👤 Nama: ${CARD_OWNER}\n\n✅ Kirim BUKTI setelah pembayaran!`,
        checkReceived: `⏳ Bukti diterima!\n\nAdmin akan memverifikasi dan mengisi saldo.\nBiasanya 5-15 menit ✅`,
        payApproved: (amount, newBal) => `✅ Pembayaran dikonfirmasi! 🏆\n${amount.toLocaleString()} sum ditambahkan ke saldo!\n💰 Saldo baru: ${newBal.toLocaleString()} sum`,
        free: (userId, botUser) => `🎁 Layanan gratis\n\n1️⃣ Gambar ke PDF — SELALU GRATIS ♾️\n\n2️⃣ Undang teman:\nSetiap 5 teman = +3,000 sum\n\n🔗 Link Anda:\nhttps://t.me/${botUser}?start=ref_${userId}`,
        settings: (u) => `⚙️ Pengaturan\n\n👤 Nama: ${u.name}\n📝 Nama belakang: ${u.surname}\n🌐 Bahasa: Indonesia 🇮🇩`,
        help: `❓ Pusat Bantuan\n\nPilih masalah Anda:`,
        adminMsg: `Tulis pesan Anda, admin akan segera membalas:`,
        msgSent: `✅ Pesan terkirim ke admin!`,
        creating: `⏳ Menyiapkan...\n\n🤖 AI mengumpulkan data\n🎨 Mendesain\n📎 Menyiapkan file\n\nIni memakan waktu 15-30 detik ⌛`,
        ready: (type, topic, price) => `✅ ${type} siap! 🎉\n\n📌 Topik: ${topic}\n💰 Harga: ${price > 0 ? price.toLocaleString()+' sum' : 'GRATIS'}\n\nNilai dari 1️⃣ sampai 5️⃣:`,
        rateThank: (r) => r===5 ? '👏 Luar biasa! Terima kasih!' : r>=4 ? '👏 Sangat bagus! Terima kasih!' : r>=3 ? '🙂 Terima kasih! Kami akan memperbaiki!' : '🙏 Terima kasih atas masukan!',
        error: `😔 Terjadi kesalahan. Silakan coba lagi.`,
        invalidInput: `😊 Silakan masukkan informasi yang valid.`,
        pdfFree: `📄 Gambar ke PDF — GRATIS TOTAL! 🎁\n\nKirim gambar Anda, saya akan konversi ke PDF!\n\n✅ JPG, PNG, WEBP diterima\n✅ Hingga 10 gambar sekaligus\n✅ Penggunaan tanpa batas\n\nKirim gambar: 👇`,
        pdfGot: (n) => `✅ Gambar diterima! (${n})\n\nIngin menambah lagi?`,
        pdfDone: (n) => `🎉 PDF siap!\n\n${n} gambar dikonversi ke PDF.\nUnduh! ⬇️`,
        slideCreate: 'Buat Slide',
        imgToPdf: 'Gambar ke PDF',
        referatMustaqil: 'Esai/Penelitian',
        essayEsse: 'Esai/Karangan',
        test: 'Ujian',
        crossword: 'TTS',
        tezis: 'Tesis',
        maqola: 'Artikel',
        infografika: 'Infografis',
        rasmYaratish: 'Buat Gambar',
        balansim: 'Saldo Saya',
        bepulOlish: 'Gratis',
        yordam: 'Bantuan',
        sozlamalar: 'Pengaturan',
        adminPanel: 'Panel Admin',
        slideCountPrompt: (topic) => `🎯 Topik diterima: ${topic}\n\nBerapa slide?`,
        slidePackageInfo: (topic, count, price, paket, isFree) =>
            `${paket.emoji} Paket ${paket.nomId || paket.nom}\n\n📌 Topik: ${topic}\n📊 Slide: ${count}\n💰 Harga: ${price > 0 ? price.toLocaleString() + ' sum' : 'GRATIS 🎁'}\n\n🎨 Pilih template atau lanjutkan tanpa:\n💡 Ketik 2 angka (misal: 3 7) — 2 variasi!`,
        slideCreating: (paket, isDual) =>
            `⏳ ${paket.emoji} Paket ${paket.nomId || paket.nom} sedang disiapkan...\n\n🤖 AI mengumpulkan data\n🎨 Mendesain\n` +
            (isDual ? `🎁 2 variasi sedang disiapkan\n` : '') +
            `📎 File sedang disiapkan\n\nIni memakan waktu 20-40 detik ⌛`,
        slideReady1: (paket, topic, count, price, isFree) =>
            `✅ Slide Anda siap! 🎉\n\n${paket.emoji} Paket: ${paket.nomId || paket.nom}\n📌 Topik: ${topic}\n📊 ${count} slide\n💰 ${isFree ? 'GRATIS' : price.toLocaleString()+' sum'}`,
        slideReady2: (paket, isFree, price) =>
            `✅ Kedua variasi siap! 🎉\n\n${paket.emoji} Paket: ${paket.nomId || paket.nom}\n💰 Harga: ${isFree ? 'GRATIS' : price.toLocaleString()+' sum'}\n\nSimpan yang Anda suka! 😊`,
        slideVariant: (n, tmpl, topic, count) => `🎨 Variasi ${n} — Template #${tmpl?.replace('template_','')||'A'}\n📌 ${topic}\n📊 ${count} slide`,
        testPrompt: (balance, price) => `📝 Buat Ujian\n\n💰 Saldo: ${(balance||0).toLocaleString()} sum\n📌 Harga: ${price.toLocaleString()} sum (10-20 soal)\n\nMasukkan topik ujian:\n(Contoh: Biologi — Tumbuhan)`,
        testReady: (topic, count, price) => `✅ Ujian siap! 🎉\n\n📌 Topik: ${topic}\n📝 ${count} soal\n💰 ${price.toLocaleString()} sum`,
        crossPrompt: (balance, price) => `🔲 Buat TTS\n\n💰 Saldo: ${(balance||0).toLocaleString()} sum\n📌 Harga: ${price.toLocaleString()} sum\n\nMasukkan topik:`,
        crossReady: (topic, count, price) => `✅ TTS siap! 🎉\n\n📌 Topik: ${topic}\n🔲 ${count} pertanyaan\n💰 ${price.toLocaleString()} sum`,
        essayTypePrompt: (balance, price) => `✍️ Karangan atau Esai?\n\n💰 Saldo: ${(balance||0).toLocaleString()} sum\n📌 Harga: ${price.toLocaleString()} sum (500-1000 kata)`,
        essayTopicPrompt: (type, balance, price) => `✍️ Masukkan topik ${type === 'insho' ? 'karangan' : 'esai'}:\n\n💰 Saldo: ${(balance||0).toLocaleString()} sum\n📌 Harga: ${price.toLocaleString()} sum`,
        essayReady: (type, topic, words, price) => `✅ ${type === 'insho' ? 'Karangan' : 'Esai'} siap! 🎉\n\n📌 Topik: ${topic}\n✍️ ${words} kata\n💰 ${price.toLocaleString()} sum`,
        referatTypePrompt: (balance, price) => `📚 Esai atau Tugas Mandiri?\n\n💰 Saldo: ${(balance||0).toLocaleString()} sum\n📌 Harga: ${price.toLocaleString()} sum (10-20 hal)`,
        referatTopicPrompt: (type) => `📚 Masukkan topik ${type === 'referat' ? 'esai' : 'tugas mandiri'}:`,
        referatReady: (type, topic, pages, price) => `✅ ${type === 'referat' ? 'Esai' : 'Tugas mandiri'} siap! 🎉\n\n📌 Topik: ${topic}\n📋 ${pages} hal\n💰 ${price.toLocaleString()} sum`,
        tezisPrompt: (balance, price) => `🎓 Buat Tesis\n\n💰 Saldo: ${(balance||0).toLocaleString()} sum\n📌 Harga: ${price.toLocaleString()} sum (3-10 hal)\n\nMasukkan topik:`,
        tezisReady: (topic, pages, price) => `✅ Tesis siap! 🎉\n\n📌 Topik: ${topic}\n📋 ${pages} hal\n💰 ${price.toLocaleString()} sum`,
        maqolaPrompt: (balance, price) => `📰 Buat Artikel\n\n💰 Saldo: ${(balance||0).toLocaleString()} sum\n📌 Harga: ${price.toLocaleString()} sum (3-10 hal)\n\nMasukkan topik:`,
        maqolaReady: (topic, pages, price) => `✅ Artikel siap! 🎉\n\n📌 Topik: ${topic}\n📋 ${pages} hal\n💰 ${price.toLocaleString()} sum`,
        infoPrompt: (balance, price) => `📊 Buat Infografis\n\n💰 Saldo: ${(balance||0).toLocaleString()} sum\n📌 Harga: ${price.toLocaleString()} sum\n\nMasukkan topik:\n(Contoh: Populasi Uzbekistan)`,
        infoReady: (topic, price) => `✅ Infografis siap! 🎉\n\n📌 Topik: ${topic}\n💰 ${price.toLocaleString()} sum`,
        rasmPrompt: (balance, price) => `🖼 AI Pembuatan Gambar\n\n💰 Saldo: ${(balance||0).toLocaleString()} sum\n📌 Harga: ${price.toLocaleString()} sum\n\nDeskripsikan gambar:\n(Contoh: danau di pegunungan, malam, berwarna)`,
        rasmReady: (price, prompt) =>
            `🖼 AI Prompt Profesional Siap! 🎉\n\n💰 ${price.toLocaleString()} sum\n\n📝 Gunakan prompt ini di Midjourney, DALL-E atau Stable Diffusion:\n\n${prompt.slice(0, 900)}`,
        slideInfo: (balance) =>
            `✨ Buat Slide\n\n💰 Saldo Anda: ${(balance||0).toLocaleString()} sum\n\n📦 Paket:\n` +
            `🎁 Percobaan  — GRATIS (1 slide)\n⚡ Bakat      — 2,000 sum (5–12)\n💎 Pro        — 3,500 sum (13–20)\n👑 Premium    — 6,000 sum (21–30)\n🌟 Tak Terbatas — 50,000 sum/bln (tak terbatas)\n\n📌 Masukkan topik:`,
        chooseCount: 'Berapa banyak?',
        chooseDiff: 'Pilih tingkat kesulitan:',
        chooseTopic: 'Masukkan topik:',
        choosePages: 'Berapa halaman?',
        enterWords: 'Berapa kata?',
        chooseType: 'Pilih jenis:',
        templateInfo: (channel, site) =>
            `🎨 Kami punya 50 template premium!\n\n📲 Untuk melihat:\n1️⃣ Kanal: ${channel}\n2️⃣ Situs: ${site}\n\n` +
            `✅ Setelah melihat, kirim 2 nomor template!\n📌 Contoh: 3 7\n(Dua nomor — dua desain 🎁)`,
        nameTooShort: 'Silakan masukkan nama yang valid (minimal 2 huruf):',
        surnameTooShort: 'Silakan masukkan nama belakang yang valid:',
        topicTooShort: 'Topik terlalu singkat. Tulis lebih detail:',
        infoTooShort: 'Informasi terlalu singkat:',
        pdfCreating: '⏳ Membuat PDF... ⌛',
        pdfNoImages: 'Gambar tidak ditemukan.',
        pdfMaxImages: 'Maksimal 10 gambar diunggah. Membuat PDF...',
        pdfSendMore: '📸 Kirim gambar:',
        pdfCreateOrSend: '📸 Kirim gambar atau tekan "Buat PDF":',
        paymentChoose: 'Pilih metode pembayaran:',
        paymentClick: 'Click',
        paymentPayme: 'Payme',
        paymentAdmin: 'Hubungi Admin',
        paymentSendCheck: 'Kirim bukti',
        paymentCheckSent: 'Bukti terkirim!',
        adminContactInfo: (username, phone) => `👨‍💻 Hubungi Admin:\nTelegram: @${username}\nTelp: ${phone}`,
        helpBot: `🔄 Tekan /start atau kirim /reset.\n\nJika masalah berlanjut, hubungi @${CHANNEL_USERNAME}.`,
        helpPayment: (username, phone) => `💳 Untuk masalah pembayaran hubungi admin: @${username}\nTelp: ${phone}`,
        helpFile: (username) => `📄 Jika file tidak diterima, tekan /start dan coba lagi.\nAdmin: @${username}`,
        editNamePrompt: '✏️ Masukkan nama baru:',
        editSurnamePrompt: '✏️ Masukkan nama belakang baru:',
        nameUpdated: '✅ Nama diperbarui!',
        surnameUpdated: '✅ Nama belakang diperbarui!',
        cancelDone: '✅ Dibatalkan.',
        ratingPrompt: 'Nilai dari 1️⃣ sampai 5️⃣:',
        checkSendPrompt: `✅ Kirim foto BUKTI setelah pembayaran!`,
        referralMsg: (count) => `🎁 5 teman bergabung! 3,000 sum ditambahkan ke saldo! 🎉`,
        balanceAdminAdd: (amount) => `🎁 Admin menambahkan ${parseInt(amount).toLocaleString()} sum ke saldo Anda!`,
        broadcastDone: (sent, failed) => `✅ Terkirim: ${sent}\n❌ Gagal: ${failed}`,
        broadcasting: (count) => `⏳ Mengirim ke ${count} pengguna...`,
        noPendingPayments: '✅ Tidak ada pembayaran tertunda.',
        pendingPaymentsHeader: (count) => `💰 Pembayaran tertunda (${count}):\n\n`,
        paymentApprovedAdmin: (userId, amount) => `✅ Pembayaran disetujui! Pengguna: ${userId}, Jumlah: ${parseInt(amount).toLocaleString()} sum`,
        approveFormatError: '❌ Format: /approve PAYMENT_ID',
        approveNotFound: '❌ Pembayaran tidak ditemukan atau sudah disetujui!',
        balanceFormatError: '❌ Format: /balance USER_ID JUMLAH',
        noAccess: '🔒 Akses ditolak!',
        restored: '🔄 Dipulihkan!',
        defaultReply: 'Silakan pilih layanan!',
        imgUploadError: 'Error mengunggah gambar. Silakan coba lagi.',
        pdfBuildError: 'Error membuat PDF.',
        adminStats: (users, orders, revenue) =>
            `📊 Statistik\n👥 ${users} pengguna\n📋 ${orders} pesanan\n💵 Pendapatan ${revenue.toLocaleString()} sum`,
        adminPanelInfo: (users, pending, orders, revenue) =>
            `👨‍💻 Panel Admin\n\n👥 Pengguna: ${users}\n💰 Tertunda: ${pending}\n📊 Pesanan: ${orders}\n💵 Pendapatan: ${revenue.toLocaleString()} sum`,
        contactAdminPrompt: 'Tulis pesan Anda:',
        newContactMsg: (name, surname, username, userId, text) =>
            `👨‍💻 Pesan baru!\n\nDari: ${name} ${surname} (@${username||'tidak ada'})\nID: ${userId}\n\nPesan: ${text}`,
        newPaymentNotify: (name, surname, userId, type, amount, paymentId) =>
            `💰 Pembayaran baru!\n\nDari: ${name} ${surname}\nID: ${userId}\nJenis: ${type.toUpperCase()}\nJumlah: ${amount.toLocaleString()} sum\n\nSetujui: /approve ${paymentId}`,
        currency: 'sum',
        freeLabel: 'GRATIS',
        slide: 'slide',
        slides: 'slide',
        page: 'hal',
        pages: 'hal',
        words: 'kata',
        questions: 'pertanyaan',
        topic: 'Topik',
        price: 'Harga',
        balanceLabel: 'Saldo',
        packageLabel: 'Paket',
        infinityPackage: '🌟 Tak Terbatas — 50,000 sum/bln (tak terbatas)',
        month: 'bln',
        payPerMonth: '/bln',
        freeSlideLeft: (n) => `🎁 Anda punya ${n} slide gratis!\n\n`,
        and: 'dan',
        referralCount: (n) => `👥 Diundang: ${n}`,
        selectService: 'Pilih layanan',
        creatingPdf: 'Membuat PDF',
        done: 'Selesai',
        startText: 'Bot dimulai',
        stopText: 'Bot dihentikan',
        serverRunning: (port) => `Health check: port ${port}`,
        botRunning: '✅ SlaydTop Bot dimulai!',
        botError: '❌ Error menjalankan bot:',
        unexpectedError: '😔 Error tak terduga. Tekan /start.',
        helpChoose: 'Pilih masalah Anda:',
        checkReceivedNotify: 'Bukti diterima!',
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
    if (count <= 12) return { nom: l.iqtidor, emoji: '⚡', narx: 2000, min: 5, max: 12 };
    if (count <= 20) return { nom: l.professional, emoji: '💎', narx: 3500, min: 13, max: 20 };
    if (count <= 30) return { nom: l.premium, emoji: '👑', narx: 6000, min: 21, max: 30 };
    return { nom: l.premium, emoji: '👑', narx: 6000, min: 21, max: 30 };
}


// ==================== FOYDALANUVCHI ====================
function getUser(userId) {
    const users = loadJson(USERS_FILE, {});
    if (!users[userId]) {
        users[userId] = {
            id: userId, name: '', surname: '', lang: 'uz',
            balance: 0, freeUsed: 0, totalOrders: 0,
            registered: false, step: 'LANG_SELECT',
            invitedBy: null, invitedCount: 0
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

// ==================== KLAVIATURALAR (MULTI-TILLI) ====================
const KB = {
    langSelect: () => Markup.inlineKeyboard([
        [Markup.button.callback('🇺🇿 O\'zbek', 'lang_uz'), Markup.button.callback('🇷🇺 Русский', 'lang_ru'), Markup.button.callback('🇬🇧 English', 'lang_en'), Markup.button.callback('🇮🇩 Indonesia', 'lang_id')]
    ]),
    mainMenu: (lang = 'uz', isAdmin = false) => {
        const l = T[lang] || T.uz;
        const rows = [
            [`🆕 ${l.slideCreate}`, `📄 ${l.imgToPdf}`],
            [`🖼 Kollaj Yaratish`, `📦 PDF Siqish`],
            [`📚 ${l.referatMustaqil}`, `✍️ ${l.essayEsse}`],
            [`📝 ${l.test}`, `🔲 ${l.crossword}`],
            [`🎓 ${l.tezis}`, `📰 ${l.maqola}`],
            [`📊 ${l.infografika}`, `🖼 ${l.rasmYaratish}`],
            [`💰 ${l.balansim}`, `🎁 ${l.bepulOlish}`],
            [`❓ ${l.yordam}`, `⚙️ ${l.sozlamalar}`],
        ];
        if (isAdmin) rows.push([`👨‍💻 ${l.adminPanel}`]);
        return Markup.keyboard(rows).resize();
    },
    cancel: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        return Markup.keyboard([[`❌ ${l.cancel}`]]).resize();
    },
    slideCount: (lang = 'uz') => Markup.keyboard([
        ['1', '5', '7', '8'],
        ['10', '12', '15', '20'],
        ['25', '30', '❌ ' + (T[lang]?.cancel || T.uz.cancel)]
    ]).resize(),
    templateMenu: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        const labels = {
            uz: { view: '🖼 Shablonlarni Ko\'rish', normal: '📋 Oddiy Shablon', chart: '📈 Diagrammali Shablon', pic: '🖼 /pic — O\'z Rasmim', ai: '🤖 AI Rasm [1-Sentabr]', no: '✨ Shablonsiz (Tez)' },
            ru: { view: '🖼 Посмотреть шаблоны', normal: '📋 Обычный шаблон', chart: '📈 С диаграммой', pic: '🖼 /pic — Своё фото', ai: '🤖 AI Фото [1 Сентября]', no: '✨ Без шаблона (Быстро)' },
            en: { view: '🖼 View Templates', normal: '📋 Normal Template', chart: '📈 With Chart', pic: '🖼 /pic — My Photo', ai: '🤖 AI Image [Sep 1]', no: '✨ No Template (Fast)' },
            id: { view: '🖼 Lihat Template', normal: '📋 Template Biasa', chart: '📈 Dengan Diagram', pic: '🖼 /pic — Foto Saya', ai: '🤖 Gambar AI [1 Sep]', no: '✨ Tanpa Template' }
        };
        const lb = labels[lang] || labels.uz;
        return Markup.keyboard([
            [lb.view],
            [lb.normal, lb.chart],
            [lb.pic, lb.ai],
            [lb.no, '❌ ' + l.cancel]
        ]).resize();
    },
    testCount: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        const label = lang === 'ru' ? 'шт' : lang === 'id' ? 'soal' : lang === 'en' ? 'questions' : 'ta';
        return Markup.keyboard([
            [`10 ${label}`, `15 ${label}`, `20 ${label}`],
            [`❌ ${l.cancel}`]
        ]).resize();
    },
    difficulty: (lang = 'uz') => {
        const labels = {
            uz: ['🟢 Oson', '🟡 O\'rta', '🔴 Qiyin'],
            ru: ['🟢 Лёгкий', '🟡 Средний', '🔴 Сложный'],
            en: ['🟢 Easy', '🟡 Medium', '🔴 Hard'],
            id: ['🟢 Mudah', '🟡 Sedang', '🔴 Sulit'],
        };
        const l = labels[lang] || labels.uz;
        const c = T[lang]?.cancel || T.uz.cancel;
        return Markup.keyboard([[l[0], l[1], l[2]], [`❌ ${c}`]]).resize();
    },
    crosswordCount: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        const label = lang === 'ru' ? 'шт' : lang === 'id' ? 'soal' : lang === 'en' ? 'words' : 'ta';
        return Markup.keyboard([
            [`10 ${label}`, `15 ${label}`, `20 ${label}`],
            [`❌ ${l.cancel}`]
        ]).resize();
    },
    essayType: (lang = 'uz') => {
        const labels = {
            uz: ['📝 Insho', '📝 Esse'],
            ru: ['📝 Сочинение', '📝 Эссе'],
            en: ['📝 Composition', '📝 Essay'],
            id: ['📝 Karangan', '📝 Esai'],
        };
        const l = labels[lang] || labels.uz;
        const c = T[lang]?.cancel || T.uz.cancel;
        return Markup.keyboard([[l[0], l[1]], [`❌ ${c}`]]).resize();
    },
    essayWords: (lang = 'uz') => Markup.keyboard([
        ['500', '700', '1000'],
        [`❌ ${(T[lang]?.cancel || T.uz.cancel)}`]
    ]).resize(),
    referatType: (lang = 'uz') => {
        const labels = {
            uz: ['📚 Referat', '📑 Mustaqil Ish'],
            ru: ['📚 Реферат', '📑 Самост. Работа'],
            en: ['📚 Essay', '📑 Indep. Work'],
            id: ['📚 Esai', '📑 Tugas Mandiri'],
        };
        const l = labels[lang] || labels.uz;
        const c = T[lang]?.cancel || T.uz.cancel;
        return Markup.keyboard([[l[0], l[1]], [`❌ ${c}`]]).resize();
    },
    pageCount: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        const label = lang === 'ru' ? 'стр' : lang === 'id' ? 'hal' : lang === 'en' ? 'pages' : 'bet';
        return Markup.keyboard([
            [`10 ${label}`, `15 ${label}`, `20 ${label}`],
            [`❌ ${l.cancel}`]
        ]).resize();
    },
    pageCountSmall: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        const label = lang === 'ru' ? 'стр' : lang === 'id' ? 'hal' : lang === 'en' ? 'pages' : 'bet';
        return Markup.keyboard([
            [`3 ${label}`, `5 ${label}`, `7 ${label}`, `10 ${label}`],
            [`❌ ${l.cancel}`]
        ]).resize();
    },
    payment: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        return Markup.keyboard([
            [`💳 ${l.paymentClick}`, `💳 ${l.paymentPayme}`],
            [`👨‍💻 ${l.paymentAdmin}`],
            [`❌ ${l.cancel}`]
        ]).resize();
    },
    checkSend: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        const label = lang === 'ru' ? 'Отправить чек' : lang === 'en' ? 'Send receipt' : lang === 'id' ? 'Kirim bukti' : 'Chek yuborish';
        return Markup.keyboard([
            [`📸 ${label}`],
            [`❌ ${l.cancel}`]
        ]).resize();
    },
    pdfMore: (lang = 'uz') => {
        const l = T[lang] || T.uz;
        const addLabel = lang === 'ru' ? 'Добавить фото' : lang === 'en' ? 'Add more images' : lang === 'id' ? 'Tambah gambar' : 'Yana rasm qo\'shish';
        const pdfLabel = lang === 'ru' ? 'Создать PDF' : lang === 'en' ? 'Create PDF' : lang === 'id' ? 'Buat PDF' : 'PDF yaratish';
        return Markup.keyboard([
            [`➕ ${addLabel}`, `📄 ${pdfLabel}`],
            [`❌ ${l.cancel}`]
        ]).resize();
    },
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
            uz: ['✏️ Ismni o\'zgartirish', '✏️ Familyani o\'zgartirish', '🌐 Tilni o\'zgartirish'],
            ru: ['✏️ Изменить имя', '✏️ Изменить фамилию', '🌐 Изменить язык'],
            en: ['✏️ Change name', '✏️ Change surname', '🌐 Change language'],
            id: ['✏️ Ubah nama', '✏️ Ubah nama belakang', '🌐 Ubah bahasa'],
        };
        const l = labels[lang] || labels.uz;
        return Markup.inlineKeyboard([
            [Markup.button.callback(l[0], 'edit_name')],
            [Markup.button.callback(l[1], 'edit_surname')],
            [Markup.button.callback(l[2], 'edit_lang')]
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
        const payLabel = lang === 'ru' ? 'Платежи' : lang === 'en' ? 'Payments' : lang === 'id' ? 'Pembayaran' : 'To\'lovlar';
        const usersLabel = lang === 'ru' ? 'Пользователи' : lang === 'en' ? 'Users' : lang === 'id' ? 'Pengguna' : 'Foydalanuvchilar';
        const msgLabel = lang === 'ru' ? 'Рассылка' : lang === 'en' ? 'Broadcast' : lang === 'id' ? 'Siaran' : 'Xabar yuborish';
        const statLabel = lang === 'ru' ? 'Статистика' : lang === 'en' ? 'Statistics' : lang === 'id' ? 'Statistik' : 'Statistika';
        return Markup.keyboard([
            [`📋 ${payLabel}`, `👥 ${usersLabel}`],
            [`📢 ${msgLabel}`, `📊 ${statLabel}`],
            [`◀️ ${l.back}`]
        ]).resize();
    }
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

// ==================== AI KONTENT FUNKSIYALARI (MULTI-TILLI) ====================
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


// ==================== PPTX YARATUVCHILAR (MULTI-TILLI) ====================
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

function pptxLabels(lang = 'uz') {
    const labels = {
        uz: { preparedBy: 'Tayyorladi', user: 'Foydalanuvchi', slide: 'slayd', slides: 'ta slayd', questions: 'ta savol', difficulty: 'Daraja', of: 'dan', test: 'TEST', crossword: 'KRASSVORD', answers: 'Javoblar Kaliti', thesis: 'TEZIS', infographic: 'INFOGRAFIKA', facts: 'Faktlar', article: 'MAQOLA' },
        ru: { preparedBy: 'Подготовил', user: 'Пользователь', slide: 'слайд', slides: 'слайдов', questions: 'вопросов', difficulty: 'Сложность', of: 'из', test: 'ТЕСТ', crossword: 'КРОССВОРД', answers: 'Ключ Ответов', thesis: 'ТЕЗИС', infographic: 'ИНФОГРАФИКА', facts: 'Факты', article: 'СТАТЬЯ' },
        en: { preparedBy: 'Prepared by', user: 'User', slide: 'slide', slides: 'slides', questions: 'questions', difficulty: 'Difficulty', of: 'of', test: 'TEST', crossword: 'CROSSWORD', answers: 'Answer Key', thesis: 'THESIS', infographic: 'INFOGRAPHIC', facts: 'Facts', article: 'ARTICLE' },
        id: { preparedBy: 'Diproses oleh', user: 'Pengguna', slide: 'slide', slides: 'slide', questions: 'pertanyaan', difficulty: 'Tingkat', of: 'dari', test: 'UJIAN', crossword: 'TTS', answers: 'Kunci Jawaban', thesis: 'TESIS', infographic: 'INFOGRAFIS', facts: 'Fakta', article: 'ARTIKEL' },
    };
    return labels[lang] || labels.uz;
}

// ==================== POLLINATIONS.AI RASM YUKLOVCHI ====================
async function downloadPollinationsImage(prompt, filePath, retries = 2) {
    const safePrompt = encodeURIComponent(
        prompt.replace(/['"]/g, '').slice(0, 200)
    );
    // 16:9 nisbat, logosiz, sifatli
    const url = `https://image.pollinations.ai/prompt/${safePrompt}?width=800&height=450&nologo=true&seed=${Date.now() % 9999}`;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            await new Promise((resolve, reject) => {
                const req = https.get(url, { timeout: 18000 }, (res) => {
                    // Redirect kuzatish
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
            // Fayl mavjud va katta bo'lsa OK
            const stat = fs.statSync(filePath);
            if (stat.size > 2000) return filePath;
        } catch (e) {
            console.warn(`Pollinations attempt ${attempt+1} failed:`, e.message);
            try { fs.unlinkSync(filePath); } catch (_) {}
        }
        if (attempt < retries) await new Promise(r => setTimeout(r, 1500));
    }
    return null; // Rasm yuklanmadi — slayd rasmsiz davom etadi
}

async function makeSlidePptx(topic, aiText, userId, slideCount, templateId, lang = 'uz', userPicPath = null) {
    const pptx = new PptxGenJS();
    const user = getUser(userId);
    const clr = randColor();
    const lbl = pptxLabels(lang);
    pptx.layout = 'LAYOUT_16x9';
    pptx.title = topic;

    // Slaydlarni parse qilish
    const parts = aiText.split(/SLIDE:/i).map(s => s.trim()).filter(s => s.length > 5);
    const limit = Math.min(parts.length || 1, slideCount);

    // Slayd tuzilmasi
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

    // ── MUQOVA uchun rasm (fon sifatida) ──
    const coverImgPath = path.join(TEMP_DIR, `cover_${userId}_${Date.now()}.jpg`);
    const coverPrompt = `${topic}, professional presentation background, cinematic, high quality, abstract`;
    const coverImg = await downloadPollinationsImage(coverPrompt, coverImgPath);

    // Muqova slayd
    const cover = pptx.addSlide();
    if (coverImg) {
        // Rasm to'liq fon sifatida
        cover.addImage({ path: coverImg, x: 0, y: 0, w: 10, h: 5.63, sizing: { type: 'cover', w: 10, h: 5.63 } });
        // Qoraygan overlay effekti (qora yarim shaffof to'rtburchak)
        cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: '000000', transparency: 45 } });
    } else {
        cover.background = { color: clr.primary };
    // Foydalanuvchi rasmi bo'lsa muqovaga fon sifatida qo'yish
    if (userPicPath && fs.existsSync(userPicPath)) {
        try {
            cover.addImage({ path: userPicPath, x: 0, y: 0, w: 10, h: 5.63, sizing: { type: 'cover', w: 10, h: 5.63 } });
            cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: '000000', transparency: 45 } });
        } catch(e) {
            cover.background = { color: clr.primary };
        }
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
        `${lbl.preparedBy}: ${user.name || lbl.user} ${user.surname || ''}\nSlaydTop AI`,
        { x: 0.5, y: 3.3, w: '90%', fontSize: 14, color: 'E0E0E0', align: 'center' }
    );

    // ── KONTENT SLAYDLAR ──
    const imgPaths = [];

    // Rasmlarni parallel yuklaymiz (tezroq)
    const imgPromises = slides.map((sl, i) => {
        const imgPath = path.join(TEMP_DIR, `slide_img_${userId}_${i}_${Date.now()}.jpg`);
        imgPaths.push(imgPath);
        const prompt = `${sl.title}, ${topic}, educational illustration, clean background, professional`;
        return downloadPollinationsImage(prompt, imgPath);
    });
    const downloadedImgs = await Promise.allSettled(imgPromises);

    // Slaydlarni yaratish
    for (let i = 0; i < limit; i++) {
        const { title, content } = slides[i];
        const imgResult = downloadedImgs[i];
        const imgFile = (imgResult.status === 'fulfilled' && imgResult.value) ? imgResult.value : null;

        const sl = pptx.addSlide();
        sl.background = { color: clr.bg };

        // Yuqori sarlavha paneli
        sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: clr.primary } });
        sl.addText(title || `${topic} — ${i+1}`, {
            x: 0.4, y: 0.22, w: '90%',
            fontSize: 22, bold: true, color: 'FFFFFF'
        });

        if (imgFile) {
            // Matn chap tomonda, rasm o'ng tomonda
            if (content) {
                sl.addText(content, {
                    x: 0.4, y: 1.25, w: 5.4,
                    fontSize: 14, color: clr.text,
                    lineSpacing: 24, valign: 'top'
                });
            }
            // Rasm — o'ng tomonda, yuqori paneldan pastda
            sl.addImage({
                path: imgFile,
                x: 6.0, y: 1.18, w: 3.7, h: 3.8,
                sizing: { type: 'contain', w: 3.7, h: 3.8 }
            });
            // Rasm ramkasi
            sl.addShape(pptx.ShapeType.rect, {
                x: 5.98, y: 1.16, w: 3.74, h: 3.84,
                fill: { type: 'none' },
                line: { color: clr.primary, width: 1.5, transparency: 60 }
            });
        } else {
            // Rasmsiz — keng matn
            if (content) {
                sl.addText(content, {
                    x: 0.4, y: 1.25, w: '92%',
                    fontSize: 15, color: clr.text,
                    lineSpacing: 26, valign: 'top'
                });
            }
        }

        // Sahifa raqami
        sl.addText(`${i+1} / ${limit}`, {
            x: 8.5, y: 5.1, w: 1.3,
            fontSize: 9, color: '999999', align: 'right'
        });
        // SlaydTop watermark
        sl.addText('SlaydTop AI', {
            x: 0.3, y: 5.1, w: 2,
            fontSize: 8, color: 'BBBBBB', italic: true
        });
    }

    // Fayl saqlash
    const filePath = path.join(TEMP_DIR, `Slayd_${userId}_${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: filePath });

    // Vaqtinchalik rasm fayllarini o'chirish
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

    // Muqova
    const cover = pptx.addSlide();
    cover.background = { color: clr.primary };
    cover.addText(`📈 ${topic}`, { x: 0.5, y: 1.2, w: '90%', fontSize: 34, bold: true, color: 'FFFFFF', align: 'center' });
    cover.addShape(pptx.ShapeType.line, { x: 2, y: 3.0, w: 6, h: 0, line: { color: 'FFFFFF', width: 2, transparency: 40 } });
    cover.addText(`${user.name || ''} ${user.surname || ''}\nSlaydTop AI — Diagrammali`, { x: 0.5, y: 3.2, w: '90%', fontSize: 13, color: 'E0E0E0', align: 'center' });

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

async function makeTextPptx(title, content, userId, type, lang = 'uz') {
    const pptx = new PptxGenJS();
    const clr = randColor();
    pptx.layout = 'LAYOUT_16x9';
    const lbl = pptxLabels(lang);

    const cover = pptx.addSlide();
    cover.background = { color: clr.primary };
    cover.addText(title.toUpperCase(), { x: 0.5, y: 1.3, w: '90%', fontSize: 36, bold: true, color: 'FFFFFF', align: 'center' });

    const user = getUser(userId);
    const doneByLabel = lang === 'ru' ? 'Выполнил' : lang === 'en' ? 'Done by' : lang === 'id' ? 'Dibuat oleh' : 'Bajardi';
    cover.addText(`${doneByLabel}: ${user.name || ''} ${user.surname || ''}\nSlaydTop AI`, { x: 0.5, y: 3.0, w: '90%', fontSize: 14, color: 'E0E0E0', align: 'center' });

    // BET bo'yicha ajratish
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

// ==================== RASMDAN PDF (JIMP) ====================

// ==================== KOLLAJ YARATISH (MUKAMMAL SHABLON) ====================
// Shablon: Sarlavha yuqorida (2 qator, katta qalin), 4 ta rasm 2x2 grid, oq fon
async function makeCollagePdf(imagePaths, title, userId) {
    return new Promise(async (resolve, reject) => {
        try {
            // ── O'lchamlar (A4 Portrait) ──
            const pageW  = 595.28;
            const pageH  = 841.89;
            const pad    = 18;          // sahifa chetidan masofa
            const gap    = 10;          // rasmlar orasidagi bo'shliq
            const imgsPerPage = 4;      // har sahifada 4 ta rasm (2×2)
            const count  = imagePaths.length;
            const totalPages = Math.ceil(count / imgsPerPage);

            const pdfPath = path.join(TEMP_DIR, `kollaj_${userId}_${Date.now()}.pdf`);
            const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
            const writeStream = fs.createWriteStream(pdfPath);
            doc.pipe(writeStream);

            for (let page = 0; page < totalPages; page++) {
                doc.addPage({ size: 'A4', margin: 0 });

                // ── Oq fon ──
                doc.rect(0, 0, pageW, pageH).fill('#FFFFFF');

                const pageImgs = imagePaths.slice(page * imgsPerPage, (page + 1) * imgsPerPage);
                const n = pageImgs.length;

                // ── SARLAVHA BLOKI ──
                // Rasmda ko'ringan kabi: qovoqrang/ko'k fon yo'q, faqat oq fonda katta qalin matn
                let titleBlockH = 0;
                if (title) {
                    // 2 qatorgacha avtomatik ko'rsatiladi
                    const titleFontSize = 26;
                    const titleLineH    = titleFontSize * 1.35;
                    const maxTitleLines = 2;
                    titleBlockH = pad + maxTitleLines * titleLineH + pad * 0.5;

                    // Sarlavhani ikki qatorga bo'lish (agar uzun bo'lsa)
                    const words = title.split(' ');
                    let line1 = '', line2 = '';
                    let mid = Math.ceil(words.length / 2);
                    line1 = words.slice(0, mid).join(' ');
                    line2 = words.slice(mid).join(' ');

                    const titleY = pad;
                    doc.font('Helvetica-Bold').fontSize(titleFontSize).fillColor('#111111');

                    if (line2.trim()) {
                        // 2 qator
                        doc.text(line1, pad, titleY, { width: pageW - pad * 2, align: 'center', lineBreak: false });
                        doc.text(line2, pad, titleY + titleLineH, { width: pageW - pad * 2, align: 'center', lineBreak: false });
                        titleBlockH = titleY + titleLineH * 2 + pad * 0.8;
                    } else {
                        // 1 qator
                        doc.text(line1, pad, titleY, { width: pageW - pad * 2, align: 'center', lineBreak: false });
                        titleBlockH = titleY + titleLineH + pad * 0.8;
                    }
                } else {
                    titleBlockH = pad;
                }

                // ── GRID HISOBLASH ──
                // Mavjud rasm maydoni: sarlavhadan pastda, pastki chetigacha
                const gridTop  = titleBlockH;
                const gridH    = pageH - gridTop - pad;
                const gridW    = pageW - pad * 2;

                // Layout: har doim 2×2 (yoki n ta rasm uchun moslashtirish)
                let layout = [];
                if (n === 1) {
                    layout = [{ x: pad, y: gridTop, w: gridW, h: gridH }];
                } else if (n === 2) {
                    const cellH = (gridH - gap) / 2;
                    layout = [
                        { x: pad, y: gridTop,            w: gridW, h: cellH },
                        { x: pad, y: gridTop + cellH + gap, w: gridW, h: cellH }
                    ];
                } else if (n === 3) {
                    const topH  = gridH * 0.52;
                    const botH  = gridH - topH - gap;
                    const cellW = (gridW - gap) / 2;
                    layout = [
                        { x: pad,            y: gridTop,          w: gridW, h: topH },
                        { x: pad,            y: gridTop+topH+gap, w: cellW, h: botH },
                        { x: pad+cellW+gap,  y: gridTop+topH+gap, w: cellW, h: botH }
                    ];
                } else {
                    // 4 ta — 2×2 grid (rasmingizga o'xshash)
                    const cellW = (gridW - gap) / 2;
                    const cellH = (gridH - gap) / 2;
                    layout = [
                        { x: pad,           y: gridTop,            w: cellW, h: cellH },
                        { x: pad+cellW+gap, y: gridTop,            w: cellW, h: cellH },
                        { x: pad,           y: gridTop+cellH+gap,  w: cellW, h: cellH },
                        { x: pad+cellW+gap, y: gridTop+cellH+gap,  w: cellW, h: cellH }
                    ];
                }

                // ── RASMLARNI JOYLASHTIRISH ──
                for (let i = 0; i < pageImgs.length; i++) {
                    const slot    = layout[i];
                    const imgPath = pageImgs[i];
                    try {
                        // Jimp bilan rasmni o'qib, slot razmeriga CROP (to'liq to'ldirish)
                        const jimg   = await Jimp.read(imgPath);
                        const origW  = jimg.getWidth();
                        const origH  = jimg.getHeight();

                        // "cover" crop: slot nisbatini to'ldiradi, ortiqchasini kesadi
                        const scaleW  = slot.w / origW;
                        const scaleH  = slot.h / origH;
                        const scale   = Math.max(scaleW, scaleH); // cover = max
                        const scaledW = Math.round(origW * scale);
                        const scaledH = Math.round(origH * scale);
                        const cropX   = Math.round((scaledW - slot.w) / 2);
                        const cropY   = Math.round((scaledH - slot.h) / 2);

                        const slotWpx = Math.round(slot.w);
                        const slotHpx = Math.round(slot.h);

                        jimg.resize(scaledW, scaledH)
                            .crop(cropX, cropY, slotWpx, slotHpx);

                        const tmpCrop = imgPath + `_crop${i}.jpg`;
                        await jimg.quality(90).writeAsync(tmpCrop);

                        // Rasmni shu slot koordinatasiga qo'y (to'liq to'ldiradi)
                        doc.image(tmpCrop, slot.x, slot.y, { width: slot.w, height: slot.h });
                        try { fs.unlinkSync(tmpCrop); } catch(_) {}

                        // Ingichka ramka (1px, kulrang)
                        doc.rect(slot.x, slot.y, slot.w, slot.h)
                           .lineWidth(1).strokeColor('#bbbbbb').stroke();
                    } catch (imgErr) {
                        console.error(`Kollaj rasm[${i}] xato:`, imgErr.message);
                        // Rasm o'rniga kulrang joy qoldirish
                        doc.rect(slot.x, slot.y, slot.w, slot.h)
                           .fill('#eeeeee');
                        doc.fontSize(11).fillColor('#999999')
                           .text('⚠️ Rasm yuklanmadi', slot.x, slot.y + slot.h / 2 - 8, {
                               width: slot.w, align: 'center', lineBreak: false
                           });
                    }
                }

                // ── PASTKI IMZO ──
                doc.font('Helvetica').fontSize(8).fillColor('#cccccc')
                   .text('SlaydTop', pad, pageH - 14, { lineBreak: false });
                if (totalPages > 1) {
                    doc.text(`${page + 1} / ${totalPages}`, pageW - 50, pageH - 14, {
                        width: 40, align: 'right', lineBreak: false
                    });
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

// ==================== START ====================
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);

    // Referral tekshirish
    const startPayload = ctx.startPayload;
    if (startPayload?.startsWith('ref_')) {
        const inviterId = parseInt(startPayload.slice(4));
        if (inviterId && inviterId !== userId && !user.invitedBy) {
            updateUser(userId, { invitedBy: inviterId });
            const inv = getUser(inviterId);
            const newCount = (inv.invitedCount || 0) + 1;
            updateUser(inviterId, { invitedCount: newCount });
            if (newCount % 5 === 0) {
                updateUser(inviterId, { balance: (inv.balance || 0) + 3000 });
                const invLang = getLang(inviterId);
                try { await bot.telegram.sendMessage(inviterId, T[invLang]?.referralMsg?.(newCount) || T.uz.referralMsg(newCount)); } catch (_) {}
            }
        }
    }

    const lang = getLang(userId);
    if (!user.registered) {
        updateUser(userId, { step: 'LANG_SELECT' });
        return ctx.reply(T[lang]?.welcome || T.uz.welcome, KB.langSelect());
    }

    return ctx.reply(t(userId, 'mainMenu'), KB.mainMenu(lang, userId === ADMIN_ID));
});

// ==================== TIL TANLASH CALLBACK (TO'G'RILANGAN) ====================
bot.action(/lang_(uz|ru|en|id)/, async (ctx) => {
    const lang = ctx.match[1];
    const userId = ctx.from.id;
    updateUser(userId, { lang, step: 'WAITING_NAME' });
    await ctx.answerCbQuery();
    await ctx.editMessageText('✅');
    return ctx.reply(T[lang]?.enterName || T.uz.enterName, KB.cancel(lang));
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

// ==================== YORDAM CALLBACK (MULTI-TILLI) ====================
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
    await ctx.reply(t(userId, 'adminMsg'), KB.cancel(lang));
});

// ==================== SOZLAMALAR CALLBACK ====================
bot.action('edit_name', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    await ctx.answerCbQuery();
    updateUser(userId, { step: 'EDIT_NAME' });
    await ctx.reply(t(userId, 'editNamePrompt'), KB.cancel(lang));
});
bot.action('edit_surname', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    await ctx.answerCbQuery();
    updateUser(userId, { step: 'EDIT_SURNAME' });
    await ctx.reply(t(userId, 'editSurnamePrompt'), KB.cancel(lang));
});
bot.action('edit_lang', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    updateUser(userId, { step: 'LANG_SELECT' });
    return ctx.reply(t(userId, 'welcome'), KB.langSelect());
});

// ==================== ASOSIY MENYU HANDLERLARI (MULTI-TILLI) ====================

// --- BALANS ---
bot.hears([/💰 .*/, '💰 Balansim', '💰 Мой Баланс', '💰 My Balance', '💰 Saldo Saya'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    return ctx.reply(t(userId, 'balance', user), KB.mainMenu(lang, userId === ADMIN_ID));
});

// --- BEPUL OLISH ---
bot.hears([/🎁 .*/, '🎁 Bepul olish', '🎁 Бесплатно', '🎁 Get Free', '🎁 Gratis'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    return ctx.reply(t(userId, 'free', userId, BOT_USERNAME) + `\n\n${t(userId, 'referralCount', user.invitedCount || 0)}`, KB.mainMenu(lang, userId === ADMIN_ID));
});

// --- YORDAM ---
bot.hears([/❓ .*/, '❓ Yordam', '❓ Помощь', '❓ Help', '❓ Bantuan'], async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    return ctx.reply(t(userId, 'help'), KB.help(lang));
});

// --- SOZLAMALAR ---
bot.hears([/⚙️ .*/, '⚙️ Sozlamalar', '⚙️ Настройки', '⚙️ Settings', '⚙️ Pengaturan'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    const lang = getLang(userId);
    return ctx.reply(t(userId, 'settings', user), KB.settings(lang));
});

// --- SLAYD YARATISH ---
bot.hears([/🆕 .*/, '🆕 Slayd Yaratish', '🆕 Создать Слайд', '🆕 Create Slide', '🆕 Buat Slide'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'SLAYD_TOPIC' });

    const summerMsg = isSummerFree()
        ? `\n\n🎉 YOZ AKSIYASI — 1-SENTABRGACHA!\n🔥 Barcha xizmatlar MUTLAQO BEPUL!\n`
        : '';

    const paketlar = lang === 'ru'
        ? `🎁 Пробный — БЕСПЛАТНО (до 4 слайдов)\n⚡ Iqtidor — 2,000 сум (5–12)\n💎 Professional — 3,500 сум (13–20)\n👑 Premium — 6,000 сум (21–30)`
        : lang === 'en'
        ? `🎁 Trial — FREE (up to 4 slides)\n⚡ Iqtidor — 2,000 sum (5–12)\n💎 Professional — 3,500 sum (13–20)\n👑 Premium — 6,000 sum (21–30)`
        : `🎁 Sinov — BEPUL (4 tagacha)\n⚡ Iqtidor — 2,000 so'm (5–12)\n💎 Professional — 3,500 so'm (13–20)\n👑 Premium — 6,000 so'm (21–30)`;

    return ctx.reply(
        `🆕 Slayd Yaratish${summerMsg}\n\n💰 Balansingiz: ${(user.balance||0).toLocaleString()} so'm\n\n📦 Paketlar:\n${paketlar}\n🌟 Infinity — 50,000 so'm/oy (cheksiz)\n\n📌 Mavzuni kiriting:`,
        KB.cancel(lang)
    );
});

// --- RASMDAN PDF ---

// ==================== KOLLAJ YARATISH ====================
bot.hears(['🖼 Kollaj Yaratish', '🖼 Создать Коллаж', '🖼 Create Collage', '🖼 Buat Kolase'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    ctx.session.collageImages = [];
    ctx.session.collageTitle = null;
    updateUser(userId, { step: 'COLLAGE_TITLE' });
    return ctx.reply(
        `🖼 Kollaj Yaratish — BEPUL!\n\n` +
        `📌 Kollaj tepasiga sarlavha yozilsinmi?\n\n` +
        `✏️ Sarlavha yozing yoki "O'tkazib yuborish" bosing:`,
        Markup.keyboard([
            [`⏭ O'tkazib yuborish`],
            [`❌ ${T[lang]?.cancel || T.uz.cancel}`]
        ]).resize()
    );
});

bot.hears([/📄 .*/, '📄 Rasmdan PDF', '📄 Фото в PDF', '📄 Image to PDF', '📄 Gambar ke PDF'], async (ctx) => {
    const userId = ctx.from.id;
    if (!getUser(userId).registered) return;
    const lang = getLang(userId);
    ctx.session.pdfImages = [];
    updateUser(userId, { step: 'PDF_WAITING' });
    return ctx.reply(t(userId, 'pdfFree'), KB.cancel(lang));
});

// --- REFERAT / MUSTAQIL ---
bot.hears([/📚 .*/, '📚 Referat/Mustaqil', '📚 Реферат/Работа', '📚 Essay/Research', '📚 Esai/Penelitian'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'REFERAT_TYPE' });
    return ctx.reply(t(userId, 'referatTypePrompt', user.balance || 0, PRICES.referat), KB.referatType(lang));
});

// --- INSHO / ESSE ---
bot.hears([/✍️ .*/, '✍️ Insho/Esse', '✍️ Сочинение/Эссе', '✍️ Composition/Essay', '✍️ Karangan/Esai'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'ESSAY_TYPE' });
    return ctx.reply(t(userId, 'essayTypePrompt', user.balance || 0, PRICES.essay), KB.essayType(lang));
});

// --- TEST ---
bot.hears([/📝 .*/, '📝 Test', '📝 Тест', '📝 Ujian'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'TEST_TOPIC' });
    return ctx.reply(t(userId, 'testPrompt', user.balance || 0, PRICES.test), KB.cancel(lang));
});

// --- KRASSVORD ---
bot.hears([/🔲 .*/, '🔲 Krassvord', '🔲 Кроссворд', '🔲 Crossword', '🔲 TTS'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'CROSS_TOPIC' });
    return ctx.reply(t(userId, 'crossPrompt', user.balance || 0, PRICES.crossword), KB.cancel(lang));
});

// --- TEZIS ---
bot.hears([/🎓 .*/, '🎓 Tezis', '🎓 Тезис', '🎓 Thesis', '🎓 Tesis'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'TEZIS_TOPIC' });
    return ctx.reply(t(userId, 'tezisPrompt', user.balance || 0, PRICES.tezis), KB.cancel(lang));
});

// --- MAQOLA ---
bot.hears([/📰 .*/, '📰 Maqola', '📰 Статья', '📰 Article', '📰 Artikel'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'MAQOLA_TOPIC' });
    return ctx.reply(t(userId, 'maqolaPrompt', user.balance || 0, PRICES.maqola), KB.cancel(lang));
});

// --- INFOGRAFIKA ---
bot.hears([/📊 .*/, '📊 Infografika', '📊 Инфографика', '📊 Infographic', '📊 Infografis'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'INFO_TOPIC' });
    return ctx.reply(t(userId, 'infoPrompt', user.balance || 0, PRICES.infografika), KB.cancel(lang));
});

// --- RASM YARATISH ---
bot.hears([/🖼 .*/, '🖼 Rasm Yaratish', '🖼 Создать Картинку', '🖼 Create Image', '🖼 Buat Gambar'], async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const lang = getLang(userId);
    updateUser(userId, { step: 'RASM_DESC' });
    return ctx.reply(t(userId, 'rasmPrompt', user.balance || 0, PRICES.rasm), KB.cancel(lang));
});

// --- ADMIN PANEL ---
bot.hears([/👨‍💻 .*/, '👨‍💻 Admin Panel', '👨‍💻 Админ Панель'], async (ctx) => {
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
bot.hears([/📋 .*/, /👥 .*/, /📢 .*/, /📊 .*/], async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) return;
    const lang = getLang(userId);
    const text = ctx.message.text;

    if (text.includes('📋') || text.includes('To\'lovlar') || text.includes('Платежи') || text.includes('Payments')) {
        const pending = getPendingPayments();
        if (!pending.length) return ctx.reply(t(userId, 'noPendingPayments'));
        let msg = t(userId, 'pendingPaymentsHeader', pending.length);
        pending.slice(0, 10).forEach(p => {
            const u = getUser(p.userId);
            msg += `🆔 ${p.id}\n👤 ${u?.name||'?'} ${u?.surname||''} (${p.userId})\n💵 ${p.amount.toLocaleString()} ${t(userId, 'currency')} — ${p.type.toUpperCase()}\n✅ /approve ${p.id}\n\n`;
        });
        return ctx.reply(msg);
    }

    if (text.includes('👥') || text.includes('Foydalanuvchilar') || text.includes('Пользователи') || text.includes('Users')) {
        const users = Object.values(loadJson(USERS_FILE, {}));
        let msg = `👥 ${lang === 'ru' ? 'Пользователи' : lang === 'en' ? 'Users' : lang === 'id' ? 'Pengguna' : 'Foydalanuvchilar'} (${users.length}):\n\n`;
        users.slice(0, 15).forEach((u, i) => {
            msg += `${i+1}. ${u.name} ${u.surname} — ${(u.balance||0).toLocaleString()} ${t(userId, 'currency')}\n`;
        });
        return ctx.reply(msg);
    }

    if (text.includes('📢') || text.includes('Xabar') || text.includes('Рассылка') || text.includes('Broadcast')) {
        updateUser(ADMIN_ID, { step: 'BROADCASTING' });
        return ctx.reply(t(userId, 'broadcasting', Object.keys(loadJson(USERS_FILE, {})).length), KB.cancel(lang));
    }

    if (text.includes('📊') || text.includes('Statistika') || text.includes('Статистика') || text.includes('Statistics')) {
        const users = loadJson(USERS_FILE, {});
        const payments = loadJson(PAYMENTS_FILE, []);
        const orders = loadJson(ORDERS_FILE, []);
        const totalRevenue = payments.filter(p=>p.status==='approved').reduce((s,p)=>s+p.amount,0);
        const byType = {};
        orders.forEach(o => { byType[o.type] = (byType[o.type]||0)+1; });
        let msg = `📊 ${lang === 'ru' ? 'Статистика' : lang === 'en' ? 'Statistics' : lang === 'id' ? 'Statistik' : 'Statistika'}\n\n👥 ${Object.keys(users).length}\n💵 ${totalRevenue.toLocaleString()} ${t(userId, 'currency')}\n📋 ${orders.length}\n\n${lang === 'ru' ? 'По типам' : lang === 'en' ? 'By type' : lang === 'id' ? 'Menurut jenis' : 'Turlari bo\'yicha'}:\n`;
        Object.entries(byType).forEach(([k,v]) => msg += `  ${k}: ${v}\n`);
        return ctx.reply(msg);
    }
});

// --- ASOSIY MENYU QAYTISH ---
bot.hears([/◀️ .*/, '◀️ Asosiy Menyu', '◀️ Главное меню', '◀️ Main Menu', '◀️ Menu Utama'], async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    updateUser(userId, { step: 'MAIN_MENU' });
    return ctx.reply(t(userId, 'mainMenu'), KB.mainMenu(lang, userId === ADMIN_ID));
});


// ==================== ADMIN KOMANDALAR ====================
bot.command('pending', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const lang = getLang(ADMIN_ID);
    const pending = getPendingPayments();
    if (!pending.length) return ctx.reply(t(ADMIN_ID, 'noPendingPayments'));
    let msg = `💰 ${lang === 'ru' ? 'Ожидающие платежи' : lang === 'en' ? 'Pending payments' : lang === 'id' ? 'Pembayaran tertunda' : 'Kutilayotgan to\'lovlar'}:\n\n`;
    pending.forEach(p => {
        const u = getUser(p.userId);
        msg += `ID: ${p.id}\nKim: ${u?.name||'?'} ${u?.surname||''}\nSumma: ${p.amount.toLocaleString()} ${t(ADMIN_ID, 'currency')}\nTuri: ${p.type}\nTasdiqlash: /approve ${p.id}\n\n`;
    });
    return ctx.reply(msg);
});

bot.command('approve', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const lang = getLang(ADMIN_ID);
    const paymentId = ctx.message.text.split(' ')[1];
    if (!paymentId) return ctx.reply(t(ADMIN_ID, 'approveFormatError'));
    const p = approvePayment(paymentId);
    if (!p) return ctx.reply(t(ADMIN_ID, 'approveNotFound'));
    const newUser = getUser(p.userId);
    try {
        await bot.telegram.sendMessage(p.userId, t(p.userId, 'payApproved', p.amount, newUser.balance), KB.mainMenu(getLang(p.userId), false));
    } catch (_) {}
    return ctx.reply(t(ADMIN_ID, 'paymentApprovedAdmin', p.userId, p.amount));
});

bot.command('balance', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const lang = getLang(ADMIN_ID);
    const [, targetId, amount] = ctx.message.text.split(' ');
    if (!targetId || !amount || isNaN(+amount)) return ctx.reply(t(ADMIN_ID, 'balanceFormatError'));
    const u = getUser(parseInt(targetId));
    updateUser(parseInt(targetId), { balance: (u.balance||0) + parseInt(amount) });
    try { await bot.telegram.sendMessage(parseInt(targetId), t(parseInt(targetId), 'balanceAdminAdd', parseInt(amount))); } catch (_) {}
    return ctx.reply(`✅ ${targetId}: +${parseInt(amount).toLocaleString()} ${t(ADMIN_ID, 'currency')}`);
});

bot.command('stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const lang = getLang(ADMIN_ID);
    const users = loadJson(USERS_FILE, {});
    const orders = loadJson(ORDERS_FILE, []);
    const payments = loadJson(PAYMENTS_FILE, []);
    const rev = payments.filter(p=>p.status==='approved').reduce((s,p)=>s+p.amount,0);
    return ctx.reply(t(ADMIN_ID, 'adminStats', Object.keys(users).length, orders.length, rev));
});

bot.command('reset', async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(userId);
    updateUser(userId, { step: 'MAIN_MENU' });
    return ctx.reply(t(userId, 'restored'), KB.mainMenu(lang, userId === ADMIN_ID));
});

// ==================== RASM HANDLER (MULTI-TILLI) ====================
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    const lang = getLang(userId);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];


    // ==================== KOLLAJ RASM QABUL ====================
    if (user.step === 'COLLAGE_WAITING') {
        if (!ctx.session.collageImages) ctx.session.collageImages = [];
        try {
            const fileLink = await ctx.telegram.getFileLink(photo.file_id);
            const imgRes = await fetch(fileLink.href);
            const imgBuf = Buffer.from(await imgRes.arrayBuffer());
            const tmpPath = path.join(TEMP_DIR, `coll_${userId}_${Date.now()}.jpg`);
            fs.writeFileSync(tmpPath, imgBuf);
            ctx.session.collageImages.push(tmpPath);
        } catch(e) {
            return ctx.reply('😔 Rasm yuklab olishda xato. Qayta yuboring.');
        }
        const n = ctx.session.collageImages.length;
        if (n >= 4) {
            return buildAndSendCollage(ctx, userId);
        }
        return ctx.reply(
            `✅ ${n}-rasm qabul qilindi!\n\n` +
            `${4 - n} ta yana yuboring yoki "Kollaj Yaratish" bosing.`,
            Markup.keyboard([
                [`📄 Kollaj Yaratish`],
                [`❌ ${T[getLang(userId)]?.cancel || T.uz.cancel}`]
            ]).resize()
        );
    }

    // SLAYD uchun /pic rasm qabul qilish
    if (user.step === 'SLAYD_PIC_WAIT') {
        try {
            const fileLink = await ctx.telegram.getFileLink(photo.file_id);
            const imgPath = path.join(TEMP_DIR, `user_pic_${userId}_${Date.now()}.jpg`);
            await new Promise((resolve, reject) => {
                const proto = fileLink.href.startsWith('https') ? require('https') : require('http');
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
            console.error('Pic yuklash xato:', e.message);
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
                    caption: t(ADMIN_ID, 'newPaymentNotify', user.name, user.surname, userId, payType, amount, payment.id)
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
            console.error('Rasm yuklash xato:', e.message);
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
        console.error('PDF yaratish xato:', err.message);
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId === ADMIN_ID));
    }
}


async function buildAndSendCollage(ctx, userId) {
    const lang = getLang(userId);
    const images = ctx.session.collageImages || [];
    if (images.length < 2) {
        return ctx.reply(
            `📸 Kamida 2 ta rasm kerak!\nHozir: ${images.length} ta.`,
            Markup.keyboard([[`📄 Kollaj Yaratish`], [`❌ ${T[lang]?.cancel || T.uz.cancel}`]]).resize()
        );
    }
    const title = ctx.session.collageTitle || null;
    await ctx.reply(`⏳ Kollaj tayyorlanmoqda...\n\n🖼 ${images.length} ta rasm birlashtirilmoqda...`);
    try {
        const pdfPath = await makeCollagePdf(images, title, userId);
        const caption = `✅ Kollaj tayyor! 🎉\n\n` +
            `🖼 ${images.length} ta rasm\n` +
            `${title ? `📌 Sarlavha: "${title}"\n` : ''}` +
            `💰 BEPUL`;
        await ctx.replyWithDocument({ source: pdfPath }, { caption });
        addOrder(userId, 'collage', { count: images.length, title, price: 0 });
        images.forEach(p => { try { fs.unlinkSync(p); } catch(_) {} });
        try { fs.unlinkSync(pdfPath); } catch(_) {}
        ctx.session.collageImages = [];
        ctx.session.collageTitle = null;
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('✅ Bajarildi!', KB.mainMenu(lang, userId === ADMIN_ID));
    } catch(err) {
        console.error('Kollaj xato:', err.message);
        images.forEach(p => { try { fs.unlinkSync(p); } catch(_) {} });
        ctx.session.collageImages = [];
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId === ADMIN_ID));
    }
}

// ==================== YORDAMCHI: TO'LOV TEKSHIRISH ====================
async function checkAndDeductBalance(ctx, userId, price, nextStep) {
    const user = getUser(userId);
    const lang = getLang(userId);
    if ((user.balance || 0) < price) {
        ctx.session.neededAmount = price;
        ctx.session.afterPaymentStep = nextStep;
        updateUser(userId, { step: 'NEED_PAYMENT' });
        return ctx.reply(t(userId, 'lowBalance', price, user.balance || 0), KB.payment(lang));
    }
    return null;
}

// ==================== ASOSIY MATN HANDLER (MULTI-TILLI) ====================
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    let user = getUser(userId);
    const text = ctx.message.text;
    const lang = getLang(userId);

    // Registratsiya
    if (!user.registered) {
        if (user.step === 'WAITING_NAME') {
            if (text.length < 2) return ctx.reply(t(userId, 'nameTooShort'));
            updateUser(userId, { name: text, step: 'WAITING_SURNAME' });
            return ctx.reply(t(userId, 'enterSurname', text), KB.cancel(lang));
        }
        if (user.step === 'WAITING_SURNAME') {
            const cancelWords = ['Bekor', 'Отмена', 'Cancel', 'Batal'];
            if (cancelWords.some(w => text.includes(w))) { updateUser(userId, { step: 'WAITING_NAME' }); return ctx.reply(t(userId, 'enterName')); }
            if (text.length < 2) return ctx.reply(t(userId, 'surnameTooShort'));
            updateUser(userId, { surname: text, registered: true, step: 'MAIN_MENU', freeUsed: 0 });
            user = getUser(userId);
            return ctx.reply(t(userId, 'registered', user.name, FREE_SLIDES), KB.mainMenu(lang, userId === ADMIN_ID));
        }
        if (user.step === 'LANG_SELECT') return ctx.reply(t(userId, 'welcome'), KB.langSelect());
        return;
    }

    // Bekor qilish
    const cancelWords = ['Bekor', 'Отмена', 'Cancel', 'Batal'];
    const isCancel = text === `❌ ${t(userId, 'cancel')}` || cancelWords.some(w => text.includes(w));
    if (isCancel && user.step !== 'MAIN_MENU') {
        ctx.session.pdfImages = [];
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'cancelDone'), KB.mainMenu(lang, userId === ADMIN_ID));
    }

    // ====== SLAYD ======
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

        const isFree = isSummerFree() || (user.freeUsed || 0) < FREE_SLIDES;
        const paket = getPaket(count, isFree, lang);
        const price = isFree ? 0 : paket.narx;
        ctx.session.slidePrice = price;

        if (!isFree && (user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            ctx.session.afterPaymentStep = 'SLAYD_TEMPLATE';
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(t(userId, 'lowBalance', price, user.balance || 0), KB.payment(lang));
        }

        updateUser(userId, { step: 'SLAYD_TEMPLATE' });
        return ctx.reply(t(userId, 'slidePackageInfo', ctx.session.topic, count, price, paket, isFree), KB.templateMenu(lang));
    }

    if (user.step === 'SLAYD_TEMPLATE') {
        // Shablonlarni ko'rish
        const viewLabels = ['ko\'rish', 'Посмотреть', 'View', 'Lihat'];
        if (viewLabels.some(v => text.toLowerCase().includes(v.toLowerCase()))) {
            const channelLink = process.env.CHANNEL_LINK || `https://t.me/${CHANNEL_USERNAME}`;
            const siteLink = process.env.SITE_LINK || 'https://sardorsherqobilogli-art.github.io/slidetop01_bot-';
            return ctx.reply(
                `🎨 50 ta premium shablon mavjud!\n\n📲 Ko'rish uchun:\n1️⃣ Kanal: ${channelLink}\n2️⃣ Sayt: ${siteLink}\n\n✅ Ko'rib chiqqach, shablon raqamini yuboring (1-50)\n💡 Yoki quyidagi usullardan birini tanlang:`,
                KB.templateMenu(lang)
            );
        }

        // AI Rasm — 1-Sentabrga qadar yopiq
        const aiLabels = ['AI Rasm', 'AI Фото', 'AI Image', 'Gambar AI', '1-Sentabr', '1 Сентября', 'Sep 1', '1 Sep'];
        if (aiLabels.some(v => text.includes(v))) {
            return ctx.reply(
                `🤖 AI Rasm Yaratish\n\n⏳ Bu bo'lim hozircha tayyorlanmoqda.\n🗓 Ochilish sanasi: 1-Sentabr 2025\n\n✅ Hozircha quyidagi usullardan foydalaning:\n📋 Oddiy Shablon\n📈 Diagrammali\n🖼 /pic — O'z rasmingiz`,
                KB.templateMenu(lang)
            );
        }

        // Diagrammali shablon
        const chartLabels = ['Diagramma', 'диаграмм', 'Chart', 'Diagram'];
        if (chartLabels.some(v => text.includes(v))) {
            ctx.session.slideType = 'chart';
            ctx.session.templateId = null;
            ctx.session.templateId2 = null;
            return doCreateSlide(ctx, userId);
        }

        // /pic — foydalanuvchi rasm yuboradi
        const picLabels = ['/pic', 'Rasmim', 'Фото', 'My Photo', 'Foto Saya'];
        if (picLabels.some(v => text.includes(v))) {
            ctx.session.slideType = 'pic';
            ctx.session.templateId = null;
            ctx.session.templateId2 = null;
            updateUser(userId, { step: 'SLAYD_PIC_WAIT' });
            return ctx.reply(
                `🖼 Rasmingizni yuboring!\n\n📌 Mavzu: ${ctx.session.topic}\n\n✅ 1 ta rasm yuboring — slaydning muqova qismiga qo'yiladi.\n💡 Yaxshi rasm: 16:9 nisbat, aniq, yorqin`,
                KB.cancel(lang)
            );
        }

        // Oddiy shablon yoki shablon raqami
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

    // SLAYD_PIC_WAIT — matn kelsa eslatma
    if (user.step === 'SLAYD_PIC_WAIT') {
        return ctx.reply(
            `📸 Iltimos, rasm (foto) yuboring.\nMatn emas — rasm kerak!`,
            KB.cancel(lang)
        );
    }

    // ====== PDF ======

    // ====== KOLLAJ SARLAVHA ======
    if (user.step === 'COLLAGE_TITLE') {
        const skipWords = ["O'tkazib", 'Пропустить', 'Skip', 'Lewati'];
        if (skipWords.some(w => text.includes(w))) {
            ctx.session.collageTitle = null;
        } else {
            ctx.session.collageTitle = text.trim();
        }
        ctx.session.collageImages = [];
        updateUser(userId, { step: 'COLLAGE_WAITING' });
        return ctx.reply(
            `🖼 Ajoyib!\n\n` +
            `${ctx.session.collageTitle ? `📌 Sarlavha: "${ctx.session.collageTitle}"\n\n` : ''}` +
            `Endi rasmlarni yuboring (2-4 ta):\n\n` +
            `✅ 2 ta: pastma-past joylashadi\n` +
            `✅ 3 ta: bitta katta + ikkita kichik\n` +
            `✅ 4 ta: 2×2 grid\n\n` +
            `📸 Rasmlarni yuboring:`,
            Markup.keyboard([
                [`📄 Kollaj Yaratish`],
                [`❌ ${T[lang]?.cancel || T.uz.cancel}`]
            ]).resize()
        );
    }

    // ====== KOLLAJ TAYYOR TUGMASI ======
    if (user.step === 'COLLAGE_WAITING') {
        const doneWords = ['Kollaj Yaratish', 'Создать', 'Create', 'Buat'];
        if (doneWords.some(w => text.includes(w))) {
            return buildAndSendCollage(ctx, userId);
        }
        return ctx.reply(`📸 Rasmlarni yuboring yoki "Kollaj Yaratish" bosing.`);
    }

    if (user.step === 'PDF_WAITING') {
        const pdfCreateWords = ['PDF yaratish', 'Создать PDF', 'Create PDF', 'Buat PDF'];
        const addMoreWords = ['Yana rasm', 'Добавить фото', 'Add more', 'Tambah'];
        if (pdfCreateWords.some(w => text.includes(w))) return buildAndSendPdf(ctx, userId);
        if (addMoreWords.some(w => text.includes(w))) return ctx.reply(t(userId, 'pdfSendMore'));
        return ctx.reply(t(userId, 'pdfCreateOrSend'), KB.pdfMore(lang));
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
        const price = PRICES.test;
        if (!isSummerFree() && (user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(t(userId, 'lowBalance', price, user.balance||0), KB.payment(lang));
        }
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
        const price = PRICES.crossword;
        ctx.session.crossCount = count;
        if (!isSummerFree() && (user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(t(userId, 'lowBalance', price, user.balance||0), KB.payment(lang));
        }
        return doCreateCrossword(ctx, userId);
    }

    // ====== INSHO/ESSE ======
    if (user.step === 'ESSAY_TYPE') {
        const inshoWords = ['Insho', 'Сочинение', 'Composition', 'Karangan'];
        ctx.session.essayType = inshoWords.some(w => text.includes(w)) ? 'insho' : 'esse';
        updateUser(userId, { step: 'ESSAY_TOPIC' });
        return ctx.reply(t(userId, 'essayTopicPrompt', ctx.session.essayType, user.balance||0, PRICES.essay), KB.cancel(lang));
    }
    if (user.step === 'ESSAY_TOPIC') {
        if (text.length < 3) return ctx.reply(t(userId, 'topicTooShort'));
        ctx.session.essayTopic = text;
        updateUser(userId, { step: 'ESSAY_WORDS' });
        return ctx.reply(t(userId, 'enterWords'), KB.essayWords(lang));
    }
    if (user.step === 'ESSAY_WORDS') {
        const words = parseInt(text) || 500;
        const price = PRICES.essay;
        ctx.session.essayWords = words;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(t(userId, 'lowBalance', price, user.balance||0), KB.payment(lang));
        }
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
        const price = PRICES.referat;
        ctx.session.referatPages = pages;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(t(userId, 'lowBalance', price, user.balance||0), KB.payment(lang));
        }
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
        const price = PRICES.tezis;
        ctx.session.tezisPages = pages;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(t(userId, 'lowBalance', price, user.balance||0), KB.payment(lang));
        }
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
        const price = PRICES.maqola;
        ctx.session.maqolaPages = pages;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(t(userId, 'lowBalance', price, user.balance||0), KB.payment(lang));
        }
        return doCreateMaqola(ctx, userId);
    }

    // ====== INFOGRAFIKA ======
    if (user.step === 'INFO_TOPIC') {
        if (text.length < 3) return ctx.reply(t(userId, 'infoTooShort'));
        const price = PRICES.infografika;
        ctx.session.infoTopic = text;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(t(userId, 'lowBalance', price, user.balance||0), KB.payment(lang));
        }
        return doCreateInfo(ctx, userId);
    }

    // ====== RASM ======
    if (user.step === 'RASM_DESC') {
        const price = PRICES.rasm;
        ctx.session.rasmDesc = text;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(t(userId, 'lowBalance', price, user.balance||0), KB.payment(lang));
        }
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
        const adminWords = ['Admin', 'Админ', 'admin'];
        if (adminWords.some(w => text.includes(w))) {
            return ctx.reply(t(userId, 'adminContactInfo', ADMIN_USERNAME, ADMIN_PHONE));
        }
    }

    // ====== SOZLAMALAR ======
    if (user.step === 'EDIT_NAME') {
        if (text.length < 2) return ctx.reply(t(userId, 'nameTooShort'));
        updateUser(userId, { name: text, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'nameUpdated'), KB.mainMenu(lang, userId === ADMIN_ID));
    }
    if (user.step === 'EDIT_SURNAME') {
        if (text.length < 2) return ctx.reply(t(userId, 'surnameTooShort'));
        updateUser(userId, { surname: text, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'surnameUpdated'), KB.mainMenu(lang, userId === ADMIN_ID));
    }

    // ====== ADMIN MUROJAAT ======
    if (user.step === 'CONTACT_ADMIN') {
        if (ADMIN_ID) {
            try {
                await bot.telegram.sendMessage(ADMIN_ID,
                    t(ADMIN_ID, 'newContactMsg', user.name, user.surname, ctx.from.username||'', userId, text)
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
    if (!user.step || user.step === 'MAIN_MENU' || user.step === 'PAYMENT_PENDING') {
        return ctx.reply(t(userId, 'defaultReply'), KB.mainMenu(lang, userId === ADMIN_ID));
    }
});


// ==================== ISHLOV BERISHCHI FUNKSIYALAR (MULTI-TILLI) ====================

async function doCreateSlide(ctx, userId) {
    const user = getUser(userId);
    const lang = getLang(userId);
    const topic = ctx.session.topic;
    const count = ctx.session.slideCount || 5;
    const price = ctx.session.slidePrice || 0;
    const isFree = price === 0;
    const tmpl1 = ctx.session.templateId;
    const tmpl2 = ctx.session.templateId2;
    const isDual = !!(tmpl1 && tmpl2);
    const slideType = ctx.session.slideType || 'normal';
    const userPicPath = ctx.session.userPicPath || null;
    const paket = getPaket(count, isFree, lang);

    const processMsgs = {
        normal: `⏳ ${paket.emoji} ${paket.nom} tayyorlanmoqda...\n\n📋 Shablon tanlanmoqda\n🤖 AI matn yozmoqda\n🎨 Dizayn ishlanmoqda\n📎 Fayl tayyorlanmoqda\n\nBu 20-40 soniya davom etadi ⌛`,
        chart:  `⏳ ${paket.emoji} Diagrammali slayd tayyorlanmoqda...\n\n🤖 AI matn yozmoqda\n📈 Grafiklar chizilmoqda\n📊 Diagrammalar qo'shilmoqda\n\nBu 20-40 soniya davom etadi ⌛`,
        pic:    `⏳ ${paket.emoji} Rasmli slayd tayyorlanmoqda...\n\n🖼 Rasmingiz joylashtirilmoqda\n🤖 AI matn yozmoqda\n🎨 Dizayn ishlanmoqda\n\nBu 20-40 soniya davom etadi ⌛`,
    };
    await ctx.reply(processMsgs[slideType] || processMsgs.normal, { reply_markup: { remove_keyboard: true } });

    try {
        if (isFree) {
            updateUser(userId, { freeUsed: (user.freeUsed || 0) + 1 });
        } else {
            updateUser(userId, { balance: (user.balance || 0) - price });
        }

        const aiText = await aiSlides(topic, count, lang);
        if (!aiText) {
            if (!isFree) updateUser(userId, { balance: (user.balance || 0) + price });
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId === ADMIN_ID));
        }

        if (slideType === 'chart') {
            // DIAGRAMMALI
            const filePath = await makeChartSlidePptx(topic, aiText, userId, count, lang);
            await ctx.replyWithDocument({ source: filePath }, {
                caption: `✅ Diagrammali slayd tayyor! 🎉\n\n${paket.emoji} Paket: ${paket.nom}\n📌 Mavzu: ${topic}\n📊 ${count} ta slayd\n💰 ${isFree ? 'BEPUL' : price.toLocaleString()+' so\'m'}`
            });
            try { fs.unlinkSync(filePath); } catch(_) {}

        } else if (slideType === 'pic' && userPicPath && fs.existsSync(userPicPath)) {
            // RASMLI
            const filePath = await makeSlidePptx(topic, aiText, userId, count, tmpl1, lang, userPicPath);
            await ctx.replyWithDocument({ source: filePath }, {
                caption: `✅ Rasmli slayd tayyor! 🎉\n\n${paket.emoji} Paket: ${paket.nom}\n📌 Mavzu: ${topic}\n📊 ${count} ta slayd\n🖼 Sizning rasmingiz bilan\n💰 ${isFree ? 'BEPUL' : price.toLocaleString()+' so\'m'}`
            });
            try { fs.unlinkSync(filePath); } catch(_) {}
            try { fs.unlinkSync(userPicPath); } catch(_) {}

        } else if (isDual) {
            // 2 TA SHABLON
            const [file1, file2] = await Promise.all([
                makeSlidePptx(topic, aiText, userId, count, tmpl1, lang),
                makeSlidePptx(topic, aiText, userId, count, tmpl2, lang)
            ]);
            await ctx.replyWithDocument({ source: file1 }, { caption: `🎨 Variant 1 — Shablon #${tmpl1?.replace('template_','')||'A'}\n📌 ${topic}\n📊 ${count} ta slayd` });
            await ctx.replyWithDocument({ source: file2 }, { caption: `🎨 Variant 2 — Shablon #${tmpl2?.replace('template_','')||'B'}\n📌 ${topic}\n📊 ${count} ta slayd` });
            await ctx.reply(`✅ Ikkala variant tayyor! 🎉\n\n${paket.emoji} ${paket.nom}\n💰 ${isFree ? 'BEPUL' : price.toLocaleString()+' so\'m'}\n\nYoqqanini saqlang! 😊`);
            try { fs.unlinkSync(file1); } catch(_) {}
            try { fs.unlinkSync(file2); } catch(_) {}

        } else {
            // ODDIY
            const filePath = await makeSlidePptx(topic, aiText, userId, count, tmpl1, lang);
            await ctx.replyWithDocument({ source: filePath }, {
                caption: t(userId, 'slideReady1', paket, topic, count, price, isFree)
            });
            try { fs.unlinkSync(filePath); } catch(_) {}
        }

        ctx.session.slideType = null;
        ctx.session.userPicPath = null;
        ctx.session.templateId = null;
        ctx.session.templateId2 = null;

        addOrder(userId, 'slides', { topic, count, price, type: slideType, dual: isDual });
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        console.error('Slayd xato:', err.message);
        if (!isFree) updateUser(userId, { balance: (user.balance || 0) + price });
        ctx.session.slideType = null;
        ctx.session.userPicPath = null;
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId === ADMIN_ID));
    }
}

async function doCreateTest(ctx, userId) {
    const lang = getLang(userId);
    const user = getUser(userId);
    const topic = ctx.session.testTopic;
    const count = ctx.session.testCount || 10;
    const diff = ctx.session.testDiff || "O'rta";
    const price = PRICES.test;

    await ctx.reply(t(userId, 'creating'));
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiTest(topic, count, diff, lang);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID)); }
        const filePath = await makeTestPptx(topic, aiText, userId, count, diff, lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'testReady', topic, count, price) });
        addOrder(userId, 'test', { topic, count, diff, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        console.error('Test xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateCrossword(ctx, userId) {
    const lang = getLang(userId);
    const user = getUser(userId);
    const topic = ctx.session.crossTopic;
    const count = ctx.session.crossCount || 10;
    const price = PRICES.crossword;

    await ctx.reply(t(userId, 'creating'));
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiCrossword(topic, count, lang);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID)); }
        const filePath = await makeCrosswordPptx(topic, aiText, userId, count, lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'crossReady', topic, count, price) });
        addOrder(userId, 'krassvord', { topic, count, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        console.error('Krassvord xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateEssay(ctx, userId) {
    const lang = getLang(userId);
    const user = getUser(userId);
    const topic = ctx.session.essayTopic;
    const type = ctx.session.essayType || 'insho';
    const words = ctx.session.essayWords || 500;
    const price = PRICES.essay;

    await ctx.reply(t(userId, 'creating'));
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiEssay(topic, type, words, lang);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID)); }
        const filePath = await makeTextPptx(topic, aiText, userId, type === 'insho' ? 'Insho' : 'Esse', lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'essayReady', type, topic, words, price) });
        addOrder(userId, type, { topic, words, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        console.error('Essay xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateReferat(ctx, userId) {
    const lang = getLang(userId);
    const user = getUser(userId);
    const topic = ctx.session.referatTopic;
    const type = ctx.session.referatType || 'referat';
    const pages = ctx.session.referatPages || 10;
    const price = PRICES.referat;

    await ctx.reply(t(userId, 'creating'));
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiReferat(topic, type, pages, lang);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID)); }
        const filePath = await makeTextPptx(topic, aiText, userId, type === 'referat' ? 'Referat' : 'MustaqilIsh', lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'referatReady', type, topic, pages, price) });
        addOrder(userId, type, { topic, pages, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        console.error('Referat xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateTezis(ctx, userId) {
    const lang = getLang(userId);
    const user = getUser(userId);
    const topic = ctx.session.tezisTopic;
    const pages = ctx.session.tezisPages || 3;
    const price = PRICES.tezis;

    await ctx.reply(t(userId, 'creating'));
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiTezis(topic, pages, lang);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID)); }
        const filePath = await makeTextPptx(topic, aiText, userId, 'Tezis', lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'tezisReady', topic, pages, price) });
        addOrder(userId, 'tezis', { topic, pages, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        console.error('Tezis xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateMaqola(ctx, userId) {
    const lang = getLang(userId);
    const user = getUser(userId);
    const topic = ctx.session.maqolaTopic;
    const pages = ctx.session.maqolaPages || 3;
    const price = PRICES.maqola;

    await ctx.reply(t(userId, 'creating'));
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiMaqola(topic, pages, lang);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID)); }
        const filePath = await makeTextPptx(topic, aiText, userId, 'Maqola', lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'maqolaReady', topic, pages, price) });
        addOrder(userId, 'maqola', { topic, pages, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        console.error('Maqola xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateInfo(ctx, userId) {
    const lang = getLang(userId);
    const user = getUser(userId);
    const topic = ctx.session.infoTopic;
    const price = PRICES.infografika;

    await ctx.reply(t(userId, 'creating'));
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiInfografika(topic, lang);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID)); }
        const filePath = await makeInfoPptx(topic, aiText, userId, lang);
        await ctx.replyWithDocument({ source: filePath }, { caption: t(userId, 'infoReady', topic, price) });
        addOrder(userId, 'infografika', { topic, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'ratingPrompt'), KB.rating());
    } catch (err) {
        console.error('Infografika xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

async function doCreateRasm(ctx, userId) {
    const lang = getLang(userId);
    const user = getUser(userId);
    const desc = ctx.session.rasmDesc;
    const price = PRICES.rasm;

    await ctx.reply(t(userId, 'creating'));
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const prompt = await aiRasm(desc, lang);
        if (!prompt) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID)); }

        updateUser(userId, { step: 'MAIN_MENU' });
        addOrder(userId, 'rasm', { desc, price });
        return ctx.reply(t(userId, 'rasmReady', price, prompt), KB.mainMenu(lang, userId === ADMIN_ID));
    } catch (err) {
        console.error('Rasm xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(lang, userId===ADMIN_ID));
    }
}

// ==================== XATO HANDLER ====================
bot.catch((err, ctx) => {
    console.error('Bot xato:', err.message, '\nCtx:', ctx?.updateType);
    try {
        const userId = ctx?.from?.id;
        const lang = userId ? getLang(userId) : 'uz';
        ctx.reply(t(userId, 'unexpectedError')).catch(() => {});
    } catch (_) {}
});

// ==================== BOTNI ISHGA TUSHIRISH ====================
bot.launch()
    .then(() => console.log(t(0, 'botRunning')))
    .catch(err => { console.error(t(0, 'botError'), err); process.exit(1); });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Health check server
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SlaydTop Bot is running! ✅');
}).listen(process.env.PORT || 3000, () => console.log(`Health check: port ${process.env.PORT || 3000}`));
