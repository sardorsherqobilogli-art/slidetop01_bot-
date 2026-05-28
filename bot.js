const { Telegraf, Markup, session } = require('telegraf');
const PptxGenJS = require("pptxgenjs");
const fs = require('fs');
const path = require('path');

// ==================== KONFIGURATSIYA ====================
const token = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.trim() : '';
const openrouterKey = process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.trim() : '';
const adminId = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : 0;
console.log("OPENROUTER STATUS:", openrouterKey ? 'kalit bor, uzunlik: ' + openrouterKey.length : 'KALIT YOQ!');
const adminUsername = process.env.ADMIN_USERNAME || '';
const adminPhone = process.env.ADMIN_PHONE || '+998901234567';

// CLICK PAYME KONFIGURATSIYA
const CLICK_MERCHANT_ID = process.env.CLICK_MERCHANT_ID || '';
const CLICK_SERVICE_ID = process.env.CLICK_SERVICE_ID || '';
const PAYME_MERCHANT_ID = process.env.PAYME_MERCHANT_ID || '';

if (!token) {
    console.error("XATO: TELEGRAM_BOT_TOKEN topilmadi!");
    process.exit(1);
}

// ==================== GLOBAL O'ZGARUVCHILAR ====================
const DATA_DIR = path.join(__dirname, 'data');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const ASSETS_DIR = path.join(__dirname, 'assets');

// Papkalarni yaratish
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// Ma'lumotlar fayllari
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// ==================== NARXLAR ====================
const PRICES = {
    slides: { 1: 2000, 2: 3000, 4: 5000, 8: 8000, 12: 10000 },
    slidesCount: {
        2000: { min: 1, max: 6 },
        3000: { min: 2, max: 8 },
        5000: { min: 4, max: 12 },
        8000: { min: 8, max: 25 },
        10000: { min: 12, max: 25 }
    },
    crossword: { 10: 1000, 15: 2000, 20: 3000 },
    test: { 1: 100, 5: 500, 10: 1000 },
    insho: { perWord: 10 },
    essey: { perWord: 10 },
    referat: { perPage: 500 },
    mustaqil: { perPage: 500 },
    tezis: { perWord: 10 },
    glossary: { perItem: 200 }
};

// ==================== YORDAMCHI FUNKSIYALAR ====================
function loadJson(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`Fayl yuklash xatosi: ${filePath}`, e.message);
    }
    return defaultValue;
}

function saveJson(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`Fayl saqlash xatosi: ${filePath}`, e.message);
    }
}

function getUser(userId) {
    const users = loadJson(USERS_FILE, {});
    if (!users[userId]) {
        users[userId] = {
            id: userId,
            name: '',
            surname: '',
            university: '',
            group: '',
            balance: 0,
            freeSlidesUsed: 0,
            totalSlides: 0,
            registered: false,
            step: 'WAITING_NAME',
            lastOrder: null,
            settings: { font: 'Arial' },
            invitedFriends: [],
            isAdmin: userId === adminId
        };
        saveJson(USERS_FILE, users);
    }
    return users[userId];
}

function updateUser(userId, updates) {
    const users = loadJson(USERS_FILE, {});
    if (users[userId]) {
        users[userId] = { ...users[userId], ...updates };
        saveJson(USERS_FILE, users);
    }
    return users[userId];
}

function addPayment(userId, amount, type, status = 'pending', details = {}) {
    const payments = loadJson(PAYMENTS_FILE, []);
    const payment = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        userId,
        amount,
        type,
        status,
        details,
        createdAt: new Date().toISOString(),
        approvedAt: null
    };
    payments.push(payment);
    saveJson(PAYMENTS_FILE, payments);
    return payment;
}

function getPendingPayments() {
    const payments = loadJson(PAYMENTS_FILE, []);
    return payments.filter(p => p.status === 'pending');
}

function approvePayment(paymentId) {
    const payments = loadJson(PAYMENTS_FILE, []);
    const p = payments.find(p => p.id === paymentId);
    if (p) {
        p.status = 'approved';
        p.approvedAt = new Date().toISOString();
        saveJson(PAYMENTS_FILE, payments);
        const user = getUser(p.userId);
        updateUser(p.userId, { balance: (user.balance || 0) + p.amount });
        return p;
    }
    return null;
}

function addOrder(userId, type, details, fileName) {
    const orders = loadJson(ORDERS_FILE, []);
    orders.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        userId,
        type,
        details,
        fileName,
        rating: null,
        createdAt: new Date().toISOString()
    });
    saveJson(ORDERS_FILE, orders);
}

function getTemplates() {
    const templates = loadJson(TEMPLATES_FILE, []);
    if (templates.length === 0) {
        // Avtomatik template ro'yxatini yaratish
        return scanTemplates();
    }
    return templates;
}

function scanTemplates() {
    // templates/ papkadagi fayllarni skanerlash
    const templates = [];
    try {
        if (fs.existsSync(TEMPLATES_DIR)) {
            const files = fs.readdirSync(TEMPLATES_DIR);
            let idx = 1;
            for (const file of files.sort()) {
                if (file.endsWith('.pptx')) {
                    templates.push({
                        id: `template_${idx.toString().padStart(2, '0')}`,
                        name: `Shablon ${idx}`,
                        filePath: path.join(TEMPLATES_DIR, file),
                        fileName: file,
                        previewImage: null,
                        price: 0
                    });
                    idx++;
                }
            }
        }
    } catch (e) {
        console.error('Template skanerlash xatosi:', e.message);
    }
    return templates;
}

function getTemplateById(id) {
    const templates = getTemplates();
    return templates.find(t => t.id === id || t.fileName === id);
}

// ==================== EMOJI YORDAMCHI ====================
const E = {
    smile: '😊', wink: '😉', laugh: '😂', star: '⭐', fire: '🔥',
    rocket: '🚀', chart: '📊', book: '📚', pencil: '✏️', money: '💰',
    card: '💳', phone: '📱', check: '✅', wrong: '❌', clock: '⏳',
    gift: '🎁', crown: '👑', brain: '🧠', magic: '✨', heart: '❤️',
    clap: '👏', trophy: '🏆', light: '💡', back: '◀️', lock: '🔒',
    unlock: '🔓', warning: '⚠️', info: 'ℹ️', robot: '🤖', download: '⬇️',
    upload: '⬆️', search: '🔍', settings: '⚙️', admin: '👨‍💻', pen: '🖊️',
    doc: '📄', quiz: '❓', grid: '🔲', essay: '📝', university: '🏛️',
    group: '👥', pic: '🖼️', sparkle: '💖', target: '🎯', medal: '🎖️'
};

// ==================== KLAVIATURALAR ====================
const Keyboards = {
    mainMenu: (isAdmin = false) => {
        const buttons = [
            [`${E.magic} Slayd Yaratish`, `${E.money} Hisobim`],
            [`${E.pic} Shablonlar`, `${E.gift} Do'stlarni Taklif Qilish`],
            [`${E.quiz} Test`, `${E.grid} Krassvord`],
            [`${E.essay} Insho/Esse`, `${E.doc} Referat/Mustaqil`],
            [`${E.pen} Tezis`, `${E.book} Glossariy`],
            [`${E.settings} Sozlamalar`, `${E.admin} Adminga Murojaat`]
        ];
        if (isAdmin) buttons.push([`${E.admin} Admin Panel`]);
        return Markup.keyboard(buttons).resize();
    },
    cancel: () => Markup.keyboard([[`${E.wrong} Bekor Qilish`]]).resize(),
    backToMenu: () => Markup.keyboard([[`${E.back} Asosiy Menyu`]]).resize(),
    slideCount: () => Markup.keyboard([
        ['5', '6', '7', '8'],
        ['9', '10', '11', '12'],
        ['13', '15', '20', '25'],
        [`${E.wrong} Bekor Qilish`]
    ]).resize(),
    templateMenu: () => Markup.keyboard([
        [`${E.pic} Shablonlarni Ko'rish`],
        [`${E.magic} Shablonsiz (Oddiy) Yaratish`],
        [`${E.wrong} Bekor Qilish`]
    ]).resize(),
    rating: () => Markup.inlineKeyboard([
        [
            Markup.button.callback(`${E.star}`, 'rate_1'),
            Markup.button.callback(`${E.star}${E.star}`, 'rate_2'),
            Markup.button.callback(`${E.star}${E.star}${E.star}`, 'rate_3'),
            Markup.button.callback(`${E.star}${E.star}${E.star}${E.star}`, 'rate_4'),
            Markup.button.callback(`${E.star}${E.star}${E.star}${E.star}${E.star}`, 'rate_5')
        ]
    ]),
    paymentMethods: () => Markup.keyboard([
        [`${E.card} Click orqali to'lov`],
        [`${E.card} Payme orqali to'lov`],
        [`${E.phone} Admin bilan bog'lanish`],
        [`${E.wrong} Bekor Qilish`]
    ]).resize(),
    confirmPayment: () => Markup.keyboard([
        [`${E.upload} Chekni Yuborish`],
        [`${E.wrong} Bekor Qilish`]
    ]).resize(),
    difficulty: () => Markup.keyboard([
        ['🟢 Oson', "🟡 O'rta", '🔴 Murakkab'],
        [`${E.wrong} Bekor Qilish`]
    ]).resize(),
    crosswordCount: () => Markup.keyboard([
        ["10 ta savol - 1,000 so'm", "15 ta savol - 2,000 so'm"],
        ["20 ta savol - 3,000 so'm"],
        [`${E.wrong} Bekor Qilish`]
    ]).resize(),
    testCount: () => Markup.keyboard([
        ["1 ta test - 100 so'm", "5 ta test - 500 so'm"],
        ["10 ta test - 1,000 so'm"],
        [`${E.wrong} Bekor Qilish`]
    ]).resize(),
    essayType: () => Markup.keyboard([
        [`${E.pen} Insho Yaratish`, `${E.pen} Esse Yaratish`],
        [`${E.wrong} Bekor Qilish`]
    ]).resize(),
    referatType: () => Markup.keyboard([
        [`${E.doc} Referat Yaratish`, `${E.doc} Mustaqil Ish Yaratish`],
        [`${E.wrong} Bekor Qilish`]
    ]).resize(),
    yesNo: () => Markup.keyboard([
        [`${E.check} Ha`, `${E.wrong} Yo'q`]
    ]).resize(),
    payAmounts: () => Markup.keyboard([
        ['5,000 so\'m', '10,000 so\'m'],
        ['20,000 so\'m', '50,000 so\'m'],
        ['100,000 so\'m', 'Boshqa summa'],
        [`${E.wrong} Bekor Qilish`]
    ]).resize()
};

// ==================== NARX HISOBLASH ====================
function calculateSlidePrice(count) {
    if (count <= 1) return 2000;
    if (count <= 2) return 3000;
    if (count <= 4) return 5000;
    if (count <= 8) return 8000;
    return 10000;
}

function getSlidePackage(count) {
    const price = calculateSlidePrice(count);
    return { price, maxSlides: PRICES.slidesCount[price]?.max || 25 };
}

// ==================== AI KONTENT YARATISH ====================
async function getAIContent(topic, count = 5, type = 'slides', options = {}) {
    try {
        console.log("AI so'rov yuborilmoqda:", { topic, count, type });
        let prompt = '';
        const difficulty = options.difficulty || "O'rta";

        switch (type) {
            case 'slides':
                prompt = `Siz professional PowerPoint tayyorlovchisiz. "${topic}" mavzusida ${count} ta slayd uchun professional reja va batafsil matn tayyorlang.

QOIDALAR:
- Har bir slaydni "SLIDE:" bilan boshlang
- Sarlavha va matnni "|" bilan ajrating
- Professional, ilmiy uslubda yozing
- Har bir slayd 3-5 ta gapdan iborat bo'lsin
- O'zbek tilida yozing
- Slides must be educational and informative

FORMAT:
SLIDE: Sarlavha 1 | Batafsil matn...
SLIDE: Sarlavha 2 | Batafsil matn...

Jami ${count} ta slayd bo'lishi SHART.`;
                break;

            case 'crossword':
                prompt = `"${topic}" mavzusida ${count} ta savoldan iborat krassvord yaratish uchun ma'lumot tayyorlang.

QOIDALAR:
- Har bir savolni "SAVOL:" bilan boshlang
- Savol va javobni "|" bilan ajrating
- Javoblar katta harflar bilan, bo'shliqsiz yozilsin (O'zbek lotin harflari bilan)
- O'zbek tilida
- Har bir javob 3-15 harf orasida bo'lishi kerak

FORMAT:
SAVOL: 1 | Savol matni bu yerda | JAVOB
SAVOL: 2 | Savol matni bu yerda | JAVOB

Jami ${count} ta savol.`;
                break;

            case 'test':
                prompt = `"${topic}" mavzusida ${count} ta test savoli va 4 ta variantdan iborat test yaratish uchun ma'lumot tayyorlang. Qiyinchilik darajasi: ${difficulty}

QOIDALAR:
- Har bir testni "TEST:" bilan boshlang
- To'g'ri javobni ko'rsating
- O'zbek tilida
- Savollar ta'lim maqsadida, o'qituvchi darajasida bo'lishi kerak

FORMAT:
TEST: 1 | Savol matni | A) variant 1 | B) variant 2 | C) variant 3 | D) variant 4 | To'g'ri: A
TEST: 2 | Savol matni | A) variant 1 | B) variant 2 | C) variant 3 | D) variant 4 | To'g'ri: C

Jami ${count} ta test.`;
                break;

            case 'insho':
            case 'essey':
                const wordCount = count;
                prompt = `"${topic}" mavzusida ${wordCount} so'zdan iborat ${type === 'insho' ? 'insho' : 'esse'} yozing.

QOIDALAR:
- Professional, ilmiy-badiy uslubda
- Kirish, asosiy qism va xulosa bo'lishi kerak
- O'zbek tilida
- Aniq ${wordCount} so'z bo'lishi kerak (ko'paytirmang, kamaytirmang)
- Mavzu ochib berilsin, o'quvchi talabalar uchun tushunarli bo'lsin`;
                break;

            case 'referat':
            case 'mustaqil':
                const pageCount = count;
                prompt = `"${topic}" mavzusida ${pageCount} betdan iborat ${type === 'referat' ? 'referat' : 'mustaqil ish'} uchun kontent tayyorlang.

QOIDALAR:
- Har bir sahifani "BET:" bilan boshlang
- Professional, ilmiy uslubda
- O'zbek tilida
- Muqova, reja, kirish, asosiy qism, xulosa, foydalanilgan adabiyotlar bo'lishi kerak
- Batafsil va ilmiy matn

FORMAT:
BET: 1 | Muqova | Mavzu: ${topic}...
BET: 2 | Reja | Asosiy bo'limlar...
BET: 3 | Kirish | Mavzu dolzarbligi...
BET: 4 | Asosiy qism 1 | Batafsil ma'lumot...
BET: 5 | Xulosa | Xulosa matni...
BET: 6 | Adabiyotlar | Foydalanilgan adabiyotlar ro'yxati...

Jami ${pageCount} ta bet.`;
                break;

            case 'tezis':
                const tezisWords = count;
                prompt = `"${topic}" mavzusida ${tezisWords} so'zdan iborat tezis yozing.

QOIDALAR:
- Qisqa, mazmunli va ilmiy uslubda
- Asosiy g'oya, maqsad, natijalar va xulosalar
- O'zbek tilida
- Konferensiya tezisi formatida`;
                break;

            case 'glossary':
                const glossaryCount = count;
                prompt = `"${topic}" mavzusida ${glossaryCount} ta glossariy so'zlari ro'yxatini tuzing.

QOIDALAR:
- Har bir so'zni "SOZ:" bilan boshlang
- So'z, qaysi tildan olinganligi, ta'rifi
- O'zbek tilida
- Ilmiy terminlar bo'lishi kerak

FORMAT:
SOZ: 1 | So'z | Til | Ta'rif
SOZ: 2 | So'z | Til | Ta'rif`;
                break;

            default:
                prompt = `"${topic}" mavzusida ${count} ta element yarat.`;
        }

        // --- OPENROUTER ---
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openrouterKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "meta-llama/llama-3.3-70b-instruct",
                messages: [
                    { role: "system", content: "Siz qoidalarga qat'iy amal qiladigan yordamchisiz." },
                    { role: "user", content: prompt }
                ]
            })
        });
        const data = await response.json();
        const text = data.choices[0].message.content;
        console.log("OPENROUTER JAVOBI OLINDI. Uzunlik:", text ? text.length : 'NULL');
        return text;
        // ---------------------------------

    } catch (err) {
        console.error("===== OPENROUTER XATOSI =====");
        console.error("Xabar:", err.message);
        console.error("Stack:", err.stack);
        console.error("=========================");
        return null;
    }
}
           
// ==================== PPTX FAYL YARATISH ====================
async function createSlayd(topic, aiContent, userId, templateId = null, slideCount = 5) {
    try {
        const pptx = new PptxGenJS();
        const user = getUser(userId);
        const fontFace = user.settings?.font || 'Arial';

        // PPTX sozlamalari
        pptx.author = 'SlaydTop AI';
        pptx.company = 'SlaydTop';
        pptx.title = topic;
        pptx.subject = topic;
        pptx.layout = 'LAYOUT_16x9';

        // Template ID formatini tekshirish
        let templatePath = null;
        if (templateId) {
            const tId = templateId.toString().padStart(2, '0');
            const possiblePaths = [
                path.join(TEMPLATES_DIR, `template_${tId}.pptx`),
                path.join(TEMPLATES_DIR, `template${tId}.pptx`),
                path.join(TEMPLATES_DIR, templateId),
            ];
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    templatePath = p;
                    console.log(`Shablon topildi: ${p}`);
                    break;
                }
            }
        }

        // Shablon mavjud bo'lsa, uning dizaynini ko'chirish
        let templateColors = {
            primary: '1a237e',
            secondary: '3949ab',
            bg: 'F5F5F5',
            text: '333333',
            accent: 'FFFFFF'
        };

        // Ranglar ro'yxati (shablonsiz holat uchun)
        const colorSchemes = [
            { primary: '1a237e', secondary: '3949ab', bg: 'F5F5F5' }, // Ko'k
            { primary: 'b71c1c', secondary: 'e53935', bg: 'FFF5F5' }, // Qizil
            { primary: '1b5e20', secondary: '43a047', bg: 'F1F8E9' }, // Yashil
            { primary: 'e65100', secondary: 'fb8c00', bg: 'FFF3E0' }, // To'q sariq
            { primary: '4a148c', secondary: '8e24aa', bg: 'F3E5F5' }, // Siyoh
            { primary: '006064', secondary: '00acc1', bg: 'E0F7FA' }, // Moviy
        ];

        // Agar shablon ko'rsatilmagan bo'lsa, tasodifiy rang tanlash
        if (!templatePath) {
            const randomScheme = colorSchemes[Math.floor(Math.random() * colorSchemes.length)];
            templateColors = { ...templateColors, ...randomScheme };
        }

        // Slaydlarni ajratib olish
        let slidesData = [];
        const slideMatches = aiContent.split(/SLIDE:|Slide:|S:/i).filter(s => s.trim().length > 5);
        
        if (slideMatches.length > 0) {
            slidesData = slideMatches.map(s => s.trim());
        } else {
            // Agar slaydlar ajratilmagan bo'lsa, matnni bo'lish
            const lines = aiContent.split('\n').filter(l => l.trim().length > 10);
            const chunkSize = Math.max(1, Math.ceil(lines.length / slideCount));
            for (let i = 0; i < lines.length; i += chunkSize) {
                slidesData.push(lines.slice(i, i + chunkSize).join('\n'));
            }
        }

        // Muqova slaydi
        const coverSlide = pptx.addSlide();
        coverSlide.background = { color: templateColors.primary };
        
        // Gradient effekt (shapes bilan)
        coverSlide.addShape(pptx.ShapeType.rect, {
            x: 0, y: 0, w: '100%', h: '100%',
            fill: { color: templateColors.primary }
        });

        coverSlide.addText(topic, {
            x: 0.5, y: 1.5, w: '90%',
            fontSize: 36,
            bold: true,
            color: 'FFFFFF',
            fontFace: fontFace,
            align: 'center',
            shadow: { type: 'outer', blur: 3, color: '000000', opacity: 0.3 }
        });

        coverSlide.addText(`Tayyorlandi: SlaydTop AI\n${user.name || 'Foydalanuvchi'} ${user.surname || ''}\n${user.university || ''}`, {
            x: 0.5, y: 3.2, w: '90%',
            fontSize: 14,
            color: 'E0E0E0',
            fontFace: fontFace,
            align: 'center'
        });

        // Dekorativ chiziqlar
        coverSlide.addShape(pptx.ShapeType.line, {
            x: 2, y: 3.0, w: 6, h: 0,
            line: { color: 'FFFFFF', width: 2 }
        });

        // Har bir slaydni yaratish
        let actualCount = 0;
        const maxSlides = Math.min(slidesData.length, slideCount);

        for (let i = 0; i < maxSlides; i++) {
            const s = slidesData[i];
            if (!s || s.trim().length < 3) continue;

            const slide = pptx.addSlide();
            slide.background = { color: templateColors.bg };

            // Sarlavha va kontentni ajratish
            let title = '';
            let content = '';
            
            if (s.includes('|')) {
                const parts = s.split('|').map(p => p.trim());
                title = parts[0].replace(/^\d+[:.\-]?\s*/, '').trim();
                content = parts.slice(1).join('\n\n');
            } else {
                const lines = s.split('\n').filter(l => l.trim());
                title = lines[0] ? lines[0].replace(/^\d+[:.\-]?\s*/, '').trim() : `${topic} - ${i + 1}`;
                content = lines.slice(1).join('\n\n');
            }

            // Title bar
            slide.addShape(pptx.ShapeType.rect, {
                x: 0, y: 0, w: '100%', h: 1.2,
                fill: { color: templateColors.primary }
            });

            slide.addText(title || `${topic} - ${i + 1}`, {
                x: 0.5, y: 0.3, w: '90%',
                fontSize: 24,
                bold: true,
                color: 'FFFFFF',
                fontFace: fontFace
            });

            // Content
            if (content) {
                slide.addText(content, {
                    x: 0.5, y: 1.5, w: '90%',
                    fontSize: 16,
                    color: templateColors.text,
                    fontFace: fontFace,
                    lineSpacing: 28
                });
            }

            // Sahifa raqami
            slide.addText(`${i + 1} / ${maxSlides}`, {
                x: 8.5, y: 5.0, w: 1,
                fontSize: 10,
                color: '999999',
                align: 'right'
            });

            actualCount++;
        }

        const name = path.join(__dirname, `Slayd_${userId}_${Date.now()}.pptx`);
        await pptx.writeFile({ fileName: name });
        console.log(`Slayd yaratildi: ${name} (${actualCount} ta slayd)`);
        return name;
    } catch (err) {
        console.error("Slayd yaratish xatosi:", err);
        throw err;
    }
}

async function createCrosswordPPTX(topic, aiContent, userId, questionCount) {
    try {
        const pptx = new PptxGenJS();
        const user = getUser(userId);
        pptx.layout = 'LAYOUT_16x9';

        // Savollarni ajratib olish
        const questions = aiContent.split(/SAVOL:/i).filter(s => s.trim().length > 3);
        const validQuestions = [];
        
        questions.forEach(q => {
            const parts = q.split('|').map(p => p.trim()).filter(p => p);
            if (parts.length >= 2) {
                validQuestions.push({
                    num: parts[0]?.replace(/\D/g, '') || (validQuestions.length + 1),
                    text: parts[1] || parts[0],
                    answer: parts[2] || ''
                });
            }
        });

        const count = Math.min(validQuestions.length, questionCount);

        // 1-bet: Muqova
        const cover = pptx.addSlide();
        cover.background = { color: '1B5E20' };
        cover.addText(`Krassvord`, { x: 0.5, y: 1.0, w: '90%', fontSize: 40, bold: true, color: 'FFFFFF', align: 'center' });
        cover.addText(`Mavzu: ${topic}`, { x: 0.5, y: 2.2, w: '90%', fontSize: 22, color: 'C8E6C9', align: 'center' });
        cover.addText(`${count} ta savol\nTayyorlandi: SlaydTop AI`, { x: 0.5, y: 3.0, w: '90%', fontSize: 14, color: 'A5D6A7', align: 'center' });

        // 2-bet: Savollar ro'yxati
        const slide1 = pptx.addSlide();
        slide1.background = { color: 'E8F5E9' };
        slide1.addText(`Savollar ro'yxati`, { x: 0.5, y: 0.3, w: '90%', fontSize: 24, bold: true, color: '1B5E20' });

        let qText = '';
        validQuestions.slice(0, count).forEach((q, i) => {
            qText += `${i + 1}. ${q.text}\n`;
        });
        slide1.addText(qText, { x: 0.5, y: 1.0, w: '90%', fontSize: 14, color: '333333', lineSpacing: 24 });

        // 3-bet: Katakchalar uchun ko'rsatma
        const slide2 = pptx.addSlide();
        slide2.background = { color: 'FFF8E1' };
        slide2.addText(`Krassvord katakchalari`, { x: 0.5, y: 0.3, w: '90%', fontSize: 24, bold: true, color: 'E65100' });
        slide2.addText(`Quyida katakchalar uchun javoblarni ko'rishingiz mumkin. O'quvchilar uchun bu sahifani yashiring!`, 
            { x: 0.5, y: 1.2, w: '90%', fontSize: 14, color: '666666' });

        // Javoblarni ko'rsatish
        let answerGrid = '';
        validQuestions.slice(0, count).forEach((q, i) => {
            const answer = q.answer.replace(/[^\w]/g, '').toUpperCase();
            answerGrid += `${i + 1}. ${answer} (${answer.length} harf)\n`;
        });
        slide2.addText(answerGrid, { x: 0.5, y: 2.0, w: '90%', fontSize: 14, color: '333333', lineSpacing: 22 });

        // 4-bet: Javoblar kaliti
        const slide3 = pptx.addSlide();
        slide3.background = { color: 'E3F2FD' };
        slide3.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.2, fill: { color: '1565C0' } });
        slide3.addText(`Javoblar Kaliti`, { x: 0.5, y: 0.3, w: '90%', fontSize: 24, bold: true, color: 'FFFFFF' });

        let aText = '';
        validQuestions.slice(0, count).forEach((q, i) => {
            aText += `${i + 1}. ${q.answer}\n`;
        });
        slide3.addText(aText, { x: 0.5, y: 1.5, w: '90%', fontSize: 16, color: '333333', lineSpacing: 28 });

        const name = path.join(__dirname, `Krassvord_${userId}_${Date.now()}.pptx`);
        await pptx.writeFile({ fileName: name });
        return name;
    } catch (err) {
        console.error("Krassvord yaratish xatosi:", err);
        throw err;
    }
}

async function createTestPPTX(topic, aiContent, userId, testCount, difficulty) {
    try {
        const pptx = new PptxGenJS();
        const user = getUser(userId);
        pptx.layout = 'LAYOUT_16x9';

        const tests = aiContent.split(/TEST:/i).filter(s => s.trim().length > 3);
        const validTests = [];

        tests.forEach(t => {
            const parts = t.split('|').map(p => p.trim()).filter(p => p);
            if (parts.length >= 3) {
                validTests.push({
                    num: parts[0]?.replace(/\D/g, '') || (validTests.length + 1),
                    question: parts[1] || '',
                    options: parts.slice(2, -1),
                    answer: parts[parts.length - 1] || ''
                });
            }
        });

        const count = Math.min(validTests.length, testCount);

        // Muqova
        const cover = pptx.addSlide();
        cover.background = { color: '4A148C' };
        cover.addText(`Test`, { x: 0.5, y: 1.0, w: '90%', fontSize: 40, bold: true, color: 'FFFFFF', align: 'center' });
        cover.addText(`Mavzu: ${topic}\nDaraja: ${difficulty}\n${count} ta savol`, 
            { x: 0.5, y: 2.2, w: '90%', fontSize: 18, color: 'E1BEE7', align: 'center' });

        // Savollar - har 2 test uchun 1 slayd
        for (let i = 0; i < count; i += 2) {
            const slide = pptx.addSlide();
            slide.background = { color: 'F3E5F5' };
            slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: '7B1FA2' } });
            slide.addText(`Test savollari (${i + 1}-${Math.min(i + 2, count)})`, 
                { x: 0.5, y: 0.15, w: '90%', fontSize: 18, bold: true, color: 'FFFFFF' });

            let yPos = 1.0;
            for (let j = i; j < Math.min(i + 2, count); j++) {
                const t = validTests[j];
                slide.addText(`${j + 1}. ${t.question}`, 
                    { x: 0.5, y: yPos, w: '90%', fontSize: 13, bold: true, color: '4A148C' });
                yPos += 0.4;
                
                t.options.forEach(opt => {
                    slide.addText(`   ${opt}`, { x: 0.8, y: yPos, w: '85%', fontSize: 12, color: '333333' });
                    yPos += 0.3;
                });
                yPos += 0.3;
            }
        }

        // Javoblar kaliti
        const slide2 = pptx.addSlide();
        slide2.background = { color: 'E8F5E9' };
        slide2.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.2, fill: { color: '2E7D32' } });
        slide2.addText(`Javoblar Kaliti`, { x: 0.5, y: 0.3, w: '90%', fontSize: 24, bold: true, color: 'FFFFFF' });

        let keyText = '';
        validTests.slice(0, count).forEach((t, i) => {
            const match = t.answer.match(/[A-D]/);
            keyText += `${i + 1}. ${match ? match[0] : '?'}  `;
            if ((i + 1) % 5 === 0) keyText += '\n';
        });
        slide2.addText(keyText, { x: 0.5, y: 1.5, w: '90%', fontSize: 18, color: '333333', lineSpacing: 32 });

        const name = path.join(__dirname, `Test_${userId}_${Date.now()}.pptx`);
        await pptx.writeFile({ fileName: name });
        return name;
    } catch (err) {
        console.error("Test yaratish xatosi:", err);
        throw err;
    }
}

async function createEssayPPTX(topic, aiContent, userId, type, wordCount) {
    try {
        const pptx = new PptxGenJS();
        const user = getUser(userId);
        pptx.layout = 'LAYOUT_16x9';

        // Muqova
        const cover = pptx.addSlide();
        cover.background = { color: '37474F' };
        cover.addText(type === 'insho' ? 'INSHO' : 'ESSE', 
            { x: 0.5, y: 1.2, w: '90%', fontSize: 42, bold: true, color: 'FFFFFF', align: 'center' });
        cover.addText(`Mavzu: ${topic}`, 
            { x: 0.5, y: 2.2, w: '90%', fontSize: 20, color: 'B0BEC5', align: 'center' });
        cover.addText(`${wordCount} so'z\n${user.name || ''} ${user.surname || ''}\n${user.university || ''} | ${user.group || ''}`, 
            { x: 0.5, y: 3.0, w: '90%', fontSize: 14, color: '90A4AE', align: 'center' });

        // Asosiy matn
        const slide = pptx.addSlide();
        slide.background = { color: 'ECEFF1' };
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: '546E7A' } });
        slide.addText(topic, { x: 0.5, y: 0.15, w: '90%', fontSize: 18, bold: true, color: 'FFFFFF' });
        
        slide.addText(aiContent, { x: 0.5, y: 1.1, w: '90%', fontSize: 13, color: '333333', lineSpacing: 22 });

        const name = path.join(__dirname, `${type === 'insho' ? 'Insho' : 'Esse'}_${userId}_${Date.now()}.pptx`);
        await pptx.writeFile({ fileName: name });
        return name;
    } catch (err) {
        console.error("Insho/Esse yaratish xatosi:", err);
        throw err;
    }
}

async function createReferatPPTX(topic, aiContent, userId, type, pageCount) {
    try {
        const pptx = new PptxGenJS();
        const user = getUser(userId);
        pptx.layout = 'LAYOUT_16x9';

        const pages = aiContent.split(/BET:|Bet:|B:/i).filter(s => s.trim().length > 3);
        const validPages = [];

        pages.forEach(p => {
            const parts = p.split('|').map(x => x.trim()).filter(x => x);
            if (parts.length >= 2) {
                validPages.push({
                    title: parts[1] || parts[0],
                    content: parts.slice(2).join('\n\n') || parts[0]
                });
            }
        });

        // Muqova
        const cover = pptx.addSlide();
        cover.background = { color: '263238' };
        cover.addText(type === 'referat' ? 'REFERAT' : 'MUSTAQIL ISH', 
            { x: 0.5, y: 1.2, w: '90%', fontSize: 38, bold: true, color: 'FFFFFF', align: 'center' });
        cover.addText(`Mavzu: ${topic}`, 
            { x: 0.5, y: 2.2, w: '90%', fontSize: 20, color: 'B0BEC5', align: 'center' });
        cover.addText(`Bajardi: ${user.name || ''} ${user.surname || ''}\nGuruh: ${user.group || ''}\n${user.university || ''}`, 
            { x: 0.5, y: 3.2, w: '90%', fontSize: 14, color: '90A4AE', align: 'center' });

        // Har bir sahifa
        const count = Math.min(validPages.length, pageCount);
        for (let i = 0; i < count; i++) {
            const p = validPages[i];
            const slide = pptx.addSlide();
            slide.background = { color: 'FAFAFA' };
            
            slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.0, fill: { color: '37474F' } });
            slide.addText(p.title || `Sahifa ${i + 1}`, 
                { x: 0.5, y: 0.25, w: '90%', fontSize: 20, bold: true, color: 'FFFFFF' });
            
            slide.addText(p.content || '', 
                { x: 0.5, y: 1.3, w: '90%', fontSize: 14, color: '333333', lineSpacing: 24 });
            
            slide.addText(`${i + 1}`, { x: 8.5, y: 5.0, w: 1, fontSize: 10, color: '999999', align: 'right' });
        }

        const name = path.join(__dirname, `${type === 'referat' ? 'Referat' : 'MustaqilIsh'}_${userId}_${Date.now()}.pptx`);
        await pptx.writeFile({ fileName: name });
        return name;
    } catch (err) {
        console.error("Referat yaratish xatosi:", err);
        throw err;
    }
}

async function createTezisPPTX(topic, aiContent, userId, wordCount) {
    try {
        const pptx = new PptxGenJS();
        const user = getUser(userId);
        pptx.layout = 'LAYOUT_16x9';

        // Muqova
        const cover = pptx.addSlide();
        cover.background = { color: '283593' };
        cover.addText('TEZIS', { x: 0.5, y: 1.0, w: '90%', fontSize: 40, bold: true, color: 'FFFFFF', align: 'center' });
        cover.addText(`Mavzu: ${topic}`, 
            { x: 0.5, y: 2.0, w: '90%', fontSize: 20, color: 'C5CAE9', align: 'center' });
        cover.addText(`${user.name || ''} ${user.surname || ''}\n${user.university || ''}\n${wordCount} so'z`, 
            { x: 0.5, y: 2.8, w: '90%', fontSize: 14, color: '9FA8DA', align: 'center' });

        // Asosiy matn
        const slide = pptx.addSlide();
        slide.background = { color: 'E8EAF6' };
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: '3949AB' } });
        slide.addText(topic, { x: 0.5, y: 0.15, w: '90%', fontSize: 18, bold: true, color: 'FFFFFF' });
        slide.addText(aiContent, { x: 0.5, y: 1.1, w: '90%', fontSize: 13, color: '333333', lineSpacing: 22 });

        const name = path.join(__dirname, `Tezis_${userId}_${Date.now()}.pptx`);
        await pptx.writeFile({ fileName: name });
        return name;
    } catch (err) {
        console.error("Tezis yaratish xatosi:", err);
        throw err;
    }
}

async function createGlossaryPPTX(topic, aiContent, userId, count) {
    try {
        const pptx = new PptxGenJS();
        const user = getUser(userId);
        pptx.layout = 'LAYOUT_16x9';

        const items = aiContent.split(/SOZ:/i).filter(s => s.trim().length > 3);
        const validItems = [];

        items.forEach(item => {
            const parts = item.split('|').map(p => p.trim()).filter(p => p);
            if (parts.length >= 3) {
                validItems.push({
                    word: parts[1] || '',
                    language: parts[2] || '',
                    definition: parts[3] || ''
                });
            }
        });

        // Muqova
        const cover = pptx.addSlide();
        cover.background = { color: 'F57F17' };
        cover.addText('GLOSSARIY', { x: 0.5, y: 1.0, w: '90%', fontSize: 40, bold: true, color: 'FFFFFF', align: 'center' });
        cover.addText(`Mavzu: ${topic}\n${Math.min(validItems.length, count)} ta termin`, 
            { x: 0.5, y: 2.2, w: '90%', fontSize: 18, color: 'FFF9C4', align: 'center' });

        // Har 6 ta so'z uchun 1 slayd
        const totalItems = Math.min(validItems.length, count);
        for (let i = 0; i < totalItems; i += 6) {
            const slide = pptx.addSlide();
            slide.background = { color: 'FFF8E1' };
            slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: 'F9A825' } });
            slide.addText(`Glossariy (${i + 1}-${Math.min(i + 6, totalItems)})`, 
                { x: 0.5, y: 0.15, w: '90%', fontSize: 18, bold: true, color: 'FFFFFF' });

            let yPos = 1.0;
            for (let j = i; j < Math.min(i + 6, totalItems); j++) {
                const item = validItems[j];
                slide.addText(`${j + 1}. ${item.word} ${item.language ? `(${item.language})` : ''}`, 
                    { x: 0.5, y: yPos, w: '90%', fontSize: 13, bold: true, color: 'F57F17' });
                yPos += 0.35;
                slide.addText(`   ${item.definition}`, 
                    { x: 0.8, y: yPos, w: '85%', fontSize: 12, color: '333333', lineSpacing: 18 });
                yPos += 0.6;
            }
        }

        const name = path.join(__dirname, `Glossariy_${userId}_${Date.now()}.pptx`);
        await pptx.writeFile({ fileName: name });
        return name;
    } catch (err) {
        console.error("Glossariy yaratish xatosi:", err);
        throw err;
    }
}

// ==================== BOT YARATISH ====================
const bot = new Telegraf(token);
bot.use(session());

bot.use((ctx, next) => {
    if (!ctx.session) ctx.session = {};
    return next();
});

// ==================== REGISTRATSIYA ====================
async function handleRegistration(ctx) {
    const userId = ctx.from.id;
    const user = getUser(userId);
    const text = ctx.message?.text || '';

    if (user.registered) return true;

    if (user.step === 'WAITING_NAME') {
        if (!text || text.length < 2) {
            return ctx.reply(`${E.warning} Iltimos, to'g'ri ism kiriting:`);
        }
        updateUser(userId, { name: text, step: 'WAITING_SURNAME' });
        return ctx.reply(`${E.smile} Juda yaxshi! Endi familyangizni kiriting:`);
    }

    if (user.step === 'WAITING_SURNAME') {
        if (!text || text.length < 2) {
            return ctx.reply(`${E.warning} Iltimos, to'g'ri familya kiriting:`);
        }
        updateUser(userId, { surname: text, step: 'WAITING_UNIVERSITY' });
        return ctx.reply(`${E.university} Ajoyib! O'qiyotgan universitet / maktabingiz nomini kiriting:`);
    }

    if (user.step === 'WAITING_UNIVERSITY') {
        if (!text || text.length < 2) {
            return ctx.reply(`${E.warning} Iltimos, to'g'ri universitet nomini kiriting:`);
        }
        updateUser(userId, { university: text, step: 'WAITING_GROUP' });
        return ctx.reply(`${E.group} Zo'r! Guruh / sinfingizni kiriting (masalan: 321-guruh):`);
    }

    if (user.step === 'WAITING_GROUP') {
        if (!text || text.length < 2) {
            return ctx.reply(`${E.warning} Iltimos, to'g'ri guruh kiriting:`);
        }
        updateUser(userId, { group: text, registered: true, step: 'MAIN_MENU', freeSlidesUsed: 0 });
        await ctx.reply(
            `${E.trophy} Tabriklaymiz, ${user.name}! Ro'yxatdan o'tdingiz!\n\n` +
            `${E.gift} Sizga 2 ta BEPUL slayd sovg'a!\n` +
            `${E.rocket} Keling, birga ajoyib ishlar yaratalim!`,
            Keyboards.mainMenu(userId === adminId)
        );
        return false;
    }

    return true;
}

// ==================== START ====================
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);

    if (!user.registered) {
        updateUser(userId, { step: 'WAITING_NAME' });
        return ctx.reply(
            `${E.magic} SlaydTop AI botiga xush kelibsiz! ${E.heart}\n\n` +
            `Men sizga professional slaydlar, testlar, krassvordlar va boshqa foydali materiallar yaratib beraman!\n\n` +
            `${E.smile} Avval ro'yxatdan o'taylik. Ismingizni kiriting:`
        );
    }

    return ctx.reply(
        `${E.magic} Qaytib kelganingizdan xursandmiz, ${user.name}! ${E.wink}\n` +
        `Nima yaratamiz bugun?`,
        Keyboards.mainMenu(userId === adminId)
    );
});

// ==================== ASOSIY MENYU HANDLERLARI ====================
bot.hears(`${E.magic} Slayd Yaratish`, async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return handleRegistration(ctx);

    updateUser(userId, { step: 'SLAYD_TOPIC' });
    ctx.reply(
        `${E.pencil} Ajoyib! Mavzuni kiriting!\n\n` +
        `Masalan: "O'zbekistonning diqqatga sazovor joylari"`,
        Keyboards.cancel()
    );
});

bot.hears(`${E.money} Hisobim`, async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return handleRegistration(ctx);

    const freeLeft = Math.max(0, 2 - (user.freeSlidesUsed || 0));

    ctx.reply(
        `${E.money} Sizning hisobingiz\n\n` +
        `${E.smile} Ism: ${user.name} ${user.surname}\n` +
        `${E.university} Universitet: ${user.university}\n` +
        `${E.group} Guruh: ${user.group}\n` +
        `${E.money} Balans: ${(user.balance || 0).toLocaleString()} so'm\n` +
        `${E.gift} Bepul slaydlar: ${freeLeft} ta qoldi\n` +
        `${E.chart} Jami yaratilgan slaydlar: ${user.totalSlides || 0}\n\n` +
        `Pul yuklash uchun "Do'stlarni Taklif Qilish" yoki to'lov qiling!`,
        Keyboards.mainMenu(userId === adminId)
    );
});

bot.hears(`${E.gift} Do'stlarni Taklif Qilish`, async (ctx) => {
    const userId = ctx.from.id;
    const inviteLink = `https://t.me/${ctx.botInfo?.username || 'SlaydTopBot'}?start=ref_${userId}`;
    ctx.reply(
        `${E.gift} Do'stlaringizni taklif qiling va BEPUL slayd oling!\n\n` +
        `Har bir ro'yxatdan o'tgan do'stingiz uchun +1 bepul slayd!\n\n` +
        `Sizning havolangiz:\n${inviteLink}\n\n` +
        `${E.rocket} Do'stlaringizga ulashing!`,
        Keyboards.mainMenu(userId === adminId)
    );
});

bot.hears(`${E.settings} Sozlamalar`, async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    ctx.reply(
        `${E.settings} Sozlamalar\n\n` +
        `${E.pen} Shrift: ${user.settings?.font || 'Arial'}\n` +
        `${E.smile} Ism: ${user.name}\n` +
        `${E.smile} Familya: ${user.surname}\n` +
        `${E.university} Universitet: ${user.university}\n` +
        `${E.group} Guruh: ${user.group}\n\n` +
        `Shriftni o'zgartirish uchun /font komandasini yuboring`,
        Keyboards.mainMenu(userId === adminId)
    );
});

bot.hears(`${E.admin} Adminga Murojaat`, async (ctx) => {
    const userId = ctx.from.id;
    updateUser(userId, { step: 'CONTACT_ADMIN' });
    ctx.reply(
        `${E.admin} Adminga xabar yuborish. Iltimos, xabaringizni yozing:`,
        Keyboards.cancel()
    );
});

// ==================== KRASSVORD ====================
bot.hears(`${E.grid} Krassvord`, async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return handleRegistration(ctx);

    updateUser(userId, { step: 'CROSSWORD_TOPIC' });
    ctx.reply(
        `${E.grid} Krassvord mavzusini kiriting:\n` +
        `Masalan: "O'zbekiston tarixi"`,
        Keyboards.cancel()
    );
});

// ==================== TEST ====================
bot.hears(`${E.quiz} Test`, async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return handleRegistration(ctx);

    updateUser(userId, { step: 'TEST_TOPIC' });
    ctx.reply(
        `${E.quiz} Test mavzusini kiriting:\n` +
        `Masalan: "Biologiya - O'simliklar dunyosi"`,
        Keyboards.cancel()
    );
});

// ==================== INSHO/ESSE ====================
bot.hears(`${E.essay} Insho/Esse`, async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return handleRegistration(ctx);

    updateUser(userId, { step: 'ESSAY_TYPE' });
    ctx.reply(
        `${E.essay} Qaysi turini tanlaysiz?\n\n` +
        `${E.money} 1 ta so'z = 10 so'm\n` +
        `Masalan: 700 so'z = 7,000 so'm`,
        Keyboards.essayType()
    );
});

// ==================== REFERAT/MUSTAQIL ====================
bot.hears(`${E.doc} Referat/Mustaqil`, async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return handleRegistration(ctx);

    updateUser(userId, { step: 'REFERRAL_TYPE' });
    ctx.reply(
        `${E.doc} Qaysi turini tanlaysiz?\n\n` +
        `${E.money} 1 ta bet = 500 so'm\n` +
        `Masalan: 10 bet = 5,000 so'm`,
        Keyboards.referatType()
    );
});

// ==================== TEZIS ====================
bot.hears(`${E.pen} Tezis`, async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return handleRegistration(ctx);

    updateUser(userId, { step: 'TEZIS_TOPIC' });
    ctx.reply(
        `${E.pen} Tezis mavzusini kiriting:\n` +
        `${E.money} 1 ta so'z = 10 so'm`,
        Keyboards.cancel()
    );
});

// ==================== GLOSSARIY ====================
bot.hears(`${E.book} Glossariy`, async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return handleRegistration(ctx);

    updateUser(userId, { step: 'GLOSSARY_TOPIC' });
    ctx.reply(
        `${E.book} Glossariy mavzusini kiriting:\n` +
        `${E.money} 1 ta so'z = 200 so'm\n` +
        `Masalan: 10 ta = 2,000 so'm`,
        Keyboards.cancel()
    );
});

// ==================== SHABLONLAR ====================
bot.hears(`${E.pic} Shablonlar`, async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    if (!user.registered) return handleRegistration(ctx);

    const templates = getTemplates();
    if (templates.length === 0) {
        return ctx.reply(
            `${E.warning} Hozircha shablonlar mavjud emas.\n\n` +
            `${E.info} Shablonlarni templates/ papkasiga qo'ying:\n` +
            `- template_01.pptx\n- template_02.pptx\n...\n- template_50.pptx\n\n` +
            `${E.magic} Shablonsiz yaratish bepul va ishladi!`,
            Keyboards.mainMenu(userId === adminId)
        );
    }

    let msg = `${E.pic} Mavjud shablonlar (${templates.length} ta):\n\n`;
    templates.forEach((t, i) => {
        const price = t.price || 0;
        msg += `${i + 1}. ${t.name}${price > 0 ? ` - ${price.toLocaleString()} so'm` : ''}\n`;
    });
    msg += `\n${E.info} Slayd yaratishda shablon ID raqamini tanlashingiz mumkin.`;

    ctx.reply(msg, Keyboards.mainMenu(userId === adminId));
});

// ==================== ASOSIY MATN HANDLER ====================
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    let user = getUser(userId);
    const text = ctx.message.text;

    // Ro'yxatdan o'tish
    if (!user.registered) {
        return handleRegistration(ctx);
    }

    // Admin javob
    if (user.step === 'CONTACT_ADMIN' && !text.includes('Bekor')) {
        if (adminId) {
            await bot.telegram.sendMessage(adminId,
                `${E.admin} Yangi murojaat!\n\n` +
                `Kim: ${user.name} ${user.surname} (@${ctx.from.username || 'yo\'q'})\n` +
                `ID: ${userId}\n\n` +
                `Xabar: ${text}`
            );
        }
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(
            `${E.check} Xabaringiz adminga yuborildi! Tez orada javob beramiz!`,
            Keyboards.mainMenu(userId === adminId)
        );
    }

    // === SLAYD TOPIC ===
    if (user.step === 'SLAYD_TOPIC') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        if (text.length < 3) {
            return ctx.reply(`${E.warning} Mavzu juda qisqa. Iltimos, batafsilroq yozing:`);
        }
        ctx.session.topic = text;
        updateUser(userId, { step: 'SLAYD_COUNT' });
        return ctx.reply(
            `${E.smile} Ajoyib mavzu! ${E.fire}\n\n` +
            `Nechta slayd bo'lishini tanlang?`,
            Keyboards.slideCount()
        );
    }

    // === SLAYD COUNT ===
    if (user.step === 'SLAYD_COUNT') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }

        const count = parseInt(text.replace(/\D/g, ''));
        if (isNaN(count) || count < 1 || count > 25) {
            return ctx.reply(`${E.warning} Iltimos, 1 dan 25 gacha son kiriting:`);
        }

        ctx.session.slideCount = count;

        // Narxni hisoblash
        let price = 0;
        const isFree = (user.freeSlidesUsed || 0) < 2;

        if (!isFree) {
            const pkg = getSlidePackage(count);
            price = pkg.price;
            ctx.session.slidePrice = price;

            if (user.balance < price) {
                ctx.session.neededAmount = price;
                updateUser(userId, { step: 'NEED_PAYMENT' });
                return ctx.reply(
                    `${E.money} Hisobingizda yetarli mablag' yo'q!\n\n` +
                    `Kerak: ${price.toLocaleString()} so'm\n` +
                    `Balans: ${(user.balance || 0).toLocaleString()} so'm\n\n` +
                    `To'lov qilasizmi?`,
                    Keyboards.paymentMethods()
                );
            }
        }

        ctx.session.slidePrice = price;
        updateUser(userId, { step: 'SLAYD_TEMPLATE' });
        return ctx.reply(
            `${E.pic} Shablon tanlaysizmi?\n\n` +
            `${E.magic} Shablonlar bilan yanada chiroyli bo'ladi!`,
            Keyboards.templateMenu()
        );
    }

    // === SLAYD TEMPLATE ===
    if (user.step === 'SLAYD_TEMPLATE') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        if (text.includes('Oddiy') || text.includes('Shablonsiz')) {
            ctx.session.templateId = null;
            return generateAndSendSlides(ctx, userId);
        }
        if (text.includes('Ko\'rish')) {
            const templates = getTemplates();
            if (templates.length === 0) {
                return ctx.reply(`${E.warning} Shablonlar mavjud emas. Shablonsiz yaratamiz!`, Keyboards.templateMenu());
            }
            let msg = `${E.pic} Shablonlar ro'yxati:\n\n`;
            templates.forEach((t, i) => {
                msg += `${i + 1}. ${t.name}\n`;
            });
            msg += `\nRaqamini kiriting yoki "Shablonsiz" tugmasini bosing:`;
            return ctx.reply(msg, Keyboards.templateMenu());
        }

        // Shablon ID sini tekshirish
        const templates = getTemplates();
        const templateIdx = parseInt(text) - 1;
        if (templateIdx >= 0 && templateIdx < templates.length) {
            ctx.session.templateId = templates[templateIdx].id;
            return generateAndSendSlides(ctx, userId);
        } else {
            return ctx.reply(`${E.warning} Noto'g'ri raqam. Iltimos, qayta kiriting:`, Keyboards.templateMenu());
        }
    }

    // === TO'LOV JARAYONI ===
    if (user.step === 'NEED_PAYMENT') {
        if (text.includes('Click')) {
            updateUser(userId, { step: 'WAITING_CLICK_CHECK' });
            return ctx.reply(
                `${E.card} CLICK orqali to'lov\n\n` +
                `${E.money} To'lov summasi: ${(ctx.session.neededAmount || 0).toLocaleString()} so'm\n\n` +
                `${E.card} Karta raqami: 4067070008936564\n` +
                `${E.smile} Egasining ismi: Yo'ldoshev Sardor\n\n` +
                `${E.info} To'lov qilganingizdan so'ng, chekni skrinshot qilib yuboring!`,
                Keyboards.confirmPayment()
            );
        }
        if (text.includes('Payme')) {
            updateUser(userId, { step: 'WAITING_PAYME_CHECK' });
            return ctx.reply(
                `${E.card} PAYME orqali to'lov\n\n` +
                `${E.money} To'lov summasi: ${(ctx.session.neededAmount || 0).toLocaleString()} so'm\n\n` +
                `${E.card} Karta raqami: 4067070008936564\n` +
                `${E.smile} Egasining ismi: Yo'ldoshev Sardor\n\n` +
                `${E.info} To'lov qilganingizdan so'ng, chekni skrinshot qilib yuboring!`,
                Keyboards.confirmPayment()
            );
        }
        if (text.includes('Admin')) {
            return ctx.reply(
                `${E.admin} Admin bilan bog'lanish:\n` +
                `Telegram: @${adminUsername || 'admin'}\n` +
                `Tel: ${adminPhone}`,
                Keyboards.mainMenu(userId === adminId)
            );
        }
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
    }

    // === KRASSVORD TOPIC ===
    if (user.step === 'CROSSWORD_TOPIC') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        if (text.length < 3) {
            return ctx.reply(`${E.warning} Mavzu juda qisqa:`);
        }
        ctx.session.crosswordTopic = text;
        updateUser(userId, { step: 'CROSSWORD_COUNT' });
        return ctx.reply(`${E.grid} Nechta savol bo'lishini tanlang:`, Keyboards.crosswordCount());
    }

    // === KRASSVORD COUNT ===
    if (user.step === 'CROSSWORD_COUNT') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }

        let count = 10, price = 1000;
        if (text.includes('15')) { count = 15; price = 2000; }
        else if (text.includes('20')) { count = 20; price = 3000; }

        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            ctx.session.pendingType = 'crossword';
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(
                `${E.money} Hisobingizda ${price.toLocaleString()} so'm yo'q!\n` +
                `Balans: ${(user.balance || 0).toLocaleString()} so'm`,
                Keyboards.paymentMethods()
            );
        }

        updateUser(userId, { balance: (user.balance || 0) - price });
        ctx.reply(`${E.clock} ${count} ta savoldan iborat krassvord yaratilmoqda... ${E.magic}`);

        try {
            const aiContent = await getAIContent(ctx.session.crosswordTopic, count, 'crossword');
            if (!aiContent) {
                updateUser(userId, { balance: (user.balance || 0) + price });
                return ctx.reply(`${E.wrong} AI xatolik. Qayta urinib ko'ring.`, Keyboards.mainMenu(userId === adminId));
            }

            const fileName = await createCrosswordPPTX(ctx.session.crosswordTopic, aiContent, userId, count);
            await ctx.replyWithDocument({ source: fileName }, {
                caption: `${E.check} Krassvord tayyor! ${E.trophy}\n${count} ta savol | ${price.toLocaleString()} so'm`
            });
            addOrder(userId, 'crossword', { topic: ctx.session.crosswordTopic, count, price }, fileName);
            if (fs.existsSync(fileName)) fs.unlinkSync(fileName);

            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.clap} Marhamat!`, Keyboards.mainMenu(userId === adminId));
        } catch (err) {
            console.error("Krassvord xatolik:", err);
            updateUser(userId, { balance: (user.balance || 0) + price });
            return ctx.reply(`${E.wrong} Xatolik: ${err.message}`, Keyboards.mainMenu(userId === adminId));
        }
    }

    // === TEST TOPIC ===
    if (user.step === 'TEST_TOPIC') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        ctx.session.testTopic = text;
        updateUser(userId, { step: 'TEST_COUNT' });
        return ctx.reply(`${E.quiz} Nechta test bo'lishini tanlang:`, Keyboards.testCount());
    }

    // === TEST COUNT ===
    if (user.step === 'TEST_COUNT') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }

        let count = 1, price = 100;
        if (text.includes('5')) { count = 5; price = 500; }
        else if (text.includes('10')) { count = 10; price = 1000; }

        ctx.session.testCount = count;
        ctx.session.testPrice = price;
        updateUser(userId, { step: 'TEST_DIFFICULTY' });
        return ctx.reply(`${E.brain} Qiyinchilik darajasini tanlang:`, Keyboards.difficulty());
    }

    // === TEST DIFFICULTY ===
    if (user.step === 'TEST_DIFFICULTY') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }

        let difficulty = "O'rta";
        if (text.includes('Oson')) difficulty = 'Oson';
        else if (text.includes('Murakkab')) difficulty = 'Murakkab';

        const price = ctx.session.testPrice || 100;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(
                `${E.money} Hisobingizda ${price.toLocaleString()} so'm yo'q!`,
                Keyboards.paymentMethods()
            );
        }

        updateUser(userId, { balance: (user.balance || 0) - price });
        ctx.reply(`${E.clock} ${ctx.session.testCount} ta test yaratilmoqda (${difficulty})... ${E.magic}`);

        try {
            const aiContent = await getAIContent(ctx.session.testTopic, ctx.session.testCount, 'test', { difficulty });
            if (!aiContent) {
                updateUser(userId, { balance: (user.balance || 0) + price });
                return ctx.reply(`${E.wrong} AI xatolik.`, Keyboards.mainMenu(userId === adminId));
            }

            const fileName = await createTestPPTX(ctx.session.testTopic, aiContent, userId, ctx.session.testCount, difficulty);
            await ctx.replyWithDocument({ source: fileName }, {
                caption: `${E.check} Test tayyor! ${E.trophy}\n${ctx.session.testCount} ta | ${difficulty}\n${price.toLocaleString()} so'm`
            });
            addOrder(userId, 'test', { topic: ctx.session.testTopic, count: ctx.session.testCount, difficulty, price }, fileName);
            if (fs.existsSync(fileName)) fs.unlinkSync(fileName);

            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.clap} Marhamat!`, Keyboards.mainMenu(userId === adminId));
        } catch (err) {
            console.error("Test xatolik:", err);
            updateUser(userId, { balance: (user.balance || 0) + price });
            return ctx.reply(`${E.wrong} Xatolik: ${err.message}`, Keyboards.mainMenu(userId === adminId));
        }
    }

    // === ESSAY TYPE ===
    if (user.step === 'ESSAY_TYPE') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        if (text.includes('Insho')) ctx.session.essayType = 'insho';
        else if (text.includes('Esse')) ctx.session.essayType = 'essey';

        updateUser(userId, { step: 'ESSAY_TOPIC' });
        return ctx.reply(`${E.pencil} Mavzuni kiriting:`);
    }

    // === ESSAY TOPIC ===
    if (user.step === 'ESSAY_TOPIC') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        ctx.session.essayTopic = text;
        updateUser(userId, { step: 'ESSAY_WORDS' });
        return ctx.reply(`${E.info} Nechta so'z bo'lishini kiriting (masalan: 700):`);
    }

    // === ESSAY WORDS ===
    if (user.step === 'ESSAY_WORDS') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        const words = parseInt(text.replace(/\D/g, ''));
        if (isNaN(words) || words < 100) {
            return ctx.reply(`${E.warning} Kamida 100 so'z kiriting:`);
        }

        const price = words * 10;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(
                `${E.money} ${price.toLocaleString()} so'm kerak!\nBalans: ${(user.balance || 0).toLocaleString()} so'm`,
                Keyboards.paymentMethods()
            );
        }

        updateUser(userId, { balance: (user.balance || 0) - price });
        ctx.reply(`${E.clock} ${words} so'zli ${ctx.session.essayType === 'insho' ? 'insho' : 'esse'} yaratilmoqda... ${E.magic}`);

        try {
            const aiContent = await getAIContent(ctx.session.essayTopic, words, ctx.session.essayType);
            if (!aiContent) {
                updateUser(userId, { balance: (user.balance || 0) + price });
                return ctx.reply(`${E.wrong} AI xatolik.`, Keyboards.mainMenu(userId === adminId));
            }

            const fileName = await createEssayPPTX(ctx.session.essayTopic, aiContent, userId, ctx.session.essayType, words);
            await ctx.replyWithDocument({ source: fileName }, {
                caption: `${E.check} ${ctx.session.essayType === 'insho' ? 'Insho' : 'Esse'} tayyor! ${E.trophy}\n${words} so'z | ${price.toLocaleString()} so'm`
            });
            addOrder(userId, ctx.session.essayType, { topic: ctx.session.essayTopic, words, price }, fileName);
            if (fs.existsSync(fileName)) fs.unlinkSync(fileName);

            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.clap} Marhamat!`, Keyboards.mainMenu(userId === adminId));
        } catch (err) {
            console.error("Essay xatolik:", err);
            updateUser(userId, { balance: (user.balance || 0) + price });
            return ctx.reply(`${E.wrong} Xatolik: ${err.message}`, Keyboards.mainMenu(userId === adminId));
        }
    }

    // === REFERRAL TYPE ===
    if (user.step === 'REFERRAL_TYPE') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        if (text.includes('Referat')) ctx.session.referralType = 'referat';
        else if (text.includes('Mustaqil')) ctx.session.referralType = 'mustaqil';

        updateUser(userId, { step: 'REFERRAL_TOPIC' });
        return ctx.reply(`${E.pencil} Mavzuni kiriting:`);
    }

    // === REFERRAL TOPIC ===
    if (user.step === 'REFERRAL_TOPIC') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        ctx.session.referralTopic = text;
        updateUser(userId, { step: 'REFERRAL_PAGES' });
        return ctx.reply(`${E.info} Nechta bet bo'lishini kiriting:`);
    }

    // === REFERRAL PAGES ===
    if (user.step === 'REFERRAL_PAGES') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        const pages = parseInt(text.replace(/\D/g, ''));
        if (isNaN(pages) || pages < 1) {
            return ctx.reply(`${E.warning} Kamida 1 bet kiriting:`);
        }

        const price = pages * 500;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(
                `${E.money} ${price.toLocaleString()} so'm kerak!`,
                Keyboards.paymentMethods()
            );
        }

        updateUser(userId, { balance: (user.balance || 0) - price });
        ctx.reply(`${E.clock} ${pages} betli ${ctx.session.referralType === 'referat' ? 'referat' : 'mustaqil ish'} yaratilmoqda... ${E.magic}`);

        try {
            const aiContent = await getAIContent(ctx.session.referralTopic, pages, ctx.session.referralType);
            if (!aiContent) {
                updateUser(userId, { balance: (user.balance || 0) + price });
                return ctx.reply(`${E.wrong} AI xatolik.`, Keyboards.mainMenu(userId === adminId));
            }

            const fileName = await createReferatPPTX(ctx.session.referralTopic, aiContent, userId, ctx.session.referralType, pages);
            await ctx.replyWithDocument({ source: fileName }, {
                caption: `${E.check} ${ctx.session.referralType === 'referat' ? 'Referat' : 'Mustaqil ish'} tayyor! ${E.trophy}\n${pages} bet | ${price.toLocaleString()} so'm`
            });
            addOrder(userId, ctx.session.referralType, { topic: ctx.session.referralTopic, pages, price }, fileName);
            if (fs.existsSync(fileName)) fs.unlinkSync(fileName);

            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.clap} Marhamat!`, Keyboards.mainMenu(userId === adminId));
        } catch (err) {
            console.error("Referat xatolik:", err);
            updateUser(userId, { balance: (user.balance || 0) + price });
            return ctx.reply(`${E.wrong} Xatolik: ${err.message}`, Keyboards.mainMenu(userId === adminId));
        }
    }

    // === TEZIS TOPIC ===
    if (user.step === 'TEZIS_TOPIC') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        ctx.session.tezisTopic = text;
        updateUser(userId, { step: 'TEZIS_WORDS' });
        return ctx.reply(`${E.info} Nechta so'z bo'lishini kiriting:`);
    }

    // === TEZIS WORDS ===
    if (user.step === 'TEZIS_WORDS') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        const words = parseInt(text.replace(/\D/g, ''));
        if (isNaN(words) || words < 50) {
            return ctx.reply(`${E.warning} Kamida 50 so'z kiriting:`);
        }

        const price = words * 10;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(
                `${E.money} ${price.toLocaleString()} so'm kerak!`,
                Keyboards.paymentMethods()
            );
        }

        updateUser(userId, { balance: (user.balance || 0) - price });
        ctx.reply(`${E.clock} Tezis yaratilmoqda... ${E.magic}`);

        try {
            const aiContent = await getAIContent(ctx.session.tezisTopic, words, 'tezis');
            if (!aiContent) {
                updateUser(userId, { balance: (user.balance || 0) + price });
                return ctx.reply(`${E.wrong} AI xatolik.`, Keyboards.mainMenu(userId === adminId));
            }

            const fileName = await createTezisPPTX(ctx.session.tezisTopic, aiContent, userId, words);
            await ctx.replyWithDocument({ source: fileName }, {
                caption: `${E.check} Tezis tayyor! ${E.trophy}\n${words} so'z | ${price.toLocaleString()} so'm`
            });
            addOrder(userId, 'tezis', { topic: ctx.session.tezisTopic, words, price }, fileName);
            if (fs.existsSync(fileName)) fs.unlinkSync(fileName);

            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.clap} Marhamat!`, Keyboards.mainMenu(userId === adminId));
        } catch (err) {
            console.error("Tezis xatolik:", err);
            updateUser(userId, { balance: (user.balance || 0) + price });
            return ctx.reply(`${E.wrong} Xatolik: ${err.message}`, Keyboards.mainMenu(userId === adminId));
        }
    }

    // === GLOSSARY TOPIC ===
    if (user.step === 'GLOSSARY_TOPIC') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        ctx.session.glossaryTopic = text;
        updateUser(userId, { step: 'GLOSSARY_COUNT' });
        return ctx.reply(`${E.info} Nechta so'z bo'lishini kiriting:`);
    }

    // === GLOSSARY COUNT ===
    if (user.step === 'GLOSSARY_COUNT') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Asosiy menyu`, Keyboards.mainMenu(userId === adminId));
        }
        const count = parseInt(text.replace(/\D/g, ''));
        if (isNaN(count) || count < 1) {
            return ctx.reply(`${E.warning} Kamida 1 ta so'z kiriting:`);
        }

        const price = count * 200;
        if ((user.balance || 0) < price) {
            ctx.session.neededAmount = price;
            updateUser(userId, { step: 'NEED_PAYMENT' });
            return ctx.reply(
                `${E.money} ${price.toLocaleString()} so'm kerak!`,
                Keyboards.paymentMethods()
            );
        }

        updateUser(userId, { balance: (user.balance || 0) - price });
        ctx.reply(`${E.clock} ${count} ta so'zdan iborat glossariy yaratilmoqda... ${E.magic}`);

        try {
            const aiContent = await getAIContent(ctx.session.glossaryTopic, count, 'glossary');
            if (!aiContent) {
                updateUser(userId, { balance: (user.balance || 0) + price });
                return ctx.reply(`${E.wrong} AI xatolik.`, Keyboards.mainMenu(userId === adminId));
            }

            const fileName = await createGlossaryPPTX(ctx.session.glossaryTopic, aiContent, userId, count);
            await ctx.replyWithDocument({ source: fileName }, {
                caption: `${E.check} Glossariy tayyor! ${E.trophy}\n${count} ta so'z | ${price.toLocaleString()} so'm`
            });
            addOrder(userId, 'glossary', { topic: ctx.session.glossaryTopic, count, price }, fileName);
            if (fs.existsSync(fileName)) fs.unlinkSync(fileName);

            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.clap} Marhamat!`, Keyboards.mainMenu(userId === adminId));
        } catch (err) {
            console.error("Glossariy xatolik:", err);
            updateUser(userId, { balance: (user.balance || 0) + price });
            return ctx.reply(`${E.wrong} Xatolik: ${err.message}`, Keyboards.mainMenu(userId === adminId));
        }
    }

    // === ADMIN BROADCAST ===
    if (userId === adminId && user.step === 'BROADCASTING') {
        if (text.includes('Bekor')) {
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(`${E.back} Bekor qilindi.`, Keyboards.mainMenu(true));
        }
        const allUsers = Object.keys(loadJson(USERS_FILE, {}));
        let sent = 0, failed = 0;
        await ctx.reply(`${E.clock} Xabar ${allUsers.length} ta foydalanuvchiga yuborilmoqda...`);
        for (const uid of allUsers) {
            try {
                await bot.telegram.sendMessage(uid, text);
                sent++;
            } catch (e) {
                failed++;
            }
        }
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(
            `${E.check} Yuborildi: ${sent}\n${E.wrong} Xato: ${failed}`,
            Keyboards.mainMenu(true)
        );
    }

    // Agar hech qaysi step mos kelmasa
    if (!user.step || user.step === 'MAIN_MENU') {
        return ctx.reply(
            `${E.smile} Asosiy menyudan tanlang!`,
            Keyboards.mainMenu(userId === adminId)
        );
    }
});

// ==================== SLAYD GENERATSIYA YORDAMCHI ====================
async function generateAndSendSlides(ctx, userId) {
    const user = getUser(userId);
    const topic = ctx.session.topic;
    const count = ctx.session.slideCount || 5;
    const templateId = ctx.session.templateId || null;
    const price = ctx.session.slidePrice || 0;
    try {
        if ((user.freeSlidesUsed || 0) < 2 && price === 0) {
            updateUser(userId, { freeSlidesUsed: (user.freeSlidesUsed || 0) + 1 });
        } else {
            updateUser(userId, { balance: (user.balance || 0) - price });
        }
        await ctx.reply(
            `${E.robot} AI ma'lumot yig'moqda va slayd yaratmoqda... ${E.clock}\n` +
            `${E.fire} Mavzu: ${topic}\n` +
            `${E.chart} Slaydlar soni: ${count}\n` +
            `${E.pic} Shablon: ${templateId || 'Standart'}`,
            { reply_markup: { remove_keyboard: true } }
        );
        const aiContent = await getAIContent(topic, count, 'slides');
        console.log("aiContent natija:", aiContent ? 'KELDI, uzunlik: ' + aiContent.length : 'NULL');
        if (!aiContent) {
            if (price > 0) updateUser(userId, { balance: (user.balance || 0) + price });
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(
                `${E.wrong} AI bilan ulanib bo'lmadi. So'ngiroq qayta urinib ko'ring.`,
                Keyboards.mainMenu(userId === adminId)
            );
        }
        await ctx.reply(`${E.magic} Slayd dizayni qilinmoqda... ${E.rocket}`);
        console.log("PPTX yaratish boshlanmoqda. aiContent uzunlik:", aiContent.length);
        const fileName = await createSlayd(topic, aiContent, userId, templateId, count);
        console.log("PPTX natija:", fileName ? fileName : 'NULL - yaratilmadi');
        if (!fileName) {
            if (price > 0) updateUser(userId, { balance: (user.balance || 0) + price });
            updateUser(userId, { step: 'MAIN_MENU' });
            return ctx.reply(
                `${E.wrong} Slayd yaratishda xatolik yuz berdi.`,
                Keyboards.mainMenu(userId === adminId)
            );
        }
        await ctx.replyWithDocument({ source: fileName }, {
            caption: `${E.check} Slayd tayyor! ${E.trophy}\n` +
                     `${topic}\n` +
                     `${count} ta slayd\n` +
                     `${price > 0 ? price.toLocaleString() + ' so\'m' : 'BEPUL'}`
        });
        addOrder(userId, 'slides', { topic, count, price, templateId }, fileName);
        updateUser(userId, { totalSlides: (user.totalSlides || 0) + 1, step: 'MAIN_MENU' });
        if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
        return ctx.reply(`${E.clap} 1 tadan 5 tagacha baholang:`, Keyboards.rating());
    } catch (err) {
        console.error("Slayd yaratish xatosi:", err.message);
        console.error("Stack:", err.stack);
        if (price > 0) updateUser(userId, { balance: (user.balance || 0) + price });
        updateUser(userId, { step: 'MAIN_MENU' });
        return ctx.reply(
            `${E.wrong} Xatolik: ${err.message}`,
            Keyboards.mainMenu(userId === adminId)
        );
    }
}
// ==================== RASM HANDLER (TO'LOV CHEKLARI) ====================
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const user = getUser(userId);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];

    if (user.step === 'WAITING_CLICK_CHECK' || user.step === 'WAITING_PAYME_CHECK') {
        const paymentType = user.step === 'WAITING_CLICK_CHECK' ? 'click' : 'payme';
        const amount = ctx.session.neededAmount || 0;

        const payment = addPayment(userId, amount, paymentType, 'pending', { fileId: photo.file_id });

        // Adminga yuborish
        if (adminId) {
            await bot.telegram.sendPhoto(adminId, photo.file_id, {
                caption: `${E.money} Yangi to'lov!\n\n` +
                         `Kim: ${user.name} ${user.surname}\n` +
                         `ID: ${userId}\n` +
                         `Turi: ${paymentType.toUpperCase()}\n` +
                         `Summa: ${amount.toLocaleString()} so'm\n` +
                         `Payment ID: ${payment.id}\n\n` +
                         `Tasdiqlash: /approve ${payment.id}`
            });
        }

        updateUser(userId, { step: 'PAYMENT_PENDING' });
        return ctx.reply(
            `${E.check} Chek qabul qilindi! ${E.clock}\n` +
            `Admin tasdiqlashini kuting. Tasdiqlangach xabar beramiz!`,
            Keyboards.mainMenu(userId === adminId)
        );
    }
});

// ==================== BAHOLASH CALLBACK ====================
bot.action(/rate_(\d+)/, async (ctx) => {
    const rating = parseInt(ctx.match[1]);
    const userId = ctx.from.id;

    await ctx.answerCbQuery(`${E.star} ${rating} ta yulduz! Rahmat!`);
    await ctx.editMessageReplyMarkup();

    let msg = `${E.clap} `;
    if (rating === 5) msg += "Ajoyib! Katta rahmat!";
    else if (rating === 4) msg += "Juda yaxshi! Rahmat!";
    else if (rating === 3) msg += "Rahmat! Yana yaxshilashga harakat qilamiz!";
    else msg += "Fikringiz uchun rahmat! Takliflaringizni kutamiz!";

    await ctx.reply(msg, Keyboards.mainMenu(userId === adminId));
});

// ==================== ADMIN PANEL ====================
bot.hears(`${E.admin} Admin Panel`, async (ctx) => {
    const userId = ctx.from.id;
    if (userId !== adminId) {
        return ctx.reply(`${E.lock} Sizga ruxsat yo'q!`);
    }

    const users = loadJson(USERS_FILE, {});
    const payments = loadJson(PAYMENTS_FILE, []);
    const orders = loadJson(ORDERS_FILE, []);
    const pendingCount = payments.filter(p => p.status === 'pending').length;

    ctx.reply(
        `${E.admin} Admin Panel\n\n` +
        `${E.smile} Jami foydalanuvchilar: ${Object.keys(users).length}\n` +
        `${E.money} Kutilayotgan to'lovlar: ${pendingCount}\n` +
        `${E.chart} Jami buyurtmalar: ${orders.length}\n\n` +
        `Komandalar:\n` +
        `/pending - Kutilayotgan to'lovlar\n` +
        `/approve PAYMENT_ID - To'lovni tasdiqlash\n` +
        `/users - Foydalanuvchilar ro'yxati\n` +
        `/balance USER_ID SUMMA - Balans to'ldirish\n` +
        `/broadcast - Xabar yuborish\n` +
        `/stats - Statistika`
    );
});

bot.command('pending', async (ctx) => {
    if (ctx.from.id !== adminId) return;

    const payments = getPendingPayments();
    if (payments.length === 0) {
        return ctx.reply(`${E.check} Kutilayotgan to'lovlar yo'q.`);
    }

    let msg = `${E.money} Kutilayotgan to'lovlar:\n\n`;
    payments.forEach(p => {
        const u = getUser(p.userId);
        msg += `ID: ${p.id}\n` +
               `Kim: ${u?.name || 'Noma\'lum'} ${u?.surname || ''}\n` +
               `Summa: ${p.amount.toLocaleString()} so'm\n` +
               `Turi: ${p.type.toUpperCase()}\n` +
               `Tasdiqlash: /approve ${p.id}\n\n`;
    });
    ctx.reply(msg);
});

bot.command('approve', async (ctx) => {
    if (ctx.from.id !== adminId) return;

    const args = ctx.message.text.split(' ');
    const paymentId = args[1];
    if (!paymentId) {
        return ctx.reply(`${E.wrong} Format: /approve PAYMENT_ID`);
    }
    const payment = approvePayment(paymentId);

    if (payment) {
        await bot.telegram.sendMessage(payment.userId,
            `${E.check} To'lovingiz tasdiqlandi! ${E.trophy}\n` +
            `Balansingizga ${payment.amount.toLocaleString()} so'm qo'shildi!\n` +
            `${E.money} Yangi balans: ${(getUser(payment.userId).balance || 0).toLocaleString()} so'm`,
            Keyboards.mainMenu(false)
        );
        return ctx.reply(`${E.check} To'lov tasdiqlandi! Foydalanuvchiga xabar yuborildi.`);
    }

    return ctx.reply(`${E.wrong} To'lov topilmadi!`);
});

bot.command('users', async (ctx) => {
    if (ctx.from.id !== adminId) return;

    const users = loadJson(USERS_FILE, {});
    const userList = Object.values(users).slice(0, 20);

    let msg = `${E.admin} Foydalanuvchilar (20 ta):\n\n`;
    userList.forEach((u, i) => {
        msg += `${i + 1}. ${u.name} ${u.surname} - ${(u.balance || 0).toLocaleString()} so'm\n`;
    });
    ctx.reply(msg);
});

bot.command('balance', async (ctx) => {
    if (ctx.from.id !== adminId) return;

    const args = ctx.message.text.split(' ');
    const targetId = parseInt(args[1]);
    const amount = parseInt(args[2]);

    if (isNaN(targetId) || isNaN(amount)) {
        return ctx.reply(`${E.wrong} Format: /balance USER_ID SUMMA\nMasalan: /balance 123456789 10000`);
    }

    const targetUser = getUser(targetId);
    if (!targetUser) {
        return ctx.reply(`${E.wrong} Foydalanuvchi topilmadi!`);
    }

    updateUser(targetId, { balance: (targetUser.balance || 0) + amount });

    await bot.telegram.sendMessage(targetId,
        `${E.gift} Admin balansingizga ${amount.toLocaleString()} so'm qo'shdi! ${E.money}\n` +
        `Yangi balans: ${((targetUser.balance || 0) + amount).toLocaleString()} so'm`
    );

    return ctx.reply(`${E.check} Balans yangilandi! ${targetId} ga ${amount.toLocaleString()} so'm qo'shildi.`);
});

bot.command('broadcast', async (ctx) => {
    if (ctx.from.id !== adminId) return;
    updateUser(adminId, { step: 'BROADCASTING' });
    return ctx.reply(`${E.admin} Yuboriladigan xabarni kiriting:`, Keyboards.cancel());
});

bot.command('stats', async (ctx) => {
    if (ctx.from.id !== adminId) return;

    const users = loadJson(USERS_FILE, {});
    const payments = loadJson(PAYMENTS_FILE, []);
    const orders = loadJson(ORDERS_FILE, []);

    const totalRevenue = payments.filter(p => p.status === 'approved').reduce((sum, p) => sum + p.amount, 0);
    const ordersByType = {};
    orders.forEach(o => {
        ordersByType[o.type] = (ordersByType[o.type] || 0) + 1;
    });

    let msg = `${E.chart} Statistika\n\n`;
    msg += `${E.smile} Foydalanuvchilar: ${Object.keys(users).length}\n`;
    msg += `${E.money} Jami daromad: ${totalRevenue.toLocaleString()} so'm\n`;
    msg += `${E.chart} Jami buyurtmalar: ${orders.length}\n\n`;
    msg += `Buyurtmalar turi bo'yicha:\n`;
    for (const [type, count] of Object.entries(ordersByType)) {
        msg += `  ${type}: ${count}\n`;
    }

    ctx.reply(msg);
});

// ==================== BOTNI ISHGA TUSHIRISH ====================
bot.launch()
    .then(() => console.log("Bot muvaffaqiyatli ishga tushdi!"))
    .catch((err) => console.error("Bot ishga tushirishda xato:", err));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Health Check Server
const http = require('http');
http.createServer((req, res) => {
    res.writeHead(200);
    res.write('Bot is running! SlaydTop AI');
    res.end();
}).listen(process.env.PORT || 3000);

console.log("Health check server ishlamoqda...");
