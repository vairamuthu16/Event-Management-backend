import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';

import './models/index.js';

import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import ticketRoutes from './routes/tickets.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import analyticsRoutes from './routes/analytics.js';
import supportRoutes from './routes/support.js';

const app = express();

const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://event-management-system-vairam.netlify.app'
];

if (process.env.CLIENT_URL) {
  process.env.CLIENT_URL
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .forEach((origin) => {
      if (!allowedOrigins.includes(origin)) {
        allowedOrigins.push(origin);
      }
    });
}

console.log('========================================');
console.log('Starting EventHub API');
console.log('PORT:', PORT);
console.log('MONGO_URI exists:', Boolean(process.env.MONGO_URI));
console.log('JWT_SECRET exists:', Boolean(process.env.JWT_SECRET));
console.log('CLIENT_URL:', process.env.CLIENT_URL);
console.log('Allowed CORS origins:', allowedOrigins);
console.log('========================================');


/* =========================================================
   CORS
========================================================= */

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without Origin, such as curl/server requests
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log('CORS blocked origin:', origin);

      return callback(new Error(`CORS blocked: ${origin}`));
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


/* =========================================================
   BODY PARSING
========================================================= */

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));


/* =========================================================
   HEALTH CHECKS
========================================================= */

// Simple root route
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'eventhub-api',
    message: 'EventHub backend is running'
  });
});

// Main health route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'eventhub-api'
  });
});

// Additional health route
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'eventhub-api'
  });
});


/* =========================================================
   API ROUTES
========================================================= */

app.use('/api/auth', authRoutes);

app.use('/api/events', eventRoutes);

app.use('/api/tickets', ticketRoutes);

app.use('/api/users', userRoutes);

app.use('/api/admin', adminRoutes);

app.use('/api/analytics', analyticsRoutes);

app.use('/api/support', supportRoutes);


/* =========================================================
   404 HANDLER
========================================================= */

app.use((req, res) => {
  console.log('404:', req.method, req.originalUrl);

  res.status(404).json({
    message: 'API route not found',
    path: req.originalUrl
  });
});


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error('Server error:', err);

  res.status(err.status || 500).json({
    message: err.message || 'Server error'
  });
});


/* =========================================================
   MONGODB + SERVER
========================================================= */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected successfully');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`API running on 0.0.0.0:${PORT}`);
      console.log(`Health: http://0.0.0.0:${PORT}/api/health`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error);
    process.exit(1);
  });