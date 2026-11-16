// وكيل جلال — نسخة 0.7.3
// العقل: إذا وُجد GEMINI_API_KEY في البيئة (Render / Termux) يستعمل SDK مباشرة، وإلا يستعمل مساعد الموصل custom.gemini (python3 gemini.py) — المفتاح لا يظهر في أي ملف.
// الحسابات: واتساب بالرقم الثاني، تيليجرام بوت رسمي، إنستغرام حساب احترافي، فيسبوك صفحة (وليس حساباً شخصياً وهمياً).
// كل حساب يصرح أنه وكيل ذكاء اصطناعي، ولا يدعي أنه شخص حقيقي.
import makeWASocket, { DisconnectReason, useMultiFileAuthState, downloadMediaMessage } from '@whiskeysockets/baileys'
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
const PROXY_AGENT = (process.env.HTTPS_PROXY || process.env.https_proxy) ? new HttpsProxyAgent(process.env.HTTPS_PROXY || process.env.https_proxy) : undefined
const AGENT_NAME = process.env.AGENT_NAME || 'وكيل جلال'
const AGENT_NUMBER = process.env.AGENT_NUMBER || ''
const OWNER = process.env.OWNER_NUMBER || ''
const REPLY_MODE = process.env.REPLY_MODE || 'owner_only'
const IDENTITY = 'assistant'
let pairingTimer = null
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
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), agent: PROXY_AGENT })
  sock.ev.on('creds.update', saveCreds)
  function lastCodeTime() {
    try {
      const lines = fs.readFileSync('./pairing-code.txt', 'utf8').trim().split('\n')
      return Date.parse(lines[1] || '') || 0
    } catch { return 0 }
  }
  async function requestPairingCodeOnce() {
    if (state.creds.registered || !AGENT_NUMBER) return
    if (Date.now() - lastCodeTime() < 300_000) return
    try {
      const code = await sock.requestPairingCode(AGENT_NUMBER)
      console.log('🔑 رمز اقتران واتساب للوكيل:', code, '— أدخله في واتساب الرقم الثاني خلال دقائق قبل انتهائه')
      fs.writeFileSync('./pairing-code.txt', `${code}\n${new Date().toISOString()}\n`)
    } catch (e) { console.error('تعذر طلب رمز الاقتران:', e.message) }
  }
  if (pairingTimer) clearInterval(pairingTimer)
  pairingTimer = setInterval(requestPairingCodeOnce, 20_000)
  setTimeout(requestPairingCodeOnce, 3000)
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) { console.log('امسح هذا الـ QR من واتساب > الأجهزة المرتبطة:'); qrcode.generate(qr, { small: true }) }
    if (connection === 'open') {
      console.log('✅ الوكيل متصل بواتساب')
      if (OWNER && !globalThis.__notifiedOwner) {
        globalThis.__notifiedOwner = true
        sock.sendMessage(OWNER + '@s.whatsapp.net', { text: 'مرحباً جلال، أنا وكيل جلال. تم ربطي بنجاح وأنا متواجد الآن على واتساب. اكتب لي هنا وسأرد عليك.' }).catch(e => console.error('تعذر إرسال رسالة الدخول لجلال:', e.message))
      }
    }
    if (connection === 'close') {
      const retry = state.creds.registered
        ? lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
        : true
      console.log('انقطع الاتصال، إعادة؟', retry, '| السبب:', lastDisconnect?.error ? String(lastDisconnect.error).slice(0, 300) : 'غير معروف')
      if (retry) start()
    }
    if (connection === 'open') console.log('✅ الوكيل متصل بواتساب')
  })
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return
    const from = m.key.remoteJid
    const isOwner = OWNER && from.startsWith(OWNER)
    if (REPLY_MODE === 'owner_only' && !isOwner) return
    const who = isOwner ? 'جلال' : 'شخص آخر يراسل وكيل جلال'
    const text = m.message.conversation || m.message.extendedTextMessage?.text || ''
    const audio = m.message.audioMessage
    try {
      if (audio) {
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
  setInterval(() => { checkSchedule(sock); checkOutreach(sock) }, 60_000)
}
start()
