import express from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';

import {
  Event,
  Registration
} from '../models/index.js';

import {
  protect,
  roles
} from '../middleware/auth.js';

import {
  sendEmail
} from '../utils/email.js';

const router = express.Router();

/*
|--------------------------------------------------------------------------
| RAZORPAY
|--------------------------------------------------------------------------
*/

const getRazorpay = () => {
  if (
    !process.env.RAZORPAY_KEY_ID ||
    !process.env.RAZORPAY_KEY_SECRET
  ) {
    const error = new Error(
      'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server environment variables.'
    );

    error.status = 503;
    throw error;
  }

  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
};


/*
|--------------------------------------------------------------------------
| CREATE RAZORPAY ORDER
| POST /api/tickets/create-order
|--------------------------------------------------------------------------
*/

router.post(
  '/create-order',
  protect,
  async (req, res) => {
    try {
      const {
        eventId,
        ticketTypeId,
        attendee
      } = req.body;

      const quantity = Number(
        req.body.quantity ?? 1
      );

      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 10
      ) {
        return res.status(400).json({
          message:
            'Quantity must be an integer between 1 and 10'
        });
      }

      const event = await Event.findById(eventId);

      if (
        !event ||
        event.status !== 'approved'
      ) {
        return res.status(404).json({
          message: 'Event unavailable'
        });
      }

      const type =
        event.ticketTypes.id(ticketTypeId);

      if (!type) {
        return res.status(404).json({
          message: 'Ticket type not found'
        });
      }

      if (
        type.sold + quantity >
        type.quantity
      ) {
        return res.status(400).json({
          message:
            'Not enough tickets available'
        });
      }

      const amount =
        Number(type.price) * quantity;

      const razorpay =
        getRazorpay();

      const order =
        await razorpay.orders.create({
          amount: Math.round(
            amount * 100
          ),
          currency: 'INR',
          receipt:
            `evt_${event._id}_${Date.now()}`
        });

      const registration =
        await Registration.create({
          user: req.user._id,
          event: event._id,
          ticketType: type._id,
          quantity,
          amount,
          paymentStatus: 'created',
          razorpayOrderId: order.id,
          attendee:
            attendee || {
              name: req.user.name,
              email: req.user.email
            }
        });

      res.json({
        order,
        registrationId:
          registration._id,
        keyId:
          process.env.RAZORPAY_KEY_ID
      });

    } catch (error) {
      console.error(
        'Create Razorpay order error:',
        error
      );

      res.status(
        error.status || 500
      ).json({
        message:
          error.message ||
          'Failed to create payment order'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| VERIFY RAZORPAY PAYMENT
| POST /api/tickets/verify
|--------------------------------------------------------------------------
*/

router.post(
  '/verify',
  protect,
  async (req, res) => {
    try {
      const {
        registrationId,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      } = req.body;

      const registration =
        await Registration.findOne({
          _id: registrationId,
          user: req.user._id
        }).populate('event');

      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found'
        });
      }

      if (
        registration.paymentStatus ===
        'paid'
      ) {
        return res.json({
          message:
            'Payment already verified',
          registration
        });
      }

      if (
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !razorpay_signature
      ) {
        return res.status(400).json({
          message:
            'Incomplete Razorpay payment response'
        });
      }

      if (
        registration.razorpayOrderId !==
        razorpay_order_id
      ) {
        return res.status(400).json({
          message:
            'Order ID does not match'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | VERIFY RAZORPAY SIGNATURE
      |--------------------------------------------------------------------------
      */

      const expected =
        crypto
          .createHmac(
            'sha256',
            process.env.RAZORPAY_KEY_SECRET
          )
          .update(
            `${razorpay_order_id}|${razorpay_payment_id}`
          )
          .digest('hex');

      const validSignature =
        expected.length ===
          razorpay_signature.length &&
        crypto.timingSafeEqual(
          Buffer.from(expected),
          Buffer.from(
            razorpay_signature
          )
        );

      if (!validSignature) {
        return res.status(400).json({
          message:
            'Payment verification failed'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CHECK EVENT
      |--------------------------------------------------------------------------
      */

      const event =
        await Event.findById(
          registration.event._id
        );

      if (!event) {
        return res.status(404).json({
          message:
            'Event no longer exists'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CHECK TICKET AVAILABILITY
      |--------------------------------------------------------------------------
      */

      const type =
        event.ticketTypes.id(
          registration.ticketType
        );

      if (
        !type ||
        type.sold +
          registration.quantity >
          type.quantity
      ) {
        return res.status(400).json({
          message:
            'Tickets are no longer available'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | MARK PAYMENT AS PAID
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
      | UPDATE SOLD TICKETS
      |--------------------------------------------------------------------------
      */

      type.sold +=
        registration.quantity;

      await event.save();

      /*
      |--------------------------------------------------------------------------
      | SEND CONFIRMATION EMAIL
      |--------------------------------------------------------------------------
      */

      try {
        await sendEmail({
          to: req.user.email,
          subject:
            `Registration confirmed: ${event.title}`,
          html: `
            <h2>Registration confirmed</h2>

            <p>
              You are registered for
              <b>${event.title}</b>.
            </p>

            <p>
              Tickets:
              ${registration.quantity}
            </p>

            <p>
              Amount:
              ₹${registration.amount}
            </p>
          `
        });
      } catch (emailError) {
        /*
        Email failure should not make
        a successful Razorpay payment fail.
        */
        console.error(
          'Confirmation email error:',
          emailError
        );
      }

      res.json({
        message:
          'Payment verified',
        registration
      });

    } catch (error) {
      console.error(
        'Payment verification error:',
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
| GET MY TICKETS
| GET /api/tickets/mine
|--------------------------------------------------------------------------
*/

router.get(
  '/mine',
  protect,
  async (req, res) => {
    try {
      const registrations =
        await Registration.find({
          user: req.user._id
        })
          .populate('event')
          .populate(
            'user',
            'name email'
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
          'Failed to load tickets'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET SINGLE TICKET
| GET /api/tickets/:id
|--------------------------------------------------------------------------
|
| IMPORTANT:
| This route appears AFTER /mine.
| Otherwise "mine" could be treated as an ID.
|--------------------------------------------------------------------------
*/

router.get(
  '/:id',
  protect,
  async (req, res) => {
    try {
      const registration =
        await Registration.findById(
          req.params.id
        )
          .populate('event')
          .populate(
            'user',
            'name email'
          );

      if (!registration) {
        return res.status(404).json({
          message:
            'Ticket not found'
        });
      }

      const ticketUserId =
        registration.user?._id?.toString() ||
        registration.user?.toString();

      if (
        ticketUserId !==
        req.user._id.toString()
      ) {
        return res.status(403).json({
          message:
            'Access denied'
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
          'Failed to load ticket'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| LEGACY CREATE TICKET
| POST /api/tickets
|--------------------------------------------------------------------------
|
| Kept for compatibility with existing frontend code.
|
| NOTE:
| Razorpay purchases should use /create-order
| followed by /verify.
|--------------------------------------------------------------------------
*/

router.post(
  '/',
  protect,
  async (req, res) => {
    try {
      const {
        eventId,
        ticketType,
        quantity = 1
      } = req.body;

      if (!eventId) {
        return res.status(400).json({
          message:
            'Event ID is required'
        });
      }

      const event =
        await Event.findById(
          eventId
        );

      if (!event) {
        return res.status(404).json({
          message:
            'Event not found'
        });
      }

      if (
        event.status !==
        'approved'
      ) {
        return res.status(400).json({
          message:
            'This event is not available for registration'
        });
      }

      /*
      Find a real ticket type if an
      ObjectId was supplied.
      */
      let selectedTicketType = null;

      if (ticketType) {
        selectedTicketType =
          event.ticketTypes.id(
            ticketType
          );
      }

      /*
      Fall back to the first ticket type
      if one exists.
      */
      if (
        !selectedTicketType &&
        event.ticketTypes.length
      ) {
        selectedTicketType =
          event.ticketTypes[0];
      }

      if (!selectedTicketType) {
        return res.status(400).json({
          message:
            'No ticket type available'
        });
      }

      const ticketQuantity =
        Number(quantity) || 1;

      if (
        ticketQuantity < 1 ||
        ticketQuantity > 10
      ) {
        return res.status(400).json({
          message:
            'Quantity must be between 1 and 10'
        });
      }

      if (
        selectedTicketType.sold +
          ticketQuantity >
        selectedTicketType.quantity
      ) {
        return res.status(400).json({
          message:
            'Not enough tickets available'
        });
      }

      const registration =
        await Registration.create({
          user: req.user._id,
          event: event._id,
          ticketType:
            selectedTicketType._id,
          quantity:
            ticketQuantity,
          amount:
            Number(
              selectedTicketType.price
            ) *
            ticketQuantity,
          paymentStatus:
            'paid',
          status:
            'active'
        });

      selectedTicketType.sold +=
        ticketQuantity;

      await event.save();

      const populatedRegistration =
        await Registration.findById(
          registration._id
        )
          .populate('event')
          .populate(
            'user',
            'name email'
          );

      res.status(201).json(
        populatedRegistration
      );

    } catch (error) {
      console.error(
        'Create ticket error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to create ticket'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| CANCEL TICKET
| PATCH /api/tickets/:id/cancel
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/cancel',
  protect,
  async (req, res) => {
    try {
      const registration =
        await Registration.findOne({
          _id: req.params.id,
          user: req.user._id
        }).populate('event');

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
            'Registration already inactive'
        });
      }

      registration.status =
        'cancelled';

      await registration.save();

      /*
      Return sold tickets only when
      payment was actually completed.
      */
      if (
        registration.paymentStatus ===
        'paid'
      ) {
        const event =
          await Event.findById(
            registration.event._id
          );

        const type =
          event?.ticketTypes.id(
            registration.ticketType
          );

        if (type) {
          type.sold =
            Math.max(
              0,
              type.sold -
                registration.quantity
            );

          await event.save();
        }
      }

      res.json(registration);

    } catch (error) {
      console.error(
        'Cancel ticket error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to cancel ticket'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| SUBMIT TICKET FEEDBACK
| PATCH /api/tickets/:id/feedback
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/feedback',
  protect,
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
        await Registration.findById(
          req.params.id
        );

      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found'
        });
      }

      const ticketUserId =
        registration.user?._id?.toString() ||
        registration.user?.toString();

      const loggedInUserId =
        req.user._id.toString();

      if (
        ticketUserId !==
        loggedInUserId
      ) {
        return res.status(403).json({
          message:
            'You can only submit feedback for your own ticket'
        });
      }

      /*
      Feedback should normally be
      submitted for a completed/paid ticket.
      */
      if (
        registration.paymentStatus !==
        'paid'
      ) {
        return res.status(400).json({
          message:
            'Feedback is available only for paid tickets'
        });
      }

      registration.feedback = {
        rating:
          numericRating,
        comment:
          String(
            comment || ''
          ).trim()
      };

      await registration.save();

      const updatedRegistration =
        await Registration.findById(
          registration._id
        )
          .populate('event')
          .populate(
            'user',
            'name email'
          );

      res.json(
        updatedRegistration
      );

    } catch (error) {
      console.error(
        'Submit feedback error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to submit feedback'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| MARK ATTENDANCE
| PATCH /api/tickets/:id/attendance
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/attendance',
  protect,
  async (req, res) => {
    try {
      const registration =
        await Registration.findById(
          req.params.id
        );

      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found'
        });
      }

      const ticketUserId =
        registration.user?._id?.toString() ||
        registration.user?.toString();

      if (
        ticketUserId !==
        req.user._id.toString()
      ) {
        return res.status(403).json({
          message:
            'Access denied'
        });
      }

      if (
        registration.paymentStatus !==
        'paid'
      ) {
        return res.status(400).json({
          message:
            'Only paid tickets can be marked as attended'
        });
      }

      registration.attended =
        true;

      await registration.save();

      const updatedRegistration =
        await Registration.findById(
          registration._id
        )
          .populate('event')
          .populate(
            'user',
            'name email'
          );

      res.json(
        updatedRegistration
      );

    } catch (error) {
      console.error(
        'Mark attendance error:',
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
| GET EVENT REGISTRATIONS
| GET /api/tickets/event/:eventId
|--------------------------------------------------------------------------
*/

router.get(
  '/event/:eventId',
  protect,
  roles(
    'organizer',
    'admin'
  ),
  async (req, res) => {
    try {
      const event =
        await Event.findById(
          req.params.eventId
        );

      if (!event) {
        return res.status(404).json({
          message:
            'Event not found'
        });
      }

      /*
      Organizers can only view
      their own event registrations.
      Admins can view all events.
      */
      if (
        req.user.role !==
          'admin' &&
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
          event:
            req.params.eventId
        })
          .populate(
            'user',
            'name email'
          )
          .sort({
            createdAt: -1
          });

      res.json(
        registrations
      );

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


export default router;