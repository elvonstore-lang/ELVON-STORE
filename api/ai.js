// ELVON AI — Vercel Serverless Function (POST /api/ai)
// Keeps GEMINI_API_KEY on the server. ELVON AI is a general-purpose smart assistant:
// it answers ANY question (general knowledge, tech, phones, math, translation, advice, news...)
// and is also the expert of ELVON STORE (products, prices, delivery, orders).
// Without GEMINI_API_KEY it returns { reply: '', disabled: true } and the site keeps its local engine.

// Tried in order; the first one that answers wins. Override the first one with GEMINI_MODEL.
const MODELS = [process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash']
  .filter((m, i, a) => m && a.indexOf(m) === i);

const MAX_MSG = 2000;

function clip(v, n) { return String(v == null ? '' : v).slice(0, n); }

function buildSystem(body) {
  const now = new Date();
  const today = now.toLocaleString('fr-MA', { timeZone: 'Africa/Casablanca', dateStyle: 'full', timeStyle: 'short' });
  const catalog = (Array.isArray(body.catalog) ? body.catalog : []).slice(0, 80);
  return [
    'أنت **ELVON AI**: مساعد ذكي، عبقري ومتعدد المعارف، تابع لـ ELVON STORE (متجر إكسسوارات الهواتف ف طنجة، المغرب).',
    '',
    '## شخصيتك',
    '- ذكي، ودود، واثق، ومباشر. كتهضر بحال خبير إنسان ماشي بحال روبو.',
    '- جاوب ديما بنفس لغة الزبون: الدارجة المغربية (بالحروف العربية ولا اللاتينية حسب ما كتب الزبون)، العربية الفصحى، الفرنسية، الإنجليزية، الإسبانية ولا أي لغة أخرى.',
    '',
    '## اختصاصك: كلشي',
    '- جاوب على **أي سؤال** بلا استثناء: ثقافة عامة، علوم، تاريخ، جغرافيا، رياضيات وحسابات، برمجة، تكنولوجيا، هواتف وحواسيب، دراسة وواجبات، ترجمة، كتابة رسائل ونصوص، نصائح الحياة، الصحة العامة، الطبخ، الرياضة، السفر، الدين (باحترام وحياد)، الأخبار، وأي موضوع آخر.',
    '- ما تقولش "هادشي خارج اختصاصي". عطي جواب حقيقي ومفيد ودقيق.',
    '- للأسئلة الصعبة فكر خطوة بخطوة وعطي جواب صحيح. للحسابات بين الخطوات باختصار.',
    '- إلا كان السؤال على أحداث جديدة، أثمنة، طقس ولا معلومات كتتبدل، استعمل البحث فـ Google (إلا كان متاح) وعطي المعلومة الحديثة.',
    '- إلا ما كنتيش متأكد من شي معلومة قول ذلك بصراحة، وما تخترعش.',
    '- فالمواضيع الطبية ولا القانونية ولا المالية الخطيرة عطي معلومة عامة مفيدة ونصح بمراجعة مختص.',
    '- ارفض بأدب غير الطلبات الخطيرة ولا غير القانونية.',
    '',
    '## الأسلوب',
    '- جواب واضح ومنظم. الأسئلة البسيطة: جملة ولا جوج. الأسئلة المعقدة: شرح مفصل بنقاط ولا خطوات.',
    '- تقدر تستعمل **الخط العريض** و القوائم (- ولا 1)). ما تستعملش جداول HTML.',
    '- استعمل الإيموجي بشوية.',
    '- فكر فالمحادثة كاملة (السياق والأسئلة السابقة) قبل ما تجاوب.',
    '',
    '## ملي يكون السؤال على المتجر',
    '- أي معلومة على المتجر (منتجات، أثمنة، مخزون، عنوان، أوقات، توصيل، دفع، ضمان) اعتمد فيها **غير** على البيانات اللي تحت، وما تخترعش منتجات ولا أثمنة.',
    '- ملي الزبون كيقلب على منتج، اقترح ليه من المنتجات الموجودة (stock > 0) وذكر الاسم والثمن بالدرهم (MAD)، وقارن وعطي رأيك الصريح.',
    '- إلا المنتج ما كاينش عندنا قولها بصراحة وعطيه نصيحة عامة على شنو يشري.',
    '- تتبع الطلبات: طلب من الزبون رقم الهاتف اللي استعمل فالطلب (ما تعطيش معلومات الطلبات بالاسم بوحدو).',
    '- للطلب: الزبون كيزيد المنتج للسلة ولا كيضغط "اطلب الآن"، كيعمر المعلومات، وكيتصيفط الطلب ف واتساب. الدفع عند الاستلام.',
    '- ملي يكون مفيد، شجع الزبون بلطف يشوف منتجات المتجر، ولكن بلا ما تفرض الإشهار فالأسئلة العامة.',
    '',
    'التاريخ والوقت دابا (توقيت المغرب): ' + today,
    'سياسة المتجر: ' + JSON.stringify(body.policy || {}),
    'معلومات المتجر: ' + JSON.stringify(body.store || {}),
    'المنتجات (' + catalog.length + '): ' + JSON.stringify(catalog),
  ].join('\n');
}

function buildContents(body, message) {
  const history = Array.isArray(body.history) ? body.history.slice(-16) : [];
  const contents = [];
  for (const t of history) {
    const role = t && t.role === 'user' ? 'user' : 'model';
    const text = clip(t && t.text, MAX_MSG).trim();
    if (!text) continue;
    // Gemini wants alternating roles: merge consecutive turns of the same role
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n' + text;
    else contents.push({ role, parts: [{ text }] });
  }
  while (contents.length && contents[0].role !== 'user') contents.shift();
  if (!contents.length || contents[contents.length - 1].role !== 'user') {
    contents.push({ role: 'user', parts: [{ text: message }] });
  }
  return contents;
}

async function callGemini(key, model, payload, signal) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((data && data.error && data.error.message) || ('HTTP ' + r.status));
    err.status = r.status;
    throw err;
  }
  const cand = data && data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  return parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
}

module.exports = async (req, res) => {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // GET /api/ai : quick health check (open it in the browser to see if the key works)
  if (req.method === 'GET') {
    const k = process.env.GEMINI_API_KEY || '';
    if (!k) return res.status(200).json({ ok: false, problem: 'GEMINI_API_KEY is not set in Vercel. Add it, then Redeploy.' });
    const out = { ok: false, key_length: k.length, models: {} };
    if (k.length < 30) out.problem = 'The key looks too short. Copy the full key from aistudio.google.com/apikey.';
    for (const model of MODELS) {
      try {
        const t = await callGemini(k, model, { contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }] });
        out.models[model] = t ? 'works' : 'empty reply';
        if (t) { out.ok = true; break; }
      } catch (e) { out.models[model] = 'error: ' + String(e.message).slice(0, 200); }
    }
    return res.status(200).json(out);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (allowed !== '*' && origin && origin !== allowed) return res.status(403).json({ error: 'forbidden' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(200).json({ reply: '', disabled: true });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'bad request' });

  const message = clip(body.message, MAX_MSG).trim();
  if (!message) return res.status(200).json({ reply: '' });

  const base = {
    contents: buildContents(body, message),
    systemInstruction: { parts: [{ text: buildSystem(body) }] },
    generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 2048 },
  };
  const useSearch = process.env.AI_WEB_SEARCH !== 'false';
  let lastError = '';

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 27000);
  try {
    for (const model of MODELS) {
      // First try with Google Search grounding (fresh info), then without it.
      const attempts = useSearch ? [{ ...base, tools: [{ google_search: {} }] }, base] : [base];
      for (const payload of attempts) {
        try {
          const reply = await callGemini(key, model, payload, ctl.signal);
          if (reply) return res.status(200).json({ reply, model });
        } catch (e) {
          if (ctl.signal.aborted) return res.status(200).json({ reply: '', error: 'timeout' });
          lastError = String(e.message || e).slice(0, 200);
          if (e.status === 400 || e.status === 401 || e.status === 403) {
            // A bad key fails the same way on every model: stop early.
            if (/api key|API_KEY|permission|unauthori/i.test(lastError)) return res.status(200).json({ reply: '', error: lastError });
          }
        }
      }
    }
    return res.status(200).json({ reply: '', error: lastError });
  } finally {
    clearTimeout(timer);
  }
};
