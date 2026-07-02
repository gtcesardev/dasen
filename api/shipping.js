/**
 * DASEN — Cálculo de frete via Melhor Envio
 */

'use strict';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Não permitido' });
    }

    var origin = req.headers.origin || '';
    var allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    if (allowed.length > 0 && allowed.indexOf(origin) !== -1) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.status(204).end();

    var meToken = process.env.ME_TOKEN;
    var meEnv = process.env.ME_ENV || 'sandbox';
    var cepOrigem = process.env.ME_CEP_ORIGEM || '01001000';

    if (!meToken) {
        console.error('[DASEN] ME_TOKEN não configurada');
        return res.status(500).json({ error: 'SERVIDOR' });
    }

    var body = req.body;
    if (!body || !body.to) {
        return res.status(400).json({ error: 'CEP obrigatório' });
    }

    var cepDestino = String(body.to).replace(/\D/g, '');
    if (!/^\d{8}$/.test(cepDestino)) {
        return res.status(400).json({ error: 'CEP inválido' });
    }

    var products = body.products;
    if (!Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: 'Produtos obrigatórios' });
    }

    var cleanProducts = products.map(function(p) {
        return {
            id: String(p.id || 'item').substring(0, 50),
            width: Math.min(Math.max(Number(p.width) || 30, 1), 200),
            height: Math.min(Math.max(Number(p.height) || 5, 1), 200),
            length: Math.min(Math.max(Number(p.length) || 40, 1), 200),
            weight: Math.min(Math.max(Number(p.weight) || 280, 1), 30000),
            insurance_value: Math.min(Math.max(Number(p.insurance_value) || 0, 0), 999999),
            quantity: Math.min(Math.max(Number(p.quantity) || 1, 1), 10)
        };
    });

    var baseUrl = meEnv === 'production'
        ? 'https://api.melhorenvio.com.br'
        : 'https://sandbox.melhorenvio.com.br';

    var payload = [{
        from: { postal_code: cepOrigem },
        to: { postal_code: cepDestino },
        services: '1,2,3,4',
        products: cleanProducts
    }];

    try {
        var response = await fetch(baseUrl + '/api/v2/me/shipment/calculate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': 'Bearer ' + meToken
            },
            body: JSON.stringify(payload)
        });

        var text = await response.text();
        console.log('[DASEN] ME response status:', response.status);

        if (!response.ok) {
            console.error('[DASEN] ME erro:', response.status, text.substring(0, 200));
            return res.status(502).json({ error: 'API_FRETE' });
        }

        var data = JSON.parse(text);
        var safeOptions = [];

        if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
            var nameMap = { 1: 'PAC', 2: 'SEDEX', 3: 'SEDEX 10', 4: 'SEDEX Hoje', 17: 'PAC GF', 45: 'SEDEX GF' };

            for (var i = 0; i < data[0].length; i++) {
                var opt = data[0][i];
                if (!opt || opt.error || opt.not_available) continue;
                var price = parseFloat(opt.price) || 0;
                if (price < 0) continue;

                safeOptions.push({
                    id: opt.id,
                    name: nameMap[opt.id] || ('Envio ' + opt.id),
                    price: Math.round(price * 100) / 100,
                    days_min: opt.delivery_range ? opt.delivery_range.min : null,
                    days_max: opt.delivery_range ? opt.delivery_range.max : null
                });
            }
        }

        return res.status(200).json({ options: safeOptions });

    } catch (err) {
        console.error('[DASEN] Falha frete:', err.message);
        return res.status(502).json({ error: 'API_FRETE' });
    }
};