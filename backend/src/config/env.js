import dotenv from 'dotenv';
dotenv.config();

const producao = process.env.NODE_ENV === 'production';

// Fail-closed: sem JWT_SECRET em produção todos os tokens seriam assinados com uma string
// pública deste repositório, e qualquer um poderia forjar um login de admin. Recusar a
// subir é melhor do que subir inseguro sem avisar.
const jwtSecret = process.env.JWT_SECRET || (producao ? null : 'dev-secret');
if (!jwtSecret) {
  throw new Error('JWT_SECRET é obrigatório em produção. Gere com: openssl rand -base64 48');
}

export const env = {
  producao,
  port: Number(process.env.PORT || 3000),
  // Aceita lista separada por vírgula: em produção o SPA vem de um domínio (app.<dominio>)
  // e a API de outro (api.<dominio>), mas o dev continua em localhost:5173. Passar as duas
  // origens evita ter que escolher entre um ambiente e outro.
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Endereço do SPA, usado para montar o link de redefinição enviado por e-mail.
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // bcryptjs é JavaScript puro e bloqueia o event loop enquanto calcula: cada +1 dobra o
  // tempo em que o servidor inteiro fica parado. 11 é o teto aceitável com esta biblioteca.
  bcryptCost: Number(process.env.BCRYPT_COST || 11),

  // Segundo fator por e-mail. Desligado por padrão de propósito: ligar antes de o envio
  // de e-mail estar comprovadamente funcionando tranca todo mundo fora do sistema.
  twoFactor: process.env.TWO_FACTOR === 'on',

  // Envio de e-mail (Resend). Sem apiKey o mailer entra em modo simulado e imprime o
  // código/link no console, como o aiEngine já faz quando não tem credencial.
  mail: {
    apiKey: process.env.RESEND_API_KEY,
    // onboarding@resend.dev funciona sem verificar domínio, mas só entrega no e-mail
    // dono da conta Resend — serve para desenvolvimento, não para a clínica em produção.
    from: process.env.MAIL_FROM || 'ClinicaApp <onboarding@resend.dev>',
  },

  // Motor de IA / WhatsApp (ai_agent). Substitui a antiga integração Gupshup:
  // todo o WhatsApp (envio + recebimento) passa pelo motor.
  aiEngine: {
    // Base do motor para envio ativo (POST /api/v1/messages).
    url: process.env.AI_ENGINE_URL || 'http://localhost:4000',
    // Chave do tenant no motor (Bearer nas chamadas ClinicaApp -> motor).
    apiKey: process.env.AI_ENGINE_API_KEY,
    // Segredo para validar a assinatura X-Signature-256 dos callbacks motor -> ClinicaApp.
    signingSecret: process.env.AI_ENGINE_SIGNING_SECRET,
  },

  // Token de serviço que o motor apresenta para chamar as rotas de negócio
  // (tools do fluxo: /patients, /appointments) sem um login humano.
  serviceApiKey: process.env.SERVICE_API_KEY,
};
