// js/server.js

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const cron = require('node-cron');

// ---------- CONFIG ----------
const PORT = process.env.PORT || 3000;
const EMAIL_USER = process.env.GMAIL_USER;
const EMAIL_PASS = process.env.GMAIL_PASS;
const SHEET_ID = process.env.SHEET_ID;

// Reconstruct GOOGLE_CREDS from individual env vars
const GOOGLE_CREDS = {
  type: process.env.GOOGLE_TYPE,
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // important
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLIENT_ID,
  auth_uri: process.env.GOOGLE_AUTH_URI,
  token_uri: process.env.GOOGLE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_CERT_URL,
  client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL
};

// Validate environment variables
if (!GOOGLE_CREDS || !EMAIL_USER || !EMAIL_PASS || !SHEET_ID) {
  console.error("Missing environment variables. Check GOOGLE_CREDS reconstruction and email credentials.");
  process.exit(1);
}
const creds = GOOGLE_CREDS;
const app = express();

// Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  secure: false
});

// Serve static files from project root
app.use(express.static(path.join(__dirname, '..')));
app.use(cors());
app.use(bodyParser.json());

// JSON backups
const bookingsFile = path.join(__dirname, 'bookings.json');
const vipFile = path.join(__dirname, 'vipBookings.json');

// Create JSON files if missing
if (!fs.existsSync(bookingsFile)) fs.writeFileSync(bookingsFile, JSON.stringify([]));
if (!fs.existsSync(vipFile)) fs.writeFileSync(vipFile, JSON.stringify([]));

// ---------- Google Sheet Helper ----------
async function saveToSheet(booking, isVIP = false) {
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  const sheetTitle = isVIP ? 'VIP Bookings' : 'Regular Bookings';
  const sheet = doc.sheetsByTitle[sheetTitle];
  if (!sheet) throw new Error(`Sheet "${sheetTitle}" not found!`);
  await sheet.addRow(booking);
}

// ---------- API ----------

// GET bookings
app.get('/bookings', (req, res) => {
  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  res.json(bookings);
});

app.get('/vipBookings', (req, res) => {
  const vipBookings = JSON.parse(fs.readFileSync(vipFile));
  res.json(vipBookings);
});

// POST regular booking
app.post('/book', async (req, res) => {
  try {
    const bookings = JSON.parse(fs.readFileSync(bookingsFile));
    const conflict = bookings.find(b =>
      b.barber === req.body.barber && b.date === req.body.date && b.time === req.body.time
    );
    if (conflict) return res.status(400).json({ message: `Barber already booked.` });

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

    await transporter.sendMail({
      from: EMAIL_USER,
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

    res.json({ message: 'Booking saved and email sent!' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Booking failed.' });
  }
});

// POST VIP booking
app.post('/vip', async (req, res) => {
  try {
    const vipBookings = JSON.parse(fs.readFileSync(vipFile));
    const conflict = vipBookings.find(b =>
      b.barber === req.body.barber && b.date === req.body.date && b.time === req.body.time
    );
    if (conflict) return res.status(400).json({ message: `Barber already booked.` });

    vipBookings.push(req.body);
    fs.writeFileSync(vipFile, JSON.stringify(vipBookings, null, 2));

    await saveToSheet({
      Name: req.body.name,
      Email: req.body.email,
      Date: req.body.date,
      Time: req.body.time
    }, true);

    await transporter.sendMail({
      from: EMAIL_USER,
      to: req.body.email,
      subject: 'VIP Booking Confirmation – ELYSIUM',
      html: `<h2>Dear ${req.body.name}</h2>
             <p>Your VIP appointment is confirmed:</p>
             <ul>
               <li><b>Date:</b> ${req.body.date}</li>
               <li><b>Time:</b> ${req.body.time}</li>
             </ul>`
    });

    res.json({ message: 'VIP booking saved and email sent!' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'VIP booking failed.' });
  }
});

// ---------- Admin Dashboard ----------
app.get('/admin', (req, res) => {
  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  const vipBookings = JSON.parse(fs.readFileSync(vipFile));
  res.send(`<h1>Admin Dashboard</h1>
            <h2>Bookings</h2><pre>${JSON.stringify(bookings, null, 2)}</pre>
            <h2>VIP Bookings</h2><pre>${JSON.stringify(vipBookings, null, 2)}</pre>`);
});

// ---------- Reminders ----------
function checkReminders() {
  const bookings = JSON.parse(fs.readFileSync(bookingsFile));
  const now = new Date();
  bookings.forEach(b => {
    const appointment = new Date(`${b.date}T${b.time}`);
    const diff = (appointment - now) / (1000 * 60 * 60);
    if (diff > 2.9 && diff < 3.1) {
      transporter.sendMail({
        from: EMAIL_USER,
        to: b.email,
        subject: 'Reminder – Your ELYSIUM Appointment',
        html: `<h2>Hello ${b.name}</h2>
               <p>Your appointment at ELYSIUM is in ~3 hours.</p>`
      }).then(() => console.log("Reminder sent")).catch(err => console.log(err));
    }
  });
}

cron.schedule('*/10 * * * *', checkReminders);

// ---------- Start Server ----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});