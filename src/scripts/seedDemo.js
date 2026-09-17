import 'dotenv/config';

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import {
  User,
  Event
} from '../models/index.js';

const demoUsers = [
  {
    name: 'Demo Administrator',
    email:
      'admin@eventhub.test',
    password: 'Admin@123',
    role: 'admin'
  },
  {
    name: 'Demo Organizer',
    email:
      'organizer@eventhub.test',
    password:
      'Organizer@123',
    role: 'organizer'
  },
  {
    name: 'Demo Attendee',
    email:
      'attendee@eventhub.test',
    password:
      'Attendee@123',
    role: 'attendee'
  }
];

async function seedDemo() {
  try {
    await mongoose.connect(
      process.env.MONGO_URI
    );

    console.log(
      'MongoDB connected'
    );

    const users = {};

    for (const demo of demoUsers) {
      const passwordHash =
        await bcrypt.hash(
          demo.password,
          12
        );

      const user =
        await User.findOneAndUpdate(
          {
            email:
              demo.email
          },
          {
            name:
              demo.name,
            email:
              demo.email,
            passwordHash,
            role:
              demo.role
          },
          {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true
          }
        );

      users[
        demo.role
      ] = user;

      console.log(
        `${demo.role} account ready: ${demo.email}`
      );
    }

    const existingEvent =
      await Event.findOne({
        title:
          'Demo Technology Conference',
        organizer:
          users.organizer._id
      });

    if (!existingEvent) {
      await Event.create({
        title:
          'Demo Technology Conference',

        description:
          'A demonstration event for testing event discovery, ticket sales, schedules and analytics.',

        category:
          'Technology',

        date:
          new Date(
            '2027-01-20T09:00:00'
          ),

        time:
          '09:00 AM',

        location:
          'Chennai',

        address:
          'Chennai, Tamil Nadu',

        image:
          'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1200&q=80',

        organizer:
          users.organizer._id,

        status:
          'approved',

        capacity: 150,

        ticketTypes: [
          {
            name:
              'General Admission',
            price: 499,
            quantity: 100,
            sold: 7
          },
          {
            name: 'VIP',
            price: 999,
            quantity: 50,
            sold: 3
          }
        ],

        sessions: [
          {
            title:
              'Opening Session',
            description:
              'Welcome and event introduction.',
            startTime:
              new Date(
                '2027-01-20T09:00:00'
              ),
            endTime:
              new Date(
                '2027-01-20T10:00:00'
              ),
            speaker:
              'EventHub Team',
            room:
              'Main Hall'
          },
          {
            title:
              'Technology Trends',
            description:
              'Discussion about modern technology trends.',
            startTime:
              new Date(
                '2027-01-20T10:30:00'
              ),
            endTime:
              new Date(
                '2027-01-20T11:30:00'
              ),
            speaker:
              'Guest Speaker',
            room:
              'Room A'
          }
        ],

        tags: [
          'technology',
          'conference',
          'demo'
        ]
      });

      console.log(
        'Demo event created'
      );
    } else {
      console.log(
        'Demo event already exists'
      );
    }

    console.log('');
    console.log(
      '=============================='
    );
    console.log(
      'DEMO CREDENTIALS'
    );
    console.log(
      '=============================='
    );

    console.log(
      'Admin: admin@eventhub.test / Admin@123'
    );

    console.log(
      'Organizer: organizer@eventhub.test / Organizer@123'
    );

    console.log(
      'Attendee: attendee@eventhub.test / Attendee@123'
    );

    console.log(
      '=============================='
    );
  } catch (error) {
    console.error(
      'Demo seed failed:',
      error
    );

    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedDemo();