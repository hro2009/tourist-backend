import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../errors.js';

export async function createCheckoutSession(booking, items, usdRate) {
  if ((process.env.PAYMENT_MODE || 'on_arrival') !== 'stripe') return null;
  // TODO: Add an Idram provider adapter and verify its signed callback before marking a booking paid.
  // TODO: Add an Ameriabank vPOS hosted-payment adapter and verify its callback signature.
  if (!process.env.STRIPE_SECRET_KEY) throw new ApiError(503, 'Online payments are not configured.', 'PAYMENTS_UNAVAILABLE');
  const amountUsdCents = Math.max(50, Math.round(booking.total_amd / Number(usdRate) * 100));
  const body = new URLSearchParams({
    mode: 'payment',
    success_url: `${process.env.PUBLIC_URL}/?payment=success&reference=${encodeURIComponent(booking.reference)}`,
    cancel_url: `${process.env.PUBLIC_URL}/?payment=cancelled&reference=${encodeURIComponent(booking.reference)}`,
    customer_email: booking.email,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': `Hayq Armenia tour booking ${booking.reference}`,
    'line_items[0][price_data][unit_amount]': String(amountUsdCents),
    'line_items[0][quantity]': '1',
    'metadata[booking_reference]': booking.reference
  });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(502, 'Could not start the payment session.', 'PAYMENT_PROVIDER_ERROR');
  return data.url;
}

export function verifyStripeSignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(part => part.split('=')));
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const actual = Buffer.from(parts.v1, 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}