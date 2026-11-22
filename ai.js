// ELVON AI — Vercel Serverless Function (POST /api/ai)
// Optional proxy that keeps GEMINI_API_KEY on the server. It is only called when the
// built-in local engine has no answer. Without GEMINI_API_KEY it returns an empty reply
// and the site simply keeps using its local answer.
const MODEL = 'gemini-2.5-flash';

module.exports = async (req, res) => {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (allowed !== '*' && origin && origin !== allowed) return res.status(403).json({ error: 'forbidden' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(200).json({ reply: '' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'bad request' });

  const message = String(body.message || '').slice(0, 800);
  if (!message) return res.status(200).json({ reply: '' });

  const store = body.store || {};
  const system = [
    'أنت ELVON AI، مساعد متجر ELVON STORE (إكسسوارات الهواتف) في طنجة، المغرب.',
    'جاوب بنفس لغة الزبون (الدارجة المغربية، العربية، الفرنسية أو الإنجليزية) بجمل قصيرة وودية.',
    'أي معلومة عن المتجر (منتجات، أثمنة، مخزون، عنوان، أوقات، توصيل) اعتمد فيها فقط على البيانات التالية ولا تخترع.',
    'اختصاصك محدد: (1) تتبع الطلبات (اطلب من الزبون رقم الهاتف المستعمل ف الطلب ولا تعرض طلبات بالاسم وحده)، (2) مقارنة المنتجات من قائمة المنتجات المرفقة فقط: قارن بالثمن والمواصفات والتخفيض ثم أعط رأيك.',
    'اكتب جوابك بشكل طبيعي وحر مثل إنسان خبير، بلا قوالب ثابتة ولا قوائم جاهزة، وبجمل قصيرة وودية. إذا كان السؤال خارج الاختصاص قل ذلك بأدب ووجه الزبون للواتساب.',
    'إذا ما عرفتش الجواب قل ذلك بصراحة واقترح التواصل عبر واتساب.',
    'سياسة المتجر: ' + JSON.stringify(body.policy || {}),
    'معلومات المتجر: ' + JSON.stringify(store),
    'المنتجات: ' + JSON.stringify((Array.isArray(body.catalog) ? body.catalog : []).slice(0, 60)),
  ].join('\n');

  const history = Array.isArray(body.history) ? body.history : [];
  const contents = history.slice(-8).map(t => ({
    role: t && t.role === 'user' ? 'user' : 'model',
    parts: [{ text: String((t && t.text) || '').slice(0, 800) }],
  }));
  if (!contents.length || contents[contents.length - 1].role !== 'user') {
    contents.push({ role: 'user', parts: [{ text: message }] });
  }

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: system }] } }),
    });
    const data = await r.json().catch(() => ({}));
    const reply = (data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts || []).map(p => p.text || '').join('');
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(200).json({ reply: '' });
  }
};
