import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

import './models/index.js';

import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import ticketRoutes from './routes/tickets.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import analyticsRoutes from './routes/analytics.js';
import supportRoutes from './routes/support.js';

const app = express();

/* =====================================================
   ENVIRONMENT / STARTUP LOGS
===================================================== */

const port = process.env.PORT || 5000;

console.log('========================================');
console.log('Starting EventHub API...');
console.log('PORT:', port);
console.log('MONGO_URI exists:', !!process.env.MONGO_URI);
console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);
console.log('CLIENT_URL:', process.env.CLIENT_URL);
console.log('========================================');

/* =====================================================
   CORS
===================================================== */

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://event-management-system-vairam.netlify.app',

  ...(process.env.CLIENT_URL
    ? process.env.CLIENT_URL
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean)
    : [])
];

console.log('Allowed CORS origins:', allowedOrigins);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow Postman/server-to-server requests
      // where there is no Origin header.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log('CORS blocked origin:', origin);

      return callback(
        new Error(`CORS blocked: ${origin}`)
      );
    },

    credentials: true,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS'
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization'
    ]
  })
);

/* =====================================================
   BODY PARSERS
===================================================== */

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'eventhub-api'
  });
});

/* =====================================================
   API ROUTES
===================================================== */

app.use('/api/auth', authRoutes);

app.use('/api/events', eventRoutes);

app.use('/api/tickets', ticketRoutes);

app.use('/api/users', userRoutes);

app.use('/api/admin', adminRoutes);

app.use('/api/analytics', analyticsRoutes);

app.use('/api/support', supportRoutes);

/* =====================================================
   404 HANDLER
===================================================== */

app.use((req, res) => {
  res.status(404).json({
    message: 'API route not found',
    path: req.originalUrl
  });
});

/* =====================================================
   ERROR HANDLER
===================================================== */

app.use((err, req, res, next) => {
  console.error('Server error:', err);

  res.status(err.status || 500).json({
    message: err.message || 'Server error'
  });
});

/* =====================================================
   START EXPRESS SERVER
===================================================== */

/*
  IMPORTANT:
  Start Express BEFORE connecting to MongoDB.

  Render needs to detect that the application
  is listening on process.env.PORT.
*/

app.listen(port, () => {
  console.log('========================================');
  console.log(`API running on port ${port}`);
  console.log('========================================');
});

/* =====================================================
   MONGODB CONNECTION
===================================================== */

console.log('Connecting to MongoDB...');

mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000
  })
  .then(() => {
    console.log('========================================');
    console.log('MongoDB connected successfully');
    console.log('========================================');
  })
  .catch((err) => {
    console.error('========================================');
    console.error('MongoDB connection failed');
    console.error(err);
    console.error('========================================');
  });