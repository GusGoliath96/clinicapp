import { env } from '../config/env.js';

// Envio de e-mail transacional (código de 2FA e link de redefinição de senha) via Resend.
//
// Contrato: POST https://api.resend.com/emails  (Authorization: Bearer <api key>)
//   { from, to, subject, html, text } → { id }
//
// Trocar de provedor (SES, SMTP) é reescrever apenas post() — o resto do sistema só
// conhece enviarCodigo2fa() e enviarLinkReset().

const isConfigured = () => Boolean(env.mail.apiKey);

async function post(body) {
  if (!isConfigured()) {
    // Sem credencial (dev): imprime o conteúdo em vez de quebrar o fluxo. É assim que se
    // testa o login inteiro sem configurar e-mail — o código aparece aqui no console.
    console.warn(`[mailer] sem RESEND_API_KEY — e-mail simulado para ${body.to}`);
    console.warn(`[mailer] ${body.subject}\n${body.text}`);
    return { id: `sim-${Date.now()}`, simulated: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.mail.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(`resend ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// Layout mínimo compartilhado. E-mail não tem CSS externo nem classes: tudo inline.
function frame(title, content) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
  <h2 style="margin:0 0 16px;font-size:18px;color:#1e40af">ClinicaApp</h2>
  <h3 style="margin:0 0 12px;font-size:16px;font-weight:600">${title}</h3>
  ${content}
  <p style="margin:24px 0 0;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px">
    Se você não solicitou isto, ignore este e-mail — nada acontece sem a sua ação.
  </p>
</div>`;
}

export function sendTwoFactorCode(email, code) {
  return post({
    from: env.mail.from,
    to: email,
    subject: `${code} é o seu código de acesso`,
    text: `Seu código de acesso é ${code}. Ele vale por 10 minutos.`,
    html: frame(
      'Seu código de acesso',
      `<p style="margin:0 0 16px;font-size:14px">Use o código abaixo para entrar. Ele vale por <strong>10 minutos</strong>.</p>
       <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:6px;color:#1e40af">${code}</p>`,
    ),
  });
}

export function sendResetLink(email, url) {
  return post({
    from: env.mail.from,
    to: email,
    subject: 'Redefinir sua senha do ClinicaApp',
    text: `Para redefinir sua senha, abra: ${url}\n\nO link vale por 30 minutos.`,
    html: frame(
      'Redefinir sua senha',
      `<p style="margin:0 0 16px;font-size:14px">Clique no botão abaixo para escolher uma senha nova. O link vale por <strong>30 minutos</strong> e só pode ser usado uma vez.</p>
       <p style="margin:0 0 16px"><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 20px;border-radius:7px;font-size:14px;font-weight:600">Redefinir senha</a></p>
       <p style="margin:0;font-size:12px;color:#6b7280;word-break:break-all">${url}</p>`,
    ),
  });
}
