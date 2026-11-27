// ELVON STORE — Hosted MCP server (Vercel Serverless Function, POST /api/mcp)
// Model Context Protocol over "Streamable HTTP" (stateless, JSON responses).
// Lets Claude (or any MCP client) read the live store: products, prices, stock,
// categories, store info, delivery fees and repair prices, and prepare a WhatsApp order link.
// READ-ONLY: it never writes to Firestore and never reads orders or customer data.
//
// Add it in Claude: Settings > Connectors > Add custom connector > URL: https://YOUR-DOMAIN/api/mcp
// Optional env vars: FIREBASE_PROJECT_ID, FIREBASE_API_KEY (the public web key), MCP_TOKEN
// (if MCP_TOKEN is set, clients must send "Authorization: Bearer <MCP_TOKEN>").

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'elvon-store', title: 'ELVON STORE', version: '1.0.0' };

// Web config values are public by design (security comes from firestore.rules); env vars override them.
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'elvon-store';
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDcDjOPHkKFTQ2mc-GDWllqo7QfzjzAV64';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

// Product fields to fetch (images are huge base64 strings, so they are skipped).
const PRODUCT_FIELDS = ['id', 'name', 'brand', 'category', 'price', 'oldPrice', 'stock', 'desc', 'deal', 'coins', 'coinsEarn', 'imagesCount', 'updatedAt'];
const CACHE_MS = 60 * 1000;
const cache = {};

// ---------- Firestore REST helpers ----------
function fromValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
function fromFields(fields) {
  const o = {};
  for (const k of Object.keys(fields || {})) o[k] = fromValue(fields[k]);
  return o;
}

async function fsGet(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Firestore ' + r.status);
  return r.json();
}

async function cached(key, loader) {
  const hit = cache[key];
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  const v = await loader();
  cache[key] = { t: Date.now(), v };
  return v;
}

function loadProducts() {
  return cached('products', async () => {
    const mask = PRODUCT_FIELDS.map(f => 'mask.fieldPaths=' + f).join('&');
    const out = [];
    let token = '';
    for (let page = 0; page < 20; page++) {
      const d = await fsGet(`${FS}/products?pageSize=300&${mask}&key=${API_KEY}${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
      for (const doc of (d && d.documents) || []) {
        const p = fromFields(doc.fields);
        p.id = p.id || doc.name.split('/').pop();
        out.push(p);
      }
      token = d && d.nextPageToken;
      if (!token) break;
    }
    return out;
  });
}

function loadSettings() {
  return cached('settings', async () => {
    const d = await fsGet(`${FS}/settings/main?key=${API_KEY}`);
    const s = d ? fromFields(d.fields) : {};
    return {
      shippingFee: Number(s.shippingFee ?? 15),
      otherCitiesFee: Number(s.otherCitiesFee ?? 25),
      freeShippingThreshold: Number(s.freeShippingThreshold ?? 300),
      waPhone: String(s.waPhone || '212619493240').replace(/\D/g, ''),
      phoneDisplay: s.phoneDisplay || '',
      hours: s.hours || '',
      address: s.address || '',
      mapsUrl: s.mapsUrl || '',
      about: s.about || '',
      faq: Array.isArray(s.faq) ? s.faq : [],
      repairPrices: s.repairPrices && typeof s.repairPrices === 'object' ? s.repairPrices : {}
    };
  });
}

// ---------- formatting ----------
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
}

function publicProduct(p, full) {
  const o = {
    id: p.id,
    name: p.name,
    brand: p.brand || '',
    category: p.category || '',
    price_mad: Number(p.price) || 0,
    in_stock: Number(p.stock) > 0,
    stock: Number(p.stock) || 0
  };
  if (Number(p.oldPrice) > Number(p.price)) {
    o.old_price_mad = Number(p.oldPrice);
    o.discount_percent = Math.round((1 - Number(p.price) / Number(p.oldPrice)) * 100);
  }
  if (p.deal) o.deal = p.deal;
  if (Number(p.coinsEarn) > 0) o.coins_earned = Number(p.coinsEarn);
  if (full) {
    o.description = p.desc || '';
    o.images_count = Number(p.imagesCount) || 0;
  } else if (p.desc) {
    o.description = String(p.desc).slice(0, 160) + (String(p.desc).length > 160 ? '…' : '');
  }
  return o;
}

function text(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }], structuredContent: typeof obj === 'string' ? undefined : obj };
}
function toolError(msg) {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

// ---------- tools ----------
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: 'search_products',
    title: 'Search products',
    description: 'Search the ELVON STORE catalog (smartphone accessories, Tangier, Morocco). Prices are in Moroccan dirhams (MAD). Matches Arabic, French or English words in the name, brand, category and description. All filters are optional; with no query it lists products.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to search for, e.g. "iPhone 16 case", "شاحن سامسونج", "écouteurs".' },
        category: { type: 'string', description: 'Category id from list_categories, e.g. "holders".' },
        brand: { type: 'string', description: 'Brand, e.g. "APPLE", "SAMSUNG".' },
        min_price: { type: 'number', description: 'Minimum price in MAD.' },
        max_price: { type: 'number', description: 'Maximum price in MAD.' },
        in_stock_only: { type: 'boolean', description: 'Only products in stock (default true).' },
        deals_only: { type: 'boolean', description: 'Only discounted products / deals.' },
        sort: { type: 'string', enum: ['relevance', 'price_asc', 'price_desc', 'newest', 'discount'], description: 'Sort order (default relevance).' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results (default 10).' }
      },
      additionalProperties: false
    },
    annotations: { title: 'Search products', ...READ_ONLY }
  },
  {
    name: 'get_product',
    title: 'Get product',
    description: 'Full details of one product by its id (from search_products): name, price, old price, stock, full description.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Product id, e.g. "acc-1795356830297".' } },
      required: ['id'],
      additionalProperties: false
    },
    annotations: { title: 'Get product', ...READ_ONLY }
  },
  {
    name: 'list_categories',
    title: 'List categories and brands',
    description: 'Categories and brands in the catalog with how many products (and how many in stock) each has, plus the price range.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List categories and brands', ...READ_ONLY }
  },
  {
    name: 'get_store_info',
    title: 'Store info',
    description: 'ELVON STORE contact and policy: phone, WhatsApp, opening hours, address, map, delivery fees, free-delivery threshold, payment (cash on delivery) and FAQ.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Store info', ...READ_ONLY }
  },
  {
    name: 'get_delivery_quote',
    title: 'Delivery quote',
    description: 'Delivery fee for a city and order subtotal. Tangier (طنجة) has its own fee, every other Moroccan city has one flat fee, and orders at or above the threshold ship free.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'Customer city, e.g. "طنجة", "Tanger", "Casablanca".' },
        subtotal_mad: { type: 'number', description: 'Order subtotal in MAD (default 0).' }
      },
      required: ['city'],
      additionalProperties: false
    },
    annotations: { title: 'Delivery quote', ...READ_ONLY }
  },
  {
    name: 'get_repair_prices',
    title: 'Repair prices',
    description: 'Price ranges (MAD, [min, max]) of the phone repair workshop, per issue and per platform (android / ios). Issues: screen, battery, charge_port, back, camera, audio, software, water, diagnostic.',
    inputSchema: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: 'Optional issue key, e.g. "screen".' },
        platform: { type: 'string', enum: ['android', 'ios'], description: 'Optional platform.' }
      },
      additionalProperties: false
    },
    annotations: { title: 'Repair prices', ...READ_ONLY }
  },
  {
    name: 'create_order_link',
    title: 'Prepare WhatsApp order',
    description: 'Builds a WhatsApp link with a ready order message (products, quantities, totals, delivery fee). It does NOT place the order: the customer opens the link and sends the message to the store. Payment is cash on delivery.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 20 } },
            required: ['id'],
            additionalProperties: false
          }
        },
        city: { type: 'string', description: 'Delivery city.' },
        customer_name: { type: 'string', description: 'Optional customer name.' },
        address: { type: 'string', description: 'Optional delivery address.' }
      },
      required: ['items', 'city'],
      additionalProperties: false
    },
    annotations: { title: 'Prepare WhatsApp order', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
];

function isTangier(city) {
  return /^(طنجه|tanger|tangier|tangiers|tanja|tangier-assilah)$/i.test(norm(city).trim());
}
function deliveryFee(s, city, subtotal) {
  if (subtotal >= s.freeShippingThreshold) return 0;
  return isTangier(city) ? s.shippingFee : s.otherCitiesFee;
}
function clip(v, n) { return String(v == null ? '' : v).slice(0, n); }

async function callTool(name, args) {
  args = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'search_products': {
      const all = await loadProducts();
      const terms = norm(args.query).split(/\s+/).filter(Boolean);
      const inStock = args.in_stock_only !== false;
      const limit = Math.min(50, Math.max(1, Math.floor(Number(args.limit) || 10)));
      let list = all.filter(p => {
        if (inStock && !(Number(p.stock) > 0)) return false;
        if (args.category && norm(p.category) !== norm(args.category)) return false;
        if (args.brand && norm(p.brand) !== norm(args.brand)) return false;
        if (args.min_price != null && Number(p.price) < Number(args.min_price)) return false;
        if (args.max_price != null && Number(p.price) > Number(args.max_price)) return false;
        if (args.deals_only && !(p.deal || Number(p.oldPrice) > Number(p.price))) return false;
        return true;
      }).map(p => {
        let score = 0;
        if (terms.length) {
          const name = norm(p.name), meta = norm([p.brand, p.category].join(' ')), desc = norm(p.desc);
          for (const t of terms) {
            if (name.includes(t)) score += 3;
            else if (meta.includes(t)) score += 2;
            else if (desc.includes(t)) score += 1;
          }
        }
        return { p, score };
      });
      if (terms.length) list = list.filter(x => x.score > 0);
      const sorters = {
        price_asc: (a, b) => a.p.price - b.p.price,
        price_desc: (a, b) => b.p.price - a.p.price,
        newest: (a, b) => (b.p.updatedAt || 0) - (a.p.updatedAt || 0),
        discount: (a, b) => ((b.p.oldPrice || b.p.price) - b.p.price) / (b.p.oldPrice || 1) - ((a.p.oldPrice || a.p.price) - a.p.price) / (a.p.oldPrice || 1),
        relevance: (a, b) => b.score - a.score || (b.p.updatedAt || 0) - (a.p.updatedAt || 0)
      };
      list.sort(sorters[args.sort] || sorters.relevance);
      return text({ total_matches: list.length, returned: Math.min(limit, list.length), currency: 'MAD', products: list.slice(0, limit).map(x => publicProduct(x.p, false)) });
    }
    case 'get_product': {
      const id = clip(args.id, 100);
      const p = (await loadProducts()).find(x => x.id === id);
      if (!p) return toolError('No product with id "' + id + '". Use search_products to find ids.');
      return text(publicProduct(p, true));
    }
    case 'list_categories': {
      const all = await loadProducts();
      const group = key => {
        const m = {};
        for (const p of all) {
          const k = p[key] || '(none)';
          m[k] = m[k] || { name: k, products: 0, in_stock: 0 };
          m[k].products++;
          if (Number(p.stock) > 0) m[k].in_stock++;
        }
        return Object.values(m).sort((a, b) => b.products - a.products);
      };
      const prices = all.map(p => Number(p.price) || 0);
      return text({ total_products: all.length, price_range_mad: prices.length ? [Math.min(...prices), Math.max(...prices)] : [], categories: group('category'), brands: group('brand') });
    }
    case 'get_store_info': {
      const s = await loadSettings();
      return text({
        name: 'ELVON STORE',
        description: 'Smartphone accessories store and phone repair workshop in Tangier, Morocco.',
        city: 'Tangier (طنجة), Morocco',
        address: s.address, maps_url: s.mapsUrl, hours: s.hours,
        phone: s.phoneDisplay, whatsapp: 'https://wa.me/' + s.waPhone,
        website: SITE_URL || undefined,
        about: s.about || undefined,
        payment: 'Cash on delivery (الدفع عند الاستلام)',
        ordering: 'Order on the website or by WhatsApp.',
        delivery: { tangier_fee_mad: s.shippingFee, other_cities_fee_mad: s.otherCitiesFee, free_delivery_from_mad: s.freeShippingThreshold },
        faq: s.faq
      });
    }
    case 'get_delivery_quote': {
      const s = await loadSettings();
      const subtotal = Math.max(0, Number(args.subtotal_mad) || 0);
      const fee = deliveryFee(s, args.city, subtotal);
      return text({ city: clip(args.city, 60), tangier: isTangier(args.city), subtotal_mad: subtotal, delivery_fee_mad: fee, total_mad: subtotal + fee, free_delivery_from_mad: s.freeShippingThreshold, missing_for_free_delivery_mad: Math.max(0, s.freeShippingThreshold - subtotal) });
    }
    case 'get_repair_prices': {
      const s = await loadSettings();
      let rp = s.repairPrices;
      if (args.issue) {
        if (!rp[args.issue]) return toolError('Unknown issue "' + clip(args.issue, 40) + '". Known: ' + Object.keys(rp).join(', '));
        rp = { [args.issue]: rp[args.issue] };
      }
      if (args.platform) {
        const o = {};
        for (const k of Object.keys(rp)) if (rp[k] && rp[k][args.platform]) o[k] = { [args.platform]: rp[k][args.platform] };
        rp = o;
      }
      return text({ currency: 'MAD', note: 'Ranges [min, max]; the exact price is given after diagnosis at the workshop.', repair_prices: rp });
    }
    case 'create_order_link': {
      const [all, s] = await Promise.all([loadProducts(), loadSettings()]);
      const items = Array.isArray(args.items) ? args.items.slice(0, 20) : [];
      if (!items.length) return toolError('items is required.');
      const lines = [], problems = [];
      let subtotal = 0;
      for (const it of items) {
        const p = all.find(x => x.id === it.id);
        const q = Math.min(20, Math.max(1, Math.floor(Number(it.quantity) || 1)));
        if (!p) { problems.push('Unknown product id ' + clip(it.id, 100)); continue; }
        if (!(Number(p.stock) > 0)) { problems.push(p.name + ' is out of stock'); continue; }
        if (q > Number(p.stock)) problems.push(p.name + ': only ' + p.stock + ' in stock');
        const qq = Math.min(q, Number(p.stock));
        subtotal += qq * Number(p.price);
        lines.push(`- ${p.name} × ${qq} = ${qq * Number(p.price)} MAD`);
      }
      if (!lines.length) return toolError('No orderable items. ' + problems.join('; '));
      const fee = deliveryFee(s, args.city, subtotal);
      const msg = [
        'السلام عليكم، بغيت نطلب من ELVON STORE:',
        ...lines,
        `المجموع: ${subtotal} MAD`,
        `التوصيل (${clip(args.city, 60)}): ${fee ? fee + ' MAD' : 'مجاني'}`,
        `الإجمالي: ${subtotal + fee} MAD`,
        args.customer_name ? 'الاسم: ' + clip(args.customer_name, 60) : '',
        args.address ? 'العنوان: ' + clip(args.address, 200) : '',
        'الدفع عند الاستلام.'
      ].filter(Boolean).join('\n');
      return text({ whatsapp_url: 'https://wa.me/' + s.waPhone + '?text=' + encodeURIComponent(msg), message: msg, subtotal_mad: subtotal, delivery_fee_mad: fee, total_mad: subtotal + fee, warnings: problems, note: 'The order is placed only when the customer sends this WhatsApp message.' });
    }
    default:
      return null;
  }
}

// ---------- JSON-RPC ----------
function rpcError(id, code, message) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }; }

async function handleMessage(m) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
    return m && 'id' in m && !('method' in m) ? null : rpcError(m && m.id, -32600, 'Invalid Request');
  }
  const isNotification = !('id' in m);
  const id = m.id;
  const params = m.params || {};
  try {
    switch (m.method) {
      case 'initialize': {
        const v = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
        return {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: v,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: 'ELVON STORE: smartphone accessories and phone repair in Tangier, Morocco. Prices in MAD, cash on delivery. Use search_products to find items, get_store_info for contact/delivery, and create_order_link to prepare a WhatsApp order the customer sends themselves. Never invent products, prices or discounts.'
          }
        };
      }
      case 'ping':
        return isNotification ? null : { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call': {
        let r;
        try { r = await callTool(params.name, params.arguments); }
        catch (e) { r = toolError('The store data is unavailable right now (' + clip(e && e.message, 80) + '). Try again shortly.'); }
        if (!r) return rpcError(id, -32602, 'Unknown tool: ' + clip(params.name, 60));
        return { jsonrpc: '2.0', id, result: r };
      }
      case 'resources/list': return { jsonrpc: '2.0', id, result: { resources: [] } };
      case 'prompts/list': return { jsonrpc: '2.0', id, result: { prompts: [] } };
      default:
        if (isNotification) return null; // notifications/initialized, notifications/cancelled, ...
        return rpcError(id, -32601, 'Method not found: ' + clip(m.method, 60));
    }
  } catch (e) {
    return isNotification ? null : rpcError(id, -32603, 'Internal error');
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version');
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    return typeof req.body === 'string' ? JSON.parse(req.body) : Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 256 * 1024) throw new Error('too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const token = process.env.MCP_TOKEN;
  if (token && req.method !== 'GET') {
    const auth = String(req.headers.authorization || '');
    if (auth !== 'Bearer ' + token) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json(rpcError(null, -32001, 'Unauthorized'));
    }
  }

  if (req.method === 'GET') {
    // No server-initiated SSE stream (stateless server). A plain browser visit gets a health check.
    if (String(req.headers.accept || '').includes('text/event-stream')) {
      res.setHeader('Allow', 'POST, OPTIONS');
      return res.status(405).end();
    }
    return res.status(200).json({ ok: true, server: SERVER_INFO, transport: 'streamable-http', endpoint: '/api/mcp', tools: TOOLS.map(t => t.name), auth: token ? 'bearer' : 'none' });
  }
  if (req.method === 'DELETE') return res.status(405).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return res.status(405).end(); }

  let body;
  try { body = await readBody(req); }
  catch (e) { return res.status(400).json(rpcError(null, -32700, 'Parse error')); }

  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  if (!msgs.length) return res.status(400).json(rpcError(null, -32600, 'Invalid Request'));
  const replies = (await Promise.all(msgs.slice(0, 50).map(handleMessage))).filter(Boolean);
  if (!replies.length) return res.status(202).end(); // only notifications / responses
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(JSON.stringify(batch ? replies : replies[0]));
};
