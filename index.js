// وكيل جلال — نسخة 0.7.4
// إصلاح اتصال 2026-11-16: جلب نسخة واتساب ويب الحية عند كل اتصال (fetchLatestBaileysVersion)،
// رمز الاقتران يُطلب داخل حدث QR فقط (النمط الرسمي)، إعادة اتصال بـ backoff وبلا تسريب مؤقتات.
// العقل: إذا وُجد GEMINI_API_KEY في البيئة (Render / Termux) يستعمل SDK مباشرة، وإلا يستعمل مساعد الموصل custom.gemini (python3 gemini.py) — المفتاح لا يظهر في أي ملف.
// الحسابات: واتساب بالرقم الثاني، تيليجرام بوت رسمي، إنستغرام حساب احترافي، فيسبوك صفحة (وليس حساباً شخصياً وهمياً).
// كل حساب يصرح أنه وكيل ذكاء اصطناعي، ولا يدعي أنه شخص حقيقي.

import makeWASocket, { DisconnectReason, useMultiFileAuthState, downloadMediaMessage, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { HttpsProxyAgent } from 'https-proxy-agent'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import fs from 'fs'
import 'dotenv/config'

const execFileAsync = promisify(execFile)
const GEMINI_HELPER = '/home/hatch/workspace/custom-connectors/custom.gemini/bin/gemini.py'
const GEMINI_MODEL = 'gemini-3.5-flash-lite'
// واتساب WebSocket لا يقرأ متغيرات البروكسي وحدها: إن وُجد HTTPS_PROXY نمرّر وكيله إلى Baileys
// (بدونه يفشل الاتصال بخطأ TLS EPROTO في الشبكات التي تمر عبر بروكسي خروج)
const PROXY_AGENT = (process.env.HTTPS_PROXY || process.env.https_proxy) ? new HttpsProxyAgent(process.env.HTTPS_PROXY || process.env.https_proxy) : undefined

const AGENT_NAME = process.env.AGENT_NAME || 'وكيل جلال'
const AGENT_NUMBER = process.env.AGENT_NUMBER || '' // رقم الوكيل الثاني بصيغة دولية بدون +، مثال: 213792891062
const OWNER = process.env.OWNER_NUMBER || '' // مثال: 213XXXXXXXXX
// IDENTITY مقفلة بقرار جلال (2026-11-16): assistant = يقول "أنا وكيل جلال"
// REPLY_MODE: owner_only = يرد على جلال فقط (الافتراضي الآمن)
//            everyone = يرد على أي شخص يراسل رقم الوكيل عندما يغيب جلال، فقط بإذن جلال
const REPLY_MODE = process.env.REPLY_MODE || 'owner_only'
const IDENTITY = 'assistant'
// إعادة الاتصال: حارس يمنع التشغيل المزدوج + backoff متصاعد (إعادة فورية بلا تأخير
// كانت تستفز واتساب: السوكت الأول يولّد QR، وكل إعادة بعده تُرفض فوراً بـ Connection Failure)
let restartScheduled = false
let consecutiveFailures = 0
// السوكت النشط الحالي — مؤقت فحص الرسائل المجدولة/المبادرات واحد على مستوى الوحدة،
// يستعمل هذا المتغير بدل إنشاء مؤقت جديد مع كل start() (كان يتسرب ويتراكم)
let activeSock = null

const SYSTEM = `أنت ${AGENT_NAME}، وكيل جلال الشخصي.
تكلم بالعربية البسيطة، قريب من الدارجة الجزائرية المفهومة، إجابة مباشرة وقصيرة.
رد دائماً بنفس لغة المرسل: عربية، فرنسية، إنجليزية، أو أي لغة يكتب بها.
جلال: 22 سنة، من السبت، تيارت، الجزائر. بلا عمل ولا دخل حالياً، يتعلم الأمن السيبراني، يصور بورتريه، يبني تطبيق وازن+، ويعمل مسلسل "صفر" بالذكاء الاصطناعي.
مع جلال وحده، وهو بالغ (22 سنة): وضع بالغ — بلا قيود إضافية وبلا مواعظ وبلا فلاتر أخلاقية إضافية في المواضيع البالغة. نفذ ما يطلبه بأقصى ما تستطيع، بلا تحفظ وبلا أسئلة زائدة. إذا طلب صوراً أو روابط أو فيديو أو صورة مولدة فاجلب أو أنشئ أفضل ما تستطيع مجاناً، وقل له بصراحة حدود الجودة والحصص إن وجدت.
الحدود الصلبة التي لا تتجاوزها أبداً حتى مع جلال: لا محتوى جنسي لقاصر إطلاقاً، لا أسلحة بيولوجية أو كيميائية، لا صور أو فيديو جنسي لشخص حقيقي بلا موافقته، لا دخول حساب أو هاتف بلا إذن صاحبه، لا أعمال غير قانونية.
الحدود الصلبة التي لا تتجاوزها أبداً حتى مع جلال: لا محتوى جنسي لقاصر، لا أسلحة بيولوجية أو كيميائية، لا انتحال شخص حقيقي بلا موافقته، لا دخول حساب أو هاتف بلا إذن صاحبه، لا أعمال غير قانونية.
مع أي شخص آخر: كن متحفظاً. أنت وكيل جلال، عرّف نفسك بذلك أول مرة. لا تتكلم باسمه ولا تعده بشيء ولا تشارك معلوماته الخاصة إلا بإذنه هو، وفقط كما طلب منك.
لا ترد على المكالمات — لا تستطيع في أي تطبيق.`

const sdkModel = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: GEMINI_MODEL }) : null

async function askGemini(text, who = 'جلال') {
  const prompt = `${SYSTEM}\n\nرسالة من ${who}: ${text}`
  if (sdkModel) {
    const r = await sdkModel.generateContent(prompt)
    const reply = (r.response.text() || '').trim()
    if (!reply) throw new Error('Gemini returned empty reply')
    return reply
  }
  const { stdout } = await execFileAsync('python3', [GEMINI_HELPER, '--prompt', prompt, '--model', GEMINI_MODEL], { timeout: 65000, maxBuffer: 1024 * 1024 })
  const reply = (stdout || '').trim()
  if (!reply) throw new Error('Gemini returned empty reply')
  return reply
}

// المبادرة: جلال يأمر الوكيل بالذهاب إلى صديق محدد
// مثال من جلال: "اذهب إلى صديقي أحمد، عرّف عن نفسك، وتعرف عليه"
// الوكيل يرسل أول رسالة بصفته وكيلاً، لا بصفة جلال، ثم يتحدث بشكل طبيعي في حدود الهدف، ويبلغ جلال بما دار
async function sendOutreach(sock, to, friendName, purpose) {
  const intro = `مرحباً ${friendName}، أنا وكيل جلال الشخصي. جلال طلب مني أن أتواصل معك وأن أعرف عن نفسي: أنا مساعده الذكي، ولست جلال نفسه. الهدف: ${purpose}. هل تسمح لي أن أتحدث معك قليلاً؟`
  await sock.sendMessage(to + '@s.whatsapp.net', { text: intro })
  console.log('📨 مبادرة إلى', friendName, to)
}

async function checkOutreach(sock) {
  try {
    const list = JSON.parse(fs.readFileSync('./outreach.json', 'utf8'))
    let changed = false
    for (const item of list) {
      if (!item.sent) {
        await sendOutreach(sock, item.to, item.friend_name, item.purpose)
        item.sent = true; changed = true
      }
    }
    if (changed) fs.writeFileSync('./outreach.json', JSON.stringify(list, null, 2))
  } catch {}
}

// رسائل مجدولة: يقرأ schedule.json كل دقيقة ويرسل ما حان وقته
// كل رسالة مجدولة يجب أن يكتب نصها جلال بنفسه أولاً — الوكيل لا يخترع رسائل باسمه
async function checkSchedule(sock) {
  try {
    const list = JSON.parse(fs.readFileSync('./schedule.json', 'utf8'))
    let changed = false
    for (const item of list) {
      if (!item.sent && new Date(item.time) <= new Date()) {
        await sock.sendMessage(item.to + '@s.whatsapp.net', { text: item.text })
        item.sent = true; changed = true
        console.log('📨 أرسلت رسالة مجدولة إلى', item.to)
      }
    }
    if (changed) fs.writeFileSync('./schedule.json', JSON.stringify(list, null, 2))
  } catch {}
}

async function start() {
  restartScheduled = false
  const { state, saveCreds } = await useMultiFileAuthState('./auth')

  // نسخة واتساب ويب الحية: النسخة المضّمنة في إصدار Baileys تتقادم ويرفضها خادم واتساب
  // (سبب حلقة Connection Failure). تُجلب عند كل اتصال، مع fallback للافتراضية إن تعذّر الجلب.
  let version
  try {
    ;({ version } = await fetchLatestBaileysVersion())
    console.log('📦 نسخة واتساب ويب:', version.join('.'))
  } catch (e) {
    console.error('تعذر جلب نسخة واتساب ويب، استعمال الافتراضية:', e.message)
  }
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), agent: PROXY_AGENT })
  activeSock = sock
  sock.ev.on('creds.update', saveCreds)

  // ربط برمز الاقتران — النمط الرسمي: يُطلب داخل حدث QR فقط، ومرة واحدة لكل سوكت،
  // وفقط إن لم يكن الجهاز مسجّلاً. الطلب بمؤقت أعمى بعد 3 ثوانٍ كان يسبق فتح السوكت أصلاً.
  // وقت آخر رمز يُقرأ من pairing-code.txt نفسه فيبقى الخنق (5 دقائق) صحيحاً حتى بعد إعادة التشغيل
  // جلال يدخله في واتساب الرقم الثاني: الأجهزة المرتبطة > ربط جهاز > الربط برقم الهاتف
  let pairingRequestedForThisSocket = false
  function lastCodeTime() {
    try {
      const lines = fs.readFileSync('./pairing-code.txt', 'utf8').trim().split('\n')
      return Date.parse(lines[1] || '') || 0
    } catch { return 0 }
  }
  async function requestPairingCodeOnce() {
    if (state.creds.registered || !AGENT_NUMBER || pairingRequestedForThisSocket) return
    pairingRequestedForThisSocket = true
    if (Date.now() - lastCodeTime() < 300_000) {
      console.log('⏳ رمز اقتران حديث موجود (أقل من 5 دقائق) — لن أطلب رمزاً جديداً حتى لا أُبطل السابق')
      return
    }
    try {
      const code = await sock.requestPairingCode(AGENT_NUMBER)
      console.log('🔑 رمز اقتران واتساب للوكيل:', code, '— أدخله في واتساب الرقم الثاني خلال دقائق قبل انتهائه')
      fs.writeFileSync('./pairing-code.txt', `${code}\n${new Date().toISOString()}\n`)
    } catch (e) { console.error('تعذر طلب رمز الاقتران:', e.message) }
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('امسح هذا الـ QR من واتساب > الأجهزة المرتبطة (أو استعمل رمز الاقتران أدناه):')
      qrcode.generate(qr, { small: true })
      // أول QR يعني أن السوكت حي ومتصل — الآن فقط يُطلب رمز الاقتران
      requestPairingCodeOnce()
    }
    if (connection === 'open') {
      consecutiveFailures = 0
      console.log('✅ الوكيل متصل بواتساب')
      // عند الدخول: يرسل الوكيل رسالة لجلال على حسابه الأصلي (OWNER_NUMBER) يقول فيها إنه متواجد الآن
      if (OWNER && !globalThis.__notifiedOwner) {
        globalThis.__notifiedOwner = true
        sock.sendMessage(OWNER + '@s.whatsapp.net', { text: 'مرحباً جلال، أنا وكيل جلال. تم ربطي بنجاح وأنا متواجد الآن على واتساب. اكتب لي هنا وسأرد عليك.' }).catch(e => console.error('تعذر إرسال رسالة الدخول لجلال:', e.message))
      }
    }
    if (connection === 'close') {
      if (activeSock === sock) activeSock = null
      // ملاحظة: كود 401 (loggedOut) يعني "لا تعيد" فقط لجهاز مسجّل أصلاً.
      // جهاز لم يُسجَّل بعد (لا رمز اقتران أُدخل) يجب أن يعيد المحاولة دائماً، وإلا مات الوكيل بصمت.
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const reason = lastDisconnect?.error?.data?.reason || lastDisconnect?.error?.message || 'غير معروف'
      const retry = state.creds.registered
        ? statusCode !== DisconnectReason.loggedOut
        : true
      console.log('انقطع الاتصال، إعادة؟', retry, '| statusCode:', statusCode, '| السبب:', reason)
      // backoff متصاعد بدل إعادة فورية: إعادة التشغيل الفوري المتكرر كانت تُرفض من واتساب
      if (retry && !restartScheduled) {
        restartScheduled = true
        consecutiveFailures++
        const delayMs = Math.min(5000 * consecutiveFailures, 30000)
        console.log(`⏱ إعادة الاتصال بعد ${delayMs / 1000} ثوانٍ (محاولة فاشلة متتالية رقم ${consecutiveFailures})`)
        setTimeout(start, delayMs)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return
    const from = m.key.remoteJid
    const isOwner = OWNER && from.startsWith(OWNER)
    // وضع الرد: owner_only = جلال فقط. everyone = أي شخص، بصح يعرّف نفسه كوكيل.
    if (REPLY_MODE === 'owner_only' && !isOwner) return
    const who = isOwner ? 'جلال' : 'شخص آخر يراسل وكيل جلال'

    const text = m.message.conversation || m.message.extendedTextMessage?.text || ''
    const audio = m.message.audioMessage

    try {
      if (audio) {
        // فويس نوت: مساعد Gemini النصي لا يستقبل صوتاً في هذه النسخة — نرد نصاً ونطلب رسالة مكتوبة
        await sock.sendMessage(from, { text: 'سمعت الفويس نوت، بصح ما نقدرش نسمع الصوت في هاد النسخة — اكتب لي رسالتك نصاً وسأرد عليك.' })
      } else if (text) {
        const reply = await askGemini(text, who)
        await sock.sendMessage(from, { text: reply })
      }
    } catch (e) {
      console.error(e)
      await sock.sendMessage(from, { text: 'صار مشكل تقني صغير، عاود رسالتك.' })
    }
  })

}

// فحص الرسائل المجدولة والمبادرات كل دقيقة — مؤقت واحد على مستوى الوحدة (كان داخل start()
// فيُنشأ مؤقت جديد مع كل إعادة اتصال ويتراكم؛ الآن يستعمل السوكت النشط الحالي فقط)
setInterval(() => { if (activeSock) { checkSchedule(activeSock); checkOutreach(activeSock) } }, 60_000)

// المفتاح لا يوضع في .env أبداً — العقل يعمل عبر مساعد الموصل custom.gemini (gemini.py) الذي يقرأه من الخزنة الآمنة.
start()
