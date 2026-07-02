/**
 * DASEN — Webhook Mercado Pago
 * 
 * O MP envia POST aqui quando o pagamento muda de status.
 * Status importantes: approved, pending, rejected
 * 
 * Aqui você conecta Google Sheets + Email (próximo passo).
 */

'use strict';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Não permitido' });
    }

    // O MP pode enviar GET para verificar a URL
    if (req.method === 'GET') {
        return res.status(200).json({ status: 'ok' });
    }

    var body = req.body;

    // Validação
    if (!body || !body.type || !body.data || !body.data.id) {
        return res.status(400).json({ error: 'Inválido' });
    }

    // Log do evento
    console.log('[DASEN] Webhook MP:', {
        type: body.type,
        payment_id: body.data.id,
        order: body.external_reference
    });

    // Se for pagamento aprovado
    if (body.type === 'payment' && body.action === 'payment.updated') {
        var payment = body.data;

        console.log('[DASEN] Pagamento atualizado:', {
            id: payment.id,
            status: payment.status,
            valor: payment.transaction_amount,
            metodo: payment.payment_type_id,
            parcelas: payment.installments,
            pedido: payment.external_reference
        });

        // APROVADO
        if (payment.status === 'approved') {
            console.log('[DASEN] ✓ PAGAMENTO APROVADO:', {
                id: payment.id,
                pedido: payment.external_reference,
                valor: payment.transaction_amount,
                metodo: payment.payment_type_id === 'credit_card' ? 'Cartão' : payment.payment_type_id === 'pix' ? 'PIX' : payment.payment_type_id,
                parcelas: payment.installments || 1,
                dataAprovacao: payment.date_approved
            });

            // ════════════════════════════════════════
            // PRÓXIMO PASSO: Google Sheets + Email
            //
            // await saveToGoogleSheets(payment);
            // await sendConfirmationEmail(payment);
            // ════════════════════════════════════════
        }
    }

    // MP exige resposta 200 rápida
    return res.status(200).json({ received: true });
};