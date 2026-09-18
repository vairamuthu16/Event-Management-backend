import express from 'express';
import bcrypt from 'bcryptjs';

import { protect } from '../middleware/auth.js';
import { User } from '../models/index.js';

const router = express.Router();

/*
|--------------------------------------------------------------------------
| GET CURRENT USER
|--------------------------------------------------------------------------
| GET /api/users/me
*/

router.get(
  '/me',
  protect,
  async (req, res) => {
    try {
      const user = await User.findById(
        req.user._id
      ).select('-passwordHash');

      if (!user) {
        return res.status(404).json({
          message: 'User not found.'
        });
      }

      return res.json(user);
    } catch (error) {
      console.error(
        'Get profile error:',
        error
      );

      return res.status(500).json({
        message: 'Failed to load profile.'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| UPDATE CURRENT USER PROFILE
|--------------------------------------------------------------------------
| PUT /api/users/me
|
| Editable:
|   - name
|   - avatar
|   - password
|
| Not editable:
|   - email
|   - role
*/

router.put(
  '/me',
  protect,
  async (req, res) => {
    try {
      const {
        name,
        avatar,
        password
      } = req.body;

      const user = await User.findById(
        req.user._id
      );

      if (!user) {
        return res.status(404).json({
          message: 'User not found.'
        });
      }

      // --------------------------------------------------------
      // NAME VALIDATION
      // --------------------------------------------------------

      if (name !== undefined) {
        const cleanName =
          String(name).trim();

        if (!cleanName) {
          return res.status(400).json({
            message: 'Full name is required.'
          });
        }

        if (cleanName.length < 2) {
          return res.status(400).json({
            message:
              'Name must contain at least 2 characters.'
          });
        }

        if (cleanName.length > 100) {
          return res.status(400).json({
            message:
              'Name cannot exceed 100 characters.'
          });
        }

        user.name = cleanName;
      }

      // --------------------------------------------------------
      // AVATAR
      // --------------------------------------------------------

      if (avatar !== undefined) {
        const cleanAvatar =
          String(avatar).trim();

        if (
          cleanAvatar &&
          cleanAvatar.length > 1000
        ) {
          return res.status(400).json({
            message:
              'Profile image URL is too long.'
          });
        }

        user.avatar =
          cleanAvatar || undefined;
      }

      // --------------------------------------------------------
      // PASSWORD
      // --------------------------------------------------------

      if (
        password !== undefined &&
        String(password).length > 0
      ) {
        const cleanPassword =
          String(password);

        if (cleanPassword.length < 6) {
          return res.status(400).json({
            message:
              'Password must be at least 6 characters.'
          });
        }

        if (cleanPassword.length > 128) {
          return res.status(400).json({
            message:
              'Password cannot exceed 128 characters.'
          });
        }

        user.passwordHash =
          await bcrypt.hash(
            cleanPassword,
            12
          );
      }

      await user.save();

      // --------------------------------------------------------
      // RETURN SAFE USER OBJECT
      // --------------------------------------------------------

      return res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      });
    } catch (error) {
      console.error(
        'Update profile error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to update profile.'
      });
    }
  }
);

export default router;
