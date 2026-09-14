import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },

  passwordHash: {
    type: String,
    required: true
  },

  role: {
    type: String,
    enum: ['attendee', 'organizer', 'admin'],
    default: 'attendee'
  },

  avatar: String

}, { timestamps: true });


const ticketTypeSchema = new mongoose.Schema({

  name: {
    type: String,
    required: true
  },

  price: {
    type: Number,
    required: true,
    min: 0
  },

  quantity: {
    type: Number,
    required: true,
    min: 1
  },

  sold: {
    type: Number,
    default: 0
  }

}, { _id: true });


const sessionSchema = new mongoose.Schema({

  title: String,

  description: String,

  startTime: Date,

  endTime: Date,

  speaker: String,

  room: String

}, { _id: true });


const eventSchema = new mongoose.Schema({

  title: {
    type: String,
    required: true,
    trim: true
  },

  description: {
    type: String,
    required: true
  },

  category: {
    type: String,
    required: true
  },

  date: {
    type: Date,
    required: true
  },

  endDate: Date,

  time: String,

  location: String,

  address: String,

  image: String,

  videoUrl: String,

  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  ticketTypes: [ticketTypeSchema],

  sessions: [sessionSchema],

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'draft'],
    default: 'pending'
  },

  featured: {
    type: Boolean,
    default: false
  },

  capacity: Number,

  tags: [String]

}, { timestamps: true });


const registrationSchema = new mongoose.Schema({

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },

  ticketType: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },

  quantity: {
    type: Number,
    default: 1
  },

  amount: Number,

  paymentStatus: {
    type: String,
    enum: ['created', 'paid', 'refunded', 'failed'],
    default: 'created'
  },

  razorpayOrderId: String,

  razorpayPaymentId: String,

  status: {
    type: String,
    enum: ['active', 'cancelled', 'transferred'],
    default: 'active'
  },

  attendee: {
    name: String,
    email: String,
    phone: String
  },

  attended: {
    type: Boolean,
    default: false
  },

  feedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },

    comment: String
  }

}, { timestamps: true });


registrationSchema.index({ user: 1, event: 1 });


/*
|--------------------------------------------------------------------------
| Support Ticket
|--------------------------------------------------------------------------
*/

const supportTicketSchema = new mongoose.Schema({

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  subject: {
    type: String,
    required: true,
    trim: true
  },

  message: {
    type: String,
    required: true,
    trim: true
  },

  category: {
    type: String,
    default: 'General',
    trim: true
  },

  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved'],
    default: 'open'
  }

}, { timestamps: true });


const User = mongoose.model('User', userSchema);

const Event = mongoose.model('Event', eventSchema);

const Registration = mongoose.model(
  'Registration',
  registrationSchema
);

const SupportTicket = mongoose.model(
  'SupportTicket',
  supportTicketSchema
);


/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

export {
  User,
  Event,
  Registration,
  SupportTicket
};