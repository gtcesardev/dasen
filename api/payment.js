/**
 * DASEN — Mercado Pago Checkout Pro
 * 
 * Fluxo:
 * 1. Frontend envia carrinho + frete
 * 2. Backend cria preferência de pagamento
 * 3. Retorna URL do checkout do MP
 * 4. Frontend redireciona cliente
 * 5. Cliente paga (cartão, PIX, boleto) na página do MP
 * 6. MP redireciona de volta + dispara webhook
 */

'use strict';

const rlMap = new Map();
function isLimited(ip) {
    const now = Date.now();
    const r = rlMap.get(ip);
    if (r && now - r.start < 60000) return r.count >= 5;
    rlMap.set(ip, { start: now, count: 1 });
    return false;
}

function cleanStr(s, max) {
    if (typeof s !== 'string') return '';
    return s.substring(0, max || 200).replace(/[<>"'&]/g, '');
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Não permitido' });
    }

    // CORS
    const origin = req.headers.origin || '';
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length > 0 && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.status(204).end();

    // Rate limit
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
    if (isLimited(ip)) {
        return res.status(429).json({ error: 'Aguarde um momento' });
    }

    // Access Token — só existe no servidor
    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
        console.error('[DASEN] MP_ACCESS_TOKEN não configurada');
        return res.status(500).json({ error: 'Erro interno' });
    }

    // URL do site para redirect após pagamento
    const siteUrl = process.env.SITE_URL || '';
    const returnUrl = siteUrl + '/obrigado.html';
    const webhookUrl = siteUrl + '/api/webhook';

    // Valida entrada
    const body = req.body;
    if (!body || !body.items || !Array.isArray(body.items) || body.items.length === 0) {
        return res.status(400).json({ error: 'Itens obrigatórios' });
    }
    if (body.items.length > 10) {
        return res.status(400).json({ error: 'Máximo 10 itens' });
    }

    // Monta itens para o MP (valor em centavos)
    var totalCents = 0;
    var mpItems = [];

    for (var i = 0; i < body.items.length; i++) {
        var item = body.items[i];
        var qty = parseInt(item.quantity) || 1;
        var priceCents = Math.round(parseFloat(item.price) * 100);

        if (qty < 1 || qty > 10) {
            return res.status(400).json({ error: 'Quantidade inválida' });
        }
        if (priceCents < 100 || priceCents > 99999900) {
            return res.status(400).json({ error: 'Preço inválido' });
        }

        totalCents += priceCents * qty;

        mpItems.push({
            id: cleanStr(item.id || 'item', 50),
            title: cleanStr(item.title || 'Produto', 100),
            quantity: qty,
            unit_price: priceCents,
            currency_id: 'BRL'
        });
    }

    // Adiciona frete como item se existir
    if (body.shipping_price && body.shipping_price > 0) {
        var shipCents = Math.round(parseFloat(body.shipping_price) * 100);
        totalCents += shipCents;
        mpItems.push({
            id: 'frete-' + cleanStr(body.shipping_id || 'padrao', 20),
            title: cleanStr(body.shipping_name || 'Frete', 50),
            quantity: 1,
            unit_price: shipCents,
            currency_id: 'BRL'
        });
    }

    if (totalCents < 100) {
        return res.status(400).json({ error: 'Total inválido' });
    }

    // Identificador do pedido
    var orderNsu = cleanStr(body.order_nsu || Date.now().toString(36), 50);

    // Monta preferência
    var preference = {
        items: mpItems,
        external_reference: orderNsu,
        notification_url: webhookUrl,
        back_urls: {
            success: returnUrl + '?status=success&order=' + orderNsu,
            pending: returnUrl + '?status=pending&order=' + orderNsu,
            failure: returnUrl + '?status=failure&order=' + orderNsu
        },
        payment_methods: {
            excluded_payment_types: [
                { id: 'ticket' }
            ],
            installments: {
                max: 3
            }
        },
        auto_return: 'approved',
        statement_descriptor: 'DASEN'
    };

    try {
        var response = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': 'dasen-' + orderNsu
            },
            body: JSON.stringify(preference)
        });

        var data = await response.json();

        if (!response.ok || !data.init_point) {
            var errMsg = data.message || 'Erro desconhecido';
            console.error('[DASEN] MP erro:', response.status, errMsg);
            return res.status(502).json({ error: 'Erro ao gerar pagamento' });
        }

        // Log seguro
        console.log('[DASEN] Preferência criada:', {
            id: data.id,
            order: orderNsu,
            total: totalCents
        });

        // Retorna URL do checkout
        return res.status(200).json({
            success: true,
            checkout_url: data.init_point,
            order_nsu: orderNsu
        });

    } catch (err) {
        console.error('[DASEN] Falha MP:', err.message);
        return res.status(502).json({ error: 'Erro ao gerar pagamento' });
    }
};