const { httpError } = require('./store');

const MAX_TOKENS = 4096;
const RATE = { windowMs: 60000, max: 20 };

// وكيل خفيف إلى Anthropic Messages API: المفتاح يبقى على الخادم ولا يصل المتصفح أبداً.
function createAi({ apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com' } = {}) {
  const hits = new Map();
  const throttle = (uid) => {
    const now = Date.now();
    const list = (hits.get(uid) || []).filter((t) => now - t < RATE.windowMs);
    if (list.length >= RATE.max) throw httpError(429, 'طلبات كثيرة للمساعد، حاول بعد دقيقة');
    list.push(now);
    hits.set(uid, list);
  };

  function clean(body) {
    const { messages, tools } = body || {};
    if (!Array.isArray(messages) || !messages.length || messages.length > 80) throw httpError(400, 'رسائل غير صالحة');
    const okRole = (m) => m && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content));
    if (!messages.every(okRole)) throw httpError(400, 'رسائل غير صالحة');
    if (JSON.stringify(messages).length > 400000) throw httpError(413, 'المحادثة أطول من المسموح');
    const out = { model, max_tokens: MAX_TOKENS, messages };
    if (Array.isArray(tools) && tools.length) {
      out.tools = tools.slice(0, 20).map((t) => ({
        name: String(t.name), description: String(t.description || ''), input_schema: t.input_schema || { type: 'object', properties: {} },
      }));
    }
    return out;
  }

  async function ask(uid, body, signal) {
    if (!apiKey) throw httpError(503, 'المساعد الذكي غير مفعّل على الخادم');
    throttle(uid);
    const payload = clean(body);
    let r;
    try {
      r = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]),
      });
    } catch (e) {
      throw httpError(504, 'تعذّر الاتصال بخدمة الذكاء الاصطناعي');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw httpError(r.status === 429 ? 429 : 502, j?.error?.message ? 'رفضت الخدمة الطلب' : 'خطأ من خدمة الذكاء الاصطناعي');
    return { content: j.content || [], stop_reason: j.stop_reason };
  }

  return { enabled: () => !!apiKey, ask };
}

module.exports = { createAi };
