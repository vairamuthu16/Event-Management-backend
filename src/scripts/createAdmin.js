import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';

const run = async () => {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = String(process.env.ADMIN_NAME || 'Administrator').trim();

  if (!email || !password) {
    throw new Error(
      'Set ADMIN_EMAIL and ADMIN_PASSWORD in server/.env before running npm run create-admin'
    );
  }

  if (password.length < 6) {
    throw new Error('ADMIN_PASSWORD must be at least 6 characters');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await User.findOne({ email });

  if (existing) {
    existing.name = name || existing.name;
    existing.passwordHash = passwordHash;
    existing.role = 'admin';
    await existing.save();
    console.log(`Admin account updated: ${email}`);
  } else {
    await User.create({
      name,
      email,
      passwordHash,
      role: 'admin'
    });
    console.log(`Admin account created: ${email}`);
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Admin setup failed:', error.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
