import express from 'express';

import {
  Event,
  Registration
} from '../models/index.js';

import {
  protect,
  roles
} from '../middleware/auth.js';

const router = express.Router();


// ============================================================
// HELPERS
// ============================================================

function parseDateOnly(value) {
  if (!value) return null;

  const stringValue = String(value).trim();

  /*
    YYYY-MM-DD
    Parse as local date instead of UTC.
  */
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      stringValue
    );

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(
    year,
    month - 1,
    day
  );

  date.setHours(
    0,
    0,
    0,
    0
  );

  /*
    Protect against invalid dates such as
    2026-99-99.
  */
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}


function getTodayStart() {
  const today = new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  return today;
}


function validateEventDate(dateValue) {
  const date = parseDateOnly(
    dateValue
  );

  if (!date) {
    return {
      valid: false,
      message:
        'A valid event date is required.'
    };
  }

  if (
    date < getTodayStart()
  ) {
    return {
      valid: false,
      message:
        'Past event dates are not allowed. Please select today or a future date.'
    };
  }

  return {
    valid: true,
    date
  };
}


function validateEndDate(
  startDateValue,
  endDateValue
) {
  if (!endDateValue) {
    return {
      valid: true,
      date: null
    };
  }

  const startDate =
    parseDateOnly(
      startDateValue
    );

  const endDate =
    parseDateOnly(
      endDateValue
    );

  if (!endDate) {
    return {
      valid: false,
      message:
        'A valid event end date is required.'
    };
  }

  if (
    startDate &&
    endDate < startDate
  ) {
    return {
      valid: false,
      message:
        'Event end date cannot be earlier than the event start date.'
    };
  }

  return {
    valid: true,
    date: endDate
  };
}


function normalizeTicketTypes(
  ticketTypes
) {
  if (
    !Array.isArray(ticketTypes) ||
    ticketTypes.length === 0
  ) {
    return {
      valid: false,
      message:
        'At least one ticket type is required.'
    };
  }

  const normalized = [];

  for (
    let index = 0;
    index < ticketTypes.length;
    index += 1
  ) {
    const ticket =
      ticketTypes[index];

    const name =
      String(
        ticket?.name || ''
      ).trim();

    const price =
      Number(ticket?.price);

    const quantity =
      Number(ticket?.quantity);

    if (!name) {
      return {
        valid: false,
        message:
          `Ticket type ${index + 1} needs a name.`
      };
    }

    if (
      !Number.isFinite(price) ||
      price < 0
    ) {
      return {
        valid: false,
        message:
          `Ticket type ${index + 1} has an invalid price.`
      };
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      return {
        valid: false,
        message:
          `Ticket type ${index + 1} quantity must be at least 1.`
      };
    }

    normalized.push({
      ...(ticket?._id
        ? {
            _id: ticket._id
          }
        : {}),

      name,
      price,
      quantity,

      ...(ticket?.sold !==
        undefined
        ? {
            sold: Number(
              ticket.sold
            ) || 0
          }
        : {})
    });
  }

  return {
    valid: true,
    ticketTypes: normalized
  };
}


// ============================================================
// GET EVENTS
// GET /api/events
//
// Public event listing.
// Default status = approved.
// ============================================================

router.get('/', async (req, res) => {
  try {
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

    // ----------------------------------------------------------
    // STATUS
    // ----------------------------------------------------------

    if (status !== 'all') {
      filter.status = status;
    }

    // ----------------------------------------------------------
    // SEARCH
    // ----------------------------------------------------------

    if (q?.trim()) {
      const searchRegex =
        new RegExp(
          q.trim(),
          'i'
        );

      filter.$or = [
        {
          title: searchRegex
        },
        {
          description: searchRegex
        },
        {
          tags: searchRegex
        },
        {
          category: searchRegex
        }
      ];
    }

    // ----------------------------------------------------------
    // CATEGORY
    // ----------------------------------------------------------

    if (category?.trim()) {
      filter.category =
        new RegExp(
          `^${category.trim()}$`,
          'i'
        );
    }

    // ----------------------------------------------------------
    // LOCATION
    // ----------------------------------------------------------

    if (location?.trim()) {
      filter.location =
        new RegExp(
          location.trim(),
          'i'
        );
    }

    // ----------------------------------------------------------
    // DATE RANGE
    // ----------------------------------------------------------

    if (from || to) {
      filter.date = {};

      if (from) {
        const fromDate =
          parseDateOnly(from);

        if (!fromDate) {
          return res.status(400).json({
            message:
              'Invalid start date filter.'
          });
        }

        filter.date.$gte =
          fromDate;
      }

      if (to) {
        const toDate =
          parseDateOnly(to);

        if (!toDate) {
          return res.status(400).json({
            message:
              'Invalid end date filter.'
          });
        }

        /*
          Include the complete end date.
        */
        toDate.setHours(
          23,
          59,
          59,
          999
        );

        filter.date.$lte =
          toDate;
      }
    }

    // ----------------------------------------------------------
    // PRICE FILTER
    // ----------------------------------------------------------

    const hasMinPrice =
      minPrice !== undefined &&
      minPrice !== '';

    const hasMaxPrice =
      maxPrice !== undefined &&
      maxPrice !== '';

    if (
      hasMinPrice ||
      hasMaxPrice
    ) {
      const priceFilter = {};

      if (hasMinPrice) {
        const minimum =
          Number(minPrice);

        if (
          !Number.isFinite(
            minimum
          ) ||
          minimum < 0
        ) {
          return res.status(400).json({
            message:
              'Invalid minimum price.'
          });
        }

        priceFilter.$gte =
          minimum;
      }

      if (hasMaxPrice) {
        const maximum =
          Number(maxPrice);

        if (
          !Number.isFinite(
            maximum
          ) ||
          maximum < 0
        ) {
          return res.status(400).json({
            message:
              'Invalid maximum price.'
          });
        }

        priceFilter.$lte =
          maximum;
      }

      filter.ticketTypes = {
        $elemMatch: {
          price: priceFilter
        }
      };
    }

    const events =
      await Event.find(filter)
        .populate(
          'organizer',
          'name email'
        )
        .sort({
          date: 1
        });

    // ----------------------------------------------------------
    // REGISTRATION COUNTS
    // ----------------------------------------------------------

    const eventIds =
      events.map(
        (event) => event._id
      );

    const registrationCounts =
      eventIds.length
        ? await Registration.aggregate([
            {
              $match: {
                event: {
                  $in: eventIds
                }
              }
            },
            {
              $group: {
                _id: '$event',
                count: {
                  $sum: 1
                }
              }
            }
          ])
        : [];

    const countMap =
      new Map(
        registrationCounts.map(
          (item) => [
            String(item._id),
            Number(item.count) || 0
          ]
        )
      );

    const result =
      events.map((event) => {
        const object =
          event.toObject();

        const registrationCount =
          countMap.get(
            String(event._id)
          ) || 0;

        const totalSold =
          (event.ticketTypes || []).reduce(
            (sum, ticket) =>
              sum +
              (Number(ticket.sold) || 0),
            0
          );

        const totalAvailable =
          (event.ticketTypes || []).reduce(
            (sum, ticket) =>
              sum +
              Math.max(
                0,
                (Number(ticket.quantity) || 0) -
                  (Number(ticket.sold) || 0)
              ),
            0
          );

        return {
          ...object,

          registrationCount,

          totalSold,

          totalAvailable
        };
      });

    return res.json(result);
  } catch (error) {
    console.error(
      'Get events error:',
      error
    );

    return res.status(500).json({
      message:
        'Failed to load events.'
    });
  }
});


// ============================================================
// GET SINGLE EVENT
// GET /api/events/:id
// ============================================================

router.get(
  '/:id',
  async (req, res) => {
    try {
      const event =
        await Event.findById(
          req.params.id
        ).populate(
          'organizer',
          'name email'
        );

      if (!event) {
        return res.status(404).json({
          message:
            'Event not found.'
        });
      }

      const registrationCount =
        await Registration.countDocuments({
          event: event._id
        });

      const object =
        event.toObject();

      const totalSold =
        (event.ticketTypes || []).reduce(
          (sum, ticket) =>
            sum +
            (Number(ticket.sold) || 0),
          0
        );

      const totalAvailable =
        (event.ticketTypes || []).reduce(
          (sum, ticket) =>
            sum +
            Math.max(
              0,
              (Number(ticket.quantity) || 0) -
                (Number(ticket.sold) || 0)
            ),
          0
        );

      return res.json({
        ...object,
        registrationCount,
        totalSold,
        totalAvailable
      });
    } catch (error) {
      console.error(
        'Get event error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to load event.'
      });
    }
  }
);


// ============================================================
// CREATE EVENT
// POST /api/events
//
// Organizer only.
// ============================================================

router.post(
  '/',
  protect,
  roles('organizer'),
  async (req, res) => {
    try {
      const {
        title,
        description,
        category,
        date,
        endDate,
        time,
        location,
        address,
        image,
        videoUrl,
        ticketTypes,
        sessions,
        capacity,
        tags
      } = req.body;

      // --------------------------------------------------------
      // REQUIRED FIELDS
      // --------------------------------------------------------

      if (
        !title?.trim() ||
        !description?.trim() ||
        !category?.trim() ||
        !date ||
        !time ||
        !location?.trim()
      ) {
        return res.status(400).json({
          message:
            'Title, description, category, date, time and location are required.'
        });
      }

      // --------------------------------------------------------
      // DATE
      // --------------------------------------------------------

      const dateValidation =
        validateEventDate(
          date
        );

      if (!dateValidation.valid) {
        return res.status(400).json({
          message:
            dateValidation.message
        });
      }

      const endDateValidation =
        validateEndDate(
          date,
          endDate
        );

      if (
        !endDateValidation.valid
      ) {
        return res.status(400).json({
          message:
            endDateValidation.message
        });
      }

      // --------------------------------------------------------
      // CAPACITY
      // --------------------------------------------------------

      const numericCapacity =
        Number(capacity);

      if (
        !Number.isInteger(
          numericCapacity
        ) ||
        numericCapacity < 1
      ) {
        return res.status(400).json({
          message:
            'Event capacity must be at least 1.'
        });
      }

      // --------------------------------------------------------
      // TICKETS
      // --------------------------------------------------------

      const ticketValidation =
        normalizeTicketTypes(
          ticketTypes
        );

      if (
        !ticketValidation.valid
      ) {
        return res.status(400).json({
          message:
            ticketValidation.message
        });
      }

      const normalizedTickets =
        ticketValidation.ticketTypes;

      const totalTicketQuantity =
        normalizedTickets.reduce(
          (sum, ticket) =>
            sum +
            Number(ticket.quantity),
          0
        );

      if (
        totalTicketQuantity <
        numericCapacity
      ) {
        return res.status(400).json({
          message:
            `Ticket quantities total ${totalTicketQuantity}, but event capacity is ${numericCapacity}. Add more ticket inventory or reduce the capacity.`
        });
      }

      // New events always start pending.

      const event =
        await Event.create({
          title:
            String(title).trim(),

          description:
            String(description).trim(),

          category:
            String(category).trim(),

          date:
            dateValidation.date,

          endDate:
            endDateValidation.date,

          time:
            String(time).trim(),

          location:
            String(location).trim(),

          address:
            String(address || '').trim(),

          image:
            String(image || '').trim(),

          videoUrl:
            String(videoUrl || '').trim(),

          organizer:
            req.user._id,

          ticketTypes:
            normalizedTickets.map(
              (ticket) => ({
                name:
                  ticket.name,

                price:
                  ticket.price,

                quantity:
                  ticket.quantity,

                sold: 0
              })
            ),

          sessions:
            Array.isArray(sessions)
              ? sessions
              : [],

          capacity:
            numericCapacity,

          tags:
            Array.isArray(tags)
              ? tags
              : [],

          status:
            'pending'
        });

      const populatedEvent =
        await Event.findById(
          event._id
        ).populate(
          'organizer',
          'name email'
        );

      return res.status(201).json(
        populatedEvent
      );
    } catch (error) {
      console.error(
        'Create event error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to create event.'
      });
    }
  }
);


// ============================================================
// UPDATE EVENT
// PUT /api/events/:id
//
// Organizer owner only.
// ============================================================

router.put(
  '/:id',
  protect,
  roles('organizer'),
  async (req, res) => {
    try {
      const event =
        await Event.findById(
          req.params.id
        );

      if (!event) {
        return res.status(404).json({
          message:
            'Event not found.'
        });
      }

      if (
        String(event.organizer) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only edit your own events.'
        });
      }

      const {
        title,
        description,
        category,
        date,
        endDate,
        time,
        location,
        address,
        image,
        videoUrl,
        ticketTypes,
        sessions,
        capacity,
        tags
      } = req.body;

      // --------------------------------------------------------
      // REQUIRED FIELDS
      // --------------------------------------------------------

      if (
        !title?.trim() ||
        !description?.trim() ||
        !category?.trim() ||
        !date ||
        !time ||
        !location?.trim()
      ) {
        return res.status(400).json({
          message:
            'Title, description, category, date, time and location are required.'
        });
      }

      // --------------------------------------------------------
      // DATE
      // --------------------------------------------------------

      const dateValidation =
        validateEventDate(
          date
        );

      if (!dateValidation.valid) {
        return res.status(400).json({
          message:
            dateValidation.message
        });
      }

      const endDateValidation =
        validateEndDate(
          date,
          endDate
        );

      if (
        !endDateValidation.valid
      ) {
        return res.status(400).json({
          message:
            endDateValidation.message
        });
      }

      // --------------------------------------------------------
      // CAPACITY
      // --------------------------------------------------------

      const numericCapacity =
        Number(capacity);

      if (
        !Number.isInteger(
          numericCapacity
        ) ||
        numericCapacity < 1
      ) {
        return res.status(400).json({
          message:
            'Event capacity must be at least 1.'
        });
      }

      // --------------------------------------------------------
      // TICKETS
      // --------------------------------------------------------

      const ticketValidation =
        normalizeTicketTypes(
          ticketTypes
        );

      if (
        !ticketValidation.valid
      ) {
        return res.status(400).json({
          message:
            ticketValidation.message
        });
      }

      const incomingTickets =
        ticketValidation.ticketTypes;

      /*
        Never allow quantity to become smaller
        than tickets already sold.

        We use the existing database values,
        not client-supplied sold values.
      */

      const existingTickets =
        event.ticketTypes || [];

      for (
        const incomingTicket
        of incomingTickets
      ) {
        if (!incomingTicket._id) {
          continue;
        }

        const existingTicket =
          existingTickets.id(
            incomingTicket._id
          );

        if (!existingTicket) {
          continue;
        }

        const existingSold =
          Number(
            existingTicket.sold
          ) || 0;

        const newQuantity =
          Number(
            incomingTicket.quantity
          );

        if (
          newQuantity <
          existingSold
        ) {
          return res.status(400).json({
            message:
              `${existingTicket.name}: quantity cannot be less than ${existingSold}, because ${existingSold} ticket(s) have already been sold.`
          });
        }
      }

      const totalTicketQuantity =
        incomingTickets.reduce(
          (sum, ticket) =>
            sum +
            Number(ticket.quantity),
          0
        );

      if (
        totalTicketQuantity <
        numericCapacity
      ) {
        return res.status(400).json({
          message:
            `Ticket quantities total ${totalTicketQuantity}, but event capacity is ${numericCapacity}. Add more ticket inventory or reduce the capacity.`
        });
      }

      // --------------------------------------------------------
      // PRESERVE SOLD VALUES FROM DATABASE
      // --------------------------------------------------------

      const updatedTickets =
        incomingTickets.map(
          (incomingTicket) => {
            if (
              !incomingTicket._id
            ) {
              return {
                name:
                  incomingTicket.name,

                price:
                  incomingTicket.price,

                quantity:
                  incomingTicket.quantity,

                sold: 0
              };
            }

            const existingTicket =
              existingTickets.id(
                incomingTicket._id
              );

            return {
              _id:
                incomingTicket._id,

              name:
                incomingTicket.name,

              price:
                incomingTicket.price,

              quantity:
                incomingTicket.quantity,

              sold:
                existingTicket
                  ? Number(
                      existingTicket.sold
                    ) || 0
                  : 0
            };
          }
        );

      // --------------------------------------------------------
      // UPDATE
      // --------------------------------------------------------

      event.title =
        String(title).trim();

      event.description =
        String(description).trim();

      event.category =
        String(category).trim();

      event.date =
        dateValidation.date;

      event.endDate =
        endDateValidation.date;

      event.time =
        String(time).trim();

      event.location =
        String(location).trim();

      event.address =
        String(address || '').trim();

      event.image =
        String(image || '').trim();

      event.videoUrl =
        String(videoUrl || '').trim();

      event.ticketTypes =
        updatedTickets;

      event.sessions =
        Array.isArray(sessions)
          ? sessions
          : [];

      event.capacity =
        numericCapacity;

      event.tags =
        Array.isArray(tags)
          ? tags
          : [];

      await event.save();

      const updatedEvent =
        await Event.findById(
          event._id
        ).populate(
          'organizer',
          'name email'
        );

      return res.json(
        updatedEvent
      );
    } catch (error) {
      console.error(
        'Update event error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to update event.'
      });
    }
  }
);


// ============================================================
// DELETE EVENT
// DELETE /api/events/:id
//
// Organizer owner only.
//
// IMPORTANT:
// Event can ONLY be deleted when there are ZERO
// registrations, including cancelled registrations.
// ============================================================

router.delete(
  '/:id',
  protect,
  roles('organizer'),
  async (req, res) => {
    try {
      const event =
        await Event.findById(
          req.params.id
        );

      if (!event) {
        return res.status(404).json({
          message:
            'Event not found.'
        });
      }

      if (
        String(event.organizer) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only delete your own events.'
        });
      }

      // --------------------------------------------------------
      // REGISTRATION CHECK
      // --------------------------------------------------------

      const registrationCount =
        await Registration.countDocuments({
          event: event._id
        });

      if (
        registrationCount > 0
      ) {
        return res.status(400).json({
          message:
            `This event cannot be deleted because ${registrationCount} registration${registrationCount === 1 ? '' : 's'} already exist.`
        });
      }

      // --------------------------------------------------------
      // DELETE
      // --------------------------------------------------------

      await Event.findByIdAndDelete(
        event._id
      );

      return res.json({
        message:
          'Event deleted successfully.'
      });
    } catch (error) {
      console.error(
        'Delete event error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to delete event.'
      });
    }
  }
);


// ============================================================
// ADD / UPDATE EVENT SCHEDULE
// PATCH /api/events/:id/schedule
// ============================================================

router.patch(
  '/:id/schedule',
  protect,
  roles('organizer', 'admin'),
  async (req, res) => {
    try {
      const event =
        await Event.findById(
          req.params.id
        );

      if (!event) {
        return res.status(404).json({
          message:
            'Event not found.'
        });
      }

      if (
        req.user.role ===
          'organizer' &&
        String(event.organizer) !==
          String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only update schedules for your own events.'
        });
      }

      if (
        !Array.isArray(
          req.body.sessions
        )
      ) {
        return res.status(400).json({
          message:
            'Sessions must be an array.'
        });
      }

      event.sessions =
        req.body.sessions;

      await event.save();

      return res.json(event);
    } catch (error) {
      console.error(
        'Update schedule error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to update event schedule.'
      });
    }
  }
);


// ============================================================
// EXPORT ATTENDEES
// GET /api/events/:id/attendees/export
//
// Organizer owner or admin.
// ============================================================

router.get(
  '/:id/attendees/export',
  protect,
  roles('organizer', 'admin'),
  async (req, res) => {
    try {
      const event =
        await Event.findById(
          req.params.id
        );

      if (!event) {
        return res.status(404).json({
          message:
            'Event not found.'
        });
      }

      if (
        req.user.role ===
          'organizer' &&
        String(event.organizer) !==
          String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only export attendees for your own events.'
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

      const escapeCsv =
        (value) => {
          const stringValue =
            String(
              value ?? ''
            );

          return `"${stringValue.replace(
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
          'Attended',
          'Registered At'
        ]
      ];

      for (
        const registration
        of registrations
      ) {
        const ticket =
          event.ticketTypes?.id(
            registration.ticketType
          );

        rows.push([
          registration._id,
          registration.attendee?.name ||
            registration.user?.name ||
            '',
          registration.attendee?.email ||
            registration.user?.email ||
            '',
          registration.attendee?.phone ||
            '',
          ticket?.name || '',
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
          .map(
            (row) =>
              row
                .map(
                  escapeCsv
                )
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

      return res.send(csv);
    } catch (error) {
      console.error(
        'Export attendees error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to export attendees.'
      });
    }
  }
);


export default router;