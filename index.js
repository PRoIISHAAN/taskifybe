import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
import userRoutes from "./routes/user.js"
import cors from "cors"
import cookieParser from "cookie-parser";
const corsOrigin = process.env.CORS_ORIGIN || process.env.FRONTEND_BASE_URL;
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  console.error("Missing MONGODB_URI in environment");
  process.exit(1);
}

app.use(cors(
  {
  origin: corsOrigin,
  credentials: true
}
))

app.use(express.json());
app.use(cookieParser())

app.get("/healthy", (req, res)=> res.send("I am Healthy"));

app.use("/user",userRoutes)



async function main() {
  try {
    await mongoose.connect(mongoUri);
    console.log("DB connected");
    app.listen(port, ()=> console.log(`server is running at http://localhost:${port}`));

  } catch (err) {
    console.error("Database connection failed:", err);
    process.exit(1);
  }
}
main();


