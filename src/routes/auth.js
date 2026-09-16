import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { User } from '../models/index.js';

const router = express.Router();

const tokenFor = (user) =>
  jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  avatar: user.avatar
});


/*
|--------------------------------------------------------------------------
| Register
|--------------------------------------------------------------------------
*/

router.post('/register', async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role
    } = req.body;

    const normalizedEmail =
      String(email || '')
        .trim()
        .toLowerCase();

    if (!name || !normalizedEmail || !password) {
      return res.status(400).json({
        message:
          'Name, email and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message:
          'Password must be at least 6 characters'
      });
    }

    const existingUser =
      await User.findOne({
        email: normalizedEmail
      });

    if (existingUser) {
      return res.status(409).json({
        message:
          'Email already registered'
      });
    }

    const passwordHash =
      await bcrypt.hash(password, 12);

    // Demo registration can create
    // attendee, organizer, or admin accounts.
    const allowedRoles = [
      'attendee',
      'organizer',
      'admin'
    ];

const safeRole = allowedRoles.includes(role)
  ? role
  : 'attendee';

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

  } catch (error) {
    console.error(
      'Registration error:',
      error
    );

    res.status(500).json({
      message:
        'Registration failed'
    });
  }
});


/*
|--------------------------------------------------------------------------
| Normal Login
|--------------------------------------------------------------------------
*/

router.post('/login', async (req, res) => {
  try {
    const email =
      String(req.body.email || '')
        .trim()
        .toLowerCase();

    const password =
      req.body.password || '';

    const user =
      await User.findOne({ email });

    if (
      !user ||
      !(await bcrypt.compare(
        password,
        user.passwordHash
      ))
    ) {
      return res.status(401).json({
        message:
          'Invalid email or password'
      });
    }

    res.json({
      token: tokenFor(user),
      user: publicUser(user)
    });

  } catch (error) {
    console.error(
      'Login error:',
      error
    );

    res.status(500).json({
      message:
        'Login failed'
    });
  }
});


/*
|--------------------------------------------------------------------------
| Organizer Login
|--------------------------------------------------------------------------
*/

router.post(
  '/organizer-login',
  async (req, res) => {
    try {
      const email =
        String(req.body.email || '')
          .trim()
          .toLowerCase();

      const password =
        req.body.password || '';

      const user =
        await User.findOne({ email });

      /*
       * Make sure this endpoint can only
       * authenticate organizer accounts.
       */
      if (
        !user ||
        user.role !== 'organizer'
      ) {
        return res.status(403).json({
          message:
            'Organizer account not found or insufficient permissions'
        });
      }

      if (
        !(await bcrypt.compare(
          password,
          user.passwordHash
        ))
      ) {
        return res.status(401).json({
          message:
            'Invalid organizer email or password'
        });
      }

      res.json({
        token: tokenFor(user),
        user: publicUser(user)
      });

    } catch (error) {
      console.error(
        'Organizer login error:',
        error
      );

      res.status(500).json({
        message:
          'Organizer login failed'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| Admin Login
|--------------------------------------------------------------------------
*/

router.post(
  '/admin-login',
  async (req, res) => {
    try {
      const email =
        String(req.body.email || '')
          .trim()
          .toLowerCase();

      const password =
        req.body.password || '';

      const user =
        await User.findOne({ email });

      if (
        !user ||
        user.role !== 'admin'
      ) {
        return res.status(403).json({
          message:
            'Admin account not found or insufficient permissions'
        });
      }

      if (
        !(await bcrypt.compare(
          password,
          user.passwordHash
        ))
      ) {
        return res.status(401).json({
          message:
            'Invalid admin email or password'
        });
      }

      res.json({
        token: tokenFor(user),
        user: publicUser(user)
      });

    } catch (error) {
      console.error(
        'Admin login error:',
        error
      );

      res.status(500).json({
        message:
          'Admin login failed'
      });
    }
  }
);


export default router;