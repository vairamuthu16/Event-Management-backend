import express from 'express';
import bcrypt from 'bcryptjs';
import { protect } from '../middleware/auth.js';
import { User } from '../models/index.js';

const router = express.Router();
router.get('/me', protect, async (req,res) => res.json(req.user));
router.put('/me', protect, async (req,res) => {
  const {name, avatar, password} = req.body;
  const user = await User.findById(req.user._id);
  if (name) user.name=name;
  if (avatar !== undefined) user.avatar=avatar;
  if (password) user.passwordHash=await bcrypt.hash(password,12);
  await user.save();
  res.json({name:user.name,email:user.email,role:user.role,avatar:user.avatar});
});
export default router;
