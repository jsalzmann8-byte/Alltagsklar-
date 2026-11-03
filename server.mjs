import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = Number(process.env.PORT || 4242);
const appUrl = process.env.APP_URL || `http://localhost:${port}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const required = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter(k => !process.env[k]);
const supabaseAdmin = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;
const stripe = process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('REPLACE_ME') ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const openai = process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('YOUR_') ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Stripe requires the untouched request body for signature verification.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET.includes('REPLACE_ME')) return res.status(503).send('Stripe webhook is not configured.');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (err) { return res.status(400).send(`Webhook signature error: ${err.message}`); }
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.supabase_user_id;
      const plan = session.metadata?.plan;
      if (userId && ['plus','premium'].includes(plan) && supabaseAdmin) {
        await supabaseAdmin.from('profiles').update({ plan, stripe_customer_id: String(session.customer || ''), stripe_subscription_id: String(session.subscription || '') }).eq('id', userId);
      }
    }
    if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const userId = subscription.metadata?.supabase_user_id;
      if (userId && supabaseAdmin) {
        const active = ['active','trialing'].includes(subscription.status);
        const plan = active ? (subscription.metadata?.plan || 'plus') : 'free';
        await supabaseAdmin.from('profiles').update({ plan, stripe_subscription_id: active ? subscription.id : null }).eq('id', userId);
      }
    }
    res.json({ received: true });
  } catch (err) { console.error('Stripe webhook processing failed:', err); res.status(500).send('Webhook processing failed.'); }
});
app.use(express.json({ limit: '40kb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function getUser(req, res, next) {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Bitte melde dich zuerst an.' });
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte melde dich erneut an.' });
  req.user = data.user;
  next();
}

app.get('/api/config', (_req, res) => res.json({
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  ready: missing.length === 0,
}));
app.get('/api/me', getUser, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('profiles').select('id,display_name,plan').eq('id', req.user.id).maybeSingle();
  if (error) return res.status(500).json({ error: 'Profil konnte nicht geladen werden.' });
  res.json({ user: { id: req.user.id, email: req.user.email }, profile: data || { id: req.user.id, plan: 'free' } });
});

app.post('/api/assistant', getUser, async (req, res) => {
  const prompt = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!prompt || prompt.length > 5000) return res.status(400).json({ error: 'Bitte gib eine Nachricht mit maximal 5.000 Zeichen ein.' });
  if (!openai) return res.status(503).json({ error: 'Der KI-Dienst ist noch nicht eingerichtet. Bitte hinterlege OPENAI_API_KEY auf dem Server.' });
  const { data: profile } = await supabaseAdmin.from('profiles').select('plan').eq('id', req.user.id).maybeSingle();
  const plan = profile?.plan || 'free';
  const { count, error: countError } = await supabaseAdmin.from('ai_usage').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id).gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());
  if (countError) return res.status(500).json({ error: 'Nutzungslimit konnte nicht geprüft werden.' });
  const limits = { free: 3, plus: 50, premium: 200 };
  if ((count || 0) >= limits[plan]) return res.status(429).json({ error: `Dein Monatslimit für den Tarif ${plan.toUpperCase()} ist erreicht.` });
  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-6-luna',
      instructions: 'Du bist ALLTAGSKLAR, ein freundlicher deutschsprachiger Alltagsassistent. Gib konkrete, überschaubare Schritte, Checklisten oder Textentwürfe. Stelle bei fehlenden Angaben höchstens zwei kurze Rückfragen. Behaupte keine rechtliche, medizinische oder finanzielle Gewissheit; bei solchen Themen erkläre Grenzen und verweise bei Bedarf auf qualifizierte Stellen. Bitte nicht um Passwörter, Kontodaten oder unnötige sensible Informationen.',
      input: prompt,
      max_output_tokens: 700,
    });
    await supabaseAdmin.from('ai_usage').insert({ user_id: req.user.id, model: process.env.OPENAI_MODEL || 'gpt-6-luna' });
    res.json({ answer: response.output_text || 'Ich konnte diesmal keine Antwort erstellen. Bitte versuche es erneut.', remaining: Math.max(0, limits[plan] - (count || 0) - 1) });
  } catch (err) { console.error('AI request failed:', err); res.status(502).json({ error: 'Der Assistent ist gerade nicht erreichbar. Bitte versuche es später erneut.' }); }
});

app.post('/api/billing/checkout', getUser, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe ist noch nicht eingerichtet.' });
  const plan = req.body?.plan;
  if (!['plus','premium'].includes(plan)) return res.status(400).json({ error: 'Ungültiger Tarif.' });
  const price = plan === 'plus' ? process.env.STRIPE_PRICE_PLUS : process.env.STRIPE_PRICE_PREMIUM;
  if (!price || price.includes('REPLACE_')) return res.status(503).json({ error: `Die Stripe-Preis-ID für ${plan} fehlt noch.` });
  const { data: profile } = await supabaseAdmin.from('profiles').select('stripe_customer_id').eq('id', req.user.id).maybeSingle();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: `${appUrl}/?checkout=success`,
      cancel_url: `${appUrl}/?checkout=cancelled#preise`,
      client_reference_id: req.user.id,
      customer: profile?.stripe_customer_id || undefined,
      customer_email: profile?.stripe_customer_id ? undefined : req.user.email,
      metadata: { supabase_user_id: req.user.id, plan },
      subscription_data: { metadata: { supabase_user_id: req.user.id, plan } },
    });
    res.json({ url: session.url });
  } catch (err) { console.error('Stripe checkout failed:', err); res.status(502).json({ error: 'Der Bezahlvorgang konnte nicht gestartet werden.' }); }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', configured: { supabase: !!supabaseAdmin, openai: !!openai, stripe: !!stripe } }));
app.listen(port, () => {
  console.log(`ALLTAGSKLAR läuft unter ${appUrl}`);
  if (missing.length) console.warn(`Konfiguration fehlt: ${missing.join(', ')}`);
});
