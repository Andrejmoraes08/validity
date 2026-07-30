<?php
/**
 * VALIDITY — Relay de e-mail (hospedar no KingHost)
 * ---------------------------------------------------
 * Recebe uma chamada HTTPS do app (Vercel) e envia o e-mail de DENTRO do
 * KingHost, contornando o bloqueio de SMTP externo.
 *
 * COMO USAR:
 * 1) Crie um e-mail no KingHost (ex.: validade@seudominio.com.br)
 * 2) Ajuste as 3 constantes abaixo (SEGREDO, FROM_EMAIL, FROM_NOME)
 * 3) Suba este arquivo na hospedagem do KingHost (ex.: public_html/),
 *    de preferência com um nome difícil de adivinhar.
 * 4) A URL final (ex.: https://seudominio.com.br/validity-mailer.php)
 *    e o SEGREDO vão nas variáveis de ambiente da Vercel:
 *       MAIL_RELAY_URL    = a URL acima
 *       MAIL_RELAY_SECRET = o mesmo valor de SEGREDO
 */

// ==== CONFIGURAÇÃO — AJUSTE AQUI ==============================================
const SEGREDO    = 'd43a1058ed04f3320e6cb22484dd955d31e7acdd82bb6153'; // igual ao da Vercel
const FROM_EMAIL = 'validades@ajmconsultoria.com.br';             // e-mail hospedado no KingHost
const FROM_NOME  = 'VALIDITY';
// ============================================================================

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'erro' => 'Método não permitido']);
    exit;
}

$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);

// Autenticação por segredo compartilhado
if (!is_array($body) || !isset($body['segredo']) || !hash_equals(SEGREDO, (string) $body['segredo'])) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'erro' => 'Não autorizado']);
    exit;
}

$to      = isset($body['to']) && is_array($body['to']) ? $body['to'] : [];
$subject = isset($body['subject']) ? (string) $body['subject'] : '(sem assunto)';
$html    = isset($body['html']) ? (string) $body['html'] : '';

// Filtra e-mails válidos
$to = array_values(array_filter($to, function ($e) {
    return filter_var($e, FILTER_VALIDATE_EMAIL);
}));

if (count($to) === 0) {
    echo json_encode(['ok' => true, 'enviados' => 0]);
    exit;
}

// Cabeçalhos: destinatários em Bcc (privacidade); assunto codificado em UTF-8
$headers  = 'MIME-Version: 1.0' . "\r\n";
$headers .= 'Content-Type: text/html; charset=UTF-8' . "\r\n";
$headers .= 'From: ' . FROM_NOME . ' <' . FROM_EMAIL . '>' . "\r\n";
$headers .= 'Reply-To: ' . FROM_EMAIL . "\r\n";
$headers .= 'Bcc: ' . implode(',', $to) . "\r\n";

$assuntoCodificado = '=?UTF-8?B?' . base64_encode($subject) . '?=';

// Envia (a mensagem principal vai para o próprio remetente; os reais em Bcc)
$ok = mail(FROM_EMAIL, $assuntoCodificado, $html, $headers, '-f' . FROM_EMAIL);

echo json_encode(['ok' => (bool) $ok, 'enviados' => $ok ? count($to) : 0]);
