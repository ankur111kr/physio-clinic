// ============================================================
// PHYSIOTHERAPY CLINIC MANAGEMENT SYSTEM - SERVER.JS
// Full-stack Node.js + Express + MongoDB backend
// ============================================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const PDFDocument = require('pdfkit');
const Razorpay = require('razorpay');
const path = require('path');
const crypto = require('crypto');

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiting - prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later.' }
});
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ============================================================
// MONGODB CONNECTION
// ============================================================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/physioclinic')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ============================================================
// MONGOOSE SCHEMAS & MODELS
// ============================================================

// Admin Schema
const adminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, default: 'admin' },
  createdAt: { type: Date, default: Date.now }
});
const Admin = mongoose.model('Admin', adminSchema);

// Appointment Schema
const appointmentSchema = new mongoose.Schema({
  patientName: { type: String, required: true, trim: true },
  phone: { type: String, required: true },
  email: { type: String, trim: true, lowercase: true },
  date: { type: String, required: true },   // YYYY-MM-DD
  time: { type: String, required: true },   // HH:MM
  problem: { type: String, trim: true },
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled'], default: 'pending' },
  paymentId: { type: String },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  amount: { type: Number, default: 500 },
  createdAt: { type: Date, default: Date.now }
});
const Appointment = mongoose.model('Appointment', appointmentSchema);

// Visit Schema (embedded in Patient)
const visitSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  problem: { type: String, required: true },
  treatment: { type: String, required: true },
  prescription: { type: String },
  notes: { type: String },
  nextVisit: { type: String },
  doctor: { type: String, default: 'Dr. Physio' }
});

// Patient Schema
const patientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, unique: true },
  email: { type: String, trim: true, lowercase: true },
  age: { type: Number },
  gender: { type: String, enum: ['Male', 'Female', 'Other'] },
  address: { type: String },
  visits: [visitSchema],
  createdAt: { type: Date, default: Date.now }
});
const Patient = mongoose.model('Patient', patientSchema);

// Payment Schema
const paymentSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  paymentId: { type: String },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created' },
  createdAt: { type: Date, default: Date.now }
});
const Payment = mongoose.model('Payment', paymentSchema);

// ============================================================
// JWT MIDDLEWARE - Protect admin routes
// ============================================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// ============================================================
// RAZORPAY INIT
// ============================================================
let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

// ============================================================
// AUTH ROUTES
// ============================================================

// POST /api/auth/register - Register admin (one-time or protected)
app.post('/api/auth/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('secretKey').equals(process.env.ADMIN_SECRET_KEY || 'physio2024').withMessage('Invalid secret key')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { name, email, password } = req.body;
    const existing = await Admin.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Admin with this email already exists.' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const admin = new Admin({ name, email, password: hashedPassword });
    await admin.save();

    res.status(201).json({ message: 'Admin registered successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// POST /api/auth/login - Admin login
app.post('/api/auth/login', [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials.' });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials.' });

    const token = jwt.sign(
      { id: admin._id, email: admin.email, name: admin.name },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      admin: { id: admin._id, name: admin.name, email: admin.email }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// GET /api/auth/me - Get current admin info
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select('-password');
    res.json(admin);
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ============================================================
// APPOINTMENT ROUTES
// ============================================================

// POST /api/appointments - Book appointment (public)
app.post('/api/appointments', [
  body('patientName').trim().notEmpty().withMessage('Patient name required'),
  body('phone').trim().notEmpty().withMessage('Phone required'),
  body('date').notEmpty().withMessage('Date required'),
  body('time').notEmpty().withMessage('Time required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { patientName, phone, email, date, time, problem } = req.body;

    // Prevent duplicate time slot
    const duplicate = await Appointment.findOne({ date, time, status: { $ne: 'cancelled' } });
    if (duplicate) {
      return res.status(409).json({ error: 'This time slot is already booked. Please choose another.' });
    }

    const appointment = new Appointment({ patientName, phone, email, date, time, problem });
    await appointment.save();

    res.status(201).json({ message: 'Appointment booked successfully!', appointment });
  } catch (err) {
    res.status(500).json({ error: 'Error booking appointment.' });
  }
});

// GET /api/appointments - Get all appointments (admin)
app.get('/api/appointments', authenticateToken, async (req, res) => {
  try {
    const { date, status, search } = req.query;
    let filter = {};
    if (date) filter.date = date;
    if (status) filter.status = status;
    if (search) filter.patientName = { $regex: search, $options: 'i' };

    const appointments = await Appointment.find(filter).sort({ date: 1, time: 1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching appointments.' });
  }
});

// GET /api/appointments/today - Today's appointments (admin)
app.get('/api/appointments/today', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const appointments = await Appointment.find({ date: today }).sort({ time: 1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching today\'s appointments.' });
  }
});

// GET /api/appointments/slots - Get booked slots for a date (public)
app.get('/api/appointments/slots/:date', async (req, res) => {
  try {
    const appointments = await Appointment.find({
      date: req.params.date,
      status: { $ne: 'cancelled' }
    }).select('time');
    const bookedSlots = appointments.map(a => a.time);
    res.json({ bookedSlots });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching slots.' });
  }
});

// PATCH /api/appointments/:id - Update appointment status (admin)
app.patch('/api/appointments/:id', authenticateToken, async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });
    res.json(appointment);
  } catch (err) {
    res.status(500).json({ error: 'Error updating appointment.' });
  }
});

// DELETE /api/appointments/:id - Delete appointment (admin)
app.delete('/api/appointments/:id', authenticateToken, async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndDelete(req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found.' });
    res.json({ message: 'Appointment deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Error deleting appointment.' });
  }
});

// ============================================================
// PATIENT ROUTES
// ============================================================

// POST /api/patients - Add or update patient + add visit (admin)
app.post('/api/patients', authenticateToken, [
  body('name').trim().notEmpty().withMessage('Name required'),
  body('phone').trim().notEmpty().withMessage('Phone required'),
  body('problem').trim().notEmpty().withMessage('Problem required'),
  body('treatment').trim().notEmpty().withMessage('Treatment required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { name, phone, email, age, gender, address, problem, treatment, prescription, notes, nextVisit } = req.body;

    let patient = await Patient.findOne({ phone });
    const visitEntry = { problem, treatment, prescription, notes, nextVisit };

    if (patient) {
      patient.visits.push(visitEntry);
      // Update basic info if changed
      if (name) patient.name = name;
      if (email) patient.email = email;
      if (age) patient.age = age;
      if (gender) patient.gender = gender;
      if (address) patient.address = address;
      await patient.save();
    } else {
      patient = new Patient({ name, phone, email, age, gender, address, visits: [visitEntry] });
      await patient.save();
    }

    res.status(201).json({ message: 'Patient visit recorded.', patient });
  } catch (err) {
    res.status(500).json({ error: 'Error saving patient data.' });
  }
});

// GET /api/patients - Get all patients (admin)
app.get('/api/patients', authenticateToken, async (req, res) => {
  try {
    const { search } = req.query;
    let filter = {};
    if (search) {
      filter = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ]
      };
    }
    const patients = await Patient.find(filter).sort({ createdAt: -1 });
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching patients.' });
  }
});

// GET /api/patients/:id - Get single patient with full history (admin)
app.get('/api/patients/:id', authenticateToken, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching patient.' });
  }
});

// DELETE /api/patients/:id - Delete patient (admin)
app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
  try {
    await Patient.findByIdAndDelete(req.params.id);
    res.json({ message: 'Patient deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Error deleting patient.' });
  }
});

// ============================================================
// PDF PRESCRIPTION ROUTE
// ============================================================

// GET /api/patients/:id/prescription - Generate PDF (admin)
app.get('/api/patients/:id/prescription', authenticateToken, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=prescription_${patient.name.replace(/\s+/g, '_')}.pdf`);
    doc.pipe(res);

    const clinicName = process.env.CLINIC_NAME || 'PhysioPlus Clinic';
    const clinicAddress = process.env.CLINIC_ADDRESS || '123 Health Street, Medical District';
    const clinicPhone = process.env.CLINIC_PHONE || '+91-9876543210';
    const clinicEmail = process.env.CLINIC_EMAIL || 'info@clinic.com';

    // ---- HEADER ----
    doc.rect(0, 0, 612, 120).fill('#1a56db');
    doc.fillColor('#ffffff')
       .fontSize(26).font('Helvetica-Bold')
       .text(clinicName, 50, 30);
    doc.fontSize(10).font('Helvetica')
       .text(clinicAddress, 50, 62)
       .text(`📞 ${clinicPhone}  |  ✉ ${clinicEmail}`, 50, 78);

    // ---- PRESCRIPTION TITLE ----
    doc.fillColor('#1a56db').fontSize(16).font('Helvetica-Bold')
       .text('PRESCRIPTION', 50, 140);
    doc.moveTo(50, 162).lineTo(562, 162).strokeColor('#1a56db').lineWidth(2).stroke();

    // ---- PATIENT DETAILS ----
    doc.fillColor('#333333').fontSize(11).font('Helvetica-Bold')
       .text('PATIENT INFORMATION', 50, 175);
    doc.fontSize(10).font('Helvetica').fillColor('#555555');
    const pd = [
      ['Name', patient.name],
      ['Phone', patient.phone],
      ['Age / Gender', `${patient.age || 'N/A'} / ${patient.gender || 'N/A'}`],
      ['Address', patient.address || 'N/A'],
      ['Report Date', new Date().toLocaleDateString('en-IN')]
    ];
    let yPos = 195;
    pd.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').fillColor('#333333').text(`${label}:`, 50, yPos, { width: 120 });
      doc.font('Helvetica').fillColor('#555555').text(value, 170, yPos, { width: 350 });
      yPos += 18;
    });

    // ---- VISIT HISTORY ----
    yPos += 15;
    doc.fillColor('#1a56db').fontSize(13).font('Helvetica-Bold').text('VISIT HISTORY', 50, yPos);
    yPos += 20;
    doc.moveTo(50, yPos).lineTo(562, yPos).strokeColor('#e0e0e0').lineWidth(1).stroke();
    yPos += 10;

    const visitsToShow = req.query.visitIndex !== undefined
      ? [patient.visits[parseInt(req.query.visitIndex)]]
      : patient.visits.slice(-5); // Last 5 visits

    visitsToShow.forEach((visit, i) => {
      if (!visit) return;
      if (yPos > 700) { doc.addPage(); yPos = 50; }

      // Visit box
      doc.rect(50, yPos, 512, 14).fill('#f0f4ff');
      doc.fillColor('#1a56db').fontSize(10).font('Helvetica-Bold')
         .text(`Visit #${i + 1}  —  ${new Date(visit.date).toLocaleDateString('en-IN')}`, 55, yPos + 2);
      yPos += 20;

      const fields = [
        ['Problem / Diagnosis', visit.problem],
        ['Treatment', visit.treatment],
        ['Prescription', visit.prescription || 'None'],
        ['Notes', visit.notes || 'None'],
        ['Next Visit', visit.nextVisit || 'As required']
      ];
      fields.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').fillColor('#333333').fontSize(9).text(`${label}:`, 55, yPos, { width: 130 });
        doc.font('Helvetica').fillColor('#555555').text(value, 190, yPos, { width: 370 });
        yPos += 16;
      });
      yPos += 10;
    });

    // ---- FOOTER ----
    const pageHeight = doc.page.height;
    doc.rect(0, pageHeight - 60, 612, 60).fill('#f8f9fa');
    doc.moveTo(50, pageHeight - 60).lineTo(562, pageHeight - 60).strokeColor('#1a56db').lineWidth(1).stroke();
    doc.fillColor('#888888').fontSize(9).font('Helvetica')
       .text(`Generated on ${new Date().toLocaleString('en-IN')} | ${clinicName} — Confidential Medical Document`, 50, pageHeight - 42, { align: 'center', width: 512 });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generating PDF.' });
  }
});

// ============================================================
// DASHBOARD / ANALYTICS ROUTES
// ============================================================

// GET /api/dashboard/stats - Dashboard statistics (admin)
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = new Date();
    const firstOfMonth = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1);

    const [totalPatients, totalAppointments, todayAppointments, monthAppointments, pendingAppointments] = await Promise.all([
      Patient.countDocuments(),
      Appointment.countDocuments(),
      Appointment.countDocuments({ date: today }),
      Appointment.countDocuments({ createdAt: { $gte: firstOfMonth } }),
      Appointment.countDocuments({ status: 'pending' })
    ]);

    res.json({ totalPatients, totalAppointments, todayAppointments, monthAppointments, pendingAppointments });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching stats.' });
  }
});

// GET /api/dashboard/monthly - Monthly chart data (admin)
app.get('/api/dashboard/monthly', authenticateToken, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = [];

    for (let month = 0; month < 12; month++) {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59);
      const count = await Appointment.countDocuments({ createdAt: { $gte: start, $lte: end } });
      data.push(count);
    }

    res.json({
      labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
      data
    });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching monthly data.' });
  }
});

// GET /api/dashboard/calendar - Calendar events (admin)
app.get('/api/dashboard/calendar', authenticateToken, async (req, res) => {
  try {
    const appointments = await Appointment.find({ status: { $ne: 'cancelled' } })
      .select('patientName date time status');

    const events = appointments.map(a => ({
      id: a._id,
      title: `${a.time} - ${a.patientName}`,
      start: `${a.date}T${a.time}`,
      backgroundColor: a.status === 'confirmed' ? '#1a56db' :
                        a.status === 'completed' ? '#057a55' :
                        a.status === 'pending' ? '#ff8800' : '#e02424',
      borderColor: 'transparent'
    }));

    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching calendar data.' });
  }
});

// ============================================================
// PAYMENT ROUTES (RAZORPAY)
// ============================================================

// POST /api/payment/create-order - Create Razorpay order
app.post('/api/payment/create-order', [
  body('amount').isNumeric().withMessage('Amount must be a number'),
  body('appointmentId').notEmpty().withMessage('Appointment ID required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  if (!razorpay) return res.status(503).json({ error: 'Payment service not configured.' });

  try {
    const { amount, appointmentId } = req.body;

    const options = {
      amount: Math.round(amount * 100), // Razorpay expects paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: { appointmentId }
    };

    const order = await razorpay.orders.create(options);

    // Save order to DB
    const payment = new Payment({ orderId: order.id, appointmentId, amount });
    await payment.save();

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    res.status(500).json({ error: 'Error creating payment order.' });
  }
});

// POST /api/payment/verify - Verify Razorpay payment
app.post('/api/payment/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, appointmentId } = req.body;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed.' });
    }

    // Update payment record
    await Payment.findOneAndUpdate(
      { orderId: razorpay_order_id },
      { paymentId: razorpay_payment_id, status: 'paid' }
    );

    // Update appointment payment status
    if (appointmentId) {
      await Appointment.findByIdAndUpdate(appointmentId, {
        paymentStatus: 'paid',
        paymentId: razorpay_payment_id
      });
    }

    res.json({ message: 'Payment verified successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Error verifying payment.' });
  }
});

// ============================================================
// WHATSAPP ROUTE
// ============================================================

// GET /api/whatsapp/:patientId - Generate WhatsApp link (admin)
app.get('/api/whatsapp/:patientId', authenticateToken, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    const lastVisit = patient.visits[patient.visits.length - 1];
    const clinicName = process.env.CLINIC_NAME || 'PhysioPlus Clinic';
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    const message = encodeURIComponent(
      `Hello ${patient.name},\n\n` +
      `Thank you for visiting ${clinicName}.\n\n` +
      `*Your last visit summary:*\n` +
      `📅 Date: ${lastVisit ? new Date(lastVisit.date).toLocaleDateString('en-IN') : 'N/A'}\n` +
      `🩺 Problem: ${lastVisit?.problem || 'N/A'}\n` +
      `💊 Prescription: ${lastVisit?.prescription || 'N/A'}\n` +
      `🔜 Next Visit: ${lastVisit?.nextVisit || 'As required'}\n\n` +
      `For your prescription PDF, please contact the clinic.\n` +
      `📞 ${process.env.CLINIC_PHONE || '+91-9876543210'}`
    );

    const phone = patient.phone.replace(/[^0-9]/g, '');
    const whatsappUrl = `https://wa.me/91${phone}?text=${message}`;

    res.json({ url: whatsappUrl, phone: patient.phone });
  } catch (err) {
    res.status(500).json({ error: 'Error generating WhatsApp link.' });
  }
});

// ============================================================
// SERVE FRONTEND HTML FILES
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/patients', (req, res) => res.sendFile(path.join(__dirname, 'public', 'patients.html')));

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error.' });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏥 PhysioClinic Server running on port ${PORT}`);
  console.log(`🌐 Open: http://localhost:${PORT}`);
  console.log(`📊 Admin: http://localhost:${PORT}/admin\n`);
});
