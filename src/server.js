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

/* =========================================
   BASIC CONFIG
========================================= */

const PORT = Number(process.env.PORT) || 10000;

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

console.log('========================================');
console.log('Starting EventHub API');
console.log('PORT:', PORT);
console.log('MONGO_URI exists:', Boolean(process.env.MONGO_URI));
console.log('JWT_SECRET exists:', Boolean(process.env.JWT_SECRET));
console.log('CLIENT_URL:', process.env.CLIENT_URL);
console.log('Allowed origins:', allowedOrigins);
console.log('========================================');

/* =========================================
   CORS
========================================= */

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log('CORS blocked origin:', origin);

      return callback(null, false);
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

/* =========================================
   BODY PARSERS
========================================= */

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

/* =========================================
   ROOT TEST
========================================= */

app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'eventhub-api',
    message: 'EventHub backend is running'
  });
});

/* =========================================
   HEALTH CHECK
========================================= */

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'eventhub-api'
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'eventhub-api'
  });
});

/* =========================================
   API ROUTES
========================================= */

app.use('/api/auth', authRoutes);

app.use('/api/events', eventRoutes);

app.use('/api/tickets', ticketRoutes);

app.use('/api/users', userRoutes);

app.use('/api/admin', adminRoutes);

app.use('/api/analytics', analyticsRoutes);

app.use('/api/support', supportRoutes);

/* =========================================
   404 HANDLER
========================================= */

app.use((req, res) => {
  console.log('404:', req.method, req.originalUrl);

  res.status(404).json({
    message: 'API route not found',
    path: req.originalUrl
  });
});

/* =========================================
   ERROR HANDLER
========================================= */

app.use((err, req, res, next) => {
  console.error('Server error:', err);

  res.status(err.status || 500).json({
    message: err.message || 'Server error'
  });
});

/* =========================================
   START SERVER
========================================= */

async function startServer() {
  try {
    console.log('Connecting to MongoDB...');

    await mongoose.connect(process.env.MONGO_URI);

    console.log('MongoDB connected successfully');

    // IMPORTANT:
    // Only ONE app.listen() in the entire file.
    // Render requires 0.0.0.0:$PORT.

    app.listen(PORT, '0.0.0.0', () => {
      console.log('========================================');
      console.log(`API running on 0.0.0.0:${PORT}`);
      console.log(`Health: http://0.0.0.0:${PORT}/health`);
      console.log('========================================');
    });

  } catch (error) {
    console.error('MongoDB connection failed:', error);
    process.exit(1);
  }
}

startServer();