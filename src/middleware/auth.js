import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';


// ============================================
// Authentication
// ============================================

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        message: 'Authentication required'
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        message: 'Authentication required'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.id)
      .select('-passwordHash');

    if (!user) {
      return res.status(401).json({
        message: 'User not found'
      });
    }

    req.user = user;

    next();

  } catch (error) {
    console.error('Authentication error:', error);

    return res.status(401).json({
      message: 'Invalid or expired token'
    });
  }
}


// ============================================
// Role Authorization
// ============================================

export function requireRole(...allowedRoles) {
  return (req, res, next) => {

    if (!req.user) {
      return res.status(401).json({
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Access denied'
      });
    }

    next();
  };
}


// ============================================
// Backward-compatible aliases
// ============================================

// Old routes in the project use:
// import { protect, roles } from '../middleware/auth.js';

export const protect = requireAuth;

export const roles = (...allowedRoles) => {
  return requireRole(...allowedRoles);
};