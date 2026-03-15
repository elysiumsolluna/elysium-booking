// js/server.js

// ---------- IMPORTS ----------
const fs = require('fs');
const path = require('path');

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadLocalEnvFile();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const cron = require('node-cron');

// ---------- CONFIG ----------
const PORT = process.env.PORT || 3000;

// Brevo for sending confirmation emails
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'brevo';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM;
const TEST_EMAIL_TO = process.env.TEST_EMAIL_TO || MAIL_FROM;
const BREVO_TIMEOUT_MS = Number(process.env.BREVO_TIMEOUT_MS || 15000);

// Google Sheet
const SHEET_ID = process.env.SHEET_ID;

// Google Service Account
const GOOGLE_CREDS = {
  type: process.env.GOOGLE_TYPE,
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLIENT_ID,
  auth_uri: process.env.GOOGLE_AUTH_URI,
  token_uri: process.env.GOOGLE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_CERT_URL,
  client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
};

// ---------- EXPRESS APP ----------
const app = express();

// CORS for your frontend live URL
app.use(cors({
  origin: 'https://elysiumsolluna.onrender.com'
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..')));

// ---------- EMAIL TRANSPORT ----------
const provider = EMAIL_PROVIDER.toLowerCase();
const useBrevo = provider === 'brevo';
const brevoConfigured = Boolean(BREVO_API_KEY && MAIL_FROM);

if (!useBrevo) {
  console.warn(`[Email] Unsupported EMAIL_PROVIDER="${EMAIL_PROVIDER}". Only "brevo" is supported.`);
} else if (!brevoConfigured) {
  console.warn('[Email] EMAIL_PROVIDER=brevo but BREVO_API_KEY/MAIL_FROM missing.');
} else {
  console.log('[Email] Brevo provider enabled.');
}


function normalizeRecipients(to) {
  const recipients = Array.isArray(to) ? to : [to];
  return recipients.map((email) => String(email || '').trim()).filter(Boolean);
}

async function sendEmail(mailOptions) {
  if (!useBrevo) return { sent: false, reason: 'Unsupported provider. Set EMAIL_PROVIDER=brevo' };
  if (!brevoConfigured) return { sent: false, reason: 'Brevo credentials are missing' };

  const recipients = normalizeRecipients(mailOptions.to);
  if (!recipients.length) return { sent: false, reason: 'No recipients defined.' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: { email: MAIL_FROM },
        to: recipients.map((email) => ({ email })),
        subject: mailOptions.subject,
        htmlContent: mailOptions.html,
        textContent: mailOptions.text
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      return { sent: false, reason: `Brevo failed (${response.status}): ${body}` };
    }

    return { sent: true };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { sent: false, reason: `Brevo request timed out after ${BREVO_TIMEOUT_MS}ms` };
    }
    console.error('[Email] Brevo send failed:', err.message);
    return { sent: false, reason: err.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------- JSON BACKUP FILES ----------
const bookingsFile = path.join(__dirname, 'bookings.json');
const vipFile = path.join(__dirname, 'vipBookings.json');

if (!fs.existsSync(bookingsFile)) fs.writeFileSync(bookingsFile, JSON.stringify([]));
if (!fs.existsSync(vipFile)) fs.writeFileSync(vipFile, JSON.stringify([]));


function readBookingsArray(filePath, label) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Expected an array');
    return parsed;
  } catch (err) {
    console.error(`[Data] Failed to read ${label}:`, err.message);
    fs.writeFileSync(filePath, JSON.stringify([]));
    return [];
  }
}

// ---------- HELPER: GOOGLE SHEET ----------
async function saveToSheet(booking, isVIP = false) {
  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(GOOGLE_CREDS);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[isVIP ? 'VIP Bookings' : 'Regular Bookings'];
    if (!sheet) throw new Error(`Sheet "${isVIP ? 'VIP Bookings' : 'Regular Bookings'}" not found`);
    await sheet.addRow(booking);
  } catch (err) {
    console.error("Google Sheet save failed:", err.message);
  }
}

function matchesSheetRow(rowValue, bookingValue) {
  return String(rowValue ?? '').trim() === String(bookingValue ?? '').trim();
}

async function deleteFromSheet(booking, isVIP = false) {
  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(GOOGLE_CREDS);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[isVIP ? 'VIP Bookings' : 'Regular Bookings'];
    if (!sheet) throw new Error(`Sheet "${isVIP ? 'VIP Bookings' : 'Regular Bookings'}" not found`);

    const rows = await sheet.getRows();
    const matchedRow = rows.find((row) => {
      if (isVIP) {
        return (
          matchesSheetRow(row.Name, booking.name) &&
          matchesSheetRow(row.Email, booking.email) &&
          matchesSheetRow(row.Date, booking.date) &&
          matchesSheetRow(row.Time, booking.time)
        );
      }

      return (
        matchesSheetRow(row.Name, booking.name) &&
        matchesSheetRow(row.Email, booking.email) &&
        matchesSheetRow(row.Service, booking.service) &&
        matchesSheetRow(row.Barber, booking.barber) &&
        matchesSheetRow(row.Date, booking.date) &&
        matchesSheetRow(row.Time, booking.time)
      );
    });

    if (!matchedRow) return { deleted: false, reason: 'Matching row was not found in Google Sheet' };

    await matchedRow.delete();
    return { deleted: true };
  } catch (err) {
    console.error('Google Sheet delete failed:', err.message);
    return { deleted: false, reason: err.message };
  }
}

// ---------- TEST EMAIL ----------
app.get('/test-email', async (req, res) => {
  const result = await sendEmail({
    from: MAIL_FROM,
    to: TEST_EMAIL_TO,
    subject: 'Test Email from ELYSIUM',
    text: 'This is a test email to confirm SMTP is working!'
  });

  if (result.sent) return res.send('Test email sent! Check your inbox.');
  return res.status(500).send(`Test email failed: ${result.reason}`);
});

// ---------- API: GET BOOKINGS ----------
app.get('/bookings', (req, res) => {
  res.json(readBookingsArray(bookingsFile, 'bookings.json'));
});
app.get('/vipBookings', (req, res) => {
  res.json(readBookingsArray(vipFile, 'vipBookings.json'));
});

// ---------- API: POST BOOKING ----------
app.post('/book', async (req, res) => {
  try {
    const bookings = readBookingsArray(bookingsFile, 'bookings.json');
    const conflict = bookings.find(b => b.barber === req.body.barber && b.date === req.body.date && b.time === req.body.time);
    if (conflict) return res.status(400).json({ message: "Barber already booked." });

    bookings.push(req.body);
    fs.writeFileSync(bookingsFile, JSON.stringify(bookings, null, 2));

    await saveToSheet({
      Name: req.body.name,
      Email: req.body.email,
      Service: req.body.service,
      Barber: req.body.barber,
      Date: req.body.date,
      Time: req.body.time
    });

    const emailResult = await sendEmail({
      from: MAIL_FROM,
      to: req.body.email,
      subject: 'Booking Confirmation – ELYSIUM',
      html: `<h2>Dear ${req.body.name}</h2>
             <p>Your appointment is confirmed:</p>
             <ul>
               <li><b>Service:</b> ${req.body.service}</li>
               <li><b>Barber:</b> ${req.body.barber}</li>
               <li><b>Date:</b> ${req.body.date}</li>
               <li><b>Time:</b> ${req.body.time}</li>
             </ul>`
    });

    if (!emailResult.sent) {
      return res.status(202).json({
        message: `Booking saved, but confirmation email could not be sent (${emailResult.reason}).`
      });
    }

    res.json({ message: 'Booking saved and email sent!' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Booking failed." });
  }
});

// ---------- API: POST VIP BOOKING ----------
app.post('/vip', async (req, res) => {
  try {
    const vipBookings = readBookingsArray(vipFile, 'vipBookings.json');
    const conflict = vipBookings.find(b => b.barber === req.body.barber && b.date === req.body.date && b.time === req.body.time);
    if (conflict) return res.status(400).json({ message: "VIP slot already booked." });

    vipBookings.push(req.body);
    fs.writeFileSync(vipFile, JSON.stringify(vipBookings, null, 2));

    await saveToSheet({
      Name: req.body.name,
      Email: req.body.email,
      Date: req.body.date,
      Time: req.body.time
    }, true);

    const emailResult = await sendEmail({
      from: MAIL_FROM,
      to: req.body.email,
      subject: 'VIP Booking Confirmation – ELYSIUM',
      html: `<h2>Dear ${req.body.name}</h2>
             <p>Your VIP appointment is confirmed:</p>
             <ul>
               <li><b>Date:</b> ${req.body.date}</li>
               <li><b>Time:</b> ${req.body.time}</li>
             </ul>`
    });

    if (!emailResult.sent) {
      return res.status(202).json({
        message: `VIP booking saved, but confirmation email could not be sent (${emailResult.reason}).`
      });
    }

    res.json({ message: 'VIP booking saved and email sent!' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "VIP booking failed." });
  }
});

// ---------- API: DELETE BOOKINGS ----------
app.post('/deleteBooking', async (req, res) => {
  try {
    const { name, email, service, barber, date, time } = req.body || {};
    const bookings = readBookingsArray(bookingsFile, 'bookings.json');

    const filtered = bookings.filter((b) => !(
      b.name === name &&
      b.email === email &&
      b.service === service &&
      b.barber === barber &&
      b.date === date &&
      b.time === time
    ));

    if (filtered.length === bookings.length) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    fs.writeFileSync(bookingsFile, JSON.stringify(filtered, null, 2));

    const [sheetResult, emailResult] = await Promise.all([
      deleteFromSheet(req.body, false),
      sendEmail({
        from: MAIL_FROM,
        to: email,
        subject: 'Booking Cancellation – ELYSIUM',
        html: `<h2>Dear ${name}</h2>
               <p>Your booking has been cancelled:</p>
               <ul>
                 <li><b>Service:</b> ${service}</li>
                 <li><b>Barber:</b> ${barber}</li>
                 <li><b>Date:</b> ${date}</li>
                 <li><b>Time:</b> ${time}</li>
               </ul>`
      })
    ]);

    return res.json({
      message: 'Booking deleted.',
      sheetDeleted: sheetResult.deleted,
      sheetReason: sheetResult.deleted ? undefined : sheetResult.reason,
      cancellationEmailSent: emailResult.sent,
      cancellationEmailReason: emailResult.sent ? undefined : emailResult.reason
    });
  } catch (err) {
    console.error('Delete booking failed:', err);
    return res.status(500).json({ message: 'Delete booking failed.' });
  }
});

app.post('/deleteVIP', async (req, res) => {
  try {
    const { name, email, date, time } = req.body || {};
    const vipBookings = readBookingsArray(vipFile, 'vipBookings.json');

    const filtered = vipBookings.filter((b) => !(
      b.name === name &&
      b.email === email &&
      b.date === date &&
      b.time === time
    ));

    if (filtered.length === vipBookings.length) {
      return res.status(404).json({ message: 'VIP booking not found.' });
    }

    fs.writeFileSync(vipFile, JSON.stringify(filtered, null, 2));

    const [sheetResult, emailResult] = await Promise.all([
      deleteFromSheet(req.body, true),
      sendEmail({
        from: MAIL_FROM,
        to: email,
        subject: 'VIP Booking Cancellation – ELYSIUM',
        html: `<h2>Dear ${name}</h2>
               <p>Your VIP booking has been cancelled:</p>
               <ul>
                 <li><b>Date:</b> ${date}</li>
                 <li><b>Time:</b> ${time}</li>
               </ul>`
      })
    ]);

    return res.json({
      message: 'VIP booking deleted.',
      sheetDeleted: sheetResult.deleted,
      sheetReason: sheetResult.deleted ? undefined : sheetResult.reason,
      cancellationEmailSent: emailResult.sent,
      cancellationEmailReason: emailResult.sent ? undefined : emailResult.reason
    });
  } catch (err) {
    console.error('Delete VIP booking failed:', err);
    return res.status(500).json({ message: 'Delete VIP booking failed.' });
  }
});

// ---------- ADMIN DASHBOARD ----------
app.get('/admin', (req, res) => {
  const bookings = readBookingsArray(bookingsFile, 'bookings.json');
  const vipBookings = readBookingsArray(vipFile, 'vipBookings.json');
  res.send(`<h1>Admin Dashboard</h1>
            <h2>Bookings</h2><pre>${JSON.stringify(bookings, null, 2)}</pre>
            <h2>VIP Bookings</h2><pre>${JSON.stringify(vipBookings, null, 2)}</pre>`);
});

// ---------- REMINDERS ----------
function checkReminders() {
  const bookings = readBookingsArray(bookingsFile, 'bookings.json');
  const now = new Date();
  bookings.forEach(b => {
    const appointment = new Date(`${b.date}T${b.time}`);
    const diff = (appointment - now) / (1000 * 60 * 60);
    if (diff > 2.9 && diff < 3.1) {
      sendEmail({
        from: MAIL_FROM,
        to: b.email,
        subject: 'Reminder – Your ELYSIUM Appointment',
        html: `<h2>Hello ${b.name}</h2><p>Your appointment is in ~3 hours.</p>`
      }).then((result) => {
        if (result.sent) console.log('Reminder sent');
      });
    }
  });
}
cron.schedule('*/10 * * * *', checkReminders);

// ---------- ERROR HANDLING ----------
process.on('unhandledRejection', (reason, p) => console.error('Unhandled Rejection:', reason, p));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

// ---------- START SERVER ----------
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));