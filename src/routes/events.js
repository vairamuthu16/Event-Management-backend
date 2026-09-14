import express from 'express';
import { Event, Registration } from '../models/index.js';
import { protect, roles } from '../middleware/auth.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const {
    q,
    category,
    location,
    minPrice,
    maxPrice,
    from,
    to,
    status = 'approved'
  } = req.query;

  const filter = {};

  if (status !== 'all') filter.status = status;

  if (q) {
    const safeQuery = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { title: new RegExp(safeQuery, 'i') },
      { description: new RegExp(safeQuery, 'i') },
      { tags: new RegExp(safeQuery, 'i') }
    ];
  }

  if (category) filter.category = category;

  if (location) {
    const safeLocation = String(location).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.location = new RegExp(safeLocation, 'i');
  }

  if (from || to) filter.date = {};
  if (from) filter.date.$gte = new Date(from);
  if (to) filter.date.$lte = new Date(to);

  if (minPrice || maxPrice) {
    filter['ticketTypes.price'] = {};
    if (minPrice) filter['ticketTypes.price'].$gte = Number(minPrice);
    if (maxPrice) filter['ticketTypes.price'].$lte = Number(maxPrice);
  }

  const events = await Event.find(filter)
    .populate('organizer', 'name')
    .sort({ date: 1 });

  res.json(events);
});

router.get('/:id', async (req, res) => {
  const event = await Event.findById(req.params.id)
    .populate('organizer', 'name email');

  if (!event) {
    return res.status(404).json({ message: 'Event not found' });
  }

  res.json(event);
});

router.post(
  '/',
  protect,
  roles('organizer', 'admin'),
  async (req, res) => {
    const event = await Event.create({
      ...req.body,
      organizer: req.user._id,
      status: req.user.role === 'admin' ? 'approved' : 'pending'
    });

    res.status(201).json(event);
  }
);

router.put(
  '/:id',
  protect,
  roles('organizer', 'admin'),
  async (req, res) => {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (
      req.user.role !== 'admin' &&
      String(event.organizer) !== String(req.user._id)
    ) {
      return res.status(403).json({ message: 'Not your event' });
    }

    Object.assign(event, req.body);

    if (req.user.role !== 'admin') {
      event.status = 'pending';
    }

    await event.save();
    res.json(event);
  }
);

router.delete(
  '/:id',
  protect,
  roles('organizer', 'admin'),
  async (req, res) => {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (
      req.user.role !== 'admin' &&
      String(event.organizer) !== String(req.user._id)
    ) {
      return res.status(403).json({ message: 'Not your event' });
    }

    await event.deleteOne();
    res.json({ message: 'Event deleted' });
  }
);

router.get(
  '/:id/attendees.csv',
  protect,
  roles('organizer', 'admin'),
  async (req, res) => {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (
      req.user.role !== 'admin' &&
      String(event.organizer) !== String(req.user._id)
    ) {
      return res.status(403).json({ message: 'Not your event' });
    }

    const rows = await Registration.find({
      event: event._id,
      paymentStatus: 'paid'
    }).populate('user', 'name email');

    const escapeCsv = (value) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;

    const csv = [
      'Name,Email,Quantity,Amount,Status',
      ...rows.map((r) =>
        [
          escapeCsv(r.user?.name || r.attendee?.name || ''),
          escapeCsv(r.user?.email || r.attendee?.email || ''),
          r.quantity,
          r.amount,
          escapeCsv(r.status)
        ].join(',')
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${event._id}-attendees.csv"`
    );
    res.send(csv);
  }
);

router.post(
  '/:id/schedule',
  protect,
  roles('organizer', 'admin'),
  async (req, res) => {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (
      req.user.role !== 'admin' &&
      String(event.organizer) !== String(req.user._id)
    ) {
      return res.status(403).json({ message: 'Not your event' });
    }

    event.sessions = Array.isArray(req.body.sessions)
      ? req.body.sessions
      : [];

    await event.save();
    res.json(event.sessions);
  }
);

export default router;
