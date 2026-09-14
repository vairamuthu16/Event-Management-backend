import 'dotenv/config';
import express from 'express';
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

const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://event-management-system-vairam.netlify.app'
];

if (process.env.CLIENT_URL) {
  const extraOrigins = process.env.CLIENT_URL
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  extraOrigins.forEach((origin) => {
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


/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.header(
      'Access-Control-Allow-Origin',
      origin
    );

    res.header(
      'Access-Control-Allow-Credentials',
      'true'
    );

    res.header(
      'Access-Control-Allow-Methods',
      'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    );

    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );

    res.header(
      'Access-Control-Max-Age',
      '86400'
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Handle browser preflight
  |--------------------------------------------------------------------------
  */

  if (req.method === 'OPTIONS') {
    console.log(
      'CORS preflight:',
      origin,
      req.originalUrl
    );

    if (
      origin &&
      allowedOrigins.includes(origin)
    ) {
      return res.status(204).end();
    }

    return res.status(403).json({
      message: 'CORS origin not allowed'
    });
  }

  next();
});


/*
|--------------------------------------------------------------------------
| Body parser
|--------------------------------------------------------------------------
*/

app.use(
  express.json({
    limit: '2mb'
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);


/*
|--------------------------------------------------------------------------
| Root
|--------------------------------------------------------------------------
*/

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'EventHub API',
    message: 'Backend is running'
  });
});


/*
|--------------------------------------------------------------------------
| Health
|--------------------------------------------------------------------------
*/

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'eventhub-api'
  });
});


app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'eventhub-api'
  });
});


/*
|--------------------------------------------------------------------------
| API routes
|--------------------------------------------------------------------------
*/

app.use('/api/auth', authRoutes);

app.use('/api/events', eventRoutes);

app.use('/api/tickets', ticketRoutes);

app.use('/api/users', userRoutes);

app.use('/api/admin', adminRoutes);

app.use('/api/analytics', analyticsRoutes);

app.use('/api/support', supportRoutes);


/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  console.log(
    '404:',
    req.method,
    req.originalUrl
  );

  res.status(404).json({
    message: 'API route not found',
    path: req.originalUrl
  });
});


/*
|--------------------------------------------------------------------------
| Error handler
|--------------------------------------------------------------------------
*/

app.use((err, req, res, next) => {
  console.error(
    'Server error:',
    err
  );

  res.status(err.status || 500).json({
    message:
      err.message || 'Server error'
  });
});


/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

async function startServer() {
  try {

    if (!process.env.MONGO_URI) {
      throw new Error(
        'MONGO_URI is missing'
      );
    }

    if (!process.env.JWT_SECRET) {
      throw new Error(
        'JWT_SECRET is missing'
      );
    }

    console.log(
      'Connecting to MongoDB...'
    );

    await mongoose.connect(
      process.env.MONGO_URI
    );

    console.log(
      'MongoDB connected successfully'
    );

    app.listen(
      PORT,
      '0.0.0.0',
      () => {

        console.log(
          `API running on 0.0.0.0:${PORT}`
        );

        console.log(
          `Health: http://0.0.0.0:${PORT}/api/health`
        );

      }
    );

  } catch (error) {

    console.error(
      'MongoDB connection failed:',
      error
    );

    process.exit(1);
  }
}

startServer();