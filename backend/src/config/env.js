import dotenv from 'dotenv';
dotenv.config();

export const env = {
  port: Number(process.env.PORT || 3000),
  // Aceita lista separada por vírgula: em produção o SPA vem de um domínio (app.<dominio>)
  // e a API de outro (api.<dominio>), mas o dev continua em localhost:5173. Passar as duas
  // origens evita ter que escolher entre um ambiente e outro.
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

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
