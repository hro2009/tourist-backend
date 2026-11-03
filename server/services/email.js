import nodemailer from 'nodemailer';
import { getSetting } from '../db.js';

let transporter;
function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined
  });
  return transporter;
}

export async function sendEmail({ to, subject, html, text }) {
  const transport = getTransporter();
  const message = { from: process.env.MAIL_FROM || 'Hayq Tours <no-reply@localhost>', to, subject, html, text };
  if (!to) {
    console.info('[email:unconfigured]', JSON.stringify(message));
    return { delivery: 'not_sent' };
  }
  if (!transport) {
    console.info('[email:unconfigured]', JSON.stringify(message));
    return { delivery: 'logged' };
  }
  const result = await transport.sendMail(message);
  return { delivery: 'sent', messageId: result.messageId };
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export async function sendBookingEmails(booking, items) {
  const itemRows = items.map(item => `<li>${escapeHtml(item.name)} - ${escapeHtml(item.date)}, ${item.guests} guest(s)</li>`).join('');
  const html = `<main style="font-family:Arial,sans-serif;color:#241a1d"><h1 style="color:#a3203b">Hayq Tours</h1><p>Booking reference: <strong>${escapeHtml(booking.reference)}</strong></p><ul>${itemRows}</ul><p>Total: ${booking.total_amd.toLocaleString('en-US')} AMD</p><p>We will be in touch to confirm your trip.</p></main>`;
  await Promise.all([
    sendEmail({ to: booking.email, subject: `Hayq booking ${booking.reference}`, html, text: `Booking ${booking.reference}. Total ${booking.total_amd} AMD.` }),
    sendEmail({ to: process.env.OWNER_EMAIL || getSetting('contact_email'), subject: `New booking ${booking.reference}`, html, text: `New booking ${booking.reference} from ${booking.customer_name}.` })
  ].filter(promise => promise));
}

export async function sendRequestAlert(request) {
  return sendEmail({
    to: process.env.OWNER_EMAIL || getSetting('contact_email'),
    subject: `New custom trip request from ${request.name}`,
    html: `<main style="font-family:Arial,sans-serif"><h1>New custom trip request</h1><p>${escapeHtml(request.name)} (${escapeHtml(request.email)})</p><p>${escapeHtml(request.message)}</p></main>`,
    text: `${request.name} (${request.email}): ${request.message}`
  });
}