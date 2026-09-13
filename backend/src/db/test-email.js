// Confere se o envio de e-mail realmente funciona, antes de ligar o 2FA.
//
//   npm run mail:teste -- <email>
//
// Sem RESEND_API_KEY o mailer só imprime no console, e o teste "passa" sem entregar nada —
// por isso a saída avisa qual dos dois modos rodou.
import { env } from '../config/env.js';
import { sendTwoFactorCode } from '../integrations/mailer.js';

const email = String(process.argv[2] || '').trim();
if (!email) {
  console.error('uso: npm run mail:teste -- <email>');
  process.exit(1);
}

if (!env.mail.apiKey) {
  console.warn('\n  RESEND_API_KEY não está definida: o envio será apenas simulado.');
  console.warn('  Ligar TWO_FACTOR=on neste estado tranca todo mundo fora do sistema.\n');
}

try {
  const result = await sendTwoFactorCode(email, '123456');
  if (result.simulated) {
    console.log('\n  Modo simulado — nada foi entregue de verdade.\n');
  } else {
    console.log(`\n  Enviado (id ${result.id}). Confira a caixa de ${email}, inclusive o spam.\n`);
  }
} catch (e) {
  console.error(`\n  Falhou: ${e.message}\n`);
  // exitCode em vez de exit(): o fetch ainda tem I/O pendente e process.exit() aqui
  // derruba o processo no meio, com um assert do libuv no Windows.
  process.exitCode = 1;
}
