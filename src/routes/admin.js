import express from 'express';
import { Event, User, Registration } from '../models/index.js';
import { protect, roles } from '../middleware/auth.js';

const router = express.Router();

router.use(protect, roles('admin'));

router.get('/overview', async (_, res) => {
  const [users, events, regs, revenue] = await Promise.all([
    User.countDocuments(),
    Event.countDocuments(),
    Registration.countDocuments({ paymentStatus: 'paid' }),
    Registration.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
  ]);

  res.json({
    users,
    events,
    registrations: regs,
    revenue: revenue[0]?.total || 0
  });
});

router.get('/events', async (_, res) => {
  res.json(
    await Event.find()
      .populate('organizer', 'name email')
      .sort({ createdAt: -1 })
  );
});

router.patch('/events/:id/status', async (req, res) => {
  const allowed = ['pending', 'approved', 'rejected', 'draft'];

  if (!allowed.includes(req.body.status)) {
    return res.status(400).json({
      message: 'Invalid event status'
    });
  }

  const event = await Event.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true }
  );

  if (!event) {
    return res.status(404).json({
      message: 'Event not found'
    });
  }

  res.json(event);
});

router.get('/users', async (_, res) => {
  res.json(
    await User.find()
      .select('-passwordHash')
      .sort({ createdAt: -1 })
  );
});

router.get('/transactions', async (_, res) => {
  res.json(
    await Registration.find({ paymentStatus: 'paid' })
      .populate('user', 'name email')
      .populate('event', 'title')
      .sort({ createdAt: -1 })
  );
});

export default router;
