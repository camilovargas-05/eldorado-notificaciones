// Revisa las notificaciones de Eldorado y manda las nuevas a Discord.
// Variables necesarias: ELDORADO_CLIENT_ID, ELDORADO_CLIENT_SECRET, DISCORD_WEBHOOK_URL
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASE = "https://www.eldorado.gg";
const STATE_FILE = "state.json";
const { ELDORADO_CLIENT_ID, ELDORADO_CLIENT_SECRET, DISCORD_WEBHOOK_URL } = process.env;

if (!ELDORADO_CLIENT_ID || !ELDORADO_CLIENT_SECRET || !DISCORD_WEBHOOK_URL) {
  console.error("Faltan variables de entorno (credenciales o webhook).");
  process.exit(1);
}

const EVENTS = {
  OrderCreated: ["🛒", "¡Nueva venta!"],
  PaymentCompleted: ["💰", "Pago completado"],
  OrderDelivered: ["📦", "Pedido marcado como entregado"],
  OrderReceived: ["✅", "El comprador confirmó que recibió el pedido"],
  OrderDisputed: ["⚠️", "¡Abrieron una disputa!"],
  OrderCancelledBySeller: ["❌", "Pedido cancelado (por ti)"],
  OrderCancelledByAdmin: ["❌", "Pedido cancelado por Eldorado"],
  BuyerContactedSeller: ["💬", "Un comprador te escribió"],
  ConversationCreated: ["💬", "Nueva conversación"],
  ConversationCreatedByAdmin: ["🛡️", "Soporte de Eldorado abrió una conversación"],
  TalkJsNudge: ["💬", "Tienes mensajes sin leer"],
  DeliveryDetailsReminderMin15: ["⏰", "Recordatorio de entrega (15 min)"],
  DeliveryDetailsReminderHour1: ["⏰", "Recordatorio de entrega (1 hora)"],
  DeliveryDetailsReminderHour3: ["⏰", "Recordatorio de entrega (3 horas)"],
  ReviewCompleted: ["⭐", "Nueva reseña"],
  WarrantyClaimIssued: ["🛠️", "Reclamo de garantía"],
  BoostingRequestCreated: ["🚀", "Nueva solicitud de boosting"],
  UserSuspended: ["🚫", "Tu cuenta fue suspendida"],
};

async function getToken() {
  const r = await fetch(`${BASE}/api/authentication/seller/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: ELDORADO_CLIENT_ID, clientSecret: ELDORADO_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`Token falló: HTTP ${r.status}`);
  return (await r.json()).accessToken;
}

async function getNotifications(token) {
  const r = await fetch(`${BASE}/api/notifications/me?pageSize=30`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Notificaciones falló: HTTP ${r.status}`);
  return (await r.json()).results || [];
}

function formatMoney(p) {
  if (!p || typeof p !== "object") return null;
  const amount = p.amount ?? p.value;
  return amount != null ? `${amount} ${p.currency ?? ""}`.trim() : null;
}

function toMessage(item) {
  const n = item.notification;
  const c = item.customNotification;
  if (n && n.event !== "Custom") {
    const [emoji, title] = EVENTS[n.event] || ["🔔", n.event];
    const d = n.details || {};
    const lines = [`${emoji} **${title}**`];
    if (d.title) lines.push(`📄 ${d.title}`);
    if (d.gameCategoryTitle) lines.push(`🎮 ${d.gameCategoryTitle}`);
    const price = formatMoney(d.price);
    if (price) lines.push(`💵 ${price}`);
    if (d.buyerUsername) lines.push(`👤 Comprador: ${d.buyerUsername}`);
    return lines.join("\n");
  }
  const src = c || n?.customNotificationData || {};
  const lines = [`🔔 **${src.subject || "Notificación de Eldorado"}**`];
  if (src.text) lines.push(src.text);
  if (src.redirectUrl) lines.push(src.redirectUrl.startsWith("http") ? src.redirectUrl : BASE + src.redirectUrl);
  return lines.join("\n");
}

async function sendDiscord(content) {
  const r = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Eldorado", content: content.slice(0, 1900) }),
  });
  if (!r.ok) throw new Error(`Discord falló: HTTP ${r.status}`);
}

const idOf = (item) => item.notification?.id || item.customNotification?.id;

const firstRun = !existsSync(STATE_FILE);
const state = firstRun ? { seen: [] } : JSON.parse(readFileSync(STATE_FILE, "utf8"));
const seen = new Set(state.seen);

const token = await getToken();
const items = await getNotifications(token);
const fresh = items.filter((i) => idOf(i) && !seen.has(idOf(i))).reverse(); // más antiguas primero

if (firstRun) {
  await sendDiscord("✅ **Monitor de Eldorado activado.** Desde ahora te aviso de ventas, mensajes y más.");
} else {
  for (const item of fresh) await sendDiscord(toMessage(item));
}

for (const item of fresh) seen.add(idOf(item));
// lastRunDay cambia una vez al día: mantiene el repo activo (GitHub pausa los cron tras 60 días sin commits).
const lastRunDay = new Date().toISOString().slice(0, 10);
writeFileSync(STATE_FILE, JSON.stringify({ lastRunDay, seen: [...seen].slice(-300) }, null, 2) + "\n");
console.log(`Revisadas ${items.length} notificaciones, ${firstRun ? 0 : fresh.length} enviadas.`);
