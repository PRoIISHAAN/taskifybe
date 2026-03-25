import dotenv from 'dotenv';
dotenv.config();
import jwt from "jsonwebtoken";
const JWT_USER_PASSWORD = process.env.JWT_USER_PASSWORD
export function userMiddleware(req, res, next) {
  const token = req.cookies.token
  try {
    const decoded = jwt.verify(token, JWT_USER_PASSWORD)
    if (decoded) {
      req.userId = decoded.id;
      next();
    } else {
      res.status(403).json({ errormessage: "please login again" });
    }
  } catch (err) {
    res.status(403).json({ errormessage: "invalid token" });
  }
}
