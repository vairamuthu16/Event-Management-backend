import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

const router = express.Router();

const tokenFor = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  avatar: user.avatar
});

router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!name || !normalizedEmail || !password) {
    return res.status(400).json({
      message: 'Name, email and password are required'
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      message: 'Password must be at least 6 characters'
    });
  }

  if (await User.findOne({ email: normalizedEmail })) {
    return res.status(409).json({
      message: 'Email already registered'
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Public registration can never create an admin account.
  const safeRole = role === 'organizer' ? 'organizer' : 'attendee';

  const user = await User.create({
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash,
    role: safeRole
  });

  res.status(201).json({
    token: tokenFor(user),
    user: publicUser(user)
  });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();

  const user = await User.findOne({ email });

  if (!user || !(await bcrypt.compare(req.body.password || '', user.passwordHash))) {
    return res.status(401).json({
      message: 'Invalid email or password'
    });
  }

  res.json({
    token: tokenFor(user),
    user: publicUser(user)
  });
});

router.post('/admin-login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();

  const user = await User.findOne({ email });

  if (!user || user.role !== 'admin') {
    return res.status(403).json({
      message: 'Admin account not found or insufficient permissions'
    });
  }

  if (!(await bcrypt.compare(req.body.password || '', user.passwordHash))) {
    return res.status(401).json({
      message: 'Invalid admin email or password'
    });
  }

  res.json({
    token: tokenFor(user),
    user: publicUser(user)
  });
});

export default router;
