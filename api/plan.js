// Función serverless (Vercel) que genera el plan de acción con Claude.
// La API key vive en la variable de entorno ANTHROPIC_API_KEY y nunca llega al navegador.
// El prompt se arma aquí, en el servidor: la página solo envía datos de la cuenta,
// así nadie puede usar este endpoint para pedirle otra cosa al modelo.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const str = (v, max) => String(v ?? '').slice(0, max);
const num = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));

function clean(c) {
  return {
    cliente: str(c.cliente, 80),
    pais: str(c.pais, 40),
    plan: str(c.plan, 40),
    valorMensualUSD: num(c.valorMensualUSD, 0, 100000),
    antiguedadMeses: num(c.antiguedadMeses, 0, 600),
    diasParaRenovacion: num(c.diasParaRenovacion, 0, 1000),
    frecuenciaUso: str(c.frecuenciaUso, 20),
    nps: num(c.nps, 0, 10),
    ticketsAbiertos: num(c.ticketsAbiertos, 0, 500),
    severidadCasos: str(c.severidadCasos, 20),
    modulosAdoptados: Array.isArray(c.modulosAdoptados) ? c.modulosAdoptados.slice(0, 8).map(m => str(m, 40)) : [],
    notasUltimoContacto: str(c.notasUltimoContacto, 600),
    puntuacionSalud: num(c.puntuacionSalud, 0, 100),
    nivel: str(c.nivel, 60),
  };
}

function buildPrompt(acc) {
  return `Eres un Key Account Manager senior en Alegra, la plataforma de facturación electrónica, contabilidad, POS y nómina para pymes y contadores en Latinoamérica y España. Tu trabajo es ser asesor de confianza de tus cuentas: retenerlas y ayudarlas a crecer con la plataforma.

Datos de la cuenta:
${JSON.stringify(acc, null, 2)}

Responde ÚNICAMENTE con un objeto JSON válido (sin texto adicional, sin markdown) con esta forma exacta:
{
  "acciones": ["acción concreta 1", "acción concreta 2", "acción concreta 3"],
  "guion": "guion breve (60-100 palabras) para la próxima llamada, en español, tono cercano y profesional, que reconozca el contexto específico de la cuenta",
  "oportunidad": "oportunidad de expansión o cross-sell concreta basada en los módulos no adoptados y en las notas del último contacto (40-70 palabras)"
}

Las acciones deben ser específicas a esta cuenta (usa nombre, país, plan y notas), no genéricas. Si el riesgo es alto, prioriza retención; si la cuenta está saludable, prioriza expansión.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'not_configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body.cuenta !== 'object' || body.cuenta === null) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        messages: [{ role: 'user', content: buildPrompt(clean(body.cuenta)) }],
      }),
    });

    if (!r.ok) {
      res.status(502).json({ error: 'upstream_' + r.status });
      return;
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .replace(/```json|```/g, '')
      .trim();
    const plan = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

    res.status(200).json({ plan, model: data.model || MODEL });
  } catch (e) {
    res.status(502).json({ error: 'generation_failed' });
  }
}
