import express from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';

import {
  Event,
  Registration
} from '../models/index.js';

import {
  requireAuth,
  requireRole
} from '../middleware/auth.js';

const router = express.Router();

const razorpay =
  process.env.RAZORPAY_KEY_ID &&
  process.env.RAZORPAY_KEY_SECRET
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      })
    : null;

/*
|--------------------------------------------------------------------------
| Helper functions
|--------------------------------------------------------------------------
*/

function getTicket(event, ticketTypeId) {
  return event.ticketTypes?.id(ticketTypeId);
}

function getAvailableTickets(ticket) {
  if (!ticket) return 0;

  return Math.max(
    0,
    Number(ticket.quantity || 0) -
      Number(ticket.sold || 0)
  );
}

function isEventPast(event) {
  if (!event?.date) return false;

  return new Date(event.date).getTime() < Date.now();
}

/*
|--------------------------------------------------------------------------
| GET /api/tickets/mine
|--------------------------------------------------------------------------
| Get the logged-in user's registrations.
*/

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const registrations =
      await Registration.find({
        user: req.user._id
      })
        .populate(
          'event',
          'title date time location image category organizer ticketTypes sessions status'
        )
        .sort({
          createdAt: -1
        });

    res.json(registrations);
  } catch (error) {
    console.error(
      'Get my tickets error:',
      error
    );

    res.status(500).json({
      message:
        'Failed to load your registrations'
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/tickets/:id
|--------------------------------------------------------------------------
| Get one registration owned by the logged-in user.
*/

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const registration =
      await Registration.findOne({
        _id: req.params.id,
        user: req.user._id
      }).populate(
        'event',
        'title date time location image category organizer ticketTypes sessions status'
      );

    if (!registration) {
      return res.status(404).json({
        message: 'Registration not found'
      });
    }

    res.json(registration);
  } catch (error) {
    console.error(
      'Get ticket error:',
      error
    );

    res.status(500).json({
      message:
        'Failed to load registration'
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/tickets/event/:eventId
|--------------------------------------------------------------------------
| Organizer/admin can view registrations for an event.
|
| IMPORTANT:
| This route must appear BEFORE /:id.
|--------------------------------------------------------------------------
*/

router.get(
  '/event/:eventId',
  requireAuth,
  requireRole('organizer', 'admin'),
  async (req, res) => {
    try {
      const event =
        await Event.findById(
          req.params.eventId
        );

      if (!event) {
        return res.status(404).json({
          message: 'Event not found'
        });
      }

      if (
        req.user.role === 'organizer' &&
        String(event.organizer) !==
          String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only view registrations for your own events'
        });
      }

      const registrations =
        await Registration.find({
          event: event._id
        })
          .populate(
            'user',
            'name email role'
          )
          .populate(
            'event',
            'title date time location'
          )
          .sort({
            createdAt: -1
          });

      res.json(registrations);
    } catch (error) {
      console.error(
        'Get event registrations error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to load event registrations'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| POST /api/tickets/create-order
|--------------------------------------------------------------------------
| Create a ticket registration and Razorpay order.
|--------------------------------------------------------------------------
*/

router.post(
  '/create-order',
  requireAuth,
  async (req, res) => {
    try {
      if (!razorpay) {
        return res.status(500).json({
          message:
            'Razorpay is not configured on the server'
        });
      }

      const {
        eventId,
        ticketTypeId,
        quantity,
        attendee
      } = req.body;

      const numericQuantity =
        Number(quantity);

      if (!eventId) {
        return res.status(400).json({
          message: 'Event is required'
        });
      }

      if (!ticketTypeId) {
        return res.status(400).json({
          message:
            'Ticket type is required'
        });
      }

      if (
        !Number.isInteger(
          numericQuantity
        ) ||
        numericQuantity < 1
      ) {
        return res.status(400).json({
          message:
            'Quantity must be at least 1'
        });
      }

      if (numericQuantity > 10) {
        return res.status(400).json({
          message:
            'You can purchase a maximum of 10 tickets per order'
        });
      }

      const event =
        await Event.findById(eventId);

      if (!event) {
        return res.status(404).json({
          message: 'Event not found'
        });
      }

      if (event.status !== 'approved') {
        return res.status(400).json({
          message:
            'Tickets are available only for approved events'
        });
      }

      if (isEventPast(event)) {
        return res.status(400).json({
          message:
            'This event has already started or ended'
        });
      }

      const ticket =
        getTicket(
          event,
          ticketTypeId
        );

      if (!ticket) {
        return res.status(404).json({
          message:
            'Ticket type not found'
        });
      }

      const available =
        getAvailableTickets(ticket);

      if (available <= 0) {
        return res.status(400).json({
          message:
            'This ticket type is sold out'
        });
      }

      if (
        numericQuantity >
        available
      ) {
        return res.status(400).json({
          message:
            `Only ${available} ticket(s) are available`
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Prevent duplicate active registrations only when appropriate.
      |
      | Multiple purchases are still allowed.
      |--------------------------------------------------------------------------
      */

      const attendeeName =
        String(
          attendee?.name ||
            req.user.name ||
            ''
        ).trim();

      const attendeeEmail =
        String(
          attendee?.email ||
            req.user.email ||
            ''
        )
          .trim()
          .toLowerCase();

      const attendeePhone =
        String(
          attendee?.phone || ''
        ).trim();

      if (!attendeeName) {
        return res.status(400).json({
          message:
            'Attendee name is required'
        });
      }

      if (!attendeeEmail) {
        return res.status(400).json({
          message:
            'Attendee email is required'
        });
      }

      const amount =
        Number(ticket.price || 0) *
        numericQuantity;

      if (amount < 0) {
        return res.status(400).json({
          message:
            'Invalid ticket price'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Create Razorpay order
      |--------------------------------------------------------------------------
      */

      const order =
        await razorpay.orders.create({
          amount: Math.round(
            amount * 100
          ),
          currency: 'INR',
          receipt: `event_${String(
            event._id
          ).slice(-8)}_${Date.now()}`,
          notes: {
            eventId: String(
              event._id
            ),
            ticketTypeId: String(
              ticket._id
            ),
            userId: String(
              req.user._id
            ),
            quantity: String(
              numericQuantity
            )
          }
        });

      /*
      |--------------------------------------------------------------------------
      | Create registration.
      |
      | Tickets are NOT marked sold yet.
      | sold is updated only after successful payment verification.
      |--------------------------------------------------------------------------
      */

      const registration =
        await Registration.create({
          user: req.user._id,
          event: event._id,
          ticketType: ticket._id,
          quantity: numericQuantity,
          amount,
          paymentStatus: 'created',
          razorpayOrderId: order.id,
          status: 'active',
          attendee: {
            name: attendeeName,
            email: attendeeEmail,
            phone: attendeePhone
          }
        });

      res.status(201).json({
        registrationId:
          registration._id,
        keyId:
          process.env.RAZORPAY_KEY_ID,
        order: {
          id: order.id,
          amount: order.amount,
          currency:
            order.currency
        },
        event: {
          id: event._id,
          title: event.title
        },
        ticket: {
          id: ticket._id,
          name: ticket.name,
          price: ticket.price,
          quantity:
            numericQuantity,
          available
        }
      });
    } catch (error) {
      console.error(
        'Create ticket order error:',
        error
      );

      res.status(500).json({
        message:
          error?.error?.description ||
          error?.message ||
          'Failed to create ticket order'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| POST /api/tickets/verify
|--------------------------------------------------------------------------
| Verify Razorpay payment signature.
|--------------------------------------------------------------------------
*/

router.post(
  '/verify',
  requireAuth,
  async (req, res) => {
    try {
      const {
        registrationId,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      } = req.body;

      if (
        !registrationId ||
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !razorpay_signature
      ) {
        return res.status(400).json({
          message:
            'Payment verification details are incomplete'
        });
      }

      const registration =
        await Registration.findOne({
          _id: registrationId,
          user: req.user._id
        });

      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Already verified
      |--------------------------------------------------------------------------
      */

      if (
        registration.paymentStatus ===
          'paid' &&
        registration.razorpayPaymentId
      ) {
        return res.json({
          message:
            'Payment has already been verified',
          registration
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Check order ID.
      |--------------------------------------------------------------------------
      */

      if (
        registration.razorpayOrderId !==
        razorpay_order_id
      ) {
        return res.status(400).json({
          message:
            'Payment order does not match registration'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Verify Razorpay HMAC signature.
      |--------------------------------------------------------------------------
      */

      const body =
        `${razorpay_order_id}|${razorpay_payment_id}`;

      const expectedSignature =
        crypto
          .createHmac(
            'sha256',
            process.env.RAZORPAY_KEY_SECRET
          )
          .update(body)
          .digest('hex');

      if (
        expectedSignature !==
        razorpay_signature
      ) {
        registration.paymentStatus =
          'failed';

        await registration.save();

        return res.status(400).json({
          message:
            'Invalid payment signature'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Reload event after payment.
      |
      | We check inventory again because another
      | customer may have purchased tickets while
      | the Razorpay checkout was open.
      |--------------------------------------------------------------------------
      */

      const event =
        await Event.findById(
          registration.event
        );

      if (!event) {
        registration.paymentStatus =
          'failed';

        await registration.save();

        return res.status(404).json({
          message:
            'Event no longer exists'
        });
      }

      const ticket =
        getTicket(
          event,
          registration.ticketType
        );

      if (!ticket) {
        registration.paymentStatus =
          'failed';

        await registration.save();

        return res.status(400).json({
          message:
            'Ticket type no longer exists'
        });
      }

      const available =
        getAvailableTickets(ticket);

      if (
        registration.quantity >
        available
      ) {
        registration.paymentStatus =
          'failed';

        await registration.save();

        return res.status(409).json({
          message:
            'Sorry, there are not enough tickets remaining for this ticket type'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Mark payment as paid.
      |--------------------------------------------------------------------------
      */

      registration.paymentStatus =
        'paid';

      registration.razorpayPaymentId =
        razorpay_payment_id;

      registration.status =
        'active';

      await registration.save();

      /*
      |--------------------------------------------------------------------------
      | Increase sold count.
      |--------------------------------------------------------------------------
      */

      ticket.sold =
        Number(ticket.sold || 0) +
        Number(
          registration.quantity || 0
        );

      await event.save();

      const updatedRegistration =
        await Registration.findById(
          registration._id
        ).populate(
          'event',
          'title date time location image category'
        );

      res.json({
        message:
          'Payment verified and registration confirmed',
        registration:
          updatedRegistration
      });
    } catch (error) {
      console.error(
        'Verify payment error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to verify payment'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| PATCH /api/tickets/:id/cancel
|--------------------------------------------------------------------------
| Cancel an active paid registration.
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/cancel',
  requireAuth,
  async (req, res) => {
    try {
      const registration =
        await Registration.findOne({
          _id: req.params.id,
          user: req.user._id
        });

      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found'
        });
      }

      if (
        registration.status !==
        'active'
      ) {
        return res.status(400).json({
          message:
            'This registration is already cancelled or transferred'
        });
      }

      if (
        registration.paymentStatus !==
        'paid'
      ) {
        registration.status =
          'cancelled';

        await registration.save();

        return res.json({
          message:
            'Registration cancelled',
          registration
        });
      }

      const event =
        await Event.findById(
          registration.event
        );

      /*
      |--------------------------------------------------------------------------
      | Reduce sold count when cancelling a paid ticket.
      |--------------------------------------------------------------------------
      */

      if (event) {
        const ticket =
          getTicket(
            event,
            registration.ticketType
          );

        if (ticket) {
          ticket.sold =
            Math.max(
              0,
              Number(
                ticket.sold || 0
              ) -
                Number(
                  registration.quantity ||
                    0
                )
            );

          await event.save();
        }
      }

      registration.status =
        'cancelled';

      registration.paymentStatus =
        'refunded';

      await registration.save();

      const updatedRegistration =
        await Registration.findById(
          registration._id
        ).populate(
          'event',
          'title date time location image category'
        );

      res.json({
        message:
          'Registration cancelled successfully',
        registration:
          updatedRegistration
      });
    } catch (error) {
      console.error(
        'Cancel registration error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to cancel registration'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| PATCH /api/tickets/:id/transfer
|--------------------------------------------------------------------------
| Transfer an active ticket to another attendee.
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/transfer',
  requireAuth,
  async (req, res) => {
    try {
      const {
        name,
        email,
        phone
      } = req.body;

      const registration =
        await Registration.findOne({
          _id: req.params.id,
          user: req.user._id
        }).populate(
          'event',
          'title date status'
        );

      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found'
        });
      }

      if (
        registration.status !==
        'active'
      ) {
        return res.status(400).json({
          message:
            'Only active registrations can be transferred'
        });
      }

      if (
        registration.paymentStatus !==
        'paid'
      ) {
        return res.status(400).json({
          message:
            'Only paid registrations can be transferred'
        });
      }

      if (
        registration.event?.status !==
        'approved'
      ) {
        return res.status(400).json({
          message:
            'This event is not available for transfer'
        });
      }

      if (
        isEventPast(
          registration.event
        )
      ) {
        return res.status(400).json({
          message:
            'Tickets cannot be transferred after the event has started'
        });
      }

      const newName =
        String(name || '').trim();

      const newEmail =
        String(email || '')
          .trim()
          .toLowerCase();

      const newPhone =
        String(phone || '').trim();

      if (!newName) {
        return res.status(400).json({
          message:
            'New attendee name is required'
        });
      }

      if (!newEmail) {
        return res.status(400).json({
          message:
            'New attendee email is required'
        });
      }

      registration.attendee = {
        name: newName,
        email: newEmail,
        phone: newPhone
      };

      registration.status =
        'transferred';

      await registration.save();

      const updatedRegistration =
        await Registration.findById(
          registration._id
        ).populate(
          'event',
          'title date time location image category'
        );

      res.json({
        message:
          'Ticket transferred successfully',
        registration:
          updatedRegistration
      });
    } catch (error) {
      console.error(
        'Transfer ticket error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to transfer ticket'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| PATCH /api/tickets/:id/feedback
|--------------------------------------------------------------------------
| Attendee feedback after attending an event.
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/feedback',
  requireAuth,
  async (req, res) => {
    try {
      const {
        rating,
        comment
      } = req.body;

      const numericRating =
        Number(rating);

      if (
        !Number.isFinite(
          numericRating
        ) ||
        numericRating < 1 ||
        numericRating > 5
      ) {
        return res.status(400).json({
          message:
            'Rating must be between 1 and 5'
        });
      }

      const registration =
        await Registration.findOne({
          _id: req.params.id,
          user: req.user._id
        }).populate(
          'event',
          'title date'
        );

      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found'
        });
      }

      if (
        registration.paymentStatus !==
        'paid'
      ) {
        return res.status(400).json({
          message:
            'Only paid registrations can receive feedback'
        });
      }

      if (!registration.attended) {
        return res.status(400).json({
          message:
            'Feedback can be submitted after attendance is recorded'
        });
      }

      registration.feedback = {
        rating: numericRating,
        comment: String(
          comment || ''
        ).trim()
      };

      await registration.save();

      const updatedRegistration =
        await Registration.findById(
          registration._id
        ).populate(
          'event',
          'title date time location image category'
        );

      res.json(
        updatedRegistration
      );
    } catch (error) {
      console.error(
        'Ticket feedback error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to save feedback'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| PATCH /api/tickets/:id/attendance
|--------------------------------------------------------------------------
| Organizer/admin records attendance.
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/attendance',
  requireAuth,
  requireRole('organizer', 'admin'),
  async (req, res) => {
    try {
      const {
        attended
      } = req.body;

      const registration =
        await Registration.findById(
          req.params.id
        ).populate(
          'event',
          'title organizer date'
        );

      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found'
        });
      }

      if (
        req.user.role ===
          'organizer' &&
        String(
          registration.event?.organizer
        ) !== String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only update attendance for your own events'
        });
      }

      if (
        registration.paymentStatus !==
        'paid'
      ) {
        return res.status(400).json({
          message:
            'Only paid registrations can be marked as attended'
        });
      }

      registration.attended =
        Boolean(attended);

      await registration.save();

      const updatedRegistration =
        await Registration.findById(
          registration._id
        )
          .populate(
            'user',
            'name email role'
          )
          .populate(
            'event',
            'title date time location'
          );

      res.json({
        message:
          registration.attended
            ? 'Attendance recorded'
            : 'Attendance removed',
        registration:
          updatedRegistration
      });
    } catch (error) {
      console.error(
        'Attendance update error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to update attendance'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| GET /api/tickets/event/:eventId/export
|--------------------------------------------------------------------------
| Organizer/admin attendee export.
|
| Returns CSV so the organizer can download/export
| the attendee list.
|--------------------------------------------------------------------------
*/

router.get(
  '/event/:eventId/export',
  requireAuth,
  requireRole('organizer', 'admin'),
  async (req, res) => {
    try {
      const event =
        await Event.findById(
          req.params.eventId
        );

      if (!event) {
        return res.status(404).json({
          message: 'Event not found'
        });
      }

      if (
        req.user.role === 'organizer' &&
        String(event.organizer) !==
          String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only export attendees for your own events'
        });
      }

      const registrations =
        await Registration.find({
          event: event._id
        })
          .populate(
            'user',
            'name email'
          )
          .sort({
            createdAt: 1
          });

      const escapeCsv = (value) => {
        const text =
          String(value ?? '');

        return `"${text.replace(
          /"/g,
          '""'
        )}"`;
      };

      const rows = [
        [
          'Registration ID',
          'Attendee Name',
          'Attendee Email',
          'Phone',
          'Ticket Type',
          'Quantity',
          'Amount',
          'Payment Status',
          'Registration Status',
          'Attendance',
          'Created At'
        ]
      ];

      for (const registration of registrations) {
        const ticket =
          event.ticketTypes?.id(
            registration.ticketType
          );

        rows.push([
          registration._id,
          registration.attendee
            ?.name ||
            registration.user
              ?.name ||
            '',
          registration.attendee
            ?.email ||
            registration.user
              ?.email ||
            '',
          registration.attendee
            ?.phone ||
            '',
          ticket?.name ||
            'Ticket',
          registration.quantity ||
            0,
          registration.amount ||
            0,
          registration.paymentStatus ||
            '',
          registration.status ||
            '',
          registration.attended
            ? 'Yes'
            : 'No',
          registration.createdAt
            ? new Date(
                registration.createdAt
              ).toISOString()
            : ''
        ]);
      }

      const csv =
        rows
          .map((row) =>
            row
              .map(escapeCsv)
              .join(',')
          )
          .join('\n');

      const filename =
        `${event.title
          .replace(
            /[^a-z0-9]+/gi,
            '-'
          )
          .replace(
            /^-+|-+$/g,
            ''
          )
          .toLowerCase() || 'event'}-attendees.csv`;

      res.setHeader(
        'Content-Type',
        'text/csv; charset=utf-8'
      );

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );

      res.send(csv);
    } catch (error) {
      console.error(
        'Export attendees error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to export attendees'
      });
    }
  }
);

export default router;