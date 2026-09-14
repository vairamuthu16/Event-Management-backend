import express from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { Event, Registration } from '../models/index.js';
import { protect, roles } from '../middleware/auth.js';
import { sendEmail } from '../utils/email.js';

const router = express.Router();

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    const error = new Error(
      'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server/.env.'
    );
    error.status = 503;
    throw error;
  }

  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
};

router.post('/create-order', protect, async (req, res) => {
  const { eventId, ticketTypeId, attendee } = req.body;
  const quantity = Number(req.body.quantity ?? 1);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return res.status(400).json({
      message: 'Quantity must be an integer between 1 and 10'
    });
  }

  const event = await Event.findById(eventId);

  if (!event || event.status !== 'approved') {
    return res.status(404).json({ message: 'Event unavailable' });
  }

  const type = event.ticketTypes.id(ticketTypeId);

  if (!type) {
    return res.status(404).json({ message: 'Ticket type not found' });
  }

  if (type.sold + quantity > type.quantity) {
    return res.status(400).json({
      message: 'Not enough tickets available'
    });
  }

  const amount = Number(type.price) * quantity;

  const order = await getRazorpay().orders.create({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt: `evt_${event._id}_${Date.now()}`
  });

  const reg = await Registration.create({
    user: req.user._id,
    event: event._id,
    ticketType: type._id,
    quantity,
    amount,
    razorpayOrderId: order.id,
    attendee: attendee || {
      name: req.user.name,
      email: req.user.email
    }
  });

  res.json({
    order,
    registrationId: reg._id,
    keyId: process.env.RAZORPAY_KEY_ID
  });
});

router.post('/verify', protect, async (req, res) => {
  const {
    registrationId,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  } = req.body;

  const reg = await Registration.findOne({
    _id: registrationId,
    user: req.user._id
  }).populate('event');

  if (!reg) {
    return res.status(404).json({ message: 'Registration not found' });
  }

  if (reg.paymentStatus === 'paid') {
    return res.json({
      message: 'Payment already verified',
      registration: reg
    });
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      message: 'Incomplete Razorpay payment response'
    });
  }

  if (reg.razorpayOrderId !== razorpay_order_id) {
    return res.status(400).json({
      message: 'Order ID does not match'
    });
  }

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const validSignature =
    expected.length === razorpay_signature.length &&
    crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(razorpay_signature)
    );

  if (!validSignature) {
    return res.status(400).json({
      message: 'Payment verification failed'
    });
  }

  const event = await Event.findById(reg.event._id);

  if (!event) {
    return res.status(404).json({
      message: 'Event no longer exists'
    });
  }

  const type = event.ticketTypes.id(reg.ticketType);

  if (!type || type.sold + reg.quantity > type.quantity) {
    return res.status(400).json({
      message: 'Tickets are no longer available'
    });
  }

  reg.paymentStatus = 'paid';
  reg.razorpayPaymentId = razorpay_payment_id;
  await reg.save();

  type.sold += reg.quantity;
  await event.save();

  await sendEmail({
    to: req.user.email,
    subject: `Registration confirmed: ${event.title}`,
    html: `
      <h2>Registration confirmed</h2>
      <p>You are registered for <b>${event.title}</b>.</p>
      <p>Tickets: ${reg.quantity}</p>
      <p>Amount: ₹${reg.amount}</p>
    `
  });

  res.json({
    message: 'Payment verified',
    registration: reg
  });
});

router.get('/mine', protect, async (req, res) => {
  const regs = await Registration.find({
    user: req.user._id
  })
    .populate('event')
    .sort({ createdAt: -1 });

  res.json(regs);
});

router.patch('/:id/cancel', protect, async (req, res) => {
  const reg = await Registration.findOne({
    _id: req.params.id,
    user: req.user._id
  }).populate('event');

  if (!reg) {
    return res.status(404).json({
      message: 'Registration not found'
    });
  }

  if (reg.status !== 'active') {
    return res.status(400).json({
      message: 'Registration already inactive'
    });
  }

  reg.status = 'cancelled';
  await reg.save();

  if (reg.paymentStatus === 'paid') {
    const event = await Event.findById(reg.event._id);
    const type = event?.ticketTypes.id(reg.ticketType);

    if (type) {
      type.sold = Math.max(0, type.sold - reg.quantity);
      await event.save();
    }
  }

  res.json(reg);
});

router.get(
  '/event/:eventId',
  protect,
  roles('organizer', 'admin'),
  async (req, res) => {
    const regs = await Registration.find({
      event: req.params.eventId
    })
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    res.json(regs);
  }
);

export default router;
