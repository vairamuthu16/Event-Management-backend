import express from 'express';
import crypto from 'node:crypto';
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


/* =========================================================
   RAZORPAY
========================================================= */

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});


/* =========================================================
   HELPERS
========================================================= */

function getErrorMessage(error) {
  return (
    error?.response?.data?.error?.description ||
    error?.error?.description ||
    error?.message ||
    'Server error'
  );
}


function isFutureEvent(event) {
  if (!event?.date) return false;

  const eventDate = new Date(event.date);

  return (
    !Number.isNaN(eventDate.getTime()) &&
    eventDate.getTime() > Date.now()
  );
}


function getAvailableTickets(ticketType) {
  const quantity = Number(ticketType?.quantity || 0);
  const sold = Number(ticketType?.sold || 0);

  return Math.max(0, quantity - sold);
}


/* =========================================================
   GET MY REGISTRATIONS
========================================================= */

router.get(
  '/mine',
  requireAuth,
  async (req, res) => {
    try {
      const registrations = await Registration.find({
        user: req.user._id
      })
        .populate(
          'event',
          'title description category date endDate time location address image status organizer ticketTypes'
        )
        .sort({
          createdAt: -1
        });

      return res.json(registrations);

    } catch (error) {
      console.error(
        'GET /tickets/mine error:',
        error
      );

      return res.status(500).json({
        message: 'Failed to load registrations'
      });
    }
  }
);


/* =========================================================
   GET REGISTRATIONS FOR AN EVENT
   Organizer/Admin only
========================================================= */

router.get(
  '/event/:eventId',
  requireAuth,
  requireRole('organizer', 'admin'),
  async (req, res) => {
    try {
      const event = await Event.findById(
        req.params.eventId
      );

      if (!event) {
        return res.status(404).json({
          message: 'Event not found'
        });
      }

      if (
        req.user.role === 'organizer' &&
        String(event.organizer) !== String(req.user._id)
      ) {
        return res.status(403).json({
          message: 'You can only view registrations for your own events'
        });
      }

      const registrations = await Registration.find({
        event: event._id
      })
        .populate(
          'user',
          'name email role'
        )
        .sort({
          createdAt: -1
        });

      return res.json(registrations);

    } catch (error) {
      console.error(
        'GET /tickets/event/:eventId error:',
        error
      );

      return res.status(500).json({
        message: 'Failed to load event registrations'
      });
    }
  }
);


/* =========================================================
   GET SINGLE REGISTRATION
========================================================= */

router.get(
  '/:id',
  requireAuth,
  async (req, res) => {
    try {
      const registration =
        await Registration.findById(req.params.id)
          .populate(
            'event',
            'title description category date endDate time location address image status organizer ticketTypes'
          )
          .populate(
            'user',
            'name email role'
          );

      if (!registration) {
        return res.status(404).json({
          message: 'Registration not found'
        });
      }

      const isOwner =
        String(registration.user?._id) ===
        String(req.user._id);

      const isAdmin =
        req.user.role === 'admin';

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          message: 'Access denied'
        });
      }

      return res.json(registration);

    } catch (error) {
      console.error(
        'GET /tickets/:id error:',
        error
      );

      return res.status(500).json({
        message: 'Failed to load registration'
      });
    }
  }
);


/* =========================================================
   CREATE RAZORPAY ORDER
========================================================= */

router.post(
  '/create-order',
  requireAuth,
  async (req, res) => {
    try {
      /*
        IMPORTANT:
        Organizers cannot purchase tickets.
      */

      if (req.user.role !== 'attendee') {
        return res.status(403).json({
          message:
            'Only attendee accounts can purchase event tickets.'
        });
      }


      const {
        eventId,
        ticketTypeId,
        quantity,
        attendee
      } = req.body;


      /* -----------------------------------------------
         BASIC VALIDATION
      ------------------------------------------------ */

      if (!eventId) {
        return res.status(400).json({
          message: 'Event is required.'
        });
      }

      if (!ticketTypeId) {
        return res.status(400).json({
          message: 'Ticket type is required.'
        });
      }

      const requestedQuantity =
        Number(quantity);


      if (
        !Number.isInteger(requestedQuantity) ||
        requestedQuantity < 1
      ) {
        return res.status(400).json({
          message:
            'Ticket quantity must be at least 1.'
        });
      }


      if (requestedQuantity > 10) {
        return res.status(400).json({
          message:
            'You can purchase a maximum of 10 tickets at a time.'
        });
      }


      /* -----------------------------------------------
         ATTENDEE VALIDATION
      ------------------------------------------------ */

      const attendeeName =
        String(attendee?.name || '').trim();

      const attendeeEmail =
        String(attendee?.email || '').trim().toLowerCase();

      const attendeePhone =
        String(attendee?.phone || '').trim();


      if (!attendeeName) {
        return res.status(400).json({
          message: 'Attendee name is required.'
        });
      }


      if (
        !attendeeEmail ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
          attendeeEmail
        )
      ) {
        return res.status(400).json({
          message:
            'Please enter a valid attendee email address.'
        });
      }


      if (!attendeePhone) {
        return res.status(400).json({
          message:
            'Attendee phone number is required.'
        });
      }


      /* -----------------------------------------------
         LOAD EVENT
      ------------------------------------------------ */

      const event =
        await Event.findById(eventId);


      if (!event) {
        return res.status(404).json({
          message: 'Event not found.'
        });
      }


      /* -----------------------------------------------
         ONLY APPROVED EVENTS CAN BE PURCHASED
      ------------------------------------------------ */

      if (event.status !== 'approved') {
        return res.status(400).json({
          message:
            'Tickets can only be purchased for approved events.'
        });
      }


      /* -----------------------------------------------
         EVENT DATE VALIDATION
         
         Do not allow purchases after the event starts.
      ------------------------------------------------ */

      if (!isFutureEvent(event)) {
        return res.status(400).json({
          message:
            'This event has already started or ended. Ticket purchase is no longer available.'
        });
      }


      /* -----------------------------------------------
         FIND TICKET TYPE
      ------------------------------------------------ */

      const ticketType =
        event.ticketTypes.id(ticketTypeId);


      if (!ticketType) {
        return res.status(404).json({
          message: 'Ticket type not found.'
        });
      }


      const available =
        getAvailableTickets(ticketType);


      /* -----------------------------------------------
         SOLD OUT
      ------------------------------------------------ */

      if (available <= 0) {
        return res.status(400).json({
          message:
            `${ticketType.name} is sold out.`
        });
      }


      /* -----------------------------------------------
         NOT ENOUGH TICKETS
      ------------------------------------------------ */

      if (requestedQuantity > available) {
        return res.status(400).json({
          message:
            `Only ${available} ${ticketType.name} ticket${available === 1 ? '' : 's'} available. Please reduce the quantity.`
        });
      }


      /* -----------------------------------------------
         PRICE
      ------------------------------------------------ */

      const price =
        Number(ticketType.price || 0);

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          message:
            'This ticket has an invalid price.'
        });
      }


      const totalAmount =
        price * requestedQuantity;


      if (totalAmount <= 0) {
        return res.status(400).json({
          message:
            'The ticket amount must be greater than zero.'
        });
      }


      /*
        Razorpay uses paise.
        Example:
        ₹499 -> 49900 paise
      */

      const amountInPaise =
        Math.round(totalAmount * 100);


      /* -----------------------------------------------
         CREATE REGISTRATION FIRST
         
         It remains "created" until payment verification.
      ------------------------------------------------ */

      const registration =
        await Registration.create({
          user: req.user._id,

          event: event._id,

          ticketType: ticketType._id,

          quantity: requestedQuantity,

          amount: totalAmount,

          paymentStatus: 'created',

          status: 'active',

          attendee: {
            name: attendeeName,
            email: attendeeEmail,
            phone: attendeePhone
          }
        });


      /* -----------------------------------------------
         CREATE RAZORPAY ORDER
      ------------------------------------------------ */

      let order;

      try {
        order =
          await razorpay.orders.create({
            amount: amountInPaise,

            currency: 'INR',

            receipt:
              `event_${event._id}_${registration._id}`,

            notes: {
              registrationId:
                String(registration._id),

              eventId:
                String(event._id),

              ticketTypeId:
                String(ticketType._id),

              userId:
                String(req.user._id)
            }
          });

      } catch (razorpayError) {

        console.error(
          'Razorpay order creation error:',
          razorpayError
        );

        await Registration.findByIdAndDelete(
          registration._id
        );

        return res.status(502).json({
          message:
            razorpayError?.error?.description ||
            'Unable to create Razorpay payment order.'
        });
      }


      /* -----------------------------------------------
         SAVE ORDER ID
      ------------------------------------------------ */

      registration.razorpayOrderId =
        order.id;

      await registration.save();


      console.log(
        'RAZORPAY ORDER CREATED:',
        {
          registrationId:
            String(registration._id),

          orderId:
            order.id,

          amount:
            totalAmount
        }
      );


      return res.status(201).json({
        message:
          'Payment order created successfully.',

        registrationId:
          registration._id,

        keyId:
          process.env.RAZORPAY_KEY_ID,

        order: {
          id: order.id,
          amount: order.amount,
          currency: order.currency
        },

        event: {
          id: event._id,
          title: event.title
        },

        ticket: {
          id: ticketType._id,
          name: ticketType.name,
          price: ticketType.price,
          available
        }
      });

    } catch (error) {

      console.error(
        'POST /tickets/create-order error:',
        error
      );

      return res.status(500).json({
        message:
          getErrorMessage(error)
      });
    }
  }
);


/* =========================================================
   VERIFY RAZORPAY PAYMENT
========================================================= */

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


      console.log(
        'PAYMENT VERIFY REQUEST:',
        {
          registrationId,
          razorpay_order_id,
          razorpay_payment_id,
          hasSignature:
            Boolean(razorpay_signature)
        }
      );


      /* -----------------------------------------------
         REQUIRED FIELDS
      ------------------------------------------------ */

      if (!registrationId) {
        return res.status(400).json({
          message:
            'Registration ID is missing.'
        });
      }


      if (!razorpay_order_id) {
        return res.status(400).json({
          message:
            'Razorpay order ID is missing.'
        });
      }


      if (!razorpay_payment_id) {
        return res.status(400).json({
          message:
            'Razorpay payment ID is missing.'
        });
      }


      if (!razorpay_signature) {
        return res.status(400).json({
          message:
            'Razorpay payment signature is missing.'
        });
      }


      /* -----------------------------------------------
         FIND REGISTRATION
      ------------------------------------------------ */

      const registration =
        await Registration.findById(
          registrationId
        );


      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found.'
        });
      }


      /* -----------------------------------------------
         OWNERSHIP CHECK
      ------------------------------------------------ */

      if (
        String(registration.user) !==
        String(req.user._id) &&
        req.user.role !== 'admin'
      ) {
        return res.status(403).json({
          message:
            'You cannot verify this registration.'
        });
      }


      /* -----------------------------------------------
         PREVENT DUPLICATE VERIFICATION
      ------------------------------------------------ */

      if (
        registration.paymentStatus === 'paid'
      ) {

        console.log(
          'PAYMENT ALREADY VERIFIED:',
          String(registration._id)
        );

        return res.json({
          message:
            'Payment already verified.',

          registration
        });
      }


      /* -----------------------------------------------
         ORDER ID MUST MATCH
      ------------------------------------------------ */

      if (
        String(registration.razorpayOrderId) !==
        String(razorpay_order_id)
      ) {

        console.error(
          'ORDER ID MISMATCH:',
          {
            database:
              registration.razorpayOrderId,

            received:
              razorpay_order_id
          }
        );

        return res.status(400).json({
          message:
            'Payment order does not match this registration.'
        });
      }


      /* -----------------------------------------------
         SIGNATURE VERIFICATION
         
         HMAC SHA256:
         order_id|payment_id
      ------------------------------------------------ */

      const generatedSignature =
        crypto
          .createHmac(
            'sha256',
            process.env.RAZORPAY_KEY_SECRET
          )
          .update(
            `${razorpay_order_id}|${razorpay_payment_id}`
          )
          .digest('hex');


      const signaturesMatch =
        crypto.timingSafeEqual(
          Buffer.from(generatedSignature),
          Buffer.from(razorpay_signature)
        );


      if (!signaturesMatch) {

        console.error(
          'INVALID RAZORPAY SIGNATURE'
        );

        registration.paymentStatus =
          'failed';

        await registration.save();

        return res.status(400).json({
          message:
            'Payment verification failed. Invalid Razorpay signature.'
        });
      }


      /* -----------------------------------------------
         FETCH PAYMENT FROM RAZORPAY
         
         This gives us the actual payment status.
      ------------------------------------------------ */

      let payment;

      try {

        payment =
          await razorpay.payments.fetch(
            razorpay_payment_id
          );

      } catch (paymentError) {

        console.error(
          'Unable to fetch Razorpay payment:',
          paymentError
        );

        return res.status(502).json({
          message:
            'Payment was received but its status could not be confirmed. Please try again.'
        });
      }


      console.log(
        'RAZORPAY PAYMENT STATUS:',
        {
          paymentId:
            razorpay_payment_id,

          orderId:
            payment.order_id,

          status:
            payment.status,

          captured:
            payment.captured
        }
      );


      /* -----------------------------------------------
         VERIFY PAYMENT ORDER
      ------------------------------------------------ */

      if (
        String(payment.order_id) !==
        String(razorpay_order_id)
      ) {

        return res.status(400).json({
          message:
            'Razorpay payment order mismatch.'
        });
      }


      /* -----------------------------------------------
         PAYMENT MUST BE CAPTURED
      ------------------------------------------------ */

      if (
        payment.status !== 'captured' &&
        payment.captured !== true
      ) {

        return res.status(400).json({
          message:
            `Payment is not captured yet. Current payment status: ${payment.status || 'unknown'}.`
        });
      }


      /* -----------------------------------------------
         RELOAD EVENT
      ------------------------------------------------ */

      const event =
        await Event.findById(
          registration.event
        );


      if (!event) {
        return res.status(404).json({
          message:
            'Event no longer exists.'
        });
      }


      /* -----------------------------------------------
         FIND TICKET TYPE
      ------------------------------------------------ */

      const ticketType =
        event.ticketTypes.id(
          registration.ticketType
        );


      if (!ticketType) {
        return res.status(404).json({
          message:
            'Ticket type no longer exists.'
        });
      }


      /* -----------------------------------------------
         INVENTORY CHECK AGAIN
         
         Important because another user could have
         purchased tickets while this payment was open.
      ------------------------------------------------ */

      const available =
        getAvailableTickets(ticketType);


      if (
        Number(registration.quantity) >
        available
      ) {

        console.error(
          'INSUFFICIENT INVENTORY DURING VERIFY:',
          {
            registrationId:
              registration._id,

            requested:
              registration.quantity,

            available
          }
        );

        return res.status(409).json({
          message:
            'Payment was completed, but there are not enough tickets remaining for this ticket type. Please contact support for assistance.'
        });
      }


      /* -----------------------------------------------
         UPDATE REGISTRATION
         
         THIS IS THE IMPORTANT PART.
         
         created -> paid
      ------------------------------------------------ */

      registration.paymentStatus =
        'paid';

      registration.status =
        'active';

      registration.razorpayOrderId =
        razorpay_order_id;

      registration.razorpayPaymentId =
        razorpay_payment_id;


      await registration.save();


      /* -----------------------------------------------
         UPDATE SOLD COUNT
      ------------------------------------------------ */

      ticketType.sold =
        Number(ticketType.sold || 0) +
        Number(registration.quantity || 0);


      await event.save();


      /* -----------------------------------------------
         GET FINAL REGISTRATION
      ------------------------------------------------ */

      const updatedRegistration =
        await Registration.findById(
          registration._id
        )
          .populate(
            'event',
            'title description category date endDate time location address image status organizer'
          );


      console.log(
        'PAYMENT SUCCESSFULLY VERIFIED:',
        {
          registrationId:
            String(registration._id),

          orderId:
            razorpay_order_id,

          paymentId:
            razorpay_payment_id,

          paymentStatus:
            updatedRegistration.paymentStatus,

          quantity:
            updatedRegistration.quantity
        }
      );


      return res.json({
        success: true,

        message:
          'Payment verified successfully. Your ticket is confirmed.',

        registration:
          updatedRegistration
      });

    } catch (error) {

      console.error(
        'POST /tickets/verify error:',
        error
      );

      return res.status(500).json({
        message:
          getErrorMessage(error)
      });
    }
  }
);


/* =========================================================
   CANCEL REGISTRATION
========================================================= */

router.patch(
  '/:id/cancel',
  requireAuth,
  async (req, res) => {
    try {

      const registration =
        await Registration.findById(
          req.params.id
        );


      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found.'
        });
      }


      if (
        String(registration.user) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only cancel your own registration.'
        });
      }


      if (
        registration.status === 'cancelled'
      ) {
        return res.status(400).json({
          message:
            'This registration is already cancelled.'
        });
      }


      /*
        Only paid registrations should restore inventory.
      */

      const wasPaid =
        registration.paymentStatus === 'paid';


      if (wasPaid) {

        const event =
          await Event.findById(
            registration.event
          );


        if (event) {

          const ticketType =
            event.ticketTypes.id(
              registration.ticketType
            );


          if (ticketType) {

            ticketType.sold =
              Math.max(
                0,
                Number(ticketType.sold || 0) -
                Number(registration.quantity || 0)
              );


            await event.save();
          }
        }
      }


      registration.status =
        'cancelled';


      /*
        We keep paymentStatus as "paid"
        for payment history.

        The registration status tells us
        that the ticket was cancelled.
      */

      await registration.save();


      const updatedRegistration =
        await Registration.findById(
          registration._id
        )
          .populate(
            'event',
            'title category date endDate time location address image'
          );


      return res.json(
        updatedRegistration
      );

    } catch (error) {

      console.error(
        'PATCH /tickets/:id/cancel error:',
        error
      );

      return res.status(500).json({
        message:
          'Unable to cancel registration.'
      });
    }
  }
);


/* =========================================================
   SUBMIT EVENT FEEDBACK
========================================================= */

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
        !Number.isFinite(numericRating) ||
        numericRating < 1 ||
        numericRating > 5
      ) {
        return res.status(400).json({
          message:
            'Rating must be between 1 and 5.'
        });
      }


      const registration =
        await Registration.findById(
          req.params.id
        );


      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found.'
        });
      }


      if (
        String(registration.user) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only review your own registration.'
        });
      }


      if (
        registration.paymentStatus !== 'paid'
      ) {
        return res.status(400).json({
          message:
            'Feedback is available only after successful payment.'
        });
      }


      registration.feedback = {
        rating:
          numericRating,

        comment:
          String(comment || '').trim()
      };


      await registration.save();


      const updatedRegistration =
        await Registration.findById(
          registration._id
        )
          .populate(
            'event',
            'title category date location image'
          );


      return res.json(
        updatedRegistration
      );

    } catch (error) {

      console.error(
        'PATCH /tickets/:id/feedback error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to save feedback.'
      });
    }
  }
);


/* =========================================================
   ADMIN / ORGANIZER ATTENDANCE
========================================================= */

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
        )
          .populate(
            'event',
            'organizer'
          );


      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found.'
        });
      }


      if (
        req.user.role === 'organizer' &&
        String(registration.event?.organizer) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only update attendance for your own events.'
        });
      }


      registration.attended =
        Boolean(attended);


      await registration.save();


      return res.json(
        registration
      );

    } catch (error) {

      console.error(
        'PATCH /tickets/:id/attendance error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to update attendance.'
      });
    }
  }
);


/* =========================================================
   EXPORT
========================================================= */

export default router;