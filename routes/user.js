import { Router } from "express";
import express from "express";
const router = Router();
import { userMiddleware } from "../middleware/user.js";
import { boardModel, UserModel, workspaceModel } from "../database/index.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import todoRoutes from "./todo.js";
import generateSecureOTP from "../utils.js";
import { z } from "zod";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import {
  TodoModel,
  columnDataModel,
  column_orderdataModel,
  LabelModel,
  CheckListModel,
  recentlyViewedModel,
} from "../database/index.js";
const otpStore = new Map();
const emailSchema = z.email();
dotenv.config();
const JWT_USER_PASSWORD = process.env.JWT_USER_PASSWORD;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL;
router.use(express.json());
router.use(cookieParser());
function generateRandomColor() {
  const colors = [
    "#0052cc",
    "#00a4bf",
    "#03875b",
    "#ff991f",
    "#df360c",
    "#5243aa",
    "#172c4d",
  ];
  const randomNumber = Math.floor(Math.random() * 8);
  return colors[randomNumber];
}
function storeOTP(email, otp) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  otpStore.set(email, { otp, expiresAt });
  setTimeout(
    () => {
      if (otpStore.has(email)) {
        const stored = otpStore.get(email);
        if (stored.expiresAt <= new Date()) {
          otpStore.delete(email);
        }
      }
    },
    5 * 60 * 1000,
  );
}
function verifyOTP(email, inputOtp) {
  const stored = otpStore.get(email);
  if (!stored) {
    return { valid: false, error: "OTP not found or expired" };
  }
  if (stored.expiresAt <= new Date()) {
    otpStore.delete(email);
    return { valid: false, error: "OTP expired" };
  }

  if (stored.otp !== inputOtp) {
    return { valid: false, error: "Invalid OTP" };
  }
  otpStore.delete(email);
  return { valid: true };
}

const cookieOptions = {
  httpOnly: true,
  secure: false,
  sameSite: "lax",
};
const ninetyDays = 90 * 24 * 60 * 60 * 1000;

async function isBoardOrWorkspaceAdmin(boardDoc, requesterUserId) {
  if (!boardDoc) return false;

  const requesterIdString = String(requesterUserId);
  const isBoardAdmin = (boardDoc.Admins || []).some(
    (id) => String(id) === requesterIdString,
  );

  if (isBoardAdmin) {
    return true;
  }

  if (!boardDoc.workspace) {
    return false;
  }

  const workspace = await workspaceModel
    .findById(boardDoc.workspace)
    .select("workspaceAdmins")
    .lean();

  return (workspace?.workspaceAdmins || []).some(
    (id) => String(id) === requesterIdString,
  );
}

function escapeRegex(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortHash(length = 3) {
  return crypto.randomBytes(4).toString("base64url").slice(0, length);
}

function sanitizeUsername(base) {
  return String(base || "")
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")
    .replace(/^[._]+|[._]+$/g, "");
}

function normalizeEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const parsed = emailSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

async function generateUniqueUsername(email) {
  let base = sanitizeUsername(String(email || "").split("@")[0]);
  if (!base) base = "user";

  async function isAvailable(username) {
    const exists = await UserModel.exists({ username: username.toLowerCase() });
    return !exists;
  }

  if (await isAvailable(base)) {
    return base;
  }

  const separators = ["", "_", "."];
  for (const sep of separators) {
    for (let i = 1; i <= 9; i++) {
      const candidate = `${base}${sep}${i}`;
      if (await isAvailable(candidate)) {
        return candidate;
      }
    }
  }

  for (let i = 10; i <= 99; i++) {
    const candidate = `${base}_${i}`;
    if (await isAvailable(candidate)) {
      return candidate;
    }
  }

  for (let i = 0; i < 5; i++) {
    const candidate = `${base}_${shortHash()}`;
    if (await isAvailable(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not generate unique username");
}

router.post("/addusertoboard", userMiddleware, async (req, res) => {
  const { boardId, privilege, targetUserId, email } = req.body;
  const userId = req.userId;
  try {
    if (!mongoose.isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid boardId" });
    }

    const normalizedEmail = String(email || "")
      .trim()
      .toLowerCase();
    const hasTargetUserId = Boolean(targetUserId);
    const hasEmail = Boolean(normalizedEmail);

    if (!hasTargetUserId && !hasEmail) {
      return res.status(400).json({ message: "Provide targetUserId or email" });
    }

    if (hasTargetUserId && !mongoose.isValidObjectId(targetUserId)) {
      return res.status(400).json({ message: "Invalid targetUserId" });
    }

    if (hasEmail && !emailSchema.safeParse(normalizedEmail).success) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (!["Member", "Observer"].includes(privilege)) {
      return res.status(400).json({ message: "Invalid privilege" });
    }

    const board = await boardModel.findById(boardId);
    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }

    const requesterId = String(userId);
    const isAdmin = (board.Admins || []).some(
      (id) => String(id) === requesterId,
    );
    const isMember = (board.Members || []).some(
      (id) => String(id) === requesterId,
    );
    if (!isAdmin && !isMember) {
      return res.status(403).json({ message: "You are not authorised" });
    }

    const userOrFilters = [];
    if (hasTargetUserId) {
      userOrFilters.push({ _id: targetUserId });
    }
    if (hasEmail) {
      userOrFilters.push({ email: normalizedEmail });
    }

    let targetUser = await UserModel.findOne({ $or: userOrFilters });
    if (!targetUser) {
      if (!hasEmail) {
        return res.status(404).json({ message: "User not found" });
      }

      targetUser = await UserModel.create({
        email: normalizedEmail,
        username: await generateUniqueUsername(normalizedEmail),
        verified: false,
        initials: normalizedEmail[0].toUpperCase(),
        avatarColor: generateRandomColor(),
      });
      return res.json({ userCreated: true, user: targetUser });
    }

    const targetUserIdString = String(targetUser._id);
    board.Admins = (board.Admins || []).filter(
      (id) => String(id) !== targetUserIdString,
    );
    board.Members = (board.Members || []).filter(
      (id) => String(id) !== targetUserIdString,
    );
    board.Observers = (board.Observers || []).filter(
      (id) => String(id) !== targetUserIdString,
    );

    if (privilege === "Member") {
      board.Members.push(targetUser._id);
    } else {
      board.Observers.push(targetUser._id);
    }

    await board.save();
    return res.json({ added: true, user: targetUser });
  } catch (error) {
    console.error("Failed to add user to board:", error);
    return res.status(500).json({ message: "Failed to add user to board" });
  }
});

router.post("/updateinvitelinkprivilege", userMiddleware, async (req, res) => {
  const { boardId, privilege } = req.body;
  const userId = req.userId;
  try {
    if (!mongoose.isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid boardId" });
    }

    if (!["Member", "Observer"].includes(privilege)) {
      return res.status(400).json({ message: "Invalid privilege" });
    }

    const board = await boardModel.findById(boardId);
    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }

    const requesterId = String(userId);
    const isAdmin = (board.Admins || []).some(
      (id) => String(id) === requesterId,
    );
    const isMember = (board.Members || []).some(
      (id) => String(id) === requesterId,
    );

    if (!isAdmin && !isMember) {
      return res.status(403).json({ message: "You are not authorised" });
    }

    if (!board.inviteLink?.token) {
      return res.status(400).json({ message: "Invite link not found" });
    }

    board.inviteLink.privilege = privilege;
    await board.save();
    return res
      .status(200)
      .json({ changed: true, inviteLink: board.inviteLink });
  } catch (error) {
    console.error("Failed to validate invite link permission:", error);
    return res.status(500).json({ message: "Failed to generate invite link" });
  }
});

router.post("/signup", async (req, res) => {
  const { email } = req.body;
  try {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const user = await UserModel.create({
      email: normalizedEmail,
      username: await generateUniqueUsername(normalizedEmail),
      verified: false,
      initials: normalizedEmail[0].toUpperCase(),
      avatarColor: generateRandomColor(),
    });

    const token = jwt.sign({ id: user._id }, JWT_USER_PASSWORD);
    res
      .cookie("token", token, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: ninetyDays,
      })
      .json({ userCreated: true });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({
      error: error.message || "Failed to create user",
    });
  }
});

router.post("/generateinvitelink", userMiddleware, async (req, res) => {
  const { boardId } = req.body;
  const userId = req.userId;
  try {
    if (!mongoose.isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid boardId" });
    }

    const board = await boardModel.findById(boardId);
    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }

    const requesterId = String(userId);
    const isAdmin = (board.Admins || []).some(
      (id) => String(id) === requesterId,
    );
    const isMember = (board.Members || []).some(
      (id) => String(id) === requesterId,
    );

    if (!isAdmin && !isMember) {
      return res.status(403).json({ message: "You are not authorised" });
    }

    if (board.inviteLink?.token) {
      return res.json({
        inviteLink: {
          link: `${FRONTEND_BASE_URL}/invite/${board.inviteLink.token}`,
          privilege: board.inviteLink.privilege,
        },
      });
    }
    const inviteToken = jwt.sign({ boardId: boardId }, JWT_USER_PASSWORD);
    const inviteLink = `${FRONTEND_BASE_URL}/invite/${inviteToken}`;
    board.inviteLink = {
      token: inviteToken,
      privilege: "Member",
      creator: userId,
    };
    await board.save();
    return res
      .status(200)
      .json({ inviteLink: { link: inviteLink, privilege: "Member" } });
  } catch (error) {
    console.error("Failed to validate invite link permission:", error);
    return res.status(500).json({ message: "Failed to generate invite link" });
  }
});

router.get("/invite/:token/meta", async (req, res) => {
  const { token } = req.params;

  function getDisplayName(user) {
    const fullName = `${user?.FirstName || ""} ${user?.LastName || ""}`.trim();
    return fullName || user?.username || user?.email || "Unknown user";
  }

  function toInviteUser(user, role) {
    return {
      id: String(user?._id || ""),
      name: getDisplayName(user),
      role,
      avatarURL: user?.avatarURL || null,
      initials: user?.initials || null,
      avatarColor: user?.avatarColor || null,
    };
  }

  try {
    const decoded = jwt.verify(token, JWT_USER_PASSWORD);
    const boardId = decoded?.boardId;

    if (!mongoose.isValidObjectId(boardId)) {
      return res
        .status(400)
        .json({ valid: false, message: "Invalid invite token" });
    }

    const board = await boardModel
      .findById(boardId)
      .select("title inviteLink")
      .populate({
        path: "inviteLink.creator",
        select: "FirstName LastName username email",
      })
      .populate({
        path: "Admins",
        select: "FirstName LastName username email initials avatarColor avatarURL",
      })
      .populate({
        path: "Members",
        select: "FirstName LastName username email initials avatarColor avatarURL",
      })
      .lean();
    if (!board) {
      return res.status(404).json({ valid: false, message: "Board not found" });
    }

    if (!board.inviteLink?.token || board.inviteLink.token !== token) {
      return res
        .status(404)
        .json({ valid: false, message: "Invite link is not active" });
    }

    const creatorName = board.inviteLink?.creator
      ? getDisplayName(board.inviteLink.creator)
      : null;

    const admins = (board.Admins || []).map((admin) =>
      toInviteUser(admin, "Admin"),
    );
    const members = (board.Members || []).map((member) =>
      toInviteUser(member, "Member"),
    );
    const boardUsers = [...admins, ...members];

    return res.status(200).json({
      valid: true,
      boardId: String(board._id),
      boardTitle: board.title,
      privilege: board.inviteLink.privilege || "Member",
      creatorName,
      boardUsers,
    });
  } catch (error) {
    return res
      .status(400)
      .json({ valid: false, message: "Invalid invite token" });
  }
});

router.post("/join-via-invite", userMiddleware, async (req, res) => {
  const { token } = req.body;
  const userId = req.userId;

  try {
    if (!token) {
      return res.status(400).json({ message: "Invite token is required" });
    }

    const decoded = jwt.verify(token, JWT_USER_PASSWORD);
    const boardId = decoded?.boardId;

    if (!mongoose.isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid invite token" });
    }

    const board = await boardModel.findById(boardId);
    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }

    if (!board.inviteLink?.token || board.inviteLink.token !== token) {
      return res.status(404).json({ message: "Invite link is not active" });
    }

    const targetUserIdString = String(userId);
    const alreadyInBoard =
      (board.Admins || []).some((id) => String(id) === targetUserIdString) ||
      (board.Members || []).some((id) => String(id) === targetUserIdString) ||
      (board.Observers || []).some((id) => String(id) === targetUserIdString);

    if (alreadyInBoard) {
      return res
        .status(200)
        .json({
          joined: true,
          alreadyMember: true,
          boardId: String(board._id),
        });
    }

    board.Admins = (board.Admins || []).filter(
      (id) => String(id) !== targetUserIdString,
    );
    board.Members = (board.Members || []).filter(
      (id) => String(id) !== targetUserIdString,
    );
    board.Observers = (board.Observers || []).filter(
      (id) => String(id) !== targetUserIdString,
    );

    if (board.inviteLink.privilege === "Observer") {
      board.Observers.push(userId);
    } else {
      board.Members.push(userId);
    }

    await board.save();
    return res.status(200).json({ joined: true, boardId: String(board._id) });
  } catch (error) {
    return res.status(400).json({ message: "Invalid invite token" });
  }
});

router.get("/fetchinvitelink/:boardId", userMiddleware, async (req, res) => {
  const { boardId } = req.params;
  const userId = req.userId;
  try {
    if (!mongoose.isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid boardId" });
    }
    const board = await boardModel.findById(boardId);
    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }
    const requesterId = String(userId);
    const isAdmin = (board.Admins || []).some(
      (id) => String(id) === requesterId,
    );
    const isMember = (board.Members || []).some(
      (id) => String(id) === requesterId,
    );
    if (!isAdmin && !isMember) {
      return res.status(403).json({ message: "You are not authorised" });
    }
    if (board.inviteLink?.token) {
      return res.json({
        inviteLink: {
          link: `${FRONTEND_BASE_URL}/invite/${board.inviteLink.token}`,
          privilege: board.inviteLink.privilege,
        },
      });
    }
    return res.json({ message: "No invite link found" });
  } catch (error) {
    console.error("Failed to fetch invite link:", error);
    return res.status(500).json({ message: "Failed to fetch invite link" });
  }
});

router.delete("/deleteinvitelink", userMiddleware, async (req, res) => {
  const { boardId } = req.body;
  const userId = req.userId;
  try {
    if (!mongoose.isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid boardId" });
    }
    const board = await boardModel.findById(boardId);
    if (!board) {
      return res.status(404).json({ message: "Board not found" });
    }
    const requesterId = String(userId);
    const isAdmin = (board.Admins || []).some(
      (id) => String(id) === requesterId,
    );
    const isMember = (board.Members || []).some(
      (id) => String(id) === requesterId,
    );
    if (!isAdmin && !isMember) {
      return res.status(403).json({ message: "You are not authorised" });
    }
    board.inviteLink = null;
    await board.save();
    return res.status(200).json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete invite link:", error);
    return res.status(500).json({ message: "Failed to delete invite link" });
  }
});
router.get("/getuserinfo", userMiddleware, async (req, res) => {
  const userId = req.userId;
  const user = await UserModel.findOne({ _id: userId });
  res.json(user);
});

router.post("/leaveboard", userMiddleware, async (req, res) => {
  const { boardId, targetUserId } = req.body;
  const userId = req.userId;
  try {
    if (
      !mongoose.isValidObjectId(boardId) ||
      !mongoose.isValidObjectId(targetUserId)
    ) {
      return res
        .status(400)
        .json({ message: "Invalid boardId or targetUserId" });
    }

    const board = await boardModel.findById(boardId);
    const requesterIsAdmin = await isBoardOrWorkspaceAdmin(board, userId);

    if (!board || !requesterIsAdmin) {
      return res.status(403).json({ message: "You are not authorised" });
    }

    const targetUserIdString = String(targetUserId);
    board.Admins = (board.Admins || []).filter(
      (id) => String(id) !== targetUserIdString,
    );
    board.Members = (board.Members || []).filter(
      (id) => String(id) !== targetUserIdString,
    );
    board.Observers = (board.Observers || []).filter(
      (id) => String(id) !== targetUserIdString,
    );

    const [, todoUpdateResult] = await Promise.all([
      board.save(),
      TodoModel.updateMany(
        { boardId: boardId, members: targetUserId },
        { $pull: { members: targetUserId } },
      ),
    ]);

    return res.status(200).json({
      message: "User removed from board",
    });
  } catch (error) {
    console.error("Failed to leave board:", error);
    return res.status(500).json({ message: "Failed to leave board" });
  }
});

router.post("/login", async (req, res) => {
  const { email } = req.body;
  try {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const user = await UserModel.findOne({
      email: normalizedEmail,
    });
    if (!user) {
      const user = await UserModel.create({
        email: normalizedEmail,
        username: await generateUniqueUsername(normalizedEmail),
        verified: false,
        initials: normalizedEmail[0].toUpperCase(),
        avatarColor: generateRandomColor(),
      });
      const token = jwt.sign({ id: user._id }, JWT_USER_PASSWORD);
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: false,
          sameSite: "lax",
          maxAge: ninetyDays,
        })
        .json({ userCreated: true });
    } else {
      const otp = generateSecureOTP();
      storeOTP(normalizedEmail, otp);

      // TODO: Send OTP via email/SMS here
      console.log(`OTP for ${normalizedEmail}: ${otp}`); // Remove this in production

      res.json({
        found: true,
        message: "OTP sent to your email",
        // Don't send OTP in response in production
        otp: otp, // Remove this line in production
      });
    }
  } catch (error) {
    res.json({
      error: error,
    });
  }
});

router.post("/login/verifyOtp", async (req, res) => {
  const { email, resotp, rememberme } = req.body;
  const normalizedEmail = normalizeEmail(email);
  if (rememberme) {
    cookieOptions.maxAge = ninetyDays;
  }
  if (!normalizedEmail || !resotp) {
    return res.status(400).json({ error: "Email and OTP are required" });
  }
  try {
    const user = await UserModel.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otpVerification = verifyOTP(normalizedEmail, resotp);

    if (otpVerification.valid) {
      if (user.verified) {
        const token = jwt.sign({ id: user._id }, JWT_USER_PASSWORD);
        res.cookie("token", token, cookieOptions).json({
          verified: true,
          requiresCompletion: false,
        });
      } else if (!user.verified) {
        res.json({
          verified: true,
          requiresCompletion: true,
        });
      }
    } else if (!otpVerification.valid) {
      return res.status(400).json({
        error: "invalidOtp",
        verified: false,
        message: otpVerification.error,
      });
    }
  } catch (error) {
    res.json({
      error: error,
      verified: false,
    });
  }
});

router.post("/validateOtpEmail", async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = normalizeEmail(email);
  
  if (!normalizedEmail) {
    return res.status(400).json({ valid: false, message: "Invalid email format" });
  }

  try {
    const user = await UserModel.findOne({ email: normalizedEmail });
    
    // Email must exist in the system to be valid for OTP flow
    if (!user) {
      return res.status(404).json({ valid: false, message: "Email not found" });
    }

    // OTP route should only be accessible when an active OTP session exists.
    // This applies to both verified and unverified users.
    const storedOtp = otpStore.get(normalizedEmail);
    if (!storedOtp) {
      return res.status(400).json({ valid: false, message: "OTP session not found or expired" });
    }

    if (storedOtp.expiresAt <= new Date()) {
      otpStore.delete(normalizedEmail);
      return res.status(400).json({ valid: false, message: "OTP expired" });
    }

    // Valid if email exists and there is an active OTP session.
    return res.status(200).json({ valid: true, message: "Email is valid for OTP verification" });
  } catch (error) {
    console.error("Error validating OTP email:", error);
    return res.status(500).json({ valid: false, message: "Internal server error" });
  }
});

router.post("/login/completeregisteration", async (req, res) => {
  const { email, rememberme, FirstName, LastName, password } = req.body;
  const normalizedEmail = normalizeEmail(email);
  const getInitials = (name) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };
  if (rememberme) {
    cookieOptions.maxAge = ninetyDays;
  }
  if (!normalizedEmail) {
    return res.status(400).json({ error: "Invalid email" });
  }
  const hpass = await bcrypt.hash(password, 10);

  try {
    const user = await UserModel.findOneAndUpdate(
      { email: normalizedEmail },
      {
        FirstName: FirstName,
        LastName: LastName,
        initials: getInitials(FirstName + " " + LastName),
        avatarColor: generateRandomColor(),
        password: hpass,
        $set: { verified: true },
      },
    );
    const board = await boardModel.create({
      title: "My Trello board",
      AdminId: user._id,
      bgColor: "gray",
    });
    const trellostarterguide = await columnDataModel.create({
      title: "Trello Starter Guide",
      userId: user._id,
      boardId: board._id,
    });
    const today = await columnDataModel.create({
      title: "Today",
      userId: user._id,
      boardId: board._id,
    });
    const thisweek = await columnDataModel.create({
      title: "This Week",
      userId: user._id,
      boardId: board._id,
    });
    const later = await columnDataModel.create({
      title: "Later",
      userId: user._id,
      boardId: board._id,
    });

    const column_order = await column_orderdataModel.create({
      userId: user._id,
      boardId: board._id,
      column_order: [
        trellostarterguide._id,
        today._id,
        thisweek._id,
        later._id,
      ],
    });

    const card1 = await TodoModel.create({
      userId: user._id,
      title: "New to Trello? Start here",
      columnId: trellostarterguide._id,
      boardId: board._id,
    });

    const card2 = await TodoModel.create({
      title: "Capture from email, Slack, and Teams",
      userId: user._id,
      columnId: trellostarterguide._id,
      boardId: board._id,
      url: "https://trello.com/1/cards/68996524b7c458378221284f/attachments/689965253a125f56df065965/previews/689965273a125f56df06597b/download/2_20Email%2C_20Slack%2C_20Teams.webp",
      desc: ``,
    });
    const checkllistCard2 = await CheckListModel.create({
      userId: user._id,
      title: "Try capturing to-dos from Email and Slack 📧",
      userId: user._id,
      boardId: board._id,
      todoId: card2._id,
      items: [
        {
          title:
            "Send an email to inbox@app.trello.com from the email associated with your Trello account",
          type: "text",
        },
        {
          title: "Open Trello in Slack",
          type: "link",
          href: "https://slack.com/app_redirect?app=A074YH40Z",
        },
        {
          title:
            "Add a Trello card from Slack by using Slack's 'Save for later' feature",
          type: "text",
        },
        {
          title:
            "Add a Trello card from Slack by reacting to a message with the :inbox_tray: emoji",
          type: "text",
        },
        {
          title: "Connect your Trello and Microsoft Teams accounts",
          type: "link",
          href: "https://teams.microsoft.com/l/app/49e6f432-d79c-49e8-94f7-89b94f3672fd",
        },
        {
          title:
            "Add a Trello card from Microsoft Teams by clicking on the message in Teams and selecting 'Create card'",
          type: "text",
        },
      ],
    });
    await TodoModel.findOneAndUpdate(
      { _id: card2._id },
      {
        checklist: [checkllistCard2._id],
      },
    );
    const card3 = await TodoModel.create({
      title: "Dive into Trello basics",
      boardId: board._id,
      userId: user._id,
      desc: ``,
      cover:
        "https://trello.com/1/cards/68996524b7c458378221287…1c77417d8966e35/download/3_20Trello_20Basics.webp",
    });
    const card3checklist1 = await CheckListModel.create({
      userId: user._id,
      todoId: card3._id,
      boardId: board._id,
      title: "Boards and Cards",
      items: [
        {
          title:
            "Organize your to-dos by dragging and dropping a card from :inbox_tray: Inbox to :arrow_right: board",
          type: "text",
        },
        {
          title: "Add a due date :calendar: to the card of an upcoming to-do",
          type: "text",
        },
        {
          title:
            "Add and apply labels or custom fields to organize your cards (i.e. work, personal, high, medium, or low)",
          type: "text",
        },
        {
          title: `Mark a to-do as complete by hovering over a card and selecting "mark complete" :white_check_mark:`,
          type: "text",
        },
      ],
    });
    const card3checklist2 = await CheckListModel.create({
      userId: user._id,
      todoId: card3._id,
      boardId: board._id,
      title: "Planner",
      items: [
        { title: "Connect your calendar :calendar:", type: "text" },
        {
          title:
            "Schedule time for your to-dos by dragging and dropping a card from :inbox_tray: Inbox to :arrow_right: Planner :calendar:",
          type: "text",
        },
      ],
    });
    const card3checklist3 = await CheckListModel.create({
      userId: user._id,
      todoId: card3._id,
      boardId: board._id,
      title: "Navigation bar",
      items: [
        {
          title:
            "Toggle :left_right_arrow: the icons in the navigation bar to see different views of your boards, Inbox, Planner, and the Board Switcher",
          type: "text",
        },
      ],
    });
    await TodoModel.findOneAndUpdate(
      { _id: card3._id },
      {
        checklist: [
          card3checklist1._id,
          card3checklist2._id,
          card3checklist3._id,
        ],
      },
    );
    const card4 = await TodoModel.create({
      title: "Download the mobile app",
      boardId: board._id,
      userId: user._id,
      desc: ``,
      cover:
        "https://trello.com/1/cards/68996525b7c458378221292…/download/4_20Download_20the_20mobile_20apps.webp",
    });

    const token = jwt.sign({ id: user._id }, JWT_USER_PASSWORD);
    res.cookie("token", token, cookieOptions).json({ success: true });
  } catch (error) {
    res.json({
      error: error,
    });
  }
});

router.post("/login/resendOtp", async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    const user = await UserModel.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = generateSecureOTP();
    storeOTP(normalizedEmail, otp);

    // TODO: Send OTP via email/SMS here
    console.log(`Resent OTP for ${normalizedEmail}: ${otp}`); // Remove this in production

    res.json({
      message: "OTP resent successfully",
      otp: otp, // Remove this line in production
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});
router.get("/getverifystatus", userMiddleware, async (req, res) => {
  const userId = req.userId;
  console.log("1");
  const user = await UserModel.findOne({ _id: userId });
  console.log(user);
  res.json({ userId: user._id, verified: user.verified, email: user.email });
});

router.get("/boards", userMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const boards = await boardModel
      .find(
        {
          $or: [{ AdminId: userId }, { collaborators: userId }],
        },
        { _id: 1, title: 1, bgColor: 1 },
      )
      .lean();

    const boardIds = boards.map((board) => String(board._id));
    const boardsById = boards.reduce((acc, board) => {
      acc[String(board._id)] = board;
      return acc;
    }, {});

    res.json({
      boards,
      boardIds,
      boardsById,
    });
  } catch (error) {
    console.error("Failed to fetch boards:", error);
    res.status(500).json({ message: "Failed to fetch boards" });
  }
});

router.post("/updateuserboardprivilege", userMiddleware, async (req, res) => {
  const { boardId, newPrivilege, targetUserId } = req.body;
  const userId = req.userId;

  try {
    if (
      !mongoose.isValidObjectId(boardId) ||
      !mongoose.isValidObjectId(targetUserId)
    ) {
      return res
        .status(400)
        .json({ message: "Invalid boardId or targetUserId" });
    }

    if (!["Admin", "Member", "Observer"].includes(newPrivilege)) {
      return res.status(400).json({ message: "Invalid newPrivilege" });
    }

    const board = await boardModel.findById(boardId);
    const requesterIsAdmin = await isBoardOrWorkspaceAdmin(board, userId);

    if (!board || !requesterIsAdmin) {
      return res
        .status(403)
        .json({ message: "You don't have permission to update privileges" });
    }

    const targetUserIdString = String(targetUserId);

    // Keep a user in exactly one role by clearing existing role membership first.
    board.Admins = (board.Admins || []).filter(
      (id) => String(id) !== targetUserIdString,
    );
    board.Members = (board.Members || []).filter(
      (id) => String(id) !== targetUserIdString,
    );
    board.Observers = (board.Observers || []).filter(
      (id) => String(id) !== targetUserIdString,
    );

    if (newPrivilege === "Admin") {
      board.Admins.push(targetUserId);
    } else if (newPrivilege === "Member") {
      board.Members.push(targetUserId);
    } else {
      board.Observers.push(targetUserId);
    }

    const updatedBoard = await board.save();
    res.status(200).json({ result: "Success", board: updatedBoard });
  } catch (error) {
    console.error("Failed to update user board privilege:", error);
    res.status(500).json({ message: "Failed to update privilege" });
  }
});

router.get("/searchusers", userMiddleware, async (req, res) => {
  const { query } = req.query;
  const userId = req.userId;

  try {
    const trimmedQuery = String(query || "").trim();
    if (trimmedQuery.length < 1) {
      return res.status(200).json({ users: [] });
    }

    const tokens = trimmedQuery
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => escapeRegex(token));

    const fullQueryPattern = tokens.join(".*");
    const fullQueryRegex = new RegExp(fullQueryPattern, "i");

    const tokenFieldMatches = tokens.flatMap((token) => {
      const tokenRegex = new RegExp(token, "i");
      return [
        { email: tokenRegex },
        { username: tokenRegex },
        { FirstName: tokenRegex },
        { LastName: tokenRegex },
      ];
    });

    const users = await UserModel.find({
      _id: { $ne: userId },
      $or: [
        ...tokenFieldMatches,
        {
          $expr: {
            $regexMatch: {
              input: {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ["$FirstName", ""] },
                      " ",
                      { $ifNull: ["$LastName", ""] },
                    ],
                  },
                },
              },
              regex: fullQueryRegex,
            },
          },
        },
      ],
    })
      .select(
        "FirstName LastName email username avatarURL initials avatarColor",
      )
      .limit(20)
      .lean();

    return res.status(200).json({ users });
  } catch (error) {
    console.error("Failed to search users:", error);
    return res.status(500).json({ message: "Failed to search users" });
  }
});

router.get("/boardUsers/:boardId", userMiddleware, async (req, res) => {
  const { boardId } = req.params;
  try {
    if (!mongoose.isValidObjectId(boardId)) {
      return res.status(400).json({ message: "Invalid boardId" });
    }

    const board = await boardModel.findOne({ _id: boardId }).populate([
      {
        path: "Admins",
        select:
          "FirstName LastName email username avatarURL initials avatarColor",
      },
      {
        path: "Members",
        select:
          "FirstName LastName email username avatarURL initials avatarColor",
      },
      {
        path: "Observers",
        select:
          "FirstName LastName email username avatarURL initials avatarColor",
      },
    ]);
    if (!board) {
      return res.status(404).json({ error: "Board not found" });
    }

    const admins = board.Admins || [];

    const members = board.Members || [];
    const observers = board.Observers || [];

    res.json({
      admins,
      members,
      observers,
    });
  } catch (error) {
    console.error("Failed to fetch board users:", error);
    res.status(500).json({ message: "Failed to fetch board users" });
  }
});
// router.put("/setVerifyStatus",userMiddleware,async (req,res)=>{
//   const userId = req.userId
//   try {
//     const update = await UserModel.findOneAndUpdate({_id:userId},{verified:true})
//     console.log(update)
//     res.json({update:update})
//   }
//   catch(error){
//     res.json({error:error})
//   }
// })

router.use("/todos", userMiddleware, todoRoutes);

router.post("/logout", userMiddleware, (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
  });
});

export default router;
