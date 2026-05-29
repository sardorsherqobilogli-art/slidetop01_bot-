// ============================================================
//  SlaydTop Bot — To'liq versiya (BOT_BUYRUQ.md asosida)
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

// ==================== NARXLAR (BUYRUQQA MOS) ====================
const PRICES = {
    slide_small : 2000,   // 5-15 ta
    slide_big   : 3500,   // 16-25 ta
    test        : 2000,   // 10-20 savol
    crossword   : 1500,   // har qanday
    essay       : 1500,   // 500-1000 so'z
    referat     : 2500,   // 10-20 bet
    tezis       : 3000,   // 3-10 bet
    maqola      : 2500,   // 3-10 bet
    infografika : 1500,
    rasm        : 1000,
    pdf         : 0       // DOIMO BEPUL
};
const FREE_SLIDES = 1; // yangi foydalanuvchiga 1 ta bepul slayd

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
    }
};

// Hozircha faqat O'zbek tili to'liq, rus/eng uchun fallback
function t(userId, key, ...args) {
    const users = loadJson(USERS_FILE, {});
    const lang = users[userId]?.lang || 'uz';
    const fn = T[lang]?.[key] || T.uz[key];
    if (!fn) return key;
    return typeof fn === 'function' ? fn(...args) : fn;
}

// ==================== JSON YORDAMCHILAR ====================
function loadJson(filePath, def = {}) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) { console.error('loadJson xato:', filePath, e.message); }
    return def;
}
function saveJson(filePath, data) {
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); }
    catch (e) { console.error('saveJson xato:', filePath, e.message); }
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

// ==================== KLAVIATURALAR ====================
const KB = {
    langSelect: () => Markup.inlineKeyboard([
        [Markup.button.callback('🇺🇿 O\'zbek', 'lang_uz'), Markup.button.callback('🇷🇺 Русский', 'lang_ru'), Markup.button.callback('🇬🇧 English', 'lang_en')]
    ]),
    mainMenu: (isAdmin = false) => {
        const rows = [
            ['🆕 Slayd Yaratish', '📄 Rasmdan PDF'],
            ['📚 Referat/Mustaqil', '✍️ Insho/Esse'],
            ['📝 Test', '🔲 Krassvord'],
            ['🎓 Tezis', '📰 Maqola'],
            ['📊 Infografika', '🖼 Rasm Yaratish'],
            ['💰 Balansim', '🎁 Bepul olish'],
            ['❓ Yordam', '⚙️ Sozlamalar'],
        ];
        if (isAdmin) rows.push(['👨‍💻 Admin Panel']);
        return Markup.keyboard(rows).resize();
    },
    cancel: () => Markup.keyboard([['❌ Bekor qilish']]).resize(),
    slideCount: () => Markup.keyboard([
        ['1', '5', '7', '8'],
        ['10', '12', '15', '20'],
        ['25', '30', '❌ Bekor qilish']
    ]).resize(),
    templateMenu: () => Markup.keyboard([
        ['🖼 Shablonlarni ko\'rish'],
        ['✨ Shablonsiz (Oddiy)'],
        ['❌ Bekor qilish']
    ]).resize(),
    testCount: () => Markup.keyboard([
        ['10 ta', '15 ta', '20 ta'],
        ['❌ Bekor qilish']
    ]).resize(),
    difficulty: () => Markup.keyboard([
        ['🟢 Oson', '🟡 O\'rta', '🔴 Qiyin'],
        ['❌ Bekor qilish']
    ]).resize(),
    crosswordCount: () => Markup.keyboard([
        ['10 ta', '15 ta', '20 ta'],
        ['❌ Bekor qilish']
    ]).resize(),
    essayType: () => Markup.keyboard([
        ['📝 Insho', '📝 Esse'],
        ['❌ Bekor qilish']
    ]).resize(),
    essayWords: () => Markup.keyboard([
        ['500', '700', '1000'],
        ['❌ Bekor qilish']
    ]).resize(),
    referatType: () => Markup.keyboard([
        ['📚 Referat', '📑 Mustaqil Ish'],
        ['❌ Bekor qilish']
    ]).resize(),
    pageCount: () => Markup.keyboard([
        ['10 bet', '15 bet', '20 bet'],
        ['❌ Bekor qilish']
    ]).resize(),
    pageCountSmall: () => Markup.keyboard([
        ['3 bet', '5 bet', '7 bet', '10 bet'],
        ['❌ Bekor qilish']
    ]).resize(),
    payment: () => Markup.keyboard([
        ['💳 Click', '💳 Payme'],
        ['👨‍💻 Admin bilan bog\'lanish'],
        ['❌ Bekor qilish']
    ]).resize(),
    checkSend: () => Markup.keyboard([
        ['📸 Chek yuborish'],
        ['❌ Bekor qilish']
    ]).resize(),
    pdfMore: () => Markup.keyboard([
        ['➕ Yana rasm qo\'shish', '📄 PDF yaratish'],
        ['❌ Bekor qilish']
    ]).resize(),
    help: () => Markup.inlineKeyboard([
        [Markup.button.callback('📱 Bot ishlamayapti', 'help_bot')],
        [Markup.button.callback('💳 To\'lov muammosi', 'help_payment')],
        [Markup.button.callback('📄 Fayl kelmadi', 'help_file')],
        [Markup.button.callback('👨‍💻 Admin bilan bog\'lanish', 'help_admin')]
    ]),
    settings: () => Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Ismni o\'zgartirish', 'edit_name')],
        [Markup.button.callback('✏️ Familyani o\'zgartirish', 'edit_surname')],
        [Markup.button.callback('🌐 Tilni o\'zgartirish', 'edit_lang')]
    ]),
    rating: () => Markup.inlineKeyboard([[
        Markup.button.callback('⭐1', 'rate_1'),
        Markup.button.callback('⭐⭐2', 'rate_2'),
        Markup.button.callback('⭐⭐⭐3', 'rate_3'),
        Markup.button.callback('⭐⭐⭐⭐4', 'rate_4'),
        Markup.button.callback('⭐⭐⭐⭐⭐5', 'rate_5')
    ]]),
    adminPanel: () => Markup.keyboard([
        ['📋 To\'lovlar', '👥 Foydalanuvchilar'],
        ['📢 Xabar yuborish', '📊 Statistika'],
        ['◀️ Asosiy Menyu']
    ]).resize()
};

// ==================== GROQ AI ====================
async function groqAI(prompt, systemMsg = "Siz qoidalarga qat'iy amal qiladigan yordamchisiz. Faqat berilgan formatda javob bering.") {
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

// ==================== AI KONTENT FUNKSIYALARI ====================
async function aiSlides(topic, count) {
    return groqAI(`"${topic}" mavzusida ${count} ta slayd uchun professional reja tayyorlang.

FORMAT (qat'iy):
SLIDE: Sarlavha | Batafsil matn (3-5 gap)
...

Jami ${count} ta SLIDE: bo'lishi SHART. O'zbek tilida.`);
}

async function aiTest(topic, count, diff) {
    return groqAI(`"${topic}" mavzusida ${count} ta test savoli yarating. Qiyinlik: ${diff}

FORMAT:
TEST: 1 | Savol matni | A) ... | B) ... | C) ... | D) ... | To'g'ri: A
...
Jami ${count} ta TEST: O'zbek tilida.`);
}

async function aiCrossword(topic, count) {
    return groqAI(`"${topic}" mavzusida ${count} ta krassvord savoli tayyorlang.

FORMAT:
SAVOL: 1 | Savol matni | JAVOB
...
JAVOB — lotin harflarda, bo'shliqsiz, 3-15 harf. Jami ${count} ta SAVOL: O'zbek tilida.`);
}

async function aiEssay(topic, type, words) {
    return groqAI(`"${topic}" mavzusida ${words} so'zdan iborat ${type === 'insho' ? 'insho' : 'esse'} yozing. Kirish, asosiy qism, xulosa bo'lsin. O'zbek tilida.`);
}

async function aiReferat(topic, type, pages) {
    return groqAI(`"${topic}" mavzusida ${pages} betlik ${type} tayyorlang.

FORMAT:
BET: 1 | Muqova | ...
BET: 2 | Reja | ...
BET: 3 | Kirish | ...
BET: N | ... | ...
Jami ${pages} ta BET: O'zbek tilida.`);
}

async function aiTezis(topic, pages) {
    return groqAI(`"${topic}" mavzusida ${pages} betlik konferensiya tezisi yozing. Ilmiy uslub. O'zbek tilida.`);
}

async function aiMaqola(topic, pages) {
    return groqAI(`"${topic}" mavzusida ${pages} betlik maqola yozing. Ilmiy-publitsistik uslub. O'zbek tilida.`);
}

async function aiInfografika(topic) {
    return groqAI(`"${topic}" haqida infografika uchun 8-10 ta qisqa, statistik va faktli ma'lumot tayyorlang.
FORMAT:
FAKT: Qisqa matn (raqam yoki %)
...
O'zbek tilida.`);
}

async function aiRasm(description) {
    // Groq orqali tasvirni so'z bilan tavsiflash (Telegram uchun platseholder)
    return groqAI(`Quyidagi tavsif asosida professional badiiy tasvir uchun batafsil inglizcha prompt yozing (Stable Diffusion uchun):
"${description}"
Faqat prompt-ni yozing, boshqa narsa yozmang.`);
}

// ==================== PPTX YARATUVCHILAR ====================
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

async function makeSlidePptx(topic, aiText, userId, slideCount, templateId) {
    const pptx = new PptxGenJS();
    const user = getUser(userId);
    const clr = randColor();
    pptx.layout = 'LAYOUT_16x9';
    pptx.title = topic;

    // Muqova
    const cover = pptx.addSlide();
    cover.background = { color: clr.primary };
    cover.addText(topic, { x: 0.5, y: 1.5, w: '90%', fontSize: 34, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Arial' });
    cover.addText(`Tayyorladi: ${user.name || 'Foydalanuvchi'} ${user.surname || ''}\nSlaydTop AI`, {
        x: 0.5, y: 3.4, w: '90%', fontSize: 14, color: 'E0E0E0', align: 'center'
    });
    cover.addShape(pptx.ShapeType.line, { x: 2, y: 3.2, w: 6, h: 0, line: { color: 'FFFFFF', width: 2 } });

    // Slaydlar
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
        sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: clr.primary } });
        sl.addText(title || `${topic} — ${i+1}`, { x: 0.5, y: 0.25, w: '90%', fontSize: 22, bold: true, color: 'FFFFFF' });
        if (content) sl.addText(content, { x: 0.5, y: 1.4, w: '90%', fontSize: 15, color: clr.text, lineSpacing: 26 });
        sl.addText(`${i+1} / ${limit}`, { x: 8.5, y: 5.0, w: 1, fontSize: 9, color: '999999', align: 'right' });
    }

    const filePath = path.join(TEMP_DIR, `Slayd_${userId}_${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: filePath });
    return filePath;
}

async function makeTestPptx(topic, aiText, userId, testCount, difficulty) {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';

    const tests = aiText.split(/TEST:/i).map(s => s.trim()).filter(s => s.length > 5);
    const items = [];
    tests.forEach(t => {
        const p = t.split('|').map(x => x.trim());
        if (p.length >= 6) items.push({ q: p[1], opts: p.slice(2, 6), ans: p[6] || '' });
    });
    const limit = Math.min(items.length, testCount);

    const cover = pptx.addSlide();
    cover.background = { color: '4A148C' };
    cover.addText('TEST', { x: 0.5, y: 1.2, w: '90%', fontSize: 38, bold: true, color: 'FFFFFF', align: 'center' });
    cover.addText(`Mavzu: ${topic}\nDaraja: ${difficulty}\n${limit} ta savol`, { x: 0.5, y: 2.5, w: '90%', fontSize: 16, color: 'E1BEE7', align: 'center' });

    for (let i = 0; i < limit; i += 2) {
        const sl = pptx.addSlide();
        sl.background = { color: 'F3E5F5' };
        sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.85, fill: { color: '7B1FA2' } });
        sl.addText(`Savollar ${i+1}–${Math.min(i+2, limit)}`, { x: 0.5, y: 0.2, w: '90%', fontSize: 16, bold: true, color: 'FFFFFF' });
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
    ans.addText('Javoblar Kaliti', { x: 0.5, y: 0.28, w: '90%', fontSize: 22, bold: true, color: 'FFFFFF' });
    let keyText = '';
    items.slice(0, limit).forEach((it, i) => { const m = it.ans?.match(/[A-D]/); keyText += `${i+1}. ${m?m[0]:'?'}   `; if ((i+1)%5===0) keyText+='\n'; });
    ans.addText(keyText, { x: 0.5, y: 1.4, w: '90%', fontSize: 16, color: '333333', lineSpacing: 28 });

    const filePath = path.join(TEMP_DIR, `Test_${userId}_${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: filePath });
    return filePath;
}

async function makeCrosswordPptx(topic, aiText, userId, count) {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';

    const qs = aiText.split(/SAVOL:/i).map(s => s.trim()).filter(s => s.length > 3);
    const items = [];
    qs.forEach(q => {
        const p = q.split('|').map(x => x.trim());
        if (p.length >= 2) items.push({ text: p[1] || p[0], answer: (p[2] || '').toUpperCase().replace(/\s/g,'') });
    });
    const limit = Math.min(items.length, count);

    const cover = pptx.addSlide();
    cover.background = { color: '1B5E20' };
    cover.addText('KRASSVORD', { x: 0.5, y: 1.2, w: '90%', fontSize: 36, bold: true, color: 'FFFFFF', align: 'center' });
    cover.addText(`Mavzu: ${topic}\n${limit} ta savol\nSlaydTop AI`, { x: 0.5, y: 2.5, w: '90%', fontSize: 14, color: 'C8E6C9', align: 'center' });

    const qSlide = pptx.addSlide();
    qSlide.background = { color: 'E8F5E9' };
    qSlide.addText('Savollar ro\'yxati', { x: 0.5, y: 0.3, w: '90%', fontSize: 22, bold: true, color: '1B5E20' });
    qSlide.addText(items.slice(0, limit).map((q,i) => `${i+1}. ${q.text}`).join('\n'), { x: 0.5, y: 1.0, w: '90%', fontSize: 14, color: '333333', lineSpacing: 22 });

    const ansSlide = pptx.addSlide();
    ansSlide.background = { color: 'E3F2FD' };
    ansSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: '1565C0' } });
    ansSlide.addText('Javoblar Kaliti', { x: 0.5, y: 0.28, w: '90%', fontSize: 22, bold: true, color: 'FFFFFF' });
    ansSlide.addText(items.slice(0, limit).map((q,i) => `${i+1}. ${q.answer} (${q.answer.length} harf)`).join('\n'), { x: 0.5, y: 1.3, w: '90%', fontSize: 14, color: '333333', lineSpacing: 22 });

    const filePath = path.join(TEMP_DIR, `Krassvord_${userId}_${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: filePath });
    return filePath;
}

async function makeTextPptx(title, content, userId, type) {
    const pptx = new PptxGenJS();
    const clr = randColor();
    pptx.layout = 'LAYOUT_16x9';

    const cover = pptx.addSlide();
    cover.background = { color: clr.primary };
    cover.addText(title.toUpperCase(), { x: 0.5, y: 1.3, w: '90%', fontSize: 36, bold: true, color: 'FFFFFF', align: 'center' });

    const user = getUser(userId);
    cover.addText(`Bajardi: ${user.name || ''} ${user.surname || ''}\nSlaydTop AI`, { x: 0.5, y: 3.0, w: '90%', fontSize: 14, color: 'E0E0E0', align: 'center' });

    // BET bo'yicha ajratish (referat/tezis/maqola)
    if (content.includes('BET:')) {
        const pages = content.split(/BET:/i).map(s => s.trim()).filter(s => s.length > 3);
        pages.forEach((pg, i) => {
            const p = pg.split('|').map(x => x.trim());
            const pgTitle = p[1] || `Sahifa ${i+1}`;
            const pgContent = p.slice(2).join('\n') || p[0];
            const sl = pptx.addSlide();
            sl.background = { color: clr.bg };
            sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.0, fill: { color: clr.primary } });
            sl.addText(pgTitle, { x: 0.5, y: 0.25, w: '90%', fontSize: 20, bold: true, color: 'FFFFFF' });
            sl.addText(pgContent, { x: 0.5, y: 1.2, w: '90%', fontSize: 13, color: clr.text, lineSpacing: 22 });
            sl.addText(`${i+1}`, { x: 8.5, y: 5.0, w: 1, fontSize: 9, color: '999999', align: 'right' });
        });
    } else {
        // To'liq matn — 1 yoki bir necha slaydga bo'lib
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

async function makeInfoPptx(topic, aiText, userId) {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    const clr = { primary: '006064', bg: 'E0F7FA', text: '004D40' };

    const cover = pptx.addSlide();
    cover.background = { color: clr.primary };
    cover.addText('📊 INFOGRAFIKA', { x: 0.5, y: 1.2, w: '90%', fontSize: 32, bold: true, color: 'FFFFFF', align: 'center' });
    cover.addText(topic, { x: 0.5, y: 2.5, w: '90%', fontSize: 20, color: 'B2EBF2', align: 'center' });
    cover.addText('SlaydTop AI', { x: 0.5, y: 3.5, w: '90%', fontSize: 12, color: '80DEEA', align: 'center' });

    const facts = aiText.split(/FAKT:/i).map(s => s.trim()).filter(s => s.length > 3);

    // Har 4 faktga 1 slayd
    for (let i = 0; i < facts.length; i += 4) {
        const sl = pptx.addSlide();
        sl.background = { color: clr.bg };
        sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.9, fill: { color: clr.primary } });
        sl.addText(`${topic} — Faktlar`, { x: 0.5, y: 0.2, w: '90%', fontSize: 18, bold: true, color: 'FFFFFF' });

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
async function imagesToPdf(imagePaths, userId) {
    return new Promise(async (resolve, reject) => {
        try {
            const pdfPath = path.join(TEMP_DIR, `PDF_${userId}_${Date.now()}.pdf`);
            const doc = new PDFDocument({ autoFirstPage: false, margin: 20 });
            const writeStream = fs.createWriteStream(pdfPath);
            doc.pipe(writeStream);

            for (const imgPath of imagePaths) {
                try {
                    // Jimp bilan o'lchov olish
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

                    // JPEG sifatida temp saqlash (pdfkit uchun)
                    const convertedPath = imgPath + '_conv.jpg';
                    await jimpImg.quality(85).writeAsync(convertedPath);

                    doc.addPage({ size: 'A4', margin: 0 });
                    const x = (pageW - drawW) / 2;
                    const y = (pageH - drawH) / 2;
                    doc.image(convertedPath, x, y, { width: drawW, height: drawH });

                    // Temp faylni tozalash
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

// ==================== REACTION MIDDLEWARE (👍 avtomatik) ====================
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
            // Har 5 do'stda 3000 so'm
            if (newCount % 5 === 0) {
                updateUser(inviterId, { balance: (inv.balance || 0) + 3000 });
                try { await bot.telegram.sendMessage(inviterId, `🎁 5 ta do'stingiz qo'shildi! Balansingizga 3,000 so'm qo'shildi! 🎉`); } catch (_) {}
            }
        }
    }

    if (!user.registered) {
        updateUser(userId, { step: 'LANG_SELECT' });
        return ctx.reply(T.uz.welcome, KB.langSelect());
    }

    return ctx.reply(T.uz.mainMenu, KB.mainMenu(userId === ADMIN_ID));
});

// ==================== TIL TANLASH CALLBACK ====================
bot.action(/lang_(uz|ru|en)/, async (ctx) => {
    const lang = ctx.match[1];
    const userId = ctx.from.id;
    updateUser(userId, { lang, step: 'WAITING_NAME' });
    await ctx.answerCbQuery();
    await ctx.editMessageText('✅');
    return ctx.reply(T.uz.enterName);
});

// ==================== BAHOLASH CALLBACK ====================
bot.action(/rate_(\d)/, async (ctx) => {
    const r = parseInt(ctx.match[1]);
    const userId = ctx.from.id;
    await ctx.answerCbQuery(`⭐ ${r} ta yulduz! Rahmat!`);
    try { await ctx.editMessageReplyMarkup({}); } catch (_) {}
    await ctx.reply(T.uz.rateThank(r), KB.mainMenu(userId === ADMIN_ID));
});

// ==================== YORDAM CALLBACK ====================
bot.action('help_bot', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`🔄 /start bosing yoki /reset komandasini yuboring.\n\nAgar muammo davom etsa, @${CHANNEL_USERNAME} ga yozing.`);
});
bot.action('help_payment', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`💳 To'lov muammosi uchun adminga murojaat qiling: @${ADMIN_USERNAME}\nTel: ${ADMIN_PHONE}`);
});
bot.action('help_file', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`📄 Fayl kelmagan bo'lsa, /start bosing va qayta urinib ko'ring.\nAdmin: @${ADMIN_USERNAME}`);
});
bot.action('help_admin', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    updateUser(userId, { step: 'CONTACT_ADMIN' });
    await ctx.reply(T.uz.adminMsg, KB.cancel());
});

// ==================== SOZLAMALAR CALLBACK ====================
bot.action('edit_name', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    updateUser(userId, { step: 'EDIT_NAME' });
    await ctx.reply('✏️ Yangi ismingizni kiriting:', KB.cancel());
});
bot.action('edit_surname', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    updateUser(userId, { step: 'EDIT_SURNAME' });
    await ctx.reply('✏️ Yangi familyangizni kiriting:', KB.cancel());
});
bot.action('edit_lang', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    updateUser(userId, { step: 'LANG_SELECT' });
    await ctx.reply(T.uz.welcome, KB.langSelect());
});

// ==================== ASOSIY MENYU HANDLERLARI ====================

// --- BALANS ---
bot.hears('💰 Balansim', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    return ctx.reply(T.uz.balance(user), KB.mainMenu(userId === ADMIN_ID));
});

// --- BEPUL OLISH ---
bot.hears('🎁 Bepul olish', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    return ctx.reply(T.uz.free(userId, BOT_USERNAME) + `\n\n👥 Taklif qilganlar: ${user.invitedCount || 0} ta`, KB.mainMenu(userId === ADMIN_ID));
});

// --- YORDAM ---
bot.hears('❓ Yordam', async (ctx) => {
    const userId = ctx.from.id;
    return ctx.reply(T.uz.help, KB.help());
});

// --- SOZLAMALAR ---
bot.hears('⚙️ Sozlamalar', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    return ctx.reply(T.uz.settings(user), KB.settings());
});

// --- SLAYD YARATISH ---
bot.hears('🆕 Slayd Yaratish', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    const freeLeft = Math.max(0, FREE_SLIDES - (user.freeUsed || 0));
    updateUser(userId, { step: 'SLAYD_TOPIC' });
    return ctx.reply(
        `✨ Slayd Yaratish\n\n` +
        `💰 Balansingiz: ${(user.balance||0).toLocaleString()} so'm\n\n` +
        `📦 Paketlar:\n` +
        `🎁 Sinov       — BEPUL (1 ta slayd)\n` +
        `⚡ Iqtidor     — 2,000 so'm (5–12 ta)\n` +
        `💎 Professional — 3,500 so'm (13–20 ta)\n` +
        `👑 Premium     — 6,000 so'm (21–30 ta)\n` +
        `🌟 Infinity    — 50,000 so'm/oy (cheksiz)\n\n` +
        (freeLeft > 0 ? `🎁 Sizda ${freeLeft} ta bepul slayd bor!\n\n` : '') +
        `📌 Mavzuni kiriting:`,
        KB.cancel()
    );
});

// --- RASMDAN PDF ---
bot.hears('📄 Rasmdan PDF', async (ctx) => {
    const userId = ctx.from.id;
    if (!getUser(userId).registered) return;
    ctx.session.pdfImages = [];
    updateUser(userId, { step: 'PDF_WAITING' });
    return ctx.reply(T.uz.pdfFree, KB.cancel());
});

// --- REFERAT / MUSTAQIL ---
bot.hears('📚 Referat/Mustaqil', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    updateUser(userId, { step: 'REFERAT_TYPE' });
    return ctx.reply(
        `📚 Referat yoki Mustaqil Ish?\n\n💰 Balans: ${(user.balance||0).toLocaleString()} so'm\n📌 Narx: 2,500 so'm (10-20 bet)`,
        KB.referatType()
    );
});

// --- INSHO / ESSE ---
bot.hears('✍️ Insho/Esse', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    updateUser(userId, { step: 'ESSAY_TYPE' });
    return ctx.reply(
        `✍️ Insho yoki Esse?\n\n💰 Balans: ${(user.balance||0).toLocaleString()} so'm\n📌 Narx: 1,500 so'm (500-1000 so'z)`,
        KB.essayType()
    );
});

// --- TEST ---
bot.hears('📝 Test', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    updateUser(userId, { step: 'TEST_TOPIC' });
    return ctx.reply(
        `📝 Test Yaratish\n\n💰 Balans: ${(user.balance||0).toLocaleString()} so'm\n📌 Narx: 2,000 so'm (10-20 savol)\n\nTest mavzusini kiriting:\n(Masalan: Biologiya — O'simliklar)`,
        KB.cancel()
    );
});

// --- KRASSVORD ---
bot.hears('🔲 Krassvord', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    updateUser(userId, { step: 'CROSS_TOPIC' });
    return ctx.reply(
        `🔲 Krassvord Yaratish\n\n💰 Balans: ${(user.balance||0).toLocaleString()} so'm\n📌 Narx: 1,500 so'm\n\nMavzuni kiriting:`,
        KB.cancel()
    );
});

// --- TEZIS ---
bot.hears('🎓 Tezis', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    updateUser(userId, { step: 'TEZIS_TOPIC' });
    return ctx.reply(
        `🎓 Tezis Yaratish\n\n💰 Balans: ${(user.balance||0).toLocaleString()} so'm\n📌 Narx: 3,000 so'm (3-10 bet)\n\nMavzuni kiriting:`,
        KB.cancel()
    );
});

// --- MAQOLA ---
bot.hears('📰 Maqola', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    updateUser(userId, { step: 'MAQOLA_TOPIC' });
    return ctx.reply(
        `📰 Maqola Yaratish\n\n💰 Balans: ${(user.balance||0).toLocaleString()} so'm\n📌 Narx: 2,500 so'm (3-10 bet)\n\nMavzuni kiriting:`,
        KB.cancel()
    );
});

// --- INFOGRAFIKA ---
bot.hears('📊 Infografika', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    updateUser(userId, { step: 'INFO_TOPIC' });
    return ctx.reply(
        `📊 Infografika Yaratish\n\n💰 Balans: ${(user.balance||0).toLocaleString()} so'm\n📌 Narx: 1,500 so'm\n\nMavzu yoki qisqa ma'lumot kiriting:\n(Masalan: O'zbekiston aholisi haqida)`,
        KB.cancel()
    );
});

// --- RASM YARATISH ---
bot.hears('🖼 Rasm Yaratish', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return;
    updateUser(userId, { step: 'RASM_DESC' });
    return ctx.reply(
        `🖼 AI Rasm Yaratish\n\n💰 Balans: ${(user.balance||0).toLocaleString()} so'm\n📌 Narx: 1,000 so'm\n\nRasm tavsifini kiriting:\n(Masalan: tog'lar orasidagi ko'l, kech vaqti, rangli)`,
        KB.cancel()
    );
});

// --- ADMIN PANEL ---
bot.hears('👨‍💻 Admin Panel', async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) return ctx.reply('🔒 Sizga ruxsat yo\'q!');

    const users = loadJson(USERS_FILE, {});
    const payments = loadJson(PAYMENTS_FILE, []);
    const orders = loadJson(ORDERS_FILE, []);
    const pendingCount = payments.filter(p => p.status === 'pending').length;
    const totalRevenue = payments.filter(p => p.status === 'approved').reduce((s,p) => s+p.amount, 0);

    return ctx.reply(
        `👨‍💻 Admin Panel\n\n👥 Foydalanuvchilar: ${Object.keys(users).length}\n💰 Kutilayotgan to'lovlar: ${pendingCount}\n📊 Buyurtmalar: ${orders.length}\n💵 Jami daromad: ${totalRevenue.toLocaleString()} so'm`,
        KB.adminPanel()
    );
});

bot.hears('📋 To\'lovlar', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const pending = getPendingPayments();
    if (!pending.length) return ctx.reply('✅ Kutilayotgan to\'lovlar yo\'q.');
    let msg = `💰 Kutilayotgan to'lovlar (${pending.length}):\n\n`;
    pending.slice(0, 10).forEach(p => {
        const u = getUser(p.userId);
        msg += `🆔 ${p.id}\n👤 ${u?.name||'?'} ${u?.surname||''} (${p.userId})\n💵 ${p.amount.toLocaleString()} so'm — ${p.type.toUpperCase()}\n✅ /approve ${p.id}\n\n`;
    });
    return ctx.reply(msg);
});

bot.hears('👥 Foydalanuvchilar', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const users = Object.values(loadJson(USERS_FILE, {}));
    let msg = `👥 Foydalanuvchilar (${users.length}):\n\n`;
    users.slice(0, 15).forEach((u, i) => {
        msg += `${i+1}. ${u.name} ${u.surname} — ${(u.balance||0).toLocaleString()} so'm\n`;
    });
    return ctx.reply(msg);
});

bot.hears('📢 Xabar yuborish', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    updateUser(ADMIN_ID, { step: 'BROADCASTING' });
    return ctx.reply('📢 Yuboriladigan xabarni kiriting:', KB.cancel());
});

bot.hears('📊 Statistika', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const users = loadJson(USERS_FILE, {});
    const payments = loadJson(PAYMENTS_FILE, []);
    const orders = loadJson(ORDERS_FILE, []);
    const totalRevenue = payments.filter(p=>p.status==='approved').reduce((s,p)=>s+p.amount,0);
    const byType = {};
    orders.forEach(o => { byType[o.type] = (byType[o.type]||0)+1; });
    let msg = `📊 Statistika\n\n👥 Foydalanuvchilar: ${Object.keys(users).length}\n💵 Jami daromad: ${totalRevenue.toLocaleString()} so'm\n📋 Jami buyurtmalar: ${orders.length}\n\nTurlari bo'yicha:\n`;
    Object.entries(byType).forEach(([k,v]) => msg += `  ${k}: ${v}\n`);
    return ctx.reply(msg);
});

bot.hears('◀️ Asosiy Menyu', async (ctx) => {
    const userId = ctx.from.id;
    updateUser(userId, { step: 'MAIN_MENU' });
    return ctx.reply(T.uz.mainMenu, KB.mainMenu(userId === ADMIN_ID));
});

// ==================== ADMIN KOMANDALAR ====================
bot.command('pending', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const pending = getPendingPayments();
    if (!pending.length) return ctx.reply('✅ Kutilayotgan to\'lovlar yo\'q.');
    let msg = `💰 Kutilayotgan to'lovlar:\n\n`;
    pending.forEach(p => {
        const u = getUser(p.userId);
        msg += `ID: ${p.id}\nKim: ${u?.name||'?'} ${u?.surname||''}\nSumma: ${p.amount.toLocaleString()} so'm\nTuri: ${p.type}\nTasdiqlash: /approve ${p.id}\n\n`;
    });
    return ctx.reply(msg);
});

bot.command('approve', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const paymentId = ctx.message.text.split(' ')[1];
    if (!paymentId) return ctx.reply('❌ Format: /approve PAYMENT_ID');
    const p = approvePayment(paymentId);
    if (!p) return ctx.reply('❌ To\'lov topilmadi yoki allaqachon tasdiqlangan!');
    const newUser = getUser(p.userId);
    try {
        await bot.telegram.sendMessage(p.userId, T.uz.payApproved(p.amount, newUser.balance), KB.mainMenu(false));
    } catch (_) {}
    return ctx.reply(`✅ To'lov tasdiqlandi! Foydalanuvchi: ${p.userId}, Summa: ${p.amount.toLocaleString()} so'm`);
});

bot.command('balance', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const [, targetId, amount] = ctx.message.text.split(' ');
    if (!targetId || !amount || isNaN(+amount)) return ctx.reply('❌ Format: /balance USER_ID SUMMA');
    const u = getUser(parseInt(targetId));
    updateUser(parseInt(targetId), { balance: (u.balance||0) + parseInt(amount) });
    try { await bot.telegram.sendMessage(parseInt(targetId), `🎁 Admin balansingizga ${parseInt(amount).toLocaleString()} so'm qo'shdi!`); } catch (_) {}
    return ctx.reply(`✅ Bajarildi: ${targetId} ga ${parseInt(amount).toLocaleString()} so'm qo'shildi.`);
});

bot.command('stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const users = loadJson(USERS_FILE, {});
    const orders = loadJson(ORDERS_FILE, []);
    const payments = loadJson(PAYMENTS_FILE, []);
    const rev = payments.filter(p=>p.status==='approved').reduce((s,p)=>s+p.amount,0);
    return ctx.reply(`📊 Statistika\n👥 ${Object.keys(users).length} foydalanuvchi\n📋 ${orders.length} buyurtma\n💵 ${rev.toLocaleString()} so'm daromad`);
});

bot.command('reset', async (ctx) => {
    const userId = ctx.from.id;
    updateUser(userId, { step: 'MAIN_MENU' });
    return ctx.reply('🔄 Tiklandi!', KB.mainMenu(userId === ADMIN_ID));
});

// ==================== RASM HANDLER (PDF + TO'LOV CHEKLARI) ====================
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];

    // To'lov cheki
    if (user.step === 'WAITING_CLICK_CHECK' || user.step === 'WAITING_PAYME_CHECK') {
        const payType = user.step === 'WAITING_CLICK_CHECK' ? 'click' : 'payme';
        const amount = ctx.session.neededAmount || 0;
        const payment = addPayment(userId, amount, payType, { fileId: photo.file_id });

        if (ADMIN_ID) {
            try {
                await bot.telegram.sendPhoto(ADMIN_ID, photo.file_id, {
                    caption: `💰 Yangi to'lov!\n\nKim: ${user.name} ${user.surname}\nID: ${userId}\nTuri: ${payType.toUpperCase()}\nSumma: ${amount.toLocaleString()} so'm\n\nTasdiqlash: /approve ${payment.id}`
                });
            } catch (_) {}
        }
        updateUser(userId, { step: 'PAYMENT_PENDING' });
        return ctx.reply(T.uz.checkReceived, KB.mainMenu(userId === ADMIN_ID));
    }

    // Rasmdan PDF
    if (user.step === 'PDF_WAITING') {
        if (!ctx.session.pdfImages) ctx.session.pdfImages = [];

        // Rasmni serverdan yuklab olish
        try {
            const fileLink = await ctx.telegram.getFileLink(photo.file_id);
            const imgRes = await fetch(fileLink.href);
            const imgBuf = Buffer.from(await imgRes.arrayBuffer());
            const tmpPath = path.join(TEMP_DIR, `img_${userId}_${Date.now()}.jpg`);
            fs.writeFileSync(tmpPath, imgBuf);
            ctx.session.pdfImages.push(tmpPath);
        } catch (e) {
            console.error('Rasm yuklash xato:', e.message);
            return ctx.reply('😔 Rasm yuklab olishda xato yuz berdi. Qayta yuboring.');
        }

        const count = ctx.session.pdfImages.length;
        if (count >= 10) {
            // Max 10 ta — avtomatik PDF yaratish
            return buildAndSendPdf(ctx, userId);
        }
        return ctx.reply(T.uz.pdfGot(count), KB.pdfMore());
    }
});

async function buildAndSendPdf(ctx, userId) {
    const images = ctx.session.pdfImages || [];
    if (!images.length) return ctx.reply('😔 Rasmlar topilmadi.', KB.cancel());

    await ctx.reply('⏳ PDF yaratilmoqda... ⌛');
    try {
        const pdfPath = await imagesToPdf(images, userId);
        await ctx.replyWithDocument({ source: pdfPath }, {
            caption: T.uz.pdfDone(images.length)
        });
        addOrder(userId, 'pdf', { count: images.length, price: 0 });
        // Tozalash
        images.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
        fs.unlinkSync(pdfPath);
        ctx.session.pdfImages = [];
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('✅ Bajarildi!', KB.mainMenu(userId === ADMIN_ID));
    } catch (err) {
        console.error('PDF yaratish xato:', err.message);
        return ctx.reply(T.uz.error, KB.mainMenu(userId === ADMIN_ID));
    }
}

// ==================== YORDAMCHI: TO'LOV TEKSHIRISH ====================
async function checkAndDeductBalance(ctx, userId, price, nextStep) {
    const user = getUser(userId);
    if ((user.balance || 0) < price) {
        ctx.session.neededAmount = price;
        ctx.session.afterPaymentStep = nextStep;
        updateUser(userId, { step: 'NEED_PAYMENT' });
        return ctx.reply(T.uz.lowBalance(price, user.balance || 0), KB.payment());
    }
    return null; // Yetarli
}

// ==================== ASOSIY MATN HANDLER ====================
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    let user = getUser(userId);
    const text = ctx.message.text;

    // Registratsiya
    if (!user.registered) {
        if (user.step === 'WAITING_NAME') {
            if (text.length < 2) return ctx.reply('😊 Iltimos, to\'g\'ri ism kiriting (kamida 2 harf):');
            updateUser(userId, { name: text, step: 'WAITING_SURNAME' });
            return ctx.reply(`🎉 Zo'r ism, ${text}!\n\nFamilyangizni kiriting:\n(Masalan: Yoldoshev)`, KB.cancel());
        }
        if (user.step === 'WAITING_SURNAME') {
            if (text.includes('Bekor')) { updateUser(userId, { step: 'WAITING_NAME' }); return ctx.reply(T.uz.enterName); }
            if (text.length < 2) return ctx.reply('😊 Iltimos, to\'g\'ri familya kiriting:');
            updateUser(userId, { surname: text, registered: true, step: 'MAIN_MENU', freeUsed: 0 });
            user = getUser(userId);
            return ctx.reply(T.uz.registered(user.name, FREE_SLIDES), KB.mainMenu(userId === ADMIN_ID));
        }
        if (user.step === 'LANG_SELECT') return ctx.reply(T.uz.welcome, KB.langSelect());
        return;
    }

    // Bekor qilish
    const isCancel = text === '❌ Bekor qilish' || text.includes('Bekor qilish');
    if (isCancel && user.step !== 'MAIN_MENU') {
        ctx.session.pdfImages = [];
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('✅ Bekor qilindi.', KB.mainMenu(userId === ADMIN_ID));
    }

    // ====== SLAYD ======
    if (user.step === 'SLAYD_TOPIC') {
        if (text.length < 3) return ctx.reply('😊 Mavzu juda qisqa. Batafsilroq yozing:');
        ctx.session.topic = text;
        updateUser(userId, { step: 'SLAYD_COUNT' });
        return ctx.reply(`🎯 Mavzu qabul qilindi: ${text}\n\nNechta slayd bo'lsin?`, KB.slideCount());
    }

    if (user.step === 'SLAYD_COUNT') {
        const count = parseInt(text.replace(/\D/g, ''));
        if (isNaN(count) || count < 1 || count > 30) return ctx.reply('😊 Iltimos, 1 dan 30 gacha son kiriting:');
        ctx.session.slideCount = count;

        const isFree = (user.freeUsed || 0) < FREE_SLIDES;
        const paket = getPaket(count, isFree);
        const price = isFree ? 0 : paket.narx;
        ctx.session.slidePrice = price;

        if (!isFree && (user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            ctx.session.afterPaymentStep = 'SLAYD_TEMPLATE';
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(t(userId, 'lowBalance', price, user.balance || 0), KB.payment());
        }

        updateUser(userId, { step: 'SLAYD_TEMPLATE' });
        return ctx.reply(
            `${paket.emoji} ${paket.nom} Paketi\n\n` +
            `📌 Mavzu: ${ctx.session.topic}\n` +
            `📊 Slaydlar: ${count} ta\n` +
            `💰 Narx: ${price > 0 ? price.toLocaleString() + ' so\'m' : 'BEPUL 🎁'}\n\n` +
            `🎨 Shablon tanlang yoki shablonsiz davom eting:\n` +
            `💡 2 ta raqam yozsangiz (masalan: 3 7) — 2 xil variant olasiz!`,
            KB.templateMenu()
        );
    }

    if (user.step === 'SLAYD_TEMPLATE') {
        if (text.includes('Shablonlarni ko\'rish')) {
            return ctx.reply(
                `🎨 Bizda 50 ta premium shablon bor!\n\n` +
                `📲 Ko'rish uchun:\n` +
                `1️⃣ Kanal: https://t.me/SlaydTop_01\n` +
                `2️⃣ Sayt: https://sardorsherqobilogli-art.github.io/slidetop01_bot-\n\n` +
                `✅ Ko'rib chiqqach, 2 ta shablon raqamini yuboring!\n` +
                `📌 Masalan: 3 7\n` +
                `(Ikki raqam — ikki xil dizayn siz uchun tayyorlanadi 🎁)`,
                KB.templateMenu()
            );
        }
        // 2 ta shablon variant: "3 7" ko'rinishida
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

    // ====== PDF ======
    if (user.step === 'PDF_WAITING') {
        if (text.includes('PDF yaratish')) return buildAndSendPdf(ctx, userId);
        if (text.includes('Yana rasm')) return ctx.reply('📸 Rasmni yuboring:');
        return ctx.reply('📸 Rasmni yuboring yoki "PDF yaratish" tugmasini bosing:', KB.pdfMore());
    }

    // ====== TEST ======
    if (user.step === 'TEST_TOPIC') {
        if (text.length < 3) return ctx.reply('😊 Mavzu juda qisqa:');
        ctx.session.testTopic = text;
        updateUser(userId, { step: 'TEST_COUNT' });
        return ctx.reply(`🎯 Mavzu: ${text}\n\nNechta savol bo'lsin?`, KB.testCount());
    }
    if (user.step === 'TEST_COUNT') {
        const count = parseInt(text);
        if (!count || count < 10 || count > 20) return ctx.reply('😊 Iltimos, 10, 15 yoki 20 tanlang:');
        ctx.session.testCount = count;
        updateUser(userId, { step: 'TEST_DIFF' });
        return ctx.reply('Qiyinlik darajasini tanlang:', KB.difficulty());
    }
    if (user.step === 'TEST_DIFF') {
        ctx.session.testDiff = text.includes('Oson') ? 'Oson' : text.includes('Qiyin') ? 'Qiyin' : "O'rta";
        const price = PRICES.test;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(T.uz.lowBalance(price, user.balance||0), KB.payment());
        }
        return doCreateTest(ctx, userId);
    }

    // ====== KRASSVORD ======
    if (user.step === 'CROSS_TOPIC') {
        if (text.length < 3) return ctx.reply('😊 Mavzu juda qisqa:');
        ctx.session.crossTopic = text;
        updateUser(userId, { step: 'CROSS_COUNT' });
        return ctx.reply(`🎯 Mavzu: ${text}\n\nNechta so'z bo'lsin?`, KB.crosswordCount());
    }
    if (user.step === 'CROSS_COUNT') {
        const count = parseInt(text) || 10;
        const price = PRICES.crossword;
        ctx.session.crossCount = count;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(T.uz.lowBalance(price, user.balance||0), KB.payment());
        }
        return doCreateCrossword(ctx, userId);
    }

    // ====== INSHO/ESSE ======
    if (user.step === 'ESSAY_TYPE') {
        ctx.session.essayType = text.includes('Insho') ? 'insho' : 'esse';
        updateUser(userId, { step: 'ESSAY_TOPIC' });
        return ctx.reply(
            `✍️ ${ctx.session.essayType === 'insho' ? 'Insho' : 'Esse'} mavzusini kiriting:\n\n💰 Balans: ${(user.balance||0).toLocaleString()} so'm\n📌 Narx: 1,500 so'm (500-1000 so'z)`,
            KB.cancel()
        );
    }
    if (user.step === 'ESSAY_TOPIC') {
        if (text.length < 3) return ctx.reply('😊 Mavzu juda qisqa:');
        ctx.session.essayTopic = text;
        updateUser(userId, { step: 'ESSAY_WORDS' });
        return ctx.reply('Nechta so\'z bo\'lsin?', KB.essayWords());
    }
    if (user.step === 'ESSAY_WORDS') {
        const words = parseInt(text) || 500;
        const price = PRICES.essay;
        ctx.session.essayWords = words;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(T.uz.lowBalance(price, user.balance||0), KB.payment());
        }
        return doCreateEssay(ctx, userId);
    }

    // ====== REFERAT/MUSTAQIL ======
    if (user.step === 'REFERAT_TYPE') {
        ctx.session.referatType = text.includes('Referat') ? 'referat' : 'mustaqil';
        updateUser(userId, { step: 'REFERAT_TOPIC' });
        return ctx.reply(
            `📚 ${ctx.session.referatType === 'referat' ? 'Referat' : 'Mustaqil Ish'} mavzusini kiriting:`,
            KB.cancel()
        );
    }
    if (user.step === 'REFERAT_TOPIC') {
        if (text.length < 3) return ctx.reply('😊 Mavzu juda qisqa:');
        ctx.session.referatTopic = text;
        updateUser(userId, { step: 'REFERAT_PAGES' });
        return ctx.reply('Nechta bet bo\'lsin?', KB.pageCount());
    }
    if (user.step === 'REFERAT_PAGES') {
        const pages = parseInt(text) || 10;
        const price = PRICES.referat;
        ctx.session.referatPages = pages;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(T.uz.lowBalance(price, user.balance||0), KB.payment());
        }
        return doCreateReferat(ctx, userId);
    }

    // ====== TEZIS ======
    if (user.step === 'TEZIS_TOPIC') {
        if (text.length < 3) return ctx.reply('😊 Mavzu juda qisqa:');
        ctx.session.tezisTopic = text;
        updateUser(userId, { step: 'TEZIS_PAGES' });
        return ctx.reply('Nechta bet?', KB.pageCountSmall());
    }
    if (user.step === 'TEZIS_PAGES') {
        const pages = parseInt(text) || 3;
        const price = PRICES.tezis;
        ctx.session.tezisPages = pages;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(T.uz.lowBalance(price, user.balance||0), KB.payment());
        }
        return doCreateTezis(ctx, userId);
    }

    // ====== MAQOLA ======
    if (user.step === 'MAQOLA_TOPIC') {
        if (text.length < 3) return ctx.reply('😊 Mavzu juda qisqa:');
        ctx.session.maqolaTopic = text;
        updateUser(userId, { step: 'MAQOLA_PAGES' });
        return ctx.reply('Nechta bet?', KB.pageCountSmall());
    }
    if (user.step === 'MAQOLA_PAGES') {
        const pages = parseInt(text) || 3;
        const price = PRICES.maqola;
        ctx.session.maqolaPages = pages;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(T.uz.lowBalance(price, user.balance||0), KB.payment());
        }
        return doCreateMaqola(ctx, userId);
    }

    // ====== INFOGRAFIKA ======
    if (user.step === 'INFO_TOPIC') {
        if (text.length < 3) return ctx.reply('😊 Ma\'lumot juda qisqa:');
        const price = PRICES.infografika;
        ctx.session.infoTopic = text;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(T.uz.lowBalance(price, user.balance||0), KB.payment());
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
            return ctx.reply(T.uz.lowBalance(price, user.balance||0), KB.payment());
        }
        return doCreateRasm(ctx, userId);
    }

    // ====== TO'LOV ======
    if (user.step === 'NEED_PAYMENT') {
        if (text.includes('Click')) {
            updateUser(userId, { step: 'WAITING_CLICK_CHECK' });
            return ctx.reply(T.uz.payClick(ctx.session.neededAmount || 0), KB.checkSend());
        }
        if (text.includes('Payme')) {
            updateUser(userId, { step: 'WAITING_PAYME_CHECK' });
            return ctx.reply(T.uz.payPayme(ctx.session.neededAmount || 0), KB.checkSend());
        }
        if (text.includes('Admin')) {
            return ctx.reply(`👨‍💻 Admin bilan bog'lanish:\nTelegram: @${ADMIN_USERNAME}\nTel: ${ADMIN_PHONE}`);
        }
    }

    // ====== SOZLAMALAR ======
    if (user.step === 'EDIT_NAME') {
        if (text.length < 2) return ctx.reply('😊 Iltimos, to\'g\'ri ism kiriting:');
        updateUser(userId, { name: text, step: 'MAIN_MENU' });
        return ctx.reply('✅ Ism yangilandi!', KB.mainMenu(userId === ADMIN_ID));
    }
    if (user.step === 'EDIT_SURNAME') {
        if (text.length < 2) return ctx.reply('😊 Iltimos, to\'g\'ri familya kiriting:');
        updateUser(userId, { surname: text, step: 'MAIN_MENU' });
        return ctx.reply('✅ Familya yangilandi!', KB.mainMenu(userId === ADMIN_ID));
    }

    // ====== ADMIN MUROJAAT ======
    if (user.step === 'CONTACT_ADMIN') {
        if (ADMIN_ID) {
            try {
                await bot.telegram.sendMessage(ADMIN_ID,
                    `👨‍💻 Yangi murojaat!\n\nKim: ${user.name} ${user.surname} (@${ctx.from.username||'yo\'q'})\nID: ${userId}\n\nXabar: ${text}`
                );
            } catch (_) {}
        }
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(T.uz.msgSent, KB.mainMenu(userId === ADMIN_ID));
    }

    // ====== ADMIN BROADCAST ======
    if (userId === ADMIN_ID && user.step === 'BROADCASTING') {
        const allUsers = Object.keys(loadJson(USERS_FILE, {}));
        await ctx.reply(`⏳ ${allUsers.length} ta foydalanuvchiga yuborilmoqda...`);
        let sent = 0, failed = 0;
        for (const uid of allUsers) {
            try { await bot.telegram.sendMessage(uid, text); sent++; } catch (_) { failed++; }
            await new Promise(r => setTimeout(r, 50));
        }
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(`✅ Yuborildi: ${sent}\n❌ Xato: ${failed}`, KB.mainMenu(true));
    }

    // Default
    if (!user.step || user.step === 'MAIN_MENU' || user.step === 'PAYMENT_PENDING') {
        return ctx.reply('😊 Xizmatni tanlang!', KB.mainMenu(userId === ADMIN_ID));
    }
});

// ==================== ISHLOV BERISHCHI FUNKSIYALAR ====================

async function doCreateSlide(ctx, userId) {
    const user = getUser(userId);
    const topic = ctx.session.topic;
    const count = ctx.session.slideCount || 5;
    const price = ctx.session.slidePrice || 0;
    const isFree = price === 0;
    const tmpl1 = ctx.session.templateId;
    const tmpl2 = ctx.session.templateId2;
    const isDual = !!(tmpl1 && tmpl2);

    // Paket nomi
    const paket = getPaket(count, isFree);

    await ctx.reply(
        `⏳ ${paket.emoji} ${paket.nom} paketi tayyorlanmoqda...\n\n` +
        `🤖 AI ma'lumot yig'moqda\n🎨 Dizayn ishlanmoqda\n` +
        (isDual ? `🎁 2 ta variant tayyorlanmoqda\n` : '') +
        `📎 Fayl yaratilmoqda\n\nBu 20-40 soniya davom etadi ⌛`,
        { reply_markup: { remove_keyboard: true } }
    );

    try {
        if (isFree) {
            updateUser(userId, { freeUsed: (user.freeUsed || 0) + 1 });
        } else {
            updateUser(userId, { balance: (user.balance || 0) - price });
        }

        const aiText = await aiSlides(topic, count);
        if (!aiText) {
            if (!isFree) updateUser(userId, { balance: (user.balance || 0) + price });
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(t(userId, 'error'), KB.mainMenu(userId === ADMIN_ID));
        }

        if (isDual) {
            // 2 ta fayl yaratish
            const [file1, file2] = await Promise.all([
                makeSlidePptx(topic, aiText, userId, count, tmpl1),
                makeSlidePptx(topic, aiText, userId, count, tmpl2)
            ]);
            const caption1 = `🎨 Variant 1 — Shablon #${tmpl1?.replace('template_','')||'A'}\n📌 ${topic}\n📊 ${count} ta slayd`;
            const caption2 = `🎨 Variant 2 — Shablon #${tmpl2?.replace('template_','')||'B'}\n📌 ${topic}\n📊 ${count} ta slayd`;
            await ctx.replyWithDocument({ source: file1 }, { caption: caption1 });
            await ctx.replyWithDocument({ source: file2 }, { caption: caption2 });
            await ctx.reply(`✅ Ikkala variant tayyor! 🎉\n\n${paket.emoji} Paket: ${paket.nom}\n💰 Narx: ${isFree ? 'BEPUL' : price.toLocaleString()+' so\'m'}\n\nYoqqanini saqlang! 😊`);
            try { require('fs').unlinkSync(file1); } catch (_) {}
            try { require('fs').unlinkSync(file2); } catch (_) {}
        } else {
            const filePath = await makeSlidePptx(topic, aiText, userId, count, tmpl1);
            await ctx.replyWithDocument({ source: filePath }, {
                caption: `✅ Slaydingiz tayyor! 🎉\n\n${paket.emoji} Paket: ${paket.nom}\n📌 Mavzu: ${topic}\n📊 ${count} ta slayd\n💰 ${isFree ? 'BEPUL' : price.toLocaleString()+' so\'m'}`
            });
            try { require('fs').unlinkSync(filePath); } catch (_) {}
        }

        addOrder(userId, 'slides', { topic, count, price, dual: isDual });
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('1️⃣ dan 5️⃣ gacha baholang:', KB.rating());
    } catch (err) {
        console.error('Slayd xato:', err.message);
        if (!isFree) updateUser(userId, { balance: (user.balance || 0) + price });
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(t(userId, 'error'), KB.mainMenu(userId === ADMIN_ID));
    }
}

async function doCreateTest(ctx, userId) {
    const user = getUser(userId);
    const topic = ctx.session.testTopic;
    const count = ctx.session.testCount || 10;
    const diff = ctx.session.testDiff || "O'rta";
    const price = PRICES.test;

    await ctx.reply(T.uz.creating);
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiTest(topic, count, diff);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID)); }
        const filePath = await makeTestPptx(topic, aiText, userId, count, diff);
        await ctx.replyWithDocument({ source: filePath }, { caption: `✅ Test tayyor! 🎉\n\n📌 Mavzu: ${topic}\n📝 ${count} ta savol\n💰 ${price.toLocaleString()} so'm` });
        addOrder(userId, 'test', { topic, count, diff, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('1️⃣ dan 5️⃣ gacha baholang:', KB.rating());
    } catch (err) {
        console.error('Test xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID));
    }
}

async function doCreateCrossword(ctx, userId) {
    const user = getUser(userId);
    const topic = ctx.session.crossTopic;
    const count = ctx.session.crossCount || 10;
    const price = PRICES.crossword;

    await ctx.reply(T.uz.creating);
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiCrossword(topic, count);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID)); }
        const filePath = await makeCrosswordPptx(topic, aiText, userId, count);
        await ctx.replyWithDocument({ source: filePath }, { caption: `✅ Krassvord tayyor! 🎉\n\n📌 Mavzu: ${topic}\n🔲 ${count} ta savol\n💰 ${price.toLocaleString()} so'm` });
        addOrder(userId, 'krassvord', { topic, count, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('1️⃣ dan 5️⃣ gacha baholang:', KB.rating());
    } catch (err) {
        console.error('Krassvord xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID));
    }
}

async function doCreateEssay(ctx, userId) {
    const user = getUser(userId);
    const topic = ctx.session.essayTopic;
    const type = ctx.session.essayType || 'insho';
    const words = ctx.session.essayWords || 500;
    const price = PRICES.essay;

    await ctx.reply(T.uz.creating);
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiEssay(topic, type, words);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID)); }
        const filePath = await makeTextPptx(topic, aiText, userId, type === 'insho' ? 'Insho' : 'Esse');
        await ctx.replyWithDocument({ source: filePath }, { caption: `✅ ${type === 'insho' ? 'Insho' : 'Esse'} tayyor! 🎉\n\n📌 Mavzu: ${topic}\n✍️ ${words} so'z\n💰 ${price.toLocaleString()} so'm` });
        addOrder(userId, type, { topic, words, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('1️⃣ dan 5️⃣ gacha baholang:', KB.rating());
    } catch (err) {
        console.error('Essay xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID));
    }
}

async function doCreateReferat(ctx, userId) {
    const user = getUser(userId);
    const topic = ctx.session.referatTopic;
    const type = ctx.session.referatType || 'referat';
    const pages = ctx.session.referatPages || 10;
    const price = PRICES.referat;

    await ctx.reply(T.uz.creating);
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiReferat(topic, type, pages);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID)); }
        const filePath = await makeTextPptx(topic, aiText, userId, type === 'referat' ? 'Referat' : 'MustaqilIsh');
        await ctx.replyWithDocument({ source: filePath }, { caption: `✅ ${type === 'referat' ? 'Referat' : 'Mustaqil ish'} tayyor! 🎉\n\n📌 Mavzu: ${topic}\n📋 ${pages} bet\n💰 ${price.toLocaleString()} so'm` });
        addOrder(userId, type, { topic, pages, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('1️⃣ dan 5️⃣ gacha baholang:', KB.rating());
    } catch (err) {
        console.error('Referat xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID));
    }
}

async function doCreateTezis(ctx, userId) {
    const user = getUser(userId);
    const topic = ctx.session.tezisTopic;
    const pages = ctx.session.tezisPages || 3;
    const price = PRICES.tezis;

    await ctx.reply(T.uz.creating);
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiTezis(topic, pages);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID)); }
        const filePath = await makeTextPptx(topic, aiText, userId, 'Tezis');
        await ctx.replyWithDocument({ source: filePath }, { caption: `✅ Tezis tayyor! 🎉\n\n📌 Mavzu: ${topic}\n📋 ${pages} bet\n💰 ${price.toLocaleString()} so'm` });
        addOrder(userId, 'tezis', { topic, pages, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('1️⃣ dan 5️⃣ gacha baholang:', KB.rating());
    } catch (err) {
        console.error('Tezis xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID));
    }
}

async function doCreateMaqola(ctx, userId) {
    const user = getUser(userId);
    const topic = ctx.session.maqolaTopic;
    const pages = ctx.session.maqolaPages || 3;
    const price = PRICES.maqola;

    await ctx.reply(T.uz.creating);
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiMaqola(topic, pages);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID)); }
        const filePath = await makeTextPptx(topic, aiText, userId, 'Maqola');
        await ctx.replyWithDocument({ source: filePath }, { caption: `✅ Maqola tayyor! 🎉\n\n📌 Mavzu: ${topic}\n📋 ${pages} bet\n💰 ${price.toLocaleString()} so'm` });
        addOrder(userId, 'maqola', { topic, pages, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('1️⃣ dan 5️⃣ gacha baholang:', KB.rating());
    } catch (err) {
        console.error('Maqola xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID));
    }
}

async function doCreateInfo(ctx, userId) {
    const user = getUser(userId);
    const topic = ctx.session.infoTopic;
    const price = PRICES.infografika;

    await ctx.reply(T.uz.creating);
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const aiText = await aiInfografika(topic);
        if (!aiText) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID)); }
        const filePath = await makeInfoPptx(topic, aiText, userId);
        await ctx.replyWithDocument({ source: filePath }, { caption: `✅ Infografika tayyor! 🎉\n\n📌 Mavzu: ${topic}\n💰 ${price.toLocaleString()} so'm` });
        addOrder(userId, 'infografika', { topic, price });
        try { fs.unlinkSync(filePath); } catch (_) {}
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply('1️⃣ dan 5️⃣ gacha baholang:', KB.rating());
    } catch (err) {
        console.error('Infografika xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID));
    }
}

async function doCreateRasm(ctx, userId) {
    const user = getUser(userId);
    const desc = ctx.session.rasmDesc;
    const price = PRICES.rasm;

    await ctx.reply('⏳ AI rasm tavsifi tayyorlanmoqda...');
    updateUser(userId, { balance: (user.balance||0) - price });

    try {
        const prompt = await aiRasm(desc);
        if (!prompt) { updateUser(userId, { balance: (user.balance||0)+price }); return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID)); }

        // Hozircha Groq orqali faqat prompt generatsiya — rasm generatsiya API keyinroq qo'shiladi
        updateUser(userId, { step: 'MAIN_MENU' });
        addOrder(userId, 'rasm', { desc, price });
        return ctx.reply(
            `🖼 AI Rasm uchun Professional Prompt Tayyor! 🎉\n\n💰 ${price.toLocaleString()} so'm\n\n📝 Quyidagi promptni Midjourney, DALL-E yoki Stable Diffusion da ishlating:\n\n${prompt.slice(0, 900)}`,
            KB.mainMenu(userId === ADMIN_ID)
        );
    } catch (err) {
        console.error('Rasm xato:', err.message);
        updateUser(userId, { balance: (user.balance||0)+price, step: 'MAIN_MENU' });
        return ctx.reply(T.uz.error, KB.mainMenu(userId===ADMIN_ID));
    }
}

// ==================== XATO HANDLER ====================
bot.catch((err, ctx) => {
    console.error('Bot xato:', err.message, '\nCtx:', ctx?.updateType);
    try { ctx.reply('😔 Kutilmagan xatolik. /start bosing.').catch(() => {}); } catch (_) {}
});

// ==================== BOTNI ISHGA TUSHIRISH ====================
bot.launch()
    .then(() => console.log('✅ SlaydTop Bot ishga tushdi!'))
    .catch(err => { console.error('❌ Bot ishga tushirishda xato:', err); process.exit(1); });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Health check server
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SlaydTop Bot is running! ✅');
}).listen(process.env.PORT || 3000, () => console.log(`Health check: port ${process.env.PORT || 3000}`));
